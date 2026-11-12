/** Ollama (native) ve OpenAI uyumlu API istemcisi. */

const DEFAULT_TIMEOUT = 180000;

export class LlmError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function errorText(error) {
  return error instanceof Error ? error.message : String(error || 'Bilinmeyen hata');
}

/** Sağlayıcıya göre sohbet uç noktası. Tam adres yazılmışsa korunur. */
export function chatEndpoint(settings) {
  if (settings.provider === 'openai') {
    return `${openaiRoot(settings.baseUrl)}/v1/chat/completions`;
  }
  return `${apiRoot(settings.baseUrl)}/api/chat`;
}

export function modelsEndpoint(settings) {
  if (settings.provider === 'openai') {
    return `${openaiRoot(settings.baseUrl)}/v1/models`;
  }
  return `${apiRoot(settings.baseUrl)}/api/tags`;
}

/** Base URL `/v1` ile bitiyorsa iki kez eklememek için kökü ayır. */
function openaiRoot(baseUrl) {
  return apiRoot(baseUrl).replace(/\/v1$/i, '');
}

function apiRoot(baseUrl) {
  let base = String(baseUrl || '').trim();
  if (!/^https?:\/\//i.test(base)) {
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(base);
    base = `${local ? 'http' : 'https'}://${base}`;
  }
  base = base.replace(/\/+$/, '');
  base = base
    .replace(/\/api\/chat$/, '')
    .replace(/\/api\/tags$/, '')
    .replace(/\/v1\/chat\/completions$/, '')
    .replace(/\/v1\/models$/, '')
    .replace(/\/api$/, '');
  return base || 'https://ollama.com';
}

function authHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function timedFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function callJson(url, init, { timeoutMs = DEFAULT_TIMEOUT, retries = 2 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { response, text } = await timedFetch(url, init, timeoutMs);

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < retries) {
          await sleep(1200 * 2 ** attempt);
          continue;
        }
        throw new LlmError(describeStatusError(response.status, text), {
          status: response.status,
          retryable,
        });
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new LlmError(
          'API geçersiz bir yanıt döndürdü (JSON değil). Adres ve sağlayıcı ayarını kontrol edin.',
        );
      }
    } catch (error) {
      if (error instanceof LlmError) throw error;

      if (error?.name === 'AbortError') {
        lastError = new LlmError(
          `İstek zaman aşımına uğradı (${Math.round(timeoutMs / 1000)} sn). Model yavaş olabilir veya servis yanıt vermiyor.`,
        );
        // Zaman aşımında tekrar denemek yerine kullanıcıya haber ver.
        throw lastError;
      }

      lastError = new LlmError(
        `Ağ hatası: ${error?.message || error}. API adresine erişilemiyor; adres için izin verilmemiş olabilir (Ayarlar).`,
      );
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new LlmError('API isteği başarısız oldu.');
}

function describeStatusError(status, bodyText) {
  const detail = extractApiError(bodyText);
  const suffix = detail ? ` Ayrıntı: ${detail}` : '';

  if (status === 400 || status === 422) {
    return `API isteği reddedildi (${status}). Model adı veya istek biçimi uyumsuz olabilir.${suffix}`;
  }
  if (status === 401) {
    return `API anahtarı reddedildi (401). Ayarlar’daki anahtarı kontrol edin.${suffix}`;
  }
  if (status === 403) {
    return `API erişimi reddedildi (403). Anahtarın yetkisini ve model erişimini kontrol edin.${suffix}`;
  }
  if (status === 404) {
    return `API adresi veya model bulunamadı (404). Base URL ve model adını kontrol edin.${suffix}`;
  }
  if (status === 429) {
    return `İstek sınırına takıldınız (429). Bir süre bekleyip tekrar deneyin.${suffix}`;
  }
  if (status >= 500) {
    return `API sunucusu hata verdi (${status}). Daha sonra tekrar deneyin.${suffix}`;
  }
  return `API isteği başarısız oldu (${status}).${suffix}`;
}

function extractApiError(bodyText) {
  if (!bodyText) return '';
  try {
    const data = JSON.parse(bodyText);
    const value =
      data?.error?.message ||
      (typeof data?.error === 'string' ? data.error : '') ||
      data?.message ||
      '';
    return String(value).slice(0, 400);
  } catch {
    const clean = bodyText
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean.slice(0, 300);
  }
}

/** Sohbet isteği; sonuç metnini döndürür. */
export async function chat(settings, messages, options = {}) {
  const data = await requestChat(settings, messages, options);
  const content = extractContent(data);

  if (!content.trim()) {
    const thinking = extractThinking(data);
    if (thinking.trim()) {
      throw new LlmError(
        'Model yalnızca düşünme (thinking) çıktısı verdi. Ayarlar’da maksimum çıktı token değerini artırın veya “Çıktı token sınırı yok” seçeneğini işaretleyin.',
      );
    }
    throw new LlmError(
      'Model boş yanıt döndürdü. Modelin görsel/sohbet desteğini ve adını kontrol edin.',
    );
  }

  return content.trim();
}

/** Ham API yanıtı; test sırasında boş içerik/düşünme çıktısını ayırt etmek için. */
async function requestChat(settings, messages, options = {}) {
  const {
    maxTokens,
    temperature = Number.isFinite(Number(settings.temperature))
      ? Number(settings.temperature)
      : 0.3,
    images = [],
    mime = 'image/jpeg',
    timeoutMs = DEFAULT_TIMEOUT,
    model = settings.model,
  } = options;

  if (!model) throw new LlmError('Model adı boş. Ayarlar’dan bir model girin.');
  if (!settings.baseUrl) throw new LlmError('API adresi boş. Ayarlar’ı kontrol edin.');

  const requestedTokens = Number(maxTokens);
  const tokenLimit =
    Number.isFinite(requestedTokens) && requestedTokens > 0
      ? Math.min(Math.floor(requestedTokens), 1_000_000)
      : null;

  const provider = settings.provider === 'openai' ? 'openai' : 'ollama';
  let payload;

  if (provider === 'openai') {
    const prepared = messages.map((message, index) => {
      if (index === messages.length - 1 && images.length) {
        return {
          role: message.role,
          content: [
            { type: 'text', text: message.content },
            ...images.map((base64) => ({
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${base64}` },
            })),
          ],
        };
      }
      return { role: message.role, content: message.content };
    });

    payload = {
      model,
      messages: prepared,
      stream: false,
      temperature,
    };
    if (tokenLimit) payload.max_tokens = tokenLimit;
  } else {
    const prepared = messages.map((message, index) => {
      if (index === messages.length - 1 && images.length) {
        return { ...message, images };
      }
      return { ...message };
    });

    payload = {
      model,
      messages: prepared,
      stream: false,
      options: { temperature },
    };
    if (tokenLimit) payload.options.num_predict = tokenLimit;
  }

  return callJson(
    chatEndpoint(settings),
    {
      method: 'POST',
      headers: authHeaders(settings.apiKey),
      body: JSON.stringify(payload),
    },
    { timeoutMs },
  );
}

function extractContent(data) {
  if (typeof data?.message?.content === 'string') return data.message.content;
  if (typeof data?.response === 'string') return data.response;

  const choice = data?.choices?.[0]?.message?.content;
  if (typeof choice === 'string') return choice;
  if (Array.isArray(choice)) {
    return choice.map((part) => part?.text || part?.content || '').join('');
  }
  if (typeof data?.content === 'string') return data.content;
  return '';
}

function extractThinking(data) {
  if (typeof data?.message?.thinking === 'string') return data.message.thinking;
  if (typeof data?.thinking === 'string') return data.thinking;

  const message = data?.choices?.[0]?.message;
  if (typeof message?.reasoning_content === 'string') return message.reasoning_content;
  if (typeof message?.reasoning === 'string') return message.reasoning;
  return '';
}

export async function listModels({ provider, baseUrl, apiKey }) {
  const settings = { provider, baseUrl, apiKey };
  const headers = authHeaders(apiKey);
  const urls = [];

  if (provider === 'openai') {
    urls.push(`${openaiRoot(baseUrl)}/v1/models`);
  } else {
    urls.push(`${apiRoot(baseUrl)}/api/tags`);
    urls.push(`${openaiRoot(baseUrl)}/v1/models`);
  }

  let lastError = null;

  for (const url of urls) {
    try {
      const data = await callJson(
        url,
        { method: 'GET', headers },
        { timeoutMs: 30000, retries: 0 },
      );
      const names = [];

      if (Array.isArray(data?.models)) {
        for (const model of data.models) {
          const name = model?.name || model?.model;
          if (name) names.push(String(name));
        }
      }
      if (Array.isArray(data?.data)) {
        for (const model of data.data) {
          const name = model?.id || model?.name;
          if (name) names.push(String(name));
        }
      }

      if (names.length) {
        return [...new Set(names)].sort((a, b) => a.localeCompare(b));
      }
      lastError = new LlmError('Sunucu model listesi döndürmedi.');
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new LlmError('Model listesi alınamadı.');
}

/** Ayarları dener: model listesi + minik bir sohbet isteği. */
export async function testConnection(settings) {
  let models = [];
  let modelsError = null;

  try {
    models = await listModels(settings);
  } catch (error) {
    modelsError = errorText(error);
  }

  let reply = '';
  let chatError = null;
  let warning = null;
  let thinking = false;
  let emptyReply = false;

  try {
    const data = await requestChat(
      settings,
      [{ role: 'user', content: 'Yanıt olarak yalnızca "ok" yaz.' }],
      { maxTokens: 256, temperature: 0, timeoutMs: 90000 },
    );

    reply = extractContent(data);
    thinking = Boolean(extractThinking(data).trim());
    emptyReply = !reply.trim();

    if (emptyReply) {
      warning = thinking
        ? 'Bağlantı kuruldu; model yalnızca düşünme (thinking) çıktısı verdi. Özet için daha yüksek çıktı tokenı gerekebilir.'
        : 'Bağlantı kuruldu; model bu kısa testte metin döndürmedi. Modeli yine de deneyebilirsiniz.';
    }
  } catch (error) {
    chatError = errorText(error);
  }

  if (!models.length && chatError) throw new LlmError(chatError);

  return {
    models,
    modelsError,
    reply: reply.slice(0, 200),
    chatError,
    warning,
    thinking,
    emptyReply,
  };
}

export async function describeImage(settings, { base64, mime, context }) {
  const model = settings.visionModel?.trim() || settings.model;
  const configured = Number(settings.maxTokens);
  const tokenLimit =
    Number.isFinite(configured) && configured > 0
      ? Math.min(Math.floor(configured), 1_000_000)
      : undefined;

  return chat(
    settings,
    [
      {
        role: 'system',
        content:
          'Görselleri Türkçe betimleyen titiz bir editörsün. Yalnızca görüneni anlat, tahmin etme. En fazla iki cümle yaz.',
      },
      {
        role: 'user',
        content: `Bu görseli, Ekşi Sözlük başlığı bağlamında kısaca betimle. Bağlam: ${context || 'başlık entry’si'}`,
      },
    ],
    {
      model,
      images: [base64],
      mime,
      maxTokens: tokenLimit,
      temperature: 0.2,
      timeoutMs: 120000,
    },
  );
}

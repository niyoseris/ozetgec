/** Özetgeç ayarlar sayfası. */

import { normalizeBaseUrl } from './lib/store.js';
import { chatEndpoint } from './lib/llm.js';

const el = (id) => document.getElementById(id);
let savedSettings = null;

function send(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: 'Yanıt yok.' });
      });
    } catch (error) {
      resolve({ ok: false, error: String(error?.message || error) });
    }
  });
}

const DECLARED_ORIGINS = chrome.runtime.getManifest().host_permissions || [];

function originPattern(rawUrl) {
  try {
    const url = new URL(normalizeBaseUrl(rawUrl));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

function isCovered(pattern) {
  if (!pattern) return false;
  return DECLARED_ORIGINS.some(
    (declared) =>
      declared === '*://*/*' ||
      declared === 'https://*/*' ||
      declared === 'http://*/*' ||
      declared === pattern,
  );
}

/**
 * Gerekiyorsa ana makine izni ister. Kullanıcı hareketi gerektirdiği için
 * tıklama işleyicisinin başında, senkron olarak çağrılmalıdır.
 */
function requestPermissionFor(rawUrl) {
  const pattern = originPattern(rawUrl);
  if (!pattern || isCovered(pattern)) return Promise.resolve(true);

  try {
    return chrome.permissions.request({ origins: [pattern] }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

function formValues() {
  const unlimited = el('unlimitedTokens').checked;
  const rawTokens = el('maxTokens').value.trim();
  const parsedTokens =
    rawTokens === ''
      ? 0
      : Math.max(0, Math.min(1_000_000, Number(rawTokens) || 0));

  return {
    provider: el('provider').value,
    baseUrl: normalizeBaseUrl(el('baseUrl').value),
    apiKey: el('apiKey').value.trim(),
    model: el('model').value.trim(),
    visionModel: el('visionModel').value.trim(),
    temperature: Number(el('temperature').value),
    maxTokens: unlimited ? 0 : parsedTokens,
    chunkChars: Number(el('chunkChars').value) || 24000,
    maxPages: Number(el('maxPages').value) || 10,
    autoFirstStage: el('autoFirstStage').checked,
    followIntervalMinutes: Number(el('followIntervalMinutes').value) || 30,
    notifications: el('notifications').checked,
    maxImages: Number(el('maxImages').value) || 8,
  };
}

function settingsSnapshot(values) {
  return JSON.stringify({
    provider: values.provider,
    baseUrl: normalizeBaseUrl(values.baseUrl),
    apiKey: values.apiKey,
    model: values.model,
    visionModel: values.visionModel,
    temperature: Number(values.temperature),
    maxTokens: Number(values.maxTokens),
    chunkChars: Number(values.chunkChars),
    maxPages: Number(values.maxPages),
    autoFirstStage: Boolean(values.autoFirstStage),
    followIntervalMinutes: Number(values.followIntervalMinutes),
    notifications: Boolean(values.notifications),
    maxImages: Number(values.maxImages),
  });
}

function isDirty(values) {
  if (!savedSettings) return false;
  return settingsSnapshot(values) !== settingsSnapshot(savedSettings);
}

function saveHint(values) {
  return isDirty(values) ? ' Bu ayarları kullanmak için Kaydet’e basın.' : '';
}

function updateDirtyStatus() {
  if (!savedSettings) return;

  const status = el('saveStatus');
  if (isDirty(formValues())) {
    if (!status.classList.contains('err')) {
      setSaveStatus('Kaydedilmemiş değişiklikler var. Kaydet’e basın.', 'warn');
    }
  } else if (/Kaydedilmemiş/.test(status.textContent)) {
    setSaveStatus('');
  }
}

function setSaveStatus(text, kind = '') {
  const node = el('saveStatus');
  node.textContent = text || '';
  node.className = `status${kind ? ` ${kind}` : ''}`;
}

function setConnStatus(text, kind = '') {
  const node = el('connStatus');
  node.textContent = text || '';
  node.className = `status${kind ? ` ${kind}` : ''}`;
}

function renderChip(settings) {
  const chip = el('modelChip');
  if (!settings?.model) {
    chip.textContent = 'model yok';
    return;
  }
  chip.textContent = settings.model;
  chip.title = `${settings.model} · ${
    settings.provider === 'openai' ? 'OpenAI uyumlu' : 'Ollama'
  }`;
}

function updateTempOutput() {
  el('tempOut').textContent = Number(el('temperature').value).toFixed(2);
}

function updateEndpointHint() {
  const node = el('endpointHint');
  if (!node) return;

  try {
    const endpoint = chatEndpoint({
      provider: el('provider').value,
      baseUrl: el('baseUrl').value,
    });
    node.textContent = `İstek adresi: ${endpoint}`;
  } catch {
    node.textContent = '';
  }
}

async function loadSettings() {
  const response = await send({ type: 'getSettingsFull' });
  if (!response.ok) {
    setSaveStatus(response.error || 'Ayarlar yüklenemedi.', 'err');
    return;
  }

  const settings = response.settings;

  el('provider').value = settings.provider || 'ollama';
  el('baseUrl').value = settings.baseUrl || 'https://ollama.com';
  el('apiKey').value = settings.apiKey || '';
  el('model').value = settings.model || '';
  el('visionModel').value = settings.visionModel || '';
  el('temperature').value = String(settings.temperature ?? 0.3);

  const tokenLimit = Number(settings.maxTokens ?? 3000);
  const tokenValue =
    Number.isFinite(tokenLimit) && tokenLimit > 0
      ? Math.min(Math.floor(tokenLimit), 1_000_000)
      : 0;
  el('maxTokens').value = String(tokenValue);
  el('unlimitedTokens').checked = tokenValue <= 0;
  el('maxTokens').disabled = el('unlimitedTokens').checked;

  el('chunkChars').value = String(settings.chunkChars ?? 24000);
  el('maxPages').value = String(settings.maxPages ?? 10);
  el('autoFirstStage').checked = settings.autoFirstStage !== false;
  el('followIntervalMinutes').value = String(settings.followIntervalMinutes ?? 30);
  el('notifications').checked = settings.notifications !== false;
  el('maxImages').value = String(settings.maxImages ?? 8);

  updateTempOutput();
  updateEndpointHint();
  renderChip(settings);
  savedSettings = { ...settings };
}

async function save(values, permissionPromise) {
  setSaveStatus('Kaydediliyor…');

  const granted = await permissionPromise;

  const response = await send({ type: 'saveSettings', settings: values });
  if (!response.ok) {
    setSaveStatus(`Kaydedilemedi: ${response.error}`, 'err');
    return;
  }

  renderChip(values);
  savedSettings = { ...values };

  if (!granted) {
    setSaveStatus(
      'Kaydedildi, ancak API adresi için izin verilmedi. İstekler engellenebilir.',
      'warn',
    );
  } else if (!values.model) {
    setSaveStatus('Kaydedildi, ancak model adı boş. Özet üretilemez.', 'warn');
  } else if (/ollama\.com/i.test(values.baseUrl) && !values.apiKey) {
    setSaveStatus('Kaydedildi, ancak Ollama Cloud için API anahtarı gerekli.', 'warn');
  } else {
    setSaveStatus('Kaydedildi.', 'ok');
  }
}

async function runTest(values, permissionPromise) {
  setConnStatus('Test ediliyor…');

  const granted = await permissionPromise;
  if (!granted) {
    setConnStatus('API adresi için izin verilmedi.', 'err');
    return;
  }

  const response = await send({ type: 'testConnection', settings: values });
  if (!response.ok) {
    setConnStatus(response.error || 'Bağlantı kurulamadı.', 'err');
    return;
  }

  const modelNote = response.models?.length
    ? `${response.models.length} model listelendi. `
    : response.modelsError
      ? 'Model listesi alınamadı ama sohbet çalışıyor. '
      : '';

  if (response.chatError) {
    setConnStatus(
      `${modelNote}Sohbet testi başarısız: ${response.chatError}${saveHint(values)}`,
      'err',
    );
    return;
  }

  if (response.warning) {
    setConnStatus(`${modelNote}${response.warning}${saveHint(values)}`, 'warn');
    return;
  }

  if (isDirty(values)) {
    setConnStatus(
      `${modelNote}Yanıt: ${response.reply || 'ok'}${saveHint(values)}`,
      'warn',
    );
    return;
  }

  setConnStatus(`${modelNote}Yanıt: ${response.reply || 'ok'}`, 'ok');
}

async function runModels(values, permissionPromise) {
  setConnStatus('Modeller getiriliyor…');

  const granted = await permissionPromise;
  if (!granted) {
    setConnStatus('API adresi için izin verilmedi.', 'err');
    return;
  }

  const response = await send({
    type: 'listModels',
    provider: values.provider,
    baseUrl: values.baseUrl,
    apiKey: values.apiKey,
  });

  if (!response.ok) {
    setConnStatus(response.error || 'Model listesi alınamadı.', 'err');
    return;
  }

  const list = el('modelList');
  list.textContent = '';
  for (const name of response.models) {
    const option = document.createElement('option');
    option.value = name;
    list.appendChild(option);
  }

  setConnStatus(
    `${response.models.length} model bulundu. Model alanına yazmaya başlayın.`,
    'ok',
  );
}

async function loadStats() {
  const response = await send({ type: 'storageStats' });
  if (!response.ok) {
    el('storageStats').textContent = 'Veri boyutu alınamadı.';
    return;
  }

  const mb = response.bytes / (1024 * 1024);
  const size =
    mb < 0.1 ? `${Math.round(response.bytes / 1024)} KB` : `${mb.toFixed(1)} MB`;

  el('storageStats').textContent = `${response.topics} başlık · ${response.entries} entry · ${size}`;
}

el('temperature').addEventListener('input', updateTempOutput);
el('baseUrl').addEventListener('input', updateEndpointHint);
el('provider').addEventListener('change', updateEndpointHint);

function syncTokenInput() {
  const unlimited = el('unlimitedTokens').checked;
  el('maxTokens').disabled = unlimited;

  if (unlimited) {
    el('maxTokens').value = '0';
  } else if (!Number(el('maxTokens').value)) {
    el('maxTokens').value = '3000';
  }

  updateDirtyStatus();
}

el('unlimitedTokens').addEventListener('change', syncTokenInput);

el('form').addEventListener('input', updateDirtyStatus);
el('form').addEventListener('change', updateDirtyStatus);

el('toggleKey').addEventListener('click', () => {
  const input = el('apiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  el('toggleKey').textContent = show ? 'Gizle' : 'Göster';
});

el('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const values = formValues();
  const permission = requestPermissionFor(values.baseUrl);
  void save(values, permission);
});

el('testBtn').addEventListener('click', () => {
  const values = formValues();
  const permission = requestPermissionFor(values.baseUrl);
  void runTest(values, permission);
});

el('modelsBtn').addEventListener('click', () => {
  const values = formValues();
  const permission = requestPermissionFor(values.baseUrl);
  void runModels(values, permission);
});

el('imagePermBtn').addEventListener('click', async () => {
  try {
    const granted = await chrome.permissions.request({
      origins: ['https://*/*', 'http://*/*'],
    });
    setSaveStatus(
      granted
        ? 'Görsel erişim izni verildi.'
        : 'Görsel erişim izni verilmedi; AI betimlemesi çalışmaz.',
      granted ? 'ok' : 'err',
    );
  } catch (error) {
    setSaveStatus(`İzin istenemedi: ${error?.message || error}`, 'err');
  }
});

el('clearBtn').addEventListener('click', async () => {
  const confirmed = confirm(
    'Tüm başlıklar, entry metinleri, özetler ve takipler silinsin mi? Ayarlar ve API anahtarı korunur.',
  );
  if (!confirmed) return;

  const response = await send({ type: 'clearTopics' });
  if (response.ok) {
    setSaveStatus('Tüm başlık verileri silindi.', 'ok');
    await loadStats();
  } else {
    setSaveStatus(`Silinemedi: ${response.error}`, 'err');
  }
});

loadSettings();
loadStats();

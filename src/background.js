/** Özetgeç service worker: analiz, aşamalar, takip, görsel betimleme. */

import {
  clearTopics,
  deleteTopic,
  getSettings,
  getTopic,
  isConfigured,
  listTopics,
  publicSettings,
  putTopic,
  saveSettings,
  saveTopic,
} from './lib/store.js';
import { fetchNewEntries, fetchTopicFull } from './lib/eksi.js';
import { generateStage, summarizeUpdates } from './lib/summarize.js';
import { STAGE_KEYS } from './lib/stages.js';
import {
  filterTopicEntries,
  normalizeRange,
  rangeWindow,
} from './lib/ranges.js';
import {
  describeImage,
  errorText,
  listModels,
  testConnection,
} from './lib/llm.js';

const FOLLOW_ALARM = 'ozetgec-follow-tick';
const TICK_MINUTES = 5;
const CONTEXT_ID = 'ozetgec-summarize';

const running = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let keepAliveTimer = null;
let followTickRunning = false;

/* ------------------------------------------------------------------ */
/* Mesaj yönlendirme                                                   */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'ozetgec-offscreen') return undefined;

  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: errorText(error) }));

  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'analyze':
      return analyze(message.input, message.range);

    case 'getTopic':
      return getTopicPayload(message.id, message.since);

    case 'getJob':
      return getJobPayload(message.id);

    case 'getTopics':
      return getTopicsPayload();

    case 'generateStage':
      return startStageJob(message.id, message.stage);

    case 'checkUpdates':
      return startCheckJob(message.id, true);

    case 'setFollow':
      return setFollow(message.id, message.enabled, message.intervalMinutes);

    case 'markSeen':
      return markSeen(message.id);

    case 'describeImages':
      return startImageJob(message.id);

    case 'deleteTopic':
      await deleteTopic(message.id);
      await ensureFollowAlarm();
      await refreshBadge();
      return { ok: true };

    case 'getSettingsFull': {
      const settings = await getSettings();
      return { ok: true, settings };
    }

    case 'saveSettings': {
      const settings = await saveSettings(message.settings || {});
      // Açık rapor sayfaları "API eksik" durumundan hemen çıksın.
      broadcast({ type: 'settings-changed' });
      return { ok: true, settings };
    }

    case 'testConnection': {
      const base = await getSettings();
      const settings = { ...base, ...(message.settings || {}) };
      const result = await testConnection(settings);
      return { ok: true, ...result };
    }

    case 'listModels': {
      const models = await listModels({
        provider: message.provider,
        baseUrl: message.baseUrl,
        apiKey: message.apiKey,
      });
      return { ok: true, models };
    }

    case 'storageStats':
      return storageStats();

    case 'clearTopics':
      await clearTopics();
      await ensureFollowAlarm();
      await refreshBadge();
      return { ok: true };

    case 'openReport':
      await openReport({
        id: message.id,
        input: message.input,
        range: message.range,
      });
      return { ok: true };

    default:
      throw new Error('Bilinmeyen istek.');
  }
}

async function getTopicPayload(id, since) {
  const topic = await getFreshTopic(id);
  if (!topic) return { ok: false, error: 'Başlık bulunamadı. Yeniden analiz edin.' };

  const settings = await getSettings();
  const configured = isConfigured(settings);

  // Ayarlar sonradan tamamlandıysa eski "config" hatası ekranda kalmasın;
  // otomatik ilk aşama da yeniden başlasın.
  let retryFirstStage = false;
  if (configured && topic.job?.kind === 'config') {
    topic.job = null;
    await putTopic(topic);
    retryFirstStage = true;
  }

  const publicConfig = {
    settings: publicSettings(settings),
    configured,
  };

  if (retryFirstStage && filterTopicEntries(topic).length) {
    startStageJob(topic.id, 'ozet');
  }

  // Raporun elindeki sürüm değişmediyse büyük entry listesini tekrar gönderme.
  if (since && Number(since) === Number(topic.updatedAt)) {
    return { ok: true, unchanged: true, ...publicConfig };
  }

  return {
    ok: true,
    topic: { ...topic, images: collectImages(topic.entries) },
    ...publicConfig,
  };
}

async function getJobPayload(id) {
  const topic = await getFreshTopic(id);
  if (!topic) return { ok: false, error: 'Başlık bulunamadı.' };

  return {
    ok: true,
    job: topic.job || null,
    updatedAt: topic.updatedAt,
  };
}

/** Başlığı okur; yarıda kalmış (uzun süredir ilerlemeyen) işi hatalı işaretler. */
async function getFreshTopic(id) {
  const topic = await getTopic(id);
  if (!topic) return null;

  if (topic.job?.status === 'running') {
    const lastTick = Number(topic.job.updatedAt || topic.job.startedAt || 0);
    if (lastTick && Date.now() - lastTick > 12 * 60 * 1000) {
      topic.job = {
        status: 'error',
        kind: topic.job.kind,
        stage: topic.job.stage || null,
        message: 'İşlem yarıda kaldı',
        error:
          'İşlem beklenenden uzun süredir yanıt vermiyor (service worker yeniden başlamış olabilir). Lütfen tekrar deneyin.',
        at: Date.now(),
      };
      await putTopic(topic);
    }
  }

  return topic;
}

async function getTopicsPayload() {
  const [topics, settings] = await Promise.all([listTopics(), getSettings()]);
  return {
    ok: true,
    topics,
    settings: publicSettings(settings),
    configured: isConfigured(settings),
  };
}

/* ------------------------------------------------------------------ */
/* Analiz                                                              */
/* ------------------------------------------------------------------ */

async function analyze(input, rangeKey) {
  const range = normalizeRange(rangeKey);
  const settings = await getSettings();
  startKeepAlive();

  try {
    broadcast({
      type: 'progress',
      input: String(input || ''),
      range,
      message: 'Ekşi Sözlük’e bağlanılıyor…',
    });

    const fetched = await fetchTopicFull(input, settings, (message) => {
      broadcast({ type: 'progress', input: String(input || ''), range, message });
    });

    if ([...running].some((key) => key.startsWith(`${fetched.id}:`))) {
      throw new Error(
        'Bu başlıkta çalışan bir işlem var. Bitmesini bekleyip tekrar deneyin.',
      );
    }

    const existing = await getTopic(fetched.id);
    const topic = mergeFetched(existing, fetched, settings, range);
    await putTopic(topic);

    broadcast({ type: 'analyzed', id: topic.id, range });

    const rangeEntries = filterTopicEntries(topic);

    if (!rangeEntries.length) {
      const fresh = await getTopic(topic.id);
      if (fresh) {
        fresh.job = {
          status: 'error',
          kind: 'range',
          message: 'Seçilen kapsam boş',
          error: `Seçilen kapsamda (${fresh.rangeLabel || '—'}) entry yok. Daha geniş bir kapsam seçin veya başlığı yenileyin.`,
          at: Date.now(),
        };
        await saveTopic(fresh);
      }
    } else if (settings.autoFirstStage) {
      if (isConfigured(settings)) {
        startStageJob(topic.id, 'ozet');
      } else {
        const fresh = await getTopic(topic.id);
        if (fresh) {
          fresh.job = {
            status: 'error',
            kind: 'config',
            message: 'API ayarları eksik',
            error:
              'Özet üretmek için Ayarlar’dan API adresini, API anahtarını ve model adını girin.',
            at: Date.now(),
          };
          await saveTopic(fresh);
        }
      }
    }

    await ensureFollowAlarm();
    await refreshBadge();

    return { ok: true, id: topic.id, warning: topic.warning || null };
  } finally {
    stopKeepAliveIfIdle();
  }
}

function mergeFetched(existing, fetched, settings, rangeKey) {
  const now = Date.now();
  const range = normalizeRange(rangeKey);
  const rangeInfo = rangeWindow(range, now);
  const previousRange = existing ? normalizeRange(existing.range) : null;
  const rangeChanged =
    !existing ||
    previousRange !== range ||
    (range !== 'all' && Number(existing.rangeFrom) !== Number(rangeInfo.start));

  const topic = existing
    ? { ...existing }
    : {
        createdAt: now,
        stages: {},
        updates: [],
        imageCaptions: {},
        follow: {
          enabled: false,
          intervalMinutes: Number(settings.followIntervalMinutes) || 30,
          unread: 0,
          lastCheckedAt: 0,
        },
      };

  Object.assign(topic, {
    id: fetched.id,
    slug: fetched.slug,
    url: fetched.url,
    title: fetched.title,
    entries: fetched.entries,
    entryCount: fetched.entryCount,
    totalPages: fetched.totalPages,
    fetchedPages: fetched.fetchedPages,
    truncated: fetched.truncated,
    warning: fetched.warning || null,
    snapshotAt: now,
    lastAnalysisAt: now,
    lastEntryId: fetched.lastEntryId,
    dateFrom: fetched.dateFrom,
    dateTo: fetched.dateTo,
    range,
    rangeAt: now,
    rangeFrom: rangeInfo.start,
    rangeTo: rangeInfo.end,
    rangeLabel: rangeInfo.label,
    job: null,
  });

  if (rangeChanged) topic.stages = {};
  else topic.stages = topic.stages || {};

  topic.updates = topic.updates || [];
  topic.imageCaptions = topic.imageCaptions || {};
  topic.follow = {
    enabled: false,
    intervalMinutes: Number(settings.followIntervalMinutes) || 30,
    unread: 0,
    lastCheckedAt: 0,
    ...(existing?.follow || {}),
  };

  // Yeni snapshot baz alınır; eski entry'ler takip sırasında "yeni" sayılmasın.
  if (topic.follow.enabled) topic.follow.lastCheckedAt = now;

  return topic;
}

/* ------------------------------------------------------------------ */
/* Aşamalar                                                            */
/* ------------------------------------------------------------------ */

function startStageJob(id, stageKey) {
  if (!STAGE_KEYS.includes(stageKey)) throw new Error('Bilinmeyen özet aşaması.');

  if ([...running].some((key) => key.startsWith(`${id}:stage:`))) {
    return { ok: false, error: 'Bu başlıkta başka bir aşama zaten çalışıyor.' };
  }
  if ([...running].some((key) => key.startsWith(`${id}:check`) || key.startsWith(`${id}:vision`))) {
    return { ok: false, error: 'Bu başlıkta başka bir işlem sürüyor; bitmesini bekleyin.' };
  }

  const runKey = `${id}:stage:${stageKey}`;
  running.add(runKey);
  startKeepAlive();

  (async () => {
    try {
      const topic = await getTopic(id);
      if (!topic) throw new Error('Başlık bulunamadı.');

      const settings = await getSettings();
      if (!isConfigured(settings)) {
        throw new Error(
          'API ayarları eksik. Ayarlar’dan API adresini, API anahtarını ve model adını girin.',
        );
      }

      const rangeEntries = filterTopicEntries(topic);
      if (!rangeEntries.length) {
        throw new Error(
          `Seçilen kapsamda (${topic.rangeLabel || '—'}) entry yok. Daha geniş bir kapsam seçin veya başlığı yenileyin.`,
        );
      }

      await setJob(id, {
        status: 'running',
        kind: 'stage',
        stage: stageKey,
        message: 'Hazırlanıyor…',
        startedAt: Date.now(),
      });

      const markdown = await generateStage(topic, stageKey, settings, (message) =>
        setJobMessage(id, message),
      );

      const fresh = await getTopic(id);
      if (!fresh) throw new Error('Başlık kaydı bulunamadı.');

      fresh.stages = fresh.stages || {};
      fresh.stages[stageKey] = {
        markdown,
        model: settings.model,
        createdAt: Date.now(),
        snapshotAt: fresh.snapshotAt,
        entryCount: filterTopicEntries(fresh).length,
      };
      fresh.job = null;
      await putTopic(fresh);

      broadcast({ type: 'job-done', id, kind: 'stage', stage: stageKey });
    } catch (error) {
      await failJob(id, error, 'stage', stageKey);
      broadcast({ type: 'job-error', id, kind: 'stage', stage: stageKey, error: errorText(error) });
    } finally {
      running.delete(runKey);
      stopKeepAliveIfIdle();
    }
  })();

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Takip ve yeni gelişmeler                                            */
/* ------------------------------------------------------------------ */

function startCheckJob(id, manual) {
  const runKey = `${id}:check`;

  if (running.has(runKey)) return { ok: false, error: 'Kontrol zaten çalışıyor.' };
  if ([...running].some((key) => key.startsWith(`${id}:stage:`) || key.startsWith(`${id}:vision`))) {
    return { ok: false, error: 'Önce sürmekte olan özet işleminin bitmesini bekleyin.' };
  }

  running.add(runKey);
  startKeepAlive();

  (async () => {
    try {
      await runCheck(id, manual);
    } catch (error) {
      console.warn('[özetgeç] kontrol hatası:', error);
    } finally {
      running.delete(runKey);
      stopKeepAliveIfIdle();
    }
  })();

  return { ok: true };
}

async function runCheck(id, manual) {
  const topic = await getTopic(id);
  if (!topic) throw new Error('Başlık bulunamadı.');

  const settings = await getSettings();

  await setJob(id, {
    status: 'running',
    kind: 'check',
    message: 'Yeni entry’ler kontrol ediliyor…',
    startedAt: Date.now(),
  });

  try {
    const result = await fetchNewEntries(topic, settings, (message) =>
      setJobMessage(id, message),
    );

    const fresh = await getTopic(id);
    if (!fresh) throw new Error('Başlık kaydı bulunamadı.');

    fresh.totalPages = Math.max(
      Number(fresh.totalPages) || 0,
      Number(result.totalPages) || 0,
    );

    const now = Date.now();
    const intervalMinutes = clamp(
      Number(fresh.follow?.intervalMinutes) || 30,
      5,
      1440,
    );
    const newEntries = result.newEntries || [];

    if (newEntries.length) {
      await setJobMessage(id, `${newEntries.length} yeni entry bulundu; özetleniyor…`);

      let markdown = null;
      let summaryError = null;

      if (isConfigured(settings)) {
        try {
          markdown = await summarizeUpdates({
            topic: fresh,
            newEntries,
            settings,
            onProgress: (message) => setJobMessage(id, message),
          });
        } catch (error) {
          summaryError = errorText(error);
        }
      } else {
        summaryError =
          'API ayarları eksik olduğu için yeni entry’ler özetlenemedi. Ayarlar’dan API bilgilerini girin.';
      }

      const previousShown = (fresh.entries || []).length;
      const previousTotal = Number(fresh.entryCount) || previousShown;
      const merged = mergeEntryLists(fresh.entries || [], newEntries);
      const estimatedTotal =
        previousTotal > previousShown ? previousTotal + newEntries.length : merged.length;

      fresh.entries = merged;
      fresh.entryCount = Math.max(
        Number(result.entryCount) || 0,
        estimatedTotal,
        merged.length,
        previousTotal,
      );
      fresh.lastEntryId = maxEntryId(merged);
      fresh.dateFrom = merged[0]?.date || fresh.dateFrom;
      fresh.dateTo = merged[merged.length - 1]?.date || fresh.dateTo;
      fresh.title = result.title || fresh.title;

      fresh.updates = [
        {
          at: now,
          entryIds: newEntries.map((entry) => String(entry.id)),
          markdown,
          error: summaryError,
          model: settings.model,
          newCount: newEntries.length,
        },
        ...(fresh.updates || []),
      ].slice(0, 50);

      fresh.follow = {
        ...(fresh.follow || {}),
        unread: manual ? 0 : (fresh.follow?.unread || 0) + 1,
        lastCheckedAt: now,
        nextCheckAt: now + intervalMinutes * 60000,
      };
      fresh.job = null;
      await putTopic(fresh);

      if (!manual && settings.notifications) {
        notifyNewEntries(fresh, newEntries.length, Boolean(markdown));
      }
    } else {
      fresh.entryCount = Math.max(
        Number(result.entryCount) || 0,
        Number(fresh.entryCount) || 0,
        (fresh.entries || []).length,
      );
      fresh.follow = {
        ...(fresh.follow || {}),
        lastCheckedAt: now,
        nextCheckAt: now + intervalMinutes * 60000,
      };
      fresh.job = null;
      await putTopic(fresh);
    }

    await refreshBadge();
    broadcast({ type: 'job-done', id, kind: 'check' });
  } catch (error) {
    await failJob(id, error, 'check');
    broadcast({ type: 'job-error', id, kind: 'check', error: errorText(error) });
    throw error;
  }
}

async function setFollow(id, enabled, intervalMinutes) {
  const topic = await getTopic(id);
  if (!topic) throw new Error('Başlık bulunamadı.');

  const settings = await getSettings();
  const interval = clamp(
    Number(intervalMinutes) || Number(topic.follow?.intervalMinutes) || 30,
    5,
    1440,
  );

  const follow = {
    ...(topic.follow || {}),
    enabled: Boolean(enabled),
    intervalMinutes: interval,
  };

  if (follow.enabled) {
    if (!follow.lastCheckedAt) follow.lastCheckedAt = Date.now();
    follow.nextCheckAt = follow.lastCheckedAt + interval * 60000;
  }

  topic.follow = follow;
  await putTopic(topic);
  await ensureFollowAlarm();
  await refreshBadge();

  return { ok: true, follow };
}

async function markSeen(id) {
  const topic = await getTopic(id);
  if (!topic) return { ok: false, error: 'Başlık bulunamadı.' };

  if (!topic.follow?.unread) return { ok: true };

  topic.follow = { ...(topic.follow || {}), unread: 0 };
  await putTopic(topic);
  await refreshBadge();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Görsel betimleme (opsiyonel, görsel destekli model)                 */
/* ------------------------------------------------------------------ */

function startImageJob(id) {
  const runKey = `${id}:vision`;

  if (running.has(runKey)) return { ok: false, error: 'Görsel betimlemesi zaten çalışıyor.' };
  if ([...running].some((key) => key.startsWith(`${id}:stage:`) || key.startsWith(`${id}:check`))) {
    return { ok: false, error: 'Başka bir işlem sürüyor; bitmesini bekleyin.' };
  }

  running.add(runKey);
  startKeepAlive();

  (async () => {
    try {
      await runImageCaptions(id);
    } catch (error) {
      await failJob(id, error, 'vision');
      broadcast({ type: 'job-error', id, kind: 'vision', error: errorText(error) });
    } finally {
      running.delete(runKey);
      stopKeepAliveIfIdle();
    }
  })();

  return { ok: true };
}

async function runImageCaptions(id) {
  const topic = await getTopic(id);
  if (!topic) throw new Error('Başlık bulunamadı.');

  const settings = await getSettings();
  if (!isConfigured(settings)) {
    throw new Error('API ayarları eksik. Görsel betimlemesi için Ayarlar’ı doldurun.');
  }

  const allImages = collectImages(filterTopicEntries(topic));
  const pending = allImages
    .filter((image) => !topic.imageCaptions?.[image.url]?.caption)
    .slice(0, clamp(Number(settings.maxImages) || 8, 1, 20));

  if (!pending.length) {
    throw new Error('Betimlenecek yeni görsel yok. (Tüm görseller betimlenmiş ya da hiç görsel yok.)');
  }

  await setJob(id, {
    status: 'running',
    kind: 'vision',
    message: `0/${pending.length} görsel betimleniyor…`,
    startedAt: Date.now(),
  });

  let success = 0;
  let failures = 0;
  let lastError = null;

  for (let index = 0; index < pending.length; index += 1) {
    const image = pending[index];
    await setJobMessage(id, `${index + 1}/${pending.length} görsel betimleniyor…`);

    try {
      const bytes = await fetchImageBytes(image.url);
      const caption = await describeImage(settings, {
        base64: bytes.base64,
        mime: bytes.mime,
        context: `${topic.title} — ${image.author || 'yazar'}`,
      });

      const fresh = await getTopic(id);
      if (!fresh) throw new Error('Başlık kaydı bulunamadı.');
      fresh.imageCaptions = fresh.imageCaptions || {};
      fresh.imageCaptions[image.url] = {
        caption,
        model: settings.visionModel || settings.model,
        at: Date.now(),
      };
      await saveTopic(fresh);
      success += 1;
    } catch (error) {
      failures += 1;
      lastError = errorText(error);

      const fresh = await getTopic(id);
      if (fresh) {
        fresh.imageCaptions = fresh.imageCaptions || {};
        fresh.imageCaptions[image.url] = { error: lastError, at: Date.now() };
        await saveTopic(fresh);
      }

      if (failures >= 2) break;
    }
  }

  const fresh = await getTopic(id);
  if (fresh) {
    fresh.job = null;
    await putTopic(fresh);
  }

  if (success) broadcast({ type: 'job-done', id, kind: 'vision' });

  if (!success) {
    throw new Error(
      lastError ||
        'Görseller betimlenemedi. Modelin görsel desteği olduğundan ve görsel sunucusuna izin verildiğinden emin olun.',
    );
  }
}

async function fetchImageBytes(url) {
  if (!/^https?:/i.test(url)) throw new Error('Görsel adresi desteklenmiyor.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      credentials: 'omit',
      signal: controller.signal,
      cache: 'force-cache',
    });

    if (!response.ok) throw new Error(`Görsel indirilemedi (HTTP ${response.status}).`);

    const mimeHeader = (response.headers.get('content-type') || '').split(';')[0].trim();
    const mime = mimeHeader.startsWith('image/') ? mimeHeader : guessImageMime(url);
    if (!mime) {
      throw new Error(`Adres görsel döndürmedi (${mimeHeader || 'bilinmeyen tür'}).`);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 4_500_000) throw new Error('Görsel çok büyük (4,5 MB üstü).');

    return { base64: arrayBufferToBase64(buffer), mime };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Görsel indirme zaman aşımına uğradı.');
    const message = errorText(error);
    if (/Failed to fetch|NetworkError|fetch/i.test(message)) {
      const permission = new Error(
        'Görsel indirilemedi. Görsel sunucusu için izin verilmemiş olabilir (Ayarlar > Görseller > Görsel erişim izni ver).',
      );
      permission.cause = error;
      throw permission;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function guessImageMime(url) {
  const clean = String(url || '').split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.gif')) return 'image/gif';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.avif')) return 'image/avif';
  if (clean.endsWith('.bmp')) return 'image/bmp';
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  return null;
}

function collectImages(entries) {
  const map = new Map();
  for (const entry of entries || []) {
    for (const url of entry.images || []) {
      if (!map.has(url)) {
        map.set(url, {
          url,
          entryId: entry.id,
          author: entry.author,
          date: entry.date,
          dateText: entry.dateText,
          entryUrl: entry.url,
        });
      }
    }
  }
  return [...map.values()];
}

/* ------------------------------------------------------------------ */
/* İş durumu yardımcıları                                              */
/* ------------------------------------------------------------------ */

async function setJob(id, job) {
  const topic = await getTopic(id);
  if (!topic) return null;
  topic.job = job;
  await saveTopic(topic);
  return topic;
}

async function setJobMessage(id, message) {
  const topic = await getTopic(id);
  if (!topic?.job || topic.job.status !== 'running') return;
  topic.job.message = message;
  topic.job.updatedAt = Date.now();
  await saveTopic(topic);
}

async function failJob(id, error, kind, stage) {
  const topic = await getTopic(id);
  if (!topic) return;
  const message = errorText(error);
  topic.job = {
    status: 'error',
    kind,
    stage: stage || null,
    message,
    error: message,
    at: Date.now(),
  };
  await putTopic(topic);
}

/* ------------------------------------------------------------------ */
/* Alarm, rozet, bildirim                                              */
/* ------------------------------------------------------------------ */

async function ensureFollowAlarm() {
  const index = await listTopics();
  const hasFollowed = index.some((topic) => topic.followEnabled);

  if (hasFollowed) {
    await chrome.alarms.create(FOLLOW_ALARM, {
      periodInMinutes: TICK_MINUTES,
      delayInMinutes: 1,
    });
  } else {
    await chrome.alarms.clear(FOLLOW_ALARM);
  }
}

async function runFollowTick() {
  if (followTickRunning) return;
  followTickRunning = true;
  startKeepAlive();

  try {
    const index = await listTopics();
    const now = Date.now();

    for (const meta of index) {
      if (!meta.followEnabled) continue;

      const topic = await getTopic(meta.id);
      if (!topic?.follow?.enabled) continue;

      const interval = clamp(Number(topic.follow.intervalMinutes) || 30, 5, 1440) * 60000;
      if (now - (topic.follow.lastCheckedAt || 0) < interval) continue;
      if ([...running].some((key) => key.startsWith(`${topic.id}:`))) continue;

      const runKey = `${topic.id}:check`;
      running.add(runKey);

      try {
        await runCheck(topic.id, false);
      } catch (error) {
        console.warn('[özetgeç] takip kontrolü başarısız:', topic.id, errorText(error));
      } finally {
        running.delete(runKey);
      }

      await sleep(1200);
    }
  } finally {
    followTickRunning = false;
    stopKeepAliveIfIdle();
  }
}

async function refreshBadge() {
  const index = await listTopics();
  const unread = index.reduce((sum, topic) => sum + (Number(topic.unread) || 0), 0);
  const text = unread > 0 ? (unread > 99 ? '99+' : String(unread)) : '';

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#2f6b45' });
}

function notifyNewEntries(topic, count, summarized) {
  try {
    chrome.notifications.create(`topic:${topic.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: topic.title,
      message: summarized
        ? `${count} yeni entry özetlendi. Raporu açmak için tıklayın.`
        : `${count} yeni entry var; özet alınamadı. Raporu açmak için tıklayın.`,
      priority: 1,
    }).catch(() => {});
  } catch {
    /* bildirim izni yoksa sessiz geç */
  }
}

/* ------------------------------------------------------------------ */
/* Rapor / bağlam menüsü                                               */
/* ------------------------------------------------------------------ */

function reportPageUrl({ id, input, range }) {
  const url = new URL(chrome.runtime.getURL('src/report.html'));
  if (id) url.searchParams.set('id', id);
  if (input) url.searchParams.set('url', input);
  if (range && range !== 'all') url.searchParams.set('range', range);
  return url.href;
}

async function openReport({ id, input, range }) {
  await chrome.tabs.create({ url: reportPageUrl({ id, input, range }) });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_ID) return;

  const linkIsEksi =
    info.linkUrl && /^https:\/\/([^/]+\.)?eksisozluk\.com\//i.test(info.linkUrl);
  const target = (linkIsEksi ? info.linkUrl : '') || info.pageUrl || tab?.url || '';

  if (target) openReport({ input: target }).catch(() => {});
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith('topic:')) return;
  const id = notificationId.slice('topic:'.length);
  openReport({ id }).catch(() => {});
  chrome.notifications.clear(notificationId).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FOLLOW_ALARM) runFollowTick().catch(() => {});
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: CONTEXT_ID,
        title: 'Özetgeç ile özetle',
        contexts: ['page', 'link'],
        documentUrlPatterns: [
          'https://eksisozluk.com/*',
          'https://*.eksisozluk.com/*',
        ],
      },
      () => void chrome.runtime.lastError,
    );
  });

  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => {});
  }

  ensureFollowAlarm().catch(() => {});
  refreshBadge().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureFollowAlarm().catch(() => {});
  refreshBadge().catch(() => {});
});

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

function broadcast(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    /* açık rapor sayfası yoksa yok say */
  }
}

function mergeEntryLists(existing, incoming) {
  const map = new Map();
  for (const entry of [...(existing || []), ...(incoming || [])]) {
    if (entry?.id) map.set(String(entry.id), entry);
  }
  return [...map.values()].sort(compareEntries);
}

function compareEntries(a, b) {
  const timeA = a.date ? Date.parse(a.date) : NaN;
  const timeB = b.date ? Date.parse(b.date) : NaN;
  if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
    return timeA - timeB;
  }
  return (Number(a.id) || 0) - (Number(b.id) || 0);
}

function maxEntryId(entries) {
  let max = 0;
  for (const entry of entries) {
    const id = Number(entry.id);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return String(max);
}

async function storageStats() {
  const [bytes, index] = await Promise.all([
    chrome.storage.local.getBytesInUse(null),
    listTopics(),
  ]);

  return {
    ok: true,
    bytes,
    topics: index.length,
    entries: index.reduce((sum, topic) => sum + (Number(topic.entryCount) || 0), 0),
  };
}

function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo(() => {});
    } catch {
      /* yok say */
    }
  }, 20000);
}

function stopKeepAliveIfIdle() {
  if (running.size > 0 || followTickRunning) return;
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

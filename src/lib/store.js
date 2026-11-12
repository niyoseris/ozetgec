/** chrome.storage.local üzerinde ayarlar, başlık kayıtları ve dizin. */

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'ollama',
  baseUrl: 'https://ollama.com',
  apiKey: '',
  model: 'gpt-oss:120b-cloud',
  visionModel: '',
  temperature: 0.3,
  maxTokens: 3000,
  chunkChars: 24000,
  maxPages: 10,
  autoFirstStage: true,
  followIntervalMinutes: 30,
  notifications: true,
  maxImages: 8,
});

export async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

export async function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ settings: merged });
  return merged;
}

/** API anahtarını sayfalara göndermeden ayarların özeti. */
export function publicSettings(settings) {
  const { apiKey, ...rest } = settings || {};
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

export function normalizeBaseUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) return 'https://ollama.com';

  if (!/^https?:\/\//i.test(value)) {
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(value);
    value = `${local ? 'http' : 'https'}://${value}`;
  }

  return value.replace(/\/+$/, '');
}

export function isConfigured(settings) {
  if (!settings?.model) return false;
  let host = '';
  try {
    host = new URL(normalizeBaseUrl(settings.baseUrl)).hostname;
  } catch {
    return false;
  }
  const local = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  const ollamaCloud = /(^|\.)ollama\.com$/i.test(host);
  if (ollamaCloud && !settings.apiKey) return false;
  // Diğer sağlayıcılarda anahtar zorunlu değil; sunucu kendi kararını verir.
  return Boolean(local || settings.apiKey || !ollamaCloud);
}

export function makeTopicId(slug) {
  const cleaned = String(slug || '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '-');
  return cleaned || 'baslik';
}

export async function getTopic(id) {
  if (!id) return null;
  const key = `topic:${id}`;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

/** Yalnızca topic kaydını yazar (dizini güncellemez) — ilerleme mesajları için. */
export async function saveTopic(topic) {
  topic.updatedAt = Date.now();
  await chrome.storage.local.set({ [`topic:${topic.id}`]: topic });
}

export async function putTopic(topic) {
  await saveTopic(topic);
  await upsertIndex(topic);
}

async function upsertIndex(topic) {
  return enqueueIndex(async () => {
    const { topicIndex = [] } = await chrome.storage.local.get('topicIndex');
    const meta = {
      id: topic.id,
      slug: topic.slug,
      title: topic.title,
      url: topic.url,
      entryCount: topic.entryCount,
      updatedAt: topic.updatedAt,
      snapshotAt: topic.snapshotAt,
      followEnabled: Boolean(topic.follow?.enabled),
      unread: topic.follow?.unread || 0,
      lastCheckedAt: topic.follow?.lastCheckedAt || null,
      stageCount: Object.values(topic.stages || {}).filter((stage) => stage?.markdown).length,
    };
    const next = [meta, ...topicIndex.filter((item) => item.id !== topic.id)].sort(
      (a, b) =>
        Number(b.followEnabled) - Number(a.followEnabled) ||
        (b.updatedAt || 0) - (a.updatedAt || 0),
    );
    await chrome.storage.local.set({ topicIndex: next });
  });
}

let indexQueue = Promise.resolve();

function enqueueIndex(task) {
  const next = indexQueue.then(task, task);
  indexQueue = next.catch(() => {});
  return next;
}

export async function listTopics() {
  const { topicIndex = [] } = await chrome.storage.local.get('topicIndex');
  return topicIndex;
}

export async function listTopicRecords() {
  const index = await listTopics();
  if (!index.length) return [];
  const keys = index.map((item) => `topic:${item.id}`);
  const data = await chrome.storage.local.get(keys);
  return keys.map((key) => data[key]).filter(Boolean);
}

export async function deleteTopic(id) {
  await chrome.storage.local.remove(`topic:${id}`);
  await enqueueIndex(async () => {
    const { topicIndex = [] } = await chrome.storage.local.get('topicIndex');
    await chrome.storage.local.set({
      topicIndex: topicIndex.filter((item) => item.id !== id),
    });
  });
}

export async function clearTopics() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(
    (key) => key.startsWith('topic:') || key === 'topicIndex',
  );
  if (keys.length) await chrome.storage.local.remove(keys);
}

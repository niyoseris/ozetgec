/**
 * Ekşi Sözlük'ten başlık sayfalarını indirme, sayfalama ve offscreen
 * dokümanı üzerinden ayrıştırma.
 */

import { makeTopicId } from './store.js';

// Ekşi Sözlük başlık sayfalarında sayfa başına 100 entry gösteriliyor.
// Sayfa sayısı pager'ın data-pagecount değerinden okunur; bu sabit yalnızca
// toplam entry sayısını tahmin etmek için kullanılır.
const PAGE_SIZE = 100;

let offscreenPromise = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizeInput(raw) {
  let value = String(raw || '').trim();
  if (!value) throw new Error('Bir başlık bağlantısı veya slug girin.');

  if (!/^https?:\/\//i.test(value)) {
    if (/\s/.test(value)) {
      throw new Error(
        'Başlık adı yerine başlık sayfasının adresini yapıştırın. Örnek: https://eksisozluk.com/baslik-slug',
      );
    }
    if (/(^|\.)eksisozluk\.com/i.test(value)) {
      value = `https://${value}`;
    } else {
      value = `https://eksisozluk.com/${value.replace(/^\/+/, '')}`;
    }
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Adres anlaşılamadı. Örnek: https://eksisozluk.com/baslik-slug');
  }

  if (!/(^|\.)eksisozluk\.com$/i.test(url.hostname)) {
    throw new Error('Yalnızca eksisozluk.com adresleri destekleniyor.');
  }

  url.protocol = 'https:';
  url.hash = '';
  return url.href;
}

export async function fetchTopicFull(input, settings, onProgress = () => {}) {
  const session = createTabSession();

  try {
    let pageUrl = stripPageParam(normalizeInput(input));

    if (isEntryUrl(pageUrl)) {
      onProgress('Entry sayfası başlığa çevriliyor…');
      const entryHtml = await fetchHtml(pageUrl, session);
      let parsed = await parseWithOffscreen('entry', entryHtml.html, pageUrl);

      if (!parsed.ok && entryHtml.via === 'direct' && !session.preferTab) {
        try {
          const viaTab = await fetchViaTab(pageUrl, session);
          if (viaTab?.ok && viaTab.html) {
            const reparsed = await parseWithOffscreen('entry', viaTab.html, pageUrl);
            if (reparsed.ok) {
              parsed = reparsed;
              session.preferTab = true;
            }
          }
        } catch {
          /* aşağıdaki hata mesajına düşer */
        }
      }

      if (!parsed.ok) throw new Error(parsed.error);
      pageUrl = stripPageParam(parsed.topicUrl);
    }

    onProgress('Sayfa 1 okunuyor…');
    const first = await fetchPage(pageUrl, session);

    const canonical = first.canonicalUrl || pageUrl;
    const slug = topicSlug(canonical) || topicSlug(pageUrl) || 'baslik';
    const topicUrl = canonicalTopicUrl(canonical, slug);

    const actualPages = Math.max(first.maxPage || 1, estimatePages(first.entryCount));
    const cap = clamp(Number(settings.maxPages) || 10, 1, 60);

    const collected = new Map();
    addEntries(collected, first.entries);

    const pageNumbers = [];
    let lastPageEntryCount = first.entries.length;

    if (actualPages <= cap) {
      // Başlığın tamamı sığıyor: eskiden yeniye bütün sayfalar.
      for (let page = 2; page <= actualPages; page += 1) pageNumbers.push(page);
    } else {
      // Çok uzun başlıklarda en yeni sayfalardan geriye doğru al. İlk sayfa
      // (başlığın tanımı / eski bağlam) yukarıda zaten alındı.
      const start = Math.max(2, actualPages - cap + 1);
      for (let page = start; page <= actualPages; page += 1) pageNumbers.push(page);
    }

    for (const page of pageNumbers) {
      onProgress(`Sayfa ${page}/${actualPages} okunuyor…`, page, actualPages);
      await sleep(250 + Math.floor(Math.random() * 250));
      try {
        const parsed = await fetchPage(withPageParam(pageUrl, page), session);
        addEntries(collected, parsed.entries);
        if (!first.entryCount && parsed.entryCount) first.entryCount = parsed.entryCount;
        if (page === actualPages) lastPageEntryCount = parsed.entries.length;
        if (!parsed.entries.length && page < actualPages) break;
      } catch (error) {
        if (/404|bulunamadı/i.test(error.message) && page > 1) break;
        throw error;
      }
    }

    const entries = [...collected.values()].sort(compareEntries);
    if (!entries.length) {
      throw new Error('Bu başlıkta okunabilir entry bulunamadı.');
    }

    const firstFetchedPage = pageNumbers[0] || actualPages;
    const truncated = actualPages > cap && firstFetchedPage > 2;
    const entryCount = truncated
      ? (actualPages - 1) * PAGE_SIZE + lastPageEntryCount
      : entries.length;
    const fetchedPages = 1 + pageNumbers.length;

    return {
      ok: true,
      id: makeTopicId(slug),
      slug,
      url: topicUrl,
      title: first.title || slug,
      entries,
      entryCount,
      totalPages: actualPages,
      fetchedPages,
      truncated,
      warning: truncated
        ? `Başlık ${actualPages} sayfa. En yeni ${pageNumbers.length} sayfa ve ilk sayfa alındı (${entries.length} entry). Tamamı için Ayarlar > Sayfa sınırı değerini artırın.`
        : null,
      lastEntryId: maxEntryId(entries),
      dateFrom: entries[0]?.date || null,
      dateTo: entries[entries.length - 1]?.date || null,
    };
  } finally {
    await closeTabSession(session);
  }
}

/** Takip kontrolü: son sayfalardan geriye doğru yalnızca yeni entry'leri toplar. */
export async function fetchNewEntries(topic, settings, onProgress = () => {}) {
  const session = createTabSession();

  try {
    onProgress('Yeni entry’ler kontrol ediliyor…');

    const known = new Set((topic.entries || []).map((entry) => String(entry.id)));
    const boundary = Number(topic.lastEntryId) || 0;
    const storedPages = Math.max(0, Number(topic.totalPages) || 0);

    let anchorPage = storedPages > 0 ? storedPages : 1;
    let first = await fetchPage(withPageParam(topic.url, anchorPage), session);
    let actualPages = Math.max(first.maxPage || anchorPage, anchorPage);

    // Saklanan son sayfa boş döndüyse (başlık küçülmüş / sayfa taşınmışsa)
    // sayfa 1'den gerçek sayıyı yeniden öğren.
    if (!first.entries.length) {
      const pageOne = await fetchPage(withPageParam(topic.url, 1), session);
      if (pageOne.entries.length) {
        anchorPage = 1;
        first = pageOne;
        actualPages = Math.max(pageOne.maxPage || 1, 1);
      }
    }

    const pagesToScan = [];

    if (storedPages > 0) {
      // Son sayfa ve yeni açılmış sayfalar; sınırı yakalamak için eski son sayfa.
      const from = Math.max(1, actualPages - 9);
      for (let page = actualPages; page >= from; page -= 1) pagesToScan.push(page);
      if (!pagesToScan.includes(anchorPage)) pagesToScan.push(anchorPage);
    } else {
      // Eski kayıtlarda toplam sayfa yok; son 10 sayfayı tara.
      const scanCount = Math.min(actualPages, 10);
      for (
        let page = actualPages;
        page >= Math.max(1, actualPages - scanCount + 1);
        page -= 1
      ) {
        pagesToScan.push(page);
      }
    }

    const found = new Map();

    for (const page of pagesToScan) {
      const parsed =
        page === anchorPage
          ? first
          : await fetchPage(withPageParam(topic.url, page), session);
      const pageEntries = parsed.entries || [];

      const unknown = pageEntries.filter(
        (entry) =>
          !known.has(String(entry.id)) &&
          (boundary <= 0 || (Number(entry.id) || 0) > boundary),
      );
      for (const entry of unknown) found.set(String(entry.id), entry);

      if (!unknown.length) break;
      if (unknown.length < pageEntries.length) break;
      if (page > 1) await sleep(250);
    }

    const newEntries = [...found.values()].sort(compareEntries);

    return {
      ok: true,
      newEntries,
      entryCount: Math.max(first.entryCount || 0, known.size + newEntries.length),
      totalPages: actualPages,
      title: first.title || topic.title,
      canonicalUrl: first.canonicalUrl || topic.url,
    };
  } finally {
    await closeTabSession(session);
  }
}

/* ------------------------------------------------------------------ */
/* Sayfa indirme                                                       */
/* ------------------------------------------------------------------ */

async function fetchPage(url, session) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await fetchHtml(url, session);
      let parsed = await parseWithOffscreen('topic', result.html, url);

      // Doğrudan indirme 200 döndürüp giriş/boş sayfa döndürdüyse bir de
      // gerçek tarayıcı sekmesinden (çerezlerle) deneyelim.
      if (!parsed.ok && result.via === 'direct' && !session.preferTab) {
        try {
          const viaTab = await fetchViaTab(url, session);
          if (viaTab?.ok && viaTab.html) {
            const reparsed = await parseWithOffscreen('topic', viaTab.html, url);
            if (reparsed.ok) {
              session.preferTab = true;
              return reparsed;
            }
          }
        } catch {
          /* aşağıdaki hata mesajına düşer */
        }
      }

      if (!parsed.ok) {
        const error = new Error(parsed.error);
        error.retryable = Boolean(parsed.retryable);
        throw error;
      }
      return parsed;
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === 1) break;
      await sleep(1500);
    }
  }

  throw lastError || new Error('Sayfa okunamadı.');
}

async function fetchHtml(url, session) {
  // Bir kez sekme yedeğine geçildiyse sonraki sayfalarda doğrudan sekmeyi kullan.
  if (session?.preferTab) {
    try {
      const viaTab = await fetchViaTab(url, session);
      if (viaTab?.ok && viaTab.html && !isChallenge(viaTab.html)) {
        return { ok: true, status: viaTab.status, html: viaTab.html, via: 'tab' };
      }
    } catch {
      /* doğrudan indirmeyi dene */
    }
  }

  let direct = null;
  try {
    direct = await directFetch(url);
  } catch (error) {
    direct = { ok: false, status: 0, html: '', error: String(error?.message || error) };
  }

  if (direct.ok && !isChallenge(direct.html)) return direct;

  if (direct.status === 429 || direct.status === 503) {
    await sleep(1200);
    try {
      direct = await directFetch(url);
    } catch {
      /* aşağıdaki hata mesajına düşer */
    }
    if (direct.ok && !isChallenge(direct.html)) return direct;
  }

  let viaTab = null;
  try {
    viaTab = await fetchViaTab(url, session);
  } catch (error) {
    viaTab = { ok: false, status: 0, html: '', error: String(error?.message || error) };
  }

  if (viaTab?.ok && viaTab.html && !isChallenge(viaTab.html)) {
    if (session) session.preferTab = true;
    return { ok: true, status: viaTab.status, html: viaTab.html, via: 'tab' };
  }

  if (direct.status === 404 || viaTab?.status === 404) {
    const error = new Error(
      'Başlık bulunamadı (404). Başlığın tam adresini yapıştırdığınızdan emin olun.',
    );
    error.retryable = false;
    throw error;
  }

  if (isChallenge(direct.html) || isChallenge(viaTab?.html)) {
    const error = new Error(
      'Ekşi Sözlük, Cloudflare doğrulaması istiyor. Tarayıcıda eksisozluk.com’u açıp doğrulamayı geçin (giriş yapmanız da gerekebilir), sonra tekrar deneyin.',
    );
    error.retryable = false;
    throw error;
  }

  const status = direct.status || viaTab?.status || 0;

  if (status === 401 || status === 403) {
    const error = new Error(
      'Ekşi Sözlük erişimi reddedildi. Tarayıcıda giriş yapmış olduğunuzdan emin olun; gerekirse başlığı bir sekmede açıp tekrar deneyin.',
    );
    error.retryable = false;
    throw error;
  }

  if (status === 429) {
    const error = new Error(
      'Ekşi Sözlük istek sınırı (429). Bir süre bekleyip tekrar deneyin; sayfa sınırını da düşürebilirsiniz.',
    );
    error.retryable = true;
    throw error;
  }

  const detail = direct.error || viaTab?.error || `HTTP ${status || 'yok'}`;
  const error = new Error(`Ekşi Sözlük sayfası alınamadı: ${detail}`);
  error.retryable = status >= 500 || status === 0;
  throw error;
}

async function directFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const html = await response.text();
    return { ok: response.ok, status: response.status, html, via: 'direct' };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('İstek zaman aşımına uğradı (30 sn).');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Sekme üzerinden yedek indirme (Cloudflare / CORS sorunları için)     */
/* ------------------------------------------------------------------ */

function createTabSession() {
  return { tabId: null, created: false, preferTab: false };
}

async function fetchViaTab(url, session) {
  const tabId = await ensureEksiTab(session);

  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (targetUrl) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(targetUrl, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        return {
          ok: response.ok,
          status: response.status,
          html: await response.text(),
          via: 'tab',
        };
      } catch (error) {
        return { ok: false, status: 0, html: '', error: String(error?.message || error) };
      } finally {
        clearTimeout(timer);
      }
    },
    args: [url],
  });

  return injections?.[0]?.result || { ok: false, status: 0, html: '', error: 'Sekme okunamadı.' };
}

async function ensureEksiTab(session) {
  if (session.tabId) {
    try {
      await chrome.tabs.get(session.tabId);
      return session.tabId;
    } catch {
      session.tabId = null;
      session.created = false;
    }
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({
      url: ['https://eksisozluk.com/*', 'https://*.eksisozluk.com/*'],
    });
  } catch {
    tabs = [];
  }

  const existing = tabs.find((tab) => tab.status === 'complete') || tabs.find((tab) => tab.id);
  if (existing?.id) {
    session.tabId = existing.id;
    session.created = false;
    return existing.id;
  }

  const tab = await chrome.tabs.create({ url: 'https://eksisozluk.com/', active: false });
  session.tabId = tab.id;
  session.created = true;

  try {
    await waitForTabComplete(tab.id, 25000);
  } catch {
    /* yine de enjeksiyon denenir */
  }

  return tab.id;
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Sekme zamanında yüklenmedi.'));
    }, timeoutMs);

    const onUpdated = (updatedId, info) => {
      if (updatedId === tabId && info.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') {
          cleanup();
          resolve();
        }
      })
      .catch(() => {
        cleanup();
        reject(new Error('Sekme bulunamadı.'));
      });
  });
}

async function closeTabSession(session) {
  if (!session?.created || !session.tabId) return;
  try {
    await chrome.tabs.remove(session.tabId);
  } catch {
    /* zaten kapanmış olabilir */
  }
  session.tabId = null;
  session.created = false;
}

/* ------------------------------------------------------------------ */
/* Offscreen ayrıştırıcı köprüsü                                       */
/* ------------------------------------------------------------------ */

async function parseWithOffscreen(kind, html, url) {
  await ensureOffscreen();

  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage({
        target: 'ozetgec-offscreen',
        kind,
        html,
        url,
      });
      if (response) return response;
      lastError = new Error('HTML ayrıştırıcı yanıt vermedi.');
    } catch (error) {
      lastError = error;
    }

    await sleep(180);
  }

  throw lastError || new Error('HTML ayrıştırıcı yanıt vermedi.');
}

async function ensureOffscreen() {
  if (!chrome.offscreen) {
    throw new Error('Bu tarayıcı sürümü offscreen API’sini desteklemiyor.');
  }

  if (typeof chrome.offscreen.hasDocument === 'function') {
    if (await chrome.offscreen.hasDocument()) return;
  }

  if (!offscreenPromise) {
    offscreenPromise = chrome.offscreen
      .createDocument({
        url: chrome.runtime.getURL('src/offscreen.html'),
        reasons: ['DOM_PARSER'],
        justification: 'Ekşi Sözlük HTML sayfalarını ayrıştırmak için.',
      })
      .catch((error) => {
        if (!/single offscreen/i.test(String(error?.message || error))) throw error;
      })
      .finally(() => {
        offscreenPromise = null;
      });
  }

  await offscreenPromise;
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

function isChallenge(html) {
  if (!html) return false;
  return (
    /Just a moment\.\.\./i.test(html) ||
    html.includes('challenges.cloudflare.com') ||
    /cf-challenge/i.test(html)
  );
}

function isEntryUrl(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[0] === 'entry';
  } catch {
    return false;
  }
}

function stripPageParam(url) {
  try {
    const parsed = new URL(url);
    // Sıralama (a=popular vb.) ve sayfa parametrelerini at; bütün sayfalar
    // aynı varsayılan (kronolojik) sırayla okunmalı.
    parsed.search = '';
    return parsed.href;
  } catch {
    return url;
  }
}

function withPageParam(url, page) {
  const parsed = new URL(url);
  parsed.searchParams.set('p', String(page));
  return parsed.href;
}

function topicSlug(url) {
  try {
    const first = new URL(url).pathname.split('/').filter(Boolean)[0] || '';
    return decodeURIComponent(first).replace(/--\d+$/, '');
  } catch {
    return '';
  }
}

function canonicalTopicUrl(canonical, slug) {
  try {
    const parsed = new URL(canonical);
    if (parsed.pathname.split('/').filter(Boolean)[0] !== 'entry') {
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    }
  } catch {
    /* aşağıda kurulur */
  }
  return `https://eksisozluk.com/${encodeURI(slug)}`;
}

function estimatePages(entryCount) {
  if (!entryCount || !Number.isFinite(entryCount)) return 1;
  return Math.max(1, Math.ceil(entryCount / PAGE_SIZE));
}

function addEntries(map, entries) {
  for (const entry of entries || []) {
    if (entry?.id) map.set(String(entry.id), entry);
  }
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

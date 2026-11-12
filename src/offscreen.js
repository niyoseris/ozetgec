/**
 * Offscreen document: HTML ayrıştırma.
 * Service worker'da DOMParser yok; Ekşi Sözlük sayfaları burada çözümlenir.
 */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'TABLE', 'TR', 'SECTION', 'ARTICLE', 'PRE', 'FIGURE',
]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'ozetgec-offscreen') return undefined;

  try {
    if (message.kind === 'topic') {
      sendResponse(parseTopic(message.html, message.url));
    } else if (message.kind === 'entry') {
      sendResponse(parseEntry(message.html, message.url));
    } else {
      sendResponse({ ok: false, error: 'Bilinmeyen ayrıştırma türü.' });
    }
  } catch (error) {
    sendResponse({ ok: false, error: String(error?.message || error) });
  }
  return undefined;
});

function isChallenge(html) {
  return (
    /Just a moment\.\.\./i.test(html) ||
    html.includes('challenges.cloudflare.com') ||
    /cf-challenge/i.test(html)
  );
}

function isLoginWall(doc) {
  return Boolean(
    doc.querySelector('form[action*="login"], form[action*="giris"], #login-form, .login-form'),
  );
}

function parseTopic(html, baseUrl) {
  if (isChallenge(html)) {
    return {
      ok: false,
      error:
        'Ekşi Sözlük, Cloudflare doğrulaması istiyor. Tarayıcıda eksisozluk.com’u açıp doğrulamayı geçin (giriş yapmanız da gerekebilir), sonra tekrar deneyin.',
    };
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const titleEl = doc.querySelector('h1#title, h1.title');

  // Ekşi'de entry'ler <ul id="entry-item-list"> içindeki doğrudan <li> çocuklarıdır.
  let contentNodes = [...doc.querySelectorAll('#entry-item-list > li')];
  if (!contentNodes.length) contentNodes = [...doc.querySelectorAll('li[data-id]')];

  if (!contentNodes.length) {
    if (isLoginWall(doc)) {
      return {
        ok: false,
        error:
          'Entry’ler görünmüyor. Tarayıcıda Ekşi Sözlük’e giriş yapın ve tekrar deneyin.',
      };
    }
    return {
      ok: false,
      error:
        'Bu sayfada entry listesi bulunamadı. Bir başlık adresi kullandığınızdan emin olun.',
    };
  }

  const dataTitle = titleEl?.getAttribute('data-title');
  let title = (
    dataTitle ||
    titleEl?.textContent ||
    doc.title.replace(/\s*[-–]\s*Ekşi Sözlük.*$/i, '') ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();

  let entryCount = null;
  if (!dataTitle) {
    const countFromTitle = title.match(/\(([\d.,]+)\)\s*$/);
    if (countFromTitle) {
      entryCount = Number(countFromTitle[1].replace(/\D/g, '')) || null;
      title = title.replace(/\s*\([\d.,]+\)\s*$/, '').trim();
    }
  }
  if (!entryCount) {
    const countText = doc.querySelector('.entry-count, #entry-count')?.textContent || '';
    entryCount = Number(countText.replace(/\D/g, '')) || null;
  }

  const canonicalRaw = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
  let canonicalUrl = '';
  if (canonicalRaw) {
    try {
      const canonical = new URL(canonicalRaw, baseUrl);
      canonical.search = '';
      canonical.hash = '';
      canonicalUrl = canonical.href;
    } catch {
      canonicalUrl = '';
    }
  }

  let maxPage = 1;
  const pageCountAttr =
    doc.querySelector('.pager[data-pagecount]')?.getAttribute('data-pagecount') ||
    doc.querySelector('[data-pagecount]')?.getAttribute('data-pagecount') ||
    '';
  if (pageCountAttr && Number.isFinite(Number(pageCountAttr))) {
    maxPage = Math.max(maxPage, Number(pageCountAttr));
  } else {
    for (const anchor of doc.querySelectorAll('a[href*="p="]')) {
      let value = null;
      const dataPage = anchor.getAttribute('data-page');
      if (dataPage && Number.isFinite(Number(dataPage))) value = Number(dataPage);
      if (!value) {
        try {
          value = Number(new URL(anchor.getAttribute('href'), baseUrl).searchParams.get('p'));
        } catch {
          value = NaN;
        }
      }
      if (Number.isFinite(value) && value > maxPage) maxPage = value;
    }
  }

  const seen = new Set();
  const entries = [];

  for (const node of contentNodes) {
    const id = node.getAttribute('data-id') || node.querySelector('[data-id]')?.getAttribute('data-id');
    if (!id || seen.has(String(id))) continue;
    seen.add(String(id));

    const contentEl =
      node.querySelector('.content') ||
      node.querySelector('.entry-content') ||
      node.querySelector('[class*="content"]');

    const dateText =
      node.querySelector('a.entry-date, .entry-date, time')?.textContent?.replace(/\s+/g, ' ').trim() ||
      '';

    let date = node.getAttribute('data-date') || '';
    if (!date || Number.isNaN(Date.parse(date))) {
      date = dateFromText(dateText) || '';
    }

    const favoriteRaw = node.getAttribute('data-favorite-count') || '';
    const favorites = Number(favoriteRaw.replace(/\D/g, '')) || 0;

    const images = contentEl ? imageUrls(contentEl, baseUrl) : [];
    const text = contentEl ? contentText(contentEl) : '';

    if (!text && !images.length) continue;

    entries.push({
      id: String(id),
      author: node.getAttribute('data-author') || 'yazar',
      date: date || null,
      dateText: dateText || (date ? formatDateTR(date) : ''),
      favorites,
      text,
      images,
      url: `https://eksisozluk.com/entry/${id}`,
    });
  }

  return {
    ok: true,
    title: title || 'Başlık',
    entryCount,
    maxPage,
    canonicalUrl,
    entries,
  };
}

function parseEntry(html, baseUrl) {
  if (isChallenge(html)) {
    return {
      ok: false,
      error:
        'Ekşi Sözlük, Cloudflare doğrulaması istiyor. Tarayıcıda doğrulamayı geçip tekrar deneyin.',
    };
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const titleEl = doc.querySelector('h1#title, h1.title');
  const anchor = titleEl?.querySelector('a[href]');
  if (!anchor) {
    return {
      ok: false,
      error: 'Entry sayfasından başlık bağlantısı çıkarılamadı. Başlık adresini doğrudan yapıştırın.',
    };
  }

  let topicUrl;
  try {
    const url = new URL(anchor.getAttribute('href'), baseUrl);
    url.search = '';
    url.hash = '';
    topicUrl = url.href;
  } catch {
    return { ok: false, error: 'Başlık bağlantısı geçersiz.' };
  }

  const title = (titleEl.textContent || '').replace(/\s*\(\d[\d.,]*\)\s*$/, '').trim();
  return { ok: true, topicUrl, title };
}

function imageUrls(contentEl, baseUrl) {
  const found = new Set();

  for (const img of contentEl.querySelectorAll('img')) {
    const raw =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('src') ||
      '';
    const resolved = resolveImage(raw, baseUrl);
    if (resolved) found.add(resolved);
  }

  for (const anchor of contentEl.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') || '';
    if (IMAGE_EXT.test(href)) {
      const resolved = resolveImage(href, baseUrl);
      if (resolved) found.add(resolved);
    }
  }

  return [...found].slice(0, 30);
}

function resolveImage(raw, baseUrl) {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.startsWith('blob:') || value.startsWith('javascript:')) return null;
  if (value.startsWith('data:')) {
    return value.startsWith('data:image/') && value.length > 500 ? value : null;
  }
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function contentText(contentEl) {
  const clone = contentEl.cloneNode(true);
  clone
    .querySelectorAll('script, style, noscript, iframe, svg, video, audio')
    .forEach((node) => node.remove());

  clone.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  clone.querySelectorAll('img').forEach((node) => node.replaceWith(' [görsel] '));

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    let text = '';
    for (const child of node.childNodes) text += walk(child);

    if (BLOCK_TAGS.has(node.tagName)) text += '\n\n';
    return text;
  };

  return walk(clone)
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dateFromText(text) {
  const match = String(text || '').match(
    /(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/,
  );
  if (!match) return null;
  const [, d, m, y, hh = '0', mm = '0'] = match;
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDateTR(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

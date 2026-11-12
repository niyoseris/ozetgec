/** Ekşi Sözlük sayfalarına "Özet geç" düğmesi ve kapsam menüsü ekler. */

(() => {
  'use strict';

  // Yalnızca üst pencere; reklam/iframe'lerde düğme oluşturma.
  if (window.top !== window) return;

  const TAG = 'ozetgec-button';

  const RANGE_CHOICES = [
    { key: 'all', label: 'Tüm başlık', note: 'Bütün entry’ler' },
    { key: 'today', label: 'Bugün', note: 'Bugünkü entry’ler' },
    { key: '3d', label: 'Son 3 gün', note: 'Son 3 günün entry’leri' },
    { key: '7d', label: 'Son 7 gün', note: 'Son 7 günün entry’leri' },
  ];

  const FULL_CSS = `
    :host { all: initial; }
    .wrap { position: relative; display: inline-flex; }
    button.trigger {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 28px;
      padding: 0 10px 0 8px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 999px;
      background: #2f6b45;
      color: #fffdf7;
      font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
      transition: filter 0.15s ease, transform 0.05s ease, opacity 0.15s ease;
    }
    button.trigger:hover { filter: brightness(1.08); }
    button.trigger:active { transform: translateY(1px); }
    button.trigger:disabled { cursor: default; opacity: 0.65; }
    .badge {
      display: grid;
      place-items: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #f6efdd;
      color: #1c3a2a;
      font: 700 11px/1 Georgia, serif;
    }
    .label { white-space: nowrap; }
    .caret { margin-left: 1px; font-size: 9px; opacity: 0.8; }
    .menu {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 214px;
      padding: 6px;
      border: 1px solid #ddd8c9;
      border-radius: 12px;
      background: #fffdf7;
      color: #1d241f;
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.18);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    }
    .menu[hidden] { display: none; }
    .menu button.item {
      all: unset;
      box-sizing: border-box;
      display: block;
      width: 100%;
      padding: 7px 9px;
      border-radius: 8px;
      color: #1d241f;
      font: 600 12px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      cursor: pointer;
    }
    .menu button.item:hover { background: #e3efe4; }
    .menu .note {
      display: block;
      margin-top: 2px;
      color: #667069;
      font-size: 10.5px;
      font-weight: 400;
    }
    :host-context(.dark-theme) .menu {
      border-color: #2e3931;
      background: #1a201c;
      color: #e7ece6;
    }
    :host-context(.dark-theme) .menu button.item { color: #e7ece6; }
    :host-context(.dark-theme) .menu button.item:hover { background: #22352a; }
    :host-context(.dark-theme) .menu .note { color: #9aa69c; }
  `;

  const COMPACT_CSS = `
    :host { all: initial; }
    button {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 1px solid #2f6b45;
      border-radius: 50%;
      background: #2f6b45;
      color: #fffdf7;
      font: 700 11px/1 Georgia, serif;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transform: scale(0.92);
      transition: opacity 0.15s ease, transform 0.15s ease, filter 0.15s ease;
    }
    button:hover { filter: brightness(1.1); }
    button:focus {
      opacity: 1;
      pointer-events: auto;
      transform: scale(1);
    }
    :host-context(li:hover) button {
      opacity: 1;
      pointer-events: auto;
      transform: scale(1);
    }
    :host-context(.dark-theme) button {
      border-color: #8fd2a2;
      background: #22352a;
      color: #8fd2a2;
    }
    @media (hover: none) {
      button { opacity: 0.75; pointer-events: auto; transform: none; }
    }
  `;

  function cleanTopicUrl(raw) {
    try {
      const url = new URL(raw, location.origin);
      if (!/(^|\.)eksisozluk\.com$/i.test(url.hostname)) return null;
      const path = url.pathname.replace(/^\/+|\/+$/g, '');
      if (!path) return null;
      url.search = '';
      url.hash = '';
      return url.href;
    } catch {
      return null;
    }
  }

  function topicUrlFromAnchor(anchor) {
    try {
      const url = new URL(anchor.getAttribute('href'), location.origin);
      if (!/(^|\.)eksisozluk\.com$/i.test(url.hostname)) return null;

      const path = url.pathname.replace(/^\/+|\/+$/g, '');
      if (!path || path.includes('/')) return null;
      if (
        /^(basliklar|giris|kayit|mesaj|olay|biri|ayarlar|bildirimler|istatistik)$/i.test(
          path,
        )
      ) {
        return null;
      }

      url.search = '';
      url.hash = '';
      return url.href;
    } catch {
      return null;
    }
  }

  function topicUrlFromPage() {
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    if (canonical) {
      const cleaned = cleanTopicUrl(canonical);
      if (cleaned && !/\/entry\/\d+/i.test(new URL(cleaned).pathname)) return cleaned;
    }

    const link = document.querySelector('h1#title a[href]');
    if (link) {
      const cleaned = cleanTopicUrl(link.getAttribute('href'));
      if (cleaned) return cleaned;
    }

    return cleanTopicUrl(location.href);
  }

  function makeFullHost(url) {
    const host = document.createElement(TAG);
    host.dataset.ozetgec = 'title';
    host.dataset.url = url;
    host.style.cssText =
      'all:initial;display:flex;width:max-content;margin:7px 0 3px;line-height:1;';

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = FULL_CSS;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'trigger';
    trigger.title = 'Özet geç';
    trigger.setAttribute('aria-label', 'Özet geç');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'ö';
    badge.setAttribute('aria-hidden', 'true');
    trigger.appendChild(badge);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Özet geç';
    trigger.appendChild(label);

    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '▾';
    caret.setAttribute('aria-hidden', 'true');
    trigger.appendChild(caret);

    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    const closeMenu = () => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    };

    for (const choice of RANGE_CHOICES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'item';
      item.dataset.range = choice.key;
      item.setAttribute('role', 'menuitem');
      item.textContent = choice.label;

      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = choice.note;
      item.appendChild(note);

      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        openReport(url, choice.key, trigger, label, false);
      });

      menu.appendChild(item);
    }

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = menu.hidden;
      menu.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', String(willOpen));
    });

    host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    document.addEventListener(
      'click',
      (event) => {
        if (menu.hidden) return;
        if (!event.composedPath().includes(host)) closeMenu();
      },
      true,
    );

    wrap.append(trigger, menu);
    root.append(style, wrap);
    return host;
  }

  function makeCompactHost(url) {
    const host = document.createElement(TAG);
    host.dataset.ozetgec = 'list';
    host.dataset.url = url;
    host.style.cssText =
      'all:initial;position:absolute;right:2px;top:50%;transform:translateY(-50%);display:inline-flex;line-height:1;z-index:3;';

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = COMPACT_CSS;

    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Özet geç (tüm başlık)';
    button.setAttribute('aria-label', 'Özet geç');

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'ö';
    badge.setAttribute('aria-hidden', 'true');
    button.appendChild(badge);

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openReport(url, 'all', button, null, true);
    });

    root.append(style, button);
    return host;
  }

  function openReport(url, range, button, label, compact) {
    if (!url || button.disabled) return;

    const originalLabel = label?.textContent || '';
    button.disabled = true;
    if (compact) button.title = 'Açılıyor…';
    else if (label) label.textContent = 'Açılıyor…';

    let finished = false;
    const finish = (ok, message) => {
      if (finished) return;
      finished = true;

      if (compact) {
        button.title = ok ? 'Rapor açıldı' : message || 'Açılamadı';
      } else if (label) {
        label.textContent = ok ? 'Açıldı' : 'Açılamadı';
      }

      setTimeout(
        () => {
          if (compact) button.title = 'Özet geç (tüm başlık)';
          else if (label) label.textContent = originalLabel;
          button.disabled = false;
        },
        ok ? 1200 : 2200,
      );
    };

    const timeout = setTimeout(() => finish(false, 'Yanıt yok'), 5000);

    try {
      chrome.runtime.sendMessage(
        { type: 'openReport', input: url, range },
        (response) => {
          clearTimeout(timeout);
          const error = chrome.runtime.lastError;
          const ok = !error && Boolean(response?.ok);
          finish(ok, error?.message || response?.error);
        },
      );
    } catch (error) {
      clearTimeout(timeout);
      finish(false, error?.message || 'Uzantıyı yenileyin');
    }
  }

  function addTitleButton() {
    const title = document.querySelector('h1#title');
    if (!title) return;

    // Başlık sayfası mı? Başlık listesi / kullanıcı sayfası vs. değil.
    if (!title.closest('#topic') && !document.querySelector('#entry-item-list')) return;

    const url = topicUrlFromPage();
    if (!url) return;

    const existing = document.querySelector(`${TAG}[data-ozetgec="title"]`);
    if (existing) {
      if (existing.dataset.url === url) return;
      existing.remove();
    }

    title.insertAdjacentElement('afterend', makeFullHost(url));
  }

  function addListButtons() {
    for (const anchor of document.querySelectorAll('ul.topic-list > li > a[href]')) {
      const url = topicUrlFromAnchor(anchor);
      if (!url) continue;

      const item = anchor.closest('li');
      if (!item) continue;

      const existing = item.querySelector(`${TAG}[data-ozetgec="list"]`);
      if (existing) {
        if (existing.dataset.url === url) continue;
        existing.remove();
      }

      const host = makeCompactHost(url);
      if (getComputedStyle(item).position === 'static') item.style.position = 'relative';
      item.appendChild(host);
    }
  }

  function scan() {
    if (!document.body) return;
    addTitleButton();
    addListButtons();
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan();
    }, 200);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

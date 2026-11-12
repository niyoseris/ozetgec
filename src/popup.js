/** Özetgeç araç çubuğu menüsü. */

const el = (id) => document.getElementById(id);

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

function reportUrl(params = {}) {
  const url = new URL(chrome.runtime.getURL('src/report.html'));
  if (params.id) url.searchParams.set('id', params.id);
  if (params.input) url.searchParams.set('url', params.input);
  if (params.range && params.range !== 'all') url.searchParams.set('range', params.range);
  return url.href;
}

function openReport(params) {
  chrome.tabs.create({ url: reportUrl(params) });
  window.close();
}

function renderChip(settings) {
  const chip = el('modelChip');
  const model = settings?.model || 'model yok';
  chip.textContent = model;
  chip.title = `${model} · ${settings?.provider === 'openai' ? 'OpenAI uyumlu' : 'Ollama'}`;
}

function renderRecent(topics) {
  const list = el('recentList');
  const empty = el('recentEmpty');
  list.textContent = '';

  el('topicCount').textContent = topics?.length ? String(topics.length) : '';
  el('topicCount').classList.toggle('hidden', !topics?.length);

  if (!topics?.length) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  for (const topic of topics.slice(0, 6)) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.id = topic.id;

    if (topic.unread) {
      const dot = document.createElement('span');
      dot.className = 'unread-dot';
      dot.title = 'Yeni gelişme var';
      button.appendChild(dot);
    }

    const title = document.createElement('span');
    title.className = 'recent-title';
    title.textContent = topic.title || topic.slug || topic.id;
    button.appendChild(title);

    const meta = document.createElement('span');
    meta.className = 'recent-meta';
    meta.textContent = `${topic.entryCount || 0} entry`;
    button.appendChild(meta);

    li.appendChild(button);
    list.appendChild(li);
  }
}

async function prefillActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const url = new URL(tab.url);
    if (!/(^|\.)eksisozluk\.com$/i.test(url.hostname)) return;

    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!path || path.startsWith('basliklar') || path === 'giris' || path === 'kayit') return;
    if (path.includes('/') && !path.startsWith('entry/')) return;

    el('input').value = tab.url;
  } catch {
    /* sekme okunamadı */
  }
}

async function init() {
  await prefillActiveTab();

  const response = await send({ type: 'getTopics' });
  if (!response.ok) {
    el('hint').textContent = response.error || 'Durum alınamadı.';
    return;
  }

  renderChip(response.settings);
  renderRecent(response.topics || []);

  if (!response.configured) {
    el('hint').textContent =
      'API ayarları eksik. Ayarlar’dan API adresini, anahtarı ve modeli girin.';
  }
}

el('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = el('input').value.trim();
  if (!value) {
    el('input').focus();
    return;
  }
  openReport({ input: value, range: el('rangeSelect').value });
});

el('recentList').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-id]');
  if (button) openReport({ id: button.dataset.id });
});

el('allBtn').addEventListener('click', () => openReport());

el('optionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init();

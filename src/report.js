/** Özetgeç rapor sayfası: aşamalar, gelişmeler, görseller ve entry dökümü. */

import { STAGES, nextStage, stageInfo } from './lib/stages.js';
import {
  RANGE_OPTIONS,
  filterTopicEntries,
  normalizeRange,
} from './lib/ranges.js';

const el = (id) => document.getElementById(id);

const state = {
  id: null,
  topic: null,
  settings: null,
  topics: [],
  configured: true,
  query: '',
  analyzing: false,
  rangeBusy: false,
  lastSig: '',
  timer: null,
};

const INTERVAL_OPTIONS = [15, 30, 60, 180, 360, 720, 1440];

let noticeTimer = null;
let searchTimer = null;

/* ------------------------------------------------------------------ */
/* Başlatma                                                            */
/* ------------------------------------------------------------------ */

async function init() {
  bindEvents();

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const input = params.get('url') || params.get('input');
  const range = normalizeRange(params.get('range'));

  await loadTopics();

  if (id) {
    await loadTopic(id);
  } else if (input) {
    el('analyzeInput').value = input;
    el('heroRange').value = range;
    await startAnalyze(input, range);
  } else {
    setView(false);
    renderRecentHero();
    el('analyzeInput').focus();
  }
}

function bindEvents() {
  el('analyzeForm').addEventListener('submit', (event) => {
    event.preventDefault();
    void startAnalyze(el('analyzeInput').value, el('heroRange').value);
  });

  el('newBtn').addEventListener('click', resetToHero);
  el('heroBtn').addEventListener('click', resetToHero);

  el('optionsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  el('lightboxClose').addEventListener('click', () => el('lightbox').close());
  el('lightbox').addEventListener('click', (event) => {
    if (event.target === el('lightbox')) el('lightbox').close();
  });

  document.addEventListener('click', onDocumentClick);
  document.addEventListener('change', onDocumentChange);
  document.addEventListener('input', onDocumentInput);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (state.id) {
      void refreshTopic(true);
      void send({ type: 'markSeen', id: state.id }).then(() => loadTopics());
    } else {
      void loadTopics();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    void onRuntimeMessage(message);
  });
}

async function onRuntimeMessage(message) {
  if (!message) return;

  if (message.type === 'settings-changed') {
    if (state.id) void refreshTopic(true);
    void loadTopics();
    return;
  }

  if (message.type === 'progress' && state.rangeBusy) {
    showNotice(message.message || 'Kapsam değiştiriliyor…', 'info');
    return;
  }

  if (message.type === 'progress' && state.analyzing) {
    setAnalyzeText(message.message || 'Çalışıyor…');
    return;
  }

  if (
    (message.type === 'job-done' || message.type === 'job-error') &&
    message.id === state.id
  ) {
    await refreshTopic(true);
    void loadTopics();

    if (
      message.type === 'job-done' &&
      message.kind === 'check' &&
      document.visibilityState === 'visible'
    ) {
      void send({ type: 'markSeen', id: state.id }).then(() => loadTopics());
    }
  }
}

function onDocumentClick(event) {
  const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
  if (!target) return;

  const action = target.dataset.action;

  switch (action) {
    case 'generate':
      void generateStage(target.dataset.stage);
      break;
    case 'jump':
      jumpToStage(target.dataset.stage);
      break;
    case 'jump-updates':
      el('updatesPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    case 'check':
    case 'retry-check':
      void checkNow();
      break;
    case 'captions':
    case 'retry-vision':
      void describeImages();
      break;
    case 'retry-stage':
      void generateStage(target.dataset.stage);
      break;
    case 'open-image':
      openLightbox(target.dataset.url);
      break;
    case 'expand':
      toggleEntry(target);
      break;
    case 'switch':
      switchTopic(target.dataset.id);
      break;
    case 'settings':
      chrome.runtime.openOptionsPage();
      break;
    default:
      break;
  }
}

function onDocumentChange(event) {
  const target = event.target;

  if (target.id === 'followToggle') {
    void setFollow(target.checked, state.topic?.follow?.intervalMinutes);
  } else if (target.id === 'followInterval') {
    void setFollow(Boolean(state.topic?.follow?.enabled), Number(target.value));
  } else if (target.id === 'rangeSelect') {
    void changeRange(target.value);
  }
}

function onDocumentInput(event) {
  if (event.target.id !== 'entrySearch') return;
  state.query = event.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderEntryList, 110);
}

/* ------------------------------------------------------------------ */
/* Veri yükleme                                                        */
/* ------------------------------------------------------------------ */

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

async function loadTopics() {
  const response = await send({ type: 'getTopics' });
  if (!response.ok) return;

  state.topics = response.topics || [];
  state.settings = response.settings || state.settings;
  state.configured = Boolean(response.configured);

  renderModelChip();
  renderTopicList();
  renderRecentHero();

  if (!state.topic) setView(false);
}

async function loadTopic(id) {
  state.id = id;
  state.topic = null;
  state.rangeBusy = false;
  state.lastSig = '';

  const response = await send({ type: 'getTopic', id });
  if (!response.ok) {
    state.id = null;
    state.topic = null;
    setView(false);
    showNotice(response.error || 'Başlık yüklenemedi.', 'err');
    return;
  }

  state.topic = response.topic;
  state.settings = response.settings;
  state.configured = Boolean(response.configured);
  state.lastSig = signatureOf(response.topic);

  setView(true);
  renderAll();
  schedulePoll();

  void loadTopics();
  void send({ type: 'markSeen', id }).then(() => loadTopics());
  setTimeout(() => void refreshTopic(), 1400);
}

async function refreshTopic(force = false) {
  if (!state.id) return;

  const response = await send({
    type: 'getTopic',
    id: state.id,
    since: state.topic?.updatedAt,
  });

  if (!response.ok) {
    if (
      /context invalidated|message port closed|receiving end does not exist/i.test(
        response.error || '',
      )
    ) {
      showNotice('Uzantı yeniden yüklendi ya da kapatıldı. Sayfayı yenileyin.', 'err');
      return;
    }

    if (/bulunamadı/i.test(response.error || '')) {
      state.id = null;
      state.topic = null;
      setView(false);
      await loadTopics();
      showNotice(response.error || 'Başlık bulunamadı.', 'err');
    }
    schedulePoll();
    return;
  }

  if (response.unchanged) {
    const wasConfigured = state.configured;
    state.settings = response.settings || state.settings;
    state.configured = Boolean(response.configured);

    renderModelChip();
    if (wasConfigured !== state.configured) {
      renderStages();
      renderFollow();
    }

    schedulePoll();
    return;
  }

  const signature = signatureOf(response.topic);
  if (force || signature !== state.lastSig) {
    state.topic = response.topic;
    state.settings = response.settings;
    state.configured = Boolean(response.configured);
    state.lastSig = signature;
    renderAll();
  }

  schedulePoll();
}

function schedulePoll() {
  clearTimeout(state.timer);
  state.timer = null;
  if (!state.id) return;

  const running = state.topic?.job?.status === 'running';
  const delay = document.hidden ? 15000 : running ? 1200 : 5000;

  state.timer = setTimeout(() => {
    if (state.topic?.job?.status === 'running') void pollJob();
    else void refreshTopic();
  }, delay);
}

/** Çalışan iş sırasında yalnızca iş durumunu çeker; entry listesini taşımaz. */
async function pollJob() {
  if (!state.id) return;

  const response = await send({ type: 'getJob', id: state.id });

  if (!response.ok) {
    await refreshTopic(true);
    return;
  }

  if (!state.topic) {
    await refreshTopic(true);
    return;
  }

  if (response.job) {
    const kind = response.job.kind;
    state.topic.job = response.job;

    renderJobCard();
    renderStages();
    renderFollow();
    if (kind === 'vision') renderGallery();
    if (kind === 'check') renderUpdates();

    schedulePoll();
    return;
  }

  await refreshTopic(true);
}

function signatureOf(topic) {
  if (!topic) return '';
  return JSON.stringify({
    updatedAt: topic.updatedAt,
    title: topic.title,
    warning: topic.warning,
    range: topic.range,
    rangeFrom: topic.rangeFrom,
    rangeTo: topic.rangeTo,
    rangeLabel: topic.rangeLabel,
    entries: topic.entries?.length || 0,
    entryCount: topic.entryCount,
    job: topic.job
      ? {
          status: topic.job.status,
          kind: topic.job.kind,
          stage: topic.job.stage,
          message: topic.job.message,
          error: topic.job.error,
        }
      : null,
    stages: Object.fromEntries(
      Object.entries(topic.stages || {}).map(([key, value]) => [
        key,
        {
          createdAt: value?.createdAt,
          length: value?.markdown?.length || 0,
          entryCount: value?.entryCount,
          model: value?.model,
        },
      ]),
    ),
    updates: (topic.updates || []).map((update) => [
      update.at,
      update.newCount,
      update.markdown?.length || 0,
      update.error || '',
    ]),
    captions: Object.keys(topic.imageCaptions || {}).length,
    follow: topic.follow
      ? {
          enabled: topic.follow.enabled,
          interval: topic.follow.intervalMinutes,
          lastCheckedAt: topic.follow.lastCheckedAt,
          unread: topic.follow.unread,
        }
      : null,
  });
}

/* ------------------------------------------------------------------ */
/* Analiz                                                              */
/* ------------------------------------------------------------------ */

async function startAnalyze(input, rangeKey = 'all') {
  if (state.analyzing) return;

  const value = String(input || '').trim();
  const range = normalizeRange(rangeKey);
  if (!value) {
    el('analyzeInput').focus();
    showNotice('Bir başlık adresi veya slug girin.', 'warn');
    return;
  }

  setAnalyzing(true, 'Ekşi Sözlük’e bağlanılıyor…');
  showNotice('');
  setView(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const response = await send({ type: 'analyze', input: value, range });

    if (!response.ok) {
      setAnalyzing(false);
      showNotice(response.error || 'Analiz tamamlanamadı.', 'err');
      return;
    }

    setAnalyzing(false);

    if (response.warning) showNotice(response.warning, 'warn');
    else showNotice('Başlık alındı.', 'ok');

    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('id', response.id);
    history.replaceState(null, '', url.href);

    await loadTopic(response.id);
    await loadTopics();
  } catch (error) {
    setAnalyzing(false);
    showNotice(String(error?.message || error), 'err');
  }
}

function setAnalyzing(value, text) {
  state.analyzing = value;
  el('analyzeProgress').classList.toggle('hidden', !value);
  el('analyzeBtn').disabled = value;
  el('analyzeInput').disabled = value;
  if (text) setAnalyzeText(text);
}

function setAnalyzeText(text) {
  el('analyzeProgressText').textContent = text;
}

async function generateStage(stageKey) {
  if (!state.id) return;

  if (!state.configured) {
    showNotice('Önce Ayarlar’dan API adresini, anahtarı ve modeli girin.', 'warn');
    return;
  }

  const response = await send({ type: 'generateStage', id: state.id, stage: stageKey });
  if (!response.ok) {
    showNotice(response.error || 'Aşama başlatılamadı.', 'err');
    return;
  }

  showNotice(`${stageInfo(stageKey)?.title || stageKey} hazırlanıyor…`, 'info');
  setTimeout(() => void refreshTopic(true), 500);
}

async function checkNow() {
  if (!state.id) return;

  const response = await send({ type: 'checkUpdates', id: state.id });
  if (!response.ok) {
    showNotice(response.error || 'Kontrol başlatılamadı.', 'err');
    return;
  }

  showNotice('Yeni entry’ler kontrol ediliyor…', 'info');
  setTimeout(() => void refreshTopic(true), 500);
}

async function describeImages() {
  if (!state.id) return;

  const response = await send({ type: 'describeImages', id: state.id });
  if (!response.ok) {
    showNotice(response.error || 'Görsel betimlemesi başlatılamadı.', 'err');
    return;
  }

  showNotice('Görseller betimleniyor…', 'info');
  setTimeout(() => void refreshTopic(true), 500);
}

async function changeRange(rangeKey) {
  if (!state.topic || state.rangeBusy) return;

  if (state.topic.job?.status === 'running') {
    showNotice('Kapsamı değiştirmek için önce çalışan işlemin bitmesini bekleyin.', 'warn');
    renderRailMeta();
    return;
  }

  const next = normalizeRange(rangeKey);
  const current = normalizeRange(state.topic.range);
  if (next === current) return;

  state.rangeBusy = true;
  renderRailMeta();
  showNotice('Kapsam değiştiriliyor; başlık yeniden okunuyor…', 'info');

  try {
    const response = await send({
      type: 'analyze',
      input: state.topic.url,
      range: next,
    });

    if (!response.ok) {
      state.rangeBusy = false;
      showNotice(response.error || 'Kapsam değiştirilemedi.', 'err');
      renderRailMeta();
      return;
    }

    state.rangeBusy = false;
    const label = RANGE_OPTIONS.find((option) => option.key === next)?.label || next;

    if (response.warning) showNotice(response.warning, 'warn');
    else showNotice(`Kapsam: ${label}`, 'ok');

    await loadTopic(response.id);
    await loadTopics();
  } catch (error) {
    state.rangeBusy = false;
    showNotice(String(error?.message || error), 'err');
    renderRailMeta();
  }
}

async function setFollow(enabled, intervalMinutes) {
  if (!state.id) return;

  const response = await send({
    type: 'setFollow',
    id: state.id,
    enabled,
    intervalMinutes,
  });

  if (!response.ok) {
    showNotice(response.error || 'Takip ayarlanamadı.', 'err');
    return;
  }

  showNotice(enabled ? 'Takip açıldı.' : 'Takip kapatıldı.', 'ok');
  await refreshTopic(true);
  void loadTopics();
}

/* ------------------------------------------------------------------ */
/* Görünüm                                                             */
/* ------------------------------------------------------------------ */

function setView(hasTopic) {
  document.body.classList.toggle('has-topic', hasTopic);
  el('hero').classList.toggle('hidden', hasTopic);
  el('report').classList.toggle('hidden', !hasTopic);
}

function resetToHero() {
  state.id = null;
  state.topic = null;
  state.query = '';
  state.rangeBusy = false;
  state.lastSig = '';
  clearTimeout(state.timer);
  showNotice('');

  const url = new URL(location.href);
  url.search = '';
  history.replaceState(null, '', url.href);
  document.title = 'Özetgeç';

  setView(false);
  renderRecentHero();
  el('analyzeInput').value = '';
  el('heroRange').value = 'all';
  el('analyzeInput').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchTopic(id) {
  if (!id || id === state.id) return;

  state.query = '';
  showNotice('');

  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('id', id);
  history.replaceState(null, '', url.href);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  void loadTopic(id);
}

function renderAll() {
  const topic = state.topic;
  if (!topic) {
    setView(false);
    return;
  }

  setView(true);
  document.title = `${topic.title} — Özetgeç`;

  const focused = document.activeElement;
  const focusedId = focused?.id || '';
  const selectionStart =
    focusedId === 'entrySearch' ? focused.selectionStart ?? state.query.length : null;

  renderModelChip();
  renderRailMeta();
  renderSteps();
  renderFollow();
  renderTopicList();
  renderJobCard();
  renderStages();
  renderUpdates();
  renderGallery();
  renderEntries();

  if (focusedId === 'entrySearch') {
    const input = el('entrySearch');
    if (input) {
      input.focus();
      const position = Math.min(selectionStart ?? input.value.length, input.value.length);
      input.setSelectionRange(position, position);
    }
  }
}

function renderModelChip() {
  const chip = el('modelChip');
  const model = state.settings?.model;

  chip.textContent = model || 'model yok';
  chip.classList.toggle('warn', !state.configured);
  chip.title = model
    ? `${model} · ${state.settings?.provider === 'openai' ? 'OpenAI uyumlu' : 'Ollama'}${
        state.configured ? '' : ' · API anahtarı eksik'
      }`
    : 'Ayarlar’dan model seçin';
}

function renderRailMeta() {
  const topic = state.topic;
  const rangeKey = normalizeRange(topic.range);
  const rangeEntries = filterTopicEntries(topic);
  const shown = topic.entries?.length || 0;
  const total = Number(topic.entryCount) || shown;
  const busy = state.rangeBusy || topic.job?.status === 'running';
  const dateRange =
    topic.dateFrom || topic.dateTo
      ? `${formatDate(topic.dateFrom) || '?'} – ${formatDate(topic.dateTo) || '?'}`
      : 'tarih yok';
  const safeTopicUrl = safeHttpUrl(topic.url) || '#';

  const countText =
    rangeKey !== 'all'
      ? `<strong>${rangeEntries.length}</strong> entry <span class="muted">/ ${shown} okundu</span>`
      : `<strong>${rangeEntries.length}</strong> entry${
          total > shown ? ` · toplam ${topic.truncated ? '~' : ''}${total}` : ''
        }`;

  const options = RANGE_OPTIONS.map(
    (option) =>
      `<option value="${option.key}" ${option.key === rangeKey ? 'selected' : ''}>${escapeHtml(option.label)}</option>`,
  ).join('');

  el('railMeta').innerHTML = `
    <p class="rail-kicker">Başlık</p>
    <h1 class="rail-title">${escapeHtml(topic.title)}</h1>
    <div class="rail-facts">
      <span>${countText}</span>
      <span>${escapeHtml(dateRange)}</span>
    </div>
    <div class="rail-facts">
      <span>Analiz: ${escapeHtml(formatDateTime(topic.lastAnalysisAt || topic.snapshotAt))}</span>
    </div>
    <label class="range-field">
      <span>Kapsam</span>
      <select id="rangeSelect" ${busy ? 'disabled' : ''}>${options}</select>
    </label>
    <p class="rail-note">
      ${escapeHtml(topic.rangeLabel || 'Tüm başlık')} · ${rangeEntries.length} entry${
        state.rangeBusy ? ' · yenileniyor…' : ''
      }
    </p>
    <a class="rail-link" href="${escapeAttr(safeTopicUrl)}" target="_blank" rel="noreferrer">Ekşi’de aç ↗</a>
    ${topic.warning ? `<p class="rail-warn">${escapeHtml(topic.warning)}</p>` : ''}
  `;
}

function renderSteps() {
  const topic = state.topic;
  const job = topic.job;
  const doneCount = STAGES.filter((stage) => topic.stages?.[stage.key]?.markdown).length;
  const activeKey = STAGES.find((stage) => !topic.stages?.[stage.key]?.markdown)?.key || null;

  let html = `
    <div class="rail-head">
      <h2>Aşamalar</h2>
      <span class="chip">${doneCount}/${STAGES.length}</span>
    </div>
    <div class="step-list">
  `;

  for (const stage of STAGES) {
    const done = Boolean(topic.stages?.[stage.key]?.markdown);
    const running =
      job?.status === 'running' && job.kind === 'stage' && job.stage === stage.key;
    const classes = [
      'step',
      done ? 'done' : '',
      running ? 'running' : '',
      stage.key === activeKey ? 'active' : '',
    ]
      .filter(Boolean)
      .join(' ');

    html += `
      <button type="button" class="${classes}" data-action="jump" data-stage="${stage.key}">
        <span class="step-no">${done ? '✓' : running ? '…' : stage.no}</span>
        <span>
          <strong>${escapeHtml(stage.title)}</strong>
          <small>${escapeHtml(stage.short)}</small>
        </span>
      </button>
    `;
  }

  const updates = topic.updates?.length || 0;
  html += `
      <button type="button" class="step updates-step" data-action="jump-updates">
        <span class="step-no">${updates || '·'}</span>
        <span>
          <strong>Gelişmeler</strong>
          <small>${topic.follow?.enabled ? 'takip açık' : 'takip kapalı'}</small>
        </span>
      </button>
    </div>
  `;

  el('steps').innerHTML = html;
}

function renderFollow() {
  const follow = state.topic.follow || {};
  const busy = state.topic.job?.status === 'running';
  const interval = Number(follow.intervalMinutes) || 30;
  const options = INTERVAL_OPTIONS.map(
    (value) =>
      `<option value="${value}" ${value === interval ? 'selected' : ''}>${intervalLabel(value)}</option>`,
  ).join('');

  el('followCard').innerHTML = `
    <div class="rail-head">
      <h2>Takip</h2>
      <label class="switch" title="Yeni entry’leri izle">
        <input type="checkbox" id="followToggle" ${follow.enabled ? 'checked' : ''} ${busy ? 'disabled' : ''} />
        <span></span>
      </label>
    </div>
    <p class="rail-note">
      ${
        follow.enabled
          ? 'Yeni entry’ler kontrol edilir ve özetlenir.'
          : 'Kapalı. Özetten sonraki gelişmeleri kaçırırsınız.'
      }
    </p>
    <label class="mini-field">
      Aralık
      <select id="followInterval" ${busy ? 'disabled' : ''}>${options}</select>
    </label>
    <p class="rail-note">
      Son kontrol: ${follow.lastCheckedAt ? escapeHtml(formatDateTime(follow.lastCheckedAt)) : 'henüz yok'}
    </p>
    ${follow.unread ? `<p class="rail-note">${follow.unread} okunmamış gelişme</p>` : ''}
    <button type="button" class="btn small ghost" data-action="check" ${busy ? 'disabled' : ''}>
      Şimdi kontrol et
    </button>
    ${!state.configured ? '<p class="rail-note">Yeni entry özeti için API ayarları gerekir.</p>' : ''}
  `;
}

function renderTopicList() {
  const list = el('topicList');
  const empty = el('topicEmpty');
  if (!list || !empty) return;

  const topics = [...(state.topics || [])];
  if (state.topic && !topics.some((topic) => topic.id === state.topic.id)) {
    topics.unshift({
      id: state.topic.id,
      title: state.topic.title,
      entryCount: state.topic.entries?.length || 0,
      followEnabled: state.topic.follow?.enabled,
      unread: state.topic.follow?.unread,
      stageCount: Object.values(state.topic.stages || {}).filter((stage) => stage?.markdown)
        .length,
    });
  }

  list.textContent = '';
  empty.classList.toggle('hidden', topics.length > 0);

  for (const topic of topics) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `topic-item${topic.id === state.id ? ' active' : ''}`;
    button.dataset.action = 'switch';
    button.dataset.id = topic.id;

    if (topic.unread) {
      const dot = document.createElement('span');
      dot.className = 'unread-dot';
      button.appendChild(dot);
    }

    const title = document.createElement('span');
    title.className = 'topic-title';
    title.textContent = topic.title || topic.id;
    title.title = topic.title || topic.id;
    button.appendChild(title);

    if (topic.followEnabled) {
      const mark = document.createElement('span');
      mark.className = 'follow-mark';
      mark.textContent = '●';
      mark.title = 'Takip açık';
      button.appendChild(mark);
    }

    const meta = document.createElement('span');
    meta.className = 'topic-meta';
    meta.textContent = String(topic.entryCount ?? '');
    button.appendChild(meta);

    li.appendChild(button);
    list.appendChild(li);
  }
}

function renderRecentHero() {
  const node = el('recentHero');
  if (!node) return;

  node.textContent = '';
  const topics = state.topics || [];
  if (!topics.length) return;

  const head = document.createElement('div');
  head.className = 'rail-head';
  const heading = document.createElement('h2');
  heading.textContent = 'Son başlıklar';
  head.appendChild(heading);
  node.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'recent-grid';

  for (const topic of topics.slice(0, 6)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-card';
    button.dataset.action = 'switch';
    button.dataset.id = topic.id;

    const title = document.createElement('strong');
    title.textContent = topic.title || topic.id;
    button.appendChild(title);

    const meta = document.createElement('span');
    const stages = Number(topic.stageCount) || 0;
    meta.textContent = `${topic.entryCount || 0} entry · ${stages}/${STAGES.length} aşama${
      topic.unread ? ` · ${topic.unread} yeni` : ''
    }`;
    button.appendChild(meta);

    grid.appendChild(button);
  }

  node.appendChild(grid);
}

/* ------------------------------------------------------------------ */
/* İş kartı                                                            */
/* ------------------------------------------------------------------ */

function renderJobCard() {
  const node = el('jobCard');
  const job = state.topic.job;

  if (!job) {
    node.textContent = '';
    return;
  }

  if (job.status === 'error' && job.kind === 'config' && state.configured) {
    node.textContent = '';
    return;
  }

  if (job.status === 'running') {
    node.innerHTML = `
      <div class="job-card">
        <div class="job-main">
          <span class="spinner"></span>
          <div>
            <strong>${escapeHtml(jobLabel(job))}</strong>
            <p>${escapeHtml(job.message || 'Çalışıyor…')}</p>
          </div>
        </div>
        <div class="job-bar"><span></span></div>
      </div>
    `;
    return;
  }

  if (job.status === 'error') {
    let retry = '';
    if (job.kind === 'stage' && job.stage) {
      retry = `<button type="button" class="btn small" data-action="retry-stage" data-stage="${escapeAttr(job.stage)}">Tekrar dene</button>`;
    } else if (job.kind === 'check') {
      retry = '<button type="button" class="btn small" data-action="retry-check">Tekrar kontrol et</button>';
    } else if (job.kind === 'vision') {
      retry = '<button type="button" class="btn small" data-action="retry-vision">Tekrar dene</button>';
    }

    const rangeHint =
      job.kind === 'range'
        ? '<span class="status">Kapsam seçicisinden daha geniş bir aralık seçin.</span>'
        : '';
    const settingsAction =
      job.kind === 'range'
        ? ''
        : '<button type="button" class="btn small ghost" data-action="settings">Ayarlar</button>';

    node.innerHTML = `
      <div class="job-card error">
        <div class="job-main">
          <div>
            <strong>${escapeHtml(jobLabel(job))} tamamlanamadı</strong>
            <p>${escapeHtml(job.error || job.message || 'Bilinmeyen hata.')}</p>
          </div>
        </div>
        <div class="job-actions">
          ${retry}
          ${rangeHint}
          ${settingsAction}
        </div>
      </div>
    `;
    return;
  }

  node.textContent = '';
}

/* ------------------------------------------------------------------ */
/* Aşama kartları                                                      */
/* ------------------------------------------------------------------ */

function renderStages() {
  el('stageList').innerHTML = STAGES.map(stageCardHtml).join('');
}

function stageCardHtml(stage) {
  const topic = state.topic;
  const data = topic.stages?.[stage.key];
  const job = topic.job;
  const running = job?.status === 'running';
  const thisRunning = running && job.kind === 'stage' && job.stage === stage.key;
  const otherJob = running && !thisRunning;

  const nextKey = nextStage(stage.key);
  const nextInfo = nextKey ? stageInfo(nextKey) : null;
  const nextData = nextKey ? topic.stages?.[nextKey] : null;

  const rangeEntries = filterTopicEntries(topic);
  const entryCount = rangeEntries.length;
  const shownCount = Number(data?.entryCount) || 0;
  const stale = Boolean(data) && shownCount < entryCount;
  const emptyScope = entryCount === 0;

  const classes = [
    'stage-card',
    data ? 'done' : 'pending',
    thisRunning ? 'running' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const disabled = thisRunning || otherJob || !state.configured || emptyScope;

  let meta = '';
  if (data) {
    meta = `
      <div class="stage-meta">
        <span class="chip">${escapeHtml(data.model || state.settings?.model || 'model')}</span>
        <span class="chip">${escapeHtml(formatDateTime(data.createdAt))}</span>
        ${
          stale
            ? `<span class="chip warn">+${entryCount - shownCount} yeni entry</span>`
            : ''
        }
      </div>
    `;
  }

  let body;
  if (thisRunning) {
    body = `
      <div class="stage-progress">
        <span class="spinner"></span>
        <span>${escapeHtml(job.message || 'Çalışıyor…')}</span>
      </div>
    `;
  } else if (data) {
    body = `<div class="md">${mdToHtml(data.markdown)}</div>`;
  } else if (emptyScope) {
    body = `<p class="stage-placeholder">Seçilen kapsamda (${escapeHtml(
      topic.rangeLabel || '—',
    )}) entry yok. Kapsamı değiştirin veya başlığı yenileyin.</p>`;
  } else {
    body = `<p class="stage-placeholder">${escapeHtml(stage.desc)}</p>`;
  }

  let actions;
  if (thisRunning) {
    actions = '<span class="status">Bu aşama üretiliyor…</span>';
  } else {
    actions = `
      <button type="button" class="btn small ${data ? 'ghost' : 'primary'}" data-action="generate" data-stage="${stage.key}" ${disabled ? 'disabled' : ''}>
        ${data ? 'Yeniden üret' : 'Bu aşamayı oluştur'}
      </button>
    `;

    if (nextInfo) {
      actions += nextData
        ? `<button type="button" class="btn small ghost" data-action="jump" data-stage="${nextKey}">Sonraki: ${escapeHtml(nextInfo.title)} ✓</button>`
        : `<button type="button" class="btn small" data-action="generate" data-stage="${nextKey}" ${disabled ? 'disabled' : ''}>Sonraki: ${escapeHtml(nextInfo.title)} →</button>`;
    }
  }

  if (!state.configured) {
    actions += `
      <span class="config-hint">
        API ayarları gerekli.
        <button type="button" class="btn link" data-action="settings">Ayarları aç</button>
      </span>
    `;
  }

  return `
    <article class="${classes}" id="stage-${stage.key}">
      <header class="stage-head">
        <span class="stage-num">${stage.no}</span>
        <div class="stage-titles">
          <h2>${escapeHtml(stage.title)}</h2>
          <p>${escapeHtml(stage.short)}</p>
        </div>
        ${meta}
      </header>
      <div class="stage-body">${body}</div>
      <div class="stage-actions">
        ${actions}
        <span class="spacer"></span>
        <button type="button" class="btn small link" data-action="jump-updates">Gelişmeler ↓</button>
      </div>
    </article>
  `;
}

function jumpToStage(stageKey) {
  const node = el(`stage-${stageKey}`);
  if (!node) return;
  node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  node.animate(
    [
      { boxShadow: '0 0 0 0 rgba(47, 107, 69, 0)' },
      { boxShadow: '0 0 0 4px rgba(47, 107, 69, 0.22)' },
      { boxShadow: '0 0 0 0 rgba(47, 107, 69, 0)' },
    ],
    { duration: 900, easing: 'ease-out' },
  );
}

/* ------------------------------------------------------------------ */
/* Gelişmeler                                                          */
/* ------------------------------------------------------------------ */

function renderUpdates() {
  const topic = state.topic;
  const updates = [...(topic.updates || [])].sort((a, b) => b.at - a.at);
  const follow = topic.follow || {};
  const busy = topic.job?.status === 'running';

  let html = `
    <div class="panel-head">
      <h2>Gelişmeler</h2>
      <span class="chip">${updates.length}</span>
      ${follow.enabled ? '<span class="chip accent">takip açık</span>' : ''}
      <div class="panel-tools">
        <button type="button" class="btn small ghost" data-action="check" ${busy ? 'disabled' : ''}>
          Şimdi kontrol et
        </button>
      </div>
    </div>
    <p class="panel-sub">Özetten sonra eklenen entry’ler burada birikir.</p>
  `;

  if (!updates.length) {
    html += `
      <div class="empty-state">
        ${
          follow.enabled
            ? 'Henüz yeni gelişme yok. Takip açık; yeni entry eklendiğinde burada özetlenecek.'
            : 'Henüz gelişme kaydı yok. Takibi açarsanız yeni entry’ler burada özetlenir.'
        }
      </div>
    `;
  } else {
    html += '<div class="updates-list">';

    for (const update of updates) {
      const links = (update.entryIds || [])
        .slice(0, 12)
        .map(
          (id) =>
            `<a href="${escapeAttr(entryUrl(id))}" target="_blank" rel="noreferrer">#${escapeHtml(String(id))}</a>`,
        )
        .join('');

      html += `
        <article class="update">
          <header>
            <time>${escapeHtml(formatDateTime(update.at))}</time>
            <span class="chip accent">${update.newCount || update.entryIds?.length || 0} yeni entry</span>
            ${update.model ? `<span class="chip">${escapeHtml(update.model)}</span>` : ''}
          </header>
          ${update.markdown ? `<div class="md">${mdToHtml(update.markdown)}</div>` : ''}
          ${update.error ? `<p class="inline-error">${escapeHtml(update.error)}</p>` : ''}
          ${links ? `<div class="entry-links">${links}</div>` : ''}
        </article>
      `;
    }

    html += '</div>';
  }

  el('updatesPanel').innerHTML = html;
}

/* ------------------------------------------------------------------ */
/* Galeri                                                              */
/* ------------------------------------------------------------------ */

function renderGallery() {
  const panel = el('galleryPanel');
  const topic = state.topic;
  const rangeEntries = filterTopicEntries(topic);
  const rangeIds = new Set(rangeEntries.map((entry) => String(entry.id)));
  const images = (topic.images || []).filter((image) =>
    rangeIds.has(String(image.entryId)),
  );

  if (!images.length) {
    panel.classList.add('hidden');
    panel.textContent = '';
    return;
  }

  panel.classList.remove('hidden');

  const captions = topic.imageCaptions || {};
  const captioned = images.filter((image) => captions[image.url]?.caption).length;
  const job = topic.job;
  const visionRunning = job?.status === 'running' && job.kind === 'vision';
  const busy = job?.status === 'running';

  panel.innerHTML = `
    <div class="panel-head">
      <h2>Görseller</h2>
      <span class="chip">${images.length}</span>
      ${captioned ? `<span class="chip accent">${captioned} betimlendi</span>` : ''}
      <div class="panel-tools">
        ${
          visionRunning
            ? `<span class="status"><span class="spinner"></span> ${escapeHtml(job.message || 'Betimleniyor…')}</span>`
            : `<button type="button" class="btn small" data-action="captions" ${busy ? 'disabled' : ''}>Görselleri AI ile betimle</button>`
        }
      </div>
    </div>
    <p class="panel-sub">
      Entry’lerdeki görseller · ${escapeHtml(topic.rangeLabel || 'Tüm başlık')}. Büyütmek için tıklayın.
    </p>
  `;

  const grid = document.createElement('div');
  grid.className = 'shots';

  for (const image of images) {
    grid.appendChild(buildShot(image, captions[image.url]));
  }

  panel.appendChild(grid);
}

function buildShot(image, info) {
  const figure = document.createElement('figure');
  figure.className = 'shot';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shot-btn';
  button.dataset.action = 'open-image';
  button.dataset.url = image.url;

  const safe = safeImageUrl(image.url);
  if (!safe) {
    button.disabled = true;
    const fallback = document.createElement('span');
    fallback.className = 'shot-fallback';
    fallback.textContent = 'Görsel adresi geçersiz';
    button.appendChild(fallback);
  } else {
    const display = displayImageUrl(image.url) || safe;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = 'Entry görseli';
    img.src = display;
    let retried = false;
    img.addEventListener('error', () => {
      if (!retried && display !== safe) {
        retried = true;
        img.src = safe;
        return;
      }
      img.remove();
      const fallback = document.createElement('span');
      fallback.className = 'shot-fallback';
      fallback.textContent = 'Görsel açılamadı';
      button.appendChild(fallback);
    });
    button.appendChild(img);
  }

  figure.appendChild(button);

  const caption = document.createElement('figcaption');
  const captionText = document.createElement('span');

  if (info?.caption) {
    captionText.className = 'shot-cap';
    captionText.textContent = info.caption;
  } else if (info?.error) {
    captionText.className = 'shot-cap error';
    captionText.textContent = `Betimlenemedi: ${info.error}`;
  } else {
    captionText.className = 'shot-cap broken';
    captionText.textContent = 'AI betimlemesi yok';
  }
  caption.appendChild(captionText);

  const meta = document.createElement('span');
  meta.className = 'shot-meta';

  const link = document.createElement('a');
  link.href = entryUrl(image.entryId);
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = `#${image.entryId}`;
  meta.appendChild(link);

  meta.appendChild(
    document.createTextNode(
      ` · ${image.author || 'yazar'}${image.dateText ? ` · ${image.dateText}` : ''}`,
    ),
  );
  caption.appendChild(meta);

  figure.appendChild(caption);
  return figure;
}

function openLightbox(url) {
  const safe = safeImageUrl(url);
  if (!safe) {
    showNotice('Görsel adresi geçersiz.', 'err');
    return;
  }

  const display = displayImageUrl(url) || safe;
  const img = el('lightboxImg');
  let retried = false;
  img.onerror = () => {
    if (!retried && display !== safe) {
      retried = true;
      img.src = safe;
      return;
    }
    img.onerror = null;
  };
  img.src = display;
  img.alt = '';

  const info = state.topic?.imageCaptions?.[url];
  el('lightboxCap').textContent = info?.caption || info?.error || hostOf(url);

  const openLink = el('lightboxOpen');
  const openable = /^https?:/i.test(safe) ? safe : null;
  openLink.href = openable || '#';
  openLink.classList.toggle('hidden', !openable);

  el('lightbox').showModal();
}

/* ------------------------------------------------------------------ */
/* Entry dökümü                                                        */
/* ------------------------------------------------------------------ */

function renderEntries() {
  const topic = state.topic;
  const total = filterTopicEntries(topic).length;
  const rangeLabel = topic.rangeLabel || 'Tüm başlık';

  el('entriesPanel').innerHTML = `
    <div class="panel-head">
      <h2>Entry dökümü</h2>
      <span class="chip" id="entryCountLabel">${total}</span>
      <span class="chip accent">${escapeHtml(rangeLabel)}</span>
      <div class="panel-tools">
        <input
          id="entrySearch"
          type="search"
          placeholder="Yazar, entry no veya metin…"
          value="${escapeAttr(state.query)}"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
    </div>
    <p class="panel-sub">
      Kronolojik sıra (eskiden yeniye) · ${escapeHtml(rangeLabel)}.${
        topic.truncated ? ' Başlığın ilk sayfaları gösteriliyor.' : ''
      }
    </p>
    <div class="entry-list" id="entryListView"></div>
  `;

  renderEntryList();
}

function renderEntryList() {
  const list = el('entryListView');
  if (!list) return;

  const entries = state.topic ? filterTopicEntries(state.topic) : [];
  const query = state.query.trim().toLocaleLowerCase('tr');

  const filtered = query
    ? entries.filter(
        (entry) =>
          String(entry.id).includes(query) ||
          (entry.author || '').toLocaleLowerCase('tr').includes(query) ||
          (entry.text || '').toLocaleLowerCase('tr').includes(query),
      )
    : entries;

  const label = el('entryCountLabel');
  if (label) {
    label.textContent = query ? `${filtered.length}/${entries.length}` : String(entries.length);
  }

  list.textContent = '';

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = query
      ? 'Aramayla eşleşen entry yok.'
      : 'Bu kapsamda gösterilecek entry yok. Kapsamı değiştirin veya başlığı yenileyin.';
    list.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of filtered) fragment.appendChild(buildEntry(entry));
  list.appendChild(fragment);
}

function buildEntry(entry) {
  const article = document.createElement('article');
  article.className = 'entry';

  const head = document.createElement('header');
  head.className = 'entry-head';

  const idLink = document.createElement('a');
  idLink.className = 'entry-id';
  idLink.href = entryUrl(entry.id);
  idLink.target = '_blank';
  idLink.rel = 'noreferrer';
  idLink.textContent = `#${entry.id}`;
  head.appendChild(idLink);

  if (entry.author) {
    const author = document.createElement('span');
    author.className = 'entry-author';
    author.textContent = entry.author;
    head.appendChild(author);
  }

  const dateText = entry.dateText || formatDate(entry.date);
  if (dateText) {
    const date = document.createElement('span');
    date.className = 'entry-date';
    date.textContent = dateText;
    head.appendChild(date);
  }

  if (entry.favorites) {
    const favorite = document.createElement('span');
    favorite.className = 'entry-fav';
    favorite.textContent = `★ ${entry.favorites}`;
    head.appendChild(favorite);
  }

  article.appendChild(head);

  const text = document.createElement('div');
  text.className = 'entry-text';

  const raw = String(entry.text || '').trim();
  for (const chunk of raw.split(/\n{2,}/)) {
    if (!chunk.trim()) continue;
    const paragraph = document.createElement('p');
    paragraph.textContent = chunk;
    text.appendChild(paragraph);
  }
  article.appendChild(text);

  if (raw.length > 520) {
    text.classList.add('clamped');
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn link more';
    more.dataset.action = 'expand';
    more.textContent = 'Devamını oku';
    article.appendChild(more);
  }

  const images = entry.images || [];
  if (images.length) {
    const row = document.createElement('div');
    row.className = 'entry-thumbs';

    for (const url of images.slice(0, 4)) {
      row.appendChild(buildThumb(url));
    }

    if (images.length > 4) {
      const more = document.createElement('span');
      more.className = 'thumb-more';
      more.textContent = `+${images.length - 4} görsel`;
      row.appendChild(more);
    }

    article.appendChild(row);
  }

  return article;
}

function buildThumb(url) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'entry-thumb';
  button.dataset.action = 'open-image';
  button.dataset.url = url;

  const safe = safeImageUrl(url);
  if (!safe) {
    button.disabled = true;
    return button;
  }

  const display = displayImageUrl(url) || safe;
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.src = display;
  let retried = false;
  img.addEventListener('error', () => {
    if (!retried && display !== safe) {
      retried = true;
      img.src = safe;
      return;
    }
    button.disabled = true;
    img.remove();
  });
  button.appendChild(img);

  return button;
}

function toggleEntry(button) {
  const article = button.closest('.entry');
  const text = article?.querySelector('.entry-text');
  if (!text) return;

  const clamped = text.classList.toggle('clamped');
  button.textContent = clamped ? 'Devamını oku' : 'Kısalt';
}

/* ------------------------------------------------------------------ */
/* Markdown (güvenli, küçük bir alt küme)                              */
/* ------------------------------------------------------------------ */

function mdToHtml(markdown) {
  const lines = String(markdown || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  let html = '';
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let tableRows = [];
  let inCode = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += `<p>${renderInline(paragraph.join(' '))}</p>`;
    paragraph = [];
  };

  const flushList = () => {
    if (!listType) return;
    html += `<${listType}>${listItems
      .map((item) => `<li>${renderInline(item)}</li>`)
      .join('')}</${listType}>`;
    listType = null;
    listItems = [];
  };

  const flushTable = () => {
    if (!tableRows.length) return;

    const cells = (row) =>
      row
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());

    const header = tableRows[0];
    let body = tableRows.slice(1);
    if (body.length && /^[:\s|:-]+$/.test(body[0])) body = body.slice(1);

    html +=
      '<div class="table-wrap"><table><thead><tr>' +
      cells(header)
        .map((cell) => `<th>${renderInline(cell)}</th>`)
        .join('') +
      '</tr></thead><tbody>' +
      body
        .map(
          (row) =>
            '<tr>' +
            cells(row)
              .map((cell) => `<td>${renderInline(cell)}</td>`)
              .join('') +
            '</tr>',
        )
        .join('') +
      '</tbody></table></div>';

    tableRows = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (/^```/.test(trimmed)) {
      if (inCode) {
        html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
        codeLines = [];
        inCode = false;
      } else {
        flushAll();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!trimmed) {
      flushAll();
      continue;
    }

    if (/^\|.*\|?$/.test(trimmed)) {
      flushParagraph();
      flushList();
      tableRows.push(trimmed);
      continue;
    }
    flushTable();

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = Math.min(6, heading[1].length + 1);
      html += `<h${level}>${renderInline(heading[2])}</h${level}>`;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      html += '<hr>';
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      flushList();
      html += `<blockquote>${renderInline(trimmed.replace(/^>\s?/, ''))}</blockquote>`;
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.*)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);

    if (unordered) {
      flushParagraph();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(unordered[1]);
      continue;
    }

    if (ordered) {
      flushParagraph();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(ordered[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  if (inCode && codeLines.length) {
    html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
  }

  flushAll();
  return html;
}

function renderInline(raw) {
  let out = escapeHtml(raw);
  const codes = [];

  out = out.replace(/`([^`]+)`/g, (_match, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, text, url) => {
    const safe = safeHttpUrl(url.replace(/&amp;/g, '&'));
    return safe
      ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer">${text}</a>`
      : text;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_match, index) => codes[Number(index)] || '');

  return out;
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

function showNotice(text, kind = 'info') {
  const node = el('notice');
  clearTimeout(noticeTimer);

  if (!text) {
    node.className = 'notice hidden';
    node.textContent = '';
    return;
  }

  node.textContent = text;
  node.className = `notice ${kind}`;

  if (kind !== 'err') {
    noticeTimer = setTimeout(() => {
      node.className = 'notice hidden';
    }, 7000);
  }
}

function jobLabel(job) {
  if (!job) return 'İşlem';
  if (job.kind === 'stage') return stageInfo(job.stage)?.title || 'Özet';
  if (job.kind === 'check') return 'Gelişme kontrolü';
  if (job.kind === 'vision') return 'Görsel betimleme';
  if (job.kind === 'range') return 'Kapsam';
  return 'İşlem';
}

function intervalLabel(value) {
  const minutes = Number(value) || 30;
  if (minutes < 60) return `${minutes} dakika`;
  const hours = minutes / 60;
  return `${hours} saat`;
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function entryUrl(id) {
  const value = String(id ?? '').trim();
  const safe = value.replace(/[^\d]/g, '');
  return `https://eksisozluk.com/entry/${safe || encodeURIComponent(value)}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'görsel';
  }
}

function safeHttpUrl(raw) {
  try {
    const url = new URL(String(raw), location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function safeImageUrl(raw) {
  const value = String(raw || '');
  if (/^data:image\//i.test(value)) return value;
  return safeHttpUrl(value);
}

/** http görselleri extension sayfasında karışık içerik sayılabilir; önce https dene. */
function displayImageUrl(raw) {
  const safe = safeImageUrl(raw);
  if (!safe || /^data:/i.test(safe)) return safe;
  try {
    const url = new URL(safe);
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return url.href;
    }
  } catch {
    /* aşağıda orijinal döner */
  }
  return safe;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

const escapeAttr = escapeHtml;

init();

/** Özet kapsamları: tüm başlık, bugün, son 3 gün, son 7 gün. */

export const RANGE_OPTIONS = [
  {
    key: 'all',
    label: 'Tüm başlık',
    short: 'Tümü',
    description: 'Bütün entry’ler',
  },
  {
    key: 'today',
    label: 'Bugün',
    short: 'Bugün',
    description: 'Bugünkü entry’ler',
  },
  {
    key: '3d',
    label: 'Son 3 gün',
    short: '3 gün',
    description: 'Son 3 günün entry’leri',
  },
  {
    key: '7d',
    label: 'Son 7 gün',
    short: '7 gün',
    description: 'Son 7 günün entry’leri',
  },
];

export const RANGE_KEYS = RANGE_OPTIONS.map((option) => option.key);

export function normalizeRange(key) {
  return RANGE_KEYS.includes(key) ? key : 'all';
}

export function rangeOption(key) {
  return RANGE_OPTIONS.find((option) => option.key === normalizeRange(key)) || RANGE_OPTIONS[0];
}

/**
 * Seçilen kapsamın başlangıç zamanı ve etiketi.
 * "Bugün" yerel günün başlangıcıdır; 3/7 gün geriye yuvarlanan penceredir.
 */
export function rangeWindow(key, now = Date.now()) {
  const normalized = normalizeRange(key);

  if (normalized === 'all') {
    return {
      key: normalized,
      start: null,
      end: null,
      label: 'Tüm başlık',
      short: 'Tümü',
    };
  }

  if (normalized === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {
      key: normalized,
      start: start.getTime(),
      end: end.getTime(),
      label: `Bugün · ${formatDate(start)}`,
      short: 'Bugün',
    };
  }

  const days = normalized === '3d' ? 3 : 7;
  const start = new Date(now - days * 24 * 60 * 60 * 1000);
  const title = normalized === '3d' ? 'Son 3 gün' : 'Son 7 gün';

  return {
    key: normalized,
    start: start.getTime(),
    end: now,
    label: `${title} · ${formatDate(start)}–${formatDate(new Date(now))}`,
    short: title,
  };
}

export function rangeLabel(key, now = Date.now()) {
  return rangeWindow(key, now).label;
}

/** Yeni analiz sırasında entry'leri seçilen kapsama göre süzer. */
export function filterEntriesByRange(entries, key, now = Date.now()) {
  const normalized = normalizeRange(key);
  const list = entries || [];
  if (normalized === 'all') return [...list];

  const { start, end } = rangeWindow(normalized, now);
  return list.filter((entry) => {
    const time = entry?.date ? Date.parse(entry.date) : NaN;
    return Number.isFinite(time) && time >= start && (!end || time <= end);
  });
}

/**
 * Kayıtlı bir başlığın kapsamını uygular. Kapsamın başlangıcı analiz anında
 * saklandığı için "Bugün" seçimi sonraki günlerde de aynı güne işaret eder.
 */
export function filterTopicEntries(topic) {
  const list = topic?.entries || [];
  const key = normalizeRange(topic?.range);
  if (key === 'all') return [...list];

  let start = Number(topic?.rangeFrom);
  if (!Number.isFinite(start) || start <= 0) {
    const at = Number(topic?.rangeAt) || Date.now();
    start = rangeWindow(key, at).start;
  }

  const end = Number(topic?.rangeTo);

  return list.filter((entry) => {
    const time = entry?.date ? Date.parse(entry.date) : NaN;
    return (
      Number.isFinite(time) &&
      time >= start &&
      (!Number.isFinite(end) || end <= 0 || time <= end)
    );
  });
}

function formatDate(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()}`;
}

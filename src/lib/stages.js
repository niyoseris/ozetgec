/** Kademeli özet aşamalarının ortak tanımı (UI + prompt katmanı). */

export const STAGES = [
  {
    key: 'ozet',
    no: 1,
    title: 'Hızlı Özet',
    short: 'Başlığı hiç okumamış biri için 3-5 cümle.',
    desc: 'En kısa hali: ne anlatılıyor, taraflar ne diyor?',
  },
  {
    key: 'detay',
    no: 2,
    title: 'Detaylı Özet',
    short: 'Temalara ayrılmış, örneklerle desteklenmiş özet.',
    desc: 'Alt başlıklar, karşıt görüşler ve öne çıkan entry atıfları.',
  },
  {
    key: 'kronoloji',
    no: 3,
    title: 'Kronoloji',
    short: 'Başlıktaki gelişmeleri tarih sırasına dizer.',
    desc: 'Entry tarihlerinden çıkarılmış zaman çizelgesi.',
  },
  {
    key: 'harita',
    no: 4,
    title: 'Tartışma Haritası',
    short: 'Taraflar, argümanlar, uzlaşılanlar ve açık sorular.',
    desc: 'Tartışmanın haritasını çıkarır; kim neyi savunuyor?',
  },
];

export const STAGE_KEYS = STAGES.map((stage) => stage.key);

export function stageInfo(key) {
  return STAGES.find((stage) => stage.key === key) || null;
}

export function nextStage(key) {
  const index = STAGE_KEYS.indexOf(key);
  if (index < 0 || index >= STAGE_KEYS.length - 1) return null;
  return STAGE_KEYS[index + 1];
}

export function stageLabel(key) {
  return stageInfo(key)?.title || key;
}

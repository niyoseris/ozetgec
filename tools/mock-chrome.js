/* Rapor arayüzünü API olmadan denemek için sahte chrome.runtime. */
(() => {
  const svg = (label, hue) =>
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="hsl(${hue} 35% 28%)"/><circle cx="320" cy="210" r="110" fill="hsl(${hue} 45% 55%)" opacity=".55"/><text x="320" y="230" font-family="Georgia" font-size="54" fill="#f6efdd" text-anchor="middle">${label}</text><text x="320" y="290" font-family="sans-serif" font-size="20" fill="#e9dfc7" text-anchor="middle">mock görsel</text></svg>`,
    );

  const imgA = svg('görsel 1', 150);
  const imgB = svg('görsel 2', 25);

  const entries = [
    {
      id: '101',
      author: 'eski yazar',
      date: '2020-02-02T10:30:00+03:00',
      dateText: '02.02.2020 10:30',
      favorites: 42,
      text:
        'başlığın ilk entry’si. burada konunun çerçevesi çiziliyor.\n\nikinci paragraf: **kalın** yazı, `kod` ve [bir bağlantı](https://eksisozluk.com/entry/103) içerir.',
      images: [imgA],
      url: 'https://eksisozluk.com/entry/101',
    },
    {
      id: '102',
      author: 'yazar iki',
      date: '2021-05-14T18:05:00+03:00',
      dateText: '14.05.2021 18:05',
      favorites: 7,
      text:
        'karşı görüşü savunan entry. iddiaya göre sayılar abartılı.\n\nbir alt iddia daha var; buna göre asıl sorun tanım meselesi.',
      images: [],
      url: 'https://eksisozluk.com/entry/102',
    },
    {
      id: '103',
      author: 'meraklı',
      date: '2024-11-09T09:15:00+03:00',
      dateText: '09.11.2024 09:15 ~ 10.11.2024 12:00',
      favorites: 23,
      text:
        'araya giren bir gelişme: konu yeniden gündeme geldi.\n\ngörselle desteklenmiş bir iddia da var.',
      images: [imgB],
      url: 'https://eksisozluk.com/entry/103',
    },
    {
      id: '104',
      author: 'bugünkü yazar',
      date: new Date().toISOString(),
      dateText: '11.11.2026 13:30',
      favorites: 3,
      text:
        'bugün eklenen entry. kapsam filtresini denemek için: bugün seçilince yalnızca bu entry görünmeli.',
      images: [],
      url: 'https://eksisozluk.com/entry/104',
    },
  ];

  const ozetMarkdown = `Başlıkta **iki ana taraf** var: birinci taraf iddiaların abartıldığını, ikinci taraf ise sayıların olduğundan küçük gösterildiğini savunuyor. Araya giren yeni gelişme tartışmanın yönünü değiştirdi.

**Öne çıkanlar**
- İlk entry konunun çerçevesini çiziyor ([#101](https://eksisozluk.com/entry/101)).
- Karşı görüş 2021’de ayrıntılı biçimde savunulmuş ([#102](https://eksisozluk.com/entry/102)).
- 2024’te konu yeniden gündeme gelmiş ([#103](https://eksisozluk.com/entry/103)).
- Görseller iddiaları desteklemek için kullanılmış.

| Taraf | Ana argüman |
| --- | --- |
| Birinci | Sayılar şişirilmiş |
| İkinci | Kayıtlar eksik |

<script>window.__xss = true;</script>

> Bu bir alıntıdır ve güvenli biçimde gösterilmelidir.`;

  const detayMarkdown = `## Çerçeve
İlk entry, konunun neden tartışıldığını açıklıyor. \`entry\` numaraları kronolojik.

## Taraflar
- **Birinci taraf:** verilerin bağlamdan koparıldığını söylüyor.
- **İkinci taraf:** eksik kayıtların sonucu değiştirdiğini savunuyor.

## Öne çıkan entry'ler
- [#101](https://eksisozluk.com/entry/101) — çerçeveyi kuran entry.
- [#103](https://eksisozluk.com/entry/103) — yeni gelişmeyi getiren entry.`;

  const updatesMarkdown = `- 2024 sonunda konu yeniden gündeme geldi ([#103](https://eksisozluk.com/entry/103)).
- Yeni entry, önceki iddiayı görselle destekliyor.
- Karşı taraf henüz ayrıntılı yanıt vermedi.`;

  const topic = {
    id: 'mock-baslik',
    slug: 'mock-baslik',
    url: 'https://eksisozluk.com/mock-baslik--999999',
    title: 'mock başlığı: kademeli özet testi',
    entries,
    entryCount: 3973,
    totalPages: 40,
    fetchedPages: 10,
    truncated: true,
    warning:
      'Başlık 40 sayfa. En yeni 9 sayfa ve ilk sayfa alındı (1000 entry). Tamamı için Ayarlar > Sayfa sınırı değerini artırın.',
    snapshotAt: Date.now() - 3600_000,
    lastAnalysisAt: Date.now() - 3600_000,
    createdAt: Date.now() - 7200_000,
    updatedAt: Date.now() - 60_000,
    lastEntryId: '104',
    dateFrom: '2020-02-02T07:30:00.000Z',
    dateTo: new Date().toISOString(),
    range: 'all',
    rangeAt: Date.now() - 3600_000,
    rangeFrom: null,
    rangeTo: null,
    rangeLabel: 'Tüm başlık',
    stages: {
      ozet: {
        markdown: ozetMarkdown,
        model: 'gpt-oss:120b-cloud',
        createdAt: Date.now() - 3000_000,
        snapshotAt: Date.now() - 3600_000,
        entryCount: 3,
      },
      detay: {
        markdown: detayMarkdown,
        model: 'gpt-oss:120b-cloud',
        createdAt: Date.now() - 2400_000,
        snapshotAt: Date.now() - 3600_000,
        entryCount: 2,
      },
    },
    updates: [
      {
        at: Date.now() - 120_000,
        entryIds: ['103'],
        markdown: updatesMarkdown,
        error: null,
        model: 'gpt-oss:120b-cloud',
        newCount: 1,
      },
    ],
    imageCaptions: {
      [imgA]: { caption: 'Koyu yeşil zeminde “görsel 1” yazan soyut bir mock görsel.', model: 'qwen3-vl:235b-cloud', at: Date.now() },
      [imgB]: { error: 'Model görsel desteği sunmadı (mock).', at: Date.now() },
    },
    images: [
      { url: imgA, entryId: '101', author: 'eski yazar', dateText: '02.02.2020 10:30', entryUrl: 'https://eksisozluk.com/entry/101' },
      { url: imgB, entryId: '103', author: 'meraklı', dateText: '09.11.2024 09:15', entryUrl: 'https://eksisozluk.com/entry/103' },
    ],
    follow: {
      enabled: true,
      intervalMinutes: 30,
      unread: 1,
      lastCheckedAt: Date.now() - 300_000,
      nextCheckAt: Date.now() + 1500_000,
    },
    job: null,
  };

  const topics = [
    {
      id: topic.id,
      slug: topic.slug,
      title: topic.title,
      url: topic.url,
      entryCount: topic.entryCount,
      updatedAt: topic.updatedAt,
      followEnabled: true,
      unread: 1,
      stageCount: 2,
    },
    {
      id: 'ikinci-baslik',
      slug: 'ikinci-baslik',
      title: 'ikinci mock başlığı',
      url: 'https://eksisozluk.com/ikinci-baslik--123',
      entryCount: 120,
      updatedAt: Date.now() - 86400_000,
      followEnabled: false,
      unread: 0,
      stageCount: 1,
    },
  ];

  const settings = {
    provider: 'ollama',
    baseUrl: 'https://ollama.com',
    apiKey: 'sk-mock-anahtar',
    model: 'gpt-oss:120b-cloud',
    visionModel: 'qwen3-vl:235b-cloud',
    temperature: 0.3,
    maxTokens: 3000,
    chunkChars: 24000,
    maxPages: 10,
    autoFirstStage: true,
    followIntervalMinutes: 30,
    notifications: true,
    maxImages: 8,
  };

  const listeners = new Set();

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function respond(message, callback) {
    setTimeout(() => {
      if (!callback) return;

      switch (message.type) {
        case 'getTopics':
          callback({
            ok: true,
            topics: clone(topics),
            settings: { provider: 'ollama', model: 'gpt-oss:120b-cloud' },
            configured: true,
          });
          break;
        case 'getTopic':
          callback({
            ok: true,
            topic: clone(topic),
            settings: { provider: 'ollama', model: 'gpt-oss:120b-cloud' },
            configured: true,
          });
          break;
        case 'getJob':
          callback({ ok: true, job: clone(topic.job), updatedAt: topic.updatedAt });
          break;
        case 'markSeen':
          callback({ ok: true });
          break;
        case 'generateStage': {
          const key = message.stage;
          topic.job = {
            status: 'running',
            kind: 'stage',
            stage: key,
            message: 'Ara özet 2/3 hazırlanıyor…',
          };
          callback({ ok: true });
          setTimeout(() => {
            topic.stages[key] = {
              markdown: `## ${key} (mock)\nBu aşama mock veriyle üretildi.\n\n- Bir madde\n- İkinci madde ([#103](https://eksisozluk.com/entry/103))`,
              model: 'gpt-oss:120b-cloud',
              createdAt: Date.now(),
              snapshotAt: topic.snapshotAt,
              entryCount: 3,
            };
            topic.job = null;
            topic.updatedAt = Date.now();
            for (const listener of listeners) {
              listener({ type: 'job-done', id: topic.id, kind: 'stage', stage: key });
            }
          }, 2500);
          break;
        }
        case 'checkUpdates': {
          topic.job = {
            status: 'running',
            kind: 'check',
            message: 'Yeni entry’ler kontrol ediliyor…',
          };
          callback({ ok: true });
          setTimeout(() => {
            topic.job = null;
            topic.updatedAt = Date.now();
            for (const listener of listeners) listener({ type: 'job-done', id: topic.id, kind: 'check' });
          }, 1800);
          break;
        }
        case 'setFollow':
          topic.follow = {
            ...topic.follow,
            enabled: Boolean(message.enabled),
            intervalMinutes: Number(message.intervalMinutes) || 30,
          };
          topic.updatedAt = Date.now();
          callback({ ok: true, follow: clone(topic.follow) });
          break;
        case 'describeImages': {
          topic.job = {
            status: 'running',
            kind: 'vision',
            message: '1/2 görsel betimleniyor…',
          };
          callback({ ok: true });
          setTimeout(() => {
            topic.imageCaptions[imgB] = {
              caption: 'İkinci mock görselin betimlemesi.',
              model: 'qwen3-vl:235b-cloud',
              at: Date.now(),
            };
            topic.job = null;
            topic.updatedAt = Date.now();
            for (const listener of listeners) listener({ type: 'job-done', id: topic.id, kind: 'vision' });
          }, 2200);
          break;
        }
        case 'analyze': {
          const range = message.range || 'all';
          if (range !== topic.range) {
            const now = Date.now();
            topic.range = range;
            topic.rangeAt = now;

            if (range === 'all') {
              topic.rangeFrom = null;
              topic.rangeTo = null;
              topic.rangeLabel = 'Tüm başlık';
            } else if (range === 'today') {
              const start = new Date();
              start.setHours(0, 0, 0, 0);
              const end = new Date(start);
              end.setDate(end.getDate() + 1);
              topic.rangeFrom = start.getTime();
              topic.rangeTo = end.getTime();
              topic.rangeLabel = `Bugün · ${start.toLocaleDateString('tr-TR')}`;
            } else {
              const days = range === '3d' ? 3 : 7;
              topic.rangeFrom = now - days * 86400000;
              topic.rangeTo = now;
              topic.rangeLabel = `Son ${days} gün`;
            }

            topic.stages = {};
            topic.job = null;
            topic.updatedAt = now;
          }

          callback({ ok: true, id: topic.id, warning: topic.warning });
          break;
        }
        case 'getSettingsFull':
          callback({ ok: true, settings: clone(settings) });
          break;
        case 'saveSettings':
          Object.assign(settings, message.settings || {});
          callback({ ok: true, settings: clone(settings) });
          break;
        case 'testConnection':
          callback({
            ok: true,
            models: ['gpt-oss:120b-cloud', 'deepseek-v3.1:671b-cloud', 'qwen3-vl:235b-cloud'],
            modelsError: null,
            reply: 'ok',
            chatError: null,
          });
          break;
        case 'listModels':
          callback({
            ok: true,
            models: ['gpt-oss:120b-cloud', 'deepseek-v3.1:671b-cloud', 'qwen3-vl:235b-cloud'],
          });
          break;
        case 'storageStats':
          callback({ ok: true, bytes: 1234567, topics: 2, entries: 4093 });
          break;
        case 'clearTopics':
          callback({ ok: true });
          break;
        default:
          callback({ ok: false, error: `Mock bilinmeyen istek: ${message.type}` });
      }
    }, 160);
  }

  window.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(message, callback) {
        respond(message, callback);
      },
      onMessage: {
        addListener(listener) {
          listeners.add(listener);
        },
        removeListener(listener) {
          listeners.delete(listener);
        },
      },
      getURL(path) {
        return new URL(path, location.href).href;
      },
      getManifest() {
        return {
          host_permissions: [
            'https://eksisozluk.com/*',
            'https://ollama.com/*',
            'http://localhost/*',
            'http://127.0.0.1/*',
          ],
        };
      },
      openOptionsPage() {
        console.info('[mock] Ayarlar açılacaktı.');
      },
    },
    permissions: {
      request() {
        return Promise.resolve(true);
      },
      contains() {
        return Promise.resolve(true);
      },
    },
  };
})();

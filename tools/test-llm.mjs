import http from 'node:http';
import assert from 'node:assert/strict';

const root = new URL('../src/lib/', import.meta.url);
const { chat, listModels, testConnection, LlmError } = await import(new URL('llm.js', root));
const { generateStage, summarizeUpdates } = await import(new URL('summarize.js', root));

const calls = [];
let failNext = false;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };

    if (url.pathname === '/api/tags') {
      json(200, { models: [{ name: 'mock:cloud' }, { name: 'vision:cloud' }] });
      return;
    }
    if (url.pathname === '/v1/models') {
      json(200, { data: [{ id: 'openai-mock' }] });
      return;
    }
    if (url.pathname === '/api/chat') {
      if (failNext) {
        failNext = false;
        json(401, { error: 'bad key' });
        return;
      }
      const data = JSON.parse(body || '{}');
      calls.push({ path: url.pathname, auth: req.headers.authorization, data });
      const user = data.messages?.[data.messages.length - 1]?.content || '';
      json(200, {
        message: {
          role: 'assistant',
          content: user.toLowerCase().includes('"ok"')
            ? 'ok'
            : user.includes('AŞAĞIDAKİ ENTRY GRUBU')
              ? 'ARA ÖZET MADDESİ'
              : 'FINAL ÖZET METNİ',
        },
        done: true,
      });
      return;
    }
    if (url.pathname === '/v1/chat/completions') {
      const data = JSON.parse(body || '{}');
      calls.push({ path: url.pathname, auth: req.headers.authorization, data });
      json(200, { choices: [{ message: { role: 'assistant', content: 'OPENAI CEVAP' } }] });
      return;
    }
    json(404, { error: 'not found' });
  });
});

await new Promise((resolve) => server.listen(8931, '127.0.0.1', resolve));

const settings = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:8931',
  apiKey: 'test-key',
  model: 'mock:cloud',
  temperature: 0.2,
  maxTokens: 3000,
  chunkChars: 4000,
};

try {
  // 1) Tek sohbet isteği
  const reply = await chat(settings, [{ role: 'user', content: 'Merhaba' }], { maxTokens: 123 });
  assert.equal(reply, 'FINAL ÖZET METNİ');
  const firstCall = calls[calls.length - 1];
  assert.equal(firstCall.path, '/api/chat');
  assert.equal(firstCall.auth, 'Bearer test-key');
  assert.equal(firstCall.data.model, 'mock:cloud');
  assert.equal(firstCall.data.stream, false);
  assert.equal(firstCall.data.options.num_predict, 123);
  console.log('✓ Ollama chat isteği');

  // 1b) Sınırsız token: num_predict gönderilmemeli
  await chat({ ...settings, maxTokens: 0 }, [{ role: 'user', content: 'Merhaba' }]);
  const unlimitedCall = calls.at(-1);
  assert.equal(unlimitedCall.data.options.num_predict, undefined);
  console.log('✓ Sınırsız token (num_predict yok)');

  // 2) Model listesi
  const models = await listModels(settings);
  assert.deepEqual(models, ['mock:cloud', 'vision:cloud']);
  console.log('✓ Model listesi');

  // 3) Bağlantı testi
  const test = await testConnection(settings);
  assert.equal(test.reply, 'ok');
  assert.equal(test.chatError, null);
  assert.equal(test.models.length, 2);
  console.log('✓ Bağlantı testi');

  // 4) OpenAI uyumlu sağlayıcı
  const openaiReply = await chat(
    { ...settings, provider: 'openai', model: 'openai-mock' },
    [{ role: 'user', content: 'Merhaba' }],
    { maxTokens: 50 },
  );
  assert.equal(openaiReply, 'OPENAI CEVAP');
  const openaiCall = calls[calls.length - 1];
  assert.equal(openaiCall.path, '/v1/chat/completions');
  assert.equal(openaiCall.data.max_tokens, 50);
  console.log('✓ OpenAI uyumlu sağlayıcı');

  // 5) Tek parça aşama üretimi
  const smallTopic = {
    title: 'küçük başlık',
    entries: [
      { id: '1', author: 'a', dateText: '01.01.2024 10:00', favorites: 2, text: 'birinci entry uzun metni' },
      { id: '2', author: 'b', dateText: '02.01.2024 11:00', favorites: 5, text: 'ikinci entry uzun metni' },
    ],
    dateFrom: '2024-01-01T07:00:00Z',
    dateTo: '2024-01-02T08:00:00Z',
  };
  const before = calls.length;
  const stage = await generateStage(smallTopic, 'ozet', settings, () => {});
  assert.equal(stage, 'FINAL ÖZET METNİ');
  assert.equal(calls.length - before, 1);
  const stagePrompt = calls[calls.length - 1].data.messages.at(-1).content;
  assert.match(stagePrompt, /GÖREV — HIZLI ÖZET/);
  assert.match(stagePrompt, /KAYNAK ENTRY’LER/);
  assert.match(stagePrompt, /\[#1\]/);
  console.log('✓ Tek parça aşama üretimi');

  // 5b) Kapsam filtresi: yalnızca bugünkü entry prompt'a girmeli
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const rangedTopic = {
    ...smallTopic,
    range: 'today',
    rangeFrom: todayStart.getTime(),
    rangeTo: tomorrowStart.getTime(),
    rangeLabel: 'Bugün · kapsam testi',
    entries: [
      {
        id: 'old',
        author: 'eski',
        date: new Date(todayStart.getTime() - 86400000).toISOString(),
        dateText: 'dün',
        favorites: 0,
        text: 'ESKI_ENTRY_METNI',
      },
      {
        id: 'new',
        author: 'bugünkü',
        date: new Date().toISOString(),
        dateText: 'bugün',
        favorites: 0,
        text: 'BUGUN_ENTRY_METNI',
      },
    ],
  };

  const beforeRanged = calls.length;
  const rangedStage = await generateStage(rangedTopic, 'ozet', settings, () => {});
  assert.equal(rangedStage, 'FINAL ÖZET METNİ');
  assert.equal(calls.length - beforeRanged, 1);
  const rangedPrompt = calls.at(-1).data.messages.at(-1).content;
  assert.match(rangedPrompt, /Bugün · kapsam testi/);
  assert.match(rangedPrompt, /BUGUN_ENTRY_METNI/);
  assert.doesNotMatch(rangedPrompt, /ESKI_ENTRY_METNI/);
  console.log('✓ Kapsam filtresi');

  // 6) Parçalı (map-reduce) aşama üretimi
  const longEntries = Array.from({ length: 12 }, (_, index) => ({
    id: String(index + 1),
    author: `yazar${index}`,
    dateText: `0${(index % 9) + 1}.01.2024 10:00`,
    favorites: index,
    text: `entry ${index} ${'x'.repeat(1200)}`,
  }));
  const bigTopic = { ...smallTopic, entries: longEntries };
  const beforeBig = calls.length;
  const bigStage = await generateStage(bigTopic, 'detay', settings, () => {});
  assert.equal(bigStage, 'FINAL ÖZET METNİ');
  const bigCalls = calls.slice(beforeBig);
  assert.ok(bigCalls.length >= 4, `beklenen >=4 çağrı, gelen ${bigCalls.length}`);
  assert.match(bigCalls.at(-1).data.messages.at(-1).content, /ARA ÖZETLER/);
  assert.match(bigCalls.at(-1).data.messages.at(-1).content, /ARA ÖZET MADDESİ/);
  console.log(`✓ Parçalı aşama üretimi (${bigCalls.length} çağrı)`);

  // 7) Gelişme özeti
  const update = await summarizeUpdates({
    topic: { ...smallTopic, stages: { ozet: { markdown: 'önceki özet' } } },
    newEntries: [{ id: '3', author: 'c', dateText: '03.01.2024 12:00', favorites: 0, text: 'yeni gelişme metni' }],
    settings,
  });
  assert.equal(update, 'FINAL ÖZET METNİ');
  const updatePrompt = calls.at(-1).data.messages.at(-1).content;
  assert.match(updatePrompt, /ÖNCEKİ ÖZET/);
  assert.match(updatePrompt, /GELİŞME ÖZETİ/);
  console.log('✓ Gelişme özeti');

  // 8) 401 hatası
  failNext = true;
  await assert.rejects(
    () => chat(settings, [{ role: 'user', content: 'Merhaba' }], { maxTokens: 10 }),
    (error) => error instanceof LlmError && /401/.test(error.message) && /anahtar/i.test(error.message),
  );
  console.log('✓ 401 hata mesajı');

  console.log('\nTüm LLM/özet testleri geçti.');
} finally {
  server.close();
}

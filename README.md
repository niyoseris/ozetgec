# Özetgeç — Ekşi Sözlük Özetleyici

Ekşi Sözlük’teki bir başlığı okur; entry’leri, görselleri ve tarihleri toplar.
Ollama Cloud (veya kendi Ollama / OpenAI uyumlu API’niz) ile **kademeli özet**,
**kronoloji**, **tartışma haritası** ve **yeni gelişme takibi** çıkarır. Bütün
rapor tek bir sayfada toplanır.

> Bu uzantı Ekşi Sözlük ile bağlantılı değildir. Yalnızca tarayıcınızda zaten
> açık olan oturumu kullanarak okuma yapar.

## Özellikler

- **Başlığı topluca okur.** Ekşi’de sayfa başına 100 entry vardır. Kısa
  başlıklarda bütün sayfalar, çok uzun başlıklarda en yeni sayfalar + ilk sayfa
  alınır (Ayarlar > Sayfa sınırı).
- **Sayfada “Özet geç” düğmesi.** Başlık sayfasında başlığın hemen altında bir
  düğme, gündem/başlık listelerinde satırın üzerine gelince küçük bir “ö”
  ikonu görünür. Düğme menüsünden **Tüm başlık / Bugün / Son 3 gün / Son 7 gün**
  kapsamı seçilir.
- **Kademeli özet.** Her aşama ayrı ayrı üretilir ve saklanır:
  1. **Hızlı Özet** — 3-5 cümle + öne çıkanlar
  2. **Detaylı Özet** — temalara ayrılmış, entry atıflı
  3. **Kronoloji** — tarih sıralı gelişmeler
  4. **Tartışma Haritası** — taraflar, argümanlar, uzlaşılanlar, açık sorular
- **Kapsam filtreleri.** Bugün, son 3 gün veya son 7 gün seçildiğinde özet,
  entry dökümü ve görseller yalnızca o aralıktaki entry’lerden oluşturulur.
  Kapsam; sayfadaki düğme menüsünden, popup’tan ve raporun sağ rayından
  değiştirilebilir.
- **Görselleri açar.** Entry içindeki `<img>`’ler ve görsel dosyasına giden
  bağlantılar galeriye alınır; büyütme (lightbox) ve yeni sekmede açma vardır.
  İsterseniz görselleri görsel destekli bir modelle betimletebilirsiniz.
- **Gelişme takibi.** “Takip” açıldığında uzantı belirli aralıkla başlığın son
  sayfalarına bakar; özetten sonra eklenen entry’leri bulur, kısa bir “ne
  değişti?” özeti üretir, rozet ve masaüstü bildirimi gösterir.
- **Tek sayfa rapor.** Aşamalar, gelişmeler, görseller ve aranabilir entry
  dökümü aynı sayfada; yazdırma desteği var.
- **Esnek API.** Ollama’nın yerel `/api/chat` biçimi veya OpenAI uyumlu
  `/v1/chat/completions` biçimi. Base URL, API anahtarı ve model serbestçe
  yazılabilir.

## Kurulum

1. Chrome / Brave / Edge’de `chrome://extensions` adresini açın.
2. Sağ üstten **Geliştirici modu**’nu açın.
3. **Paketlenmemiş öğe yükle** → `ozetgec` klasörünü seçin.
4. İlk açılışta veya araç çubuğu menüsünden **Ayarlar**’a girin.

## Ayarlar

| Alan | Açıklama |
| --- | --- |
| **Sağlayıcı** | `Ollama` → `/api/chat`; `OpenAI uyumlu` → `/v1/chat/completions`. |
| **Base URL** | Ollama Cloud: `https://ollama.com`. Yerel: `http://localhost:11434`. Kendi sunucunuz: ör. `https://api.ornek.com`. |
| **API anahtarı** | Ollama Cloud anahtarı: [ollama.com/settings/keys](https://ollama.com/settings/keys). Yerel Ollama genelde anahtar istemez. |
| **Model** | Ör. `gpt-oss:120b-cloud`, `deepseek-v3.1:671b-cloud`. “Modelleri getir” ile listeyi çekebilirsiniz. |
| **Görsel modeli** | Görsel betimlemesi için. Boşsa ana model kullanılır. Ör. `qwen3-vl:235b-cloud`. |
| **Maksimum çıktı token** | 1.000.000’a kadar sayı girilebilir. `0` veya **Çıktı token sınırı yok** = sınırsız (API’ye token parametresi gönderilmez, model bağlamına kadar üretir). Düşünme (reasoning) modellerinde sınırsız veya yüksek değer önerilir. |
| **Parça boyutu** | Uzun başlıklar bu karakter sayısında bölünür; her parça önce ara özetlenir, sonra birleştirilir. |
| **Sayfa sınırı** | Ekşi’de bir sayfa ~100 entry. Uzun başlıklarda en yeni bu kadar sayfa + ilk sayfa alınır. |
| **Takip aralığı** | Varsayılan; her başlık için rapor sayfasından değiştirilebilir. |
| **Görsel erişimi** | Yalnızca “Görselleri AI ile betimle” kullanılacaksa gerekir; görsel sunucularına erişim izni ister. |

**Bağlantıyı test et** formdaki değerlerle çalışır; özetleme ise **kaydedilmiş**
ayarları kullanır. Test başarılıysa mutlaka **Kaydet**’e basın. Kaydedilmemiş
değişiklik varsa alt sağdaki durum çubuğu sizi uyarır.

API anahtarı `chrome.storage.local` içinde saklanır ve yalnızca girdiğiniz API
adresine gönderilir. Entry metinleri özet üretmek için bu adrese iletilir.
Başka bir yere gönderim yapılmaz.

## Kullanım

- Ekşi Sözlük’te bir başlık sayfası açın: başlığın altında **ö Özet geç**
  düğmesi çıkar. Menüden kapsamı seçin; rapor yeni sekmede açılır.
- Gündem/başlık listelerinde bir satırın üzerine gelin: sağda küçük **ö**
  ikonu görünür. Bu ikon varsayılan olarak tüm başlığı özetler.
- Araç çubuğu simgesine tıklayın, başlık adresini yapıştırın, **Kapsam**’ı
  seçin → **→**.
- Ekşi Sözlük’teyken sayfaya/entry bağlantısına sağ tıklayın →
  **Özetgeç ile özetle** (varsayılan kapsam: tüm başlık).
- Rapor sayfasında:
  - **Kapsam** seçicisiyle aralığı değiştirin; başlık yeniden okunur ve özet
    yeni kapsamla üretilir. Kapsam değişince eski aşamalar temizlenir.
  - **Otomatik Hızlı Özet**: analiz biter bitmez üretilir.
  - **Sonraki: …** düğmeleriyle aşamaları sırayla derinleştirin.
  - **Yeniden üret** ile bir aşamayı güncel entry’lerle tekrar çalıştırın.
  - **Gelişmeler**: takip açıksa yeni entry özetleri; değilse “Şimdi kontrol et”.
  - **Görseller**: küçük resme tıklayınca büyür; “Görselleri AI ile betimle”.
  - **Entry dökümü**: yazar, entry numarası veya metinde arama.
- Rapor üstündeki model çipi ayarları, **Yeni başlık** ise ana ekranı açar.

### Kapsamlar

| Kapsam | Ne alınır? |
| --- | --- |
| **Tüm başlık** | Okunan bütün entry’ler (çok uzun başlıklarda en yeni sayfalar + ilk sayfa). |
| **Bugün** | Analiz gününün 00:00 – ertesi gün 00:00 arasındaki entry’ler. |
| **Son 3 gün** | Analiz anından geriye 3 günlük pencere. |
| **Son 7 gün** | Analiz anından geriye 7 günlük pencere. |

Kapsamın başlangıç/bitiş anı analiz sırasında saklanır; “Bugün” seçimi sonraki
günlerde de aynı günü gösterir. Kapsam değiştirmek yeni bir okuma yapar ve
aşamaları temizler; ardından Hızlı Özet otomatik üretilir.

### Aşamalar

Aşamalar birbirinden bağımsız saklanır; önceki aşamaları kaybetmeden yenisini
üretebilirsiniz. Entry sayısı sonradan arttıysa aşama kartında
“+N yeni entry” etiketi görünür; **Yeniden üret** ile güncellenir.

### Takip

1. Rapor sağ rayındaki **Takip** anahtarını açın.
2. Aralık seçin (15 dk – 24 saat).
3. Uzantı, tarayıcı açıkken alarmla son sayfaları kontrol eder.
4. Yeni entry varsa yalnızca onlar özetlenir; “Gelişmeler”e eklenir.
5. Araç çubuğu rozeti okunmamış gelişme sayısını gösterir; rapor açılınca
   okundu sayılır.

Notlar:

- Takip, **tarayıcı kapalıyken çalışmaz**; açıldığında sıradaki kontrol yapılır.
- Entry **düzenlemeleri/silinmeleri** ayrı bir “gelişme” olarak algılanmaz;
  yalnızca yeni entry kimlikleri izlenir.
- Çok uzun başlıklarda ilk kontrolde yalnızca son 10 sayfa taranır (1000 entry).

## Nasıl çalışır?

```
popup / sağ tık
      │
      ▼
service worker ── eksisozluk.com sayfalarını indirir (çerezlerle)
      │                 │
      │                 └─ gerekirse sekmeye enjekte ederek yedek indirme
      ▼
offscreen document ── DOMParser ile entry/görsel/tarih çıkarır
      │
      ▼
chrome.storage.local ── başlık kaydı, aşamalar, gelişmeler
      │
      ▼
rapor sayfası (tek sayfa) ── markdown, galeri, entry dökümü
      │
      ▼
Ollama / OpenAI uyumlu API ── tek istek ya da map-reduce
```

- **Sayfalama:** `pager[data-pagecount]` okunur. Kısa başlıklarda bütün sayfalar;
  uzun başlıklarda en yeni sayfalar + başlığın ilk sayfası alınır. Bu, çok eski
  ve çok yeni entry’ler arasında bağlam kaybını azaltır.
- **Özetleme:** Toplam metin `chunkChars` sınırını aşıyorsa her parça için ara
  özet çıkarılır; final aşama bu ara özetlerden yazılır. Küçük başlıklarda tek
  API çağrısı yapılır.
- **Güvenlik:** Entry metinleri prompt içinde “veri” olarak işaretlenir; modelden
  entry içindeki talimatları uygulamaması istenir. Rapor markdown’ı HTML’den
  arındırılarak gösterilir; yalnızca `http(s)` bağlantılarına izin verilir.
- **Depolama:** `unlimitedStorage`; başlık kayıtları `topic:<slug>` altında,
  liste `topicIndex` altında tutulur.

## Dosyalar

```
manifest.json            Manifest V3
src/background.js        Service worker: analiz, aşamalar, kapsam, takip, alarm
src/content.js           Ekşi sayfalarına "Özet geç" düğmesi ve kapsam menüsü
src/lib/eksi.js          Ekşi indirme, sayfalama, offscreen ayrıştırma köprüsü
src/lib/llm.js           Ollama / OpenAI uyumlu istemci, model listesi, görsel
src/lib/ranges.js        Bugün / son 3 gün / son 7 gün kapsamları
src/lib/summarize.js     Aşama promptları, parçalama, gelişme özeti
src/lib/stages.js        Aşama tanımları (UI + prompt)
src/lib/store.js         Ayarlar ve başlık kayıtları
src/offscreen.html/.js   DOMParser ile HTML ayrıştırma
src/report.html/.css/.js Tek sayfa rapor
src/popup.html/.css/.js  Araç çubuğu menüsü
src/options.html/.css/.js Ayarlar
src/theme.css            Ortak tema
icons/                   Üretilmiş PNG ikonlar
tools/make_icons.py      İkon üretici (Pillow)
tools/test-llm.mjs       API + özet akışı için yerel mock testleri
tools/mock-*.html/.js    Tarayıcıda API’siz arayüz denemesi
```

## Geliştirme / test

```bash
# API istemcisi ve map-reduce akışı (yerel mock sunucu açar)
node tools/test-llm.mjs

# İkonları yeniden üret
python3 tools/make_icons.py

# Arayüzü API olmadan denemek için
python3 -m http.server 8791
# http://127.0.0.1:8791/tools/mock-report.html?id=mock-baslik
# http://127.0.0.1:8791/tools/mock-options.html
# http://127.0.0.1:8791/tools/mock-popup.html
# http://127.0.0.1:8791/tools/mock-content.html
```

`tools/` altındaki mock dosyaları manifest’e dahil değildir; yalnızca geliştirme
içindir.

## Sınırlamalar

- Uzantıyı yeniden yükledikten sonra sayfa içi düğmenin görünmesi için açık
  Ekşi Sözlük sekmelerini yenilemeniz gerekir.
- Ekşi Sözlük oturum/giriş isterse ve Cloudflare doğrulaması görürseniz tarayıcıda
  `eksisozluk.com`’u açıp doğrulamayı geçin; uzantı mevcut sekmeyi yedek olarak
  kullanır.
- Çok büyük başlıklarda (binlerce entry) **tamamı** özetlenmez; Ayarlar’daki
  sayfa sınırına göre en yeni sayfalar + ilk sayfa alınır. Maliyeti düşürmek için
  sayfa sınırını ve parça boyutunu ayarlayabilirsiniz.
- Kapsam filtresi, okunan snapshot üzerinden uygulanır. Kapsamı değiştirmek
  başlığı yeniden okur; “Bugün” gibi kısa aralıklarda yeni entry’ler için
  **Şimdi kontrol et** veya kapsamı yeniden seçmek güncel sonucu verir.
- Model çıktıları hatalı olabilir; önemli bilgileri entry’lerden doğrulayın.
- Ekşi sayfa boyutu değişirse toplam entry tahmini sapabilir; takip yine çalışır.
- Görsel betimlemesi modelin görsel desteğine ve görsel sunucusuna erişim iznine
  bağlıdır.
- API kullanım ücretleri size aittir; uzun başlıklar birden çok çağrı üretir.

## Emeği geçenler

- **Twitter:** [@niyoseris](https://twitter.com/niyoseris)

## Lisans

Bu proje [MIT Lisansı](LICENSE) ile lisanslanmıştır.

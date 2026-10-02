# Veri sağlığı rozeti

Tarih: 2026-10-02 · Sürüm hedefi: 0.20.0

## Amaç
`npm run denetim`'in çapraz kaynak veri denetimini uygulamanın içine taşımak: durum çubuğunda tek bir **rozet** ("VERİ ✓ 14:10"), tıklayınca ayrıntı penceresi ve **Şimdi denetle** düğmesi. Ticari üründe "verinize güvenebilirsiniz" kanıtı. Bu oturumun ana teması olan veri doğruluğunun (0.16.4 denetim betiği) doğal devamı.

Bağlam: ticari ürünleşme hedefi. Kısıtlar: ad küçük harf (kmy terminal), rakip adı geçmez, kişisel tutar çıktıya ve arayüze yazılmaz, UI metinleri `t()` ile (Türkçe/İngilizce), yeni bağımlılık yok, mevcut kaynaklar, `npm run denetim` komutu ve çıkış kodları (0 temiz, 1 sapma, 2 hiçbir şey doğrulanamadı) aynen çalışmaya devam eder.

Kullanıcı onaylı kararlar: **A)** kontroller paylaşılan bir sunucu modülüne taşınır (CLI ince sarmalayıcı olur); denetim **yalnız elle** çalışır (arka plan/zamanlanmış koşu yok); rozet durum çubuğundadır; her manuel koşuda İş Yatırım verisi zorla tazelenir; saf çekirdek `server/`'a taşınır.

## Doğrulanmış olgular
- `scripts/veri-denetimi.mjs` iki evrelidir: evre 1 geçici `BORSA_DATA_DIR` ile kendini yeniden başlatır (portföy modunda gerçek veritabanının kopyasıyla), evre 2 kontrolleri çalıştırır. Kontroller uygulamanın kendi fonksiyonlarını çağırır (`getQuotes`, `tcmbRates`, `universe`, `financials`, `pf.summary`), yani sunucu içinde çalışırsa kullanıcının gördüğü fiyat yolunu (aynı önbellekler) sınar.
- Saf çekirdek `scripts/denetim-cekirdek.mjs`'tedir; `test/denetim.test.mjs` onu içe aktarır (62 kontrol).
- Durum çubuğu `web/index.html`'de `#sbInfo`, `#mktStatus`, `#quoteFresh` öğelerinden oluşur; `.freshness` stili hazırdır.
- Sunucu rota kalıbı: `route('GET', '/api/...', async ({ q }) => ...)`, fırlatılan hata 400 + Türkçe ileti; WebSocket yayını `broadcast({ t: '…' })`, istemci `on('ws:…')`.
- Seans açıkken hisse kontrolü ATLANDI olur (İş Yatırım "kapanış" değeriyle gün içi fiyat karşılaştırılamaz); bu durum rozette hata sayılmaz.

## Mimari
- `scripts/denetim-cekirdek.mjs` → **`server/denetim-cekirdek.js`** (`git mv`; saf, ağsız, veritabansız). Mevcut dışa aktarımlar aynen kalır (`TOLERANS`, `SAF_GR`, `karsilastir`, `guard`, `gramRef`, `gramKarar`, `fxKarar`, `hisseKarar`, `etiketKarar`, `donemAnahtar`, `temelKarar`, `portfoyKarar`, `rapor`, `cikisKodu`). `test/denetim.test.mjs` ve CLI içe aktarma yolları güncellenir. Yeni saf dışa aktarımlar: `ozet(results)`, `rozetDurumu(results)` ve `eskiMi(at, now)`.
- **`server/denetim.js`** (yeni, ağ + durum): `runChecks({ portfoy = true } = {}) → results[]` mevcut betiğin kontrollerini aynen içerir (döviz ↔ TCMB, gram altın, altın türleri, hisse ↔ İş Yatırım, TEFAS, tazelik, temel oranlar, portföy). Sonuç satırı biçimi değişmez: `{ grup, ad, durum, sapmaPct?, app?, ref?, neden? }`.
  - Yeniden başlatma ve geçici veritabanı **yoktur**; doğrudan uygulama fonksiyonları çağrılır.
  - İş Yatırım verisi her koşuda `universe.refresh(true)` ile zorla tazelenir; `isyTaze` mantığı betikteki gibi (tazelenemediyse hisse ve F/K kontrolleri ATLANDI).
  - Portföy kontrolü `pf.summary()` ile çalışır; satırlarda `app` ve `ref` **null** yazılır (tutar saklanmaz ve gösterilmez).
  - Tek koşu kuralı: koşu sürerken gelen ikinci istek aynı koşunun sonucunu bekler (yeni koşu başlamaz).
  - Genel zaman aşımı 120 sn; aşılırsa `Error('Denetim zaman aşımı')`. Tek tek kaynak hataları zaten kontrol bazında ATLANDI'dır; yalnız beklenmeyen istisna koşuyu düşürür.
  - `run()`: koşar, sonucu kaydeder, `at` ile döndürür. `last()`: kayıtlı son sonucu okur.
- **Kalıcılık:** `data_health(id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL, results TEXT NOT NULL)`; tek satır, her koşu üzerine yazar. Yeniden başlatmada rozet son sonucu gösterir.
- `scripts/veri-denetimi.mjs`: evre 1 (yeniden başlatma, geçici veritabanı, `--portfoy` kopyası) aynen kalır; evre 2 `runChecks({ portfoy: flag('--portfoy') })` çağırıp mevcut `rapor`/JSON çıktısını ve çıkış kodunu üretir. **Davranış ve çıktı değişmez.**

### Rozet durumu (saf, test edilir)
`rozetDurumu(results) → 'yok' | 'temiz' | 'uyari' | 'dogrulanamadi'`; ayrıca `eskiMi(at, now) → boolean` (`at != null && now − at > 24 saat`) ayrı bayraktır (herhangi bir durumun üstüne eklenir; sunucu `stale` olarak döndürür, istemci aynı kuralı yerel saatle yeniden değerlendirir).
- `yok`: `results` yok ya da boş / hiç çalışmadı.
- `uyari`: en az bir SAPMA.
- `dogrulanamadi`: SAPMA yok ve OK yok (hepsi ATLANDI).
- `temiz`: SAPMA yok ve en az bir OK (ATLANDI satırları hata sayılmaz, sayısı gösterilir).

`ozet(results) → { ok, sapma, atlandi }`.

### API
- `GET /api/data-health` → `{ at: number|null, summary: { ok, sapma, atlandi }, state, stale, results: [...], running: boolean }`; hiç çalışmadıysa `at: null`, `state: 'yok'`, `results: []`.
- `POST /api/data-health/run` → koşar (≈20 sn), aynı biçimi döner. Koşu bitince `broadcast({ t: 'data-health.updated' })`; açık diğer pencereler `GET` ile yenilenir.
- Beklenmeyen koşu hatası 400 + ileti (rozetin önceki durumu bozulmaz).

### Arayüz
- Durum çubuğunda `#quoteFresh`'ten sonra **rozet düğmesi** (`#dhBadge`): `VERİ ✓ 14:10` (yeşil, temiz), `VERİ ⚠ 2` (turuncu/kırmızı, SAPMA sayısı), `VERİ ?` (gri, doğrulanamadı), `VERİ · denetlenmedi` (gri, yok); eskiyse sonuna `(eski)` eklenir. İpucu: `OK 26 · SAPMA 0 · ATLANDI 7 · son denetim 14:10`. `stale` istemcide `at` ile 24 saat kuralından yeniden hesaplanır ve 10 dakikada bir tazelenir (açık bırakılan uygulamada rozet kendiliğinden "eski"ye döner).
- Tıklayınca **"Veri sağlığı" penceresi** (`modal`): başlıkta rozet durumu ve son denetim zamanı; **Şimdi denetle** düğmesi (koşu sürerken kilitli, dönen gösterge, çift tıklama yeni koşu başlatmaz); kontroller **grup grup** tabloda (kontrol · durum etiketi · sapma % · neden), **SAPMA satırları en üstte**; piyasa verisi satırlarında uygulama ve referans değeri görünür, portföy satırlarında yalnız yüzde. Altta açıklama: "ATLANDI hata değildir, doğrulanamadı demektir (seans açık, kaynak erişilemedi…). Denetim bağımsız ikinci kaynaklarla karşılaştırır: TCMB, İş Yatırım, TEFAS, KAP mali tabloları."
- Ağ yok / koşu hatası: pencerede hata iletisi, rozet son geçerli durumu korur.
- Türkçe/İngilizce (`web/js/lang/en/*`), 760 px'te taşma yok.

## Hata yönetimi
- Kaynak hataları kontrol bazında ATLANDI'dır (mevcut `guard`); hiçbiri SAPMA üretmez.
- Hiçbir şey doğrulanamazsa (hepsi ATLANDI) rozet `?` olur, "temiz" gösterilmez (sahte yeşil yok).
- Eşzamanlı çağrılar tek koşuya birleşir; koşu sürerken `GET`, `running: true` döner.
- Tablo bozuksa ya da kayıt okunamazsa `GET`, `state: 'yok'` döner (çökme yok).

## Testler (`test/denetim.test.mjs`'e eklenir, çevrimdışı)
- `rozetDurumu`: `yok` (null/boş), `uyari` (1 SAPMA), `dogrulanamadi` (hepsi ATLANDI), `temiz` (OK + ATLANDI), SAPMA öncelikli (OK ve SAPMA birlikte → uyari).
- `eskiMi`: tam 24 saat eski değil, 24 saat + 1 ms eski; `at` null → false.
- `ozet`: sayım doğruluğu, boş girdi, bilinmeyen durum satırı sayılmaz.
- Mevcut 62 kontrol yeni dosya yolunda aynen geçer.
- **Canlı doğrulama** (uygulama sırasında): sunucudan çalıştırınca sayılar CLI ile aynı; ikinci eşzamanlı istek tek koşu üretir; yeniden başlatınca rozet son sonucu gösterir; ağ kapalıyken (TCMB hatası simülasyonu) rozet `?`/ATLANDI davranışı; seans açıkken hisse kontrolü ATLANDI (rozeti bozmaz); portföy satırlarında tutar yok (`app`/`ref` null); rozet ve pencere 1440, 900 ve 760 px'te, Türkçe ve İngilizce; `npm run denetim` çıktısı ve çıkış kodu değişmedi.

## Kapsam dışı
Arka plan/zamanlanmış denetim, bildirim, sonuç geçmişi ve grafiği, tolerans ayarı arayüzü, Ayarlar'da ayrı bölüm, yeni kontrol türleri (KAP bildirim tarihleri, kurum hedefleri, endeks değerleri), kontrol bazında yeniden çalıştırma.

## Bilinen sınırlar (belgelenecek)
- Denetim elle çalışır: rozet son koşuyu gösterir ve 24 saatten sonra "eski" olur; bu bir sağlık **izlemesi** değil son denetimin kanıtıdır.
- Hisse kontrolü seans açıkken ATLANDI'dır; tam sonuç için kapanıştan sonra denetleyin.
- Koşu birkaç kaynağa istek yapar (TCMB, İş Yatırım, TEFAS, KAP mali tablolar) ve yaklaşık 20 sn sürer; İş Yatırım verisi her koşuda zorla tazelenir.

## Başarı ölçütü
Durum çubuğundaki rozet son denetimin sonucunu doğru ve dürüst gösterir (sahte yeşil yok); **Şimdi denetle** sunucu içinde çalışıp CLI ile aynı sayıları üretir; tutarlar arayüze ve kayda yazılmaz; `npm run denetim` aynı çıktı ve çıkış koduyla çalışır; `npm test` yeşil; 760 px'te taşma yok.

# Sürüm Notları

## 0.21.1 — 5 Ekim 2026 (backtest küçük düzeltmeler)

### Düzeltilen
- **Bozuk kapanış:** kapanışı 0, boş ya da negatif olan mum artık radar, bildirim ve backtest'te seriden atılır (eskiden sahte `rsi_os`/`low52`/`sma200_dn`/`macd_dn` üretiyor, SMA200'ü 200 mum bozuyordu).
- **Isınma 210 → 252 mum:** ilk 40 gündeki 52 hafta zirve/dip olayları gerçekte ~10 aylıktı.
- **XU100 hatasında kilit:** XU100 çekimi hata verince hisse çekimleri arka planda sürüyordu; hemen yeniden denemek Yahoo'ya iki kat istek yolluyordu. Artık hisse çekimleri bitmeden koşu hata verir.
- **Geç biten koşu:** zaman aşımından sonra biten hesap kaydedilir ve pencerelere bildirilir (eskiden atılıyordu).
- **Olay döngüsü:** hesap hisseler arasında kontrol bırakır (eskiden ~1,3 sn kesintisiz bloklardı).
- **Önbellek:** koşu sonunda 10 yıllık geçmiş satırları silinir; `http_cache` tavanı (300 satır / 50 MB) dolup diğer kayıtları düşürmez.
- **Arayüz:** başka pencerede yeni sonuç gelince eski hata notu kalmaz; ilk yükleme hatası "hiç hesaplanmadı" gibi görünmez; bedelsiz uyarı metni doğru sınırı söyler ("fiyatı %25'ten az düşüren, ≈%33'e kadar"); dört sunucu hata iletisinin İngilizcesi eklendi.
- **Testler:** bölünme testi sıkılaştı (bölünmeli seri, bölünmesiz eşdeğerinden taban medyanında < 0,01 sapar); koşu kilidi testi `npm test` zincirinde (500 kontrol + 15 kilit kontrolü).

## 0.21.0 — 5 Ekim 2026 (sinyal geçmiş performansı)

### Yeni
- **"Sinyal geçmiş performansı" paneli** (KMY TERMINAL › tarayıcı sayfası). Radardaki 11 sinyalin BIST 100'de 10 yıllık günlük veride, sinyal gününü izleyen günün açılışından sonraki 5/20/60. işlem günü kapanışına kadar ne yaptığı: olay sayısı (n), ortalama getiri, isabet (yöne duyarlı: düşüş sinyalinde getiri < 0), **XU100'a göre fark** ve **taban farkı** (her günün ortalamasına göre). Taban satırı tablonun başındadır; n < 30 olanlar soluk ve ⚠. Hesap **yalnız elle** başlar ("Hesapla"), sonuç `backtest_result` tablosunda saklanır. `GET /api/backtest`, `POST /api/backtest/run` (300 sn zaman aşımı; iç koşu bitene kadar yeni koşu başlamaz; hata durumunda da diğer pencerelere bildirilir, istemci koşu sürerken yoklar).
- **Dürüstlük:** olay = sinyalin yeni belirdiği gün (devam eden gün sayılmaz), aynı sinyalde 20 işlem günü içindeki tekrar sayılmaz; yalnız bugünkü BIST 100 (hayatta kalma yanlılığı), nominal TL, işlem maliyeti yok, örtüşen olaylar; panelde bu uyarılar yazılıdır. Ölçüm (test örneği): 99 hisse, 2017-07 → 2026-10, 13 bölünme kırılması düzeltildi; tablo 11 sinyal × 3 ufuk, taban 20 günde +%3,1 (enflasyonlu TL).
- **Bölünme düzeltmesi** (`server/seri.js`): Yahoo BIST serileri bölünmeye göre düzeltilmemiş; günlük kapanış oranı < 0,75 veya > 1,30 ise önceki mumlar oranla çarpılır (hacim bölünür). Sınır dahil değildir (−%25 ve +%30 kırılma değil).
- **Tek sinyal tanımı** (`server/sinyal-tanim.js`): radar, bildirim ve backtest aynı kuralları kullanır. Refactor davranışı değiştirmedi: 930 noktalık altın-referansta çıktı birebir aynı; önek eşdeğerliği (ileriye bakma yok) 396/396.

### Dikkat
- Bölünme düzeltmesi **canlı radar ve sinyal bildirimlerine de** uygulanır: son bölünmeden sonra sahte sinyal (ör. sahte 52 hafta dibi) üretmez. Bu yüzden bildirimlerde tek seferlik "yeni sinyal" görülebilir.
- Testler: 413 → 495 kontrol (`radar` 12, `seri` 25, `backtest` 45); koşu kilidi `test/backtest-run.check.mjs` ile (`BORSA_DATA_DIR=$(mktemp -d) node test/backtest-run.check.mjs`, zincirde değil).

## 0.20.0 — 2 Ekim 2026 (veri sağlığı rozeti)

### Yeni
- **Durum çubuğunda "VERİ" rozeti.** `npm run denetim`'in çapraz kaynak denetimi artık uygulamanın içinde: rozet son denetimin sonucunu gösterir (`VERİ ✓ 14:10` temiz, `VERİ ⚠ 2` sapma var, `VERİ ?` hiçbir şey doğrulanamadı, `VERİ · denetlenmedi`; son denetim 24 saatten eskiyse `(eski)` ve soluk). Tıklayınca **Veri sağlığı** penceresi: kontroller grup grup (SAPMA içeren gruplar ve satırlar en üstte), sapma yüzdesi, uygulama ↔ referans değeri, neden; **Şimdi denetle** düğmesi (koşu ≈40 sn, sürerken kilitli, çift tıklama ikinci koşu başlatmaz; açık diğer pencereler WebSocket ile güncellenir). Denetim **yalnız elle** çalışır (arka plan koşusu yok); sonuç `data_health` tablosunda saklanır, yeniden başlatmada rozet son sonucu gösterir. `GET /api/data-health`, `POST /api/data-health/run`.
- **Sahte yeşil yok:** rozet yalnız SAPMA yokken ve **canlı çapraz kaynak grubunda** (döviz, altın, altın türü, hisse, TEFAS) en az bir OK varken yeşildir. Hiçbir şey doğrulanamazsa (ağ yok, seans açık) gri `?` olur. Temel oranlar, tazelik ve portföy toplamları iç tutarlılık kontrolleridir ve tek başına yeşile yetmez: sunucuda mali tablo önbelleği 12 saat sıcak kalır, ağ yokken bunlar OK dönmeye devam ederdi (taze inceleme bunu yakaladı; CLI boş geçici veritabanıyla başladığı için yaşamıyordu). ATLANDI hata sayılmaz; seans açıkken hisse kontrolü bu yüzden rozeti bozmaz.
- **Uygulamanın gördüğü veri sınanıyor:** kontroller sunucu içinde, kullanıcının gördüğü fiyatla aynı önbellekler üzerinden çalışır (CLI ayrı bir süreçte kendi kopyasını sınıyordu). İş Yatırım verisi her koşuda zorla tazelenir.
- **Tek kaynak:** kontroller `server/denetim.js`'e, saf çekirdek `server/denetim-cekirdek.js`'e taşındı; `npm run denetim` aynı fonksiyonu çağırır, çıktısı ve çıkış kodları (0/1/2) aynı. Ölçüm: sunucu modülü CLI ile aynı sayıları üretti (26 OK · 0 SAPMA · 7 ATLANDI, 33 satır).
- Rozet mantığı için 24 yeni çevrimdışı kontrol (`ozet`, `rozetDurumu` ve canlı grup kuralı, `eskiMi`; toplam 86).
- **Koşu kilidi ve takılı kalma:** zaman aşımından sonra iç koşu iptal edilemediği için kilit ona kadar tutulur (üst üste ikinci koşu yok: ölçüm, eski kodda ikinci çağrı kendi koşusunu başlatıyor ve `running: false` gösteriyordu; yenide "Önceki denetim hâlâ sürüyor" ve `running: true`). Başarısız koşu da diğer pencerelere bildirilir ve istemci koşu sürerken yoklar: koşu sürerken yenilenen pencere meşgul görünür, koşu hata verince kendiliğinden serbest kalır.

### Bilinen
- Rozet bir **izleme** değil, son denetimin kanıtıdır: elle çalışır ve 24 saatten sonra "eski" olur.
- Hisse kontrolü seans açıkken ATLANDI'dır; tam sonuç için kapanıştan sonra denetleyin.
- Koşu birkaç kaynağa istek yapar (TCMB, İş Yatırım, TEFAS, KAP mali tablolar) ve yaklaşık 40 sn sürer; zaman aşımı 120 sn.
- Portföy kontrolü satırlarında tutar saklanmaz ve gösterilmez, yalnız durum ve sapma yüzdesi.
- Dinamik neden metinleri ("hata: …", "dönem uyuşmuyor: …") İngilizce arayüzde Türkçe kalır.

## 0.19.0 — 2 Ekim 2026 (takvim sayfası)

### Yeni
- **TAKVİM sayfası** (terminal › `#/pazar/takvim`, komut `TAKVIM` / `CAL`, ana sayfada yeni kart). Temettü ve sermaye artırımı, TCMB günleri ve bilanço sezonu tek listede, gün gün ("Son günler / Bugün / Yarın / Bu hafta / Daha sonra"). Kapsam: Listem / Portföyüm / Tümü (seçim hatırlanır; hiç seçilmediyse portföy, boşsa liste); tür süzgeçleri: Temettü · Sermaye artırımı · TCMB · Bilanço. Her satırda **KESİN** ya da **TAHMİNİ** etiketi; tahmininin ipucu gerekçeyi taşır. Piyasa özetindeki Temettü takvimi paneli yerinde kalır, "Tüm takvim →" bağlantısı eklendi. `GET /api/calendar?scope=&from=&to=&kinds=`.
- **TCMB takvimi** tcmb.gov.tr'deki resmî tablodan hücre bazlı okunur: PPK karar günü, toplantı özeti, Enflasyon Raporu, Finansal İstikrar Raporu (2026 ve 2027 Haziran'a kadar). Günde bir çekilir. Sayfa biçimi değişirse (sütun adı, 8'den az PPK tarihi) **hata verir, sessizce boş takvim göstermez**; çekilemezse son başarılı kayıt "eski" işaretiyle kullanılır; hata sonrası 5 dakika yeniden denenmez (her tıklama 10 sn beklemesin).
- **Bilanço sezonu** (yalnız Listem ve Portföyüm; KAP istek sınırı nedeniyle): açıklanan dönem **kesin** ve gerçek tarihiyle; açıklanmayan dönem için iki **tahmini** satır: "bekleniyor" (geçen yıl aynı dönemin açıklama günü, hafta sonuna denk gelirse önceki iş günü, 29 Şubat → 28 Şubat) ve "yasal son teslim" (dönem sonu + SPK II-14.1 süresi: 3 ve 9 aylık 30/40, 6 aylık 50/60, yıllık 60/70 gün, solo/konsolide; hafta sonu → pazartesi; resmî tatil hesaba katılmaz). Konsolide olup olmadığı KAP başlıklarından anlaşılır: "(Konsolide)" konsolide, "(Konsolide Olmayan)" solo (gerçek veride 7 kayıt; bu başlık "konsolide" sözcüğünü de içerdiği için ayrıca denetlenir, ilk yazımda solo şirketler yanlışlıkla konsolide sayılıyordu); ifade yoksa konsolide süre varsayılır ve belirtilir. Tümü kapsamında hisse bazlı değil, yalnız sembolsüz sezon son teslimi gösterilir.
- **Doğruluk kanıtı:** portföy ve listedeki 8 hissede KAP'ın gerçek açıklama tarihleri hesaplanan yasal son teslimle karşılaştırıldı: 32 gözlemin **hiçbiri** son teslimi aşmadı; BIMAS üç dönemde tam son teslim gününde açıkladı (11 Kasım 2025, 11 Mart, 11 Mayıs 2026), bu da 40 ve 70 günlük konsolide sürelerini doğruluyor.
- **İstek hacmi KAP'ı korur:** yalnız istenen türlerin kaynağına gidilir (ör. yalnız TCMB seçiliyken KAP'a istek yok: ölçüm 6 → 0), aynı sembol için eşzamanlı çağrılar tek isteğe birleşir (4 eşzamanlı takvim çağrısı: 23 → 6 KAP isteği), geçersiz tarih ağ işinden önce reddedilir (6 KAP + 1 TCMB isteği → 0). KAP hız sınırına takılmak uygulamanın ana KAP akışını da boşaltır.
- Takvim sayfası her gösterildiğinde yeniden çizilir: açık bırakılan uygulamada gece yarısından sonra eski "Bugün"/"Yarın" kalmaz.
- `server/takvim.js` (saf kurallar) için 88 çevrimdışı kontrol (`test/takvim.test.mjs`, gerçek TCMB tablosunun kopyasıyla), `npm test` zincirinde.

### Düzeltilen
- **KAP'ta yıllar sonra gelen düzeltme kayıtları ilk açıklama sayılıyordu.** 8 hissenin 5'inde `2025/1` dönemi için 2026'da (ASELS 25 Eylül, GARAN 11 Haziran, FROTO 1 Nisan, EREGL 17 Şubat, KCHOL 5 Ağustos) yayımlanmış finansal rapor kaydı var; bunlar yeniden sunum/düzeltmedir. Süzülmeseydi "geçen yılın tarihi" yanlış olabilirdi: yasal son teslimden 90 günden fazla sonra gelen kayıtlar artık atılıyor.

### Bilinen
- Bilanço tarihleri tahmindir (geçen yılın günü ve yasal süre); resmî tatiller hesaba katılmaz. Açıklanmış dönemler kesindir.
- Temettü satırındaki "Tarih", İş Yatırım tablosundaki tek "Tarih" sütunudur; hak kullanım mı ödeme mi olduğu kaynakta belirtilmemiştir.
- KAP şirket sorgusu 365 gün ile sınırlı olduğundan geçen yıl kaydı yalnız son 365 günde varsa "bekleniyor" satırı üretilir; yoksa yalnız yasal son teslim görünür.
- Takvim pencerede ve günlük çözünürlüktedir (saat bilgisi yok); TÜFE açıklama günü, hatırlatıcı ve .ics dışa aktarma bu sürümde yoktur.

## 0.18.0 — 2 Ekim 2026 (sinyal bildirimi)

### Yeni
- **Sinyal bildirimi.** Sunucu, seans kapandıktan sonra günde bir kez (normal gün 18:30, yarım gün 12:50) izleme listesini ve portföydeki BIST hisselerini tarar; yalnız **yeni** çıkan sinyalleri tek toplu bildirimle haber verir: "3 yeni sinyal: THYAO Altın kesişim · ASELS 52 hafta zirvesi · …", "Aç" düğmesi ilk sembolü açar. Günlük mum kesinleştikten sonra taranır, gün içinde belirip kaybolan sinyal bildirim üretmez. Bildirim izni yoksa ekran içi bildirime düşer.
- **Yeni sinyal ne demek (server/sinyal.js, 37 çevrimdışı kontrol):** önceki taramada yoktu, şimdi var. Sinyal kaybolup geri gelirse yeniden bildirilir. Durum tüm sinyal türlerini saklar; bir türü sonradan açmak mevcut sinyalleri bildirim yağmuruna çevirmez. İlk çalıştırma ve listeye yeni eklenen sembol sessizce taban çizgisine alınır. Taranamayan sembolün önceki durumu korunur, kapsamdan çıkan sembol durumdan düşer. Taramaların yarısından azı başarılıysa tamamlanmış sayılmaz ve 10 dakikada bir yeniden denenir. Hafta sonu, resmî tatil, seans öncesi ve kapanış seansı taranmaz.
- **Varsayılan açık sinyaller:** altın kesişim, ölüm kesişimi, 52 hafta zirvesi, 52 hafta dibi, SMA200 yukarı/aşağı kırılım (seyrek, trend belirleyici). RSI, MACD ve hacim sık çıktığından varsayılan kapalı. Ayarlar › Veri › "Sinyal bildirimleri": genel anahtar ve sinyal başına onay kutusu (`signalNotify`, `signalTypes`).
- **"Son sinyal bildirimleri" paneli** (Dashboard › Tarayıcı, Sinyal radarının altı): son 14 günün bildirimleri; uygulama kapalıyken kaçırılanlar burada görünür. `GET /api/signals/recent`, `GET /api/signals/types`; tablolar `signal_state`, `signal_log`, `signal_meta`.
- Canlı doğrulama (gerçek veritabanı kopyası): kapsam 8 BIST hissesi; ilk tarama 0 bildirim (taban çizgisi: ASELS SMA200 yukarı kırılım, FROTO 52 hafta dibi), ikinci tarama 0 bildirim; durumdan bir sinyal silince yeniden taramada tam o sinyal "yeni" olarak çıktı ve kayda yazıldı. İstemci tarafı WebSocket mesajı simüle edilerek (Türkçe ve İngilizce) doğrulandı.

### Düzeltilen
- **Fiyat eşikleri yalnız ekranda açık olan sembol için bildirim veriyordu.** `alerts.fired` mesajı sunucudan tüm eşikler için geliyordu ama istemci `a.symbol !== curSym` ise hiçbir şey göstermiyordu: THYAO eşiği tetiklendiğinde GARAN açıksa haber yoktu. Artık açık olmayan semboller ekran içi bildirim ve sistem bildirimi alıyor (açık sembol için eski toast aynen kalıyor, çift bildirim yok).

### Bilinen
- Gerçek macOS uygulamasında doğrulanmadı: pencere kapatıldığında uygulama pencereyi yalnız gizliyor (`orderOut`) ve web görünümü canlı kalıyor, bu yüzden bildirimin gelmesi beklenir; ancak uygulama tamamen kapalıyken (gateway çalışırken bile) sistem bildirimi gelmez, kaçırılanlar "Son sinyal bildirimleri" panelinde görünür.
- Tarama yalnız seans kapandıktan sonra yapılır; uygulama o gün 18:30 ile gece yarısı arasında hiç çalışmazsa o günün taraması atlanır, sonraki işlem günü önceki taramaya göre "yeni" olanları bildirir.
- Seans kapanışından sonra tarama için Yahoo'nun ~15 dk gecikmesi gözetilerek 18:30 seçildi; kapanış mumu 18:30'da hâlâ eksikse bir sonraki gün düzelir.

## 0.17.0 — 2 Ekim 2026 (kurum hedef fiyatı portföyde)

### Yeni
- **Kurum hedef fiyatı artık portföy ekranında.** Varlıklar tablosunda "Hedef" sütunu: kurumların medyan hedef fiyatına uzaklık (`+12,6%`), altında "2 kurum · 2 TUT"; ipucunda medyan fiyat, AL / TUT / SAT dağılımı ve en yeni rapor tarihi. Tablo altbilgisinde ve Özet'teki yeni "Kurum hedefi" şeridinde kapsam ve ağırlıklı hedef getiri: "hisse değerinin %70'i kapsamda (3/6 hisse) · ağırlıklı hedef getiri +10,3%". Veri zaten toplanıyordu (`analyst_targets`) ama yalnız Raporlar'da görünüyordu. `GET /api/portfolio` her pozisyona `target`, toplamlara `totals.target` ekler; ajanın `get_portfolio` aracı bunu otomatik görür.
- **Doğruluk kuralları** (`server/hedef.js`, 33 çevrimdışı kontrol): kurumun en yeni görüşü 180 günden eskiyse sayılmaz (daha eski satıra düşülmez); rapordan sonra bedelsiz sermaye artırımı olan hissenin hedefi sayılmaz (fiyat ölçeği değişir); yalnız TL cinsi BIST hisseleri uygundur (fon, altın, yabancı varlık kapsam dışı); canlı fiyatı olmayan (son işlem fiyatıyla değerlenen) pozisyonda yüzde hesaplanmaz; yalnız önerisi olan kurum medyana girmez ama AL/TUT/SAT sayısına girer; ağırlıklı getiri yalnız kapsamdaki pozisyonların değeriyle ağırlıklanır ve kapsam yüzde olarak gösterilir.
- Canlı doğrulama (gerçek veritabanı kopyası): THYAO 330 ₺ (1 kurum), ASELS 421 ₺ (2 kurum), TUPRS 352 ₺ (1 kurum) medyanları `/api/research/consensus` ile birebir aynı; 8 pozisyonun 6'sı uygun, 3'ünde hedef var.

### Düzeltilen
- **Varlıklar tablosunda uzun fon adı sütunu şişiriyordu.** TTE gibi fonların tam adı tek satırda sembol sütununu ~350 px'e çıkarıp sağdaki sütunları kaydırmanın arkasına itiyordu. Ad artık 200 px'te kısalıyor, tam ad ipucunda.

### Bilinen
- Hedef verisi yalnız dört kurumun raporundan çıkarılabiliyor (AK Yatırım, Yapı Kredi, İş Yatırım, Tacirler); bu yüzden kapsam portföyden portföye değişir ve her zaman gösterilir.

## 0.16.6 — 2 Ekim 2026 (dar pencere: fiyat şeridi, araç çubuğu, küçük hedefler)

### Düzeltilen
- **Fiyat şeridi dar ekranda hücreleri üst üste bindiriyordu.** Hücreler daralabildiği için `fitTicker()` sığmayanları gizleme koşulunu hiç sağlamıyordu (`scrollWidth > clientWidth` hiçbir zaman doğru olmuyordu), içerik komşu hücreye taşıyordu (640 px'te 7 hücre ~96 px'e sıkışıyordu). Artık koşul "içerik kendi hücresinin sınırını aşıyor mu?" ve aşıyorsa sağdaki hücre gizleniyor. Ölçüm: 640 px'te 5 hücre, taşma 0; 1440 px'te 11 hücre, taşma 0 (önceden 12 hücre, bir kısmı sıkışık).
- **KMY terminal araç çubuğu dar sütunda kesiliyordu** (YENİLE düğmesi yarım, sembol özeti "THYAO 2…"). Çubuk artık kendi genişliğine göre uyum sağlıyor: 760 px'in altında sembol özeti, 560 px'in altında sekme numaraları ("1)", "2)"…), YENİLE yazısı gizleniyor ve dolgular daralıyor. Düğmeler ⟳ ve ⌂ simgesiyle her zaman görünüyor; kısayol numaraları ipucunda duruyor. Ölçüm: 900 px'te (sütun 495 px) hiçbir düğme kesilmiyor, kaydırma gerekmiyor.
- **Küçük tıklama hedefleri en az 22 px oldu:** izleme listesi sıralama düğmesi (16×24 → 24×24), "ARKA PLAN İŞİ" düğmesi (13 → 22 px), `ghost.xs` düğmeleri (19 → 22 px), terminal başlığındaki KMY TERMINAL düğmesi (13 → 22 px). 9,5 px yazılar 10 px'e çıkarıldı ("15 dk" etiketi, sayaç kartı başlıkları).

### Bilinen
- Tarayıcı tablosundaki iki dikey kaydırma çubuğu kasıtlı: sayfa, tablonun altındaki Sinyal radarına ulaşmak için kayıyor; tablonun iç kaydırması sabit başlığı koruyor.
- macOS uygulamasının asgari pencere genişliği 760 px'tir; 640 px yalnız tarayıcıda görülür.
- Boyut değişimi `resize` olayı gönderen gerçek pencerelerde şeridi yeniden sığdırır; geliştirici aracındaki boyut emülasyonu olayı göndermediği için orada sayfayı yenilemek gerekir.

## 0.16.5 — 2 Ekim 2026 (kesilen değerler, dar panelde tarayıcı)

### Düzeltilen
- **Portföy değer kartlarında sayılar kesiliyordu.** Başlık kartında `₺1.127.985` yerine `₺1.127…`, Risk sekmesinde `+142,8…` (toplam getiri) ve `+40,9% / -14…` (en iyi/en kötü ay) görünüyordu: `.kpi .v` sabit 22 px (başlık 38 px), `nowrap` ve `ellipsis` ile kesiyordu. Artık değer sığana kadar yazı küçülüyor (alt sınır 13 px; altında eski üç nokta davranışı kalır). Panel boyutu, sekme, yazı tipi veya içerik değişince yeniden sığdırılıyor. Ölçüm (1440 px, sohbet paneli açık): kesilen değer 3 → 0; başlık 38 → 30 px.
- **Hisse tarayıcısında filtre sütunları dar panelde görünmüyordu.** 900 px genişlikte yalnız Sembol, Ad ve Sektör görünüyor, Kapanış / F/K / PD/DD yatay kaydırmanın arkasında kalıyordu. Tablo kabı 600 px'in altına inince Sektör ve Piyasa değeri sütunları gizleniyor, Ad 12 karaktere kısalıyor; Kapanış, F/K, PD/DD, FD/FAVÖK ve YBB ilk ekranda. Geniş panelde 10 sütunun hepsi görünmeye devam ediyor.

### Bilinen
- Tarayıcı tablosunda iç içe iki dikey kaydırma çubuğu var; bu sürümde değişmedi.
- Fiyat şeridi 640 px'te üst üste biniyor, KMY terminal araç çubuğu aynı genişlikte sağdan kesiliyor (dar pencere tasarımı gerektiriyor).

## 0.16.4 — 2 Ekim 2026 (veri doğruluğu denetimi)

### Yeni
- **`npm run denetim`: çapraz kaynak veri denetimi.** Uygulamanın gösterdiği veriyi bağımsız ikinci kaynakla karşılaştırır: döviz ↔ TCMB, gram altın ↔ ons × USDTRY ÷ 31,1035, altın türleri ↔ saf gram karşılığı, BIST fiyatı ↔ İş Yatırım kapanışı, TEFAS fon fiyatı ↔ TEFAS API'sinden doğrudan son fiyat, gecikme etiketi ve veri yaşı, FAVÖK / net kâr / F/K ↔ mali tablonun ham satırlarından yeniden hesap. `-- --portfoy` portföy toplamlarını bileşenlerinden yeniden toplar (gerçek veritabanının kopyasında; çıktıya tutar yazılmaz). Her satır OK / SAPMA / ATLANDI; ağ yoksa ATLANDI, hiçbir şey doğrulanamazsa çıkış kodu 2. Yalancı alarm korumaları: yedek kaynak (Truncgil yokken Yahoo vadeli gram altın) ve eski İş Yatırım önbelleği ATLANDI sayılır, F/K iki kaynağın dönemi farklıysa karşılaştırılmaz, TCMB kuru pazar ve pazartesi sabahı karşılaştırılmaz. İlk canlı çalıştırmada uygulama verisinde sapma bulunmadı (döviz %0,09–0,18, gram altın %0,04, TEFAS birebir, FAVÖK ve net kâr birebir).
- Denetimin saf mantığı için 62 çevrimdışı kontrol (`test/denetim.test.mjs`), `npm test` zincirinde.

## 0.16.3 — 30 Eylül 2026 (canlı yeniden yükleme, statik önbellek, dar panel bestecisi)

### Canlı yeniden yükleme
- **Kod değişince uygulama kendiliğinden güncelleniyor.** Kaynak ağacında çalışırken sunucu `web/` klasörünü izliyor; bir dosya değiştiğinde açık tüm istemcilere haber veriyor. macOS uygulaması, tarayıcı — hepsi aynı anda güncelleniyor, elle `⌘R` gerekmiyor.
  - **CSS değişikliği**: yalnız stil dosyası yeniden isteniyor. Sayfa yenilenmiyor, yazma kutusundaki metin ve kaydırma konumu olduğu gibi kalıyor.
  - **JS / HTML değişikliği**: tam yenileme yapılıyor; yazma kutusu taslağı, adres çubuğu hash'i ve kaydırma konumu geri yükleniyor.
  - 120 ms sessizlik beklemesi: kaydedicinin yaptığı ardışık yazmalar tek bir yenilemeye dönüşüyor. Aynı dosya için mtime değişmediyse tekrar yayın yapılmıyor.
  - Yalnız kaynak ağacında açılıyor (`.git` yoksa izleyici hiç başlamıyor) — paketlenmiş DMG uygulamasında hiçbir şey izlenmiyor. `BORSA_WATCH=0` ile kapatılabiliyor, `BORSA_WATCH=1` ile zorlanabiliyor.

### Düzeltilen
- **Dar panelde besteci alt satıra kayıyordu.** `fitSelects()` seçicileri önce "Yε" gibi iki harfe sıkıştırıyor, yetmeyince `flex-wrap: wrap` ile istatistikleri alt satıra atıyordu; ayırıcı çizgileri bu yüzden hizasız ve tırtıklı görünüyordu (geniş panelde tek satır, sağ panelde iki satır — aynı kod, iki farklı görünüm). Artık hiçbir zaman sarılmıyor: seçiciler 72 px'in altına düşmüyor, gerektikçe sağdaki istatistikler sağdan sola gizleniyor (ctx çubuğu → ctx değeri → maliyet → esneme boşluğu). Ölçüm: 500 / 430 / 380 px panel genişliklerinde tek satır, taşma yok; seçici genişlikleri sırasıyla 113-151-62 → 72-133-62 → 72-83-62 px.
- **Statik dosyalarda doğrulayıcı eksikti.** Sunucu `Cache-Control: no-cache` gönderiyordu ama `ETag`/`Last-Modified` **yoktu**; doğrulayacak bir şeyi olmayan istemci (özellikle WKWebView) dosyayı yeniden almadan önbellekten sunuyordu. Sonucu: uygulama güncellemesinden sonra **eski CSS ile açılabiliyordu** — besteci hizası düzeltmesinin JS kısmı gitti (`TUR` göstergesi kayboldu) ama CSS kısmı kaldı (ayırıcılar tırtıklı kaldı). Artık her statik dosya `ETag` + `Last-Modified` gönderiyor, eşleşirse `304`, değiştiyse `200` dönüyor. Bu yalnız geliştirme rahatsızlığı değil, dağıtılmış uygulamanın güncelleme sonrası eski dosya göstermesini de engelliyor.

## 0.16.1 — 30 Eylül 2026 (FAVÖK taban satırı, sohbet bestecisi)

### Düzeltilen
- **Sohbet bestecisinin üst şeridi hizasızdı.** Seçim kutuları 24px, istatistikler 16px yükseklikte olduğu için dikey ayırıcı çizgileri farklı uzunlukta ve tırtıklı görünüyordu. Tüm öğeler 22px'e eşitlendi, ayırıcı istatistiklere de verildi, çip–istatistik arasındaki boşluğa `flex: 1` spacer kondu. Üst satır artık tek, düzgün bir şerit. Doğrulama: 1500 px genişlikte ve sağ panelde (470 px) taşma yok, konsol hatası yok.
- **Maliyet değeri yeşildi** (`#stCost { color: var(--up) }`). Bu arayüzde yeşil kazanç/zemin anlamına geldiği için yanlış sinyaldı; nötr griye alındı. Bütçe uyarısı ayrı rozet olarak (BÜGÜN) kendi rengini taşımaya devam ediyor.
- **`TUR 0` gürültüydü.** Tur sayacı ilk turdan önce gizleniyor, sıfır olduğunda ekranda yer kaplamıyor.
- **FAVÖK %4,9 eksik hesaplanıyordu.** FAVÖK, mali tablodaki "Esas Faaliyet Karı" (`3DF`) satırı üzerine kuruluyordu. O satır "Diğer Faaliyet Gelir/Giderleri"ni (`3DD` − `3DE`) düştüğü için sonuç eksik çıkıyordu. Doğru taban **"Net Faaliyet Kar/Zararı"** (`3H`, finansman öncesi faaliyet kârı) — Fintables ve piyasa standardı da bunu kullanıyor. TUPRS 2026/6 kanıtı: `3H` 62.373.927.000 + `4B` 8.872.312.000 = **71.246.239.000**; eski hesap 67.898 mn idi, sapma tam 3.349 mn (%4,9). FAVÖK marjı %10,24 → **%10,75** (kaynakla birebir). Etkilenen: FAVÖK marjı, `ebitda` alanı, çeyreklik FAVÖK grafiği.
- "Faaliyet kârı" satırı `3DF` olarak **korunuyor** — ayrı ve geçerli bir ölçüm, yalnız FAVÖK tabanı olmaktan çıkarıldı.
- Önbellekteki eski kayıtlarda `ebitdaBase` yok; bunlar `3DF` tabanına düşüyor, değer kaybolmuyor.
- Bankalar için FAVÖK hesaplanmıyor (EBITDA banka için anlamlı değil) — davranış değişmedi.


## 0.16.0 — 30 Eylül 2026 (güvenilirlik, hash yönlendirme, ajan iş akışı, kurum konsensüsü, sembol yaşam döngüsü)

### Yeni — sunucu
- **Hız sınırı.** `/api/*` için kayan pencereli sayaç: dakikada 600 istek, `POST` için 120. Aşılınca `429` + `Retry-After` + `{"error":"Çok fazla istek"}`. Statik dosyalar, `/vendor/`, rapor sunucusu ve WebSocket muaf. *Canlı ölçüm: 700 GET → 598×200 + 102×429 · 130 POST → 120×200 + 10×429 · 400 statik istek → 0 hata · WebSocket 429 sırasında açık kaldı.*
- **İstek yığılması giderildi.** `pushQuotes` / `pushKap` ve üçüncü zamanlayıcı `setInterval` yerine gecikmeli tekrar desenine geçti. Yavaş ağda istekler üst üste binmiyor.
- **Seans kapısı.** Piyasa kapalıyken BIST hisse ve endeks fiyat turları hiç çalışmıyor; döviz, altın, Brent, kripto ve S&P 500 7/24 güncelleniyor. Eşik denetimi de aynı kapıdan geçiyor. *Hafta sonu ölçümü: atlanan XU100 XBANK THYAO ASELS; devam eden USDTRY EURTRY GRAM ONS BRENT BTC SPX.*
- **Önbellek tavanı.** `http_cache` 300 satır / 50 MB sınırını aşınca yazma yolunda kendini temizliyor (`fetched_at` indeksli). Bayt ölçümü `LENGTH(CAST(value AS BLOB))` ile — `LENGTH(TEXT)` karakter sayıyordu. `/api/health` artık `cache: {rows, bytes}` yayınlıyor, Ayarlar › Veri'de gösteriliyor.
- **`analyst_targets` tablosu** (kurum hedef fiyatları) ve `ix_targets_symbol` indeksi.

### Yeni — arayüz
- **Hash yönlendirme.** `#/sohbet`, `#/pazar/THYAO/ozet/fiyat`, `#/pazar/THYAO/skor`, `#/pazar/tara|sektorler|piyasa`, `#/portfoy/risk`. Tarayıcıyı `#/pazar/THYAO/skor` adresinde yenileyince aynı yer açılıyor; geri/ileri tuşları çalışıyor. Bilinmeyen parça `#/sohbet`'e düşüyor, kanonik hash `replaceState` ile normalleştiriliyor.
- **Açılış artık en yavaş ucu beklemiyor.** `ready` yayını `/market/overview`'dan ayrıldı; sohbet, WebSocket, izleme listesi ve fiyat şeridi overview'un süresi kadar beklemiyor.
- **⌘K'ya komut modu.** `>` ile 13 komut: portföy değerlendirmesi, BIST taraması, günün piyasa özeti, portföy risk sekmesi, KAP taraması, sembol ekle, yenile, tema, 3 sekme geçişi, yeni ajan oturumu, panel aç/kapat.
- **Modal odak tuzağı.** Odak içeriye giriyor, Tab dışarı çıkmıyor, arka plan `inert`, ESC kapatıyor, kapanınca odak tetikleyen düğmeye dönüyor. Sağ tık menüsü için de aynı davranış. Dar ekranda sol çekmece de ESC ile kapanıyor.
- **Sekmelere `aria-selected` / `aria-controls`**, panellere `role="tabpanel"`. Önceden `index.html`'de statik durum vardı ama **sekme değişince güncellenmiyordu**. Sürekli değişen alanlarda `aria-live` yok. 8/8 ikon düğmesinde `aria-label` doğrulandı.
- **Kısayol yardımı düzeltildi.** `⌘1–4 → Piyasa·Portföy·Terminal·Raporlar` yanlıştı (3 sekme var); `⌘\` ve `⇧⌘\` hiç listelenmiyordu.
- **Çeviri:** 6 ajanın bıraktığı 67 yeni metnin İngilizce karşılığı eklendi.

### Yeni — ajan
- **Asistan mesajı eylemleri:** Kopyala (MD), Yeniden üret, Rapora çevir. Yeniden üretme sunucu dallanması yapmıyor — kullanıcı mesajından sonraki kardeşleri temizleyip aynı isteği tekrar gönderiyor, yalnız o turun maliyetini geri alıyor.
- **Sohbet içi arama (⌘F).** Mesaj **gövdelerinde** arıyor (oturum listesinde yalnız başlık aranıyordu). Sonuca tıklayınca mesaj açılıyor, eşleşme vurgulanıyor, kütük ortalanıyor. Ek istek yok.
- **Tur muhasebe defteri.** `tool_use` gövdesine `startedAt`, `tool_result` gövdesine `ms` eklendi (şema değişikliği yok). Mesaj altında süre · araç · alt ajan · maliyet; açılınca araçlar süreyle listeleniyor, alt ajanlar ağaç şeklinde. 5 dakikayı aşan turlar kendiliğinden açılıyor.
- **Günlük maliyet bütçesi.** Sohbette `BÜGÜN $0,00 / $5` göstergesi (limit 0 iken gizli), %80'de uyarı, limit dolunca "limiti ikiye katla / sadece uyar / bugün için kapat". Ayarlar › Bağlantı'ya iki alan.

### Yeni — piyasa verisi
- **Kurum konsensüsü.** 12 aracı kurumun raporlarından hedef fiyat ve tavsiye çıkarılıyor. Raporlar paneline beşinci sekme **Konsensüs**: kurum · tarih · hedef · tavsiye · potansiyel · güncellik, dört sütun sıralanabilir, altında medyan ve AL/TUT/SAT dağılımı. Kurum satırına tıklayınca akış o kuruma filtreleniyor. Sembol yazılmadığında en çok konuşulan 20 sembolün fırsat listesi çıkıyor. Sembol kipi KAP ile paylaşılıyor. *Canlı: AK Yatırım'ın 40 raporundan 19'unda hedef çıkarıldı, 19/19'unda metin "hedef fiyatımızı <N>" idi — 0 uydurma.*
- **Rapor akışında serbest metin araması ve kategori süzgeci** (istemcide, yeni sunucu ucu yok).
- **Sembol yaşam döngüsü.** Evrenden çıkan semboller kaldırıldı olarak işaretleniyor; **hiçbir veri silinmiyor**. `/api/universe/status` artık `total`, `delisted`, `added`, `delistedList`, `codes` döndürüyor (canlı: 630 sembol). Kod değişikliği veri kaynağında olmadığı için **uydurulmadı**: örtüşen yeni kod varsa "muhtemel değişiklik, doğrulayın" işaretleniyor.
- **Evrende olmayan kod artık sessizce boş dönmüyor** — arama sonucunda Türkçe uyarı satırı; aynı uyarı ajanın `search_symbol` aracına düşüyor.
- **Portföy denetimine 4 madde:** `delisted_holding`, `renamed_holding`, `unknown_symbol`, `multi_platform_split`.
- **İzleme listesinde kaldırılmış sembol uyarısı:** rozet + son ad + muhtemel yeni kod. Tıklamayı engellemiyor; listeye eklemede `confirmBox` ile soruyor.

### Düzeltilen
- Hedef fiyat ayrıştırıcısının bulduğu gerçek hata: Yapı Kredi'nin ASELS raporunda "8,1 USD/hisse'den 8,5 USD'ye (400 TL)" yazıyordu; ayrıştırıcı 8'i TL sanıp 345 TL'lik hisse için hedef 8 yazıyordu. Yabancı para birimi reddediliyor, satır `null` dönüyor.
- "YENİ" rozeti 36 saat kuralıyla üretiliyordu, yani "ilk kez gördüğüm" değil; ilk taramada 200 raporun 200'ü "yeni" görünüyordu. Artık `firstSeen` tabanlı.
- "Eksik anahtar bulunamadı" senaryoları ayrıştırıcıyı yanlış pozitife sokabiliyordu: "satış imkânı", "Satış baskısı", "Tutar", "mağaza açılışı hedefi" hedef fiyat sanılmıyor (28 birim vakayla doğrulandı).

### Doğrulama
- `npm test` dört dosya, **165 kontrol** — portföy 63, güvenlik 19, arama 59, hata senaryoları 24.
- Altı paket canlı tarayıcıda doğrulandı: hash yönlendirme, ⌘K komut modu (13 komut), odak tuzağı (8 Tab sonrası odak modal içinde), aria güncellemesi, konsensüs fırsat listesi (20 sembol), sağlık uç noktası, yeni ayarlar.
- macOS uygulaması 0.15.0 olarak derlendi, kuruldu ve açıldı: arayüz yerel kabukta tam çalışıyor, yeni mesaj eylemleri ve bütçe göstergesi görünüyor. Uygulama, sistem bildirim izninin kapalı olduğunu doğru tespit edip uyarıyor.

## 0.15.0 — 30 Eylül 2026 (sembol kilidi, ajan görünürlüğü, arama düzeltmesi, alarmlar, portföy denetimi)

### Yeni
- **Sağ panel artık seçili sembole kilitleniyor.** Dashboard'da THYAO seçtiğinde KAP ve Raporlar o sembole geçiyor; önceden ikisi de bağımsız kalıyor, THYAO'nun KAP'ı için 3 tık gerekiyordu. Kilitliyken panel başlığında `THYAO ✕` rozeti görünüyor; rozet tıklanınca veya kapsam seçicisi değişince kilit kalkıyor. Kilitliyken kayıtlı kapsam tercihi ezilmiyor, sonraki açılışta korunuyor. `⌘\` sağ paneli açıp kapatıyor, `⇧⌘\` KAP ↔ Raporlar arasında geçiyor (menüde zaten vardı, tarayıcıda kısayol eksikti).
- **KAP listesi okunabilir.** Öncelik sıralaması (TARİH / SİNYALE — TEZ → YAP → FİN → KUR → DİĞER), gün başlıkları ("30.09.2026 · 100 bildirim") ve OKUNMAMIŞ süzgeci. Okunan bildirim işaretlenince rozet düşüyordu, düşmüyordu. Sıralama istemcide yapılıyor, sunucu değişmedi.
- **İzleme listesinde mini grafik.** `sparkSvg()` ve `.spark` stili depoda yazılıydı ama hiç çağrılmıyordu; ölü kod geriye alındı. Sunucunun zaten gönderdiği gün içi 5 dakikalık seriden çiziliyor; veri yoksa kutu çizilmiyor.
- **Ajan işi bitince bildirim.** `run.end` artık hiçbir bildirim üretmiyordu — 40 dakikalık bir analizin sonucunu öğrenmenin tek yolu uygulamayı elle açmaktı. Ön planda mesajın altında "✓ Tamamlandı · 12 dk · 14 araç · $0,42" şeridi, arka planda toast + tıklanabilir rozet + masaüstü bildirimi. Bildirimlerde "Sonucu aç" ve "Sessize al" düğmeleri; izin isteklerinde "İzin ver" / "Reddet", soru isteklerinde "Yanıtla" / "Atla". `notify()` artık `document.hidden` koşuluna bağlı değildi — WKWebView'de uygulama arka plandayken de bu koşul false kalıyor, macOS bildirimi hiç gitmiyordu.
- **Araç çıktısı `<pre>` yerine tablo.** Ham JSON 260 px'lik bir kutuya sıkışıyordu. Dizi sonuçlar ilk 20 satırlık tablo + "N satır daha", nesneler 2-4 satırlık "ne döndü" özeti olarak çiziliyor; parse edilemeyen çıktılar eski haliyle. Girdi ve çıktı ayrıldı. Katlanan grup başlığı artık çalışan araçları isimleriyle gösteriyor (tekrarlar "Fiyatlar ×8" gibi toplanıyor). Alt ajan kartlarında da aynı işlem.
- **"Nereye harcadım" paneli.** `/cost` artık toplam, 7/30 günlük dağılım ve oturum tablosu (başlık, model, tur, maliyet) gösteren bir panel; satıra tıklayınca oturumu açıyor. MALİYET etiketi de aynı paneli açıyor. Yeni sunucu ucu açılmadı.
- **Fiyat / KAP / temettü eşikleri.** `alerts` tablosu şemada 0.14.0'dan beri duruyordu ama sunucunun hiçbir yerinde kullanılmıyordu — hiçbir eşik kurulamıyordu. `GET/POST /api/alerts`, `DELETE /api/alerts/:id` rotaları, dakikalık döngüde koşul denetimi ve WebSocket yayını. Sembol başlığında zil rozeti. Tetiklenen eşik `triggered_at` ile kilitleniyor, koşul bozulunca kilit açılıyor — bildirim saniyede bir tekrarlamıyor. BIST hisseleri seans dışında atlanıyor, döviz ve altın 7/24 değerlendiriliyor. *(Canlı doğrulama: 45 saniyede tetiklendi, ulaşılmayan eşik tetiklenmedi.)*
- **ÖZET sayfası 2,1 ekrandan 1 ekrana indi.** 10 panel `[FİYAT · RAKAMLAR] · [HABER AKIŞI] · [AJAN · BELGE · TEMETTÜ]` alt sekmelerine ayrıldı; KAP bildirimine kaydırmak yerine bir tıkla erişiliyor. Veri önceden çekilip saklanıyor, sekme geçişi istek üretmiyor.
- **Göreli güç.** Sembol grafiğine XU100 referans çizgisi ve fark puanı ("6M: THYAO +0,7% · XU100 −3,3% → 4,0 puan"). 5Y ve TÜMÜ aralıklarında ölçüt verisi aynı sıklıkta gelmediği için gizleniyor. Yetersiz veride SMA200 düğmesi pasifleşiyor — kullanıcı overlay'in çalıştığını sanmıyor.
- **Portföy bütünlük denetimi.** `GET /api/portfolio` yanıtına `audit` dizisi: nakit girişi yetersizliği, tarihsel seri ile bugünkü değer sapması, döviz kuru boşluğu, fiyatsız varlık, uzun süredir aynı fiyattan değerlenen TEFAS fonu, eksi nakit, negatif pozisyon, karşılanmayan transfer. Her madde `code`/`severity`/`title`/`detail`/`action` taşıyor; `action` arayüzde tıklanabilir onarım yolu gösteriyor. Kritik maddeler başta.
- **Yıllık beyanname dökümü.** `transactions` tablosuna `tax` ve `other_fee` sütunları eklendi — alış komisyonu ile satış stopajı aynı `fee` alanında karışıyordu, BSMV hiç ayrı değildi. CSV içe aktarmada `stopaj`, `vergi`, `bsmv`, `bankan işlem ücreti` ayrı başlıklara eşleniyor. Risk sekmesine PERFORMANS / BEYANNAME alt sekmesi: yıllar sütunlu brüt satış, alış maliyeti, gerçekleşen K/Z, satış stopajı, komisyon, BSMV, temettü brüt/stopaj ve net nakit çıkışı.
- **Model seçici gruplandı.** 21 model düz listede, `<optgroup>` ile Claude Code / ChatGPT-Codex / openCode / OpenAI / xAI başlıklarına ayrıldı. `opencode-zen/space-bunny-free` gibi ham sağlayıcı önekleri etikete sızmıyor. `/model <ad>` ile filtreleme. Seçili model listede yoksa "Seçili" grubunda görünüyor (0.13.0'taki regresyon koruması). Etiketler sunucuda tek yardımcıda üretiliyor, model `id`leri değişmedi.
- **`scripts/ornek-portfoy.mjs`.** Portföy ekranının gerçek veriyle çalıştığını görmek için: 17 işlem, iki platform, hisse + döviz + TEFAS fonu + bölünme + transfer + temettü. Tekrar çalıştırılabilir (önce sıfırlar).

### Düzeltilen
- **⌘K'da Türkçe i/ı araması bozuktu.** "altın" yazınca hiçbir altın ürünü gelmiyordu, "ALTIN" yazınca altısı geliyordu: sorgu `ALTİN` (noktalı İ), veri `GRAM ALTIN` (noktasız I) oluyor ve `includes` tutmuyordu. Ortak `server/fold.js` katlaması: iki taraf da küçük harfe inip Türkçeye özgü harfler ASCII'ye eşleniyor. Evren, fon ve özel araç aramaları aynı katlamayı ve aynı puan ölçeğini kullanıyor.
- **Arama sonuçları alaka sırasında değildi.** `universe.js` her sonuç için puan üretiyor, `market.js` onu **düşürüyordu**; sıralama yalnız birebir kod eşleşmesini öne alıyor, kalanlar kaynak-ekleme sırasını koruyordu. Sıralama anahtarı düzeltildi: tam kod eşleşmesi → kaynak önceliği → puan → sembol. *"altın" yazınca gıda şirketi (Altınkılıç) altın ürünlerini geçiyordu;* dar listelerde (özel araç, endeks) ad-öneki ödülü kapatıldı, elle seçilmiş 23 sembol artık 500+ hisselik evrenden önce geliyor.
- **macOS köprüsü hataları yutuyordu.** `js()` `completionHandler: nil` ile çağırıyor, `post` `catch (e) {}` ile yutuyordu; 12 menü eylemi sessizce kayboluyordu.
- **Menü çubuğu simgesi gateway çökünce kayboluyordu** — kurtarma yolu tam da o anda kaybolduğu için kullanıcı "Gateway'i Yeniden Başlat"a erişemiyordu. Simge kalıyor, kırmızıya dönüyor.
- **Bildirim temsilcisi iki yerde atanıyordu.** `AppDelegate` kendini atıyor, `WebWindowController` hemen eziyordu; kazanan sıraya bağlıydı ve `AppDelegate`'ın işleyicileri eylemi sayfaya gönderemiyordu. Temsilci yalnız `WebWindowController`'da kalıyor, ölü işleyiciler silindi.
- **Sekme çubuğu dar panelde taşıyordu.** 260 px'e kadar ölçüldü, taşma ve kırpılmış etiket yok.

### Test
- `npm test` artık dört dosyayı çalıştırıyor: portföy 63, güvenlik 19, arama 59, hata senaryoları 24 — **165 kontrol**.
- `test/arama.test.mjs` ağa çıkmıyor: geçici `BORSA_DATA_DIR` ve `http_cache`'e yazılan evren/fon listeleriyle tekrarlanabilir.

## 0.14.0 — 30 Eylül 2026 (yolo modu, sunucu tarafı izin kapısı, veri birliği, portföy düzeltmeleri)

### Yeni
- **Ajana yolo modu tek tıkla açılıyor.** Ayarlar › Bağlantı'ya "Ajana tam otomatik izin (yolo)" anahtarı: 30 dakika / 2 saat / bu oturum seçeneğiyle açılır, ne yapacağını düz dille anlatan bir onay kutusu ister, durum rozeti (şu an: SOR / şu an: YOLO) tek bakışta okunur. Süre dolunca mod kendiliğinden `default`'a döner ve bildirim gösterir. Sohbet ekranında yolo açıkken "⚡ YOLO — ajan tüm araçlara izinli" şeridi görünür, tıklayınca kapatır. Yolo bir tasarım tercihinden çok bir açık kapı olduğu için, yaptığı her iş `tool_audit` tablosuna yazılır: Ayarlar › Sistem › "Ajan işlem kaydı" kartında son 200 kayıt, günlük izin/reddetme özeti ve "Kaydı temizle" düğmesi. Bu kart yalnız yolo modundayken görünür.
- **Araç izinleri artık sunucu tarafında.** Dört kip tek bir kapıdan geçiyor: `default` (yazma araçları onay ister), `acceptEdits` (dosya araçları serbest, portföy/ayar araçları onay ister), `plan` (yazan her şey reddedilir), `bypassPermissions` (her şey serbest, denetim kaydı açık). Araçlar `WRITE_TOOLS` (veritabanına yazan 7 araç) ve `FILE_TOOLS` (yalnız dosya sistemine yazan 3 araç) olarak ayrıldı; `AUTO_TOOLS` artık yalnız salt okunur araçları içeriyor, böylece "otomatik izin verilen" liste yanlışlıkla bir yazma aracını kapsamıyor. `POST /api/tools/:name` rotası da aynı kapıdan geçiyor — önceden hiçbir doğrulama yapmadan yazıyordu.
- **Sağlayıcı yetenek matrisi.** `/api/meta` artık `capabilities` döndürüyor (claude / codex / omp × düşünme düzeyi, alt asistan, maliyet, bypass). Ayarlar › Bağlantı'da seçili sağlayıcının yetenekleri tablo olarak görünüyor; desteklenmeyen özellik pasif ve üzerine gelince gerekçesi yazıyor ("Codex CLI düşünme seviyesini desteklemiyor."). Maliyet "est" ise "yalnızca tahmini (estCost)" olarak ayrı gösteriliyor.
- **Test paketi genişledi:** `test/guvenlik.test.mjs` (19 kontrol: yedek enjeksiyonu, terminal sahipliği, izin kapısı, kapsamlı jeton) ve `test/simulasyon.mjs` (16 kontrol: gerçekçi bir portföyde portföy hata senaryoları). `npm test` artık üç dosyayı da çalıştırıyor.

### Güvenlik
- **Yedek geri yüklemede SQL enjeksiyonu kapatıldı.** `POST /api/import/backup` sütun adlarını istekten olduğu gibi SQL'e giriyordu; anahtarı olan bir istemci `{"tables":{"transactions":{"x); DROP TABLE transactions;--":1}}}` göndererek tabloyu silebiliyordu. Sütun adları artık `PRAGMA table_info` ile doğrulanıyor, şema dışı sütun hata veriyor, tablo kümesi beyaz listede. Yedek mantığı `db.js`'e (`restoreBackup`) taşındı ve `BEGIN`/`ROLLBACK` ile çalışıyor; 32 MB üstü gövdeler 413 alıyor.
- **Kabuk sahipliği.** WebSocket bağlantısına kimlik veriliyor, `term.open` sahibi kaydediyor, `write`/`attach`/`resize`/`close` yalnız sahibine açık. Sekme kapanınca kabuk süreci de kapanıyor (`closeOwned` yazılıydı ama hiçbir yerden çağrılmıyordu). Anahtarı olan iki istemci artık birbirinin kabuğunu okuyup yazamıyor.
- **Ajan alt süreçlerine master gateway anahtarı verilmiyor.** omp yolo modundayken `cat data/gateway.json` yapıp tüm API'yi ana anahtarla çağırabiliyordu. Alt süreçlere artık imzalı, süreli, oturum ve kip taşıyan **kapsamlı jeton** veriliyor; bu jeton yalnız `/api/tools/` rotasında geçerli, `/api/settings` 401 veriyor. `mcp-stdio.js` kapsamlı jetonu varsa onu kullanıyor, yoksa eski davranışına devam ediyor (harici istemciler bozulmuyor).
- **omp onay kartındaki TOCTOU giderildi.** Onay kartı, aynı araç adlı *son* bekleyen çağrının argümanlarını gösteriyordu; gerçek isteğinki değil. Artık istek kimliğiyle eşleşen girdi kullanılıyor, eşleşme yoksa kullanıcı uyarılıyor.

### Düzeltilen
- **omp'te hiçbir borsa aracı otomatik onaylanmıyordu.** `xd://mcp__borsa_get_quotes` ayrıştırıcısı açgözlü bir regex kullandığı için sunucu adını `borsa_get`, araç adını `quotes` olarak alıyordu; `AUTO_TOOLS` ile karşılaştırma hep başarısız oluyor ve 32 aracın her biri onay kartı üretiyordu. Ayrıştırıcı sunucu adını beyaz listeye göre eşleştiriyor.
- **Veri dizini artık tek.** Geliştirme servisi repo içindeki `data/borsa.db`'yi, DMG'den kurulan uygulama `~/Library/Application Support/kmy terminal/data/borsa.db`'yi kullanıyordu; aynı ürün iki ayrı portföy, iki ayrı ayar seti gösteriyordu. Sıra şimdi: `BORSA_DATA_DIR` → uygulama dizini → repo `data/`. Hedefte veritabanı yoksa eski konumdan kopyalanıp boyutu ve tablo sayısı doğrulanarak taşınıyor, `-wal`/`-sunucu günlükleri` birlikte alınıyor; doğrulama başarısızsa hiçbir şey silinmiyor. `./bin/kmy gateway status` artık "Veri dizini" satırını gösteriyor.
- **Portföy: tek nakit kaydı tüm kâr/zarar hattını bozuyordu.** `cashTracking` tek bir DEPOSIT/WITHDRAW kaydıyla açılınca `netInvested` sıfıra yakın kalıyor ve 250.000 TL'lik portföyde "Toplam K/Z" portföyün tamamını kâr gibi gösteriyordu. Net yatırım artık savunulabilir maliyet esaslı hesaplanıyor (`max(kayıtlı nakit, pozisyon maliyeti)`), sapma durumunda uyarı üretiliyor ve `netInvestedEstimated` işareti API'de dönüyor.
- **Portföy: döviz kuru seride yoksa varlık sıfıra düşüyordu.** Geçmiş değer serisinde `lastFx[c]` hiç bulunamazsa pozisyon **0** sayılıyordu; Özet 60.000 TL gösterirken Risk grafiği 0 gösteriyordu. Artık serideki ilk bilinen kuru geriye doğru taşınıyor.
- **Portföy: TRANSFER hayalet pozisyon.** Kaynak platformda miktar yetmediğinde `|| t.quantity` devreye girip istenen miktarın tamamını hedefe yazıyordu; 100 adet varken 200 adet transfer edersen 100 adet hayalet pozisyon portföy değerine ekleniyordu ve uyarı çıkmıyordu. Miktar kaynakla sınırlanıyor, uyarı üretiliyor.
- **Portföy: SPLIT iki yerde farklı uygulanıyordu.** Defter platforma göre filtreliyor, tarihsel seri platforma bakmıyordu. Ortak `splitAppliesTo` kuralına bağlandı.
- **Portföy: yıllıklandırma 252 gün sabitti.** Takvim fon/kripto günlerini de içerdiği için volatilite ve Sharpe ~%20 fazla hesaplanıyordu. Artık gerçek işlem günü sayısından türetiliyor.
- **Portföy: temettü stopajı varsayılanı %15'ti,** BIST hisse senetlerinde uygulanan oran %10. Varsayılan %10.
- **Portföy: TEFAS fon birim fiyatı bozuluyordu.** Mutlak 2 ondalık yuvarlama `0,072083` → `0,07` yapıyordu (%2,9 hata); emeklilik fonlarının tamamı bu bantta. Artık 6 anlamlı basamağa indirgeniyor — hem kuru hem büyük fiyat korunuyor (4 basamak 83.147,6 → 83.150 yapıyordu).
- **Portföy: satış stopajı sembol biçiminden tahmin ediliyordu.** Tahvil ve fona %10 stopaj kesiliyordu. Artık enstrüman tipine göre karar veriliyor.
- **Ayarlarda yolo süresi hiç çalışmıyordu.** `putSettings` `DEFAULT_SETTINGS`'te olmayan anahtarları sessizce düşürdüğü için `yoloUntil` kaydedilmiyor, otomatik kapanma gerçekleşmiyordu. Anahtar tanımlandı.

## 0.13.0 — 29 Eylül 2026 (canlı fiyat, kurum raporu süzgeci, satış senaryosu)

### Yeni
- **Ekranda açık hisse canlı akar.** Sunucu yalnız izleme listesi ve piyasa şeridindeki sembolleri gönderiyordu; izleme listesinde olmayan bir hisseyi terminalde açtığınızda başlıktaki fiyat donuyordu. Arayüz artık baktığı sembolü sunucuya abone ediyor (bağlantı kopunca yeniden abone olunur) ve o sembol de canlı güncelleniyor.
- **Fiyat tazeliği göstergesi.** Alt durum çubuğunda "Fiyat 21:04" saati. Akış durursa (sunucu kapalı, ağ kesintisi, veri kaynağı hatası) saat turuncuya döner ve üzerine gelince kaç saniyedir güncellenmediği yazar. Sol panel yalnız Dashboard'da göründüğü için gösterge oraya değil her sekmede görünen durum çubuğuna kondu.
- **Sekmeye dönünce Özet tazelenir.** 5 dakikalık yenileme döngüsü sekme görünmezken duruyordu; görünür olunca fiyat, haber, KAP ve kurum raporları yeniden çekilir.
- **Kurum raporlarında "İzleme listem" / "Portföyüm" süzgeci.** Akış sekmesine iki düğme: yalnız kendi sembollerinizle ilgili raporlar listelenir. Örnek: 39 rapor → 5. Tekrar tıklama süzgeci kaldırır. Süzgeç sunucuda uygulanır, tarayıcı hepsini indirmez.
- **Portföyde "bugün satarsam" senaryosu.** Özet sekmesinde net eline geçecek tutar, stopaj kesintisi ve o andaki kâr/zarar tek satırda. Varlıklar tablosunda her pozisyonun K/Z hücresinin altında "satışa çevir ₺26.235"; üzerine gelince brüt tutar, kesinti ve kâr/zarar ayrıntısı. BIST hisselerinde stopaj uygulanır, yurt dışı varlık ve fonlarda uygulanmaz.
- **Hisse satış stopajı ayarı.** Ayarlar › Hesaplama › Hisse satış stopajı (varsayılan %10). Temettü stopajından ayrı tutulur.
- **oh-my-pi (omp) entegrasyonu iyileştirildi.** Kullanıcının kendi varsayılan omp modeli artık model seçicide görünüyor (`omp models --json` yüzlerce modeli elediği için o model listede çıkmıyordu ve o modelle konuşmak imkânsızdı). Model listesi artık bağlam penceresini ve modelin desteklediği düşünme seviyelerini de taşıyor; "düşünme seviyesi" seçicisi omp modellerinde de görünüyor (Claude'daki gibi sabit liste değil, modelin kendi `thinking` listesi). `/api/meta` model listesinin yüklenmesini bekliyor, ilk çağrıda seçici eksik kalıyordu.
- **omp'ta MCP köprüsü kendini onarır.** Proje klasörü taşınırsa `workspace/.omp/mcp.json` eski yolu gösteriyor ve 32 borsa aracı sessizce erişilemez oluyordu. Sunucu açılışında yol doğrulanıyor, gerekirse düzeltiliyor ve ne yapıldığı günlüğe yazılıyor.
- **Açık oturumun sağlayıcısı kilitliyken uyarı.** Oturumun sağlayıcısı sabittir; başka bir sağlayıcı seçilirse mesaj sessizce eski sağlayıcıya gider. Artık "Açık oturum Claude Code sağlayıcısında. oh-my-pi ile konuşmak için yeni oturum açın." uyarısı çıkar.
- **Araç etiketleri tutarlı.** omp ve Codex tarafında diğer MCP sunucularının araçları `mcp__sunucu__arac` biçiminde ham görünüyordu; artık "sunucu › araç" olarak okunuyor. `xd://mcp__` yolu ayrıştırması yalnız `borsa` ile sınırlı değil, alt çizgi içeren suncu adlarını da doğru çözüyor.

### Düzeltilen
- Kurum raporu akışında aynı raporun İngilizce ve Türkçe kopyaları ayrı ayrı listeleniyordu ("ASELS Company Report" / "ASELS Şirket Raporu"). Aynı kurum + sembol + gün kombinasyonundaki tekrarlar eleniyor; 30 günde 42 kayıt 39 rapora indi.
- Bazı raporlara "2026" gibi yıl dizileri BIST sembolü sanılıyordu ("MAVI.IS: 2Ç26 Kar Tahmini" → semboller "MAVI, 2026"). Uyarlayıcılardan gelen kodlar artık gerçek BIST kodlarına karşı süzülüyor.
- Ziraat Yatırım raporlarının başlığına sayfalama izi bulaşıyordu ("ASELS 2Ç26 1 2 3 4 5 6 7 Toplam 132 dosya bulundu"). Başlık temizleniyor.

### Düzeltilen (arayüz çapraz doğrulama)
- **Sohbet alt çubuğu taşması:** dar panelde TURNS ve CTX göstergeleri ekran dışında kalıyordu (1280 px'de 202 px). Satır artık gerektiğinde iki satıra sarıyor; ctx metni tur sonrası büyüdüğünde de yeniden ölçülüyor.
- **Piyasa şeridi kırpılması:** sığmayan hücreler sağdan gizleniyor. 1920→500 px arasında 12'den 4'e düşüyor, hiçbir hücre yarım görünmüyor.
- **Temettü takviminde 24 boş hücre:** verim sütunu yalnız izleme listesindeki sembollerde doluyordu. Eksik semboller tek toplu istekle çekiliyor; hesaplanamayan hücre artık "—" gösteriyor.
- **Kurum raporu akışında 52 rapora ulaşılamıyordu:** liste 200 ile sınırlıydı. KAP panelindeki "Daha fazla yükle" düğmesi akışa da eklendi (200 → 252).
- **KAP tarih biçimi tutarsızdı:** liste "29.09.2026", detay "2026.09.29" dönüyordu. Sunucu artık tek biçim üretiyor.
- **Para birimi dağılımı dil sızıntısı:** İngilizce arayüzde Türkçe anahtar ("Altın") görünüyordu.
- **Aylık temettü etiketleri UTC kayması:** uygulama 00:00–03:00 arasında açıldığında tüm etiketler bir ay geri kayıyordu.
- **"Bugün" UTC ile hesaplanıyordu:** aynı saat aralığında takvim dünkü olayları çekiyor, yaklaşan temettüleri geçmiş gibi işaretliyordu.
- **Ayar kaydı sessizce kayboluyordu:** Claude model seçimi `claudeModel` anahtarına yazılıyordu, sunucu `model` bekliyor.
- **Tarih/zaman biçimlendiricileri:** geçersiz tarihte "Invalid Date", eksik başlangıçta "497418h 38m" gösteriyordu.
- **Açık tema okunabilirliği:** ikincil metin 3.16:1 ile AA'nın altındaydı, tablo/kart çizgileri 1.31:1 ile görünmezdi. Metin 4.63:1, çizgiler 3.08:1. Koyu tema de iyileştirildi (metin 3.33→4.53, çizgi 1.20→3.03).
- **Açık tema grafik renkleri:** dağılım grafiğinde 4 dilim beyaz zeminde görünmezdi (1.54:1). Seri renkleri temaya bağlandı, en düşük oran 3.74:1.
- **KAP 31 gün uyarısı:** kapsam "Tüm şirketler"e çevrilirken uyarı çıkmıyor, sonuç sessizce kırpılıyordu.
- **Düzen bozulmaları:** KAP bilgi satırı İngilizce arayüzde iki satıra bölünüyor, ayarlar alt bilgisi "Esc"u yalnız satırda bırakıyordu.
- **Yinelenen `id`:** "İzleme listem" ve "Portföyüm" düğmeleri aynı `id`yi kullanıyordu; süzgeç işleyicisi yalnız ilkini buluyordu.
- **Eksik kurum renkleri:** Gedik ve Halk raporları gri nokta ile görünüyordu.
- **Takılı kalan araç kartı:** tur bitince "çalışıyor" yazıp dönen çarkıp kalıyordu.
- **Bağlam satırı:** 90 karakteri aşınca kelime ortasından kesiliyor, "…" eklenmiyordu.


## 0.12.0 — 27 Eylül 2026 (terminal görünümü, kmy terminal sekmesi)

### Yeni
- **kmy terminal sekmesi** (eski Piyasa sekmesinin yerine): hisse kodu arama, fonksiyon tuşları ve komut satırı olan temel analiz terminali. Sayfalar: **1) Özet** (fiyat grafiği, istatistikler, teknik ve temel veriler, haberler, KAP, kurum raporları, notlar, belgeler, temettü), **2) Finans** (gelir tablosu, bilanço, çeyreklik / kümülatif mali tablolar), **3) Skor** (kârlılık, büyüme, finansal sağlık, değerleme ve momentum puanları, 8 maddelik kalite kontrol listesi), **4) Değer** (sektör ve BIST 100 medyan çarpanlarıyla adil değer aralığı, Graham sayısı, asistanla DCF), **5) Karş** (sektör benzerleriyle karşılaştırma tablosu ve göreli performans grafiği). Ana ekranda son arananlar, popüler hisseler, hisse tarayıcı, sektör haritası ve piyasa özeti. Klavye: 1–5 sayfa, Esc ana ekran, / komut satırı (`THYAO`, `THYAO SKOR`, `TARA`, `YARDIM`…).
- Sohbet, kmy terminal ve Portföy sekmelerinde sağ panelde (Asistan sohbeti sekmesi) açık kalır; hızlı başla önerileri sekmeye göre değişir.

### Değişen
- **Terminal görünümü:** siyah zemin, turuncu vurgu, mono büyük harfli etiketler, ince çizgiler. Sekmeler DASHBOARD / KMY TERMINAL / PORTFÖY; üst çubukta gateway durumu; altında sabit piyasa şeridi (XU100, XU030, döviz, altın, Brent, BTC, S&P 500); en altta sürüm, veri kaynakları, seans durumu ve saat.
- İzleme listesi sade satırlar (sembol · fiyat · değişim · ×); sembol ekleme alanı listenin altında.
- Mesaj kutusu: üst satırda oturum, model, düşünme seviyesi, maliyet, tur ve bağlam; karşılama ekranında KMY logosu ve hızlı başla satırları.
- KAP listesi: solda sinyal rozeti (TEZ · YAP · FİN · KUR · DİĞ), turuncu hisse kodu, sağda tarih; sinyal filtreleri üstte.
- Kurum raporu akışında her satırda Analiz et / İndir düğmeleri.
- Varsayılan imza rengi turuncu (eski varsayılan sarı kullanılıyorsa bir kez turuncuya taşınır; Ayarlar › Görünüm'den değiştirilebilir).
- Sağ panel, ayırıcıdaki « / » tutamacıyla da gizlenip açılır.

## 0.11.0 — 24 Eylül 2026 (sade arayüz, İngilizce)

### Yeni
- **İngilizce arayüz:** Ayarlar › Görünüm › Dil ile Türkçe ya da İngilizce seçilir; varsayılan "Sistem dili" (macOS dili Türkçe değilse İngilizce açılır). Sunucudan gelen iletiler, seans durumu, sektör adları, macOS menüleri ve menü çubuğu simgesi de seçili dili izler; asistan da yanıtlarını arayüz dilinde verir.
- Eğik çizgi komutlarının İngilizce karşılıkları (/new, /analyze, /market…); Türkçe komutlar her iki dilde de çalışır.

### Değişen
- **Sade, yumuşak görünüm:** sekmeler üst çubuğa taşındı (tek satır), büyük harfli ve harf aralıklı başlıklar yerine normal yazım, daha az çizgi ve kenarlık, yumuşatılmış renkler, yuvarlatılmış kartlar ve pencereler, çizgi simgeler, ortalanmış sohbet sütunu, sağa hizalı kullanıcı mesajları, sade bildirimler.
- Garip duran metinler düzeltildi: WATCHLIST → İzleme listesi, DASHBOARD → Piyasa, AGENT CHAT kaldırıldı, CHAT / TERMINAL → Sohbet / Kabuk, "ajan" → "asistan"; kısaltmalar açıldı (52H → 52 hafta, 1A/3A → 1 ay / 3 ay), terimler tutarlı hâle getirildi, "..." → "…".
- KAP sinyal etiketleri: TEZ / YAP / FİN / KUR / DİĞER → Tez / Yapı / Finans / Kurumsal / Diğer.
- Veri kaynakları notu izleme listesinin altında katlanabilir.

## 0.10.0 — 23 Eylül 2026 (macOS görünümü, kuruluma hazırlık)

### Yeni
- ⌘ (Ctrl) basılı tutulunca TERMINAL / DASHBOARD / PORTFÖY sekmelerinin adının sağında ⌘1 · ⌘2 · ⌘3 kısayol etiketi yumuşakça belirir (yazıyı örtmez).
- **macOS görünümü:** pencere düğmeleri üst çubuğun içinde; üst çubuğun ve sekme çubuğunun boş yerinden pencere sürüklenir, çift tıklama sistem ayarına göre büyütür / küçültür. Yan panellerde macOS kenar çubuğu dokusu (yarı saydam), sistem yazı tipi, macOS kaydırma çubukları, macOS tarzı imleç; pencere etkin değilken üst çubuk solar; tam ekranda düzen uyarlanır; WebKit'in "Yeniden yükle / Öğeyi incele" sağ tık menüsü gizlendi.
- DMG ile ilk açılışta uygulama Uygulamalar klasörü dışından çalışıyorsa oraya taşımayı önerir (taşı ve yeniden aç).
- Claude Code kurulu değilse sohbet ekranı ilk açılışta nasıl kurulacağını gösterir.

### Değişen
- AGENT CHAT mesaj kutusu: 📎 yerine ince çizgili ataç simgesi, gönder / durdur düğmeleri de çizgi simge; model seçicide yalnız model adları ("Opus 5.5", "Sonnet 5", "GPT-6 Astra"; tam ad üzerine gelince) ve o an kullanılan model seçili görünür: açık oturumun modeli, yoksa sağlayıcının gerçek varsayılanı (Claude Code, Codex ve oh-my-pi ayarlarından okunur); "Varsayılan" seçeneği kaldırıldı. Seçiciler seçili yazı kadar genişlikte.
- AGENT CHAT'ten plan modu kaldırıldı (PLAN düğmesi ve `/plan` komutu); izin modu Ayarlar › Bağlantı › Agent varsayılanlarından gelir.
- Claude Code aranırken yalnız PATH değil yaygın kurulum yerleri de taranır (resmî kurulum, Homebrew, npm, nvm, volta, bun); kullanıcının kabuğu etkileşimli olarak okunur (.zshrc / .bashrc'deki PATH ayarları dahil).
- Giriş yapılmamış Claude hesabı, eski Claude Code sürümü ve kullanım sınırı hataları anlaşılır Türkçe yönlendirmeyle gösterilir.
- 7420 portu başka bir programdaysa uygulama boş bir portu seçip hatırlar.
- Uygulama başka bir klasöre taşındığında arka plan servisi yeni konuma göre kendiliğinden yeniden kurulur.

## 0.9.0 — 23 Eylül 2026 (tam otomatik veri, menü çubuğu)

### Yeni
- **TEFAS fonları otomatik:** yatırım ve emeklilik fonlarının günlük birim fiyatı, günlük değişimi, fiyat grafiği ve fon adı araması TEFAS'tan kendiliğinden gelir. Portföy değerlemesi, watchlist ve sembol arama fonları doğrudan tanır; elle fiyat girmek gerekmez.
- **Menü çubuğu simgesi:** gateway çalıştığı sürece menü çubuğunda kmy terminal logosu görünür. Menüde gateway durumu, sürüm, çalışma süresi, çalışan ajan işleri, sembol arama, yeni oturum, yeniden başlatma ve loglar var.
- Pencere kapatılınca uygulama menü çubuğunda çalışmayı sürdürür (Dock'tan kalkar). Gateway servis olarak kuruluysa oturum açılışında menü çubuğunda kendiliğinden başlar; ⌘Q uygulamayı menü çubuğuna çeker, tamamen çıkış menü çubuğundaki "Gateway'i Durdur ve Çık" ile.

### Değişen
- Elle veri adımları kaldırıldı: "Fon fiyatlarını güncelle" zamanlanmış görevi ve `/fonlar` komutu yok (fiyatlar otomatik); kurum raporu akışındaki elle yenile düğmesi yerine liste 30 dakikada bir kendiliğinden güncellenir ve açık ekran yenilenir; DASHBOARD'da seçili hissenin haberleri, KAP bildirimleri ve kurum raporları 5 dakikada bir yenilenir.
- Kurum raporu klasör izleme varsayılan olarak açık (İndirilenler klasörüne düşen aracı kurum raporları dakikada bir arşive alınır).
- Elle fiyat yalnız otomatik kaynağı olmayan varlıklar (mevduat, özel ürün) için kaldı.

### Düzeltilen
- DASHBOARD: orta alan dar olduğunda yan yana kartlardaki tablolar (temettü ve sermaye artırımları, günün hareketlileri, temettü takvimi) kart dışına taşıp kesiliyordu. Kartlar artık orta alanın genişliğine göre alt alta diziliyor; temettü / sermaye artırımı kartı sade bir listeye dönüştü (tarih, olay, hisse başı tutar, toplam).
- Menü çubuğundan "Gateway'i Durdur ve Çık" sonrası uygulama yeniden açıldığında "Gateway'e ulaşılamadı" hatası çıkıyordu (durdurulan servis yeniden yüklenmiyordu). Uygulama artık servisi önce yükleyip sonra başlatıyor.
- AGENT CHAT › Oturumlar penceresi: tablo taşıyor ve düğmeler kesiliyordu. Artık tarihe göre gruplu (Bugün, Dün, Bu hafta…) bir liste; satıra tıklayınca oturum açılır, yeniden adlandır / indir / sil satır sonunda simge olarak durur, üstte arama ve yeni oturum düğmesi var.

## 0.8.0 — 23 Eylül 2026 (kmy terminal)

### Yeni
- Uygulamanın adı **kmy terminal** oldu (arayüz, macOS uygulaması, `kmy` komut satırı, servis).
- **Kuruluma hazır DMG** (`npm run dmg`): Node, sunucu, arayüz ve bağımlılıklar uygulamanın içinde; başka bir Mac'e sürükle-bırak ile kurulur. Veriler `~/Library/Application Support/kmy terminal` altında tutulur, ilk açılışta çalışma alanı (ajan talimatları, beceriler, alt ajanlar) hazırlanır ve sürüm yükseldikçe güncellenir.
- Gateway menüsünde **Arka Planda Çalıştır (servis)**: uygulama kapalıyken de zamanlanmış görevler ve KAP takibi sürer.

### Değişen
- Claude Code uygulamaya gömülü gelmez: ajan, bilgisayarda kurulu `claude` programını kullanır. Kurulu değilse sohbette nasıl kurulacağını anlatan bir mesaj çıkar.

## 0.7.0 — 23 Eylül 2026 (macOS uygulaması)

### Yeni
- **macOS uygulaması** (`npm run mac`): Swift + AppKit ile yazılmış yerel kabuk, ~1 MB. Dock, Spotlight ve Launchpad'den açılır; pencere çubuğu temaya uyar, pencere konumu hatırlanır.
- Uygulama açılışta gateway'i hazırlar: servis kuruluysa onu kullanır, değilse sunucuyu kendisi başlatır; ulaşılamazsa "Tekrar dene / Logları aç" ekranı gösterir.
- Yerel menüler ve kısayollar: ⌘N yeni ajan oturumu, ⌘K sembol ara, ⌘1–3 sekmeler, ⌘\ sağ panel, ⌘, ayarlar, yakınlaştırma, Gateway menüsü (durum, yeniden başlat, loglar).
- macOS bildirimleri, Dock rozetinde çalışan ajan işi sayısı, ~/Downloads'a indirme ve Finder'da gösterme, dosya seçme penceresi; dış bağlantılar varsayılan tarayıcıda açılır.

## 0.6.0 — 23 Eylül 2026 (görünüm yenilemesi)

### Yeni
- **İmza rengi** ayarlanabiliyor (Ayarlar › GÖRÜNÜM); varsayılan artık sarı. Açık temada okunabilirlik için otomatik koyulaştırılıyor.
- **Esc** tuşu çalışan ajan yanıtını her yerden durduruyor (pencere açıkken veya kabuk odaktayken hariç).
- **oh-my-pi (omp)** üçüncü ajan sağlayıcısı: model listesinde Claude ve Codex'in yanında; borsa araçlarına MCP ile bağlı, oturum devam ettirme, durdurma ve izin kartları çalışıyor. Maliyet abonelikten düşüyor.
- **Ayarlar** penceresi yenilendi: sol menü, gruplanmış kartlar, anahtar ve seçim düğmeleri, durum etiketleri, imza rengi seçici (9 hazır renk + özel renk).

### Değişen
- AGENT CHAT mesaj kutusu sadeleşti: yazı alanı üstte; model, efor ve PLAN altta küçük düğmeler; maliyet, tur ve bağlam kullanımı kutunun altında ince bir durum satırında. Oturum seçimi AGENT CHAT başlığına taşındı.
- KOMİTE satırı yalnızca alt ajanlar çalışırken görünüyor.
- `/` komut menüsü yenilendi: komutlar Analiz / Oturum / Ajan / Bilgi başlıklarında, argüman etiketi, kısa adlar ve klavye ipuçlarıyla.
- Ayarlar › Bağlantı: harici MCP erişimi tek satıra indi (komut Kopyala ile alınıyor).
- Watchlist yenilendi: sembol rozetleri, dolgulu mini grafik, renkli değişim etiketi, arama simgeli ekleme kutusu.
- Genel görünüm: yeni renk paleti, yumuşak köşeler, odak halkaları, sekme ve düğme stilleri, ince kaydırma çubukları.

### Düzeltilen
- Yanıt başlamadan durdurulan turlar artık "Tamamlanamadı … [ede_diagnostic]" hatası göstermiyor; "Durduruldu" olarak kaydediliyor. Claude boş yanıt dönerse otomatik yeniden deneniyor, olmazsa önceki konuşma özetiyle yeni oturum açılıyor. Ham teknik hata mesajları kullanıcıya gösterilmiyor.
- Devam ettirilen oturumlarda tur maliyeti önceki turlarla birlikte iki kez sayılıyordu; artık yalnız o turun maliyeti ekleniyor.

## 0.5.0 — 23 Eylül 2026 (yeni düzen)

### Yeni
- **kmy gateway:** sunucu arka plan servisi olarak kurulabiliyor (macOS LaunchAgent, Linux systemd --user); oturum açılınca başlıyor, çökünce yeniden açılıyor.
- `borsa` komut satırı: `gateway install / uninstall / start / stop / restart / status / logs / token / open` (kurulumda `--dry-run`). `scripts/install.sh` ile tek komutta kurulum (tekrar çalıştırılabilir, sudo gerekmez).
- Yerel API güvenliği: tüm `/api` istekleri ve WebSocket erişim anahtarı istiyor (tarayıcıda otomatik çerez, betiklerde `Authorization: Bearer`); yabancı Host / Origin istekleri reddediliyor (DNS rebinding koruması).
- Ayarlar › SİSTEM › Gateway: durum, mod, PID, çalışma süresi, portlar, oturum / istemci sayısı; erişim anahtarını göster / kopyala / yenile; yeniden başlat, servis modunda durdur. Port ayarı: `BORSA_PORT` / `BORSA_REPORT_PORT`.
- **Mali özet** (DASHBOARD): özet gelir tablosu (son dönem ve geçen yılın aynı dönemi), özet bilanço (son iki çeyrek) ve son 5 çeyreğin satış, FAVÖK ve net kâr grafikleri. Ayrıntılı tablo "Mali tablolar · Detay" altında.
- KAP panelinde **↻ yenile** düğmesi: önbelleği atlayıp KAP'tan hemen çeker (en sık 20 saniyede bir).
- **Sembol arama** yenilendi: son arananlar ve watchlist kısayolları, BIST ve diğer piyasalar ayrı gruplarda, anlık fiyat, eşleşen metin vurgusu, klavye ipuçları.
- **AGENT CHAT** yeni görünüm: KOMİTE satırı (alt ajanlar ve çalışanlar), alt ajan mesaj kartları ("main → denetci", "denetci → main"), araç çağrıları tek satırda katlanıyor ("12 sn çalıştı ▸ · 5 araç"), mesajda saat ve maliyet.
- Mesaj kutusu: oturum, model (Claude ve Codex tek listede), efor, 📋 PLAN, arka plan işi, MALİYET, TUR, ctx çubuğu.
- Sağ panelde **PDF** sekmesi: raporlar burada açılıyor (ANALİZ / İNDİR / YENİ SEKMEDE AÇ / KAPAT).

### Değişen
- RAPORLAR akışında yalnızca **şirket raporları** var (şirket, bilanço değerlendirmesi, halka arz analist raporu); strateji, sektör, makro, teknik notlar ve toplu hedef fiyat listeleri gösterilmiyor. Ajan aracı tüm raporlara erişmeye devam ediyor.
- **PDF** sekmesi yalnızca bir rapor açıkken görünüyor; KAPAT veya sekmedeki ✕ ile kalkıyor.
- Yeni sekme düzeni: **TERMINAL** (varsayılan; ajan sohbeti, CHAT / TERMINAL düğmesiyle aynı sekmede kabuk), **DASHBOARD** (piyasa), **PORTFÖY**.
- Sağ panelde yalnızca **KAP**, **RAPORLAR** ve **PDF** var; TAKIM sekmesi KOMİTE satırına taşındı.
- Üst şerit kayıyor (üzerine gelince duruyor), kartlar tek satır genişliğine sığıyor; GBP/TL ve CHF/TL çıkarıldı.
- Ayarlar: BAĞLANTI / GÖRÜNÜM / VERİ / SİSTEM / HAKKINDA. Arayüz Modu: Chat (varsayılan) / Terminal (xterm.js).
- Terimler: WATCHLIST, AGENT CHAT, KOMİTE, "Mesaj yaz...", Ticker, Tüm Kurumlar, portföy sekmeleri büyük harf.

### Düzeltilen
- Bozuk kodlanmış adres isteği sunucuyu çökertmiyor.
- Sunucu yeni açıldığında Ayarlar penceresi boş değer göstermiyor.

### Kaldırılan
- Fiyat alarmları kaldırıldı.
- Sesle yazma düğmesi, bağlam çipleri ve mesaj kutusundaki fazla seçimler kaldırıldı (ekran bağlamı `/ekran` ile).

## 0.4.0 — 23 Eylül 2026 (ücretsiz veri kaynakları)

### Yeni
- **Aracı kurum raporları akışı** (Raporlar › Akış):
  - Kaynaklar: Garanti BBVA, AK, İş, Yapı Kredi, Ziraat, Vakıf, Tacirler, PhillipCapital, Integral ve A1 Capital'in herkese açık raporları.
  - 7G / 30G / 90G / Tümü, sembol, kurum ve tür filtreleri; YENİ etiketi.
  - Rapor uygulama içinde PDF olarak açılıyor; "Arşive kaydet" ve "Ajan ile analiz et" düğmeleri var.
  - Liste açılışta ve her 30 dakikada bir arka planda yenileniyor.
  - Hisse ekranında "Kurum raporları" kartı.
- **Mali tablolar** (İş Yatırım / KAP finansalları):
  - Son 8 çeyrek, çeyreklik veya kümülatif; satış, brüt kâr, FAVÖK, net kâr, nakit akışı, marjlar, net borç, özkaynak.
  - Bankalarda net faiz geliri, komisyon, karşılık, kredi ve mevduat.
- **Ekonomi haberleri:** Bloomberg HT, Foreks, Anadolu Ajansı, Dünya, Ekonomim, TRT Haber ve Investing TR RSS'leri. Hisse haberleri Google Haberler ile birleştirildi; piyasa ekranına "Ekonomi haberleri" kartı eklendi.
- **TCMB gösterge kurları:** döviz işlemlerinde kur boş bırakılırsa işlem gününün TCMB döviz satış kuru kullanılıyor.
- **TLREF (Borsa İstanbul):** Sharpe ve Sortino için risksiz faiz varsayılan olarak dönemin ortalama TLREF'i. Karşılaştırma ölçütlerine "TLREF (mevduat benzeri)" eklendi.
- **Yeni ajan araçları** (toplam 33): `get_broker_reports`, `read_broker_report`, `get_financial_statements`, `get_market_news`, `get_tcmb_rates`, `get_tlref`.

- **Gedik Yatırım** akışa eklendi: şirket, sektör/strateji ve model portföy raporları (herkese açık PDF'ler).
- **Halk Yatırım** açık yayınları akışa eklendi: haftalık "Analist Tavsiyeleri ve Hedef Fiyatları" (kapsanan tüm hisselerin tavsiye ve hedef fiyatı), halka arz değerlendirmeleri, Finansal Radar, yabancı işlemleri raporu.
- **Kurum raporu klasör izleme** (Ayarlar › Veri): kendi hesabınla indirdiğin raporlar (Halk şirket raporları, Deniz, Alnus, e-posta ekleri) İndirilenler klasöründen dakikada bir arşive alınır. Kurum ve semboller PDF'in ilk sayfasından tanınır, araştırma raporu olmayan PDF'ler atlanır. Varsayılan olarak kapalı.

### Kapsam dışı
- Halk Yatırım şirket raporlarının listesi müşteri girişi gerektiriyor. Deniz Yatırım bot korumalı, Alnus erişimi engelliyor. Bu kaynaklar klasör izlemeyle arşive alınabilir.

## 0.3.0 — 23 Eylül 2026

### Yeni
- **Araştırma hafızası**: ajan şirket ve konu notlarını `workspace/hafiza/` altında tutar. Mesajda geçen şirketin notu isteme otomatik eklenir. Hisse ekranında "Ajan notları" kartı (güncelle, sil).
- **Tetikleyici radarı hatırlatması**: izlenen tez varsa ve son tarama 7 günden eskiyse ajan yeni oturumda taramayı önerir. Radar becerisi kayıtlı tezlerin tetikleyicilerini güncel veriyle karşılaştırır.
- **Şirket belge arşivi**: KAP eklerini (faaliyet raporu, finansal rapor, sunum) `belgeler/<SEMBOL>/` klasörüne indirir. Hisse ekranında "Belgeler" kartı.
- **Uygulama içi PDF görüntüleyici**: KAP ekleri ve arşiv belgeleri uygulamanın içinde açılır. İndir, yeni sekmede aç, arşive kaydet ve "Ajan ile oku" düğmeleri var.
- **KAP şirket geçmişi**: sembolle 2 yıla kadar geriye bakılabilir. Liste, portföy ve sembol kapsamında 90 gün ve 1 yıl seçenekleri eklendi.
- **Alt ajanlar**: kıdemli analist, denetçi, araştırma asistanı ve makro stratejist.
- **Yeni beceriler**: şirket belgeleri, PDF okuma, Excel/tablo, yazı sesi (tweet, e-posta taslağı) ve beceri oluşturma. Toplam 14 beceri.
- **Formüllü DCF Excel modeli** (`scripts/dcf_excel.py`): Varsayımlar, DCF ve Duyarlılık sayfaları.
- **Çalışma kuralları** (`KURALLAR.md`) ve beceri haritası: araştırma tamlığı, varsayım denetimi, KAP çıktı biçimi, teslim biçimi, veri güvenliği, alt ajan kullanımı.
- **Sohbet**
  - Hızlı istemler açık ekrana göre değişir (portföy sekmesi, seçili hisse, açık rapor, açık KAP bildirimi).
  - `/yeni İSİM` ile oturuma ad verilebilir; oturumlar penceresinde arama var.
  - Sesle yazma düğmesi (işletim sistemi diktesi).
  - Argümansız `/kap` ajan maliyeti olmadan son sinyalleri gösterir.
  - Tur sonunda "Değişen dosyalar" kartı çıkar; efor seviyelerinin açıklaması ve tur sayısı gösterilir.
- **Ekip paneli**: biten alt ajanın çıktısı Haiku ile özetlenebilir.
- **Portföy**
  - K/Z katkısı (ilk 3).
  - Döviz cinsi varlıklarda K/Z, fiyat etkisi ve kur etkisi olarak ayrı gösterilir.
  - Ülke / piyasa dağılımı ve TL dışı (korunaklı) pay.
  - Değer grafiğinde net yatırılan çizgisi; çeyreklik getiri grafiği.
  - Temettü gelirinin yıl bazında sektör / varlık sınıfı / ülke kırılımı.
  - İşlem penceresinde platform nakit bakiyesi ve yetersiz bakiye uyarısı.
- **CSV içe aktarma**: aracı kurum başlıkları (Emir Tarihi, Kıymet, Gerçekleşen Adet, Ort. Fiyat, Kom.) otomatik tanınıyor. Tanınmayan sütunlar elle eşleştirilebiliyor. Aynı dosya yeniden yüklenirse daha önce kaydedilmiş satırlar atlanıyor.
- **Masaüstüne uygulama olarak kurma** (Chrome / Edge; başlıktaki ⤓ düğmesi).
- `npm test` 30 kontrole çıktı.

### Düzeltilen
- KAP tek istekte en fazla 2000 bildirim döndürdüğü için 7 ve 30 günlük listeler eksik kalıyordu (günde yaklaşık 400 bildirim var). Tarih aralığı artık bölünerek eksiksiz çekiliyor; geçmiş günler önbellekte tutuluyor.
- KAP ekleri Java sarmalı içinde geliyordu. Artık bu sarmal temizleniyor ve ek geçerli PDF olarak açılıp kaydediliyor.
- KAP tarih aralığı UTC ile hesaplanıyordu; gece 00.00–03.00 arasında o günün bildirimleri kaçabiliyordu. Artık İstanbul saatine göre hesaplanıyor.

## 0.2.0 — 23 Eylül 2026

### Yeni
- **Temel veriler** kartı (İş Yatırım, günlük): F/K, PD/DD, FD/FAVÖK, FD/Satış, piyasa değeri, halka açıklık, kurum tahminleri, dönem getirileri.
- **Hisse tarayıcı**: tüm BIST hisseleri; F/K, PD/DD, FD/FAVÖK, piyasa değeri, halka açıklık, yıl başından beri getiri, sektör ve endeks filtreleri; hazır filtreler. Ajan aynı taramayı `screen_stocks` aracıyla yapar.
- **Temettü takvimi** (Listem / Portföyüm / Tümü) ve sembol bazında temettü + sermaye artırımı geçmişi.
- **KAP sinyalleri**: bildirimler TEZ / YAP / FİN / KUR / DİĞER olarak sınıflanır; sayılı filtre çipleri, bildirim içeriği ve ekleri uygulama içinde, okundu takibi, "okundu say", daha fazla yükle.
- **Portföy**
  - 13 işlem türü: nakit giriş/çıkış, alış, satış, temettü, temettü yeniden yatırım, bedelsiz, bölünme, platformlar arası transfer, döviz çevirme, staking, faiz, masraf.
  - Platform × para birimi nakit takibi ve **kur farkı** (gerçekleşen / gerçekleşmeyen).
  - XIRR, devir hızı, özel tarih aralığı ve hızlı aralıklar.
  - Çoklu karşılaştırma: BIST 100, BIST 30, Dolar/TL, Euro/TL, gram altın, S&P 500 (TL), Bitcoin (TL).
  - Canlı fiyatı olmayan varlıklar (TEFAS fonu vb.) için elle fiyat; fiyat kaynağı etiketi (canlı / gecikmeli / manuel / son işlem).
  - Stopaj oranıyla brüt/net temettü, yaklaşan temettüler, veri uyarıları.
- **Sohbet**
  - Dosya ve görsel ekleme: 📎, sürükle-bırak, yapıştır (en fazla 10 MB).
  - Ajan soruları için seçenekli soru kartları, görev listesi kartı, plan modu çipi.
  - Bağlam çipleri: seçili sembol, portföy, ekranda açık olan (rapor, KAP bildirimi, sekme).
  - 28 `/` komutu; Türkçe adlar ve İngilizce takma adlar (`/help` ile listelenir).
  - Bağlam doluluk uyarısı (%80 / %95), hız sınırı bildirimi, uzun oturumlarda eski mesajları kademeli yükleme, yanıt kopyalama ve katlama.
- **Raporlar**: Ajan / Kurum ayrımı, kurum ve sembol etiketleri, kurum filtresi, sembol araması, tam ekran sunum.
- **Ayarlar**: Bağlantılar (MCP durumu), Sürüm Notları, sunucuyu yeniden başlat, CLI kurulum düğmeleri, veri kaynakları listesi.
- İzleme listesinde sağ tık menüsü: grafik, ajan özeti, KAP, alarm, işlem ekle, listeden çıkar.
- Fiyatların yanında kaynak ve gecikme etiketi; sol altta veri kaynakları özeti.
- `npm test`: portföy motoru için 24 kontrollü regresyon testi (maliyet, K/Z, temettü, nakit, kur farkı, XIRR); geçici veritabanında çalışır.

### Düzeltilen
- Gram altın vadeli kontrattan hesaplandığı için yaklaşık %0,7 yüksek görünüyordu. Artık Truncgil ve spot ons kullanılıyor.
- Dolar/TL günlük değişiminin işareti ters çıkabiliyordu.
- BIST 100 listesinde 12 sembol eskiydi. Liste artık İş Yatırım'dan güncel çekiliyor.
- ATR artık Wilder ortalamasıyla hesaplanıyor. 52 haftalık zirve ve dip gün içi yüksek/düşük değerlerden alınıyor.
- Filtre hızlı değiştirildiğinde eski sonuç yeni sonucu ezebiliyordu (KAP, işlemler, ayarlar, sembol ekranı).
- Esc tüm pencereleri kapatıyordu. Artık yalnızca en üstteki kapanıyor.
- Sayfa yenilenince fazladan kabuk açılıyordu.
- Yabancı varlıklarda ortalama maliyette TL ve USD karışıyordu. Artık varlığın kendi para biriminde gösteriliyor.
- Ajan çalışırken yerel komutlar (`/durdur`, `/status`) engelleniyordu. Komuttan sonra öneri listesi açık kalıyordu.
- Truncgil bağlantısı Node'un HTTP/2 istemcisiyle kopabiliyordu; yanıt da dosya güncellenirken yarım gelebiliyordu. Bu durumda döviz ve altın yedek kaynağa düşüyordu: gram altın ~%0,85 yüksek görünüyor, çeyrek altın hiç gelmiyordu. Artık HTTP/1.1 kullanılıyor, kısa beklemeyle yeniden deneniyor ve yarım yanıttaki tam kayıtlar kurtarılıyor.
- Grafik ekseni ve ipuçlarındaki ay adları İngilizceydi ("Apr"). Artık Türkçe ("Nis", "18 Haziran 2026").
- Hisse başlığındaki şirket adı Türkçe karaktersiz geliyordu ("Yollari"). Artık İş Yatırım adı ve "Borsa İstanbul" etiketi kullanılıyor.
- Sembol aramasında varlık türleri İngilizceydi ("gold"). Artık Türkçe (Altın, Döviz, Emtia…).

### Kaldırılan
- Sol paneldeki döviz çevirici. Yerinde artık veri kaynağı ve gecikme bilgisi gösteriliyor.

## 0.1.0 — İlk sürüm
- Piyasa, izleme listesi, portföy, KAP, alarmlar, terminal, raporlar, zamanlanmış görevler, Claude / Codex ajanı.

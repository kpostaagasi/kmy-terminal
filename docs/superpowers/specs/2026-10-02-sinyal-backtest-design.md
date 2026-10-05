# Sinyal geçmiş performansı (backtest)

Tarih: 2026-10-02 · Sürüm hedefi: 0.21.0

## Amaç
Radar sinyallerinin geçmişte gerçekten bir şey söyleyip söylemediğini **dürüstçe** göstermek: BIST 100, 10 yıl, her sinyal türü için 5 / 20 / 60 işlem günü sonraki getiri, **taban** (aynı koşullarda her gün alınsaydı) ve tabana göre fark, XU100'a göre fark, örnek sayısı. Ürünü rakipten ayıran bir güvenilirlik özelliği; yanıltıcı olmaması birinci önceliktir.

Bağlam: ticari ürünleşme hedefi. Kısıtlar: ad küçük harf (kmy terminal), rakip adı geçmez, UI metinleri `t()` ile (Türkçe/İngilizce), yeni bağımlılık yok, mevcut veri (Yahoo günlük), yatırım tavsiyesi değildir. Sinyal tanımları radar ve bildirimle **aynı koddan** gelir.

Kullanıcı onaylı kararlar: **A)** ortak sinyal tanımı + bölünme düzeltmesi + saf backtest motoru; ilk sürümde yalnız **genel tablo** (sembol bazlı görünüm ve ajan aracı yok); bölünme düzeltmesi **canlı radarı ve sinyal bildirimini de** etkiler; giriş ertesi gün açılışı, çıkış h. gün kapanışı; 20 günlük olay tekilleştirme; **elle hesaplama**; eşikler −%25 / +%30.

## Doğrulanmış olgular (2026-10-02'de yoklandı)
- **Veri derinliği:** `getHistory(s, '10y', '1d')` BIST hisseleri için ~2.539 mum (2016-10 → 2026-10), sembol başına ~0,3 sn; XU100 `5y` 1.251 mum, `10y` ile daha uzun. `'max'` aylık döner (kullanılmaz).
- **BIST 100'de 11 aşırı günlük hareket** (günlük getiri < −%25 ya da > +%50): AYGAZ 2022-09-01 +%73, CCOLA 2024-08-01 −%91, CVKMD 2026-08-03 −%62, EUREN 2024-12-02 −%64, FENER 2024-12-09 −%59 / 2025-06-23 −%79 / 2025-12-29 −%64, HEKTS 2024-09-09 −%65, KATMR 2025-04-14 −%28, RYSAS 2020-03-12 −%28, TUKAS 2025-02-03 −%67. Bunlar **düzeltilmemiş bedelsiz/bölünmelerdir**: Yahoo'nun `adjclose` alanı BIST için ham kapanışla **aynı**, `events=splits` olayları güvenilmez (CCOLA için farklı tarihli bir olay var, FENER için üç düşüşe rağmen hiç olay yok). BIST günlük fiyat sınırı (±%10, geçmişte ±%20) gerçek bir tek gün hareketini bu eşiklerin çok altında tutar.
- Aynı sorun **canlı radarı ve 0.18.0 sinyal bildirimini** de bozar (örn. CVKMD'de radar şu an −%62'lik sahte düşüşü görür: sahte 52 hafta dibi, sahte SMA200 kırılımı). `scanBars` ham seriyle çalışır.
- **Taban oranı kritik:** 40 hisse × 10 yıl prototipinde "her gün" alımın 20 günlük ortalama getirisi **+%3,3** (isabet %56), 60 günlükte +%11,1 (isabet %60); RSI<30 sinyali (n=502) 20 günde +%2,7 (isabet %59), yani tabanın **altında**; altın kesişim (n=182) +%5,3; 52 hafta zirvesi (n=871) +%5,7. Enflasyonlu TL'de naif "isabet %59" başarı gibi görünür.
- Radar sinyal tanımları (uygulama öncesi) `server/radar.js`'te `scanBars(bars)` içindeydi ve yalnız **son mum** için hesaplanır (RSI, SMA50/200, MACD, 52 hafta, hacim); göstergeler (`server/indicators.js`) nedenseldir (i. değer yalnız ≤ i verisini kullanır).

## Mimari
- **`server/seri.js`** (yeni, saf): `adjustSplits(bars, { down = -0.25, up = 0.30 }) → { bars, breaks }`. Ardışık kapanış oranı `c[i]/c[i−1] − 1 < down` ya da `> up` olan gün bölünme/birleşme sayılır; **o günden önceki tüm mumların** `o, h, l, c` değerleri `c[i]/c[i−1]` oranıyla çarpılır (kırılma noktasında oran 1 olur), `v` aynı oranla bölünür. Birden çok kırılma sondan başa birikir. `breaks: [{ index, date, ratio }]`. Girdi değiştirilmez (yeni dizi döner). Geçersiz mum (`c` sayı değil ya da ≤ 0) kırılma hesabına katılmaz; önceki geçerli kapanışla kıyaslanır.
- **`server/sinyal-tanim.js`** (yeni, saf; `radar.js` buradan geri dışa aktarır, `signal-watch.js` değişmez): sinyal tanımları ayrılır.
  - `signalSeries(bars) → S`: kapanış/hacim dizileri ve göstergeler (SMA50/200, RSI14, MACD) **bir kez** hesaplanır.
  - `signalsAt(S, i) → string[]`: i. mum için sinyal anahtarları; kurallar `scanBars`'taki kuralların birebir aynısı (RSI<30 / >70, SMA50↔SMA200 kesişimi son 5 mumda, 52 hafta (i−251..i, ±%0,5), hacim > 2× ortalama (v[i−20..i−1]), kapanış↔SMA200 kesişimi son 3 mumda, MACD↔sinyal kesişimi son 2 mumda). Yalnız `≤ i` verisini kullanır.
  - `scanBars(bars)` = `adjustSplits` → `signalSeries` → son indeks için `signalsAt`; aynı dönüş alanları (`price, changePct, rsi, volRatio, signals`), `bars.length < 60` ise `null`. **Bölünme içermeyen serilerde çıktı değişmez** (altın-referans testiyle korunur).
  - `SIGNALS` aynen kalır (`label`, `dir`).
- **`server/backtest.js`** (yeni, saf motor): olay üretimi, getiri hesabı, taban, toplama. Veritabanı ve ağ içe aktarmaz.
- **`server/backtest-run.js`** (yeni, ağ + durum): BIST 100 üyelerini (`universe.bist100()`) 8 eşzamanlı çekip motoru çalıştırır, sonucu kaydeder, tek koşu kuralı.
- **`server/index.js`**: `GET /api/backtest`, `POST /api/backtest/run`.
- **`web/js/market-view.js`**, `web/js/lang/en/market.js`, `web/terminal.css`: tarayıcı sayfasında "Sinyal geçmişi" paneli.
- **Testler:** `test/radar.test.mjs` (altın-referans, önek eşdeğerliği), `test/seri.test.mjs`, `test/backtest.test.mjs`; fixture `test/fixtures/radar-golden.json`. Hepsi çevrimdışı, `npm test` zincirinde.

### Olay ve getiri tanımı
- **Olay:** `signalsAt(S, i)` kümesinde sinyal `k` var ve `signalsAt(S, i−1)` kümesinde yok. Seri başlangıcında ısınma için `i ≥ WARMUP = 252` (52 hafta penceresi ve SMA200 tam otursun).
- **Tekilleştirme:** aynı hisse ve aynı sinyal türü için son **kabul edilmiş** olaydan itibaren `GAP = 20` işlem günü içindeki olaylar sayılmaz. (60 günlük ufukta örtüşme sürer; bilinen sınır.)
- **Getiri (ufuk h ∈ {5, 20, 60}):** sinyal günü `i`'nin kapanışından sonra görülür (bildirim de seans sonrası gelir). **Giriş `bars[i+1].o`, çıkış `bars[i+h].c`**, `getiri = çıkış / giriş − 1`. `i+h` seri dışındaysa ya da giriş açılışı geçersizse (`≤ 0`/sayı değil) o olay o ufukta **dışarıda**. Veri sonuna yakın olaylar bu yüzden daha az ufukta sayılır (`n` ufuk başına ayrı).
- **Taban:** aynı hisselerde `WARMUP ≤ i ≤ n−1−h` olan **her gün** için **aynı giriş/çıkış kuralıyla** getiri (sinyal olan günler dahil). Taban satırı: `n, ortalama, medyan, hitUp (getiri > 0 payı), hitDown (getiri < 0 payı), excess (XU100'a göre ortalama fark)`.
- **XU100'a göre fark:** olay (ve taban günü) penceresi için XU100 getirisi aynı kuralla: giriş `XU100.o` (`bars[i+1]` tarihi), çıkış `XU100.c` (`bars[i+h]` tarihi), tarih eşleşmesi İstanbul takvim günüyle (`new Date(t).toISOString().slice(0, 10)`). Tarih XU100'da yoksa o olayın `excess`'i hesaba girmez (`n` ve `excessN` ayrı tutulur). `excess = hisse getirisi − XU100 getirisi` (puan).
- **Yön duyarlı isabet:** `SIGNALS[k].dir === 'down'` ise `hit = getiri < 0` payı, aksi halde `getiri > 0` (nötr sinyal yükseliş gibi okunur); tabanın isabeti aynı yönden (`hitDown` ya da `hitUp`).
- **Fark:** `delta = ortalama − taban.ortalama` (puan). Renk, sinyal yönüne **uygunsa** yeşil (yükseliş sinyalinde `delta > 0`, düşüşte `delta < 0`), değilse kırmızı.
- **Az örnek:** `n < MIN_N = 30` ise `low: true` (arayüzde soluk ve "az örnek").
- **Toplam tablo:** her `(sinyal, ufuk)` için `{ n, mean, median, hit, excess, excessN, delta, low }`.

### Sonuç biçimi (kalıcı, API'nin döndüğü)
```
{ at: number,
  params: { horizons: [5, 20, 60], gap: 20, warmup: 252, minN: 30, universe: 'BIST100', range: '10y',
            symbols: number, skipped: string[], bars: number, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', splitBreaks: number },
  baseline: { '5': { n, mean, median, hitUp, hitDown, excess, excessN }, '20': {…}, '60': {…} },
  signals: { rsi_os: { dir, label, '5': { n, mean, median, hit, excess, excessN, delta, low }, '20': {…}, '60': {…} }, … } }
```
Getiriler oran olarak (0,033 = %3,3) saklanır; yüzde biçimlemesi arayüzdedir. `skipped`: 300 mumdan kısa seri ya da veri alınamayan semboller. `splitBreaks`: toplam düzeltilen kırılma sayısı (şeffaflık).

### Çalıştırma, kalıcılık, API
- `backtest_result(id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL, result TEXT NOT NULL)`; tek satır, her koşu üzerine yazar; yeniden başlatmada son sonuç görünür.
- `GET /api/backtest` → `{ at, result, running }` (hiç hesaplanmadıysa `at: null, result: null`). Bozuk/okunamayan kayıt → `result: null` (çökme yok).
- `POST /api/backtest/run` → hesaplar, aynı biçimi döner (`running: false`). Koşu bitince **başarılı ya da başarısız** `broadcast({ t: 'backtest.updated' })`.
- **Tek koşu:** koşu sürerken gelen ikinci çağrı aynı sonucu bekler. Genel zaman aşımı 300 sn; zaman aşımı bekleyenleri bırakır ama iç koşu iptal edilemez: o bitene kadar yeni koşu başlatılmaz (`Önceki hesaplama hâlâ sürüyor…` hatası, `running: true`); KAP/Yahoo yükü üst üste binmesin (veri sağlığı rozetinde öğrenilen ders).
- Hesap yaklaşık 100 sembol × ~0,3 sn ÷ 8 eşzamanlı + motor; ölçülecek, arayüz "≈1 dk" der. `getHistory` kendi 30 dk önbelleğini kullanır.

### Arayüz
- Terminal › Tarayıcı sayfasında (`#/pazar/tara`) "Sinyal radarı" ve "Son sinyal bildirimleri" panellerinin altında **"Sinyal geçmişi"** paneli.
- Başlık şeridi: ufuk seçici (**5 / 20 / 60 gün**, seçim `localSet` ile hatırlanır, varsayılan 20), **Hesapla** (hiç hesaplanmadıysa) / **Yeniden hesapla** düğmesi (hesap sürerken kilitli, dönen gösterge, çift tıklama yeni koşu başlatmaz), hesap tarihi ("hesaplandı 02.10.2026 15:23").
- Tablo: ilk satır **Taban (her gün)**; ardından sinyal satırları (`SIGNALS` sırası, yön etiketi). Sütunlar: **Sinyal · n · Ort. getiri · Fark (taban) · XU100'a göre · İsabet · Taban isabeti**; taban satırında `Fark` boş. `low` satırlar soluk ve "az örnek" rozetli. Dar sütunda (container query) `Taban isabeti` ve `XU100'a göre` gizlenir.
- Altta sabit açıklama: yatırım tavsiyesi değildir; geçmiş gelecek için garanti vermez; yalnız bugünün BIST 100 üyeleri (hayatta kalan şirketler yanlılığı); nominal TL getirisi (enflasyon tabanı yükseltir, bu yüzden taban ve fark gösterilir); işlem maliyeti yok; olaylar aynı hissede 20 günde tekilleştirilir ama farklı hisselerdeki aynı güne denk gelen olaylar ilişkilidir (fark tesadüf olabilir); %25'in altındaki küçük bedelsizler düzeltilemez; kullanılan dönem, sembol sayısı ve düzeltilen bölünme sayısı.
- Durumlar: hiç hesaplanmadı (açıklama + düğme), hesaplanıyor (dönen gösterge; başka pencerede sürüyorsa `GET` `running` ile 5 sn'de bir yoklanır), hata (iletisi pencerede; önceki sonuç korunur), sonuç.
- Türkçe/İngilizce; 760 px'te taşma yok.

### Canlı sinyallere etkisi (bilerek)
`scanBars` bölünme düzeltmesi uyguladığı için canlı radar ve 0.18.0 sinyal bildirimi bölünme yaşamış hisselerde (örn. CVKMD) sahte sinyalleri bırakır. Bu, `signal_state`'te tutulan önceki durumla karşılaştırıldığında **tek seferlik** "yeni sinyal" bildirimlerine yol açabilir (düzeltilmiş seride önceden olmayan bir sinyal belirirse). Kabul edilir ve belgelenir.

## Hata yönetimi
- Bir sembolün geçmişi alınamazsa ya da 300 mumdan kısaysa `skipped`'e eklenir, diğerleri hesaba katılır. Sembollerin yarısından azı başarılıysa koşu hata verir (anlamsız örneklem).
- XU100 alınamazsa koşu hata verir (XU100'a göre sütunu için zorunlu).
- Bozuk mum (`o`/`c` sayı değil ya da ≤ 0): `adjustSplits` onu kırılma hesabına katmaz, motor o gün için olay/taban getirisi üretmez.
- `GET` kayıt okunamazsa `result: null` döner; `POST` hatası 400 + Türkçe ileti.

## Testler (çevrimdışı)
- **`test/radar.test.mjs`:** (1) **altın-referans:** refactor **öncesi** `scanBars` çıktısı sabitlenmiş deterministik sentetik serilerde (tohumlu rastgele yürüyüş; RSI aşırı satım, kesişimler, 52 hafta zirve/dibi, hacim patlaması üretecek şekilde kurulmuş) `test/fixtures/radar-golden.json` ile birebir aynı; (2) **önek eşdeğerliği (ileriye bakma yok):** örneklenen `i` için `signalsAt(signalSeries(bars), i)` = `scanBars(bars.slice(0, i+1)).signals`; (3) kısa seri `null`; (4) bölünme içeren seride `scanBars` bölünmeyi düzeltir (sahte `low52`/`death` yok).
- **`test/seri.test.mjs`:** aşağı bölünme (−%64), yukarı birleşme (+%73), eşik sınırları (−%25 dahil değil / −%25,01 dahil; +%30 dahil değil / +%30,01 dahil), ±%10 ve ±%20 gerçek hareketler dokunulmaz, birden çok bölünme birikir, ilk mum, tek mum, boş girdi, bozuk mum, hacim ters ölçeklenir, girdi değiştirilmez, `breaks` içeriği.
- **`test/backtest.test.mjs`:** olay = ilk belirme günü; tekilleştirme (20 gün içi tekrar sayılmaz, 21. gün sayılır); giriş = ertesi gün açılışı, çıkış = h. gün kapanışı (elle hesaplanmış küçük seri); `i+h` seri dışı olay dışlanır; taban aynı kuralla ve sinyal günlerini içerir; yön duyarlı isabet (`down`: `< 0`); XU100 eksik tarihte `excessN` < `n`; `delta`; `low` bayrağı (n=29 / n=30); ısınma (i < 210 olay yok); çok kısa seri; sıfır/NaN fiyatlı mum; sinyalsiz seri; toplama boş girdi; getiriler oran (yüzde değil).
- **Canlı doğrulama (uygulama sırasında):** prototip sayılarıyla karşılaştırma (40 hisse alt kümesi: n ≈ 502 / 182 / 871, taban 20g +%3,3), 11 şüpheli hissenin `breaks` listesinde çıkması, CVKMD'nin canlı radar sinyallerinin düzelmesi, `npm test` yeşil, panelin 1440 / 900 / 760 px ve Türkçe / İngilizce görünümü, çift tıklamada tek koşu, başarısız koşuda penceresinin takılı kalmaması.

## Kapsam dışı
Sembol bazlı görünüm, ajan aracı, işlem maliyeti, sinyal birleştirme ve parametre optimizasyonu, anlamlılık testi (t-değeri) ve güven aralığı (ilişkili olaylar yüzünden iyimser olurdu; yerine `n`, taban ve açık uyarı), endeks dışı evren, teknik analiz sayfasının (RSI/SMA kartı) aynı bölünme sorunu (ayrı iş olarak bildirilir), grafikteki ham fiyat gösterimi, otomatik/zamanlanmış hesap.

## Bilinen sınırlar (belgelenecek)
- Hayatta kalan şirketler yanlılığı: yalnız bugünün BIST 100 üyeleri; listeden düşenler ve işlemden kalkanlar yok.
- Nominal TL getirisi: enflasyon tabanı yükseltir; bu yüzden taban ve fark gösterilir, ham ortalamalar tek başına yorumlanmamalı.
- %25'in altındaki küçük bedelsizler (ve gerçek hareketten ayırt edilemeyen küçük bölünmeler) düzeltilemez; eşiğin üstündeki bir kırılma yanlışlıkla gerçek çöküş sayılırsa düzeltme o günkü gerçek hareketi yok sayar (BIST fiyat sınırı bunu pratikte engeller).
- 60 günlük ufukta aynı hissedeki olaylar örtüşür; farklı hisselerde aynı güne denk gelen olaylar (piyasa genelindeki RSI<30 günleri) ilişkilidir: etkin örnek sayısı `n`'den küçüktür.
- Giriş ertesi gün açılışı tam gerçekleşmez (açılış tek fiyat değildir), işlem maliyeti ve kayma yok.
- Bu bir araştırma aracıdır, yatırım tavsiyesi değildir.

## Başarı ölçütü
Panel her sinyal için taban, fark, XU100'a göre fark ve örnek sayısını dürüstçe gösterir (naif isabet tek başına gösterilmez); sinyal tanımları radar ve bildirimle aynı koddan gelir ve **ileriye bakma yoktur** (önek eşdeğerliği testi); bölünmeler düzeltilir (11 şüpheli hisse `breaks`'te, canlı radar sahte sinyal üretmez); radar çıktısı bölünmesiz serilerde değişmez (altın-referans); `npm test` yeşil; panel 760 px'te taşmaz; başarısız koşu pencereyi takılı bırakmaz.

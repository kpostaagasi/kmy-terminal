# Takvim sayfası: yaklaşan olaylar

Tarih: 2026-10-02 · Sürüm hedefi: 0.19.0

## Amaç
Portföydeki ve izleme listesindeki hisseler için "önümüzdeki günlerde ne olacak" ekranı: temettü ve sermaye artırımı, TCMB günleri ve bilanço sezonu tek yerde, gün gün. **Kesin** ve **tahmini** bilgi her satırda açıkça ayrılır (bu oturumun ana teması veri doğruluğu).

Bağlam: ticari ürünleşme hedefi; rakip terminallerde standart bir özellik. Kısıtlar: ad küçük harf (kmy terminal), rakip adı geçmez, kişisel veri git'e girmez, UI metinleri `t()` üzerinden (Türkçe/İngilizce), yeni bağımlılık yok, mevcut kaynaklar (İş Yatırım, KAP, tcmb.gov.tr).

Bu spec'in kullanıcı onayı alınmış kararları: **A) birleşik TAKVİM sayfası, gün gün liste**; ilk sürümde **temettü + TCMB + bilanço**; TÜFE günü, aylık ızgara, hatırlatıcı ve .ics dışa aktarma kapsam dışı. Mevcut Piyasa özeti sayfasındaki "Temettü takvimi" paneli yerinde kalır.

## Doğrulanmış olgular (2026-10-02'de yoklandı)
- **Temettü ve sermaye artırımı** zaten çekiliyor (`universe.corporateActions`, İş Yatırım): önümüzdeki 24 kayıt, 5 Ekim–25 Aralık 2026, hepsi nakit temettü; bedelsiz/bedelli şu an yok. İş Yatırım tablosunda tarih sütunu yalnız "Tarih" başlığını taşır (hak kullanım mı ödeme mi belli değil); arayüzde de yalnız "Tarih" denir.
- **TCMB:** `https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Duyurular/Takvim` sayfasında tek `<table>`: 4 sütun (PPK karar, PPK toplantı özeti, Enflasyon Raporu, Finansal İstikrar Raporu), tarihler "22 Ocak 2026" biçiminde, **boş hücreler gerçekten boş** (`''`); 2026 ve 2027 Haziran'a kadar yayımlı. Düz metin ayrıştırması boş hücreleri kaybettirir, bu yüzden hücre bazlı okunur.
- **Bilanço:** KAP şirket bildirimlerinde `cls === 'FR'` kayıtları `period` (1 = 3 ay, 2 = 6 ay, 3 = 9 ay, 4 = yıllık) ve `year` taşır; aynı bildirim günü aynı döneme ait 3 kayıt gelir (Sorumluluk Beyanı, Faaliyet Raporu, "Finansal Rapor"). THYAO: 3. çeyrek 2025 → 07.11.2025, yıllık 2025 → 04.03.2026, 1. çeyrek 2026 → 29.04.2026, 6 ay 2026 → 05.08.2026. KAP'ın şirket bazlı sorgusu **en çok 365 gün** (daha uzunu HTTP 500) ve 500 hisse için günlük istek mümkün değil.
- Piyasa özeti sayfasında Listem / Portföyüm / Tümü seçimli bir temettü paneli zaten vardır; yeni değer TCMB + bilanço + tek gün gün liste + kesin/tahmini ayrımıdır.

## Mimari
Üç sağlayıcı tek olay listesine birleşir; sunucuda saf mantık ayrı dosyada (çevrimdışı test edilir), ağ ve veritabanı ayrı dosyada.

- `server/takvim.js` (yeni, **saf**): ayrıştırıcılar ve kurallar. `parseTcmb(html)`, `legalDeadline({ period, year, consolidated })`, `expectedDate(lastYearIso, deadlineIso)`, `bilancoEvents({ symbol, today, announced, consolidated })`, `plausibleAnnouncements(records, consolidated)`, `marketSeasonEvents(today)`, `defaultWindow(today)`, `istanbulToday(nowMs)`, `corporateEvents(actions)`, `buildCalendar({ from, to, events, kinds })`, `groupKey(date, today)`. Veritabanı ve ağ içe aktarmaz.
- `server/takvim-kaynak.js` (yeni): ağ ve önbellek. `tcmbEvents()` (günde bir çeker, `http_cache`), `announcedFor(symbol)` (KAP, sembol başına 24 saat önbellek), `calendar({ scope, from, to })` bunları birleştirir. Hata yönetimi burada.
- `server/index.js`: `GET /api/calendar`.
- `web/js/market-view.js`: yeni `TAKVİM` sayfası, ana sayfada yeni kart, hash yönlendirme (`#/pazar/takvim`), mevcut temettü paneline "Tüm takvim →" bağlantısı. `web/js/app.js`: `PAGE_SLUG` ve `PG_FROM` girdileri.
- `web/js/lang/en/*`: İngilizce karşılıklar.
- `test/takvim.test.mjs` (yeni, çevrimdışı) ve `test/fixtures/tcmb-takvim.html` (sayfadaki tablonun kopyası).

### Olay biçimi
```
{ date: 'YYYY-MM-DD',                  // İstanbul takvim günü
  type: 'temettu' | 'bedelsiz' | 'bedelsiz_temettu' | 'bedelli'
      | 'ppk_karar' | 'ppk_ozet' | 'enflasyon_raporu' | 'fin_istikrar'
      | 'bilanco_aciklandi' | 'bilanco_beklenen' | 'bilanco_son_teslim',
  kind: 'temettu' | 'sermaye' | 'tcmb' | 'bilanco',   // süzgeç grubu
  symbol: 'THYAO' | null,
  certainty: 'kesin' | 'tahmini',
  data: { … }                           // türe göre parametreler (aşağıda)
}
```
Metinleri sunucu değil **istemci** kurar (`t()` ile); sunucu yalnız `type` ve `data` verir, böylece çeviri tek yerde kalır.

### Sağlayıcı kuralları
1. **Temettü / sermaye artırımı** (kesin). Her `corporateActions` kaydı, doldurulmuş alanına göre bir ya da birkaç olaya ayrılır: `cashGrossPct > 0` ya da `dpsGross > 0` → `temettu` (`data: { dps, grossPct }`); `bonusPct > 0` → `bedelsiz`; `bonusDivPct > 0` → `bedelsiz_temettu`; `rightsPct > 0` → `bedelli`. `kind`: temettü → `temettu`, diğerleri → `sermaye`.
2. **TCMB** (kesin, resmî). Sayfadaki tablodan hücre bazlı: sütun 1 → `ppk_karar`, 2 → `ppk_ozet`, 3 → `enflasyon_raporu`, 4 → `fin_istikrar`; boş hücre atlanır; `symbol: null`. Tarih "22 Ocak 2026" biçiminden çevrilir (Türkçe ay adları). **Sağlamlık:** başlık satırında dört beklenen sütun adı yoksa ya da geçerli PPK karar tarihi 8'den azsa `parseTcmb` **hata fırlatır**; sessizce boş liste dönmez. Sayfa günde bir çekilir; çekilemezse son başarılı kayıt (30 güne kadar) `stale: true` ile kullanılır; hiç kayıt yoksa TCMB olayları yanıtta `warnings` ile belirtilip atlanır.
3. **Bilanço** (yalnız Listem ve Portföyüm). Sembol başına KAP'ın son 365 günü (`companyDisclosures(symbol, 365)`) çekilir, `cls === 'FR'` kayıtlarından (dönem, yıl) başına **en erken** `publishDate` alınır (düzeltme bildirimleri sonradan gelir); başlıklardan `isConsolidated` ile anlaşılır: "(Konsolide)" → `true`, "(Konsolide Olmayan)" → `false` (bu başlık da "konsolide" sözcüğünü içerir, ayrıca denetlenir; Türkçe büyük harf desteklenir), konsolidasyon ifadesi yoksa `null` (bilinmiyor → konsolide süre varsayılır). Önbellek: sembol başına 24 saat.
   - **Dönem sonları:** 1 → 31 Mart, 2 → 30 Haziran, 3 → 30 Eylül, 4 → 31 Aralık.
   - **Aday dönemler:** bugünden önceki son iki dönem sonu (ör. 2 Ekim 2026'da 2026/3 ve 2026/2).
   - Aday dönemin (dönem, yıl) kaydı varsa → `bilanco_aciklandi` (kesin, gerçek tarih; yalnız pencerede ise görünür).
   - Yoksa iki olay: `bilanco_son_teslim` (tahmini): dönem sonu + yasal gün sayısı, konsolide değilse ilk sütun: **1 ve 3: 30 / 40**, **2: 50 / 60**, **4: 60 / 70** gün (SPK II-14.1'e göre `[solo, konsolide]`); hafta sonuna denk gelirse sonraki pazartesi, resmî tatiller hesaba katılmaz. Ve `bilanco_beklenen` (tahmini): geçen yılın aynı dönemi için açıklama tarihi (`data.lastYear`) bir yıl ileri taşınır (29 Şubat → 28 Şubat), hafta sonuna denk gelirse önceki iş günü, son teslim tarihini geçmez. Geçen yıl kaydı yoksa (yeni halka arz) yalnız son teslim üretilir.
   - KAP'ta yıllar sonra gelen düzeltme/yeniden sunum kayıtları (ör. 2025/1 dönemi için 2026'da yayımlanan) ilk açıklama sayılmaz: yasal son teslimden 90 gün (`LATE_GRACE_DAYS`) sonra gelen kayıtlar atılır (`plausibleAnnouncements`); aksi halde "geçen yılın tarihi" yanlış çıkar. 8 hissede 37 gözlemin 5'i bu kayıtlardı; kalan 32'sinin hiçbiri hesaplanan son teslimi aşmadı.
  - Konsolide olup olmadığı hiç bilinmiyorsa (kayıt yok) solo süre değil **konsolide** süre kullanılır (daha geniş, yanlış alarm üretmez) ve `data.assumed: true` ile işaretlenir.
4. **Tümü** kapsamı: bilanço hisse bazlı hesaplanmaz; onun yerine her aday dönem için tek bir sembolsüz `bilanco_son_teslim` olayı (konsolide süreyle, `data.market: true`) üretilir.

### API
`GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&scope=watchlist|portfolio|all&kinds=temettu,sermaye,tcmb,bilanco`
- Varsayılan `from = bugün − 7 gün`, `to = bugün + 60 gün`; `to − from` en çok 366 gün.
- `scope=watchlist|portfolio`: sembol kümesi sunucuda `store.watchlist()` / portföy pozisyonlarından alınır (istemci liste göndermez). Küme boşsa sembole bağlı olaylar boş döner (TCMB olayları yine görünür) ve `emptyScope: true`.
- Yanıt: `{ today, from, to, scope, events: [...], warnings: [{ source, message }], stale: [source…], emptyScope, mine: [...] }`; `mine` listedeki ve portföydeki BIST sembolleridir (Tümü kapsamında "listede" işareti için); olaylar tarihe, sonra türe, sonra sembole göre sıralı.
- TCMB olayları `scope`'tan bağımsızdır (hepsinde görünür). Temettü / sermaye artırımı: `all` hepsi, diğerlerinde küme ile süzülür.
- Sunucu tarafında gün gruplaması yoktur (istemci, İstanbul saatiyle `today` değerini yanıttan okuyarak gruplar).

### Arayüz
- Terminalde yeni sayfa `TAKVİM` (`#/pazar/takvim`), ana sayfada `HİSSE TARAYICI / SEKTÖR HARİTASI / PİYASA ÖZETİ` kartlarının yanında yeni kart; komut satırında `alias('calendar', 'TAKVIM', 'CAL', 'CALENDAR')` (mevcut `TARA`, `SEKTOR`, `PIYASA` takma adlarıyla aynı kalıp) ve `HELP` listesindeki sayfa satırına eklenir.
- Sayfa başlığı + şerit: kapsam seçimi (**Listem / Portföyüm / Tümü**, seçim `localSet('calPageScope')` ile hatırlanır; varsayılan Portföyüm, boşsa Listem) ve tür süzgeçleri (Temettü · Sermaye artırımı · TCMB · Bilanço; çoklu seçim, hatırlanır).
- Gün başlıkları: **Son günler** (bugünden önceki 7 gün), **Bugün**, **Yarın**, **Bu hafta** (gün adıyla), sonra "dd.mm.yyyy". Başlıkta o günün olay sayısı.
- Satır: tarih/saat yok (yalnız gün), tür simgesi/etiketi, sembol (tıklanınca sembol açılır; portföyde/listede olanlar `pill` ile işaretli), metin (istemcide `t()` ile kurulur), sağda **KESİN** ya da **TAHMİNİ** etiketi. Tahmini etiketinin `title` değeri gerekçeyi taşır ("Geçen yıl 7 Kasım'da açıkladı; yasal son teslim 9 Kasım"; varsayım varsa "konsolide süre varsayıldı").
- Uyarılar (`warnings`, `stale`) sayfanın üstünde tek satırda gösterilir; boş durumlar açık yazılır ("Bu kapsamda ve pencerede olay yok", "İzleme listesi boş").
- Dar sütunda (760 px) tek sütun, taşma yok, ölçülür.
- Mevcut Piyasa özeti "Temettü takvimi" paneli değişmez; başlığına "Tüm takvim →" bağlantısı eklenir.

## Hata yönetimi
- **İstek hacmi:** yalnız istenen türlerin kaynağına gidilir (`kinds` içinde `bilanco` yoksa KAP'a, `tcmb` yoksa TCMB'ye, ikisi de temettü/sermaye yoksa İş Yatırım'a gidilmez); aynı sembol için eşzamanlı KAP çağrıları tek isteğe birleştirilir; geçersiz `from`/`to` ağ işinden önce reddedilir.
- **TCMB hatası:** hata sonrası 5 dakika yeniden denenmez (son başarılı kayıt `stale` ile kullanılır), zaman aşımı 10 sn, TCMB diğer kaynaklarla paralel çekilir.
- **Gün değişimi:** takvim sayfası her gösterildiğinde yeniden çizilir; açık bırakılan sayfa gece yarısından sonra eski "Bugün"/"Yarın" göstermez.
- KAP bir sembolde hata verirse (HTTP 500, hız sınırı) yalnız o sembolün bilanço olayları atlanır, `warnings`'e `{ source: 'kap', message: 'THYAO: …' }` eklenir; diğerleri döner. Hız sınırı sırasında sembol başına istekler sıralı (en çok 2 eşzamanlı) çalışır.
- TCMB ayrıştırması hata verirse son başarılı kayıt (`stale`), o da yoksa `warnings`. Sayfanın geri kalanı çalışır.
- `corporateActions` İş Yatırım çekilemezse mevcut davranış (bellekteki son veri) geçerli.
- Geçersiz `from`/`to`/`scope`/`kinds` → 400 ve Türkçe hata iletisi.

## Testler (`test/takvim.test.mjs`, çevrimdışı)
Saf `takvim.js` için; ağ, KAP ve TCMB'ye gitmez, `npm test` zincirine girer.
- **TCMB ayrıştırıcı:** gerçek tablonun kopyasıyla (`test/fixtures/tcmb-takvim.html`): olay sayıları ve tarihler; boş hücre atlanır; başlık sütunları değişirse hata; 8'den az geçerli karar tarihi hata; Türkçe ay adları (Şubat, Ağustos…); bozuk HTML hata.
- **Yasal son teslim:** dönem × solo/konsolide tablo değerleri; hafta sonu → pazartesi; yıl sonu taşması (4. dönem → Mart); bilinmeyen dönem hata.
- **Beklenen tarih:** geçen yıl tarihinin bir yıl ileri taşınması, 29 Şubat → 28 Şubat, hafta sonu → önceki iş günü, son teslimi geçmemesi.
- **Bilanço olayları:** açıklanmış dönem yalnız `bilanco_aciklandi` üretir (beklenen/son teslim yok); açıklanmamışsa ikisi birden; geçen yıl yoksa yalnız son teslim; konsolide bilinmiyorsa konsolide süre ve `assumed`; aynı gün üç FR kaydı tek açıklama sayılır; en erken tarih seçilir.
- **Temettü/sermaye olayları:** alan → tür eşlemesi, bir kayıttan birden çok olay, boş alanlar.
- **Birleştirme:** pencere sınırları (dahil/hariç), sıralama, tür süzgeci, kapsam süzgeci (TCMB her kapsamda), boş küme, `Tümü`'nde sembolsüz sezon olayı, 366 günden uzun pencere reddi.
- **Gün grubu (`groupKey`):** İstanbul saatiyle bugün/yarın/bu hafta/son günler; gece yarısı sınırı (UTC 21:30 = İstanbul ertesi gün).

### Canlı doğrulama (uygulama sırasında)
- THYAO ve 4 portföy hissesi için üretilen bilanço tarihlerini KAP kayıtlarıyla elle karşılaştır; **hiçbir gözlenen açıklama hesaplanan yasal son teslimi aşmamalı** (aşarsa gün sayıları yanlıştır ve düzeltilir).
- TCMB olaylarını sayfadaki tabloyla karşılaştır.
- Takvim sayfasını 1440, 900 ve 760 px'te ekran görüntüsüyle ve hem Türkçe hem İngilizce doğrula; konsol hatası olmamalı.

## Kapsam dışı
TÜFE/TÜİK günü (kaynak yok, yalnız tahmin), aylık ızgara, takvim hatırlatıcısı/bildirimi, .ics dışa aktarma, tüm piyasa için hisse bazlı bilanço tahmini, genel kurul/faiz kararı sonrası olaylar, saat bilgisi, sermaye artırımı için ayrı veri kaynağı.

## Bilinen sınırlar (belgelenecek)
- Bilanço tarihleri **tahmindir**: geçen yılın günü ve yasal süre; resmî tatiller hesaba katılmaz. Açıklanmış dönemler kesindir.
- TCMB tablosu sitenin HTML'ine bağlıdır; biçim değişirse sayfa uyarı gösterir, son başarılı kayıt kullanılır.
- Temettü "Tarih" sütununun hak kullanım mı ödeme mi olduğu kaynakta belirtilmemiştir.
- KAP şirket sorgusu 365 gün ile sınırlı olduğundan geçen yıl kaydı ancak son 365 günde varsa beklenen tarih üretilir.

## Başarı ölçütü
`#/pazar/takvim` Portföyüm, Listem ve Tümü için olayları gün gün, kesin/tahmini etiketli gösterir; TCMB günleri sitedeki tabloyla birebir aynıdır; bilanço tarihlerinde gözlenen hiçbir açıklama hesaplanan yasal son teslimi aşmaz; KAP ya da TCMB hatası sayfayı çökertmez, uyarı olarak görünür; `npm test` yeşil; 760 px'te taşma yok.

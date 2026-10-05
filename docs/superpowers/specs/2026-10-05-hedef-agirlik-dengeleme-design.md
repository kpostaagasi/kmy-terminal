# Hedef ağırlığa göre portföy dengeleme

Tarih: 2026-10-05 · Sürüm hedefi: 0.22.0

## Amaç
Portföy için hedef ağırlık girilir; terminal gerçek ağırlıkla farkı (sapma) gösterir ve "şunu al/sat" önerisini hesaplar. **Emir göndermez, yalnız hesaplar.** Başarı ölçütü: tek bakışta "hedefimden ne kadar saptım, ne yapmalıyım".

Bağlam: ticari ürünleşme hedefi; portföy takipçilerinde standart bir özellik. Kısıtlar: ad küçük harf (kmy terminal), rakip adı geçmez, kişisel veri (hedefler dahil) git'e ve DMG'ye girmez, depo gizli. Ağ kaynağı gerektirmez: mevcut portföy defteri (`summary()`) ve fiyat önbelleği kullanılır.

Kullanıcı onaylı kararlar: **hedef hem varlık sınıfı hem sembol düzeyinde** girilir; öneri **al/sat + isteğe bağlı ek nakit** üretir (varsayılan portföy değeri sabit; ek nakit girilirse yalnız alım).

## Doğrulanmış olgular
- `pf.summary()` her pozisyon için `symbol, asset_type, value, price, priced, currency, missingFx, qty, sellTax, sellNet, sellTaxable, sellTaxRate` döndürür; `holdings[].weight` toplam değer (nakit takibi açıksa nakit dahil) üzerinden yüzdedir. `totals.cash` nakit takibi açıksa TL değeri, değilse `null`; `totals.value` toplam, `totals.cashTracking` bayrak.
- `ASSET_TYPES`: stock, etf, fund, gold, commodity, fx, crypto, bond, other. Sembol meta kullanıcıya özeldir (`symbols` tablosu).
- Fiyat kaynağı `market.getQuotes(symbols)`; portföyde olmayan hedef sembolleri için de bu çağrı kullanılır.

## Hesap kuralları (saf çekirdek)
Tanımlar: `V` = `totals.value` (nakit takibi açıksa nakit dahil), `E` = ek nakit (≥ 0, varsayılan 0), `V' = V + E`.

- **Hedef girişi:** `classTargets: { asset_type | 'cash': pct }` (portföyün yüzdesi) ve `symbolTargets: { symbol: pct }` (**sınıf içindeki pay**, yüzde). Sınıf toplamı ≤ %100; her sınıfın sembol payları toplamı ≤ %100. `cash` anahtarı yalnız nakit takibi açıkken geçerlidir. Sınıf hedefi olmayan sınıflar "hedefsiz"dir: **dokunulmaz**, öneri üretilmez.
- **Etkin sembol hedefi:** `T_s = classPct × share / 100`. Sınıf içinde payı girilmeyen semboller, payı girilenlerin bıraktığı kalanı (100 − toplam pay) **mevcut değerleriyle orantılı** paylaşır (aralarında işlem önerilmez); hiçbirinin değeri yoksa eşit. Payı girilmiş ama portföyde olmayan sembol "yeni alım" satırıdır (fiyat `getQuotes`'tan).
- **Sapma:** `sapma_i = gerçek%_i − hedef%_i` (puan), gerçek% = `value_i / V × 100`. `|sapma| < 1 puan` ise "işlem gerekmez".
- **Mod 1 (E = 0): al/sat.** Her hedefli satır için `delta_i = T_i/100 × V − value_i` (TL); pozitif = al, negatif = sat. Net nakit değişimi `−Σ delta` ayrıca gösterilir (hedefsiz kova ve nakit karşılar). Nakit takibi açıksa ve net alım nakitten büyükse uyarı.
- **Mod 2 (E > 0): yalnız alım, satış yok.** Eksik kalan satırlar için `kısıt_i = max(0, T_i/100 × V' − value_i)`; `Σ kısıt > E` ise orantılı küçültülür (`× E / Σ kısıt`), `Σ kısıt < E` ise artan para nakit olarak kalır ve söylenir.
- **Adet:** `asset_type` hisse veya ETF ise adet tam sayı: alımda `⌊TL / fiyat⌋` (hedefi aşmaz), satışta `min(⌊TL / fiyat⌋, mevcut adet)`; diğerleri kesirli (4 basamak). Yuvarlama artığı (TL) satır ve toplam olarak gösterilir.
- **Vergi tahmini (satışta):** mevcut `sellTaxable` ve `sellTax` tam satış içindir; kısmi satışta **oransal** (`sellTax × satılan adet / adet`) ve "tahmini" etiketiyle gösterilir. Maliyet/komisyon modellenmez.
- **Atlama ve uyarılar (sahte öneri yok):** fiyatı olmayan ya da `missingFx` olan satır önerilmez ("atlandı: neden" satırı); hedef toplamı > %100, sınıf içi pay toplamı > %100, negatif/NaN değer girişte reddedilir (400); hedef toplamı < %100 uyarı değil bilgi ("kalan %X hedefsiz"); hedefli satırlardan biri atlanırsa net nakit değişimi "eksik" etiketlenir.

## Mimari
- **`server/dengeleme.js`** (yeni, **saf**): `validateTargets({ classTargets, symbolTargets, cashTracking }) → { ok, errors }`, `effectiveTargets(...)`, `plan({ holdings, totalValue, cash, cashTracking, prices, classTargets, symbolTargets, extra }) → { rows, summary, warnings }`. Veritabanı ve ağ içe aktarmaz.
- **`server/dengeleme-kaynak.js`** (yeni): `rebalance_targets` tablosu (`kind TEXT CHECK(kind IN ('class','symbol')), key TEXT, pct REAL, PRIMARY KEY(kind,key)`), `getTargets()`, `setTargets(t)` (doğrula, tek işlemde değiştir), `compute({ extra })` (`pf.summary()`, eksik semboller için `getQuotes`, `plan`).
- **`server/index.js`:** `GET /api/rebalance/targets`, `PUT /api/rebalance/targets` (gövde `{classTargets, symbolTargets}`; geçersizse 400 ve hata listesi; başarıda `rebalance.updated` yayını), `GET /api/rebalance?extra=<TL>`.
- **`web/js/rebalance-view.js`** (yeni) ve portföy sayfasında "Dengeleme" paneli: hedef düzenleme (sınıf yüzdeleri, sınıf içi sembol payları, toplam göstergesi, kaydet), sapma tablosu (sembol, sınıf, gerçek %, hedef %, sapma, öneri TL ve adet, tahmini vergi), özet (net nakit değişimi, yuvarlama artığı, uyarılar), **ek nakit alanı** (boş = al/sat modu). Anlıktır; elle hesap düğmesi yok.
- **`web/js/lang/en/portfolio.js`, `web/terminal.css`:** İngilizce metinler ve taşma kuralı.
- **`test/dengeleme.test.mjs`** (yeni, çevrimdışı), `npm test` zincirine eklenir.

### Sonuç biçimi
```
rows: [{ key: 'THYAO'|'cash'|class, kind: 'symbol'|'class', class, currentPct, targetPct, deviation,
         action: 'al'|'sat'|'yok'|'atlandi', tl, qty, price, taxEst, reason }]
summary: { mode: 'sabit'|'ekNakit', value, extra, netCash, rounding, targetSum, unassignedPct }
warnings: [string]
```

## Test (çevrimdışı)
Sınıf ve sembol dağılımı (etkin hedef = sınıf × pay); payı olmayan sembollerin kalanı orantılı paylaşması; sapma ve 1 puan eşiği; mod 1 net nakit; mod 2 yalnız alım, `Σ kısıt` ≷ `E` kolları; tam sayı adet ve yuvarlama artığı, satışta mevcut adedi aşmama; oransal vergi; fiyatsız/`missingFx` atlama; yeni sembol alımı; doğrulama hataları (toplam > 100, negatif, `cash` anahtarı nakit takibi kapalıyken); hedefsiz sınıfa dokunulmaması; boş hedef çökmez; `validateTargets` ve `PUT` hata yolu. Elle doğrulama: tarayıcıda 1440/900/760 px, TR/EN, kayıttan sonra yenileme, çift pencerede `rebalance.updated`.

## Sınırlar ve kapsam dışı
Emir gönderme, otomatik dengeleme, platform bazlı hedef, komisyon ve işlem maliyeti modeli, vergi optimizasyonu (hangi lotun satılacağı), ajan aracı (istenirse sonra). Öneri bir hesaptır, yatırım tavsiyesi değildir; panelde yazılır. Fiyatlar BIST için ~15 dk gecikmeli olabilir ve panelde fiyat kaynağı/zamanı gösterilir.

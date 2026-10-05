# Hedef ağırlığa göre dengeleme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portföy sayfasına "Dengeleme" sekmesi eklemek: sınıf ve sembol düzeyinde hedef ağırlık girilir, sapma ve al/sat önerisi (isteğe bağlı ek nakitle yalnız alım) hesaplanır; emir gönderilmez; sürüm 0.22.0.

**Architecture:** Saf hesap çekirdeği `server/dengeleme.js` (veritabanı ve ağ yok); hedef kalıcılığı ve portföy/fiyat toplama `server/dengeleme-kaynak.js`; üç rota; arayüz `web/js/rebalance-view.js` portföy sayfasının yeni sekmesi. Ağ kaynağı eklenmez: mevcut `pf.summary()` ve `getQuotes` kullanılır.

**Tech Stack:** Node 22.13+ ESM, `node:sqlite`, vanilla JS UI. Yeni bağımlılık yok.

**Spec:** `docs/superpowers/specs/2026-10-05-hedef-agirlik-dengeleme-design.md` (yürütücü önce onu okur). Plan'ın spec'ten bir sapması: `symbolTargets` değeri `{ cls, pct }` nesnesidir (yalnız yüzde değil); portföyde olmayan sembolün sınıfı tahmin edilemediği ve varlık türü sonradan değişebildiği için sınıf hedefle birlikte saklanır. Tablo `rebalance_targets(kind, key, pct, cls)`. Task 4 spec'i buna göre düzeltir.

## Global Constraints

- Ad her yerde küçük harf: "kmy terminal". Rakip ürün adı geçmez. Kişisel veri (hedefler dahil) git'e ve DMG'ye girmez; depo gizli kalır.
- Node ≥ 22.13, bağımlılık eklenmez. Testler çevrimdışı, `npm test` zincirine eklenir. Emir gönderilmez; panel "bu bir hesaptır, yatırım tavsiyesi değildir" notunu taşır.
- Sınıf hedefi toplamı ≤ %100; her sınıfın sembol payları toplamı ≤ %100; değerler 0–100 arası sonlu sayı; `cash` hedefi yalnız nakit takibi açıkken. Geçersiz giriş 400 ile reddedilir ve önceki kayıt bozulmaz (kayıt bütün olarak değişir).
- Sınıf hedefi olmayan sınıflara dokunulmaz (öneri yok). Sınıf içinde payı girilmeyen semboller kalan payı mevcut değerleriyle orantılı paylaşır (eşit değer/sıfırsa eşit).
- E = 0: al/sat, `delta = hedef% × V − değer`, |sapma| < 1 puan ise işlem yok. E > 0: yalnız alım, `kısıt = max(0, hedef% × (V+E) − değer)`; Σ kısıt > E ise orantılı küçült; artan para dağıtılmaz ve söylenir.
- Adet: hisse ve ETF tam sayı (alımda aşağı yuvarla, satışta mevcut adedi aşma), diğerleri 4 basamak. Yuvarlama artığı raporlanır. Satışta tahmini vergi `sellTax × satılan/mevcut` (yalnız `sellTaxable`). Komisyon modellenmez.
- Fiyatı olmayan, `missingFx` olan ya da değeri `null` olan satır `atlandi` olur (sahte öneri yok) ve net nakit "eksik" uyarısı verilir.
- API: `GET /api/rebalance/targets`, `PUT /api/rebalance/targets` (başarıda `rebalance.updated` yayını), `GET /api/rebalance?extra=<TL>`.

## Review Focus

1. **Para tutarlılığı:** E = 0 iken satış ve alım toplamları ve net nakit değişimi (vergi düşülmüş) doğru; yuvarlama artığı işaret ve toplam olarak tutarlı. Test: Task 1 (`netCash`, `rounding`, vergi).
2. **Etkin hedef:** sınıf × pay, payı olmayan sembollerin orantılı paylaşımı, dağıtılmayan pay uyarısı, hedefsiz sınıfa dokunulmaması. Test: Task 1.
3. **Ek nakit modu:** satış yok, Σ kısıt ≷ E kolları, artan paranın dağıtılmaması. Test: Task 1.
4. **Doğrulama ve kalıcılık:** toplam > 100, negatif, NaN, `cash` takip kapalıyken; geçersiz PUT önceki hedefi bozmaz. Test: Task 1 (`validateTargets`) ve Task 2 (`dengeleme-kaynak.check.mjs`).
5. **Dürüst durumlar:** fiyatsız/kursuz satır atlanır, hedef yokken boş durum, hata iletisi arayüzde takılı kalmaz, İngilizce çeviri eksik kalmaz. Test: Task 1 ve tarayıcı doğrulaması (Task 3).

---

## File Structure

| Dosya | Sorumluluk |
|---|---|
| `server/dengeleme.js` (yeni) | `validateTargets`, `plan` — saf |
| `server/dengeleme-kaynak.js` (yeni) | `rebalance_targets` tablosu, `getTargets`, `setTargets`, `saveTargets`, `compute` |
| `server/index.js` (değişir) | üç rota |
| `web/js/rebalance-view.js` (yeni) | sekme gövdesi |
| `web/js/portfolio-view.js` (değişir) | `Dengeleme` sekmesi |
| `web/js/lang/en/portfolio.js`, `web/js/lang/en/server.js`, `web/terminal.css` (değişir) | çeviriler, stil |
| `test/dengeleme.test.mjs`, `test/dengeleme-kaynak.check.mjs` (yeni) | testler |
| `package.json`, `README.md`, `CHANGELOG.md`, spec (değişir) | sürüm 0.22.0, belgeler |

Plan boyunca dal: `git switch -c feat/dengeleme`. Komutlar depo kökünden çalışır.

---

### Task 1: Saf hesap çekirdeği ve testleri

**Files:**
- Create: `server/dengeleme.js`, `test/dengeleme.test.mjs`
- Modify: `package.json` (`test` zinciri)

**Interfaces:**
- Produces: `CLASS_KEYS`; `validateTargets({classTargets, symbolTargets, cashTracking}) → {ok, errors}`; `plan({holdings, totalValue, cash, cashTracking, fresh, classTargets, symbolTargets, extra}) → {rows, summary, warnings}` (geçersiz girişte hata fırlatır). Satır: `{key, kind:'symbol'|'class', class, currentPct, targetPct, deviation, action:'al'|'sat'|'yok'|'atlandi', tl, qty, price, taxEst, reason}`; özet: `{mode:'sabit'|'ekNakit', value, extra, netCash, rounding, targetSum, unassignedPct}`.
- Consumes: yok (saf).

- [ ] **Step 1: Dalı aç, testi yaz (başarısız görmek için önce test)**

```bash
git switch -c feat/dengeleme
```

Dosya `test/dengeleme.test.mjs`:

```js
// Dengeleme: hedef doğrulama, etkin hedef, sapma, al/sat, ek nakit, adet yuvarlama, vergi, atlama. Çevrimdışı, saf.
import { plan, validateTargets } from '../server/dengeleme.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') { cond ? pass++ : fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); }
const near = (a, b, t = 0.01) => a != null && Math.abs(a - b) <= t;
const H = (symbol, asset_type, value, price, qty, extra = {}) => ({ symbol, asset_type, value, price, qty, missingFx: false, sellTax: 0, sellTaxable: false, ...extra });
const row = (r, k) => r.rows.find((x) => x.key === k);

// ── Doğrulama ─────────────────────────────────────────────────────────────
assert('geçerli hedef kabul edilir', validateTargets({ classTargets: { stock: 60, gold: 40 }, symbolTargets: { THYAO: { cls: 'stock', pct: 50 } } }).ok);
assert('sınıf toplamı > 100 reddedilir', !validateTargets({ classTargets: { stock: 70, gold: 40 } }).ok);
assert('tam 100 kabul edilir', validateTargets({ classTargets: { stock: 70, gold: 30 } }).ok);
assert('negatif ve NaN reddedilir', !validateTargets({ classTargets: { stock: -1 } }).ok && !validateTargets({ classTargets: { stock: NaN } }).ok && !validateTargets({ classTargets: { stock: '10' } }).ok);
assert('bilinmeyen sınıf reddedilir', !validateTargets({ classTargets: { kedi: 10 } }).ok);
assert('cash hedefi nakit takibi kapalıyken reddedilir, açıkken kabul', !validateTargets({ classTargets: { cash: 10 } }).ok && validateTargets({ classTargets: { cash: 10 }, cashTracking: true }).ok);
assert('sınıf içi paylar toplamı > 100 reddedilir', !validateTargets({ classTargets: { stock: 50 }, symbolTargets: { A: { cls: 'stock', pct: 60 }, B: { cls: 'stock', pct: 50 } } }).ok);
assert('sembolün sınıfı yoksa ya da cash ise reddedilir', !validateTargets({ symbolTargets: { A: { pct: 10 } } }).ok && !validateTargets({ symbolTargets: { A: { cls: 'cash', pct: 10 } } }).ok);
assert('boş girdi geçerli', validateTargets({}).ok && validateTargets().ok);

// ── Mod 1: al/sat, portföy değeri sabit ───────────────────────────────────
// V = 100000: THYAO 60000 @100 (600 adet), AKBNK 20000 @50 (400), ALTIN 20000 @2000 (10). Hedef: hisse 50 (THYAO 60 / AKBNK 40 pay), altın 50.
const hold = [H('THYAO', 'stock', 60000, 100, 600), H('AKBNK', 'stock', 20000, 50, 400), H('GRAM', 'gold', 20000, 2000, 10)];
const base = { holdings: hold, totalValue: 100000, classTargets: { stock: 50, gold: 50 }, symbolTargets: { THYAO: { cls: 'stock', pct: 60 }, AKBNK: { cls: 'stock', pct: 40 } } };
const p1 = plan(base);
assert('etkin hedef = sınıf × pay (THYAO %30, AKBNK %20, altın %50)', near(row(p1, 'THYAO').targetPct, 30) && near(row(p1, 'AKBNK').targetPct, 20) && near(row(p1, 'GRAM').targetPct, 50));
assert('sapma = gerçek − hedef (THYAO +30 puan)', near(row(p1, 'THYAO').deviation, 30));
assert('THYAO sat: hedef 30000, mevcut 60000 → 30000 TL = 300 adet', row(p1, 'THYAO').action === 'sat' && row(p1, 'THYAO').qty === 300 && near(row(p1, 'THYAO').tl, 30000));
assert('AKBNK hedefinde: işlem yok', row(p1, 'AKBNK').action === 'yok');
assert('altın al: 30000 TL = 15 adet (kesirli tür)', row(p1, 'GRAM').action === 'al' && near(row(p1, 'GRAM').qty, 15) && near(row(p1, 'GRAM').tl, 30000));
assert('net nakit değişimi 0 (sat 30000 = al 30000), mod sabit', p1.summary.mode === 'sabit' && near(p1.summary.netCash, 0));
assert('hedef toplamı 100, hedefsiz 0', p1.summary.targetSum === 100 && p1.summary.unassignedPct === 0);

// Payı girilmeyen semboller kalanı değerleriyle orantılı paylaşır (aralarında işlem yok)
const p2 = plan({ holdings: [H('A', 'stock', 30000, 10, 3000), H('B', 'stock', 10000, 10, 1000), H('C', 'stock', 10000, 10, 1000), H('GRAM', 'gold', 50000, 100, 500)], totalValue: 100000, classTargets: { stock: 50, gold: 50 }, symbolTargets: { A: { cls: 'stock', pct: 50 } } });
assert('payı olmayan B ve C kalan %50 payı değerle orantılı paylaşır (B %12,5, C %12,5)', near(row(p2, 'B').targetPct, 12.5) && near(row(p2, 'C').targetPct, 12.5) && near(row(p2, 'A').targetPct, 25));
assert('eşit değerli B ve C için eşit öneri', row(p2, 'B').action === row(p2, 'C').action);

// Eşik: 1 puandan küçük sapma için işlem yok
const p3 = plan({ holdings: [H('A', 'stock', 50500, 10, 5050), H('GRAM', 'gold', 49500, 100, 495)], totalValue: 100000, classTargets: { stock: 50, gold: 50 }, symbolTargets: { A: { cls: 'stock', pct: 100 } } });
assert('0,5 puanlık sapma: işlem gerekmez', row(p3, 'A').action === 'yok' && row(p3, 'GRAM').action === 'yok' && /gerekmez/.test(row(p3, 'A').reason));

// ── Tam sayı adet ve yuvarlama ────────────────────────────────────────────
const p4 = plan({ holdings: [H('X', 'stock', 10000, 33, 303.03), H('GRAM', 'gold', 90000, 100, 900)], totalValue: 100000, classTargets: { stock: 30, gold: 70 }, symbolTargets: { X: { cls: 'stock', pct: 100 } } });
// X hedef 30000: al 20000 TL / 33 = 606,06 → 606 adet = 19998 TL
assert('hisse alımı tam sayıya aşağı yuvarlanır (606 adet, 19998 TL)', row(p4, 'X').qty === 606 && near(row(p4, 'X').tl, 19998));
assert('yuvarlama artığı raporlanır (≈ 2 TL)', near(p4.summary.rounding, 2, 0.02), String(p4.summary.rounding));
// Satışta mevcut adedi aşma
const p5 = plan({ holdings: [H('X', 'stock', 100000, 100, 1000)], totalValue: 100000, classTargets: { stock: 0 }, symbolTargets: {} });
assert('tüm sınıfı sıfıra: satılacak adet mevcut adedi aşmaz (1000)', row(p5, 'X').qty === 1000);

// ── Vergi tahmini (kısmi satış oransal) ───────────────────────────────────
const p6 = plan({ holdings: [H('T', 'stock', 100000, 100, 1000, { sellTax: 1000, sellTaxable: true })], totalValue: 100000, classTargets: { stock: 50 }, symbolTargets: {} });
assert('yarısını satınca vergi tahmini yarısı (500 TL)', row(p6, 'T').action === 'sat' && row(p6, 'T').qty === 500 && near(row(p6, 'T').taxEst, 500));
assert('net nakit = satış − vergi (49500)', near(p6.summary.netCash, 49500));
const p6b = plan({ holdings: [H('T', 'stock', 100000, 100, 1000, { sellTax: 1000, sellTaxable: false })], totalValue: 100000, classTargets: { stock: 50 }, symbolTargets: {} });
assert('vergiye tabi değilse vergi 0', row(p6b, 'T').taxEst === 0);

// ── Mod 2: ek nakit, yalnız alım ──────────────────────────────────────────
// V=100000 A 70000 @10, B 30000 @10; hedef A %50 B %50; E = 20000 → V' = 120000; B kısıt = 60000 − 30000 = 30000 > E → ölçek: B 20000. A satılmaz.
const m2 = plan({ holdings: [H('A', 'stock', 70000, 10, 7000), H('B', 'stock', 30000, 10, 3000)], totalValue: 100000, classTargets: { stock: 100 }, symbolTargets: { A: { cls: 'stock', pct: 50 }, B: { cls: 'stock', pct: 50 } }, extra: 20000 });
assert('ek nakit modu: satış yok', m2.rows.every((r) => r.action !== 'sat') && row(m2, 'A').action === 'yok');
assert('ek nakit tamamı geride kalana (B 20000 TL = 2000 adet)', row(m2, 'B').action === 'al' && row(m2, 'B').qty === 2000 && m2.summary.mode === 'ekNakit');
assert('net nakit değişimi = −ek nakit kullanımı', near(m2.summary.netCash, -20000));
// E büyükse artan dağıtılmaz
const m3 = plan({ holdings: [H('A', 'stock', 50000, 10, 5000), H('B', 'stock', 50000, 10, 5000)], totalValue: 100000, classTargets: { stock: 50 }, symbolTargets: { A: { cls: 'stock', pct: 50 }, B: { cls: 'stock', pct: 50 } }, extra: 10000 });
assert('eksik yoksa ek nakit dağıtılmaz ve söylenir', m3.rows.every((r) => r.action === 'yok') && m3.warnings.some((w) => /dağıtılmadı/.test(w)));
// V' hedefi: E sabit hedef yüzdelerine göre bölünür (iki eksik satır, orantılı ölçek)
const m4 = plan({ holdings: [H('A', 'stock', 40000, 10, 4000), H('B', 'stock', 40000, 10, 4000), H('C', 'stock', 20000, 10, 2000)], totalValue: 100000, classTargets: { stock: 100 }, symbolTargets: { A: { cls: 'stock', pct: 40 }, B: { cls: 'stock', pct: 40 }, C: { cls: 'stock', pct: 20 } }, extra: 100000 });
// V' = 200000: A,B hedef 80000 → eksik 40000 her biri; C 40000 → eksik 20000; toplam 100000 = E → tam
assert('toplam eksik = ek nakit: herkes hedefe ulaşır (A 40000, B 40000, C 20000)', near(row(m4, 'A').tl, 40000) && near(row(m4, 'B').tl, 40000) && near(row(m4, 'C').tl, 20000));

// ── Yeni sembol, atlama, hedefsiz sınıf ───────────────────────────────────
const n1 = plan({ holdings: [H('A', 'stock', 100000, 10, 10000)], totalValue: 100000, fresh: { NEW: { price: 50 } }, classTargets: { stock: 100 }, symbolTargets: { A: { cls: 'stock', pct: 80 }, NEW: { cls: 'stock', pct: 20 } } });
assert('portföyde olmayan sembol yeni alım satırı (20000 TL = 400 adet)', row(n1, 'NEW').action === 'al' && row(n1, 'NEW').qty === 400);
assert('A satılır (hedef 80000): 20000 TL = 2000 adet', row(n1, 'A').action === 'sat' && row(n1, 'A').qty === 2000);
const n2 = plan({ holdings: [H('A', 'stock', 100000, 10, 10000)], totalValue: 100000, fresh: {}, classTargets: { stock: 100 }, symbolTargets: { A: { cls: 'stock', pct: 80 }, NEW: { cls: 'stock', pct: 20 } } });
assert('fiyatı olmayan yeni sembol atlanır ve net nakit eksik uyarısı', row(n2, 'NEW').action === 'atlandi' && n2.warnings.some((w) => /atlandı/.test(w)));
const n3 = plan({ holdings: [H('A', 'stock', 50000, 10, 5000, { missingFx: true }), H('GRAM', 'gold', 50000, 100, 500)], totalValue: 100000, classTargets: { stock: 50, gold: 50 }, symbolTargets: {} });
assert('kuru bulunamayan varlık atlanır (sahte öneri yok)', row(n3, 'A').action === 'atlandi' && /Kur/.test(row(n3, 'A').reason));
const n4 = plan({ holdings: [H('A', 'stock', 50000, 10, 5000), H('GRAM', 'gold', 50000, 100, 500)], totalValue: 100000, classTargets: { stock: 100 }, symbolTargets: {} });
assert('hedefsiz sınıfa (altın) dokunulmaz, satırı yok', !row(n4, 'GRAM'));
const n5 = plan({ holdings: [H('A', 'stock', 100000, 10, 10000)], totalValue: 100000, classTargets: { gold: 20 }, symbolTargets: {} });
assert('üyesiz sınıf için "sembol payı girin" satırı', row(n5, 'gold')?.action === 'atlandi' && /sembol/.test(row(n5, 'gold').reason));
const n6 = plan({ holdings: [H('A', 'stock', 100000, 10, 10000)], totalValue: 100000, classTargets: { stock: 100 }, symbolTargets: { Z: { cls: 'gold', pct: 10 } } });
assert('hedefsiz sınıftaki sembol payı yok sayılır ve söylenir', n6.warnings.some((w) => /yok sayıldı/.test(w)));
const n7 = plan({ holdings: [H('A', 'stock', 100000, 10, 10000)], totalValue: 100000, classTargets: { stock: 100 }, symbolTargets: { A: { cls: 'stock', pct: 60 } }, extra: 0 });
assert('payların kalanı dağıtılamıyorsa uyarı (A %60, kalan %40 hedefsiz)', n7.warnings.some((w) => /dağıtılmadı/.test(w)));

// ── Nakit ve kenar durumlar ───────────────────────────────────────────────
const c1 = plan({ holdings: [H('A', 'stock', 80000, 10, 8000)], totalValue: 100000, cash: 20000, cashTracking: true, classTargets: { stock: 70, cash: 30 }, symbolTargets: {} });
assert('nakit satırı bilgi amaçlı (gerçek %20, hedef %30)', row(c1, 'cash').action === 'yok' && near(row(c1, 'cash').currentPct, 20) && near(row(c1, 'cash').targetPct, 30));
assert('hisse satışı önerilir (hedef 70000: 10000 TL)', row(c1, 'A').action === 'sat' && near(row(c1, 'A').tl, 10000));
const c3 = plan({ holdings: [H('A', 'stock', 100000, 10, 10000)], totalValue: 100000, cash: 0, cashTracking: true, classTargets: { stock: 50, gold: 50 }, symbolTargets: { GR: { cls: 'gold', pct: 100 } }, fresh: { GR: { price: 100 } } });
assert('nakit yetmeyen alım: satıştan gelen para karşılar, uyarı yok', !c3.warnings.some((w) => /nakitten büyük/.test(w)));
const c4 = plan({ holdings: [H('A', 'stock', 50000, 10, 5000)], totalValue: 100000, cash: 50000, cashTracking: true, classTargets: { stock: 100 }, symbolTargets: {} });
assert('net alım mevcut nakitten büyükse uyarı (nakit 50000 yeter)', !c4.warnings.some((w) => /nakitten büyük/.test(w)));
const c5 = plan({ holdings: [H('A', 'stock', 50000, 10, 5000)], totalValue: 100000, cash: 10000, cashTracking: true, classTargets: { stock: 100 }, symbolTargets: {} });
assert('net alım 50000 > nakit 10000 → uyarı', c5.warnings.some((w) => /nakitten büyük/.test(w)));
assert('portföy değeri 0: boş satırlar ve uyarı, çökme yok', (() => { const r = plan({ holdings: [], totalValue: 0, classTargets: { stock: 50 } }); return r.rows.length === 0 && r.warnings.length === 1; })());
assert('boş hedef: satır yok, çökme yok', plan({ holdings: hold, totalValue: 100000 }).rows.length === 0);
assert('ek nakit negatif/NaN reddedilir', (() => { try { plan({ holdings: hold, totalValue: 1, extra: -1 }); return false; } catch { return true; } })() && (() => { try { plan({ holdings: hold, totalValue: 1, extra: NaN }); return false; } catch { return true; } })());
assert('geçersiz hedef plan() içinde de reddedilir', (() => { try { plan({ holdings: hold, totalValue: 1, classTargets: { stock: 150 } }); return false; } catch { return true; } })());
assert('değeri null olan pozisyon atlanır', plan({ holdings: [H('A', 'stock', null, null, 10)], totalValue: 100, classTargets: { stock: 100 }, symbolTargets: {} }).rows[0].action === 'atlandi');
assert('tutar bir adetten azsa işlem yok ve neden yazar', (() => { const r = plan({ holdings: [H('A', 'stock', 99.9, 1000, 0.1), H('GRAM', 'gold', 99900.1, 100, 999)], totalValue: 100000, classTargets: { stock: 1, gold: 99 }, symbolTargets: {} }); const a = row(r, 'A'); return a.action === 'yok' && /adetten az|gerekmez/.test(a.reason); })());

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
```

Çalıştır: `node test/dengeleme.test.mjs`. Beklenen: FAIL (`../server/dengeleme.js` yok).

- [ ] **Step 2: `server/dengeleme.js`**

```js
// Hedef ağırlığa göre dengeleme: saf hesap (veritabanı ve ağ yok). Emir göndermez, yalnız öneri hesaplar.
// Girdi hedefleri: classTargets { asset_type | 'cash': yüzde (portföyün)}, symbolTargets { SEMBOL: { cls, pct } } (pct = sınıf içindeki pay, yüzde).

export const CLASS_KEYS = ['stock', 'etf', 'fund', 'gold', 'commodity', 'fx', 'crypto', 'bond', 'other', 'cash'];
const INTEGER_TYPES = new Set(['stock', 'etf']); // BIST hisse/ETF tam adet; diğerleri kesirli
const EPS = 1e-9;
const THRESHOLD = 1; // puan: altındaki sapma için işlem önerilmez (E = 0 modunda)
const isPct = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r2 = (x) => Math.round(x * 100) / 100;

/** Hedef girişini doğrular. Döner: { ok, errors: string[] } */
export function validateTargets({ classTargets = {}, symbolTargets = {}, cashTracking = false } = {}) {
  const errors = [];
  let sum = 0;
  for (const [k, v] of Object.entries(classTargets)) {
    if (!CLASS_KEYS.includes(k)) errors.push(`Bilinmeyen sınıf: ${k}`);
    else if (k === 'cash' && !cashTracking) errors.push('Nakit hedefi için nakit takibi açık olmalı (önce bir nakit girişi kaydedin)');
    if (!isPct(v)) errors.push(`${k}: hedef 0–100 arasında bir sayı olmalı`); else sum += v;
  }
  if (sum > 100 + EPS) errors.push(`Sınıf hedefleri toplamı %100'ü aşamaz (şu an %${r2(sum)})`);
  const perClass = {};
  for (const [s, e] of Object.entries(symbolTargets)) {
    if (!e || typeof e !== 'object' || !CLASS_KEYS.includes(e.cls) || e.cls === 'cash') { errors.push(`${s}: geçerli bir sınıf gerekli`); continue; }
    if (!isPct(e.pct)) { errors.push(`${s}: pay 0–100 arasında bir sayı olmalı`); continue; }
    perClass[e.cls] = (perClass[e.cls] || 0) + e.pct;
  }
  for (const [c, v] of Object.entries(perClass)) if (v > 100 + EPS) errors.push(`${c}: sembol payları toplamı %100'ü aşamaz (şu an %${r2(v)})`);
  return { ok: errors.length === 0, errors };
}

/**
 * Dengeleme planı.
 *  holdings: [{ symbol, asset_type, value, price, qty, missingFx, sellTax, sellTaxable }]
 *  totalValue: portföy toplamı (nakit takibi açıksa nakit dahil), cash: nakit TL (takip kapalıysa null)
 *  fresh: { SEMBOL: { price } } portföyde olmayan hedef sembollerinin fiyatı
 *  extra: ek nakit (TL, ≥ 0). 0 → al/sat; > 0 → yalnız alım
 * Döner: { rows, summary, warnings }
 */
export function plan({ holdings = [], totalValue, cash = null, cashTracking = false, fresh = {}, classTargets = {}, symbolTargets = {}, extra = 0 } = {}) {
  const warnings = [];
  const v = validateTargets({ classTargets, symbolTargets, cashTracking });
  if (!v.ok) throw new Error(v.errors.join('; '));
  if (!(Number.isFinite(extra) && extra >= 0)) throw new Error('Ek nakit 0 veya pozitif olmalı');
  const V = Number(totalValue);
  const mode = extra > 0 ? 'ekNakit' : 'sabit';
  const targetSum = Object.values(classTargets).reduce((a, b) => a + b, 0);
  const summary = { mode, value: V, extra, netCash: 0, rounding: 0, targetSum: r2(targetSum), unassignedPct: r2(100 - targetSum) };
  const rows = [];
  if (!(V > 0)) { warnings.push('Portföy değeri sıfır; öneri üretilemez'); return { rows, summary, warnings }; }
  const Vp = V + extra;
  const held = new Map(holdings.map((h) => [h.symbol, h]));

  // Etkin sembol hedefleri (portföyün yüzdesi)
  const items = []; // { symbol, cls, held, targetPct }
  for (const [cls, ct] of Object.entries(classTargets)) {
    if (cls === 'cash') continue;
    const members = holdings.filter((h) => h.asset_type === cls).map((h) => ({ symbol: h.symbol, share: symbolTargets[h.symbol]?.cls === cls ? symbolTargets[h.symbol].pct : null, value: h.value || 0, held: true }));
    for (const [s, e] of Object.entries(symbolTargets)) if (e.cls === cls && !held.has(s)) members.push({ symbol: s, share: e.pct, value: 0, held: false });
    const exp = members.filter((m) => m.share != null);
    const unt = members.filter((m) => m.share == null);
    const R = 100 - exp.reduce((a, m) => a + m.share, 0);
    if (!members.length) { rows.push({ key: cls, kind: 'class', class: cls, currentPct: 0, targetPct: ct, deviation: -ct, action: 'atlandi', tl: 0, qty: null, price: null, taxEst: 0, reason: 'Sınıfta sembol yok; sembol payı girin' }); continue; }
    if (unt.length) {
      const sv = unt.reduce((a, m) => a + m.value, 0);
      for (const m of unt) m.share = R * (sv > 0 ? m.value / sv : 1 / unt.length);
    } else if (R > EPS) warnings.push(`${cls}: sınıf içinde %${r2(R)} pay dağıtılmadı (hedefsiz bırakıldı)`);
    for (const m of members) items.push({ symbol: m.symbol, cls, held: m.held, targetPct: (ct * m.share) / 100 });
  }
  for (const [s, e] of Object.entries(symbolTargets)) if (!(e.cls in classTargets)) warnings.push(`${s}: ${e.cls} sınıfı hedefsiz olduğundan sembol payı yok sayıldı`);

  const lines = []; // hesaplanabilir satırlar
  for (const it of items) {
    const h = held.get(it.symbol);
    const price = h ? h.price : fresh[it.symbol]?.price;
    const value = h ? h.value : 0;
    const base = { key: it.symbol, kind: 'symbol', class: it.cls, targetPct: r4(it.targetPct), price: price ?? null, qty: null, tl: 0, taxEst: 0 };
    if (value == null || h?.missingFx || !(price > 0)) { rows.push({ ...base, currentPct: value == null ? null : r4((value / V) * 100), deviation: null, action: 'atlandi', reason: h?.missingFx ? 'Kur bulunamadı' : 'Fiyat yok' }); continue; }
    const currentPct = (value / V) * 100;
    lines.push({ ...base, h, price, value, currentPct: r4(currentPct), deviation: r4(currentPct - it.targetPct), delta: (it.targetPct / 100) * V - value });
  }

  // Hedef TL (işaretli): al > 0, sat < 0
  let want = new Map();
  if (mode === 'sabit') {
    for (const l of lines) want.set(l.key, Math.abs(l.deviation) < THRESHOLD ? 0 : l.delta);
  } else {
    const short = lines.map((l) => [l.key, Math.max(0, (l.targetPct / 100) * Vp - l.value)]);
    const S = short.reduce((a, [, x]) => a + x, 0);
    const k = S > extra ? extra / S : 1;
    for (const [key, x] of short) want.set(key, x * k);
    const alloc = short.reduce((a, [, x]) => a + x * k, 0);
    if (extra - alloc > 0.005) warnings.push(`Ek nakitten ${r2(extra - alloc)} TL dağıtılmadı; nakit olarak kalır`);
  }

  let buys = 0, sellsNet = 0, planned = 0, effective = 0;
  for (const l of lines) {
    const w = want.get(l.key) || 0;
    const out = { key: l.key, kind: 'symbol', class: l.class, currentPct: l.currentPct, targetPct: l.targetPct, deviation: l.deviation, price: l.price, qty: null, tl: 0, taxEst: 0, action: 'yok', reason: null };
    if (Math.abs(w) < 0.005) { out.reason = mode === 'sabit' ? 'İşlem gerekmez' : (w === 0 && l.deviation > 0 ? 'Satış önerilmez (ek nakit modu)' : 'İşlem gerekmez'); rows.push(out); continue; }
    const int = INTEGER_TYPES.has(l.class);
    let qty = Math.abs(w) / l.price;
    if (w < 0) qty = Math.min(qty, l.h.qty);
    qty = int ? Math.floor(qty + EPS) : r4(qty);
    planned += Math.abs(w);
    if (!(qty > 0)) { out.reason = 'Tutar bir adetten az'; rows.push(out); continue; }
    const tl = r2(qty * l.price);
    effective += tl;
    out.qty = qty; out.tl = tl;
    if (w > 0) { out.action = 'al'; buys += tl; }
    else {
      out.action = 'sat';
      out.taxEst = l.h.sellTaxable && l.h.qty > 0 && l.h.sellTax > 0 ? r2((l.h.sellTax * qty) / l.h.qty) : 0;
      sellsNet += tl - out.taxEst;
    }
    rows.push(out);
  }

  const skipped = rows.filter((r) => r.action === 'atlandi').length;
  summary.netCash = r2(sellsNet - buys);
  summary.rounding = r2(Math.max(0, planned - effective));
  if (skipped) warnings.push(`${skipped} satır atlandı; net nakit değişimi eksik`);
  if (mode === 'sabit' && cashTracking && cash != null && summary.netCash < -cash - 0.005) warnings.push('Net alım mevcut nakitten büyük; nakit yetmeyebilir');
  if (cashTracking && 'cash' in classTargets) {
    const cp = ((cash ?? 0) / V) * 100;
    rows.push({ key: 'cash', kind: 'class', class: 'cash', currentPct: r4(cp), targetPct: classTargets.cash, deviation: r4(cp - classTargets.cash), action: 'yok', tl: 0, qty: null, price: null, taxEst: 0, reason: 'Nakit sınıfı yalnız bilgi' });
  }
  return { rows, summary, warnings };
}
```

Çalıştır: `node test/dengeleme.test.mjs`. Beklenen: `49 geçti, 0 başarısız`.

- [ ] **Step 3: `npm test` zincirine ekle ve tümünü çalıştır**

`package.json` `test` değerinin sonuna (şu an `... node test/backtest.test.mjs && BORSA_DATA_DIR=$(mktemp -d) node test/backtest-run.check.mjs` ile biter) ` && node test/dengeleme.test.mjs` ekle.

Çalıştır: `npm test 2>&1 | grep -E "başarısız|FAIL"`. Beklenen: hiç `FAIL` yok; son takım `49 geçti, 0 başarısız`.

- [ ] **Step 4: Commit**

```bash
git add server/dengeleme.js test/dengeleme.test.mjs package.json
git commit -m "Dengeleme: saf hesap çekirdeği ve testleri"
```

---

### Task 2: Kalıcılık, plan toplama ve API

**Files:**
- Create: `server/dengeleme-kaynak.js`, `test/dengeleme-kaynak.check.mjs`
- Modify: `server/index.js` (import ve üç rota; `/api/backtest` rotalarının yanına), `package.json` (`test` zinciri)

**Interfaces:**
- Consumes: `plan`, `validateTargets` (Task 1); `pf.summary()` (alanlar: `holdings[]`, `totals.value`, `totals.cash`, `asOf`), `pf.ASSET_TYPES`, `getQuotes`, `db`, `tx` (`server/db.js`).
- Produces: `getTargets()`, `setTargets(t, {cashTracking})`, `saveTargets(t)` (async), `compute({extra}) → {...plan, targets, asOf, cashTracking, holdings, classLabels}`; rotalar; WS olayı `rebalance.updated`.

- [ ] **Step 1: Kalıcılık kontrolünü yaz (önce başarısız)**

Dosya `test/dengeleme-kaynak.check.mjs` (geçici veri dizini ister):

```js
import { getTargets, setTargets } from '../server/dengeleme-kaynak.js';
let ok=0,bad=0; const a=(n,c)=>{c?ok++:bad++;console.log(c?'OK  ':'FAIL',n)};
a('başlangıçta boş', JSON.stringify(getTargets())==='{"classTargets":{},"symbolTargets":{}}');
const t=setTargets({classTargets:{stock:60,gold:40},symbolTargets:{thyao:{cls:'stock',pct:50}}});
a('kaydedilir, sembol büyük harfe çevrilir', t.classTargets.stock===60 && t.symbolTargets.THYAO.pct===50);
let e; try{setTargets({classTargets:{stock:150}})}catch(x){e=x}
a('geçersiz hedef reddedilir', /0–100/.test(e?.message));
a('geçersiz kayıt öncekini bozmaz', getTargets().classTargets.stock===60);
a('bütün olarak değiştirir', Object.keys(setTargets({classTargets:{fund:10}}).classTargets).join()==='fund' && Object.keys(getTargets().symbolTargets).length===0);
let e2; try{setTargets({classTargets:{cash:10}},{cashTracking:false})}catch(x){e2=x}
a('nakit takibi kapalıyken cash reddedilir', !!e2);
console.log(ok+' geçti, '+bad+' başarısız'); process.exit(bad?1:0);
```

Çalıştır: `BORSA_DATA_DIR=$(mktemp -d) node test/dengeleme-kaynak.check.mjs`. Beklenen: FAIL (modül yok).

- [ ] **Step 2: `server/dengeleme-kaynak.js`**

```js
// Dengeleme: hedeflerin kalıcılığı ve plan için portföy/fiyat toplama. Hesap kuralları dengeleme.js'tedir (saf).
import { db, tx } from './db.js';
import * as pf from './portfolio.js';
import { getQuotes } from './market.js';
import { plan, validateTargets } from './dengeleme.js';

db.exec("CREATE TABLE IF NOT EXISTS rebalance_targets (kind TEXT NOT NULL CHECK (kind IN ('class','symbol')), key TEXT NOT NULL, pct REAL NOT NULL, cls TEXT, PRIMARY KEY (kind, key))");

/** Kayıtlı hedefler: { classTargets: { sınıf: %}, symbolTargets: { SEMBOL: { cls, pct } } } */
export function getTargets() {
  const out = { classTargets: {}, symbolTargets: {} };
  for (const r of db.prepare('SELECT kind, key, pct, cls FROM rebalance_targets').all()) {
    if (r.kind === 'class') out.classTargets[r.key] = Number(r.pct);
    else out.symbolTargets[r.key] = { cls: r.cls, pct: Number(r.pct) };
  }
  return out;
}

/** Hedefleri doğrulayıp bütün olarak değiştirir (kısmi kayıt yok). Geçersizse hata fırlatır. */
export function setTargets({ classTargets = {}, symbolTargets = {} } = {}, { cashTracking = false } = {}) {
  const v = validateTargets({ classTargets, symbolTargets, cashTracking });
  if (!v.ok) throw new Error(v.errors.join('; '));
  tx(() => {
    db.exec('DELETE FROM rebalance_targets');
    const ins = db.prepare('INSERT INTO rebalance_targets(kind, key, pct, cls) VALUES(?, ?, ?, ?)');
    for (const [k, pct] of Object.entries(classTargets)) ins.run('class', k, pct, null);
    for (const [s, e] of Object.entries(symbolTargets)) ins.run('symbol', String(s).toUpperCase(), e.pct, e.cls);
  });
  return getTargets();
}

/** API girişi: nakit takibi açık mı bakıp doğrular ve kaydeder. */
export async function saveTargets(t) {
  const s = await pf.summary();
  return setTargets(t || {}, { cashTracking: s.totals.cash != null });
}

/** Mevcut portföy ve hedeflerle plan. extra: ek nakit TL (0 = al/sat). */
export async function compute({ extra = 0 } = {}) {
  const s = await pf.summary();
  const targets = getTargets();
  const held = new Set(s.holdings.map((h) => h.symbol));
  const need = Object.keys(targets.symbolTargets).filter((x) => !held.has(x));
  const fresh = {};
  if (need.length) {
    const qs = await getQuotes(need).catch(() => ({}));
    for (const x of need) if (qs[x]?.price > 0) fresh[x] = { price: qs[x].price };
  }
  const cashTracking = s.totals.cash != null;
  const result = plan({ holdings: s.holdings, totalValue: s.totals.value, cash: s.totals.cash, cashTracking, fresh, ...targets, extra });
  return {
    ...result, targets, asOf: s.asOf, cashTracking,
    holdings: s.holdings.map((h) => ({ symbol: h.symbol, name: h.name, asset_type: h.asset_type, assetLabel: h.assetLabel, value: h.value, weight: h.weight, priceSource: h.priceSource, priceTime: h.priceTime })),
    classLabels: pf.ASSET_TYPES,
  };
}
```

Çalıştır: `BORSA_DATA_DIR=$(mktemp -d) node test/dengeleme-kaynak.check.mjs`. Beklenen: `6 geçti, 0 başarısız`.

- [ ] **Step 3: Rotalar ve zincir**

`server/index.js`, `import * as backtest from './backtest-run.js';` satırının altına:

```js
import * as rebalance from './dengeleme-kaynak.js';
```

`/api/backtest/run` rotasının altına:

```js
route('GET', '/api/rebalance/targets', async () => rebalance.getTargets());
route('PUT', '/api/rebalance/targets', async ({ body }) => { const r = await rebalance.saveTargets(body); broadcast({ t: 'rebalance.updated' }); return r; });
route('GET', '/api/rebalance', async ({ q }) => {
  const extra = q.get('extra') == null || q.get('extra') === '' ? 0 : Number(q.get('extra'));
  if (!Number.isFinite(extra) || extra < 0) throw new Error('Ek nakit 0 veya pozitif olmalı');
  return rebalance.compute({ extra });
});
```

`package.json` `test` zincirinin sonuna ` && BORSA_DATA_DIR=$(mktemp -d) node test/dengeleme-kaynak.check.mjs` ekle.

- [ ] **Step 4: Canlı doğrulama (test örneği; canlı servise dokunulmaz)**

```bash
D=$(mktemp -d); echo $D > $TMPDIR/rbd
BORSA_PORT=7520 BORSA_REPORT_PORT=7521 BORSA_DATA_DIR=$D node server/index.js > $D/log.txt 2>&1 &
sleep 5; T=$(BORSA_DATA_DIR=$D ./bin/kmy gateway token | grep -oE '[A-Za-z0-9_-]{20,}' | head -1)
H="Authorization: Bearer $T"
curl -s -H "$H" localhost:7520/api/rebalance | head -c 300; echo
```

Beklenen: `rows: []`, `summary.value: 0`, uyarı "Portföy değeri sıfır; öneri üretilemez" (boş portföy).

Örnek portföyü API'yle yükle (boş test veritabanı; TL hisseler, döviz gerekmez). Alan adları `validateTx`'e göredir: miktar `quantity`, nakit hareketlerinde tutar `price`. Bir nakit girişi ve iki hisse alımı ekle:

```bash
curl -s -X POST -H "$H" -H 'Content-Type: application/json' localhost:7520/api/transactions -d '{"type":"DEPOSIT","date":"2026-01-02","price":300000,"currency":"TRY"}' | head -c 120; echo
curl -s -X POST -H "$H" -H 'Content-Type: application/json' localhost:7520/api/transactions -d '{"type":"BUY","date":"2026-01-05","symbol":"THYAO","quantity":100,"price":300,"currency":"TRY"}' | head -c 120; echo
curl -s -X POST -H "$H" -H 'Content-Type: application/json' localhost:7520/api/transactions -d '{"type":"BUY","date":"2026-01-05","symbol":"AKBNK","quantity":500,"price":60,"currency":"TRY"}' | head -c 120; echo
```

Beklenen: üç kaydın oluşturma yanıtı. Hata dönerse yanıtın iletisini oku, gövdeyi ona göre düzeltip yeniden dene ve ledger'a `Ruling` yaz.

```bash
curl -s -X PUT -H "$H" -H 'Content-Type: application/json' localhost:7520/api/rebalance/targets -d '{"classTargets":{"stock":150}}' ; echo
curl -s -X PUT -H "$H" -H 'Content-Type: application/json' localhost:7520/api/rebalance/targets -d '{"classTargets":{"stock":60,"cash":20},"symbolTargets":{"THYAO":{"cls":"stock","pct":50}}}' | head -c 200; echo
curl -s -H "$H" localhost:7520/api/rebalance | node -e "const j=JSON.parse(require('fs').readFileSync(0));console.log(JSON.stringify(j.summary));console.log(j.rows.map(r=>[r.key,r.currentPct,r.targetPct,r.action,r.qty,r.tl].join(' ')).join('\n'));console.log(j.warnings)"
curl -s -H "$H" 'localhost:7520/api/rebalance?extra=50000' | node -e "const j=JSON.parse(require('fs').readFileSync(0));console.log(j.summary.mode,j.rows.map(r=>r.key+':'+r.action+':'+r.tl).join(' '))"
curl -s -H "$H" 'localhost:7520/api/rebalance?extra=-5'; echo
```

Beklenen: ilk PUT hata (`0–100`); ikincisi kaydı döndürür (nakit girişi eklendiği için nakit takibi açık, `cash` hedefi kabul); `GET /api/rebalance`: THYAO, AKBNK ve nakit satırları, gerçek % = değer / toplam, `netCash` işaretli ve elle hesapla tutarlı (toplam değer = hisse değerleri + nakit). Ek nakit çağrısı `mode: ekNakit` ve satış yok. Negatif `extra` hata verir.

```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add server/dengeleme-kaynak.js server/index.js test/dengeleme-kaynak.check.mjs package.json
git commit -m "Dengeleme: hedef kalıcılığı, plan toplama ve API"
```

---

### Task 3: Arayüz sekmesi

**Files:**
- Create: `web/js/rebalance-view.js`
- Modify: `web/js/portfolio-view.js` (import, `TABS`, render haritası), `web/js/lang/en/portfolio.js`, `web/js/lang/en/server.js`, `web/terminal.css`

**Interfaces:**
- Consumes: `GET /api/rebalance[?extra=]`, `PUT /api/rebalance/targets`, WS `rebalance.updated`/`portfolio.changed`; `core.js`: `on, api, $, $$, esc, num, money, cls, toast, localGet, localSet`; `i18n.js`: `t, tx`.
- Produces: `renderRebalance(body, isActive)`.

- [ ] **Step 1: Modül**

Dosya `web/js/rebalance-view.js`:

```js
// Portföy › Dengeleme sekmesi: hedef ağırlık girişi, sapma tablosu ve al/sat önerisi. Hesap sunucudadır (/api/rebalance).
import { on, api, $, $$, esc, num, money, cls, toast, localGet, localSet } from './core.js';
import { t, tx } from './i18n.js';

let active = () => false;
let res = null, extra = localGet('rbExtra', ''), draft = null, err = '', busy = false, host = null;
const ACT = { al: [t('AL'), 'up'], sat: [t('SAT'), 'down'], yok: ['—', ''], atlandi: [t('ATLANDI'), ''] };
const p1 = (x) => (x == null ? '—' : `${num(x, 1)}%`);
const sgn = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${num(x, 1)}`);
const pctVal = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));

function fresh() { // sunucudaki hedeflerden düzenlenebilir kopya (değerler metin)
  draft = {
    cls: Object.fromEntries(Object.entries(res.targets.classTargets).map(([k, v]) => [k, String(v)])),
    sym: Object.entries(res.targets.symbolTargets).map(([s, e]) => ({ s, cls: e.cls, pct: String(e.pct) })),
  };
}
const classList = () => Object.keys(res.classLabels).concat(res.cashTracking ? ['cash'] : []);
const label = (k) => (k === 'cash' ? t('Nakit') : tx(res.classLabels[k] || k));

async function load() {
  try {
    const q = Number(String(extra).replace(',', '.'));
    res = await api(`/rebalance${q > 0 ? `?extra=${q}` : ''}`);
    err = '';
    if (!draft) fresh();
  } catch (e) { err = tx(e.message); }
  paint();
}

function editor() {
  // Satırlar: portföydeki semboller + hedefi olup portföyde olmayanlar (kullanıcının eklediği)
  const heldClass = Object.fromEntries(res.holdings.map((h) => [h.symbol, h.asset_type]));
  const syms = [...new Map([...res.holdings.map((h) => [h.symbol, { s: h.symbol, cls: h.asset_type, pct: '' }]), ...draft.sym.map((x) => [x.s, x])]).values()];
  const classRows = classList().map((k) => `<tr><td>${esc(label(k))}</td><td class="r"><input class="rb-in" data-k="${k}" inputmode="decimal" value="${esc(draft.cls[k] ?? '')}" placeholder="—"> %</td></tr>`).join('');
  const symRows = syms.map((x) => `<tr><td class="mono"><b>${esc(x.s)}</b></td><td class="dim">${esc(label(x.cls))}${heldClass[x.s] ? '' : ` · ${esc(t('portföyde yok'))}`}</td><td class="r"><input class="rb-in" data-s="${esc(x.s)}" data-c="${esc(x.cls)}" inputmode="decimal" value="${esc(x.pct)}" placeholder="—"> %</td></tr>`).join('');
  const sum = Object.values(draft.cls).reduce((a, v) => a + (pctVal(v) || 0), 0);
  return `<div class="card"><h3>${t('Hedefler')}</h3>
    <div class="rb-grid"><div><div class="dim" style="margin-bottom:4px">${t('Sınıf hedefi (portföyün %)')}</div><table class="t"><tbody>${classRows}</tbody></table>
      <div class="kt-note ${sum > 100 ? 'down' : ''}">${t('Toplam')}: ${num(sum, 1)}% · ${t('hedefsiz')}: ${num(Math.max(0, 100 - sum), 1)}%</div></div>
    <div><div class="dim" style="margin-bottom:4px">${t('Sınıf içi pay (%) — boş bırakılırsa kalanı mevcut değerle paylaşır')}</div><table class="t"><tbody>${symRows}</tbody></table>
      <div class="row" style="margin-top:6px"><input id="rbNewS" class="rb-in" style="width:90px;text-align:left" placeholder="${esc(t('SEMBOL'))}">
      <select id="rbNewC" class="rb-in" style="width:130px;text-align:left">${Object.keys(res.classLabels).map((k) => `<option value="${k}">${esc(label(k))}</option>`).join('')}</select>
      <button class="btn sec" id="rbAdd">${t('＋ Sembol ekle')}</button></div></div></div>
    <div class="row" style="margin-top:8px"><button class="btn" id="rbSave" ${busy ? 'disabled' : ''}>${t('Hedefleri kaydet')}</button><button class="btn sec" id="rbReset">${t('Geri al')}</button></div></div>`;
}

function resultCard() {
  if (!res.rows.length && !res.warnings.length) return `<div class="card dim">${t('Henüz hedef yok. Yukarıdan sınıf hedefi girip kaydedin; öneri burada görünür.')}</div>`;
  const s = res.summary;
  const rows = res.rows.map((r) => {
    const [a, c] = ACT[r.action] || ['—', ''];
    return `<tr><td class="mono"><b>${esc(r.key === 'cash' ? t('Nakit') : r.kind === 'class' ? label(r.key) : r.key)}</b> <span class="dim">${esc(r.kind === 'class' ? '' : label(r.class))}</span></td>
      <td class="r num">${p1(r.currentPct)}</td><td class="r num">${p1(r.targetPct)}</td><td class="r num ${cls(-r.deviation)}">${sgn(r.deviation)}</td>
      <td class="${c}"><b>${esc(a)}</b></td><td class="r num">${r.qty != null ? num(r.qty, r.qty % 1 ? 4 : 0) : '—'}</td><td class="r num">${r.tl ? money(r.tl) : '—'}</td>
      <td class="r num dim">${r.taxEst ? money(r.taxEst) : '—'}</td><td class="dim">${r.reason ? esc(tx(r.reason)) : ''}</td></tr>`;
  }).join('');
  const sumLine = `${t('Net nakit değişimi')}: <b class="${cls(s.netCash)}">${s.netCash > 0 ? '+' : ''}${money(s.netCash)}</b> · ${t('Yuvarlama artığı')}: ${money(s.rounding)} · ${t('Mod')}: ${s.mode === 'ekNakit' ? t('yalnız alım (ek nakit)') : t('al/sat (değer sabit)')}`;
  return `<div class="card"><h3>${t('Öneri')} <span class="dim" style="font-weight:400">${esc(sumLine.replace(/<[^>]+>/g, ''))}</span></h3>
    ${res.warnings.map((w) => `<div class="kt-note down">${esc(tx(w))}</div>`).join('')}
    <div class="table-wrap"><table class="t"><thead><tr><th>${t('Varlık')}</th><th class="r">${t('Gerçek')}</th><th class="r">${t('Hedef')}</th><th class="r">${t('Sapma (puan)')}</th><th>${t('İşlem')}</th><th class="r">${t('Adet')}</th><th class="r">${t('Tutar')}</th><th class="r">${t('Tahmini vergi')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="kt-note">${t('Bu bir hesaptır, yatırım tavsiyesi değildir; emir gönderilmez. Fiyatlar BIST için ~15 dk gecikmeli olabilir. Vergi tahmini kısmi satışta oransaldır; komisyon hesaba katılmaz.')}</p></div>`;
}

function paint() {
  if (!active()) return;
  if (!res) { host.innerHTML = err ? `<div class="card"><div class="kt-note down">${esc(err)}</div></div>` : '<div class="skeleton" style="height:200px"></div>'; return; }
  host.innerHTML = `${err ? `<div class="kt-note down">${esc(err)}</div>` : ''}
    <div class="card"><div class="row"><label class="dim" for="rbExtra">${t('Ek nakit (TL)')}</label><input id="rbExtra" class="rb-in" style="width:130px" inputmode="decimal" value="${esc(extra)}" placeholder="0">
      <span class="dim">${t('Boş: portföy değeri sabit, al/sat. Girilirse yalnız alım önerilir.')}</span></div></div>
    ${editor()}${resultCard()}`;
  bind();
}

function readDraft() {
  draft.cls = {};
  for (const i of $$('input[data-k]', host)) if (i.value.trim() !== '') draft.cls[i.dataset.k] = i.value;
  const prev = new Map(draft.sym.map((x) => [x.s, x]));
  draft.sym = [];
  for (const i of $$('input[data-s]', host)) if (i.value.trim() !== '' || prev.has(i.dataset.s)) draft.sym.push({ s: i.dataset.s, cls: i.dataset.c, pct: i.value });
  draft.sym = draft.sym.filter((x) => x.pct.trim() !== '');
}

async function save() {
  readDraft();
  const classTargets = {}, symbolTargets = {};
  for (const [k, v] of Object.entries(draft.cls)) { const n = pctVal(v); if (!Number.isFinite(n)) { err = t('Geçersiz sayı: {k}', { k: label(k) }); return paint(); } classTargets[k] = n; }
  for (const x of draft.sym) { const n = pctVal(x.pct); if (!Number.isFinite(n)) { err = t('Geçersiz sayı: {k}', { k: x.s }); return paint(); } symbolTargets[x.s.toUpperCase()] = { cls: x.cls, pct: n }; }
  busy = true; paint();
  try { await api('/rebalance/targets', { method: 'PUT', body: { classTargets, symbolTargets } }); err = ''; draft = null; toast(t('Hedefler kaydedildi')); }
  catch (e) { err = tx(e.message); }
  finally { busy = false; }
  await load();
}

function bind() {
  const ex = $('#rbExtra', host);
  ex.onchange = () => { extra = ex.value.trim(); localSet('rbExtra', extra); readDraft(); load(); };
  $('#rbSave', host).onclick = save;
  $('#rbReset', host).onclick = () => { draft = null; fresh(); err = ''; paint(); };
  $('#rbAdd', host).onclick = () => {
    const s = $('#rbNewS', host).value.trim().toUpperCase(), c = $('#rbNewC', host).value;
    if (!s) return;
    readDraft();
    if (!draft.sym.some((x) => x.s === s)) draft.sym.push({ s, cls: c, pct: '0' });
    paint();
  };
}

/** Sekme gövdesini çizer (portfolio-view.js çağırır). */
export async function renderRebalance(body, isActive) {
  host = body; active = isActive;
  host.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  draft = null;
  await load();
}
on('ws:rebalance.updated', () => { draft = null; if (active()) load(); });
on('ws:portfolio.changed', () => { if (active()) load(); });
```

- [ ] **Step 2: Sekmeyi bağla**

`web/js/portfolio-view.js`: içe aktarmalara (`import { t, tx, lang, locale } from './i18n.js';` altına):

```js
import { renderRebalance } from './rebalance-view.js';
```

`TABS` dizisinde `['dagilim', t('Dağılım')],` öğesinin hemen ardına `['dengeleme', t('Dengeleme')],` ekle. `render()` içindeki `const fn = {...}` nesnesine `dengeleme: () => renderRebalance(body, () => tab === 'dengeleme'),` ekle (örn. `risk: renderRisk,` öğesinin önüne).

- [ ] **Step 3: Çeviriler ve stil**

`web/js/lang/en/portfolio.js` içinde `'Temettü': 'Dividends',` satırının hemen altına şu girdileri ekle (önce çakışma kontrolü: `for k in 'Dengeleme' 'Öneri' 'Hedefler'; do grep -c "'$k'" web/js/lang/en/*.js; done` çıktılarının hepsi 0 olmalı; varsa o girdiyi atla):

```js
  'Dengeleme': 'Rebalancing',
  'AL': 'BUY',
  'SAT': 'SELL',
  'portföyde yok': 'not held',
  'Hedefler': 'Targets',
  'Sınıf hedefi (portföyün %)': 'Class target (% of portfolio)',
  'Toplam': 'Total',
  'hedefsiz': 'unassigned',
  'Sınıf içi pay (%) — boş bırakılırsa kalanı mevcut değerle paylaşır': 'Share within class (%) — if left empty, the remainder is split by current value',
  'SEMBOL': 'SYMBOL',
  '＋ Sembol ekle': '＋ Add symbol',
  'Hedefleri kaydet': 'Save targets',
  'Geri al': 'Revert',
  'Henüz hedef yok. Yukarıdan sınıf hedefi girip kaydedin; öneri burada görünür.': 'No targets yet. Enter class targets above and save; the suggestion appears here.',
  'Net nakit değişimi': 'Net cash change',
  'Yuvarlama artığı': 'Rounding leftover',
  'yalnız alım (ek nakit)': 'buy only (extra cash)',
  'al/sat (değer sabit)': 'buy/sell (value fixed)',
  'Öneri': 'Suggestion',
  'Varlık': 'Asset',
  'Gerçek': 'Actual',
  'Sapma (puan)': 'Deviation (pts)',
  'İşlem': 'Action',
  'Tahmini vergi': 'Est. tax',
  'Bu bir hesaptır, yatırım tavsiyesi değildir; emir gönderilmez. Fiyatlar BIST için ~15 dk gecikmeli olabilir. Vergi tahmini kısmi satışta oransaldır; komisyon hesaba katılmaz.': 'This is a calculation, not investment advice; no orders are sent. BIST prices may be delayed ~15 min. The tax estimate is proportional for partial sales; commissions are not included.',
  'Ek nakit (TL)': 'Extra cash (TRY)',
  'Boş: portföy değeri sabit, al/sat. Girilirse yalnız alım önerilir.': 'Empty: portfolio value fixed, buy/sell. If entered, only buys are suggested.',
  'Geçersiz sayı: {k}': 'Invalid number: {k}',
  'Hedefler kaydedildi': 'Targets saved',
  'Dengeleme': 'Rebalancing',
```

`web/js/lang/en/server.js` içinde `// ── Sinyal radarı (server/radar.js SIGNALS) ──` satırının hemen önüne sunucu iletileri:

```js
  'Sınıfta sembol yok; sembol payı girin': 'No symbols in this class; enter a symbol share',
  'Kur bulunamadı': 'FX rate not found',
  'Fiyat yok': 'No price',
  'İşlem gerekmez': 'No action needed',
  'Satış önerilmez (ek nakit modu)': 'No sale suggested (extra-cash mode)',
  'Tutar bir adetten az': 'Amount is less than one share',
  'Nakit sınıfı yalnız bilgi': 'Cash class is informational only',
  'Portföy değeri sıfır; öneri üretilemez': 'Portfolio value is zero; no suggestion possible',
  'Net alım mevcut nakitten büyük; nakit yetmeyebilir': 'Net buys exceed available cash; cash may not suffice',
  'Ek nakit 0 veya pozitif olmalı': 'Extra cash must be 0 or positive',
  'Nakit hedefi için nakit takibi açık olmalı (önce bir nakit girişi kaydedin)': 'Cash tracking must be on for a cash target (record a cash deposit first)',
```

Ve `patterns` dizisinde `// ── Ajan etkinliği / sohbet bildirimleri ──` satırının hemen önüne:

```js
  // ── Dengeleme (server/dengeleme.js) ──
  [/^(.+): sınıf içinde %(.+) pay dağıtılmadı \(hedefsiz bırakıldı\)$/, '$1: $2% of the class share was left unassigned'],
  [/^(.+): (\w+) sınıfı hedefsiz olduğundan sembol payı yok sayıldı$/, '$1: share ignored because class $2 has no target'],
  [/^Ek nakitten (.+) TL dağıtılmadı; nakit olarak kalır$/, '$1 TRY of the extra cash was not allocated; it stays as cash'],
  [/^(\d+) satır atlandı; net nakit değişimi eksik$/, '$1 row(s) skipped; net cash change is incomplete'],
  [/^Sınıf hedefleri toplamı %100'ü aşamaz \(şu an %(.+)\)$/, 'Class targets cannot exceed 100% (currently $1%)'],
  [/^(.+): sembol payları toplamı %100'ü aşamaz \(şu an %(.+)\)$/, '$1: symbol shares cannot exceed 100% (currently $2%)'],
  [/^(.+): hedef 0–100 arasında bir sayı olmalı$/, '$1: target must be a number between 0 and 100'],
  [/^(.+): pay 0–100 arasında bir sayı olmalı$/, '$1: share must be a number between 0 and 100'],
  [/^Bilinmeyen sınıf: (.+)$/, 'Unknown class: $1'],
  [/^(.+): geçerli bir sınıf gerekli$/, '$1: a valid class is required'],

```

`web/terminal.css` sonuna:

```css
.rb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 900px) { .rb-grid { grid-template-columns: 1fr; } }
input.rb-in { width: 70px; text-align: right; }
```

Çeviri doğrulaması (her sunucu iletisi ve desen):

```bash
node --input-type=module -e "
import EN, { patterns } from './web/js/lang/en/server.js';
const msgs=['Fiyat yok','Kur bulunamadı','İşlem gerekmez','Tutar bir adetten az','Nakit sınıfı yalnız bilgi','Sınıfta sembol yok; sembol payı girin','Satış önerilmez (ek nakit modu)','Portföy değeri sıfır; öneri üretilemez','Net alım mevcut nakitten büyük; nakit yetmeyebilir','Ek nakit 0 veya pozitif olmalı','stock: sınıf içinde %40 pay dağıtılmadı (hedefsiz bırakıldı)','Z: gold sınıfı hedefsiz olduğundan sembol payı yok sayıldı','Ek nakitten 12.5 TL dağıtılmadı; nakit olarak kalır','2 satır atlandı; net nakit değişimi eksik','Sınıf hedefleri toplamı %100\'ü aşamaz (şu an %110)','stock: sembol payları toplamı %100\'ü aşamaz (şu an %120)','stock: hedef 0–100 arasında bir sayı olmalı','A: pay 0–100 arasında bir sayı olmalı','Bilinmeyen sınıf: kedi','A: geçerli bir sınıf gerekli'];
const miss=msgs.filter(m=>!(m in EN)&&!patterns.some(([re])=>re.test(m)));
console.log('çevrilmeyen:',miss.length?miss:'yok');"
```

Beklenen: `çevrilmeyen: yok`.

- [ ] **Step 4: Tarayıcıda doğrula (1440 / 900 / 760 px, TR ve EN)**

Test örneğini Task 2 Step 4 gibi başlat (7520; örnek portföyü API'yle yeniden yükle), uygulamayı aç, **Portföy › Dengeleme** sekmesine git:

1. Hedef yokken: "Henüz hedef yok…" kartı; konsolda hata yok; sekmeler arası geçişte (Özet ↔ Dengeleme) içerik karışmaz.
2. Hisse hedefi %60, nakit %20 gir, THYAO payı %50, kaydet: "Hedefler kaydedildi" bildirimi, tablo ve öneri güncellenir; toplam göstergesi %80, hedefsiz %20.
3. Hedefi %150 yap, kaydet: kırmızı hata notu, önceki tablo kalır, kaydet düğmesi tekrar etkin. "Geri al" taslağı sunucudaki hedefe döndürür.
4. "Ek nakit" alanına 50000 gir: mod "yalnız alım (ek nakit)", satış satırı yok; alanı boşalt: al/sat moduna döner.
5. "＋ Sembol ekle" ile portföyde olmayan bir BIST sembolü (örn. ASELS) %20 payla ekle, kaydet: yeni alım satırı (fiyat varsa AL, yoksa ATLANDI + "Fiyat yok").
6. İki pencerede aç, birinde kaydet: diğeri `rebalance.updated` ile yenilenir.
7. Genişlik 1440/900/760: sayfa yatay kaymaz, editör iki sütundan tek sütuna geçer, tablo kendi kutusunda kayar. Dil EN: tüm başlıklar, düğmeler, uyarılar ve işlem etiketleri (BUY/SELL) İngilizce, ham Türkçe anahtar kalmaz.

Her adım için `read_page`/ekran görüntüsüyle kanıt al.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "Dengeleme: portföy sayfasında Dengeleme sekmesi"
```

---

### Task 4: Belgeler, sürüm ve spec düzeltmesi

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `package.json` (version), `docs/superpowers/specs/2026-10-05-hedef-agirlik-dengeleme-design.md`

- [ ] **Step 1: Sürüm ve CHANGELOG**

`package.json` `"version"`: `0.21.1` → `0.22.0`. `CHANGELOG.md` en üste `0.21.1` girdisinin biçiminde bir `0.22.0` girdisi ekle: Portföy › **Dengeleme** sekmesi (sınıf ve sembol düzeyinde hedef, sapma, al/sat önerisi, ek nakitle yalnız alım, tam sayı adet ve yuvarlama artığı, tahmini vergi; emir gönderilmez, hesap tavsiye değildir); `GET/PUT /api/rebalance/targets`, `GET /api/rebalance`; hedefler `rebalance_targets` tablosunda yerelde kalır; ölçüm: Task 2 Step 4 örneğinde gördüğün sayılar; test sayısı (Task 1: 49 + kalıcılık kontrolü 6, `npm test` toplamını yaz).

- [ ] **Step 2: README ve spec**

README'de portföy özelliklerinin sayıldığı yere bir cümle ekle (Dengeleme sekmesi). Spec'te `symbolTargets` biçimini `{ SEMBOL: { cls, pct } }` olarak ve tablo şemasını `rebalance_targets(kind, key, pct, cls)` olarak düzelt; `saveTargets` ve `compute` dönüş alanlarını (`holdings`, `classLabels`) mimari bölümüne ekle.

- [ ] **Step 3: Tam test ve commit**

```bash
npm test 2>&1 | grep -E "başarısız|FAIL"
git add -A README.md CHANGELOG.md package.json docs
git commit -m "0.22.0: hedef ağırlığa göre dengeleme"
```

Beklenen: hiç `FAIL` yok.

---

## Self-Review

- **Spec kapsamı:** hesap kuralları (etkin hedef, sapma, eşik, mod 1/2, adet, vergi, atlama, uyarılar) Task 1; kalıcılık, plan toplama, API ve doğrulama Task 2; arayüz, ek nakit alanı, hata ve boş durumlar, çeviri, responsive Task 3; sürüm/belge/spec düzeltmesi Task 4. Kapsam dışı maddeler (emir, otomatik dengeleme, platform bazlı hedef, komisyon, ajan aracı) plana girmedi.
- **Yer tutucu taraması:** tüm kod blokları çalıştırılmış dosya içeriğidir; Task 2 Step 4'teki işlem gövdeleri `validateTx`'e göre doğrulanacak biçimde yönergelidir (alan adı farkı için ledger `Ruling` talimatı var).
- **Tip tutarlılığı:** `plan` satır alanları (`key, kind, class, currentPct, targetPct, deviation, action, tl, qty, price, taxEst, reason`) arayüz tarafından aynen okunur; `summary.mode/netCash/rounding/targetSum/unassignedPct` aynı; `compute` dönüşü `rows, summary, warnings, targets, cashTracking, holdings[{symbol,name,asset_type,assetLabel,value,weight}], classLabels` arayüzdeki kullanımla aynı; `symbolTargets` her yerde `{cls, pct}`.
- **Review Focus:** 5 maddenin testi ilgili task'ta.

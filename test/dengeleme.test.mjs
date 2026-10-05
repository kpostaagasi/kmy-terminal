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

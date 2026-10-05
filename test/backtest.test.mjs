// Backtest motoru: olay tanımı, getiri kuralı, taban, yön duyarlı isabet, toplama. Çevrimdışı, saf.
import { symbolObservations, aggregate, computeBacktest, HORIZONS, GAP, WARMUP, MIN_N } from '../server/backtest.js';
import { SIGNALS } from '../server/sinyal-tanim.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const near = (a, b, tol = 1e-9) => a != null && Number.isFinite(a) && Math.abs(a - b) <= tol;
const D = (k) => Date.UTC(2024, 0, 1 + k);

assert('sabitler: ufuklar, tekilleştirme, ısınma, az örnek', HORIZONS.join() === '5,20,60' && GAP === 20 && WARMUP === 252 && MIN_N === 30);

// Sabit fiyat modeli: o_k = 100 + k, c_k = 100 + k + 0.5 (elle hesaplanabilir)
const bars = Array.from({ length: 40 }, (_, k) => ({ t: D(k), o: 100 + k, h: 101 + k, l: 99 + k, c: 100 + k + 0.5, v: 1000 }));
// Endeks: o_k = 1000 + 20k, c_k = o_k + 10
const bench = Array.from({ length: 40 }, (_, k) => ({ t: D(k), o: 1000 + 20 * k, h: 0, l: 0, c: 1000 + 20 * k + 10, v: 0 }));
const at = (set) => (i) => (set.includes(i) ? ['golden'] : []);
const OPT = { horizons: [5, 20], gap: 20, warmup: 5 };

// ── Olay = ilk belirme günü; tekilleştirme ────────────────────────────────
// golden: i = 10, 11 (devam), 25 (10'dan 15 gün sonra: tekrar), 31 (son kabul edilen 10'dan 21 gün sonra), 32 (devam)
const obs = symbolObservations(bars, bench, { ...OPT, signals: at([10, 11, 25, 31, 32]) });
assert('olaylar: yalnız ilk belirme günleri 10 ve 31 (11 devam, 25 gap içinde, 32 devam)', obs.events.map((e) => e.i).join() === '10,31', obs.events.map((e) => e.i).join());
assert('tekilleştirme: 20 gün içindeki tekrar (15 gün sonra) sayılmaz', !obs.events.some((e) => e.i === 25));
assert('tekilleştirme: 21. gün sayılır', obs.events.some((e) => e.i === 31));
const exact20 = symbolObservations(bars, bench, { ...OPT, signals: at([10, 30]) });
assert('tekilleştirme sınırı: tam 20 gün sonraki olay sayılmaz', exact20.events.map((e) => e.i).join() === '10');
const first = symbolObservations(bars, bench, { ...OPT, signals: (i) => (i >= 3 ? ['golden'] : []) });
assert('ısınma öncesinden beri süren sinyal olay değildir (i = warmup, önceki gün de var)', first.events.length === 0);

// ── Getiri kuralı: giriş = ertesi gün açılışı, çıkış = h. gün kapanışı ─────
const e10 = obs.events.find((e) => e.i === 10);
assert('h=5: giriş bars[11].o = 111, çıkış bars[15].c = 115.5', near(e10.rets[5].r, 115.5 / 111 - 1), String(e10.rets[5].r));
assert('h=20: çıkış bars[30].c = 130.5', near(e10.rets[20].r, 130.5 / 111 - 1));
assert('XU100\'a göre fark: hisse getirisi − (1310/1220 − 1)', near(e10.rets[5].ex, (115.5 / 111 - 1) - (1300 + 10) / 1220 + 1), String(e10.rets[5].ex));
const e31 = obs.events.find((e) => e.i === 31);
assert('h=5 için çıkış (36) seri içinde: var', e31.rets[5] != null && near(e31.rets[5].r, 136.5 / 132 - 1));
assert('h=20 için çıkış (51) seri dışı: o olay o ufukta dışarıda', e31.rets[20] === undefined);
assert('olay tarihi sinyal gününün İstanbul/UTC takvim günü', e10.date === '2024-01-11');

// ── Taban: aynı kural, her gün (sinyal günleri dahil) ─────────────────────
assert('taban h=5: i = 5..34 → 30 gün', obs.base[5].length === 30, String(obs.base[5].length));
assert('taban h=20: i = 5..19 → 15 gün', obs.base[20].length === 15, String(obs.base[20].length));
assert('taban, sinyal günlerini de içerir (aynı kurala göre i = 10 getirisi)', obs.base[5].some((x) => near(x.r, 115.5 / 111 - 1)));

// ── Endekste eksik tarih ──────────────────────────────────────────────────
const benchGap = bench.filter((_, k) => k !== 11); // bars[11] tarihi endekste yok → i = 10 olayının girişi eşleşmez
const og = symbolObservations(bars, benchGap, { ...OPT, signals: at([10, 31]) });
assert('endekste giriş tarihi yoksa o olayın excess değeri null (getiri yine var)', og.events[0].rets[5].ex === null && og.events[0].rets[5].r != null);
assert('diğer olayın excess değeri etkilenmez', og.events[1].rets[5].ex != null);
assert('endeks yoksa (null) excess null, çökme yok', symbolObservations(bars, null, { ...OPT, signals: at([10]) }).events[0].rets[5].ex === null);

// ── Bozuk veri ────────────────────────────────────────────────────────────
const badBars = bars.map((b) => ({ ...b })); badBars[11].o = 0; badBars[15].c = NaN;
const ob = symbolObservations(badBars, bench, { ...OPT, signals: at([10]) });
assert('girişi 0 ya da çıkışı NaN olan olay o ufukta üretmez (çökme yok)', ob.events[0].rets[5] === undefined && ob.events[0].rets[20] === undefined);
assert('sinyalsiz seri: olay yok, taban var', symbolObservations(bars, bench, { ...OPT, signals: () => [] }).events.length === 0 && obs.base[5].length > 0);
assert('seri ısınmadan kısa: olay ve taban yok', (() => { const o = symbolObservations(bars.slice(0, 4), bench, { ...OPT, signals: at([2]) }); return o.events.length === 0 && o.base[5].length === 0; })());
assert('gerçek sinyallerle (varsayılan) kısa seride çökmez', symbolObservations(bars, bench, { horizons: [5] }).events.length === 0);

// ── aggregate: istatistikler, yön duyarlı isabet, fark, az örnek ──────────
const o = (r, ex = null) => ({ r, ex });
const all = {
  base: { 5: [o(0.01), o(0.01), o(-0.01), o(0.03)], 20: [] },
  events: { golden: { 5: [o(0.10, 0.02), o(-0.05, -0.01), o(0.02, null)] }, death: { 5: [o(-0.10), o(0.05)] } },
};
const ag = aggregate(all, { horizons: [5, 20], minN: 30 });
assert('taban: n, ortalama, medyan, yükseliş/düşüş isabeti', ag.baseline[5].n === 4 && near(ag.baseline[5].mean, 0.01) && near(ag.baseline[5].median, 0.01) && near(ag.baseline[5].hitUp, 0.75) && near(ag.baseline[5].hitDown, 0.25));
const g5 = ag.signals.golden[5];
assert('yükseliş sinyali: n, ortalama, medyan', g5.n === 3 && near(g5.mean, 0.07 / 3) && near(g5.median, 0.02));
assert('yükseliş sinyali: isabet = getiri > 0 payı (2/3)', near(g5.hit, 2 / 3));
assert('fark = ortalama − taban ortalaması', near(g5.delta, 0.07 / 3 - 0.01));
assert('XU100\'a göre: yalnız endeksi olan olayların ortalaması, excessN ayrı', near(g5.excess, 0.005) && g5.excessN === 2);
const d5 = ag.signals.death[5];
assert('düşüş sinyali: isabet = getiri < 0 payı (1/2)', near(d5.hit, 0.5));
assert('düşüş sinyali için taban isabeti hitDown ile karşılaştırılır (taban satırında iki değer de var)', near(ag.baseline[5].hitDown, 0.25) && near(ag.baseline[5].hitUp, 0.75));
assert('n < 30 → low', g5.low === true);
assert('boş ufuk: n = 0, ortalama/fark null, low true', ag.signals.golden[20].n === 0 && ag.signals.golden[20].mean === null && ag.signals.golden[20].delta === null && ag.signals.golden[20].low === true);
assert('tüm sinyal anahtarları tabloda (veri olmasa da)', Object.keys(SIGNALS).every((k) => ag.signals[k] && ag.signals[k][5]));
assert('satırda yön ve etiket bulunur', ag.signals.death.dir === 'down' && ag.signals.golden.dir === 'up' && typeof ag.signals.golden.label === 'string');
const many = (n) => ({ base: { 5: [o(0.01)] }, events: { golden: { 5: Array.from({ length: n }, () => o(0.02)) } } });
assert('az örnek sınırı: n = 29 low, n = 30 değil', aggregate(many(29), { horizons: [5] }).signals.golden[5].low === true && aggregate(many(30), { horizons: [5] }).signals.golden[5].low === false);
assert('getiriler oran olarak (yüzde değil)', near(g5.median, 0.02) && Math.abs(g5.mean) < 1);
assert('boş girdi çökmez', aggregate({ base: {}, events: {} }, { horizons: [5] }).baseline[5].n === 0);

// ── computeBacktest: bütünleşik (gerçek sinyal tanımlarıyla, sentetik seri) ──
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeBars(seed, n) {
  const r = rng(seed); let c = 100; const out = [];
  for (let i = 0; i < n; i++) {
    const drift = [0.0015, -0.006, 0, 0.004][Math.floor(i / 120) % 4];
    const ret = Math.max(-0.09, Math.min(0.09, drift + (r() - 0.5) * 0.04));
    const open = c; c *= 1 + ret;
    out.push({ t: D(i), o: open, h: Math.max(open, c) * 1.005, l: Math.min(open, c) * 0.995, c, v: Math.round(1e6 * (0.5 + r()) * (r() < 0.03 ? 4 : 1)) });
  }
  return out;
}
const idx = makeBars(99, 900);
const series = [1, 2, 3].map((s) => ({ symbol: 'S' + s, bars: makeBars(s, 900) }));
const res = await computeBacktest({ series, bench: idx });
assert('bütünleşik: üç hisse, atlanan yok, taban dolu', res.params.symbols === 3 && res.params.skipped.length === 0 && res.baseline[20].n > 1000);
assert('bütünleşik: parametreler (ufuklar, gap, ısınma, az örnek) sonuçta', res.params.horizons.join() === '5,20,60' && res.params.gap === 20 && res.params.warmup === 252 && res.params.minN === 30);
assert('bütünleşik: tarih aralığı ısınmadan sonra başlar ve seri sonunda biter', res.params.from === new Date(D(252)).toISOString().slice(0, 10) && res.params.to === new Date(D(899)).toISOString().slice(0, 10));
assert('bütünleşik: en az bir sinyal türünde olay var', Object.values(res.signals).some((s) => s[20].n > 0));
assert('bütünleşik: 300 mumdan kısa seri atlanır', (await computeBacktest({ series: [{ symbol: 'KISA', bars: makeBars(1, 250) }, ...series], bench: idx })).params.skipped.join() === 'KISA');
assert('bütünleşik: deterministik (aynı girdi aynı sonuç)', JSON.stringify(await computeBacktest({ series, bench: idx })) === JSON.stringify(res));
assert('bütünleşik: boş seri listesi çökmez', (await computeBacktest({ series: [], bench: idx })).params.symbols === 0);

// Bölünme düzeltmesi: bir serinin ortasına 1:3 bölünme eklenince sahte −%67 getiri üretmemeli
const withSplit = makeBars(5, 900).map((b, i) => (i >= 500 ? { ...b, o: b.o / 3, h: b.h / 3, l: b.l / 3, c: b.c / 3, v: b.v * 3 } : { ...b }));
const rs = await computeBacktest({ series: [{ symbol: 'BOL', bars: withSplit }], bench: idx });
assert('bölünme içeren seri: kırılma sayısı 1', rs.params.splitBreaks === 1, String(rs.params.splitBreaks));
const clean = await computeBacktest({ series: [{ symbol: 'BOL', bars: makeBars(5, 900) }], bench: idx });
const drift = Math.abs(rs.baseline[20].median - clean.baseline[20].median);
assert('bölünme içeren seri, bölünmesiz eşdeğerine yakın sonuç verir (taban medyanı farkı < 0,01)', drift < 0.01, String(drift));
const worst = Math.min(...Object.values(rs.signals).flatMap((s) => [5, 20, 60].map((h) => s[h].n ? s[h].median : 0)), rs.baseline[60].median);
assert('bölünme içeren seri: medyanlarda sahte çöküş yok', worst > -0.3, String(worst));

// Olay döngüsü: hisseler arasında kontrol bırakılır (yaklaşık 1,3 sn kesintisiz bloklama olmasın)
{
  let calls = 0, atTick = null;
  setImmediate(() => { atTick = calls; });
  await computeBacktest({ series, bench: idx, signals: () => { calls++; return []; } });
  assert('computeBacktest hisseler arasında olay döngüsüne döner', atTick !== null && atTick < calls, `${atTick}/${calls}`);
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);

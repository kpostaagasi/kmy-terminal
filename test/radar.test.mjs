// Radar sinyal tanımları: altın-referans (refactor öncesi çıktı), önek eşdeğerliği (ileriye bakma yok), bölünme düzeltmesi. Çevrimdışı.
import fs from 'node:fs';
import { scanBars, signalSeries, signalsAt, SIGNALS } from '../server/sinyal-tanim.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

// Deterministik sentetik seri (tohumlu rastgele yürüyüş; günlük hareket ±%9 ile sınırlı: bölünme içermez)
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeBars(seed, n, { drifts = [0.0015, -0.006, 0, 0.004], len = 120 } = {}) {
  const r = rng(seed); let c = 100; const bars = [];
  for (let i = 0; i < n; i++) {
    const drift = drifts[Math.floor(i / len) % drifts.length]; // varsayılan: yükseliş, sert düşüş, yatay, toparlanma
    const ret = Math.max(-0.09, Math.min(0.09, drift + (r() - 0.5) * 0.04));
    const o = c; c = c * (1 + ret);
    const burst = r() < 0.03 ? 4 : 1;
    bars.push({ t: Date.UTC(2020, 0, 1) + i * 86400000, o, h: Math.max(o, c) * (1 + r() * 0.01), l: Math.min(o, c) * (1 - r() * 0.01), c, v: Math.round(1e6 * (0.5 + r()) * burst) });
  }
  return bars;
}
const cfg = (seed) => (seed >= 9 ? { drifts: [0.003, 0.003, -0.004, -0.004], len: 130 } : undefined); // 9-10: uzun yükseliş sonra uzun düşüş (ölüm kesişimi)
const round = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6);

// ── 1) Altın-referans: refactor öncesi scanBars çıktısı ile birebir aynı ───
const GOLD = JSON.parse(fs.readFileSync(new URL('./fixtures/radar-golden.json', import.meta.url), 'utf8'));
const seen = new Set();
let points = 0, wrong = 0;
for (const [seed, rows] of Object.entries(GOLD.seeds)) {
  const bars = makeBars(Number(seed), GOLD.n, cfg(Number(seed)));
  for (const [i, sig, price, chg, rsi, vr] of rows) {
    const r = scanBars(bars.slice(0, i + 1));
    points++;
    const got = [r.signals.join(','), round(r.price), round(r.changePct), round(r.rsi), round(r.volRatio)];
    if (JSON.stringify(got) !== JSON.stringify([sig, price, chg, rsi, vr])) { wrong++; if (wrong <= 3) console.log('  ayrım', seed, i, JSON.stringify(got), JSON.stringify([sig, price, chg, rsi, vr])); }
    r.signals.forEach((s) => seen.add(s));
  }
}
assert(`altın-referans: ${points} noktanın tamamı refactor öncesi çıktıyla aynı`, wrong === 0, `${wrong} fark`);
assert('altın-referans her sinyal türünü egzersiz eder (11/11)', Object.keys(SIGNALS).every((k) => seen.has(k)), [...seen].length + '/' + Object.keys(SIGNALS).length);

// ── 2) Önek eşdeğerliği: i. mumdaki sinyal yalnız ≤ i verisine bağlıdır (ileriye bakma yok) ──
let preMismatch = 0, preN = 0;
for (const seed of [1, 2, 3, 4, 9, 10]) {
  const bars = makeBars(seed, 520, cfg(seed));
  const S = signalSeries(bars);
  for (let i = 59; i < bars.length; i += 7) {
    preN++;
    const full = signalsAt(S, i).join(',');
    const prefix = scanBars(bars.slice(0, i + 1)).signals.join(',');
    if (full !== prefix) { preMismatch++; if (preMismatch <= 3) console.log('  önek ayrımı', seed, i, full, '|', prefix); }
  }
}
assert(`önek eşdeğerliği: ${preN} noktada tüm seri ile önek aynı sinyali verir`, preMismatch === 0, `${preMismatch} fark`);
assert('erken indekslerde (ısınma öncesi) signalsAt çökmez', (() => { const S = signalSeries(makeBars(1, 300)); for (let i = 0; i < 60; i++) signalsAt(S, i); return true; })());
assert('gelecek verisi sinyali değiştirmez: seri sonuna 50 mum eklemek eski indeksleri etkilemez', (() => {
  const a = makeBars(3, 400), b = makeBars(3, 450); // aynı tohum: ilk 400 mum aynı
  const Sa = signalSeries(a), Sb = signalSeries(b);
  for (let i = 0; i < 400; i += 3) if (signalsAt(Sa, i).join() !== signalsAt(Sb, i).join()) return false;
  return true;
})());

// ── 3) scanBars sınırları ─────────────────────────────────────────────────
assert('60 mumdan kısa seri null', scanBars(makeBars(1, 59)) === null);
assert('tam 60 mum çalışır', scanBars(makeBars(1, 60)) !== null);
assert('boş seri null', scanBars([]) === null);

// ── 4) Bölünme düzeltmesi canlı sinyalleri bozmaz ─────────────────────────
// Son 3 mum 1:3 bölünme sonrası ham fiyatlar: düzeltilmezse sahte 52 hafta dibi ve SMA200 aşağı kırılımı görünür.
const clean = makeBars(2, 400);
const split = clean.map((b, i) => (i >= 397 ? { ...b, o: b.o / 3, h: b.h / 3, l: b.l / 3, c: b.c / 3, v: b.v * 3 } : { ...b }));
const naive = signalsAt(signalSeries(split), split.length - 1);
const adj = scanBars(split);
assert('düzeltilmemiş seride sahte düşüş sinyali görünür (test kurgusu geçerli)', naive.includes('low52'), naive.join(','));
assert('scanBars bölünmeyi düzeltir: sahte 52 hafta dibi / SMA200 aşağı kırılım / ölüm kesişimi yok', !adj.signals.includes('low52') && !adj.signals.includes('sma200_dn') && !adj.signals.includes('death'), adj.signals.join(','));
assert('scanBars bölünme gününde günlük değişim makul (|%| < 15)', Math.abs(adj.changePct) < 15, String(adj.changePct));
assert('scanBars fiyatı ham güncel kapanıştır (son mum düzeltilmez)', adj.price === split.at(-1).c);

// Sıfır kapanışlı bozuk mum sahte sinyal üretmemeli: mum atılmış seriyle aynı sonuç
{
  const b = makeBars(3, 400); const broken = b.map((x, i) => (i === 150 ? { ...x, c: 0 } : x));
  const clean = b.filter((_, i) => i !== 150);
  const a1 = scanBars(broken.slice(0, 160)), a2 = scanBars(clean.slice(0, 159));
  assert('sıfır kapanışlı mum seriden atılmış gibi davranır (160. mumda sinyal ve fiyat aynı)', JSON.stringify(a1) === JSON.stringify(a2));
}
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);

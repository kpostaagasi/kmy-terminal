// Altın-referans üretici: radar.js'in refactor ÖNCESİ scanBars çıktısını kaydeder. Refactor'dan önce bir kez çalıştırılır; sonuç depoya girer.
// Kullanım: node test/fixtures/make-radar-golden.mjs test/fixtures/radar-golden.json
import fs from 'node:fs';
import { scanBars as oldScan, SIGNALS } from '../../server/radar.js';
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
const round = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6);
const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const cfg = (seed) => (seed >= 9 ? { drifts: [0.003, 0.003, -0.004, -0.004], len: 130 } : undefined); // 9-10: uzun yükseliş sonra uzun düşüş (ölüm kesişimi)
const out = {}; const seen = new Set(); let count = 0;
for (const seed of seeds) {
  const bars = makeBars(seed, 520, cfg(seed)); const rows = [];
  for (let i = 59; i < bars.length; i += 5) {
    const r = oldScan(bars.slice(0, i + 1));
    rows.push([i, r.signals.join(','), round(r.price), round(r.changePct), round(r.rsi), round(r.volRatio)]);
    r.signals.forEach((s) => seen.add(s)); count++;
  }
  out[seed] = rows;
}
fs.writeFileSync(process.argv[2], JSON.stringify({ n: 520, step: 5, from: 59, seeds: out }));
console.log('nokta', count, '| görülen sinyal', seen.size + '/' + Object.keys(SIGNALS).length, '| eksik:', Object.keys(SIGNALS).filter((k) => !seen.has(k)).join(',') || 'yok');

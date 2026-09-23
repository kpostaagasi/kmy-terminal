// Sinyal radarı: günlük verilerden teknik tetikleyicileri tarar (BIST 100 varsayılan evren)
import { getHistory, normalize } from './market.js';
import * as universe from './universe.js';
import { sma, rsi, macd } from './indicators.js';
import { cacheGet, cachePut } from './db.js';

export const SIGNALS = {
  rsi_os: { label: 'RSI aşırı satım (<30)', dir: 'up' },
  rsi_ob: { label: 'RSI aşırı alım (>70)', dir: 'down' },
  golden: { label: 'Altın kesişim (SMA50↑SMA200)', dir: 'up' },
  death: { label: 'Ölüm kesişimi (SMA50↓SMA200)', dir: 'down' },
  high52: { label: '52 hafta zirvesi', dir: 'up' },
  low52: { label: '52 hafta dibi', dir: 'down' },
  vol: { label: 'Hacim patlaması (>2× ort.)', dir: 'neutral' },
  sma200_up: { label: 'SMA200 yukarı kırılım', dir: 'up' },
  sma200_dn: { label: 'SMA200 aşağı kırılım', dir: 'down' },
  macd_up: { label: 'MACD al kesişimi', dir: 'up' },
  macd_dn: { label: 'MACD sat kesişimi', dir: 'down' },
};

const crossedUp = (a, b, i) => a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i] > b[i] && a[i - 1] <= b[i - 1];
const crossedDn = (a, b, i) => a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i] < b[i] && a[i - 1] >= b[i - 1];
// Son n bar içindeki en yeni kesişimin yönü: 'up' | 'dn' | null
function lastCross(a, b, n, last) {
  for (let i = last; i > last - n && i > 0; i--) {
    if (crossedUp(a, b, i)) return 'up';
    if (crossedDn(a, b, i)) return 'dn';
  }
  return null;
}

export function scanBars(bars) {
  if (bars.length < 60) return null;
  const c = bars.map((b) => b.c), v = bars.map((b) => b.v || 0);
  const L = c.length - 1;
  const s50 = sma(c, 50), s200 = sma(c, 200), r = rsi(c, 14), m = macd(c);
  const out = [];
  if (r[L] != null && r[L] < 30) out.push('rsi_os');
  if (r[L] != null && r[L] > 70) out.push('rsi_ob');
  const ma = lastCross(s50, s200, 5, L);
  if (ma) out.push(ma === 'up' ? 'golden' : 'death');
  const win = c.slice(-252);
  if (c[L] >= Math.max(...win) * 0.995) out.push('high52');
  if (c[L] <= Math.min(...win) * 1.005) out.push('low52');
  const avg20 = v.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  if (avg20 > 0 && v[L] > 2 * avg20) out.push('vol');
  const px = lastCross(c, s200, 3, L);
  if (px) out.push(px === 'up' ? 'sma200_up' : 'sma200_dn');
  const mc = lastCross(m.line, m.signal, 2, L);
  if (mc) out.push(mc === 'up' ? 'macd_up' : 'macd_dn');
  return { price: c[L], changePct: (c[L] / c[L - 1] - 1) * 100, rsi: r[L], volRatio: avg20 ? v[L] / avg20 : null, signals: out };
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

export async function radar(symbols) {
  const list = (symbols?.length ? symbols : await universe.bist100()).map(normalize);
  const key = `radar:${list.join(',')}`;
  const cached = cacheGet(key, 15 * 60_000);
  if (cached) return cached;
  const rows = await pool(list, 8, async (s) => {
    try { const r = scanBars(await getHistory(s, '1y', '1d')); return r ? { symbol: s, ...r } : null; } catch { return null; }
  });
  const hits = rows.filter((r) => r && r.signals.length);
  const counts = Object.fromEntries(Object.keys(SIGNALS).map((k) => [k, hits.filter((h) => h.signals.includes(k)).length]));
  const result = { scanned: rows.filter(Boolean).length, at: Date.now(), labels: SIGNALS, counts, hits: hits.sort((a, b) => b.signals.length - a.signals.length) };
  cachePut(key, result);
  return result;
}

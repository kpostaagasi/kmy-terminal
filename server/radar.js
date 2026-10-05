// Sinyal radarı: günlük verilerden teknik tetikleyicileri tarar (BIST 100 varsayılan evren)
import { getHistory, normalize } from './market.js';
import * as universe from './universe.js';
import { cacheGet, cachePut } from './db.js';

import { SIGNALS, scanBars } from './sinyal-tanim.js';
export { SIGNALS, scanBars };

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

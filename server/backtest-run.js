// Sinyal geçmiş performansı: veri çekimi, kalıcılık, tek koşu. Hesap backtest.js'tedir (saf, çevrimdışı test edilir).
import { db } from './db.js';
import * as universe from './universe.js';
import { getHistory } from './market.js';
import { computeBacktest } from './backtest.js';

db.exec('CREATE TABLE IF NOT EXISTS backtest_result (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL, result TEXT NOT NULL)');

const RANGE = '10y';
let inflight = null;    // bekleyen çağrıların paylaştığı söz
let innerBusy = false;  // zaman aşımından sonra bile iç koşu bitene kadar true: iptal edilemeyen koşu varken yeni koşu çakışmasın

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** BIST100 + XU100 geçmişini çekip hesaplar. XU100 zorunlu; hisselerin yarısından azı gelirse hata. */
export async function compute() {
  const symbols = await universe.bist100();
  const series = [], failed = [];
  let bench;
  const [b] = await Promise.all([
    getHistory('XU100', RANGE, '1d'),
    pool(symbols, 8, async (s) => {
      try { series.push({ symbol: s, bars: await getHistory(s, RANGE, '1d') }); } catch { failed.push(s); }
    }),
  ]);
  bench = b;
  if (!bench?.length) throw new Error('XU100 geçmişi alınamadı');
  if (series.length < symbols.length / 2) throw new Error(`Hisse verisi yetersiz (${series.length}/${symbols.length})`);
  series.sort((a, c) => a.symbol.localeCompare(c.symbol));
  const result = computeBacktest({ series, bench });
  result.params.skipped = [...new Set([...result.params.skipped, ...failed])].sort();
  result.params.universe = 'BIST100';
  result.params.range = RANGE;
  return result;
}

const withTimeout = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('Geçmiş performans hesabı zaman aşımına uğradı')), ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

/** Kayıtlı son sonuç; hiç çalışmadıysa ya da kayıt bozuksa result: null. */
export function last() {
  const running = !!inflight || innerBusy;
  try {
    const row = db.prepare('SELECT at, result FROM backtest_result WHERE id = 1').get();
    if (row) return { at: Number(row.at), result: JSON.parse(row.result), running };
  } catch { /* bozuk kayıt: yok say */ }
  return { at: null, result: null, running };
}

/** Hesaplayıp kaydeder. Koşu sürerken gelen ikinci çağrı aynı koşuyu bekler; zaman aşımından sonra iç koşu bitene kadar yenisi başlamaz. */
export function run({ timeoutMs = 300_000, work = compute } = {}) {
  if (inflight) return inflight;
  if (innerBusy) return Promise.reject(new Error('Önceki hesap hâlâ sürüyor; biraz sonra yeniden deneyin'));
  const job = work();
  innerBusy = true;
  job.then(() => {}, () => {}).then(() => { innerBusy = false; });
  inflight = withTimeout(job, timeoutMs)
    .then((result) => {
      const at = Date.now();
      db.prepare('INSERT INTO backtest_result(id, at, result) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, result = excluded.result').run(at, JSON.stringify(result));
      return { at, result, running: false };
    })
    .finally(() => { inflight = null; });
  return inflight;
}

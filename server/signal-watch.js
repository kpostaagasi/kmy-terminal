// Sinyal bildirimi: seans kapandıktan sonra izleme listesi ve portföydeki BIST hisselerini tarar,
// yalnız YENİ çıkan sinyalleri bildirir (mantık: sinyal.js). Günlük mum kesinleştikten sonra günde bir kez çalışır.
import { db, getSettings } from './db.js';
import * as market from './market.js';
import * as store from './store.js';
import * as pf from './portfolio.js';
import { scanBars, SIGNALS } from './radar.js';
import { diffSignals, dueNow, DEFAULT_TYPES } from './sinyal.js';

db.exec(`
CREATE TABLE IF NOT EXISTS signal_state (symbol TEXT PRIMARY KEY, signals TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS signal_meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS signal_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL, signal TEXT NOT NULL, price REAL, change_pct REAL,
  fired_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_signal_log_at ON signal_log(fired_at DESC);
`);

const getMeta = (k) => db.prepare('SELECT v FROM signal_meta WHERE k = ?').get(k)?.v ?? null;
const setMeta = (k, v) => db.prepare('INSERT INTO signal_meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));

function istanbul() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

// İzlenen semboller: izleme listesi + portföy; yalnız BIST hisseleri (fon, altın, yabancı varlık taranmaz).
export function scope() {
  const syms = [...store.watchlist(), ...pf.computeLedger().holdings.map((h) => h.symbol)].map(market.normalize);
  return [...new Set(syms)].filter((s) => s && market.isBist(s));
}

export function enabledTypes() {
  const t = getSettings().signalTypes;
  return (Array.isArray(t) ? t : DEFAULT_TYPES).filter((k) => k in SIGNALS);
}

async function scanSymbols(symbols) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < symbols.length) {
      const s = symbols[i++];
      try {
        const r = scanBars(await market.getHistory(s, '1y', '1d'));
        if (r) out.push({ symbol: s, signals: r.signals, price: r.price, changePct: r.changePct });
      } catch { /* sembol bu turda taranamadı; önceki durumu korunur */ }
    }
  }));
  return out;
}

/** Taramayı çalıştırır, durumu ve kaydı yazar, yeni sinyalleri döndürür. Taramaların yarısından azı başarılıysa hata fırlatır (tekrar denenir). */
export async function scanNow() {
  const syms = scope();
  if (!syms.length) return [];
  const scanned = await scanSymbols(syms);
  if (scanned.length < Math.ceil(syms.length / 2)) throw new Error(`sinyal taraması başarısız (${scanned.length}/${syms.length})`);
  const prev = Object.fromEntries(db.prepare('SELECT symbol, signals FROM signal_state').all().map((r) => [r.symbol, JSON.parse(r.signals)]));
  const { fired, state } = diffSignals(prev, scanned, enabledTypes(), syms);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM signal_state');
    const ins = db.prepare('INSERT INTO signal_state(symbol, signals) VALUES(?, ?)');
    for (const [s, sig] of Object.entries(state)) ins.run(s, JSON.stringify(sig));
    const log = db.prepare('INSERT INTO signal_log(symbol, signal, price, change_pct) VALUES(?, ?, ?, ?)');
    for (const f of fired) log.run(f.symbol, f.signal, f.price, f.changePct);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return fired.map((f) => ({ ...f, label: SIGNALS[f.signal].label, dir: SIGNALS[f.signal].dir }));
}

let running = false;
/** Dakikalık döngüden çağrılır; zamanı gelmediyse hiçbir şey yapmaz. */
export async function tick(onFire) {
  if (running || !getSettings().signalNotify) return;
  const { date, hm } = istanbul();
  const attempt = Number(getMeta('attempt')) || null;
  if (!dueNow({ status: market.marketStatus(), hm, today: date, lastDone: getMeta('done'), lastAttempt: attempt, now: Date.now() })) return;
  running = true;
  setMeta('attempt', Date.now());
  try {
    const items = await scanNow();
    setMeta('done', date);
    if (items.length) onFire?.(items);
  } finally { running = false; }
}

/** Ayarlar ekranı için: tüm sinyal türleri (anahtar, etiket, yön). */
export const types = () => Object.entries(SIGNALS).map(([key, v]) => ({ key, ...v }));

/** Son `days` günün bildirimleri (yeniden eskiye). */
export function recent(days = 14) {
  const d = Math.min(Math.max(Number(days) || 14, 1), 90);
  return db.prepare(`SELECT symbol, signal, price, change_pct AS changePct, fired_at AS firedAt FROM signal_log
    WHERE fired_at >= datetime('now', ?) ORDER BY fired_at DESC, id DESC LIMIT 200`).all(`-${d} days`)
    .map((r) => ({ ...r, label: SIGNALS[r.signal]?.label || r.signal, dir: SIGNALS[r.signal]?.dir || 'neutral' }));
}

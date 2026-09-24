// SQLite katmanı (Node yerleşik node:sqlite). Tüm kalıcı veri tek dosyada: data/borsa.db
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, 'borsa.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY,
  sort INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS symbols (
  symbol TEXT PRIMARY KEY,
  name TEXT,
  sector TEXT,
  asset_type TEXT,
  currency TEXT
);
CREATE TABLE IF NOT EXISTS platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'TRY',
  notes TEXT
);
CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  platform_id INTEGER REFERENCES platforms(id) ON DELETE SET NULL,
  symbol TEXT,
  asset_type TEXT NOT NULL DEFAULT 'stock',
  type TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  fee REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TRY',
  fx_rate REAL NOT NULL DEFAULT 1,
  strategy_id INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_tx_symbol ON transactions(symbol);
CREATE INDEX IF NOT EXISTS ix_tx_date ON transactions(date);
CREATE TABLE IF NOT EXISTS snapshots (
  date TEXT PRIMARY KEY,
  value REAL NOT NULL,
  net_invested REAL,
  source TEXT NOT NULL DEFAULT 'auto'
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  op TEXT NOT NULL,
  value REAL NOT NULL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  triggered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  sdk_session_id TEXT,
  title TEXT,
  model TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_session ON chat_events(session_id, id);
CREATE TABLE IF NOT EXISTS http_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`);

// Şema göçleri (eski veritabanları için)
for (const sql of [
  "ALTER TABLE chat_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'",
  'ALTER TABLE transactions ADD COLUMN to_platform_id INTEGER REFERENCES platforms(id) ON DELETE SET NULL',
  'ALTER TABLE transactions ADD COLUMN to_currency TEXT',
  'ALTER TABLE transactions ADD COLUMN to_amount REAL',
  'ALTER TABLE symbols ADD COLUMN manual_price REAL',
  'ALTER TABLE symbols ADD COLUMN manual_price_at TEXT',
]) {
  try { db.exec(sql); } catch { /* sütun zaten var */ }
}

export const DEFAULT_SETTINGS = {
  provider: 'claude',
  model: '',
  codexModel: '',
  ompModel: '',
  effort: 'medium',
  permissionMode: 'default',
  chatFontSize: 14,
  terminalFontSize: 13,
  theme: 'dark',
  accent: '#facc15',
  quoteRefreshSec: 15,
  kapRefreshSec: 120,
  baseCurrency: 'TRY',
  riskFreeRate: 0.40,
  riskFreeSource: 'tlref',
  inboxEnabled: true,
  inboxDir: '',
  benchmark: 'XU100',
  benchmarks: ['XU100', 'USDTRY', 'GRAM', 'SPX_TRY', 'BTC_TRY'],
  dividendTaxRate: 0.15,
  uiMode: 'chat',
  language: 'auto', // 'auto' (sistem dili) | 'tr' | 'en'
};

export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[row.key] = JSON.parse(row.value); } catch { /* bozuk satır: varsayılanı koru */ }
  }
  return out;
}

export function putSettings(patch) {
  const stmt = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    stmt.run(k, JSON.stringify(v));
  }
  return getSettings();
}

export function cacheGet(key, maxAgeMs) {
  const row = db.prepare('SELECT value, fetched_at FROM http_cache WHERE key = ?').get(key);
  if (!row) return null;
  if (Date.now() - row.fetched_at > maxAgeMs) return null;
  return JSON.parse(row.value);
}

export function cachePut(key, value) {
  db.prepare('INSERT INTO http_cache(key, value, fetched_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at')
    .run(key, JSON.stringify(value), Date.now());
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// İlk açılışta örnek izleme listesi
if (db.prepare('SELECT COUNT(*) AS n FROM watchlist').get().n === 0 && !db.prepare("SELECT 1 FROM settings WHERE key = 'seeded'").get()) {
  const ins = db.prepare('INSERT INTO watchlist(symbol, sort) VALUES(?, ?)');
  ['THYAO', 'ASELS', 'GARAN', 'BIMAS', 'EREGL', 'FROTO', 'KCHOL', 'TUPRS'].forEach((s, i) => ins.run(s, i));
  db.prepare("INSERT INTO settings(key, value) VALUES('seeded', 'true')").run();
}

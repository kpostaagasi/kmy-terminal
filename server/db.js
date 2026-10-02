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
  -- 0.14.1: beyanname için ayrı sütunlar. fee = alış komisyonu, tax = satış stopajı,
  -- other_fee = banka işlem ücreti. Eski satırlarda fee stopajı da içeriyordu, DEFAULT 0 korur.
  tax REAL NOT NULL DEFAULT 0,
  other_fee REAL NOT NULL DEFAULT 0,
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
-- Temizlik yazma yolunda ORDER BY fetched_at ile yapar (cachePut → trimCache)
CREATE INDEX IF NOT EXISTS ix_cache_fetched ON http_cache(fetched_at);
CREATE TABLE IF NOT EXISTS tool_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  tool TEXT NOT NULL,
  session_id TEXT,
  via TEXT,
  mode TEXT,
  allowed INTEGER NOT NULL,
  reason TEXT
);
-- Kurum raporlarından çıkarılan hedef fiyat / tavsiye. research.js doldurur, rapor görünümü okur.
CREATE TABLE IF NOT EXISTS analyst_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broker TEXT NOT NULL,
  symbol TEXT NOT NULL,
  target REAL, rating TEXT, upside_pct REAL, report_date TEXT,
  source_id TEXT,                        -- research.js'in rapor kimliği
  UNIQUE(broker, symbol, report_date)
);
CREATE INDEX IF NOT EXISTS ix_targets_symbol ON analyst_targets(symbol, report_date DESC);
`);

// Şema göçleri (eski veritabanları için)
for (const sql of [
  "ALTER TABLE chat_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'",
  'ALTER TABLE transactions ADD COLUMN to_platform_id INTEGER REFERENCES platforms(id) ON DELETE SET NULL',
  'ALTER TABLE transactions ADD COLUMN to_currency TEXT',
  'ALTER TABLE transactions ADD COLUMN to_amount REAL',
  'ALTER TABLE symbols ADD COLUMN manual_price REAL',
  'ALTER TABLE symbols ADD COLUMN manual_price_at TEXT',
  'ALTER TABLE transactions ADD COLUMN tax REAL NOT NULL DEFAULT 0',
  'ALTER TABLE transactions ADD COLUMN other_fee REAL NOT NULL DEFAULT 0',
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
  // Yolo (bypassPermissions) bitiş damgası, ms cinsinden. 0 = süre yok (kullanıcı elle kapatır).
  // Bu anahtar tanımlı değilse putSettings sessizce düşürüyor ve otomatik kapanma hiç çalışmıyor.
  yoloUntil: 0,
  // Günlük ajan maliyet bütçesi (USD). 0 = sınır yok. costLimitEnforce true ise bütçe dolduğunda yeni tur reddedilir.
  dailyCostLimit: 0,
  costLimitEnforce: false,
  chatFontSize: 14,
  terminalFontSize: 13,
  theme: 'dark',
  accent: '#ff9f0a',
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
  sellTaxRate: 0.10, // BIST hisse satış stopajı (varsayılan %10)
  uiMode: 'chat',
  language: 'auto', // 'auto' (sistem dili) | 'tr' | 'en'
  // Sinyal bildirimi: seans sonrası taramada yeni çıkan sinyaller (server/sinyal.js, signal-watch.js)
  signalNotify: true,
  signalTypes: ['golden', 'death', 'high52', 'low52', 'sma200_up', 'sma200_dn'],
};

// 0.12: varsayılan imza rengi sarıdan turuncuya geçti; eski varsayılanı (#facc15) bir kez yeni varsayılana taşı
try {
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'accentMigrated'").get()) {
    db.prepare(`UPDATE settings SET value = '"#ff9f0a"' WHERE key = 'accent' AND value = '"#facc15"'`).run();
    db.prepare("INSERT INTO settings(key, value) VALUES('accentMigrated', 'true')").run();
  }
} catch { /* ayarlar tablosu yoksa sorun değil */ }

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

// http_cache tavanı: 300 satır / 50 MB. Temizlik yazma yolunda yapılır; okuma yolu (cacheGet) taramaz.
const CACHE_MAX_ROWS = 300, CACHE_MAX_BYTES = 50 * 1024 * 1024;
let cacheRows = -1, cacheBytes = -1;

export function cacheStats() {
  if (cacheRows < 0) {
    // LENGTH(TEXT) karakter sayar; ölçüm bayt olmalı (Türkçe karakterler 2 bayt)
    const r = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) AS b FROM http_cache').get();
    cacheRows = Number(r.n); cacheBytes = Number(r.b);
  }
  return { rows: cacheRows, bytes: cacheBytes };
}

export function cacheClear() {
  db.exec('DELETE FROM http_cache');
  cacheRows = 0; cacheBytes = 0;
}

function trimCache() {
  // En eskileri düşür: satır tavanı, sonra bayt tavanı (yeniden yazılan eski anahtarlar fazlalık yaratır)
  db.exec(`DELETE FROM http_cache WHERE key IN (SELECT key FROM http_cache ORDER BY fetched_at DESC LIMIT -1 OFFSET ${CACHE_MAX_ROWS})`);
  const rows = db.prepare('SELECT key, LENGTH(CAST(value AS BLOB)) AS b FROM http_cache ORDER BY fetched_at ASC').all();
  let bytes = rows.reduce((a, r) => a + Number(r.b), 0);
  for (const r of rows) {
    if (bytes <= CACHE_MAX_BYTES) break;
    db.prepare('DELETE FROM http_cache WHERE key = ?').run(r.key);
    bytes -= Number(r.b);
  }
  cacheRows = -1; cacheBytes = -1; // bir sonraki cacheStats ölçümü tazeler
}

export function cachePut(key, value) {
  const json = JSON.stringify(value);
  const prev = db.prepare('SELECT LENGTH(CAST(value AS BLOB)) AS b FROM http_cache WHERE key = ?').get(key);
  db.prepare('INSERT INTO http_cache(key, value, fetched_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at')
    .run(key, json, Date.now());
  cacheStats();
  cacheBytes += Buffer.byteLength(json) - (prev ? Number(prev.b) : 0);
  if (!prev) cacheRows++;
  if (cacheRows > CACHE_MAX_ROWS || cacheBytes > CACHE_MAX_BYTES) trimCache();
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

// Yedekleme: tablo kümesi sabit, sütun adları şemadan doğrulanır.
// Sütun adları doğrudan SQL'e gömülürse istemci `{"x); DROP TABLE ...;--":1}` ile tabloyu silebilir.
export const BACKUP_TABLES = ['settings', 'watchlist', 'symbols', 'platforms', 'strategies', 'transactions', 'snapshots', 'schedules'];

export function restoreBackup(tables) {
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) throw new Error('Geçersiz yedek dosyası');
  const unknown = Object.keys(tables).filter((k) => !BACKUP_TABLES.includes(k));
  if (unknown.length) throw new Error(`Yedek dosyasında bilinmeyen tablo: ${unknown.join(', ')}`);
  tx(() => {
    for (const t of [...BACKUP_TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
    for (const t of BACKUP_TABLES) {
      const rows = tables[t] || [];
      if (!Array.isArray(rows)) throw new Error(`${t} tablosu satır listesi değil`);
      const valid = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
      for (const row of rows) {
        if (!row || typeof row !== 'object') throw new Error(`${t}: geçersiz satır`);
        const cols = Object.keys(row);
        const bad = cols.filter((c) => !valid.has(c));
        if (bad.length) throw new Error(`${t} tablosunda şemada olmayan sütun: ${bad.join(', ')}`);
        db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
      }
    }
  });
  return { ok: true };
}

// İlk açılışta örnek izleme listesi
if (db.prepare('SELECT COUNT(*) AS n FROM watchlist').get().n === 0 && !db.prepare("SELECT 1 FROM settings WHERE key = 'seeded'").get()) {
  const ins = db.prepare('INSERT INTO watchlist(symbol, sort) VALUES(?, ?)');
  ['THYAO', 'ASELS', 'GARAN', 'BIMAS', 'EREGL', 'FROTO', 'KCHOL', 'TUPRS'].forEach((s, i) => ins.run(s, i));
  db.prepare("INSERT INTO settings(key, value) VALUES('seeded', 'true')").run();
}

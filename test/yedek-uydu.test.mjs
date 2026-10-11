// Yedek uydu tabloları geri yüklemeli. Geçici veritabanı; ağ yok.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'borsa-yedek-'));
process.env.BORSA_DATA_DIR = dir;

const { db, cachePut, restoreBackup, BACKUP_TABLES } = await import('../server/db.js');
cachePut('isy:all', { at: Date.now(), stocks: {}, actions: [] });
await import('../server/scheduler.js');
await import('../server/signal-watch.js');
await import('../server/denetim.js');
await import('../server/backtest-run.js');
await import('../server/dengeleme-kaynak.js');

const SAT = ['rebalance_targets', 'signal_state', 'signal_meta', 'signal_log', 'backtest_result', 'data_health'];

db.prepare("INSERT INTO rebalance_targets(kind, key, pct, cls) VALUES('symbol', 'THYAO', 40, 'stock')").run();
db.prepare("INSERT INTO signal_state(symbol, signals) VALUES('THYAO', '[\"golden\"]')").run();
db.prepare("INSERT INTO signal_meta(k, v) VALUES('done', '2026-10-07')").run();
db.prepare("INSERT INTO signal_log(symbol, signal, price, change_pct) VALUES('THYAO', 'golden', 320, 1.5)").run();
db.prepare("INSERT INTO backtest_result(id, at, result) VALUES(1, 1, '{\"ok\":1}')").run();
db.prepare("INSERT INTO data_health(id, at, results) VALUES(1, 2, '[]')").run();

const dump = {};
for (const t of BACKUP_TABLES) dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
for (const t of SAT) db.exec(`DELETE FROM ${t}`);
restoreBackup(dump);

for (const t of SAT) {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  assert.equal(n, 1, `${t} yedekten dönmedi`);
}
assert.equal(db.prepare("SELECT key FROM rebalance_targets").get().key, 'THYAO');
assert.equal(db.prepare("SELECT v FROM signal_meta").get().v, '2026-10-07');

db.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows: SQLite dosyası hâlâ açık (EBUSY); geçici dizin kalır */ }
console.log('ok yedek uydu');

// Güvenlik regresyon testi (npm test): yedek içe aktarımında SQL enjeksiyonu, terminal sahipliği, araç izin kapısı.
// Geçici veritabanında çalışır; gerçek data/borsa.db'ye dokunmaz. İnternet gerektirmez.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'borsa-guvenlik-'));
process.env.BORSA_DATA_DIR = dir;
const { db, cachePut, restoreBackup } = await import('../server/db.js');
cachePut('isy:all', { at: Date.now(), stocks: {}, actions: [] });
await import('../server/scheduler.js');
await import('../server/signal-watch.js');
await import('../server/denetim.js');
await import('../server/backtest-run.js');
await import('../server/dengeleme-kaynak.js');
const term = await import('../server/terminal.js');
const { authorizeTool, mintScopedToken, verifyScopedToken } = await import('../server/agent-tools.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.error(`  HATA ${name}: ${e.message}`); }
}
const throws = (fn) => assert.throws(fn, /./, 'hata fırlatmalıydı');

// ── 1. Yedek içe aktarımı: SQL enjeksiyonu ──────────────────
console.log('\nYedek içe aktarımı');
db.prepare("INSERT INTO platforms(id, name, currency) VALUES(1, 'Kurum A', 'TRY')").run();
db.prepare("INSERT INTO transactions(date, platform_id, symbol, type, quantity, price) VALUES('2025-01-02', 1, 'THYAO', 'buy', 10, 100)").run();

const tableExists = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const txCount = () => db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;

check('şema dışı sütun reddedilir', () => {
  throws(() => restoreBackup({ transactions: [{ 'x); DROP TABLE transactions;--': 1 }] }));
});
check('enjeksiyon sonrası tablo duruyor', () => {
  assert.equal(tableExists('transactions'), true);
  assert.equal(txCount(), 1, 'ROLLBACK eski satırları geri getirmeli');
});
check('sütun adına gömülü SQL reddedilir', () => {
  throws(() => restoreBackup({ transactions: [{ date: '2025-01-03', 'notes) VALUES(1,1,1,1,1,1,1,1,1,1,1,1,1);--': 'x' }] }));
  assert.equal(txCount(), 1);
});
check('bilinmeyen tablo anahtarı reddedilir', () => {
  throws(() => restoreBackup({ sqlite_master: [] }));
  throws(() => restoreBackup({ users: [{ id: 1 }] }));
});
check('geçersiz yedek gövdesi reddedilir', () => {
  throws(() => restoreBackup(null));
  throws(() => restoreBackup([]));
  throws(() => restoreBackup({ transactions: { date: '2025-01-03' } }));
});
check('geçerli yedek yüklenir', () => {
  restoreBackup({ platforms: [{ id: 1, name: 'Kurum B', currency: 'TRY' }], transactions: [{ date: '2025-02-03', symbol: 'ASELS', type: 'buy', quantity: 5, price: 200 }] });
  assert.equal(txCount(), 1);
  assert.equal(db.prepare('SELECT name FROM platforms').get().name, 'Kurum B');
  assert.equal(db.prepare('SELECT symbol FROM transactions').get().symbol, 'ASELS');
});

// ── 2. Terminal sahipliği ──────────────────────────────────
console.log('\nTerminal sahipliği');
if (!term.available()) {
  console.log('  atlandı (node-pty yok)');
} else {
  const A = 'client-a', B = 'client-b';
  const t = term.open({ owner: A, cols: 80, rows: 24 });
  check('sahibi eşleşiyor', () => assert.equal(term.owned(t.id, A), true));
  check('başka istemci sahibi olamaz', () => assert.equal(term.owned(t.id, B), false));
  check('sahipsiz istemci reddedilir', () => assert.equal(term.owned(t.id, null), false));
  check('bilinmeyen terminal reddedilir', () => assert.equal(term.owned('yok-boyle-bir-id', A), false));
  check('closeOwned yalnız sahibinin kabuğunu kapatır', () => {
    term.closeOwned(B);
    assert.equal(term.list().length, 1, 'başka istemcinin closeOwned çağrısı etkisiz olmalı');
    term.closeOwned(A);
    assert.equal(term.list().length, 0, 'sahibi kapandığında kabuk süreci de kapanmalı');
  });
}

// ── 3. Araç izin kapısı ───────────────────────────────────
console.log('\nAraç izin kapısı');
const READ = 'get_quotes'; // salt okunur
const WRITE = 'add_transaction'; // portföye yazar
const FILE = 'save_report'; // dosya sistemine yazar
const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

check('plan modunda yazma aracı reddedilir', () => {
  const v = authorizeTool(WRITE, { mode: 'plan' });
  assert.equal(v.allow, false);
  assert.equal(typeof v.reason, 'string');
});
check('yolo modunda her şey izinli, denetim kaydı açık', () => {
  const v = authorizeTool(WRITE, { mode: 'bypassPermissions' });
  assert.equal(v.allow, true);
  assert.equal(v.audit, true);
});
check('default modunda yazma aracı onay ister', () => {
  assert.equal(authorizeTool(WRITE, { mode: 'default' }).allow, false);
  assert.equal(authorizeTool(WRITE, {}).allow, false, 'varsayılan mod default');
});
check('default modunda dosya aracı onay ister, acceptEdits serbest bırakır', () => {
  assert.equal(authorizeTool(FILE, { mode: 'default' }).allow, false);
  assert.equal(authorizeTool(FILE, { mode: 'acceptEdits' }).allow, true);
  assert.equal(authorizeTool(FILE, { mode: 'plan' }).allow, false);
});
check('salt okunur araç her modda geçer', () => {
  for (const m of MODES) assert.equal(authorizeTool(READ, { mode: m }).allow, true, `mod ${m}`);
});
check('kapsamlı jeton kipi ve oturumu taşır, kurcalanmış jeton reddedilir', () => {
  const t = mintScopedToken({ sessionId: 's9', mode: 'plan' });
  assert.equal(verifyScopedToken(t).mode, 'plan');
  assert.equal(verifyScopedToken(t).sessionId, 's9');
  assert.equal(verifyScopedToken(t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')), null);
  assert.equal(verifyScopedToken('s.abc.def'), null);
  assert.equal(verifyScopedToken(''), null);
});

// ── 4. Denetim kaydı ───────────────────────────────────────
console.log('\nAraç denetim kaydı');
check('izin kapısı kararını tool_audit tablosuna yazar', () => {
  db.exec('DELETE FROM tool_audit');
  authorizeTool(WRITE, { mode: 'plan', sessionId: 's1', via: 'http' });
  authorizeTool(READ, { mode: 'plan', via: 'http' }); // salt okunur: kayıt yok
  authorizeTool(WRITE, { mode: 'bypassPermissions', sessionId: 's2', via: 'http' });
  const rows = db.prepare('SELECT * FROM tool_audit ORDER BY id DESC LIMIT 200').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tool, WRITE, 'en yeni kayıt önce');
  assert.equal(rows[0].allowed, 1);
  assert.equal(rows[0].session_id, 's2');
  assert.ok(rows[0].at, 'at dolu olmalı');
  assert.equal(rows[1].allowed, 0);
  assert.equal(rows[1].session_id, 's1');
  assert.equal(rows[1].mode, 'plan');
  assert.equal(rows[1].reason, 'plan modunda dosya/veri değiştirilemez');
});
check('temizleme kayıtları siler', () => {
  db.exec('DELETE FROM tool_audit');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tool_audit').get().n, 0);
});

console.log(`\n${pass}/${pass + fail} kontrol geçti`);
db.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows: SQLite dosyası hâlâ açık (EBUSY); geçici dizin kalır */ }
process.exit(fail ? 1 : 0);

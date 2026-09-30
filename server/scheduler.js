// Zamanlanmış ajan görevleri: belirli gün ve saatte bir istemi arka planda çalıştırır (İstanbul saati).
// Kullanıcı başında olmadığı için izin isteyen araçlar reddedilir (Claude: dontAsk, Codex: salt okunur).
import { db } from './db.js';
import * as market from './market.js';
import * as kap from './kap.js';

db.exec(`CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  time TEXT NOT NULL,
  days TEXT NOT NULL DEFAULT '1,2,3,4,5',
  provider TEXT NOT NULL DEFAULT 'claude',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run TEXT,
  last_session TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

export const TEMPLATES = [
  { name: 'Günlük kapanış raporu', time: '18:20', days: '1,2,3,4,5', prompt: 'Bugünkü BIST kapanışını özetleyen bir HTML rapor hazırla: endeksler, döviz/altın, en çok yükselen/düşen hisseler, sektör performansı, izleme listem ve portföyümdeki öne çıkan hareketler ve bugünkü önemli KAP bildirimleri. save_report ile kaydet.' },
  { name: 'Sabah KAP taraması', time: '09:30', days: '1,2,3,4,5', prompt: 'İzleme listem ve portföyümdeki hisselerin son 1 günlük KAP bildirimlerini tara, önem sırasına koy ve kısa bir HTML rapor olarak kaydet.' },
  { name: 'Haftalık portföy raporu', time: '18:40', days: '5', prompt: 'Portföyümün haftalık değerlendirmesini yap: haftalık getiri (XU100, USD/TL ve gram altın ile karşılaştırmalı), risk metrikleri, yoğunlaşma, temettü takvimi ve pozisyonlarımla ilgili haftanın KAP bildirimleri. HTML rapor olarak kaydet.' },
  { name: 'Sinyal radarı', time: '18:30', days: '1,2,3,4,5', prompt: 'signal_scan aracıyla BIST 100 sinyal taraması yap; izleme listemdeki hisselerde çıkan sinyalleri öne al, en dikkat çekici 10 sinyali kısa gerekçeleriyle HTML rapor olarak kaydet.' },
];

export function list() {
  return db.prepare('SELECT * FROM schedules ORDER BY time').all();
}

function validate(s) {
  if (!s.name?.trim()) throw new Error('Görev adı zorunlu');
  if (!s.prompt?.trim()) throw new Error('İstem zorunlu');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time || '')) throw new Error('Saat SS:DD biçiminde olmalı');
  const days = String(s.days || '').split(',').map((d) => d.trim()).filter((d) => /^[0-6]$/.test(d));
  if (!days.length) throw new Error('En az bir gün seçin');
  return { name: s.name.trim(), prompt: s.prompt.trim(), time: s.time, days: days.join(','), provider: s.provider === 'codex' ? 'codex' : 'claude', enabled: s.enabled === false || s.enabled === 0 ? 0 : 1 };
}

export function save(s) {
  const v = validate(s);
  if (s.id) db.prepare('UPDATE schedules SET name=?, prompt=?, time=?, days=?, provider=?, enabled=? WHERE id=?').run(v.name, v.prompt, v.time, v.days, v.provider, v.enabled, s.id);
  else s.id = Number(db.prepare('INSERT INTO schedules(name, prompt, time, days, provider, enabled) VALUES(?,?,?,?,?,?)').run(v.name, v.prompt, v.time, v.days, v.provider, v.enabled).lastInsertRowid);
  return db.prepare('SELECT * FROM schedules WHERE id = ?').get(s.id);
}

export function remove(id) { db.prepare('DELETE FROM schedules WHERE id = ?').run(id); }

function istanbulNow() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
  const pad = (n) => String(n).padStart(2, '0');
  return { day: String(d.getDay()), hm: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
}

export async function runNow(id, agent) {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
  if (!s) throw new Error('Görev bulunamadı');
  const { sessionId } = await agent.send({
    text: s.prompt, provider: s.provider,
    permissionMode: s.provider === 'codex' ? 'default' : 'dontAsk',
    title: `⏰ ${s.name}`,
  });
  db.prepare("UPDATE schedules SET last_run = datetime('now'), last_session = ? WHERE id = ?").run(sessionId, id);
  return { sessionId };
}

// ── Eşikler (fiyat · temettü · KAP) ────────────────────────
// op beyaz listesi. 'div' = son 12 ay nakit temettü toplamı (₺/hisse).
// 'kap' eşiğinde value son görülen KAP bildirim id'sidir; yeni bildirim gelince ilerler (doğal tekrar koruması).
export const ALERT_OPS = ['above', 'below', 'div', 'kap'];

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function listAlerts(symbol = null) {
  const s = symbol ? market.normalize(symbol) : null;
  return s
    ? db.prepare('SELECT * FROM alerts WHERE symbol = ? ORDER BY active DESC, id').all(s)
    : db.prepare('SELECT * FROM alerts ORDER BY active DESC, symbol, id').all();
}

export function removeAlert(id) {
  db.prepare('DELETE FROM alerts WHERE id = ?').run(Number(id));
  return { ok: true };
}

async function lastKapId(symbol) {
  const { items } = await kap.recent(7).catch(() => ({ items: [] }));
  return Math.max(0, ...items.filter((x) => (x.stocks || []).includes(symbol)).map((x) => x.id || 0));
}

export async function saveAlert(a) {
  const symbol = market.normalize(a.symbol);
  if (!symbol) throw new Error('Sembol zorunlu');
  if (!ALERT_OPS.includes(a.op)) throw new Error('Geçersiz eşik türü');
  const value = a.op === 'kap' ? await lastKapId(symbol) : Number(a.value);
  if (a.op !== 'kap' && !(Number.isFinite(value) && value > 0)) throw new Error('Eşik değeri pozitif bir sayı olmalı');
  const note = String(a.note || '').trim().slice(0, 200) || null;
  const active = a.active === false || a.active === 0 ? 0 : 1;
  if (a.id) db.prepare('UPDATE alerts SET symbol=?, op=?, value=?, note=?, active=?, triggered_at=NULL WHERE id=?').run(symbol, a.op, value, note, active, Number(a.id));
  else a.id = Number(db.prepare('INSERT INTO alerts(symbol, op, value, note, active) VALUES(?,?,?,?,?)').run(symbol, a.op, value, note, active).lastInsertRowid);
  return db.prepare('SELECT * FROM alerts WHERE id = ?').get(a.id);
}

// Dakikalık döngüde aktif eşikleri değerlendirir. Tetiklenen eşik kilitlenir (triggered_at),
// koşul bozulunca yeniden kurulur: art arda bildirim üretmez.
// BIST hisseleri seans dışında değerlendirilmez; döviz/altın 7/24 işlem görür.
export async function checkAlerts(fire) {
  const rows = db.prepare('SELECT * FROM alerts WHERE active = 1').all();
  if (!rows.length) return [];
  const fired = [];
  const latch = (r, hit) => {
    if (hit === !!r.triggered_at) return;
    const at = hit ? stamp() : null;
    db.prepare('UPDATE alerts SET triggered_at = ? WHERE id = ?').run(at, r.id);
    if (hit) fired.push({ ...r, triggered_at: at });
  };

  const open = market.marketStatus().open;
  const live = rows.filter((r) => (r.op === 'above' || r.op === 'below') && (open || !market.isBist(r.symbol)));
  if (live.length) {
    const q = await market.getQuotes(live.map((r) => r.symbol));
    for (const r of live) {
      const px = q[r.symbol]?.price;
      if (px == null) continue;
      latch(r, r.op === 'above' ? px >= r.value : px <= r.value);
    }
  }

  for (const r of rows.filter((x) => x.op === 'div')) {
    const d = await market.getDividends(r.symbol, '1y').catch(() => null);
    if (!d) continue;
    const since = Date.now() - 365 * 86400_000;
    latch(r, d.dividends.filter((x) => Date.parse(x.date) >= since).reduce((a, x) => a + (x.amount || 0), 0) >= r.value);
  }

  const kapRows = rows.filter((x) => x.op === 'kap');
  if (kapRows.length) {
    const { items } = await kap.recent(2).catch(() => ({ items: [] }));
    for (const r of kapRows) {
      const top = Math.max(0, ...items.filter((x) => (x.stocks || []).includes(r.symbol)).map((x) => x.id || 0));
      if (top <= r.value) continue;
      const at = stamp();
      db.prepare('UPDATE alerts SET triggered_at = ?, value = ? WHERE id = ?').run(at, top, r.id);
      fired.push({ ...r, value: top, triggered_at: at });
    }
  }

  for (const a of fired) { try { fire?.(a); } catch (e) { console.error('[eşik]', e.message); } }
  return fired;
}

// Dakikada iki kez kontrol; aynı gün ikinci kez çalıştırmaz
export function start(agent, onRun, onAlert) {
  let checking = false;
  setInterval(async () => {
    if (!checking) {
      checking = true;
      try { await checkAlerts(onAlert); } catch (e) { console.error('[eşikler]', e.message); } finally { checking = false; }
    }
    const now = istanbulNow();
    for (const s of list()) {
      if (!s.enabled || s.time !== now.hm || !s.days.split(',').includes(now.day)) continue;
      if (s.last_run && Date.now() - Date.parse(s.last_run.replace(' ', 'T') + 'Z') < 23 * 3600_000) continue;
      try { const r = await runNow(s.id, agent); onRun?.(s, r); } catch (e) { console.error('[zamanlayıcı]', s.name, e.message); }
    }
  }, 30_000);
}

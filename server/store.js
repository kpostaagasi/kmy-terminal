// İzleme listesi ve rapor dosyaları
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { normalize } from './market.js';
import { REPORTS_DIR } from './paths.js';

fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ── İzleme listesi ─────────────────────────────────────────
export function watchlist() {
  return db.prepare('SELECT symbol FROM watchlist ORDER BY sort, added_at').all().map((r) => r.symbol);
}
export function addWatch(symbol) {
  const s = normalize(symbol);
  if (!s) throw new Error('Sembol boş olamaz');
  const max = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM watchlist').get().m;
  db.prepare('INSERT OR IGNORE INTO watchlist(symbol, sort) VALUES(?, ?)').run(s, max + 1);
  return watchlist();
}
export function removeWatch(symbol) {
  db.prepare('DELETE FROM watchlist WHERE symbol = ?').run(normalize(symbol));
  return watchlist();
}
export function reorderWatch(symbols) {
  const st = db.prepare('UPDATE watchlist SET sort = ? WHERE symbol = ?');
  symbols.forEach((s, i) => st.run(i, normalize(s)));
  return watchlist();
}

// ── Raporlar ───────────────────────────────────────────────
const REPORT_EXT = new Set(['.html', '.htm', '.md', '.pdf', '.png', '.jpg', '.csv', '.xlsx', '.txt']);
const META_FILE = path.join(REPORTS_DIR, '.meta.json');

// Rapor etiketleri: { dosya: { broker, symbols, title, source } }
function readMeta() { try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return {}; } }
function writeMeta(m) { fs.writeFileSync(META_FILE, JSON.stringify(m, null, 1)); }
export function setReportMeta(name, { broker, symbols, title, source } = {}) {
  safeReportPath(name);
  const m = readMeta();
  const cur = m[name] || {};
  const norm = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,\s]+/)).map((x) => x.trim().toUpperCase()).filter(Boolean);
  m[name] = {
    ...cur,
    ...(broker !== undefined ? { broker: String(broker || '').trim() || null } : {}),
    ...(symbols !== undefined ? { symbols: norm(symbols) } : {}),
    ...(title !== undefined ? { title: String(title || '').trim() || null } : {}),
    ...(source !== undefined ? { source } : {}),
  };
  writeMeta(m);
  return m[name];
}

export function listReports() {
  const meta = readMeta();
  const out = [];
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(full, r);
      else if (REPORT_EXT.has(path.extname(e.name).toLowerCase())) {
        const st = fs.statSync(full);
        const m = meta[r] || {};
        const uploaded = r.startsWith(`yuklenen${path.sep}`) || r.startsWith('yuklenen/');
        out.push({
          name: r, title: m.title || titleOf(full, e.name), ext: path.extname(e.name).slice(1).toLowerCase(), size: st.size, mtime: st.mtimeMs,
          broker: m.broker || null, symbols: m.symbols || [], kind: uploaded || r.startsWith(`kurum${path.sep}`) || m.broker ? 'kurum' : 'ajan',
        });
      }
    }
  };
  walk(REPORTS_DIR);
  return out.sort((a, b) => b.mtime - a.mtime);
}

function titleOf(full, fallback) {
  try {
    const ext = path.extname(full).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
      const head = fs.readFileSync(full, 'utf8').slice(0, 4000);
      const m = /<title>([^<]+)<\/title>/i.exec(head);
      if (m) return m[1].trim();
    }
    if (ext === '.md') {
      const m = /^#\s+(.+)$/m.exec(fs.readFileSync(full, 'utf8').slice(0, 2000));
      if (m) return m[1].trim();
    }
  } catch { /* başlık okunamadı */ }
  return fallback;
}

export function safeReportPath(name) {
  const full = path.resolve(REPORTS_DIR, name);
  if (!full.startsWith(REPORTS_DIR + path.sep)) throw new Error('Geçersiz rapor yolu');
  return full;
}

export function deleteReport(name) {
  fs.rmSync(safeReportPath(name));
  const m = readMeta();
  if (m[name]) { delete m[name]; writeMeta(m); }
}

export function saveReport({ title, content, format = 'html', symbols = [] }) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const slug = String(title || 'rapor').toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[c]))
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'rapor';
  const ext = format === 'md' || format === 'markdown' ? 'md' : 'html';
  const name = `${stamp}-${slug}.${ext}`;
  let body = content;
  if (ext === 'html' && !/<html/i.test(content)) {
    body = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<meta name="symbols" content="${escapeHtml(symbols.join(','))}"><link rel="stylesheet" href="/report.css"></head><body><main class="report">${content}</main></body></html>`;
  }
  fs.writeFileSync(path.join(REPORTS_DIR, name), body);
  setReportMeta(name, { symbols, source: 'ajan' });
  return { name, title };
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// kmy terminal sunucusu: statik arayüz + REST API + WebSocket (canlı fiyat, ajan, terminal)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { ROOT, WEB_DIR, DATA_DIR, WORKSPACE_DIR, REPORTS_DIR } from './paths.js';
import { db, getSettings, putSettings } from './db.js';
import * as market from './market.js';
import * as kap from './kap.js';
import * as pf from './portfolio.js';
import * as store from './store.js';
import * as term from './terminal.js';
import { technicalSummary, indicatorSeries } from './indicators.js';
import { AgentManager, MODELS, CODEX_MODELS, EFFORTS, PERMISSION_MODES, PROVIDERS, providerModels } from './agent.js';
import { runTool, screen } from './agent-tools.js';
import { radar } from './radar.js';
import * as universe from './universe.js';
import * as scheduler from './scheduler.js';
import * as memory from './memory.js';
import * as documents from './documents.js';
import * as research from './research.js';
import * as feeds from './feeds.js';
import * as inbox from './inbox.js';
import * as gw from './gateway.js';

const PORT = gw.appPort(); // BORSA_PORT (veya PORT), varsayılan 7420
const REPORT_PORT = gw.reportPort(PORT); // BORSA_REPORT_PORT, varsayılan PORT+1; raporlar ayrı kökenden sunulur: rapor içindeki betikler uygulama API'sine erişemez
const HOST = process.env.HOST || '127.0.0.1';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const startedAt = Date.now();
const agent = new AgentManager();

// ── Yardımcılar ───────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.map': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.webmanifest': 'application/manifest+json',
};

// Tarayıcıya açılan node_modules dosyaları (derleme adımı yok)
const VENDOR = {
  'xterm.js': '@xterm/xterm/lib/xterm.js',
  'xterm.css': '@xterm/xterm/css/xterm.css',
  'addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js',
  'chart.js': 'chart.js/dist/chart.umd.min.js',
  'chartjs-adapter-date-fns.js': 'chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js',
  'marked.js': 'marked/lib/marked.umd.js',
  'purify.js': 'dompurify/dist/purify.min.js',
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body) || typeof body === 'string';
  res.writeHead(status, { 'Content-Type': isBuf ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}

function serveFile(res, file, extraHeaders = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Bulunamadı');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', ...extraHeaders });
    fs.createReadStream(file).pipe(res);
  });
}

async function readBody(req, limit = 20 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('İstek çok büyük'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  if ((req.headers['content-type'] || '').includes('application/json')) return JSON.parse(raw);
  return { text: raw };
}

// ── Yönlendirme ───────────────────────────────────────────
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/health', async () => ({
  ok: true, version: VERSION, node: process.version, platform: `${os.platform()} ${os.arch()}`, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  pid: process.pid, dataDir: DATA_DIR, workspace: WORKSPACE_DIR, terminal: term.available(), claudeCli: await cliVersion('claude'), codexCli: await cliVersion('codex'), ompCli: await cliVersion('omp'),
  clients: wss?.clients.size || 0, runningSessions: agent.running.size, market: market.marketStatus(),
  gateway: { daemon: gw.isDaemon(), pid: process.pid, startedAt: new Date(startedAt).toISOString(), port: PORT, reportPort: REPORT_PORT, activeSessions: agent.running.size, clients: wss?.clients.size || 0 },
}));
route('GET', '/api/meta', async () => ({
  reportPort: REPORT_PORT, providers: PROVIDERS, models: MODELS, codexModels: CODEX_MODELS, providerModels: providerModels(), efforts: EFFORTS, permissionModes: PERMISSION_MODES,
  txTypes: pf.TX_TYPES, txMeta: pf.TX_META, assetTypes: pf.ASSET_TYPES, currencies: pf.CURRENCIES, benchmarks: pf.reference().benchmarks,
  kapClasses: kap.CLASS_LABELS, kapSignals: kap.SIGNALS, indices: market.INDICES, indexNames: market.INDEX_NAMES,
  special: Object.fromEntries(Object.entries(market.SPECIAL).map(([k, v]) => [k, v.name])),
}));
// KOMİTE: workspace/.claude/agents altındaki alt ajan tanımları
route('GET', '/api/committee', async () => {
  const dir = path.join(WORKSPACE_DIR, '.claude', 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const head = fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
    const get = (k) => head.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim() || '';
    return { name: get('name') || f.slice(0, -3), description: get('description') };
  });
});
route('GET', '/api/settings', async () => getSettings());
route('PUT', '/api/settings', async ({ body }) => { const s = putSettings(body); broadcast({ t: 'settings', settings: s }); restartTimers(); return s; });

// Piyasa
route('GET', '/api/quotes', async ({ q }) => market.getQuotes((q.get('symbols') || '').split(',').filter(Boolean)));
route('GET', '/api/quote/:symbol', async ({ p }) => market.getQuote(p.symbol));
route('GET', '/api/history/:symbol', async ({ p, q }) => {
  const bars = await market.getHistory(p.symbol, q.get('range') || '1y', q.get('interval') || undefined);
  return { symbol: market.normalize(p.symbol), bars, indicators: q.get('ind') ? indicatorSeries(bars) : undefined };
});
route('GET', '/api/technical/:symbol', async ({ p }) => technicalSummary(await market.getHistory(p.symbol, '2y', '1d')));
route('GET', '/api/search', async ({ q }) => market.search(q.get('q')));
route('GET', '/api/news', async ({ q }) => market.news(q.get('q') || 'Borsa Istanbul'));
route('GET', '/api/dividends/:symbol', async ({ p }) => market.getDividends(p.symbol));
route('GET', '/api/market/overview', async () => ({ status: market.marketStatus(), items: await market.overview() }));
route('GET', '/api/market/movers', async () => market.movers());
route('GET', '/api/market/radar', async ({ q }) => radar((q.get('symbols') || '').split(',').filter(Boolean)));
route('POST', '/api/tools/:name', async ({ p, body }) => runTool(p.name, body, notifyUi));
route('GET', '/api/fundamentals/:symbol', async ({ p }) => market.fundamentals(p.symbol));
route('GET', '/api/corporate-actions', async ({ q }) => universe.corporateActions({ symbols: q.get('symbols') ? q.get('symbols').split(',').map(market.normalize) : null, from: q.get('from'), to: q.get('to') }));
route('GET', '/api/universe/status', async () => universe.status());
route('GET', '/api/screen', async ({ q }) => {
  const f = Object.fromEntries(q);
  for (const k of ['pe_min', 'pe_max', 'pb_max', 'ev_ebitda_max', 'mcap_min_mn', 'free_float_min', 'ret_ytd_min', 'ret_ytd_max', 'limit']) if (f[k] != null) f[k] = Number(f[k]);
  return screen({ limit: 50, ...f });
});
route('GET', '/api/market/indices', async () => Object.values(await market.getQuotes(market.INDICES)));

// İzleme listesi
route('GET', '/api/watchlist', async () => store.watchlist());
route('POST', '/api/watchlist', async ({ body }) => { const w = store.addWatch(body.symbol); broadcast({ t: 'watchlist', symbols: w }); return w; });
route('PUT', '/api/watchlist', async ({ body }) => { const w = store.reorderWatch(body.symbols || []); broadcast({ t: 'watchlist', symbols: w }); return w; });
route('DELETE', '/api/watchlist/:symbol', async ({ p }) => { const w = store.removeWatch(p.symbol); broadcast({ t: 'watchlist', symbols: w }); return w; });

// KAP
route('GET', '/api/kap', async ({ q }) => {
  const scope = q.get('scope') || 'watchlist';
  if (q.get('refresh') === '1') kap.forceRefresh();
  let symbols = null;
  if (scope === 'watchlist') symbols = store.watchlist();
  else if (scope === 'portfolio') symbols = pf.computeLedger().holdings.map((h) => h.symbol);
  else if (scope === 'symbol') symbols = [q.get('symbol')];
  return kap.disclosures({
    symbols, days: Number(q.get('days') || 3), cls: q.get('cls') || null, signal: q.get('signal') || null, q: q.get('q') || null,
    funds: q.get('funds') === '1', offset: Number(q.get('offset') || 0), limit: Math.min(Number(q.get('limit') || 100), 500),
  });
});
route('GET', '/api/kap/:id', async ({ p }) => kap.detail(p.id));
// KAP eki: Java sarmalı temizlenmiş dosya (uygulama içi PDF görüntüleyici). PDF ve görseller satır içi, diğerleri indirme olarak
route('GET', '/api/kap/file/:id', async ({ p, res }) => {
  const a = await kap.attachment(p.id);
  const inline = a.type === 'application/pdf' || a.type.startsWith('image/');
  send(res, 200, a.buf, { 'Content-Type': a.type, 'Content-Length': a.buf.length, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}` });
  return undefined;
});
route('POST', '/api/kap/file/:id/save', async ({ p, body }) => { const r = await documents.saveKapAttachment({ url: p.id, symbol: body.symbol, name: body.name }); broadcast({ t: 'documents.changed' }); return r; });

// Aracı kurum raporları (kurumların açık yayınları)
route('GET', '/api/research', async ({ q }) => research.list({
  days: q.get('days') != null ? Number(q.get('days')) : 30, broker: q.get('broker') || null, symbol: q.get('symbol') || null,
  q: q.get('q') || null, category: q.get('category') || null, scope: q.get('scope') || 'all', limit: Number(q.get('limit') || 100), offset: Number(q.get('offset') || 0),
}));
route('POST', '/api/research/refresh', async () => { const d = await research.refresh(true); return { at: d.at, count: d.items.length, status: d.status }; });
route('GET', '/api/research/file', async ({ q, res }) => {
  const { it, buf } = await research.fetchPdf(q.get('id'));
  send(res, 200, buf, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(`${it.title}.pdf`)}` });
  return undefined;
});
route('POST', '/api/inbox/scan', async () => inbox.scan({ force: true, notify: inboxNotify }));
route('GET', '/api/inbox', async () => inbox.settings());
route('POST', '/api/research/save', async ({ body }) => { const r = await research.save(body.id); broadcast({ t: 'reports.changed' }); return r; });

// Açık veri: ekonomi haberleri, TCMB kurları, TLREF, mali tablolar
route('GET', '/api/newsfeed', async ({ q }) => feeds.newsFeed({ symbol: q.get('symbol') || null, q: q.get('q') || null, sources: q.get('sources') ? q.get('sources').split(',') : null, limit: Number(q.get('limit') || 60) }));
route('GET', '/api/tcmb', async ({ q }) => feeds.tcmbRates(q.get('date') || null));
route('GET', '/api/tlref', async ({ q }) => ({ stats: await feeds.tlrefStats(q.get('from'), q.get('to')), last: (await feeds.tlrefHistory()).slice(-30) }));
route('GET', '/api/financials/:symbol', async ({ p, q }) => feeds.financials(p.symbol, Number(q.get('n') || 8)));

// Araştırma hafızası ve şirket belge arşivi
route('GET', '/api/memory', async () => memory.list());
route('GET', '/api/memory/:kind/:key', async ({ p }) => memory.get(p.kind === 'sirket' ? { symbol: p.key } : { topic: p.key }) || { empty: true });
route('DELETE', '/api/memory/:kind/:key', async ({ p }) => { const r = memory.remove(p.kind === 'sirket' ? { symbol: p.key } : { topic: p.key }); broadcast({ t: 'memory.changed' }); return r; });
route('GET', '/api/documents', async ({ q }) => documents.list(q.get('symbol') || null));
route('GET', '/api/documents/file', async ({ q, res }) => {
  const rel = String(q.get('path') || '');
  const file = path.resolve(WORKSPACE_DIR, rel);
  if (!file.startsWith(documents.DOCS_DIR + path.sep)) throw new Error('Geçersiz yol');
  const ext = path.extname(file).toLowerCase();
  const inline = ['.pdf', '.png', '.jpg', '.jpeg'].includes(ext);
  serveFile(res, file, { 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` });
  return undefined;
});

// Portföy
route('GET', '/api/portfolio', async () => pf.summary());
route('GET', '/api/portfolio/risk', async ({ q }) => pf.risk({ from: q.get('from') || null, to: q.get('to') || null }));
route('GET', '/api/portfolio/reference', async () => pf.reference());
route('GET', '/api/portfolio/dividends', async () => pf.dividendReport());
route('GET', '/api/transactions', async ({ q }) => pf.listTransactions({ symbol: q.get('symbol'), type: q.get('type'), platformId: q.get('platform'), strategyId: q.get('strategy'), from: q.get('from'), to: q.get('to'), limit: Number(q.get('limit') || 1000), offset: Number(q.get('offset') || 0) }));
route('POST', '/api/transactions', async ({ body }) => { const r = await pf.addTransaction(body); broadcast({ t: 'portfolio.changed' }); return r; });
route('PUT', '/api/transactions/:id', async ({ p, body }) => { const r = await pf.updateTransaction(Number(p.id), body); broadcast({ t: 'portfolio.changed' }); return r; });
route('DELETE', '/api/transactions/:id', async ({ p }) => { pf.deleteTransaction(Number(p.id)); broadcast({ t: 'portfolio.changed' }); return { ok: true }; });
route('GET', '/api/platforms', async () => pf.listPlatforms());
route('POST', '/api/platforms', async ({ body }) => pf.savePlatform(body));
route('DELETE', '/api/platforms/:id', async ({ p }) => { pf.deletePlatform(Number(p.id)); return { ok: true }; });
route('GET', '/api/strategies', async () => pf.listStrategies());
route('POST', '/api/strategies', async ({ body }) => pf.saveStrategy(body));
route('DELETE', '/api/strategies/:id', async ({ p }) => { pf.deleteStrategy(Number(p.id)); return { ok: true }; });
route('POST', '/api/symbols/:symbol', async ({ p, body }) => { pf.setSymbolMeta(p.symbol, body); return { ok: true }; });
route('GET', '/api/symbols', async () => db.prepare('SELECT * FROM symbols WHERE sector IS NOT NULL OR asset_type IS NOT NULL OR manual_price IS NOT NULL ORDER BY symbol').all());
route('POST', '/api/symbols/:symbol/price', async ({ p, body }) => { const r = pf.setManualPrice(p.symbol, body.price, body.date); broadcast({ t: 'portfolio.changed' }); return r; });
route('POST', '/api/import/csv/preview', async ({ body }) => pf.previewCsv(body.text || '', body.mapping || null));
route('POST', '/api/import/csv/commit', async ({ body }) => { const r = await pf.commitCsv(body.text || '', body.mapping || null); broadcast({ t: 'portfolio.changed' }); return r; });
route('POST', '/api/import/snapshots', async ({ body }) => { const r = pf.importSnapshots(body.text || ''); broadcast({ t: 'portfolio.changed' }); return r; });
route('GET', '/api/snapshots', async () => db.prepare('SELECT * FROM snapshots ORDER BY date').all());
route('DELETE', '/api/snapshots', async () => { db.exec("DELETE FROM snapshots WHERE source = 'import'"); return { ok: true }; });
route('POST', '/api/portfolio/reset', async ({ body }) => {
  if (body.confirm !== 'SIFIRLA') throw new Error('Onay metni hatalı');
  pf.resetPortfolio(); broadcast({ t: 'portfolio.changed' }); return { ok: true };
});

// Raporlar
route('GET', '/api/reports', async () => store.listReports());
route('PATCH', '/api/reports/meta', async ({ body }) => { const r = store.setReportMeta(String(body.name || ''), body); broadcast({ t: 'reports.changed' }); return r; });
route('DELETE', '/api/reports/:name', async ({ p }) => { store.deleteReport(decodeURIComponent(p.name)); broadcast({ t: 'reports.changed' }); return { ok: true }; });
route('POST', '/api/reports/upload', async ({ q, req }) => {
  const name = path.basename(q.get('name') || 'dosya.pdf').replace(/[^\w.\-çğıöşüÇĞİÖŞÜ ]/g, '_');
  const full = store.safeReportPath(`yuklenen/${name}`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const chunks = []; for await (const c of req) chunks.push(c);
  fs.writeFileSync(full, Buffer.concat(chunks));
  const rel = `yuklenen/${name}`;
  if (q.get('broker') || q.get('symbols')) store.setReportMeta(rel, { broker: q.get('broker') || null, symbols: q.get('symbols') || '' });
  broadcast({ t: 'reports.changed' });
  return { name: rel };
});

// Sohbet oturumları
route('GET', '/api/sessions', async () => agent.listSessions());
route('GET', '/api/sessions/:id', async ({ p }) => agent.getSession(p.id) || Promise.reject(new Error('Oturum bulunamadı')));
route('PATCH', '/api/sessions/:id', async ({ p, body }) => { agent.renameSession(p.id, String(body.title || '').slice(0, 120)); return { ok: true }; });
route('DELETE', '/api/sessions/:id', async ({ p }) => { agent.deleteSession(p.id); return { ok: true }; });
route('GET', '/api/schedules', async () => ({ items: scheduler.list(), templates: scheduler.TEMPLATES }));
route('POST', '/api/schedules', async ({ body }) => scheduler.save(body));
route('DELETE', '/api/schedules/:id', async ({ p }) => { scheduler.remove(Number(p.id)); return { ok: true }; });
route('POST', '/api/schedules/:id/run', async ({ p }) => scheduler.runNow(Number(p.id), agent));
route('GET', '/api/sessions/:id/export', async ({ p, res }) => {
  const s = agent.getSession(p.id);
  if (!s) throw new Error('Oturum bulunamadı');
  send(res, 200, JSON.stringify(s, null, 1), { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="sohbet-${p.id.slice(0, 8)}.json"` });
  return undefined;
});
route('POST', '/api/chat/upload', async ({ q, req }) => {
  const name = path.basename(q.get('name') || 'ek').replace(/[^\w.\-çğıöşüÇĞİÖŞÜ ]/g, '_').slice(0, 120);
  const rel = path.join('uploads', new Date().toISOString().slice(0, 10), `${Date.now().toString(36)}-${name}`);
  const full = path.join(WORKSPACE_DIR, rel);
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 10 * 1024 * 1024) throw new Error('Dosya çok büyük (en fazla 10 MB)'); chunks.push(c); }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.concat(chunks));
  return { path: rel, abs: full, name, size };
});
route('GET', '/api/jobs', async () => agent.backgroundJobs());
route('GET', '/api/changelog', async () => ({ text: fs.existsSync(path.join(ROOT, 'CHANGELOG.md')) ? fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8') : '' }));
route('GET', '/api/agent/connections', async () => agent.lastInit || null);
route('POST', '/api/agent/summarize', async ({ body }) => agent.summarize(body.text));
route('POST', '/api/system/restart', async () => restartServer());
route('GET', '/api/terminals', async () => term.list());

// Yedekleme
route('GET', '/api/export/transactions.csv', async ({ res }) => { send(res, 200, pf.exportCsv(), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="islemler.csv"' }); return undefined; });
route('GET', '/api/export/backup.json', async ({ res }) => {
  const dump = {};
  for (const t of ['settings', 'watchlist', 'symbols', 'platforms', 'strategies', 'transactions', 'snapshots', 'schedules']) dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
  send(res, 200, JSON.stringify({ version: VERSION, exportedAt: new Date().toISOString(), tables: dump }, null, 1), { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="kmy-terminal-yedek.json"' });
  return undefined;
});
route('POST', '/api/import/backup', async ({ body }) => {
  const tables = body.tables;
  if (!tables) throw new Error('Geçersiz yedek dosyası');
  const order = ['settings', 'watchlist', 'symbols', 'platforms', 'strategies', 'transactions', 'snapshots', 'schedules'];
  db.exec('BEGIN');
  try {
    for (const t of [...order].reverse()) db.exec(`DELETE FROM ${t}`);
    for (const t of order) {
      for (const row of tables[t] || []) {
        const cols = Object.keys(row);
        db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  broadcast({ t: 'portfolio.changed' }); broadcast({ t: 'watchlist', symbols: store.watchlist() });
  return { ok: true };
});
route('POST', '/api/cache/clear', async () => { db.exec('DELETE FROM http_cache'); return { ok: true }; });

// ── Gateway: servis durumu, erişim anahtarı, yeniden başlatma ──
// Servis modunda (BORSA_DAEMON=1) çıkış yeterli: launchd / systemd süreci yeniden başlatır. Elle modda kendini ayrık süreçle yeniden açar.
function restartServer() {
  const daemon = gw.isDaemon();
  setTimeout(() => {
    if (!daemon) {
      const log = fs.openSync(path.join(DATA_DIR, 'server.log'), 'a');
      spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], env: process.env }).unref();
    }
    for (const t of term.list()) term.close(t.id);
    process.exit(0);
  }, 400);
  return { ok: true, mode: daemon ? 'daemon' : 'manual', message: daemon ? 'Servis yöneticisi sunucuyu birkaç saniye içinde yeniden başlatacak' : 'Sunucu kendini yeniden başlatıyor' };
}
function gatewayStatus() {
  const t = gw.tokenInfo(), svc = gw.serviceInfo();
  return {
    running: true, daemon: gw.isDaemon(), pid: process.pid, startedAt: new Date(startedAt).toISOString(), uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    host: HOST, port: PORT, reportPort: REPORT_PORT, activeSessions: agent.running.size, clients: wss?.clients.size || 0,
    token: gw.mask(t.token), tokenCreatedAt: t.createdAt, tokenRotatedAt: t.rotatedAt, tokenFile: gw.TOKEN_FILE,
    service: { manager: svc.manager, label: svc.label, file: svc.file, installed: gw.serviceInstalled() }, logFile: gw.LOG_FILE, cli: gw.CLI,
  };
}
route('GET', '/api/gateway', async () => gatewayStatus());
route('GET', '/api/gateway/token', async () => ({ token: gw.token() })); // yalnız yetkili istemciye (Ayarlar › Göster / Kopyala)
route('POST', '/api/gateway/token/rotate', async ({ res }) => {
  gw.rotate();
  res.setHeader('Set-Cookie', gw.cookie()); // bu tarayıcı çalışmaya devam etsin
  // Eski anahtarla başlıktan bağlanmış harici WS istemcilerini düşür; tarayıcılar aynı kökenden çerezle bağlı kalır
  setTimeout(() => { for (const c of wss.clients) if (c.gwVia === 'header') c.close(4001, 'Anahtar yenilendi'); }, 200);
  return gatewayStatus();
});
route('POST', '/api/gateway/restart', async () => restartServer());
route('POST', '/api/gateway/stop', async () => {
  if (!gw.isDaemon()) throw new Error('Sunucu elle başlatıldı; arayüzden durdurulamaz. Başlattığınız terminalde Ctrl+C ile kapatın. Servis olarak kurmak için: ./bin/kmy gateway install');
  const managed = gw.serviceInstalled();
  setTimeout(() => {
    for (const t of term.list()) term.close(t.id);
    if (managed) gw.stopService(); else process.exit(0); // servis dosyası yoksa yeniden başlatan da yok
  }, 300);
  return { ok: true, message: 'Gateway servisi durduruluyor. Yeniden başlatmak için: ./bin/kmy gateway start' };
});

const cliVersions = {};
function cliVersion(bin) {
  if (cliVersions[bin]) return Promise.resolve(cliVersions[bin]);
  return new Promise((resolve) => execFile(bin, ['--version'], { timeout: 5000 }, (err, out) => { cliVersions[bin] = err ? null : out.trim(); resolve(cliVersions[bin]); }));
}

// Tarayıcıdaki başka sitelerin (ve rapor sayfalarının) yerel API'ye yazmasını engelle
const APP_HOSTS = gw.allowedHosts(PORT), REPORT_HOSTS = gw.allowedHosts(REPORT_PORT);
const ALLOWED_ORIGINS = gw.allowedOrigins(APP_HOSTS);
function originOk(req) {
  const o = req.headers.origin;
  return !o || ALLOWED_ORIGINS.has(o);
}

// ── HTTP sunucusu ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // DNS rebinding: yalnız 127.0.0.1 / localhost / [::1] Host başlığı
  if (!gw.hostOk(req, APP_HOSTS)) return send(res, 403, { error: 'Geçersiz Host başlığı' });
  const url = new URL(req.url, 'http://yerel');
  try {
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      if (!originOk(req) || gw.crossSite(req)) return send(res, 403, { error: 'Yasak köken' });
      if (!gw.authorize(req)) return send(res, 401, { error: 'Gateway anahtarı gerekli' });
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) && !/^\/api\/(reports|chat)\/upload/.test(url.pathname) ? await readBody(req) : {};
        const out = await r.handler({ req, res, p, q: url.searchParams, body });
        if (out !== undefined && !res.headersSent) send(res, 200, out ?? null);
        return;
      }
      return send(res, 404, { error: 'Uç nokta yok' });
    }
    if (pathname.startsWith('/vendor/')) {
      const rel = VENDOR[pathname.slice(8)];
      return rel ? serveFile(res, path.join(ROOT, 'node_modules', rel)) : send(res, 404, 'Bulunamadı');
    }
    const file = path.resolve(WEB_DIR, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(WEB_DIR)) return send(res, 403, 'Yasak');
    if (pathname === '/' || pathname === '/index.html') res.setHeader('Set-Cookie', gw.cookie()); // arayüz kabuğu: tarayıcıya erişim çerezi
    return serveFile(res, file);
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: e.message });
  }
});

// ── WebSocket ─────────────────────────────────────────────
const wss = new WebSocketServer({
  server, path: '/ws',
  verifyClient: ({ req }, cb) => {
    if (!gw.hostOk(req, APP_HOSTS) || !originOk(req)) return cb(false, 403, 'Yasak köken');
    const via = gw.authorize(req);
    if (!via) return cb(false, 401, 'Gateway anahtarı gerekli');
    req.gwVia = via;
    cb(true);
  },
});
const wsLog = []; // son 50 mesaj (Ayarlar > Mesaj Logu)

function logWs(dir, msg) {
  const t = msg.t || msg.type;
  if (t === 'term.data' || t === 'term.input' || t === 'agent' && ['delta', 'thinking.delta'].includes(msg.type)) return;
  wsLog.push({ at: Date.now(), dir, t, summary: JSON.stringify(msg).slice(0, 300) });
  if (wsLog.length > 50) wsLog.shift();
}

function broadcast(msg) {
  const s = JSON.stringify(msg);
  logWs('out', msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}

agent.on('event', (e) => {
  const msg = { t: 'agent', ...e };
  const s = JSON.stringify(msg);
  if (!['delta', 'thinking.delta'].includes(e.type)) logWs('out', { t: `agent.${e.type}`, sessionId: e.sessionId });
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
});
agent.on('jobs', () => broadcast({ t: 'jobs', jobs: agent.backgroundJobs() }));
function inboxNotify(items) {
  broadcast({ t: 'reports.changed' });
  broadcast({ t: 'inbox.imported', items });
}

function notifyUi(type, data) {
  if (type === 'watchlist.changed') broadcast({ t: 'watchlist', symbols: store.watchlist() });
  else broadcast({ t: type, ...data });
}
agent.on('notify', ({ type, data }) => notifyUi(type, data));

const onTermData = (id, data) => { const s = JSON.stringify({ t: 'term.data', id, data }); for (const c of wss.clients) if (c.readyState === 1) c.send(s); };
const onTermExit = (id, code) => broadcast({ t: 'term.exit', id, code });

wss.on('connection', (ws, req) => {
  ws.gwVia = req.gwVia;
  ws.send(JSON.stringify({ t: 'hello', version: VERSION, settings: getSettings(), jobs: agent.backgroundJobs(), terminals: term.list(), market: market.marketStatus() }));
  ws.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    logWs('in', m);
    const reply = (x) => ws.readyState === 1 && ws.send(JSON.stringify({ ...x, rid: m.rid }));
    try {
      switch (m.t) {
        case 'ping': reply({ t: 'pong', at: Date.now() }); break;
        case 'chat.send': reply({ t: 'chat.accepted', ...(await agent.send(m)) }); break;
        case 'chat.stop': reply({ t: 'chat.stopped', ok: agent.stop(m.sessionId) }); break;
        case 'perm.reply': reply({ t: 'perm.ack', ok: agent.replyPermission(m.sessionId, m.reqId, m.decision) }); break;
        case 'question.reply': reply({ t: 'question.ack', ok: agent.replyQuestion(m.sessionId, m.reqId, m.answers, !!m.skip) }); break;
        case 'term.open': reply({ t: 'term.opened', ...term.open({ owner: 'ui', cols: m.cols, rows: m.rows, command: m.command, cwd: m.cwd, onData: onTermData, onExit: onTermExit }) }); break;
        case 'term.attach': reply({ t: 'term.buffer', id: m.id, data: termBuffer(m.id) }); break;
        case 'term.input': term.write(m.id, m.data); break;
        case 'term.resize': term.resize(m.id, m.cols, m.rows); break;
        case 'term.close': term.close(m.id); break;
        case 'log.get': reply({ t: 'log', entries: wsLog }); break;
        default: reply({ t: 'error', message: `Bilinmeyen mesaj: ${m.t}` });
      }
    } catch (e) {
      reply({ t: 'error', message: e.message, for: m.t });
    }
  });
});

function termBuffer(id) {
  return term.bufferOf(id);
}

// ── Periyodik işler: canlı fiyat, KAP ───────────────────
let timers = [];
function restartTimers() {
  timers.forEach(clearInterval);
  const s = getSettings();
  timers = [
    setInterval(pushQuotes, Math.max(5, Number(s.quoteRefreshSec) || 15) * 1000),
    setInterval(pushKap, Math.max(60, Number(s.kapRefreshSec) || 120) * 1000),
    setInterval(() => broadcast({ t: 'market', market: market.marketStatus() }), 60_000),
  ];
}

async function pushQuotes() {
  if (!wss.clients.size) return;
  try {
    const syms = [...new Set([...store.watchlist(), ...market.OVERVIEW])];
    const quotes = await market.getQuotes(syms);
    broadcast({ t: 'quotes', quotes });
  } catch (e) {
    console.error('[quotes]', e.message);
  }
}

let lastKapTop = null;
async function pushKap() {
  if (!wss.clients.size) return;
  const r = await kap.recent(3).catch(() => null);
  const top = r?.items?.[0]?.id;
  if (top && top !== lastKapTop) {
    const watch = new Set([...store.watchlist(), ...pf.computeLedger().holdings.map((h) => h.symbol)]);
    const fresh = lastKapTop ? r.items.filter((x) => x.id > lastKapTop && x.stocks.some((s) => watch.has(s))) : [];
    lastKapTop = top;
    broadcast({ t: 'kap.updated', fresh });
  }
}

// Rapor sunucusu (ayrı port = ayrı köken)
// Rapor dosyaları gateway çerezi/anahtarı ister (çerez porta bağlı değil; uygulama iframe'leri aynı siteden gönderir).
// Arayüzün Markdown'ı çapraz köken fetch ile okuması çerezsiz gelir: uygulama kökeninden (Origin) gelen istek de kabul edilir.
const reportServer = http.createServer((req, res) => {
  if (!gw.hostOk(req, REPORT_HOSTS)) return send(res, 403, 'Geçersiz Host başlığı');
  const url = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*' }; // raporlar salt okunur; arayüz Markdown'ı fetch ile okur
  try {
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/report.css') return serveFile(res, path.join(WEB_DIR, 'report.css'), cors);
    if (pathname.startsWith('/reports/')) {
      if (!gw.authorize(req) && !ALLOWED_ORIGINS.has(req.headers.origin)) return send(res, 401, { error: 'Gateway anahtarı gerekli' });
      const file = store.safeReportPath(pathname.slice(9));
      if (url.searchParams.has('print') && /\.html?$/i.test(file) && fs.existsSync(file)) {
        const html = fs.readFileSync(file, 'utf8') + '<script>addEventListener("load",()=>setTimeout(print,300))</script>';
        return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
      }
      return serveFile(res, file, cors);
    }
    send(res, 404, 'Bulunamadı');
  } catch (e) { send(res, 400, e.message); }
});
// Yeniden başlatmada eski süreç portu bırakana kadar bekle
function listenWithRetry(srv, port, cb, tries = 40) {
  srv.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) setTimeout(() => listenWithRetry(srv, port, cb, tries - 1), 500);
    else { console.error(`Port ${port} kullanılamıyor:`, e.message); process.exit(1); }
  });
  srv.listen(port, HOST, cb);
}
gw.tokenInfo(); // ilk çalıştırmada data/gateway.json oluşur
if (gw.isDaemon()) gw.trimLog();
listenWithRetry(reportServer, REPORT_PORT);

listenWithRetry(server, PORT, () => {
  console.log(`\n  kmy terminal v${VERSION}${gw.isDaemon() ? ' (Gateway servisi)' : ''}\n  → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n  Veri: ${DATA_DIR}\n  Raporlar: ${REPORTS_DIR}\n  Gateway anahtarı: ${gw.TOKEN_FILE}\n`);
  restartTimers();
  scheduler.start(agent, (s) => broadcast({ t: 'schedule.ran', name: s.name }));
  // Kurum raporu akışını arka planda hazır tut (ilk açılışta beklemeyi önler)
  // Kurum raporu klasör izleme (Ayarlar › Veri'den açılır)
  setInterval(() => inbox.scan({ notify: inboxNotify }).catch((e) => console.error('[klasör izleme]', e.message)), 60_000);
  const warm = () => research.refresh().catch(() => {});
  setTimeout(warm, 5_000);
  setInterval(warm, 30 * 60_000);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const t of term.list()) term.close(t.id); process.exit(0); });

// kmy gateway: yerel API erişim anahtarı, Host/Origin denetimi ve servis (launchd / systemd) bilgileri.
// Sunucu (server/index.js), CLI (bin/kmy) ve stdio MCP köprüsü aynı modülü kullanır; dış bağımlılık yok.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, DATA_DIR } from './paths.js';

export const LABEL = 'com.kmyterminal.gateway'; // launchd etiketi
export const UNIT = 'kmy-gateway.service'; // systemd --user birimi
export const COOKIE = 'borsa_gw';
export const TOKEN_FILE = path.join(DATA_DIR, 'gateway.json');
export const LOG_FILE = path.join(DATA_DIR, 'logs', 'gateway.log');
export const CLI = path.join(ROOT, 'bin', 'kmy');

export const appPort = () => Number(process.env.BORSA_PORT || process.env.PORT || 7420);
export const reportPort = (p = appPort()) => Number(process.env.BORSA_REPORT_PORT || p + 1);
export const isDaemon = () => !!process.env.BORSA_DAEMON;

// ── Erişim anahtarı (data/gateway.json, 0600) ─────────────
let cache = null; // { token, createdAt, rotatedAt, stamp }
const newToken = () => crypto.randomBytes(32).toString('hex');
const valid = (t) => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t);

function write(j) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, TOKEN_FILE);
  const st = fs.statSync(TOKEN_FILE);
  return (cache = { ...j, stamp: `${st.mtimeMs}:${st.size}:${st.ino}` });
}

// Dosyayı okur (yoksa null); CLI dışarıdan yenilerse değişikliği mtime ile fark eder
export function readTokenInfo() {
  let st;
  try { st = fs.statSync(TOKEN_FILE); } catch { return null; }
  const stamp = `${st.mtimeMs}:${st.size}:${st.ino}`;
  if (cache?.stamp === stamp) return cache;
  try {
    const j = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (!valid(j.token)) return null;
    if (st.mode & 0o077) { try { fs.chmodSync(TOKEN_FILE, 0o600); } catch { /* salt okunur */ } }
    return (cache = { token: j.token, createdAt: j.createdAt || null, rotatedAt: j.rotatedAt || null, stamp });
  } catch { return null; }
}
export const readToken = () => readTokenInfo()?.token || null;

// Anahtar yoksa (ilk çalıştırma) veya bozuksa oluşturur
export function tokenInfo() {
  return readTokenInfo() || write({ token: newToken(), createdAt: new Date().toISOString(), rotatedAt: null });
}
export const token = () => tokenInfo().token;

export function rotate() {
  const old = tokenInfo();
  return write({ token: newToken(), createdAt: old.createdAt, rotatedAt: new Date().toISOString() }).token;
}

export const mask = (t) => (t ? `${t.slice(0, 4)}${'•'.repeat(8)}${t.slice(-4)}` : '');

// Tarayıcı çerezi: yalnız arayüz kabuğu (GET /) yüklenirken verilir; JS okuyamaz, başka siteden gönderilmez
export const cookie = (t = token()) => `${COOKIE}=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000`;

function same(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// İstekteki aday anahtarlar: Authorization: Bearer, x-gateway-token, borsa_gw çerezi
function candidates(req) {
  const h = req.headers, out = [];
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(h.authorization || '')?.[1];
  if (bearer) out.push([bearer, 'header']);
  if (h['x-gateway-token']) out.push([String(h['x-gateway-token']).trim(), 'header']);
  for (const part of String(h.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) out.push([part.slice(i + 1).trim(), 'cookie']);
  }
  return out;
}

// Yetkiliyse kaynağı ('cookie' | 'header'), değilse null döner
export function authorize(req) {
  const t = token();
  for (const [v, via] of candidates(req)) if (same(v, t)) return via;
  return null;
}

// ── DNS rebinding koruması: yalnız yerel Host / Origin ────
// BORSA_ALLOWED_HOSTS=ornek.local,192.168.1.5 → ek ad(lar) (ağdan erişim için; varsayılan kapalı)
export function allowedHosts(p) {
  const s = new Set([`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`]);
  for (const h of String(process.env.BORSA_ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    s.add(/:\d+$/.test(h) ? h : `${h}:${p}`);
  }
  return s;
}
export const allowedOrigins = (hosts) => new Set([...hosts].map((h) => `http://${h}`));
export const hostOk = (req, hosts) => hosts.has(String(req.headers.host || '').toLowerCase());

// Tarayıcı başka bir siteden (veya rapor sunucusundan) gelen isteği işaretlerse reddet
export const crossSite = (req) => ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']);

// ── Servis yöneticisi ─────────────────────────────────────
export function serviceInfo() {
  const plat = os.platform();
  if (plat === 'darwin') return { manager: 'launchd', label: LABEL, file: path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`) };
  if (plat === 'linux') return { manager: 'systemd', label: UNIT, file: path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user', UNIT) };
  return { manager: null, label: null, file: null };
}
export const serviceInstalled = () => { const f = serviceInfo().file; return !!f && fs.existsSync(f); };

// Servisi CLI üzerinden durdur (ayrık süreç: servis yöneticisi bu süreci kapatırken komut yarım kalmasın)
export function stopService() {
  spawn(process.execPath, [CLI, 'gateway', 'stop'], { cwd: ROOT, detached: true, stdio: 'ignore', env: { ...process.env, BORSA_DAEMON: '' } }).unref();
}

// Servis logu büyüdüyse başlangıçta döndür (launchd / systemd dosyayı ekleme kipinde açar)
export function trimLog(max = 10 * 1024 * 1024) {
  try {
    if (fs.statSync(LOG_FILE).size <= max) return;
    fs.copyFileSync(LOG_FILE, `${LOG_FILE}.1`);
    fs.truncateSync(LOG_FILE, 0);
  } catch { /* log yok */ }
}

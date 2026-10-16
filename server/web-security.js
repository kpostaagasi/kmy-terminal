// @ts-check
// Uygulama ve rapor sunucusu için güvenlik başlıkları + kısa ömürlü rapor jetonu.
import crypto from 'node:crypto';

/** Uygulama kabuğu (index.html) için sıkı CSP. reportHosts: rapor sunucusunun host:port kümesi. */
export function appCsp(reportHosts = []) {
  const rep = [...reportHosts].map((h) => `http://${h}`).join(' ');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // arayüz şablonlarında satır içi style öznitelikleri var
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ws: wss: ${rep}`.trim(),
    `frame-src 'self' blob: ${rep}`.trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Sunulan raporlar opak kökende çalışır: betik çalışabilir (yazdır vb.) ama çerez/depolama/uygulama API'si yok
export const REPORT_CSP = 'sandbox allow-scripts allow-popups allow-modals allow-downloads';

const TTL = 12 * 3600 * 1000;
/** Rapor okuma jetonu: gateway anahtarının HMAC'i; anahtar yenilenince geçersizleşir. */
export function mintReportToken(secret, now = Date.now(), ttl = TTL) {
  const e = String(now + ttl);
  return `r.${e}.${crypto.createHmac('sha256', secret).update(`report:${e}`).digest('hex')}`;
}
export function verifyReportToken(tok, secret, now = Date.now()) {
  const m = /^r\.(\d{10,16})\.([0-9a-f]{64})$/.exec(String(tok || ''));
  if (!m || Number(m[1]) <= now) return false;
  const want = crypto.createHmac('sha256', secret).update(`report:${m[1]}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(m[2], 'hex'));
}

/** CORS: yalnız uygulama kökenine izin (ACAO * yok). */
export function reportCors(origin, allowed) {
  const h = { Vary: 'Origin' };
  if (origin && allowed.has(origin))
    Object.assign(h, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'X-Report-Token',
      'Access-Control-Allow-Methods': 'GET',
    });
  return h;
}

// Güvenlik sertleştirmeleri: yolo süre sınırı, rapor jetonu, CORS, CSP, DOMPurify yedeği
import assert from 'node:assert/strict';
import { yoloActive, effectiveMode, normalizeYoloPatch, YOLO_DEFAULT_MS, YOLO_MAX_MS } from '../server/yolo.js';
import { appCsp, REPORT_CSP, mintReportToken, verifyReportToken, reportCors } from '../server/web-security.js';

const now = 1_800_000_000_000;
// yolo
assert.equal(yoloActive({ permissionMode: 'bypassPermissions', yoloUntil: 0 }, now), false, 'süresiz yolo etkin sayılmaz');
assert.equal(yoloActive({ permissionMode: 'bypassPermissions', yoloUntil: now + 1 }, now), true);
assert.equal(effectiveMode('bypassPermissions', { permissionMode: 'bypassPermissions', yoloUntil: now - 1 }, now), 'default');
assert.equal(effectiveMode('bypassPermissions', { permissionMode: 'default' }, now), 'default', 'istemci tek başına bypass açamaz');
assert.equal(effectiveMode('acceptEdits', {}, now), 'acceptEdits');
assert.equal(normalizeYoloPatch({ permissionMode: 'bypassPermissions' }, now).yoloUntil, now + YOLO_DEFAULT_MS);
assert.equal(normalizeYoloPatch({ permissionMode: 'bypassPermissions', yoloUntil: now + 99 * 3600e3 }, now).yoloUntil, now + YOLO_MAX_MS);
assert.equal(normalizeYoloPatch({ permissionMode: 'plan', yoloUntil: now + 5 }, now).yoloUntil, 0);
assert.deepEqual(normalizeYoloPatch({ theme: 'dark' }, now), { theme: 'dark' });
// rapor jetonu
const tok = mintReportToken('s3cret', now);
assert.equal(verifyReportToken(tok, 's3cret', now + 1000), true);
assert.equal(verifyReportToken(tok, 'other', now + 1000), false, 'anahtar yenilenince geçersiz');
assert.equal(verifyReportToken(tok, 's3cret', now + 13 * 3600e3), false, 'süresi dolar');
assert.equal(verifyReportToken('r.1.abc', 's3cret', now), false);
assert.equal(verifyReportToken(undefined, 's3cret', now), false);
// CORS
const allowed = new Set(['http://127.0.0.1:7420']);
assert.equal(reportCors('http://evil.example', allowed)['Access-Control-Allow-Origin'], undefined);
assert.equal(reportCors('http://127.0.0.1:7420', allowed)['Access-Control-Allow-Origin'], 'http://127.0.0.1:7420');
// CSP
const csp = appCsp(['127.0.0.1:7421']);
assert.match(csp, /script-src 'self'(;|$)/);
assert.doesNotMatch(csp, /unsafe-eval/);
assert.match(csp, /frame-src 'self' blob: http:\/\/127\.0\.0\.1:7421/);
assert.match(REPORT_CSP, /^sandbox /);
assert.doesNotMatch(REPORT_CSP, /allow-same-origin/);
// DOMPurify yoksa md() ham HTML basmaz
globalThis.window = { marked: { parse: (s) => s } };
globalThis.document = {
  documentElement: {},
  addEventListener() {},
  querySelector() {
    return null;
  },
};
globalThis.localStorage = {
  getItem() {
    return null;
  },
  setItem() {},
};
globalThis.location = { protocol: 'http:', host: 'x', hostname: 'x' };
try {
  const { md } = await import('../web/js/core.js');
  const out = md('<img src=x onerror=alert(1)>');
  assert.doesNotMatch(out, /<img/, 'DOMPurify yokken HTML kaçırılmalı');
} catch (e) {
  if (e.code === 'ERR_ASSERTION') throw e;
  // tarayıcı ortamı taklidi yetmezse kaynak düzeyinde doğrula
  const src = (await import('node:fs')).readFileSync(new URL('../web/js/core.js', import.meta.url), 'utf8');
  assert.match(src, /DOMPurify\.sanitize\([^)]*\)[^:]*: esc\(/);
}
console.log('✓ sertleştirme testleri geçti');

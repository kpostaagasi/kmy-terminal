// Güncelleme kontrolü: GitHub'daki en son yayımlanmış release'i kurulu sürümle karşılaştırır.
// Yalnız haber verir; hiçbir şey indirmez veya kurmaz. Ayarlardan (updateCheck) ya da KMY_NO_UPDATE_CHECK=1 ile kapatılır.
// "En son" = yayım tarihi en yeni olan taslak dışı release (eski 0.x numaralandırması semver'de daha büyük görünür).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, INSTALLED } from './paths.js';
import { canApply } from './update-apply.js';

export const REPO = 'kpostaagasi/kmy-terminal';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const TTL = 6 * 3600 * 1000;

// "v0.1.0-beta.2" → { core: [0,1,0], pre: ['beta', 2] }; geçersizse null
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(v || '').trim());
  if (!m) return null;
  return { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.').map((x) => (/^\d+$/.test(x) ? +x : x)) : [] };
}

// semver önceliği: a > b → 1, a < b → -1, eşit → 0 (ön sürüm, aynı çekirdekli normal sürümden küçüktür)
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i] ? 1 : -1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p > q ? 1 : -1;
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p > q ? 1 : -1;
  }
  return 0;
}

// Kurulum biçimi: güncellemenin nasıl yapılacağını belirler
export function installKind(root = ROOT, installed = INSTALLED, env = process.env, exists = fs.existsSync) {
  if (/\.app[\\/]Contents[\\/]/.test(root)) return 'dmg';
  if (env.APPIMAGE || /[\\/]\.mount_/.test(root)) return 'appimage';
  if (exists(path.join(root, '..', 'kmy-terminal.cmd'))) return 'exe'; // NSIS kurulumu: <kurulum>\app yanında başlatıcı
  if (/[\\/]_npx[\\/]/.test(root)) return 'npx';
  if (!installed) return 'git';
  return 'paket';
}

const ASSET = { darwin: /\.dmg$/i, win32: /-setup\.exe$/i, linux: /\.AppImage$/i };

// releases: GitHub API yanıtı. Güncelleme yoksa available: false.
export function pickUpdate(releases, current, platform = process.platform) {
  const list = (Array.isArray(releases) ? releases : []).filter((r) => r && !r.draft && r.published_at && parseVersion(r.tag_name));
  list.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  const r = list[0];
  if (!r) return { current, latest: null, available: false };
  const latest = String(r.tag_name).replace(/^v/, '');
  const asset = (r.assets || []).find((a) => ASSET[platform]?.test(a.name));
  return {
    current, latest, available: compareVersions(latest, current) > 0,
    name: r.name || r.tag_name, url: r.html_url, assetUrl: asset?.browser_download_url || null, publishedAt: r.published_at,
    notes: String(r.body || '').slice(0, 20000), // sürüm notları (changelog), arayüzde Markdown olarak güvenli biçimde gösterilir
    assets: (r.assets || []).map((a) => ({ name: a.name, browser_download_url: a.browser_download_url, size: a.size })),
  };
}

export function enabled(settings = {}, env = process.env) {
  return settings.updateCheck !== false && !/^(1|true|yes)$/i.test(env.KMY_NO_UPDATE_CHECK || '');
}

let cached = null; // { at, result }
export async function check(current, settings, { force = false } = {}) {
  if (!enabled(settings)) return { current, available: false, disabled: true };
  if (!force && cached && Date.now() - cached.at < TTL) return cached.result;
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `kmy-terminal/${current}` }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const base = { ...pickUpdate(await res.json(), current), kind: installKind() };
    const result = { ...base, oneClick: base.available && canApply(base, base.kind), checkedAt: new Date().toISOString() };
    cached = { at: Date.now(), result };
    return result;
  } catch (e) {
    // Çevrimdışıyken sessizce geç; bir sonraki istekte yeniden dener
    return { current, available: false, error: e.message };
  }
}

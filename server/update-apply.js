// Tek tıkla güncelleme (sunucu / tarayıcı kurulumu): imzalı paketi indirir, doğrular, ayrı klasöre
// kurar ve "etkin sürüm" işaretçisini yazar. Mevcut kurulum hiç değiştirilmez: geri dönmek için
// DATA_DIR/updates/active.json silinir. Açılışta server/boot-redirect.js etkin sürüme geçer.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DATA_DIR } from './paths.js';
import { trustedUrl, verifyPackage } from './update-verify.js';
import { publicKey } from './update-key.js';

export const UPDATES_DIR = path.join(DATA_DIR, 'updates');
export const ACTIVE_FILE = path.join(UPDATES_DIR, 'active.json');
export const pkgName = (v) => `kmy-terminal-${v}.tgz`;

/** Bu sürüm tek tıkla kurulabilir mi? (imza anahtarı + gerekli dosyalar) */
export function canApply(release, kind, pub = publicKey()) {
  if (!pub || !['git', 'paket', 'npx'].includes(kind)) return false;
  const names = new Set((release?.assets || []).map((a) => a.name));
  return names.has(pkgName(release.latest)) && names.has('SHA256SUMS') && names.has('SHA256SUMS.sig');
}

async function get(url, fetchImpl) {
  if (!trustedUrl(url)) throw new Error(`Güvenilmeyen indirme adresi: ${url}`);
  const res = await fetchImpl(url, { redirect: 'follow', headers: { 'User-Agent': 'kmy-terminal-updater', Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`İndirme başarısız (${res.status})`);
  if (res.url && !trustedUrl(res.url)) throw new Error('Yönlendirme güvenilmeyen adrese gitti');
  return Buffer.from(await res.arrayBuffer());
}

/** release: guncelleme.check() sonucu (assets dahil). */
export async function apply(release, { fetchImpl = fetch, pub = publicKey(), dir = UPDATES_DIR, install = true } = {}) {
  const v = String(release.latest || '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)) throw new Error('Geçersiz sürüm');
  const url = (n) => release.assets.find((a) => a.name === n)?.browser_download_url;
  const name = pkgName(v);
  const [sums, sig, file] = await Promise.all([get(url('SHA256SUMS'), fetchImpl), get(url('SHA256SUMS.sig'), fetchImpl), get(url(name), fetchImpl)]);
  verifyPackage({ sums: sums.toString('utf8'), sig: sig.toString('utf8'), file, name, pubPem: pub });

  const target = path.join(dir, v);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  const tgz = path.join(dir, name);
  fs.writeFileSync(tgz, file);
  // npm pack biçimi: package/ öneki atılır; mutlak yol ve .. içeren girdiler tar tarafından reddedilir
  const t = spawnSync('tar', ['-xzf', tgz, '-C', target, '--strip-components=1', '--no-same-owner'], { stdio: 'pipe' });
  if (t.status !== 0) throw new Error(`Paket açılamadı: ${t.stderr}`);
  if (!fs.existsSync(path.join(target, 'server', 'index.js'))) throw new Error('Paket içeriği beklenen yapıda değil');
  if (install) {
    const n = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: target, stdio: 'pipe', shell: process.platform === 'win32' });
    if (n.status !== 0) throw new Error(`Bağımlılıklar kurulamadı: ${String(n.stderr).slice(-400)}`);
  }
  fs.rmSync(tgz, { force: true });
  fs.writeFileSync(path.join(dir, 'active.json'), JSON.stringify({ version: v, dir: target, at: new Date().toISOString() }));
  return { ok: true, version: v, dir: target };
}

// Klasör çözümlemesi tek kaynaktadır; sunucu, CLI ve macOS uygulaması aynı sırayı izler.
// Veri: BORSA_DATA_DIR → macOS'ta ~/Library/Application Support/kmy terminal/data → depodaki data/
// Böylece DMG'den kurulan uygulama ile `npm start` aynı veritabanını görür.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Paket olarak kurulduysa (npx / npm i -g: ROOT node_modules içinde) Linux ve Windows'ta da kullanıcı veri dizini kullanılır;
// aksi hâlde (git klonu) eski davranış: depodaki data/ ve workspace/.
export const INSTALLED = /[\\/]node_modules[\\/]/.test(ROOT);
export function appDirFor(platform = process.platform, env = process.env, home = os.homedir(), installed = INSTALLED) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'kmy terminal');
  if (!installed) return null;
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'kmy terminal');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'kmy-terminal');
}
export const APP_DIR = appDirFor();

const say = (m) => console.log(`  ${m}`);
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const tablesOf = (f) => {
  try {
    const d = new DatabaseSync(f, { readOnly: true });
    const n = d.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c;
    d.close();
    return n;
  } catch { return 0; }
};

// SQLite dosyasını doğrulayarak taşır: kopyala → boyut ve tablo sayısını karşılaştır → kaynağı sil.
// Doğrulama başarısızsa hiçbir şey silinmez, eski dosya yerinde kalır.
function moveDb(src, dst) {
  const sidecars = ['-shm', '-wal'].map((s) => src + s).filter(isFile);
  const rm = (f) => { try { fs.rmSync(f, { force: true }); } catch { /* yoksay */ } };
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    if (fs.statSync(dst).size !== fs.statSync(src).size) throw new Error('boyut uyuşmuyor');
    for (const s of sidecars) fs.copyFileSync(s, dst + s.slice(src.length));
    if (!tablesOf(dst) || tablesOf(dst) !== tablesOf(src)) throw new Error('tablo sayısı uyuşmuyor');
  } catch (e) {
    rm(dst);
    for (const s of sidecars) rm(dst + s.slice(src.length));
    say(`! Veri taşınamadı, eski dosya yerinde bırakıldı: ${src} (${e.message})`);
    return false;
  }
  rm(src);
  for (const s of sidecars) rm(s);
  return true;
}

// Eski (depo) konumdaki borsa.db'yi uygulama dizinine taşır; hedefte zaten varsa hiçbir şey yapılmaz.
function migrateDb(srcDir, dstDir) {
  if (isFile(path.join(dstDir, 'borsa.db'))) return false;
  if (!moveDb(path.join(srcDir, 'borsa.db'), path.join(dstDir, 'borsa.db'))) return false;
  // Erişim anahtarı da birlikte taşınır (yoksa hedefte yenisi üretilir)
  const tok = path.join(srcDir, 'gateway.json');
  if (isFile(tok) && !isFile(path.join(dstDir, 'gateway.json'))) {
    try { fs.copyFileSync(tok, path.join(dstDir, 'gateway.json')); fs.rmSync(tok); } catch { /* yoksay */ }
  }
  return true;
}

// Klasör çözümlemesi: ortam değişkeni > uygulama dizini > depo (taşıma gerekirse bir kez yapılır).
function resolveDir(env, name) {
  if (process.env[env]) return { dir: process.env[env], why: env };
  const repo = path.join(ROOT, name);
  if (!APP_DIR) return { dir: repo, why: 'depo' };
  const app = path.join(APP_DIR, name);
  if (isDir(app)) {
    const moved = name === 'data' && migrateDb(repo, app);
    return { dir: app, why: moved ? 'uygulama dizini (veri taşındı)' : 'uygulama dizini' };
  }
  if (name === 'data') {
    if (migrateDb(repo, app)) return { dir: app, why: 'uygulama dizini (veri taşındı)' };
  } else if (isDir(repo)) {
    // Çalışma alanı: uygulama dizini yokken depodaki workspace/ taşınır
    try {
      fs.mkdirSync(APP_DIR, { recursive: true });
      fs.renameSync(repo, app);
      return { dir: app, why: 'uygulama dizini (çalışma alanı taşındı)' };
    } catch (e) { say(`! Çalışma alanı taşınamadı (${e.message}); depodaki workspace/ kullanılıyor`); }
  }
  return { dir: repo, why: 'depo' };
}

const data = resolveDir('BORSA_DATA_DIR', 'data');
export const DATA_DIR = data.dir;
export const WORKSPACE_DIR = resolveDir('BORSA_WORKSPACE_DIR', 'workspace').dir;
export const REPORTS_DIR = path.join(WORKSPACE_DIR, 'reports');
export const WEB_DIR = path.join(ROOT, 'web');

// Hangi kuralın seçildiği tek satırda (yalnız sunucu açılışında; CLI kendi durum satırını yazar)
if (/(^|[\\/])server[\\/]index\.js$/.test(process.argv[1] || '')) console.log(`  Veri dizini: ${DATA_DIR} (${data.why})`);

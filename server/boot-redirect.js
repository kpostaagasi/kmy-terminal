// Açılışta, doğrulanıp kurulmuş daha yeni bir sürüm varsa sunucuyu oradan başlatır.
// server/index.js'in İLK içe aktarımıdır; diğer modüller yüklenmeden çalışır.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, DATA_DIR } from './paths.js';
import { compareVersions } from './guncelleme.js';

export function pickActive(activeFile, root, current, exists = fs.existsSync, read = (f) => fs.readFileSync(f, 'utf8')) {
  if (!exists(activeFile)) return null;
  try {
    const a = JSON.parse(read(activeFile));
    const entry = path.join(a.dir, 'server', 'index.js');
    if (path.resolve(a.dir) === path.resolve(root) || !exists(entry)) return null;
    return compareVersions(a.version, current) > 0 ? { ...a, entry } : null;
  } catch { return null; }
}

if (!/^(1|true)$/i.test(process.env.KMY_NO_UPDATE_APPLY || '')) {
  let current = '0.0.0';
  try { current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { /* yok */ }
  const a = pickActive(path.join(DATA_DIR, 'updates', 'active.json'), ROOT, current);
  if (a) {
    console.log(`  Güncellenmiş sürüm başlatılıyor: ${a.version}`);
    const r = spawnSync(process.execPath, [a.entry, ...process.argv.slice(2)], { cwd: a.dir, stdio: 'inherit', env: { ...process.env, KMY_BOOT_REDIRECTED: '1' } });
    process.exit(r.status ?? 1);
  }
}

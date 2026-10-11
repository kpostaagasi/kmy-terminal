// Çapraz platform postinstall: node-pty spawn-helper'ı çalıştırılabilir yapar (yalnız macOS/Linux). Hata kurulumu durdurmaz.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
if (process.platform !== 'win32') {
  // node-pty npx / npm i -g ile üst node_modules'a taşınmış olabilir: Node çözümlemesiyle bul.
  let dir = path.join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds');
  try { dir = path.join(path.dirname(createRequire(path.join(process.cwd(), 'package.json')).resolve('node-pty/package.json')), 'prebuilds'); } catch { /* yok */ }
  try {
    for (const d of fs.readdirSync(dir)) {
      const f = path.join(dir, d, 'spawn-helper');
      try { fs.chmodSync(f, 0o755); } catch { /* yok */ }
    }
  } catch { /* node-pty yok ya da prebuild yok: gömülü terminal kapalı kalır */ }
}

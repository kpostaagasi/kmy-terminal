// Çapraz platform postinstall: node-pty spawn-helper'ı çalıştırılabilir yapar (yalnız macOS/Linux). Hata kurulumu durdurmaz.
import fs from 'node:fs';
import path from 'node:path';
if (process.platform !== 'win32') {
  const dir = path.join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds');
  try {
    for (const d of fs.readdirSync(dir)) {
      const f = path.join(dir, d, 'spawn-helper');
      try { fs.chmodSync(f, 0o755); } catch { /* yok */ }
    }
  } catch { /* node-pty yok ya da prebuild yok: gömülü terminal kapalı kalır */ }
}

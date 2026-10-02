// Canlı çapraz kaynak denetimi: uygulamanın gösterdiği veriyi bağımsız ikinci kaynakla karşılaştırır.
// Kullanım: npm run denetim [-- --portfoy] [-- --json]
// Çıkış: 0 temiz · 1 SAPMA var · 2 hiçbir şey doğrulanamadı. Gerçek veriye yazmaz.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);

// Evre 1: kendini geçici veri klasörüyle yeniden başlat (sunucu modülleri veritabanını içe aktarırken açar).
// --portfoy: gerçek veritabanının KOPYASI üzerinde çalışılır; özgün dosyaya dokunulmaz.
if (!process.env.DENETIM_ALT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmy-denetim-'));
  if (flag('--portfoy')) {
    const { DATA_DIR } = await import('../server/paths.js');
    for (const ek of ['', '-wal', '-shm']) {
      const src = path.join(DATA_DIR, `borsa.db${ek}`);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, `borsa.db${ek}`));
    }
  }
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: 'inherit', env: { ...process.env, BORSA_DATA_DIR: tmp, DENETIM_ALT: '1' } });
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(r.status ?? 2);
}

// Evre 2: kontroller (server/denetim.js; arayüzdeki "Veri sağlığı" rozeti de aynı fonksiyonu kullanır).
const K = await import('../server/denetim-cekirdek.js');
const { runChecks } = await import('../server/denetim.js');
const sonuc = await runChecks({ portfoy: flag('--portfoy') });

console.log(flag('--json') ? JSON.stringify(sonuc, null, 2) : K.rapor(sonuc));
process.exit(K.cikisKodu(sonuc));

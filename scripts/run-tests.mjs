// Çapraz platform test çalıştırıcı (Windows'ta $(mktemp -d) yok). Sırayla çalışır, ilk hatada durur.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const TESTS = [
  'portfoy.test.mjs', 'guvenlik.test.mjs', 'arama.test.mjs', 'simulasyon.mjs', 'denetim.test.mjs', 'hedef.test.mjs', 'sinyal.test.mjs',
  'takvim.test.mjs', 'radar.test.mjs', 'seri.test.mjs', 'backtest.test.mjs', ['backtest-run.check.mjs', true], 'dengeleme.test.mjs',
  ['dengeleme-kaynak.check.mjs', true], 'yedek-uydu.test.mjs', 'fon-ayrim.test.mjs', 'sohbet-plan.test.mjs', 'platform.test.mjs', 'veri-kaynagi.test.mjs', ['guncelleme.test.mjs', true], 'sertlestirme.test.mjs',
];
for (const tst of TESTS) {
  const [file, tmp] = Array.isArray(tst) ? tst : [tst, false];
  const env = { ...process.env };
  if (tmp) env.BORSA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kmy-test-'));
  const r = spawnSync(process.execPath, [path.join('test', file)], { stdio: 'inherit', env });
  if (r.status !== 0) { console.error(`✗ ${file} (çıkış ${r.status})`); process.exit(r.status || 1); }
}
console.log(`✓ ${TESTS.length} test dosyası geçti`);

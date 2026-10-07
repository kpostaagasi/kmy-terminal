// Evren listesindeki 3 harfli BIST kodu fon sayılmaz. Geçici önbellek; ağ yok.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'borsa-fon-'));
process.env.BORSA_DATA_DIR = dir;
const { cachePut } = await import('../server/db.js');
cachePut('isy:all', {
  at: Date.now(),
  stocks: { AEF: { code: 'AEF', name: 'Üç Harf Sanayi', sector: 'Sanayi' } },
  actions: [],
});
const { isFund } = await import('../server/market.js');

assert.equal(isFund('AEF'), false, 'evrendeki 3 harfli BIST kodu fon');
assert.equal(isFund('aef'), false, 'küçük harf de aynı kod');
assert.equal(isFund('TTE'), true, 'evren dışı 3 harf fon kalır');
assert.equal(isFund('BTC'), false, 'özel sembol fon değil');
assert.equal(isFund('THYAO'), false, '4+ harf BIST fon değil');

fs.rmSync(dir, { recursive: true, force: true });
console.log('ok fon ayrım');

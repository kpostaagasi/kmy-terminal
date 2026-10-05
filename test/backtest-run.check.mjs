// Koşu kilidi: zaman aşımından sonra iç koşu bitene kadar yeni koşu reddedilir; paylaşılan söz; başarısız koşu kaydı bozmaz.
// Kullanım: BORSA_DATA_DIR=$(mktemp -d) node test/backtest-run.check.mjs
import * as bt from '../server/backtest-run.js';
import { cachePut, cacheGet, cacheDeleteLike } from '../server/db.js';
let ok = 0, bad = 0;
const assert = (n, c) => { c ? ok++ : bad++; console.log(`${c ? 'OK  ' : 'FAIL'} ${n}`); };
const fake = { params: { symbols: 1 }, baseline: {}, signals: {} };
let release; const slow = () => new Promise((res) => { release = () => res(fake); });

assert('başlangıçta kayıt yok', bt.last().result === null && bt.last().running === false);
const p1 = bt.run({ timeoutMs: 50, work: slow });
const p2 = bt.run({ timeoutMs: 50, work: slow });
assert('koşu sürerken ikinci çağrı aynı sözü paylaşır', p1 === p2 && bt.last().running === true);
let e1; await p1.catch((e) => { e1 = e; });
assert('zaman aşımı hata verir', /zaman aşımı/.test(e1?.message));
assert('zaman aşımından sonra iç koşu sürerken running true kalır', bt.last().running === true);
let e2; await bt.run({ work: slow }).catch((e) => { e2 = e; });
assert('iç koşu bitmeden yeni koşu reddedilir (çakışma yok)', /hâlâ sürüyor/.test(e2?.message));
assert('zaman aşımı kayıt bırakmaz', bt.last().result === null);
let notified = 0; bt.onUpdate(() => { notified++; });
release(); await new Promise((r) => setTimeout(r, 10));
assert('iç koşu bitince kilit açılır', bt.last().running === false);
assert('zaman aşımından sonra başarıyla biten koşunun sonucu yine de kaydedilir ve bildirilir', bt.last().result?.params.symbols === 1 && notified === 1);
const r = await bt.run({ work: async () => fake });
assert('başarılı koşu kaydedilir', r.result === fake || JSON.stringify(r.result) === JSON.stringify(fake));
assert('last() kaydı döndürür', bt.last().result.params.symbols === 1 && Number.isFinite(bt.last().at));
let e3; await bt.run({ work: async () => { throw new Error('XU100 geçmişi alınamadı'); } }).catch((e) => { e3 = e; });
assert('başarısız koşu hata verir', /XU100/.test(e3?.message));
assert('başarısız koşu önceki kaydı bozmaz', bt.last().result.params.symbols === 1 && bt.last().running === false);
// XU100 başarısız olsa bile hisse çekimleri bitmeden koşu reddedilmez (sahipsiz arka plan çekimi kilidi delmesin)
let pending = 0, started = 0;
const history = async (s) => {
  if (s === 'XU100') throw new Error('XU100 geçmişi alınamadı');
  started++; pending++; await new Promise((r) => setTimeout(r, 30)); pending--;
  return [];
};
let e4; await bt.compute({ history, symbols: Array.from({ length: 20 }, (_, i) => 'S' + i) }).catch((e) => { e4 = e; });
assert('XU100 hatasında compute hata verir', /XU100/.test(e4?.message));
assert('hata verdiğinde bekleyen hisse çekimi kalmaz (kilit gerçeği yansıtır)', pending === 0 && started === 20);
// Önbellek: 10 yıllık geçmiş satırları koşu sonunda silinir, diğer anahtarlara dokunulmaz
cachePut('hist:AAA:10y:1d', [1]); cachePut('hist:AAA:1y:1d', [2]); cachePut('quote:AAA', [3]);
cacheDeleteLike('hist:%:10y:1d');
assert('cacheDeleteLike yalnız eşleşen anahtarları siler', cacheGet('hist:AAA:10y:1d', 1e9) === null && cacheGet('hist:AAA:1y:1d', 1e9) !== null && cacheGet('quote:AAA', 1e9) !== null);
console.log(`\n${ok} geçti, ${bad} başarısız`);
process.exit(bad ? 1 : 0);

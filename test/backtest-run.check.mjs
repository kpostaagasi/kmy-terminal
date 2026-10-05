// Koşu kilidi: zaman aşımından sonra iç koşu bitene kadar yeni koşu reddedilir; paylaşılan söz; başarısız koşu kaydı bozmaz.
// Kullanım: BORSA_DATA_DIR=$(mktemp -d) node test/backtest-run.check.mjs
import * as bt from '../server/backtest-run.js';
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
release(); await new Promise((r) => setTimeout(r, 10));
assert('iç koşu bitince kilit açılır', bt.last().running === false);
const r = await bt.run({ work: async () => fake });
assert('başarılı koşu kaydedilir', r.result === fake || JSON.stringify(r.result) === JSON.stringify(fake));
assert('last() kaydı döndürür', bt.last().result.params.symbols === 1 && Number.isFinite(bt.last().at));
let e3; await bt.run({ work: async () => { throw new Error('XU100 geçmişi alınamadı'); } }).catch((e) => { e3 = e; });
assert('başarısız koşu hata verir', /XU100/.test(e3?.message));
assert('başarısız koşu önceki kaydı bozmaz', bt.last().result.params.symbols === 1 && bt.last().running === false);
console.log(`\n${ok} geçti, ${bad} başarısız`);
process.exit(bad ? 1 : 0);

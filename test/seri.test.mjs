// Bölünme/birleşme düzeltmesi. Çevrimdışı, saf.
import { adjustSplits, validBars } from '../server/seri.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const B = (closes, vols = null) => closes.map((c, i) => ({ t: Date.UTC(2024, 0, 1 + i), o: c, h: c * 1.01, l: c * 0.99, c, v: vols ? vols[i] : 1000 }));
const cl = (r) => r.bars.map((b) => b.c);

// ── Temel davranış ────────────────────────────────────────────────────────
const e = adjustSplits([]);
assert('boş girdi: boş seri ve kırılma yok', e.bars.length === 0 && e.breaks.length === 0);
assert('tek mum dokunulmaz', adjustSplits(B([100])).bars[0].c === 100 && adjustSplits(B([100])).breaks.length === 0);
const flat = B([100, 102, 99, 105, 103]);
const rf = adjustSplits(flat);
assert('bölünmesiz seri aynen kalır', cl(rf).join() === '100,102,99,105,103' && rf.breaks.length === 0);
assert('girdi değiştirilmez ve yeni nesneler döner', rf.bars[0] !== flat[0] && flat[0].c === 100);

// ── Aşağı bölünme (bedelsiz): 102 → 34 ────────────────────────────────────
const s1 = adjustSplits(B([100, 102, 34, 35], [1000, 1000, 3000, 3000]));
assert('aşağı bölünme: önceki kapanışlar oranla çarpılır (süreklilik)', near(s1.bars[0].c, 100 * (34 / 102)) && near(s1.bars[1].c, 34) && s1.bars[2].c === 34 && s1.bars[3].c === 35, cl(s1).join());
assert('aşağı bölünme: o, h, l de çarpılır', near(s1.bars[0].o, 100 * (34 / 102)) && near(s1.bars[0].h, 100 * 1.01 * (34 / 102)) && near(s1.bars[0].l, 100 * 0.99 * (34 / 102)));
assert('aşağı bölünme: önceki hacim ters ölçeklenir (×3)', near(s1.bars[0].v, 3000) && near(s1.bars[1].v, 3000) && s1.bars[2].v === 3000, [s1.bars[0].v, s1.bars[1].v, s1.bars[2].v].join());
assert('kırılma kaydı: indeks, tarih, oran', s1.breaks.length === 1 && s1.breaks[0].index === 2 && s1.breaks[0].date === '2024-01-03' && near(s1.breaks[0].ratio, 34 / 102), JSON.stringify(s1.breaks));

// ── Yukarı birleşme (ters bölünme): 10,5 → 18,2 (+%73) ────────────────────
const s2 = adjustSplits(B([10, 10.5, 18.2, 18]));
assert('yukarı birleşme: önceki kapanışlar oranla çarpılır', near(s2.bars[1].c, 18.2) && near(s2.bars[0].c, 10 * (18.2 / 10.5)) && s2.bars[3].c === 18, cl(s2).join());
assert('yukarı birleşme: hacim ters ölçeklenir (÷ oran)', near(s2.bars[0].v, 1000 / (18.2 / 10.5)));

// ── Eşikler (Review Focus: gerçek hareketler dokunulmaz) ──────────────────
assert('tam −%25 bölünme sayılmaz (sınır dahil değil)', adjustSplits(B([100, 75])).breaks.length === 0);
assert('−%25,01 bölünme sayılır', adjustSplits(B([100, 74.99])).breaks.length === 1);
assert('tam +%30 birleşme sayılmaz', adjustSplits(B([100, 130])).breaks.length === 0);
assert('+%30,01 birleşme sayılır', adjustSplits(B([100, 130.01])).breaks.length === 1);
assert('−%10 ve +%10 (güncel fiyat sınırı) dokunulmaz', adjustSplits(B([100, 90, 99])).breaks.length === 0);
assert('±%20 (eski fiyat sınırı) dokunulmaz', adjustSplits(B([100, 80, 96, 115.2])).breaks.length === 0);

// ── Birden çok kırılma birikir ────────────────────────────────────────────
const s3 = adjustSplits(B([100, 50, 51, 17, 17.5]));
assert('iki bölünme: indeksler 1 ve 3', s3.breaks.map((b) => b.index).join() === '1,3');
assert('iki bölünme: ilk mum iki oranla, araya düşen mumlar sonuncuyla çarpılır', near(s3.bars[0].c, 100 * 0.5 * (17 / 51)) && near(s3.bars[1].c, 50 * (17 / 51)) && near(s3.bars[2].c, 17) && s3.bars[3].c === 17 && s3.bars[4].c === 17.5, cl(s3).join());

// ── Kenarlar ──────────────────────────────────────────────────────────────
const sl = adjustSplits(B([100, 100, 30]));
assert('son mumdaki bölünme: önceki tüm mumlar ölçeklenir, son mum aynen', sl.bars[2].c === 30 && near(sl.bars[0].c, 30) && near(sl.bars[1].c, 30) && sl.breaks[0].index === 2);
const bad = B([100, 100, 100]); bad[1].c = null;
assert('bozuk (null) kapanışlı mum: sayı olmayan alan olduğu gibi kalır, çökme yok', adjustSplits(bad).bars[1].c === null && adjustSplits(bad).breaks.length === 0);
const bad2 = B([100, 100, 30]); bad2[1].c = null;
assert('bozuk mumun üzerinden önceki geçerli kapanışla kıyaslanır (100 → 30)', adjustSplits(bad2).breaks.length === 1 && adjustSplits(bad2).breaks[0].index === 2);
const zero = B([100, 0, 100]);
assert('sıfır kapanış kırılma hesabına katılmaz (0 → 100 sonsuz oran üretmez)', adjustSplits(zero).breaks.length === 0 && adjustSplits(zero).bars[1].c === 0);
const noT = [{ o: 100, h: 100, l: 100, c: 100, v: 1 }, { o: 30, h: 30, l: 30, c: 30, v: 1 }];
assert('zaman damgası yoksa tarih null, kırılma yine yakalanır', adjustSplits(noT).breaks[0].date === null && adjustSplits(noT).breaks.length === 1);
assert('hacim 0 ise 0 kalır (NaN değil)', adjustSplits(B([100, 100, 30], [0, 0, 0])).bars[0].v === 0);
assert('özel eşik: down −%10 ile −%11 sayılır', adjustSplits(B([100, 89]), { down: -0.10 }).breaks.length === 1);

// validBars: kapanışı sayı olmayan ya da ≤ 0 olan mumlar atılır (sahte sinyal üretmesin)
const vb = validBars([{ c: 100 }, { c: 0 }, { c: null }, { c: NaN }, { c: -5 }, { c: 101 }]);
assert('validBars: 0, null, NaN ve negatif kapanışlı mumlar atılır', vb.length === 2 && vb[0].c === 100 && vb[1].c === 101);
assert('validBars: geçerli mumlar aynı nesnelerdir, boş girdi çökmez', (() => { const a = [{ c: 1 }]; return validBars(a)[0] === a[0] && validBars([]).length === 0; })());
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);

// Kurum hedef fiyatı: pozisyon başına özet ve portföy toplamı. Çevrimdışı, veritabansız.
import { pickTarget, targetTotals, MAX_AGE_DAYS } from '../server/hedef.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const near = (a, b, tol = 1e-6) => a != null && Math.abs(a - b) <= tol;

const NOW = Date.parse('2026-10-02T12:00:00Z');
const row = (broker, target, rating, report_date) => ({ broker, target, rating, report_date });

assert('bayatlık sınırı 180 gün', MAX_AGE_DAYS === 180);

// ── Kurum başına en yeni görüş ────────────────────────────────────────────
const t1 = pickTarget([row('A', 300, 'AL', '2026-08-01'), row('A', 340, 'AL', '2026-09-10')], { price: 272, now: NOW });
assert('aynı kurumun en yeni görüşü alınır', t1.median === 340 && t1.brokers === 1, JSON.stringify(t1));
assert('hedef getiri = medyan/fiyat − 1', near(t1.upsidePct, 25), String(t1.upsidePct));

// ── Medyan ve öneri dağılımı ──────────────────────────────────────────────
const t2 = pickTarget([row('A', 300, 'AL', '2026-09-01'), row('B', 340, 'TUT', '2026-09-02'), row('C', 400, 'SAT', '2026-09-03')], { price: 272, now: NOW });
assert('3 kurumun medyanı', t2.median === 340 && t2.brokers === 3 && t2.withTarget === 3);
assert('AL / TUT / SAT sayıları', t2.al === 1 && t2.tut === 1 && t2.sat === 1);
assert('en yeni rapor tarihi', t2.newest === '2026-09-03');
const t2b = pickTarget([row('A', 300, 'AL', '2026-09-01'), row('B', 400, 'AL', '2026-09-02')], { price: 350, now: NOW });
assert('çift sayıda kurumda medyan ortalama', t2b.median === 350);
assert('ALDIR de AL sayılır', pickTarget([row('A', 300, 'ALDIR', '2026-09-01')], { price: 250, now: NOW }).al === 1);

// ── Bayat hedef (Review Focus) ────────────────────────────────────────────
assert('hepsi 180 günden eskiyse null', pickTarget([row('A', 300, 'AL', '2026-03-01')], { price: 250, now: NOW }) === null);
const t3 = pickTarget([row('A', 300, 'AL', '2026-09-01'), row('B', 500, 'AL', '2026-03-01')], { price: 250, now: NOW });
assert('bayat kurum hariç tutulur, taze kalır', t3.brokers === 1 && t3.median === 300);
// Kurumun en yeni görüşü bayatsa daha eski satıra düşülmez (o daha da bayat).
assert('en yeni görüşü bayat kurum eski satıra düşmez', pickTarget([row('A', 300, 'AL', '2026-02-01'), row('A', 280, 'AL', '2026-01-01')], { price: 250, now: NOW }) === null);
assert('tam 180. gün hâlâ geçerli', pickTarget([row('A', 300, 'AL', '2026-04-05')], { price: 250, now: NOW }) !== null);
assert('181. gün geçersiz', pickTarget([row('A', 300, 'AL', '2026-04-04')], { price: 250, now: NOW }) === null);

// ── Bedelsiz sermaye artırımı (Review Focus) ──────────────────────────────
const rep = [row('A', 300, 'AL', '2026-08-01')];
assert('rapordan sonra bedelsiz → hedef sayılmaz', pickTarget(rep, { price: 150, now: NOW, actions: [{ date: '2026-09-01', bonusPct: 100 }] }) === null);
assert('rapordan önceki bedelsiz → hedef geçerli', pickTarget(rep, { price: 150, now: NOW, actions: [{ date: '2026-07-01', bonusPct: 100 }] }) !== null);
assert('henüz gerçekleşmemiş (gelecek tarihli) bedelsiz → hedef geçerli', pickTarget(rep, { price: 150, now: NOW, actions: [{ date: '2026-11-01', bonusPct: 100 }] }) !== null);
assert('temettü / bedelli işlemi hedefi düşürmez', pickTarget(rep, { price: 150, now: NOW, actions: [{ date: '2026-09-01', bonusPct: 0, rightsPct: 50, cashGrossPct: 10 }] }) !== null);
assert('bedelsiz temettüden (bonusDivPct) de düşer', pickTarget(rep, { price: 150, now: NOW, actions: [{ date: '2026-09-01', bonusPct: null, bonusDivPct: 20 }] }) === null);
const t4 = pickTarget([row('A', 300, 'AL', '2026-08-01'), row('B', 160, 'AL', '2026-09-15')], { price: 150, now: NOW, actions: [{ date: '2026-09-01', bonusPct: 100 }] });
assert('bedelsizden sonraki rapor kalır, öncekisi düşer', t4.brokers === 1 && t4.median === 160);

// ── Eksik veri (Review Focus) ─────────────────────────────────────────────
const t5 = pickTarget([row('A', null, 'AL', '2026-09-01'), row('B', 300, 'TUT', '2026-09-02')], { price: 250, now: NOW });
assert('yalnız önerisi olan kurum medyana girmez ama AL sayısına girer', t5.median === 300 && t5.withTarget === 1 && t5.brokers === 2 && t5.al === 1);
const t6 = pickTarget([row('A', null, 'AL', '2026-09-01')], { price: 250, now: NOW });
assert('hiç hedef yoksa medyan ve yüzde null, öneri duruyor', t6.median === null && t6.upsidePct === null && t6.al === 1);
assert('fiyat yok → yüzde null, medyan duruyor', pickTarget(row.length ? [row('A', 300, 'AL', '2026-09-01')] : [], { price: null, now: NOW }).upsidePct === null);
assert('fiyat 0 → yüzde null (sıfıra bölme yok)', pickTarget([row('A', 300, 'AL', '2026-09-01')], { price: 0, now: NOW }).upsidePct === null);
assert('boş satır listesi null', pickTarget([], { price: 250, now: NOW }) === null);
assert('rapor tarihi bozuksa o satır atlanır', pickTarget([row('A', 300, 'AL', 'bozuk')], { price: 250, now: NOW }) === null);

// ── targetTotals ──────────────────────────────────────────────────────────
// `target` anahtarı yok = hedef kapsamı dışı (fon, altın, yabancı); null = uygun ama veri yok.
const H = [
  { value: 100, target: { upsidePct: 20 } },
  { value: 300, target: { upsidePct: -10 } },
  { value: 100, target: null },
  { value: 500 },
];
const T = targetTotals(H);
assert('kapsam sayıları (2 / 3 uygun)', T.n === 2 && T.of === 3, JSON.stringify(T));
assert('kapsam değer payı = 400/500', near(T.valuePct, 80), String(T.valuePct));
assert('ağırlıklı hedef getiri', near(T.weightedUpsidePct, -2.5), String(T.weightedUpsidePct));
// Review Focus: boş portföy, tek uygun pozisyon, değeri/yüzdesi olmayan.
const E = targetTotals([]);
assert('boş portföy: of 0, ağırlıklı null', E.of === 0 && E.n === 0 && E.weightedUpsidePct === null && E.valuePct === null);
const only = targetTotals([{ value: 500 }, { value: 200 }]);
assert('uygun pozisyon yoksa of 0', only.of === 0 && only.weightedUpsidePct === null);
const none = targetTotals([{ value: 100, target: null }]);
assert('uygun ama hiç kapsam yoksa ağırlıklı null', none.of === 1 && none.n === 0 && none.weightedUpsidePct === null && none.valuePct === 0);
const noPct = targetTotals([{ value: 100, target: { upsidePct: null } }, { value: 100, target: { upsidePct: 10 } }]);
assert('yüzdesi null olan kapsamda sayılmaz', noPct.n === 1 && noPct.of === 2 && near(noPct.weightedUpsidePct, 10));
const noVal = targetTotals([{ value: null, target: { upsidePct: 50 } }, { value: 100, target: { upsidePct: 10 } }]);
assert('değeri olmayan pozisyon hesaba girmez', noVal.of === 1 && noVal.n === 1 && near(noVal.weightedUpsidePct, 10));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);

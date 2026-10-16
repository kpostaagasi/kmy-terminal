// Portföy motoru regresyon testi (npm test): geçici veritabanında, elle hesaplanmış beklenen değerlerle.
// Gerçek veritabanına (data/) dokunmaz. Değer, K/Z ve XIRR kontrolleri güncel fiyat için internet ister.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'borsa-test-'));
process.env.BORSA_DATA_DIR = dir;
const pf = await import('../server/portfolio.js');

const TX = [
  { date: '2025-01-02', platform: 'Kurum A', type: 'DEPOSIT', price: 100000 },
  { date: '2025-01-03', platform: 'Kurum A', type: 'BUY', symbol: 'THYAO', quantity: 100, price: 280, fee: 20 },
  { date: '2025-01-10', platform: 'Kurum A', type: 'BUY', symbol: 'THYAO', quantity: 50, price: 300, fee: 10 },
  { date: '2025-02-01', platform: 'Kurum A', type: 'SELL', symbol: 'THYAO', quantity: 60, price: 320, fee: 15 },
  { date: '2025-02-15', platform: 'Kurum A', type: 'DIVIDEND', symbol: 'THYAO', price: 900, fee: 135 },
  { date: '2025-03-01', platform: 'Kurum A', type: 'FX_CONVERT', price: 20000, currency: 'TRY', to_currency: 'USD', to_amount: 500 },
  { date: '2025-03-05', platform: 'Kurum A', type: 'BUY', symbol: 'AAPL.US', quantity: 2, price: 200, fee: 1, currency: 'USD', fx_rate: 41 },
  { date: '2025-04-01', platform: 'Kurum A', type: 'BUY', symbol: 'TUPRS', quantity: 40, price: 150, fee: 5 },
  { date: '2025-05-01', platform: 'Kurum A', type: 'BUY', symbol: 'CEYREK', quantity: 2, price: 6500 },
  { date: '2025-05-02', platform: 'Kurum A', type: 'BUY', symbol: 'TTE', asset_type: 'fund', quantity: 1000, price: 1.2 },
  { date: '2025-07-01', platform: 'Kurum A', type: 'TRANSFER', symbol: 'THYAO', quantity: 30, to_platform: 'Kurum B' },
  { date: '2025-07-02', platform: 'Kurum B', type: 'FREE', symbol: 'BIMAS', quantity: 10 },
  { date: '2025-08-01', platform: 'Kurum A', type: 'DRIP', symbol: 'THYAO', quantity: 5, price: 310 },
  { date: '2025-08-10', platform: 'Kurum A', type: 'INTEREST', price: 500 },
  { date: '2025-08-11', platform: 'Kurum A', type: 'FEE', price: 100 },
  { date: '2025-09-01', platform: 'Kurum A', type: 'WITHDRAW', price: 10000 },
];
for (const t of TX) await pf.addTransaction(t);

let pass = 0, fail = 0;
const near = (a, b, tol = 0.01) => a != null && Math.abs(a - b) <= tol;
function check(name, got, want, tol) {
  const ok = near(got, want, tol);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${got} (beklenen ${want})`);
}
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

const L = pf.computeLedger();
const T = L.totals;
const thy = L.holdings.find((h) => h.symbol === 'THYAO');
const posA = L.positions.find((p) => p.symbol === 'THYAO' && p.platform === 'Kurum A');
const posB = L.positions.find((p) => p.symbol === 'THYAO' && p.platform === 'Kurum B');
const aapl = L.holdings.find((h) => h.symbol === 'AAPL.US');
const cashTRY = L.cash.find((c) => c.currency === 'TRY');
const cashUSD = L.cash.find((c) => c.currency === 'USD');

check('THYAO toplam adet', thy?.qty, 95);
check('THYAO toplam maliyet', thy?.cost, 27368);
check('THYAO Kurum A adet', posA?.qty, 65);
check('THYAO Kurum A maliyet', posA?.cost, 18762);
check('THYAO Kurum B adet', posB?.qty, 30);
check('THYAO Kurum B maliyet', posB?.cost, 8606);
check('Gerçekleşen K/Z', T.realized, 1973);
check('Temettü (net + DRIP)', T.dividends, 2315);
check('Faiz', T.interest, 500);
check('Masraf', T.fees, 100);
check('Yatırılan', T.deposits, 100000);
check('Çekilen', T.withdrawals, 10000);
check('Nakit TL', cashTRY?.amount, 27115);
check('Nakit USD', cashUSD?.amount, 99);
check('Nakit USD TL maliyeti', cashUSD?.cost, 3960);
check('Gerçekleşen kur farkı', T.fxRealized, 401);
check('AAPL TL maliyet', aapl?.cost, 16441);
check('AAPL USD maliyet', aapl?.costNative, 401);

const S = await pf.summary();
const t = S.totals;
check('Net yatırılan', t.netInvested, 90000);
check('Toplam maliyet', t.cost, 64014);
check('Toplam K/Z = değer − net yatırılan', t.totalPnl, t.value - t.netInvested);
const decomposition = t.unrealized + t.realized + t.dividends + t.interest - t.fees + t.fxRealized + t.fxUnrealized;
check('K/Z ayrıştırması tutarlı', decomposition, t.totalPnl);
const aaplPos = S.positions.find((p) => p.symbol === 'AAPL.US');
check('AAPL ort. maliyet (USD)', aaplPos?.avgCostNative, 200.5);
console.log('Fiyat kaynakları:', S.holdings.map((h) => `${h.symbol}:${h.priceSource}`).join(' '));
const aaplH = S.holdings.find((h) => h.symbol === 'AAPL.US');
check('AAPL K/Z = fiyat etkisi + kur etkisi', aaplH.pnlPrice + aaplH.pnlFx, aaplH.pnl);
const usdCash = S.cash.filter((c) => c.currency === 'USD').reduce((a, c) => a + c.valueTRY, 0);
const hedged = S.holdings.filter((h) => ['AAPL.US', 'CEYREK'].includes(h.symbol)).reduce((a, h) => a + h.value, 0) + usdCash;
check('TL dışı pay (AAPL + çeyrek + USD nakit)', S.distribution.nonTl.value, hedged);
// Satış senaryosu: BIST hisselerinde stopaj kesilir, yurt dışı varlık ve fonlarda uygulanmaz
const sellable = S.holdings.filter((h) => h.value != null);
for (const h of sellable) {
  const wantTax = h.sellTaxable ? h.value * 0.1 : 0;
  check(`${h.symbol} stopaj = değer × oran`, h.sellTax, wantTax, 0.01);
  check(`${h.symbol} satışa çevir (net) = değer − stopaj`, h.sellNet, h.value - h.sellTax, 0.01);
  check(`${h.symbol} satış K/Z = net − maliyet`, h.sellRealized, h.sellNet - h.cost, 0.01);
}
check('BIST hissesi stopaja tabi', S.holdings.find((h) => h.symbol === 'THYAO')?.sellTaxable, true);
check('ABD hissesi stopaja tabi değil', S.holdings.find((h) => h.symbol === 'AAPL.US')?.sellTaxable, false);
check('Toplam satışa çevir = Σ net', t.sellNet, sellable.reduce((a, h) => a + h.sellNet, 0), 0.01);
check('Toplam stopaj = Σ kesinti', t.sellTax, sellable.reduce((a, h) => a + h.sellTax, 0), 0.01);
const D = await pf.dividendReport();
const b25 = D.breakdown['2025'] || {};
check('Temettü kırılımı 2025 toplamı', Object.values(b25.bySector || {}).reduce((a, v) => a + v, 0), 2315);

const R = await pf.risk({});
const M = R.metrics;
const last = R.series.at(-1);
const flows = [[new Date('2025-01-02'), -100000], [new Date('2025-09-01'), 10000], [new Date(R.end), last.value]];
const r = M.xirrPct / 100;
const npv = flows.reduce((a, [d, cf]) => a + cf / (1 + r) ** ((d - flows[0][0]) / 864e5 / 365), 0);
check('XIRR: nakit akışlarının bugünkü değeri ≈ 0 (TL)', npv, 0, 5);
console.log(`XIRR %${M.xirrPct?.toFixed(2)} · TWR %${M.totalReturnPct?.toFixed(2)} · CAGR %${M.cagrPct?.toFixed(2)} · seri sonu ${R.end} değer ${last.value.toFixed(2)}`);

// CSV içe aktarma: aracı kurum başlıkları, elle eşleştirme ve mükerrer satırı atlama
const csv = 'Emir Tarihi;Yön;Kıymet;Gerçekleşen Adet;Ort. Fiyat;Kom.;Hesap\n03.02.2025;Alış;ASELS;10;60;1;Kurum C\n04.02.2025;Satış;ASELS;5;65;1;Kurum C\n';
const p1 = pf.previewCsv(csv);
check('CSV: aracı kurum başlıkları otomatik tanındı (geçerli satır)', p1.valid, 2);
const c1 = await pf.commitCsv(csv);
check('CSV: içe aktarılan', c1.imported, 2);
const p2 = pf.previewCsv(csv);
check('CSV: aynı dosya tekrar yüklenince mükerrer', p2.duplicates, 2);

// Denetim dizisi: her madde tam bir sözleşme taşır (arayüz alanları doğrudan okur).
// Sıralama önemli: CSV içe aktarımı yukarıda ASELS ekledi, bu yüzden özet ve seri aynı
// durumdan okunmalı — önceki S/t içe aktarımdan önce alınmıştı ve %1,09'luk sapma
// gerçek bir hata değil, karşılaştırılan iki farklı portföydü.
// Canlı fiyat kaynakları ara sıra tek bir sembolde boş/gecikmeli yanıt verir (CI'da %6,5'lik sapma);
// karşılaştırma ağ hatasına değil hesaplamaya bakmalı: birkaç kez yeniden okunur, son deneme raporlanır.
let S2, VS, lpt, drift;
for (let i = 0; i < 4; i++) {
  S2 = await pf.summary();
  VS = await pf.valueSeries();
  lpt = VS.at(-1);
  drift = Math.abs(lpt.value - S2.totals.value) / S2.totals.value;
  if (drift < 0.01) break;
  console.log(`  (deneme ${i + 1}: sapma %${(drift * 100).toFixed(2)}; ${S2.holdings.map((h) => `${h.symbol}=${h.price}`).join(' ')})`);
  await new Promise((r) => setTimeout(r, 3000));
}
assert('Denetim: audit dizisi ve zorunlu alanlar', Array.isArray(S2.audit) && S2.audit.every((a) => a.code && ['kritik', 'uyari', 'bilgi'].includes(a.severity) && a.title && a.action !== undefined), `${S2.audit.length} madde`);
assert('Seri son noktası ≈ bugünkü değer (%1)', drift < 0.01, `seri ${lpt.date} ${Math.round(lpt.value)} vs özet ${Math.round(S2.totals.value)} (%${(drift * 100).toFixed(2)})`);
assert('Serideki döviz varlık sıfıra düşmüyor', S2.holdings.filter((h) => h.currency !== 'TRY').every((h) => h.value > 0), S2.holdings.filter((h) => h.currency !== 'TRY').map((h) => `${h.symbol}:${Math.round(h.value)}`).join(' '));

// Beyanname: stopaj, komisyon ve BSMV ayrı sütunlarda
await pf.addTransaction({ date: '2025-10-01', platform: 'Kurum A', type: 'SELL', symbol: 'CEYREK', quantity: 1, price: 7000, fee: 20, tax: 700, other_fee: 14 });
const TR = pf.taxReport();
const y25 = TR.years.find((x) => x.year === '2025');
check('Beyanname 2025: brüt satış − stopaj − komisyon − BSMV = net nakit çıkışı', y25.grossSales - y25.tax - y25.commission - y25.bsmv, y25.netOut, 0.01);
check('Beyanname 2025: brüt satış (19200 + 325 + 7000)', y25.grossSales, 26525, 0.01);
check('Beyanname 2025: satış stopajı', y25.tax, 700, 0.01);
check('Beyanname 2025: BSMV', y25.bsmv, 14, 0.01);
check('Beyanname 2025: eski kayıtta temettü stopajı fee içinde', y25.dividendTax, 135, 0.01);
check('Beyanname toplam stopaj = defter stopajı', TR.total.tax, pf.computeLedger().totals.tax, 0.01);
check('Beyanname 2025: komisyon (AAPL ücreti 41 TL kuruyla)', y25.commission, 113, 0.01);

// Geriye uyum: tax/other_fee sütunu olmayan eski bir satır yazıldığında okuma patlamıyor
const { db } = await import('../server/db.js');
db.prepare("INSERT INTO transactions(date, type, symbol, asset_type, quantity, price, fee, currency, fx_rate) VALUES('2025-11-01','BUY','ASELS','stock',1,10,1,'TRY',1)").run();
const oldRow = db.prepare("SELECT tax, other_fee FROM transactions WHERE date = '2025-11-01'").get();
let oldOk = true, oldErr = '';
try { const L2 = pf.computeLedger(); oldOk = L2.totals.tax >= 700 && pf.taxReport().years.length > 0; } catch (e) { oldOk = false; oldErr = e.message; }
assert('Eski şema satırı (tax/other_fee sütunu yok) okunuyor', oldOk && oldRow.tax === 0 && oldRow.other_fee === 0, `tax=${oldRow.tax} other_fee=${oldRow.other_fee} ${oldErr}`);

console.log(`\n${pass}/${pass + fail} kontrol geçti`);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows: SQLite dosyası hâlâ açık (EBUSY); geçici dizin kalır */ }
process.exit(fail ? 1 : 0);

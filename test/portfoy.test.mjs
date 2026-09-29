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

console.log(`\n${pass}/${pass + fail} kontrol geçti`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);

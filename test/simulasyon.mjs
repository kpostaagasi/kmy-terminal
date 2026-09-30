// Portföy hata senaryoları — sessizce yanlış değer üreten durumları gerçekçi bir portföyle ortaya çıkarır.
// Geçici veritabanında çalışır; gerçek data/borsa.db'ye dokunmaz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'borsa-sim-'));
process.env.BORSA_DATA_DIR = dir;
const pf = await import('../server/portfolio.js');
const ind = await import('../server/indicators.js');

let pass = 0, fail = 0;
const near = (a, b, tol = 0.01) => a != null && Number.isFinite(a) && Math.abs(a - b) <= tol;
function check(name, ok, detail = '') {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
function checkNum(name, got, want, tol = 0.01) {
  check(name, near(got, want, tol), `${got} (beklenen ${want})`);
}

// ── Göreli yuvarlama ──────────────────────────────────────────────────────
// Mutlak 2 ondalık TEFAS fon birim fiyatını bozuyordu (0,072083 → 0,07 = %2,9 hata).
checkNum('TEFAS birim fiyatı korunuyor', ind.sig6(0.072083), 0.072083, 1e-7);
checkNum('BIST fiyatında kuru kaybı yok', ind.sig6(83147.6), 83147.6, 0.001);
check('null güvenli', ind.sig6(null) === null);
check('Infinity güvenli', ind.sig6(Infinity) === null);

// ── Yıllıklandırma ────────────────────────────────────────────────────────
// 252 sabiti, takvim fon/kripto günlerini de içerdiği için volatiliteyi ~%20 şişiriyordu.
check('250 günlük seri 252\'den küçük katsayı alıyor', ind.annualization(250, 365) < 252, String(ind.annualization(250, 365)));
check('Yıl boyu seri döviz tabanına yakın', ind.annualization(365, 365) === 364, String(ind.annualization(365, 365)));
check('Yetersiz veride 365 tabanı', ind.annualization(1, 0) === 365, String(ind.annualization(1, 0)));

// ── Defter senaryoları ────────────────────────────────────────────────────
const TX = [
  // Nakit takibi: kayıtlı nakit (5.000) pozisyon maliyetini (61.336) karşılamıyor.
  { date: '2025-01-02', platform: 'Kurum A', type: 'DEPOSIT', price: 5000 },
  { date: '2025-01-03', platform: 'Kurum A', type: 'BUY', symbol: 'THYAO', quantity: 100, price: 280, fee: 20 },
  { date: '2025-01-10', platform: 'Kurum A', type: 'BUY', symbol: 'THYAO', quantity: 50, price: 300, fee: 10 },
  { date: '2025-02-01', platform: 'Kurum A', type: 'SELL', symbol: 'THYAO', quantity: 60, price: 320, fee: 15 },
  { date: '2025-02-15', platform: 'Kurum A', type: 'DIVIDEND', symbol: 'THYAO', price: 900, fee: 90 },
  { date: '2025-03-01', platform: 'Kurum A', type: 'FX_CONVERT', price: 20000, currency: 'TRY', to_currency: 'USD', to_amount: 500 },
  { date: '2025-03-05', platform: 'Kurum A', type: 'BUY', symbol: 'AAPL.US', quantity: 2, price: 200, fee: 1, currency: 'USD', fx_rate: 41 },
  { date: '2025-04-01', platform: 'Kurum A', type: 'BUY', symbol: 'TUPRS', quantity: 40, price: 150, fee: 5 },
  { date: '2025-05-01', platform: 'Kurum A', type: 'BUY', symbol: 'CEYREK', quantity: 2, price: 6500 },
  { date: '2025-05-02', platform: 'Kurum A', type: 'BUY', symbol: 'TTE', asset_type: 'fund', quantity: 1000, price: 0.072083 },
  { date: '2025-07-01', platform: 'Kurum A', type: 'SPLIT', symbol: 'THYAO', quantity: 2 },
  // Kotasyonu olmayan TEFAS fonu: fiyat elle girilir, güncellenmezse değerleme eski kalır.
  { date: '2025-05-03', platform: 'Kurum A', type: 'BUY', symbol: 'ZZF', asset_type: 'fund', quantity: 500, price: 2.5 },
  // Kuru 1 olarak kaydedilmiş yabancı para: defter sessizce yanlış değer üretir, denetim yakalamalı.
  { date: '2025-03-10', platform: 'Kurum A', type: 'DEPOSIT', price: 1000, currency: 'CHF', fx_rate: 1 },
  // Kurum A'da 180 adet var; 200 adet isteniyor → 180 taşınmalı, 20'lik hayalet pozisyon oluşmamalı.
  { date: '2025-07-02', platform: 'Kurum A', type: 'TRANSFER', symbol: 'THYAO', quantity: 200, to_platform: 'Kurum B' },
  { date: '2025-07-03', platform: 'Kurum B', type: 'FREE', symbol: 'BIMAS', quantity: 10 },
  { date: '2025-08-01', platform: 'Kurum A', type: 'INTEREST', price: 500 },
  { date: '2025-08-11', platform: 'Kurum A', type: 'FEE', price: 100 },
];
for (const t of TX) await pf.addTransaction(t);

const L = pf.computeLedger();
const posA = L.positions.find((p) => p.symbol === 'THYAO' && p.platform === 'Kurum A');
const posB = L.positions.find((p) => p.symbol === 'THYAO' && p.platform === 'Kurum B');

checkNum('TRANSFER kaynağından fazlası taşınmıyor (hayalet pozisyon yok)', posB?.qty ?? -1, 180, 0.001);
check('Transfer uyarısı üretildi', L.warnings.some((w) => /transfer kaynağında yeterli miktar yok/.test(w)),
  L.warnings.find((w) => /transfer/.test(w)) || '(uyarı yok)');

const totalQty = L.positions.filter((p) => p.symbol === 'THYAO').reduce((a, p) => a + p.qty, 0);
checkNum('Bölünme her iki platform kovasına da uygulandı', totalQty, 180, 0.001);
check('Hiçbir pozisyon negatif değil', !L.positions.some((p) => p.qty < -1e-9));

const s = await pf.summary();
check('Nakit kaydı yetersiz uyarısı üretildi', s.warnings.some((w) => /Kayıtlı nakit girişi/.test(w)),
  s.warnings.find((w) => /nakit girişi/.test(w)) || '(uyarı yok)');
// Kaynak tamamen boşaldığı için pozisyon listeden düşer; artık negatif olamaz.
check('Kaynak tamamen boşaldı, negatif pozisyon yok', (posA?.qty ?? 0) === 0, `qty ${posA?.qty ?? 'yok'}`);
check('Net yatırım pozisyon maliyetine eşit', near(s.totals.netInvested, s.totals.cost, 0.01),
  `${Math.round(s.totals.netInvested)} vs maliyet ${Math.round(s.totals.cost)}`);
check('Toplam K/Z portföy değerine eşit değil (eski hata)', Math.abs(s.totals.totalPnl - s.totals.value) > 0.01,
  `K/Z ${Math.round(s.totals.totalPnl)} vs değer ${Math.round(s.totals.value)}`);
// totalPnlPct canlı piyasa fiyatına bağlı olduğu için mutlak bir tavan koymak geçersiz
// (iki koşu arasında canlı fiyat değişince sınırı aşıyordu). Değişmez olan ilişkiyi denetle.
check('Toplam K/Z = değer − net yatırım', near(s.totals.totalPnl, s.totals.value - s.totals.netInvested, 0.5),
  `${Math.round(s.totals.totalPnl)} vs ${Math.round(s.totals.value - s.totals.netInvested)}`);
check('Toplam K/Z yüzdesi oranla tutarlı', s.totals.totalPnlPct == null || near(s.totals.totalPnlPct, (s.totals.totalPnl / s.totals.netInvested) * 100, 0.01),
  `${s.totals.totalPnlPct?.toFixed(2)}%`);

// ── Bütünlük denetimi (0.14.1) ───────────────────────────────────────────
const codes = s.audit.map((a) => a.code);
const find = (c) => s.audit.find((a) => a.code === c);
check('Denetim: tek nakit kaydı → net_invested uyarısı', codes.includes('net_invested'),
  find('net_invested')?.detail || '(yok)');
check('Denetim: yetersiz transfer → transfer_short uyarısı', codes.includes('transfer_short'),
  find('transfer_short')?.detail || '(yok)');
check('Denetim: CHF işlemi (kuru 1) → fx_gap uyarısı', codes.includes('fx_gap') && /CHF/.test(find('fx_gap')?.detail || ''),
  find('fx_gap')?.detail || '(yok)');
check('Denetim: her madde code/severity/title/detail/action taşıyor',
  s.audit.every((a) => a.code && ['kritik', 'uyari', 'bilgi'].includes(a.severity) && a.title && a.detail && a.action),
  `${s.audit.length} madde: ${codes.join(', ')}`);
check('Denetim: kritik uyarı önce sıralanır', s.audit[0]?.severity === 'kritik', s.audit[0]?.code || '-');
// Geriye uyum: eski uyarı metinleri yerinde kalır; arayüzün aynı olayı iki kez göstermemesi
// için audit.detail ile birebir eşleşmeleri gerekir.
const covered = s.audit.filter((a) => ['net_invested', 'neg_cash', 'short_position', 'unpriced'].includes(a.code));
check('Denetim: uyarı metni audit.detail ile birebir eşleşiyor', covered.every((a) => s.warnings.includes(a.detail)),
  covered.map((a) => a.code).join(', '));

// TEFAS fonu aylardır aynı fiyatla değerlendiriliyor
pf.setManualPrice('ZZF', 2.5, '2024-06-01');
const s2 = await pf.summary();
const stale = s2.audit.find((a) => a.code === 'stale_price');
check('Denetim: eski fiyatlı TEFAS fonu → stale_price uyarısı', !!stale && /ZZF/.test(stale.detail), stale?.detail || '(yok)');

console.log(`\n${fail === 0 ? 'TAMAMI GEÇTİ' : 'BAŞARISIZ'}: ${pass} geçti, ${fail} kaldı`);
process.exit(fail === 0 ? 0 : 1);

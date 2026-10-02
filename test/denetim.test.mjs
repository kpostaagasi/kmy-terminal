// Veri denetimi çekirdeği: çevrimdışı, ağsız, veritabansız.
import * as K from '../scripts/denetim-cekirdek.mjs';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const durum = (r) => r.durum;

// ── karsilastir ───────────────────────────────────────────────────────────
assert('eşit değer OK', durum(K.karsilastir(100, 100, 0.5)) === 'OK');
assert('tolerans içi OK', durum(K.karsilastir(100.4, 100, 0.5)) === 'OK');
assert('tolerans dışı SAPMA', durum(K.karsilastir(101, 100, 0.5)) === 'SAPMA');
assert('sapma yüzdesi doğru', Math.abs(K.karsilastir(101, 100, 0.5).sapmaPct - 1) < 1e-9);
// Review Focus: eksik/geçersiz girdi çökmez, SAPMA da üretmez.
assert('null app ATLANDI', durum(K.karsilastir(null, 100, 1)) === 'ATLANDI');
assert('NaN ref ATLANDI', durum(K.karsilastir(100, NaN, 1)) === 'ATLANDI');
assert('undefined ATLANDI', durum(K.karsilastir(undefined, undefined, 1)) === 'ATLANDI');
assert('ref 0, app 0 → OK', durum(K.karsilastir(0, 0, 1)) === 'OK');
assert('ref 0, app ≠ 0 → SAPMA (sıfıra bölme yok)', durum(K.karsilastir(5, 0, 1)) === 'SAPMA');

// ── guard: kaynak hatası ATLANDI'dır ──────────────────────────────────────
const g = await K.guard(async () => { throw new Error('ağ yok'); });
assert('guard hata → ATLANDI', g.durum === 'ATLANDI' && g.neden.includes('ağ yok'));
assert('guard sonucu aynen geçirir', (await K.guard(async () => ({ durum: 'OK' }))).durum === 'OK');

// ── gramRef / altın sabitleri ─────────────────────────────────────────────
// 4.000 $ ons × 40 TL = 160.000 TL ÷ 31,1034768 ≈ 5.144,12 TL/gr
assert('gramRef hesabı', Math.abs(K.gramRef(4000, 40) - 5144.12) < 0.01, String(K.gramRef(4000, 40)));
assert('gramRef eksik girdi null', K.gramRef(null, 40) === null && K.gramRef(4000, undefined) === null);
assert('çeyrek saf gram 1,6067', Math.abs(K.SAF_GR.CEYREK - 1.6067) < 1e-3);
assert('yarım = 2 çeyrek, tam = 4 çeyrek', Math.abs(K.SAF_GR.YARIM - 2 * K.SAF_GR.CEYREK) < 1e-9 && Math.abs(K.SAF_GR.TAM - 4 * K.SAF_GR.CEYREK) < 1e-9);

// ── hisseKarar ────────────────────────────────────────────────────────────
// Review Focus: seans açık / hafta sonu-tatil karışıklığı.
assert('seans açık → ATLANDI', durum(K.hisseKarar({ app: 300, ref: 250, seansAcik: true })) === 'ATLANDI');
assert('kapalı, %3 sapma → SAPMA', durum(K.hisseKarar({ app: 103, ref: 100, seansAcik: false })) === 'SAPMA');
assert('kapalı, %0,2 sapma → OK', durum(K.hisseKarar({ app: 100.2, ref: 100, seansAcik: false })) === 'OK');
assert('kapalı, ref yok → ATLANDI', durum(K.hisseKarar({ app: 100, ref: null, seansAcik: false })) === 'ATLANDI');

// ── etiketKarar ───────────────────────────────────────────────────────────
const NOW = 1_000_000_000_000;
assert('canlı fiyat, delayed=false → OK', durum(K.etiketKarar({ delayed: false, time: NOW - 60_000 }, false, 30 * 60_000, NOW)) === 'OK');
assert('gecikmeli olması gereken canlı etiketli → SAPMA', durum(K.etiketKarar({ delayed: false, time: NOW }, true, null, NOW)) === 'SAPMA');
assert('eski veri → SAPMA', durum(K.etiketKarar({ delayed: false, time: NOW - 3_600_000 }, false, 30 * 60_000, NOW)) === 'SAPMA');
assert('yaş sınırı yoksa eski veri OK', durum(K.etiketKarar({ delayed: true, time: NOW - 9e8 }, true, null, NOW)) === 'OK');
assert('fiyat yok → ATLANDI', durum(K.etiketKarar(null, false)) === 'ATLANDI');

// ── temelKarar ────────────────────────────────────────────────────────────
// 0.16.1 FAVÖK hatasının kanıtı (TUPRS 2026/6): 3H 62.373.927.000 + 4B 8.872.312.000 = 71.246.239.000;
// eski 3DF tabanlı hesap 67.898 mn veriyordu.
const items = [
  { code: '3H', value: 62_373_927_000 }, { code: '4B', value: 8_872_312_000 }, { code: '3Z', value: 10_000_000_000 },
];
const fOk = {
  type: 'sanayi', latest: '2026/6', lastPeriodItems: items,
  cumulative: [{ ebitda: 71_246_239_000, netIncome: 10_000_000_000 }],
  quarterly: [2.5e9, 2.5e9, 2.5e9, 2.5e9].map((netIncome) => ({ netIncome })),
};
const st = { pe: 8, mcapTL: 80_000_000_000, period: '2026/6' }; // 80 mlr ÷ 10 mlr = 8
const tOk = K.temelKarar(fOk, st);
assert('doğru FAVÖK OK', tOk.find((r) => r.ad === 'FAVÖK').durum === 'OK');
assert('doğru net kâr OK', tOk.find((r) => r.ad === 'Net kâr').durum === 'OK');
assert('doğru F/K OK', tOk.find((r) => r.ad === 'F/K').durum === 'OK');
// İş Yatırım F/K'yı 1 ondalığa yuvarlar: 3,0 ↔ 2,97 gerçek sapma değil.
const peOf = (pe, mcapTL) => K.temelKarar(fOk, { pe, mcapTL }).find((r) => r.ad === 'F/K').durum;
assert('yuvarlama farkı (3,0 ↔ 2,97) OK', peOf(3.0, 29_700_000_000) === 'OK');
assert('gerçek F/K sapması (12 ↔ 8) SAPMA', peOf(12, 80_000_000_000) === 'SAPMA');
const tBad = K.temelKarar({ ...fOk, cumulative: [{ ebitda: 67_898_000_000, netIncome: 10_000_000_000 }] }, st);
assert('eski 3DF tabanlı FAVÖK SAPMA yakalanır', tBad.find((r) => r.ad === 'FAVÖK').durum === 'SAPMA');
// Review Focus: banka ve zarar eden şirket.
const tBank = K.temelKarar({ ...fOk, type: 'banka' }, st);
assert('banka FAVÖK ATLANDI', tBank.find((r) => r.ad === 'FAVÖK').durum === 'ATLANDI');
const tLoss = K.temelKarar({ ...fOk, quarterly: [-1e9, -1e9, -1e9, -1e9].map((netIncome) => ({ netIncome })) }, st);
assert('12 aylık zarar → F/K ATLANDI', tLoss.find((r) => r.ad === 'F/K').durum === 'ATLANDI');
const tNull = K.temelKarar({ ...fOk, quarterly: [{ netIncome: 1 }, { netIncome: null }, { netIncome: 1 }, { netIncome: 1 }] }, st);
assert('eksik çeyrek → F/K ATLANDI', tNull.find((r) => r.ad === 'F/K').durum === 'ATLANDI');
assert('ham satır yok → FAVÖK ATLANDI', K.temelKarar({ ...fOk, lastPeriodItems: [] }, st).find((r) => r.ad === 'FAVÖK').durum === 'ATLANDI');
assert('evrende olmayan hisse (st null) çökmez', K.temelKarar(fOk, null).find((r) => r.ad === 'F/K').durum === 'ATLANDI');

// ── portfoyKarar ──────────────────────────────────────────────────────────
const S = {
  fx: { TRY: 1, USD: 40 },
  holdings: [
    { qty: 100, price: 300, currency: 'TRY', value: 30_000 },
    { qty: 2, price: 200, currency: 'USD', value: 16_000 },
  ],
  positions: [{ value: 30_000 }, { value: 16_000 }],
  cash: [{ valueTRY: 4_000 }],
  totals: { holdingsValue: 46_000, value: 50_000, cash: 4_000 },
};
assert('tutarlı portföy tamamı OK', K.portfoyKarar(S).every((r) => r.durum === 'OK'), K.portfoyKarar(S).map(durum).join());
// Review Focus: boş portföy çökmez.
assert('boş portföy ATLANDI', K.portfoyKarar({ holdings: [], totals: {} })[0].durum === 'ATLANDI');
assert('özet yok (null) ATLANDI', K.portfoyKarar(null)[0].durum === 'ATLANDI');
const bozuk = { ...S, totals: { ...S.totals, holdingsValue: 40_000 } };
assert('toplam bileşenlerle uyuşmazsa SAPMA', K.portfoyKarar(bozuk).some((r) => r.durum === 'SAPMA'));
const nakitsiz = { ...S, totals: { ...S.totals, value: 46_000, cash: null } };
assert('nakit takibi kapalıyken nakit toplanmaz', K.portfoyKarar(nakitsiz).find((r) => r.ad === 'Toplam değer').durum === 'OK');
const eksikKur = { ...S, holdings: [{ ...S.holdings[0] }, { ...S.holdings[1], missingFx: true }] };
assert('eksik kurda platform toplamı ATLANDI', K.portfoyKarar(eksikKur).find((r) => r.ad === 'Σ platform değeri').durum === 'ATLANDI');

// ── İnceleme düzeltmeleri ─────────────────────────────────────────────────
// Önemli 1: İş Yatırım verisi tazelenemediyse (eski önbellek) hisse kontrolü yalancı SAPMA vermemeli.
assert('eski İş Yatırım verisi → hisse ATLANDI', durum(K.hisseKarar({ app: 103, ref: 100, seansAcik: false, isyTaze: false })) === 'ATLANDI');
assert('taze İş Yatırım verisi → hisse karşılaştırılır', durum(K.hisseKarar({ app: 103, ref: 100, seansAcik: false, isyTaze: true })) === 'SAPMA');

// Önemli 2: Truncgil yokken gram altın Yahoo vadeli yedeğinden gelir; aynı formülü kendisiyle karşılaştırmak anlamsız.
const gramYedek = { price: 5100, source: 'Yahoo (vadeli, yaklaşık)', delayed: true, time: NOW };
const ons = { price: 4000 }, usd = { price: 40 };
assert('yedek kaynaktan gram → ATLANDI', durum(K.gramKarar(gramYedek, ons, usd)) === 'ATLANDI');
assert('Truncgil gram, doğru değer → OK', durum(K.gramKarar({ price: 5150, source: 'Truncgil', delayed: false }, ons, usd)) === 'OK');
assert('Truncgil gram, %5 sapma → SAPMA', durum(K.gramKarar({ price: 5400, source: 'Truncgil', delayed: false }, ons, usd)) === 'SAPMA');
assert('gram fiyatı yok → ATLANDI', durum(K.gramKarar(undefined, ons, usd)) === 'ATLANDI');
assert('yedek kaynak etiketi tazelikte SAPMA değil ATLANDI', durum(K.etiketKarar(gramYedek, false, null, NOW)) === 'ATLANDI');

// Önemli 3: İki kaynağın dönemleri farklıysa F/K karşılaştırılmaz; biçimler farklıdır (6/2026 ↔ 2026/6).
assert('dönem anahtarı iki biçimi eşitler', K.donemAnahtar('6/2026') === '2026/6' && K.donemAnahtar('2026/6') === '2026/6');
assert('dönem anahtarı geçersiz girdide null', K.donemAnahtar(null) === null && K.donemAnahtar('abc') === null);
assert('gerçek biçimle (6/2026 ↔ 2026/6) eşleşen dönem OK', K.temelKarar(fOk, { ...st, period: '6/2026' }).find((r) => r.ad === 'F/K').durum === 'OK');
assert('dönem uyuşmuyorsa F/K ATLANDI', K.temelKarar(fOk, { ...st, pe: 12, period: '3/2026' }).find((r) => r.ad === 'F/K').durum === 'ATLANDI');

// Önemli 4: TCMB kuru önceki iş gününe aittir; pazar ve pazartesi sabahı sapma doğal olarak büyür.
const CUMA = new Date('2026-10-02T11:00:00+03:00'), PZT = new Date('2026-10-05T10:00:00+03:00'), PAZ = new Date('2026-10-04T12:00:00+03:00');
assert('hafta içi %0,9 fx sapması → SAPMA', durum(K.fxKarar({ app: 100.9, ref: 100, simdi: CUMA })) === 'SAPMA');
assert('hafta içi %0,1 fx sapması → OK', durum(K.fxKarar({ app: 100.1, ref: 100, simdi: CUMA })) === 'OK');
assert('pazartesi fx sapması → ATLANDI', durum(K.fxKarar({ app: 100.9, ref: 100, simdi: PZT })) === 'ATLANDI');
assert('pazar fx sapması → ATLANDI', durum(K.fxKarar({ app: 100.9, ref: 100, simdi: PAZ })) === 'ATLANDI');

// ── rapor / cikisKodu ─────────────────────────────────────────────────────
const R = (d) => ({ grup: 'G', ad: 'a', durum: d });
assert('SAPMA varsa çıkış 1', K.cikisKodu([R('OK'), R('SAPMA')]) === 1);
assert('hepsi ATLANDI ise çıkış 2 (sahte yeşil yok)', K.cikisKodu([R('ATLANDI'), R('ATLANDI')]) === 2);
assert('boş sonuç çıkış 2', K.cikisKodu([]) === 2);
assert('OK + ATLANDI çıkış 0', K.cikisKodu([R('OK'), R('ATLANDI')]) === 0);
const metin = K.rapor([{ grup: 'Döviz', ad: 'USDTRY', durum: 'OK', sapmaPct: 0.1234, app: 41.5, ref: 41.45 }, R('SAPMA')]);
assert('rapor özet satırı', metin.endsWith('OK 1 · SAPMA 1 · ATLANDI 0'), metin.split('\n').at(-1));
assert('rapor yüzde biçimi', metin.includes('%0.123'));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);

// Takvim: ayrıştırma ve kurallar. Çevrimdışı; KAP ve TCMB'ye gitmez.
import fs from 'node:fs';
import {
  trDate, parseTcmb, legalDeadline, expectedDate, candidatePeriods, bilancoEvents, marketSeasonEvents,
  corporateEvents, buildCalendar, defaultWindow, groupKey, istanbulToday, addDays, plausibleAnnouncements, LATE_GRACE_DAYS, isConsolidated,
} from '../server/takvim.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const has = (list, type, date, symbol = null) => list.some((e) => e.type === type && e.date === date && e.symbol === symbol);
const FIX = fs.readFileSync(new URL('./fixtures/tcmb-takvim.html', import.meta.url), 'utf8');

// ── trDate ────────────────────────────────────────────────────────────────
assert('Türkçe ay adı: Şubat', trDate('12 Şubat 2026') === '2026-02-12');
assert('Türkçe ay adı: Ağustos', trDate('13 Ağustos 2026') === '2026-08-13');
assert('tek haneli gün', trDate('5 Mayıs 2026') === '2026-05-05');
assert('olmayan gün (30 Şubat) null', trDate('30 Şubat 2026') === null);
assert('bozuk metin / boş / nbsp null', trDate('bozuk') === null && trDate('') === null && trDate(' ') === null && trDate(null) === null);
assert('bilinmeyen ay null', trDate('12 Foo 2026') === null);

// ── parseTcmb (gerçek sayfa kopyası) ──────────────────────────────────────
const tc = parseTcmb(FIX);
assert('PPK karar ≥ 8', tc.filter((e) => e.type === 'ppk_karar').length >= 8, String(tc.filter((e) => e.type === 'ppk_karar').length));
assert('22 Ocak 2026 PPK kararı', has(tc, 'ppk_karar', '2026-01-22'));
assert('29 Ocak 2026 toplantı özeti', has(tc, 'ppk_ozet', '2026-01-29'));
assert('12 Şubat 2026 Enflasyon Raporu', has(tc, 'enflasyon_raporu', '2026-02-12'));
assert('22 Mayıs 2026 Finansal İstikrar Raporu', has(tc, 'fin_istikrar', '2026-05-22'));
assert('boş hücre olay üretmez (Ocak satırında istikrar raporu yok)', !tc.some((e) => e.type === 'fin_istikrar' && e.date < '2026-05-01'));
assert('TCMB olayları: kind tcmb, sembolsüz, kesin', tc.every((e) => e.kind === 'tcmb' && e.symbol === null && e.certainty === 'kesin'));
assert('2027 satırları da okunur', tc.some((e) => e.date.startsWith('2027-')));
assert('sütun adı değişirse hata', throws(() => parseTcmb(FIX.replace('Enflasyon Raporu', 'Başka Rapor')), /sütun/));
assert('tablo yoksa hata', throws(() => parseTcmb('<html><body>bakım</body></html>'), /bulunamadı/));
assert('boş girdi hata', throws(() => parseTcmb(''), /bulunamadı/));
const short = FIX.replace(/<tbody>[\s\S]*<\/tbody>/, '<tbody><tr><td>22 Ocak 2026</td><td>29 Ocak 2026</td><td></td><td></td></tr></tbody>');
assert('8\'den az PPK karar tarihi hata', throws(() => parseTcmb(short), /8/));

// ── legalDeadline ─────────────────────────────────────────────────────────
assert('3. çeyrek 2026 konsolide: 9 Kasım (pazartesi)', legalDeadline({ period: 3, year: 2026, consolidated: true }) === '2026-11-09');
assert('3. çeyrek 2026 solo: 30 Ekim (cuma)', legalDeadline({ period: 3, year: 2026, consolidated: false }) === '2026-10-30');
assert('3. çeyrek 2025 konsolide: 9 Kasım pazara denk gelir → pazartesi 10 Kasım', legalDeadline({ period: 3, year: 2025, consolidated: true }) === '2025-11-10');
assert('6 ay 2026 konsolide: 29 Ağustos cumartesi → 31 Ağustos', legalDeadline({ period: 2, year: 2026, consolidated: true }) === '2026-08-31');
assert('1. çeyrek 2026 konsolide: 10 Mayıs pazar → 11 Mayıs', legalDeadline({ period: 1, year: 2026, consolidated: true }) === '2026-05-11');
assert('yıllık 2025 konsolide: yıl sonu taşar → 11 Mart 2026', legalDeadline({ period: 4, year: 2025, consolidated: true }) === '2026-03-11');
assert('yıllık 2025 solo: 1 Mart pazar → 2 Mart', legalDeadline({ period: 4, year: 2025, consolidated: false }) === '2026-03-02');
assert('bilinmeyen dönem hata', throws(() => legalDeadline({ period: 5, year: 2026, consolidated: true }), /dönem/));
// Gözlenen gerçek açıklamalar (THYAO, konsolide) hesaplanan son teslimi aşmamalı: kuralın doğruluk kanıtı.
const OBS = [[3, 2025, '2025-11-07'], [4, 2025, '2026-03-04'], [1, 2026, '2026-04-29'], [2, 2026, '2026-08-05']];
assert('THYAO gözlemleri yasal son teslimi aşmaz', OBS.every(([p, y, d]) => d <= legalDeadline({ period: p, year: y, consolidated: true })));

// ── expectedDate ──────────────────────────────────────────────────────────
assert('geçen yıl cuma → bu yıl cumartesi → önceki iş günü', expectedDate('2025-11-07', '2026-11-09') === '2026-11-06');
assert('hafta içi aynen taşınır', expectedDate('2025-08-05', '2026-08-31') === '2026-08-05');
assert('29 Şubat → 28 Şubat', expectedDate('2024-02-29', '2025-03-11') === '2025-02-28');
assert('son teslimi geçmez', expectedDate('2025-11-10', '2026-11-09') === '2026-11-09');

// ── candidatePeriods ──────────────────────────────────────────────────────
const cp = candidatePeriods('2026-10-02');
assert('2 Ekim 2026: 2026/3 ve 2026/2', cp.length === 2 && cp[0].period === 3 && cp[0].year === 2026 && cp[1].period === 2 && cp[1].year === 2026);
const cp2 = candidatePeriods('2026-02-10');
assert('Şubat başı: 2025/4 ve 2025/3 (yıl sınırı)', cp2[0].period === 4 && cp2[0].year === 2025 && cp2[1].period === 3 && cp2[1].year === 2025);
const cp3 = candidatePeriods('2026-09-30');
assert('dönem sonu günü o dönem henüz aday değil', cp3[0].period === 2 && cp3[0].year === 2026);

// ── plausibleAnnouncements ────────────────────────────────────────────────
// KAP'ta yıllar sonra gelen düzeltme/yeniden sunum kayıtları ilk açıklama sayılmaz (ASELS 2025/1, 25 Eylül 2026 gibi).
const rec = (period, year, date) => ({ period, year, date });
const pl1 = plausibleAnnouncements([rec(1, 2025, '2026-09-25'), rec(3, 2025, '2025-11-04')], true);
assert('17 ay sonra gelen kayıt atılır, asıl açıklama kalır', pl1.length === 1 && pl1[0].period === 3);
assert('tam son teslim + 90 gün kalır', plausibleAnnouncements([rec(3, 2025, '2026-02-08')], true).length === 1 && LATE_GRACE_DAYS === 90);
assert('son teslim + 91 gün atılır', plausibleAnnouncements([rec(3, 2025, '2026-02-09')], true).length === 0);
assert('gerçekten geç ama makul açıklama kalır (son teslimden 20 gün sonra)', plausibleAnnouncements([rec(3, 2025, '2025-11-30')], true).length === 1);
assert('bilinmeyen dönem numarası atılır, çökmez', plausibleAnnouncements([rec(7, 2025, '2025-11-04'), rec(0, 2025, '2025-11-04')], true).length === 0);
assert('konsolide bilinmiyorsa (null) konsolide süre', plausibleAnnouncements([rec(3, 2025, '2025-11-04')], null).length === 1);
assert('boş girdi boş liste', plausibleAnnouncements([], true).length === 0);

// ── isConsolidated ────────────────────────────────────────────────────────
// Gerçek KAP başlıkları: "(Konsolide)" ve "(Konsolide Olmayan)"; ikincisi solo şirkettir ve "konsolide" sözcüğünü de içerir.
assert('(Konsolide) → konsolide', isConsolidated(['Faaliyet Raporu (Konsolide)', 'Finansal Rapor']) === true);
assert('(Konsolide Olmayan) → solo (konsolide sayılmaz)', isConsolidated(['Sorumluluk Beyanı (Konsolide Olmayan)']) === false);
assert('büyük harf Türkçe: KONSOLİDE', isConsolidated(['SORUMLULUK BEYANI (KONSOLİDE)']) === true);
assert('büyük harf Türkçe: KONSOLİDE OLMAYAN', isConsolidated(['FAALİYET RAPORU (KONSOLİDE OLMAYAN)']) === false);
assert('konsolidasyon ifadesi yoksa bilinmiyor (null), solo varsayılmaz', isConsolidated(['Finansal Rapor', 'Entegre Rapor', 'TSRS Uyumlu Sürdürülebilirlik Raporu']) === null);
assert('hiç kayıt yoksa null', isConsolidated([]) === null);
assert('null / boş başlıklar çökmez', isConsolidated([null, undefined, '']) === null);
assert('karışık kayıtta konsolide öncelikli', isConsolidated(['Faaliyet Raporu (Konsolide)', 'Sorumluluk Beyanı (Konsolide Olmayan)']) === true);

// ── bilancoEvents ─────────────────────────────────────────────────────────
const T = '2026-10-02';
const ANN = [{ period: 3, year: 2025, date: '2025-11-07' }, { period: 2, year: 2026, date: '2026-08-05' }];
const b1 = bilancoEvents({ symbol: 'THYAO', today: T, announced: ANN, consolidated: true });
assert('açıklanmamış dönem: son teslim', has(b1, 'bilanco_son_teslim', '2026-11-09', 'THYAO'));
assert('açıklanmamış dönem: beklenen = geçen yılın günü (iş gününe çekilmiş)', has(b1, 'bilanco_beklenen', '2026-11-06', 'THYAO'));
assert('açıklanmış dönem: açıkladı (kesin, gerçek tarih)', b1.some((e) => e.type === 'bilanco_aciklandi' && e.date === '2026-08-05' && e.certainty === 'kesin'));
assert('açıklanmış dönem beklenen/son teslim üretmez', !b1.some((e) => ['bilanco_beklenen', 'bilanco_son_teslim'].includes(e.type) && e.data.period === 2));
assert('tahmini olaylar tahmini etiketli', b1.filter((e) => e.type !== 'bilanco_aciklandi').every((e) => e.certainty === 'tahmini'));
assert('beklenen olay geçen yıl tarihini ve son teslimi taşır', b1.find((e) => e.type === 'bilanco_beklenen').data.lastYear === '2025-11-07' && b1.find((e) => e.type === 'bilanco_beklenen').data.deadline === '2026-11-09');
const b2 = bilancoEvents({ symbol: 'YENI', today: T, announced: [{ period: 2, year: 2026, date: '2026-08-05' }], consolidated: true });
assert('geçen yıl kaydı yoksa yalnız son teslim', has(b2, 'bilanco_son_teslim', '2026-11-09', 'YENI') && !b2.some((e) => e.type === 'bilanco_beklenen'));
const b3 = bilancoEvents({ symbol: 'X', today: T, announced: [], consolidated: null });
assert('konsolide bilinmiyorsa konsolide süre ve assumed', b3.find((e) => e.type === 'bilanco_son_teslim' && e.data.period === 3).date === '2026-11-09' && b3.every((e) => e.type !== 'bilanco_son_teslim' || e.data.assumed === true));
const b4 = bilancoEvents({ symbol: 'X', today: T, announced: [], consolidated: false });
assert('solo şirket kısa süre (30 gün)', has(b4, 'bilanco_son_teslim', '2026-10-30', 'X') && b4.every((e) => e.data.assumed === false));
const b5 = bilancoEvents({ symbol: 'X', today: T, announced: [{ period: 3, year: 2026, date: '2026-10-01' }], consolidated: true });
assert('yeni açıklanan dönem: açıkladı, 3. dönem için beklenen yok', has(b5, 'bilanco_aciklandi', '2026-10-01', 'X') && !b5.some((e) => e.data.period === 3 && e.type !== 'bilanco_aciklandi'));

// ── marketSeasonEvents ────────────────────────────────────────────────────
const ms = marketSeasonEvents(T);
assert('Tümü: sembolsüz sezon son teslimleri', ms.length === 2 && ms.every((e) => e.symbol === null && e.data.market === true && e.type === 'bilanco_son_teslim'));
assert('Tümü: 3. dönem 9 Kasım, 2. dönem 31 Ağustos', has(ms, 'bilanco_son_teslim', '2026-11-09') && has(ms, 'bilanco_son_teslim', '2026-08-31'));

// ── corporateEvents ───────────────────────────────────────────────────────
const ce = corporateEvents([
  { code: 'AEFES', date: '2026-10-05', dpsGross: 0.1698, cashGrossPct: 16.98, bonusPct: 0, bonusDivPct: 0, rightsPct: 0 },
  { code: 'XYZ', date: '2026-10-06', dpsGross: 0, cashGrossPct: 0, bonusPct: 100, bonusDivPct: 0, rightsPct: 0 },
  { code: 'ABC', date: '2026-10-07', dpsGross: 1, cashGrossPct: 10, bonusPct: 20, bonusDivPct: 5, rightsPct: 50 },
  { code: 'NODATE', date: null, dpsGross: 1 },
  { code: 'EMPTY', date: '2026-10-08', dpsGross: 0, cashGrossPct: 0, bonusPct: 0, bonusDivPct: 0, rightsPct: 0 },
]);
assert('nakit temettü: temettu / temettu türü, brüt hisse başı', ce.some((e) => e.type === 'temettu' && e.symbol === 'AEFES' && e.kind === 'temettu' && e.data.dps === 0.1698));
assert('bedelsiz: sermaye grubu', ce.some((e) => e.type === 'bedelsiz' && e.symbol === 'XYZ' && e.kind === 'sermaye' && e.data.pct === 100));
assert('bir kayıttan dört olay', ce.filter((e) => e.symbol === 'ABC').length === 4);
assert('tarihsiz ve boş kayıtlar atlanır', !ce.some((e) => e.symbol === 'NODATE' || e.symbol === 'EMPTY'));
assert('tümü kesin', ce.every((e) => e.certainty === 'kesin'));
assert('boş girdi boş liste', corporateEvents([]).length === 0);

// ── buildCalendar ─────────────────────────────────────────────────────────
const E = [
  { date: '2026-10-05', type: 'temettu', kind: 'temettu', symbol: 'AEFES', certainty: 'kesin', data: {} },
  { date: '2026-10-05', type: 'ppk_karar', kind: 'tcmb', symbol: null, certainty: 'kesin', data: {} },
  { date: '2026-10-05', type: 'bilanco_aciklandi', kind: 'bilanco', symbol: 'THYAO', certainty: 'kesin', data: {} },
  { date: '2026-10-04', type: 'temettu', kind: 'temettu', symbol: 'ZZZ', certainty: 'kesin', data: {} },
  { date: '2026-10-05', type: 'temettu', kind: 'temettu', symbol: 'AEFES', certainty: 'kesin', data: {} }, // kopya
];
const cal = buildCalendar({ from: '2026-10-04', to: '2026-10-05', events: E });
assert('pencere iki ucu dahil', cal.some((e) => e.date === '2026-10-04') && cal.some((e) => e.date === '2026-10-05'));
assert('aynı gün sırası: PPK, bilanço, temettü', cal.filter((e) => e.date === '2026-10-05').map((e) => e.type).join() === 'ppk_karar,bilanco_aciklandi,temettu');
assert('kopya olay tekilleşir', cal.filter((e) => e.type === 'temettu' && e.symbol === 'AEFES').length === 1);
assert('tarih sırası', cal[0].date === '2026-10-04');
assert('pencere dışı olay atılır', buildCalendar({ from: '2026-10-05', to: '2026-10-05', events: E }).every((e) => e.date === '2026-10-05'));
assert('tür süzgeci', buildCalendar({ from: '2026-10-04', to: '2026-10-05', events: E, kinds: ['tcmb'] }).every((e) => e.kind === 'tcmb'));
assert('boş tür listesi hepsi demektir', buildCalendar({ from: '2026-10-04', to: '2026-10-05', events: E, kinds: [] }).length === 4);
assert('boş olay listesi boş', buildCalendar({ from: '2026-10-04', to: '2026-10-05', events: [] }).length === 0);
assert('366 günden uzun pencere reddedilir', throws(() => buildCalendar({ from: '2026-01-01', to: '2027-01-03', events: E }), /366/));
assert('tam 366 gün kabul', !throws(() => buildCalendar({ from: '2026-01-01', to: '2027-01-02', events: E }), /366/));
assert('from > to reddedilir', throws(() => buildCalendar({ from: '2026-10-05', to: '2026-10-04', events: E }), /sonra/));
assert('geçersiz tarih reddedilir', throws(() => buildCalendar({ from: '2026-13-01', to: '2026-10-04', events: E }), /biçiminde/));
const dw = defaultWindow('2026-10-02');
assert('varsayılan pencere −7 / +60', dw.from === '2026-09-25' && dw.to === '2026-12-01');

// ── groupKey / istanbulToday ──────────────────────────────────────────────
assert('bugün', groupKey('2026-10-02', '2026-10-02') === 'bugun');
assert('yarın', groupKey('2026-10-03', '2026-10-02') === 'yarin');
assert('2–6 gün sonrası: bu hafta', groupKey('2026-10-04', '2026-10-02') === 'hafta' && groupKey('2026-10-08', '2026-10-02') === 'hafta');
assert('7 gün sonrası: tarih', groupKey('2026-10-09', '2026-10-02') === 'tarih');
assert('önceki günler: son günler', groupKey('2026-09-30', '2026-10-02') === 'son_gunler');
assert('gece yarısı sınırı: UTC 21:30 İstanbul\'da ertesi gün', istanbulToday(Date.parse('2026-10-02T21:30:00Z')) === '2026-10-03');
assert('UTC 20:59 hâlâ aynı gün', istanbulToday(Date.parse('2026-10-02T20:59:00Z')) === '2026-10-02');
assert('addDays ay/yıl taşması', addDays('2026-12-31', 1) === '2027-01-01' && addDays('2026-03-01', -1) === '2026-02-28');

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);

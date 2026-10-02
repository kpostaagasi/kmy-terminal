// Takvim: olay üretimi ve kurallar. Saf mantık (veritabanı ve ağ yok); ağ ve önbellek takvim-kaynak.js'tedir.
// Olay biçimi: { date: 'YYYY-MM-DD', type, kind, symbol|null, certainty: 'kesin'|'tahmini', data }

export const KINDS = ['temettu', 'sermaye', 'tcmb', 'bilanco'];
// Aynı günde gösterim sırası
export const TYPE_ORDER = ['ppk_karar', 'ppk_ozet', 'enflasyon_raporu', 'fin_istikrar', 'bilanco_aciklandi', 'bilanco_beklenen', 'bilanco_son_teslim', 'temettu', 'bedelsiz', 'bedelsiz_temettu', 'bedelli'];

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// ── Tarih yardımcıları (hepsi UTC gün aritmetiği; "YYYY-MM-DD" metni takvim günüdür) ──
const toMs = (d) => Date.parse(`${d}T00:00:00Z`);
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => isoOf(toMs(d) + n * 86400_000);
export const weekday = (d) => new Date(toMs(d)).getUTCDay(); // 0 pazar … 6 cumartesi
const nextBusiness = (d) => { while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1); return d; };
const prevBusiness = (d) => { while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1); return d; };
const validIso = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(toMs(d)) && isoOf(toMs(d)) === d;

/** İstanbul takvim günü. */
export function istanbulToday(nowMs = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** "22 Ocak 2026" → "2026-01-22"; geçersiz ya da boşsa null. */
export function trDate(text) {
  const m = /^(\d{1,2}) (\S+) (\d{4})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2]);
  if (mi < 0) return null;
  const iso = `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return validIso(iso) ? iso : null;
}

const ev = (date, type, kind, symbol, certainty, data = {}) => ({ date, type, kind, symbol, certainty, data });

// ── TCMB ────────────────────────────────────────────────────────────────
const TCMB_COLS = [['ppk_karar', /karar/], ['ppk_ozet', /özet/], ['enflasyon_raporu', /enflasyon raporu/], ['fin_istikrar', /istikrar/]];
const cellText = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();

/**
 * tcmb.gov.tr takvim sayfasındaki tabloyu olaylara çevirir. Hücre bazlı okunur (boş hücreler korunur).
 * Biçim değişirse (tablo yok, sütun adları değişmiş, 8'den az PPK karar tarihi) hata fırlatır;
 * sessizce boş liste dönmez.
 */
export function parseTcmb(html) {
  const table = /<table[\s\S]*?<\/table>/i.exec(String(html ?? ''))?.[0];
  if (!table) throw new Error('TCMB takvim tablosu bulunamadı');
  const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((c) => cellText(c[0])));
  const head = (rows[0] || []).map((x) => x.toLocaleLowerCase('tr'));
  if (head.length < 4 || !TCMB_COLS.every(([, re], i) => re.test(head[i]))) throw new Error('TCMB takvim sütunları değişmiş');
  const out = [];
  for (const cells of rows.slice(1)) {
    TCMB_COLS.forEach(([type], i) => {
      const date = trDate(cells[i]);
      if (date) out.push(ev(date, type, 'tcmb', null, 'kesin'));
    });
  }
  if (out.filter((e) => e.type === 'ppk_karar').length < 8) throw new Error('TCMB takvimi beklenenden kısa (8\'den az PPK karar tarihi)');
  return out;
}

// ── Bilanço ─────────────────────────────────────────────────────────────
const PERIOD_END = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };
// SPK II-14.1: [konsolide olmayan, konsolide] yasal gün sayısı (3 ve 9 aylık 30/40, 6 aylık 50/60, yıllık 60/70)
const LEGAL_DAYS = { 1: [30, 40], 2: [50, 60], 3: [30, 40], 4: [60, 70] };

export const periodEnd = (period, year) => {
  if (!PERIOD_END[period]) throw new Error(`Bilinmeyen dönem: ${period}`);
  return `${year}-${PERIOD_END[period]}`;
};

/** Yasal son teslim: dönem sonu + yasal gün; hafta sonuna denk gelirse sonraki iş günü (resmî tatiller hesaba katılmaz). */
export function legalDeadline({ period, year, consolidated }) {
  const days = LEGAL_DAYS[period];
  if (!days) throw new Error(`Bilinmeyen dönem: ${period}`);
  return nextBusiness(addDays(periodEnd(period, year), days[consolidated ? 1 : 0]));
}

/** Geçen yılın açıklama gününü bir yıl ileri taşır (29 Şubat → 28 Şubat); hafta sonuna denk gelirse önceki iş günü; son teslimi geçmez. */
export function expectedDate(lastYearIso, deadlineIso) {
  const [y, m, d] = lastYearIso.split('-').map(Number);
  let ms = Date.UTC(y + 1, m - 1, d);
  if (new Date(ms).getUTCMonth() !== m - 1) ms = Date.UTC(y + 1, m - 1, d - 1);
  const exp = prevBusiness(isoOf(ms));
  return exp > deadlineIso ? deadlineIso : exp;
}

/** Bugünden önce biten son iki dönem (yeniden eskiye). */
export function candidatePeriods(today) {
  const y = Number(today.slice(0, 4));
  const all = [];
  for (const year of [y - 1, y]) for (const period of [1, 2, 3, 4]) all.push({ period, year, end: periodEnd(period, year) });
  return all.filter((c) => c.end < today).sort((a, b) => b.end.localeCompare(a.end)).slice(0, 2);
}

/**
 * KAP finansal rapor başlıklarından konsolide olup olmadığı. Gerçek başlıklar "(Konsolide)" ve "(Konsolide Olmayan)";
 * ikincisi de "konsolide" sözcüğünü içerir, bu yüzden "olmayan" ayrıca denetlenir. Türkçe büyük/küçük harf (KONSOLİDE) desteklenir.
 * true: konsolide · false: solo (yalnız "Konsolide Olmayan" görülmüş) · null: bilinmiyor (başlıklarda konsolidasyon ifadesi yok).
 */
export function isConsolidated(subjects) {
  let cons = 0, solo = 0;
  for (const subject of subjects) {
    const x = String(subject ?? '').toLocaleLowerCase('tr');
    if (!x.includes('konsolide')) continue;
    if (x.includes('olmayan')) solo++; else cons++;
  }
  return cons ? true : solo ? false : null;
}

/** Yasal son teslimden bu kadar gün sonra gelen KAP kaydı ilk açıklama sayılmaz. */
export const LATE_GRACE_DAYS = 90;

/**
 * KAP'ta yıllar sonra gelen düzeltme/yeniden sunum kayıtlarını (ör. 2025/1 dönemi için 2026 Eylül'de yayımlanan)
 * ilk açıklama saymamak için süzer; "geçen yılın tarihi" olarak yanlış kullanılmasın. Bilinmeyen dönem numarası atılır.
 */
export function plausibleAnnouncements(records, consolidated) {
  return records.filter((r) => r.period >= 1 && r.period <= 4
    && r.date <= addDays(legalDeadline({ period: r.period, year: r.year, consolidated: consolidated ?? true }), LATE_GRACE_DAYS));
}

/**
 * Bir hissenin bilanço olayları.
 *  announced:    [{ period, year, date }] KAP'tan, dönem başına en erken açıklama günü
 *  consolidated: true | false | null (hiç kayıt yoksa null → konsolide süre varsayılır, data.assumed)
 */
export function bilancoEvents({ symbol, today, announced = [], consolidated = null }) {
  const out = [];
  for (const { period, year } of candidatePeriods(today)) {
    const rec = announced.find((a) => a.period === period && a.year === year);
    if (rec) { out.push(ev(rec.date, 'bilanco_aciklandi', 'bilanco', symbol, 'kesin', { period, year })); continue; }
    const assumed = consolidated == null;
    const cons = consolidated ?? true;
    const deadline = legalDeadline({ period, year, consolidated: cons });
    out.push(ev(deadline, 'bilanco_son_teslim', 'bilanco', symbol, 'tahmini', { period, year, consolidated: cons, assumed }));
    const last = announced.find((a) => a.period === period && a.year === year - 1);
    if (last) out.push(ev(expectedDate(last.date, deadline), 'bilanco_beklenen', 'bilanco', symbol, 'tahmini', { period, year, lastYear: last.date, deadline }));
  }
  return out;
}

/** "Tümü" kapsamı: hisse bazlı değil, her aday dönem için tek sembolsüz yasal son teslim (konsolide süre). */
export function marketSeasonEvents(today) {
  return candidatePeriods(today).map(({ period, year }) =>
    ev(legalDeadline({ period, year, consolidated: true }), 'bilanco_son_teslim', 'bilanco', null, 'tahmini', { period, year, consolidated: true, assumed: false, market: true }));
}

// ── Temettü ve sermaye artırımı ─────────────────────────────────────────
/** universe.corporateActions kayıtlarını olaylara ayırır (bir kayıttan birden çok olay çıkabilir). */
export function corporateEvents(actions) {
  const out = [];
  for (const a of actions) {
    if (!a.date) continue;
    if (a.dpsGross > 0 || a.cashGrossPct > 0) out.push(ev(a.date, 'temettu', 'temettu', a.code, 'kesin', { dps: a.dpsGross || null, grossPct: a.cashGrossPct || null }));
    if (a.bonusPct > 0) out.push(ev(a.date, 'bedelsiz', 'sermaye', a.code, 'kesin', { pct: a.bonusPct }));
    if (a.bonusDivPct > 0) out.push(ev(a.date, 'bedelsiz_temettu', 'sermaye', a.code, 'kesin', { pct: a.bonusDivPct }));
    if (a.rightsPct > 0) out.push(ev(a.date, 'bedelli', 'sermaye', a.code, 'kesin', { pct: a.rightsPct }));
  }
  return out;
}

// ── Birleştirme ─────────────────────────────────────────────────────────
export const defaultWindow = (today) => ({ from: addDays(today, -7), to: addDays(today, 60) });

/** Pencere [from, to] (iki uç dahil) ve tür süzgeciyle sıralı, tekilleştirilmiş liste. */
export function buildCalendar({ from, to, events, kinds = null }) {
  if (!validIso(from) || !validIso(to)) throw new Error('Tarih YYYY-AA-GG biçiminde olmalı');
  if (from > to) throw new Error('Başlangıç tarihi bitişten sonra olamaz');
  if ((toMs(to) - toMs(from)) / 86400_000 > 366) throw new Error('Pencere en çok 366 gün olabilir');
  const want = new Set(kinds && kinds.length ? kinds : KINDS);
  const seen = new Set();
  const rank = (t) => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? TYPE_ORDER.length : i; };
  return events
    .filter((e) => e.date >= from && e.date <= to && want.has(e.kind))
    .filter((e) => { const k = `${e.date}|${e.type}|${e.symbol ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date) || rank(a.type) - rank(b.type) || String(a.symbol ?? '').localeCompare(String(b.symbol ?? '')));
}

/** Gün grubu: son_gunler (önceki 7 gün) · bugun · yarin · hafta (2–6 gün sonra) · tarih. */
export function groupKey(date, today) {
  if (date < today) return 'son_gunler';
  if (date === today) return 'bugun';
  if (date === addDays(today, 1)) return 'yarin';
  if (date <= addDays(today, 6)) return 'hafta';
  return 'tarih';
}

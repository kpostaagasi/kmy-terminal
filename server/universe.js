// BIST evreni ve temel veriler: İş Yatırım "Temel Değerler ve Oranlar" sayfası.
// Günde en fazla iki kez çekilir; sunucu kapalıyken bile son başarılı sonuç veritabanında kalır.
//   - Tüm BIST hisseleri: ad, sektör, kapanış, piyasa değeri, halka açıklık, sermaye
//   - Oranlar: F/K, FD/FAVÖK, FD/Satışlar, PD/DD (son bilanço dönemi)
//   - Analist tahminleri: F/K, FD/FAVÖK, PD/DD tahminleri ve prim/iskonto
//   - Getiriler: günlük, haftalık, aylık, yıl içi
//   - Sermaye artırımları ve temettüler (geçmiş + ilan edilmiş gelecek tarihler)
//   - BIST 100 / BIST 30 üyelikleri
import { cacheGet, cachePut } from './db.js';

const URL = 'https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/Temel-Degerler-Ve-Oranlar.aspx';
const TTL = 12 * 3600_000;

// Çevrimdışı yedek listeler (23.09.2026; BIST 100: Matriks ve Borsa MCP ile doğrulandı)
export const FALLBACK_BIST100 = `AEFES AKBNK AKSA AKSEN ALARK ALTNY ANSGR ARCLK ASELS ASTOR BALSU BERA BIMAS BRSAN BRYAT BSOKE BTCIM CANTE CCOLA CIMSA
CVKMD CWENE DAPGM DOAS DOHOL DSTKF ECILC EFOR EKGYO ENERY ENJSA ENKAI EREGL ESEN EUPWR EUREN FENER FROTO GARAN GENIL GESAN GLRMK
GRSEL GRTHO GSRAY GUBRF HALKB HEKTS IEYHO ISCTR ISMEN IZENR KCHOL KLRHO KRDMD KTLEV KUYAS MAGEN MAVI MGROS MIATK MPARK OBAMS ODAS
ODINE OTKAR OYAKC PAHOL PASEU PATEK PETKM PGSUS PSGYO QUAGR RALYH REEDR SAHOL SARKY SASA SISE SKBNK SOKM TAVHL TCELL THYAO TKFEN
TOASO TRALT TRENJ TRMET TSKB TTKOM TUKAS TUPRS TURSG ULKER VAKBN VESTL YKBNK ZOREN`.split(/\s+/).filter(Boolean);
export const FALLBACK_BIST30 = `AEFES AKBNK ASELS ASTOR BIMAS DSTKF EKGYO ENKAI EREGL FROTO GARAN GUBRF ISCTR KCHOL KRDMD MGROS PETKM PGSUS SAHOL SASA
SISE TAVHL TCELL THYAO TOASO TRALT TTKOM TUPRS VAKBN YKBNK`.split(/\s+/).filter(Boolean);

const ENT = { amp: '&', quot: '"', lt: '<', gt: '>', nbsp: ' ', '#39': "'" };
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&(amp|quot|lt|gt|nbsp|#39);/g, (_, k) => ENT[k]);
const text = (h) => decode(h.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// Türkçe sayı biçimi: "411.240,0" → 411240
export function trNum(s) {
  s = String(s ?? '').trim();
  if (!s || s === '-' || /^a\/?d$/i.test(s)) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const trDate = (s) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

function tables(html) {
  const out = [];
  for (const m of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)) {
    const rows = [...m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((r) => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1])));
    if (rows.length > 5) out.push({ head: rows[0].join('|'), rows: rows.slice(1).filter((r) => /^[A-Z0-9]{3,6}$/.test(r[0] || '')) });
  }
  return out;
}

async function fetchPage(endeks) {
  const res = await fetch(`${URL}?endeks=${endeks}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'tr-TR' }, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`İş Yatırım HTTP ${res.status}`);
  return res.text();
}

function parseAll(html) {
  const ts = tables(html);
  const find = (re) => ts.find((t) => re.test(t.head));
  const stocks = {};
  const basic = find(/Hisse Adı/);
  if (!basic || basic.rows.length < 100) throw new Error('İş Yatırım tablo biçimi değişmiş');
  for (const r of basic.rows) {
    stocks[r[0]] = { code: r[0], name: r[1], sector: r[2], close: trNum(r[3]), mcapTL: trNum(r[4]) * 1e6 || null, mcapUSD: trNum(r[5]) * 1e6 || null, freeFloatPct: trNum(r[6]), capital: trNum(r[7]) * 1e6 || null };
  }
  const ratios = find(/FD\/Satışlar/);
  for (const r of ratios?.rows || []) if (stocks[r[0]]) Object.assign(stocks[r[0]], { pe: trNum(r[2]), evEbitda: trNum(r[3]), evSales: trNum(r[4]), pb: trNum(r[5]), period: r[6] || null });
  const rets = find(/Yıl İçi Getiri/);
  for (const r of rets?.rows || []) if (stocks[r[0]]) Object.assign(stocks[r[0]], { ret1d: trNum(r[2]), ret1w: trNum(r[3]), ret1m: trNum(r[4]), retYtd: trNum(r[5]) });
  // Tahmin tablosu: grup başlıklı; satır = kod, kapanış, F/K T., prim, FD/FAVÖK T., prim, PD/DD T., prim
  const est = ts.find((t) => /^\|?F\/K\|FD\/FAVÖK\|PD\/DD/.test(t.head) || (/F\/K/.test(t.head) && t.rows[0]?.length === 8));
  for (const r of est?.rows || []) if (stocks[r[0]] && r.length >= 8) Object.assign(stocks[r[0]], { peF: trNum(r[2]), pePrem: trNum(r[3]), evEbitdaF: trNum(r[4]), evEbitdaPrem: trNum(r[5]), pbF: trNum(r[6]), pbPrem: trNum(r[7]) });
  const acts = find(/BedelliOran/);
  const actions = (acts?.rows || []).map((r) => ({
    code: r[0], date: trDate(r[3]), capitalAfter: trNum(r[2]),
    rightsPct: trNum(r[4]), rightsAmount: trNum(r[5]), otherPct: trNum(r[6]),
    bonusPct: trNum(r[7]), bonusDivPct: trNum(r[8]),
    cashGrossPct: trNum(r[9]), cashTotal: trNum(r[10]), dpsGross: trNum(r[11]),
  })).filter((a) => a.date);
  return { stocks, actions };
}

function membersOf(html) {
  const basic = tables(html).find((t) => /Hisse Adı/.test(t.head));
  return basic ? basic.rows.map((r) => r[0]) : [];
}

// ── Bellek + kalıcı önbellek ─────────────────────────────
let mem = cacheGet('isy:all', 30 * 86400_000); // eski de olsa başlangıçta kullan
let idx = cacheGet('isy:idx', 30 * 86400_000);
let fetchedAt = mem?.at || 0;
let inflight = null;

export async function refresh(force = false) {
  if (!force && mem && Date.now() - fetchedAt < TTL) return mem;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [all, b100, b30] = await Promise.all([fetchPage('09'), fetchPage('01'), fetchPage('03')]);
      const parsed = parseAll(all);
      const m100 = membersOf(b100), m30 = membersOf(b30);
      mem = { ...parsed, at: Date.now() };
      fetchedAt = mem.at;
      cachePut('isy:all', mem);
      if (m100.length >= 95 && m30.length >= 28) { idx = { bist100: m100, bist30: m30, at: Date.now() }; cachePut('isy:idx', idx); }
    } catch (e) {
      console.error('[iş yatırım]', e.message);
      fetchedAt = Date.now() - TTL + 15 * 60_000; // 15 dk sonra yeniden dene
    } finally {
      inflight = null;
    }
    return mem;
  })();
  return inflight;
}

// Senkron erişim (bellekteki son veri); gerekirse arka planda tazeler
function ensure() { if (!mem || Date.now() - fetchedAt > TTL) refresh().catch(() => {}); }

export function stock(code) { ensure(); return mem?.stocks?.[code] || null; }
export function allStocks() { ensure(); return mem ? Object.values(mem.stocks) : []; }
export function status() { return { at: mem?.at || null, stocks: mem ? Object.keys(mem.stocks).length : 0, actions: mem?.actions?.length || 0, indexAt: idx?.at || null }; }

export async function bist100() {
  if (!idx) await refresh();
  return idx?.bist100?.length ? idx.bist100 : FALLBACK_BIST100;
}
export async function bist30() {
  if (!idx) await refresh();
  return idx?.bist30?.length ? idx.bist30 : FALLBACK_BIST30;
}

// Sermaye artırımı / temettü kayıtları (tarih artan)
export async function corporateActions({ symbols = null, from = null, to = null } = {}) {
  if (!mem) await refresh();
  const set = symbols ? new Set(symbols) : null;
  return (mem?.actions || [])
    .filter((a) => (!set || set.has(a.code)) && (!from || a.date >= from) && (!to || a.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Ad veya kod ile yerel arama (Türkçe karakter duyarsız)
const fold = (s) => String(s || '').toLocaleUpperCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/İ/g, 'I').replace(/I/g, 'I');
export function searchLocal(q, limit = 10) {
  ensure();
  if (!mem) return [];
  const Q = fold(q);
  const out = [];
  for (const s of Object.values(mem.stocks)) {
    const code = s.code, name = fold(s.name);
    const score = code === Q ? 3 : code.startsWith(Q) ? 2 : name.startsWith(Q) ? 1.5 : name.includes(Q) ? 1 : 0;
    if (score) out.push({ score, s });
  }
  return out.sort((a, b) => b.score - a.score || (b.s.mcapTL || 0) - (a.s.mcapTL || 0)).slice(0, limit).map(({ s }) => s);
}

// İlk açılışta arka planda yükle
setTimeout(() => refresh().catch(() => {}), 1500);

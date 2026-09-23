// TEFAS yatırım ve emeklilik fonları: güncel birim fiyat, geçmiş fiyat serisi ve fon adı araması.
// Kaynak: TEFAS'ın kendi sitesinin kullandığı herkese açık JSON arayüzü (www.tefas.gov.tr/api/funds/*).
// Fon fiyatları günde bir kez (akşam) açıklanır; önbellek buna göre tutulur. İstekler sıraya alınır (TEFAS 429 döner).
import { cacheGet, cachePut } from './db.js';

const BASE = 'https://www.tefas.gov.tr/api/funds';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';

// Aralık → TEFAS "periyod" kodu (API yalnız bu sabit dönemleri kabul eder; 60 = 5 yıl, en fazla)
const PERIYOD = { '1d': 13, '5d': 13, '1mo': 1, '3mo': 3, '6mo': 6, ytd: 0, '1y': 12, '2y': 36, '5y': 60, '10y': 60, max: 60 };

let chain = Promise.resolve();
let blockedUntil = 0;
/** TEFAS'a sıralı POST (aynı anda tek istek, aralarında kısa bekleme; 429'da ~45 sn geri çekil) */
function post(endpoint, body) {
  const run = async () => {
    if (Date.now() < blockedUntil) throw new Error('TEFAS istek sınırı; biraz sonra yeniden denenecek');
    const res = await fetch(`${BASE}/${endpoint}`, {
      method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    });
    if (res.status === 429) { blockedUntil = Date.now() + 45_000; throw new Error('TEFAS istek sınırı'); }
    if (!res.ok) throw new Error(`TEFAS HTTP ${res.status}`);
    const d = await res.json();
    if (d.errorMessage) throw new Error(`TEFAS: ${d.errorMessage}`);
    await new Promise((r) => setTimeout(r, 250));
    return d.resultList || [];
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

/** Fon kodu mu? TEFAS kodları 3 karakterdir (harf/rakam); BIST payları 4–6 harflidir. */
export const isFundCode = (s) => /^[A-Z0-9]{3}$/.test(String(s || '')) && /[A-Z]/.test(String(s));

// Tüm fonların kodu ve adı (günlük önbellek) — arama ve ad çözümü için
let listMem = null;
export async function fundList() {
  if (listMem && Date.now() - listMem.at < 12 * 3600_000) return listMem.items;
  let items = cacheGet('tefas:list', 24 * 3600_000);
  if (!items) {
    items = (await post('fonUnvanAra', { aranan: '', dil: 'TR' })).map((x) => ({ code: x.fonKodu, name: String(x.fonUnvan || '').trim() }));
    if (items.length) cachePut('tefas:list', items);
  }
  listMem = { at: Date.now(), items };
  return items;
}

export async function fundName(code) {
  const hit = (await fundList().catch(() => [])).find((x) => x.code === code);
  return hit?.name || null;
}

/** Fon adıyla / koduyla arama (yerel liste üzerinden) */
export async function searchFunds(q, limit = 8) {
  const needle = String(q || '').toLocaleUpperCase('tr').trim();
  if (needle.length < 2) return [];
  const list = await fundList().catch(() => []);
  const exact = list.filter((x) => x.code === needle);
  const rest = list.filter((x) => x.code !== needle && (x.code.startsWith(needle) || x.name.toLocaleUpperCase('tr').includes(needle)));
  return [...exact, ...rest].slice(0, limit);
}

/** Geçmiş birim fiyatlar (eskiden yeniye): [{ t, c }] */
export async function fundPrices(code, range = '1y') {
  const periyod = PERIYOD[range] ?? 12;
  const key = `tefas:px:${code}:${periyod}`;
  // Fiyat günde bir açıklanır: gün içinde 1 saat, gece yarısından sonra ilk istekte yenilenir
  const hit = cacheGet(key, 60 * 60_000);
  if (hit) return hit;
  const rows = await post('fonFiyatBilgiGetir', { fonKodu: code, dil: 'TR', periyod });
  const out = rows.filter((r) => r.fiyat > 0 && r.tarih)
    .map((r) => ({ t: Date.parse(`${r.tarih}T18:00:00+03:00`), c: Number(r.fiyat), name: r.fonUnvan }))
    .sort((a, b) => a.t - b.t);
  if (out.length) cachePut(key, out);
  return out;
}

/** Piyasa ekranı ve portföy için fiyat nesnesi (diğer kaynaklarla aynı biçim) */
export async function fundQuote(code) {
  const px = await fundPrices(code, '1mo');
  if (!px.length) return null;
  const last = px.at(-1), prev = px.at(-2) || last;
  return {
    symbol: code, name: last.name || (await fundName(code)) || code, longName: last.name || null,
    price: last.c, prevClose: prev.c, change: last.c - prev.c, changePct: prev.c ? ((last.c - prev.c) / prev.c) * 100 : 0,
    dayHigh: null, dayLow: null, volume: null, high52: null, low52: null, currency: 'TRY', time: last.t,
    exchange: 'TEFAS', type: 'fund', source: 'TEFAS (günlük birim fiyat)', delayed: true,
    spark: px.slice(-20).map((p) => p.c), sparkTimes: px.slice(-20).map((p) => p.t),
  };
}

/** Grafik için mum biçiminde seri (fonlarda açılış/yüksek/düşük = birim fiyat) */
export async function fundBars(code, range = '1y') {
  return (await fundPrices(code, range)).map((p) => ({ t: p.t, o: p.c, h: p.c, l: p.c, c: p.c, v: 0 }));
}

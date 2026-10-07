// Piyasa verisi.
//  - BIST hisse/endeks ve yurt dışı: Yahoo Finance (BIST verisi lisans gereği ~15 dk gecikmelidir)
//  - Döviz, gram altın ve altın türleri: Truncgil (Türkiye piyasası, ~1 dk)
//  - Spot ons altın: gold-api.com
//  - BIST 100 üyeliği, sektörler, temel oranlar: İş Yatırım (universe.js)
// Kullanıcıya görünen semboller BIST kısa kodudur (THYAO); Yahoo karşılığına burada çevrilir.
import https from 'node:https';
import { cacheGet, cachePut, db } from './db.js';
import * as universe from './universe.js';
import { isFundCode, fundQuote, fundBars, searchFunds } from './funds.js';
import { trScore, compareSearchHits } from './fold.js';

const UA = 'Mozilla/5.0';
const Y1 = 'https://query1.finance.yahoo.com';
const Y2 = 'https://query2.finance.yahoo.com';
export const TROY_OUNCE_GRAMS = 31.1034768;

// tg: Truncgil anahtarı · y: Yahoo sembolü (yedek/geçmiş) · bid: değerlemede alış fiyatı kullanılır (geniş makaslı ürünler)
export const SPECIAL = {
  USDTRY: { tg: 'USD', y: 'USDTRY=X', name: 'Dolar/TL', type: 'fx', currency: 'TRY' },
  EURTRY: { tg: 'EUR', y: 'EURTRY=X', name: 'Euro/TL', type: 'fx', currency: 'TRY' },
  GBPTRY: { tg: 'GBP', y: 'GBPTRY=X', name: 'Sterlin/TL', type: 'fx', currency: 'TRY' },
  CHFTRY: { tg: 'CHF', y: 'CHFTRY=X', name: 'Frank/TL', type: 'fx', currency: 'TRY' },
  JPYTRY: { tg: 'JPY', y: 'JPYTRY=X', name: 'Yen/TL', type: 'fx', currency: 'TRY' },
  EURUSD: { y: 'EURUSD=X', name: 'Euro/Dolar', type: 'fx', currency: 'USD' },
  GRAM: { tg: 'GRA', name: 'Gram Altın', type: 'gold', currency: 'TRY', grams: 1 },
  HAS: { tg: 'HAS', name: 'Has Altın (gr)', type: 'gold', currency: 'TRY' },
  CEYREK: { tg: 'CEYREKALTIN', name: 'Çeyrek Altın', type: 'gold', currency: 'TRY', bid: true },
  YARIM: { tg: 'YARIMALTIN', name: 'Yarım Altın', type: 'gold', currency: 'TRY', bid: true },
  TAM: { tg: 'TAMALTIN', name: 'Tam Altın', type: 'gold', currency: 'TRY', bid: true },
  CUMHURIYET: { tg: 'CUMHURIYETALTINI', name: 'Cumhuriyet Altını', type: 'gold', currency: 'TRY', bid: true },
  ATA: { tg: 'ATAALTIN', name: 'Ata Altın', type: 'gold', currency: 'TRY', bid: true },
  BILEZIK22: { tg: 'YIA', name: '22 Ayar Bilezik (gr)', type: 'gold', currency: 'TRY', bid: true },
  GUMUS: { tg: 'GUMUS', name: 'Gram Gümüş', type: 'commodity', currency: 'TRY' },
  ONS: { y: 'GC=F', spot: 'XAU', name: 'Ons Altın ($)', type: 'gold', currency: 'USD' },
  BRENT: { y: 'BZ=F', name: 'Brent Petrol ($)', type: 'commodity', currency: 'USD' },
  BTC: { y: 'BTC-USD', name: 'Bitcoin ($)', type: 'crypto', currency: 'USD' },
  ETH: { y: 'ETH-USD', name: 'Ethereum ($)', type: 'crypto', currency: 'USD' },
  SPX: { y: '^GSPC', name: 'S&P 500', type: 'index', currency: 'USD' },
  NDX: { y: '^NDX', name: 'Nasdaq 100', type: 'index', currency: 'USD' },
  DAX: { y: '^GDAXI', name: 'DAX', type: 'index', currency: 'EUR' },
  VIX: { y: '^VIX', name: 'VIX', type: 'index', currency: 'USD' },
};

export const INDICES = ['XU100', 'XU030', 'XU050', 'XBANK', 'XUSIN', 'XHOLD', 'XUTEK', 'XGIDA', 'XELKT', 'XULAS', 'XKTUM', 'XUTUM'];
export const INDEX_NAMES = {
  XU100: 'BIST 100', XU030: 'BIST 30', XU050: 'BIST 50', XBANK: 'BIST Banka', XUSIN: 'BIST Sınai', XHOLD: 'BIST Holding', XUTEK: 'BIST Teknoloji',
  XGIDA: 'BIST Gıda', XELKT: 'BIST Elektrik', XULAS: 'BIST Ulaştırma', XKTUM: 'BIST Katılım Tüm', XUTUM: 'BIST Tüm',
};
export const OVERVIEW = ['XU100', 'XU030', 'XBANK', 'USDTRY', 'EURTRY', 'GBPTRY', 'CHFTRY', 'GRAM', 'ONS', 'BRENT', 'BTC', 'SPX'];

// ── Seans takvimi ────────────────────────────────────────
// Sabit tarihli resmî tatiller her yıl; dini bayramlar yıl yıl (Diyanet takvimi)
const FIXED_HOLIDAYS = { '01-01': 'Yılbaşı', '04-23': 'Ulusal Egemenlik ve Çocuk Bayramı', '05-01': 'Emek ve Dayanışma Günü', '05-19': 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı', '07-15': 'Demokrasi ve Millî Birlik Günü', '08-30': 'Zafer Bayramı', '10-29': 'Cumhuriyet Bayramı' };
const DATED_HOLIDAYS = {
  '2026-03-20': 'Ramazan Bayramı', '2026-05-27': 'Kurban Bayramı', '2026-05-28': 'Kurban Bayramı', '2026-05-29': 'Kurban Bayramı',
};
const HALF_DAYS = { '2026-03-19': 'Ramazan Bayramı arifesi', '2026-05-26': 'Kurban Bayramı arifesi', '10-28': 'Cumhuriyet Bayramı arifesi' };

function istanbulParts(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, md: `${p.month}-${p.day}`, mins: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday };
}

export function holidayOf(isoDate) {
  return DATED_HOLIDAYS[isoDate] || FIXED_HOLIDAYS[isoDate.slice(5)] || null;
}

export function marketStatus(now = new Date()) {
  const t = istanbulParts(now);
  if (t.weekday === 'Sat' || t.weekday === 'Sun') return { open: false, label: 'Hafta sonu kapalı' };
  const hol = holidayOf(t.date);
  if (hol) return { open: false, label: `Tatil: ${hol}`, holiday: hol };
  const half = HALF_DAYS[t.date] || HALF_DAYS[t.md];
  const contEnd = half ? 12 * 60 + 30 : 18 * 60;
  const closeEnd = contEnd + 10;
  const suffix = half ? ` (yarım gün: ${half})` : '';
  if (t.mins < 9 * 60 + 40) return { open: false, label: 'Seans öncesi' + suffix, half: !!half };
  if (t.mins < 10 * 60) return { open: false, label: 'Açılış seansı' + suffix, half: !!half };
  if (t.mins < contEnd) return { open: true, label: 'Sürekli işlem' + suffix, half: !!half };
  if (t.mins < closeEnd) return { open: false, label: 'Kapanış seansı' + suffix, half: !!half };
  return { open: false, label: 'Seans kapalı', half: !!half };
}

// ── Sektörler ────────────────────────────────────────────
export function sectorOf(symbol) {
  const row = db.prepare('SELECT sector FROM symbols WHERE symbol = ?').get(symbol);
  if (row?.sector) return row.sector; // kullanıcı tanımı önceliklidir
  const sp = SPECIAL[symbol];
  if (sp) return { fx: 'Döviz', gold: 'Altın', commodity: 'Emtia', crypto: 'Kripto', index: 'Endeks' }[sp.type] || 'Diğer';
  if (symbol?.endsWith('.US')) return 'ABD Hisse';
  if (INDICES.includes(symbol)) return 'Endeks';
  return universe.stock(symbol)?.sector || 'Diğer';
}

export function normalize(sym) {
  return String(sym || '').trim().toUpperCase().replace(/\.IS$/, '').replace(/\s+/g, '');
}

export function toYahoo(sym) {
  const s = normalize(sym);
  if (SPECIAL[s]) return SPECIAL[s].y || null;
  if (s.endsWith('.US')) return s.slice(0, -3);
  if (/[=^\-]/.test(s) || s.includes('.')) return s; // zaten Yahoo biçiminde
  return `${s}.IS`;
}

export function fromYahoo(y) {
  for (const [k, v] of Object.entries(SPECIAL)) if (v.y === y) return k;
  if (y.endsWith('.IS')) return y.slice(0, -3);
  if (/^[A-Z]{1,5}$/.test(y)) return `${y}.US`;
  return y;
}

export function currencyOf(sym) {
  const s = normalize(sym);
  if (SPECIAL[s]) return SPECIAL[s].currency || 'USD';
  if (s.endsWith('.US')) return 'USD';
  return 'TRY';
}

export function isBist(sym) {
  const s = normalize(sym);
  return !SPECIAL[s] && !s.endsWith('.US') && !/[=^\-.]/.test(s) && !isFund(s);
}

/** TEFAS fonu mu? 3 karakter; evrendeki BIST payı (3 harf olsa bile), özel sembol ve endeks değil. */
export function isFund(sym) {
  const s = normalize(sym);
  if (!isFundCode(s) || SPECIAL[s] || INDICES.includes(s)) return false;
  if (universe.listed(s)) return false;
  return true;
}

async function getJson(url, { timeoutMs = 12000, headers = {} } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
  return res.json();
}

// ── Truncgil (döviz + altın) ─────────────────────────────
let tgMem = null;
// Truncgil dosyayı dakikada bir yeniden yazar; yazım sırasında okunursa yanıtın sonu eksik gelir.
// Döviz ve altın kayıtları dosyanın başında olduğu için son tam kayıtta kesip nesneyi kapatmak yeterli.
export function parseTruncgil(text) {
  try { return JSON.parse(text); } catch { /* eksik yanıt */ }
  for (let cut = text.lastIndexOf('},"'); cut > 0; cut = text.lastIndexOf('},"', cut - 1)) {
    try { return JSON.parse(text.slice(0, cut + 1) + '}'); } catch { /* bir önceki kayıtta dene */ }
  }
  return null;
}

// Truncgil'in HTTP/2 sunucusu Node fetch (undici) ile akış hatası verebiliyor (ERR_HTTP2_STREAM_ERROR); HTTP/1.1 ile al
function getTextH1(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} ${url}`)); return; }
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`Zaman aşımı: ${url}`)));
    req.on('error', reject);
  });
}

async function truncgil() {
  if (tgMem && Date.now() - tgMem.at < 30_000) return tgMem.data;
  try {
    let data = null, lastErr = null;
    for (let i = 0; i < 3 && !data?.USD?.Selling; i++) {
      if (i) await new Promise((r) => setTimeout(r, 400 * i));
      try { data = parseTruncgil(await getTextH1('https://finans.truncgil.com/v4/today.json')); } catch (e) { lastErr = e; }
    }
    if (!data?.USD?.Selling) throw lastErr || new Error('Truncgil: beklenmeyen yanıt');
    tgMem = { at: Date.now(), data };
    return data;
  } catch (e) {
    if (tgMem && Date.now() - tgMem.at < 15 * 60_000) return tgMem.data; // kısa kesintide son veri
    throw e;
  }
}

function tgQuote(sym, sp, d, updated) {
  const it = d[sp.tg];
  if (!it || !(it.Selling > 0 || it.Buying > 0)) return null;
  const bid = it.Buying || null, ask = it.Selling || null;
  const price = sp.bid && bid ? bid : bid && ask ? (bid + ask) / 2 : ask || bid;
  const pct = Number(it.Change) || 0;
  const prev = price / (1 + pct / 100);
  return {
    symbol: sym, name: sp.name, longName: null, price, prevClose: prev, change: price - prev, changePct: pct,
    bid, ask, dayHigh: null, dayLow: null, volume: null, high52: null, low52: null, currency: sp.currency,
    time: updated, exchange: 'Serbest piyasa', source: 'Truncgil', delayed: false, spark: [], sparkTimes: [],
  };
}

async function goldSpot() {
  const c = cacheGet('spot:xau', 30_000);
  if (c) return c;
  const d = await getJson('https://api.gold-api.com/price/XAU', { timeoutMs: 8000 });
  if (!(d?.price > 0)) throw new Error('gold-api yanıtı yok');
  const out = { price: d.price, time: Date.parse(d.updatedAt) || Date.now() };
  cachePut('spot:xau', out);
  return out;
}

// ── Anlık fiyatlar ────────────────────────────────────────
const quoteMem = new Map(); // sym -> { at, q }
const QUOTE_TTL = 12_000;

function metaToQuote(sym, meta, closes, timestamps) {
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  const change = price != null && prev ? price - prev : null;
  const isIndex = INDICES.includes(sym) || SPECIAL[sym]?.type === 'index';
  const bistName = universe.stock(sym)?.name; // Yahoo BIST adlarında Türkçe karakter yok ("Yollari")
  return {
    symbol: sym,
    name: INDEX_NAMES[sym] || SPECIAL[sym]?.name || bistName || meta.shortName || meta.longName || sym,
    longName: bistName || isIndex ? null : meta.longName || null,
    price,
    prevClose: prev ?? null,
    change,
    changePct: change != null && prev ? (change / prev) * 100 : meta.regularMarketChangePercent ?? null,
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    volume: isIndex || !meta.regularMarketVolume ? null : meta.regularMarketVolume,
    high52: meta.fiftyTwoWeekHigh ?? null,
    low52: meta.fiftyTwoWeekLow ?? null,
    currency: meta.currency || currencyOf(sym),
    time: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    exchange: isBist(sym) || INDICES.includes(sym) ? 'Borsa İstanbul' : meta.fullExchangeName || meta.exchangeName || null,
    source: 'Yahoo Finance',
    delayed: isBist(sym) || INDICES.includes(sym),
    spark: (closes || []).filter((c) => c != null),
    sparkTimes: timestamps || [],
  };
}

async function sparkBatch(ySymbols) {
  const out = {};
  for (let i = 0; i < ySymbols.length; i += 20) {
    const chunk = ySymbols.slice(i, i + 20);
    const url = `${Y1}/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=1d&interval=5m`;
    try {
      const data = await getJson(url);
      for (const r of data?.spark?.result || []) {
        const resp = r.response?.[0];
        if (!resp?.meta) continue;
        out[r.symbol] = { meta: resp.meta, closes: resp.indicators?.quote?.[0]?.close || [], ts: resp.timestamp || [] };
      }
    } catch {
      // Toplu istek başarısız olursa sembol başına chart uç noktasına düş
      for (const y of chunk) {
        try {
          const d = await getJson(`${Y1}/v8/finance/chart/${encodeURIComponent(y)}?range=1d&interval=5m`);
          const r = d?.chart?.result?.[0];
          if (r?.meta) out[y] = { meta: r.meta, closes: r.indicators?.quote?.[0]?.close || [], ts: r.timestamp || [] };
        } catch { /* sembol bulunamadı */ }
      }
    }
  }
  return out;
}

export async function getQuotes(symbols) {
  const syms = [...new Set(symbols.map(normalize).filter(Boolean))];
  const now = Date.now();
  const result = {};
  const need = [];
  for (const s of syms) {
    const c = quoteMem.get(s);
    if (c && now - c.at < QUOTE_TTL) result[s] = c.q;
    else need.push(s);
  }
  if (!need.length) return result;
  const put = (s, q) => { if (q) { quoteMem.set(s, { at: now, q }); result[s] = q; } };

  // 1) Truncgil: döviz, gram altın, altın türleri
  const tgSyms = need.filter((s) => SPECIAL[s]?.tg);
  const failedTg = [];
  if (tgSyms.length || need.includes('ONS')) {
    try {
      const d = await truncgil();
      const updated = Date.parse((d.Update_Date || '').replace(' ', 'T') + '+03:00') || now;
      for (const s of tgSyms) { const q = tgQuote(s, SPECIAL[s], d, updated); if (q) put(s, q); else failedTg.push(s); }
      // Ons: spot fiyat gold-api, günlük değişim Truncgil
      if (need.includes('ONS')) {
        try {
          const spot = await goldSpot();
          const pct = Number(d.ONS?.Change) || 0;
          const prev = spot.price / (1 + pct / 100);
          put('ONS', { symbol: 'ONS', name: SPECIAL.ONS.name, longName: 'Spot altın (XAU/USD)', price: spot.price, prevClose: prev, change: spot.price - prev, changePct: pct, dayHigh: null, dayLow: null, volume: null, high52: null, low52: null, currency: 'USD', time: spot.time, exchange: 'Spot', source: 'gold-api + Truncgil', delayed: false, spark: [], sparkTimes: [] });
        } catch { /* Yahoo yedeğine düşer */ }
      }
    } catch {
      failedTg.push(...tgSyms);
    }
  }

  // 2) TEFAS: yatırım / emeklilik fonları (günlük birim fiyat)
  const fundNeed = need.filter((s) => !result[s] && isFund(s));
  if (fundNeed.length) await Promise.all(fundNeed.map(async (s) => { try { put(s, await fundQuote(s)); } catch { /* TEFAS geçici hata: bir sonraki yenilemede */ } }));

  // 3) Yahoo: BIST, endeksler, yurt dışı + yedekler
  const yahooNeed = need.filter((s) => !result[s] && !isFund(s));
  const ySyms = new Set();
  for (const s of yahooNeed) {
    const y = toYahoo(s);
    if (y) ySyms.add(y);
    else if (SPECIAL[s]?.type === 'gold' || s === 'GUMUS') { ySyms.add(s === 'GUMUS' ? 'SI=F' : 'GC=F'); ySyms.add('USDTRY=X'); }
  }
  if (ySyms.size) {
    const raw = await sparkBatch([...ySyms]);
    for (const s of yahooNeed) {
      const y = toYahoo(s);
      if (y && raw[y]) { put(s, metaToQuote(s, raw[y].meta, raw[y].closes, raw[y].ts)); continue; }
      // Truncgil kapalıysa gram altın/gümüş yedeği: vadeli ons × USDTRY / 31,10 (yaklaşık)
      if ((s === 'GRAM' || s === 'HAS' || s === 'GUMUS') && raw['USDTRY=X'] && raw[s === 'GUMUS' ? 'SI=F' : 'GC=F']) {
        const g = raw[s === 'GUMUS' ? 'SI=F' : 'GC=F'].meta, u = raw['USDTRY=X'].meta;
        const k = 1 / TROY_OUNCE_GRAMS;
        const price = g.regularMarketPrice * u.regularMarketPrice * k;
        const prev = (g.chartPreviousClose ?? g.previousClose) * (u.chartPreviousClose ?? u.previousClose) * k;
        put(s, { symbol: s, name: SPECIAL[s].name, price, prevClose: prev, change: price - prev, changePct: ((price - prev) / prev) * 100, currency: 'TRY', time: now, source: 'Yahoo (vadeli, yaklaşık)', delayed: true, spark: [], sparkTimes: [] });
      }
    }
  }
  return result;
}

export async function getQuote(symbol) {
  const s = normalize(symbol);
  return (await getQuotes([s]))[s] || null;
}

// ── Geçmiş fiyatlar ───────────────────────────────────────
const RANGE_INTERVAL = { '1d': '5m', '5d': '30m', '1mo': '1d', '3mo': '1d', '6mo': '1d', ytd: '1d', '1y': '1d', '2y': '1d', '5y': '1wk', '10y': '1mo', max: '1mo' };

async function yahooBars(y, range, interval) {
  const data = await getJson(`${Y1}/v8/finance/chart/${encodeURIComponent(y)}?range=${range}&interval=${interval}&events=div%2Csplits`);
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error(`Veri yok: ${y}`);
  const q = r.indicators?.quote?.[0] || {};
  return (r.timestamp || []).map((t, i) => ({
    t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] || 0,
  })).filter((b) => b.c != null);
}

// Altın türevleri: vadeli ons (GC=F) × USDTRY / 31,10 serisi, bugünkü spot fiyata ölçeklenir.
// (Ücretsiz spot altın geçmişi yok; vadeli ile spot arasındaki fark ~%0,5–1 ve yavaş değişir.)
async function derivedGoldBars(s, range, interval) {
  const gramsPer = { GRAM: 1, HAS: 1, ONS: TROY_OUNCE_GRAMS }[s];
  const [g, u] = await Promise.all([yahooBars(s === 'GUMUS' ? 'SI=F' : 'GC=F', range, interval), s === 'ONS' ? Promise.resolve(null) : yahooBars('USDTRY=X', range, interval)]);
  const key = (ms) => (/m$/.test(interval) && !interval.endsWith('mo') ? Math.floor(ms / 3_600_000) : new Date(ms).toISOString().slice(0, 10));
  const umap = u ? new Map(u.map((b) => [key(b.t), b.c])) : null;
  let lastFx = null;
  const bars = g.map((b) => {
    let k = 1;
    if (umap) {
      const fx = umap.get(key(b.t)) ?? lastFx;
      if (!fx) return null;
      lastFx = fx;
      k = fx / TROY_OUNCE_GRAMS * (s === 'GUMUS' ? 1 : gramsPer);
    }
    return { t: b.t, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k, v: 0 };
  }).filter(Boolean);
  // Son değeri güncel spot fiyata hizala
  const q = await getQuote(s).catch(() => null);
  const last = bars.at(-1)?.c;
  if (q?.price && last) {
    const f = q.price / last;
    if (f > 0.9 && f < 1.1) for (const b of bars) { b.o *= f; b.h *= f; b.l *= f; b.c *= f; }
  }
  return bars;
}

export async function getHistory(symbol, range = '1y', interval) {
  const s = normalize(symbol);
  interval = interval || RANGE_INTERVAL[range] || '1d';
  const key = `hist:${s}:${range}:${interval}`;
  const ttl = ['1d', '5d'].includes(range) ? 60_000 : 30 * 60_000;
  const cached = cacheGet(key, ttl);
  if (cached) return cached;
  let bars;
  if (isFund(s)) bars = await fundBars(s, range);
  else if (['GRAM', 'HAS', 'ONS', 'GUMUS'].includes(s)) bars = await derivedGoldBars(s, range, interval);
  else if (SPECIAL[s]?.tg && SPECIAL[s].type === 'gold') {
    // Sikke ve ayar altınlar: gram altın serisi × (güncel ürün fiyatı / güncel gram fiyatı)
    const [g, qs] = await Promise.all([getHistory('GRAM', range, interval), getQuotes([s, 'GRAM'])]);
    const f = qs[s]?.price && qs.GRAM?.price ? qs[s].price / qs.GRAM.price : null;
    if (!f) throw new Error(`${s} için fiyat alınamadı`);
    bars = g.map((b) => ({ t: b.t, o: b.o * f, h: b.h * f, l: b.l * f, c: b.c * f, v: 0 }));
  } else {
    const y = toYahoo(s);
    if (!y) throw new Error(`${s} için geçmiş veri yok`);
    bars = await yahooBars(y, range, interval);
  }
  cachePut(key, bars);
  return bars;
}

export async function getDividends(symbol, range = '5y') {
  const s = normalize(symbol);
  const y = toYahoo(s);
  const empty = { dividends: [], splits: [] };
  if (!y || SPECIAL[s] || INDICES.includes(s) || isFund(s)) return empty;
  const key = `divs:${s}:${range}`;
  const cached = cacheGet(key, 12 * 3600_000);
  if (cached) return cached;
  const data = await getJson(`${Y1}/v8/finance/chart/${encodeURIComponent(y)}?range=${range}&interval=1mo&events=div%2Csplits`);
  const ev = data?.chart?.result?.[0]?.events || {};
  const out = {
    dividends: Object.values(ev.dividends || {}).map((d) => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount })).sort((a, b) => a.date.localeCompare(b.date)),
    splits: Object.values(ev.splits || {}).map((d) => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), ratio: d.numerator / d.denominator, text: d.splitRatio })).sort((a, b) => a.date.localeCompare(b.date)),
  };
  cachePut(key, out);
  return out;
}

// Belirli bir tarihteki kapanış (işlem girerken kur/fiyat önerisi için)
export async function priceOnDate(symbol, isoDate) {
  const bars = await getHistory(symbol, '10y', '1d').catch(() => []);
  const target = new Date(isoDate + 'T23:59:59Z').getTime();
  let best = null;
  for (const b of bars) { if (b.t <= target) best = b; else break; }
  return best?.c ?? null;
}

// ── Arama ─────────────────────────────────────────────────
export async function search(q) {
  q = String(q || '').trim();
  if (!q) return [];
  const local = [];
  const TYPE_TR = { gold: 'Altın', commodity: 'Emtia', fx: 'Döviz', crypto: 'Kripto', index: 'Endeks', equity: 'Hisse' };
  // Her kaynak aynı katlamayı (trFold) ve aynı puan ölçeğini (trScore) kullanır.
  // src: 0 özel araç · 1 endeks · 2 yerel evren · 3 fon · 4 uzak (eşit puanda kaynak önceliği)
  // Dar listelerde (src <= 1) ad-öneki ödülü kapatılır: 23 sembollük özel listede
  // "altın" yazan kullanıcı şirket değil ürün arıyor.
  const NARROW = { prefixWeight: 0 };
  const add = (src, r, score) => { if (score) local.push({ ...r, _s: score, _src: src }); };
  for (const [k, v] of Object.entries(SPECIAL)) add(0, { symbol: k, name: v.name, type: v.type, exchange: TYPE_TR[v.type] || '' }, trScore(k, v.name, q, NARROW));
  for (const k of INDICES) add(1, { symbol: k, name: INDEX_NAMES[k], type: 'index', exchange: 'BIST' }, trScore(k, INDEX_NAMES[k], q, NARROW));
  for (const s of universe.searchLocal(q, 10)) add(2, { symbol: s.code, name: s.name, type: 'equity', exchange: 'BIST', sector: s.sector }, s.score);
  for (const f of await searchFunds(q, 8).catch(() => [])) add(3, { symbol: f.code, name: f.name, type: 'fund', exchange: 'TEFAS' }, f.score);
  let remote = [];
  try {
    const d = await getJson(`${Y2}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&lang=tr-TR&region=TR`);
    remote = (d.quotes || []).filter((x) => x.symbol && x.exchange !== 'IST').map((x) => ({
      symbol: fromYahoo(x.symbol), name: x.longname || x.shortname || x.symbol, type: (x.quoteType || '').toLowerCase(), exchange: x.exchDisp || x.exchange || '',
      _s: trScore(fromYahoo(x.symbol), x.longname || x.shortname || '', q), _src: 4,
    }));
  } catch { /* çevrimdışı: yerel sonuçlar yeter */ }
  const seen = new Set();
  const all = [...local, ...remote].filter((r) => (seen.has(r.symbol) ? false : seen.add(r.symbol)));
  all.sort(compareSearchHits);
  return all.slice(0, 15).map(({ _s, _src, ...r }) => r);
}

// Haberler: BIST ve genel konular için Google News (Türkçe), ABD hisseleri için Yahoo
function newsTerm(s, raw) {
  if (SPECIAL[s]) return SPECIAL[s].name.replace(/\s*\(.*\)/, '');
  if (INDEX_NAMES[s]) return `Borsa İstanbul ${INDEX_NAMES[s]}`;
  if (/^[A-Z0-9]{3,6}$/.test(s)) return `${s} hisse`;
  return String(raw);
}

export async function news(q) {
  const s = normalize(q);
  const key = `news:${s}`;
  const cached = cacheGet(key, 10 * 60_000);
  if (cached) return cached;
  let out = [];
  if (s.endsWith('.US')) {
    try {
      const d = await getJson(`${Y2}/v1/finance/search?q=${encodeURIComponent(toYahoo(s))}&quotesCount=0&newsCount=12`);
      out = (d.news || []).map((n) => ({ title: n.title, publisher: n.publisher, link: n.link, time: n.providerPublishTime * 1000 }));
    } catch { /* haber yok */ }
  } else {
    try {
      const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(newsTerm(s, q))}&hl=tr&gl=TR&ceid=TR:tr`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
      const xml = await res.text();
      const tag = (it, t) => (new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(it)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const dec = (x) => x.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      out = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
        const it = m[1];
        const publisher = dec(tag(it, 'source'));
        let title = dec(tag(it, 'title'));
        if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3));
        return { title, publisher, link: dec(tag(it, 'link')), time: Date.parse(tag(it, 'pubDate')) || null };
      }).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 20);
    } catch { /* haber yok */ }
  }
  cachePut(key, out);
  return out;
}

// ── Piyasa özeti ──────────────────────────────────────────
export async function overview() {
  const quotes = await getQuotes([...OVERVIEW]);
  return OVERVIEW.map((s) => quotes[s]).filter(Boolean);
}

export async function movers() {
  const cached = cacheGet('movers', 60_000);
  if (cached) return cached;
  const members = await universe.bist100();
  const q = await getQuotes(members);
  const list = Object.values(q).filter((x) => x.changePct != null && x.price);
  const byPct = [...list].sort((a, b) => b.changePct - a.changePct);
  const slim = (x) => ({ symbol: x.symbol, name: x.name, price: x.price, changePct: x.changePct, volume: x.volume, turnover: (x.volume || 0) * x.price, time: x.time });
  const out = {
    universe: members.length, priced: list.length,
    gainers: byPct.slice(0, 10).map(slim),
    losers: byPct.slice(-10).reverse().map(slim),
    active: [...list].sort((a, b) => (b.volume || 0) * b.price - (a.volume || 0) * a.price).slice(0, 10).map(slim),
    breadth: { up: list.filter((x) => x.changePct > 0).length, down: list.filter((x) => x.changePct < 0).length, flat: list.filter((x) => x.changePct === 0).length },
    sectors: sectorPerf(list),
    asOf: Math.max(0, ...list.map((x) => x.time || 0)) || null,
  };
  cachePut('movers', out);
  return out;
}

function sectorPerf(list) {
  const agg = {};
  for (const x of list) {
    const s = sectorOf(x.symbol);
    agg[s] ||= { sector: s, n: 0, sum: 0, members: [] };
    agg[s].n++; agg[s].sum += x.changePct; agg[s].members.push(x.symbol);
  }
  return Object.values(agg).map((a) => ({ sector: a.sector, avgPct: a.sum / a.n, count: a.n, members: a.members })).sort((a, b) => b.avgPct - a.avgPct);
}

// Temel veriler (İş Yatırım): oranlar, piyasa değeri, getiriler + yaklaşan temettü/sermaye artırımları
export async function fundamentals(symbol) {
  const s = normalize(symbol);
  if (!isBist(s)) return null;
  await universe.refresh();
  const st = universe.stock(s);
  if (!st) return null;
  const today = new Date().toISOString().slice(0, 10);
  const acts = await universe.corporateActions({ symbols: [s] });
  return { ...st, actions: acts, upcoming: acts.filter((a) => a.date >= today), asOf: universe.status().at };
}

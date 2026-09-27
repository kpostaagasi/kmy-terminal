// Ücretsiz açık veri kaynakları:
//  - Ekonomi haberleri: Bloomberg HT, AA, Dünya, Ekonomim, Foreks, TRT Haber, Investing TR (RSS)
//  - TCMB gösterge kurları (resmi, işlem günü kuru): tcmb.gov.tr/kurlar
//  - TLREF (Türk lirası gecelik referans faizi): Borsa İstanbul
//  - Mali tablolar (bilanço, gelir tablosu, nakit akışı): İş Yatırım
import { cacheGet, cachePut } from './db.js';
import * as universe from './universe.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
async function get(url, timeoutMs = 15_000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).host}`);
  return res;
}
const decode = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const strip = (s) => decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const fold = (s) => String(s || '').toLocaleLowerCase('tr').replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[c]));

// ── Haberler ───────────────────────────────────────────────
export const NEWS_SOURCES = {
  bloomberght: { name: 'Bloomberg HT', url: 'https://www.bloomberght.com/rss' },
  foreks: { name: 'Foreks', url: 'https://www.foreks.com/rss/' },
  aa: { name: 'Anadolu Ajansı', url: 'https://www.aa.com.tr/tr/rss/default?cat=ekonomi' },
  dunya: { name: 'Dünya', url: 'https://www.dunya.com/rss?dunya' },
  ekonomim: { name: 'Ekonomim', url: 'https://www.ekonomim.com/rss' },
  trt: { name: 'TRT Haber', url: 'https://www.trthaber.com/ekonomi_articles.rss' },
  investing: { name: 'Investing.com TR', url: 'https://tr.investing.com/rss/news.rss' },
};

async function readFeed(key) {
  const src = NEWS_SOURCES[key];
  const hit = cacheGet(`feed:${key}`, 10 * 60_000);
  if (hit) return hit;
  const xml = await (await get(src.url)).text();
  const items = xml.split(/<item[\s>]/).slice(1).map((it) => {
    const tag = (t) => it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] || '';
    const link = strip(tag('link')) || it.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
    return { title: strip(tag('title')), summary: strip(tag('description')).slice(0, 400), link, time: Date.parse(strip(tag('pubDate')) || strip(tag('dc:date'))) || null, source: src.name, sourceKey: key };
  }).filter((x) => x.title && x.link);
  cachePut(`feed:${key}`, items);
  return items;
}

// symbol verilirse kod veya şirket adı geçen haberler; q metin araması
export async function newsFeed({ sources = null, symbol = null, q = null, limit = 60 } = {}) {
  const keys = (sources?.length ? sources : Object.keys(NEWS_SOURCES)).filter((k) => NEWS_SOURCES[k]);
  const status = {};
  const all = (await Promise.all(keys.map(async (k) => { try { const r = await readFeed(k); status[k] = r.length; return r; } catch (e) { status[k] = `hata: ${e.message}`; return []; } }))).flat();
  let terms = null;
  if (symbol) {
    const code = symbol.toUpperCase();
    if (!universe.stock(code)) await universe.refresh().catch(() => {});
    const name = universe.stock(code)?.name;
    terms = [code.toLocaleLowerCase('tr'), ...(name ? [fold(name.replace(/\s*\(.*\)/, ''))] : [])];
  }
  const needle = q ? fold(q) : null;
  const seen = new Set();
  const items = all.filter((x) => {
    const t = fold(`${x.title} ${x.summary}`);
    if (terms && !terms.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t))) return false;
    if (needle && !t.includes(needle)) return false;
    const k = fold(x.title).slice(0, 60);
    return seen.has(k) ? false : seen.add(k);
  }).sort((a, b) => (b.time || 0) - (a.time || 0));
  return { items: items.slice(0, limit), total: items.length, status, sources: NEWS_SOURCES };
}

// ── TCMB gösterge kurları ──────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
function parseTcmb(xml) {
  const date = xml.match(/Tarih="([^"]+)"/)?.[1] || null;
  const rates = {};
  for (const m of xml.matchAll(/<Currency[^>]*CurrencyCode="([A-Z]+)"[^>]*>([\s\S]*?)<\/Currency>/g)) {
    const f = (t) => { const v = m[2].match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]; return v ? Number(v) : null; };
    const unit = f('Unit') || 1;
    rates[m[1]] = { name: strip(m[2].match(/<Isim>([^<]*)<\/Isim>/)?.[1]), unit, forexBuying: f('ForexBuying') / unit, forexSelling: f('ForexSelling') / unit, banknoteBuying: f('BanknoteBuying') / unit, banknoteSelling: f('BanknoteSelling') / unit };
  }
  return { date, rates };
}

// İstenen gündeki (hafta sonu / tatilde önceki iş günü) TCMB kurları. Kurlar bir önceki iş günü 15:30'da belirlenir.
export async function tcmbRates(dateIso = null) {
  if (!dateIso) {
    const hit = cacheGet('tcmb:today', 60 * 60_000);
    if (hit) return hit;
    const r = parseTcmb(await (await get('https://www.tcmb.gov.tr/kurlar/today.xml')).text());
    cachePut('tcmb:today', r);
    return r;
  }
  const d = new Date(`${dateIso}T12:00:00Z`);
  for (let i = 0; i < 8; i++, d.setUTCDate(d.getUTCDate() - 1)) {
    const key = `tcmb:${d.toISOString().slice(0, 10)}`;
    const hit = cacheGet(key, 3650 * 86400_000);
    if (hit) return hit;
    const ym = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`, dmy = `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
    try {
      const res = await fetch(`https://www.tcmb.gov.tr/kurlar/${ym}/${dmy}.xml`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const r = parseTcmb(await res.text());
      if (!Object.keys(r.rates).length) continue;
      cachePut(key, r);
      return r;
    } catch { /* önceki gün */ }
  }
  throw new Error(`${dateIso} için TCMB kuru bulunamadı`);
}

// ── TLREF ──────────────────────────────────────────────────
export async function tlrefHistory() {
  const hit = cacheGet('tlref:hist', 6 * 3600_000);
  if (hit) return hit;
  const d = await (await get('https://www.borsaistanbul.com/bist-tlrefk.php?op=fetchTlrefkData&dataType=tlref-history&day=7000', 30_000)).json();
  const rows = (d.data || []).map((x) => ({ date: x.date, rate: Number(x.clval) })).filter((x) => x.date && Number.isFinite(x.rate)).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw new Error('TLREF verisi alınamadı');
  cachePut('tlref:hist', rows);
  return rows;
}

// Dönemin ortalama TLREF'i (yıllık %, basit) ve bileşik getiri endeksi (TLREF ile mevduat benzeri getiri)
export async function tlrefStats(from, to) {
  const rows = (await tlrefHistory()).filter((x) => (!from || x.date >= from) && (!to || x.date <= to));
  if (!rows.length) return null;
  const avg = rows.reduce((a, x) => a + x.rate, 0) / rows.length;
  return { from: rows[0].date, to: rows.at(-1).date, avgPct: avg, lastPct: rows.at(-1).rate, days: rows.length };
}
export async function tlrefIndex() {
  const rows = await tlrefHistory();
  const out = new Map();
  let level = 100;
  for (let i = 0; i < rows.length; i++) {
    if (i) { const days = (new Date(rows[i].date) - new Date(rows[i - 1].date)) / 86400_000; level *= 1 + (rows[i - 1].rate / 100) * (days / 365); }
    out.set(rows[i].date, level);
  }
  return out;
}

// ── Mali tablolar (İş Yatırım) ─────────────────────────────
const MT_URL = 'https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo';
function periodsBack(n) {
  const now = new Date();
  let y = now.getFullYear(), q = Math.floor(now.getMonth() / 3); // bu çeyrek henüz yayımlanmamış olabilir
  const out = [];
  for (let i = 0; i < n + 1; i++) { if (q === 0) { y -= 1; q = 4; } out.push([y, q * 3]); q -= 1; }
  return out;
}
async function mtCall(code, group, periods) {
  const qs = periods.map(([y, p], i) => `year${i + 1}=${y}&period${i + 1}=${p}`).join('&');
  const d = await (await get(`${MT_URL}?companyCode=${code}&exchange=TRY&financialGroup=${group}&${qs}`, 20_000)).json();
  return d.value || [];
}
const INDUSTRIAL_KEYS = {
  sales: '3C', grossProfit: '3D', operatingProfit: '3DF', pretax: '3I', netIncome: '3Z', depreciation: '4B',
  totalAssets: '1BL', currentAssets: '1A', nonCurrentAssets: '1AK', monetaryGain: '3HCA', cash: '1AA', shortInvest: '1AB', equity: '2O', stDebt: '2AA', ltDebt: '2BA', currentLiabilities: '2A', ltLiabilities: '2B', opCashFlow: '4C', netFx: '4BE', exportSales: '4BD',
};
const BANK_KEYS = { netInterest: '3C', fees: '3CA', provisions: '3CF', operatingProfit: '3CH', pretax: '3CL', netIncome: '3Z', totalAssets: '1Z', loans: '1AF', deposits: '2A', equity: '2O' };

// symbol'ün son n çeyreği: satırlar kümülatif (yıl başından) gelir; gelir tablosu için çeyreklik değerler de hesaplanır
export async function financials(symbol, n = 8) {
  const code = String(symbol).toUpperCase().replace(/\.IS$/, '');
  const key = `mt3:${code}:${n}`;
  const hit = cacheGet(key, 12 * 3600_000);
  if (hit) return hit;
  const all = periodsBack(n);
  let group = 'XI_29', rows = [];
  for (const g of ['XI_29', 'UFRS_K', 'UFRS']) {
    const first = await mtCall(code, g, all.slice(0, 4)).catch(() => []);
    if (first.length && first.some((r) => Number(r.value1) || Number(r.value2))) { group = g; rows = first; break; }
  }
  if (!rows.length) throw new Error(`${code} için mali tablo bulunamadı`);
  const chunks = [rows];
  for (let i = 4; i < all.length; i += 4) chunks.push(await mtCall(code, group, all.slice(i, i + 4)).catch(() => []));
  // Dönem sütunları: değeri olan dönemler (yeni bilanço yayımlanmamışsa ilk sütun boş gelir)
  const cols = [];
  chunks.forEach((ch, ci) => all.slice(ci * 4, ci * 4 + 4).forEach(([y, p], j) => cols.push({ label: `${y}/${p}`, year: y, month: p, get: (code2) => { const r = ch.find((x) => x.itemCode === code2); const v = r ? r[`value${j + 1}`] : null; return v == null || v === '' ? null : Number(v); } })));
  const bank = group !== 'XI_29';
  const keys = bank ? BANK_KEYS : INDUSTRIAL_KEYS;
  const periods = cols.filter((c) => c.get(bank ? '1Z' : '1BL')).slice(0, n);
  const table = periods.map((c) => ({ period: c.label, ...Object.fromEntries(Object.entries(keys).map(([k, ic]) => [k, c.get(ic)])) }));
  // Çeyreklik gelir tablosu: kümülatiften önceki çeyreği çıkar (aynı yıl içinde)
  const flowKeys = bank ? ['netInterest', 'fees', 'provisions', 'operatingProfit', 'pretax', 'netIncome'] : ['sales', 'grossProfit', 'operatingProfit', 'pretax', 'netIncome', 'depreciation', 'opCashFlow', 'exportSales', 'monetaryGain'];
  const quarterly = table.map((r, i) => {
    const [y, m] = r.period.split('/').map(Number);
    const prev = table[i + 1] && table[i + 1].period.startsWith(`${y}/`) && Number(table[i + 1].period.split('/')[1]) === m - 3 ? table[i + 1] : null;
    const q = { period: `${y}-Ç${m / 3}`, label: r.period };
    for (const k of flowKeys) q[k] = r[k] == null ? null : m === 3 ? r[k] : prev && prev[k] != null ? r[k] - prev[k] : null;
    if (!bank && q.operatingProfit != null && q.depreciation != null) q.ebitda = q.operatingProfit + q.depreciation;
    return q;
  });
  if (!bank) for (const r of table) {
    const debt = (r.stDebt || 0) + (r.ltDebt || 0); r.netDebt = debt - (r.cash || 0) - (r.shortInvest || 0);
    if (r.operatingProfit != null && r.depreciation != null) r.ebitda = r.operatingProfit + r.depreciation; // kümülatif FAVÖK
  }
  const raw = (chunks[0] || []).map((r) => ({ code: r.itemCode, name: r.itemDescTr.trim(), value: Number(r[`value${cols.findIndex((c) => c.label === periods[0]?.label) + 1}`]) || 0 }));
  const out = { symbol: code, type: bank ? 'banka' : 'sanayi', currency: 'TRY', source: 'İş Yatırım (KAP finansal tabloları)', note: 'Bilanço dönem sonu; gelir tablosu yıl başından kümülatif, quarterly çeyreklik', latest: periods[0]?.label || null, cumulative: table, quarterly, lastPeriodItems: raw };
  cachePut(key, out);
  return out;
}

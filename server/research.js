// Aracı kurum araştırma raporları: kurumların kendi sitelerinde herkese açık yayımladığı raporlar.
// Her kurum için bir uyarlayıcı listeyi çeker; liste önbellekte tutulur, PDF istenince indirilir
// ve Raporlar arşivine (reports/kurum/<kurum>/) kurum ve sembol etiketiyle kaydedilir.
// Giriş veya bot koruması olan kaynaklar (Halk şirket raporları, Deniz, Alnus) klasör izleme ile arşive alınır (inbox.js).
import fs from 'node:fs';
import path from 'node:path';
import { cacheGet, cachePut } from './db.js';
import { REPORTS_DIR } from './paths.js';
import * as universe from './universe.js';
import * as store from './store.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const LIST_TTL = 30 * 60_000;
const MAX_PDF = 60 * 1024 * 1024;

// ── Yardımcılar ─────────────────────────────────────────────
async function get(url, { headers = {}, method = 'GET', body, timeoutMs = 20_000 } = {}) {
  const res = await fetch(url, { method, body, headers: { 'User-Agent': UA, 'Accept-Language': 'tr-TR,tr;q=0.9', ...headers }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).host}`);
  return res;
}
const text = async (url, o) => (await get(url, o)).text();
const cookiesOf = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, k) => ENT[k] ?? m);
}
const strip = (s) => decode(String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const abs = (base, u) => (u ? new URL(decode(u).trim(), base).href : null);

const TR_MONTHS = { ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5, haziran: 6, temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9, ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12 };
const pad = (n) => String(n).padStart(2, '0');
function parseDate(s) {
  s = decode(String(s || '')).trim();
  let m;
  if ((m = /(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '09'}:${m[5] || '00'}:00+03:00`;
  if ((m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4] || 9)}:${m[5] || '00'}:00+03:00`;
  if ((m = /(\d{1,2})\s+([a-zçğıöşü]+)\s+(\d{4})/i.exec(s))) {
    const mo = TR_MONTHS[m[2].toLocaleLowerCase('tr')];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(m[1])}T09:00:00+03:00`;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

// Başlık ve etiketlerden BIST kodları: doğrudan kod ya da şirket adı
let nameIndex = null;
const NOT_SYMBOL = new Set(['HEDEF', 'BDDK', 'TCMB', 'TUIK', 'TÜİK', 'BIST', 'FAVOK', 'TUFE', 'ÜFE', 'MSCI', 'OPEC']);
const foldName = (s) => String(s || '').toLocaleLowerCase('tr').replace(/[çğıöşüâî]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i' }[c])).replace(/[^a-z0-9]/g, '');
export function symbolsIn(...parts) {
  const txt = parts.filter(Boolean).join(' ');
  const stocks = universe.allStocks();
  if (!stocks.length) return [];
  const codes = new Set(stocks.map((s) => s.code));
  const out = new Set();
  for (const t of txt.toUpperCase().split(/[^A-Z0-9ÇĞİÖŞÜ]+/)) {
    const k = t.replace(/\.IS$/, '');
    if (k.length >= 4 && k.length <= 6 && /^[A-ZÇĞİÖŞÜ]/.test(k) && codes.has(k) && !NOT_SYMBOL.has(k)) out.add(k);
  }
  if (!out.size) {
    // Şirket adıyla eşleştirme: harfler katlanır, boşluklar atılır ("Halk Bankası" ⊃ "Halkbank")
    nameIndex ||= stocks.map((s) => [s.code, foldName(s.name.replace(/\s*\(.*\)/g, ''))]).filter(([, n]) => n.length >= 5);
    const f = foldName(txt);
    for (const [code, n] of nameIndex) if (f.includes(n)) out.add(code);
  }
  return [...out].slice(0, 6);
}

function category(s) {
  const t = String(s || '').toLocaleLowerCase('tr');
  if (/model portf/.test(t)) return 'Model portföy';
  if (/strateji/.test(t)) return 'Strateji';
  if (/sekt[öo]r/.test(t)) return 'Sektör';
  if (/makro|enflasyon|para politikas|büyüme|dış denge|kamu maliye/.test(t)) return 'Makro';
  if (/teknik|destek|direnç|dip|zirve|mekanik/.test(t)) return 'Teknik';
  if (/bilanço|finansal sonu|mali tablo|kar tahmin|kâr tahmin|2ç|1ç|3ç|4ç|açıklanan/.test(t)) return 'Bilanço';
  if (/şirket|sirket|hedef fiyat|toplantı|bilgi notu|company/.test(t)) return 'Şirket';
  return 'Diğer';
}

const item = (broker, key, o) => ({
  id: `${key}:${o.srcId}`, broker, brokerKey: key, title: o.title, date: o.date, category: o.category || category(`${o.cat || ''} ${o.title}`),
  symbols: o.symbols?.length ? o.symbols : symbolsIn(o.title, o.tags), summary: o.summary ? o.summary.slice(0, 600) : null,
  url: o.url || null, page: o.page || null, size: o.size || null, analyst: o.analyst || null, access: o.access || 'açık',
});

// ── Kurum uyarlayıcıları ─────────────────────────────────────
const ADAPTERS = {
  garanti: {
    name: 'Garanti BBVA Yatırım', site: 'https://www.garantibbvayatirim.com.tr/arastirma-raporlari',
    async list() {
      const groups = { 564: 'Şirket', 12176: 'Sektör', 568: 'Strateji', 552: 'Model portföy', 5436: 'Bilanço' };
      const out = [];
      for (const [gid, cat] of Object.entries(groups)) {
        const d = await (await get(`https://www.garantibbvayatirim.com.tr/api/researchreports?sgids=${gid}&page=1&pageSize=40`)).json();
        for (const x of (d.Items || []).slice(0, 40)) {
          out.push(item(this.name, 'garanti', { srcId: (x.PdfUrl || '').match(/(\d+)\.vsf/)?.[1] || x.Title, title: x.Title.trim(), date: parseDate(x.PublishDate), category: cat, summary: x.ShortDescription?.trim(), url: x.PdfUrl }));
        }
      }
      return out;
    },
  },
  ak: {
    name: 'AK Yatırım', site: 'https://www.akyatirim.com.tr/tr/raporlarimiz/arastirma-raporlari',
    async list() {
      const page = await get(this.site);
      const cookie = cookiesOf(page);
      const html = await page.text();
      const token = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
      if (!token) throw new Error('AK Yatırım: doğrulama anahtarı yok');
      const out = [];
      for (const type of ['Hisse Senetleri:Şirket Raporu veya Notu', 'Hisse Senetleri:Strateji Raporları']) {
        const body = new URLSearchParams({ contentType: 'All', isForeignLang: 'false', rowLimit: '40', pageNumber: '1', orderByDesc: 'true', reportTypeId: type, __RequestVerificationToken: token });
        const d = await (await get('https://www.akyatirim.com.tr/umbraco/surface/api/InvestorPdfReport', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, Referer: this.site } })).json();
        for (const x of d?.data?.pdfReport || []) {
          out.push(item(this.name, 'ak', {
            srcId: x.id, title: x.title.replace(/^AK Yatırım Arş:\s*/i, ''), date: new Date(x.contentDate).toISOString(), cat: type.includes('Strateji') ? 'Strateji' : '',
            symbols: String(x.stockCodes || '').split(/[;,\s]+/).filter((c) => /^[A-Z0-9]{4,6}$/.test(c)), summary: strip(x.contentOfTeaser), url: x.pdfDownloadUrl, size: x.fileSize, analyst: String(x.analyst || '').replace(/;\s*$/, ''),
          }));
        }
      }
      return out;
    },
  },
  isyatirim: {
    name: 'İş Yatırım', site: 'https://arastirma.isyatirim.com.tr/',
    async list() {
      const feeds = { 'sirket-raporlari': 'Şirket', 'sektor-raporlari': 'Sektör', 'hisse-senedi-strateji-raporu': 'Strateji', 'kar-tahminleri-raporu': 'Bilanço' };
      const out = [];
      for (const [slug, cat] of Object.entries(feeds)) {
        const xml = await text(`https://arastirma.isyatirim.com.tr/category/yurtici-piyasalar/${slug}/feed/`);
        for (const it of xml.split('<item>').slice(1)) {
          const tags = [...it.matchAll(/<category><!\[CDATA\[(.*?)\]\]><\/category>/g)].map((m) => m[1]);
          const link = strip(it.match(/<link>(.*?)<\/link>/)?.[1]);
          out.push(item(this.name, 'isyatirim', {
            srcId: it.match(/\?p=(\d+)/)?.[1] || link, title: strip(it.match(/<title>(.*?)<\/title>/s)?.[1]), date: parseDate(it.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]), category: cat,
            symbols: [...new Set(tags.map((t) => t.replace(/\.IS$/, '')).filter((t) => /^[A-Z0-9]{4,6}$/.test(t)))], summary: strip(it.match(/<description>(.*?)<\/description>/s)?.[1]).replace(/\s*\[…\].*$/, '…').replace(/ yazısı ilk önce .*$/, ''),
            analyst: strip(it.match(/<dc:creator>(.*?)<\/dc:creator>/s)?.[1]), page: link,
          }));
        }
      }
      return out;
    },
    // Yazı sayfasındaki PDF eki
    async pdf(it) { const h = await text(it.page); return abs(it.page, h.match(/href="([^"]+wp-content\/uploads[^"]+\.pdf)"/i)?.[1]); },
  },
  yapikredi: {
    name: 'Yapı Kredi Yatırım', site: 'https://www.ykyatirim.com.tr/hizmetler/arastirma',
    async session() { const r = await get(this.site); await r.text(); return cookiesOf(r); },
    async list() {
      const cookie = await this.session();
      const d = await (await get('https://www.ykyatirim.com.tr/DetailPage/GetResearchReports', { method: 'POST', body: '', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://www.ykyatirim.com.tr', Referer: this.site } })).json();
      return (Array.isArray(d) ? d : []).filter((x) => !/teknik|destek|dip\/zirve|mekanik|günlük/i.test(x.reportTypeName)).map((x) => item(this.name, 'yapikredi', {
        srcId: x.id, title: x.title.replace(/^YKY\s*-\s*/, ''), date: parseDate(x.reportPostTime), cat: x.reportTypeName, summary: x.description, tags: (x.topicTag || []).join(' '),
        url: `https://www.ykyatirim.com.tr/DetailPage/GetFilePath?url=${x.filePath}`,
      }));
    },
    async headers() { return { Cookie: await this.session(), Referer: this.site }; },
  },
  ziraat: {
    name: 'Ziraat Yatırım', site: 'https://www.ziraatyatirim.com.tr/sirket-raporlari',
    async list() {
      const end = new Date(), begin = new Date(Date.now() - 365 * 86400_000);
      const iso = (d) => d.toISOString().slice(0, 10);
      const out = [];
      for (let page = 1; page <= 3; page++) {
        const html = await text('https://www.ziraatyatirim.com.tr/umbraco/api/ClockworkUploaderPublic/GetFilesByFilter', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ BeginDate: iso(begin), EndDate: iso(end), Page: page, PageSize: 20, SearchTerm: null, CategoryId: '39326', CheckSubCategory: 'True' }),
        });
        const lis = html.split('<li').slice(1);
        for (const li of lis) {
          const href = li.match(/href="([^"]+\.pdf)"/i)?.[1];
          if (!href) continue;
          const t = strip(`<li${li}`);
          const date = t.match(/\d{2}-\d{2}-\d{4}/)?.[0];
          const title = t.replace(date || '', '').trim();
          out.push(item(this.name, 'ziraat', { srcId: href.split('/').pop(), title: `${title} Şirket Raporu`, date: parseDate(date), category: 'Şirket', url: abs('https://www.ziraatyatirim.com.tr/', href) }));
        }
        if (!/Sayfa \d+ \/ (\d+)/.test(strip(html)) || Number(strip(html).match(/Sayfa (\d+) \/ (\d+)/)?.[2]) <= page) break;
      }
      return out;
    },
  },
  vakif: {
    name: 'Vakıf Yatırım', site: 'https://www.vkyanaliz.com/arastirma-raporlari/sirket-raporlari',
    async list() {
      const out = [];
      for (const [slug, cat] of [['sirket-raporlari', 'Şirket'], ['finansal-analiz', 'Bilanço'], ['sirket-toplanti-notlari', 'Şirket']]) {
        const html = await text(`https://www.vkyanaliz.com/arastirma-raporlari/${slug}`);
        for (const blk of html.split('class="listeici"').slice(1)) {
          const title = strip(blk.match(/class="yazigrubu">(.*?)<\/span>/s)?.[1]);
          const href = blk.match(/href="([^"]+\.pdf)"/i)?.[1];
          if (!title || !href) continue;
          out.push(item(this.name, 'vakif', { srcId: href.split('/').pop(), title, date: parseDate(strip(blk.match(/class="yayintarih">(.*?)<\/span>/s)?.[1])), category: cat, url: abs('https://www.vkyanaliz.com/', href) }));
        }
      }
      return out;
    },
  },
  tacirler: {
    name: 'Tacirler Yatırım', site: 'https://tacirler.com.tr/arastirma/sirket-raporlari/',
    async list() {
      const out = [];
      for (const [slug, cat] of [['sirket-raporlari', ''], ['bilanco-ozetleri', 'Bilanço'], ['tematik-raporlar', 'Strateji']]) {
        const html = await text(`https://tacirler.com.tr/arastirma/${slug}/`);
        const seen = new Set();
        for (const m of html.matchAll(/href="(https:\/\/tacirler\.com\.tr\/[a-z0-9-]+--(\d+))"/g)) {
          if (seen.has(m[2])) continue;
          seen.add(m[2]);
          const after = strip(html.slice(m.index, m.index + 1800)).replace(/^[^|]*?Devamını Oku\s*/, '');
          const date = after.match(/\d{2}\.\d{2}\.\d{4}/)?.[0];
          if (!date) continue;
          const [title, rest = ''] = after.split(date);
          if (!title.trim() || /sponsor/i.test(title)) continue;
          out.push(item(this.name, 'tacirler', { srcId: m[2], title: title.trim().slice(-160), date: parseDate(date), cat: cat || title, summary: rest.replace(/Devamını Oku.*$/s, '').trim(), page: m[1] }));
        }
      }
      return out;
    },
    async pdf(it) { const h = await text(it.page); return abs(it.page, h.match(/href="([^"]+\/upload\/files\/[^"]+\.pdf)"/i)?.[1]); },
  },
  gedik: {
    name: 'Gedik Yatırım', site: 'https://gedik.com/analiz/rapor-ve-analizler/yurt-ici-piyasa-rapor-ve-analizleri',
    // Sayfa verisi Next.js __NEXT_DATA__ içinde gelir; kategori parametresi tirelidir ("Şirket-Raporları"), sayfa başına 8 kayıt
    async list() {
      const out = [];
      const plan = [['Şirket-Raporları', 5, ''], ['Sektör-ve-Strateji-Raporları', 2, ''], ['Model-Portföy', 1, 'Model portföy']];
      for (const [catName, pages, cat] of plan) {
        for (let page = 1; page <= pages; page++) {
          const html = await text(`${this.site}?categoryName=${encodeURIComponent(catName)}${page > 1 ? `&page=${page}` : ''}`);
          const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
          if (!json) break;
          const tabTitle = catName.replace(/-/g, ' ');
          const find = (o) => { if (!o || typeof o !== 'object') return null; if (o.tabTitle === tabTitle && Array.isArray(o.tabsInfo)) return o; for (const v of Object.values(o)) { const r = find(v); if (r) return r; } return null; };
          const tab = find(JSON.parse(json));
          if (!tab?.tabsInfo?.length) break;
          for (const x of tab.tabsInfo) {
            if (!x.pdfUrl || x.subscriptionRequired) continue;
            out.push(item(this.name, 'gedik', { srcId: x.id, title: x.title.trim(), date: parseDate(x.historySort), cat: cat || `${tabTitle} ${x.title}`, summary: strip(x.informationText || x.shortText), url: x.pdfUrl }));
          }
        }
      }
      return out;
    },
  },
  halk: {
    name: 'Halk Yatırım', site: 'https://analizim.halkyatirim.com.tr/Analysis/AnalystRecommendations',
    // Açık sayfalar: tavsiye/hedef fiyat tablosu, halka arz değerlendirmeleri, Finansal Radar, yabancı işlemleri.
    // Şirket raporları müşteri girişi ister; onlar klasör izleme ile arşive alınır.
    async list() {
      const pages = [['Analysis/AnalystRecommendations', 'Şirket', 'Tavsiye ve hedef fiyat listesi: Halk Yatırım\'ın kapsadığı hisselerin tavsiyeleri ve 12 aylık hedef fiyatları'],
        ['ResearchReports/PriceDeterminationReports', 'Şirket', 'Halka arz fiyat tespit raporu değerlendirmesi'], ['Analysis/FinancialRadar', 'Strateji', null], ['Analysis/AylikYabanciIslemleriRaporu', 'Diğer', null]];
      const out = [];
      for (const [path, cat, summary] of pages) {
        const html = await text(`https://analizim.halkyatirim.com.tr/${path}`);
        if (/LoginUser\/Login/i.test(html) && !/\.pdf/i.test(html)) continue;
        const seen = new Set();
        for (const m of html.matchAll(/href="([^"]+\.pdf)"/gi)) {
          const url = decode(m[1]).replace(/([^:])\/\/+/g, '$1/');
          if (seen.has(url)) continue;
          seen.add(url);
          const file = url.split('/').pop().replace(/^\d+_/, '').replace(/\.pdf$/i, '');
          const before = html.slice(Math.max(0, m.index - 3000), m.index);
          const d = file.match(/\d{2}\.\d{2}\.\d{4}/)?.[0] || [...before.matchAll(/<strong>(\d{2}\.\d{2}\.\d{4})[^<]*<\/strong>/g)].at(-1)?.[1];
          out.push(item(this.name, 'halk', { srcId: url.split('/').slice(-3).join('/'), title: file, date: parseDate(d), category: cat, summary, url: encodeURI(url) }));
        }
      }
      return out;
    },
  },
  phillip: {
    name: 'PhillipCapital', site: 'https://www.phillipcapital.com.tr/arastirma-urunleri',
    async list() {
      const out = [];
      for (const cat of ['Şirket Raporları', 'Sektör Raporları', 'Strateji ve Model Portföy']) {
        const html = await text(`https://www.phillipcapital.com.tr/arastirma-urunleri?category=${encodeURIComponent(cat)}`);
        for (const art of html.split('<article class="product-item">').slice(1)) {
          const href = art.match(/href="([^"]+\.pdf)"/i)?.[1];
          if (!href || /uyari-metni/.test(href)) continue;
          const title = strip(art.match(/class="product-title">(.*?)<\/h3>/s)?.[1]);
          out.push(item(this.name, 'phillip', { srcId: href.split('/').pop(), title, date: parseDate(strip(art.match(/class="product-date">(.*?)<\/span>/s)?.[1])), cat: `${cat} ${title}`, url: abs('https://www.phillipcapital.com.tr/', href) }));
        }
      }
      return out;
    },
  },
  integral: {
    name: 'Integral Yatırım', site: 'https://www.integralyatirim.com.tr/sirket-sektor-raporlari',
    async list() {
      const html = await text(this.site);
      const out = [];
      for (const card of html.split('class="card border-0"').slice(1)) {
        const href = card.match(/href="([^"]+\.pdf)"/i)?.[1];
        const title = strip(card.match(/<h3[^>]*>(.*?)<\/h3>/s)?.[1]);
        if (!href || !title) continue;
        out.push(item(this.name, 'integral', { srcId: href.split('/').slice(-2).join('/'), title, date: parseDate(card.match(/<small title="([^"]+)"/)?.[1]), summary: strip(card.match(/<p class="card-text[^"]*">(.*?)<\/p>/s)?.[1]), url: abs('https://integralyatirim.com.tr/', href) }));
      }
      return out;
    },
  },
  a1: {
    name: 'A1 Capital', site: 'https://a1capital.com.tr/category/hisse-analiz/',
    async list() {
      const xml = await text('https://a1capital.com.tr/category/hisse-analiz/feed/');
      return xml.split('<item>').slice(1).map((it) => {
        const link = strip(it.match(/<link>(.*?)<\/link>/)?.[1]);
        const title = strip(it.match(/<title>(.*?)<\/title>/s)?.[1]);
        return item(this.name, 'a1', { srcId: link, title, date: parseDate(it.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]), cat: `Şirket ${title}`, summary: strip(it.match(/<description>(.*?)<\/description>/s)?.[1]).replace(/The post .*$/, ''), page: link, access: 'web' });
      });
    },
  },
};

export const BROKERS = Object.fromEntries(Object.entries(ADAPTERS).map(([k, a]) => [k, { name: a.name, site: a.site }]));
export const UNAVAILABLE = [
  { name: 'Halk Yatırım şirket raporları', reason: 'müşteri girişi gerektiriyor; hedef fiyat listesi akışta, tam raporlar klasör izleme ile arşive alınır' },
  { name: 'Deniz Yatırım', reason: 'site bot koruması kullanıyor' },
  { name: 'Alnus Yatırım', reason: 'site otomatik erişimi engelliyor' },
];

// ── Liste ────────────────────────────────────────────────────
let inflight = null;
export async function refresh(force = false) {
  const cached = cacheGet('research:list', LIST_TTL);
  // Yeni kurum eklendiyse eski önbellek kullanılmaz
  if (cached && !force && Object.keys(ADAPTERS).every((k) => k in (cached.status || {}))) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    await universe.refresh().catch(() => {});
    const status = {};
    const results = await Promise.all(Object.entries(ADAPTERS).map(async ([k, a]) => {
      try { const l = await a.list(); status[k] = { ok: true, count: l.length }; return l; } catch (e) { status[k] = { ok: false, error: e.message }; return []; }
    }));
    const prev = cacheGet('research:list', 30 * 86400_000);
    const byId = new Map((prev?.items || []).map((x) => [x.id, x]));
    for (const x of results.flat()) if (x.title && x.date) byId.set(x.id, { ...byId.get(x.id), ...x, firstSeen: byId.get(x.id)?.firstSeen || Date.now() });
    // Başarısız kurumun eski kayıtları korunur; 400 günden eskiler atılır
    const cutoff = Date.now() - 400 * 86400_000;
    const items = [...byId.values()].filter((x) => new Date(x.date).getTime() > cutoff).sort((a, b) => b.date.localeCompare(a.date));
    const data = { at: Date.now(), items, status };
    cachePut('research:list', data);
    return data;
  })().finally(() => { inflight = null; });
  return inflight;
}

// Şirket raporu: tek bir şirkete ait (şirket / bilanço değerlendirmesi, halka arz analist raporu).
// Strateji, sektör, makro, teknik notlar ve toplu hedef fiyat listeleri hariç.
const NOT_COMPANY = /sekt[öo]r|strateji|bist\s*100|genel de[ğg]erlendirme|tavsiyeleri ve hedef|model portf|haftal[ıi]k|ayl[ıi]k|g[üu]nl[üu]k|b[üu]lten|makro|teknik/i;
export function isCompanyReport(x) {
  if (!['Şirket', 'Bilanço'].includes(x.category) || NOT_COMPANY.test(x.title)) return false;
  return x.symbols.length > 0 || x.category === 'Şirket';
}

export async function list({ days = 30, broker = null, symbol = null, q = null, category: cat = null, scope = 'all', limit = 100, offset = 0 } = {}) {
  const d = await refresh();
  const since = Date.now() - days * 86400_000;
  const sym = symbol ? symbol.toUpperCase() : null;
  const needle = q ? q.toLocaleLowerCase('tr') : null;
  const items = d.items.filter((x) => (!days || new Date(x.date).getTime() >= since) && (!broker || x.brokerKey === broker)
    && (!sym || x.symbols.includes(sym)) && (!cat || x.category === cat) && (scope !== 'company' || isCompanyReport(x))
    && (!needle || `${x.title} ${x.summary || ''} ${x.broker} ${x.symbols.join(' ')}`.toLocaleLowerCase('tr').includes(needle)));
  const saved = savedIndex();
  return {
    at: d.at, total: items.length, status: d.status, brokers: BROKERS, unavailable: UNAVAILABLE,
    items: items.slice(offset, offset + limit).map((x) => ({ ...x, isNew: Date.now() - new Date(x.date).getTime() < 36 * 3600_000, saved: saved[x.id] || null })),
  };
}

// ── İndirme ve arşiv ─────────────────────────────────────────
const SAVED_KEY = 'research:saved';
const savedIndex = () => cacheGet(SAVED_KEY, 10 * 365 * 86400_000) || {};

async function resolvePdf(it) {
  const a = ADAPTERS[it.brokerKey];
  const url = it.url || (a?.pdf ? await a.pdf(it) : null);
  if (!url) throw new Error('Bu rapor PDF değil; kaynağında açın');
  return { url, headers: a?.headers ? await a.headers() : {} };
}

async function findItem(id) {
  const d = await refresh();
  const it = d.items.find((x) => x.id === id);
  if (!it) throw new Error('Rapor bulunamadı (liste yenilenmiş olabilir)');
  return it;
}

export async function fetchPdf(id) {
  const it = await findItem(id);
  const { url, headers } = await resolvePdf(it);
  const res = await get(url, { headers, timeoutMs: 60_000 });
  if (Number(res.headers.get('content-length')) > MAX_PDF) throw new Error('Rapor çok büyük');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Kaynak PDF döndürmedi (giriş veya abonelik gerekebilir)');
  return { it, buf };
}

const slug = (s) => String(s || '').toLocaleLowerCase('tr').replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[c])).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

// Raporu arşive indirir; Raporlar sekmesinde kurum raporu olarak görünür
export async function save(id) {
  const idx = savedIndex();
  if (idx[id] && fs.existsSync(path.join(REPORTS_DIR, idx[id]))) return { name: idx[id], path: `reports/${idx[id]}`, cached: true };
  const { it, buf } = await fetchPdf(id);
  const rel = path.join('kurum', it.brokerKey, `${it.date.slice(0, 10)}-${slug(it.title) || 'rapor'}.pdf`);
  fs.mkdirSync(path.dirname(path.join(REPORTS_DIR, rel)), { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, rel), buf);
  store.setReportMeta(rel, { title: it.title, broker: it.broker, symbols: it.symbols, source: it.url || it.page });
  cachePut(SAVED_KEY, { ...idx, [id]: rel });
  return { name: rel, path: `reports/${rel}`, size: buf.length, broker: it.broker, title: it.title, symbols: it.symbols };
}

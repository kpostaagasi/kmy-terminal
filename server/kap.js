// KAP (Kamuyu Aydınlatma Platformu) bildirim akışı, sinyal sınıflandırması ve bildirim içeriği.
// KAP hız sınırı uyguluyor: liste için tek sorgu + en az 2 dk önbellek; 429'da üstel geri çekilme.
import { cacheGet, cachePut } from './db.js';

const LIST_URL = 'https://www.kap.org.tr/tr/api/disclosure/members/byCriteria';
const MIN_INTERVAL = 120_000;
// Elle yenileme: bu andan önce yazılmış "bugün" önbellekleri bayat sayılır (en sık 20 sn'de bir)
let forceAt = 0;
const fresh = (ms) => Math.min(ms, Math.max(0, Date.now() - forceAt));
export function forceRefresh() {
  if (Date.now() - forceAt < 20_000) return false;
  forceAt = Date.now();
  return true;
}
let backoffUntil = 0;
let backoffMs = 60_000;
const inflight = new Map();

export const CLASS_LABELS = { FR: 'Finansal Rapor', ODA: 'Özel Durum', DG: 'Diğer', DKB: 'Düzenleyici Kurum' };

// Sinyal sınıfları (terminalin kendi kuralları; konu + özet metnine göre)
export const SIGNALS = {
  TEZ: { label: 'TEZ', title: 'Tezi değiştirebilecek gelişme (sözleşme, ihale, satın alma, dava, pay alım teklifi…)' },
  YAPISAL: { label: 'YAP', title: 'Sermaye / ortaklık yapısı (sermaye artırımı, geri alım, içeriden alım-satım, devre kesici…)' },
  FINANSAL: { label: 'FİN', title: 'Finansal rapor, temettü, borçlanma aracı, kredi derecelendirmesi' },
  KURUMSAL: { label: 'KUR', title: 'Genel kurul, yönetim, denetim, kurumsal yönetim formları' },
  DIGER: { label: 'DİĞER', title: 'Diğer bildirimler ve kurum duyuruları' },
};

const R = {
  FINANSAL: /finansal rapor|faaliyet raporu|kar payı|kâr payı|temettü|pay dışında sermaye piyasası aracı|borçlanma aracı|ihraç tavanı|tertip ihraç|kira sertifika|kupon|itfa|fiyat tespit|kredi derecelendirme|derecelendirme notu|finansman|nakit akış/,
  TEZ: /iş ilişkisi|sözleşme|ihale|sipariş|birleşme|devralma|satın al|edinim|duran varlık|pay alım teklifi|yatırım kararı|yatırım teşvik|kapasite|dava|para cezası|soruşturma|ortak girişim|iflas|konkordato|lisans|patent|ihracat|anlaşma|protokol|tesis|üretime başla|fiyat artış|zam /,
  YAPISAL: /sermaye artırım|sermaye azaltım|bedelsiz|bedelli|kayıtlı sermaye|esas sözleşme|geri alın|geri alım|pay alım satım|ortaklık yapısı|pay grubu|imtiyaz|bölünme|pazar değişikliği|devre kesici|işlem yasağı|halka arz|pay satış|hisse satış|blok satış/,
  KURUMSAL: /genel kurul|yönetim kurulu|bağımsız denetim|kurumsal yönetim|bilgilendirme politikası|genel bilgi formu|atama|istifa|görev dağılımı|komite|sürdürülebilirlik|yatırımcı ilişkileri|imza sirküleri|ücret politikası/,
};

export function classify(x) {
  if (x.cls === 'FR') return 'FINANSAL';
  const subj = String(x.subject || '').toLocaleLowerCase('tr');
  const text = `${subj} ${String(x.summary || '').toLocaleLowerCase('tr')}`;
  if (x.cls === 'DKB') {
    if (/devre kesici|işlem yasağı|tedbir|pay alım satım|hak kullanımı$|tipe dönüşüm/.test(subj)) return 'YAPISAL';
    if (/mali hak kullanım|nakit ödeme/.test(subj)) return 'FINANSAL';
    return 'DIGER';
  }
  if (/haber ve söylenti/.test(subj)) return 'TEZ';
  if (/değerleme raporu/.test(subj)) return 'FINANSAL';
  if (/ilişkili taraf|merkezi değişikliği|merkez değişikliği/.test(subj)) return 'KURUMSAL';
  if (/piyasa yapıcı|likidite sağlayıcı|varant|sertifika/.test(subj)) return 'DIGER';
  if (/özel durum açıklaması \(genel\)|genel açıklama/.test(subj)) {
    // Genel başlıklı bildirimlerde özete bak
    for (const k of ['TEZ', 'YAPISAL', 'FINANSAL']) if (R[k].test(text)) return k;
    return 'KURUMSAL';
  }
  for (const k of ['FINANSAL', 'YAPISAL', 'TEZ', 'KURUMSAL']) if (R[k].test(subj)) return k;
  for (const k of ['TEZ', 'YAPISAL', 'FINANSAL', 'KURUMSAL']) if (R[k].test(text)) return k;
  return 'DIGER';
}

const iso = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); // İstanbul takvim günü
const addDays = (isoDate, n) => iso(new Date(new Date(`${isoDate}T12:00:00Z`).getTime() + n * 86400_000));

function parseDate(s) {
  // "23.09.2026 11:18:14" → ISO (+03:00)
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):?(\d{2})?/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}+03:00` : null;
}

function slim(x) {
  const it = {
    id: x.disclosureIndex,
    date: parseDate(x.publishDate),
    publishDate: x.publishDate,
    company: x.kapTitle,
    stocks: (x.stockCodes || x.relatedStocks || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
    cls: x.disclosureClass,
    clsLabel: CLASS_LABELS[x.disclosureClass] || x.disclosureClass,
    type: x.disclosureType,
    subject: x.subject || x.summary,
    summary: x.summary && x.summary !== x.subject ? x.summary : null,
    period: x.period, year: x.year,
    late: !!x.isLate,
    attachments: x.attachmentCount || 0,
    fund: x.fundCode || null,
    url: `https://www.kap.org.tr/tr/Bildirim/${x.disclosureIndex}`,
  };
  it.signal = classify(it);
  return it;
}

async function kapFetch(url, init = {}) {
  if (Date.now() < backoffUntil) throw new Error('KAP hız sınırı; kısa süre sonra tekrar denenecek');
  const res = await fetch(url, { ...init, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json, text/html', ...(init.headers || {}) }, signal: AbortSignal.timeout(25_000) });
  if (res.status === 429) {
    backoffUntil = Date.now() + backoffMs;
    backoffMs = Math.min(backoffMs * 2, 30 * 60_000);
    throw new Error('KAP hız sınırı (429); bir süre sonra tekrar denenecek');
  }
  if (!res.ok) throw new Error(`KAP HTTP ${res.status}`);
  backoffMs = 60_000;
  return res;
}

const byNewest = (a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id;
const KAP_PAGE_CAP = 2000;   // KAP tek istekte en fazla 2000 bildirim döndürür (günde ~400 bildirim)
const WINDOW_DAYS = 4;

async function postCriteria(criteria) {
  const res = await kapFetch(LIST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(criteria) });
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('KAP beklenmeyen yanıt');
  return data;
}

// Tek pencere; sınıra takılırsa ikiye bölünür. Geçmiş pencereler değişmediği için uzun süre önbellekte kalır.
async function fetchWindow(fromDate, toDate) {
  const key = `kapw:${fromDate}:${toDate}`;
  const hit = cacheGet(key, toDate < iso(new Date()) ? 6 * 3600_000 : fresh(MIN_INTERVAL));
  if (hit) return hit;
  let items = (await postCriteria({ fromDate, toDate })).map(slim);
  if (items.length >= KAP_PAGE_CAP && fromDate < toDate) {
    const span = Math.round((new Date(toDate) - new Date(fromDate)) / 86400_000);
    const mid = addDays(fromDate, Math.floor(span / 2));
    items = [...await fetchWindow(fromDate, mid), ...await fetchWindow(addDays(mid, 1), toDate)];
  }
  cachePut(key, items);
  return items;
}

async function fetchRange(fromDate, toDate) {
  const all = new Map();
  for (let end = toDate; end >= fromDate; end = addDays(end, -WINDOW_DAYS)) {
    const start = addDays(end, -(WINDOW_DAYS - 1)) < fromDate ? fromDate : addDays(end, -(WINDOW_DAYS - 1));
    for (const it of await fetchWindow(start, end)) all.set(it.id, it);
  }
  return [...all.values()].sort(byNewest);
}

// ── Şirket bazlı geçmiş (KAP üye kimliği ile; 2 yıla kadar) ─────────
async function memberOids() {
  const cached = cacheGet('kap:oids', 7 * 86400_000);
  if (cached) return cached;
  const html = await (await kapFetch('https://www.kap.org.tr/tr/bist-sirketler')).text();
  const txt = html.replace(/\\"/g, '"');
  const map = {};
  for (const m of txt.matchAll(/"mkkMemberOid":"([0-9a-f]{32})","kapMemberTitle":"[^"]*"[^{}]*?"stockCode":"([^"]*)"/g)) {
    for (const code of m[2].split(/[,\s]+/).filter(Boolean)) map[code.toUpperCase()] ||= m[1];
  }
  if (Object.keys(map).length < 100) throw new Error('KAP şirket listesi ayrıştırılamadı');
  cachePut('kap:oids', map);
  return map;
}

export async function companyDisclosures(symbol, days = 365) {
  const code = String(symbol).toUpperCase().replace(/\.IS$/, '');
  const key = `kapc:${code}:${days}`;
  const hit = cacheGet(key, fresh(10 * 60_000));
  if (hit) return hit;
  const oid = (await memberOids())[code];
  if (!oid) throw new Error(`${code} için KAP şirket kaydı bulunamadı`);
  const to = iso(new Date());
  const items = (await postCriteria({ fromDate: addDays(to, -days), toDate: to, mkkMemberOidList: [oid] })).map(slim).sort(byNewest);
  cachePut(key, items);
  return items;
}

// Son N günün tüm bildirimleri (önbellekli)
export async function recent(days = 3) {
  const key = `kap:${days}`;
  const hot = cacheGet(key, fresh(MIN_INTERVAL));
  if (hot) return { items: hot.map(ensureSignal), stale: false };
  const stale = cacheGet(key, 7 * 86400_000);
  if (Date.now() < backoffUntil) return { items: (stale || []).map(ensureSignal), stale: true, error: 'KAP hız sınırı; önbellekten gösteriliyor' };
  if (!inflight.has(days)) {
    const to = new Date();
    const from = new Date(Date.now() - days * 86400_000);
    inflight.set(days, fetchRange(iso(from), iso(to))
      .then((items) => { cachePut(key, items); return items; })
      .finally(() => inflight.delete(days)));
  }
  try {
    return { items: await inflight.get(days), stale: false };
  } catch (e) {
    return { items: (stale || []).map(ensureSignal), stale: true, error: e.message };
  }
}
const ensureSignal = (x) => (x.signal ? x : { ...x, signal: classify(x) });

// Sembol, sınıf, sinyal ve metin filtresi + sayfalama
export async function disclosures({ symbols = null, days = 3, cls = null, signal = null, q = null, funds = false, limit = 200, offset = 0 } = {}) {
  let src;
  if (symbols?.length && days > 7) {
    // Uzun dönem + sembol: şirket bazlı sorgu (tam geçmiş, piyasa geneli listenin sınırına takılmaz)
    const merged = new Map(); let error = null;
    for (const s of [...new Set(symbols.map((x) => x.toUpperCase()))].slice(0, 15)) {
      try { for (const it of await companyDisclosures(s, Math.min(days, 730))) merged.set(it.id, it); } catch (e) { error = e.message; }
    }
    src = { items: [...merged.values()].sort(byNewest), stale: false, error };
  } else {
    src = await recent(Math.min(days, 31));
  }
  const { items, stale, error } = src;
  const set = symbols && symbols.length ? new Set(symbols.map((s) => s.toUpperCase())) : null;
  const needle = q ? q.toLocaleLowerCase('tr') : null;
  const out = items.filter((x) => {
    if (set && !x.stocks.some((s) => set.has(s))) return false;
    // Takasbank/MKK gibi kurumların onlarca hisseyi listeleyen toplu duyuruları sembol filtresinde gürültü yapar
    // Sembol kapsamında düzenleyici kurumların rutin duyuruları (temerrüt, bülten) gürültüdür
    if (set && x.cls === 'DKB' && (x.stocks.length > 3 || x.signal === 'DIGER')) return false;
    if (!funds && x.fund && !set) return false;
    if (cls && x.cls !== cls) return false;
    if (signal && x.signal !== signal) return false;
    if (needle && !(`${x.company} ${x.subject} ${x.summary || ''} ${x.stocks.join(' ')}`.toLocaleLowerCase('tr').includes(needle))) return false;
    return true;
  });
  const counts = {};
  for (const x of items) {
    if (set ? !x.stocks.some((s) => set.has(s)) || (x.cls === 'DKB' && (x.stocks.length > 3 || x.signal === 'DIGER')) : !funds && x.fund) continue;
    counts[x.signal] = (counts[x.signal] || 0) + 1;
  }
  return { items: out.slice(offset, offset + limit), total: out.length, offset, counts, stale, error };
}

export async function forSymbol(symbol, days = 30) {
  return disclosures({ symbols: [symbol], days });
}

// ── Bildirim içeriği ─────────────────────────────────────
// KAP detay sayfası Next.js RSC akışı içinde bildirimin HTML gövdesini, üst verisini ve eklerini taşır.
function flightText(html) {
  const parts = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { parts.push(JSON.parse(m[1])); } catch { /* bozuk parça */ }
  }
  return parts.join('');
}

// RSC "T" satırları: <id>:T<bayt uzunluğu hex>,<metin>
function textRows(txt) {
  const rows = [];
  for (const m of txt.matchAll(/(?:^|\n|\])([0-9a-f]{1,4}):T([0-9a-f]+),/g)) {
    const start = m.index + m[0].length;
    const bytes = parseInt(m[2], 16);
    const body = Buffer.from(txt.slice(start, start + bytes + 64), 'utf8').subarray(0, bytes).toString('utf8');
    rows.push(body);
  }
  return rows;
}

// "anahtar": {…} veya [...] değerini parantez sayarak çıkar
function jsonValueAfter(txt, key) {
  const i = txt.indexOf(`"${key}":`);
  if (i < 0) return null;
  let j = i + key.length + 3;
  const open = txt[j];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false;
  for (let k = j; k < txt.length; k++) {
    const c = txt[k];
    if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) { try { return JSON.parse(txt.slice(j, k + 1)); } catch { return null; } }
  }
  return null;
}

// class içinde content-en geçen öğeleri (İngilizce kopya, gizli) at; betik/stil/olay özniteliklerini temizle
function cleanHtml(html) {
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  let out = '', skip = 0, last = 0;
  const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'col', 'wbr']);
  for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g)) {
    if (!skip) out += html.slice(last, m.index);
    last = m.index + m[0].length;
    const [, closing, tag, attrs] = m;
    const t = tag.toLowerCase();
    if (skip) {
      if (VOID.has(t) || /\/\s*$/.test(attrs)) continue;
      if (closing) skip--; else skip++;
      continue;
    }
    // Gizli öğeler: İngilizce kopya, taksonomi alan adları, display:none
    if (!closing && !VOID.has(t) && (/class="[^"]*(content-en|taxonomy-field-name|field-documentation)/.test(attrs) || /style="[^"]*display:\s*none/i.test(attrs))) { skip = 1; continue; }
    out += m[0].replace(/\son\w+="[^"]*"/gi, '').replace(/javascript:/gi, '');
  }
  if (!skip) out += html.slice(last);
  return out;
}

function htmlToText(html) {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(tr|p|div|li|h\d)>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map((l) => l.replace(/\s*\|\s*(\|\s*)*$/, '').replace(/^\s*\|\s*/, '').replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l && !/^\[[A-Z_]+\]$/.test(l) && !/^(oda|kap|dg|fr)_[A-Za-z]/.test(l) && l !== 'Türkçe').join('\n');
}

export async function detail(id) {
  id = String(id).replace(/\D/g, '');
  if (!id) throw new Error('Geçersiz bildirim numarası');
  const key = `kapd:${id}`;
  const cached = cacheGet(key, 30 * 86400_000);
  if (cached) return cached;
  const url = `https://www.kap.org.tr/tr/Bildirim/${id}`;
  const html = await (await kapFetch(url)).text();
  const txt = flightText(html);
  const bodies = textRows(txt).filter((b) => /<table|<div/.test(b));
  const body = bodies.find((b) => /taxonomy|financial-header-table/.test(b)) || bodies.sort((a, b) => b.length - a.length)[0] || '';
  const basic = jsonValueAfter(txt, 'disclosureBasic') || {};
  let attachments = [];
  for (let k = 0, pos = 0; k < 5; k++) {
    const i = txt.indexOf('"attachments":[{', pos);
    if (i < 0) break;
    const arr = jsonValueAfter(txt.slice(i), 'attachments');
    if (Array.isArray(arr)) attachments = arr;
    pos = i + 10;
    if (attachments.length) break;
  }
  const clean = cleanHtml(body);
  const out = {
    id: Number(id), url,
    title: basic.title || null, company: basic.companyTitle || null,
    stocks: String(basic.stockCode || '').split(/[,\s]+/).filter(Boolean),
    publishDate: basic.publishDate || null, summary: basic.summary || null,
    html: clean, text: htmlToText(clean).slice(0, 60_000),
    attachments: attachments.filter((a) => a?.objId).map((a) => ({ name: a.fileName || 'ek', ext: a.fileExtension || '', url: `https://www.kap.org.tr/tr/api/file/download/${a.objId}` })),
  };
  if (!out.text) throw new Error('Bildirim içeriği ayrıştırılamadı; KAP sayfasında açın');
  cachePut(key, out);
  return out;
}

// ── Bildirim ekleri ─────────────────────────────────────────
// KAP dosyaları Java serileştirilmiş bayt dizisi içinde gelir (AC ED 00 05 … "xp" + 4 bayt uzunluk + veri)
export function unwrapKapFile(buf) {
  if (buf.length > 30 && buf[0] === 0xac && buf[1] === 0xed && buf[2] === 0x00 && buf[3] === 0x05) {
    const i = buf.indexOf(Buffer.from([0x78, 0x70]));
    if (i > 0 && i + 6 <= buf.length) {
      const len = buf.readUInt32BE(i + 2);
      if (len > 0 && i + 6 + len <= buf.length) return buf.subarray(i + 6, i + 6 + len);
    }
  }
  return buf;
}

const MAX_ATTACHMENT = 80 * 1024 * 1024;
export async function attachment(ref) {
  const id = String(ref || '').match(/([a-f0-9]{16,64})\/?$/i)?.[1];
  if (!id) throw new Error('Geçersiz KAP eki: dosya bağlantısı veya kimliği bekleniyor');
  const res = await kapFetch(`https://www.kap.org.tr/tr/api/file/download/${id}`, { headers: { Accept: '*/*' } });
  if (Number(res.headers.get('content-length')) > MAX_ATTACHMENT) throw new Error('Ek çok büyük (80 MB üstü); KAP sayfasından indirin');
  const buf = unwrapKapFile(Buffer.from(await res.arrayBuffer()));
  const cd = res.headers.get('content-disposition') || '';
  let name = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || cd.match(/filename="?([^";]+)"?/i)?.[1] || `${id}.pdf`;
  try { name = decodeURIComponent(name); } catch { /* ham ad */ }
  const head = buf.subarray(0, 8).toString('latin1');
  const type = head.startsWith('%PDF-') ? 'application/pdf' : /^\x89PNG/.test(head) ? 'image/png' : /^\xff\xd8/.test(head) ? 'image/jpeg' : 'application/octet-stream';
  return { id, name, type, buf };
}

// Takvim: ağ ve önbellek katmanı. Olay kuralları takvim.js'tedir (saf, çevrimdışı test edilir).
// Sağlayıcılar: TCMB (tcmb.gov.tr tablosu), temettü/sermaye artırımı (İş Yatırım, universe.js), bilanço (KAP).
import { cacheGet, cachePut } from './db.js';
import * as universe from './universe.js';
import * as kap from './kap.js';
import * as store from './store.js';
import * as pf from './portfolio.js';
import { normalize, isBist } from './market.js';
import { parseTcmb, corporateEvents, bilancoEvents, plausibleAnnouncements, marketSeasonEvents, buildCalendar, defaultWindow, istanbulToday, KINDS } from './takvim.js';

const TCMB_URL = 'https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Duyurular/Takvim';
const DAY = 86400_000;

/** TCMB olayları: günde bir çekilir; çekilemezse son başarılı kayıt (30 güne kadar) `stale` ile kullanılır. */
export async function tcmbEvents() {
  const hit = cacheGet('takvim:tcmb', DAY);
  if (hit) return { events: hit.events, stale: false };
  try {
    const res = await fetch(TCMB_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`TCMB HTTP ${res.status}`);
    const events = parseTcmb(await res.text());
    cachePut('takvim:tcmb', { events });
    return { events, stale: false };
  } catch (e) {
    const old = cacheGet('takvim:tcmb', 30 * DAY);
    if (old) return { events: old.events, stale: true, error: e.message };
    return { events: [], stale: false, error: e.message };
  }
}

/**
 * Bir sembolün son 365 gündeki finansal rapor açıklamaları (KAP; sembol başına 24 saat önbellek).
 * Dönem (1 = 3 ay … 4 = yıllık) başına EN ERKEN gün alınır (düzeltme bildirimleri sonradan gelir).
 * consolidated: bildirim başlıklarında "Konsolide" geçiyorsa true; kayıt var ama geçmiyorsa false; hiç kayıt yoksa null.
 */
export async function announcedFor(symbol) {
  const key = `takvim:fr:${symbol}`;
  const hit = cacheGet(key, DAY);
  if (hit) return hit;
  const items = await kap.companyDisclosures(symbol, 365);
  const fr = items.filter((x) => x.cls === 'FR' && x.period && x.year);
  const best = new Map();
  for (const x of fr) {
    const k = `${x.period}/${x.year}`;
    const date = String(x.date).slice(0, 10); // KAP tarihi +03:00 ofsetli: ilk 10 karakter İstanbul günüdür
    if (!best.has(k) || date < best.get(k).date) best.set(k, { period: Number(x.period), year: Number(x.year), date });
  }
  const consolidated = fr.length ? fr.some((x) => /konsolide/i.test(x.subject || '')) : null;
  const out = { announced: plausibleAnnouncements([...best.values()], consolidated), consolidated };
  cachePut(key, out);
  return out;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Takvim yanıtı. Sembole bağlı olaylar kapsamla (listem/portföyüm) sınırlanır; TCMB olayları her kapsamda gelir. `mine`: listedeki ve portföydeki BIST sembolleri (arayüz işaretlemesi için). */
export async function calendar({ scope = 'portfolio', from = null, to = null, kinds = null, now = Date.now() } = {}) {
  if (!['watchlist', 'portfolio', 'all'].includes(scope)) throw new Error('Geçersiz kapsam');
  if (kinds && kinds.some((k) => !KINDS.includes(k))) throw new Error('Geçersiz olay türü');
  const today = istanbulToday(now);
  const w = defaultWindow(today);
  from = from || w.from;
  to = to || w.to;

  const bist = (list) => [...new Set(list.map(normalize))].filter((s) => s && isBist(s));
  const mine = { watchlist: bist(store.watchlist()), portfolio: bist(pf.computeLedger().holdings.map((h) => h.symbol)) };
  const symbols = scope === 'all' ? null : mine[scope];

  const events = [], warnings = [], stale = [];

  const tc = await tcmbEvents();
  events.push(...tc.events);
  if (tc.stale) stale.push('tcmb');
  if (tc.error) warnings.push({ source: 'tcmb', message: tc.error });

  await universe.refresh().catch(() => {});
  events.push(...corporateEvents(await universe.corporateActions({ symbols, from, to })));

  if (symbols) {
    await pool(symbols, 2, async (symbol) => {
      try {
        const { announced, consolidated } = await announcedFor(symbol);
        events.push(...bilancoEvents({ symbol, today, announced, consolidated }));
      } catch (e) { warnings.push({ source: 'kap', message: `${symbol}: ${e.message}` }); }
    });
  } else events.push(...marketSeasonEvents(today));

  return { today, from, to, scope, events: buildCalendar({ from, to, events, kinds }), warnings, stale, emptyScope: !!symbols && symbols.length === 0, mine: [...new Set([...mine.watchlist, ...mine.portfolio])] };
}

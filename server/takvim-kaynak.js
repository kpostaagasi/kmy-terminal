// Takvim: ağ ve önbellek katmanı. Olay kuralları takvim.js'tedir (saf, çevrimdışı test edilir).
// Sağlayıcılar: TCMB (tcmb.gov.tr tablosu), temettü/sermaye artırımı (İş Yatırım, universe.js), bilanço (KAP).
import { cacheGet, cachePut } from './db.js';
import * as universe from './universe.js';
import * as kap from './kap.js';
import * as store from './store.js';
import * as pf from './portfolio.js';
import { normalize, isBist } from './market.js';
import { parseTcmb, corporateEvents, bilancoEvents, plausibleAnnouncements, isConsolidated, marketSeasonEvents, buildCalendar, defaultWindow, istanbulToday, KINDS } from './takvim.js';

const TCMB_URL = 'https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Duyurular/Takvim';
const DAY = 86400_000;

const TCMB_BACKOFF = 5 * 60_000;
let tcmbFail = { at: 0, error: null }; // hata sonrası kısa süre yeniden denenmez: her tıklama 10 sn beklemesin
let tcmbInflight = null;

async function fetchTcmb() {
  const res = await fetch(TCMB_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`TCMB HTTP ${res.status}`);
  return parseTcmb(await res.text());
}

/** TCMB olayları: günde bir çekilir; çekilemezse (5 dk geri çekilmeyle) son başarılı kayıt (30 güne kadar) `stale` ile kullanılır. */
export async function tcmbEvents() {
  const hit = cacheGet('takvim:tcmb', DAY);
  if (hit) return { events: hit.events, stale: false };
  const fallback = (error) => { const old = cacheGet('takvim:tcmb', 30 * DAY); return { events: old?.events || [], stale: !!old, error }; };
  if (Date.now() - tcmbFail.at < TCMB_BACKOFF) return fallback(tcmbFail.error);
  if (!tcmbInflight) {
    tcmbInflight = fetchTcmb()
      .then((events) => { cachePut('takvim:tcmb', { events }); tcmbFail = { at: 0, error: null }; return { events, stale: false }; })
      .catch((e) => { tcmbFail = { at: Date.now(), error: e.message }; return fallback(e.message); })
      .finally(() => { tcmbInflight = null; });
  }
  return tcmbInflight;
}

/**
 * Bir sembolün son 365 gündeki finansal rapor açıklamaları (KAP; sembol başına 24 saat önbellek).
 * Dönem (1 = 3 ay … 4 = yıllık) başına EN ERKEN gün alınır (düzeltme bildirimleri sonradan gelir).
 * consolidated: isConsolidated (takvim.js): "(Konsolide)" → true, "(Konsolide Olmayan)" → false, ifade yoksa null (konsolide süre varsayılır).
 */
const announcedInflight = new Map();
async function fetchAnnounced(symbol, key) {
  const items = await kap.companyDisclosures(symbol, 365);
  const fr = items.filter((x) => x.cls === 'FR' && x.period && x.year);
  const best = new Map();
  for (const x of fr) {
    const k = `${x.period}/${x.year}`;
    const date = String(x.date).slice(0, 10); // KAP tarihi +03:00 ofsetli: ilk 10 karakter İstanbul günüdür
    if (!best.has(k) || date < best.get(k).date) best.set(k, { period: Number(x.period), year: Number(x.year), date });
  }
  const consolidated = isConsolidated(fr.map((x) => x.subject));
  const out = { announced: plausibleAnnouncements([...best.values()], consolidated), consolidated };
  cachePut(key, out);
  return out;
}
export async function announcedFor(symbol) {
  const key = `takvim:fr:${symbol}`;
  const hit = cacheGet(key, DAY);
  if (hit) return hit;
  if (!announcedInflight.has(symbol)) announcedInflight.set(symbol, fetchAnnounced(symbol, key).finally(() => announcedInflight.delete(symbol)));
  return announcedInflight.get(symbol);
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
  buildCalendar({ from, to, events: [], kinds }); // geçersiz tarih ağ işinden ÖNCE reddedilir
  const want = kinds && kinds.length ? kinds : KINDS;

  const bist = (list) => [...new Set(list.map(normalize))].filter((s) => s && isBist(s));
  const mine = { watchlist: bist(store.watchlist()), portfolio: bist(pf.computeLedger().holdings.map((h) => h.symbol)) };
  const symbols = scope === 'all' ? null : mine[scope];

  const events = [], warnings = [], stale = [];

  // TCMB diğer kaynaklarla paralel çekilir; yalnız istenen türlerin kaynağına gidilir (KAP hız sınırı)
  const tcP = want.includes('tcmb') ? tcmbEvents() : null;

  if (want.includes('temettu') || want.includes('sermaye')) {
    await universe.refresh().catch(() => {});
    events.push(...corporateEvents(await universe.corporateActions({ symbols, from, to })));
  }

  if (want.includes('bilanco')) { // KAP yalnız bilanço istenirse çağrılır
    if (symbols) {
      await pool(symbols, 2, async (symbol) => {
        try {
          const { announced, consolidated } = await announcedFor(symbol);
          events.push(...bilancoEvents({ symbol, today, announced, consolidated }));
        } catch (e) { warnings.push({ source: 'kap', message: `${symbol}: ${e.message}` }); }
      });
    } else events.push(...marketSeasonEvents(today));
  }

  if (tcP) {
    const tc = await tcP;
    events.push(...tc.events);
    if (tc.stale) stale.push('tcmb');
    if (tc.error) warnings.push({ source: 'tcmb', message: tc.error });
  }

  return { today, from, to, scope, events: buildCalendar({ from, to, events, kinds }), warnings, stale, emptyScope: !!symbols && symbols.length === 0, mine: [...new Set([...mine.watchlist, ...mine.portfolio])] };
}

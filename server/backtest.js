// Sinyal geçmiş performansı (backtest) motoru. Saf (veritabanı ve ağ yok).
// Olay = sinyalin YENİ belirdiği gün. Sinyal kapanıştan sonra görülür: giriş ertesi günün açılışı, çıkış sinyalden h işlem günü
// sonraki kapanış. Taban = aynı hisselerde her gün için aynı giriş/çıkış kuralı. Ayrıntı: docs/superpowers/specs/2026-10-02-sinyal-backtest-design.md
import { SIGNALS, signalSeries, signalsAt } from './sinyal-tanim.js';
import { adjustSplits } from './seri.js';

export const HORIZONS = [5, 20, 60];
export const GAP = 20;       // aynı hisse + sinyal için bu kadar işlem günü içindeki tekrarlar sayılmaz
export const WARMUP = 210;   // SMA200 ve MACD tam otursun
export const MIN_N = 30;     // altı "az örnek"
export const MIN_BARS = 300; // daha kısa seri atlanır

const day = (t) => new Date(t).toISOString().slice(0, 10);
const okPx = (x) => Number.isFinite(x) && x > 0;

/**
 * Bir hisse için ham gözlemler.
 *  bars:  düzeltilmiş mumlar; bench: endeks mumları (ya da null)
 *  opts.signals: (i) => string[] (varsayılan: sinyal-tanim.js); testlerde sabit sinyal enjekte etmek için
 * Döner: { events: [{ signal, i, date, rets: { h: { r, ex } } }], base: { h: [{ r, ex }] } }
 * r: getiri (oran), ex: XU100'a göre fark (endekste tarih yoksa null).
 */
export function symbolObservations(bars, bench, { horizons = HORIZONS, gap = GAP, warmup = WARMUP, signals = null } = {}) {
  const n = bars.length;
  const sig = signals || (() => { const S = signalSeries(bars); return (i) => signalsAt(S, i); })();
  const bi = bench ? new Map(bench.map((b, k) => [day(b.t), k])) : null;
  const retAt = (i, h) => {
    if (i + h > n - 1) return null;
    const entry = bars[i + 1].o, exit = bars[i + h].c;
    if (!okPx(entry) || !okPx(exit)) return null;
    const r = exit / entry - 1;
    let ex = null;
    if (bi) {
      const a = bi.get(day(bars[i + 1].t)), b = bi.get(day(bars[i + h].t));
      if (a != null && b != null && okPx(bench[a].o) && okPx(bench[b].c)) ex = r - (bench[b].c / bench[a].o - 1);
    }
    return { r, ex };
  };
  const events = [];
  const base = Object.fromEntries(horizons.map((h) => [h, []]));
  const last = {};
  let prev = new Set(sig(warmup - 1));
  for (let i = warmup; i < n - 1; i++) {
    const cur = sig(i);
    for (const h of horizons) { const x = retAt(i, h); if (x) base[h].push(x); }
    for (const k of cur) {
      if (prev.has(k)) continue;                          // yeni belirme değil
      if (last[k] != null && i - last[k] <= gap) continue; // son KABUL edilen olaya çok yakın
      last[k] = i;
      const rets = {};
      for (const h of horizons) { const x = retAt(i, h); if (x) rets[h] = x; }
      events.push({ signal: k, i, date: day(bars[i].t), rets });
    }
    prev = new Set(cur);
  }
  return { events, base };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function stats(obs) {
  const n = obs.length;
  const r = obs.map((o) => o.r), ex = obs.filter((o) => o.ex != null).map((o) => o.ex);
  return {
    n, mean: n ? mean(r) : null, median: n ? median(r) : null,
    hitUp: n ? r.filter((x) => x > 0).length / n : null, hitDown: n ? r.filter((x) => x < 0).length / n : null,
    excess: ex.length ? mean(ex) : null, excessN: ex.length,
  };
}

/**
 * Gözlemleri tabloya çevirir.
 *  all: { base: { h: [obs] }, events: { sinyal: { h: [obs] } } }
 * Her sinyal satırı: { dir, label, [h]: { n, mean, median, hit, excess, excessN, delta, low } }
 *  hit: sinyal yönüne göre (down: getiri < 0, aksi halde > 0); delta: ortalama − taban ortalaması (puan, oran olarak)
 */
export function aggregate(all, { horizons = HORIZONS, minN = MIN_N } = {}) {
  const baseline = {};
  for (const h of horizons) baseline[h] = stats(all.base[h] || []);
  const signals = {};
  for (const [k, def] of Object.entries(SIGNALS)) {
    const row = { dir: def.dir, label: def.label };
    for (const h of horizons) {
      const s = stats(all.events[k]?.[h] || []);
      row[h] = {
        n: s.n, mean: s.mean, median: s.median, hit: def.dir === 'down' ? s.hitDown : s.hitUp,
        excess: s.excess, excessN: s.excessN,
        delta: s.n ? s.mean - baseline[h].mean : null, low: s.n < minN,
      };
    }
    signals[k] = row;
  }
  return { baseline, signals };
}

/**
 * Tüm hisseler için backtest.
 *  series: [{ symbol, bars }] (ham mumlar; bölünmeler burada düzeltilir), bench: endeks mumları
 * Döner: { baseline, signals, params: { horizons, gap, warmup, minN, symbols, skipped, bars, from, to, splitBreaks } }
 */
export function computeBacktest({ series, bench, horizons = HORIZONS, gap = GAP, warmup = WARMUP, minN = MIN_N, minBars = MIN_BARS, signals = null }) {
  const all = { base: Object.fromEntries(horizons.map((h) => [h, []])), events: {} };
  const skipped = [];
  let bars = 0, splitBreaks = 0, from = null, to = null, used = 0;
  for (const { symbol, bars: raw } of series) {
    if (!raw || raw.length < minBars) { skipped.push(symbol); continue; }
    const adj = adjustSplits(raw);
    splitBreaks += adj.breaks.length;
    const obs = symbolObservations(adj.bars, bench, { horizons, gap, warmup, signals });
    for (const h of horizons) all.base[h].push(...obs.base[h]);
    for (const ev of obs.events) for (const h of horizons) if (ev.rets[h]) ((all.events[ev.signal] ||= {})[h] ||= []).push(ev.rets[h]);
    used++;
    bars += adj.bars.length;
    const d0 = day(adj.bars[Math.min(warmup, adj.bars.length - 1)].t), d1 = day(adj.bars.at(-1).t);
    if (!from || d0 < from) from = d0;
    if (!to || d1 > to) to = d1;
  }
  return { ...aggregate(all, { horizons, minN }), params: { horizons, gap, warmup, minN, symbols: used, skipped, bars, from, to, splitBreaks } };
}

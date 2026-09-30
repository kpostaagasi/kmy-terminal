// Teknik göstergeler: kapanış dizisi üzerinde saf fonksiyonlar.

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) continue;
    if (prev == null) {
      prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const ef = ema(values, fast), es = ema(values, slow);
  const line = values.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const firstIdx = line.findIndex((x) => x != null);
  const sig = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const sub = ema(line.slice(firstIdx), signal);
    sub.forEach((v, j) => { sig[firstIdx + j] = v; });
  }
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
  return { line, signal: sig, hist };
}

export function bollinger(values, n = 20, k = 2) {
  const mid = sma(values, n);
  const upper = [], lower = [];
  for (let i = 0; i < values.length; i++) {
    if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
    const w = values.slice(i - n + 1, i + 1);
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mid[i]) ** 2, 0) / n);
    upper.push(mid[i] + k * sd); lower.push(mid[i] - k * sd);
  }
  return { mid, upper, lower };
}

// Ortalama gerçek aralık — Wilder yumuşatması (RMA)
export function atr(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  const tr = bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
  if (tr.length < n) return out;
  let prev = tr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < tr.length; i++) { prev = (prev * (n - 1) + tr[i]) / n; out[i] = prev; }
  return out;
}

// Yıllıklandırma faktörü: sabit 252 yerine serinin kendi takviminden türetilir.
// BIST hisseleri ~252, kripto/fon 365 gün işler; ikisi birlikteyse takvim birleşimi kullanılır.
export function annualization(points, days) {
  if (!(points > 1) || !(days > 0)) return 365;
  return Math.min(365, Math.max(60, (points - 1) / (days / 365)));
}

// Göreli yuvarlama: 6 anlamlı basamak. Mutlak 2 ondalık TEFAS fonlarını bozuyordu
// (birim fiyat 0,072083 → 0,07 = %2,9 hata). 4 basamak da yetersiz: 83.147,6 → 83.150.
export const sig6 = (x) => (x == null || !Number.isFinite(x) ? null : parseFloat(Number(x).toPrecision(6)));


const last = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };

// Ajan ve arayüz için özet teknik görünüm
export function technicalSummary(bars) {
  const c = bars.map((b) => b.c);
  if (c.length < 30) return { error: 'Yeterli veri yok' };
  const price = c[c.length - 1];
  const s20 = last(sma(c, 20)), s50 = last(sma(c, 50)), s200 = last(sma(c, 200));
  const r = last(rsi(c, 14));
  const m = macd(c);
  const bb = bollinger(c);
  const a = last(atr(bars, 14));
  const ret = (days) => (c.length > days ? (price / c[c.length - 1 - days] - 1) * 100 : null);
  const dailyRets = c.slice(1).map((v, i) => Math.log(v / c[i]));
  const recent = dailyRets.slice(-60);
  const mean = recent.reduce((x, y) => x + y, 0) / recent.length;
  const spanDays = (bars[bars.length - 1].t - bars[0].t) / 864e5;
  const vol = Math.sqrt(recent.reduce((x, y) => x + (y - mean) ** 2, 0) / (recent.length - 1)) * Math.sqrt(annualization(c.length, spanDays)) * 100;
  // 52 hafta: gün içi en yüksek / en düşük (son 252 işlem günü)
  const win = bars.slice(-252);
  const hi = Math.max(...win.map((b) => b.h ?? b.c)), lo = Math.min(...win.map((b) => b.l ?? b.c));
  const signals = [];
  if (s50 && s200) signals.push(s50 > s200 ? 'SMA50 > SMA200 (uzun vadeli yükseliş eğilimi)' : 'SMA50 < SMA200 (uzun vadeli düşüş eğilimi)');
  if (s20) signals.push(price > s20 ? 'Fiyat SMA20 üzerinde' : 'Fiyat SMA20 altında');
  if (r != null) signals.push(r > 70 ? `RSI ${r.toFixed(0)}: aşırı alım bölgesi` : r < 30 ? `RSI ${r.toFixed(0)}: aşırı satım bölgesi` : `RSI ${r.toFixed(0)}: nötr`);
  const mh = last(m.hist);
  if (mh != null) signals.push(mh > 0 ? 'MACD sinyal çizgisinin üzerinde (pozitif momentum)' : 'MACD sinyal çizgisinin altında (negatif momentum)');
  const bu = last(bb.upper), bl = last(bb.lower);
  if (bu && price > bu) signals.push('Fiyat üst Bollinger bandının üzerinde');
  if (bl && price < bl) signals.push('Fiyat alt Bollinger bandının altında');
  const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
  // Fiyat ve fiyattan türeyen değerler göreli yuvarlanır (TEFAS fonu 0,072083 mutlak 2 ondalıkta %2,9 bozulurdu);
  // oran ve yüzde değerleri mutlak ondalık kalır (RSI 55,4324 · MACD 0,000123)
  return {
    price: sig6(price), sma20: sig6(s20), sma50: sig6(s50), sma200: sig6(s200), rsi14: round(r, 1),
    macd: round(last(m.line), 3), macdSignal: round(last(m.signal), 3), macdHist: round(mh, 3),
    bollingerUpper: sig6(bu), bollingerLower: sig6(bl), atr14: sig6(a),
    return1w: round(ret(5)), return1m: round(ret(21)), return3m: round(ret(63)), return1y: round(ret(252)),
    volatility60dAnnualPct: round(vol), high52w: sig6(hi), low52w: sig6(lo),
    distFromHigh52wPct: round((price / hi - 1) * 100), signals,
  };
}

export function indicatorSeries(bars) {
  const c = bars.map((b) => b.c);
  const m = macd(c);
  return { sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200), rsi14: rsi(c, 14), macd: m.line, macdSignal: m.signal, macdHist: m.hist, ...(() => { const b = bollinger(c); return { bbUpper: b.upper, bbLower: b.lower }; })() };
}

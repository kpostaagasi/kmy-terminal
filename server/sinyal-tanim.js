// Sinyal tanımları: radar (son mum), sinyal bildirimi ve backtest (her mum) AYNI kuralları kullanır. Saf (veritabanı ve ağ yok).
// Göstergeler nedenseldir: i. mumdaki değer yalnız ≤ i verisini kullanır (ileriye bakma yok).
import { sma, rsi, macd } from './indicators.js';
import { adjustSplits, validBars } from './seri.js';

export const SIGNALS = {
  rsi_os: { label: 'RSI aşırı satım (<30)', dir: 'up' },
  rsi_ob: { label: 'RSI aşırı alım (>70)', dir: 'down' },
  golden: { label: 'Altın kesişim (SMA50↑SMA200)', dir: 'up' },
  death: { label: 'Ölüm kesişimi (SMA50↓SMA200)', dir: 'down' },
  high52: { label: '52 hafta zirvesi', dir: 'up' },
  low52: { label: '52 hafta dibi', dir: 'down' },
  vol: { label: 'Hacim patlaması (>2× ort.)', dir: 'neutral' },
  sma200_up: { label: 'SMA200 yukarı kırılım', dir: 'up' },
  sma200_dn: { label: 'SMA200 aşağı kırılım', dir: 'down' },
  macd_up: { label: 'MACD al kesişimi', dir: 'up' },
  macd_dn: { label: 'MACD sat kesişimi', dir: 'down' },
};

const crossedUp = (a, b, i) => a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i] > b[i] && a[i - 1] <= b[i - 1];
const crossedDn = (a, b, i) => a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i] < b[i] && a[i - 1] >= b[i - 1];
// Son n mum içindeki en yeni kesişimin yönü: 'up' | 'dn' | null
function lastCross(a, b, n, last) {
  for (let i = last; i > last - n && i > 0; i--) {
    if (crossedUp(a, b, i)) return 'up';
    if (crossedDn(a, b, i)) return 'dn';
  }
  return null;
}

/** Göstergeleri bir kez hesaplar; `signalsAt` her mum için bunu kullanır. */
export function signalSeries(bars) {
  const c = bars.map((b) => b.c), v = bars.map((b) => b.v || 0);
  return { c, v, s50: sma(c, 50), s200: sma(c, 200), r: rsi(c, 14), m: macd(c) };
}

/** i. mumdan önceki 20 mumun ortalama hacmi (hacim patlaması ölçütü). */
export const volAvg = (S, i) => S.v.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) / 20;

/** i. mum için sinyal anahtarları (yalnız ≤ i verisi). */
export function signalsAt(S, i) {
  const { c, v, s50, s200, r, m } = S;
  const out = [];
  if (r[i] != null && r[i] < 30) out.push('rsi_os');
  if (r[i] != null && r[i] > 70) out.push('rsi_ob');
  const ma = lastCross(s50, s200, 5, i);
  if (ma) out.push(ma === 'up' ? 'golden' : 'death');
  const win = c.slice(Math.max(0, i - 251), i + 1);
  if (c[i] >= Math.max(...win) * 0.995) out.push('high52');
  if (c[i] <= Math.min(...win) * 1.005) out.push('low52');
  const avg20 = volAvg(S, i);
  if (avg20 > 0 && v[i] > 2 * avg20) out.push('vol');
  const px = lastCross(c, s200, 3, i);
  if (px) out.push(px === 'up' ? 'sma200_up' : 'sma200_dn');
  const mc = lastCross(m.line, m.signal, 2, i);
  if (mc) out.push(mc === 'up' ? 'macd_up' : 'macd_dn');
  return out;
}

/** Radar için son mumun özeti. Bölünme/birleşme günleri önce düzeltilir (bkz. seri.js). */
export function scanBars(bars) {
  if (bars.length < 60) return null;
  const S = signalSeries(adjustSplits(validBars(bars)).bars);
  const L = S.c.length - 1;
  const avg20 = volAvg(S, L);
  return { price: S.c[L], changePct: (S.c[L] / S.c[L - 1] - 1) * 100, rsi: S.r[L], volRatio: avg20 ? S.v[L] / avg20 : null, signals: signalsAt(S, L) };
}

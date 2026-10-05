// Fiyat serisi düzeltmeleri. Saf (veritabanı ve ağ yok).

/**
 * BIST'te bedelsiz sermaye artırımı ve bölünmeler ham seriye düzeltilmeden girer: Yahoo'nun `adjclose` alanı BIST için ham
 * kapanışla aynıdır ve `events=splits` olayları güvenilmez. Günlük fiyat sınırı (±%10, geçmişte ±%20) gerçek bir tek gün
 * hareketini bu eşiklerin çok altında tutar; bu yüzden eşiğin ötesindeki bir gün bölünme/birleşme sayılır.
 *
 * Ardışık kapanış oranı `c[i]/c[i−1]` < 1 + down ya da > 1 + up ise i. gün bir kırılmadır; i'den ÖNCEKİ tüm mumların
 * o, h, l, c değerleri bu oranla çarpılır (kırılma noktasında oran 1 olur), hacim aynı oranla bölünür. Birden çok kırılma
 * sondan başa birikir. Girdi değiştirilmez. Kapanışı sayı olmayan ya da ≤ 0 olan mum kırılma hesabına katılmaz
 * (bir sonraki geçerli mum önceki geçerli kapanışla kıyaslanır).
 * Döner: { bars, breaks: [{ index, date, ratio }] }
 */
export function adjustSplits(bars, { down = -0.25, up = 0.30 } = {}) {
  const out = bars.map((b) => ({ ...b }));
  const lo = 1 + down, hi = 1 + up;
  const ratios = new Array(out.length).fill(1);
  const breaks = [];
  let prev = null;
  for (let i = 0; i < out.length; i++) {
    const c = out[i].c;
    if (!(Number.isFinite(c) && c > 0)) continue;
    if (prev != null) {
      const r = c / prev;
      if (r < lo || r > hi) {
        ratios[i] = r;
        breaks.push({ index: i, date: Number.isFinite(out[i].t) ? new Date(out[i].t).toISOString().slice(0, 10) : null, ratio: r });
      }
    }
    prev = c;
  }
  let f = 1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (f !== 1) {
      const b = out[i];
      for (const k of ['o', 'h', 'l', 'c']) if (Number.isFinite(b[k])) b[k] *= f;
      if (Number.isFinite(b.v)) b.v /= f;
    }
    if (ratios[i] !== 1) f *= ratios[i];
  }
  return { bars: out, breaks };
}

// Kurum hedef fiyatı: pozisyon başına özet ve portföy toplamı. Saf mantık (veritabanı ve ağ yok).
// Satırlar research.js'in `analyst_targets` tablosundan gelir.

export const MAX_AGE_DAYS = 180;

const sayi = Number.isFinite;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const dayOf = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);

/**
 * Bir sembolün hedef satırlarından özet üretir. Sayılmayan görüşler:
 *  - kurumun en yeni görüşü 180 günden eskiyse (daha eski satıra düşülmez),
 *  - rapordan sonra bedelsiz sermaye artırımı olduysa (fiyat ölçeği değişti),
 *  - rapor tarihi okunamıyorsa.
 * Hedefi olmayan (yalnız önerisi olan) kurum medyana girmez, öneri sayısına girer.
 * Hiç görüş kalmazsa null.
 */
export function pickTarget(rows, { price = null, now = Date.now(), actions = [] } = {}) {
  const latest = new Map();
  for (const r of rows) {
    const d = dayOf(r.report_date);
    if (!sayi(d)) continue;
    const cur = latest.get(r.broker);
    if (!cur || d > cur.d) latest.set(r.broker, { ...r, d });
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const bonus = actions.filter((a) => a.bonusPct > 0 || a.bonusDivPct > 0).map((a) => String(a.date).slice(0, 10));
  const kept = [...latest.values()].filter((r) => {
    const age = Math.floor((dayOf(today) - r.d) / 86400_000);
    if (age > MAX_AGE_DAYS) return false;
    const rep = new Date(r.d).toISOString().slice(0, 10);
    return !bonus.some((b) => b > rep && b <= today);
  });
  if (!kept.length) return null;
  const tg = kept.filter((r) => sayi(r.target));
  const rating = (r) => String(r.rating || '').toUpperCase();
  const med = tg.length ? median(tg.map((r) => r.target)) : null;
  return {
    brokers: kept.length, withTarget: tg.length, median: med,
    al: kept.filter((r) => rating(r) === 'AL' || rating(r) === 'ALDIR').length,
    tut: kept.filter((r) => rating(r) === 'TUT').length,
    sat: kept.filter((r) => rating(r) === 'SAT').length,
    newest: kept.map((r) => new Date(r.d).toISOString().slice(0, 10)).sort().at(-1),
    upsidePct: med != null && sayi(price) && price > 0 ? (med / price - 1) * 100 : null,
  };
}

/**
 * Portföy toplamı. `target` anahtarı olmayan pozisyon kapsam dışıdır (fon, altın, yabancı);
 * `target: null` uygun ama veri yok demektir. Ağırlıklı getiri yalnız kapsamdakilerin değeriyle ağırlıklanır.
 */
export function targetTotals(holdings) {
  const eligible = holdings.filter((h) => h.target !== undefined && sayi(h.value));
  const covered = eligible.filter((h) => h.target && sayi(h.target.upsidePct));
  const eligSum = eligible.reduce((a, h) => a + h.value, 0);
  const covSum = covered.reduce((a, h) => a + h.value, 0);
  return {
    n: covered.length, of: eligible.length,
    valuePct: eligSum > 0 ? (covSum / eligSum) * 100 : null,
    weightedUpsidePct: covSum > 0 ? covered.reduce((a, h) => a + h.value * h.target.upsidePct, 0) / covSum : null,
  };
}

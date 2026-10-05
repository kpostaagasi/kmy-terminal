// Hedef ağırlığa göre dengeleme: saf hesap (veritabanı ve ağ yok). Emir göndermez, yalnız öneri hesaplar.
// Girdi hedefleri: classTargets { asset_type | 'cash': yüzde (portföyün)}, symbolTargets { SEMBOL: { cls, pct } } (pct = sınıf içindeki pay, yüzde).

export const CLASS_KEYS = ['stock', 'etf', 'fund', 'gold', 'commodity', 'fx', 'crypto', 'bond', 'other', 'cash'];
const INTEGER_TYPES = new Set(['stock', 'etf']); // BIST hisse/ETF tam adet; diğerleri kesirli
const EPS = 1e-9;
const THRESHOLD = 1; // puan: altındaki sapma için işlem önerilmez (E = 0 modunda)
const isPct = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r2 = (x) => Math.round(x * 100) / 100;
const f4 = (x) => Math.floor(x * 1e4 + EPS) / 1e4; // adet aşağı yuvarlanır: satışta elde olandan, alımda istenen tutardan fazlası çıkmasın
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.^=-]{0,19}$/;
const isObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);

/** Hedef girişini doğrular. Döner: { ok, errors: string[] } */
export function validateTargets({ classTargets = {}, symbolTargets = {}, cashTracking = false } = {}) {
  const errors = [];
  if (!isObj(classTargets)) return { ok: false, errors: ['classTargets bir nesne olmalı'] };
  if (!isObj(symbolTargets)) return { ok: false, errors: ['symbolTargets bir nesne olmalı'] };
  let sum = 0;
  for (const [k, v] of Object.entries(classTargets)) {
    if (!CLASS_KEYS.includes(k)) errors.push(`Bilinmeyen sınıf: ${k}`);
    else if (k === 'cash' && !cashTracking) errors.push('Nakit hedefi için nakit takibi açık olmalı (önce bir nakit girişi kaydedin)');
    if (!isPct(v)) errors.push(`${k}: hedef 0–100 arasında bir sayı olmalı`); else sum += v;
  }
  if (sum > 100 + EPS) errors.push(`Sınıf hedefleri toplamı %100'ü aşamaz (şu an %${r2(sum)})`);
  const perClass = {}, seen = new Set();
  for (const [s, e] of Object.entries(symbolTargets)) {
    const key = s.toUpperCase();
    if (!SYMBOL_RE.test(key)) { errors.push(`Geçersiz sembol: ${s}`); continue; }
    if (seen.has(key)) { errors.push(`Aynı sembol iki kez: ${key}`); continue; }
    seen.add(key);
    if (!e || typeof e !== 'object' || !CLASS_KEYS.includes(e.cls) || e.cls === 'cash') { errors.push(`${s}: geçerli bir sınıf gerekli`); continue; }
    if (!isPct(e.pct)) { errors.push(`${s}: pay 0–100 arasında bir sayı olmalı`); continue; }
    perClass[e.cls] = (perClass[e.cls] || 0) + e.pct;
  }
  for (const [c, v] of Object.entries(perClass)) if (v > 100 + EPS) errors.push(`${c}: sembol payları toplamı %100'ü aşamaz (şu an %${r2(v)})`);
  return { ok: errors.length === 0, errors };
}

/**
 * Dengeleme planı.
 *  holdings: [{ symbol, asset_type, value, price, qty, missingFx, sellTax, sellTaxable }]
 *  totalValue: portföy toplamı (nakit takibi açıksa nakit dahil), cash: nakit TL (takip kapalıysa null)
 *  fresh: { SEMBOL: { price } } portföyde olmayan hedef sembollerinin fiyatı
 *  extra: ek nakit (TL, ≥ 0). 0 → al/sat; > 0 → yalnız alım
 * Döner: { rows, summary, warnings }
 */
export function plan({ holdings = [], totalValue, cash = null, cashTracking = false, fresh = {}, classTargets = {}, symbolTargets = {}, extra = 0 } = {}) {
  const warnings = [];
  const v = validateTargets({ classTargets, symbolTargets, cashTracking });
  if (!v.ok) throw new Error(v.errors.join('; '));
  if (!(Number.isFinite(extra) && extra >= 0)) throw new Error('Ek nakit 0 veya pozitif olmalı');
  const V = Number(totalValue);
  const mode = extra > 0 ? 'ekNakit' : 'sabit';
  const targetSum = Object.values(classTargets).reduce((a, b) => a + b, 0);
  const summary = { mode, value: V, extra, netCash: 0, rounding: 0, targetSum: r2(targetSum), unassignedPct: r2(100 - targetSum) };
  const rows = [];
  if (!(V > 0)) { warnings.push('Portföy değeri sıfır; öneri üretilemez'); return { rows, summary, warnings }; }
  const Vp = V + extra;
  const held = new Map(holdings.map((h) => [h.symbol, h]));

  // Etkin sembol hedefleri (portföyün yüzdesi)
  const items = []; // { symbol, cls, held, targetPct }
  for (const [cls, ct] of Object.entries(classTargets)) {
    if (cls === 'cash') continue;
    const members = holdings.filter((h) => h.asset_type === cls).map((h) => ({ symbol: h.symbol, share: symbolTargets[h.symbol]?.cls === cls ? symbolTargets[h.symbol].pct : null, value: h.value || 0, held: true }));
    for (const [s, e] of Object.entries(symbolTargets)) if (e.cls === cls && !held.has(s)) members.push({ symbol: s, share: e.pct, value: 0, held: false });
    const exp = members.filter((m) => m.share != null);
    const unt = members.filter((m) => m.share == null);
    const R = 100 - exp.reduce((a, m) => a + m.share, 0);
    if (!members.length) { rows.push({ key: cls, kind: 'class', class: cls, currentPct: 0, targetPct: ct, deviation: -ct, action: 'atlandi', tl: 0, qty: null, price: null, taxEst: 0, reason: 'Sınıfta sembol yok; sembol payı girin' }); continue; }
    if (unt.length) {
      const sv = unt.reduce((a, m) => a + m.value, 0);
      for (const m of unt) m.share = R * (sv > 0 ? m.value / sv : 1 / unt.length);
    } else if (R > EPS) warnings.push(`${cls}: sınıf içinde %${r2(R)} pay dağıtılmadı (hedefsiz bırakıldı)`);
    for (const m of members) items.push({ symbol: m.symbol, cls, held: m.held, targetPct: (ct * m.share) / 100 });
  }
  for (const [s, e] of Object.entries(symbolTargets)) if (!(e.cls in classTargets)) warnings.push(`${s}: ${e.cls} sınıfı hedefsiz olduğundan sembol payı yok sayıldı`);
  for (const [s, e] of Object.entries(symbolTargets)) { const h = held.get(s); if (h && h.asset_type !== e.cls) warnings.push(`${s}: portföyde ${h.asset_type} olarak tutuluyor; ${e.cls} sınıfındaki payı yok sayıldı`); }

  const lines = []; // hesaplanabilir satırlar
  for (const it of items) {
    const h = held.get(it.symbol);
    // value TL'dir, h.price ise varlığın kendi para birimindedir (USD hissede farklı): adet TL birim fiyatıyla (value/qty) hesaplanır
    const price = h ? (h.qty > 0 && h.value != null ? h.value / h.qty : h.price) : fresh[it.symbol]?.price;
    const value = h ? h.value : 0;
    const base = { key: it.symbol, kind: 'symbol', class: it.cls, targetPct: r4(it.targetPct), price: price ?? null, qty: null, tl: 0, taxEst: 0 };
    if (value == null || h?.missingFx || h?.priced === false || !(price > 0)) { rows.push({ ...base, currentPct: value == null ? null : r4((value / V) * 100), deviation: null, action: 'atlandi', reason: h?.missingFx ? 'Kur bulunamadı' : h?.priced === false ? 'Güncel fiyat yok' : 'Fiyat yok' }); continue; }
    const currentPct = (value / V) * 100;
    lines.push({ ...base, h, price, value, currentPct: r4(currentPct), deviation: r4(currentPct - it.targetPct), delta: (it.targetPct / 100) * V - value });
  }

  // Hedef TL (işaretli): al > 0, sat < 0
  let want = new Map();
  if (mode === 'sabit') {
    for (const l of lines) want.set(l.key, Math.abs(l.deviation) < THRESHOLD ? 0 : l.delta);
  } else {
    const short = lines.map((l) => [l.key, Math.max(0, (l.targetPct / 100) * Vp - l.value)]);
    const S = short.reduce((a, [, x]) => a + x, 0);
    const k = S > extra ? extra / S : 1;
    for (const [key, x] of short) want.set(key, x * k);
    const alloc = short.reduce((a, [, x]) => a + x * k, 0);
    if (extra - alloc > 0.005) warnings.push(`Ek nakitten ${r2(extra - alloc)} TL dağıtılmadı; nakit olarak kalır`);
  }

  let buys = 0, sellsNet = 0, planned = 0, effective = 0;
  for (const l of lines) {
    const w = want.get(l.key) || 0;
    const out = { key: l.key, kind: 'symbol', class: l.class, currentPct: l.currentPct, targetPct: l.targetPct, deviation: l.deviation, price: l.price, qty: null, tl: 0, taxEst: 0, action: 'yok', reason: null };
    if (Math.abs(w) < 0.005) { out.reason = mode === 'sabit' ? 'İşlem gerekmez' : (w === 0 && l.deviation > 0 ? 'Satış önerilmez (ek nakit modu)' : 'İşlem gerekmez'); rows.push(out); continue; }
    const int = INTEGER_TYPES.has(l.class);
    let qty = Math.abs(w) / l.price;
    if (w < 0) qty = Math.min(qty, l.h.qty);
    qty = int ? Math.floor(qty + EPS) : f4(qty);
    planned += Math.abs(w);
    if (!(qty > 0)) { out.reason = 'Tutar bir adetten az'; rows.push(out); continue; }
    const tl = r2(qty * l.price);
    effective += tl;
    out.qty = qty; out.tl = tl;
    if (w > 0) { out.action = 'al'; buys += tl; }
    else {
      out.action = 'sat';
      out.taxEst = l.h.sellTaxable && l.h.qty > 0 && l.h.sellTax > 0 ? r2((l.h.sellTax * qty) / l.h.qty) : 0;
      sellsNet += tl - out.taxEst;
    }
    rows.push(out);
  }

  const skipped = rows.filter((r) => r.action === 'atlandi').length;
  summary.netCash = r2(sellsNet - buys);
  summary.rounding = r2(Math.max(0, planned - effective));
  if (skipped) warnings.push(`${skipped} satır atlandı; net nakit değişimi eksik`);
  if (mode === 'sabit' && cashTracking && cash != null && summary.netCash < -cash - 0.005) warnings.push('Net alım mevcut nakitten büyük; nakit yetmeyebilir');
  if (cashTracking && 'cash' in classTargets) {
    const cp = ((cash ?? 0) / V) * 100;
    rows.push({ key: 'cash', kind: 'class', class: 'cash', currentPct: r4(cp), targetPct: classTargets.cash, deviation: r4(cp - classTargets.cash), action: 'yok', tl: 0, qty: null, price: null, taxEst: 0, reason: 'Nakit sınıfı yalnız bilgi' });
  }
  return { rows, summary, warnings };
}

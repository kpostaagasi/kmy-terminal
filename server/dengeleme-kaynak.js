// Dengeleme: hedeflerin kalıcılığı ve plan için portföy/fiyat toplama. Hesap kuralları dengeleme.js'tedir (saf).
import { db, tx } from './db.js';
import * as pf from './portfolio.js';
import { getQuotes } from './market.js';
import { plan, validateTargets } from './dengeleme.js';

db.exec("CREATE TABLE IF NOT EXISTS rebalance_targets (kind TEXT NOT NULL CHECK (kind IN ('class','symbol')), key TEXT NOT NULL, pct REAL NOT NULL, cls TEXT, PRIMARY KEY (kind, key))");

/** Kayıtlı hedefler: { classTargets: { sınıf: %}, symbolTargets: { SEMBOL: { cls, pct } } } */
export function getTargets() {
  const out = { classTargets: {}, symbolTargets: {} };
  for (const r of db.prepare('SELECT kind, key, pct, cls FROM rebalance_targets').all()) {
    if (r.kind === 'class') out.classTargets[r.key] = Number(r.pct);
    else out.symbolTargets[r.key] = { cls: r.cls, pct: Number(r.pct) };
  }
  return out;
}

/** Hedefleri doğrulayıp bütün olarak değiştirir (kısmi kayıt yok). Geçersizse hata fırlatır. */
export function setTargets({ classTargets = {}, symbolTargets = {} } = {}, { cashTracking = false } = {}) {
  const v = validateTargets({ classTargets, symbolTargets, cashTracking });
  if (!v.ok) throw new Error(v.errors.join('; '));
  tx(() => {
    db.exec('DELETE FROM rebalance_targets');
    const ins = db.prepare('INSERT INTO rebalance_targets(kind, key, pct, cls) VALUES(?, ?, ?, ?)');
    for (const [k, pct] of Object.entries(classTargets)) ins.run('class', k, pct, null);
    for (const [s, e] of Object.entries(symbolTargets)) ins.run('symbol', String(s).toUpperCase(), e.pct, e.cls);
  });
  return getTargets();
}

/** API girişi: nakit takibi açık mı bakıp doğrular ve kaydeder. */
export async function saveTargets(t) {
  // Gövde ve iki alan da düz nesne olmalı: null/dizi/{} sessizce tüm hedefleri silmesin (bilinçli silme: iki boş nesne)
  const plainObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
  if (!plainObj(t) || !plainObj(t.classTargets) || !plainObj(t.symbolTargets)) throw new Error('Gövde classTargets ve symbolTargets nesnelerini içermeli');
  const s = await pf.summary();
  return setTargets(t, { cashTracking: s.totals.cash != null });
}

/** Mevcut portföy ve hedeflerle plan. extra: ek nakit TL (0 = al/sat). */
export async function compute({ extra = 0 } = {}) {
  const s = await pf.summary();
  const targets = getTargets();
  const cashTracking = s.totals.cash != null;
  const extraWarnings = [];
  if (!cashTracking && 'cash' in targets.classTargets) { // nakit takibi sonradan kapandı (nakit girişi silindi/sıfırlandı): sekme kilitlenmesin
    delete targets.classTargets.cash;
    extraWarnings.push('Nakit takibi kapalı olduğundan nakit hedefi yok sayıldı');
  }
  const held = new Set(s.holdings.map((h) => h.symbol));
  const need = Object.keys(targets.symbolTargets).filter((x) => !held.has(x));
  const fresh = {};
  if (need.length) {
    const qs = await getQuotes(need).catch(() => ({}));
    for (const x of need) { // fiyat yerel para biriminde gelir; plan TL ister (kur yoksa satır "Fiyat yok" olarak atlanır)
      const cur = qs[x]?.currency || 'TRY', rate = cur === 'TRY' ? 1 : s.fx?.[cur];
      if (qs[x]?.price > 0 && rate > 0) fresh[x] = { price: qs[x].price * rate };
    }
  }
  const result = plan({ holdings: s.holdings, totalValue: s.totals.value, cash: s.totals.cash, cashTracking, fresh, ...targets, extra });
  return {
    ...result, warnings: [...extraWarnings, ...result.warnings], targets, asOf: s.asOf, cashTracking,
    holdings: s.holdings.map((h) => ({ symbol: h.symbol, name: h.name, asset_type: h.asset_type, assetLabel: h.assetLabel, value: h.value, weight: h.weight, priceSource: h.priceSource, priceTime: h.priceTime })),
    classLabels: pf.ASSET_TYPES,
  };
}

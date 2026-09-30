// Portföy motoru: işlemlerden pozisyon, nakit, K/Z, temettü, dağılım ve risk metrikleri üretir.
// Tüm tutarlar TRY bazında hesaplanır; her işlem kendi para birimi ve işlem günündeki TRY kuruyla (fx_rate) saklanır.
//
// Toplam K/Z ayrışımı (nakit takibi açıkken):
//   Toplam değer − Net yatırılan = Açık poz. K/Z + Gerçekleşen K/Z + Temettü + Faiz − Masraf + Kur farkı (gerçekleşen + açık)
import { db, tx, getSettings } from './db.js';
import { getQuotes, getHistory, getDividends, normalize, sectorOf, currencyOf, SPECIAL, priceOnDate, isBist } from './market.js';
import { annualization } from './indicators.js';
import * as universe from './universe.js';
import { tcmbRates, tlrefStats, tlrefIndex } from './feeds.js';

// qty: miktar etkisi · cash: nakit etkisi · income: gelir niteliği
export const TX_META = {
  DEPOSIT: { label: 'Nakit girişi', qty: 0, cash: +1, needs: ['amount'] },
  BUY: { label: 'Alış', qty: +1, cash: -1, needs: ['symbol', 'quantity', 'price'] },
  SELL: { label: 'Satış', qty: -1, cash: +1, needs: ['symbol', 'quantity', 'price'] },
  DRIP: { label: 'Temettü yeniden yatırım (DRIP)', qty: +1, cash: 0, income: true, needs: ['symbol', 'quantity', 'price'] },
  DIVIDEND: { label: 'Nakit temettü', qty: 0, cash: +1, income: true, needs: ['symbol', 'amount'] },
  WITHDRAW: { label: 'Nakit çıkışı', qty: 0, cash: -1, needs: ['amount'] },
  TRANSFER: { label: 'Transfer (platformlar arası)', qty: 0, cash: 0, needs: ['to_platform'] },
  STAKING: { label: 'Kripto staking ödülü', qty: +1, cash: 0, income: true, needs: ['symbol', 'quantity'] },
  INTEREST: { label: 'Faiz geliri', qty: 0, cash: +1, income: true, needs: ['amount'] },
  FREE: { label: 'Maliyetsiz edinim (hediye/bedelsiz adet)', qty: +1, cash: 0, needs: ['symbol', 'quantity'] },
  SPLIT: { label: 'Bölünme / bedelsiz (oran)', qty: +1, cash: 0, needs: ['symbol', 'ratio'] },
  FEE: { label: 'Komisyon / masraf', qty: 0, cash: -1, needs: ['amount'] },
  FX_CONVERT: { label: 'Döviz çevrimi', qty: 0, cash: 0, needs: ['amount', 'to_currency', 'to_amount'] },
};
export const TX_TYPES = Object.fromEntries(Object.entries(TX_META).map(([k, v]) => [k, v.label]));
const AMOUNT_TYPES = new Set(['DIVIDEND', 'DEPOSIT', 'WITHDRAW', 'FEE', 'INTEREST', 'FX_CONVERT']);

export const ASSET_TYPES = {
  stock: 'Hisse', etf: 'ETF', fund: 'Yatırım Fonu', gold: 'Altın', commodity: 'Emtia', fx: 'Döviz', crypto: 'Kripto', bond: 'Tahvil / Mevduat', other: 'Diğer',
};
export const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP', 'CHF', 'JPY'];

// Kıyas serileri: TL bazında
export const BENCHMARKS = {
  XU100: { label: 'BIST 100', parts: ['XU100'] },
  XU030: { label: 'BIST 30', parts: ['XU030'] },
  USDTRY: { label: 'Dolar/TL', parts: ['USDTRY'] },
  EURTRY: { label: 'Euro/TL', parts: ['EURTRY'] },
  GRAM: { label: 'Gram altın', parts: ['GRAM'] },
  SPX_TRY: { label: 'S&P 500 (TL)', parts: ['SPX', 'USDTRY'] },
  BTC_TRY: { label: 'Bitcoin (TL)', parts: ['BTC', 'USDTRY'] },
  TLREF: { label: 'TLREF (mevduat benzeri)', parts: [] },
};

// ── CRUD ───────────────────────────────────────────────────
export function listPlatforms() {
  return db.prepare('SELECT * FROM platforms ORDER BY name').all();
}
export function savePlatform({ id, name, currency = 'TRY', notes = null }) {
  if (!name?.trim()) throw new Error('Platform adı zorunlu');
  if (id) db.prepare('UPDATE platforms SET name = ?, currency = ?, notes = ? WHERE id = ?').run(name.trim(), currency, notes, id);
  else id = Number(db.prepare('INSERT INTO platforms(name, currency, notes) VALUES(?, ?, ?)').run(name.trim(), currency, notes).lastInsertRowid);
  return db.prepare('SELECT * FROM platforms WHERE id = ?').get(id);
}
export function deletePlatform(id) {
  db.prepare('DELETE FROM platforms WHERE id = ?').run(id);
  invalidate();
}
function platformIdByName(name) {
  if (!name) return null;
  const row = db.prepare('SELECT id FROM platforms WHERE name = ? COLLATE NOCASE').get(String(name).trim());
  return row ? row.id : savePlatform({ name }).id;
}

export function listStrategies() {
  return db.prepare('SELECT * FROM strategies ORDER BY name').all();
}
export function saveStrategy({ id, name, description = null }) {
  if (!name?.trim()) throw new Error('Strateji adı zorunlu');
  if (id) db.prepare('UPDATE strategies SET name = ?, description = ? WHERE id = ?').run(name.trim(), description, id);
  else id = Number(db.prepare('INSERT INTO strategies(name, description) VALUES(?, ?)').run(name.trim(), description).lastInsertRowid);
  return db.prepare('SELECT * FROM strategies WHERE id = ?').get(id);
}
export function deleteStrategy(id) {
  db.prepare('DELETE FROM strategies WHERE id = ?').run(id);
}
function strategyIdByName(name) {
  const row = db.prepare('SELECT id FROM strategies WHERE name = ? COLLATE NOCASE').get(String(name).trim());
  return row ? row.id : saveStrategy({ name }).id;
}

const TX_SELECT = `SELECT t.*, p.name AS platform, tp.name AS to_platform, s.name AS strategy FROM transactions t
  LEFT JOIN platforms p ON p.id = t.platform_id LEFT JOIN platforms tp ON tp.id = t.to_platform_id LEFT JOIN strategies s ON s.id = t.strategy_id`;

export function listTransactions({ symbol, type, platformId, strategyId, from, to, limit = 1000, offset = 0 } = {}) {
  const where = [], args = [];
  if (symbol) { where.push('t.symbol = ?'); args.push(normalize(symbol)); }
  if (type) { where.push('t.type = ?'); args.push(type); }
  if (platformId) { where.push('(t.platform_id = ? OR t.to_platform_id = ?)'); args.push(platformId, platformId); }
  if (strategyId) { where.push('t.strategy_id = ?'); args.push(strategyId); }
  if (from) { where.push('t.date >= ?'); args.push(from); }
  if (to) { where.push('t.date <= ?'); args.push(to); }
  const sql = `${TX_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(...args, limit, offset);
}

export function guessAssetType(symbol) {
  if (!symbol) return 'other';
  const sp = SPECIAL[symbol];
  if (sp) return { gold: 'gold', commodity: 'commodity', fx: 'fx', crypto: 'crypto', index: 'other' }[sp.type] || 'other';
  if (symbol.endsWith('.US')) return 'stock';
  if (isBist(symbol) && universe.stock(symbol)) return 'stock';
  if (/^[A-Z]{3}$/.test(symbol)) return 'fund'; // TEFAS fon kodları 3 harflidir
  return 'stock';
}

export function validateTx(t) {
  const type = String(t.type || '').toUpperCase();
  const meta = TX_META[type];
  if (!meta) throw new Error('Geçersiz işlem tipi');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) throw new Error('Tarih YYYY-AA-GG biçiminde olmalı');
  if (t.date > new Date(Date.now() + 86400_000).toISOString().slice(0, 10)) throw new Error('İşlem tarihi gelecekte olamaz');
  const symbol = t.symbol ? normalize(t.symbol) : null;
  const num = (v, d = 0) => (v === '' || v == null ? d : Number(v));
  let quantity = num(t.quantity, AMOUNT_TYPES.has(type) ? 1 : 0);
  const price = num(t.price);
  const fee = num(t.fee);
  const tax = num(t.tax);
  const other_fee = num(t.other_fee);
  if (![quantity, price, fee, tax, other_fee].every(Number.isFinite)) throw new Error('Sayısal alanlar geçersiz');
  if (fee < 0 || tax < 0 || other_fee < 0) throw new Error('Komisyon negatif olamaz');
  if (['BUY', 'SELL', 'DRIP', 'FREE', 'STAKING'].includes(type) && !(quantity > 0)) throw new Error('Miktar pozitif olmalı');
  if (['BUY', 'SELL', 'DRIP'].includes(type) && !(price > 0)) throw new Error('Fiyat pozitif olmalı');
  if (type === 'SPLIT' && !(quantity > 0)) throw new Error('Bölünme oranı pozitif olmalı (ör. 2 = her 1 hisse 2 olur)');
  if (AMOUNT_TYPES.has(type) && !(price > 0)) throw new Error('Tutar pozitif olmalı');
  if (fee < 0) throw new Error('Komisyon negatif olamaz');
  if (AMOUNT_TYPES.has(type)) quantity = 1;
  const currency = (t.currency || (symbol ? currencyOf(symbol) : 'TRY')).toUpperCase();
  const fx_rate = currency === 'TRY' ? 1 : num(t.fx_rate);
  if (!(fx_rate > 0)) throw new Error(`${currency} için işlem günü kuru bulunamadı; kuru elle girin`);
  const asset_type = t.asset_type || guessAssetType(symbol);
  if (!ASSET_TYPES[asset_type]) throw new Error('Geçersiz varlık tipi');
  let platform_id = t.platform_id ? Number(t.platform_id) : null;
  if (!platform_id && t.platform) platform_id = platformIdByName(t.platform);
  let to_platform_id = t.to_platform_id ? Number(t.to_platform_id) : null;
  if (!to_platform_id && t.to_platform) to_platform_id = platformIdByName(t.to_platform);
  let strategy_id = t.strategy_id ? Number(t.strategy_id) : null;
  if (!strategy_id && t.strategy) strategy_id = strategyIdByName(t.strategy);
  let to_currency = null, to_amount = null;
  if (type === 'TRANSFER') {
    if (!to_platform_id) throw new Error('Hedef platform zorunlu');
    if (to_platform_id === platform_id) throw new Error('Kaynak ve hedef platform aynı olamaz');
    if (symbol && !(quantity > 0)) throw new Error('Transfer miktarı pozitif olmalı');
    if (!symbol && !(price > 0)) throw new Error('Nakit transferinde tutar pozitif olmalı');
  }
  if (type === 'FX_CONVERT') {
    to_currency = String(t.to_currency || '').toUpperCase();
    to_amount = num(t.to_amount);
    if (!CURRENCIES.includes(to_currency)) throw new Error('Hedef para birimi geçersiz');
    if (to_currency === currency) throw new Error('Kaynak ve hedef para birimi aynı olamaz');
    if (!(to_amount > 0)) throw new Error('Hedef tutar pozitif olmalı');
  }
  return { date: t.date, platform_id, to_platform_id, symbol, asset_type, type, quantity, price, fee, tax, other_fee, currency, fx_rate, to_currency, to_amount, strategy_id, notes: t.notes || null };
}

// Döviz işlemlerinde kur verilmemişse işlem tarihindeki kapanıştan doldur
// Döviz işlemlerinde kur verilmemişse işlem günündeki TCMB döviz satış kuru; yoksa piyasa kapanışı
export async function fillFx(t) {
  const c = (t.currency || (t.symbol ? currencyOf(t.symbol) : 'TRY')).toUpperCase();
  if (c !== 'TRY' && !(Number(t.fx_rate) > 0)) {
    const tc = await tcmbRates(t.date).catch(() => null);
    const r = tc?.rates?.[c]?.forexSelling;
    if (r > 0) { t.fx_rate = r; t.fx_source = `TCMB ${tc.date}`; }
    else {
      const pair = `${c}TRY`;
      const rate = SPECIAL[pair] ? await priceOnDate(pair, t.date) : null;
      if (rate) t.fx_rate = rate;
    }
  }
  return t;
}

const INSERT_COLS = ['date', 'platform_id', 'to_platform_id', 'symbol', 'asset_type', 'type', 'quantity', 'price', 'fee', 'tax', 'other_fee', 'currency', 'fx_rate', 'to_currency', 'to_amount', 'strategy_id', 'notes'];

export async function addTransaction(t) {
  const v = validateTx(await fillFx({ ...t }));
  const id = Number(db.prepare(`INSERT INTO transactions(${INSERT_COLS.join(',')}) VALUES(${INSERT_COLS.map(() => '?').join(',')})`).run(...INSERT_COLS.map((k) => v[k])).lastInsertRowid);
  invalidate();
  return db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id);
}

export async function updateTransaction(id, t) {
  const v = validateTx(await fillFx({ ...t }));
  db.prepare(`UPDATE transactions SET ${INSERT_COLS.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...INSERT_COLS.map((k) => v[k]), id);
  invalidate();
  return db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id);
}

export function deleteTransaction(id) {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  invalidate();
}

export function resetPortfolio() {
  tx(() => {
    db.exec('DELETE FROM transactions; DELETE FROM snapshots; DELETE FROM platforms; DELETE FROM strategies;');
  });
  invalidate();
}

// Canlı fiyatı olmayan varlıklar (TEFAS fonu, mevduat vb.) için elle fiyat
export function setManualPrice(symbol, price, date = null) {
  const s = normalize(symbol);
  if (!s) throw new Error('Sembol zorunlu');
  if (price == null || price === '') {
    db.prepare('UPDATE symbols SET manual_price = NULL, manual_price_at = NULL WHERE symbol = ?').run(s);
  } else {
    if (!(Number(price) > 0)) throw new Error('Fiyat pozitif olmalı');
    db.prepare(`INSERT INTO symbols(symbol, manual_price, manual_price_at) VALUES(?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET manual_price = excluded.manual_price, manual_price_at = excluded.manual_price_at`).run(s, Number(price), date || new Date().toISOString().slice(0, 10));
  }
  invalidate();
  return db.prepare('SELECT symbol, manual_price, manual_price_at FROM symbols WHERE symbol = ?').get(s);
}

// ── Defter (ledger): pozisyonlar + nakit ───────────────────
function allTx() {
  return db.prepare(`${TX_SELECT} ORDER BY t.date, t.id`).all();
}

// Bölünme yalnız ilgili platformdaki pozisyonlara uygulanır; platform boşsa sembolün tamamına.
// Defter (pozisyonlar) ve tarihsel seri (sembol|platform kovaları) aynı kuralı kullanmalı.
export const splitAppliesTo = (splitTx, platform) => !splitTx.platform || splitTx.platform === platform;

export function computeLedger(txs = allTx()) {
  const pos = new Map();   // sembol|platform
  const cash = new Map();  // platform|para birimi → { amount, cost (TRY) }
  const T = { realized: 0, dividends: 0, interest: 0, staking: 0, fees: 0, commissions: 0, tax: 0, otherFee: 0, dividendTax: 0, deposits: 0, withdrawals: 0, bought: 0, sold: 0, fxRealized: 0 };
  const realizedBySym = {}, dividendsBySym = {};
  const warnings = [];
  const audit = []; // yapısal boşluklar: sessizce yanlış değer üreten durumlar. Arayüzde "bölüm başlığı" olarak gösterilir.
  const flows = []; // yatırımcı nakit akışları (XIRR ve TWR için): { date, amount (TRY, yatırıma giren +) }
  const splits = []; // bölünme anında birden çok platformda pozisyonu olan SPLIT kayıtları

  const getPos = (sym, plat, t) => {
    const k = `${sym}|${plat}`;
    if (!pos.has(k)) pos.set(k, { symbol: sym, platform: plat, asset_type: t.asset_type, currency: t.currency, qty: 0, cost: 0, costNative: 0, lastPrice: 0, firstDate: t.date });
    return pos.get(k);
  };
  // İmzalı nakit akışı; yabancı parada çıkış ortalama maliyetten düşülür, fark gerçekleşen kur farkıdır
  const cashFlow = (plat, cur, amt, rate) => {
    const k = `${plat}|${cur}`;
    const c = cash.get(k) || { platform: plat, currency: cur, amount: 0, cost: 0 };
    if (cur === 'TRY') { c.amount += amt; c.cost += amt; }
    else if (amt >= 0 || c.amount <= 1e-12) { c.amount += amt; c.cost += amt * rate; }
    else {
      const out = -amt, fromPos = Math.min(out, c.amount), avg = c.cost / c.amount;
      T.fxRealized += fromPos * (rate - avg);
      c.cost -= fromPos * avg; c.amount -= fromPos;
      const rest = out - fromPos;
      if (rest > 0) { c.amount -= rest; c.cost -= rest * rate; }
    }
    cash.set(k, c);
  };
  const cashMove = (from, to, cur, amt, rate) => {
    const src = cash.get(`${from}|${cur}`);
    const avg = src && src.amount > 1e-12 && cur !== 'TRY' ? src.cost / src.amount : rate;
    cashFlow(from, cur, -amt, avg); // ortalama maliyetten çıkış: kur farkı doğmaz
    cashFlow(to, cur, +amt, avg);
  };

  for (const t of txs) {
    const plat = t.platform || '—';
    const fx = t.fx_rate || 1;
    const cur = t.currency || 'TRY';
    switch (t.type) {
      case 'BUY': {
        const p = getPos(t.symbol, plat, t);
        const charges = t.fee + (t.tax || 0) + (t.other_fee || 0);
        const gross = t.quantity * t.price;
        p.qty += t.quantity; p.cost += (gross + charges) * fx; p.costNative += gross + charges; p.lastPrice = t.price;
        T.bought += (gross + charges) * fx; T.commissions += t.fee * fx; T.tax += (t.tax || 0) * fx; T.otherFee += (t.other_fee || 0) * fx;
        cashFlow(plat, cur, -(gross + charges), fx);
        break;
      }
      case 'SELL': {
        const p = getPos(t.symbol, plat, t);
        const q = t.quantity;
        const avg = p.qty > 1e-12 ? p.cost / p.qty : 0;
        const avgN = p.qty > 1e-12 ? p.costNative / p.qty : 0;
        const charges = t.fee + (t.tax || 0) + (t.other_fee || 0);
        const proceeds = (q * t.price - charges) * fx;
        const r = proceeds - avg * Math.min(q, Math.max(p.qty, 0));
        T.realized += r; realizedBySym[t.symbol] = (realizedBySym[t.symbol] || 0) + r;
        const qq = Math.min(q, Math.max(p.qty, 0));
        p.cost -= avg * qq; p.costNative -= avgN * qq; p.qty -= q;
        if (Math.abs(p.qty) < 1e-9) { p.qty = 0; p.cost = 0; p.costNative = 0; }
        p.lastPrice = t.price;
        T.sold += proceeds; T.commissions += t.fee * fx; T.tax += (t.tax || 0) * fx; T.otherFee += (t.other_fee || 0) * fx;
        cashFlow(plat, cur, q * t.price - charges, fx);
        break;
      }
      case 'DRIP': {
        const p = getPos(t.symbol, plat, t);
        const v = t.quantity * t.price;
        p.qty += t.quantity; p.cost += v * fx; p.costNative += v; p.lastPrice = t.price;
        T.dividends += v * fx; dividendsBySym[t.symbol] = (dividendsBySym[t.symbol] || 0) + v * fx;
        break;
      }
      case 'FREE':
      case 'STAKING': {
        const p = getPos(t.symbol, plat, t);
        p.qty += t.quantity;
        if (t.price) p.lastPrice = t.price;
        if (t.type === 'STAKING' && t.price) T.staking += t.quantity * t.price * fx;
        break;
      }
      case 'SPLIT': {
        // Platform belirtilmemişse sembolün tüm pozisyonlarına uygulanır
        const hit = [...pos.values()].filter((q) => q.symbol === t.symbol);
        for (const q of hit) if (splitAppliesTo(t, q.platform)) { q.qty *= t.quantity; if (q.lastPrice) q.lastPrice /= t.quantity; }
        // Pozisyon sayısı bölünme anındakidir: sonradan açılan platformlar bölünmeyi etkilemez
        if (hit.length > 1) splits.push({ ...t, platforms: hit.length });
        break;
      }
      case 'TRANSFER': {
        const to = t.to_platform || '—';
        if (t.symbol) {
          const from = getPos(t.symbol, plat, t), dst = getPos(t.symbol, to, t);
          // Kaynakta olmayan miktar hedefte hayalet pozisyon doğuruyordu (istenen miktarın tamamı yazılıyordu).
          const available = Math.max(from.qty, 0);
          const want = Math.max(t.quantity, 0);
          const q = Math.min(want, available);
          if (want > available + 1e-9) warnings.push(`${t.date} ${t.symbol}: transfer kaynağında yeterli miktar yok (${plat} → ${to}; istenen ${want}, kaynakta ${available}, taşınan ${q})`);
          if (want > available + 1e-9) audit.push({ code: 'transfer_short', severity: 'uyari', title: 'Transfer kaynağında yeterli miktar yok', detail: `${t.date} ${t.symbol}: ${plat} → ${to}; istenen ${want}, kaynakta ${available}, taşınan ${q}`, action: 'Transfer miktarını düzelt' });
          if (!(q > 1e-9)) break;
          const avg = from.qty > 1e-12 ? from.cost / from.qty : 0, avgN = from.qty > 1e-12 ? from.costNative / from.qty : 0;
          from.qty -= q; from.cost -= avg * q; from.costNative -= avgN * q;
          dst.qty += q; dst.cost += avg * q; dst.costNative += avgN * q; dst.lastPrice = from.lastPrice; dst.firstDate = dst.firstDate || t.date;
          if (Math.abs(from.qty) < 1e-9) { from.qty = 0; from.cost = 0; from.costNative = 0; }
        } else {
          cashMove(plat, to, cur, t.price, fx);
        }
        break;
      }
      case 'DIVIDEND': {
        // Eski satırlarda temettü stopajı `fee` içinde saklanıyordu; yeni kayıtlarda ayrı `tax` sütununda.
        const wh = (t.tax || 0) + (t.fee || 0);
        const net = t.price - wh;
        T.dividends += net * fx; T.dividendTax += wh * fx; T.tax += (t.tax || 0) * fx;
        dividendsBySym[t.symbol] = (dividendsBySym[t.symbol] || 0) + net * fx;
        cashFlow(plat, cur, net, fx);
        break;
      }
      case 'DEPOSIT': T.deposits += t.price * fx; cashFlow(plat, cur, t.price, fx); flows.push({ date: t.date, amount: t.price * fx }); break;
      case 'WITHDRAW': T.withdrawals += t.price * fx; cashFlow(plat, cur, -t.price, fx); flows.push({ date: t.date, amount: -t.price * fx }); break;
      case 'FEE': T.fees += t.price * fx; T.commissions += t.price * fx; cashFlow(plat, cur, -t.price, fx); break;
      case 'INTEREST': T.interest += t.price * fx; cashFlow(plat, cur, t.price, fx); break;
      case 'FX_CONVERT': {
        const valueTRY = t.price * fx; // çevrim anındaki TRY karşılığı korunur
        cashFlow(plat, cur, -t.price, fx);
        cashFlow(plat, t.to_currency, t.to_amount, valueTRY / t.to_amount);
        break;
      }
      default: break;
    }
  }

  // SPLIT platform tutarlılığı: geçmiş seri sembol başına tek kova tutar, platform ayrımı yapamaz.
  // Platform belirtilmiş bölünme defterde yalnız o platformun pozisyonunu büyütür, seride ise
  // sembolün tamamına uygulanır → özet ile grafik ayrışır. Platform belirtilmemiş bölünme ise
  // çok platformlu sembolde hangi kova için yazıldığı belli değildir.
  for (const s of splits) {
    if (s.platform) audit.push({ code: 'multi_platform_split', severity: 'kritik', title: 'Platformlu bölünme çok platformlu sembolde', detail: `${s.date} ${s.symbol}: ${s.quantity}× bölünme yalnız ${s.platform} platformunda uygulandı, sembol o tarihte ${s.platforms} platformda — geçmiş seri tümüne uyguluyor, özet ile grafik ayrışır`, action: 'Bölünmeyi düzelt' });
    else audit.push({ code: 'multi_platform_split', severity: 'uyari', title: 'Platformu belirtilmemiş bölünme', detail: `${s.date} ${s.symbol}: ${s.quantity}× bölünme platform belirtilmeden kaydedilmiş, sembol o tarihte ${s.platforms} platformda — geçmiş seri platform ayrımı yapamıyor`, action: 'Bölünmeye platform ekle' });
  }

  const bySym = new Map();
  for (const p of pos.values()) {
    if (!bySym.has(p.symbol)) bySym.set(p.symbol, { symbol: p.symbol, asset_type: p.asset_type, currency: p.currency, qty: 0, cost: 0, costNative: 0, lastPrice: 0, platforms: [], firstDate: p.firstDate });
    const a = bySym.get(p.symbol);
    a.qty += p.qty; a.cost += p.cost; a.costNative += p.costNative; a.lastPrice = p.lastPrice || a.lastPrice;
    if (p.firstDate < a.firstDate) a.firstDate = p.firstDate;
    if (p.qty > 1e-9) a.platforms.push(p.platform);
  }
  const cashTracking = T.deposits > 0 || T.withdrawals > 0;
  return {
    positions: [...pos.values()].filter((p) => p.qty > 1e-9),
    holdings: [...bySym.values()].filter((h) => h.qty > 1e-9),
    closed: [...bySym.values()].filter((h) => h.qty <= 1e-9),
    shorts: [...pos.values()].filter((p) => p.qty < -1e-9),
    cash: [...cash.values()].filter((c) => Math.abs(c.amount) > 1e-6),
    cashTracking,
    warnings,
    audit,
    totals: T,
    realizedBySym, dividendsBySym, flows,
  };
}

let cache = null;
let riskCache = new Map();
function invalidate() { cache = null; riskCache = new Map(); }

async function fxRates() {
  const q = await getQuotes(['USDTRY', 'EURTRY', 'GBPTRY', 'CHFTRY', 'JPYTRY']);
  const r = (s) => (q[s]?.price ? { now: q[s].price, prev: q[s].prevClose || q[s].price } : null);
  return { TRY: { now: 1, prev: 1 }, USD: r('USDTRY'), EUR: r('EURTRY'), GBP: r('GBPTRY'), CHF: r('CHFTRY'), JPY: r('JPYTRY') };
}

function manualPrices() {
  return Object.fromEntries(db.prepare('SELECT symbol, manual_price, manual_price_at FROM symbols WHERE manual_price IS NOT NULL').all().map((r) => [r.symbol, r]));
}

// Kullanıcının sembol tablosunda tanımladığı enstrüman tipi (varsa elle fiyat da buradan gelir)
function symbolMeta() {
  return Object.fromEntries(db.prepare('SELECT symbol, asset_type FROM symbols WHERE asset_type IS NOT NULL').all().map((r) => [r.symbol, r.asset_type]));
}

// Satış stopajına tabi enstrümanlar: yalnız BIST hisse ve ETF. Fon, tahvil, mevduat, altın,
// döviz, kripto ve yurt dışı hisseler muaftır — sembol biçiminden tahmin etmek tahvile %10 kesiyordu.
const TAXABLE = new Set(['stock', 'etf']);

const COUNTRY_BY_CUR = { USD: 'ABD', EUR: 'Euro bölgesi', GBP: 'Birleşik Krallık', CHF: 'İsviçre', JPY: 'Japonya' };
function countryOf(sym, type, cur) {
  if (sym.endsWith('.US')) return 'ABD';
  if (type === 'crypto') return 'Kripto (küresel)';
  if (type === 'gold' || type === 'commodity') return 'Emtia (küresel)';
  if (type === 'fx') return 'Döviz';
  return cur === 'TRY' ? 'Türkiye' : COUNTRY_BY_CUR[cur] || 'Diğer';
}
// TL'ye karşı korunaklı sayılan varlıklar: altın, döviz, kripto, emtia ve döviz cinsi her şey
const tlHedged = (h) => ['gold', 'fx', 'crypto', 'commodity'].includes(h.asset_type) || (h.currency && h.currency !== 'TRY');

const SEV = { kritik: 0, uyari: 1, bilgi: 2 };
// "Ne kadar eski?" — fiyat/kur tarihinin gün farkı. Saat dilimi kayması ileri tarih üretebilir, 0'a kırpılır.
const daysSince = (d) => {
  if (!d) return Infinity;
  const t = typeof d === 'number' ? d : Date.parse(d);
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400_000)) : Infinity;
};
const money0 = (n) => Math.round(n).toLocaleString('tr-TR');

export async function summary() {
  if (cache && Date.now() - cache.at < 10_000) return cache.data;
  const L = computeLedger();
  const symbols = L.holdings.map((h) => h.symbol);
  const [quotes, fx] = await Promise.all([getQuotes(symbols).catch(() => ({})), fxRates().catch(() => ({ TRY: { now: 1, prev: 1 } }))]);
  const manual = manualPrices();
  const userTypes = symbolMeta();
  let value = 0, cost = 0, dayChange = 0;
  const sellRate = Number(getSettings().sellTaxRate ?? 0.10);
  const unknownTax = [];
  const holdings = L.holdings.map((h) => {
    const q = quotes[h.symbol];
    const m = manual[h.symbol];
    const qCur = q?.currency || h.currency || 'TRY';
    const rate = fx[qCur];
    let price, priceSource, priceTime = null;
    if (q?.price != null) { price = q.price; priceSource = q.delayed ? 'gecikmeli' : 'canlı'; priceTime = q.time; }
    else if (m) { price = m.manual_price; priceSource = 'manuel'; priceTime = m.manual_price_at; }
    else { price = h.lastPrice; priceSource = 'son işlem'; }
    const v = rate ? h.qty * price * rate.now : null;
    // Günlük değişim TL bazında: fiyat + kur değişimi birlikte
    const dc = q?.prevClose != null && rate ? h.qty * (price * rate.now - q.prevClose * rate.prev) : 0;
    if (v != null) { value += v; cost += h.cost; dayChange += dc; }
    // "Bugün satarsam" senaryosu: brüt satış tutarı, stopaj kesintisi ve elde kalan net tutar.
    // Kapsam enstrüman tipine göre belirlenir: kullanıcı sembol tablosunda tip tanımladıysa o,
    // yoksa işlem kaydındaki tip esas. Tip belirsizse muaf kabul edilip uyarıya düşülür.
    const instType = userTypes[h.symbol] || h.asset_type;
    const typeKnown = !!userTypes[h.symbol] || (!!h.asset_type && h.asset_type !== 'other');
    const sellTax = typeKnown && TAXABLE.has(instType) && isBist(h.symbol) && qCur === 'TRY' ? sellRate : 0;
    if (isBist(h.symbol) && !typeKnown) unknownTax.push(h.symbol);
    const gross = v == null ? null : v;
    const tax = gross == null ? null : gross * sellTax;
    const netSell = gross == null ? null : gross - tax;
    const realizedNow = netSell == null ? null : netSell - h.cost;
    // Döviz cinsi varlıkta K/Z = fiyat etkisi (kendi para biriminde) + kur etkisi; toplamları pnl'e eşittir
    const split = qCur !== 'TRY' && v != null && h.costNative > 0
      ? { pnlPrice: (price - h.costNative / h.qty) * h.qty * rate.now, pnlFx: h.costNative * rate.now - h.cost } : {};
    return {
      ...split, country: countryOf(h.symbol, h.asset_type, qCur),
      symbol: h.symbol, name: q?.name || universe.stock(h.symbol)?.name || SPECIAL[h.symbol]?.name || h.symbol,
      asset_type: h.asset_type, assetLabel: ASSET_TYPES[h.asset_type] || h.asset_type,
      sector: sectorOf(h.symbol), currency: qCur, platforms: h.platforms,
      qty: h.qty, avgCost: h.cost / h.qty, avgCostNative: h.costNative / h.qty, cost: h.cost,
      price, priced: priceSource !== 'son işlem', priceSource, priceTime, changePct: q?.changePct ?? null,
      value: v, dayChange: dc, pnl: v != null ? v - h.cost : null, pnlPct: v != null && h.cost ? (v / h.cost - 1) * 100 : null,
      realized: L.realizedBySym[h.symbol] || 0, dividends: L.dividendsBySym[h.symbol] || 0, firstDate: h.firstDate,
      sellGross: gross, sellTax: tax, sellNet: netSell, sellRealized: realizedNow, sellTaxRate: sellTax, sellTaxable: sellTax > 0,
      missingFx: !rate,
    };
  });

  // Nakit: platform × para birimi
  let cashValue = 0, cashCost = 0, kurFarki = 0;
  const cashRows = L.cash.map((c) => {
    const rate = fx[c.currency]?.now;
    const valueTRY = rate ? c.amount * rate : null;
    if (valueTRY != null) { cashValue += valueTRY; cashCost += c.cost; if (c.currency !== 'TRY') kurFarki += valueTRY - c.cost; }
    return { platform: c.platform, currency: c.currency, amount: c.amount, valueTRY, costTRY: c.cost, fxPnl: c.currency !== 'TRY' && valueTRY != null ? valueTRY - c.cost : 0 };
  }).sort((a, b) => a.platform.localeCompare(b.platform) || a.currency.localeCompare(b.currency));
  const cashIncluded = L.cashTracking || cashRows.some((c) => c.currency !== 'TRY');
  const total = value + (cashIncluded ? cashValue : 0);
  holdings.forEach((h) => { h.weight = total && h.value != null ? (h.value / total) * 100 : 0; });
  holdings.sort((a, b) => (b.value || 0) - (a.value || 0));

  const positions = L.positions.map((p) => {
    const h = holdings.find((x) => x.symbol === p.symbol);
    const rate = fx[h?.currency]?.now || 1;
    const v = p.qty * (h?.price ?? p.lastPrice) * rate;
    return { symbol: p.symbol, platform: p.platform, qty: p.qty, avgCost: p.cost / p.qty, avgCostNative: p.costNative / p.qty, currency: h?.currency || p.currency, cost: p.cost, price: h?.price, value: v, pnl: v - p.cost, pnlPct: p.cost ? (v / p.cost - 1) * 100 : null, firstDate: p.firstDate, weight: total ? (v / total) * 100 : 0 };
  }).sort((a, b) => a.platform.localeCompare(b.platform) || b.value - a.value);

  const T = L.totals;
  const unrealized = value - cost;
  // Nakit takibi açıkken net yatırım = para girişi − para çıkışıdır. Ancak başlangıç nakdi hiç
  // DEPOSIT olarak kaydedilmemişse bu sayı sıfıra yakın kalır ve "Toplam K/Z" portföyün tamamını
  // kâr gibi gösterir. Savunulabilir tek maliyet esası pozisyon maliyetidir: kayıtlı nakit
  // maliyeti karşılamıyorsa maliyet esas alınır ve uyarı üretilir.
  const cashIn = T.deposits - T.withdrawals;
  const cashShort = L.cashTracking && cost > cashIn + 0.01;
  const netInvested = L.cashTracking ? Math.max(cashIn, cost) : T.bought - T.sold;
  const totalPnl = L.cashTracking
    ? total - netInvested
    : unrealized + T.realized + T.dividends + T.interest - T.fees + T.fxRealized + kurFarki;
  // Bütünlük denetimi: sessizce yanlış değer üreten boşluklar. `warnings` geriye uyum için
  // olduğu gibi kalır; `detail` alanı uyarı metniyle birebir aynıdır, arayüz aynı olayı
  // iki kez göstermemek için onu `audit` içinden okur.
  const audit = [...L.audit];
  const W = [];
  const addAudit = (a) => { audit.push(a); };
  if (cashShort) {
    W.push(`Kayıtlı nakit girişi (${Math.round(cashIn).toLocaleString('tr-TR')} ₺) pozisyon maliyetini (${Math.round(cost).toLocaleString('tr-TR')} ₺) karşılamıyor — başlangıç nakdi DEPOSIT olarak kaydedilmedi. Net yatırım maliyet esasıyla hesaplandı; "Toplam K/Z" güvenilmez.`);
    addAudit({ code: 'net_invested', severity: 'kritik', title: 'Net yatırım maliyet esasıyla hesaplandı', detail: W[0], action: 'Nakit girişi ekle' });
  }
  const negCash = cashRows.filter((c) => c.amount < -0.01);
  if (L.cashTracking && negCash.length) {
    W.push(`Eksi nakit: ${negCash.map((c) => `${c.platform} ${c.currency}`).join(', ')} — nakit girişi kaydı eksik olabilir`);
    addAudit({ code: 'neg_cash', severity: 'kritik', title: 'Eksi nakit bakiyesi', detail: W[W.length - 1], action: 'Nakit girişi ekle' });
  }
  if (L.shorts.length) {
    W.push(`Eldekinden fazla satış: ${L.shorts.map((p) => `${p.symbol} (${p.platform})`).join(', ')}`);
    addAudit({ code: 'short_position', severity: 'kritik', title: 'Eldekinden fazla satış', detail: W[W.length - 1], action: 'İşlem kaydını düzelt' });
  }
  const unpriced = holdings.filter((h) => !h.priced).map((h) => h.symbol);
  if (unpriced.length) {
    W.push(`Canlı fiyatı olmayan varlıklar son işlem fiyatıyla değerlendirildi: ${unpriced.join(', ')}`);
    addAudit({ code: 'unpriced', severity: 'uyari', title: 'Canlı fiyatı olmayan varlıklar', detail: W[W.length - 1], action: 'Fiyat gir' });
  }
  // TEFAS fonu / mevduat: aylardır değişmeyen fiyat portföyü şişirir ya da şişirmez
  const stale = holdings.filter((h) => ['fund', 'bond'].includes(h.asset_type) && daysSince(h.priceTime || h.firstDate) > 45);
  if (stale.length) addAudit({ code: 'stale_price', severity: 'bilgi', title: 'Fon fiyatı aylardır güncellenmiyor', detail: `${stale.map((h) => `${h.symbol} (${daysSince(h.priceTime || h.firstDate)} gündür)`).join(', ')} — değerleme eski fiyattan yapılıyor`, action: 'Fiyat güncelle' });
  // Kur boşluğu: canlı kuru olmayan ya da işlem günü kuru 1 olarak kaydedilmiş yabancı para
  const noRate = [...new Set([...cashRows.map((c) => c.currency), ...holdings.map((h) => h.currency)].filter((c) => c && c !== 'TRY' && !fx[c]))];
  const badRate = db.prepare("SELECT DISTINCT currency FROM transactions WHERE currency <> 'TRY' AND (fx_rate IS NULL OR fx_rate <= 1)").all().map((r) => r.currency);
  if (noRate.length || badRate.length) addAudit({ code: 'fx_gap', severity: 'uyari', title: 'Döviz kuru boşluğu', detail: `${[...new Set([...noRate, ...badRate])].join(', ')}: kuru olmayan ya da 1 olarak kaydedilmiş işlemler var — yabancı para değerleri eksik hesaplanıyor`, action: 'Kur kaydı ekle' });
  // Evren yaşam döngüsü: portföydeki bir kod artık BIST listesinde olmayabilir. Veri silinmez,
  // yalnız uyarılır — kaldırılan ya da kodu değişen kod doğrulanmadan taşınmaz.
  if (universe.isReady()) {
    const codes = holdings.filter((h) => h.asset_type === 'stock' && isBist(h.symbol)).map((h) => ({ h, c: universe.checkCode(h.symbol) }));
    const gone = codes.filter((x) => x.c.status === 'delisted');
    if (gone.length) addAudit({ code: 'delisted_holding', severity: 'uyari', title: 'Artık listelenmeyen hisse', detail: `${gone.map((x) => `${x.h.symbol} (${x.c.name || 'adı bilinmiyor'}, ${x.c.removedAt} tarihinde kaldırıldı)`).join(', ')} — geçmiş veri korunuyor, güncel fiyat ve temettü gelmiyor`, action: 'Sembolü doğrula' });
    const ren = codes.filter((x) => x.c.confirm);
    if (ren.length) addAudit({ code: 'renamed_holding', severity: 'bilgi', title: 'Kodu değişmiş olabilecek hisse', detail: ren.map((x) => `${x.h.symbol} → ${x.c.candidates.map((k) => k.symbol).join('/')} (${x.c.name}, ${x.c.removedAt} tarihinde kaldırıldı)`).join(', ') + ' — eski kod BIST listesinde yok; yeni kodlar yalnız ad benzerliğine dayanıyor, doğrulamadan taşınmadı', action: 'Yeni kodu doğrula' });
    const unk = codes.filter((x) => x.c.status === 'unknown');
    if (unk.length) addAudit({ code: 'unknown_symbol', severity: 'uyari', title: 'BIST listesinde bulunmayan sembol', detail: `${unk.map((x) => x.h.symbol).join(', ')} — evrende yok, kaldırılmış olarak da bilinmiyor; kod elle girilmiş ya da hatalı olabilir`, action: 'Sembolü doğrula' });
  }
  // Tarihsel serinin son noktası bugünkü değerden ayrışıyorsa grafik ile özet taban çatışır
  const ser = await fullSeries().catch(() => []);
  const lastPt = ser.at(-1);
  if (total > 0 && lastPt && daysSince(lastPt.date) <= 7) {
    const drift = (total - lastPt.value) / total;
    if (Math.abs(drift) > 0.01) addAudit({ code: 'series_drift', severity: 'uyari', title: 'Özet ile değer grafiği uyuşmuyor', detail: `${lastPt.date} tarihli seri noktası ${money0(lastPt.value)} ₺, bugünkü değer ${money0(total)} ₺ (%${(drift * 100).toFixed(1)} sapma)`, action: 'Geçmiş değer ekle' });
  }
  audit.sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const warnings = W;

  const data = {
    asOf: new Date().toISOString(),
    fx: Object.fromEntries(Object.entries(fx).map(([k, v]) => [k, v?.now ?? null])),
    totals: {
      value: total, holdingsValue: value, cash: cashIncluded ? cashValue : null, cashTracking: L.cashTracking, cost, unrealized,
      unrealizedPct: cost ? (unrealized / cost) * 100 : null,
      dayChange, dayChangePct: value - dayChange ? (dayChange / (value - dayChange)) * 100 : null,
      realized: T.realized, dividends: T.dividends, interest: T.interest, staking: T.staking, fees: T.fees, commissions: T.commissions,
      tax: T.tax, otherFee: T.otherFee, dividendTax: T.dividendTax,
      fxRealized: T.fxRealized, fxUnrealized: kurFarki, kurFarki: T.fxRealized + kurFarki,
      netInvested, totalPnl, totalPnlPct: netInvested > 0 ? (totalPnl / netInvested) * 100 : null,
      // true olduğunda net yatırım maliyet esasıyla hesaplandı; arayüz "Toplam K/Z" kartını işaretlemeli
      netInvestedEstimated: cashShort,
      valueUSD: fx.USD?.now ? total / fx.USD.now : null,
      positionsCount: holdings.length,
      // Tüm portföyü bugün satma senaryosu (stopaj sonrası)
      sellNet: holdings.reduce((a, h) => a + (h.sellNet || 0), 0),
      sellTax: holdings.reduce((a, h) => a + (h.sellTax || 0), 0),
      sellRealized: holdings.reduce((a, h) => a + (h.sellRealized || 0), 0),
      largest: holdings[0] ? { symbol: holdings[0].symbol, weight: holdings[0].weight } : null,
      best: [...holdings].filter((h) => h.changePct != null).sort((a, b) => b.changePct - a.changePct)[0]?.symbol || null,
      worst: [...holdings].filter((h) => h.changePct != null).sort((a, b) => a.changePct - b.changePct)[0]?.symbol || null,
    },
    cash: cashRows,
    warnings,
    audit,
    holdings, positions,
    closed: L.closed.map((c) => ({ symbol: c.symbol, realized: L.realizedBySym[c.symbol] || 0, dividends: L.dividendsBySym[c.symbol] || 0 })),
  };
  data.distribution = distribution(data);
  recordSnapshot(total, netInvested);
  cache = { at: Date.now(), data };
  return data;
}

function group(items, keyFn, total) {
  const m = {};
  for (const h of items) {
    if (h.value == null) continue;
    const k = keyFn(h);
    m[k] ||= { key: k, value: 0 };
    m[k].value += h.value;
  }
  return Object.values(m).map((x) => ({ ...x, pct: total ? (x.value / total) * 100 : 0 })).sort((a, b) => b.value - a.value);
}

function distribution(d) {
  const H = d.holdings;
  const total = d.totals.value;
  const cashItems = (d.totals.cash != null ? d.cash : []).map((c) => ({ value: c.valueTRY, assetLabel: 'Nakit', sector: 'Nakit', country: 'Nakit', currency: c.currency, platforms: [c.platform], symbol: `NAKİT ${c.currency}`, asset_type: 'cash' }));
  const withCash = [...H, ...cashItems];
  const currencyKey = (h) => (h.asset_type === 'gold' ? 'Altın' : h.asset_type === 'fx' ? h.symbol.slice(0, 3) : h.currency);
  const hhi = H.reduce((a, h) => a + (h.weight / 100) ** 2, 0);
  const byPlatform = {};
  for (const p of d.positions) byPlatform[p.platform] = (byPlatform[p.platform] || 0) + p.value;
  for (const c of cashItems) byPlatform[c.platforms[0]] = (byPlatform[c.platforms[0]] || 0) + (c.value || 0);
  return {
    byAsset: group(withCash, (h) => h.assetLabel, total),
    bySector: group(withCash, (h) => h.sector, total),
    byCurrency: group(withCash, currencyKey, total),
    byPlatform: Object.entries(byPlatform).map(([key, value]) => ({ key, value, pct: total ? (value / total) * 100 : 0 })).sort((a, b) => b.value - a.value),
    byCountry: group(withCash, (h) => h.country || 'Diğer', total),
    bySymbol: H.map((h) => ({ key: h.symbol, value: h.value, pct: h.weight })),
    concentration: { hhi, effectiveN: hhi ? 1 / hhi : 0, top5Pct: H.slice(0, 5).reduce((a, h) => a + h.weight, 0) },
    // TL dışı / korunaklı pay: altın, döviz, kripto, emtia, döviz cinsi varlıklar ve döviz nakit
    nonTl: (() => {
      const v = withCash.filter((h) => h.value != null && (h.asset_type === 'cash' ? h.currency !== 'TRY' : tlHedged(h))).reduce((a, h) => a + h.value, 0);
      return { value: v, pct: total ? (v / total) * 100 : 0 };
    })(),
  };
}

function recordSnapshot(value, netInvested) {
  if (!(value > 0)) return;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  db.prepare(`INSERT INTO snapshots(date, value, net_invested, source) VALUES(?, ?, ?, 'auto')
    ON CONFLICT(date) DO UPDATE SET value = excluded.value, net_invested = excluded.net_invested WHERE snapshots.source = 'auto'`).run(today, value, netInvested);
}

// ── Temettü ─────────────────────────────────────────────────
export async function dividendReport() {
  const rows = db.prepare(`${TX_SELECT} WHERE t.type IN ('DIVIDEND', 'DRIP') ORDER BY t.date`).all();
  // Eski satırlarda temettü stopajı `fee` içindeydi, yeni kayıtlarda `tax` sütununda: ikisi de toplanır
  const wh = (r) => (r.tax || 0) + (r.fee || 0);
  const items = rows.map((r) => ({
    id: r.id, date: r.date, symbol: r.symbol, platform: r.platform, type: r.type,
    amount: (r.type === 'DRIP' ? r.quantity * r.price : r.price - wh(r)) * r.fx_rate,
    gross: (r.type === 'DRIP' ? r.quantity * r.price : r.price) * r.fx_rate, tax: (r.type === 'DRIP' ? 0 : wh(r)) * r.fx_rate,
    currency: r.currency, notes: r.notes,
  }));
  const monthly = {}, yearly = {}, bySymbol = {};
  for (const it of items) {
    const m = it.date.slice(0, 7), y = it.date.slice(0, 4);
    monthly[m] = (monthly[m] || 0) + it.amount;
    yearly[y] = (yearly[y] || 0) + it.amount;
    bySymbol[it.symbol] = (bySymbol[it.symbol] || 0) + it.amount;
  }
  const s = await summary();
  // BIST hisse senetlerinde uygulanan temettü stopajı %10'dur. Kullanıcı ayarlardan değiştirebilir.
  const taxRate = Number(getSettings().dividendTaxRate ?? 0.10);
  const today = new Date().toISOString().slice(0, 10);
  // İlan edilmiş gelecek temettüler (İş Yatırım) — yalnızca BIST
  const bistHoldings = s.holdings.filter((h) => isBist(h.symbol));
  const acts = await universe.corporateActions({ symbols: bistHoldings.map((h) => h.symbol), from: today }).catch(() => []);
  const upcoming = acts.filter((a) => a.dpsGross > 0 || a.bonusPct > 0 || a.rightsPct > 0).map((a) => {
    const h = bistHoldings.find((x) => x.symbol === a.code);
    const gross = a.dpsGross * h.qty;
    return { symbol: a.code, date: a.date, dpsGross: a.dpsGross, qty: h.qty, gross, net: gross * (1 - taxRate), bonusPct: a.bonusPct, rightsPct: a.rightsPct, yieldPct: h.price ? (a.dpsGross / h.price) * 100 : null };
  });
  // Son 12 aydaki hisse başı temettüden yıllık beklenen gelir (tahmin)
  const expected = [];
  const cutoff = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  for (const h of s.holdings.filter((x) => x.asset_type === 'stock' || x.asset_type === 'etf')) {
    let dps = 0, dates = [];
    if (isBist(h.symbol)) {
      const past = await universe.corporateActions({ symbols: [h.symbol], from: cutoff, to: today }).catch(() => []);
      const paid = past.filter((a) => a.dpsGross > 0);
      dps = paid.reduce((a, x) => a + x.dpsGross, 0);
      dates = paid.map((x) => x.date);
    }
    if (!dps) {
      try {
        const { dividends } = await getDividends(h.symbol, '2y');
        const last = dividends.filter((d) => d.date >= cutoff);
        dps = last.reduce((a, d) => a + d.amount, 0);
        dates = last.map((d) => d.date);
      } catch { /* temettü verisi yok */ }
    }
    if (dps > 0) {
      const fxr = h.currency === 'TRY' ? 1 : s.fx[h.currency] || 1;
      const annual = dps * h.qty * fxr;
      expected.push({ symbol: h.symbol, dps, qty: h.qty, annualGross: annual, annualNet: annual * (h.currency === 'TRY' ? 1 - taxRate : 1), yieldPct: (dps / h.price) * 100, yieldOnCostPct: ((dps * fxr) / h.avgCost) * 100, lastDates: dates });
    }
  }
  const last12 = Object.entries(monthly).filter(([m]) => m >= cutoff.slice(0, 7)).reduce((a, [, v]) => a + v, 0);
  const expectedAnnual = expected.reduce((a, b) => a + b.annualNet, 0);
  // Alınan temettünün yıl × sektör / varlık sınıfı / ülke kırılımı
  const meta = (sym) => {
    const h = s.holdings.find((x) => x.symbol === sym);
    const type = h?.asset_type || guessAssetType(sym);
    return { sector: h?.sector || sectorOf(sym), asset: ASSET_TYPES[type] || type, country: h?.country || (sym?.endsWith('.US') ? 'ABD' : 'Türkiye') };
  };
  const breakdown = {};
  for (const it of items) {
    const y = it.date.slice(0, 4), md = meta(it.symbol);
    breakdown[y] ||= { bySector: {}, byAsset: {}, byCountry: {} };
    for (const [k, key] of [['bySector', md.sector], ['byAsset', md.asset], ['byCountry', md.country]]) breakdown[y][k][key] = (breakdown[y][k][key] || 0) + it.amount;
  }
  return {
    breakdown,
    items: items.reverse(), monthly, yearly, taxRate,
    bySymbol: Object.entries(bySymbol).map(([symbol, amount]) => ({ symbol, amount })).sort((a, b) => b.amount - a.amount),
    total: items.reduce((a, b) => a + b.amount, 0), last12, monthlyAvg: last12 / 12,
    upcoming, expected: expected.sort((a, b) => b.annualGross - a.annualGross), expectedAnnual,
    portfolioYieldPct: s.totals.holdingsValue ? (expected.reduce((a, b) => a + b.annualGross, 0) / s.totals.holdingsValue) * 100 : null,
  };
}

// ── Yıllık beyanname dökümü ──────────────────────────────────
// Satış stopajı, komisyon ve BSMV ayrı sütunlarda toplanır (eskiden `fee` içinde karışıyordu).
// Maliyet esası ortalama alındığından tüm geçmiş oynatılır; yalnızca [from, to] içindeki
// işlemler yıl kovasına yazılır, böylece dönem filtresi maliyet hesabını bozmaz.
export function taxReport(from = null, to = null) {
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const pos = new Map(); // sembol|platform → { qty, cost }
  const years = new Map();
  const bucket = (d) => {
    const year = d.slice(0, 4);
    if (!years.has(year)) years.set(year, { year, grossSales: 0, buyCost: 0, realized: 0, commission: 0, tax: 0, bsmv: 0, dividendGross: 0, dividendTax: 0, netOut: 0, dividendNet: 0, realizedPct: null });
    return years.get(year);
  };
  for (const t of db.prepare(`${TX_SELECT} WHERE t.type IN ('BUY','SELL','DIVIDEND') ORDER BY t.date, t.id`).all()) {
    const fx = t.fx_rate || 1;
    const fee = Number(t.fee) || 0, tax = Number(t.tax) || 0, bsmv = Number(t.other_fee) || 0;
    const b = inRange(t.date) ? bucket(t.date) : null;
    const k = `${t.symbol}|${t.platform || '—'}`;
    if (t.type === 'BUY') {
      const gross = t.quantity * t.price, charges = fee + tax + bsmv;
      if (b) { b.buyCost += (gross + charges) * fx; b.commission += fee * fx; b.tax += tax * fx; b.bsmv += bsmv * fx; }
      const p = pos.get(k) || { qty: 0, cost: 0 };
      p.qty += t.quantity; p.cost += (gross + charges) * fx;
      pos.set(k, p);
    } else if (t.type === 'SELL') {
      const p = pos.get(k) || { qty: 0, cost: 0 };
      const avg = p.qty > 1e-12 ? p.cost / p.qty : 0;
      const sold = Math.min(t.quantity, Math.max(p.qty, 0));
      const gross = t.quantity * t.price;
      if (b) {
        b.grossSales += gross * fx;
        b.commission += fee * fx; b.tax += tax * fx; b.bsmv += bsmv * fx;
        b.realized += (gross - fee - tax - bsmv - avg * sold) * fx;
      }
      p.qty -= t.quantity; p.cost -= avg * sold;
      if (Math.abs(p.qty) < 1e-9) { p.qty = 0; p.cost = 0; }
    } else if (b) {
      b.dividendGross += t.price * fx;
      b.dividendTax += (fee + tax) * fx; // eski satırlarda stopaj fee içindeydi
    }
  }
  const list = [...years.values()].sort((a, b) => a.year.localeCompare(b.year));
  const sum = (f) => list.reduce((a, b) => a + f(b), 0);
  for (const b of list) {
    b.netOut = b.grossSales - b.tax - b.commission - b.bsmv;
    b.dividendNet = b.dividendGross - b.dividendTax;
    b.realizedPct = b.buyCost ? (b.realized / b.buyCost) * 100 : null;
  }
  const total = { grossSales: sum((b) => b.grossSales), buyCost: sum((b) => b.buyCost), realized: sum((b) => b.realized), commission: sum((b) => b.commission), tax: sum((b) => b.tax), bsmv: sum((b) => b.bsmv), dividendGross: sum((b) => b.dividendGross), dividendTax: sum((b) => b.dividendTax) };
  total.netOut = total.grossSales - total.tax - total.commission - total.bsmv;
  total.dividendNet = total.dividendGross - total.dividendTax;
  return { from, to, years: list, total };
}

// ── Tarihsel değer serisi ve risk metrikleri ────────────────
function isoDay(ms) { return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); }

function rangeFor(firstDate) {
  const years = (Date.now() - new Date(firstDate).getTime()) / (365 * 86400_000);
  return years < 0.9 ? '1y' : years < 1.9 ? '2y' : years < 4.8 ? '5y' : '10y';
}

// İşlemlerden günlük portföy değeri (varlık + nakit) ve dış nakit akışı serisini yeniden kurar
export async function valueSeries() {
  const txs = allTx();
  if (!txs.length) return importedOnly();
  const L = computeLedger(txs);
  const cashMode = L.cashTracking;
  const first = txs[0].date;
  const range = rangeFor(first);
  const symbols = [...new Set(txs.filter((t) => t.symbol).map((t) => t.symbol))];
  const manual = manualPrices();
  const hist = {};
  await Promise.all(symbols.map(async (s) => { hist[s] = await getHistory(s, range, '1d').catch(() => []); }));
  const curs = [...new Set([...symbols.map((s) => currencyOf(s)), ...txs.map((t) => t.currency), ...txs.map((t) => t.to_currency)].filter((c) => c && c !== 'TRY'))];
  const fxHist = {};
  await Promise.all(curs.map(async (c) => { fxHist[c] = SPECIAL[`${c}TRY`] ? await getHistory(`${c}TRY`, range, '1d').catch(() => []) : []; }));

  const days = new Set(txs.map((t) => t.date));
  for (const s of symbols) for (const b of hist[s]) { const d = isoDay(b.t); if (d >= first) days.add(d); }
  const today = isoDay(Date.now());
  days.add(today);
  const calendar = [...days].filter((d) => d <= today).sort();
  const priceMap = (bars) => { const m = new Map(); for (const b of bars) m.set(isoDay(b.t), b.c); return m; };
  const pm = Object.fromEntries(symbols.map((s) => [s, priceMap(hist[s])]));
  const fxm = Object.fromEntries(curs.map((c) => [c, priceMap(fxHist[c])]));

  // Yahoo fiyatları bölünmeye göre geriye dönük düzeltilmiştir; eski miktarları sonraki bölünmelerle çarparız
  const splits = txs.filter((t) => t.type === 'SPLIT');
  const futureSplit = (sym, date) => splits.filter((s) => s.symbol === sym && s.date > date).reduce((a, s) => a * s.quantity, 1);

  const qty = {}; const lastPx = {}; const lastFx = { TRY: 1 };
  // Seride hiç bulunamayan kurlar için son bilinen kuru geriye doğru taşı: aksi hâlde o gün
  // döviz varlığı 0 sayılır ve Özet ile Risk grafiği birbirini tutmaz (60.000 TL ↔ 0).
  for (const c of curs) { const firstRate = fxm[c].values().next().value; if (firstRate != null) lastFx[c] = firstRate; }
  const cashAmt = {}; // para birimi → tutar (tüm platformlar)
  const addCash = (c, a) => { cashAmt[c] = (cashAmt[c] || 0) + a; };
  let ti = 0;
  const out = [];
  for (const day of calendar) {
    let flow = 0;
    for (const c of curs) { const r = fxm[c].get(day); if (r) lastFx[c] = r; }
    while (ti < txs.length && txs[ti].date <= day) {
      const t = txs[ti++];
      const f = t.symbol ? futureSplit(t.symbol, t.date) : 1;
      const rate = t.fx_rate || 1;
      const q = (d) => { qty[t.symbol] = (qty[t.symbol] || 0) + d * f; };
      switch (t.type) {
        case 'BUY': q(t.quantity); lastPx[t.symbol] ??= t.price / f; if (cashMode) addCash(t.currency, -(t.quantity * t.price + t.fee)); else flow += (t.quantity * t.price + t.fee) * rate; break;
        case 'SELL': q(-t.quantity); if (cashMode) addCash(t.currency, t.quantity * t.price - t.fee); else flow -= (t.quantity * t.price - t.fee) * rate; break;
        case 'DRIP': q(t.quantity); lastPx[t.symbol] ??= t.price / f; break;
        case 'FREE': case 'STAKING': q(t.quantity); break;
        case 'DIVIDEND': if (cashMode) addCash(t.currency, t.price - t.fee); else flow -= (t.price - t.fee) * rate; break;
        case 'INTEREST': if (cashMode) addCash(t.currency, t.price); else flow -= t.price * rate; break;
        case 'FEE': if (cashMode) addCash(t.currency, -t.price); else flow += t.price * rate; break;
        case 'DEPOSIT': addCash(t.currency, t.price); flow += t.price * rate; break;
        case 'WITHDRAW': addCash(t.currency, -t.price); flow -= t.price * rate; break;
        case 'FX_CONVERT': addCash(t.currency, -t.price); addCash(t.to_currency, t.to_amount); break;
        default: break; // SPLIT (geriye dönük düzeltildi), TRANSFER (toplamı değiştirmez)
      }
    }
    let value = 0;
    for (const s of symbols) {
      const qn = qty[s] || 0;
      if (Math.abs(qn) < 1e-9) continue;
      const px = pm[s].get(day);
      if (px != null) lastPx[s] = px;
      else if (lastPx[s] == null && manual[s]) lastPx[s] = manual[s].manual_price;
      const c = currencyOf(s);
      value += qn * (lastPx[s] || 0) * (c === 'TRY' ? 1 : lastFx[c] || 0);
    }
    if (cashMode || Object.keys(cashAmt).some((c) => c !== 'TRY')) {
      for (const [c, a] of Object.entries(cashAmt)) value += a * (c === 'TRY' ? 1 : lastFx[c] || 0);
    }
    out.push({ date: day, value, flow });
  }
  // İçe aktarılmış (ilk işlemden önceki) anlık görüntüler başa eklenir
  const imported = db.prepare("SELECT date, value, net_invested FROM snapshots WHERE source = 'import' AND date < ? ORDER BY date").all(first);
  const pre = imported.map((r, i) => ({ date: r.date, value: r.value, flow: i === 0 ? r.value : (r.net_invested != null && imported[i - 1].net_invested != null ? r.net_invested - imported[i - 1].net_invested : 0) }));
  return [...pre, ...out];
}

function importedOnly() {
  const rows = db.prepare('SELECT date, value, net_invested FROM snapshots ORDER BY date').all();
  return rows.map((r, i) => ({ date: r.date, value: r.value, flow: i === 0 ? r.value : (r.net_invested != null && rows[i - 1].net_invested != null ? r.net_invested - rows[i - 1].net_invested : 0) }));
}

// Zaman ağırlıklı getiri (TWR) endeksi
function twr(series) {
  const idx = []; const rets = [];
  let level = 100; let prev = null;
  for (const p of series) {
    if (prev && prev.value > 0) {
      const r = (p.value - p.flow) / prev.value - 1;
      if (Number.isFinite(r)) { level *= 1 + r; rets.push({ date: p.date, r }); }
    }
    idx.push({ date: p.date, level, value: p.value });
    prev = p;
  }
  return { idx, rets };
}

// Para ağırlıklı getiri (XIRR): akışlar yatırımcı açısından (yatırılan −, çekilen/son değer +)
export function xirr(cashflows) {
  const cf = cashflows.filter((c) => Math.abs(c.amount) > 1e-9);
  if (cf.length < 2 || !cf.some((c) => c.amount > 0) || !cf.some((c) => c.amount < 0)) return null;
  const t0 = new Date(cf[0].date).getTime();
  const yrs = cf.map((c) => (new Date(c.date).getTime() - t0) / (365 * 86400_000));
  const npv = (r) => cf.reduce((a, c, i) => a + c.amount / (1 + r) ** yrs[i], 0);
  let lo = -0.9999, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) { hi = 1000; fhi = npv(hi); if (flo * fhi > 0) return null; }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

async function benchmarkSeries(key, range) {
  const b = BENCHMARKS[key];
  if (!b) return null;
  if (key === 'TLREF') return tlrefIndex(); // gecelik faizle bileşik büyüyen TL (Borsa İstanbul)
  const parts = await Promise.all(b.parts.map((p) => getHistory(p, range, '1d').catch(() => [])));
  const maps = parts.map((bars) => { const m = new Map(); for (const x of bars) m.set(isoDay(x.t), x.c); return m; });
  const dates = [...maps[0].keys()];
  const last = new Array(maps.length).fill(null);
  const out = new Map();
  for (const d of dates.sort()) {
    let v = 1;
    for (let i = 0; i < maps.length; i++) { const x = maps[i].get(d); if (x != null) last[i] = x; if (last[i] == null) { v = null; break; } v *= last[i]; }
    if (v != null) out.set(d, v);
  }
  return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(a.length - 1, 1)); };

async function fullSeries() {
  const hit = riskCache.get('series');
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const series = await valueSeries();
  riskCache.set('series', { at: Date.now(), data: series });
  return series;
}

export async function risk({ from = null, to = null } = {}) {
  // Beyanname dökümü risk yanıtının içinde gelir: ayrı uç açmadan Risk sekmesinin alt sekmesi beslenir.
  const tax = taxReport(from, to);
  const all = await fullSeries();
  if (all.length < 3) return { enough: false, series: [], tax };
  // Seçili dönem: başlangıç günündeki değer açılış değeri kabul edilir
  let series = all.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
  if (from && series.length && series[0].date > from) {
    const before = all.filter((p) => p.date < from).at(-1);
    if (before) series = [{ ...before, flow: 0 }, ...series];
  }
  if (series.length) series = [{ ...series[0], flow: series[0].value }, ...series.slice(1)];
  if (series.length < 3) return { enough: false, series: [], start: from, end: to, tax };
  const { idx, rets } = twr(series);
  const settings = getSettings();
  // Risksiz faiz: varsayılan olarak dönemin ortalama TLREF'i (Borsa İstanbul); ayarlardan sabit oran seçilebilir
  let rf = Number(settings.riskFreeRate) || 0, rfSource = 'sabit';
  if ((settings.riskFreeSource || 'tlref') === 'tlref') {
    const st = await tlrefStats(idx[0].date, idx.at(-1).date).catch(() => null);
    if (st) { rf = st.avgPct / 100; rfSource = `TLREF ort. ${st.from} – ${st.to}`; }
  }
  const r = rets.map((x) => x.r);
  const days = (new Date(idx.at(-1).date) - new Date(idx[0].date)) / 86400_000 || 1;
  const total = idx.at(-1).level / 100 - 1;
  const cagr = days >= 365 ? (1 + total) ** (365 / days) - 1 : null; // bir yıldan kısa dönemde yıllıklandırma yanıltıcıdır
  const annRet = (1 + total) ** (365 / days) - 1;
  // Yıllıklandırma sabit 252 değil: takvim BIST hisseleriyle birlikte fon/kripto günlerini de içerir.
  // Gerçek işlem günü sayısından türetmek volatiliteyi ~%20 düzeltir (annualization 60-365 aralığına kırpılır).
  const annFactor = Math.sqrt(annualization(idx.length, days));
  const vol = std(r) * annFactor;
  const downside = Math.sqrt(mean(r.map((x) => Math.min(x, 0) ** 2))) * annFactor;
  let peak = -Infinity, maxDD = 0; const dd = [];
  for (const p of idx) { peak = Math.max(peak, p.level); const d = p.level / peak - 1; maxDD = Math.min(maxDD, d); dd.push({ date: p.date, dd: d * 100 }); }
  const curDD = dd.at(-1).dd / 100;

  // Aylık getiriler
  const monthly = {};
  let lastMonth = null, startLevel = 100, prevLevel = 100;
  for (const p of idx) {
    const m = p.date.slice(0, 7);
    if (m !== lastMonth) { if (lastMonth) monthly[lastMonth] = prevLevel / startLevel - 1; startLevel = prevLevel; lastMonth = m; }
    prevLevel = p.level;
  }
  if (lastMonth) monthly[lastMonth] = prevLevel / startLevel - 1;
  // Çeyreklik getiriler (aynı yöntem)
  const quarterly = {};
  let lastQ = null; startLevel = 100; prevLevel = 100;
  for (const p of idx) {
    const qk = `${p.date.slice(0, 4)}-Ç${Math.floor((Number(p.date.slice(5, 7)) - 1) / 3) + 1}`;
    if (qk !== lastQ) { if (lastQ) quarterly[lastQ] = prevLevel / startLevel - 1; startLevel = prevLevel; lastQ = qk; }
    prevLevel = p.level;
  }
  if (lastQ) quarterly[lastQ] = prevLevel / startLevel - 1;
  // Net yatırılan (dönem başı değer + sonraki para giriş-çıkışları): değer grafiğinde maliyet çizgisi
  let cum = 0;
  const invested = series.map((p) => (cum += p.flow || 0));
  const mv = Object.entries(monthly);
  const best = mv.reduce((a, b) => (b[1] > (a?.[1] ?? -Infinity) ? b : a), null);
  const worst = mv.reduce((a, b) => (b[1] < (a?.[1] ?? Infinity) ? b : a), null);

  // Kıyaslar
  const range = rangeFor(idx[0].date);
  const benchKeys = [...new Set([settings.benchmark || 'XU100', ...(settings.benchmarks || [])])].filter((k) => BENCHMARKS[k]);
  const benches = {};
  await Promise.all(benchKeys.map(async (k) => { benches[k] = await benchmarkSeries(k, range).catch(() => null); }));
  const benchLevels = {};
  const benchReturns = {};
  for (const k of benchKeys) {
    const m = benches[k];
    if (!m || !m.size) continue;
    let base = null, lastV = null;
    const lv = [];
    for (const p of idx) {
      const v = m.get(p.date) ?? lastV;
      if (v != null) lastV = v;
      if (base == null && v != null) base = v;
      lv.push(v != null && base ? (v / base) * 100 : null);
    }
    benchLevels[k] = lv;
    const firstV = lv.find((x) => x != null), lastL = [...lv].reverse().find((x) => x != null);
    benchReturns[k] = { label: BENCHMARKS[k].label, returnPct: firstV && lastL ? (lastL / firstV - 1) * 100 : null };
  }
  const mainKey = settings.benchmark && benchLevels[settings.benchmark] ? settings.benchmark : benchKeys.find((k) => benchLevels[k]);
  let beta = null, corr = null;
  if (mainKey) {
    const lv = benchLevels[mainKey];
    const pairs = [];
    for (let i = 1; i < idx.length; i++) {
      if (lv[i] && lv[i - 1]) {
        const rr = (idx[i].value - series[i].flow) / (idx[i - 1].value || NaN) - 1;
        if (Number.isFinite(rr) && idx[i - 1].value > 0) pairs.push([rr, lv[i] / lv[i - 1] - 1]);
      }
    }
    if (pairs.length > 20) {
      const pr = pairs.map((x) => x[0]), br = pairs.map((x) => x[1]);
      const mp = mean(pr), mb = mean(br);
      const cov = pairs.reduce((a, [p, b]) => a + (p - mp) * (b - mb), 0) / (pairs.length - 1);
      beta = cov / std(br) ** 2; corr = cov / (std(pr) * std(br));
    }
  }

  // XIRR: dönem başı değer yatırılmış kabul edilir, dönem sonu değer çekilmiş kabul edilir
  const cfs = [{ date: series[0].date, amount: -series[0].value }];
  for (let i = 1; i < series.length; i++) if (series[i].flow) cfs.push({ date: series[i].date, amount: -series[i].flow });
  cfs.push({ date: series.at(-1).date, amount: series.at(-1).value });
  const irr = xirr(cfs);

  // Devir hızı (yıllık): min(alış, satış) / ortalama portföy değeri
  const txs = db.prepare("SELECT type, quantity, price, fee, fx_rate, date FROM transactions WHERE type IN ('BUY','SELL') AND date >= ? AND date <= ?").all(idx[0].date, idx.at(-1).date);
  const buys = txs.filter((t) => t.type === 'BUY').reduce((a, t) => a + (t.quantity * t.price) * t.fx_rate, 0);
  const sells = txs.filter((t) => t.type === 'SELL').reduce((a, t) => a + (t.quantity * t.price) * t.fx_rate, 0);
  const avgValue = mean(idx.map((p) => p.value).filter((v) => v > 0));
  const turnover = avgValue ? (Math.min(buys, sells) / avgValue) * (365 / Math.max(days, 1)) : null;

  // Dönem analizi (sabit pencereler; tam seri üzerinden)
  const levelAt = (iso) => { let v = null; for (const p of idx) { if (p.date <= iso) v = p.level; else break; } return v ?? idx[0].level; };
  const back = (d) => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
  const lastL = idx.at(-1).level;
  const periods = from || to ? { 'Seçili dönem': total } : {
    '1H': lastL / levelAt(back(7)) - 1, '1A': lastL / levelAt(back(30)) - 1, '3A': lastL / levelAt(back(91)) - 1,
    '6A': lastL / levelAt(back(182)) - 1, YBB: lastL / levelAt(`${new Date().getFullYear() - 1}-12-31`) - 1,
    '1Y': lastL / levelAt(back(365)) - 1, Tümü: total,
  };
  const pct = (x) => (x == null ? null : x * 100);
  return {
    enough: true,
    start: idx[0].date, end: idx.at(-1).date, days: Math.round(days), selected: !!(from || to),
    metrics: {
      totalReturnPct: pct(total), cagrPct: pct(cagr), annualizedPct: pct(annRet), xirrPct: pct(irr), volatilityPct: pct(vol),
      sharpe: vol ? (annRet - rf) / vol : null, sortino: downside ? (annRet - rf) / downside : null,
      calmar: maxDD ? annRet / Math.abs(maxDD) : null, maxDrawdownPct: pct(maxDD), currentDrawdownPct: pct(curDD),
      bestMonth: best ? { month: best[0], pct: pct(best[1]) } : null, worstMonth: worst ? { month: worst[0], pct: pct(worst[1]) } : null,
      positiveMonthsPct: mv.length ? (mv.filter(([, v]) => v > 0).length / mv.length) * 100 : null,
      beta, correlation: corr, benchmark: mainKey, benchmarkReturnPct: mainKey ? benchReturns[mainKey]?.returnPct : null,
      riskFreeRatePct: rf * 100, riskFreeSource: rfSource, turnoverPct: pct(turnover),
      bestDayPct: r.length ? pct(Math.max(...r)) : null, worstDayPct: r.length ? pct(Math.min(...r)) : null,
    },
    benchmarks: benchReturns,
    periods: Object.fromEntries(Object.entries(periods).map(([k, v]) => [k, pct(v)])),
    monthly: Object.fromEntries(mv.map(([k, v]) => [k, pct(v)])),
    quarterly: Object.fromEntries(Object.entries(quarterly).map(([k, v]) => [k, pct(v)])),
    series: idx.map((p, i) => ({ date: p.date, level: p.level, value: p.value, invested: invested[i], ...Object.fromEntries(Object.entries(benchLevels).map(([k, lv]) => [k, lv[i]])) })),
    tax,
    drawdown: dd,
  };
}

// ── CSV içe/dışa aktarma ─────────────────────────────────────
const HEADER_ALIASES = {
  date: ['date', 'tarih', 'işlem tarihi', 'islem tarihi', 'emir tarihi', 'işlem günü', 'valör', 'valor'],
  type: ['type', 'tip', 'işlem', 'islem', 'işlem tipi', 'islem tipi', 'işlem türü', 'yön', 'yon', 'alış/satış', 'aksiyon', 'action', 'action_code'],
  symbol: ['symbol', 'sembol', 'hisse', 'kod', 'hisse kodu', 'menkul', 'menkul kıymet', 'kıymet', 'kiymet', 'varlık', 'varlik', 'enstrüman', 'asset'],
  quantity: ['quantity', 'adet', 'miktar', 'lot', 'gerçekleşen adet', 'işlem adedi', 'nominal', 'oran', 'bölünme oranı', 'bolunme orani'],
  price: ['price', 'fiyat', 'birim fiyat', 'ort. fiyat', 'ortalama fiyat', 'işlem fiyatı', 'gerçekleşen fiyat', 'tutar', 'amount', 'unit_price'],
  fee: ['fee', 'komisyon', 'kom.', 'komisyon tutarı', 'masraf', 'ücret'],
  tax: ['tax', 'stopaj', 'stopaj tutarı', 'vergi', 'vergi tutarı'],
  other_fee: ['other_fee', 'bsmv', 'b.s.m.v.', 'b.s.m.v', 'bankan işlem ücreti', 'bankan islem ucreti', 'diğer ücret', 'diger ucret'],
  currency: ['currency', 'para birimi', 'döviz', 'doviz', 'pb'],
  fx_rate: ['fx', 'fx_rate', 'kur', 'döviz kuru', 'fx_rate_to_try'],
  platform: ['platform', 'aracı kurum', 'araci kurum', 'kurum', 'hesap', 'broker'],
  to_platform: ['to_platform', 'hedef platform', 'hedef kurum'],
  to_currency: ['to_currency', 'hedef para birimi', 'hedef döviz'],
  to_amount: ['to_amount', 'hedef tutar'],
  asset_type: ['asset_type', 'varlık tipi', 'varlik tipi', 'tür', 'tur', 'sınıf', 'sinif'],
  strategy: ['strategy', 'strateji'],
  notes: ['notes', 'not', 'notlar', 'açıklama', 'aciklama'],
};
const TYPE_ALIASES = {
  BUY: ['buy', 'alış', 'alis', 'al', 'a', 'alim', 'alım'], SELL: ['sell', 'satış', 'satis', 'sat', 's', 'satim', 'satım'],
  DIVIDEND: ['dividend', 'temettü', 'temettu', 'kar payı', 'kâr payı', 'nakit temettü', 'cash_dividend'],
  DRIP: ['drip', 'temettü yatırım', 'temettü yeniden yatırım'],
  SPLIT: ['split', 'bölünme', 'bolunme', 'bedelsiz'],
  FREE: ['free', 'maliyetsiz', 'hediye', 'bedelsiz hisse'],
  STAKING: ['staking', 'kripto staking'],
  TRANSFER: ['transfer', 'virman'],
  FX_CONVERT: ['fx_convert', 'döviz çevrimi', 'doviz cevrimi', 'çevrim'],
  DEPOSIT: ['deposit', 'yatırma', 'yatirma', 'nakit girişi', 'para yatırma', 'cash_in'],
  WITHDRAW: ['withdraw', 'çekme', 'cekme', 'nakit çıkışı', 'para çekme', 'cash_out'],
  FEE: ['fee', 'masraf', 'ücret', 'komisyon', 'commission'], INTEREST: ['interest', 'faiz', 'faiz kazancı'],
};
const ASSET_ALIASES = { hisse: 'stock', etf: 'etf', fon: 'fund', 'yatırım fonu': 'fund', altın: 'gold', emtia: 'commodity', döviz: 'fx', kripto: 'crypto', tahvil: 'bond', mevduat: 'bond', nakit: 'other' };

export function parseNumber(s) {
  if (typeof s === 'number') return s;
  s = String(s ?? '').trim().replace(/[₺$€£\s]/g, '');
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || (/,\d+$/.test(s) && !s.includes('.'))) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDateStr(s) {
  s = String(s || '').trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export const CSV_FIELDS = {
  date: 'Tarih', type: 'İşlem tipi', symbol: 'Sembol', quantity: 'Adet / oran', price: 'Fiyat / tutar', fee: 'Komisyon',
  tax: 'Stopaj', other_fee: 'BSMV / diğer ücret',
  currency: 'Para birimi', fx_rate: 'Kur', platform: 'Platform', to_platform: 'Hedef platform', to_currency: 'Hedef para birimi',
  to_amount: 'Hedef tutar', asset_type: 'Varlık tipi', strategy: 'Strateji', notes: 'Not',
};
// Aynı işlemi ikinci kez içe aktarmamak için imza
const txSig = (t) => [t.date, t.type, t.symbol || '', Number(t.quantity || 0), Number(t.price || 0), Number(t.fee || 0), Number(t.tax || 0), Number(t.other_fee || 0), t.platform || ''].join('|');

// mapping: { alan: sütun sırası (0'dan) veya -1 (yok) } — otomatik algılamanın üzerine yazar
export function previewCsv(text, mapping = null) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV en az bir başlık ve bir veri satırı içermeli');
  const header = rows[0].map((h) => h.trim().toLocaleLowerCase('tr'));
  const col = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => aliases.includes(h));
    if (i >= 0) col[field] = i;
  }
  for (const [field, i] of Object.entries(mapping || {})) {
    if (!CSV_FIELDS[field]) continue;
    if (Number(i) >= 0 && Number(i) < header.length) col[field] = Number(i); else delete col[field];
  }
  const base = { headers: rows[0], mapping: col, fields: CSV_FIELDS };
  const missing = ['date', 'type'].filter((f) => col[f] == null);
  if (missing.length) return { ...base, missing, columns: Object.keys(col), rows: [], valid: 0, invalid: 0, duplicates: 0 };
  const existing = new Set(allTx().map((t) => txSig({ ...t, platform: t.platform })));
  const out = rows.slice(1).map((r, i) => {
    const get = (f) => (col[f] != null ? r[col[f]]?.trim() : undefined);
    const rawType = (get('type') || '').toLocaleLowerCase('tr');
    const type = Object.entries(TYPE_ALIASES).find(([k, a]) => a.includes(rawType) || k.toLowerCase() === rawType)?.[0] || rawType.toUpperCase();
    const rawAsset = (get('asset_type') || '').toLocaleLowerCase('tr');
    const t = {
      date: parseDateStr(get('date')), type, symbol: get('symbol') || null,
      quantity: parseNumber(get('quantity')), price: parseNumber(get('price')), fee: parseNumber(get('fee')) || 0,
      tax: parseNumber(get('tax')) || 0, other_fee: parseNumber(get('other_fee')) || 0,
      currency: get('currency') || undefined, fx_rate: parseNumber(get('fx_rate')) || undefined,
      platform: get('platform') || undefined, to_platform: get('to_platform') || undefined,
      to_currency: get('to_currency') || undefined, to_amount: parseNumber(get('to_amount')) || undefined,
      asset_type: ASSET_ALIASES[rawAsset] || (ASSET_TYPES[rawAsset] ? rawAsset : undefined), strategy: get('strategy') || undefined, notes: get('notes') || undefined,
    };
    let error = null, v = null;
    try {
      v = validateTx({ ...t, fx_rate: t.fx_rate || 1, platform: undefined, strategy: undefined, to_platform_id: t.to_platform ? -1 : undefined, to_platform: undefined });
    } catch (e) { error = e.message; }
    // Normalleştirilmiş hâl üzerinden karşılaştır (tutar işlemlerinde adet 1, sembol büyük harf)
    const duplicate = !error && existing.has(txSig({ ...v, platform: t.platform || '' }));
    return { line: i + 2, tx: t, error, duplicate };
  });
  const ok = out.filter((r) => !r.error && !r.duplicate);
  return { ...base, missing: [], columns: Object.keys(col), rows: out, valid: ok.length, invalid: out.filter((r) => r.error).length, duplicates: out.filter((r) => r.duplicate).length };
}

export async function commitCsv(text, mapping = null) {
  const p = previewCsv(text, mapping);
  if (p.missing?.length) throw new Error(`Zorunlu sütun eşleştirilmedi: ${p.missing.map((f) => CSV_FIELDS[f]).join(', ')}`);
  let n = 0;
  const errors = [];
  for (const r of p.rows) {
    if (r.error || r.duplicate) continue;
    try { await addTransaction(r.tx); n++; } catch (e) { errors.push({ line: r.line, error: e.message }); }
  }
  return { imported: n, skipped: p.invalid + errors.length, duplicates: p.duplicates, errors };
}

// Geçmiş portföy değerleri: tarih,değer[,net_yatırılan]
export function importSnapshots(text) {
  const rows = parseCsv(text);
  let n = 0;
  const ins = db.prepare(`INSERT INTO snapshots(date, value, net_invested, source) VALUES(?, ?, ?, 'import')
    ON CONFLICT(date) DO UPDATE SET value = excluded.value, net_invested = excluded.net_invested, source = 'import'`);
  tx(() => {
    for (const r of rows) {
      const d = parseDateStr(r[0]); const v = parseNumber(r[1]);
      if (!d || v == null) continue; // başlık satırı vb.
      ins.run(d, v, r[2] != null ? parseNumber(r[2]) : null);
      n++;
    }
  });
  invalidate();
  return { imported: n };
}

export function exportCsv() {
  const rows = listTransactions({ limit: 1e9 }).reverse();
  const head = ['date', 'type', 'symbol', 'quantity', 'price', 'fee', 'tax', 'other_fee', 'currency', 'fx_rate', 'platform', 'to_platform', 'to_currency', 'to_amount', 'asset_type', 'strategy', 'notes'];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n');
}

export function setSymbolMeta(symbol, { name, sector, asset_type, currency }) {
  const s = normalize(symbol);
  db.prepare(`INSERT INTO symbols(symbol, name, sector, asset_type, currency) VALUES(?,?,?,?,?)
    ON CONFLICT(symbol) DO UPDATE SET name = COALESCE(excluded.name, symbols.name), sector = COALESCE(excluded.sector, symbols.sector),
    asset_type = COALESCE(excluded.asset_type, symbols.asset_type), currency = COALESCE(excluded.currency, symbols.currency)`).run(s, name ?? null, sector ?? null, asset_type ?? null, currency ?? null);
  invalidate();
}

// Referans tabloları (Portföy > Ayarlar)
export function reference() {
  return {
    actions: Object.entries(TX_META).map(([code, m]) => ({ code, label: m.label, qty: m.qty, cash: m.cash, income: !!m.income, needs: m.needs })),
    assetTypes: ASSET_TYPES, currencies: CURRENCIES,
    benchmarks: Object.fromEntries(Object.entries(BENCHMARKS).map(([k, v]) => [k, v.label])),
  };
}

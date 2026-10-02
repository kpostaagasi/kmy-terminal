// Veri denetiminin saf (ağsız, veritabanısız) çekirdeği: karşılaştırma, karar ve rapor.
// Canlı kaynaklara dokunan kısım scripts/veri-denetimi.mjs'tedir.

// Kontrol grubu başına izin verilen sapma (%). TEFAS'ta tam eşleşme beklenir.
export const TOLERANS = { fx: 0.5, gram: 1, altinTuru: 3, hisse: 1.5, tefas: 1e-6, oran: 0.5, portfoy: 0.1 };

// Bağımsız altın sabitleri: 1 troy ons = 31,1034768 g; çeyrek altın 1,754 g, 22 ayar (0,916).
const ONS_GRAM = 31.1034768;
export const SAF_GR = { CEYREK: 1.754 * 0.916, YARIM: 2 * 1.754 * 0.916, TAM: 4 * 1.754 * 0.916 };

const sayi = Number.isFinite;

/** İki değeri karşılaştırır. Eksik/sonlu olmayan değer → ATLANDI (sıfıra bölme yok). */
export function karsilastir(app, ref, tolPct) {
  if (!sayi(app) || !sayi(ref)) return { durum: 'ATLANDI', neden: 'değer yok', app: app ?? null, ref: ref ?? null };
  const sapmaPct = ref === 0 ? (app === 0 ? 0 : Infinity) : (Math.abs(app - ref) / Math.abs(ref)) * 100;
  return { durum: sapmaPct <= tolPct ? 'OK' : 'SAPMA', sapmaPct, app, ref };
}

/** Kontrolü çalıştırır; ağ/kaynak hatası SAPMA değil ATLANDI'dır. */
export async function guard(fn) {
  try { return await fn(); } catch (e) { return { durum: 'ATLANDI', neden: `hata: ${e?.message || e}` }; }
}

/** Ons ($) × USDTRY ÷ 31,1035 = gram altın (TL). Girdi eksikse null. */
export const gramRef = (onsUsd, usdTry) => (sayi(onsUsd) && sayi(usdTry) ? (onsUsd * usdTry) / ONS_GRAM : null);

/** Gram altın ↔ ons × kur. Truncgil yokken uygulama Yahoo vadeli yedeğini kullanır; aynı formülü kendisiyle karşılaştırmak anlamsızdır. */
export function gramKarar(gramQ, onsQ, usdQ) {
  if (/vadeli/.test(gramQ?.source || '')) return { durum: 'ATLANDI', neden: 'yedek kaynak (Truncgil yok)', app: gramQ.price ?? null, ref: null };
  return karsilastir(gramQ?.price, gramRef(onsQ?.price, usdQ?.price), TOLERANS.gram);
}

// ponytail: yalnız hafta sonu/pazartesi; resmî tatilden sonraki gün için holidayOf gerekir.
/** Döviz ↔ TCMB. TCMB kuru önceki iş günü 15:30'da belirlenir; pazar ve pazartesi sabahı sapma doğal olarak büyür. */
export function fxKarar({ app, ref, simdi = new Date() }) {
  const gun = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', weekday: 'short' }).format(simdi);
  if (gun === 'Sun' || gun === 'Mon') return { durum: 'ATLANDI', neden: 'TCMB kuru önceki iş gününe ait (pazar/pazartesi)', app: app ?? null, ref: ref ?? null };
  return karsilastir(app, ref, TOLERANS.fx);
}

/** BIST fiyatı: seans açıkken İş Yatırım kapanışıyla karşılaştırılamaz. */
export function hisseKarar({ app, ref, seansAcik, isyTaze = true }) {
  if (!isyTaze) return { durum: 'ATLANDI', neden: 'İş Yatırım verisi tazelenemedi (eski önbellek)', app: app ?? null, ref: ref ?? null };
  if (seansAcik) return { durum: 'ATLANDI', neden: 'seans açık; kapanış değeri karşılaştırılamaz', app: app ?? null, ref: ref ?? null };
  return karsilastir(app, ref, TOLERANS.hisse);
}

/** Fiyat nesnesinin gecikme etiketi ve (verildiyse) yaşı beklentiye uyuyor mu? */
export function etiketKarar(q, beklenenGecikmeli, maxYasMs = null, simdi = Date.now()) {
  if (!q) return { durum: 'ATLANDI', neden: 'fiyat yok' };
  if (!beklenenGecikmeli && /vadeli/.test(q.source || '')) return { durum: 'ATLANDI', neden: 'yedek kaynak (Truncgil yok)' };
  if (Boolean(q.delayed) !== beklenenGecikmeli) return { durum: 'SAPMA', neden: `delayed=${Boolean(q.delayed)}, beklenen ${beklenenGecikmeli}` };
  const yas = simdi - q.time;
  if (maxYasMs != null && sayi(yas) && yas > maxYasMs) return { durum: 'SAPMA', neden: `veri ${Math.round(yas / 60_000)} dk eski` };
  return { durum: 'OK' };
}

/** "6/2026" ve "2026/6" biçimlerini "2026/6"ya çevirir; tanınmazsa null. */
export function donemAnahtar(p) {
  const m = /^(\d{1,4})\D(\d{1,4})$/.exec(String(p ?? '').trim());
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const [y, mo] = a > 12 ? [a, b] : [b, a];
  return `${y}/${mo}`;
}

/** Mali tablo ham satırlarından FAVÖK / net kâr / F/K'yı yeniden hesaplayıp uygulamanınkiyle karşılaştırır. */
export function temelKarar(f, st) {
  const item = (code) => f.lastPeriodItems?.find((x) => x.code === code)?.value ?? null;
  const cur = f.cumulative?.[0];
  const out = [];
  const h = item('3H'), d = item('4B');
  if (f.type === 'banka') out.push({ ad: 'FAVÖK', durum: 'ATLANDI', neden: 'banka için FAVÖK anlamsız' });
  else if (sayi(h) && sayi(d) && (h !== 0 || d !== 0)) out.push({ ad: 'FAVÖK', ...karsilastir(cur?.ebitda, h + d, TOLERANS.oran) });
  else out.push({ ad: 'FAVÖK', durum: 'ATLANDI', neden: 'ham satır yok' });
  out.push({ ad: 'Net kâr', ...karsilastir(cur?.netIncome, item('3Z'), TOLERANS.oran) });
  const q4 = (f.quarterly || []).slice(0, 4).map((q) => q.netIncome);
  const ttm = q4.length === 4 && q4.every(sayi) ? q4.reduce((a, b) => a + b, 0) : null;
  if (ttm == null || ttm <= 0 || !sayi(st?.mcapTL)) out.push({ ad: 'F/K', durum: 'ATLANDI', neden: '12 aylık net kâr veya piyasa değeri yok/≤0' });
  else if (donemAnahtar(st.period) && donemAnahtar(f.latest) && donemAnahtar(st.period) !== donemAnahtar(f.latest)) {
    out.push({ ad: 'F/K', durum: 'ATLANDI', neden: `dönem uyuşmuyor: ${st.period} ↔ ${f.latest}` });
  } else {
    // İş Yatırım F/K'yı 1 ondalığa yuvarlar (±0,05); düşük çarpanda bu tek başına %2'yi bulur.
    const ref = st.mcapTL / ttm;
    out.push({ ad: 'F/K', ...karsilastir(st.pe, ref, TOLERANS.oran + (0.05 / ref) * 100), neden: `dönem ${st.period ?? '?'} ↔ ${f.latest ?? '?'}` });
  }
  return out;
}

/** Portföy özetinin toplamlarını bileşenlerinden bağımsız yeniden toplar. */
export function portfoyKarar(s) {
  const H = (s?.holdings || []).filter((h) => h.value != null);
  if (!H.length) return [{ ad: 'Portföy', durum: 'ATLANDI', neden: 'pozisyon yok' }];
  const kur = (c) => (c === 'TRY' ? 1 : s.fx?.[c]);
  const holdSum = H.reduce((a, h) => a + h.qty * h.price * kur(h.currency), 0);
  const T = s.totals;
  const out = [{ ad: 'Σ pozisyon değeri', ...karsilastir(T.holdingsValue, holdSum, TOLERANS.portfoy) }];
  if (H.some((h) => h.missingFx)) out.push({ ad: 'Σ platform değeri', durum: 'ATLANDI', neden: 'eksik kur var' });
  else out.push({ ad: 'Σ platform değeri', ...karsilastir(T.holdingsValue, (s.positions || []).reduce((a, p) => a + p.value, 0), TOLERANS.portfoy) });
  const nakit = T.cash != null ? (s.cash || []).reduce((a, c) => a + (c.valueTRY || 0), 0) : 0;
  out.push({ ad: 'Toplam değer', ...karsilastir(T.value, holdSum + nakit, TOLERANS.portfoy) });
  return out;
}

const fmt = (v) => (v == null ? '-' : Number(v).toPrecision(6));

/** Terminal tablosu + özet satırı. */
export function rapor(sonuc) {
  const satir = sonuc.map((r) => [r.grup, r.ad, r.durum, r.sapmaPct == null ? '-' : `%${r.sapmaPct.toFixed(3)}`, fmt(r.app), fmt(r.ref), r.neden || ''].join(' | '));
  const say = (d) => sonuc.filter((r) => r.durum === d).length;
  return [...satir, '', `OK ${say('OK')} · SAPMA ${say('SAPMA')} · ATLANDI ${say('ATLANDI')}`].join('\n');
}

/** 1: SAPMA var · 2: hiçbir şey doğrulanamadı (hepsi ATLANDI) · 0: temiz. */
export function cikisKodu(sonuc) {
  if (sonuc.some((r) => r.durum === 'SAPMA')) return 1;
  if (!sonuc.some((r) => r.durum === 'OK')) return 2;
  return 0;
}

/** { ok, sapma, atlandi } sayımı; bilinmeyen durumlu satırlar sayılmaz. */
export function ozet(results) {
  const say = (d) => (results || []).filter((r) => r.durum === d).length;
  return { ok: say('OK'), sapma: say('SAPMA'), atlandi: say('ATLANDI') };
}

/**
 * Canlı çapraz kaynak grupları: uygulamanın değeri bağımsız bir dış kaynakla her koşuda yeniden karşılaştırılır.
 * Temel (aynı önbellek yükünden iki kez okur), Tazelik ve Portföy (iç tutarlılık) tek başına doğrulama sayılmaz:
 * sunucuda financials önbelleği 12 saat sıcak kalır, ağ yokken bunlar OK dönmeye devam eder.
 */
export const CANLI_GRUPLAR = ['Döviz', 'Altın', 'Altın türü', 'Hisse', 'TEFAS'];

/**
 * Rozet durumu: 'yok' (hiç çalışmadı) · 'uyari' (SAPMA var) · 'temiz' (SAPMA yok ve canlı çapraz kaynak grubunda en az bir OK)
 * · 'dogrulanamadi' (aksi halde: sahte yeşil yok).
 */
export function rozetDurumu(results) {
  if (!results || !results.length) return 'yok';
  if (ozet(results).sapma) return 'uyari';
  return results.some((r) => r.durum === 'OK' && CANLI_GRUPLAR.includes(r.grup)) ? 'temiz' : 'dogrulanamadi';
}

/** Son denetim bu süreden eskiyse rozet "eski" işaretlenir. */
export const ESKI_MS = 24 * 3600_000;
export const eskiMi = (at, now = Date.now()) => at != null && now - at > ESKI_MS;

// Sinyal bildirimi: hangi sinyaller YENİ ve tarama ne zaman yapılır. Saf mantık (veritabanı ve ağ yok).

// Seyrek ve trend belirleyici sinyaller; RSI, MACD ve hacim gürültülü olduğundan varsayılan kapalı.
export const DEFAULT_TYPES = ['golden', 'death', 'high52', 'low52', 'sma200_up', 'sma200_dn'];

// Günlük mum seans kapanışından sonra kesinleşir (Yahoo ~15 dk gecikmeli): normal gün 18:30, yarım gün 12:50.
export const SCAN_AFTER = '18:30';
export const SCAN_AFTER_HALF = '12:50';
export const RETRY_MS = 10 * 60_000;

/**
 * Yeni sinyalleri ayırır.
 *  prev:    { sembol: [sinyal…] }  önceki tarama durumu (yoksa/boşsa hepsi taban çizgisi)
 *  scanned: [{ symbol, signals, price, changePct }]  bu taramada başarıyla taranan semboller (sinyalsiz olanlar dahil)
 *  enabled: bildirilecek sinyal türleri
 *  scope:   izlenen semboller (izleme listesi + portföy)
 * Kural: bir sinyal yalnız, sembolün önceki durumu biliniyorsa ve o durumda yoksa "yeni"dir.
 * Önceki durumu olmayan sembol (ilk çalıştırma, listeye yeni eklenen) sessizce taban çizgisine alınır.
 * Durum TÜM sinyal türlerini saklar: türü sonradan açmak mevcut sinyalleri bildirim yağmuruna çevirmez.
 * Taranamayan sembolün önceki durumu korunur; kapsamdan çıkan sembol durumdan düşer.
 */
export function diffSignals(prev, scanned, enabled, scope) {
  const before = prev || {};
  const inScope = new Set(scope);
  const got = new Map(scanned.filter((x) => inScope.has(x.symbol)).map((x) => [x.symbol, x]));
  const fired = [];
  const state = {};
  for (const s of scope) {
    const item = got.get(s);
    if (item) {
      state[s] = item.signals;
      if (before[s] !== undefined) {
        for (const sig of item.signals) {
          if (enabled.includes(sig) && !before[s].includes(sig)) fired.push({ symbol: s, signal: sig, price: item.price, changePct: item.changePct });
        }
      }
    } else if (before[s] !== undefined) state[s] = before[s];
  }
  return { fired, state };
}

/**
 * Tarama zamanı geldi mi? Yalnız işlem günü, kapanış seansı bittikten ve mum kesinleştikten sonra,
 * günde bir kez; başarısız denemeler 10 dakikada bir tekrarlanır.
 *  status: market.marketStatus() sonucu; label === 'Seans kapalı' yalnız işlem gününün kapanıştan sonrasıdır
 *          (hafta sonu, tatil, seans öncesi ve kapanış seansı başka etiket taşır).
 */
export function dueNow({ status, hm, today, lastDone, lastAttempt, now }) {
  if (!status || status.label !== 'Seans kapalı') return false;
  if (hm < (status.half ? SCAN_AFTER_HALF : SCAN_AFTER)) return false;
  if (lastDone === today) return false;
  if (lastAttempt != null && now - lastAttempt < RETRY_MS) return false;
  return true;
}

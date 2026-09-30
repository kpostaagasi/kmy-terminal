// Türkçe arama katlaması ve alaka puanı — tek kaynak; market/universe/funds hep aynısını kullanır.
// Ayrı dosya çünkü üçü de birbirini import ediyor; ortak yer olmazsa döngüsel import oluşur.

// 'altın' araması 'Altın' kaydını bulmalı. toLocaleUpperCase('tr') tek başına yetmez:
// sorgu 'ALTİN' (noktalı), veri 'ALTIN' (noktasız) olur ve eşleşmez. Burada iki taraf da
// küçük harfe inip Türkçeye özgü harfler ASCII karşılıklarına eşlenir → asimetri imkânsız.
export const trFold = (s) => String(s ?? '').toLocaleLowerCase('tr')
  .replaceAll('ı', 'i').replaceAll('ş', 's').replaceAll('ğ', 'g')
  .replaceAll('ü', 'u').replaceAll('ö', 'o').replaceAll('ç', 'c');

// Alaka puanı (özel araç, endeks, evren, fon ve uzak sonuçlar aynı ölçekte):
// tam kod 3 · kod öneki 2 · ad öneki prefixWeight · adda geçiyor 1 · eşleşme yok 0
// prefixWeight: dar listelerde (özel araç, endeks) ad-öneki ayrımı yapmaz — 0 geçilir.
// 'altın' yazınca 'Altınkılıç Gıda' şirketi, 'Gram Altın' ürününü geçmesin.
export function trScore(code, name, q, { prefixWeight = 1.5 } = {}) {
  const Q = trFold(q).trim();
  if (!Q) return 0;
  const c = trFold(code), n = trFold(name);
  return c === Q ? 3 : c.startsWith(Q) ? 2 : n.startsWith(Q) ? prefixWeight : n.includes(Q) ? 1 : 0;
}

// Arama sıralaması: tam kod → kaynak → puan → sembol.
// Tam kod eşleşmesi her zaman kazanır; kaynak (0 özel araç · 1 endeks · 2 evren · 3 fon · 4 uzak)
// elle seçilmiş dar listeleri geniş evrenden ayırır. Sembol sonu garanti eder ki
// aynı sorgu iki kez aynı sırayı versin. market.js yalnızca çağırır.
export const compareSearchHits = (x, y) => ((y._s === 3) - (x._s === 3))
  || (x._src ?? 9) - (y._src ?? 9)
  || (y._s || 0) - (x._s || 0)
  || String(x.symbol).localeCompare(String(y.symbol));

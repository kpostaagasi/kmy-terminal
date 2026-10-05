// Türkçe sayı girişi: "50.000" → 50000, "50.000,5" → 50000.5, "12,5" → 12.5, "1234.5" → 1234.5. Boş → null, geçersiz → NaN.
export function parseTr(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s+/g, '');
  if (s === '') return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.')); // binlik noktalı
  if (/^-?\d+(,\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return NaN;
}

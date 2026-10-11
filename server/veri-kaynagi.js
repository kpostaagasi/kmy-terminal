// Seçilebilir veri kaynağı katmanı. Her kaynak kimlik, etiket, durum ve kapsamla tanımlanır;
// kullanıcı Ayarlar › Veri'den kaynakları açıp kapatır (settings.dataSources).
export const SOURCES = [
  { id: 'yahoo', label: 'Yahoo Finance', status: 'deneysel/gecikmeli', note: 'Resmî olmayan uç; BIST ~15 dk gecikmeli. Kişisel kullanım.', covers: ['BIST hisse/endeks', 'ABD hisseleri', 'emtia', 'kripto'], default: true },
  { id: 'truncgil', label: 'Truncgil', status: 'resmî değil', covers: ['döviz', 'altın', 'gümüş'], default: true },
  { id: 'goldapi', label: 'gold-api.com', status: 'anlık', covers: ['ons altın'], default: true },
  { id: 'tefas', label: 'TEFAS', status: 'kamu', covers: ['yatırım/emeklilik fonları'], default: true },
];
export const LABEL = { yahoo: 'Yahoo Finance (deneysel/gecikmeli)' };

export function enabledMap(settings = {}) {
  const user = settings.dataSources && typeof settings.dataSources === 'object' ? settings.dataSources : {};
  return Object.fromEntries(SOURCES.map((s) => [s.id, typeof user[s.id] === 'boolean' ? user[s.id] : s.default]));
}
export const isEnabled = (id, settings) => enabledMap(settings)[id] !== false;
export const listSources = (settings) => { const m = enabledMap(settings); return SOURCES.map((s) => ({ ...s, enabled: m[s.id] })); };

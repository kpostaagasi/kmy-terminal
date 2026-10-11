import { enabledMap, isEnabled, listSources, LABEL } from '../server/veri-kaynagi.js';
let ok = 0, bad = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK  ', m); } else { bad++; console.log('FAIL', m); } };
check(Object.values(enabledMap({})).every(Boolean), 'varsayılan: tüm kaynaklar açık');
check(isEnabled('yahoo', { dataSources: { yahoo: false } }) === false, 'yahoo kapatılabilir');
check(isEnabled('yahoo', { dataSources: { yahoo: 'x' } }) === true, 'geçersiz değer varsayılana düşer');
check(listSources({}).find((s) => s.id === 'yahoo').status === 'deneysel/gecikmeli', 'yahoo deneysel/gecikmeli etiketli');
check(/deneysel\/gecikmeli/.test(LABEL.yahoo), 'yahoo fiyat kaynağı etiketi');
console.log(`${ok} geçti, ${bad} başarısız`); process.exit(bad ? 1 : 0);

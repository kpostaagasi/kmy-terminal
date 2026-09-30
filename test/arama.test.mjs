// Arama testleri: Türkçe i/ı katlaması, alaka puanı, kaynak önceliği ve kararlı sıralama.
// Geçici veritabanında çalışır; gerçek data/borsa.db'ye dokunmaz. Ağ yerine önbelleğe veri
// yazılır, böylece sıralama hem çevrimdışı hem tekrarlanabilir test edilir.
// (Enjeksiyon/ayrıştırma testleri test/guvenlik.test.mjs'de.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'borsa-arama-'));
process.env.BORSA_DATA_DIR = dir;

const { db, cachePut } = await import('../server/db.js');
const { trFold, trScore, compareSearchHits } = await import('../server/fold.js');

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const eq = (name, got, want) => check(name, got === want, `${JSON.stringify(got)} (beklenen ${JSON.stringify(want)})`);

// ── Katlama ──────────────────────────────────────────────────────────────────
// 'altın'.toLocaleUpperCase('tr') = 'ALTİN', 'Altın' = 'ALTIN' → altın ürünleri hiç eşleşmiyordu.
eq('Altınkılıç katlanıyor', trFold('Altınkılıç'), 'altinkilic');
eq('Işık → isik', trFold('Işık'), 'isik');
eq('Çeyrek altın katlanıyor', trFold('ÇEYREK ALTIN'), 'ceyrek altin');
eq('null güvenli', trFold(null), '');
eq('undefined güvenli', trFold(undefined), '');
eq('sayı güvenli', trFold(42), '42');
eq('altın/ALTIN aynı kat', trFold('altın'), trFold('ALTIN'));
eq('altın/Altın aynı kat', trFold('altın'), trFold('Altın'));
eq('iç/İÇ aynı kat', trFold('iç'), trFold('İÇ'));
eq('şirket/ŞİRKET aynı kat', trFold('şirket'), trFold('ŞİRKET'));

// ── Puan ölçeği (evren ve fonlar aynı ölçekte) ─────────────────────────────
eq('tam kod 3', trScore('ASELS', 'Aselsan', 'ASELS'), 3);
eq('kod öneki 2', trScore('ASELS', 'Aselsan', 'ase'), 2);
eq('ad öneki 1,5', trScore('XKOLD', 'Koza Altın', 'koza'), 1.5);
eq('adda geçiyor 1', trScore('XKOLD', 'Koza Altın', 'altın'), 1);
eq('eşleşme yok 0', trScore('ASELS', 'Aselsan', 'zzz'), 0);
eq('boş sorgu 0', trScore('ASELS', 'Aselsan', ''), 0);
eq('null kod güvenli', trScore(null, null, 'a'), 0);

// ── Kaynak-duyarlı puan ─────────────────────────────────────────────────────
// Dar liste (özel araç/endeks): ad öneki ayrımı yok, yalnız eşleşme var/yok.
// 'altın' → 'Ata Altın' her iki çağrıda da 1 (adda geçiyor).
eq('dar listede prefixWeight:0 fark yaratmıyor', trScore('ATA', 'Ata Altın', 'altın', { prefixWeight: 0 }), trScore('ATA', 'Ata Altın', 'altın'));
// Sorgu 'altın' — ATA'nın koduyla aynı değil, yalnız adında geçiyor. Sorgu 'ata' olsaydı
// tam kod eşleşmesi 3 dönerdi; dar listede ad öneki ayrımı kapanır, kod eşleşmesi engellenmez.
eq('dar listede ad öneki ayrımı yok', trScore('ATA', 'Ata Altın', 'altın', { prefixWeight: 0 }), 1);
eq('dar listede varsayılan da 1', trScore('ATA', 'Ata Altın', 'altın'), 1);
// Geniş liste (evren/fon): ad öneki ayrımı korunur, prefixWeight:0 kapatır.
eq('geniş listede ad öneki 1,5', trScore('XKOLD', 'Koza Altın', 'koza', { prefixWeight: 0 }), 0);
eq('geniş listede varsayılan ad öneki 1,5', trScore('XKOLD', 'Koza Altın', 'koza'), 1.5);
// Ad öneki ayrımı yalnız ad sorguyla başladığında anlamlı: 'Altın Koza' + 'altın' → ad öneki.
check('geniş listede ad öneki > adda geçiyor', trScore('XKOLD', 'Altın Koza', 'altın') > trScore('XKOLD', 'Altın Koza', 'altın', { prefixWeight: 0 }), '');
// Geriye uyum: üç argümanlı çağrı eski ölçeği birebir verir.
eq('3 argüman boş sorgu 0', trScore('ASELS', 'Aselsan', ''), 0);
eq('3 argüman tam kod 3', trScore('ASELS', 'Aselsan', 'ASELS'), 3);

// ── compareSearchHits birim testi ──────────────────────────────────────────
const hit = (symbol, s, src) => ({ symbol, _s: s, _src: src });
const srt = (a) => [...a].sort(compareSearchHits).map((h) => h.symbol).join(',');
eq('tam kod her şeyi yener', srt([hit('AAA', 1, 0), hit('BBB', 3, 2), hit('CCC', 2, 0)]), 'BBB,CCC,AAA');
eq('eşit puanda dar kaynak önce', srt([hit('EVN', 1, 2), hit('OZL', 1, 0), hit('FND', 1, 3)]), 'OZL,EVN,FND');
eq('aynı kaynakta puan azalan', srt([hit('B', 1, 2), hit('A', 2, 2)]), 'A,B');
eq('eşitlikte sembol kararlı', srt([hit('ZZZ', 1, 2), hit('AAA', 1, 2)]), 'AAA,ZZZ');


// ── Önbelleğe evren + fon listesi yaz (ağ yok) ──────────────────────────────
const now = Date.now();
const stocks = {
  ASELS: { code: 'ASELS', name: 'Aselsan Elektronik', sector: 'Teknoloji', mcapTL: 300e9 },
  OBASE: { code: 'OBASE', name: 'Obase Otomotiv', sector: 'Otomotiv', mcapTL: 20e9 },
  THYAO: { code: 'THYAO', name: 'Türk Hava Yolları', sector: 'Ulaştırma', mcapTL: 400e9 },
  KOLD: { code: 'KOLD', name: 'Koza Altın İşletmeleri', sector: 'Metal', mcapTL: 60e9 },
};
cachePut('isy:all', { stocks, actions: [], at: now });
const funds = [
  { code: 'AFT', name: 'Altın Fonu (A)' },
  { code: 'BFT', name: 'Birikim Fonu' },
  { code: 'CFT', name: 'Kısa Vadeli Serbest Fon' },
];
cachePut('tefas:list', funds);

const { search, SPECIAL, INDICES } = await import('../server/market.js');
const syms = (r) => r.map((x) => x.symbol);
// Yahoo sonuçları ağdan gelir ve kararsızdır; katlama/puan kontrolleri yalnız yerel kaynaklara bakar.
// Yerel semboller nokta içermez (fromYahoo her Yahoo sonucunu "KOD.PAZAR" biçimine çevirir).
const localSyms = async (q) => syms(await search(q)).filter((s) => !s.includes('.'));

// ── Katlama canlı: altın ────────────────────────────────────────────────────
const gold = await localSyms('altın');
check('altın → GRAM', gold.includes('GRAM'), gold.join(','));
check('altın → CEYREK', gold.includes('CEYREK'), gold.join(','));
eq('ALTIN aynı sonuç kümesi', (await localSyms('ALTIN')).join(','), gold.join(','));
eq('altın (noktasız ı) aynı sonuç kümesi', (await localSyms('altın')).join(','), gold.join(','));
eq('Altın aynı sonuç kümesi', (await localSyms('Altın')).join(','), gold.join(','));
check('altın 6+ ürün döndürüyor (eskiden 0)', gold.length >= 6, String(gold.length));

// ── Katlama canlı: ş/ç/ğ ───────────────────────────────────────────────────
eq('içerik/İÇERİK aynı', (await localSyms('içerik')).join(','), (await localSyms('İÇERİK')).join(','));
eq('şirket/ŞİRKET aynı', (await localSyms('şirket')).join(','), (await localSyms('ŞİRKET')).join(','));

// ── Puanlı sıralama ─────────────────────────────────────────────────────────
// 'ase': ASELS kod öneki (2), OBASE yalnız adda geçiyor (1) → ASELS önde.
const ase = await localSyms('ase');
eq('"ase" ilk sıra ASELS', ase[0], 'ASELS');
check('"ase" OBASE\'i de getiriyor', ase.includes('OBASE'), ase.join(','));
check('"ase" OBASE ASELS\'ten sonra', ase.indexOf('OBASE') > ase.indexOf('ASELS'), ase.join(','));

// Fon kaynağı: 'altın' AFT'in adında geçiyor (puan 1) → TEFAS sonucu listede.
check('fon adı araması AFT\'i buluyor', gold.includes('AFT'), gold.join(','));
eq('fon kodundan arama tam eşleşmeyi üste alıyor', (await localSyms('AFT'))[0], 'AFT');

// Sonuç temizliği ve sınır.
check('altın listesi 15 ile sınırlı', (await search('altın')).length <= 15, String((await search('altın')).length));
check('sonuçlarda _s/_src sızmıyor', !JSON.stringify(await search('altın')).includes('_s'));

// ── Determinizm (yalnız yerel kaynaklar; Yahoo sırası ağa bağlı) ────────────
for (const q of ['altın', 'ase', 'thya']) {
  const a = (await localSyms(q)).join(','), b = (await localSyms(q)).join(',');
  eq(`"${q}" iki kez aynı sırayı döndürüyor`, a, b);
}

// ── Sıralama: altın ürünleri hisse şirketlerinden önce ────────────────────
const narrowSet = new Set([...Object.keys(SPECIAL), ...INDICES]);
const goldRaw = (await search('altın')).filter((x) => !x.symbol.includes('.'));
check('altın ilk 3 sonuç özel araç/endeks', goldRaw.slice(0, 3).every((x) => narrowSet.has(x.symbol)),
  goldRaw.slice(0, 3).map((x) => x.symbol).join(','));
for (const g of ['ATA', 'CEYREK', 'CUMHURIYET', 'GRAM', 'HAS', 'ONS', 'TAM']) {
  const i = goldRaw.findIndex((x) => x.symbol === g);
  const firstStock = goldRaw.findIndex((x) => !narrowSet.has(x.symbol));
  check(`altın: ${g} hisselerden önce`, i !== -1 && (firstStock === -1 || i < firstStock), goldRaw.map((x) => x.symbol).join(','));
}

// ── Tam kod eşleşmesi kazanır ──────────────────────────────────────────────
eq('"THYAO" ilk sıra THYAO', (await localSyms('THYAO'))[0], 'THYAO');
eq('"thyao" ilk sıra THYAO (katlama)', (await localSyms('thyao'))[0], 'THYAO');
eq('"thya" ilk sıra THYAO', (await localSyms('thya'))[0], 'THYAO');
eq('THYAO puanı tam kod 3', trScore('THYAO', 'Türk Hava Yolları', 'THYAO'), 3);

db.close();
console.log(`\n${fail === 0 ? 'TAMAMI GEÇTİ' : 'BAŞARISIZ'}: ${pass} geçti, ${fail} kaldı`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

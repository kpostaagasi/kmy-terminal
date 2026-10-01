# Veri doğruluğu denetimi — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run denetim` komutuyla uygulamanın gösterdiği verileri bağımsız ikinci kaynaklarla canlı karşılaştırmak, bulunan sapmaları düzeltmek ve 0.16.4 olarak yayımlamak.

**Architecture:** İki dosya. `scripts/denetim-cekirdek.mjs` saf (ağsız, veritabansız) karşılaştırma/karar/rapor mantığıdır ve çevrimdışı test edilir. `scripts/veri-denetimi.mjs` canlı kaynakları çeker; gerçek veriye dokunmamak için kendini geçici `BORSA_DATA_DIR` ile yeniden başlatır (portföy modunda gerçek veritabanının *kopyası* üzerinde çalışır). Spec'teki "tek dosya" kararı, saf mantığı çevrimdışı test edebilmek için ikiye bölündü.

**Tech Stack:** Node 22.13+ (ESM, `node:sqlite`, yerleşik `fetch`), mevcut `server/*.js` modülleri. Yeni bağımlılık yok.

**Spec:** [docs/superpowers/specs/2026-10-01-veri-denetimi-design.md](../specs/2026-10-01-veri-denetimi-design.md)

## Global Constraints

- Ürün adı her zaman küçük harfle: **kmy terminal**. Rakip adı hiçbir dosyada, çıktıda ya da notta geçmez.
- Kişisel veri git'e ve denetim çıktısına girmez (portföy kontrolünde tutar değil, yalnız durum ve sapma yüzdesi yazılır).
- Denetim geçici `BORSA_DATA_DIR` kullanır; gerçek veriye yazmaz.
- `npm test` zincirine canlı denetim eklenmez (ağ gerektirir); zincire yalnız çevrimdışı `test/denetim.test.mjs` girer.
- Yeni bağımlılık yok; Node 22.13+.
- Repo komut/commit stili: Türkçe mesaj; her commit şu satırla biter: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tolerans değerleri (spec): döviz %0,5 · gram altın %1 · altın türleri %3 · hisse %1,5 · TEFAS tam eşleşme · temel oranlar %0,5 · portföy %0,1.
- Çıkış kodu: 0 temiz, 1 SAPMA var, 2 hiçbir şey doğrulanamadı.

## Review Focus

Spec'in söylemediği ama kullanıcıyı ilk ısıracak durumlar (en olasıdan başlayarak):

1. **Ağ yok / kaynak 5xx:** kontrol SAPMA değil ATLANDI olmalı; *hepsi* ATLANDI ise çıkış kodu 2 (sahte yeşil yok). → Task 1: `guard`, `cikisKodu` testleri.
2. **Referans değer eksik, 0 veya NaN:** sıfıra bölme ve `null * x = 0` tuzağı olmamalı. → Task 1: `karsilastir`, `gramRef` testleri.
3. **Seans açıkken hisse kontrolü:** İş Yatırım kapanışı gün içi fiyatla karşılaştırılırsa yalancı SAPMA çıkar. → Task 1: `hisseKarar` testleri.
4. **Boş portföy, eksik kur, nakit takibi kapalı:** çökmemeli, yalancı SAPMA vermemeli. → Task 1: `portfoyKarar` testleri.
5. **Banka, 12 aylık zarar, evrende olmayan hisse, İş Yatırım'ın F/K yuvarlaması (1 ondalık):** FAVÖK/F/K ATLANDI ya da yuvarlama payıyla OK olmalı. → Task 1: `temelKarar` testleri.

---

## Dosya yapısı

| Dosya | Sorumluluk |
|---|---|
| `scripts/denetim-cekirdek.mjs` (yeni) | Saf mantık: `karsilastir`, `guard`, `gramRef`, `hisseKarar`, `etiketKarar`, `temelKarar`, `portfoyKarar`, `rapor`, `cikisKodu`, sabitler |
| `scripts/veri-denetimi.mjs` (yeni) | Canlı çalıştırıcı: geçici veri klasörü, kaynak çekme, kontrolleri çağırma, çıktı |
| `test/denetim.test.mjs` (yeni) | Çekirdeğin çevrimdışı testi |
| `package.json` (değişir) | `denetim` betiği, `test` zincirine `denetim.test.mjs` |
| `README.md`, `CHANGELOG.md`, spec (değişir) | Belge |

---

### Task 1: Saf çekirdek ve çevrimdışı test

**Files:**
- Create: `test/denetim.test.mjs`
- Create: `scripts/denetim-cekirdek.mjs`
- Modify: `package.json` (`scripts.test`, yeni `scripts.denetim`)

**Interfaces:**
- Produces (Task 2'nin kullandığı, tam imzalar):
  - `TOLERANS: { fx, gram, altinTuru, hisse, tefas, oran, portfoy }` (sayı, %)
  - `SAF_GR: { CEYREK, YARIM, TAM }` (saf gram)
  - `karsilastir(app, ref, tolPct) → { durum: 'OK'|'SAPMA'|'ATLANDI', sapmaPct?, neden?, app, ref }`
  - `guard(fn: () => Promise<result>) → Promise<result>` (hata → `{ durum: 'ATLANDI', neden }`)
  - `gramRef(onsUsd, usdTry) → number | null`
  - `hisseKarar({ app, ref, seansAcik }) → result`
  - `etiketKarar(q, beklenenGecikmeli: boolean, maxYasMs?: number | null, simdi?: number) → result`
  - `temelKarar(financialsOut, universeStock | null) → Array<{ ad, ...result }>`
  - `portfoyKarar(summaryOut | null) → Array<{ ad, ...result }>`
  - `rapor(sonuc[]) → string`, `cikisKodu(sonuc[]) → 0 | 1 | 2`
  - Sonuç satırı biçimi: `{ grup, ad, durum, sapmaPct?, app?, ref?, neden? }`

- [ ] **Step 1: Başarısız testi yaz**

`test/denetim.test.mjs` dosyasını şu içerikle oluştur:

```js
// Veri denetimi çekirdeği: çevrimdışı, ağsız, veritabansız.
import * as K from '../scripts/denetim-cekirdek.mjs';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const durum = (r) => r.durum;

// ── karsilastir ───────────────────────────────────────────────────────────
assert('eşit değer OK', durum(K.karsilastir(100, 100, 0.5)) === 'OK');
assert('tolerans içi OK', durum(K.karsilastir(100.4, 100, 0.5)) === 'OK');
assert('tolerans dışı SAPMA', durum(K.karsilastir(101, 100, 0.5)) === 'SAPMA');
assert('sapma yüzdesi doğru', Math.abs(K.karsilastir(101, 100, 0.5).sapmaPct - 1) < 1e-9);
// Review Focus: eksik/geçersiz girdi çökmez, SAPMA da üretmez.
assert('null app ATLANDI', durum(K.karsilastir(null, 100, 1)) === 'ATLANDI');
assert('NaN ref ATLANDI', durum(K.karsilastir(100, NaN, 1)) === 'ATLANDI');
assert('undefined ATLANDI', durum(K.karsilastir(undefined, undefined, 1)) === 'ATLANDI');
assert('ref 0, app 0 → OK', durum(K.karsilastir(0, 0, 1)) === 'OK');
assert('ref 0, app ≠ 0 → SAPMA (sıfıra bölme yok)', durum(K.karsilastir(5, 0, 1)) === 'SAPMA');

// ── guard: kaynak hatası ATLANDI'dır ──────────────────────────────────────
const g = await K.guard(async () => { throw new Error('ağ yok'); });
assert('guard hata → ATLANDI', g.durum === 'ATLANDI' && g.neden.includes('ağ yok'));
assert('guard sonucu aynen geçirir', (await K.guard(async () => ({ durum: 'OK' }))).durum === 'OK');

// ── gramRef / altın sabitleri ─────────────────────────────────────────────
// 4.000 $ ons × 40 TL = 160.000 TL ÷ 31,1034768 ≈ 5.144,12 TL/gr
assert('gramRef hesabı', Math.abs(K.gramRef(4000, 40) - 5144.12) < 0.01, String(K.gramRef(4000, 40)));
assert('gramRef eksik girdi null', K.gramRef(null, 40) === null && K.gramRef(4000, undefined) === null);
assert('çeyrek saf gram 1,6067', Math.abs(K.SAF_GR.CEYREK - 1.6067) < 1e-3);
assert('yarım = 2 çeyrek, tam = 4 çeyrek', Math.abs(K.SAF_GR.YARIM - 2 * K.SAF_GR.CEYREK) < 1e-9 && Math.abs(K.SAF_GR.TAM - 4 * K.SAF_GR.CEYREK) < 1e-9);

// ── hisseKarar ────────────────────────────────────────────────────────────
// Review Focus: seans açık / hafta sonu-tatil karışıklığı.
assert('seans açık → ATLANDI', durum(K.hisseKarar({ app: 300, ref: 250, seansAcik: true })) === 'ATLANDI');
assert('kapalı, %3 sapma → SAPMA', durum(K.hisseKarar({ app: 103, ref: 100, seansAcik: false })) === 'SAPMA');
assert('kapalı, %0,2 sapma → OK', durum(K.hisseKarar({ app: 100.2, ref: 100, seansAcik: false })) === 'OK');
assert('kapalı, ref yok → ATLANDI', durum(K.hisseKarar({ app: 100, ref: null, seansAcik: false })) === 'ATLANDI');

// ── etiketKarar ───────────────────────────────────────────────────────────
const NOW = 1_000_000_000_000;
assert('canlı fiyat, delayed=false → OK', durum(K.etiketKarar({ delayed: false, time: NOW - 60_000 }, false, 30 * 60_000, NOW)) === 'OK');
assert('gecikmeli olması gereken canlı etiketli → SAPMA', durum(K.etiketKarar({ delayed: false, time: NOW }, true, null, NOW)) === 'SAPMA');
assert('eski veri → SAPMA', durum(K.etiketKarar({ delayed: false, time: NOW - 3_600_000 }, false, 30 * 60_000, NOW)) === 'SAPMA');
assert('yaş sınırı yoksa eski veri OK', durum(K.etiketKarar({ delayed: true, time: NOW - 9e8 }, true, null, NOW)) === 'OK');
assert('fiyat yok → ATLANDI', durum(K.etiketKarar(null, false)) === 'ATLANDI');

// ── temelKarar ────────────────────────────────────────────────────────────
// 0.16.1 FAVÖK hatasının kanıtı (TUPRS 2026/6): 3H 62.373.927.000 + 4B 8.872.312.000 = 71.246.239.000;
// eski 3DF tabanlı hesap 67.898 mn veriyordu.
const items = [
  { code: '3H', value: 62_373_927_000 }, { code: '4B', value: 8_872_312_000 }, { code: '3Z', value: 10_000_000_000 },
];
const fOk = {
  type: 'sanayi', latest: '2026/6', lastPeriodItems: items,
  cumulative: [{ ebitda: 71_246_239_000, netIncome: 10_000_000_000 }],
  quarterly: [2.5e9, 2.5e9, 2.5e9, 2.5e9].map((netIncome) => ({ netIncome })),
};
const st = { pe: 8, mcapTL: 80_000_000_000, period: '2026/6' }; // 80 mlr ÷ 10 mlr = 8
const tOk = K.temelKarar(fOk, st);
assert('doğru FAVÖK OK', tOk.find((r) => r.ad === 'FAVÖK').durum === 'OK');
assert('doğru net kâr OK', tOk.find((r) => r.ad === 'Net kâr').durum === 'OK');
assert('doğru F/K OK', tOk.find((r) => r.ad === 'F/K').durum === 'OK');
// İş Yatırım F/K'yı 1 ondalığa yuvarlar: 3,0 ↔ 2,97 gerçek sapma değil.
const peOf = (pe, mcapTL) => K.temelKarar(fOk, { pe, mcapTL }).find((r) => r.ad === 'F/K').durum;
assert('yuvarlama farkı (3,0 ↔ 2,97) OK', peOf(3.0, 29_700_000_000) === 'OK');
assert('gerçek F/K sapması (12 ↔ 8) SAPMA', peOf(12, 80_000_000_000) === 'SAPMA');
const tBad = K.temelKarar({ ...fOk, cumulative: [{ ebitda: 67_898_000_000, netIncome: 10_000_000_000 }] }, st);
assert('eski 3DF tabanlı FAVÖK SAPMA yakalanır', tBad.find((r) => r.ad === 'FAVÖK').durum === 'SAPMA');
// Review Focus: banka ve zarar eden şirket.
const tBank = K.temelKarar({ ...fOk, type: 'banka' }, st);
assert('banka FAVÖK ATLANDI', tBank.find((r) => r.ad === 'FAVÖK').durum === 'ATLANDI');
const tLoss = K.temelKarar({ ...fOk, quarterly: [-1e9, -1e9, -1e9, -1e9].map((netIncome) => ({ netIncome })) }, st);
assert('12 aylık zarar → F/K ATLANDI', tLoss.find((r) => r.ad === 'F/K').durum === 'ATLANDI');
const tNull = K.temelKarar({ ...fOk, quarterly: [{ netIncome: 1 }, { netIncome: null }, { netIncome: 1 }, { netIncome: 1 }] }, st);
assert('eksik çeyrek → F/K ATLANDI', tNull.find((r) => r.ad === 'F/K').durum === 'ATLANDI');
assert('ham satır yok → FAVÖK ATLANDI', K.temelKarar({ ...fOk, lastPeriodItems: [] }, st).find((r) => r.ad === 'FAVÖK').durum === 'ATLANDI');
assert('evrende olmayan hisse (st null) çökmez', K.temelKarar(fOk, null).find((r) => r.ad === 'F/K').durum === 'ATLANDI');

// ── portfoyKarar ──────────────────────────────────────────────────────────
const S = {
  fx: { TRY: 1, USD: 40 },
  holdings: [
    { qty: 100, price: 300, currency: 'TRY', value: 30_000 },
    { qty: 2, price: 200, currency: 'USD', value: 16_000 },
  ],
  positions: [{ value: 30_000 }, { value: 16_000 }],
  cash: [{ valueTRY: 4_000 }],
  totals: { holdingsValue: 46_000, value: 50_000, cash: 4_000 },
};
assert('tutarlı portföy tamamı OK', K.portfoyKarar(S).every((r) => r.durum === 'OK'), K.portfoyKarar(S).map(durum).join());
// Review Focus: boş portföy çökmez.
assert('boş portföy ATLANDI', K.portfoyKarar({ holdings: [], totals: {} })[0].durum === 'ATLANDI');
assert('özet yok (null) ATLANDI', K.portfoyKarar(null)[0].durum === 'ATLANDI');
const bozuk = { ...S, totals: { ...S.totals, holdingsValue: 40_000 } };
assert('toplam bileşenlerle uyuşmazsa SAPMA', K.portfoyKarar(bozuk).some((r) => r.durum === 'SAPMA'));
const nakitsiz = { ...S, totals: { ...S.totals, value: 46_000, cash: null } };
assert('nakit takibi kapalıyken nakit toplanmaz', K.portfoyKarar(nakitsiz).find((r) => r.ad === 'Toplam değer').durum === 'OK');
const eksikKur = { ...S, holdings: [{ ...S.holdings[0] }, { ...S.holdings[1], missingFx: true }] };
assert('eksik kurda platform toplamı ATLANDI', K.portfoyKarar(eksikKur).find((r) => r.ad === 'Σ platform değeri').durum === 'ATLANDI');

// ── rapor / cikisKodu ─────────────────────────────────────────────────────
const R = (d) => ({ grup: 'G', ad: 'a', durum: d });
assert('SAPMA varsa çıkış 1', K.cikisKodu([R('OK'), R('SAPMA')]) === 1);
assert('hepsi ATLANDI ise çıkış 2 (sahte yeşil yok)', K.cikisKodu([R('ATLANDI'), R('ATLANDI')]) === 2);
assert('boş sonuç çıkış 2', K.cikisKodu([]) === 2);
assert('OK + ATLANDI çıkış 0', K.cikisKodu([R('OK'), R('ATLANDI')]) === 0);
const metin = K.rapor([{ grup: 'Döviz', ad: 'USDTRY', durum: 'OK', sapmaPct: 0.1234, app: 41.5, ref: 41.45 }, R('SAPMA')]);
assert('rapor özet satırı', metin.endsWith('OK 1 · SAPMA 1 · ATLANDI 0'), metin.split('\n').at(-1));
assert('rapor yüzde biçimi', metin.includes('%0.123'));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `node test/denetim.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/denetim-cekirdek.mjs'` (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Çekirdeği yaz**

`scripts/denetim-cekirdek.mjs` dosyasını şu içerikle oluştur:

```js
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

/** BIST fiyatı: seans açıkken İş Yatırım kapanışıyla karşılaştırılamaz. */
export function hisseKarar({ app, ref, seansAcik }) {
  if (seansAcik) return { durum: 'ATLANDI', neden: 'seans açık; kapanış değeri karşılaştırılamaz', app: app ?? null, ref: ref ?? null };
  return karsilastir(app, ref, TOLERANS.hisse);
}

/** Fiyat nesnesinin gecikme etiketi ve (verildiyse) yaşı beklentiye uyuyor mu? */
export function etiketKarar(q, beklenenGecikmeli, maxYasMs = null, simdi = Date.now()) {
  if (!q) return { durum: 'ATLANDI', neden: 'fiyat yok' };
  if (Boolean(q.delayed) !== beklenenGecikmeli) return { durum: 'SAPMA', neden: `delayed=${Boolean(q.delayed)}, beklenen ${beklenenGecikmeli}` };
  const yas = simdi - q.time;
  if (maxYasMs != null && sayi(yas) && yas > maxYasMs) return { durum: 'SAPMA', neden: `veri ${Math.round(yas / 60_000)} dk eski` };
  return { durum: 'OK' };
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
  else {
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
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Run: `node test/denetim.test.mjs`
Expected: son satır `47 geçti, 0 başarısız`, çıkış kodu 0, hiç `FAIL` satırı yok.

- [ ] **Step 5: `package.json` betiklerini güncelle**

`scripts` bölümünde `test` satırını şununla değiştir (sonuna `&& node test/denetim.test.mjs` eklenir) ve `test`'ten sonra `denetim` satırını ekle:

```json
    "test": "node test/portfoy.test.mjs && node test/guvenlik.test.mjs && node test/arama.test.mjs && node test/simulasyon.mjs && node test/denetim.test.mjs",
    "denetim": "node scripts/veri-denetimi.mjs",
```

- [ ] **Step 6: Tüm testlerin yeşil kaldığını doğrula**

Run: `npm test 2>&1 | tail -5`
Expected: son test dosyası `47 geçti, 0 başarısız` yazdırır; `npm test` çıkış kodu 0 (`echo $?` → 0).

- [ ] **Step 7: Commit**

```bash
git add test/denetim.test.mjs scripts/denetim-cekirdek.mjs package.json
git commit -m "Veri denetimi: saf çekirdek ve çevrimdışı testler

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Canlı çalıştırıcı

**Files:**
- Create: `scripts/veri-denetimi.mjs`

**Interfaces:**
- Consumes: Task 1'in tüm dışa aktarımları (`@@` imzalar yukarıda); uygulamadan `getQuotes(symbols) → { [sym]: quote }`, `marketStatus() → { open, label, holiday? }` (`server/market.js`), `universe.refresh()`, `universe.stock(code)` (`server/universe.js`), `tcmbRates() → { date, rates: { USD: { forexBuying, forexSelling, … } } }`, `financials(symbol, n)` (`server/feeds.js`), `summary()` (`server/portfolio.js`, yalnız `--portfoy`).
- Produces: `npm run denetim [-- --portfoy] [-- --json]`; stdout: rapor tablosu ya da JSON dizisi; çıkış kodu 0/1/2.

- [ ] **Step 1: Çalıştırıcıyı yaz**

`scripts/veri-denetimi.mjs` dosyasını şu içerikle oluştur:

```js
// Canlı çapraz kaynak denetimi: uygulamanın gösterdiği veriyi bağımsız ikinci kaynakla karşılaştırır.
// Kullanım: npm run denetim [-- --portfoy] [-- --json]
// Çıkış: 0 temiz · 1 SAPMA var · 2 hiçbir şey doğrulanamadı. Gerçek veriye yazmaz.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);

// Evre 1: kendini geçici veri klasörüyle yeniden başlat (sunucu modülleri veritabanını içe aktarırken açar).
// --portfoy: gerçek veritabanının KOPYASI üzerinde çalışılır; özgün dosyaya dokunulmaz.
if (!process.env.DENETIM_ALT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmy-denetim-'));
  if (flag('--portfoy')) {
    const { DATA_DIR } = await import('../server/paths.js');
    for (const ek of ['', '-wal', '-shm']) {
      const src = path.join(DATA_DIR, `borsa.db${ek}`);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, `borsa.db${ek}`));
    }
  }
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: 'inherit', env: { ...process.env, BORSA_DATA_DIR: tmp, DENETIM_ALT: '1' } });
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(r.status ?? 2);
}

// Evre 2: kontroller.
const K = await import('./denetim-cekirdek.mjs');
const { getQuotes, marketStatus } = await import('../server/market.js');
const universe = await import('../server/universe.js');
const { tcmbRates, financials } = await import('../server/feeds.js');

const sonuc = [];
const ekle = (grup, ad, r) => sonuc.push({ grup, ...r, ad });
const dene = async (grup, ad, fn) => ekle(grup, ad, await K.guard(fn));

const seans = marketStatus();
const dk = 60_000;
const SEMBOLLER = ['USDTRY', 'EURTRY', 'GRAM', 'ONS', 'CEYREK', 'YARIM', 'TAM'];
const HISSELER = ['THYAO', 'ASELS', 'GARAN', 'BIMAS', 'TUPRS'];
const FONLAR = ['TTE', 'AFT'];
const q = await getQuotes([...SEMBOLLER, ...HISSELER, ...FONLAR]).catch(() => ({}));
const fiyat = (s) => q[s]?.price;

// Döviz: TCMB gösterge kuru (alış/satış ortası).
const tcmb = await tcmbRates().catch(() => null);
const tcmbOrta = (kod) => { const r = tcmb?.rates?.[kod]; return r ? (r.forexBuying + r.forexSelling) / 2 : null; };
for (const [s, kod] of [['USDTRY', 'USD'], ['EURTRY', 'EUR']]) {
  await dene('Döviz', s, async () => K.karsilastir(fiyat(s), tcmbOrta(kod), K.TOLERANS.fx));
}

// Altın: ons × kur ÷ 31,1035 ve geleneksel altınların saf gram karşılığı.
const gram = K.gramRef(fiyat('ONS'), fiyat('USDTRY'));
await dene('Altın', 'GRAM', async () => K.karsilastir(fiyat('GRAM'), gram, K.TOLERANS.gram));
for (const s of Object.keys(K.SAF_GR)) {
  await dene('Altın türü', s, async () => K.karsilastir(fiyat(s), gram == null ? null : gram * K.SAF_GR[s], K.TOLERANS.altinTuru));
}

// Hisse: Yahoo (uygulama) ↔ İş Yatırım kapanışı.
await universe.refresh().catch(() => {});
for (const s of HISSELER) {
  await dene('Hisse', s, async () => K.hisseKarar({ app: fiyat(s), ref: universe.stock(s)?.close, seansAcik: seans.open }));
}

// TEFAS: uygulamanın fiyatı ↔ TEFAS API'sinden doğrudan çekilen son fiyat.
async function tefasSon(kod) {
  const res = await fetch('https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir', {
    method: 'POST', body: JSON.stringify({ fonKodu: kod, dil: 'TR', periyod: 1 }), signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`TEFAS HTTP ${res.status}`);
  const rows = ((await res.json()).resultList || []).filter((r) => r.fiyat > 0 && r.tarih).sort((a, b) => a.tarih.localeCompare(b.tarih));
  return rows.at(-1)?.fiyat ?? null;
}
for (const s of FONLAR) {
  await dene('TEFAS', s, async () => K.karsilastir(fiyat(s), await tefasSon(s), K.TOLERANS.tefas));
}

// Tazelik: gecikme etiketi ve yaş. Kapalı piyasada eski veri normaldir, yaş sınırı uygulanmaz.
const hafta = seans.label.startsWith('Hafta sonu') || Boolean(seans.holiday);
await dene('Tazelik', 'USDTRY', async () => K.etiketKarar(q.USDTRY, false, hafta ? null : 30 * dk));
await dene('Tazelik', 'GRAM', async () => K.etiketKarar(q.GRAM, false, hafta ? null : 30 * dk));
await dene('Tazelik', 'THYAO', async () => K.etiketKarar(q.THYAO, true, seans.open ? 30 * dk : null));
for (const s of FONLAR) await dene('Tazelik', s, async () => K.etiketKarar(q[s], true, 10 * 24 * 60 * dk));

// Temel oranlar: mali tablonun ham satırlarından yeniden hesap (GARAN banka: FAVÖK atlanır).
for (const s of ['TUPRS', 'THYAO', 'ASELS', 'GARAN']) {
  let f;
  try { f = await financials(s, 8); } catch (e) { ekle('Temel', s, { durum: 'ATLANDI', neden: e.message }); continue; }
  for (const r of K.temelKarar(f, universe.stock(s))) ekle('Temel', `${s} ${r.ad}`, r);
}

// Portföy: toplamlar bileşenlerden yeniden toplanır (gerçek veritabanının kopyasında).
if (flag('--portfoy')) {
  const pf = await import('../server/portfolio.js');
  const s = await pf.summary().catch(() => null);
  // Kişisel tutarlar çıktıya yazılmaz; yalnız durum ve sapma yüzdesi.
  for (const r of K.portfoyKarar(s)) ekle('Portföy', r.ad, { ...r, app: null, ref: null });
}

console.log(flag('--json') ? JSON.stringify(sonuc, null, 2) : K.rapor(sonuc));
process.exit(K.cikisKodu(sonuc));
```

- [ ] **Step 2: Sözdizimini doğrula**

Run: `node --check scripts/veri-denetimi.mjs`
Expected: çıktı yok, çıkış kodu 0.

- [ ] **Step 3: Canlı çalıştır (ağ açık)**

Run: `node scripts/veri-denetimi.mjs 2>/dev/null; echo "çıkış=$?"`
Expected: Döviz, Altın, Altın türü, Hisse, TEFAS, Tazelik, Temel gruplarının satırları; son satır `OK n · SAPMA m · ATLANDI k`; `çıkış=0` (SAPMA yoksa) ya da `çıkış=1`. Planı yazarken (2026-10-01) sonuç `OK 28 · SAPMA 0 · ATLANDI 2` idi (ATLANDI: ASELS F/K — İş Yatırım değeri yok; GARAN FAVÖK — banka). Seans açıkken Hisse satırları ATLANDI olur, bu normaldir.

- [ ] **Step 4: Satır adlarının doğru yazıldığını doğrula**

Run: `node scripts/veri-denetimi.mjs 2>/dev/null | grep "^Temel" | head -3`
Expected: ad sütunu sembol önekini içerir: `Temel | TUPRS FAVÖK | …` (yalnız `FAVÖK` yazıyorsa `ekle` içinde `...r` sonda kalmış demektir; sıra `{ grup, ...r, ad }` olmalı).

- [ ] **Step 5: `--json` çıktısının geçerli olduğunu doğrula**

Run: `node scripts/veri-denetimi.mjs --json 2>/dev/null | node -e "const a=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(Array.isArray(a), a.length)"`
Expected: `true` ve 25'ten büyük bir sayı.

- [ ] **Step 6: Portföy modunu ve gizliliği doğrula**

Run: `node scripts/veri-denetimi.mjs --portfoy 2>/dev/null | grep "^Portföy"`
Expected: üç satır (`Σ pozisyon değeri`, `Σ platform değeri`, `Toplam değer`); app ve ref sütunları `-` (tutar yok), durum OK ya da SAPMA. Gerçek veritabanının değişmediğini doğrula: `ls -l "$HOME/Library/Application Support/kmy terminal/data/borsa.db"` komutunun değişiklik zamanı denetim öncesindekiyle aynı olmalı (denetim kopya üzerinde çalışır).

- [ ] **Step 7: Depoda yalnız beklenen dosya değiştiğini doğrula**

Run: `git status --short`
Expected: yalnız `?? scripts/veri-denetimi.mjs` (veri klasörü ve `data/` git'te yok).

- [ ] **Step 8: Commit**

```bash
git add scripts/veri-denetimi.mjs
git commit -m "Veri denetimi: canlı çapraz kaynak çalıştırıcısı (npm run denetim)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sapma değerlendirmesi, belge ve 0.16.4

**Files:**
- Modify: ilk çalıştırmada bulunan sapmaların kök neden dosyaları (önceden bilinmez), ilgili test dosyaları
- Modify: `README.md`, `CHANGELOG.md`, `package.json` (sürüm), `docs/superpowers/specs/2026-10-01-veri-denetimi-design.md`

**Interfaces:**
- Consumes: Task 2'nin `npm run denetim -- --portfoy` çıktısı.
- Produces: 0.16.4 sürüm commit'i.

- [ ] **Step 1: Tam denetimi çalıştır ve sonucu kaydet**

Run: `npm run denetim -- --portfoy 2>/dev/null`
Expected: rapor tablosu. SAPMA satırlarını not et (hiç yoksa Step 3'e geç).

- [ ] **Step 2: Her SAPMA'yı sınıflandır ve çöz**

Her SAPMA satırı için sırayla:
1. `superpowers:systematic-debugging` ile kök nedeni bul. Önce *denetimin* mi *uygulamanın* mı yanlış olduğunu belirle (ör. İş Yatırım'ın F/K yuvarlaması denetim hatasıydı).
2. Denetim hatasıysa (yalancı SAPMA): tolerans ya da referans mantığını `scripts/denetim-cekirdek.mjs` içinde düzelt ve `test/denetim.test.mjs`'e o durumu pinleyen bir test ekle.
3. Uygulama hatasıysa: düzeltmeyi *ortak fonksiyonda* yap (aynı fonksiyonu çağıran tüm yollar düzelsin); çevrimdışı regresyon testini ilgili dosyaya ekle (`test/portfoy.test.mjs` ya da `test/simulasyon.mjs` portföy için, `test/arama.test.mjs` arama için, aksi halde `test/denetim.test.mjs`). Önce testin başarısız olduğunu gör, sonra düzelt.
4. Her çözüm ayrı commit: `git commit -m "Düzeltme: <ne>" ` + `Co-Authored-By` satırı.

Çözülemeyen ya da bilinçle bırakılan sapma varsa gerekçesiyle Step 5'teki CHANGELOG girdisine "Bilinen" başlığı altında yazılır.

- [ ] **Step 3: README'ye denetim bölümünü ekle ve test sayısını güncelle**

`README.md`'de "Portföy hesaplarını ve güvenlik sınırlarını doğrulamak için: `npm test` (…)" paragrafının hemen altına ekle:

```markdown
Verinin doğruluğunu canlı kaynaklara karşı denetlemek için: `npm run denetim` (ağ gerekir; `npm test` zincirinde değildir). Döviz (TCMB), gram altın (ons × kur), altın türleri, hisse fiyatı (İş Yatırım), TEFAS fon fiyatı, gecikme etiketleri ve temel oranlar (FAVÖK, net kâr, F/K; mali tablo ham satırlarından yeniden hesap) ikinci bir kaynakla karşılaştırılır. `-- --portfoy` portföy toplamlarını gerçek veritabanının **kopyasında** yeniden toplar; çıktıya tutar yazılmaz. `-- --json` makine okunur çıktı verir. Çıkış kodu: 0 temiz, 1 sapma var, 2 hiçbir şey doğrulanamadı.
```

Sonra `npm test` çıktısındaki kontrol sayılarını topla ve README'deki "165 kontrol: portföy 63, güvenlik 19, arama 59, hata senaryoları 24" ifadesine `denetim 47` ekleyip toplamı güncelle (Step 2'de test eklendiyse 47 değişir; sayıları test çıktılarından oku, tahmin etme).

- [ ] **Step 4: Spec'i gerçeğe uydur**

`docs/superpowers/specs/2026-10-01-veri-denetimi-design.md` içinde:
- "Mimari" bölümünün ilk maddesini şununla değiştir: `- İki dosya: scripts/denetim-cekirdek.mjs (saf mantık, çevrimdışı test edilir) ve scripts/veri-denetimi.mjs (canlı çalıştırıcı); komut npm run denetim.`
- Kontrol tablosunun altına şu maddeyi ekle: `- Temel oranlarda F/K toleransı %0,5 + İş Yatırım'ın 1 ondalık yuvarlaması (±0,05 ÷ referans) kadardır; ilk canlı çalıştırmada THYAO (3,0 ↔ 2,97) ve GARAN (4,4 ↔ 4,34) yalancı SAPMA verdi.`

- [ ] **Step 5: CHANGELOG girdisini yaz**

`CHANGELOG.md`'nin en üstüne (`# Sürüm Notları` başlığının altına, `## 0.16.3` girdisinin önüne) ekle. Başlıktaki tarih çalıştırılan günün tarihidir (`date '+%-d %B %Y'` değil, Türkçe ay adıyla elle yaz):

```markdown
## 0.16.4 — <gün Ay 2026> (veri doğruluğu denetimi)

### Yeni
- **`npm run denetim`: çapraz kaynak veri denetimi.** Uygulamanın gösterdiği veriyi bağımsız ikinci kaynakla karşılaştırır: döviz ↔ TCMB, gram altın ↔ ons × USDTRY ÷ 31,1035, altın türleri ↔ saf gram karşılığı, BIST fiyatı ↔ İş Yatırım kapanışı, TEFAS fon fiyatı ↔ TEFAS API'sinden doğrudan son fiyat, gecikme etiketi ve veri yaşı, FAVÖK / net kâr / F/K ↔ mali tablonun ham satırlarından yeniden hesap. `-- --portfoy` portföy toplamlarını bileşenlerinden yeniden toplar (gerçek veritabanının kopyasında; çıktıya tutar yazılmaz). Her satır OK / SAPMA / ATLANDI; ağ yoksa ATLANDI, hiçbir şey doğrulanamazsa çıkış kodu 2.
- Denetimin saf mantığı için 47 çevrimdışı kontrol (`test/denetim.test.mjs`), `npm test` zincirinde.

### Düzeltilen
<Step 2'de düzeltilen her uygulama hatası için bir madde: belirti, kök neden, kanıt (sayılar). Düzeltme çıkmadıysa bu başlığı sil.>
```

`<…>` ile işaretli satır yer tutucudur: Step 2 sonucuna göre gerçek maddelerle değiştir ya da başlığı sil; commit'e yer tutucu metin girmemeli (`grep -nE "<Step 2|<gün" CHANGELOG.md` boş dönmeli).

- [ ] **Step 6: Sürümü yükselt**

`package.json` içindeki `"version": "0.16.3"` değerini `"0.16.4"` yap. Başka yerde sürüm geçiyor mu kontrol et: `grep -rn "0\.16\.3" --exclude-dir=node_modules --exclude-dir=.git --exclude=CHANGELOG.md .` — çıkan her yer (varsa `package-lock.json`, `macos/` Info.plist) aynı değere güncellenir.

- [ ] **Step 7: Son doğrulama**

Run: `npm test 2>&1 | grep -c FAIL; npm test >/dev/null 2>&1; echo "test çıkış=$?"; node scripts/veri-denetimi.mjs >/dev/null 2>&1; echo "denetim çıkış=$?"; grep -nE "<Step 2|<gün" CHANGELOG.md`
Expected: `0`, `test çıkış=0`, `denetim çıkış=0` (Step 2'de bilinçle bırakılan sapma yoksa), son grep boş.

- [ ] **Step 8: Commit**

```bash
git add -A package.json package-lock.json README.md CHANGELOG.md docs scripts test server web
git commit -m "0.16.4: veri doğruluğu denetimi (npm run denetim)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

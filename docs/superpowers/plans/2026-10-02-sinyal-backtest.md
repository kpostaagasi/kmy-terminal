# Sinyal geçmiş performansı (backtest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tarayıcı sayfasına, radardaki 11 sinyalin BIST 100 için 10 yıllık geçmişte sonraki 5/20/60 işlem gününde ne yaptığını (taban ve XU100 karşılaştırmalı) gösteren dürüst bir tablo eklemek; sürüm 0.21.0.

**Architecture:** Sinyal tanımları tek yerde (`server/sinyal-tanim.js`: `signalSeries`/`signalsAt`); radar, bildirim ve backtest aynı kuralı kullanır. Bölünme düzeltmesi (`server/seri.js`) her üç yolda da uygulanır. Hesap saf ve çevrimdışı (`server/backtest.js`); ağ, kalıcılık ve tek-koşu kilidi `server/backtest-run.js`'te (denetim.js modeli). Arayüz `web/js/backtest-view.js`.

**Tech Stack:** Node 22.13+ ESM, `node:sqlite`, vanilla JS UI. Yeni bağımlılık yok.

**Spec:** `docs/superpowers/specs/2026-10-02-sinyal-backtest-design.md` (yürütücü önce onu okur). Bu planın bir sapması: saf sinyal kodu `radar.js` yerine `server/sinyal-tanim.js`'tedir (radar.js geri dışa aktarır); Task 4 spec'i buna göre düzeltir.

## Global Constraints

- Ad her yerde küçük harf: "kmy terminal". Rakip ürün adı geçmez. Kişisel veri git'e girmez. Depo gizli kalır.
- Node ≥ 22.13, bağımlılık eklenmez. Testler çevrimdışı, `npm test` zincirine eklenir (`radar`, `seri`, `backtest` testleri).
- Ağ gerektiren tek yer `backtest-run.js` `compute()`; hesap çekirdeği saf.
- Bölünme eşiği: günlük kapanış oranı < 0.75 veya > 1.30 kırılma sayılır (−%25 ve +%30 tam sınırda kırılma DEĞİL). Önceki mumlar × oran, hacim ÷ oran.
- Olay: sinyal önceki gün yok, bugün var; ısınma 210 mum; son kabul edilen olaydan 20 işlem günü içindeki tekrar sayılmaz (tam 20 sayılmaz, 21 sayılır).
- Giriş = sinyal gününü izleyen günün açılışı; çıkış = h. işlem günü kapanışı (h ∈ 5/20/60). Çıkışı seri dışında kalan olay o ufukta dışarıda.
- Taban = aynı giriş/çıkış kuralı, her gün. Fark = ortalama − taban ortalaması. XU100'a göre fark İstanbul takvim gününe göre. İsabet yöne duyarlı (düşüş sinyalinde getiri < 0). n < 30 → "az örnek".
- Evren BIST 100 (`universe.bist100()`), XU100 zorunlu, hisselerin yarısından azı gelirse hata. Yalnız elle hesaplanır.
- API: `GET /api/backtest`, `POST /api/backtest/run` (300 s zaman aşımı, iç koşu bitene kadar kilit, `finally`'de `backtest.updated` yayını). Tablo `backtest_result(id=1, at, result)`.
- Bildirim davranışı: bölünme düzeltmesi `scanBars` içinde de uygulanır; bu canlı radarı ve 0.18.0 bildirimlerini etkiler (tek seferlik "yeni sinyal" olabilir). Bu bilinçli ve CHANGELOG'da yazılır.

## Review Focus

1. **İleriye bakma:** sinyal/gösterge i. mumda yalnız ≤ i verisini kullanmalı; giriş ertesi gün açılışı. Test: önek eşdeğerliği (`signalsAt(S,i)` == `scanBars(bars.slice(0,i+1)).signals`) ve gelecek verisi değişince geçmiş sinyallerin değişmemesi (Task 1).
2. **Taban kuralı eşitliği:** taban ile olay aynı giriş/çıkış fonksiyonunu kullanmalı; yoksa "fark" anlamsız. Test: taban, sinyal günlerini de içerir (Task 1).
3. **Bölünme tespiti:** meşru ±%10/±%20 hareketler dokunulmaz, gerçek bölünme sahte −%67 getiri üretmez, eşik sınırı doğru. Test: `seri.test.mjs` sınır vakaları + bölünmeli seride medyan > −%30 (Task 1).
4. **Örtüşen olaylar:** aynı sinyalin ardışık günleri tek olay; 20 gün içindeki tekrar sayılmaz. Test: gap 20/21 (Task 1).
5. **Dürüst durumlar:** hesap zaman aşımında kilit açılmadan yeni koşu başlamaz; başarısız koşu önceki sonucu bozmaz, arayüz "hesaplanıyor"da takılı kalmaz; az örnek ve boş ufuk "—" gösterilir. Test: `backtest-run.check.mjs` + tarayıcı doğrulaması (Task 2, 3).

---

## File Structure

| Dosya | Sorumluluk |
|---|---|
| `server/seri.js` (yeni) | `adjustSplits(bars)` — bölünme düzeltmesi, saf |
| `server/sinyal-tanim.js` (yeni) | `SIGNALS`, `signalSeries`, `signalsAt`, `scanBars` — saf |
| `server/radar.js` (değişir) | sinyal tanımını `sinyal-tanim.js`'ten geri dışa aktarır; `radar()` aynı kalır |
| `server/backtest.js` (yeni) | `symbolObservations`, `aggregate`, `computeBacktest` — saf |
| `server/backtest-run.js` (yeni) | veri çekimi, kalıcılık, tek koşu kilidi, `run`/`last` |
| `server/index.js` (değişir) | iki rota |
| `web/js/backtest-view.js` (yeni) | panel |
| `web/js/market-view.js`, `web/js/lang/en/market.js`, `web/terminal.css` (değişir) | panel yerleşimi, EN metinler, taşma kuralı |
| `test/radar.test.mjs`, `test/seri.test.mjs`, `test/backtest.test.mjs`, `test/backtest-run.check.mjs`, `test/fixtures/radar-golden.json`, `test/fixtures/make-radar-golden.mjs` (yeni) | testler |
| `package.json`, `README.md`, `CHANGELOG.md`, spec (değişir) | sürüm 0.21.0, belgeler |

Plan boyunca yürütücü bir dal açar: `git switch -c feat/sinyal-backtest`. Komutlar depo kökünden çalışır.

---

### Task 1: Saf çekirdek (bölünme düzeltmesi, ortak sinyal tanımı, backtest motoru) ve testleri

**Files:**
- Create: `server/seri.js`, `server/sinyal-tanim.js`, `server/backtest.js`
- Create: `test/seri.test.mjs`, `test/radar.test.mjs`, `test/backtest.test.mjs`, `test/fixtures/make-radar-golden.mjs`, `test/fixtures/radar-golden.json`
- Modify: `server/radar.js` (SIGNALS…scanBars bloğu yerine geri dışa aktarım), `package.json` (`test` zinciri)

**Interfaces:**
- Produces: `adjustSplits(bars, {down, up}) → { bars, breaks }`; `SIGNALS`; `signalSeries(bars) → S`; `signalsAt(S, i) → string[]`; `scanBars(bars) → {price, changePct, rsi, volRatio, signals} | null` (artık bölünme düzeltmeli); `symbolObservations`, `aggregate`, `computeBacktest({series:[{symbol,bars}], bench, ...}) → {baseline, signals, params}`; sabitler `HORIZONS, GAP, WARMUP, MIN_N, MIN_BARS`.
- Consumes: `server/indicators.js` (`sma`, `rsi`, `macd`).

- [ ] **Step 1: Dalı aç ve altın-referansı refactor ÖNCESİ üret**

```bash
git switch -c feat/sinyal-backtest
mkdir -p test/fixtures
```

Dosya `test/fixtures/make-radar-golden.mjs`:

```js
// Altın-referans üretici: radar.js'in refactor ÖNCESİ scanBars çıktısını kaydeder. Refactor'dan önce bir kez çalıştırılır; sonuç depoya girer.
// Kullanım: node test/fixtures/make-radar-golden.mjs test/fixtures/radar-golden.json
import fs from 'node:fs';
import { scanBars as oldScan, SIGNALS } from '../../server/radar.js';
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeBars(seed, n, { drifts = [0.0015, -0.006, 0, 0.004], len = 120 } = {}) {
  const r = rng(seed); let c = 100; const bars = [];
  for (let i = 0; i < n; i++) {
    const drift = drifts[Math.floor(i / len) % drifts.length]; // varsayılan: yükseliş, sert düşüş, yatay, toparlanma
    const ret = Math.max(-0.09, Math.min(0.09, drift + (r() - 0.5) * 0.04));
    const o = c; c = c * (1 + ret);
    const burst = r() < 0.03 ? 4 : 1;
    bars.push({ t: Date.UTC(2020, 0, 1) + i * 86400000, o, h: Math.max(o, c) * (1 + r() * 0.01), l: Math.min(o, c) * (1 - r() * 0.01), c, v: Math.round(1e6 * (0.5 + r()) * burst) });
  }
  return bars;
}
const round = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6);
const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const cfg = (seed) => (seed >= 9 ? { drifts: [0.003, 0.003, -0.004, -0.004], len: 130 } : undefined); // 9-10: uzun yükseliş sonra uzun düşüş (ölüm kesişimi)
const out = {}; const seen = new Set(); let count = 0;
for (const seed of seeds) {
  const bars = makeBars(seed, 520, cfg(seed)); const rows = [];
  for (let i = 59; i < bars.length; i += 5) {
    const r = oldScan(bars.slice(0, i + 1));
    rows.push([i, r.signals.join(','), round(r.price), round(r.changePct), round(r.rsi), round(r.volRatio)]);
    r.signals.forEach((s) => seen.add(s)); count++;
  }
  out[seed] = rows;
}
fs.writeFileSync(process.argv[2], JSON.stringify({ n: 520, step: 5, from: 59, seeds: out }));
console.log('nokta', count, '| görülen sinyal', seen.size + '/' + Object.keys(SIGNALS).length, '| eksik:', Object.keys(SIGNALS).filter((k) => !seen.has(k)).join(',') || 'yok');
```

Çalıştır (radar.js'e HENÜZ dokunulmadı):

```bash
node test/fixtures/make-radar-golden.mjs test/fixtures/radar-golden.json
```

Beklenen: `nokta 930 | görülen sinyal 11/11 | eksik: yok`

- [ ] **Step 2: Bölünme düzeltmesi testi (başarısız görmek için önce test)**

Dosya `test/seri.test.mjs`:

```js
// Bölünme/birleşme düzeltmesi. Çevrimdışı, saf.
import { adjustSplits } from '../server/seri.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const B = (closes, vols = null) => closes.map((c, i) => ({ t: Date.UTC(2024, 0, 1 + i), o: c, h: c * 1.01, l: c * 0.99, c, v: vols ? vols[i] : 1000 }));
const cl = (r) => r.bars.map((b) => b.c);

// ── Temel davranış ────────────────────────────────────────────────────────
const e = adjustSplits([]);
assert('boş girdi: boş seri ve kırılma yok', e.bars.length === 0 && e.breaks.length === 0);
assert('tek mum dokunulmaz', adjustSplits(B([100])).bars[0].c === 100 && adjustSplits(B([100])).breaks.length === 0);
const flat = B([100, 102, 99, 105, 103]);
const rf = adjustSplits(flat);
assert('bölünmesiz seri aynen kalır', cl(rf).join() === '100,102,99,105,103' && rf.breaks.length === 0);
assert('girdi değiştirilmez ve yeni nesneler döner', rf.bars[0] !== flat[0] && flat[0].c === 100);

// ── Aşağı bölünme (bedelsiz): 102 → 34 ────────────────────────────────────
const s1 = adjustSplits(B([100, 102, 34, 35], [1000, 1000, 3000, 3000]));
assert('aşağı bölünme: önceki kapanışlar oranla çarpılır (süreklilik)', near(s1.bars[0].c, 100 * (34 / 102)) && near(s1.bars[1].c, 34) && s1.bars[2].c === 34 && s1.bars[3].c === 35, cl(s1).join());
assert('aşağı bölünme: o, h, l de çarpılır', near(s1.bars[0].o, 100 * (34 / 102)) && near(s1.bars[0].h, 100 * 1.01 * (34 / 102)) && near(s1.bars[0].l, 100 * 0.99 * (34 / 102)));
assert('aşağı bölünme: önceki hacim ters ölçeklenir (×3)', near(s1.bars[0].v, 3000) && near(s1.bars[1].v, 3000) && s1.bars[2].v === 3000, [s1.bars[0].v, s1.bars[1].v, s1.bars[2].v].join());
assert('kırılma kaydı: indeks, tarih, oran', s1.breaks.length === 1 && s1.breaks[0].index === 2 && s1.breaks[0].date === '2024-01-03' && near(s1.breaks[0].ratio, 34 / 102), JSON.stringify(s1.breaks));

// ── Yukarı birleşme (ters bölünme): 10,5 → 18,2 (+%73) ────────────────────
const s2 = adjustSplits(B([10, 10.5, 18.2, 18]));
assert('yukarı birleşme: önceki kapanışlar oranla çarpılır', near(s2.bars[1].c, 18.2) && near(s2.bars[0].c, 10 * (18.2 / 10.5)) && s2.bars[3].c === 18, cl(s2).join());
assert('yukarı birleşme: hacim ters ölçeklenir (÷ oran)', near(s2.bars[0].v, 1000 / (18.2 / 10.5)));

// ── Eşikler (Review Focus: gerçek hareketler dokunulmaz) ──────────────────
assert('tam −%25 bölünme sayılmaz (sınır dahil değil)', adjustSplits(B([100, 75])).breaks.length === 0);
assert('−%25,01 bölünme sayılır', adjustSplits(B([100, 74.99])).breaks.length === 1);
assert('tam +%30 birleşme sayılmaz', adjustSplits(B([100, 130])).breaks.length === 0);
assert('+%30,01 birleşme sayılır', adjustSplits(B([100, 130.01])).breaks.length === 1);
assert('−%10 ve +%10 (güncel fiyat sınırı) dokunulmaz', adjustSplits(B([100, 90, 99])).breaks.length === 0);
assert('±%20 (eski fiyat sınırı) dokunulmaz', adjustSplits(B([100, 80, 96, 115.2])).breaks.length === 0);

// ── Birden çok kırılma birikir ────────────────────────────────────────────
const s3 = adjustSplits(B([100, 50, 51, 17, 17.5]));
assert('iki bölünme: indeksler 1 ve 3', s3.breaks.map((b) => b.index).join() === '1,3');
assert('iki bölünme: ilk mum iki oranla, araya düşen mumlar sonuncuyla çarpılır', near(s3.bars[0].c, 100 * 0.5 * (17 / 51)) && near(s3.bars[1].c, 50 * (17 / 51)) && near(s3.bars[2].c, 17) && s3.bars[3].c === 17 && s3.bars[4].c === 17.5, cl(s3).join());

// ── Kenarlar ──────────────────────────────────────────────────────────────
const sl = adjustSplits(B([100, 100, 30]));
assert('son mumdaki bölünme: önceki tüm mumlar ölçeklenir, son mum aynen', sl.bars[2].c === 30 && near(sl.bars[0].c, 30) && near(sl.bars[1].c, 30) && sl.breaks[0].index === 2);
const bad = B([100, 100, 100]); bad[1].c = null;
assert('bozuk (null) kapanışlı mum: sayı olmayan alan olduğu gibi kalır, çökme yok', adjustSplits(bad).bars[1].c === null && adjustSplits(bad).breaks.length === 0);
const bad2 = B([100, 100, 30]); bad2[1].c = null;
assert('bozuk mumun üzerinden önceki geçerli kapanışla kıyaslanır (100 → 30)', adjustSplits(bad2).breaks.length === 1 && adjustSplits(bad2).breaks[0].index === 2);
const zero = B([100, 0, 100]);
assert('sıfır kapanış kırılma hesabına katılmaz (0 → 100 sonsuz oran üretmez)', adjustSplits(zero).breaks.length === 0 && adjustSplits(zero).bars[1].c === 0);
const noT = [{ o: 100, h: 100, l: 100, c: 100, v: 1 }, { o: 30, h: 30, l: 30, c: 30, v: 1 }];
assert('zaman damgası yoksa tarih null, kırılma yine yakalanır', adjustSplits(noT).breaks[0].date === null && adjustSplits(noT).breaks.length === 1);
assert('hacim 0 ise 0 kalır (NaN değil)', adjustSplits(B([100, 100, 30], [0, 0, 0])).bars[0].v === 0);
assert('özel eşik: down −%10 ile −%11 sayılır', adjustSplits(B([100, 89]), { down: -0.10 }).breaks.length === 1);

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
```

Çalıştır: `node test/seri.test.mjs`. Beklenen: FAIL (`../server/seri.js` yok).

- [ ] **Step 3: `server/seri.js`**

```js
// Fiyat serisi düzeltmeleri. Saf (veritabanı ve ağ yok).

/**
 * BIST'te bedelsiz sermaye artırımı ve bölünmeler ham seriye düzeltilmeden girer: Yahoo'nun `adjclose` alanı BIST için ham
 * kapanışla aynıdır ve `events=splits` olayları güvenilmez. Günlük fiyat sınırı (±%10, geçmişte ±%20) gerçek bir tek gün
 * hareketini bu eşiklerin çok altında tutar; bu yüzden eşiğin ötesindeki bir gün bölünme/birleşme sayılır.
 *
 * Ardışık kapanış oranı `c[i]/c[i−1]` < 1 + down ya da > 1 + up ise i. gün bir kırılmadır; i'den ÖNCEKİ tüm mumların
 * o, h, l, c değerleri bu oranla çarpılır (kırılma noktasında oran 1 olur), hacim aynı oranla bölünür. Birden çok kırılma
 * sondan başa birikir. Girdi değiştirilmez. Kapanışı sayı olmayan ya da ≤ 0 olan mum kırılma hesabına katılmaz
 * (bir sonraki geçerli mum önceki geçerli kapanışla kıyaslanır).
 * Döner: { bars, breaks: [{ index, date, ratio }] }
 */
export function adjustSplits(bars, { down = -0.25, up = 0.30 } = {}) {
  const out = bars.map((b) => ({ ...b }));
  const lo = 1 + down, hi = 1 + up;
  const ratios = new Array(out.length).fill(1);
  const breaks = [];
  let prev = null;
  for (let i = 0; i < out.length; i++) {
    const c = out[i].c;
    if (!(Number.isFinite(c) && c > 0)) continue;
    if (prev != null) {
      const r = c / prev;
      if (r < lo || r > hi) {
        ratios[i] = r;
        breaks.push({ index: i, date: Number.isFinite(out[i].t) ? new Date(out[i].t).toISOString().slice(0, 10) : null, ratio: r });
      }
    }
    prev = c;
  }
  let f = 1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (f !== 1) {
      const b = out[i];
      for (const k of ['o', 'h', 'l', 'c']) if (Number.isFinite(b[k])) b[k] *= f;
      if (Number.isFinite(b.v)) b.v /= f;
    }
    if (ratios[i] !== 1) f *= ratios[i];
  }
  return { bars: out, breaks };
}
```

Çalıştır: `node test/seri.test.mjs`. Beklenen: `25 geçti, 0 başarısız`.

- [ ] **Step 4: Ortak sinyal tanımı**

Dosya `server/sinyal-tanim.js`:

```js
// Sinyal tanımları: radar (son mum), sinyal bildirimi ve backtest (her mum) AYNI kuralları kullanır. Saf (veritabanı ve ağ yok).
// Göstergeler nedenseldir: i. mumdaki değer yalnız ≤ i verisini kullanır (ileriye bakma yok).
import { sma, rsi, macd } from './indicators.js';
import { adjustSplits } from './seri.js';

export const SIGNALS = {
  rsi_os: { label: 'RSI aşırı satım (<30)', dir: 'up' },
  rsi_ob: { label: 'RSI aşırı alım (>70)', dir: 'down' },
  golden: { label: 'Altın kesişim (SMA50↑SMA200)', dir: 'up' },
  death: { label: 'Ölüm kesişimi (SMA50↓SMA200)', dir: 'down' },
  high52: { label: '52 hafta zirvesi', dir: 'up' },
  low52: { label: '52 hafta dibi', dir: 'down' },
  vol: { label: 'Hacim patlaması (>2× ort.)', dir: 'neutral' },
  sma200_up: { label: 'SMA200 yukarı kırılım', dir: 'up' },
  sma200_dn: { label: 'SMA200 aşağı kırılım', dir: 'down' },
  macd_up: { label: 'MACD al kesişimi', dir: 'up' },
  macd_dn: { label: 'MACD sat kesişimi', dir: 'down' },
};

const crossedUp = (a, b, i) => a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i] > b[i] && a[i - 1] <= b[i - 1];
const crossedDn = (a, b, i) => a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i] < b[i] && a[i - 1] >= b[i - 1];
// Son n mum içindeki en yeni kesişimin yönü: 'up' | 'dn' | null
function lastCross(a, b, n, last) {
  for (let i = last; i > last - n && i > 0; i--) {
    if (crossedUp(a, b, i)) return 'up';
    if (crossedDn(a, b, i)) return 'dn';
  }
  return null;
}

/** Göstergeleri bir kez hesaplar; `signalsAt` her mum için bunu kullanır. */
export function signalSeries(bars) {
  const c = bars.map((b) => b.c), v = bars.map((b) => b.v || 0);
  return { c, v, s50: sma(c, 50), s200: sma(c, 200), r: rsi(c, 14), m: macd(c) };
}

/** i. mumdan önceki 20 mumun ortalama hacmi (hacim patlaması ölçütü). */
export const volAvg = (S, i) => S.v.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) / 20;

/** i. mum için sinyal anahtarları (yalnız ≤ i verisi). */
export function signalsAt(S, i) {
  const { c, v, s50, s200, r, m } = S;
  const out = [];
  if (r[i] != null && r[i] < 30) out.push('rsi_os');
  if (r[i] != null && r[i] > 70) out.push('rsi_ob');
  const ma = lastCross(s50, s200, 5, i);
  if (ma) out.push(ma === 'up' ? 'golden' : 'death');
  const win = c.slice(Math.max(0, i - 251), i + 1);
  if (c[i] >= Math.max(...win) * 0.995) out.push('high52');
  if (c[i] <= Math.min(...win) * 1.005) out.push('low52');
  const avg20 = volAvg(S, i);
  if (avg20 > 0 && v[i] > 2 * avg20) out.push('vol');
  const px = lastCross(c, s200, 3, i);
  if (px) out.push(px === 'up' ? 'sma200_up' : 'sma200_dn');
  const mc = lastCross(m.line, m.signal, 2, i);
  if (mc) out.push(mc === 'up' ? 'macd_up' : 'macd_dn');
  return out;
}

/** Radar için son mumun özeti. Bölünme/birleşme günleri önce düzeltilir (bkz. seri.js). */
export function scanBars(bars) {
  if (bars.length < 60) return null;
  const S = signalSeries(adjustSplits(bars).bars);
  const L = S.c.length - 1;
  const avg20 = volAvg(S, L);
  return { price: S.c[L], changePct: (S.c[L] / S.c[L - 1] - 1) * 100, rsi: S.r[L], volRatio: avg20 ? S.v[L] / avg20 : null, signals: signalsAt(S, L) };
}
```

`server/radar.js`: `import { sma, rsi, macd } from './indicators.js';` satırını ve `export const SIGNALS` satırından `scanBars` fonksiyonunun kapanışına kadar olan bloğu (`crossedUp`, `crossedDn`, `lastCross`, `scanBars` dahil) sil; yerine şunu koy:

```js
import { SIGNALS, scanBars } from './sinyal-tanim.js';
export { SIGNALS, scanBars };
```

(`pool` ve `radar()` aynen kalır; `signal-watch.js` `./radar.js`'ten almaya devam eder.)

- [ ] **Step 5: Radar testi (altın-referans, önek eşdeğerliği, bölünme)**

Dosya `test/radar.test.mjs`:

```js
// Radar sinyal tanımları: altın-referans (refactor öncesi çıktı), önek eşdeğerliği (ileriye bakma yok), bölünme düzeltmesi. Çevrimdışı.
import fs from 'node:fs';
import { scanBars, signalSeries, signalsAt, SIGNALS } from '../server/sinyal-tanim.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

// Deterministik sentetik seri (tohumlu rastgele yürüyüş; günlük hareket ±%9 ile sınırlı: bölünme içermez)
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeBars(seed, n, { drifts = [0.0015, -0.006, 0, 0.004], len = 120 } = {}) {
  const r = rng(seed); let c = 100; const bars = [];
  for (let i = 0; i < n; i++) {
    const drift = drifts[Math.floor(i / len) % drifts.length]; // varsayılan: yükseliş, sert düşüş, yatay, toparlanma
    const ret = Math.max(-0.09, Math.min(0.09, drift + (r() - 0.5) * 0.04));
    const o = c; c = c * (1 + ret);
    const burst = r() < 0.03 ? 4 : 1;
    bars.push({ t: Date.UTC(2020, 0, 1) + i * 86400000, o, h: Math.max(o, c) * (1 + r() * 0.01), l: Math.min(o, c) * (1 - r() * 0.01), c, v: Math.round(1e6 * (0.5 + r()) * burst) });
  }
  return bars;
}
const cfg = (seed) => (seed >= 9 ? { drifts: [0.003, 0.003, -0.004, -0.004], len: 130 } : undefined); // 9-10: uzun yükseliş sonra uzun düşüş (ölüm kesişimi)
const round = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6);

// ── 1) Altın-referans: refactor öncesi scanBars çıktısı ile birebir aynı ───
const GOLD = JSON.parse(fs.readFileSync(new URL('./fixtures/radar-golden.json', import.meta.url), 'utf8'));
const seen = new Set();
let points = 0, wrong = 0;
for (const [seed, rows] of Object.entries(GOLD.seeds)) {
  const bars = makeBars(Number(seed), GOLD.n, cfg(Number(seed)));
  for (const [i, sig, price, chg, rsi, vr] of rows) {
    const r = scanBars(bars.slice(0, i + 1));
    points++;
    const got = [r.signals.join(','), round(r.price), round(r.changePct), round(r.rsi), round(r.volRatio)];
    if (JSON.stringify(got) !== JSON.stringify([sig, price, chg, rsi, vr])) { wrong++; if (wrong <= 3) console.log('  ayrım', seed, i, JSON.stringify(got), JSON.stringify([sig, price, chg, rsi, vr])); }
    r.signals.forEach((s) => seen.add(s));
  }
}
assert(`altın-referans: ${points} noktanın tamamı refactor öncesi çıktıyla aynı`, wrong === 0, `${wrong} fark`);
assert('altın-referans her sinyal türünü egzersiz eder (11/11)', Object.keys(SIGNALS).every((k) => seen.has(k)), [...seen].length + '/' + Object.keys(SIGNALS).length);

// ── 2) Önek eşdeğerliği: i. mumdaki sinyal yalnız ≤ i verisine bağlıdır (ileriye bakma yok) ──
let preMismatch = 0, preN = 0;
for (const seed of [1, 2, 3, 4, 9, 10]) {
  const bars = makeBars(seed, 520, cfg(seed));
  const S = signalSeries(bars);
  for (let i = 59; i < bars.length; i += 7) {
    preN++;
    const full = signalsAt(S, i).join(',');
    const prefix = scanBars(bars.slice(0, i + 1)).signals.join(',');
    if (full !== prefix) { preMismatch++; if (preMismatch <= 3) console.log('  önek ayrımı', seed, i, full, '|', prefix); }
  }
}
assert(`önek eşdeğerliği: ${preN} noktada tüm seri ile önek aynı sinyali verir`, preMismatch === 0, `${preMismatch} fark`);
assert('erken indekslerde (ısınma öncesi) signalsAt çökmez', (() => { const S = signalSeries(makeBars(1, 300)); for (let i = 0; i < 60; i++) signalsAt(S, i); return true; })());
assert('gelecek verisi sinyali değiştirmez: seri sonuna 50 mum eklemek eski indeksleri etkilemez', (() => {
  const a = makeBars(3, 400), b = makeBars(3, 450); // aynı tohum: ilk 400 mum aynı
  const Sa = signalSeries(a), Sb = signalSeries(b);
  for (let i = 0; i < 400; i += 3) if (signalsAt(Sa, i).join() !== signalsAt(Sb, i).join()) return false;
  return true;
})());

// ── 3) scanBars sınırları ─────────────────────────────────────────────────
assert('60 mumdan kısa seri null', scanBars(makeBars(1, 59)) === null);
assert('tam 60 mum çalışır', scanBars(makeBars(1, 60)) !== null);
assert('boş seri null', scanBars([]) === null);

// ── 4) Bölünme düzeltmesi canlı sinyalleri bozmaz ─────────────────────────
// Son 3 mum 1:3 bölünme sonrası ham fiyatlar: düzeltilmezse sahte 52 hafta dibi ve SMA200 aşağı kırılımı görünür.
const clean = makeBars(2, 400);
const split = clean.map((b, i) => (i >= 397 ? { ...b, o: b.o / 3, h: b.h / 3, l: b.l / 3, c: b.c / 3, v: b.v * 3 } : { ...b }));
const naive = signalsAt(signalSeries(split), split.length - 1);
const adj = scanBars(split);
assert('düzeltilmemiş seride sahte düşüş sinyali görünür (test kurgusu geçerli)', naive.includes('low52'), naive.join(','));
assert('scanBars bölünmeyi düzeltir: sahte 52 hafta dibi / SMA200 aşağı kırılım / ölüm kesişimi yok', !adj.signals.includes('low52') && !adj.signals.includes('sma200_dn') && !adj.signals.includes('death'), adj.signals.join(','));
assert('scanBars bölünme gününde günlük değişim makul (|%| < 15)', Math.abs(adj.changePct) < 15, String(adj.changePct));
assert('scanBars fiyatı ham güncel kapanıştır (son mum düzeltilmez)', adj.price === split.at(-1).c);

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
```

Çalıştır: `node test/radar.test.mjs`. Beklenen: `12 geçti, 0 başarısız` (özellikle altın-referans 930/930 aynı: refactor davranışı değiştirmedi).

- [ ] **Step 6: Motor ve testi**

Dosya `server/backtest.js`:

```js
// Sinyal geçmiş performansı (backtest) motoru. Saf (veritabanı ve ağ yok).
// Olay = sinyalin YENİ belirdiği gün. Sinyal kapanıştan sonra görülür: giriş ertesi günün açılışı, çıkış sinyalden h işlem günü
// sonraki kapanış. Taban = aynı hisselerde her gün için aynı giriş/çıkış kuralı. Ayrıntı: docs/superpowers/specs/2026-10-02-sinyal-backtest-design.md
import { SIGNALS, signalSeries, signalsAt } from './sinyal-tanim.js';
import { adjustSplits } from './seri.js';

export const HORIZONS = [5, 20, 60];
export const GAP = 20;       // aynı hisse + sinyal için bu kadar işlem günü içindeki tekrarlar sayılmaz
export const WARMUP = 210;   // SMA200 ve MACD tam otursun
export const MIN_N = 30;     // altı "az örnek"
export const MIN_BARS = 300; // daha kısa seri atlanır

const day = (t) => new Date(t).toISOString().slice(0, 10);
const okPx = (x) => Number.isFinite(x) && x > 0;

/**
 * Bir hisse için ham gözlemler.
 *  bars:  düzeltilmiş mumlar; bench: endeks mumları (ya da null)
 *  opts.signals: (i) => string[] (varsayılan: sinyal-tanim.js); testlerde sabit sinyal enjekte etmek için
 * Döner: { events: [{ signal, i, date, rets: { h: { r, ex } } }], base: { h: [{ r, ex }] } }
 * r: getiri (oran), ex: XU100'a göre fark (endekste tarih yoksa null).
 */
export function symbolObservations(bars, bench, { horizons = HORIZONS, gap = GAP, warmup = WARMUP, signals = null } = {}) {
  const n = bars.length;
  const sig = signals || (() => { const S = signalSeries(bars); return (i) => signalsAt(S, i); })();
  const bi = bench ? new Map(bench.map((b, k) => [day(b.t), k])) : null;
  const retAt = (i, h) => {
    if (i + h > n - 1) return null;
    const entry = bars[i + 1].o, exit = bars[i + h].c;
    if (!okPx(entry) || !okPx(exit)) return null;
    const r = exit / entry - 1;
    let ex = null;
    if (bi) {
      const a = bi.get(day(bars[i + 1].t)), b = bi.get(day(bars[i + h].t));
      if (a != null && b != null && okPx(bench[a].o) && okPx(bench[b].c)) ex = r - (bench[b].c / bench[a].o - 1);
    }
    return { r, ex };
  };
  const events = [];
  const base = Object.fromEntries(horizons.map((h) => [h, []]));
  const last = {};
  let prev = new Set(sig(warmup - 1));
  for (let i = warmup; i < n - 1; i++) {
    const cur = sig(i);
    for (const h of horizons) { const x = retAt(i, h); if (x) base[h].push(x); }
    for (const k of cur) {
      if (prev.has(k)) continue;                          // yeni belirme değil
      if (last[k] != null && i - last[k] <= gap) continue; // son KABUL edilen olaya çok yakın
      last[k] = i;
      const rets = {};
      for (const h of horizons) { const x = retAt(i, h); if (x) rets[h] = x; }
      events.push({ signal: k, i, date: day(bars[i].t), rets });
    }
    prev = new Set(cur);
  }
  return { events, base };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function stats(obs) {
  const n = obs.length;
  const r = obs.map((o) => o.r), ex = obs.filter((o) => o.ex != null).map((o) => o.ex);
  return {
    n, mean: n ? mean(r) : null, median: n ? median(r) : null,
    hitUp: n ? r.filter((x) => x > 0).length / n : null, hitDown: n ? r.filter((x) => x < 0).length / n : null,
    excess: ex.length ? mean(ex) : null, excessN: ex.length,
  };
}

/**
 * Gözlemleri tabloya çevirir.
 *  all: { base: { h: [obs] }, events: { sinyal: { h: [obs] } } }
 * Her sinyal satırı: { dir, label, [h]: { n, mean, median, hit, excess, excessN, delta, low } }
 *  hit: sinyal yönüne göre (down: getiri < 0, aksi halde > 0); delta: ortalama − taban ortalaması (puan, oran olarak)
 */
export function aggregate(all, { horizons = HORIZONS, minN = MIN_N } = {}) {
  const baseline = {};
  for (const h of horizons) baseline[h] = stats(all.base[h] || []);
  const signals = {};
  for (const [k, def] of Object.entries(SIGNALS)) {
    const row = { dir: def.dir, label: def.label };
    for (const h of horizons) {
      const s = stats(all.events[k]?.[h] || []);
      row[h] = {
        n: s.n, mean: s.mean, median: s.median, hit: def.dir === 'down' ? s.hitDown : s.hitUp,
        excess: s.excess, excessN: s.excessN,
        delta: s.n ? s.mean - baseline[h].mean : null, low: s.n < minN,
      };
    }
    signals[k] = row;
  }
  return { baseline, signals };
}

/**
 * Tüm hisseler için backtest.
 *  series: [{ symbol, bars }] (ham mumlar; bölünmeler burada düzeltilir), bench: endeks mumları
 * Döner: { baseline, signals, params: { horizons, gap, warmup, minN, symbols, skipped, bars, from, to, splitBreaks } }
 */
export function computeBacktest({ series, bench, horizons = HORIZONS, gap = GAP, warmup = WARMUP, minN = MIN_N, minBars = MIN_BARS, signals = null }) {
  const all = { base: Object.fromEntries(horizons.map((h) => [h, []])), events: {} };
  const skipped = [];
  let bars = 0, splitBreaks = 0, from = null, to = null, used = 0;
  for (const { symbol, bars: raw } of series) {
    if (!raw || raw.length < minBars) { skipped.push(symbol); continue; }
    const adj = adjustSplits(raw);
    splitBreaks += adj.breaks.length;
    const obs = symbolObservations(adj.bars, bench, { horizons, gap, warmup, signals });
    for (const h of horizons) all.base[h].push(...obs.base[h]);
    for (const ev of obs.events) for (const h of horizons) if (ev.rets[h]) ((all.events[ev.signal] ||= {})[h] ||= []).push(ev.rets[h]);
    used++;
    bars += adj.bars.length;
    const d0 = day(adj.bars[Math.min(warmup, adj.bars.length - 1)].t), d1 = day(adj.bars.at(-1).t);
    if (!from || d0 < from) from = d0;
    if (!to || d1 > to) to = d1;
  }
  return { ...aggregate(all, { horizons, minN }), params: { horizons, gap, warmup, minN, symbols: used, skipped, bars, from, to, splitBreaks } };
}
```

Dosya `test/backtest.test.mjs`:

```js
// Backtest motoru: olay tanımı, getiri kuralı, taban, yön duyarlı isabet, toplama. Çevrimdışı, saf.
import { symbolObservations, aggregate, computeBacktest, HORIZONS, GAP, WARMUP, MIN_N } from '../server/backtest.js';
import { SIGNALS } from '../server/sinyal-tanim.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const near = (a, b, tol = 1e-9) => a != null && Number.isFinite(a) && Math.abs(a - b) <= tol;
const D = (k) => Date.UTC(2024, 0, 1 + k);

assert('sabitler: ufuklar, tekilleştirme, ısınma, az örnek', HORIZONS.join() === '5,20,60' && GAP === 20 && WARMUP === 210 && MIN_N === 30);

// Sabit fiyat modeli: o_k = 100 + k, c_k = 100 + k + 0.5 (elle hesaplanabilir)
const bars = Array.from({ length: 40 }, (_, k) => ({ t: D(k), o: 100 + k, h: 101 + k, l: 99 + k, c: 100 + k + 0.5, v: 1000 }));
// Endeks: o_k = 1000 + 20k, c_k = o_k + 10
const bench = Array.from({ length: 40 }, (_, k) => ({ t: D(k), o: 1000 + 20 * k, h: 0, l: 0, c: 1000 + 20 * k + 10, v: 0 }));
const at = (set) => (i) => (set.includes(i) ? ['golden'] : []);
const OPT = { horizons: [5, 20], gap: 20, warmup: 5 };

// ── Olay = ilk belirme günü; tekilleştirme ────────────────────────────────
// golden: i = 10, 11 (devam), 25 (10'dan 15 gün sonra: tekrar), 31 (son kabul edilen 10'dan 21 gün sonra), 32 (devam)
const obs = symbolObservations(bars, bench, { ...OPT, signals: at([10, 11, 25, 31, 32]) });
assert('olaylar: yalnız ilk belirme günleri 10 ve 31 (11 devam, 25 gap içinde, 32 devam)', obs.events.map((e) => e.i).join() === '10,31', obs.events.map((e) => e.i).join());
assert('tekilleştirme: 20 gün içindeki tekrar (15 gün sonra) sayılmaz', !obs.events.some((e) => e.i === 25));
assert('tekilleştirme: 21. gün sayılır', obs.events.some((e) => e.i === 31));
const exact20 = symbolObservations(bars, bench, { ...OPT, signals: at([10, 30]) });
assert('tekilleştirme sınırı: tam 20 gün sonraki olay sayılmaz', exact20.events.map((e) => e.i).join() === '10');
const first = symbolObservations(bars, bench, { ...OPT, signals: (i) => (i >= 3 ? ['golden'] : []) });
assert('ısınma öncesinden beri süren sinyal olay değildir (i = warmup, önceki gün de var)', first.events.length === 0);

// ── Getiri kuralı: giriş = ertesi gün açılışı, çıkış = h. gün kapanışı ─────
const e10 = obs.events.find((e) => e.i === 10);
assert('h=5: giriş bars[11].o = 111, çıkış bars[15].c = 115.5', near(e10.rets[5].r, 115.5 / 111 - 1), String(e10.rets[5].r));
assert('h=20: çıkış bars[30].c = 130.5', near(e10.rets[20].r, 130.5 / 111 - 1));
assert('XU100\'a göre fark: hisse getirisi − (1310/1220 − 1)', near(e10.rets[5].ex, (115.5 / 111 - 1) - (1300 + 10) / 1220 + 1), String(e10.rets[5].ex));
const e31 = obs.events.find((e) => e.i === 31);
assert('h=5 için çıkış (36) seri içinde: var', e31.rets[5] != null && near(e31.rets[5].r, 136.5 / 132 - 1));
assert('h=20 için çıkış (51) seri dışı: o olay o ufukta dışarıda', e31.rets[20] === undefined);
assert('olay tarihi sinyal gününün İstanbul/UTC takvim günü', e10.date === '2024-01-11');

// ── Taban: aynı kural, her gün (sinyal günleri dahil) ─────────────────────
assert('taban h=5: i = 5..34 → 30 gün', obs.base[5].length === 30, String(obs.base[5].length));
assert('taban h=20: i = 5..19 → 15 gün', obs.base[20].length === 15, String(obs.base[20].length));
assert('taban, sinyal günlerini de içerir (aynı kurala göre i = 10 getirisi)', obs.base[5].some((x) => near(x.r, 115.5 / 111 - 1)));

// ── Endekste eksik tarih ──────────────────────────────────────────────────
const benchGap = bench.filter((_, k) => k !== 11); // bars[11] tarihi endekste yok → i = 10 olayının girişi eşleşmez
const og = symbolObservations(bars, benchGap, { ...OPT, signals: at([10, 31]) });
assert('endekste giriş tarihi yoksa o olayın excess değeri null (getiri yine var)', og.events[0].rets[5].ex === null && og.events[0].rets[5].r != null);
assert('diğer olayın excess değeri etkilenmez', og.events[1].rets[5].ex != null);
assert('endeks yoksa (null) excess null, çökme yok', symbolObservations(bars, null, { ...OPT, signals: at([10]) }).events[0].rets[5].ex === null);

// ── Bozuk veri ────────────────────────────────────────────────────────────
const badBars = bars.map((b) => ({ ...b })); badBars[11].o = 0; badBars[15].c = NaN;
const ob = symbolObservations(badBars, bench, { ...OPT, signals: at([10]) });
assert('girişi 0 ya da çıkışı NaN olan olay o ufukta üretmez (çökme yok)', ob.events[0].rets[5] === undefined && ob.events[0].rets[20] === undefined);
assert('sinyalsiz seri: olay yok, taban var', symbolObservations(bars, bench, { ...OPT, signals: () => [] }).events.length === 0 && obs.base[5].length > 0);
assert('seri ısınmadan kısa: olay ve taban yok', (() => { const o = symbolObservations(bars.slice(0, 4), bench, { ...OPT, signals: at([2]) }); return o.events.length === 0 && o.base[5].length === 0; })());
assert('gerçek sinyallerle (varsayılan) kısa seride çökmez', symbolObservations(bars, bench, { horizons: [5] }).events.length === 0);

// ── aggregate: istatistikler, yön duyarlı isabet, fark, az örnek ──────────
const o = (r, ex = null) => ({ r, ex });
const all = {
  base: { 5: [o(0.01), o(0.01), o(-0.01), o(0.03)], 20: [] },
  events: { golden: { 5: [o(0.10, 0.02), o(-0.05, -0.01), o(0.02, null)] }, death: { 5: [o(-0.10), o(0.05)] } },
};
const ag = aggregate(all, { horizons: [5, 20], minN: 30 });
assert('taban: n, ortalama, medyan, yükseliş/düşüş isabeti', ag.baseline[5].n === 4 && near(ag.baseline[5].mean, 0.01) && near(ag.baseline[5].median, 0.01) && near(ag.baseline[5].hitUp, 0.75) && near(ag.baseline[5].hitDown, 0.25));
const g5 = ag.signals.golden[5];
assert('yükseliş sinyali: n, ortalama, medyan', g5.n === 3 && near(g5.mean, 0.07 / 3) && near(g5.median, 0.02));
assert('yükseliş sinyali: isabet = getiri > 0 payı (2/3)', near(g5.hit, 2 / 3));
assert('fark = ortalama − taban ortalaması', near(g5.delta, 0.07 / 3 - 0.01));
assert('XU100\'a göre: yalnız endeksi olan olayların ortalaması, excessN ayrı', near(g5.excess, 0.005) && g5.excessN === 2);
const d5 = ag.signals.death[5];
assert('düşüş sinyali: isabet = getiri < 0 payı (1/2)', near(d5.hit, 0.5));
assert('düşüş sinyali için taban isabeti hitDown ile karşılaştırılır (taban satırında iki değer de var)', near(ag.baseline[5].hitDown, 0.25) && near(ag.baseline[5].hitUp, 0.75));
assert('n < 30 → low', g5.low === true);
assert('boş ufuk: n = 0, ortalama/fark null, low true', ag.signals.golden[20].n === 0 && ag.signals.golden[20].mean === null && ag.signals.golden[20].delta === null && ag.signals.golden[20].low === true);
assert('tüm sinyal anahtarları tabloda (veri olmasa da)', Object.keys(SIGNALS).every((k) => ag.signals[k] && ag.signals[k][5]));
assert('satırda yön ve etiket bulunur', ag.signals.death.dir === 'down' && ag.signals.golden.dir === 'up' && typeof ag.signals.golden.label === 'string');
const many = (n) => ({ base: { 5: [o(0.01)] }, events: { golden: { 5: Array.from({ length: n }, () => o(0.02)) } } });
assert('az örnek sınırı: n = 29 low, n = 30 değil', aggregate(many(29), { horizons: [5] }).signals.golden[5].low === true && aggregate(many(30), { horizons: [5] }).signals.golden[5].low === false);
assert('getiriler oran olarak (yüzde değil)', near(g5.median, 0.02) && Math.abs(g5.mean) < 1);
assert('boş girdi çökmez', aggregate({ base: {}, events: {} }, { horizons: [5] }).baseline[5].n === 0);

// ── computeBacktest: bütünleşik (gerçek sinyal tanımlarıyla, sentetik seri) ──
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeBars(seed, n) {
  const r = rng(seed); let c = 100; const out = [];
  for (let i = 0; i < n; i++) {
    const drift = [0.0015, -0.006, 0, 0.004][Math.floor(i / 120) % 4];
    const ret = Math.max(-0.09, Math.min(0.09, drift + (r() - 0.5) * 0.04));
    const open = c; c *= 1 + ret;
    out.push({ t: D(i), o: open, h: Math.max(open, c) * 1.005, l: Math.min(open, c) * 0.995, c, v: Math.round(1e6 * (0.5 + r()) * (r() < 0.03 ? 4 : 1)) });
  }
  return out;
}
const idx = makeBars(99, 900);
const series = [1, 2, 3].map((s) => ({ symbol: 'S' + s, bars: makeBars(s, 900) }));
const res = computeBacktest({ series, bench: idx });
assert('bütünleşik: üç hisse, atlanan yok, taban dolu', res.params.symbols === 3 && res.params.skipped.length === 0 && res.baseline[20].n > 1000);
assert('bütünleşik: parametreler (ufuklar, gap, ısınma, az örnek) sonuçta', res.params.horizons.join() === '5,20,60' && res.params.gap === 20 && res.params.warmup === 210 && res.params.minN === 30);
assert('bütünleşik: tarih aralığı ısınmadan sonra başlar ve seri sonunda biter', res.params.from === new Date(D(210)).toISOString().slice(0, 10) && res.params.to === new Date(D(899)).toISOString().slice(0, 10));
assert('bütünleşik: en az bir sinyal türünde olay var', Object.values(res.signals).some((s) => s[20].n > 0));
assert('bütünleşik: 300 mumdan kısa seri atlanır', computeBacktest({ series: [{ symbol: 'KISA', bars: makeBars(1, 250) }, ...series], bench: idx }).params.skipped.join() === 'KISA');
assert('bütünleşik: deterministik (aynı girdi aynı sonuç)', JSON.stringify(computeBacktest({ series, bench: idx })) === JSON.stringify(res));
assert('bütünleşik: boş seri listesi çökmez', computeBacktest({ series: [], bench: idx }).params.symbols === 0);

// Bölünme düzeltmesi: bir serinin ortasına 1:3 bölünme eklenince sahte −%67 getiri üretmemeli
const withSplit = makeBars(5, 900).map((b, i) => (i >= 500 ? { ...b, o: b.o / 3, h: b.h / 3, l: b.l / 3, c: b.c / 3, v: b.v * 3 } : { ...b }));
const rs = computeBacktest({ series: [{ symbol: 'BOL', bars: withSplit }], bench: idx });
assert('bölünme içeren seri: kırılma sayısı 1', rs.params.splitBreaks === 1, String(rs.params.splitBreaks));
const worst = Math.min(...Object.values(rs.signals).flatMap((s) => [5, 20, 60].map((h) => s[h].n ? s[h].median : 0)), rs.baseline[60].median);
assert('bölünme içeren seri: medyanlarda sahte −%60 çöküş yok', worst > -0.3, String(worst));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
```

Çalıştır: `node test/backtest.test.mjs`. Beklenen: `45 geçti, 0 başarısız`.

- [ ] **Step 7: `npm test` zincirine ekle ve tümünü çalıştır**

`package.json` `test` değerinin sonuna ` && node test/radar.test.mjs && node test/seri.test.mjs && node test/backtest.test.mjs` ekle.

Çalıştır: `npm test 2>&1 | grep -E "geçti|başarısız"`. Beklenen: her takımda `0 başarısız`; yeni üç takım: 12, 25, 45 (toplam 495 geçen kontrol; mevcut 413).

- [ ] **Step 8: Commit**

```bash
git add server/seri.js server/sinyal-tanim.js server/backtest.js server/radar.js test package.json
git commit -m "Backtest: bölünme düzeltmesi, ortak sinyal tanımı ve saf motor"
```

---

### Task 2: Ağ katmanı, kalıcılık, tek-koşu kilidi ve API

**Files:**
- Create: `server/backtest-run.js`, `test/backtest-run.check.mjs`
- Modify: `server/index.js` (import ve iki rota; `denetim` rotalarının yanına)

**Interfaces:**
- Consumes: `computeBacktest` (Task 1), `universe.bist100()`, `getHistory(symbol,'10y','1d')`.
- Produces: `run({timeoutMs, work}) → Promise<{at, result, running:false}>`, `last() → {at, result, running}`; rotalar `GET /api/backtest`, `POST /api/backtest/run`; WS olayı `backtest.updated`.

- [ ] **Step 1: Kilit kontrolünü yaz (önce başarısız)**

Dosya `test/backtest-run.check.mjs` (zincire eklenmez; geçici veri dizini ister):

```js
// Koşu kilidi: zaman aşımından sonra iç koşu bitene kadar yeni koşu reddedilir; paylaşılan söz; başarısız koşu kaydı bozmaz.
// Kullanım: BORSA_DATA_DIR=$(mktemp -d) node test/backtest-run.check.mjs
import * as bt from '../server/backtest-run.js';
let ok = 0, bad = 0;
const assert = (n, c) => { c ? ok++ : bad++; console.log(`${c ? 'OK  ' : 'FAIL'} ${n}`); };
const fake = { params: { symbols: 1 }, baseline: {}, signals: {} };
let release; const slow = () => new Promise((res) => { release = () => res(fake); });

assert('başlangıçta kayıt yok', bt.last().result === null && bt.last().running === false);
const p1 = bt.run({ timeoutMs: 50, work: slow });
const p2 = bt.run({ timeoutMs: 50, work: slow });
assert('koşu sürerken ikinci çağrı aynı sözü paylaşır', p1 === p2 && bt.last().running === true);
let e1; await p1.catch((e) => { e1 = e; });
assert('zaman aşımı hata verir', /zaman aşımı/.test(e1?.message));
assert('zaman aşımından sonra iç koşu sürerken running true kalır', bt.last().running === true);
let e2; await bt.run({ work: slow }).catch((e) => { e2 = e; });
assert('iç koşu bitmeden yeni koşu reddedilir (çakışma yok)', /hâlâ sürüyor/.test(e2?.message));
assert('zaman aşımı kayıt bırakmaz', bt.last().result === null);
release(); await new Promise((r) => setTimeout(r, 10));
assert('iç koşu bitince kilit açılır', bt.last().running === false);
const r = await bt.run({ work: async () => fake });
assert('başarılı koşu kaydedilir', r.result === fake || JSON.stringify(r.result) === JSON.stringify(fake));
assert('last() kaydı döndürür', bt.last().result.params.symbols === 1 && Number.isFinite(bt.last().at));
let e3; await bt.run({ work: async () => { throw new Error('XU100 geçmişi alınamadı'); } }).catch((e) => { e3 = e; });
assert('başarısız koşu hata verir', /XU100/.test(e3?.message));
assert('başarısız koşu önceki kaydı bozmaz', bt.last().result.params.symbols === 1 && bt.last().running === false);
console.log(`\n${ok} geçti, ${bad} başarısız`);
process.exit(bad ? 1 : 0);
```

Çalıştır: `BORSA_DATA_DIR=$(mktemp -d) node test/backtest-run.check.mjs`. Beklenen: FAIL (modül yok).

- [ ] **Step 2: `server/backtest-run.js`**

```js
// Sinyal geçmiş performansı: veri çekimi, kalıcılık, tek koşu. Hesap backtest.js'tedir (saf, çevrimdışı test edilir).
import { db } from './db.js';
import * as universe from './universe.js';
import { getHistory } from './market.js';
import { computeBacktest } from './backtest.js';

db.exec('CREATE TABLE IF NOT EXISTS backtest_result (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL, result TEXT NOT NULL)');

const RANGE = '10y';
let inflight = null;    // bekleyen çağrıların paylaştığı söz
let innerBusy = false;  // zaman aşımından sonra bile iç koşu bitene kadar true: iptal edilemeyen koşu varken yeni koşu çakışmasın

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** BIST100 + XU100 geçmişini çekip hesaplar. XU100 zorunlu; hisselerin yarısından azı gelirse hata. */
export async function compute() {
  const symbols = await universe.bist100();
  const series = [], failed = [];
  let bench;
  const [b] = await Promise.all([
    getHistory('XU100', RANGE, '1d'),
    pool(symbols, 8, async (s) => {
      try { series.push({ symbol: s, bars: await getHistory(s, RANGE, '1d') }); } catch { failed.push(s); }
    }),
  ]);
  bench = b;
  if (!bench?.length) throw new Error('XU100 geçmişi alınamadı');
  if (series.length < symbols.length / 2) throw new Error(`Hisse verisi yetersiz (${series.length}/${symbols.length})`);
  series.sort((a, c) => a.symbol.localeCompare(c.symbol));
  const result = computeBacktest({ series, bench });
  result.params.skipped = [...new Set([...result.params.skipped, ...failed])].sort();
  result.params.universe = 'BIST100';
  result.params.range = RANGE;
  return result;
}

const withTimeout = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('Geçmiş performans hesabı zaman aşımına uğradı')), ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

/** Kayıtlı son sonuç; hiç çalışmadıysa ya da kayıt bozuksa result: null. */
export function last() {
  const running = !!inflight || innerBusy;
  try {
    const row = db.prepare('SELECT at, result FROM backtest_result WHERE id = 1').get();
    if (row) return { at: Number(row.at), result: JSON.parse(row.result), running };
  } catch { /* bozuk kayıt: yok say */ }
  return { at: null, result: null, running };
}

/** Hesaplayıp kaydeder. Koşu sürerken gelen ikinci çağrı aynı koşuyu bekler; zaman aşımından sonra iç koşu bitene kadar yenisi başlamaz. */
export function run({ timeoutMs = 300_000, work = compute } = {}) {
  if (inflight) return inflight;
  if (innerBusy) return Promise.reject(new Error('Önceki hesap hâlâ sürüyor; biraz sonra yeniden deneyin'));
  const job = work();
  innerBusy = true;
  job.then(() => {}, () => {}).then(() => { innerBusy = false; });
  inflight = withTimeout(job, timeoutMs)
    .then((result) => {
      const at = Date.now();
      db.prepare('INSERT INTO backtest_result(id, at, result) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, result = excluded.result').run(at, JSON.stringify(result));
      return { at, result, running: false };
    })
    .finally(() => { inflight = null; });
  return inflight;
}
```

Çalıştır: `BORSA_DATA_DIR=$(mktemp -d) node test/backtest-run.check.mjs`. Beklenen: `11 geçti, 0 başarısız`.

- [ ] **Step 3: Rotalar**

`server/index.js`, `import * as dataHealth from './denetim.js';` satırının altına:

```js
import * as backtest from './backtest-run.js';
```

`/api/data-health/run` rotasının altına:

```js
route('GET', '/api/backtest', async () => backtest.last());
route('POST', '/api/backtest/run', async () => { try { return await backtest.run(); } finally { broadcast({ t: 'backtest.updated' }); } }); // hata durumunda da: diğer pencereler "hesaplanıyor"da takılı kalmasın
```

- [ ] **Step 4: Canlı doğrulama (test örneği; canlı 7420 servisine dokunulmaz)**

```bash
D=$(mktemp -d); BORSA_PORT=7520 BORSA_REPORT_PORT=7521 BORSA_DATA_DIR=$D node server/index.js > $D/log.txt 2>&1 &
sleep 4; T=$(BORSA_DATA_DIR=$D ./bin/kmy gateway token); echo "token alındı: ${#T} karakter"
curl -s -H "Authorization: Bearer $T" localhost:7520/api/backtest
```

Beklenen: `{"at":null,"result":null,"running":false}`.

```bash
time curl -s -m 340 -X POST -H "Authorization: Bearer $T" localhost:7520/api/backtest/run | node -e "const j=JSON.parse(require('fs').readFileSync(0));const p=j.result.params;console.log('hisse',p.symbols,'atlanan',p.skipped.length,'kırılma',p.splitBreaks,'aralık',p.from,p.to);console.log('taban h=20',JSON.stringify(j.result.baseline[20]));console.log(Object.entries(j.result.signals).map(([k,s])=>k+' n='+s[20].n+' ort='+(s[20].mean*100).toFixed(1)+'% fark='+(s[20].delta*100).toFixed(1)+'%').join('\n'))"
```

Beklenen: hisse ≥ 50, tablo 11 sinyal, her satırda n > 0 ve makul değerler (günlük bazda |ort| %50'nin altında; sahte −%60 çöküş yok). Gördüğün sayıları not et (Task 4 CHANGELOG'u için değil, yalnız makul mu diye).

```bash
curl -s -H "Authorization: Bearer $T" localhost:7520/api/backtest | node -e "const j=JSON.parse(require('fs').readFileSync(0));console.log('kalıcı:',!!j.result,'running:',j.running)"
kill %1; rm -rf $D
```

Beklenen: `kalıcı: true running: false`. Ağ kaynaklı hata (XU100 yok vb.) olursa: yanıtın hata iletisi olmalı ve `GET` önceki sonucu (yoksa `null`) döndürmeli.

- [ ] **Step 5: Commit**

```bash
git add server/backtest-run.js server/index.js test/backtest-run.check.mjs
git commit -m "Backtest: veri çekimi, kalıcı sonuç, tek-koşu kilidi ve API"
```

---

### Task 3: Arayüz paneli

**Files:**
- Create: `web/js/backtest-view.js`
- Modify: `web/js/market-view.js` (import + panel + başlatma), `web/js/lang/en/market.js`, `web/terminal.css`

**Interfaces:**
- Consumes: `GET /api/backtest`, `POST /api/backtest/run`, WS olayı `backtest.updated`, çekirdekten `on, api, $, esc, num, cls, dateTR, timeTR, toast`.
- Produces: `initBacktest(boxElement)`.

- [ ] **Step 1: Modül**

Dosya `web/js/backtest-view.js`:

```js
// Sinyal geçmiş performansı paneli (tarayıcı sayfası). Veri: /api/backtest; hesap elle başlatılır.
import { on, api, $, esc, num, cls, dateTR, timeTR, toast } from './core.js';
import { t, tx } from './i18n.js';

const H = [5, 20, 60];
let data = null, running = false, lastError = '', timer = 0;
const busy = () => running || !!data?.running;
const p1 = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${num(x * 100, 1)}%`);
const hit = (x) => (x == null ? '—' : `${num(x * 100, 0)}%`);

function table(r) {
  const base = r.baseline;
  const baseRow = `<tr class="dim"><td>${t('Taban (her gün)')}</td>${H.map((h) => `<td class="r num">${base[h].n}</td><td class="r num">${p1(base[h].mean)}</td><td class="r num">${hit(base[h].hitUp)}</td><td class="r num">${p1(base[h].excess)}</td><td class="r num">—</td>`).join('')}</tr>`;
  const rows = Object.entries(r.signals).map(([k, s]) => `<tr><td><span class="pill ${s.dir === 'up' ? 'up' : s.dir === 'down' ? 'down' : ''}">${esc(tx(s.label))}</span></td>${H.map((h) => {
    const c = s[h];
    const low = c.low ? ` title="${t('az örnek')}"` : '';
    return `<td class="r num${c.low ? ' dim' : ''}"${low}>${c.n}${c.low && c.n ? ' ⚠' : ''}</td><td class="r num ${cls(c.mean)}">${p1(c.mean)}</td><td class="r num">${hit(c.hit)}</td><td class="r num ${cls(c.excess)}">${p1(c.excess)}</td><td class="r num ${cls(c.delta)}">${p1(c.delta)}</td>`;
  }).join('')}</tr>`).join('');
  const head1 = `<tr><th rowspan="2">${t('Sinyal')}</th>${H.map((h) => `<th colspan="5" class="r">${t('{n} gün', { n: h })}</th>`).join('')}</tr>`;
  const head2 = `<tr>${H.map(() => `<th class="r">n</th><th class="r">${t('Ort.')}</th><th class="r">${t('İsabet')}</th><th class="r">${t('XU100 farkı')}</th><th class="r">${t('Taban farkı')}</th>`).join('')}</tr>`;
  return `<div class="table-wrap kt-tall"><table class="t">${head1}${head2}${baseRow}${rows}</table></div>`;
}

function html() {
  const r = data?.result;
  const top = `<div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
    <span class="dim">${r ? `${t('{n} hisse', { n: r.params.symbols })} · ${esc(r.params.from)} → ${esc(r.params.to)} · ${t('hesaplandı {t}', { t: `${dateTR(data.at)} ${timeTR(data.at)}` })}` : ''}</span>
    <button class="ghost" id="btRun" ${busy() ? 'disabled' : ''}>${busy() ? `<span class="spinner"></span> ${t('hesaplanıyor… (birkaç dk)')}` : r ? t('Yeniden hesapla') : t('Hesapla')}</button></div>`;
  const err = lastError ? `<div class="kt-note down">${esc(lastError)}</div>` : '';
  const body = r ? table(r) : `<div class="dim">${t('Henüz hesaplanmadı. “Hesapla”ya basın: BIST 100 için 10 yıllık günlük veriyle her sinyalin sonraki 5/20/60 işlem gününde ne yaptığı ölçülür (birkaç dakika sürer).')}</div>`;
  const note = r ? `<p class="kt-note">${t('Geçmiş gelecekteki getiriyi garanti etmez. Yalnızca bugün BIST 100’de olan hisseler hesaba girer (hayatta kalma yanlılığı); getiriler nominal TL’dir (enflasyon dikkate alınmaz); örtüşen ve birbirine bağlı olaylar sonucu olduğundan güvenilir gösterir; işlem maliyeti yoktur; %25’ten küçük bölünmeler düzeltilemez. “Taban farkı”, sinyalin her günün ortalamasından ne kadar iyi olduğunu gösterir. ⚠ = 30’dan az örnek.')} ${t('Bölünme düzeltmesi: {n} kırılma.', { n: r.params.splitBreaks })}</p>` : '';
  return top + err + body + note;
}

export function initBacktest(box) {
  const paint = () => { box.innerHTML = html(); const b = $('#btRun', box); if (b) b.onclick = runNow; };
  async function load() {
    try { data = await api('/backtest'); } catch { /* önceki durum korunur */ }
    paint();
    clearTimeout(timer);
    if (data?.running) timer = setTimeout(load, 5000); // başka pencerede koşu sürerken: olay kaçarsa "hesaplanıyor"da takılı kalmaz
  }
  async function runNow() {
    if (busy()) return;
    running = true; lastError = ''; paint();
    try { data = await api('/backtest/run', { method: 'POST' }); }
    catch (e) { lastError = tx(e.message); toast(lastError, 'err'); }
    finally { running = false; }
    paint();
  }
  on('ws:backtest.updated', load);
  load();
}
```

- [ ] **Step 2: Sayfaya yerleştir**

`web/js/market-view.js` içe aktarmalarına (`import { t, tx, lang, locale } from './i18n.js';` satırının altına):

```js
import { initBacktest } from './backtest-view.js';
```

"Son sinyal bildirimleri" panelinin (`id="sigRecent"` satırı) hemen altına, aynı şablon dizesinin içinde:

```js
    ${panel(`${t('Sinyal geçmiş performansı')} ${sub(t('BIST 100 · 10 yıl · sonraki 5/20/60 işlem günü'))}`, `<div id="backtestBox"></div>`)}
```

`on('signals:changed', loadSigRecent); loadSigRecent();` satırlarının altına:

```js
initBacktest($('#backtestBox'));
```

- [ ] **Step 3: İngilizce metinler ve taşma kuralı**

`web/js/lang/en/market.js` içinde `'Sinyal radarı'` girdisinin yanına şu girdileri ekle (önce çakışma kontrolü: `grep -c` yerine `grep -n "'Ort.'\|'İsabet'\|'Hesapla'" web/js/lang/en/*.js` çalıştır; çıkan anahtarı yeniden ekleme):

```js
  'Sinyal geçmiş performansı': 'Signal track record',
  'BIST 100 · 10 yıl · sonraki 5/20/60 işlem günü': 'BIST 100 · 10 years · next 5/20/60 trading days',
  'Taban (her gün)': 'Baseline (every day)',
  '{n} gün': '{n} days',
  'az örnek': 'small sample',
  'Ort.': 'Avg.',
  'İsabet': 'Hit rate',
  'XU100 farkı': 'vs XU100',
  'Taban farkı': 'vs baseline',
  'Hesapla': 'Compute',
  'Yeniden hesapla': 'Recompute',
  'hesaplanıyor… (birkaç dk)': 'computing… (a few min)',
  'hesaplandı {t}': 'computed {t}',
  'Henüz hesaplanmadı. “Hesapla”ya basın: BIST 100 için 10 yıllık günlük veriyle her sinyalin sonraki 5/20/60 işlem gününde ne yaptığı ölçülür (birkaç dakika sürer).': 'Not computed yet. Press “Compute”: using 10 years of daily BIST 100 data, it measures what each signal did over the next 5/20/60 trading days (takes a few minutes).',
  'Geçmiş gelecekteki getiriyi garanti etmez. Yalnızca bugün BIST 100’de olan hisseler hesaba girer (hayatta kalma yanlılığı); getiriler nominal TL’dir (enflasyon dikkate alınmaz); örtüşen ve birbirine bağlı olaylar sonucu olduğundan güvenilir gösterir; işlem maliyeti yoktur; %25’ten küçük bölünmeler düzeltilemez. “Taban farkı”, sinyalin her günün ortalamasından ne kadar iyi olduğunu gösterir. ⚠ = 30’dan az örnek.': 'Past results do not guarantee future returns. Only stocks in today’s BIST 100 are included (survivorship bias); returns are nominal TRY (inflation is ignored); overlapping and correlated events make results look more reliable than they are; no trading costs; splits smaller than 25% cannot be adjusted. “vs baseline” shows how much better the signal did than the average day. ⚠ = fewer than 30 samples.',
  'Bölünme düzeltmesi: {n} kırılma.': 'Split adjustment: {n} breaks.',
```

(`{n} hisse` anahtarı radardan zaten var; yeniden ekleme.)

`web/terminal.css` sonuna (tablo dar pencerede yatay kayar; `.table-wrap` zaten taşmayı kaydırır, yalnız alt satır başlığının sabit genişliği için):

```css
#backtestBox table.t { min-width: 760px; }
#backtestBox th[rowspan] { vertical-align: bottom; }
```

- [ ] **Step 4: Tarayıcıda doğrula (1440 / 900 / 760 px, TR ve EN)**

Test örneğini Task 2 Step 4 gibi başlat (`7520`), aç, "Tarayıcı" sayfasına git:

1. Hesaplanmamış durum: boş açıklama metni ve "Hesapla" düğmesi görünür; konsol hatası yok.
2. "Hesapla"ya bas: düğme devre dışı, spinner; ikinci tıklama ikinci koşu başlatmaz. Bittiğinde tablo görünür: taban satırı + 11 sinyal × 3 ufuk, "az örnek" olanlar soluk ve ⚠, dipnot altta.
3. Sayfayı yenile: sonuç kalıcı (hesap tekrarlanmaz).
4. Koşu sürerken ikinci pencerede aç: "hesaplanıyor…" görünür, bitince 5 sn içinde tablo gelir.
5. Genişlik 1440/900/760: sayfa yatay kaymaz; tablo kendi kutusunda yatay kayar. Dil EN'e çevir: tüm başlıklar ve dipnot İngilizce, ham Türkçe anahtar kalmaz.
6. Ağ hatası simülasyonu: sunucuyu durdurup "Yeniden hesapla"ya bas; hata mesajı görünür, önceki tablo kalır, düğme tekrar etkinleşir.

Her adım için `read_page`/ekran görüntüsüyle kanıt al.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "Backtest: tarayıcı sayfasında sinyal geçmiş performansı paneli"
```

---

### Task 4: Belgeler, sürüm ve spec düzeltmesi

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `package.json` (version), `docs/superpowers/specs/2026-10-02-sinyal-backtest-design.md`

- [ ] **Step 1: Sürüm ve CHANGELOG**

`package.json` `"version"`: `0.20.0` → `0.21.0`. `CHANGELOG.md` en üste `0.20.0` girdisinin biçiminde bir `0.21.0` girdisi ekle: sinyal geçmiş performansı paneli (taban ve XU100 karşılaştırmalı, n/az örnek, elle hesap); sinyal tanımı tek dosyada (`sinyal-tanim.js`); **davranış notu:** bölünme düzeltmesi canlı radar ve sinyal bildirimlerinde de uygulanır, son bölünmeden sonra yanlış sinyal üretmez, bu nedenle bildirimlerde tek seferlik "yeni sinyal" görülebilir.

- [ ] **Step 2: README**

README'de sinyal radarının anlatıldığı yere iki cümle ekle: panelin ne ölçtüğü ve "geçmiş geleceği garanti etmez; tablo yalnızca elle hesaplanır".

- [ ] **Step 3: Spec düzeltmesi**

Spec'te "saf kod `radar.js` içinde" diyen yerleri "saf kod `server/sinyal-tanim.js`'te; `radar.js` geri dışa aktarır" olarak düzelt; spec'in dosya listesine `server/sinyal-tanim.js`, `server/seri.js` ekle.

- [ ] **Step 4: Tam test ve commit**

```bash
npm test 2>&1 | grep -E "geçti|başarısız"
git add -A README.md CHANGELOG.md package.json docs
git commit -m "0.21.0: sinyal geçmiş performansı"
```

Beklenen: tüm takımlar `0 başarısız`.

---

## Self-Review

- **Spec kapsamı:** ortak tanım + prefix eşdeğerliği (T1), `adjustSplits` hem backtest hem `scanBars` (T1), olay/gap/ısınma/getiri/taban/XU100/yön duyarlı isabet/az örnek (T1 motor+test), evren/zaman aşımı/kilit/kalıcılık/API/broadcast (T2), tablo + taban satırı + uyarılar + 5 sn yoklama (T3), sürüm/belge (T4). Kapsam dışı maddeler (sembol bazlı görünüm, ajan aracı, maliyet, anlamlılık testi, teknik analiz sayfası bölünme hatası, grafik ham fiyat) plana girmedi; teknik analiz sayfası hatası ayrıca raporlanır.
- **Yer tutucu taraması:** tüm kod blokları gerçek, çalıştırılmış dosya içeriğidir; "TBD/uygun hata işleme" yok.
- **Tip tutarlılığı:** `computeBacktest` çıktısı `{baseline, signals, params}`; `backtest-run.js` `params.skipped/universe/range` ekler; arayüz `r.params.symbols/from/to/splitBreaks`, `r.baseline[h].n/mean/hitUp/excess`, `r.signals[k].dir/label/[h].n/mean/hit/excess/delta/low` okur; hepsi motorla aynı.
- **Review Focus:** 5 maddenin testi yukarıda ilgili task'ta.

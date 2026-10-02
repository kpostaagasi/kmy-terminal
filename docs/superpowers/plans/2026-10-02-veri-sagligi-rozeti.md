# Veri sağlığı rozeti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run denetim`'in çapraz kaynak veri denetimini uygulamaya taşımak: durum çubuğunda son denetimi gösteren bir rozet, tıklayınca ayrıntı penceresi ve "Şimdi denetle" düğmesi (sürüm 0.20.0). Denetim yalnız elle çalışır.

**Architecture:** Saf çekirdek `server/`'a taşınır (`denetim-cekirdek.js`) ve rozet mantığı eklenir; canlı kontroller `server/denetim.js` modülüne taşınır, hem CLI hem sunucu onu çağırır (böylece uygulamanın gösterdiği fiyat yolu sınanır). Son sonuç tek satırlı `data_health` tablosunda saklanır; `GET /api/data-health` ve `POST /api/data-health/run`. Arayüz yeni `web/js/veri-sagligi.js` modülüdür.

**Tech Stack:** Node 22.13+ (ESM, `node:sqlite`, yerleşik `fetch`), mevcut `server/*.js`, vanilya JS arayüz. Yeni bağımlılık yok.

**Spec:** [docs/superpowers/specs/2026-10-02-veri-sagligi-rozeti-design.md](../specs/2026-10-02-veri-sagligi-rozeti-design.md)

## Global Constraints

- Ürün adı her zaman küçük harfle: **kmy terminal**. Rakip adı hiçbir dosyada, çıktıda ya da notta geçmez.
- Kişisel tutar çıktıya, kayda ve arayüze yazılmaz: portföy satırlarında `app` ve `ref` **null**.
- UI metinleri `t()` üzerinden, Türkçe kaynak metin anahtardır; İngilizce karşılıklar `web/js/lang/en/settings.js`'e eklenir.
- Yeni bağımlılık yok; mevcut kaynaklar (TCMB, İş Yatırım, TEFAS, KAP mali tablolar).
- `npm run denetim` komutu, çıktısı ve çıkış kodları (0 temiz, 1 sapma, 2 hiçbir şey doğrulanamadı) değişmez.
- Denetim **yalnız elle** çalışır; arka plan/zamanlanmış koşu yoktur.
- Hiçbir şey doğrulanamazsa (hepsi ATLANDI) rozet "temiz" olamaz (sahte yeşil yok).
- Her manuel koşuda İş Yatırım verisi `universe.refresh(true)` ile zorla tazelenir.
- Koşu yaklaşık **40 sn** sürer (ölçüldü: 41 sn); genel zaman aşımı 120 sn; arayüz metinleri "≈40 sn" der.
- `npm test` zincirine canlı ağ gerektiren test girmez; yeni testler çevrimdışıdır (`test/denetim.test.mjs`).
- Repo komut/commit stili: Türkçe mesaj; her commit şu satırla biter: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Çalışma dalı `veri-sagligi`; birleştirme kararı kullanıcıya aittir.

## Review Focus

Spec'in söylemediği ama kullanıcıyı ilk ısıracak durumlar (en olasıdan başlayarak):

1. **Hepsi ATLANDI iken yeşil rozet** (ağ yok, seans açık): `?` olmalı. → Görev 1: `rozetDurumu` testleri; Görev 3: tarayıcıda doğrulama.
2. **Çift tıklama / iki pencere aynı anda denetler:** tek koşu olmalı, ikinci istek aynı sonucu beklemeli. → Görev 2: canlı eşzamanlılık adımı; Görev 3: çift tıklama.
3. **Eski sonuç (24 saatten eski) yeşil kalır:** `(eski)` eki ve soluk renk. → Görev 1: `eskiMi` testleri; Görev 3: DB kaydını geriye alıp doğrulama.
4. **Portföy tutarı sızar:** kayıtlı sonuçta ve pencerede `app`/`ref` null. → Görev 2: depolanan satırlar kontrolü; Görev 3: pencere kontrolü.
5. **Bozuk/eksik kayıt ya da kaynak istisnası:** `GET` çökmez (`yok`), koşu hatası rozetin önceki durumunu bozmaz. → Görev 2: bozuk kayıt adımı; Görev 3: hata gösterimi.

---

## Dosya yapısı

| Dosya | Sorumluluk |
|---|---|
| `server/denetim-cekirdek.js` (taşınır: `scripts/denetim-cekirdek.mjs`) | Saf karşılaştırma/karar/rapor + yeni `ozet`, `rozetDurumu`, `eskiMi` |
| `server/denetim.js` (yeni) | Canlı kontroller (`runChecks`), son sonucun kalıcılığı, tek koşu, `run()` / `last()` |
| `scripts/veri-denetimi.mjs` (değişir) | Evre 1 aynı; evre 2 `runChecks` çağırıp aynı çıktıyı verir |
| `server/index.js` (değişir) | `GET /api/data-health`, `POST /api/data-health/run` |
| `web/js/veri-sagligi.js` (yeni) | Rozet ve ayrıntı penceresi |
| `web/index.html`, `web/styles.css`, `web/js/app.js` (değişir) | Rozet öğesi, stil, modül yüklemesi |
| `web/js/lang/en/settings.js` (değişir) | İngilizce karşılıklar |
| `test/denetim.test.mjs` (değişir) | İçe aktarma yolu + 14 yeni kontrol |
| `README.md`, `CHANGELOG.md`, spec, `package.json` (değişir) | Belge ve sürüm |

---

### Task 1: Çekirdeği taşı ve rozet mantığını ekle

**Files:**
- Move: `scripts/denetim-cekirdek.mjs` → `server/denetim-cekirdek.js`
- Modify: `scripts/veri-denetimi.mjs` (içe aktarma yolu), `test/denetim.test.mjs`

**Interfaces:**
- Produces (Görev 2 ve 3'ün kullandığı):
  - Mevcut dışa aktarımlar aynen: `TOLERANS`, `SAF_GR`, `karsilastir`, `guard`, `gramRef`, `gramKarar`, `fxKarar`, `hisseKarar`, `etiketKarar`, `donemAnahtar`, `temelKarar`, `portfoyKarar`, `rapor`, `cikisKodu`.
  - Yeni: `ozet(results) → { ok, sapma, atlandi }`, `rozetDurumu(results) → 'yok'|'uyari'|'dogrulanamadi'|'temiz'`, `eskiMi(at, now?) → boolean`, `ESKI_MS = 86_400_000`.
  - Sonuç satırı: `{ grup, ad, durum: 'OK'|'SAPMA'|'ATLANDI', sapmaPct?, app?, ref?, neden? }`.

- [ ] **Step 1: Dal aç, dosyayı taşı, içe aktarma yollarını güncelle**

```bash
git checkout -b veri-sagligi
git mv scripts/denetim-cekirdek.mjs server/denetim-cekirdek.js
sed -i '' "s#'../scripts/denetim-cekirdek.mjs'#'../server/denetim-cekirdek.js'#" test/denetim.test.mjs
sed -i '' "s#await import('./denetim-cekirdek.mjs')#await import('../server/denetim-cekirdek.js')#" scripts/veri-denetimi.mjs
grep -n "denetim-cekirdek" test/denetim.test.mjs scripts/veri-denetimi.mjs
```
Expected: iki satır: `test/denetim.test.mjs:2:… '../server/denetim-cekirdek.js'` ve `scripts/veri-denetimi.mjs:…await import('../server/denetim-cekirdek.js')`.

- [ ] **Step 2: Taşımanın hiçbir şeyi bozmadığını doğrula**

Run: `node test/denetim.test.mjs | tail -1; node scripts/veri-denetimi.mjs 2>/dev/null | tail -1`
Expected: `62 geçti, 0 başarısız` ve `OK … · SAPMA 0 · ATLANDI …` (CLI çalışır; sayılar piyasa durumuna göre değişir, SAPMA 0 olmalı).

- [ ] **Step 3: Başarısız testi yaz**

`test/denetim.test.mjs` içinde, dosyanın sonundaki `console.log(\`\n${pass} geçti, ${fail} başarısız\`);` satırından **hemen önce** şu bloğu ekle:

```js
// ── ozet / rozetDurumu / eskiMi (veri sağlığı rozeti) ─────────────────────
const SR = (d) => ({ grup: 'G', ad: 'a', durum: d });
const o1 = K.ozet([SR('OK'), SR('OK'), SR('SAPMA'), SR('ATLANDI'), SR('ATLANDI'), SR('ATLANDI')]);
assert('ozet sayımı', o1.ok === 2 && o1.sapma === 1 && o1.atlandi === 3, JSON.stringify(o1));
assert('ozet boş / null girdi', K.ozet([]).ok === 0 && K.ozet(null).sapma === 0 && K.ozet(undefined).atlandi === 0);
assert('ozet bilinmeyen durum satırını saymaz', (() => { const o = K.ozet([SR('OK'), SR('???')]); return o.ok === 1 && o.sapma === 0 && o.atlandi === 0; })());
assert('rozet: sonuç yok (null) → yok', K.rozetDurumu(null) === 'yok' && K.rozetDurumu(undefined) === 'yok');
assert('rozet: boş liste → yok', K.rozetDurumu([]) === 'yok');
assert('rozet: 1 SAPMA → uyari', K.rozetDurumu([SR('OK'), SR('SAPMA')]) === 'uyari');
assert('rozet: SAPMA öncelikli (çok OK olsa da)', K.rozetDurumu([...Array(20).fill(SR('OK')), SR('SAPMA')]) === 'uyari');
assert('rozet: hepsi ATLANDI → dogrulanamadi (sahte yeşil yok)', K.rozetDurumu([SR('ATLANDI'), SR('ATLANDI')]) === 'dogrulanamadi');
assert('rozet: OK + ATLANDI → temiz', K.rozetDurumu([SR('OK'), SR('ATLANDI')]) === 'temiz');
assert('rozet: yalnız OK → temiz', K.rozetDurumu([SR('OK')]) === 'temiz');
const H24 = 24 * 3600_000, N = 1_000_000_000_000;
assert('eskiMi: tam 24 saat eski değil', K.eskiMi(N - H24, N) === false);
assert('eskiMi: 24 saat + 1 ms eski', K.eskiMi(N - H24 - 1, N) === true);
assert('eskiMi: yeni sonuç değil', K.eskiMi(N - 1000, N) === false);
assert('eskiMi: at null → false', K.eskiMi(null, N) === false && K.eskiMi(undefined, N) === false);
```

- [ ] **Step 4: Testin başarısız olduğunu doğrula**

Run: `node test/denetim.test.mjs 2>&1 | grep -E "TypeError|FAIL" | head -3`
Expected: `TypeError: K.ozet is not a function`.

- [ ] **Step 5: Çekirdeğe fonksiyonları ekle**

`server/denetim-cekirdek.js` dosyasının sonuna ekle:

```js
/** { ok, sapma, atlandi } sayımı; bilinmeyen durumlu satırlar sayılmaz. */
export function ozet(results) {
  const say = (d) => (results || []).filter((r) => r.durum === d).length;
  return { ok: say('OK'), sapma: say('SAPMA'), atlandi: say('ATLANDI') };
}

/** Rozet durumu: 'yok' (hiç çalışmadı) · 'uyari' (SAPMA var) · 'dogrulanamadi' (hepsi ATLANDI: sahte yeşil yok) · 'temiz'. */
export function rozetDurumu(results) {
  if (!results || !results.length) return 'yok';
  const o = ozet(results);
  if (o.sapma) return 'uyari';
  return o.ok ? 'temiz' : 'dogrulanamadi';
}

/** Son denetim bu süreden eskiyse rozet "eski" işaretlenir. */
export const ESKI_MS = 24 * 3600_000;
export const eskiMi = (at, now = Date.now()) => at != null && now - at > ESKI_MS;
```

- [ ] **Step 6: Testin geçtiğini doğrula**

Run: `node test/denetim.test.mjs | tail -1`
Expected: `76 geçti, 0 başarısız` (62 mevcut + 14 yeni), `FAIL` satırı yok.

- [ ] **Step 7: Tüm paketi çalıştır ve commit**

Run: `npm test > /tmp/_dh1.log 2>&1; echo "çıkış=$?"; grep -c "^FAIL" /tmp/_dh1.log`
Expected: `çıkış=0`, `0`.

```bash
git add server/denetim-cekirdek.js test/denetim.test.mjs scripts/veri-denetimi.mjs
git commit -m "Veri sağlığı: denetim çekirdeği server/'a taşındı, rozet mantığı (ozet, rozetDurumu, eskiMi)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Sunucu modülü, CLI sarmalayıcısı ve API

**Files:**
- Create: `server/denetim.js`
- Modify: `scripts/veri-denetimi.mjs`, `server/index.js`

**Interfaces:**
- Consumes: Görev 1'in `server/denetim-cekirdek.js` dışa aktarımları. Uygulamadan: `getQuotes`, `marketStatus` (`server/market.js`); `universe.refresh(force)`, `universe.status()`, `universe.stock(code)`; `tcmbRates()`, `financials(symbol, n)` (`server/feeds.js`); `pf.summary()` (`server/portfolio.js`); `db` (`server/db.js`).
- Produces: `runChecks({ portfoy }) → rows[]`, `run() → Promise<View>`, `last() → View` (View = `{ at: number|null, summary: { ok, sapma, atlandi }, state, stale, results, running }`); `GET /api/data-health`, `POST /api/data-health/run`; WebSocket `{ t: 'data-health.updated' }`; CLI aynı çıktı.

- [ ] **Step 1: Sunucu modülünü yaz**

`server/denetim.js` dosyasını şu içerikle oluştur:

```js
// Veri sağlığı: uygulamanın gösterdiği veriyi bağımsız ikinci kaynakla karşılaştırır (kurallar: denetim-cekirdek.js).
// Hem `npm run denetim` (scripts/veri-denetimi.mjs) hem de arayüzdeki "Veri sağlığı" rozeti bunu kullanır.
import { db } from './db.js';
import { getQuotes, marketStatus } from './market.js';
import * as universe from './universe.js';
import { tcmbRates, financials } from './feeds.js';
import * as pf from './portfolio.js';
import * as K from './denetim-cekirdek.js';

db.exec('CREATE TABLE IF NOT EXISTS data_health (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL, results TEXT NOT NULL)');

const dk = 60_000;
const SEMBOLLER = ['USDTRY', 'EURTRY', 'GRAM', 'ONS', 'CEYREK', 'YARIM', 'TAM'];
const HISSELER = ['THYAO', 'ASELS', 'GARAN', 'BIMAS', 'TUPRS'];
const FONLAR = ['TTE', 'AFT'];

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

/** Tüm kontrolleri çalıştırır; satır biçimi: { grup, ad, durum, sapmaPct?, app?, ref?, neden? }. portfoy: toplamları yeniden topla. */
export async function runChecks({ portfoy = true } = {}) {
  const sonuc = [];
  const ekle = (grup, ad, r) => sonuc.push({ grup, ...r, ad });
  const dene = async (grup, ad, fn) => ekle(grup, ad, await K.guard(fn));

  const seans = marketStatus();
  const q = await getQuotes([...SEMBOLLER, ...HISSELER, ...FONLAR]).catch(() => ({}));
  const fiyat = (s) => q[s]?.price;

  // Döviz: TCMB gösterge kuru (alış/satış ortası).
  const tcmb = await tcmbRates().catch(() => null);
  const tcmbOrta = (kod) => { const r = tcmb?.rates?.[kod]; return r ? (r.forexBuying + r.forexSelling) / 2 : null; };
  for (const [s, kod] of [['USDTRY', 'USD'], ['EURTRY', 'EUR']]) {
    await dene('Döviz', s, async () => K.fxKarar({ app: fiyat(s), ref: tcmbOrta(kod) }));
  }

  // Altın: ons × kur ÷ 31,1035 ve geleneksel altınların saf gram karşılığı.
  const gram = K.gramRef(fiyat('ONS'), fiyat('USDTRY'));
  await dene('Altın', 'GRAM', async () => K.gramKarar(q.GRAM, q.ONS, q.USDTRY));
  for (const s of Object.keys(K.SAF_GR)) {
    await dene('Altın türü', s, async () => K.karsilastir(fiyat(s), gram == null ? null : gram * K.SAF_GR[s], K.TOLERANS.altinTuru));
  }

  // Hisse: Yahoo (uygulama) ↔ İş Yatırım kapanışı. İş Yatırım verisi zorla tazelenir: eski önbellek (gün içi kapanış) yalancı SAPMA üretirdi.
  const basla = Date.now();
  await universe.refresh(true).catch(() => {});
  const isyTaze = (universe.status().at ?? 0) >= basla;
  for (const s of HISSELER) {
    await dene('Hisse', s, async () => K.hisseKarar({ app: fiyat(s), ref: universe.stock(s)?.close, seansAcik: seans.open, isyTaze }));
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
    for (const r of K.temelKarar(f, isyTaze ? universe.stock(s) : null)) ekle('Temel', `${s} ${r.ad}`, r);
  }

  // Portföy: toplamlar bileşenlerden yeniden toplanır. Kişisel tutarlar yazılmaz; yalnız durum ve sapma yüzdesi.
  if (portfoy) {
    const s = await pf.summary().catch(() => null);
    for (const r of K.portfoyKarar(s)) ekle('Portföy', r.ad, { ...r, app: null, ref: null });
  }
  return sonuc;
}

// ── Son sonuç: kalıcılık, tek koşu, görünüm ──────────────────────────────
let inflight = null;

const withTimeout = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('Denetim zaman aşımı')), ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

const view = (results, at, running) => ({ at, summary: K.ozet(results), state: K.rozetDurumu(results), stale: K.eskiMi(at), results, running });

/** Kayıtlı son sonuç (hiç çalışmadıysa ya da kayıt bozuksa state: 'yok'). */
export function last() {
  const running = !!inflight;
  try {
    const row = db.prepare('SELECT at, results FROM data_health WHERE id = 1').get();
    if (row) return view(JSON.parse(row.results), Number(row.at), running);
  } catch { /* bozuk kayıt: yok say */ }
  return view([], null, running);
}

/** Denetimi çalıştırıp kaydeder. Koşu sürerken gelen ikinci çağrı aynı koşunun sonucunu bekler. */
export function run() {
  if (!inflight) {
    inflight = withTimeout(runChecks(), 120_000)
      .then((results) => {
        const at = Date.now();
        db.prepare('INSERT INTO data_health(id, at, results) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, results = excluded.results').run(at, JSON.stringify(results));
        return view(results, at, false);
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}
```

- [ ] **Step 2: CLI'nin evre 2'sini sarmalayıcıya çevir**

`scripts/veri-denetimi.mjs` içinde `// Evre 2: kontroller.` satırından dosyanın sonuna kadar olan her şeyi sil ve yerine şunu yaz (evre 1 ve üstündeki başlık değişmez):

```js
// Evre 2: kontroller (server/denetim.js; arayüzdeki "Veri sağlığı" rozeti de aynı fonksiyonu kullanır).
const K = await import('../server/denetim-cekirdek.js');
const { runChecks } = await import('../server/denetim.js');
const sonuc = await runChecks({ portfoy: flag('--portfoy') });

console.log(flag('--json') ? JSON.stringify(sonuc, null, 2) : K.rapor(sonuc));
process.exit(K.cikisKodu(sonuc));
```

Run: `node --check scripts/veri-denetimi.mjs && node --check server/denetim.js && echo ok`
Expected: `ok`.

- [ ] **Step 3: CLI'nin davranışının değişmediğini doğrula**

Run:
```bash
node scripts/veri-denetimi.mjs --portfoy 2>/dev/null | tail -4; echo "çıkış=${pipestatus[1]}"
node scripts/veri-denetimi.mjs --json 2>/dev/null | node -e "const a=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(Array.isArray(a), a.length, a.filter(r=>r.grup==='Portföy').length)"
```
Expected: ilk komutun son satırı `OK n · SAPMA 0 · ATLANDI k` ve `çıkış=0` (SAPMA yoksa); içinde `Portföy | …` satırları görünür. İkinci komut (`--portfoy` olmadan) `true 30 0` yazar: 30 satır, portföy satırı yok.

- [ ] **Step 4: Sunucu modülünü canlı çalıştır (CLI ile aynı sayılar, tek koşu, kalıcılık, gizlilik)**

Run:
```bash
T=/tmp/kmy-dh && rm -rf $T && mkdir -p $T && for e in "" -wal -shm; do f="$HOME/Library/Application Support/kmy terminal/data/borsa.db$e"; [ -f "$f" ] && cp "$f" "$T/borsa.db$e"; done
BORSA_DATA_DIR=$T node --input-type=module -e "
const dh = await import('./server/denetim.js');
const before = dh.last(); console.log('koşu öncesi:', before.state, before.at);
const t0 = Date.now();
const [a, b] = await Promise.all([dh.run(), dh.run()]);
console.log('süre', Math.round((Date.now() - t0) / 1000), 'sn | tek koşu (aynı at):', a.at === b.at, '| özet', JSON.stringify(a.summary), '| durum', a.state, '| eski', a.stale, '| running', a.running);
const l = dh.last(); console.log('kalıcı:', l.at === a.at, '| satır', l.results.length);
const port = l.results.filter(r => r.grup === 'Portföy'); console.log('portföy satırı', port.length, '| app/ref null:', port.every(r => r.app == null && r.ref == null));
" 2>&1 | grep -v -e Warning -e trace-warnings
```
Expected: `koşu öncesi: yok null`; `süre` 20–60 sn; `tek koşu (aynı at): true`; `özet {"ok":26,"sapma":0,"atlandi":7}` civarı (CLI `--portfoy` ile aynı sayılar), `durum temiz`, `eski false`, `running false`; `kalıcı: true | satır 33`; `portföy satırı 3 | app/ref null: true`. Planı yazarken (2 Ekim 2026) çıktı: 26 / 0 / 7, 41 sn.

- [ ] **Step 5: Bozuk kayıt ve yeniden başlatma (Review Focus 5)**

Run:
```bash
BORSA_DATA_DIR=/tmp/kmy-dh node --input-type=module -e "
const dh = await import('./server/denetim.js');
console.log('yeniden başlatma sonrası:', dh.last().state, dh.last().summary.ok, 'OK');
const { db } = await import('./server/db.js');
db.prepare(\"UPDATE data_health SET results = 'bozuk{json' WHERE id = 1\").run();
const l = dh.last(); console.log('bozuk kayıt →', l.state, l.at, l.results.length);
" 2>&1 | grep -v -e Warning -e trace-warnings
```
Expected: `yeniden başlatma sonrası: temiz 26 OK` (yeni süreç kaydı okur); `bozuk kayıt → yok null 0` (çökme yok).

- [ ] **Step 6: API rotalarını ekle**

`server/index.js` içinde `import * as calendarSource from './takvim-kaynak.js';` satırından hemen sonra ekle:

```js
import * as dataHealth from './denetim.js';
```

`route('GET', '/api/calendar', async ({ q }) => calendarSource.calendar({` satırından **hemen önce** ekle:

```js
route('GET', '/api/data-health', async () => dataHealth.last());
route('POST', '/api/data-health/run', async () => { const r = await dataHealth.run(); broadcast({ t: 'data-health.updated' }); return r; });
```

Run: `node --check server/index.js && echo ok`
Expected: `ok`.

- [ ] **Step 7: Tam paketi çalıştır, geçici verileri sil, commit**

Run: `rm -rf /tmp/kmy-dh; npm test > /tmp/_dh2.log 2>&1; echo "çıkış=$?"; grep -c "^FAIL" /tmp/_dh2.log`
Expected: `çıkış=0`, `0`.

```bash
git add server/denetim.js scripts/veri-denetimi.mjs server/index.js
git commit -m "Veri sağlığı: sunucu modülü (runChecks, run, last), CLI sarmalayıcısı ve API

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rozet ve "Veri sağlığı" penceresi (arayüz)

**Files:**
- Create: `web/js/veri-sagligi.js`
- Modify: `web/index.html`, `web/styles.css`, `web/js/app.js`, `web/js/lang/en/settings.js`

**Interfaces:**
- Consumes: `GET /api/data-health` ve `POST /api/data-health/run` yanıtı (Görev 2): `{ at, summary: { ok, sapma, atlandi }, state: 'yok'|'temiz'|'uyari'|'dogrulanamadi', stale, results: [{ grup, ad, durum, sapmaPct, app, ref, neden }], running }`; WebSocket `data-health.updated`. Çekirdekten (`core.js`): `on`, `api`, `$`, `$$`, `esc`, `num`, `toast`, `modal` (`{ el, body, close }` döner), `timeTR`, `dateTR`.
- Produces: durum çubuğunda `#dhBadge` düğmesi ve ayrıntı penceresi.

- [ ] **Step 1: Rozet öğesini ekle**

`web/index.html` içinde `<span class="freshness" id="quoteFresh" title="Fiyat akışının son güncellemesi"></span>` satırından hemen sonra ekle:

```html
    <button class="dh-badge dh-none" id="dhBadge" type="button"></button>
```

- [ ] **Step 2: Stil ekle**

`web/styles.css` içinde `.statusbar .freshness:empty { display: none; }` satırından hemen sonra ekle:

```css
.statusbar .dh-badge { background: none; border: 0; padding: 0 4px; min-height: 22px; font: inherit; letter-spacing: .04em; color: var(--text-3); cursor: pointer; white-space: nowrap; }
.statusbar .dh-badge:hover { color: var(--text); }
.statusbar .dh-badge.dh-ok { color: var(--up); }
.statusbar .dh-badge.dh-warn { color: var(--down); }
.statusbar .dh-badge.dh-old { opacity: .6; }
```

- [ ] **Step 3: Modülü yaz ve yükle**

`web/js/veri-sagligi.js` dosyasını şu içerikle oluştur:

```js
// Veri sağlığı rozeti: durum çubuğunda son çapraz kaynak denetiminin sonucu; tıklayınca ayrıntı ve "Şimdi denetle".
// Denetim yalnız elle çalışır (sunucu: server/denetim.js · GET /api/data-health, POST /api/data-health/run).
import { on, api, $, esc, num, toast, modal, timeTR, dateTR } from './core.js';
import { t, tx } from './i18n.js';

const badge = $('#dhBadge');
const ESKI_MS = 24 * 3600_000; // sunucudaki eskiMi (server/denetim-cekirdek.js) ile aynı kural
let data = null;      // son GET/POST yanıtı
let running = false;  // bu pencerede koşu sürüyor
let panel = null;     // açık pencere (modal nesnesi)
let lastError = '';

const isStale = () => data?.at != null && Date.now() - data.at > ESKI_MS;
const busy = () => running || !!data?.running;
const fmt = (v) => (v == null ? '—' : String(Number(Number(v).toPrecision(6))));
const STATE_CLS = { temiz: 'dh-ok', uyari: 'dh-warn', dogrulanamadi: 'dh-unk', yok: 'dh-none' };
const DURUM = { OK: ['OK', 'up'], SAPMA: [t('SAPMA'), 'down'], ATLANDI: [t('ATLANDI'), ''] };

// Sunucu satırları Türkçe gelir; bilinen grup, kontrol adı ve neden metinleri bağlamlı anahtarlarla çevrilir (dinamik nedenler olduğu gibi kalır).
const GRUP = { 'Döviz': t('[denetim]Döviz'), 'Altın': t('[denetim]Altın'), 'Altın türü': t('[denetim]Altın türü'), 'Hisse': t('[denetim]Hisse'), 'Tazelik': t('[denetim]Tazelik'), 'Temel': t('[denetim]Temel oranlar'), 'Portföy': t('[denetim]Portföy') };
const AD = { 'Σ pozisyon değeri': t('[denetim]Σ pozisyon değeri'), 'Σ platform değeri': t('[denetim]Σ platform değeri'), 'Toplam değer': t('[denetim]Toplam değer'), 'FAVÖK': t('[denetim]FAVÖK'), 'Net kâr': t('[denetim]Net kâr'), 'F/K': t('[denetim]F/K') };
const NEDEN = {
  'değer yok': t('[denetim]değer yok'),
  'seans açık; kapanış değeri karşılaştırılamaz': t('[denetim]seans açık; kapanış değeri karşılaştırılamaz'),
  'İş Yatırım verisi tazelenemedi (eski önbellek)': t('[denetim]İş Yatırım verisi tazelenemedi (eski önbellek)'),
  'yedek kaynak (Truncgil yok)': t('[denetim]yedek kaynak (Truncgil yok)'),
  'TCMB kuru önceki iş gününe ait (pazar/pazartesi)': t('[denetim]TCMB kuru önceki iş gününe ait (pazar/pazartesi)'),
  'banka için FAVÖK anlamsız': t('[denetim]banka için FAVÖK anlamsız'),
  'ham satır yok': t('[denetim]ham satır yok'),
  '12 aylık net kâr veya piyasa değeri yok/≤0': t('[denetim]12 aylık net kâr veya piyasa değeri yok/≤0'),
  'pozisyon yok': t('[denetim]pozisyon yok'),
  'eksik kur var': t('[denetim]eksik kur var'),
  'fiyat yok': t('[denetim]fiyat yok'),
};
const adLabel = (ad) => { const m = /^(\S+) (FAVÖK|Net kâr|F\/K)$/.exec(ad); return m ? `${m[1]} ${AD[m[2]]}` : AD[ad] || ad; };

function paintBadge() {
  const state = data?.state || 'yok';
  const o = data?.summary || { ok: 0, sapma: 0, atlandi: 0 };
  const hm = timeTR(data?.at);
  const text = { temiz: `✓ ${hm}`, uyari: `⚠ ${o.sapma}`, dogrulanamadi: '?', yok: `· ${t('denetlenmedi')}` }[state];
  badge.className = `dh-badge ${STATE_CLS[state]}${isStale() ? ' dh-old' : ''}`;
  badge.textContent = `${t('VERİ')} ${text}${isStale() ? ` (${t('eski')})` : ''}${busy() ? ' …' : ''}`;
  badge.title = state === 'yok'
    ? t('Henüz denetlenmedi. Tıklayıp “Şimdi denetle”ye basın.')
    : `${t('OK {ok} · SAPMA {sapma} · ATLANDI {atlandi}', o)} · ${t('son denetim {t}', { t: hm })}`;
}

function rowsHtml() {
  if (!data || data.state === 'yok') return `<p class="dim">${t('Henüz denetlenmedi. “Şimdi denetle” bağımsız ikinci kaynaklarla karşılaştırır (yaklaşık 40 sn).')}</p>`;
  const rank = { SAPMA: 0, OK: 1, ATLANDI: 2 };
  const rows = (g) => data.results.filter((r) => r.grup === g).sort((a, b) => (rank[a.durum] ?? 3) - (rank[b.durum] ?? 3));
  const worst = (g) => Math.min(...rows(g).map((r) => rank[r.durum] ?? 3));
  const groups = [...new Set(data.results.map((r) => r.grup))].sort((a, b) => worst(a) - worst(b)); // SAPMA içeren gruplar önce
  return groups.map((g) => `<div class="kt-mini-h" style="margin-top:10px">${esc(GRUP[g] || g)}</div><div class="table-wrap"><table class="t"><tbody>${rows(g).map((r) => {
    const [label, cls] = DURUM[r.durum] || [r.durum, ''];
    const vals = r.grup === 'Portföy' || (r.app == null && r.ref == null) ? '' : `${fmt(r.app)} ↔ ${fmt(r.ref)}`; // portföy tutarı asla gösterilmez
    return `<tr><td>${esc(adLabel(r.ad))}</td><td><span class="pill ${cls}">${esc(label)}</span></td><td class="r num">${r.sapmaPct == null ? '—' : `%${num(r.sapmaPct, 3)}`}</td><td class="r num dim">${esc(vals)}</td><td class="dim kt-wrap">${esc(NEDEN[r.neden] || r.neden || '')}</td></tr>`;
  }).join('')}</tbody></table></div>`).join('');
}

function panelHtml() {
  const summary = data?.at ? `${t('OK {ok} · SAPMA {sapma} · ATLANDI {atlandi}', data.summary)} · ${t('son denetim {t}', { t: `${dateTR(data.at)} ${timeTR(data.at)}` })}` : '';
  return `<div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
    <span id="dhSum">${esc(summary)}</span>
    <button class="btn" id="dhRun" ${busy() ? 'disabled' : ''}>${busy() ? `<span class="spinner"></span> ${t('denetleniyor… (≈40 sn)')}` : t('Şimdi denetle')}</button>
  </div>
  ${lastError ? `<div class="kt-note down">${esc(lastError)}</div>` : ''}
  <div id="dhRows">${rowsHtml()}</div>
  <p class="stg-note dim" style="margin-top:10px">${t('ATLANDI hata değildir, doğrulanamadı demektir (seans açık, kaynağa erişilemedi…). Denetim bağımsız ikinci kaynaklarla karşılaştırır: TCMB, İş Yatırım, TEFAS, KAP mali tabloları.')}</p>`;
}

function bindPanel() { const b = $('#dhRun', panel.body); if (b) b.onclick = runNow; }
function repaint() {
  paintBadge();
  if (panel?.el.isConnected) { panel.body.innerHTML = panelHtml(); bindPanel(); }
}

async function runNow() {
  if (busy()) return; // çift tıklama ikinci koşu başlatmaz
  running = true; lastError = ''; repaint();
  try { data = await api('/data-health/run', { method: 'POST' }); }
  catch (e) { lastError = tx(e.message); if (!panel?.el.isConnected) toast(lastError, 'err'); } // rozet önceki durumunu korur
  finally { running = false; }
  repaint();
}

async function load() {
  try { data = await api('/data-health'); } catch { /* rozet önceki durumunu korur */ }
  repaint();
}

badge.onclick = () => {
  lastError = '';
  panel = modal({ title: t('Veri sağlığı'), body: panelHtml(), wide: true, onClose: () => { panel = null; } });
  bindPanel();
};
on('ws:data-health.updated', load); // başka pencerede koşu bitti
setInterval(paintBadge, 10 * 60_000); // açık bırakılan uygulamada rozet kendiliğinden "eski"ye döner
load();
```

`web/js/app.js` içinde `import './kap.js';` satırından hemen sonra ekle:

```js
import './veri-sagligi.js';
```

- [ ] **Step 4: İngilizce karşılıklar**

`web/js/lang/en/settings.js` içinde `export default {` satırından hemen sonra ekle:

```js
  // ── Veri sağlığı rozeti ──
  'VERİ': 'DATA',
  'denetlenmedi': 'not audited',
  'eski': 'stale',
  'Henüz denetlenmedi. Tıklayıp “Şimdi denetle”ye basın.': 'Not audited yet. Click and press “Audit now”.',
  'OK {ok} · SAPMA {sapma} · ATLANDI {atlandi}': 'OK {ok} · MISMATCH {sapma} · SKIPPED {atlandi}',
  'son denetim {t}': 'last audit {t}',
  'Veri sağlığı': 'Data health',
  'Şimdi denetle': 'Audit now',
  'denetleniyor… (≈40 sn)': 'auditing… (≈40 s)',
  'Henüz denetlenmedi. “Şimdi denetle” bağımsız ikinci kaynaklarla karşılaştırır (yaklaşık 40 sn).': 'Not audited yet. “Audit now” compares against independent second sources (about 40 s).',
  'ATLANDI hata değildir, doğrulanamadı demektir (seans açık, kaynağa erişilemedi…). Denetim bağımsız ikinci kaynaklarla karşılaştırır: TCMB, İş Yatırım, TEFAS, KAP mali tabloları.': 'SKIPPED is not an error: it means the value could not be verified (market open, source unreachable…). The audit compares against independent second sources: CBRT, İş Yatırım, TEFAS, KAP financial statements.',
  'SAPMA': 'MISMATCH',
  'ATLANDI': 'SKIPPED',
  '[denetim]Döviz': 'FX',
  '[denetim]Altın': 'Gold',
  '[denetim]Altın türü': 'Gold coin/bar type',
  '[denetim]Hisse': 'Stocks',
  '[denetim]Tazelik': 'Freshness',
  '[denetim]Temel oranlar': 'Fundamentals',
  '[denetim]Portföy': 'Portfolio',
  '[denetim]Σ pozisyon değeri': 'Σ position value',
  '[denetim]Σ platform değeri': 'Σ platform value',
  '[denetim]Toplam değer': 'Total value',
  '[denetim]FAVÖK': 'EBITDA',
  '[denetim]Net kâr': 'Net income',
  '[denetim]F/K': 'P/E',
  '[denetim]değer yok': 'no value',
  '[denetim]seans açık; kapanış değeri karşılaştırılamaz': 'market open; closing value cannot be compared',
  '[denetim]İş Yatırım verisi tazelenemedi (eski önbellek)': 'İş Yatırım data could not be refreshed (stale cache)',
  '[denetim]yedek kaynak (Truncgil yok)': 'fallback source (Truncgil unavailable)',
  '[denetim]TCMB kuru önceki iş gününe ait (pazar/pazartesi)': 'CBRT rate belongs to the previous business day (Sunday/Monday)',
  '[denetim]banka için FAVÖK anlamsız': 'EBITDA is not meaningful for banks',
  '[denetim]ham satır yok': 'no raw row',
  '[denetim]12 aylık net kâr veya piyasa değeri yok/≤0': '12-month net income or market cap missing/≤0',
  '[denetim]pozisyon yok': 'no holdings',
  '[denetim]eksik kur var': 'missing FX rate',
  '[denetim]fiyat yok': 'no price',
  // ── /Veri sağlığı rozeti ──
```

Çakışma denetimi (eklenen anahtarların başka sözlüklerde **farklı** değerle bulunmadığını doğrular):

```bash
python3 - <<'PY'
import re, glob
src = open('web/js/lang/en/settings.js').read()
start = src.index("  // ── Veri sağlığı rozeti ──")
end = src.index("  // ── /Veri sağlığı rozeti ──", start)
pat = r"^  '((?:[^'\\\\]|\\\\.)*)': '((?:[^'\\\\]|\\\\.)*)',$"
mine = {m.group(1): m.group(2) for m in re.finditer(pat, src[start:end], flags=re.M)}
bad = 0
for f in glob.glob('web/js/lang/en/*.js'):
    if f.endswith('settings.js'):
        continue
    for m in re.finditer(pat, open(f).read(), flags=re.M):
        if m.group(1) in mine and mine[m.group(1)] != m.group(2):
            bad += 1
            print('ÇAKIŞMA', repr(m.group(1)), 'settings.js:', mine[m.group(1)], '|', f.split('/')[-1] + ':', m.group(2))
print('yeni anahtar', len(mine), '| çakışma', bad)
PY
```
Expected: son satır `yeni anahtar 37 | çakışma 0`. Çakışma varsa o anahtarı bağlamlı yaz (`t('[denetim]…')` ve `'[denetim]…': '…'`).

Run: `for f in web/js/veri-sagligi.js web/js/app.js web/js/lang/en/settings.js; do node --check --input-type=module < $f && echo "$f ok"; done`
Expected: üç `ok`.

- [ ] **Step 5: Önizleme ortamını hazırla**

Run:
```bash
T=/tmp/kmy-ui-audit && rm -rf $T && mkdir -p $T && for e in "" -wal -shm; do f="$HOME/Library/Application Support/kmy terminal/data/borsa.db$e"; [ -f "$f" ] && cp "$f" "$T/borsa.db$e"; done; ls $T | wc -l; grep -c kmy-ui-audit .claude/launch.json
```
Expected: `1` ve `2` (`.claude/launch.json` `kmy-ui-audit` yapılandırmasını içerir; git'te yoktur). Dosya yoksa şu içerikle oluştur:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "kmy-ui-audit",
      "runtimeExecutable": "sh",
      "runtimeArgs": ["-c", "BORSA_PORT=7520 BORSA_REPORT_PORT=7521 BORSA_DATA_DIR=/tmp/kmy-ui-audit BORSA_WATCH=0 node server/index.js"],
      "port": 7520
    }
  ]
}
```

Tarayıcı bölmesinde `preview_start` ile `kmy-ui-audit` sunucusunu başlat, `resize_window` 1440×900, `http://localhost:7520/#/sohbet` adresine git ve `location.reload()` ile önbelleksiz yenile.

- [ ] **Step 6: İlk durum (hiç denetlenmedi) ve ayrıntı penceresi**

`javascript_exec`:
```js
await new Promise(x => setTimeout(x, 3000));
const b = document.querySelector('#dhBadge');
const st = { text: b.textContent, cls: b.className, title: b.title, h: Math.round(b.getBoundingClientRect().height) };
b.click(); await new Promise(x => setTimeout(x, 600));
const m = document.querySelector('.modal');
JSON.stringify({ st, modal: !!m, title: m?.querySelector('header span')?.textContent, hasRun: !!document.querySelector('#dhRun'), empty: document.querySelector('#dhRows')?.innerText.trim().slice(0, 70) })
```
Expected: `text` `VERİ · denetlenmedi`, `cls` `dh-badge dh-none`, `h` ≥ 22; pencere açık, başlık `Veri sağlığı`, `Şimdi denetle` düğmesi var, boş durum metni görünür ("Henüz denetlenmedi …").

- [ ] **Step 7: Şimdi denetle (≈40 sn), çift tıklama, sonuç tablosu, gizlilik**

`javascript_exec`:
```js
const q = (s) => document.querySelector(s); const wait = (ms) => new Promise(x => setTimeout(x, ms));
const orig = window.fetch; let posts = 0; window.fetch = (...a) => { if (String(a[0]).includes('/data-health/run')) posts++; return orig(...a); };
q('#dhRun').click(); await wait(300); q('#dhRun')?.click(); q('#dhRun')?.click();   // çift/üçlü tıklama
const during = { disabled: q('#dhRun')?.disabled, spinner: !!q('#dhRun .spinner'), badge: q('#dhBadge').textContent, posts };
window.fetch = orig;
JSON.stringify(during)
```
Expected: `posts: 1` (ikinci/üçüncü tıklama yeni istek başlatmaz), `disabled: true`, `spinner: true`, rozet metni `…` ile biter.

Sonra yaklaşık 60 sn bekleyip (`await new Promise(x => setTimeout(x, 60000))` tek çağrıda ya da iki çağrıda) `javascript_exec`:
```js
const q = (s) => document.querySelector(s);
const rows = [...document.querySelectorAll('#dhRows tr')].map(tr => tr.innerText.replace(/\s+/g, ' ').trim());
const groups = [...document.querySelectorAll('#dhRows .kt-mini-h')].map(e => e.textContent.trim());
JSON.stringify({ badge: q('#dhBadge').textContent, cls: q('#dhBadge').className, title: q('#dhBadge').title, groups, rowCount: rows.length, sample: rows.slice(0, 3), portfoy: rows.filter(r => /Σ|Toplam değer/.test(r)), noUndefined: !document.body.innerText.includes('undefined'), btn: q('#dhRun')?.innerText.trim(), summary: q('#dhSum')?.innerText })
```
Expected: rozet `VERİ ✓ SS:DD` ve `dh-ok` (SAPMA yoksa; seans açıkken hisse satırları ATLANDI olur ve rozeti bozmaz); `title` `OK n · SAPMA 0 · ATLANDI k · son denetim SS:DD`; gruplar (Döviz, Altın, Altın türü, Hisse, TEFAS, Tazelik, Temel, Portföy); satır sayısı 33; **portföy satırlarında rakam yok** (yalnız durum ve yüzde: örn. `Σ pozisyon değeri OK %0,000`); `undefined` yok; düğme `Şimdi denetle` (yeniden etkin).

- [ ] **Step 8: Durumlar: uyarı, doğrulanamadı, eski, hata (Review Focus 1, 3, 5)**

Önizleme sunucusunun veritabanını doğrudan değiştirip sayfayı yenileyerek durumları sına (geçici kopyada; gerçek veriye dokunmaz). Terminalde:
```bash
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const d = new DatabaseSync('/tmp/kmy-ui-audit/borsa.db');
const set = (at, rows) => d.prepare('UPDATE data_health SET at = ?, results = ? WHERE id = 1').run(at, JSON.stringify(rows));
const R = (durum, extra = {}) => ({ grup: 'Döviz', ad: 'USDTRY', durum, ...extra });
const mode = process.argv[1];
if (mode === 'uyari') set(Date.now(), [R('OK'), R('SAPMA', { sapmaPct: 2.5, app: 49, ref: 47.8 }), R('ATLANDI', { neden: 'değer yok' })]);
if (mode === 'atlandi') set(Date.now(), [R('ATLANDI', { neden: 'değer yok' }), R('ATLANDI', { neden: 'seans açık; kapanış değeri karşılaştırılamaz' })]);
if (mode === 'eski') set(Date.now() - 25 * 3600_000, [R('OK')]);
console.log(mode, 'yazıldı');
" uyari
```
Her mod için (`uyari`, `atlandi`, `eski`) komutu çalıştırıp sayfayı yenile (`location.reload()`, 3 sn bekle) ve rozeti oku (`document.querySelector('#dhBadge')`). Not: sunucu açıkken SQLite'a ikinci bağlantıyla yazmak WAL'da çalışır; gerekirse önizleme sunucusunu durdurup başlat.
Expected:
- `uyari`: metin `VERİ ⚠ 1`, sınıf `dh-warn`; pencerede SAPMA satırı en üstte, kırmızı `SAPMA` etiketi, `%2,500` ve `49 ↔ 47.8`.
- `atlandi`: metin `VERİ ?`, sınıf `dh-unk` (**yeşil değil**).
- `eski`: sınıf `dh-ok dh-old`, metin `(eski)` ile biter, soluk.
Hata gösterimi: sunucuyu durdurup pencerede **Şimdi denetle**'ye bas → pencerede kırmızı hata iletisi, rozetin önceki durumu korunur (sunucuyu sonra yeniden başlat).

- [ ] **Step 9: Genişlikler ve İngilizce**

`resize_window` 760×600 ve 900×700: her birinde yenileyip `javascript_exec`:
```js
await new Promise(x => setTimeout(x, 3000));
const sb = document.querySelector('.statusbar'); const b = document.querySelector('#dhBadge');
const r = b.getBoundingClientRect(), s = sb.getBoundingClientRect();
JSON.stringify({ w: innerWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth, badgeVisible: b.offsetParent !== null && r.right <= s.right + 1 && r.left >= s.left - 1, badgeText: b.textContent })
```
Expected: `pageOverflow: 0`, `badgeVisible: true`. Pencereyi her iki genişlikte aç, taşma olmadığını (`.modal` içinde yatay kaydırma yok) ekran görüntüsüyle doğrula.

İngilizce: `await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'en' }) }); setTimeout(() => location.reload(), 200);` sonra rozet metni `DATA ✓ …`, `title` `OK n · MISMATCH 0 · SKIPPED k · last audit …`, pencerede `Data health`, `Audit now`, `FX`/`Gold`/`Stocks` grup adları ve `SKIPPED`/`MISMATCH` etiketleri görünmeli; Türkçe sözcük sızmamalı (dinamik nedenler hariç: `hata: …`, `dönem uyuşmuyor: …` Türkçe kalır, bilinen sınırdır). Konsolda hata yok (`read_console_messages`, `onlyErrors: true`; önizleme sunucusunun yeniden başlamasından kalan WebSocket bağlantı hataları sayılmaz).

- [ ] **Step 10: Ortamı kapat, paketi çalıştır, commit**

`resize_window` `desktop` ve `preview_stop`; ardından:
```bash
rm -rf /tmp/kmy-ui-audit
npm test > /tmp/_dh3.log 2>&1; echo "çıkış=$?"; grep -c "^FAIL" /tmp/_dh3.log
git add web/js/veri-sagligi.js web/index.html web/styles.css web/js/app.js web/js/lang/en/settings.js
git commit -m "Veri sağlığı: durum çubuğu rozeti ve ayrıntı penceresi

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: `çıkış=0`, `0`.

---

### Task 4: Belge, sürüm ve spec düzeltmeleri

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `package.json`, `docs/superpowers/specs/2026-10-02-veri-sagligi-rozeti-design.md`

**Interfaces:**
- Consumes: Görev 1–3'ün çıktıları.
- Produces: 0.20.0 sürüm commit'i.

- [ ] **Step 1: Spec'i gerçeğe uydur**

`docs/superpowers/specs/2026-10-02-veri-sagligi-rozeti-design.md` içinde:
- `POST /api/data-health/run` satırındaki `(≈20 sn)` ifadesini `(≈40 sn; ölçüm: 41 sn)` yap; "Koşu birkaç kaynağa istek yapar … yaklaşık 20 sn sürer" cümlesinde `20` değerini `40` yap.
- Arayüz bölümündeki `~20 sn` ifadesini `≈40 sn` yap.
- `rozetDurumu`/`eskiMi` açıklamalarına dokunma (zaten doğru).
- Arayüz bölümüne şu cümleyi ekle: `Grup adları, kontrol adları ve bilinen neden metinleri (ör. "değer yok", "seans açık; kapanış değeri karşılaştırılamaz") bağlamlı anahtarlarla çevrilir; dinamik nedenler ("hata: …", "dönem uyuşmuyor: …") Türkçe kalır.`

Sonra tutarsız kalan süre ifadesi olmadığını doğrula: `grep -n "20 sn" docs/superpowers/specs/2026-10-02-veri-sagligi-rozeti-design.md`
Expected: çıktı yok.

- [ ] **Step 2: README'yi güncelle**

`README.md`'de özellikler tablosunda `| **Takvim** |` satırından hemen sonra ekle:

```markdown
| **Veri sağlığı** | Durum çubuğunda **VERİ** rozeti: son çapraz kaynak denetiminin sonucu (`VERİ ✓ 14:10` temiz, `VERİ ⚠ 2` sapma var, `VERİ ?` hiçbir şey doğrulanamadı, `VERİ · denetlenmedi`; 24 saatten eskiyse `(eski)`). Tıklayınca pencere: kontroller grup grup (döviz ↔ TCMB, gram altın, altın türleri, hisse ↔ İş Yatırım, TEFAS, gecikme etiketleri, FAVÖK / net kâr / F/K mali tablodan yeniden hesap, portföy toplamları), **Şimdi denetle** düğmesi (≈40 sn). Denetim yalnız elle çalışır; aynı mantık `npm run denetim` komutunda da kullanılır. ATLANDI hata değildir (seans açık, kaynak erişilemedi); portföy satırlarında tutar gösterilmez |
```

Ve `npm run denetim` paragrafını (`Verinin doğruluğunu canlı kaynaklara karşı denetlemek için: …`) şu cümleyle bitir: ` Aynı denetim arayüzde durum çubuğundaki **VERİ** rozetinden de çalıştırılır.`

Test sayısı: `npm test` çıktısından dosya başına sayıları oku (`grep -E "geçti" /tmp/_dh3.log`), sonra README'deki `geçici veritabanında 389 kontrol: … takvim 88; …` cümlesini yeni toplamla güncelle (`denetim çekirdeği 62` → `denetim çekirdeği 76`; toplam 389 + 14 = 403). Sayılar ölçülenle uyuşmuyorsa ölçüleni yaz.

- [ ] **Step 3: CHANGELOG girdisini yaz**

`CHANGELOG.md`'nin en üstüne (`# Sürüm Notları` başlığının altına, `## 0.19.0` girdisinin önüne) ekle:

```markdown
## 0.20.0 — 2 Ekim 2026 (veri sağlığı rozeti)

### Yeni
- **Durum çubuğunda "VERİ" rozeti.** `npm run denetim`'in çapraz kaynak denetimi artık uygulamanın içinde: rozet son denetimin sonucunu gösterir (`VERİ ✓ 14:10` temiz, `VERİ ⚠ 2` sapma var, `VERİ ?` hiçbir şey doğrulanamadı, `VERİ · denetlenmedi`; son denetim 24 saatten eskiyse `(eski)` ve soluk). Tıklayınca **Veri sağlığı** penceresi: kontroller grup grup (SAPMA içeren gruplar ve satırlar en üstte), sapma yüzdesi, uygulama ↔ referans değeri, neden; **Şimdi denetle** düğmesi (koşu ≈40 sn, sürerken kilitli, çift tıklama ikinci koşu başlatmaz; açık diğer pencereler WebSocket ile güncellenir). Denetim **yalnız elle** çalışır (arka plan koşusu yok); sonuç `data_health` tablosunda saklanır, yeniden başlatmada rozet son sonucu gösterir. `GET /api/data-health`, `POST /api/data-health/run`.
- **Sahte yeşil yok:** hiçbir şey doğrulanamazsa (hepsi ATLANDI: ağ yok, seans açık) rozet yeşil değil gri `?` olur. ATLANDI hata sayılmaz; seans açıkken hisse kontrolü bu yüzden rozeti bozmaz.
- **Uygulamanın gördüğü veri sınanıyor:** kontroller sunucu içinde, kullanıcının gördüğü fiyatla aynı önbellekler üzerinden çalışır (CLI ayrı bir süreçte kendi kopyasını sınıyordu). İş Yatırım verisi her koşuda zorla tazelenir.
- **Tek kaynak:** kontroller `server/denetim.js`'e, saf çekirdek `server/denetim-cekirdek.js`'e taşındı; `npm run denetim` aynı fonksiyonu çağırır, çıktısı ve çıkış kodları (0/1/2) aynı. Ölçüm: sunucu modülü CLI ile aynı sayıları üretti (26 OK · 0 SAPMA · 7 ATLANDI, 33 satır).
- Rozet mantığı için 14 yeni çevrimdışı kontrol (`ozet`, `rozetDurumu`, `eskiMi`; toplam 76).

### Bilinen
- Rozet bir **izleme** değil, son denetimin kanıtıdır: elle çalışır ve 24 saatten sonra "eski" olur.
- Hisse kontrolü seans açıkken ATLANDI'dır; tam sonuç için kapanıştan sonra denetleyin.
- Koşu birkaç kaynağa istek yapar (TCMB, İş Yatırım, TEFAS, KAP mali tablolar) ve yaklaşık 40 sn sürer; zaman aşımı 120 sn.
- Portföy kontrolü satırlarında tutar saklanmaz ve gösterilmez, yalnız durum ve sapma yüzdesi.
- Dinamik neden metinleri ("hata: …", "dönem uyuşmuyor: …") İngilizce arayüzde Türkçe kalır.
```

- [ ] **Step 4: Sürümü yükselt**

`package.json` içindeki `"version": "0.19.0"` değerini `"0.20.0"` yap. Başka yerde geçiyor mu: `grep -rn "0\.19\.0" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.superpowers --exclude=CHANGELOG.md . | head` (çıkan her yer güncellenir; `package-lock.json`'ın kendi sürümü ayrıdır, dokunma).

- [ ] **Step 5: Son doğrulama**

Run: `npm test > /tmp/_dh4.log 2>&1; echo "test çıkış=$?"; grep -c "^FAIL" /tmp/_dh4.log; grep -E "geçti" /tmp/_dh4.log | tr '\n' ' '; echo; git status --short`
Expected: `test çıkış=0`, `0`, dosya başına sayılar (63, 19, 59, 28, **76**, 33, 37, 88) ve yalnız beklenen dosyalar değişmiş (`README.md`, `CHANGELOG.md`, `package.json`, spec).

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md package.json docs/superpowers/specs/2026-10-02-veri-sagligi-rozeti-design.md
git commit -m "0.20.0: veri sağlığı rozeti

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

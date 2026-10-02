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
let inflight = null;    // bekleyen çağrıların paylaştığı söz
let innerBusy = false;  // zaman aşımından sonra bile iç koşu bitene kadar true: iptal edilemeyen koşu varken yeni koşu çakışmasın

const withTimeout = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('Denetim zaman aşımı')), ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

const view = (results, at, running) => ({ at, summary: K.ozet(results), state: K.rozetDurumu(results), stale: K.eskiMi(at), results, running });

/** Kayıtlı son sonuç (hiç çalışmadıysa ya da kayıt bozuksa state: 'yok'). */
export function last() {
  const running = !!inflight || innerBusy;
  try {
    const row = db.prepare('SELECT at, results FROM data_health WHERE id = 1').get();
    if (row) return view(JSON.parse(row.results), Number(row.at), running);
  } catch { /* bozuk kayıt: yok say */ }
  return view([], null, running);
}

/**
 * Denetimi çalıştırıp kaydeder. Koşu sürerken gelen ikinci çağrı aynı koşunun sonucunu bekler.
 * Zaman aşımı bekleyenleri bırakır ama iç koşu iptal edilemez: o bitene kadar yeni koşu başlatılmaz (KAP hız sınırı).
 */
export function run({ timeoutMs = 120_000 } = {}) {
  if (inflight) return inflight;
  if (innerBusy) return Promise.reject(new Error('Önceki denetim hâlâ sürüyor; biraz sonra yeniden deneyin'));
  const work = runChecks();
  innerBusy = true;
  work.then(() => {}, () => {}).then(() => { innerBusy = false; });
  inflight = withTimeout(work, timeoutMs)
    .then((results) => {
      const at = Date.now();
      db.prepare('INSERT INTO data_health(id, at, results) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, results = excluded.results').run(at, JSON.stringify(results));
      return view(results, at, false);
    })
    .finally(() => { inflight = null; });
  return inflight;
}

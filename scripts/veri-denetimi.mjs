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
const K = await import('../server/denetim-cekirdek.js');
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
  await dene('Döviz', s, async () => K.fxKarar({ app: fiyat(s), ref: tcmbOrta(kod) }));
}

// Altın: ons × kur ÷ 31,1035 ve geleneksel altınların saf gram karşılığı.
const gram = K.gramRef(fiyat('ONS'), fiyat('USDTRY'));
await dene('Altın', 'GRAM', async () => K.gramKarar(q.GRAM, q.ONS, q.USDTRY));
for (const s of Object.keys(K.SAF_GR)) {
  await dene('Altın türü', s, async () => K.karsilastir(fiyat(s), gram == null ? null : gram * K.SAF_GR[s], K.TOLERANS.altinTuru));
}

// Hisse: Yahoo (uygulama) ↔ İş Yatırım kapanışı.
// İş Yatırım verisi zorla tazelenir: veritabanı kopyasındaki eski önbellek (gün içi kapanış) yalancı SAPMA üretirdi.
const basla = Date.now();
await universe.refresh(true).catch(() => {});
const isyTaze = (universe.status().at ?? 0) >= basla;
for (const s of HISSELER) {
  await dene('Hisse', s, async () => K.hisseKarar({ app: fiyat(s), ref: universe.stock(s)?.close, seansAcik: seans.open, isyTaze }));
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
  for (const r of K.temelKarar(f, isyTaze ? universe.stock(s) : null)) ekle('Temel', `${s} ${r.ad}`, r);
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

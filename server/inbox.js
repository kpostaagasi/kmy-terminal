// Kurum raporu klasör izleme: kullanıcının kendi hesabıyla indirdiği aracı kurum raporlarını
// (Halk Yatırım şirket raporları, Deniz, Alnus, e-posta ekleri…) izlenen klasörden arşive alır.
// Yalnızca ilk sayfasında aracı kurum adı ve araştırma ifadesi geçen PDF'ler kopyalanır; asıl dosyaya dokunulmaz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { cacheGet, cachePut, getSettings } from './db.js';
import { REPORTS_DIR } from './paths.js';
import * as store from './store.js';
import { symbolsIn } from './research.js';

// [anahtar, görünen ad, dosya adı / metin deseni]
const BROKERS = [
  ['halk', 'Halk Yatırım', /halk\s*yat[ıi]r[ıi]m|\bHLY[_\s-]/i], ['gedik', 'Gedik Yatırım', /gedik\s*yat[ıi]r[ıi]m|\bgedik[_\s-]/i],
  ['deniz', 'Deniz Yatırım', /deniz\s*yat[ıi]r[ıi]m|denizinvest/i], ['alnus', 'Alnus Yatırım', /alnus/i],
  ['isyatirim', 'İş Yatırım', /[İi]ş\s*yat[ıi]r[ıi]m|is\s*yatirim/i], ['garanti', 'Garanti BBVA Yatırım', /garanti\s*bbva\s*yat|garanti\s*yat[ıi]r[ıi]m/i],
  ['ak', 'AK Yatırım', /\bak\s*yat[ıi]r[ıi]m/i], ['yapikredi', 'Yapı Kredi Yatırım', /yap[ıi]\s*kredi\s*yat|\bYKY\b/i],
  ['ziraat', 'Ziraat Yatırım', /ziraat\s*yat[ıi]r[ıi]m/i], ['vakif', 'Vakıf Yatırım', /vak[ıi]f\s*yat[ıi]r[ıi]m/i],
  ['tacirler', 'Tacirler Yatırım', /tacirler/i], ['phillip', 'PhillipCapital', /phillip\s*capital/i], ['integral', 'Integral Yatırım', /integral\s*yat/i],
  ['a1', 'A1 Capital', /a1\s*capital/i], ['qnb', 'QNB Yatırım', /qnb\s*(invest|yat)/i], ['seker', 'Şeker Yatırım', /[şs]eker\s*yat[ıi]r[ıi]m/i],
  ['info', 'Info Yatırım', /info\s*yat[ıi]r[ıi]m/i], ['global', 'Global Menkul', /global\s*menkul/i], ['kuveytturk', 'Kuveyt Türk Yatırım', /kuveyt\s*t[üu]rk\s*yat/i],
  ['teb', 'TEB Yatırım', /\bTEB\s*yat[ıi]r[ıi]m/i], ['oyak', 'Oyak Yatırım', /oyak\s*yat[ıi]r[ıi]m/i], ['icbc', 'ICBC Turkey Yatırım', /icbc\s*turkey\s*yat/i],
  ['unlu', 'Ünlü & Co', /[üu]nl[üu]\s*&\s*co/i], ['burgan', 'Burgan Yatırım', /burgan\s*yat/i], ['osmanli', 'Osmanlı Yatırım', /osmanl[ıi]\s*yat/i],
];
const RESEARCH = /hedef\s*fiyat|tavsiye|şirket\s*raporu|sirket\s*raporu|araştırma|arastirma|değerleme|degerleme|endeks(in)?\s*üzeri|target\s*price|recommendation|equity\s*research/i;

const pdfText = (file) => new Promise((resolve) => {
  execFile('pdftotext', ['-l', '2', '-q', file, '-'], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? '' : String(out)));
});

export function settings() {
  const s = getSettings();
  return { enabled: !!s.inboxEnabled, dir: s.inboxDir || path.join(os.homedir(), 'Downloads') };
}

let scanning = false;
export async function scan({ notify = () => {}, force = false } = {}) {
  const { enabled, dir } = settings();
  if ((!enabled && !force) || scanning) return { imported: [], skipped: 0 };
  if (!fs.existsSync(dir)) throw new Error(`Klasör bulunamadı: ${dir}`);
  scanning = true;
  const seen = cacheGet('inbox:seen', 3650 * 86400_000) || {};
  const imported = [];
  let skipped = 0;
  try {
    const since = Date.now() - 30 * 86400_000; // yalnız son 30 günde indirilenler
    for (const f of fs.readdirSync(dir)) {
      if (!/\.pdf$/i.test(f)) continue;
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      const key = `${f}|${st.size}`;
      if (seen[key] || st.mtimeMs < since || st.size > 80 * 1024 * 1024) continue;
      seen[key] = Date.now();
      const txt = await pdfText(full);
      const hay = `${f}\n${txt.slice(0, 6000)}`;
      const broker = BROKERS.find(([, , re]) => re.test(hay));
      if (!broker || !RESEARCH.test(hay)) { skipped++; continue; }
      const firstLine = txt.split('\n').map((l) => l.trim()).find((l) => l.length > 12 && !/yat[ıi]r[ıi]m\s*menkul|sayfa|page/i.test(l));
      const title = f.replace(/\.pdf$/i, '').replace(/^\d+_/, '').replace(/[_-]+/g, ' ').trim() || firstLine || 'Kurum raporu';
      const symbols = symbolsIn(f.replace(/[_-]/g, ' '), txt.slice(0, 1500));
      const date = new Date(st.mtimeMs).toISOString().slice(0, 10);
      const rel = path.join('kurum', broker[0], `${date}-${f.replace(/[^\w.\-çğıöşüÇĞİÖŞÜ]+/g, '_')}`);
      fs.mkdirSync(path.dirname(path.join(REPORTS_DIR, rel)), { recursive: true });
      fs.copyFileSync(full, path.join(REPORTS_DIR, rel));
      store.setReportMeta(rel, { title, broker: broker[1], symbols, source: `klasör: ${full}` });
      imported.push({ name: rel, broker: broker[1], title, symbols });
    }
  } finally {
    cachePut('inbox:seen', seen);
    scanning = false;
  }
  if (imported.length) notify(imported);
  return { imported, skipped, dir };
}

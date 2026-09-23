// Araştırma hafızası: ajanın oturumlar arası şirket ve konu notları (workspace/hafiza).
//  - sirketler/THYAO.md : tez, kilit rakamlar, tetikleyiciler, izlenecekler
//  - konular/<konu>.md  : sektör, makro tema, kurum raporları, radar günlüğü
// Kullanıcı bir şirketten söz ettiğinde ilgili not istemle birlikte ajana verilir.
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DIR } from './paths.js';

export const MEMORY_DIR = path.join(WORKSPACE_DIR, 'hafiza');
const COMPANY_DIR = path.join(MEMORY_DIR, 'sirketler');
const TOPIC_DIR = path.join(MEMORY_DIR, 'konular');
const RADAR_TOPIC = 'radar-gunlugu';
const MAX_NOTE = 60_000;

const TR_FOLD = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
export function topicSlug(t) {
  return String(t || '').toLocaleLowerCase('tr').replace(/[çğıöşüâîû]/g, (c) => TR_FOLD[c])
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
function symbolKey(s) {
  const k = String(s || '').trim().toUpperCase().replace(/\.IS$/, '');
  if (!/^[A-Z0-9][A-Z0-9.]{1,11}$/.test(k)) throw new Error(`Geçersiz sembol: ${s}`);
  return k;
}

function target({ symbol, topic }) {
  if (symbol) { const key = symbolKey(symbol); return { kind: 'sirket', key, file: path.join(COMPANY_DIR, `${key}.md`) }; }
  const key = topicSlug(topic);
  if (!key) throw new Error('symbol veya topic gerekli');
  return { kind: 'konu', key, file: path.join(TOPIC_DIR, `${key}.md`) };
}

const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Istanbul' }).slice(0, 16);

export function list() {
  const out = [];
  for (const [kind, dir] of [['sirket', COMPANY_DIR], ['konu', TOPIC_DIR]]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const st = fs.statSync(path.join(dir, f));
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      out.push({ kind, key: f.slice(0, -3), updatedAt: st.mtime.toISOString(), size: st.size, hasTriggers: /tetikleyici/i.test(text) });
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function get(ref) {
  const t = target(ref);
  if (!fs.existsSync(t.file)) return null;
  return { kind: t.kind, key: t.key, content: fs.readFileSync(t.file, 'utf8'), updatedAt: fs.statSync(t.file).mtime.toISOString() };
}

// mode: append (tarihli bölüm ekler) | replace (dosyayı yeniden yazar)
export function save({ symbol, topic, content, mode = 'append' }) {
  const t = target({ symbol, topic });
  const body = String(content || '').trim();
  if (!body) throw new Error('İçerik boş');
  fs.mkdirSync(path.dirname(t.file), { recursive: true });
  const exists = fs.existsSync(t.file);
  let next;
  if (mode === 'replace' || !exists) {
    const head = t.kind === 'sirket' ? `# ${t.key} araştırma notları` : `# ${topic || t.key}`;
    next = `${body.startsWith('#') ? '' : `${head}\n\n`}${body}\n\n_Son güncelleme: ${stamp()}_\n`;
  } else {
    next = `${fs.readFileSync(t.file, 'utf8').trimEnd()}\n\n## ${stamp()}\n${body}\n`;
  }
  if (next.length > MAX_NOTE) throw new Error(`Not çok uzun (${Math.round(next.length / 1000)} bin karakter). mode "replace" ile özetleyerek yeniden yaz.`);
  fs.writeFileSync(t.file, next);
  return { kind: t.kind, key: t.key, path: path.relative(WORKSPACE_DIR, t.file), size: next.length };
}

export function remove(ref) {
  const t = target(ref);
  if (fs.existsSync(t.file)) fs.rmSync(t.file);
  return { removed: t.key };
}

// Kullanıcı mesajında (ve ekran bağlamında) geçen şirketlerin notları; istemin başına eklenir
export function forPrompt(text, { maxEach = 3500, maxTotal = 9000 } = {}) {
  if (!fs.existsSync(COMPANY_DIR)) return '';
  // Ticker'lar ASCII'dir; Türkçe büyük harf dönüşümü "isctr"yi "İSCTR" yapardı
  const tokens = new Set(String(text || '').toUpperCase().split(/[^A-Z0-9.]+/).map((t) => t.replace(/\.+$/, '')).filter(Boolean));
  const keys = fs.readdirSync(COMPANY_DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter((k) => tokens.has(k));
  let total = 0;
  const parts = [];
  for (const k of keys) {
    const n = get({ symbol: k });
    if (!n) continue;
    let c = n.content.trim();
    if (c.length > maxEach) c = `…(önceki bölümler kısaltıldı; tamamı için get_memory)\n${c.slice(-maxEach)}`;
    if (total + c.length > maxTotal) break;
    total += c.length;
    parts.push(`<not sembol="${k}" guncelleme="${n.updatedAt.slice(0, 10)}">\n${c}\n</not>`);
  }
  return parts.length ? `<arastirma_hafizasi>\nBu şirketler için daha önce kaydettiğin notlar (tarihlerine dikkat et; güncel veriyle doğrula):\n${parts.join('\n')}\n</arastirma_hafizasi>\n\n` : '';
}

// Tetikleyici radarı durumu: izlenen tez sayısı ve son tarama tarihi (radar günlüğü)
export function radarStatus() {
  const theses = list().filter((n) => n.kind === 'sirket' && n.hasTriggers).length;
  const f = path.join(TOPIC_DIR, `${RADAR_TOPIC}.md`);
  const last = fs.existsSync(f) ? fs.statSync(f).mtime : null;
  return { theses, lastRun: last ? last.toISOString() : null, daysSince: last ? Math.floor((Date.now() - last.getTime()) / 86400_000) : null };
}

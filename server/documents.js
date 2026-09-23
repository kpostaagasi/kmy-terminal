// Şirket belge arşivi (workspace/belgeler/<SEMBOL>/): KAP ekleri, faaliyet raporları, sunumlar.
// Ajan buradaki PDF'leri Read aracıyla okur; kullanıcı Raporlar'dan yüklediklerini ayrıca tutar.
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DIR } from './paths.js';
import * as kap from './kap.js';

export const DOCS_DIR = path.join(WORKSPACE_DIR, 'belgeler');

const safeName = (s) => String(s || '').normalize('NFC').replace(/[^\w.\-çğıöşüÇĞİÖŞÜ ]+/g, '_').replace(/\s+/g, '_').replace(/^\.+/, '').slice(0, 120);
const folderFor = (symbol) => (symbol ? safeName(String(symbol).toUpperCase().replace(/\.IS$/, '')) || 'genel' : 'genel');

export async function saveKapAttachment({ url, symbol, name }) {
  const a = await kap.attachment(url);
  const dir = path.join(DOCS_DIR, folderFor(symbol));
  fs.mkdirSync(dir, { recursive: true });
  let fname = safeName(name || a.name) || `${a.id}.pdf`;
  if (!/\.[a-z0-9]{2,5}$/i.test(fname) && a.type === 'application/pdf') fname += '.pdf';
  const file = path.join(dir, fname);
  fs.writeFileSync(file, a.buf);
  return { path: path.relative(WORKSPACE_DIR, file), name: fname, size: a.buf.length, type: a.type };
}

export function list(symbol = null) {
  if (!fs.existsSync(DOCS_DIR)) return [];
  const dirs = symbol ? [folderFor(symbol)] : fs.readdirSync(DOCS_DIR).filter((d) => fs.statSync(path.join(DOCS_DIR, d)).isDirectory());
  const out = [];
  for (const d of dirs) {
    const full = path.join(DOCS_DIR, d);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      const st = fs.statSync(path.join(full, f));
      if (st.isFile()) out.push({ symbol: d, name: f, path: path.relative(WORKSPACE_DIR, path.join(full, f)), size: st.size, savedAt: st.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

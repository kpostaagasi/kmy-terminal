#!/usr/bin/env node
// Tek komutla başlat (macOS / Linux / Windows): `npx github:kpostaagasi/kmy-terminal` veya `npm start`.
// Sunucuyu ön planda çalıştırır, hazır olunca tarayıcıda açar. Ctrl+C ile kapanır.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`kmy terminal Node.js 22.13 veya üstü gerektirir (bulunan ${process.versions.node}). https://nodejs.org`);
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 7420;
const URL_UI = `http://127.0.0.1:${PORT}`;
const noOpen = process.argv.includes('--no-open') || process.env.KMY_NO_OPEN === '1';

export function openerFor(platform = process.platform) {
  if (platform === 'darwin') return ['open', []];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""']];
  return ['xdg-open', []];
}

function openBrowser(url) {
  const [cmd, pre] = openerFor();
  try {
    const p = spawn(cmd, [...pre, url], { stdio: 'ignore', detached: true, windowsHide: true });
    p.on('error', () => console.log(`  Tarayıcı açılamadı; adres: ${url}`));
    p.unref();
  } catch { console.log(`  Tarayıcı açılamadı; adres: ${url}`); }
}

async function waitHealth(ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`${URL_UI}/api/health`); if (r.status < 500) return true; } catch { /* henüz değil */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// npx / npm i -g bin'i sembolik bağlantıyla çağırır: gerçek yolları karşılaştır.
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT: String(PORT) } });
  const stop = () => { try { srv.kill(); } catch { /* yok */ } };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  srv.on('exit', (c) => process.exit(c ?? 0));
  if (await waitHealth()) { console.log(`  kmy terminal hazır → ${URL_UI}`); if (!noOpen) openBrowser(URL_UI); }
  else console.log(`  Sunucu yanıt vermedi; günlüğe bakın. Adres: ${URL_UI}`);
}

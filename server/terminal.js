// Gerçek kabuk oturumları (node-pty). Her WebSocket istemcisi birden çok terminal açabilir.
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { WORKSPACE_DIR } from './paths.js';

const require = createRequire(import.meta.url);
let pty = null;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('[terminal] node-pty yüklenemedi:', e.message);
}

const terms = new Map(); // id -> { p, owner, buffer }
const MAX_BUFFER = 200_000;

export function available() { return !!pty; }

export function open({ owner, cols = 100, rows = 30, command = null, cwd = null, onData, onExit }) {
  if (!pty) throw new Error('node-pty kullanılamıyor; `npm rebuild node-pty` çalıştırın');
  const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');
  const want = cwd === '~' ? os.homedir() : cwd;
  const dir = want && fs.existsSync(want) ? want : WORKSPACE_DIR;
  const args = command ? ['-l', '-c', command] : ['-l'];
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'tr_TR.UTF-8' };
  delete env.CLAUDECODE; // iç içe Claude Code tespiti tetiklenmesin
  const p = pty.spawn(shell, args, { name: 'xterm-256color', cols, rows, cwd: dir, env });
  const id = crypto.randomUUID();
  const t = { p, owner, buffer: '', command, cwd: dir, startedAt: Date.now() };
  terms.set(id, t);
  p.onData((d) => {
    t.buffer = (t.buffer + d).slice(-MAX_BUFFER);
    onData?.(id, d);
  });
  p.onExit(({ exitCode }) => {
    terms.delete(id);
    onExit?.(id, exitCode);
  });
  return { id, cwd: dir, command };
}

export function write(id, data) { terms.get(id)?.p.write(data); }
export function resize(id, cols, rows) {
  const t = terms.get(id);
  if (t && cols > 0 && rows > 0) try { t.p.resize(cols, rows); } catch { /* süreç kapanmış olabilir */ }
}
export function close(id) {
  const t = terms.get(id);
  if (t) { try { t.p.kill(); } catch { /* zaten kapalı */ } terms.delete(id); }
}
export function closeOwned(owner) {
  for (const [id, t] of terms) if (t.owner === owner) close(id);
}
export function list() {
  return [...terms.entries()].map(([id, t]) => ({ id, pid: t.p.pid, command: t.command, cwd: t.cwd, startedAt: t.startedAt }));
}
export function bufferOf(id) { return terms.get(id)?.buffer || ''; }

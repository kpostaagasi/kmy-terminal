// Çapraz platform yardımcıları: veri dizini, varsayılan kabuk, tarayıcı açıcı.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmy-plat-'));
process.env.BORSA_DATA_DIR = path.join(tmp, 'data');
process.env.BORSA_WORKSPACE_DIR = path.join(tmp, 'ws');
const { appDirFor, findModuleFile } = await import('../server/paths.js');
const { defaultShell } = await import('../server/terminal.js');
const { openerFor } = await import('../bin/start.mjs');
let ok = 0, bad = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK  ', m); } else { bad++; console.log('FAIL', m); } };
check(appDirFor('darwin', {}, '/Users/a', false) === path.join('/Users/a', 'Library', 'Application Support', 'kmy terminal'), 'macOS: Application Support');
check(appDirFor('linux', {}, '/home/a', false) === null, 'Linux git klonu: depo dizini');
check(appDirFor('linux', {}, '/home/a', true) === path.join('/home/a', '.local', 'share', 'kmy-terminal'), 'Linux paket: ~/.local/share');
check(appDirFor('linux', { XDG_DATA_HOME: '/x' }, '/home/a', true) === path.join('/x', 'kmy-terminal'), 'Linux paket: XDG_DATA_HOME');
check(appDirFor('win32', { APPDATA: 'C:\\U\\R' }, 'C:\\U', true) === path.join('C:\\U\\R', 'kmy terminal'), 'Windows paket: %APPDATA%');
check(defaultShell('win32', {}) === 'powershell.exe', 'Windows kabuk: PowerShell');
check(defaultShell('linux', { SHELL: '/yok/zsh' }, (p) => p === '/bin/bash') === '/bin/bash', 'Linux: olmayan $SHELL yerine bash');
check(defaultShell('linux', {}, () => false) === '/bin/sh', 'Linux: son çare sh');
check(defaultShell('darwin', { SHELL: '/bin/zsh' }, () => true) === '/bin/zsh', 'macOS: $SHELL');
check(openerFor('win32')[0] === 'rundll32' && openerFor('darwin')[0] === 'open' && openerFor('linux')[0] === 'xdg-open', 'tarayıcı açıcı platforma göre');
// npx / npm i -g: bağımlılıklar üst node_modules'a taşınır (hoist); vendor dosyaları orada da bulunmalı.
{
  const top = path.join(tmp, 'g', 'node_modules'); const app = path.join(top, 'kmy-terminal');
  fs.mkdirSync(path.join(top, 'chart.js', 'dist'), { recursive: true }); fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(top, 'chart.js', 'dist', 'chart.umd.js'), '//');
  check(findModuleFile('chart.js/dist/chart.umd.js', app) === path.join(top, 'chart.js', 'dist', 'chart.umd.js'), 'vendor: hoist edilmiş node_modules bulunur');
  fs.mkdirSync(path.join(app, 'node_modules', 'chart.js', 'dist'), { recursive: true }); fs.writeFileSync(path.join(app, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), '//');
  check(findModuleFile('chart.js/dist/chart.umd.js', app) === path.join(app, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), 'vendor: önce kendi node_modules');
  check(findModuleFile('yok/x.js', app) === null, 'vendor: yoksa null');
}
console.log(`${ok} geçti, ${bad} başarısız`); process.exit(bad ? 1 : 0);

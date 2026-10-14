import { compareVersions, parseVersion, pickUpdate, installKind, enabled } from '../server/guncelleme.js';
let ok = 0, bad = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK  ', m); } else { bad++; console.log('FAIL', m); } };

check(compareVersions('0.1.0-beta', '0.1.0-beta') === 0, 'aynı sürüm eşit');
check(compareVersions('v0.1.0-beta.2', '0.1.0-beta') === 1, 'beta.2 > beta');
check(compareVersions('0.1.0-beta.10', '0.1.0-beta.9') === 1, 'sayısal ön sürüm parçaları sayı olarak karşılaştırılır');
check(compareVersions('0.1.0', '0.1.0-beta') === 1, 'normal sürüm > aynı çekirdekli ön sürüm');
check(compareVersions('0.1.0-rc.1', '0.1.0-beta.3') === 1, 'rc > beta');
check(compareVersions('0.2.0-beta', '0.1.9') === 1, 'çekirdek önce gelir');
check(parseVersion('kmy') === null, 'geçersiz sürüm null');

const rel = (tag, published_at, extra = {}) => ({ tag_name: tag, name: tag, published_at, draft: false, html_url: `https://x/${tag}`, assets: [], ...extra });
const releases = [
  rel('v0.22.1', '2026-10-07T00:00:00Z'),
  rel('v0.1.0-beta', '2026-10-12T00:00:00Z'),
  { tag_name: 'v0.23.0', draft: true, published_at: null },
];
const u0 = pickUpdate(releases, '0.1.0-beta', 'darwin');
check(u0.latest === '0.1.0-beta' && !u0.available, 'eski 0.22.1 numarası güncelleme sayılmaz, taslak yok sayılır');

const assets = [{ name: 'kmy-terminal-0.1.1-beta-arm64.dmg', browser_download_url: 'dmg' }, { name: 'kmy-terminal-0.1.1-beta-x64-setup.exe', browser_download_url: 'exe' }, { name: 'kmy-terminal-0.1.1-beta-x86_64.AppImage', browser_download_url: 'appimage' }];
const newer = [...releases, rel('v0.1.1-beta', '2026-10-20T00:00:00Z', { assets })];
const u1 = pickUpdate(newer, '0.1.0-beta', 'darwin');
check(u1.available && u1.latest === '0.1.1-beta' && u1.assetUrl === 'dmg', 'yeni sürüm bulunur, macOS için DMG');
check(pickUpdate(newer, '0.1.0-beta', 'win32').assetUrl === 'exe', 'Windows için setup.exe');
check(pickUpdate(newer, '0.1.0-beta', 'linux').assetUrl === 'appimage', 'Linux için AppImage');
check(!pickUpdate(newer, '0.1.1-beta', 'linux').available, 'kurulu sürüm en yeniyse güncelleme yok');
check(!pickUpdate([], '0.1.0-beta').available && !pickUpdate(null, '0.1.0-beta').available, 'boş liste güvenli');

const no = () => false;
check(installKind('/Applications/kmy terminal.app/Contents/Resources/app', true, {}, no) === 'dmg', 'DMG kurulumu');
check(installKind('/tmp/.mount_kmyAbc/app', false, {}, no) === 'appimage', 'AppImage');
check(installKind('/x/app', false, { APPIMAGE: '/home/u/kmy.AppImage' }, no) === 'appimage', 'AppImage (ortam değişkeni)');
check(installKind('C:\\Users\\u\\AppData\\Local\\Programs\\kmy terminal\\app', false, {}, (f) => /kmy-terminal\.cmd$/.test(f)) === 'exe', 'Windows kurulumu');
check(installKind('/home/u/.npm/_npx/abc/node_modules/kmy-terminal', true, {}, no) === 'npx', 'npx');
check(installKind('/home/u/kmy-terminal', false, {}, no) === 'git', 'git klonu');

check(enabled({}, {}), 'varsayılan açık');
check(!enabled({ updateCheck: false }, {}), 'ayardan kapatılabilir');
check(!enabled({}, { KMY_NO_UPDATE_CHECK: '1' }), 'ortam değişkeniyle kapatılabilir');
console.log(`${ok} geçti, ${bad} başarısız`); process.exit(bad ? 1 : 0);

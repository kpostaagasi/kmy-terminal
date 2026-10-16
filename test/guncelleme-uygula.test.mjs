// Tek tıkla güncelleme: imza/özet doğrulama, güvenilir adres, kurulum ve açılış yönlendirmesi
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { trustedUrl, parseSums, verifySignature, verifyPackage, sha256 } from '../server/update-verify.js';
import { apply, canApply, pkgName } from '../server/update-apply.js';
import { pickActive } from '../server/boot-redirect.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
const sign = (s) => crypto.sign(null, Buffer.from(s), privateKey).toString('base64');

assert.equal(trustedUrl('https://github.com/kpostaagasi/kmy-terminal/releases/download/v1/x.tgz'), true);
assert.equal(trustedUrl('http://github.com/x'), false, 'HTTP reddedilir');
assert.equal(trustedUrl('https://evil.example/x'), false);
assert.equal(trustedUrl('nope'), false);

// Gerçek bir npm-pack biçimli paket üret
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmy-upd-'));
fs.mkdirSync(path.join(tmp, 'src', 'package', 'server'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'src', 'package', 'server', 'index.js'), 'console.log("v9")');
fs.writeFileSync(path.join(tmp, 'src', 'package', 'package.json'), '{"version":"9.0.0"}');
const tgzPath = path.join(tmp, 'p.tgz');
assert.equal(spawnSync('tar', ['-czf', tgzPath, '-C', path.join(tmp, 'src'), 'package']).status, 0);
const file = fs.readFileSync(tgzPath);
const name = pkgName('9.0.0');
const sums = `${sha256(file)}  ${name}\n${'0'.repeat(64)}  other.dmg\n`;
const sig = sign(sums);

assert.equal(parseSums(sums).get(name), sha256(file));
assert.equal(verifySignature(sums, sig, pub), true);
assert.equal(verifySignature(sums, sig, other), false, 'yanlış anahtar');
assert.equal(verifySignature(sums + 'x', sig, pub), false, 'değiştirilmiş SUMS');
assert.equal(verifyPackage({ sums, sig, file, name, pubPem: pub }), true);
assert.throws(() => verifyPackage({ sums, sig, file: Buffer.from('tampered'), name, pubPem: pub }), /eşleşmiyor/);
assert.throws(() => verifyPackage({ sums, sig, file, name, pubPem: '' }), /anahtarı tanımlı değil/);
assert.throws(() => verifyPackage({ sums, sig: sign('x'), file, name, pubPem: pub }), /imzası geçersiz/);

const base = 'https://github.com/kpostaagasi/kmy-terminal/releases/download/v9.0.0/';
const release = {
  latest: '9.0.0',
  assets: [name, 'SHA256SUMS', 'SHA256SUMS.sig'].map((n) => ({ name: n, browser_download_url: base + n })),
};
assert.equal(canApply(release, 'git', pub), true);
assert.equal(canApply(release, 'git', ''), false, 'anahtarsız tek tık yok');
assert.equal(canApply(release, 'dmg', pub), false, 'macOS uygulaması Sparkle kullanır');
assert.equal(canApply({ ...release, assets: release.assets.slice(0, 2) }, 'git', pub), false, 'imzasız sürüm');

const body = { [name]: file, SHA256SUMS: Buffer.from(sums), 'SHA256SUMS.sig': Buffer.from(sig) };
const fakeFetch = async (u) => ({ ok: true, status: 200, url: u, arrayBuffer: async () => body[u.slice(base.length)] });
const dir = path.join(tmp, 'updates');
fs.mkdirSync(dir);
const r = await apply(release, { fetchImpl: fakeFetch, pub, dir, install: false });
assert.equal(r.version, '9.0.0');
assert.ok(fs.existsSync(path.join(dir, '9.0.0', 'server', 'index.js')));
const active = JSON.parse(fs.readFileSync(path.join(dir, 'active.json'), 'utf8'));
assert.equal(active.version, '9.0.0');

// Kurcalanmış paket kurulmaz, active.json yazılmaz
const dir2 = path.join(tmp, 'updates2');
fs.mkdirSync(dir2);
const badFetch = async (u) => ({
  ok: true,
  status: 200,
  url: u,
  arrayBuffer: async () => (u.endsWith('.tgz') ? Buffer.from('evil') : body[u.slice(base.length)]),
});
await assert.rejects(apply(release, { fetchImpl: badFetch, pub, dir: dir2, install: false }), /eşleşmiyor/);
assert.equal(fs.existsSync(path.join(dir2, 'active.json')), false);
// Güvenilmeyen yönlendirme
const redirFetch = async (u) => ({ ok: true, status: 200, url: 'https://evil.example/x', arrayBuffer: async () => Buffer.alloc(0) });
await assert.rejects(apply(release, { fetchImpl: redirFetch, pub, dir: dir2, install: false }), /güvenilmeyen/i);

// Açılış yönlendirmesi: yalnız daha yeni ve farklı klasördeki kurulum
const af = path.join(dir, 'active.json');
assert.equal(pickActive(af, '/somewhere/else', '0.1.3-beta')?.version, '9.0.0');
assert.equal(pickActive(af, '/somewhere/else', '9.0.0'), null, 'aynı/eski sürüme geçilmez');
assert.equal(pickActive(af, path.join(dir, '9.0.0'), '0.1.0'), null, 'kendine yönlenmez (döngü yok)');
assert.equal(pickActive(path.join(tmp, 'yok.json'), '/x', '0.1.0'), null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ tek tıkla güncelleme testleri geçti');

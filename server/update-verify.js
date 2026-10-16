// @ts-check
// Güncelleme paketi doğrulama: imzalı SHA256SUMS + paket özeti. Ağ/disk yok, saf fonksiyonlar.
import crypto from 'node:crypto';

// Yalnız GitHub'ın HTTPS uçlarından indirilir (yönlendirmeler dahil)
const HOSTS = new Set(['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
/** @param {string} u */
export function trustedUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && HOSTS.has(x.hostname);
  } catch {
    return false;
  }
}

/** "abc…  dosya.tgz" satırlarını Map'e çevirir. @param {string} text */
export function parseSums(text) {
  const m = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const r = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
    if (r) m.set(r[2], r[1].toLowerCase());
  }
  return m;
}

/** Ed25519 ayrık imza (base64) doğrulaması. @param {Buffer|string} data @param {string} sigB64 @param {string} pubPem */
export function verifySignature(data, sigB64, pubPem) {
  if (!pubPem || !sigB64) return false;
  try {
    return crypto.verify(null, Buffer.from(data), crypto.createPublicKey(pubPem), Buffer.from(String(sigB64).trim(), 'base64'));
  } catch {
    return false;
  }
}

export const sha256 = (/** @type {Buffer} */ buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Tüm zinciri doğrular: imza → SUMS → paket özeti. Hata mesajıyla fırlatır.
 * @param {{ sums: string, sig: string, file: Buffer, name: string, pubPem: string }} a
 */
export function verifyPackage({ sums, sig, file, name, pubPem }) {
  if (!pubPem) throw new Error('Sürüm imzalama anahtarı tanımlı değil; tek tıkla güncelleme kapalı');
  if (!verifySignature(sums, sig, pubPem)) throw new Error('SHA256SUMS imzası geçersiz');
  const want = parseSums(sums).get(name);
  if (!want) throw new Error(`SHA256SUMS içinde ${name} yok`);
  if (sha256(file) !== want) throw new Error('Paket özeti (SHA-256) eşleşmiyor');
  return true;
}

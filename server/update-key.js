// @ts-check
// Sürüm imzalama ortak anahtarı (Ed25519, SPKI PEM). Boşsa tek tıkla kurulum KAPALIDIR ve
// uygulama yalnız bildirim + elle indirme sunar. Özel anahtar yalnız GitHub secret
// KMY_RELEASE_SIGNING_KEY olarak tutulur (bkz. docs/guncelleme-imzalama.md).
// KMY_UPDATE_PUBKEY ortam değişkeni (PEM) test/kendi derlemeleri için bu değeri geçersiz kılar.
export const RELEASE_PUBLIC_KEY = '';
export const publicKey = (env = process.env) => (env.KMY_UPDATE_PUBKEY || RELEASE_PUBLIC_KEY || '').trim();

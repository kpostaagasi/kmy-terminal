// Arayüz dili: Türkçe kaynak metinler anahtardır; İngilizce karşılıklar lang/en.js'de.
// Tercih 'auto' ise sistem dili (macOS uygulaması window.__kmySystemLang verir), Türkçe dışı her dil İngilizceye düşer.
// Dil değişince sayfa yeniden yüklenir (modüller açılışta bir kez çizilir).
import EN, { patterns as EN_PATTERNS } from './lang/en.js';

export const LANGS = { auto: null, tr: 'Türkçe', en: 'English' };

function readPref() { try { return JSON.parse(localStorage.getItem('bt.lang')) || 'auto'; } catch { return 'auto'; } }
export function systemLang() {
  const l = String(window.__kmySystemLang || navigator.languages?.[0] || navigator.language || 'tr').toLowerCase();
  return l.startsWith('tr') ? 'tr' : 'en';
}
export function resolveLang(pref) { return pref === 'tr' || pref === 'en' ? pref : systemLang(); }

export const langPref = readPref();
export const lang = resolveLang(langPref);
export const locale = lang === 'tr' ? 'tr-TR' : 'en-GB';
document.documentElement.lang = lang;

// Sunucudaki ayar tarayıcıdaki kopyadan farklıysa kopyayı güncelle ve bir kez yeniden yükle
export function syncLangPref(pref) {
  pref = pref === 'tr' || pref === 'en' ? pref : 'auto';
  if (pref === langPref) return;
  try { localStorage.setItem('bt.lang', JSON.stringify(pref)); } catch { return; }
  if (resolveLang(pref) !== lang) location.reload();
}

const missing = new Set();
// t('Kaydedildi') · t('{n} işlem', { n: 3 }) — sözlükteki değer işlev olabilir (çoğul): (v) => …
// Aynı Türkçe sözcük farklı anlamlarda geçiyorsa başa bağlam yazılır: t('[tema]Açık') → Türkçede 'Açık'
export function t(s, vars) {
  if (s == null) return '';
  let out = s[0] === '[' ? s.replace(/^\[[^\]]*\]/, '') : s;
  if (lang === 'en') {
    const v = EN[s];
    if (typeof v === 'function') return v(vars || {});
    if (v != null) out = v;
    else if (/[çğıöşüÇĞİÖŞÜ]/.test(s) && !missing.has(s)) { missing.add(s); console.debug('[i18n] eksik:', s); }
  }
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : out;
}
// Sunucudan gelen metinler (hata iletileri, durum etiketleri): önce tam eşleşme, sonra kalıplar (lang/en/server.js)
export function tx(msg) {
  if (msg == null || lang === 'tr') return msg ?? '';
  const s = String(msg);
  const v = EN[s];
  if (typeof v === 'string') return v;
  for (const [re, rep] of EN_PATTERNS) if (re.test(s)) return s.replace(re, rep);
  return s;
}
// İngilizce için basit çoğul: tn(n, 'işlem', 'transaction', 'transactions')
export const plural = (n, one, many) => (Math.abs(n) === 1 ? one : many);
export const i18nMissing = () => [...missing];

// index.html gibi statik işaretlemeyi çevirir: data-i18n (metin) ile title / placeholder / aria-label öznitelikleri
export function translateDom(root = document) {
  if (lang === 'tr') return;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.textContent.trim());
  for (const a of ['title', 'placeholder', 'aria-label']) {
    for (const el of root.querySelectorAll(`[${a}]`)) el.setAttribute(a, t(el.getAttribute(a)));
  }
}

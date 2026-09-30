// Geliştirme izleyici: web/ altındaki dosya değişince açık istemcilere bildirir.
// Amaç: kod değiştikten sonra macOS uygulamasını (veya tarayıcıyı) elle yenilemek zorunda kalmamak.
// Yalnız kaynak ağacında çalışır — paketlenmiş .app içinde .git yok, izleyici hiç açılmaz.
// CSS değişiminde tam yenileme yerine yalnız stil dosyası değiştirilir; böylece yazma kutusundaki
// metin ve kaydırma konumu korunur. JS/HTML değişiminde tam yenileme yapılır.
import fs from 'node:fs';
import path from 'node:path';

const DEBOUNCE = 120;   // kaydedici birkaç yazma yapabiliyor, sessizlik için bekleniyor

export function watchWeb(ROOT, WEB_DIR, onChange) {
  // Kaynak ağacı değilse (paketlenmiş uygulama) izleme yapılmaz.
  const forced = process.env.BORSA_WATCH;
  if (forced === '0') return null;
  if (!forced && !fs.existsSync(path.join(ROOT, '.git'))) return null;
  if (!fs.existsSync(WEB_DIR)) return null;

  let timer = null;
  const seen = new Map();   // dosya → mtime, yalnız gerçekten değişenler için

  const handle = (file) => {
    const rel = path.relative(WEB_DIR, file).split(path.sep).join('/');
    if (!rel || rel.startsWith('..')) return;
    if (!/\.(css|js|html)$/.test(rel)) return;
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { return; }   // yazma sırasında anlık kaybolabilir
    if (seen.get(rel) === mtime) return;
    seen.set(rel, mtime);
    clearTimeout(timer);
    timer = setTimeout(() => onChange({ file: rel, mtime }), DEBOUNCE);
  };

  let watcher;
  try {
    watcher = fs.watch(WEB_DIR, { recursive: true }, (_e, name) => { if (name) handle(path.join(WEB_DIR, name)); });
  } catch (e) {
    console.error('[izleyici] web/ izlenemiyor:', e.message);
    return null;
  }
  console.log('  Geliştirme izleyici açık (web/ değişiklikleri canlı yükleniyor)');
  return {
    close: () => { clearTimeout(timer); watcher.close(); },
  };
}

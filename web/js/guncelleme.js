// Yeni sürüm uyarısı: açılışta /api/update'e sorar; yeni sürüm varsa kapatılabilir bir bildirim gösterir.
// "Bu sürümü atla" seçilen sürüm için bir daha gösterilmez; daha yeni bir sürüm çıkınca yeniden görünür.
import { api, on, h, esc, $, localGet, localSet, md, toast } from './core.js';
import { t } from './i18n.js';

const SKIP_KEY = 'updSkip';

// Kurulum biçimine göre güncelleme talimatı (HTML)
export function howTo(u) {
  if (u.kind === 'npx') return t('Uygulamayı kapatıp {cmd} komutunu yeniden çalıştırın.', { cmd: '<code>npx github:kpostaagasi/kmy-terminal</code>' });
  if (u.kind === 'git') return t('Proje klasöründe {cmd} çalıştırıp uygulamayı yeniden başlatın.', { cmd: '<code>git pull && npm install</code>' });
  return t('Yeni sürümü indirip kurun; verileriniz korunur.');
}

export function showUpdate(u) {
  document.querySelector('.upd-note')?.remove();
  const mac = u.kind === 'dmg' && !!window.webkit?.messageHandlers?.borsa;
  const one = u.oneClick ? `<button class="btn" data-apply>${t('Şimdi güncelle')}</button>` : mac ? `<button class="btn" data-sparkle>${t('Şimdi güncelle')}</button>` : '';
  const notes = u.notes ? `<details class="upd-notes"><summary>${t('Neler yeni?')}</summary><div class="md">${md(u.notes)}</div></details>` : '';
  const dl = u.oneClick || mac || u.kind === 'npx' || u.kind === 'git' ? '' : `<a class="btn" href="${esc(u.assetUrl || u.url)}" target="_blank" rel="noopener">${t('İndir')}</a>`;
  const el = h(`<div class="toast upd-note" role="status">
    <div><b>${t('Yeni sürüm: {v}', { v: esc(u.latest) })}</b> <span class="dim">(${t('kurulu: {v}', { v: esc(u.current) })})</span></div>
    <div class="upd-how">${u.oneClick ? t('İmzası doğrulanmış paket indirilip kurulur, uygulama yeniden başlar.') : howTo(u)}</div>
    ${notes}
    <div class="upd-acts">${one}${dl}<a class="btn sec" href="${esc(u.url)}" target="_blank" rel="noopener">${t('Sürüm notları')}</a><button class="btn sec" data-skip>${t('Bu sürümü atla')}</button><button class="btn sec" data-close>${t('Kapat')}</button></div>
  </div>`);
  el.querySelector('[data-skip]').onclick = () => { localSet(SKIP_KEY, u.latest); el.remove(); };
  el.querySelector('[data-close]').onclick = () => el.remove();
  el.querySelector('[data-sparkle]')?.addEventListener('click', () => { window.webkit.messageHandlers.borsa.postMessage({ type: 'checkForUpdates' }); el.remove(); });
  el.querySelector('[data-apply]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = t('İndiriliyor ve doğrulanıyor…');
    try {
      await api('/update/apply', { method: 'POST' });
      b.textContent = t('Yeniden başlatılıyor…');
      waitAndReload();
    } catch (x) { b.disabled = false; b.textContent = t('Şimdi güncelle'); toast(x.message, 'err', 8000); }
  });
  $('#toasts').append(el);
}

// Sunucu yeniden ayağa kalkınca sayfayı tazele
function waitAndReload(tries = 60) {
  setTimeout(() => fetch('/api/health', { cache: 'no-store' }).then((r) => (r.status < 500 ? location.reload() : waitAndReload(tries - 1))).catch(() => tries > 0 && waitAndReload(tries - 1)), 1500);
}

// macOS (Sparkle) otomatik kontrolü de aynı ayarı izler (opt-out)
on('settings', (s) => { try { window.webkit?.messageHandlers?.borsa?.postMessage({ type: 'updateAuto', on: s?.updateCheck !== false }); } catch { /* tarayıcı */ } });

on('ready', () => {
  api('/update').then((u) => { if (u?.available && localGet(SKIP_KEY, null) !== u.latest) showUpdate(u); }).catch(() => {});
});

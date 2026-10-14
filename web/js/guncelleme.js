// Yeni sürüm uyarısı: açılışta /api/update'e sorar; yeni sürüm varsa kapatılabilir bir bildirim gösterir.
// "Bu sürümü atla" seçilen sürüm için bir daha gösterilmez; daha yeni bir sürüm çıkınca yeniden görünür.
import { api, on, h, esc, $, localGet, localSet } from './core.js';
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
  const dl = u.kind === 'npx' || u.kind === 'git' ? '' : `<a class="btn" href="${esc(u.assetUrl || u.url)}" target="_blank" rel="noopener">${t('İndir')}</a>`;
  const el = h(`<div class="toast upd-note" role="status">
    <div><b>${t('Yeni sürüm: {v}', { v: esc(u.latest) })}</b> <span class="dim">(${t('kurulu: {v}', { v: esc(u.current) })})</span></div>
    <div class="upd-how">${howTo(u)}</div>
    <div class="upd-acts">${dl}<a class="btn sec" href="${esc(u.url)}" target="_blank" rel="noopener">${t('Sürüm notları')}</a><button class="btn sec" data-skip>${t('Bu sürümü atla')}</button><button class="btn sec" data-close>${t('Kapat')}</button></div>
  </div>`);
  el.querySelector('[data-skip]').onclick = () => { localSet(SKIP_KEY, u.latest); el.remove(); };
  el.querySelector('[data-close]').onclick = () => el.remove();
  $('#toasts').append(el);
}

on('ready', () => {
  api('/update').then((u) => { if (u?.available && localGet(SKIP_KEY, null) !== u.latest) showUpdate(u); }).catch(() => {});
});

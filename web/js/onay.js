// İlk açılışta beta / kullanım koşulları / gizlilik / SPK onayı. Onay verilmeden uygulama kullanılamaz.
import { h, localGet, localSet } from './core.js';
import { t } from './i18n.js';

export const ONAY_SURUM = 'beta-1';
export const onayVerildi = () => localGet('onay', null)?.v === ONAY_SURUM;

export function onayIste() {
  if (onayVerildi()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const back = h(`<div class="modal-back onay-back"><div class="modal" role="dialog" aria-modal="true" aria-label="${t('Beta kullanım onayı')}">
      <header><span>${t('kmy terminal — Beta')}</span></header>
      <div class="body">
        <p>${t('Bu uygulama ücretsiz bir beta sürümdür ve yalnız kişisel kullanım içindir.')}</p>
        <p><b>${t('Bu bir yatırım tavsiyesi değildir.')}</b> ${t('Fiyatlar, sinyaller, hedef fiyatlar ve yapay zekâ çıktıları yalnız bilgilendirme amaçlıdır; veriler gecikmeli veya hatalı olabilir.')}</p>
        <p><a href="/yasal/kullanim-kosullari.md" target="_blank">${t('Kullanım Koşulları')}</a> · <a href="/yasal/gizlilik.md" target="_blank">${t('Gizlilik Politikası')}</a> · <a href="/yasal/spk-uyari.md" target="_blank">${t('SPK Uyarısı')}</a></p>
        <label><input type="checkbox" data-onay> ${t('Okudum, anladım ve kabul ediyorum.')}</label>
      </div>
      <footer><button class="btn primary" data-kabul disabled>${t('Devam et')}</button></footer></div></div>`);
    const cb = back.querySelector('[data-onay]'), btn = back.querySelector('[data-kabul]');
    cb.addEventListener('change', () => { btn.disabled = !cb.checked; });
    btn.addEventListener('click', () => {
      localSet('onay', { v: ONAY_SURUM, at: new Date().toISOString() });
      back.remove(); resolve(true);
    });
    document.body.append(back);
  });
}

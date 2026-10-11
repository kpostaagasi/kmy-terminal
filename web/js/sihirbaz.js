// İlk açılış sihirbazı (3 adım) + beta geri bildirim düğmesi.
import { state, on, api, $, h, esc, modal, toast, localGet, localSet } from './core.js';
import { t, lang } from './i18n.js';

export const FEEDBACK_URL = 'https://github.com/kpostaagasi/kmy-terminal/issues/new';
const DONE_KEY = 'sihirbaz';

export function feedbackUrl({ text = '', version = '', ua = '' } = {}) {
  const body = `${text}\n\n---\nSürüm: ${version || '?'}\nOrtam: ${ua || '?'}`;
  return `${FEEDBACK_URL}?labels=${encodeURIComponent('beta-geri-bildirim')}&title=${encodeURIComponent('[Beta] ' + (text.split('\n')[0] || 'Geri bildirim').slice(0, 80))}&body=${encodeURIComponent(body)}`;
}

export function openFeedback() {
  const m = modal({
    title: t('Beta geri bildirimi'),
    body: `<p class="muted">${t('Hata, öneri veya eksik… Portföy, kimlik veya anahtar bilgisi yazmayın.')}</p>
      <textarea id="fbText" rows="6" style="width:100%" placeholder="${esc(t('Ne oldu? Ne bekliyordunuz?'))}"></textarea>`,
    footer: `<button class="btn primary" id="fbSend">${t('GitHub\'da gönder')}</button>`,
  });
  $('#fbSend').onclick = () => {
    const text = $('#fbText').value.trim();
    if (!text) return toast(t('Önce bir şey yazın'), 'err');
    window.open(feedbackUrl({ text, version: state.meta?.version, ua: navigator.userAgent }), '_blank', 'noopener');
    m?.close?.();
  };
}

function step(i, html) { return `<div class="wiz-step" data-step="${i}" ${i ? 'hidden' : ''}>${html}</div>`; }

export function openWizard() {
  const provs = Object.entries(state.meta?.providers || {});
  const m = modal({
    title: t('Hoş geldiniz — kmy terminal beta'),
    body: step(0, `<p>${t('kmy terminal; BIST, döviz/altın ve TEFAS fonlarını tek ekranda izleyen, verisini yalnız bilgisayarınızda tutan bir terminaldir.')}</p>
        <p>${t('Önce izleme listenize birkaç sembol ekleyin, sonra Portföy sekmesinden pozisyonlarınızı girin.')}</p>`)
      + step(1, `<p>${t('Analiz asistanı kendi aboneliğinizle çalışır (Claude, ChatGPT/Codex veya omp). Daha sonra Ayarlar › Asistan\'dan değiştirebilirsiniz.')}</p>
        ${provs.length ? `<select id="wizProv">${provs.map(([k, v]) => `<option value="${esc(k)}">${esc(typeof v === 'string' ? v : k)}</option>`).join('')}</select>` : `<p class="muted">${t('Kurulu bir asistan bulunamadı; asistansız da kullanılabilir.')}</p>`}`)
      + step(2, `<p>${t('Fiyatlar gecikmeli olabilir; Yahoo kaynaklı veriler deneysel/gecikmelidir. Kaynakları Ayarlar › Veri\'den seçebilirsiniz.')}</p>
        <p><b>${t('Bu bir yatırım tavsiyesi değildir.')}</b></p>
        <p>${t('Sağ üstteki 💬 düğmesiyle istediğiniz an geri bildirim gönderebilirsiniz.')}</p>`),
    footer: `<button class="btn sec" id="wizSkip">${t('Atla')}</button><button class="btn primary" id="wizNext">${t('İleri')}</button>`,
  });
  let i = 0;
  const finish = async () => {
    const p = $('#wizProv')?.value;
    if (p) await api('/settings', { method: 'PUT', body: { provider: p } }).catch(() => {});
    localSet(DONE_KEY, { at: new Date().toISOString(), lang });
    m?.close?.();
  };
  $('#wizSkip').onclick = () => { localSet(DONE_KEY, { at: new Date().toISOString(), skipped: true }); m?.close?.(); };
  $('#wizNext').onclick = () => {
    if (i >= 2) return finish();
    document.querySelector(`.wiz-step[data-step="${i}"]`).hidden = true;
    i++;
    document.querySelector(`.wiz-step[data-step="${i}"]`).hidden = false;
    if (i === 2) $('#wizNext').textContent = t('Başla');
  };
}

// Onay penceresi (varsa) kapanınca sihirbazı aç.
function whenNoConsent(fn) {
  if (!document.querySelector('.onay-back')) return fn();
  const mo = new MutationObserver(() => { if (!document.querySelector('.onay-back')) { mo.disconnect(); fn(); } });
  mo.observe(document.body, { childList: true });
}

on('ready', () => {
  const btn = $('#btnFeedback');
  if (btn) btn.onclick = openFeedback;
  if (!localGet(DONE_KEY, null)) whenNoConsent(openWizard);
});

// Veri sağlığı rozeti: durum çubuğunda son çapraz kaynak denetiminin sonucu; tıklayınca ayrıntı ve "Şimdi denetle".
// Denetim elle veya kapanıştan sonra çalışır (sunucu: server/denetim.js).
import { on, api, $, esc, num, toast, modal, timeTR, dateTR } from './core.js';
import { notify } from './chat.js';
import { t, tx } from './i18n.js';

const badge = $('#dhBadge');
let data = null;      // son GET/POST yanıtı
let running = false;  // bu pencerede koşu sürüyor
let panel = null;     // açık pencere (modal nesnesi)
let lastError = '';

const isStale = () => !!data?.stale;
const busy = () => running || !!data?.running;
const fmt = (v) => (v == null ? '—' : String(Number(Number(v).toPrecision(6))));
const STATE_CLS = { temiz: 'dh-ok', uyari: 'dh-warn', dogrulanamadi: 'dh-unk', yok: 'dh-none' };
const DURUM = { OK: ['OK', 'up'], SAPMA: [t('SAPMA'), 'down'], ATLANDI: [t('ATLANDI'), ''] };

// Sunucu satırları Türkçe gelir; bilinen grup, kontrol adı ve neden metinleri bağlamlı anahtarlarla çevrilir (dinamik nedenler olduğu gibi kalır).
const GRUP = { 'Döviz': t('[denetim]Döviz'), 'Altın': t('[denetim]Altın'), 'Altın türü': t('[denetim]Altın türü'), 'Hisse': t('[denetim]Hisse'), 'Tazelik': t('[denetim]Tazelik'), 'Temel': t('[denetim]Temel oranlar'), 'Portföy': t('[denetim]Portföy') };
const AD = { 'Σ pozisyon değeri': t('[denetim]Σ pozisyon değeri'), 'Σ platform değeri': t('[denetim]Σ platform değeri'), 'Toplam değer': t('[denetim]Toplam değer'), 'FAVÖK': t('[denetim]FAVÖK'), 'Net kâr': t('[denetim]Net kâr'), 'F/K': t('[denetim]F/K') };
const NEDEN = {
  'değer yok': t('[denetim]değer yok'),
  'seans açık; kapanış değeri karşılaştırılamaz': t('[denetim]seans açık; kapanış değeri karşılaştırılamaz'),
  'İş Yatırım verisi tazelenemedi (eski önbellek)': t('[denetim]İş Yatırım verisi tazelenemedi (eski önbellek)'),
  'yedek kaynak (Truncgil yok)': t('[denetim]yedek kaynak (Truncgil yok)'),
  'TCMB kuru önceki iş gününe ait (pazar/pazartesi)': t('[denetim]TCMB kuru önceki iş gününe ait (pazar/pazartesi)'),
  'banka için FAVÖK anlamsız': t('[denetim]banka için FAVÖK anlamsız'),
  'ham satır yok': t('[denetim]ham satır yok'),
  '12 aylık net kâr veya piyasa değeri yok/≤0': t('[denetim]12 aylık net kâr veya piyasa değeri yok/≤0'),
  'pozisyon yok': t('[denetim]pozisyon yok'),
  'eksik kur var': t('[denetim]eksik kur var'),
  'fiyat yok': t('[denetim]fiyat yok'),
};
const adLabel = (ad) => { const m = /^(\S+) (FAVÖK|Net kâr|F\/K)$/.exec(ad); return m ? `${m[1]} ${AD[m[2]]}` : AD[ad] || ad; };

function paintBadge() {
  const state = data?.state || 'yok';
  const o = data?.summary || { ok: 0, sapma: 0, atlandi: 0 };
  const hm = timeTR(data?.at);
  const text = { temiz: `✓ ${hm}`, uyari: `⚠ ${o.sapma}`, dogrulanamadi: '?', yok: `· ${t('denetlenmedi')}` }[state];
  badge.className = `dh-badge ${STATE_CLS[state]}${isStale() ? ' dh-old' : ''}`;
  badge.textContent = `${t('VERİ')} ${text}${isStale() ? ` (${t('eski')})` : ''}${busy() ? ' …' : ''}`;
  badge.title = state === 'yok'
    ? t('Henüz denetlenmedi. Tıklayıp “Şimdi denetle”ye basın.')
    : `${t('OK {ok} · SAPMA {sapma} · ATLANDI {atlandi}', o)} · ${t('son denetim {t}', { t: hm })}`;
}

function rowsHtml() {
  if (!data || data.state === 'yok') return `<p class="dim">${t('Henüz denetlenmedi. “Şimdi denetle” bağımsız ikinci kaynaklarla karşılaştırır (yaklaşık 40 sn).')}</p>`;
  const rank = { SAPMA: 0, OK: 1, ATLANDI: 2 };
  const rows = (g) => data.results.filter((r) => r.grup === g).sort((a, b) => (rank[a.durum] ?? 3) - (rank[b.durum] ?? 3));
  const worst = (g) => Math.min(...rows(g).map((r) => rank[r.durum] ?? 3));
  const groups = [...new Set(data.results.map((r) => r.grup))].sort((a, b) => worst(a) - worst(b)); // SAPMA içeren gruplar önce
  return groups.map((g) => `<div class="kt-mini-h" style="margin-top:10px">${esc(GRUP[g] || g)}</div><div class="table-wrap"><table class="t dh-tbl"><tbody>${rows(g).map((r) => {
    const [label, cls] = DURUM[r.durum] || [r.durum, ''];
    const vals = r.grup === 'Portföy' || (r.app == null && r.ref == null) ? '' : `${fmt(r.app)} ↔ ${fmt(r.ref)}`; // portföy tutarı asla gösterilmez
    return `<tr><td>${esc(adLabel(r.ad))}</td><td><span class="pill ${cls}">${esc(label)}</span></td><td class="r num">${r.sapmaPct == null ? '—' : `%${num(r.sapmaPct, 3)}`}</td><td class="r num dim">${esc(vals)}</td><td class="dim kt-wrap">${esc(NEDEN[r.neden] || r.neden || '')}</td></tr>`;
  }).join('')}</tbody></table></div>`).join('');
}

function panelHtml() {
  const summary = data?.at ? `${t('OK {ok} · SAPMA {sapma} · ATLANDI {atlandi}', data.summary)} · ${t('son denetim {t}', { t: `${dateTR(data.at)} ${timeTR(data.at)}` })}` : '';
  return `<div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
    <span id="dhSum">${esc(summary)}</span>
    <button class="btn" id="dhRun" ${busy() ? 'disabled' : ''}>${busy() ? `<span class="spinner"></span> ${t('denetleniyor… (≈40 sn)')}` : t('Şimdi denetle')}</button>
  </div>
  ${lastError ? `<div class="kt-note down">${esc(lastError)}</div>` : ''}
  <div id="dhRows">${rowsHtml()}</div>
  <p class="stg-note dim" style="margin-top:10px">${t('ATLANDI hata değildir, doğrulanamadı demektir (seans açık, kaynağa erişilemedi…). Denetim bağımsız ikinci kaynaklarla karşılaştırır: TCMB, İş Yatırım, TEFAS, KAP mali tabloları.')}</p>`;
}

function bindPanel() { const b = $('#dhRun', panel.body); if (b) b.onclick = runNow; }
function repaint() {
  paintBadge();
  if (panel?.el.isConnected) { panel.body.innerHTML = panelHtml(); bindPanel(); }
}

async function runNow() {
  if (busy()) return; // çift tıklama ikinci koşu başlatmaz
  running = true; lastError = ''; repaint();
  try { data = await api('/data-health/run', { method: 'POST' }); }
  catch (e) { lastError = tx(e.message); if (!panel?.el.isConnected) toast(lastError, 'err'); } // rozet önceki durumunu korur
  finally { running = false; }
  repaint();
}

let pollTimer = 0;
async function load() {
  try { data = await api('/data-health'); } catch { /* rozet önceki durumunu korur */ }
  repaint();
  clearTimeout(pollTimer);
  if (data?.running) pollTimer = setTimeout(load, 5000); // başka pencerede koşu sürerken: olay kaçarsa "çalışıyor"da takılı kalmaz
}

badge.onclick = () => {
  lastError = '';
  panel = modal({ title: t('Veri sağlığı'), body: panelHtml(), wide: true, onClose: () => { panel = null; } });
  bindPanel();
};
on('ws:data-health.updated', load); // başka pencerede koşu bitti
on('app:refresh', load);
setInterval(load, 10 * 60_000); // açık uygulamada vade sunucudan gelir
on('ws:data-health.alert', (m) => {
  notify(t('VERİ ⚠ {n} sapma', { n: m?.sapma || 0 }), [{ label: t('Aç'), run: () => badge.click() }], t('Veri uyarısı'));
  load();
});
load();

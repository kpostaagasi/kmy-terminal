// KAP sekmesi: bildirim akışı, sinyal sınıfları (Tez/Yapı/Finans/Kurumsal/Diğer), okundu takibi, uygulama içi bildirim içeriği
import { state, on, emit, api, $, $$, h, esc, toast, askAgent, localGet, localSet, selectSymbol, debounce, modal, openPdfViewer } from './core.js';
import { t, tx } from './i18n.js';

const SIG_STYLE = { TEZ: 'sig-tez', YAPISAL: 'sig-yap', FINANSAL: 'sig-fin', KURUMSAL: 'sig-kur', DIGER: 'sig-dig' };
const SIG_LABEL = { TEZ: t('Tez'), YAPISAL: t('Yapı'), FINANSAL: t('Finans'), KURUMSAL: t('Kurumsal'), DIGER: t('Diğer') };
const sigTitle = (sig) => esc(tx(state.meta?.kapSignals?.[sig]?.title || ''));
export function signalPill(sig) {
  return sig ? `<span class="sig ${SIG_STYLE[sig] || ''}" title="${sigTitle(sig)}">${esc(SIG_LABEL[sig] || tx(state.meta?.kapSignals?.[sig]?.label || sig))}</span>` : '';
}

const root = $('#rtab-kap');
root.innerHTML = `
  <div class="kap-filters">
    <select id="kScope" aria-label="${t('Kapsam')}"><option value="watchlist">${t('İzleme listesi')}</option><option value="portfolio">${t('Portföyüm')}</option><option value="all">${t('Tüm şirketler')}</option><option value="symbol">${t('Seçili sembol')}</option></select>
    <select id="kDays" aria-label="${t('Dönem')}"><option value="1">${t('{n} gün', { n: 1 })}</option><option value="3" selected>${t('{n} gün', { n: 3 })}</option><option value="7">${t('{n} gün', { n: 7 })}</option><option value="30">${t('{n} gün', { n: 30 })}</option><option value="90" title="${t('İzleme listesi, portföy veya sembol kapsamında')}">${t('{n} gün', { n: 90 })}</option><option value="365" title="${t('İzleme listesi, portföy veya sembol kapsamında')}">${t('1 yıl')}</option></select>
    <select id="kCls" aria-label="${t('Bildirim türü')}"><option value="">${t('Tüm türler')}</option><option value="ODA">${t('Özel durum')}</option><option value="FR">${t('Finansal rapor')}</option><option value="DG">${t('Diğer')}</option><option value="DKB">${t('Düzenleyici kurum')}</option></select>
    <input id="kQ" placeholder="${t('Sembol veya metin')}" aria-label="${t('Bildirimlerde ara (sembol veya metin)')}">
  </div>
  <div class="kap-sigs" id="kSigs"></div>
  <div class="row between" style="padding:4px 10px;font-size:11px"><span class="dim" id="kInfo"></span>
    <span class="row" style="gap:6px"><button class="icon-btn sm" id="kRefresh" title="${t('KAP’tan yenile')}">↻</button><button class="ghost" id="kRead" title="${t('Listedeki tüm bildirimleri okundu say')}">${t('Okundu say')}</button><button class="ghost" id="kAsk">${t('Tez sinyallerini asistanla özetle')}</button></span></div>
  <div class="list" id="kList"></div>`;

let f = { scope: localGet('kapScope', 'watchlist'), cls: '', days: 3, q: '', symbol: null, signal: localGet('kapSignal', '') };
const seen = new Set(localGet('kapSeen', []));
let unread = 0, items = [], total = 0, loading = false;
$('#kScope').value = f.scope;

let forceNext = false;
function qs(offset = 0) {
  const sym = f.scope === 'symbol' ? (f.symbol || state.selected) : '';
  return `/kap?scope=${f.scope}&symbol=${encodeURIComponent(sym)}&days=${f.days}&cls=${f.cls}&signal=${f.signal}&q=${encodeURIComponent(f.q)}&offset=${offset}&limit=100${forceNext ? '&refresh=1' : ''}`;
}

function itemHtml(x) {
  return `<div class="kap-item ${seen.has(x.id) ? '' : 'new'}" data-id="${x.id}">
    <div class="top">${signalPill(x.signal)}${x.stocks.slice(0, 3).map((s) => `<span class="stk" data-s="${esc(s)}">${esc(s)}</span>`).join(' ')}<span class="pill">${esc(tx(x.clsLabel))}</span>${x.late ? `<span class="pill down">${t('Geç bildirim')}</span>` : ''}${x.attachments ? `<span class="pill" title="${t('Ek dosya')}">📎 ${x.attachments}</span>` : ''}<span style="margin-left:auto">${esc(x.publishDate)}</span></div>
    <div class="subj">${esc(x.subject || '')}</div>
    ${x.summary ? `<div class="co">${esc(x.summary)}</div>` : ''}
    <div class="co dim">${esc(x.company)}</div>
    <div class="acts"><button data-open="${x.id}">${t('İçeriği göster')}</button><a href="${esc(x.url)}" target="_blank" rel="noopener">${t('KAP’ta aç ↗')}</a><button data-ask="${x.id}">${t('Asistanla analiz et')}</button></div></div>`;
}

let reqTok = 0;
async function load(append = false) {
  if (append && loading) return; // aynı anda iki "daha fazla" isteği olmasın
  const tok = ++reqTok;           // yeni filtre isteği öncekini geçersiz kılar
  loading = true;
  if (!append) $('#kList').innerHTML = '<div class="pad"><div class="skeleton"></div></div>';
  try {
    const r = await api(qs(append ? items.length : 0));
    forceNext = false;
    if (tok !== reqTok) return;
    items = append ? [...items, ...r.items] : r.items;
    total = r.total;
    const sym = f.scope === 'symbol' ? (f.symbol || state.selected) : '';
    $('#kInfo').textContent = [t('{n} bildirim', { n: total }), sym, r.stale ? t('önbellekten') : '', r.error ? tx(r.error) : ''].filter(Boolean).join(' · ');
    const counts = r.counts || {};
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    $('#kSigs').innerHTML = `<button class="${!f.signal ? 'on' : ''}" data-sig="">${t('Tümü')} <b>${sum}</b></button>` + ['TEZ', 'YAPISAL', 'FINANSAL', 'KURUMSAL', 'DIGER'].map((k) => `<button class="${f.signal === k ? 'on' : ''}" data-sig="${k}" title="${sigTitle(k)}">${signalPill(k)} <b>${counts[k] || 0}</b></button>`).join('');
    $('#kList').innerHTML = items.map(itemHtml).join('') || `<div class="empty">${f.signal ? t('{label} sınıfında bildirim yok', { label: esc(SIG_LABEL[f.signal] || f.signal) }) : f.scope === 'watchlist' ? t('İzleme listenizdeki hisseler için bildirim yok') : t('Bildirim yok')}</div>`;
    if (items.length < total) $('#kList').append(h(`<button class="ghost" id="kMore" style="margin:10px auto;display:block">${t('Daha fazla yükle ({n})', { n: total - items.length })}</button>`));
    if (root.classList.contains('active')) { unread = 0; badge(); }
  } catch (e) {
    if (tok === reqTok) $('#kList').innerHTML = `<div class="empty">${esc(tx(e.message))}</div>`;
  } finally { if (tok === reqTok) loading = false; }
}

$('#kList').addEventListener('click', (e) => {
  const more = e.target.closest('#kMore'); if (more) { load(true); return; }
  const op = e.target.closest('[data-open]'); if (op) { openKapDetail(Number(op.dataset.open)); markSeen([Number(op.dataset.open)]); return; }
  const ask = e.target.closest('[data-ask]');
  if (ask) { const x = items.find((i) => String(i.id) === ask.dataset.ask); askAboutDisclosure(x); markSeen([x.id]); return; }
  const stk = e.target.closest('.stk'); if (stk) { selectSymbol(stk.dataset.s); return; }
  const a = e.target.closest('a'); if (a) { const it = e.target.closest('.kap-item'); if (it) markSeen([Number(it.dataset.id)]); }
});
$('#kSigs').addEventListener('click', (e) => { const b = e.target.closest('[data-sig]'); if (!b) return; f.signal = b.dataset.sig; localSet('kapSignal', f.signal); load(); });

function markSeen(ids) {
  for (const id of ids) seen.add(id);
  localSet('kapSeen', [...seen].slice(-5000));
  for (const id of ids) $(`.kap-item[data-id="${id}"]`, root)?.classList.remove('new');
}
function badge() { $('#kapBadge').hidden = !unread; $('#kapBadge').textContent = unread; }

function askAboutDisclosure(x, content = null) {
  askAgent([
    t('Şu KAP bildirimini analiz et (id {id}; tam metin için get_kap_detail aracını kullan):', { id: x.id }),
    t('Şirket: {company} ({stocks})', { company: x.company, stocks: (x.stocks || []).join(', ') }),
    t('Konu: {subject}', { subject: x.subject }),
    x.summary ? t('Özet: {summary}', { summary: x.summary }) : '',
    content ? t('İçerikten: {content}', { content: content.slice(0, 1500) }) : '',
    t('Bildirimin ne anlama geldiğini, şirketin ölçeğine göre önemini, olası fiyat etkisini ve dikkat edilmesi gereken noktaları açıkla.'),
  ].filter(Boolean).join('\n'));
}

// KAP eki: PDF'ler uygulama içinde (sunucu KAP'ın dosya sarmalını temizler), diğerleri indirilir
function openKapAttachment(a, d) {
  const objId = a.url.split('/').pop();
  const src = `/api/kap/file/${objId}`;
  const sym = d.stocks?.[0] || '';
  if (!/pdf/i.test(a.ext || a.name)) { window.open(src, '_blank', 'noopener'); return; }
  openPdfViewer({
    src, title: a.name, name: a.name,
    actions: [
      { label: t('Arşive kaydet'), run: async () => { try { const r = await api(`/kap/file/${objId}/save`, { method: 'POST', body: { symbol: sym, name: a.name } }); toast(t('Kaydedildi: {path}', { path: r.path }), 'ok'); } catch (e) { toast(tx(e.message), 'err'); } } },
      { label: t('Asistanla oku'), run: (m) => { m.close(); askAgent(t('{company} şirketinin KAP bildirim ekini oku: {call} ile arşive indir, pdf-okuma becerisiyle oku; ana bulguları, rakamları (sayfa numarasıyla) ve şirket için önemini özetle.', { company: d.company || sym, call: `save_kap_attachment({ url: "${a.url}", symbol: "${sym}", name: "${a.name}" })` })); } },
    ],
  });
}

// Bildirim içeriği (uygulama içinde)
export async function openKapDetail(id) {
  const m = modal({ title: t('Bildirim içeriği'), wide: true, body: '<div class="skeleton" style="height:200px"></div>', onClose: () => { state.openKap = null; emit('kap:opened', null); } });
  state.openKap = { id };
  emit('kap:opened', id);
  try {
    const d = await api(`/kap/${id}`);
    state.openKap = { id, title: d.title, stocks: d.stocks };
    const safe = window.DOMPurify ? window.DOMPurify.sanitize(d.html, { FORBID_TAGS: ['style', 'script', 'form', 'input'], FORBID_ATTR: ['style'] }) : esc(d.text);
    m.body.innerHTML = `<div class="row between" style="margin-bottom:10px"><div><b>${esc(d.title || '')}</b><div class="dim">${esc(d.company || '')} · ${esc(d.publishDate || '')} · ${d.stocks.map((s) => `<span class="stk mono" data-s="${esc(s)}" style="cursor:pointer;color:var(--accent)">${esc(s)}</span>`).join(' ')}</div></div>
      <div class="row"><button class="btn" id="kdAsk">${t('Asistanla analiz et')}</button><a class="btn sec" href="${esc(d.url)}" target="_blank" rel="noopener">${t('KAP’ta aç ↗')}</a></div></div>
      ${d.attachments.length ? `<div class="row" style="margin-bottom:10px">${d.attachments.map((a, i) => `<button class="pill" data-att="${i}" title="${t('Uygulama içinde aç')}">📎 ${esc(a.name)}</button>`).join('')}</div>` : ''}
      <div class="kap-detail">${safe}</div>`;
    $('#kdAsk', m.body).onclick = () => { m.close(true); state.openKap = null; askAboutDisclosure({ id: d.id, company: d.company, stocks: d.stocks, subject: d.title, summary: d.summary }, d.text); };
    $$('.stk', m.body).forEach((s) => s.onclick = () => { m.close(); selectSymbol(s.dataset.s); });
    $$('[data-att]', m.body).forEach((b) => b.onclick = () => openKapAttachment(d.attachments[Number(b.dataset.att)], d));
  } catch (e) {
    m.body.innerHTML = `<div class="empty">${esc(tx(e.message))}<br><a href="https://www.kap.org.tr/tr/Bildirim/${id}" target="_blank" rel="noopener">${t('KAP’ta aç ↗')}</a></div>`;
  }
}

$('#kScope').onchange = (e) => { f.scope = e.target.value; f.symbol = null; localSet('kapScope', f.scope); load(); };
$('#kCls').onchange = (e) => { f.cls = e.target.value; load(); };
$('#kDays').onchange = (e) => {
  f.days = Number(e.target.value);
  if (f.days > 31 && f.scope === 'all') toast(t('Tüm şirketler için en fazla 31 gün gösterilir; daha uzun geçmiş için sembol, izleme listesi veya portföy kapsamını seçin.'));
  load();
};
$('#kQ').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); load(); }, 300));
$('#kRefresh').onclick = async () => {
  const b = $('#kRefresh'); b.disabled = true; b.classList.add('spin');
  forceNext = true;
  try { await load(); } finally { forceNext = false; b.disabled = false; b.classList.remove('spin'); }
};
$('#kRead').onclick = () => { markSeen(items.map((x) => x.id)); unread = 0; badge(); };
const ASK_SCOPE = {
  watchlist: (days) => t('İzleme listemdeki şirketlerin son {days} günlük KAP bildirimlerinde TEZ (tez değiştirebilecek) ve YAPISAL sinyalleri tara; önemli olanların içeriğini get_kap_detail ile oku ve önem sırasıyla özetle.', { days }),
  portfolio: (days) => t('Portföyümdeki şirketlerin son {days} günlük KAP bildirimlerinde TEZ (tez değiştirebilecek) ve YAPISAL sinyalleri tara; önemli olanların içeriğini get_kap_detail ile oku ve önem sırasıyla özetle.', { days }),
  all: (days) => t('Tüm şirketlerin son {days} günlük KAP bildirimlerinde TEZ (tez değiştirebilecek) ve YAPISAL sinyalleri tara; önemli olanların içeriğini get_kap_detail ile oku ve önem sırasıyla özetle.', { days }),
};
$('#kAsk').onclick = () => askAgent(f.scope === 'symbol'
  ? t('{symbol} için son {days} günün KAP bildirimlerini tara (get_kap_disclosures); tez değiştirebilecek olanları get_kap_detail ile okuyup önem sırasıyla özetle.', { symbol: f.symbol || state.selected, days: f.days })
  : (ASK_SCOPE[f.scope] || ASK_SCOPE.all)(f.days));

on('kap:filter', (x) => { Object.assign(f, x); $('#kScope').value = f.scope; load(); });
on('ws:kap.updated', (m) => {
  if (m.fresh?.length) {
    unread += m.fresh.length; badge();
    const x = m.fresh[0];
    toast(`KAP ${SIG_LABEL[x.signal] ? `[${SIG_LABEL[x.signal]}] ` : ''}${x.stocks[0] || ''} — ${x.subject}${m.fresh.length > 1 ? ` (+${m.fresh.length - 1})` : ''}`, '', 8000);
  }
  if (root.classList.contains('active')) load();
});
on('rtab:shown', (tab) => { if (tab === 'kap') load(); });
on('symbol', () => { if (f.scope === 'symbol' && root.classList.contains('active')) load(); });
on('ready', () => { if (root.classList.contains('active')) load(); });

on('kap:open', (id) => openKapDetail(id));

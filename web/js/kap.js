// KAP sekmesi: bildirim akışı, sinyal sınıfları (TEZ/YAP/FİN/KUR/DİĞER), okundu takibi, uygulama içi bildirim içeriği
import { state, on, emit, api, $, $$, h, esc, toast, askAgent, localGet, localSet, selectSymbol, debounce, modal, openPdfViewer } from './core.js';

const SIG_STYLE = { TEZ: 'sig-tez', YAPISAL: 'sig-yap', FINANSAL: 'sig-fin', KURUMSAL: 'sig-kur', DIGER: 'sig-dig' };
const SIG_LABEL = { TEZ: 'TEZ', YAPISAL: 'YAP', FINANSAL: 'FİN', KURUMSAL: 'KUR', DIGER: 'DİĞER' };
export function signalPill(sig) {
  return sig ? `<span class="sig ${SIG_STYLE[sig] || ''}" title="${esc(state.meta?.kapSignals?.[sig]?.title || '')}">${SIG_LABEL[sig] || sig}</span>` : '';
}

const root = $('#rtab-kap');
root.innerHTML = `
  <div class="kap-filters">
    <select id="kScope" aria-label="Kapsam"><option value="watchlist">Watchlist</option><option value="portfolio">Portföyüm</option><option value="all">Tüm şirketler</option><option value="symbol">Seçili sembol</option></select>
    <select id="kDays" aria-label="Dönem"><option value="1">1 gün</option><option value="3" selected>3 gün</option><option value="7">7 gün</option><option value="30">30 gün</option><option value="90" title="Watchlist, portföy veya sembol kapsamında">90 gün</option><option value="365" title="Watchlist, portföy veya sembol kapsamında">1 yıl</option></select>
    <select id="kCls" aria-label="KAP türü"><option value="">Tüm türler</option><option value="ODA">Özel Durum</option><option value="FR">Finansal Rapor</option><option value="DG">Diğer</option><option value="DKB">Düzenleyici Kurum</option></select>
    <input id="kQ" placeholder="Ticker" aria-label="Bildirimlerde ara (ticker veya metin)">
  </div>
  <div class="kap-sigs" id="kSigs"></div>
  <div class="row between" style="padding:4px 10px;font-size:11px"><span class="dim" id="kInfo"></span>
    <span class="row" style="gap:6px"><button class="icon-btn sm" id="kRefresh" title="KAP'tan yenile">↻</button><button class="ghost" id="kRead" title="Listeyi okundu say">Okundu say</button><button class="ghost" id="kAsk">Ajan: tez sinyallerini özetle</button></span></div>
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
    <div class="top">${signalPill(x.signal)}${x.stocks.slice(0, 3).map((s) => `<span class="stk" data-s="${esc(s)}">${esc(s)}</span>`).join(' ')}<span class="pill">${esc(x.clsLabel)}</span>${x.late ? '<span class="pill down">Geç</span>' : ''}${x.attachments ? `<span class="pill" title="Ek dosya">📎 ${x.attachments}</span>` : ''}<span style="margin-left:auto">${esc(x.publishDate)}</span></div>
    <div class="subj">${esc(x.subject || '')}</div>
    ${x.summary ? `<div class="co">${esc(x.summary)}</div>` : ''}
    <div class="co dim">${esc(x.company)}</div>
    <div class="acts"><button data-open="${x.id}">İçeriği göster</button><a href="${esc(x.url)}" target="_blank" rel="noopener">KAP'ta aç ↗</a><button data-ask="${x.id}">Ajan ile analiz et</button></div></div>`;
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
    $('#kInfo').textContent = `${total} bildirim${sym ? ` · ${sym}` : ''}${r.stale ? ' · önbellek' : ''}${r.error ? ` · ${r.error}` : ''}`;
    const counts = r.counts || {};
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    $('#kSigs').innerHTML = `<button class="${!f.signal ? 'on' : ''}" data-sig="">TÜMÜ <b>${sum}</b></button>` + ['TEZ', 'YAPISAL', 'FINANSAL', 'KURUMSAL', 'DIGER'].map((k) => `<button class="${f.signal === k ? 'on' : ''}" data-sig="${k}" title="${esc(state.meta?.kapSignals?.[k]?.title || '')}">${signalPill(k)} <b>${counts[k] || 0}</b></button>`).join('');
    $('#kList').innerHTML = items.map(itemHtml).join('') || `<div class="empty">${f.signal ? `${SIG_LABEL[f.signal]} sinyali yok` : f.scope === 'watchlist' ? 'İzleme listenizdeki hisseler için bildirim yok' : 'Bildirim yok'}</div>`;
    if (items.length < total) $('#kList').append(h(`<button class="ghost" id="kMore" style="margin:10px auto;display:block">Daha fazla yükle (${total - items.length})</button>`));
    if (root.classList.contains('active')) { unread = 0; badge(); }
  } catch (e) {
    if (tok === reqTok) $('#kList').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
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
  askAgent(`Şu KAP bildirimini analiz et (id ${x.id}; tam metin için get_kap_detail aracını kullan):\nŞirket: ${x.company} (${(x.stocks || []).join(', ')})\nKonu: ${x.subject}${x.summary ? `\nÖzet: ${x.summary}` : ''}${content ? `\nİçerikten: ${content.slice(0, 1500)}` : ''}\nBildirimin ne anlama geldiğini, şirketin ölçeğine göre önemini, olası fiyat etkisini ve dikkat edilmesi gereken noktaları açıkla.`);
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
      { label: 'Arşive kaydet', run: async () => { try { const r = await api(`/kap/file/${objId}/save`, { method: 'POST', body: { symbol: sym, name: a.name } }); toast(`Kaydedildi: ${r.path}`, 'ok'); } catch (e) { toast(e.message, 'err'); } } },
      { label: 'Ajan ile oku', run: (m) => { m.close(); askAgent(`${d.company || sym} şirketinin KAP bildirim ekini oku: save_kap_attachment({ url: "${a.url}", symbol: "${sym}", name: "${a.name}" }) ile arşive indir, pdf-okuma becerisiyle oku; ana bulguları, rakamları (sayfa numarasıyla) ve şirket için önemini özetle.`); } },
    ],
  });
}

// Bildirim içeriği (uygulama içinde)
export async function openKapDetail(id) {
  const m = modal({ title: 'Bildirim İçeriği', wide: true, body: '<div class="skeleton" style="height:200px"></div>', onClose: () => { state.openKap = null; emit('kap:opened', null); } });
  state.openKap = { id };
  emit('kap:opened', id);
  try {
    const d = await api(`/kap/${id}`);
    state.openKap = { id, title: d.title, stocks: d.stocks };
    const safe = window.DOMPurify ? window.DOMPurify.sanitize(d.html, { FORBID_TAGS: ['style', 'script', 'form', 'input'], FORBID_ATTR: ['style'] }) : esc(d.text);
    m.body.innerHTML = `<div class="row between" style="margin-bottom:10px"><div><b>${esc(d.title || '')}</b><div class="dim">${esc(d.company || '')} · ${esc(d.publishDate || '')} · ${d.stocks.map((s) => `<span class="stk mono" data-s="${esc(s)}" style="cursor:pointer;color:var(--accent)">${esc(s)}</span>`).join(' ')}</div></div>
      <div class="row"><button class="btn" id="kdAsk">Ajan ile analiz et</button><a class="btn sec" href="${esc(d.url)}" target="_blank" rel="noopener">KAP'ta aç ↗</a></div></div>
      ${d.attachments.length ? `<div class="row" style="margin-bottom:10px">${d.attachments.map((a, i) => `<button class="pill" data-att="${i}" title="Uygulama içinde aç">📎 ${esc(a.name)}</button>`).join('')}</div>` : ''}
      <div class="kap-detail">${safe}</div>`;
    $('#kdAsk', m.body).onclick = () => { m.close(true); state.openKap = null; askAboutDisclosure({ id: d.id, company: d.company, stocks: d.stocks, subject: d.title, summary: d.summary }, d.text); };
    $$('.stk', m.body).forEach((s) => s.onclick = () => { m.close(); selectSymbol(s.dataset.s); });
    $$('[data-att]', m.body).forEach((b) => b.onclick = () => openKapAttachment(d.attachments[Number(b.dataset.att)], d));
  } catch (e) {
    m.body.innerHTML = `<div class="empty">${esc(e.message)}<br><a href="https://www.kap.org.tr/tr/Bildirim/${id}" target="_blank" rel="noopener">KAP'ta aç ↗</a></div>`;
  }
}

$('#kScope').onchange = (e) => { f.scope = e.target.value; f.symbol = null; localSet('kapScope', f.scope); load(); };
$('#kCls').onchange = (e) => { f.cls = e.target.value; load(); };
$('#kDays').onchange = (e) => {
  f.days = Number(e.target.value);
  if (f.days > 31 && f.scope === 'all') toast('Tüm piyasa için en fazla 31 gün gösterilir; uzun geçmiş için sembol, liste veya portföy kapsamını seçin');
  load();
};
$('#kQ').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); load(); }, 300));
$('#kRefresh').onclick = async () => {
  const b = $('#kRefresh'); b.disabled = true; b.classList.add('spin');
  forceNext = true;
  try { await load(); } finally { forceNext = false; b.disabled = false; b.classList.remove('spin'); }
};
$('#kRead').onclick = () => { markSeen(items.map((x) => x.id)); unread = 0; badge(); };
$('#kAsk').onclick = () => askAgent(f.scope === 'symbol'
  ? `${f.symbol || state.selected} için son ${f.days} günün KAP bildirimlerini tara (get_kap_disclosures); tez değiştirebilecek olanları get_kap_detail ile okuyup önem sırasıyla özetle.`
  : `${{ watchlist: 'İzleme listemdeki', portfolio: 'Portföyümdeki', all: 'Tüm' }[f.scope]} şirketlerin son ${f.days} günlük KAP bildirimlerinde TEZ (tez değiştirebilecek) ve YAPISAL sinyalleri tara; önemli olanların içeriğini get_kap_detail ile oku ve önem sırasıyla özetle.`);

on('kap:filter', (x) => { Object.assign(f, x); $('#kScope').value = f.scope; load(); });
on('ws:kap.updated', (m) => {
  if (m.fresh?.length) {
    unread += m.fresh.length; badge();
    const x = m.fresh[0];
    toast(`KAP ${SIG_LABEL[x.signal] ? `[${SIG_LABEL[x.signal]}] ` : ''}${x.stocks[0] || ''} — ${x.subject}${m.fresh.length > 1 ? ` (+${m.fresh.length - 1})` : ''}`, '', 8000);
  }
  if (root.classList.contains('active')) load();
});
on('rtab:shown', (t) => { if (t === 'kap') load(); });
on('symbol', () => { if (f.scope === 'symbol' && root.classList.contains('active')) load(); });
on('ready', () => { if (root.classList.contains('active')) load(); });

on('kap:open', (id) => openKapDetail(id));

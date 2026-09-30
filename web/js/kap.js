// KAP sekmesi: bildirim akışı, sinyal sınıfları (Tez/Yapı/Finans/Kurumsal/Diğer), okundu takibi, uygulama içi bildirim içeriği
import { state, on, emit, api, $, $$, h, esc, toast, askAgent, localGet, localSet, selectSymbol, debounce, modal, openPdfViewer } from './core.js';
import { t, tx, locale } from './i18n.js';

const SIG_STYLE = { TEZ: 'sig-tez', YAPISAL: 'sig-yap', FINANSAL: 'sig-fin', KURUMSAL: 'sig-kur', DIGER: 'sig-dig' };
const SIG_LABEL = { TEZ: t('Tez'), YAPISAL: t('Yapı'), FINANSAL: t('Finans'), KURUMSAL: t('Kurumsal'), DIGER: t('Diğer') };
// Rozetlerde kısa kodlar (terminal görünümü): TEZ · YAP · FİN · KUR · DİĞ
const SIG_SHORT = { TEZ: t('TEZ'), YAPISAL: t('YAP'), FINANSAL: t('FİN'), KURUMSAL: t('KUR'), DIGER: t('DİĞ') };
const sigTitle = (sig) => esc(tx(state.meta?.kapSignals?.[sig]?.title || ''));
export function signalPill(sig) {
  return sig ? `<span class="sig ${SIG_STYLE[sig] || ''}" title="${esc(SIG_LABEL[sig] || '')} · ${sigTitle(sig)}">${esc(SIG_SHORT[sig] || tx(state.meta?.kapSignals?.[sig]?.label || sig))}</span>` : '';
}

const root = $('#rtab-kap');
root.innerHTML = `
  <div class="kap-bar"><button class="symlock" id="kLock" hidden title="${t('Sembol kipini kaldır')}"><span></span><span class="tab-x">✕</span></button><div class="kap-sigs" id="kSigs"></div><span class="spacer"></span><button class="icon-btn sm" id="kRefresh" title="${t('KAP’tan yenile')}">↻</button><input id="kQ" placeholder="${t('Sembol')}" aria-label="${t('Bildirimlerde ara (sembol veya metin)')}"></div>
  <div class="kap-filters">
    <select id="kScope" aria-label="${t('Kapsam')}"><option value="watchlist">${t('İzleme listesi')}</option><option value="portfolio">${t('Portföyüm')}</option><option value="all">${t('Tüm şirketler')}</option><option value="symbol">${t('Seçili sembol')}</option></select>
    <select id="kDays" aria-label="${t('Dönem')}"><option value="1">${t('{n} gün', { n: 1 })}</option><option value="3">${t('{n} gün', { n: 3 })}</option><option value="7" selected>${t('{n} gün', { n: 7 })}</option><option value="30">${t('{n} gün', { n: 30 })}</option><option value="90" title="${t('İzleme listesi, portföy veya sembol kapsamında')}">${t('{n} gün', { n: 90 })}</option><option value="365" title="${t('İzleme listesi, portföy veya sembol kapsamında')}">${t('1 yıl')}</option></select>
    <select id="kCls" aria-label="${t('Bildirim türü')}"><option value="">${t('Tüm türler')}</option><option value="ODA">${t('Özel durum')}</option><option value="FR">${t('Finansal rapor')}</option><option value="DG">${t('Diğer')}</option><option value="DKB">${t('Düzenleyici kurum')}</option></select>
  </div>
  <div class="seg kap-view" id="kView"><button data-v="sort" data-p="date">${t('TARİH')}</button><button data-v="sort" data-p="signal">${t('SİNYALE')}</button><button data-v="group">${t('GÜNLÜK')}</button><button data-v="unread">${t('OKUNMAMIŞ')}</button></div>
  <div class="kap-info" style="flex-wrap:wrap"><span id="kInfo" style="flex:1 1 100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>
    <span class="row" style="gap:6px"><button class="ghost xs" id="kRead" title="${t('Listedeki tüm bildirimleri okundu say')}">${t('Okundu say')}</button><button class="ghost xs" id="kAsk">${t('Tez sinyallerini asistanla özetle')}</button></span></div>
  <div class="list" id="kList"></div>`;

// Varsayılan 7 gün: izleme listesinde 3 günde çoğu zaman 2-3 bildirim çıkar, "akış durdu" sanılıyor.
let f = { scope: localGet('kapScope', 'watchlist'), cls: '', days: localGet('kapDays', 7), q: '', symbol: null, signal: localGet('kapSignal', ''),
  sort: localGet('kapSort', 'date'), group: localGet('kapGroup', false), unread: localGet('kapUnread', false) };
const seen = new Set(localGet('kapSeen', []));
// Rozet: yüklenen listede okunmamış bildirim sayısı; markSeen anında düşürür.
let unread = 0, items = [], total = 0, loading = false;
$('#kScope').value = f.scope;
$('#kDays').value = String(f.days);

// ── Sembol kipi ───────────────────────────────────
// Sembol seçilince sağ panel (KAP + Raporlar) o sembole kilitlenir. Kilit kapsam seçicisiyle
// ya da rozetten çevrilir, sembol temizlenince kendiliğinden çözülür. Kilitliyken localSet yok:
// kayıtlı kapsam tercihi kullanıcının kapatınca geri döneceği serbest kapsam olarak korunur.
let lock = null;
function setLock(sym) {
  lock = sym || null;
  f.symbol = lock;
  $('#kLock').hidden = !lock;
  if (lock) { $('#kLock').firstElementChild.textContent = lock; f.q = ''; $('#kQ').value = lock; }
  else $('#kQ').value = f.q;
  emit('symlock', lock);
}
function releaseLock() {
  if (!lock) return;
  f.scope = f.scope === 'symbol' ? 'watchlist' : f.scope;
  $('#kScope').value = f.scope;
  setLock(null);
  guardDays();
  load();
}
$('#kLock').onclick = releaseLock;
on('symlock:off', releaseLock);   // Raporlar sekmesindeki rozet aynı kilidi kaldırır

let forceNext = false;
function qs(offset = 0) {
  const sym = f.scope === 'symbol' ? (f.symbol || state.selected) : '';
  return `/kap?scope=${f.scope}&symbol=${encodeURIComponent(sym)}&days=${f.days}&cls=${f.cls}&signal=${f.signal}&q=${encodeURIComponent(f.q)}&offset=${offset}&limit=100${forceNext ? '&refresh=1' : ''}`;
}

// "24.09.2026 18:19:37" / "2026.09.24 18:19:37" → "24/09 18:19" (ayrıntı ucu tarihi farklı yazıyor)
const shortDate = (s) => {
  const n = String(s || '').replace(/^(\d{4})\.(\d{2})\.(\d{2})\s+/, '$3.$2.$1 ');
  const m = /^(\d{2})\.(\d{2})\.\d{4}\s+(\d{2}:\d{2})/.exec(n);
  return m ? `${m[1]}/${m[2]} ${m[3]}` : (s || '');
};
function itemHtml(x) {
  return `<div class="kap-item ${seen.has(x.id) ? '' : 'new'}" data-id="${x.id}">
    <div class="k-sig">${signalPill(x.signal) || `<span class="sig sig-dig">${esc(SIG_SHORT.DIGER)}</span>`}</div>
    <div class="k-main">
    <div class="top">${x.stocks.slice(0, 3).map((s) => `<span class="stk" data-s="${esc(s)}">${esc(s)}</span>`).join(' ')}<span class="k-cls">${esc(tx(x.clsLabel))}</span>${x.late ? `<span class="pill down">${t('Geç bildirim')}</span>` : ''}${x.attachments ? `<span class="k-att" title="${t('Ek dosya')}">📎${x.attachments}</span>` : ''}<span class="k-date" title="${esc(x.publishDate)}">${esc(shortDate(x.publishDate))}</span></div>
    <div class="subj">${esc(x.subject || '')}</div>
    ${x.summary ? `<div class="co">${esc(x.summary)}</div>` : ''}
    <div class="co dim">${esc(x.company)}</div>
    <div class="acts"><button data-open="${x.id}">${t('İçeriği göster')}</button><a href="${esc(x.url)}" target="_blank" rel="noopener">${t('KAP’ta aç ↗')}</a><button data-ask="${x.id}">${t('Asistanla analiz et')}</button></div></div></div>`;
}

// Sunucu daima en yeniyi öne alır; "SİNYALE" seçilince önem sırası devreye girer (istemci tarafı).
const SIG_RANK = { TEZ: 0, YAPISAL: 1, FINANSAL: 2, KURUMSAL: 3 };
const dayKey = (x) => (x.date || '').slice(0, 10);
// KAP tarihleri +03:00; başlığı UTC öğünde kurup UTC'de biçimlendirerek saat dilimi kaymasını önle
const dayLabel = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(locale, { timeZone: 'UTC' }); };

function viewItems() {
  const list = f.unread ? items.filter((x) => !seen.has(x.id)) : [...items];
  if (f.sort === 'signal') list.sort((a, b) => (SIG_RANK[a.signal] ?? 9) - (SIG_RANK[b.signal] ?? 9) || (b.date || '').localeCompare(a.date || ''));
  return list;
}
// Gün başlıkları yalnız tarih sırasında anlamlı: sinyal sırasında gün bloğu tezlerin arasını bölerdi.
function listHtml(list) {
  if (!f.group) return list.map(itemHtml).join('');
  const perDay = new Map();
  for (const x of list) { const k = dayKey(x); perDay.set(k, (perDay.get(k) || 0) + 1); }
  let day = null;
  return list.map((x) => {
    const k = dayKey(x);
    if (k === day) return itemHtml(x);
    day = k;
    return (k ? `<div class="kap-day">${esc(dayLabel(k))} <span class="dim">· ${t('{n} bildirim', { n: perDay.get(k) })}</span></div>` : '') + itemHtml(x);
  }).join('');
}
function emptyHtml() {
  if (f.unread) return t('Okunmamış bildirim yok');
  if (f.signal) return t('{label} sınıfında bildirim yok', { label: esc(SIG_LABEL[f.signal] || f.signal) });
  return f.scope === 'watchlist' ? t('İzleme listenizdeki hisseler için bildirim yok') : t('Bildirim yok');
}
function drawList() {
  const list = viewItems();
  $('#kList').innerHTML = listHtml(list) || `<div class="empty">${emptyHtml()}</div>`;
  if (items.length < total) $('#kList').append(h(`<button class="ghost" id="kMore" style="margin:10px auto;display:block">${t('Daha fazla yükle ({n})', { n: total - items.length })}</button>`));
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
    $('#kInfo').textContent = [new Date().toLocaleTimeString(locale, { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }), t('{n} sinyal', { n: total }), sym, r.stale ? t('önbellekten') : '', r.error ? tx(r.error) : ''].filter(Boolean).join(' | ');
    const counts = r.counts || {};
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    $('#kSigs').innerHTML = `<button class="${!f.signal ? 'on' : ''}" data-sig="" title="${sum}">${t('Tümü')}</button>` + ['TEZ', 'YAPISAL', 'FINANSAL', 'KURUMSAL', 'DIGER'].map((k) => `<button class="${f.signal === k ? 'on' : ''}" data-sig="${k}" title="${esc(SIG_LABEL[k])} · ${counts[k] || 0} · ${sigTitle(k)}">${esc(SIG_SHORT[k])}</button>`).join('');
    drawList();
    unread = items.filter((x) => !seen.has(x.id)).length;
    badge();
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
// Görünüm kipleri: sıralama (tarih ↔ sinyal), gün gruplaması, okunmamış süzgeci
$('#kView').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  const v = b.dataset.v;
  if (v === 'sort') f.sort = b.dataset.p; else f[v] = !f[v];
  localSet(`kap${v[0].toUpperCase()}${v.slice(1)}`, v === 'sort' ? f.sort : f[v]);
  syncView();
  drawList();
});
// Gün gruplaması yalnız tarih sırasında anlamlı; sinyal sırasındayken düğmeyi kilitle
function syncView() {
  $$('#kView button[data-v]').forEach((b) => {
    const on2 = b.dataset.v === 'sort' ? b.dataset.p === f.sort : f[b.dataset.v];
    b.classList.toggle('active', !!on2);
    if (b.dataset.v === 'group') b.disabled = f.sort !== 'date';
  });
}
syncView();

function markSeen(ids) {
  let n = 0;
  for (const id of ids) if (!seen.has(id)) { seen.add(id); n++; }
  localSet('kapSeen', [...seen].slice(-5000));
  for (const id of ids) $(`.kap-item[data-id="${id}"]`, root)?.classList.remove('new');
  if (!n) return;
  unread = Math.max(0, unread - n);
  badge();
  if (f.unread) drawList();   // süzgeç açıkken okunan satır listeden düşer
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
    m.body.innerHTML = `<div class="row between" style="margin-bottom:10px"><div><b>${esc(d.title || '')}</b><div class="dim">${esc(d.company || '')} · <span title="${esc(d.publishDate || '')}">${esc(shortDate(d.publishDate))}</span> · ${d.stocks.map((s) => `<span class="stk mono" data-s="${esc(s)}" style="cursor:pointer;color:var(--accent)">${esc(s)}</span>`).join(' ')}</div></div>
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

// "Tüm şirketler" kapsamı sunucuda 31 güne kırpılır; kapsam ya da dönem değiştiğinde her yolda uyar
const guardDays = () => { if (f.days > 31 && f.scope === 'all') toast(t('Tüm şirketler için en fazla 31 gün gösterilir; daha uzun geçmiş için sembol, izleme listesi veya portföy kapsamını seçin.')); };
$('#kScope').onchange = (e) => { f.scope = e.target.value; f.symbol = null; localSet('kapScope', f.scope); if (f.scope !== 'symbol') setLock(null); guardDays(); load(); };
$('#kCls').onchange = (e) => { f.cls = e.target.value; load(); };
$('#kDays').onchange = (e) => {
  f.days = Number(e.target.value);
  localSet('kapDays', f.days);
  guardDays();
  load();
};
$('#kQ').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); load(); }, 300));
$('#kRefresh').onclick = async () => {
  const b = $('#kRefresh'); b.disabled = true; b.classList.add('spin');
  forceNext = true;
  try { await load(); } finally { forceNext = false; b.disabled = false; b.classList.remove('spin'); }
};
$('#kRead').onclick = () => markSeen(items.map((x) => x.id));
const ASK_SCOPE = {
  watchlist: (days) => t('İzleme listemdeki şirketlerin son {days} günlük KAP bildirimlerinde TEZ (tez değiştirebilecek) ve YAPISAL sinyalleri tara; önemli olanların içeriğini get_kap_detail ile oku ve önem sırasıyla özetle.', { days }),
  portfolio: (days) => t('Portföyümdeki şirketlerin son {days} günlük KAP bildirimlerinde TEZ (tez değiştirebilecek) ve YAPISAL sinyalleri tara; önemli olanların içeriğini get_kap_detail ile oku ve önem sırasıyla özetle.', { days }),
  all: (days) => t('Tüm şirketlerin son {days} günlük KAP bildirimlerinde TEZ (tez değiştirebilecek) ve YAPISAL sinyalleri tara; önemli olanların içeriğini get_kap_detail ile oku ve önem sırasıyla özetle.', { days }),
};
$('#kAsk').onclick = () => askAgent(f.scope === 'symbol'
  ? t('{symbol} için son {days} günün KAP bildirimlerini tara (get_kap_disclosures); tez değiştirebilecek olanları get_kap_detail ile okuyup önem sırasıyla özetle.', { symbol: f.symbol || state.selected, days: f.days })
  : (ASK_SCOPE[f.scope] || ASK_SCOPE.all)(f.days));

on('kap:filter', (x) => { Object.assign(f, x); $('#kScope').value = f.scope; if (f.scope !== 'symbol') setLock(null); syncView(); load(); });
on('ws:kap.updated', (m) => {
  if (m.fresh?.length) {
    unread += m.fresh.length; badge();
    const x = m.fresh[0];
    toast(`KAP ${SIG_LABEL[x.signal] ? `[${SIG_LABEL[x.signal]}] ` : ''}${x.stocks[0] || ''} — ${x.subject}${m.fresh.length > 1 ? ` (+${m.fresh.length - 1})` : ''}`, '', 8000);
  }
  if (root.classList.contains('active')) load();
});
on('rtab:shown', (tab) => { if (tab === 'kap') load(); });
// Sembol seçimi paneli o sembole kilitler; sekme pasif olsa bile yüklenir, kullanıcı geçince hazır bekler.
on('symbol', (sym) => {
  if (!sym) { releaseLock(); return; }
  setLock(sym);
  f.scope = 'symbol';
  $('#kScope').value = 'symbol';
  load();
});
on('ready', () => { if (root.classList.contains('active')) load(); });

on('kap:open', (id) => openKapDetail(id));

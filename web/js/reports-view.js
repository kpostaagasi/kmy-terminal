// Sağ panel Raporlar + PDF sekmeleri: kurum raporu akışı, arşiv (ajan + kurum raporları), önizleme
import { state, on, emit, api, $, $$, esc, md, dateTR, toast, confirmBox, askAgent, localGet, localSet, modal, debounce, price, pct } from './core.js';
import { t, tx } from './i18n.js';

const root = $('#rtab-reports');
const pdf = $('#rtab-pdf');
const EMPTY_PDF = `<div class="empty" style="margin:auto">${t('Raporlar sekmesinden bir rapor seçin.')}</div>`;
const ALL_BROKERS = `<option value="">${t('Tüm kurumlar')}</option>`;
root.innerHTML = `<div class="reports">
  <div class="report-list">
    <div class="panel-head"><span>${t('Raporlar')}</span><div class="head-actions"><button class="symlock" id="rLock" hidden title="${t('Sembol kipini kaldır')}"><span></span><span class="tab-x">✕</span></button><button class="icon-btn sm" id="rUpload" title="${t('Kurum raporu veya PDF yükle')}">⇪</button><button class="icon-btn sm" id="rRefresh" title="${t('Yenile')}">↻</button></div></div>
    <div class="seg" id="rKind" style="margin:8px 8px 0;display:flex;flex-wrap:wrap"><button data-k="akis" style="flex:1 1 30%" title="${t('Aracı kurumların yeni yayımladığı şirket raporları')}">${t('Akış')}</button><button data-k="konsensus" style="flex:1 1 30%" title="${t('Kurumların hedef fiyat ve tavsiye konsensüsü')}">${t('Konsensüs')}</button><button data-k="all" style="flex:1 1 30%">${t('Arşiv')}</button><button data-k="ajan" style="flex:1 1 30%">${t('Asistan')}</button><button data-k="kurum" style="flex:1 1 30%">${t('Kurum')}</button></div>
    <div id="feedBox" hidden>
      <div style="padding:8px;display:flex;flex-direction:column;gap:6px">
        <div class="seg" id="fDays" style="display:flex"><button data-d="7" style="flex:1">${t('{n} gün', { n: 7 })}</button><button data-d="30" style="flex:1">${t('{n} gün', { n: 30 })}</button><button data-d="90" style="flex:1">${t('{n} gün', { n: 90 })}</button><button data-d="0" style="flex:1">${t('Tümü')}</button></div>
        <div class="row" style="gap:6px;flex-wrap:nowrap"><input id="fSym" placeholder="${t('Sembol')}" style="width:84px" aria-label="${t('Sembol')}"><select id="fBroker" style="flex:1;min-width:0" aria-label="${t('Kurum')}">${ALL_BROKERS}</select></div>
        <div class="row" style="gap:6px;flex-wrap:nowrap"><input id="fQ" placeholder="${t('Başlık veya özette ara…')}" style="flex:1;min-width:0" aria-label="${t('Akışta ara')}"><select id="fCat" style="width:110px" aria-label="${t('Kategori')}"></select></div>
        <div class="row" style="gap:6px"><button class="ghost xs fMine" data-m="watchlist" style="flex:1">${t('İzleme listem')}</button><button class="ghost xs fMine" data-m="portfolio" style="flex:1">${t('Portföyüm')}</button></div>
      </div>
      <div id="feedList"></div>
      <div class="dim" id="feedNote" style="font-size:11px;padding:8px"></div>
    </div>
    <div id="consBox" hidden>
      <div style="padding:8px;display:flex;flex-direction:column;gap:6px">
        <div class="row" style="gap:6px;flex-wrap:nowrap"><input id="cSym" placeholder="${t('Sembol (boşsa fırsat listesi)')}" style="flex:1;min-width:0" aria-label="${t('Sembol')}"><button class="ghost xs" id="cGo">${t('Getir')}</button></div>
      </div>
      <div id="consList"></div>
    </div>
    <div id="archBox">
    <div style="padding:8px;display:flex;flex-direction:column;gap:6px">
      <select id="rBroker" aria-label="${t('Kurum')}">${ALL_BROKERS}</select>
      <input id="rFilter" placeholder="${t('Başlık veya sembol ara (ör. THYAO)…')}" aria-label="${t('Rapor ara')}">
    </div>
    <input type="file" id="rFile" hidden multiple accept=".pdf,.html,.md,.csv,.png,.jpg,.xlsx,.txt">
    <div id="rList"></div>
    <div style="padding:8px"><button class="ghost" id="rBrokerAsk" style="width:100%">${t('Kurum görüşlerini asistanla topla')}</button></div>
    </div>
  </div>
</div>`;
pdf.innerHTML = `<div class="report-view" id="rView">${EMPTY_PDF}</div>`;
// PDF sekmesi yalnız bir rapor açıkken görünür; Kapat (veya sekmedeki ✕) sekmeyi kaldırır
const pdfTab = $('[data-rtab=pdf]');
function openPdfTab() { pdfTab.hidden = false; emit('rtab', 'pdf'); }
function closePdf() {
  $('#rView').innerHTML = EMPTY_PDF; pdfTab.hidden = true;
  state.openReport = null; feedSel = null; emit('report:opened', null);
  $$('.report-item.sel', root).forEach((el) => el.classList.remove('sel'));
  emit('rtab', 'reports');
}
pdf.addEventListener('click', (e) => { if (e.target.closest('[data-close-pdf]')) closePdf(); });
$('#pdfClose').addEventListener('click', (e) => { e.stopPropagation(); closePdf(); });

let reports = [];
let selected = localGet('report', null);
let kind = localGet('reportKind', 'akis');

async function load() {
  reports = await api('/reports').catch(() => []);
  const brokers = [...new Set(reports.map((r) => r.broker).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const cur = $('#rBroker').value;
  $('#rBroker').innerHTML = ALL_BROKERS + brokers.map((b) => `<option ${b === cur ? 'selected' : ''}>${esc(b)}</option>`).join('');
  draw();
}

function draw() {
  $$('#rKind button').forEach((b) => b.classList.toggle('active', b.dataset.k === kind));
  $('#feedBox').hidden = kind !== 'akis';
  $('#consBox').hidden = kind !== 'konsensus';
  $('#archBox').hidden = kind === 'akis' || kind === 'konsensus';
  if (kind === 'akis') { loadFeed(); return; }
  if (kind === 'konsensus') { loadConsensus(); return; }
  const q = $('#rFilter').value.toLocaleLowerCase('tr').trim();
  const broker = $('#rBroker').value;
  const list = reports.filter((r) => (kind === 'all' || r.kind === kind) && (!broker || r.broker === broker)
    && (!q || `${r.title} ${r.name} ${(r.symbols || []).join(' ')} ${r.broker || ''}`.toLocaleLowerCase('tr').includes(q)));
  $('#rList').innerHTML = list.map((r) => `<div class="report-item ${r.name === selected ? 'sel' : ''}" data-n="${esc(r.name)}"><div class="t">${esc(tx(r.title))}</div>
    <div class="m">${r.broker ? `<b>${esc(r.broker)}</b> · ` : ''}${(r.symbols || []).length ? `<span class="mono">${esc(r.symbols.join(', '))}</span> · ` : ''}${esc(r.ext.toUpperCase())} · ${dateTR(r.mtime, true)} · ${Math.max(1, Math.round(r.size / 1024))} KB</div></div>`).join('')
    || `<div class="empty">${kind === 'kurum' ? t('Kurum raporu yok. ⇪ ile PDF yükleyebilirsiniz.') : t('Rapor yok')}</div>`;
  $$('.report-item', root).forEach((el) => el.onclick = () => show(el.dataset.n));
}

function reportUrl(name) {
  return `${location.protocol}//${location.hostname}:${state.meta?.reportPort || 7421}/reports/${name.split('/').map(encodeURIComponent).join('/')}`;
}

async function show(name, { focus = true } = {}) {
  selected = name; localSet('report', name);
  state.openReport = name; emit('report:opened', name);
  $$('.report-item', root).forEach((el) => el.classList.toggle('sel', el.dataset.n === name));
  const r = reports.find((x) => x.name === name);
  if (!r) return;
  const url = reportUrl(name);
  const bar = `<div class="panel-head" style="gap:8px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tx(r.title))}${r.broker ? ` <span class="dim">· ${esc(r.broker)}</span>` : ''}</span><div class="head-actions">
    <button class="ghost" id="rAsk">${t('Analiz et')}</button><a class="ghost" href="${url}" download>${t('İndir')}</a><a class="ghost" href="${url}" target="_blank" rel="noopener">${t('Yeni sekmede aç')}</a><button class="ghost" id="rPresent" title="${t('Tam ekran sunum')}">${t('Sunum')}</button>
    ${['html', 'htm'].includes(r.ext) ? `<button class="ghost" id="rPrint">${t('Yazdır')}</button>` : ''}<button class="ghost" id="rTag">${t('Etiketle')}</button><button class="ghost" id="rDel">${t('Sil')}</button><button class="ghost" data-close-pdf>${t('Kapat')}</button></div></div>`;
  const v = $('#rView');
  if (['html', 'htm', 'pdf', 'png', 'jpg', 'txt', 'csv'].includes(r.ext)) {
    // Raporlar ayrı porttan (ayrı köken) gelir; içlerindeki betikler uygulama API'sine erişemez
    v.innerHTML = `${bar}<iframe src="${url}" title="${esc(r.title)}" ${['html', 'htm'].includes(r.ext) ? 'sandbox="allow-scripts allow-same-origin allow-popups allow-modals"' : ''}></iframe>`;
  } else if (r.ext === 'md') {
    const text = await fetch(url, { headers: state.meta?.reportToken ? { 'X-Report-Token': state.meta.reportToken } : {} }).then((x) => x.text()).catch(() => t('Rapor okunamadı'));
    v.innerHTML = `${bar}<div class="md msg assistant">${md(text)}</div>`;
  } else {
    v.innerHTML = `${bar}<div class="empty">${t('Önizleme yok; dosyayı indirip açabilirsiniz.')}</div>`;
  }
  if (focus) openPdfTab();
  $('#rDel').onclick = async () => {
    if (!(await confirmBox(t('"{title}" silinsin mi?', { title: r.title }), { danger: true, ok: t('Sil') }))) return;
    await api(`/reports/${encodeURIComponent(name)}`, { method: 'DELETE' });
    selected = null; toast(t('Rapor silindi'), 'ok'); closePdf(); load();
  };
  $('#rAsk').onclick = () => askAgent(r.broker
    ? t('workspace/reports/{name} dosyasındaki {broker} kurum raporunu oku. Ana bulguları özetle, güçlü ve zayıf yönlerini kendi bağımsız görüşünle değerlendir ve güncel verilerle hâlâ geçerli olup olmadığını kontrol et.', { name, broker: r.broker })
    : t('workspace/reports/{name} dosyasındaki raporu oku. Ana bulguları özetle, güçlü ve zayıf yönlerini kendi bağımsız görüşünle değerlendir ve güncel verilerle hâlâ geçerli olup olmadığını kontrol et.', { name }));
  $('#rPresent').onclick = () => { const el = $('iframe', v) || $('.md', v); el?.requestFullscreen?.().catch(() => toast(t('Tam ekran açılamadı'), 'err')); };
  $('#rTag').onclick = () => tagModal(r);
  const p = $('#rPrint');
  if (p) p.onclick = () => window.open(`${url}?print=1`, '_blank');
}

function tagModal(r) {
  const brokers = [...new Set(reports.map((x) => x.broker).filter(Boolean))];
  const m = modal({
    title: t('Raporu etiketle'),
    body: `<form class="form-grid" id="tagF"><div class="field" style="grid-column:1/-1"><label>${t('Başlık')}</label><input name="title" value="${esc(r.title)}"></div>
      <div class="field"><label>${t('Kurum')}</label><input name="broker" list="brList" value="${esc(r.broker || '')}" placeholder="${t('ör. İş Yatırım')}"><datalist id="brList">${brokers.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div>
      <div class="field"><label>${t('Semboller')}</label><input name="symbols" value="${esc((r.symbols || []).join(', '))}" placeholder="THYAO, PGSUS"></div></form>`,
    footer: `<button class="btn sec" data-close>${t('İptal')}</button><button class="btn" id="tagSave">${t('Kaydet')}</button>`,
  });
  $('#tagSave', m.el).onclick = async () => {
    const f = Object.fromEntries(new FormData($('#tagF', m.el)));
    try { await api('/reports/meta', { method: 'PATCH', body: { name: r.name, ...f } }); m.close(); toast(t('Etiketler kaydedildi'), 'ok'); } catch (e) { toast(tx(e.message), 'err'); }
  };
}

function uploadModal(files) {
  const brokers = [...new Set(reports.map((x) => x.broker).filter(Boolean))];
  const m = modal({
    title: t('{n} dosya yükle', { n: files.length }),
    body: `<p class="muted">${files.map((f) => esc(f.name)).join('<br>')}</p><form class="form-grid" id="upF">
      <div class="field"><label>${t('Kurum (isteğe bağlı)')}</label><input name="broker" list="brList2" placeholder="${t('ör. İş Yatırım')}"><datalist id="brList2">${brokers.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div>
      <div class="field"><label>${t('Semboller (isteğe bağlı)')}</label><input name="symbols" placeholder="THYAO, PGSUS"></div></form>`,
    footer: `<button class="btn sec" data-close>${t('İptal')}</button><button class="btn" id="upGo">${t('Yükle')}</button>`,
  });
  $('#upGo', m.el).onclick = async () => {
    const f = Object.fromEntries(new FormData($('#upF', m.el)));
    m.close();
    for (const file of files) {
      try {
        const res = await fetch(`/api/reports/upload?name=${encodeURIComponent(file.name)}&broker=${encodeURIComponent(f.broker || '')}&symbols=${encodeURIComponent(f.symbols || '')}`, { method: 'POST', body: file });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        toast(t('{name} yüklendi', { name: file.name }), 'ok');
      } catch (x) { toast(`${file.name}: ${tx(x.message)}`, 'err'); }
    }
    if (f.broker) { kind = 'kurum'; localSet('reportKind', kind); }
  };
}

$('#rKind').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; localSet('reportKind', kind); draw(); };

// ── Kurum raporu akışı ─────────────────────────────
let feed = { items: [] }, feedDays = localGet('feedDays', 30), feedTok = 0, feedSel = null, feedMine = localGet('feedMine', '');
// Renksiz kalan kurum gri noktaya düşmesin: gedik listede en çok raporu olanlardan
const BROKER_DOT = { garanti: '#2dd4bf', ak: '#ef4444', isyatirim: '#3b82f6', yapikredi: '#60a5fa', ziraat: '#22c55e', vakif: '#f59e0b', tacirler: '#a78bfa', phillip: '#f472b6', integral: '#94a3b8', a1: '#facc15', gedik: '#eab308', halk: '#38bdf8' };
const FEED_PAGE = 200;
let feedLoading = false;
let pendingBroker = '';   // konsensüs satırı → akış süzgeci; seçenekler yüklenene kadar bekler
const feedItemHtml = (x) => `<div class="report-item feed-item ${x.id === feedSel ? 'sel' : ''}" data-id="${esc(x.id)}">
      <div class="t"><span class="dot" style="background:${BROKER_DOT[x.brokerKey] || 'var(--text-3)'}"></span>${x.symbols.length ? `<b class="mono accent">${esc(x.symbols.slice(0, 3).join(', '))}</b> ` : ''}<span class="dim">${esc(x.broker)}</span>${x.isNew ? ` <span class="pill acc">${t('Yeni')}</span>` : ''}${x.saved ? ` <span class="pill" title="${t('Arşivde')}">✓</span>` : ''}</div>
      <div class="t2">${esc(x.title)}</div>
      <div class="m"><span>${dateTR(x.date)} · ${esc(tx(x.category))}${x.size ? ` · ${esc(x.size)}` : ''}${x.access === 'web' ? ` · ${esc(tx(x.access))}` : ''}</span>
        <span class="f-acts"><button class="ghost xs" data-fa="${esc(x.id)}">${t('Analiz et')}</button>${(x.url || x.page) ? `<a class="ghost xs" href="${esc(x.url || x.page)}" target="_blank" rel="noopener">${t('Kaynakta aç')}</a>` : ''}</span></div></div>`;
function bindFeed() {
  $$('.feed-item', root).forEach((el) => el.onclick = (e) => { if (e.target.closest('.f-acts')) return; showFeed(el.dataset.id); });
  $$('[data-fa]', root).forEach((b) => b.onclick = () => askFeed(feed.items.find((i) => i.id === b.dataset.fa)));
}
async function loadFeed(append = false) {
  append = append === true;         // debounce/onchange olay nesnesini append diye yorumlamasın
  if (append && feedLoading) return; // aynı anda iki "daha fazla" isteği olmasın
  feedLoading = true;
  const tok = ++feedTok;
  $$('#fDays button').forEach((b) => b.classList.toggle('active', Number(b.dataset.d) === feedDays));
  $$('.fMine').forEach((b) => b.classList.toggle('on', feedMine === b.dataset.m));
  if (!feed.items.length) $('#feedList').innerHTML = '<div class="skeleton" style="height:160px;margin:8px"></div>';
  const q = new URLSearchParams({ days: feedDays, limit: FEED_PAGE, offset: append ? feed.items.length : 0, ...(($('#fSym').value.trim()) ? { symbol: $('#fSym').value.trim().toUpperCase() } : {}), ...($('#fBroker').value ? { broker: $('#fBroker').value } : {}), ...(feedMine ? { mine: feedMine } : {}), scope: 'company' });
  try {
    const r = await api(`/research?${q}`);
    if (tok !== feedTok) return;
    feed = append ? { ...r, items: [...feed.items, ...r.items] } : r;
    const cur = pendingBroker || $('#fBroker').value;
    pendingBroker = '';
    $('#fBroker').innerHTML = ALL_BROKERS + Object.entries(r.brokers).map(([k, b]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(r.status?.[k] && !r.status[k].ok ? t('{name} (hata)', { name: b.name }) : b.name)}</option>`).join('');
    drawFeed();
    const fails = Object.entries(r.status || {}).filter(([, s]) => !s.ok).map(([k]) => r.brokers[k]?.name);
    const locked = r.unavailable.map((u) => `<span title="${esc(tx(u.reason))}">${esc(tx(u.name))}</span>`).join(', ');
    $('#feedNote').innerHTML = `${t('{n} şirket raporu', { n: r.total })} · ${t('Son güncelleme {date} · 30 dakikada bir yenilenir', { date: dateTR(r.at, true) })}${fails.length ? ` · <span class="down">${t('Alınamadı: {list}', { list: esc(fails.join(', ')) })}</span>` : ''}<br>${t('Giriş gerektiren kaynaklar ({list}): raporları kendi hesabınızla indirin; Ayarlar › Veri › Kurum raporları için klasör izleme onları arşive alır.', { list: locked })}`;
  } catch (e) { if (tok === feedTok) $('#feedList').innerHTML = `<div class="empty">${esc(tx(e.message))}</div>`; }
  finally { if (tok === feedTok) feedLoading = false; }
}

// Serbest metin araması ve kategori süzgeci yüklenen sayfalar üzerinde, istemcide.
// Yeni sunucu ucu gerekmez: akış zaten 200'er sayfa geliyor.
function drawFeed() {
  const q = $('#fQ').value.toLocaleLowerCase('tr').trim();
  const cat = $('#fCat').value;
  const cats = [...new Set(feed.items.map((x) => x.category))].sort((a, b) => a.localeCompare(b, 'tr'));
  const curCat = $('#fCat').value;
  $('#fCat').innerHTML = `<option value="">${t('Tümü')}</option>` + cats.map((c) => `<option ${c === curCat ? 'selected' : ''}>${esc(tx(c))}</option>`).join('');
  const items = feed.items.filter((x) => (!cat || x.category === cat)
    && (!q || `${x.title} ${x.summary || ''} ${x.broker} ${x.symbols.join(' ')}`.toLocaleLowerCase('tr').includes(q)));
  $('#feedList').innerHTML = items.map(feedItemHtml).join('')
    || `<div class="empty">${t('Bu filtreye uyan rapor yok')}</div>`;
  $('#fMore')?.remove();
  if (feed.items.length < (feed.total || 0)) $('#feedList').insertAdjacentHTML('beforeend', `<button class="ghost" id="fMore" style="margin:10px auto;display:block">${t('Daha fazla yükle ({n})', { n: (feed.total || 0) - feed.items.length })}</button>`);
  bindFeed();
}

// ── Konsensüs ─────────────────────────────
// Kurumların hedef fiyat/tavsiye tablosu. Sembol girilmezse sunucu en çok
// konuşulan 20 sembolün fırsat listesini döner.
let consSort = 'date', consDir = -1, consData = null;
const RATE_PILL = { AL: 'up', ALDIR: 'up', TUT: '', SAT: 'down' };
// Kurum görüşü etiketi: AL/SAT yerine hedefe göre artır/azalt dili.
const RATE_LABEL = { AL: 'Artır', ALDIR: 'Artır', TUT: 'Tut', SAT: 'Azalt' };
const rateLabel = (r) => t(RATE_LABEL[r] || r);
const ageDays = (d) => Math.max(0, Math.round((Date.now() - new Date(`${d}T12:00:00`).getTime()) / 86400_000));
const freshTag = (d) => { const n = ageDays(d); return `<span class="pill ${n <= 30 ? 'acc' : n <= 90 ? '' : 'down'}" title="${t('Güncellik: {n} gün önce', { n })}">${n}g</span>`; };
const th = (k, label, cls = '') => `<th class="sortable ${cls}" data-cs="${k}">${esc(label)}${consSort === k ? (consDir < 0 ? ' ▾' : ' ▴') : ''}</th>`;

function drawConsensus() {
  const d = consData;
  if (!d) return;
  const el = $('#consList');
  if (!d.targets?.length) {
    el.innerHTML = d.list?.length ? consListHtml(d.list) : `<div class="empty">${t('Henüz hedef fiyat çıkarılmış rapor yok. Kurum raporlarını tara, sonra buraya dön.')}</div>`;
    bindCons();
    return;
  }
  const s = d.summary || {};
  const rows = [...d.targets].sort((a, b) => {
    const k = consSort;
    const va = k === 'upside' ? a.upside : k === 'target' ? a.target : k === 'date' ? a.report_date : a.broker;
    const vb = k === 'upside' ? b.upside : k === 'target' ? b.target : k === 'date' ? b.report_date : b.broker;
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb, 'tr') : va - vb) * consDir;
  });
  el.innerHTML = `<div class="cons-sum">
      <div><span class="l">${t('Medyan hedef')}</span><span class="v">${s.median != null ? `${price(s.median)} ₺` : '—'}</span></div>
      <div><span class="l">${t('Mevcut fiyat')}</span><span class="v">${d.price != null ? `${price(d.price)} ₺` : '—'}</span></div>
      <div><span class="l">${t('Artır / Tut / Azalt')}</span><span class="v">${s.al || 0} / ${(s.brokers || 0) - (s.al || 0) - (s.sat || 0)} / ${s.sat || 0}</span></div>
      <div><span class="l">${t('Kurum')}</span><span class="v">${s.brokers || 0}</span></div>
      <div><span class="l">${t('Tarih aralığı')}</span><span class="v" style="font-size:11px;white-space:normal">${esc(dateTR(s.oldest))} – ${esc(dateTR(s.newest))}</span></div>
    </div>
    <div class="table-wrap"><table class="t cons-t"><thead><tr>${th('broker', t('Kurum'))}${th('date', t('Tarih'))}${th('target', t('Hedef'), 'r')}${th('rating', t('Tavsiye'))}${th('upside', t('Potansiyel'), 'r')}<th>${t('Güncellik')}</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="click" data-b="${esc(r.brokerKey || '')}" data-s="${esc(d.symbol)}"><td>${esc(r.broker)}</td><td class="mono">${esc(dateTR(r.report_date))}</td><td class="r">${r.target != null ? price(r.target) : '—'}</td><td>${r.rating ? `<span class="pill ${RATE_PILL[r.rating] || ''}">${esc(rateLabel(r.rating))}</span>` : '—'}</td><td class="r ${r.upside > 0 ? 'up' : r.upside < 0 ? 'down' : ''}">${r.upside != null ? pct(r.upside) : '—'}</td><td>${freshTag(r.report_date)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="dim" style="font-size:11px;padding:8px">${t('Kurum satırına tıkla: o kurumun raporlarına filtrelenmiş akış açılır.')}</div>`;
  bindCons();
}

function consListHtml(list) {
  return `<div class="dim" style="font-size:11px;padding:8px 8px 0">${t('En çok konuşulan semboller (fırsat listesi). Sembol yazınca kurum tablosu açılır.')}</div>
    <div class="table-wrap"><table class="t cons-t"><thead><tr><th>${t('Sembol')}</th>${th('brokers', t('Kurum'), 'r')}${th('median', t('Medyan hedef'), 'r')}${th('upside', t('Potansiyel'), 'r')}</tr></thead><tbody>
    ${list.map((x) => `<tr class="click" data-s="${esc(x.symbol)}"><td class="mono"><b>${esc(x.symbol)}</b></td><td class="r">${x.brokers}</td><td class="r">${price(x.median)}</td><td class="r ${x.upside > 0 ? 'up' : x.upside < 0 ? 'down' : ''}">${pct(x.upside)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function bindCons() {
  $$('#consList th.sortable').forEach((h) => h.onclick = () => { const k = h.dataset.cs; consDir = consSort === k ? -consDir : -1; consSort = k; drawConsensus(); });
  $$('#consList tr.click').forEach((tr) => tr.onclick = () => {
    // #fBroker seçenekleri akış yüklenince dolar; filtreyi o ana kadar sakla
    pendingBroker = tr.dataset.b || '';
    $('#fSym').value = tr.dataset.s;
    if (pendingBroker) $('#fBroker').value = pendingBroker;
    kind = 'akis'; localSet('reportKind', kind); draw();
  });
}

let consTok = 0;
async function loadConsensus() {
  const sym = $('#cSym').value.trim().toUpperCase();
  // Fırsat listesindeki sıralama anahtarı kurum tablosunda geçersiz; mod değişince sıfırla
  if (consSort === 'brokers' || consSort === 'median') { consSort = 'date'; consDir = -1; }
  const tok = ++consTok;
  $('#consList').innerHTML = '<div class="skeleton" style="height:140px;margin:8px"></div>';
  try {
    const d = await api(`/research/consensus${sym ? `?symbol=${encodeURIComponent(sym)}` : ''}`);
    if (tok !== consTok) return;
    consData = d;
    if (d.symbol && state.quotes[d.symbol]?.price == null && d.price != null) state.quotes[d.symbol] = { symbol: d.symbol, price: d.price };
    drawConsensus();
  } catch (e) { if (tok === consTok) $('#consList').innerHTML = `<div class="empty">${esc(tx(e.message))}</div>`; }
}
$('#cGo').onclick = loadConsensus;
$('#cSym').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadConsensus(); });
function showFeed(id) {
  const x = feed.items.find((i) => i.id === id);
  if (!x) return;
  feedSel = id;
  $$('.feed-item', root).forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  // Kurum raporları yalnız başlık + kaynağa bağlantı olarak gösterilir; içerik/özet kopyalanmaz.
  const link = x.url || x.page || null;
  $('#rView').innerHTML = `<div class="panel-head" style="gap:8px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.title)} <span class="dim">· ${esc(x.broker)} · ${dateTR(x.date)}</span></span><div class="head-actions">
      <button class="ghost" id="fAsk">${t('Analiz et')}</button>${link ? `<a class="ghost" href="${esc(link)}" target="_blank" rel="noopener">${t('Kaynakta aç')}</a>` : ''}<button class="ghost" data-close-pdf>${t('Kapat')}</button></div></div>
    <div class="empty" style="margin:auto">${x.symbols.length ? `<b class="mono">${esc(x.symbols.join(', '))}</b><br>` : ''}${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(x.title)}</a><br>` : ''}${t('Rapor içeriği kurumun kendi sayfasında yayımlanır. Okumak için "Kaynakta aç"ı kullanın.')}</div>`;
  openPdfTab();
  $('#fAsk').onclick = () => askFeed(x);
}
function askFeed(x) {
  if (!x) return;
  const web = x.access === 'web';
  askAgent(web
    ? t('{broker} yazısını oku (WebFetch: {url}) ve analiz et: temel tez, varsa tavsiye ve hedef fiyat, değerleme yaklaşımı, riskler; güncel fiyat ve temel verilerle karşılaştır ve kendi bağımsız görüşünle değerlendir.', { broker: x.broker, url: x.page })
    : t('read_broker_report ile "{id}" kimlikli {broker} raporunu ({title}, {date}) indir ve pdf-okuma becerisiyle oku. Özet değil analiz istiyorum: temel tez, tavsiye ve hedef fiyat, değerleme yaklaşımı, tahminler, riskler, farklılaşma noktaları. Güncel fiyat, temel veriler ve son KAP bildirimleriyle karşılaştır; güçlü ve zayıf yönleri kendi bağımsız görüşünle değerlendir.', { id: x.id, broker: x.broker, title: x.title, date: dateTR(x.date) })
      + (x.symbols.length ? ` ${t('Sonunda {symbol} için save_memory ile kurum görüşünü şirket notuna ekle.', { symbol: x.symbols[0] })}` : ''));
}
$('#fDays').onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; feedDays = Number(b.dataset.d); localSet('feedDays', feedDays); loadFeed(); };
// İzleme listem / Portföyüm: yalnız kendi sembollerimle ilgili raporlar. Tekrar tıklama süzgeci kaldırır.
$$('.fMine').forEach((b) => b.onclick = () => { feedMine = feedMine === b.dataset.m ? '' : b.dataset.m; localSet('feedMine', feedMine); loadFeed(); });
$('#fSym').addEventListener('input', debounce(loadFeed, 300));
$('#fBroker').onchange = loadFeed;
$('#fQ').addEventListener('input', debounce(drawFeed, 200));
$('#fCat').onchange = drawFeed;
on('ws:research.updated', () => { if (kind === 'akis' && root.classList.contains('active')) loadFeed(); });
$('#feedList').addEventListener('click', (e) => { if (e.target.closest('#fMore')) loadFeed(true); });
on('research:symbol', (s) => { kind = 'akis'; localSet('reportKind', kind); $('#fSym').value = s; emit('rtab', 'reports'); draw(); });
// Sembol kipi: kap.js seçilen sembolü yayınlar, akış ona kilitlenir (aynı sembol süzgeci, 200'er sayfalama).
// Sekme pasifken de güncellenir; kullanıcı Raporlar'a geçince hazır bekler.
const rLock = $('#rLock');
on('symlock', (sym) => {
  // Konsensüs sembol kipini paylaşır: KAP'ta seçilen hissenin kurum görüşleri açılır
  if (kind === 'konsensus') { $('#cSym').value = sym || ''; if (sym) loadConsensus(); }
  if ($('#fSym').value === (sym || '')) return;
  $('#fSym').value = sym || '';
  rLock.hidden = !sym;
  if (sym) rLock.firstElementChild.textContent = sym;
  draw();
});
// Rozet kilidi kap.js'de çözer; iki sekme de aynı kip durumunu paylaşır.
$('#rLock').onclick = () => emit('symlock:off');
$('#rFilter').addEventListener('input', debounce(draw, 150));
$('#rBroker').onchange = draw;
$('#rRefresh').onclick = load;
$('#rUpload').onclick = () => $('#rFile').click();
$('#rFile').onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) uploadModal(files); };
$('#rBrokerAsk').onclick = () => askAgent(t('İzleme listem ve portföyümdeki hisseler için güncel aracı kurum tavsiyelerini, hedef fiyatlarını ve konsensüsü (bağlı Matriks brokerResearch veya Borsa MCP get_analyst_data araçlarıyla) topla. Yüklenmiş kurum raporları varsa (workspace/reports/yuklenen) onları da oku. Sonucu kurum × sembol tablosu olarak HTML rapor halinde kaydet.'));
const lst = root.querySelector('.report-list');
lst.addEventListener('dragover', (e) => { e.preventDefault(); lst.classList.add('drop'); });
lst.addEventListener('dragleave', () => lst.classList.remove('drop'));
lst.addEventListener('drop', (e) => { e.preventDefault(); lst.classList.remove('drop'); const files = [...(e.dataTransfer?.files || [])]; if (files.length) uploadModal(files); });

on('ws:reports.changed', (m) => { if (m.name && m.title) toast(t('Yeni rapor: {title}', { title: m.title }), 'ok'); load(); });
on('reports:refresh', () => setTimeout(load, 1500));
on('rtab:shown', (tab) => { if (tab === 'reports') load(); });
on('report:show', async (name) => { selected = name; localSet('report', name); if (kind === 'akis') { kind = 'all'; localSet('reportKind', kind); } await load(); show(name); });
on('ready', load);
on('app:refresh', load);

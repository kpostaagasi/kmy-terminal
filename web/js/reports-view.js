// Sağ panel RAPORLAR + PDF sekmeleri: kurum raporu akışı, arşiv (ajan + kurum raporları), önizleme
import { state, on, emit, api, $, $$, esc, md, dateTR, toast, confirmBox, askAgent, localGet, localSet, modal, debounce } from './core.js';

const root = $('#rtab-reports');
const pdf = $('#rtab-pdf');
const EMPTY_PDF = '<div class="empty" style="margin:auto">RAPORLAR sekmesinden bir rapor seçin.</div>';
root.innerHTML = `<div class="reports">
  <div class="report-list">
    <div class="panel-head"><span>RAPORLAR</span><div class="head-actions"><button class="icon-btn sm" id="rUpload" title="Kurum raporu / PDF yükle">⇪</button><button class="icon-btn sm" id="rRefresh" title="Yenile">↻</button></div></div>
    <div class="seg" id="rKind" style="margin:8px 8px 0;display:flex"><button data-k="akis" style="flex:1" title="Aracı kurumların yeni yayımladığı şirket raporları">AKIŞ</button><button data-k="all" style="flex:1">ARŞİV</button><button data-k="ajan" style="flex:1">AJAN</button><button data-k="kurum" style="flex:1">KURUM</button></div>
    <div id="feedBox" hidden>
      <div style="padding:8px;display:flex;flex-direction:column;gap:6px">
        <div class="seg" id="fDays" style="display:flex"><button data-d="7" style="flex:1">7G</button><button data-d="30" style="flex:1">30G</button><button data-d="90" style="flex:1">90G</button><button data-d="0" style="flex:1">TÜMÜ</button></div>
        <div class="row" style="gap:6px;flex-wrap:nowrap"><input id="fSym" placeholder="Ticker" style="width:84px" aria-label="Ticker"><select id="fBroker" style="flex:1;min-width:0" aria-label="Kurum"><option value="">Tüm Kurumlar</option></select></div>
      </div>
      <div id="feedList"></div>
      <div class="dim" id="feedNote" style="font-size:11px;padding:8px"></div>
    </div>
    <div id="archBox">
    <div style="padding:8px;display:flex;flex-direction:column;gap:6px">
      <select id="rBroker" aria-label="Kurum"><option value="">Tüm Kurumlar</option></select>
      <input id="rFilter" placeholder="Başlık veya sembol ara (THYAO)…" aria-label="Rapor ara">
    </div>
    <input type="file" id="rFile" hidden multiple accept=".pdf,.html,.md,.csv,.png,.jpg,.xlsx,.txt">
    <div id="rList"></div>
    <div style="padding:8px"><button class="ghost" id="rBrokerAsk" style="width:100%">Kurum görüşlerini topla (ajan)</button></div>
    </div>
  </div>
</div>`;
pdf.innerHTML = `<div class="report-view" id="rView">${EMPTY_PDF}</div>`;
// PDF sekmesi yalnız bir rapor açıkken görünür; KAPAT (veya sekmedeki ✕) sekmeyi kaldırır
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
  $('#rBroker').innerHTML = '<option value="">Tüm Kurumlar</option>' + brokers.map((b) => `<option ${b === cur ? 'selected' : ''}>${esc(b)}</option>`).join('');
  draw();
}

function draw() {
  $$('#rKind button').forEach((b) => b.classList.toggle('active', b.dataset.k === kind));
  $('#feedBox').hidden = kind !== 'akis';
  $('#archBox').hidden = kind === 'akis';
  if (kind === 'akis') { loadFeed(); return; }
  const q = $('#rFilter').value.toLocaleLowerCase('tr').trim();
  const broker = $('#rBroker').value;
  const list = reports.filter((r) => (kind === 'all' || r.kind === kind) && (!broker || r.broker === broker)
    && (!q || `${r.title} ${r.name} ${(r.symbols || []).join(' ')} ${r.broker || ''}`.toLocaleLowerCase('tr').includes(q)));
  $('#rList').innerHTML = list.map((r) => `<div class="report-item ${r.name === selected ? 'sel' : ''}" data-n="${esc(r.name)}"><div class="t">${esc(r.title)}</div>
    <div class="m">${r.broker ? `<b>${esc(r.broker)}</b> · ` : ''}${(r.symbols || []).length ? `<span class="mono">${esc(r.symbols.join(', '))}</span> · ` : ''}${esc(r.ext.toUpperCase())} · ${dateTR(r.mtime, true)} · ${Math.max(1, Math.round(r.size / 1024))} KB</div></div>`).join('')
    || `<div class="empty">${kind === 'kurum' ? 'Kurum raporu yok. ⇪ ile PDF yükleyin.' : 'Rapor yok'}</div>`;
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
  const bar = `<div class="panel-head" style="gap:8px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title)}${r.broker ? ` <span class="dim">· ${esc(r.broker)}</span>` : ''}</span><div class="head-actions">
    <button class="ghost" id="rAsk">ANALİZ</button><a class="ghost" href="${url}" download>İNDİR</a><a class="ghost" href="${url}" target="_blank" rel="noopener">YENİ SEKMEDE AÇ</a><button class="ghost" id="rPresent" title="Tam ekran sunum">SUNUM</button>
    ${['html', 'htm'].includes(r.ext) ? '<button class="ghost" id="rPrint">YAZDIR</button>' : ''}<button class="ghost" id="rTag">ETİKETLE</button><button class="ghost" id="rDel">SİL</button><button class="ghost" data-close-pdf>KAPAT</button></div></div>`;
  const v = $('#rView');
  if (['html', 'htm', 'pdf', 'png', 'jpg', 'txt', 'csv'].includes(r.ext)) {
    // Raporlar ayrı porttan (ayrı köken) gelir; içlerindeki betikler uygulama API'sine erişemez
    v.innerHTML = `${bar}<iframe src="${url}" title="${esc(r.title)}" ${['html', 'htm'].includes(r.ext) ? 'sandbox="allow-scripts allow-same-origin allow-popups allow-modals"' : ''}></iframe>`;
  } else if (r.ext === 'md') {
    const text = await fetch(url).then((x) => x.text()).catch(() => 'Rapor okunamadı');
    v.innerHTML = `${bar}<div class="md msg assistant">${md(text)}</div>`;
  } else {
    v.innerHTML = `${bar}<div class="empty">Önizleme yok. İndirip açın.</div>`;
  }
  if (focus) openPdfTab();
  $('#rDel').onclick = async () => {
    if (!(await confirmBox(`"${r.title}" silinsin mi?`, { danger: true, ok: 'Sil' }))) return;
    await api(`/reports/${encodeURIComponent(name)}`, { method: 'DELETE' });
    selected = null; toast('Rapor silindi', 'ok'); closePdf(); load();
  };
  $('#rAsk').onclick = () => askAgent(`workspace/reports/${name} dosyasındaki raporu oku${r.broker ? ` (${r.broker} kurum raporu)` : ''}. Ana bulguları özetle, güçlü ve zayıf yönlerini kendi bağımsız görüşünle değerlendir ve güncel verilerle hâlâ geçerli olup olmadığını kontrol et.`);
  $('#rPresent').onclick = () => { const el = $('iframe', v) || $('.md', v); el?.requestFullscreen?.().catch(() => toast('Tam ekran açılamadı', 'err')); };
  $('#rTag').onclick = () => tagModal(r);
  const p = $('#rPrint');
  if (p) p.onclick = () => window.open(`${url}?print=1`, '_blank');
}

function tagModal(r) {
  const brokers = [...new Set(reports.map((x) => x.broker).filter(Boolean))];
  const m = modal({
    title: 'Raporu etiketle',
    body: `<form class="form-grid" id="tagF"><div class="field" style="grid-column:1/-1"><label>BAŞLIK</label><input name="title" value="${esc(r.title)}"></div>
      <div class="field"><label>KURUM</label><input name="broker" list="brList" value="${esc(r.broker || '')}" placeholder="ör. İş Yatırım"><datalist id="brList">${brokers.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div>
      <div class="field"><label>SEMBOLLER</label><input name="symbols" value="${esc((r.symbols || []).join(', '))}" placeholder="THYAO, PGSUS"></div></form>`,
    footer: '<button class="btn sec" data-close>İptal</button><button class="btn" id="tagSave">Kaydet</button>',
  });
  $('#tagSave', m.el).onclick = async () => {
    const f = Object.fromEntries(new FormData($('#tagF', m.el)));
    try { await api('/reports/meta', { method: 'PATCH', body: { name: r.name, ...f } }); m.close(); toast('Etiketler kaydedildi', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
}

function uploadModal(files) {
  const brokers = [...new Set(reports.map((x) => x.broker).filter(Boolean))];
  const m = modal({
    title: `${files.length} dosya yükle`,
    body: `<p class="muted">${files.map((f) => esc(f.name)).join('<br>')}</p><form class="form-grid" id="upF">
      <div class="field"><label>KURUM (isteğe bağlı)</label><input name="broker" list="brList2" placeholder="ör. İş Yatırım"><datalist id="brList2">${brokers.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div>
      <div class="field"><label>SEMBOLLER (isteğe bağlı)</label><input name="symbols" placeholder="THYAO, PGSUS"></div></form>`,
    footer: '<button class="btn sec" data-close>İptal</button><button class="btn" id="upGo">Yükle</button>',
  });
  $('#upGo', m.el).onclick = async () => {
    const f = Object.fromEntries(new FormData($('#upF', m.el)));
    m.close();
    for (const file of files) {
      try {
        const res = await fetch(`/api/reports/upload?name=${encodeURIComponent(file.name)}&broker=${encodeURIComponent(f.broker || '')}&symbols=${encodeURIComponent(f.symbols || '')}`, { method: 'POST', body: file });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        toast(`${file.name} yüklendi`, 'ok');
      } catch (x) { toast(`${file.name}: ${x.message}`, 'err'); }
    }
    if (f.broker) { kind = 'kurum'; localSet('reportKind', kind); }
  };
}

$('#rKind').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; localSet('reportKind', kind); draw(); };

// ── Kurum raporu akışı ─────────────────────────────
let feed = { items: [] }, feedDays = localGet('feedDays', 30), feedTok = 0, feedSel = null;
const BROKER_DOT = { garanti: '#2dd4bf', ak: '#ef4444', isyatirim: '#3b82f6', yapikredi: '#60a5fa', ziraat: '#22c55e', vakif: '#f59e0b', tacirler: '#a78bfa', phillip: '#f472b6', integral: '#94a3b8', a1: '#facc15' };
async function loadFeed() {
  const tok = ++feedTok;
  $$('#fDays button').forEach((b) => b.classList.toggle('active', Number(b.dataset.d) === feedDays));
  if (!feed.items.length) $('#feedList').innerHTML = '<div class="skeleton" style="height:160px;margin:8px"></div>';
  const q = new URLSearchParams({ days: feedDays, limit: 200, ...(($('#fSym').value.trim()) ? { symbol: $('#fSym').value.trim().toUpperCase() } : {}), ...($('#fBroker').value ? { broker: $('#fBroker').value } : {}), scope: 'company' });
  try {
    const r = await api(`/research?${q}`);
    if (tok !== feedTok) return;
    feed = r;
    const cur = $('#fBroker').value;
    $('#fBroker').innerHTML = '<option value="">Tüm Kurumlar</option>' + Object.entries(r.brokers).map(([k, b]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(b.name)}${r.status?.[k] && !r.status[k].ok ? ' (hata)' : ''}</option>`).join('');
    $('#feedList').innerHTML = r.items.map((x) => `<div class="report-item feed-item ${x.id === feedSel ? 'sel' : ''}" data-id="${esc(x.id)}">
      <div class="t"><span class="dot" style="background:${BROKER_DOT[x.brokerKey] || 'var(--text-3)'}"></span>${x.symbols.length ? `<b class="mono accent">${esc(x.symbols.slice(0, 3).join(', '))}</b> ` : ''}<span class="dim">${esc(x.broker)}</span>${x.isNew ? ' <span class="pill acc">YENİ</span>' : ''}${x.saved ? ' <span class="pill" title="Arşivde">✓</span>' : ''}</div>
      <div class="t2">${esc(x.title)}</div>
      <div class="m">${dateTR(x.date)} · ${esc(x.category)}${x.size ? ` · ${esc(x.size)}` : ''}${x.access === 'web' ? ' · web' : ''}</div></div>`).join('') || '<div class="empty">Bu filtrede rapor yok</div>';
    $$('.feed-item', root).forEach((el) => el.onclick = () => showFeed(el.dataset.id));
    const fails = Object.entries(r.status || {}).filter(([, s]) => !s.ok).map(([k]) => r.brokers[k]?.name);
    $('#feedNote').innerHTML = `${r.total} şirket raporu · otomatik güncelleme ${dateTR(r.at, true)} (30 dk'da bir)${fails.length ? ` · <span class="down">alınamadı: ${esc(fails.join(', '))}</span>` : ''}<br>Girişli kaynaklar (${r.unavailable.map((u) => `<span title="${esc(u.reason)}">${esc(u.name)}</span>`).join(', ')}): kendi hesabınızla indirin, Ayarlar › Veri › Kurum raporu klasör izleme arşive alır.`;
  } catch (e) { if (tok === feedTok) $('#feedList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function showFeed(id) {
  const x = feed.items.find((i) => i.id === id);
  if (!x) return;
  feedSel = id;
  $$('.feed-item', root).forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  const src = `/api/research/file?id=${encodeURIComponent(id)}`;
  const web = x.access === 'web';
  $('#rView').innerHTML = `<div class="panel-head" style="gap:8px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.title)} <span class="dim">· ${esc(x.broker)} · ${dateTR(x.date)}</span></span><div class="head-actions">
      <button class="ghost" id="fAsk">ANALİZ</button>${web ? '' : `<a class="ghost" href="${esc(src)}" download>İNDİR</a><button class="ghost" id="fSave" title="Arşive kaydet">KAYDET</button>`}<a class="ghost" href="${esc(web ? x.page : src)}" target="_blank" rel="noopener">${web ? 'KAYNAKTA AÇ' : 'YENİ SEKMEDE AÇ'}</a><button class="ghost" data-close-pdf>KAPAT</button></div></div>
    ${x.summary ? `<div class="feed-sum">${x.symbols.length ? `<b class="mono">${esc(x.symbols.join(', '))}</b> · ` : ''}${esc(x.summary)}</div>` : ''}
    ${web ? '<div class="empty" style="margin:auto">Bu kurum raporu web yazısı olarak yayımlıyor. "Kaynakta aç" ile okuyun veya ajana analiz ettirin.</div>' : `<iframe src="${src}" title="${esc(x.title)}"></iframe>`}`;
  openPdfTab();
  $('#fAsk').onclick = () => askAgent(web
    ? `${x.broker} yazısını oku (WebFetch: ${x.page}) ve analiz et: temel tez, varsa tavsiye ve hedef fiyat, değerleme yaklaşımı, riskler; güncel fiyat ve temel verilerle karşılaştır ve kendi bağımsız görüşünle değerlendir.`
    : `read_broker_report ile "${x.id}" kimlikli ${x.broker} raporunu (${x.title}, ${dateTR(x.date)}) indir ve pdf-okuma becerisiyle oku. Özet değil analiz istiyorum: temel tez, tavsiye ve hedef fiyat, değerleme yaklaşımı, tahminler, riskler, farklılaşma noktaları. Güncel fiyat, temel veriler ve son KAP bildirimleriyle karşılaştır; güçlü ve zayıf yönleri kendi bağımsız görüşünle değerlendir.${x.symbols.length ? ` Sonunda ${x.symbols[0]} için save_memory ile kurum görüşünü şirket notuna ekle.` : ''}`);
  const sv = $('#fSave');
  if (sv) sv.onclick = async () => { sv.disabled = true; try { const r = await api('/research/save', { method: 'POST', body: { id } }); toast(`Arşive kaydedildi: ${r.name}`, 'ok'); x.saved = r.name; } catch (e) { toast(e.message, 'err'); } sv.disabled = false; };
}
$('#fDays').onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; feedDays = Number(b.dataset.d); localSet('feedDays', feedDays); loadFeed(); };
$('#fSym').addEventListener('input', debounce(loadFeed, 300));
$('#fBroker').onchange = loadFeed;
on('ws:research.updated', () => { if (kind === 'akis' && root.classList.contains('active')) loadFeed(); });
on('research:symbol', (s) => { kind = 'akis'; localSet('reportKind', kind); $('#fSym').value = s; emit('rtab', 'reports'); draw(); });
$('#rFilter').addEventListener('input', debounce(draw, 150));
$('#rBroker').onchange = draw;
$('#rRefresh').onclick = load;
$('#rUpload').onclick = () => $('#rFile').click();
$('#rFile').onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) uploadModal(files); };
$('#rBrokerAsk').onclick = () => askAgent('İzleme listem ve portföyümdeki hisseler için güncel aracı kurum tavsiyelerini, hedef fiyatlarını ve konsensüsü (bağlı Matriks brokerResearch veya Borsa MCP get_analyst_data araçlarıyla) topla. Yüklenmiş kurum raporları varsa (workspace/reports/yuklenen) onları da oku. Sonucu kurum × sembol tablosu olarak HTML rapor halinde kaydet.');
const lst = root.querySelector('.report-list');
lst.addEventListener('dragover', (e) => { e.preventDefault(); lst.classList.add('drop'); });
lst.addEventListener('dragleave', () => lst.classList.remove('drop'));
lst.addEventListener('drop', (e) => { e.preventDefault(); lst.classList.remove('drop'); const files = [...(e.dataTransfer?.files || [])]; if (files.length) uploadModal(files); });

on('ws:reports.changed', (m) => { if (m.name && m.title) toast(`Yeni rapor: ${m.title}`, 'ok'); load(); });
on('reports:refresh', () => setTimeout(load, 1500));
on('rtab:shown', (t) => { if (t === 'reports') load(); });
on('report:show', async (name) => { selected = name; localSet('report', name); if (kind === 'akis') { kind = 'all'; localSet('reportKind', kind); } await load(); show(name); });
on('ready', load);

// PORTFÖY görünümü: özet, varlıklar, pozisyonlar & nakit, işlemler, dağılım, temettü, risk, içe aktarma, ayarlar
import { state, on, emit, api, $, $$, h, esc, num, price, pct, cls, money, dateTR, today, toast, modal, confirmBox, selectSymbol, askAgent, localGet, localSet, css, debounce, timeTR } from './core.js';
import { baseOptions, makeChart, doughnut, palette } from './charts.js';

const root = $('#view-portfolio');
const TABS = [['ozet', 'ÖZET'], ['varliklar', 'VARLIKLAR'], ['pozisyonlar', 'POZİSYON & NAKİT'], ['islemler', 'İŞLEM'], ['dagilim', 'DAĞILIM'], ['temettu', 'TEMETTÜ'], ['risk', 'RİSK'], ['aktar', 'İÇE AKTAR'], ['ayarlar', 'AYARLAR']];
let tab = localGet('pfTab', 'ozet');
let data = null;
let sortKey = localGet('pfSort', 'value'), sortDir = -1;
let holdFilter = '';
let riskRange = localGet('pfRange', { from: '', to: '' });
let benchOn = new Set(localGet('pfBench', ['XU100', 'USDTRY', 'GRAM']));

root.innerHTML = `<div class="subtabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-t="${k}">${l}</button>`).join('')}
  <span style="flex:1"></span><button class="btn" id="pfAdd" style="margin:5px 0">＋ YENİ İŞLEM</button></div><div class="pad" id="pfBody"></div>`;
$('.subtabs', root).addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { tab = b.dataset.t; localSet('pfTab', tab); emit('pf:tab', tab); render(); } });
$('#pfAdd').onclick = () => openTxModal();
const body = $('#pfBody');
body.addEventListener('click', (e) => { if (tab === 'varliklar') onHoldingClick(e); });

async function load() {
  try { data = await api('/portfolio'); } catch (e) { data = null; toast(e.message, 'err'); }
  render();
}

function render() {
  $$('.subtabs [data-t]', root).forEach((b) => b.classList.toggle('active', b.dataset.t === tab));
  const scroll = root.scrollTop;
  const fn = { ozet: renderSummary, varliklar: renderHoldings, pozisyonlar: renderPositions, islemler: renderTx, dagilim: renderDist, temettu: renderDiv, risk: renderRisk, aktar: renderImport, ayarlar: renderSettings }[tab];
  Promise.resolve(fn()).then(() => { root.scrollTop = scroll; });
}

const isEmpty = () => !data || (!data.holdings.length && !data.closed.length && !data.cash.length);
function emptyState() {
  body.innerHTML = `<div class="card empty" style="padding:40px"><h3 style="justify-content:center">PORTFÖY BOŞ</h3>
    <p>İlk işleminizi ekleyin veya aracı kurumunuzdan aldığınız CSV dosyasını içe aktarın. Nakit takibi için önce bir <b>nakit girişi</b> kaydedin.</p>
    <div class="row" style="justify-content:center"><button class="btn" data-a="add">＋ İşlem ekle</button><button class="btn sec" data-a="imp">CSV içe aktar</button></div></div>`;
  $('[data-a=add]', body).onclick = () => openTxModal();
  $('[data-a=imp]', body).onclick = () => { tab = 'aktar'; render(); };
}

function kpi(l, v, s = '', c = '', title = '') { return `<div class="card kpi" ${title ? `title="${esc(title)}"` : ''}><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`; }
function warningsHtml() {
  return data?.warnings?.length ? `<div class="card warn" style="margin-bottom:12px">${data.warnings.map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : '';
}

// ── Özet ─────────────────────────────────────────
function renderSummary() {
  if (isEmpty()) return emptyState();
  const t = data.totals;
  const cashByCur = {};
  for (const c of data.cash) cashByCur[c.currency] = (cashByCur[c.currency] || 0) + c.amount;
  const cashTip = Object.entries(cashByCur).map(([c, a]) => `${money(a, c, 2)}`).join(' · ');
  body.innerHTML = `${warningsHtml()}
  <div class="grid g4">
    ${kpi('TOPLAM DEĞER', money(t.value), t.valueUSD ? `≈ ${money(t.valueUSD, 'USD')}` : '')}
    ${kpi('GÜNLÜK DEĞİŞİM', money(t.dayChange), `${pct(t.dayChangePct)} · kur etkisi dahil`, cls(t.dayChange))}
    ${kpi('AÇIK POZİSYON K/Z', money(t.unrealized), pct(t.unrealizedPct), cls(t.unrealized))}
    ${kpi('TOPLAM K/Z', money(t.totalPnl), `${pct(t.totalPnlPct)} · net yatırılan ${money(t.netInvested)}`, cls(t.totalPnl), 'Toplam değer − net yatırılan (nakit takibi varsa); aksi hâlde açık + gerçekleşen K/Z + gelirler')}
    ${kpi('MALİYET', money(t.cost), `${t.positionsCount} pozisyon`)}
    ${kpi('GERÇEKLEŞEN K/Z', money(t.realized), `komisyonlar ${money(t.commissions)}`, cls(t.realized))}
    ${kpi('TEMETTÜ + FAİZ', money(t.dividends + t.interest), `temettü ${money(t.dividends)} · faiz ${money(t.interest)}${t.staking ? ` · staking ${money(t.staking)}` : ''}`)}
    ${kpi('KUR FARKI', money(t.kurFarki), `gerçekleşen ${money(t.fxRealized)} · açık ${money(t.fxUnrealized)}`, cls(t.kurFarki), 'Yabancı para nakdin TL karşılığındaki değişim')}
  </div>
  <div class="card strip" id="pfStrip" style="margin-top:12px">Maliyet ${money(t.cost)} · Nakit ${t.cash == null ? '—' : money(t.cash)}${cashTip ? ` (${esc(cashTip)})` : ''} · Pozisyon ${t.positionsCount} · <span class="dim">getiri metrikleri hesaplanıyor…</span></div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>PORTFÖY vs KIYASLAR (TL) <span class="dim" id="perfNote" style="font-weight:400"></span></h3><div class="row" id="benchToggles" style="margin-bottom:6px"></div><div class="chart-box md"><canvas id="pfPerf"></canvas></div></div>
    <div class="card"><h3>VARLIK DAĞILIMI</h3><div class="chart-box md"><canvas id="pfPie"></canvas></div></div>
  </div>
  <div class="grid g4" style="margin-top:12px">
    <div class="card"><h3>EN BÜYÜK POZİSYONLAR</h3>${miniTable(data.holdings.slice(0, 6), (h) => `<td class="mono"><b>${esc(h.symbol)}</b></td><td class="r num">${money(h.value)}</td><td class="r num">${num(h.weight, 1)}%</td>`)}</div>
    <div class="card"><h3>GÜNÜN LİDERİ / EN ZAYIFI</h3>${miniTable([...data.holdings].filter((x) => x.changePct != null).sort((a, b) => b.changePct - a.changePct).filter((_, i, a) => i < 3 || i >= a.length - 3), (h) => `<td class="mono"><b>${esc(h.symbol)}</b></td><td class="r num ${cls(h.changePct)}">${pct(h.changePct)}</td><td class="r num ${cls(h.dayChange)}">${money(h.dayChange)}</td>`)}</div>
    <div class="card"><h3>K/Z SIRALAMASI</h3>${miniTable([...data.holdings].filter((x) => x.pnl != null).sort((a, b) => b.pnl - a.pnl).filter((_, i, a) => i < 3 || i >= a.length - 3), (h) => `<td class="mono"><b>${esc(h.symbol)}</b></td><td class="r num ${cls(h.pnl)}">${money(h.pnl)}</td><td class="r num ${cls(h.pnlPct)}">${pct(h.pnlPct)}</td>`)}</div>
    <div class="card"><h3 title="Açık pozisyonların toplam K/Z içindeki payı (açık + gerçekleşen + temettü). Kapanmış pozisyonlar listede yok ama toplamda var.">K/Z KATKISI</h3>${contributionTable(t)}</div>
  </div>
  <div class="card" style="margin-top:12px"><h3>AJANA SOR</h3><div class="row">${[
    ['Portföyümü özetle', 'Portföyümü özetle: performans, en güçlü/zayıf pozisyonlar, yoğunlaşma riski ve pozisyonlarımla ilgili son KAP bildirimleri. Kısa ve maddeli.'],
    ['Kayıplı pozisyonları analiz et', 'Portföyümdeki zararda olan pozisyonları analiz et: maliyetime göre durum, teknik görünüm, temel oranlar ve son KAP bildirimleri. Her biri için izlenecek seviyeleri belirt.'],
    ['En çok kazandıranlar', 'En çok kazandıran pozisyonlarımı analiz et: kârın kaynağı, değerleme (F/K, PD/DD) ve risk; kâr realizasyonu senaryolarını hesapla (öneri değil).'],
    ['Sektörel yoğunluk', 'Sektörel ve para birimi yoğunluğumu analiz et; tek hisse >%20, tek sektör >%35 gibi eşikleri aşanları belirt.'],
    ['Risk analizi', 'Portföyümün risk metriklerini (TWR, XIRR, Sharpe, Sortino, maksimum düşüş, beta) ve kıyasları (BIST 100, USD/TL, gram altın) yorumla; HTML rapor olarak kaydet.'],
    ['Aylık performans', 'Aylık performansımı BIST 100, USD/TL ve gram altınla karşılaştır; en iyi ve en kötü ayların nedenlerini açıkla.'],
    ['Temettü gelirlerim', 'Temettü gelirlerimi ve yaklaşan temettüleri (get_dividend_report, get_corporate_actions) özetle; brüt/net ve verimleri göster.'],
    ['Son işlemlerim', 'Son işlemlerimi (get_transactions) özetle; alım-satım zamanlamamı ve komisyon yükümü değerlendir.'],
    ['İşlem stratejim', 'İşlemlerimdeki stratejileri ve davranış kalıplarını analiz et (tutma süreleri, kâr/zarar kapama alışkanlıkları).'],
    ['Yeniden dengeleme', 'Eşit ağırlıklı ve sektör tavanlı (tek sektör ≤%30) iki yeniden dengeleme senaryosu hesapla; alım/satım adetlerini tablo halinde göster. Bu bir hesaplama, öneri değil.'],
  ].map(([l, p]) => `<button class="ghost" data-ask="${esc(p)}">${esc(l)}</button>`).join('')}</div></div>`;
  doughnut($('#pfPie'), data.distribution.byAsset);
  $$('[data-ask]', body).forEach((b) => b.onclick = () => askAgent(b.dataset.ask));
  $$('tr[data-s]', body).forEach((r) => r.onclick = () => selectSymbol(r.dataset.s));
  perfChart($('#pfPerf'), 'level', true);
}

// Toplam K/Z'ye en çok katkı yapan 3 açık pozisyon (açık + gerçekleşen + temettü)
function contributionTable(t) {
  if (!t.totalPnl) return '<div class="dim">—</div>';
  const rows = data.holdings.filter((h) => h.pnl != null).map((h) => ({ ...h, contrib: h.pnl + (h.realized || 0) + (h.dividends || 0) }))
    .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, 3);
  return miniTable(rows, (h) => `<td class="mono"><b>${esc(h.symbol)}</b></td><td class="r num ${cls(h.contrib)}">${money(h.contrib)}</td><td class="r num ${cls(h.contrib)}" title="Toplam K/Z içindeki pay">${num((h.contrib / Math.abs(t.totalPnl)) * 100, 0)}%</td>`);
}

function miniTable(rows, cells) {
  return rows.length ? `<table class="t"><tbody>${rows.map((h) => `<tr class="click" data-s="${esc(h.symbol)}">${cells(h)}</tr>`).join('')}</tbody></table>` : '<div class="dim">—</div>';
}

const riskCache = new Map();
async function getRisk(range = { from: '', to: '' }, force = false) {
  const key = `${range.from}|${range.to}`;
  if (!riskCache.has(key) || force) riskCache.set(key, api(`/portfolio/risk?from=${range.from || ''}&to=${range.to || ''}`));
  try { return await riskCache.get(key); } catch (e) { riskCache.delete(key); throw e; }
}

async function perfChart(canvas, mode = 'level', withStrip = false, range = { from: '', to: '' }) {
  try {
    const r = await getRisk(range);
    if (!canvas.isConnected) return;
    if (withStrip && $('#pfStrip')) {
      const m = r.metrics || {};
      $('#pfStrip').innerHTML = `Maliyet ${money(data.totals.cost)} · ${m.cagrPct != null ? `CAGR ${pct(m.cagrPct)}` : `Yıllıklandırılmış ${pct(m.annualizedPct)}`} · Gerçek getiri (XIRR) <b class="${cls(m.xirrPct)}">${pct(m.xirrPct)}</b> · Devir ${pct(m.turnoverPct, 0, false)} · Pozisyon ${data.totals.positionsCount} · Nakit ${data.totals.cash == null ? '—' : money(data.totals.cash)}`;
    }
    if (!r.enough) { canvas.parentElement.innerHTML = '<div class="empty">Grafik için en az birkaç günlük veri gerekir</div>'; return; }
    const tog = canvas.closest('.card')?.querySelector('[id$=benchToggles]');
    if (tog) {
      tog.innerHTML = Object.entries(r.benchmarks || {}).map(([k, b]) => `<label class="pill" style="cursor:pointer"><input type="checkbox" data-b="${k}" ${benchOn.has(k) ? 'checked' : ''} style="margin:0 4px 0 0;vertical-align:-1px">${esc(b.label)} <span class="${cls(b.returnPct)}">${pct(b.returnPct, 1)}</span></label>`).join('') || '<span class="dim">Kıyas verisi alınamadı</span>';
      $$('[data-b]', tog).forEach((c) => c.onchange = () => { c.checked ? benchOn.add(c.dataset.b) : benchOn.delete(c.dataset.b); localSet('pfBench', [...benchOn]); perfChart(canvas, mode, false, range); });
    }
    const s = r.series;
    const colors = palette();
    const ds = mode === 'value'
      ? [{ label: 'Portföy değeri (₺)', data: s.map((p) => ({ x: p.date, y: p.value })), borderColor: css('--accent'), pointRadius: 0, borderWidth: 1.6, fill: { target: 'origin', above: css('--accent') + '15' } },
        { label: 'Net yatırılan (₺)', data: s.map((p) => ({ x: p.date, y: p.invested })), borderColor: css('--text-3'), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.2, stepped: true }]
      : [{ label: `Portföy (TWR) ${pct(r.metrics.totalReturnPct, 1)}`, data: s.map((p) => ({ x: p.date, y: p.level })), borderColor: css('--accent'), pointRadius: 0, borderWidth: 2 },
        ...Object.keys(r.benchmarks || {}).filter((k) => benchOn.has(k)).map((k, i) => ({ label: r.benchmarks[k].label, data: s.filter((p) => p[k] != null).map((p) => ({ x: p.date, y: p[k] })), borderColor: colors[(i + 1) % colors.length], pointRadius: 0, borderWidth: 1.1 }))];
    makeChart(canvas, { type: 'line', data: { datasets: ds }, options: baseOptions({ legend: true }) });
    const note = $('#perfNote');
    if (note) note.textContent = `${dateTR(r.start)} – ${dateTR(r.end)} · başlangıç = 100`;
  } catch (e) { if (canvas.isConnected) canvas.parentElement.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// ── Varlıklar ─────────────────────────────────────
const HOLD_COLS = [
  ['symbol', 'Sembol'], ['assetLabel', 'Tür'], ['sector', 'Sektör'], ['qty', 'Miktar', 'r'], ['avgCost', 'Ort. maliyet', 'r'], ['price', 'Güncel fiyat', 'r'],
  ['changePct', 'Gün %', 'r'], ['value', 'Değer ₺', 'r'], ['weight', 'Ağırlık', 'r'], ['pnl', 'K/Z ₺', 'r'], ['pnlPct', 'K/Z %', 'r'], ['dividends', 'Temettü ₺', 'r'],
];
const SRC_PILL = { 'gecikmeli': '<span class="pill" title="Borsa verisi ~15 dk gecikmeli">15dk</span>', 'canlı': '', 'manuel': '<span class="pill acc" title="Elle girilen fiyat">manuel</span>', 'son işlem': '<span class="pill down" title="Canlı fiyat yok; son işlem fiyatı kullanılıyor">fiyatsız</span>' };
function renderHoldings() {
  if (isEmpty()) return emptyState();
  const rows = [...data.holdings].sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    return (typeof x === 'string' ? x.localeCompare(y, 'tr') : (x ?? -1e18) - (y ?? -1e18)) * sortDir;
  });
  const t = data.totals;
  body.innerHTML = `${warningsHtml()}<div class="card"><h3>PORTFÖYÜMDEKİ VARLIKLAR <input id="hFilter" placeholder="Filtre…" value="${esc(holdFilter)}" style="width:160px;font-weight:400"></h3><div class="table-wrap"><table class="t" id="hTable">
    <thead><tr>${HOLD_COLS.map(([k, l, c]) => `<th class="sortable ${c || ''}" data-k="${k}">${l}${sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr></thead>
    <tbody>${rows.map((h) => `<tr class="click" data-s="${esc(h.symbol)}">
      <td class="mono"><b>${esc(h.symbol)}</b> ${SRC_PILL[h.priceSource] || ''}<div class="dim" style="font-size:10.5px;font-family:var(--sans)">${esc(h.name !== h.symbol ? h.name : '')}</div></td><td>${esc(h.assetLabel)}</td><td class="muted">${esc(h.sector)}</td>
      <td class="r num">${num(h.qty, h.qty % 1 ? 4 : 0)}</td><td class="r num" title="TL ortalama maliyet: ${esc(price(h.avgCost))} ₺">${h.currency !== 'TRY' ? `${price(h.avgCostNative)} <span class="dim">${esc(h.currency)}</span>` : price(h.avgCost)}</td><td class="r num" title="${esc(h.priceSource)}${h.priceTime ? ' · ' + (typeof h.priceTime === 'number' ? timeTR(h.priceTime) : h.priceTime) : ''}">${price(h.price)} <span class="dim">${h.currency !== 'TRY' ? esc(h.currency) : ''}</span></td>
      <td class="r num ${cls(h.changePct)}">${pct(h.changePct)}</td><td class="r num">${money(h.value)}</td>
      <td class="r"><div class="row" style="justify-content:flex-end;gap:6px;flex-wrap:nowrap"><span class="num">${num(h.weight, 1)}%</span><div class="bar" style="width:50px"><i style="width:${Math.min(h.weight, 100)}%"></i></div></div></td>
      <td class="r num ${cls(h.pnl)}" ${h.pnlFx != null ? `title="Fiyat etkisi ${esc(money(h.pnlPrice))} · kur etkisi ${esc(money(h.pnlFx))}"` : ''}>${money(h.pnl)}${h.pnlFx != null ? `<div class="dim" style="font-size:10px">fiyat ${money(h.pnlPrice)} · kur ${money(h.pnlFx)}</div>` : ''}</td><td class="r num ${cls(h.pnlPct)}">${pct(h.pnlPct)}</td><td class="r num">${h.dividends ? money(h.dividends) : '—'}</td>
      <td style="white-space:nowrap"><button class="ghost" data-buy="${esc(h.symbol)}">Al</button> <button class="ghost" data-sell="${esc(h.symbol)}">Sat</button>${h.priceSource === 'son işlem' || h.priceSource === 'manuel' ? ` <button class="ghost" data-price="${esc(h.symbol)}">Fiyat gir</button>` : ''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="7">Toplam (nakit hariç)</td><td class="r num">${money(t.holdingsValue)}</td><td></td><td class="r num ${cls(t.unrealized)}">${money(t.unrealized)}</td><td class="r num ${cls(t.unrealizedPct)}">${pct(t.unrealizedPct)}</td><td class="r num">${money(data.holdings.reduce((a, h) => a + h.dividends, 0))}</td><td></td></tr></tfoot>
  </table></div></div>
  ${data.closed.length ? `<div class="card" style="margin-top:12px"><h3>KAPANMIŞ POZİSYONLAR</h3><table class="t"><thead><tr><th>Sembol</th><th class="r">Gerçekleşen K/Z</th><th class="r">Temettü</th></tr></thead><tbody>${data.closed.map((c) => `<tr class="click" data-s="${esc(c.symbol)}"><td class="mono">${esc(c.symbol)}</td><td class="r num ${cls(c.realized)}">${money(c.realized)}</td><td class="r num">${money(c.dividends)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  $$('th[data-k]', body).forEach((th) => th.onclick = () => { if (sortKey === th.dataset.k) sortDir *= -1; else { sortKey = th.dataset.k; sortDir = -1; } localSet('pfSort', sortKey); renderHoldings(); });
  const applyFilter = () => {
    const q = holdFilter.toLocaleLowerCase('tr');
    $$('#hTable tbody tr').forEach((r) => { r.hidden = q && !r.textContent.toLocaleLowerCase('tr').includes(q); });
  };
  $('#hFilter').addEventListener('input', (e) => { holdFilter = e.target.value; applyFilter(); });
  applyFilter();
}
function onHoldingClick(e) {
  const s = e.target.closest('[data-sell]'), b = e.target.closest('[data-buy]'), pr = e.target.closest('[data-price]');
  const find = (sym) => data.holdings.find((x) => x.symbol === sym);
  if (s) { const hh = find(s.dataset.sell); return openTxModal({ symbol: hh.symbol, type: 'SELL', quantity: hh.qty, price: hh.price, platform: hh.platforms[0] }); }
  if (b) { const hh = find(b.dataset.buy); return openTxModal({ symbol: hh.symbol, type: 'BUY', price: hh.price, platform: hh.platforms[0] }); }
  if (pr) return openPriceModal(pr.dataset.price, find(pr.dataset.price)?.price);
  const r = e.target.closest('tr[data-s]'); if (r && !e.target.closest('button')) selectSymbol(r.dataset.s);
}

export function openPriceModal(symbol, current) {
  const m = modal({
    title: `${symbol} için fiyat gir`,
    body: `<p class="muted">Canlı fiyatı olmayan varlıklar (TEFAS fonu, mevduat vb.) için güncel birim fiyat. Ajana "fon fiyatlarımı güncelle" diyerek de güncelletebilirsiniz.</p>
      <form class="form-grid" id="mpf"><div class="field"><label>BİRİM FİYAT</label><input name="price" type="number" step="any" value="${current ? Math.round(current * 1e6) / 1e6 : ''}" required></div><div class="field"><label>TARİH</label><input name="date" type="date" value="${today()}"></div></form>`,
    footer: '<button class="btn sec" data-clear>Elle fiyatı kaldır</button><button class="btn sec" data-close>İptal</button><button class="btn" data-save>Kaydet</button>',
  });
  const f = $('#mpf', m.el);
  $('[data-save]', m.el).onclick = async () => { try { await api(`/symbols/${encodeURIComponent(symbol)}/price`, { method: 'POST', body: { price: Number(f.price.value), date: f.date.value } }); toast('Fiyat kaydedildi', 'ok'); m.close(); } catch (e) { toast(e.message, 'err'); } };
  $('[data-clear]', m.el).onclick = async () => { await api(`/symbols/${encodeURIComponent(symbol)}/price`, { method: 'POST', body: { price: null } }); toast('Elle fiyat kaldırıldı'); m.close(); };
}

// ── Pozisyonlar ve nakit (platform bazında) ────────
function renderPositions() {
  if (isEmpty()) return emptyState();
  const groups = {};
  for (const p of data.positions) (groups[p.platform] ||= { pos: [], cash: [] }).pos.push(p);
  for (const c of data.cash) (groups[c.platform] ||= { pos: [], cash: [] }).cash.push(c);
  body.innerHTML = warningsHtml() + (Object.entries(groups).map(([plat, g]) => {
    const v = g.pos.reduce((a, b) => a + b.value, 0), c = g.pos.reduce((a, b) => a + b.cost, 0);
    const cashTL = g.cash.reduce((a, b) => a + (b.valueTRY || 0), 0);
    return `<div class="card" style="margin-bottom:12px"><h3>${esc(plat)} <span class="num" style="font-weight:400">${money(v + (data.totals.cash != null ? cashTL : 0))} · pozisyon K/Z <span class="${cls(v - c)}">${money(v - c)} (${pct(c ? (v / c - 1) * 100 : null)})</span></span></h3>
      ${g.pos.length ? `<table class="t"><thead><tr><th>Sembol</th><th class="r">Miktar</th><th class="r">Ort. maliyet</th><th class="r">Fiyat</th><th class="r">Maliyet ₺</th><th class="r">Değer</th><th class="r">K/Z</th><th class="r">K/Z %</th><th class="r">Ağırlık</th><th>İlk alış</th></tr></thead>
      <tbody>${g.pos.map((p) => `<tr class="click" data-s="${esc(p.symbol)}"><td class="mono"><b>${esc(p.symbol)}</b></td><td class="r num">${num(p.qty, p.qty % 1 ? 4 : 0)}</td><td class="r num" title="TL ortalama maliyet: ${esc(price(p.avgCost))} ₺">${p.currency && p.currency !== 'TRY' ? `${price(p.avgCostNative)} <span class="dim">${esc(p.currency)}</span>` : price(p.avgCost)}</td><td class="r num">${price(p.price)}${p.currency && p.currency !== 'TRY' ? ` <span class="dim">${esc(p.currency)}</span>` : ''}</td><td class="r num">${money(p.cost)}</td><td class="r num">${money(p.value)}</td><td class="r num ${cls(p.pnl)}">${money(p.pnl)}</td><td class="r num ${cls(p.pnlPct)}">${pct(p.pnlPct)}</td><td class="r num">${num(p.weight, 1)}%</td><td>${dateTR(p.firstDate)}</td></tr>`).join('')}</tbody></table>` : '<div class="dim">Açık pozisyon yok</div>'}
      ${g.cash.length ? `<div class="mini-head" style="margin-top:10px">NAKİT</div><table class="t"><thead><tr><th>Para birimi</th><th class="r">Tutar</th><th class="r">TL karşılığı</th><th class="r">TL maliyeti</th><th class="r">Kur farkı</th></tr></thead>
      <tbody>${g.cash.map((x) => `<tr><td>${esc(x.currency)}</td><td class="r num ${x.amount < 0 ? 'down' : ''}">${num(x.amount, 2)}</td><td class="r num">${money(x.valueTRY, 'TRY', 2)}</td><td class="r num">${x.currency === 'TRY' ? '' : money(x.costTRY, 'TRY', 2)}</td><td class="r num ${cls(x.fxPnl)}">${x.currency === 'TRY' ? '' : money(x.fxPnl, 'TRY', 2)}</td></tr>`).join('')}</tbody></table>` : ''}</div>`;
  }).join('') || '<div class="empty">Açık pozisyon yok</div>')
  + (!data.totals.cashTracking ? '<p class="dim">Nakit takibi kapalı: nakit girişi (DEPOSIT) kaydı olmadığından alış/satışların nakit etkisi toplam değere katılmıyor.</p>' : '');
  $$('tr[data-s]', body).forEach((r) => r.onclick = () => selectSymbol(r.dataset.s));
}

// ── İşlemler ──────────────────────────────────────
let txFilter = { symbol: '', type: '', platform: '', strategy: '', from: '', to: '' };
let txLimit = 300;
let txTok = 0;
async function renderTx() {
  const tok = ++txTok;
  const q = new URLSearchParams({ ...txFilter, limit: txLimit });
  const [txs, plats, strats] = await Promise.all([api(`/transactions?${q}`), api('/platforms'), api('/strategies')]);
  if (tab !== 'islemler' || tok !== txTok) return;
  const focused = document.activeElement?.name;
  const T = state.meta.txTypes;
  body.innerHTML = `<div class="card"><h3>İŞLEM GEÇMİŞİ <span class="dim" style="font-weight:400">${txs.length}${txs.length >= txLimit ? '+' : ''} kayıt</span></h3>
    <div class="row" style="margin-bottom:10px" id="txFilters">
      <input name="symbol" placeholder="Sembol" value="${esc(txFilter.symbol)}" style="width:100px">
      <select name="type"><option value="">Tüm tipler</option>${Object.entries(T).map(([k, v]) => `<option value="${k}" ${txFilter.type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <select name="platform"><option value="">Tüm platformlar</option>${plats.map((p) => `<option value="${p.id}" ${String(txFilter.platform) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <select name="strategy"><option value="">Tüm stratejiler</option>${strats.map((p) => `<option value="${p.id}" ${String(txFilter.strategy) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <input name="from" type="date" value="${esc(txFilter.from)}" title="Başlangıç"><input name="to" type="date" value="${esc(txFilter.to)}" title="Bitiş">
    </div>
    <div class="table-wrap"><table class="t"><thead><tr><th>Tarih</th><th>Aksiyon</th><th>Sembol</th><th class="r">Miktar</th><th class="r">Fiyat / Tutar</th><th class="r">Komisyon / Stopaj</th><th>PB</th><th class="r">Kur</th><th class="r">TL karşılığı</th><th>Platform</th><th>Strateji</th><th>Not</th><th></th></tr></thead>
    <tbody>${txs.map((t) => {
      const amountType = ['DIVIDEND', 'DEPOSIT', 'WITHDRAW', 'FEE', 'INTEREST', 'FX_CONVERT'].includes(t.type);
      let total = null;
      if (['BUY', 'SELL', 'DRIP'].includes(t.type)) total = (t.quantity * t.price + (t.type === 'BUY' ? t.fee : t.type === 'SELL' ? -t.fee : 0)) * t.fx_rate;
      else if (t.type === 'DIVIDEND') total = (t.price - t.fee) * t.fx_rate;
      else if (amountType) total = t.price * t.fx_rate;
      else if (t.type === 'TRANSFER' && !t.symbol) total = t.price * t.fx_rate;
      const pillCls = { BUY: 'up', SELL: 'down', DIVIDEND: 'acc', DRIP: 'acc', DEPOSIT: 'up', WITHDRAW: 'down' }[t.type] || '';
      const extra = t.type === 'TRANSFER' ? ` → ${esc(t.to_platform || '?')}` : t.type === 'FX_CONVERT' ? ` → ${num(t.to_amount, 2)} ${esc(t.to_currency)}` : '';
      return `<tr><td>${dateTR(t.date)}</td><td><span class="pill ${pillCls}">${esc(T[t.type] || t.type)}</span>${extra}</td><td class="mono"><b>${esc(t.symbol || '—')}</b></td>
        <td class="r num">${amountType ? '' : t.type === 'SPLIT' ? `×${num(t.quantity, 4)}` : num(t.quantity, t.quantity % 1 ? 4 : 0)}</td><td class="r num">${t.type === 'SPLIT' || (t.type === 'TRANSFER' && t.symbol) || (['FREE'].includes(t.type)) ? '' : price(t.price)}</td><td class="r num">${t.fee ? price(t.fee) : ''}</td>
        <td>${esc(t.currency)}</td><td class="r num">${t.currency !== 'TRY' ? num(t.fx_rate, 4) : ''}</td><td class="r num">${total == null ? '' : money(total, 'TRY', 2)}</td>
        <td>${esc(t.platform || '')}</td><td class="muted">${esc(t.strategy || '')}</td><td class="muted" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(t.notes || '')}</td>
        <td style="white-space:nowrap"><button class="ghost" data-edit="${t.id}" title="Bu işlemi düzenle">Düzenle</button> <button class="ghost" data-dup="${t.id}" title="Kopyasını oluştur">Kopyala</button> <button class="ghost" data-del="${t.id}" title="Bu işlemi sil">Sil</button></td></tr>`;
    }).join('') || '<tr><td colspan="13" class="empty">Kayıt yok</td></tr>'}</tbody></table></div>
    ${txs.length >= txLimit ? '<button class="ghost" id="txMore" style="margin:10px auto;display:block">Daha fazla yükle</button>' : ''}</div>`;
  if (focused) { const el = $(`#txFilters [name="${focused}"]`); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } }
  const refilter = debounce(() => { txFilter = Object.fromEntries([...$$('#txFilters [name]')].map((x) => [x.name, x.value.trim()])); txLimit = 300; renderTx(); }, 350);
  $$('#txFilters [name]').forEach((x) => x.addEventListener('input', refilter));
  $('#txMore')?.addEventListener('click', () => { txLimit += 300; renderTx(); });
  $$('[data-edit]', body).forEach((b) => b.onclick = () => openTxModal(txs.find((t) => t.id === Number(b.dataset.edit))));
  $$('[data-dup]', body).forEach((b) => b.onclick = () => { const { id, ...rest } = txs.find((t) => t.id === Number(b.dataset.dup)); openTxModal({ ...rest, date: today() }); });
  $$('[data-del]', body).forEach((b) => b.onclick = async () => {
    if (!(await confirmBox('Bu işlem silinsin mi?', { ok: 'Sil', danger: true }))) return;
    await api(`/transactions/${b.dataset.del}`, { method: 'DELETE' });
  });
}

// ── Dağılım ───────────────────────────────────────
function renderDist() {
  if (isEmpty()) return emptyState();
  const d = data.distribution;
  const block = (id, title, items) => `<div class="card"><h3>${title}</h3><div class="chart-box md"><canvas id="${id}"></canvas></div>
    <table class="t" style="margin-top:8px"><tbody>${items.map((x) => `<tr><td>${esc(x.key)}</td><td class="r num">${money(x.value)}</td><td class="r num">${num(x.pct, 1)}%</td></tr>`).join('')}</tbody></table></div>`;
  body.innerHTML = `<div class="grid g4" style="margin-bottom:12px">
      ${kpi('ETKİN POZİSYON SAYISI', num(d.concentration.effectiveN, 1), '1 / HHI')}
      ${kpi('İLK 5 AĞIRLIK', `${num(d.concentration.top5Pct, 1)}%`)}
      ${kpi('HHI', num(d.concentration.hhi, 3), d.concentration.hhi > 0.25 ? '<span class="down">Yüksek yoğunlaşma</span>' : d.concentration.hhi > 0.15 ? 'Orta yoğunlaşma' : '<span class="up">Dağınık</span>')}
      ${kpi('EN BÜYÜK POZİSYON', esc(data.totals.largest?.symbol || '—'), data.totals.largest ? `${num(data.totals.largest.weight, 1)}%` : '')}
    </div>
    <div class="card strip" style="margin-bottom:12px" title="Altın, döviz, kripto, emtia, döviz cinsi hisseler ve döviz nakit: TL değer kaybına karşı doğal korunma sağlayan kısım">
      TL dışı / korunaklı pay <b>${num(d.nonTl?.pct || 0, 1)}%</b> <span class="dim">(${money(d.nonTl?.value || 0)})</span> · TL varlıklar ${num(100 - (d.nonTl?.pct || 0), 1)}%
      <div class="bar" style="margin-top:6px;display:flex"><i style="width:${Math.min(d.nonTl?.pct || 0, 100)}%;background:var(--accent)"></i></div></div>
    <div class="grid g2">${block('dAsset', 'VARLIK SINIFI', d.byAsset)}${block('dSector', 'SEKTÖR BAZINDA', d.bySector)}${block('dCur', 'PARA BİRİMİ MARUZİYETİ', d.byCurrency)}${block('dCountry', 'ÜLKE / PİYASA', d.byCountry || [])}${block('dPlat', 'PLATFORMLAR', d.byPlatform)}</div>
    <div class="card" style="margin-top:12px"><h3>SEMBOL AĞIRLIKLARI</h3><div class="chart-box md"><canvas id="dSym"></canvas></div></div>`;
  doughnut($('#dAsset'), d.byAsset); doughnut($('#dSector'), d.bySector); doughnut($('#dCur'), d.byCurrency); doughnut($('#dCountry'), d.byCountry || []); doughnut($('#dPlat'), d.byPlatform);
  const colors = palette();
  makeChart($('#dSym'), { type: 'bar', data: { labels: d.bySymbol.map((x) => x.key), datasets: [{ label: 'Ağırlık %', data: d.bySymbol.map((x) => x.pct), backgroundColor: d.bySymbol.map((_, i) => colors[i % colors.length]) }] }, options: baseOptions({ time: false }) });
}

// ── Temettü ───────────────────────────────────────
async function renderDiv() {
  body.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  const d = await api('/portfolio/dividends');
  if (tab !== 'temettu') return;
  const months = [];
  for (let i = 11; i >= 0; i--) { const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i); months.push(dt.toISOString().slice(0, 7)); }
  const upNet = d.upcoming.reduce((a, x) => a + x.net, 0);
  body.innerHTML = `<div class="grid g4">
      ${kpi('TOPLAM ALINAN (NET)', money(d.total))}${kpi('SON 12 AY', money(d.last12), `aylık ort. ${money(d.monthlyAvg)}`)}
      ${kpi('BEKLENEN YILLIK (NET)', money(d.expectedAnnual), `stopaj %${num(d.taxRate * 100, 0)} · son 12 ay hisse başı temettüye göre`)}${kpi('PORTFÖY TEMETTÜ VERİMİ (BRÜT)', pct(d.portfolioYieldPct, 2, false))}
    </div>
    <div class="card" style="margin-top:12px"><h3>İLAN EDİLMİŞ YAKLAŞAN TEMETTÜLER <span class="dim" style="font-weight:400">İş Yatırım · tahmini net ${money(upNet)}</span></h3>
      <table class="t"><thead><tr><th>Tarih</th><th>Sembol</th><th class="r">Hisse başı brüt</th><th class="r">Adet</th><th class="r">Brüt</th><th class="r">Net (tahmini)</th><th class="r">Verim</th><th>Diğer</th></tr></thead>
      <tbody>${d.upcoming.map((x) => `<tr class="click" data-s="${esc(x.symbol)}"><td>${dateTR(x.date)}</td><td class="mono"><b>${esc(x.symbol)}</b></td><td class="r num">${x.dpsGross ? num(x.dpsGross, 4) : '—'}</td><td class="r num">${num(x.qty, 0)}</td><td class="r num">${money(x.gross, 'TRY', 2)}</td><td class="r num">${money(x.net, 'TRY', 2)}</td><td class="r num">${pct(x.yieldPct, 2, false)}</td><td class="muted">${[x.bonusPct ? `Bedelsiz %${num(x.bonusPct, 2)}` : '', x.rightsPct ? `Bedelli %${num(x.rightsPct, 2)}` : ''].filter(Boolean).join(' · ')}</td></tr>`).join('') || '<tr><td colspan="8" class="dim">Portföyünüzdeki hisseler için ilan edilmiş yaklaşan temettü yok</td></tr>'}</tbody></table></div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>AYLIK GELİR (SON 12 AY)</h3><div class="chart-box md"><canvas id="divM"></canvas></div></div>
      <div class="card"><h3>YILLIK</h3><div class="chart-box md"><canvas id="divY"></canvas></div></div>
    </div>
    ${Object.keys(d.breakdown || {}).length ? `<div class="card" style="margin-top:12px"><h3>GELİR KIRILIMI <select id="divYear" style="font-weight:400;margin-left:8px">${Object.keys(d.breakdown).sort().reverse().map((y) => `<option>${y}</option>`).join('')}</select></h3><div class="grid g3" id="divBreak"></div></div>` : ''}
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>BEKLENEN TEMETTÜLER (TAHMİN)</h3><table class="t"><thead><tr><th>Sembol</th><th class="r">Hisse başı (12A)</th><th class="r">Adet</th><th class="r">Yıllık brüt ₺</th><th class="r">Net ₺</th><th class="r">Verim</th><th class="r">Maliyete göre</th></tr></thead>
        <tbody>${d.expected.map((x) => `<tr class="click" data-s="${esc(x.symbol)}" title="Son ödemeler: ${esc(x.lastDates.join(', '))}"><td class="mono"><b>${esc(x.symbol)}</b></td><td class="r num">${num(x.dps, 4)}</td><td class="r num">${num(x.qty, 0)}</td><td class="r num">${money(x.annualGross)}</td><td class="r num">${money(x.annualNet)}</td><td class="r num">${pct(x.yieldPct, 2, false)}</td><td class="r num">${pct(x.yieldOnCostPct, 2, false)}</td></tr>`).join('') || '<tr><td colspan="7" class="dim">Veri yok</td></tr>'}</tbody></table></div>
      <div class="card"><h3>ALINAN TEMETTÜLER</h3><div class="table-wrap" style="max-height:360px"><table class="t"><thead><tr><th>Tarih</th><th>Sembol</th><th>Tür</th><th>Platform</th><th class="r">Brüt</th><th class="r">Stopaj</th><th class="r">Net ₺</th></tr></thead>
        <tbody>${d.items.map((x) => `<tr><td>${dateTR(x.date)}</td><td class="mono">${esc(x.symbol)}</td><td>${x.type === 'DRIP' ? 'DRIP' : 'Nakit'}</td><td>${esc(x.platform || '')}</td><td class="r num">${money(x.gross, 'TRY', 2)}</td><td class="r num">${x.tax ? money(x.tax, 'TRY', 2) : ''}</td><td class="r num">${money(x.amount, 'TRY', 2)}</td></tr>`).join('') || '<tr><td colspan="7" class="dim">Henüz temettü kaydı yok. İşlem ekle → Nakit temettü.</td></tr>'}</tbody></table></div></div>
    </div>`;
  makeChart($('#divM'), { type: 'bar', data: { labels: months, datasets: [{ label: 'Temettü ₺', data: months.map((m) => d.monthly[m] || 0), backgroundColor: css('--accent') }] }, options: baseOptions({ time: false }) });
  const years = Object.keys(d.yearly).sort();
  makeChart($('#divY'), { type: 'bar', data: { labels: years, datasets: [{ label: 'Temettü ₺', data: years.map((y) => d.yearly[y]), backgroundColor: css('--info') }] }, options: baseOptions({ time: false }) });
  const drawBreak = () => {
    const b = d.breakdown[$('#divYear').value] || {};
    const tbl = (title, obj) => {
      const rows = Object.entries(obj || {}).sort((x, y) => y[1] - x[1]);
      const tot = rows.reduce((a, [, v]) => a + v, 0) || 1;
      return `<div><div class="mini-head">${title}</div><table class="t"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r num">${money(v)}</td><td class="r num">${num((v / tot) * 100, 1)}%</td></tr>`).join('') || '<tr><td class="dim">—</td></tr>'}</tbody></table></div>`;
    };
    $('#divBreak').innerHTML = tbl('SEKTÖR', b.bySector) + tbl('VARLIK SINIFI', b.byAsset) + tbl('ÜLKE', b.byCountry);
  };
  if ($('#divYear')) { $('#divYear').onchange = drawBreak; drawBreak(); }
  $$('tr[data-s]', body).forEach((r) => r.onclick = () => selectSymbol(r.dataset.s));
}

// ── Risk & performans ─────────────────────────────
async function renderRisk() {
  body.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="row">
      <span class="mini-head" style="margin:0">DÖNEM</span>
      <input type="date" id="rFrom" value="${esc(riskRange.from)}" title="Başlangıç"><span>–</span><input type="date" id="rTo" value="${esc(riskRange.to)}" title="Bitiş">
      <span class="seg" id="rQuick"><button data-q="all">Tümü</button><button data-q="ytd">YBB</button><button data-q="1y">1Y</button><button data-q="6m">6A</button><button data-q="3m">3A</button></span>
      <button class="btn sec" id="rApply">Uygula</button></div></div><div id="riskBody"><div class="skeleton" style="height:200px"></div></div>`;
  const setRange = (from, to) => { riskRange = { from, to }; localSet('pfRange', riskRange); renderRisk(); };
  $('#rApply').onclick = () => setRange($('#rFrom').value, $('#rTo').value);
  $('#rQuick').onclick = (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const d = new Date();
    const iso = (x) => x.toISOString().slice(0, 10);
    const map = { all: ['', ''], ytd: [`${d.getFullYear()}-01-01`, ''], '1y': [iso(new Date(Date.now() - 365 * 864e5)), ''], '6m': [iso(new Date(Date.now() - 182 * 864e5)), ''], '3m': [iso(new Date(Date.now() - 91 * 864e5)), ''] };
    setRange(...map[b.dataset.q]);
  };
  let r;
  try { r = await getRisk(riskRange, true); } catch (e) { $('#riskBody').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
  if (tab !== 'risk') return;
  const rb = $('#riskBody');
  if (!r.enough) { rb.innerHTML = '<div class="card empty">Seçili dönem için yeterli veri yok. Risk metrikleri için işlem geçmişi veya içe aktarılmış anlık görüntü gerekir.</div>'; return; }
  const m = r.metrics;
  const f2 = (x) => (x == null ? '—' : num(x, 2));
  rb.innerHTML = `<div class="grid g4">
      ${kpi('TOPLAM GETİRİ (TWR)', pct(m.totalReturnPct), `${dateTR(r.start)} – ${dateTR(r.end)} · ${r.days} gün`, cls(m.totalReturnPct), 'Zaman ağırlıklı getiri: para giriş/çıkışlarından arındırılmış')}
      ${kpi('GERÇEK GETİRİ (XIRR)', pct(m.xirrPct), 'para ağırlıklı, yıllık', cls(m.xirrPct), 'Nakit akışlarının zamanlamasını hesaba katan yıllık iç verim oranı')}
      ${kpi('CAGR', m.cagrPct != null ? pct(m.cagrPct) : '—', m.cagrPct != null ? 'yıllık bileşik' : `1 yıldan kısa · yıllıklandırılmış ${pct(m.annualizedPct)}`, cls(m.cagrPct))}
      ${kpi('VOLATİLİTE (YILLIK)', pct(m.volatilityPct, 1, false))}
      ${kpi('MAKS DÜŞÜŞ', pct(m.maxDrawdownPct), `Güncel düşüş: ${pct(m.currentDrawdownPct)}`, 'down')}
      ${kpi('SHARPE', f2(m.sharpe), `risksiz faiz %${num(m.riskFreeRatePct, 1)}${m.riskFreeSource?.startsWith('TLREF') ? ' (TLREF ort.)' : ''}`, '', m.riskFreeSource ? `Risksiz faiz: ${m.riskFreeSource}` : '')}
      ${kpi('SORTINO', f2(m.sortino))}
      ${kpi('CALMAR', f2(m.calmar))}
      ${kpi('BETA / KORELASYON', `${f2(m.beta)} / ${f2(m.correlation)}`, `kıyas: ${esc(r.benchmarks?.[m.benchmark]?.label || m.benchmark || '—')}`)}
      ${kpi('DEVİR HIZI (YILLIK)', pct(m.turnoverPct, 0, false), 'min(alış, satış) / ort. değer')}
      ${kpi('EN İYİ / KÖTÜ AY', `${m.bestMonth ? pct(m.bestMonth.pct, 1) : '—'} / ${m.worstMonth ? pct(m.worstMonth.pct, 1) : '—'}`, `${m.bestMonth?.month || ''} · ${m.worstMonth?.month || ''}`)}
      ${kpi('POZİTİF AY / EN İYİ-KÖTÜ GÜN', `${pct(m.positiveMonthsPct, 0, false)}`, `${pct(m.bestDayPct, 1)} / ${pct(m.worstDayPct, 1)}`)}
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>DÖNEM ANALİZİ</h3><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(90px,1fr))">${Object.entries(r.periods).map(([k, v]) => `<div class="kpi"><div class="l">${esc(k)}</div><div class="v ${cls(v)}" style="font-size:16px">${pct(v)}</div></div>`).join('')}</div></div>
      <div class="card"><h3>KIYASLAR (AYNI DÖNEM, TL)</h3><table class="t"><tbody><tr><td><b>Portföy (TWR)</b></td><td class="r num ${cls(m.totalReturnPct)}"><b>${pct(m.totalReturnPct)}</b></td><td></td></tr>${Object.entries(r.benchmarks || {}).map(([, b]) => `<tr><td>${esc(b.label)}</td><td class="r num ${cls(b.returnPct)}">${pct(b.returnPct)}</td><td class="r num ${cls(m.totalReturnPct - b.returnPct)}" title="Portföy − kıyas">${b.returnPct != null ? pct(m.totalReturnPct - b.returnPct) + ' fark' : ''}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>BÜYÜME (BAŞLANGIÇ = 100) <span class="seg" id="perfMode"><button data-m="level" class="active">Endeks</button><button data-m="value">Değer ₺</button></span></h3><div class="row" id="rbenchToggles" style="margin-bottom:6px"></div><div class="chart-box md"><canvas id="rPerf"></canvas></div></div>
      <div class="card"><h3>DÜŞÜŞ (DRAWDOWN)</h3><div class="chart-box md"><canvas id="rDD"></canvas></div></div>
    </div>
    <div class="card" style="margin-top:12px"><h3>AYLIK GETİRİLER</h3><div id="monthly"></div></div>
    <div class="card" style="margin-top:12px"><h3>ÇEYREKLİK GETİRİ (TWR, %)</h3><div class="chart-box sm"><canvas id="rQuarter"></canvas></div></div>`;
  perfChart($('#rPerf'), 'level', false, riskRange);
  $('#perfMode').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; $$('#perfMode button').forEach((x) => x.classList.toggle('active', x === b)); perfChart($('#rPerf'), b.dataset.m, false, riskRange); };
  makeChart($('#rDD'), { type: 'line', data: { datasets: [{ label: 'Düşüş %', data: r.drawdown.map((p) => ({ x: p.date, y: p.dd })), borderColor: css('--down'), borderWidth: 1.2, pointRadius: 0, fill: { target: 'origin', below: css('--down') + '22' } }] }, options: baseOptions() });
  const qk = Object.keys(r.quarterly || {});
  if (qk.length) {
    const qv = qk.map((k) => r.quarterly[k]);
    makeChart($('#rQuarter'), { type: 'bar', data: { labels: qk, datasets: [{ label: 'Çeyreklik getiri %', data: qv, backgroundColor: qv.map((v) => (v >= 0 ? css('--up') : css('--down')) + 'cc') }] }, options: baseOptions({ time: false }) });
  } else $('#rQuarter').parentElement.innerHTML = '<div class="empty">Çeyreklik veri yok</div>';
  const years = [...new Set(Object.keys(r.monthly).map((k) => k.slice(0, 4)))].sort().reverse();
  const MN = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const cell = (v) => (v == null ? '<div></div>' : `<div style="background:${v >= 0 ? `rgba(34,197,94,${Math.min(Math.abs(v) / 10, 1) * 0.5 + 0.08})` : `rgba(239,68,68,${Math.min(Math.abs(v) / 10, 1) * 0.5 + 0.08})`}">${num(v, 1)}</div>`);
  $('#monthly').innerHTML = `<div class="table-wrap"><div class="monthly-grid"><div class="h">Yıl</div>${MN.map((x) => `<div class="h">${x}</div>`).join('')}<div class="h">Yıl</div>
    ${years.map((y) => {
      const vals = MN.map((_, i) => r.monthly[`${y}-${String(i + 1).padStart(2, '0')}`]);
      const yr = vals.filter((v) => v != null).reduce((a, v) => a * (1 + v / 100), 1) - 1;
      return `<div class="h">${y}</div>${vals.map(cell).join('')}${cell(yr * 100)}`;
    }).join('')}</div></div>`;
}

// ── İçe / dışa aktarma ────────────────────────────
function renderImport() {
  body.innerHTML = `<div class="grid g2">
    <div class="card"><h3>CSV İÇE AKTARMA (İŞLEMLER)</h3>
      <p class="muted">Sütunlar (Türkçe veya İngilizce başlık): <span class="mono">tarih, işlem, sembol, adet, fiyat, komisyon, para birimi, kur, platform, hedef platform, hedef para birimi, hedef tutar, varlık tipi, strateji, not</span>.
      İşlem tipleri: Alış, Satış, Temettü, DRIP, Bölünme/Bedelsiz, Maliyetsiz, Staking, Transfer, Döviz çevrimi, Yatırma, Çekme, Masraf, Faiz (İngilizce aksiyon kodları da tanınır: CASH_IN, CASH_OUT, CASH_DIVIDEND, COMMISSION…). Sayılar 1.234,56 veya 1234.56; tarih GG.AA.YYYY veya YYYY-AA-GG.</p>
      <div class="dropzone" id="csvDrop">CSV dosyası seçin veya buraya sürükleyin<input type="file" id="csvFile" accept=".csv,.txt,text/csv" hidden></div>
      <div class="row" style="margin-top:8px"><button class="ghost" id="csvSample">Örnek CSV indir</button></div>
      <div id="csvPreview" style="margin-top:10px"></div></div>
    <div class="card"><h3>GEÇMİŞ VERİ İÇE AKTAR (ANLIK GÖRÜNTÜ)</h3>
      <p class="muted">İşlem geçmişi olmayan dönemler için günlük/aylık portföy değerleri: <span class="mono">tarih, değer[, net_yatırılan]</span>. Risk metriklerinde ilk işlemden önceki dönem için kullanılır.</p>
      <div class="dropzone" id="snapDrop">Geçmiş veri CSV dosyası seçin<input type="file" id="snapFile" accept=".csv,.txt" hidden></div>
      <div id="snapInfo" class="muted" style="margin-top:8px"></div>
      <button class="ghost" id="snapClear" style="margin-top:6px">İçe aktarılmış anlık görüntüleri sil</button></div>
    <div class="card"><h3>DIŞA AKTAR & YEDEK</h3>
      <div class="row"><a class="btn sec" href="/api/export/transactions.csv" download>İşlemleri CSV indir</a><a class="btn sec" href="/api/export/backup.json" download>Tam yedek (JSON)</a></div>
      <p class="muted" style="margin-top:10px">Yedekten geri yükleme mevcut tüm portföy, izleme listesi, zamanlanmış görev ve ayarların üzerine yazar.</p>
      <div class="dropzone" id="bakDrop">Yedek JSON dosyası seçin<input type="file" id="bakFile" accept=".json" hidden></div></div>
  </div>`;
  const wire = (dropId, fileId, handler) => {
    const dz = $(dropId), fi = $(fileId);
    dz.onclick = () => fi.click();
    fi.onchange = () => fi.files[0] && fi.files[0].text().then(handler);
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); e.dataTransfer.files[0]?.text().then(handler); };
  };
  // CSV: otomatik sütun algılama + elle eşleştirme + mükerrer satırları atlama
  let csvText = '', csvMap = null;
  const csvPreview = async () => {
    try {
      const p = await api('/import/csv/preview', { method: 'POST', body: { text: csvText, mapping: csvMap } });
      const opt = (f) => `<select data-map="${f}"><option value="-1">— yok —</option>${p.headers.map((hd, i) => `<option value="${i}" ${p.mapping[f] === i ? 'selected' : ''}>${esc(hd || `Sütun ${i + 1}`)}</option>`).join('')}</select>`;
      const mapUi = `<details ${p.missing.length || p.invalid ? 'open' : ''} style="margin-bottom:8px"><summary class="${p.missing.length ? 'down' : 'dim'}">${p.missing.length ? `Zorunlu sütun eşleştirilmedi: ${esc(p.missing.map((f) => p.fields[f]).join(', '))}` : 'Sütun eşleştirmesi (otomatik algılandı; değiştirebilirsiniz)'}</summary>
        <div class="form-grid" style="margin-top:6px">${Object.entries(p.fields).map(([f, l]) => `<div class="field"><label>${esc(l)}${['date', 'type'].includes(f) ? ' *' : ''}</label>${opt(f)}</div>`).join('')}</div>
        <button class="btn sec" id="csvRemap" style="margin-top:6px">Yeniden önizle</button></details>`;
      $('#csvPreview').innerHTML = mapUi + (p.missing.length ? '' : `<div class="row between"><span>${p.valid} içe aktarılacak, <span class="${p.invalid ? 'down' : ''}">${p.invalid} hatalı</span>${p.duplicates ? `, <span class="accent">${p.duplicates} zaten kayıtlı (atlanacak)</span>` : ''} satır</span><button class="btn" id="csvCommit" ${p.valid ? '' : 'disabled'}>${p.valid} işlemi içe aktar</button></div>
        <div class="table-wrap" style="max-height:300px;margin-top:8px"><table class="t"><thead><tr><th>Satır</th><th>Tarih</th><th>Tip</th><th>Sembol</th><th class="r">Adet</th><th class="r">Fiyat</th><th>Platform</th><th>Durum</th></tr></thead>
        <tbody>${p.rows.map((r) => `<tr><td>${r.line}</td><td>${esc(r.tx.date || '?')}</td><td>${esc(state.meta.txTypes[r.tx.type] || r.tx.type)}</td><td class="mono">${esc(r.tx.symbol || '')}</td><td class="r num">${r.tx.quantity ?? ''}</td><td class="r num">${r.tx.price ?? ''}</td><td>${esc(r.tx.platform || '')}</td><td class="${r.error ? 'err' : r.duplicate ? 'accent' : 'up'}">${esc(r.error || (r.duplicate ? 'Zaten kayıtlı' : 'OK'))}</td></tr>`).join('')}</tbody></table></div>`);
      $('#csvRemap').onclick = () => { csvMap = Object.fromEntries($$('[data-map]', $('#csvPreview')).map((x) => [x.dataset.map, Number(x.value)])); csvPreview(); };
      const c = $('#csvCommit');
      if (c) c.onclick = async () => {
        try {
          const r = await api('/import/csv/commit', { method: 'POST', body: { text: csvText, mapping: csvMap } });
          toast(`${r.imported} işlem içe aktarıldı${r.duplicates ? `, ${r.duplicates} mükerrer atlandı` : ''}${r.skipped ? `, ${r.skipped} satır hatalı` : ''}`, 'ok');
          $('#csvPreview').innerHTML = r.errors?.length ? `<div class="err">${r.errors.map((e) => `Satır ${e.line}: ${esc(e.error)}`).join('<br>')}</div>` : '';
        } catch (e) { toast(e.message, 'err'); }
      };
    } catch (e) { $('#csvPreview').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
  wire('#csvDrop', '#csvFile', (text) => { csvText = text; csvMap = null; csvPreview(); });
  $('#csvSample').onclick = () => {
    const csv = 'tarih;işlem;sembol;adet;fiyat;komisyon;para birimi;platform;hedef platform;hedef para birimi;hedef tutar;not\n'
      + '02.01.2025;Yatırma;;;100.000,00;;TRY;Kurum A;;;;ilk para\n03.01.2025;Alış;THYAO;100;285,50;25;TRY;Kurum A;;;;\n'
      + '15.05.2025;Temettü;THYAO;;1.250,00;187,50;TRY;Kurum A;;;;stopaj komisyon sütununda\n01.07.2025;Satış;THYAO;40;310,00;12;TRY;Kurum A;;;;\n'
      + '10.07.2025;Döviz çevrimi;;;20.000,00;;TRY;Kurum A;;USD;500;\n12.07.2025;Transfer;THYAO;20;;;TRY;Kurum A;Kurum B;;;virman\n';
    const a = h('<a download="ornek-islemler.csv"></a>'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.click();
  };
  const snapInfo = async () => { const s = await api('/snapshots'); const imp = s.filter((x) => x.source === 'import'); if ($('#snapInfo')) $('#snapInfo').textContent = `${s.length} anlık görüntü (${imp.length} içe aktarılmış, ${s.length - imp.length} otomatik)`; };
  snapInfo();
  wire('#snapDrop', '#snapFile', async (text) => { try { const r = await api('/import/snapshots', { method: 'POST', body: { text } }); toast(`${r.imported} anlık görüntü içe aktarıldı`, 'ok'); snapInfo(); riskCache.clear(); } catch (e) { toast(e.message, 'err'); } });
  $('#snapClear').onclick = async () => { if (await confirmBox('İçe aktarılmış anlık görüntüler silinsin mi?', { danger: true, ok: 'Sil' })) { await api('/snapshots', { method: 'DELETE' }); snapInfo(); riskCache.clear(); } };
  wire('#bakDrop', '#bakFile', async (text) => {
    if (!(await confirmBox('Yedek geri yüklensin mi? Mevcut veriler silinecek.', { danger: true, ok: 'Geri yükle' }))) return;
    try { await api('/import/backup', { method: 'POST', body: JSON.parse(text) }); toast('Yedek geri yüklendi', 'ok'); } catch (e) { toast(e.message, 'err'); }
  });
}

// ── Portföy ayarları ──────────────────────────────
async function renderSettings() {
  const [plats, strats, syms, ref] = await Promise.all([api('/platforms'), api('/strategies'), api('/symbols'), api('/portfolio/reference')]);
  if (tab !== 'ayarlar') return;
  const s = state.settings;
  const benchSel = new Set(s.benchmarks || []);
  body.innerHTML = `<div class="grid g2">
    <div class="card"><h3>PLATFORMLAR (ARACI KURUM / HESAP)</h3>
      <table class="t"><tbody>${plats.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.currency)}</td><td class="muted">${esc(p.notes || '')}</td><td class="r"><button class="ghost" data-dp="${p.id}">Kaldır</button></td></tr>`).join('') || '<tr><td class="dim">Platform yok</td></tr>'}</tbody></table>
      <form class="row" id="platForm" style="margin-top:8px"><input name="name" placeholder="Platform adı" required><select name="currency">${ref.currencies.map((c) => `<option>${c}</option>`).join('')}</select><input name="notes" placeholder="Not"><button class="btn">Ekle</button></form></div>
    <div class="card"><h3>STRATEJİLER</h3>
      <table class="t"><tbody>${strats.map((x) => `<tr><td>${esc(x.name)}</td><td class="muted">${esc(x.description || '')}</td><td class="r"><button class="ghost" data-ds="${x.id}">Kaldır</button></td></tr>`).join('') || '<tr><td class="dim">Strateji yok (ör. Ana, Temettü, HODL, Kısa vade)</td></tr>'}</tbody></table>
      <form class="row" id="stratForm" style="margin-top:8px"><input name="name" placeholder="Strateji adı" required><input name="description" placeholder="Açıklama"><button class="btn">Ekle</button></form></div>
    <div class="card"><h3>SEMBOL SEKTÖR / SINIF / ELLE FİYAT</h3>
      <p class="muted">BIST sektörleri İş Yatırım sınıflandırmasından gelir; burada girilen değer önceliklidir.</p>
      <table class="t"><thead><tr><th>Sembol</th><th>Sektör</th><th>Sınıf</th><th class="r">Elle fiyat</th><th></th></tr></thead><tbody>${syms.map((x) => `<tr><td class="mono">${esc(x.symbol)}</td><td>${esc(x.sector || '')}</td><td>${esc(ref.assetTypes[x.asset_type] || '')}</td><td class="r num">${x.manual_price != null ? `${price(x.manual_price)} <span class="dim">${dateTR(x.manual_price_at)}</span>` : ''}</td><td class="r">${x.manual_price != null ? `<button class="ghost" data-mp="${esc(x.symbol)}">Fiyat</button>` : ''}</td></tr>`).join('') || '<tr><td class="dim" colspan="5">Özel tanım yok</td></tr>'}</tbody></table>
      <form class="row" id="symForm" style="margin-top:8px"><input name="symbol" placeholder="Sembol" required style="width:100px"><input name="sector" placeholder="Sektör"><select name="asset_type"><option value="">Sınıf (değiştirme)</option>${Object.entries(ref.assetTypes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><button class="btn">Kaydet</button></form></div>
    <div class="card"><h3>HESAPLAMA</h3>
      <div class="form-grid">
        <div class="field"><label>RİSKSİZ FAİZ KAYNAĞI (SHARPE / SORTINO)</label><select id="rfSrc"><option value="tlref">TLREF dönem ortalaması (Borsa İstanbul, otomatik)</option><option value="sabit">Sabit oran</option></select></div>
        <div class="field"><label>SABİT RİSKSİZ FAİZ (YILLIK %)</label><input id="rf" type="number" step="0.01"></div>
        <div class="field"><label>TEMETTÜ STOPAJI (%)</label><input id="dtax" type="number" step="0.01" value="${(s.dividendTaxRate ?? 0.15) * 100}"></div>
        <div class="field"><label>ANA KIYAS (BETA)</label><select id="bench">${Object.entries(ref.benchmarks).map(([k, v]) => `<option value="${k}" ${k === (s.benchmark || 'XU100') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      </div>
      <div class="mini-head" style="margin-top:10px">KARŞILAŞTIRMA SERİLERİ</div>
      <div class="row">${Object.entries(ref.benchmarks).map(([k, v]) => `<label class="pill"><input type="checkbox" data-bm="${k}" ${benchSel.has(k) ? 'checked' : ''} style="margin:0 4px 0 0;vertical-align:-1px">${esc(v)}</label>`).join('')}</div>
      <button class="btn" id="calcSave" style="margin-top:10px">Kaydet</button>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <h3>SUNUCU VERİLERİNİ SIFIRLA</h3>
      <p class="muted">Tüm işlemler, platformlar, stratejiler ve anlık görüntüler silinir. Geri alınamaz; önce yedek alın.</p>
      <button class="btn danger" id="pfReset">Portföyü sıfırla</button></div>
    <div class="card" style="grid-column:1/-1"><h3>REFERANS TABLOLARI — AKSİYON TİPLERİ</h3>
      <table class="t"><thead><tr><th>Kod</th><th>Aksiyon</th><th class="r">Miktar etkisi</th><th class="r">Nakit etkisi</th><th>Gelir</th><th>Gerekli alanlar</th></tr></thead>
      <tbody>${ref.actions.map((a) => `<tr><td class="mono">${a.code}</td><td>${esc(a.label)}</td><td class="r num">${a.qty > 0 ? '+' : a.qty < 0 ? '−' : '0'}</td><td class="r num">${a.cash > 0 ? '+' : a.cash < 0 ? '−' : '0'}</td><td>${a.income ? '✓' : ''}</td><td class="muted">${esc(a.needs.join(', '))}</td></tr>`).join('')}</tbody></table>
      <div class="row" style="margin-top:10px"><span class="mini-head" style="margin:0">VARLIK SINIFLARI</span>${Object.values(ref.assetTypes).map((v) => `<span class="pill">${esc(v)}</span>`).join('')}<span class="mini-head" style="margin:0 0 0 12px">PARA BİRİMLERİ</span>${ref.currencies.map((v) => `<span class="pill">${esc(v)}</span>`).join('')}</div></div>
  </div>`;
  const formObj = (f) => Object.fromEntries(new FormData(f));
  $('#platForm').onsubmit = async (e) => { e.preventDefault(); try { await api('/platforms', { method: 'POST', body: formObj(e.target) }); renderSettings(); } catch (x) { toast(x.message, 'err'); } };
  $('#stratForm').onsubmit = async (e) => { e.preventDefault(); try { await api('/strategies', { method: 'POST', body: formObj(e.target) }); renderSettings(); } catch (x) { toast(x.message, 'err'); } };
  $('#symForm').onsubmit = async (e) => { e.preventDefault(); const o = formObj(e.target); await api(`/symbols/${encodeURIComponent(o.symbol)}`, { method: 'POST', body: { sector: o.sector || null, asset_type: o.asset_type || null } }); load(); renderSettings(); };
  $$('[data-dp]', body).forEach((b) => b.onclick = async () => { if (await confirmBox('Platform kaldırılsın mı? İşlemler platformsuz kalır.', { danger: true })) { await api(`/platforms/${b.dataset.dp}`, { method: 'DELETE' }); renderSettings(); } });
  $$('[data-ds]', body).forEach((b) => b.onclick = async () => { await api(`/strategies/${b.dataset.ds}`, { method: 'DELETE' }); renderSettings(); });
  $$('[data-mp]', body).forEach((b) => b.onclick = () => openPriceModal(b.dataset.mp));
  $('#rf').value = String(Math.round((s.riskFreeRate ?? 0.4) * 10000) / 100);
  $('#rfSrc').value = s.riskFreeSource || 'tlref';
  $('#calcSave').onclick = async () => {
    const benchmarks = $$('[data-bm]', body).filter((c) => c.checked).map((c) => c.dataset.bm);
    await api('/settings', { method: 'PUT', body: { riskFreeRate: Number($('#rf').value) / 100, riskFreeSource: $('#rfSrc').value, dividendTaxRate: Number($('#dtax').value) / 100, benchmark: $('#bench').value, benchmarks } });
    riskCache.clear(); toast('Kaydedildi', 'ok');
  };
  $('#pfReset').onclick = () => {
    const m = modal({ title: 'Portföyü sıfırla', body: '<p>Onaylamak için <b class="mono">SIFIRLA</b> yazın.</p><input id="rsTxt" style="width:100%">', footer: '<button class="btn sec" data-close>İptal</button><button class="btn danger" id="rsGo">Sıfırla</button>' });
    $('#rsGo', m.el).onclick = async () => { try { await api('/portfolio/reset', { method: 'POST', body: { confirm: $('#rsTxt', m.el).value.trim() } }); m.close(); toast('Portföy sıfırlandı', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  };
}

// ── İşlem ekleme / düzenleme penceresi ───────────
export async function openTxModal(init = {}) {
  const [plats, strats] = await Promise.all([api('/platforms').catch(() => []), api('/strategies').catch(() => [])]);
  const M = state.meta, T = M.txTypes, A = M.assetTypes, CUR = M.currencies || ['TRY', 'USD', 'EUR'];
  const editing = !!init.id;
  const v = { date: today(), type: 'BUY', fee: 0, currency: '', ...init };
  const m = modal({
    title: editing ? 'İşlemi düzenle' : 'İşlem ekle',
    body: `<form id="txForm" class="form-grid">
      <div class="field"><label>AKSİYON</label><select name="type">${Object.entries(T).map(([k, l]) => `<option value="${k}" ${v.type === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>TARİH</label><input type="date" name="date" value="${esc(v.date)}" max="${today()}" required></div>
      <div class="field" data-f="symbol"><label id="symLbl">SEMBOL</label><input name="symbol" value="${esc(v.symbol || '')}" placeholder="THYAO, AAPL.US, GRAM, fon kodu…" autocomplete="off"></div>
      <div class="field" data-f="asset"><label>VARLIK SINIFI</label><select name="asset_type"><option value="">Otomatik</option>${Object.entries(A).map(([k, l]) => `<option value="${k}" ${v.asset_type === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field" data-f="qty"><label id="qtyLbl">MİKTAR</label><input type="number" step="any" name="quantity" value="${v.quantity ?? ''}"></div>
      <div class="field" data-f="price"><label id="priceLbl">BİRİM FİYAT</label><input type="number" step="any" name="price" value="${v.price != null ? Math.round(v.price * 1e6) / 1e6 : ''}"></div>
      <div class="field" data-f="fee"><label id="feeLbl">KOMİSYON</label><input type="number" step="any" name="fee" value="${v.fee ?? 0}"></div>
      <div class="field" data-f="cur"><label id="curLbl">PARA BİRİMİ</label><select name="currency"><option value="">Otomatik</option>${CUR.map((c) => `<option ${v.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field" data-f="fx"><label>İŞLEM GÜNÜ KURU (₺)</label><input type="number" step="any" name="fx_rate" value="${v.currency && v.currency !== 'TRY' ? v.fx_rate ?? '' : ''}" placeholder="boşsa işlem günü TCMB döviz satış kuru"></div>
      <div class="field" data-f="toCur"><label>HEDEF PARA BİRİMİ</label><select name="to_currency">${CUR.map((c) => `<option ${v.to_currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field" data-f="toAmt"><label>HEDEF TUTAR</label><input type="number" step="any" name="to_amount" value="${v.to_amount ?? ''}"></div>
      <div class="field"><label id="platLbl">PLATFORM</label><input name="platform" list="platList" value="${esc(v.platform || '')}" placeholder="Aracı kurum / hesap"><datalist id="platList">${plats.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div class="field" data-f="toPlat"><label>HEDEF PLATFORM</label><input name="to_platform" list="platList" value="${esc(v.to_platform || '')}"></div>
      <div class="field"><label>STRATEJİ</label><input name="strategy" list="stratList" value="${esc(v.strategy || '')}"><datalist id="stratList">${strats.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div class="field" style="grid-column:1/-1"><label>NOTLAR</label><input name="notes" value="${esc(v.notes || '')}"></div>
      <div style="grid-column:1/-1" class="muted" id="txTotal"></div>
      <div style="grid-column:1/-1;font-size:11px" class="dim" id="txHelp"></div>
    </form>`,
    footer: `<button class="btn sec" data-close>İptal</button><button class="btn" id="txSave">${editing ? 'Güncelle' : 'Kaydet'}</button>`,
  });
  const f = $('#txForm', m.el);
  if (v.type === 'FX_CONVERT' && !v.currency) f.currency.value = 'TRY';
  const HELP = {
    BUY: 'Alış: miktar × fiyat + komisyon, platformun nakdinden düşülür (nakit takibi açıksa).',
    SELL: 'Satış: ortalama maliyet yöntemiyle gerçekleşen K/Z hesaplanır.',
    DRIP: 'Temettünün aynı hisseye yeniden yatırımı: alınan adet × birim fiyat hem temettü geliri hem maliyet olarak kaydedilir.',
    DIVIDEND: 'Nakit temettü: tutar = brüt temettü, stopaj alanı = kesilen vergi. Net tutar nakde eklenir.',
    SPLIT: 'Bölünme / bedelsiz: oran 2 ise her 1 hisse 2 olur (%100 bedelsiz = 2). Maliyet değişmez, ortalama maliyet düşer.',
    FREE: 'Maliyetsiz edinim: hediye veya bedelsiz adet; maliyet 0 kabul edilir.',
    STAKING: 'Kripto staking ödülü: adet maliyetsiz eklenir; birim fiyat verilirse gelir olarak raporlanır.',
    TRANSFER: 'Platformlar arası virman: sembol + adet (maliyet taşınır) ya da sembolsüz nakit tutarı.',
    FX_CONVERT: 'Döviz çevrimi: kaynak tutar (para birimi) → hedef tutar (hedef para birimi). Uygulanan kur hedef/kaynak oranıdır.',
    DEPOSIT: 'Nakit girişi: net yatırılan tutarı artırır; nakit takibini açar.', WITHDRAW: 'Nakit çıkışı: net yatırılan tutarı azaltır.',
    FEE: 'Hesap işletim, saklama vb. masraflar.', INTEREST: 'Faiz geliri (mevduat, repo, para piyasası).',
  };
  const sync = () => {
    const t = f.type.value;
    if (t === 'FX_CONVERT') {
      if (!f.currency.value) f.currency.value = 'TRY';
      if (f.to_currency.value === f.currency.value) f.to_currency.value = CUR.find((c) => c !== f.currency.value && c !== 'TRY') || CUR.find((c) => c !== f.currency.value);
    }
    const need = new Set(M.txMeta?.[t]?.needs || []);
    const show = (k, on) => { const el = $(`[data-f=${k}]`, f); if (el) el.hidden = !on; };
    const amount = need.has('amount');
    show('symbol', need.has('symbol') || t === 'TRANSFER' || t === 'INTEREST');
    show('asset', ['BUY', 'FREE', 'STAKING', 'DRIP'].includes(t));
    show('qty', need.has('quantity') || need.has('ratio') || t === 'TRANSFER');
    show('price', ['BUY', 'SELL', 'DRIP', 'STAKING'].includes(t) || amount || t === 'TRANSFER');
    show('fee', ['BUY', 'SELL', 'DRIP', 'DIVIDEND'].includes(t));
    show('cur', t !== 'SPLIT' && t !== 'FREE');
    show('fx', t !== 'SPLIT' && t !== 'FREE' && (f.currency.value && f.currency.value !== 'TRY'));
    show('toCur', t === 'FX_CONVERT'); show('toAmt', t === 'FX_CONVERT'); show('toPlat', t === 'TRANSFER');
    $('#symLbl', f).textContent = t === 'TRANSFER' ? 'SEMBOL (nakit için boş bırakın)' : t === 'INTEREST' ? 'SEMBOL (isteğe bağlı)' : 'SEMBOL';
    $('#qtyLbl', f).textContent = t === 'SPLIT' ? 'BÖLÜNME ORANI' : 'MİKTAR (ADET)';
    $('#priceLbl', f).textContent = amount || (t === 'TRANSFER' && !f.symbol.value) ? (t === 'DIVIDEND' ? 'BRÜT TUTAR' : t === 'FX_CONVERT' ? 'KAYNAK TUTAR' : 'TUTAR') : t === 'STAKING' ? 'BİRİM DEĞER (isteğe bağlı)' : 'BİRİM FİYAT';
    $('#feeLbl', f).textContent = t === 'DIVIDEND' ? 'STOPAJ / KESİNTİ' : 'KOMİSYON';
    $('#curLbl', f).textContent = t === 'FX_CONVERT' ? 'KAYNAK PARA BİRİMİ' : 'PARA BİRİMİ';
    $('#platLbl', f).textContent = t === 'TRANSFER' ? 'KAYNAK PLATFORM' : 'PLATFORM';
    const q = Number(f.quantity.value || 0), p = Number(f.price.value || 0), fee = Number(f.fee.value || 0);
    const curTxt = f.currency.value || '';
    let total = '';
    if (['BUY', 'SELL'].includes(t) && q && p) total = `Toplam: ${num(q * p + (t === 'BUY' ? fee : -fee), 2)} ${curTxt}`;
    if (t === 'DRIP' && q && p) total = `Yeniden yatırılan temettü: ${num(q * p, 2)} ${curTxt}`;
    if (t === 'DIVIDEND' && p) total = `Net temettü: ${num(p - fee, 2)} ${curTxt}`;
    if (t === 'FX_CONVERT' && p && Number(f.to_amount.value)) total = `Uygulanan kur: 1 ${f.to_currency.value} = ${num(p / Number(f.to_amount.value), 4)} ${f.currency.value || 'TRY'}`;
    $('#txTotal', f).textContent = total;
    // Platform nakit bakiyesi ve yetersiz bakiye uyarısı (nakit takibi açıksa)
    const cur = f.currency.value || (/\.US$/i.test(f.symbol.value.trim()) ? 'USD' : 'TRY');
    const outflow = t === 'BUY' ? q * p + fee : ['WITHDRAW', 'FEE', 'FX_CONVERT'].includes(t) || (t === 'TRANSFER' && !f.symbol.value.trim()) ? p : 0;
    const plat = f.platform.value.trim();
    const bal = data?.totals?.cashTracking && plat ? (data.cash || []).filter((c) => c.platform === plat && c.currency === cur).reduce((a, c) => a + c.amount, 0) : null;
    if (bal != null && outflow > 0) {
      const short = outflow > bal + 0.005;
      $('#txTotal', f).innerHTML = `${esc(total)}${total ? '<br>' : ''}<span class="${short ? 'down' : 'dim'}">${esc(plat)} ${cur} bakiyesi: ${num(bal, 2)}${short ? ` · ⚠ tutar bakiyeden ${num(outflow - bal, 2)} ${cur} fazla; önce nakit girişi veya döviz çevrimi kaydedin` : ''}</span>`;
    }
    $('#txHelp', f).textContent = HELP[t] || '';
  };
  f.addEventListener('input', sync);
  sync();
  f.symbol.addEventListener('change', async () => {
    if (!f.price.value && f.symbol.value && ['BUY', 'SELL'].includes(f.type.value)) { const q = await api(`/quote/${encodeURIComponent(f.symbol.value)}`).catch(() => null); if (q?.price) { f.price.value = q.price; sync(); } }
  });
  $('#txSave', m.el).onclick = async () => {
    const o = Object.fromEntries(new FormData(f));
    for (const k of ['quantity', 'price', 'fee', 'fx_rate', 'to_amount']) o[k] = o[k] === '' || o[k] == null ? undefined : Number(o[k]);
    for (const k of ['currency', 'asset_type', 'to_currency', 'to_platform', 'symbol', 'platform', 'strategy']) if (!o[k]) delete o[k];
    if (o.type !== 'FX_CONVERT') { delete o.to_currency; delete o.to_amount; }
    if (o.type !== 'TRANSFER') delete o.to_platform;
    try {
      await api(editing ? `/transactions/${init.id}` : '/transactions', { method: editing ? 'PUT' : 'POST', body: o });
      toast(editing ? 'İşlem güncellendi' : 'İşlem eklendi', 'ok');
      m.close();
    } catch (e) { toast(e.message, 'err'); }
  };
}

on('ws:portfolio.changed', () => { riskCache.clear(); load(); });
// Canlı fiyatlarla özet/varlıklar sessizce tazelenir (filtre ve kaydırma korunur)
const debouncedLoad = debounce(load, 3000);
on('quotes', () => { if (root.classList.contains('active') && ['ozet', 'varliklar', 'pozisyonlar'].includes(tab) && !document.querySelector('.modal-back')) debouncedLoad(); });
on('view:shown', (v) => { if (v === 'portfolio') load(); });
on('settings', () => { if (root.classList.contains('active') && tab !== 'ayarlar') render(); });
on('ready', load);

// DASHBOARD görünümü: seçili sembol detayı + piyasa geneli
import { state, on, emit, api, $, $$, esc, md, num, price, pct, cls, compact, dateTR, css, toast, selectSymbol, askAgent, localGet, localSet, timeTR, srcTag, debounce, confirmBox, openPdfViewer } from './core.js';
import { baseOptions, makeChart } from './charts.js';
import { openTxModal } from './portfolio-view.js';
import { openKapDetail, signalPill } from './kap.js';

const root = $('#view-market');
const RANGES = [['1d', '1G'], ['5d', '1H'], ['1mo', '1A'], ['3mo', '3A'], ['6mo', '6A'], ['ytd', 'YBB'], ['1y', '1Y'], ['5y', '5Y'], ['max', 'TÜMÜ']];
let range = localGet('range', '6mo');
const overlays = new Set(localGet('overlays', ['sma20', 'sma50']));
let lower = localGet('lower', 'rsi');
let moversTab = 'gainers';
let calScope = localGet('calScope', 'watchlist');
let lastHist = null;
let symToken = 0;

root.innerHTML = `
<div class="pad grid">
  <div class="card" id="symCard">
    <div class="row between">
      <div class="sym-head" id="symHead"></div>
      <div class="row">
        <button class="btn sec" id="bWatch">＋ Liste</button>
        <button class="btn sec" id="bTx">Portföye ekle</button>
        <button class="btn" id="bAsk">Ajan ile analiz et</button>
      </div>
    </div>
    <div class="row between" style="margin:10px 0 6px">
      <div class="seg" id="rangeSeg">${RANGES.map(([r, l]) => `<button data-r="${r}">${l}</button>`).join('')}</div>
      <div class="row">
        <div class="seg" id="ovSeg"><button data-o="sma20">SMA20</button><button data-o="sma50">SMA50</button><button data-o="sma200">SMA200</button><button data-o="bb">Bollinger</button><button data-o="vol">Hacim</button></div>
        <div class="seg" id="lowSeg"><button data-l="rsi">RSI</button><button data-l="macd">MACD</button><button data-l="none">—</button></div>
      </div>
    </div>
    <div class="chart-box"><canvas id="mainChart"></canvas></div>
    <div class="chart-box sm" id="lowerBox"><canvas id="lowerChart"></canvas></div>
    <div class="dim" id="chartNote" style="font-size:11px;margin-top:4px"></div>
  </div>
  <div class="grid g3">
    <div class="card"><h3>İSTATİSTİKLER</h3><div class="stats" id="stats"></div></div>
    <div class="card"><h3>TEKNİK GÖRÜNÜM</h3><div id="tech"></div></div>
    <div class="card"><h3>TEMEL VERİLER <span class="dim" id="fundNote" style="font-weight:400"></span></h3><div id="fund"></div></div>
  </div>
  <div class="grid g2">
    <div class="card"><h3>HABERLER</h3><div class="news" id="news"></div></div>
    <div class="card"><h3>KAP BİLDİRİMLERİ (30 GÜN) <button class="ghost" id="bKapAll">Tümü ›</button></h3><div id="symKap"></div></div>
  </div>
  <div id="finSum">
    <div class="grid g2">
      <div class="card"><h3>ÖZET GELİR TABLOSU <span class="dim" style="font-weight:400">mn TL</span></h3><div id="finInc"></div></div>
      <div class="card"><h3>ÖZET BİLANÇO <span class="dim" style="font-weight:400">mn TL</span></h3><div id="finBal"></div></div>
    </div>
    <div class="card" style="margin-top:12px"><div class="grid g3 fin-charts" id="finCharts"></div></div>
  </div>
  <details class="card fin-detail"><summary><h3>MALİ TABLOLAR · DETAY <span class="dim" id="finNote" style="font-weight:400"></span> <span class="seg" id="finMode"><button data-m="q" class="active">Çeyreklik</button><button data-m="c">Kümülatif</button></span></h3></summary><div id="fin"></div></details>
  <div class="grid g2">
    <div class="card"><h3>KURUM RAPORLARI <button class="ghost" id="bRepAll">Tümü ›</button></h3><div id="symRep"></div></div>
    <div class="card"><h3 title="Ajanın bu şirket için kaydettiği tez, kilit rakamlar ve tetikleyiciler (workspace/hafiza)">AJAN NOTLARI <span class="dim" id="noteMeta" style="font-weight:400"></span></h3><div id="symNotes"></div></div>
  </div>
  <div class="card"><h3 title="KAP'tan indirilmiş faaliyet raporu, finansal rapor ve sunumlar (workspace/belgeler)">BELGELER</h3><div id="symDocs"></div></div>
  <div class="grid g2">
    <div class="card"><h3>TEMETTÜ & SERMAYE ARTIRIMLARI</h3><div id="divs"></div></div>
    <div class="card">
      <h3>BIST 100 — GÜNÜN HAREKETLİLERİ <span class="seg" id="movSeg"><button data-m="gainers">Yükselen</button><button data-m="losers">Düşen</button><button data-m="active">Hacim</button></span></h3>
      <div id="breadth" style="margin-bottom:8px"></div>
      <div class="table-wrap" style="max-height:340px"><table class="t" id="movers"></table></div>
    </div>
  </div>
  <div class="grid g2">
    <div class="card"><h3>SEKTÖR PERFORMANSI (BIST 100 ORT.)</h3><div class="heat" id="sectors"></div></div>
    <div class="card"><h3>TEMETTÜ TAKVİMİ (İLAN EDİLENLER) <span class="seg" id="calSeg"><button data-c="watchlist">Listem</button><button data-c="portfolio">Portföyüm</button><button data-c="all">Tümü</button></span></h3>
      <div class="table-wrap" style="max-height:300px"><table class="t" id="calendar"></table></div></div>
  </div>
  <div class="card"><h3>SİNYAL RADARI (BIST 100, GÜNLÜK) <span class="row" style="gap:6px"><span class="dim" id="radarInfo" style="font-weight:400"></span><button class="ghost" id="radarRun">Tara</button><button class="ghost" id="radarAsk">Ajan ile yorumla</button></span></h3>
    <div class="row" id="radarChips" style="margin-bottom:8px"></div>
    <div class="table-wrap" style="max-height:320px"><table class="t" id="radarTable"><tbody><tr><td class="dim">Taramayı başlatmak için "Tara"ya basın (ilk tarama ~20 sn sürer, sonuçlar 15 dk önbellekte kalır).</td></tr></tbody></table></div>
  </div>
  <div class="card"><h3>HİSSE TARAYICI <span class="dim" style="font-weight:400">İş Yatırım temel verileri · günlük</span></h3>
    <form class="row" id="scrForm" style="margin-bottom:8px">
      <select name="index"><option value="BIST100">BIST 100</option><option value="BIST30">BIST 30</option><option value="TUM">Tüm BIST</option></select>
      <input name="sector" placeholder="Sektör içerir" style="width:130px">
      <input name="pe_max" type="number" step="any" placeholder="F/K ≤" style="width:80px">
      <input name="pb_max" type="number" step="any" placeholder="PD/DD ≤" style="width:80px">
      <input name="ev_ebitda_max" type="number" step="any" placeholder="FD/FAVÖK ≤" style="width:100px">
      <input name="mcap_min_mn" type="number" step="any" placeholder="PD ≥ mn TL" style="width:110px">
      <select name="sort"><option value="mcap">Piyasa değeri</option><option value="pe">F/K (artan)</option><option value="pb">PD/DD (artan)</option><option value="ev_ebitda">FD/FAVÖK (artan)</option><option value="ret_ytd">YBB getiri</option><option value="ret_1m">1A getiri</option></select>
      <button class="btn sec">Tara</button>
      <span class="seg" id="scrPresets"><button type="button" data-p="value">Ucuz (F/K≤8, PD/DD≤1,5)</button><button type="button" data-p="ytd">YBB liderleri</button></span>
    </form>
    <div class="table-wrap" style="max-height:360px"><table class="t" id="scrTable"></table></div>
  </div>
  <div class="card"><h3>EKONOMİ HABERLERİ <select id="newsSrc" style="font-weight:400"><option value="">Tüm kaynaklar</option></select></h3><div class="news" id="econNews"></div></div>
  <div class="card"><h3>ENDEKSLER <span class="dim" style="font-weight:400">tıklayınca grafiği açılır</span></h3><div class="heat" id="indices"></div></div>
</div>`;

const segActive = () => {
  $$('#rangeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.r === range));
  $$('#ovSeg button').forEach((b) => b.classList.toggle('active', overlays.has(b.dataset.o)));
  $$('#lowSeg button').forEach((b) => b.classList.toggle('active', b.dataset.l === lower));
  $$('#movSeg button').forEach((b) => b.classList.toggle('active', b.dataset.m === moversTab));
  $$('#calSeg button').forEach((b) => b.classList.toggle('active', b.dataset.c === calScope));
  $('#lowerBox').hidden = lower === 'none';
};
$('#rangeSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; range = b.dataset.r; localSet('range', range); segActive(); loadChart(); };
$('#ovSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; overlays.has(b.dataset.o) ? overlays.delete(b.dataset.o) : overlays.add(b.dataset.o); localSet('overlays', [...overlays]); segActive(); drawChart(); };
$('#lowSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; lower = b.dataset.l; localSet('lower', lower); segActive(); drawChart(); };
$('#movSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; moversTab = b.dataset.m; segActive(); loadMovers(); };
$('#calSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; calScope = b.dataset.c; localSet('calScope', calScope); segActive(); loadCalendar(); };
segActive();

$('#bWatch').onclick = async () => { try { await api('/watchlist', { method: 'POST', body: { symbol: state.selected } }); toast(`${state.selected} Watchlist'e eklendi`, 'ok'); } catch (e) { toast(e.message, 'err'); } };
$('#bTx').onclick = () => openTxModal({ symbol: state.selected, price: state.quotes[state.selected]?.price });
$('#bAsk').onclick = () => askAgent(`${state.selected} için analiz yap: güncel fiyat hareketi, teknik görünüm (trend, destek/direnç, RSI, MACD), temel oranlar (F/K, PD/DD, FD/FAVÖK), son KAP bildirimleri ve varsa portföyümdeki pozisyonumla ilişkisi. Sonunda kısa bir özet ver.`, { context: symbolContext() });
$('#bKapAll').onclick = () => { emit('kap:filter', { scope: 'symbol', symbol: state.selected }); emit('rtab', 'kap'); };

function symbolContext() {
  const q = state.quotes[state.selected];
  return q ? `Seçili sembol: ${state.selected} (${q.name}), fiyat ${q.price} ${q.currency}${q.delayed ? ' (~15 dk gecikmeli)' : ''}, günlük %${q.changePct?.toFixed(2)}` : `Seçili sembol: ${state.selected}`;
}

function renderHead() {
  const s = state.selected, q = state.quotes[s];
  const src = q ? `${q.source || ''}${q.delayed ? ' · ~15 dk gecikmeli' : ' · anlık'} · ${timeTR(q.time)}` : '';
  $('#symHead').innerHTML = `<div><div class="code">${esc(s)}</div><div class="name">${esc(q?.longName || q?.name || '')} ${q?.exchange ? `· ${esc(q.exchange)}` : ''}</div></div>
    <div class="price">${q ? price(q.price) : '…'} <span class="dim" style="font-size:13px">${esc(q?.currency || '')}</span></div>
    <div class="chg ${cls(q?.change)}">${q?.change != null ? `${q.change > 0 ? '+' : ''}${price(q.change)} (${pct(q.changePct)})` : ''}</div>
    ${q ? `<div class="dim" style="font-size:11px">${esc(src)}${q.bid ? ` · alış ${price(q.bid)} / satış ${price(q.ask)}` : ''}</div>` : ''}`;
  $('#stats').innerHTML = q ? [
    ['Önceki kapanış', price(q.prevClose)], ['Gün düşük', price(q.dayLow)], ['Gün yüksek', price(q.dayHigh)],
    ['52H düşük', price(q.low52)], ['52H yüksek', price(q.high52)], ['Hacim (adet)', compact(q.volume)],
    ['İşlem hacmi (≈)', q.volume && q.price ? compact(q.volume * q.price) : '—'],
    ['52H zirveye', q.high52 ? pct((q.price / q.high52 - 1) * 100) : '—'],
  ].map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`).join('') : '<div class="dim">Veri yok</div>';
}

async function loadSymbol() {
  const s = state.selected;
  const tok = ++symToken;
  const fresh = () => tok === symToken;
  renderHead();
  api(`/quote/${encodeURIComponent(s)}`).then((q) => { if (q && fresh()) { state.quotes[s] = q; renderHead(); } }).catch(() => {});
  loadChart();
  $('#tech').innerHTML = '<div class="skeleton"></div>';
  api(`/technical/${encodeURIComponent(s)}`).then((t) => {
    if (!fresh()) return;
    if (t.error) { $('#tech').innerHTML = `<div class="dim">${esc(t.error)}</div>`; return; }
    $('#tech').innerHTML = `<div class="stats" style="margin-bottom:8px">${[
      ['RSI(14)', num(t.rsi14, 1)], ['SMA20', price(t.sma20)], ['SMA50', price(t.sma50)], ['SMA200', price(t.sma200)],
      ['MACD hist.', num(t.macdHist, 3)], ['ATR(14)', price(t.atr14)], ['Volatilite (60g)', pct(t.volatility60dAnnualPct, 1, false)],
      ['1A getiri', `<span class="${cls(t.return1m)}">${pct(t.return1m)}</span>`], ['3A getiri', `<span class="${cls(t.return3m)}">${pct(t.return3m)}</span>`], ['1Y getiri', `<span class="${cls(t.return1y)}">${pct(t.return1y)}</span>`],
    ].map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`).join('')}</div><ul class="signals">${t.signals.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }).catch((e) => { if (fresh()) $('#tech').innerHTML = `<div class="dim">${esc(e.message)}</div>`; });

  $('#fund').innerHTML = '<div class="skeleton"></div>';
  $('#divs').innerHTML = '<div class="skeleton"></div>';
  api(`/fundamentals/${encodeURIComponent(s)}`).then((f) => {
    if (!fresh()) return;
    if (!f) {
      $('#fundNote').textContent = '';
      $('#fund').innerHTML = '<div class="dim">Bu sembol için temel veri yok (yalnızca BIST hisseleri).</div>';
      loadYahooDividends(s, fresh);
      return;
    }
    $('#fundNote').textContent = `İş Yatırım · ${f.period ? `son dönem ${f.period}` : ''}`;
    const prem = (v) => (v == null ? '' : ` <span class="${v < 0 ? 'up' : 'down'}" title="Tahmine göre prim(+)/iskonto(−)">${pct(v, 1)}</span>`);
    $('#fund').innerHTML = `<div class="stats">${[
      ['Sektör', esc(f.sector || '—')], ['Piyasa değeri', `${compact(f.mcapTL)} ₺`], ['Piyasa değeri ($)', `${compact(f.mcapUSD)} $`], ['Halka açıklık', pct(f.freeFloatPct, 1, false)],
      ['F/K', num(f.pe, 1)], ['FD/FAVÖK', num(f.evEbitda, 1)], ['FD/Satışlar', num(f.evSales, 1)], ['PD/DD', num(f.pb, 2)],
      ...(f.peF != null ? [['F/K tahmin', num(f.peF, 1) + prem(f.pePrem)], ['FD/FAVÖK tahmin', num(f.evEbitdaF, 1) + prem(f.evEbitdaPrem)], ['PD/DD tahmin', num(f.pbF, 2) + prem(f.pbPrem)]] : []),
      ['Haftalık getiri', `<span class="${cls(f.ret1w)}">${pct(f.ret1w)}</span>`], ['Aylık getiri', `<span class="${cls(f.ret1m)}">${pct(f.ret1m)}</span>`], ['Yıl içi getiri', `<span class="${cls(f.retYtd)}">${pct(f.retYtd)}</span>`],
    ].map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`).join('')}</div>`;
    renderActions(f.actions || []);
    if (!(f.actions || []).length) loadYahooDividends(s, fresh);
  }).catch((e) => { if (fresh()) $('#fund').innerHTML = `<div class="dim">${esc(e.message)}</div>`; });

  $('#news').innerHTML = '<div class="skeleton"></div>';
  Promise.all([api(`/news?q=${encodeURIComponent(s)}`).catch(() => []), api(`/newsfeed?symbol=${encodeURIComponent(s)}&limit=10`).then((r) => r.items.map((x) => ({ title: x.title, publisher: x.source, link: x.link, time: x.time }))).catch(() => [])]).then(([g, f]) => {
    if (!fresh()) return;
    const seen = new Set();
    const n = [...f, ...g].filter((x) => { const k = x.title.toLocaleLowerCase('tr').slice(0, 50); return seen.has(k) ? false : seen.add(k); }).sort((a, b) => (b.time || 0) - (a.time || 0));
    $('#news').innerHTML = n.length ? n.slice(0, 10).map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}<br><small>${esc(x.publisher)} · ${dateTR(x.time, true)}</small></a>`).join('') : '<div class="dim">Haber bulunamadı</div>';
  });

  loadNotes(s, fresh);
  loadFinancials(s, fresh);
  loadSymReports(s, fresh);
  $('#symKap').innerHTML = '<div class="skeleton"></div>';
  api(`/kap?scope=symbol&symbol=${encodeURIComponent(s)}&days=30&limit=12`).then((k) => {
    if (!fresh()) return;
    $('#symKap').innerHTML = k.items.length ? `<div class="news">${k.items.map((x) => `<a href="${esc(x.url)}" data-kap="${x.id}">${signalPill(x.signal)} ${esc(x.subject)}${x.summary ? ` — <span class="muted">${esc(x.summary)}</span>` : ''}<br><small>${esc(x.clsLabel)} · ${esc(x.publishDate)}</small></a>`).join('')}</div>`
      : `<div class="dim">${k.error ? esc(k.error) : 'Son 30 günde bildirim yok'}</div>`;
  }).catch(() => { if (fresh()) $('#symKap').innerHTML = '<div class="dim">KAP alınamadı</div>'; });
}
$('#symKap').addEventListener('click', (e) => { const a = e.target.closest('[data-kap]'); if (a) { e.preventDefault(); openKapDetail(Number(a.dataset.kap)); } });

// Mali tablolar (İş Yatırım, KAP finansalları)
let finData = null, finMode = localGet('finMode', 'q');
const bn = (v) => (v == null ? '—' : num(v / 1e9, Math.abs(v) >= 1e11 ? 0 : 1));
function drawFin() {
  const f = finData;
  if (!f) return;
  $$('#finMode button').forEach((b) => b.classList.toggle('active', b.dataset.m === finMode));
  const rows = finMode === 'q' ? f.quarterly : f.cumulative.map((r) => ({ ...r, period: r.period.replace('/', ' / ') + ' ay' }));
  const cols = rows.slice(0, 8);
  const pctOf = (a, b) => (a != null && b ? `${num((a / b) * 100, 1)}%` : '—');
  const lines = f.type === 'banka'
    ? [['Net faiz geliri', 'netInterest'], ['Net ücret ve komisyon', 'fees'], ['Kredi karşılıkları', 'provisions'], ['Net faaliyet kârı', 'operatingProfit'], ['Net kâr', 'netIncome', true]]
    : [['Satışlar', 'sales'], ['Brüt kâr', 'grossProfit'], ['FAVÖK', 'ebitda'], ['Faaliyet kârı', 'operatingProfit'], ['Net kâr (ana ortaklık)', 'netIncome', true], ['İşletme nakit akışı', 'opCashFlow']];
  const margin = f.type === 'banka' ? [] : [['Brüt marj', (r) => pctOf(r.grossProfit, r.sales)], ['FAVÖK marjı', (r) => pctOf(r.ebitda ?? (r.operatingProfit != null && r.depreciation != null ? r.operatingProfit + r.depreciation : null), r.sales)], ['Net marj', (r) => pctOf(r.netIncome, r.sales)]];
  const bal = f.cumulative.slice(0, 8);
  const balLines = f.type === 'banka' ? [['Krediler', 'loans'], ['Mevduat', 'deposits'], ['Özkaynak', 'equity'], ['Toplam aktif', 'totalAssets']] : [['Net borç', 'netDebt'], ['Özkaynak (ana ort.)', 'equity'], ['Toplam varlık', 'totalAssets'], ['Net döviz pozisyonu', 'netFx']];
  $('#fin').innerHTML = `<div class="table-wrap"><table class="t fin-table"><thead><tr><th>milyar TL</th>${cols.map((r) => `<th class="r">${esc(r.period)}</th>`).join('')}</tr></thead><tbody>
    ${lines.map(([l, k, b]) => `<tr><td>${b ? `<b>${l}</b>` : l}</td>${cols.map((r) => `<td class="r num ${r[k] < 0 ? 'down' : ''}">${bn(r[k])}</td>`).join('')}</tr>`).join('')}
    ${finMode === 'q' || f.type === 'banka' ? '' : margin.map(([l, fn]) => `<tr class="dim"><td>${l}</td>${cols.map((r) => `<td class="r num">${fn(r)}</td>`).join('')}</tr>`).join('')}
    ${finMode === 'q' && f.type !== 'banka' ? margin.map(([l, fn]) => `<tr class="dim"><td>${l}</td>${cols.map((r) => `<td class="r num">${fn(r)}</td>`).join('')}</tr>`).join('') : ''}
    <tr><td colspan="${cols.length + 1}" class="mini-head" style="padding-top:8px">BİLANÇO (dönem sonu)</td></tr>
    ${balLines.map(([l, k]) => `<tr><td>${l}</td>${bal.map((r) => `<td class="r num ${r[k] < 0 ? 'down' : ''}">${bn(r[k])}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}
// Özet gelir tablosu (son dönem, geçen yılın aynı dönemiyle), özet bilanço (önceki çeyrekle), çeyreklik grafikler
const mn = (v) => (v == null ? '—' : num(v / 1e6, Math.abs(v) < 1e8 ? 1 : 0));
const shortTL = (v) => (Math.abs(v) >= 1e9 ? `${num(v / 1e9, 1)} mr` : Math.abs(v) >= 1e6 ? `${num(v / 1e6, 1)} mn` : num(v, 0));
function chg(a, b, lowerIsBetter = false) {
  if (a == null || b == null || b === 0) return '<td class="r num dim">—</td>';
  if (a < 0 || b < 0) return '<td class="r num dim">N/A</td>';
  const p = (a / b - 1) * 100;
  const good = lowerIsBetter ? p < 0 : p > 0;
  if (Math.abs(p) < 0.5) return '<td class="r num">0%</td>';
  return `<td class="r num ${good ? 'up' : 'down'}">${p > 0 ? '+' : ''}${num(p, 0)}%</td>`;
}
function sumTable(el, cur, prev, lines) {
  el.innerHTML = cur && prev ? `<table class="t fin-sum"><thead><tr><th></th><th class="r">${esc(cur.period)}</th><th class="r">${esc(prev.period)}</th><th class="r">%</th></tr></thead><tbody>
    ${lines.map(([l, k, inv, tip]) => `<tr><td${tip ? ` title="${esc(tip)}"` : ''}>${l}</td><td class="r num">${mn(cur[k])}</td><td class="r num">${mn(prev[k])}</td>${chg(cur[k], prev[k], inv)}</tr>`).join('')}</tbody></table>`
    : '<div class="dim">Karşılaştırma için yeterli dönem yok.</div>';
}
function drawFinSummary(f) {
  const bank = f.type === 'banka';
  const cur = f.cumulative[0];
  const [y, m] = (cur?.period || '0/0').split('/').map(Number);
  sumTable($('#finInc'), cur, f.cumulative.find((r) => r.period === `${y - 1}/${m}`), bank
    ? [['Net Faiz Geliri', 'netInterest'], ['Net Ücret ve Komisyon', 'fees'], ['Kredi Karşılıkları', 'provisions', true], ['Vergi Öncesi Kâr', 'pretax'], ['Net Dönem Kârı', 'netIncome']]
    : [['Satışlar', 'sales'], ['Brüt Kâr', 'grossProfit'], ['FAVÖK', 'ebitda'], ['Net Parasal Pozisyon Kazançları (Kayıpları)', 'monetaryGain', false, 'Vergi öncesi diğer gelir ve giderler satırı; enflasyon muhasebesi uygulayan şirketlerde net parasal pozisyon kazancı/kaybı'], ['Net Dönem Kârı', 'netIncome']]);
  sumTable($('#finBal'), cur, f.cumulative[1], bank
    ? [['Krediler', 'loans'], ['Mevduat', 'deposits'], ['Toplam Varlıklar', 'totalAssets'], ['Özkaynaklar', 'equity']]
    : [['Dönen Varlıklar', 'currentAssets'], ['Duran Varlıklar', 'nonCurrentAssets'], ['Toplam Varlıklar', 'totalAssets'], ['Net Borç', 'netDebt', true], ['Özkaynaklar', 'equity']]);
  const qs = f.quarterly.filter((q) => q[bank ? 'netInterest' : 'sales'] != null).slice(0, 5).reverse();
  const charts = bank ? [['ÇEYREKLİK NET FAİZ GELİRİ', 'netInterest'], ['ÇEYREKLİK FAALİYET KÂRI', 'operatingProfit'], ['ÇEYREKLİK NET KÂR', 'netIncome']]
    : [['ÇEYREKLİK SATIŞLAR', 'sales'], ['ÇEYREKLİK FAVÖK', 'ebitda'], ['ÇEYREKLİK NET KÂR', 'netIncome']];
  $('#finCharts').innerHTML = charts.map(([t], i) => `<div><h3>${t}</h3><div class="chart-box fin-chart"><canvas id="fc${i}"></canvas></div></div>`).join('');
  const blue = '#4f7ee8', red = css('--down');
  charts.forEach(([t, k], i) => {
    const data = qs.map((q) => q[k]);
    const o = baseOptions({ time: false, yRight: false });
    o.scales.x.grid = { display: false };
    o.scales.x.ticks = { ...o.scales.x.ticks, maxRotation: 0, autoSkip: false, font: { size: 10 } };
    o.scales.y.ticks = { ...o.scales.y.ticks, maxTicksLimit: 6 };
    o.scales.y.ticks.callback = (v) => shortTL(v);
    o.plugins.tooltip.callbacks = { label: (c) => `${shortTL(c.parsed.y)} TL` };
    makeChart($(`#fc${i}`), { type: 'bar', data: { labels: qs.map((q) => q.label), datasets: [{ label: t, data, backgroundColor: data.map((v) => (v < 0 ? red : blue)), borderRadius: 4, maxBarThickness: 44 }] }, options: o });
  });
}
async function loadFinancials(s, fresh = () => true) {
  $('#fin').innerHTML = '<div class="skeleton"></div>';
  $('#finSum').hidden = false;
  $('#finInc').innerHTML = $('#finBal').innerHTML = '<div class="skeleton"></div>';
  finData = null;
  try {
    const f = await api(`/financials/${encodeURIComponent(s)}?n=8`);
    if (!fresh()) return;
    finData = f;
    drawFinSummary(f);
    $('#finNote').textContent = `${f.source} · son dönem ${f.latest}${f.type === 'banka' ? ' · banka' : ''}`;
    drawFin();
  } catch (e) { if (fresh()) { $('#finSum').hidden = true; $('#finNote').textContent = ''; $('#fin').innerHTML = `<div class="dim">${esc(e.message.includes('bulunamadı') ? 'Bu sembol için mali tablo yok (yalnız BIST şirketleri).' : e.message)}</div>`; } }
}
$('#finMode').onclick = (e) => { e.preventDefault(); const b = e.target.closest('[data-m]'); if (!b) return; finMode = b.dataset.m; localSet('finMode', finMode); drawFin(); };

// Sembolün aracı kurum raporları
async function loadSymReports(s, fresh = () => true) {
  $('#symRep').innerHTML = '<div class="skeleton"></div>';
  try {
    const r = await api(`/research?symbol=${encodeURIComponent(s)}&days=365&limit=8`);
    if (!fresh()) return;
    $('#symRep').innerHTML = r.items.length ? `<div class="news">${r.items.map((x) => `<a href="#" data-rep="${esc(x.id)}">${esc(x.title)}${x.isNew ? ' <span class="pill acc">YENİ</span>' : ''}${x.summary ? `<br><span class="muted">${esc(x.summary.slice(0, 160))}${x.summary.length > 160 ? '…' : ''}</span>` : ''}<br><small>${esc(x.broker)} · ${dateTR(x.date)} · ${esc(x.category)}</small></a>`).join('')}</div>`
      : '<div class="dim">Son 1 yılda bu şirket için açık kurum raporu yok.</div>';
    $$('[data-rep]', $('#symRep')).forEach((a) => a.onclick = (e) => {
      e.preventDefault();
      const x = r.items.find((i) => i.id === a.dataset.rep);
      if (x.access === 'web') { window.open(x.page, '_blank', 'noopener'); return; }
      openPdfViewer({ src: `/api/research/file?id=${encodeURIComponent(x.id)}`, title: `${x.broker} · ${x.title}`, name: `${x.title}.pdf`, actions: [
        { label: 'Arşive kaydet', run: async () => { try { const s2 = await api('/research/save', { method: 'POST', body: { id: x.id } }); toast(`Kaydedildi: ${s2.name}`, 'ok'); } catch (err) { toast(err.message, 'err'); } } },
        { label: 'Ajan ile analiz et', run: (m) => { m.close(); askAgent(`read_broker_report ile "${x.id}" kimlikli ${x.broker} raporunu (${x.title}) oku ve analiz et: tez, tavsiye ve hedef fiyat, tahminler, riskler; güncel verilerle karşılaştır ve kendi görüşünle değerlendir.`); } },
      ] });
    });
  } catch (e) { if (fresh()) $('#symRep').innerHTML = `<div class="dim">${esc(e.message)}</div>`; }
}
$('#bRepAll').onclick = () => emit('research:symbol', state.selected);

// Ekonomi haberleri (RSS)
async function loadEconNews() {
  const src = $('#newsSrc').value;
  try {
    const r = await api(`/newsfeed?limit=25${src ? `&sources=${src}` : ''}`);
    if ($('#newsSrc').options.length <= 1) $('#newsSrc').innerHTML += Object.entries(r.sources).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    $('#econNews').innerHTML = r.items.map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}<br><small>${esc(x.source)} · ${dateTR(x.time, true)}</small></a>`).join('') || '<div class="dim">Haber alınamadı</div>';
  } catch (e) { $('#econNews').innerHTML = `<div class="dim">${esc(e.message)}</div>`; }
}
$('#newsSrc').onchange = loadEconNews;

// Ajan notları (araştırma hafızası) ve şirket belge arşivi
async function loadNotes(s, fresh = () => true) {
  const [n, docs] = await Promise.all([api(`/memory/sirket/${encodeURIComponent(s)}`).catch(() => null), api(`/documents?symbol=${encodeURIComponent(s)}`).catch(() => [])]);
  if (!fresh()) return;
  if (n?.content) {
    const body = n.content.replace(/^# .*\n+/, '');
    $('#noteMeta').textContent = `güncelleme ${dateTR(n.updatedAt, true)}`;
    $('#symNotes').innerHTML = `<div class="msg assistant note-body${body.length > 1400 ? ' clamp' : ''}">${md(body)}</div>
      <div class="row" style="margin-top:6px">${body.length > 1400 ? '<button class="ghost" id="noteMore">Tamamını göster</button>' : ''}<button class="ghost" id="noteUpd">Ajan: güncelle</button><button class="ghost" id="noteDel">Sil</button></div>`;
    $('#noteMore')?.addEventListener('click', (e) => { $('#symNotes .note-body').classList.remove('clamp'); e.target.remove(); });
    $('#noteUpd').onclick = () => askAgent(`${s} için kayıtlı araştırma notunu güncel fiyat, temel veriler ve son KAP bildirimleriyle gözden geçir; tetikleyicilerin durumunu değerlendir ve save_memory ile güncelle.`);
    $('#noteDel').onclick = async () => { if (!(await confirmBox(`${s} için ajan notu silinsin mi?`, { danger: true, ok: 'Sil' }))) return; await api(`/memory/sirket/${encodeURIComponent(s)}`, { method: 'DELETE' }); loadNotes(s); };
  } else {
    $('#noteMeta').textContent = '';
    $('#symNotes').innerHTML = `<div class="dim">Bu şirket için kayıtlı ajan notu yok. Ajan analizden sonra tezi, kilit rakamları ve tetikleyicileri buraya kaydeder.</div><button class="ghost" id="noteNew" style="margin-top:6px">Ajan: analiz et ve not al</button>`;
    $('#noteNew').onclick = () => askAgent(`${s} için kapsamlı analiz yap (hisse-analizi becerisi) ve sonunda save_memory ile tezi, kilit rakamları ve tetikleyicileri kaydet.`);
  }
  $('#symDocs').innerHTML = `${docs.length ? `<table class="t"><tbody>${docs.slice(0, 8).map((d, i) => `<tr class="click" data-doc="${i}"><td>📄 ${esc(d.name)}</td><td class="r dim">${dateTR(d.savedAt)}</td><td class="r dim">${Math.max(1, Math.round(d.size / 1024))} KB</td></tr>`).join('')}</tbody></table>` : '<div class="dim">Arşivde belge yok.</div>'}
    <button class="ghost" id="docFetch" style="margin-top:6px">Ajan: son faaliyet raporu ve sunumu getir</button>`;
  $$('[data-doc]', $('#symDocs')).forEach((r) => r.onclick = () => {
    const d = docs[Number(r.dataset.doc)];
    openPdfViewer({ src: `/api/documents/file?path=${encodeURIComponent(d.path)}`, title: d.name, name: d.name, actions: [{ label: 'Ajan ile oku', run: (m) => { m.close(); askAgent(`${d.path} belgesini pdf-okuma becerisiyle oku; ${s} için ana bulguları ve rakamları (sayfa numarasıyla) özetle.`); } }] });
  });
  $('#docFetch').onclick = () => askAgent(`${s} için son faaliyet raporunu, son finansal raporu ve varsa yatırımcı sunumunu KAP'tan bul, arşive indir (sirket-belgeleri becerisi) ve öne çıkanları özetle.`);
}
on('ws:memory.changed', () => { if (state.selected) loadNotes(state.selected); });
on('ws:documents.changed', () => { if (state.selected) loadNotes(state.selected); });

function renderActions(acts) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = [...acts].reverse().slice(0, 10).map((a) => {
    const kind = [a.dpsGross > 0 ? `Temettü ${num(a.dpsGross, 4)} ₺/hisse` : null, a.bonusPct > 0 ? `Bedelsiz %${num(a.bonusPct, 2)}` : null, a.bonusDivPct > 0 ? `Bedelsiz (temettü) %${num(a.bonusDivPct, 2)}` : null, a.rightsPct > 0 ? `Bedelli %${num(a.rightsPct, 2)}` : null].filter(Boolean).join(' · ') || '—';
    return `<tr><td>${dateTR(a.date)} ${a.date >= today ? '<span class="pill acc">yaklaşan</span>' : ''}</td><td>${kind}</td><td class="r num">${a.cashTotal ? compact(a.cashTotal) + ' ₺' : ''}</td></tr>`;
  });
  $('#divs').innerHTML = rows.length ? `<table class="t"><thead><tr><th>Tarih</th><th>Olay</th><th class="r">Toplam nakit</th></tr></thead><tbody>${rows.join('')}</tbody></table><div class="dim" style="font-size:11px;margin-top:4px">Kaynak: İş Yatırım (bu yıl + ilan edilmiş)</div>` : '<div class="dim">Bu yıl kayıt yok</div>';
}

function loadYahooDividends(s, fresh) {
  api(`/dividends/${encodeURIComponent(s)}`).then((d) => {
    if (!fresh()) return;
    const rows = [...d.dividends.slice(-8).reverse().map((x) => `<tr><td>${dateTR(x.date)}</td><td>Temettü</td><td class="r num">${num(x.amount, 4)}</td></tr>`),
      ...d.splits.slice(-4).reverse().map((x) => `<tr><td>${dateTR(x.date)}</td><td>Bölünme</td><td class="r num">${esc(x.text || num(x.ratio, 3))}</td></tr>`)];
    $('#divs').innerHTML = rows.length ? `<table class="t"><thead><tr><th>Tarih</th><th>Olay</th><th class="r">Hisse başı / oran</th></tr></thead><tbody>${rows.join('')}</tbody></table><div class="dim" style="font-size:11px;margin-top:4px">Kaynak: Yahoo Finance (5 yıl)</div>` : '<div class="dim">Son 5 yılda kayıt yok</div>';
  }).catch(() => { if (fresh()) $('#divs').innerHTML = '<div class="dim">Veri yok</div>'; });
}

async function loadChart() {
  const s = state.selected;
  try {
    const d = await api(`/history/${encodeURIComponent(s)}?range=${range}&ind=1`);
    if (s !== state.selected) return;
    lastHist = d;
    drawChart();
    const q = state.quotes[s];
    $('#chartNote').textContent = ['GRAM', 'HAS', 'ONS', 'GUMUS', 'CEYREK', 'YARIM', 'TAM', 'CUMHURIYET', 'ATA', 'BILEZIK22'].includes(s)
      ? 'Geçmiş seri vadeli ons altın × USD/TL üzerinden türetilip güncel serbest piyasa fiyatına ölçeklenmiştir.'
      : q?.delayed ? 'BIST verileri ~15 dk gecikmelidir.' : '';
  } catch (e) {
    lastHist = null;
    makeChart($('#mainChart'), { type: 'line', data: { datasets: [] }, options: baseOptions() });
    toast(`${s}: ${e.message}`, 'err');
  }
}

function drawChart() {
  if (!lastHist) return;
  const { bars, indicators: ind } = lastHist;
  const t = bars.map((b) => b.t);
  const pts = (arr) => arr.map((v, i) => ({ x: t[i], y: v }));
  const first = bars[0]?.c, last = bars.at(-1)?.c;
  const color = last >= first ? css('--up') : css('--down');
  const ds = [{
    label: state.selected, data: pts(bars.map((b) => b.c)), borderColor: color, borderWidth: 1.6, pointRadius: 0, tension: 0.1, yAxisID: 'y',
    fill: { target: 'origin', above: color + '18' },
  }];
  const ovColors = { sma20: css('--accent'), sma50: css('--info'), sma200: css('--violet') };
  for (const k of ['sma20', 'sma50', 'sma200']) if (overlays.has(k)) ds.push({ label: k.toUpperCase(), data: pts(ind[k]), borderColor: ovColors[k], borderWidth: 1, pointRadius: 0, yAxisID: 'y' });
  if (overlays.has('bb')) {
    ds.push({ label: 'BB üst', data: pts(ind.bbUpper), borderColor: css('--text-3'), borderDash: [4, 3], borderWidth: 1, pointRadius: 0, yAxisID: 'y' });
    ds.push({ label: 'BB alt', data: pts(ind.bbLower), borderColor: css('--text-3'), borderDash: [4, 3], borderWidth: 1, pointRadius: 0, yAxisID: 'y' });
  }
  const opts = baseOptions({ legend: overlays.size > 0 });
  if (overlays.has('vol') && bars.some((b) => b.v)) {
    ds.push({ type: 'bar', label: 'Hacim', data: pts(bars.map((b) => b.v)), backgroundColor: css('--line-2'), yAxisID: 'v', barPercentage: 1, categoryPercentage: 1 });
    opts.scales.v = { display: false, beginAtZero: true, max: Math.max(...bars.map((b) => b.v)) * 4 };
  }
  opts.plugins.legend.labels.filter = (i) => !i.text.startsWith('BB') || i.text === 'BB üst';
  makeChart($('#mainChart'), { type: 'line', data: { datasets: ds }, options: opts });

  if (lower === 'none') return;
  const lopt = baseOptions();
  let lds;
  if (lower === 'rsi') {
    lds = [{ label: 'RSI(14)', data: pts(ind.rsi14), borderColor: css('--violet'), borderWidth: 1.2, pointRadius: 0 }];
    lopt.scales.y.min = 0; lopt.scales.y.max = 100;
    lopt.scales.y.ticks.stepSize = 30;
    lds.push({ label: '70', data: t.map((x) => ({ x, y: 70 })), borderColor: css('--down') + '88', borderDash: [3, 3], borderWidth: 1, pointRadius: 0 });
    lds.push({ label: '30', data: t.map((x) => ({ x, y: 30 })), borderColor: css('--up') + '88', borderDash: [3, 3], borderWidth: 1, pointRadius: 0 });
  } else {
    lds = [
      { type: 'bar', label: 'Histogram', data: pts(ind.macdHist), backgroundColor: ind.macdHist.map((v) => (v >= 0 ? css('--up') + '99' : css('--down') + '99')) },
      { label: 'MACD', data: pts(ind.macd), borderColor: css('--info'), borderWidth: 1.2, pointRadius: 0 },
      { label: 'Sinyal', data: pts(ind.macdSignal), borderColor: css('--accent'), borderWidth: 1.2, pointRadius: 0 },
    ];
  }
  makeChart($('#lowerChart'), { type: 'line', data: { datasets: lds }, options: lopt });
}

async function loadMovers() {
  try {
    const m = await api('/market/movers');
    const list = m[moversTab];
    $('#movers').innerHTML = `<thead><tr><th>Sembol</th><th>Ad</th><th class="r">Fiyat</th><th class="r">Değişim</th><th class="r">İşlem hacmi (≈)</th></tr></thead><tbody>${list.map((x) => `<tr class="click" data-s="${esc(x.symbol)}"><td class="mono"><b>${esc(x.symbol)}</b></td><td class="muted">${esc(x.name)}</td><td class="r num">${price(x.price)}</td><td class="r num ${cls(x.changePct)}">${pct(x.changePct)}</td><td class="r num">${compact(x.turnover)}</td></tr>`).join('')}</tbody>`;
    const b = m.breadth, tot = b.up + b.down + b.flat || 1;
    $('#breadth').innerHTML = `<div class="row between" style="font-size:11px"><span class="up">▲ ${b.up} yükselen</span><span class="dim">${b.flat} değişmeyen · ${m.priced}/${m.universe} hisse · ${timeTR(m.asOf)} (~15 dk gecikmeli)</span><span class="down">${b.down} düşen ▼</span></div>
      <div class="bar" style="display:flex;margin-top:4px"><i style="width:${(b.up / tot) * 100}%;background:var(--up)"></i><i style="width:${(b.flat / tot) * 100}%;background:var(--text-3)"></i><i style="width:${(b.down / tot) * 100}%;background:var(--down)"></i></div>`;
    $('#sectors').innerHTML = m.sectors.map((x) => `<div style="background:${heatColor(x.avgPct)}" title="${esc((x.members || []).join(', '))}"><b>${pct(x.avgPct)}</b>${esc(x.sector)} <span class="dim">(${x.count})</span></div>`).join('');
  } catch (e) {
    $('#movers').innerHTML = `<tr><td class="dim">${esc(e.message)}</td></tr>`;
  }
}
$('#movers').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) selectSymbol(r.dataset.s); });

// Temettü takvimi: ilan edilmiş, bugünden sonraki olaylar
async function loadCalendar() {
  const today = new Date().toISOString().slice(0, 10);
  let symbols = null;
  if (calScope === 'watchlist') symbols = state.watchlist;
  if (calScope === 'portfolio') symbols = (await api('/portfolio').catch(() => ({ holdings: [] }))).holdings.map((h) => h.symbol);
  if (symbols && !symbols.length) {
    $('#calendar').innerHTML = `<tbody><tr><td class="dim">${calScope === 'portfolio' ? 'Portföy boş' : 'Watchlist boş'}</td></tr></tbody>`;
    return;
  }
  const qs = symbols ? `&symbols=${encodeURIComponent(symbols.join(','))}` : '';
  try {
    const list = await api(`/corporate-actions?from=${today}${qs}`);
    $('#calendar').innerHTML = list.length ? `<thead><tr><th>Tarih</th><th>Sembol</th><th>Olay</th><th class="r">Hisse başı brüt</th><th class="r">Verim</th></tr></thead><tbody>${list.map((a) => {
      const q = state.quotes[a.code];
      const kind = [a.dpsGross > 0 ? 'Nakit temettü' : null, a.bonusPct > 0 ? `Bedelsiz %${num(a.bonusPct, 2)}` : null, a.rightsPct > 0 ? `Bedelli %${num(a.rightsPct, 2)}` : null].filter(Boolean).join(' · ') || '—';
      return `<tr class="click" data-s="${esc(a.code)}"><td>${dateTR(a.date)}</td><td class="mono"><b>${esc(a.code)}</b></td><td>${kind}</td><td class="r num">${a.dpsGross ? num(a.dpsGross, 4) + ' ₺' : ''}</td><td class="r num">${a.dpsGross && q?.price ? pct((a.dpsGross / q.price) * 100, 2, false) : ''}</td></tr>`;
    }).join('')}</tbody>` : `<tbody><tr><td class="dim">${calScope === 'all' ? 'İlan edilmiş yaklaşan olay yok' : 'Bu kapsamda ilan edilmiş yaklaşan temettü/sermaye artırımı yok'}</td></tr></tbody>`;
  } catch (e) { $('#calendar').innerHTML = `<tbody><tr><td class="dim">${esc(e.message)}</td></tr></tbody>`; }
}
$('#calendar').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) selectSymbol(r.dataset.s); });

async function loadIndices() {
  const list = await api('/market/indices').catch(() => []);
  $('#indices').innerHTML = list.map((x) => `<div data-s="${esc(x.symbol)}" style="background:${heatColor(x.changePct)}"><b>${esc(x.name || x.symbol)}</b>${price(x.price)} · ${pct(x.changePct)}</div>`).join('');
}
$('#indices').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) selectSymbol(r.dataset.s); });

function heatColor(p) {
  if (p == null) return 'var(--panel-2)';
  const a = Math.min(Math.abs(p) / 4, 1) * 0.55 + 0.08;
  return p >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
}

// ── Sinyal radarı ─────────────────────────────────
let radarFilter = null, radarData = null;
async function loadRadar() {
  $('#radarInfo').innerHTML = '<span class="spinner"></span> taranıyor…';
  try { radarData = await api('/market/radar'); drawRadar(); } catch (e) { $('#radarInfo').textContent = e.message; }
}
function drawRadar() {
  const r = radarData;
  if (!r) return;
  const watch = new Set(state.watchlist);
  $('#radarInfo').textContent = `${r.scanned} hisse · ${timeTR(r.at)}`;
  $('#radarChips').innerHTML = Object.entries(r.labels).filter(([k]) => r.counts[k]).map(([k, v]) => `<button class="pill ${v.dir === 'up' ? 'up' : v.dir === 'down' ? 'down' : ''}" data-k="${k}" style="cursor:pointer;${radarFilter === k ? 'outline:1px solid var(--accent)' : ''}">${esc(v.label)} · ${r.counts[k]}</button>`).join('');
  const rows = r.hits.filter((x) => !radarFilter || x.signals.includes(radarFilter)).sort((a, b) => watch.has(b.symbol) - watch.has(a.symbol));
  $('#radarTable').innerHTML = `<thead><tr><th>Sembol</th><th class="r">Fiyat</th><th class="r">Gün %</th><th class="r">RSI</th><th class="r">Hacim/ort.</th><th>Sinyaller</th></tr></thead><tbody>${rows.map((x) => `<tr class="click" data-s="${esc(x.symbol)}">
    <td class="mono"><b>${esc(x.symbol)}</b>${watch.has(x.symbol) ? ' <span class="pill acc">liste</span>' : ''}</td><td class="r num">${price(x.price)}</td><td class="r num ${cls(x.changePct)}">${pct(x.changePct)}</td>
    <td class="r num">${num(x.rsi, 0)}</td><td class="r num">${x.volRatio ? num(x.volRatio, 1) + '×' : '—'}</td>
    <td>${x.signals.map((k) => `<span class="pill ${r.labels[k].dir === 'up' ? 'up' : r.labels[k].dir === 'down' ? 'down' : ''}">${esc(r.labels[k].label)}</span>`).join(' ')}</td></tr>`).join('') || '<tr><td class="dim">Sinyal yok</td></tr>'}</tbody>`;
  $$('#radarChips [data-k]').forEach((b) => b.onclick = () => { radarFilter = radarFilter === b.dataset.k ? null : b.dataset.k; drawRadar(); });
}
$('#radarRun').onclick = loadRadar;
$('#radarTable').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) selectSymbol(r.dataset.s); });
$('#radarAsk').onclick = () => askAgent('signal_scan aracıyla BIST 100 sinyal taramasını çalıştır. İzleme listem ve portföyümdeki hisselerde çıkan sinyalleri öne alarak en dikkat çekici sinyalleri yorumla; hangi sinyallerin hacimle teyit edildiğini belirt.');

// ── Hisse tarayıcı ────────────────────────────────
async function runScreen(extra = {}) {
  const f = Object.fromEntries([...new FormData($('#scrForm'))].filter(([, v]) => v !== ''));
  Object.assign(f, extra);
  $('#scrTable').innerHTML = '<tbody><tr><td><div class="skeleton"></div></td></tr></tbody>';
  try {
    const r = await api(`/screen?${new URLSearchParams(f)}`);
    $('#scrTable').innerHTML = `<thead><tr><th>Kod</th><th>Ad</th><th>Sektör</th><th class="r">Kapanış</th><th class="r">PD (mn ₺)</th><th class="r">F/K</th><th class="r">PD/DD</th><th class="r">FD/FAVÖK</th><th class="r">YBB</th><th class="r">1A</th></tr></thead><tbody>${r.items.map((x) => `<tr class="click" data-s="${esc(x.code)}">
      <td class="mono"><b>${esc(x.code)}</b></td><td class="muted">${esc(x.name)}</td><td class="muted">${esc(x.sector)}</td><td class="r num">${price(x.close)}</td><td class="r num">${num(x.mcapMnTL, 0)}</td>
      <td class="r num">${num(x.pe, 1)}</td><td class="r num">${num(x.pb, 2)}</td><td class="r num">${num(x.evEbitda, 1)}</td><td class="r num ${cls(x.retYtd)}">${pct(x.retYtd, 1)}</td><td class="r num ${cls(x.ret1m)}">${pct(x.ret1m, 1)}</td></tr>`).join('') || '<tr><td colspan="10" class="dim">Koşullara uyan hisse yok</td></tr>'}</tbody>
      <tfoot><tr><td colspan="10" class="dim" style="font-weight:400">${r.count} hisse · veriler ${r.asOf ? dateTR(r.asOf, true) : ''} (önceki kapanış)</td></tr></tfoot>`;
  } catch (e) { $('#scrTable').innerHTML = `<tbody><tr><td class="dim">${esc(e.message)}</td></tr></tbody>`; }
}
$('#scrForm').onsubmit = (e) => { e.preventDefault(); runScreen(); };
$('#scrPresets').onclick = (e) => {
  const b = e.target.closest('[data-p]');
  if (!b) return;
  const f = $('#scrForm');
  f.reset();
  if (b.dataset.p === 'value') { f.pe_max.value = 8; f.pb_max.value = 1.5; f.sort.value = 'pe'; }
  if (b.dataset.p === 'ytd') { f.sort.value = 'ret_ytd'; }
  runScreen();
};
$('#scrTable').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) selectSymbol(r.dataset.s); });

on('symbol', () => { loadSymbol(); root.scrollTop = 0; });
on('quotes', (q) => { if (q[state.selected]) renderHead(); });
on('ready', () => { loadSymbol(); loadMovers(); loadIndices(); runScreen(); loadEconNews(); });
on('settings', () => { if (lastHist) drawChart(); });
on('watchlist:loaded', debounce(() => { if (calScope !== 'all') loadCalendar(); }, 300));
setInterval(() => { if (root.classList.contains('active') && !document.hidden) { loadMovers(); loadIndices(); } }, 60_000);
setInterval(() => { if (root.classList.contains('active') && !document.hidden) loadEconNews(); }, 10 * 60_000);

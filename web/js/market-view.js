// Piyasa görünümü: seçili sembol detayı + piyasa geneli
import { state, on, emit, api, $, $$, esc, md, num, price, pct, cls, compact, dateTR, css, toast, selectSymbol, askAgent, localGet, localSet, timeTR, srcTag, debounce, confirmBox, openPdfViewer } from './core.js';
import { baseOptions, makeChart } from './charts.js';
import { openTxModal } from './portfolio-view.js';
import { openKapDetail, signalPill } from './kap.js';
import { t, tx, lang } from './i18n.js';

const root = $('#view-market');
const RANGES = [['1d', t('1G')], ['5d', t('1H')], ['1mo', t('1A')], ['3mo', t('3A')], ['6mo', t('6A')], ['ytd', t('YBB')], ['1y', t('1Y')], ['5y', t('5Y')], ['max', t('Tümü')]];
let range = localGet('range', '6mo');
const overlays = new Set(localGet('overlays', ['sma20', 'sma50']));
let lower = localGet('lower', 'rsi');
let moversTab = 'gainers';
let calScope = localGet('calScope', 'watchlist');
let lastHist = null;
let symToken = 0;

// Sunucunun döndürdüğü sabit sektör adları (İş Yatırım + özel semboller) istemcide çevrilir
const sectorName = (s) => (s ? t(s) : '—');
// Çeyrek etiketi: '2024-Ç3' → EN '2024 Q3'; kümülatif dönem: '2024/9' → '2024 / 9 ay'
const qLabel = (p) => (lang === 'en' ? String(p).replace(/-Ç(\d)/, ' Q$1') : p);
const cumLabel = (p) => { const [y, m] = String(p).split('/'); return m ? t('{y} / {m} ay', { y, m }) : p; };
const sub = (s) => `<span class="dim" style="font-weight:400">${s}</span>`;

root.innerHTML = `
<div class="pad grid">
  <div class="card" id="symCard">
    <div class="row between">
      <div class="sym-head" id="symHead"></div>
      <div class="row">
        <button class="btn sec" id="bWatch">${t('＋ Listeye ekle')}</button>
        <button class="btn sec" id="bTx">${t('Portföye ekle')}</button>
        <button class="btn" id="bAsk">${t('Asistanla analiz et')}</button>
      </div>
    </div>
    <div class="row between" style="margin:10px 0 6px">
      <div class="seg" id="rangeSeg">${RANGES.map(([r, l]) => `<button data-r="${r}">${l}</button>`).join('')}</div>
      <div class="row">
        <div class="seg" id="ovSeg"><button data-o="sma20">SMA20</button><button data-o="sma50">SMA50</button><button data-o="sma200">SMA200</button><button data-o="bb">Bollinger</button><button data-o="vol">${t('Hacim')}</button></div>
        <div class="seg" id="lowSeg"><button data-l="rsi">RSI</button><button data-l="macd">MACD</button><button data-l="none" title="${t('Alt grafiği gizle')}">—</button></div>
      </div>
    </div>
    <div class="chart-box"><canvas id="mainChart"></canvas></div>
    <div class="chart-box sm" id="lowerBox"><canvas id="lowerChart"></canvas></div>
    <div class="dim" id="chartNote" style="font-size:11px;margin-top:4px"></div>
  </div>
  <div class="grid g3">
    <div class="card"><h3>${t('İstatistikler')}</h3><div class="stats" id="stats"></div></div>
    <div class="card"><h3>${t('Teknik görünüm')}</h3><div id="tech"></div></div>
    <div class="card"><h3>${t('Temel veriler')} <span class="dim" id="fundNote" style="font-weight:400"></span></h3><div id="fund"></div></div>
  </div>
  <div class="grid g2">
    <div class="card"><h3>${t('Haberler')}</h3><div class="news" id="news"></div></div>
    <div class="card"><h3><span>${t('KAP bildirimleri')} ${sub(t('son 30 gün'))}</span> <button class="ghost" id="bKapAll">${t('Tümü ›')}</button></h3><div id="symKap"></div></div>
  </div>
  <div id="finSum">
    <div class="grid g2">
      <div class="card"><h3>${t('Gelir tablosu özeti')} ${sub(t('mn TL'))}</h3><div id="finInc"></div></div>
      <div class="card"><h3>${t('Bilanço özeti')} ${sub(t('mn TL'))}</h3><div id="finBal"></div></div>
    </div>
    <div class="card" style="margin-top:12px"><div class="grid g3 fin-charts" id="finCharts"></div></div>
  </div>
  <details class="card fin-detail"><summary><h3>${t('Mali tablolar · ayrıntı')} <span class="dim" id="finNote" style="font-weight:400"></span> <span class="seg" id="finMode"><button data-m="q" class="active">${t('Çeyreklik')}</button><button data-m="c">${t('Kümülatif')}</button></span></h3></summary><div id="fin"></div></details>
  <div class="grid g2">
    <div class="card"><h3>${t('Kurum raporları')} <button class="ghost" id="bRepAll">${t('Tümü ›')}</button></h3><div id="symRep"></div></div>
    <div class="card"><h3 title="${t('Asistanın bu şirket için kaydettiği tez, kilit rakamlar ve tetikleyiciler')}">${t('Asistan notları')} <span class="dim" id="noteMeta" style="font-weight:400"></span></h3><div id="symNotes"></div></div>
  </div>
  <div class="card"><h3 title="${t('KAP’tan indirilen faaliyet raporları, finansal raporlar ve sunumlar')}">${t('Belgeler')}</h3><div id="symDocs"></div></div>
  <div class="grid g2">
    <div class="card"><h3>${t('Temettü ve sermaye artırımları')}</h3><div id="divs"></div></div>
    <div class="card">
      <h3>${t('BIST 100 · günün hareketlileri')} <span class="seg" id="movSeg"><button data-m="gainers">${t('Yükselenler')}</button><button data-m="losers">${t('Düşenler')}</button><button data-m="active">${t('Hacim')}</button></span></h3>
      <div id="breadth" style="margin-bottom:8px"></div>
      <div class="table-wrap" style="max-height:340px"><table class="t" id="movers"></table></div>
    </div>
  </div>
  <div class="grid g2">
    <div class="card"><h3>${t('Sektör performansı')} ${sub(t('BIST 100 ortalaması'))}</h3><div class="heat" id="sectors"></div></div>
    <div class="card"><h3><span>${t('Temettü takvimi')} ${sub(t('ilan edilenler'))}</span> <span class="seg" id="calSeg"><button data-c="watchlist">${t('Listem')}</button><button data-c="portfolio">${t('Portföyüm')}</button><button data-c="all">${t('Tümü')}</button></span></h3>
      <div class="table-wrap" style="max-height:300px"><table class="t" id="calendar"></table></div></div>
  </div>
  <div class="card"><h3><span>${t('Sinyal radarı')} ${sub(t('BIST 100 · günlük'))}</span> <span class="row" style="gap:6px"><span class="dim" id="radarInfo" style="font-weight:400"></span><button class="ghost" id="radarRun">${t('Tara')}</button><button class="ghost" id="radarAsk">${t('Asistanla yorumla')}</button></span></h3>
    <div class="row" id="radarChips" style="margin-bottom:8px"></div>
    <div class="table-wrap" style="max-height:320px"><table class="t" id="radarTable"><tbody><tr><td class="dim">${t('Taramayı başlatmak için “Tara”ya basın. İlk tarama yaklaşık 20 sn sürer; sonuçlar 15 dk saklanır.')}</td></tr></tbody></table></div>
  </div>
  <div class="card"><h3>${t('Hisse tarayıcı')} ${sub(t('İş Yatırım temel verileri · günlük'))}</h3>
    <form class="row" id="scrForm" style="margin-bottom:8px">
      <select name="index"><option value="BIST100">BIST 100</option><option value="BIST30">BIST 30</option><option value="TUM">${t('Tüm BIST')}</option></select>
      <input name="sector" placeholder="${t('Sektör adı içerir')}" style="width:130px">
      <input name="pe_max" type="number" step="any" placeholder="${t('F/K ≤')}" style="width:80px">
      <input name="pb_max" type="number" step="any" placeholder="${t('PD/DD ≤')}" style="width:80px">
      <input name="ev_ebitda_max" type="number" step="any" placeholder="${t('FD/FAVÖK ≤')}" style="width:100px">
      <input name="mcap_min_mn" type="number" step="any" placeholder="${t('Piyasa değeri ≥ (mn ₺)')}" title="${t('En düşük piyasa değeri, milyon ₺')}" style="width:150px">
      <select name="sort"><option value="mcap">${t('Piyasa değeri')}</option><option value="pe">${t('F/K (düşükten yükseğe)')}</option><option value="pb">${t('PD/DD (düşükten yükseğe)')}</option><option value="ev_ebitda">${t('FD/FAVÖK (düşükten yükseğe)')}</option><option value="ret_ytd">${t('YBB getiri')}</option><option value="ret_1m">${t('1 ay getiri')}</option></select>
      <button class="btn sec">${t('Tara')}</button>
      <span class="seg" id="scrPresets"><button type="button" data-p="value">${t('Ucuz (F/K ≤ 8, PD/DD ≤ 1,5)')}</button><button type="button" data-p="ytd">${t('YBB liderleri')}</button></span>
    </form>
    <div class="table-wrap" style="max-height:360px"><table class="t" id="scrTable"></table></div>
  </div>
  <div class="card"><h3>${t('Ekonomi haberleri')} <select id="newsSrc" style="font-weight:400"><option value="">${t('Tüm kaynaklar')}</option></select></h3><div class="news" id="econNews"></div></div>
  <div class="card"><h3>${t('Endeksler')} ${sub(t('Grafiği açmak için tıklayın'))}</h3><div class="heat" id="indices"></div></div>
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

$('#bWatch').onclick = async () => { try { await api('/watchlist', { method: 'POST', body: { symbol: state.selected } }); toast(t('{s} izleme listesine eklendi', { s: state.selected }), 'ok'); } catch (e) { toast(tx(e.message), 'err'); } };
$('#bTx').onclick = () => openTxModal({ symbol: state.selected, price: state.quotes[state.selected]?.price });
$('#bAsk').onclick = () => askAgent(t('{s} için analiz yap: güncel fiyat hareketi, teknik görünüm (trend, destek/direnç, RSI, MACD), temel oranlar (F/K, PD/DD, FD/FAVÖK), son KAP bildirimleri ve varsa portföyümdeki pozisyonumla ilişkisi. Sonunda kısa bir özet ver.', { s: state.selected }), { context: symbolContext() });
$('#bKapAll').onclick = () => { emit('kap:filter', { scope: 'symbol', symbol: state.selected }); emit('rtab', 'kap'); };

function symbolContext() {
  const q = state.quotes[state.selected];
  if (!q) return t('Seçili sembol: {s}', { s: state.selected });
  const vars = { s: state.selected, name: q.name, price: q.price, cur: q.currency, chg: q.changePct?.toFixed(2) };
  return q.delayed ? t('Seçili sembol: {s} ({name}), fiyat {price} {cur} (~15 dk gecikmeli), günlük %{chg}', vars) : t('Seçili sembol: {s} ({name}), fiyat {price} {cur}, günlük %{chg}', vars);
}

function renderHead() {
  const s = state.selected, q = state.quotes[s];
  const src = q ? [q.source, q.delayed ? t('~15 dk gecikmeli') : t('anlık'), timeTR(q.time)].filter(Boolean).join(' · ') : '';
  $('#symHead').innerHTML = `<div><div class="code">${esc(s)}</div><div class="name">${esc(q?.longName || q?.name || '')} ${q?.exchange ? `· ${esc(q.exchange)}` : ''}</div></div>
    <div class="price">${q ? price(q.price) : '…'} <span class="dim" style="font-size:13px">${esc(q?.currency || '')}</span></div>
    <div class="chg ${cls(q?.change)}">${q?.change != null ? `${q.change > 0 ? '+' : ''}${price(q.change)} (${pct(q.changePct)})` : ''}</div>
    ${q ? `<div class="dim" style="font-size:11px">${esc(src)}${q.bid ? ` · ${t('alış {bid} / satış {ask}', { bid: price(q.bid), ask: price(q.ask) })}` : ''}</div>` : ''}`;
  $('#stats').innerHTML = q ? [
    [t('Önceki kapanış'), price(q.prevClose)], [t('Gün içi düşük'), price(q.dayLow)], [t('Gün içi yüksek'), price(q.dayHigh)],
    [t('52 hafta düşük'), price(q.low52)], [t('52 hafta yüksek'), price(q.high52)], [t('Hacim (adet)'), compact(q.volume)],
    [t('İşlem hacmi (≈)'), q.volume && q.price ? compact(q.volume * q.price) : '—'],
    [t('52 hafta zirvesine uzaklık'), q.high52 ? pct((q.price / q.high52 - 1) * 100) : '—'],
  ].map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`).join('') : `<div class="dim">${t('Veri yok')}</div>`;
}

async function loadSymbol() {
  const s = state.selected;
  const tok = ++symToken;
  const fresh = () => tok === symToken;
  renderHead();
  api(`/quote/${encodeURIComponent(s)}`).then((q) => { if (q && fresh()) { state.quotes[s] = q; renderHead(); } }).catch(() => {});
  loadChart();
  $('#tech').innerHTML = '<div class="skeleton"></div>';
  api(`/technical/${encodeURIComponent(s)}`).then((tc) => {
    if (!fresh()) return;
    if (tc.error) { $('#tech').innerHTML = `<div class="dim">${esc(tx(tc.error))}</div>`; return; }
    $('#tech').innerHTML = `<div class="stats" style="margin-bottom:8px">${[
      ['RSI(14)', num(tc.rsi14, 1)], ['SMA20', price(tc.sma20)], ['SMA50', price(tc.sma50)], ['SMA200', price(tc.sma200)],
      [t('MACD histogramı'), num(tc.macdHist, 3)], ['ATR(14)', price(tc.atr14)], [t('Volatilite (60 gün)'), pct(tc.volatility60dAnnualPct, 1, false)],
      [t('1 ay getiri'), `<span class="${cls(tc.return1m)}">${pct(tc.return1m)}</span>`], [t('3 ay getiri'), `<span class="${cls(tc.return3m)}">${pct(tc.return3m)}</span>`], [t('1 yıl getiri'), `<span class="${cls(tc.return1y)}">${pct(tc.return1y)}</span>`],
    ].map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`).join('')}</div><ul class="signals">${tc.signals.map((x) => `<li>${esc(tx(x))}</li>`).join('')}</ul>`;
  }).catch((e) => { if (fresh()) $('#tech').innerHTML = `<div class="dim">${esc(tx(e.message))}</div>`; });

  $('#fund').innerHTML = '<div class="skeleton"></div>';
  $('#divs').innerHTML = '<div class="skeleton"></div>';
  api(`/fundamentals/${encodeURIComponent(s)}`).then((f) => {
    if (!fresh()) return;
    if (!f) {
      $('#fundNote').textContent = '';
      $('#fund').innerHTML = `<div class="dim">${t('Temel veriler yalnızca BIST hisseleri için var.')}</div>`;
      loadYahooDividends(s, fresh);
      return;
    }
    $('#fundNote').textContent = f.period ? t('İş Yatırım · son dönem {p}', { p: f.period }) : 'İş Yatırım';
    const prem = (v) => (v == null ? '' : ` <span class="${v < 0 ? 'up' : 'down'}" title="${t('Tahmine göre prim (+) / iskonto (−)')}">${pct(v, 1)}</span>`);
    $('#fund').innerHTML = `<div class="stats">${[
      [t('Sektör'), esc(sectorName(f.sector))], [t('Piyasa değeri'), `${compact(f.mcapTL)} ₺`], [t('Piyasa değeri ($)'), `${compact(f.mcapUSD)} $`], [t('Halka açıklık'), pct(f.freeFloatPct, 1, false)],
      [t('F/K'), num(f.pe, 1)], [t('FD/FAVÖK'), num(f.evEbitda, 1)], [t('FD/Satışlar'), num(f.evSales, 1)], [t('PD/DD'), num(f.pb, 2)],
      ...(f.peF != null ? [[t('Tahmini F/K'), num(f.peF, 1) + prem(f.pePrem)], [t('Tahmini FD/FAVÖK'), num(f.evEbitdaF, 1) + prem(f.evEbitdaPrem)], [t('Tahmini PD/DD'), num(f.pbF, 2) + prem(f.pbPrem)]] : []),
      [t('Haftalık getiri'), `<span class="${cls(f.ret1w)}">${pct(f.ret1w)}</span>`], [t('Aylık getiri'), `<span class="${cls(f.ret1m)}">${pct(f.ret1m)}</span>`], [t('Yıl içi getiri'), `<span class="${cls(f.retYtd)}">${pct(f.retYtd)}</span>`],
    ].map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`).join('')}</div>`;
    renderActions(f.actions || []);
    if (!(f.actions || []).length) loadYahooDividends(s, fresh);
  }).catch((e) => { if (fresh()) $('#fund').innerHTML = `<div class="dim">${esc(tx(e.message))}</div>`; });

  loadSymNews(s, fresh, true);

  loadNotes(s, fresh);
  loadFinancials(s, fresh);
  loadSymReports(s, fresh);
  loadSymKap(s, fresh, true);
}
$('#symKap').addEventListener('click', (e) => { const a = e.target.closest('[data-kap]'); if (a) { e.preventDefault(); openKapDetail(Number(a.dataset.kap)); } });

// Mali tablolar (İş Yatırım, KAP finansalları)
let finData = null, finMode = localGet('finMode', 'q');
const bn = (v) => (v == null ? '—' : num(v / 1e9, Math.abs(v) >= 1e11 ? 0 : 1));
function drawFin() {
  const f = finData;
  if (!f) return;
  $$('#finMode button').forEach((b) => b.classList.toggle('active', b.dataset.m === finMode));
  const rows = finMode === 'q' ? f.quarterly.map((r) => ({ ...r, period: qLabel(r.period) })) : f.cumulative.map((r) => ({ ...r, period: cumLabel(r.period) }));
  const cols = rows.slice(0, 8);
  const pctOf = (a, b) => (a != null && b ? `${num((a / b) * 100, 1)}%` : '—');
  const lines = f.type === 'banka'
    ? [[t('Net faiz geliri'), 'netInterest'], [t('Net ücret ve komisyon'), 'fees'], [t('Kredi karşılıkları'), 'provisions'], [t('Net faaliyet kârı'), 'operatingProfit'], [t('Net kâr'), 'netIncome', true]]
    : [[t('Hasılat'), 'sales'], [t('Brüt kâr'), 'grossProfit'], [t('FAVÖK'), 'ebitda'], [t('Faaliyet kârı'), 'operatingProfit'], [t('Net kâr (ana ortaklık)'), 'netIncome', true], [t('İşletme nakit akışı'), 'opCashFlow']];
  const margin = f.type === 'banka' ? [] : [[t('Brüt marj'), (r) => pctOf(r.grossProfit, r.sales)], [t('FAVÖK marjı'), (r) => pctOf(r.ebitda ?? (r.operatingProfit != null && r.depreciation != null ? r.operatingProfit + r.depreciation : null), r.sales)], [t('Net marj'), (r) => pctOf(r.netIncome, r.sales)]];
  const bal = f.cumulative.slice(0, 8);
  const balLines = f.type === 'banka' ? [[t('Krediler'), 'loans'], [t('Mevduat'), 'deposits'], [t('Özkaynak'), 'equity'], [t('Toplam varlık'), 'totalAssets']] : [[t('Net borç'), 'netDebt'], [t('Özkaynak (ana ortaklık)'), 'equity'], [t('Toplam varlık'), 'totalAssets'], [t('Net döviz pozisyonu'), 'netFx']];
  $('#fin').innerHTML = `<div class="table-wrap"><table class="t fin-table"><thead><tr><th>${t('milyar TL')}</th>${cols.map((r) => `<th class="r">${esc(r.period)}</th>`).join('')}</tr></thead><tbody>
    ${lines.map(([l, k, b]) => `<tr><td>${b ? `<b>${l}</b>` : l}</td>${cols.map((r) => `<td class="r num ${r[k] < 0 ? 'down' : ''}">${bn(r[k])}</td>`).join('')}</tr>`).join('')}
    ${finMode === 'q' || f.type === 'banka' ? '' : margin.map(([l, fn]) => `<tr class="dim"><td>${l}</td>${cols.map((r) => `<td class="r num">${fn(r)}</td>`).join('')}</tr>`).join('')}
    ${finMode === 'q' && f.type !== 'banka' ? margin.map(([l, fn]) => `<tr class="dim"><td>${l}</td>${cols.map((r) => `<td class="r num">${fn(r)}</td>`).join('')}</tr>`).join('') : ''}
    <tr><td colspan="${cols.length + 1}" class="mini-head" style="padding-top:8px">${t('Bilanço (dönem sonu)')}</td></tr>
    ${balLines.map(([l, k]) => `<tr><td>${l}</td>${bal.map((r) => `<td class="r num ${r[k] < 0 ? 'down' : ''}">${bn(r[k])}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}
// Özet gelir tablosu (son dönem, geçen yılın aynı dönemiyle), özet bilanço (önceki çeyrekle), çeyreklik grafikler
const mn = (v) => (v == null ? '—' : num(v / 1e6, Math.abs(v) < 1e8 ? 1 : 0));
const shortTL = (v) => (Math.abs(v) >= 1e9 ? t('{v} mr', { v: num(v / 1e9, 1) }) : Math.abs(v) >= 1e6 ? t('{v} mn', { v: num(v / 1e6, 1) }) : num(v, 0));
function chg(a, b, lowerIsBetter = false) {
  if (a == null || b == null || b === 0) return '<td class="r num dim">—</td>';
  if (a < 0 || b < 0) return `<td class="r num dim" title="${t('Negatif değerlerde değişim anlamlı değil')}">—</td>`;
  const p = (a / b - 1) * 100;
  const good = lowerIsBetter ? p < 0 : p > 0;
  if (Math.abs(p) < 0.5) return '<td class="r num">0%</td>';
  return `<td class="r num ${good ? 'up' : 'down'}">${p > 0 ? '+' : ''}${num(p, 0)}%</td>`;
}
function sumTable(el, cur, prev, lines) {
  el.innerHTML = cur && prev ? `<table class="t fin-sum"><thead><tr><th></th><th class="r">${esc(cumLabel(cur.period))}</th><th class="r">${esc(cumLabel(prev.period))}</th><th class="r">%</th></tr></thead><tbody>
    ${lines.map(([l, k, inv, tip]) => `<tr><td${tip ? ` title="${esc(tip)}"` : ''}>${l}</td><td class="r num">${mn(cur[k])}</td><td class="r num">${mn(prev[k])}</td>${chg(cur[k], prev[k], inv)}</tr>`).join('')}</tbody></table>`
    : `<div class="dim">${t('Karşılaştırma için yeterli dönem yok.')}</div>`;
}
function drawFinSummary(f) {
  const bank = f.type === 'banka';
  const cur = f.cumulative[0];
  const [y, m] = (cur?.period || '0/0').split('/').map(Number);
  sumTable($('#finInc'), cur, f.cumulative.find((r) => r.period === `${y - 1}/${m}`), bank
    ? [[t('Net faiz geliri'), 'netInterest'], [t('Net ücret ve komisyon'), 'fees'], [t('Kredi karşılıkları'), 'provisions', true], [t('Vergi öncesi kâr'), 'pretax'], [t('Net dönem kârı'), 'netIncome']]
    : [[t('Hasılat'), 'sales'], [t('Brüt kâr'), 'grossProfit'], [t('FAVÖK'), 'ebitda'], [t('Net parasal pozisyon kazançları (kayıpları)'), 'monetaryGain', false, t('Vergi öncesi diğer gelir ve giderler satırı; enflasyon muhasebesi uygulayan şirketlerde net parasal pozisyon kazancı ya da kaybı')], [t('Net dönem kârı'), 'netIncome']]);
  sumTable($('#finBal'), cur, f.cumulative[1], bank
    ? [[t('Krediler'), 'loans'], [t('Mevduat'), 'deposits'], [t('Toplam varlıklar'), 'totalAssets'], [t('Özkaynaklar'), 'equity']]
    : [[t('Dönen varlıklar'), 'currentAssets'], [t('Duran varlıklar'), 'nonCurrentAssets'], [t('Toplam varlıklar'), 'totalAssets'], [t('Net borç'), 'netDebt', true], [t('Özkaynaklar'), 'equity']]);
  const qs = f.quarterly.filter((q) => q[bank ? 'netInterest' : 'sales'] != null).slice(0, 5).reverse();
  const charts = bank ? [[t('Çeyreklik net faiz geliri'), 'netInterest'], [t('Çeyreklik faaliyet kârı'), 'operatingProfit'], [t('Çeyreklik net kâr'), 'netIncome']]
    : [[t('Çeyreklik hasılat'), 'sales'], [t('Çeyreklik FAVÖK'), 'ebitda'], [t('Çeyreklik net kâr'), 'netIncome']];
  $('#finCharts').innerHTML = charts.map(([title], i) => `<div><h3>${title}</h3><div class="chart-box fin-chart"><canvas id="fc${i}"></canvas></div></div>`).join('');
  const blue = '#4f7ee8', red = css('--down');
  charts.forEach(([title, k], i) => {
    const data = qs.map((q) => q[k]);
    const o = baseOptions({ time: false, yRight: false });
    o.scales.x.grid = { display: false };
    o.scales.x.ticks = { ...o.scales.x.ticks, maxRotation: 0, autoSkip: false, font: { size: 10 } };
    o.scales.y.ticks = { ...o.scales.y.ticks, maxTicksLimit: 6 };
    o.scales.y.ticks.callback = (v) => shortTL(v);
    o.plugins.tooltip.callbacks = { label: (c) => t('{v} TL', { v: shortTL(c.parsed.y) }) };
    makeChart($(`#fc${i}`), { type: 'bar', data: { labels: qs.map((q) => q.label), datasets: [{ label: title, data, backgroundColor: data.map((v) => (v < 0 ? red : blue)), borderRadius: 4, maxBarThickness: 44 }] }, options: o });
  });
}
// Sembol haberleri ve KAP kartı: seçimde ve piyasa görünümü açıkken 5 dakikada bir kendiliğinden yenilenir
function loadSymNews(s, fresh = () => true, first = false) {
  if (first) $('#news').innerHTML = '<div class="skeleton"></div>';
  Promise.all([api(`/news?q=${encodeURIComponent(s)}`).catch(() => []), api(`/newsfeed?symbol=${encodeURIComponent(s)}&limit=10`).then((r) => r.items.map((x) => ({ title: x.title, publisher: x.source, link: x.link, time: x.time }))).catch(() => [])]).then(([g, f]) => {
    if (!fresh()) return;
    const seen = new Set();
    const n = [...f, ...g].filter((x) => { const k = x.title.toLocaleLowerCase('tr').slice(0, 50); return seen.has(k) ? false : seen.add(k); }).sort((a, b) => (b.time || 0) - (a.time || 0));
    $('#news').innerHTML = n.length ? n.slice(0, 10).map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}<br><small>${esc(x.publisher)} · ${dateTR(x.time, true)}</small></a>`).join('') : `<div class="dim">${t('Haber bulunamadı')}</div>`;
  });

}
function loadSymKap(s, fresh = () => true, first = false) {
  if (first) $('#symKap').innerHTML = '<div class="skeleton"></div>';
  api(`/kap?scope=symbol&symbol=${encodeURIComponent(s)}&days=30&limit=12`).then((k) => {
    if (!fresh()) return;
    $('#symKap').innerHTML = k.items.length ? `<div class="news">${k.items.map((x) => `<a href="${esc(x.url)}" data-kap="${x.id}">${signalPill(x.signal)} ${esc(x.subject)}${x.summary ? ` — <span class="muted">${esc(x.summary)}</span>` : ''}<br><small>${esc(tx(x.clsLabel))} · ${esc(x.publishDate)}</small></a>`).join('')}</div>`
      : `<div class="dim">${k.error ? esc(tx(k.error)) : t('Son 30 günde bildirim yok')}</div>`;
  }).catch(() => { if (fresh()) $('#symKap').innerHTML = `<div class="dim">${t('KAP bildirimleri alınamadı')}</div>`; });
}
setInterval(() => {
  const s = state.selected;
  if (!s || !root.classList.contains('active') || document.hidden) return;
  const same = () => state.selected === s;
  loadSymNews(s, same); loadSymKap(s, same); loadSymReports(s, same);
}, 5 * 60_000);

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
    $('#finNote').textContent = [tx(f.source), t('son dönem {p}', { p: cumLabel(f.latest) }), f.type === 'banka' ? t('banka') : ''].filter(Boolean).join(' · ');
    drawFin();
  } catch (e) { if (fresh()) { $('#finSum').hidden = true; $('#finNote').textContent = ''; $('#fin').innerHTML = `<div class="dim">${esc(e.message.includes('bulunamadı') ? t('Mali tablolar yalnızca BIST şirketleri için var.') : tx(e.message))}</div>`; } }
}
$('#finMode').onclick = (e) => { e.preventDefault(); const b = e.target.closest('[data-m]'); if (!b) return; finMode = b.dataset.m; localSet('finMode', finMode); drawFin(); };

// Sembolün aracı kurum raporları
async function loadSymReports(s, fresh = () => true) {
  $('#symRep').innerHTML = '<div class="skeleton"></div>';
  try {
    const r = await api(`/research?symbol=${encodeURIComponent(s)}&days=365&limit=8`);
    if (!fresh()) return;
    $('#symRep').innerHTML = r.items.length ? `<div class="news">${r.items.map((x) => `<a href="#" data-rep="${esc(x.id)}">${esc(x.title)}${x.isNew ? ` <span class="pill acc">${t('yeni')}</span>` : ''}${x.summary ? `<br><span class="muted">${esc(x.summary.slice(0, 160))}${x.summary.length > 160 ? '…' : ''}</span>` : ''}<br><small>${esc(x.broker)} · ${dateTR(x.date)} · ${esc(tx(x.category))}</small></a>`).join('')}</div>`
      : `<div class="dim">${t('Son bir yılda bu şirket için erişilebilir kurum raporu yok.')}</div>`;
    $$('[data-rep]', $('#symRep')).forEach((a) => a.onclick = (e) => {
      e.preventDefault();
      const x = r.items.find((i) => i.id === a.dataset.rep);
      if (x.access === 'web') { window.open(x.page, '_blank', 'noopener'); return; }
      openPdfViewer({ src: `/api/research/file?id=${encodeURIComponent(x.id)}`, title: `${x.broker} · ${x.title}`, name: `${x.title}.pdf`, actions: [
        { label: t('Arşive kaydet'), run: async () => { try { const s2 = await api('/research/save', { method: 'POST', body: { id: x.id } }); toast(t('Kaydedildi: {name}', { name: s2.name }), 'ok'); } catch (err) { toast(tx(err.message), 'err'); } } },
        { label: t('Asistanla analiz et'), run: (m) => { m.close(); askAgent(t('read_broker_report ile "{id}" kimlikli {broker} raporunu ({title}) oku ve analiz et: tez, tavsiye ve hedef fiyat, tahminler, riskler; güncel verilerle karşılaştır ve kendi görüşünle değerlendir.', { id: x.id, broker: x.broker, title: x.title })); } },
      ] });
    });
  } catch (e) { if (fresh()) $('#symRep').innerHTML = `<div class="dim">${esc(tx(e.message))}</div>`; }
}
$('#bRepAll').onclick = () => emit('research:symbol', state.selected);

// Ekonomi haberleri (RSS)
async function loadEconNews() {
  const src = $('#newsSrc').value;
  try {
    const r = await api(`/newsfeed?limit=25${src ? `&sources=${src}` : ''}`);
    if ($('#newsSrc').options.length <= 1) $('#newsSrc').innerHTML += Object.entries(r.sources).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    $('#econNews').innerHTML = r.items.map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}<br><small>${esc(x.source)} · ${dateTR(x.time, true)}</small></a>`).join('') || `<div class="dim">${t('Haberler alınamadı')}</div>`;
  } catch (e) { $('#econNews').innerHTML = `<div class="dim">${esc(tx(e.message))}</div>`; }
}
$('#newsSrc').onchange = loadEconNews;

// Ajan notları (araştırma hafızası) ve şirket belge arşivi
async function loadNotes(s, fresh = () => true) {
  const [n, docs] = await Promise.all([api(`/memory/sirket/${encodeURIComponent(s)}`).catch(() => null), api(`/documents?symbol=${encodeURIComponent(s)}`).catch(() => [])]);
  if (!fresh()) return;
  if (n?.content) {
    const body = n.content.replace(/^# .*\n+/, '');
    $('#noteMeta').textContent = t('güncelleme: {d}', { d: dateTR(n.updatedAt, true) });
    $('#symNotes').innerHTML = `<div class="msg assistant note-body${body.length > 1400 ? ' clamp' : ''}">${md(body)}</div>
      <div class="row" style="margin-top:6px">${body.length > 1400 ? `<button class="ghost" id="noteMore">${t('Tamamını göster')}</button>` : ''}<button class="ghost" id="noteUpd">${t('Asistanla güncelle')}</button><button class="ghost" id="noteDel">${t('Sil')}</button></div>`;
    $('#noteMore')?.addEventListener('click', (e) => { $('#symNotes .note-body').classList.remove('clamp'); e.target.remove(); });
    $('#noteUpd').onclick = () => askAgent(t('{s} için kayıtlı araştırma notunu güncel fiyat, temel veriler ve son KAP bildirimleriyle gözden geçir; tetikleyicilerin durumunu değerlendir ve save_memory ile güncelle.', { s }));
    $('#noteDel').onclick = async () => { if (!(await confirmBox(t('{s} için asistan notu silinsin mi?', { s }), { danger: true, ok: t('Sil') }))) return; await api(`/memory/sirket/${encodeURIComponent(s)}`, { method: 'DELETE' }); loadNotes(s); };
  } else {
    $('#noteMeta').textContent = '';
    $('#symNotes').innerHTML = `<div class="dim">${t('Bu şirket için kayıtlı asistan notu yok. Asistan analizden sonra tezi, kilit rakamları ve tetikleyicileri buraya kaydeder.')}</div><button class="ghost" id="noteNew" style="margin-top:6px">${t('Asistanla analiz et ve not al')}</button>`;
    $('#noteNew').onclick = () => askAgent(t('{s} için kapsamlı analiz yap (hisse-analizi becerisi) ve sonunda save_memory ile tezi, kilit rakamları ve tetikleyicileri kaydet.', { s }));
  }
  $('#symDocs').innerHTML = `${docs.length ? `<table class="t"><tbody>${docs.slice(0, 8).map((d, i) => `<tr class="click" data-doc="${i}"><td>📄 ${esc(d.name)}</td><td class="r dim">${dateTR(d.savedAt)}</td><td class="r dim">${Math.max(1, Math.round(d.size / 1024))} KB</td></tr>`).join('')}</tbody></table>` : `<div class="dim">${t('Arşivde belge yok.')}</div>`}
    <button class="ghost" id="docFetch" style="margin-top:6px">${t('Asistanla son faaliyet raporunu ve sunumu getir')}</button>`;
  $$('[data-doc]', $('#symDocs')).forEach((r) => r.onclick = () => {
    const d = docs[Number(r.dataset.doc)];
    openPdfViewer({ src: `/api/documents/file?path=${encodeURIComponent(d.path)}`, title: d.name, name: d.name, actions: [{ label: t('Asistanla oku'), run: (m) => { m.close(); askAgent(t('{path} belgesini pdf-okuma becerisiyle oku; {s} için ana bulguları ve rakamları (sayfa numarasıyla) özetle.', { path: d.path, s })); } }] });
  });
  $('#docFetch').onclick = () => askAgent(t('{s} için son faaliyet raporunu, son finansal raporu ve varsa yatırımcı sunumunu KAP’tan bul, arşive indir (sirket-belgeleri becerisi) ve öne çıkanları özetle.', { s }));
}
on('ws:memory.changed', () => { if (state.selected) loadNotes(state.selected); });
on('ws:documents.changed', () => { if (state.selected) loadNotes(state.selected); });

// Temettü ve sermaye artırımları: taşmayan liste (tarih · olay · tutar), dar kartta alt satıra kırılır
function caList(rows, note) {
  return `<div class="ca-list">${rows.map((r) => `<div class="ca-row"><div class="ca-date">${r.date}${r.soon ? ` <span class="pill acc">${t('yaklaşan')}</span>` : ''}</div>
    <div class="ca-what"><span class="ca-kind ${r.cls || ''}">${esc(r.kind)}</span>${r.detail ? ` <span class="muted">${r.detail}</span>` : ''}</div><div class="ca-amt num">${r.amount || ''}</div></div>`).join('')}</div>
    <div class="dim ca-note">${note}</div>`;
}
function renderActions(acts) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const a of [...acts].reverse().slice(0, 10)) {
    const base = { date: dateTR(a.date), soon: a.date >= today };
    if (a.dpsGross > 0) rows.push({ ...base, kind: t('Nakit temettü'), cls: 'div', detail: t('{v} ₺ / hisse', { v: num(a.dpsGross, 4) }), amount: a.cashTotal ? `${compact(a.cashTotal)} ₺` : '' });
    if (a.bonusPct > 0) rows.push({ ...base, kind: t('Bedelsiz'), cls: 'cap', detail: t('%{v}', { v: num(a.bonusPct, 2) }) });
    if (a.bonusDivPct > 0) rows.push({ ...base, kind: t('Bedelsiz (temettüden)'), cls: 'cap', detail: t('%{v}', { v: num(a.bonusDivPct, 2) }) });
    if (a.rightsPct > 0) rows.push({ ...base, kind: t('Bedelli'), cls: 'cap', detail: t('%{v}', { v: num(a.rightsPct, 2) }) });
  }
  $('#divs').innerHTML = rows.length ? caList(rows, t('Kaynak: İş Yatırım · bu yıl ve ilan edilenler · brüt tutarlar')) : `<div class="dim">${t('Bu yıl kayıt yok')}</div>`;
}

function loadYahooDividends(s, fresh) {
  api(`/dividends/${encodeURIComponent(s)}`).then((d) => {
    if (!fresh()) return;
    const rows = [
      ...d.dividends.slice(-8).reverse().map((x) => ({ date: dateTR(x.date), kind: t('Nakit temettü'), cls: 'div', detail: t('{v} / hisse', { v: num(x.amount, 4) }), ts: x.date })),
      ...d.splits.slice(-4).reverse().map((x) => ({ date: dateTR(x.date), kind: t('Bölünme / bedelsiz'), cls: 'cap', detail: esc(x.text || num(x.ratio, 3)), ts: x.date })),
    ].sort((a, b) => b.ts.localeCompare(a.ts));
    $('#divs').innerHTML = rows.length ? caList(rows, t('Kaynak: Yahoo Finance · son 5 yıl')) : `<div class="dim">${t('Son 5 yılda kayıt yok')}</div>`;
  }).catch(() => { if (fresh()) $('#divs').innerHTML = `<div class="dim">${t('Veri yok')}</div>`; });
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
      ? t('Geçmiş seri, vadeli ons altın × USD/TL üzerinden türetilip güncel serbest piyasa fiyatına ölçeklenmiştir.')
      : q?.delayed ? t('BIST verileri ~15 dk gecikmelidir.') : '';
  } catch (e) {
    lastHist = null;
    makeChart($('#mainChart'), { type: 'line', data: { datasets: [] }, options: baseOptions() });
    toast(`${s}: ${tx(e.message)}`, 'err');
  }
}

function drawChart() {
  if (!lastHist) return;
  const { bars, indicators: ind } = lastHist;
  const ts = bars.map((b) => b.t);
  const pts = (arr) => arr.map((v, i) => ({ x: ts[i], y: v }));
  const first = bars[0]?.c, last = bars.at(-1)?.c;
  const color = last >= first ? css('--up') : css('--down');
  const ds = [{
    label: state.selected, data: pts(bars.map((b) => b.c)), borderColor: color, borderWidth: 1.6, pointRadius: 0, tension: 0.1, yAxisID: 'y',
    fill: { target: 'origin', above: color + '18' },
  }];
  const ovColors = { sma20: css('--accent'), sma50: css('--info'), sma200: css('--violet') };
  for (const k of ['sma20', 'sma50', 'sma200']) if (overlays.has(k)) ds.push({ label: k.toUpperCase(), data: pts(ind[k]), borderColor: ovColors[k], borderWidth: 1, pointRadius: 0, yAxisID: 'y' });
  const bbUp = t('BB üst');
  if (overlays.has('bb')) {
    ds.push({ label: bbUp, data: pts(ind.bbUpper), borderColor: css('--text-3'), borderDash: [4, 3], borderWidth: 1, pointRadius: 0, yAxisID: 'y' });
    ds.push({ label: t('BB alt'), data: pts(ind.bbLower), borderColor: css('--text-3'), borderDash: [4, 3], borderWidth: 1, pointRadius: 0, yAxisID: 'y' });
  }
  const opts = baseOptions({ legend: overlays.size > 0 });
  if (overlays.has('vol') && bars.some((b) => b.v)) {
    ds.push({ type: 'bar', label: t('Hacim'), data: pts(bars.map((b) => b.v)), backgroundColor: css('--line-2'), yAxisID: 'v', barPercentage: 1, categoryPercentage: 1 });
    opts.scales.v = { display: false, beginAtZero: true, max: Math.max(...bars.map((b) => b.v)) * 4 };
  }
  opts.plugins.legend.labels.filter = (i) => !i.text.startsWith('BB') || i.text === bbUp;
  makeChart($('#mainChart'), { type: 'line', data: { datasets: ds }, options: opts });

  if (lower === 'none') return;
  const lopt = baseOptions();
  let lds;
  if (lower === 'rsi') {
    lds = [{ label: 'RSI(14)', data: pts(ind.rsi14), borderColor: css('--violet'), borderWidth: 1.2, pointRadius: 0 }];
    lopt.scales.y.min = 0; lopt.scales.y.max = 100;
    lopt.scales.y.ticks.stepSize = 30;
    lds.push({ label: '70', data: ts.map((x) => ({ x, y: 70 })), borderColor: css('--down') + '88', borderDash: [3, 3], borderWidth: 1, pointRadius: 0 });
    lds.push({ label: '30', data: ts.map((x) => ({ x, y: 30 })), borderColor: css('--up') + '88', borderDash: [3, 3], borderWidth: 1, pointRadius: 0 });
  } else {
    lds = [
      { type: 'bar', label: 'Histogram', data: pts(ind.macdHist), backgroundColor: ind.macdHist.map((v) => (v >= 0 ? css('--up') + '99' : css('--down') + '99')) },
      { label: 'MACD', data: pts(ind.macd), borderColor: css('--info'), borderWidth: 1.2, pointRadius: 0 },
      { label: t('Sinyal'), data: pts(ind.macdSignal), borderColor: css('--accent'), borderWidth: 1.2, pointRadius: 0 },
    ];
  }
  makeChart($('#lowerChart'), { type: 'line', data: { datasets: lds }, options: lopt });
}

async function loadMovers() {
  try {
    const m = await api('/market/movers');
    const list = m[moversTab];
    $('#movers').innerHTML = `<thead><tr><th>${t('Sembol')}</th><th>${t('Ad')}</th><th class="r">${t('Fiyat')}</th><th class="r">${t('Değişim')}</th><th class="r">${t('İşlem hacmi (≈)')}</th></tr></thead><tbody>${list.map((x) => `<tr class="click" data-s="${esc(x.symbol)}"><td class="mono"><b>${esc(x.symbol)}</b></td><td class="muted">${esc(x.name)}</td><td class="r num">${price(x.price)}</td><td class="r num ${cls(x.changePct)}">${pct(x.changePct)}</td><td class="r num">${compact(x.turnover)}</td></tr>`).join('')}</tbody>`;
    const b = m.breadth, tot = b.up + b.down + b.flat || 1;
    $('#breadth').innerHTML = `<div class="row between" style="font-size:11px"><span class="up">▲ ${t('{n} yükselen', { n: b.up })}</span><span class="dim">${t('{n} değişmeyen', { n: b.flat })} · ${t('{a}/{b} hisse', { a: m.priced, b: m.universe })} · ${timeTR(m.asOf)} (${t('~15 dk gecikmeli')})</span><span class="down">${t('{n} düşen', { n: b.down })} ▼</span></div>
      <div class="bar" style="display:flex;margin-top:4px"><i style="width:${(b.up / tot) * 100}%;background:var(--up)"></i><i style="width:${(b.flat / tot) * 100}%;background:var(--text-3)"></i><i style="width:${(b.down / tot) * 100}%;background:var(--down)"></i></div>`;
    $('#sectors').innerHTML = m.sectors.map((x) => `<div style="background:${heatColor(x.avgPct)}" title="${esc((x.members || []).join(', '))}"><b>${pct(x.avgPct)}</b>${esc(sectorName(x.sector))} <span class="dim">(${x.count})</span></div>`).join('');
  } catch (e) {
    $('#movers').innerHTML = `<tr><td class="dim">${esc(tx(e.message))}</td></tr>`;
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
    $('#calendar').innerHTML = `<tbody><tr><td class="dim">${calScope === 'portfolio' ? t('Portföy boş') : t('İzleme listesi boş')}</td></tr></tbody>`;
    return;
  }
  const qs = symbols ? `&symbols=${encodeURIComponent(symbols.join(','))}` : '';
  try {
    const list = await api(`/corporate-actions?from=${today}${qs}`);
    $('#calendar').innerHTML = list.length ? `<thead><tr><th>${t('Tarih')}</th><th>${t('Sembol')}</th><th>${t('Olay')}</th><th class="r">${t('Hisse başı brüt')}</th><th class="r">${t('Verim')}</th></tr></thead><tbody>${list.map((a) => {
      const q = state.quotes[a.code];
      const kind = [a.dpsGross > 0 ? t('Nakit temettü') : null, a.bonusPct > 0 ? t('Bedelsiz %{v}', { v: num(a.bonusPct, 2) }) : null, a.rightsPct > 0 ? t('Bedelli %{v}', { v: num(a.rightsPct, 2) }) : null].filter(Boolean).join(' · ') || '—';
      return `<tr class="click" data-s="${esc(a.code)}"><td>${dateTR(a.date)}</td><td class="mono"><b>${esc(a.code)}</b></td><td>${kind}</td><td class="r num">${a.dpsGross ? num(a.dpsGross, 4) + ' ₺' : ''}</td><td class="r num">${a.dpsGross && q?.price ? pct((a.dpsGross / q.price) * 100, 2, false) : ''}</td></tr>`;
    }).join('')}</tbody>` : `<tbody><tr><td class="dim">${calScope === 'all' ? t('İlan edilmiş yaklaşan olay yok') : t('Bu kapsamda ilan edilmiş yaklaşan temettü ya da sermaye artırımı yok')}</td></tr></tbody>`;
  } catch (e) { $('#calendar').innerHTML = `<tbody><tr><td class="dim">${esc(tx(e.message))}</td></tr></tbody>`; }
}
$('#calendar').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) selectSymbol(r.dataset.s); });

async function loadIndices() {
  const list = await api('/market/indices').catch(() => []);
  $('#indices').innerHTML = list.map((x) => `<div data-s="${esc(x.symbol)}" style="background:${heatColor(x.changePct)}"><b>${esc(x.name || x.symbol)}</b>${price(x.price)} · ${pct(x.changePct)}</div>`).join('');
}
$('#indices').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) selectSymbol(r.dataset.s); });

function heatColor(p) {
  if (p == null) return 'var(--panel-2)';
  const a = Math.min(Math.abs(p) / 4, 1) * 0.4 + 0.06;
  return p >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
}

// ── Sinyal radarı ─────────────────────────────────
let radarFilter = null, radarData = null;
async function loadRadar() {
  $('#radarInfo').innerHTML = `<span class="spinner"></span> ${t('taranıyor…')}`;
  try { radarData = await api('/market/radar'); drawRadar(); } catch (e) { $('#radarInfo').textContent = tx(e.message); }
}
function drawRadar() {
  const r = radarData;
  if (!r) return;
  const watch = new Set(state.watchlist);
  $('#radarInfo').textContent = `${t('{n} hisse', { n: r.scanned })} · ${timeTR(r.at)}`;
  $('#radarChips').innerHTML = Object.entries(r.labels).filter(([k]) => r.counts[k]).map(([k, v]) => `<button class="pill ${v.dir === 'up' ? 'up' : v.dir === 'down' ? 'down' : ''}" data-k="${k}" style="cursor:pointer;${radarFilter === k ? 'outline:1px solid var(--accent)' : ''}">${esc(tx(v.label))} · ${r.counts[k]}</button>`).join('');
  const rows = r.hits.filter((x) => !radarFilter || x.signals.includes(radarFilter)).sort((a, b) => watch.has(b.symbol) - watch.has(a.symbol));
  $('#radarTable').innerHTML = `<thead><tr><th>${t('Sembol')}</th><th class="r">${t('Fiyat')}</th><th class="r">${t('Gün %')}</th><th class="r">RSI</th><th class="r" title="${t('Hacim / 20 günlük ortalama hacim')}">${t('Hacim / ort.')}</th><th>${t('Sinyaller')}</th></tr></thead><tbody>${rows.map((x) => `<tr class="click" data-s="${esc(x.symbol)}">
    <td class="mono"><b>${esc(x.symbol)}</b>${watch.has(x.symbol) ? ` <span class="pill acc">${t('listede')}</span>` : ''}</td><td class="r num">${price(x.price)}</td><td class="r num ${cls(x.changePct)}">${pct(x.changePct)}</td>
    <td class="r num">${num(x.rsi, 0)}</td><td class="r num">${x.volRatio ? num(x.volRatio, 1) + '×' : '—'}</td>
    <td>${x.signals.map((k) => `<span class="pill ${r.labels[k].dir === 'up' ? 'up' : r.labels[k].dir === 'down' ? 'down' : ''}">${esc(tx(r.labels[k].label))}</span>`).join(' ')}</td></tr>`).join('') || `<tr><td class="dim">${t('Sinyal yok')}</td></tr>`}</tbody>`;
  $$('#radarChips [data-k]').forEach((b) => b.onclick = () => { radarFilter = radarFilter === b.dataset.k ? null : b.dataset.k; drawRadar(); });
}
$('#radarRun').onclick = loadRadar;
$('#radarTable').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) selectSymbol(r.dataset.s); });
$('#radarAsk').onclick = () => askAgent(t('signal_scan aracıyla BIST 100 sinyal taramasını çalıştır. İzleme listem ve portföyümdeki hisselerde çıkan sinyalleri öne alarak en dikkat çekici sinyalleri yorumla; hangi sinyallerin hacimle teyit edildiğini belirt.'));

// ── Hisse tarayıcı ────────────────────────────────
async function runScreen(extra = {}) {
  const f = Object.fromEntries([...new FormData($('#scrForm'))].filter(([, v]) => v !== ''));
  Object.assign(f, extra);
  $('#scrTable').innerHTML = '<tbody><tr><td><div class="skeleton"></div></td></tr></tbody>';
  try {
    const r = await api(`/screen?${new URLSearchParams(f)}`);
    $('#scrTable').innerHTML = `<thead><tr><th>${t('Sembol')}</th><th>${t('Ad')}</th><th>${t('Sektör')}</th><th class="r">${t('Kapanış')}</th><th class="r" title="${t('Piyasa değeri, milyon ₺')}">${t('Piy. değeri (mn ₺)')}</th><th class="r">${t('F/K')}</th><th class="r">${t('PD/DD')}</th><th class="r">${t('FD/FAVÖK')}</th><th class="r">${t('YBB')}</th><th class="r">${t('1A')}</th></tr></thead><tbody>${r.items.map((x) => `<tr class="click" data-s="${esc(x.code)}">
      <td class="mono"><b>${esc(x.code)}</b></td><td class="muted">${esc(x.name)}</td><td class="muted">${esc(sectorName(x.sector))}</td><td class="r num">${price(x.close)}</td><td class="r num">${num(x.mcapMnTL, 0)}</td>
      <td class="r num">${num(x.pe, 1)}</td><td class="r num">${num(x.pb, 2)}</td><td class="r num">${num(x.evEbitda, 1)}</td><td class="r num ${cls(x.retYtd)}">${pct(x.retYtd, 1)}</td><td class="r num ${cls(x.ret1m)}">${pct(x.ret1m, 1)}</td></tr>`).join('') || `<tr><td colspan="10" class="dim">${t('Koşullara uyan hisse yok')}</td></tr>`}</tbody>
      <tfoot><tr><td colspan="10" class="dim" style="font-weight:400">${t('{n} hisse', { n: r.count })}${r.asOf ? ` · ${t('veriler: {d} (önceki kapanış)', { d: dateTR(r.asOf, true) })}` : ''}</td></tr></tfoot>`;
  } catch (e) { $('#scrTable').innerHTML = `<tbody><tr><td class="dim">${esc(tx(e.message))}</td></tr></tbody>`; }
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

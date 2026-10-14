// PORTFÖY görünümü: özet, varlıklar, pozisyonlar & nakit, işlemler, dağılım, temettü, risk, içe aktarma, ayarlar
import { state, on, emit, api, $, $$, h, esc, num, price, pct, cls, money, dateTR, today, toast, modal, confirmBox, selectSymbol, askAgent, localGet, localSet, css, debounce, timeTR } from './core.js';
import { baseOptions, makeChart, doughnut, palette } from './charts.js';
import { t, tx, lang, locale } from './i18n.js';
import { renderRebalance } from './rebalance-view.js';

const root = $('#view-portfolio');
const TABS = [['ozet', t('Özet')], ['varliklar', t('Varlıklar')], ['pozisyonlar', t('Pozisyonlar ve nakit')], ['islemler', t('İşlemler')], ['dagilim', t('Dağılım')], ['dengeleme', t('Dengeleme')], ['temettu', t('Temettü')], ['risk', t('Risk')], ['aktar', t('İçe aktar')], ['ayarlar', t('Ayarlar')]];
let tab = localGet('pfTab', 'ozet');
let data = null;
let sortKey = localGet('pfSort', 'value'), sortDir = -1;
let holdFilter = '';
let riskRange = localGet('pfRange', { from: '', to: '' });
let benchOn = new Set(localGet('pfBench', ['XU100', 'USDTRY', 'GRAM']));

let riskTab = localGet('pfRiskTab', 'perf');
let taxYear = '';

// Sunucudan gelen dağılım anahtarları (varlık sınıfı, sektör, ülke, "NAKİT USD" gibi nakit satırları) yalnız görüntüde çevrilir
const keyLabel = (k) => tx(k);
const trItems = (items) => (items || []).map((x) => ({ ...x, key: keyLabel(x.key) }));

root.innerHTML = `<div class="subtabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-t="${k}">${l}</button>`).join('')}
  <span style="flex:1"></span><button class="btn" id="pfAdd" style="margin:5px 0">${t('＋ Yeni işlem')}</button></div><div class="pad" id="pfBody"></div>`;
$('.subtabs', root).addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { tab = b.dataset.t; localSet('pfTab', tab); emit('pf:tab', tab); render(); } });
$('#pfAdd').onclick = () => openTxModal();
const body = $('#pfBody');
body.addEventListener('click', (e) => { if (tab === 'varliklar') onHoldingClick(e); });

async function load() {
  try { data = await api('/portfolio'); } catch (e) { data = null; toast(tx(e.message), 'err'); }
  render();
}

function render() {
  $$('.subtabs [data-t]', root).forEach((b) => b.classList.toggle('active', b.dataset.t === tab));
  const scroll = root.scrollTop;
  const fn = { ozet: renderSummary, varliklar: renderHoldings, pozisyonlar: renderPositions, islemler: renderTx, dagilim: renderDist, temettu: renderDiv, dengeleme: () => renderRebalance(body, () => tab === 'dengeleme'), risk: renderRisk, aktar: renderImport, ayarlar: renderSettings }[tab];
  Promise.resolve(fn()).then(() => { root.scrollTop = scroll; });
}

const isEmpty = () => !data || (!data.holdings.length && !data.closed.length && !data.cash.length);
function emptyState() {
  body.innerHTML = `<div class="card empty" style="padding:40px"><h3 style="justify-content:center">${t('Portföyünüz boş')}</h3>
    <p>${t('İlk işleminizi ekleyin ya da aracı kurumunuzdan aldığınız CSV dosyasını içe aktarın. Nakit takibi için önce bir <b>nakit girişi</b> kaydedin.')}</p>
    <div class="row" style="justify-content:center"><button class="btn" data-a="add">${t('＋ İşlem ekle')}</button><button class="btn sec" data-a="imp">${t('CSV içe aktar')}</button></div></div>`;
  $('[data-a=add]', body).onclick = () => openTxModal();
  $('[data-a=imp]', body).onclick = () => { tab = 'aktar'; render(); };
}

// Değer kartlarında sayı kesilmesin: sığana kadar küçült (alt sınır 13 px; altında CSS ellipsis kalır).
function fitKpi() {
  for (const v of $$('.kpi .v', root)) {
    v.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(v).fontSize);
    while (v.scrollWidth > v.clientWidth + 1 && fs > 13) v.style.fontSize = `${--fs}px`;
  }
}
let fitTimer = 0;
const scheduleFit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitKpi, 16); };
new MutationObserver(scheduleFit).observe(root, { childList: true, subtree: true });
new ResizeObserver(scheduleFit).observe(root);
document.fonts?.addEventListener('loadingdone', scheduleFit); // yazı tipi gelince metin genişliği değişir
document.fonts?.ready.then(scheduleFit);
window.addEventListener('load', scheduleFit); // geç gelen stil dosyaları

function kpi(l, v, s = '', c = '', title = '') { return `<div class="card kpi" ${title ? `title="${esc(title)}"` : ''}><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`; }
function warningsHtml() {
  // audit denetimi yeni kaynaktır: aynı olayı taşıyan eski uyarı ikinci kez gösterilmez
  const a = data?.audit || [];
  const w = (data?.warnings || []).filter((x) => !a.some((y) => y.detail === x));
  return w.length ? `<div class="card warn" style="margin-bottom:12px">${w.map((x) => `<div>⚠ ${esc(tx(x))}</div>`).join('')}</div>` : '';
}
const SEV_ICON = { kritik: '🔴', uyari: '⚠️', bilgi: 'ℹ️' };
const SEV_CLS = { kritik: 'down', uyari: '', bilgi: 'dim' };
function auditHtml() {
  const a = data?.audit || [];
  if (!a.length) return '';
  return `<div class="card warn" style="margin-bottom:12px"><b>${t('Bütünlük denetimi')}</b>${a.map((x) => `<div class="${SEV_CLS[x.severity] || ''}">${SEV_ICON[x.severity] || '⚠'} <b>${esc(tx(x.title))}</b> — ${esc(tx(x.detail))}${x.action ? ` <span class="ghost">${esc(t(x.action))}</span>` : ''}</div>`).join('')}</div>`;
}

// ── Özet ─────────────────────────────────────────
function renderSummary() {
  if (isEmpty()) return emptyState();
  const tot = data.totals;
  const cashByCur = {};
  for (const c of data.cash) cashByCur[c.currency] = (cashByCur[c.currency] || 0) + c.amount;
  const cashTip = Object.entries(cashByCur).map(([c, a]) => `${money(a, c, 2)}`).join(' · ');
  body.innerHTML = `${warningsHtml()}${auditHtml()}
  <div class="grid g4">
    ${kpi(t('Toplam değer'), money(tot.value), tot.valueUSD ? `≈ ${money(tot.valueUSD, 'USD')}` : '')}
    ${kpi(t('Günlük değişim'), money(tot.dayChange), t('{pct} · kur etkisi dahil', { pct: pct(tot.dayChangePct) }), cls(tot.dayChange))}
    ${kpi(t('Açık pozisyon K/Z'), money(tot.unrealized), pct(tot.unrealizedPct), cls(tot.unrealized))}
    ${kpi(`${t('Toplam K/Z')}${tot.netInvestedEstimated ? ' <span class="down" title="' + esc(t('Net yatırım maliyet esasıyla hesaplandı; başlangıç nakdi kayıtlı değil.')) + '">⚠</span>' : ''}`, money(tot.totalPnl), t('{pct} · net yatırılan {v}', { pct: pct(tot.totalPnlPct), v: money(tot.netInvested) }) + (tot.netInvestedEstimated ? ` · <span class="down">${esc(t('⚠ Net yatırım maliyet esasıyla hesaplandı; başlangıç nakdi kayıtlı değil.'))}</span>` : ''), cls(tot.totalPnl), t('Toplam değer − net yatırılan (nakit takibi açıksa); değilse açık + gerçekleşen K/Z + gelirler'))}
    ${kpi(t('Maliyet'), money(tot.cost), t('{n} pozisyon', { n: tot.positionsCount }))}
    ${kpi(t('Gerçekleşen K/Z'), money(tot.realized), t('komisyon {v}', { v: money(tot.commissions) }), cls(tot.realized))}
    ${kpi(t('Temettü ve faiz'), money(tot.dividends + tot.interest), `${t('temettü {d} · faiz {i}', { d: money(tot.dividends), i: money(tot.interest) })}${tot.staking ? ` · staking ${money(tot.staking)}` : ''}`)}
    ${kpi(t('Kur farkı'), money(tot.kurFarki), t('gerçekleşen {r} · açık {u}', { r: money(tot.fxRealized), u: money(tot.fxUnrealized) }), cls(tot.kurFarki), t('Yabancı para nakdin TL karşılığındaki değişim'))}
  </div>
  <div class="card strip" style="margin-top:12px" title="${esc(t('Tüm pozisyonlar bugünkü fiyattan satılırsa eline geçecek tutar (stopaj sonrası).'))}">
    <b>${t('Bugün hepsini satarsan')}</b> · ${t('net {n}', { n: money(tot.sellNet) })} · ${t('stopaj kesintisi {n}', { n: money(tot.sellTax) })} · <span class="${cls(tot.sellRealized)}">${t('kâr/zarar {n}', { n: money(tot.sellRealized) })}</span>
  </div>
  ${targetStrip(tot.target)}
  <div class="card strip" id="pfStrip" style="margin-top:12px">${t('Maliyet {v}', { v: money(tot.cost) })} · ${t('Nakit {v}', { v: `${tot.cash == null ? '—' : money(tot.cash)}${cashTip ? ` (${esc(cashTip)})` : ''}` })} · ${t('Pozisyon {n}', { n: tot.positionsCount })} · <span class="dim">${t('Getiri metrikleri hesaplanıyor…')}</span></div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>${t('Portföy ve karşılaştırma ölçütleri (TL)')} <span class="dim" id="perfNote" style="font-weight:400"></span></h3><div class="row" id="benchToggles" style="margin-bottom:6px"></div><div class="chart-box md"><canvas id="pfPerf"></canvas></div></div>
    <div class="card"><h3>${t('Varlık dağılımı')}</h3><div class="chart-box md"><canvas id="pfPie"></canvas></div></div>
  </div>
  <div class="grid g4" style="margin-top:12px">
    <div class="card"><h3>${t('En büyük pozisyonlar')}</h3>${miniTable(data.holdings.slice(0, 6), (x) => `<td class="mono"><b>${esc(x.symbol)}</b></td><td class="r num">${money(x.value)}</td><td class="r num">${num(x.weight, 1)}%</td>`)}</div>
    <div class="card"><h3>${t('Günün en iyileri ve en kötüleri')}</h3>${miniTable([...data.holdings].filter((x) => x.changePct != null).sort((a, b) => b.changePct - a.changePct).filter((_, i, a) => i < 3 || i >= a.length - 3), (x) => `<td class="mono"><b>${esc(x.symbol)}</b></td><td class="r num ${cls(x.changePct)}">${pct(x.changePct)}</td><td class="r num ${cls(x.dayChange)}">${money(x.dayChange)}</td>`)}</div>
    <div class="card"><h3>${t('K/Z sıralaması')}</h3>${miniTable([...data.holdings].filter((x) => x.pnl != null).sort((a, b) => b.pnl - a.pnl).filter((_, i, a) => i < 3 || i >= a.length - 3), (x) => `<td class="mono"><b>${esc(x.symbol)}</b></td><td class="r num ${cls(x.pnl)}">${money(x.pnl)}</td><td class="r num ${cls(x.pnlPct)}">${pct(x.pnlPct)}</td>`)}</div>
    <div class="card"><h3 title="${esc(t('Açık pozisyonların toplam K/Z içindeki payı (açık + gerçekleşen + temettü). Kapanmış pozisyonlar listede görünmez ama toplama dahildir.'))}">${t('K/Z katkısı')}</h3>${contributionTable(tot)}</div>
  </div>
  <div class="card" style="margin-top:12px"><h3>${t('Asistana sor')}</h3><div class="row">${[
    [t('Portföyümü özetle'), t('Portföyümü özetle: performans, en güçlü/zayıf pozisyonlar, yoğunlaşma riski ve pozisyonlarımla ilgili son KAP bildirimleri. Kısa ve maddeli.')],
    [t('Zarardaki pozisyonlar'), t('Portföyümdeki zararda olan pozisyonları analiz et: maliyetime göre durum, teknik görünüm, temel oranlar ve son KAP bildirimleri. Her biri için izlenecek seviyeleri belirt.')],
    [t('En çok kazandıranlar'), t('En çok kazandıran pozisyonlarımı analiz et: kârın kaynağı, değerleme (F/K, PD/DD) ve risk; kâr realizasyonu senaryolarını hesapla (öneri değil).')],
    [t('Sektörel yoğunluk'), t('Sektörel ve para birimi yoğunluğumu analiz et; tek hisse >%20, tek sektör >%35 gibi eşikleri aşanları belirt.')],
    [t('Risk analizi'), t('Portföyümün risk metriklerini (TWR, XIRR, Sharpe, Sortino, maksimum düşüş, beta) ve kıyasları (BIST 100, USD/TL, gram altın) yorumla; HTML rapor olarak kaydet.')],
    [t('Aylık performans'), t('Aylık performansımı BIST 100, USD/TL ve gram altınla karşılaştır; en iyi ve en kötü ayların nedenlerini açıkla.')],
    [t('Temettü gelirlerim'), t('Temettü gelirlerimi ve yaklaşan temettüleri (get_dividend_report, get_corporate_actions) özetle; brüt/net ve verimleri göster.')],
    [t('Son işlemlerim'), t('Son işlemlerimi (get_transactions) özetle; alım-satım zamanlamamı ve komisyon yükümü değerlendir.')],
    [t('İşlem stratejim'), t('İşlemlerimdeki stratejileri ve davranış kalıplarını analiz et (tutma süreleri, kâr/zarar kapama alışkanlıkları).')],
    [t('Yeniden dengeleme'), t('Eşit ağırlıklı ve sektör tavanlı (tek sektör ≤%30) iki yeniden dengeleme senaryosu hesapla; alım/satım adetlerini tablo halinde göster. Bu bir hesaplama, öneri değil.')],
  ].map(([l, p]) => `<button class="ghost" data-ask="${esc(p)}">${esc(l)}</button>`).join('')}</div></div>`;
  doughnut($('#pfPie'), trItems(data.distribution.byAsset));
  $$('[data-ask]', body).forEach((b) => b.onclick = () => askAgent(b.dataset.ask));
  $$('tr[data-s]', body).forEach((r) => r.onclick = () => selectSymbol(r.dataset.s));
  perfChart($('#pfPerf'), 'level', true);
}

// Toplam K/Z'ye en çok katkı yapan 3 açık pozisyon (açık + gerçekleşen + temettü)
function contributionTable(tot) {
  if (!tot.totalPnl) return '<div class="dim">—</div>';
  const rows = data.holdings.filter((x) => x.pnl != null).map((x) => ({ ...x, contrib: x.pnl + (x.realized || 0) + (x.dividends || 0) }))
    .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, 3);
  return miniTable(rows, (x) => `<td class="mono"><b>${esc(x.symbol)}</b></td><td class="r num ${cls(x.contrib)}">${money(x.contrib)}</td><td class="r num ${cls(x.contrib)}" title="${esc(t('Toplam K/Z içindeki pay'))}">${num((x.contrib / Math.abs(tot.totalPnl)) * 100, 0)}%</td>`);
}

function miniTable(rows, cells) {
  return rows.length ? `<table class="t"><tbody>${rows.map((x) => `<tr class="click" data-s="${esc(x.symbol)}">${cells(x)}</tr>`).join('')}</tbody></table>` : '<div class="dim">—</div>';
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
      $('#pfStrip').innerHTML = [
        t('Maliyet {v}', { v: money(data.totals.cost) }),
        m.cagrPct != null ? `CAGR ${pct(m.cagrPct)}` : t('Yıllıklandırılmış {v}', { v: pct(m.annualizedPct) }),
        t('Para ağırlıklı getiri (XIRR) {v}', { v: `<b class="${cls(m.xirrPct)}">${pct(m.xirrPct)}</b>` }),
        t('Devir hızı {v}', { v: pct(m.turnoverPct, 0, false) }),
        t('Pozisyon {n}', { n: data.totals.positionsCount }),
        t('Nakit {v}', { v: data.totals.cash == null ? '—' : money(data.totals.cash) }),
      ].join(' · ');
    }
    if (!r.enough) { canvas.parentElement.innerHTML = `<div class="empty">${t('Grafik için en az birkaç günlük veri gerekiyor')}</div>`; return; }
    const tog = canvas.closest('.card')?.querySelector('[id$=benchToggles]');
    if (tog) {
      tog.innerHTML = Object.entries(r.benchmarks || {}).map(([k, b]) => `<label class="pill" style="cursor:pointer"><input type="checkbox" data-b="${k}" ${benchOn.has(k) ? 'checked' : ''} style="margin:0 4px 0 0;vertical-align:-1px">${esc(tx(b.label))} <span class="${cls(b.returnPct)}">${pct(b.returnPct, 1)}</span></label>`).join('') || `<span class="dim">${t('Karşılaştırma verisi alınamadı')}</span>`;
      $$('[data-b]', tog).forEach((c) => c.onchange = () => { c.checked ? benchOn.add(c.dataset.b) : benchOn.delete(c.dataset.b); localSet('pfBench', [...benchOn]); perfChart(canvas, mode, false, range); });
    }
    const s = r.series;
    const colors = palette();
    const ds = mode === 'value'
      ? [{ label: t('Portföy değeri (₺)'), data: s.map((p) => ({ x: p.date, y: p.value })), borderColor: css('--accent'), pointRadius: 0, borderWidth: 1.6, fill: { target: 'origin', above: css('--accent') + '15' } },
        { label: t('Net yatırılan (₺)'), data: s.map((p) => ({ x: p.date, y: p.invested })), borderColor: css('--text-3'), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.2, stepped: true }]
      : [{ label: t('Portföy (TWR) {v}', { v: pct(r.metrics.totalReturnPct, 1) }), data: s.map((p) => ({ x: p.date, y: p.level })), borderColor: css('--accent'), pointRadius: 0, borderWidth: 2 },
        ...Object.keys(r.benchmarks || {}).filter((k) => benchOn.has(k)).map((k, i) => ({ label: tx(r.benchmarks[k].label), data: s.filter((p) => p[k] != null).map((p) => ({ x: p.date, y: p[k] })), borderColor: colors[(i + 1) % colors.length], pointRadius: 0, borderWidth: 1.1 }))];
    makeChart(canvas, { type: 'line', data: { datasets: ds }, options: baseOptions({ legend: true }) });
    const note = $('#perfNote');
    if (note) note.textContent = t('{from} – {to} · başlangıç = 100', { from: dateTR(r.start), to: dateTR(r.end) });
  } catch (e) { if (canvas.isConnected) canvas.parentElement.innerHTML = `<div class="empty">${esc(tx(e.message))}</div>`; }
}

const HOLD_COLS = [
  ['symbol', t('Sembol')], ['assetLabel', t('Tür')], ['sector', t('Sektör')], ['qty', t('Miktar'), 'r'], ['avgCost', t('Ort. maliyet'), 'r'], ['price', t('Güncel fiyat'), 'r'],
  ['changePct', t('Gün %'), 'r'], ['targetUp', t('Hedef'), 'r', t('Kurum hedef fiyatına uzaklık (medyan, son 180 gün)')], ['value', t('Değer ₺'), 'r'], ['weight', t('Ağırlık'), 'r'], ['pnl', t('K/Z ₺'), 'r'], ['pnlPct', t('K/Z %'), 'r'], ['dividends', t('Temettü ₺'), 'r'],
];
const SRC_PILL = {
  'gecikmeli': `<span class="pill" title="${esc(t('Borsa verisi yaklaşık 15 dakika gecikmeli'))}">${t('15 dk')}</span>`,
  'canlı': '',
  'manuel': `<span class="pill acc" title="${esc(t('Elle girilen fiyat'))}">${t('manuel')}</span>`,
  'son işlem': `<span class="pill down" title="${esc(t('Canlı fiyat yok; son işlem fiyatı kullanılıyor'))}">${t('fiyat yok')}</span>`,
};
const targetStripTip = (g) => t('Kapsamdaki {n}/{of} hissenin değeriyle ağırlıklı medyan hedef getirisi. Hedefi olmayan, 180 günden eski ya da bedelsiz öncesi raporlar sayılmaz.', { n: g.n, of: g.of });
function targetStrip(g) {
  if (!g || !g.of) return '';
  const head = `<b>${t('Kurum hedefi')}</b> · `;
  const body = g.n
    ? `${t('hisse değerinin %{p}\'i kapsamda ({n}/{of} hisse)', { p: num(g.valuePct, 0), n: g.n, of: g.of })} · ${t('ağırlıklı hedef getiri')} <span class="${cls(g.weightedUpsidePct)}">${pct(g.weightedUpsidePct, 1)}</span>`
    : t('kapsamda hisse yok ({of} hisse için son 180 günde hedef bulunamadı)', { of: g.of });
  return `<div class="card strip" style="margin-top:12px" title="${esc(targetStripTip(g))}">${head}${body} · <span class="dim">${t('açık kurum raporlarından; yatırım tavsiyesi değildir')}</span></div>`;
}
// Kurum hedefi: `target` yoksa kapsam dışı (fon, altın, yabancı), null ise veri yok, nesne ise özet.
const targetTip = (g) => t('Medyan hedef {m} · Artır {al} / Tut {tut} / Azalt {sat} · en yeni rapor {d}\n\nKurumların açık yayınlarından; yatırım tavsiyesi değildir.', { m: g.median == null ? '—' : price(g.median), al: g.al, tut: g.tut, sat: g.sat, d: dateTR(g.newest) });
function targetCell(x) {
  const g = x.target;
  if (g === undefined) return '<td class="r dim">—</td>';
  if (g === null) return `<td class="r dim" title="${esc(t('Son 180 günde bu hisse için kurum hedefi bulunamadı.'))}">—</td>`;
  const top = [[t('[öneri]Artır'), g.al], [t('[öneri]Tut'), g.tut], [t('[öneri]Azalt'), g.sat]].find(([, n], _, a) => n > 0 && n === Math.max(...a.map(([, m]) => m)));
  const sub = `${t('{n} kurum', { n: g.brokers })}${top ? ` · ${top[1]} ${top[0]}` : ''}`;
  return `<td class="r num" title="${esc(targetTip(g))}">${g.upsidePct == null ? '<span class="dim">—</span>' : `<span class="${cls(g.upsidePct)}">${pct(g.upsidePct, 1)}</span>`}<div class="dim" style="font-size:10.5px;font-family:var(--sans)">${esc(sub)}</div></td>`;
}
function renderHoldings() {
  if (isEmpty()) return emptyState();
  data.holdings.forEach((h) => { h.targetUp = h.target?.upsidePct ?? null; });
  const rows = [...data.holdings].sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    return (typeof x === 'string' ? x.localeCompare(y, 'tr') : (x ?? -1e18) - (y ?? -1e18)) * sortDir;
  });
  const tot = data.totals;
  body.innerHTML = `${warningsHtml()}<div class="card"><h3>${t('Varlıklarım')} <input id="hFilter" placeholder="${esc(t('Filtrele…'))}" value="${esc(holdFilter)}" style="width:160px;font-weight:400"></h3><div class="table-wrap"><table class="t" id="hTable">
    <thead><tr>${HOLD_COLS.map(([k, l, c, tip]) => `<th class="sortable ${c || ''}" data-k="${k}"${tip ? ` title="${esc(tip)}"` : ''}>${l}${sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr></thead>
    <tbody>${rows.map((x) => `<tr class="click" data-s="${esc(x.symbol)}">
      <td class="mono"><b>${esc(x.symbol)}</b> ${SRC_PILL[x.priceSource] || ''}<div class="dim" style="font-size:10.5px;font-family:var(--sans);max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${esc(x.name !== x.symbol ? x.name : '')}">${esc(x.name !== x.symbol ? x.name : '')}</div></td><td>${esc(tx(x.assetLabel))}</td><td class="muted">${esc(tx(x.sector))}</td>
      <td class="r num">${num(x.qty, x.qty % 1 ? 4 : 0)}</td><td class="r num" title="${esc(t('TL ortalama maliyet: {v} ₺', { v: price(x.avgCost) }))}">${x.currency !== 'TRY' ? `${price(x.avgCostNative)} <span class="dim">${esc(x.currency)}</span>` : price(x.avgCost)}</td><td class="r num" title="${esc(tx(x.priceSource))}${x.priceTime ? ' · ' + (typeof x.priceTime === 'number' ? timeTR(x.priceTime) : x.priceTime) : ''}">${price(x.price)} <span class="dim">${x.currency !== 'TRY' ? esc(x.currency) : ''}</span></td>
      <td class="r num ${cls(x.changePct)}">${pct(x.changePct)}</td>${targetCell(x)}<td class="r num">${money(x.value)}</td>
      <td class="r"><div class="row" style="justify-content:flex-end;gap:6px;flex-wrap:nowrap"><span class="num">${num(x.weight, 1)}%</span><div class="bar" style="width:50px"><i style="width:${Math.min(x.weight, 100)}%"></i></div></div></td>
      <td class="r num ${cls(x.pnl)}" title="${x.pnlFx != null ? esc(t('Fiyat etkisi {p} · kur etkisi {f}', { p: money(x.pnlPrice), f: money(x.pnlFx) })) : ''}${x.sellNet != null ? esc(t('\n\nBugün satılırsa eline geçen: {n} ({g} brüt', { n: money(x.sellNet), g: money(x.sellGross) }) + (x.sellTax ? ` − ${t('stopaj')} ${money(x.sellTax)}` : t(' · stopaj yok')) + `) → ${t('kâr/zarar')} ${money(x.sellRealized)}`) : ''}">${money(x.pnl)}${x.pnlFx != null ? `<div class="dim" style="font-size:10px">${t('fiyat {p} · kur {f}', { p: money(x.pnlPrice), f: money(x.pnlFx) })}</div>` : ''}${x.sellTax ? `<div class="dim" style="font-size:10px">${t('satışa çevir {n}', { n: money(x.sellNet) })}</div>` : ''}</td><td class="r num ${cls(x.pnlPct)}">${pct(x.pnlPct)}</td>
      <td class="r num">${x.dividends ? money(x.dividends) : '—'}</td>
      <td style="white-space:nowrap"><button class="ghost" data-buy="${esc(x.symbol)}">${t('Al')}</button> <button class="ghost" data-sell="${esc(x.symbol)}">${t('Sat')}</button>${x.priceSource === 'son işlem' || x.priceSource === 'manuel' ? ` <button class="ghost" data-price="${esc(x.symbol)}">${t('Fiyat gir')}</button>` : ''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="7">${t('Toplam (nakit hariç)')}</td><td class="r num ${cls(tot.target.weightedUpsidePct)}" title="${esc(targetStripTip(tot.target))}">${tot.target.weightedUpsidePct == null ? '—' : pct(tot.target.weightedUpsidePct, 1)}</td><td class="r num">${money(tot.holdingsValue)}</td><td></td><td class="r num ${cls(tot.unrealized)}">${money(tot.unrealized)}</td><td class="r num ${cls(tot.unrealizedPct)}">${pct(tot.unrealizedPct)}</td><td class="r num">${money(data.holdings.reduce((a, x) => a + x.dividends, 0))}</td><td></td></tr></tfoot>
  </table></div></div>
  ${data.closed.length ? `<div class="card" style="margin-top:12px"><h3>${t('Kapanmış pozisyonlar')}</h3><table class="t"><thead><tr><th>${t('Sembol')}</th><th class="r">${t('Gerçekleşen K/Z')}</th><th class="r">${t('Temettü')}</th></tr></thead><tbody>${data.closed.map((c) => `<tr class="click" data-s="${esc(c.symbol)}"><td class="mono">${esc(c.symbol)}</td><td class="r num ${cls(c.realized)}">${money(c.realized)}</td><td class="r num">${money(c.dividends)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
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
    title: t('{s} için fiyat gir', { s: symbol }),
    body: `<p class="muted">${t('Canlı fiyatı olmayan varlıklar (TEFAS fonu, mevduat vb.) için güncel birim fiyatı girin. Asistana “fon fiyatlarımı güncelle” diyerek de güncelleyebilirsiniz.')}</p>
      <form class="form-grid" id="mpf"><div class="field"><label>${t('Birim fiyat')}</label><input name="price" type="number" step="any" value="${current ? Math.round(current * 1e6) / 1e6 : ''}" required></div><div class="field"><label>${t('Tarih')}</label><input name="date" type="date" value="${today()}"></div></form>`,
    footer: `<button class="btn sec" data-clear>${t('Elle girilen fiyatı kaldır')}</button><button class="btn sec" data-close>${t('İptal')}</button><button class="btn" data-save>${t('Kaydet')}</button>`,
  });
  const f = $('#mpf', m.el);
  $('[data-save]', m.el).onclick = async () => { try { await api(`/symbols/${encodeURIComponent(symbol)}/price`, { method: 'POST', body: { price: Number(f.price.value), date: f.date.value } }); toast(t('Fiyat kaydedildi'), 'ok'); m.close(); } catch (e) { toast(tx(e.message), 'err'); } };
  $('[data-clear]', m.el).onclick = async () => { await api(`/symbols/${encodeURIComponent(symbol)}/price`, { method: 'POST', body: { price: null } }); toast(t('Elle girilen fiyat kaldırıldı')); m.close(); };
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
    return `<div class="card" style="margin-bottom:12px"><h3>${esc(plat)} <span class="num" style="font-weight:400">${money(v + (data.totals.cash != null ? cashTL : 0))} · ${t('pozisyon K/Z')} <span class="${cls(v - c)}">${money(v - c)} (${pct(c ? (v / c - 1) * 100 : null)})</span></span></h3>
      ${g.pos.length ? `<table class="t"><thead><tr><th>${t('Sembol')}</th><th class="r">${t('Miktar')}</th><th class="r">${t('Ort. maliyet')}</th><th class="r">${t('Fiyat')}</th><th class="r">${t('Maliyet ₺')}</th><th class="r">${t('Değer')}</th><th class="r">${t('K/Z')}</th><th class="r">${t('K/Z %')}</th><th class="r">${t('Ağırlık')}</th><th>${t('İlk alış')}</th></tr></thead>
      <tbody>${g.pos.map((p) => `<tr class="click" data-s="${esc(p.symbol)}"><td class="mono"><b>${esc(p.symbol)}</b></td><td class="r num">${num(p.qty, p.qty % 1 ? 4 : 0)}</td><td class="r num" title="${esc(t('TL ortalama maliyet: {v} ₺', { v: price(p.avgCost) }))}">${p.currency && p.currency !== 'TRY' ? `${price(p.avgCostNative)} <span class="dim">${esc(p.currency)}</span>` : price(p.avgCost)}</td><td class="r num">${price(p.price)}${p.currency && p.currency !== 'TRY' ? ` <span class="dim">${esc(p.currency)}</span>` : ''}</td><td class="r num">${money(p.cost)}</td><td class="r num">${money(p.value)}</td><td class="r num ${cls(p.pnl)}">${money(p.pnl)}</td><td class="r num ${cls(p.pnlPct)}">${pct(p.pnlPct)}</td><td class="r num">${num(p.weight, 1)}%</td><td>${dateTR(p.firstDate)}</td></tr>`).join('')}</tbody></table>` : `<div class="dim">${t('Açık pozisyon yok')}</div>`}
      ${g.cash.length ? `<div class="mini-head" style="margin-top:10px">${t('Nakit')}</div><table class="t"><thead><tr><th>${t('Para birimi')}</th><th class="r">${t('Tutar')}</th><th class="r">${t('TL karşılığı')}</th><th class="r">${t('TL maliyeti')}</th><th class="r">${t('Kur farkı')}</th></tr></thead>
      <tbody>${g.cash.map((x) => `<tr><td>${esc(x.currency)}</td><td class="r num ${x.amount < 0 ? 'down' : ''}">${num(x.amount, 2)}</td><td class="r num">${money(x.valueTRY, 'TRY', 2)}</td><td class="r num">${x.currency === 'TRY' ? '' : money(x.costTRY, 'TRY', 2)}</td><td class="r num ${cls(x.fxPnl)}">${x.currency === 'TRY' ? '' : money(x.fxPnl, 'TRY', 2)}</td></tr>`).join('')}</tbody></table>` : ''}</div>`;
  }).join('') || `<div class="empty">${t('Açık pozisyon yok')}</div>`)
  + (!data.totals.cashTracking ? `<p class="dim">${t('Nakit takibi kapalı: nakit girişi kaydı olmadığı için alım ve satımların nakde etkisi toplam değere yansımıyor.')}</p>` : '');
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
  body.innerHTML = `<div class="card"><h3>${t('İşlem geçmişi')} <span class="dim" style="font-weight:400">${t('{n} kayıt', { n: `${txs.length}${txs.length >= txLimit ? '+' : ''}` })}</span></h3>
    <div class="row" style="margin-bottom:10px" id="txFilters">
      <input name="symbol" placeholder="${esc(t('Sembol'))}" value="${esc(txFilter.symbol)}" style="width:100px">
      <select name="type"><option value="">${t('Tüm türler')}</option>${Object.entries(T).map(([k, v]) => `<option value="${k}" ${txFilter.type === k ? 'selected' : ''}>${esc(tx(v))}</option>`).join('')}</select>
      <select name="platform"><option value="">${t('Tüm platformlar')}</option>${plats.map((p) => `<option value="${p.id}" ${String(txFilter.platform) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <select name="strategy"><option value="">${t('Tüm stratejiler')}</option>${strats.map((p) => `<option value="${p.id}" ${String(txFilter.strategy) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <input name="from" type="date" value="${esc(txFilter.from)}" title="${esc(t('Başlangıç tarihi'))}"><input name="to" type="date" value="${esc(txFilter.to)}" title="${esc(t('Bitiş tarihi'))}">
    </div>
    <div class="table-wrap"><table class="t"><thead><tr><th>${t('Tarih')}</th><th>${t('Tür')}</th><th>${t('Sembol')}</th><th class="r">${t('Miktar')}</th><th class="r">${t('Fiyat / tutar')}</th><th class="r">${t('Komisyon / stopaj')}</th><th>${t('Para birimi')}</th><th class="r">${t('Döviz kuru')}</th><th class="r">${t('TL karşılığı')}</th><th>${t('Platform')}</th><th>${t('Strateji')}</th><th>${t('Not')}</th><th></th></tr></thead>
    <tbody>${txs.map((x) => {
      const amountType = ['DIVIDEND', 'DEPOSIT', 'WITHDRAW', 'FEE', 'INTEREST', 'FX_CONVERT'].includes(x.type);
      let total = null;
      if (['BUY', 'SELL', 'DRIP'].includes(x.type)) total = (x.quantity * x.price + (x.type === 'BUY' ? x.fee : x.type === 'SELL' ? -x.fee : 0)) * x.fx_rate;
      else if (x.type === 'DIVIDEND') total = (x.price - x.fee) * x.fx_rate;
      else if (amountType) total = x.price * x.fx_rate;
      else if (x.type === 'TRANSFER' && !x.symbol) total = x.price * x.fx_rate;
      const pillCls = { BUY: 'up', SELL: 'down', DIVIDEND: 'acc', DRIP: 'acc', DEPOSIT: 'up', WITHDRAW: 'down' }[x.type] || '';
      const extra = x.type === 'TRANSFER' ? ` → ${esc(x.to_platform || '?')}` : x.type === 'FX_CONVERT' ? ` → ${num(x.to_amount, 2)} ${esc(x.to_currency)}` : '';
      return `<tr><td>${dateTR(x.date)}</td><td><span class="pill ${pillCls}">${esc(tx(T[x.type] || x.type))}</span>${extra}</td><td class="mono"><b>${esc(x.symbol || '—')}</b></td>
        <td class="r num">${amountType ? '' : x.type === 'SPLIT' ? `×${num(x.quantity, 4)}` : num(x.quantity, x.quantity % 1 ? 4 : 0)}</td><td class="r num">${x.type === 'SPLIT' || (x.type === 'TRANSFER' && x.symbol) || (['FREE'].includes(x.type)) ? '' : price(x.price)}</td><td class="r num">${x.fee ? price(x.fee) : ''}</td>
        <td>${esc(x.currency)}</td><td class="r num">${x.currency !== 'TRY' ? num(x.fx_rate, 4) : ''}</td><td class="r num">${total == null ? '' : money(total, 'TRY', 2)}</td>
        <td>${esc(x.platform || '')}</td><td class="muted">${esc(x.strategy || '')}</td><td class="muted" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(x.notes || '')}</td>
        <td style="white-space:nowrap"><button class="ghost" data-edit="${x.id}" title="${esc(t('Bu işlemi düzenle'))}">${t('Düzenle')}</button> <button class="ghost" data-dup="${x.id}" title="${esc(t('Kopyasını oluştur'))}">${t('Kopyala')}</button> <button class="ghost" data-del="${x.id}" title="${esc(t('Bu işlemi sil'))}">${t('Sil')}</button></td></tr>`;
    }).join('') || `<tr><td colspan="13" class="empty">${t('Kayıt yok')}</td></tr>`}</tbody></table></div>
    ${txs.length >= txLimit ? `<button class="ghost" id="txMore" style="margin:10px auto;display:block">${t('Daha fazla yükle')}</button>` : ''}</div>`;
  if (focused) { const el = $(`#txFilters [name="${focused}"]`); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } }
  const refilter = debounce(() => { txFilter = Object.fromEntries([...$$('#txFilters [name]')].map((x) => [x.name, x.value.trim()])); txLimit = 300; renderTx(); }, 350);
  $$('#txFilters [name]').forEach((x) => x.addEventListener('input', refilter));
  $('#txMore')?.addEventListener('click', () => { txLimit += 300; renderTx(); });
  $$('[data-edit]', body).forEach((b) => b.onclick = () => openTxModal(txs.find((x) => x.id === Number(b.dataset.edit))));
  $$('[data-dup]', body).forEach((b) => b.onclick = () => { const { id, ...rest } = txs.find((x) => x.id === Number(b.dataset.dup)); openTxModal({ ...rest, date: today() }); });
  $$('[data-del]', body).forEach((b) => b.onclick = async () => {
    if (!(await confirmBox(t('Bu işlem silinsin mi?'), { ok: t('Sil'), danger: true }))) return;
    await api(`/transactions/${b.dataset.del}`, { method: 'DELETE' });
  });
}

// ── Dağılım ───────────────────────────────────────
function renderDist() {
  if (isEmpty()) return emptyState();
  const d = data.distribution;
  const byAsset = trItems(d.byAsset), bySector = trItems(d.bySector), byCountry = trItems(d.byCountry);
  const byCur = trItems(d.byCurrency);
  const block = (id, title, items) => `<div class="card"><h3>${title}</h3><div class="chart-box md"><canvas id="${id}"></canvas></div>
    <table class="t" style="margin-top:8px"><tbody>${items.map((x) => `<tr><td>${esc(x.key)}</td><td class="r num">${money(x.value)}</td><td class="r num">${num(x.pct, 1)}%</td></tr>`).join('')}</tbody></table></div>`;
  body.innerHTML = `<div class="grid g4" style="margin-bottom:12px">
      ${kpi(t('Etkin pozisyon sayısı'), num(d.concentration.effectiveN, 1), '1 / HHI')}
      ${kpi(t('İlk 5 pozisyonun ağırlığı'), `${num(d.concentration.top5Pct, 1)}%`)}
      ${kpi(t('Yoğunlaşma (HHI)'), num(d.concentration.hhi, 3), d.concentration.hhi > 0.25 ? `<span class="down">${t('Yüksek yoğunlaşma')}</span>` : d.concentration.hhi > 0.15 ? t('Orta yoğunlaşma') : `<span class="up">${t('Çeşitlendirilmiş')}</span>`)}
      ${kpi(t('En büyük pozisyon'), esc(data.totals.largest?.symbol || '—'), data.totals.largest ? `${num(data.totals.largest.weight, 1)}%` : '')}
    </div>
    <div class="card strip" style="margin-bottom:12px" title="${esc(t('Altın, döviz, kripto, emtia, döviz cinsi hisseler ve döviz nakit: TL’nin değer kaybına karşı doğal koruma sağlayan kısım'))}">
      ${t('TL dışı (korunaklı) pay {p}', { p: `<b>${num(d.nonTl?.pct || 0, 1)}%</b>` })} <span class="dim">(${money(d.nonTl?.value || 0)})</span> · ${t('TL varlıklar {p}', { p: `${num(100 - (d.nonTl?.pct || 0), 1)}%` })}
      <div class="bar" style="margin-top:6px;display:flex"><i style="width:${Math.min(d.nonTl?.pct || 0, 100)}%;background:var(--accent)"></i></div></div>
    <div class="grid g2">${block('dAsset', t('Varlık sınıfı'), byAsset)}${block('dSector', t('Sektörler'), bySector)}${block('dCur', t('Para birimi maruziyeti'), byCur)}${block('dCountry', t('Ülke / piyasa'), byCountry)}${block('dPlat', t('Platformlar'), d.byPlatform)}</div>
    <div class="card" style="margin-top:12px"><h3>${t('Sembol ağırlıkları')}</h3><div class="chart-box md"><canvas id="dSym"></canvas></div></div>`;
  doughnut($('#dAsset'), byAsset); doughnut($('#dSector'), bySector); doughnut($('#dCur'), byCur); doughnut($('#dCountry'), byCountry); doughnut($('#dPlat'), d.byPlatform);
  const colors = palette();
  makeChart($('#dSym'), { type: 'bar', data: { labels: d.bySymbol.map((x) => keyLabel(x.key)), datasets: [{ label: t('Ağırlık %'), data: d.bySymbol.map((x) => x.pct), backgroundColor: d.bySymbol.map((_, i) => colors[i % colors.length]) }] }, options: baseOptions({ time: false }) });
}

// ── Temettü ───────────────────────────────────────
async function renderDiv() {
  body.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  const d = await api('/portfolio/dividends');
  if (tab !== 'temettu') return;
  const months = [];
  // toISOString UTC'ye çevirip dilimlerken sabah 03'ten önce açılan uygulamada ay bir geriye kayar
  for (let i = 11; i >= 0; i--) { const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i); months.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`); }
  const upNet = d.upcoming.reduce((a, x) => a + x.net, 0);
  body.innerHTML = `<div class="grid g4">
      ${kpi(t('Toplam alınan (net)'), money(d.total))}${kpi(t('Son 12 ay'), money(d.last12), t('aylık ortalama {v}', { v: money(d.monthlyAvg) }))}
      ${kpi(t('Beklenen yıllık (net)'), money(d.expectedAnnual), t('stopaj %{r} · son 12 ayın hisse başı temettüsüne göre', { r: num(d.taxRate * 100, 0) }))}${kpi(t('Portföy temettü verimi (brüt)'), pct(d.portfolioYieldPct, 2, false))}
    </div>
    <div class="card" style="margin-top:12px"><h3>${t('İlan edilen yaklaşan temettüler')} <span class="dim" style="font-weight:400">${t('İş Yatırım · tahmini net {v}', { v: money(upNet) })}</span></h3>
      <table class="t"><thead><tr><th>${t('Tarih')}</th><th>${t('Sembol')}</th><th class="r">${t('Hisse başı brüt')}</th><th class="r">${t('Adet')}</th><th class="r">${t('Brüt')}</th><th class="r">${t('Net (tahmini)')}</th><th class="r">${t('Verim')}</th><th>${t('Diğer')}</th></tr></thead>
      <tbody>${d.upcoming.map((x) => `<tr class="click" data-s="${esc(x.symbol)}"><td>${dateTR(x.date)}</td><td class="mono"><b>${esc(x.symbol)}</b></td><td class="r num">${x.dpsGross ? num(x.dpsGross, 4) : '—'}</td><td class="r num">${num(x.qty, 0)}</td><td class="r num">${money(x.gross, 'TRY', 2)}</td><td class="r num">${money(x.net, 'TRY', 2)}</td><td class="r num">${pct(x.yieldPct, 2, false)}</td><td class="muted">${[x.bonusPct ? t('Bedelsiz %{v}', { v: num(x.bonusPct, 2) }) : '', x.rightsPct ? t('Bedelli %{v}', { v: num(x.rightsPct, 2) }) : ''].filter(Boolean).join(' · ')}</td></tr>`).join('') || `<tr><td colspan="8" class="dim">${t('Portföyünüzdeki hisseler için ilan edilmiş yaklaşan temettü yok')}</td></tr>`}</tbody></table></div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>${t('Aylık gelir (son 12 ay)')}</h3><div class="chart-box md"><canvas id="divM"></canvas></div></div>
      <div class="card"><h3>${t('Yıllık gelir')}</h3><div class="chart-box md"><canvas id="divY"></canvas></div></div>
    </div>
    ${Object.keys(d.breakdown || {}).length ? `<div class="card" style="margin-top:12px"><h3>${t('Gelir dağılımı')} <select id="divYear" style="font-weight:400;margin-left:8px">${Object.keys(d.breakdown).sort().reverse().map((y) => `<option>${y}</option>`).join('')}</select></h3><div class="grid g3" id="divBreak"></div></div>` : ''}
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>${t('Beklenen temettüler (tahmini)')}</h3><table class="t"><thead><tr><th>${t('Sembol')}</th><th class="r">${t('Hisse başı (12 ay)')}</th><th class="r">${t('Adet')}</th><th class="r">${t('Yıllık brüt ₺')}</th><th class="r">${t('Net ₺')}</th><th class="r">${t('Verim')}</th><th class="r">${t('Maliyete göre verim')}</th></tr></thead>
        <tbody>${d.expected.map((x) => `<tr class="click" data-s="${esc(x.symbol)}" title="${esc(t('Son ödemeler: {d}', { d: x.lastDates.join(', ') }))}"><td class="mono"><b>${esc(x.symbol)}</b></td><td class="r num">${num(x.dps, 4)}</td><td class="r num">${num(x.qty, 0)}</td><td class="r num">${money(x.annualGross)}</td><td class="r num">${money(x.annualNet)}</td><td class="r num">${pct(x.yieldPct, 2, false)}</td><td class="r num">${pct(x.yieldOnCostPct, 2, false)}</td></tr>`).join('') || `<tr><td colspan="7" class="dim">${t('Veri yok')}</td></tr>`}</tbody></table></div>
      <div class="card"><h3>${t('Alınan temettüler')}</h3><div class="table-wrap" style="max-height:360px"><table class="t"><thead><tr><th>${t('Tarih')}</th><th>${t('Sembol')}</th><th>${t('Tür')}</th><th>${t('Platform')}</th><th class="r">${t('Brüt')}</th><th class="r">${t('Stopaj')}</th><th class="r">${t('Net ₺')}</th></tr></thead>
        <tbody>${d.items.map((x) => `<tr><td>${dateTR(x.date)}</td><td class="mono">${esc(x.symbol)}</td><td>${x.type === 'DRIP' ? 'DRIP' : t('Nakit')}</td><td>${esc(x.platform || '')}</td><td class="r num">${money(x.gross, 'TRY', 2)}</td><td class="r num">${x.tax ? money(x.tax, 'TRY', 2) : ''}</td><td class="r num">${money(x.amount, 'TRY', 2)}</td></tr>`).join('') || `<tr><td colspan="7" class="dim">${t('Henüz temettü kaydı yok. Eklemek için: Yeni işlem → Nakit temettü.')}</td></tr>`}</tbody></table></div></div>
    </div>`;
  makeChart($('#divM'), { type: 'bar', data: { labels: months, datasets: [{ label: t('Temettü (₺)'), data: months.map((m) => d.monthly[m] || 0), backgroundColor: css('--accent') }] }, options: baseOptions({ time: false }) });
  const years = Object.keys(d.yearly).sort();
  makeChart($('#divY'), { type: 'bar', data: { labels: years, datasets: [{ label: t('Temettü (₺)'), data: years.map((y) => d.yearly[y]), backgroundColor: css('--info') }] }, options: baseOptions({ time: false }) });
  const drawBreak = () => {
    const b = d.breakdown[$('#divYear').value] || {};
    const tbl = (title, obj) => {
      const rows = Object.entries(obj || {}).sort((x, y) => y[1] - x[1]);
      const sum = rows.reduce((a, [, v]) => a + v, 0) || 1;
      return `<div><div class="mini-head">${title}</div><table class="t"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(tx(k))}</td><td class="r num">${money(v)}</td><td class="r num">${num((v / sum) * 100, 1)}%</td></tr>`).join('') || '<tr><td class="dim">—</td></tr>'}</tbody></table></div>`;
    };
    $('#divBreak').innerHTML = tbl(t('Sektör'), b.bySector) + tbl(t('Varlık sınıfı'), b.byAsset) + tbl(t('Ülke'), b.byCountry);
  };
  if ($('#divYear')) { $('#divYear').onchange = drawBreak; drawBreak(); }
  $$('tr[data-s]', body).forEach((r) => r.onclick = () => selectSymbol(r.dataset.s));
}

// ── Risk & performans ─────────────────────────────
async function renderRisk() {
  body.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="row">
      <span class="mini-head" style="margin:0">${t('Dönem')}</span>
      <input type="date" id="rFrom" value="${esc(riskRange.from)}" title="${esc(t('Başlangıç tarihi'))}"><span>–</span><input type="date" id="rTo" value="${esc(riskRange.to)}" title="${esc(t('Bitiş tarihi'))}">
      <span class="seg" id="rQuick"><button data-q="all">${t('Tümü')}</button><button data-q="ytd" title="${esc(t('Yılbaşından beri'))}">${t('YBB')}</button><button data-q="1y">${t('1Y')}</button><button data-q="6m">${t('6A')}</button><button data-q="3m">${t('3A')}</button></span>
      <button class="btn sec" id="rApply">${t('Uygula')}</button>
      <span class="seg" id="rTab"><button data-r="perf" class="${riskTab === 'perf' ? 'active' : ''}">${t('Performans')}</button><button data-r="tax" class="${riskTab === 'tax' ? 'active' : ''}">${t('Beyanname')}</button></span></div>
    <div class="row dim" style="margin-top:6px">${esc(t('Yıllık satış stopajı, komisyon ve BSMV dökümü beyanname için ayrı sütunlardan gelir.'))}</div></div><div id="riskBody"><div class="skeleton" style="height:200px"></div></div>`;
  const setRange = (from, to) => { riskRange = { from, to }; localSet('pfRange', riskRange); renderRisk(); };
  $('#rApply').onclick = () => setRange($('#rFrom').value, $('#rTo').value);
  $('#rQuick').onclick = (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const d = new Date();
    const iso = (x) => x.toISOString().slice(0, 10);
    const map = { all: ['', ''], ytd: [`${d.getFullYear()}-01-01`, ''], '1y': [iso(new Date(Date.now() - 365 * 864e5)), ''], '6m': [iso(new Date(Date.now() - 182 * 864e5)), ''], '3m': [iso(new Date(Date.now() - 91 * 864e5)), ''] };
    setRange(...map[b.dataset.q]);
  };
  $('#rTab').onclick = (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    riskTab = b.dataset.r; localSet('pfRiskTab', riskTab); renderRisk();
  };
  let r;
  try { r = await getRisk(riskRange, true); } catch (e) { $('#riskBody').innerHTML = `<div class="card empty">${esc(tx(e.message))}</div>`; return; }
  if (tab !== 'risk') return;
  const rb = $('#riskBody');
  if (riskTab === 'tax') { renderTaxBody(rb, r); return; }
  if (!r.enough) { rb.innerHTML = `<div class="card empty">${t('Seçili dönem için yeterli veri yok. Risk metrikleri için işlem geçmişi ya da içe aktarılmış geçmiş değerler gerekiyor.')}</div>`; return; }
  const m = r.metrics;
  const f2 = (x) => (x == null ? '—' : num(x, 2));
  rb.innerHTML = `<div class="grid g4">
      ${kpi(t('Toplam getiri (TWR)'), pct(m.totalReturnPct), t('{from} – {to} · {n} gün', { from: dateTR(r.start), to: dateTR(r.end), n: r.days }), cls(m.totalReturnPct), t('Zaman ağırlıklı getiri: para giriş ve çıkışlarının etkisi arındırılır'))}
      ${kpi(t('Para ağırlıklı getiri (XIRR)'), pct(m.xirrPct), t('yıllık'), cls(m.xirrPct), t('Nakit akışlarının zamanlamasını hesaba katan yıllık iç verim oranı'))}
      ${kpi('CAGR', m.cagrPct != null ? pct(m.cagrPct) : '—', m.cagrPct != null ? t('yıllık bileşik') : t('1 yıldan kısa · yıllıklandırılmış {v}', { v: pct(m.annualizedPct) }), cls(m.cagrPct))}
      ${kpi(t('Volatilite (yıllık)'), pct(m.volatilityPct, 1, false))}
      ${kpi(t('En büyük düşüş'), pct(m.maxDrawdownPct), t('güncel düşüş {v}', { v: pct(m.currentDrawdownPct) }), 'down')}
      ${kpi('Sharpe', f2(m.sharpe), m.riskFreeSource?.startsWith('TLREF') ? t('risksiz faiz %{r} (TLREF ort.)', { r: num(m.riskFreeRatePct, 1) }) : t('risksiz faiz %{r}', { r: num(m.riskFreeRatePct, 1) }), '', m.riskFreeSource ? t('Risksiz faiz: {v}', { v: tx(m.riskFreeSource) }) : '')}
      ${kpi('Sortino', f2(m.sortino))}
      ${kpi('Calmar', f2(m.calmar))}
      ${kpi(t('Beta / korelasyon'), `${f2(m.beta)} / ${f2(m.correlation)}`, t('ölçüt: {v}', { v: esc(tx(r.benchmarks?.[m.benchmark]?.label || m.benchmark || '—')) }))}
      ${kpi(t('Devir hızı (yıllık)'), pct(m.turnoverPct, 0, false), t('min(alış, satış) / ort. değer'))}
      ${kpi(t('En iyi / en kötü ay'), `${m.bestMonth ? pct(m.bestMonth.pct, 1) : '—'} / ${m.worstMonth ? pct(m.worstMonth.pct, 1) : '—'}`, `${m.bestMonth?.month || ''} · ${m.worstMonth?.month || ''}`)}
      ${kpi(t('Pozitif ay oranı'), `${pct(m.positiveMonthsPct, 0, false)}`, t('en iyi / en kötü gün {a} / {b}', { a: pct(m.bestDayPct, 1), b: pct(m.worstDayPct, 1) }))}
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>${t('Dönemsel getiri')}</h3><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(90px,1fr))">${Object.entries(r.periods).map(([k, v]) => `<div class="kpi"><div class="l">${esc(tx(k))}</div><div class="v ${cls(v)}" style="font-size:16px">${pct(v)}</div></div>`).join('')}</div></div>
      <div class="card"><h3>${t('Karşılaştırma ölçütleri (aynı dönem, TL)')}</h3><table class="t"><tbody><tr><td><b>${t('Portföy (TWR)')}</b></td><td class="r num ${cls(m.totalReturnPct)}"><b>${pct(m.totalReturnPct)}</b></td><td></td></tr>${Object.entries(r.benchmarks || {}).map(([, b]) => `<tr><td>${esc(tx(b.label))}</td><td class="r num ${cls(b.returnPct)}">${pct(b.returnPct)}</td><td class="r num ${cls(m.totalReturnPct - b.returnPct)}" title="${esc(t('Portföy − ölçüt'))}">${b.returnPct != null ? t('{v} fark', { v: pct(m.totalReturnPct - b.returnPct) }) : ''}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>${t('Büyüme (başlangıç = 100)')} <span class="seg" id="perfMode"><button data-m="level" class="active">${t('Endeks')}</button><button data-m="value">${t('Değer ₺')}</button></span></h3><div class="row" id="rbenchToggles" style="margin-bottom:6px"></div><div class="chart-box md"><canvas id="rPerf"></canvas></div></div>
      <div class="card"><h3>${t('Düşüş')}</h3><div class="chart-box md"><canvas id="rDD"></canvas></div></div>
    </div>
    <div class="card" style="margin-top:12px"><h3>${t('Aylık getiriler')}</h3><div id="monthly"></div></div>
    <div class="card" style="margin-top:12px"><h3>${t('Çeyreklik getiri (TWR, %)')}</h3><div class="chart-box sm"><canvas id="rQuarter"></canvas></div></div>`;
  perfChart($('#rPerf'), 'level', false, riskRange);
  $('#perfMode').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; $$('#perfMode button').forEach((x) => x.classList.toggle('active', x === b)); perfChart($('#rPerf'), b.dataset.m, false, riskRange); };
  makeChart($('#rDD'), { type: 'line', data: { datasets: [{ label: t('Düşüş %'), data: r.drawdown.map((p) => ({ x: p.date, y: p.dd })), borderColor: css('--down'), borderWidth: 1.2, pointRadius: 0, fill: { target: 'origin', below: css('--down') + '22' } }] }, options: baseOptions() });
  const qk = Object.keys(r.quarterly || {});
  if (qk.length) {
    const qv = qk.map((k) => r.quarterly[k]);
    makeChart($('#rQuarter'), { type: 'bar', data: { labels: qk.map((k) => tx(k)), datasets: [{ label: t('Çeyreklik getiri %'), data: qv, backgroundColor: qv.map((v) => (v >= 0 ? css('--up') : css('--down')) + 'cc') }] }, options: baseOptions({ time: false }) });
  } else $('#rQuarter').parentElement.innerHTML = `<div class="empty">${t('Çeyreklik veri yok')}</div>`;
  const years = [...new Set(Object.keys(r.monthly).map((k) => k.slice(0, 4)))].sort().reverse();
  const MN = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(locale, { month: 'short' }).replace('.', ''));
  const cell = (v) => (v == null ? '<div></div>' : `<div style="background:${v >= 0 ? `rgba(34,197,94,${Math.min(Math.abs(v) / 10, 1) * 0.5 + 0.08})` : `rgba(239,68,68,${Math.min(Math.abs(v) / 10, 1) * 0.5 + 0.08})`}">${num(v, 1)}</div>`);
  $('#monthly').innerHTML = `<div class="table-wrap"><div class="monthly-grid"><div class="h">${t('Yıl')}</div>${MN.map((x) => `<div class="h">${x}</div>`).join('')}<div class="h">${t('Yıllık')}</div>
    ${years.map((y) => {
      const vals = MN.map((_, i) => r.monthly[`${y}-${String(i + 1).padStart(2, '0')}`]);
      const yr = vals.filter((v) => v != null).reduce((a, v) => a * (1 + v / 100), 1) - 1;
      return `<div class="h">${y}</div>${vals.map(cell).join('')}${cell(yr * 100)}`;
    }).join('')}</div></div>`;
}

// ── Risk ▸ Beyanname (yıllık kâr-zarar dökümü) ────────
const TAX_ROWS = [
  ['Brüt satış', 'grossSales', 0], ['Alış maliyeti', 'buyCost', 0], ['Gerçekleşen K/Z (net)', 'realized', 1],
  ['Satış stopajı', 'tax', 0], ['Komisyon', 'commission', 0], ['BSMV', 'bsmv', 0], ['Net nakit çıkışı', 'netOut', 0],
  ['Temettü brüt', 'dividendGross', 0], ['Temettü stopajı', 'dividendTax', 0],
];
function renderTaxBody(rb, r) {
  const ys = r.tax?.years || [];
  if (!ys.length) { rb.innerHTML = `<div class="card empty">${esc(t('Bu dönemde satış ya da temettü kaydı yok.'))}</div>`; return; }
  const sel = () => ys.find((y) => y.year === taxYear) || ys.at(-1);
  const draw = () => {
    const y = sel();
    rb.innerHTML = `<div class="card"><h3>${esc(t('Yıllık kâr-zarar / beyanname'))}</h3>
      <div class="table-wrap"><table class="t"><thead><tr><th>${esc(t('Kalem'))}</th>${ys.map((z) => `<th class="r"><span class="click" data-y="${z.year}" style="${z.year === y.year ? 'font-weight:700' : ''}">${z.year}</span></th>`).join('')}</tr></thead>
      <tbody>${TAX_ROWS.map(([l, k, signed]) => `<tr><td>${esc(t(l))}</td>${ys.map((z) => `<td class="r num ${signed ? cls(z[k]) : ''}">${money(z[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="strip" style="margin-top:10px"><b>${esc(t('Bu yılki toplam'))} (${y.year})</b> · ${esc(t('brüt satış {a}', { a: money(y.grossSales) }))} · ${esc(t('alış maliyeti {a}', { a: money(y.buyCost) }))} · <span class="${cls(y.realized)}">${esc(t('gerçekleşen K/Z {a}', { a: money(y.realized) }))}</span> · ${esc(t('stopaj {a}', { a: money(y.tax) }))} · ${esc(t('komisyon {a}', { a: money(y.commission) }))} · ${esc(t('BSMV {a}', { a: money(y.bsmv) }))} · <b>${esc(t('net nakit çıkışı {a}', { a: money(y.netOut) }))}</b> · ${esc(t('temettü {a} / stopaj {b}', { a: money(y.dividendGross), b: money(y.dividendTax) }))}</div></div>
      <div class="grid g4" style="margin-top:12px">
        ${kpi(t('Brüt satış'), money(y.grossSales), y.year)}
        ${kpi(t('Gerçekleşen K/Z (net)'), money(y.realized), y.realizedPct == null ? y.year : pct(y.realizedPct), cls(y.realized))}
        ${kpi(t('Vergi toplamı'), money(y.tax + y.bsmv), t('stopaj {a} · BSMV {b}', { a: money(y.tax), b: money(y.bsmv) }))}
        ${kpi(t('Net nakit çıkışı'), money(y.netOut), t('komisyon düşülmüş {a}', { a: money(y.commission) }))}
      </div>`;
    $$('[data-y]', rb).forEach((b) => { b.onclick = () => { taxYear = b.dataset.y; draw(); }; });
  };
  draw();
}

// ── İçe / dışa aktarma ────────────────────────────
function renderImport() {
  body.innerHTML = `<div class="grid g2">
    <div class="card"><h3>${t('İşlemleri CSV ile içe aktar')}</h3>
      <p class="muted">${t('Sütun başlıkları Türkçe ya da İngilizce olabilir: {cols}.', { cols: `<span class="mono">${t('tarih, işlem, sembol, adet, fiyat, komisyon, para birimi, kur, platform, hedef platform, hedef para birimi, hedef tutar, varlık tipi, strateji, not')}</span>` })}
      ${t('İşlem türleri: Alış, Satış, Temettü, DRIP, Bölünme/Bedelsiz, Maliyetsiz, Staking, Transfer, Döviz çevrimi, Yatırma, Çekme, Masraf, Faiz. İngilizce işlem kodları da tanınır (CASH_IN, CASH_OUT, CASH_DIVIDEND, COMMISSION…).')}
      ${t('Sayılar 1.234,56 ya da 1234.56; tarihler GG.AA.YYYY ya da YYYY-AA-GG biçiminde olabilir.')}</p>
      <div class="dropzone" id="csvDrop">${t('CSV dosyası seçin ya da buraya sürükleyin')}<input type="file" id="csvFile" accept=".csv,.txt,text/csv" hidden></div>
      <div class="row" style="margin-top:8px"><button class="ghost" id="csvSample">${t('Örnek CSV indir')}</button></div>
      <div id="csvPreview" style="margin-top:10px"></div></div>
    <div class="card"><h3>${t('Geçmiş portföy değerlerini içe aktar')}</h3>
      <p class="muted">${t('İşlem geçmişi olmayan dönemler için günlük ya da aylık portföy değerleri: {cols}. Risk metriklerinde ilk işleminizden önceki dönem için kullanılır.', { cols: `<span class="mono">${t('tarih, değer[, net yatırılan]')}</span>` })}</p>
      <div class="dropzone" id="snapDrop">${t('Geçmiş değerlerin CSV dosyasını seçin')}<input type="file" id="snapFile" accept=".csv,.txt" hidden></div>
      <div id="snapInfo" class="muted" style="margin-top:8px"></div>
      <button class="ghost" id="snapClear" style="margin-top:6px">${t('İçe aktarılan geçmiş değerleri sil')}</button></div>
    <div class="card"><h3>${t('Dışa aktarma ve yedek')}</h3>
      <div class="row"><a class="btn sec" href="/api/export/transactions.csv" download>${t('İşlemleri CSV olarak indir')}</a><a class="btn sec" href="/api/export/backup.json" download>${t('Tam yedek (JSON)')}</a></div>
      <p class="muted" style="margin-top:10px">${t('Yedeği geri yüklemek mevcut portföyün, izleme listesinin, zamanlanmış görevlerin ve ayarların yerine geçer.')}</p>
      <div class="dropzone" id="bakDrop">${t('Yedek JSON dosyasını seçin')}<input type="file" id="bakFile" accept=".json" hidden></div></div>
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
      const opt = (f) => `<select data-map="${f}"><option value="-1">${t('— yok —')}</option>${p.headers.map((hd, i) => `<option value="${i}" ${p.mapping[f] === i ? 'selected' : ''}>${esc(hd || t('Sütun {n}', { n: i + 1 }))}</option>`).join('')}</select>`;
      const mapUi = `<details ${p.missing.length || p.invalid ? 'open' : ''} style="margin-bottom:8px"><summary class="${p.missing.length ? 'down' : 'dim'}">${p.missing.length ? esc(t('Zorunlu sütunlar eşleştirilmedi: {list}', { list: p.missing.map((f) => tx(p.fields[f])).join(', ') })) : t('Sütun eşleştirmesi (otomatik algılandı, değiştirebilirsiniz)')}</summary>
        <div class="form-grid" style="margin-top:6px">${Object.entries(p.fields).map(([f, l]) => `<div class="field"><label>${esc(tx(l))}${['date', 'type'].includes(f) ? ' *' : ''}</label>${opt(f)}</div>`).join('')}</div>
        <button class="btn sec" id="csvRemap" style="margin-top:6px">${t('Yeniden önizle')}</button></details>`;
      const counts = [
        t('{n} satır içe aktarılacak', { n: p.valid }),
        `<span class="${p.invalid ? 'down' : ''}">${t('{n} hatalı', { n: p.invalid })}</span>`,
        p.duplicates ? `<span class="accent">${t('{n} zaten kayıtlı, atlanacak', { n: p.duplicates })}</span>` : '',
      ].filter(Boolean).join(' · ');
      $('#csvPreview').innerHTML = mapUi + (p.missing.length ? '' : `<div class="row between"><span>${counts}</span><button class="btn" id="csvCommit" ${p.valid ? '' : 'disabled'}>${t('{n} işlemi içe aktar', { n: p.valid })}</button></div>
        <div class="table-wrap" style="max-height:300px;margin-top:8px"><table class="t"><thead><tr><th>${t('Satır')}</th><th>${t('Tarih')}</th><th>${t('Tür')}</th><th>${t('Sembol')}</th><th class="r">${t('Adet')}</th><th class="r">${t('Fiyat')}</th><th>${t('Platform')}</th><th>${t('Durum')}</th></tr></thead>
        <tbody>${p.rows.map((r) => `<tr><td>${r.line}</td><td>${esc(r.tx.date || '?')}</td><td>${esc(tx(state.meta.txTypes[r.tx.type] || r.tx.type))}</td><td class="mono">${esc(r.tx.symbol || '')}</td><td class="r num">${r.tx.quantity ?? ''}</td><td class="r num">${r.tx.price ?? ''}</td><td>${esc(r.tx.platform || '')}</td><td class="${r.error ? 'err' : r.duplicate ? 'accent' : 'up'}">${esc(r.error ? tx(r.error) : r.duplicate ? t('Zaten kayıtlı') : t('Hazır'))}</td></tr>`).join('')}</tbody></table></div>`);
      $('#csvRemap').onclick = () => { csvMap = Object.fromEntries($$('[data-map]', $('#csvPreview')).map((x) => [x.dataset.map, Number(x.value)])); csvPreview(); };
      const c = $('#csvCommit');
      if (c) c.onclick = async () => {
        try {
          const r = await api('/import/csv/commit', { method: 'POST', body: { text: csvText, mapping: csvMap } });
          toast([t('{n} işlem içe aktarıldı', { n: r.imported }), r.duplicates ? t('{n} yinelenen atlandı', { n: r.duplicates }) : '', r.skipped ? t('{n} satır hatalı', { n: r.skipped }) : ''].filter(Boolean).join(', '), 'ok');
          $('#csvPreview').innerHTML = r.errors?.length ? `<div class="err">${r.errors.map((e) => t('Satır {n}: {msg}', { n: e.line, msg: esc(tx(e.error)) })).join('<br>')}</div>` : '';
        } catch (e) { toast(tx(e.message), 'err'); }
      };
    } catch (e) { $('#csvPreview').innerHTML = `<div class="err">${esc(tx(e.message))}</div>`; }
  };
  wire('#csvDrop', '#csvFile', (text) => { csvText = text; csvMap = null; csvPreview(); });
  $('#csvSample').onclick = () => {
    // Örnek dosya arayüz dilinde; sunucu hem Türkçe hem İngilizce başlık ve işlem adlarını tanır
    const csv = lang === 'en'
      ? 'date;type;symbol;quantity;price;fee;currency;platform;to_platform;to_currency;to_amount;notes\n'
        + '2025-01-02;deposit;;;100000.00;;TRY;Broker A;;;;initial deposit\n2025-01-03;buy;THYAO;100;285.50;25;TRY;Broker A;;;;\n'
        + '2025-05-15;dividend;THYAO;;1250.00;187.50;TRY;Broker A;;;;withholding goes in the fee column\n2025-07-01;sell;THYAO;40;310.00;12;TRY;Broker A;;;;\n'
        + '2025-07-10;fx_convert;;;20000.00;;TRY;Broker A;;USD;500;\n2025-07-12;transfer;THYAO;20;;;TRY;Broker A;Broker B;;;move between accounts\n'
      : 'tarih;işlem;sembol;adet;fiyat;komisyon;para birimi;platform;hedef platform;hedef para birimi;hedef tutar;not\n'
        + '02.01.2025;Yatırma;;;100.000,00;;TRY;Kurum A;;;;ilk para\n03.01.2025;Alış;THYAO;100;285,50;25;TRY;Kurum A;;;;\n'
        + '15.05.2025;Temettü;THYAO;;1.250,00;187,50;TRY;Kurum A;;;;stopaj komisyon sütununda\n01.07.2025;Satış;THYAO;40;310,00;12;TRY;Kurum A;;;;\n'
        + '10.07.2025;Döviz çevrimi;;;20.000,00;;TRY;Kurum A;;USD;500;\n12.07.2025;Transfer;THYAO;20;;;TRY;Kurum A;Kurum B;;;virman\n';
    const a = h(`<a download="${lang === 'en' ? 'sample-transactions.csv' : 'ornek-islemler.csv'}"></a>`); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.click();
  };
  const snapInfo = async () => { const s = await api('/snapshots'); const imp = s.filter((x) => x.source === 'import'); if ($('#snapInfo')) $('#snapInfo').textContent = t('{n} geçmiş değer kaydı ({imp} içe aktarılan, {auto} otomatik)', { n: s.length, imp: imp.length, auto: s.length - imp.length }); };
  snapInfo();
  wire('#snapDrop', '#snapFile', async (text) => { try { const r = await api('/import/snapshots', { method: 'POST', body: { text } }); toast(t('{n} geçmiş değer içe aktarıldı', { n: r.imported }), 'ok'); snapInfo(); riskCache.clear(); } catch (e) { toast(tx(e.message), 'err'); } });
  $('#snapClear').onclick = async () => { if (await confirmBox(t('İçe aktarılan geçmiş değerler silinsin mi?'), { danger: true, ok: t('Sil') })) { await api('/snapshots', { method: 'DELETE' }); snapInfo(); riskCache.clear(); } };
  wire('#bakDrop', '#bakFile', async (text) => {
    if (!(await confirmBox(t('Yedek geri yüklensin mi? Mevcut veriler silinecek.'), { danger: true, ok: t('Geri yükle') }))) return;
    try { await api('/import/backup', { method: 'POST', body: JSON.parse(text) }); toast(t('Yedek geri yüklendi'), 'ok'); } catch (e) { toast(tx(e.message), 'err'); }
  });
}

// ── Portföy ayarları ──────────────────────────────
// İşlem türlerinin gerekli alan kodları (sunucudaki TX_META.needs)
const NEED_LABELS = { symbol: t('sembol'), quantity: t('miktar'), price: t('fiyat'), amount: t('tutar'), ratio: t('oran'), to_platform: t('hedef platform'), to_currency: t('hedef para birimi'), to_amount: t('hedef tutar') };
async function renderSettings() {
  const [plats, strats, syms, ref] = await Promise.all([api('/platforms'), api('/strategies'), api('/symbols'), api('/portfolio/reference')]);
  if (tab !== 'ayarlar') return;
  const s = state.settings;
  const benchSel = new Set(s.benchmarks || []);
  body.innerHTML = `<div class="grid g2">
    <div class="card"><h3>${t('Platformlar (aracı kurum / hesap)')}</h3>
      <table class="t"><tbody>${plats.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.currency)}</td><td class="muted">${esc(p.notes || '')}</td><td class="r"><button class="ghost" data-dp="${p.id}">${t('Kaldır')}</button></td></tr>`).join('') || `<tr><td class="dim">${t('Platform yok')}</td></tr>`}</tbody></table>
      <form class="row" id="platForm" style="margin-top:8px"><input name="name" placeholder="${esc(t('Platform adı'))}" required><select name="currency">${ref.currencies.map((c) => `<option>${c}</option>`).join('')}</select><input name="notes" placeholder="${esc(t('Not'))}"><button class="btn">${t('Ekle')}</button></form></div>
    <div class="card"><h3>${t('Stratejiler')}</h3>
      <table class="t"><tbody>${strats.map((x) => `<tr><td>${esc(x.name)}</td><td class="muted">${esc(x.description || '')}</td><td class="r"><button class="ghost" data-ds="${x.id}">${t('Kaldır')}</button></td></tr>`).join('') || `<tr><td class="dim">${t('Henüz strateji yok (ör. Ana, Temettü, HODL, Kısa vade)')}</td></tr>`}</tbody></table>
      <form class="row" id="stratForm" style="margin-top:8px"><input name="name" placeholder="${esc(t('Strateji adı'))}" required><input name="description" placeholder="${esc(t('Açıklama'))}"><button class="btn">${t('Ekle')}</button></form></div>
    <div class="card"><h3>${t('Sembol ayarları: sektör, sınıf, elle fiyat')}</h3>
      <p class="muted">${t('BIST sektörleri İş Yatırım sınıflandırmasından gelir; burada girdiğiniz değer önceliklidir.')}</p>
      <table class="t"><thead><tr><th>${t('Sembol')}</th><th>${t('Sektör')}</th><th>${t('Sınıf')}</th><th class="r">${t('Elle fiyat')}</th><th></th></tr></thead><tbody>${syms.map((x) => `<tr><td class="mono">${esc(x.symbol)}</td><td>${esc(x.sector || '')}</td><td>${esc(tx(ref.assetTypes[x.asset_type] || ''))}</td><td class="r num">${x.manual_price != null ? `${price(x.manual_price)} <span class="dim">${dateTR(x.manual_price_at)}</span>` : ''}</td><td class="r">${x.manual_price != null ? `<button class="ghost" data-mp="${esc(x.symbol)}">${t('Fiyat')}</button>` : ''}</td></tr>`).join('') || `<tr><td class="dim" colspan="5">${t('Özel tanım yok')}</td></tr>`}</tbody></table>
      <form class="row" id="symForm" style="margin-top:8px"><input name="symbol" placeholder="${esc(t('Sembol'))}" required style="width:100px"><input name="sector" placeholder="${esc(t('Sektör'))}"><select name="asset_type"><option value="">${t('Sınıf (değiştirilmesin)')}</option>${Object.entries(ref.assetTypes).map(([k, v]) => `<option value="${k}">${esc(tx(v))}</option>`).join('')}</select><button class="btn">${t('Kaydet')}</button></form></div>
    <div class="card"><h3>${t('Hesaplama')}</h3>
      <div class="form-grid">
        <div class="field"><label>${t('Risksiz faiz kaynağı (Sharpe / Sortino)')}</label><select id="rfSrc"><option value="tlref">${t('TLREF dönem ortalaması (Borsa İstanbul, otomatik)')}</option><option value="sabit">${t('Sabit oran')}</option></select></div>
        <div class="field"><label>${t('Sabit risksiz faiz (yıllık %)')}</label><input id="rf" type="number" step="0.01"></div>
        <div class="field"><label>${t('Temettü stopajı (%)')}</label><input id="dtax" type="number" step="0.01" value="${(s.dividendTaxRate ?? 0.15) * 100}"></div>
        <div class="field"><label>${t('Hisse satış stopajı (%)')}</label><input id="stax" type="number" step="0.01" value="${(s.sellTaxRate ?? 0.10) * 100}"></div>
        <div class="field"><label>${t('Ana karşılaştırma ölçütü (beta)')}</label><select id="bench">${Object.entries(ref.benchmarks).map(([k, v]) => `<option value="${k}" ${k === (s.benchmark || 'XU100') ? 'selected' : ''}>${esc(tx(v))}</option>`).join('')}</select></div>
      </div>
      <div class="mini-head" style="margin-top:10px">${t('Grafikteki karşılaştırma ölçütleri')}</div>
      <div class="row">${Object.entries(ref.benchmarks).map(([k, v]) => `<label class="pill"><input type="checkbox" data-bm="${k}" ${benchSel.has(k) ? 'checked' : ''} style="margin:0 4px 0 0;vertical-align:-1px">${esc(tx(v))}</label>`).join('')}</div>
      <button class="btn" id="calcSave" style="margin-top:10px">${t('Kaydet')}</button>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <h3>${t('Portföy verilerini sıfırla')}</h3>
      <p class="muted">${t('Tüm işlemler, platformlar, stratejiler ve geçmiş değerler silinir. Geri alınamaz; önce yedek alın.')}</p>
      <button class="btn danger" id="pfReset">${t('Portföyü sıfırla')}</button></div>
    <div class="card" style="grid-column:1/-1"><h3>${t('İşlem türleri')}</h3>
      <table class="t"><thead><tr><th>${t('Kod')}</th><th>${t('Tür')}</th><th class="r">${t('Miktar etkisi')}</th><th class="r">${t('Nakit etkisi')}</th><th>${t('Gelir')}</th><th>${t('Gerekli alanlar')}</th></tr></thead>
      <tbody>${ref.actions.map((a) => `<tr><td class="mono">${a.code}</td><td>${esc(tx(a.label))}</td><td class="r num">${a.qty > 0 ? '+' : a.qty < 0 ? '−' : '0'}</td><td class="r num">${a.cash > 0 ? '+' : a.cash < 0 ? '−' : '0'}</td><td>${a.income ? '✓' : ''}</td><td class="muted">${esc(a.needs.map((n) => NEED_LABELS[n] || n).join(', '))}</td></tr>`).join('')}</tbody></table>
      <div class="row" style="margin-top:10px"><span class="mini-head" style="margin:0">${t('Varlık sınıfları')}</span>${Object.values(ref.assetTypes).map((v) => `<span class="pill">${esc(tx(v))}</span>`).join('')}<span class="mini-head" style="margin:0 0 0 12px">${t('Para birimleri')}</span>${ref.currencies.map((v) => `<span class="pill">${esc(v)}</span>`).join('')}</div></div>
  </div>`;
  const formObj = (f) => Object.fromEntries(new FormData(f));
  $('#platForm').onsubmit = async (e) => { e.preventDefault(); try { await api('/platforms', { method: 'POST', body: formObj(e.target) }); renderSettings(); } catch (x) { toast(tx(x.message), 'err'); } };
  $('#stratForm').onsubmit = async (e) => { e.preventDefault(); try { await api('/strategies', { method: 'POST', body: formObj(e.target) }); renderSettings(); } catch (x) { toast(tx(x.message), 'err'); } };
  $('#symForm').onsubmit = async (e) => { e.preventDefault(); const o = formObj(e.target); await api(`/symbols/${encodeURIComponent(o.symbol)}`, { method: 'POST', body: { sector: o.sector || null, asset_type: o.asset_type || null } }); load(); renderSettings(); };
  $$('[data-dp]', body).forEach((b) => b.onclick = async () => { if (await confirmBox(t('Platform kaldırılsın mı? Bu platformdaki işlemler platformsuz kalır.'), { danger: true, ok: t('Kaldır') })) { await api(`/platforms/${b.dataset.dp}`, { method: 'DELETE' }); renderSettings(); } });
  $$('[data-ds]', body).forEach((b) => b.onclick = async () => { await api(`/strategies/${b.dataset.ds}`, { method: 'DELETE' }); renderSettings(); });
  $$('[data-mp]', body).forEach((b) => b.onclick = () => openPriceModal(b.dataset.mp));
  $('#rf').value = String(Math.round((s.riskFreeRate ?? 0.4) * 10000) / 100);
  $('#rfSrc').value = s.riskFreeSource || 'tlref';
  $('#calcSave').onclick = async () => {
    const benchmarks = $$('[data-bm]', body).filter((c) => c.checked).map((c) => c.dataset.bm);
    await api('/settings', { method: 'PUT', body: { riskFreeRate: Number($('#rf').value) / 100, riskFreeSource: $('#rfSrc').value, dividendTaxRate: Number($('#dtax').value) / 100, sellTaxRate: Number($('#stax').value) / 100, benchmark: $('#bench').value, benchmarks } });
    riskCache.clear(); toast(t('Kaydedildi'), 'ok');
  };
  $('#pfReset').onclick = () => {
    const m = modal({ title: t('Portföyü sıfırla'), body: `<p>${t('Onaylamak için <b class="mono">SIFIRLA</b> yazın.')}</p><input id="rsTxt" style="width:100%">`, footer: `<button class="btn sec" data-close>${t('İptal')}</button><button class="btn danger" id="rsGo">${t('Sıfırla')}</button>` });
    $('#rsGo', m.el).onclick = async () => { try { await api('/portfolio/reset', { method: 'POST', body: { confirm: $('#rsTxt', m.el).value.trim() } }); m.close(); toast(t('Portföy sıfırlandı'), 'ok'); } catch (e) { toast(tx(e.message), 'err'); } };
  };
}

// ── İşlem ekleme / düzenleme penceresi ───────────
export async function openTxModal(init = {}) {
  const [plats, strats] = await Promise.all([api('/platforms').catch(() => []), api('/strategies').catch(() => [])]);
  const M = state.meta, T = M.txTypes, A = M.assetTypes, CUR = M.currencies || ['TRY', 'USD', 'EUR'];
  const editing = !!init.id;
  const v = { date: today(), type: 'BUY', fee: 0, currency: '', ...init };
  const m = modal({
    title: editing ? t('İşlemi düzenle') : t('İşlem ekle'),
    body: `<form id="txForm" class="form-grid">
      <div class="field"><label>${t('İşlem türü')}</label><select name="type">${Object.entries(T).map(([k, l]) => `<option value="${k}" ${v.type === k ? 'selected' : ''}>${esc(tx(l))}</option>`).join('')}</select></div>
      <div class="field"><label>${t('Tarih')}</label><input type="date" name="date" value="${esc(v.date)}" max="${today()}" required></div>
      <div class="field" data-f="symbol"><label id="symLbl">${t('Sembol')}</label><input name="symbol" value="${esc(v.symbol || '')}" placeholder="${esc(t('THYAO, AAPL.US, GRAM, fon kodu…'))}" autocomplete="off"></div>
      <div class="field" data-f="asset"><label>${t('Varlık sınıfı')}</label><select name="asset_type"><option value="">${t('Otomatik')}</option>${Object.entries(A).map(([k, l]) => `<option value="${k}" ${v.asset_type === k ? 'selected' : ''}>${esc(tx(l))}</option>`).join('')}</select></div>
      <div class="field" data-f="qty"><label id="qtyLbl">${t('Miktar')}</label><input type="number" step="any" name="quantity" value="${v.quantity ?? ''}"></div>
      <div class="field" data-f="price"><label id="priceLbl">${t('Birim fiyat')}</label><input type="number" step="any" name="price" value="${v.price != null ? Math.round(v.price * 1e6) / 1e6 : ''}"></div>
      <div class="field" data-f="fee"><label id="feeLbl">${t('Komisyon')}</label><input type="number" step="any" name="fee" value="${v.fee ?? 0}"></div>
      <div class="field" data-f="tax"><label>${t('Stopaj')}</label><input type="number" step="any" name="tax" value="${v.tax ?? 0}"></div>
      <div class="field" data-f="other"><label>${t('BSMV / diğer ücret')}</label><input type="number" step="any" name="other_fee" value="${v.other_fee ?? 0}"></div>
      <div class="field" data-f="cur"><label id="curLbl">${t('Para birimi')}</label><select name="currency"><option value="">${t('Otomatik')}</option>${CUR.map((c) => `<option ${v.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field" data-f="fx"><label>${t('İşlem günü kuru (₺)')}</label><input type="number" step="any" name="fx_rate" value="${v.currency && v.currency !== 'TRY' ? v.fx_rate ?? '' : ''}" placeholder="${esc(t('Boş bırakılırsa işlem günü TCMB döviz satış kuru'))}"></div>
      <div class="field" data-f="toCur"><label>${t('Hedef para birimi')}</label><select name="to_currency">${CUR.map((c) => `<option ${v.to_currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field" data-f="toAmt"><label>${t('Hedef tutar')}</label><input type="number" step="any" name="to_amount" value="${v.to_amount ?? ''}"></div>
      <div class="field"><label id="platLbl">${t('Platform')}</label><input name="platform" list="platList" value="${esc(v.platform || '')}" placeholder="${esc(t('Aracı kurum / hesap'))}"><datalist id="platList">${plats.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div class="field" data-f="toPlat"><label>${t('Hedef platform')}</label><input name="to_platform" list="platList" value="${esc(v.to_platform || '')}"></div>
      <div class="field"><label>${t('Strateji')}</label><input name="strategy" list="stratList" value="${esc(v.strategy || '')}"><datalist id="stratList">${strats.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div class="field" style="grid-column:1/-1"><label>${t('Notlar')}</label><input name="notes" value="${esc(v.notes || '')}"></div>
      <div style="grid-column:1/-1" class="muted" id="txTotal"></div>
      <div style="grid-column:1/-1;font-size:11px" class="dim" id="txHelp"></div>
    </form>`,
    footer: `<button class="btn sec" data-close>${t('İptal')}</button><button class="btn" id="txSave">${editing ? t('Güncelle') : t('Kaydet')}</button>`,
  });
  const f = $('#txForm', m.el);
  if (v.type === 'FX_CONVERT' && !v.currency) f.currency.value = 'TRY';
  const HELP = {
    BUY: t('Alış: miktar × fiyat + komisyon, platformun nakdinden düşülür (nakit takibi açıksa).'),
    SELL: t('Satış: gerçekleşen K/Z ortalama maliyet yöntemiyle hesaplanır.'),
    DRIP: t('Temettünün aynı hisseye yeniden yatırılması: alınan adet × birim fiyat hem temettü geliri hem de maliyet olarak kaydedilir.'),
    DIVIDEND: t('Nakit temettü: tutar brüt temettüdür, stopaj alanına kesilen vergi yazılır. Net tutar nakde eklenir.'),
    SPLIT: t('Bölünme / bedelsiz: oran 2 ise her 1 hisse 2 olur (%100 bedelsiz = 2). Toplam maliyet değişmez, ortalama maliyet düşer.'),
    FREE: t('Maliyetsiz edinim: hediye ya da bedelsiz adet; maliyet 0 kabul edilir.'),
    STAKING: t('Kripto staking ödülü: adet maliyetsiz eklenir; birim fiyat girilirse gelir olarak raporlanır.'),
    TRANSFER: t('Platformlar arası transfer: sembol ve adet (maliyet de taşınır) ya da sembolsüz nakit tutarı.'),
    FX_CONVERT: t('Döviz çevrimi: kaynak tutar (para birimi) → hedef tutar (hedef para birimi). Uygulanan kur, iki tutarın oranıdır.'),
    DEPOSIT: t('Nakit girişi: net yatırılan tutarı artırır ve nakit takibini açar.'), WITHDRAW: t('Nakit çıkışı: net yatırılan tutarı azaltır.'),
    FEE: t('Hesap işletim, saklama vb. masraflar.'), INTEREST: t('Faiz geliri (mevduat, repo, para piyasası).'),
  };
  const sync = () => {
    const ty = f.type.value;
    if (ty === 'FX_CONVERT') {
      if (!f.currency.value) f.currency.value = 'TRY';
      if (f.to_currency.value === f.currency.value) f.to_currency.value = CUR.find((c) => c !== f.currency.value && c !== 'TRY') || CUR.find((c) => c !== f.currency.value);
    }
    const need = new Set(M.txMeta?.[ty]?.needs || []);
    const show = (k, on) => { const el = $(`[data-f=${k}]`, f); if (el) el.hidden = !on; };
    const amount = need.has('amount');
    show('symbol', need.has('symbol') || ty === 'TRANSFER' || ty === 'INTEREST');
    show('asset', ['BUY', 'FREE', 'STAKING', 'DRIP'].includes(ty));
    show('qty', need.has('quantity') || need.has('ratio') || ty === 'TRANSFER');
    show('price', ['BUY', 'SELL', 'DRIP', 'STAKING'].includes(ty) || amount || ty === 'TRANSFER');
    show('fee', ['BUY', 'SELL', 'DRIP', 'DIVIDEND'].includes(ty));
    show('cur', ty !== 'SPLIT' && ty !== 'FREE');
    show('fx', ty !== 'SPLIT' && ty !== 'FREE' && (f.currency.value && f.currency.value !== 'TRY'));
    show('toCur', ty === 'FX_CONVERT'); show('toAmt', ty === 'FX_CONVERT'); show('toPlat', ty === 'TRANSFER');
    $('#symLbl', f).textContent = ty === 'TRANSFER' ? t('Sembol (nakit için boş bırakın)') : ty === 'INTEREST' ? t('Sembol (isteğe bağlı)') : t('Sembol');
    $('#qtyLbl', f).textContent = ty === 'SPLIT' ? t('Bölünme oranı') : t('Miktar (adet)');
    $('#priceLbl', f).textContent = amount || (ty === 'TRANSFER' && !f.symbol.value) ? (ty === 'DIVIDEND' ? t('Brüt tutar') : ty === 'FX_CONVERT' ? t('Kaynak tutar') : t('Tutar')) : ty === 'STAKING' ? t('Birim değer (isteğe bağlı)') : t('Birim fiyat');
    $('#feeLbl', f).textContent = t('Komisyon');
    show('tax', ['SELL', 'DIVIDEND'].includes(ty)); show('other', ty === 'SELL');
    $('#curLbl', f).textContent = ty === 'FX_CONVERT' ? t('Kaynak para birimi') : t('Para birimi');
    $('#platLbl', f).textContent = ty === 'TRANSFER' ? t('Kaynak platform') : t('Platform');
    const q = Number(f.quantity.value || 0), p = Number(f.price.value || 0), fee = Number(f.fee.value || 0);
    const curTxt = f.currency.value || '';
    let total = '';
    const tax = Number(f.tax?.value || 0), other = Number(f.other_fee?.value || 0);
    if (['BUY', 'SELL'].includes(ty) && q && p) total = t('Toplam: {v} {cur}', { v: num(q * p + (ty === 'BUY' ? fee + tax + other : -(fee + tax + other)), 2), cur: curTxt });
    if (ty === 'DRIP' && q && p) total = t('Yeniden yatırılan temettü: {v} {cur}', { v: num(q * p, 2), cur: curTxt });
    if (ty === 'DIVIDEND' && p) total = t('Net temettü: {v} {cur}', { v: num(p - fee - tax, 2), cur: curTxt });
    if (ty === 'FX_CONVERT' && p && Number(f.to_amount.value)) total = t('Uygulanan kur: 1 {to} = {rate} {from}', { to: f.to_currency.value, rate: num(p / Number(f.to_amount.value), 4), from: f.currency.value || 'TRY' });
    $('#txTotal', f).textContent = total.trim();
    // Platform nakit bakiyesi ve yetersiz bakiye uyarısı (nakit takibi açıksa)
    const cur = f.currency.value || (/\.US$/i.test(f.symbol.value.trim()) ? 'USD' : 'TRY');
    const outflow = ty === 'BUY' ? q * p + fee : ['WITHDRAW', 'FEE', 'FX_CONVERT'].includes(ty) || (ty === 'TRANSFER' && !f.symbol.value.trim()) ? p : 0;
    const plat = f.platform.value.trim();
    const bal = data?.totals?.cashTracking && plat ? (data.cash || []).filter((c) => c.platform === plat && c.currency === cur).reduce((a, c) => a + c.amount, 0) : null;
    if (bal != null && outflow > 0) {
      const short = outflow > bal + 0.005;
      $('#txTotal', f).innerHTML = `${esc(total.trim())}${total ? '<br>' : ''}<span class="${short ? 'down' : 'dim'}">${t('{plat} {cur} bakiyesi: {v}', { plat: esc(plat), cur, v: num(bal, 2) })}${short ? ` · ${t('⚠ Tutar bakiyeyi {x} {cur} aşıyor; önce nakit girişi ya da döviz çevrimi kaydedin', { x: num(outflow - bal, 2), cur })}` : ''}</span>`;
    }
    $('#txHelp', f).textContent = HELP[ty] || '';
  };
  f.addEventListener('input', sync);
  sync();
  f.symbol.addEventListener('change', async () => {
    if (!f.price.value && f.symbol.value && ['BUY', 'SELL'].includes(f.type.value)) { const q = await api(`/quote/${encodeURIComponent(f.symbol.value)}`).catch(() => null); if (q?.price) { f.price.value = q.price; sync(); } }
  });
  $('#txSave', m.el).onclick = async () => {
    const o = Object.fromEntries(new FormData(f));
    for (const k of ['quantity', 'price', 'fee', 'tax', 'other_fee', 'fx_rate', 'to_amount']) o[k] = o[k] === '' || o[k] == null ? undefined : Number(o[k]);
    for (const k of ['currency', 'asset_type', 'to_currency', 'to_platform', 'symbol', 'platform', 'strategy']) if (!o[k]) delete o[k];
    if (o.type !== 'FX_CONVERT') { delete o.to_currency; delete o.to_amount; }
    if (o.type !== 'TRANSFER') delete o.to_platform;
    try {
      await api(editing ? `/transactions/${init.id}` : '/transactions', { method: editing ? 'PUT' : 'POST', body: o });
      toast(editing ? t('İşlem güncellendi') : t('İşlem eklendi'), 'ok');
      m.close();
    } catch (e) { toast(tx(e.message), 'err'); }
  };
}

on('ws:portfolio.changed', () => { riskCache.clear(); load(); });
// Canlı fiyatlarla özet/varlıklar sessizce tazelenir (filtre ve kaydırma korunur)
const debouncedLoad = debounce(load, 3000);
on('quotes', () => { if (root.classList.contains('active') && ['ozet', 'varliklar', 'pozisyonlar'].includes(tab) && !document.querySelector('.modal-back')) debouncedLoad(); });
on('view:shown', (v) => { if (v === 'portfolio') load(); });
on('settings', () => { if (root.classList.contains('active') && tab !== 'ayarlar') render(); });
on('ready', load);
on('app:refresh', load);

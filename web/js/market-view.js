// kmy terminal sekmesi: ana ekran, sembol sayfaları (özet · finans · skor · değer · karşılaştırma),
// piyasa sayfaları (tarayıcı · sektör haritası · piyasa özeti) ve alttaki komut satırı
import { state, on, emit, api, $, $$, h, esc, md, num, price, pct, cls, compact, dateTR, css, toast, modal, selectSymbol, askAgent, localGet, localSet, timeTR, sqlDate, srcTag, debounce, confirmBox, openPdfViewer, today } from './core.js';
import { baseOptions, makeChart, palette } from './charts.js';
import { notify } from './chat.js';
import { openTxModal } from './portfolio-view.js';
import { openKapDetail, signalPill } from './kap.js';
import { t, tx, lang, locale } from './i18n.js';
import { initBacktest } from './backtest-view.js';
import { toIcs } from './cal-ics.js';

const root = $('#view-market');
const enc = encodeURIComponent;
const SYM_PAGES = ['sum', 'fin', 'score', 'value', 'comp'];
const PAGES = ['home', ...SYM_PAGES, 'screen', 'sectors', 'market', 'calendar'];
const FKEYS = [['sum', t('ÖZET')], ['fin', t('FİNANS')], ['score', t('SKOR')], ['value', t('DEĞER')], ['comp', t('KARŞ')]];
const SHORT = [t('[kısa]ÖZET'), t('[kısa]FİN'), t('[kısa]SKOR'), t('[kısa]DEĞER'), t('[kısa]KARŞ')];
const RANGES = [['1d', t('1G')], ['5d', t('1H')], ['1mo', t('1A')], ['3mo', t('3A')], ['6mo', t('6A')], ['ytd', t('YBB')], ['1y', t('1Y')], ['5y', t('5Y')], ['max', t('Tümü')]];
const DISCLAIMER = t('Bilgi amaçlıdır; yatırım tavsiyesi değildir.');
// ÖZET alt sekmeleri: veri renderSum'da bir kez çekilir, sekme değişimi yalnız göster/gizle yapar
const SUM_TABS = [['px', t('FİYAT · RAKAMLAR')], ['news', t('HABER AKIŞI')], ['docs', t('AJAN · BELGE · TEMETTÜ')]];
// Ölçüt referansı yalnız günlük barlı aralıklarda çizilir: 5Y haftalık, TÜMÜ aylık veri gelir
const BENCH_RANGES = ['1mo', '3mo', '6mo', 'ytd', '1y', '2y'];
const BENCH_HIDE_TIP = t('Uzun aralıklarda (5Y, Tümü) ölçüt verisi haftalık/aylık geldiği için referans çizgisi gizlenir; yanlış karşılaştırma göstermemek için.');
const BENCH_HIDE_INTRADAY = t('Gün içi aralıklarda ölçüt verisi günlük geldiği için referans çizgisi çizilmez.');
const OV_NO_DATA = t('Bu aralıkta yeterli veri yok');
let sumTab = localGet('sumTab', 'px');
const ovOk = new Set(['vol']); // overlay için yeterli veri var mı (SMA200 5Y/TÜMÜ'de hesaplanamaz)
let benchData = null;
let range = localGet('range', '6mo');
const overlays = new Set(localGet('overlays', ['sma20', 'sma50']));
let lower = localGet('lower', 'rsi');
let moversTab = 'gainers';
let calScope = localGet('calScope', 'watchlist');
// TAKVİM sayfası: kapsam '' ise hiç seçilmedi (portföy, boşsa liste); tür seçimi en az bir tür içerir
const CAL_KINDS = ['temettu', 'sermaye', 'tcmb', 'bilanco', 'tufe'];
let calPageScope = localGet('calPageScope', '');
let calKinds = (() => {
  const k = localGet('calKinds', CAL_KINDS);
  let ok = Array.isArray(k) ? k.filter((x) => CAL_KINDS.includes(x)) : [];
  if (!ok.length) ok = [...CAL_KINDS];
  if (!localGet('calTufeSeen')) { if (!ok.includes('tufe')) ok.push('tufe'); localSet('calKinds', ok); localSet('calTufeSeen', 1); }
  return ok;
})();
let lastHist = null;
let symToken = 0;
let page = 'home';
let curSym = state.selected;
let pendingPage = null;
const rendered = {}; // sayfa → çizildiği sembol ('*' sembolden bağımsız sayfalar)
const names = new Map(); // sembol → şirket adı (temel verilerden)

// Sunucunun döndürdüğü sabit sektör adları (İş Yatırım + özel semboller) istemcide çevrilir
const sectorName = (s) => (s ? t(s) : '—');
// Çeyrek etiketi: '2024-Ç3' → EN '2024 Q3'; kümülatif dönem: '2024/9' → '2024 / 9 ay'
const qLabel = (p) => (lang === 'en' ? String(p).replace(/-Ç(\d)/, ' Q$1') : p);
const cumLabel = (p) => { const [y, m] = String(p).split('/'); return m ? t('{y} / {m} ay', { y, m }) : p; };
const sub = (s) => `<span class="dim">${s}</span>`;
const SKEL = '<div class="skeleton"></div>';
const dimMsg = (s) => `<div class="dim">${s}</div>`;
const panel = (title, body, { extra = '', cls: c = '', tip = '' } = {}) => `<div class="kt-panel ${c}"><div class="kt-ph"${tip ? ` title="${esc(tip)}"` : ''}><span>${title}</span>${extra}</div><div class="kt-pb">${body}</div></div>`;

const ICON = {
  co: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V6.5L11 4v16M11 20V9l9 3v8M2.5 20h19M7.5 9v.01M7.5 12.5v.01M7.5 16v.01M14.5 14h2.5M14.5 17h2.5"/></svg>',
  items: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8 12 3.5zM3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/></svg>',
  db: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
};

// ── İskelet ───────────────────────────────────────
const moversPanel = () => panel(t('BIST 100 · günün hareketlileri'), `<div class="kt-breadth"></div><div class="table-wrap kt-tall"><table class="t kt-movers"></table></div>`,
  { extra: `<span class="seg kt-movseg">${[['gainers', t('Yükselenler')], ['losers', t('Düşenler')], ['active', t('Hacim')]].map(([k, l]) => `<button data-m="${k}">${l}</button>`).join('')}</span>` });
const indicesPanel = () => panel(`${t('Endeksler')} ${sub(t('Grafiği açmak için tıklayın'))}`, '<div class="heat kt-indices"></div>');

root.innerHTML = `
<header class="kt-head">
  <button class="kt-brand" id="ktBrand" title="${t('Ana ekran')}"><span class="acc">KMY</span> TERMINAL</button>
  <form class="kt-search" id="ktSearch" autocomplete="off">
    <div class="kt-sugwrap"><input id="ktSearchIn" placeholder="${t('HİSSE KODU')}" aria-label="${t('HİSSE KODU')}" spellcheck="false"></div>
    <button class="btn">${t('ARA')}</button>
  </form>
  <span class="kt-clock" id="ktClock"></span>
</header>
<nav class="kt-fkeys" id="ktFkeys">
  ${FKEYS.map(([k, l], i) => `<button class="kt-fk" role="tab" aria-selected="${i === 0}" data-pg="${k}" title="${t('Kısayol: {k}', { k: i + 1 })}"><i>${i + 1})</i> ${l}</button>`).join('')}
  <span class="kt-cur" id="ktCur"></span>
  <span class="kt-spacer"></span>
  <button class="kt-fk kt-tool" id="ktReload" title="${t('Bu sayfanın verilerini yenile')}" aria-label="${t('Bu sayfanın verilerini yenile')}">⟳<span class="kt-lbl"> ${t('YENİLE')}</span></button>
  <button class="kt-fk kt-tool" id="ktHome" title="${t('Ana ekran (Esc)')}" aria-label="${t('Ana ekran')}">⌂</button>
</nav>
<div class="kt-body" id="ktBody">
  <section class="kt-page kt-home" data-page="home">
    <div class="kt-hero">
      <h1 class="kt-title"><span class="acc">KMY</span> TERMINAL</h1>
      <p class="kt-sub">${t('Borsa İstanbul için temel analiz, değerleme ve karşılaştırma terminali')}</p>
      <p class="kt-usage">${t('Bir hisse kodu yazıp Enter’a basın; alttaki komut satırına “THYAO SKOR” gibi komutlar da yazabilirsiniz.')}</p>
      <form class="kt-bigsearch" id="ktHomeForm" autocomplete="off">
        <div class="kt-sugwrap"><input id="ktHomeIn" placeholder="${t('HİSSE KODU')}" aria-label="${t('HİSSE KODU')}" spellcheck="false"></div>
        <button class="btn">${t('ANALİZ ET')}</button>
      </form>
      <div class="kt-quick">
        <button class="kt-qbtn" data-go="screen"><b>${t('HİSSE TARAYICI')}</b><span id="ktQScreen">${t('{n}+ hisseyi filtrele', { n: 500 })}</span></button>
        <button class="kt-qbtn" data-go="sectors"><b>${t('SEKTÖR HARİTASI')}</b><span>${t('piyasa genel bakış')}</span></button>
        <button class="kt-qbtn" data-go="market"><b>${t('PİYASA ÖZETİ')}</b><span>${t('endeksler, hareketliler, takvim')}</span></button>
        <button class="kt-qbtn" data-go="calendar"><b>${t('TAKVİM')}</b><span>${t('temettü, TCMB, TÜFE, bilanço')}</span></button>
      </div>
    </div>
    <div class="kt-statcards" id="ktStats"></div>
    <div class="kt-sec"><div class="kt-sec-h">${t('SON ARANANLAR')}</div><div class="kt-chips" id="ktRecent"></div></div>
    <div class="kt-sec"><div class="kt-sec-h">${t('POPÜLER HİSSELER')} <span>BIST 30</span></div><div class="kt-popular" id="ktPopular">${SKEL}</div></div>
    <div class="kt-foot">
      <div>${t('Veriler: KAP, İş Yatırım (temel veriler ve mali tablolar), Borsa İstanbul (~15 dk gecikmeli fiyatlar), Yahoo Finance ve ekonomi haber kaynakları.')} ${DISCLAIMER}</div>
      <div>${t('Klavye: 1–5 sayfa değiştirir · Esc ana ekran · / komut satırı')}</div>
    </div>
  </section>

  <section class="kt-page" data-page="sum" hidden>
    <div class="kt-symbar">
      <div class="sym-head" id="symHead"></div>
      <div class="kt-actions">
        <button class="ghost" id="bAlert" title="${t('Fiyat, temettü ve KAP eşikleri')}">🔔<span class="pill acc" id="bAlertN" hidden></span></button>
        <button class="ghost" id="bWatch">${t('＋ Listeye ekle')}</button>
        <button class="ghost" id="bTx">${t('Portföye ekle')}</button>
        <button class="btn" id="bAsk">${t('Asistanla analiz et')}</button>
      </div>
    </div>
    <span class="seg" id="sumSeg">${SUM_TABS.map(([k, l]) => `<button data-sg="${k}">${l}</button>`).join('')}</span>
    <div class="kt-stack kt-sg" data-sg="px">
    <div class="kt-panel kt-chartpanel">
      <div class="kt-ph" title="${BENCH_HIDE_TIP}"><span>${t('Fiyat grafiği')}</span>
        <div class="kt-ctrls">
          <div class="seg" id="rangeSeg">${RANGES.map(([r, l]) => `<button data-r="${r}">${l}</button>`).join('')}</div>
          <div class="seg" id="ovSeg"><button data-o="sma20">SMA20</button><button data-o="sma50">SMA50</button><button data-o="sma200">SMA200</button><button data-o="bb">Bollinger</button><button data-o="vol">${t('Hacim')}</button></div>
          <div class="seg" id="lowSeg"><button data-l="rsi">RSI</button><button data-l="macd">MACD</button><button data-l="none" title="${t('Alt grafiği gizle')}">—</button></div>
        </div>
      </div>
      <div class="kt-pb">
        <div class="chart-box kt-main-chart"><canvas id="mainChart"></canvas></div>
        <div class="chart-box sm" id="lowerBox"><canvas id="lowerChart"></canvas></div>
        <div class="kt-note" id="chartNote"></div>
        <div class="kt-note" id="relNote"></div>
      </div>
    </div>
    <div class="kt-grid kt-g3">
      ${panel(t('İstatistikler'), '<div class="stats" id="stats"></div>')}
      ${panel(t('Teknik görünüm'), '<div id="tech"></div>')}
      ${panel(`${t('Temel veriler')} <span class="dim" id="fundNote"></span>`, '<div id="fund"></div>')}
    </div>
    </div>
    <div class="kt-stack kt-sg" data-sg="news" hidden>
      <div class="kt-grid kt-g3">
        ${panel(t('Haberler'), '<div class="news kt-scroll" id="news"></div>')}
        ${panel(`${t('KAP bildirimleri')} ${sub(t('son 30 gün'))}`, '<div class="kt-scroll" id="symKap"></div>', { extra: `<button class="ghost" id="bKapAll">${t('Tümü ›')}</button>` })}
        ${panel(t('Kurum raporları'), '<div class="kt-scroll" id="symRep"></div>', { extra: `<button class="ghost" id="bRepAll">${t('Tümü ›')}</button>` })}
      </div>
    </div>
    <div class="kt-stack kt-sg" data-sg="docs" hidden>
      <div class="kt-grid kt-g3">
        ${panel(`${t('Asistan notları')} <span class="dim" id="noteMeta"></span>`, '<div id="symNotes"></div>', { tip: t('Asistanın bu şirket için kaydettiği tez, kilit rakamlar ve tetikleyiciler') })}
        ${panel(t('Belgeler'), '<div id="symDocs"></div>', { tip: t('KAP’tan indirilen faaliyet raporları, finansal raporlar ve sunumlar') })}
        ${panel(t('Temettü ve sermaye artırımları'), '<div id="divs"></div>')}
      </div>
    </div>
  </section>

  <section class="kt-page" data-page="fin" hidden>
    <div class="kt-pagehead"><b id="finSym"></b><span>${t('FİNANS')}</span><span class="dim" id="finNote"></span></div>
    <div id="finSum" class="kt-stack">
      <div class="kt-grid kt-g2">
        ${panel(`${t('Gelir tablosu özeti')} ${sub(t('mn TL'))}`, '<div id="finInc"></div>')}
        ${panel(`${t('Bilanço özeti')} ${sub(t('mn TL'))}`, '<div id="finBal"></div>')}
      </div>
      ${panel(t('Çeyreklik grafikler'), '<div class="kt-grid kt-g3 fin-charts" id="finCharts"></div>')}
    </div>
    ${panel(t('Mali tablolar · ayrıntı'), '<div id="fin"></div>', { extra: `<span class="seg" id="finMode"><button data-m="q" class="active">${t('Çeyreklik')}</button><button data-m="c">${t('Kümülatif')}</button></span>` })}
  </section>

  <section class="kt-page" data-page="score" hidden><div id="scoreBody" class="kt-stack"></div></section>
  <section class="kt-page" data-page="value" hidden><div id="valBody" class="kt-stack"></div></section>

  <section class="kt-page" data-page="comp" hidden>
    <div class="kt-pagehead"><b id="compSym"></b><span>${t('KARŞILAŞTIRMA')}</span><span class="dim" id="compNote"></span></div>
    ${panel(t('Sektör emsalleri'), '<div class="table-wrap"><table class="t kt-table" id="compTable"></table></div>', {
      extra: `<form class="kt-inline" id="compForm" autocomplete="off"><input id="compAdd" placeholder="${t('SEMBOL EKLE: PGSUS, TAVHL')}" spellcheck="false"><button class="ghost">${t('EKLE')}</button><button type="button" class="ghost" id="compClear" hidden>${t('EKLENENLERİ TEMİZLE')}</button></form>` })}
    ${panel(`${t('Göreli performans')} ${sub(t('1 yıl · başlangıç = 100'))}`, '<div class="chart-box kt-comp-chart"><canvas id="compChart"></canvas></div><div class="kt-note" id="compChartNote"></div>')}
    <div class="kt-disc">${DISCLAIMER}</div>
  </section>

  <section class="kt-page" data-page="screen" hidden>
    <div class="kt-pagehead"><span>${t('HİSSE TARAYICI')}</span><span class="dim">${t('İş Yatırım temel verileri · günlük')}</span></div>
    <div class="kt-panel"><div class="kt-pb">
      <form class="kt-scrform" id="scrForm">
        <select name="index"><option value="BIST100">BIST 100</option><option value="BIST30">BIST 30</option><option value="TUM">${t('Tüm BIST')}</option></select>
        <input name="sector" placeholder="${t('Sektör adı içerir')}" style="width:140px">
        <input name="pe_max" type="number" step="any" placeholder="${t('F/K ≤')}" style="width:80px">
        <input name="pb_max" type="number" step="any" placeholder="${t('PD/DD ≤')}" style="width:80px">
        <input name="ev_ebitda_max" type="number" step="any" placeholder="${t('FD/FAVÖK ≤')}" style="width:100px">
        <input name="mcap_min_mn" type="number" step="any" placeholder="${t('Piyasa değeri ≥ (mn ₺)')}" title="${t('En düşük piyasa değeri, milyon ₺')}" style="width:160px">
        <select name="sort"><option value="mcap">${t('Piyasa değeri')}</option><option value="pe">${t('F/K (düşükten yükseğe)')}</option><option value="pb">${t('PD/DD (düşükten yükseğe)')}</option><option value="ev_ebitda">${t('FD/FAVÖK (düşükten yükseğe)')}</option><option value="ret_ytd">${t('YBB getiri')}</option><option value="ret_1m">${t('1 ay getiri')}</option></select>
        <button class="btn">${t('Tara')}</button>
        <span class="seg" id="scrPresets"><button type="button" data-p="value">${t('Ucuz (F/K ≤ 8, PD/DD ≤ 1,5)')}</button><button type="button" data-p="ytd">${t('YBB liderleri')}</button></span>
      </form>
      <div class="table-wrap kt-xtall kt-scan"><table class="t" id="scrTable"></table></div>
    </div></div>
    ${panel(`${t('Sinyal radarı')} ${sub(t('BIST 100 · günlük'))}`, `<div class="row" id="radarChips" style="margin-bottom:8px"></div>
      <div class="table-wrap kt-tall"><table class="t" id="radarTable"><tbody><tr><td class="dim">${t('Taramayı başlatmak için “Tara”ya basın. İlk tarama yaklaşık 20 sn sürer; sonuçlar 15 dk saklanır.')}</td></tr></tbody></table></div>`,
      { extra: `<span class="row" style="gap:6px"><span class="dim" id="radarInfo"></span><button class="ghost" id="radarRun">${t('Tara')}</button><button class="ghost" id="radarAsk">${t('Asistanla yorumla')}</button></span>` })}
    ${panel(`${t('Son sinyal bildirimleri')} ${sub(t('izleme listesi ve portföy · seans sonrası · son 14 gün'))}`, `<div id="sigRecent" class="dim"></div>`)}
    ${panel(`${t('Sinyal geçmiş performansı')} ${sub(t('BIST 100 · 10 yıl · sonraki 5/20/60 işlem günü'))}`, `<div id="backtestBox"></div>`)}
  </section>

  <section class="kt-page" data-page="sectors" hidden>
    <div class="kt-pagehead"><span>${t('SEKTÖR HARİTASI')}</span><span class="dim">${t('Sektöre tıklayınca tarayıcı o sektörle açılır')}</span></div>
    ${panel(`${t('Sektör performansı')} ${sub(t('BIST 100 ortalaması'))}`, '<div class="heat kt-sectors" id="sectors"></div>')}
    ${indicesPanel()}
    ${moversPanel()}
  </section>

  <section class="kt-page" data-page="market" hidden>
    <div class="kt-pagehead"><span>${t('PİYASA ÖZETİ')}</span></div>
    ${indicesPanel()}
    <div class="kt-grid kt-g2">
      ${moversPanel()}
      ${panel(`${t('Temettü takvimi')} ${sub(t('ilan edilenler'))}`, '<div class="table-wrap kt-tall"><table class="t" id="calendar"></table></div>',
        { extra: `<span class="row" style="gap:6px"><button class="ghost xs" id="calAll">${t('Tüm takvim →')}</button><span class="seg" id="calSeg"><button data-c="watchlist">${t('Listem')}</button><button data-c="portfolio">${t('Portföyüm')}</button><button data-c="all">${t('Tümü')}</button></span></span>` })}
    </div>
    ${panel(t('Ekonomi haberleri'), '<div class="news" id="econNews"></div>', { extra: `<select id="newsSrc"><option value="">${t('Tüm kaynaklar')}</option></select>` })}
  </section>

  <section class="kt-page" data-page="calendar" hidden>
    <div class="kt-pagehead"><span>${t('TAKVİM')}</span><span class="dim">${t('yaklaşan temettü, TCMB, TÜFE ve bilanço')}</span></div>
    <div class="kt-panel"><div class="kt-pb">
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <span class="seg" id="cpScope"><button data-c="watchlist">${t('Listem')}</button><button data-c="portfolio">${t('Portföyüm')}</button><button data-c="all">${t('Tümü')}</button></span>
        <span class="seg" id="cpKinds"><button data-k="temettu">${t('Temettü')}</button><button data-k="sermaye">${t('Sermaye artırımı')}</button><button data-k="tcmb">TCMB</button><button data-k="tufe">TÜFE</button><button data-k="bilanco">${t('Bilanço')}</button></span>
        <button class="ghost xs" id="cpIcs">${t('Dışa aktar')}</button>
      </div>
      <div class="kt-note" id="cpWarn" hidden></div>
      <div id="cpBody"></div>
    </div></div>
  </section>
</div>
<footer class="kt-cmd">
  <label class="kt-prompt" for="ktCmd">KMY&gt;</label>
  <input id="ktCmd" spellcheck="false" autocomplete="off" placeholder="${t('hisse kodu veya komut · HELP')}" aria-label="${t('Komut satırı')}">
  <span class="kt-hints">${SHORT.map((s, i) => `<b>${i + 1}</b>:${s}`).join(' · ')}</span>
  <span class="kt-conn" id="ktConn">○ ${t('BAĞLANIYOR')}</span>
  <span class="kt-time" id="ktTime"></span>
  <div class="kt-help" id="ktHelp" hidden></div>
</footer>`;

const body = $('#ktBody');
const sec = (pg) => $(`.kt-page[data-page="${pg}"]`, root);

// ── Veri önbelleği (oturum boyu, sembol başına) ─────
const memo = new Map();
function cached(key, fn, ttl = 0) {
  const hit = memo.get(key);
  if (hit && (!ttl || Date.now() - hit.at < ttl)) return hit.p;
  const p = fn();
  memo.set(key, { p, at: Date.now() });
  p.catch(() => { if (memo.get(key)?.p === p) memo.delete(key); });
  return p;
}
const D = {
  fund: (s) => cached(`fund|${s}`, () => api(`/fundamentals/${enc(s)}`).then((f) => { if (f?.name) { names.set(s, f.name); nameRecent(s, f.name); } return f; })),
  // 11 dönem: son 12 ay ile bir önceki 12 ayın çeyrekleri her raporlama döneminde eksiksiz hesaplanabilsin
  fin: (s) => cached(`fin|${s}`, () => api(`/financials/${enc(s)}?n=11`)),
  tech: (s) => cached(`tech|${s}`, () => api(`/technical/${enc(s)}`), 10 * 60_000),
  hist: (s, r, ind = false) => cached(`hist|${s}|${r}|${ind ? 1 : 0}`, () => api(`/history/${enc(s)}?range=${r}${ind ? '&ind=1' : ''}`), 5 * 60_000),
  sector: (name) => cached(`sector|${name}`, () => api(`/screen?sector=${enc(name)}&index=TUM&limit=200`).then((r) => r.items.filter((x) => x.sector === name)), 30 * 60_000),
  bist100: () => cached('bist100', () => api('/screen?index=BIST100&limit=200').then((r) => r.items), 30 * 60_000),
  universe: () => cached('universe', () => api('/universe/status'), 10 * 60_000),
  popular: () => cached('popular', () => api('/screen?index=BIST30&sort=mcap&limit=16'), 30 * 60_000),
  movers: () => cached('movers', () => api('/market/movers'), 50_000),
  indices: () => cached('indices', () => api('/market/indices'), 50_000),
};
const purge = (test) => { for (const k of [...memo.keys()]) if (test(k)) memo.delete(k); };

// ── Sayfa yönetimi ────────────────────────────────
const RENDER = { home: renderHome, sum: renderSum, fin: renderFin, score: renderScore, value: renderValue, comp: renderComp, screen: () => runScreen(), sectors: loadMarket, market: renderMarketPage, calendar: loadCalPage };
function ensure(pg, force = false) {
  const key = SYM_PAGES.includes(pg) ? curSym : '*';
  if (!force && rendered[pg] === key) return;
  rendered[pg] = key;
  RENDER[pg]();
}
function resizeCharts(pg) {
  const s = sec(pg);
  if (!s || !window.Chart?.getChart) return;
  for (const c of $$('canvas', s)) Chart.getChart(c)?.resize();
}
function showPage(pg) {
  if (!PAGES.includes(pg)) pg = 'home';
  const changed = pg !== page;
  page = pg;
  $$('.kt-page', root).forEach((el) => { el.hidden = el.dataset.page !== pg; });
  $$('#ktFkeys [data-pg]').forEach((b) => { b.classList.toggle('active', b.dataset.pg === pg); b.setAttribute('aria-selected', String(b.dataset.pg === pg)); });
  root.dataset.ktPage = pg;
  if (pg === 'home') drawRecent();
  if (changed) body.scrollTop = 0;
  hideHelp();
  ensure(pg, pg === 'calendar'); // takvim her gösterilişte yenilenir: gece yarısından sonra "Bugün" ve "Yarın" eski kalmasın
  requestAnimationFrame(() => resizeCharts(pg));
  emit('kt:page', pg);
}
// Başka bir modülden ya da bu sekmeden sembol açma: ÖZET (ya da istenen sayfa)
function openSymbol(sym, pg = 'sum', name = '') {
  sym = String(sym || '').trim().toUpperCase();
  if (!sym) return;
  if (name) names.set(sym, name);
  pendingPage = pg;
  selectSymbol(sym);
}
// Sembolü açan TEK giriş noktası: sekme, arama formu, tarayıcı tablosu, komut satırı,
// palet, şerit, izleme listesi ve hash hep buradan geçer.
export function openRoute({ sym, pg, tab } = {}) {
  if (tab) setSumTab(tab);
  if (sym) return openSymbol(sym, pg || 'sum');
  if (pg) showPage(pg);
}
// Hash yazımı için geçerli konum
export function ktRoute() { return { page, sym: curSym, tab: sumTab }; }
function setSymbol(s) {
  if (s === curSym) return false;
  curSym = s;
  symToken++;
  for (const p of SYM_PAGES) rendered[p] = null;
  lastHist = null;
  return true;
}
function renderCur() {
  const s = curSym, q = state.quotes[s];
  const nm = names.get(s) || q?.longName || q?.name || '';
  $('#ktCur').innerHTML = `<b>${esc(s)}</b> <span>${esc(tx(nm))}</span>${q?.price != null ? ` <em class="${cls(q.changePct)}">${price(q.price)} ${pct(q.changePct)}</em>` : ''}`;
}
function reload() {
  if (SYM_PAGES.includes(page)) {
    const s = curSym;
    purge((k) => k.split('|')[1] === s);
    if (page === 'score' || page === 'value' || page === 'comp') purge((k) => k.startsWith('sector|') || k === 'bist100');
  } else if (page === 'home') purge((k) => k === 'universe' || k === 'popular');
  else if (page === 'sectors' || page === 'market') purge((k) => k === 'movers' || k === 'indices');
  if (page === 'market') loadEconNews();
  ensure(page, true);
}

$('#ktFkeys').addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (b) showPage(b.dataset.pg); });
$('#ktReload').onclick = reload;
$('#ktHome').onclick = () => showPage('home');
$('#ktBrand').onclick = () => showPage('home');
$$('.kt-qbtn').forEach((b) => b.onclick = () => showPage(b.dataset.go));

// ── Sembol arama (öneri listesi) ───────────────────
const isLocal = (r) => ['BIST', 'Döviz', 'Borsa İstanbul', 'Serbest piyasa'].includes(r.exchange) || !/[.-]/.test(r.symbol);
function suggest(input, onPick) {
  const box = h('<div class="kt-suggest" role="listbox" hidden></div>');
  input.parentElement.append(box);
  let items = [], sel = -1, qid = 0;
  const close = () => { qid++; items = []; sel = -1; box.hidden = true; box.innerHTML = ''; };
  const draw = () => {
    box.innerHTML = items.map((r, i) => `<button type="button" role="option" class="${i === sel ? 'sel' : ''}" data-i="${i}"><b>${esc(r.symbol)}</b><span>${esc(tx(r.name || ''))}</span><small>${esc(tx(r.sector || r.exchange || ''))}</small></button>`).join('');
    box.hidden = !items.length;
  };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { close(); return; }
    const id = ++qid;
    try {
      const r = await api(`/search?q=${enc(q)}`);
      if (id !== qid || document.activeElement !== input) return;
      items = [...r.filter(isLocal), ...r.filter((x) => !isLocal(x))].slice(0, 8);
      sel = -1; draw();
    } catch { close(); }
  }, 180);
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) { sel = (sel + 1) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && items.length) { sel = sel <= 0 ? items.length - 1 : sel - 1; draw(); e.preventDefault(); }
    else if (e.key === 'Escape') { e.stopPropagation(); if (!box.hidden) close(); else input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  box.addEventListener('mousedown', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    e.preventDefault();
    const r = items[Number(b.dataset.i)];
    close(); input.value = '';
    onPick(r.symbol, r.name);
  });
  return { current: () => (sel >= 0 ? items[sel] : null), close };
}
function searchForm(form, input) {
  const sg = suggest(input, (s, name) => openSymbol(s, 'sum', name));
  form.onsubmit = (e) => {
    e.preventDefault();
    const pick = sg.current();
    const sym = pick?.symbol || input.value.trim().toUpperCase();
    sg.close(); input.value = ''; input.blur();
    if (sym) openSymbol(sym, 'sum', pick?.name);
  };
}
searchForm($('#ktSearch'), $('#ktSearchIn'));
searchForm($('#ktHomeForm'), $('#ktHomeIn'));

// ── Ana ekran ─────────────────────────────────────
function recent() { const r = localGet('ktRecent', []); return Array.isArray(r) ? r : []; }
function addRecent(sym, name = '') {
  const list = recent();
  const old = list.find((x) => x.symbol === sym);
  const q = state.quotes[sym];
  const nm = name || names.get(sym) || old?.name || q?.longName || q?.name || '';
  localSet('ktRecent', [{ symbol: sym, name: nm }, ...list.filter((x) => x.symbol !== sym)].slice(0, 8));
  if (page === 'home') drawRecent();
}
function nameRecent(sym, name) {
  const list = recent();
  const r = list.find((x) => x.symbol === sym);
  if (r && !r.name && name) { r.name = name; localSet('ktRecent', list); }
}
function drawRecent() {
  const list = recent();
  $('#ktRecent').innerHTML = list.length
    ? list.map((r) => `<button class="kt-chip" data-s="${esc(r.symbol)}"><b>${esc(r.symbol)}</b>${r.name ? `<span>${esc(tx(r.name))}</span>` : ''}</button>`).join('')
    : `<span class="dim">${t('Henüz arama yok. Yukarıya bir hisse kodu yazın.')}</span>`;
}
$('#ktRecent').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) openSymbol(b.dataset.s); });
function statCards(u) {
  const cards = [
    [ICON.co, t('DESTEKLENEN ŞİRKET'), u?.stocks ? num(u.stocks, 0) : '…', t('BIST pay piyasası')],
    [ICON.items, t('FİNANSAL KALEM'), t('1.000+'), t('bilanço, gelir tablosu, nakit akışı')],
    [ICON.db, t('VERİ KAYNAĞI'), 'KAP + İş Yatırım', t('resmî bildirimler ve mali tablolar')],
    [ICON.clock, t('GÜNCELLEME'), t('Anlık'), u?.at ? t('evren güncellemesi {time}', { time: timeTR(u.at) }) : t('fiyatlar ~15 dk gecikmeli')],
  ];
  $('#ktStats').innerHTML = cards.map(([i, l, v, s]) => `<div class="kt-stat">${i}<div><small>${l}</small><b>${esc(v)}</b><span>${esc(s)}</span></div></div>`).join('');
}
function renderHome() {
  drawRecent();
  statCards(null);
  D.universe().then((u) => {
    statCards(u);
    if (u?.stocks) $('#ktQScreen').textContent = t('{n}+ hisseyi filtrele', { n: u.stocks >= 100 ? Math.floor(u.stocks / 100) * 100 : u.stocks });
  }).catch(() => {});
  D.popular().then((r) => {
    $('#ktPopular').innerHTML = r.items.map((x) => `<button class="kt-pop" data-s="${esc(x.code)}" data-n="${esc(x.name)}"><b>${esc(x.code)}</b>${ICON.arrow}<span>${esc(x.name)}</span><small>${esc(sectorName(x.sector))}</small></button>`).join('') || dimMsg(t('Veri yok'));
  }).catch((e) => { $('#ktPopular').innerHTML = dimMsg(esc(tx(e.message))); });
}
$('#ktPopular').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) openSymbol(b.dataset.s, 'sum', b.dataset.n); });

// ── 1) ÖZET ───────────────────────────────────────
const segActive = () => {
  $$('#rangeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.r === range));
  // Veri yetersizse gösterge açılamaz: sessizce boş çizgi çizmek, çalışıyor izlenimi yaratır
  $$('#ovSeg button').forEach((b) => {
    const ok = ovOk.has(b.dataset.o);
    b.classList.toggle('active', ok && overlays.has(b.dataset.o));
    b.disabled = !ok;
    b.style.opacity = ok ? '' : '.4';
    b.title = ok ? '' : OV_NO_DATA;
  });
  $$('#lowSeg button').forEach((b) => b.classList.toggle('active', b.dataset.l === lower));
  $$('.kt-movseg button', root).forEach((b) => b.classList.toggle('active', b.dataset.m === moversTab));
  $$('#calSeg button').forEach((b) => b.classList.toggle('active', b.dataset.c === calScope));
  $$('#sumSeg button').forEach((b) => b.classList.toggle('active', b.dataset.sg === sumTab));
  $('#lowerBox').hidden = lower === 'none';
};
// Alt sekme: yalnız göster/gizle. Veri renderSum'da önceden çekilip saklanır, istek atılmaz.
function showSumTab() {
  $$('.kt-sg', sec('sum')).forEach((el) => { el.hidden = el.dataset.sg !== sumTab; });
  if (sumTab === 'px') requestAnimationFrame(() => resizeCharts('sum'));
}
// ÖZET alt sekmesi dışarıdan (hash) da değiştirilebilsin
export function setSumTab(k) {
  if (!SUM_TABS.some(([x]) => x === k)) return;
  sumTab = k;
  localSet('sumTab', k);
  segActive();
  showSumTab();
  emit('kt:page', page);
}
$('#sumSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) setSumTab(b.dataset.sg); };
$('#rangeSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; range = b.dataset.r; localSet('range', range); segActive(); loadChart(); };
$('#ovSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; overlays.has(b.dataset.o) ? overlays.delete(b.dataset.o) : overlays.add(b.dataset.o); localSet('overlays', [...overlays]); segActive(); drawChart(); };
$('#lowSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; lower = b.dataset.l; localSet('lower', lower); segActive(); drawChart(); };
segActive();

// ── Eşikler (zil) ────────────────────────────────────
const ALERT_OPS = [['above', t('Fiyat üstü'), true], ['below', t('Fiyat altı'), true], ['div', t('Temettü ≥ (₺/hisse)'), true], ['kap', t('KAP bildirimi geldi'), false]];
const alertLabel = (op) => ALERT_OPS.find(([k]) => k === op)?.[1] || op;
const alertText = (a) => (a.op === 'kap' ? alertLabel(a.op) : `${alertLabel(a.op)} ${price(a.value)}`);
let symAlerts = [];
async function loadAlerts(s = curSym) {
  try { symAlerts = await api(`/alerts?symbol=${enc(s)}`); } catch { symAlerts = []; }
  if (s !== curSym) return;
  const n = symAlerts.filter((a) => a.triggered_at).length;
  const el = $('#bAlertN');
  el.textContent = n;
  el.hidden = !n;
}
$('#bAlert').onclick = () => {
  const m = modal({ title: `${curSym} · ${t('Eşikler')}`, body: '<div id="alBox"></div>' });
  const draw = () => {
    $('#alBox', m.el).innerHTML = `
      ${symAlerts.length ? `<table class="t"><tbody>${symAlerts.map((a) => `<tr>
        <td>${esc(alertText(a))}${a.note ? ` <span class="muted">${esc(a.note)}</span>` : ''}</td>
        <td class="r dim">${a.triggered_at ? esc(t('tetiklendi {d}', { d: timeTR(sqlDate(a.triggered_at)) })) : ''}</td>
        <td class="r"><button class="kt-x" data-rm="${a.id}" aria-label="${t('Sil')}">×</button></td></tr>`).join('')}</tbody></table>`
        : dimMsg(t('Bu sembol için eşik yok.'))}
      <form class="kt-inline" id="alForm" style="margin-top:10px">
        <b class="mono">${esc(curSym)}</b>
        <select id="alOp">${ALERT_OPS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
        <input id="alVal" type="number" step="any" min="0" placeholder="${t('fiyat (₺)')}" style="width:110px">
        <button class="btn">${t('Kaydet')}</button>
      </form>
      <div class="dim" style="margin-top:6px">${t('Hisse eşikleri BIST seansında değerlendirilir; tetiklenen eşik koşul bozulana kadar tekrar etmez.')}</div>`;
    // KAP eşiğinde değer yok: bildirim geldiği anda tetiklenir
    const val = $('#alVal', m.el), op = $('#alOp', m.el);
    const sync = () => { val.hidden = val.disabled = op.value === 'kap'; };
    op.onchange = sync; sync();
    $('#alForm', m.el).onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/alerts', { method: 'POST', body: { symbol: curSym, op: op.value, value: Number(val.value) } });
        await loadAlerts();
        draw();
      } catch (err) { toast(tx(err.message), 'err'); }
    };
    $$('[data-rm]', m.el).forEach((b) => { b.onclick = async () => { try { await api(`/alerts/${b.dataset.rm}`, { method: 'DELETE' }); await loadAlerts(); draw(); } catch (err) { toast(tx(err.message), 'err'); } }; });
  };
  draw();
};
on('ws:alerts.fired', (m) => {
  const a = m?.alert;
  if (!a) return;
  const text = t('🔔 {s}: {c}', { s: a.symbol, c: alertText(a) });
  // Açık sembolün eşiği ekran içi toast; diğer semboller sistem bildirimi de gönderir (önceden hiçbir şey göstermiyordu)
  if (a.symbol === curSym) { toast(text, 'ok'); loadAlerts(); } else notify(text, [{ label: t('Aç'), run: () => selectSymbol(a.symbol) }]);
});

$('#bWatch').onclick = async () => { try { await api('/watchlist', { method: 'POST', body: { symbol: curSym } }); toast(t('{s} izleme listesine eklendi', { s: curSym }), 'ok'); } catch (e) { toast(tx(e.message), 'err'); } };
$('#bTx').onclick = () => openTxModal({ symbol: curSym, price: state.quotes[curSym]?.price });
$('#bAsk').onclick = () => askAgent(t('{s} için analiz yap: güncel fiyat hareketi, teknik görünüm (trend, destek/direnç, RSI, MACD), temel oranlar (F/K, PD/DD, FD/FAVÖK), son KAP bildirimleri ve varsa portföyümdeki pozisyonumla ilişkisi. Sonunda kısa bir özet ver.', { s: curSym }), { context: symbolContext() });
$('#bKapAll').onclick = () => { emit('kap:filter', { scope: 'symbol', symbol: curSym }); emit('rtab', 'kap'); };

function symbolContext() {
  const q = state.quotes[curSym];
  if (!q) return t('Seçili sembol: {s}', { s: curSym });
  const vars = { s: curSym, name: q.name, price: q.price, cur: q.currency, chg: q.changePct?.toFixed(2) };
  return q.delayed ? t('Seçili sembol: {s} ({name}), fiyat {price} {cur} (~15 dk gecikmeli), günlük %{chg}', vars) : t('Seçili sembol: {s} ({name}), fiyat {price} {cur}, günlük %{chg}', vars);
}

function renderHead() {
  const s = curSym, q = state.quotes[s];
  const src = q ? [q.source, q.delayed ? t('~15 dk gecikmeli') : t('anlık'), timeTR(q.time)].filter(Boolean).join(' · ') : '';
  $('#symHead').innerHTML = `<div><div class="code">${esc(s)}</div><div class="name">${esc(tx(q?.longName || q?.name || names.get(s) || ''))} ${q?.exchange ? `· ${esc(q.exchange)}` : ''}</div></div>
    <div class="price">${q ? price(q.price) : '…'} <span class="dim cur">${esc(q?.currency || '')}</span>${srcTag(q)}</div>
    <div class="chg ${cls(q?.change)}">${q?.change != null ? `${q.change > 0 ? '+' : ''}${price(q.change)} (${pct(q.changePct)})` : ''}</div>
    ${q ? `<div class="dim src">${esc(src)}${q.bid ? ` · ${t('alış {bid} / satış {ask}', { bid: price(q.bid), ask: price(q.ask) })}` : ''}</div>` : ''}`;
  $('#stats').innerHTML = q ? [
    [t('Önceki kapanış'), price(q.prevClose)], [t('Gün içi düşük'), price(q.dayLow)], [t('Gün içi yüksek'), price(q.dayHigh)],
    [t('52 hafta düşük'), price(q.low52)], [t('52 hafta yüksek'), price(q.high52)], [t('Hacim (adet)'), compact(q.volume)],
    [t('İşlem hacmi (≈)'), q.volume && q.price ? compact(q.volume * q.price) : '—'],
    [t('52 hafta zirvesine uzaklık'), q.high52 ? pct((q.price / q.high52 - 1) * 100) : '—'],
  ].map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`).join('') : dimMsg(t('Veri yok'));
}

function renderSum() {
  const s = curSym;
  const tok = symToken;
  const fresh = () => tok === symToken;
  renderHead();
  showSumTab();
  loadAlerts(s);
  api(`/quote/${enc(s)}`).then((q) => { if (q && fresh()) { state.quotes[s] = q; renderHead(); renderCur(); } }).catch(() => {});
  loadChart();
  $('#tech').innerHTML = SKEL;
  D.tech(s).then((tc) => {
    if (!fresh()) return;
    if (tc.error) { $('#tech').innerHTML = dimMsg(esc(tx(tc.error))); return; }
    $('#tech').innerHTML = `<div class="stats" style="margin-bottom:8px">${[
      ['RSI(14)', num(tc.rsi14, 1)], ['SMA20', price(tc.sma20)], ['SMA50', price(tc.sma50)], ['SMA200', price(tc.sma200)],
      [t('MACD histogramı'), num(tc.macdHist, 3)], ['ATR(14)', price(tc.atr14)], [t('Volatilite (60 gün)'), pct(tc.volatility60dAnnualPct, 1, false)],
      [t('1 ay getiri'), `<span class="${cls(tc.return1m)}">${pct(tc.return1m)}</span>`], [t('3 ay getiri'), `<span class="${cls(tc.return3m)}">${pct(tc.return3m)}</span>`], [t('1 yıl getiri'), `<span class="${cls(tc.return1y)}">${pct(tc.return1y)}</span>`],
    ].map(([k, v]) => `<div><span class="muted">${k}</span><b>${v}</b></div>`).join('')}</div><ul class="signals">${tc.signals.map((x) => `<li>${esc(tx(x))}</li>`).join('')}</ul>`;
  }).catch((e) => { if (fresh()) $('#tech').innerHTML = dimMsg(esc(tx(e.message))); });

  $('#fund').innerHTML = SKEL;
  $('#divs').innerHTML = SKEL;
  $('#fundNote').textContent = '';
  D.fund(s).then((f) => {
    if (!fresh()) return;
    if (!f) {
      $('#fund').innerHTML = dimMsg(t('Temel veriler yalnızca BIST hisseleri için var.'));
      loadYahooDividends(s, fresh);
      return;
    }
    nameRecent(s, f.name); renderCur();
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
  }).catch((e) => { if (fresh()) { $('#fund').innerHTML = dimMsg(esc(tx(e.message))); $('#divs').innerHTML = dimMsg(t('Veri yok')); } });

  loadSymNews(s, fresh, true);
  loadNotes(s, fresh);
  loadSymReports(s, fresh);
  loadSymKap(s, fresh, true);
}
$('#symKap').addEventListener('click', (e) => { const a = e.target.closest('[data-kap]'); if (a) { e.preventDefault(); openKapDetail(Number(a.dataset.kap)); } });

// Sembol haberleri ve KAP kartı: seçimde ve ÖZET açıkken 5 dakikada bir kendiliğinden yenilenir
function loadSymNews(s, fresh = () => true, first = false) {
  if (first) $('#news').innerHTML = SKEL;
  Promise.all([api(`/news?q=${enc(s)}`).catch(() => []), api(`/newsfeed?symbol=${enc(s)}&limit=10`).then((r) => r.items.map((x) => ({ title: x.title, publisher: x.source, link: x.link, time: x.time }))).catch(() => [])]).then(([g, f]) => {
    if (!fresh()) return;
    const seen = new Set();
    const n = [...f, ...g].filter((x) => { const k = x.title.toLocaleLowerCase('tr').slice(0, 50); return seen.has(k) ? false : seen.add(k); }).sort((a, b) => (b.time || 0) - (a.time || 0));
    $('#news').innerHTML = n.length ? n.slice(0, 10).map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}<br><small>${esc(x.publisher)} · ${dateTR(x.time, true)}</small></a>`).join('') : dimMsg(t('Haber bulunamadı'));
  });
}
function loadSymKap(s, fresh = () => true, first = false) {
  if (first) $('#symKap').innerHTML = SKEL;
  api(`/kap?scope=symbol&symbol=${enc(s)}&days=30&limit=12`).then((k) => {
    if (!fresh()) return;
    $('#symKap').innerHTML = k.items.length ? `<div class="news">${k.items.map((x) => `<a href="${esc(x.url)}" data-kap="${x.id}">${signalPill(x.signal)} ${esc(x.subject)}${x.summary ? ` — <span class="muted">${esc(x.summary)}</span>` : ''}<br><small>${esc(tx(x.clsLabel))} · ${esc(x.publishDate)}</small></a>`).join('')}</div>`
      : dimMsg(k.error ? esc(tx(k.error)) : t('Son 30 günde bildirim yok'));
  }).catch(() => { if (fresh()) $('#symKap').innerHTML = dimMsg(t('KAP bildirimleri alınamadı')); });
}
setInterval(() => {
  const s = curSym;
  if (page !== 'sum' || rendered.sum !== s || !root.classList.contains('active') || document.hidden) return;
  const same = () => curSym === s;
  loadSymNews(s, same); loadSymKap(s, same); loadSymReports(s, same);
}, 5 * 60_000);

// Sekmeye geri dönünce: döngü görünmezken durduğu için Özet ekrana dönünce tazele.
addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (page !== 'sum' || rendered.sum !== curSym || !root.classList.contains('active')) return;
  const s = curSym;
  const same = () => curSym === s;
  api(`/quote/${enc(s)}`).then((q) => { if (q && same()) { state.quotes[s] = q; renderHead(); renderCur(); } }).catch(() => {});
  loadSymNews(s, same); loadSymKap(s, same); loadSymReports(s, same);
});

// Sembolün aracı kurum raporları
async function loadSymReports(s, fresh = () => true) {
  $('#symRep').innerHTML = SKEL;
  try {
    const r = await api(`/research?symbol=${enc(s)}&days=365&limit=8`);
    if (!fresh()) return;
    $('#symRep').innerHTML = r.items.length ? `<div class="news">${r.items.map((x) => `<a href="#" data-rep="${esc(x.id)}">${esc(x.title)}${x.isNew ? ` <span class="pill acc">${t('yeni')}</span>` : ''}${x.summary ? `<br><span class="muted">${esc(x.summary.slice(0, 160))}${x.summary.length > 160 ? '…' : ''}</span>` : ''}<br><small>${esc(x.broker)} · ${dateTR(x.date)} · ${esc(tx(x.category))}</small></a>`).join('')}</div>`
      : dimMsg(t('Son bir yılda bu şirket için erişilebilir kurum raporu yok.'));
    $$('[data-rep]', $('#symRep')).forEach((a) => a.onclick = (e) => {
      e.preventDefault();
      const x = r.items.find((i) => i.id === a.dataset.rep);
      if (x.access === 'web') { window.open(x.page, '_blank', 'noopener'); return; }
      openPdfViewer({ src: `/api/research/file?id=${enc(x.id)}`, title: `${x.broker} · ${x.title}`, name: `${x.title}.pdf`, actions: [
        { label: t('Arşive kaydet'), run: async () => { try { const s2 = await api('/research/save', { method: 'POST', body: { id: x.id } }); toast(t('Kaydedildi: {name}', { name: s2.name }), 'ok'); } catch (err) { toast(tx(err.message), 'err'); } } },
        { label: t('Asistanla analiz et'), run: (m) => { m.close(); askAgent(t('read_broker_report ile "{id}" kimlikli {broker} raporunu ({title}) oku ve analiz et: tez, tavsiye ve hedef fiyat, tahminler, riskler; güncel verilerle karşılaştır ve kendi görüşünle değerlendir.', { id: x.id, broker: x.broker, title: x.title })); } },
      ] });
    });
  } catch (e) { if (fresh()) $('#symRep').innerHTML = dimMsg(esc(tx(e.message))); }
}
$('#bRepAll').onclick = () => emit('research:symbol', curSym);

// Ajan notları (araştırma hafızası) ve şirket belge arşivi
async function loadNotes(s, fresh = () => true) {
  const [n, docs] = await Promise.all([api(`/memory/sirket/${enc(s)}`).catch(() => null), api(`/documents?symbol=${enc(s)}`).catch(() => [])]);
  if (!fresh()) return;
  if (n?.content) {
    const text = n.content.replace(/^# .*\n+/, '');
    $('#noteMeta').textContent = t('güncelleme: {d}', { d: dateTR(n.updatedAt, true) });
    $('#symNotes').innerHTML = `<div class="msg assistant note-body${text.length > 1400 ? ' clamp' : ''}">${md(text)}</div>
      <div class="row" style="margin-top:6px">${text.length > 1400 ? `<button class="ghost" id="noteMore">${t('Tamamını göster')}</button>` : ''}<button class="ghost" id="noteUpd">${t('Asistanla güncelle')}</button><button class="ghost" id="noteDel">${t('Sil')}</button></div>`;
    $('#noteMore')?.addEventListener('click', (e) => { $('#symNotes .note-body').classList.remove('clamp'); e.target.remove(); });
    $('#noteUpd').onclick = () => askAgent(t('{s} için kayıtlı araştırma notunu güncel fiyat, temel veriler ve son KAP bildirimleriyle gözden geçir; tetikleyicilerin durumunu değerlendir ve save_memory ile güncelle.', { s }));
    $('#noteDel').onclick = async () => { if (!(await confirmBox(t('{s} için asistan notu silinsin mi?', { s }), { danger: true, ok: t('Sil') }))) return; await api(`/memory/sirket/${enc(s)}`, { method: 'DELETE' }); loadNotes(s); };
  } else {
    $('#noteMeta').textContent = '';
    $('#symNotes').innerHTML = `${dimMsg(t('Bu şirket için kayıtlı asistan notu yok. Asistan analizden sonra tezi, kilit rakamları ve tetikleyicileri buraya kaydeder.'))}<button class="ghost" id="noteNew" style="margin-top:6px">${t('Asistanla analiz et ve not al')}</button>`;
    $('#noteNew').onclick = () => askAgent(t('{s} için kapsamlı analiz yap (hisse-analizi becerisi) ve sonunda save_memory ile tezi, kilit rakamları ve tetikleyicileri kaydet.', { s }));
  }
  $('#symDocs').innerHTML = `${docs.length ? `<table class="t"><tbody>${docs.slice(0, 8).map((d, i) => `<tr class="click" data-doc="${i}"><td class="kt-wrap">${esc(d.name)}</td><td class="r dim">${dateTR(d.savedAt)}</td><td class="r dim">${Math.max(1, Math.round(d.size / 1024))} KB</td></tr>`).join('')}</tbody></table>` : dimMsg(t('Arşivde belge yok.'))}
    <button class="ghost" id="docFetch" style="margin-top:6px">${t('Asistanla son faaliyet raporunu ve sunumu getir')}</button>`;
  $$('[data-doc]', $('#symDocs')).forEach((r) => r.onclick = () => {
    const d = docs[Number(r.dataset.doc)];
    openPdfViewer({ src: `/api/documents/file?path=${enc(d.path)}`, title: d.name, name: d.name, actions: [{ label: t('Asistanla oku'), run: (m) => { m.close(); askAgent(t('{path} belgesini pdf-okuma becerisiyle oku; {s} için ana bulguları ve rakamları (sayfa numarasıyla) özetle.', { path: d.path, s })); } }] });
  });
  $('#docFetch').onclick = () => askAgent(t('{s} için son faaliyet raporunu, son finansal raporu ve varsa yatırımcı sunumunu KAP’tan bul, arşive indir (sirket-belgeleri becerisi) ve öne çıkanları özetle.', { s }));
}
const notesChanged = () => { if (rendered.sum === curSym) { const s = curSym; loadNotes(s, () => curSym === s); } };
on('ws:memory.changed', notesChanged);
on('ws:documents.changed', notesChanged);

// Temettü ve sermaye artırımları: taşmayan liste (tarih · olay · tutar), dar kartta alt satıra kırılır
function caList(rows, note) {
  return `<div class="ca-list">${rows.map((r) => `<div class="ca-row"><div class="ca-date">${r.date}${r.soon ? ` <span class="pill acc">${t('yaklaşan')}</span>` : ''}</div>
    <div class="ca-what"><span class="ca-kind ${r.cls || ''}">${esc(r.kind)}</span>${r.detail ? ` <span class="muted">${r.detail}</span>` : ''}</div><div class="ca-amt num">${r.amount || ''}</div></div>`).join('')}</div>
    <div class="dim ca-note">${note}</div>`;
}
function renderActions(acts) {
  const rows = [];
  for (const a of [...acts].reverse().slice(0, 10)) {
    const base = { date: dateTR(a.date), soon: a.date >= today() };
    if (a.dpsGross > 0) rows.push({ ...base, kind: t('Nakit temettü'), cls: 'div', detail: t('{v} ₺ / hisse', { v: num(a.dpsGross, 4) }), amount: a.cashTotal ? `${compact(a.cashTotal)} ₺` : '' });
    if (a.bonusPct > 0) rows.push({ ...base, kind: t('Bedelsiz'), cls: 'cap', detail: t('%{v}', { v: num(a.bonusPct, 2) }) });
    if (a.bonusDivPct > 0) rows.push({ ...base, kind: t('Bedelsiz (temettüden)'), cls: 'cap', detail: t('%{v}', { v: num(a.bonusDivPct, 2) }) });
    if (a.rightsPct > 0) rows.push({ ...base, kind: t('Bedelli'), cls: 'cap', detail: t('%{v}', { v: num(a.rightsPct, 2) }) });
  }
  $('#divs').innerHTML = rows.length ? caList(rows, t('Kaynak: İş Yatırım · bu yıl ve ilan edilenler · brüt tutarlar')) : dimMsg(t('Bu yıl kayıt yok'));
}
function loadYahooDividends(s, fresh) {
  api(`/dividends/${enc(s)}`).then((d) => {
    if (!fresh()) return;
    const rows = [
      ...d.dividends.slice(-8).reverse().map((x) => ({ date: dateTR(x.date), kind: t('Nakit temettü'), cls: 'div', detail: t('{v} / hisse', { v: num(x.amount, 4) }), ts: x.date })),
      ...d.splits.slice(-4).reverse().map((x) => ({ date: dateTR(x.date), kind: t('Bölünme / bedelsiz'), cls: 'cap', detail: esc(x.text || num(x.ratio, 3)), ts: x.date })),
    ].sort((a, b) => b.ts.localeCompare(a.ts));
    $('#divs').innerHTML = rows.length ? caList(rows, t('Kaynak: Yahoo Finance · son 5 yıl')) : dimMsg(t('Son 5 yılda kayıt yok'));
  }).catch(() => { if (fresh()) $('#divs').innerHTML = dimMsg(t('Veri yok')); });
}

// Renk + saydamlık (grafikler: CSS değişkeninden gelen #hex ya da rgb())
function alpha(c, a) {
  c = String(c || '').trim();
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m) c = `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) return `#${m[1]}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) return `rgba(${m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).join(',')},${a})`;
  return c;
}

async function loadChart() {
  const s = curSym;
  try {
    const d = await D.hist(s, range, true);
    if (s !== curSym) return;
    lastHist = d;
    await loadBench(s);
    if (s !== curSym) return;
    drawChart();
    const q = state.quotes[s];
    $('#chartNote').textContent = ['GRAM', 'HAS', 'ONS', 'GUMUS', 'CEYREK', 'YARIM', 'TAM', 'CUMHURIYET', 'ATA', 'BILEZIK22'].includes(s)
      ? t('Geçmiş seri, vadeli ons altın × USD/TL üzerinden türetilip güncel serbest piyasa fiyatına ölçeklenmiştir.')
      : q?.delayed ? t('BIST verileri ~15 dk gecikmelidir.') : '';
  } catch (e) {
    if (s !== curSym) return;
    lastHist = null;
    benchData = null;
    $('#relNote').textContent = '';
    makeChart($('#mainChart'), { type: 'line', data: { datasets: [] }, options: baseOptions() });
    toast(`${s}: ${tx(e.message)}`, 'err');
  }
}

// Ölçüt referans çizgisi: sembolün günlerine hizalanmış, başlangıcı 100'e normalize edilmiş gri seri.
// 5Y/TÜMÜ aralıklarında ölçüt haftalık/aylık geldiği için çizgi çizilmez (yanlış karşılaştırma).
const benchKey = () => state.settings?.benchmark || 'XU100';
async function loadBench(s) {
  const key = benchKey();
  if (!BENCH_RANGES.includes(range) || key === s) { benchData = null; return; }
  const d = await D.hist(key, range).catch(() => null);
  benchData = alignBench(d?.bars || []);
}
function alignBench(bbars) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const map = new Map(bbars.filter((b) => b.c > 0).map((b) => [day(b.t), b.c]));
  const bars = lastHist.bars;
  const vals = new Array(bars.length).fill(null);
  let last = null;
  for (let i = 0; i < bars.length; i++) { const v = map.get(day(bars[i].t)); if (v != null) last = v; if (last != null) vals[i] = last; }
  const base = vals.find((v) => v != null);
  if (!base) return null;
  const s0 = bars.find((b) => b.c > 0)?.c, s1 = bars.at(-1).c;
  if (!s0) return null;
  return { key: benchKey(), data: vals.map((v, i) => (v == null ? null : { x: bars[i].t, y: (v / base) * 100 })),
    sRet: (s1 / s0 - 1) * 100, bRet: (vals.at(-1) / base - 1) * 100, diff: (s1 / s0 - vals.at(-1) / base) * 100 };
}
function drawRelNote() {
  const el = $('#relNote'), b = benchData;
  if (!b) { el.textContent = (!BENCH_RANGES.includes(range) && benchKey() !== curSym) ? (['1d', '5d'].includes(range) ? BENCH_HIDE_INTRADAY : BENCH_HIDE_TIP) : ''; return; }
  const rl = RANGES.find(([r]) => r === range)?.[1] || range;
  el.title = t('Gri çizgi: başlangıcı 100’e normalize edilmiş {b} referansı.', { b: b.key });
  el.innerHTML = `${esc(rl)}: ${esc(curSym)} <span class="${cls(b.sRet)}">${pct(b.sRet, 1)}</span> · ${esc(b.key)} <span class="${cls(b.bRet)}">${pct(b.bRet, 1)}</span> → <span class="${cls(b.diff)}">${t('{v} puan', { v: num(b.diff, 1) })}</span>`;
}

function drawChart() {
  if (!lastHist) return;
  const { bars, indicators: ind } = lastHist;
  const ts = bars.map((b) => b.t);
  const pts = (arr) => arr.map((v, i) => ({ x: ts[i], y: v }));
  const first = bars[0]?.c, last = bars.at(-1)?.c;
  const color = last >= first ? css('--up') : css('--down');
  const ds = [{
    label: curSym, data: pts(bars.map((b) => b.c)), borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.1, yAxisID: 'y',
    fill: { target: 'origin', above: alpha(color, 0.09) },
  }];
  const has = (arr) => (arr || []).some((v) => v != null);
  // Yetersiz veride gösterge çizilmez ve düğmesi pasifleşir: boş çizgi "çalışıyor" izlenimi yaratıyor
  const ovColors = { sma20: css('--accent'), sma50: css('--info'), sma200: css('--violet') };
  ovOk.clear();
  for (const k of ['sma20', 'sma50', 'sma200']) {
    if (!has(ind[k])) continue;
    ovOk.add(k);
    if (overlays.has(k)) ds.push({ label: k.toUpperCase(), data: pts(ind[k]), borderColor: ovColors[k], borderWidth: 1, pointRadius: 0, yAxisID: 'y' });
  }
  if (has(ind.bbUpper)) ovOk.add('bb');
  if (bars.some((b) => b.v)) ovOk.add('vol');
  const bbUp = t('BB üst');
  if (overlays.has('bb') && ovOk.has('bb')) {
    ds.push({ label: bbUp, data: pts(ind.bbUpper), borderColor: css('--text-3'), borderDash: [4, 3], borderWidth: 1, pointRadius: 0, yAxisID: 'y' });
    ds.push({ label: t('BB alt'), data: pts(ind.bbLower), borderColor: css('--text-3'), borderDash: [4, 3], borderWidth: 1, pointRadius: 0, yAxisID: 'y' });
  }
  const opts = baseOptions({ legend: ds.length > 1 });
  if (ovOk.has('vol') && overlays.has('vol')) {
    ds.push({ type: 'bar', label: t('Hacim'), data: pts(bars.map((b) => b.v)), backgroundColor: css('--line-2'), yAxisID: 'v', barPercentage: 1, categoryPercentage: 1 });
    opts.scales.v = { display: false, beginAtZero: true, max: Math.max(...bars.map((b) => b.v)) * 4 };
  }
  // Ölçüt 100 tabanlı: fiyat ekseninden ayrı, görünmez sol eksende çizilir
  if (benchData) {
    ds.push({ label: benchData.key, data: benchData.data, borderColor: alpha(css('--text-3'), 0.9), borderWidth: 1, borderDash: [5, 4], pointRadius: 0, yAxisID: 'b', tension: 0.1 });
    opts.scales.b = { display: false, position: 'left' };
  }
  drawRelNote();
  segActive();
  opts.plugins.legend.labels.filter = (i) => !i.text.startsWith('BB') || i.text === bbUp;
  makeChart($('#mainChart'), { type: 'line', data: { datasets: ds }, options: opts });

  if (lower === 'none') return;
  const lopt = baseOptions();
  let lds;
  if (lower === 'rsi') {
    lds = [{ label: 'RSI(14)', data: pts(ind.rsi14), borderColor: css('--violet'), borderWidth: 1.2, pointRadius: 0 }];
    lopt.scales.y.min = 0; lopt.scales.y.max = 100;
    lopt.scales.y.ticks.stepSize = 30;
    lds.push({ label: '70', data: ts.map((x) => ({ x, y: 70 })), borderColor: alpha(css('--down'), 0.55), borderDash: [3, 3], borderWidth: 1, pointRadius: 0 });
    lds.push({ label: '30', data: ts.map((x) => ({ x, y: 30 })), borderColor: alpha(css('--up'), 0.55), borderDash: [3, 3], borderWidth: 1, pointRadius: 0 });
  } else {
    lds = [
      { type: 'bar', label: 'Histogram', data: pts(ind.macdHist), backgroundColor: ind.macdHist.map((v) => alpha(v >= 0 ? css('--up') : css('--down'), 0.6)) },
      { label: 'MACD', data: pts(ind.macd), borderColor: css('--info'), borderWidth: 1.2, pointRadius: 0 },
      { label: t('Sinyal'), data: pts(ind.macdSignal), borderColor: css('--accent'), borderWidth: 1.2, pointRadius: 0 },
    ];
  }
  makeChart($('#lowerChart'), { type: 'line', data: { datasets: lds }, options: lopt });
}

// ── 2) FİNANS ─────────────────────────────────────
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
  // FAVÖK marjı: sunucu ebitda'yı 3H (finansman öncesi) tabanından hesaplar; eski önbellekte
  // ebitda yoksa aynı formülü istemcide kuruyoruz (ebitdaBase da yoksa 3DF tabanı).
  const ebitda = (r) => r.ebitda ?? ((r.ebitdaBase ?? r.operatingProfit) != null && r.depreciation != null ? (r.ebitdaBase ?? r.operatingProfit) + r.depreciation : null);
  const margin = f.type === 'banka' ? [] : [[t('Brüt marj'), (r) => pctOf(r.grossProfit, r.sales)], [t('FAVÖK marjı'), (r) => pctOf(ebitda(r), r.sales)], [t('Net marj'), (r) => pctOf(r.netIncome, r.sales)]];
  const bal = f.cumulative.slice(0, 8);
  const balLines = f.type === 'banka' ? [[t('Krediler'), 'loans'], [t('Mevduat'), 'deposits'], [t('Özkaynak'), 'equity'], [t('Toplam varlık'), 'totalAssets']]
    : [[t('Dönen varlıklar'), 'currentAssets'], [t('Kısa vadeli yükümlülükler'), 'currentLiabilities'], [t('Net borç'), 'netDebt'], [t('Özkaynak (ana ortaklık)'), 'equity'], [t('Toplam varlık'), 'totalAssets'], [t('Net döviz pozisyonu'), 'netFx']];
  $('#fin').innerHTML = `<div class="table-wrap"><table class="t fin-table"><thead><tr><th>${t('milyar TL')}</th>${cols.map((r) => `<th class="r">${esc(r.period)}</th>`).join('')}</tr></thead><tbody>
    ${lines.map(([l, k, b]) => `<tr><td>${b ? `<b>${l}</b>` : l}</td>${cols.map((r) => `<td class="r num ${r[k] < 0 ? 'down' : ''}">${bn(r[k])}</td>`).join('')}</tr>`).join('')}
    ${margin.map(([l, fn]) => `<tr class="dim"><td>${l}</td>${cols.map((r) => `<td class="r num">${fn(r)}</td>`).join('')}</tr>`).join('')}
    <tr><td colspan="${cols.length + 1}" class="mini-head kt-subhead">${t('Bilanço (dönem sonu)')}</td></tr>
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
    : dimMsg(t('Karşılaştırma için yeterli dönem yok.'));
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
    : [[t('Dönen varlıklar'), 'currentAssets'], [t('Duran varlıklar'), 'nonCurrentAssets'], [t('Toplam varlıklar'), 'totalAssets'], [t('Kısa vadeli yükümlülükler'), 'currentLiabilities', true], [t('Net borç'), 'netDebt', true], [t('Özkaynaklar'), 'equity']]);
  drawFinCharts(f);
}
function drawFinCharts(f) {
  const bank = f.type === 'banka';
  const qs = f.quarterly.filter((q) => q[bank ? 'netInterest' : 'sales'] != null).slice(0, 8).reverse();
  const charts = bank ? [[t('Çeyreklik net faiz geliri'), 'netInterest'], [t('Çeyreklik faaliyet kârı'), 'operatingProfit'], [t('Çeyreklik net kâr'), 'netIncome']]
    : [[t('Çeyreklik hasılat'), 'sales'], [t('Çeyreklik FAVÖK'), 'ebitda'], [t('Çeyreklik net kâr'), 'netIncome']];
  $('#finCharts').innerHTML = charts.map(([title], i) => `<div><div class="kt-mini-h">${title}</div><div class="chart-box fin-chart"><canvas id="fc${i}"></canvas></div></div>`).join('');
  const pos = css('--accent-bg') || css('--accent'), neg = css('--down');
  charts.forEach(([title, k], i) => {
    const data = qs.map((q) => q[k]);
    const o = baseOptions({ time: false, yRight: false });
    o.scales.x.grid = { display: false };
    o.scales.x.ticks = { ...o.scales.x.ticks, maxRotation: 0, autoSkip: false, font: { size: 9 }, callback: (v, j) => qLabel(qs[j]?.period || '') };
    o.scales.y.ticks = { ...o.scales.y.ticks, maxTicksLimit: 6, callback: (v) => shortTL(v) };
    o.plugins.tooltip.callbacks = { title: (it) => qLabel(qs[it[0]?.dataIndex]?.period || ''), label: (c) => t('{v} TL', { v: shortTL(c.parsed.y) }) };
    makeChart($(`#fc${i}`), { type: 'bar', data: { labels: qs.map((q) => q.period), datasets: [{ label: title, data, backgroundColor: data.map((v) => (v < 0 ? neg : pos)), borderRadius: 1, maxBarThickness: 34 }] }, options: o });
  });
}
async function renderFin() {
  const s = curSym;
  const tok = symToken;
  const fresh = () => tok === symToken;
  $('#finSym').textContent = s;
  $('#fin').innerHTML = SKEL;
  $('#finSum').hidden = false;
  $('#finInc').innerHTML = $('#finBal').innerHTML = SKEL;
  $('#finNote').textContent = '';
  finData = null;
  try {
    const f = await D.fin(s);
    if (!fresh()) return;
    finData = f;
    drawFinSummary(f);
    $('#finNote').textContent = [tx(f.source), t('son dönem {p}', { p: cumLabel(f.latest) }), f.type === 'banka' ? t('banka') : ''].filter(Boolean).join(' · ');
    drawFin();
  } catch (e) {
    if (!fresh()) return;
    $('#finSum').hidden = true;
    $('#fin').innerHTML = dimMsg(esc(/bulunamadı|not found/i.test(e.message) ? t('Mali tablolar yalnızca BIST şirketleri için var.') : tx(e.message)));
  }
}
$('#finMode').onclick = (e) => { e.preventDefault(); const b = e.target.closest('[data-m]'); if (!b) return; finMode = b.dataset.m; localSet('finMode', finMode); drawFin(); };

// ── Hesap: skor ve değerleme (saf işlevler) ─────────
// Mali tablo değerleri TL'dir (milyon değil). Son 12 ay (S12A) = son dört çeyreğin toplamı; önceki S12A = ondan önceki dört çeyrek.
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
function median(arr) {
  const v = arr.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
const divPos = (a, b) => (isNum(a) && isNum(b) && b > 0 ? a / b : null); // payda pozitif olmalı
const pct100 = (x) => (isNum(x) ? x * 100 : null);
const growth = (cur, prev) => (isNum(cur) && isNum(prev) && prev > 0 ? (cur / prev - 1) * 100 : null);
const avg2 = (a, b) => (isNum(a) && isNum(b) ? (a + b) / 2 : isNum(a) ? a : null);
// Doğrusal puan: lo → 0, hi → 100 (lo > hi ise düşük değer iyidir); aralık dışı sınırlanır
const score01 = (x, lo, hi) => (isNum(x) ? Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100)) : null);
const mean = (a) => { const v = a.filter(isNum); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

function medians(items) {
  const out = { n: items.length, cnt: {} };
  for (const k of ['pe', 'pb', 'evEbitda', 'evSales']) {
    const v = items.map((x) => x[k]).filter((x) => isNum(x) && x > 0);
    out[k] = median(v); out.cnt[k] = v.length;
  }
  for (const k of ['ret1m', 'retYtd']) out[k] = median(items.map((x) => x[k]));
  return out;
}
// Sektörde en az 3 geçerli değer yoksa BIST 100 medyanı kullanılır
function pickMed(k, secMed, bistMed) {
  if (secMed && secMed.cnt[k] >= 3) return { v: secMed[k], src: 'sector' };
  if (bistMed && isNum(bistMed[k])) return { v: bistMed[k], src: 'bist' };
  return { v: null, src: null };
}

function finMetrics(f) {
  if (!f || !f.cumulative?.length) return null;
  const bank = f.type === 'banka';
  const Q = f.quarterly || [], C = f.cumulative;
  const qi = (p) => { const m = /^(\d{4})-Ç(\d)$/.exec(p || ''); return m ? Number(m[1]) * 4 + Number(m[2]) : null; };
  const run = (off) => {
    const s = Q.slice(off, off + 4);
    if (s.length < 4) return null;
    const i0 = qi(s[0].period);
    return i0 != null && s.every((r, i) => qi(r.period) === i0 - i) ? s : null;
  };
  const cur = run(0), prv = run(4);
  const prevOk = cur && prv && qi(prv[0].period) === qi(cur[0].period) - 4;
  const sum = (s, k) => (s && s.every((r) => isNum(r[k])) ? s.reduce((a, r) => a + r[k], 0) : null);
  const keys = bank ? ['netInterest', 'netIncome', 'operatingProfit'] : ['sales', 'grossProfit', 'ebitda', 'netIncome', 'opCashFlow'];
  const T = {}, P = {};
  for (const k of keys) { T[k] = sum(cur, k); P[k] = prevOk ? sum(prv, k) : null; }
  const B0 = C[0];
  const [y, m] = String(B0.period).split('/').map(Number);
  const B4 = C.find((r) => r.period === `${y - 1}/${m}`) || null;
  const q0 = Q[0] || null;
  const q4 = q0 ? Q.find((r) => qi(r.period) === qi(q0.period) - 4) || null : null;
  const debt = (b) => (b && (isNum(b.stDebt) || isNum(b.ltDebt)) ? (b.stDebt || 0) + (b.ltDebt || 0) : null);
  return { bank, T, P, B0, B4, q0, q4, debt0: debt(B0), debt4: debt(B4), ttm: cur ? [cur[3].period, cur[0].period] : null, ttmPrev: prevOk ? [prv[3].period, prv[0].period] : null };
}

// Kategori ve metrik tanımları: [anahtar, değer, birim, lo, hi] — puan lo'da 0, hi'de 100
function computeScore({ fin, fund, tech, secMed, bistMed }) {
  const M = finMetrics(fin);
  const bank = fin?.type === 'banka';
  const T = M?.T || {}, P = M?.P || {}, B0 = M?.B0 || {}, B4 = M?.B4 || {}, q0 = M?.q0 || {}, q4 = M?.q4 || {};
  const it = (key, label, v, unit, lo, hi, extra = {}) => ({ key, label, v, unit, lo, hi, p: score01(v, lo, hi), ...extra });
  // Net kâr büyümesi: zarardan kâra 100, zarar 0 puan
  const niGrowth = (key, label, cur, prev, lo, hi) => {
    if (isNum(cur) && isNum(prev) && prev <= 0) return { key, label, v: null, unit: 'gpct', lo, hi, p: cur > 0 ? 100 : 0, note: cur > 0 ? t('zarardan kâra') : t('zarar') };
    return it(key, label, growth(cur, prev), 'gpct', lo, hi);
  };
  const avgEq = avg2(B0.equity, B4.equity);
  const cats = [];
  if (bank) {
    cats.push({ key: 'prof', label: t('Kârlılık'), weight: 25, items: [
      it('roe', t('Özkaynak kârlılığı (ROE)'), pct100(divPos(T.netIncome, avgEq)), 'pct', 0, 30),
      it('roa', t('Aktif kârlılığı (ROA)'), pct100(divPos(T.netIncome, avg2(B0.totalAssets, B4.totalAssets))), 'pct', 0, 3),
    ] });
    cats.push({ key: 'growth', label: t('Büyüme'), weight: 20, items: [
      niGrowth('niG', t('Net kâr büyümesi (S12A)'), T.netIncome, P.netIncome, -30, 40),
      it('niiG', t('Net faiz geliri büyümesi (S12A)'), growth(T.netInterest, P.netInterest), 'gpct', -10, 40),
      niGrowth('qNiG', t('Son çeyrek net kâr büyümesi'), q0.netIncome, q4.netIncome, -30, 40),
    ] });
    cats.push({ key: 'health', label: t('Finansal sağlık'), weight: 20, items: [
      it('eqA', t('Özkaynak / aktif'), pct100(divPos(B0.equity, B0.totalAssets)), 'pct', 6, 14),
      it('ld', t('Kredi / mevduat'), pct100(divPos(B0.loans, B0.deposits)), 'pct', 120, 80),
    ] });
  } else {
    cats.push({ key: 'prof', label: t('Kârlılık'), weight: 25, items: [
      it('roe', t('Özkaynak kârlılığı (ROE)'), pct100(divPos(T.netIncome, avgEq)), 'pct', 0, 25),
      it('nm', t('Net marj'), pct100(divPos(T.netIncome, T.sales)), 'pct', 0, 15),
      it('gm', t('Brüt marj'), pct100(divPos(T.grossProfit, T.sales)), 'pct', 0, 35),
      it('em', t('FAVÖK marjı'), pct100(divPos(T.ebitda, T.sales)), 'pct', 0, 25),
    ] });
    cats.push({ key: 'growth', label: t('Büyüme'), weight: 20, items: [
      it('sG', t('Satış büyümesi (S12A)'), growth(T.sales, P.sales), 'gpct', -10, 30),
      niGrowth('niG', t('Net kâr büyümesi (S12A)'), T.netIncome, P.netIncome, -30, 40),
      it('qSG', t('Son çeyrek satış büyümesi'), growth(q0.sales, q4.sales), 'gpct', -10, 30),
      niGrowth('qNiG', t('Son çeyrek net kâr büyümesi'), q0.netIncome, q4.netIncome, -30, 40),
    ] });
    // Net borç / FAVÖK: net nakit 100; FAVÖK negatifken net borç varsa 0
    let nde = it('nde', t('Net borç / FAVÖK'), divPos(B0.netDebt, T.ebitda), 'x', 4, 0);
    if (isNum(B0.netDebt) && B0.netDebt <= 0) nde = { ...nde, v: div(B0.netDebt, T.ebitda) != null && T.ebitda > 0 ? B0.netDebt / T.ebitda : null, p: 100, note: t('net nakit') };
    else if (isNum(B0.netDebt) && isNum(T.ebitda) && T.ebitda <= 0) nde = { ...nde, v: null, p: 0, note: t('FAVÖK negatif') };
    let de = it('de', t('Finansal borç / özkaynak'), divPos(M?.debt0, B0.equity), 'r2', 2, 0);
    if (isNum(B0.equity) && B0.equity <= 0) de = { ...de, v: null, p: 0, note: t('negatif özkaynak') };
    cats.push({ key: 'health', label: t('Finansal sağlık'), weight: 20, items: [
      nde,
      it('cr', t('Cari oran'), divPos(B0.currentAssets, B0.currentLiabilities), 'r2', 0.8, 2),
      de,
    ] });
  }
  // Değerleme: şirket çarpanı / sektör medyanı — 1,5 kat ve üstü 0, yarısı ve altı 100 puan
  const valItems = (bank ? [['pe', t('F/K')], ['pb', t('PD/DD')]] : [['pe', t('F/K')], ['pb', t('PD/DD')], ['evEbitda', t('FD/FAVÖK')]]).map(([k, label]) => {
    const v = fund?.[k], med = pickMed(k, secMed, bistMed);
    const base = { key: k, label, v: isNum(v) ? v : null, unit: k === 'pb' ? 'r2' : 'mult', med: med.v, medSrc: med.src, lo: 1.5, hi: 0.5 };
    if (!isNum(v) || !isNum(med.v)) return { ...base, p: null };
    if (v <= 0) return { ...base, p: 0, note: t('negatif') };
    return { ...base, rel: v / med.v, p: score01(v / med.v, 1.5, 0.5) };
  });
  cats.push({ key: 'value', label: t('Değerleme'), weight: 20, items: valItems });
  const vsSma = tech && isNum(tech.price) && isNum(tech.sma200) && tech.sma200 > 0 ? (tech.price / tech.sma200 - 1) * 100 : null;
  cats.push({ key: 'mom', label: t('Momentum'), weight: 15, items: [
    it('r1m', t('1 ay getiri'), isNum(fund?.ret1m) ? fund.ret1m : null, 'gpct', -10, 10),
    it('ytd', t('YBB getiri'), isNum(fund?.retYtd) ? fund.retYtd : null, 'gpct', -10, 40),
    it('sma', t('Fiyat / SMA200'), vsSma, 'gpct', -15, 15),
  ] });
  for (const c of cats) c.score = mean(c.items.map((x) => x.p));
  const scored = cats.filter((c) => isNum(c.score));
  const wsum = scored.reduce((a, c) => a + c.weight, 0);
  const overall = wsum ? scored.reduce((a, c) => a + c.score * c.weight, 0) / wsum : null;
  const grade = !isNum(overall) ? '—' : overall >= 80 ? 'A' : overall >= 65 ? 'B' : overall >= 50 ? 'C' : overall >= 35 ? 'D' : 'E';

  // Piotroski benzeri kontrol listesi (S12A ile bir önceki S12A; bilanço bir yıl öncesiyle)
  const gt = (a, b) => (isNum(a) && isNum(b) ? a > b : null);
  const lt = (a, b) => (isNum(a) && isNum(b) ? a < b : null);
  const pio = bank ? [
    [t('Net kâr > 0'), gt(T.netIncome, 0)],
    [t('Faaliyet nakit akışı > 0'), null, true],
    [t('ROA arttı'), gt(div(T.netIncome, B0.totalAssets), div(P.netIncome, B4.totalAssets))],
    [t('Nakit akışı > net kâr'), null, true],
    [t('Borçluluk azaldı'), gt(div(B0.equity, B0.totalAssets), div(B4.equity, B4.totalAssets)), false, t('Bankada özkaynak / aktif oranının artması')],
    [t('Cari oran arttı'), null, true],
    [t('Brüt marj arttı'), null, true],
    [t('Aktif devir hızı arttı'), null, true],
  ] : [
    [t('Net kâr > 0'), gt(T.netIncome, 0)],
    [t('Faaliyet nakit akışı > 0'), gt(T.opCashFlow, 0)],
    [t('ROA arttı'), gt(div(T.netIncome, B0.totalAssets), div(P.netIncome, B4.totalAssets))],
    [t('Nakit akışı > net kâr'), gt(T.opCashFlow, T.netIncome)],
    [t('Borçluluk azaldı'), lt(div(M?.debt0, B0.totalAssets), div(M?.debt4, B4.totalAssets)), false, t('Finansal borç / toplam varlık oranı bir yıl öncesine göre düştü')],
    [t('Cari oran arttı'), gt(div(B0.currentAssets, B0.currentLiabilities), div(B4.currentAssets, B4.currentLiabilities))],
    [t('Brüt marj arttı'), gt(div(T.grossProfit, T.sales), div(P.grossProfit, P.sales))],
    [t('Aktif devir hızı arttı'), gt(div(T.sales, B0.totalAssets), div(P.sales, B4.totalAssets))],
  ];
  const pioItems = pio.map(([label, ok, na, tip]) => ({ label, ok, na: !!na, tip }));
  const known = pioItems.filter((x) => x.ok != null);
  return { bank, cats, overall, grade, pio: { items: pioItems, pass: known.filter((x) => x.ok).length, n: known.length }, M };
}

// Adil değer yöntemleri: F/K, PD/DD, FD/FAVÖK (sektör medyanlarıyla) ve Graham sayısı
function computeValue({ fin, fund, secMed, bistMed }) {
  const M = finMetrics(fin);
  const bank = fin?.type === 'banka';
  const close = fund?.close;
  const shares = divPos(fund?.mcapTL, close);
  const out = [];
  const mPE = pickMed('pe', secMed, bistMed), mPB = pickMed('pb', secMed, bistMed), mEV = pickMed('evEbitda', secMed, bistMed);
  out.push({ key: 'pe', label: t('F/K'), med: mPE, v: isNum(fund?.pe) && fund.pe > 0 && isNum(mPE.v) && isNum(close) ? (close * mPE.v) / fund.pe : null,
    why: !(fund?.pe > 0) ? t('F/K yok ya da negatif') : null });
  out.push({ key: 'pb', label: t('PD/DD'), med: mPB, v: isNum(fund?.pb) && fund.pb > 0 && isNum(mPB.v) && isNum(close) ? (close * mPB.v) / fund.pb : null,
    why: !(fund?.pb > 0) ? t('PD/DD yok ya da negatif') : null });
  if (!bank) {
    const ebitda = M?.T.ebitda, nd = M?.B0?.netDebt;
    const eqv = isNum(mEV.v) && isNum(ebitda) && ebitda > 0 && isNum(nd) ? mEV.v * ebitda - nd : null;
    out.push({ key: 'ev', label: t('FD/FAVÖK'), med: mEV, ebitda, netDebt: nd, equityValue: eqv, v: isNum(eqv) && eqv > 0 && shares ? eqv / shares : null,
      why: !(ebitda > 0) ? t('S12A FAVÖK yok ya da negatif') : isNum(eqv) && eqv <= 0 ? t('Net borç, ima edilen firma değerini aşıyor') : null });
  }
  const eps = div(M?.T.netIncome, shares), bvps = div(M?.B0?.equity, shares);
  out.push({ key: 'graham', label: t('Graham sayısı'), eps, bvps, v: isNum(eps) && isNum(bvps) && eps > 0 && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : null,
    why: !(eps > 0) ? t('Hisse başı kâr negatif') : !(bvps > 0) ? t('Defter değeri negatif') : null });
  const vals = out.map((x) => x.v).filter((x) => isNum(x) && x > 0);
  return { bank, methods: out, shares, eps, bvps, avg: mean(vals), med: median(vals), min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, M };
}
// ── Hesap sonu ──

// Ortak veri: temel veriler + sektör ve BIST 100 medyanları
async function peerContext(s) {
  const fund = await D.fund(s);
  if (!fund) return { fund: null };
  const [secItems, bistItems] = await Promise.all([fund.sector ? D.sector(fund.sector).catch(() => []) : [], D.bist100().catch(() => [])]);
  return { fund, secItems, secMed: medians(secItems), bistMed: medians(bistItems) };
}
const tone = (p) => (!isNum(p) ? 'na' : p >= 65 ? 'hi' : p >= 40 ? 'mid' : 'lo');
function fmtUnit(v, unit) {
  if (!isNum(v)) return '—';
  if (unit === 'pct') return pct(v, 1, false);
  if (unit === 'gpct') return pct(v, 1);
  if (unit === 'x') return `${num(v, 1)}×`;
  if (unit === 'r2') return num(v, 2);
  return num(v, v >= 100 ? 0 : 1);
}
const medLabel = (m) => (m.src === 'bist' ? 'BIST 100' : t('sektör'));
const pageHead = (s, title, note = '') => `<div class="kt-pagehead"><b>${esc(s)}</b><span>${title}</span><span class="dim">${note}</span></div>`;

// ── 3) SKOR ───────────────────────────────────────
async function renderScore() {
  const s = curSym;
  const tok = symToken;
  const fresh = () => tok === symToken;
  const el = $('#scoreBody');
  el.innerHTML = pageHead(s, t('SKOR')) + SKEL;
  try {
    const [ctx, fin, tech] = await Promise.all([peerContext(s), D.fin(s).catch(() => null), D.tech(s).catch(() => null)]);
    if (!fresh()) return;
    if (!ctx.fund) { el.innerHTML = pageHead(s, t('SKOR')) + `<div class="empty">${t('Skor yalnızca BIST hisseleri için hesaplanır.')}</div>`; return; }
    const sc = computeScore({ fin, fund: ctx.fund, tech, secMed: ctx.secMed, bistMed: ctx.bistMed });
    el.innerHTML = scoreHtml(s, sc, ctx, fin);
  } catch (e) { if (fresh()) el.innerHTML = pageHead(s, t('SKOR')) + dimMsg(esc(tx(e.message))); }
}
function scoreHtml(s, sc, ctx, fin) {
  const { fund } = ctx;
  const nCats = sc.cats.filter((c) => isNum(c.score)).length;
  const M = sc.M;
  const note = [sectorName(fund.sector), t('{n} sektör şirketi', { n: ctx.secMed.n }), sc.bank ? t('banka') : ''].filter(Boolean).join(' · ');
  const overall = panel(t('Genel skor'), `<div class="kt-ov">
      <div class="kt-grade g${sc.grade}">${sc.grade}</div>
      <div><div class="kt-big ${tone(sc.overall)}">${isNum(sc.overall) ? num(sc.overall, 0) : '—'}<small>/100</small></div>
      <div class="dim">${t('{n}/{m} kategori · ağırlıklı ortalama', { n: nCats, m: sc.cats.length })}</div></div></div>
    <div class="kt-scale">A ≥ 80 · B ≥ 65 · C ≥ 50 · D ≥ 35 · E &lt; 35</div>`, { cls: 'kt-overall' });
  const bars = panel(t('Kategoriler'), sc.cats.map((c) => `<div class="kt-catrow"><span>${c.label}</span><div class="kt-bar"><i class="${tone(c.score)}" style="width:${isNum(c.score) ? c.score.toFixed(1) : 0}%"></i></div><b class="${tone(c.score)}">${isNum(c.score) ? num(c.score, 0) : '—'}</b><small title="${t('Ağırlık')}">${c.weight}%</small></div>`).join(''));
  const pio = panel(`${t('Piotroski kontrol listesi')} ${sub(t('{x}/{n} olumlu', { x: sc.pio.pass, n: sc.pio.n }))}`, `<ul class="kt-check">${sc.pio.items.map((x) => `<li class="${x.na ? 'na' : x.ok == null ? 'na' : x.ok ? 'ok' : 'no'}"${x.tip ? ` title="${esc(x.tip)}"` : ''}><i>${x.na || x.ok == null ? '—' : x.ok ? '✓' : '✗'}</i>${x.label}${x.na ? ` <small class="dim">${t('bankalarda uygulanmaz')}</small>` : ''}</li>`).join('')}</ul>`);
  const tables = sc.cats.map((c) => panel(`${c.label} ${sub(`${t('ağırlık')} ${c.weight}%`)}`, `<div class="table-wrap"><table class="t kt-mt"><thead><tr><th>${t('Metrik')}</th><th class="r">${t('Değer')}</th><th class="r">${t('Ölçüt')}</th><th class="r">${t('Puan')}</th></tr></thead><tbody>
    ${c.items.map((x) => {
      const bench = isNum(x.med) ? `${medLabel(x)} ${fmtUnit(x.med, x.unit)}` : x.med !== undefined ? '—' : `${fmtUnit(x.lo, x.unit)} → ${fmtUnit(x.hi, x.unit)}`;
      const tip = x.med !== undefined ? t('Medyanın 1,5 katı ve üstü 0 puan, yarısı ve altı 100 puan; arası doğrusal') : t('{lo} için 0 puan, {hi} için 100 puan; arası doğrusal', { lo: fmtUnit(x.lo, x.unit), hi: fmtUnit(x.hi, x.unit) });
      return `<tr class="${x.p == null ? 'dim' : ''}"><td class="kt-wrap">${x.label}</td><td class="r num">${fmtUnit(x.v, x.unit)}${x.note ? ` <small class="dim">${esc(x.note)}</small>` : ''}</td><td class="r num dim" title="${esc(tip)}">${bench}</td><td class="r num"><span class="kt-pts ${tone(x.p)}">${isNum(x.p) ? num(x.p, 0) : '—'}</span></td></tr>`;
    }).join('')}</tbody></table></div>`, { extra: `<b class="kt-cscore ${tone(c.score)}">${isNum(c.score) ? num(c.score, 0) : '—'}</b>` })).join('');
  const per = M ? [
    M.ttm ? t('S12A: {a} – {b}', { a: qLabel(M.ttm[0]), b: qLabel(M.ttm[1]) }) : t('S12A hesaplanamadı (eksik çeyrek)'),
    M.ttmPrev ? t('önceki S12A: {a} – {b}', { a: qLabel(M.ttmPrev[0]), b: qLabel(M.ttmPrev[1]) }) : '',
    t('bilanço: {a} ve {b}', { a: cumLabel(M.B0.period), b: M.B4 ? cumLabel(M.B4.period) : '—' }),
  ].filter(Boolean).join(' · ') : t('Mali tablolar alınamadı; yalnızca piyasa verileriyle hesaplandı.');
  return `${pageHead(s, t('SKOR'), esc(note))}
    <div class="kt-score-top">${overall}${bars}${pio}</div>
    <div class="kt-grid kt-g3">${tables}</div>
    <div class="kt-note">${esc(per)} · ${t('Değerleme medyanları: sektörde en az 3 geçerli değer yoksa BIST 100. Veri yoksa metrik ortalamaya katılmaz.')} ${fin?.source ? `· ${esc(tx(fin.source))}` : ''}</div>
    <div class="kt-disc">${DISCLAIMER}</div>`;
}

// ── 4) DEĞER ──────────────────────────────────────
async function renderValue() {
  const s = curSym;
  const tok = symToken;
  const fresh = () => tok === symToken;
  const el = $('#valBody');
  el.innerHTML = pageHead(s, t('DEĞER')) + SKEL;
  try {
    const [ctx, fin] = await Promise.all([peerContext(s), D.fin(s).catch(() => null)]);
    if (!fresh()) return;
    if (!ctx.fund) { el.innerHTML = pageHead(s, t('DEĞER')) + `<div class="empty">${t('Değerleme yalnızca BIST hisseleri için yapılır.')}</div>`; return; }
    el.innerHTML = valueHtml(s, computeValue({ fin, fund: ctx.fund, secMed: ctx.secMed, bistMed: ctx.bistMed }), ctx, fin);
    $('#valDcf').onclick = () => askAgent(t('{s} için dcf-degerleme becerisini çalıştır: son mali tablolar ve güncel fiyatla indirgenmiş nakit akımı değerlemesi yap; varsayımları (büyüme, iskonto oranı, uç değer) açıkça yaz, duyarlılık tablosu ver ve sonucu çarpan yöntemleriyle karşılaştır.', { s }));
  } catch (e) { if (fresh()) el.innerHTML = pageHead(s, t('DEĞER')) + dimMsg(esc(tx(e.message))); }
}
function valueHtml(s, V, ctx, fin) {
  const { fund, secMed, bistMed } = ctx;
  const px = state.quotes[s]?.price ?? fund.close;
  const up = (v) => (isNum(v) && isNum(px) && px > 0 ? (v / px - 1) * 100 : null);
  const mult = [['pe', t('F/K'), 'peF'], ['pb', t('PD/DD'), 'pbF'], ...(V.bank ? [] : [['evEbitda', t('FD/FAVÖK'), 'evEbitdaF'], ['evSales', t('FD/Satış'), null]])];
  const mTable = `<div class="table-wrap"><table class="t kt-mt"><thead><tr><th></th><th class="r">${t('Cari')}</th><th class="r" title="${t('İş Yatırım tahminlerine göre')}">${t('Tahmini')}</th><th class="r">${t('Sektör medyanı')}</th><th class="r">${t('BIST 100 medyanı')}</th><th class="r">${t('Sektöre göre')}</th></tr></thead><tbody>
    ${mult.map(([k, l, fk]) => {
      const v = fund[k], sm = secMed.cnt[k] >= 3 ? secMed[k] : null;
      const rel = isNum(v) && v > 0 && isNum(sm) ? (v / sm - 1) * 100 : null;
      return `<tr><td>${l}</td><td class="r num"><b>${num(v, k === 'pb' ? 2 : 1)}</b></td><td class="r num">${fk ? num(fund[fk], k === 'pb' ? 2 : 1) : '—'}</td><td class="r num">${num(sm, k === 'pb' ? 2 : 1)} <small class="dim">${secMed.cnt[k] || 0}</small></td><td class="r num">${num(bistMed[k], k === 'pb' ? 2 : 1)}</td><td class="r num ${rel == null ? 'dim' : rel < 0 ? 'up' : 'down'}" title="${t('Sektör medyanına göre iskonto (−) / prim (+)')}">${pct(rel, 0)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  const valid = V.methods.filter((m) => isNum(m.v) && m.v > 0);
  const scaleMax = Math.max(px || 0, ...valid.map((m) => m.v)) * 1.12 || 1;
  const at = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100)).toFixed(2)}%`;
  const marker = isNum(px) ? `<b class="kt-fv-px" style="left:${at(px)}"></b>` : '';
  const fvRows = V.methods.map((m) => `<div class="kt-fv-row"><span class="kt-fv-l">${m.label}</span><div class="kt-fv-track">${isNum(m.v) && m.v > 0 ? `<i class="kt-fv-bar ${m.v >= px ? 'up' : 'down'}" style="width:${at(m.v)}"></i>` : ''}${marker}</div><span class="kt-fv-v num">${isNum(m.v) && m.v > 0 ? price(m.v) : '—'}</span><span class="kt-fv-u num ${cls(up(m.v))}">${isNum(m.v) && m.v > 0 ? pct(up(m.v), 0) : ''}</span></div>`).join('');
  const band = isNum(V.min) ? `<div class="kt-fv-row kt-fv-range"><span class="kt-fv-l">${t('Aralık')}</span><div class="kt-fv-track"><i class="kt-fv-band" style="left:${at(V.min)};width:calc(${at(V.max)} - ${at(V.min)})"></i>${isNum(V.med) ? `<b class="kt-fv-med" style="left:${at(V.med)}" title="${t('Medyan adil değer')}"></b>` : ''}${marker}</div><span class="kt-fv-v num">${price(V.min)}–${price(V.max)}</span><span></span></div>` : '';
  const axis = isNum(px) ? `<div class="kt-fv-row kt-fv-axis"><span></span><div class="kt-fv-track"><em style="left:${at(px)}">${t('Fiyat')} ${price(px)}</em></div><span></span><span></span></div>` : '';
  const sumBox = `<div class="kt-kv">
      <div><span>${t('Güncel fiyat')}</span><b class="num">${price(px)} ₺</b></div>
      <div><span>${t('Ortalama adil değer')}</span><b class="num">${isNum(V.avg) ? `${price(V.avg)} ₺` : '—'}</b><em class="num ${cls(up(V.avg))}">${pct(up(V.avg), 1)}</em></div>
      <div><span>${t('Medyan adil değer')}</span><b class="num">${isNum(V.med) ? `${price(V.med)} ₺` : '—'}</b><em class="num ${cls(up(V.med))}">${pct(up(V.med), 1)}</em></div>
      <div><span>${t('Yöntem sayısı')}</span><b class="num">${valid.length}/${V.methods.length}</b></div>
      <div><span>${t('Hisse sayısı')}</span><b class="num">${isNum(V.shares) ? compact(V.shares) : '—'}</b></div>
      <div><span>${t('Hisse başı kâr (S12A)')}</span><b class="num">${isNum(V.eps) ? price(V.eps) : '—'}</b></div>
      <div><span>${t('Hisse başı defter değeri')}</span><b class="num">${isNum(V.bvps) ? price(V.bvps) : '—'}</b></div>
    </div>
    <button class="btn kt-wide" id="valDcf">${t('Asistanla DCF değerlemesi yap')}</button>`;
  const formula = {
    pe: (m) => t('Fiyat × {src} F/K medyanı ({med}) ÷ F/K ({v})', { src: medLabel(m.med), med: num(m.med.v, 1), v: num(fund.pe, 1) }),
    pb: (m) => t('Fiyat × {src} PD/DD medyanı ({med}) ÷ PD/DD ({v})', { src: medLabel(m.med), med: num(m.med.v, 2), v: num(fund.pb, 2) }),
    ev: (m) => t('({src} FD/FAVÖK medyanı {med} × S12A FAVÖK {e} − net borç {nd}) ÷ hisse sayısı', { src: medLabel(m.med), med: num(m.med.v, 1), e: isNum(m.ebitda) ? shortTL(m.ebitda) : '—', nd: isNum(m.netDebt) ? shortTL(m.netDebt) : '—' }),
    graham: () => t('√(22,5 × hisse başı kâr {eps} × hisse başı defter değeri {bvps})', { eps: num(V.eps, 2), bvps: num(V.bvps, 2) }),
  };
  const mDetail = `<div class="table-wrap"><table class="t kt-mt"><thead><tr><th>${t('Yöntem')}</th><th>${t('Hesap')}</th><th class="r">${t('Adil değer')}</th><th class="r">${t('Fiyata göre')}</th></tr></thead><tbody>
    ${V.methods.map((m) => `<tr><td>${m.label}</td><td class="kt-wrap dim">${esc(formula[m.key](m))}${m.why && !(m.v > 0) ? ` <small class="down">· ${esc(m.why)}</small>` : ''}</td><td class="r num"><b>${isNum(m.v) && m.v > 0 ? price(m.v) : '—'}</b></td><td class="r num ${cls(up(m.v))}">${isNum(m.v) && m.v > 0 ? pct(up(m.v), 1) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  const note = [sectorName(fund.sector), t('{n} sektör şirketi', { n: secMed.n }), fund.period ? t('İş Yatırım · son dönem {p}', { p: fund.period }) : ''].filter(Boolean).join(' · ');
  return `${pageHead(s, t('DEĞER'), esc(note))}
    <div class="kt-grid kt-g2 kt-val-top">
      ${panel(t('Çarpanlar'), mTable)}
      ${panel(t('Özet'), sumBox)}
    </div>
    ${panel(`${t('Adil değer aralığı')} ${sub(t('dikey çizgi: güncel fiyat'))}`, `<div class="kt-fv">${fvRows}${band}${axis}</div>`)}
    ${panel(t('Yöntem ayrıntısı'), mDetail)}
    <div class="kt-note">${t('Mali tablo tutarları TL’dir; S12A son dört çeyreğin toplamıdır. FD/FAVÖK yönteminde azınlık payları ve iştirakler dikkate alınmaz. Graham sayısı enflasyonlu ortamda yüksek çıkabilir.')} ${fin?.source ? `· ${esc(tx(fin.source))}` : ''}</div>
    <div class="kt-disc">${DISCLAIMER}</div>`;
}

// ── 5) KARŞ ───────────────────────────────────────
let compExtra = localGet('ktCompExtra', []);
if (!Array.isArray(compExtra)) compExtra = [];
let compSort = { k: 'mcapMnTL', dir: -1 };
let compRows = [];
const toRow = (f) => ({ code: f.code, name: f.name, sector: f.sector, close: f.close, mcapMnTL: isNum(f.mcapTL) ? f.mcapTL / 1e6 : null, pe: f.pe, pb: f.pb, evEbitda: f.evEbitda, evSales: f.evSales, ret1m: f.ret1m, retYtd: f.retYtd });
const COMP_COLS = [
  ['code', t('Sembol')], ['name', t('Şirket')], ['close', t('Fiyat'), (v) => price(v)], ['mcapMnTL', t('Piy. değeri'), (v) => (isNum(v) ? compact(v * 1e6) : '—')],
  ['pe', t('F/K'), (v) => num(v, 1)], ['pb', t('PD/DD'), (v) => num(v, 2)], ['evEbitda', t('FD/FAVÖK'), (v) => num(v, 1)], ['evSales', t('FD/Satış'), (v) => num(v, 1)],
  ['ret1m', t('1A'), (v) => `<span class="${cls(v)}">${pct(v, 1)}</span>`], ['retYtd', t('YBB'), (v) => `<span class="${cls(v)}">${pct(v, 1)}</span>`],
];
async function renderComp() {
  const s = curSym;
  const tok = symToken;
  const fresh = () => tok === symToken;
  $('#compSym').textContent = s;
  $('#compNote').textContent = '';
  $('#compClear').hidden = !compExtra.length;
  $('#compTable').innerHTML = `<tbody><tr><td>${SKEL}</td></tr></tbody>`;
  try {
    const ctx = await peerContext(s);
    if (!fresh()) return;
    if (!ctx.fund) { $('#compTable').innerHTML = `<tbody><tr><td class="dim">${t('Karşılaştırma yalnızca BIST hisseleri için yapılır.')}</td></tr></tbody>`; drawCompChart(s, [], fresh); return; }
    const peers = [...ctx.secItems].sort((a, b) => (b.mcapMnTL ?? -1) - (a.mcapMnTL ?? -1)).slice(0, 12);
    if (!peers.some((x) => x.code === s)) peers.push({ ...toRow(ctx.fund), code: s });
    const extras = (await Promise.all(compExtra.filter((x) => x !== s && !peers.some((p) => p.code === x)).map((x) => D.fund(x).then((f) => (f ? { ...toRow(f), code: x, extra: true } : null)).catch(() => null)))).filter(Boolean);
    if (!fresh()) return;
    compRows = [...peers, ...extras];
    $('#compNote').textContent = [sectorName(ctx.fund.sector), t('{n} sektör şirketi', { n: ctx.secItems.length }), t('ilk 12 · piyasa değerine göre')].join(' · ');
    drawCompTable();
    const others = [...extras, ...peers.filter((x) => x.code !== s)].map((x) => x.code);
    drawCompChart(s, [...new Set(others)].slice(0, 4), fresh);
  } catch (e) { if (fresh()) $('#compTable').innerHTML = `<tbody><tr><td class="dim">${esc(tx(e.message))}</td></tr></tbody>`; }
}
function drawCompTable() {
  const s = curSym, { k, dir } = compSort;
  const rows = [...compRows].sort((a, b) => {
    const x = a[k], y = b[k];
    if (typeof x === 'string' || typeof y === 'string') return String(x || '').localeCompare(String(y || ''), locale) * dir;
    if (!isNum(x) && !isNum(y)) return 0;
    if (!isNum(x)) return 1;
    if (!isNum(y)) return -1;
    return (x - y) * dir;
  });
  const med = medians(compRows);
  const medCell = (key, fmt) => (['pe', 'pb', 'evEbitda', 'evSales', 'ret1m', 'retYtd'].includes(key) ? fmt(med[key]) : '');
  $('#compTable').innerHTML = `<thead><tr>${COMP_COLS.map(([key, l], i) => `<th class="sortable ${i > 1 ? 'r' : ''} ${key === k ? 'sorted' : ''}" data-k="${key}">${l}${key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="click ${r.code === s ? 'kt-self' : ''}" data-s="${esc(r.code)}">${COMP_COLS.map(([key, , fmt], i) => (i === 0 ? `<td class="mono"><b>${esc(r.code)}</b></td>` : i === 1 ? `<td class="kt-name">${esc(r.name || '')}</td>` : `<td class="r num">${fmt(r[key])}</td>`)).join('')}<td class="r">${r.extra ? `<button class="kt-x" data-rm="${esc(r.code)}" title="${t('Karşılaştırmadan çıkar')}">×</button>` : ''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="2">${t('Medyan')}</td>${COMP_COLS.slice(2).map(([key, , fmt]) => `<td class="r num">${medCell(key, fmt)}</td>`).join('')}<td></td></tr></tfoot>`;
}
$('#compTable').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { e.stopPropagation(); compExtra = compExtra.filter((x) => x !== rm.dataset.rm); localSet('ktCompExtra', compExtra); ensure('comp', true); return; }
  const th = e.target.closest('th[data-k]');
  if (th) { const k = th.dataset.k; compSort = compSort.k === k ? { k, dir: -compSort.dir } : { k, dir: ['code', 'name'].includes(k) ? 1 : -1 }; drawCompTable(); return; }
  const r = e.target.closest('tr[data-s]');
  if (r) openSymbol(r.dataset.s, 'sum');
});
$('#compForm').onsubmit = (e) => {
  e.preventDefault();
  const add = $('#compAdd').value.split(/[,\s;]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9]{2,8}$/.test(x));
  $('#compAdd').value = '';
  if (!add.length) return;
  compExtra = [...new Set([...compExtra, ...add])].slice(0, 12);
  localSet('ktCompExtra', compExtra);
  ensure('comp', true);
};
$('#compClear').onclick = () => { compExtra = []; localSet('ktCompExtra', compExtra); ensure('comp', true); };
let compHist = null;
async function drawCompChart(s, others, fresh) {
  const syms = [s, ...others];
  $('#compChartNote').textContent = '';
  const res = await Promise.all(syms.map((x) => D.hist(x, '1y').then((d) => ({ s: x, bars: d.bars || [] })).catch(() => ({ s: x, bars: [] }))));
  if (!fresh()) return;
  compHist = res;
  paintCompChart();
}
function paintCompChart() {
  if (!compHist) return;
  const cols = [css('--accent'), css('--info'), css('--violet'), css('--up'), palette()[5]];
  const ds = compHist.filter((r) => r.bars.length > 1).map((r, i) => {
    const base = r.bars.find((b) => isNum(b.c) && b.c > 0)?.c;
    return { label: r.s, data: r.bars.filter((b) => isNum(b.c)).map((b) => ({ x: b.t, y: (b.c / base) * 100 })), borderColor: cols[i % cols.length], borderWidth: i === 0 ? 2.2 : 1.2, pointRadius: 0, tension: 0.1 };
  });
  const o = baseOptions({ legend: true });
  o.plugins.tooltip.callbacks.label = (c) => `${c.dataset.label}: ${num(c.parsed.y, 1)}`;
  makeChart($('#compChart'), { type: 'line', data: { datasets: ds }, options: o });
  const missing = compHist.filter((r) => r.bars.length <= 1).map((r) => r.s);
  $('#compChartNote').textContent = missing.length ? t('Fiyat geçmişi alınamadı: {s}', { s: missing.join(', ') }) : '';
}

// ── HİSSE TARAYICI ────────────────────────────────
async function runScreen(extra = {}) {
  const f = Object.fromEntries([...new FormData($('#scrForm'))].filter(([, v]) => v !== ''));
  Object.assign(f, extra);
  $('#scrTable').innerHTML = `<tbody><tr><td>${SKEL}</td></tr></tbody>`;
  try {
    const r = await api(`/screen?${new URLSearchParams(f)}`);
    $('#scrTable').innerHTML = `<thead><tr><th>${t('Sembol')}</th><th>${t('Ad')}</th><th class="c-sec">${t('Sektör')}</th><th class="r">${t('Kapanış')}</th><th class="r c-mcap" title="${t('Piyasa değeri, milyon ₺')}">${t('Piy. değeri (mn ₺)')}</th><th class="r">${t('F/K')}</th><th class="r">${t('PD/DD')}</th><th class="r">${t('FD/FAVÖK')}</th><th class="r">${t('YBB')}</th><th class="r">${t('1A')}</th></tr></thead><tbody>${r.items.map((x) => `<tr class="click" data-s="${esc(x.code)}" data-n="${esc(x.name)}">
      <td class="mono"><b>${esc(x.code)}</b></td><td class="kt-name">${esc(x.name)}</td><td class="muted c-sec">${esc(sectorName(x.sector))}</td><td class="r num">${price(x.close)}</td><td class="r num c-mcap">${num(x.mcapMnTL, 0)}</td>
      <td class="r num">${num(x.pe, 1)}</td><td class="r num">${num(x.pb, 2)}</td><td class="r num">${num(x.evEbitda, 1)}</td><td class="r num ${cls(x.retYtd)}">${pct(x.retYtd, 1)}</td><td class="r num ${cls(x.ret1m)}">${pct(x.ret1m, 1)}</td></tr>`).join('') || `<tr><td colspan="10" class="dim">${t('Koşullara uyan hisse yok')}</td></tr>`}</tbody>
      <tfoot><tr><td colspan="10" class="dim">${t('{n} hisse', { n: r.count })}${r.asOf ? ` · ${t('veriler: {d} (önceki kapanış)', { d: dateTR(r.asOf, true) })}` : ''}</td></tr></tfoot>`;
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
$('#scrTable').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) openSymbol(r.dataset.s, 'sum', r.dataset.n); });

// Sinyal radarı
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
  $('#radarChips').innerHTML = Object.entries(r.labels).filter(([k]) => r.counts[k]).map(([k, v]) => `<button class="pill ${v.dir === 'up' ? 'up' : v.dir === 'down' ? 'down' : ''} ${radarFilter === k ? 'kt-on' : ''}" data-k="${k}">${esc(tx(v.label))} · ${r.counts[k]}</button>`).join('');
  const rows = r.hits.filter((x) => !radarFilter || x.signals.includes(radarFilter)).sort((a, b) => watch.has(b.symbol) - watch.has(a.symbol));
  $('#radarTable').innerHTML = `<thead><tr><th>${t('Sembol')}</th><th class="r">${t('Fiyat')}</th><th class="r">${t('Gün %')}</th><th class="r">RSI</th><th class="r" title="${t('Hacim / 20 günlük ortalama hacim')}">${t('Hacim / ort.')}</th><th>${t('Sinyaller')}</th></tr></thead><tbody>${rows.map((x) => `<tr class="click" data-s="${esc(x.symbol)}">
    <td class="mono"><b>${esc(x.symbol)}</b>${watch.has(x.symbol) ? ` <span class="pill acc">${t('listede')}</span>` : ''}</td><td class="r num">${price(x.price)}</td><td class="r num ${cls(x.changePct)}">${pct(x.changePct)}</td>
    <td class="r num">${num(x.rsi, 0)}</td><td class="r num">${x.volRatio ? num(x.volRatio, 1) + '×' : '—'}</td>
    <td>${x.signals.map((k) => `<span class="pill ${r.labels[k].dir === 'up' ? 'up' : r.labels[k].dir === 'down' ? 'down' : ''}">${esc(tx(r.labels[k].label))}</span>`).join(' ')}</td></tr>`).join('') || `<tr><td class="dim">${t('Sinyal yok')}</td></tr>`}</tbody>`;
  $$('#radarChips [data-k]').forEach((b) => b.onclick = () => { radarFilter = radarFilter === b.dataset.k ? null : b.dataset.k; drawRadar(); });
}
$('#radarRun').onclick = loadRadar;
// Yeni sinyal bildirimleri (sunucu seans sonrası tarar; uygulama kapalıyken kaçırılanlar burada görünür)
async function loadSigRecent() {
  let rows = [];
  try { rows = await api('/signals/recent?days=14'); } catch { /* liste boş kalır */ }
  $('#sigRecent').innerHTML = rows.length
    ? `<div class="table-wrap kt-tall"><table class="t"><thead><tr><th>${t('Tarih')}</th><th>${t('Sembol')}</th><th>${t('Sinyal')}</th><th class="r">${t('Fiyat')}</th><th class="r">${t('Gün %')}</th></tr></thead><tbody>${rows.map((x) => `<tr class="click" data-s="${esc(x.symbol)}">
        <td class="dim">${dateTR(x.firedAt.replace(' ', 'T') + 'Z')}</td><td class="mono"><b>${esc(x.symbol)}</b></td>
        <td><span class="pill ${x.dir === 'up' ? 'up' : x.dir === 'down' ? 'down' : ''}">${esc(tx(x.label))}</span></td>
        <td class="r num">${price(x.price)}</td><td class="r num ${cls(x.changePct)}">${pct(x.changePct)}</td></tr>`).join('')}</tbody></table></div>`
    : t('Henüz bildirim yok. Yeni sinyaller seans kapandıktan sonra (18:30) taranır; ilk tarama yalnız başlangıç durumunu kaydeder.');
}
$('#sigRecent').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) openSymbol(r.dataset.s); });
on('signals:changed', loadSigRecent);
loadSigRecent();
initBacktest($('#backtestBox'));
$('#radarTable').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) openSymbol(r.dataset.s); });
$('#radarAsk').onclick = () => askAgent(t('signal_scan aracıyla BIST 100 sinyal taramasını çalıştır. İzleme listem ve portföyümdeki hisselerde çıkan sinyalleri öne alarak en dikkat çekici sinyalleri yorumla; hangi sinyallerin hacimle teyit edildiğini belirt.'));

// ── SEKTÖR HARİTASI · PİYASA ÖZETİ ─────────────────
function heatColor(p) {
  if (p == null) return 'var(--panel-2)';
  const a = Math.round((Math.min(Math.abs(p) / 4, 1) * 0.42 + 0.08) * 100);
  return `color-mix(in srgb, var(${p >= 0 ? '--up' : '--down'}) ${a}%, var(--panel))`;
}
let moversData = null;
function drawMovers() {
  const m = moversData;
  if (!m) return;
  const list = m[moversTab] || [];
  const html = `<thead><tr><th>${t('Sembol')}</th><th>${t('Ad')}</th><th class="r">${t('Fiyat')}</th><th class="r">${t('Değişim')}</th><th class="r">${t('İşlem hacmi (≈)')}</th></tr></thead><tbody>${list.map((x) => `<tr class="click" data-s="${esc(x.symbol)}"><td class="mono"><b>${esc(x.symbol)}</b></td><td class="kt-name">${esc(x.name)}</td><td class="r num">${price(x.price)}</td><td class="r num ${cls(x.changePct)}">${pct(x.changePct)}</td><td class="r num">${compact(x.turnover)}</td></tr>`).join('')}</tbody>`;
  const b = m.breadth, tot = b.up + b.down + b.flat || 1;
  const br = `<div class="kt-breadth-row"><span class="up">▲ ${t('{n} yükselen', { n: b.up })}</span><span class="dim">${t('{n} değişmeyen', { n: b.flat })} · ${t('{a}/{b} hisse', { a: m.priced, b: m.universe })} · ${timeTR(m.asOf)} (${t('~15 dk gecikmeli')})</span><span class="down">${t('{n} düşen', { n: b.down })} ▼</span></div>
    <div class="kt-breadth-bar"><i style="width:${(b.up / tot) * 100}%;background:var(--up)"></i><i style="width:${(b.flat / tot) * 100}%;background:var(--text-3)"></i><i style="width:${(b.down / tot) * 100}%;background:var(--down)"></i></div>`;
  $$('.kt-movers', root).forEach((el) => { el.innerHTML = html; });
  $$('.kt-breadth', root).forEach((el) => { el.innerHTML = br; });
  $('#sectors').innerHTML = (m.sectors || []).map((x) => `<div data-sec="${esc(x.sector)}" style="background:${heatColor(x.avgPct)}" title="${esc((x.members || []).join(', '))}"><b>${pct(x.avgPct)}</b>${esc(sectorName(x.sector))} <span class="dim">(${x.count})</span></div>`).join('');
}
async function loadMarket() {
  if (!moversData) $$('.kt-movers', root).forEach((el) => { el.innerHTML = `<tbody><tr><td>${SKEL}</td></tr></tbody>`; });
  const [m, idx] = await Promise.all([D.movers().catch((e) => ({ error: e })), D.indices().catch(() => [])]);
  if (m.error) $$('.kt-movers', root).forEach((el) => { el.innerHTML = `<tbody><tr><td class="dim">${esc(tx(m.error.message))}</td></tr></tbody>`; });
  else { moversData = m; drawMovers(); }
  const ih = idx.map((x) => `<div data-s="${esc(x.symbol)}" style="background:${heatColor(x.changePct)}"><b>${esc(tx(x.name || x.symbol))}</b>${price(x.price)} · ${pct(x.changePct)}</div>`).join('') || dimMsg(t('Veri yok'));
  $$('.kt-indices', root).forEach((el) => { el.innerHTML = ih; });
}
function renderMarketPage() { loadMarket(); loadCalendar(); loadEconNews(); }
root.addEventListener('click', (e) => {
  const mv = e.target.closest('.kt-movseg button');
  if (mv) { moversTab = mv.dataset.m; segActive(); drawMovers(); return; }
  const r = e.target.closest('.kt-movers [data-s], .kt-indices [data-s], #calendar [data-s]');
  if (r) { openSymbol(r.dataset.s); return; }
  const sc = e.target.closest('#sectors [data-sec]');
  if (sc) {
    const f = $('#scrForm');
    f.reset(); f.index.value = 'TUM'; f.sector.value = sc.dataset.sec;
    rendered.screen = '*';
    showPage('screen');
    runScreen();
  }
});
$('#calSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; calScope = b.dataset.c; localSet('calScope', calScope); segActive(); loadCalendar(); };

// ── TAKVİM sayfası: temettü + TCMB + bilanço, gün gün (GET /api/calendar) ───────────
const CAL_KIND_LBL = { temettu: t('Temettü'), sermaye: t('Sermaye artırımı'), tcmb: 'TCMB', tufe: 'TÜFE', bilanco: t('Bilanço') };
const CAL_GROUPS = [['son_gunler', t('Son günler')], ['bugun', t('Bugün')], ['yarin', t('Yarın')], ['hafta', t('Bu hafta')], ['tarih', t('Daha sonra')]];
const CAL_PERIOD = { 1: t('3 aylık'), 2: t('6 aylık'), 3: t('9 aylık'), 4: t('[dönem]yıllık') };
const isoPlus = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// Sunucudaki groupKey ile aynı kural (server/takvim.js); gün grubu istemcide, yanıttaki `today` ile hesaplanır
const calGroup = (date, today) => (date < today ? 'son_gunler' : date === today ? 'bugun' : date === isoPlus(today, 1) ? 'yarin' : date <= isoPlus(today, 6) ? 'hafta' : 'tarih');
const calWeekday = (date) => new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' });
function calText(e) {
  const d = e.data || {};
  const per = d.period ? `${d.year} ${CAL_PERIOD[d.period]}` : '';
  switch (e.type) {
    case 'temettu': return d.dps ? t('Nakit temettü · hisse başı brüt {v} ₺', { v: num(d.dps, 4) }) : t('Nakit temettü');
    case 'bedelsiz': return t('Bedelsiz sermaye artırımı %{v}', { v: num(d.pct, 2) });
    case 'bedelsiz_temettu': return t('Bedelsiz (temettüden) %{v}', { v: num(d.pct, 2) });
    case 'bedelli': return t('Bedelli sermaye artırımı %{v}', { v: num(d.pct, 2) });
    case 'ppk_karar': return t('TCMB PPK faiz kararı');
    case 'ppk_ozet': return t('TCMB PPK toplantı özeti');
    case 'enflasyon_raporu': return t('TCMB Enflasyon Raporu');
    case 'fin_istikrar': return t('TCMB Finansal İstikrar Raporu');
    case 'bilanco_aciklandi': return t('Bilanço açıkladı · {p}', { p: per });
    case 'bilanco_beklenen': return t('Bilanço bekleniyor · {p}', { p: per });
    case 'bilanco_son_teslim': return d.market ? t('Bilanço sezonu yasal son teslim · {p}', { p: per }) : t('Bilanço yasal son teslim · {p}', { p: per });
    case 'tufe': return d.period ? t('TÜFE açıklaması · {p}', { p: d.period }) : t('TÜFE açıklaması');
    default: return e.type;
  }
}
// KESİN / TAHMİNİ etiketinin ipucu: tahminin gerekçesi
function calTip(e) {
  const d = e.data || {};
  if (e.type === 'bilanco_beklenen') return t('Geçen yıl {a} tarihinde açıkladı; yasal son teslim {b}. Tahmindir.', { a: dateTR(d.lastYear), b: dateTR(d.deadline) });
  if (e.type === 'bilanco_son_teslim') return `${t('Dönem sonu + yasal süre (SPK II-14.1); hafta sonu veya tam gün resmî tatile denk gelirse sonraki iş günü.')}${d.assumed ? ` ${t('Konsolide süre varsayıldı.')}` : ''}`;
  return t('Resmî ya da ilan edilmiş tarih.');
}
let calPageSeq = 0; // eski yanıt yeni seçimi ezmesin
async function loadCalPage() {
  const body = $('#cpBody'), seq = ++calPageSeq;
  const fetchCal = (scope) => api(`/calendar?scope=${scope}&kinds=${enc(calKinds.join(','))}`);
  body.innerHTML = `<div class="dim"><span class="spinner"></span> ${t('yükleniyor…')}</div>`;
  let scope = calPageScope || 'portfolio', r;
  try {
    r = await fetchCal(scope);
    if (!calPageScope && r.emptyScope) { scope = 'watchlist'; r = await fetchCal(scope); } // hiç seçilmediyse: portföy boşsa liste
  } catch (e) { if (seq === calPageSeq) body.innerHTML = `<div class="dim">${esc(tx(e.message))}</div>`; return; }
  if (seq !== calPageSeq) return;
  lastCal = r;
  $$('#cpScope button').forEach((b) => b.classList.toggle('active', b.dataset.c === scope));
  $$('#cpKinds button').forEach((b) => b.classList.toggle('active', calKinds.includes(b.dataset.k)));
  const notes = [...r.stale.map((s) => t('{s} verisi eski (son başarılı kayıt)', { s: s.toUpperCase() })), ...r.warnings.map((w) => `${w.source.toUpperCase()}: ${tx(w.message)}`)];
  $('#cpWarn').hidden = !notes.length;
  $('#cpWarn').textContent = notes.join(' · ');
  if (!r.events.length) {
    body.innerHTML = `<div class="dim">${r.emptyScope ? (scope === 'portfolio' ? t('Portföy boş') : t('İzleme listesi boş')) : t('Bu kapsamda ve pencerede olay yok')}</div>`;
    return;
  }
  const mine = new Set(r.mine);
  body.innerHTML = CAL_GROUPS.map(([g, title]) => {
    const list = r.events.filter((e) => calGroup(e.date, r.today) === g);
    if (!list.length) return '';
    let prev = '';
    return `<div class="kt-mini-h" style="margin-top:10px">${title} · ${list.length}</div><div class="table-wrap kt-cal"><table class="t"><tbody>${list.map((e) => {
      const first = e.date !== prev; prev = e.date;
      return `<tr${e.symbol ? ` class="click" data-s="${esc(e.symbol)}"` : ''}>
        <td class="num" style="white-space:nowrap">${first ? `${dateTR(e.date)} <span class="dim">${esc(calWeekday(e.date))}</span>` : ''}</td>
        <td class="c-kind"><span class="pill">${esc(CAL_KIND_LBL[e.kind])}</span></td>
        <td class="mono">${e.symbol ? `<b>${esc(e.symbol)}</b>${scope === 'all' && mine.has(e.symbol) ? ` <span class="pill acc">${t('listede')}</span>` : ''}` : '<span class="dim">—</span>'}</td>
        <td class="kt-wrap">${esc(calText(e))}</td>
        <td class="r"><span class="pill ${e.certainty === 'kesin' ? 'up' : ''}" title="${esc(calTip(e))}">${e.certainty === 'kesin' ? t('KESİN') : t('TAHMİNİ')}</span></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }).join('');
}
$('#cpScope').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; calPageScope = b.dataset.c; localSet('calPageScope', calPageScope); loadCalPage(); };
$('#cpKinds').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const k = b.dataset.k;
  const next = calKinds.includes(k) ? calKinds.filter((x) => x !== k) : [...calKinds, k];
  if (!next.length) return; // en az bir tür açık kalır
  calKinds = CAL_KINDS.filter((x) => next.includes(x));
  localSet('calKinds', calKinds);
  loadCalPage();
};
$('#cpBody').addEventListener('click', (e) => { const r = e.target.closest('[data-s]'); if (r) openSymbol(r.dataset.s); });
let lastCal = null;
$('#cpIcs').onclick = () => {
  if (!lastCal) return;
  const body = toIcs(lastCal.events.map((e) => ({ ...e, summary: calText(e) })), lastCal.today);
  if (!body.includes('BEGIN:VEVENT')) { toast(t('Dışa aktarılacak ileri gün yok'), 'err'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  a.download = 'kmy-takvim.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#calAll').onclick = () => showPage('calendar');

// Temettü takvimi: ilan edilmiş, bugünden sonraki olaylar
async function loadCalendar() {
  let symbols = null;
  if (calScope === 'watchlist') symbols = state.watchlist;
  if (calScope === 'portfolio') symbols = (await api('/portfolio').catch(() => ({ holdings: [] }))).holdings.map((x) => x.symbol);
  if (symbols && !symbols.length) {
    $('#calendar').innerHTML = `<tbody><tr><td class="dim">${calScope === 'portfolio' ? t('Portföy boş') : t('İzleme listesi boş')}</td></tr></tbody>`;
    return;
  }
  const qs = symbols ? `&symbols=${enc(symbols.join(','))}` : '';
  try {
    const list = await api(`/corporate-actions?from=${today()}${qs}`);
    // Verim için fiyat gerekiyor; semboller izleme listesinde olmayabilir → tek toplu istek (satır başına istek yok)
    const miss = [...new Set(list.filter((a) => a.dpsGross && !state.quotes[a.code]?.price).map((a) => a.code))];
    if (miss.length) Object.assign(state.quotes, await api(`/quotes?symbols=${enc(miss.join(','))}`).catch(() => ({})));
    $('#calendar').innerHTML = list.length ? `<thead><tr><th>${t('Tarih')}</th><th>${t('Sembol')}</th><th>${t('Olay')}</th><th class="r">${t('Hisse başı brüt')}</th><th class="r">${t('Verim')}</th></tr></thead><tbody>${list.map((a) => {
      const q = state.quotes[a.code];
      const kind = [a.dpsGross > 0 ? t('Nakit temettü') : null, a.bonusPct > 0 ? t('Bedelsiz %{v}', { v: num(a.bonusPct, 2) }) : null, a.bonusDivPct > 0 ? `${t('Bedelsiz (temettüden)')} ${t('%{v}', { v: num(a.bonusDivPct, 2) })}` : null, a.rightsPct > 0 ? t('Bedelli %{v}', { v: num(a.rightsPct, 2) }) : null].filter(Boolean).join(' · ') || '—';
      const px = q?.price;
      return `<tr class="click" data-s="${esc(a.code)}"><td class="num">${dateTR(a.date)}</td><td class="mono"><b>${esc(a.code)}</b></td><td>${kind}</td><td class="r num">${a.dpsGross ? num(a.dpsGross, 4) + ' ₺' : '—'}</td><td class="r num">${a.dpsGross ? pct(px ? (a.dpsGross / px) * 100 : null, 2, false) : '—'}</td></tr>`;
    }).join('')}</tbody>` : `<tbody><tr><td class="dim">${calScope === 'all' ? t('İlan edilmiş yaklaşan olay yok') : t('Bu kapsamda ilan edilmiş yaklaşan temettü ya da sermaye artırımı yok')}</td></tr></tbody>`;
  } catch (e) { $('#calendar').innerHTML = `<tbody><tr><td class="dim">${esc(tx(e.message))}</td></tr></tbody>`; }
}

// Ekonomi haberleri (RSS)
async function loadEconNews() {
  const src = $('#newsSrc').value;
  try {
    const r = await api(`/newsfeed?limit=25${src ? `&sources=${src}` : ''}`);
    if ($('#newsSrc').options.length <= 1) $('#newsSrc').innerHTML += Object.entries(r.sources).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    $('#econNews').innerHTML = r.items.map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}<br><small>${esc(x.source)} · ${dateTR(x.time, true)}</small></a>`).join('') || dimMsg(t('Haberler alınamadı'));
  } catch (e) { $('#econNews').innerHTML = dimMsg(esc(tx(e.message))); }
}
$('#newsSrc').onchange = loadEconNews;

// ── Komut satırı ve klavye ─────────────────────────
const fold = (s) => String(s || '').toUpperCase().replace(/[İŞĞÜÖÇ]/g, (c) => ({ İ: 'I', Ş: 'S', Ğ: 'G', Ü: 'U', Ö: 'O', Ç: 'C' }[c]));
const ALIAS = {};
const alias = (pg, ...words) => words.forEach((w) => { ALIAS[w] = pg; });
alias('sum', '1', 'OZET', 'SUM', 'SUMMARY');
alias('fin', '2', 'FIN', 'FINANS', 'FINANCIALS');
alias('score', '3', 'SKOR', 'SCORE');
alias('value', '4', 'DEGER', 'VALUE', 'VAL');
alias('comp', '5', 'KARS', 'KARSILASTIR', 'COMP', 'COMPARE', 'PEERS');
alias('home', 'HOME', 'ANA', 'ANAEKRAN');
alias('screen', 'TARA', 'TARAYICI', 'SCREEN', 'SCREENER');
alias('sectors', 'SEKTOR', 'SEKTORLER', 'SECTORS', 'SECTOR');
alias('market', 'PIYASA', 'MARKET');
alias('calendar', 'TAKVIM', 'CAL', 'CALENDAR');
const HELP_WORDS = new Set(['HELP', 'YARDIM', '?']);
const isTicker = (s) => /^[A-Z0-9][A-Z0-9.=^-]{0,14}$/.test(s);
function exec(raw) {
  const parts = fold(raw).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return;
  const [a, b] = parts;
  if (HELP_WORDS.has(a)) { showHelp(); return; }
  const pa = ALIAS[a], pb = b ? ALIAS[b] : null;
  if (pa && !b) { showPage(pa); return; }
  if (pa && b && !pb && isTicker(b)) { openSymbol(b, SYM_PAGES.includes(pa) ? pa : 'sum'); return; }
  if (!pa && isTicker(a) && (!b || (pb && SYM_PAGES.includes(pb)))) { openSymbol(a, pb || 'sum'); return; }
  toast(t('Bilinmeyen komut: {c} · HELP yazın', { c: raw.trim() }), 'err');
}
function showHelp() {
  const L = lang === 'en';
  const rows = [
    ['THYAO', t('hisseyi ÖZET sayfasında açar')],
    [L ? 'THYAO FIN · SCORE · VALUE · COMP' : 'THYAO FIN · SKOR · DEGER · KARS', t('hisseyi o sayfada açar')],
    ['1 – 5', t('sembol sayfaları')],
    [L ? 'SCREEN · SECTORS · MARKET' : 'TARA · SEKTOR · PIYASA', t('tarayıcı, sektör haritası, piyasa özeti')],
    [L ? 'CALENDAR · CAL' : 'TAKVIM · CAL', t('yaklaşan temettü, TCMB ve bilanço günleri')],
    [L ? 'HOME' : 'ANA · HOME', t('ana ekran (Esc)')],
    ['/', t('komut satırına geçer')],
  ];
  $('#ktHelp').innerHTML = `<div class="kt-help-h">${t('KOMUTLAR')} <button class="kt-x" id="ktHelpX" aria-label="${t('Kapat')}">×</button></div>${rows.map(([c, d]) => `<div><b>${c}</b><span>${d}</span></div>`).join('')}`;
  $('#ktHelp').hidden = false;
  $('#ktHelpX').onclick = hideHelp;
}
function hideHelp() { $('#ktHelp').hidden = true; }
const cmd = $('#ktCmd');
const cmdHist = [];
let histIdx = -1;
cmd.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const v = cmd.value.trim();
    if (v && cmdHist[0] !== v) cmdHist.unshift(v);
    cmdHist.length = Math.min(cmdHist.length, 30);
    histIdx = -1; cmd.value = '';
    exec(v);
  } else if (e.key === 'ArrowUp') {
    if (cmdHist.length) { histIdx = Math.min(histIdx + 1, cmdHist.length - 1); cmd.value = cmdHist[histIdx]; e.preventDefault(); }
  } else if (e.key === 'ArrowDown') {
    histIdx = Math.max(histIdx - 1, -1); cmd.value = histIdx < 0 ? '' : cmdHist[histIdx]; e.preventDefault();
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    if (!$('#ktHelp').hidden) hideHelp(); else if (cmd.value) cmd.value = ''; else cmd.blur();
  }
});
const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const overlayOpen = () => $('#modalRoot')?.children.length || document.querySelector('.pal-back, .ctx-menu');
document.addEventListener('keydown', (e) => {
  if (!root.classList.contains('active') || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || e.isComposing) return;
  if (overlayOpen() || typing(e.target) || e.target.closest?.('.xterm')) return;
  if (e.key === '/') { e.preventDefault(); cmd.focus(); return; }
  if (/^[1-5]$/.test(e.key)) { e.preventDefault(); showPage(SYM_PAGES[Number(e.key) - 1]); return; }
  if (e.key === 'Escape') { if (!$('#ktHelp').hidden) hideHelp(); else showPage('home'); }
});

// ── Saat ve bağlantı ───────────────────────────────
const clockFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Istanbul' });
const dateFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' });
function tick() {
  if (document.hidden) return;
  const d = new Date(), tm = clockFmt.format(d);
  $('#ktClock').textContent = tm;
  $('#ktTime').textContent = `${dateFmt.format(d)} ${tm}`;
}
tick();
setInterval(tick, 1000);
on('conn', (ok) => {
  const el = $('#ktConn');
  el.className = `kt-conn ${ok ? 'ok' : 'bad'}`;
  el.textContent = ok ? `● ${t('BAĞLI')}` : `● ${t('BAĞLANTI YOK')}`;
});

// ── Uygulama olayları ──────────────────────────────
on('symbol', (s) => {
  const pg = pendingPage || (SYM_PAGES.includes(page) && page !== 'sum' ? page : 'sum');
  pendingPage = null;
  const changed = setSymbol(s);
  addRecent(s);
  renderCur();
  if (changed) body.scrollTop = 0;
  showPage(pg);
});
on('view:shown', (v) => {
  if (v !== 'market') return;
  ensure(page);
  requestAnimationFrame(() => resizeCharts(page));
});
on('quotes', (q) => { if (q[curSym]) { renderCur(); if (rendered.sum === curSym) renderHead(); } });
on('ready', () => { renderCur(); if (page === 'home') ensure('home', true); });
on('app:refresh', () => { renderCur(); reload(); });
on('settings', () => {
  if (lastHist) loadChart(); // ölçüt anahtarı değişmiş olabilir
  if (finData && rendered.fin === curSym) drawFinCharts(finData);
  if (compHist && rendered.comp === curSym) paintCompChart();
});
on('watchlist:loaded', debounce(() => { if (rendered.market && calScope !== 'all') loadCalendar(); }, 300));
setInterval(() => {
  if (!root.classList.contains('active') || document.hidden) return;
  if (page === 'sectors' || page === 'market') loadMarket();
}, 60_000);
setInterval(() => { if (page === 'market' && root.classList.contains('active') && !document.hidden) loadEconNews(); }, 10 * 60_000);

renderCur();
showPage('home');

// Uygulama girişi: yerleşim, üst bar, görünüm yönlendirme, genel kısayollar
import { state, on, emit, api, connect, wsCall, $, $$, h, esc, num, price, pct, cls, toast, modal, localGet, localSet, selectSymbol, debounce, ago, timeTR, askAgent, devReady } from './core.js';
import './watchlist.js';
import { openRoute, ktRoute } from './market-view.js';
import './portfolio-view.js';
import './terminal-view.js';
import './reports-view.js';
import './chat.js';
import './kap.js';
import './veri-sagligi.js';
import { openSettings } from './settings.js';
import './sihirbaz.js';
import './guncelleme.js';
import { onayIste } from './onay.js';
import { t, tx, lang, locale, translateDom, syncLangPref } from './i18n.js';

translateDom();
onayIste();

// ── Tema ve yazı boyutları ────────────────────────
// İmza rengi: ayardaki renkten tema uyumlu tonlar (grafik ve xterm de okuyabilsin diye düz renk olarak)
function hexRgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
const mix = (c, t, k) => c.map((v, i) => Math.round(v + (t[i] - v) * k));
const toHex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
function applyAccent(hex, light) {
  const c = hexRgb(hex) || [255, 159, 10];
  const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  const st = document.documentElement.style;
  // Açık temada metin olarak kullanılan ton koyulaştırılır (okunabilirlik); düğme zemini asıl renk kalır
  const text = light ? mix(c, [0, 0, 0], lum > 0.6 ? 0.42 : 0.18) : c;
  st.setProperty('--accent', toHex(text));
  st.setProperty('--accent-2', toHex(light ? mix(c, [0, 0, 0], 0.5) : mix(c, [255, 255, 255], 0.4)));
  st.setProperty('--accent-bg', toHex(c));
  st.setProperty('--accent-ink', lum > 0.55 ? '#1a1500' : '#ffffff');
  st.setProperty('--accent-soft', `rgba(${c.join(', ')}, ${light ? 0.18 : 0.12})`);
}
function applySettings(s) {
  state.settings = s;
  document.documentElement.dataset.theme = s.theme === 'light' ? 'light' : 'dark';
  applyAccent(s.accent || '#ff9f0a', s.theme === 'light');
  document.documentElement.style.setProperty('--chat-font', `${s.chatFontSize || 14}px`);
  syncLangPref(s.language);
  native({ type: 'lang', lang });
  emit('settings', s);
}

// ── Görünümler ───────────────────────────────────
// DASHBOARD sekmesi (view-agent): izleme listesi + asistan sohbeti + KAP; kabuk (xterm) istenince aynı sekmede açılır.
// kmy terminal ve Portföy sekmelerinde izleme listesi gizlenir, sohbet sağ panele taşınır (Asistan sohbeti sekmesi).
const VIEW_ALIAS = { terminal: 'agent', chat: 'agent', reports: 'agent' };
let curView = 'agent';
function placeChat(v) {
  const chat = $('#agentChat');
  const inRight = v !== 'agent';
  $('[data-rtab=chat]').hidden = !inRight;
  if (inRight && chat.parentElement.id !== 'rtab-chat') { $('#rtab-chat').append(chat); showRightTab('chat', { open: false }); }
  else if (!inRight && chat.parentElement.id === 'rtab-chat') {
    $('#agentTerm').before(chat);
    if ($('[data-rtab=chat]').classList.contains('active')) showRightTab(localGet('rtab', 'kap'), { open: false });
  }
  $('#layout').classList.toggle('no-left', inRight);
  emit('chat:moved');
}
function showView(v) {
  if (v === 'terminal') setAgentMode('terminal');
  else if (v === 'chat') setAgentMode('chat');
  if (v === 'reports') { showRightTab('reports'); return; }
  v = VIEW_ALIAS[v] || v;
  if (!['agent', 'market', 'portfolio'].includes(v)) v = 'agent';
  $$('.viewbar [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  // Sekme durumu ekran okuyucuya: index.html'de statik durum doğru, sekme değişince güncellenmeli.
  $$('.viewbar [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${v}`));
  curView = v;
  placeChat(v);
  localSet('view', v);
  emit('view:shown', v);
  document.body.classList.remove('left-open', 'right-open');
  $('#backdrop').hidden = true;
  writeHash();
}
on('view', showView);
$$('.viewbar [data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ── Hash yönlendirme (kalıcı bağlantı) ─────────────
// #/sohbet · #/pazar/THYAO · #/pazar/THYAO/skor · #/pazar/THYAO/ozet/fiyat · #/portfoy/risk
const VIEW_SLUG = { agent: 'sohbet', market: 'pazar', portfolio: 'portfoy' };
const PAGE_SLUG = { home: '', sum: '', fin: 'finans', score: 'skor', value: 'deger', comp: 'kars', screen: 'tara', sectors: 'sektorler', market: 'piyasa', calendar: 'takvim' }; // sum sayfası yalnız sembol + /ozet/<alt sekme> ile yazılır
const SUM_SLUG = { px: 'fiyat', news: 'haber', docs: 'belge' };
const PG_FROM = { finans: 'fin', skor: 'score', deger: 'value', kars: 'comp', tara: 'screen', sektorler: 'sectors', piyasa: 'market', takvim: 'calendar' };
const SUM_FROM = { fiyat: 'px', haber: 'news', belge: 'docs' };
const SYM_PAGE = { sum: 1, fin: 1, score: 1, value: 1, comp: 1 }; // sembol gerektiren kmy terminal sayfaları
const pfTab = () => $('#view-portfolio .subtabs button.active')?.dataset.t || 'ozet';
const pfTabs = [...document.querySelectorAll('#view-portfolio .subtabs [data-t]')].map((b) => b.dataset.t);
// Yazma ve geri yükleme ayrı yönlüdür: pushState hashchange tetiklemez, geri/ileri popstate ile gelir.
// Yazma bir olay turunda birleştirilir (mikrotask) ve canonical hash zaten geri yükleme sonrası
// replaceState ile ayarlandığı için aynı değer ikinci kez yazılmaz.
let hashQueued = false, lastHash = '';
function curHash() {
  const v = curView;
  let h = `#/${VIEW_SLUG[v] || 'sohbet'}`;
  if (v === 'portfolio') h += `/${pfTab()}`;
  if (v === 'market') {
    const r = ktRoute();
    if (r.page === 'sum') h += `/${r.sym}`;
    else if (SYM_PAGE[r.page]) h += `/${r.sym}/${PAGE_SLUG[r.page] || r.page}`;
    else if (r.page !== 'home') h += `/${PAGE_SLUG[r.page] || r.page}`;
    if (r.page === 'sum') h += `/ozet/${SUM_SLUG[r.tab] || 'fiyat'}`;
  }
  return h;
}
// Aynı olay turunda birden çok geçiş olabilir (sembol + sekme); yalnız son durum yazılır
function writeHash() {
  if (hashQueued) return;
  hashQueued = true;
  queueMicrotask(() => {
    hashQueued = false;
    const h = curHash();
    if (location.hash === h) return;
    lastHash = h;
    history[location.hash ? 'pushState' : 'replaceState'](null, '', h);
  });
}
// hash geri yükleme: bilinmeyen parçalar yok sayılır, sonuç canonical hash ile değiştirilir
function applyHash() {
  const h = location.hash;
  if (!h || h === lastHash) return;
  lastHash = h;
  const p = decodeURIComponent(h.replace(/^#\/?/, '')).split('/').filter(Boolean);
  if (!p.length) return;
  if (p[0] === 'pazar' || p[0] === 'market') {
    // p[1] bir sayfa kısaltmasıysa sembol değildir (tara · sektorler · piyasa · ozet · skor …)
    const sym = p[1] && !PG_FROM[p[1]] && p[1] !== 'ozet' && /^[A-Z0-9.^=-]{1,15}$/i.test(p[1]) ? p[1].toUpperCase() : '';
    const rest = sym ? p.slice(2) : p.slice(1);
    const page = rest[0] ? (PG_FROM[rest[0]] || (rest[0] === 'ozet' ? 'sum' : 'home')) : (sym ? 'sum' : 'home');
    const tab = page === 'sum' ? SUM_FROM[rest[1]] || null : null;
    showView('market');
    if (sym) openRoute({ sym, pg: page, tab });
    else openRoute({ pg: page });
  } else if (p[0] === 'portfoy' || p[0] === 'portfolio') {
    showView('portfolio');
    const tb = p[1];
    if (tb && pfTabs.includes(tb) && tb !== pfTab()) $(`#view-portfolio .subtabs [data-t="${tb}"]`)?.click();
  } else showView('agent');
  // showView/openRoute yazmaları bu satırdan sonra mikrotask'ta çalışır; canonical hash önce ayarlanır
  const canon = curHash();
  if (location.hash !== canon) { lastHash = canon; history.replaceState(null, '', canon); }
}
addEventListener('hashchange', applyHash);
addEventListener('popstate', applyHash);
on('kt:page', writeHash);
on('pf:tab', writeHash);
on('symbol', writeHash);

let agentMode = 'chat';
function setAgentMode(m) {
  agentMode = m === 'terminal' ? 'terminal' : 'chat';
  $$('#agentMode [data-m]').forEach((b) => b.classList.toggle('active', b.dataset.m === agentMode));
  $('#agentChat').classList.toggle('active', agentMode === 'chat');
  $('#agentTerm').classList.toggle('active', agentMode === 'terminal');
  emit('agent:mode', agentMode);
}
$('#agentMode').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) setAgentMode(b.dataset.m); };
on('agent:mode:set', setAgentMode);

// Sağ panel sekmeleri
export function showRightTab(tab, { open = true } = {}) {
  if (!['kap', 'reports', 'pdf', 'chat'].includes(tab)) tab = 'kap';
  if (tab === 'chat' && $('[data-rtab=chat]').hidden) tab = 'kap';
  if (tab === 'pdf' && $('[data-rtab=pdf]').hidden) tab = 'reports'; // PDF sekmesi yalnız bir rapor açıkken var
  $$('.right-tabs [data-rtab]').forEach((b) => b.classList.toggle('active', b.dataset.rtab === tab));
  // Sağ panel sekmeleri için aynı durum güncellemesi.
  $$('.right-tabs [data-rtab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.rtab === tab)));
  $$('.rtab').forEach((el) => el.classList.toggle('active', el.id === `rtab-${tab}`));
  if (tab !== 'chat') localSet('rtab', tab);
  emit('rtab:shown', tab);
  if (!open) return;
  if (matchMedia('(max-width: 860px)').matches) openPanel('right');
  if ($('#layout').classList.contains('no-right')) toggleRight(true);
}
on('rtab', showRightTab);
$$('.right-tabs [data-rtab]').forEach((b) => b.addEventListener('click', () => showRightTab(b.dataset.rtab)));

function toggleRight(force) {
  const hide = force === undefined ? !$('#layout').classList.contains('no-right') : !force;
  $('#layout').classList.toggle('no-right', hide);
  const tb = $('#btnToggleRight'), label = hide ? t('Sağ paneli göster') : t('Sağ paneli gizle');
  tb.classList.toggle('off', hide); tb.title = label; tb.setAttribute('aria-label', label);
  const sh = $('#splitHandle'); sh.textContent = hide ? '«' : '»'; sh.title = label; sh.setAttribute('aria-label', label);
  localSet('rightHidden', hide);
  window.dispatchEvent(new Event('resize'));
}
$('#btnToggleRight').onclick = () => toggleRight();
$('#splitHandle').addEventListener('pointerdown', (e) => e.stopPropagation());
$('#splitHandle').onclick = () => toggleRight();
on('ws:inbox.imported', (m) => toast(t('Kurum raporu arşive eklendi: {items}', { items: m.items.map((x) => `${x.broker} · ${x.title}`).join(', ').slice(0, 160) }), 'ok', 8000));

// Masaüstüne uygulama olarak kurma (Chrome / Edge; tarayıcı kurulabilir olduğunu bildirince görünür)
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('#btnInstall').hidden = false; });
window.addEventListener('appinstalled', () => { installPrompt = null; $('#btnInstall').hidden = true; toast(t('Uygulama kuruldu'), 'ok'); });
$('#btnInstall').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice.catch(() => ({}));
  if (outcome === 'accepted') $('#btnInstall').hidden = true;
  installPrompt = null;
};

// Dar ekran çekmeceleri (ESC ve arka plan dokunuşu kapatır)
const closePanels = () => { document.body.classList.remove('left-open', 'right-open'); $('#backdrop').hidden = true; };
function openPanel(side) {
  document.body.classList.add(`${side}-open`);
  $('#backdrop').hidden = false;
}
$('#btnLeft').onclick = () => openPanel('left');
$('#btnRight').onclick = () => openPanel('right');
$('#btnRightClose').onclick = closePanels;
$('#backdrop').onclick = closePanels;
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (!document.body.classList.contains('left-open') && !document.body.classList.contains('right-open')) return;
  e.stopPropagation();
  closePanels();
});

// Sürüklenebilir ayırıcılar
$$('.splitter').forEach((sp) => {
  sp.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sp.classList.add('drag');
    const side = sp.dataset.split;
    const move = (ev) => {
      if (side === 'left') document.documentElement.style.setProperty('--left-w', `${Math.min(Math.max(ev.clientX, 180), 480)}px`);
      else document.documentElement.style.setProperty('--right-w', `${Math.min(Math.max(window.innerWidth - ev.clientX, 300), window.innerWidth * 0.7)}px`);
      window.dispatchEvent(new Event('resize'));
    };
    const up = () => {
      sp.classList.remove('drag');
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      localSet('widths', { left: getComputedStyle(document.documentElement).getPropertyValue('--left-w'), right: getComputedStyle(document.documentElement).getPropertyValue('--right-w') });
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
});

// ── Üst bar: şerit, saat, seans, bağlantı ─────────
const TICKER = ['XU100', 'XU030', 'XBANK', 'USDTRY', 'EURTRY', 'GBPTRY', 'CHFTRY', 'GRAM', 'ONS', 'BRENT', 'BTC', 'SPX'];
const TICK_NAMES = { XU100: 'XU100', XU030: 'XU030', XBANK: 'XBANK', USDTRY: 'USD/TL', EURTRY: 'EUR/TL', GBPTRY: 'GBP/TL', CHFTRY: 'CHF/TL', GRAM: t('Gram altın'), ONS: t('Ons altın'), BRENT: 'Brent', BTC: 'BTC', SPX: 'S&P 500' };
// Piyasa şeridi: sabit hücreler (ad üstte, değer ve değişim altta); sığmayanlar gizlenir
function renderTicker() {
  $('#ticker').innerHTML = TICKER.map((s) => {
    const q = state.quotes[s];
    const tip = q ? `${tx(q.name)} · ${q.source || ''}${q.delayed ? ` · ${t('yaklaşık 15 dk gecikmeli')}` : ''} · ${timeTR(q.time)}` : s;
    return `<div class="tick" data-s="${s}" title="${esc(tip)}"><span class="n">${TICK_NAMES[s] || s}</span><span class="v">${q ? price(q.price) : '…'}</span><span class="c ${cls(q?.changePct)}">${q ? pct(q.changePct) : ''}</span></div>`;
  }).join('');
  fitTicker();
}
// Sığmayan hücreleri sağdan gizle (yarım kesilmiş fiyat göstermesin)
function fitTicker() {
  const el = $('#ticker'), bar = el.parentElement;
  const cells = [...el.children];
  cells.forEach((c) => { c.style.display = ''; });
  if (!bar.clientWidth) return;
  // Hücreler daralabilir; içerik hücre sınırını aşıyorsa komşuya binmesin diye sağdan gizle
  const spill = (c) => { const r = c.getBoundingClientRect().right; return [...c.children].some((k) => k.getBoundingClientRect().right > r + 0.5); };
  for (let i = cells.length - 1; i >= 0 && (el.scrollWidth > bar.clientWidth || cells.some((c) => c.style.display !== 'none' && spill(c))); i--) cells[i].style.display = 'none';
}
addEventListener('resize', fitTicker);
$('#ticker').addEventListener('click', (e) => { const t = e.target.closest('.tick'); if (t) selectSymbol(t.dataset.s); });

// Fiyat tazeliği: akış durursa (ağ kesintisi, veri kaynağı hatası) saat narinleşir.
// Sol panel yalnız Dashboard'da göründüğü için rozet alt durum çubuğunda durur (her sekmede görünür).
let lastQuoteAt = Date.now(); // açılışta özet REST'ten geldi; akış hiç başlamasa da bayat sayılabilmeli
const staleAfter = () => Math.max(60, (Number(state.settings.quoteRefreshSec) || 15) * 4) * 1000;
const quoteTime = () => {
  const hm = new Date().toLocaleTimeString(locale, { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
  $('#wlTime').textContent = t('Son: {time}', { time: hm });
  const el = $('#quoteFresh');
  el.textContent = t('Fiyat {time}', { time: hm });
  el.classList.remove('stale');
};
on('ws:quotes', (m) => { lastQuoteAt = Date.now(); Object.assign(state.quotes, m.quotes); renderTicker(); quoteTime(); emit('quotes', m.quotes); });
setInterval(() => {
  const el = $('#quoteFresh');
  el.classList.toggle('stale', !!lastQuoteAt && Date.now() - lastQuoteAt > staleAfter());
  el.title = el.classList.contains('stale') ? t('Fiyat akışı {n} saniyedir güncellenmedi', { n: Math.round((Date.now() - lastQuoteAt) / 1000) }) : t('Fiyat akışının son güncellemesi');
}, 5000);

function renderMarket(ms) {
  if (!ms) return;
  state.market = ms;
  const el = $('#mktStatus');
  el.textContent = tx(ms.label);
  el.classList.toggle('open', !!ms.open);
}
on('ws:market', (m) => renderMarket(m.market));
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString(locale, { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }, 1000);

on('conn', (ok) => {
  $('#conn').classList.toggle('ok', ok);
  $('#conn').title = ok ? t('Sunucuya bağlı') : t('Bağlantı koptu, yeniden deneniyor…');
  $('#gwText').textContent = ok ? t('Gateway aktif') : t('Bağlantı yok');
  $('#gwStatus').classList.toggle('off', !ok);
});
const statusInfo = (v) => { $('#sbInfo').textContent = t('kmy terminal v{v} · Veri: KAP, Yahoo Finance, TCMB, İş Yatırım', { v: v || '' }); };
on('ws:hello', (m) => {
  statusInfo(m.version);
  applySettings(m.settings);
  renderMarket(m.market);
  state.jobs = m.jobs; renderJobs();
  emit('hello', m);
});
on('ws:settings', (m) => applySettings(m.settings));

// ── Arka plan işleri çipi ────────────────────────
function renderJobs() {
  const n = state.jobs.length;
  $('#chipJobs').classList.toggle('on', n > 0);
  $('#chipJobsText').textContent = n ? t('{n} arka plan işi · {time}', { n, time: ago(Math.min(...state.jobs.map((j) => j.startedAt))) }) : t('Arka plan işi yok');
  if (renderJobs.last !== n) { renderJobs.last = n; native({ type: 'badge', text: n ? String(n) : '' }); }
}
on('ws:jobs', (m) => { state.jobs = m.jobs; renderJobs(); emit('jobs', m.jobs); });
setInterval(renderJobs, 1000);
$('#chipJobs').onclick = () => {
  const m = modal({ title: t('Arka plan işleri'), body: '' });
  const draw = () => {
    m.body.innerHTML = state.jobs.length ? state.jobs.map((j) => `<div class="card" style="margin-bottom:8px"><div class="row between"><b>${esc(j.title || t('Oturum'))}</b><span class="mono dim">${ago(j.startedAt)}</span></div>
      <div class="muted">${esc(tx(j.activity || ''))}</div>${j.subagents?.length ? `<div class="dim" style="font-size:11px">${esc(t('{n} alt asistan çalışıyor', { n: j.subagents.length }))}</div>` : ''}
      <div class="row" style="margin-top:6px"><button class="btn sec" data-open="${j.id}">${t('Aç')}</button><button class="btn danger" data-stop="${j.id}">${t('Durdur')}</button></div></div>`).join('') : `<div class="empty">${t('Şu an çalışan iş yok')}</div>`;
    $$('[data-open]', m.body).forEach((b) => b.onclick = () => { emit('agent:open', b.dataset.open); m.close(); });
    $$('[data-stop]', m.body).forEach((b) => b.onclick = () => wsCall({ t: 'chat.stop', sessionId: b.dataset.stop }));
  };
  draw();
  const off = on('jobs', draw);
  const iv = setInterval(draw, 1000);
  const obs = new MutationObserver(() => { if (!m.el.isConnected) { off(); clearInterval(iv); obs.disconnect(); } });
  obs.observe($('#modalRoot'), { childList: true });
};

// ── Sembol paleti (⌘K) ───────────────────────────
const TYPE_TR = { equity: t('Hisse'), index: t('Endeks'), fx: t('Döviz'), currency: t('Döviz'), commodity: t('Emtia'), etf: 'ETF', mutualfund: t('Fon'), fund: t('Fon'), cryptocurrency: t('Kripto'), crypto: t('Kripto'), future: t('Vadeli'), gold: t('Altın') };
const isLocal = (r) => ['BIST', 'Döviz', 'Borsa İstanbul', 'Serbest piyasa'].includes(r.exchange) || !/[.-]/.test(r.symbol);
// ── Komut paleti (⌘K sonra ">") ───────────────────
// Komut listesi burada tanımlıdır; ⌘K > yazınca sembol yerine bu satırlar listelenir.
const PAL_COMMANDS = [
  { label: t('Portföy değerlendirmesi'), keys: 'portfoy degerlendir', run: () => { showView('agent'); askAgent(t('Portföyümü değerlendir: performans, risk metrikleri, yoğunlaşma, en güçlü ve en zayıf pozisyonlar. Kısa ve maddeli.')); } },
  { label: t('BIST taraması: F/K ≤ 8'), keys: 'tarama fk', run: () => { showView('market'); openRoute({ pg: 'screen' }); $('#scrPresets [data-p="value"]')?.click(); } },
  { label: t('Günün piyasa özeti'), keys: 'piyasa ozet', run: () => { showView('market'); openRoute({ pg: 'market' }); } },
  { label: t('Portföy risk sekmesi'), keys: 'portfoy risk', run: () => { showView('portfolio'); $('#view-portfolio .subtabs [data-t="risk"]')?.click(); } },
  { label: t('KAP taraması'), keys: 'kap', run: () => { showView('agent'); showRightTab('kap'); } },
  { label: t('Sembol ekle'), keys: 'sembol ekle', run: () => { openPanel('left'); $('#wlAddInput')?.focus(); } },
  { label: t('Yenile'), keys: 'yenile', run: () => location.reload() },
  { label: t('Tema değiştir'), keys: 'tema', run: () => openSettings('gorunum') },
  { label: t('Sekme: Sohbet'), keys: 'sohbet', run: () => showView('agent') },
  { label: t('Sekme: Piyasa'), keys: 'pazar piyasa terminal', run: () => showView('market') },
  { label: t('Sekme: Portföy'), keys: 'portfoy', run: () => showView('portfolio') },
  { label: t('Yeni ajan oturumu'), keys: 'yeni oturum', run: () => { showView('agent'); emit('chat:new'); } },
  { label: t('Sağ panel aç/kapat'), keys: 'sag panel', run: () => toggleRight() },
];
const cmdHit = (c, q) => !q || `${c.label} ${c.keys}`.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'));
const cmdRows = (q) => PAL_COMMANDS.filter((c) => cmdHit(c, q));
const isCmd = (s) => s.trim().startsWith('>');
let palEl = null;
function openPalette() {
  if (palEl) { palEl.close(); return; }
  const back = h(`<div class="pal-back"><div class="pal" role="dialog" aria-modal="true" aria-label="${t('Sembol ara')}">
    <div class="pal-in"><svg class="pal-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg><input placeholder="${t('Hisse, endeks, döviz veya şirket ara… (komut için > yazın)')}" aria-label="${t('Sembol ara')}" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div>
    <div class="pal-res" role="listbox"></div>
    <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${t('gezin')}</span><span><kbd>↵</kbd> ${t('aç')}</span><span><kbd>esc</kbd> ${t('kapat')}</span></div></div></div>`);
  const input = $('input', back), res = $('.pal-res', back);
  let rows = [], sel = 0, tok = 0;
  const close = () => { back.remove(); palEl = null; document.removeEventListener('keydown', onKey, true); };
  palEl = { close };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  const mark = (t, q) => { const x = esc(t || ''); if (!q) return x; const i = (t || '').toLocaleLowerCase('tr').indexOf(q.toLocaleLowerCase('tr')); return i < 0 ? x : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`; };
  const row = (r, i, q) => {
    if (r.run) return `<button class="pal-row ${i === sel ? 'sel' : ''}" data-i="${i}" role="option">
      <span class="pal-sym">${mark(r.label, q)}</span><span class="pal-name">${esc(r.keys)}</span><span class="pal-tag">${t('Komut')}</span></button>`;
    const qt = state.quotes[r.symbol];
    return `<button class="pal-row ${i === sel ? 'sel' : ''}" data-i="${i}" role="option">
      <span class="pal-sym">${mark(r.symbol, q)}</span>
      <span class="pal-name">${mark(tx(r.name || ''), q)}${r.sector ? `<small>${esc(tx(r.sector))}</small>` : ''}</span>
      ${qt ? `<span class="pal-px"><b>${price(qt.price)}</b><i class="${cls(qt.changePct)}">${pct(qt.changePct)}</i></span>` : ''}
      <span class="pal-tag">${esc(TYPE_TR[r.type] || r.type || '')}${r.exchange && !isLocal(r) ? ` · ${esc(r.exchange)}` : ''}</span></button>`;
  };
  const draw = (groups, q = '') => {
    rows = groups.flatMap(([, items]) => items);
    sel = Math.min(sel, Math.max(rows.length - 1, 0));
    let i = 0;
    res.innerHTML = groups.filter(([, items]) => items.length).map(([title, items]) => `<div class="pal-grp">${esc(title)}</div>${items.map((r) => row(r, i++, q)).join('')}`).join('')
      || `<div class="pal-empty">${q ? esc(t('“{q}” için sonuç yok. Enter ile doğrudan açabilirsiniz.', { q })) : t('Aramak için yazmaya başlayın')}</div>`;
    $('.pal-row.sel', res)?.scrollIntoView({ block: 'nearest' });
  };
  // Komut modu: "> " ile yazılır; komutlar ilk grupta, arama geçmişi korunur
  const cmdraw = () => { const cq = input.value.trim().slice(1).trim(); sel = 0; res.classList.remove('busy'); draw([[t('Komutlar'), cmdRows(cq)]], cq); };
  const recent = () => localGet('palRecent', []);
  const home = () => {
    if (isCmd(input.value)) return cmdraw();
    const nm = (s) => ({ symbol: s, name: tx(state.quotes[s]?.name || ''), type: state.quotes[s]?.type });
    const rec = recent().slice(0, 5);
    draw([[t('Komutlar'), cmdRows('')], [t('Son arananlar'), rec], [t('İzleme listesi'), (state.watchlist || []).filter((s) => !rec.some((r) => r.symbol === s)).slice(0, 8).map(nm)]]);
  };
  const pick = (r) => {
    if (r?.run) { close(); r.run(); return; }
    if (!r?.symbol) return;
    localSet('palRecent', [{ symbol: r.symbol, name: r.name || '', type: r.type }, ...recent().filter((x) => x.symbol !== r.symbol)].slice(0, 8));
    openRoute({ sym: r.symbol, pg: 'sum' }); showView('market'); close();
  };
  const search = debounce(async () => {
    const q = input.value.trim();
    if (!q) { sel = 0; home(); return; }
    if (isCmd(q)) return cmdraw();
    const my = ++tok;
    res.classList.add('busy');
    const items = await api(`/search?q=${encodeURIComponent(q)}`).catch(() => []);
    if (my !== tok || !palEl) return;
    res.classList.remove('busy');
    sel = 0;
    draw([[t('Borsa İstanbul ve döviz'), items.filter(isLocal)], [t('Diğer piyasalar'), items.filter((r) => !isLocal(r)).slice(0, 8)]], q);
  }, 180);
  input.addEventListener('input', search);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, rows.length - 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (isCmd(input.value) && !rows[sel]) return; // komut modunda eşleşme yoksa bir şey açma
      pick(rows[sel] || { symbol: input.value.trim().toUpperCase() });
      return;
    }
    else return;
    $$('.pal-row', res).forEach((b) => b.classList.toggle('sel', Number(b.dataset.i) === sel));
    $('.pal-row.sel', res)?.scrollIntoView({ block: 'nearest' });
  });
  res.addEventListener('mousemove', (e) => { const b = e.target.closest('.pal-row'); if (b && Number(b.dataset.i) !== sel) { sel = Number(b.dataset.i); $$('.pal-row', res).forEach((x) => x.classList.toggle('sel', x === b)); } });
  res.addEventListener('click', (e) => { const b = e.target.closest('.pal-row'); if (b) pick(rows[b.dataset.i]); });
  $('#modalRoot').append(back);
  home();
  setTimeout(() => input.focus(), 10);
}
$('#btnPalette').onclick = openPalette;
$('#btnSettings').onclick = () => openSettings();
on('settings:open', (sec) => openSettings(sec || 'genel'));
// macOS uygulaması (WKWebView) menüleri bu kancaları çağırır; tarayıcıda zararsız
// ⌘ (Ctrl) basılı tutulunca kısayolu olan sekmelerde numara rozeti görünür
const keyHints = (on) => document.body.classList.toggle('show-keys', on);
document.addEventListener('keydown', (e) => { if (e.key === 'Meta' || e.key === 'Control') keyHints(true); else if (!e.metaKey && !e.ctrlKey) keyHints(false); });
document.addEventListener('keyup', (e) => { if (e.key === 'Meta' || e.key === 'Control' || (!e.metaKey && !e.ctrlKey)) keyHints(false); });
addEventListener('blur', () => keyHints(false));
document.addEventListener('visibilitychange', () => keyHints(false));

window.borsaApp = {
  view: (v) => showView(v), settings: (sec) => openSettings(sec), palette: () => openPalette(),
  newSession: () => { showView('agent'); emit('chat:new'); }, toggleRight: () => toggleRight(),
};
export const native = (msg) => { try { window.webkit?.messageHandlers?.borsa?.postMessage(msg); } catch { /* tarayıcı */ } };
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  if ((e.metaKey || e.ctrlKey) && /^[1-3]$/.test(e.key) && !e.shiftKey) {
    e.preventDefault();
    showView(['agent', 'market', 'portfolio'][Number(e.key) - 1]);
  }
  // ⌘\ sağ paneli aç/kapat (macOS menüsünde de tanımlı); ⇧⌘\ KAP ↔ Raporlar
  if ((e.metaKey || e.ctrlKey) && (e.key === '\\' || e.code === 'Backslash')) {
    e.preventDefault();
    const cur = $('.right-tabs button.active')?.dataset.rtab;
    if (e.shiftKey) showRightTab(cur === 'reports' ? 'kap' : 'reports');
    else toggleRight();
  }
});

// ── Başlangıç ─────────────────────────────────────
// Piyasa özeti (overview) soğuk açılışta saniyeler sürebilir; sohbet, WebSocket,
// izleme listesi ve fiyat şeridi onu beklemez. ready yalnız meta+settings'e bağlıdır.
(async () => {
  const w = localGet('widths', null);
  if (w?.left) document.documentElement.style.setProperty('--left-w', w.left);
  if (w?.right) document.documentElement.style.setProperty('--right-w', w.right);
  if (localGet('rightHidden', false)) toggleRight(false);
  const ovP = api('/market/overview');
  try {
    const [meta, settings] = await Promise.all([api('/meta'), api('/settings')]);
    state.meta = meta;
    applySettings(settings);
    setAgentMode(settings.uiMode === 'terminal' ? 'terminal' : 'chat');
    renderTicker(); // boş fiyatlarla '…' basar, özeti beklemez
    quoteTime();
    emit('ready');
  } catch (e) {
    toast(t('Sunucuya ulaşılamadı: {e}', { e: e.message }), 'err');
  }
  connect();
  devReady();   // canlı yenidenleme sonrası yazma kutusu taslağı ve kaydırma geri gelir
  showRightTab(localGet('rtab', 'kap'), { open: false });
  if (location.hash) applyHash(); else showView('agent');
  // Özet gelince yalnız özete bağlı parçalar tazelenir
  await ovP.then((overview) => {
    const q = Object.fromEntries(overview.items.map((x) => [x.symbol, x]));
    Object.assign(state.quotes, q);
    lastQuoteAt = Date.now();
    renderMarket(overview.status);
    renderTicker();
    quoteTime();
    emit('quotes', q);
  }).catch((e) => toast(t('Piyasa özeti alınamadı: {e}', { e: e.message }), 'err'));
})();

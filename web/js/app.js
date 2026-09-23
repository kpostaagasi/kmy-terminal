// Uygulama girişi: yerleşim, üst bar, görünüm yönlendirme, genel kısayollar
import { state, on, emit, api, connect, wsCall, $, $$, h, esc, num, price, pct, cls, toast, modal, localGet, localSet, selectSymbol, debounce, ago, timeTR } from './core.js';
import './watchlist.js';
import './market-view.js';
import './portfolio-view.js';
import './terminal-view.js';
import './reports-view.js';
import './chat.js';
import './kap.js';
import { openSettings } from './settings.js';

// ── Tema ve yazı boyutları ────────────────────────
// İmza rengi: ayardaki renkten tema uyumlu tonlar (grafik ve xterm de okuyabilsin diye düz renk olarak)
function hexRgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
const mix = (c, t, k) => c.map((v, i) => Math.round(v + (t[i] - v) * k));
const toHex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
function applyAccent(hex, light) {
  const c = hexRgb(hex) || [250, 204, 21];
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
  applyAccent(s.accent || '#facc15', s.theme === 'light');
  document.documentElement.style.setProperty('--chat-font', `${s.chatFontSize || 14}px`);
  emit('settings', s);
}

// ── Görünümler ───────────────────────────────────
// TERMINAL sekmesi (view-agent) ajan sohbetiyle açılır; kabuk (xterm) istenince aynı sekmede açılır
const VIEW_ALIAS = { terminal: 'agent', chat: 'agent', reports: 'agent' };
function showView(v) {
  if (v === 'terminal') setAgentMode('terminal');
  else if (v === 'chat') setAgentMode('chat');
  if (v === 'reports') { showRightTab('reports'); return; }
  v = VIEW_ALIAS[v] || v;
  if (!['agent', 'market', 'portfolio'].includes(v)) v = 'agent';
  $$('.viewbar [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${v}`));
  localSet('view', v);
  emit('view:shown', v);
  document.body.classList.remove('left-open', 'right-open');
  $('#backdrop').hidden = true;
}
on('view', showView);
$$('.viewbar [data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

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
export function showRightTab(t, { open = true } = {}) {
  if (!['kap', 'reports', 'pdf'].includes(t)) t = 'kap';
  if (t === 'pdf' && $('[data-rtab=pdf]').hidden) t = 'reports'; // PDF sekmesi yalnız bir rapor açıkken var
  $$('.right-tabs [data-rtab]').forEach((b) => b.classList.toggle('active', b.dataset.rtab === t));
  $$('.rtab').forEach((el) => el.classList.toggle('active', el.id === `rtab-${t}`));
  localSet('rtab', t);
  emit('rtab:shown', t);
  if (!open) return;
  if (matchMedia('(max-width: 860px)').matches) openPanel('right');
  if ($('#layout').classList.contains('no-right')) toggleRight(true);
}
on('rtab', showRightTab);
$$('.right-tabs [data-rtab]').forEach((b) => b.addEventListener('click', () => showRightTab(b.dataset.rtab)));

function toggleRight(force) {
  const hide = force === undefined ? !$('#layout').classList.contains('no-right') : !force;
  $('#layout').classList.toggle('no-right', hide);
  $('#btnToggleRight').textContent = hide ? '◂ PANEL' : 'PANEL ▸';
  localSet('rightHidden', hide);
  window.dispatchEvent(new Event('resize'));
}
$('#btnToggleRight').onclick = () => toggleRight();
on('ws:inbox.imported', (m) => toast(`Kurum raporu arşive alındı: ${m.items.map((x) => `${x.broker} · ${x.title}`).join(', ').slice(0, 160)}`, 'ok', 8000));

// Masaüstüne uygulama olarak kurma (Chrome / Edge; tarayıcı kurulabilir olduğunu bildirince görünür)
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('#btnInstall').hidden = false; });
window.addEventListener('appinstalled', () => { installPrompt = null; $('#btnInstall').hidden = true; toast('Uygulama kuruldu', 'ok'); });
$('#btnInstall').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice.catch(() => ({}));
  if (outcome === 'accepted') $('#btnInstall').hidden = true;
  installPrompt = null;
};

// Dar ekran çekmeceleri
function openPanel(side) {
  document.body.classList.add(`${side}-open`);
  $('#backdrop').hidden = false;
}
$('#btnLeft').onclick = () => openPanel('left');
$('#btnRight').onclick = () => openPanel('right');
$('#btnRightClose').onclick = () => { document.body.classList.remove('right-open'); $('#backdrop').hidden = true; };
$('#backdrop').onclick = () => { document.body.classList.remove('left-open', 'right-open'); $('#backdrop').hidden = true; };

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
const TICKER = ['XU100', 'XU030', 'XBANK', 'USDTRY', 'EURTRY', 'GRAM', 'ONS', 'BRENT', 'BTC', 'SPX'];
const TICK_NAMES = { XU100: 'XU100', XU030: 'XU030', XBANK: 'XBANK', USDTRY: 'USD/TL', EURTRY: 'EUR/TL', GRAM: 'GRAM ALTIN', ONS: 'ONS', BRENT: 'BRENT', BTC: 'BTC', SPX: 'S&P 500' };
// Kayan şerit: içerik iki kez yazılır, iz -%50 kayınca başa sarar (üzerine gelince durur)
function renderTicker() {
  const one = TICKER.map((s) => {
    const q = state.quotes[s];
    const tip = q ? `${q.name} · ${q.source || ''}${q.delayed ? ' · ~15 dk gecikmeli' : ''} · ${timeTR(q.time)}` : s;
    return `<div class="tick" data-s="${s}" title="${esc(tip)}"><span class="n">${TICK_NAMES[s] || s}</span><span class="v">${q ? price(q.price) : '…'}</span><span class="c ${cls(q?.changePct)}">${q ? pct(q.changePct) : ''}</span></div>`;
  }).join('');
  $('#ticker').innerHTML = one + one;
}
$('#ticker').addEventListener('click', (e) => { const t = e.target.closest('.tick'); if (t) selectSymbol(t.dataset.s); });

on('ws:quotes', (m) => { Object.assign(state.quotes, m.quotes); renderTicker(); emit('quotes', m.quotes); });

function renderMarket(ms) {
  if (!ms) return;
  state.market = ms;
  const el = $('#mktStatus');
  el.textContent = ms.label;
  el.classList.toggle('open', !!ms.open);
}
on('ws:market', (m) => renderMarket(m.market));
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' }); }, 1000);

on('conn', (ok) => {
  $('#conn').classList.toggle('ok', ok);
  $('#conn').title = ok ? 'Sunucuya bağlı' : 'Bağlantı yok, yeniden deneniyor…';
});
on('ws:hello', (m) => {
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
  $('#chipJobsText').textContent = n ? `${n} arka plan işi · ${elapsed(Math.min(...state.jobs.map((j) => j.startedAt)))}` : '0 arka plan işi';
  if (renderJobs.last !== n) { renderJobs.last = n; native({ type: 'badge', text: n ? String(n) : '' }); }
}
function elapsed(t) { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}s ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`; }
on('ws:jobs', (m) => { state.jobs = m.jobs; renderJobs(); emit('jobs', m.jobs); });
setInterval(renderJobs, 1000);
$('#chipJobs').onclick = () => {
  const m = modal({ title: 'Arka plan işleri', body: '' });
  const draw = () => {
    m.body.innerHTML = state.jobs.length ? state.jobs.map((j) => `<div class="card" style="margin-bottom:8px"><div class="row between"><b>${esc(j.title || 'Oturum')}</b><span class="mono dim">${ago(j.startedAt)}</span></div>
      <div class="muted">${esc(j.activity || '')}</div>${j.subagents?.length ? `<div class="dim" style="font-size:11px">${j.subagents.length} alt ajan</div>` : ''}
      <div class="row" style="margin-top:6px"><button class="btn sec" data-open="${j.id}">Aç</button><button class="btn danger" data-stop="${j.id}">Durdur</button></div></div>`).join('') : '<div class="empty">Çalışan iş yok</div>';
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
const TYPE_TR = { equity: 'Hisse', index: 'Endeks', fx: 'Döviz', currency: 'Döviz', commodity: 'Emtia', etf: 'ETF', mutualfund: 'Fon', fund: 'Fon', cryptocurrency: 'Kripto', crypto: 'Kripto', future: 'Vadeli', gold: 'Altın' };
const isLocal = (r) => ['BIST', 'Döviz', 'Borsa İstanbul', 'Serbest piyasa'].includes(r.exchange) || !/[.-]/.test(r.symbol);
let palEl = null;
function openPalette() {
  if (palEl) { palEl.close(); return; }
  const back = h(`<div class="pal-back"><div class="pal" role="dialog" aria-modal="true" aria-label="Sembol ara">
    <div class="pal-in"><span class="pal-ico" aria-hidden="true">⌕</span><input placeholder="Hisse, endeks, döviz veya şirket ara…" aria-label="Sembol ara" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div>
    <div class="pal-res" role="listbox"></div>
    <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> gez</span><span><kbd>↵</kbd> aç</span><span><kbd>⌘K</kbd> kapat</span></div></div></div>`);
  const input = $('input', back), res = $('.pal-res', back);
  let rows = [], sel = 0, tok = 0;
  const close = () => { back.remove(); palEl = null; document.removeEventListener('keydown', onKey, true); };
  palEl = { close };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  const mark = (t, q) => { const x = esc(t || ''); if (!q) return x; const i = (t || '').toLocaleLowerCase('tr').indexOf(q.toLocaleLowerCase('tr')); return i < 0 ? x : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`; };
  const row = (r, i, q) => {
    const qt = state.quotes[r.symbol];
    return `<button class="pal-row ${i === sel ? 'sel' : ''}" data-i="${i}" role="option">
      <span class="pal-sym">${mark(r.symbol, q)}</span>
      <span class="pal-name">${mark(r.name || '', q)}${r.sector ? `<small>${esc(r.sector)}</small>` : ''}</span>
      ${qt ? `<span class="pal-px"><b>${price(qt.price)}</b><i class="${cls(qt.changePct)}">${pct(qt.changePct)}</i></span>` : ''}
      <span class="pal-tag">${esc(TYPE_TR[r.type] || r.type || '')}${r.exchange && !isLocal(r) ? ` · ${esc(r.exchange)}` : ''}</span></button>`;
  };
  const draw = (groups, q = '') => {
    rows = groups.flatMap(([, items]) => items);
    sel = Math.min(sel, Math.max(rows.length - 1, 0));
    let i = 0;
    res.innerHTML = groups.filter(([, items]) => items.length).map(([title, items]) => `<div class="pal-grp">${title}</div>${items.map((r) => row(r, i++, q)).join('')}`).join('')
      || `<div class="pal-empty">${q ? `"${esc(q)}" için sonuç yok · Enter ile doğrudan açılır` : 'Yazmaya başlayın'}</div>`;
    $('.pal-row.sel', res)?.scrollIntoView({ block: 'nearest' });
  };
  const recent = () => localGet('palRecent', []);
  const home = () => {
    const nm = (s) => ({ symbol: s, name: state.quotes[s]?.name || '', type: state.quotes[s]?.type });
    const rec = recent().slice(0, 5);
    draw([['SON ARANANLAR', rec], ['WATCHLIST', (state.watchlist || []).filter((s) => !rec.some((r) => r.symbol === s)).slice(0, 8).map(nm)]]);
  };
  const pick = (r) => {
    if (!r?.symbol) return;
    localSet('palRecent', [{ symbol: r.symbol, name: r.name || '', type: r.type }, ...recent().filter((x) => x.symbol !== r.symbol)].slice(0, 8));
    selectSymbol(r.symbol); showView('market'); close();
  };
  const search = debounce(async () => {
    const q = input.value.trim();
    if (!q) { sel = 0; home(); return; }
    const t = ++tok;
    res.classList.add('busy');
    const items = await api(`/search?q=${encodeURIComponent(q)}`).catch(() => []);
    if (t !== tok || !palEl) return;
    res.classList.remove('busy');
    sel = 0;
    draw([['BORSA İSTANBUL · DÖVİZ', items.filter(isLocal)], ['DİĞER PİYASALAR', items.filter((r) => !isLocal(r)).slice(0, 8)]], q);
  }, 180);
  input.addEventListener('input', search);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, rows.length - 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(rows[sel] || { symbol: input.value.trim().toUpperCase() }); return; }
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
const native = (msg) => { try { window.webkit?.messageHandlers?.borsa?.postMessage(msg); } catch { /* tarayıcı */ } };
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  if ((e.metaKey || e.ctrlKey) && /^[1-3]$/.test(e.key) && !e.shiftKey) {
    e.preventDefault();
    showView(['agent', 'market', 'portfolio'][Number(e.key) - 1]);
  }
});

// ── Başlangıç ─────────────────────────────────────
(async () => {
  const w = localGet('widths', null);
  if (w?.left) document.documentElement.style.setProperty('--left-w', w.left);
  if (w?.right) document.documentElement.style.setProperty('--right-w', w.right);
  if (localGet('rightHidden', false)) toggleRight(false);
  try {
    // Ayarlar piyasa özetini beklemez (soğuk açılışta özet birkaç saniye sürebilir)
    const ovP = api('/market/overview');
    const [meta, settings] = await Promise.all([api('/meta'), api('/settings')]);
    state.meta = meta;
    applySettings(settings);
    const overview = await ovP;
    setAgentMode(settings.uiMode === 'terminal' ? 'terminal' : 'chat');
    for (const q of overview.items) state.quotes[q.symbol] = q;
    renderMarket(overview.status);
    renderTicker();
    emit('ready');
  } catch (e) {
    toast('Sunucuya ulaşılamadı: ' + e.message, 'err');
  }
  connect();
  showView('agent'); // açılışta her zaman TERMINAL (ajan) sekmesi
  showRightTab(localGet('rtab', 'kap'), { open: false });
})();

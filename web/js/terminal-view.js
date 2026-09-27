// Terminal sekmesinin kabuk modu: gerçek kabuk sekmeleri (xterm.js + node-pty). Sayfa yenilense de oturumlar sürer.
import { state, on, emit, api, wsCall, wsSend, $, $$, h, esc, toast, css, localGet } from './core.js';
import { t, tx } from './i18n.js';

const SHELL = t('kabuk'); // yeni kabuk sekmesinin varsayılan adı

const root = $('#agentTerm');
const visible = () => root.offsetParent !== null;
root.innerHTML = `<div class="term-tabs" id="termTabs">
    <button class="ghost" id="tBack" title="${t('Asistan sohbetine dön')}">‹ ${t('Sohbet')}</button>
    <span id="termTabList" class="row" style="gap:2px;flex-wrap:nowrap"></span>
    <button class="ghost" id="tNew" title="${t('Yeni kabuk')}">＋ ${t('Kabuk')}</button>
    <button class="ghost" id="tClaude" title="${t('Çalışma alanı klasöründe Claude Code başlat')}">＋ Claude Code</button>
    <button class="ghost" id="tHome" title="${t('Ev klasöründe kabuk aç')}">＋ ~</button>
  </div><div class="term-body" id="termBody"></div>`;

$('#tBack').onclick = () => emit('agent:mode:set', 'chat');

const terms = new Map(); // id -> { term, fit, pane, tab, title }
let active = null;
let opened = false;
let helloSeen = false; // sunucudaki açık terminaller bilinmeden yeni kabuk açma

function theme() {
  return {
    background: '#050505', foreground: css('--text') || '#d9e0ea', cursor: css('--accent') || '#f5a524', selectionBackground: '#33415588',
    black: '#1e2430', red: '#ef4444', green: '#22c55e', yellow: '#f5a524', blue: '#38bdf8', magenta: '#a78bfa', cyan: '#2dd4bf', white: '#d9e0ea',
    brightBlack: '#66738a', brightRed: '#f87171', brightGreen: '#4ade80', brightYellow: '#ffc867', brightBlue: '#7dd3fc', brightMagenta: '#c4b5fd', brightCyan: '#5eead4', brightWhite: '#ffffff',
  };
}

function attach(id, title, buffer = '') {
  if (terms.has(id)) return terms.get(id);
  const pane = h(`<div class="term-pane"></div>`);
  $('#termBody').append(pane);
  const term = new window.Terminal({ fontFamily: 'JetBrains Mono, SF Mono, Menlo, monospace', fontSize: state.settings.terminalFontSize || 13, theme: theme(), cursorBlink: true, allowProposedApi: true, scrollback: 10000, macOptionIsMeta: true });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(pane);
  if (buffer) term.write(buffer);
  term.onData((d) => wsSend({ t: 'term.input', id, data: d }));
  term.onResize(({ cols, rows }) => wsSend({ t: 'term.resize', id, cols, rows }));
  const tab = h(`<span class="term-tab" data-id="${id}"><span class="tt"></span><button class="x" title="${t('Kapat')}" aria-label="${t('Kabuğu kapat')}">✕</button></span>`);
  $('.tt', tab).textContent = title;
  tab.onclick = (e) => { if (e.target.closest('.x')) return close(id); activate(id); };
  $('#termTabList').append(tab);
  term.onTitleChange((ttl) => { $('.tt', tab).textContent = ttl.slice(0, 30) || title; });
  const tm = { term, fit, pane, tab, title };
  terms.set(id, tm);
  return tm;
}

function activate(id) {
  active = id;
  for (const [k, tm] of terms) { tm.pane.classList.toggle('active', k === id); tm.tab.classList.toggle('active', k === id); }
  const tm = terms.get(id);
  if (tm) requestAnimationFrame(() => { try { tm.fit.fit(); } catch { /* görünmüyor */ } tm.term.focus(); });
}

async function open(opts = {}, title = 'zsh') {
  try {
    const r = await wsCall({ t: 'term.open', cols: 100, rows: 30, ...opts });
    attach(r.id, title);
    activate(r.id);
  } catch (e) { toast(tx(e.message), 'err'); }
}

function close(id) {
  wsSend({ t: 'term.close', id });
  drop(id);
}
function drop(id) {
  const tm = terms.get(id);
  if (!tm) return;
  tm.term.dispose(); tm.pane.remove(); tm.tab.remove();
  terms.delete(id);
  if (active === id) { const next = [...terms.keys()].at(-1); if (next) activate(next); else active = null; }
}

$('#tNew').onclick = () => open({}, SHELL);
$('#tClaude').onclick = () => open({ command: 'claude' }, 'claude');
$('#tHome').onclick = () => open({ cwd: '~' }, '~');

on('term:open', ({ title, ...opts }) => { opened = true; emit('view', 'terminal'); open(opts, title || SHELL); });
on('ws:term.data', (m) => terms.get(m.id)?.term.write(m.data));
on('ws:term.exit', (m) => { const tm = terms.get(m.id); if (tm) { tm.term.write(`\r\n\x1b[90m[${t('süreç sonlandı: {code}', { code: m.code })}]\x1b[0m\r\n`); setTimeout(() => drop(m.id), 1500); } });

// Yeniden bağlanınca sunucudaki açık terminallere yeniden bağlan
on('hello', async (m) => {
  helloSeen = true;
  for (const x of m.terminals || []) {
    if (terms.has(x.id)) continue;
    const r = await wsCall({ t: 'term.attach', id: x.id }).catch(() => null);
    attach(x.id, x.command || SHELL, r?.data || '');
  }
  if (!active && terms.size) activate([...terms.keys()][0]);
  if (visible() && !terms.size && !opened) { opened = true; open({}, SHELL); }
});

const shown = () => {
  if (!visible()) return;
  if (!terms.size && !opened && helloSeen) { opened = true; open({}, SHELL); }
  else if (active) activate(active);
};
on('agent:mode', () => requestAnimationFrame(shown));
on('view:shown', (v) => { if (v === 'agent') requestAnimationFrame(shown); });
on('settings', (s) => { for (const tm of terms.values()) { tm.term.options.fontSize = s.terminalFontSize || 13; try { tm.fit.fit(); } catch { /* gizli */ } } });
window.addEventListener('resize', () => { const tm = terms.get(active); if (tm && visible()) try { tm.fit.fit(); } catch { /* gizli */ } });

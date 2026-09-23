// TERMINAL sekmesinin kabuk modu: gerçek kabuk sekmeleri (xterm.js + node-pty). Sayfa yenilense de oturumlar sürer.
import { state, on, emit, api, wsCall, wsSend, $, $$, h, esc, toast, css, localGet } from './core.js';

const root = $('#agentTerm');
const visible = () => root.offsetParent !== null;
root.innerHTML = `<div class="term-tabs" id="termTabs">
    <span id="termTabList" class="row" style="gap:2px;flex-wrap:nowrap"></span>
    <button class="ghost" id="tNew" title="Yeni kabuk">＋ Kabuk</button>
    <button class="ghost" id="tClaude" title="Workspace klasöründe Claude Code başlat">＋ Claude Code</button>
    <button class="ghost" id="tHome" title="Ev dizininde kabuk">＋ ~</button>
  </div><div class="term-body" id="termBody"></div>`;

const terms = new Map(); // id -> { term, fit, pane, tab, title }
let active = null;
let opened = false;
let helloSeen = false; // sunucudaki açık terminaller bilinmeden yeni kabuk açma

function theme() {
  return {
    background: '#0a0c10', foreground: css('--text') || '#d9e0ea', cursor: css('--accent') || '#f5a524', selectionBackground: '#33415588',
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
  const tab = h(`<span class="term-tab" data-id="${id}"><span class="tt"></span><button class="x" title="Kapat" aria-label="Terminali kapat">✕</button></span>`);
  $('.tt', tab).textContent = title;
  tab.onclick = (e) => { if (e.target.closest('.x')) return close(id); activate(id); };
  $('#termTabList').append(tab);
  term.onTitleChange((t) => { $('.tt', tab).textContent = t.slice(0, 30) || title; });
  const t = { term, fit, pane, tab, title };
  terms.set(id, t);
  return t;
}

function activate(id) {
  active = id;
  for (const [k, t] of terms) { t.pane.classList.toggle('active', k === id); t.tab.classList.toggle('active', k === id); }
  const t = terms.get(id);
  if (t) requestAnimationFrame(() => { try { t.fit.fit(); } catch { /* görünmüyor */ } t.term.focus(); });
}

async function open(opts = {}, title = 'zsh') {
  try {
    const r = await wsCall({ t: 'term.open', cols: 100, rows: 30, ...opts });
    attach(r.id, title);
    activate(r.id);
  } catch (e) { toast(e.message, 'err'); }
}

function close(id) {
  wsSend({ t: 'term.close', id });
  drop(id);
}
function drop(id) {
  const t = terms.get(id);
  if (!t) return;
  t.term.dispose(); t.pane.remove(); t.tab.remove();
  terms.delete(id);
  if (active === id) { const next = [...terms.keys()].at(-1); if (next) activate(next); else active = null; }
}

$('#tNew').onclick = () => open({}, 'kabuk');
$('#tClaude').onclick = () => open({ command: 'claude' }, 'claude');
$('#tHome').onclick = () => open({ cwd: '~' }, '~');

on('term:open', ({ title, ...opts }) => { opened = true; emit('view', 'terminal'); open(opts, title || 'kabuk'); });
on('ws:term.data', (m) => terms.get(m.id)?.term.write(m.data));
on('ws:term.exit', (m) => { const t = terms.get(m.id); if (t) { t.term.write(`\r\n\x1b[90m[süreç sonlandı: ${m.code}]\x1b[0m\r\n`); setTimeout(() => drop(m.id), 1500); } });

// Yeniden bağlanınca sunucudaki açık terminallere yeniden bağlan
on('hello', async (m) => {
  helloSeen = true;
  for (const t of m.terminals || []) {
    if (terms.has(t.id)) continue;
    const r = await wsCall({ t: 'term.attach', id: t.id }).catch(() => null);
    attach(t.id, t.command || 'kabuk', r?.data || '');
  }
  if (!active && terms.size) activate([...terms.keys()][0]);
  if (visible() && !terms.size && !opened) { opened = true; open({}, 'kabuk'); }
});

const shown = () => {
  if (!visible()) return;
  if (!terms.size && !opened && helloSeen) { opened = true; open({}, 'kabuk'); }
  else if (active) activate(active);
};
on('agent:mode', () => requestAnimationFrame(shown));
on('view:shown', (v) => { if (v === 'agent') requestAnimationFrame(shown); });
on('settings', (s) => { for (const t of terms.values()) { t.term.options.fontSize = s.terminalFontSize || 13; try { t.fit.fit(); } catch { /* gizli */ } } });
window.addEventListener('resize', () => { const t = terms.get(active); if (t && visible()) try { t.fit.fit(); } catch { /* gizli */ } });

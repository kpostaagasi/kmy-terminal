// AGENT CHAT: Claude / Codex oturumları, akışlı yanıt, katlanan araç grupları, KOMİTE (alt ajan) kartları,
// izin ve soru kartları, dosya ekleri, eğik çizgi komutları, maliyet / tur / bağlam göstergesi
import { state, on, emit, api, wsCall, $, $$, h, esc, md, num, ago, dateTR, toast, modal, confirmBox, localGet, localSet, sqlDate, timeTR } from './core.js';

const root = $('#agentChat');
root.innerHTML = `
  <details class="komite" id="komite"><summary></summary><div class="komite-list"></div></details>
  <div class="chat-log" id="chatLog" aria-live="polite"></div>
  <div class="chat-foot" id="chatFoot">
    <div class="slash" id="slash" hidden></div>
    <div class="attach-list" id="attachList" hidden></div>
    <div class="composer">
      <textarea id="chatIn" rows="1" placeholder="Mesaj yaz..." aria-label="Mesaj"></textarea>
      <div class="cm-bar">
        <button class="cm-ico" id="attachBtn" title="Dosya veya görsel ekle (en fazla 10 MB)" aria-label="Dosya ekle">📎</button>
        <input type="file" id="attachFile" hidden multiple accept="image/*,.pdf,.txt,.csv,.md,.json,.xlsx,.html">
        <label class="cm-chip" title="Model"><select id="optModel" aria-label="Model"></select></label>
        <label class="cm-chip" title="Efor seviyesi (/think)"><select id="optEffort" aria-label="Efor"></select></label>
        <button class="cm-chip cm-plan" id="planChip" title="Plan modu: ajan yalnızca plan çıkarır, dosya değiştirmez (/plan)">PLAN</button>
        <span class="spacer"></span>
        <span class="cm-hint" id="cmHint">↵ gönder · / komutlar</span>
        <button class="cm-send" id="chatSend" title="Gönder (Enter)" aria-label="Gönder">↑</button>
      </div>
    </div>
    <div class="cm-status">
      <button class="cm-jobs" id="chipJobs" title="Arka planda süren ajan işleri"><i></i><span id="chipJobsText">0 arka plan işi</span></button>
      <span class="spacer"></span>
      <span class="cm-stat">MALİYET <b id="stCost">$0,00</b></span>
      <span class="cm-stat">TUR <b id="stTurns">0</b></span>
      <span class="cm-stat" title="Model bağlam kullanımı">CTX <span class="ctxbar"><i id="stCtxBar"></i></span> <b id="stCtx">–</b></span>
    </div>
  </div>`;
$('#agentActions').innerHTML = `<label class="sess-chip" title="Oturum"><select id="sessSel" aria-label="Oturum"></select></label><button class="icon-btn sm" id="sessMenu" title="Tüm oturumlar">☰</button><button class="icon-btn sm" id="sessNew" title="Yeni oturum (/yeni)">＋</button><button class="icon-btn sm" id="sessExport" title="Sohbeti JSON olarak indir (/export)">⤓</button>`;

const log = $('#chatLog'), input = $('#chatIn');
const foot = $('#chatFoot');
let current = localGet('session', null);
let sessions = [];
let running = false;
let runStart = 0;
let ctxSym = localGet('ctxSym', true), ctxScreen = localGet('ctxScreen', false);
let permMode = 'default';            // izin modu (PLAN düğmesi ve /plan ile değişir)
let stream = null;                   // { el, text, thinkEl, thinkText }
let toolEls = new Map();
let lastCtx = null, ctxWindow = null, sessCost = 0, sessTurns = 0;
let attachments = [];                // [{ path, name, size, type }]
let sessionProvider = null;
let pendingEvents = [];              // uzun oturumlarda henüz çizilmemiş eski olaylar
let toolRun = null;                  // art arda gelen araç kartları grubu
let pendingTitle = null;             // /yeni İsim ile verilen oturum adı (ilk mesajda kullanılır)
let turnFiles = new Map();           // bu turda ajanın yazdığı/düzenlediği dosyalar
let turnHead = null, turnTodo = null; // turun ilk asistan mesajı (saat · maliyet) ve görev kartı
const subKinds = new Map();          // alt ajan tool_use id → tür
const OLD_EVENTS_PAGE = 150;

// ── Türkçe araç etiketleri ───────────────────────────
const TOOL_LABELS = {
  Read: 'Dosya okunuyor', Write: 'Dosya yazılıyor', Edit: 'Dosya düzenleniyor', MultiEdit: 'Dosya düzenleniyor', NotebookEdit: 'Not defteri düzenleniyor',
  Glob: 'Dosya aranıyor', Grep: 'İçerik aranıyor', Bash: 'Komut çalıştırılıyor', shell: 'Komut çalıştırılıyor', WebSearch: 'Web araması', WebFetch: 'Web sayfası alınıyor',
  Task: 'Alt ajan başlatılıyor', Agent: 'Alt ajan başlatılıyor', TodoWrite: 'Görev listesi güncelleniyor', Skill: 'Beceri yükleniyor', ToolSearch: 'Araç aranıyor',
  AskUserQuestion: 'Soru soruluyor', ExitPlanMode: 'Plan hazırlandı',
  get_quotes: 'Fiyatlar', get_history: 'Fiyat geçmişi', technical_analysis: 'Teknik analiz', signal_scan: 'Sinyal taraması', get_fundamentals: 'Temel veriler',
  screen_stocks: 'Hisse tarama', get_corporate_actions: 'Temettü / sermaye takvimi', search_symbol: 'Sembol arama', market_overview: 'Piyasa özeti',
  get_dividends_history: 'Temettü geçmişi', get_news: 'Haberler', get_kap_disclosures: 'KAP bildirimleri', get_kap_detail: 'KAP bildirim içeriği',
  get_portfolio: 'Portföy', get_portfolio_risk: 'Portföy riski', get_dividend_report: 'Temettü raporu', get_transactions: 'İşlem geçmişi',
  add_transaction: 'İşlem ekleme', set_manual_price: 'Elle fiyat', get_watchlist: 'İzleme listesi', update_watchlist: 'İzleme listesi güncelleme',
  save_report: 'Rapor kaydetme',
  get_memory: 'Şirket notu', save_memory: 'Şirket notu kaydetme', save_kap_attachment: 'KAP eki indirme', list_documents: 'Belge arşivi',
  get_broker_reports: 'Kurum raporları', read_broker_report: 'Kurum raporu indirme', get_financial_statements: 'Mali tablolar',
  get_market_news: 'Ekonomi haberleri', get_tcmb_rates: 'TCMB kurları', get_tlref: 'TLREF',
};
function toolName(n) {
  if (n.startsWith('mcp__borsa__')) return n.slice(12);
  if (n.startsWith('mcp__')) return n.split('__').slice(1).join(' › ');
  return n;
}
function toolLabel(n) { const k = toolName(n); return TOOL_LABELS[k] || TOOL_LABELS[n] || k; }
function toolSummary(i) {
  if (!i) return '';
  return i.command || i.symbol || i.symbols?.join(', ') || i.query || i.url || i.file_path || i.pattern || i.title || i.description || i.skill || i.id || i.prompt?.slice(0, 80) || '';
}

// Sağlayıcı adları: Claude (API maliyeti), Codex ve omp (abonelik / kendi hesabı)
const provName = (p) => state.meta?.providers?.[p] || ({ codex: 'Codex', omp: 'oh-my-pi' }[p] || 'Claude');
const provTag = (p) => (p === 'codex' ? '[Codex] ' : p === 'omp' ? '[omp] ' : '');
const paid = (p) => !p || p === 'claude';

// ── Oturum listesi ─────────────────────────────────
async function loadSessions() {
  sessions = await api('/sessions').catch(() => []);
  const sel = $('#sessSel');
  sel.innerHTML = `<option value="">Yeni oturum</option>` + sessions.map((s) => `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${s.running ? '● ' : ''}${provTag(s.provider)}${esc((s.title || 'Oturum').slice(0, 40))}</option>`).join('');
  if (current && !sessions.find((s) => s.id === current)) { current = null; localSet('session', null); }
}
$('#sessSel').onchange = (e) => openSession(e.target.value || null);
$('#sessNew').onclick = () => openSession(null);
$('#sessMenu').onclick = () => sessionsModal();
$('#sessExport').onclick = () => exportChat();

async function openSession(id) {
  current = id; localSet('session', id);
  log.innerHTML = ''; stream = null; toolEls = new Map(); toolRun = null; turnHead = null; turnTodo = null; subKinds.clear(); lastCtx = null; ctxWindow = null; sessCost = 0; sessTurns = 0; pendingEvents = []; ctxWarned = 0;
  running = false; hideWorking();
  sessionProvider = null;
  if (!id) { welcome(); updateStats(); $('#sessSel').value = ''; if (state.meta) syncProvider(); return; }
  const s = await api(`/sessions/${id}`).catch(() => null);
  if (current !== id) return;
  if (!s) { welcome(); if (state.meta) syncProvider(); return; }
  sessionProvider = s.provider || 'claude';
  if (state.meta) syncProvider();
  $('#sessSel').value = id;
  sessCost = s.cost_usd || 0;
  ctxWindow = s.contextWindow || null;
  const evs = s.events.map((e) => ({ type: e.kind, ...e.data, replay: true, ts: e.ts }));
  if (evs.length > OLD_EVENTS_PAGE) {
    pendingEvents = evs.slice(0, evs.length - OLD_EVENTS_PAGE);
    const more = h(`<button class="ghost load-older">Eski mesajları yükle (${pendingEvents.length} olay)</button>`);
    more.onclick = loadOlder;
    log.append(more);
  }
  for (const e of evs.slice(-OLD_EVENTS_PAGE)) renderEvent(e);
  // Sayfa yenilenmeden önce bekleyen izin / soru istekleri
  for (const p of s.pending || []) {
    if (p.tool === 'AskUserQuestion') renderEvent({ type: 'question', reqId: p.reqId, questions: p.input?.questions || [] });
    else renderEvent({ type: 'permission.request', reqId: p.reqId, tool: p.tool, input: p.input, canAlways: p.canAlways });
  }
  running = s.running;
  if (running) { runStart = state.jobs.find((j) => j.id === id)?.startedAt || Date.now(); showWorking(); }
  updateStats();
  scrollEnd(true);
}
on('agent:open', (id) => { emit('view', 'chat'); openSession(id); });
on('chat:new', () => { if (!running) openSession(null); else toast('Ajan çalışıyor; önce durdurun (Esc)', 'err'); });

// Eski olayları başa ekle (kaydırma konumu korunur)
function loadOlder() {
  const btn = $('.load-older', log);
  const chunk = pendingEvents.splice(Math.max(0, pendingEvents.length - OLD_EVENTS_PAGE));
  const before = log.scrollHeight;
  const holder = document.createDocumentFragment();
  const realAdd = add;
  const saved = [stream, toolRun, turnHead, turnTodo];
  add = (el) => { holder.append(el); return el; };
  stream = null; toolRun = null; turnHead = null; turnTodo = null;
  try { for (const e of chunk) renderEvent(e); } finally { add = realAdd; [stream, toolRun, turnHead, turnTodo] = saved; }
  btn.after(holder);
  if (pendingEvents.length) btn.textContent = `Eski mesajları yükle (${pendingEvents.length} olay)`; else btn.remove();
  log.scrollTop += log.scrollHeight - before;
}

function sessionsModal() {
  const m = modal({ title: 'Oturumlar', wide: true, body: '<input id="sessQ" placeholder="Oturum ara…" aria-label="Oturum ara" style="width:100%;margin-bottom:10px"><div id="sessT"></div>' });
  const qIn = $('#sessQ', m.body);
  qIn.addEventListener('input', () => draw());
  setTimeout(() => qIn.focus(), 30);
  const draw = () => {
    const q = qIn.value.toLocaleLowerCase('tr').trim();
    const list = sessions.filter((s) => !q || (s.title || '').toLocaleLowerCase('tr').includes(q));
    $('#sessT', m.body).innerHTML = list.length ? `<table class="t"><thead><tr><th>Başlık</th><th>Sağlayıcı · model</th><th class="r">Maliyet</th><th>Son</th><th></th></tr></thead><tbody>${list.map((s) => `<tr>
      <td>${s.running ? '<span class="spinner"></span> ' : ''}${esc(s.title || '')}</td><td class="muted">${esc(provName(s.provider))} · ${esc(s.model || 'varsayılan')}</td><td class="r num">${paid(s.provider) ? '$' + num(s.cost_usd, 3) : s.cost_usd ? '$' + num(s.cost_usd, 3) : 'abonelik'}</td><td>${dateTR(sqlDate(s.updated_at), true)}</td>
      <td class="r" style="white-space:nowrap"><button class="ghost" data-o="${s.id}">Aç</button> <button class="ghost" data-r="${s.id}">Yeniden adlandır</button> <button class="ghost" data-x="${s.id}">JSON</button> <button class="ghost" data-d="${s.id}">Sil</button></td></tr>`).join('')}</tbody></table>
      <p class="dim" style="margin-top:10px">Toplam Claude maliyeti: $${num(sessions.reduce((a, s) => a + (s.cost_usd || 0), 0), 3)} · Codex oturumları ChatGPT aboneliğinden düşer.</p>` : `<div class="empty">${sessions.length ? 'Sonuç bulunamadı' : 'Henüz oturum yok'}</div>`;
    $$('[data-o]', m.body).forEach((b) => b.onclick = () => { openSession(b.dataset.o); m.close(); });
    $$('[data-x]', m.body).forEach((b) => b.onclick = () => exportChat(b.dataset.x));
    $$('[data-r]', m.body).forEach((b) => b.onclick = () => renameSession(b.dataset.r, draw));
    $$('[data-d]', m.body).forEach((b) => b.onclick = async () => {
      const s = sessions.find((x) => x.id === b.dataset.d);
      if (s?.running) { toast('Çalışan oturum silinemez; önce durdurun', 'err'); return; }
      if (!(await confirmBox('Oturum silinsin mi? Geri alınamaz.', { danger: true, ok: 'Sil' }))) return;
      await api(`/sessions/${b.dataset.d}`, { method: 'DELETE' });
      if (current === b.dataset.d) openSession(null);
      await loadSessions(); draw();
    });
  };
  draw();
}

async function renameSession(id, after, title) {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  if (title == null) {
    const m = modal({ title: 'Oturumu yeniden adlandır', body: `<input id="rnIn" style="width:100%" value="${esc(s.title || '')}">`, footer: '<button class="btn sec" data-close>İptal</button><button class="btn" id="rnOk">Kaydet</button>' });
    const inp = $('#rnIn', m.el); inp.focus(); inp.select();
    const ok = async () => { await renameSession(id, after, inp.value.trim()); m.close(); };
    $('#rnOk', m.el).onclick = ok;
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    return;
  }
  if (!title) return;
  await api(`/sessions/${id}`, { method: 'PATCH', body: { title } });
  await loadSessions(); after?.();
}

function exportChat(id = current) {
  if (!id) { toast('Önce bir oturum açın', 'err'); return; }
  const a = h('<a download></a>'); a.href = `/api/sessions/${id}/export`; a.click();
  toast('Sohbet JSON olarak indiriliyor');
}

// ── Karşılama ve bağlama göre hızlı istemler ─────────────
const COMMON_QUICK = [
  ['Piyasa özeti', 'Bugünün piyasa özetini çıkar.'],
  ['Portföyümü özetle', 'Portföyümü özetle: değer, K/Z, en güçlü/zayıf pozisyonlar ve dikkat etmem gerekenler.'],
  ['KAP tez sinyalleri', 'Bugünkü KAP tez sinyallerini özetle: watchlist ve portföyümdeki şirketlerin TEZ ve YAPISAL bildirimlerini oku ve önem sırasıyla yorumla.'],
  ['Tezlerim ne durumda?', 'Kayıtlı tezlerimin tetikleyicilerini güncel verilerle tara (tetikleyici-radar becerisi).'],
];
function quickItems() {
  const s = state.selected;
  const out = [];
  if (state.openKap?.id) out.push(['Bu bildirimi yorumla', `Açık olan KAP bildirimini (id ${state.openKap.id}${state.openKap.stocks?.length ? `, ${state.openKap.stocks.join(', ')}` : ''}) get_kap_detail ile oku; şirket için ne anlama geldiğini, tez etkisini ve izlenecekleri özetle.`]);
  if (state.openReport) out.push(['Açık raporu özetle', `Açık olan raporu (workspace/reports/${state.openReport}) oku ve özetle; güçlü ve zayıf yönlerini kendi bağımsız görüşünle değerlendir.`]);
  if (s) out.push([`${s} hızlı analiz`, `${s} hissesini hızlı analiz et: fiyat, teknik görünüm, temel oranlar ve son KAP; 5 maddelik özet.`]);
  out.push(...COMMON_QUICK);
  return out.slice(0, 6);
}
function drawQuick() {
  const q = $('#quick', log);
  if (!q) return;
  const items = quickItems();
  q.innerHTML = items.map(([l], i) => `<button data-i="${i}">${esc(l)}</button>`).join('');
  $$('button', q).forEach((b) => b.onclick = () => send(items[b.dataset.i][1]));
}
function welcome() {
  log.innerHTML = `<div class="welcome"><div class="w-title">AJAN HAZIR</div><div class="dim">Bir hisse kodu veya soru yazın. Komutlar için <span class="mono">/</span></div><div class="quick" id="quick"></div></div>`;
  drawQuick();
}

// ── Olay çizimi ───────────────────────────────────
let add = (el) => { log.append(el); scrollEnd(); return el; };
let stick = true;
log.addEventListener('scroll', () => { stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60; });
function scrollEnd(force) { if (stick || force) log.scrollTop = log.scrollHeight; }

let renderTimer = null;
function renderStream() {
  if (renderTimer) return;
  renderTimer = requestAnimationFrame(() => {
    renderTimer = null;
    if (stream?.el) { $('.md', stream.el).innerHTML = md(stream.text); scrollEnd(); }
    if (stream?.thinkEl) { $('div', stream.thinkEl).textContent = stream.thinkText; }
  });
}

function endThinking() {
  const t = stream?.thinkEl;
  if (!t) return;
  if (!stream.thinkText?.trim()) t.remove(); else $('summary', t).textContent = 'Düşünce';
  stream.thinkEl = null;
}

const tsOf = (e) => (e?.ts ? sqlDate(e.ts)?.getTime() || Date.now() : Date.now());
const SUB_TOOLS = new Set(['Task', 'Agent']);

// Asistan mesajı: turun ilkinde AJAN etiketi + saat (sonuçta maliyet eklenir); kopyala, daralt/genişlet
function assistantBox(e) {
  const el = h('<div class="msg assistant"><div class="md"></div><div class="msg-actions"><button class="ghost xs" data-copy title="Mesajı kopyala">Kopyala</button><button class="ghost xs" data-fold hidden>Genişlet</button></div></div>');
  if (!turnHead) {
    turnHead = el;
    el.prepend(h(`<div class="who"><b class="ai">AJAN</b><span class="meta">${timeTR(tsOf(e))}</span></div>`));
  }
  return el;
}
function finalizeAssistant(el, text) {
  $('.md', el).innerHTML = md(text);
  el.dataset.raw = text;
  requestAnimationFrame(() => {
    if ($('.md', el).scrollHeight > 900) { el.classList.add('folded'); $('[data-fold]', el).hidden = false; }
  });
}
log.addEventListener('click', async (e) => {
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    const raw = cp.closest('.msg')?.dataset.raw || cp.closest('.msg')?.querySelector('.md')?.innerText || '';
    try { await navigator.clipboard.writeText(raw); toast('Kopyalandı', 'ok', 1500); } catch { toast('Panoya erişilemedi', 'err'); }
    return;
  }
  const fd = e.target.closest('[data-fold]');
  if (fd) { const m = fd.closest('.msg'); m.classList.toggle('folded'); fd.textContent = m.classList.contains('folded') ? 'Genişlet' : 'Daralt'; }
});

// Art arda gelen araç çağrıları tek satırda katlanır: "N sn çalıştı ▸ · N araç"
function addTool(el, e) {
  const lastReal = [...log.children].filter((c) => c !== workingEl).at(-1);
  if (!toolRun || lastReal !== toolRun) {
    toolRun = add(h('<details class="tool-run"><summary><span class="tr-t"></span></summary><div class="tr-body"></div></details>'));
    toolRun.dataset.start = tsOf(e);
  }
  $('.tr-body', toolRun).append(el);
  toolRun.dataset.end = tsOf(e);
  drawRun(toolRun);
  scrollEnd();
  return el;
}
function drawRun(run) {
  if (!run) return;
  const tools = $$('.tool', run);
  const busy = tools.some((t) => t.querySelector('.st .spinner'));
  const errs = tools.filter((t) => t.classList.contains('err')).length;
  const sec = Math.max(1, Math.round((Number(run.dataset.end) - Number(run.dataset.start)) / 1000));
  $('.tr-t', run).innerHTML = `${busy && running ? '<span class="spinner"></span> çalışıyor' : `${sec} sn çalıştı`} <span class="caret">▸</span> · ${tools.length} araç${errs ? ` · <span class="down">${errs} hata</span>` : ''}`;
}

function todoCard(inp) {
  const todos = inp?.todos || [];
  const done = todos.filter((t) => t.status === 'completed').length;
  return `<div class="todo-head">Görevler (${done}/${todos.length})</div>${todos.map((t) => `<div class="todo ${esc(t.status)}">${t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'} ${esc(t.content || t.activeForm || '')}</div>`).join('')}`;
}

// KOMİTE üyesi (alt ajan) mesaj kartı: "➤ main → denetci" / "➤ denetci → main"
function subCard(from, to, body, meta, id) {
  const el = h(`<div class="sub-card"${id ? ` data-sa="${esc(id)}"` : ''}><div class="sc-head">➤ ${esc(from)} → ${esc(to)}</div><div class="sc-body note-body clamp"></div><div class="sc-meta">${meta}</div></div>`);
  $('.sc-body', el).innerHTML = md(body || '');
  requestAnimationFrame(() => { const b = $('.sc-body', el); if (b.scrollHeight <= b.clientHeight + 4) b.classList.remove('clamp'); else b.title = 'Tamamını görmek için tıklayın'; });
  $('.sc-body', el).onclick = (ev) => { if (!ev.target.closest('a')) ev.currentTarget.classList.remove('clamp'); };
  return el;
}

function renderEvent(e) {
  if (['message.start', 'delta', 'text', 'tool_use', 'result', 'error', 'stopped', 'local'].includes(e.type)) endThinking();
  switch (e.type) {
    case 'user': {
      turnFiles = new Map(); turnHead = null; turnTodo = null; toolRun = null;
      $('.welcome', log)?.remove();
      const el = h(`<div class="msg user"><div class="who"><b>SEN</b><span class="meta">${timeTR(tsOf(e))}</span></div><div class="body"></div></div>`);
      $('.body', el).textContent = e.text;
      if (e.context) el.append(h(`<div class="ctx">＋ bağlam: ${esc(e.context.split('\n')[0].slice(0, 90))}</div>`));
      if (e.attachments?.length) el.append(h(`<div class="ctx">📎 ${e.attachments.map((a) => esc(a.name || a.path)).join(', ')}</div>`));
      add(el);
      stick = true; scrollEnd(true);
      break;
    }
    case 'message.start': stream = null; break;
    case 'delta':
      if (!stream?.el) stream = { ...(stream || {}), el: add(assistantBox(e)), text: '' };
      stream.text += e.text; renderStream();
      break;
    case 'thinking.delta':
      if (!stream?.thinkEl) stream = { ...(stream || {}), thinkEl: add(h('<details class="thinking"><summary>Düşünüyor…</summary><div></div></details>')), thinkText: '' };
      stream.thinkText += e.text; renderStream();
      break;
    case 'text':
      if (stream?.el) { finalizeAssistant(stream.el, e.text); stream.el = null; stream.text = ''; }
      else finalizeAssistant(add(assistantBox(e)), e.text);
      break;
    case 'thinking':
      if (stream?.thinkEl) { $('div', stream.thinkEl).textContent = e.text; $('summary', stream.thinkEl).textContent = 'Düşünce'; stream.thinkEl = null; }
      else add(h('<details class="thinking"><summary>Düşünce</summary><div></div></details>')).querySelector('div').textContent = e.text;
      break;
    case 'local': {
      const el = add(h('<div class="msg local"><pre></pre></div>'));
      $('pre', el).textContent = e.text;
      break;
    }
    case 'tool_use': {
      stream = null;
      const name = toolName(e.name);
      if (name === 'TodoWrite') {
        if (!turnTodo || !turnTodo.isConnected) turnTodo = add(h('<div class="todo-card"></div>'));
        turnTodo.innerHTML = todoCard(e.input);
        break;
      }
      if (SUB_TOOLS.has(e.name)) {
        const kind = e.input?.subagent_type || 'general-purpose';
        subKinds.set(e.id, { kind, start: tsOf(e) });
        toolRun = null;
        add(subCard('main', kind, `**${e.input?.description || 'Görev'}**\n\n${e.input?.prompt || ''}`, `${timeTR(tsOf(e))} · ${esc(e.name)} <span class="sc-live"><span class="spinner"></span></span>`, e.id));
        break;
      }
      const el = h('<details class="tool"><summary><span class="tl"></span><span class="tn"></span><span class="ti"></span><span class="st"><span class="spinner"></span></span></summary><pre class="in"></pre></details>');
      $('.tl', el).textContent = toolLabel(e.name);
      $('.tn', el).textContent = name !== toolLabel(e.name) ? name : '';
      $('.ti', el).textContent = toolSummary(e.input);
      $('.in', el).textContent = JSON.stringify(e.input, null, 2);
      toolEls.set(e.id, el);
      addTool(el, e);
      if (e.name === 'mcp__borsa__save_report') emit('reports:refresh');
      const fp = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(e.name) ? e.input?.file_path || e.input?.notebook_path : null;
      if (fp) turnFiles.set(fp, e.name === 'Write' ? 'yazıldı' : 'düzenlendi');
      if (e.name === 'mcp__borsa__save_memory') turnFiles.set(`hafiza/${e.input?.symbol ? `sirketler/${String(e.input.symbol).toUpperCase()}` : `konular/${e.input?.topic || ''}`}.md`, 'not güncellendi');
      if (e.name === 'mcp__borsa__save_kap_attachment') turnFiles.set(`belgeler/${e.input?.symbol || 'genel'}/${e.input?.name || 'KAP eki'}`, 'indirildi');
      break;
    }
    case 'tool_result': {
      const sa = subKinds.get(e.id);
      if (sa) {
        const live = $(`.sub-card[data-sa="${CSS.escape(e.id)}"] .sc-live`, log);
        if (live) live.textContent = '· tamamlandı';
        const sec = Math.max(1, Math.round((tsOf(e) - sa.start) / 1000));
        toolRun = null;
        add(subCard(sa.kind, 'main', e.text, `${timeTR(tsOf(e))} · ${sec} sn${e.isError ? ' · <span class="down">hata</span>' : ''}`));
        break;
      }
      const el = toolEls.get(e.id);
      if (!el) break;
      $('.st', el).innerHTML = e.isError ? '<span class="down">✗</span>' : '<span class="up">✓</span>';
      if (e.isError) el.classList.add('err');
      const out = h('<pre></pre>'); out.textContent = e.text; el.append(out);
      const run = el.closest('.tool-run');
      if (run) { run.dataset.end = tsOf(e); drawRun(run); }
      break;
    }
    case 'team.update': {
      const live = $(`.sub-card[data-sa="${CSS.escape(e.id)}"] .sc-live`, log);
      if (live) live.innerHTML = `<span class="spinner"></span> ${e.tools} araç${e.last ? ` · ${esc(toolLabel(e.last))}` : ''}`;
      break;
    }
    case 'permission.request': {
      if (e.replay) break;
      stream = null;
      const el = h(`<div class="perm" data-req="${esc(e.reqId)}"><b>İzin isteniyor:</b> <span class="mono">${esc(toolLabel(e.tool))}</span> <span class="dim mono">${esc(toolName(e.tool))}</span><pre></pre>
        <div class="row" style="margin-top:6px"><button class="btn" data-d="allow">İzin ver</button>${e.canAlways ? '<button class="btn sec" data-d="always">Hep izin ver</button>' : ''}<button class="btn danger" data-d="deny">Reddet</button></div></div>`);
      $('pre', el).textContent = JSON.stringify(e.input, null, 2);
      $$('[data-d]', el).forEach((b) => b.onclick = async () => {
        await wsCall({ t: 'perm.reply', sessionId: current, reqId: e.reqId, decision: b.dataset.d }).catch((x) => toast(x.message, 'err'));
        el.innerHTML = `<span class="dim">${b.dataset.d === 'deny' ? 'Reddedildi' : 'İzin verildi'}: ${esc(toolLabel(e.tool))}</span>`;
      });
      add(el);
      notify(`Ajan izin istiyor: ${toolLabel(e.tool)}`);
      break;
    }
    case 'question': {
      if (e.replay) break;
      stream = null;
      add(questionCard(e));
      notify('Ajan bir soru soruyor');
      break;
    }
    case 'permission.resolved': {
      const el = $(`[data-req="${CSS.escape(e.reqId)}"]`, log);
      if (el && el.querySelector('button')) el.innerHTML = `<span class="dim">${e.behavior === 'allow' ? 'Yanıtlandı ✓' : 'Reddedildi / atlandı'}</span>`;
      break;
    }
    case 'result': {
      stream = null;
      sessCost += e.replay ? 0 : e.cost || 0; sessTurns += e.turns || 0;
      if (e.contextWindow) ctxWindow = e.contextWindow;
      if (e.isError && e.subtype !== 'success') add(h('<div class="msg error"></div>')).textContent = `Tamamlanamadı: ${resultReason(e.subtype)}${e.errors?.length ? ' — ' + e.errors.join('; ') : ''}`;
      if (turnFiles.size) {
        const rel = (f) => f.replace(/^.*\/workspace\//, '');
        const card = add(h(`<details class="tool files"><summary>▸ Değişen dosyalar (${turnFiles.size})</summary><div class="files-list">${[...turnFiles].map(([f, how]) => `<div><span class="mono">${esc(rel(f))}</span> <span class="dim">${how}</span>${rel(f).startsWith('reports/') ? ` <button class="ghost" data-rep="${esc(rel(f).slice(8))}">aç</button>` : ''}</div>`).join('')}</div></details>`));
        $$('[data-rep]', card).forEach((b) => b.onclick = () => emit('report:show', b.dataset.rep));
        turnFiles = new Map();
      }
      const meta = turnHead && $('.who .meta', turnHead);
      if (meta && !meta.dataset.done) { meta.dataset.done = 1; meta.insertAdjacentHTML('beforeend', !paid(e.provider) && !e.cost ? ` · ${esc(provName(e.provider))}` : ` · <span class="up">$${num(e.cost || 0, 2)}</span>`); }
      for (const r of $$('.tool-run', log).slice(-3)) drawRun(r);
      $$('.sc-live .spinner', log).forEach((x) => x.remove());
      turnHead = null;
      updateStats();
      break;
    }
    case 'usage': lastCtx = e.ctx; if (e.window) ctxWindow = e.window; updateStats(); break;
    case 'ratelimit': {
      const el = add(h('<div class="msg notice"></div>'));
      el.textContent = `${e.status === 'rejected' ? '⛔ Kullanım limitine ulaşıldı' : '⚠ Kullanım limitine yaklaşılıyor'}${e.kind ? ` (${e.kind})` : ''}${e.utilization != null ? ` · %${num(e.utilization * (e.utilization <= 1 ? 100 : 1), 0)}` : ''}${e.resetsAt ? ` · sıfırlanma ${dateTR(e.resetsAt, true)}` : ''}`;
      if (!e.replay) toast(el.textContent, e.status === 'rejected' ? 'err' : '', 9000);
      break;
    }
    case 'error': add(h('<div class="msg error"></div>')).textContent = e.message; break;
    case 'stopped': add(h('<div class="msg system">■ Durduruldu</div>')); break;
    case 'notice': add(h('<div class="msg system"></div>')).textContent = e.message; break;
    default: break;
  }
}
const resultReason = (s) => ({ error_max_turns: 'tur sınırına ulaşıldı', error_during_execution: 'çalışma sırasında hata', error_max_budget_usd: 'bütçe sınırı' }[s] || s);

// AskUserQuestion kartı: seçenekler + kendi cevabını yaz
function questionCard(e) {
  const el = h(`<div class="perm question" data-req="${esc(e.reqId)}"></div>`);
  const qs = e.questions || [];
  el.innerHTML = qs.map((q, i) => `<div class="q" data-i="${i}"><div class="q-head">${esc(q.header || 'Soru')}</div><div class="q-text">${esc(q.question)}</div>
    <div class="q-opts">${(q.options || []).map((o) => `<label class="q-opt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${i}" value="${esc(o.label)}"><span><b>${esc(o.label)}</b>${o.description ? `<br><span class="dim">${esc(o.description)}</span>` : ''}</span></label>`).join('')}</div>
    <input class="q-free" placeholder="Veya kendi cevabını yaz (seçimin yerine geçer)"></div>`).join('')
    + '<div class="row" style="margin-top:8px"><button class="btn" data-a="send">Yanıtla</button><button class="btn sec" data-a="skip">Atla</button></div>';
  $('[data-a=send]', el).onclick = async () => {
    const answers = {};
    qs.forEach((q, i) => {
      const box = $(`.q[data-i="${i}"]`, el);
      const free = $('.q-free', box).value.trim();
      const picked = $$('input:checked', box).map((x) => x.value);
      answers[q.question] = free || picked.join(', ');
    });
    if (Object.values(answers).some((v) => !v)) { toast('Her soru için bir seçim yapın veya cevap yazın', 'err'); return; }
    await wsCall({ t: 'question.reply', sessionId: current, reqId: e.reqId, answers }).catch((x) => toast(x.message, 'err'));
    el.innerHTML = `<span class="dim">Cevaplandı ✓ ${esc(Object.values(answers).join(' · '))}</span>`;
  };
  $('[data-a=skip]', el).onclick = async () => {
    await wsCall({ t: 'question.reply', sessionId: current, reqId: e.reqId, skip: true }).catch(() => {});
    el.innerHTML = '<span class="dim">Atlandı</span>';
  };
  return el;
}

function notify(text) {
  toast(text);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('KMY Terminal', { body: text });
}

// ── Çalışma göstergesi ───────────────────────────
let workingEl = null;
function showWorking() {
  hideWorking();
  workingEl = h('<div class="working"><span class="spinner"></span><span class="wt">Çalışıyor…</span><kbd>Esc</kbd><span class="dim">durdur</span></div>');
  log.append(workingEl);
  $('#chatSend').textContent = '■';
  $('#chatSend').title = 'Durdur (Esc)';
  $('#cmHint').textContent = 'Esc ile durdur';
  $('#chatSend').classList.add('stop');
  scrollEnd();
}
function hideWorking() {
  workingEl?.remove(); workingEl = null;
  $('#chatSend').textContent = '↑';
  $('#chatSend').title = 'Gönder (Enter)';
  $('#cmHint').textContent = '↵ gönder · / komutlar';
  $('#chatSend').classList.remove('stop');
}
setInterval(() => {
  if (!workingEl) return;
  const j = state.jobs.find((x) => x.id === current);
  $('.wt', workingEl).textContent = `${j?.activity || 'Çalışıyor'} · ${ago(runStart)}`;
  log.append(workingEl);
}, 1000);

let ctxWarned = 0;
const kTok = (n) => `${num(n / 1000, 0)}k`;
function updateStats() {
  $('#stCost').textContent = !paid(sessionProvider) && !sessCost ? 'abonelik' : `$${num(sessCost, 2)}`;
  $('#stTurns').textContent = sessTurns;
  const p = lastCtx && ctxWindow ? (lastCtx / ctxWindow) * 100 : null;
  $('#stCtx').textContent = lastCtx ? `${kTok(lastCtx)}${ctxWindow ? `/${kTok(ctxWindow)} (${num(p, 0)}%)` : ''}` : '–';
  const bar = $('#stCtxBar');
  bar.style.width = `${Math.min(p || 0, 100)}%`;
  bar.className = p >= 90 ? 'hi' : p >= 50 ? 'mid' : '';
  if (p >= 95 && ctxWarned < 95) { ctxWarned = 95; toast('Bağlam penceresi %95 dolu. /compact ile sıkıştırın veya /yeni ile yeni oturum açın.', 'err', 9000); }
  else if (p >= 80 && ctxWarned < 80) { ctxWarned = 80; toast('Bağlam penceresi %80 dolu. /compact ile sıkıştırabilirsiniz.', '', 7000); }
}

// ── Canlı olaylar ─────────────────────────────────
let awaitingNew = false;
on('ws:agent', (e) => {
  if (e.type === 'session.created' && awaitingNew && !current) { awaitingNew = false; current = e.sessionId; localSet('session', current); }
  if (e.type === 'session.created' || e.type === 'run.end') loadSessions();
  if (e.sessionId !== current) {
    if (e.type === 'permission.request' || e.type === 'question') toast(`Başka bir oturum yanıt bekliyor: ${e.tool ? toolLabel(e.tool) : 'soru'}`);
    return;
  }
  if (e.type === 'run.start') { running = true; runStart = e.startedAt; showWorking(); return; }
  if (e.type === 'run.end') { running = false; hideWorking(); return; }
  if (e.type === 'user') return;
  renderEvent(e);
  if (workingEl) log.append(workingEl);
});

// ── Ekler ─────────────────────────────────────────
function drawAttachments() {
  const el = $('#attachList');
  el.hidden = !attachments.length;
  el.innerHTML = attachments.map((a, i) => `<span class="attach">${a.type?.startsWith('image/') ? '🖼' : '📄'} ${esc(a.name)} <span class="dim">${a.size < 1024 ? `${a.size} B` : `${num(a.size / 1024, 0)} KB`}</span><button class="x" data-rm="${i}" title="Kaldır" aria-label="Eki kaldır">✕</button></span>`).join('');
  $$('[data-rm]', el).forEach((b) => b.onclick = () => { attachments.splice(Number(b.dataset.rm), 1); drawAttachments(); });
}
async function uploadFiles(files) {
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) { toast(`${f.name}: dosya çok büyük (en fazla 10 MB)`, 'err'); continue; }
    try {
      const r = await api(`/chat/upload?name=${encodeURIComponent(f.name || 'gorsel.png')}`, { method: 'POST', body: f, raw: true });
      attachments.push({ path: r.path, name: r.name, size: r.size, type: f.type });
      drawAttachments();
    } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
}
$('#attachBtn').onclick = () => $('#attachFile').click();
$('#attachFile').onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ''; };
root.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); foot.classList.add('drop'); } });
root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) foot.classList.remove('drop'); });
root.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); foot.classList.remove('drop'); uploadFiles([...e.dataTransfer.files]); });
input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); uploadFiles(files); }
});

// ── Gönderme ──────────────────────────────────────
function screenContext() {
  const parts = [];
  if (state.selected) parts.push(`seçili sembol ${state.selected}`);
  if (state.openReport) parts.push(`açık rapor: workspace/reports/${state.openReport}`);
  if (state.openKap) parts.push(`açık KAP bildirimi: id ${state.openKap.id} — ${state.openKap.title || ''} (${(state.openKap.stocks || []).join(', ')})`);
  return parts.join('; ');
}
function buildContext() {
  const parts = [];
  if (ctxSym && state.selected) {
    const q = state.quotes[state.selected];
    parts.push(`Ekranda seçili sembol: ${state.selected}${q ? ` (${q.name}) fiyat ${q.price} ${q.currency}${q.delayed ? ' (~15 dk gecikmeli)' : ''}, günlük %${q.changePct?.toFixed(2)}` : ''}`);
  }
  if (ctxScreen) parts.push(screenContext());
  return parts.join('\n') || null;
}

async function send(text, { context } = {}) {
  text = (text ?? input.value).trim();
  if (!text && !attachments.length) return;
  // Yerel komutlar (/durdur, /status, /help…) ajan çalışırken de kullanılabilir; istem gönderen komutlar beklemeli
  const cmd = text.startsWith('/') ? findCmd(text.split(/\s+/)[0].toLowerCase()) : null;
  if (cmd && !(running && cmd[2]) && (await handleSlash(text))) { input.value = ''; autosize(); slash.hidden = true; drawQuick(); return; }
  if (running) { toast('Ajan hâlâ çalışıyor. Durdurun veya yeni oturum açın.', 'err'); return; }
  if (!text) text = 'Eklediğim dosyaları incele ve özetle.';
  input.value = ''; autosize();
  // /compact ve /context Claude Code'a olduğu gibi iletilir (bağlam eklenmez)
  const passthrough = /^\/(compact|context)\b/.test(text);
  const ctx = passthrough ? null : context ?? buildContext();
  const atts = passthrough ? [] : attachments;
  if (!passthrough) { attachments = []; drawAttachments(); }
  $('.welcome', log)?.remove();
  renderEvent({ type: 'user', text, context: ctx, attachments: atts });
  running = true; runStart = Date.now(); showWorking();
  awaitingNew = !current;
  try {
    const r = await wsCall({
      t: 'chat.send', sessionId: current, text, context: ctx, attachments: atts, title: current ? undefined : pendingTitle || undefined,
      ...pickModel(), effort: $('#optEffort').value, permissionMode: permMode,
    });
    if (!current) { current = r.sessionId; localSet('session', current); pendingTitle = null; await loadSessions(); }
    if (!sessionProvider) { sessionProvider = pickModel().provider; syncProvider(); }
  } catch (e) {
    running = false; hideWorking();
    renderEvent({ type: 'error', message: e.message });
  }
}

$('#chatSend').onclick = () => {
  if (running) stopRun();
  else send();
};

// ── Eğik çizgi komutları ─────────────────────────
function systemCard(html) { const el = add(h('<div class="msg local"></div>')); el.innerHTML = html; return el; }
const SLASH = [
  ['/yeni', 'İSİM? — yeni oturum başlat (ör. /yeni Bankalar)', null, ['/new']],
  ['/temizle', 'Sohbeti ve model bağlamını temizle (yeni oturum)', null, ['/clear']],
  ['/durdur', 'Çalışan yanıtı durdur (Esc)', null, ['/stop']],
  ['/analiz', 'SEMBOL — kapsamlı hisse analizi + rapor', (a) => `${a || state.selected} için kapsamlı analiz yap: iş modeli, son finansal sonuçlar, değerleme (get_fundamentals), teknik görünüm, son KAP bildirimleri, riskler. Sonucu HTML rapor olarak kaydet ve bana kısa özet ver.`, ['/analyze']],
  ['/hizli', 'SEMBOL — hızlı analiz', (a) => `${a || state.selected} hissesini hızlı analiz et: fiyat, teknik görünüm, temel oranlar ve son KAP; 5 maddelik özet.`, ['/quick']],
  ['/teknik', 'SEMBOL — teknik analiz', (a) => `${a || state.selected} için teknik analiz: trend, destek/direnç seviyeleri, RSI, MACD, hareketli ortalamalar, hacim. Maddeli özetle.`],
  ['/karsilastir', 'A B … — hisse karşılaştırma', (a) => `Şu hisseleri karşılaştır: ${a}. Fiyat performansı, temel oranlar (get_fundamentals), teknik görünüm, temettü ve son KAP bildirimleri açısından tablo halinde göster.`],
  ['/piyasa', 'Günlük piyasa özeti', () => 'Bugünkü piyasa özetini çıkar: BIST endeksleri, döviz/altın, en çok yükselen/düşen hisseler, sektör performansı ve izleme listemdeki dikkat çeken hareketler.'],
  ['/portfoy', 'Portföy değerlendirmesi', () => 'Portföyümü değerlendir: performans (TWR, XIRR), risk metrikleri, yoğunlaşma, temettü geliri, kur farkı ve pozisyonlarımla ilgili son KAP bildirimleri.'],
  ['/kap', 'SEMBOL? — son KAP sinyalleri (sembolle: ajan taraması)', (a) => `${a} için son 30 günün KAP bildirimlerini incele; önemli olanların içeriğini get_kap_detail ile oku ve özetle.`],
  ['/tarama', 'KOŞUL — hisse tarayıcı', (a) => `screen_stocks aracıyla şu kritere göre BIST hisselerini tara: ${a || 'BIST 100, F/K ≤ 8, PD/DD ≤ 1,5'}. Sonuçları tablo halinde göster ve öne çıkanları kısaca yorumla.`, ['/screen']],
  ['/temettu', 'Temettü analizi', () => 'Portföyümün temettü gelirini ve ilan edilmiş yaklaşan temettüleri analiz et; temettü verimi yüksek BIST hisselerinden izleme listeme eklenebilecek adayları gerekçeleriyle listele.'],
  ['/fonlar', 'Fon fiyatlarımı güncelle', () => 'Portföyümdeki canlı fiyatı olmayan varlıkların (TEFAS fonları vb.) güncel birim fiyatlarını bağlı Borsa MCP get_fund_data aracıyla al ve set_manual_price ile kaydet; hangi fiyatların güncellendiğini listele.'],
  ['/rapor', 'KONU — HTML rapor üret', (a) => `"${a}" konusunda ayrıntılı bir HTML rapor hazırla (tablolar ve gerekiyorsa SVG grafiklerle) ve mcp__borsa__save_report ile kaydet.`],
  ['/ekran', 'Ekranda açık olanı bağlam olarak ekle', null],
  ['/plan', 'Plan modunu aç/kapat', null],
  ['/model', 'MODEL — model değiştir', null],
  ['/think', 'low|medium|high|xhigh|max — düşünme seviyesi', null, ['/efor']],
  ['/compact', 'Bağlamı özetleyerek küçült (Claude)', null],
  ['/context', 'Model bağlam kullanımını göster (Claude)', null],
  ['/cost', 'Oturum maliyet özeti', null, ['/maliyet']],
  ['/status', 'Oturum durumu ve istatistik', null, ['/durum']],
  ['/rename', 'YENİ İSİM — oturumu yeniden adlandır', null, ['/adlandir']],
  ['/export', 'Sohbeti JSON olarak indir', null, ['/indir']],
  ['/doctor', 'Sunucu ve sağlayıcı sağlık kontrolü', null, ['/health', '/saglik']],
  ['/settings', 'Ayarları aç', null, ['/ayarlar']],
  ['/help', 'Komut listesi', null, ['/yardim']],
];
const findCmd = (cmd) => SLASH.find((x) => x[0] === cmd || x[3]?.includes(cmd));

async function handleSlash(text) {
  const [raw, ...rest] = text.split(/\s+/);
  const cmd = raw.toLowerCase();
  const arg = rest.join(' ').trim();
  const c = findCmd(cmd);
  if (!c) return false;
  switch (c[0]) {
    case '/yeni': case '/temizle':
      openSession(null);
      pendingTitle = c[0] === '/yeni' && arg ? arg.slice(0, 80) : null;
      toast(c[0] === '/temizle' ? 'Yeni oturum açıldı; model bağlamı temiz' : pendingTitle ? `Yeni oturum: ${pendingTitle}` : 'Yeni oturum');
      return true;
    case '/durdur': if (current) wsCall({ t: 'chat.stop', sessionId: current }).catch(() => {}); return true;
    case '/ekran': ctxScreen = !ctxScreen; localSet('ctxScreen', ctxScreen); if (arg) { ctxScreen = true; send(arg); } else toast(ctxScreen ? 'Ekran bağlamı (seçili sembol, açık rapor / KAP) mesajlara eklenecek' : 'Ekran bağlamı kapatıldı'); return true;
    case '/plan': togglePlan(); return true;
    case '/model': {
      const opts = [...$('#optModel').options];
      const hit = arg && opts.find((o) => o.value.toLowerCase().includes(arg.toLowerCase()) || o.textContent.toLowerCase().includes(arg.toLowerCase()));
      if (hit && !hit.disabled) { $('#optModel').value = hit.value; toast(`Model: ${hit.textContent}`); }
      else systemCard(`<b>Modeller</b><br>${opts.map((o) => `${esc(o.textContent)} <span class="dim mono">${esc(o.value || 'varsayılan')}</span>`).join('<br>')}<br><span class="dim">Kullanım: /model sonnet</span>`);
      return true;
    }
    case '/think': {
      const lv = arg.toLowerCase();
      if ((state.meta?.efforts || []).includes(lv)) { $('#optEffort').value = lv; toast(`Düşünme seviyesi: ${lv}`); }
      else systemCard(`Kullanım: /think ${esc((state.meta?.efforts || []).join('|'))}`);
      return true;
    }
    case '/compact': case '/context':
      if (!current) { toast('Önce bir oturum başlatın', 'err'); return true; }
      if (!paid(sessionProvider)) { toast('Bu komut yalnızca Claude oturumlarında çalışır', 'err'); return true; }
      return false; // send() olduğu gibi iletir
    case '/cost': {
      const s = sessions.find((x) => x.id === current);
      systemCard(`<b>Oturum maliyeti</b><br>Sağlayıcı: ${esc(provName(sessionProvider))}<br>Bu oturum: ${paid(sessionProvider) || sessCost ? '$' + num(s?.cost_usd ?? sessCost, 4) : 'abonelikten / kendi hesabından düşer'}<br>Tüm oturumlar (Claude): $${num(sessions.reduce((a, x) => a + (x.cost_usd || 0), 0), 3)}`);
      return true;
    }
    case '/status': {
      const s = sessions.find((x) => x.id === current);
      systemCard(`<b>Oturum durumu</b><br>${s ? `Başlık: ${esc(s.title)}<br>Kimlik: <span class="mono">${esc(s.id)}</span><br>Sağlayıcı: ${esc(provName(s.provider))} · model: ${esc(s.model || 'varsayılan')}<br>Oluşturma: ${dateTR(sqlDate(s.created_at), true)} · son: ${dateTR(sqlDate(s.updated_at), true)}<br>` : 'Yeni oturum (henüz mesaj yok)<br>'}Durum: ${running ? 'çalışıyor' : 'boşta'}<br>Bağlam: ${lastCtx ? `${num(lastCtx / 1000, 1)}b token${ctxWindow ? ` / ${num(ctxWindow / 1000, 0)}b (%${num((lastCtx / ctxWindow) * 100, 0)})` : ''}` : '—'}<br>İzin modu: ${esc(state.meta?.permissionModes?.[permMode] || permMode)}`);
      return true;
    }
    case '/rename': if (!current) { toast('Önce bir oturum başlatın', 'err'); return true; } await renameSession(current, null, arg || null); return true;
    case '/export': exportChat(); return true;
    case '/doctor': {
      const hl = await api('/health').catch(() => null);
      const conn = await api('/agent/connections').catch(() => null);
      systemCard(hl ? `<b>Sağlık kontrolü</b><br>Sunucu: ✓ v${esc(hl.version)} · Node ${esc(hl.node)} · çalışma ${Math.round(hl.uptimeSec / 60)} dk<br>Claude CLI: ${hl.claudeCli ? '✓ ' + esc(hl.claudeCli) : '✗ bulunamadı'}<br>Codex CLI: ${hl.codexCli ? '✓ ' + esc(hl.codexCli) : '✗ bulunamadı'}<br>omp CLI: ${hl.ompCli ? '✓ ' + esc(hl.ompCli) : '✗ bulunamadı'}<br>Terminal: ${hl.terminal ? '✓' : '✗'} · BIST: ${esc(hl.market.label)}${conn?.mcp?.length ? `<br>MCP: ${conn.mcp.map((m) => `${esc(m.name)} ${m.status === 'connected' ? '✓' : m.status === 'failed' ? '✗' : '…'}`).join(' · ')}` : '<br><span class="dim">MCP bağlantıları ilk Claude yanıtından sonra listelenir (Ayarlar › Bağlantılar).</span>'}` : '<span class="down">Sunucuya ulaşılamadı</span>');
      return true;
    }
    case '/kap': {
      if (arg) { send(SLASH.find((x) => x[0] === '/kap')[2](arg)); return true; }
      // Argümansız: izleme listesi + portföy için son 3 günün önemli sinyalleri, ajan maliyeti olmadan
      const [w, p] = await Promise.all(['watchlist', 'portfolio'].map((sc) => api(`/kap?scope=${sc}&days=3&limit=60`).catch(() => ({ items: [] }))));
      const seen = new Set();
      const items = [...(w.items || []), ...(p.items || [])].filter((x) => (seen.has(x.id) ? false : seen.add(x.id)) && ['TEZ', 'YAPISAL', 'FINANSAL'].includes(x.signal))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 12);
      const lbl = state.meta?.kapSignals || {};
      const el = systemCard(items.length ? `<b>Son 3 günün KAP sinyalleri</b> <span class="dim">(izleme listesi + portföy)</span><br>${items.map((x) => `<span class="dim">${esc(x.publishDate.slice(0, 16))}</span> <span class="pill sig-${esc(x.signal)}">${esc(lbl[x.signal]?.label || x.signal)}</span> <b class="mono">${esc(x.stocks.slice(0, 2).join(', '))}</b> ${esc(x.subject || '')} <button class="ghost" data-kap="${x.id}">aç</button>`).join('<br>')}<br><span class="dim">Yorum için: /kap SEMBOL</span>`
        : 'Son 3 günde izleme listesi ve portföy şirketlerinde TEZ, YAP veya FİN sinyali yok.');
      $$('[data-kap]', el).forEach((b) => b.onclick = () => emit('kap:open', Number(b.dataset.kap)));
      return true;
    }
    case '/settings': emit('settings:open'); return true;
    case '/help': systemCard(`<b>Komutlar</b><br>${SLASH.map((x) => `<span class="mono accent">${x[0]}</span>${x[3] ? ` <span class="dim mono">(${x[3].join(', ')})</span>` : ''} — ${esc(x[1])}`).join('<br>')}`); return true;
    default:
      if (c[2]) { send(c[2](arg)); return true; }
      return false;
  }
}

const slash = $('#slash');
let slashSel = 0, slashItems = [];
// Komut grupları (popup'ta başlık altında listelenir)
const SLASH_GROUPS = [
  ['ANALİZ', ['/analiz', '/hizli', '/teknik', '/karsilastir', '/piyasa', '/portfoy', '/kap', '/tarama', '/temettu', '/fonlar', '/rapor', '/ekran']],
  ['OTURUM', ['/yeni', '/temizle', '/durdur', '/rename', '/export', '/compact', '/context']],
  ['AJAN', ['/plan', '/model', '/think']],
  ['BİLGİ', ['/cost', '/status', '/doctor', '/settings', '/help']],
];
const splitDesc = (d) => { const k = d.indexOf(' — '); return k > 0 ? [d.slice(0, k), d.slice(k + 3)] : ['', d]; };
function drawSlash() {
  const v = input.value;
  if (!v.startsWith('/') || v.includes(' ')) { slash.hidden = true; return; }
  const q = v.toLowerCase();
  const hit = (x) => x[0].startsWith(q) || x[3]?.some((a) => a.startsWith(q));
  const groups = SLASH_GROUPS.map(([t, cmds]) => [t, cmds.map((c) => SLASH.find((x) => x[0] === c)).filter((x) => x && hit(x))]).filter(([, l]) => l.length);
  const rest = SLASH.filter((x) => hit(x) && !SLASH_GROUPS.some(([, c]) => c.includes(x[0])));
  if (rest.length) groups.push(['DİĞER', rest]);
  slashItems = groups.flatMap(([, l]) => l);
  slash.hidden = !slashItems.length;
  slashSel = Math.min(slashSel, Math.max(slashItems.length - 1, 0));
  const mark = (c) => `<b>/</b>${q.length > 1 && c.startsWith(q) ? `<u>${esc(c.slice(1, q.length))}</u>${esc(c.slice(q.length))}` : esc(c.slice(1))}`;
  let n = 0;
  slash.innerHTML = `<div class="sl-list">${groups.map(([t, l]) => `<div class="sl-grp">${t}</div>${l.map((x) => {
    const [arg, text] = splitDesc(x[1]);
    const i = n++;
    return `<button class="sl-row ${i === slashSel ? 'sel' : ''}" data-i="${i}"><span class="sl-cmd">${mark(x[0])}</span>${arg ? `<span class="sl-arg">${esc(arg)}</span>` : ''}<span class="sl-txt">${esc(text)}</span>${x[3]?.length ? `<span class="sl-alias">${esc(x[3].join(' '))}</span>` : ''}</button>`;
  }).join('')}`).join('')}</div>
    <div class="sl-foot"><span><kbd>↑</kbd><kbd>↓</kbd> seç</span><span><kbd>Tab</kbd> tamamla</span><span><kbd>↵</kbd> çalıştır</span><span><kbd>Esc</kbd> kapat</span></div>`;
  $('.sl-row.sel', slash)?.scrollIntoView({ block: 'nearest' });
}
slash.addEventListener('mousedown', (e) => { const b = e.target.closest('.sl-row'); if (!b) return; e.preventDefault(); input.value = slashItems[b.dataset.i][0] + ' '; slash.hidden = true; input.focus(); });
slash.addEventListener('mousemove', (e) => { const b = e.target.closest('.sl-row'); if (b && Number(b.dataset.i) !== slashSel) { slashSel = Number(b.dataset.i); $$('.sl-row', slash).forEach((x) => x.classList.toggle('sel', x === b)); } });

function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; }
input.addEventListener('input', () => { autosize(); drawSlash(); drawQuick(); });
input.addEventListener('keydown', (e) => {
  if (!slash.hidden) {
    if (e.key === 'ArrowDown') { slashSel = Math.min(slashSel + 1, slashItems.length - 1); drawSlash(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { slashSel = Math.max(slashSel - 1, 0); drawSlash(); e.preventDefault(); return; }
    if (e.key === 'Tab' || (e.key === 'Enter' && slashItems[slashSel] && input.value.trim() !== slashItems[slashSel][0])) {
      e.preventDefault(); input.value = slashItems[slashSel][0] + ' '; slash.hidden = true; return;
    }
    if (e.key === 'Escape') { e.stopPropagation(); slash.hidden = true; return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});

// ── KOMİTE: workspace/.claude/agents alt ajanları ve çalışanlar ─────────
let committee = [];
async function loadCommittee() { committee = await api('/committee').catch(() => []); drawCommittee(); }
function drawCommittee() {
  const subs = state.jobs.flatMap((j) => (j.subagents || []).filter((x) => !x.done).map((x) => ({ ...x, job: j })));
  const busy = (name) => subs.filter((x) => x.kind === name);
  const extra = subs.filter((x) => !committee.some((c) => c.name === x.kind));
  const el = $('#komite');
  el.hidden = !subs.length; // yalnız alt ajan çalışırken görünür
  $('summary', el).innerHTML = `<span class="caret">▸</span> 👥 KOMİTE (${committee.length} üye)${subs.length ? ` <span class="accent">· ${subs.length} çalışıyor</span>` : ''}`;
  const row = (name, desc, list) => `<div class="km"><span class="dot ${list.length ? 'live' : ''}"></span><b class="mono">${esc(name)}</b><span class="km-d">${list.length ? list.map((x) => `${esc(x.description)} · ${x.tools} araç · ${ago(x.startedAt)}`).join(' | ') : esc(desc)}</span>${list.length ? `<button class="ghost xs" data-open="${esc(list[0].job.id)}">aç</button>` : ''}</div>`;
  $('.komite-list', el).innerHTML = committee.map((c) => row(c.name, c.description, busy(c.name))).join('')
    + extra.map((x) => row(x.kind, '', [x])).join('');
  $$('[data-open]', el).forEach((b) => b.onclick = () => openSession(b.dataset.open));
}
on('jobs', drawCommittee);
on('ws:agent', (e) => {
  if (!['team.start', 'team.update', 'team.end'].includes(e.type)) return;
  const { type, sessionId, ...sa } = e;
  const j = state.jobs.find((x) => x.id === sessionId);
  if (j) { j.subagents ||= []; const cur = j.subagents.find((x) => x.id === sa.id); if (cur) Object.assign(cur, sa); else j.subagents.push(sa); }
  drawCommittee();
});

// Esc: çalışan yanıtı durdurur (pencere / palet açıkken veya kabuk odaktayken değil)
function stopRun() { if (running && current) wsCall({ t: 'chat.stop', sessionId: current }).catch(() => {}); }
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !running || e.defaultPrevented) return;
  if ($('#modalRoot').children.length || !root.offsetParent || e.target.closest?.('.xterm')) return;
  e.preventDefault(); stopRun();
});

// ── Plan modu ve seçenekler ─────────────────────
function defaultMode() { const m = state.settings.permissionMode; return m && m !== 'plan' ? m : 'default'; }
function drawPlan() {
  const isPlan = permMode === 'plan';
  $('#planChip').classList.toggle('on', isPlan);
  foot.classList.toggle('plan-mode', isPlan);
  input.placeholder = isPlan ? 'Plan modu: ajan yalnızca plan çıkarır…' : 'Mesaj yaz...';
}
function togglePlan() {
  permMode = permMode === 'plan' ? defaultMode() : 'plan';
  drawPlan(); toast(permMode === 'plan' ? 'Plan modu AÇIK: ajan yalnızca plan oluşturur, dosya değiştirmez' : 'Plan modu KAPALI');
}
$('#planChip').onclick = togglePlan;

// Model listesi sağlayıcıya göre gruplanır; oturumun sağlayıcısı sabittir
function pickModel() {
  const o = $('#optModel').selectedOptions[0];
  return { provider: o?.dataset.prov || 'claude', model: o?.dataset.id || '' };
}
function fillModels() {
  const m = state.meta, s = state.settings;
  const listOf = (p) => {
    const base = p === 'claude' ? m.models : m.providerModels?.[p] || (p === 'codex' ? m.codexModels : []) || [];
    const own = s[`${p}Model`];
    return [...base, ...(p !== 'claude' && own && !base.some((x) => x.id === own) ? [{ id: own, label: own }] : [])];
  };
  const prov = sessionProvider || s.provider || 'claude';
  const cur = pickModel();
  const want = cur.provider === prov && $('#optModel').options.length ? cur.model : prov === 'claude' ? s.model || '' : s[`${prov}Model`] || '';
  const group = (p) => `<optgroup label="${esc(provName(p))}">${listOf(p).map((x) => `<option value="${p}|${esc(x.id)}" data-prov="${p}" data-id="${esc(x.id)}" ${sessionProvider && sessionProvider !== p ? 'disabled' : ''} ${p === prov && x.id === want ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</optgroup>`;
  $('#optModel').innerHTML = Object.keys(m.providers || { claude: 1 }).map(group).join('');
  $('#optModel').title = sessionProvider ? 'Model (oturumun sağlayıcısı sabittir; değiştirmek için yeni oturum açın)' : 'Model';
  $('#optEffort').parentElement.hidden = pickModel().provider !== 'claude';
}
function syncProvider() { fillModels(); updateStats(); }
$('#optModel').onchange = () => { $('#optEffort').parentElement.hidden = pickModel().provider !== 'claude'; };

function fillOptions() {
  const m = state.meta, s = state.settings;
  if (!m) return;
  syncProvider();
  const EFFORT_TIP = { low: 'kısa işler, düşük maliyet', medium: 'dengeli', high: 'karmaşık analiz', xhigh: 'zor işler', max: 'tüm düşünme bütçesi' };
  $('#optEffort').innerHTML = m.efforts.map((x) => `<option value="${x}" ${x === s.effort ? 'selected' : ''} title="${EFFORT_TIP[x] || ''}">${x}</option>`).join('');
  if (permMode !== 'plan' || s.permissionMode === 'plan') permMode = s.permissionMode || 'default';
  drawPlan();
}
on('settings', fillOptions);

// Başka modüllerden gelen istek
on('agent:ask', async ({ text, context, newSession }) => {
  emit('view', 'chat');
  if (newSession || running) await openSession(null);
  send(text, { context: context ?? undefined });
});
for (const ev of ['report:opened', 'symbol', 'kap:opened']) on(ev, () => drawQuick());

on('ready', async () => {
  fillOptions(); loadCommittee();
  await loadSessions();
  await openSession(current);
});
on('hello', () => loadSessions());

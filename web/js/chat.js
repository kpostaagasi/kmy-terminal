// AGENT CHAT: Claude / Codex oturumları, akışlı yanıt, katlanan araç grupları, KOMİTE (alt ajan) kartları,
// izin ve soru kartları, dosya ekleri, eğik çizgi komutları, maliyet / tur / bağlam göstergesi
import { state, on, emit, api, wsCall, $, $$, h, esc, md, num, ago, dateTR, toast, modal, confirmBox, localGet, localSet, sqlDate, timeTR } from './core.js';
import { t, tx, lang } from './i18n.js';

// Çizgi simgeler (currentColor): ataç, gönder, durdur
const ICON = {
  clip: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor"/></svg>',
};
const root = $('#agentChat');
root.innerHTML = `
  <div class="panel-bar"><span class="pb-title">${t('Asistan sohbeti')}</span><span class="head-actions" id="agentActions"></span><span class="spacer"></span>
    <div class="seg" id="agentMode"><button data-m="chat" class="active">${t('Sohbet')}</button><button data-m="terminal" title="${t('Kabuk ve Claude Code komut satırı')}">${t('Kabuk')}</button></div></div>
  <details class="komite" id="komite"><summary></summary><div class="komite-list"></div></details>
  <div class="chat-log" id="chatLog" aria-live="polite"></div>
  <div class="chat-foot" id="chatFoot">
    <div class="slash" id="slash" hidden></div>
    <div class="attach-list" id="attachList" hidden></div>
    <div class="composer">
      <div class="cm-top">
        <label class="cm-chip sess-chip" title="${t('Oturum')}"><select id="sessSel" aria-label="${t('Oturum')}"></select></label>
        <label class="cm-chip model" title="${t('Model')}"><select id="optModel" aria-label="${t('Model')}"></select></label>
        <label class="cm-chip" title="${t('Düşünme seviyesi (/think)')}"><select id="optEffort" aria-label="${t('Düşünme seviyesi')}"></select></label>
        <span class="spacer"></span>
        <span class="cm-stat">${t('Maliyet')} <b id="stCost">$0,00</b></span>
        <span class="cm-stat">${t('Tur')} <b id="stTurns">0</b></span>
        <span class="cm-stat" title="${t('Model bağlam kullanımı')}">ctx <span class="ctxbar"><i id="stCtxBar"></i></span> <b id="stCtx">–</b></span>
      </div>
      <div class="cm-bar">
        <button class="cm-ico" id="attachBtn" title="${t('Dosya veya görsel ekle (en fazla 10 MB)')}" aria-label="${t('Dosya ekle')}">${ICON.clip}</button>
        <input type="file" id="attachFile" hidden multiple accept="image/*,.pdf,.txt,.csv,.md,.json,.xlsx,.html">
        <textarea id="chatIn" rows="1" placeholder="${t('Mesaj yazın…')}" aria-label="${t('Mesaj')}"></textarea>
        <button class="cm-send" id="chatSend" title="${t('Gönder (Enter)')}" aria-label="${t('Gönder')}">${ICON.send}</button>
      </div>
    </div>
    <div class="cm-status">
      <button class="cm-jobs" id="chipJobs" title="${t('Arka planda süren asistan işleri')}"><i></i><span id="chipJobsText">${t('{n} arka plan işi', { n: 0 })}</span></button>
      <button class="cm-yolo" id="cmYolo" hidden>${t('⚡ YOLO — ajan tüm araçlara izinli')}</button>
      <span class="spacer"></span>
      <span class="cm-hint" id="cmHint">${t('↵ gönder · / komutlar')}</span>
    </div>
  </div>`;
$('#agentActions').innerHTML = `<button class="icon-btn sm" id="sessMenu" title="${t('Tüm oturumlar')}">☰</button><button class="icon-btn sm" id="sessNew" title="${t('Yeni oturum (/yeni)')}">＋</button><button class="icon-btn sm" id="sessExport" title="${t('Sohbeti JSON olarak indir (/export)')}">⤓</button>`;

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
  Task: 'Alt asistan başlatılıyor', Agent: 'Alt asistan başlatılıyor', TodoWrite: 'Görev listesi güncelleniyor', Skill: 'Beceri yükleniyor', ToolSearch: 'Araç aranıyor',
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
export function toolLabel(n) { const k = toolName(n); const l = TOOL_LABELS[k] || TOOL_LABELS[n]; return l ? t(l) : k; }
function toolSummary(i) {
  if (!i) return '';
  return i.command || i.symbol || i.symbols?.join(', ') || i.query || i.url || i.file_path || i.pattern || i.title || i.description || i.skill || i.id || i.prompt?.slice(0, 80) || '';
}

// Sağlayıcı adları: Claude (API maliyeti), Codex ve omp (abonelik / kendi hesabı)
const provName = (p) => state.meta?.providers?.[p] || ({ codex: 'Codex', omp: 'oh-my-pi' }[p] || 'Claude');
const provTag = (p) => (p === 'codex' ? '[Codex] ' : p === 'omp' ? '[omp] ' : '');
const paid = (p) => !p || p === 'claude';
// Oturum adı: zamanlanmış görevlerin adları (⏰ …) sunucudan gelir ve çevrilir
const sessTitle = (x) => (!x?.title ? t('Oturum') : x.title.startsWith('⏰') ? tx(x.title) : x.title);

// ── Oturum listesi ─────────────────────────────────
async function loadSessions() {
  sessions = await api('/sessions').catch(() => []);
  const sel = $('#sessSel');
  sel.innerHTML = `<option value="">${t('Yeni oturum')}</option>` + sessions.map((s) => `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${s.running ? '● ' : ''}${provTag(s.provider)}${esc(sessTitle(s).slice(0, 40))}</option>`).join('');
  if (current && !sessions.find((s) => s.id === current)) { current = null; localSet('session', null); }
  requestAnimationFrame(() => fitSelect(sel));
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
    const more = h(`<button class="ghost load-older">${t('Önceki mesajları yükle ({n})', { n: pendingEvents.length })}</button>`);
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
on('chat:new', () => { if (!running) openSession(null); else toast(t('Asistan çalışıyor; önce durdurun (Esc)'), 'err'); });

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
  if (pendingEvents.length) btn.textContent = t('Önceki mesajları yükle ({n})', { n: pendingEvents.length }); else btn.remove();
  log.scrollTop += log.scrollHeight - before;
}

// Oturumlar penceresi: tarihe göre gruplu liste; satıra tıklayınca açılır, işlemler satır sonunda simge düğmeler
function sessionsModal() {
  const m = modal({ title: t('Oturumlar'), wide: true, body: `<div class="ss">
    <div class="ss-top"><input id="sessQ" class="ss-q" placeholder="${t('Oturum ara…')}" aria-label="${t('Oturum ara')}"><button class="btn" id="sessNew2">＋ ${t('Yeni oturum')}</button></div>
    <div class="ss-list" id="sessT"></div><div class="ss-foot dim" id="sessF"></div></div>` });
  const qIn = $('#sessQ', m.body);
  qIn.addEventListener('input', () => draw());
  $('#sessNew2', m.body).onclick = () => { openSession(null); m.close(); };
  setTimeout(() => qIn.focus(), 30);
  const dayKey = (d) => {
    if (!d) return t('Daha eski');
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const diff = (t0 - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400_000;
    return t(diff <= 0 ? 'Bugün' : diff === 1 ? 'Dün' : diff < 7 ? 'Bu hafta' : diff < 31 ? 'Bu ay' : 'Daha eski');
  };
  const cost = (x) => (paid(x.provider) || x.cost_usd ? `$${num(x.cost_usd || 0, 2)}` : t('abonelik'));
  const draw = () => {
    const q = qIn.value.toLocaleLowerCase('tr').trim();
    const list = sessions.filter((x) => !q || (x.title || '').toLocaleLowerCase('tr').includes(q));
    const groups = [];
    for (const x of list) {
      const k = dayKey(sqlDate(x.updated_at));
      (groups.find((g) => g[0] === k) || groups[groups.push([k, []]) - 1])[1].push(x);
    }
    $('#sessT', m.body).innerHTML = list.length ? groups.map(([k, xs]) => `<div class="ss-grp">${k}</div>${xs.map((x) => `
      <div class="ss-row ${x.id === current ? 'cur' : ''}" data-o="${x.id}" tabindex="0">
        <span class="ss-st ${x.running ? 'run' : ''}">${x.running ? '<span class="spinner"></span>' : ''}</span>
        <div class="ss-main"><div class="ss-title">${esc(sessTitle(x))}</div>
          <div class="ss-meta"><span class="ss-prov">${esc(provName(x.provider))}</span>${x.model ? ` · ${esc(x.model)}` : ''} · ${dateTR(sqlDate(x.updated_at), true)} · <span class="${paid(x.provider) ? 'up' : ''}">${cost(x)}</span></div></div>
        <div class="ss-acts"><button class="icon-btn sm" data-r="${x.id}" title="${t('Yeniden adlandır')}" aria-label="${t('Yeniden adlandır')}">✎</button><button class="icon-btn sm" data-x="${x.id}" title="${t('JSON olarak indir')}" aria-label="${t('İndir')}">⤓</button><button class="icon-btn sm ss-del" data-d="${x.id}" title="${t('Sil')}" aria-label="${t('Sil')}">🗑</button></div>
      </div>`).join('')}`).join('')
      : `<div class="empty">${t(sessions.length ? 'Sonuç bulunamadı' : 'Henüz oturum yok')}</div>`;
    const claude = sessions.reduce((a, x) => a + (paid(x.provider) ? x.cost_usd || 0 : 0), 0);
    $('#sessF', m.body).textContent = t('{n} oturum · Claude toplam maliyeti {cost} · Codex ve oh-my-pi oturumları aboneliğe dahil', { n: sessions.length, cost: `$${num(claude, 2)}` });
    $$('.ss-row', m.body).forEach((r) => {
      r.onclick = (e) => { if (e.target.closest('.ss-acts')) return; openSession(r.dataset.o); m.close(); };
      r.onkeydown = (e) => { if (e.key === 'Enter') { openSession(r.dataset.o); m.close(); } };
    });
    $$('[data-x]', m.body).forEach((b) => b.onclick = () => exportChat(b.dataset.x));
    $$('[data-r]', m.body).forEach((b) => b.onclick = () => renameSession(b.dataset.r, draw));
    $$('[data-d]', m.body).forEach((b) => b.onclick = async () => {
      const x = sessions.find((y) => y.id === b.dataset.d);
      if (x?.running) { toast(t('Çalışan oturum silinemez; önce durdurun'), 'err'); return; }
      if (!(await confirmBox(t('"{title}" silinsin mi? Bu işlem geri alınamaz.', { title: sessTitle(x).slice(0, 60) }), { danger: true, ok: t('Sil') }))) return;
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
    const m = modal({ title: t('Oturumu yeniden adlandır'), body: `<input id="rnIn" style="width:100%" value="${esc(s.title || '')}">`, footer: `<button class="btn sec" data-close>${t('İptal')}</button><button class="btn" id="rnOk">${t('Kaydet')}</button>` });
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
  if (!id) { toast(t('Önce bir oturum açın'), 'err'); return; }
  const a = h('<a download></a>'); a.href = `/api/sessions/${id}/export`; a.click();
  toast(t('Sohbet JSON olarak indiriliyor'));
}

// ── Karşılama ve bağlama göre hızlı istemler ─────────────
// Görünüme göre hızlı başlangıç istemleri (sohbet sağ panele taşındığında da geçerli)
const QUICK = {
  agent: [
    ['İzleme listemin risklerini analiz et', 'İzleme listemdeki hisselerin risklerini analiz et: son fiyat hareketleri, teknik görünüm, önemli KAP bildirimleri ve dikkat etmem gerekenler.'],
    ['KAP tez sinyallerini özetle', 'Bugünkü KAP tez sinyallerini özetle: izleme listemdeki ve portföyümdeki şirketlerin TEZ ve YAPISAL bildirimlerini oku, önem sırasıyla yorumla.'],
    ['Tezlerim ne durumda?', 'Kayıtlı tezlerimin tetikleyicilerini güncel verilerle tara (tetikleyici-radar becerisi).'],
  ],
  portfolio: [
    ['Portföyümü özetle', 'Portföyümü özetle: değer, kâr/zarar, en güçlü ve en zayıf pozisyonlar, dikkat etmem gerekenler.'],
    ['Risk analizi yap', 'Portföyümün risk analizini yap: yoğunlaşma, volatilite, en büyük düşüş, beta ve çeşitlendirme önerileri.'],
    ['Aylık performans', 'Portföyümün aylık performansını karşılaştırma ölçütleriyle birlikte özetle; en çok katkı ve kayıp veren pozisyonları belirt.'],
  ],
  market: [
    ['Piyasa özeti', 'Bugünün piyasa özetini çıkar.'],
    ['KAP özetini çıkar', 'Bugünün önemli KAP bildirimlerini özetle; izleme listemdeki şirketleri öne al.'],
  ],
};
let quickView = 'agent';
const quickPrompt = (s) => t('{s} hissesini hızlı analiz et: fiyat, teknik görünüm, temel oranlar ve son KAP; 5 maddelik özet.', { s: s || '' });
function quickItems() {
  const s = state.selected;
  const out = [];
  if (state.openKap?.id) out.push([t('Bu bildirimi yorumla'), t('Açık olan KAP bildirimini (id {id}{stocks}) get_kap_detail ile oku; şirket için ne anlama geldiğini, tez etkisini ve izlenecekleri özetle.', { id: state.openKap.id, stocks: state.openKap.stocks?.length ? `, ${state.openKap.stocks.join(', ')}` : '' })]);
  if (state.openReport) out.push([t('Açık raporu özetle'), t('Açık olan raporu (workspace/reports/{file}) oku ve özetle; güçlü ve zayıf yönlerini kendi bağımsız görüşünle değerlendir.', { file: state.openReport })]);
  if (s && quickView === 'market') out.push([t('{s} hızlı analiz', { s }), quickPrompt(s)]);
  out.push(...(QUICK[quickView] || QUICK.agent).map(([l, p]) => [t(l), t(p)]));
  return out.slice(0, 5);
}
function drawQuick() {
  const q = $('#quick', log);
  if (!q) return;
  const items = quickItems();
  q.innerHTML = items.map(([l], i) => `<button data-i="${i}"><i>&gt;</i> ${esc(l)}</button>`).join('')
    + `<button class="more" data-help><i>&gt;</i> ${t('Neler yapabilirim?')}</button>`;
  $$('button[data-i]', q).forEach((b) => b.onclick = () => send(items[b.dataset.i][1]));
  $('[data-help]', q).onclick = () => { input.value = '/'; input.focus(); input.dispatchEvent(new Event('input')); };
}
on('view:shown', (v) => { quickView = v; drawQuick(); });
const LOGO = [
  '██╗  ██╗███╗   ███╗██╗   ██╗',
  '██║ ██╔╝████╗ ████║╚██╗ ██╔╝',
  '█████╔╝ ██╔████╔██║ ╚████╔╝ ',
  '██╔═██╗ ██║╚██╔╝██║  ╚██╔╝  ',
  '██║  ██╗██║ ╚═╝ ██║   ██║   ',
  '╚═╝  ╚═╝╚═╝     ╚═╝   ╚═╝   ',
].join('\n');
function welcome() {
  log.innerHTML = `<div class="welcome"><pre class="w-logo" aria-hidden="true">${LOGO}</pre><div class="w-title">${t('KMY hazır')}</div><div class="w-sub">${t('Bir hisse kodu veya soru yazın. Komutlar için {slash} yazın.', { slash: '<span class="mono">/</span>' })}</div><div class="w-quick-h">${t('Hızlı başla:')}</div><div class="quick" id="quick"></div></div>`;
  drawQuick();
  setupCheck();
}
// İlk kurulum: Claude Code yoksa (ve seçili sağlayıcı Claude ise) sohbet açılışında nasıl kurulacağı gösterilir
let setupChecked = null;
async function setupCheck() {
  setupChecked ||= api('/health').catch(() => null);
  const h = await setupChecked;
  const w = $('.welcome', log);
  if (!h || !w || h.claudeCli || $('.w-setup', w)) return;
  w.insertAdjacentHTML('beforeend', `<div class="w-setup"><b>${t('Claude Code bulunamadı.')}</b> ${t("Yapay zekâ asistanı için bu Mac'e Claude Code kurun ve Claude hesabınızla giriş yapın:")}
    <ol><li>${t("{link} adresinden kurun (veya Terminal'de {cmd} çalıştırın).", { link: '<a href="https://claude.com/download" target="_blank" rel="noopener">claude.com/download</a>', cmd: '<span class="mono">curl -fsSL https://claude.ai/install.sh | bash</span>' })}</li>
    <li>${t("Terminal'de {cmd} yazıp giriş yapın.", { cmd: '<span class="mono">claude</span>' })}</li><li>${t("kmy terminal'i kapatıp yeniden açın.")}</li></ol>
    <span class="dim">${t('Piyasa verisi, KAP, kurum raporları, portföy ve izleme listesi asistan olmadan da çalışır.')}</span></div>`);
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
  const te = stream?.thinkEl;
  if (!te) return;
  if (!stream.thinkText?.trim()) te.remove(); else $('summary', te).textContent = t('Düşünce');
  stream.thinkEl = null;
}

const tsOf = (e) => (e?.ts ? sqlDate(e.ts)?.getTime() || Date.now() : Date.now());
const SUB_TOOLS = new Set(['Task', 'Agent']);

// Asistan mesajı: turun ilkinde AJAN etiketi + saat (sonuçta maliyet eklenir); kopyala, daralt/genişlet
function assistantBox(e) {
  const el = h(`<div class="msg assistant"><div class="md"></div><div class="msg-actions"><button class="ghost xs" data-copy title="${t('Mesajı kopyala')}">${t('Kopyala')}</button><button class="ghost xs" data-fold hidden>${t('Genişlet')}</button></div></div>`);
  if (!turnHead) {
    turnHead = el;
    el.prepend(h(`<div class="who"><b class="ai">${t('Asistan')}</b><span class="meta">${timeTR(tsOf(e))}</span></div>`));
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
    try { await navigator.clipboard.writeText(raw); toast(t('Kopyalandı'), 'ok', 1500); } catch { toast(t('Panoya erişilemedi'), 'err'); }
    return;
  }
  const fd = e.target.closest('[data-fold]');
  if (fd) { const m = fd.closest('.msg'); m.classList.toggle('folded'); fd.textContent = t(m.classList.contains('folded') ? 'Genişlet' : 'Daralt'); }
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
  const busy = tools.some((x) => x.querySelector('.st .spinner'));
  const errs = tools.filter((x) => x.classList.contains('err')).length;
  const sec = Math.max(1, Math.round((Number(run.dataset.end) - Number(run.dataset.start)) / 1000));
  $('.tr-t', run).innerHTML = `${busy && running ? `<span class="spinner"></span> ${t('çalışıyor')}` : t('{n} sn çalıştı', { n: sec })} <span class="caret">▸</span> · ${t('{n} araç', { n: tools.length })}${errs ? ` · <span class="down">${t('{n} hata', { n: errs })}</span>` : ''}`;
}

function todoCard(inp) {
  const todos = inp?.todos || [];
  const done = todos.filter((x) => x.status === 'completed').length;
  return `<div class="todo-head">${t('Görevler ({done}/{total})', { done, total: todos.length })}</div>${todos.map((x) => `<div class="todo ${esc(x.status)}">${x.status === 'completed' ? '☑' : x.status === 'in_progress' ? '◐' : '☐'} ${esc(x.content || x.activeForm || '')}</div>`).join('')}`;
}

// KOMİTE üyesi (alt ajan) mesaj kartı: "➤ main → denetci" / "➤ denetci → main"
function subCard(from, to, body, meta, id) {
  const who = (n) => (n === 'main' ? t('Ana asistan') : n);
  const el = h(`<div class="sub-card"${id ? ` data-sa="${esc(id)}"` : ''}><div class="sc-head">➤ ${esc(who(from))} → ${esc(who(to))}</div><div class="sc-body note-body clamp"></div><div class="sc-meta">${meta}</div></div>`);
  $('.sc-body', el).innerHTML = md(body || '');
  requestAnimationFrame(() => { const b = $('.sc-body', el); if (b.scrollHeight <= b.clientHeight + 4) b.classList.remove('clamp'); else b.title = t('Tamamını görmek için tıklayın'); });
  $('.sc-body', el).onclick = (ev) => { if (!ev.target.closest('a')) ev.currentTarget.classList.remove('clamp'); };
  return el;
}

function renderEvent(e) {
  if (['message.start', 'delta', 'text', 'tool_use', 'result', 'error', 'stopped', 'local'].includes(e.type)) endThinking();
  switch (e.type) {
    case 'user': {
      turnFiles = new Map(); turnHead = null; turnTodo = null; toolRun = null;
      $('.welcome', log)?.remove();
      const el = h(`<div class="msg user"><div class="who"><b>${t('Sen')}</b><span class="meta">${timeTR(tsOf(e))}</span></div><div class="body"></div></div>`);
      $('.body', el).textContent = e.text;
      if (e.context) {
        const c = e.context.split('\n')[0];
        el.append(h(`<div class="ctx">＋ ${esc(t('Bağlam: {text}', { text: c.length > 90 ? `${c.slice(0, 90)}…` : c }))}</div>`));
      }
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
      if (!stream?.thinkEl) stream = { ...(stream || {}), thinkEl: add(h(`<details class="thinking"><summary>${t('Düşünüyor…')}</summary><div></div></details>`)), thinkText: '' };
      stream.thinkText += e.text; renderStream();
      break;
    case 'text':
      if (stream?.el) { finalizeAssistant(stream.el, e.text); stream.el = null; stream.text = ''; }
      else finalizeAssistant(add(assistantBox(e)), e.text);
      break;
    case 'thinking':
      if (stream?.thinkEl) { $('div', stream.thinkEl).textContent = e.text; $('summary', stream.thinkEl).textContent = t('Düşünce'); stream.thinkEl = null; }
      else add(h(`<details class="thinking"><summary>${t('Düşünce')}</summary><div></div></details>`)).querySelector('div').textContent = e.text;
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
        add(subCard('main', kind, `**${e.input?.description || t('Görev')}**\n\n${e.input?.prompt || ''}`, `${timeTR(tsOf(e))} · ${esc(e.name)} <span class="sc-live"><span class="spinner"></span></span>`, e.id));
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
        if (live) live.textContent = `· ${t('tamamlandı')}`;
        const sec = Math.max(1, Math.round((tsOf(e) - sa.start) / 1000));
        toolRun = null;
        add(subCard(sa.kind, 'main', e.text, `${timeTR(tsOf(e))} · ${t('{n} sn', { n: sec })}${e.isError ? ` · <span class="down">${t('hata')}</span>` : ''}`));
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
      if (live) live.innerHTML = `<span class="spinner"></span> ${t('{n} araç', { n: e.tools })}${e.last ? ` · ${esc(toolLabel(e.last))}` : ''}`;
      break;
    }
    case 'permission.request': {
      if (e.replay) break;
      stream = null;
      const el = h(`<div class="perm" data-req="${esc(e.reqId)}"><b>${t('İzin isteniyor:')}</b> <span class="mono">${esc(toolLabel(e.tool))}</span> <span class="dim mono">${esc(toolName(e.tool))}</span><pre></pre>
        <div class="row" style="margin-top:6px"><button class="btn" data-d="allow">${t('İzin ver')}</button>${e.canAlways ? `<button class="btn sec" data-d="always">${t('Hep izin ver')}</button>` : ''}<button class="btn danger" data-d="deny">${t('Reddet')}</button></div></div>`);
      $('pre', el).textContent = JSON.stringify(e.input, null, 2);
      $$('[data-d]', el).forEach((b) => b.onclick = async () => {
        await wsCall({ t: 'perm.reply', sessionId: current, reqId: e.reqId, decision: b.dataset.d }).catch((x) => toast(tx(x.message), 'err'));
        el.innerHTML = `<span class="dim">${esc(t(b.dataset.d === 'deny' ? 'Reddedildi: {tool}' : 'İzin verildi: {tool}', { tool: toolLabel(e.tool) }))}</span>`;
      });
      add(el);
      notify(t('Asistan izin istiyor: {tool}', { tool: toolLabel(e.tool) }));
      break;
    }
    case 'question': {
      if (e.replay) break;
      stream = null;
      add(questionCard(e));
      notify(t('Asistan bir soru soruyor'));
      break;
    }
    case 'permission.resolved': {
      const el = $(`[data-req="${CSS.escape(e.reqId)}"]`, log);
      if (el && el.querySelector('button')) el.innerHTML = `<span class="dim">${t(e.behavior === 'allow' ? 'Yanıtlandı ✓' : 'Reddedildi veya atlandı')}</span>`;
      break;
    }
    case 'result': {
      stream = null;
      sessCost += e.replay ? 0 : e.cost || 0; sessTurns += e.turns || 0;
      if (e.contextWindow) ctxWindow = e.contextWindow;
      if (e.isError && e.subtype !== 'success') add(h('<div class="msg error"></div>')).textContent = t('Tamamlanamadı: {reason}', { reason: `${resultReason(e.subtype)}${e.errors?.length ? ' — ' + e.errors.map((x) => tx(x)).join('; ') : ''}` });
      if (turnFiles.size) {
        const rel = (f) => f.replace(/^.*\/workspace\//, '');
        const card = add(h(`<details class="tool files"><summary>▸ ${t('Değişen dosyalar ({n})', { n: turnFiles.size })}</summary><div class="files-list">${[...turnFiles].map(([f, how]) => `<div><span class="mono">${esc(rel(f))}</span> <span class="dim">${t(how)}</span>${rel(f).startsWith('reports/') ? ` <button class="ghost" data-rep="${esc(rel(f).slice(8))}">${t('aç')}</button>` : ''}</div>`).join('')}</div></details>`));
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
      el.textContent = `${e.status === 'rejected' ? `⛔ ${t('Kullanım sınırına ulaşıldı')}` : `⚠ ${t('Kullanım sınırına yaklaşılıyor')}`}${e.kind ? ` (${tx(e.kind)})` : ''}${e.utilization != null ? ` · ${t('%{n}', { n: num(e.utilization * (e.utilization <= 1 ? 100 : 1), 0) })}` : ''}${e.resetsAt ? ` · ${t('sıfırlanma: {date}', { date: dateTR(e.resetsAt, true) })}` : ''}`;
      if (!e.replay) toast(el.textContent, e.status === 'rejected' ? 'err' : '', 9000);
      break;
    }
    case 'error': add(h('<div class="msg error"></div>')).textContent = tx(e.message); break;
    case 'stopped': add(h('<div class="msg system"></div>')).textContent = `■ ${e.message ? tx(e.message) : t('Durduruldu')}`; break;
    case 'notice': add(h('<div class="msg system"></div>')).textContent = tx(e.message); break;
    default: break;
  }
}
const resultReason = (s) => ({ error_max_turns: t('tur sınırına ulaşıldı'), error_during_execution: t('çalışma sırasında hata oluştu'), error_max_budget_usd: t('bütçe sınırına ulaşıldı') }[s] || s);

// AskUserQuestion kartı: seçenekler + kendi cevabını yaz
function questionCard(e) {
  const el = h(`<div class="perm question" data-req="${esc(e.reqId)}"></div>`);
  const qs = e.questions || [];
  el.innerHTML = qs.map((q, i) => `<div class="q" data-i="${i}"><div class="q-head">${esc(q.header || t('Soru'))}</div><div class="q-text">${esc(q.question)}</div>
    <div class="q-opts">${(q.options || []).map((o) => `<label class="q-opt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${i}" value="${esc(o.label)}"><span><b>${esc(o.label)}</b>${o.description ? `<br><span class="dim">${esc(o.description)}</span>` : ''}</span></label>`).join('')}</div>
    <input class="q-free" placeholder="${t('Veya kendi cevabınızı yazın (seçimin yerine geçer)')}"></div>`).join('')
    + `<div class="row" style="margin-top:8px"><button class="btn" data-a="send">${t('Yanıtla')}</button><button class="btn sec" data-a="skip">${t('Atla')}</button></div>`;
  $('[data-a=send]', el).onclick = async () => {
    const answers = {};
    qs.forEach((q, i) => {
      const box = $(`.q[data-i="${i}"]`, el);
      const free = $('.q-free', box).value.trim();
      const picked = $$('input:checked', box).map((x) => x.value);
      answers[q.question] = free || picked.join(', ');
    });
    if (Object.values(answers).some((v) => !v)) { toast(t('Her soru için bir seçim yapın veya cevap yazın'), 'err'); return; }
    await wsCall({ t: 'question.reply', sessionId: current, reqId: e.reqId, answers }).catch((x) => toast(tx(x.message), 'err'));
    el.innerHTML = `<span class="dim">${t('Yanıtlandı ✓')} ${esc(Object.values(answers).join(' · '))}</span>`;
  };
  $('[data-a=skip]', el).onclick = async () => {
    await wsCall({ t: 'question.reply', sessionId: current, reqId: e.reqId, skip: true }).catch(() => {});
    el.innerHTML = `<span class="dim">${t('Atlandı')}</span>`;
  };
  return el;
}

function notify(text) {
  toast(text);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('kmy terminal', { body: text });
}

// ── Çalışma göstergesi ───────────────────────────
let workingEl = null;
function showWorking() {
  hideWorking();
  workingEl = h(`<div class="working"><span class="spinner"></span><span class="wt">${t('Çalışıyor…')}</span><kbd>Esc</kbd><span class="dim">${t('durdur')}</span></div>`);
  log.append(workingEl);
  $('#chatSend').innerHTML = ICON.stop;
  $('#chatSend').title = t('Durdur (Esc)');
  $('#cmHint').textContent = t('Esc ile durdur');
  $('#chatSend').classList.add('stop');
  scrollEnd();
}
function hideWorking() {
  workingEl?.remove(); workingEl = null;
  $('#chatSend').innerHTML = ICON.send;
  $('#chatSend').title = t('Gönder (Enter)');
  $('#cmHint').textContent = t('↵ gönder · / komutlar');
  $('#chatSend').classList.remove('stop');
}
setInterval(() => {
  if (!workingEl) return;
  const j = state.jobs.find((x) => x.id === current);
  $('.wt', workingEl).textContent = `${j?.activity ? tx(j.activity) : t('Çalışıyor')} · ${ago(runStart)}`;
  log.append(workingEl);
}, 1000);

let ctxWarned = 0;
const kTok = (n) => `${num(n / 1000, 0)}k`;
function updateStats() {
  $('#stCost').textContent = !paid(sessionProvider) && !sessCost ? t('abonelik') : `$${num(sessCost, 2)}`;
  $('#stTurns').textContent = sessTurns;
  const p = lastCtx && ctxWindow ? (lastCtx / ctxWindow) * 100 : null;
  $('#stCtx').textContent = lastCtx ? `${kTok(lastCtx)}${ctxWindow ? `/${kTok(ctxWindow)} (${num(p, 0)}%)` : ''}` : '–';
  const bar = $('#stCtxBar');
  bar.style.width = `${Math.min(p || 0, 100)}%`;
  bar.className = p >= 90 ? 'hi' : p >= 50 ? 'mid' : '';
  if (p >= 95 && ctxWarned < 95) { ctxWarned = 95; toast(t('Bağlam penceresi %95 dolu. /compact ile sıkıştırın veya /yeni ile yeni oturum açın.'), 'err', 9000); }
  else if (p >= 80 && ctxWarned < 80) { ctxWarned = 80; toast(t('Bağlam penceresi %80 dolu. /compact ile sıkıştırabilirsiniz.'), '', 7000); }
  fitSelects(); // istatistik metni genişleyince satır yeniden ölçülür
}

// ── Canlı olaylar ─────────────────────────────────
let awaitingNew = false;
on('ws:agent', (e) => {
  if (e.type === 'session.created' && awaitingNew && !current) { awaitingNew = false; current = e.sessionId; localSet('session', current); }
  if (e.type === 'session.created' || e.type === 'run.end') loadSessions();
  if (e.sessionId !== current) {
    if (e.type === 'permission.request' || e.type === 'question') toast(t('Başka bir oturum yanıt bekliyor: {what}', { what: e.tool ? toolLabel(e.tool) : t('soru') }));
    return;
  }
  if (e.type === 'run.start') { running = true; runStart = e.startedAt; showWorking(); return; }
  if (e.type === 'run.end') { running = false; hideWorking(); for (const r of $$('.tool-run', log).slice(-3)) drawRun(r); return; }
  if (e.type === 'user') return;
  renderEvent(e);
  if (workingEl) log.append(workingEl);
});

// ── Ekler ─────────────────────────────────────────
function drawAttachments() {
  const el = $('#attachList');
  el.hidden = !attachments.length;
  el.innerHTML = attachments.map((a, i) => `<span class="attach">${a.type?.startsWith('image/') ? '🖼' : '📄'} ${esc(a.name)} <span class="dim">${a.size < 1024 ? `${a.size} B` : `${num(a.size / 1024, 0)} KB`}</span><button class="x" data-rm="${i}" title="${t('Kaldır')}" aria-label="${t('Eki kaldır')}">✕</button></span>`).join('');
  $$('[data-rm]', el).forEach((b) => b.onclick = () => { attachments.splice(Number(b.dataset.rm), 1); drawAttachments(); });
}
async function uploadFiles(files) {
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) { toast(t('{name}: dosya çok büyük (en fazla 10 MB)', { name: f.name }), 'err'); continue; }
    try {
      const r = await api(`/chat/upload?name=${encodeURIComponent(f.name || 'gorsel.png')}`, { method: 'POST', body: f, raw: true });
      attachments.push({ path: r.path, name: r.name, size: r.size, type: f.type });
      drawAttachments();
    } catch (e) { toast(`${f.name}: ${tx(e.message)}`, 'err'); }
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
  if (state.selected) parts.push(t('seçili sembol {s}', { s: state.selected }));
  if (state.openReport) parts.push(t('açık rapor: workspace/reports/{file}', { file: state.openReport }));
  if (state.openKap) parts.push(t('açık KAP bildirimi: id {id} — {title} ({stocks})', { id: state.openKap.id, title: state.openKap.title || '', stocks: (state.openKap.stocks || []).join(', ') }));
  return parts.join('; ');
}
function buildContext() {
  const parts = [];
  if (ctxSym && state.selected) {
    const q = state.quotes[state.selected];
    parts.push(q
      ? t('Ekranda seçili sembol: {s} ({name}), fiyat {price} {currency}{delayed}, günlük %{pct}', { s: state.selected, name: q.name, price: q.price, currency: q.currency, delayed: q.delayed ? ` ${t('(~15 dk gecikmeli)')}` : '', pct: q.changePct?.toFixed(2) })
      : t('Ekranda seçili sembol: {s}', { s: state.selected }));
  }
  if (ctxScreen) parts.push(screenContext());
  return parts.join('\n') || null;
}

async function send(text, { context } = {}) {
  text = (text ?? input.value).trim();
  if (!text && !attachments.length) return;
  // Yerel komutlar (/durdur, /status, /help…) ajan çalışırken de kullanılabilir; istem gönderen komutlar beklemeli
  const cmd = text.startsWith('/') ? findCmd(text.split(/\s+/)[0].toLowerCase()) : null;
  if (cmd && !(running && cmd.fn) && (await handleSlash(text))) { input.value = ''; autosize(); slash.hidden = true; drawQuick(); return; }
  if (running) { toast(t('Asistan hâlâ çalışıyor. Durdurun veya yeni oturum açın.'), 'err'); return; }
  if (!text) text = t('Eklediğim dosyaları incele ve özetle.');
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
// c: komut · arg: argüman ipucu · d: açıklama · fn: asistana giden istem · tr / en: diğer adlar (en[0] İngilizce arayüzde gösterilen ad)
const sym = (a) => a || state.selected || '';
const SLASH = [
  { c: '/yeni', arg: '[ad]', d: 'Yeni oturum başlat (ör. /yeni Bankalar)', en: ['/new'] },
  { c: '/temizle', d: 'Sohbeti ve bağlamı temizle (yeni oturum)', en: ['/clear'] },
  { c: '/durdur', d: 'Yanıtı durdur (Esc)', en: ['/stop'] },
  { c: '/analiz', arg: 'sembol', d: 'Kapsamlı hisse analizi ve rapor', fn: (a) => t('{s} için kapsamlı analiz yap: iş modeli, son finansal sonuçlar, değerleme (get_fundamentals), teknik görünüm, son KAP bildirimleri, riskler. Sonucu HTML rapor olarak kaydet ve bana kısa özet ver.', { s: sym(a) }), en: ['/analyze'] },
  { c: '/hizli', arg: 'sembol', d: 'Hızlı analiz', fn: (a) => quickPrompt(sym(a)), en: ['/quick'] },
  { c: '/teknik', arg: 'sembol', d: 'Teknik analiz', fn: (a) => t('{s} için teknik analiz: trend, destek/direnç seviyeleri, RSI, MACD, hareketli ortalamalar, hacim. Maddeler halinde özetle.', { s: sym(a) }), en: ['/technical'] },
  { c: '/karsilastir', arg: 'semboller…', d: 'Hisseleri karşılaştır', fn: (a) => t('Şu hisseleri karşılaştır: {list}. Fiyat performansı, temel oranlar (get_fundamentals), teknik görünüm, temettü ve son KAP bildirimleri açısından tablo halinde göster.', { list: a }), en: ['/compare'] },
  { c: '/piyasa', d: 'Günlük piyasa özeti', fn: () => t('Bugünkü piyasa özetini çıkar: BIST endeksleri, döviz/altın, en çok yükselen/düşen hisseler, sektör performansı ve izleme listemdeki dikkat çeken hareketler.'), en: ['/market'] },
  { c: '/portfoy', d: 'Portföy değerlendirmesi', fn: () => t('Portföyümü değerlendir: performans (TWR, XIRR), risk metrikleri, yoğunlaşma, temettü geliri, kur farkı ve pozisyonlarımla ilgili son KAP bildirimleri.'), en: ['/portfolio'] },
  { c: '/kap', arg: '[sembol]', d: 'Son KAP sinyalleri (sembolle: asistan incelemesi)', fn: (a) => t('{s} için son 30 günün KAP bildirimlerini incele; önemli olanların içeriğini get_kap_detail ile oku ve özetle.', { s: a }) },
  { c: '/tarama', arg: 'koşul', d: 'Hisse tara', fn: (a) => t('screen_stocks aracıyla şu kritere göre BIST hisselerini tara: {criteria}. Sonuçları tablo halinde göster ve öne çıkanları kısaca yorumla.', { criteria: a || t('BIST 100, F/K ≤ 8, PD/DD ≤ 1,5') }), en: ['/screen'] },
  { c: '/temettu', d: 'Temettü analizi', fn: () => t('Portföyümün temettü gelirini ve ilan edilmiş yaklaşan temettüleri analiz et; temettü verimi yüksek BIST hisselerinden izleme listeme eklenebilecek adayları gerekçeleriyle listele.'), en: ['/dividends'] },
  { c: '/rapor', arg: 'konu', d: 'HTML rapor hazırla', fn: (a) => t('"{topic}" konusunda ayrıntılı bir HTML rapor hazırla (tablolar ve gerekiyorsa SVG grafiklerle) ve mcp__borsa__save_report ile kaydet.', { topic: a }), en: ['/report'] },
  { c: '/ekran', d: 'Ekranda açık olanı bağlam olarak ekle', en: ['/onscreen'] },
  { c: '/model', arg: 'model', d: 'Modeli değiştir' },
  { c: '/think', arg: 'low|medium|high|xhigh|max', d: 'Düşünme seviyesi', tr: ['/efor'] },
  { c: '/compact', d: 'Bağlamı özetleyerek küçült (Claude)' },
  { c: '/context', d: 'Bağlam kullanımını göster (Claude)' },
  { c: '/cost', d: 'Oturum maliyeti', tr: ['/maliyet'] },
  { c: '/status', d: 'Oturum durumu ve istatistikler', tr: ['/durum'] },
  { c: '/rename', arg: 'yeni ad', d: 'Oturumu yeniden adlandır', tr: ['/adlandir'] },
  { c: '/export', d: 'Sohbeti JSON olarak indir', tr: ['/indir'] },
  { c: '/doctor', d: 'Sunucu ve sağlayıcıları kontrol et', tr: ['/saglik'], en: ['/doctor', '/health'] },
  { c: '/settings', d: 'Ayarları aç', tr: ['/ayarlar'] },
  { c: '/help', d: 'Komut listesi', tr: ['/yardim'] },
];
const cmdNames = (x) => [x.c, ...(x.tr || []), ...(x.en || [])];
// Arayüz İngilizceyse İngilizce ad öne çıkar; Türkçe adlar her iki dilde de çalışır
const cmdName = (x) => (lang === 'en' && x.en?.[0]) || x.c;
const cmdAliases = (x) => (lang === 'en' ? x.en || [] : [...(x.tr || []), ...(x.en || [])]).filter((a) => a !== cmdName(x));
const findCmd = (cmd) => SLASH.find((x) => cmdNames(x).includes(cmd));

async function handleSlash(text) {
  const [raw, ...rest] = text.split(/\s+/);
  const cmd = raw.toLowerCase();
  const arg = rest.join(' ').trim();
  const c = findCmd(cmd);
  if (!c) return false;
  const found = (v) => (v ? `✓ ${esc(v)}` : t('✗ bulunamadı'));
  switch (c.c) {
    case '/yeni': case '/temizle':
      openSession(null);
      pendingTitle = c.c === '/yeni' && arg ? arg.slice(0, 80) : null;
      toast(c.c === '/temizle' ? t('Yeni oturum açıldı; bağlam temizlendi') : pendingTitle ? t('Yeni oturum: {title}', { title: pendingTitle }) : t('Yeni oturum'));
      return true;
    case '/durdur': if (current) wsCall({ t: 'chat.stop', sessionId: current }).catch(() => {}); return true;
    case '/ekran': ctxScreen = !ctxScreen; localSet('ctxScreen', ctxScreen); if (arg) { ctxScreen = true; send(arg); } else toast(t(ctxScreen ? 'Ekran bağlamı (seçili sembol, açık rapor veya KAP bildirimi) mesajlara eklenecek' : 'Ekran bağlamı kapatıldı')); return true;
    case '/model': {
      const opts = [...$('#optModel').options];
      const hit = arg && opts.find((o) => o.value.toLowerCase().includes(arg.toLowerCase()) || o.textContent.toLowerCase().includes(arg.toLowerCase()));
      if (hit && !hit.disabled) { $('#optModel').value = hit.value; toast(`${t('Model')}: ${hit.textContent}`); }
      else systemCard(`<b>${t('Modeller')}</b><br>${opts.map((o) => `${esc(o.textContent)} <span class="dim mono">${esc(o.value || t('varsayılan'))}</span>`).join('<br>')}<br><span class="dim">${t('Kullanım: {usage}', { usage: '/model sonnet' })}</span>`);
      return true;
    }
    case '/think': {
      const lv = arg.toLowerCase();
      if ((state.meta?.efforts || []).includes(lv)) { $('#optEffort').value = lv; fitSelects(); toast(t('Düşünme seviyesi: {level}', { level: effortName(lv) })); }
      else systemCard(esc(t('Kullanım: {usage}', { usage: `${cmdName(c)} ${(state.meta?.efforts || []).join('|')}` })));
      return true;
    }
    case '/compact': case '/context':
      if (!current) { toast(t('Önce bir oturum başlatın'), 'err'); return true; }
      if (!paid(sessionProvider)) { toast(t('Bu komut yalnızca Claude oturumlarında çalışır'), 'err'); return true; }
      return false; // send() olduğu gibi iletir
    case '/cost': {
      const s = sessions.find((x) => x.id === current);
      systemCard(`<b>${t('Oturum maliyeti')}</b><br>${esc(t('Sağlayıcı: {name}', { name: provName(sessionProvider) }))}<br>${esc(t('Bu oturum: {cost}', { cost: paid(sessionProvider) || sessCost ? '$' + num(s?.cost_usd ?? sessCost, 4) : t('aboneliğe veya kendi hesabınıza dahil') }))}<br>${t('Tüm oturumlar (Claude): {cost}', { cost: `$${num(sessions.reduce((a, x) => a + (x.cost_usd || 0), 0), 3)}` })}`);
      return true;
    }
    case '/status': {
      const s = sessions.find((x) => x.id === current);
      const ctxTxt = !lastCtx ? '—' : ctxWindow
        ? t('{used} / {total} bin token (%{pct})', { used: num(lastCtx / 1000, 1), total: num(ctxWindow / 1000, 0), pct: num((lastCtx / ctxWindow) * 100, 0) })
        : t('{used} bin token', { used: num(lastCtx / 1000, 1) });
      systemCard(`<b>${t('Oturum durumu')}</b><br>${s ? `${esc(t('Başlık: {title}', { title: sessTitle(s) }))}<br>${t('Kimlik: {id}', { id: `<span class="mono">${esc(s.id)}</span>` })}<br>${esc(t('Sağlayıcı: {name} · model: {model}', { name: provName(s.provider), model: s.model || t('varsayılan') }))}<br>${esc(t('Oluşturuldu: {created} · son etkinlik: {updated}', { created: dateTR(sqlDate(s.created_at), true), updated: dateTR(sqlDate(s.updated_at), true) }))}<br>` : `${t('Yeni oturum (henüz mesaj yok)')}<br>`}${t('Durum: {state}', { state: t(running ? 'çalışıyor' : 'boşta') })}<br>${esc(t('Bağlam: {text}', { text: ctxTxt }))}<br>${esc(t('İzin modu: {mode}', { mode: state.meta?.permissionModes?.[permMode] ? tx(state.meta.permissionModes[permMode]) : permMode }))}`);
      return true;
    }
    case '/rename': if (!current) { toast(t('Önce bir oturum başlatın'), 'err'); return true; } await renameSession(current, null, arg || null); return true;
    case '/export': exportChat(); return true;
    case '/doctor': {
      const hl = await api('/health').catch(() => null);
      const conn = await api('/agent/connections').catch(() => null);
      systemCard(hl ? `<b>${t('Sağlık kontrolü')}</b><br>${esc(t('Sunucu: ✓ v{version} · Node {node} · {min} dakikadır çalışıyor', { version: hl.version, node: hl.node, min: Math.round(hl.uptimeSec / 60) }))}<br>Claude CLI: ${found(hl.claudeCli)}<br>Codex CLI: ${found(hl.codexCli)}<br>omp CLI: ${found(hl.ompCli)}<br>Terminal: ${hl.terminal ? '✓' : '✗'} · BIST: ${esc(tx(hl.market.label))}${conn?.mcp?.length ? `<br>MCP: ${conn.mcp.map((m) => `${esc(m.name)} ${m.status === 'connected' ? '✓' : m.status === 'failed' ? '✗' : '…'}`).join(' · ')}` : `<br><span class="dim">${t('MCP bağlantıları ilk Claude yanıtından sonra listelenir (Ayarlar › Bağlantılar).')}</span>`}` : `<span class="down">${t('Sunucuya ulaşılamadı')}</span>`);
      return true;
    }
    case '/kap': {
      if (arg) { send(c.fn(arg)); return true; }
      // Argümansız: izleme listesi + portföy için son 3 günün önemli sinyalleri, ajan maliyeti olmadan
      const [w, p] = await Promise.all(['watchlist', 'portfolio'].map((sc) => api(`/kap?scope=${sc}&days=3&limit=60`).catch(() => ({ items: [] }))));
      const seen = new Set();
      const items = [...(w.items || []), ...(p.items || [])].filter((x) => (seen.has(x.id) ? false : seen.add(x.id)) && ['TEZ', 'YAPISAL', 'FINANSAL'].includes(x.signal))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 12);
      const lbl = state.meta?.kapSignals || {};
      const el = systemCard(items.length ? `<b>${t('Son 3 günün KAP sinyalleri')}</b> <span class="dim">${t('(izleme listesi ve portföy)')}</span><br>${items.map((x) => `<span class="dim">${esc(x.publishDate.slice(0, 16))}</span> <span class="pill sig-${esc(x.signal)}">${esc(lbl[x.signal]?.label ? tx(lbl[x.signal].label) : x.signal)}</span> <b class="mono">${esc(x.stocks.slice(0, 2).join(', '))}</b> ${esc(x.subject || '')} <button class="ghost" data-kap="${x.id}">${t('aç')}</button>`).join('<br>')}<br><span class="dim">${esc(t('Asistanın yorumu için: /kap sembol'))}</span>`
        : t('Son 3 günde izleme listesi ve portföydeki şirketler için önemli KAP sinyali yok.'));
      $$('[data-kap]', el).forEach((b) => b.onclick = () => emit('kap:open', Number(b.dataset.kap)));
      return true;
    }
    case '/settings': emit('settings:open'); return true;
    case '/help': systemCard(`<b>${t('Komutlar')}</b><br>${SLASH.map((x) => `<span class="mono accent">${cmdName(x)}</span>${x.arg ? ` <span class="dim mono">${esc(t(x.arg))}</span>` : ''} — ${esc(t(x.d))}${cmdAliases(x).length ? ` <span class="dim mono">(${cmdAliases(x).join(', ')})</span>` : ''}`).join('<br>')}`); return true;
    default:
      if (c.fn) { send(c.fn(arg)); return true; }
      return false;
  }
}

const slash = $('#slash');
let slashSel = 0, slashItems = [];
// Komut grupları (popup'ta başlık altında listelenir)
const SLASH_GROUPS = [
  ['Analiz', ['/analiz', '/hizli', '/teknik', '/karsilastir', '/piyasa', '/portfoy', '/kap', '/tarama', '/temettu', '/rapor', '/ekran']],
  ['Oturum', ['/yeni', '/temizle', '/durdur', '/rename', '/export', '/compact', '/context']],
  ['Asistan', ['/model', '/think']],
  ['Bilgi', ['/cost', '/status', '/doctor', '/settings', '/help']],
];
function drawSlash() {
  const v = input.value;
  if (!v.startsWith('/') || v.includes(' ')) { slash.hidden = true; return; }
  const q = v.toLowerCase();
  const hit = (x) => cmdNames(x).some((a) => a.startsWith(q));
  const groups = SLASH_GROUPS.map(([g, cmds]) => [t(g), cmds.map((c) => SLASH.find((x) => x.c === c)).filter((x) => x && hit(x))]).filter(([, l]) => l.length);
  const rest = SLASH.filter((x) => hit(x) && !SLASH_GROUPS.some(([, c]) => c.includes(x.c)));
  if (rest.length) groups.push([t('Diğer'), rest]);
  slashItems = groups.flatMap(([, l]) => l);
  slash.hidden = !slashItems.length;
  slashSel = Math.min(slashSel, Math.max(slashItems.length - 1, 0));
  const mark = (c) => `<b>/</b>${q.length > 1 && c.startsWith(q) ? `<u>${esc(c.slice(1, q.length))}</u>${esc(c.slice(q.length))}` : esc(c.slice(1))}`;
  let n = 0;
  slash.innerHTML = `<div class="sl-list">${groups.map(([g, l]) => `<div class="sl-grp">${esc(g)}</div>${l.map((x) => {
    const i = n++;
    const al = cmdAliases(x);
    return `<button class="sl-row ${i === slashSel ? 'sel' : ''}" data-i="${i}"><span class="sl-cmd">${mark(cmdName(x))}</span>${x.arg ? `<span class="sl-arg">${esc(t(x.arg))}</span>` : ''}<span class="sl-txt">${esc(t(x.d))}</span>${al.length ? `<span class="sl-alias">${esc(al.join(' '))}</span>` : ''}</button>`;
  }).join('')}`).join('')}</div>
    <div class="sl-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${t('seç')}</span><span><kbd>Tab</kbd> ${t('tamamla')}</span><span><kbd>↵</kbd> ${t('çalıştır')}</span><span><kbd>Esc</kbd> ${t('kapat')}</span></div>`;
  $('.sl-row.sel', slash)?.scrollIntoView({ block: 'nearest' });
}
slash.addEventListener('mousedown', (e) => { const b = e.target.closest('.sl-row'); if (!b) return; e.preventDefault(); input.value = cmdName(slashItems[b.dataset.i]) + ' '; slash.hidden = true; input.focus(); });
slash.addEventListener('mousemove', (e) => { const b = e.target.closest('.sl-row'); if (b && Number(b.dataset.i) !== slashSel) { slashSel = Number(b.dataset.i); $$('.sl-row', slash).forEach((x) => x.classList.toggle('sel', x === b)); } });

function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; }
input.addEventListener('input', () => { autosize(); drawSlash(); drawQuick(); });
input.addEventListener('keydown', (e) => {
  if (!slash.hidden) {
    if (e.key === 'ArrowDown') { slashSel = Math.min(slashSel + 1, slashItems.length - 1); drawSlash(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { slashSel = Math.max(slashSel - 1, 0); drawSlash(); e.preventDefault(); return; }
    if (e.key === 'Tab' || (e.key === 'Enter' && slashItems[slashSel] && !cmdNames(slashItems[slashSel]).includes(input.value.trim().toLowerCase()))) {
      e.preventDefault(); input.value = cmdName(slashItems[slashSel]) + ' '; slash.hidden = true; return;
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
  $('summary', el).innerHTML = `<span class="caret">▸</span> ${t('Komite ({n} üye)', { n: committee.length })}${subs.length ? ` <span class="accent">· ${t('{n} çalışıyor', { n: subs.length })}</span>` : ''}`;
  const row = (name, desc, list) => `<div class="km"><span class="dot ${list.length ? 'live' : ''}"></span><b class="mono">${esc(name)}</b><span class="km-d">${list.length ? list.map((x) => `${esc(tx(x.description))} · ${t('{n} araç', { n: x.tools })} · ${ago(x.startedAt)}`).join(' | ') : esc(desc)}</span>${list.length ? `<button class="ghost xs" data-open="${esc(list[0].job.id)}">${t('aç')}</button>` : ''}</div>`;
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

// ── Seçenekler (izin modu Ayarlar › Bağlantı › Agent varsayılanlarından gelir) ─────────
// Model listesi sağlayıcıya göre gruplanır; oturumun sağlayıcısı sabittir
// Seçicide yalnız gerçek model adları: açık oturumun modeli, yoksa ayardaki / sağlayıcının kendi varsayılan modeli.
// Sağlayıcının varsayılanı seçiliyse model boş gönderilir (Claude Code kendi ayarını, ör. 1M bağlamı, kullanır).
const baseId = (id) => String(id || '').replace(/\[.*\]$/, '');
function pickModel() {
  const o = $('#optModel').selectedOptions[0];
  const provider = o?.dataset.prov || 'claude', id = o?.dataset.id || '';
  const key = provider === 'claude' ? 'model' : `${provider}Model`;
  const isDefault = !state.settings[key] && id === baseId(state.meta?.defaultModels?.[provider]);
  return { provider, model: isDefault ? '' : id };
}
function fillModels() {
  const m = state.meta, s = state.settings, d = m.defaultModels || {};
  const listOf = (p) => {
    const base = (p === 'claude' ? m.models : m.providerModels?.[p] || (p === 'codex' ? m.codexModels : []) || []).filter((x) => x.id);
    const extra = [s[p === 'claude' ? 'model' : `${p}Model`], d[p]].map(baseId).filter((id) => id && !base.some((x) => x.id === id));
    return [...base, ...[...new Set(extra)].map((id) => ({ id, label: id }))];
  };
  const prov = sessionProvider || s.provider || 'claude';
  const sess = sessions.find((x) => x.id === current);
  // Açık oturumun kaydettiği model > ayar > sağlayıcı varsayılanı
  const sessModel = sess && (sess.provider || 'claude') === prov ? baseId(sess.model) : '';
  const want = sessModel || baseId(prov === 'claude' ? s.model : s[`${prov}Model`]) || baseId(d[prov]);
  const short = (x) => x.label.replace(/^Claude /, '').replace(/\s*\([^)]*\)$/, '');
  const group = (p) => `<optgroup label="${esc(provName(p))}">${listOf(p).map((x) => `<option value="${p}|${esc(x.id)}" data-prov="${p}" data-id="${esc(x.id)}" title="${esc(x.label)}" ${sessionProvider && sessionProvider !== p ? 'disabled' : ''} ${p === prov && (x.id === want || want.startsWith(x.id)) ? 'selected' : ''}>${esc(short(x))}</option>`).join('')}</optgroup>`;
  $('#optModel').innerHTML = Object.keys(m.providers || { claude: 1 }).map(group).join('');
  $('#optModel').title = t(sessionProvider ? 'Model (oturumun sağlayıcısı sabittir; değiştirmek için yeni oturum açın)' : 'Model');
  syncEffort();
  requestAnimationFrame(fitSelects);
}
// Düşünme seviyesi: Claude'da sabit liste, omp modellerinde modelin kendi desteklediği seviyeler.
function syncEffort() {
  const sel = $('#optEffort'), box = sel.parentElement;
  const p = pickModel().provider;
  // pickModel() varsayılan modelde boş id döner ("sağlayıcının kendi varsayılanını kullan" kuralı,
  // Claude'da doğru). omp'de her model adıyla seçilir; boş id ile arama bulamazdı.
  const selId = pickModel().model || $('#optModel').selectedOptions[0]?.dataset.id || '';
  const model = (state.meta?.providerModels?.[p] || []).find((x) => x.id === baseId(selId));
  const list = p === 'claude' ? (state.meta?.efforts || []) : (model?.thinking || null);
  // Gizliyken eski seçenekleri temizle: gizli bir <select> dolu kalırsa model değişince
  // yanlış seviye gönderilir ve kullanıcı seçiciyi görüp "seçemiyorum" der.
  if (p !== 'claude' && !list?.length) { box.hidden = true; sel.innerHTML = ''; return; }
  box.hidden = false;
  const cur = sel.value || state.settings.effort || 'medium';
  sel.innerHTML = (list || []).map((x) => `<option value="${x}" ${x === cur ? 'selected' : ''} title="${EFFORT_TIP[x] ? t(EFFORT_TIP[x]) : ''}">${esc(effortName(x))}</option>`).join('');
}
function syncProvider() { fillModels(); updateStats(); }
// Açık oturumun sağlayıcısı sabittir; başka bir sağlayıcı seçilirse mesaj sessizce eski
// sağlayıcıya gider. Kullanıcıyı bilgilendir, yoksa "omp seçtim" deyip Claude'a yazdırır.
let warnedProvider = '';
$('#optModel').onchange = () => {
  const p = pickModel().provider;
  if (sessionProvider && p !== sessionProvider) {
    if (warnedProvider !== p) { warnedProvider = p; toast(t('Açık oturum {p} sağlayıcısında. {q} ile konuşmak için yeni oturum açın.', { p: provName(sessionProvider), q: provName(p) }), 'err', 7000); }
  }
  syncEffort();
  fitSelects();
};

// Seçici genişliği seçili yazıya göre (en uzun seçeneğe göre değil); ok ve kenar boşluğu dahil
const measureCtx = document.createElement('canvas').getContext('2d');
function fitSelect(sel) {
  if (!sel || !sel.selectedOptions[0]) return;
  const cs = getComputedStyle(sel);
  measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const w = measureCtx.measureText(sel.selectedOptions[0].textContent).width;
  sel.style.width = `${Math.ceil(w + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2)}px`;
}
// Dar panelde satır kırpılmasın: önce ctx çubuğu, sonra seçiciler kısalır, yetmezse seçiciler kendi satırına geçer
function fitSelects() {
  const top = $('.cm-top'), bar = $('.ctxbar');
  const spacer = $('.spacer', top);
  const sels = ['#sessSel', '#optModel', '#optEffort'].map((q) => $(q)).filter((s) => s && !s.closest('.cm-chip').hidden);
  sels.forEach((s) => { s.style.maxWidth = ''; fitSelect(s); });
  if (!top) return;
  if (bar) { bar.style.display = ''; bar.style.width = ''; }
  top.style.flexWrap = '';
  if (spacer) { spacer.style.flexBasis = ''; spacer.style.height = ''; }
  const gap = () => top.scrollWidth - top.clientWidth;
  let over = gap();
  if (over > 0 && bar) {
    bar.style.width = `${Math.max(20, 80 - over)}px`;
    if ((over = gap()) > 0) { bar.style.display = 'none'; over = gap(); }
  }
  if (over > 0) {
    const ws = sels.map((s) => s.offsetWidth), total = ws.reduce((a, b) => a + b, 0);
    sels.forEach((s, i) => { s.style.maxWidth = `${Math.max(40, Math.round(ws[i] - (over * ws[i]) / total))}px`; });
    over = gap();
  }
  if (over <= 0) return;
  // Alt satıra kaydır: istatistikler kırpılmadan tam görünür
  top.style.flexWrap = 'wrap';
  if (spacer) { spacer.style.flexBasis = '100%'; spacer.style.height = '0'; }
}
new ResizeObserver(fitSelects).observe($('.cm-top'));
$('#optEffort').addEventListener('change', fitSelects);
$('#sessSel').addEventListener('change', fitSelects);

// Düşünme seviyesi: değer (low…max) sabit, görünen ad çevrilir
const EFFORT_NAME = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', xhigh: 'Çok yüksek', max: 'En yüksek' };
const EFFORT_TIP = { low: 'Kısa işler, düşük maliyet', medium: 'Dengeli', high: 'Karmaşık analiz', xhigh: 'Zor işler', max: 'Tüm düşünme bütçesi' };
const effortName = (x) => (EFFORT_NAME[x] ? t(EFFORT_NAME[x]) : x);
// Yolo şeridi: izin modu bypassPermissions iken görünür, kapanınca DOM'dan da düşer
function markYolo() { $('#cmYolo').hidden = permMode !== 'bypassPermissions'; }
$('#cmYolo').onclick = async () => {
  if (!(await confirmBox(t('Yolo modu kapatılsın mı? Ajan bundan sonra araç kullanmadan önce onay isteyecek.'), { ok: t('Yolo modunu kapat') }))) return;
  try { await api('/settings', { method: 'PUT', body: { permissionMode: 'default', yoloUntil: 0 } }); toast(t('Yolo modu kapatıldı'), 'ok'); } catch (e) { toast(tx(e.message), 'err'); }
};
function fillOptions() {
  const m = state.meta, s = state.settings;
  if (!m) return;
  syncProvider();
  syncEffort();
  permMode = s.permissionMode || 'default';
  markYolo();
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

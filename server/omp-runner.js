// oh-my-pi (omp) sağlayıcısı: `omp --mode rpc-ui` süreci (JSON satırları). Olaylar Claude olaylarıyla aynı biçime çevrilir.
// Araçlar: workspace/.omp/mcp.json → server/mcp-stdio.js (Codex ile aynı köprü; omp MCP araçlarını xd://mcp__borsa_<araç> olarak bağlar).
// Talimatlar: omp AGENTS.md / CLAUDE.md ve .claude/skills dosyalarını çalışma alanından kendisi okur.
// İzinler: rpc-ui modunda omp onay isteklerini extension_ui_request (select: Approve/Deny) olarak yollar; arayüzün izin kartına bağlanır.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, execFile } from 'node:child_process';
import { WORKSPACE_DIR, ROOT } from './paths.js';
import { AUTO_TOOLS, mintScopedToken } from './agent-tools.js';

const MCP_STDIO = path.join(ROOT, 'server', 'mcp-stdio.js');
const MCP_FILE = path.join(WORKSPACE_DIR, '.omp', 'mcp.json');
const KILL_GRACE = 5000;

// ── CLI bulma ─────────────────────────────────────────────
let bin; // undefined: aranmadı, null: yok
export function ompBin() {
  if (bin !== undefined) return bin;
  const dirs = [...String(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.bun', 'bin')];
  bin = null;
  for (const d of dirs.filter(Boolean)) {
    const f = path.join(d, 'omp');
    try { fs.accessSync(f, fs.constants.X_OK); bin = f; break; } catch { /* yok */ }
  }
  return bin;
}

// ── Model listesi: `omp models --json` (oturum açılmış sağlayıcılar), önbellekli ──
export const OMP_DEFAULT_MODELS = [
  { id: 'anthropic/claude-opus-5-5', label: 'Claude Opus 5.5 (anthropic)' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 (anthropic)' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5 (anthropic)' },
  { id: 'openai-codex/gpt-5.5', label: 'GPT-5.5 (openai-codex)' },
];
let models = null, modelsAt = 0, loading = null, catalog = new Map(); // catalog: elenen sağlayıcıların modeli de (id → metadata)
const MODELS_TTL = 30 * 60_000;

function loadModels() {
  if (loading || !ompBin()) return loading;
  loading = new Promise((resolve) => execFile(ompBin(), ['models', '--json'], { cwd: os.tmpdir(), timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
    loading = null;
    modelsAt = Date.now();
    try {
      if (err) throw err;
      const all = (JSON.parse(out).models || []).filter((m) => (m.kind || 'chat') === 'chat');
      const count = {};
      for (const m of all) count[m.provider] = (count[m.provider] || 0) + 1;
      // Yüzlerce model listeleyen toplayıcılar (nous, nvidia…) seçiciyi boğar: yalnız küçük sağlayıcılar, tarihli kopyalar hariç
      const pick = (m) => ({ id: m.selector || `${m.provider}/${m.id}`, label: `${m.name || m.id} (${m.provider})`, contextWindow: m.contextWindow || null, thinking: Array.isArray(m.thinking) ? m.thinking : null });
      // Elenen sağlayıcıların modeli de (kullanıcının varsayılanı çoğu kez burada) metadatasıyla
      // saklanır: seçiciye elle eklenirken bağlam penceresi ve düşünme seviyeleri de bilinsin.
      catalog = new Map(all.map((m) => [pick(m).id, pick(m)]));
      const list = all.filter((m) => count[m.provider] <= 40 && m.reasoning && !/-\d{8}$|embed/i.test(m.id)).map(pick);
      if (list.length) models = list;
    } catch (e) {
      console.error('[omp] model listesi alınamadı:', String(e.message || e).slice(0, 200));
    }
    resolve(models);
  }));
  return loading;
}

export function ompModels() {
  if (!ompBin()) return [];
  if (!models || Date.now() - modelsAt > MODELS_TTL) loadModels();
  return models || OMP_DEFAULT_MODELS;
}

// Elenen bir sağlayıcının modeli için metadatası (kullanıcının varsayılanı çoğu kez openrouter'da,
// 560 modeli yüzünden seçici dışı kalıyor). Seçiciye elle eklenirken kullanılır.
export function ompModelMeta(id) { return catalog.get(id) || null; }

// Meta isteği senkron yanıt verdiği için model listesi hazır olana kadar bekleriz:
// aksi hâlde ilk /api/meta çağrısı yalnız OMP_DEFAULT_MODELS döner ve seçici eksik kalır.
export async function ompModelsReady() {
  if (!ompBin()) return [];
  if (!models || Date.now() - modelsAt > MODELS_TTL) await (loadModels() || Promise.resolve());
  return models || OMP_DEFAULT_MODELS;
}

// ── workspace/.omp/mcp.json: borsa stdio MCP sunucusu (varsa diğer sunucular korunur) ──
// Proje klasörü taşınırsa buradaki yol eskir ve MCP köprüsü sessizce ölür; bu yüzden sunucu
// açılışında bir kez çağrılır (runOmp ayrıca her turda doğrular).
export function ensureOmpMcp(env = {}) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(MCP_FILE, 'utf8')); } catch { /* yok */ }
  const want = { command: process.execPath, args: [MCP_STDIO], ...(Object.keys(env).length ? { env } : {}) };
  if (JSON.stringify(cur.mcpServers?.borsa) === JSON.stringify(want)) return false;
  // Eski yol bir başka projeyi gösteriyorsa kullanıcıyı bilgilendir: borsa araçları çalışmayacak
  const stale = cur.mcpServers?.borsa && JSON.stringify(cur.mcpServers.borsa) !== JSON.stringify(want);
  if (stale) console.warn(`[omp] ${MCP_FILE} güncellendi: borsa MCP köprüsü eski yolu gösteriyordu (${cur.mcpServers.borsa.args?.[0] || 'bilinmiyor'}).`);
  const next = { ...cur, mcpServers: { ...(cur.mcpServers || {}), borsa: want } };
  fs.mkdirSync(path.dirname(MCP_FILE), { recursive: true });
  fs.writeFileSync(MCP_FILE, JSON.stringify(next, null, 2) + '\n');
  return true;
}

// omp MCP araçlarını xd:// aygıtı olarak sunar: write(xd://mcp__borsa_get_quotes, JSON) → mcp__borsa__get_quotes
// Sunucu adı beyaz listeye göre eşleştirilir (borsa, context7, claude_ai_*); ayraç olarak bölmek
// "mcp__borsa_get_quotes"ı sunucu=borsa_get, araç=quotes diye ayırıyordu (açgözlü .+). Eşleşmezse null.
export const XD_MCP = /^xd:\/\/mcp__(borsa|context7|claude_ai_Borsa_MCP|claude_ai_Matriks_MCP)_(\w+)$/i;
function toolView(name, args = {}) {
  const p = typeof args.path === 'string' ? args.path : '';
  const m = XD_MCP.exec(p);
  if (m && name === 'write') {
    let input = args.content;
    try { input = JSON.parse(args.content); } catch { /* düz metin */ }
    return { name: `mcp__${m[1]}__${m[2]}`, input: input && typeof input === 'object' ? input : { content: input } };
  }
  const std = { bash: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', grep: 'Grep', find: 'Glob', web_search: 'WebSearch', fetch: 'WebFetch', task: 'Task', todo_write: 'TodoWrite' }[name];
  return { name: std || name, input: args };
}

// Araç etiketi: mcp__sunucu__arac → "arac" (borsa) ya da "sunucu › arac" (diğer MCP sunucuları)
export function toolLabel(name) {
  if (name.startsWith('mcp__borsa__')) return name.slice(12).replace(/_/g, ' ');
  if (name.startsWith('mcp__')) return name.split('__').slice(1).join(' › ');
  return name;
}

const text = (content) => (Array.isArray(content) ? content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') : String(content ?? ''));

// io: { record, emit, jobs, ask(tool, input, signal, canAlways) → Promise<{behavior, updatedInput, updatedPermissions}>, setSdkSession, setCtxWindow, contextNote(), end() }
export function runOmp({ run, session, prompt, model, effort, permissionMode, sys, io }, fresh = false) {
  // Köprüye master gateway anahtarı değil kapsamlı jeton + izin modu verilir (yolo modunda bile anahtar sızmaz)
  const bridgeEnv = { KMY_PERMISSION_MODE: permissionMode || 'default', KMY_SCOPED_TOKEN: mintScopedToken({ sessionId: session.id, mode: permissionMode || 'default' }) };
  try { ensureOmpMcp(bridgeEnv); } catch (e) { console.error('[omp] mcp.json yazılamadı:', e.message); }
  const approval = permissionMode === 'bypassPermissions' ? 'yolo' : permissionMode === 'acceptEdits' ? 'write' : 'always-ask';
  const plan = permissionMode === 'plan';
  const resume = !fresh && session.sdk_session_id;
  const args = ['--mode', 'rpc-ui', '--approval-mode', approval, '--append-system-prompt', sys];
  if (model) args.push('--model', model);
  // Düşünme seviyesi: omp'de --thinking. Geçersiz değer süreci hata koduyla düşürürdü;
  // "minimal"/"off" gibi arayüzde görünmeyen değerler de gelebilir, hepsini süzüyoruz.
  if (effort && /^(off|minimal|low|medium|high|xhigh|max|auto)$/.test(effort)) args.push('--thinking', effort);
  if (resume) args.push('--resume', session.sdk_session_id);

  const started = Date.now();
  const env = { ...process.env };
  Object.assign(env, bridgeEnv);
  delete env.CLAUDECODE;
  const child = spawn(ompBin() || 'omp', args, { cwd: WORKSPACE_DIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const send = (o) => { if (child.stdin.writable) child.stdin.write(JSON.stringify(o) + '\n'); };
  const st = { ready: false, ended: false, stopped: false, turns: 0, cost: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, errors: [], seen: new Set(), ui: new Map(), always: new Set(), pendingTools: new Map() };
  let stderr = '', killTimer = null;
  const finish = () => { if (child.stdin.writable) child.stdin.end(); killTimer ||= setTimeout(() => child.kill('SIGTERM'), KILL_GRACE); };

  run.abort.signal.addEventListener('abort', () => { st.stopped = true; child.kill('SIGTERM'); });
  run.q = { interrupt: async () => { st.stopped = true; send({ id: 'abort', type: 'abort' }); setTimeout(finish, 1500); } };
  child.stdin.on('error', () => {});
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });

  const toolUse = (id, name, args) => {
    if (st.seen.has(id)) return;
    st.seen.add(id);
    const v = toolView(name, args);
    io.record('tool_use', { id, name: v.name, input: v.input });
    io.emit('tool_use', { id, name: v.name, input: v.input });
    run.activity = toolLabel(v.name);
    io.jobs();
  };

  // Onay isteği: "Allow tool: write\nPath: xd://mcp__borsa_get_quotes\n…"
  const approve = async (req) => {
    const m = /^Allow tool: (\S+)/.exec(req.title || '');
    const tool = m?.[1] || 'araç';
    // Onay başlığındaki xd:// yolunu tek seferde çöz: [1]=sunucu, [2]=araç
    const xd = XD_MCP.exec(/Path: (xd:\/\/\S+)/.exec(req.title || '')?.[1] || '');
    const xdTool = xd?.[2];
    const answer = (ok) => send({ type: 'extension_ui_response', id: req.id, value: ok ? 'Approve' : 'Deny' });
    if (plan) return answer(false); // plan modu: değişiklik yapan araç yok
    if (permissionMode === 'bypassPermissions') return answer(true); // yolo: soru kartı üretme (kayıt tool_use'da zaten yazıldı)
    if (xd && xd[1].toLocaleLowerCase('tr') === 'borsa' && AUTO_TOOLS.includes(xdTool)) return answer(true); // salt okunur terminal araçları onaysız
    if (st.always.has(tool)) return answer(true);
    // Onay kartı gerçek isteğin girdisini göstermeli: aynı araç adlı başka bir çağrının argümanlarıyla onaylamak yanlış.
    const same = [...(st.pendingTools?.entries() || [])].filter(([, t]) => t.name === tool);
    const want = String(req.toolCallId || req.targetId || '');
    const call = same.find(([id]) => String(id) === want) || (same.length === 1 ? same[0] : null); // tek eşleşme belirsizlik yok
    const v = call ? toolView(call[1].name, call[1].args) : { name: tool, input: { istek: req.title } };
    if (!call) io.emit('notice', { message: 'Onay kartındaki girdi ayrıştırılamadı; isteği elle doğrula.' });
    const ctl = new AbortController();
    st.ui.set(req.id, ctl);
    const r = await io.ask(v.name, v.input, ctl.signal, true);
    st.ui.delete(req.id);
    if (r.behavior === 'allow' && r.updatedPermissions) st.always.add(tool);
    answer(r.behavior === 'allow');
  };

  // Araç dışı seçim / soru istekleri (omp ask aracı vb.)
  const question = async (req) => {
    const ctl = new AbortController();
    st.ui.set(req.id, ctl);
    const q = { question: req.title || req.message || 'Seçim', header: 'omp', multiSelect: false, options: (req.options || []).map((o) => ({ label: String(o), description: '' })) };
    const r = await io.ask('AskUserQuestion', { questions: [q] }, ctl.signal);
    st.ui.delete(req.id);
    const val = r.behavior === 'allow' ? r.updatedInput?.answers?.[q.question] : undefined;
    if (req.method === 'confirm') send({ type: 'extension_ui_response', id: req.id, confirmed: r.behavior === 'allow' });
    else if (val == null || val === '') send({ type: 'extension_ui_response', id: req.id, cancelled: true });
    else send({ type: 'extension_ui_response', id: req.id, value: Array.isArray(val) ? val[0] : String(val) });
  };

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    switch (ev.type) {
      case 'ready':
        st.ready = true;
        send({ id: 'stats0', type: 'get_session_stats' });
        send({ id: 'prompt', type: 'prompt', message: prompt });
        break;
      case 'response':
        if (ev.id === 'stats0' && ev.success) {
          io.setSdkSession(ev.data?.sessionId);
          if (ev.data?.contextUsage?.contextWindow) io.setCtxWindow(ev.data.contextUsage.contextWindow);
          io.emit('init', { model: model || 'omp', provider: 'omp' });
        } else if (ev.id === 'stats1') {
          if (ev.data?.contextUsage?.contextWindow) io.setCtxWindow(ev.data.contextUsage.contextWindow);
          finish();
        } else if (ev.id === 'prompt' && !ev.success) {
          st.errors.push(ev.error || 'omp istemi reddetti');
          finish();
        }
        break;
      case 'message_start':
        if (ev.message?.role === 'assistant') io.emit('message.start', {});
        break;
      case 'message_update': {
        const a = ev.assistantMessageEvent || {};
        if (a.type === 'text_delta') io.emit('delta', { text: a.delta, index: a.contentIndex });
        else if (a.type === 'thinking_delta') io.emit('thinking.delta', { text: a.delta, index: a.contentIndex });
        break;
      }
      case 'message_end': {
        const m = ev.message || {};
        if (m.role !== 'assistant') break;
        for (const b of m.content || []) {
          if (b.type === 'text' && b.text) { io.record('text', { text: b.text }); io.emit('text', { text: b.text }); }
          else if (b.type === 'thinking' && b.thinking) { io.record('thinking', { text: b.thinking }); io.emit('thinking', { text: b.thinking }); }
        }
        const u = m.usage || {};
        for (const k of Object.keys(st.usage)) st.usage[k] += u[k] || 0;
        st.cost += u.cost?.total || 0;
        if (u.totalTokens) io.emit('usage', { ctx: (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) + (u.output || 0), window: null });
        if (m.stopReason === 'error') st.errors.push(m.errorMessage || 'Model hatası');
        else if (m.stopReason === 'aborted') st.stopped = true;
        break;
      }
      case 'tool_execution_start':
        st.pendingTools.set(ev.toolCallId, { name: ev.toolName, args: ev.args });
        toolUse(ev.toolCallId, ev.toolName, ev.args);
        break;
      case 'tool_execution_end': {
        const t = st.pendingTools.get(ev.toolCallId);
        st.pendingTools.delete(ev.toolCallId);
        toolUse(ev.toolCallId, ev.toolName, t?.args || {});
        const out = text(ev.result?.content);
        const data = { id: ev.toolCallId, isError: !!ev.isError, text: out.length > 20000 ? out.slice(0, 20000) + '\n…(kısaltıldı)' : out };
        io.record('tool_result', data);
        io.emit('tool_result', data);
        run.activity = 'Düşünüyor';
        io.jobs();
        break;
      }
      case 'turn_end': st.turns++; break;
      case 'auto_retry_start': io.emit('notice', { message: `API hatası; yeniden deneniyor ${ev.attempt || ''}${ev.maxAttempts ? '/' + ev.maxAttempts : ''}…` }); break;
      case 'auto_compaction_start': io.emit('notice', { message: 'Bağlam özetlenerek sıkıştırılıyor…' }); break;
      case 'notice':
        if (ev.level === 'error' || ev.level === 'warning') console.error('[omp]', String(ev.message || '').slice(0, 300));
        break;
      case 'extension_ui_request':
        if (ev.method === 'select' && Array.isArray(ev.options) && ev.options.includes('Approve') && ev.options.includes('Deny')) approve(ev).catch(() => {});
        else if (ev.method === 'select' || ev.method === 'confirm') question(ev).catch(() => {});
        else if (ev.method === 'input' || ev.method === 'editor') send({ type: 'extension_ui_response', id: ev.id, cancelled: true });
        else if (ev.method === 'cancel') st.ui.get(ev.targetId)?.abort();
        break;
      case 'agent_end':
        if (ev.willContinue) break;
        st.ended = true;
        send({ id: 'stats1', type: 'get_session_stats' });
        setTimeout(finish, 3000);
        break;
      default: break;
    }
  });

  child.on('error', (e) => {
    const message = e.code === 'ENOENT' ? 'omp CLI bulunamadı. Kurun (brew install omp), ardından omp içinde /login ile giriş yapın.' : e.message;
    st.errors.push(message);
  });

  child.on('close', (code) => {
    clearTimeout(killTimer);
    for (const c of st.ui.values()) c.abort();
    // Kayıtlı omp oturumu silinmişse: yeni omp oturumu + önceki konuşma özeti
    if (!st.ready && resume && /not found/i.test(stderr) && !run.abort.signal.aborted) {
      console.error('[omp] oturum bulunamadı, yeni oturum açılıyor:', session.sdk_session_id);
      io.emit('notice', { message: 'omp oturumu bulunamadı; önceki konuşma özetiyle yeni oturum açıldı.' });
      return runOmp({ run, session, prompt: io.contextNote() + prompt, model, effort, permissionMode, sys, io }, true);
    }
    if (st.stopped || run.abort.signal.aborted) {
      io.record('stopped', { message: 'Kullanıcı durdurdu' });
      io.emit('stopped', {});
    } else if (st.errors.length || (!st.ended && code !== 0)) {
      const tail = stderr.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => /error|fail|login|auth|not found|model/i.test(l)).slice(-3).join(' ');
      if (stderr) console.error('[omp] stderr:', stderr.slice(-800));
      const message = st.errors.at(-1) || `omp ${code} koduyla çıktı. ${tail}`.trim();
      io.record('error', { message: message.slice(0, 500) });
      io.emit('error', { message: message.slice(0, 500) });
    }
    else if (st.ended) {
      // Maliyet: omp API fiyatıyla tahmin eder; abonelik (OAuth) hesaplarında gerçek ödeme değildir → cost 0, tahmin estCost'ta
      const data = { subtype: 'success', isError: false, cost: 0, estCost: Math.round(st.cost * 1e6) / 1e6, durationMs: Date.now() - started, turns: st.turns, usage: st.usage, provider: 'omp' };
      io.record('result', data);
      io.emit('result', data);
    }
    io.end();
  });
}

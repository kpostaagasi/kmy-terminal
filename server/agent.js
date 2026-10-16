// Ajan oturum yöneticisi: Claude (Claude Agent SDK) ve Codex CLI.
// Her kullanıcı mesajı ayrı bir query() çağrısıdır; bağlam `resume` ile SDK oturumundan sürdürülür.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { db, getSettings } from './db.js';
import { effectiveMode } from './yolo.js';
import { WORKSPACE_DIR, ROOT } from './paths.js';
import { buildBorsaServer, AUTO_TOOLS, mintScopedToken } from './agent-tools.js';
import { marketStatus } from './market.js';
import * as memory from './memory.js';

// Claude Code yürütülebilir dosyası: kullanıcının `claude` ikilisi varsa o; yoksa SDK'nın gömülü CLI'si (undefined döner).
const hasBundledCli = (() => { try { createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`); return true; } catch { return false; } })();
// Uygulama Finder'dan açıldığında PATH kısa olabilir: yaygın kurulum yerleri de taranır (resmî kurulum, Homebrew, npm, nvm, volta, bun)
function claudeCandidates() {
  const h = os.homedir();
  const dirs = [...(process.env.PATH || '').split(path.delimiter), path.join(h, '.local', 'bin'), path.join(h, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin',
    path.join(h, '.npm-global', 'bin'), path.join(h, '.volta', 'bin'), path.join(h, '.bun', 'bin'), path.join(h, 'Library', 'pnpm')];
  try { for (const v of fs.readdirSync(path.join(h, '.nvm', 'versions', 'node')).sort().reverse()) dirs.push(path.join(h, '.nvm', 'versions', 'node', v, 'bin')); } catch { /* nvm yok */ }
  const names = process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];
  return [...new Set(dirs.filter(Boolean))].flatMap((d) => names.map((n) => path.join(d, n)));
}
export function claudeExecutable() {
  if (process.env.KMY_CLAUDE_PATH) return process.env.KMY_CLAUDE_PATH;
  for (const f of claudeCandidates()) {
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch { /* yok */ }
  }
  if (hasBundledCli) return undefined;
  throw new Error('Claude Code bulunamadı. Kurun (https://claude.com/download veya: curl -fsSL https://claude.ai/install.sh | bash), ardından Terminal\'de `claude` yazıp giriş yapın ve uygulamayı yeniden açın.');
}

export const PROVIDERS = { claude: 'Claude Code', codex: 'ChatGPT / Codex' };
// Sağlayıcıların gerçek varsayılan modeli (seçicide "varsayılan" yerine modelin adı görünsün):
// Claude: ~/.claude/settings.json → son oturumun kullandığı model → Opus; Codex: ~/.codex/config.toml
const CLAUDE_ALIAS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5-20251001', fable: 'claude-fable-5-1' };
function normClaude(m) {
  if (!m) return null;
  const x = String(m).replace(/\[.*\]$/, '').toLowerCase();
  return CLAUDE_ALIAS[x] || MODELS.find((y) => x.startsWith(y.id) || y.id.startsWith(x))?.id || x;
}
const readFile = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
export function defaultModels() {
  const h = os.homedir();
  let claude = null;
  try { claude = JSON.parse(readFile(path.join(h, '.claude', 'settings.json')) || '{}').model || null; } catch { /* bozuk */ }
  claude ||= db.prepare("SELECT model FROM chat_sessions WHERE provider = 'claude' AND model IS NOT NULL AND model != '' ORDER BY updated_at DESC LIMIT 1").get()?.model || null;
  const codex = readFile(path.join(h, '.codex', 'config.toml')).match(/^model\s*=\s*"([^"]+)"/m)?.[1] || null;
  return { claude: normClaude(claude) || 'claude-opus-5-5', codex };
}
// Model etiketi tek yerden üretilir: sağlayıcı öneki (`openai-codex/gpt-5.5`) atılır,
// kalan son segment okunur biçime çevrilir. `id` asla değişmez — settings.model,
// settings.codexModel kayıtlı değerlerini bu id'ler eşler.
const PREFIX_NAME = { openai: 'OpenAI', 'openai-codex': 'OpenAI', 'xai-oauth': 'xAI', xai: 'xAI', 'opencode-zen': 'openCode', openrouter: 'openRouter', anthropic: 'Anthropic', google: 'Google' };
// Alt grup sağlayıcı önekinden türetilir (bilinmiyorsa null → tek grupta kalır)
const modelGroup = (id) => {
  const p = String(id || '').split('/');
  return p.length > 1 ? PREFIX_NAME[p.slice(0, -1).join('/')] || PREFIX_NAME[p[0]] || null : null;
};
function modelLabel(id, name) {
  const s = String(id || '');
  const clean = (x) => String(x || '').replace(/\s*\([^()]*\)\s*$/, '').trim();
  // Verilen ad zaten okunur biçimse ("GPT-5.5") olduğu gibi kullanılır
  const given = clean(name);
  if (given && !given.includes('/')) return given;
  return (clean(s.slice(s.lastIndexOf('/') + 1)) || s)
    .replace(/\bgpt/gi, 'GPT').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase()).trim();
}
export function providerModels() {
  const d = defaultModels();
  const codex = d.codex ? [{ id: d.codex, label: modelLabel(d.codex), provider: 'codex', group: modelGroup(d.codex) }] : [];
  return { codex };
}
export const providerModelsReady = async () => providerModels();
const MCP_STDIO = path.join(ROOT, 'server', 'mcp-stdio.js');

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
].map((x) => ({ ...x, label: modelLabel(x.id, x.label), provider: 'claude' }));
export const CODEX_MODELS = [];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const PERMISSION_MODES = {
  default: 'Sor (her riskli araç için onay)',
  acceptEdits: 'Dosya düzenlemelerini otomatik onayla',
  plan: 'Sadece plan (dosya değiştirmez)',
  bypassPermissions: 'Otomatik (tüm araçlara izin)',
};

// Sağlayıcı yetenekleri (arayüz izin kipini buna göre çizer)
export const CAPABILITIES = {
  claude: { effort: true, subagent: true, cost: true, bypass: true },
  codex: { effort: false, subagent: false, cost: false, bypass: true },
};
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);
const DATA_CONNECTORS = ['mcp__claude_ai_Borsa_MCP__*', 'mcp__claude_ai_Matriks_MCP__*'];

const PERMISSION_TIMEOUT = 10 * 60_000;
// SDK'nın ham tanı metinleri ([ede_diagnostic] …) kullanıcıya gösterilmez; yalnız sunucu logunda kalır
const NO_REPLY = 'Claude yanıt vermedi. Tekrar gönderin veya /yeni ile yeni oturum açın.';
const isDiag = (m) => /\[ede_diagnostic\]|Claude Code returned an error result/i.test(String(m || ''));
// Sık karşılaşılan kurulum / hesap hatalarını anlaşılır Türkçe yönlendirmeye çevirir (ilk kurulumdaki kullanıcılar için)
export function friendlyError(m) {
  const t = String(m || '');
  if (/invalid api key|please run \/login|not logged in|oauth token|authentication_error|401\b.*auth|login required/i.test(t)) {
    return "Claude hesabına giriş yapılmamış. Ayarlar › Bağlantı › Sağlayıcılar bölümündeki \"Claude ile giriş\" düğmesini kullanın (veya Terminal'de `claude` yazıp /login ile giriş yapın), ardından mesajı yeniden gönderin.";
  }
  if (/executable not found|ENOENT.*claude|spawn .*claude/i.test(t)) return 'Claude Code bulunamadı. Kurun (https://claude.com/download), ardından uygulamayı yeniden açın.';
  if (/unknown option|unrecognized|unexpected argument|requires a newer version|please update/i.test(t)) return "Claude Code sürümü eski. Terminal'de `claude update` çalıştırın, ardından yeniden deneyin.";
  if (/credit balance|usage limit|rate.?limit/i.test(t)) return `Claude kullanım sınırına ulaşıldı: ${t.slice(0, 200)}`;
  return t;
}

function systemAppend(newSession = false, lang = 'tr') {
  const now = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'full', timeStyle: 'short' });
  const ms = marketStatus();
  const rs = memory.radarStatus();
  // Tetikleyici radarı hatırlatması: izlenen tez varsa ve son tarama 7 günden eskiyse, yalnızca oturumun ilk turunda
  const radar = rs.theses && newSession && (rs.daysSince == null || rs.daysSince >= 7)
    ? `\n- Tetikleyici radarı: ${rs.theses} izlenen tez var, son tarama ${rs.lastRun ? `${rs.daysSince} gün önce` : 'hiç yapılmadı'}. Kullanıcının isteğini yanıtladıktan sonra, yanıtın sonunda bir cümleyle tetikleyici radarı taramasını öner (tetikleyici-radar becerisi).`
    : '';
  return `
# kmy terminal bağlamı
- Şu an: ${now} (İstanbul). BIST durumu: ${ms.label}.
- ${lang === 'en' ? 'The user interface is in English: always reply to the user in English (these instructions and the workspace files are in Turkish; keep tool names and file names as they are).' : 'Kullanıcıyla Türkçe konuş.'} Kişisel bir borsa terminalinin içindeki analiz asistanısın.
- Yerel veriler için mcp__borsa__* araçlarını kullan (fiyat, geçmiş, teknik analiz, KAP, portföy, izleme listesi, rapor kaydetme).
- Uzun analizleri mcp__borsa__save_report ile HTML rapor olarak kaydet; sohbette kısa özet ver.
- Rakamları kaynağıyla ver; veri alamadıysan bunu açıkça söyle, uydurma.
- Portföye işlem ekleme gibi yazma işlemlerini yalnızca kullanıcı açıkça isterse yap.
- Araştırma hafızası (workspace/hafiza): mesajda geçen şirketlerin önceki notları istemin başında <arastirma_hafizasi> içinde gelir. Şirket tezi üreten her analizden sonra save_memory ile tezi, kilit rakamları ve tetikleyicileri güncelle.${radar}
`;
}

export class AgentManager extends EventEmitter {
  constructor() {
    super();
    this.running = new Map(); // sessionId -> { abort, q, startedAt, title, pending: Map }
    this.lastInit = null;      // son Claude oturumunun araç/MCP bağlantı durumu (Ayarlar > Bağlantılar)
    this.ctxWindow = new Map(); // sessionId -> model bağlam penceresi (token)
  }

  listSessions() {
    const rows = db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT 200').all();
    return rows.map((r) => ({ ...r, running: this.running.has(r.id) }));
  }

  getSession(id) {
    const s = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    if (!s) return null;
    const events = db.prepare('SELECT id, ts, kind, data FROM chat_events WHERE session_id = ? ORDER BY id').all(id)
      .map((e) => ({ ...e, data: JSON.parse(e.data) }));
    const run = this.running.get(id);
    const pending = run ? [...run.pending.entries()].map(([reqId, p]) => ({ reqId, tool: p.tool, input: p.input, canAlways: !!p.suggestions?.length })) : [];
    return { ...s, running: !!run, events, pending, contextWindow: this.ctxWindow.get(id) || null };
  }

  renameSession(id, title) {
    db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(title, id);
  }

  deleteSession(id) {
    this.stop(id);
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  }

  backgroundJobs() {
    return [...this.running.entries()].map(([id, r]) => ({ id, title: r.title, startedAt: r.startedAt, activity: r.activity || null, subagents: [...r.subagents.values()] }));
  }

  #record(sessionId, kind, data) {
    db.prepare('INSERT INTO chat_events(session_id, kind, data) VALUES(?, ?, ?)').run(sessionId, kind, JSON.stringify(data));
  }

  #emit(sessionId, type, data = {}) {
    this.emit('event', { sessionId, type, ...data });
  }

  async send({ sessionId, text, context, model, effort, permissionMode, provider, title: forcedTitle, attachments = [], lang }) {
    const settings = getSettings();
    text = String(text || '').trim();
    if (!text) throw new Error('Boş mesaj');
    if (sessionId && this.running.has(sessionId)) throw new Error('Bu oturum hâlâ çalışıyor; bitmesini bekleyin veya durdurun');
    let session = sessionId ? db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) : null;
    if (!session) {
      sessionId = crypto.randomUUID();
      const title = forcedTitle || text.replace(/\s+/g, ' ').slice(0, 60);
      provider = PROVIDERS[provider] ? provider : settings.provider || 'claude';
      db.prepare('INSERT INTO chat_sessions(id, title, model, provider) VALUES(?, ?, ?, ?)').run(sessionId, title, model || null, provider);
      session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId);
      this.#emit(sessionId, 'session.created', { session });
    }
    provider = session.provider || 'claude'; // oturumun sağlayıcısı sabittir
    const defModel = { claude: settings.model, codex: settings.codexModel }[provider] || '';
    model = model ?? defModel;
    // Claude oturumuna claude olmayan, Codex oturumuna claude* model kimliği gönderilmez
    if (model && ((provider === 'claude' && !/^claude/i.test(model)) || (provider === 'codex' && /^claude/i.test(model)))) model = defModel;
    effort = effort || settings.effort;
    // Yolo süresi dolduysa (ya da süre yoksa) istemci ne gönderirse göndersin bypass verilmez
    permissionMode = effectiveMode(permissionMode || settings.permissionMode, settings);

    attachments = (attachments || []).filter((a) => a?.path && !a.path.includes('..')).slice(0, 10);
    this.#record(sessionId, 'user', { text, context: context || null, attachments });
    this.#emit(sessionId, 'user', { text, context: context || null, attachments });

    let prompt = context ? `<terminal_context>\n${context}\n</terminal_context>\n\n${text}` : text;
    // Mesajda geçen şirketlerin araştırma notları (şirket hafızası)
    prompt = memory.forPrompt(text) + prompt;
    if (attachments.length) {
      prompt += `\n\n<ekler>\nKullanıcı şu dosyaları ekledi (çalışma alanına göre yol; Read aracıyla oku, görselleri incele):\n${attachments.map((a) => `- ${a.path} (${a.name || ''})`).join('\n')}\n</ekler>`;
    }
    // Claude Code yerleşik komutları (/compact, /context, /cost) doğrudan iletilir
    if (/^\/(compact|context|cost)\b/.test(text) && !context && !attachments.length) prompt = text;
    const abort = new AbortController();
    const run = { abort, startedAt: Date.now(), title: session.title, pending: new Map(), subagents: new Map(), tools: new Map(), activity: 'Düşünüyor', lang: lang === 'en' ? 'en' : 'tr', perm: permissionMode };
    this.running.set(sessionId, run);
    this.#emit(sessionId, 'run.start', { startedAt: run.startedAt });
    this.emit('jobs');

    if (provider === 'codex') {
      this.#runCodex(sessionId, run, session, prompt, { model, permissionMode, images: attachments.filter((a) => /\.(png|jpe?g|gif|webp)$/i.test(a.path)).map((a) => a.path) });
      return { sessionId };
    }

    let claudeBin;
    try { claudeBin = claudeExecutable(); } catch (e) {
      // Claude Code kurulu değil: turu hemen, anlaşılır bir mesajla bitir
      this.#record(sessionId, 'error', { message: e.message });
      this.#emit(sessionId, 'error', { message: e.message });
      this.running.delete(sessionId);
      this.#emit(sessionId, 'run.end', {});
      this.emit('jobs');
      return { sessionId };
    }
    const options = {
      cwd: WORKSPACE_DIR,
      abortController: abort,
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local'],
      ...(claudeBin ? { pathToClaudeCodeExecutable: claudeBin } : {}),
      mcpServers: { borsa: buildBorsaServer((type, data) => this.emit('notify', { type, data }), () => ({ mode: run.perm || 'default', sessionId })) },
      // Portföye yazan add_transaction bilerek listede yok: her seferinde kullanıcı onayı ister
      // Salt okunur piyasa verisi bağlayıcıları da onaysız çalışır (zamanlanmış görevler dahil); e-posta vb. yazma yetkili bağlayıcılar onay ister
      allowedTools: [...AUTO_TOOLS.map((t) => `mcp__borsa__${t}`), ...DATA_CONNECTORS, 'WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep', 'TodoWrite'],
      permissionMode,
      ...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      canUseTool: (toolName, input, { signal, suggestions }) => this.#askPermission(sessionId, run, toolName, input, signal, suggestions),
      stderr: (d) => { if (/error/i.test(d)) console.error('[claude]', d.trim().slice(0, 500)); },
      // Alt sürece master gateway anahtarı verilmez; yalnız kapsamlı jeton ve izin kipi
      env: (() => { const e = { ...process.env, KMY_PERMISSION_MODE: permissionMode, KMY_SCOPED_TOKEN: mintScopedToken({ sessionId, mode: permissionMode }) }; delete e.CLAUDECODE; return e; })(),
    };

    // Arka planda yürüt; olaylar WebSocket üzerinden akar.
    // Model hiç yanıt üretmeden error_during_execution dönerse (ör. SDK turu yarıda kesti) bir kez aynı oturumla,
    // o da boş kalırsa önceki konuşma özetiyle yeni bir SDK oturumunda yeniden denenir; kullanıcı mesajı yeniden kaydedilmez.
    (async () => {
      let resume = session.sdk_session_id || null, attemptPrompt = prompt;
      try {
        for (let attempt = 0; ; attempt++) {
          const failed = await this.#claudeAttempt(sessionId, run, attemptPrompt, {
            ...options, systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend(!resume, run.lang) }, ...(resume ? { resume } : {}),
          });
          if (!failed || run.stopping || abort.signal.aborted) break;
          console.error(`[claude] boş yanıt (deneme ${attempt + 1}, oturum ${sessionId}, sdk ${resume || 'yeni'}): ${failed.subtype} ${(failed.errors || []).join('; ')}`);
          if (attempt >= 2) {
            this.#record(sessionId, 'error', { message: NO_REPLY });
            this.#emit(sessionId, 'error', { message: NO_REPLY });
            break;
          }
          if (attempt === 1) { resume = null; attemptPrompt = this.#contextNote(sessionId) + prompt; }
          this.#emit(sessionId, 'notice', { message: attempt === 0 ? 'Yanıt alınamadı; yeniden deneniyor…' : 'Yanıt yine alınamadı; önceki konuşma özetiyle yeni model oturumu açılıyor…' });
        }
        if (run.stopping || abort.signal.aborted) {
          this.#record(sessionId, 'stopped', { message: 'Kullanıcı durdurdu' });
          this.#emit(sessionId, 'stopped', { message: 'Kullanıcı durdurdu' });
        }
      } catch (e) {
        const stopped = run.stopping || abort.signal.aborted;
        if (!stopped) console.error('[claude] çalışma hatası:', e.message);
        const message = stopped ? 'Kullanıcı durdurdu' : isDiag(e.message) ? NO_REPLY : friendlyError(e.message);
        this.#record(sessionId, stopped ? 'stopped' : 'error', { message });
        this.#emit(sessionId, stopped ? 'stopped' : 'error', { message });
      } finally {
        for (const p of run.pending.values()) p.resolve({ behavior: 'deny', message: 'Oturum sona erdi' });
        this.running.delete(sessionId);
        db.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
        this.#emit(sessionId, 'run.end', {});
        this.emit('jobs');
      }
    })();
    return { sessionId };
  }

  // Tek SDK çağrısı. Bu turda hiç çıktı yokken gelen error_during_execution sonucunu kaydetmeden döndürür (yeniden denenecek).
  async #claudeAttempt(sessionId, run, prompt, options) {
    run.produced = false;
    run.costBase = options.resume ? this.#lastSdkCost(sessionId, options.resume) : 0;
    let failed = null, handledError = false;
    try {
      const q = query({ prompt, options });
      run.q = q;
      for await (const msg of q) {
        if (msg.type === 'result' && msg.is_error && msg.subtype === 'error_during_execution' && !run.produced && !run.stopping) { failed = msg; continue; }
        if (msg.type === 'result' && msg.is_error) handledError = true;
        this.#handle(sessionId, run, msg);
      }
    } catch (e) {
      // Hata sonucu zaten işlendiyse SDK'nın ardından fırlattığı "returned an error result" istisnası tekrar gösterilmez
      if (!(failed || handledError || run.stopping) || !isDiag(e.message)) throw e;
      console.error('[claude]', e.message.slice(0, 300));
    }
    return failed;
  }

  // SDK devam eden oturumda (resume) total_cost_usd'yi transkriptten geri yükleyip birikimli verir: tur maliyeti = fark
  #lastSdkCost(sessionId, sdkSession) {
    const row = db.prepare("SELECT data FROM chat_events WHERE session_id = ? AND kind = 'result' ORDER BY id DESC LIMIT 1").get(sessionId);
    if (!row) return 0;
    const d = JSON.parse(row.data);
    if (d.provider && d.provider !== 'claude') return 0;
    if (d.sdk && d.sdk !== sdkSession) return 0;
    return d.sdkCost ?? d.cost ?? 0;
  }

  // Yeni SDK oturumuna aktarılacak kısa bağlam: kayıtlı son kullanıcı / asistan metinleri (şu anki mesaj hariç)
  #contextNote(sessionId, max = 8000) {
    const rows = db.prepare("SELECT kind, data FROM chat_events WHERE session_id = ? AND kind IN ('user', 'text') ORDER BY id DESC LIMIT 40").all(sessionId).slice(1);
    const lines = [];
    let size = 0;
    for (const r of rows) {
      const t = String(JSON.parse(r.data).text || '').trim();
      if (!t) continue;
      const line = `${r.kind === 'user' ? 'Kullanıcı' : 'Asistan'}: ${t.length > 1500 ? t.slice(0, 1500) + '…' : t}`;
      if (size + line.length > max) break;
      lines.unshift(line);
      size += line.length;
    }
    if (!lines.length) return '';
    return `<onceki_konusma>\nModel oturumu yenilendi. Önceki konuşmanın son kısmı (yalnız bağlam için; yeniden yanıtlama):\n${lines.join('\n\n')}\n</onceki_konusma>\n\n`;
  }

  // Araç süresi: tool_use ile eşleşen ilk tool_result'ta ölçülür; sonuç gelmezse (durdurma, hata) ms null kalır
  #toolMs(run, id) {
    const t0 = run.tools.get(id);
    if (!t0) return null;
    run.tools.delete(id);
    return Date.now() - t0;
  }

  #handle(sessionId, run, msg) {
    const parent = msg.parent_tool_use_id || null;
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          db.prepare('UPDATE chat_sessions SET sdk_session_id = ?, model = COALESCE(?, model) WHERE id = ?').run(msg.session_id, msg.model || null, sessionId);
          this.lastInit = { at: Date.now(), model: msg.model, version: msg.claude_code_version, cwd: msg.cwd, permissionMode: msg.permissionMode, tools: msg.tools || [], mcp: msg.mcp_servers || [], agents: msg.agents || [], slashCommands: msg.slash_commands || [], apiKeySource: msg.apiKeySource };
          this.#emit(sessionId, 'init', { model: msg.model, tools: msg.tools?.length, mcp: msg.mcp_servers, permissionMode: msg.permissionMode });
        } else if (msg.subtype === 'compact_boundary') {
          const m = msg.compact_metadata || {};
          const note = `Bağlam sıkıştırıldı (${m.trigger === 'auto' ? 'otomatik' : 'elle'}${m.pre_tokens ? `, ${Math.round(m.pre_tokens / 1000)}b → ${m.post_tokens ? Math.round(m.post_tokens / 1000) + 'b' : '?'} token` : ''})`;
          this.#record(sessionId, 'notice', { message: note });
          this.#emit(sessionId, 'notice', { message: note });
        } else if (msg.subtype === 'local_command_output') {
          this.#record(sessionId, 'local', { text: msg.content });
          this.#emit(sessionId, 'local', { text: msg.content });
        } else if (msg.subtype === 'api_retry') {
          this.#emit(sessionId, 'notice', { message: `API hatası (${msg.error_status || 'bağlantı'}); yeniden deneniyor ${msg.attempt}/${msg.max_retries}…` });
        } else if (msg.subtype === 'status' && msg.status === 'compacting') {
          this.#emit(sessionId, 'notice', { message: 'Bağlam özetlenerek sıkıştırılıyor…' });
        }
        break;
      case 'stream_event': {
        if (parent) break;
        const ev = msg.event;
        if (ev?.type === 'content_block_delta') {
          run.produced = true;
          if (ev.delta?.type === 'text_delta') this.#emit(sessionId, 'delta', { text: ev.delta.text, index: ev.index });
          else if (ev.delta?.type === 'thinking_delta') this.#emit(sessionId, 'thinking.delta', { text: ev.delta.thinking, index: ev.index });
        } else if (ev?.type === 'message_start') {
          this.#emit(sessionId, 'message.start', {});
        }
        break;
      }
      case 'assistant': {
        const content = msg.message?.content || [];
        const usage = msg.message?.usage;
        if (parent) {
          const sa = run.subagents.get(parent);
          if (sa) {
            for (const b of content) if (b.type === 'tool_use') { sa.tools++; sa.last = b.name; }
            this.#emit(sessionId, 'team.update', { id: parent, ...sa });
          }
          break;
        }
        if (content.length) run.produced = true;
        for (const b of content) {
          if (b.type === 'text' && b.text) { this.#record(sessionId, 'text', { text: b.text }); this.#emit(sessionId, 'text', { text: b.text }); }
          else if (b.type === 'thinking' && b.thinking) { this.#record(sessionId, 'thinking', { text: b.thinking }); this.#emit(sessionId, 'thinking', { text: b.thinking }); }
          else if (b.type === 'tool_use') {
            // Araç süresi defteri: ne kadar sürdüğü yalnız tool_use/tool_result çiftinden çıkar (şema değişmez, gövde JSON)
            const startedAt = Date.now();
            run.tools.set(b.id, startedAt);
            this.#record(sessionId, 'tool_use', { id: b.id, name: b.name, input: b.input, startedAt });
            this.#emit(sessionId, 'tool_use', { id: b.id, name: b.name, input: b.input, startedAt });
            run.activity = toolLabel(b.name);
            if (SUBAGENT_TOOLS.has(b.name)) {
              const sa = { id: b.id, description: b.input?.description || b.input?.subagent_type || 'Alt ajan', kind: b.input?.subagent_type || 'general-purpose', startedAt, tools: 0, last: null, done: false };
              run.subagents.set(b.id, sa);
              this.#emit(sessionId, 'team.start', sa);
            }
            this.emit('jobs');
          }
        }
        if (usage) {
          const ctx = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0);
          this.#emit(sessionId, 'usage', { ctx, window: this.ctxWindow.get(sessionId) || null });
        }
        break;
      }

      case 'user': {
        if (parent) break;
        const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
        for (const b of content) {
          if (b.type !== 'tool_result') continue;
          const text = Array.isArray(b.content) ? b.content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') : String(b.content ?? '');
          const data = { id: b.tool_use_id, isError: !!b.is_error, ms: this.#toolMs(run, b.tool_use_id), text: text.length > 20000 ? text.slice(0, 20000) + '\n…(kısaltıldı)' : text };
          this.#record(sessionId, 'tool_result', data);
          this.#emit(sessionId, 'tool_result', data);
          const sa = run.subagents.get(b.tool_use_id);
          if (sa) { sa.done = true; sa.endedAt = Date.now(); sa.result = text.slice(0, 4000); sa.isError = !!b.is_error; this.#emit(sessionId, 'team.end', sa); }
        }
        run.activity = 'Düşünüyor';
        break;
      }
      case 'rate_limit_event': {
        const r = msg.rate_limit_info || {};
        if (r.status && r.status !== 'allowed') {
          const kind = { five_hour: '5 saatlik', seven_day: 'haftalık', seven_day_opus: 'haftalık Opus', seven_day_sonnet: 'haftalık Sonnet', overage: 'aşım' }[r.rateLimitType] || '';
          const data = { status: r.status, kind, utilization: r.utilization ?? null, resetsAt: r.resetsAt ? r.resetsAt * (r.resetsAt < 1e12 ? 1000 : 1) : null };
          this.#emit(sessionId, 'ratelimit', data);
        }
        break;
      }
      case 'result': {
        const mu = Object.values(msg.modelUsage || {});
        const contextWindow = mu.reduce((a, m) => Math.max(a, m.contextWindow || 0), 0) || null;
        if (contextWindow) this.ctxWindow.set(sessionId, contextWindow);
        const total = msg.total_cost_usd || 0;
        const cost = total >= (run.costBase || 0) ? total - (run.costBase || 0) : total;
        run.costBase = total;
        // Ham SDK tanıları ([ede_diagnostic] …) yalnız logda; kullanıcıya kısa hata metni
        const raw = Array.isArray(msg.errors) ? msg.errors : [];
        const errors = raw.filter((x) => !isDiag(x));
        if (raw.length !== errors.length) console.error('[claude] sonuç tanısı:', msg.subtype, raw.join('; ').slice(0, 300));
        const data = {
          subtype: msg.subtype, isError: !!msg.is_error, cost, sdkCost: total, sdk: msg.session_id || null, durationMs: msg.duration_ms,
          turns: msg.num_turns, usage: msg.usage || null, errors: errors.length ? errors.map(friendlyError) : null, contextWindow,
        };
        // Kullanıcı durdurduysa kesintiden doğan hata sonucu hata olarak gösterilmez; "Durduruldu" kaydı çalışma sonunda
        if (run.stopping && data.isError) Object.assign(data, { subtype: 'interrupted', isError: false, errors: null });
        db.prepare('UPDATE chat_sessions SET cost_usd = cost_usd + ? WHERE id = ?').run(data.cost, sessionId);
        this.#record(sessionId, 'result', data);
        this.#emit(sessionId, 'result', data);
        break;
      }
      default:
        break;
    }
  }

  // ── Codex CLI (ChatGPT) ────────────────────────────────
  // `codex exec --json` olay akışını Claude olaylarıyla aynı biçime çevirir. Codex etkileşimsiz çalıştığı için
  // izinler sandbox moduyla belirlenir: varsayılan salt okunur, "düzenlemeleri onayla" = çalışma alanına yazma.
  #runCodex(sessionId, run, session, prompt, { model, permissionMode, images = [] }) {
    // Köprüye izin kipi ve kapsamlı jeton geçer; master gateway anahtarı Codex alt sürecine sızmaz
    const bridgeEnv = { KMY_PERMISSION_MODE: permissionMode, KMY_SCOPED_TOKEN: mintScopedToken({ sessionId, mode: permissionMode }) };
    const args = ['exec', '--json', '--skip-git-repo-check', '-C', WORKSPACE_DIR,
      '-c', `mcp_servers.borsa.command=${JSON.stringify(process.execPath)}`,
      '-c', `mcp_servers.borsa.args=[${JSON.stringify(MCP_STDIO)}]`,
      '-c', `mcp_servers.borsa.env.KMY_PERMISSION_MODE=${JSON.stringify(permissionMode)}`,
      '-c', `mcp_servers.borsa.env.KMY_SCOPED_TOKEN=${JSON.stringify(bridgeEnv.KMY_SCOPED_TOKEN)}`];
    if (permissionMode === 'bypassPermissions') args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('-s', permissionMode === 'acceptEdits' ? 'workspace-write' : 'read-only');
    if (model) args.push('-m', model);
    for (const img of images) args.push('-i', path.join(WORKSPACE_DIR, img));
    const sys = `${systemAppend(!session.sdk_session_id, run.lang)}\n- Terminal araçları "borsa" MCP sunucusundadır. Kalıcı talimatlar: AGENTS.md / CLAUDE.md.`;
    const fullPrompt = session.sdk_session_id ? prompt : `${sys}\n\n${prompt}`;
    if (session.sdk_session_id) args.push('resume', session.sdk_session_id);
    args.push(fullPrompt);

    const started = Date.now();
    const env = { ...process.env };
    Object.assign(env, bridgeEnv);
    delete env.CLAUDECODE;
    const child = spawn('codex', args, { cwd: WORKSPACE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    run.abort.signal.addEventListener('abort', () => child.kill('SIGTERM'));
    run.q = { interrupt: async () => child.kill('SIGINT') };
    const seen = new Set();
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    const rl = readline.createInterface({ input: child.stdout });
    const toolUse = (item) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      let name = 'shell', input = {};
      if (item.type === 'command_execution') input = { command: item.command };
      else if (item.type === 'mcp_tool_call') { name = `mcp__${item.server}__${item.tool}`; input = item.arguments || {}; }
      else if (item.type === 'web_search') { name = 'WebSearch'; input = { query: item.query }; }
      else if (item.type === 'file_change') { name = 'Edit'; input = { changes: item.changes }; }
      else return false;
      const startedAt = Date.now();
      run.tools.set(item.id, startedAt);
      this.#record(sessionId, 'tool_use', { id: item.id, name, input, startedAt });
      this.#emit(sessionId, 'tool_use', { id: item.id, name, input, startedAt });
      run.activity = toolLabel(name);
      this.emit('jobs');
      return true;
    };
    rl.on('line', (line) => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      const item = ev.item;
      switch (ev.type) {
        case 'thread.started':
          db.prepare('UPDATE chat_sessions SET sdk_session_id = ? WHERE id = ?').run(ev.thread_id, sessionId);
          this.#emit(sessionId, 'init', { model: model || 'codex', provider: 'codex' });
          break;
        case 'item.started':
          if (item) toolUse(item);
          break;
        case 'item.completed':
          if (!item) break;
          if (item.type === 'agent_message' && item.text) { this.#record(sessionId, 'text', { text: item.text }); this.#emit(sessionId, 'text', { text: item.text }); }
          else if (item.type === 'reasoning' && item.text) { this.#record(sessionId, 'thinking', { text: item.text }); this.#emit(sessionId, 'thinking', { text: item.text }); }
          else if (item.type === 'todo_list') { /* plan güncellemesi: atla */ }
          else if (item.type === 'error') { this.#emit(sessionId, 'notice', { message: item.message }); }
          else {
            toolUse(item);
            let text = item.aggregated_output ?? '';
            if (item.type === 'mcp_tool_call') text = item.error?.message || (item.result?.content || []).map((c) => c.text || `[${c.type}]`).join('\n');
            if (item.type === 'file_change') text = (item.changes || []).map((c) => `${c.kind} ${c.path}`).join('\n');
            const data = { id: item.id, isError: item.status === 'failed' || (item.exit_code != null && item.exit_code !== 0) || !!item.error, ms: this.#toolMs(run, item.id), text: String(text).slice(0, 20000) };
            this.#record(sessionId, 'tool_result', data);
            this.#emit(sessionId, 'tool_result', data);
            run.activity = 'Düşünüyor';
          }
          break;
        case 'turn.completed': {
          const u = ev.usage || {};
          this.#emit(sessionId, 'usage', { ctx: (u.input_tokens || 0) + (u.output_tokens || 0) });
          const data = { subtype: 'success', isError: false, cost: 0, durationMs: Date.now() - started, turns: 1, usage: u, provider: 'codex' };
          this.#record(sessionId, 'result', data);
          this.#emit(sessionId, 'result', data);
          break;
        }
        case 'turn.failed':
        case 'error': {
          const message = ev.error?.message || ev.message || 'Codex hatası';
          this.#record(sessionId, 'error', { message });
          this.#emit(sessionId, 'error', { message });
          break;
        }
        default: break;
      }
    });
    child.on('error', (e) => {
      const message = e.code === 'ENOENT' ? 'Codex CLI bulunamadı. Kurun (npm install -g @openai/codex), ardından `codex login` ile giriş yapın.' : e.message;
      this.#record(sessionId, 'error', { message });
      this.#emit(sessionId, 'error', { message });
    });
    child.on('close', (code) => {
      if (run.abort.signal.aborted) { this.#record(sessionId, 'stopped', { message: 'Kullanıcı durdurdu' }); this.#emit(sessionId, 'stopped', {}); }
      else if (code !== 0) {
        const message = `Codex ${code} koduyla çıktı. ${stderr.split('\n').filter((l) => /error|fail|login|auth/i.test(l)).slice(-3).join(' ').slice(0, 400)}`;
        this.#record(sessionId, 'error', { message });
        this.#emit(sessionId, 'error', { message });
      }
      this.running.delete(sessionId);
      db.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
      this.#emit(sessionId, 'run.end', {});
      this.emit('jobs');
    });
  }


  #askPermission(sessionId, run, toolName, input, signal, suggestions) {
    return new Promise((resolve) => {
      const reqId = crypto.randomUUID();
      const timer = setTimeout(() => finish({ behavior: 'deny', message: 'Onay zaman aşımına uğradı' }), PERMISSION_TIMEOUT);
      const finish = (r) => {
        clearTimeout(timer);
        run.pending.delete(reqId);
        this.#emit(sessionId, 'permission.resolved', { reqId, behavior: r.behavior });
        resolve(r);
      };
      run.pending.set(reqId, { resolve: finish, input, suggestions, tool: toolName });
      signal?.addEventListener('abort', () => finish({ behavior: 'deny', message: 'İptal edildi' }));
      if (toolName === 'AskUserQuestion') {
        run.activity = 'Soru soruyor';
        this.#emit(sessionId, 'question', { reqId, questions: input.questions || [] });
      } else {
        run.activity = `Onay bekliyor: ${toolLabel(toolName)}`;
        this.#emit(sessionId, 'permission.request', { reqId, tool: toolName, input, canAlways: !!suggestions?.length });
      }
      this.emit('jobs');
    });
  }

  // AskUserQuestion yanıtı: answers = { [soru metni]: seçilen etiket(ler) }
  replyQuestion(sessionId, reqId, answers, skip = false) {
    const run = this.running.get(sessionId);
    const p = run?.pending.get(reqId);
    if (!p) return false;
    if (skip) p.resolve({ behavior: 'deny', message: 'Kullanıcı soruyu yanıtlamadan geçti; kendi en iyi varsayımınla devam et.' });
    else p.resolve({ behavior: 'allow', updatedInput: { ...p.input, answers: answers || {} } });
    return true;
  }

  replyPermission(sessionId, reqId, decision) {
    const run = this.running.get(sessionId);
    const p = run?.pending.get(reqId);
    if (!p) return false;
    if (decision === 'allow' || decision === 'always') {
      p.resolve({ behavior: 'allow', updatedInput: p.input, ...(decision === 'always' && p.suggestions ? { updatedPermissions: p.suggestions } : {}) });
    } else {
      p.resolve({ behavior: 'deny', message: 'Kullanıcı reddetti' });
    }
    return true;
  }

  // Alt ajan çıktısını kısa özetleme (Haiku; araçsız, tek tur)
  async summarize(text, lang = 'tr') {
    const body = String(text || '').slice(0, 60_000);
    if (!body.trim()) throw new Error('Özetlenecek metin yok');
    let claudeBin;
    try { claudeBin = claudeExecutable(); } catch (e) {
      throw new Error(String(e?.message || '').startsWith('Claude Code bulunamadı') ? e.message : 'Özet alınamadı');
    }
    let out = '';
    try {
      const q = query({
        prompt: `Aşağıdaki alt ajan çıktısını ${lang === 'en' ? 'İngilizce (English)' : 'Türkçe'}, en fazla 6 maddede özetle. Rakamları, tarihleri ve sonuçları koru; yorum ekleme.\n\n<cikti>\n${body}\n</cikti>`,
        options: {
          model: 'claude-haiku-4-5-20251001', maxTurns: 1, settingSources: [], cwd: WORKSPACE_DIR, ...(claudeBin ? { pathToClaudeCodeExecutable: claudeBin } : {}),
          systemPrompt: 'Kısa ve doğru özetler yazan bir asistansın.', allowedTools: [],
          canUseTool: async () => ({ behavior: 'deny', message: 'Özetlemede araç kullanılmaz' }),
        },
      });
      for await (const m of q) if (m.type === 'result') { if (m.subtype === 'success') out = m.result; else throw new Error('Özet alınamadı'); }
    } catch (e) {
      if (String(e?.message || '').startsWith('Claude Code bulunamadı') || e?.message === 'Özet alınamadı') throw e;
      throw new Error('Özet alınamadı');
    }
    if (!out) throw new Error('Özet alınamadı');
    return { summary: out };
  }

  stop(sessionId) {
    const run = this.running.get(sessionId);
    if (!run) return false;
    run.stopping = true;
    run.q?.interrupt?.().catch(() => {});
    setTimeout(() => { if (this.running.has(sessionId)) run.abort.abort(); }, 1500);
    return true;
  }
}

function toolLabel(name) {
  if (name.startsWith('mcp__borsa__')) return name.slice(12).replace(/_/g, ' ');
  if (name.startsWith('mcp__')) return name.split('__').slice(1).join(' › ');
  return name;
}

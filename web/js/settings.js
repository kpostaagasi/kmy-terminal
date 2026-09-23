// Ayarlar penceresi: Bağlantı, Görünüm, Veri, Sistem, Hakkında (stil: settings.css, kök .stg)
import { state, api, wsCall, emit, $, $$, esc, toast, modal, confirmBox, md, dateTR, connect, debounce } from './core.js';

// Kenar çubuğu simgeleri (24×24, çizgi)
const IC = {
  baglanti: '<path d="M9 3v4M15 3v4M6.5 7h11v4a5.5 5.5 0 0 1-11 0V7zM12 16.5V21"/>',
  gorunum: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
  veri: '<ellipse cx="12" cy="6" rx="7" ry="2.7"/><path d="M5 6v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7V6M5 12v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-6"/>',
  sistem: '<rect x="4" y="4" width="16" height="7" rx="1.8"/><rect x="4" y="13" width="16" height="7" rx="1.8"/><path d="M8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4"/>',
  hakkinda: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;

// Bölüm → [anahtar, etiket, alt bloklar [anahtar, başlık], açıklama]; tek bloklu bölümde blok başlığı gösterilmez
const SECTIONS = [
  ['baglanti', 'Bağlantı', [['saglayici', 'Sağlayıcılar'], ['ajan', 'Agent Varsayılanları'], ['baglantilar', 'MCP Bağlantıları']], 'Ajan sağlayıcıları, varsayılan model ve MCP bağlantıları'],
  ['gorunum', 'Görünüm', [['genel', 'Görünüm']], 'Tema, imza rengi, yazı boyutları ve arayüz modu'],
  ['veri', 'Veri', [['veri', 'Veri']], 'Fiyat yenileme, kurum raporu izleme, önbellek ve veri kaynakları'],
  ['sistem', 'Sistem', [['gateway', 'Gateway'], ['sistem', 'Sistem Sağlığı'], ['gorevler', 'Zamanlanmış Görevler'], ['log', 'Mesaj Logu']], 'Sunucu servisi, sağlık durumu, zamanlanmış görevler ve mesaj logu'],
  ['hakkinda', 'Hakkında', [['surum', 'Sürüm Notları'], ['yardim', 'Kısayollar & Komutlar']], 'Sürüm notları, klavye kısayolları ve sohbet komutları'],
];
// Eski bölüm anahtarları (genel, ajan, gorevler…) → yeni bölüm
const OLD = Object.fromEntries(SECTIONS.flatMap(([k, , bl]) => bl.map(([b]) => [b, k])));
const isSec = (k) => SECTIONS.some(([x]) => x === k);

// İmza rengi hazır tonları (ilk = varsayılan)
const ACCENTS = [['#facc15', 'Sarı'], ['#f5a524', 'Turuncu'], ['#f59e0b', 'Kehribar'], ['#22c55e', 'Yeşil'], ['#2dd4bf', 'Turkuaz'], ['#3b82f6', 'Mavi'], ['#a78bfa', 'Mor'], ['#f472b6', 'Pembe'], ['#ef4444', 'Kırmızı']];
const ACCENT_DEF = ACCENTS[0][0];
const hexOk = (x) => (/^#[0-9a-f]{6}$/i.test(x || '') ? x.toLowerCase() : null);

// Bilinen sağlayıcılar: kurulum paketi, giriş akışı [id, düğme, komut, terminal başlığı, açıklama]; bilinmeyenler genel kalıpla çizilir
const PROV = {
  claude: { cli: 'Claude Code CLI', desc: 'Claude aboneliğinizle veya API anahtarınızla çalışır', pkg: '@anthropic-ai/claude-code', login: ['sLoginC', 'Claude ile giriş', 'claude /login', 'claude login', 'Tarayıcıda oturum açma akışı terminalde başlar'] },
  codex: { cli: 'Codex CLI', desc: 'ChatGPT aboneliğinizle çalışır; terminal araçlarına stdio MCP köprüsüyle erişir', pkg: '@openai/codex', login: ['sLoginX', 'ChatGPT ile devam', 'codex login', 'codex login', 'ChatGPT hesabıyla oturum açma'] },
  omp: { cli: 'oh-my-pi CLI (omp)', desc: 'omp komut satırı kodlama ajanı', pkg: '@oh-my-pi/pi-coding-agent', alt: 'brew install can1357/tap/omp' },
};

export function openSettings(section = 'genel') {
  const focus = isSec(section) ? null : section; // eski anahtar → ilgili bloğa kaydır
  if (!isSec(section)) section = OLD[section] || 'baglanti';
  const m = modal({
    title: 'Ayarlar', wide: true,
    body: `<div class="stg">
      <aside class="stg-side">
        <div class="stg-brand"><b>Ayarlar</b><span>KMY Terminal</span></div>
        <nav class="stg-nav" role="tablist" aria-label="Ayar bölümleri">${SECTIONS.map(([k, l]) => `<button type="button" role="tab" data-s="${k}">${svg(k)}<span>${l}</span></button>`).join('')}</nav>
        <div class="stg-tip"><kbd>⌘</kbd><kbd>,</kbd> ile açılır · <kbd>Esc</kbd> kapatır</div>
      </aside>
      <div class="stg-main">
        <div class="stg-head"><div><h2 id="stgTitle"></h2><p id="stgDesc"></p></div><button class="icon-btn stg-x" data-close aria-label="Kapat">✕</button></div>
        <div id="setBody" class="stg-body"></div>
      </div>
    </div>`,
  });
  const nav = $('.stg-nav', m.body);
  nav.onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) show(b.dataset.s); };
  const main = $('.stg-main', m.body);
  const body = $('#setBody', m.body);
  const s = { ...state.settings };

  const save = async (patch) => {
    try {
      const r = await api('/settings', { method: 'PUT', body: patch });
      Object.assign(s, r);
      // Sunucu tanımadığı anahtarları yok sayar (yeni ayar + eski sunucu süreci)
      if (Object.keys(patch).some((k) => !(k in r))) toast('Sunucu bu ayarı henüz tanımıyor; sunucu yeniden başlatılınca kaydedilir', 'err', 7000);
      else toast('Kaydedildi', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  // ── Arayüz parçaları ──
  const row = (title, desc, control, { wide = false, sm = false, id = '' } = {}) => `<div class="stg-row${wide ? ' wide' : ''}${sm ? ' sm' : ''}"${id ? ` id="${id}"` : ''}><div class="stg-lbl"><div class="h">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><div class="stg-ctl">${control}</div></div>`;
  const card = (inner, head = '') => `<div class="stg-card">${head ? `<div class="stg-card-h">${head}</div>` : ''}${inner}</div>`;
  const sel = (id, opts, val) => `<span class="stg-select"><select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></span>`;
  const seg = (id, opts, val) => `<div class="stg-seg" id="${id}" role="radiogroup">${opts.map(([v, l]) => `<button type="button" role="radio" data-v="${esc(v)}" aria-checked="${String(v) === String(val)}">${esc(l)}</button>`).join('')}</div>`;
  const onSeg = (id, fn) => {
    const g = $(`#${id}`);
    g.onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (!b || b.getAttribute('aria-checked') === 'true') return;
      $$('[data-v]', g).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      fn(b.dataset.v);
    };
  };
  const toggle = (id, on) => `<label class="stg-switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span aria-hidden="true"></span></label>`;
  const pill = (kind, text, mono = false) => `<span class="stg-pill ${kind}${mono ? ' mono' : ''}">${esc(text)}</span>`;
  const kv = (pairs) => `<div class="stg-kv">${pairs.map(([k, v, wide]) => `<div${wide ? ' class="wide"' : ''}><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
  const code = (text, id) => `<div class="stg-code"><code>${esc(text)}</code><button class="ghost" data-copy="${id}">Kopyala</button></div>`;
  const bindCopy = (el, map) => $$('[data-copy]', el).forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(map[b.dataset.copy]); toast('Kopyalandı', 'ok'); } catch (e) { toast(`Kopyalanamadı: ${e.message}`, 'err'); }
  });
  // Model listesi: [{id,label}] veya ['id'] kabul eder; boş seçenek = sağlayıcı varsayılanı
  const modelOpts = (list, cur) => {
    const o = (list || []).map((x) => (typeof x === 'string' ? [x, x] : [x.id ?? '', x.label || x.name || x.id || 'Varsayılan']));
    if (!o.some(([v]) => v === '')) o.unshift(['', 'Varsayılan']);
    if (cur && !o.some(([v]) => v === cur)) o.push([cur, cur]);
    return o;
  };

  // Blok çizicileri: her biri kendi kabına (el) yazar; stale() geç gelen yanıtları yok sayar
  const BLOCKS = {
    async genel(el) {
      const cur = hexOk(s.accent) || ACCENT_DEF;
      const custom = !ACCENTS.some(([x]) => x === cur);
      el.innerHTML = card(
        row('Tema', 'Koyu veya açık arayüz', seg('sTheme', [['dark', 'Koyu'], ['light', 'Açık']], s.theme === 'light' ? 'light' : 'dark'))
        + row('İmza rengi', `Vurgu, seçili sekme, düğme ve odak halkalarında kullanılır · <span class="mono" id="sAccentHex">${esc(cur)}</span> · <button type="button" class="stg-link" id="sAccentReset">Varsayılana dön</button>`,
          `<div class="stg-accent" id="sAccent">${ACCENTS.map(([x, n]) => `<button type="button" class="stg-sw" data-hex="${x}" style="--sw:${x}" title="${n}${x === ACCENT_DEF ? ' (varsayılan)' : ''}" aria-label="${n}" aria-pressed="${x === cur}"></button>`).join('')}<label class="stg-sw stg-sw-custom" title="Özel renk" aria-pressed="${custom}" style="--sw:${cur}"><input type="color" id="sAccentCustom" value="${cur}" aria-label="Özel renk"></label></div>`),
        'Tema')
        + card(
          row('Chat yazı boyutu', 'Sohbet mesajları ve giriş alanı', seg('sChatFont', [[12, 'Küçük'], [14, 'Orta'], [16, 'Büyük'], [18, 'Çok büyük']], s.chatFontSize))
          + row('Arayüz modu', 'TERMINAL sekmesi ajan sohbetiyle mi kabukla mı açılsın', seg('sUi', [['chat', 'Chat'], ['terminal', 'Terminal (xterm.js)']], s.uiMode === 'terminal' ? 'terminal' : 'chat'))
          + row('Terminal yazı boyutu', 'Terminal (xterm.js) yazı boyutu; 8–24px', `<span class="stg-num"><input id="sTermFont" type="number" min="8" max="24" value="${esc(s.terminalFontSize)}"><i>px</i></span>`)
          + row('Temel para birimi', 'Portföy değerleri TL olarak tutulur; USD karşılığı ayrıca gösterilir', sel('sBase', [['TRY', 'TL (₺)']], s.baseCurrency)),
          'Yazı ve düzen');
      onSeg('sTheme', (v) => save({ theme: v }));
      onSeg('sUi', (v) => save({ uiMode: v }));
      onSeg('sChatFont', (v) => save({ chatFontSize: Number(v) }));
      $('#sTermFont').onchange = (e) => { const v = Math.min(24, Math.max(8, Number(e.target.value) || 13)); e.target.value = v; save({ terminalFontSize: v }); };
      // İmza rengi: anında önizleme, seçimde kaydet. Önizleme yerel bir ayar yayını gibi app.js'e verilir
      // (applySettings tonları türetir); kayıttan sonra sunucunun WS yayını asıl değeri uygular.
      const preview = debounce((hex) => emit('ws:settings', { settings: { ...state.settings, accent: hex } }), 120);
      const mark = (hex) => {
        const pre = ACCENTS.some(([x]) => x === hex);
        $$('.stg-sw[data-hex]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.hex === hex)));
        const cu = $('.stg-sw-custom', el);
        cu.setAttribute('aria-pressed', String(!pre));
        cu.style.setProperty('--sw', hex);
        $('#sAccentCustom').value = hex;
        $('#sAccentHex').textContent = hex;
      };
      const apply = (hex, persist = true) => {
        hex = hexOk(hex);
        if (!hex) return;
        document.documentElement.style.setProperty('--accent-base', hex);
        mark(hex);
        preview(hex);
        if (persist && hex !== s.accent) save({ accent: hex });
      };
      $('#sAccent').onclick = (e) => { const b = e.target.closest('[data-hex]'); if (b) apply(b.dataset.hex); };
      $('#sAccentCustom').oninput = (e) => apply(e.target.value, false);
      $('#sAccentCustom').onchange = (e) => apply(e.target.value);
      $('#sAccentReset').onclick = () => apply(ACCENT_DEF);
    },
    async ajan(el, stale, health) {
      const h = await health();
      if (stale()) return;
      el.innerHTML = card(
        row('Varsayılan model', 'Yeni Claude oturumları bu modelle başlar', sel('sModel', state.meta.models.map((x) => [x.id, x.label]), s.model))
        + row('Varsayılan effort', 'Yeni oturumların düşünme seviyesi', state.meta.efforts.length <= 4 ? seg('sEffort', state.meta.efforts.map((x) => [x, x]), s.effort) : sel('sEffort', state.meta.efforts.map((x) => [x, x]), s.effort))
        + row('İzin modu', 'Tool çalıştırma izin politikası', sel('sMode', Object.entries(state.meta.permissionModes), s.permissionMode))
        + row('Çalışma alanı', 'Ajanın kalıcı talimatları, beceri ve bilgi dosyaları: <span class="mono">CLAUDE.md · .claude/skills · knowledge/</span>', `<span class="stg-path mono">${esc(h.workspace)}</span>`, { wide: true }));
      if ($('#sEffort').tagName === 'SELECT') $('#sEffort').onchange = (e) => save({ effort: e.target.value });
      else onSeg('sEffort', (v) => save({ effort: v }));
      $('#sModel').onchange = (e) => save({ model: e.target.value });
      $('#sMode').onchange = (e) => save({ permissionMode: e.target.value });
    },
    async saglayici(el, stale, health) {
      const h = await health();
      if (stale()) return;
      const provs = Object.entries(state.meta.providers || {});
      const def = s.provider || 'claude';
      const cliCtl = (v, c) => (v ? pill('ok', v, true)
        : `${pill('bad', 'Kurulu değil')}${c.pkg ? `<button class="btn sec" data-install="${esc(c.pkg)}">Kur</button><div class="stg-hint mono">npm i -g ${esc(c.pkg)}${c.alt ? `<br>veya ${esc(c.alt)}` : ''}</div>` : ''}`);
      const provCard = ([key, name]) => {
        const c = PROV[key] || { cli: `${name} CLI` };
        const v = h[`${key}Cli`];
        const list = state.meta.providerModels?.[key];
        let rows = row(c.cli, c.desc || 'Komut satırı aracı', cliCtl(v, c));
        if (c.login) rows += row('Giriş', c.login[4], `<button class="btn sec" id="${c.login[0]}">${c.login[1]}</button>`);
        if (key === 'codex') {
          const sug = modelOpts(list || state.meta.codexModels, '').filter(([x]) => x);
          rows += row('Codex modeli', 'Boş = ~/.codex/config.toml ayarı', `<input id="sCodexModel" class="stg-w" value="${esc(s.codexModel || '')}" placeholder="ör. gpt-5" list="sCodexList"><datalist id="sCodexList">${sug.map(([x, l]) => `<option value="${esc(x)}">${esc(l)}</option>`).join('')}</datalist>`);
        } else if (list) {
          const k = `${key}Model`;
          rows += row('Varsayılan model', `${esc(name)} yeni oturumlarda bu modeli kullanır`, sel(`s${key[0].toUpperCase()}${key.slice(1)}Model`, modelOpts(list, s[k]), s[k] || ''));
        }
        return `<div class="stg-card" data-prov="${esc(key)}"><div class="stg-card-h"><span class="stg-dot ${v ? 'ok' : 'bad'}"></span>${esc(name)}<span class="stg-badge" ${key === def ? '' : 'hidden'}>Varsayılan</span></div>${rows}</div>`;
      };
      const mcpCmd = `claude mcp add borsa -- node ${h.workspace.replace(/workspace$/, 'server/mcp-stdio.js')}`;
      el.innerHTML = card(row('Varsayılan sağlayıcı', 'Yeni oturumlar bu sağlayıcıyla başlar (sohbet panelinden de seçilebilir)', sel('sProv', provs, def)))
        + provs.map(provCard).join('')
        + card(row('Harici MCP erişimi', 'Terminal araçlarını başka Claude Code / Codex oturumlarına ekler', `<div class="stg-code sm" title="${esc(mcpCmd)}"><code>${esc(mcpCmd)}</code><button class="ghost xs" data-copy="mcp">Kopyala</button></div>`));
      $('#sProv').onchange = (e) => {
        save({ provider: e.target.value });
        $$('[data-prov]', el).forEach((c) => { $('.stg-badge', c).hidden = c.dataset.prov !== e.target.value; });
      };
      $('#sCodexModel')?.addEventListener('change', (e) => save({ codexModel: e.target.value.trim() }));
      for (const [key] of provs) {
        const sm = $(`#s${key[0].toUpperCase()}${key.slice(1)}Model`, el);
        if (sm && key !== 'codex') sm.onchange = (e) => save({ [`${key}Model`]: e.target.value });
      }
      $('#sLoginC')?.addEventListener('click', () => { m.close(); emit('term:open', { command: 'claude /login', title: 'claude login' }); });
      $('#sLoginX')?.addEventListener('click', () => { m.close(); emit('term:open', { command: 'codex login', title: 'codex login' }); });
      $$('[data-install]', el).forEach((b) => b.onclick = () => { m.close(); emit('term:open', { command: `npm install -g ${b.dataset.install}`, title: 'kurulum' }); });
      bindCopy(el, { mcp: mcpCmd });
    },
    async baglantilar(el, stale) {
      const c = await api('/agent/connections').catch(() => null);
      if (stale()) return;
      const st = (x) => ({ connected: pill('ok', 'bağlı'), failed: pill('bad', 'hata'), 'needs-auth': pill('warn', 'giriş gerekli'), pending: pill('off', 'bağlanıyor'), disabled: pill('off', 'kapalı') }[x] || pill('off', x));
      el.innerHTML = c ? card(`<p class="stg-note">Son Claude oturumunun (${dateTR(c.at, true)}) gördüğü araçlar ve MCP bağlantıları. Değişiklikler yeni oturumda yansır.</p>`
        + kv([['Claude Code', esc(c.version || '—')], ['Model', esc(c.model || '—')], ['Kimlik doğrulama', esc(c.apiKeySource || '—')], ['Araç sayısı', c.tools.length], ['Alt ajanlar', esc((c.agents || []).join(', ') || '—'), true]])
        + `<div class="stg-scroll"><table class="t"><thead><tr><th>MCP sunucusu</th><th>Durum</th><th>Kaynak</th><th class="r">Araç</th></tr></thead><tbody>${c.mcp.map((x) => `<tr><td>${esc(x.name)}</td><td>${st(x.status)}</td><td class="muted">${esc(x.source || '')}</td><td class="r num">${c.tools.filter((t) => t.startsWith(`mcp__${x.name.replace(/[^\w-]/g, '_')}__`) || (x.name === 'borsa' && t.startsWith('mcp__borsa__'))).length || ''}</td></tr>`).join('')}</tbody></table></div>`
        + '<p class="stg-note">Bağlayıcılar Claude Code ayarlarından (claude.ai bağlayıcıları, <span class="mono">claude mcp add</span>) gelir.</p>')
        : card('<div class="empty">Henüz bir ajan oturumu çalışmadı. Sohbette bir mesaj gönderdikten sonra bağlantılar burada görünür.</div>');
    },
    async veri(el) {
      const SRC = [
        ['BIST hisse ve endeksleri', 'Yahoo Finance', '<b class="accent">~15 dk gecikmeli</b>'],
        ['Döviz, gram/çeyrek/ata altın, gümüş', 'Truncgil', '~1 dk'],
        ['Ons altın (spot)', 'gold-api.com', 'anlık'],
        ['ABD hisseleri, emtia, kripto', 'Yahoo Finance', ''],
        ['Temel oranlar, sektör, temettü/sermaye artırımı, BIST 100/30 üyeliği', 'İş Yatırım', 'günlük'],
        ['Bildirimler', 'KAP', ''],
        ['Haberler', 'Google Haberler ve 7 ekonomi RSS kaynağı', ''],
        ['Mali tablolar', 'İş Yatırım', ''],
        ['Kurum raporları', '12 kurumun açık yayınları', ''],
        ['Kurlar · Risksiz faiz', 'TCMB · TLREF', ''],
        ['TEFAS fonları', 'Elle fiyat veya ajanın <span class="mono">/fonlar</span> komutu', ''],
      ];
      el.innerHTML = card(
        row('Fiyat yenileme aralığı', 'İzleme listesi ve piyasa şeridi', sel('sQuote', [[5, '5 saniye'], [15, '15 saniye'], [30, '30 saniye'], [60, '1 dakika'], [300, '5 dakika']], s.quoteRefreshSec))
        + row('KAP / rapor yenileme aralığı', 'KAP hız sınırı uyguladığı için en az 1 dakika', sel('sKap', [[60, '1 dakika'], [120, '2 dakika'], [300, '5 dakika'], [900, '15 dakika'], [1800, '30 dakika']], s.kapRefreshSec)),
        'Yenileme')
        + card(
          row('Klasör izleme', 'Kendi hesabınızla indirdiğiniz aracı kurum raporlarını (ör. Halk Yatırım şirket raporları, Deniz, Alnus, e-posta ekleri) bu klasörden dakikada bir arşive alır. Yalnız ilk sayfasında aracı kurum adı ve araştırma ifadesi (hedef fiyat, tavsiye, şirket raporu…) geçen, son 30 günde inen PDF\'ler kopyalanır; asıl dosyaya dokunulmaz.', toggle('sInbox', !!s.inboxEnabled))
          + row('İzlenecek klasör', 'Boş bırakılırsa ~/Downloads kullanılır', `<input id="sInboxDir" class="stg-w" placeholder="~/Downloads (varsayılan)" value="${esc(s.inboxDir || '')}"><button class="btn sec" id="sInboxScan">Şimdi tara</button>`, { id: 'sInboxRow' }),
          'Kurum raporu klasör izleme')
        + card(row('Yerel önbellek', 'Geçmiş fiyat, temettü ve KAP önbelleği', '<button class="btn sec" id="sCache">Önbelleği Temizle</button>'), 'Önbellek')
        + card(`<div class="stg-scroll"><table class="stg-tbl"><thead><tr><th>Veri</th><th>Kaynak</th><th class="r">Gecikme</th></tr></thead><tbody>${SRC.map(([a, b, c]) => `<tr><td>${a}</td><td class="muted">${b}</td><td class="r">${c || '<span class="dim">—</span>'}</td></tr>`).join('')}</tbody></table></div>
          <p class="stg-note">Gecikme ve kaynak her fiyatın yanında da gösterilir.</p>`, 'Veri kaynakları');
      const dimInbox = () => $('#sInboxRow').classList.toggle('off', !$('#sInbox').checked);
      dimInbox();
      $('#sQuote').onchange = (e) => save({ quoteRefreshSec: Number(e.target.value) });
      $('#sKap').onchange = (e) => save({ kapRefreshSec: Number(e.target.value) });
      $('#sInbox').onchange = (e) => { dimInbox(); save({ inboxEnabled: e.target.checked }); };
      $('#sInboxDir').onchange = (e) => save({ inboxDir: e.target.value.trim() });
      $('#sInboxScan').onclick = async () => {
        try { const r = await api('/inbox/scan', { method: 'POST', body: {} }); toast(r.imported.length ? `${r.imported.length} kurum raporu arşive alındı` : `Yeni kurum raporu yok (${r.dir})`, 'ok'); } catch (e) { toast(e.message, 'err'); }
      };
      $('#sCache').onclick = async () => { await api('/cache/clear', { method: 'POST', body: {} }); toast('Önbellek temizlendi', 'ok'); };
    },
    // Gateway: sunucunun servis durumu ve yerel API erişim anahtarı
    async gateway(el, stale) {
      const g = await api('/gateway');
      if (stale()) return;
      const dur = (x) => (x < 3600 ? `${Math.floor(x / 60)} dk ${x % 60} sn` : x < 86400 ? `${Math.floor(x / 3600)} sa ${Math.floor((x % 3600) / 60)} dk` : `${Math.floor(x / 86400)} gün ${Math.floor((x % 86400) / 3600)} sa`);
      const svc = g.service.manager ? (g.service.installed ? `Kurulu (${g.service.manager})` : 'Kurulu değil') : 'Bu işletim sisteminde desteklenmiyor';
      el.innerHTML = card(kv([
        ['Mod', g.daemon ? 'Servis (daemon)' : 'Elle başlatıldı'], ['PID', esc(g.pid)], ['Başlangıç', esc(dateTR(g.startedAt, true))],
        ['Çalışma süresi', esc(dur(g.uptimeSec))], ['Port', `UI ${esc(g.port)} · rapor ${esc(g.reportPort)}`], ['Aktif oturumlar', esc(g.activeSessions)],
        ['Bağlı istemciler', esc(g.clients)], ['Servis', esc(svc)], ...(g.service.installed ? [['Servis dosyası', esc(g.service.file), true]] : []),
      ]), `Gateway ${pill('ok', 'Çalışıyor')}`)
        + card(row('Erişim anahtarı', `Yerel API (<span class="mono">/api</span>, WebSocket) bu anahtarı ister. Tarayıcı çerezle otomatik kullanır; betikler için <span class="mono">Authorization: Bearer …</span>. Dosya: <span class="mono">${esc(g.tokenFile)}</span>`,
          `<div class="stg-code"><code id="gwTok">${esc(g.token)}</code></div><div class="stg-btns"><button class="btn sec" id="gwShow">Göster</button><button class="btn sec" id="gwCopy">Kopyala</button><button class="btn sec" id="gwRotate">Yenile</button></div>`, { wide: true }))
        + card(row('Servis denetimi', g.service.installed ? 'Servis komutları: <span class="mono">./bin/kmy gateway status · logs -f · restart</span>' : 'Servis olarak kurmak için: <span class="mono">./bin/kmy gateway install</span>',
          `<button class="btn danger" id="gwRestart">Yeniden Başlat</button>${g.daemon ? '<button class="btn danger" id="gwStop">Durdur</button>' : ''}`));
      const full = () => api('/gateway/token').then((r) => r.token);
      let shown = false;
      $('#gwShow').onclick = async () => {
        try { shown = !shown; $('#gwTok').textContent = shown ? await full() : g.token; $('#gwShow').textContent = shown ? 'Gizle' : 'Göster'; } catch (e) { toast(e.message, 'err'); }
      };
      $('#gwCopy').onclick = async () => {
        try { await navigator.clipboard.writeText(await full()); toast('Erişim anahtarı kopyalandı', 'ok'); } catch (e) { toast(`Kopyalanamadı: ${e.message}`, 'err'); }
      };
      $('#gwRotate').onclick = async () => {
        if (!(await confirmBox('Erişim anahtarı yenilensin mi? Eski anahtarı kullanan betikler ve harici istemciler bağlantıyı kaybeder; bu tarayıcı çalışmaya devam eder.', { danger: true, ok: 'Yenile' }))) return;
        try { await api('/gateway/token/rotate', { method: 'POST', body: {} }); toast('Erişim anahtarı yenilendi', 'ok'); if (!stale()) BLOCKS.gateway(el, stale); } catch (e) { toast(e.message, 'err'); }
      };
      $('#gwRestart').onclick = async () => {
        if (!(await confirmBox('Gateway yeniden başlatılsın mı? Açık terminaller ve çalışan ajan işleri kapanır.', { danger: true, ok: 'Yeniden başlat' }))) return;
        try {
          const r = await api('/gateway/restart', { method: 'POST', body: {} });
          toast(r.message || 'Yeniden başlatılıyor…', '', 8000);
          setTimeout(() => location.reload(), r.mode === 'daemon' ? 7000 : 4000);
        } catch (e) { toast(e.message, 'err'); }
      };
      $('#gwStop')?.addEventListener('click', async () => {
        if (!(await confirmBox('Gateway servisi durdurulsun mu? Arayüz bağlantısı kesilir. Yeniden başlatmak için: ./bin/kmy gateway start', { danger: true, ok: 'Durdur' }))) return;
        try { const r = await api('/gateway/stop', { method: 'POST', body: {} }); toast(r.message, '', 10000); } catch (e) { toast(e.message, 'err'); }
      });
    },
    async sistem(el, stale, health) {
      const h = await health();
      if (stale()) return;
      const up = h.uptimeSec;
      // CLI durumları: meta.providers'taki her sağlayıcı için health[`${anahtar}Cli`]
      const clis = Object.entries(state.meta.providers || { claude: 'Claude', codex: 'Codex' }).map(([k]) => [`${(PROV[k]?.cli || `${k} CLI`).replace(/ \(.*\)$/, '')}`, h[`${k}Cli`] ? pill('ok', h[`${k}Cli`], true) : pill('bad', 'Bulunamadı')]);
      el.innerHTML = card(kv([
        ['Sürüm', esc(h.version)], ['Node', esc(h.node)], ['Platform', esc(h.platform)], ['PID', esc(h.pid)],
        ['Uptime', `${Math.floor(up / 3600)} sa ${Math.floor((up % 3600) / 60)} dk`], ['Bağlı istemci', esc(h.clients)], ['Çalışan ajan', esc(h.runningSessions)], ['BIST', esc(h.market.label)],
        ['Terminal (node-pty)', h.terminal ? pill('ok', 'Hazır') : pill('bad', 'Kullanılamıyor')], ...clis,
        ['Veri klasörü', esc(h.dataDir), true], ['Çalışma alanı', esc(h.workspace), true],
      ]), `Sunucu ${h.ok ? pill('ok', 'Çalışıyor') : pill('bad', 'Sorun var')}`)
        + card(row('Bağlantı', 'WebSocket bağlantısını yeniden kur', '<button class="btn sec" id="sReconnect">Yeniden Bağlan</button>')
          + row('Sunucuyu yeniden başlat', 'Açık terminal oturumlarını ve çalışan ajan işlerini sonlandırır', '<button class="btn danger" id="sRestart">Sunucuyu Yeniden Başlat</button>'));
      $('#sReconnect').onclick = () => { connect(); toast('Yeniden bağlanılıyor…'); };
      $('#sRestart').onclick = async () => {
        if (!(await confirmBox('Sunucu yeniden başlatılsın mı? Açık terminaller ve çalışan ajan işleri kapanır.', { danger: true, ok: 'Yeniden başlat' }))) return;
        const r = await api('/system/restart', { method: 'POST', body: {} }).catch(() => ({}));
        toast('Sunucu yeniden başlatılıyor…', '', 6000);
        setTimeout(() => location.reload(), r.mode === 'daemon' ? 7000 : 4000); // servis modunda launchd/systemd yeniden açar
      };
    },
    async gorevler(el, stale) {
      const DAYS = [['1', 'Pzt'], ['2', 'Sal'], ['3', 'Çar'], ['4', 'Per'], ['5', 'Cum'], ['6', 'Cmt'], ['0', 'Paz']];
      const provName = (p) => ({ claude: 'Claude', codex: 'Codex' }[p] || state.meta.providers?.[p] || p);
      const draw = async (edit = null) => {
        const { items, templates } = await api('/schedules');
        if (stale()) return;
        const e = edit || { name: '', prompt: '', time: '18:20', days: '1,2,3,4,5', provider: s.provider || 'claude', enabled: 1 };
        el.innerHTML = card(`<p class="stg-note">Görevler İstanbul saatiyle arka planda çalışır; sonuçlar sohbet oturumu olarak kaydedilir, raporlar Raporlar sekmesine düşer. Uygulama (sunucu) açık olmalıdır. Onay gerektiren araçlar otomatik reddedilir.</p>
          <div class="stg-scroll"><table class="t"><thead><tr><th>Görev</th><th>Zaman</th><th>Sağlayıcı</th><th>Son çalışma</th><th></th></tr></thead><tbody>${items.map((x) => `<tr class="${x.enabled ? '' : 'dim'}">
            <td><b>${esc(x.name)}</b><div class="dim" style="font-size:11px;max-width:320px;white-space:normal">${esc(x.prompt.slice(0, 120))}…</div></td>
            <td class="mono">${esc(x.time)} · ${x.days.split(',').map((d) => DAYS.find((z) => z[0] === d)?.[1]).join(' ')}</td><td>${esc(provName(x.provider))}</td>
            <td>${x.last_run ? dateTR(new Date(x.last_run.replace(' ', 'T') + 'Z'), true) : '—'}${x.last_session ? ` <button class="ghost" data-open="${x.last_session}">Aç</button>` : ''}</td>
            <td class="r"><button class="ghost" data-run="${x.id}">Şimdi çalıştır</button> <button class="ghost" data-edit="${x.id}">Düzenle</button> <button class="ghost" data-del="${x.id}">Sil</button></td></tr>`).join('') || '<tr><td colspan="5" class="dim">Henüz görev yok. Aşağıdaki şablonlardan birini seçin.</td></tr>'}</tbody></table></div>`)
          + card(`<div class="stg-pad"><div class="stg-tpl">${templates.map((t, i) => `<button class="ghost" data-tpl="${i}">＋ ${esc(t.name)}</button>`).join('')}</div>
          <form id="schForm" class="form-grid">
            <div class="field"><label>AD</label><input name="name" value="${esc(e.name)}" required></div>
            <div class="field"><label>SAAT</label><input name="time" type="time" value="${esc(e.time)}" required></div>
            <div class="field"><label>SAĞLAYICI</label>${sel('schProv', Object.entries(state.meta.providers), e.provider)}</div>
            <div class="field"><label>DURUM</label>${sel('schEn', [[1, 'Etkin'], [0, 'Duraklatıldı']], e.enabled)}</div>
            <div class="field" style="grid-column:1/-1"><label>GÜNLER</label><div class="stg-chips">${DAYS.map(([v, l]) => `<label class="stg-chip"><input type="checkbox" name="d" value="${v}" ${e.days.split(',').includes(v) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
            <div class="field" style="grid-column:1/-1"><label>İSTEM</label><textarea name="prompt" rows="4" required>${esc(e.prompt)}</textarea></div>
            <div style="grid-column:1/-1" class="row"><button class="btn">${e.id ? 'Güncelle' : 'Görev ekle'}</button>${e.id ? '<button type="button" class="btn sec" id="schCancel">Vazgeç</button>' : ''}</div>
          </form></div>`, e.id ? `Görevi düzenle · ${esc(e.name)}` : 'Yeni görev');
        $$('[data-tpl]', el).forEach((b) => b.onclick = () => draw({ ...templates[b.dataset.tpl], provider: s.provider || 'claude', enabled: 1 }));
        $$('[data-edit]', el).forEach((b) => b.onclick = () => draw(items.find((x) => String(x.id) === b.dataset.edit)));
        $$('[data-del]', el).forEach((b) => b.onclick = async () => { if (await confirmBox('Görev silinsin mi?', { danger: true, ok: 'Sil' })) { await api(`/schedules/${b.dataset.del}`, { method: 'DELETE' }); draw(); } });
        $$('[data-run]', el).forEach((b) => b.onclick = async () => { try { const r = await api(`/schedules/${b.dataset.run}/run`, { method: 'POST', body: {} }); toast('Görev başlatıldı', 'ok'); m.close(); emit('agent:open', r.sessionId); } catch (x) { toast(x.message, 'err'); } });
        $$('[data-open]', el).forEach((b) => b.onclick = () => { m.close(); emit('agent:open', b.dataset.open); });
        $('#schCancel')?.addEventListener('click', () => draw());
        $('#schForm').onsubmit = async (ev) => {
          ev.preventDefault();
          const f = ev.target;
          const days = $$('input[name=d]:checked', f).map((x) => x.value).join(',');
          try {
            await api('/schedules', { method: 'POST', body: { id: e.id, name: f.name.value, time: f.time.value, prompt: f.prompt.value, days, provider: $('#schProv').value, enabled: Number($('#schEn').value) } });
            toast('Kaydedildi', 'ok'); draw();
          } catch (x) { toast(x.message, 'err'); }
        };
      };
      await draw();
    },
    async log(el, stale) {
      const draw = async () => {
        const r = await wsCall({ t: 'log.get' }).catch(() => ({ entries: [] }));
        if (stale()) return;
        el.innerHTML = card(`<div class="log">${r.entries.slice().reverse().map((e) => `<div><span class="dim">${new Date(e.at).toLocaleTimeString('tr-TR')}</span> <span class="${e.dir === 'in' ? 'accent' : 'muted'}">${e.dir === 'in' ? '→' : '←'} ${esc(e.t)}</span> ${esc(e.summary)}</div>`).join('') || '<div class="dim">Log boş</div>'}</div>`,
          'Son 50 WS mesajı <span class="stg-live">canlı</span><button class="ghost" id="lRef">Yenile</button>');
        $('#lRef').onclick = draw;
      };
      await draw();
    },
    async surum(el, stale) {
      const r = await api('/changelog').catch(() => ({ text: '' }));
      if (stale()) return;
      el.innerHTML = card(`<div class="msg assistant stg-prose">${md(r.text || 'Sürüm notu yok')}</div>`);
    },
    async yardim(el) {
      const keys = (list) => list.map(([k, d]) => row(esc(d), '', k.map((x) => `<kbd>${esc(x)}</kbd>`).join(''), { sm: true })).join('');
      const cmds = (list) => `<div class="stg-cmds">${list.map(([c, d]) => `<code>${esc(c)}</code><span>${esc(d)}</span>`).join('')}</div>`;
      el.innerHTML = card(keys([
        [['⌘K', 'Ctrl+K'], 'Sembol ara'], [['⌘1–4'], 'Piyasa · Portföy · Terminal · Raporlar'], [['⌘,'], 'Ayarlar'],
        [['Enter'], 'Mesaj gönder'], [['Shift+Enter'], 'Yeni satır'], [['/'], 'Komut menüsü (sohbette)'], [['Esc'], 'Pencereyi kapat'],
        [['Sağ tık (Watchlist)'], 'Grafik · ajan özeti · KAP · işlem ekle'],
      ]), 'Klavye kısayolları')
        + card(cmds([
          ['/analiz SEMBOL', 'Kapsamlı analiz + rapor'], ['/teknik SEMBOL', 'Teknik analiz'], ['/karsilastir A B', 'Karşılaştırma'], ['/piyasa', 'Günlük özet'],
          ['/portfoy', 'Portföy değerlendirmesi'], ['/kap [SEMBOL]', 'Son KAP sinyalleri (sembolle: ajan taraması)'], ['/rapor KONU', 'HTML rapor'], ['/temettu', 'Temettü analizi'],
          ['/tarama KOŞUL', 'Hisse tarayıcı'], ['/fonlar', 'Fon fiyatlarını güncelle'], ['/plan · /model · /think', 'Çalışma modu, model, düşünme seviyesi'],
          ['/yeni [İSİM] · /durdur · /status · /doctor', 'Oturum yönetimi ve sağlık'], ['/help', 'Tüm komutlar'],
        ]), 'Sohbet komutları')
        + '<p class="stg-foot">BIST fiyatları ~15 dk gecikmelidir; kaynak ve gecikme her fiyatın yanında gösterilir. Terminal ve ajan çıktıları yatırım tavsiyesi değildir.</p>';
    },
  };

  let showTok = 0;
  async function show(sec, focusBlock = null) {
    const tok = ++showTok;
    if (!Object.keys(s).length) Object.assign(s, await api('/settings').catch(() => ({})));
    const stale = () => tok !== showTok || !m.el.isConnected;
    let hp = null;
    const health = () => (hp ||= api('/health')); // aynı bölümdeki bloklar /health'i paylaşır
    $$('[data-s]', nav).forEach((b) => { const on = b.dataset.s === sec; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    const [, label, blocks, desc] = SECTIONS.find(([k]) => k === sec);
    $('#stgTitle', m.body).textContent = label;
    $('#stgDesc', m.body).textContent = desc;
    main.scrollTop = 0;
    const multi = blocks.length > 1;
    body.innerHTML = blocks.map(([k, t]) => `<section class="stg-group" data-b="${k}">${multi ? `<h3 class="stg-gt">${esc(t)}</h3>` : ''}<div class="set-blk"><div class="stg-card"><div class="skeleton" style="height:${multi ? 70 : 140}px"></div></div></div></section>`).join('');
    await Promise.all(blocks.map(async ([k]) => {
      const el = $(`[data-b="${k}"] .set-blk`, body);
      try { await BLOCKS[k](el, stale, health); } catch (e) { if (!stale()) el.innerHTML = card(`<div class="empty">Yüklenemedi: ${esc(e.message)}</div>`); }
    }));
    if (focusBlock && !stale() && multi) $(`[data-b="${focusBlock}"]`, body)?.scrollIntoView({ block: 'start' });
  }
  show(section, focus);
}

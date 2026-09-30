// Ayarlar penceresi: Bağlantı, Görünüm, Veri, Sistem, Hakkında (stil: settings.css, kök .stg)
import { state, on, api, wsCall, emit, $, $$, esc, toast, modal, confirmBox, md, dateTR, connect, debounce, sqlDate, today } from './core.js';
import { toolLabel } from './chat.js';
import { t, tx, locale, LANGS, systemLang } from './i18n.js';

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
  ['baglanti', t('Bağlantı'), [['saglayici', t('Sağlayıcılar')], ['ajan', t('Asistan varsayılanları')], ['baglantilar', t('MCP bağlantıları')]], t('Asistan sağlayıcıları, varsayılan model ve MCP bağlantıları')],
  ['gorunum', t('Görünüm'), [['genel', t('Görünüm')]], t('Dil, tema, imza rengi ve yazı boyutları')],
  ['veri', t('Veri'), [['veri', t('Veri')]], t('Fiyat yenileme, kurum raporu izleme, önbellek ve veri kaynakları')],
  ['sistem', t('Sistem'), [['gateway', 'Gateway'], ['sistem', t('Sistem sağlığı')], ['gorevler', t('Zamanlanmış görevler')], ['log', t('Mesaj günlüğü')]], t('Sunucu servisi, sağlık durumu, zamanlanmış görevler ve mesaj günlüğü')],
  ['hakkinda', t('Hakkında'), [['surum', t('Sürüm notları')], ['yardim', t('Kısayollar ve komutlar')]], t('Sürüm notları, klavye kısayolları ve sohbet komutları')],
];
// Eski bölüm anahtarları (genel, ajan, gorevler…) → yeni bölüm
const OLD = Object.fromEntries(SECTIONS.flatMap(([k, , bl]) => bl.map(([b]) => [b, k])));
const isSec = (k) => SECTIONS.some(([x]) => x === k);

// İmza rengi hazır tonları (ilk = varsayılan)
const ACCENTS = [['#ff9f0a', t('Turuncu')], ['#facc15', t('Sarı')], ['#f59e0b', t('Kehribar')], ['#22c55e', t('Yeşil')], ['#2dd4bf', t('Turkuaz')], ['#3b82f6', t('Mavi')], ['#a78bfa', t('Mor')], ['#f472b6', t('Pembe')], ['#ef4444', t('Kırmızı')]];
const ACCENT_DEF = ACCENTS[0][0];
const hexOk = (x) => (/^#[0-9a-f]{6}$/i.test(x || '') ? x.toLowerCase() : null);

// Bilinen sağlayıcılar: kurulum paketi, giriş akışı [id, düğme, komut, terminal başlığı, açıklama]; bilinmeyenler genel kalıpla çizilir
const PROV = {
  claude: { cli: 'Claude Code CLI', desc: t('Claude aboneliğinizle veya API anahtarınızla çalışır'), pkg: '@anthropic-ai/claude-code', login: ['sLoginC', t('Claude ile giriş'), 'claude /login', 'claude login', t('Giriş kabukta başlar, tarayıcıda tamamlanır')] },
  codex: { cli: 'Codex CLI', desc: t('ChatGPT aboneliğinizle çalışır; terminal araçlarına MCP üzerinden erişir'), pkg: '@openai/codex', login: ['sLoginX', t('ChatGPT ile giriş'), 'codex login', 'codex login', t('ChatGPT hesabınızla giriş yapın')] },
  omp: { cli: 'oh-my-pi CLI (omp)', desc: t('omp komut satırı kodlama asistanı'), pkg: '@oh-my-pi/pi-coding-agent', alt: 'brew install can1357/tap/omp' },
};
// Yolo geri sayımı: süre dolunca mod 'default'a döner; sunucunun settings yayını şeridi de kapatır.
// Tek nokta burada: yolo yalnız Ayarlar'dan açılır, kapanışı buradan ve sohbet şeridinden yapılır.
const yoloDone = (st = state.settings) => st.permissionMode !== 'bypassPermissions' || !st.yoloUntil || st.yoloUntil > Date.now();
async function checkYolo() {
  if (yoloDone()) return;
  try {
    await api('/settings', { method: 'PUT', body: { permissionMode: 'default', yoloUntil: 0 } });
    toast(t('Yolo modunun süresi doldu; ajan yeniden onay istiyor.'), '', 8000);
  } catch { /* sunucu yoksa bir sonraki tikte tekrar denenir */ }
}
setInterval(checkYolo, 30000);
on('settings', checkYolo);

export function openSettings(section = 'genel') {
  const focus = isSec(section) ? null : section; // eski anahtar → ilgili bloğa kaydır
  if (!isSec(section)) section = OLD[section] || 'baglanti';
  const m = modal({
    title: t('Ayarlar'), wide: true,
    body: `<div class="stg">
      <aside class="stg-side">
        <div class="stg-brand"><b>${t('Ayarlar')}</b><span>kmy terminal</span></div>
        <nav class="stg-nav" role="tablist" aria-label="${t('Ayar bölümleri')}">${SECTIONS.map(([k, l]) => `<button type="button" role="tab" data-s="${k}">${svg(k)}<span>${l}</span></button>`).join('')}</nav>
        <div class="stg-tip">${t('{open} ile açılır · {close} ile kapanır', { open: '<kbd>⌘</kbd><kbd>,</kbd>', close: '<kbd>Esc</kbd>' }).replace(' · ', '<br>· ')}</div>
      </aside>
      <div class="stg-main">
        <div class="stg-head"><div><h2 id="stgTitle"></h2><p id="stgDesc"></p></div><button class="icon-btn stg-x" data-close aria-label="${t('Kapat')}">✕</button></div>
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
      if (Object.keys(patch).some((k) => !(k in r))) toast(t('Sunucu bu ayarı henüz tanımıyor; sunucu yeniden başlatıldığında kaydedilir'), 'err', 7000);
      else toast(t('Kaydedildi'), 'ok');
    } catch (e) { toast(tx(e.message), 'err'); }
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
  const code = (text, id) => `<div class="stg-code"><code>${esc(text)}</code><button class="ghost" data-copy="${id}">${t('Kopyala')}</button></div>`;
  const bindCopy = (el, map) => $$('[data-copy]', el).forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(map[b.dataset.copy]); toast(t('Kopyalandı'), 'ok'); } catch (e) { toast(t('Kopyalanamadı: {msg}', { msg: e.message }), 'err'); }
  });
  // Model listesi: [{id,label}] veya ['id'] kabul eder; boş seçenek = sağlayıcı varsayılanı
  const modelOpts = (list, cur) => {
    const o = (list || []).map((x) => (typeof x === 'string' ? [x, x] : [x.id ?? '', x.label || x.name || x.id || t('Varsayılan')]));
    if (!o.some(([v]) => v === '')) o.unshift(['', t('Varsayılan')]);
    if (cur && !o.some(([v]) => v === cur)) o.push([cur, cur]);
    return o;
  };

  // Blok çizicileri: her biri kendi kabına (el) yazar; stale() geç gelen yanıtları yok sayar
  const BLOCKS = {
    async genel(el) {
      const cur = hexOk(s.accent) || ACCENT_DEF;
      const custom = !ACCENTS.some(([x]) => x === cur);
      const langOpts = [['auto', t('Sistem dili ({name})', { name: LANGS[systemLang()] })], ['tr', LANGS.tr], ['en', LANGS.en]];
      el.innerHTML = card(
        row(t('Dil'), t('Arayüz dili. Varsayılan olarak sistem dilini izler.'), sel('sLang', langOpts, s.language || 'auto'))
        + row(t('Tema'), t('Koyu ya da açık görünüm'), seg('sTheme', [['dark', t('[tema]Koyu')], ['light', t('[tema]Açık')]], s.theme === 'light' ? 'light' : 'dark'))
        + row(t('İmza rengi'), t('Vurgular, seçili sekme, düğmeler ve odak halkalarında kullanılır · {hex} · {reset}', { hex: `<span class="mono" id="sAccentHex">${esc(cur)}</span>`, reset: `<button type="button" class="stg-link" id="sAccentReset">${t('Varsayılana dön')}</button>` }),
          `<div class="stg-accent" id="sAccent">${ACCENTS.map(([x, n]) => `<button type="button" class="stg-sw" data-hex="${x}" style="--sw:${x}" title="${esc(x === ACCENT_DEF ? t('{name} (varsayılan)', { name: n }) : n)}" aria-label="${esc(n)}" aria-pressed="${x === cur}"></button>`).join('')}<label class="stg-sw stg-sw-custom" title="${t('Özel renk')}" aria-pressed="${custom}" style="--sw:${cur}"><input type="color" id="sAccentCustom" value="${cur}" aria-label="${t('Özel renk')}"></label></div>`),
        t('Dil ve tema'))
        + card(
          row(t('Sohbet yazı boyutu'), t('Sohbet mesajları ve mesaj kutusu'), seg('sChatFont', [[12, t('Küçük')], [14, t('Orta')], [16, t('Büyük')], [18, t('Çok büyük')]], s.chatFontSize))
          + row(t('Terminal sekmesi'), t('Asistan sohbetiyle mi, kabukla mı açılsın'), seg('sUi', [['chat', t('Sohbet')], ['terminal', t('Kabuk')]], s.uiMode === 'terminal' ? 'terminal' : 'chat'))
          + row(t('Kabuk yazı boyutu'), t('8 ile 24 px arası'), `<span class="stg-num"><input id="sTermFont" type="number" min="8" max="24" value="${esc(s.terminalFontSize)}"><i>px</i></span>`)
          + row(t('Temel para birimi'), t('Portföy değerleri TL olarak tutulur; USD karşılığı ayrıca gösterilir'), sel('sBase', [['TRY', t('TL (₺)')]], s.baseCurrency)),
          t('Yazı ve düzen'));
      // Dil: sunucuya kaydet, tarayıcı kopyasını güncelle ve sayfayı yeniden yükle (modüller açılışta bir kez çizilir)
      $('#sLang').onchange = async (e) => {
        const v = e.target.value;
        await save({ language: v });
        try { localStorage.setItem('bt.lang', JSON.stringify(v)); } catch { /* depolama kapalı */ }
        location.reload();
      };
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
      const yolo = () => s.permissionMode === 'bypassPermissions';
      // Yolo anahtarı ve izin modu seçici aynı alanı paylaşır: ikisi de markYolo ile eşitlenir
      const markYolo = () => {
        const b = $('#sYoloBadge');
        if (b) b.innerHTML = yolo() ? pill('yolo', t('şu an: YOLO (tüm araçlara izin)')) : pill('ok', t('şu an: SOR'));
        const sw = $('#sYolo');
        if (sw) sw.checked = yolo();
        const md = $('#sMode');
        if (md) md.value = s.permissionMode || 'default';
      };
      el.innerHTML = card(
        row(t('Varsayılan model'), t('Yeni Claude oturumları bu modelle başlar'), sel('sModel', state.meta.models.map((x) => [x.id, x.label]), s.model || String(state.meta.defaultModels?.claude || '').replace(/\[.*\]$/, '')))
        + row(t('Düşünme düzeyi'), t('Yeni oturumların varsayılan düşünme düzeyi'), state.meta.efforts.length <= 4 ? seg('sEffort', state.meta.efforts.map((x) => [x, x]), s.effort) : sel('sEffort', state.meta.efforts.map((x) => [x, x]), s.effort))
        + row(t('İzin modu'), t('Asistanın bir aracı kullanmadan önce ne zaman onay isteyeceği'), sel('sMode', Object.entries(state.meta.permissionModes).map(([k, v]) => [k, tx(v)]), s.permissionMode))
        + row(t('Ajana tam otomatik izin (yolo)'), t('Açıkken ajan hiçbir araç için onay istemez; seçilen süre dolunca kendiliğinden kapanır.'),
          `<span id="sYoloBadge"></span>${sel('sYoloDur', [[1800, t('30 dakika')], [7200, t('2 saat')], [0, t('Bu oturum')]], 1800)}${toggle('sYolo', yolo())}`, { wide: true })
        + row(t('Çalışma alanı'), t('Asistanın kalıcı talimatları, becerileri ve bilgi dosyaları: {files}', { files: '<span class="mono">CLAUDE.md · .claude/skills · knowledge/</span>' }), `<span class="stg-path mono">${esc(h.workspace)}</span>`, { wide: true }));
      if ($('#sEffort').tagName === 'SELECT') $('#sEffort').onchange = (e) => save({ effort: e.target.value });
      else onSeg('sEffort', (v) => save({ effort: v }));
      $('#sModel').onchange = (e) => save({ model: e.target.value });
      // 0 = bu oturum (süre yok); yoloUntil 0 olunca otomatik kapanma yok (bkz. checkYolo)
      const until = () => { const d = Number($('#sYoloDur').value) * 1000; return d ? Date.now() + d : 0; };
      $('#sMode').onchange = async (e) => {
        const v = e.target.value;
        await save({ permissionMode: v, yoloUntil: v === 'bypassPermissions' ? until() : 0 });
        markYolo();
      };
      $('#sYolo').onchange = async (e) => {
        if (e.target.checked) {
          const okYolo = await confirmBox(t('Ajan artık portföyüne işlem ekleyebilir, hafıza ve rapor dosyası yazabilir, izleme listeni değiştirebilir. Her yaptığı iş denetim kaydına yazılır. Kapatmak için aynı anahtara tekrar bas.'), { danger: true, ok: t('Yolo modunu aç') });
          if (!okYolo) { markYolo(); return; }
          await save({ permissionMode: 'bypassPermissions', yoloUntil: until() });
        } else await save({ permissionMode: 'default', yoloUntil: 0 });
        markYolo();
      };
      markYolo();
    },
    async saglayici(el, stale, health) {
      const h = await health();
      if (stale()) return;
      const provs = Object.entries(state.meta.providers || {});
      const def = s.provider || 'claude';
      const cliCtl = (v, c) => (v ? pill('ok', v, true)
        : `${pill('bad', t('Kurulu değil'))}${c.pkg ? `<button class="btn sec" data-install="${esc(c.pkg)}">${t('Kurulumu başlat')}</button><div class="stg-hint mono">npm i -g ${esc(c.pkg)}${c.alt ? `<br>${t('veya {cmd}', { cmd: esc(c.alt) })}` : ''}</div>` : ''}`);
      const provCard = ([key, name]) => {
        const c = PROV[key] || { cli: `${name} CLI` };
        const v = h[`${key}Cli`];
        const list = state.meta.providerModels?.[key];
        let rows = row(c.cli, c.desc || t('Komut satırı aracı'), cliCtl(v, c));
        if (c.login) rows += row(t('Hesap girişi'), c.login[4], `<button class="btn sec" id="${c.login[0]}">${c.login[1]}</button>`);
        if (key === 'codex') {
          const sug = modelOpts(list || state.meta.codexModels, '').filter(([x]) => x);
          rows += row(t('Codex modeli'), t('Boş bırakılırsa ~/.codex/config.toml ayarı kullanılır'), `<input id="sCodexModel" class="stg-w" value="${esc(s.codexModel || '')}" placeholder="${t('ör. gpt-5')}" list="sCodexList"><datalist id="sCodexList">${sug.map(([x, l]) => `<option value="${esc(x)}">${esc(l)}</option>`).join('')}</datalist>`);
        } else if (list) {
          const k = `${key}Model`;
          rows += row(t('Varsayılan model'), t('{name} yeni oturumlarda bu modeli kullanır', { name: esc(name) }), sel(`s${key[0].toUpperCase()}${key.slice(1)}Model`, modelOpts(list, s[k] || state.meta.defaultModels?.[key] || ''), s[k] || state.meta.defaultModels?.[key] || ''));
        }
        return `<div class="stg-card" data-prov="${esc(key)}"><div class="stg-card-h"><span class="stg-dot ${v ? 'ok' : 'bad'}"></span>${esc(name)}<span class="stg-badge" ${key === def ? '' : 'hidden'}>${t('Varsayılan')}</span></div>${rows}</div>`;
      };
      const mcpCmd = `claude mcp add borsa -- node ${h.workspace.replace(/workspace$/, 'server/mcp-stdio.js')}`;
      // Yetenek matrisi: /api/meta capabilities yoksa (eski sunucu) kart hiç çizilmez
      const caps = state.meta.capabilities;
      // [anahtar, etiket, desteklenmeyen gerekçesi, kısmi destek notu]
      // Kısmi not etiketi tekrarlamamalı: sütun zaten etiketi gösteriyor.
      const CAP_ROWS = [
        ['effort', t('Düşünme düzeyi'), t('{name} düşünme seviyesini desteklemiyor.'), ''],
        ['subagent', t('Alt asistan'), t('{name} alt asistan başlatmayı desteklemiyor.'), ''],
        ['cost', t('Maliyet'), t('{name} gerçek maliyeti ölçemiyor.'), t('yalnızca tahmini (estCost)')],
        ['bypass', t('Bypass / yolo'), t('{name} tüm araçlara otomatik izin verilmesini desteklemiyor.'), ''],
      ];
      const capTable = (key) => {
        const c = caps?.[key] || {};
        const nm = PROV[key]?.cli || state.meta.providers?.[key] || key;
        return card(`<div class="stg-scroll"><table class="stg-tbl"><tbody>${CAP_ROWS.map(([k, label, why, partial]) => {
          // true → tam destek, 'est' gibi bir dize → destekli ama kısmi, false → yok
          const v = c[k];
          const on = !!v && v !== false;
          if (v === true) return `<tr><td><b>✓</b> ${esc(label)}</td><td class="r dim">${esc(t('destekleniyor'))}</td></tr>`;
          const r = v && typeof v === 'object' && v.why ? tx(v.why) : (on ? partial : why.replace('{name}', nm));
          return `<tr><td><b${on ? '' : ' class="dim"'}>${on ? '✓' : '✗'}</b> <span${on ? '' : ' class="dim"'}>${esc(label)}</span></td><td class="r dim" title="${esc(r)}">${esc(r)}</td></tr>`;
        }).join('')}</tbody></table></div>`, t('Sağlayıcı yetenekleri'));
      };
      el.innerHTML = card(row(t('Varsayılan sağlayıcı'), t('Yeni oturumlar bu sağlayıcıyla başlar; sohbet panelinden de değiştirebilirsiniz'), sel('sProv', provs, def)))
        + (caps ? `<div id="sCapBox">${capTable(def)}</div>` : '')
        + provs.map(provCard).join('')
        + card(row(t('Harici MCP erişimi'), t('Terminal araçlarını başka Claude Code veya Codex oturumlarına ekler'), `<div class="stg-code sm" title="${esc(mcpCmd)}"><code>${esc(mcpCmd)}</code><button class="ghost xs" data-copy="mcp">${t('Kopyala')}</button></div>`));
      $('#sProv').onchange = (e) => {
        save({ provider: e.target.value });
        $$('[data-prov]', el).forEach((c) => { $('.stg-badge', c).hidden = c.dataset.prov !== e.target.value; });
        if (caps) $('#sCapBox').innerHTML = capTable(e.target.value);
      };
      $('#sCodexModel')?.addEventListener('change', (e) => save({ codexModel: e.target.value.trim() }));
      for (const [key] of provs) {
        const sm = $(`#s${key[0].toUpperCase()}${key.slice(1)}Model`, el);
        // Sunucu anahtarı 'model' tutar (bkz. DEFAULT_SETTINGS); 'claudeModel' sessizce düşerdi
        if (sm && key !== 'codex') sm.onchange = (e) => save({ [key === 'claude' ? 'model' : `${key}Model`]: e.target.value });
      }
      $('#sLoginC')?.addEventListener('click', () => { m.close(); emit('term:open', { command: 'claude /login', title: 'claude login' }); });
      $('#sLoginX')?.addEventListener('click', () => { m.close(); emit('term:open', { command: 'codex login', title: 'codex login' }); });
      $$('[data-install]', el).forEach((b) => b.onclick = () => { m.close(); emit('term:open', { command: `npm install -g ${b.dataset.install}`, title: t('kurulum') }); });
      bindCopy(el, { mcp: mcpCmd });
    },
    async baglantilar(el, stale) {
      const c = await api('/agent/connections').catch(() => null);
      if (stale()) return;
      const st = (x) => ({ connected: pill('ok', t('Bağlı')), failed: pill('bad', t('Hata')), 'needs-auth': pill('warn', t('Giriş gerekli')), pending: pill('off', t('Bağlanıyor')), disabled: pill('off', t('Devre dışı')) }[x] || pill('off', x));
      el.innerHTML = c ? card(`<p class="stg-note">${t('Son Claude oturumunun ({date}) gördüğü araçlar ve MCP bağlantıları. Değişiklikler bir sonraki oturumda geçerli olur.', { date: dateTR(c.at, true) })}</p>`
        + kv([['Claude Code', esc(c.version || '—')], [t('Model'), esc(c.model || '—')], [t('Kimlik doğrulama'), esc(c.apiKeySource || '—')], [t('Araç sayısı'), c.tools.length], [t('Alt asistanlar'), esc((c.agents || []).join(', ') || '—'), true]])
        + `<div class="stg-scroll"><table class="t"><thead><tr><th>${t('MCP sunucusu')}</th><th>${t('Durum')}</th><th>${t('Kaynak')}</th><th class="r">${t('Araç')}</th></tr></thead><tbody>${c.mcp.map((x) => `<tr><td>${esc(x.name)}</td><td>${st(x.status)}</td><td class="muted">${esc(x.source || '')}</td><td class="r num">${c.tools.filter((tool) => tool.startsWith(`mcp__${x.name.replace(/[^\w-]/g, '_')}__`) || (x.name === 'borsa' && tool.startsWith('mcp__borsa__'))).length || ''}</td></tr>`).join('')}</tbody></table></div>`
        + `<p class="stg-note">${t('Bağlayıcılar Claude Code ayarlarından gelir (claude.ai bağlayıcıları, {cmd}).', { cmd: '<span class="mono">claude mcp add</span>' })}</p>`)
        : card(`<div class="empty">${t('Henüz bir asistan oturumu yok. Sohbette bir mesaj gönderdiğinizde bağlantılar burada görünür.')}</div>`);
    },
    async veri(el) {
      const sec = (n) => t('{n} saniye', { n });
      const min = (n) => t('{n} dakika', { n });
      const SRC = [
        [t('BIST hisse ve endeksleri'), 'Yahoo Finance', `<b class="accent">${t('~15 dk gecikmeli')}</b>`],
        [t('Döviz, gram/çeyrek/ata altın, gümüş'), 'Truncgil', t('~1 dk')],
        [t('Ons altın (spot)'), 'gold-api.com', t('Anlık')],
        [t('ABD hisseleri, emtia, kripto'), 'Yahoo Finance', ''],
        [t('Temel oranlar, sektör, temettü/sermaye artırımı, BIST 100/30 üyeliği'), 'İş Yatırım', t('Günde bir')],
        [t('Bildirimler'), 'KAP', ''],
        [t('Haberler'), t('Google Haberler ve 7 ekonomi RSS kaynağı'), ''],
        [t('Mali tablolar'), 'İş Yatırım', ''],
        [t('Kurum raporları'), t('12 kurumun açık yayınları'), ''],
        [t('Kurlar · Risksiz faiz'), 'TCMB · TLREF', ''],
        [t('TEFAS yatırım ve emeklilik fonları'), 'TEFAS', t('Günde bir (akşam)')],
      ];
      el.innerHTML = card(
        row(t('Fiyat yenileme aralığı'), t('İzleme listesi ve piyasa şeridi'), sel('sQuote', [[5, sec(5)], [15, sec(15)], [30, sec(30)], [60, min(1)], [300, min(5)]], s.quoteRefreshSec))
        + row(t('KAP ve rapor yenileme aralığı'), t('KAP istek sınırı uyguladığı için en az 1 dakika'), sel('sKap', [[60, min(1)], [120, min(2)], [300, min(5)], [900, min(15)], [1800, min(30)]], s.kapRefreshSec)),
        t('Yenileme'))
        + card(
          row(t('Klasör izleme'), t('Kendi hesabınızla indirdiğiniz aracı kurum raporlarını (ör. Halk Yatırım, Deniz, Alnus raporları, e-posta ekleri) bu klasörden dakikada bir arşive alır. Yalnızca ilk sayfasında aracı kurum adı ve araştırma ifadesi (hedef fiyat, tavsiye, şirket raporu…) geçen ve son 30 günde inen PDF’ler kopyalanır; asıl dosyaya dokunulmaz.'), toggle('sInbox', !!s.inboxEnabled))
          + row(t('İzlenecek klasör'), t('Boş bırakılırsa ~/Downloads kullanılır'), `<input id="sInboxDir" class="stg-w" placeholder="${t('~/Downloads (varsayılan)')}" value="${esc(s.inboxDir || '')}">`, { id: 'sInboxRow' }),
          t('Kurum raporları için klasör izleme'))
        + card(row(t('Yerel önbellek'), t('Geçmiş fiyat, temettü ve KAP önbelleği'), `<button class="btn sec" id="sCache">${t('Önbelleği temizle')}</button>`), t('Önbellek'))
        + card(`<div class="stg-scroll"><table class="stg-tbl"><thead><tr><th>${t('Veri')}</th><th>${t('Kaynak')}</th><th class="r">${t('Gecikme')}</th></tr></thead><tbody>${SRC.map(([a, b, c]) => `<tr><td>${a}</td><td class="muted">${b}</td><td class="r">${c || '<span class="dim">—</span>'}</td></tr>`).join('')}</tbody></table></div>
          <p class="stg-note">${t('Gecikme ve kaynak her fiyatın yanında da gösterilir.')}</p>`, t('Veri kaynakları'));
      const dimInbox = () => $('#sInboxRow').classList.toggle('off', !$('#sInbox').checked);
      dimInbox();
      $('#sQuote').onchange = (e) => save({ quoteRefreshSec: Number(e.target.value) });
      $('#sKap').onchange = (e) => save({ kapRefreshSec: Number(e.target.value) });
      $('#sInbox').onchange = (e) => { dimInbox(); save({ inboxEnabled: e.target.checked }); };
      $('#sInboxDir').onchange = (e) => save({ inboxDir: e.target.value.trim() });
      $('#sCache').onclick = async () => { await api('/cache/clear', { method: 'POST', body: {} }); toast(t('Önbellek temizlendi'), 'ok'); };
    },
    // Gateway: sunucunun servis durumu ve yerel API erişim anahtarı
    async gateway(el, stale) {
      const g = await api('/gateway');
      if (stale()) return;
      const dur = (x) => (x < 3600 ? t('{m} dk {s} sn', { m: Math.floor(x / 60), s: x % 60 }) : x < 86400 ? t('{h} sa {m} dk', { h: Math.floor(x / 3600), m: Math.floor((x % 3600) / 60) }) : t('{d} gün {h} sa', { d: Math.floor(x / 86400), h: Math.floor((x % 86400) / 3600) }));
      const svc = g.service.manager ? (g.service.installed ? t('Kurulu ({manager})', { manager: g.service.manager }) : t('Kurulu değil')) : t('Bu işletim sisteminde desteklenmiyor');
      el.innerHTML = card(kv([
        [t('Çalışma şekli'), g.daemon ? t('Servis (daemon)') : t('Elle başlatıldı')], ['PID', esc(g.pid)], [t('Başlangıç'), esc(dateTR(g.startedAt, true))],
        [t('Çalışma süresi'), esc(dur(g.uptimeSec))], [t('Port'), t('Arayüz {ui} · rapor {rep}', { ui: esc(g.port), rep: esc(g.reportPort) })], [t('Etkin oturumlar'), esc(g.activeSessions)],
        [t('Bağlı istemciler'), esc(g.clients)], [t('Servis'), esc(svc)], ...(g.service.installed ? [[t('Servis dosyası'), esc(g.service.file), true]] : []),
      ]), `Gateway ${pill('ok', t('Çalışır durumda'))}`)
        + card(row(t('Erişim anahtarı'), t('Yerel API ({api}, WebSocket) bu anahtarı ister. Tarayıcı anahtarı çerezle kendiliğinden gönderir; betiklerde {header} başlığını kullanın. Dosya: {file}', { api: '<span class="mono">/api</span>', header: '<span class="mono">Authorization: Bearer …</span>', file: `<span class="mono">${esc(g.tokenFile)}</span>` }),
          `<div class="stg-code"><code id="gwTok">${esc(g.token)}</code></div><div class="stg-btns"><button class="btn sec" id="gwShow">${t('Göster')}</button><button class="btn sec" id="gwCopy">${t('Kopyala')}</button><button class="btn sec" id="gwRotate">${t('Yeni anahtar')}</button></div>`, { wide: true }))
        + card(row(t('Servis denetimi'), g.service.installed ? t('Servis komutları: {cmd}', { cmd: '<span class="mono">./bin/kmy gateway status · logs -f · restart</span>' }) : t('Servis olarak kurmak için: {cmd}', { cmd: '<span class="mono">./bin/kmy gateway install</span>' }),
          `<button class="btn danger" id="gwRestart">${t('Yeniden başlat')}</button>${g.daemon ? `<button class="btn danger" id="gwStop">${t('Durdur')}</button>` : ''}`));
      const full = () => api('/gateway/token').then((r) => r.token);
      let shown = false;
      $('#gwShow').onclick = async () => {
        try { shown = !shown; $('#gwTok').textContent = shown ? await full() : g.token; $('#gwShow').textContent = shown ? t('Gizle') : t('Göster'); } catch (e) { toast(tx(e.message), 'err'); }
      };
      $('#gwCopy').onclick = async () => {
        try { await navigator.clipboard.writeText(await full()); toast(t('Erişim anahtarı kopyalandı'), 'ok'); } catch (e) { toast(t('Kopyalanamadı: {msg}', { msg: tx(e.message) }), 'err'); }
      };
      $('#gwRotate').onclick = async () => {
        if (!(await confirmBox(t('Yeni bir erişim anahtarı üretilsin mi? Eski anahtarı kullanan betikler ve harici istemciler bağlantıyı kaybeder; bu tarayıcı çalışmaya devam eder.'), { danger: true, ok: t('Yeni anahtar üret') }))) return;
        try { await api('/gateway/token/rotate', { method: 'POST', body: {} }); toast(t('Yeni erişim anahtarı üretildi'), 'ok'); if (!stale()) BLOCKS.gateway(el, stale); } catch (e) { toast(tx(e.message), 'err'); }
      };
      $('#gwRestart').onclick = async () => {
        if (!(await confirmBox(t('Gateway yeniden başlatılsın mı? Açık kabuklar ve çalışan asistan işleri kapanır.'), { danger: true, ok: t('Yeniden başlat') }))) return;
        try {
          const r = await api('/gateway/restart', { method: 'POST', body: {} });
          toast(r.message ? tx(r.message) : t('Yeniden başlatılıyor…'), '', 8000);
          setTimeout(() => location.reload(), r.mode === 'daemon' ? 7000 : 4000);
        } catch (e) { toast(tx(e.message), 'err'); }
      };
      $('#gwStop')?.addEventListener('click', async () => {
        if (!(await confirmBox(t('Gateway servisi durdurulsun mu? Arayüzün bağlantısı kesilir. Yeniden başlatmak için: {cmd}', { cmd: './bin/kmy gateway start' }), { danger: true, ok: t('Durdur') }))) return;
        try { const r = await api('/gateway/stop', { method: 'POST', body: {} }); toast(tx(r.message), '', 10000); } catch (e) { toast(tx(e.message), 'err'); }
      });
    },
    async sistem(el, stale, health) {
      const h = await health();
      if (stale()) return;
      const up = h.uptimeSec;
      // CLI durumları: meta.providers'taki her sağlayıcı için health[`${anahtar}Cli`]
      const clis = Object.entries(state.meta.providers || { claude: 'Claude', codex: 'Codex' }).map(([k]) => [`${(PROV[k]?.cli || `${k} CLI`).replace(/ \(.*\)$/, '')}`, h[`${k}Cli`] ? pill('ok', h[`${k}Cli`], true) : pill('bad', t('Bulunamadı'))]);
      el.innerHTML = card(kv([
        [t('Sürüm'), esc(h.version)], ['Node', esc(h.node)], [t('Platform'), esc(h.platform)], ['PID', esc(h.pid)],
        [t('Çalışma süresi'), t('{h} sa {m} dk', { h: Math.floor(up / 3600), m: Math.floor((up % 3600) / 60) })], [t('Bağlı istemciler'), esc(h.clients)], [t('Çalışan oturumlar'), esc(h.runningSessions)], ['BIST', esc(tx(h.market.label))],
        [t('Kabuk (node-pty)'), h.terminal ? pill('ok', t('Hazır')) : pill('bad', t('Kullanılamıyor'))], ...clis,
        [t('Veri klasörü'), esc(h.dataDir), true], [t('Çalışma alanı'), esc(h.workspace), true],
      ]), `${t('Sunucu')} ${h.ok ? pill('ok', t('Çalışır durumda')) : pill('bad', t('Sorun var'))}`)
        + card(row(t('Bağlantı'), t('WebSocket bağlantısını yeniden kurar'), `<button class="btn sec" id="sReconnect">${t('Yeniden bağlan')}</button>`)
          + row(t('Sunucuyu yeniden başlat'), t('Açık kabukları ve çalışan asistan işlerini kapatır'), `<button class="btn danger" id="sRestart">${t('Yeniden başlat')}</button>`))
        + (s.permissionMode === 'bypassPermissions' ? '<div id="sAudit"></div>' : '');
      // Denetim kaydı yalnız yolo modundayken anlamlı; yolo kapanınca kart da kaybolur
      if ($('#sAudit')) {
        const drawAudit = async () => {
          const box = $('#sAudit');
          if (!box) return;
          const r = await api('/tool-audit?limit=200').catch(() => null);
          if (stale() || !$('#sAudit')) return;
          const rows = Array.isArray(r) ? r : r?.rows || r?.items || [];
          const day = today(); // İstanbul günü; kayıt UTC yazılıyor
          const td = rows.filter((x) => { const d = sqlDate(x.at); return d && d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }) === day; });
          box.innerHTML = card(`<p class="stg-note">${t('Bugün {n} araç çağrısına izin verildi, {m} tanesi reddedildi.', { n: td.filter((x) => x.allowed).length, m: td.filter((x) => !x.allowed).length })}</p>
            <div class="stg-scroll"><table class="stg-tbl"><thead><tr><th>${t('Zaman')}</th><th>${t('Araç')}</th><th>${t('Oturum')}</th><th>${t('Mod')}</th><th class="r">${t('İzin')}</th><th>${t('Gerekçe')}</th></tr></thead><tbody>${rows.map((x) => `<tr>
              <td class="mono">${esc(dateTR(sqlDate(x.at), true))}</td>
              <td title="${esc(x.tool || '')}">${esc(toolLabel(x.tool))}</td>
              <td class="mono dim">${esc((x.session_id || '').slice(0, 8) || '—')}</td>
              <td class="dim">${esc(x.mode || '—')}</td>
              <td class="r">${x.allowed ? '<b class="up">✓</b>' : '<b class="down">✗</b>'}</td>
              <td class="dim">${esc(x.reason || '')}</td></tr>`).join('') || `<tr><td colspan="6" class="dim">${t('Denetim kaydı yok')}</td></tr>`}</tbody></table></div>`,
            `${t('Ajan işlem kaydı')}<button class="ghost" id="sAuditClear">${t('Kaydı temizle')}</button>`);
          $('#sAuditClear').onclick = async () => {
            if (!(await confirmBox(t('Tüm ajan işlem kaydı silinsin mi?'), { danger: true, ok: t('Kaydı temizle') }))) return;
            await api('/tool-audit/clear', { method: 'POST', body: {} }).catch(() => null);
            drawAudit();
          };
        };
        await drawAudit();
      }
      $('#sReconnect').onclick = () => { connect(); toast(t('Yeniden bağlanılıyor…')); };
      $('#sRestart').onclick = async () => {
        if (!(await confirmBox(t('Sunucu yeniden başlatılsın mı? Açık kabuklar ve çalışan asistan işleri kapanır.'), { danger: true, ok: t('Yeniden başlat') }))) return;
        const r = await api('/system/restart', { method: 'POST', body: {} }).catch(() => ({}));
        toast(t('Sunucu yeniden başlatılıyor…'), '', 6000);
        setTimeout(() => location.reload(), r.mode === 'daemon' ? 7000 : 4000); // servis modunda launchd/systemd yeniden açar
      };
    },
    async gorevler(el, stale) {
      const DAYS = [['1', t('Pzt')], ['2', t('Sal')], ['3', t('Çar')], ['4', t('Per')], ['5', t('Cum')], ['6', t('Cmt')], ['0', t('Paz')]];
      const provName = (p) => ({ claude: 'Claude', codex: 'Codex' }[p] || state.meta.providers?.[p] || p);
      const draw = async (edit = null) => {
        const { items, templates } = await api('/schedules');
        if (stale()) return;
        const e = edit || { name: '', prompt: '', time: '18:20', days: '1,2,3,4,5', provider: s.provider || 'claude', enabled: 1 };
        el.innerHTML = card(`<p class="stg-note">${t('Görevler İstanbul saatiyle arka planda çalışır. Sonuçlar sohbet oturumu olarak kaydedilir, raporlar Raporlar sekmesinde görünür. Bunun için uygulamanın açık olması gerekir; onay isteyen araçlar kendiliğinden reddedilir.')}</p>
          <div class="stg-scroll"><table class="t"><thead><tr><th>${t('Görev')}</th><th>${t('Çalışma zamanı')}</th><th>${t('Sağlayıcı')}</th><th>${t('Son çalışma')}</th><th></th></tr></thead><tbody>${items.map((x) => `<tr class="${x.enabled ? '' : 'dim'}">
            <td><b>${esc(x.name)}</b><div class="dim" style="font-size:11px;max-width:320px;white-space:normal">${esc(x.prompt.slice(0, 120))}…</div></td>
            <td class="mono">${esc(x.time)} · ${x.days.split(',').map((d) => DAYS.find((z) => z[0] === d)?.[1]).join(' ')}</td><td>${esc(provName(x.provider))}</td>
            <td>${x.last_run ? dateTR(new Date(x.last_run.replace(' ', 'T') + 'Z'), true) : '—'}${x.last_session ? ` <button class="ghost" data-open="${x.last_session}">${t('Aç')}</button>` : ''}</td>
            <td class="r"><button class="ghost" data-run="${x.id}">${t('Şimdi çalıştır')}</button> <button class="ghost" data-edit="${x.id}">${t('Düzenle')}</button> <button class="ghost" data-del="${x.id}">${t('Sil')}</button></td></tr>`).join('') || `<tr><td colspan="5" class="dim">${t('Henüz görev yok. Aşağıdaki şablonlardan birini seçin.')}</td></tr>`}</tbody></table></div>`)
          + card(`<div class="stg-pad"><div class="stg-tpl">${templates.map((tp, i) => `<button class="ghost" data-tpl="${i}">＋ ${esc(tx(tp.name))}</button>`).join('')}</div>
          <form id="schForm" class="form-grid">
            <div class="field"><label>${t('Ad')}</label><input name="name" value="${esc(e.name)}" required></div>
            <div class="field"><label>${t('Saat')}</label><input name="time" type="time" value="${esc(e.time)}" required></div>
            <div class="field"><label>${t('Sağlayıcı')}</label>${sel('schProv', Object.entries(state.meta.providers), e.provider)}</div>
            <div class="field"><label>${t('Durum')}</label>${sel('schEn', [[1, t('Etkin')], [0, t('Duraklatıldı')]], e.enabled)}</div>
            <div class="field" style="grid-column:1/-1"><label>${t('Günler')}</label><div class="stg-chips">${DAYS.map(([v, l]) => `<label class="stg-chip"><input type="checkbox" name="d" value="${v}" ${e.days.split(',').includes(v) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
            <div class="field" style="grid-column:1/-1"><label>${t('İstem')}</label><textarea name="prompt" rows="4" required>${esc(e.prompt)}</textarea></div>
            <div style="grid-column:1/-1" class="row"><button class="btn">${e.id ? t('Güncelle') : t('Görev ekle')}</button>${e.id ? `<button type="button" class="btn sec" id="schCancel">${t('Vazgeç')}</button>` : ''}</div>
          </form></div>`, e.id ? t('Görevi düzenle · {name}', { name: esc(e.name) }) : t('Yeni görev'));
        $$('[data-tpl]', el).forEach((b) => b.onclick = () => draw({ ...templates[b.dataset.tpl], provider: s.provider || 'claude', enabled: 1 }));
        $$('[data-edit]', el).forEach((b) => b.onclick = () => draw(items.find((x) => String(x.id) === b.dataset.edit)));
        $$('[data-del]', el).forEach((b) => b.onclick = async () => { if (await confirmBox(t('Görev silinsin mi?'), { danger: true, ok: t('Sil') })) { await api(`/schedules/${b.dataset.del}`, { method: 'DELETE' }); draw(); } });
        $$('[data-run]', el).forEach((b) => b.onclick = async () => { try { const r = await api(`/schedules/${b.dataset.run}/run`, { method: 'POST', body: {} }); toast(t('Görev başlatıldı'), 'ok'); m.close(); emit('agent:open', r.sessionId); } catch (x) { toast(tx(x.message), 'err'); } });
        $$('[data-open]', el).forEach((b) => b.onclick = () => { m.close(); emit('agent:open', b.dataset.open); });
        $('#schCancel')?.addEventListener('click', () => draw());
        $('#schForm').onsubmit = async (ev) => {
          ev.preventDefault();
          const f = ev.target;
          const days = $$('input[name=d]:checked', f).map((x) => x.value).join(',');
          try {
            await api('/schedules', { method: 'POST', body: { id: e.id, name: f.name.value, time: f.time.value, prompt: f.prompt.value, days, provider: $('#schProv').value, enabled: Number($('#schEn').value) } });
            toast(t('Kaydedildi'), 'ok'); draw();
          } catch (x) { toast(tx(x.message), 'err'); }
        };
      };
      await draw();
    },
    async log(el, stale) {
      const draw = async () => {
        const r = await wsCall({ t: 'log.get' }).catch(() => ({ entries: [] }));
        if (stale()) return;
        el.innerHTML = card(`<div class="log">${r.entries.slice().reverse().map((e) => `<div><span class="dim">${new Date(e.at).toLocaleTimeString(locale)}</span> <span class="${e.dir === 'in' ? 'accent' : 'muted'}">${e.dir === 'in' ? '→' : '←'} ${esc(e.t)}</span> ${esc(e.summary)}</div>`).join('') || `<div class="dim">${t('Günlük boş')}</div>`}</div>`,
          `${t('Son 50 WebSocket mesajı')} <span class="stg-live">${t('Canlı')}</span><button class="ghost" id="lRef">${t('Yenile')}</button>`);
        $('#lRef').onclick = draw;
      };
      await draw();
    },
    async surum(el, stale) {
      const r = await api('/changelog').catch(() => ({ text: '' }));
      if (stale()) return;
      // CHANGELOG.md'nin H1'i panel başlığının ("Sürüm notları") kopyasıydı; ikinci başlık olarak atılır.
      const body = String(r.text || '').replace(/^#\s+.*(\r?\n)+/, '');
      el.innerHTML = card(`<div class="msg assistant stg-prose">${body ? md(`> ${t('Sürüm notları Türkçe yazıldı.')}\n\n${body}`) : md(t('Sürüm notu yok'))}</div>`);
    },
    async yardim(el) {
      const keys = (list) => list.map(([k, d]) => row(esc(d), '', k.map((x) => `<kbd>${esc(x)}</kbd>`).join(''), { sm: true })).join('');
      const cmds = (list) => `<div class="stg-cmds">${list.map(([c, d]) => `<code>${esc(c)}</code><span>${esc(d)}</span>`).join('')}</div>`;
      el.innerHTML = card(keys([
        [['⌘K', 'Ctrl+K'], t('Sembol ara')], [['⌘1–4'], t('Piyasa · Portföy · Terminal · Raporlar')], [['⌘,'], t('Ayarlar')],
        [['Enter'], t('Mesaj gönder')], [['Shift+Enter'], t('Yeni satır')], [['/'], t('Komut menüsü (sohbette)')], [['Esc'], t('Pencereyi kapat')],
        [[t('Sağ tık (izleme listesi)')], t('Grafik · asistan özeti · KAP · işlem ekle')],
      ]), t('Klavye kısayolları'))
        + card(cmds([
          [t('/analiz SEMBOL'), t('Kapsamlı analiz ve rapor')], [t('/teknik SEMBOL'), t('Teknik analiz')], ['/karsilastir A B', t('Karşılaştırma')], ['/piyasa', t('Günlük özet')],
          ['/portfoy', t('Portföy değerlendirmesi')], [t('/kap [SEMBOL]'), t('Son KAP sinyalleri (sembolle: asistan taraması)')], [t('/rapor KONU'), t('HTML rapor')], ['/temettu', t('Temettü analizi')],
          [t('/tarama KOŞUL'), t('Hisse tarayıcı')], ['/model · /think', t('Model ve düşünme düzeyi')],
          [t('/yeni [İSİM] · /durdur · /status · /doctor'), t('Oturum yönetimi ve durum')], ['/help', t('Tüm komutlar')],
        ]), t('Sohbet komutları'))
        + `<p class="stg-foot">${t('BIST fiyatları ~15 dk gecikmelidir; kaynak ve gecikme her fiyatın yanında gösterilir. Terminal ve asistan çıktıları yatırım tavsiyesi değildir.')}</p>`;
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
    body.innerHTML = blocks.map(([k, ttl]) => `<section class="stg-group" data-b="${k}">${multi ? `<h3 class="stg-gt">${esc(ttl)}</h3>` : ''}<div class="set-blk"><div class="stg-card"><div class="skeleton" style="height:${multi ? 70 : 140}px"></div></div></div></section>`).join('');
    await Promise.all(blocks.map(async ([k]) => {
      const el = $(`[data-b="${k}"] .set-blk`, body);
      try { await BLOCKS[k](el, stale, health); } catch (e) { if (!stale()) el.innerHTML = card(`<div class="empty">${esc(t('Yüklenemedi: {msg}', { msg: tx(e.message) }))}</div>`); }
    }));
    if (focusBlock && !stale() && multi) $(`[data-b="${focusBlock}"]`, body)?.scrollIntoView({ block: 'start' });
  }
  show(section, focus);
}

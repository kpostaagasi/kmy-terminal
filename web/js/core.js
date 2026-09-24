// Ortak çekirdek: durum, olay veriyolu, REST, WebSocket, biçimlendiriciler, arayüz yardımcıları
import { t, tx, lang, locale } from './i18n.js';
export { t, tx, lang, locale };

export const state = {
  settings: {},
  meta: null,
  quotes: {},
  watchlist: [],
  selected: localGet('selected', 'THYAO'),
  jobs: [],
  market: null,
};

// ── Olay veriyolu ─────────────────────────────────
const handlers = new Map();
export function on(evt, fn) { (handlers.get(evt) || handlers.set(evt, new Set()).get(evt)).add(fn); return () => handlers.get(evt).delete(fn); }
export function emit(evt, data) { for (const fn of handlers.get(evt) || []) { try { fn(data); } catch (e) { console.error(evt, e); } } }

// ── Yerel tercih (tarayıcı başına) ────────────────
export function localGet(k, d) { try { const v = localStorage.getItem('bt.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }
export function localSet(k, v) { try { localStorage.setItem('bt.' + k, JSON.stringify(v)); } catch { /* özel pencere */ } }

// ── REST ─────────────────────────────────────────
export async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (res.status === 401) gatewayReauth();
  if (!res.ok) throw new Error(tx(data?.error || data) || `HTTP ${res.status}`);
  return data;
}
// Gateway anahtarı değiştiyse (CLI ile yenilendi, sunucu güncellendi) sayfayı yeniden yükle: arayüz kabuğu yeni çerezi verir.
// Döngüye girmemek için 30 sn'de en fazla bir kez.
function gatewayReauth() {
  try {
    if (Date.now() - Number(sessionStorage.getItem('bt.reauth') || 0) < 30000) return;
    sessionStorage.setItem('bt.reauth', String(Date.now()));
  } catch { return; }
  location.reload();
}

// ── WebSocket ────────────────────────────────────
let ws = null; let rid = 0; const pending = new Map(); let retry = 0;
export function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { retry = 0; emit('conn', true); };
  ws.onclose = () => { emit('conn', false); setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000)); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.rid && pending.has(m.rid)) {
      const p = pending.get(m.rid); pending.delete(m.rid);
      if (m.t === 'error') p.reject(new Error(tx(m.message))); else p.resolve(m);
      return;
    }
    emit('ws:' + m.t, m);
  };
}
export function wsSend(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }
export function wsCall(msg, timeout = 30000) {
  return new Promise((resolve, reject) => {
    if (ws?.readyState !== 1) return reject(new Error(t('Sunucu bağlantısı yok')));
    const id = ++rid;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ lang, ...msg, rid: id }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(t('Zaman aşımı'))); } }, timeout);
  });
}

// ── Biçimlendirme ─────────────────────────────────
const nf = (d) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
const cache = {};
export function num(x, d = 2) { if (x == null || !Number.isFinite(+x)) return '—'; return (cache[d] ||= nf(d)).format(x); }
export function price(x) { if (x == null) return '—'; const a = Math.abs(x); return num(x, a >= 1000 ? 2 : a >= 10 ? 2 : a >= 1 ? 3 : 4); }
export function pct(x, d = 2, sign = true) { if (x == null || !Number.isFinite(+x)) return '—'; return `${sign && x > 0 ? '+' : ''}${num(x, d)}%`; }
export function money(x, cur = 'TRY', d = 0) { if (x == null || !Number.isFinite(+x)) return '—'; const s = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' }[cur] || ''; return `${x < 0 ? '−' : ''}${s}${num(Math.abs(x), d)}${s ? '' : ' ' + cur}`; }
export function compact(x) { if (x == null) return '—'; const a = Math.abs(x); const [bn, mn, k] = lang === 'tr' ? [' mr', ' mn', ' b'] : ['B', 'M', 'K']; if (a >= 1e9) return num(x / 1e9, 2) + bn; if (a >= 1e6) return num(x / 1e6, 2) + mn; if (a >= 1e3) return num(x / 1e3, 1) + k; return num(x, 0); }
export function cls(x) { return x > 0 ? 'up' : x < 0 ? 'down' : ''; }
export function dateTR(d, withTime = false) { if (!d) return '—'; const dt = new Date(d); return withTime ? dt.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : dt.toLocaleDateString(locale); }
export function ago(ms) { const s = Math.round((Date.now() - ms) / 1000); if (s < 60) return t('{s} sn', { s }); if (s < 3600) return t('{m} dk {s} sn', { m: Math.floor(s / 60), s: s % 60 }); return t('{h} sa {m} dk', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) }); }
// SQLite datetime('now') UTC döner ("2026-09-23 08:54:48"); her tarayıcıda güvenli ayrıştır
export function sqlDate(s) { if (!s) return null; const d = new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')); return Number.isNaN(d.getTime()) ? null : d; }
export function timeTR(ms) { return ms ? new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) : '—'; }
export function relTime(ms) {
  if (!ms) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return t('az önce'); if (s < 3600) return t('{n} dk önce', { n: Math.floor(s / 60) }); if (s < 86400) return t('{n} sa önce', { n: Math.floor(s / 3600) });
  return t('{n} gün önce', { n: Math.floor(s / 86400) });
}
// Fiyat kaynağı rozeti
export function srcTag(q) {
  if (!q) return '';
  return q.delayed ? `<span class="delay-tag" title="${esc(t('{src} · yaklaşık 15 dk gecikmeli · {time}', { src: q.source || '', time: timeTR(q.time) }))}">${t('15 dk')}</span>` : '';
}

// Basit sağ tık menüsü
export function contextMenu(x, y, items) {
  document.querySelector('.ctx-menu')?.remove();
  const m = h(`<div class="ctx-menu" role="menu"></div>`);
  for (const it of items) {
    if (it === '-') { m.append(h('<hr>')); continue; }
    const b = h(`<button role="menuitem"></button>`);
    b.textContent = it.label;
    b.onclick = () => { m.remove(); it.run(); };
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  const close = (e) => { if (!m.contains(e.target)) { m.remove(); removeEventListener('mousedown', close, true); } };
  setTimeout(() => addEventListener('mousedown', close, true));
  addEventListener('keydown', function k(e) { if (e.key === 'Escape') { m.remove(); removeEventListener('keydown', k); } });
}

export function today() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); }
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ── DOM ──────────────────────────────────────────
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function toast(text, kind = '', ms = 4500) {
  const el = h(`<div class="toast ${kind}" role="status"></div>`);
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
  el.onclick = () => el.remove();
}

export function modal({ title, body, footer = '', wide = false, onClose }) {
  const back = h(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><span>${esc(title)}</span><button class="icon-btn" data-close aria-label="${esc(t('Kapat'))}">✕</button></header>
    <div class="body"></div>${footer ? `<footer>${footer}</footer>` : ''}</div></div>`);
  const bodyEl = $('.body', back);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  const close = (silent = false) => { if (!back.isConnected) return; back.remove(); document.removeEventListener('keydown', onKey); if (!silent) onClose?.(); };
  // Yalnızca en üstteki pencere Esc ile kapanır
  const onKey = (e) => { if (e.key === 'Escape' && $('#modalRoot').lastElementChild === back) { e.stopPropagation(); close(); } };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $$('[data-close]', back).forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  $('#modalRoot').append(back);
  return { el: back, body: bodyEl, close };
}

// Uygulama içi PDF / belge görüntüleyici: src aynı kökenden sunulur (KAP eki veya arşiv belgesi)
export function openPdfViewer({ src, title = t('Belge'), name = '', actions = [] }) {
  const m = modal({
    title, wide: true,
    body: `<iframe src="${esc(src)}" title="${esc(title)}" style="width:100%;height:72vh;border:0;background:#fff;border-radius:6px"></iframe>`,
    footer: `${actions.map((a, i) => `<button class="btn sec" data-act="${i}">${esc(a.label)}</button>`).join('')}<a class="btn sec" href="${esc(src)}" download="${esc(name || title)}">${t('İndir')}</a><a class="btn sec" href="${esc(src)}" target="_blank" rel="noopener">${t('Yeni sekmede aç')}</a><button class="btn" data-close>${t('Kapat')}</button>`,
  });
  $$('[data-act]', m.el).forEach((b) => b.onclick = () => actions[Number(b.dataset.act)].run(m));
  return m;
}

export function confirmBox(text, { ok = t('Onayla'), danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({ title: t('Emin misiniz?'), body: `<p>${esc(text)}</p>`, footer: `<button class="btn sec" data-no>${t('Vazgeç')}</button><button class="btn ${danger ? 'danger' : ''}" data-yes>${esc(ok)}</button>`, onClose: () => resolve(false) });
    $('[data-no]', m.el).onclick = () => m.close();
    $('[data-yes]', m.el).onclick = () => { resolve(true); m.close(true); };
  });
}

// Küçük satır içi SVG çizgi grafik
export function sparkSvg(values, { w = 60, h = 22, color, area = false } = {}) {
  const v = (values || []).filter((x) => x != null);
  if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;
  const min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - min) / rng) * (h - 4)).toFixed(1)}`).join(' ');
  const c = color || (v.at(-1) >= v[0] ? 'var(--up)' : 'var(--down)');
  const fill = area ? `<polygon points="0,${h} ${pts} ${w},${h}" fill="${c}" fill-opacity=".12" stroke="none"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${fill}<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

export function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// Markdown → güvenli HTML
export function md(text) {
  const html = window.marked ? window.marked.parse(text || '', { breaks: true, gfm: true }) : esc(text);
  return window.DOMPurify ? window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }) : html;
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Seçili sembolü değiştir (tüm görünümler dinler)
export function selectSymbol(sym, { show = true } = {}) {
  state.selected = sym;
  localSet('selected', sym);
  emit('symbol', sym);
  if (show) emit('view', 'market');
}

// Sohbete istem gönder (başka modüllerden)
export function askAgent(text, { context = null, newSession = false } = {}) {
  emit('agent:ask', { text, context, newSession });
}

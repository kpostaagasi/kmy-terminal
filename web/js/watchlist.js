// Sol panel: izleme listesi (canlı fiyat, mini grafik, sürükle-bırak sıralama, sembol ekleme)
import { state, on, emit, api, $, $$, esc, price, pct, cls, selectSymbol, debounce, toast, confirmBox, askAgent, contextMenu, srcTag, sparkSvg } from './core.js';
import { openTxModal } from './portfolio-view.js';
import { t, tx } from './i18n.js';

// Evren yaşam döngüsü: listedeki kodun BIST listesinde olup olmadığı ve kaldırıldıysa neden.
// Sunucu `universe.status()` döndürür; evren henüz yüklenmediyse tekrar denenir.
// BIST kodu biçimi 4-6 karakter; fon (3 harf), döviz, kripto ve yurt dışı bu denetimin dışındadır.
const BIST_CODE = /^[A-Z0-9]{4,6}$/;
let uni = { codes: null, delisted: {} };

async function loadUniverse() {
  const s = await api('/universe/status').catch(() => null);
  if (!s) return;
  uni = { codes: new Set(s.codes || []), delisted: Object.fromEntries((s.delistedList || []).map((d) => [d.code, d])) };
  if (!s.stocks && !(s.delistedList || []).length) { setTimeout(loadUniverse, 30_000); return; } // evren henüz çekilmemiş
  render();
}
const list = $('#watchlist');
let sortMode = 'manual'; // manual | change | symbol

async function load() {
  state.watchlist = await api('/watchlist');
  await refreshQuotes();
  loadUniverse();
}

async function refreshQuotes() {
  emit('watchlist:loaded', state.watchlist);
  if (!state.watchlist.length) return render();
  const q = await api(`/quotes?symbols=${state.watchlist.join(',')}`).catch(() => ({}));
  Object.assign(state.quotes, q);
  render();
}

function ordered() {
  const s = [...state.watchlist];
  if (sortMode === 'change') s.sort((a, b) => (state.quotes[b]?.changePct ?? -1e9) - (state.quotes[a]?.changePct ?? -1e9));
  if (sortMode === 'symbol') s.sort();
  return s;
}

// Satır: sembol · günlük mini grafik · fiyat (para birimi simgesiyle) · günlük değişim · çıkar
const CUR = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' };
function rowHtml(sym) {
  const q = state.quotes[sym];
  // Kaldırılmış kod: satır açılır (geçmiş fiyat var) ama neden kaldırıldığı satırın ipucunda yazar.
  const d = uni.delisted[sym];
  const why = d ? `${t('BIST listesinden kaldırıldı')} (${d.removedAt}) — ${t('son adı')}: ${d.name || '—'}${d.candidates?.length ? ` · ${t('muhtemel yeni kod')}: ${d.candidates.map((c) => c.symbol).join(', ')} (${t('doğrulatın')})` : ''}` : '';
  const tip = `${tx(q?.longName || q?.name || sym)}${q ? ` · ${q.source || ''}${q.delayed ? ` · ${t('~15 dk gecikmeli')}` : ''}` : ''}${why ? ` — ${why}` : ''}`;
  const c = q?.changePct;
  // Sunucu her quote'a 1 günlük 5 dakikalık kapanış dizisi koyar (spark); veri yoksa hücre boş kalır, kutu çizilmez.
  const sp = q?.spark;
  return `<div class="wl-row ${sym === state.selected ? 'sel' : ''}" role="listitem" data-s="${esc(sym)}" draggable="${sortMode === 'manual'}" tabindex="0" title="${esc(tip)}">
    <span class="sym"${d ? ' style="opacity:.65"' : ''}>${esc(sym)}${d ? ` <span class="pill" style="color:var(--warn,#f5a524)" aria-label="${esc(why)}">${esc(t('⚠ kaldırıldı'))}</span>` : ''}</span>
    <span class="wl-spark">${sp?.length > 1 ? sparkSvg(sp, { w: 40, h: 16 }) : ''}</span>
    <span class="px">${q ? `${CUR[q.currency] || ''}${price(q.price)}` : '…'}</span>
    <span class="pc ${cls(c)}">${q ? pct(c, 1) : ''}</span>
    <button class="rm" data-rm="${esc(sym)}" title="${t('Listeden çıkar')}" aria-label="${esc(t('{s} sembolünü listeden çıkar', { s: sym }))}">×</button>
  </div>`;
}

function render() {
  list.innerHTML = state.watchlist.length ? ordered().map(rowHtml).join('') : `<div class="empty">${t('Liste boş. Aşağıdan sembol ekleyin.')}</div>`;
}

// Yalnızca değişen satırları güncelle (yanıp sönme efekti)
on('quotes', (qs) => {
  for (const [sym, q] of Object.entries(qs)) {
    const row = list.querySelector(`[data-s="${CSS.escape(sym)}"]`);
    if (!row) continue;
    const old = Number(row.dataset.p || 0);
    const fresh = document.createElement('div');
    fresh.innerHTML = rowHtml(sym);
    const nr = fresh.firstElementChild;
    // Satır öğesi yerinde kalır (fiyat güncellemesi tıklamayı yutmasın); yalnız içerik ve sınıflar yenilenir
    row.innerHTML = nr.innerHTML;
    row.title = nr.title;
    row.className = nr.className;
    row.dataset.p = q.price;
    if (old && q.price !== old) { void row.offsetWidth; row.classList.add(q.price > old ? 'flash-up' : 'flash-down'); }
  }
});

// Kaldırılmış kod engellenmez: geçmiş veri var, sayfa açılır; yalnız uyarılır.
function openRow(sym) {
  const d = uni.delisted[sym];
  if (d) toast(t('{s} BIST listesinden kaldırıldı ({d}) — geçmiş veriler korunuyor, güncel fiyat yok.', { s, d: d.removedAt }), 'err', 7000);
  selectSymbol(sym);
}

list.addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    e.stopPropagation();
    state.watchlist = await api(`/watchlist/${encodeURIComponent(rm.dataset.rm)}`, { method: 'DELETE' });
    render();
    return;
  }
  const row = e.target.closest('.wl-row');
  if (row) openRow(row.dataset.s);
});
list.addEventListener('keydown', (e) => {
  const row = e.target.closest('.wl-row');
  if (!row) return;
  if (e.key === 'Enter') openRow(row.dataset.s);
  if (e.key === 'ArrowDown') row.nextElementSibling?.focus();
  if (e.key === 'ArrowUp') row.previousElementSibling?.focus();
  if (e.key === 'Delete' || e.key === 'Backspace') row.querySelector('[data-rm]').click();
});
list.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.wl-row');
  if (!row) return;
  e.preventDefault();
  const s = row.dataset.s;
  contextMenu(e.clientX, e.clientY, [
    { label: t('{s} grafiğini aç', { s }), run: () => selectSymbol(s) },
    { label: t('Asistanla kısa özet'), run: () => askAgent(t('{s} için kısa bir teknik ve temel görünüm özeti çıkar.', { s })) },
    { label: t('KAP bildirimleri'), run: () => { emit('kap:filter', { scope: 'symbol', symbol: s }); emit('rtab', 'kap'); } },
    { label: t('Portföye işlem ekle…'), run: () => openTxModal({ symbol: s, price: state.quotes[s]?.price }) },
    '-',
    { label: t('Listeden çıkar'), run: async () => { state.watchlist = await api(`/watchlist/${encodeURIComponent(s)}`, { method: 'DELETE' }); render(); } },
  ]);
});

// Sürükle-bırak sıralama
let dragSym = null;
list.addEventListener('dragstart', (e) => { const r = e.target.closest('.wl-row'); if (!r) return; dragSym = r.dataset.s; r.classList.add('dragging'); });
list.addEventListener('dragend', (e) => e.target.closest('.wl-row')?.classList.remove('dragging'));
list.addEventListener('dragover', (e) => {
  if (!dragSym) return;
  e.preventDefault();
  const over = e.target.closest('.wl-row');
  const dragging = list.querySelector('.dragging');
  if (!over || over === dragging) return;
  const rect = over.getBoundingClientRect();
  over.parentNode.insertBefore(dragging, e.clientY < rect.top + rect.height / 2 ? over : over.nextSibling);
});
list.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragSym = null;
  const order = $$('.wl-row', list).map((r) => r.dataset.s);
  state.watchlist = await api('/watchlist', { method: 'PUT', body: { symbols: order } });
});

$('#wlSort').onclick = () => {
  sortMode = { manual: 'change', change: 'symbol', symbol: 'manual' }[sortMode];
  toast({ manual: t('Sıralama: elle'), change: t('Sıralama: günlük değişim'), symbol: t('Sıralama: alfabetik') }[sortMode]);
  render();
};

// Ekleme kutusu + öneri listesi
const input = $('#wlAddInput'), sug = $('#wlSuggest');
let items = [], sel = -1;
const drawSug = () => {
  sug.hidden = !items.length;
  sug.innerHTML = items.map((r, i) => `<button type="button" class="${i === sel ? 'sel' : ''}" data-i="${i}"><span class="s">${esc(r.symbol)}</span><span>${esc(tx(r.name || ''))}</span><span class="x">${esc(tx(r.exchange || ''))}</span></button>`).join('');
};
const search = debounce(async () => {
  const q = input.value.trim();
  items = q ? await api(`/search?q=${encodeURIComponent(q)}`).catch(() => []) : [];
  sel = -1; drawSug();
}, 200);
input.addEventListener('input', search);
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); drawSug(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, -1); drawSug(); e.preventDefault(); }
  if (e.key === 'Escape') { items = []; drawSug(); }
});
sug.addEventListener('mousedown', (e) => { const b = e.target.closest('button'); if (b) { e.preventDefault(); add(items[b.dataset.i].symbol); } });
input.addEventListener('blur', () => setTimeout(() => { items = []; drawSug(); }, 150));
$('#wlAddForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = sel >= 0 ? items[sel]?.symbol : input.value.trim();
  if (s) add(s);
});

async function add(sym) {
  const s = sym.toUpperCase().replace(/\.IS$/, '');
  // Evrende olmayan kod eklenirse onay istenir; engelleme yok, kullanıcı geçmiş veriyi istiyor olabilir.
  if (uni.codes?.size && BIST_CODE.test(s) && !uni.codes.has(s)) {
    const d = uni.delisted[s];
    const msg = d
      ? t('{s} sembolü {d} tarihinde BIST listesinden kaldırırdı ({n}). Yine de listeye eklensin mi?', { s, d: d.removedAt, n: d.name || '—' })
      : t('{s} sembolü BIST listesinde bulunamadı — kod yanlış yazılmış olabilir. Yine de listeye eklensin mi?', { s });
    if (!await confirmBox(msg, { ok: t('Yine de ekle') })) return;
  }
  try {
    state.watchlist = await api('/watchlist', { method: 'POST', body: { symbol: sym } });
    input.value = ''; items = []; drawSug();
    await refreshQuotes();
    selectSymbol(s, { show: false });
  } catch (e) { toast(tx(e.message), 'err'); }
}

on('ws:watchlist', (m) => { state.watchlist = m.symbols; refreshQuotes(); });
on('symbol', () => $$('.wl-row', list).forEach((r) => r.classList.toggle('sel', r.dataset.s === state.selected)));
on('ready', load);
on('app:refresh', load);

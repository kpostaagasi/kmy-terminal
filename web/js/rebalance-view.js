// Portföy › Dengeleme sekmesi: hedef ağırlık girişi, sapma tablosu ve al/sat önerisi. Hesap sunucudadır (/api/rebalance).
import { on, api, $, $$, esc, num, money, cls, toast, localGet, localSet } from './core.js';
import { t, tx } from './i18n.js';
import { parseTr } from './trnum.js';

let active = () => false;
let res = null, extra = localGet('rbExtra', ''), draft = null, err = '', busy = false, host = null;
const ACT = { al: [t('AL'), 'up'], sat: [t('SAT'), 'down'], yok: ['—', ''], atlandi: [t('ATLANDI'), ''] };
const p1 = (x) => (x == null ? '—' : `${num(x, 1)}%`);
const sgn = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${num(x, 1)}`);
const pctVal = parseTr;

function fresh() { // sunucudaki hedeflerden düzenlenebilir kopya (değerler metin)
  draft = {
    cls: Object.fromEntries(Object.entries(res.targets.classTargets).map(([k, v]) => [k, String(v)])),
    sym: Object.entries(res.targets.symbolTargets).map(([s, e]) => ({ s, cls: e.cls, pct: String(e.pct) })),
  };
}
const classList = () => Object.keys(res.classLabels).concat(res.cashTracking ? ['cash'] : []);
const label = (k) => (k === 'cash' ? t('Nakit') : tx(res.classLabels[k] || k));

async function load() {
  try {
    const q = parseTr(extra);
    if (Number.isNaN(q) || q < 0) { err = t('Geçersiz sayı: {k}', { k: t('Ek nakit (TL)') }); paint(); return; } // sessizce 0'a düşmesin
    res = await api(`/rebalance${q > 0 ? `?extra=${q}` : ''}`);
    err = '';
    if (!draft) fresh();
  } catch (e) { err = tx(e.message); }
  paint();
}

function editor() {
  // Satırlar: portföydeki semboller + hedefi olup portföyde olmayanlar (kullanıcının eklediği)
  const heldClass = Object.fromEntries(res.holdings.map((h) => [h.symbol, h.asset_type]));
  const syms = [...new Map([...res.holdings.map((h) => [h.symbol, { s: h.symbol, cls: h.asset_type, pct: '' }]), ...draft.sym.map((x) => [x.s, x])]).values()];
  const classRows = classList().map((k) => `<tr><td>${esc(label(k))}</td><td class="r"><input class="rb-in" data-k="${k}" inputmode="decimal" value="${esc(draft.cls[k] ?? '')}" placeholder="—"> %</td></tr>`).join('');
  const symRows = syms.map((x) => `<tr><td class="mono"><b>${esc(x.s)}</b></td><td class="dim">${esc(label(x.cls))}${heldClass[x.s] ? '' : ` · ${esc(t('portföyde yok'))}`}</td><td class="r"><input class="rb-in" data-s="${esc(x.s)}" data-c="${esc(x.cls)}" inputmode="decimal" value="${esc(x.pct)}" placeholder="—"> %</td></tr>`).join('');
  const sum = Object.values(draft.cls).reduce((a, v) => a + (pctVal(v) || 0), 0);
  return `<div class="card"><h3>${t('Hedefler')}</h3>
    <div class="rb-grid"><div><div class="dim" style="margin-bottom:4px">${t('Sınıf hedefi (portföyün %)')}</div><table class="t"><tbody>${classRows}</tbody></table>
      <div class="kt-note ${sum > 100 ? 'down' : ''}">${t('Toplam')}: ${num(sum, 1)}% · ${t('hedefsiz')}: ${num(Math.max(0, 100 - sum), 1)}%</div></div>
    <div><div class="dim" style="margin-bottom:4px">${t('Sınıf içi pay (%) — boş bırakılırsa kalanı mevcut değerle paylaşır')}</div><table class="t"><tbody>${symRows}</tbody></table>
      <div class="row" style="margin-top:6px"><input id="rbNewS" class="rb-in" style="width:90px;text-align:left" placeholder="${esc(t('SEMBOL'))}">
      <select id="rbNewC" class="rb-in" style="width:130px;text-align:left">${Object.keys(res.classLabels).map((k) => `<option value="${k}">${esc(label(k))}</option>`).join('')}</select>
      <button class="btn sec" id="rbAdd">${t('＋ Sembol ekle')}</button></div></div></div>
    <div class="row" style="margin-top:8px"><button class="btn" id="rbSave" ${busy ? 'disabled' : ''}>${t('Hedefleri kaydet')}</button><button class="btn sec" id="rbReset">${t('Geri al')}</button></div></div>`;
}

function resultCard() {
  if (!res.rows.length && !res.warnings.length) return `<div class="card dim">${t('Henüz hedef yok. Yukarıdan sınıf hedefi girip kaydedin; öneri burada görünür.')}</div>`;
  const s = res.summary;
  const rows = res.rows.map((r) => {
    const [a, c] = ACT[r.action] || ['—', ''];
    return `<tr><td class="mono"><b>${esc(r.key === 'cash' ? t('Nakit') : r.kind === 'class' ? label(r.key) : r.key)}</b> <span class="dim">${esc(r.kind === 'class' ? '' : label(r.class))}</span></td>
      <td class="r num">${p1(r.currentPct)}</td><td class="r num">${p1(r.targetPct)}</td><td class="r num ${cls(-r.deviation)}">${sgn(r.deviation)}</td>
      <td class="${c}"><b>${esc(a)}</b></td><td class="r num">${r.qty != null ? num(r.qty, r.qty % 1 ? 4 : 0) : '—'}</td><td class="r num">${r.tl ? money(r.tl) : '—'}</td>
      <td class="r num dim">${r.taxEst ? money(r.taxEst) : '—'}</td><td class="dim">${r.reason ? esc(tx(r.reason)) : ''}</td></tr>`;
  }).join('');
  const sumLine = `${t('Net nakit değişimi')}: <b class="${cls(s.netCash)}">${s.netCash > 0 ? '+' : ''}${money(s.netCash)}</b> · ${t('Yuvarlama artığı')}: ${money(s.rounding)} · ${t('Mod')}: ${s.mode === 'ekNakit' ? t('yalnız alım (ek nakit)') : t('al/sat (değer sabit)')}`;
  return `<div class="card"><h3>${t('Öneri')} <span class="dim" style="font-weight:400">${esc(sumLine.replace(/<[^>]+>/g, ''))}</span></h3>
    ${res.warnings.map((w) => `<div class="kt-note down">${esc(tx(w))}</div>`).join('')}
    <div class="table-wrap"><table class="t"><thead><tr><th>${t('Varlık')}</th><th class="r">${t('Gerçek')}</th><th class="r">${t('Hedef')}</th><th class="r">${t('Sapma (puan)')}</th><th>${t('İşlem')}</th><th class="r">${t('Adet')}</th><th class="r">${t('Tutar')}</th><th class="r">${t('Tahmini vergi')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="kt-note">${t('Bu bir hesaptır, yatırım tavsiyesi değildir; emir gönderilmez. Fiyatlar BIST için ~15 dk gecikmeli olabilir. Vergi tahmini kısmi satışta oransaldır; komisyon hesaba katılmaz.')}</p></div>`;
}

function paint() {
  if (!active()) return;
  if (!res) { host.innerHTML = err ? `<div class="card"><div class="kt-note down">${esc(err)}</div></div>` : '<div class="skeleton" style="height:200px"></div>'; return; }
  host.innerHTML = `${err ? `<div class="kt-note down">${esc(err)}</div>` : ''}
    <div class="card"><div class="row"><label class="dim" for="rbExtra">${t('Ek nakit (TL)')}</label><input id="rbExtra" class="rb-in" style="width:130px" inputmode="decimal" value="${esc(extra)}" placeholder="0">
      <span class="dim">${t('Boş: portföy değeri sabit, al/sat. Girilirse yalnız alım önerilir.')}</span></div></div>
    ${editor()}${resultCard()}`;
  bind();
}

function readDraft() {
  draft.cls = {};
  for (const i of $$('input[data-k]', host)) if (i.value.trim() !== '') draft.cls[i.dataset.k] = i.value;
  const prev = new Map(draft.sym.map((x) => [x.s, x]));
  draft.sym = [];
  for (const i of $$('input[data-s]', host)) if (i.value.trim() !== '' || prev.has(i.dataset.s)) draft.sym.push({ s: i.dataset.s, cls: i.dataset.c, pct: i.value });
  draft.sym = draft.sym.filter((x) => x.pct.trim() !== '');
}

async function save() {
  readDraft();
  const classTargets = {}, symbolTargets = {};
  for (const [k, v] of Object.entries(draft.cls)) { const n = pctVal(v); if (!Number.isFinite(n)) { err = t('Geçersiz sayı: {k}', { k: label(k) }); return paint(); } classTargets[k] = n; }
  for (const x of draft.sym) { const n = pctVal(x.pct); if (!Number.isFinite(n)) { err = t('Geçersiz sayı: {k}', { k: x.s }); return paint(); } symbolTargets[x.s.toUpperCase()] = { cls: x.cls, pct: n }; }
  busy = true; paint();
  try { await api('/rebalance/targets', { method: 'PUT', body: { classTargets, symbolTargets } }); err = ''; draft = null; toast(t('Hedefler kaydedildi')); }
  catch (e) { err = tx(e.message); busy = false; paint(); return; } // reddedildi: taslak ve hata notu kalır (load() notu silerdi)
  busy = false;
  await load();
}

function bind() {
  const ex = $('#rbExtra', host);
  ex.onchange = () => { extra = ex.value.trim(); localSet('rbExtra', extra); readDraft(); load(); };
  $('#rbSave', host).onclick = save;
  $('#rbReset', host).onclick = () => { draft = null; fresh(); err = ''; paint(); };
  $('#rbAdd', host).onclick = () => {
    const s = $('#rbNewS', host).value.trim().toUpperCase(), c = $('#rbNewC', host).value;
    if (!s) return;
    if (res.holdings.some((h) => h.symbol === s)) { toast(t('Portföyde zaten var: payı yukarıdaki listeden girin'), 'err'); return; }
    readDraft();
    if (!draft.sym.some((x) => x.s === s)) draft.sym.push({ s, cls: c, pct: '0' });
    paint();
  };
}

/** Sekme gövdesini çizer (portfolio-view.js çağırır). */
export async function renderRebalance(body, isActive) {
  host = body; active = isActive;
  host.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  draft = null;
  await load();
}
on('ws:rebalance.updated', () => { draft = null; if (active()) load(); });
on('ws:portfolio.changed', () => { if (active()) load(); });

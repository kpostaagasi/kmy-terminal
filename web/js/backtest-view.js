// Sinyal geçmiş performansı paneli (tarayıcı sayfası). Veri: /api/backtest; hesap elle başlatılır.
import { on, api, $, esc, num, cls, dateTR, timeTR, toast } from './core.js';
import { t, tx } from './i18n.js';

const H = [5, 20, 60];
let data = null, running = false, lastError = '', timer = 0;
const busy = () => running || !!data?.running;
const p1 = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${num(x * 100, 1)}%`);
const hit = (x) => (x == null ? '—' : `${num(x * 100, 0)}%`);

function table(r) {
  const base = r.baseline;
  const baseRow = `<tr class="dim"><td>${t('Taban (her gün)')}</td>${H.map((h) => `<td class="r num">${base[h].n}</td><td class="r num">${p1(base[h].mean)}</td><td class="r num">${hit(base[h].hitUp)}</td><td class="r num">${p1(base[h].excess)}</td><td class="r num">—</td>`).join('')}</tr>`;
  const rows = Object.entries(r.signals).map(([k, s]) => `<tr><td><span class="pill ${s.dir === 'up' ? 'up' : s.dir === 'down' ? 'down' : ''}">${esc(tx(s.label))}</span></td>${H.map((h) => {
    const c = s[h];
    const low = c.low ? ` title="${t('az örnek')}"` : '';
    return `<td class="r num${c.low ? ' dim' : ''}"${low}>${c.n}${c.low && c.n ? ' ⚠' : ''}</td><td class="r num ${cls(c.mean)}">${p1(c.mean)}</td><td class="r num">${hit(c.hit)}</td><td class="r num ${cls(c.excess)}">${p1(c.excess)}</td><td class="r num ${cls(c.delta)}">${p1(c.delta)}</td>`;
  }).join('')}</tr>`).join('');
  const head1 = `<tr><th rowspan="2">${t('Sinyal')}</th>${H.map((h) => `<th colspan="5" class="r">${t('{n} gün', { n: h })}</th>`).join('')}</tr>`;
  const head2 = `<tr>${H.map(() => `<th class="r">n</th><th class="r">${t('Ort.')}</th><th class="r">${t('İsabet')}</th><th class="r">${t('XU100 farkı')}</th><th class="r">${t('Taban farkı')}</th>`).join('')}</tr>`;
  return `<div class="table-wrap kt-tall"><table class="t">${head1}${head2}${baseRow}${rows}</table></div>`;
}

function html() {
  const r = data?.result;
  const top = `<div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
    <span class="dim">${r ? `${t('{n} hisse', { n: r.params.symbols })} · ${esc(r.params.from)} → ${esc(r.params.to)} · ${t('hesaplandı {t}', { t: `${dateTR(data.at)} ${timeTR(data.at)}` })}` : ''}</span>
    <button class="ghost" id="btRun" ${busy() ? 'disabled' : ''}>${busy() ? `<span class="spinner"></span> ${t('hesaplanıyor… (birkaç dk)')}` : r ? t('Yeniden hesapla') : t('Hesapla')}</button></div>`;
  const err = lastError ? `<div class="kt-note down">${esc(lastError)}</div>` : '';
  const body = r ? table(r) : `<div class="dim">${t('Henüz hesaplanmadı. “Hesapla”ya basın: BIST 100 için 10 yıllık günlük veriyle her sinyalin sonraki 5/20/60 işlem gününde ne yaptığı ölçülür (birkaç dakika sürer).')}</div>`;
  const note = r ? `<p class="kt-note">${t('Geçmiş gelecekteki getiriyi garanti etmez. Yalnızca bugün BIST 100’de olan hisseler hesaba girer (hayatta kalma yanlılığı); getiriler nominal TL’dir (enflasyon dikkate alınmaz); örtüşen ve birbirine bağlı olaylar sonucu olduğundan güvenilir gösterir; işlem maliyeti yoktur; %25’ten küçük bölünmeler düzeltilemez. “Taban farkı”, sinyalin her günün ortalamasından ne kadar iyi olduğunu gösterir. ⚠ = 30’dan az örnek.')} ${t('Bölünme düzeltmesi: {n} kırılma.', { n: r.params.splitBreaks })}</p>` : '';
  return top + err + body + note;
}

export function initBacktest(box) {
  const paint = () => { box.innerHTML = html(); const b = $('#btRun', box); if (b) b.onclick = runNow; };
  async function load() {
    try { data = await api('/backtest'); } catch { /* önceki durum korunur */ }
    paint();
    clearTimeout(timer);
    if (data?.running) timer = setTimeout(load, 5000); // başka pencerede koşu sürerken: olay kaçarsa "hesaplanıyor"da takılı kalmaz
  }
  async function runNow() {
    if (busy()) return;
    running = true; lastError = ''; paint();
    try { data = await api('/backtest/run', { method: 'POST' }); }
    catch (e) { lastError = tx(e.message); toast(lastError, 'err'); }
    finally { running = false; }
    paint();
  }
  on('ws:backtest.updated', load);
  load();
}

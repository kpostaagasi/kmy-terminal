// Chart.js tema yardımcıları
import { css, num } from './core.js';

// Zaman ekseni ve ipucu başlıkları Türkçe (tarih adaptörü İngilizce ay adları üretir)
const INTRADAY = ['millisecond', 'second', 'minute', 'hour'];
function trTick(v) {
  const d = new Date(v), u = this._unit;
  if (INTRADAY.includes(u)) return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (u === 'day' || u === 'week') return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  if (u === 'month' || u === 'quarter') return d.toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' });
  return String(d.getFullYear());
}
function trTitle(items) {
  const it = items[0];
  if (it?.parsed?.x == null) return '';
  const d = new Date(it.parsed.x);
  return INTRADAY.includes(it.chart.scales.x?._unit)
    ? d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function baseOptions({ time = true, legend = false, yRight = true } = {}) {
  const grid = css('--line'), tick = css('--text-3');
  return {
    responsive: true, maintainAspectRatio: false, animation: false, normalized: true,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: legend, labels: { color: css('--text-2'), boxWidth: 10, font: { size: 11 } } },
      tooltip: {
        backgroundColor: css('--panel-2'), borderColor: css('--line-2'), borderWidth: 1, titleColor: css('--text'), bodyColor: css('--text-2'),
        callbacks: { ...(time ? { title: trTitle } : {}), label: (c) => `${c.dataset.label}: ${c.parsed.y == null ? '—' : num(c.parsed.y, Math.abs(c.parsed.y) < 10 ? 3 : 2)}` },
      },
    },
    scales: {
      x: time ? { type: 'time', grid: { color: grid, drawTicks: false }, ticks: { color: tick, maxRotation: 0, autoSkipPadding: 18, font: { size: 10 }, callback: trTick }, border: { display: false } }
        : { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } }, border: { display: false } },
      y: { position: yRight ? 'right' : 'left', grid: { color: grid, drawTicks: false }, ticks: { color: tick, font: { size: 10 } }, border: { display: false } },
    },
  };
}

export function palette() {
  return [css('--accent'), css('--info'), css('--violet'), css('--up'), css('--down'), '#f472b6', '#2dd4bf', '#facc15', '#fb923c', '#94a3b8', '#818cf8', '#4ade80'];
}

export function makeChart(canvas, config) {
  const prev = Chart.getChart(canvas);
  if (prev) prev.destroy();
  return new Chart(canvas, config);
}

export function doughnut(canvas, items) {
  const colors = palette();
  return makeChart(canvas, {
    type: 'doughnut',
    data: { labels: items.map((x) => x.key), datasets: [{ data: items.map((x) => x.value), backgroundColor: items.map((_, i) => colors[i % colors.length]), borderColor: css('--panel'), borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%', animation: false,
      plugins: {
        legend: { position: 'right', labels: { color: css('--text-2'), boxWidth: 10, font: { size: 11 }, generateLabels: (ch) => ch.data.labels.map((l, i) => ({ text: `${l}  ${num(items[i].pct, 1)}%`, fillStyle: colors[i % colors.length], strokeStyle: colors[i % colors.length], index: i, fontColor: css('--text-2') })) } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${num(c.parsed, 0)} (${num(items[c.dataIndex].pct, 1)}%)` } },
      },
    },
  });
}

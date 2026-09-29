// Chart.js tema yardımcıları
import { css, num } from './core.js';
import { locale } from './i18n.js';

// Zaman ekseni ve ipucu başlıkları Türkçe (tarih adaptörü İngilizce ay adları üretir)
const INTRADAY = ['millisecond', 'second', 'minute', 'hour'];
function trTick(v) {
  const d = new Date(v), u = this._unit;
  if (INTRADAY.includes(u)) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (u === 'day' || u === 'week') return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  if (u === 'month' || u === 'quarter') return d.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
  return String(d.getFullYear());
}
function trTitle(items) {
  const it = items[0];
  if (it?.parsed?.x == null) return '';
  const d = new Date(it.parsed.x);
  return INTRADAY.includes(it.chart.scales.x?._unit)
    ? d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function baseOptions({ time = true, legend = false, yRight = true } = {}) {
  const grid = css('--line'), tick = css('--text-3');
  return {
    responsive: true, maintainAspectRatio: false, animation: false, normalized: true,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: legend, labels: { color: css('--text-2'), usePointStyle: true, pointStyle: 'circle', boxWidth: 6, boxHeight: 6, padding: 14, font: { size: 11 } } },
      tooltip: {
        backgroundColor: css('--panel-2'), borderColor: css('--line'), borderWidth: 1, cornerRadius: 8, padding: 10, boxPadding: 4, usePointStyle: true, titleColor: css('--text'), bodyColor: css('--text-2'), titleFont: { weight: '500' },
        callbacks: { ...(time ? { title: trTitle } : {}), label: (c) => `${c.dataset.label}: ${c.parsed.y == null ? '—' : num(c.parsed.y, Math.abs(c.parsed.y) < 10 ? 3 : 2)}` },
      },
    },
    scales: {
      x: time ? { type: 'time', grid: { display: false }, ticks: { color: tick, maxRotation: 0, autoSkipPadding: 18, font: { size: 10 }, callback: trTick }, border: { display: false } }
        : { grid: { display: false }, ticks: { color: tick, font: { size: 10 } }, border: { display: false } },
      y: { position: yRight ? 'right' : 'left', grid: { color: grid, drawTicks: false }, ticks: { color: tick, font: { size: 10 } }, border: { display: false } },
    },
  };
}

export function palette() {
  return [css('--accent'), css('--info'), css('--violet'), css('--up'), css('--down'),
    css('--c1'), css('--c2'), css('--c3'), css('--c4'), css('--c5'), css('--c6'), css('--c7')];
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
      responsive: true, maintainAspectRatio: false, cutout: '68%', animation: false,
      plugins: {
        legend: { position: 'right', labels: { color: css('--text-2'), usePointStyle: true, boxWidth: 6, boxHeight: 6, padding: 12, font: { size: 11 }, generateLabels: (ch) => ch.data.labels.map((l, i) => ({ text: `${l}  ${num(items[i].pct, 1)}%`, fillStyle: colors[i % colors.length], strokeStyle: colors[i % colors.length], pointStyle: 'circle', index: i, fontColor: css('--text-2') })) } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${num(c.parsed, 0)} (${num(items[c.dataIndex].pct, 1)}%)` } },
      },
    },
  });
}

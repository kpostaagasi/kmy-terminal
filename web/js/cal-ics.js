// server/takvim.js toIcs ile aynı sözleşme. Sayfa ekrandaki metni summary olarak verir.
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
const icsDate = (d) => d.replace(/-/g, '');
const nextDay = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
};

export function toIcs(events, today) {
  const rows = (events || []).filter((e) => e?.date >= today).sort((a, b) => a.date.localeCompare(b.date) || String(a.symbol || '').localeCompare(b.symbol || ''));
  const body = rows.map((e) => {
    const uid = [e.type, e.date, e.symbol || '', e.data?.period || '', e.data?.year || ''].join('-');
    const summary = e.certainty === 'tahmini' ? `TAHMİNİ ${e.summary || e.type}` : (e.summary || e.type);
    return ['BEGIN:VEVENT', `UID:${icsEsc(uid)}@kmy`, `DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(e.date))}`, `SUMMARY:${icsEsc(summary)}`, e.certainty === 'tahmini' ? 'STATUS:TENTATIVE' : 'STATUS:CONFIRMED', 'END:VEVENT'].join('\r\n');
  }).join('\r\n');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//kmy terminal//takvim//TR\r\n${body}${body ? '\r\n' : ''}END:VCALENDAR\r\n`;
}

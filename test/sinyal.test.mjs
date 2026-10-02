// Sinyal bildirimi: yeni sinyal ayrımı ve tarama zamanı. Çevrimdışı, veritabansız.
import { diffSignals, dueNow, DEFAULT_TYPES, SCAN_AFTER, SCAN_AFTER_HALF, RETRY_MS } from '../server/sinyal.js';

let pass = 0, fail = 0;
function assert(name, cond, detail = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sc = (symbol, signals, price = 100, changePct = 1) => ({ symbol, signals, price, changePct });
const ON = ['golden', 'high52'];

assert('varsayılan türler: 6 seyrek trend sinyali', same(DEFAULT_TYPES, ['golden', 'death', 'high52', 'low52', 'sma200_up', 'sma200_dn']));
assert('tarama saatleri', SCAN_AFTER === '18:30' && SCAN_AFTER_HALF === '12:50' && RETRY_MS === 10 * 60_000);

// ── diffSignals ───────────────────────────────────────────────────────────
const d1 = diffSignals({ THYAO: [] }, [sc('THYAO', ['golden'])], ON, ['THYAO']);
assert('yeni sinyal bildirilir', d1.fired.length === 1 && d1.fired[0].symbol === 'THYAO' && d1.fired[0].signal === 'golden');
assert('bildirimde fiyat ve değişim taşınır', d1.fired[0].price === 100 && d1.fired[0].changePct === 1);
assert('durum yeni kümeyi saklar', same(d1.state, { THYAO: ['golden'] }));

const d2 = diffSignals({ THYAO: ['golden'] }, [sc('THYAO', ['golden'])], ON, ['THYAO']);
assert('dünkü sinyal tekrar bildirilmez', d2.fired.length === 0);

const d3 = diffSignals({ THYAO: [] }, [sc('THYAO', [])], ON, ['THYAO']);
const d4 = diffSignals(d3.state, [sc('THYAO', ['golden'])], ON, ['THYAO']);
assert('kaybolup dönen sinyal yeniden bildirilir', diffSignals({ THYAO: ['golden'] }, [sc('THYAO', [])], ON, ['THYAO']).fired.length === 0 && d4.fired.length === 1);

const d5 = diffSignals({ THYAO: ['golden'] }, [sc('THYAO', ['golden', 'high52'])], ON, ['THYAO']);
assert('yalnız yeni eklenen sinyal bildirilir', d5.fired.length === 1 && d5.fired[0].signal === 'high52');

// ── İlk çalıştırma ve yeni sembol (Review Focus) ──────────────────────────
const d6 = diffSignals({}, [sc('THYAO', ['golden', 'high52']), sc('ASELS', ['golden'])], ON, ['THYAO', 'ASELS']);
assert('ilk çalıştırma sessiz (taban çizgisi)', d6.fired.length === 0 && same(d6.state, { THYAO: ['golden', 'high52'], ASELS: ['golden'] }));
const d7 = diffSignals({ THYAO: [] }, [sc('THYAO', []), sc('YENI', ['golden'])], ON, ['THYAO', 'YENI']);
assert('listeye yeni eklenen sembol sessiz', d7.fired.length === 0 && same(d7.state.YENI, ['golden']));
const d8 = diffSignals(d7.state, [sc('YENI', ['golden', 'high52'])], ON, ['THYAO', 'YENI']);
assert('taban çizgisinden sonra yeni sinyal bildirilir', d8.fired.length === 1 && d8.fired[0].symbol === 'YENI');

// ── Tür süzgeci (Review Focus) ────────────────────────────────────────────
const d9 = diffSignals({ THYAO: [] }, [sc('THYAO', ['rsi_os', 'golden'])], ON, ['THYAO']);
assert('kapalı sinyal türü bildirilmez', d9.fired.length === 1 && d9.fired[0].signal === 'golden');
assert('kapalı tür yine de durumda saklanır (sonradan açınca yağmur olmaz)', same(d9.state, { THYAO: ['rsi_os', 'golden'] }));
const d10 = diffSignals(d9.state, [sc('THYAO', ['rsi_os', 'golden'])], ['golden', 'rsi_os'], ['THYAO']);
assert('sonradan açılan tür, zaten var olan sinyali bildirmez', d10.fired.length === 0);
assert('hiç tür açık değilse bildirim yok', diffSignals({ THYAO: [] }, [sc('THYAO', ['golden'])], [], ['THYAO']).fired.length === 0);

// ── Kapsam ve eksik tarama (Review Focus) ─────────────────────────────────
const d11 = diffSignals({ THYAO: [], ESKI: ['golden'] }, [sc('THYAO', [])], ON, ['THYAO']);
assert('kapsamdan çıkan sembol durumdan düşer', !('ESKI' in d11.state));
const d12 = diffSignals({ THYAO: ['golden'], ASELS: [] }, [sc('ASELS', ['golden'])], ON, ['THYAO', 'ASELS']);
assert('taranamayan sembolün önceki durumu korunur', same(d12.state.THYAO, ['golden']) && d12.fired.length === 1);
const d13 = diffSignals({ THYAO: [] }, [sc('BASKA', ['golden'])], ON, ['THYAO']);
assert('kapsam dışı taranan sembol yok sayılır', d13.fired.length === 0 && !('BASKA' in d13.state));
assert('boş tarama durumu bozmaz', same(diffSignals({ THYAO: ['golden'] }, [], ON, ['THYAO']).state, { THYAO: ['golden'] }));
assert('önceki durum yoksa (null) çökmez', diffSignals(null, [sc('THYAO', ['golden'])], ON, ['THYAO']).fired.length === 0);

// ── dueNow ────────────────────────────────────────────────────────────────
const CLOSED = { open: false, label: 'Seans kapalı', half: false };
const base = { status: CLOSED, hm: '18:35', today: '2026-10-02', lastDone: '2026-10-01', lastAttempt: null, now: 1_000_000_000_000 };
assert('seans kapalı, 18:35, bugün yapılmadı → zamanı geldi', dueNow(base) === true);
assert('18:29 henüz erken', dueNow({ ...base, hm: '18:29' }) === false);
assert('tam 18:30 başlar', dueNow({ ...base, hm: '18:30' }) === true);
assert('bugün zaten yapıldı', dueNow({ ...base, lastDone: '2026-10-02' }) === false);
assert('gece 23:00 hâlâ bugünün taraması', dueNow({ ...base, hm: '23:00' }) === true);
assert('seans açıkken çalışmaz', dueNow({ ...base, status: { open: true, label: 'Sürekli işlem' } }) === false);
assert('kapanış seansında çalışmaz', dueNow({ ...base, status: { open: false, label: 'Kapanış seansı' } }) === false);
assert('seans öncesi çalışmaz', dueNow({ ...base, status: { open: false, label: 'Seans öncesi' }, hm: '08:00' }) === false);
assert('hafta sonu çalışmaz', dueNow({ ...base, status: { open: false, label: 'Hafta sonu kapalı' } }) === false);
assert('resmî tatil çalışmaz', dueNow({ ...base, status: { open: false, label: 'Tatil: Cumhuriyet Bayramı', holiday: 'Cumhuriyet Bayramı' } }) === false);
const HALF = { open: false, label: 'Seans kapalı', half: true };
assert('yarım gün 12:49 erken', dueNow({ ...base, status: HALF, hm: '12:49' }) === false);
assert('yarım gün 12:50 başlar', dueNow({ ...base, status: HALF, hm: '12:50' }) === true);
assert('yarım gün öğleden sonra da bugünün taraması', dueNow({ ...base, status: HALF, hm: '15:00' }) === true);
assert('10 dk dolmadan yeniden denenmez', dueNow({ ...base, lastAttempt: base.now - 9 * 60_000 }) === false);
assert('10 dk dolunca yeniden denenir', dueNow({ ...base, lastAttempt: base.now - 10 * 60_000 }) === true);
assert('hiç deneme yoksa (null) çalışır', dueNow({ ...base, lastAttempt: null }) === true);
assert('hiç tamamlanmamışsa (null) çalışır', dueNow({ ...base, lastDone: null }) === true);

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);

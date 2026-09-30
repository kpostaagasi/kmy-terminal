// Örnek portföy: portföy ekranının gerçek veriyle çalıştığını görmek için.
// Gerçekçi bir dağılım: BIST hisseleri + yabancı hisse + TEFAS fonu + döviz + nakit
// + temettü + kâr kapatan satış + platformlar arası transfer + bölünme.
// Canlı fiyatlarla değerlendirilir; kullanıcı Ayarlar › Portföy › Sıfırla ile silebilir.
// Çalıştırma:  node scripts/ornek-portfoy.mjs
const BASE = process.env.KMY_BASE || 'http://127.0.0.1:7420';
const { execSync } = await import('node:child_process');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');

const TOKEN = execSync('./bin/kmy gateway token', { encoding: 'utf8' }).trim();
const api = async (method, url, body) => {
  const r = await fetch(BASE + url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${t.slice(0, 160)}`);
  return t ? JSON.parse(t) : null;
};

// n ay önceki tarih (YYYY-AA-GG)
const ago = (n) => {
  const x = new Date();
  x.setMonth(x.getMonth() - n);
  return x.toISOString().slice(0, 10);
};

// Tekrar çalıştırılabilir: önce portföyü sıfırlar, sonra kurar.
await api('POST', '/api/portfolio/reset', { confirm: 'SIFIRLA' });

const platform = async (name, currency = 'TRY') =>
  (await api('GET', '/api/platforms')).find?.((p) => p.name === name) ||
  (await api('POST', '/api/platforms', { name, currency }));

const A = 'Yatırım Hesabı';
const B = 'EMEKLİLİK';

// Nakit girişi alımları karşılayacak kadar olmalı: aksi hâlde bütünlük denetimi
// "net yatırım maliyet esaslı" ve "eksi nakit" uyarıları üretir ve portföy sağlıklı görünmez.
const tx = [
  { date: ago(14), platform: A, type: 'DEPOSIT', price: 420000, notes: 'Örnek portföy — başlangıç nakdi' },
  { date: ago(14), platform: B, type: 'DEPOSIT', price: 30000, notes: 'Örnek portföy — ikinci hesap' },
  { date: ago(14), platform: A, type: 'BUY', symbol: 'THYAO', quantity: 300, price: 232.5, fee: 68 },
  { date: ago(11), platform: A, type: 'BUY', symbol: 'ASELS', quantity: 400, price: 68.2, fee: 52 },
  { date: ago(8), platform: A, type: 'BUY', symbol: 'TUPRS', quantity: 150, price: 148.0, fee: 41 },
  { date: ago(6), platform: A, type: 'BUY', symbol: 'GARAN', quantity: 800, price: 104.3, fee: 62 },
  { date: ago(9), platform: A, type: 'BUY', symbol: 'BIMAS', quantity: 250, price: 372.0, fee: 55 },

  { date: ago(4), platform: A, type: 'SPLIT', symbol: 'ASELS', quantity: 2, notes: 'Bölünme örneği' },

  { date: ago(12), platform: A, type: 'FX_CONVERT', price: 60000, currency: 'TRY', to_currency: 'USD', to_amount: 1400 },
  { date: ago(12), platform: A, type: 'BUY', symbol: 'AAPL.US', quantity: 6, price: 214.0, currency: 'USD', fee: 1.2 },

  { date: ago(10), platform: A, type: 'BUY', symbol: 'TTE', asset_type: 'fund', quantity: 250000, price: 0.0684, notes: 'TEFAS emeklilik fonu' },

  { date: ago(3), platform: A, type: 'SELL', symbol: 'GARAN', quantity: 300, price: 118.4, fee: 44, tax: 3552, other_fee: 6 },

  { date: ago(2), platform: A, type: 'DIVIDEND', symbol: 'THYAO', price: 5400, fee: 540, notes: 'Temettü (stopaj %10)' },
  { date: ago(1), platform: A, type: 'INTEREST', price: 1280, notes: 'Hesap faizi' },

  { date: ago(5), platform: A, type: 'TRANSFER', symbol: 'TUPRS', quantity: 60, to_platform: B, notes: 'Platformlar arası' },
  { date: ago(5), platform: B, type: 'BUY', symbol: 'KCHOL', quantity: 120, price: 152.0, fee: 22 },
  { date: ago(2), platform: B, type: 'DIVIDEND', symbol: 'KCHOL', price: 1800, fee: 180 },
];

await platform(A);
await platform(B);
for (const t of tx) {
  await api('POST', '/api/transactions', t);
  process.stdout.write('.');
}
console.log(`\n${tx.length} işlem eklendi.`);
const s = await api('GET', '/api/portfolio');
console.log(`Değer ${Math.round(s.totals.value).toLocaleString('tr-TR')} ₺ · ` +
  `maliyet ${Math.round(s.totals.cost).toLocaleString('tr-TR')} ₺ · ` +
  `pozisyon ${s.totals.positionsCount} · ` +
  `denetim ${(s.audit || []).length} madde`);
if ((s.audit || []).length) for (const a of s.audit) console.log(`  [${a.severity}] ${a.title} — ${a.detail}`);

// Ajan araçları (tek kaynak). Üç yerden açılır:
//  1. Claude Agent SDK süreç içi MCP sunucusu (mcp__borsa__*)
//  2. HTTP: POST /api/tools/:name  (stdio MCP köprüsü bunu kullanır)
//  3. server/mcp-stdio.js — Codex veya harici Claude Code için stdio MCP sunucusu
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as market from './market.js';
import * as portfolio from './portfolio.js';
import * as kap from './kap.js';
import * as store from './store.js';
import * as universe from './universe.js';
import { technicalSummary } from './indicators.js';
import { radar } from './radar.js';
import * as memory from './memory.js';
import * as documents from './documents.js';
import * as research from './research.js';
import * as feeds from './feeds.js';
import crypto from 'node:crypto';
import { db } from './db.js';
import { readToken } from './gateway.js';

const r2 = (x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x);
const noSpark = ({ spark, sparkTimes, ...x }) => x;

export const INSTRUCTIONS = 'kmy terminal yerel verileri: fiyat (BIST ~15 dk gecikmeli; döviz/altın serbest piyasa), geçmiş, teknik gösterge, sinyal taraması, temel oranlar (İş Yatırım), hisse tarayıcı, temettü/sermaye artırımı takvimi, KAP bildirimleri ve içerikleri, kullanıcının portföyü ve izleme listesi. BIST sembolleri kısa kodla verilir (THYAO). Özel semboller: USDTRY, EURTRY, GBPTRY, CHFTRY, GRAM (gram altın), CEYREK, YARIM, TAM, CUMHURIYET, ATA, HAS, GUMUS, ONS, BRENT, BTC, SPX, XU100, XU030, XBANK. ABD hisseleri AAPL.US biçiminde.';

// notify(type, data): arayüze canlı güncelleme yayını
export function toolSpecs(notify = () => {}) {
  return [
    {
      name: 'get_quotes', readOnly: true,
      description: 'Bir veya birden çok sembolün anlık fiyatı, günlük değişimi, gün aralığı, 52 hafta aralığı ve hacmi.',
      schema: { symbols: z.array(z.string()).describe('Semboller, ör. ["THYAO","USDTRY","GRAM"]') },
      handler: async ({ symbols }) => Object.values(await market.getQuotes(symbols)).map(noSpark),
    },
    {
      name: 'get_history', readOnly: true,
      description: 'Sembolün OHLCV geçmişi. range: 1d,5d,1mo,3mo,6mo,ytd,1y,2y,5y,10y,max. En fazla `limit` son bar döner.',
      schema: { symbol: z.string(), range: z.string().optional().describe('varsayılan 6mo'), interval: z.string().optional(), limit: z.number().int().optional().describe('varsayılan 120') },
      handler: async ({ symbol, range = '6mo', interval, limit = 120 }) => (await market.getHistory(symbol, range, interval)).slice(-limit)
        .map((b) => ({ d: new Date(b.t).toISOString().slice(0, 16).replace('T', ' '), o: r2(b.o), h: r2(b.h), l: r2(b.l), c: r2(b.c), v: b.v })),
    },
    {
      name: 'technical_analysis', readOnly: true,
      description: 'Sembol için teknik özet: SMA20/50/200, RSI14, MACD, Bollinger, ATR, dönemsel getiriler, volatilite, 52H zirveye uzaklık ve sinyaller.',
      schema: { symbol: z.string() },
      handler: async ({ symbol }) => ({ symbol: market.normalize(symbol), ...technicalSummary(await market.getHistory(symbol, '2y', '1d')) }),
    },
    {
      name: 'signal_scan', readOnly: true,
      description: 'BIST 100 (veya verilen semboller) için sinyal taraması: RSI aşırı alım/satım, altın/ölüm kesişimi, 52 hafta zirve/dip, hacim patlaması, SMA200 kırılımı.',
      schema: { symbols: z.array(z.string()).optional().describe('boşsa BIST 100 evreni') },
      handler: async ({ symbols }) => radar(symbols),
    },
    {
      name: 'get_fundamentals', readOnly: true,
      description: 'BIST hisseleri için temel veriler (İş Yatırım, günlük): ad, sektör, kapanış, piyasa değeri (TL/USD), halka açıklık, sermaye, F/K, FD/FAVÖK, FD/Satışlar, PD/DD, son bilanço dönemi, analist tahminleri ve prim/iskonto, günlük/haftalık/aylık/yıl içi getiri, geçmiş ve ilan edilmiş temettü/sermaye artırımları.',
      schema: { symbols: z.array(z.string()).describe('En fazla 20 BIST kodu') },
      handler: async ({ symbols }) => {
        const out = [];
        for (const s of symbols.slice(0, 20)) out.push((await market.fundamentals(s)) || { code: market.normalize(s), error: 'Temel veri yok (BIST dışı veya bulunamadı)' });
        return out;
      },
    },
    {
      name: 'screen_stocks', readOnly: true,
      description: 'BIST hisse tarayıcı (İş Yatırım verisi). Filtreler isteğe bağlı: index (BIST100|BIST30|TUM), sector (metin içerir), pe_max, pe_min, pb_max, ev_ebitda_max, mcap_min_mn (milyon TL), free_float_min (%), ret_ytd_min/max (%), sort (mcap|pe|pb|ev_ebitda|ret_ytd|ret_1m), limit.',
      schema: {
        index: z.enum(['BIST100', 'BIST30', 'TUM']).optional(), sector: z.string().optional(),
        pe_min: z.number().optional(), pe_max: z.number().optional(), pb_max: z.number().optional(), ev_ebitda_max: z.number().optional(),
        mcap_min_mn: z.number().optional(), free_float_min: z.number().optional(), ret_ytd_min: z.number().optional(), ret_ytd_max: z.number().optional(),
        sort: z.enum(['mcap', 'pe', 'pb', 'ev_ebitda', 'ret_ytd', 'ret_1m']).optional(), limit: z.number().int().optional(),
      },
      handler: async (f) => screen(f),
    },
    {
      name: 'get_corporate_actions', readOnly: true,
      description: 'BIST temettü ve sermaye artırımı takvimi (İş Yatırım): tarih, hisse başı brüt temettü, toplam nakit temettü, bedelsiz/bedelli oranlar. symbols verilmezse tüm hisseler; from/to YYYY-AA-GG.',
      schema: { symbols: z.array(z.string()).optional(), from: z.string().optional(), to: z.string().optional() },
      handler: async ({ symbols, from, to }) => universe.corporateActions({ symbols: symbols?.map(market.normalize), from, to }),
    },
    {
      name: 'search_symbol', readOnly: true,
      description: 'Şirket adı veya kod ile sembol arama.',
      schema: { query: z.string() },
      handler: async ({ query }) => market.search(query),
    },
    {
      name: 'market_overview', readOnly: true,
      description: 'Piyasa özeti: BIST endeksleri, döviz, altın, emtia; BIST100 günün en çok yükselen/düşen/işlem gören hisseleri, piyasa genişliği ve sektör performansı.',
      schema: {},
      handler: async () => ({ status: market.marketStatus(), overview: (await market.overview()).map(noSpark), ...(await market.movers()) }),
    },
    {
      name: 'get_dividends_history', readOnly: true,
      description: 'Sembolün geçmiş temettü (hisse başı) ve bölünme olayları.',
      schema: { symbol: z.string(), range: z.string().optional().describe('varsayılan 5y') },
      handler: async ({ symbol, range = '5y' }) => market.getDividends(symbol, range),
    },
    {
      name: 'get_news', readOnly: true,
      description: 'Sembol veya konu için güncel haber başlıkları (BIST: Türkçe haber kaynakları).',
      schema: { query: z.string() },
      handler: async ({ query }) => market.news(query),
    },
    {
      name: 'get_kap_disclosures', readOnly: true,
      description: 'KAP bildirimleri (sinyal sınıflı: TEZ, YAPISAL, FINANSAL, KURUMSAL, DIGER). symbols verilirse o şirketlerin bildirimleri; sembolle birlikte days 730 güne kadar (faaliyet raporu, finansal rapor, yatırımcı sunumu geçmişi için), sembolsüz en fazla 31 gün. cls: FR (finansal rapor), ODA (özel durum), DG (diğer), DKB (düzenleyici kurum). query: konu/özet/şirket adında arama (ör. "Faaliyet Raporu", "Sunum", "Değerleme"). İçerik ve ekler için get_kap_detail.',
      schema: { symbols: z.array(z.string()).optional(), days: z.number().int().min(1).max(730).optional().describe('varsayılan 3'), cls: z.string().optional(), query: z.string().optional(), signal: z.enum(['TEZ', 'YAPISAL', 'FINANSAL', 'KURUMSAL', 'DIGER']).optional() },
      handler: async ({ symbols, days = 3, cls, query, signal }) => kap.disclosures({ symbols, days, cls, signal, q: query, limit: 80 }),
    },
    {
      name: 'get_kap_detail', readOnly: true,
      description: 'Tek bir KAP bildiriminin tam metni, üst verisi ve ek dosya (PDF) bağlantıları. id: get_kap_disclosures sonucundaki id.',
      schema: { id: z.number().int() },
      handler: async ({ id }) => { const d = await kap.detail(id); const { html, ...rest } = d; return rest; },
    },
    {
      name: 'save_kap_attachment', readOnly: false,
      description: 'KAP bildirim ekini (faaliyet raporu, finansal rapor, sunum, değerleme raporu PDF\'i vb.) şirket belge arşivine indirir: belgeler/<SEMBOL>/. url: get_kap_detail çıktısındaki ek bağlantısı. Dönen path\'i Read aracıyla oku (uzun PDF\'lerde pages parametresi kullan).',
      schema: { url: z.string().describe('https://www.kap.org.tr/tr/api/file/download/…'), symbol: z.string().optional().describe('Arşiv klasörü, ör. THYAO'), name: z.string().optional().describe('Dosya adı (boşsa KAP\'taki ad)') },
      handler: async (a) => { const r = await documents.saveKapAttachment(a); notify('documents.changed', r); return r; },
    },
    {
      name: 'list_documents', readOnly: true,
      description: 'Şirket belge arşivindeki dosyalar (belgeler/<SEMBOL>/): daha önce indirilmiş KAP ekleri ve belgeler. Aynı belgeyi yeniden indirmeden önce kontrol et.',
      schema: { symbol: z.string().optional() },
      handler: async ({ symbol }) => documents.list(symbol || null),
    },
    {
      name: 'get_portfolio', readOnly: true,
      description: 'Kullanıcının portföy özeti: toplam değer, net yatırılan, maliyet, açık/gerçekleşen K/Z, temettü, faiz, kur farkı, platform ve para birimi bazında nakit, pozisyonlar (ağırlık, ortalama maliyet, K/Z, fiyat kaynağı), platform bazlı pozisyonlar, dağılımlar ve uyarılar.',
      schema: {},
      handler: async () => portfolio.summary(),
    },
    {
      name: 'get_portfolio_risk', readOnly: true,
      description: 'Portföyün zaman ağırlıklı getirisi (TWR), para ağırlıklı getirisi (XIRR) ve risk metrikleri: CAGR, volatilite, Sharpe, Sortino, Calmar, maksimum düşüş, beta, devir hızı, aylık getiriler, dönem getirileri ve kıyaslar (BIST 100, USD/TL, gram altın, S&P 500 TL, BTC TL). from/to verilirse seçili dönem.',
      schema: { from: z.string().optional(), to: z.string().optional() },
      handler: async ({ from, to }) => { const r = await portfolio.risk({ from, to }); delete r.series; delete r.drawdown; return r; },
    },
    {
      name: 'get_dividend_report', readOnly: true,
      description: 'Portföyün alınan temettüleri (aylık/yıllık), beklenen yıllık temettü geliri ve temettü verimleri.',
      schema: {},
      handler: async () => portfolio.dividendReport(),
    },
    {
      name: 'get_transactions', readOnly: true,
      description: 'Portföy işlem geçmişi. Filtre: symbol, type (BUY, SELL, DIVIDEND, SPLIT, DEPOSIT, WITHDRAW, FEE, INTEREST).',
      schema: { symbol: z.string().optional(), type: z.string().optional(), limit: z.number().int().optional().describe('varsayılan 100') },
      handler: async (a) => portfolio.listTransactions({ ...a, limit: a.limit ?? 100 }),
    },
    {
      name: 'add_transaction', readOnly: false,
      description: 'Portföye işlem ekler. Yalnızca kullanıcı açıkça istediğinde kullan. BUY/SELL/DRIP: quantity + price (fee = komisyon). DIVIDEND: price = brüt tutar, fee = stopaj. DEPOSIT/WITHDRAW/FEE/INTEREST: price = tutar. SPLIT: quantity = oran (2 = her hisse 2 olur). FREE/STAKING: quantity. TRANSFER: platform → to_platform (symbol + quantity ya da nakit için price). FX_CONVERT: currency + price (kaynak tutar) → to_currency + to_amount.',
      schema: {
        date: z.string().describe('YYYY-AA-GG'), type: z.enum(Object.keys(portfolio.TX_META)),
        symbol: z.string().optional(), quantity: z.number().optional(), price: z.number().optional(), fee: z.number().optional(),
        currency: z.string().optional(), fx_rate: z.number().optional(), platform: z.string().optional(), to_platform: z.string().optional(),
        to_currency: z.string().optional(), to_amount: z.number().optional(), asset_type: z.string().optional(), strategy: z.string().optional(), notes: z.string().optional(),
      },
      handler: async (t) => { const r = await portfolio.addTransaction(t); notify('portfolio.changed', {}); return r; },
    },
    {
      name: 'set_manual_price', readOnly: false,
      description: 'Otomatik fiyat kaynağı olmayan varlıklar (mevduat, özel ürün, borsada işlem görmeyen tahvil) için güncel birim fiyatı kaydeder; portföy değerlemesinde kullanılır. price boş verilirse elle fiyat silinir.',
      schema: { symbol: z.string(), price: z.number().nullable(), date: z.string().optional().describe('Fiyat tarihi YYYY-AA-GG') },
      handler: async ({ symbol, price, date }) => { const r = portfolio.setManualPrice(symbol, price, date); notify('portfolio.changed', {}); return r; },
    },
    {
      name: 'get_watchlist', readOnly: true,
      description: 'İzleme listesindeki semboller ve anlık fiyatları.',
      schema: {},
      handler: async () => { const w = store.watchlist(); const q = await market.getQuotes(w); return w.map((s) => noSpark(q[s] || { symbol: s })); },
    },
    {
      name: 'update_watchlist', readOnly: false,
      description: 'İzleme listesine sembol ekler veya çıkarır.',
      schema: { add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() },
      handler: async ({ add = [], remove = [] }) => { add.forEach(store.addWatch); remove.forEach(store.removeWatch); notify('watchlist.changed', {}); return store.watchlist(); },
    },
    {
      name: 'get_broker_reports', readOnly: true,
      description: 'Aracı kurum araştırma raporları (Gedik, Garanti BBVA, AK, İş, Yapı Kredi, Ziraat, Vakıf, Tacirler, PhillipCapital, Integral, A1 Capital ve Halk Yatırım\'ın haftalık tavsiye/hedef fiyat listesi; kurumların açık yayınları ve kullanıcının klasör izlemeyle arşive aldığı raporlar Raporlar arşivindedir). Filtreler: symbol (BIST kodu), broker (gedik|garanti|ak|isyatirim|yapikredi|ziraat|vakif|tacirler|phillip|integral|a1|halk), days (varsayılan 90; 0 = tümü), category (Şirket|Sektör|Strateji|Bilanço|Makro|Model portföy|Teknik|Diğer), query. Her kayıtta id, kurum, başlık, tarih, semboller ve özet (çoğu raporda tavsiye ve hedef fiyat özette) bulunur. Tam metin için read_broker_report.',
      schema: { symbol: z.string().optional(), broker: z.string().optional(), days: z.number().int().optional(), category: z.string().optional(), query: z.string().optional(), limit: z.number().int().optional() },
      handler: async ({ symbol, broker, days = 90, category, query, limit = 40 }) => {
        const r = await research.list({ symbol, broker, days, category, q: query, limit: Math.min(limit, 100) });
        return { total: r.total, updated: new Date(r.at).toISOString(), unavailable: r.unavailable.map((u) => `${u.name}: ${u.reason}`), items: r.items.map(({ id, broker: b, title, date, category: c, symbols, summary, access, analyst }) => ({ id, broker: b, title, date: date.slice(0, 10), category: c, symbols, summary, analyst, access })) };
      },
    },
    {
      name: 'read_broker_report', readOnly: false,
      description: 'Aracı kurum raporunu (get_broker_reports id) indirir, Raporlar arşivine (reports/kurum/<kurum>/) kurum ve sembol etiketiyle kaydeder ve dosya yolunu döner. Yolu Read aracıyla oku (uzun PDF\'lerde pages). access "web" olan kayıtlar PDF değildir; page adresini WebFetch ile oku.',
      schema: { id: z.string() },
      handler: async ({ id }) => { const r = await research.save(id); notify('reports.changed', {}); return { ...r, readPath: r.path }; },
    },
    {
      name: 'get_financial_statements', readOnly: true,
      description: 'BIST şirketinin son çeyrek mali tabloları (İş Yatırım, KAP finansallarından): sanayi şirketlerinde satış, brüt kâr, faaliyet kârı, FAVÖK (faaliyet kârı + amortisman), net kâr (ana ortaklık), işletme nakit akışı, ihracat, net döviz pozisyonu, toplam varlık, özkaynak, finansal borç, net borç; bankalarda net faiz geliri, net ücret-komisyon, karşılıklar, net kâr, krediler, mevduat, özkaynak. cumulative yıl başından kümülatif, quarterly çeyreklik; lastPeriodItems son dönemin tüm kalemleri.',
      schema: { symbol: z.string(), quarters: z.number().int().min(4).max(12).optional().describe('varsayılan 8') },
      handler: async ({ symbol, quarters = 8 }) => feeds.financials(symbol, quarters),
    },
    {
      name: 'get_market_news', readOnly: true,
      description: 'Türkiye ekonomi ve piyasa haberleri (Bloomberg HT, Foreks, Anadolu Ajansı, Dünya, Ekonomim, TRT Haber, Investing TR RSS). symbol verilirse o şirketin kodu veya adının geçtiği haberler; query metin araması; sources: bloomberght,foreks,aa,dunya,ekonomim,trt,investing. Şirkete özel geniş arama için get_news (Google Haberler) de kullanılabilir.',
      schema: { symbol: z.string().optional(), query: z.string().optional(), sources: z.array(z.string()).optional(), limit: z.number().int().optional() },
      handler: async ({ symbol, query, sources, limit = 30 }) => { const r = await feeds.newsFeed({ symbol, q: query, sources, limit }); return { total: r.total, items: r.items.map(({ title, summary, link, time, source }) => ({ title, summary, link, source, time: time ? new Date(time).toISOString() : null })) }; },
    },
    {
      name: 'get_tcmb_rates', readOnly: true,
      description: 'TCMB gösterge döviz kurları (resmi): döviz alış/satış ve efektif alış/satış. date (YYYY-AA-GG) verilirse o günün (tatilde önceki iş gününün) kurları; boşsa bugünkü bülten.',
      schema: { date: z.string().optional(), currencies: z.array(z.string()).optional().describe('ör. ["USD","EUR"]; boşsa tümü') },
      handler: async ({ date, currencies }) => { const r = await feeds.tcmbRates(date || null); return currencies?.length ? { date: r.date, rates: Object.fromEntries(currencies.map((c) => [c.toUpperCase(), r.rates[c.toUpperCase()] || null])) } : r; },
    },
    {
      name: 'get_tlref', readOnly: true,
      description: 'TLREF (Türk lirası gecelik referans faiz oranı, Borsa İstanbul): son 30 günlük değerler ve verilen dönemin ortalaması. Risksiz faiz, mevduat getirisi ve iskonto oranı karşılaştırmaları için.',
      schema: { from: z.string().optional(), to: z.string().optional() },
      handler: async ({ from, to }) => ({ stats: await feeds.tlrefStats(from || null, to || null), last30: (await feeds.tlrefHistory()).slice(-30) }),
    },
    {
      name: 'get_memory', readOnly: true,
      description: 'Araştırma hafızası: daha önce kaydettiğin şirket (symbol) veya konu (topic: sektör, makro tema, kurum raporları, radar-gunlugu) notlarını okur. Parametresiz çağrı mevcut notların listesini döner. Kullanıcı mesajında geçen şirketlerin notları isteme zaten eklenir.',
      schema: { symbol: z.string().optional(), topic: z.string().optional() },
      handler: async ({ symbol, topic }) => (symbol || topic ? memory.get({ symbol, topic }) || { empty: true, message: 'Bu konuda kayıtlı not yok' } : memory.list()),
    },
    {
      name: 'save_memory', readOnly: false,
      description: 'Araştırma hafızasına not yazar (workspace/hafiza). Şirket tezi üreten her analizden sonra kullan: tez özeti ve duruş (olumlu/nötr/olumsuz), kilit rakamlar ve kaynak tarihleri, **Tetikleyiciler** (fikrini değiştirecek somut koşullar), izlenecek tarih ve olaylar. Varsayılan mode "append" tarihli bölüm ekler; "replace" notu baştan yazar (not uzadığında özetlemek için). Tetikleyici radarı taramasından sonra topic "radar-gunlugu" ile tarih ve sonucu kaydet.',
      schema: { symbol: z.string().optional(), topic: z.string().optional(), content: z.string(), mode: z.enum(['append', 'replace']).optional() },
      handler: async (a) => { const r = memory.save(a); notify('memory.changed', r); return r; },
    },
    {
      name: 'save_report', readOnly: false,
      description: 'Analiz raporunu Raporlar paneline kaydeder. format "html" (tercih edilen; <html> olmadan gövde içeriği verilirse terminalin rapor stili uygulanır; tam belge de verilebilir) veya "md". Grafikler için satır içi SVG kullanılabilir.',
      schema: { title: z.string(), content: z.string(), format: z.enum(['html', 'md']).optional().describe('varsayılan html'), symbols: z.array(z.string()).optional() },
      handler: async (a) => { const r = store.saveReport({ format: 'html', symbols: [], ...a }); notify('reports.changed', r); return { saved: r.name, message: 'Rapor Raporlar paneline eklendi.' }; },
    },
  ];
}

// ── Araç sınıflandırması ve izin kapısı ──────────────────────
// Kalan her şey salt okunur (readOnly: true).
// WRITE_TOOLS: veritabanına/portföye/ayara/izleme listesine yazanlar (her zaman onay ister).
export const WRITE_TOOLS = ['add_transaction', 'set_manual_price', 'update_watchlist', 'save_memory', 'save_report', 'read_broker_report', 'save_kap_attachment'];
// FILE_TOOLS: yalnız dosya sistemine yazanlar (WRITE_TOOLS'ın alt kümesi; "düzenlemeleri onayla" modunda serbest).
export const FILE_TOOLS = ['save_kap_attachment', 'read_broker_report', 'save_report'];
const WRITES = new Set(WRITE_TOOLS), FILES = new Set(FILE_TOOLS);
// Onay istemeden çalışanlar: yalnız salt okunur araçlar (eskiden add_transaction dışında her şey otomatikti).
export const AUTO_TOOLS = toolSpecs().filter((t) => t.readOnly).map((t) => t.name);

// Sunucu tarafı izin kapısı. Claude SDK'nın canUseTool'ı yalnız süreç içi araçları korur;
// stdio köprüsünden (Codex/omp) gelen hiçbir araç oradan geçmez, burası tek kapıdır.
//   default            → yazma araçları onay ister (etkileşimli akış kendi sorusunu sorar)
//   acceptEdits        → dosya yazanlar serbest, portföy/ayar yazanlar onay ister
//   plan               → yazan hiçbir araç çalışmaz
//   bypassPermissions  → her şey serbest, tool_audit tablosuna kaydedilir
export function authorizeTool(name, { mode = 'default', sessionId = null, via = 'http' } = {}) {
  const write = WRITES.has(name), file = FILES.has(name);
  const allow = mode === 'bypassPermissions' || (!write && !file) || (mode === 'acceptEdits' && file);
  const reason = allow ? null : mode === 'plan' ? 'plan modunda dosya/veri değiştirilemez' : 'onay gerekiyor';
  const r = { allow, audit: !allow || mode === 'bypassPermissions', reason, sessionId, via, mode };
  if (r.audit) { // kayıt asla aracı bozmasın
    try { db.prepare('INSERT INTO tool_audit(tool, session_id, via, mode, allowed, reason) VALUES(?,?,?,?,?,?)').run(name, sessionId, via, mode, allow ? 1 : 0, reason); } catch { /* denetim kaydı yazılamadı */ }
  }
  return r;
}

// Alt süreçlere verilen kısa ömürlü kapsamlı yetki: yalnız araç çağrısı, master gateway
// anahtarı hiçbir çocuk sürece geçmez (bu jeton anahtarın HMAC özeti, geri döndürülemez).
const sigOf = (payload) => crypto.createHmac('sha256', readToken() || 'kmy-terminal').update(payload).digest('hex');
export function mintScopedToken({ sessionId = null, mode = 'default', ttlMs = 6 * 3600_000 } = {}) {
  const p = Buffer.from(JSON.stringify({ s: sessionId, m: mode, e: Date.now() + ttlMs })).toString('base64url');
  return `s.${p}.${sigOf(p)}`;
}
export function verifyScopedToken(tok) {
  const m = /^s\.([\w-]+)\.([0-9a-f]{64})$/.exec(String(tok || ''));
  if (!m || !crypto.timingSafeEqual(Buffer.from(sigOf(m[1]), 'hex'), Buffer.from(m[2], 'hex'))) return null;
  try { const p = JSON.parse(Buffer.from(m[1], 'base64url').toString()); return p.e > Date.now() ? { sessionId: p.s, mode: p.m } : null; } catch { return null; }
}

export const NOT_ADVICE = 'Bu bir yatırım tavsiyesi değildir.';
export function toolResult(data) {
  if (data && typeof data === 'object' && !Array.isArray(data) && /"(target|hedef|median)\w*"/i.test(JSON.stringify(data))) data = { ...data, uyari: NOT_ADVICE };
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] };
}

export function toolError(e) {
  return { content: [{ type: 'text', text: `Hata: ${e.message || e}` }], isError: true };
}

export function buildBorsaServer(notify, ctx = () => null) {
  return createSdkMcpServer({
    name: 'borsa',
    version: '1.0.0',
    alwaysLoad: true,
    instructions: INSTRUCTIONS,
    tools: toolSpecs(notify).map((s) => tool(s.name, s.description, s.schema, async (args) => {
      const c = ctx();
      if (c) { const g = authorizeTool(s.name, { ...c, via: 'sdk' }); if (!g.allow) return toolError({ message: g.reason }); }
      try { return toolResult(await s.handler(args)); } catch (e) { return toolError(e); }
    }, s.readOnly ? { annotations: { readOnlyHint: true } } : undefined)),
  });
}

// HTTP üzerinden araç çalıştırma (stdio köprüsü için)
// opts.mode verilirse önce izin kapısından geçer; verilmezse eski davranış (kapısız) korunur.
export async function runTool(name, args, notify, opts = {}) {
  const spec = toolSpecs(notify).find((t) => t.name === name);
  if (!spec) throw new Error(`Bilinmeyen araç: ${name}`);
  if (opts.mode) { const g = authorizeTool(name, { mode: opts.mode, sessionId: opts.sessionId ?? null, via: opts.via || 'http' }); if (!g.allow) return toolError({ message: g.reason }); }
  const parsed = z.object(spec.schema).parse(args || {});
  return spec.handler(parsed);
}

// Basit hisse tarayıcı (İş Yatırım temel verileri üzerinde)
export async function screen(f = {}) {
  await universe.refresh();
  let list = universe.allStocks();
  if (f.index === 'BIST100' || f.index === 'BIST30') {
    const set = new Set(f.index === 'BIST30' ? await universe.bist30() : await universe.bist100());
    list = list.filter((s) => set.has(s.code));
  }
  const inRange = (v, min, max) => (min == null || (v != null && v >= min)) && (max == null || (v != null && v <= max));
  if (f.sector) { const q = f.sector.toLocaleLowerCase('tr'); list = list.filter((s) => (s.sector || '').toLocaleLowerCase('tr').includes(q)); }
  list = list.filter((s) => inRange(s.pe, f.pe_min, f.pe_max) && inRange(s.pb, null, f.pb_max) && inRange(s.evEbitda, null, f.ev_ebitda_max)
    && inRange(s.mcapTL, f.mcap_min_mn != null ? f.mcap_min_mn * 1e6 : null, null) && inRange(s.freeFloatPct, f.free_float_min, null) && inRange(s.retYtd, f.ret_ytd_min, f.ret_ytd_max));
  const key = { mcap: 'mcapTL', pe: 'pe', pb: 'pb', ev_ebitda: 'evEbitda', ret_ytd: 'retYtd', ret_1m: 'ret1m' }[f.sort || 'mcap'];
  const asc = ['pe', 'pb', 'ev_ebitda'].includes(f.sort);
  list.sort((a, b) => ((a[key] ?? (asc ? 1e18 : -1e18)) - (b[key] ?? (asc ? 1e18 : -1e18))) * (asc ? 1 : -1));
  return { count: list.length, asOf: universe.status().at, items: list.slice(0, Math.min(f.limit || 30, 200)).map(({ code, name, sector, close, mcapTL, pe, evEbitda, evSales, pb, freeFloatPct, retYtd, ret1m, period }) => ({ code, name, sector, close, mcapMnTL: mcapTL ? Math.round(mcapTL / 1e6) : null, pe, evEbitda, evSales, pb, freeFloatPct, retYtd, ret1m, period })) };
}

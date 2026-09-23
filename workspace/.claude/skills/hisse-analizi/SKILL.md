---
name: hisse-analizi
description: Bir BIST hissesi için kapsamlı temel + teknik analiz ve HTML rapor. "X'i analiz et", "X hakkında ne düşünüyorsun", /analiz komutu.
---

# Kapsamlı hisse analizi

## 1. Veri toplama (paralel)
- `mcp__borsa__get_quotes` ve `mcp__borsa__technical_analysis` — fiyat, trend, momentum
- `mcp__borsa__get_history` (range 5y, limit 60, aylık görünüm için interval 1mo)
- `mcp__borsa__get_kap_disclosures` (symbols=[X], days=60) — son özel durumlar ve finansal raporlar
- `mcp__borsa__get_dividends_history`
- `mcp__borsa__get_portfolio` — kullanıcı bu hisseyi tutuyor mu?
- Varsa Borsa MCP / Matriks MCP: son 8 çeyrek gelir tablosu, bilanço, nakit akışı, F/K, PD/DD, FD/FAVÖK, net borç, sektör karşılaştırması
- `mcp__borsa__get_news` + gerekirse WebSearch

## 2. Analiz çerçevesi
1. **İş modeli ve sektör** — 2–3 cümle; gelirin kaynağı, döviz duyarlılığı (ihracat/ithalat), düzenleyici riskler.
2. **Finansal eğilim** — satış büyümesi (TL ve USD bazında), brüt/FAVÖK/net marj, borçluluk, serbest nakit akışı. Enflasyon muhasebesinin (TMS 29) etkisini not et.
3. **Değerleme** — çarpanlar: şirketin kendi 3–5 yıllık ortalaması ve sektör medyanıyla karşılaştır. Gerekirse `dcf-degerleme` becerisi.
4. **Teknik görünüm** — trend (SMA50/200), momentum (RSI, MACD), 52H aralığındaki konum, destek/direnç (son 6 ayın dip/tepe kümeleri).
5. **Katalizörler ve riskler** — KAP bildirimleri, sermaye artırımı, temettü, ihaleler, kur/faiz duyarlılığı.
6. **Portföy bağlantısı** — tutuluyorsa ağırlık, maliyete göre K/Z, yoğunlaşma etkisi.
7. **Senaryolar** — iyimser / baz / kötümser; her biri için tetikleyici ve izlenecek gösterge.

## 3. Çıktı
- `rapor-html` becerisindeki şablonla `mcp__borsa__save_report` (symbols=[X]).
- Sohbette: tek cümlelik görüş + 5–7 madde + "Rapor kaydedildi".
- `save_memory({ symbol })`: tarih, duruş, 3 cümlelik tez, kilit rakamlar, **Tetikleyiciler**, izlenecek tarihler. Önceki not varsa (istemde `<arastirma_hafizasi>`) neyin değiştiğini de yaz.
- Kapsamlı analizde bağımsız kolları alt ajanlara ver (`kidemli-analist`, `asistan`, `stratejist`); sunmadan önce `denetci` ile kontrol et.

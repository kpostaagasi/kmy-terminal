---
name: teknik-analiz
description: Fiyat hareketi, trend, destek/direnç ve momentum analizi. "Teknik", "grafik", "destek direnç", /teknik istendiğinde.
---

# Teknik analiz

1. `mcp__borsa__technical_analysis` (özet göstergeler) ve `mcp__borsa__get_history` (range 1y, interval 1d, limit 250; kısa vade için range 1mo interval 1h).
2. **Trend**: SMA50/SMA200 ilişkisi ve eğimi; fiyatın ortalamalara göre konumu; son 3 dip ve tepe yükseliyor mu?
3. **Destek/direnç**: son 6–12 ayın belirgin dip/tepe kümeleri, yuvarlak seviyeler, 52H aralığı. En yakın 2 destek ve 2 direnci fiyat ve uzaklık (%) ile ver.
4. **Momentum**: RSI(14) (70/30), RSI uyumsuzluğu var mı; MACD histogram yönü; Bollinger bant genişliği (sıkışma?).
5. **Hacim**: son 20 gün ortalamasına göre; kırılımlarda hacim onayı.
6. **Göreli güç**: aynı dönemde XU100'e göre getiri farkı (`get_history` XU100).
7. **Volatilite / risk**: ATR(14) ve yıllık volatilite; ATR bazlı olası stop mesafesi örneği (yalnızca bilgi amaçlı).
8. Çıktı: kısa tablo (seviyeler) + 4–6 madde yorum + hangi seviyenin kırılmasının görünümü değiştireceği.

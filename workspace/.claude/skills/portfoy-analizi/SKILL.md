---
name: portfoy-analizi
description: Kullanıcının portföyünü performans, risk, çeşitlendirme ve temettü açısından değerlendirme; yeniden dengeleme hesabı. "Portföyüm", /portfoy, "risk", "dengele" istendiğinde.
---

# Portföy analizi

## Veri
- `mcp__borsa__get_portfolio` — değer, maliyet, K/Z, ağırlıklar, dağılımlar
- `mcp__borsa__get_portfolio_risk` — TWR, CAGR, volatilite, Sharpe/Sortino/Calmar, maks düşüş, beta, aylık getiriler
- `mcp__borsa__get_dividend_report`
- `mcp__borsa__get_kap_disclosures` (portföy sembolleri, 7 gün)
- `mcp__borsa__get_quotes` — USDTRY, GRAM, XU100 (kıyas)

## Değerlendirme
1. **Performans**: toplam ve dönemsel getiri; XU100, USD/TL ve gram altına göre (aynı dönem). Reel (USD bazlı) getiriyi ayrıca yaz.
2. **Risk**: volatilite, maks düşüş, beta; getiri/risk dengesi (Sharpe/Sortino). Risksiz faizi (ayarlardaki) belirt.
3. **Yoğunlaşma**: HHI ve etkin pozisyon sayısı; tek hisse >%20, tek sektör >%35 ise uyar. Para birimi maruziyeti (TL/USD/altın).
4. **Pozisyon notları**: en büyük 5 pozisyon için kısa not (K/Z, teknik görünüm, son KAP).
5. **Temettü**: yıllık beklenen gelir, verim, maliyete göre verim.
6. **Nakit**: eksi bakiye uyarısı varsa eksik nakit girişi kaydı olabileceğini söyle.

## Yeniden dengeleme (yalnızca istenirse)
- Hedef ağırlıkları kullanıcıdan al veya iki standart senaryo öner (eşit ağırlık; sektör tavanlı).
- Her sembol için: mevcut ağırlık, hedef, fark (TL), yaklaşık adet (güncel fiyatla, aşağı yuvarla), komisyon tahmini.
- Bunun bir hesaplama olduğunu, işlemleri kullanıcının yapacağını açıkça yaz.

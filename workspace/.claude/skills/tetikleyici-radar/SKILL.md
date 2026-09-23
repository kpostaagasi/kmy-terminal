---
name: tetikleyici-radar
description: Tetikleyici radarı. İki iş yapar - (1) kayıtlı tezlerin "fikrimi değiştirir" tetikleyicilerini güncel fiyat, KAP ve haberle karşılaştırır; (2) teknik sinyal, KAP ve hacim tetikleyicilerini tarayarak "bugün neye bakmalıyım" listesi çıkarır. "Radar", "tetikleyicileri tara", "tezlerim ne durumda", "sinyal", "neler hareketli" istendiğinde veya sistem radar hatırlatması yaptığında kullan.
---

# Tetikleyici radarı

## A. Tez tetikleyicileri (öncelikli)
1. `get_memory` (parametresiz) ile notları listele; `hasTriggers` olan şirket notlarını oku (`get_memory({symbol})`).
2. Her tez için tetikleyicileri tek tek kontrol et:
   - Fiyat seviyesi / değerleme koşulu → `get_quotes`, `get_fundamentals`
   - Şirket olayı (sözleşme, sermaye artırımı, ortaklık değişimi, finansal sonuç) → `get_kap_disclosures({ symbols, days: son taramadan bu yana })`, gerekirse `get_kap_detail`
   - Makro / sektör koşulu → `get_news`, bağlı makro araçlar
3. Her tetikleyici için hüküm: **tetiklendi**, **yaklaşıyor**, **uzak** veya **değerlendirilemedi** (veri yok). Kanıtı ve tarihi yaz.
4. Tetiklenen varsa tezi yeniden değerlendir ve `save_memory` ile şirket notuna ekle.

## B. Günün sinyalleri
1. `signal_scan` — BIST 100 teknik sinyalleri (RSI uçları, kesişimler, 52H zirve/dip, hacim patlaması, SMA200 kırılımı).
2. `market_overview` — en çok yükselen/düşen ve hacimli hisseler, sektör performansı.
3. `get_kap_disclosures` (days: 1, signal: TEZ veya YAPISAL) — sinyal çıkan hisselerin katalizörleri.
4. `get_watchlist` ve `get_portfolio` — kullanıcının ilgilendiği hisseleri öne al.

Puanlama: teknik sinyal sayısı + hacim teyidi (hacim/ortalama > 1,5) + KAP katalizörü + kullanıcı ilgisi. Tek başına RSI aşırı satımı zayıf sinyaldir.

## Çıktı
1. Tez tablosu: sembol, duruş, tetikleyici, hüküm, kanıt.
2. En fazla 10 satırlık sinyal tablosu: sembol, sinyaller, hacim oranı, katalizör, izlenecek seviye.
3. Taramayı kaydet: `save_memory({ topic: "radar-gunlugu", content: "<tarih>: N tez tarandı; tetiklenen: …; yaklaşan: …" })`. Bu kayıt haftalık radar hatırlatmasını sıfırlar.

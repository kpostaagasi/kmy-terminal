---
name: dcf-degerleme
description: İndirgenmiş nakit akışı (DCF) ile içsel değer ve duyarlılık tablosu. "DCF", "içsel değer", "hedef fiyat hesapla", "adil değer" istendiğinde.
---

# DCF değerleme (TL ve USD bazlı)

Yüksek enflasyon ortamında nominal TL DCF yanıltıcı olabilir. **Varsayılan: USD bazında** modelle, sonucu güncel USDTRY ile TL'ye çevir. Kullanıcı isterse nominal TL modeli de kur.

## Adımlar
1. **Tarihsel veri** (Borsa MCP / Matriks MCP): son 5 yıl satış, FAVÖK, amortisman, yatırım harcaması (capex), işletme sermayesi değişimi, vergi, net borç, hisse sayısı. USD'ye yıl ortalaması kurla çevir.
2. **Serbest nakit akışı (FCFF)** = FAVÖK × (1 − vergi) + amortisman × vergi − capex − ΔİS.
3. **Projeksiyon (5 yıl)**: satış büyümesi, FAVÖK marjı, capex/satış varsayımlarını tabloyla ve gerekçesiyle ver.
4. **WACC (USD)**: risksiz faiz = ABD 10Y + Türkiye ülke risk primi (CDS'ten); özsermaye risk primi %5–6; beta (terminalden `get_portfolio_risk` değil, hissenin XU100'e göre betası — `get_history` ile hesapla ya da MCP'den al); borç maliyeti; hedef sermaye yapısı.
5. **Uç değer**: Gordon (g = %2–3 USD) ve çarpan yöntemi (sektör FD/FAVÖK) — ikisini de göster.
6. **Özsermaye değeri** = FD − net borç − azınlık payları; hisse başı değer.
7. **Duyarlılık**: WACC (±1 puan) × g (±0,5 puan) 5×5 tablo; ayrıca FAVÖK marjı ± senaryosu.
8. **Karşılaştır**: güncel fiyat, yukarı/aşağı potansiyel, piyasanın fiyatladığı büyüme (ters DCF).

## Çıktı
Varsayım tablosu, projeksiyon tablosu, WACC dökümü, sonuç kartları ve duyarlılık tablosu içeren HTML rapor (`rapor-html`). Varsayımların belirsizliğini açıkça yaz; tek bir "hedef fiyat" yerine aralık ver.

## Excel modeli (istenirse)
Kullanıcı Excel dosyası isterse varsayımları JSON'a yaz ve formüllü modeli üret:
```
python3 scripts/dcf_excel.py reports/<SEMBOL>-dcf-girdi.json reports/<SEMBOL>-dcf.xlsx
```
Girdi alanları betiğin başındaki açıklamadadır (satış büyümesi ve EBIT marjı yıl yıl, vergi, satış/sermaye, WACC, terminal büyüme, net borç, hisse sayısı). Çıktıda üç sayfa olur: **Varsayımlar** (sarı hücreler değiştirilebilir), **DCF** (formüllü; Excel'de varsayım değişince sonuç güncellenir) ve **Duyarlılık** (WACC × terminal büyüme). Komut Bash izni ister. Betiğin yazdığı hisse başı değeri sohbette raporla; terminal değerin firma değerindeki payı %75'i geçiyorsa bunu uyarı olarak belirt.

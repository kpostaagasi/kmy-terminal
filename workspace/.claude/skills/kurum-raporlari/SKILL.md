---
name: kurum-raporlari
description: Aracı kurum araştırma raporlarını, faaliyet raporlarını ve şirket sunumlarını (PDF) okuyup özetleme ve karşılaştırma. Kullanıcı PDF yüklediğinde veya "kurum raporu", "hedef fiyat", "analist görüşü" dediğinde.
---

# Kurum raporları ve şirket belgeleri

## Kaynaklar
1. **Kurum raporu akışı**: `get_broker_reports({ symbol, days, category })` Gedik, Garanti BBVA, AK, İş, Yapı Kredi, Ziraat, Vakıf, Tacirler, PhillipCapital, Integral ve A1 Capital'in açık yayınlarını ve Halk Yatırım'ın haftalık "Analist Tavsiyeleri ve Hedef Fiyatları" listesini verir. Özet alanında çoğunlukla tavsiye ve hedef fiyat bulunur. Tam metin için `read_broker_report({ id })` raporu `reports/kurum/` arşivine indirir; dönen yolu Read ile oku. `access: "web"` olanları WebFetch ile oku.
2. **Kullanıcının yüklediği dosyalar**: `reports/yuklenen/` (Raporlar sekmesindeki ⇪ düğmesi).
3. **Bağlı Matriks / Borsa MCP araçları** (varsa): kurum konsensüsü ve hedef fiyat listeleri.
Halk şirket raporları, Deniz ve Alnus giriş veya bot koruması nedeniyle akışta yok. Kullanıcı bunları kendi hesabıyla indirirse klasör izleme `reports/kurum/<kurum>/` altına arşivler; Raporlar arşivinde (reports/.meta.json kurum etiketiyle) ara.

PDF'leri Read aracıyla oku; uzun belgelerde sayfa aralığı ver.

## Tek rapor özeti
1. Künye: kurum, tarih, analist, rapor türü (şirket/sektör/strateji).
2. Tavsiye ve hedef fiyat; güncel fiyata göre potansiyel (`mcp__borsa__get_quotes`). Önceki tavsiye değiştiyse belirt.
3. Tezin 3–5 ana dayanağı ve kurumun tahminleri (satış, FAVÖK, net kâr; F/K, FD/FAVÖK).
4. Riskler ve değerleme yöntemi (DCF, çarpan, NAD).
5. Kendi verilerinle kontrol: son KAP finansalları ve fiyat hareketi rapordaki varsayımlarla uyumlu mu?

## Birden çok raporu karşılaştırma
Kurum × (tarih, tavsiye, hedef fiyat, potansiyel, temel varsayım) tablosu; hedef fiyat medyanı ve dağılımı; görüş ayrılıklarının nedeni.

## Faaliyet raporu / yatırımcı sunumu
Yönetimin rehberliği (guidance), yatırım planları, kapasite, ihracat payı, borç vade yapısı, temettü politikası. Önceki dönem hedefleriyle gerçekleşeni karşılaştır.

Çıktı uzunsa `rapor-html` şablonuyla kaydet. Kurum görüşlerini kendi görüşün gibi sunma; kaynağı belirt.

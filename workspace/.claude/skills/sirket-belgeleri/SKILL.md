---
name: sirket-belgeleri
description: Şirket belge arşivi. Faaliyet raporu, finansal rapor, yatırımcı sunumu, değerleme raporu, izahname gibi PDF'leri KAP'tan bulup belgeler/<SEMBOL>/ klasörüne indirir ve okur. "Faaliyet raporunu getir", "finansal tabloları indir", "yatırımcı sunumu var mı", "değerleme raporunu oku" denildiğinde veya bir analiz birincil kaynak belge gerektirdiğinde kullan.
---

# Şirket belgeleri

Belgeler `belgeler/<SEMBOL>/` klasöründe tutulur. Kullanıcının kendi yüklediği kurum raporları ayrıca `reports/yuklenen/` altındadır.

## Akış
1. **Önce arşive bak**: `list_documents` (symbol ile). Aynı belge varsa yeniden indirme.
2. **KAP'ta bul**: `get_kap_disclosures` ile şirket geçmişinde ara (`symbols: ["THYAO"]`, `days: 400`, `query` ile konu araması; en fazla 730 gün):
   - Faaliyet raporu → "Faaliyet Raporu"
   - Finansal tablolar ve dipnotlar → "Finansal Rapor"
   - Yatırımcı sunumu → "Yatırımcı Sunumu", "Analist Toplantısı", "Şirket Sunumu"
   - Değerleme → "Değerleme Raporu"; halka arz → "İzahname", "Fiyat Tespit Raporu"
3. **Ek bağlantısını al**: `get_kap_detail(id)` çıktısındaki `attachments[].url`.
4. **İndir**: `save_kap_attachment({ url, symbol, name })`. `name` için "2026-2C-finansal-rapor.pdf" gibi dönem içeren kısa bir ad ver.
5. **Oku**: dönen `path`'i `pdf-okuma` becerisindeki yöntemle oku.

## Çıktı
- Hangi belgeyi, hangi tarihli bildirimden aldığını ve arşivdeki yolunu yaz.
- Belgeden alınan rakamlarda sayfa numarası ver ("Faaliyet raporu s. 42").
- Önemli bulguları `save_memory` ile şirket notuna ekle.

KAP bildirimi bulunamazsa şirketin yatırımcı ilişkileri sayfasını WebSearch ile ara ve bağlantıyı kullanıcıya ver; indirme için onay iste.

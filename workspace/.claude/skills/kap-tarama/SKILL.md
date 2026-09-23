---
name: kap-tarama
description: KAP bildirimlerini tarayıp önem sırasına koyma ve tek bildirimi yorumlama. "KAP'ta ne var", "bildirimleri tara", bir KAP linki paylaşıldığında.
---

# KAP tarama

## Toplu tarama
1. Kapsamı belirle: izleme listesi (`get_watchlist`), portföy (`get_portfolio` → holdings) veya kullanıcının verdiği semboller.
2. `mcp__borsa__get_kap_disclosures` (symbols, days: varsayılan 3).
3. Her bildirimi sınıfla ve puanla:
   - **Yüksek**: finansal rapor (FR), sermaye artırımı (bedelli/bedelsiz), temettü kararı, birleşme/devralma, büyük sözleşme/ihale (piyasa değerinin >%2'si), SPK/BDDK kararı, işlem yasağı, pay geri alımı, ortaklık yapısı değişikliği, kredi notu.
   - **Orta**: yeni iş ilişkisi, yatırım kararı, borçlanma aracı ihracı, dava, yönetim değişikliği.
   - **Düşük**: rutin kupon ödemeleri, genel kurul duyuruları, faaliyet raporu yayımı, şirket içi atamalar.
4. Yüksek önemdekilerin metnini `WebFetch` ile (dönen `url`) oku; tutarları piyasa değeri ve son yıllık kârla oranla.
5. Çıktı: önem sırasına göre tablo — sembol, konu, tek cümlelik anlam, olası fiyat etkisi (olumlu/olumsuz/nötr ve neden). Kullanıcının pozisyonu varsa işaretle.

## Tek bildirim yorumu
- Ne oldu? (sayılarla)
- Şirket ölçeğine göre büyüklüğü (ciro/piyasa değeri/özkaynak oranı)
- Beklenti mi sürpriz mi? (önceki bildirimler ve haberlerle)
- Kısa ve orta vadeli olası etkiler; izlenecek sonraki adım (genel kurul tarihi, SPK onayı vb.)

---
name: tahmin-defteri
description: Analizlerde yapılan somut tahminleri kaydetme ve sonra isabetini ölçme. "Tahminimi kaydet", "geçmiş tahminler nasıl çıktı", "tahmin defteri" istendiğinde.
---

# Tahmin defteri

Kayıt dosyası: `tahminler.md` (çalışma alanı kökünde). Yoksa oluştur. Her satır bir tahmin:

| No | Tarih | Sembol | Tahmin | Başlangıç fiyatı | Hedef / koşul | Vade | Olasılık | Gerekçe | Durum |
|---|---|---|---|---|---|---|---|---|---|

## Kaydetme
- Yalnızca ölçülebilir tahminleri kaydet ("X, 3 ay içinde 400 TL üzerinde kapanış yapar", "Y'nin 3Ç net kârı yıllık %20+ artar").
- Başlangıç fiyatını `mcp__borsa__get_quotes` ile al; olasılığı yüzde olarak yaz.
- Dosyaya ekleme yapmak için kullanıcının onayını beklemek gerekebilir (dosya düzenleme izni).

## Değerlendirme
1. Vadesi gelen veya koşulu gerçekleşen satırları bul; `get_history` ile doğrula.
2. Durumu `✓ doğru`, `✗ yanlış`, `~ kısmen` olarak güncelle.
3. İsabet oranı ve Brier skoru (olasılık tahminleri için) hesapla; en çok yanılınan tahmin türlerini özetle.

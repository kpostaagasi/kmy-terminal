---
name: pdf-okuma
description: PDF okuma yöntemi. Kurum raporu, faaliyet raporu, finansal tablo dipnotları, yatırımcı sunumu veya kullanıcının eklediği herhangi bir PDF okunacağında kullan. Uzun belgelerde doğru sayfaları bulup grafik ve tabloları da inceler.
---

# PDF okuma

## 1. Belgenin haritasını çıkar
- Kısa PDF (≤ 20 sayfa): `Read` ile doğrudan oku.
- Uzun PDF: önce `Read` ile `pages: "1-5"` oku; içindekiler tablosundan ilgili bölümlerin sayfalarını bul. Sonra yalnız o sayfaları oku (tek çağrıda en fazla 20 sayfa).
- Metin katmanı hızlı taransın isteniyorsa ve kullanıcı Bash iznini verirse: `pdftotext -layout -f 1 -l 400 dosya.pdf - | grep -n -i "anahtar kelime"` ile aradığın bölümün sayfasını bul.

## 2. Görsel sayfalar
Grafik, tablo görüntüsü veya taranmış sayfalarda metin eksik çıkabilir. Bu sayfaları `Read` ile görsel olarak incele; grafikteki eğilimleri ve eksen değerlerini yaz, okunamayan değerleri tahmin etme.

## 3. Finansal belgelerde dikkat
- Dönem (çeyrek / 6 ay / yıllık) ve para birimi (bin TL / milyon TL) başlıktan teyit edilir.
- TMS 29 enflasyon düzeltmeli ve düzeltmesiz rakamlar karıştırılmaz.
- Dipnotlarda: borç vade yapısı, döviz pozisyonu, ilişkili taraf işlemleri, koşullu yükümlülükler, segment bilgisi.

## 4. Çıktı
- Her rakamın yanında sayfa numarası: "(s. 17)".
- Kurum raporlarında tavsiye, hedef fiyat, tahminler ve varsayımları ayrı bölümde ver; kendi görüşünü kurumun görüşünden ayır.

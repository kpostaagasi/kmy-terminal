# Veri doğruluğu: çapraz kaynak denetimi

Tarih: 2026-10-01 · Sürüm hedefi: 0.16.4

## Amaç
kmy terminal'in gösterdiği verileri bağımsız ikinci kaynaklarla karşılaştırıp sessiz sapmaları bulmak ve düzeltmek. Yeni özellikler (alt proje C) yanlış veri üzerine kurulmasın diye ilk adım budur.

Bağlam: ticari ürünleşme hedefi. Kısıtlar: ad küçük harf, rakip adı geçmez, kişisel veri git'e ve çıktıya girmez, UI metinleri `t()` üzerinden.

## Mimari
- Tek dosya: `scripts/veri-denetimi.mjs`; komut `npm run denetim`.
- Uygulamanın kendi fonksiyonlarını (`getQuotes`, `fundamentals`, `fundQuote`, `financials`, `tcmbRates` vb.) doğrudan import eder; kullanıcının gördüğü yol test edilir.
- Referans değerleri bağımsız kaynaktan betik kendisi çeker.
- Her kontrol bir nesnedir: `{ ad, grup, uygulama(), referans(), tolerans }`. Sonuç: **OK**, **SAPMA** (tolerans dışı) veya **ATLANDI** (ağ yok, piyasa kapalı vb.).
- Çıktı: terminal tablosu; `--json` ile makine okunur. Herhangi bir SAPMA varsa çıkış kodu 1.
- Geçici `BORSA_DATA_DIR` kullanır; gerçek veriye yazmaz.
- `npm test` zincirine eklenmez (canlı ağ gerektirir); ayrı komuttur.

## Kontrol grupları

| Grup | Uygulama | Referans | Tolerans |
|---|---|---|---|
| Döviz | USDTRY, EURTRY | TCMB günlük kur | %0,5 |
| Altın | GRAM | ONS × USDTRY ÷ 31,1035 | %1 |
| Altın türleri | ÇEYREK / YARIM / TAM | saflık × gram (makas payı) | %3 |
| Hisse fiyatı | 5 BIST sembolü (Yahoo) | İş Yatırım | %1,5 |
| TEFAS | `fundQuote` | son `fundPrices` kaydı | tam eşleşme |
| Temel oranlar | FAVÖK, marj, F/K | ham mali tablo satırlarından yeniden hesap | %0,5 |
| Tazelik | tüm kaynaklarda `time` ve `delayed` | beklenen yaş | kaynağa göre |
| Portföy (`--portfoy`) | toplam değer | Σ adet × fiyat × kur, bağımsız hesap | %0,1 |

- Portföy kontrolü gerçek veritabanını salt okunur açar; çıktıya yalnız sapma yüzdesi yazılır, kişisel veri yazılmaz.
- Bankalar için FAVÖK atlanır (mevcut davranış).
- Piyasa kapalıyken hisse kontrolü kapanış fiyatıyla yapılır; gecikmeli veri için tolerans zaten %1,5.

## Düzeltme akışı
1. İlk çalıştırma sapma listesi üretir.
2. Her sapmanın kök nedeni bulunur (semptom değil, ortak fonksiyon düzeltilir).
3. Düzeltme + `test/` altına çevrimdışı regresyon testi.
4. CHANGELOG'a 0.16.4 notu.

## Kapsam dışı
Arayüzde veri sağlığı rozeti, sürekli çalışan doğrulayıcı, yeni veri kaynağı, KAP/kurum hedefi/endeks kontrolleri (sonraki tura).

## Başarı ölçütü
`npm run denetim` ağ açıkken çalışır, her grup için OK/SAPMA/ATLANDI üretir; bulunan sapmaların hepsi düzeltilmiş veya gerekçesiyle kayda geçmiş olur; `npm test` yeşil kalır.

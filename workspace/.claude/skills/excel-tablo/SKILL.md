---
name: excel-tablo
description: Excel ve CSV dosyalarıyla çalışma. Kullanıcı .xlsx / .xls / .csv / .tsv dosyası eklediğinde (aracı kurum ekstresi, portföy dökümü, model, veri tablosu) veya çıktının Excel olarak istenmesi durumunda kullan.
---

# Excel ve tablo dosyaları

`Read` aracı .xlsx dosyasını açamaz. Python (pandas, openpyxl) yüklü; Bash ile kullan (komut kullanıcı onayı ister).

## Okuma
1. Önce yapıyı gör:
   ```
   python3 -c "import pandas as pd; x=pd.read_excel('uploads/…/dosya.xlsx', sheet_name=None, header=None); [print(k, v.shape, v.head(15).to_string(), sep='\n') for k,v in x.items()]"
   ```
2. Başlık satırını bulduktan sonra `header=<satır>` ile yeniden oku; sayı biçimlerini (1.234,56) ve tarihleri kontrol et.
3. Birleştirilmiş hücreler ve ara toplam satırlarını analizden çıkar.

## Aracı kurum ekstresi → portföy
İşlemleri portföye aktarmak için CSV'ye çevir: `tarih, işlem, sembol, adet, fiyat, komisyon, para birimi, platform` sütunlarıyla `reports/ice-aktar.csv` yaz ve kullanıcıya **Portföy › İçe / Dışa Aktar** ekranından önizleyerek içe aktarmasını söyle. Doğrudan `add_transaction` ile toplu ekleme yapma; her işlem onay ister ve hata riski yüksektir.

## Yazma
- Tablo çıktısı: `pandas.DataFrame.to_excel('reports/<ad>.xlsx', index=False)`; sütun genişliklerini openpyxl ile ayarla.
- Formül gereken modeller: openpyxl ile formülleri hücreye yaz (değer yerine `=B2*C2`), girdileri ayrı bir "Varsayımlar" sayfasında tut. DCF için hazır betik: `scripts/dcf_excel.py` (bkz. `dcf-degerleme`).
- Dosyayı `reports/` altına kaydet; Raporlar sekmesinden indirilebilir.

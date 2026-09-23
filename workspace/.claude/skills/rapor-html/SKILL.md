---
name: rapor-html
description: Analizleri Raporlar paneline okunaklı HTML rapor olarak kaydetme şablonu. Rapor, özet belge, "kaydet" istendiğinde.
---

# HTML rapor şablonu

`mcp__borsa__save_report` ile `format: "html"` gönder. `<html>` etiketi olmadan yalnızca gövde içeriği verirsen terminalin rapor stili (`/report.css`) otomatik uygulanır. Kullanılabilir sınıflar:

- `.meta` — başlık altı bilgi satırı
- `.kpis > .kpi > .l + .v` — öne çıkan rakam kartları
- `table` + `td.num` — sayısal tablolar (sağa hizalı)
- `.up` / `.down` — pozitif/negatif renk
- `.callout`, `.callout.risk` — vurgu kutuları
- `.disclaimer` — alt not

## İskelet

```html
<h1>ASELS — Kapsamlı Analiz</h1>
<p class="meta">23.09.2026 · Fiyat 380,50 TL (Yahoo, gecikmeli) · Hazırlayan: Borsa Terminali ajanı</p>

<div class="callout"><b>Özet görüş:</b> …tek paragraf…</div>

<div class="kpis">
  <div class="kpi"><div class="l">Piyasa değeri</div><div class="v">…</div></div>
  <div class="kpi"><div class="l">F/K</div><div class="v">…</div></div>
</div>

<h2>1. İş modeli</h2> …
<h2>2. Finansallar</h2> <table>…</table>
<h2>3. Değerleme</h2> …
<h2>4. Teknik görünüm</h2> …
<h2>5. Katalizörler ve riskler</h2> <div class="callout risk">…</div>
<h2>6. Senaryolar</h2> <table>…</table>

<p class="disclaimer">Bu rapor bilgilendirme amaçlıdır; yatırım tavsiyesi değildir. Veriler: …</p>
```

## Grafikler
Harici kütüphane yok; basit grafikleri satır içi SVG ile çiz (çizgi için `<polyline>`, çubuk için `<rect>`). Eksen etiketlerini ve birimi yaz. `viewBox` kullan, sabit genişlik verme.

## Kurallar
- Her tabloda veri kaynağı ve tarih.
- Sayılar Türkçe biçimde (1.234,56), yüzdeler işaretli (+3,2%).
- Rapor başlığı kısa ve sembol içersin; `symbols` alanını doldur.

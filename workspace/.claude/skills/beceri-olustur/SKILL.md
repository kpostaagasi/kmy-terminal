---
name: beceri-olustur
description: Yeni beceri (skill) oluşturma veya mevcut beceriyi iyileştirme. Kullanıcı "şunu her seferinde böyle yap", "bunun için bir beceri yaz", "şu beceriyi güncelle" dediğinde veya tekrar eden bir iş akışı fark edildiğinde kullan.
---

# Beceri oluşturma

Beceriler `.claude/skills/<ad>/SKILL.md` dosyalarıdır. Ajan açıklamaya bakarak beceriyi ne zaman kullanacağına karar verir.

## Adımlar
1. **Amacı netleştir**: beceri hangi işi, hangi girdiyle, hangi çıktıyı üretecek? Kullanıcıdan 2–3 gerçek örnek istek al.
2. **Ad**: kısa, Türkçe, küçük harf ve tire (ör. `bilanco-ozeti`). Var olan becerilerle çakışmasın (`ls .claude/skills`).
3. **Ön bilgi (frontmatter)**:
   ```
   ---
   name: bilanco-ozeti
   description: Ne yaptığı + ne zaman kullanılacağı. Tetikleyici ifadeleri say ("bilançoyu özetle", "çeyrek sonuçları").
   ---
   ```
   Açıklama becerinin bulunmasını sağlar; somut tetikleyiciler yaz.
4. **Gövde**: numaralı iş akışı; hangi `mcp__borsa__*` aracının hangi adımda çağrılacağı; çıktı biçimi (tablo sütunları, rapor bölümleri); kurallar (kaynak, dönem, birim).
5. **Kısa tut**: 60 satırı geçmesin. Uzun arka plan bilgisi `knowledge/` altına ayrı dosya olarak yazılır ve becerinin içinden adıyla anılır.
6. **Dene**: kullanıcının örnek isteklerinden biriyle beceriyi çalıştır, sonucu birlikte değerlendir, gerekirse açıklamayı ve adımları düzelt.

Dosya yazmak için kullanıcı onayı gerekir; değişikliği yapmadan önce taslağı sohbette göster.

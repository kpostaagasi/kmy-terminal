# Takvim

Kişisel terminalde, tarihli piyasa olaylarının tek listesi. Bir olayı ne zaman göstereceği ile kullanıcıya nasıl haber vereceği ayrı şeylerdir.

## Language

**Takvim olayı**:
Takvim sayfasında bir güne bağlı olgu. Bir takvim günüdür. Saat taşımaz. Temettü, sermaye artırımı, TCMB günü, bilanço veya TÜFE olabilir.
_Avoid_: hatırlatıcı, bildirim, etkinlik, alarm

**Kapsam**:
Takvim olayının hangi sembol kümesine göre süzüldüğü: Listem, Portföyüm veya Tümü. Sembolsüz olay kapsama bakmaz.
_Avoid_: filtre, tür, ekran

**Tür**:
Takvim olayının süzgeç grubu: temettü, sermaye artırımı, TCMB, bilanço, TÜFE.
_Avoid_: tip, kategori, kapsam

**Kesin**:
Tarih yayımlanmış bir kaynaktan okunmuştur. Hesaplanmamıştır.
_Avoid_: kesinleşmiş, resmî (sıfat olarak; kaynak resmî olsa da hesaplanan tarih kesin değildir)

**Tahmini**:
Tarih hesaplanmıştır (geçen yılın günü veya yasal süre). Resmî tatil kaydırması tahmini tarihi kesin yapmaz.
_Avoid_: yaklaşık, beklenen (bu sözcük olay türüdür, kesinlik değildir)

**Resmî tatil**:
2429 sayılı kanunda adı geçen tam gün. İş günü hesabını kaydırır. Yarım gün değildir.
_Avoid_: arife, yarım gün, idari tatil, köprü

**Arife**:
Dini bayramdan önceki yarım gün. 28 Ekim öğleden sonrası aynı sınıftır. Resmî tatil değildir. Kaydırmaz.
_Avoid_: tatil, yarım iş günü

**İdari tatil**:
Genelgeyle ilan edilen köprü günü. Resmî tatil değildir. İş günü hesabını kaydırmaz.
_Avoid_: resmî tatil, bayram

**TÜFE olayı**:
Tarihi resmî veri yayın takviminden okunan Takvim olayı. Kendi türüdür. TCMB olayı değildir. Her kapsamda görünür. Yalnızca güncel okumada dönen tarih vardır. Okuma başarısızsa olay yoktur.
_Avoid_: enflasyon günü, TÜİK olayı

**Alarm**:
Fiyat, temettü veya KAP eşiği. Koşul sağlanınca kilitlenir, koşul bozulunca yeniden kurulur.
_Avoid_: hatırlatıcı, takvim olayı, sinyal bildirimi, veri uyarısı

**Sinyal bildirimi**:
Seans kapandıktan sonra yeni belirmiş teknik sinyalin haberi.
_Avoid_: alarm, takvim olayı, hatırlatıcı, veri uyarısı

**Zamanlanmış görev**:
Saatinde çalışan ve rapor yazan ajan istemi.
_Avoid_: alarm, hatırlatıcı, takvim olayı, zamanlanmış denetim

**Dışa aktarma**:
Seçili kapsam ve türdeki, bugün ve sonraki Takvim olaylarının tek seferlik kopyası. Geçmiş günler dahil değildir. Tahmini olay kopyada da Tahmini kalır. Canlı bağ değildir.
_Avoid_: hatırlatıcı, alarm, abonelik

# Veri sağlığı

Uygulamanın gördüğü verinin, ikinci bir kaynakla karşılaştırılmasının kanıtı. İzleme değildir.

## Language

**Zamanlanmış denetim**:
Seans kapandıktan sonra kendini çalıştıran veri denetimi. Ajan istemi değildir.
_Avoid_: zamanlanmış görev, alarm, sinyal bildirimi

**Veri uyarısı**:
Zamanlanmış denetimin sapma bulduğuna dair haber. Rozetin kendisi değildir.
_Avoid_: alarm, sinyal bildirimi, hatırlatıcı, takvim olayı

**Eski**:
Vadesi gelmiş bir denetim penceresi açılmış ve o pencerede bitmiş koşu yoktur. Duvar saatiyle 24 saat geçmiş olması değildir.
_Avoid_: bayat, süresi dolmuş

# Dengeleme

Hedef ağırlığa göre alım ve satım önerisi. Emir değildir.

## Language

**Vergi tahmini**:
Önerilen satıştaki verginin oransal tahmini. Komisyon değildir.
_Avoid_: komisyon, kesinti

**Komisyon tahmini**:
Önerilen hisse veya ETF işleminin, yuvarlanmış TL tutarı üzerinden hesaplanan aracılık bedeli. Adedi değiştirmez. Vergi değildir. Emir değildir. Oran boşsa tahmin yoktur. Sıfır yazılmaz. Emir başına taban yoktur.
_Avoid_: vergi, BSMV, ücret, masraf

**Komisyon oranı**:
Alım ve satışta aynı, kullanıcının girdiği tek yüzde. Kesir değildir. Platform başına değildir.
_Avoid_: binde, kesir, platform oranı

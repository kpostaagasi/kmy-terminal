# Sürüm Notları

## 0.13.0 — 29 Eylül 2026 (canlı fiyat, kurum raporu süzgeci, satış senaryosu)

### Yeni
- **Ekranda açık hisse canlı akar.** Sunucu yalnız izleme listesi ve piyasa şeridindeki sembolleri gönderiyordu; izleme listesinde olmayan bir hisseyi terminalde açtığınızda başlıktaki fiyat donuyordu. Arayüz artık baktığı sembolü sunucuya abone ediyor (bağlantı kopunca yeniden abone olunur) ve o sembol de canlı güncelleniyor.
- **Fiyat tazeliği göstergesi.** Alt durum çubuğunda "Fiyat 21:04" saati. Akış durursa (sunucu kapalı, ağ kesintisi, veri kaynağı hatası) saat turuncuya döner ve üzerine gelince kaç saniyedir güncellenmediği yazar. Sol panel yalnız Dashboard'da göründüğü için gösterge oraya değil her sekmede görünen durum çubuğuna kondu.
- **Sekmeye dönünce Özet tazelenir.** 5 dakikalık yenileme döngüsü sekme görünmezken duruyordu; görünür olunca fiyat, haber, KAP ve kurum raporları yeniden çekilir.
- **Kurum raporlarında "İzleme listem" / "Portföyüm" süzgeci.** Akış sekmesine iki düğme: yalnız kendi sembollerinizle ilgili raporlar listelenir. Örnek: 39 rapor → 5. Tekrar tıklama süzgeci kaldırır. Süzgeç sunucuda uygulanır, tarayıcı hepsini indirmez.
- **Portföyde "bugün satarsam" senaryosu.** Özet sekmesinde net eline geçecek tutar, stopaj kesintisi ve o andaki kâr/zarar tek satırda. Varlıklar tablosunda her pozisyonun K/Z hücresinin altında "satışa çevir ₺26.235"; üzerine gelince brüt tutar, kesinti ve kâr/zarar ayrıntısı. BIST hisselerinde stopaj uygulanır, yurt dışı varlık ve fonlarda uygulanmaz.
- **Hisse satış stopajı ayarı.** Ayarlar › Hesaplama › Hisse satış stopajı (varsayılan %10). Temettü stopajından ayrı tutulur.
- **oh-my-pi (omp) entegrasyonu iyileştirildi.** Kullanıcının kendi varsayılan omp modeli artık model seçicide görünüyor (`omp models --json` yüzlerce modeli elediği için o model listede çıkmıyordu ve o modelle konuşmak imkânsızdı). Model listesi artık bağlam penceresini ve modelin desteklediği düşünme seviyelerini de taşıyor; "düşünme seviyesi" seçicisi omp modellerinde de görünüyor (Claude'daki gibi sabit liste değil, modelin kendi `thinking` listesi). `/api/meta` model listesinin yüklenmesini bekliyor, ilk çağrıda seçici eksik kalıyordu.
- **omp'ta MCP köprüsü kendini onarır.** Proje klasörü taşınırsa `workspace/.omp/mcp.json` eski yolu gösteriyor ve 32 borsa aracı sessizce erişilemez oluyordu. Sunucu açılışında yol doğrulanıyor, gerekirse düzeltiliyor ve ne yapıldığı günlüğe yazılıyor.
- **Açık oturumun sağlayıcısı kilitliyken uyarı.** Oturumun sağlayıcısı sabittir; başka bir sağlayıcı seçilirse mesaj sessizce eski sağlayıcıya gider. Artık "Açık oturum Claude Code sağlayıcısında. oh-my-pi ile konuşmak için yeni oturum açın." uyarısı çıkar.
- **Araç etiketleri tutarlı.** omp ve Codex tarafında diğer MCP sunucularının araçları `mcp__sunucu__arac` biçiminde ham görünüyordu; artık "sunucu › araç" olarak okunuyor. `xd://mcp__` yolu ayrıştırması yalnız `borsa` ile sınırlı değil, alt çizgi içeren suncu adlarını da doğru çözüyor.

### Düzeltilen
- Kurum raporu akışında aynı raporun İngilizce ve Türkçe kopyaları ayrı ayrı listeleniyordu ("ASELS Company Report" / "ASELS Şirket Raporu"). Aynı kurum + sembol + gün kombinasyonundaki tekrarlar eleniyor; 30 günde 42 kayıt 39 rapora indi.
- Bazı raporlara "2026" gibi yıl dizileri BIST sembolü sanılıyordu ("MAVI.IS: 2Ç26 Kar Tahmini" → semboller "MAVI, 2026"). Uyarlayıcılardan gelen kodlar artık gerçek BIST kodlarına karşı süzülüyor.
- Ziraat Yatırım raporlarının başlığına sayfalama izi bulaşıyordu ("ASELS 2Ç26 1 2 3 4 5 6 7 Toplam 132 dosya bulundu"). Başlık temizleniyor.

### Düzeltilen (arayüz çapraz doğrulama)
- **Sohbet alt çubuğu taşması:** dar panelde TURNS ve CTX göstergeleri ekran dışında kalıyordu (1280 px'de 202 px). Satır artık gerektiğinde iki satıra sarıyor; ctx metni tur sonrası büyüdüğünde de yeniden ölçülüyor.
- **Piyasa şeridi kırpılması:** sığmayan hücreler sağdan gizleniyor. 1920→500 px arasında 12'den 4'e düşüyor, hiçbir hücre yarım görünmüyor.
- **Temettü takviminde 24 boş hücre:** verim sütunu yalnız izleme listesindeki sembollerde doluyordu. Eksik semboller tek toplu istekle çekiliyor; hesaplanamayan hücre artık "—" gösteriyor.
- **Kurum raporu akışında 52 rapora ulaşılamıyordu:** liste 200 ile sınırlıydı. KAP panelindeki "Daha fazla yükle" düğmesi akışa da eklendi (200 → 252).
- **KAP tarih biçimi tutarsızdı:** liste "29.09.2026", detay "2026.09.29" dönüyordu. Sunucu artık tek biçim üretiyor.
- **Para birimi dağılımı dil sızıntısı:** İngilizce arayüzde Türkçe anahtar ("Altın") görünüyordu.
- **Aylık temettü etiketleri UTC kayması:** uygulama 00:00–03:00 arasında açıldığında tüm etiketler bir ay geri kayıyordu.
- **"Bugün" UTC ile hesaplanıyordu:** aynı saat aralığında takvim dünkü olayları çekiyor, yaklaşan temettüleri geçmiş gibi işaretliyordu.
- **Ayar kaydı sessizce kayboluyordu:** Claude model seçimi `claudeModel` anahtarına yazılıyordu, sunucu `model` bekliyor.
- **Tarih/zaman biçimlendiricileri:** geçersiz tarihte "Invalid Date", eksik başlangıçta "497418h 38m" gösteriyordu.
- **Açık tema okunabilirliği:** ikincil metin 3.16:1 ile AA'nın altındaydı, tablo/kart çizgileri 1.31:1 ile görünmezdi. Metin 4.63:1, çizgiler 3.08:1. Koyu tema de iyileştirildi (metin 3.33→4.53, çizgi 1.20→3.03).
- **Açık tema grafik renkleri:** dağılım grafiğinde 4 dilim beyaz zeminde görünmezdi (1.54:1). Seri renkleri temaya bağlandı, en düşük oran 3.74:1.
- **KAP 31 gün uyarısı:** kapsam "Tüm şirketler"e çevrilirken uyarı çıkmıyor, sonuç sessizce kırpılıyordu.
- **Düzen bozulmaları:** KAP bilgi satırı İngilizce arayüzde iki satıra bölünüyor, ayarlar alt bilgisi "Esc"u yalnız satırda bırakıyordu.
- **Yinelenen `id`:** "İzleme listem" ve "Portföyüm" düğmeleri aynı `id`yi kullanıyordu; süzgeç işleyicisi yalnız ilkini buluyordu.
- **Eksik kurum renkleri:** Gedik ve Halk raporları gri nokta ile görünüyordu.
- **Takılı kalan araç kartı:** tur bitince "çalışıyor" yazıp dönen çarkıp kalıyordu.
- **Bağlam satırı:** 90 karakteri aşınca kelime ortasından kesiliyor, "…" eklenmiyordu.


## 0.12.0 — 27 Eylül 2026 (terminal görünümü, kmy terminal sekmesi)

### Yeni
- **kmy terminal sekmesi** (eski Piyasa sekmesinin yerine): hisse kodu arama, fonksiyon tuşları ve komut satırı olan temel analiz terminali. Sayfalar: **1) Özet** (fiyat grafiği, istatistikler, teknik ve temel veriler, haberler, KAP, kurum raporları, notlar, belgeler, temettü), **2) Finans** (gelir tablosu, bilanço, çeyreklik / kümülatif mali tablolar), **3) Skor** (kârlılık, büyüme, finansal sağlık, değerleme ve momentum puanları, 8 maddelik kalite kontrol listesi), **4) Değer** (sektör ve BIST 100 medyan çarpanlarıyla adil değer aralığı, Graham sayısı, asistanla DCF), **5) Karş** (sektör benzerleriyle karşılaştırma tablosu ve göreli performans grafiği). Ana ekranda son arananlar, popüler hisseler, hisse tarayıcı, sektör haritası ve piyasa özeti. Klavye: 1–5 sayfa, Esc ana ekran, / komut satırı (`THYAO`, `THYAO SKOR`, `TARA`, `YARDIM`…).
- Sohbet, kmy terminal ve Portföy sekmelerinde sağ panelde (Asistan sohbeti sekmesi) açık kalır; hızlı başla önerileri sekmeye göre değişir.

### Değişen
- **Terminal görünümü:** siyah zemin, turuncu vurgu, mono büyük harfli etiketler, ince çizgiler. Sekmeler DASHBOARD / KMY TERMINAL / PORTFÖY; üst çubukta gateway durumu; altında sabit piyasa şeridi (XU100, XU030, döviz, altın, Brent, BTC, S&P 500); en altta sürüm, veri kaynakları, seans durumu ve saat.
- İzleme listesi sade satırlar (sembol · fiyat · değişim · ×); sembol ekleme alanı listenin altında.
- Mesaj kutusu: üst satırda oturum, model, düşünme seviyesi, maliyet, tur ve bağlam; karşılama ekranında KMY logosu ve hızlı başla satırları.
- KAP listesi: solda sinyal rozeti (TEZ · YAP · FİN · KUR · DİĞ), turuncu hisse kodu, sağda tarih; sinyal filtreleri üstte.
- Kurum raporu akışında her satırda Analiz et / İndir düğmeleri.
- Varsayılan imza rengi turuncu (eski varsayılan sarı kullanılıyorsa bir kez turuncuya taşınır; Ayarlar › Görünüm'den değiştirilebilir).
- Sağ panel, ayırıcıdaki « / » tutamacıyla da gizlenip açılır.

## 0.11.0 — 24 Eylül 2026 (sade arayüz, İngilizce)

### Yeni
- **İngilizce arayüz:** Ayarlar › Görünüm › Dil ile Türkçe ya da İngilizce seçilir; varsayılan "Sistem dili" (macOS dili Türkçe değilse İngilizce açılır). Sunucudan gelen iletiler, seans durumu, sektör adları, macOS menüleri ve menü çubuğu simgesi de seçili dili izler; asistan da yanıtlarını arayüz dilinde verir.
- Eğik çizgi komutlarının İngilizce karşılıkları (/new, /analyze, /market…); Türkçe komutlar her iki dilde de çalışır.

### Değişen
- **Sade, yumuşak görünüm:** sekmeler üst çubuğa taşındı (tek satır), büyük harfli ve harf aralıklı başlıklar yerine normal yazım, daha az çizgi ve kenarlık, yumuşatılmış renkler, yuvarlatılmış kartlar ve pencereler, çizgi simgeler, ortalanmış sohbet sütunu, sağa hizalı kullanıcı mesajları, sade bildirimler.
- Garip duran metinler düzeltildi: WATCHLIST → İzleme listesi, DASHBOARD → Piyasa, AGENT CHAT kaldırıldı, CHAT / TERMINAL → Sohbet / Kabuk, "ajan" → "asistan"; kısaltmalar açıldı (52H → 52 hafta, 1A/3A → 1 ay / 3 ay), terimler tutarlı hâle getirildi, "..." → "…".
- KAP sinyal etiketleri: TEZ / YAP / FİN / KUR / DİĞER → Tez / Yapı / Finans / Kurumsal / Diğer.
- Veri kaynakları notu izleme listesinin altında katlanabilir.

## 0.10.0 — 23 Eylül 2026 (macOS görünümü, kuruluma hazırlık)

### Yeni
- ⌘ (Ctrl) basılı tutulunca TERMINAL / DASHBOARD / PORTFÖY sekmelerinin adının sağında ⌘1 · ⌘2 · ⌘3 kısayol etiketi yumuşakça belirir (yazıyı örtmez).
- **macOS görünümü:** pencere düğmeleri üst çubuğun içinde; üst çubuğun ve sekme çubuğunun boş yerinden pencere sürüklenir, çift tıklama sistem ayarına göre büyütür / küçültür. Yan panellerde macOS kenar çubuğu dokusu (yarı saydam), sistem yazı tipi, macOS kaydırma çubukları, macOS tarzı imleç; pencere etkin değilken üst çubuk solar; tam ekranda düzen uyarlanır; WebKit'in "Yeniden yükle / Öğeyi incele" sağ tık menüsü gizlendi.
- DMG ile ilk açılışta uygulama Uygulamalar klasörü dışından çalışıyorsa oraya taşımayı önerir (taşı ve yeniden aç).
- Claude Code kurulu değilse sohbet ekranı ilk açılışta nasıl kurulacağını gösterir.

### Değişen
- AGENT CHAT mesaj kutusu: 📎 yerine ince çizgili ataç simgesi, gönder / durdur düğmeleri de çizgi simge; model seçicide yalnız model adları ("Opus 5.5", "Sonnet 5", "GPT-6 Astra"; tam ad üzerine gelince) ve o an kullanılan model seçili görünür: açık oturumun modeli, yoksa sağlayıcının gerçek varsayılanı (Claude Code, Codex ve oh-my-pi ayarlarından okunur); "Varsayılan" seçeneği kaldırıldı. Seçiciler seçili yazı kadar genişlikte.
- AGENT CHAT'ten plan modu kaldırıldı (PLAN düğmesi ve `/plan` komutu); izin modu Ayarlar › Bağlantı › Agent varsayılanlarından gelir.
- Claude Code aranırken yalnız PATH değil yaygın kurulum yerleri de taranır (resmî kurulum, Homebrew, npm, nvm, volta, bun); kullanıcının kabuğu etkileşimli olarak okunur (.zshrc / .bashrc'deki PATH ayarları dahil).
- Giriş yapılmamış Claude hesabı, eski Claude Code sürümü ve kullanım sınırı hataları anlaşılır Türkçe yönlendirmeyle gösterilir.
- 7420 portu başka bir programdaysa uygulama boş bir portu seçip hatırlar.
- Uygulama başka bir klasöre taşındığında arka plan servisi yeni konuma göre kendiliğinden yeniden kurulur.

## 0.9.0 — 23 Eylül 2026 (tam otomatik veri, menü çubuğu)

### Yeni
- **TEFAS fonları otomatik:** yatırım ve emeklilik fonlarının günlük birim fiyatı, günlük değişimi, fiyat grafiği ve fon adı araması TEFAS'tan kendiliğinden gelir. Portföy değerlemesi, watchlist ve sembol arama fonları doğrudan tanır; elle fiyat girmek gerekmez.
- **Menü çubuğu simgesi:** gateway çalıştığı sürece menü çubuğunda kmy terminal logosu görünür. Menüde gateway durumu, sürüm, çalışma süresi, çalışan ajan işleri, sembol arama, yeni oturum, yeniden başlatma ve loglar var.
- Pencere kapatılınca uygulama menü çubuğunda çalışmayı sürdürür (Dock'tan kalkar). Gateway servis olarak kuruluysa oturum açılışında menü çubuğunda kendiliğinden başlar; ⌘Q uygulamayı menü çubuğuna çeker, tamamen çıkış menü çubuğundaki "Gateway'i Durdur ve Çık" ile.

### Değişen
- Elle veri adımları kaldırıldı: "Fon fiyatlarını güncelle" zamanlanmış görevi ve `/fonlar` komutu yok (fiyatlar otomatik); kurum raporu akışındaki elle yenile düğmesi yerine liste 30 dakikada bir kendiliğinden güncellenir ve açık ekran yenilenir; DASHBOARD'da seçili hissenin haberleri, KAP bildirimleri ve kurum raporları 5 dakikada bir yenilenir.
- Kurum raporu klasör izleme varsayılan olarak açık (İndirilenler klasörüne düşen aracı kurum raporları dakikada bir arşive alınır).
- Elle fiyat yalnız otomatik kaynağı olmayan varlıklar (mevduat, özel ürün) için kaldı.

### Düzeltilen
- DASHBOARD: orta alan dar olduğunda yan yana kartlardaki tablolar (temettü ve sermaye artırımları, günün hareketlileri, temettü takvimi) kart dışına taşıp kesiliyordu. Kartlar artık orta alanın genişliğine göre alt alta diziliyor; temettü / sermaye artırımı kartı sade bir listeye dönüştü (tarih, olay, hisse başı tutar, toplam).
- Menü çubuğundan "Gateway'i Durdur ve Çık" sonrası uygulama yeniden açıldığında "Gateway'e ulaşılamadı" hatası çıkıyordu (durdurulan servis yeniden yüklenmiyordu). Uygulama artık servisi önce yükleyip sonra başlatıyor.
- AGENT CHAT › Oturumlar penceresi: tablo taşıyor ve düğmeler kesiliyordu. Artık tarihe göre gruplu (Bugün, Dün, Bu hafta…) bir liste; satıra tıklayınca oturum açılır, yeniden adlandır / indir / sil satır sonunda simge olarak durur, üstte arama ve yeni oturum düğmesi var.

## 0.8.0 — 23 Eylül 2026 (kmy terminal)

### Yeni
- Uygulamanın adı **kmy terminal** oldu (arayüz, macOS uygulaması, `kmy` komut satırı, servis).
- **Kuruluma hazır DMG** (`npm run dmg`): Node, sunucu, arayüz ve bağımlılıklar uygulamanın içinde; başka bir Mac'e sürükle-bırak ile kurulur. Veriler `~/Library/Application Support/kmy terminal` altında tutulur, ilk açılışta çalışma alanı (ajan talimatları, beceriler, alt ajanlar) hazırlanır ve sürüm yükseldikçe güncellenir.
- Gateway menüsünde **Arka Planda Çalıştır (servis)**: uygulama kapalıyken de zamanlanmış görevler ve KAP takibi sürer.

### Değişen
- Claude Code uygulamaya gömülü gelmez: ajan, bilgisayarda kurulu `claude` programını kullanır. Kurulu değilse sohbette nasıl kurulacağını anlatan bir mesaj çıkar.

## 0.7.0 — 23 Eylül 2026 (macOS uygulaması)

### Yeni
- **macOS uygulaması** (`npm run mac`): Swift + AppKit ile yazılmış yerel kabuk, ~1 MB. Dock, Spotlight ve Launchpad'den açılır; pencere çubuğu temaya uyar, pencere konumu hatırlanır.
- Uygulama açılışta gateway'i hazırlar: servis kuruluysa onu kullanır, değilse sunucuyu kendisi başlatır; ulaşılamazsa "Tekrar dene / Logları aç" ekranı gösterir.
- Yerel menüler ve kısayollar: ⌘N yeni ajan oturumu, ⌘K sembol ara, ⌘1–3 sekmeler, ⌘\ sağ panel, ⌘, ayarlar, yakınlaştırma, Gateway menüsü (durum, yeniden başlat, loglar).
- macOS bildirimleri, Dock rozetinde çalışan ajan işi sayısı, ~/Downloads'a indirme ve Finder'da gösterme, dosya seçme penceresi; dış bağlantılar varsayılan tarayıcıda açılır.

## 0.6.0 — 23 Eylül 2026 (görünüm yenilemesi)

### Yeni
- **İmza rengi** ayarlanabiliyor (Ayarlar › GÖRÜNÜM); varsayılan artık sarı. Açık temada okunabilirlik için otomatik koyulaştırılıyor.
- **Esc** tuşu çalışan ajan yanıtını her yerden durduruyor (pencere açıkken veya kabuk odaktayken hariç).
- **oh-my-pi (omp)** üçüncü ajan sağlayıcısı: model listesinde Claude ve Codex'in yanında; borsa araçlarına MCP ile bağlı, oturum devam ettirme, durdurma ve izin kartları çalışıyor. Maliyet abonelikten düşüyor.
- **Ayarlar** penceresi yenilendi: sol menü, gruplanmış kartlar, anahtar ve seçim düğmeleri, durum etiketleri, imza rengi seçici (9 hazır renk + özel renk).

### Değişen
- AGENT CHAT mesaj kutusu sadeleşti: yazı alanı üstte; model, efor ve PLAN altta küçük düğmeler; maliyet, tur ve bağlam kullanımı kutunun altında ince bir durum satırında. Oturum seçimi AGENT CHAT başlığına taşındı.
- KOMİTE satırı yalnızca alt ajanlar çalışırken görünüyor.
- `/` komut menüsü yenilendi: komutlar Analiz / Oturum / Ajan / Bilgi başlıklarında, argüman etiketi, kısa adlar ve klavye ipuçlarıyla.
- Ayarlar › Bağlantı: harici MCP erişimi tek satıra indi (komut Kopyala ile alınıyor).
- Watchlist yenilendi: sembol rozetleri, dolgulu mini grafik, renkli değişim etiketi, arama simgeli ekleme kutusu.
- Genel görünüm: yeni renk paleti, yumuşak köşeler, odak halkaları, sekme ve düğme stilleri, ince kaydırma çubukları.

### Düzeltilen
- Yanıt başlamadan durdurulan turlar artık "Tamamlanamadı … [ede_diagnostic]" hatası göstermiyor; "Durduruldu" olarak kaydediliyor. Claude boş yanıt dönerse otomatik yeniden deneniyor, olmazsa önceki konuşma özetiyle yeni oturum açılıyor. Ham teknik hata mesajları kullanıcıya gösterilmiyor.
- Devam ettirilen oturumlarda tur maliyeti önceki turlarla birlikte iki kez sayılıyordu; artık yalnız o turun maliyeti ekleniyor.

## 0.5.0 — 23 Eylül 2026 (yeni düzen)

### Yeni
- **kmy gateway:** sunucu arka plan servisi olarak kurulabiliyor (macOS LaunchAgent, Linux systemd --user); oturum açılınca başlıyor, çökünce yeniden açılıyor.
- `borsa` komut satırı: `gateway install / uninstall / start / stop / restart / status / logs / token / open` (kurulumda `--dry-run`). `scripts/install.sh` ile tek komutta kurulum (tekrar çalıştırılabilir, sudo gerekmez).
- Yerel API güvenliği: tüm `/api` istekleri ve WebSocket erişim anahtarı istiyor (tarayıcıda otomatik çerez, betiklerde `Authorization: Bearer`); yabancı Host / Origin istekleri reddediliyor (DNS rebinding koruması).
- Ayarlar › SİSTEM › Gateway: durum, mod, PID, çalışma süresi, portlar, oturum / istemci sayısı; erişim anahtarını göster / kopyala / yenile; yeniden başlat, servis modunda durdur. Port ayarı: `BORSA_PORT` / `BORSA_REPORT_PORT`.
- **Mali özet** (DASHBOARD): özet gelir tablosu (son dönem ve geçen yılın aynı dönemi), özet bilanço (son iki çeyrek) ve son 5 çeyreğin satış, FAVÖK ve net kâr grafikleri. Ayrıntılı tablo "Mali tablolar · Detay" altında.
- KAP panelinde **↻ yenile** düğmesi: önbelleği atlayıp KAP'tan hemen çeker (en sık 20 saniyede bir).
- **Sembol arama** yenilendi: son arananlar ve watchlist kısayolları, BIST ve diğer piyasalar ayrı gruplarda, anlık fiyat, eşleşen metin vurgusu, klavye ipuçları.
- **AGENT CHAT** yeni görünüm: KOMİTE satırı (alt ajanlar ve çalışanlar), alt ajan mesaj kartları ("main → denetci", "denetci → main"), araç çağrıları tek satırda katlanıyor ("12 sn çalıştı ▸ · 5 araç"), mesajda saat ve maliyet.
- Mesaj kutusu: oturum, model (Claude ve Codex tek listede), efor, 📋 PLAN, arka plan işi, MALİYET, TUR, ctx çubuğu.
- Sağ panelde **PDF** sekmesi: raporlar burada açılıyor (ANALİZ / İNDİR / YENİ SEKMEDE AÇ / KAPAT).

### Değişen
- RAPORLAR akışında yalnızca **şirket raporları** var (şirket, bilanço değerlendirmesi, halka arz analist raporu); strateji, sektör, makro, teknik notlar ve toplu hedef fiyat listeleri gösterilmiyor. Ajan aracı tüm raporlara erişmeye devam ediyor.
- **PDF** sekmesi yalnızca bir rapor açıkken görünüyor; KAPAT veya sekmedeki ✕ ile kalkıyor.
- Yeni sekme düzeni: **TERMINAL** (varsayılan; ajan sohbeti, CHAT / TERMINAL düğmesiyle aynı sekmede kabuk), **DASHBOARD** (piyasa), **PORTFÖY**.
- Sağ panelde yalnızca **KAP**, **RAPORLAR** ve **PDF** var; TAKIM sekmesi KOMİTE satırına taşındı.
- Üst şerit kayıyor (üzerine gelince duruyor), kartlar tek satır genişliğine sığıyor; GBP/TL ve CHF/TL çıkarıldı.
- Ayarlar: BAĞLANTI / GÖRÜNÜM / VERİ / SİSTEM / HAKKINDA. Arayüz Modu: Chat (varsayılan) / Terminal (xterm.js).
- Terimler: WATCHLIST, AGENT CHAT, KOMİTE, "Mesaj yaz...", Ticker, Tüm Kurumlar, portföy sekmeleri büyük harf.

### Düzeltilen
- Bozuk kodlanmış adres isteği sunucuyu çökertmiyor.
- Sunucu yeni açıldığında Ayarlar penceresi boş değer göstermiyor.

### Kaldırılan
- Fiyat alarmları kaldırıldı.
- Sesle yazma düğmesi, bağlam çipleri ve mesaj kutusundaki fazla seçimler kaldırıldı (ekran bağlamı `/ekran` ile).

## 0.4.0 — 23 Eylül 2026 (ücretsiz veri kaynakları)

### Yeni
- **Aracı kurum raporları akışı** (Raporlar › Akış):
  - Kaynaklar: Garanti BBVA, AK, İş, Yapı Kredi, Ziraat, Vakıf, Tacirler, PhillipCapital, Integral ve A1 Capital'in herkese açık raporları.
  - 7G / 30G / 90G / Tümü, sembol, kurum ve tür filtreleri; YENİ etiketi.
  - Rapor uygulama içinde PDF olarak açılıyor; "Arşive kaydet" ve "Ajan ile analiz et" düğmeleri var.
  - Liste açılışta ve her 30 dakikada bir arka planda yenileniyor.
  - Hisse ekranında "Kurum raporları" kartı.
- **Mali tablolar** (İş Yatırım / KAP finansalları):
  - Son 8 çeyrek, çeyreklik veya kümülatif; satış, brüt kâr, FAVÖK, net kâr, nakit akışı, marjlar, net borç, özkaynak.
  - Bankalarda net faiz geliri, komisyon, karşılık, kredi ve mevduat.
- **Ekonomi haberleri:** Bloomberg HT, Foreks, Anadolu Ajansı, Dünya, Ekonomim, TRT Haber ve Investing TR RSS'leri. Hisse haberleri Google Haberler ile birleştirildi; piyasa ekranına "Ekonomi haberleri" kartı eklendi.
- **TCMB gösterge kurları:** döviz işlemlerinde kur boş bırakılırsa işlem gününün TCMB döviz satış kuru kullanılıyor.
- **TLREF (Borsa İstanbul):** Sharpe ve Sortino için risksiz faiz varsayılan olarak dönemin ortalama TLREF'i. Karşılaştırma ölçütlerine "TLREF (mevduat benzeri)" eklendi.
- **Yeni ajan araçları** (toplam 33): `get_broker_reports`, `read_broker_report`, `get_financial_statements`, `get_market_news`, `get_tcmb_rates`, `get_tlref`.

- **Gedik Yatırım** akışa eklendi: şirket, sektör/strateji ve model portföy raporları (herkese açık PDF'ler).
- **Halk Yatırım** açık yayınları akışa eklendi: haftalık "Analist Tavsiyeleri ve Hedef Fiyatları" (kapsanan tüm hisselerin tavsiye ve hedef fiyatı), halka arz değerlendirmeleri, Finansal Radar, yabancı işlemleri raporu.
- **Kurum raporu klasör izleme** (Ayarlar › Veri): kendi hesabınla indirdiğin raporlar (Halk şirket raporları, Deniz, Alnus, e-posta ekleri) İndirilenler klasöründen dakikada bir arşive alınır. Kurum ve semboller PDF'in ilk sayfasından tanınır, araştırma raporu olmayan PDF'ler atlanır. Varsayılan olarak kapalı.

### Kapsam dışı
- Halk Yatırım şirket raporlarının listesi müşteri girişi gerektiriyor. Deniz Yatırım bot korumalı, Alnus erişimi engelliyor. Bu kaynaklar klasör izlemeyle arşive alınabilir.

## 0.3.0 — 23 Eylül 2026

### Yeni
- **Araştırma hafızası**: ajan şirket ve konu notlarını `workspace/hafiza/` altında tutar. Mesajda geçen şirketin notu isteme otomatik eklenir. Hisse ekranında "Ajan notları" kartı (güncelle, sil).
- **Tetikleyici radarı hatırlatması**: izlenen tez varsa ve son tarama 7 günden eskiyse ajan yeni oturumda taramayı önerir. Radar becerisi kayıtlı tezlerin tetikleyicilerini güncel veriyle karşılaştırır.
- **Şirket belge arşivi**: KAP eklerini (faaliyet raporu, finansal rapor, sunum) `belgeler/<SEMBOL>/` klasörüne indirir. Hisse ekranında "Belgeler" kartı.
- **Uygulama içi PDF görüntüleyici**: KAP ekleri ve arşiv belgeleri uygulamanın içinde açılır. İndir, yeni sekmede aç, arşive kaydet ve "Ajan ile oku" düğmeleri var.
- **KAP şirket geçmişi**: sembolle 2 yıla kadar geriye bakılabilir. Liste, portföy ve sembol kapsamında 90 gün ve 1 yıl seçenekleri eklendi.
- **Alt ajanlar**: kıdemli analist, denetçi, araştırma asistanı ve makro stratejist.
- **Yeni beceriler**: şirket belgeleri, PDF okuma, Excel/tablo, yazı sesi (tweet, e-posta taslağı) ve beceri oluşturma. Toplam 14 beceri.
- **Formüllü DCF Excel modeli** (`scripts/dcf_excel.py`): Varsayımlar, DCF ve Duyarlılık sayfaları.
- **Çalışma kuralları** (`KURALLAR.md`) ve beceri haritası: araştırma tamlığı, varsayım denetimi, KAP çıktı biçimi, teslim biçimi, veri güvenliği, alt ajan kullanımı.
- **Sohbet**
  - Hızlı istemler açık ekrana göre değişir (portföy sekmesi, seçili hisse, açık rapor, açık KAP bildirimi).
  - `/yeni İSİM` ile oturuma ad verilebilir; oturumlar penceresinde arama var.
  - Sesle yazma düğmesi (işletim sistemi diktesi).
  - Argümansız `/kap` ajan maliyeti olmadan son sinyalleri gösterir.
  - Tur sonunda "Değişen dosyalar" kartı çıkar; efor seviyelerinin açıklaması ve tur sayısı gösterilir.
- **Ekip paneli**: biten alt ajanın çıktısı Haiku ile özetlenebilir.
- **Portföy**
  - K/Z katkısı (ilk 3).
  - Döviz cinsi varlıklarda K/Z, fiyat etkisi ve kur etkisi olarak ayrı gösterilir.
  - Ülke / piyasa dağılımı ve TL dışı (korunaklı) pay.
  - Değer grafiğinde net yatırılan çizgisi; çeyreklik getiri grafiği.
  - Temettü gelirinin yıl bazında sektör / varlık sınıfı / ülke kırılımı.
  - İşlem penceresinde platform nakit bakiyesi ve yetersiz bakiye uyarısı.
- **CSV içe aktarma**: aracı kurum başlıkları (Emir Tarihi, Kıymet, Gerçekleşen Adet, Ort. Fiyat, Kom.) otomatik tanınıyor. Tanınmayan sütunlar elle eşleştirilebiliyor. Aynı dosya yeniden yüklenirse daha önce kaydedilmiş satırlar atlanıyor.
- **Masaüstüne uygulama olarak kurma** (Chrome / Edge; başlıktaki ⤓ düğmesi).
- `npm test` 30 kontrole çıktı.

### Düzeltilen
- KAP tek istekte en fazla 2000 bildirim döndürdüğü için 7 ve 30 günlük listeler eksik kalıyordu (günde yaklaşık 400 bildirim var). Tarih aralığı artık bölünerek eksiksiz çekiliyor; geçmiş günler önbellekte tutuluyor.
- KAP ekleri Java sarmalı içinde geliyordu. Artık bu sarmal temizleniyor ve ek geçerli PDF olarak açılıp kaydediliyor.
- KAP tarih aralığı UTC ile hesaplanıyordu; gece 00.00–03.00 arasında o günün bildirimleri kaçabiliyordu. Artık İstanbul saatine göre hesaplanıyor.

## 0.2.0 — 23 Eylül 2026

### Yeni
- **Temel veriler** kartı (İş Yatırım, günlük): F/K, PD/DD, FD/FAVÖK, FD/Satış, piyasa değeri, halka açıklık, kurum tahminleri, dönem getirileri.
- **Hisse tarayıcı**: tüm BIST hisseleri; F/K, PD/DD, FD/FAVÖK, piyasa değeri, halka açıklık, yıl başından beri getiri, sektör ve endeks filtreleri; hazır filtreler. Ajan aynı taramayı `screen_stocks` aracıyla yapar.
- **Temettü takvimi** (Listem / Portföyüm / Tümü) ve sembol bazında temettü + sermaye artırımı geçmişi.
- **KAP sinyalleri**: bildirimler TEZ / YAP / FİN / KUR / DİĞER olarak sınıflanır; sayılı filtre çipleri, bildirim içeriği ve ekleri uygulama içinde, okundu takibi, "okundu say", daha fazla yükle.
- **Portföy**
  - 13 işlem türü: nakit giriş/çıkış, alış, satış, temettü, temettü yeniden yatırım, bedelsiz, bölünme, platformlar arası transfer, döviz çevirme, staking, faiz, masraf.
  - Platform × para birimi nakit takibi ve **kur farkı** (gerçekleşen / gerçekleşmeyen).
  - XIRR, devir hızı, özel tarih aralığı ve hızlı aralıklar.
  - Çoklu karşılaştırma: BIST 100, BIST 30, Dolar/TL, Euro/TL, gram altın, S&P 500 (TL), Bitcoin (TL).
  - Canlı fiyatı olmayan varlıklar (TEFAS fonu vb.) için elle fiyat; fiyat kaynağı etiketi (canlı / gecikmeli / manuel / son işlem).
  - Stopaj oranıyla brüt/net temettü, yaklaşan temettüler, veri uyarıları.
- **Sohbet**
  - Dosya ve görsel ekleme: 📎, sürükle-bırak, yapıştır (en fazla 10 MB).
  - Ajan soruları için seçenekli soru kartları, görev listesi kartı, plan modu çipi.
  - Bağlam çipleri: seçili sembol, portföy, ekranda açık olan (rapor, KAP bildirimi, sekme).
  - 28 `/` komutu; Türkçe adlar ve İngilizce takma adlar (`/help` ile listelenir).
  - Bağlam doluluk uyarısı (%80 / %95), hız sınırı bildirimi, uzun oturumlarda eski mesajları kademeli yükleme, yanıt kopyalama ve katlama.
- **Raporlar**: Ajan / Kurum ayrımı, kurum ve sembol etiketleri, kurum filtresi, sembol araması, tam ekran sunum.
- **Ayarlar**: Bağlantılar (MCP durumu), Sürüm Notları, sunucuyu yeniden başlat, CLI kurulum düğmeleri, veri kaynakları listesi.
- İzleme listesinde sağ tık menüsü: grafik, ajan özeti, KAP, alarm, işlem ekle, listeden çıkar.
- Fiyatların yanında kaynak ve gecikme etiketi; sol altta veri kaynakları özeti.
- `npm test`: portföy motoru için 24 kontrollü regresyon testi (maliyet, K/Z, temettü, nakit, kur farkı, XIRR); geçici veritabanında çalışır.

### Düzeltilen
- Gram altın vadeli kontrattan hesaplandığı için yaklaşık %0,7 yüksek görünüyordu. Artık Truncgil ve spot ons kullanılıyor.
- Dolar/TL günlük değişiminin işareti ters çıkabiliyordu.
- BIST 100 listesinde 12 sembol eskiydi. Liste artık İş Yatırım'dan güncel çekiliyor.
- ATR artık Wilder ortalamasıyla hesaplanıyor. 52 haftalık zirve ve dip gün içi yüksek/düşük değerlerden alınıyor.
- Filtre hızlı değiştirildiğinde eski sonuç yeni sonucu ezebiliyordu (KAP, işlemler, ayarlar, sembol ekranı).
- Esc tüm pencereleri kapatıyordu. Artık yalnızca en üstteki kapanıyor.
- Sayfa yenilenince fazladan kabuk açılıyordu.
- Yabancı varlıklarda ortalama maliyette TL ve USD karışıyordu. Artık varlığın kendi para biriminde gösteriliyor.
- Ajan çalışırken yerel komutlar (`/durdur`, `/status`) engelleniyordu. Komuttan sonra öneri listesi açık kalıyordu.
- Truncgil bağlantısı Node'un HTTP/2 istemcisiyle kopabiliyordu; yanıt da dosya güncellenirken yarım gelebiliyordu. Bu durumda döviz ve altın yedek kaynağa düşüyordu: gram altın ~%0,85 yüksek görünüyor, çeyrek altın hiç gelmiyordu. Artık HTTP/1.1 kullanılıyor, kısa beklemeyle yeniden deneniyor ve yarım yanıttaki tam kayıtlar kurtarılıyor.
- Grafik ekseni ve ipuçlarındaki ay adları İngilizceydi ("Apr"). Artık Türkçe ("Nis", "18 Haziran 2026").
- Hisse başlığındaki şirket adı Türkçe karaktersiz geliyordu ("Yollari"). Artık İş Yatırım adı ve "Borsa İstanbul" etiketi kullanılıyor.
- Sembol aramasında varlık türleri İngilizceydi ("gold"). Artık Türkçe (Altın, Döviz, Emtia…).

### Kaldırılan
- Sol paneldeki döviz çevirici. Yerinde artık veri kaynağı ve gecikme bilgisi gösteriliyor.

## 0.1.0 — İlk sürüm
- Piyasa, izleme listesi, portföy, KAP, alarmlar, terminal, raporlar, zamanlanmış görevler, Claude / Codex ajanı.

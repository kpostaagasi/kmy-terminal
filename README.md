# kmy terminal

Kişisel kullanım için yazılmış, BIST odaklı yerel bir borsa terminali. Tarayıcıda çalışan arayüz, yerel bir Node sunucusu ve Claude (veya ChatGPT/Codex ya da oh-my-pi) tabanlı bir analiz ajanından oluşur. Tüm veriler bilgisayarınızda, tek bir SQLite dosyasında tutulur (bkz. [Gateway](#gateway) › Veri dizini).

## Hızlı başlangıç

```bash
npm install
npm start          # http://127.0.0.1:7420
```

Tek tıkla açmak için: `npm run open` (sunucuyu arka planda başlatır ve tarayıcıyı açar). macOS uygulaması için aşağıdaki "macOS uygulaması" bölümüne bakın.

Gereksinimler: Node 22.13+, ajan için `claude` CLI'da oturum açık olması (`claude` → `/login`). İsteğe bağlı: `codex login` (ChatGPT sağlayıcısı), `omp` CLI ve omp içinde `/login` (oh-my-pi sağlayıcısı; CLI bulunursa model seçicide görünür).

Portföy hesaplarını ve güvenlik sınırlarını doğrulamak için: `npm test` (geçici veritabanında 381 kontrol: portföy 63, güvenlik 19, arama 59, hata senaryoları 28, denetim çekirdeği 62, hedef fiyat 33, sinyal bildirimi 37, takvim 80; gerçek verinize dokunmaz).

Verinin doğruluğunu canlı kaynaklara karşı denetlemek için: `npm run denetim` (ağ gerekir; `npm test` zincirinde değildir). Döviz (TCMB), gram altın (ons × kur), altın türleri, hisse fiyatı (İş Yatırım), TEFAS fon fiyatı, gecikme etiketleri ve temel oranlar (FAVÖK, net kâr, F/K; mali tablo ham satırlarından yeniden hesap) ikinci bir kaynakla karşılaştırılır. `-- --portfoy` portföy toplamlarını gerçek veritabanının **kopyasında** yeniden toplar; çıktıya tutar yazılmaz. `-- --json` makine okunur çıktı verir. Hisse fiyatı kontrolü seans açıkken atlanır (kapanıştan sonra çalıştırın). Çıkış kodu: 0 temiz, 1 sapma var, 2 hiçbir şey doğrulanamadı.

## Kurulum (DMG)

Hazır paket: GitHub › Releases › `kmy-terminal-<sürüm>-arm64.dmg`. DMG'yi açın, **kmy terminal**'i Applications klasörüne sürükleyin.

- Gereksinimler: Apple Silicon (M1+) Mac, macOS 14+. Yapay zekâ ajanı için **Claude Code** kurulu ve giriş yapılmış olmalı (https://claude.com/download); Codex ve oh-my-pi isteğe bağlı. Piyasa verisi, KAP, kurum raporları, portföy ve watchlist ajan olmadan da çalışır.
- Uygulama Apple Developer ID ile imzalı değildir; ilk açılışta macOS uyarı verirse Sistem Ayarları › Gizlilik ve Güvenlik › **Yine de Aç**.
- İlk açılışta uygulama Uygulamalar klasörüne taşımayı önerir. Claude Code PATH'te olmasa da resmî kurulum, Homebrew, npm, nvm, volta ve bun konumlarında bulunur; bulunamazsa sohbet ekranı kurulum adımlarını gösterir.
- Veri: `BORSA_DATA_DIR` tanımlıysa o, yoksa `~/Library/Application Support/kmy terminal` (uygulamayı silmek verileri silmez). Bu dizin henüz yoksa depo içindeki `data/` kullanılır ve varsa uygulama dizinine taşınır. Hangi dizinin kullanıldığını `bin/kmy gateway status` her an gösterir.
- Paketi yeniden üretmek için: `npm run dmg` → `dist/kmy-terminal-<sürüm>-arm64.dmg`.

## macOS uygulaması

Terminal, yerel bir macOS uygulaması olarak da çalışır (Swift + AppKit + WKWebView, ~1 MB; Chromium taşımaz).

```bash
npm run mac
```

`dist/kmy terminal.app` derlenir ve `~/Applications` altına kurulur; Dock, Spotlight ve Launchpad'den açılır. Gerekenler: Xcode veya Command Line Tools (Swift 5.10+), macOS 14+.

- **Gateway:** uygulama açılınca sunucuya bağlanır. `./bin/kmy gateway install` ile servis kuruluysa onu kullanır (gerekirse başlatır); kurulu değilse sunucuyu kendi alt süreci olarak başlatır ve kapanınca durdurur.
- **Yerel özellikler:** macOS bildirimleri (ajan izin ve soru istekleri), Dock rozeti (çalışan ajan işi sayısı), ~/Downloads'a indirme, dosya seçme penceresi, tema ile uyumlu pencere çubuğu, pencere konumunu hatırlama.
- **Menü:** Dosya (⌘N yeni ajan oturumu, ⌘K sembol ara), Görünüm (⌘1 Terminal, ⌘2 Dashboard, ⌘3 Portföy, ⌘\\ sağ panel, yakınlaştırma, ⌘R yenile), Gateway (durum, yeniden başlat, loglar), ⌘, Ayarlar.
- Dış bağlantılar varsayılan tarayıcıda, yerel raporlar yeni uygulama penceresinde açılır. Safari › Geliştir menüsünden sayfa incelenebilir.
- Uygulama yerel (ad-hoc) imzalıdır; başka bir Mac'e dağıtmak için Developer ID ile imzalanıp notarize edilmesi gerekir.
- **Menü çubuğu:** gateway çalıştığı sürece menü çubuğunda logo görünür (durum, çalışma süresi, çalışan işler, hızlı komutlar). Pencere kapatılınca uygulama menü çubuğunda sürer; servis kuruluysa oturum açılışında menü çubuğunda başlar.

## Gateway

kmy gateway, sunucuyu arka planda çalışan yönetilen bir servis olarak kurar ve yerel API'yi bir erişim anahtarıyla korur. Oturum açıldığında kendiliğinden başlar, çökerse servis yöneticisi yeniden açar (macOS: LaunchAgent `com.kmyterminal.gateway`, Linux: `systemd --user` birimi `borsa-gateway.service`).

```bash
sh scripts/install.sh            # npm install + servis kurulumu (tekrar çalıştırılabilir, sudo kullanmaz; --link, --no-service, --dry-run)
./bin/kmy gateway install      # yalnız servis (--dry-run: plist/birim dosyasını ve komutları yazdırır)
./bin/kmy gateway status       # kurulu mu, çalışıyor mu, PID, port, çalışma süresi (--json)
./bin/kmy gateway start | stop | restart
./bin/kmy gateway logs -f      # data/logs/gateway.log
./bin/kmy gateway token        # erişim anahtarını yazdır (--rotate: yenile)
./bin/kmy gateway open         # arayüzü tarayıcıda aç
./bin/kmy gateway uninstall
```

`npm link` ile (veya `sh scripts/install.sh --link`) `kmy` komutu PATH'e eklenir. Durum, anahtar ve yeniden başlatma/durdurma Ayarlar › SİSTEM › Gateway bölümünde de bulunur. Port `BORSA_PORT` (rapor portu `BORSA_REPORT_PORT`, varsayılan port+1), veri klasörü `BORSA_DATA_DIR` ile değiştirilebilir; kurulum sırasında tanımlıysa servise aktarılır.

Veri dizini tek kaynaktan çözülür: `BORSA_DATA_DIR` → `~/Library/Application Support/kmy terminal/data` (macOS) → depodaki `data/`. Uygulama ile `npm start` böylece aynı veritabanını görür; eski depo kopyası varsa doğrulanarak (boyut ve tablo sayısı) uygulama dizinine taşınır. `bin/kmy gateway status` (veya `--json`) etkin veri dizinini gösterir.

**Erişim anahtarı.** İlk çalıştırmada `data/gateway.json` dosyasında (izin 0600) 32 baytlık rastgele bir anahtar oluşur. Tüm `/api/*` istekleri ve WebSocket bağlantısı bu anahtarı ister; yoksa `401 {"error":"Gateway anahtarı gerekli"}` döner. Tarayıcı anahtarı arayüz yüklenirken verilen `borsa_gw` çerezi (HttpOnly, SameSite=Strict) ile otomatik gönderir. Betikler ve harici istemciler başlıkla gönderir:

```bash
TOKEN=$(./bin/kmy gateway token)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7420/api/portfolio
# veya: -H "x-gateway-token: $TOKEN"
```

`server/mcp-stdio.js` anahtarı dosyadan kendisi okur; ek ayar gerekmez.

**Güvenlik notları.**
- Sunucu yalnız `127.0.0.1` üzerinde dinler. Host başlığı `127.0.0.1`, `localhost` veya `[::1]` (doğru portla) değilse istek 403 ile reddedilir (DNS rebinding koruması). WebSocket ayrıca Origin başlığını denetler; başka sitelerden gelen API istekleri de reddedilir.
- Statik dosyalar (`/js`, `/vendor`, stil, simge, manifest) anahtarsız sunulur; veri içermezler.
- Rapor sunucusu (7421) rapor dosyalarında aynı çerezi veya uygulama kökenini ister. Uygulama içi rapor çerçeveleri çalışmaya devam eder.
- Anahtarı yenilemek (`gateway token --rotate` veya Ayarlar › Yenile) eski anahtarla bağlanan harici istemcileri düşürür. Açık arayüz sekmeleri kendini tazeler.
- `data/gateway.json` dosyası parola gibidir: paylaşmayın, yedeklere dikkat edin. Aynı kullanıcı hesabındaki yerel programlar bu dosyayı okuyabilir. Anahtar bu programlara karşı değil, tarayıcıdaki diğer sitelere ve ağa karşı korur.
- Ajan alt süreçlerine (Claude / Codex / omp) **master anahtar verilmez**. Onlara imzalı, süreli ve oturum+kip taşıyan bir kapsamlı jeton verilir; bu jeton yalnız `/api/tools/` rotasında geçerlidir, `/api/settings` 401 döner. Yolo kipi açık olsa bile ajan tüm API'ye erişemez.
- Ağdan erişim varsayılan olarak kapalıdır. `HOST=0.0.0.0` ile açarsanız izin verilen adları `BORSA_ALLOWED_HOSTS` ile ekleyin; bağlantı şifresiz (HTTP) olur.

## Özellikler

| Alan | İçerik |
|---|---|
| **DASHBOARD** | Kayan fiyat şeridi (XU100/XU030/XBANK, USD/TL, EUR/TL, gram/ons altın, Brent, BTC, S&P 500), sembol grafiği (1G–TÜMÜ; SMA20/50/200, Bollinger, hacim; RSI/MACD), istatistikler, teknik görünüm, **temel veriler** (F/K, PD/DD, FD/FAVÖK, tahminler), temettü ve sermaye artırımları, Türkçe haberler, sinyal etiketli KAP bildirimleri, **mali tablolar** (8 çeyrek), **kurum raporları**, **ajan notları** ve **şirket belgeleri** kartları, **ekonomi haberleri**, **temettü takvimi**, BIST 100 hareketlileri, piyasa genişliği, sektör ısı haritası, **hisse tarayıcı**, sinyal radarı, endeksler |
| **Watchlist** | Fiyat + mini grafik, sürükle-bırak sıralama, sembol arama, klavye gezinme; sağ tık menüsü (grafik, ajan özeti, KAP, işlem ekle) |
| **Portföy** | Özet (değer, günlük/açık/toplam K/Z, kur farkı, nakit, K/Z katkısı, veri uyarıları); varlıklar (fiyat kaynağı etiketi, elle fiyat, döviz cinsi varlıkta fiyat/kur etkisi); platform bazlı pozisyonlar ve platform × para birimi nakit; 13 işlem türü (transfer ve döviz çevirme dahil; bakiye uyarısı); dağılım (varlık, sektör, para birimi, ülke, platform, HHI, TL dışı pay); temettü (brüt/net, yaklaşan, beklenen, yıl bazında sektör/varlık/ülke kırılımı); risk & performans (TWR, XIRR, CAGR, volatilite, Sharpe, Sortino, Calmar, maks düşüş, beta, devir hızı, aylık ısı haritası, çeyreklik getiri, değer–net yatırılan grafiği, 7 karşılaştırma ölçütü, özel dönem); CSV içe aktarma (sütun eşleştirme, mükerrer satır atlama) ve dışa aktarma, JSON yedek; **kurum hedefi:** Varlıklar'da pozisyon başına medyan hedef fiyata uzaklık ve Özet'te kapsam + ağırlıklı hedef getiri (son 180 gün; rapordan sonra bedelsiz olan hisselerin hedefi sayılmaz) |
| **TERMINAL (AGENT CHAT)** | Varsayılan ekran. Claude Agent SDK, Codex CLI veya oh-my-pi (`omp --mode rpc-ui`); akışlı yanıt, katlanan araç grupları ("N sn çalıştı ▸ · N araç"), KOMİTE satırı ve alt ajan mesaj kartları ("main → denetci"), izin onayı, soru kartları, görev listesi, PLAN modu, dosya/görsel ekleme, 27 `/` komutu; mesaj kutusunda oturum, model, efor, arka plan işi, MALİYET, TUR ve ctx göstergesi; 4 özel alt ajan, araştırma hafızası, tetikleyici radarı hatırlatması. CHAT / TERMINAL düğmesiyle aynı sekmede gerçek kabuk (xterm.js + node-pty, tek tıkla Claude Code) |
| **KAP** (sağ panel) | Watchlist / portföy / tüm / sembol kapsamı (şirket bazında 1 yıla kadar); TEZ · YAP · FİN · KUR · DİĞER sinyal filtreleri; bildirim içeriği uygulama içinde; ekler uygulama içi PDF görüntüleyicide, arşive kaydetme; okundu takibi |
| **RAPORLAR + PDF** (sağ panel) | Kurum raporu akışı (12 aracı kurumun açık raporları; kendi hesabınla indirdiklerin için klasör izleme; filtre, YENİ etiketi, uygulama içi PDF, arşive kaydet, ajanla analiz), ajan raporları, yüklenen kurum raporları (kurum + sembol etiketi), sunum modu, yazdır, indir; rapor PDF sekmesinde açılır (ANALİZ / İNDİR / YENİ SEKMEDE AÇ / KAPAT) |
| **Zamanlanmış görevler** | Günlük kapanış raporu, sabah KAP taraması, haftalık portföy raporu, sinyal radarı, fon fiyatı güncelleme şablonları |
| **Sinyal bildirimi** | Seans kapandıktan sonra (18:30; yarım günde 12:50) izleme listesi ve portföydeki BIST hisselerini tarar, yalnız **yeni** çıkan sinyalleri (altın/ölüm kesişimi, 52 hafta zirvesi/dibi, SMA200 kırılımı; RSI, MACD ve hacim isteğe bağlı) tek toplu bildirimle haber verir. İlk tarama ve listeye yeni eklenen hisse yalnız taban çizgisi kaydeder. Ayarlar › Veri'den kapatılır / türleri seçilir; son 14 günün bildirimleri Dashboard › Tarayıcı'daki "Son sinyal bildirimleri" panelinde. Fiyat eşikleri de artık açık olmayan semboller için bildirim verir |
| **Takvim** | Terminalde `TAKVİM` sayfası (`#/pazar/takvim`, komut `TAKVIM`/`CAL`): temettü ve sermaye artırımı (İş Yatırım), TCMB takvimi (PPK karar günü, toplantı özeti, Enflasyon Raporu, Finansal İstikrar Raporu; tcmb.gov.tr) ve bilanço sezonu (KAP: açıklayanlar kesin; beklenen gün geçen yılın tarihine, son teslim yasal süreye göre **tahmini**). Gün gün liste, Listem / Portföyüm / Tümü ve tür süzgeçleri; her satırda KESİN / TAHMİNİ etiketi. Bilanço hisse bazlı yalnız Listem ve Portföyüm için hesaplanır (KAP istek sınırı); resmî tatiller hesaba katılmaz |
| **Ayarlar** | Tema, arayüz modu (Chat / Terminal), yazı boyutları, sağlayıcılar ve giriş, MCP bağlantıları, yenileme aralıkları, önbellek, sistem sağlığı ve yeniden başlatma, WebSocket mesaj logu, sürüm notları, kısayollar. Başlıktaki ⤓ ile masaüstüne uygulama olarak kurulabilir (Chrome / Edge). |

Kısayollar: `⌘K` sembol ara, `⌘1–3` sekmeler (TERMINAL, DASHBOARD, PORTFÖY), `⌘,` ayarlar. Sohbette `/help` tüm komutları listeler.

## Ajan

- Çalışma alanı: `workspace/`
  - `CLAUDE.md`: talimatlar. `AGENTS.md` aynı dosyaya bağlantıdır (Codex ve omp için).
  - `USER.md`: kullanıcı profili.
  - `KURALLAR.md`: çalışma kuralları (araştırma tamlığı, varsayım denetimi, KAP çıktı biçimi, veri güvenliği, alt ajan kullanımı).
  - `.claude/skills/`: 14 beceri (hisse analizi, teknik analiz, DCF, KAP tarama, portföy analizi, HTML rapor, kurum raporları, şirket belgeleri, PDF okuma, Excel/tablo, yazı sesi, tahmin defteri, tetikleyici radarı, beceri oluşturma).
  - `.claude/agents/`: 4 alt ajan (kıdemli analist, denetçi, araştırma asistanı, makro stratejist).
  - `hafiza/`: ajanın şirket ve konu notları. `belgeler/`: KAP'tan indirilen şirket belgeleri.
  - `scripts/dcf_excel.py`: formüllü DCF Excel modeli.
  - `knowledge/`: değerleme, makro, risk ve kalite notları.
- Terminal araçları (32 adet) ajana `mcp__borsa__*` olarak bağlıdır. Claude Code'daki diğer MCP bağlayıcılarınız (ör. Borsa MCP, Matriks) da ajanda kullanılabilir.
- **İzin kipi sunucu tarafında uygulanır** ve dört seçenekten birini alır:

  | Kip | Davranış |
  |---|---|
  | Sor (varsayılan) | Veritabanına veya dosyaya yazan her araç onay ister; salt okunur araçlar sorusuz çalışır |
  | Dosya düzenlemelerini onayla | Dosya araçları serbest; portföye/ayara/izleme listesine yazan araçlar onay ister |
  | Sadece plan | Yazan her araç reddedilir |
  | Otomatik (yolo) | Her araç izinli; her karar `tool_audit` tablosuna yazılır |

  Ayarlar › Bağlantı'daki "Ajana tam otomatik izin (yolo)" anahtarı 30 dakika / 2 saat / bu oturum seçeneğiyle açar ve seçilen süre dolunca kipi kendiliğinden "Sor"a döndürür. Bu kip yalnız ajanın kendi oturumuna ait; ana anahtarla yapılan doğrudan `POST /api/tools/...` çağrıları her zaman onay kapısından geçer.
- oh-my-pi (omp): terminal araçları `workspace/.omp/mcp.json` üzerinden aynı stdio köprüsüyle bağlanır (sunucu bu dosyayı ilk omp çalışmasında yazar; omp araçları `xd://mcp__borsa_<araç>` olarak görür). İzin kipleri: Sor → `always-ask` (onay kartı arayüzde), Düzenlemeleri onayla → `write`, Otomatik → `yolo`, Plan → yazan her araç reddedilir. Maliyet omp tarafından API fiyatıyla tahmin edilir (`estCost`); abonelik hesaplarında oturum maliyeti "abonelik" görünür.
- Aynı araçları başka bir Claude Code / Codex oturumuna eklemek için:

```bash
claude mcp add borsa -- node "$(pwd)/server/mcp-stdio.js"
```

## Veri kaynakları ve doğruluk

| Veri | Kaynak | Gecikme |
|---|---|---|
| BIST hisse ve endeksleri | Yahoo Finance | ~15 dk |
| Döviz, gram/çeyrek/yarım/tam/ata altın, gümüş | Truncgil | ~1 dk |
| Ons altın (spot) | gold-api.com | anlık |
| ABD hisseleri, emtia, kripto | Yahoo Finance | kaynağa göre |
| Temel oranlar, sektör, temettü/sermaye artırımı, BIST 100/30 üyeliği | İş Yatırım | günlük |
| Bildirimler ve ekleri | KAP | ~1–2 dk (hız sınırı) |
| Mali tablolar | İş Yatırım (KAP finansalları) | çeyreklik |
| Aracı kurum raporları | Gedik, Garanti BBVA, AK, İş, Yapı Kredi, Ziraat, Vakıf, Tacirler, PhillipCapital, Integral, A1 Capital, Halk (tavsiye/hedef fiyat listesi) — açık yayınlar | 30 dk |
| Ekonomi haberleri | Bloomberg HT, Foreks, AA, Dünya, Ekonomim, TRT Haber, Investing TR (RSS) | 10 dk |
| Resmi kurlar (işlem günü kuru) | TCMB | günlük |
| Risksiz faiz | TLREF, Borsa İstanbul | günlük |
| Haberler | Google Haberler (Türkçe) | — |

- Her fiyatın yanında kaynak ve gecikme etiketi gösterilir.
- Çeyrek, yarım, tam, Cumhuriyet ve ata altın ile 22 ayar bilezik **alış** fiyatıyla (elinizdekini bugün satsanız alacağınız tutar) değerlenir. Gram altın, döviz ve gümüş alış-satış ortalamasıyla değerlenir.
- TEFAS fonlarının günlük birim fiyatı TEFAS'tan otomatik gelir (fon kodu, ör. `TTE`, watchlist'e ve portföye doğrudan eklenebilir). Elle fiyat yalnız otomatik kaynağı olmayan varlıklar (mevduat, özel ürün) için gerekir.
- Sunucu yalnızca `127.0.0.1` üzerinde dinler ve başka kökenlerden gelen istekleri reddeder. Raporlar ayrı bir porttan (7421) sunulur; rapor içindeki betikler uygulama API'sine erişemez.

Değişiklikler için `CHANGELOG.md` dosyasına bakın. Bu yazılımın ürettiği analizler yatırım tavsiyesi değildir.

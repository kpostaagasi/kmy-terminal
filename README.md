# kmy terminal

Kişisel kullanım için yazılmış, BIST odaklı yerel bir borsa terminali. Tarayıcıda çalışan arayüz, yerel bir Node sunucusu ve Claude (veya ChatGPT/Codex ya da oh-my-pi) tabanlı bir analiz ajanından oluşur. Tüm veriler bilgisayarınızda (`data/borsa.db`) tutulur.

## Hızlı başlangıç

```bash
npm install
npm start          # http://127.0.0.1:7420
```

Tek tıkla açmak için: `npm run open` (sunucuyu arka planda başlatır ve tarayıcıyı açar). macOS uygulaması için aşağıdaki "macOS uygulaması" bölümüne bakın.

Gereksinimler: Node 22.13+, ajan için `claude` CLI'da oturum açık olması (`claude` → `/login`). İsteğe bağlı: `codex login` (ChatGPT sağlayıcısı), `omp` CLI ve omp içinde `/login` (oh-my-pi sağlayıcısı; CLI bulunursa model seçicide görünür).

Portföy hesaplarını doğrulamak için: `npm test` (geçici veritabanında 30 kontrol; gerçek verinize dokunmaz).

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
- Ağdan erişim varsayılan olarak kapalıdır. `HOST=0.0.0.0` ile açarsanız izin verilen adları `BORSA_ALLOWED_HOSTS` ile ekleyin; bağlantı şifresiz (HTTP) olur.

## Özellikler

| Alan | İçerik |
|---|---|
| **DASHBOARD** | Kayan fiyat şeridi (XU100/XU030/XBANK, USD/TL, EUR/TL, gram/ons altın, Brent, BTC, S&P 500), sembol grafiği (1G–TÜMÜ; SMA20/50/200, Bollinger, hacim; RSI/MACD), istatistikler, teknik görünüm, **temel veriler** (F/K, PD/DD, FD/FAVÖK, tahminler), temettü ve sermaye artırımları, Türkçe haberler, sinyal etiketli KAP bildirimleri, **mali tablolar** (8 çeyrek), **kurum raporları**, **ajan notları** ve **şirket belgeleri** kartları, **ekonomi haberleri**, **temettü takvimi**, BIST 100 hareketlileri, piyasa genişliği, sektör ısı haritası, **hisse tarayıcı**, sinyal radarı, endeksler |
| **Watchlist** | Fiyat + mini grafik, sürükle-bırak sıralama, sembol arama, klavye gezinme; sağ tık menüsü (grafik, ajan özeti, KAP, işlem ekle) |
| **Portföy** | Özet (değer, günlük/açık/toplam K/Z, kur farkı, nakit, K/Z katkısı, veri uyarıları); varlıklar (fiyat kaynağı etiketi, elle fiyat, döviz cinsi varlıkta fiyat/kur etkisi); platform bazlı pozisyonlar ve platform × para birimi nakit; 13 işlem türü (transfer ve döviz çevirme dahil; bakiye uyarısı); dağılım (varlık, sektör, para birimi, ülke, platform, HHI, TL dışı pay); temettü (brüt/net, yaklaşan, beklenen, yıl bazında sektör/varlık/ülke kırılımı); risk & performans (TWR, XIRR, CAGR, volatilite, Sharpe, Sortino, Calmar, maks düşüş, beta, devir hızı, aylık ısı haritası, çeyreklik getiri, değer–net yatırılan grafiği, 7 karşılaştırma ölçütü, özel dönem); CSV içe aktarma (sütun eşleştirme, mükerrer satır atlama) ve dışa aktarma, JSON yedek |
| **TERMINAL (AGENT CHAT)** | Varsayılan ekran. Claude Agent SDK, Codex CLI veya oh-my-pi (`omp --mode rpc-ui`); akışlı yanıt, katlanan araç grupları ("N sn çalıştı ▸ · N araç"), KOMİTE satırı ve alt ajan mesaj kartları ("main → denetci"), izin onayı, soru kartları, görev listesi, PLAN modu, dosya/görsel ekleme, 27 `/` komutu; mesaj kutusunda oturum, model, efor, arka plan işi, MALİYET, TUR ve ctx göstergesi; 4 özel alt ajan, araştırma hafızası, tetikleyici radarı hatırlatması. CHAT / TERMINAL düğmesiyle aynı sekmede gerçek kabuk (xterm.js + node-pty, tek tıkla Claude Code) |
| **KAP** (sağ panel) | Watchlist / portföy / tüm / sembol kapsamı (şirket bazında 1 yıla kadar); TEZ · YAP · FİN · KUR · DİĞER sinyal filtreleri; bildirim içeriği uygulama içinde; ekler uygulama içi PDF görüntüleyicide, arşive kaydetme; okundu takibi |
| **RAPORLAR + PDF** (sağ panel) | Kurum raporu akışı (12 aracı kurumun açık raporları; kendi hesabınla indirdiklerin için klasör izleme; filtre, YENİ etiketi, uygulama içi PDF, arşive kaydet, ajanla analiz), ajan raporları, yüklenen kurum raporları (kurum + sembol etiketi), sunum modu, yazdır, indir; rapor PDF sekmesinde açılır (ANALİZ / İNDİR / YENİ SEKMEDE AÇ / KAPAT) |
| **Zamanlanmış görevler** | Günlük kapanış raporu, sabah KAP taraması, haftalık portföy raporu, sinyal radarı, fon fiyatı güncelleme şablonları |
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
- Portföye işlem ekleme her seferinde onay ister. Diğer araçlar otomatik çalışır.
- oh-my-pi (omp): terminal araçları `workspace/.omp/mcp.json` üzerinden aynı stdio köprüsüyle bağlanır (sunucu bu dosyayı ilk omp çalışmasında yazar; omp araçları `xd://mcp__borsa_<araç>` olarak görür). İzin modları: Sor → `always-ask` (onay kartı arayüzde), Düzenlemeleri onayla → `write`, Otomatik → `yolo`, Plan → onay gerektiren her araç reddedilir. Maliyet omp tarafından API fiyatıyla tahmin edilir (`estCost`); abonelik hesaplarında oturum maliyeti "abonelik" görünür.
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
- TEFAS fonları için canlı kaynak yoktur. Portföy › Varlıklar › "Fiyat gir" ile elle fiyat girin ya da sohbette `/fonlar` komutunu kullanın.
- Sunucu yalnızca `127.0.0.1` üzerinde dinler ve başka kökenlerden gelen istekleri reddeder. Raporlar ayrı bir porttan (7421) sunulur; rapor içindeki betikler uygulama API'sine erişemez.

Değişiklikler için `CHANGELOG.md` dosyasına bakın. Bu yazılımın ürettiği analizler yatırım tavsiyesi değildir.

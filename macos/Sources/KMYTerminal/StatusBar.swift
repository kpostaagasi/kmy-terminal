// Menü çubuğu simgesi: uygulama açık kaldığı sürece görünür (5 sn'de bir kontrol edilir).
// Gateway çökse de simge kalır ve kırmızıya döner; kurtarma yolu (yeniden başlat) menüde hep bulunur.
// Menüde gateway durumu, çalışma süresi, çalışan asistan işleri ve hızlı komutlar yer alır.
import AppKit
import Foundation

final class StatusBar: NSObject, NSMenuDelegate {
  private var item: NSStatusItem?
  private var timer: Timer?
  private var health: [String: Any] = [:]
  private weak var app: AppDelegate?
  private(set) var gatewayUp = false
  private var jobs: [[String: Any]] = []

  init(app: AppDelegate) { self.app = app }

  func start() {
    tick()
    timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.tick() }
  }

  func tick() {
    Task { @MainActor in
      let (up, h) = await Gateway.shared.status()
      let wasUp = self.gatewayUp
      self.health = h
      self.gatewayUp = up
      // Simge gateway çökse de kalır: kurtarma yolu tam da o anda kaybolmasın diye kırmızıya döner
      if self.item == nil { self.show() }
      self.item?.button?.image = StatusBar.icon(red: !up)
      self.jobs = (h["runningSessions"] as? Int ?? 0) > 0 ? await self.loadJobs() : []
      self.item?.button?.toolTip = up ? L("kmy terminal · gateway çalışıyor", "kmy terminal · gateway running") : L("kmy terminal · gateway yanıt vermiyor", "kmy terminal · gateway not responding")
      if wasUp != up { self.app?.gatewayStateChanged(up) }
    }
  }

  /// Çalışan asistan işleri (başlıklarıyla). Anahtarı Gateway.status() ile aynı yerden okunur.
  private func loadJobs() async -> [[String: Any]] {
    var req = URLRequest(url: Gateway.shared.baseURL.appendingPathComponent("api/jobs"), timeoutInterval: 2)
    if let d = try? Data(contentsOf: Gateway.shared.dataDir.appendingPathComponent("gateway.json")),
       let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let t = j["token"] as? String {
      req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
    }
    guard let (data, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200 else { return [] }
    return ((try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]]) ?? []
  }

  private func show() {
    let i = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    i.button?.image = StatusBar.icon()
    i.button?.image?.accessibilityDescription = "kmy terminal"
    let menu = NSMenu()
    menu.delegate = self
    i.menu = menu
    item = i
  }

  /// Şablon simge: marka logosundaki yükselen grafik çizgisi (menü çubuğunun açık/koyu görünümüne otomatik uyar).
  /// Gateway kapalıyken kırmızı: simge kaybolmaz, kurtarma menüde kalır.
  static func icon(red: Bool = false) -> NSImage {
    let img = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { r in
      let s = r.width / 24
      let p = NSBezierPath()
      p.move(to: NSPoint(x: 3 * s, y: 17 * s))
      p.line(to: NSPoint(x: 8 * s, y: 11 * s))
      p.line(to: NSPoint(x: 12 * s, y: 15 * s))
      p.line(to: NSPoint(x: 20 * s, y: 5 * s))
      p.lineWidth = 2.4 * s
      p.lineCapStyle = .round
      p.lineJoinStyle = .round
      (red ? NSColor.systemRed : NSColor.black).setStroke()
      p.stroke()
      (red ? NSColor.systemRed : NSColor.black).setFill()
      NSBezierPath(ovalIn: NSRect(x: 18.2 * s, y: 3.2 * s, width: 3.6 * s, height: 3.6 * s)).fill()
      return true
    }
    img.isTemplate = !red
    return img
  }

  // Menü her açılışta güncel durumla yeniden kurulur
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    let g = Gateway.shared
    let up = gatewayUp
    func info(_ t: String) -> NSMenuItem { let i = NSMenuItem(title: t, action: nil, keyEquivalent: ""); i.isEnabled = false; return i }
    func act(_ t: String, _ sel: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
      let i = NSMenuItem(title: t, action: sel, keyEquivalent: key); i.keyEquivalentModifierMask = mods; i.target = self; return i
    }

    menu.addItem(act(L("kmy terminal'i Aç", "Open kmy terminal"), #selector(open)))
    menu.addItem(.separator())
    let version = health["version"] as? String
    menu.addItem(info(up ? L("● Gateway çalışıyor", "● Gateway running") + (version.map { " · v\($0)" } ?? "") : L("● Gateway yanıt vermiyor", "● Gateway not responding")))
    menu.addItem(info(g.serviceInstalled ? L("Mod: arka plan servisi (oturum açılışında başlar)", "Mode: background service (starts at login)") : L("Mod: uygulamayla birlikte", "Mode: runs with the app")))
    if let secs = health["uptimeSec"] as? Double { menu.addItem(info(L("Çalışma süresi: ", "Uptime: ") + StatusBar.duration(Int(secs)))) }
    if let s = health["runningSessions"] as? Int, s > 0 { menu.addItem(info(L("Çalışan asistan işi: \(s) · bağlı ekran: \(health["clients"] as? Int ?? 0)", "Running assistant tasks: \(s) · connected screens: \(health["clients"] as? Int ?? 0)"))) }
    // Çalışan her işin başlığı listelenir; tıklanınca o oturum açılır
    if !jobs.isEmpty {
      menu.addItem(info(L("Çalışan işler — açmak için tıklayın", "Running jobs — click to open")))
      for j in jobs.prefix(8) {
        let i = NSMenuItem(title: "  \(String(j["title"] as? String ?? L("Oturum", "Session")).prefix(48))", action: #selector(openJob(_:)), keyEquivalent: "")
        i.target = self
        i.representedObject = j["id"]
        if let a = j["activity"] as? String, !a.isEmpty { i.toolTip = a }
        menu.addItem(i)
      }
      if jobs.count > 8 { menu.addItem(info("  " + L("…ve {n} iş daha", "…and {n} more").replacingOccurrences(of: "{n}", with: "\(jobs.count - 8)"))) }
    }
    menu.addItem(info(L("Adres: ", "Address: ") + g.baseURL.absoluteString))
    menu.addItem(.separator())
    menu.addItem(act(L("Sembol Ara…", "Search Symbols…"), #selector(palette)))
    menu.addItem(act(L("Yeni Sohbet", "New Chat"), #selector(newSession), "n", [.command, .shift]))
    menu.addItem(.separator())
    menu.addItem(act(L("Gateway'i Yeniden Başlat", "Restart Gateway"), #selector(restart)))
    menu.addItem(act(L("Logları Aç", "Open Logs"), #selector(logs)))
    menu.addItem(.separator())
    menu.addItem(act(g.serviceInstalled ? L("Gateway'i Durdur ve Çık", "Stop Gateway and Quit") : L("Çık", "Quit"), #selector(quit)))
  }

  static func duration(_ x: Int) -> String {
    L10n.isTurkish
      ? (x < 3600 ? "\(x / 60) dk" : x < 86400 ? "\(x / 3600) sa \((x % 3600) / 60) dk" : "\(x / 86400) gün \((x % 86400) / 3600) sa")
      : (x < 3600 ? "\(x / 60)m" : x < 86400 ? "\(x / 3600)h \((x % 3600) / 60)m" : "\(x / 86400)d \((x % 86400) / 3600)h")
  }

  @objc private func open() { app?.showMain() }
  @objc private func palette() { app?.showMain(); app?.runJS("window.borsaApp?.palette()") }
  @objc private func newSession() { app?.showMain(); app?.runJS("window.borsaApp?.newSession()") }
  @objc private func openJob(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String else { return }
    app?.showMain()
    app?.runJS("window.dispatchEvent(new CustomEvent('kmy:session',{detail:'\(id)'}))")
  }
  @objc private func restart() { app?.restartGateway() }
  @objc private func logs() { NSWorkspace.shared.open(Gateway.shared.logURL) }
  @objc private func quit() { app?.quitAll() }
}

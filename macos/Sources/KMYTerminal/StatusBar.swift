// Menü çubuğu simgesi: gateway çalıştığı sürece görünür (5 sn'de bir kontrol edilir).
// Menüde gateway durumu, çalışma süresi, çalışan ajan işleri ve hızlı komutlar yer alır.
import AppKit

final class StatusBar: NSObject, NSMenuDelegate {
  private var item: NSStatusItem?
  private var timer: Timer?
  private var health: [String: Any] = [:]
  private weak var app: AppDelegate?
  private(set) var gatewayUp = false

  init(app: AppDelegate) { self.app = app }

  func start() {
    tick()
    timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.tick() }
  }

  func tick() {
    Task { @MainActor in
      let (up, h) = await Gateway.shared.status()
      self.health = h
      self.gatewayUp = up
      if up && self.item == nil { self.show() } else if !up, let i = self.item { NSStatusBar.system.removeStatusItem(i); self.item = nil }
      self.item?.button?.toolTip = up ? "kmy terminal · gateway çalışıyor" : nil
      self.app?.gatewayStateChanged(up)
    }
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

  /// Şablon simge: marka logosundaki yükselen grafik çizgisi (menü çubuğunun açık/koyu görünümüne otomatik uyar)
  static func icon() -> NSImage {
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
      NSColor.black.setStroke()
      p.stroke()
      NSBezierPath(ovalIn: NSRect(x: 18.2 * s, y: 3.2 * s, width: 3.6 * s, height: 3.6 * s)).fill()
      return true
    }
    img.isTemplate = true
    return img
  }

  // Menü her açılışta güncel durumla yeniden kurulur
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    let g = Gateway.shared
    let gw = health["gateway"] as? [String: Any] ?? [:]
    func info(_ t: String) -> NSMenuItem { let i = NSMenuItem(title: t, action: nil, keyEquivalent: ""); i.isEnabled = false; return i }
    func act(_ t: String, _ sel: Selector, _ key: String = "") -> NSMenuItem { let i = NSMenuItem(title: t, action: sel, keyEquivalent: key); i.target = self; return i }

    menu.addItem(act("kmy terminal'i Aç", #selector(open)))
    menu.addItem(.separator())
    let version = health["version"] as? String
    menu.addItem(info("● Gateway çalışıyor\(version.map { " · v\($0)" } ?? "")"))
    menu.addItem(info(g.serviceInstalled ? "Mod: arka plan servisi (oturum açılışında başlar)" : "Mod: uygulamayla birlikte"))
    if let up = health["uptimeSec"] as? Double { menu.addItem(info("Çalışma süresi: \(StatusBar.duration(Int(up)))")) }
    if let s = gw["activeSessions"] as? Int { menu.addItem(info("Çalışan ajan işi: \(s) · bağlı ekran: \(gw["clients"] as? Int ?? 0)")) }
    menu.addItem(info("Adres: \(g.baseURL.absoluteString)"))
    menu.addItem(.separator())
    menu.addItem(act("Sembol Ara…", #selector(palette)))
    menu.addItem(act("Yeni Ajan Oturumu", #selector(newSession)))
    menu.addItem(.separator())
    menu.addItem(act("Gateway'i Yeniden Başlat", #selector(restart)))
    menu.addItem(act("Logları Aç", #selector(logs)))
    menu.addItem(.separator())
    menu.addItem(act(g.serviceInstalled ? "Gateway'i Durdur ve Çık" : "Çık", #selector(quit)))
  }

  static func duration(_ x: Int) -> String {
    x < 3600 ? "\(x / 60) dk" : x < 86400 ? "\(x / 3600) sa \((x % 3600) / 60) dk" : "\(x / 86400) gün \((x % 86400) / 3600) sa"
  }

  @objc private func open() { app?.showMain() }
  @objc private func palette() { app?.showMain(); app?.runJS("window.borsaApp?.palette()") }
  @objc private func newSession() { app?.showMain(); app?.runJS("window.borsaApp?.newSession()") }
  @objc private func restart() { app?.restartGateway() }
  @objc private func logs() { NSWorkspace.shared.open(Gateway.shared.logURL) }
  @objc private func quit() { app?.quitAll() }
}

// Uygulama yaşam döngüsü ve menü çubuğu
import AppKit
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  private var main: WebWindowController!
  private var connecting = false

  func applicationDidFinishLaunching(_ notification: Notification) {
    UNUserNotificationCenter.current().delegate = self
    buildMenu()
    main = WebWindowController(url: nil, main: true)
    main.showWindow(nil)
    NSApp.activate(ignoringOtherApps: true)
    connect()
  }

  /// Gateway'i hazırla ve arayüzü yükle; ulaşılamazsa durum sayfası göster
  func connect() {
    guard !connecting else { return }
    connecting = true
    main.showStatus(title: "Gateway'e bağlanılıyor…", detail: "Terminal sunucusu hazırlanıyor.", retry: false)
    Task { @MainActor in
      let ok = await Gateway.shared.ensureRunning()
      connecting = false
      if ok { main.loadApp() } else {
        main.showStatus(title: "Gateway'e ulaşılamadı",
          detail: "Sunucu \(Gateway.shared.projectRoot.path) klasöründen başlatılamadı. Node kurulu mu? Terminalde <code>./bin/kmy gateway status</code> ile kontrol edin.",
          retry: true)
      }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if !flag { main.showWindow(nil) }
    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    // Servis kurulu değilse sunucu bu uygulamanın alt sürecidir: birlikte kapanır
    Gateway.shared.stopChild()
  }

  // Uygulama öndeyken de bildirim göster
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    main.showWindow(nil)
    NSApp.activate(ignoringOtherApps: true)
    completionHandler()
  }

  // MARK: Menü çubuğu
  private func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
    let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
    i.keyEquivalentModifierMask = mods
    i.target = target ?? self
    return i
  }
  /// İlk yanıtlayıcı zincirine giden öğe (pencere / metin komutları)
  private func fr(_ title: String, _ action: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
    let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
    i.keyEquivalentModifierMask = mods
    return i
  }

  private func buildMenu() {
    let bar = NSMenu()
    func menu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
      let m = NSMenu(title: title)
      items.forEach(m.addItem)
      let host = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      host.submenu = m
      bar.addItem(host)
      return m
    }
    let name = "kmy terminal"
    _ = menu(name, [
      item("\(name) Hakkında", #selector(about)),
      .separator(),
      item("Ayarlar…", #selector(openSettings), ","),
      .separator(),
      { let i = NSMenuItem(title: "Servisler", action: nil, keyEquivalent: ""); let s = NSMenu(); i.submenu = s; NSApp.servicesMenu = s; return i }(),
      .separator(),
      item("\(name) Gizle", #selector(NSApplication.hide(_:)), "h", target: NSApp),
      item("Diğerlerini Gizle", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option], target: NSApp),
      item("Tümünü Göster", #selector(NSApplication.unhideAllApplications(_:)), target: NSApp),
      .separator(),
      item("\(name) Uygulamasından Çık", #selector(NSApplication.terminate(_:)), "q", target: NSApp),
    ])
    _ = menu("Dosya", [
      item("Yeni Ajan Oturumu", #selector(newSession), "n"),
      item("Sembol Ara…", #selector(palette), "k"),
      .separator(),
      fr("Pencereyi Kapat", #selector(NSWindow.performClose(_:)), "w"),
    ])
    // Düzen menüsü: WKWebView'de kopyala / yapıştır / geri al bu seçicilerle çalışır
    _ = menu("Düzen", [
      NSMenuItem(title: "Geri Al", action: Selector(("undo:")), keyEquivalent: "z"),
      { let i = NSMenuItem(title: "Yinele", action: Selector(("redo:")), keyEquivalent: "z"); i.keyEquivalentModifierMask = [.command, .shift]; return i }(),
      .separator(),
      NSMenuItem(title: "Kes", action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
      NSMenuItem(title: "Kopyala", action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
      NSMenuItem(title: "Yapıştır", action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
      NSMenuItem(title: "Tümünü Seç", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"),
    ])
    _ = menu("Görünüm", [
      item("Terminal", #selector(viewAgent), "1"),
      item("Dashboard", #selector(viewMarket), "2"),
      item("Portföy", #selector(viewPortfolio), "3"),
      item("Sağ Paneli Göster/Gizle", #selector(toggleRight), "\\"),
      .separator(),
      item("Yakınlaştır", #selector(zoomIn), "+"),
      item("Uzaklaştır", #selector(zoomOut), "-"),
      item("Gerçek Boyut", #selector(zoomReset), "0"),
      .separator(),
      item("Yeniden Yükle", #selector(reload), "r"),
      fr("Tam Ekran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
    ])
    _ = menu("Gateway", [
      item("Durum", #selector(gatewayStatus)),
      item("Yeniden Başlat", #selector(gatewayRestart)),
      item("Logları Aç", #selector(gatewayLogs)),
      item("Proje Klasörünü Göster", #selector(showProject)),
    ])
    let win = menu("Pencere", [
      fr("Küçült", #selector(NSWindow.performMiniaturize(_:)), "m"),
      fr("Büyüt", #selector(NSWindow.performZoom(_:))),
    ])
    NSApp.windowsMenu = win
    _ = menu("Yardım", [item("Kısayollar ve Komutlar", #selector(help))])
    NSApp.mainMenu = bar
  }

  // MARK: Menü eylemleri
  @objc private func about() {
    NSApp.orderFrontStandardAboutPanel(options: [
      .applicationName: "kmy terminal",
      .credits: NSAttributedString(string: "Yapay zekâ destekli borsa terminali\nGateway: \(Gateway.shared.baseURL.absoluteString)"),
    ])
  }
  @objc private func openSettings() { focus(); main.js("window.borsaApp?.settings()") }
  @objc private func newSession() { focus(); main.js("window.borsaApp?.newSession()") }
  @objc private func palette() { focus(); main.js("window.borsaApp?.palette()") }
  @objc private func viewAgent() { focus(); main.js("window.borsaApp?.view('agent')") }
  @objc private func viewMarket() { focus(); main.js("window.borsaApp?.view('market')") }
  @objc private func viewPortfolio() { focus(); main.js("window.borsaApp?.view('portfolio')") }
  @objc private func toggleRight() { main.js("window.borsaApp?.toggleRight()") }
  @objc private func help() { focus(); main.js("window.borsaApp?.settings('yardim')") }
  @objc private func reload() { main.webView.reload() }
  @objc private func zoomIn() { main.webView.pageZoom = min(main.webView.pageZoom + 0.1, 2) }
  @objc private func zoomOut() { main.webView.pageZoom = max(main.webView.pageZoom - 0.1, 0.6) }
  @objc private func zoomReset() { main.webView.pageZoom = 1 }

  @objc private func gatewayStatus() {
    Task { @MainActor in
      let up = await Gateway.shared.isUp()
      let g = Gateway.shared
      let a = NSAlert()
      a.messageText = up ? "Gateway çalışıyor" : "Gateway çalışmıyor"
      a.informativeText = "Adres: \(g.baseURL.absoluteString)\nMod: \(g.serviceInstalled ? "launchd servisi" : g.ownsServer ? "uygulamayla birlikte" : "harici")\nProje: \(g.projectRoot.path)"
      a.addButton(withTitle: "Tamam")
      a.beginSheetModal(for: main.window!, completionHandler: nil)
    }
  }
  @objc private func gatewayRestart() {
    main.showStatus(title: "Gateway yeniden başlatılıyor…", detail: "Birkaç saniye sürer.", retry: false)
    Task { @MainActor in
      if await Gateway.shared.restart() { main.loadApp() } else { connect() }
    }
  }
  @objc private func gatewayLogs() { NSWorkspace.shared.open(Gateway.shared.logURL) }
  @objc private func showProject() { NSWorkspace.shared.activateFileViewerSelecting([Gateway.shared.projectRoot]) }

  private func focus() { main.showWindow(nil); NSApp.activate(ignoringOtherApps: true) }
}

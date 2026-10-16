// Uygulama yaşam döngüsü ve menü çubuğu
import AppKit
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate, NSMenuItemValidation {
  private var main: WebWindowController!
  private var connecting = false
  private var statusBar: StatusBar!
  private var reallyQuit = false
  /// launchd menü çubuğu ajanı tarafından (oturum açılışında) başlatıldı: pencere açılmaz
  private let menubarMode = CommandLine.arguments.contains("--menubar")
  private static let showNote = Notification.Name("com.kmyterminal.show")

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Taşıma sonrası açıldıysa eski kopyanın kapanmasını bekle
    if CommandLine.arguments.contains("--moved") { Thread.sleep(forTimeInterval: 1.5) }
    // Tek kopya: uygulama zaten çalışıyorsa onun penceresini aç ve çık
    let me = ProcessInfo.processInfo.processIdentifier
    if NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "").contains(where: { $0.processIdentifier != me }) {
      if !menubarMode { DistributedNotificationCenter.default().postNotificationName(AppDelegate.showNote, object: nil, userInfo: nil, deliverImmediately: true) }
      exit(0)
    }
    DistributedNotificationCenter.default().addObserver(forName: AppDelegate.showNote, object: nil, queue: .main) { [weak self] _ in self?.showMain() }
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.willPowerOffNotification, object: nil, queue: .main) { [weak self] _ in self?.reallyQuit = true }

    if offerMoveToApplications() { return }
    // Bildirim temsilcisi WebWindowController'da atanır (satır 199): bildirim düğmesine
    // basıldığında eylemin sayfaya geri dönmesi gerekiyor, bunu yalnız o sınıf yapabilir.
    // Burada atanırsa hemen ezilir ve aşağıdaki işleyiciler ölü kod olur.
    buildMenu()
    main = WebWindowController(url: nil, main: true)
    main.onClose = { [weak self] in self?.didCloseMain() }
    if menubarMode { NSApp.setActivationPolicy(.accessory) } else { showMain() }
    statusBar = StatusBar(app: self)
    statusBar.start()
    Gateway.shared.syncMenubarAgent()
    Updater.shared.start()
    connect()
  }

  // MARK: Uygulamalar klasörüne taşıma
  /// DMG'den ya da İndirilenler'den açılan uygulama macOS tarafından geçici, salt okunur bir konumda çalıştırılır (App Translocation);
  /// servis ve menü çubuğu kaydı bozulmasın diye Uygulamalar klasörüne taşımayı önerir. Taşınırsa yeni kopyayı açar ve true döner.
  private func offerMoveToApplications() -> Bool {
    guard Gateway.shared.bundled, !menubarMode else { return false }
    let here = Bundle.main.bundleURL.resolvingSymlinksInPath().path
    let home = NSHomeDirectory()
    if here.hasPrefix("/Applications/") || here.hasPrefix("\(home)/Applications/") { return false }
    if UserDefaults.standard.bool(forKey: "skipMoveOffer") { return false }
    NSApp.activate(ignoringOtherApps: true)
    let a = NSAlert()
    a.messageText = L("kmy terminal Uygulamalar klasörüne taşınsın mı?", "Move kmy terminal to the Applications folder?")
    let fromImage = here.contains("/AppTranslocation/") || here.hasPrefix("/Volumes/")
    a.informativeText = L(
      "Uygulama şu an \(fromImage ? "disk görüntüsünden ya da İndirilenler klasöründen" : "Uygulamalar klasörü dışından") çalışıyor. Arka plan servisi ve menü çubuğu simgesinin düzgün çalışması için Uygulamalar klasörüne taşınması önerilir.",
      "The app is running \(fromImage ? "from the disk image or the Downloads folder" : "outside the Applications folder"). Move it to Applications so the background service and the menu bar icon work reliably.")
    a.addButton(withTitle: L("Uygulamalar'a Taşı", "Move to Applications"))
    a.addButton(withTitle: L("Şimdi Değil", "Not Now"))
    a.showsSuppressionButton = true
    a.suppressionButton?.title = L("Bir daha sorma", "Don't ask again")
    let r = a.runModal()
    if a.suppressionButton?.state == .on { UserDefaults.standard.set(true, forKey: "skipMoveOffer") }
    guard r == .alertFirstButtonReturn else { return false }
    let fm = FileManager.default
    for dir in ["/Applications", "\(home)/Applications"] {
      let dest = URL(fileURLWithPath: dir).appendingPathComponent("kmy terminal.app")
      do {
        try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        if fm.fileExists(atPath: dest.path) { try fm.trashItem(at: dest, resultingItemURL: nil) }
        try fm.copyItem(at: Bundle.main.bundleURL, to: dest)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        p.arguments = ["-n", dest.path, "--args", "--moved"]
        try p.run()
        exit(0)
      } catch { continue }
    }
    let e = NSAlert()
    e.messageText = L("Taşınamadı", "Couldn't move the app")
    e.informativeText = L("kmy terminal'i Finder'da Uygulamalar klasörüne sürükleyip oradan açın.", "Drag kmy terminal to the Applications folder in Finder and open it from there.")
    e.runModal()
    return false
  }

  // MARK: Pencere ↔ menü çubuğu
  /// Pencereyi göster (Dock simgesi geri gelir)
  func showMain() {
    NSApp.setActivationPolicy(.regular)
    main.showWindow(nil)
    main.layoutTrafficLights()
    NSApp.activate(ignoringOtherApps: true)
  }
  /// Pencere kapandı: gateway açıksa uygulama menü çubuğunda sürer (Dock'tan kalkar)
  private func didCloseMain() {
    if statusBar?.gatewayUp == true { NSApp.setActivationPolicy(.accessory) }
  }
  /// Gateway kapanırsa ve pencere gizliyse Dock simgesi geri gelir (uygulamaya erişim kaybolmasın)
  func gatewayStateChanged(_ up: Bool) {
    if !up && main.window?.isVisible != true && NSApp.activationPolicy() == .accessory { NSApp.setActivationPolicy(.regular) }
  }
  func runJS(_ code: String) { main.js(code) }
  func restartGateway() { gatewayRestart() }
  /// Menü çubuğundan tamamen çık: servis modunda gateway de bu oturum için durdurulur (simge gateway'le birlikte kalkar)
  func quitAll() {
    if Gateway.shared.serviceInstalled { Gateway.shared.stopService() }
    reallyQuit = true
    NSApp.terminate(nil)
  }

  /// Gateway'i hazırla ve arayüzü yükle; ulaşılamazsa durum sayfası göster
  func connect() {
    guard !connecting else { return }
    connecting = true
    main.showStatus(title: L("Gateway'e bağlanılıyor…", "Connecting to the gateway…"), detail: L("Terminal sunucusu hazırlanıyor.", "Getting the terminal server ready."), retry: false)
    Task { @MainActor in
      let ok = await Gateway.shared.ensureRunning()
      connecting = false
      if ok { main.loadApp() } else {
        main.showStatus(title: L("Gateway'e ulaşılamadı", "Couldn't reach the gateway"),
          detail: Gateway.shared.bundled
            ? L("Sunucu başlatılamadı. Ayrıntılar için logları açın. 7420 portunu başka bir uygulama kullanıyor olabilir.", "The server couldn't start. Open the logs for details. Another app may be using port 7420.")
            : Gateway.shared.serviceInstalled
              ? L("Arka plan servisi başlatılamadı. Ayrıntılar için logları açın veya Terminal'de <code>./bin/kmy gateway status</code> çalıştırın.", "The background service couldn't start. Open the logs for details or run <code>./bin/kmy gateway status</code> in Terminal.")
              : L("Sunucu \(Gateway.shared.projectRoot.path) klasöründen başlatılamadı. Node kurulu mu? Terminal'de <code>./bin/kmy gateway status</code> ile kontrol edin.", "The server couldn't start from \(Gateway.shared.projectRoot.path). Is Node installed? Check with <code>./bin/kmy gateway status</code> in Terminal."),
          retry: true)
      }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    showMain()
    return true
  }

  /// ⌘Q: gateway servis olarak çalışıyorsa uygulama kapanmaz, menü çubuğuna çekilir (tamamen çıkış menü çubuğundan)
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if reallyQuit || !Gateway.shared.serviceInstalled || statusBar?.gatewayUp != true { return .terminateNow }
    main.window?.orderOut(nil)
    NSApp.setActivationPolicy(.accessory)
    return .terminateCancel
  }

  func applicationWillTerminate(_ notification: Notification) {
    // Servis kurulu değilse sunucu bu uygulamanın alt sürecidir: birlikte kapanır
    Gateway.shared.stopChild()
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

  /// Sayfa arayüz dilini değiştirdi: menüler yeni dille yeniden kurulur
  func languageChanged() { buildMenu() }
  @objc func checkForUpdates() { Updater.shared.checkForUpdates() }

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
      item(L("\(name) Hakkında", "About \(name)"), #selector(about)),
      item(L("Güncellemeleri Denetle…", "Check for Updates…"), #selector(checkForUpdates)),
      .separator(),
      item(L("Ayarlar…", "Settings…"), #selector(openSettings), ","),
      .separator(),
      { let i = NSMenuItem(title: L("Servisler", "Services"), action: nil, keyEquivalent: ""); let s = NSMenu(); i.submenu = s; NSApp.servicesMenu = s; return i }(),
      .separator(),
      item(L("\(name) Gizle", "Hide \(name)"), #selector(NSApplication.hide(_:)), "h", target: NSApp),
      item(L("Diğerlerini Gizle", "Hide Others"), #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option], target: NSApp),
      item(L("Tümünü Göster", "Show All"), #selector(NSApplication.unhideAllApplications(_:)), target: NSApp),
      .separator(),
      item(L("\(name) Uygulamasından Çık", "Quit \(name)"), #selector(NSApplication.terminate(_:)), "q", target: NSApp),
    ])
    _ = menu(L("Dosya", "File"), [
      item(L("Yeni Sohbet", "New Chat"), #selector(newSession), "n"),
      item(L("Sembol Ara…", "Search Symbols…"), #selector(palette), "k"),
      .separator(),
      fr(L("Pencereyi Kapat", "Close Window"), #selector(NSWindow.performClose(_:)), "w"),
    ])
    // Düzen menüsü: WKWebView'de kopyala / yapıştır / geri al bu seçicilerle çalışır
    _ = menu(L("Düzen", "Edit"), [
      NSMenuItem(title: L("Geri Al", "Undo"), action: Selector(("undo:")), keyEquivalent: "z"),
      { let i = NSMenuItem(title: L("Yinele", "Redo"), action: Selector(("redo:")), keyEquivalent: "z"); i.keyEquivalentModifierMask = [.command, .shift]; return i }(),
      .separator(),
      NSMenuItem(title: L("Kes", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
      NSMenuItem(title: L("Kopyala", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
      NSMenuItem(title: L("Yapıştır", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
      NSMenuItem(title: L("Tümünü Seç", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"),
    ])
    _ = menu(L("Görünüm", "View"), [
      item("Dashboard", #selector(viewAgent), "1"),
      item("kmy terminal", #selector(viewMarket), "2"),
      item(L("Portföy", "Portfolio"), #selector(viewPortfolio), "3"),
      item(L("Sağ Paneli Göster/Gizle", "Show/Hide Side Panel"), #selector(toggleRight), "\\"),
      .separator(),
      item(L("Yakınlaştır", "Zoom In"), #selector(zoomIn), "+"),
      item(L("Uzaklaştır", "Zoom Out"), #selector(zoomOut), "-"),
      item(L("Gerçek Boyut", "Actual Size"), #selector(zoomReset), "0"),
      .separator(),
      fr(L("Tam Ekran", "Enter Full Screen"), #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
    ])
    _ = menu("Gateway", [
      item(L("Durum", "Status"), #selector(gatewayStatus)),
      item(L("Yeniden Başlat", "Restart"), #selector(gatewayRestart)),
      item(L("Logları Aç", "Open Logs"), #selector(gatewayLogs)),
      .separator(),
      item(L("Arka Planda Çalıştır (Servis)", "Run in Background (Service)"), #selector(toggleService)),
      item(L("Çalışma Klasörünü Göster", "Show Working Folder"), #selector(showProject)),
    ])
    let win = menu(L("Pencere", "Window"), [
      fr(L("Küçült", "Minimize"), #selector(NSWindow.performMiniaturize(_:)), "m"),
      fr(L("Büyüt", "Zoom"), #selector(NSWindow.performZoom(_:))),
    ])
    NSApp.windowsMenu = win
    _ = menu(L("Yardım", "Help"), [item(L("Kısayollar ve Komutlar", "Shortcuts and Commands"), #selector(help))])
    NSApp.mainMenu = bar
  }

  // MARK: Menü eylemleri
  @objc private func about() {
    NSApp.orderFrontStandardAboutPanel(options: [
      .applicationName: "kmy terminal",
      .credits: NSAttributedString(string: L("Yapay zekâ destekli borsa terminali", "AI-powered stock market terminal") + "\nGateway: \(Gateway.shared.baseURL.absoluteString)"),
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
  @objc private func zoomIn() { main.webView.pageZoom = min(main.webView.pageZoom + 0.1, 2) }
  @objc private func zoomOut() { main.webView.pageZoom = max(main.webView.pageZoom - 0.1, 0.6) }
  @objc private func zoomReset() { main.webView.pageZoom = 1 }

  @objc private func gatewayStatus() {
    Task { @MainActor in
      let up = await Gateway.shared.isUp()
      let g = Gateway.shared
      let a = NSAlert()
      a.messageText = up ? L("Gateway çalışıyor", "Gateway is running") : L("Gateway çalışmıyor", "Gateway is not running")
      let mode = g.serviceInstalled ? L("launchd servisi", "launchd service") : g.ownsServer ? L("uygulamayla birlikte", "runs with the app") : L("harici", "external")
      a.informativeText = L("Adres", "Address") + ": \(g.baseURL.absoluteString)\n" + L("Mod", "Mode") + ": \(mode)\n" + L("Proje", "Project") + ": \(g.projectRoot.path)"
      a.addButton(withTitle: L("Tamam", "OK"))
      a.beginSheetModal(for: main.window!, completionHandler: nil)
    }
  }
  @objc private func gatewayRestart() {
    main.showStatus(title: L("Gateway yeniden başlatılıyor…", "Restarting the gateway…"), detail: L("Birkaç saniye sürer.", "This takes a few seconds."), retry: false)
    Task { @MainActor in
      if await Gateway.shared.restart() { main.loadApp() } else { connect() }
    }
  }
  // Servis: uygulama kapalıyken de sunucu (zamanlanmış görevler, KAP takibi) çalışır; oturum açılışında başlar
  @objc private func toggleService() {
    let on = !Gateway.shared.serviceInstalled
    main.showStatus(title: on ? L("Arka plan servisi kuruluyor…", "Installing the background service…") : L("Arka plan servisi kaldırılıyor…", "Removing the background service…"), detail: L("Birkaç saniye sürer.", "This takes a few seconds."), retry: false)
    Task { @MainActor in
      _ = await Gateway.shared.setService(on)
      Gateway.shared.syncMenubarAgent()
      if await Gateway.shared.ensureRunning() { main.loadApp() } else { connect() }
    }
  }
  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    if item.action == #selector(toggleService) { item.state = Gateway.shared.serviceInstalled ? .on : .off }
    return true
  }
  @objc private func gatewayLogs() { NSWorkspace.shared.open(Gateway.shared.logURL) }
  @objc private func showProject() { NSWorkspace.shared.activateFileViewerSelecting([Gateway.shared.bundled ? Gateway.shared.workspaceDir : Gateway.shared.projectRoot]) }

  private func focus() { showMain() }
}

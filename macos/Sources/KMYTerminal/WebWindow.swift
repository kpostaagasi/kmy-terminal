// Ana pencere: terminal arayüzünü WKWebView içinde gösterir.
// Web sayfası ile uygulama arasında köprü: bildirimler, Dock rozeti, tema, dosya seçme, indirme, dış bağlantılar.
import AppKit
import WebKit
import UserNotifications

/// Sayfaya belge başında eklenen betik: Notification API'yi macOS bildirimine, temayı pencere görünümüne bağlar
private var bridgeJS: String { "window.__kmySystemLang = \"\(L10n.systemCode.replacingOccurrences(of: "\"", with: ""))\";\n" + bridgeBody }
private let bridgeBody = """
(() => {
  const post = (m) => {
    try { window.webkit.messageHandlers.borsa.postMessage(m); }
    catch (e) {
      console.error('[kmy] köprü: mesaj iletilemedi', m && m.type, e);
      dispatchEvent(new CustomEvent('kmy:bridge-error', { detail: String((e && e.message) || e) }));
    }
  };
  window.borsaNative = { platform: 'macos' };
  const mark = () => document.documentElement && document.documentElement.classList.add('native-mac');
  mark();
  // Pencere sürükleme bölgeleri: üst çubuk ve sekme çubuğunun boş yerleri (düğmeler, sekmeler, şerit hariç)
  const HOLES = 'button, a, input, select, textarea, label, [role=tab], .ticker, .conn, .clock, .mkt-status, .suggest';
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  let pending = false;
  const report = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const areas = [...document.querySelectorAll('.topbar, .viewbar')];
      post({ type: 'drag', regions: areas.map(box), holes: areas.flatMap((a) => [...a.querySelectorAll(HOLES)]).filter((e) => e.offsetParent).map(box) });
    });
  };
  addEventListener('resize', report);
  addEventListener('load', () => {
    report();
    const mo = new MutationObserver(report);
    document.querySelectorAll('.topbar, .viewbar').forEach((el) => mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] }));
    setInterval(report, 3000);
  });
  // Uygulama menüsü olmayan yerlerde WebKit'in "Yeniden Yükle / Öğeyi İncele" sağ tık menüsü gösterilmez.
  // .xterm seçimi window.getSelection değildir; orada WebKit menüsü iptal edilmez.
  addEventListener('contextmenu', (e) => {
    const el = e.target;
    if (el && el.closest && el.closest('input, textarea, [contenteditable], .xterm, .wl-row')) return;
    e.preventDefault();
    const sel = String(getSelection() || '').trim();
    const link = el && el.closest && el.closest('a[href]');
    const href = link ? String(link.href || '') : '';
    if (sel || href) post({ type: 'contextmenu', x: e.clientX, y: e.clientY, text: sel, href });
  });
  // Bildirim izni gerçek sistem değerini Swift'ten alır; önceden hep 'granted' dönüyordu
  let perm = 'default';
  const setPerm = (s) => {
    perm = s === 'granted' || s === 'denied' ? s : 'default';
    dispatchEvent(new CustomEvent('kmy:notifperm', { detail: perm }));
  };
  window.__kmyNotifPerm = setPerm;
  class NativeNotification {
    constructor(title, opts = {}) {
      post({ type: 'notify', title: String(title || ''), body: String(opts.body || ''), actions: (opts.actions || []).map((a) => ({ id: String(a.id || ''), label: String(a.label || '') })) });
    }
    static get permission() { return perm; }
    static requestPermission() {
      return new Promise((res) => {
        const h = (e) => { if (e.detail === 'granted' || e.detail === 'denied') { removeEventListener('kmy:notifperm', h); res(e.detail); } };
        addEventListener('kmy:notifperm', h);
        post({ type: 'notifreq' });
      });
    }
    close() {}
  }
  window.Notification = NativeNotification;
  addEventListener('load', () => post({ type: 'notifperm?' }));
  let last = '';
  const sync = () => {
    const root = document.documentElement;
    const bg = getComputedStyle(root).getPropertyValue('--bg-2').trim();
    const key = (root.dataset.theme || 'dark') + bg;
    if (key === last) return;
    last = key;
    post({ type: 'theme', theme: root.dataset.theme || 'dark', bg });
  };
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  addEventListener('DOMContentLoaded', () => { mark(); sync(); });
  addEventListener('load', sync);
})();
"""

/// Başlık çubuğu davranışı: sayfanın bildirdiği sürükleme bölgelerinde pencere taşınır, çift tıklama sistem ayarına göre büyütür / küçültür
final class KMYWebView: WKWebView {
  var dragRegions: [CGRect] = []
  var dragHoles: [CGRect] = []
  override func mouseDown(with event: NSEvent) {
    let p = convert(event.locationInWindow, from: nil)
    let z = max(pageZoom, 0.1)
    let css = CGPoint(x: p.x / z, y: (isFlipped ? p.y : bounds.height - p.y) / z)
    if dragRegions.contains(where: { $0.contains(css) }) && !dragHoles.contains(where: { $0.contains(css) }) {
      if event.clickCount == 2 {
        let action = UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize"
        if action == "Minimize" { window?.performMiniaturize(nil) } else if action != "None" { window?.performZoom(nil) }
      } else {
        window?.performDrag(with: event)
      }
      return
    }
    super.mouseDown(with: event)
  }
}

/// Ana pencere: başlık çubuğu bölgesindeki (üst 46 px) fare olayları, pencere düğmeleri dışında sayfaya yönlendirilir.
/// AppKit'in başlık katmanı bu bölgeyi yakalar; yönlendirme olmadan üst çubuktaki düğmelere tıklanamazdı.
final class KMYWindow: NSWindow {
  weak var web: WKWebView?
  var titlebarHeight: CGFloat = 46
  private var routing = false

  private func inTitlebar(_ e: NSEvent) -> Bool {
    guard !styleMask.contains(.fullScreen) else { return false }
    return e.locationInWindow.y >= frame.height - titlebarHeight
  }
  private func onWindowButton(_ e: NSEvent) -> Bool {
    [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].contains { t in
      guard let b = standardWindowButton(t), let sv = b.superview else { return false }
      return sv.convert(b.frame, to: nil).insetBy(dx: -4, dy: -4).contains(e.locationInWindow)
    }
  }
  override func sendEvent(_ e: NSEvent) {
    guard let web else { return super.sendEvent(e) }
    switch e.type {
    case .leftMouseDown, .rightMouseDown, .otherMouseDown:
      if inTitlebar(e) && !onWindowButton(e) {
        routing = true
        if e.type == .leftMouseDown { web.mouseDown(with: e) } else if e.type == .rightMouseDown { web.rightMouseDown(with: e) } else { web.otherMouseDown(with: e) }
        return
      }
    case .leftMouseDragged where routing: web.mouseDragged(with: e); return
    case .leftMouseUp where routing: routing = false; web.mouseUp(with: e); return
    case .rightMouseUp where routing: routing = false; web.rightMouseUp(with: e); return
    case .otherMouseUp where routing: routing = false; web.otherMouseUp(with: e); return
    case .mouseMoved where inTitlebar(e) && !onWindowButton(e): web.mouseMoved(with: e); return
    case .scrollWheel where inTitlebar(e): web.scrollWheel(with: e); return
    default: break
    }
    super.sendEvent(e)
  }
}

final class WebWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate, UNUserNotificationCenterDelegate {
  let webView: WKWebView
  private let isMain: Bool
  private var popups: [WebWindowController] = []
  private var downloads: [WKDownload: URL] = [:]
  /// Eylemli bildirim kategorileri: her bildirim kendi kimliğini taşır; eski banner düğmeleri silinmesin diye birleşik küme yazılır.
  private var liveCategories: [(id: String, category: UNNotificationCategory)] = []
  private let categoryQueue = DispatchQueue(label: "com.kmyterminal.notification-categories")

  init(url: URL?, main: Bool, configuration: WKWebViewConfiguration? = nil) {
    isMain = main
    let config = configuration ?? WebWindowController.makeConfig()
    webView = KMYWebView(frame: .zero, configuration: config)
    webView.allowsMagnification = false
    webView.allowsBackForwardNavigationGestures = false
    webView.setValue(false, forKey: "drawsBackground") // yüklenirken beyaz parlama olmasın
    if #available(macOS 13.3, *) { webView.isInspectable = true } // Safari › Geliştir ile incelenebilir

    let frame = NSRect(x: 0, y: 0, width: main ? 1440 : 1100, height: main ? 900 : 800)
    let window = KMYWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    if main { window.web = webView; window.titlebarHeight = WebWindowController.topbarHeight }
    window.titlebarAppearsTransparent = true
    window.titleVisibility = main ? .hidden : .visible
    window.title = "kmy terminal"
    window.minSize = NSSize(width: 760, height: 520)
    window.backgroundColor = NSColor(srgbRed: 0.055, green: 0.07, blue: 0.098, alpha: 1)
    window.tabbingMode = .disallowed
    window.titlebarSeparatorStyle = .none
    super.init(window: window)

    // Ana pencere: sayfa başlık çubuğunun altına kadar uzanır (pencere düğmeleri üst çubukta), arkada macOS kenar çubuğu dokusu.
    // Açılır pencereler (raporlar) klasik başlık çubuğuyla açılır.
    let container: NSView
    if main {
      let fx = NSVisualEffectView()
      fx.material = .sidebar
      fx.blendingMode = .behindWindow
      fx.state = .followsWindowActiveState
      container = fx
    } else {
      container = NSView()
    }
    container.wantsLayer = true
    webView.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(webView)
    let top = NSLayoutConstraint(item: webView, attribute: .top, relatedBy: .equal, toItem: container, attribute: .top, multiplier: 1, constant: main ? 0 : 28)
    NSLayoutConstraint.activate([top,
      webView.leadingAnchor.constraint(equalTo: container.leadingAnchor), webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      webView.bottomAnchor.constraint(equalTo: container.bottomAnchor)])
    window.contentView = container
    window.delegate = self
    if main { window.setFrameAutosaveName("KMYMainWindow") } else { window.cascadeTopLeft(from: NSPoint(x: 40, y: 40)) }
    if !main || !window.setFrameUsingName("KMYMainWindow") { window.center() }

    webView.navigationDelegate = self
    webView.uiDelegate = self
    // Açılır pencereler ana pencerenin yapılandırmasını paylaşır; işleyici bir kez eklenir
    if configuration == nil { webView.configuration.userContentController.add(WeakHandler(self), name: "borsa") }
    // Bildirim temsilcisi ana pencerede: düğmeye basıldığında eylemi sayfaya geri gönderebilmeliyiz
    if main { UNUserNotificationCenter.current().delegate = self }
    if let url { webView.load(URLRequest(url: url)) }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) kullanılmıyor") }

  static func makeConfig() -> WKWebViewConfiguration {
    let c = WKWebViewConfiguration()
    c.websiteDataStore = .default() // çerezler (gateway anahtarı) kalıcı
    c.preferences.javaScriptCanOpenWindowsAutomatically = true
    c.userContentController.addUserScript(WKUserScript(source: bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    return c
  }

  // MARK: Durum sayfası (gateway'e ulaşılamazsa)
  func showStatus(title: String, detail: String, retry: Bool) {
    let html = """
    <!doctype html><html><head><meta charset="utf-8"><style>
    :root { color-scheme: light dark; }
    body { margin: 0; height: 100vh; display: grid; place-items: center; font: 14px -apple-system, sans-serif; background: #0a0a0a; color: #e6e6e6; }
    @media (prefers-color-scheme: light) { body { background: #ededea; color: #121212; } }
    .box { text-align: center; max-width: 440px; padding: 24px; }
    h1 { font-size: 17px; font-weight: 600; margin: 14px 0 6px; } p { opacity: .65; line-height: 1.55; margin: 0 0 20px; }
    .spin { width: 20px; height: 20px; border: 2px solid rgba(128,128,128,.25); border-top-color: #ff9f0a; border-radius: 50%; margin: auto; animation: s .8s linear infinite; }
    @keyframes s { to { transform: rotate(360deg); } }
    button { background: #ff9f0a; color: #120a00; border: 0; border-radius: 2px; padding: 7px 14px; font: 700 12px ui-monospace, SF Mono, monospace; letter-spacing: .05em; text-transform: uppercase; margin: 0 4px; }
    button.sec { background: rgba(128,128,128,.2); color: inherit; }
    </style></head><body><div class="box">
    \(retry ? "" : "<div class=\"spin\"></div>")
    <h1>\(title)</h1><p>\(detail)</p>
    \(retry ? "<button onclick=\"webkit.messageHandlers.borsa.postMessage({type:'retry'})\">\(L("Tekrar dene", "Try again"))</button><button class=\"sec\" onclick=\"webkit.messageHandlers.borsa.postMessage({type:'logs'})\">\(L("Logları aç", "Open logs"))</button>" : "")
    </div></body></html>
    """
    webView.loadHTMLString(html, baseURL: nil)
  }

  func loadApp() { webView.load(URLRequest(url: Gateway.shared.baseURL)) }

  // MARK: Sayfadan gelen mesajlar
  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let m = message.body as? [String: Any], let type = m["type"] as? String else { return }
    switch type {
    case "checkForUpdates":
      Updater.shared.checkForUpdates()
    case "updateAuto":
      Updater.shared.setAutomaticChecks((m["on"] as? Bool) ?? true)
    case "notify":
      notify(title: m["title"] as? String ?? "kmy terminal", body: m["body"] as? String ?? "",
        actions: (m["actions"] as? [[String: Any]] ?? []).compactMap { a in
          guard let id = a["id"] as? String, !id.isEmpty else { return nil }
          return ["id": id, "label": (a["label"] as? String) ?? id]
        })
    case "notifperm?":
      reportNotificationPermission()
    case "notifreq":
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
        self.reportNotificationPermission(granted: ok)
      }
    case "badge":
      NSApp.dockTile.badgeLabel = (m["text"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    case "drag":
      let rect = { (a: Any) -> CGRect? in
        guard let v = a as? [Double], v.count == 4 else { return nil }
        return CGRect(x: v[0], y: v[1], width: v[2], height: v[3])
      }
      (webView as? KMYWebView)?.dragRegions = (m["regions"] as? [Any] ?? []).compactMap(rect)
      (webView as? KMYWebView)?.dragHoles = (m["holes"] as? [Any] ?? []).compactMap(rect)
    case "theme":
      let dark = (m["theme"] as? String) != "light"
      window?.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
      if let c = NSColor(hex: m["bg"] as? String ?? "") { window?.backgroundColor = c }
    case "lang":
      if L10n.set(m["lang"] as? String ?? "") { (NSApp.delegate as? AppDelegate)?.languageChanged() }
    case "retry":
      (NSApp.delegate as? AppDelegate)?.connect()
    case "logs":
      NSWorkspace.shared.open(Gateway.shared.logURL)
    case "contextmenu":
      showContextMenu(m)
    default: break
    }
  }

  /// Gerçek sistem bildirim izni (sayfa artık 'granted' varsaymıyor); reddedilmişse JS uyarı gösteriyor
  private func reportNotificationPermission(granted: Bool? = nil) {
    if let g = granted { return DispatchQueue.main.async { self.js("window.__kmyNotifPerm(\(g ? "\"granted\"" : "\"denied\""))") } }
    UNUserNotificationCenter.current().getNotificationSettings { s in
      let v = (s.authorizationStatus == .authorized || s.authorizationStatus == .provisional) ? "granted" : (s.authorizationStatus == .denied ? "denied" : "default")
      DispatchQueue.main.async { self.js("window.__kmyNotifPerm(\"\(v)\")") }
    }
  }

  /// Eylemli bildirim: düğmeler yalnız bir kategoriyle görünür. Kimlik bildirim başına tektir; küme güncellemeleri sıraya alınır.
  private func notify(title: String, body: String, actions: [[String: String]] = []) {
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
      guard ok else { return }
      let c = UNMutableNotificationContent()
      c.title = title
      c.body = body
      c.sound = .default
      let acts = actions.compactMap { a -> UNNotificationAction? in
        guard let id = a["id"], !id.isEmpty else { return nil }
        return UNNotificationAction(identifier: id, title: a["label"] ?? id, options: [.foreground])
      }
      self.categoryQueue.async {
        if !acts.isEmpty {
          let id = UUID().uuidString
          let cat = UNNotificationCategory(identifier: id, actions: acts, intentIdentifiers: [], options: [])
          self.liveCategories.append((id, cat))
          if self.liveCategories.count > 16 { self.liveCategories.removeFirst(self.liveCategories.count - 16) }
          center.setNotificationCategories(Set(self.liveCategories.map(\.category)))
          c.categoryIdentifier = id
        }
        center.add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
      }
    }
    if !NSApp.isActive { NSApp.requestUserAttention(.informationalRequest) }
  }

  /// Sağ tık: seçim varsa Kopyala, bağlantı varsa Bağlantıyı Kopyala / Tarayıcıda Aç. Yeniden yükle ve incele yok.
  private func showContextMenu(_ m: [String: Any]) {
    let menu = NSMenu()
    if let text = m["text"] as? String, !text.isEmpty {
      let copy = NSMenuItem(title: L("Kopyala", "Copy"), action: #selector(copyContextLink(_:)), keyEquivalent: "")
      copy.target = self
      copy.representedObject = text
      menu.addItem(copy)
    }
    let href = m["href"] as? String ?? ""
    if !href.isEmpty {
      let copyLink = NSMenuItem(title: L("Bağlantıyı Kopyala", "Copy Link"), action: #selector(copyContextLink(_:)), keyEquivalent: "")
      copyLink.target = self
      copyLink.representedObject = href
      menu.addItem(copyLink)
      if let url = URL(string: href) {
        let open = NSMenuItem(title: L("Tarayıcıda Aç", "Open in Browser"), action: #selector(openContextLink(_:)), keyEquivalent: "")
        open.target = self
        open.representedObject = url
        menu.addItem(open)
      }
    }
    guard !menu.items.isEmpty, let win = window else { return }
    let x = CGFloat((m["x"] as? Double) ?? (m["x"] as? Int).map(Double.init) ?? 0)
    let y = CGFloat((m["y"] as? Double) ?? (m["y"] as? Int).map(Double.init) ?? 0)
    let z = max(webView.pageZoom, 0.1)
    let local = CGPoint(x: x * z, y: webView.isFlipped ? y * z : webView.bounds.height - y * z)
    let pt = webView.convert(local, to: nil)
    menu.popUp(positioning: nil, at: pt, in: win.contentView)
  }

  @objc private func copyContextLink(_ sender: NSMenuItem) {
    guard let s = sender.representedObject as? String else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(s, forType: .string)
  }

  @objc private func openContextLink(_ sender: NSMenuItem) {
    guard let url = sender.representedObject as? URL else { return }
    NSWorkspace.shared.open(url)
  }

  // Bildirim düğmesi JS'e geri döner (bildirim köprüsü AppDelegate'in bildirim temsilcisinden devralındı)
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    (NSApp.delegate as? AppDelegate)?.showMain()
    let id = response.actionIdentifier
    if id != UNNotificationDefaultActionIdentifier {
      let quoted = (try? JSONSerialization.data(withJSONObject: [id])).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
      js("window.dispatchEvent(new CustomEvent('kmy:notify-action',{detail:\(quoted)}))")
    }
    completionHandler()
  }

  // MARK: Gezinme: yerel sunucu uygulama içinde, dış siteler varsayılan tarayıcıda
  private func isLocal(_ url: URL?) -> Bool {
    guard let url else { return true }
    if ["about", "blob", "data"].contains(url.scheme ?? "") { return true }
    return ["127.0.0.1", "localhost", "::1"].contains(url.host ?? "")
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    if action.targetFrame?.isMainFrame != false, !isLocal(action.request.url), action.navigationType == .linkActivated || action.targetFrame == nil {
      if let u = action.request.url { NSWorkspace.shared.open(u) }
      return decisionHandler(.cancel)
    }
    if action.targetFrame?.isMainFrame == true, !isLocal(action.request.url) {
      if let u = action.request.url { NSWorkspace.shared.open(u) }
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    decisionHandler(!response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment") ? .download : .allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    guard isMain, (error as NSError).code != NSURLErrorCancelled else { return }
    (NSApp.delegate as? AppDelegate)?.connect()
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

  // target=_blank / window.open: yerel adresler yeni uygulama penceresinde, dışarısı tarayıcıda
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    guard let url = action.request.url else { return nil }
    if !isLocal(url) { NSWorkspace.shared.open(url); return nil }
    let popup = WebWindowController(url: nil, main: false, configuration: configuration)
    popups.append(popup)
    popup.showWindow(nil)
    popup.onClose = { [weak self, weak popup] in self?.popups.removeAll { $0 === popup } }
    return popup.webView
  }

  var onClose: (() -> Void)?
  func windowWillClose(_ notification: Notification) { onClose?() }

  // MARK: Pencere düğmeleri üst çubukta (46 px) dikey ortalı; tam ekranda ve etkin olmayan pencerede sayfaya bildirilir
  static let topbarHeight: CGFloat = 46
  func layoutTrafficLights() {
    guard isMain, let w = window, !w.styleMask.contains(.fullScreen),
          let close = w.standardWindowButton(.closeButton), let mini = w.standardWindowButton(.miniaturizeButton),
          let zoom = w.standardWindowButton(.zoomButton), let container = close.superview?.superview else { return }
    let h = WebWindowController.topbarHeight
    var f = container.frame
    f.size.height = h
    f.origin.y = w.frame.height - h
    container.frame = f
    for (i, b) in [close, mini, zoom].enumerated() {
      var r = b.frame
      r.origin.x = 16 + CGFloat(i) * 20
      r.origin.y = (h - r.height) / 2
      b.frame = r
    }
  }
  private func pageClass(_ name: String, _ on: Bool) {
    js("document.documentElement.classList.toggle('\(name)', \(on))")
  }
  func windowDidResize(_ notification: Notification) { layoutTrafficLights() }
  func windowDidBecomeKey(_ notification: Notification) { layoutTrafficLights(); pageClass("mac-inactive", false) }
  func windowDidResignKey(_ notification: Notification) { pageClass("mac-inactive", true) }
  func windowWillEnterFullScreen(_ notification: Notification) { pageClass("mac-fullscreen", true) }
  func windowDidExitFullScreen(_ notification: Notification) { pageClass("mac-fullscreen", false); layoutTrafficLights() }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    layoutTrafficLights()
    pageClass("mac-fullscreen", window?.styleMask.contains(.fullScreen) == true)
    pageClass("mac-inactive", window?.isKeyWindow != true)
  }

  func webViewDidClose(_ webView: WKWebView) { if !isMain { window?.close() } }

  // Dosya seçme (📎 ekler, CSV içe aktarma, rapor yükleme)
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = true
    panel.beginSheetModal(for: window!) { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert(); a.messageText = message; a.addButton(withTitle: L("Tamam", "OK"))
    a.beginSheetModal(for: window!) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = message; a.addButton(withTitle: L("Tamam", "OK")); a.addButton(withTitle: L("Vazgeç", "Cancel"))
    a.beginSheetModal(for: window!) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  // MARK: İndirmeler: ~/Downloads, aynı adda dosya varsa numaralandırılır; bitince Finder'da gösterilir
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let name = suggestedFilename.isEmpty ? L("indirilen", "download") : suggestedFilename
    var url = dir.appendingPathComponent(name)
    let base = url.deletingPathExtension().lastPathComponent, ext = url.pathExtension
    var n = 1
    while FileManager.default.fileExists(atPath: url.path) {
      n += 1
      url = dir.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)")
    }
    downloads[download] = url
    completionHandler(url)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let url = downloads.removeValue(forKey: download) else { return }
    NSWorkspace.shared.activateFileViewerSelecting([url])
    notify(title: L("İndirildi", "Downloaded"), body: url.lastPathComponent)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloads.removeValue(forKey: download)
    notify(title: L("İndirme başarısız", "Download failed"), body: error.localizedDescription)
  }

  // Sayfadaki uygulama kancalarını çağır (menü komutları)
  func js(_ code: String) {
    webView.evaluateJavaScript(code) { _, e in
      guard let e else { return }
      NSLog("[kmy] js hatası: \(e.localizedDescription) — \(code.prefix(160))")
    }
  }
}

/// WKUserContentController betik işleyicisini güçlü tutar; döngüyü kırmak için zayıf aracı
private final class WeakHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?
  init(_ t: WKScriptMessageHandler) { target = t }
  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) { target?.userContentController(ucc, didReceive: message) }
}

extension NSColor {
  convenience init?(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    self.init(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
  }
}

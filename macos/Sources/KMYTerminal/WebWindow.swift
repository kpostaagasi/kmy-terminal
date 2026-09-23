// Ana pencere: terminal arayüzünü WKWebView içinde gösterir.
// Web sayfası ile uygulama arasında köprü: bildirimler, Dock rozeti, tema, dosya seçme, indirme, dış bağlantılar.
import AppKit
import WebKit
import UserNotifications

/// Sayfaya belge başında eklenen betik: Notification API'yi macOS bildirimine, temayı pencere görünümüne bağlar
private let bridgeJS = """
(() => {
  const post = (m) => { try { window.webkit.messageHandlers.borsa.postMessage(m); } catch (e) {} };
  window.borsaNative = { platform: 'macos' };
  class NativeNotification {
    constructor(title, opts = {}) { post({ type: 'notify', title: String(title || ''), body: String(opts.body || '') }); }
    static get permission() { return 'granted'; }
    static requestPermission() { return Promise.resolve('granted'); }
    close() {}
  }
  window.Notification = NativeNotification;
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
  addEventListener('DOMContentLoaded', sync);
  addEventListener('load', sync);
})();
"""

final class WebWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
  let webView: WKWebView
  private let isMain: Bool
  private var popups: [WebWindowController] = []
  private var downloads: [WKDownload: URL] = [:]

  init(url: URL?, main: Bool, configuration: WKWebViewConfiguration? = nil) {
    isMain = main
    let config = configuration ?? WebWindowController.makeConfig()
    webView = WKWebView(frame: .zero, configuration: config)
    webView.allowsMagnification = true
    webView.allowsBackForwardNavigationGestures = false
    webView.setValue(false, forKey: "drawsBackground") // yüklenirken beyaz parlama olmasın
    if #available(macOS 13.3, *) { webView.isInspectable = true } // Safari › Geliştir ile incelenebilir

    let frame = NSRect(x: 0, y: 0, width: main ? 1440 : 1100, height: main ? 900 : 800)
    let window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    window.titlebarAppearsTransparent = true
    window.titleVisibility = main ? .hidden : .visible
    window.title = "KMY Terminal"
    window.minSize = NSSize(width: 760, height: 520)
    window.backgroundColor = NSColor(srgbRed: 0.055, green: 0.07, blue: 0.098, alpha: 1)
    window.tabbingMode = .disallowed
    super.init(window: window)

    // Başlık çubuğu yüksekliği kadar üst boşluk: trafik ışıkları sayfanın üstünde kalmasın
    let container = NSView()
    container.wantsLayer = true
    webView.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(webView)
    let top = NSLayoutConstraint(item: webView, attribute: .top, relatedBy: .equal, toItem: container, attribute: .top, multiplier: 1, constant: 28)
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
    body { margin: 0; height: 100vh; display: grid; place-items: center; font: 14px -apple-system, sans-serif; background: #0e1219; color: #e3e8f0; }
    @media (prefers-color-scheme: light) { body { background: #eaeef3; color: #121a26; } }
    .box { text-align: center; max-width: 440px; padding: 24px; }
    h1 { font-size: 18px; margin: 12px 0 6px; } p { opacity: .7; line-height: 1.5; margin: 0 0 18px; }
    .spin { width: 22px; height: 22px; border: 3px solid rgba(128,128,128,.3); border-top-color: #facc15; border-radius: 50%; margin: auto; animation: s .8s linear infinite; }
    @keyframes s { to { transform: rotate(360deg); } }
    button { background: #facc15; color: #1a1500; border: 0; border-radius: 8px; padding: 8px 16px; font-weight: 700; cursor: pointer; margin: 0 4px; }
    button.sec { background: rgba(128,128,128,.2); color: inherit; }
    </style></head><body><div class="box">
    \(retry ? "" : "<div class=\"spin\"></div>")
    <h1>\(title)</h1><p>\(detail)</p>
    \(retry ? "<button onclick=\"webkit.messageHandlers.borsa.postMessage({type:'retry'})\">Tekrar dene</button><button class=\"sec\" onclick=\"webkit.messageHandlers.borsa.postMessage({type:'logs'})\">Logları aç</button>" : "")
    </div></body></html>
    """
    webView.loadHTMLString(html, baseURL: nil)
  }

  func loadApp() { webView.load(URLRequest(url: Gateway.shared.baseURL)) }

  // MARK: Sayfadan gelen mesajlar
  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let m = message.body as? [String: Any], let type = m["type"] as? String else { return }
    switch type {
    case "notify":
      notify(title: m["title"] as? String ?? "KMY Terminal", body: m["body"] as? String ?? "")
    case "badge":
      NSApp.dockTile.badgeLabel = (m["text"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    case "theme":
      let dark = (m["theme"] as? String) != "light"
      window?.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
      if let c = NSColor(hex: m["bg"] as? String ?? "") { window?.backgroundColor = c }
    case "retry":
      (NSApp.delegate as? AppDelegate)?.connect()
    case "logs":
      NSWorkspace.shared.open(Gateway.shared.logURL)
    default: break
    }
  }

  private func notify(title: String, body: String) {
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
      guard ok else { return }
      let c = UNMutableNotificationContent()
      c.title = title
      c.body = body
      c.sound = .default
      center.add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
    }
    if !NSApp.isActive { NSApp.requestUserAttention(.informationalRequest) }
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
    let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "Tamam")
    a.beginSheetModal(for: window!) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "Tamam"); a.addButton(withTitle: "Vazgeç")
    a.beginSheetModal(for: window!) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  // MARK: İndirmeler: ~/Downloads, aynı adda dosya varsa numaralandırılır; bitince Finder'da gösterilir
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let name = suggestedFilename.isEmpty ? "indirilen" : suggestedFilename
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
    notify(title: "İndirildi", body: url.lastPathComponent)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloads.removeValue(forKey: download)
    notify(title: "İndirme başarısız", body: error.localizedDescription)
  }

  // Sayfadaki uygulama kancalarını çağır (menü komutları)
  func js(_ code: String) { webView.evaluateJavaScript(code, completionHandler: nil) }
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

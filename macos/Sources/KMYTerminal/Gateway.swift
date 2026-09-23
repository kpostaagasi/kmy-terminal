// Gateway: terminal sunucusunun (Node) çalıştığından emin olur.
// İki mod:
//  • Geliştirici modu (Info.plist'te KMYProjectRoot var): proje klasöründeki sunucu; kurulu launchd servisi varsa o kullanılır.
//  • Paket modu (DMG ile dağıtılan uygulama): Node, sunucu ve bağımlılıklar uygulamanın içindedir; veri ve çalışma alanı
//    ~/Library/Application Support/kmy terminal altında tutulur. Sunucu uygulamanın alt sürecidir (isteğe bağlı servis kurulabilir).
import Foundation

final class Gateway {
  static let shared = Gateway()

  let port: Int
  /// Sunucu kaynak klasörü (server/, web/, bin/ …)
  let projectRoot: URL
  let bundled: Bool
  let supportDir: URL
  private var child: Process?
  private var loginPath: String?

  var baseURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }
  var dataDir: URL { bundled ? supportDir.appendingPathComponent("data") : projectRoot.appendingPathComponent("data") }
  var workspaceDir: URL { bundled ? supportDir.appendingPathComponent("workspace") : projectRoot.appendingPathComponent("workspace") }
  var logURL: URL { dataDir.appendingPathComponent("logs/gateway.log") }
  var plistPath: String { NSHomeDirectory() + "/Library/LaunchAgents/com.kmyterminal.gateway.plist" }
  /// Kurulu launchd servisi bu uygulamanın sunucusunu mu çalıştırıyor? (başka bir kopyaya / proje klasörüne ait servis sayılmaz)
  var serviceInstalled: Bool {
    guard let text = try? String(contentsOfFile: plistPath, encoding: .utf8) else { return false }
    return text.contains(projectRoot.appendingPathComponent("server/index.js").path)
  }
  var ownsServer: Bool { child?.isRunning == true }

  /// Paket modunda uygulamanın içindeki Node; geliştirici modunda kullanıcının PATH'indeki node
  var nodeURL: URL? {
    let u = Bundle.main.resourceURL?.appendingPathComponent("node/bin/node")
    return u.flatMap { FileManager.default.isExecutableFile(atPath: $0.path) ? $0 : nil }
  }

  private init() {
    let d = UserDefaults.standard
    port = d.integer(forKey: "gatewayPort") > 0 ? d.integer(forKey: "gatewayPort") : 7420
    supportDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("kmy terminal")
    let built = Bundle.main.object(forInfoDictionaryKey: "KMYProjectRoot") as? String
    let embedded = Bundle.main.resourceURL?.appendingPathComponent("app")
    if built == nil, let embedded, FileManager.default.fileExists(atPath: embedded.appendingPathComponent("server/index.js").path) {
      bundled = true
      projectRoot = embedded
    } else {
      bundled = false
      projectRoot = URL(fileURLWithPath: d.string(forKey: "projectRoot") ?? built ?? FileManager.default.currentDirectoryPath)
    }
  }

  /// Sunucu yanıt veriyor mu? (401 de "çalışıyor" demektir: API anahtar ister)
  func isUp() async -> Bool {
    let req = URLRequest(url: baseURL.appendingPathComponent("api/health"), timeoutInterval: 1.5)
    do { let (_, res) = try await URLSession.shared.data(for: req); return (res as? HTTPURLResponse) != nil } catch { return false }
  }

  /// Sunucu durumu (menü çubuğu için): erişim anahtarı dosyasındaki anahtarla /api/health
  func status() async -> (Bool, [String: Any]) {
    var req = URLRequest(url: baseURL.appendingPathComponent("api/health"), timeoutInterval: 2)
    if let d = try? Data(contentsOf: dataDir.appendingPathComponent("gateway.json")),
       let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let t = j["token"] as? String {
      req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
    }
    do {
      let (data, res) = try await URLSession.shared.data(for: req)
      guard let http = res as? HTTPURLResponse else { return (false, [:]) }
      let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
      return (true, http.statusCode == 200 ? body : [:])
    } catch { return (false, [:]) }
  }

  // Menü çubuğu oturum ajanı: gateway servisi yüklü olduğu sürece (launchd OtherJobEnabled) uygulamayı menü çubuğunda tutar.
  // Yalnız dosya yazılır; bir sonraki oturum açılışında launchd yükler (şimdi yüklemek ikinci bir kopya başlatırdı).
  var menubarPlist: String { NSHomeDirectory() + "/Library/LaunchAgents/com.kmyterminal.menubar.plist" }
  func syncMenubarAgent() {
    let fm = FileManager.default
    guard serviceInstalled, let exe = Bundle.main.executablePath else {
      if fm.fileExists(atPath: menubarPlist) { try? fm.removeItem(atPath: menubarPlist) }
      return
    }
    let xml = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
    let plist = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <!-- kmy terminal menü çubuğu: gateway servisi yüklü olduğu sürece uygulama menü çubuğunda çalışır -->
    <plist version="1.0">
    <dict>
      <key>Label</key><string>com.kmyterminal.menubar</string>
      <key>ProgramArguments</key><array><string>\(xml(exe))</string><string>--menubar</string></array>
      <key>RunAtLoad</key><true/>
      <key>KeepAlive</key><dict><key>OtherJobEnabled</key><dict><key>com.kmyterminal.gateway</key><true/></dict></dict>
      <key>ProcessType</key><string>Interactive</string>
      <key>LimitLoadToSessionType</key><string>Aqua</string>
    </dict>
    </plist>
    """
    if (try? String(contentsOfFile: menubarPlist, encoding: .utf8)) != plist {
      try? fm.createDirectory(atPath: (menubarPlist as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
      try? plist.write(toFile: menubarPlist, atomically: true, encoding: .utf8)
    }
  }

  /// Servisi başlatır. "Durdur ve Çık" sonrası servis launchd'den kaldırılmış olur: kickstart yetmez, önce yeniden yüklenir.
  func startService(restart: Bool = false) {
    let target = "gui/\(getuid())/com.kmyterminal.gateway"
    if shell("launchctl print \(target)") != 0 { _ = shell("launchctl bootstrap gui/\(getuid()) '\(plistPath)'") }
    _ = shell("launchctl kickstart \(restart ? "-k " : "")\(target)")
  }

  /// Servis modunda gateway'i bu oturum için durdurur (kurulu kalır; sonraki oturum açılışında yeniden başlar)
  func stopService() { _ = shell("launchctl bootout gui/\(getuid())/com.kmyterminal.gateway") }

  /// Çalışmıyorsa başlatır ve en fazla ~30 sn hazır olmasını bekler
  func ensureRunning() async -> Bool {
    if await isUp() { return true }
    if bundled { prepareWorkspace() }
    if serviceInstalled { startService() } else { startChild() }
    for _ in 0..<60 {
      try? await Task.sleep(nanoseconds: 500_000_000)
      if await isUp() { return true }
      if !serviceInstalled, child?.isRunning == false { return false } // sunucu hemen kapandı: log'a bakılmalı
    }
    return false
  }

  func restart() async -> Bool {
    if serviceInstalled {
      startService(restart: true)
    } else {
      stopChild()
      startChild()
    }
    try? await Task.sleep(nanoseconds: 800_000_000)
    return await ensureRunning()
  }

  /// Sunucu ortamı: veri / çalışma alanı klasörleri, port ve PATH (paket içindeki node önce; claude / codex / omp kullanıcının kurduğu)
  private func serverEnv() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    env["BORSA_PORT"] = String(port)
    if bundled {
      env["BORSA_DATA_DIR"] = dataDir.path
      env["BORSA_WORKSPACE_DIR"] = workspaceDir.path
      var dirs: [String] = []
      if let n = nodeURL { dirs.append(n.deletingLastPathComponent().path) }
      dirs.append(userPath())
      env["PATH"] = dirs.joined(separator: ":")
    }
    return env
  }

  /// Kullanıcının giriş kabuğundaki PATH (claude / codex / omp / python3 bulunabilsin); Finder'dan açılan uygulamalar kısa PATH alır
  private func userPath() -> String {
    if let p = loginPath { return p }
    let fallback = "\(NSHomeDirectory())/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    let p = Process(), out = Pipe()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-lc", "printf %s \"$PATH\""]
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { loginPath = fallback; return fallback }
    let deadline = Date().addingTimeInterval(3)
    while p.isRunning && Date() < deadline { usleep(50_000) }
    if p.isRunning { p.terminate() }
    let s = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    loginPath = s.isEmpty ? fallback : "\(s):\(fallback)"
    return loginPath!
  }

  /// İlk açılışta şablon çalışma alanını kopyalar; sürüm değişince ajan talimatlarını, becerileri ve bilgi notlarını günceller.
  /// Kullanıcının dosyalarına (USER.md, raporlar, hafıza, belgeler) dokunulmaz.
  func prepareWorkspace() {
    let fm = FileManager.default
    let tpl = projectRoot.appendingPathComponent("workspace-template")
    guard fm.fileExists(atPath: tpl.path) else { return }
    try? fm.createDirectory(at: workspaceDir, withIntermediateDirectories: true)
    try? fm.createDirectory(at: dataDir.appendingPathComponent("logs"), withIntermediateDirectories: true)
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    let stamp = workspaceDir.appendingPathComponent(".kmy-version")
    let current = (try? String(contentsOf: stamp, encoding: .utf8)) ?? ""
    let managed = ["CLAUDE.md", "KURALLAR.md", ".claude/agents", ".claude/skills", "knowledge", "scripts"]
    for item in (try? fm.contentsOfDirectory(atPath: tpl.path)) ?? [] {
      let src = tpl.appendingPathComponent(item), dst = workspaceDir.appendingPathComponent(item)
      if !fm.fileExists(atPath: dst.path) { try? fm.copyItem(at: src, to: dst) }
    }
    if current != version {
      for rel in managed {
        let src = tpl.appendingPathComponent(rel), dst = workspaceDir.appendingPathComponent(rel)
        guard fm.fileExists(atPath: src.path) else { continue }
        try? fm.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? fm.removeItem(at: dst)
        try? fm.copyItem(at: src, to: dst)
      }
      try? version.write(to: stamp, atomically: true, encoding: .utf8)
    }
    // Codex / omp aynı talimatları AGENTS.md'den okur
    let agents = workspaceDir.appendingPathComponent("AGENTS.md")
    if (try? fm.destinationOfSymbolicLink(atPath: agents.path)) == nil && !fm.fileExists(atPath: agents.path) {
      try? fm.createSymbolicLink(atPath: agents.path, withDestinationPath: "CLAUDE.md")
    }
  }

  /// Servis kurulu değilse sunucu uygulamayla birlikte çalışır (uygulama kapanınca durur)
  private func startChild() {
    guard child?.isRunning != true else { return }
    let p = Process()
    if bundled, let node = nodeURL {
      p.executableURL = node
      p.arguments = [projectRoot.appendingPathComponent("server/index.js").path]
    } else {
      p.executableURL = URL(fileURLWithPath: "/bin/zsh")
      p.arguments = ["-lc", "exec node server/index.js"] // giriş kabuğu: kullanıcının PATH'i yüklensin
    }
    p.currentDirectoryURL = projectRoot
    try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
    if let h = try? FileHandle(forWritingTo: logURL) { h.seekToEndOfFile(); p.standardOutput = h; p.standardError = h }
    p.environment = serverEnv()
    do { try p.run(); child = p } catch { NSLog("Gateway başlatılamadı: \(error)") }
  }

  func stopChild() {
    guard let p = child, p.isRunning else { return }
    p.terminate()
    p.waitUntilExit()
    child = nil
  }

  /// Sunucuyu launchd servisi olarak kurar/kaldırır (uygulama kapalıyken de zamanlanmış görevler çalışsın)
  func setService(_ on: Bool) async -> Bool {
    let node = nodeURL?.path ?? "node"
    let cli = projectRoot.appendingPathComponent("bin/kmy").path
    if on { stopChild() }
    let env = serverEnv().map { "\($0.key)=\(shellQuote($0.value))" }.filter { $0.hasPrefix("BORSA_") || $0.hasPrefix("PATH=") }.joined(separator: " ")
    let code = shell("env \(env) \(shellQuote(node)) \(shellQuote(cli)) gateway \(on ? "install" : "uninstall")")
    if !on { startChild() }
    return code == 0
  }

  private func shellQuote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

  @discardableResult
  func shell(_ cmd: String) -> Int32 {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-lc", cmd]
    p.currentDirectoryURL = projectRoot
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    do { try p.run(); p.waitUntilExit(); return p.terminationStatus } catch { return -1 }
  }
}

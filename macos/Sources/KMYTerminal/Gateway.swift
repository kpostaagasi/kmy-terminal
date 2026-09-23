// Gateway: terminal sunucusunun (Node) çalıştığından emin olur.
// Önce launchd servisi (./bin/kmy gateway install ile kurulmuş) denenir; yoksa sunucu bu uygulamanın alt süreci olarak başlatılır.
import Foundation

final class Gateway {
  static let shared = Gateway()

  let port: Int
  let projectRoot: URL
  private var child: Process?

  var baseURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }
  var logURL: URL { projectRoot.appendingPathComponent("data/logs/gateway.log") }
  var serviceInstalled: Bool {
    FileManager.default.fileExists(atPath: NSHomeDirectory() + "/Library/LaunchAgents/com.kmyterminal.gateway.plist")
  }
  var ownsServer: Bool { child?.isRunning == true }

  private init() {
    let d = UserDefaults.standard
    port = d.integer(forKey: "gatewayPort") > 0 ? d.integer(forKey: "gatewayPort") : 7420
    // Proje klasörü: kullanıcı seçimi > derlemede Info.plist'e yazılan yol
    let saved = d.string(forKey: "projectRoot")
    let built = Bundle.main.object(forInfoDictionaryKey: "KMYProjectRoot") as? String
    projectRoot = URL(fileURLWithPath: saved ?? built ?? FileManager.default.currentDirectoryPath)
  }

  /// Sunucu yanıt veriyor mu? (401 de "çalışıyor" demektir: API anahtar ister)
  func isUp() async -> Bool {
    var req = URLRequest(url: baseURL.appendingPathComponent("api/health"), timeoutInterval: 1.5)
    req.httpMethod = "GET"
    do {
      let (_, res) = try await URLSession.shared.data(for: req)
      return (res as? HTTPURLResponse) != nil
    } catch { return false }
  }

  /// Çalışmıyorsa başlatır ve en fazla ~20 sn hazır olmasını bekler
  func ensureRunning() async -> Bool {
    if await isUp() { return true }
    if serviceInstalled {
      _ = shell("launchctl kickstart gui/\(getuid())/com.kmyterminal.gateway")
    } else {
      startChild()
    }
    for _ in 0..<40 {
      try? await Task.sleep(nanoseconds: 500_000_000)
      if await isUp() { return true }
    }
    return false
  }

  func restart() async -> Bool {
    if serviceInstalled {
      _ = shell("launchctl kickstart -k gui/\(getuid())/com.kmyterminal.gateway")
    } else {
      stopChild()
      startChild()
    }
    try? await Task.sleep(nanoseconds: 800_000_000)
    return await ensureRunning()
  }

  /// Servis kurulu değilse sunucu uygulamayla birlikte çalışır (uygulama kapanınca durur)
  private func startChild() {
    guard child?.isRunning != true else { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    // Giriş kabuğu: kullanıcının PATH'i (node, claude, codex, omp) yüklensin
    p.arguments = ["-lc", "exec node server/index.js"]
    p.currentDirectoryURL = projectRoot
    try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
    if let h = try? FileHandle(forWritingTo: logURL) { h.seekToEndOfFile(); p.standardOutput = h; p.standardError = h }
    var env = ProcessInfo.processInfo.environment
    env["BORSA_PORT"] = String(port)
    p.environment = env
    do { try p.run(); child = p } catch { NSLog("Gateway başlatılamadı: \(error)") }
  }

  func stopChild() {
    guard let p = child, p.isRunning else { return }
    p.terminate()
    p.waitUntilExit()
    child = nil
  }

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

// macOS uygulama güncellemesi: Sparkle 2 (EdDSA imzalı appcast + DMG).
// Yalnız Info.plist'te SUPublicEDKey varsa (imzalı resmî derleme) etkinleşir; yoksa
// web arayüzündeki bildirim + elle indirme kullanılır. Kullanıcı Ayarlar'dan kapatabilir
// (Sparkle'ın SUEnableAutomaticChecks tercihi; menüden elle kontrol her zaman çalışır).
import AppKit
import Sparkle

final class Updater {
  static let shared = Updater()
  private var controller: SPUStandardUpdaterController?

  var enabled: Bool { controller != nil }

  func start() {
    guard let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String, !key.isEmpty,
          Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") != nil else { return }
    controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
  }

  /// Menüden veya web arayüzünden ("checkForUpdates" mesajı)
  func checkForUpdates() {
    if let c = controller { c.checkForUpdates(nil) }
    else if let url = URL(string: "https://github.com/kpostaagasi/kmy-terminal/releases/latest") { NSWorkspace.shared.open(url) }
  }

  /// Otomatik kontrol tercihini ayarlar (opt-out)
  func setAutomaticChecks(_ on: Bool) { controller?.updater.automaticallyChecksForUpdates = on }
}

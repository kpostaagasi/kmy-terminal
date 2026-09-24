// Arayüz dili: web sayfası çözümlediği dili ("lang" mesajı) bildirir ve UserDefaults'ta saklanır;
// henüz bildirilmediyse sistem dili kullanılır. Türkçe dışındaki her dil İngilizceye düşer.
import Foundation

enum L10n {
  private static let key = "uiLanguage"
  /// Sistemin tercih ettiği ilk dil (ör. "tr-TR", "en-US"); web sayfasına window.__kmySystemLang olarak verilir
  static var systemCode: String { Locale.preferredLanguages.first ?? "tr" }
  static var isTurkish: Bool {
    if let v = UserDefaults.standard.string(forKey: key) { return v == "tr" }
    return systemCode.lowercased().hasPrefix("tr")
  }
  /// Sayfadan gelen dili saklar; önceki değerden farklıysa true döner (menüler yeniden kurulur)
  static func set(_ lang: String) -> Bool {
    guard lang == "tr" || lang == "en" else { return false }
    let changed = isTurkish != (lang == "tr")
    UserDefaults.standard.set(lang, forKey: key)
    return changed
  }
}

/// Yerelleştirilmiş metin: L("Türkçe", "English")
func L(_ tr: String, _ en: String) -> String { L10n.isTurkish ? tr : en }

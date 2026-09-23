// Uygulama girişi: AppKit uygulaması, menü çubuğu ve tek ana pencere
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

// swift-tools-version:5.10
// kmy terminal — macOS uygulaması (AppKit + WKWebView). Derleme: ./scripts/build-mac.sh
import PackageDescription

let package = Package(
  name: "KMYTerminal",
  platforms: [.macOS(.v14)],
  dependencies: [.package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0")],
  targets: [
    .executableTarget(
      name: "KMYTerminal",
      dependencies: [.product(name: "Sparkle", package: "Sparkle")],
      path: "Sources/KMYTerminal",
      linkerSettings: [.linkedFramework("WebKit"), .linkedFramework("UserNotifications")]
    ),
    .executableTarget(name: "IconGen", path: "Sources/IconGen"),
  ]
)

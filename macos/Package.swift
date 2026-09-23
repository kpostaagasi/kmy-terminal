// swift-tools-version:5.10
// kmy terminal — macOS uygulaması (AppKit + WKWebView). Derleme: ./scripts/build-mac.sh
import PackageDescription

let package = Package(
  name: "KMYTerminal",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "KMYTerminal",
      path: "Sources/KMYTerminal",
      linkerSettings: [.linkedFramework("WebKit"), .linkedFramework("UserNotifications")]
    ),
    .executableTarget(name: "IconGen", path: "Sources/IconGen"),
  ]
)

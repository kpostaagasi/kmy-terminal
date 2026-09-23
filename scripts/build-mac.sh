#!/usr/bin/env bash
# kmy terminal macOS uygulamasını derler: dist/kmy terminal.app
# Kullanım: ./scripts/build-mac.sh [--install]   (--install: ~/Applications altına kopyalar)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="kmy terminal"
# KMY_APP_OUT: çıktı klasörü (DMG derlemesi ayrı klasör kullanır); KMY_BUNDLE=1: proje yolu yazılmaz (paket modu)
APP="${KMY_APP_OUT:-$ROOT/dist}/$NAME.app"
VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo 0.0.0)"
BUILD="$(date +%Y%m%d%H%M)"

command -v swift >/dev/null || { echo "Swift bulunamadı: Xcode veya Command Line Tools kurun (xcode-select --install)"; exit 1; }

echo "› Swift derleniyor (release)…"
cd "$ROOT/macos"
swift build -c release --product KMYTerminal
swift build -c release --product IconGen
BIN="$(swift build -c release --show-bin-path)"

echo "› Uygulama paketi hazırlanıyor…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN/KMYTerminal" "$APP/Contents/MacOS/KMYTerminal"

# Simge: 1024 px PNG → tüm boyutlar → .icns
TMP="$(mktemp -d)"
"$BIN/IconGen" "$TMP/icon.png" >/dev/null
SET="$TMP/AppIcon.iconset"; mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$TMP/icon.png" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$TMP"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleIdentifier</key><string>com.kmyterminal.app</string>
  <key>CFBundleExecutable</key><string>KMYTerminal</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD</string>
  <key>CFBundleDevelopmentRegion</key><string>tr</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>NSHumanReadableCopyright</key><string>kmy terminal · Analizler yatırım tavsiyesi değildir.</string>
$( [[ "${KMY_BUNDLE:-}" == 1 ]] || echo "  <key>KMYProjectRoot</key><string>$ROOT</string>")
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

echo "› Yerel imza (ad-hoc)…"
codesign --force --deep --sign - "$APP" >/dev/null

echo "✓ Hazır: $APP ($VERSION)"

if [[ "${1:-}" == "--install" ]]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
  rm -rf "$DEST/$NAME.app"
  cp -R "$APP" "$DEST/"
  echo "✓ Kuruldu: $DEST/$NAME.app"
fi

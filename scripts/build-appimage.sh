#!/usr/bin/env bash
# Linux: kendi Node'unu taşıyan imzasız AppImage → dist/kmy-terminal-<sürüm>-x86_64.AppImage
# Çalışınca sunucuyu başlatır ve tarayıcıyı açar (bin/start.mjs). Veri: ~/.local/share/kmy-terminal
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ARCH="$(uname -m)"
APPDIR="$ROOT/dist/AppDir"
OUT="$ROOT/dist/kmy-terminal-$VERSION-$ARCH.AppImage"
rm -rf "$APPDIR"; mkdir -p "$APPDIR/usr/bin" "$APPDIR/app"
cp "$(command -v node)" "$APPDIR/usr/bin/node"
for d in bin server web workspace scripts package.json package-lock.json LICENSE README.md; do [ -e "$ROOT/$d" ] && cp -R "$ROOT/$d" "$APPDIR/app/"; done
(cd "$APPDIR/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null && node scripts/postinstall.mjs 2>/dev/null || true)
cp "$ROOT/packaging/linux/AppRun" "$APPDIR/AppRun"; chmod +x "$APPDIR/AppRun"
cp "$ROOT/packaging/linux/kmy-terminal.desktop" "$APPDIR/"
cp "$ROOT/web/icon-512.png" "$APPDIR/kmy-terminal.png"
TOOL="${APPIMAGETOOL:-$ROOT/dist/appimagetool}"
if [ ! -x "$TOOL" ]; then
  curl -fsSL -o "$TOOL" "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-$ARCH.AppImage"; chmod +x "$TOOL"
fi
ARCH="$ARCH" APPIMAGE_EXTRACT_AND_RUN=1 "$TOOL" "$APPDIR" "$OUT"
echo "› $OUT"

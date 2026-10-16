#!/usr/bin/env bash
# kmy terminal: kuruluma hazır DMG üretir → dist/kmy-terminal-<sürüm>-arm64.dmg
# Paket kendi Node'unu, sunucuyu, arayüzü ve bağımlılıkları taşır; veriler kullanıcının
# ~/Library/Application Support/kmy terminal klasöründe tutulur. Claude Code gömülü DEĞİLDİR:
# ajan için kullanıcının Mac'inde `claude` kurulu olmalıdır (codex isteğe bağlı).
# Kullanım: ./scripts/build-dmg.sh      (NODE_BIN=/yol/node ile başka bir Node ikilisi seçilebilir)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="kmy terminal"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ARCH="$(uname -m)"
OUT="$ROOT/dist/dmg-build"
APP="$OUT/$NAME.app"
RES="$APP/Contents/Resources"
DMG="$ROOT/dist/kmy-terminal-$VERSION-$ARCH.dmg"
say() { printf '\033[1m› %s\033[0m\n' "$*"; }

[[ "$ARCH" == arm64 ]] || echo "Uyarı: $ARCH üzerinde derleniyor; paket yalnız bu mimaride çalışır." >&2
NODE_BIN="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${NODE_BIN:-$(command -v node)}")"
NODE_VER="$("$NODE_BIN" -v)"
NODE_MAJOR="${NODE_VER#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
(( NODE_MAJOR >= 22 )) || { echo "Node 22.13+ gerekli (bulunan: $NODE_VER)" >&2; exit 1; }

say "Uygulama kabuğu derleniyor (paket modu)…"
rm -rf "$OUT"; mkdir -p "$OUT"
KMY_BUNDLE=1 KMY_APP_OUT="$OUT" "$ROOT/scripts/build-mac.sh" >/dev/null

say "Sunucu, arayüz ve çalışma alanı şablonu kopyalanıyor…"
mkdir -p "$RES/app"
rsync -a --exclude '.DS_Store' "$ROOT/server" "$ROOT/web" "$ROOT/bin" "$ROOT/LICENSE" "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/CHANGELOG.md" "$ROOT/README.md" "$RES/app/"
mkdir -p "$RES/app/scripts" && cp "$ROOT/scripts/postinstall.mjs" "$RES/app/scripts/"
# Şablon: yalnız ürün içeriği (talimatlar, beceriler, alt ajanlar, bilgi notları, betikler, boş kullanıcı profili)
rsync -a --exclude '.DS_Store' --exclude 'reports' --exclude 'hafiza' --exclude 'belgeler' --exclude 'uploads' --exclude '.omp' \
  --exclude 'tahminler.md' --exclude 'AGENTS.md' --exclude 'settings.local.json' --exclude '__pycache__' "$ROOT/workspace/" "$RES/app/workspace-template/"

say "Üretim bağımlılıkları kuruluyor (npm ci --omit=dev --ignore-scripts; yaşam döngüsü betikleri çalışmaz)…"
(cd "$RES/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null)
# Claude Code ikilisi pakete girmez (kullanıcının kurduğu `claude` kullanılır); başka platformların ikilileri de atılır
rm -rf "$RES/app/node_modules/@anthropic-ai/"claude-agent-sdk-*
find "$RES/app/node_modules/node-pty/prebuilds" -mindepth 1 -maxdepth 1 ! -name "darwin-$ARCH" -exec rm -rf {} +
rm -rf "$RES/app/node_modules/node-pty/"{deps,third_party,src,scripts,binding.gyp}
chmod +x "$RES/app/node_modules/node-pty/prebuilds/darwin-$ARCH/spawn-helper" 2>/dev/null || true
chmod +x "$RES/app/bin/"*

say "Node $NODE_VER ekleniyor…"
mkdir -p "$RES/node/bin"
cp "$NODE_BIN" "$RES/node/bin/node"
# Homebrew/official dağıtımlarda node ikilisi ../lib/libnode.*.dylib'e bağlıdır; ikili tek başına çalışmaz.
NODE_LIB="$(cd "$(dirname "$NODE_BIN")/.." && pwd)/lib"
if [ -d "$NODE_LIB" ] && ls "$NODE_LIB"/libnode*.dylib >/dev/null 2>&1; then
  say "Node kitaplıkları ekleniyor…"
  mkdir -p "$RES/node/lib"
  cp "$NODE_LIB"/libnode*.dylib "$RES/node/lib/"
fi
cat > "$RES/node/NOTICE.txt" <<TXT
Bu klasördeki node ikilisi Node.js $NODE_VER'dir (https://nodejs.org). Node.js MIT lisanslıdır.
TXT

say "İmzalanıyor (ad-hoc)…"
# Paket içindeki tüm Mach-O dosyaları (node, .node eklentileri, spawn-helper) tek tek, ardından uygulama
while IFS= read -r -d '' f; do
  if file -b "$f" | grep -q 'Mach-O'; then codesign --force --sign - "$f" 2>/dev/null; fi
done < <(find "$RES" -type f \( -perm -u+x -o -name '*.node' -o -name '*.dylib' \) -print0)
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"

say "DMG hazırlanıyor…"
STAGE="$OUT/stage"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/Önce Beni Oku.txt" <<TXT
kmy terminal $VERSION — yapay zekâ destekli BIST terminali

KURULUM
1. "kmy terminal" simgesini yandaki Applications (Uygulamalar) klasörüne sürükleyin.
2. Uygulamalar klasöründen kmy terminal'i açın.

İLK AÇILIŞ (uygulama Apple tarafından onaylı bir geliştirici imzası taşımaz)
macOS "Apple, kmy terminal'in zararlı yazılım içermediğini doğrulayamıyor" derse:
  • Sistem Ayarları › Gizlilik ve Güvenlik bölümüne gidin, aşağıdaki "Yine de Aç" düğmesine basın.
  • veya Terminal'de şu komutu çalıştırın, sonra uygulamayı yeniden açın:
      xattr -dr com.apple.quarantine "/Applications/kmy terminal.app"

GEREKSİNİMLER
  • Apple Silicon (M1 veya üstü) Mac, macOS 14 veya üstü.
  • Yapay zekâ ajanı için Claude Code kurulu olmalı: https://claude.com/download
    (veya Terminal'de: curl -fsSL https://claude.ai/install.sh | bash). Kurduktan sonra Terminal'de
    "claude" yazıp Claude hesabınızla bir kez giriş yapın.
  • İsteğe bağlı: ChatGPT/Codex (codex).
  • Piyasa verisi, KAP, kurum raporları, portföy ve watchlist ajan olmadan da çalışır.

VERİLER
Portföy, ayarlar, raporlar ve ajan notları bu Mac'te tutulur:
  ~/Library/Application Support/kmy terminal
Uygulamayı silmek verileri silmez.

Analizler yatırım tavsiyesi değildir.
TXT

rm -f "$DMG"
hdiutil create -volname "$NAME" -srcfolder "$STAGE" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$DMG" >/dev/null
rm -rf "$STAGE"
echo "✓ DMG: $DMG ($(du -h "$DMG" | cut -f1))"
echo "  Uygulama boyutu: $(du -sh "$APP" | cut -f1)"

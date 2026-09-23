#!/bin/sh
# kmy terminal kurulumu: bağımlılıklar + Gateway servisi (macOS LaunchAgent / Linux systemd --user).
# Tekrar çalıştırılabilir (idempotent); sudo kullanmaz.
#   sh scripts/install.sh              → npm install + servis kurulumu
#   sh scripts/install.sh --link       → ayrıca `kmy` komutunu npm link ile PATH'e ekler
#   sh scripts/install.sh --no-service → yalnız bağımlılıklar
#   sh scripts/install.sh --dry-run    → servis dosyasını ve komutları yazdırır, kurmaz
set -eu

DIR=$(cd "$(dirname "$0")/.." && pwd)
LINK=0; SERVICE=1; DRY=""
for a in "$@"; do
  case "$a" in
    --link) LINK=1 ;;
    --no-service) SERVICE=0 ;;
    --dry-run) DRY="--dry-run" ;;
    -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Bilinmeyen seçenek: $a" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" = "0" ]; then
  echo "Bu betiği root/sudo ile çalıştırmayın; servis kullanıcı hesabınıza kurulur." >&2
  exit 1
fi

say() { printf '\033[1m→ %s\033[0m\n' "$1"; }

# 1) Node >= 22.13 ve npm
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js bulunamadı. Node 22.13 veya üstünü kurun: https://nodejs.org (macOS: brew install node)" >&2
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "Node $(node -v) eski. kmy terminal Node 22.13 veya üstünü ister." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm bulunamadı (Node ile birlikte gelir). Node kurulumunuzu kontrol edin." >&2
  exit 1
fi
say "Node $(node -v) · npm $(npm -v)"

# 2) Bağımlılıklar
say "Bağımlılıklar kuruluyor (npm install)"
if [ -n "$DRY" ]; then echo "\$ (cd $DIR && npm install)"; else (cd "$DIR" && npm install --no-fund --no-audit); fi
chmod +x "$DIR/bin/kmy" 2>/dev/null || true

# 3) CLI
if [ "$LINK" = "1" ]; then
  say "kmy komutu bağlanıyor (npm link)"
  if [ -n "$DRY" ]; then echo "\$ (cd $DIR && npm link)"
  elif ! (cd "$DIR" && npm link --no-fund --no-audit >/dev/null 2>&1); then
    echo "npm link yetki istedi (genel npm klasörü yazılamıyor). sudo kullanmayın; bunun yerine:" >&2
    echo "  alias kmy=\"$DIR/bin/kmy\"   # ~/.zshrc veya ~/.bashrc dosyanıza ekleyin" >&2
  fi
fi

# 4) Gateway servisi
if [ "$SERVICE" = "1" ]; then
  say "Gateway servisi kuruluyor"
  node "$DIR/bin/kmy" gateway install $DRY
fi

PORT="${BORSA_PORT:-${PORT:-7420}}"
echo
say "Hazır: http://127.0.0.1:$PORT"
if command -v borsa >/dev/null 2>&1; then CLI="borsa"; else CLI="$DIR/bin/kmy"; fi
echo "  Durum : $CLI gateway status"
echo "  Loglar: $CLI gateway logs -f"
echo "  Aç    : $CLI gateway open"
[ "$SERVICE" = "1" ] || echo "  Servis kurulmadı; elle başlatmak için: npm start"

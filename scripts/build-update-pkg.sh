#!/usr/bin/env bash
# Tek tıkla güncelleme paketi: kmy-terminal-<sürüm>.tgz (package/ önekli, package-lock.json DAHİL).
# npm pack kilit dosyasını paketlemiyor; istemci "npm ci" çalıştırdığı için kilit dosyası şart.
# Kullanım: scripts/build-update-pkg.sh <çıktı-klasörü>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?çıktı klasörü}"
V="$(node -p "require('$ROOT/package.json').version")"
mkdir -p "$OUT"
git -C "$ROOT" archive --format=tar --prefix=package/ HEAD \
  bin server web workspace scripts package.json package-lock.json LICENSE README.md CHANGELOG.md \
  | gzip -9 > "$OUT/kmy-terminal-$V.tgz"
echo "$OUT/kmy-terminal-$V.tgz"

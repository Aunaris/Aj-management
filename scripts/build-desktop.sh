#!/usr/bin/env bash
# สร้างโปรแกรมแบบพกพาสำหรับ PC (ไม่ต้องติดตั้ง Node.js)
# ใช้: bash scripts/build-desktop.sh [win-x64] [darwin-arm64] [darwin-x64]
# ผลลัพธ์: dist/AnimationClassroom-<target>.zip
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.23.4}"   # ต้องเป็น Node 22.5+ (มี node:sqlite)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
CACHE="$DIST/.cache"
TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=(win-x64 darwin-arm64 darwin-x64)
NAME="AnimationClassroom"
mkdir -p "$DIST" "$CACHE"

# 1) ไฟล์โปรแกรม + dependency แบบ pure JS (ไม่รวม better-sqlite3 — ใช้ node:sqlite แทน)
APPSTAGE="$CACHE/app"
rm -rf "$APPSTAGE"
mkdir -p "$APPSTAGE"
cp -R "$ROOT/src" "$ROOT/views" "$ROOT/public" "$ROOT/package.json" "$ROOT/package-lock.json" "$APPSTAGE/"
(cd "$APPSTAGE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
rm -rf "$APPSTAGE/node_modules/better-sqlite3" "$APPSTAGE/node_modules/.package-lock.json"

for T in "${TARGETS[@]}"; do
  echo "== $T"
  OUT="$DIST/$NAME-$T"
  rm -rf "$OUT" "$OUT.zip"
  mkdir -p "$OUT/runtime"
  cp -R "$APPSTAGE" "$OUT/app"
  case "$T" in
    win-x64)
      PKG="node-v$NODE_VERSION-win-x64"
      [ -f "$CACHE/$PKG.zip" ] || curl -fsSL -o "$CACHE/$PKG.zip" "https://nodejs.org/dist/v$NODE_VERSION/$PKG.zip"
      unzip -q -o -j "$CACHE/$PKG.zip" "$PKG/node.exe" "$PKG/LICENSE" -d "$OUT/runtime"
      cp "$ROOT/desktop/Start.bat" "$OUT/Start.bat"
      ;;
    darwin-arm64|darwin-x64)
      PKG="node-v$NODE_VERSION-$T"
      [ -f "$CACHE/$PKG.tar.gz" ] || curl -fsSL -o "$CACHE/$PKG.tar.gz" "https://nodejs.org/dist/v$NODE_VERSION/$PKG.tar.gz"
      tar -xzf "$CACHE/$PKG.tar.gz" -C "$OUT/runtime" --strip-components=2 "$PKG/bin/node"
      tar -xzf "$CACHE/$PKG.tar.gz" -C "$OUT/runtime" --strip-components=1 "$PKG/LICENSE"
      cp "$ROOT/desktop/Start.command" "$OUT/Start.command"
      chmod +x "$OUT/Start.command" "$OUT/runtime/node"
      ;;
    *) echo "unknown target $T"; exit 1 ;;
  esac
  cp "$ROOT/desktop/README.txt" "$OUT/README.txt"
  (cd "$DIST" && zip -q -r -X "$NAME-$T.zip" "$NAME-$T")
  rm -rf "$OUT"
  echo "   -> dist/$NAME-$T.zip ($(du -h "$DIST/$NAME-$T.zip" | cut -f1))"
done

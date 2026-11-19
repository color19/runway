#!/bin/bash
# Builds "Runway.app" into ~/Applications and opens it.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "需要先装 Xcode 命令行工具：运行 xcode-select --install，装完再跑一次。"
  exit 1
fi

APP="$HOME/Applications/Runway.app"
pkill -x Runway 2>/dev/null || true
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "编译中，大约半分钟…"
swiftc -O Runway.swift -o "$APP/Contents/MacOS/Runway" -framework Cocoa -framework WebKit

ICON=$(mktemp -d)/Runway.iconset
mkdir -p "$ICON"
for s in 16 32 128 256 512; do
  sips -z $s $s icon.png --out "$ICON/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) icon.png --out "$ICON/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICON" -o "$APP/Contents/Resources/Runway.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Runway</string>
  <key>CFBundleDisplayName</key><string>Runway</string>
  <key>CFBundleIdentifier</key><string>local.color.runway</string>
  <key>CFBundleExecutable</key><string>Runway</string>
  <key>CFBundleIconFile</key><string>Runway</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

codesign --force --sign - "$APP" >/dev/null 2>&1 || true
touch "$APP"
echo "好了：$APP"
open "$APP"

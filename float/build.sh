#!/bin/bash
# Builds "Runway Float.app" into ~/Applications and opens it.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "需要先装 Xcode 命令行工具：运行 xcode-select --install，装完再跑一次。"
  exit 1
fi

APP="$HOME/Applications/Runway Float.app"
pkill -x RunwayFloat 2>/dev/null || true
mkdir -p "$APP/Contents/MacOS"

echo "编译中，大约半分钟…"
swiftc -O RunwayFloat.swift -o "$APP/Contents/MacOS/RunwayFloat" -framework Cocoa -framework SwiftUI -framework WebKit

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Runway Float</string>
  <key>CFBundleDisplayName</key><string>Runway Float</string>
  <key>CFBundleIdentifier</key><string>local.color.runwayfloat</string>
  <key>CFBundleExecutable</key><string>RunwayFloat</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>6</string>
  <key>CFBundleShortVersionString</key><string>5.1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSRemindersUsageDescription</key><string>把 Runway 接下来两周的任务放进一个叫 Runway 的提醒列表，在手机上勾掉也会同步回 Runway。</string>
  <key>NSRemindersFullAccessUsageDescription</key><string>把 Runway 接下来两周的任务放进一个叫 Runway 的提醒列表，在手机上勾掉也会同步回 Runway。</string>
  <key>NSCalendarsUsageDescription</key><string>把 Runway 接下来两周的安排写进一个叫 Runway 的日历，手机上也能看到。</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>把 Runway 接下来两周的安排写进一个叫 Runway 的日历，手机上也能看到。</string>
</dict></plist>
PLIST

rm -rf "$APP/Contents/Resources/sounds" && mkdir -p "$APP/Contents/Resources/sounds"
cp ../app/sounds/*.mp3 "$APP/Contents/Resources/sounds/"

codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "好了：$APP"
open "$APP"

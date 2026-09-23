#!/bin/bash
# Build Clinical Typing Drills.app into app/build.
#
#   ./app/build.sh           compile the shell, copy the page, build the word list and icon
#
# The page in web/ is copied verbatim: the code the tests run is the code that
# ships. Nothing here installs anything; install.sh does that.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="Clinical Typing Drills"
BUNDLE_ID="dev.kaleb.clinical-typing-drills"
VERSION="1.0.0"
OUT="app/build"
APP="$OUT/$APP_NAME.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

echo "compiling the shell"
swiftc -swift-version 5 -O \
  -target "$(uname -m)-apple-macosx13.0" \
  -o "$APP/Contents/MacOS/ClinicalTypingDrills" \
  app/Sources/main.swift

echo "copying the page"
cp web/*.html web/*.js web/*.css "$APP/Contents/Resources/web/"

echo "building the word list from this Mac's dictionary"
LC_ALL=C tr 'A-Z' 'a-z' < /usr/share/dict/words \
  | LC_ALL=C grep -E '^[a-z]{2,}$' \
  | LC_ALL=C sort -u > "$APP/Contents/Resources/web/words.txt"
echo "  $(wc -l < "$APP/Contents/Resources/web/words.txt" | tr -d ' ') words"

echo "drawing the icon"
ICONSET="$OUT/AppIcon.iconset"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
swift app/make-icon.swift "$OUT/icon-1024.png" >/dev/null
for s in 16 32 128 256 512; do
  sips -z $s $s "$OUT/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$OUT/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleExecutable</key><string>ClinicalTypingDrills</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Built for one clinician's own practice.</string>
</dict>
</plist>
PLIST

echo "signing (ad hoc, this Mac only)"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
echo "built $APP"

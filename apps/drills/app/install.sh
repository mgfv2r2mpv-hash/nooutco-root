#!/bin/bash
# Install Clinical Typing Drills into /Applications.
#
#   ./app/install.sh              build, then install
#   ./app/install.sh --no-build   install what is already in app/build
#   ./app/install.sh --launch     open it afterwards
#
# If the app is open it is asked to quit first (your drills are saved after
# every drill, so nothing is lost). Your data lives apart from the app, in
# ~/Library/Application Support/Clinical Typing Drills, and an install never
# touches it.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="Clinical Typing Drills.app"
SRC="app/build/$NAME"
DEST="/Applications/$NAME"
BUILD=1; LAUNCH=0
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --launch) LAUNCH=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[[ $BUILD == 1 ]] && ./app/build.sh
[[ -d "$SRC" ]] || { echo "no build at $SRC; run ./app/build.sh" >&2; exit 1; }
if pgrep -x ClinicalTypingDrills >/dev/null; then
  echo "asking the open copy to quit"
  osascript -e 'tell application "Clinical Typing Drills" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 50); do pgrep -x ClinicalTypingDrills >/dev/null || break; sleep 0.1; done
fi
rm -rf "$DEST"
ditto "$SRC" "$DEST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST" >/dev/null 2>&1 || true
echo "installed $DEST"
[[ $LAUNCH == 1 ]] && open "$DEST"
exit 0

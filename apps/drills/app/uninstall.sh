#!/bin/bash
# Remove Clinical Typing Drills from this Mac.
#
#   ./app/uninstall.sh          remove the app, KEEP your drill history and kept answers
#   ./app/uninstall.sh --data   also move your data folder to the Trash
#
# Answers you kept are also in your voice corpus (drill register); uninstalling
# the app never touches the corpus.
set -euo pipefail
DEST="/Applications/Clinical Typing Drills.app"
DATA="$HOME/Library/Application Support/Clinical Typing Drills"
WITH_DATA=0
for arg in "$@"; do
  case "$arg" in
    --data) WITH_DATA=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
if pgrep -x ClinicalTypingDrills >/dev/null; then
  osascript -e 'tell application "Clinical Typing Drills" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 50); do pgrep -x ClinicalTypingDrills >/dev/null || break; sleep 0.1; done
fi
if [[ -d "$DEST" ]]; then rm -rf "$DEST"; echo "removed $DEST"; else echo "not installed"; fi
if [[ $WITH_DATA == 1 && -d "$DATA" ]]; then
  mv "$DATA" "$HOME/.Trash/Clinical Typing Drills data $(date +%Y%m%d-%H%M%S)"
  echo "moved your data to the Trash"
elif [[ -d "$DATA" ]]; then
  echo "kept your data at $DATA (pass --data to move it to the Trash)"
fi

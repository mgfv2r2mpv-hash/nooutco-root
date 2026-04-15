#!/usr/bin/env bash
# push-images-in-batches.sh
#
# Pushes all image files from FamousGame/FamousPerson/images/ in small batches
# to avoid "remote disconnected" failures on large binary pushes.
#
# Run from the repo root:
#   bash IDMatchGame/push-images-in-batches.sh

set -euo pipefail

BATCH_SIZE=20
IMAGES_DIR="FamousGame/FamousPerson/images"
HTML_PATH="FamousGame/FamousPerson/TheGame.html"
MAP_PATH="FamousGame/FamousPerson/image-map.json"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "Branch: $BRANCH"
echo ""

# ── Step 1: Update TheGame.html with local image paths ──────────────────────
echo "Running update-image-paths.js..."
node IDMatchGame/update-image-paths.js
echo ""

# ── Step 2: Collect image files that need to be pushed ───────────────────────
# Use find on disk — don't trust git status, which can show files as
# "modified to 0 bytes" after a bad merge even when the real files exist.
ALL_IMAGES=()
while IFS= read -r f; do
  # Only include files with actual content (size > 0)
  if [ -s "$f" ]; then
    ALL_IMAGES+=("$f")
  fi
done < <(find "$IMAGES_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" -o -iname "*.gif" \) | sort)

TOTAL=${#ALL_IMAGES[@]}
echo "Found $TOTAL image file(s) with content to push."
echo ""

if [ "$TOTAL" -eq 0 ]; then
  echo "No images found in $IMAGES_DIR — nothing to push."
else
  # ── Step 3: Push images in batches ─────────────────────────────────────────
  BATCH_NUM=0
  I=0
  while [ $I -lt $TOTAL ]; do
    BATCH_NUM=$((BATCH_NUM + 1))
    END=$((I + BATCH_SIZE))
    if [ $END -gt $TOTAL ]; then END=$TOTAL; fi
    BATCH=("${ALL_IMAGES[@]:$I:$((END - I))}")

    echo "Pushing batch $BATCH_NUM: images $((I+1))–$END of $TOTAL..."
    git add -- "${BATCH[@]}"

    # Only commit if there's something staged
    if ! git diff --cached --quiet; then
      git commit -m "feat: add Famous Person images batch $BATCH_NUM ($((END - I)) files)"
      for ATTEMPT in 1 2 3 4; do
        if git push -u origin "$BRANCH"; then
          break
        else
          if [ $ATTEMPT -lt 4 ]; then
            WAIT=$((ATTEMPT * ATTEMPT * 2))
            echo "  Push failed (attempt $ATTEMPT). Retrying in ${WAIT}s..."
            sleep $WAIT
          else
            echo "  Push failed after 4 attempts. Run 'git push -u origin $BRANCH' manually."
            exit 1
          fi
        fi
      done
    else
      echo "  (batch already up to date — skipping)"
    fi

    I=$END
  done
fi

# ── Step 4: Commit and push TheGame.html ─────────────────────────────────────
git add -- "$HTML_PATH"
if [ -f "$MAP_PATH" ]; then
  git rm --cached "$MAP_PATH" 2>/dev/null || true
fi

if ! git diff --cached --quiet; then
  echo ""
  echo "Pushing updated TheGame.html..."
  git commit -m "feat: wire up self-hosted Famous Person images in TheGame.html"
  for ATTEMPT in 1 2 3 4; do
    if git push -u origin "$BRANCH"; then
      break
    else
      if [ $ATTEMPT -lt 4 ]; then
        WAIT=$((ATTEMPT * ATTEMPT * 2))
        echo "  Push failed (attempt $ATTEMPT). Retrying in ${WAIT}s..."
        sleep $WAIT
      else
        echo "  Push failed after 4 attempts."
        exit 1
      fi
    fi
  done
fi

echo ""
echo "Done! All images and TheGame.html pushed to $BRANCH."

#!/usr/bin/env bash
# push-images-in-batches.sh
#
# Splits the images directory into small commits and pushes each one
# individually to avoid "remote disconnected" failures on large binary pushes.
#
# Run from the repo root:
#   bash IDMatchGame/push-images-in-batches.sh
#
# Prerequisites:
#   - FamousGame/FamousPerson/images/ exists with downloaded images
#   - FamousGame/FamousPerson/image-map.json exists
#   - TheGame.html has NOT yet been updated (or has been — script handles both)
#
# What it does:
#   1. Runs update-image-paths.js to rewrite img: URLs in TheGame.html
#   2. Stages and pushes images in batches of BATCH_SIZE
#   3. Stages and pushes the updated TheGame.html in a final commit

set -euo pipefail

BATCH_SIZE=20
IMAGES_DIR="FamousGame/FamousPerson/images"
HTML_PATH="FamousGame/FamousPerson/TheGame.html"
MAP_PATH="FamousGame/FamousPerson/image-map.json"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "Branch: $BRANCH"
echo ""

# ── Step 1: Update TheGame.html with local image paths ──────────────────────
if [ -f "$MAP_PATH" ]; then
  echo "Running update-image-paths.js..."
  node IDMatchGame/update-image-paths.js
  echo ""
else
  echo "No image-map.json found — assuming TheGame.html already has local paths."
  echo ""
fi

# ── Step 2: Collect all untracked/modified images ────────────────────────────
mapfile -t ALL_IMAGES < <(git ls-files --others --modified --exclude-standard "$IMAGES_DIR" | sort)

TOTAL=${#ALL_IMAGES[@]}
echo "Found $TOTAL image file(s) to push."
echo ""

if [ "$TOTAL" -eq 0 ]; then
  echo "No new images to push — checking if TheGame.html has changes..."
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
    git commit -m "feat: add Famous Person images batch $BATCH_NUM ($(($END - $I)) files)"

    # Push with retry (up to 4 attempts, exponential backoff)
    for ATTEMPT in 1 2 3 4; do
      if git push -u origin "$BRANCH"; then
        break
      else
        if [ $ATTEMPT -lt 4 ]; then
          WAIT=$((ATTEMPT * ATTEMPT * 2))
          echo "  Push failed (attempt $ATTEMPT). Retrying in ${WAIT}s..."
          sleep $WAIT
        else
          echo "  Push failed after 4 attempts. Run 'git push -u origin $BRANCH' manually when your connection is stable."
          exit 1
        fi
      fi
    done

    I=$END
  done
fi

# ── Step 4: Commit and push TheGame.html + any cleanup ───────────────────────
CHANGED=$(git diff --name-only HEAD -- "$HTML_PATH" 2>/dev/null; git ls-files --others --exclude-standard "$HTML_PATH" 2>/dev/null)
if [ -n "$CHANGED" ]; then
  echo ""
  echo "Pushing updated TheGame.html..."
  git add -- "$HTML_PATH"
  # Remove image-map.json (build artifact) if present
  if [ -f "$MAP_PATH" ]; then
    git rm --cached "$MAP_PATH" 2>/dev/null || true
    echo "Removed image-map.json from tracking (build artifact)."
  fi
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

#!/bin/bash
# Re-vendors @noble/curves and @noble/hashes at the pinned version below.
# npm checks each tarball against the registry's integrity hash, and this
# script then checks it against the hash recorded here, so a changed
# release fails instead of landing. Only the licences and the .js files the
# PAKE loads are kept (KEEP, the import closure of ed25519, sha2, hmac and
# hkdf), so the phone downloads and a reviewer reads no more than is used.
# Two edits, both checked below: bare '@noble/...' imports become relative
# paths, so Node and the phone's browser load the same files with no import
# map and no node_modules; and em dashes in comments become hyphens.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION=2.4.0
CURVES_SRI='sha512-P4/62zrgfH33CneE3Dn4WhJVA22YUU0eR51wKIan4NVRvwsA0YnPTwWGpNbpuacSujmSFLvyzpyuR30+fbq2Ew=='
HASHES_SRI='sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA=='
KEEP='curves/ed25519.js curves/utils.js curves/abstract/curve.js curves/abstract/edwards.js curves/abstract/fft.js curves/abstract/frost.js curves/abstract/hash-to-curve.js curves/abstract/modular.js curves/abstract/montgomery.js curves/abstract/oprf.js hashes/_md.js hashes/_u64.js hashes/hkdf.js hashes/hmac.js hashes/legacy.js hashes/sha2.js hashes/utils.js'
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
npm pack --silent "@noble/curves@$VERSION" "@noble/hashes@$VERSION" >/dev/null
sri() { printf 'sha512-%s' "$(openssl dgst -sha512 -binary "$1" | base64 | tr -d '\n')"; }
[ "$(sri "noble-curves-$VERSION.tgz")" = "$CURVES_SRI" ] || { echo "curves tarball hash differs" >&2; exit 1; }
[ "$(sri "noble-hashes-$VERSION.tgz")" = "$HASHES_SRI" ] || { echo "hashes tarball hash differs" >&2; exit 1; }
out="$HERE/noble"
rm -rf "$out"
for pkg in curves hashes; do
  mkdir -p "$work/$pkg" "$out/$pkg"
  tar xzf "noble-$pkg-$VERSION.tgz" -C "$work/$pkg"
  cp "$work/$pkg/package/LICENSE" "$out/$pkg/LICENSE"
done
for f in $KEEP; do
  pkg="${f%%/*}"
  mkdir -p "$out/$(dirname "$f")"
  cp "$work/$pkg/package/${f#*/}" "$out/$f"
done
# Rewrite bare '@noble/<pkg>/' imports in both packages to relative paths.
for pkg in curves hashes; do
  (cd "$out/$pkg" && find . -name '*.js') | while read -r f; do
    depth="$(printf '%s' "${f#./}" | tr -cd '/' | wc -c | tr -d ' ')"
    up='../'
    i=0
    while [ "$i" -lt "$depth" ]; do up="../$up"; i=$((i + 1)); done
    sed -i '' -E "s#from '@noble/(curves|hashes)/([a-z0-9_/-]+\.js)'#from '${up}\1/\2'#g" "$out/$pkg/$f"
  done
done
if grep -rqE "^ *(import|export|\}).*from '@noble/" "$out"; then echo "a bare @noble import is left" >&2; exit 1; fi
DASH="$(printf '\342\200\224')"
find "$out" -name '*.js' -print0 | xargs -0 sed -i '' -E "/^[[:space:]]*(\*|\/\/|\/\*)/s/ ?$DASH ?/ - /g"
if grep -rq "$DASH" "$out"; then echo "an em dash outside a comment" >&2; exit 1; fi
(cd "$out" && find . -type f | LC_ALL=C sort | xargs shasum -a 256) > "$HERE/noble.sha256"
echo "vendored @noble/curves and @noble/hashes $VERSION into $out"

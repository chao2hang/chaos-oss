#!/usr/bin/env bash
# chaos-oss · theme installer
# Idempotently applies the chaos-oss premium theme to an OpenList-Frontend dist.
#
# Strategy: inject chaos-oss customizations into the Vite-generated
# index.html, never overwrite it. Overwriting breaks the SPA because
# Vite's chunk hashes change every release; copying a stale index.html
# leaves the page pointing at JS files that no longer exist.
#
# Usage:
#   ./install.sh                       # apply to ./dist (relative to repo root)
#   ./install.sh /path/to/dist         # apply to a custom path
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-${HERE%/theme}/dist}"
INDEX="$TARGET/index.html"

if [ ! -d "$TARGET" ]; then
  echo "[chaos-theme] target dist not found: $TARGET" >&2
  exit 1
fi
if [ ! -f "$INDEX" ]; then
  echo "[chaos-theme] target index.html not found: $INDEX" >&2
  exit 1
fi

echo "[chaos-theme] target: $TARGET"

# 1) Copy theme assets wholesale (idempotent).
rm -rf "$TARGET/chaos-assets"
mkdir -p "$TARGET/chaos-assets"
cp -R "$HERE/assets/." "$TARGET/chaos-assets/"
echo "[chaos-theme] copied assets -> $TARGET/chaos-assets/"

# 2) Inject chaos-oss customizations into the Vite-generated index.html.
# We delegate to a small Python helper for robust HTML editing.
python3 "$HERE/patch_index.py" "$INDEX" "$HERE/splash.html"
echo "[chaos-theme] patched index.html"

# 3) Merge chaos-oss manifest customizations into the existing
# static/manifest.json (theme_color, background_color, name, icons).
if [ -d "$TARGET/static" ]; then
  python3 "$HERE/patch_manifest.py" "$TARGET/static/manifest.json" "$HERE/manifest-fragment.json"
  echo "[chaos-theme] patched static/manifest.json"
fi

echo "[chaos-theme] done"

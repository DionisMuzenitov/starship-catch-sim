#!/usr/bin/env bash
# Regenerate the web front-door raster assets (SLS-95) from their committed
# sources into apps/web/public/:
#   favicon.svg           -> favicon-32.png, apple-touch-icon.png (180)
#   og-image.html         -> og-image.png (1200x630)
#
# The PNGs are committed static assets — social scrapers and legacy tabs can't
# use the SVG — so this script only needs to run when the sources change, not
# in CI. It rasterizes with headless Chrome (exact pixel dims, real font/SVG
# rendering). Point it at a browser via $CHROME_BIN, or it auto-discovers the
# Playwright-managed chrome-headless-shell that the e2e tests already install.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
pub="$repo/apps/web/public"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

chrome="${CHROME_BIN:-}"
if [ -z "$chrome" ]; then
  chrome="$(find "$HOME/Library/Caches/ms-playwright" "$HOME/.cache/ms-playwright" \
    -type f \( -name 'chrome-headless-shell' -o -name 'headless_shell' \) 2>/dev/null | head -1 || true)"
fi
if [ -z "$chrome" ] || [ ! -x "$chrome" ]; then
  echo "No headless Chrome found. Set CHROME_BIN=/path/to/chrome (or run 'pnpm --filter @starship-catch-sim/web exec playwright install chromium')." >&2
  exit 1
fi
echo "Using chrome: $chrome"

shot() { # <html-file> <w> <h> <out.png>
  "$chrome" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$2,$3" \
    --screenshot="$4" "file://$1" >/dev/null 2>&1
}

# --- favicon PNGs: wrap the SVG so it fills the target square, transparent bg ---
svg="$(cat "$pub/favicon.svg")"
gen_icon() { # <size> <out.png>
  cat > "$tmp/icon.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>*{margin:0;padding:0}html,body{width:${1}px;height:${1}px;background:transparent}
svg{width:${1}px;height:${1}px;display:block}</style>$svg
HTML
  shot "$tmp/icon.html" "$1" "$1" "$2"
  echo "  wrote $(basename "$2")  (${1}x${1})"
}
gen_icon 32 "$pub/favicon-32.png"
gen_icon 180 "$pub/apple-touch-icon.png"

# --- og:image (1200x630) from the committed template ---
shot "$here/og-image.html" 1200 630 "$pub/og-image.png"
echo "  wrote og-image.png  (1200x630)"

echo "Done. Committed assets live in apps/web/public/."

#!/usr/bin/env bash
# Renders assets/src/* to the PNGs used by Local and the README.
# Needs Google Chrome or Chromium; the thumbnail uses the Inter and JetBrains Mono fonts.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/assets/src"
out="$root/assets"
chrome="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"

render() { # <source file> <png> <width> <height>
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size="$3,$4" --screenshot="$2" "file://$1" >/dev/null 2>&1
}

render "$src/icon.svg" "$out/icon.png" 256 256
render "$src/thumbnail.html" "$out/thumbnail.png" 1280 640
echo "Rendered $out/icon.png and $out/thumbnail.png"

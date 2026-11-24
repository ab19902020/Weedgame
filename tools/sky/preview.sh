#!/usr/bin/env bash
# Render the sky preview (tools/sky/preview.js) to a PNG with headless Chromium.
# Usage: bash tools/sky/preview.sh '?hour=12&weather=broken&yaw=180' out.png   (serves www/ on :8099)
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p www/test
npx esbuild tools/sky/preview.js --bundle --format=esm --outfile=www/test/sky.js --log-level=warning
echo '<!doctype html><meta charset=utf-8><style>body{margin:0;background:#000}</style><script type=module src=sky.js></script>' > www/test/sky.html
(curl -s -o /dev/null http://localhost:8099/test/sky.html) || (python3 -m http.server 8099 --directory www >/dev/null 2>&1 & sleep 1)
node tools/sky/shot.mjs "http://localhost:8099/test/sky.html$1" "$2"

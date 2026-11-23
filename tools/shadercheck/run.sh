#!/usr/bin/env bash
# WebGPU shader check without a working WebGPU device.
# Builds every world, vehicle, people, sky, grass, IBL and post-processing material on a WebGPU renderer,
# captures the WGSL that three.js hands to createShaderModule (the device is lost in this container, but code
# generation still runs), then parses and validates each module with naga (wgpu's shader compiler, as WASM).
# It also builds them on the WebGL2 backend and reports GLSL compile/link errors.
# Usage: npm run serve (in another shell), then  bash tools/shadercheck/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${OUT:-/tmp/shadercheck}; mkdir -p "$OUT" www/test
npx esbuild tools/shadercheck/page.js --bundle --format=esm --outfile=www/test/wgsl.js --log-level=warning
echo '<!doctype html><meta charset=utf-8><body style="white-space:pre;font:12px monospace"><script type=module src=wgsl.js></script>' > www/test/wgsl.html
xvfb-run -a -s "-screen 0 1400x800x24" node tools/shadercheck/glsl.js
DUMP="$OUT/wgsl.json" xvfb-run -a -s "-screen 0 1400x800x24" node tools/shadercheck/capture.js
if [ ! -d "$OUT/node_modules/naga-wasm" ]; then (cd "$OUT" && npm init -y >/dev/null && npm install --no-save naga-wasm@30.2.0 >/dev/null); fi
cp tools/shadercheck/check.mjs "$OUT/check.mjs"
(cd "$OUT" && node check.mjs wgsl.json)

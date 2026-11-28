#!/usr/bin/env bash
# Rebuilds www/assets/shop/*.jpg: the stocked shelving seen in the shops and through shop windows.
#   tools/blender/build_shop_textures.sh [blender]      (default: blender on the PATH; Blender 4.3.x)
# 1. labels.py (Pillow) draws the packaging, price tags and newspapers from shopstock.py
# 2. shelves.py (Blender, Cycles) models the stock and renders each bay of shelving, the chillers, the freezer, the
#    tobacco gantry, the counter's sweets and the newspaper stand
# 3. the renders go to JPEG; window.jpg is four bays side by side for the shop-window shader (materials.js)
set -euo pipefail
BLENDER=${1:-blender}
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
WORK=$(mktemp -d)
python3 "$HERE/labels.py" "$WORK/labels"
"$BLENDER" -b -P "$HERE/shelves.py" -- "$WORK/labels" "$WORK/renders"
python3 - "$WORK/renders" "$ROOT/www/assets/shop" <<'EOF'
import sys, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
for n in ['drinks', 'crisps', 'biscuits', 'tins', 'cereal', 'household', 'alcohol', 'dairy', 'fridge', 'freezer', 'gantry', 'sweets', 'papers']:
    Image.open(f'{src}/{n}.png').convert('RGB').save(f'{out}/{n}.jpg', quality=84, optimize=True, progressive=True)
ims = [Image.open(f'{src}/{n}.png').convert('RGB') for n in ['drinks', 'crisps', 'biscuits', 'tins']]
w, h = ims[0].size; strip = Image.new('RGB', (w * 4, h))
for i, im in enumerate(ims): strip.paste(im.resize((w, h)), (i * w, 0))
strip.resize((w * 2, h // 2)).save(f'{out}/window.jpg', quality=82, optimize=True, progressive=True)
print('www/assets/shop updated')
EOF
rm -rf "$WORK"

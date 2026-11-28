#!/usr/bin/env bash
# Rebuilds www/assets/shop/*.jpg: the stocked shelving seen in the shops and through shop windows.
#   tools/blender/build_shop_textures.sh [blender]      (default: blender on the PATH; Blender 4.3.x)
# 1. labels.py (Pillow) draws the packaging, price tags and newspapers from shopstock.py
# 2. shelves.py (Blender, Cycles) models the stock and renders each bay of shelving, the chillers, the freezer, the
#    tobacco gantry, the counter's sweets and the newspaper stand
# 3. eaterylabels.py (Pillow) and eateries.py (Blender) do the same for the far wall of a cafe, a takeaway and a pub
# 4. the renders go to JPEG; window.jpg is the shop-window shader's atlas (materials.js buildingMaterial): four rows of
#    1024 x 384, from the bottom: four shelf bays side by side (4 m by 1.6 m), then the cafe, the takeaway and the pub
#    (4 m by 2.4 m each)
set -euo pipefail
BLENDER=${1:-blender}
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
WORK=$(mktemp -d)
python3 "$HERE/labels.py" "$WORK/labels"
"$BLENDER" -b -P "$HERE/shelves.py" -- "$WORK/labels" "$WORK/renders"
python3 "$HERE/eaterylabels.py" "$WORK/elabels"
"$BLENDER" -b -P "$HERE/eateries.py" -- "$WORK/elabels" "$WORK/renders"
python3 - "$WORK/renders" "$ROOT/www/assets/shop" <<'EOF'
import sys, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
for n in ['drinks', 'crisps', 'biscuits', 'tins', 'cereal', 'household', 'alcohol', 'dairy', 'fridge', 'freezer', 'gantry', 'sweets', 'papers']:
    Image.open(f'{src}/{n}.png').convert('RGB').save(f'{out}/{n}.jpg', quality=84, optimize=True, progressive=True)
ims = [Image.open(f'{src}/{n}.png').convert('RGB') for n in ['drinks', 'crisps', 'biscuits', 'tins']]
w, h = ims[0].size; strip = Image.new('RGB', (w * 4, h))
for i, im in enumerate(ims): strip.paste(im.resize((w, h)), (i * w, 0))
rows = [strip] + [Image.open(f'{src}/{n}.png').convert('RGB') for n in ['cafe', 'takeaway', 'pub']]
atlas = Image.new('RGB', (1024, 384 * len(rows)))
for k, im in enumerate(rows): atlas.paste(im.resize((1024, 384), Image.LANCZOS), (0, 384 * (len(rows) - 1 - k)))
atlas.save(f'{out}/window.jpg', quality=84, optimize=True, progressive=True)
print('www/assets/shop updated')
EOF
rm -rf "$WORK"

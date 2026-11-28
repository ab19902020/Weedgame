"""Finishes the far terrain a drone sees from high up (src/droneSky.js FarTerrain): the aerial texture painted by
far_colour.mjs from the world tiles, with the land beyond the tiles filled in as fields and woods, and a 64 m height
grid from the Environment Agency LIDAR DTM the world was built from.

  node tools/world/far_colour.mjs /tmp/far.rgb /tmp/far.mask
  python3 tools/world/far_terrain.py /tmp/far.rgb /tmp/far.mask <data dir with terrain_4m.npy> www/world/far
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageFilter

RGB, MASK, DATA, OUT = sys.argv[1:5]
man = json.load(open(os.path.join(os.path.dirname(OUT.rstrip('/')), 'manifest.json')))
OV = man['overview']; MPX = 8
NX, NZ = round(OV['w'] * OV['mpx'] / MPX), round(OV['h'] * OV['mpx'] / MPX)
rgb = np.frombuffer(open(RGB, 'rb').read(), np.uint8).reshape(NZ, NX, 3).astype(np.float32)
mask = np.frombuffer(open(MASK, 'rb').read(), np.uint8).reshape(NZ, NX) > 0

# beyond the tiles: a patchwork of fields, hedgerows and woods (seeded per field, so it never changes)
rng = np.random.default_rng(7)
fx, fz = np.meshgrid(np.arange(NX), np.arange(NZ))
cell = (fx // 14 + (fz // 11) * 977) + ((fx // 9) % 2) * 131
palette = np.array([[150, 154, 92], [176, 166, 108], [122, 146, 80], [104, 132, 74], [138, 150, 88], [44, 70, 38], [160, 150, 100]], np.float32)
pick = (np.sin(cell * 12.9898) * 43758.5453) % 1
fill = palette[(np.abs(pick) * len(palette)).astype(int) % len(palette)]
hedge = ((fx % 14) == 0) | ((fz % 11) == 0)
fill[hedge] = fill[hedge] * 0.55 + np.array([44, 70, 38]) * 0.45
# where the overview shows water beyond the tiles, keep it as water
ov = Image.new('RGB', (OV['w'] // 2, OV['h'] // 2))
for i in range(OV['w'] // OV['tile']):
    for j in range(OV['h'] // OV['tile']):
        p = os.path.join(os.path.dirname(OUT.rstrip('/')), 'overview', f'{i}_{j}.png')
        if os.path.exists(p): ov.paste(Image.open(p).convert('RGB').resize((OV['tile'] // 2, OV['tile'] // 2)), (i * OV['tile'] // 2, j * OV['tile'] // 2))
ova = np.asarray(ov.resize((NX, NZ)), np.float32)
water = (ova[..., 2] > ova[..., 0] + 25) & (ova[..., 2] > ova[..., 1] + 5)
fill[water] = [48, 68, 76]
# blend the edge of the tiled area softly into the fill
m = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))
w = (np.asarray(m, np.float32) / 255)[..., None]
out = rgb * w + fill * (1 - w)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(os.path.join(OUT, 'colour.jpg'), quality=82, optimize=True)

# heights: 64 m grid over the same extent (x east, z south), from the 4 m DTM, edges held
E0, N0, K = 479000.0, 171000.0, 0.999677
meta = json.load(open(os.path.join(DATA, 'terrain_meta.json')))
dem = np.load(os.path.join(DATA, 'terrain_4m.npy'), mmap_mode='r')
STEP = 64
GX, GZ = int(OV['w'] * OV['mpx'] / STEP) + 1, int(OV['h'] * OV['mpx'] / STEP) + 1
xs = OV['x0'] + np.arange(GX) * STEP; zs = OV['z0'] + np.arange(GZ) * STEP
X, Z = np.meshgrid(xs, zs)
e = X * K + E0; n = N0 - Z * K
col = np.clip(((e - meta['e_min']) / meta['res']).astype(int), 0, meta['width'] - 1)
row = np.clip(((meta['n_max'] - n) / meta['res']).astype(int), 0, meta['height'] - 1)
# the lowest ground in each 64 m cell (a minimum filter over the 4 m DTM), less half a metre: the far terrain then
# always lies just under the detailed tiles' terrain, never poking up through it where they overlap
from scipy.ndimage import minimum_filter
r0, r1, c0, c1 = max(0, row.min() - 20), min(meta['height'], row.max() + 21), max(0, col.min() - 20), min(meta['width'], col.max() + 21)
sub = np.asarray(dem[r0:r1, c0:c1], np.float32); sub = np.where(np.isfinite(sub), sub, np.nanmean(sub))
low = minimum_filter(sub, size=19, mode='nearest')
H = low[row - r0, col - c0] - 0.5
np.round(H * 10).astype(np.int16).tofile(os.path.join(OUT, 'height.bin'))
json.dump({'x0': OV['x0'], 'z0': OV['z0'], 'step': STEP, 'gx': GX, 'gz': GZ, 'w': OV['w'] * OV['mpx'], 'h': OV['h'] * OV['mpx'],
           'colour': 'colour.jpg', 'height': 'height.bin', 'scale': 0.1,
           'source': 'world tiles land cover and trees (aerial colours); EA LIDAR Composite DTM (OGL v3), 64 m'},
          open(os.path.join(OUT, 'far.json'), 'w'), indent=1)
print('far terrain', out.shape, 'heights', H.shape, float(H.min()), float(H.max()),
      os.path.getsize(os.path.join(OUT, 'colour.jpg')) // 1024, 'KB jpg')

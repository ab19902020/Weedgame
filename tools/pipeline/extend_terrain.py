"""Extend terrain_4m.npy to a larger BNG rectangle, keeping every existing sample and fetching only the new
2 km tiles from the same source (Environment Agency LIDAR Composite DTM 1 m via WCS, resampled to 4 m; voids from
AWS terrarium / EU-DEM as in fetch_terrain.py).

Usage: python3 tools/pipeline/extend_terrain.py <data dir> E_MIN E_MAX N_MIN N_MAX
The new rectangle must contain the old one, on the same 4 m grid (2 km aligned).
"""
import sys, os, io, json, math, concurrent.futures, urllib.request
import numpy as np
from PIL import Image

DATA = sys.argv[1]
E_MIN, E_MAX, N_MIN, N_MAX = map(int, sys.argv[2:6])
STEP, RES = 2000, 4.0
CID = '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m'
URL = ('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs'
       '?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=' + CID +
       '&format=image/tiff&subset=E({e0},{e1})&subset=N({n0},{n1})&SCALEFACTOR=0.25')
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) wcs-client'}

meta = json.load(open(os.path.join(DATA, 'terrain_meta.json')))
old = np.load(os.path.join(DATA, 'terrain_4m.npy'))
oe0, on1 = meta['e_min'], meta['n_max']
oe1, on0 = oe0 + meta['width'] * RES, on1 - meta['height'] * RES
assert E_MIN <= oe0 and E_MAX >= oe1 and N_MIN <= on0 and N_MAX >= on1, 'new extent must contain the old one'
W, H = int((E_MAX - E_MIN) / RES), int((N_MAX - N_MIN) / RES)
dem = np.full((H, W), np.nan, np.float32)
r0, c0 = int((N_MAX - on1) / RES), int((oe0 - E_MIN) / RES)
dem[r0:r0 + old.shape[0], c0:c0 + old.shape[1]] = old
print('kept', old.shape, 'at', r0, c0, 'of', dem.shape, flush=True)

def get(e0, n0):
    # curl rather than urllib: through some HTTPS proxies urllib's reads stall on this service
    import subprocess, time
    url = URL.format(e0=e0, e1=e0 + STEP, n0=n0, n1=n0 + STEP)
    err = None
    for attempt in range(6):
        r = subprocess.run(['curl', '-sf', '--max-time', '150', '-A', UA['User-Agent'], url], capture_output=True)
        if r.returncode == 0 and r.stdout[:2] in (b'II', b'MM'):
            return e0, n0, np.array(Image.open(io.BytesIO(r.stdout)), np.float32)
        err = f'curl exit {r.returncode}, {len(r.stdout)} bytes'; time.sleep(3 + attempt * 5)
    raise RuntimeError(f'{e0},{n0}: {err}')

jobs = [(e, n) for e in range(E_MIN, E_MAX, STEP) for n in range(N_MIN, N_MAX, STEP)
        if not (oe0 <= e and e + STEP <= oe1 and on0 <= n and n + STEP <= on1)]
print('fetching', len(jobs), 'new 2 km tiles', flush=True)
with concurrent.futures.ThreadPoolExecutor(2) as ex:
    for e0, n0, a in ex.map(lambda j: get(*j), jobs):
        a = np.where((a < -100) | (a > 1000), np.nan, a)
        rr, cc = int((N_MAX - (n0 + STEP)) / RES), int((e0 - E_MIN) / RES)
        dem[rr:rr + STEP // 4, cc:cc + STEP // 4] = a[:STEP // 4, :STEP // 4]
        print('tile', e0, n0, a.shape, flush=True)

voids = int(np.isnan(dem).sum())
print('voids', voids, flush=True)
if voids:
    from pyproj import Transformer
    inv = Transformer.from_crs(27700, 4326, always_xy=True)
    rr, cc = np.nonzero(np.isnan(dem))
    e = E_MIN + (cc + .5) * RES; n = N_MAX - (rr + .5) * RES
    lon, lat = inv.transform(e, n)
    z = 13; scale = 2 ** z
    tx = (np.array(lon) + 180) / 360 * scale
    lr = np.radians(lat); ty = (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / math.pi) / 2 * scale
    cache = {}
    vals = np.empty(len(rr), np.float32)
    for i in range(len(rr)):
        key = (int(tx[i]), int(ty[i]))
        if key not in cache:
            u = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{key[0]}/{key[1]}.png'
            im = np.array(Image.open(io.BytesIO(urllib.request.urlopen(u, timeout=60).read())).convert('RGB'), np.float32)
            cache[key] = im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768
        px = min(255, int((tx[i] - key[0]) * 256)); py = min(255, int((ty[i] - key[1]) * 256))
        vals[i] = cache[key][py, px]
    dem[rr, cc] = vals
np.save(os.path.join(DATA, 'terrain_4m.npy'), dem)
meta.update({'e_min': E_MIN, 'n_max': N_MAX, 'width': W, 'height': H,
             'void_cells_filled_from_eudem': int(meta.get('void_cells_filled_from_eudem', 0)) + voids,
             'min': float(np.nanmin(dem)), 'max': float(np.nanmax(dem))})
json.dump(meta, open(os.path.join(DATA, 'terrain_meta.json'), 'w'), indent=1)
print('done', dem.shape, meta['min'], meta['max'])

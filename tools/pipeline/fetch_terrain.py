"""Fetch the Environment Agency LIDAR Composite DTM (1 m, OGL v3) for the study
bbox through the public WCS at 4 m posting, mosaic it and fill voids from
AWS Terrain Tiles (EU-DEM 30 m over this area).

Writes terrain_4m.npy (float32, rows north->south) and terrain_meta.json.
"""
import sys, os, io, json, math, concurrent.futures, urllib.request
import numpy as np
from PIL import Image

OUT = sys.argv[1]
E_MIN, E_MAX, N_MIN, N_MAX = 469000, 489000, 165000, 177000
STEP = 2000; RES = 4.0
CID = '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m'
URL = ('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs'
       '?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=' + CID +
       '&format=image/tiff&subset=E({e0},{e1})&subset=N({n0},{n1})&SCALEFACTOR=0.25')

W = int((E_MAX - E_MIN) / RES); H = int((N_MAX - N_MIN) / RES)
dem = np.full((H, W), np.nan, np.float32)

def get(e0, n0):
    url = URL.format(e0=e0, e1=e0 + STEP, n0=n0, n1=n0 + STEP)
    for attempt in range(5):
        try:
            data = urllib.request.urlopen(url, timeout=120).read()
            a = np.array(Image.open(io.BytesIO(data)), np.float32)
            return e0, n0, a
        except Exception as ex:
            err = ex
    raise RuntimeError(f'{e0},{n0}: {err}')

jobs = [(e, n) for e in range(E_MIN, E_MAX, STEP) for n in range(N_MIN, N_MAX, STEP)]
with concurrent.futures.ThreadPoolExecutor(4) as ex:
    for e0, n0, a in ex.map(lambda j: get(*j), jobs):
        a = np.where((a < -100) | (a > 1000), np.nan, a)
        r0 = int((N_MAX - (n0 + STEP)) / RES); c0 = int((e0 - E_MIN) / RES)
        h, w = a.shape
        dem[r0:r0 + h, c0:c0 + w] = a[:STEP // 4, :STEP // 4]
        print('tile', e0, n0, a.shape, flush=True)

voids = int(np.isnan(dem).sum())
print('voids', voids, 'of', dem.size)
filled_from_eudem = 0
if voids:
    # Void fill from AWS terrarium z13 (EU-DEM 30 m here).
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
    filled_from_eudem = voids
np.save(os.path.join(OUT, 'terrain_4m.npy'), dem)
json.dump({'crs': 'EPSG:27700', 'e_min': E_MIN, 'n_max': N_MAX, 'res': RES, 'width': W, 'height': H,
           'source': 'Environment Agency LIDAR Composite DTM 1m (WCS, resampled to 4 m), Open Government Licence v3.0',
           'void_cells_filled_from_eudem': filled_from_eudem,
           'min': float(np.nanmin(dem)), 'max': float(np.nanmax(dem))},
          open(os.path.join(OUT, 'terrain_meta.json'), 'w'), indent=1)
print('done', np.nanmin(dem), np.nanmax(dem))

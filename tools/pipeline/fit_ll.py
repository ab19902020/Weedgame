"""Fit quadratic polynomials lon/lat -> world x,z (via OSTN15 BNG) over the study bbox and store
them in manifest.json as 'llfit' so the runtime can convert geographic coordinates (old saves,
reference landmarks) without a full OSGB transform. Reports the residuals."""
import json, sys, os, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from geo import lls_to_world
out = sys.argv[1]
lon, lat = np.meshgrid(np.linspace(-1.005, -0.725, 60), np.linspace(51.385, 51.485, 40))
lon, lat = lon.ravel(), lat.ravel()
x, z = lls_to_world(lon, lat)
L0, B0 = -0.87, 51.435
u, v = lon - L0, lat - B0
A = np.stack([np.ones_like(u), u, v, u * u, u * v, v * v, u * u * u, u * u * v, u * v * v, v * v * v], 1)
cx, *_ = np.linalg.lstsq(A, x, rcond=None); cz, *_ = np.linalg.lstsq(A, z, rcond=None)
res = np.hypot(A @ cx - x, A @ cz - z)
m = json.load(open(os.path.join(out, 'manifest.json')))
m['llfit'] = {'lon0': L0, 'lat0': B0, 'x': cx.tolist(), 'z': cz.tolist(), 'maxResidualM': float(res.max())}
json.dump(m, open(os.path.join(out, 'manifest.json'), 'w'), separators=(',', ':'))
print('max residual m', res.max(), 'mean', res.mean())

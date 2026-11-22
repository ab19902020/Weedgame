"""Shared projection for the Green County world.

CRS: British National Grid (EPSG:27700) via pyproj with the OSTN15 NTv2 grid
(uk_os_OSTN15_NTv2_OSGBtoETRS.tif from cdn.proj.org) for sub-metre transforms.
World frame (Three.js, metres, y up):
    x =  (E - E0) / K
    z = -(N - N0) / K
    y = height above Ordnance Datum Newlyn (EA LIDAR DTM)
K is the BNG point scale factor at the study-area centre, so one world unit is
one ground metre (residual scale error < 0.01 % across the area).
"""
from pyproj import Transformer

E0, N0 = 479000.0, 171000.0
K = 0.9996770          # pyproj get_factors at (-0.87, 51.435)
TILE = 256.0           # streaming tile edge in world metres

_fwd = Transformer.from_crs(4326, 27700, always_xy=True)
_inv = Transformer.from_crs(27700, 4326, always_xy=True)

def ll_to_world(lon, lat):
    e, n = _fwd.transform(lon, lat)
    return (e - E0) / K, -(n - N0) / K

def lls_to_world(lons, lats):
    e, n = _fwd.transform(lons, lats)
    import numpy as np
    e = np.asarray(e); n = np.asarray(n)
    return (e - E0) / K, -(n - N0) / K

def world_to_bng(x, z):
    return x * K + E0, N0 - z * K

def world_to_ll(x, z):
    e, n = world_to_bng(x, z)
    return _inv.transform(e, n)

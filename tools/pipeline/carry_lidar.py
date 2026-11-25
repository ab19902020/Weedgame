"""Carry LIDAR-measured building heights and roofs from an earlier world build into a rebuilt one.

Usage: python3 tools/pipeline/carry_lidar.py <old world dir> <new world dir>

lidar_buildings.py patches each building record (the 16-float bM row: wall height, roof type, roof rectangle,
ridge direction, storeys; field 15 = 3 marks LIDAR) in place, and needs the Environment Agency WCS. When the
world is rebuilt from OSM (for example to change its extent) the footprints are unchanged, so this copies each
measured row across by matching the footprint exactly (same tile, same quantised outer ring). Footprints new to
the rebuild keep their OSM/inferred values until lidar_buildings.py is run for them.
"""
import sys, os, hashlib
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lidar_buildings import read_tile, write_tile, NM

OLD, NEW = sys.argv[1], sys.argv[2]

def footprints(A):
    """yield (building index, key) with the key built from the outer ring's quantised coordinates"""
    P, R, C = A['bP'], A['bR'], A['bC']
    ci = ri = 0
    for bi in range(len(P)):
        n0 = int(R[ri])
        key = hashlib.md5(C[ci * 2:(ci + n0) * 2].tobytes()).hexdigest()
        for _ in range(int(P[bi])):
            ci += int(R[ri]); ri += 1
        yield bi, key

copied = kept = tiles = 0
for fn in sorted(os.listdir(os.path.join(NEW, 'tiles'))):
    po, pn = os.path.join(OLD, 'tiles', fn), os.path.join(NEW, 'tiles', fn)
    if not fn.endswith('.bin') or not os.path.exists(po):
        continue
    ho, Ao = read_tile(po)
    if 'bM' not in Ao or Ao['bM'].size == 0:
        continue
    Mo = Ao['bM'].reshape(-1, NM)
    measured = {k: Mo[bi] for bi, k in footprints(Ao) if Mo[bi, 15] == 3}
    if not measured:
        continue
    hn, An = read_tile(pn)
    Mn = An['bM'].reshape(-1, NM)
    n = 0
    for bi, k in footprints(An):
        if k in measured:
            Mn[bi] = measured[k]; n += 1
    if n:
        An['bM'] = Mn.ravel().astype(An['bM'].dtype)
        write_tile(pn, hn, An); tiles += 1
    copied += n; kept += len(measured) - n
print(f'LIDAR rows copied {copied} in {tiles} tiles; {kept} measured footprints had no match in the rebuild')

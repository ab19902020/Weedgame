"""Canopies: OSM building=roof structures plus reference-modelled shop canopies along frontages
facing the Woodley precinct pedestrian area. Writes manifest['canopies'] as
[x0, z0, x1, z1, depth, height, kind] (depth extends to the left of x0->x1, kind 0=frontage, 1=osm roof)."""
import sys, os, json, math
import numpy as np, osmium, shapely, shapely.ops
from shapely.geometry import Polygon, Point, LineString
sys.path.insert(0, os.path.dirname(__file__))
from geo import lls_to_world
DATA, OUT = sys.argv[1], sys.argv[2]
WOODLEY = Point(-2870, -2180).buffer(260)
roofs, plazas, blds = [], [], []
for o in osmium.FileProcessor(os.path.join(DATA, 'berks.osm.pbf')).with_locations().with_areas():
    if not o.is_area():
        continue
    t = dict(o.tags)
    for outer in o.outer_rings():
        ll = np.array([(n.lon, n.lat) for n in outer])
        x, z = lls_to_world(ll[:, 0], ll[:, 1])
        p = Polygon(np.stack([x, z], 1)).buffer(0)
        if p.is_empty or not (-11000 < p.centroid.x < 11000):
            continue
        if t.get('building') in ('roof', 'carport'):
            roofs.append((p, float(t.get('height', 0) or 0) or (4.6 if t.get('amenity') == 'fuel' else 3.4)))
        elif (t.get('highway') == 'pedestrian' or 'area:highway' in t) and p.intersects(WOODLEY):
            plazas.append(p)
        elif 'building' in t and p.intersects(WOODLEY):
            blds.append((p, t))
out = []
for p, h in roofs:
    mrr = np.array(p.minimum_rotated_rectangle.exterior.coords)[:4]
    a, b, c = mrr[0], mrr[1], mrr[2]
    # long edge a->b, depth towards c
    if np.hypot(*(b - a)) < np.hypot(*(c - b)):
        a, b, c = mrr[1], mrr[2], mrr[3]
    d = float(np.hypot(*(c - b)))
    # orient so depth is to the left of a->b
    ux, uz = (b - a) / np.hypot(*(b - a)); lx, lz = uz, -ux
    if (c - b) @ np.array([lx, lz]) < 0:
        a, b = b, a
    out.append([round(float(a[0]), 2), round(float(a[1]), 2), round(float(b[0]), 2), round(float(b[1]), 2), round(d, 2), round(h, 2), 1])
plaza = shapely.ops.unary_union(plazas) if plazas else None
n_front = 0
if plaza is not None:
    for p, t in blds:
        ext = np.array(p.exterior.coords)
        # CCW so the left of each edge is inside -> outward is to the right; we want depth outward
        if Polygon(ext).exterior.is_ccw is False:
            ext = ext[::-1]
        for i in range(len(ext) - 1):
            a, b = ext[i], ext[i + 1]
            L = np.hypot(*(b - a))
            if L < 3:
                continue
            mid = (a + b) / 2
            ux, uz = (b - a) / L
            ox, oz = uz, -ux   # outward (right of a->b for a CCW ring)
            probe = Point(mid[0] + ox * 2.0, mid[1] + oz * 2.0)
            if plaza.contains(probe):
                # depth to the LEFT of the canopy edge -> give the edge reversed (b->a)
                out.append([round(float(b[0]), 2), round(float(b[1]), 2), round(float(a[0]), 2), round(float(a[1]), 2), 2.6, 3.1, 0])
                n_front += 1
m = json.load(open(os.path.join(OUT, 'manifest.json')))
m['canopies'] = out
json.dump(m, open(os.path.join(OUT, 'manifest.json'), 'w'), separators=(',', ':'))
print('osm roofs', len(roofs), 'precinct frontage canopies', n_front, 'plazas', len(plazas))

"""Compare the built world against its inputs. Writes docs/verification.json.

Checks (all computed, no estimates):
  * landmark positions: OSM centroid (WGS84) -> world -> back to WGS84 round trip
  * landmark-to-landmark distances: world metres vs WGS84 ellipsoid geodesic
  * A329 / A329(M) route lengths: world polylines vs geodesic length of the same OSM ways
  * building footprints: world-plane area vs ellipsoidal area of the OSM polygon
  * signals: OSM traffic_signals nodes inside the coverage vs nodes attached to a controller
Usage: python3 verify.py <data dir> <www/world> <out.json>
"""
import sys, os, json, math, zlib, struct
import numpy as np, osmium
from pyproj import Geod
from shapely.geometry import Polygon, Point, LineString
sys.path.insert(0, os.path.dirname(__file__))
from geo import lls_to_world, ll_to_world, world_to_ll

DATA, WORLD, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
geod = Geod(ellps='WGS84')
man = json.load(open(os.path.join(WORLD, 'manifest.json')))
cov = Polygon(man['coverage'])
LANDMARKS = {63944459: 'Cemetery Arch (Cemetery Junction)', 96173955: 'Reading Town Hall', 1201385: 'Woodley Library (precinct)', 205394367: 'Wokingham Town Hall',
             79883357: 'Woodley Post Office (precinct)', 96174000: 'Reading Museum'}
lm, routes, bld, sigs = {}, {'A329': [], 'A329(M)': []}, [], []
for o in osmium.FileProcessor(os.path.join(DATA, 'berks.osm.pbf')).with_locations().with_areas():
    if o.is_area():
        oid = o.orig_id()
        t = dict(o.tags)
        if 'building' not in t:
            continue
        ring = next(iter(o.outer_rings()))
        ll = np.array([(n.lon, n.lat) for n in ring])
        if oid in LANDMARKS:
            lm[LANDMARKS[oid]] = ll
        x, z = lls_to_world(ll[:, 0], ll[:, 1])
        p = Polygon(np.stack([x, z], 1))
        if p.is_valid and p.area > 4 and cov.contains(p.representative_point()):
            ga, _ = geod.polygon_area_perimeter(ll[:, 0], ll[:, 1])
            bld.append((p.area, abs(ga)))
    elif o.is_way():
        t = dict(o.tags)
        ref = t.get('ref', '')
        if ref in routes and 'highway' in t:
            ll = np.array([(n.lon, n.lat) for n in o.nodes])
            x, z = lls_to_world(ll[:, 0], ll[:, 1])
            if np.all((x > -8200) & (x < 7800)):
                routes[ref].append(ll)
    elif o.is_node():
        t = dict(o.tags)
        if t.get('highway') == 'traffic_signals':
            x, z = ll_to_world(o.location.lon, o.location.lat)
            if cov.buffer(150).contains(Point(x, z)):
                sigs.append((o.id, x, z))

res = {'frame': man['frame'], 'landmarks': [], 'distances': [], 'routes': {}, 'buildings': {}, 'signals': {}}
cent = {}
for name, ll in lm.items():
    lon, lat = ll[:, 0].mean(), ll[:, 1].mean()
    x, z = ll_to_world(lon, lat)
    blon, blat = world_to_ll(x, z)
    _, _, err = geod.inv(lon, lat, blon, blat)
    cent[name] = (lon, lat, x, z)
    res['landmarks'].append({'name': name, 'lon': round(lon, 6), 'lat': round(lat, 6), 'world_x': round(x, 2), 'world_z': round(z, 2), 'roundTripErrorM': round(err, 4)})
names = list(cent)
for i in range(len(names)):
    for j in range(i + 1, len(names)):
        a, b = cent[names[i]], cent[names[j]]
        _, _, g = geod.inv(a[0], a[1], b[0], b[1])
        w = math.hypot(a[2] - b[2], a[3] - b[3])
        res['distances'].append({'from': names[i], 'to': names[j], 'geodesicM': round(g, 2), 'worldM': round(w, 2), 'diffM': round(w - g, 2), 'diffPct': round((w - g) / g * 100, 4)})
for ref, ways in routes.items():
    g = w = 0
    for ll in ways:
        for k in range(len(ll) - 1):
            g += geod.inv(ll[k, 0], ll[k, 1], ll[k + 1, 0], ll[k + 1, 1])[2]
        x, z = lls_to_world(ll[:, 0], ll[:, 1]); w += float(np.sum(np.hypot(np.diff(x), np.diff(z))))
    res['routes'][ref] = {'ways': len(ways), 'geodesicKm': round(g / 1000, 3), 'worldKm': round(w / 1000, 3), 'diffPct': round((w - g) / g * 100, 4) if g else None,
                          'note': 'all carriageways of the route between Reading town centre and Bracknell (dual carriageways counted twice)'}
a = np.array(bld)
ratio = a[:, 0] / a[:, 1]
res['buildings'] = {'count': int(len(a)), 'worldAreaKm2': round(float(a[:, 0].sum()) / 1e6, 4), 'ellipsoidAreaKm2': round(float(a[:, 1].sum()) / 1e6, 4),
                    'areaRatio': {'mean': round(float(ratio.mean()), 5), 'p01': round(float(np.percentile(ratio, 1)), 5), 'p99': round(float(np.percentile(ratio, 99)), 5)}}
# signals attached to controllers (decode network.bin)
b = zlib.decompress(open(os.path.join(WORLD, 'network.bin'), 'rb').read())
hl = struct.unpack('<I', b[4:8])[0]; hdr = json.loads(b[8:8 + hl])
ctl = hdr['controllers']
attached = 0
for nid, x, z in sigs:
    if any(math.hypot(c['x'] - x, c['z'] - z) < 70 for c in ctl):
        attached += 1
res['signals'] = {'osmTrafficSignalNodes': len(sigs), 'withinAController': attached, 'controllers': len(ctl), 'approaches': sum(len(c['approaches']) for c in ctl),
                  'pedestrianCrossingHeads': sum(len(c['peds']) for c in ctl), 'documentedTimings': 0, 'timingSource': 'simulated (UK-typical intergreens; no published phase data imported)'}
json.dump(res, open(OUT, 'w'), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != 'distances'}, indent=1)[:3000])
print('max distance diff %:', max(abs(d['diffPct']) for d in res['distances']))

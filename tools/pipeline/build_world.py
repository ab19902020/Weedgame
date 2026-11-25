"""Build the Green County streaming world from OSM + EA LIDAR terrain.

Usage: python3 build_world.py <data dir with berks.osm.pbf, terrain_4m.npy> <out dir (www/world)>

Outputs (all coordinates in the world frame documented in geo.py):
  manifest.json      world frame, tile list, districts, coverage polygon, sources
  network.bin        global road/footway graph, signal controllers, bus routes
  tiles/<ix>_<iz>.bin  zlib-compressed GCT1 containers: terrain, landcover, buildings,
                     surface polygons, bridges, trees, lamps, barriers, signs, parking
  overview/<i>_<j>.png 4 m/px map raster used by the full-screen map
  coverage.json      per-district feature statistics (counts only, never accuracy claims)
"""
import sys, os, json, math, zlib, struct, hashlib, time, re
from collections import defaultdict
import numpy as np
import osmium
import shapely
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, box, GeometryCollection
from shapely.ops import unary_union
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from geo import E0, N0, K, TILE, lls_to_world, ll_to_world, world_to_bng

DATA, OUT = sys.argv[1], sys.argv[2]
T0 = time.time()
def log(*a):
    print(f'[{time.time()-T0:7.1f}s]', *a, flush=True)

def h32(s):
    return int(hashlib.md5(str(s).encode()).hexdigest()[:8], 16)

# --------------------------------------------------------------------------- terrain
tm = json.load(open(os.path.join(DATA, 'terrain_meta.json')))
DEM = np.load(os.path.join(DATA, 'terrain_4m.npy'))
def terrain(x, z):
    """Bilinear DTM sample at world x,z (arrays ok)."""
    x = np.asarray(x, np.float64); z = np.asarray(z, np.float64)
    e = x * K + E0; n = N0 - z * K
    c = (e - tm['e_min']) / tm['res'] - .5; r = (tm['n_max'] - n) / tm['res'] - .5
    c = np.clip(c, 0, DEM.shape[1] - 1.001); r = np.clip(r, 0, DEM.shape[0] - 1.001)
    c0 = np.floor(c).astype(int); r0 = np.floor(r).astype(int); fc = c - c0; fr = r - r0
    a = DEM[r0, c0]; b = DEM[r0, c0 + 1]; cc = DEM[r0 + 1, c0]; d = DEM[r0 + 1, c0 + 1]
    return (a * (1 - fc) + b * fc) * (1 - fr) + (cc * (1 - fc) + d * fc) * fr

# --------------------------------------------------------------------------- districts
DISTRICTS = [  # name, lon, lat, radius m (coverage discs; stats use first match)
    ('Reading town centre', -0.9712, 51.4555, 1500),
    ('Cemetery Junction', -0.9485, 51.4520, 750),
    ('East Reading', -0.9560, 51.4545, 1300),
    ('Earley', -0.9330, 51.4430, 1500),
    ('Lower Earley', -0.9150, 51.4280, 1400),
    ('Woodley', -0.8985, 51.4520, 1700),
    ('Winnersh', -0.8760, 51.4310, 1100),
    ('Wokingham', -0.8360, 51.4110, 900),
    ('Bracknell town centre', -0.7505, 51.4160, 1700),
]
CORES = [(-0.9712, 51.4555, 650, 4), (-0.7505, 51.4160, 450, 3), (-0.8360, 51.4110, 280, 3), (-0.9025, 51.4527, 140, 2)]
for d in DISTRICTS:
    pass

# --------------------------------------------------------------------------- OSM read
log('reading OSM')
BUILD_KEYS = ('building', 'height', 'building:levels', 'roof:shape', 'roof:height', 'roof:levels', 'min_height',
              'building:min_level', 'name', 'shop', 'amenity', 'building:colour', 'roof:colour',
              'building:material', 'roof:material', 'roof:orientation', 'layer', 'tourism', 'leisure')
buildings, landareas, highways, railways, waterlines, barriers = [], [], [], [], [], []
pnodes = []      # point features
relations = []   # bus routes
places = []      # named settlements (place=town/suburb/village/hamlet/...)
area_hw = []     # pedestrian areas
way_nodes_tagged = {}  # node id -> tags for nodes we care about on ways
LAND_TAGS = ('landuse', 'natural', 'leisure', 'amenity', 'waterway', 'water', 'area:highway', 'highway', 'place', 'man_made')

def ring_ll(r):
    return [(n.lon, n.lat) for n in r]

fp = osmium.FileProcessor(os.path.join(DATA, 'berks.osm.pbf')).with_locations().with_areas()
for o in fp:
    if o.is_area():
        t = dict(o.tags)
        rings = []
        for outer in o.outer_rings():
            rings.append([ring_ll(outer)] + [ring_ll(inner) for inner in o.inner_rings(outer)])
        if not rings:
            continue
        oid = ('w' if o.from_way() else 'r') + str(o.orig_id())
        if 'building' in t and t['building'] != 'no':
            buildings.append((oid, rings, {k: t[k] for k in BUILD_KEYS if k in t}))
        elif any(k in t for k in LAND_TAGS):
            if t.get('highway') == 'pedestrian' or 'area:highway' in t or t.get('place') == 'square':
                area_hw.append((oid, rings, t))
            else:
                landareas.append((oid, rings, t))
    elif o.is_way():
        t = dict(o.tags)
        if 'highway' in t and t.get('area') != 'yes':
            highways.append((o.id, [n.ref for n in o.nodes], [(n.lon, n.lat) for n in o.nodes], t))
        elif 'railway' in t and t['railway'] in ('rail', 'light_rail', 'platform'):
            railways.append((o.id, [(n.lon, n.lat) for n in o.nodes], t))
        elif t.get('waterway') in ('river', 'stream', 'canal', 'ditch', 'drain'):
            waterlines.append((o.id, [(n.lon, n.lat) for n in o.nodes], t))
        elif t.get('barrier') in ('wall', 'fence', 'hedge', 'retaining_wall', 'city_wall', 'guard_rail') or t.get('natural') == 'tree_row':
            barriers.append((o.id, [(n.lon, n.lat) for n in o.nodes], t))
    elif o.is_node():
        t = dict(o.tags)
        if t.get('place') in ('town', 'suburb', 'village', 'hamlet', 'quarter', 'neighbourhood') and 'name' in t:
            places.append((t['name'], t['place'], o.location.lon, o.location.lat))
        keep = (t.get('highway') in ('traffic_signals', 'crossing', 'bus_stop', 'street_lamp', 'give_way', 'stop', 'mini_roundabout')
                or t.get('crossing') or t.get('natural') == 'tree'
                or ('name' in t and ('shop' in t or t.get('amenity') in ('cafe', 'pub', 'restaurant', 'fast_food', 'bank', 'pharmacy', 'bar', 'post_office', 'library', 'cinema', 'place_of_worship', 'police'))))
        if keep:
            pnodes.append((o.id, o.location.lon, o.location.lat, t))
    elif o.is_relation():
        t = dict(o.tags)
        if t.get('type') == 'route' and t.get('route') == 'bus':
            relations.append((o.id, t, [(m.type, m.ref, m.role) for m in o.members]))
log('buildings', len(buildings), 'land', len(landareas), 'highways', len(highways), 'rail', len(railways),
    'water', len(waterlines), 'barriers', len(barriers), 'nodes', len(pnodes), 'bus routes', len(relations))

# --------------------------------------------------------------------------- projection helpers
def proj(pts):
    a = np.asarray(pts, np.float64)
    x, z = lls_to_world(a[:, 0], a[:, 1])
    return np.stack([x, z], 1)

def proj_rings(rings):
    return [[proj(r) for r in poly] for poly in rings]

def shp(poly):  # list of rings (np arrays) -> shapely Polygon (y axis = world z)
    try:
        p = Polygon(poly[0], [r for r in poly[1:] if len(r) >= 4])
        if not p.is_valid:
            p = shapely.make_valid(p)
        return p
    except Exception:
        return None

# --------------------------------------------------------------------------- coverage polygon
log('coverage polygon')
discs = []
for name, lon, lat, r in DISTRICTS:
    x, z = ll_to_world(lon, lat)
    discs.append((name, Point(x, z).buffer(r, 64)))
route_lines = []
for wid, nids, ll, t in highways:
    ref = t.get('ref', '')
    if re.search(r'\bA329(\(M\))?\b', ref) or ref in ('A329', 'A329(M)'):
        xs = proj(ll)
        if np.all((xs[:, 0] > -8200) & (xs[:, 0] < 7800)):  # Reading TC (x≈-7.4 km) to Bracknell (x≈7.9 km)
            route_lines.append(LineString(xs))
corridor = unary_union(route_lines).buffer(380, 16) if route_lines else Polygon()
# The world is the whole study area: the OSM extract's bbox inside the LIDAR terrain (it was the district
# discs plus the A329 corridor, which cut Dinton Pastures, the Thames meadows and lanes like Sandford Lane in half)
RECT = (-9600.0, -5650.0, 9600.0, 5100.0)   # x0, z0, x1, z1 in world metres
coverage = box(*RECT) if os.environ.get('COVER', 'rect') == 'rect' else unary_union([d[1] for d in discs] + [corridor]).buffer(0)
# ...plus the whole M4 across the map, J12 (Theale) to J8/9 (Holyport, Maidenhead), with 500 m either side,
# as far as the terrain goes (it left the study area to the west and through its northern edge)
tx0, tz0 = (tm['e_min'] - E0) / K, -(tm['n_max'] - N0) / K
terr_box = box(tx0 + 64, tz0 + 64, tx0 + tm['width'] * tm['res'] - 64, tz0 + tm['height'] * tm['res'] - 64)
m4 = []
for wid, nids, ll, t in highways:
    if t.get('highway') in ('motorway', 'motorway_link') and 'M4' in re.split(r'[;\s]+', t.get('ref', '')):
        m4.append(LineString(proj(ll)))
if m4:
    m4c = unary_union(m4).intersection(box(-14900, -8300, 10900, 3000)).buffer(500, 8).intersection(terr_box)
    coverage = unary_union([coverage, m4c]).buffer(0)
    log('M4 corridor km', round(unary_union(m4).intersection(m4c).length / 2000, 1), 'per carriageway')
if coverage.geom_type == 'MultiPolygon':
    parts = sorted(coverage.geoms, key=lambda g: -g.area)
    log('coverage parts', [round(p.area / 1e6, 2) for p in parts])
    # join any islands to the main body with a 300 m bridge so the area stays continuous
    main = parts[0]
    for p in parts[1:]:
        a, b = shapely.ops.nearest_points(main, p)
        main = unary_union([main, p, LineString([a, b]).buffer(300)])
    coverage = main
coverage = coverage.simplify(5)
log('coverage km2', round(coverage.area / 1e6, 2), 'route segments', len(route_lines))
cov_margin = coverage.buffer(150)
cov_prep = shapely.prepared.prep(coverage)
margin_prep = shapely.prepared.prep(cov_margin)

def district_of(x, z):
    p = Point(x, z)
    for name, d in discs:
        if d.contains(p):
            return name
    return 'Villages, countryside and the A329 corridor'

core_discs = []
for lon, lat, r, lv in CORES:
    x, z = ll_to_world(lon, lat)
    core_discs.append((x, z, r, lv))
def core_levels(x, z):
    for cx, cz, r, lv in core_discs:
        if (x - cx) ** 2 + (z - cz) ** 2 < r * r:
            return lv
    return 0

# tile set
minx, minz, maxx, maxz = cov_margin.bounds
tiles = []
for ix in range(int(math.floor(minx / TILE)), int(math.floor(maxx / TILE)) + 1):
    for iz in range(int(math.floor(minz / TILE)), int(math.floor(maxz / TILE)) + 1):
        if margin_prep.intersects(box(ix * TILE, iz * TILE, (ix + 1) * TILE, (iz + 1) * TILE)):
            tiles.append((ix, iz))
tile_set = set(tiles)
log('tiles', len(tiles))
def tile_of(x, z):
    return (int(math.floor(x / TILE)), int(math.floor(z / TILE)))

# --------------------------------------------------------------------------- highways / graph
log('road graph')
DRIVE = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
         'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'service', 'busway', 'bus_guideway']
WALK = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'track', 'corridor']
CLS = {c: i for i, c in enumerate(DRIVE + WALK)}
RANK = {'motorway': 10, 'trunk': 9, 'primary': 8, 'secondary': 7, 'tertiary': 6, 'motorway_link': 8, 'trunk_link': 7,
        'primary_link': 7, 'secondary_link': 6, 'tertiary_link': 5, 'unclassified': 4, 'residential': 3,
        'living_street': 2, 'service': 1, 'busway': 3, 'bus_guideway': 3}
LANE_W = {'motorway': 3.65, 'trunk': 3.65, 'primary': 3.5, 'secondary': 3.3, 'tertiary': 3.2, 'unclassified': 3.0,
          'residential': 2.85, 'living_street': 2.6, 'service': 3.4, 'busway': 3.4}
SPEED = {'motorway': 112, 'trunk': 96, 'primary': 48, 'secondary': 48, 'tertiary': 48, 'unclassified': 48, 'residential': 32,
         'living_street': 16, 'service': 16, 'motorway_link': 64, 'trunk_link': 64, 'primary_link': 48, 'secondary_link': 48,
         'tertiary_link': 48, 'busway': 48}

def num(v, d=None):
    try:
        return float(re.findall(r'[-\d.]+', str(v))[0])
    except Exception:
        return d

def maxspeed(t, cls):
    v = t.get('maxspeed', '')
    m = re.match(r'(\d+)\s*mph', v)
    if m:
        return int(round(int(m.group(1)) * 1.609))
    if v.isdigit():
        return int(v)
    if v == 'national':
        return 112
    return SPEED.get(cls.replace('_link', ''), 48)

kept_hw = []
for wid, nids, ll, t in highways:
    if t['highway'] == 'road':          # 'road' = type not yet surveyed: drive it as an unclassified road
        t = {**t, 'highway': 'unclassified'}
    cls = t['highway']
    if cls not in CLS:
        continue
    xs = proj(ll)
    if len(xs) < 2:
        continue
    ln = LineString(xs)
    if not margin_prep.intersects(ln):
        continue
    if cls == 'service' and t.get('service') in ('parking_aisle', 'drive-through') and not margin_prep.intersects(ln):
        continue
    kept_hw.append((wid, nids, xs, t))
log('highway ways kept', len(kept_hw))

use = defaultdict(int)
for wid, nids, xs, t in kept_hw:
    for i, n in enumerate(nids):
        use[n] += 1 if 0 < i < len(nids) - 1 else 2

signal_nodes, crossing_nodes, giveway_nodes, mini_rb = {}, {}, {}, set()
node_tags = {nid: t for nid, lon, lat, t in pnodes}
for nid, lon, lat, t in pnodes:
    if t.get('highway') == 'traffic_signals' or t.get('crossing') == 'traffic_signals':
        signal_nodes[nid] = t
    if t.get('highway') == 'crossing' or t.get('crossing'):
        crossing_nodes[nid] = t
    if t.get('highway') in ('give_way', 'stop'):
        giveway_nodes[nid] = t['highway']
    if t.get('highway') == 'mini_roundabout':
        mini_rb.add(nid)

node_index, node_xyz, node_osm = {}, [], []
def gnode(nid, x, z):
    if nid not in node_index:
        node_index[nid] = len(node_xyz)
        node_xyz.append([x, float(terrain(x, z)), z]); node_osm.append(nid)
    return node_index[nid]

def densify(pts, step=10.0):
    out = [pts[0]]
    for a, b in zip(pts[:-1], pts[1:]):
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(math.ceil(d / step)))
        for k in range(1, n + 1):
            out.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
    return out

names, name_idx = [''], {'': 0}
def sidx(s):
    if s not in name_idx:
        name_idx[s] = len(names); names.append(s)
    return name_idx[s]

edges = []  # dicts
way_edges = defaultdict(list)
edge_osm_nodes = []  # per edge: list of (osm node id, position index in densified pts) for signals/crossings
for wid, nids, xs, t in kept_hw:
    cls = t['highway']
    cut = [i for i, n in enumerate(nids) if i == 0 or i == len(nids) - 1 or use[n] > 1 or n in signal_nodes or n in crossing_nodes]
    # split only at graph junctions (shared nodes); signal/crossing nodes are recorded along edges
    cut = [i for i, n in enumerate(nids) if i == 0 or i == len(nids) - 1 or use[n] > 1]
    for s, e in zip(cut[:-1], cut[1:]):
        seg = xs[s:e + 1]
        a = gnode(nids[s], *seg[0]); b = gnode(nids[e], *seg[-1])
        dens, marks = [tuple(seg[0])], []
        for k in range(s, e):
            p, q = xs[k], xs[k + 1]
            d = math.hypot(q[0] - p[0], q[1] - p[1]); n = max(1, int(math.ceil(d / 10.0)))
            for j in range(1, n + 1):
                dens.append((p[0] + (q[0] - p[0]) * j / n, p[1] + (q[1] - p[1]) * j / n))
            nid = nids[k + 1]
            if (nid in signal_nodes or nid in crossing_nodes or nid in giveway_nodes) and k + 1 != e:
                marks.append((nid, len(dens) - 1))
        if nids[s] in signal_nodes or nids[s] in crossing_nodes:
            marks.insert(0, (nids[s], 0))
        if nids[e] in signal_nodes or nids[e] in crossing_nodes or nids[e] in giveway_nodes:
            marks.append((nids[e], len(dens) - 1))
        if nids[s] in giveway_nodes:
            marks.insert(0, (nids[s], 0))
        dens = np.array(dens)
        if a == b and len(dens) < 3:
            continue
        lanes = num(t.get('lanes'))
        oneway = t.get('oneway') in ('yes', '1', 'true', '-1') or t.get('junction') in ('roundabout', 'circular') or cls in ('motorway', 'motorway_link')
        if t.get('oneway') == 'no':
            oneway = False
        if t.get('oneway') == '-1':
            dens = dens[::-1]; a, b = b, a
            marks = [(nid, len(dens) - 1 - i) for nid, i in marks][::-1]
        drive = cls in DRIVE and t.get('access') not in ('no', 'private') and t.get('motor_vehicle') not in ('no',)
        if cls in ('busway', 'bus_guideway'):
            drive = True
        lanesF = lanesB = 1
        if lanes:
            if oneway:
                lanesF, lanesB = int(lanes), 0
            else:
                lf = num(t.get('lanes:forward')); lb = num(t.get('lanes:backward'))
                lanesF = int(lf) if lf else max(1, int(lanes) // 2)
                lanesB = int(lb) if lb else max(1, int(lanes) - lanesF)
        else:
            if oneway:
                lanesF, lanesB = (2 if cls in ('motorway', 'trunk') else 1), 0
            elif cls in ('service', 'living_street', 'track'):
                lanesF, lanesB = 1, 1
        base = cls.replace('_link', '')
        if cls in DRIVE:
            if 'width' in t and num(t['width']):
                width = num(t['width'])
            elif cls == 'service' and not oneway:
                width = 4.0 if t.get('service') in ('driveway', 'parking_aisle', 'alley') else 5.0
            else:
                width = (lanesF + lanesB) * LANE_W.get(base, 3.0)
                if cls == 'motorway':
                    width += 4.3
            width = max(2.6, min(width, 22))
        else:
            width = {'pedestrian': 6.0, 'footway': 1.8, 'cycleway': 2.0, 'path': 1.5, 'bridleway': 2.0, 'track': 3.0, 'steps': 1.8, 'corridor': 2.0}[cls]
            if 'width' in t and num(t['width']):
                width = max(1.0, min(num(t['width']), 12))
        # pavements
        sw = t.get('sidewalk', t.get('sidewalk:both', ''))
        swl = t.get('sidewalk:left', ''); swr = t.get('sidewalk:right', '')
        pavL = pavR = False
        if cls in ('primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk'):
            if sw in ('both', 'yes'):
                pavL = pavR = True
            elif sw == 'left':
                pavL = True
            elif sw == 'right':
                pavR = True
            elif sw in ('no', 'none', 'separate'):
                pass
            elif swl or swr:
                pavL = swl in ('yes',); pavR = swr in ('yes',)
            elif cls != 'trunk':
                pavL = pavR = None  # decide later from building proximity
        layer = int(num(t.get('layer'), 0) or 0)
        bridge = t.get('bridge') not in (None, 'no')
        tunnel = t.get('tunnel') not in (None, 'no') or t.get('covered') == 'yes' and cls in DRIVE
        if t.get('tunnel') == 'building_passage':
            tunnel = False
        flags = 0
        flags |= 1 if oneway else 0
        flags |= 2 if t.get('junction') in ('roundabout', 'circular') else 0
        flags |= 4 if bridge else 0
        flags |= 8 if tunnel else 0
        flags |= 16 if drive else 0
        flags |= 32 if (cls in WALK or cls in ('residential', 'living_street', 'service', 'unclassified')) else 0
        flags |= 128 if cls in ('busway', 'bus_guideway') or t.get('psv') == 'designated' else 0
        flags |= 256 if t.get('lit') == 'yes' else 0
        e = dict(a=a, b=b, pts=dens, cls=cls, t=t, lanesF=lanesF, lanesB=lanesB, width=width, pavL=pavL, pavR=pavR,
                 layer=layer, bridge=bridge, tunnel=tunnel, flags=flags, speed=maxspeed(t, cls),
                 name=sidx(t.get('name', '')), ref=sidx(t.get('ref', '')), wid=wid, marks=marks, drive=drive)
        way_edges[wid].append(len(edges))
        edges.append(e)
log('graph nodes', len(node_xyz), 'edges', len(edges))
node_xyz = np.array(node_xyz)

# building proximity decides default pavements
log('buildings: project')
bpolys = []
for oid, rings, t in buildings:
    for poly in proj_rings(rings):
        if len(poly[0]) < 4:
            continue
        p = shp(poly)
        if p is None or p.is_empty or p.area < 4:
            continue
        if p.geom_type == 'MultiPolygon':
            p = max(p.geoms, key=lambda g: g.area)
        if p.geom_type != 'Polygon':
            continue
        c = p.representative_point()
        if not cov_prep.contains(c):
            continue
        bpolys.append((oid, p, t))
log('buildings in coverage', len(bpolys))
btree = shapely.STRtree([p for _, p, _ in bpolys])
for e in edges:
    if e['pavL'] is None:
        line = LineString(e['pts'])
        near = btree.query(line.buffer(45))
        e['pavL'] = e['pavR'] = len(near) > 0

# --------------------------------------------------------------------------- heights (terrain + bridges)
log('road heights')
for e in edges:
    p = e['pts']
    e['y'] = terrain(p[:, 0], p[:, 1]).astype(np.float64)
lower_lines = []
for i, e in enumerate(edges):
    if not e['bridge']:
        lower_lines.append((LineString(e['pts']), i, 'road'))
for wid, ll, t in railways:
    if t.get('railway') == 'rail' and t.get('bridge') in (None, 'no'):
        lower_lines.append((LineString(proj(ll)), -1, 'rail'))
for wid, ll, t in waterlines:
    lower_lines.append((LineString(proj(ll)), -1, 'water'))
ltree = shapely.STRtree([l for l, _, _ in lower_lines])
bridge_fixes = 0
for e in edges:
    if not e['bridge']:
        continue
    p = e['pts']; y = e['y']
    s = np.concatenate([[0], np.cumsum(np.hypot(np.diff(p[:, 0]), np.diff(p[:, 1])))])
    L = s[-1] or 1
    deck = y[0] + (y[-1] - y[0]) * s / L
    line = LineString(p)
    for j in ltree.query(line):
        l2, ei, kind = lower_lines[j]
        if ei >= 0 and (edges[ei]['layer'] >= e['layer'] and not edges[ei]['tunnel']):
            continue
        x = line.intersection(l2)
        if x.is_empty:
            continue
        pts = [x] if x.geom_type == 'Point' else [g for g in getattr(x, 'geoms', []) if g.geom_type == 'Point']
        for pt in pts:
            under = float(terrain(pt.x, pt.y))
            if ei >= 0:
                under = float(np.interp(l2.project(pt), np.concatenate([[0], np.cumsum(np.hypot(np.diff(edges[ei]['pts'][:, 0]), np.diff(edges[ei]['pts'][:, 1])))]), edges[ei]['y']))
            need = under + {'road': 5.6, 'rail': 6.2, 'water': 1.2}[kind]
            sp = line.project(pt)
            bump = need - 0.05 * np.abs(s - sp)
            if np.any(bump > deck):
                bridge_fixes += 1
            deck = np.maximum(deck, bump)
    e['y'] = deck
log('bridge clearance adjustments', bridge_fixes)
# propagate bridge end heights to graph nodes so connected edges meet
for e in edges:
    if e['bridge']:
        node_xyz[e['a'], 1] = max(node_xyz[e['a'], 1], e['y'][0]); node_xyz[e['b'], 1] = max(node_xyz[e['b'], 1], e['y'][-1])
for e in edges:
    if not e['bridge']:
        e['y'][0] = node_xyz[e['a'], 1]; e['y'][-1] = node_xyz[e['b'], 1]

# --------------------------------------------------------------------------- junction controls
log('junction controls')
deg = defaultdict(list)
for i, e in enumerate(edges):
    if e['drive']:
        deg[e['a']].append(i); deg[e['b']].append(i)

def bearing_at(e, end):
    p = e['pts']
    if end == 'a':
        d = p[min(2, len(p) - 1)] - p[0]
    else:
        d = p[max(-3, -len(p))] - p[-1]
    return math.atan2(d[1], d[0])

# control codes per edge end: 0 none, 1 give way, 2 stop, 3 signal, 4 roundabout entry give way
for e in edges:
    e['ctrlA'] = 0; e['ctrlB'] = 0; e['sigA'] = -1; e['sigB'] = -1; e['grpA'] = 0; e['grpB'] = 0
    e['cutA'] = 0.0; e['cutB'] = 0.0
for n, es in deg.items():
    if len(es) < 3:
        continue
    ranks = sorted(es, key=lambda i: (-RANK.get(edges[i]['cls'], 0), -edges[i]['width']))
    top = ranks[:2]
    rb = any(edges[i]['flags'] & 2 for i in es)
    for i in es:
        e = edges[i]
        end = 'A' if e['a'] == n else 'B'
        # traffic arriving at this end: at end B for forward travel, at end A for backward (two-way) travel
        if rb and not (e['flags'] & 2):
            code = 4
        elif i in top or RANK.get(e['cls'], 0) >= RANK.get(edges[top[0]]['cls'], 0):
            code = 0
        else:
            code = 1
        if node_osm[n] in mini_rb:
            code = 4
        e['ctrl' + end] = code
        # cut back markings/pavement gaps
        others = [edges[j]['width'] for j in es if j != i]
        e['cut' + end] = (max(others) / 2 + 1.5) if others else 0
for e in edges:  # explicit give way / stop nodes
    for nid, idx in e['marks']:
        if nid in giveway_nodes:
            code = 2 if giveway_nodes[nid] == 'stop' else 1
            if idx >= len(e['pts']) - 2:
                e['ctrlB'] = max(e['ctrlB'], code)
            elif idx <= 1:
                e['ctrlA'] = max(e['ctrlA'], code)

# signal controllers: cluster signal-node positions within 45 m
sig_pts = []
for i, e in enumerate(edges):
    if not e['drive']:
        continue
    for nid, idx in e['marks']:
        if nid in signal_nodes:
            sig_pts.append((i, nid, idx, e['pts'][idx]))
clusters = []
for item in sig_pts:
    x, z = item[3]
    for c in clusters:
        if (c['x'] - x) ** 2 + (c['z'] - z) ** 2 < 48 ** 2:
            c['items'].append(item); n = len(c['items'])
            c['x'] += (x - c['x']) / n; c['z'] += (z - c['z']) / n
            break
    else:
        clusters.append({'x': x, 'z': z, 'items': [item]})
controllers = []
for c in clusters:
    approaches = []  # (edge, dir, stopIndexS (metres along travel), bearing)
    peds = []
    standalone = True
    for i, nid, idx, pt in c['items']:
        e = edges[i]; t = signal_nodes[nid]
        p = e['pts']
        s = np.concatenate([[0], np.cumsum(np.hypot(np.diff(p[:, 0]), np.diff(p[:, 1])))])
        L = s[-1]
        dirn = t.get('traffic_signals:direction', '')
        is_xing = t.get('crossing') == 'traffic_signals' or t.get('highway') == 'crossing'
        # junction nodes inside cluster?
        jn = [n for n in (e['a'], e['b']) if len(deg.get(n, [])) >= 3 and (node_xyz[n, 0] - c['x']) ** 2 + (node_xyz[n, 2] - c['z']) ** 2 < 60 ** 2]
        if jn:
            standalone = False
        dirs = []
        if dirn == 'forward':
            dirs = [1]
        elif dirn == 'backward':
            dirs = [-1]
        else:
            dirs = [1] if e['flags'] & 1 else [1, -1]
            if jn and not (e['flags'] & 1):
                # only the direction heading towards the junction stops here
                toward_b = e['b'] in jn
                dirs = [1] if toward_b else [-1]
                if idx == 0 or idx == len(p) - 1:
                    dirs = [1 if idx == len(p) - 1 else -1]
        for d in dirs:
            stop = (s[idx] - 2.0) if d == 1 else (L - s[idx] - 2.0)
            stop = max(0.5, stop)
            b = math.atan2(*(p[min(idx + 1, len(p) - 1)] - p[max(idx - 1, 0)])[::-1]) if d == 1 else math.atan2(*(p[max(idx - 1, 0)] - p[min(idx + 1, len(p) - 1)])[::-1])
            approaches.append([i, d, round(float(stop), 1), b])
        if is_xing:
            q = p[min(idx + 1, len(p) - 1)] - p[max(idx - 1, 0)]
            peds.append([float(pt[0]), float(pt[1]), math.atan2(q[1], q[0]), e['width'] + (4 if (e['pavL'] or e['pavR']) else 0)])
    if not approaches:
        continue
    # group approaches by axis (two-stage plan); standalone crossings use one group
    if standalone:
        for a in approaches:
            a.append(0)
        groups = 1
    else:
        ref = approaches[0][3]
        for a in approaches:
            dd = abs(((a[3] - ref + math.pi / 2) % math.pi) - math.pi / 2)
            a.append(0 if dd < math.pi / 4 else 1)
        groups = 1 + max(a[4] for a in approaches)
    major = [max([RANK.get(edges[a[0]]['cls'], 0) for a in approaches if a[4] == g] or [0]) for g in range(groups)]
    green = [round(18 + 3 * r) for r in major]
    ctl = dict(x=round(c['x'], 1), z=round(c['z'], 1), standalone=standalone, groups=groups, green=green,
               approaches=[[a[0], a[1], a[2], a[4]] for a in approaches], peds=peds,
               timing='simulated')
    ci = len(controllers)
    controllers.append(ctl)
    for a in approaches:
        e = edges[a[0]]
        if a[1] == 1:
            e['ctrlB'] = 3; e['sigB'] = ci; e['grpB'] = a[4]
        else:
            e['ctrlA'] = 3; e['sigA'] = ci; e['grpA'] = a[4]
log('signal controllers', len(controllers), 'signal heads (approaches)', sum(len(c['approaches']) for c in controllers))

# crossings (zebra / uncontrolled / signal)
crossings = []
for i, e in enumerate(edges):
    if not e['drive']:
        continue
    for nid, idx in e['marks']:
        if nid in crossing_nodes:
            t = crossing_nodes[nid]
            p = e['pts']; q = p[min(idx + 1, len(p) - 1)] - p[max(idx - 1, 0)]
            kind = 'signal' if (t.get('crossing') == 'traffic_signals' or nid in signal_nodes) else (
                'zebra' if (t.get('crossing_ref') == 'zebra' or t.get('crossing') == 'zebra' or t.get('crossing:markings') == 'zebra') else 'uncontrolled')
            crossings.append([i, idx, kind, float(p[idx][0]), float(p[idx][1]), math.atan2(q[1], q[0]), e['width']])
log('crossings', len(crossings), {k: sum(1 for c in crossings if c[2] == k) for k in ('signal', 'zebra', 'uncontrolled')})

# --------------------------------------------------------------------------- bus routes
log('bus routes')
routes = []
def build_run(ways):
    seq, cur = [], None
    for k, w in enumerate(ways):
        es = way_edges[w]
        fwd = [(i, 1) for i in es]; bwd = [(i, -1) for i in reversed(es)]
        start_f = edges[es[0]]['a']; end_f = edges[es[-1]]['b']
        if cur is None:
            nn = set()
            if k + 1 < len(ways):
                ne = way_edges[ways[k + 1]]; nn = {edges[j]['a'] for j in ne} | {edges[j]['b'] for j in ne}
            chosen = bwd if (start_f in nn and end_f not in nn) else fwd
        elif start_f == cur:
            chosen = fwd
        elif end_f == cur:
            chosen = bwd
        else:
            hit = [j for j, i in enumerate(es) if edges[i]['a'] == cur]
            hitb = [j for j, i in enumerate(es) if edges[i]['b'] == cur]
            if hit:
                chosen = [(i, 1) for i in es[hit[0]:]]
            elif hitb:
                chosen = [(i, -1) for i in reversed(es[:hitb[0] + 1])]
            else:
                return seq, ways[k:]
        seq.extend(chosen)
        li, ld = seq[-1]
        cur = edges[li]['b'] if ld == 1 else edges[li]['a']
    return seq, []
for rid, t, members in relations:
    allw = [ref for typ, ref, role in members if typ == 'w' and role in ('', 'forward', 'backward', 'route')]
    stops = [ref for typ, ref, role in members if typ == 'n' and role.startswith(('stop', 'platform'))]
    best = []
    run = []
    for w in allw + [None]:
        if w is not None and w in way_edges:
            run.append(w); continue
        while run:
            seq, rest = build_run(run)
            if len(seq) > len(best):
                best = seq
            run = rest[1:] if rest else []
    if len(best) < 8:
        continue
    routes.append(dict(ref=t.get('ref', ''), name=t.get('name', ''), operator=t.get('operator', ''),
                       colour=t.get('colour', ''), seq=best, stops=stops, osm=rid))
log('bus routes reconstructed', len(routes), 'of', len(relations))

# bus stop positions (for routes + shelters)
bus_stops = []
for nid, lon, lat, t in pnodes:
    if t.get('highway') == 'bus_stop':
        x, z = ll_to_world(lon, lat)
        if margin_prep.contains(Point(x, z)):
            bus_stops.append(dict(id=nid, x=x, z=z, name=t.get('name', ''), shelter=t.get('shelter') == 'yes', bench=t.get('bench') == 'yes'))
log('bus stops', len(bus_stops))
stop_by_id = {s['id']: i for i, s in enumerate(bus_stops)}
# route stop distances along the route path
for r in routes:
    path = []
    for i, d in r['seq']:
        p = edges[i]['pts'] if d == 1 else edges[i]['pts'][::-1]
        path.extend(p.tolist() if not path else p[1:].tolist())
    line = LineString(path)
    r['length'] = line.length
    sl = []
    for sid in r['stops']:
        if sid in stop_by_id:
            s = bus_stops[stop_by_id[sid]]
            sl.append([stop_by_id[sid], round(line.project(Point(s['x'], s['z'])), 1)])
    if not sl:  # fall back to nearby bus stops along the path
        pass
    r['stopd'] = sorted(sl, key=lambda v: v[1])

# --------------------------------------------------------------------------- buildings: heights and roofs
log('buildings: heights and roofs')
landuse_polys = []
for oid, rings, t in landareas:
    lu = t.get('landuse')
    if lu in ('residential', 'retail', 'commercial', 'industrial'):
        for poly in proj_rings(rings):
            p = shp(poly)
            if p is not None and not p.is_empty:
                landuse_polys.append((lu, p))
lutree = shapely.STRtree([p for _, p in landuse_polys])
def landuse_at(pt):
    for j in lutree.query(pt):
        if landuse_polys[j][1].contains(pt):
            return landuse_polys[j][0]
    return ''

ROOF_MAP = {'flat': 0, 'gabled': 1, 'hipped': 2, 'pyramidal': 3, 'skillion': 4, 'half-hipped': 2, 'side_hipped': 2,
            'gambrel': 1, 'mansard': 2, 'saltbox': 1, 'dome': 3, 'onion': 3, 'round': 1, 'cone': 3}
HOUSE = {'house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential', 'cottage', 'farm', 'static_caravan'}
def max_rect(mask):
    """Largest axis-aligned rectangle of True cells (histogram method). returns r0,c0,r1,c1 inclusive."""
    h = np.zeros(mask.shape[1], int); best = (0, None)
    for r in range(mask.shape[0]):
        h = np.where(mask[r], h + 1, 0)
        st = []
        for c in range(len(h) + 1):
            cur = h[c] if c < len(h) else 0
            start = c
            while st and st[-1][1] >= cur:
                s0, hh = st.pop()
                area = hh * (c - s0)
                if area > best[0]:
                    best = (area, (r - hh + 1, s0, r, c - 1))
                start = s0
            st.append((start, cur))
    return best[1]

stats_b = defaultdict(lambda: defaultdict(int))
bldg_records = defaultdict(list)
landmark_names = {'Reading Town Hall', 'Cemetery Arch'}
for k, (oid, p, t) in enumerate(bpolys):
    btype = t.get('building', 'yes')
    c = p.representative_point(); cx, cz = c.x, c.y
    dist = district_of(cx, cz)
    S = stats_b[dist]; S['buildings'] += 1
    area = p.area
    lu = landuse_at(c)
    core = core_levels(cx, cz)
    rnd = (h32(oid) % 1000) / 1000.0
    levels = num(t.get('building:levels'))
    height = num(t.get('height'))
    roof_h_tag = num(t.get('roof:height'))
    hsrc = 'tag:height' if height else ('tag:levels' if levels else 'inferred')
    S['height_' + hsrc] += 1
    kind = btype
    if btype == 'yes':
        if area < 22:
            kind = 'shed'
        elif area < 45 and lu == 'residential':
            kind = 'garage'
        elif lu == 'residential' and area < 260:
            kind = 'house'
        elif lu == 'industrial':
            kind = 'industrial'
        elif lu in ('retail', 'commercial') or core:
            kind = 'commercial'
        elif area < 260:
            kind = 'house'
        else:
            kind = 'commercial'
    if kind in ('garage', 'garages', 'carport'):
        lv, flh = 1, 2.5
    elif kind in ('shed', 'hut', 'greenhouse', 'kiosk', 'roof', 'toilets'):
        lv, flh = 1, 2.3
    elif kind in HOUSE:
        lv, flh = (1 if kind == 'bungalow' else 2), 2.75
        if core and area > 90:
            lv = max(lv, 3)
    elif kind in ('apartments', 'dormitory', 'hotel'):
        lv, flh = 4, 3.0
    elif kind in ('industrial', 'warehouse', 'manufacture', 'hangar', 'storage_tank'):
        lv, flh = 1, 8.0 + 3 * rnd
    elif kind in ('retail', 'supermarket'):
        lv, flh = (max(2, core) if core else 1), (3.6 if core else 6.5)
    elif kind in ('commercial', 'office', 'civic', 'public', 'government', 'college', 'university', 'hospital'):
        lv, flh = (core + 1 if core else 2 + int(area > 900)), 3.5
    elif kind in ('church', 'chapel', 'cathedral'):
        lv, flh = 1, 10.0
    elif kind in ('school',):
        lv, flh = 2, 3.4
    elif kind in ('train_station', 'transportation'):
        lv, flh = 1, 7.0
    elif kind in ('parking',):
        lv, flh = 3, 3.0
    else:
        lv, flh = (core + 1 if core else 2), 3.0
    if levels:
        lv = levels
        if kind not in ('industrial', 'warehouse'):
            flh = 3.0 if kind in HOUSE or kind in ('apartments', 'residential') else 3.6
    wall = height if height else lv * flh * (0.94 + 0.12 * rnd if hsrc == 'inferred' else 1)
    # roof shape
    rs = t.get('roof:shape')
    if rs:
        roof = ROOF_MAP.get(rs, 2); S['roof_tag'] += 1
    else:
        S['roof_inferred'] += 1
        if kind in HOUSE or kind in ('garage', 'shed', 'church', 'chapel', 'school') and area < 400:
            roof = 1 if (kind in ('terrace', 'shed', 'church', 'chapel') or rnd < .55) else 2
            if kind == 'garage' and rnd < .7:
                roof = 0
        elif kind in ('apartments',) and area < 700:
            roof = 2
        else:
            roof = 0
    # oriented rectangle analysis for pitched roofs
    mrr = p.minimum_rotated_rectangle
    rc = np.array(mrr.exterior.coords)[:4]
    e1 = rc[1] - rc[0]; e2 = rc[2] - rc[1]
    l1, l2 = np.hypot(*e1), np.hypot(*e2)
    if l1 >= l2:
        ang = math.atan2(e1[1], e1[0]); Lr, Wr = l1, l2
    else:
        ang = math.atan2(e2[1], e2[0]); Lr, Wr = l2, l1
    ctr = rc.mean(0)
    fill = area / max(mrr.area, 1e-6)
    roofrect = None
    if roof:
        if fill > 0.86:
            roofrect = (ctr[0], ctr[1], ang, Lr, Wr)
        else:
            # largest inscribed rectangle in the OBB frame (0.5 m raster)
            ca, sa = math.cos(-ang), math.sin(-ang)
            q = np.array(p.exterior.coords) - ctr
            loc = np.stack([q[:, 0] * ca - q[:, 1] * sa, q[:, 0] * sa + q[:, 1] * ca], 1)
            res = 0.5
            x0, z0 = loc.min(0); nx = int((loc[:, 0].max() - x0) / res) + 1; nz = int((loc[:, 1].max() - z0) / res) + 1
            if nx * nz < 40000:
                img = Image.new('1', (nx, nz), 0)
                ImageDraw.Draw(img).polygon([((u - x0) / res, (v - z0) / res) for u, v in loc], fill=1)
                for hole in p.interiors:
                    hq = np.array(hole.coords) - ctr
                    hl = np.stack([hq[:, 0] * ca - hq[:, 1] * sa, hq[:, 0] * sa + hq[:, 1] * ca], 1)
                    ImageDraw.Draw(img).polygon([((u - x0) / res, (v - z0) / res) for u, v in hl], fill=0)
                m = np.array(img, bool)
                r = max_rect(m)
                if r:
                    r0, c0, r1, c1 = r
                    w_ = (c1 - c0 + 1) * res; d_ = (r1 - r0 + 1) * res
                    if w_ * d_ > 0.45 * area and min(w_, d_) > 3.5:
                        lx = x0 + (c0 + c1 + 1) / 2 * res; lz = z0 + (r0 + r1 + 1) / 2 * res
                        cb, sb = math.cos(ang), math.sin(ang)
                        wx = ctr[0] + lx * cb - lz * sb; wz = ctr[1] + lx * sb + lz * cb
                        if w_ >= d_:
                            roofrect = (wx, wz, ang, w_, d_)
                        else:
                            roofrect = (wx, wz, ang + math.pi / 2, d_, w_)
        if roofrect is None or roofrect[4] > 24:
            roof = 0; roofrect = None
    if roof and roofrect:
        rh = roof_h_tag if roof_h_tag else min(roofrect[4] * (0.42 if roof == 1 else 0.38), 7.0)
    else:
        rh = roof_h_tag if roof_h_tag else 0.0
    if height and roof and roofrect:
        wall = max(2.2, height - rh)
    S['pitched' if roof else 'flat'] += 1
    # base elevation
    ex = np.array(p.exterior.coords)
    ys = terrain(ex[:, 0], ex[:, 1])
    base = float(np.mean(ys)); low = float(np.min(ys))
    tx, tz = tile_of(cx, cz)
    if (tx, tz) not in tile_set:
        continue
    cls_code = {'house': 1, 'detached': 1, 'semidetached_house': 1, 'terrace': 2, 'bungalow': 1, 'residential': 1, 'cottage': 1,
                'apartments': 3, 'garage': 4, 'garages': 4, 'shed': 5, 'commercial': 6, 'office': 6, 'retail': 7, 'supermarket': 7,
                'industrial': 8, 'warehouse': 8, 'church': 9, 'chapel': 9, 'school': 10, 'university': 10, 'college': 10,
                'train_station': 11, 'hospital': 6, 'hotel': 3, 'civic': 6, 'public': 6, 'parking': 12, 'roof': 13, 'carport': 13}.get(kind, 6 if area > 300 else 1)
    shop = 1 if (t.get('shop') or t.get('amenity') in ('cafe', 'pub', 'restaurant', 'fast_food', 'bank')) else 0
    rec = dict(oid=oid, poly=p, base=base, low=low, wall=round(wall, 2), roof=roof, rh=round(rh, 2), rr=roofrect,
               cls=cls_code, lv=int(lv), shop=shop, name=t.get('name', ''), hsrc=hsrc,
               colour=t.get('building:colour', ''), rcolour=t.get('roof:colour', ''), mat=t.get('building:material', ''),
               landmark=t.get('name', '') in landmark_names, dist=dist)
    bldg_records[(tx, tz)].append(rec)
log('building records', sum(len(v) for v in bldg_records.values()))

# --------------------------------------------------------------------------- landcover polygons
log('landcover')
LC = {'grass': 0, 'road': 1, 'pavement': 2, 'building': 3, 'water': 4, 'wood': 5, 'farm': 6, 'park': 7, 'parking': 8,
      'rail': 9, 'path': 10, 'garden': 11, 'plaza': 12, 'pitch': 13, 'allot': 14, 'scrub': 15, 'cemetery': 16,
      'hard': 17, 'brown': 18, 'sand': 19}
def land_class(t):
    lu = t.get('landuse'); nat = t.get('natural'); le = t.get('leisure'); am = t.get('amenity')
    if nat == 'water' or t.get('waterway') in ('riverbank', 'dock') or lu in ('reservoir', 'basin') or t.get('water'):
        return 'water', 9
    if am == 'parking' and t.get('parking') not in ('underground', 'multi-storey'):
        return 'parking', 8
    if lu in ('forest',) or nat in ('wood',):
        return 'wood', 4
    if nat in ('scrub', 'heath', 'wetland'):
        return 'scrub', 4
    if lu in ('farmland',):
        return 'farm', 2
    if lu in ('meadow', 'farmyard', 'greenfield'):
        return 'grass', 2
    if lu in ('orchard', 'allotments', 'vineyard', 'plant_nursery'):
        return 'allot', 5
    if lu in ('cemetery',) or am == 'grave_yard':
        return 'cemetery', 5
    if le in ('pitch', 'track'):
        return 'pitch', 7
    if le in ('playground',) or nat in ('sand', 'beach'):
        return 'sand', 7
    if le in ('park', 'garden', 'golf_course', 'common', 'recreation_ground', 'nature_reserve') or lu in ('grass', 'village_green', 'recreation_ground'):
        return 'park', 3
    if lu in ('industrial', 'railway'):
        return 'hard', 1
    if lu in ('retail', 'commercial'):
        return 'hard', 1
    if lu in ('construction', 'brownfield', 'landfill'):
        return 'brown', 2
    if lu == 'residential':
        return 'garden', 0
    if nat == 'grassland':
        return 'grass', 2
    return None, 0

land_polys = []  # (priority, class, shapely)
water_bodies = []  # (shapely, kind 'lake'|'river', name) for the water surfaces and carved beds
RIVER_WATER = ('river', 'canal', 'stream', 'oxbow', 'lock', 'stream_pool', 'ditch', 'drain', 'moat', 'wastewater')
for oid, rings, t in landareas:
    cl, pr = land_class(t)
    if cl is None:
        continue
    for poly in proj_rings(rings):
        p = shp(poly)
        if p is None or p.is_empty or not margin_prep.intersects(p):
            continue
        land_polys.append((pr, cl, p))
        if cl == 'water':
            kind = 'river' if (t.get('water') in RIVER_WATER or t.get('waterway') in ('riverbank', 'canal', 'dock')) else 'lake'
            water_bodies.append((p, kind, t.get('name', '')))
for oid, rings, t in area_hw:
    for poly in proj_rings(rings):
        p = shp(poly)
        if p is not None and not p.is_empty and margin_prep.intersects(p):
            land_polys.append((10, 'plaza', p))
land_polys.sort(key=lambda v: v[0])
landtree = shapely.STRtree([p for _, _, p in land_polys])
log('landcover polygons', len(land_polys))

# water lines buffered (rivers mapped as lines only)
water_lines = []   # (LineString, waterway, width) open (not culverted) channels
for wid, ll, t in waterlines:
    xs = proj(ll)
    if len(xs) < 2 or t.get('tunnel') in ('culvert', 'yes', 'flooded') or t.get('location') == 'underground':
        continue
    w = num(t.get('width'), {'river': 12, 'canal': 10, 'stream': 2.5, 'ditch': 1.2, 'drain': 1.5}[t['waterway']])
    land_polys.append((9, 'water', LineString(xs).buffer(w / 2, 4)))
    water_lines.append((LineString(xs), t['waterway'], w))
landtree = shapely.STRtree([p for _, _, p in land_polys])

rails = []
for wid, ll, t in railways:
    xs = proj(ll)
    if len(xs) >= 2 and t.get('railway') in ('rail', 'light_rail'):
        rails.append((LineString(xs), t))
railtree = shapely.STRtree([l for l, _ in rails]) if rails else None

# --------------------------------------------------------------------------- per-edge geometry for surfaces
log('surface geometry')
edge_lines = [LineString(e['pts']) for e in edges]
etree = shapely.STRtree(edge_lines)

def carriage_poly(e):
    return edge_lines_idx[e].buffer(edges[e]['width'] / 2, 6, cap_style='flat' if False else 'round')
edge_lines_idx = edge_lines

# --------------------------------------------------------------------------- binary container
def pack(arrays, meta):
    hdr = {'arrays': {}, **meta}
    blobs, off = [], 0
    for k, a in arrays.items():
        a = np.ascontiguousarray(a)
        dt = {np.dtype('float32'): 'f4', np.dtype('int16'): 'i2', np.dtype('uint16'): 'u2', np.dtype('uint8'): 'u1',
              np.dtype('int32'): 'i4', np.dtype('uint32'): 'u4', np.dtype('int8'): 'i1'}[a.dtype]
        b = a.tobytes()
        hdr['arrays'][k] = [dt, off, int(a.size)]
        blobs.append(b)
        pad = (-len(b)) % 8
        blobs.append(b'\0' * pad)
        off += len(b) + pad
    hj = json.dumps(hdr, separators=(',', ':'), ensure_ascii=False).encode()
    hj += b' ' * ((-(len(hj) + 8)) % 8)
    return b'GCT1' + struct.pack('<I', len(hj)) + hj + b''.join(blobs)

os.makedirs(os.path.join(OUT, 'tiles'), exist_ok=True)

# --------------------------------------------------------------------------- network.bin
log('writing network')
ne = len(edges)
pts_all, y_all, starts, counts = [], [], [], []
off = 0
for e in edges:
    starts.append(off); counts.append(len(e['pts'])); off += len(e['pts'])
    pts_all.append(e['pts']); y_all.append(e['y'])
P = np.concatenate(pts_all); Y = np.concatenate(y_all)
pts3 = np.stack([P[:, 0], Y, P[:, 1]], 1).astype(np.float32)
pav = np.array([(1 if e['pavL'] else 0) | (2 if e['pavR'] else 0) for e in edges], np.uint8)
lens = np.array([LineString(e['pts']).length for e in edges], np.float32)
edge_tiles = defaultdict(list)
for i, l in enumerate(edge_lines):
    x0, z0, x1, z1 = l.bounds
    pad = edges[i]['width'] / 2 + 4
    for ix in range(int(math.floor((x0 - pad) / TILE)), int(math.floor((x1 + pad) / TILE)) + 1):
        for iz in range(int(math.floor((z0 - pad) / TILE)), int(math.floor((z1 + pad) / TILE)) + 1):
            if (ix, iz) in tile_set:
                edge_tiles[(ix, iz)].append(i)
net_arrays = {
    'nodes': node_xyz.astype(np.float32).ravel(),
    'ea': np.array([e['a'] for e in edges], np.int32), 'eb': np.array([e['b'] for e in edges], np.int32),
    'cls': np.array([CLS[e['cls']] for e in edges], np.uint8),
    'flags': np.array([e['flags'] for e in edges], np.uint16),
    'lanesF': np.array([e['lanesF'] for e in edges], np.uint8), 'lanesB': np.array([e['lanesB'] for e in edges], np.uint8),
    'width': np.array([e['width'] for e in edges], np.float32), 'speed': np.array([e['speed'] for e in edges], np.uint8),
    'layer': np.array([e['layer'] for e in edges], np.int8), 'pav': pav,
    'name': np.array([e['name'] for e in edges], np.int32), 'ref': np.array([e['ref'] for e in edges], np.int32),
    'pstart': np.array(starts, np.uint32), 'pcount': np.array(counts, np.uint16), 'pts': pts3.ravel(), 'len': lens,
    'ctrlA': np.array([e['ctrlA'] for e in edges], np.uint8), 'ctrlB': np.array([e['ctrlB'] for e in edges], np.uint8),
    'sigA': np.array([e['sigA'] for e in edges], np.int32), 'sigB': np.array([e['sigB'] for e in edges], np.int32),
    'grpA': np.array([e['grpA'] for e in edges], np.uint8), 'grpB': np.array([e['grpB'] for e in edges], np.uint8),
    'cutA': np.array([e['cutA'] for e in edges], np.float32), 'cutB': np.array([e['cutB'] for e in edges], np.float32),
    'osm': np.array([e['wid'] for e in edges], np.float32) * 0,  # placeholder (ids kept in osmway)
}
net_arrays['osmway'] = np.array([e['wid'] for e in edges], np.float64).astype(np.float32)  # display only
open(os.path.join(OUT, 'network.bin'), 'wb').write(zlib.compress(pack(net_arrays, {
    'names': names, 'classes': DRIVE + WALK,
    'controllers': controllers, 'crossings': crossings,
    'busStops': [[round(s['x'], 1), round(s['z'], 1), s['name'], int(s['shelter'])] for s in bus_stops],
    'routes': [dict(ref=r['ref'], name=r['name'], colour=r['colour'], operator=r['operator'], osm=r['osm'],
                    seq=[[i, d] for i, d in r['seq']], stops=r['stopd'], length=round(r['length'], 1)) for r in routes],
}), 6))
log('network.bin', os.path.getsize(os.path.join(OUT, 'network.bin')))

# --------------------------------------------------------------------------- per-tile build
log('tiles')
pois = []
for nid, lon, lat, t in pnodes:
    if 'name' in t and ('shop' in t or 'amenity' in t):
        x, z = ll_to_world(lon, lat)
        pois.append((x, z, t))
poitree = shapely.STRtree([Point(x, z) for x, z, _ in pois]) if pois else None
trees_pts = []
for nid, lon, lat, t in pnodes:
    if t.get('natural') == 'tree':
        x, z = ll_to_world(lon, lat); trees_pts.append((x, z, 0, num(t.get('height'), 0) or 0))
lamps_pts = []
for nid, lon, lat, t in pnodes:
    if t.get('highway') == 'street_lamp':
        x, z = ll_to_world(lon, lat); lamps_pts.append((x, z))
barrier_lines = []
for wid, ll, t in barriers:
    xs = proj(ll)
    kind = t.get('barrier') or 'tree_row'
    hgt = num(t.get('height')) or {'wall': 1.4, 'fence': 1.5, 'hedge': 1.7, 'retaining_wall': 1.2, 'city_wall': 3.0, 'guard_rail': 0.8, 'tree_row': 0}[kind]
    barrier_lines.append((LineString(xs), kind, hgt))
bartree = shapely.STRtree([l for l, _, _ in barrier_lines]) if barrier_lines else None

# no kerbside parking on crossing zig-zags (20 m) or close to junctions (12 m)
no_park, no_park_r = [], []
for c in crossings:
    no_park.append(Point(c[3], c[4])); no_park_r.append(20.0)
for n, es in deg.items():
    if len(es) >= 3:
        no_park.append(Point(node_xyz[n, 0], node_xyz[n, 2])); no_park_r.append(12.0)
no_park_tree = shapely.STRtree(no_park)

GRID = 32.0   # surface polygon clipping cell (keeps triangles small so they follow terrain)
RAS = 2.0     # landcover raster resolution
NR = int(TILE / RAS)
NT = int(TILE / 4) + 1
stats_tiles = {}

def quant(xy, ox, oz):
    return np.round((np.asarray(xy) - [ox, oz]) * 10).astype(np.int16)

def poly_rings(geom):
    out = []
    if geom.is_empty:
        return out
    gs = [geom] if geom.geom_type == 'Polygon' else [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'Polygon']
    for g in gs:
        if g.area < 0.2:
            continue
        g = shapely.geometry.polygon.orient(g, 1.0)
        out.append([np.array(g.exterior.coords)[:-1]] + [np.array(r.coords)[:-1] for r in g.interiors])
    return out

def encode_polys(polys, ox, oz):
    """polys: list of polygons (list of rings). returns coords i2, ring sizes u2, poly ring counts u1"""
    coords, rsz, prc = [], [], []
    for poly in polys:
        prc.append(len(poly))
        for r in poly:
            coords.append(quant(r, ox, oz)); rsz.append(len(r))
    if not coords:
        return np.zeros(0, np.int16), np.zeros(0, np.uint16), np.zeros(0, np.uint8)
    return np.concatenate(coords).ravel(), np.array(rsz, np.uint16), np.array(prc, np.uint8)

def grid_clip(geom, ox, oz, grid=None):
    polys = []
    if geom.is_empty:
        return polys
    grid = grid or GRID
    n = int(TILE / grid)
    cells = [box(ox + i * grid, oz + j * grid, ox + (i + 1) * grid, oz + (j + 1) * grid) for i in range(n) for j in range(n)]
    tree = shapely.STRtree(cells)
    cells = [cells[k] for k in tree.query(geom, predicate='intersects')]
    parts = shapely.intersection(np.array(cells, dtype=object), geom)
    for g in parts:
        polys.extend(poly_rings(g))
    return polys

# --------------------------------------------------------------------------- water: levels, carved beds, surfaces
# The EA DTM is flat over open water (it records the water surface), so each lake's level is the median DTM
# inside it and a river's level is the DTM smoothed along its channel. Beds are carved below that level,
# deeper away from the shore (gravel-pit lakes up to 6 m, the Thames ~4 m, brooks ~0.5 m), never under
# roads, paths or buildings. Tiles get the water polygons (drawn as a separate surface) and the level on
# their 4 m terrain grid (swimming, wading, cars in water).
log('water')
from scipy import ndimage
Hd, Wd = DEM.shape
def to_px(x, z):
    e = np.asarray(x) * K + E0; n = N0 - np.asarray(z) * K
    return (e - tm['e_min']) / tm['res'] - .5, (tm['n_max'] - n) / tm['res'] - .5
def px_poly(coords):
    c, r = to_px(np.asarray(coords)[:, 0], np.asarray(coords)[:, 1])
    return list(zip(c.tolist(), r.tolist()))
wimg = Image.new('L', (Wd, Hd), 0); wd = ImageDraw.Draw(wimg)
LINE_V = {'river': 3, 'canal': 4, 'stream': 5, 'ditch': 6, 'drain': 6}
for l, ww, w in water_lines:
    wd.line(px_poly(l.coords), fill=LINE_V[ww], width=max(1, int(round(w / tm['res']))) if ww in ('river', 'canal') else 1)
for p, kind, name in water_bodies:
    for poly in poly_rings(p):
        wd.polygon(px_poly(poly[0]), fill=1 if kind == 'lake' else 2)
        for hole in poly[1:]:
            wd.polygon(px_poly(hole), fill=0)
WV = np.array(wimg, np.uint8)
# never under roads, paths (bridges excepted) or buildings
ximg = Image.new('L', (Wd, Hd), 0); xd = ImageDraw.Draw(ximg)
for e in edges:
    if e['bridge'] or e['tunnel']:
        continue
    xd.line(px_poly(e['pts']), fill=1, width=max(1, int(math.ceil((e['width'] + 1.5) / tm['res']))))
for recs in bldg_records.values():
    for r in recs:
        xd.polygon(px_poly(np.array(r['poly'].exterior.coords)), fill=1)
WM = (WV > 0) & (np.array(ximg, np.uint8) == 0)
lab, nlab = ndimage.label(WM, structure=np.ones((3, 3)))
edt = ndimage.distance_transform_edt(WM)
cells = np.bincount(lab.ravel(), minlength=nlab + 1)
maxd = ndimage.maximum(edt, lab, index=np.arange(nlab + 1)); maxd = np.nan_to_num(np.asarray(maxd, np.float64))
votes = np.zeros((nlab + 1, 7), np.int64)
np.add.at(votes, (lab[WM], WV[WM]), 1)
kindv = votes.argmax(1)      # 1 lake, 2 river polygon, 3 river line, 4 canal, 5 stream, 6 ditch/drain
# per-component class: lakes (flat level), channels (level follows the valley), narrow brooks and ditches
LAKE, CHAN, NARROW = 1, 2, 3
comp = np.full(nlab + 1, CHAN, np.int8)
comp[(kindv == 1)] = LAKE
comp[(maxd <= 1.5) & (kindv >= 5)] = NARROW
comp[0] = 0
cmap = comp[lab]
DEMf = DEM.astype(np.float64)
level = np.full(DEM.shape, np.nan)
lake_ids = np.nonzero(comp == LAKE)[0]
if len(lake_ids):
    med = ndimage.median(DEMf, lab, index=lake_ids)
    lv_of = np.zeros(nlab + 1); lv_of[lake_ids] = np.asarray(med) - 0.05
    m = cmap == LAKE; level[m] = lv_of[lab[m]]
for cc, win, drop in ((CHAN, 11, 0.05), (NARROW, 7, 0.12)):
    m = cmap == cc
    if not m.any():
        continue
    num_ = ndimage.uniform_filter(np.where(m, DEMf, 0.0), win); den = ndimage.uniform_filter(m.astype(np.float64), win)
    level[m] = (num_[m] / np.maximum(den[m], 1e-6)) - drop
# depth: deeper with distance from the shore, up to a maximum by kind and size
area_ha = cells * tm['res'] ** 2 / 1e4
dmax_c = np.where(comp == LAKE, np.clip(1.2 + 0.9 * np.sqrt(area_ha), 1.5, 6.0), np.clip(0.6 + maxd * tm['res'] * 0.1, 0.8, 4.0))
dmax = dmax_c[lab]
dmax = np.where(cmap == NARROW, np.where(WV == 6, 0.4, 0.55), dmax)
dist_m = np.maximum(edt - 0.5, 0) * tm['res']
carve = np.minimum(dmax, 0.3 + dist_m * 0.25)
bed = level - carve
DEM = np.where(WM, np.minimum(DEMf, bed), DEMf).astype(np.float32)   # terrain() samples the carved DEM from here on
# level field extended 3 px past the water (the surface polygons are padded under the banks)
ndist, (ir, ic) = ndimage.distance_transform_edt(~WM, return_indices=True)
LVX = np.where(ndist <= 3.0, level[ir, ic], np.nan).astype(np.float32)
def level_at(x, z):
    c, r = to_px(x, z)
    c = np.clip(np.round(c).astype(int), 0, Wd - 1); r = np.clip(np.round(r).astype(int), 0, Hd - 1)
    return LVX[r, c]
# vector water for the surfaces: polygons plus open channels at least 4.4 m wide
wsurf = [p for p, _, _ in water_bodies] + [l.buffer(max(w, 4.4) / 2, 4) for l, ww, w in water_lines]
wtree = shapely.STRtree(wsurf)
water_stats = dict(bodies=int((comp == LAKE).sum()), channels=int((comp == CHAN).sum()), brooks=int((comp == NARROW).sum()),
                   areaHa=round(float(WM.sum()) * tm['res'] ** 2 / 1e4, 1),
                   named=sorted({n for _, _, n in water_bodies if n} | {n for n in []}))
log('water components', nlab, 'lakes', water_stats['bodies'], 'channels', water_stats['channels'], 'brooks', water_stats['brooks'], 'ha', water_stats['areaHa'])
def build_tile(ix, iz):
    ox, oz = ix * TILE, iz * TILE
    tb = box(ox, oz, ox + TILE, oz + TILE)
    tbm = tb.buffer(30)
    A = {}
    # terrain 4 m grid (65x65), centimetres
    gx, gz = np.meshgrid(ox + np.arange(NT) * 4.0, oz + np.arange(NT) * 4.0)
    hgt = terrain(gx.ravel(), gz.ravel())
    hmin = float(np.floor(hgt.min()))
    A['h'] = np.round((hgt - hmin) * 100).astype(np.uint16)
    # surfaces
    eidx = edge_tiles.get((ix, iz), [])
    road_g, pave_g, path_g = [], [], []
    for i in eidx:
        e = edges[i]
        if e['bridge'] or e['tunnel']:
            continue
        l = edge_lines[i]
        if e['cls'] in DRIVE:
            road_g.append(l.buffer(e['width'] / 2, 4))
            pw = 2.6 if e['cls'] in ('primary', 'secondary', 'trunk') else 2.0
            if e['pavL'] or e['pavR']:
                pave_g.append(l.buffer(e['width'] / 2 + pw, 4))
        else:
            path_g.append(l.buffer(e['width'] / 2, 3, cap_style='flat'))
    road = unary_union(road_g).intersection(tbm) if road_g else Polygon()
    near_b = [r['poly'] for key in [(ix + a, iz + b) for a in (-1, 0, 1) for b in (-1, 0, 1)] for r in bldg_records.get(key, []) if r['poly'].intersects(tbm)]
    bunion = unary_union(near_b) if near_b else Polygon()
    pave = (unary_union(pave_g).difference(road).difference(bunion).intersection(tbm)) if pave_g else Polygon()
    plaza = [p for j in landtree.query(tbm) for pr, cl, p in [land_polys[j]] if cl in ('plaza', 'parking')]
    plaza_g = unary_union(plaza).intersection(tbm).difference(road).difference(bunion) if plaza else Polygon()
    paths = (unary_union(path_g).difference(road).difference(pave).difference(bunion).difference(plaza_g).intersection(tbm)) if path_g else Polygon()
    for key, geom in (('road', road.intersection(tb)), ('pave', pave.intersection(tb)), ('path', paths.intersection(tb)), ('plaza', plaza_g.intersection(tb))):
        c, r, pc = encode_polys(grid_clip(geom, ox, oz), ox, oz)
        A[key + 'C'] = c; A[key + 'R'] = r; A[key + 'P'] = pc
    # bridges as explicit ribbons (road + foot + rail)
    br_pts, br_meta = [], []
    for i in eidx:
        e = edges[i]
        if not e['bridge']:
            continue
        mid = e['pts'][len(e['pts']) // 2]
        if tile_of(*mid) != (ix, iz):
            continue
        br_meta.append([len(e['pts']), e['width'], 0 if e['cls'] in DRIVE else 1, i])
        br_pts.append(np.stack([e['pts'][:, 0] - ox, e['y'], e['pts'][:, 1] - oz], 1))
    if railtree is not None:
        for j in railtree.query(tb):
            l, t = rails[j]
            if t.get('bridge') in (None, 'no'):
                continue
            c = l.interpolate(0.5, normalized=True)
            if tile_of(c.x, c.y) != (ix, iz):
                continue
            p = np.array(densify(list(l.coords), 10))
            y = terrain(p[:, 0], p[:, 1]); s = np.concatenate([[0], np.cumsum(np.hypot(np.diff(p[:, 0]), np.diff(p[:, 1])))])
            y = y[0] + (y[-1] - y[0]) * s / max(s[-1], 1)
            br_meta.append([len(p), 4.5, 2, -1])
            br_pts.append(np.stack([p[:, 0] - ox, y, p[:, 1] - oz], 1))
    A['brP'] = np.concatenate(br_pts).astype(np.float32).ravel() if br_pts else np.zeros(0, np.float32)
    A['brM'] = np.array(br_meta, np.float32).ravel() if br_meta else np.zeros(0, np.float32)
    # rails (non-bridge) as lines with terrain heights handled at runtime
    rl = []
    if railtree is not None:
        for j in railtree.query(tb):
            l, t = rails[j]
            if t.get('bridge') not in (None, 'no'):
                continue
            g = l.intersection(tb)
            for seg in ([g] if g.geom_type == 'LineString' else getattr(g, 'geoms', [])):
                if seg.geom_type == 'LineString' and seg.length > 1:
                    rl.append(np.array(densify(list(seg.coords), 8)))
    A['railC'] = np.concatenate([quant(r, ox, oz) for r in rl]).ravel() if rl else np.zeros(0, np.int16)
    A['railN'] = np.array([len(r) for r in rl], np.uint16)
    # landcover raster
    img = Image.new('L', (NR, NR), LC['grass'])
    dr = ImageDraw.Draw(img)
    def fill(geom, val):
        for poly in poly_rings(geom):
            dr.polygon([((x - ox) / RAS, (z - oz) / RAS) for x, z in poly[0]], fill=val)
            for hole in poly[1:]:
                pass  # holes keep the fill (minor); landuse holes are rare inside a tile
    for j in sorted(landtree.query(tbm), key=lambda j: land_polys[j][0]):
        pr, cl, p = land_polys[j]
        g = p.intersection(tbm)
        for poly in poly_rings(g):
            dr.polygon([((x - ox) / RAS, (z - oz) / RAS) for x, z in poly[0]], fill=LC[cl])
            if len(poly) > 1:
                # holes: re-fill with whatever the next-lower polygon would give (approximate as garden/grass)
                for hole in poly[1:]:
                    dr.polygon([((x - ox) / RAS, (z - oz) / RAS) for x, z in hole], fill=LC['grass'])
    fill(paths, LC['path'])
    fill(plaza_g, LC['plaza'])
    fill(pave, LC['pavement'])
    fill(road, LC['road'])
    for l in rl:
        dr.line([((x - ox) / RAS, (z - oz) / RAS) for x, z in l], fill=LC['rail'], width=2)
    fill(bunion.intersection(tbm) if near_b else Polygon(), LC['building'])
    A['lc'] = np.array(img, np.uint8).ravel()
    # water: surface polygons (padded under the banks, clear of roads, paths and buildings) and the level grid
    wq = wtree.query(tbm)
    if len(wq):
        def areal(g):
            # polygons only (overlay results can be collections with stray lines and points)
            ps = [q for q in shapely.get_parts(g) if q.geom_type == 'Polygon' and q.area > 0.01]
            return unary_union(ps) if ps else Polygon()
        def robust(f, *gs):
            # GEOS can fail on near-coincident edges; retry valid and on a 5 cm grid, else give up (None)
            for prep in (lambda g: g, lambda g: shapely.set_precision(shapely.make_valid(g), 0.05), lambda g: g.buffer(0.02)):
                try:
                    return areal(f(*[areal(prep(g)) for g in gs]))
                except Exception:
                    continue
            return None
        wg = robust(lambda *g: unary_union(g).intersection(tbm).buffer(2.5, 4), *[wsurf[j] for j in wq]) or Polygon()
        cut = [g for g in (road, paths, bunion) if not g.is_empty]
        if cut and not wg.is_empty:
            cu = robust(lambda *g: unary_union(g), *cut)
            if cu is not None and not cu.is_empty:
                wg = robust(lambda a, b: a.difference(b), wg, cu) or wg
        wg = robust(lambda a, b: a.intersection(b), wg, tb) or Polygon()
        if not wg.is_empty and wg.area > 1:
            # 8 m cells: enough vertices for the depth (and so the colour) to follow the shelving bed
            c, r, pc = encode_polys(grid_clip(wg, ox, oz, 8.0), ox, oz)
            if len(r):
                A['wtC'] = c; A['wtR'] = r; A['wtP'] = pc
                lvg = level_at(gx.ravel(), gz.ravel())
                A['wl'] = np.where(np.isnan(lvg), 32767, np.round(lvg * 100)).astype(np.int16)
    # buildings
    recs = bldg_records.get((ix, iz), [])
    # shops mapped as POI nodes inside a footprint mark that building as a shop (shopfront glazing)
    if poitree is not None and recs:
        bt = shapely.STRtree([r['poly'] for r in recs])
        for j in poitree.query(tb.buffer(20)):
            x, z, t = pois[j]
            for k in bt.query(Point(x, z).buffer(2.5)):
                if recs[k]['poly'].distance(Point(x, z)) < 2.5:
                    recs[k]['shop'] = 1
                    break
    bc, br, bp, bm, bnames = [], [], [], [], []
    for r in recs:
        rings = poly_rings(r['poly'].simplify(0.15))
        if not rings:
            continue
        poly = rings[0]
        bp.append(len(poly))
        for ring in poly:
            bc.append(quant(ring, ox, oz)); br.append(len(ring))
        rr = r['rr'] or (0, 0, 0, 0, 0)
        col = 0
        if r['colour']:
            col = h32(r['colour']) & 0xffffff | 0x1000000
        bm.append([r['base'] - hmin, r['low'] - hmin, r['wall'], r['roof'], r['rh'], rr[0] - ox, rr[1] - oz, rr[2], rr[3], rr[4],
                   r['cls'], r['lv'], r['shop'], h32(r['oid']) % 997, 1 if r['landmark'] else 0,
                   {'tag:height': 2, 'tag:levels': 1, 'inferred': 0}[r['hsrc']]])
        bnames.append(r['name'])
    A['bC'] = np.concatenate(bc).ravel() if bc else np.zeros(0, np.int16)
    A['bR'] = np.array(br, np.uint16); A['bP'] = np.array(bp, np.uint8)
    A['bM'] = np.array(bm, np.float32).ravel() if bm else np.zeros(0, np.float32)
    # shop signs: attach named POIs to the nearest building edge facing a road
    signs, stext = [], []
    if poitree is not None and recs:
        btile = shapely.STRtree([r['poly'] for r in recs])
        for j in poitree.query(tb):
            x, z, t = pois[j]
            pt = Point(x, z)
            cand = btile.query(pt.buffer(12))
            if len(cand) == 0:
                continue
            bi = min(cand, key=lambda k: recs[k]['poly'].distance(pt))
            poly = recs[bi]['poly']
            ex = np.array(poly.exterior.coords)
            best = None
            for k in range(len(ex) - 1):
                seg = LineString([ex[k], ex[k + 1]])
                if seg.length < 3:
                    continue
                d = seg.distance(pt)
                # prefer edges near a road
                mid = seg.interpolate(0.5, normalized=True)
                rd = min((edge_lines[q].distance(mid) for q in etree.query(mid.buffer(40))), default=60)
                score = d + rd * 0.6
                if best is None or score < best[0]:
                    best = (score, ex[k], ex[k + 1])
            if best is None:
                continue
            a_, b_ = best[1], best[2]
            L = math.hypot(*(b_ - a_)); u = (b_ - a_) / L
            s0 = max(0.4, min(L - 0.4, LineString([a_, b_]).project(pt)))
            w = min(L - 0.6, max(3.5, min(9, len(t['name']) * 0.55)))
            c0 = max(0.3, min(L - 0.3 - w, s0 - w / 2))
            p0 = a_ + u * c0; p1 = a_ + u * (c0 + w)
            cat = 1 if 'shop' in t else 2 if t.get('amenity') in ('pub', 'bar') else 3 if t.get('amenity') in ('cafe', 'restaurant', 'fast_food') else 4
            signs.append([p0[0] - ox, p0[1] - oz, p1[0] - ox, p1[1] - oz, recs[bi]['base'] - hmin, bi, cat])
            stext.append(t['name'][:28])
    A['sg'] = np.array(signs, np.float32).ravel() if signs else np.zeros(0, np.float32)
    # trees: mapped trees + scatter in woods/parks/gardens (deterministic)
    trs = [(x - ox, z - oz, 0, h) for x, z, _, h in trees_pts if ox <= x < ox + TILE and oz <= z < oz + TILE]
    rng = np.random.default_rng((ix + 1000) * 7919 + (iz + 1000) * 104729)
    lcimg = A['lc'].reshape(NR, NR)
    dens = {LC['wood']: 0.045, LC['park']: 0.004, LC['garden']: 0.0045, LC['cemetery']: 0.006, LC['scrub']: 0.012, LC['grass']: 0.0012}
    for cl, d in dens.items():
        nc = int((lcimg == cl).sum() * RAS * RAS * d)
        if nc == 0:
            continue
        cand = np.argwhere(lcimg == cl)
        pick = cand[rng.choice(len(cand), size=min(nc, len(cand)), replace=False)]
        for r_, c_ in pick:
            x = (c_ + rng.random()) * RAS; z = (r_ + rng.random()) * RAS
            # keep away from buildings / roads
            if lcimg[max(0, r_ - 1):r_ + 2, max(0, c_ - 1):c_ + 2].max() in (LC['building'], LC['road'], LC['pavement']):
                continue
            trs.append((x, z, 1 if cl == LC['wood'] else 2 if cl in (LC['garden'],) else 3, 0))
    A['tr'] = np.array(trs, np.float32).ravel() if trs else np.zeros(0, np.float32)
    # street lamps: mapped ones, else inferred every ~34 m along urban roads (pavement side)
    lamps = [(x - ox, z - oz, 0, 1) for x, z in lamps_pts if ox <= x < ox + TILE and oz <= z < oz + TILE]
    inferred = 0
    if not lamps:
        for i in eidx:
            e = edges[i]
            if e['cls'] not in DRIVE or not (e['pavL'] or e['pavR']) or e['bridge']:
                continue
            l = edge_lines[i]
            step = 30 if RANK.get(e['cls'], 0) >= 6 else 36
            k = 0
            for s in np.arange(step / 2, l.length, step):
                p0 = l.interpolate(s); p1 = l.interpolate(min(l.length, s + 1))
                dx, dz = p1.x - p0.x, p1.y - p0.y; n_ = math.hypot(dx, dz) or 1
                side = 1 if (k % 2 == 0 or not e['pavL']) and e['pavR'] else -1
                if RANK.get(e['cls'], 0) >= 7:
                    side = 1 if k % 2 == 0 else -1
                off = e['width'] / 2 + 0.6
                # left = (dz,-dx)
                x = p0.x + side * (-dz / n_) * off * -1; z = p0.y + side * (dx / n_) * off * -1
                x = p0.x - side * dz / n_ * off; z = p0.y + side * dx / n_ * off
                k += 1
                if not (ox <= x < ox + TILE and oz <= z < oz + TILE):
                    continue
                c_, r_ = int((x - ox) / RAS), int((z - oz) / RAS)
                if lcimg[min(r_, NR - 1), min(c_, NR - 1)] == LC['building']:
                    continue
                lamps.append((x - ox, z - oz, math.atan2(side * dz, -side * dx) if False else math.atan2(-(z - p0.y), -(x - p0.x)), 0))
                inferred += 1
    A['lp'] = np.array(lamps, np.float32).ravel() if lamps else np.zeros(0, np.float32)
    # barriers (walls / fences / hedges / tree rows)
    bl, bk = [], []
    if bartree is not None:
        for j in bartree.query(tb):
            l, kind, hgt = barrier_lines[j]
            g = l.intersection(tb)
            for seg in ([g] if g.geom_type == 'LineString' else getattr(g, 'geoms', [])):
                if seg.geom_type == 'LineString' and seg.length > 0.5:
                    c = np.array(seg.coords)
                    bl.append(quant(c, ox, oz)); bk.append([len(c), ['wall', 'fence', 'hedge', 'retaining_wall', 'city_wall', 'guard_rail', 'tree_row'].index(kind), hgt])
    A['wlC'] = np.concatenate(bl).ravel() if bl else np.zeros(0, np.int16)
    A['wlM'] = np.array(bk, np.float32).ravel() if bk else np.zeros(0, np.float32)
    # parking slots: car park polygons (grid) + residential kerbside
    slots = []
    for j in landtree.query(tb):
        pr, cl, p = land_polys[j]
        if cl != 'parking':
            continue
        g = p.intersection(tb)
        if g.is_empty or g.area < 60:
            continue
        mrr = g.minimum_rotated_rectangle
        rc = np.array(mrr.exterior.coords)[:4]
        e1 = rc[1] - rc[0]; ang = math.atan2(e1[1], e1[0])
        ca, sa = math.cos(ang), math.sin(ang)
        x0, z0, x1, z1 = g.bounds
        for u in np.arange(-80, 80, 2.6):
            for v in np.arange(-80, 80, 7.5):
                x = (x0 + x1) / 2 + u * ca - v * sa; z = (z0 + z1) / 2 + u * sa + v * ca
                if g.contains(Point(x, z).buffer(1.4)) and rng.random() < 0.55:
                    if not (ox <= x < ox + TILE and oz <= z < oz + TILE):
                        continue
                    slots.append((x - ox, z - oz, ang + math.pi / 2, 1))
    for i in eidx:
        e = edges[i]
        if e['cls'] not in ('residential', 'unclassified', 'living_street') or not e['pavL'] or e['bridge']:
            continue
        l = edge_lines[i]
        if l.length < 30:
            continue
        for s in np.arange(12, l.length - 12, 6.2):
            pp = l.interpolate(s)
            if len(no_park_tree.query(pp.buffer(20))) and any(no_park[j].distance(pp) < no_park_r[j] for j in no_park_tree.query(pp.buffer(20))):
                continue
            if rng.random() > 0.33:
                continue
            p0 = l.interpolate(s); p1 = l.interpolate(min(l.length, s + 1))
            dx, dz = p1.x - p0.x, p1.y - p0.y; n_ = math.hypot(dx, dz) or 1
            side = 1 if rng.random() < .5 else -1  # +1 = left kerb (UK nearside for forward travel)
            off = e['width'] / 2 - 1.0
            x = p0.x + side * dz / n_ * off; z = p0.y - side * dx / n_ * off
            if not (ox <= x < ox + TILE and oz <= z < oz + TILE):
                continue
            ang = math.atan2(dz, dx) if side == 1 else math.atan2(-dz, -dx)
            slots.append((x - ox, z - oz, ang, 0))
    A['pk'] = np.array(slots, np.float32).ravel() if slots else np.zeros(0, np.float32)
    meta = {'ix': ix, 'iz': iz, 'hmin': hmin, 'bn': bnames, 'sn': stext, 'edges': eidx, 'lampsInferred': inferred}
    blob = zlib.compress(pack(A, meta), 6)
    open(os.path.join(OUT, 'tiles', f'{ix}_{iz}.bin'), 'wb').write(blob)
    return (ix, iz), dict(b=len(recs), roads=len(eidx), lamps=len(lamps), lampsInferred=inferred, trees=len(trs),
                          signs=len(signs), slots=len(slots), bytes=len(blob), walls=len(bl))

ONLY = os.environ.get('ONLY_TILES')
todo = tiles if not ONLY else [t for t in tiles if f'{t[0]}_{t[1]}' in ONLY.split(',')]
for n, (ix, iz) in enumerate(todo):
    k, s = build_tile(ix, iz)
    stats_tiles[f'{ix}_{iz}'] = s
    if n % 100 == 0:
        log('tile', n, '/', len(todo), s)
log('tiles done', sum(s['bytes'] for s in stats_tiles.values()) / 1e6, 'MB')

# --------------------------------------------------------------------------- overview raster (4 m/px)
log('overview raster')
MPX = 4.0
ovx0 = math.floor(minx / 1024) * 1024; ovz0 = math.floor(minz / 1024) * 1024
ovx1 = math.ceil(maxx / 1024) * 1024; ovz1 = math.ceil(maxz / 1024) * 1024
OW, OH = int((ovx1 - ovx0) / MPX), int((ovz1 - ovz0) / MPX)
ov = Image.new('RGB', (OW, OH), (206, 214, 190))
od = ImageDraw.Draw(ov)
PAL = {'water': (151, 190, 214), 'wood': (150, 182, 130), 'farm': (220, 222, 190), 'park': (184, 214, 164), 'parking': (220, 218, 214),
       'garden': (222, 226, 208), 'plaza': (232, 226, 214), 'pitch': (170, 210, 160), 'allot': (200, 214, 170), 'scrub': (178, 200, 150),
       'cemetery': (190, 212, 180), 'hard': (226, 220, 222), 'brown': (214, 206, 186), 'sand': (236, 226, 190), 'grass': (206, 220, 186), 'plaza2': (0, 0, 0)}
def opt(x, z):
    return ((x - ovx0) / MPX, (z - ovz0) / MPX)
for pr, cl, p in land_polys:
    for poly in poly_rings(p):
        od.polygon([opt(x, z) for x, z in poly[0]], fill=PAL.get(cl, (206, 214, 190)))
for key, recs in bldg_records.items():
    for r in recs:
        od.polygon([opt(x, z) for x, z in np.array(r['poly'].exterior.coords)], fill=(176, 166, 160))
for l, t in rails:
    od.line([opt(x, z) for x, z in l.coords], fill=(150, 150, 150), width=2)
# coverage outline (outside darkened)
mask = Image.new('L', (OW, OH), 110)
ImageDraw.Draw(mask).polygon([opt(x, z) for x, z in coverage.exterior.coords], fill=0)
ov = Image.composite(Image.new('RGB', (OW, OH), (120, 128, 118)), ov, mask)
os.makedirs(os.path.join(OUT, 'overview'), exist_ok=True)
OT = 256
for i in range(0, OW, OT):
    for j in range(0, OH, OT):
        ov.crop((i, j, i + OT, j + OT)).save(os.path.join(OUT, 'overview', f'{i // OT}_{j // OT}.png'), optimize=True)

# --------------------------------------------------------------------------- manifest + coverage stats
log('manifest')
districts_out = []
for name, lon, lat, r in DISTRICTS:
    x, z = ll_to_world(lon, lat)
    districts_out.append(dict(name=name, x=round(x, 1), z=round(z, 1), r=r, kind='district'))
# every other named town, suburb, village and hamlet in the study area (OSM place nodes), so the whole map has names
PLACE_R = {'town': 1300, 'suburb': 800, 'village': 750, 'quarter': 600, 'neighbourhood': 400, 'hamlet': 350}
seen_names = {d['name'] for d in districts_out}
for name, kind, lon, lat in sorted(places, key=lambda p: list(PLACE_R).index(p[1])):
    x, z = ll_to_world(lon, lat)
    if not coverage.contains(Point(x, z)) or name in seen_names:
        continue
    if any(math.hypot(x - d['x'], z - d['z']) < d['r'] * 0.6 for d in districts_out):
        continue     # inside a district already named
    seen_names.add(name)
    districts_out.append(dict(name=name, x=round(x, 1), z=round(z, 1), r=PLACE_R[kind], kind=kind))
log('named places', len(districts_out))
route_len = defaultdict(float)
for e in edges:
    rf = names[e['ref']]
    if rf in ('A329', 'A329(M)'):
        route_len[rf] += LineString(e['pts']).length
manifest = dict(
    version=1, built=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    frame=dict(crs='EPSG:27700', transform='OSTN15 (pyproj)', E0=E0, N0=N0, K=K, tile=TILE, axes='x=east, z=south, y=up (m above ODN)'),
    tiles=[f'{ix}_{iz}' for ix, iz in tiles],
    coverage=[[round(x, 1), round(z, 1)] for x, z in coverage.exterior.coords],
    coverageAreaKm2=round(coverage.area / 1e6, 2),
    districts=districts_out,
    overview=dict(x0=ovx0, z0=ovz0, mpx=MPX, w=OW, h=OH, tile=OT),
    raster=dict(res=RAS, n=NR, classes=LC), terrain=dict(step=4, n=NT),
    sources=dict(osm=dict(file='south_east-latest.osm.pbf (download.openstreetmap.fr)', timestamp='2026-11-19T02:11:32Z', licence='ODbL 1.0'),
                 terrain=tm['source']),
)
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), separators=(',', ':'))
cov = dict(
    built=manifest['built'], coverageAreaKm2=manifest['coverageAreaKm2'], tiles=len(tiles),
    buildings={k: dict(v) for k, v in stats_b.items()},
    roads=dict(edges=len(edges), drivable=sum(1 for e in edges if e['drive']), named=sum(1 for e in edges if e['name']),
               bridges=sum(1 for e in edges if e['bridge']), tunnels=sum(1 for e in edges if e['tunnel']),
               bridgeClearanceAdjustments=bridge_fixes,
               pavementsTagged=sum(1 for e in edges if e['t'].get('sidewalk') or e['t'].get('sidewalk:both') or e['t'].get('sidewalk:left') or e['t'].get('sidewalk:right')),
               lanesTagged=sum(1 for e in edges if 'lanes' in e['t']), widthTagged=sum(1 for e in edges if 'width' in e['t']),
               maxspeedTagged=sum(1 for e in edges if 'maxspeed' in e['t'])),
    routeLengthsM={k: round(v, 1) for k, v in route_len.items()},
    signals=dict(controllers=len(controllers), approaches=sum(len(c['approaches']) for c in controllers),
                 standaloneCrossings=sum(1 for c in controllers if c['standalone']), pedestrianSignalCrossings=sum(len(c['peds']) for c in controllers),
                 timings='simulated (no published phase data imported)'),
    crossings={k: sum(1 for c in crossings if c[2] == k) for k in ('signal', 'zebra', 'uncontrolled')},
    busRoutes=dict(relations=len(relations), reconstructed=len(routes), refs=sorted(set(r['ref'] for r in routes))),
    busStops=len(bus_stops), busStopsWithShelterTag=sum(1 for s in bus_stops if s['shelter']),
    lamps=dict(mapped=len(lamps_pts), inferred=sum(s['lampsInferred'] for s in stats_tiles.values())),
    trees=dict(mapped=len(trees_pts), total=sum(s['trees'] for s in stats_tiles.values())),
    shopSigns=sum(s['signs'] for s in stats_tiles.values()),
    barriers=len(barrier_lines), parkingSlots=sum(s['slots'] for s in stats_tiles.values()),
    tileBytes=sum(s['bytes'] for s in stats_tiles.values()),
    water=water_stats,
)
json.dump(cov, open(os.path.join(OUT, 'coverage.json'), 'w'), indent=1)
log('done')

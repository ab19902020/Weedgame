"""Cut the Green County study area out of a regional OSM extract.

Usage: python3 extract_osm.py <regional.osm.pbf> <out.osm.pbf>
Keeps every way touching the study bbox, every tagged node inside it and every
relation with a member way kept, then writes all referenced objects so the
output is referentially complete.
"""
import sys, osmium

W, S, E, N = -1.005, 51.385, -0.725, 51.485

def inside(loc):
    return loc.valid() and W <= loc.lon <= E and S <= loc.lat <= N

src, out = sys.argv[1], sys.argv[2]
ways = set()
for w in osmium.FileProcessor(src, osmium.osm.NODE | osmium.osm.WAY).with_locations():
    if w.is_way() and any(inside(n.location) for n in w.nodes):
        ways.add(w.id)
print('pass 1 done', flush=True)

with osmium.BackReferenceWriter(out, ref_src=src, overwrite=True, remove_tags=True) as wr:
    n_nodes = n_ways = n_rels = 0
    for o in osmium.FileProcessor(src).with_locations():
        if o.is_node():
            if len(o.tags) and inside(o.location):
                wr.add(o); n_nodes += 1
        elif o.is_way():
            if o.id in ways:
                wr.add(o); n_ways += 1
        elif o.is_relation():
            if any(m.type == 'w' and m.ref in ways for m in o.members):
                wr.add(o); n_rels += 1
    print('tagged nodes', n_nodes, 'ways', n_ways, 'relations', n_rels)

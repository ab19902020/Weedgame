# Green County trees, grown in Blender 4.3 (bpy, bmesh, mathutils).
#
#   blender -b -P tools/blender/trees.py -- [--preview DIR]      (Blender 4.3.2; or a Python with the bpy 4.3 module)
#
# Writes www/vegetation/trees.glb: one mesh per tree (broadleaves grown by space colonisation inside a crown
# envelope; conifers as whorls about a leader), in metres, standing on its origin, Y up. Each has:
#   POSITION, NORMAL (bark: round; leaf cards: "volume" normals out of the crown), TEXCOORD_0 (bark: metres
#   around and along the branch, for the game's tiling bark; leaves: the quarter of the game's 2x2 leaf atlas for
#   the species), COLOR_0 = (ambient occlusion, sway weight 0 at the root .. 1 at the twig ends, leaf 0/1,
#   bark tone 0 brown and rough (oak) .. 1 smooth grey (beech)).
#   extras: height, crownRadius, crownBase (metres), the atlas quarter.
# The ambient occlusion is ray traced through the tree with mathutils' BVH: leaves let ~half the light through,
# bark none, the ground (below the horizon) a little. The game (src/nearTrees.js) draws these for the trees near
# you and hands over to the cheap leaf-card crowns (vegetation.js) further off.
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Matrix, kdtree, bvhtree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'www', 'vegetation', 'trees.glb')

# atlas quarters (the canvas in vegetation.js leafTexture: 0 oak top-left, 1 lime top-right, 2 field-maple green
# bottom-left (copper beech is tinted from it), 3 needles bottom-right), as (u0, v0) in canvas fractions from the top
QUAD = {0: (0.0, 0.0), 1: (0.5, 0.0), 2: (0.0, 0.5), 3: (0.5, 0.5)}

# ---------------------------------------------------------------------------------------------- the species
# H: height; trunkR: radius at the base (above the flare); base: where the crown starts; centre/rh/rv: the crown
# envelope (an ellipsoid, with lobes); leader: how far up the main stem runs on into the crown (fraction of H);
# up: phototropism; skirt: lower crown kept wide (beech); lobes: how lumpy; card: leaf-cluster size; cards: max.
SPECIES = [
    dict(name='oak_a', quad=0, H=14.0, seed=11, trunkR=0.46, base=2.9, centre=8.1, rh=6.0, rv=5.5, leader=0.32, up=0.04, skirt=0.0, lobes=0.30, card=1.55, cards=600, clumps=30, sep=2.1, clump=1.8, bark=0.0),
    dict(name='oak_b', quad=0, H=12.5, seed=23, trunkR=0.42, base=2.4, centre=7.2, rh=5.4, rv=5.0, leader=0.28, up=0.05, skirt=0.0, lobes=0.36, card=1.5, cards=560, lean=(0.9, 0.4), clumps=27, sep=2.0, clump=1.75, bark=0.05),
    dict(name='lime_a', quad=1, H=18.0, seed=5, trunkR=0.36, base=3.8, centre=11.7, rh=4.9, rv=6.6, leader=0.78, up=0.16, skirt=0.0, lobes=0.18, card=1.45, cards=620, clumps=44, sep=1.45, clump=1.45, bark=0.4),
    dict(name='lime_b', quad=1, H=16.5, seed=8, trunkR=0.34, base=3.4, centre=10.6, rh=5.3, rv=6.0, leader=0.70, up=0.14, skirt=0.0, lobes=0.24, card=1.45, cards=600, clumps=40, sep=1.55, clump=1.5, bark=0.45),
    dict(name='plane', quad=1, H=20.0, seed=31, trunkR=0.42, base=4.8, centre=13.0, rh=7.0, rv=6.8, leader=0.55, up=0.08, skirt=0.0, lobes=0.38, card=1.6, cards=640, clumps=30, sep=2.3, clump=2.0, bark=0.75),
    dict(name='beech', quad=2, H=15.0, seed=41, trunkR=0.40, base=1.9, centre=8.4, rh=6.0, rv=6.5, leader=0.45, up=0.03, skirt=0.6, lobes=0.20, card=1.45, cards=680, clumps=52, sep=1.5, clump=1.55, bark=1.0),
    dict(name='conifer', quad=3, H=12.0, seed=51, trunkR=0.26, conifer=True, base=1.0, spread=3.0, card=1.05, cards=460, bark=0.2),
]


class Node:
    __slots__ = ('p', 'parent', 'kids', 'r', 'depth', 's')
    def __init__(self, p, parent):
        self.p = p; self.parent = parent; self.kids = []; self.r = 0.0; self.depth = 0; self.s = 0.0


def envelope_points(sp, rng):
    """Attraction points in clumps around the crown (foliage masses with gaps between, as real crowns carry
    their leaves), the clumps spread through the outer part of a lumpy ellipsoid; a few loose points inside."""
    c = Vector((0, 0, sp['centre']))
    lobes = [(Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 0.6))).normalized(), rng.uniform(0.4, 1.0)) for _ in range(6)]
    lean = Vector((*sp.get('lean', (0, 0)), 0))

    def place(d, f):
        k = 1.0 + sp['lobes'] * (sum(a * max(0.0, d.dot(l)) ** 3 for l, a in lobes) - 0.35)
        x, y, z = d.x * sp['rh'] * k * f, d.y * sp['rh'] * k * f, d.z * sp['rv'] * k * f
        if z < 0 and sp['skirt'] > 0:                     # beech: the lower crown stays wide, sweeping down
            w = 1.0 + sp['skirt'] * (-d.z); x *= w; y *= w
        return c + Vector((x, y, z)) + lean * max(0.0, (z + sp['rv']) / (2 * sp['rv']))

    def rdir():
        while True:
            d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
            if d.length > 1e-6: return d.normalized()

    K, sep = sp.get('clumps', 36), sp.get('sep', 1.7)
    centres, tries = [], 0
    while len(centres) < K and tries < 20000:
        tries += 1
        p = place(rdir(), 0.5 + 0.45 * rng.random() ** 0.6)
        if p.z < sp['base'] + 1.0 or p.z > sp['H'] - 0.5: continue
        if any((p - q).length < sep for q in centres): continue
        centres.append(p)
    pts = []
    for q in centres:
        rad = rng.uniform(0.9, 1.5) * sp.get('clump', 1.6)
        for _ in range(64):
            o = rdir() * rad * rng.random() ** 0.5
            o.z *= 0.75                                   # (clumps a little flattened: leaves face the light)
            pts.append(q + o)
    for _ in range(len(pts) // 9):                        # loose points inside: the structure between clumps
        pts.append(place(rdir(), 0.15 + 0.5 * rng.random()))
    return [p for p in pts if sp['base'] + 0.4 < p.z < sp['H']]


def grow_broadleaf(sp, rng):
    """Space colonisation (Runions et al. 2007) from a trunk that runs up into the crown."""
    D, di, dk = 0.36, 2.4, 0.75
    nodes = [Node(Vector((0, 0, 0)), -1)]
    # the trunk: gently bending up to the crown, then on as the leader
    top = sp['base'] + (sp['H'] - sp['base']) * sp['leader']
    bend = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.05
    p = Vector((0, 0, 0)); h = 0.0
    while h < top:
        step = Vector((bend.x + rng.uniform(-0.03, 0.03), bend.y + rng.uniform(-0.03, 0.03), 1)).normalized() * D * 1.4
        p = p + step; h = p.z
        nodes.append(Node(p.copy(), len(nodes) - 1))
    pts = envelope_points(sp, rng)
    alive = [True] * len(pts)
    up = Vector((0, 0, sp['up']))
    for it in range(260):
        kd = kdtree.KDTree(len(nodes))
        for i, nd in enumerate(nodes): kd.insert(nd.p, i)
        kd.balance()
        pull = {}
        for j, q in enumerate(pts):
            if not alive[j]: continue
            co, idx, dist = kd.find(q)
            if dist < dk: alive[j] = False; continue
            if dist < di:
                v = pull.get(idx)
                d = (q - co); d.normalize()
                if v is None: pull[idx] = d
                else: v += d
        if not pull: break
        added = 0
        for idx, v in pull.items():
            if v.length < 0.3: continue                   # pulled evenly both ways: no clear direction
            d = (v.normalized() + up); d.normalize()
            q = nodes[idx].p + d * D
            # (don't grow a second twig from a node in the same direction as one it already has)
            if any((nodes[k].p - q).length < D * 0.55 for k in nodes[idx].kids): continue
            nodes.append(Node(q, idx)); nodes[idx].kids.append(len(nodes) - 1); added += 1
        if not added: break
    for i, nd in enumerate(nodes):
        if nd.parent >= 0 and i not in nodes[nd.parent].kids: nodes[nd.parent].kids.append(i)
    return nodes


def grow_conifer(sp, rng):
    """A straight leader with whorls of branches, longest at the bottom (Leyland / spruce-like)."""
    H = sp['H']; nodes = [Node(Vector((0, 0, 0)), -1)]
    leader = [0]; z = 0.0
    while z < H:
        z = min(H, z + 0.34)
        nodes.append(Node(Vector((rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02), z)), leader[-1])); leader.append(len(nodes) - 1)
    ang = rng.uniform(0, 6.283)
    for li in leader:
        zz = nodes[li].p.z
        if zz < sp['base'] or zz > H - 0.35: continue
        f = (zz - sp['base']) / (H - sp['base'])
        L = sp['spread'] * (1 - f) ** 0.95 + 0.35
        for k in range(rng.choice((4, 5, 5, 6))):
            ang += 2.39996 + rng.uniform(-0.2, 0.2)
            out = Vector((math.cos(ang), math.sin(ang), 0))
            tilt = -0.25 + 0.55 * f + rng.uniform(-0.08, 0.08)     # low branches droop, high ones lift
            p = nodes[li].p.copy(); par = li; segs = max(2, int(L / 0.4))
            for s in range(segs):
                dirv = (out + Vector((0, 0, tilt - 0.35 * s / segs))).normalized()
                p = p + dirv * (L / segs)
                nodes.append(Node(p.copy(), par)); par = len(nodes) - 1
    for i, nd in enumerate(nodes):
        if nd.parent >= 0: nodes[nd.parent].kids.append(i)
    return nodes


def radii(nodes, sp):
    """Pipe model: a branch carries the summed cross-sections of what grows from it (da Vinci, exponent 2.4)."""
    n = 2.4
    for i in range(len(nodes) - 1, -1, -1):
        nd = nodes[i]
        nd.r = 0.012 if not nd.kids else sum(nodes[k].r ** n for k in nd.kids) ** (1 / n)
    scale = sp['trunkR'] / max(nodes[0].r, 1e-4)
    for nd in nodes: nd.r *= scale
    # (path length from the root: the sway weight)
    for i, nd in enumerate(nodes):
        if nd.parent >= 0:
            par = nodes[nd.parent]; nd.s = par.s + (nd.p - par.p).length; nd.depth = par.depth + 1


def chains(nodes):
    """Split the tree into branches: each follows its thickest child on; the others start branches of their own."""
    out = []; stack = [(0, -1)]
    while stack:
        start, junction = stack.pop()
        ch = [junction] if junction >= 0 else []
        i = start
        while True:
            ch.append(i)
            kids = sorted(nodes[i].kids, key=lambda k: -nodes[k].r)
            if not kids: break
            for k in kids[1:]: stack.append((k, i))
            i = kids[0]
        out.append(ch)
    return out


def simplify(nodes, ch, minR):
    """Keep fewer rings: further apart on thin branches and where the branch runs straight."""
    keep = [ch[0]]
    for a, b, c in zip(ch, ch[1:], ch[2:]):
        pa, pb, pc = nodes[keep[-1]].p, nodes[b].p, nodes[c].p
        r = nodes[b].r
        gap = 0.8 + 2.6 * (1 - min(1, r / 0.3))
        d1 = (pb - pa); d2 = (pc - pb)
        turn = d1.angle(d2) if d1.length > 1e-5 and d2.length > 1e-5 else 0
        if (pb - pa).length >= gap or turn > 0.5: keep.append(b)
    if keep[-1] != ch[-1]: keep.append(ch[-1])
    return [k for k in keep if nodes[k].r >= minR * 0.6 or k == keep[0]]


def build(sp):
    rng = random.Random(sp['seed'])
    conifer = sp.get('conifer', False)
    nodes = grow_conifer(sp, rng) if conifer else grow_broadleaf(sp, rng)
    radii(nodes, sp)
    smax = max(nd.s for nd in nodes) or 1
    V, N, UV, C, F, leafF = [], [], [], [], [], []

    def sway(s): return min(1.0, (s / smax) ** 1.6)

    # ---- bark: a tube along each branch (skipping twigs too thin to see under the leaves)
    minR = 0.04 if not conifer else 0.02
    # thickest branches first, until the bark budget is spent (the leaves hide the thin ones anyway)
    budget = sp.get('barkTris', 2200 if not conifer else 1500)
    todo = []
    for ch in chains(nodes):
        if nodes[ch[-1 if len(ch) == 1 else 1]].r < minR: continue
        keep = simplify(nodes, ch, minR)
        if len(keep) < 2: continue
        r0 = nodes[keep[min(1, len(keep) - 1)]].r
        sides = 8 if r0 > 0.25 else 6 if r0 > 0.1 else 5 if r0 > 0.06 else 4 if r0 > 0.03 else 3
        todo.append((r0, ch, keep, sides))
    todo.sort(key=lambda t: -t[0])
    spent = 0
    for r0, ch, keep, sides in todo:
        cost = 2 * sides * (len(keep) - 1)
        if spent + cost > budget and spent > 0: continue
        spent += cost
        circ = 2 * math.pi * r0
        urange = max(0.25, round(circ * 4) / 4)          # whole quarter-repeats of the 1 m bark: no seam to speak of
        prevN = None; vlen = 0.0; rings = []
        for j, k in enumerate(keep):
            p = nodes[k].p
            a = nodes[keep[max(0, j - 1)]].p; b = nodes[keep[min(len(keep) - 1, j + 1)]].p
            t = (b - a); t = t.normalized() if t.length > 1e-6 else Vector((0, 0, 1))
            if prevN is None:
                prevN = t.orthogonal().normalized()
            nrm = (prevN - t * prevN.dot(t)); nrm = nrm.normalized() if nrm.length > 1e-6 else t.orthogonal().normalized()
            prevN = nrm; bin_ = t.cross(nrm)
            r = nodes[k].r
            if ch[0] == 0 and p.z < 1.3:                  # root flare
                r *= 1 + 0.55 * max(0.0, 1 - p.z / 1.3) ** 2
            if j == 0 and k != 0: r = min(r, nodes[keep[min(1, len(keep) - 1)]].r)   # (start inside the parent)
            if j > 0: vlen += (p - nodes[keep[j - 1]].p).length
            ring = []
            for s in range(sides + 1):
                ang = 2 * math.pi * s / sides
                d = nrm * math.cos(ang) + bin_ * math.sin(ang)
                ring.append(len(V)); V.append(p + d * r); N.append(d.copy()); UV.append((urange * s / sides, vlen)); C.append([1.0, sway(nodes[k].s), 0.0])
            rings.append(ring)
        for ra, rb in zip(rings, rings[1:]):
            for s in range(sides):
                F.append((ra[s], ra[s + 1], rb[s + 1], rb[s])); leafF.append(False)

    # ---- leaves: a cluster card at each twig end (and a few along the thin twigs behind it)
    u0, v0 = QUAD[sp['quad']]
    centre = Vector((0, 0, sp['centre'])) if not conifer else Vector((0, 0, sp['H'] * 0.45))
    leader = set()
    if conifer:
        k = 0
        while True:
            leader.add(k); up = [c for c in nodes[k].kids if (nodes[c].p - nodes[k].p).z > 0.3]
            if not up: break
            k = up[0]
    tips = [i for i, nd in enumerate(nodes) if not nd.kids and i > 0 and i not in leader]
    thin = [i for i, nd in enumerate(nodes) if nd.kids and nd.r < (0.05 if not conifer else 0.04) and i > 0 and i not in leader]
    rng.shuffle(tips); rng.shuffle(thin)
    spots = (tips + thin)[:sp['cards']]
    for i in spots:
        nd = nodes[i]; par = nodes[nd.parent]
        twig = (nd.p - par.p); twig = twig.normalized() if twig.length > 1e-6 else Vector((0, 0, 1))
        out = (nd.p - centre); out = out.normalized() if out.length > 1e-6 else Vector((0, 0, 1))
        if conifer:   # flat sprays along the branch
            along = (twig + Vector((0, 0, -0.1))).normalized()
            side = along.cross(Vector((0, 0, 1))); side = side.normalized() if side.length > 1e-6 else Vector((1, 0, 0))
            side = (side + Vector((0, 0, rng.uniform(-0.25, 0.25)))).normalized()
        else:
            along = (twig * 0.55 + out * 0.45 + Vector((0, 0, 0.15))).normalized()
            side = along.cross(out); side = side.normalized() if side.length > 1e-6 else along.orthogonal().normalized()
            side = (Matrix.Rotation(rng.uniform(-0.9, 0.9), 3, along) @ side).normalized()
        size = sp['card'] * rng.uniform(0.8, 1.15)
        base = nd.p - along * size * 0.18
        flip = rng.random() < 0.5
        corners = [(-0.5, 0.0), (0.5, 0.0), (0.5, 1.0), (-0.5, 1.0)]
        normal_card = side.cross(along).normalized()
        vol = ((nd.p - centre + Vector((0, 0, 0.8)))).normalized() if (nd.p - centre).length > 1e-6 else Vector((0, 0, 1))
        idx = []
        for cx, cy in corners:
            p = base + side * (cx * size) + along * (cy * size)
            n = (vol * 0.78 + normal_card * (0.22 if normal_card.dot(vol) >= 0 else -0.22)).normalized()
            uu = (cx + 0.5) if not flip else (0.5 - cx)
            # the twig drawn in the atlas grows up from the bottom of its quarter: card base = quarter bottom
            idx.append(len(V)); V.append(p); N.append(n); UV.append((u0 + uu * 0.5, v0 + (1 - cy) * 0.5))
            C.append([1.0, min(1.0, sway(nd.s) + 0.12), 1.0])
        F.append(tuple(idx)); leafF.append(True)

    # ---- ambient occlusion, ray traced through the tree
    tree = bvhtree.BVHTree.FromPolygons(V, F, all_triangles=False, epsilon=0.0)
    dirs = []
    for k in range(22):                                   # a fixed spiral of directions over the sphere
        z = 1 - 2 * (k + 0.5) / 22; rr = math.sqrt(max(0.0, 1 - z * z)); a = k * 2.39996
        dirs.append(Vector((math.cos(a) * rr, math.sin(a) * rr, z)))
    for vi, (p, n) in enumerate(zip(V, N)):
        tot = 0.0; wsum = 0.0
        for d in dirs:
            c = d.dot(n)
            if c <= 0.05: continue
            T = 1.0; o = p + n * 0.04
            for hop in range(4):
                hit = tree.ray_cast(o, d, 6.0)
                if hit[0] is None: break
                if leafF[hit[2]]: T *= 0.55; o = hit[0] + d * 0.02
                else: T = 0.0; break
            if d.z < -0.15: T *= 0.6                      # the ground below
            tot += T * c; wsum += c
        ao = tot / wsum if wsum else 1.0
        C[vi][0] = 0.32 + 0.68 * ao

    # ---- into Blender
    me = bpy.data.meshes.new(sp['name'])
    me.from_pydata([tuple(v) for v in V], [], F)
    me.validate(clean_customdata=False)
    uvl = me.uv_layers.new(name='UVMap')
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for li, loop in enumerate(me.loops):
        uvl.data[li].uv = (UV[loop.vertex_index][0], 1 - UV[loop.vertex_index][1])   # (Blender's v runs up; glTF's down)
    for vi in range(len(V)): col.data[vi].color = (C[vi][0], C[vi][1], C[vi][2], sp.get('bark', 0.0))
    me.color_attributes.active_color = col
    for poly in me.polygons: poly.use_smooth = True
    me.normals_split_custom_set_from_vertices([tuple(n) for n in N])
    ob = bpy.data.objects.new(sp['name'], me)
    bpy.context.scene.collection.objects.link(ob)
    xs = [v.x for v in V]; ys = [v.y for v in V]
    ob['height'] = max(v.z for v in V); ob['crownRadius'] = max(max(xs) - min(xs), max(ys) - min(ys)) / 2
    ob['crownBase'] = sp['base']; ob['quad'] = sp['quad']
    bark = sum(1 for f in leafF if not f) * 2; leaves = sum(1 for f in leafF if f) * 2
    print(f"{sp['name']:8s} nodes {len(nodes):5d}  bark tris {bark:5d}  leaf cards {leaves // 2:4d}  verts {len(V):5d}  "
          f"height {ob['height']:.1f} m  crown radius {ob['crownRadius']:.1f} m")
    return ob


def preview(objs, outdir):
    """A quick Cycles render of each tree (bark brown, leaf cards green): to look the shapes over."""
    os.makedirs(outdir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 12
    sc.render.resolution_x = sc.render.resolution_y = 360
    sc.render.film_transparent = False
    world = bpy.data.worlds.new('w'); world.use_nodes = True; sc.world = world
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.74, 0.9, 1); world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5
    sun.rotation_euler = (0.7, 0.2, 0.6); sc.collection.objects.link(sun)
    m = bpy.data.materials.new('pv'); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'Col'
    sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(attr.outputs['Color'], sep.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs[6].default_value = (0.25, 0.17, 0.11, 1); mix.inputs[7].default_value = (0.2, 0.42, 0.12, 1)
    nt.links.new(sep.outputs['Blue'], mix.inputs[0])
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1
    nt.links.new(mix.outputs[2], mul.inputs[6]); nt.links.new(sep.outputs['Red'], mul.inputs[7])
    # (AO as grey into the multiply's B input)
    comb = nt.nodes.new('ShaderNodeCombineColor')
    for ch in range(3): nt.links.new(sep.outputs['Red'], comb.inputs[ch])
    nt.links.new(comb.outputs[0], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs['Base Color'])
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    for ob in objs:
        for o2 in objs: o2.hide_render = o2 is not ob
        ob.data.materials.clear(); ob.data.materials.append(m)
        h = ob['height']; d = max(h, ob['crownRadius'] * 2) * 1.25
        cam.location = (d * 0.64, -d * 0.77, h * 0.5); cam.rotation_euler = (math.radians(88), 0, math.radians(40))
        cam.data.lens = 32
        sc.render.filepath = os.path.join(outdir, ob.name + '.png')
        bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = [build(sp) for sp in SPECIES]
    if '--preview' in sys.argv:
        preview(objs, sys.argv[sys.argv.index('--preview') + 1])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    mat = bpy.data.materials.new('tree')
    for ob in objs:
        ob.hide_render = False; ob.data.materials.clear(); ob.data.materials.append(mat)
    import addon_utils
    addon_utils.enable('io_scene_gltf2', default_set=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_vertex_color='ACTIVE',
                              export_all_vertex_colors=False, export_materials='NONE', export_cameras=False, export_lights=False)
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')


main()

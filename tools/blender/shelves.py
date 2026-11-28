# Stocked shop shelving, modelled and rendered in Blender 4.3.2 (Cycles), for the shop interiors and shop windows.
#   blender -b -P tools/blender/shelves.py -- LABELDIR OUTDIR
# LABELDIR from labels.py. For each bay in shopstock.BAYS: a 1 m gondola (or chiller) bay, its shelves stocked in blocks
# of facings with their price tags on the shelf edge, rendered front-on (orthographic, 600 px a metre) to
# OUTDIR/<bay>.png. The bays' ends are uprights, so the renders tile side by side. Then the extras: a chest freezer from
# above, the counter's sweets, the tobacco gantry (shutters) and the newspaper stand.
import bpy, bmesh, math, os, sys, random
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shopstock import P, BAYS

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
LAB, OUT = argv[0], argv[1]
ONLY = argv[2].split(',') if len(argv) > 2 else None
os.makedirs(OUT, exist_ok=True)
PXM = 600
rnd = random.Random(11)

def hexc(h, a=1.0):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (a,)

# ---------------------------------------------------------------------------------------------------- materials
MATS = {}
def principled(name, col=(0.8, 0.8, 0.8, 1), rough=0.5, metal=0.0, trans=0.0, coat=0.0, emit=None, ior=1.45):
    key = (name, col, rough, metal, trans, coat, emit)
    if key in MATS: return MATS[key]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = col; b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    b.inputs['Transmission Weight'].default_value = trans; b.inputs['Coat Weight'].default_value = coat; b.inputs['IOR'].default_value = ior
    if emit: b.inputs['Emission Color'].default_value = emit; b.inputs['Emission Strength'].default_value = 6.0
    MATS[key] = m; return m

def labelmat(img, rough=0.5, metal=0.0, coat=0.0, repeat=False):
    key = ('lab', img, rough, metal, coat, repeat)
    if key in MATS: return MATS[key]
    m = bpy.data.materials.new(os.path.basename(img)); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(img, check_existing=True); t.extension = 'REPEAT' if repeat else 'EXTEND'
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal; b.inputs['Coat Weight'].default_value = coat
    MATS[key] = m; return m

def lab(pid): return os.path.join(LAB, pid + '.png')

# ---------------------------------------------------------------------------------------------------- geometry
def mesh_obj(name, verts, faces, uvs=None, mats=(), mat_idx=None, smooth=False):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces)
    if uvs is not None:
        uvl = me.uv_layers.new()
        k = 0
        for f, poly in zip(faces, me.polygons):
            for li, vi in zip(poly.loop_indices, f): uvl.data[li].uv = uvs[k] if isinstance(uvs[k], tuple) else uvs[k]; k += 1
    for m in mats: me.materials.append(m)
    if mat_idx is not None:
        for poly, mi in zip(me.polygons, mat_idx): poly.material_index = mi
    if smooth:
        for poly in me.polygons: poly.use_smooth = True
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob

def box(name, x0, x1, y0, y1, z0, z1, front=None, side=None, bevel=0.0, front_uv=((0, 0), (1, 0), (1, 1), (0, 1))):
    """An axis-aligned box; face 0 (y = y0) carries `front` with front_uv, the rest `side`."""
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 1, 2, 3), (5, 4, 7, 6), (4, 0, 3, 7), (1, 5, 6, 2), (3, 2, 6, 7), (4, 5, 1, 0)]
    uv = list(front_uv) + [(0.02, 0.02)] * 20
    mats = [front or side, side or front]
    ob = mesh_obj(name, v, f, uv, mats, [0, 1, 1, 1, 1, 1])
    if bevel > 0:
        m = ob.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = 2; m.limit_method = 'ANGLE'
    return ob

def lathe(name, prof, segs, cx, cy, z0, mat, cap=True):
    """A body of revolution about (cx, cy) from a profile [(r, z)], seam at the back."""
    v, f, uv = [], [], []
    for (r, z) in prof:
        for s in range(segs + 1):
            a = -math.pi / 2 + (s / segs - 0.5) * 2 * math.pi
            v.append((cx + r * math.cos(a), cy + r * math.sin(a) + r * 0, z0 + z))
    for i in range(len(prof) - 1):
        for s in range(segs):
            a0 = i * (segs + 1) + s; f.append((a0, a0 + 1, a0 + segs + 2, a0 + segs + 1))
            for (ss, ii) in ((s, i), (s + 1, i), (s + 1, i + 1), (s, i + 1)): uv.append((ss / segs, ii / (len(prof) - 1)))
    if cap:
        f.append(tuple(range(segs, -1, -1))[:segs]); uv += [(0.5, 0.0)] * segs
    return mesh_obj(name, v, f, uv, [mat], None, smooth=True)

def cylinder(name, r, h, cx, cy, z0, side, top=None, bottom=None, segs=28, r_top=None, v0=0.0, v1=1.0):
    """A cylinder (or a tapered tub with r_top) whose side UVs wrap once round (u) and up (v0..v1); the seam behind."""
    rt = r if r_top is None else r_top
    v, f, uv, mi = [], [], [], []
    for s in range(segs + 1):
        a = -math.pi / 2 + (s / segs - 0.5) * 2 * math.pi
        v += [(cx + r * math.cos(a), cy + r * math.sin(a), z0), (cx + rt * math.cos(a), cy + rt * math.sin(a), z0 + h)]
    for s in range(segs):
        a = 2 * s; f.append((a, a + 2, a + 3, a + 1)); uv += [(s / segs, v0), ((s + 1) / segs, v0), ((s + 1) / segs, v1), (s / segs, v1)]; mi.append(0)
    b0 = len(v)
    for s in range(segs):
        a = 2 * math.pi * s / segs; v.append((cx + rt * math.cos(a), cy + rt * math.sin(a), z0 + h))
    f.append(tuple(range(b0, b0 + segs))); uv += [(0.5, 0.5)] * segs; mi.append(1)
    b1 = len(v)
    for s in range(segs):
        a = -2 * math.pi * s / segs; v.append((cx + r * math.cos(a), cy + r * math.sin(a), z0))
    f.append(tuple(range(b1, b1 + segs))); uv += [(0.5, 0.5)] * segs; mi.append(2)
    return mesh_obj(name, v, f, uv, [side, top or side, bottom or top or side], mi, smooth=True)

METAL = lambda: principled('tinplate', (0.75, 0.75, 0.76, 1), 0.28, 1.0)
ALU = lambda: principled('alu', (0.82, 0.82, 0.84, 1), 0.25, 1.0)

def product(p, x, y, z, scale=1.0):
    """One facing of product p, its front-left-bottom at (x, y, z). Returns the width it took."""
    k, pid = p['kind'], p['id']
    w, h, d = p['w'] * scale, p['h'] * scale, p['d'] * scale
    bg = principled('bg_' + pid, hexc(p['bg']), 0.55)
    if k in ('box', 'carton', 'loaf', 'roll', 'cheese'):
        bev = {'loaf': 0.035, 'roll': 0.03}.get(k, 0.002)
        box(pid, x, x + w, y, y + d, z, z + h, labelmat(lab(pid), 0.45 if k != 'loaf' else 0.3, coat=0.4 if k in ('loaf', 'roll') else 0), bg, bev * scale)
        return w
    if k == 'bag':
        # a pillow: front and back sheets sealed round the edge, crimped flat top and bottom, puffed in the middle;
        # stood on the shelf leaning back a little
        nu, nv, ym = 10, 16, y + d / 2
        def puff(u, v):
            vv = (v - 0.08) / 0.84
            if vv <= 0 or vv >= 1: return 0.0
            return (1 - abs(2 * u - 1) ** 2.6) * (1 - abs(2 * vv - 1) ** 2.2)
        verts, faces, uvs, mi = [], [], [], []
        for side in (0, 1):
            for j in range(nv + 1):
                for i in range(nu + 1):
                    u, v = i / nu, j / nv
                    pinch = 0.03 * w * math.sin(math.pi * v) * (1 if side == 0 else 1)
                    xx = x + u * w + (pinch if u < 0.5 else -pinch) * (1 - abs(2 * u - 1))
                    yy = ym + (-1 if side == 0 else 1) * puff(u, v) * d / 2
                    verts.append((xx, yy, z + v * h))
        for side in (0, 1):
            base = side * (nu + 1) * (nv + 1)
            for j in range(nv):
                for i in range(nu):
                    a0 = base + j * (nu + 1) + i
                    f = (a0, a0 + 1, a0 + nu + 2, a0 + nu + 1) if side == 0 else (a0, a0 + nu + 1, a0 + nu + 2, a0 + 1)
                    faces.append(f); mi.append(side)
                    for (ii, jj) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)) if side == 0 else ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)):
                        uvs.append((ii / nu, jj / nv))
        ob = mesh_obj(pid, verts, faces, uvs, [labelmat(lab(pid), 0.22, 0.15, 0.6), principled('foil_' + pid, hexc(p['bg']), 0.25, 0.2)], mi, smooth=True)
        ob.rotation_euler = (math.radians(-7), 0, 0); ob.location = (0, (z) * math.sin(math.radians(7)) + 0.01, 0)
        return w
    if k == 'pack':   # biscuit rolls on their sides, along x, stacked two high
        r, L = h / 2, d
        for lay in range(2):
            ob = cylinder(pid, r, L, 0, 0, 0, labelmat(lab(pid), 0.35, coat=0.5), bg, bg, segs=24)
            ob.rotation_euler = (0, math.pi / 2, 0); ob.location = (x, y + r, z + r + lay * 2 * r * 0.97)
        return L
    if k in ('can', 'tin', 'tube', 'tub'):
        r = w / 2
        if k == 'can': cylinder(pid, r, h, x + r, y + r, z, labelmat(lab(pid), 0.3, 0.55), ALU(), ALU(), segs=28)
        elif k == 'tin': cylinder(pid, r, h, x + r, y + r, z, labelmat(lab(pid), 0.6), METAL(), METAL(), segs=28)
        elif k == 'tube': cylinder(pid, r, h, x + r, y + r, z, labelmat(lab(pid), 0.35, coat=0.4), principled('lid_' + pid, hexc(p['accent']), 0.4), METAL(), segs=28)
        else: cylinder(pid, r * 0.86, h, x + r, y + r, z, labelmat(lab(pid), 0.4, coat=0.3), principled('lid_' + pid, hexc('#ffffff'), 0.3), bg, segs=28, r_top=r)
        return w
    if k == 'beercan':   # a 4-pack: two cans showing, two behind
        r = w / 4
        for i in range(2):
            for j in range(2): cylinder(pid, r, h, x + r + i * 2 * r, y + r + j * 2 * r, z, labelmat(lab(pid), 0.3, 0.55), ALU(), ALU(), segs=24)
        return w
    if k in ('bottle2', 'bottle5', 'water', 'wine', 'jar'):
        r = w / 2
        prof = {'bottle2': [(0.86, 0), (1, 0.03), (1, 0.62), (0.95, 0.7), (0.62, 0.82), (0.3, 0.92), (0.28, 0.95)],
                'bottle5': [(0.9, 0), (1, 0.04), (1, 0.6), (0.9, 0.7), (0.45, 0.85), (0.4, 0.93)],
                'water':   [(0.9, 0), (1, 0.04), (1, 0.7), (0.85, 0.78), (0.42, 0.88), (0.4, 0.93)],
                'wine':    [(0.97, 0), (1, 0.02), (1, 0.6), (0.9, 0.68), (0.42, 0.78), (0.38, 0.97)],
                'jar':     [(0.95, 0), (1, 0.05), (1, 0.85), (0.85, 0.92), (0.85, 0.95)]}[k]
        liquid = p.get('liquid') or '#cccccc'
        glass = principled('liq_' + pid, hexc(liquid), 0.06, 0.0, 0.7 if k != 'wine' else 0.35, ior=1.35)
        lathe(pid, [(r * a, h * b) for a, b in prof], 28, x + r, y + r, z, glass)
        lo, hi = {'bottle2': (0.18, 0.54), 'bottle5': (0.18, 0.6), 'water': (0.22, 0.58), 'wine': (0.12, 0.44), 'jar': (0.2, 0.7)}[k]
        cylinder(pid + '_label', r * 1.012, h * (hi - lo), x + r, y + r, z + h * lo, labelmat(lab(pid), 0.4, coat=0.3), glass, glass, segs=28)
        top = prof[-1][1] * h; cr = prof[-1][0] * r * 1.12
        if k != 'jar': cylinder(pid + '_cap', cr, 0.022 if k != 'wine' else h * 0.12, x + r, y + r, z + top - (0.004 if k != 'wine' else h * 0.12), principled('cap_' + pid, hexc(p.get('cap') or '#ffffff'), 0.35, 0.3 if k == 'wine' else 0))
        else: cylinder(pid + '_lid', r * 0.9, 0.02, x + r, y + r, z + top, principled('lid_' + pid, hexc(p.get('cap') or '#c9a227'), 0.3, 1.0))
        return w
    if k == 'milk':   # a squarish HDPE bottle, its coloured cap
        hdpe = principled('hdpe', (0.86, 0.86, 0.84, 1), 0.45, 0.0, 0.12)
        box(pid, x, x + w, y, y + d, z, z + h * 0.78, labelmat(lab(pid), 0.4, coat=0.2), hdpe, 0.012,
            front_uv=((0.12, 0.1), (0.88, 0.1), (0.88, 0.9), (0.12, 0.9)))
        lathe(pid + '_neck', [(w * 0.45, 0), (w * 0.3, h * 0.12), (w * 0.17, h * 0.17), (w * 0.17, h * 0.2)], 20, x + w / 2, y + d / 2, z + h * 0.78, hdpe)
        cylinder(pid + '_cap', w * 0.19, h * 0.05, x + w / 2, y + d / 2, z + h * 0.97, principled('cap_' + pid, hexc(p.get('cap') or '#1e8449'), 0.35))
        return w
    if k == 'sandwich':   # a wedge: the triangle faces you
        v = [(x, y, z), (x + w, y, z), (x, y, z + h), (x, y + d, z), (x + w, y + d, z), (x, y + d, z + h)]
        f = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (0, 2, 5, 3), (1, 4, 5, 2)]
        uv = [(0, 0), (1, 0), (0, 1)] + [(0.02, 0.02)] * 15
        mesh_obj(pid, v, f, uv, [labelmat(lab(pid), 0.3, coat=0.6), principled('card', (0.9, 0.9, 0.88, 1), 0.6)], [0, 1, 1, 1, 1])
        return w
    if k == 'bar':   # a counter tray of bars
        box(pid + '_tray', x, x + w * 2, y, y + 0.15, z, z + 0.05, labelmat(lab(pid), 0.4, repeat=True), principled('tray', hexc(p['bg']), 0.6),
            front_uv=((0, 0), (2, 0), (2, 1), (0, 1)))
        for i in range(2):
            for j in range(4):
                bb = box(pid + '_b', x + 0.005 + i * w, x + w - 0.005 + i * w, y + 0.01 + j * 0.035, y + 0.04 + j * 0.035, z + 0.05, z + 0.05 + h,
                         labelmat(lab(pid), 0.35, coat=0.4), principled('bar_' + pid, hexc(p['bg']), 0.4))
                bb.rotation_euler = (-0.5, 0, 0)
        return w * 2
    return w

# ---------------------------------------------------------------------------------------------------- the bay
def scene_setup(width, height, chiller=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 40; sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6; sc.cycles.transmission_bounces = 6
    sc.render.resolution_x, sc.render.resolution_y = int(width * PXM), int(height * PXM)
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.exposure = 0.0
    w = bpy.data.worlds.new('w'); w.use_nodes = True; sc.world = w
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.76, 0.78, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.22
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = max(width, height); cam.location = (width / 2, -4, height / 2); cam.rotation_euler = (math.radians(90), 0, 0)
    cam.data.clip_end = 20
    for (loc, size, power, rot) in [((width / 2, -1.6, height + 0.9), (2.5, 1.2), 40 if not chiller else 16, (math.radians(38), 0, 0)),
                                     ((width / 2, -3.0, height * 0.45), (3.0, 2.2), 28, (math.radians(90), 0, 0))]:
        L = bpy.data.lights.new('area', 'AREA'); L.shape = 'RECTANGLE'; L.size, L.size_y = size; L.energy = power; L.color = (1.0, 0.98, 0.95)
        o = bpy.data.objects.new('area', L); o.location = loc; o.rotation_euler = rot; sc.collection.objects.link(o)

def bay(name, height, shelves, chiller=False):
    bpy.ops.wm.read_factory_settings(use_empty=True); MATS.clear()
    W = 1.0
    scene_setup(W, height, chiller)
    frame = principled('frame', (0.05, 0.05, 0.055, 1) if chiller else (0.72, 0.73, 0.74, 1), 0.45, 0.4)
    boardm = principled('board', (0.06, 0.06, 0.065, 1) if chiller else (0.85, 0.86, 0.86, 1), 0.4, 0.3)
    backm = principled('back', (0.03, 0.03, 0.035, 1) if chiller else (0.55, 0.56, 0.57, 1), 0.7)
    strip = principled('strip', (0.92, 0.92, 0.9, 1), 0.4)
    box('back', -0.02, W + 0.02, 0.46, 0.5, 0, height, backm, backm)
    box('plinth', 0, W, 0.0, 0.46, 0, 0.1, frame, frame)
    for u in (0.0, W):
        box('upright', u - 0.022, u + 0.022, 0.0, 0.48, 0, height, frame, frame)
    tops = [s for s, _ in shelves] + [height]
    for si, (s, ids) in enumerate(shelves):
        box('shelf', 0.022, W - 0.022, 0.0, 0.45, s - 0.022, s, boardm, boardm)
        box('strip', 0.022, W - 0.022, -0.012, 0.0, s - 0.05, s - 0.004, strip, strip)
        if chiller:   # the LED strip under the shelf above lights the row
            box('led', 0.03, W - 0.03, 0.02, 0.035, tops[si + 1] - 0.03, tops[si + 1] - 0.024, principled('led', (1, 1, 1, 1), 0.3, emit=(0.95, 0.97, 1.0, 1)), None)
        room = tops[si + 1] - s - 0.03
        x, k = 0.035, 0
        while True:
            p = P[ids[k % len(ids)]]; k += 1
            fw = (p['d'] if p['kind'] == 'pack' else p['w'] * (2 if p['kind'] == 'bar' else 1))
            hh = p['h'] if p['kind'] not in ('pack',) else p['h']
            sc = min(1.0, room / max(hh, 0.01))
            n = rnd.choice((2, 3, 3, 4)) if fw < 0.15 else rnd.choice((1, 2, 2))
            if x + fw * sc > W - 0.035: break
            tx = x
            for q in range(n):
                if x + fw * sc > W - 0.035: break
                if rnd.random() < 0.03: x += fw * sc + 0.006; continue   # one sold
                jx = rnd.uniform(-0.002, 0.002)
                took = product(p, x + jx, 0.008 + rnd.uniform(0, 0.012), s, sc)
                x += took + 0.006
            # its price tag on the shelf edge, under the start of the block
            tg = labelmat(os.path.join(LAB, 'tag_' + p['id'] + '.png'), 0.4)
            box('tag', tx + 0.004, tx + 0.084, -0.016, -0.012, s - 0.047, s - 0.008, tg, strip)
            x += 0.01
    bpy.context.scene.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', name)

# ---------------------------------------------------------------------------------------------------- extras
def lidbox(name, x0, x1, y0, y1, z0, z1, top, side):
    """A box whose top face carries `top` (UV 0..1, the label's top towards +y), the rest `side`."""
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(4, 5, 6, 7), (0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    uv = [(0, 0), (1, 0), (1, 1), (0, 1)] + [(0.02, 0.02)] * 20
    ob = mesh_obj(name, v, f, uv, [top, side], [0, 1, 1, 1, 1, 1])
    m = ob.modifiers.new('bev', 'BEVEL'); m.width = 0.006; m.segments = 2; m.limit_method = 'ANGLE'
    return ob

def freezer():
    bpy.ops.wm.read_factory_settings(use_empty=True); MATS.clear()
    W, D = 1.0, 0.6
    sc = bpy.context.scene; scene_setup(W, D)
    cam = sc.camera; cam.location = (W / 2, D / 2, 3); cam.rotation_euler = (0, 0, 0)
    for o in [o for o in sc.objects if o.type == 'LIGHT']: o.location = (W / 2, D / 2 - 0.6, 2.2); o.rotation_euler = (math.radians(15), 0, 0)
    box('tub', -0.05, W + 0.05, -0.05, D + 0.05, -0.3, 0.0, principled('freezer_in', (0.9, 0.92, 0.95, 1), 0.3), None)
    # ice-cream tubs, bags of peas and oven chips lying flat, a little higgledy-piggledy, labels up
    y, row = 0.015, 0
    while y < D - 0.08:
        x = 0.015
        kinds = [['icecream', 'icecream', 'peas'], ['chips', 'peas'], ['icecream', 'chips', 'icecream']][row % 3]
        rh = 0
        k = 0
        while x < W - 0.06:
            p = P[kinds[k % len(kinds)]]; k += 1
            if p['kind'] == 'bag': bw, bd, bh = p['w'], p['h'], p['d'] * 0.6
            else: bw, bd, bh = p['w'], p['d'], p['h']
            if x + bw > W - 0.01: break
            ob = lidbox(p['id'], x, x + bw, y, y + bd, 0, bh, labelmat(lab(p['id']), 0.3, coat=0.4), principled('fs_' + p['id'], hexc(p['bg']), 0.4))
            ob.rotation_euler = (0, 0, rnd.uniform(-0.06, 0.06))
            x += bw + rnd.uniform(0.004, 0.02); rh = max(rh, bd)
        y += rh + 0.012; row += 1
    sc.render.filepath = os.path.join(OUT, 'freezer.png'); bpy.ops.render.render(write_still=True); print('rendered freezer')

def gantry():
    bpy.ops.wm.read_factory_settings(use_empty=True); MATS.clear()
    W, H = 1.0, 2.2
    scene_setup(W, H)
    grey = principled('shutter', (0.42, 0.43, 0.45, 1), 0.35, 0.6); dark = principled('gframe', (0.08, 0.08, 0.09, 1), 0.5)
    box('back', -0.02, W + 0.02, 0.2, 0.25, 0, H, dark, dark)
    for u in (0.0, W): box('up', u - 0.02, u + 0.02, 0.0, 0.25, 0, H, dark, dark)
    # the shutters, in rows, each with its small number plate
    z = 0.9
    for row in range(4):
        for col in range(3):
            x0 = 0.03 + col * 0.315
            box('sh', x0, x0 + 0.3, 0.0, 0.02, z, z + 0.2, grey, grey, 0.004)
            box('num', x0 + 0.12, x0 + 0.18, -0.004, 0.0, z + 0.07, z + 0.11, principled('plate', (0.92, 0.92, 0.9, 1), 0.4), None)
        z += 0.215
    # spirits above, behind glass; the counter's drawers below
    for i in range(7):
        p = P[['wine_red', 'wine_white', 'wine_rose'][i % 3]]
        product(p, 0.04 + i * 0.135, 0.06, 1.78, 0.95)
    box('shelf', 0.02, W - 0.02, 0.0, 0.22, 1.76, 1.78, dark, dark)
    for k in range(3): box('drawer', 0.03, W - 0.03, 0.0, 0.02, 0.05 + k * 0.27, 0.3 + k * 0.27, principled('drawer', (0.7, 0.7, 0.72, 1), 0.5), None, 0.004)
    sc = bpy.context.scene; sc.render.filepath = os.path.join(OUT, 'gantry.png'); bpy.ops.render.render(write_still=True); print('rendered gantry')

def sweets():
    bpy.ops.wm.read_factory_settings(use_empty=True); MATS.clear()
    W, H = 1.0, 0.7
    scene_setup(W, H)
    wood = principled('counterwood', (0.35, 0.25, 0.18, 1), 0.5)
    box('back', -0.02, W + 0.02, 0.3, 0.35, 0, H, wood, wood)
    for s in (0.0, 0.23, 0.46):
        box('step', 0, W, 0.0, 0.3, s - 0.02, s, principled('step', (0.88, 0.88, 0.86, 1), 0.4), None)
        x = 0.02
        while x < W - 0.24:
            p = P[rnd.choice(['chocbar', 'chocbar2', 'chocbar3'])]
            x += product(p, x, 0.01, s, 1.0) + 0.01
    sc = bpy.context.scene; sc.render.filepath = os.path.join(OUT, 'sweets.png'); bpy.ops.render.render(write_still=True); print('rendered sweets')

def papers():
    bpy.ops.wm.read_factory_settings(use_empty=True); MATS.clear()
    W, H = 1.0, 1.0
    scene_setup(W, H)
    rack = principled('rack', (0.15, 0.15, 0.16, 1), 0.4, 0.6)
    box('back', -0.02, W + 0.02, 0.5, 0.55, 0, H, rack, rack)
    for row, z in enumerate((0.05, 0.38, 0.7)):
        box('ledge', 0, W, -0.02, 0.3, z - 0.02, z, rack, rack)
        for i in range(3):
            n = (row * 3 + i) % 6
            ob = box('paper', 0.02 + i * 0.33, 0.31 + i * 0.33, 0.0, 0.01, 0, 0.4, labelmat(os.path.join(LAB, f'paper_{n}.png'), 0.8), principled('newsprint', (0.85, 0.84, 0.8, 1), 0.9))
            ob.rotation_euler = (math.radians(-18), 0, 0); ob.location = (0, 0.12, z + 0.005)
    sc = bpy.context.scene; sc.render.filepath = os.path.join(OUT, 'papers.png'); bpy.ops.render.render(write_still=True); print('rendered papers')

for name, (height, shelves) in BAYS.items():
    if ONLY and name not in ONLY: continue
    bay(name, height, shelves, chiller=name in ('dairy', 'fridge'))
for fn in (freezer, gantry, sweets, papers):
    if ONLY and fn.__name__ not in ONLY: continue
    fn()

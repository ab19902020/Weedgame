# The far wall of a cafe, a takeaway and a pub as you see it through their windows from the street, modelled and
# rendered in Blender 4.3.2 (Cycles) for the shop-window shader (materials.js buildingMaterial): 4 m of wall, 2.4 m
# high, front-on (orthographic), with what stands in front of it: the counter and its staff, tables and chairs, the bar.
#   blender -b -P tools/blender/eateries.py -- LABELDIR OUTDIR [cafe,takeaway,pub]
# LABELDIR from eaterylabels.py (menu boards, chalkboard, pump clips, pictures). Writes OUTDIR/<scene>.png.
import bpy, math, os, sys, random

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
LAB, OUT = argv[0], argv[1]
ONLY = argv[2].split(',') if len(argv) > 2 else None
os.makedirs(OUT, exist_ok=True)
W, H, PX = 4.0, 2.4, 300           # metres of wall, pixels a metre
rnd = random.Random(5)

def lin(c):
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)
def hexc(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    return lin([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]) + (1.0,)

# ---------------------------------------------------------------------------------------------------- materials
MATS = {}
def mat(name, col=(0.8, 0.8, 0.8, 1), rough=0.5, metal=0.0, emit=None, strength=4.0, trans=0.0, coat=0.0):
    key = (name, col, rough, metal, emit, strength, trans)
    if key in MATS: return MATS[key]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = col; b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    b.inputs['Transmission Weight'].default_value = trans; b.inputs['Coat Weight'].default_value = coat
    if emit: b.inputs['Emission Color'].default_value = emit; b.inputs['Emission Strength'].default_value = strength
    MATS[key] = m; return m

def imgmat(path, emit=0.0, rough=0.5):
    key = ('img', path, emit)
    if key in MATS: return MATS[key]
    m = bpy.data.materials.new(os.path.basename(path)); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(path, check_existing=True); t.extension = 'EXTEND'
    nt.links.new(t.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = rough
    if emit:
        nt.links.new(t.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = emit
    MATS[key] = m; return m

def brickmat(name, c1, c2, mortar, scale, bw=0.5, rowh=0.25, msize=0.012, rough=0.8, wall=True):
    """Brick or tile: Blender's brick texture in object space (metres): on a wall (x across, z up) or a floor."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping')
    if wall: mp.inputs['Rotation'].default_value = (math.radians(90), 0, 0)   # the wall's x/z plane onto the texture's x/y
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.inputs['Color1'].default_value = c1; br.inputs['Color2'].default_value = c2; br.inputs['Mortar'].default_value = mortar
    br.inputs['Scale'].default_value = scale; br.inputs['Brick Width'].default_value = bw; br.inputs['Row Height'].default_value = rowh
    br.inputs['Mortar Size'].default_value = msize; br.offset = 0.5
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], br.inputs['Vector'])
    nt.links.new(br.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = rough
    return m

def woodmat(name, c1, c2, rough=0.45, coat=0.3, scale=6.0, grain='Z'):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); wv = nt.nodes.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = grain
    wv.inputs['Scale'].default_value = scale; wv.inputs['Distortion'].default_value = 6; wv.inputs['Detail'].default_value = 3
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = c1; ramp.color_ramp.elements[1].color = c2
    nt.links.new(tc.outputs['Object'], wv.inputs['Vector']); nt.links.new(wv.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough; b.inputs['Coat Weight'].default_value = coat
    return m

# ---------------------------------------------------------------------------------------------------- geometry
def mesh(name, verts, faces, uvs=None, mats=(), idx=None, smooth=False):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces)
    if uvs is not None:
        uvl = me.uv_layers.new(); k = 0
        for poly in me.polygons:
            for li in poly.loop_indices: uvl.data[li].uv = uvs[k]; k += 1
    for m in mats: me.materials.append(m)
    if idx is not None:
        for poly, i in zip(me.polygons, idx): poly.material_index = i
    if smooth:
        for poly in me.polygons: poly.use_smooth = True
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob

def box(x0, x1, y0, y1, z0, z1, m, front=None, bevel=0.0):
    """An axis-aligned box; its front face (towards the camera, y = y0) can carry another material, mapped 0..1."""
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 1, 2, 3), (5, 4, 7, 6), (4, 0, 3, 7), (1, 5, 6, 2), (3, 2, 6, 7), (4, 5, 1, 0)]
    uv = [(0, 0), (1, 0), (1, 1), (0, 1)] + [(0.01, 0.01)] * 20
    ob = mesh('box', v, f, uv, [front or m, m], [0, 1, 1, 1, 1, 1])
    if bevel:
        md = ob.modifiers.new('bev', 'BEVEL'); md.width = bevel; md.segments = 2; md.limit_method = 'ANGLE'
    return ob

def lathe(prof, cx, cy, z0, m, segs=20):
    """A body of revolution from a profile [(r, z)], its origin at the foot of its axis (cx, cy, z0)."""
    v, f = [], []
    for (r, z) in prof:
        for s in range(segs): a = 2 * math.pi * s / segs; v.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(len(prof) - 1):
        for s in range(segs): a = i * segs + s; b = i * segs + (s + 1) % segs; f.append((a, b, b + segs, a + segs))
    f.append(tuple(range(len(prof) * segs - 1, (len(prof) - 1) * segs - 1, -1)))
    ob = mesh('lathe', v, f, None, [m], None, True); ob.location = (cx, cy, z0); return ob

def cyl(cx, cy, z0, h, r, m, rt=None, segs=24):
    return lathe([(0.0001, 0), (r, 0), (rt if rt is not None else r, h), (0.0001, h)], cx, cy, z0, m, segs)

def sphere(cx, cy, cz, r, m, sz=1.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=r, location=(cx, cy, cz))
    ob = bpy.context.active_object; ob.scale = (1, 1, sz); ob.data.materials.append(m)
    for p in ob.data.polygons: p.use_smooth = True
    return ob

SKIN = ['#e9c4a8', '#d8a888', '#b98a6a', '#8d5e44', '#6a4532', '#f1d2bc']
HAIR = ['#2a1d16', '#4a3222', '#7a5a3a', '#1a1a1a', '#b08a5a', '#8a8a86']
def person(cx, cy, z0, top, skin=None, hair=None, cap=None, apron=None, h=1.72, turn=0.0):
    """Someone stood behind a counter: legs, a torso in their uniform, arms at their sides, head, hair (or a cap)."""
    s = h / 1.72
    skin = mat('skin' + (skin or rnd.choice(SKIN)), hexc(skin or rnd.choice(SKIN)), 0.55)
    hairm = mat('hair' + (hair or rnd.choice(HAIR)), hexc(hair or rnd.choice(HAIR)), 0.7)
    topm = mat('top' + top, hexc(top), 0.75)
    legs = mat('legs', hexc('#22252b'), 0.8)
    for dx in (-0.09, 0.09): cyl(cx + dx * s, cy, z0, 0.86 * s, 0.075 * s, legs, 0.062 * s)
    lathe([(0.0001, 0), (0.17, 0), (0.19, 0.18), (0.2, 0.42), (0.22, 0.52), (0.12, 0.6), (0.0001, 0.62)], cx, cy, z0 + 0.84 * s, topm, 24).scale = (1, 0.62, 1)
    if apron: box(cx - 0.17 * s, cx + 0.17 * s, cy - 0.13 * s, cy - 0.12 * s, z0 + 0.5 * s, z0 + 1.22 * s, mat('apron' + apron, hexc(apron), 0.8))
    for sg in (-1, 1):   # arms hanging from the shoulders, a little out from the sides; hands
        a = cyl(cx + sg * 0.215 * s, cy, z0 + 1.4 * s, 0.58 * s, 0.05 * s, topm, 0.04 * s); a.rotation_euler = (0, math.radians(180 - sg * 7), 0)
        sphere(cx + sg * 0.285 * s, cy, z0 + 0.8 * s, 0.04 * s, skin, 1.3)
        sphere(cx + sg * 0.2 * s, cy, z0 + 1.38 * s, 0.07 * s, topm)   # the shoulder
    cyl(cx, cy, z0 + 1.44 * s, 0.1 * s, 0.055 * s, skin)
    sphere(cx, cy, z0 + 1.62 * s, 0.105 * s, skin, 1.18)
    if cap:
        c = mat('cap' + cap, hexc(cap), 0.6)
        sphere(cx, cy + 0.005, z0 + 1.68 * s, 0.112 * s, c, 0.62)
        box(cx - 0.09 * s, cx + 0.09 * s, cy - 0.2 * s, cy - 0.06 * s, z0 + 1.66 * s, z0 + 1.675 * s, c)
    else:
        sphere(cx, cy + 0.02, z0 + 1.66 * s, 0.112 * s, hairm, 0.85)

def bottle(cx, cy, z0, h, r, m, cap=None):
    prof = [(0.0001, 0), (r, 0), (r, h * 0.62), (r * 0.42, h * 0.8), (r * 0.3, h * 0.84), (r * 0.3, h), (0.0001, h)]
    lathe(prof, cx, cy, z0, m, 16)
    if cap: cyl(cx, cy, z0 + h * 0.97, h * 0.05, r * 0.33, cap, segs=12)

def chair(cx, cy, col, seat=0.45, back=True, wood=None):
    m = wood or mat('chair' + col, hexc(col), 0.5)
    leg = mat('chairleg', hexc('#1e1e20'), 0.4, 0.6) if wood is None else wood
    for dx in (-0.18, 0.18):
        for dy in (-0.18, 0.18): cyl(cx + dx, cy + dy, 0, seat, 0.016, leg, segs=8)
    box(cx - 0.21, cx + 0.21, cy - 0.21, cy + 0.21, seat, seat + 0.04, m, bevel=0.01)
    if back: box(cx - 0.21, cx + 0.21, cy + 0.17, cy + 0.21, seat + 0.04, seat + 0.46, m, bevel=0.01)

def table(cx, cy, top, w=0.7, d=0.7, h=0.74, round_=False):
    base = mat('tablebase', hexc('#1c1c1e'), 0.35, 0.7)
    cyl(cx, cy, 0, h - 0.03, 0.035, base, segs=12); cyl(cx, cy, 0, 0.03, 0.24, base, segs=20)
    if round_: cyl(cx, cy, h - 0.03, 0.03, w / 2, top, segs=32)
    else: box(cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, h - 0.03, h, top, bevel=0.006)

# ---------------------------------------------------------------------------------------------------- the scene
def setup(warm=True):
    bpy.ops.wm.read_factory_settings(use_empty=True); MATS.clear()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 48; sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = int(W * PX), int(H * PX)
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w'); w.use_nodes = True; sc.world = w
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.76, 0.7, 1) if warm else (0.75, 0.77, 0.8, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.25
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    # (looking a little down, as you do from the pavement: the counter top and the tables show)
    tilt = math.radians(8)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = W; cam.rotation_euler = (math.radians(90) - tilt, 0, 0); cam.data.clip_end = 40
    cam.location = (W / 2, 3.2 - 9 * math.cos(tilt), H / 2 + 9 * math.sin(tilt))
    col = (1.0, 0.86, 0.68) if warm else (1.0, 0.98, 0.95)
    for (loc, size, power) in [((W / 2, -1.2, H + 0.6), (W + 1, 2.0), 260), ((W / 2, -4.5, H * 0.55), (W + 1, 2.4), 150)]:
        L = bpy.data.lights.new('area', 'AREA'); L.shape = 'RECTANGLE'; L.size, L.size_y = size; L.energy = power; L.color = col
        o = bpy.data.objects.new('area', L); o.location = loc; o.rotation_euler = (math.radians(30 if loc[2] > H else 90), 0, 0); sc.collection.objects.link(o)
    return sc

def render(sc, name):
    sc.render.filepath = os.path.join(OUT, name + '.png'); bpy.ops.render.render(write_still=True); print('rendered', name)

def floor(m):
    box(-1, W + 1, -3, 4, -0.05, 0.0, m)

def pendant(cx, cy, z, shade, bulb=(1.0, 0.75, 0.45, 1)):
    cyl(cx, cy, z + 0.25, H + 0.5 - z, 0.004, mat('flex', hexc('#111111'), 0.5), segs=6)
    cyl(cx, cy, z, 0.25, 0.17, shade, 0.05, segs=24)
    sphere(cx, cy, z + 0.02, 0.05, mat('bulb', bulb, 0.3, emit=bulb, strength=30))

# ---- a takeaway (burgers, chicken): tiled wall, the kitchen's steel behind a long counter, backlit menus over it
def takeaway():
    sc = setup(warm=False)
    floor(brickmat('floortile', hexc('#8f8c88'), hexc('#7d7a76'), hexc('#5b5955'), 3.2, 0.5, 0.5, 0.01, 0.35, wall=False))
    box(-1, W + 1, 3.2, 3.3, 0, H + 0.2, brickmat('walltile', hexc('#f2f1ee'), hexc('#e7e6e2'), hexc('#bdbcb8'), 6.6, 0.5, 0.5, 0.008, 0.25))
    box(-1, W + 1, 3.15, 3.2, 1.55, H + 0.2, mat('upper', hexc('#2b2b2e'), 0.6))
    steel = mat('steel', hexc('#c9cccf'), 0.3, 1.0); dark = mat('kdark', hexc('#3a3c40'), 0.5, 0.5)
    # the kitchen along the back: fryers, the grill, the bagging station under heat lamps
    for k, x in enumerate([0.1, 0.9, 1.7, 2.5]):
        box(x, x + 0.75, 2.5, 3.1, 0, 0.9, steel, bevel=0.005)
        box(x + 0.05, x + 0.7, 2.48, 2.5, 0.12, 0.8, dark if k % 2 else steel)
        box(x + 0.05, x + 0.7, 2.6, 3.0, 0.9, 1.15 if k == 1 else 0.98, dark)
    box(0.1, 3.25, 2.8, 3.1, 1.35, 1.42, steel);
    for x in (0.4, 1.2, 2.0, 2.8): box(x, x + 0.35, 2.82, 3.05, 1.3, 1.35, mat('heatlamp', (1, 0.45, 0.15, 1), 0.4, emit=(1, 0.4, 0.12, 1), strength=6))
    box(3.35, 3.95, 2.6, 3.1, 0, 1.0, steel, bevel=0.005)   # the drinks fountain
    box(3.4, 3.9, 2.65, 3.0, 1.0, 1.6, mat('fountain', hexc('#1d1d20'), 0.35, 0.4))
    for k in range(4): box(3.45 + k * 0.12, 3.53 + k * 0.12, 2.62, 2.66, 1.25, 1.5, mat('nozzle' + str(k), hexc(['#c8102e', '#ef8a1e', '#2b8a3e', '#1f5fae'][k]), 0.4, emit=hexc(['#c8102e', '#ef8a1e', '#2b8a3e', '#1f5fae'][k]), strength=1.5))
    # the menus: four backlit boards across the top
    for k in range(4):
        x = 0.08 + k * 0.98
        box(x - 0.02, x + 0.94, 3.08, 3.12, 1.72, 2.32, mat('mframe', hexc('#141414'), 0.4, 0.5))
        box(x, x + 0.92, 3.06, 3.08, 1.74, 2.3, mat('mback', hexc('#141414'), 0.5), front=imgmat(os.path.join(LAB, f'menu_{k}.png'), emit=2.2))
    # staff behind the counter
    person(0.8, 2.1, 0, '#2a2a2e', cap='#c8102e'); person(2.2, 2.05, 0, '#2a2a2e', cap='#c8102e', h=1.66); person(3.2, 2.6, 0, '#c8102e', cap='#2a2a2e', h=1.78)
    # the counter, its tills, trays and a stack of cups
    front = mat('cfront', hexc('#c8102e'), 0.45); band = mat('cband', hexc('#f2c230'), 0.4)
    box(0.15, 3.9, 1.55, 2.0, 0, 1.0, front, bevel=0.01)
    box(0.15, 3.9, 1.54, 1.56, 0.1, 0.18, band)
    box(0.1, 3.95, 1.5, 2.02, 1.0, 1.06, steel, bevel=0.006)
    for x in (0.7, 1.7, 2.7):
        box(x, x + 0.34, 1.58, 1.86, 1.06, 1.1, mat('tillbase', hexc('#121212'), 0.4))
        s = box(x + 0.03, x + 0.31, 1.7, 1.72, 1.12, 1.36, mat('tillscreen', (0.7, 0.85, 1.0, 1), 0.2, emit=(0.6, 0.8, 1.0, 1), strength=2.5)); s.rotation_euler = (math.radians(-12), 0, 0)
    for k in range(5): cyl(3.55, 1.75, 1.06 + k * 0.03, 0.12, 0.045, mat('cup', hexc('#f4f4f2'), 0.5), 0.05, segs=16)
    box(1.15, 1.55, 1.6, 1.9, 1.06, 1.08, mat('tray', hexc('#5a3a2a'), 0.5))
    # the dining room in front: tables and chairs, someone eating
    top = mat('tabletop', hexc('#e8e4dc'), 0.35)
    for (x, c) in [(0.55, '#c8102e'), (1.75, '#2a2a2e'), (3.0, '#c8102e')]:
        table(x, 0.45, top, 0.7, 0.62)
        chair(x - 0.48, 0.45, c, back=True); chair(x + 0.48, 0.45, c, back=True)
    person(3.48, 0.62, -0.34, '#3b5b8a', h=1.66)   # sat at a table
    render(sc, 'takeaway')

# ---- a cafe: brick and timber, a chalkboard and shelves of cups behind the counter, the cake cabinet and coffee machine
def cafe():
    sc = setup(warm=True)
    floor(woodmat('floorwood', hexc('#7a5636'), hexc('#5e3f26'), 0.5, 0.2, 3, grain='X'))
    box(-1, W + 1, 3.2, 3.3, 0, H + 0.2, brickmat('brick', hexc('#8a4a35'), hexc('#a35a40'), hexc('#c9c0b0'), 3.8, 0.42, 0.18, 0.01, 0.85))
    box(-1, W + 1, 3.15, 3.2, 0, 0.9, woodmat('panel', hexc('#3d2a1c'), hexc('#2b1d13'), 0.5, 0.3, 4))
    wood = woodmat('shelfwood', hexc('#8a6440'), hexc('#6b4a2e'), 0.45, 0.2, 9)
    # the chalkboard, shelves with cups and bags of coffee either side
    box(1.35, 2.65, 3.1, 3.14, 1.42, 2.32, woodmat('cbframe', hexc('#4a3220'), hexc('#36241a')))
    box(1.4, 2.6, 3.08, 3.1, 1.47, 2.27, mat('cbback', hexc('#222'), 0.8), front=imgmat(os.path.join(LAB, 'chalkboard.png'), emit=0.25, rough=0.9))
    mug = mat('mug', hexc('#f2efe8'), 0.35); bag = [mat('bag' + str(k), hexc(c), 0.6) for k, c in enumerate(['#2b2b2b', '#6b3a22', '#b8952e', '#3a5a3a'])]
    for x0 in (0.15, 2.85):
        for z in (1.45, 1.85):
            box(x0, x0 + 1.0, 2.9, 3.15, z - 0.03, z, wood)
            x = x0 + 0.06
            while x < x0 + 0.92:
                if rnd.random() < 0.55:
                    cyl(x + 0.05, 3.02, z, 0.1, 0.045, mug); x += 0.12
                else:
                    box(x, x + 0.11, 2.97, 3.08, z, z + 0.2 + rnd.uniform(0, 0.05), rnd.choice(bag)); x += 0.14
    # a barista and the counter: timber front, a glass cabinet of cakes, the coffee machine, a till, cups
    person(1.1, 2.3, 0, '#1e1e20', apron='#3a2a1e', h=1.7); person(3.0, 2.35, 0, '#f2f0ea', apron='#3a2a1e', h=1.64)
    box(0.15, 3.85, 1.6, 2.1, 0, 0.98, woodmat('cfront', hexc('#6b4a2e'), hexc('#4e3420'), 0.45, 0.3, 14), bevel=0.01)
    for x in [0.35 + k * 0.42 for k in range(9)]: box(x, x + 0.02, 1.585, 1.6, 0.08, 0.9, mat('groove', hexc('#3b2818'), 0.6))
    box(0.1, 3.9, 1.55, 2.12, 0.98, 1.03, mat('marble', hexc('#ece9e2'), 0.25, coat=0.4))
    glass = mat('glass', (0.9, 0.95, 1.0, 1), 0.05, trans=1.0)
    box(0.3, 1.7, 1.62, 2.05, 1.03, 1.5, glass)
    box(0.3, 1.7, 1.62, 2.05, 1.24, 1.25, mat('glshelf', (0.9, 0.95, 1.0, 1), 0.05, trans=1.0))
    for z in (1.03, 1.25):
        for k in range(6):
            x = 0.42 + k * 0.22; c = rnd.choice(['#f3e6c8', '#6b3a22', '#e9b7c0', '#d9a441', '#f6f0e4', '#8a4a2a'])
            cyl(x, 1.84, z + 0.005, 0.08, 0.075, mat('cake' + c, hexc(c), 0.6), segs=20)
            cyl(x, 1.84, z + 0.085, 0.012, 0.072, mat('icing' + str(k % 3), hexc(['#fbf6ee', '#3b2014', '#f4c7d0'][k % 3]), 0.5), segs=20)
    steel = mat('steel', hexc('#cfd2d6'), 0.25, 1.0)
    box(2.3, 3.2, 1.75, 2.1, 1.03, 1.52, steel, bevel=0.01)
    box(2.32, 3.18, 1.74, 1.76, 1.36, 1.48, mat('machinered', hexc('#9b1c1c'), 0.4))
    for x in (2.45, 2.75, 3.05): cyl(x, 1.72, 1.2, 0.08, 0.035, mat('group', hexc('#111111'), 0.4, 0.6), segs=12)
    for k in range(4): cyl(2.45 + k * 0.22, 1.9, 1.52, 0.09, 0.045, mug)
    box(3.35, 3.7, 1.65, 1.95, 1.03, 1.07, mat('till', hexc('#161616'), 0.4))
    s = box(3.38, 3.67, 1.78, 1.8, 1.09, 1.3, mat('tillscr', (0.8, 0.9, 1.0, 1), 0.2, emit=(0.8, 0.9, 1.0, 1), strength=1.5)); s.rotation_euler = (math.radians(-10), 0, 0)
    for x in (0.9, 2.0, 3.1): pendant(x, 1.2, 2.05, mat('shade', hexc('#1c1c1c'), 0.4, 0.6))
    # tables and chairs in front, an armchair
    top = woodmat('ttop', hexc('#9a7048'), hexc('#7a5434'), 0.4, 0.4, 10)
    for x in (0.6, 2.05):
        table(x, 0.5, top, 0.64, 0.64, 0.74, round_=True)
        chair(x - 0.45, 0.5, '#3a2a1e', back=True, wood=woodmat('chairw', hexc('#3a2a1e'), hexc('#2a1c12')))
        chair(x + 0.45, 0.5, '#3a2a1e', back=True, wood=woodmat('chairw', hexc('#3a2a1e'), hexc('#2a1c12')))
    leather = mat('leather', hexc('#5a3220'), 0.45, coat=0.3)
    box(3.05, 3.85, 0.25, 0.95, 0.1, 0.45, leather, bevel=0.04); box(3.05, 3.85, 0.8, 0.95, 0.45, 0.95, leather, bevel=0.04)
    box(3.0, 3.12, 0.25, 0.95, 0.1, 0.65, leather, bevel=0.03); box(3.78, 3.9, 0.25, 0.95, 0.1, 0.65, leather, bevel=0.03)
    person(2.47, 0.55, -0.3, '#7a3b3b', h=1.62)
    render(sc, 'cafe')

# ---- a pub: the bar, its pumps and the back bar of bottles and optics in front of a mirror, panelling and wallpaper
def pub():
    sc = setup(warm=True)
    floor(mat('pubcarpet', hexc('#5a2328'), 0.9))
    paper = brickmat('wallpaper', hexc('#6e2a2c'), hexc('#7a3033'), hexc('#8e6a3a'), 2.2, 0.25, 0.25, 0.004, 0.8)
    box(-1, W + 1, 3.2, 3.3, 0, H + 0.2, paper)
    oak = woodmat('oak', hexc('#4a2c18'), hexc('#2e1a0e'), 0.35, 0.5, 8)
    box(-1, W + 1, 3.15, 3.2, 0, 1.05, oak)
    box(-1, W + 1, 3.12, 3.16, 1.02, 1.08, oak)
    # the back bar: a long mirror, glass shelves of bottles, the optics, a lit bottle fridge below
    box(0.4, 3.6, 3.1, 3.12, 1.2, 2.15, mat('mirror', hexc('#4a4c50'), 0.12, 1.0))   # (smoked: it shows the dim room, not a glare)
    box(0.3, 3.7, 3.0, 3.12, 2.15, 2.25, oak); box(0.3, 0.42, 3.0, 3.12, 1.08, 2.25, oak); box(3.58, 3.7, 3.0, 3.12, 1.08, 2.25, oak)
    colours = ['#2e5a2e', '#6b3a1a', '#d8d4c8', '#1d3a5a', '#8a1f1f', '#c49a3a', '#3a2a1a', '#e8e0c8']
    shelfm = mat('pubglass', (0.9, 0.95, 1.0, 1), 0.05, trans=1.0)
    for z in (1.3, 1.62):
        box(0.45, 3.55, 2.88, 3.1, z - 0.012, z, shelfm)
        x = 0.52
        while x < 3.5:
            c = rnd.choice(colours); h = rnd.uniform(0.24, 0.32); r = rnd.uniform(0.035, 0.045)
            bottle(x, 2.98, z, h, r, mat('btl' + c, hexc(c), 0.08, trans=0.55, coat=0.6), mat('btlcap', hexc('#c9b26a'), 0.3, 1.0))
            x += r * 2 + 0.02
    for k in range(6):   # optics: bottles upside down in their brackets
        x = 0.8 + k * 0.46; c = rnd.choice(colours)
        b = lathe([(0.0001, 0), (0.045, 0), (0.045, 0.2), (0.018, 0.27), (0.018, 0.3), (0.0001, 0.3)], x, 3.0, 2.1, mat('opt' + c, hexc(c), 0.08, trans=0.5, coat=0.5), 16)
        b.rotation_euler = (math.pi, 0, 0)   # upside down, hanging from 2.1 m
        cyl(x, 3.0, 1.74, 0.06, 0.02, mat('measure', hexc('#d0d2d4'), 0.2, 1.0), segs=10)
    box(0.45, 3.55, 2.75, 3.1, 0, 0.95, oak)
    for x0 in (0.55, 2.05):
        box(x0, x0 + 1.4, 2.73, 2.75, 0.1, 0.85, mat('fridgeglass', (0.85, 0.9, 1.0, 1), 0.05, trans=0.6))
        box(x0, x0 + 1.4, 3.0, 3.02, 0.1, 0.85, mat('fridgeglow', (0.9, 0.95, 1.0, 1), 0.4, emit=(0.85, 0.92, 1.0, 1), strength=1.2))
        for z in (0.15, 0.5):
            for k in range(12): bottle(x0 + 0.08 + k * 0.11, 2.88, z, 0.25, 0.032, mat('beerbtl' + str(k % 3), hexc(['#4a2a10', '#2e5a2e', '#c8a040'][k % 3]), 0.1, trans=0.4))
    # the barman, the bar and its pumps, stools in front
    person(1.6, 2.3, 0, '#1a1a1a', h=1.76); person(2.9, 2.35, 0, '#3a2a4a', h=1.64)
    box(0.0, W, 1.6, 2.1, 0, 1.05, woodmat('barfront', hexc('#3e2314'), hexc('#2a160c'), 0.35, 0.6, 12), bevel=0.01)
    for x in [0.25 + k * 0.5 for k in range(8)]: box(x, x + 0.36, 1.585, 1.6, 0.18, 0.92, woodmat('barpanel', hexc('#4a2a18'), hexc('#331c0e'), 0.35, 0.6, 12), bevel=0.01)
    box(-0.05, W + 0.05, 1.52, 2.15, 1.05, 1.11, woodmat('bartop', hexc('#5a3420'), hexc('#3a200f'), 0.25, 0.8, 10), bevel=0.012)
    brass = mat('brass', hexc('#c9a24a'), 0.25, 1.0)
    rail = cyl(0, 1.45, 0.18, W, 0.022, brass, segs=12); rail.rotation_euler = (0, math.radians(90), 0)   # the foot rail, along the bar
    for k in range(5):   # hand pumps with their clips
        x = 1.0 + k * 0.28
        cyl(x, 1.78, 1.11, 0.08, 0.03, brass, segs=12)
        cyl(x, 1.78, 1.19, 0.3, 0.016, mat('pumpwood', hexc('#2a160c'), 0.3, coat=0.6), 0.022, segs=12)
        box(x - 0.045, x + 0.045, 1.74, 1.75, 1.32, 1.46, mat('clipback', hexc('#222'), 0.5), front=imgmat(os.path.join(LAB, f'clip_{k}.png'), emit=0.3))
    for x in (2.7, 3.2):   # lager fonts
        cyl(x, 1.82, 1.11, 0.34, 0.035, mat('chrome', hexc('#e0e2e4'), 0.1, 1.0), segs=16)
        box(x - 0.12, x + 0.12, 1.79, 1.85, 1.38, 1.46, mat('font', hexc('#e0e2e4'), 0.1, 1.0))
        box(x - 0.05, x + 0.05, 1.78, 1.79, 1.3, 1.37, mat('fontbadge' + str(x), hexc(['#c8102e', '#1f5fae'][int(x) % 2]), 0.3, emit=hexc(['#c8102e', '#1f5fae'][int(x) % 2]), strength=1.2))
    for x in (0.6, 1.4, 2.3, 3.4):   # stools
        cyl(x, 1.25, 0, 0.74, 0.02, oak, segs=8); cyl(x, 1.25, 0, 0.03, 0.18, oak, segs=16)
        cyl(x, 1.25, 0.74, 0.05, 0.19, mat('stoolseat', hexc('#4a1a1c'), 0.5, coat=0.2), segs=20)
    for (x, k) in ((0.1, 0), (3.72, 1)):   # pictures and wall lamps either end
        box(x - 0.02, x + 0.28, 3.1, 3.13, 1.55, 1.85, mat('frame', hexc('#c9a24a'), 0.3, 1.0))
        box(x, x + 0.26, 3.09, 3.1, 1.57, 1.83, oak, front=imgmat(os.path.join(LAB, f'picture_{k}.png')))
    for x in (0.25, 3.85):
        cyl(x, 3.05, 2.0, 0.16, 0.08, mat('lampshade', (1.0, 0.8, 0.55, 1), 0.6, emit=(1.0, 0.72, 0.4, 1), strength=5), 0.05, segs=16)
    person(0.95, 1.2, -0.22, '#4a5a3a', h=1.72); person(3.0, 1.25, -0.2, '#6a2a2a', h=1.66)   # sat at the bar
    render(sc, 'pub')

for fn in (takeaway, cafe, pub):
    if ONLY and fn.__name__ not in ONLY: continue
    fn()

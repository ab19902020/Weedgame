#!/usr/bin/env python3
"""Bake the four supplied real-car models (ActsOfDoge, Sketchfab Standard licence) for the traffic renderer:
2014 BMW X3, 2016 BMW M3 (F80), 2019 Volvo S60, 2023 Mercedes-Benz EQC.

Run gltfpack on each first, keeping its named parts and materials (about 11,000 triangles from 30,000):
  gltfpack -i scene.gltf -o simp.gltf -si 0.45 -kn -km -noq
Each model names its parts (paint, lights, glass, frontglass, chrome, grille, interior, tire...). This script:
  - drops the tyres (the game draws its own rolling, steering wheels) after measuring the axles and track from them;
  - turns the car to the traffic renderer's frame (+x forward: the end whose lamps aren't red; y up from the
    ground under the tyres; z across);
  - marks each vertex's part: 0 textured trim, 1 glass, 2 lamps, 3 paint (repainted per car in the game);
  - packs the real textures into one 2048 px atlas and turns the tiny single-colour ones (and untextured
    materials) into flat swatches.
Output (www/vehicles/): realcars.bin, realcars.json, realcars.jpg (same layout as carpack.*).
Usage: python3 tools/vehicles/bake-real-cars.py <dir holding the four unzipped models> [out dir]
"""
import json, os, sys
import numpy as np
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..', 'www', 'vehicles')
CARS = [('2014_bmw_x3', 'bmwx3', 'suv'), ('2016_bmw_m3_f80', 'bmwm3', 'saloon'), ('2019_volvo_s60', 'volvos60', 'saloon'), ('2023_mercedes-benz_eqc', 'mercedeseqc', 'suv')]

def part_of(name):
    n = name.lower()
    if n.startswith('tire'): return 'wheel'
    if 'glass' in n: return 1
    if n.startswith('light'): return 2
    if n.startswith('paint'): return 3
    return 0

def node_matrix(n):
    if 'matrix' in n: return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    M = np.eye(4)
    if 'scale' in n: M = np.diag(list(n['scale']) + [1]) @ M
    if 'rotation' in n:
        x, y, z, w = n['rotation']
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        Rm = np.eye(4); Rm[:3, :3] = R; M = Rm @ M
    if 'translation' in n: T = np.eye(4); T[:3, 3] = n['translation']; M = T @ M
    return M

def load(d):
    j = json.load(open(os.path.join(d, 'simp.gltf')))
    buf = open(os.path.join(d, j['buffers'][0]['uri']), 'rb').read()
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); size = np.dtype(dt).itemsize * n; stride = bv.get('byteStride') or size
        if stride == size: arr = np.frombuffer(buf, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
        else: arr = np.array([np.frombuffer(buf, dtype=dt, count=n, offset=off + k * stride) for k in range(a['count'])])
        return arr.astype(np.float64 if dt == np.float32 else np.int64)
    return j, acc

def main():
    AT = 2048; atlas = Image.new('RGB', (AT, AT), (20, 20, 22))
    tiles = {}; swatches = {}
    def tile_for(key, img):
        if key not in tiles:
            k = len(tiles); assert k < 12, 'atlas full'
            tiles[key] = ((k % 4) * 512, (k // 4) * 512)
            atlas.paste(img.resize((512, 512), Image.LANCZOS), tiles[key])
        return tiles[key]
    def swatch_for(rgb):
        key = tuple(int(round(c * 255)) for c in rgb)
        if key not in swatches:
            k = len(swatches); x, y = (k % 128) * 16, 1536 + (k // 128) * 16
            atlas.paste(Image.new('RGB', (16, 16), key), (x, y)); swatches[key] = (x + 8, y + 8)
        return swatches[key]
    out_P, out_N, out_UV, out_T, out_I, meta = [], [], [], [], [], []
    vbase = ibase = 0
    for folder, name, cls in CARS:
        d = os.path.join(SRC, folder); j, acc = load(d); nodes = j['nodes']
        parent = {}
        for i, n in enumerate(nodes):
            for c in n.get('children', []): parent[c] = i
        def world(i):
            M = node_matrix(nodes[i])
            while i in parent: i = parent[i]; M = node_matrix(nodes[i]) @ M
            return M
        parts, wheels = [], {}
        for i, n in enumerate(nodes):
            if 'mesh' not in n: continue
            pname = nodes[parent[i]].get('name', '') if i in parent else n.get('name', '')
            kind = part_of(pname)
            W = world(i); R3 = W[:3, :3]
            for prim in j['meshes'][n['mesh']]['primitives']:
                P0 = acc(prim['attributes']['POSITION']); P = (np.c_[P0, np.ones(len(P0))] @ W.T)[:, :3]
                if kind == 'wheel':
                    g = wheels.setdefault(pname, []); g.append(P); continue
                N = acc(prim['attributes']['NORMAL']) @ np.linalg.inv(R3).T; N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
                UV = acc(prim['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in prim['attributes'] else np.zeros((len(P), 2))
                I = acc(prim['indices']).reshape(-1)
                mat = j['materials'][prim['material']]; pb = mat.get('pbrMetallicRoughness', {})
                fac = np.array(pb.get('baseColorFactor', [1, 1, 1, 1])[:3])
                ti = pb.get('baseColorTexture', {}).get('index')
                img = Image.open(os.path.join(d, j['images'][j['textures'][ti]['source']]['uri'])).convert('RGB') if ti is not None else None
                parts.append(dict(P=P, N=N, UV=UV, I=I, kind=kind, img=img, imgkey=(folder, ti), fac=fac))
        # wheels: centre and radius of each tyre group; axles = the two pairs nearest each other along the length
        wc = []; wr = []
        for g in wheels.values():
            Q = np.concatenate(g); lo, hi = Q.min(0), Q.max(0); wc.append((lo + hi) / 2); wr.append((hi[1] - lo[1]) / 2)
        wc = np.array(wc); wr = float(np.mean(wr))
        allP = np.concatenate([p['P'] for p in parts]); ctr = (allP.min(0) + allP.max(0)) / 2
        # long axis from the body's horizontal extent
        ext = allP.max(0) - allP.min(0); fwd = np.array([1.0, 0.0]) if ext[0] > ext[2] else np.array([0.0, 1.0])
        lamps = [p for p in parts if p['kind'] == 2]
        red_along = []
        for p in lamps:
            if p['img'] is None: continue
            arr = np.asarray(p['img']).astype(float) / 255
            px = np.clip(p['UV'][:, 0], 0, 0.9999) * arr.shape[1]; py = np.clip(p['UV'][:, 1], 0, 0.9999) * arr.shape[0]
            col = arr[py.astype(int), px.astype(int)] * p['fac']
            red = (col[:, 0] > 0.3) & (col[:, 0] > col[:, 1] * 1.8)
            red_along.extend(((p['P'][red][:, [0, 2]] - ctr[[0, 2]]) @ fwd).tolist())
        if red_along and np.mean(red_along) > 0: fwd = -fwd
        right = np.array([-fwd[1], fwd[0]])
        ground = float(min(c[1] - wr for c in wc))
        to_local = lambda P: np.c_[(P[:, [0, 2]] - ctr[[0, 2]]) @ fwd, P[:, 1] - ground, (P[:, [0, 2]] - ctr[[0, 2]]) @ right]
        wl = to_local(wc); xs = sorted(wl[:, 0]); front = np.mean(xs[2:]); rear = np.mean(xs[:2])
        allL = to_local(allP); xc = (allL[:, 0].max() + allL[:, 0].min()) / 2
        wb = float(front - rear); wx = float((front + rear) / 2 - xc); track = float(np.mean(np.abs(wl[:, 2])) * 2)
        paint_cols = []
        car_P, car_N, car_UV, car_T, car_I = [], [], [], [], []; nv = 0
        for p in parts:
            P = to_local(p['P']) - np.array([xc, 0, 0])
            N = np.c_[p['N'][:, [0, 2]] @ fwd, p['N'][:, 1], p['N'][:, [0, 2]] @ right]
            # normals that disagree with the winding of their triangles are turned the right way round
            T3 = p['I'].reshape(-1, 3); fn = np.cross(P[T3[:, 1]] - P[T3[:, 0]], P[T3[:, 2]] - P[T3[:, 0]])
            an = np.zeros_like(P)
            for kk in range(3): np.add.at(an, T3[:, kk], fn)
            N[(N * an).sum(1) < 0] *= -1
            img = p['img']
            if img is not None and min(img.size) >= 128:
                tx, ty = tile_for(p['imgkey'], img)
                uv = np.c_[(tx + np.clip(p['UV'][:, 0], 0.002, 0.998) * 512) / AT, (ty + np.clip(p['UV'][:, 1], 0.002, 0.998) * 512) / AT]
                if p['kind'] == 3:
                    # (the texels the paint actually uses: a shared texture holds other parts too)
                    a = np.asarray(img).astype(float) / 255
                    px = (np.clip(p['UV'][:, 0], 0, 0.9999) * a.shape[1]).astype(int); py = (np.clip(p['UV'][:, 1], 0, 0.9999) * a.shape[0]).astype(int)
                    paint_cols.append(np.median(a[py, px], axis=0) * p['fac'])
            else:
                rgb = (np.asarray(img).astype(float).reshape(-1, 3).mean(0) / 255 if img is not None else np.ones(3)) * p['fac']
                sx, sy = swatch_for(np.clip(rgb, 0, 1))
                uv = np.tile([[sx / AT, sy / AT]], (len(P), 1))
                if p['kind'] == 3: paint_cols.append(rgb)
            car_P.append(P); car_N.append(N); car_UV.append(uv); car_T.append(np.full(len(P), p['kind'])); car_I.append(p['I'] + nv); nv += len(P)
        P = np.concatenate(car_P); I = np.concatenate(car_I)
        L = float(P[:, 0].max() - P[:, 0].min()); Wd = float(P[:, 2].max() - P[:, 2].min()); H = float(P[:, 1].max())
        paint = np.mean(paint_cols, axis=0) if paint_cols else np.ones(3)
        meta.append(dict(name=name, cls=cls, L=round(L, 3), W=round(Wd, 3), H=round(H, 3), wb=round(wb, 3), wr=round(wr, 3), wx=round(wx, 3), track=round(track, 3),
                         paint=[round(float(v), 3) for v in paint], full=True, vStart=vbase, vCount=nv, iStart=ibase, iCount=len(I)))
        print('%-12s %-6s L %.2f W %.2f H %.2f wb %.2f wr %.2f wx %+.2f track %.2f paint %s tris %d' % (name, cls, L, Wd, H, wb, wr, wx, track, meta[-1]['paint'], len(I) // 3))
        out_P.append(P); out_N.append(np.concatenate(car_N)); out_UV.append(np.concatenate(car_UV)); out_T.append(np.concatenate(car_T)); out_I.append(I)
        vbase += nv; ibase += len(I)
    os.makedirs(OUT, exist_ok=True)
    P = np.concatenate(out_P).astype(np.float32); N = np.concatenate(out_N); N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    Nq = np.c_[np.clip(np.round(N * 127), -127, 127), np.zeros(len(N))].astype(np.int8)
    UV = np.clip(np.round(np.concatenate(out_UV) * 65535), 0, 65535).astype(np.uint16)
    T = np.concatenate(out_T).astype(np.uint8); I = np.concatenate(out_I).astype(np.uint16)
    blobs = [('position', P), ('normal', Nq), ('uv', UV), ('part', T), ('index', I)]
    layout = {}; data = b''; off = 0
    for key, arr in blobs:
        b = arr.tobytes(); layout[key] = dict(offset=off, bytes=len(b)); data += b; off += len(b); pad = (-off) % 4; data += b'\0' * pad; off += pad
    open(os.path.join(OUT, 'realcars.bin'), 'wb').write(data)
    json.dump(dict(source='2014 BMW X3, 2016 BMW M3 (F80), 2019 Volvo S60, 2023 Mercedes-Benz EQC by ActsOfDoge (Sketchfab), Sketchfab Standard licence',
                   vertices=int(vbase), indices=int(ibase), layout=layout, cars=meta), open(os.path.join(OUT, 'realcars.json'), 'w'), indent=1)
    atlas.save(os.path.join(OUT, 'realcars.jpg'), quality=86, optimize=True)
    print('wrote', len(data) // 1024, 'KB +', os.path.getsize(os.path.join(OUT, 'realcars.jpg')) // 1024, 'KB atlas,', len(tiles), 'tiles,', len(swatches), 'swatches')

main()

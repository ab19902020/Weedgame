#!/usr/bin/env python3
"""Bake the supplied "Generic passenger car pack" (Comrade1280, Sketchfab, CC-BY-4.0) for the traffic renderer.

Ten cars (compact, coupe, hatchback, minivan, off-roader, pickup, saloon, sports, SUV, estate), each a textured
body, black glass and a lamp part ("Optics"), with separate wheels. For each car this script:
  - finds its four wheels (the nearest wheel nodes), and from them the wheelbase, track, wheel radius and axle centre;
  - turns it to the traffic renderer's frame: +x forward (the end whose lamps aren't red, or the lower end when that
    is clear), y up from the ground under the tyres, z across, centred on its length;
  - keeps the body, glass and lamps (the renderer draws its own rolling, steering wheels in the measured places);
  - records the paint colour (the commonest saturated colour on the body), so traffic can repaint it per car.
Output (www/vehicles/): carpack.bin (positions, normals, uvs, part per vertex, indices), carpack.json (layout and
each car's dimensions), carpack.jpg (2048 px atlas: ten bodies and the lamps in 512 px tiles).
Usage: python3 tools/vehicles/bake-car-pack.py <unzipped pack dir with scene.gltf> [out dir]
"""
import json, os, sys
import numpy as np
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..', 'www', 'vehicles')
# each body node: our name and the traffic class it drives like
CARS = {'Compact Body': ('compact', 'hatch'), 'Coupe Body': ('coupe2', 'saloon'), 'Hatchback Body': ('hatch2', 'hatch'),
        'minivan body': ('minivan', 'van'), 'Offroad Body': ('offroad', 'suv'), 'Pickup Body': ('pickup', 'suv'),
        'Sedan Body': ('sedan', 'saloon'), 'Sport body': ('sport2', 'saloon'), 'SUV Body': ('suv2', 'suv'), 'Wagon Body': ('wagon', 'estate')}

def load():
    j = json.load(open(os.path.join(SRC, 'scene.gltf')))
    buf = open(os.path.join(SRC, j['buffers'][0]['uri']), 'rb').read()
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); size = np.dtype(dt).itemsize * n; stride = bv.get('byteStride') or size
        if stride == size: arr = np.frombuffer(buf, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
        else: arr = np.array([np.frombuffer(buf, dtype=dt, count=n, offset=off + k * stride) for k in range(a['count'])])
        return arr.astype(np.float64 if dt == np.float32 else np.int64)
    return j, acc

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

def main():
    j, acc = load(); nodes = j['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    def world(i):
        M = node_matrix(nodes[i])
        while i in parent: i = parent[i]; M = node_matrix(nodes[i]) @ M
        return M
    def mesh_world(mi, want=None):
        out = []
        W = world(mi); R3 = W[:3, :3]
        for prim in j['meshes'][nodes[mi]['mesh']]['primitives']:
            mat = j['materials'][prim['material']]
            if want and not mat['name'].startswith(want): continue
            P0 = acc(prim['attributes']['POSITION']); P = (np.c_[P0, np.ones(len(P0))] @ W.T)[:, :3]
            N = acc(prim['attributes']['NORMAL']) @ np.linalg.inv(R3).T; N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
            UV = acc(prim['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in prim['attributes'] else np.zeros((len(P), 2))
            I = acc(prim['indices']).reshape(-1)
            tex = mat.get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index')
            out.append(dict(P=P, N=N, UV=UV, I=I, mat=mat['name'], img=None if tex is None else j['images'][j['textures'][tex]['source']]['uri']))
        return out
    root = next(i for i, n in enumerate(nodes) if n.get('name') == 'RootNode')
    kids = nodes[root]['children']
    # wheels: every node with a 'Wheel' mesh part; its centre and radius
    wheels = []
    for c in kids:
        if not nodes[c].get('name', '').startswith('Wheel'): continue
        P = np.concatenate([p['P'] for mi in nodes[c].get('children', []) if 'mesh' in nodes[mi] for p in mesh_world(mi, 'Whe')])
        lo, hi = P.min(0), P.max(0)
        wheels.append(dict(c=(lo + hi) / 2, r=(hi[1] - lo[1]) / 2, w=None))
    AT = 2048; atlas = Image.new('RGB', (AT, AT), (10, 10, 12))
    optics_img = None
    out_P, out_N, out_UV, out_T, out_I, meta = [], [], [], [], [], []
    vbase = ibase = 0
    for k, c in enumerate([c for c in kids if nodes[c].get('name') in CARS]):
        name, cls = CARS[nodes[c]['name']]
        parts = [p for mi in nodes[c].get('children', []) if 'mesh' in nodes[mi] for p in mesh_world(mi)]
        allP = np.concatenate([p['P'] for p in parts]); ctr = (allP.min(0) + allP.max(0)) / 2
        ws = sorted(wheels, key=lambda w: np.linalg.norm((w['c'] - ctr)[[0, 2]]))[:4]
        wc = np.array([w['c'] for w in ws]); wr = float(np.mean([w['r'] for w in ws]))
        # the long axis: the two axles are the two pairs of wheels furthest apart
        best = None
        for a in range(4):
            for b in range(a + 1, 4):
                d = np.linalg.norm((wc[a] - wc[b])[[0, 2]])
                if best is None or d < best[0]: best = (d, a, b)   # closest pair = one axle
        a, b = best[1], best[2]; ax1 = (wc[a] + wc[b]) / 2; rest = [i for i in range(4) if i not in (a, b)]; ax2 = (wc[rest[0]] + wc[rest[1]]) / 2
        fwd = (ax1 - ax2)[[0, 2]]; fwd /= np.linalg.norm(fwd)
        # which end is the front: the rear lamps are red
        optics = [p for p in parts if p['mat'].startswith('Optics')]
        if optics_img is None and optics: optics_img = Image.open(os.path.join(SRC, optics[0]['img'])).convert('RGB')
        o = optics[0]; arr = np.asarray(optics_img).astype(float) / 255
        px = np.clip(o['UV'][:, 0] * (arr.shape[1] - 1), 0, arr.shape[1] - 1).astype(int); py = np.clip(o['UV'][:, 1] * (arr.shape[0] - 1), 0, arr.shape[0] - 1).astype(int)
        col = arr[py, px]; red = (col[:, 0] > 0.35) & (col[:, 0] > col[:, 1] * 1.8)
        along = (o['P'][:, [0, 2]] - ctr[[0, 2]]) @ fwd
        if red.any() and along[red].mean() > 0: fwd = -fwd
        ground = min(w['c'][1] - w['r'] for w in ws)
        def to_local(P):
            d = P[:, [0, 2]] - ctr[[0, 2]]
            return np.c_[d @ fwd, P[:, 1] - ground, d @ right]
        def dir_local(N):
            return np.c_[N[:, [0, 2]] @ fwd, N[:, 1], N[:, [0, 2]] @ right]
        right = np.array([-fwd[1], fwd[0]]); Ls = [to_local(p['P']) for p in parts]
        # second opinion, which wins when it is clear: the bonnet end is the low one. The red-lamp test alone turned
        # the people carrier back to front, so in game it drove along tail first.
        allL = np.concatenate(Ls); x0, x1 = allL[:, 0].min(), allL[:, 0].max(); end = 0.12 * (x1 - x0)
        hf, hr = allL[allL[:, 0] > x1 - end, 1].max(), allL[allL[:, 0] < x0 + end, 1].max()
        if hf - hr > 0.25:
            fwd = -fwd; right = np.array([-fwd[1], fwd[0]]); Ls = [to_local(p['P']) for p in parts]
            print('%-9s turned round: its tall end (%.2f m against %.2f m) is the back' % (name, hf, hr))
        allL = np.concatenate(Ls); xc = (allL[:, 0].min() + allL[:, 0].max()) / 2
        axles = sorted([to_local(ax1[None])[0], to_local(ax2[None])[0]], key=lambda v: v[0])
        wb = float(axles[1][0] - axles[0][0]); wx = float((axles[1][0] + axles[0][0]) / 2 - xc)
        track = float(np.mean([abs(to_local(w['c'][None])[0][2]) for w in ws]) * 2)
        # body texture into its tile; paint = the commonest strong colour on the body
        tile = 512; tx, ty = (k % 4) * tile, (k // 4) * tile
        body = [p for p in parts if p['mat'].startswith('Body')][0]
        bimg = Image.open(os.path.join(SRC, body['img'])).convert('RGB')
        atlas.paste(bimg.resize((tile, tile), Image.LANCZOS), (tx, ty))
        barr = np.asarray(bimg.resize((256, 256))).astype(float) / 255
        bu = np.clip(body['UV'][:, 0] * 255, 0, 255).astype(int); bv = np.clip(body['UV'][:, 1] * 255, 0, 255).astype(int)
        cols = barr[bv, bu]; sat = cols.max(1) - cols.min(1)
        strong = cols[sat > 0.18]
        paint = np.median(strong, axis=0) if len(strong) > len(cols) * 0.25 else None
        for i, p in enumerate(parts):
            P = Ls[i] - np.array([xc, 0, 0]); N = dir_local(p['N']); N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
            # most of the pack's cars have their normals stored inside out (the source draws both sides): turn every
            # normal that disagrees with the winding of its triangles (which faces out) the right way round
            T3 = p['I'].reshape(-1, 3); fn = np.cross(P[T3[:, 1]] - P[T3[:, 0]], P[T3[:, 2]] - P[T3[:, 0]])
            acc_n = np.zeros_like(P)
            for kk in range(3): np.add.at(acc_n, T3[:, kk], fn)
            flip = (N * acc_n).sum(1) < 0
            N[flip] *= -1
            if p['mat'].startswith('Body'):
                uv = np.c_[(tx + np.clip(p['UV'][:, 0], 0.001, 0.999) * tile) / AT, (ty + np.clip(p['UV'][:, 1], 0.001, 0.999) * tile) / AT]; part = 0
            elif p['mat'].startswith('Optics'):
                uv = np.c_[(3 * tile + np.clip(p['UV'][:, 0], 0.001, 0.999) * tile) / AT, (3 * tile + np.clip(p['UV'][:, 1], 0.001, 0.999) * tile) / AT]; part = 2
            else:
                uv = np.full((len(P), 2), 0.999); part = 1   # glass: no texture (the shader tints it)
            out_P.append(P); out_N.append(N); out_UV.append(uv); out_T.append(np.full(len(P), part)); out_I.append(p['I'] + sum(len(q['P']) for q in parts[:i]))
        nv = sum(len(p['P']) for p in parts); ni = sum(len(p['I']) for p in parts)
        L = float(allL[:, 0].max() - allL[:, 0].min()); W = float(allL[:, 2].max() - allL[:, 2].min()); H = float(allL[:, 1].max())
        meta.append(dict(name=name, cls=cls, L=round(L, 3), W=round(W, 3), H=round(H, 3), wb=round(wb, 3), wr=round(wr, 3), wx=round(wx, 3), track=round(track, 3),
                         paint=None if paint is None else [round(float(v), 3) for v in paint], vStart=vbase, vCount=nv, iStart=ibase, iCount=ni))
        print('%-9s %-7s L %.2f W %.2f H %.2f wb %.2f wr %.2f wx %+.2f track %.2f paint %s tris %d' % (name, cls, L, W, H, wb, wr, wx, track, meta[-1]['paint'], ni // 3))
        vbase += nv; ibase += ni
    if optics_img: atlas.paste(optics_img.resize((512, 512), Image.LANCZOS), (3 * 512, 3 * 512))
    os.makedirs(OUT, exist_ok=True)
    P = np.concatenate(out_P).astype(np.float32); N = np.concatenate(out_N)
    Nq = np.c_[np.clip(np.round(N * 127), -127, 127), np.zeros(len(N))].astype(np.int8)
    UV = np.clip(np.round(np.concatenate(out_UV) * 65535), 0, 65535).astype(np.uint16)
    T = np.concatenate(out_T).astype(np.uint8); I = np.concatenate(out_I).astype(np.uint16)
    blobs = [('position', P), ('normal', Nq), ('uv', UV), ('part', T), ('index', I)]
    layout = {}; data = b''; off = 0
    for key, arr in blobs:
        b = arr.tobytes(); layout[key] = dict(offset=off, bytes=len(b)); data += b; off += len(b); pad = (-off) % 4; data += b'\0' * pad; off += pad
    open(os.path.join(OUT, 'carpack.bin'), 'wb').write(data)
    json.dump(dict(source='Generic passenger car pack by Comrade1280 (Sketchfab), CC-BY-4.0', vertices=int(vbase), indices=int(ibase), layout=layout, cars=meta),
              open(os.path.join(OUT, 'carpack.json'), 'w'), indent=1)
    atlas.save(os.path.join(OUT, 'carpack.jpg'), quality=86, optimize=True)
    print('wrote', len(data) // 1024, 'KB +', os.path.getsize(os.path.join(OUT, 'carpack.jpg')) // 1024, 'KB atlas')

main()

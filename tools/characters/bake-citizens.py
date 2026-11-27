#!/usr/bin/env python3
"""Bake the supplied "Citizen NPC Pack 1" (00amza, CC-BY-4.0) into the crowd's procedural skeleton.

The pack's fourteen citizens are static meshes in an A-pose with no skeleton. The crowd renderer (src/humans.js)
skins every body in its vertex shader from a per-vertex `skin` attribute (limb, chain coordinate, region, tag)
around fixed hip/knee/ankle and shoulder/elbow/wrist joints. This script fits each citizen to those joints:

  1. merge the citizen's body and head, stand it on the ground at the origin facing +z, scale it to 1.79 m
     (its real height is kept in the manifest, for the instance scale);
  2. find its own joints (leg joints from slices at the skeleton's joint heights, the arm from the shoulder to
     the fingertips);
  3. sort its vertices into torso, legs, arms and (for skirts) the skirt, and give each its chain coordinate;
  4. move each limb onto the skeleton's chain (the A-pose arms come down to hang at the sides), blending near the
     shoulders and hips the same way the shader does;
  5. pack its two textures into one atlas and remap the UVs.

Output (www/characters/): citizens.bin (positions, normals, uvs, skin, indices), citizens.json (layout, heights,
who is who), citizens.jpg (the atlas). Usage:
  python3 tools/characters/bake-citizens.py <unzipped pack dir with scene.gltf> [out dir]
"""
import json, os, struct, sys
import numpy as np
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..', 'www', 'characters')
H_CANON = 1.79
# the shader's joints (humans.js): [side * x, y, z]
ARM_J = [(0.2, 1.43, -0.01), (0.225, 1.165, -0.03), (0.235, 0.905, 0.0)]
LEG_J = [(0.092, 0.93, 0.0), (0.098, 0.505, 0.012), (0.1, 0.085, -0.02)]
# who is who (checked by eye against renders of each one): sex, skirt, and what they wear
PEOPLE = {
    '001': ('m', False, 'man in a grey suit'), '002': ('f', True, 'woman, white blouse and navy floral skirt'),
    '003': ('m', False, 'man, dark jacket and grey T-shirt'), '004': ('m', False, 'man in a black suit, green tie'),
    '005': ('f', True, 'woman in a grey skirt suit'), '006': ('m', False, 'man, red jumper'),
    '007': ('f', True, 'woman, white blouse and pale floral skirt'), '008': ('m', False, 'man, blazer, check shirt and grey trousers'),
    '009': ('f', True, 'woman, beige top and orange skirt'), '010': ('m', False, 'man, green overshirt and black jeans'),
    '011': ('m', False, 'man, navy shirt and jeans'), '012': ('m', False, 'man, navy jacket and chinos'),
    '013': ('f', True, 'woman, cream blouse and maroon skirt'), '014': ('f', False, 'woman, cream shirt and white trousers'),
}

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def load_gltf(path):
    j = json.load(open(os.path.join(path, 'scene.gltf')))
    buf = open(os.path.join(path, j['buffers'][0]['uri']), 'rb').read()
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        size = np.dtype(dt).itemsize * n
        stride = bv.get('byteStride') or size
        if stride == size:
            return np.frombuffer(buf, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n).astype(np.float64 if dt == np.float32 else np.int64)
        rows = [np.frombuffer(buf, dtype=dt, count=n, offset=off + k * stride) for k in range(a['count'])]
        return np.array(rows).astype(np.float64 if dt == np.float32 else np.int64)
    return j, acc

def node_matrix(n):
    if 'matrix' in n: return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    M = np.eye(4)
    if 'scale' in n: M = np.diag(list(n['scale']) + [1]) @ M
    if 'rotation' in n:
        x, y, z, w = n['rotation']
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        Rm = np.eye(4); Rm[:3, :3] = R; M = Rm @ M
    if 'translation' in n:
        T = np.eye(4); T[:3, 3] = n['translation']; M = T @ M
    return M

def rot_between(u, v):
    """rotation matrix taking unit vector u onto unit vector v (shortest arc)"""
    u = u / np.linalg.norm(u); v = v / np.linalg.norm(v)
    c = np.dot(u, v); ax = np.cross(u, v); s = np.linalg.norm(ax)
    if s < 1e-9: return np.eye(3)
    ax /= s; K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
    return np.eye(3) + s * K + (1 - c) * K @ K

def chain_param(P, C):
    """chain coordinate s of points P along the polyline C0-C1-C2 (0 at C0, 1 at C1, 2 at C2, beyond 2 past C2,
    below 0 before C0) and which segment (0 or 1) frames them"""
    s = np.zeros(len(P)); seg = np.zeros(len(P), dtype=int)
    d = []
    ts = []
    for k in range(2):
        a, b = C[k], C[k + 1]; ab = b - a; L2 = ab @ ab
        t = ((P - a) @ ab) / L2
        foot = a + np.clip(t, 0, 1.8 if k == 1 else 1)[:, None] * ab
        d.append(np.linalg.norm(P - foot, axis=1)); ts.append(t)
    use1 = (ts[0] > 1) & ((d[1] <= d[0]) | (ts[1] > 0))
    s = np.where(use1, 1 + ts[1], ts[0])
    seg = np.where(use1, 1, 0)
    return s, seg, np.minimum(d[0], d[1])

def remap_chain(P, N, s, seg, C, T, blend):
    """move points from chain C onto chain T keeping each one's offset from the chain (turned with its
    segment), blended by `blend` (0 keeps the point where it was)"""
    P2 = P.copy(); N2 = N.copy()
    for k in range(2):
        m = seg == k
        if not m.any(): continue
        a, b, ta, tb = C[k], C[k + 1], T[k], T[k + 1]
        R = rot_between(b - a, tb - ta)
        if k == 1:
            # past the last joint (hand, foot): rigid on the last segment, no stretch
            sk = s[m] - 1
            beyond = sk > 1
            base_c = a + np.minimum(sk, 1)[:, None] * (b - a)
            base_t = ta + np.minimum(sk, 1)[:, None] * (tb - ta)
            off = P[m] - base_c
            off[beyond] = P[m][beyond] - b
            base_t[beyond] = tb
        else:
            sk = s[m]
            base_c = a + sk[:, None] * (b - a)
            base_t = ta + sk[:, None] * (tb - ta)
            off = P[m] - base_c
        P2[m] = base_t + off @ R.T
        N2[m] = N[m] @ R.T
    w = blend[:, None]
    P3 = P + (P2 - P) * w
    N3 = N + (N2 - N) * w
    N3 /= np.linalg.norm(N3, axis=1, keepdims=True) + 1e-12
    return P3, N3

def main():
    j, acc = load_gltf(SRC)
    nodes = j['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    def world(i):
        M = node_matrix(nodes[i])
        while i in parent:
            i = parent[i]; M = node_matrix(nodes[i]) @ M
        return M
    root = next(i for i, n in enumerate(nodes) if n.get('name') == 'RootNode')
    citizens = []
    for ci in nodes[root]['children']:
        name = nodes[ci]['name']
        parts = []
        for mi in nodes[ci].get('children', []):
            mn = nodes[mi]
            if 'mesh' not in mn: continue
            W = world(mi)
            for prim in j['meshes'][mn['mesh']]['primitives']:
                P = acc(prim['attributes']['POSITION']); N = acc(prim['attributes']['NORMAL']); UV = acc(prim['attributes']['TEXCOORD_0'])
                I = acc(prim['indices']).reshape(-1)
                P = (np.c_[P, np.ones(len(P))] @ W.T)[:, :3]
                R3 = W[:3, :3]; N = N @ np.linalg.inv(R3).T; N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
                mat = j['materials'][prim['material']]
                img = j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
                parts.append(dict(P=P, N=N, UV=UV, I=I, img=j['images'][img]['uri'], head='BODY' not in mat['name'].upper()))
        citizens.append((name, parts))

    # atlas: 2048 x 2560, bodies in 512 px tiles (rows 0-3, 14 of 16), heads in 256 px tiles in the last row
    AW, AH = 2048, 2560
    atlas = Image.new('RGB', (AW, AH), (128, 128, 128))
    out_P, out_N, out_UV, out_S, out_I, meta = [], [], [], [], [], []
    vbase = 0; ibase = 0
    for k, (name, parts) in enumerate(citizens):
        tag = name.split('_')[-1]
        P = np.concatenate([p['P'] for p in parts]); N = np.concatenate([p['N'] for p in parts])
        # ground at y = 0, centred on the torso, facing +z
        P[:, 1] -= P[:, 1].min()
        H = P[:, 1].max()
        torso = (P[:, 1] > 0.55 * H) & (P[:, 1] < 0.75 * H)
        cx, cz = P[torso, 0].mean(), P[torso, 2].mean()
        P[:, 0] -= cx; P[:, 2] -= cz
        P *= H_CANON / H
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        limb = np.zeros(len(P)); s = np.zeros(len(P)); region = np.ones(len(P))
        sex, skirt, desc = PEOPLE[tag]
        # a skirt's hem: the lowest of the skirt's own vertices (on the middle line, front and back, where legs aren't)
        hem = None
        if skirt:
            ys = y[(np.abs(x) < 0.03) & (y > 0.4) & (y < 0.95)]
            hem = float(np.percentile(ys, 3)) if len(ys) else 0.55
        done = np.zeros(len(P), dtype=bool)
        joints = {}
        for side in (1, -1):
            # ---- arm: from the shoulder to the fingertips
            sl = (y > 1.38) & (y < 1.47) & (x * side > 0)
            xe = (x[sl] * side).max(); zs = z[sl].mean()
            sh = np.array([side * (xe - 0.055), 1.43, zs])
            cand = (x * side > 0.12) & (y > 0.4)
            tip_i = np.argmax(np.where(cand, x * side, -9)); tip = P[tip_i]
            wr = sh + (tip - sh) * 0.755; el = sh + (wr - sh) * 0.5
            C = np.array([sh, el, wr])
            ss, seg, d = chain_param(P, C)
            # the arm is everything on its side of a plane through the shoulder that halves the angle between the
            # A-pose arm and straight down (so thick sleeves, cuffs and the hand all come with it, the chest doesn't)
            ad = (tip - sh)[:2]; ad /= np.linalg.norm(ad)
            b = ad + np.array([0.0, -1.0]); b /= np.linalg.norm(b)
            nrm = np.array([-b[1], b[0]]) * side
            if nrm @ ad < 0: nrm = -nrm
            rel = P[:, :2] - sh[:2]
            arm = (x * side > 0.06) & (~done) & (rel @ nrm > 0) & (ss > -0.35) & ~((y > 1.5) & (np.abs(x) < 0.13))
            # target chain: the shader's, hanging down from this citizen's own shoulder
            T = np.array([[sh[0] + side * (ARM_J[k][0] - ARM_J[0][0]), ARM_J[k][1], ARM_J[k][2]] for k in range(3)])
            idx = np.where(arm)[0]
            Pn, Nn = remap_chain(P[idx], N[idx], ss[idx], seg[idx], C, T, smooth(-0.25, 0.0, ss[idx]))
            P[idx] = Pn; N[idx] = Nn
            limb[idx] = 3 if side > 0 else 4; s[idx] = ss[idx]; done[idx] = True
            joints['arm%+d' % side] = (C.round(3).tolist(), T.round(3).tolist())
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        if skirt:
            sk = (~done) & (y < 1.0) & (y > hem - 0.01)
            limb[sk] = 5; done[sk] = True
        for side in (1, -1):
            # ---- leg: joints from slices at the skeleton's joint heights
            legv = (~done) & (y < 0.99) & (x * side > 0.004)
            C = []
            for jy in (LEG_J[0][1], LEG_J[1][1], LEG_J[2][1]):
                sl = legv & (np.abs(y - jy) < 0.04)
                if sl.sum() < 3: sl = legv & (np.abs(y - jy) < 0.09)
                if sl.sum() < 3:
                    # (under a skirt the hip has no leg of its own: take the leg's line from just below the hem)
                    below = legv & (y < jy)
                    top = y[below].max() if below.any() else 0.5
                    sl = below & (y > top - 0.06)
                C.append([x[sl].mean(), jy, z[sl].mean()])
            C = np.array(C)
            assert np.isfinite(C).all(), (name, side, C)
            T = np.array([[C[k][0], LEG_J[k][1], LEG_J[k][2]] for k in range(3)])
            ss, seg, d = chain_param(P, C)
            leg = legv & ~((np.abs(x) < 0.02) & (y > 0.82))
            idx = np.where(leg)[0]
            Pn, Nn = remap_chain(P[idx], N[idx], ss[idx], seg[idx], C, T, smooth(-0.2, 0.05, ss[idx]))
            P[idx] = Pn; N[idx] = Nn
            limb[idx] = 1 if side > 0 else 2; s[idx] = ss[idx]; done[idx] = True
            joints['leg%+d' % side] = (C.round(3).tolist(), T.round(3).tolist())
        # skin colour regions don't matter for a textured body; heads are skin (0) so rain doesn't darken faces
        hv = np.concatenate([np.full(len(p['P']), 1.0 if p['head'] else 0.0) for p in parts])
        region = np.where(hv > 0, 0, 1)
        # uv into the atlas
        UVs = []
        for p in parts:
            uv = p['UV'].copy()
            src = Image.open(os.path.join(SRC, p['img'])).convert('RGB')
            if p['head']:
                cell = 256; col = k % 8; row = 8 + k // 8   # last 512 row = two rows of 256 tiles
                ox, oy = col * cell, row * cell
            else:
                cell = 512; ox, oy = (k % 4) * cell, (k // 4) * cell
            atlas.paste(src.resize((cell, cell), Image.LANCZOS), (ox, oy))
            # glTF uv (0,0) = top-left of the image; keep half a texel off the tile edges
            u = np.clip(uv[:, 0], 0.5 / cell, 1 - 0.5 / cell); v = np.clip(uv[:, 1], 0.5 / cell, 1 - 0.5 / cell)
            UVs.append(np.c_[(ox + u * cell) / AW, (oy + v * cell) / AH])
            if (uv.min() < -0.01) or (uv.max() > 1.01): print('  warning: uv outside 0..1 in', name, p['img'], uv.min(0), uv.max(0))
        UV = np.concatenate(UVs)
        I = np.concatenate([p['I'] + sum(len(q['P']) for q in parts[:pi]) for pi, p in enumerate(parts)])
        meta.append(dict(name=desc or name, female=sex == 'f', height=round(H, 3), skirt=bool(skirt), hem=None if hem is None else round(float(hem), 3),
                         vStart=vbase, vCount=len(P), iStart=ibase, iCount=len(I)))
        print('%-22s %s h %.2f m  verts %5d  tris %5d  arms %4d legs %4d skirt %s' % (name, sex, H, len(P), len(I) // 3, int(((limb == 3) | (limb == 4)).sum()), int(((limb == 1) | (limb == 2)).sum()), meta[-1]['hem']))
        out_P.append(P); out_N.append(N); out_UV.append(UV); out_S.append(np.c_[limb, s, region, np.zeros(len(P))]); out_I.append(I + 0)
        vbase += len(P); ibase += len(I)
    os.makedirs(OUT, exist_ok=True)
    P = np.concatenate(out_P).astype(np.float32); N = np.concatenate(out_N)
    Nq = np.c_[np.clip(np.round(N * 127), -127, 127), np.zeros(len(N))].astype(np.int8)
    UV = np.clip(np.round(np.concatenate(out_UV) * 65535), 0, 65535).astype(np.uint16)
    S = np.concatenate(out_S).astype(np.float32)
    I = np.concatenate(out_I).astype(np.uint16)
    blobs = [('position', P), ('normal', Nq), ('uv', UV), ('skin', S), ('index', I)]
    layout = {}; off = 0; data = b''
    for key, arr in blobs:
        b = arr.tobytes(); layout[key] = dict(offset=off, bytes=len(b)); data += b
        off += len(b); pad = (-off) % 4; data += b'\0' * pad; off += pad
    open(os.path.join(OUT, 'citizens.bin'), 'wb').write(data)
    json.dump(dict(source='Citizen NPC Pack 1 Character Lowpoly Mobile by 00amza (Sketchfab), CC-BY-4.0', vertices=int(vbase), indices=int(ibase),
                   layout=layout, atlas=[AW, AH], citizens=meta), open(os.path.join(OUT, 'citizens.json'), 'w'), indent=1)
    atlas.save(os.path.join(OUT, 'citizens.jpg'), quality=86, optimize=True)
    print('wrote', OUT, len(data) // 1024, 'KB +', os.path.getsize(os.path.join(OUT, 'citizens.jpg')) // 1024, 'KB atlas')

main()

#!/usr/bin/env python3
"""Retargets one of Cal's clips onto Leon's skeleton (both Tripo rigs with the same bone names, but each bone's
local axes differ between the two). Leon's own 'idle' looks half-seated, so he stands with Cal's 'standing_relax'.

For every bone, the clip's rotation is taken as a turn away from Cal's bind pose in world space and the same turn
is applied to Leon's bind pose (bind poses from the inverse bind matrices: both are T-poses):
  D(b, t) = Wcal(b, t) * Wcal_bind(b)^-1,   Wleon(b, t) = D(b, t) * Wleon_bind(b),   local = Wparent^-1 * W
The root's movement is carried over scaled by the two rigs' heights. Output is a three.js AnimationClip JSON.
usage: python3 tools/characters/retarget_idle.py www/characters/cal.glb www/characters/leon.glb standing_relax www/characters/leon_idle.json
"""
import json, struct, sys
import numpy as np

def glb(path):
    b = open(path, 'rb').read(); n = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + n]); off = 20 + n; m = struct.unpack_from('<I', b, off)[0]
    return j, b[off + 8: off + 8 + m]

def accessor(j, bin_, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    assert a['componentType'] == 5126, 'float accessors only'
    n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', 4 * n)
    out = np.empty((a['count'], n), np.float64)
    for k in range(a['count']): out[k] = struct.unpack_from('<%df' % n, bin_, start + k * stride)
    return out

def qmul(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
def qinv(q): return np.array([-q[0], -q[1], -q[2], q[3]]) / np.dot(q, q)
def qnorm(q): return q / np.linalg.norm(q)
def mat2q(m):
    m = m[:3, :3] / np.linalg.norm(m[:3, :3], axis=0)   # strip scale
    t = np.trace(m)
    if t > 0: s = np.sqrt(t + 1) * 2; q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, s / 4]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]: s = np.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; q = [s / 4, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]: s = np.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; q = [(m[0, 1] + m[1, 0]) / s, s / 4, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else: s = np.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, s / 4, (m[1, 0] - m[0, 1]) / s]
    return qnorm(np.array(q))
def slerp(a, b, t):
    d = np.dot(a, b)
    if d < 0: b = -b; d = -d
    if d > 0.9995: return qnorm(a + (b - a) * t)
    th = np.arccos(d); return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)

class Rig:
    def __init__(self, path):
        self.j, self.bin = glb(path); j = self.j
        self.names = [n.get('name') for n in j['nodes']]
        self.parent = {}
        for i, n in enumerate(j['nodes']):
            for c in n.get('children', []): self.parent[c] = i
        sk = j['skins'][0]; self.joints = sk['joints']
        ibm = accessor(j, self.bin, sk['inverseBindMatrices'])
        # bind pose world rotation of each joint (glTF matrices are column-major)
        self.bindW = {jt: mat2q(np.linalg.inv(ibm[k].reshape(4, 4).T)) for k, jt in enumerate(self.joints)}
        self.bindP = {jt: np.linalg.inv(ibm[k].reshape(4, 4).T)[:3, 3] for k, jt in enumerate(self.joints)}
        self.rest = {i: (np.array(n.get('rotation', [0, 0, 0, 1]), float), np.array(n.get('translation', [0, 0, 0]), float)) for i, n in enumerate(j['nodes'])}
    def idx(self, name): return self.names.index(name)
    def height(self):
        ys = [p[1] for p in self.bindP.values()]; return max(ys) - min(ys)
    def tracks(self, clip):
        an = next(a for a in self.j['animations'] if a['name'] == clip); out = {}
        for c in an['channels']:
            s = an['samplers'][c['sampler']]
            out[(c['target']['node'], c['target']['path'])] = (accessor(self.j, self.bin, s['input'])[:, 0], accessor(self.j, self.bin, s['output']))
        return out

def sample(track, t, rot):
    ts, vs = track
    if t <= ts[0]: return vs[0]
    if t >= ts[-1]: return vs[-1]
    k = np.searchsorted(ts, t) - 1; f = (t - ts[k]) / (ts[k + 1] - ts[k])
    return slerp(vs[k], vs[k + 1], f) if rot else vs[k] + (vs[k + 1] - vs[k]) * f

def main(src_path, dst_path, clip, out_path, fps=15):
    S, D = Rig(src_path), Rig(dst_path); T = S.tracks(clip)
    dur = max(ts[-1] for ts, _ in T.values())
    times = np.round(np.arange(0, dur + 1e-6, 1 / fps), 5)
    # the source's world rotation of every node at time t (rest where the clip has no track)
    def world_src(t):
        W = {}
        def w(i):
            if i in W: return W[i]
            r = T.get((i, 'rotation')); q = qnorm(sample(r, t, True)) if r else S.rest[i][0]
            W[i] = qmul(w(S.parent[i]), q) if i in S.parent else q; return W[i]
        for i in range(len(S.names)): w(i)
        return W
    by_name_src = {n: i for i, n in enumerate(S.names) if n}
    order = []
    def visit(i):
        order.append(i)
        for c in D.j['nodes'][i].get('children', []): visit(c)
    for r in D.j['scenes'][0]['nodes']: visit(r)
    hk = D.height() / S.height()
    root_name = 'BoneRoot'; sr, dr = S.idx(root_name), D.idx(root_name)
    rot_vals = {i: [] for i in D.joints}; pos_vals = []
    for t in times:
        Ws = world_src(t); Wd = {}
        for i in order:
            par = D.parent.get(i); Wp = Wd[par] if par is not None else np.array([0, 0, 0, 1.0])
            nm = D.names[i]; si = by_name_src.get(nm)
            if i in D.joints and si is not None and si in S.bindW:
                Wd[i] = qnorm(qmul(qmul(Ws[si], qinv(S.bindW[si])), D.bindW[i]))
                loc = qnorm(qmul(qinv(Wp), Wd[i]))
                if rot_vals[i] and np.dot(rot_vals[i][-1], loc) < 0: loc = -loc   # keep neighbours on one side for slerp
                rot_vals[i].append(loc)
            else:
                Wd[i] = qmul(Wp, D.rest[i][0])
                if i in D.joints: rot_vals[i].append(D.rest[i][0])
        tr = T.get((sr, 'translation'))
        dp = (sample(tr, t, False) - S.rest[sr][1]) if tr else np.zeros(3)
        pos_vals.append(D.rest[dr][1] + dp * hk)
    # a bone that hardly moves keeps one key (the whole clip at 15 fps would otherwise be 1.7 MB of JSON)
    def track(name, kind, vals, eps):
        vals = np.array(vals); still = np.max(np.abs(vals - vals[0])) < eps
        ts = [0.0] if still else times.tolist(); vs = vals[:1] if still else vals
        return {'name': name, 'type': kind, 'times': ts, 'values': [round(float(v), 4) for row in vs for v in row]}
    tracks = [track(D.names[i] + '.quaternion', 'quaternion', rot_vals[i], 2e-4) for i in D.joints if rot_vals[i]]
    tracks.append(track(root_name + '.position', 'vector', pos_vals, 1e-5))
    json.dump({'name': clip, 'duration': float(dur), 'tracks': tracks, 'uuid': 'leon-' + clip, 'blendMode': 2500}, open(out_path, 'w'), separators=(',', ':'))
    print(f'{clip}: {dur:.2f} s, {len(times)} frames, {len(tracks)} tracks, height ratio {hk:.3f} -> {out_path}')

if __name__ == '__main__': main(*sys.argv[1:5])

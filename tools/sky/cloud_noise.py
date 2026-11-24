"""Tileable 3D cloud noise for the volumetric sky (src/sky.js).

Writes www/assets/clouds/noise3d.bin: a 128^3 R8 base-shape volume, a 32^3 R8 detail volume and a
256^2 RGBA8 weather map, all tileable.
  shape  : Perlin-Worley (Perlin fBm dilated by Worley fBm), the low-frequency billows of a cloud
  detail : Worley fBm, used to erode the edges into wisps (bottoms) and cauliflower curls (tops)
  weather: r cumulus cells (clustered Worley blobs), g Perlin-Worley fBm at twice the frequency,
           b regional variation (low-frequency fBm), a cirrus (fBm stretched along x)
Run: python3 tools/sky/cloud_noise.py   (numpy only, ~1 min)
"""
import numpy as np, os, sys

def worley(n, cells, seed):
    """Tileable inverted-distance Worley noise (1 at feature points, 0 far away), n^3 voxels."""
    rng = np.random.default_rng(seed)
    pts = rng.random((cells, cells, cells, 3))
    ax = (np.arange(n) + 0.5) / n * cells
    out = np.empty((n, n, n), np.float32)
    for zi in range(n):
        z = ax[zi]
        X, Y = np.meshgrid(ax, ax, indexing='ij')           # x, y
        cx, cy, cz = np.floor(X).astype(int), np.floor(Y).astype(int), int(np.floor(z))
        best = np.full(X.shape, 9.0, np.float32)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    gx, gy, gz = cx + dx, cy + dy, cz + dz
                    p = pts[gx % cells, gy % cells, gz % cells]
                    ddx = gx + p[..., 0] - X; ddy = gy + p[..., 1] - Y; ddz = gz + p[..., 2] - z
                    best = np.minimum(best, ddx * ddx + ddy * ddy + ddz * ddz)
        out[:, :, zi] = 1 - np.clip(np.sqrt(best), 0, 1)
    return out

def perlin(n, period, seed):
    """Tileable 3D gradient noise in [-1, 1] approximately."""
    rng = np.random.default_rng(seed)
    g = rng.normal(size=(period, period, period, 3)); g /= np.linalg.norm(g, axis=-1, keepdims=True)
    ax = (np.arange(n) + 0.5) / n * period
    X, Y, Z = np.meshgrid(ax, ax, ax, indexing='ij')
    i0 = np.floor(X).astype(int); j0 = np.floor(Y).astype(int); k0 = np.floor(Z).astype(int)
    fx, fy, fz = X - i0, Y - j0, Z - k0
    fade = lambda t: t * t * t * (t * (t * 6 - 15) + 10)
    u, v, w = fade(fx), fade(fy), fade(fz)
    acc = 0
    for di in (0, 1):
        for dj in (0, 1):
            for dk in (0, 1):
                gr = g[(i0 + di) % period, (j0 + dj) % period, (k0 + dk) % period]
                d = gr[..., 0] * (fx - di) + gr[..., 1] * (fy - dj) + gr[..., 2] * (fz - dk)
                wgt = (u if di else 1 - u) * (v if dj else 1 - v) * (w if dk else 1 - w)
                acc = acc + d * wgt
    return acc.astype(np.float32)

def remap(x, a, b, c, d): return c + (x - a) / (b - a) * (d - c)

def shape(n=128):
    pf = sum(perlin(n, 4 << o, 11 + o) * 0.5 ** o for o in range(4)) / 1.875   # Perlin fBm
    pf = np.clip(pf * 0.5 + 0.5, 0, 1)
    w = [worley(n, c, 70 + c) for c in (4, 8, 16)]
    wf = w[0] * 0.625 + w[1] * 0.25 + w[2] * 0.125
    pw = np.clip(remap(pf, -(1 - wf), 1, 0, 1), 0, 1)                 # Perlin-Worley
    low = np.clip(remap(pw, wf - 1, 1, 0, 1), 0, 1)                   # billowy base shape
    low = (low - low.min()) / (low.max() - low.min())
    return low

def detail(n=32):
    w = [worley(n, c, 300 + c) for c in (2, 4, 8)]
    d = w[0] * 0.625 + w[1] * 0.25 + w[2] * 0.125
    return (d - d.min()) / (d.max() - d.min())

def worley2(n, cells, seed):
    rng = np.random.default_rng(seed); pts = rng.random((cells, cells, 2))
    ax = (np.arange(n) + 0.5) / n * cells
    X, Y = np.meshgrid(ax, ax, indexing='ij'); cx, cy = np.floor(X).astype(int), np.floor(Y).astype(int)
    best = np.full(X.shape, 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            gx, gy = cx + dx, cy + dy; p = pts[gx % cells, gy % cells]
            best = np.minimum(best, (gx + p[..., 0] - X) ** 2 + (gy + p[..., 1] - Y) ** 2)
    return np.sqrt(best)

def perlin2(n, px, py, seed):
    rng = np.random.default_rng(seed); a = rng.random((px, py)) * 2 * np.pi; g = np.stack([np.cos(a), np.sin(a)], -1)
    X, Y = np.meshgrid((np.arange(n) + 0.5) / n * px, (np.arange(n) + 0.5) / n * py, indexing='ij')
    i0, j0 = np.floor(X).astype(int), np.floor(Y).astype(int); fx, fy = X - i0, Y - j0
    fade = lambda t: t * t * t * (t * (t * 6 - 15) + 10); u, v = fade(fx), fade(fy); acc = 0
    for di in (0, 1):
        for dj in (0, 1):
            gr = g[(i0 + di) % px, (j0 + dj) % py]
            acc = acc + (gr[..., 0] * (fx - di) + gr[..., 1] * (fy - dj)) * (u if di else 1 - u) * (v if dj else 1 - v)
    return acc

def weather(n=256):
    norm = lambda a: (a - a.min()) / (a.max() - a.min())
    # cumulus cells: soft blobs around jittered points, two cell sizes, some cells suppressed
    c1 = np.clip(1 - worley2(n, 12, 5) * 1.25, 0, 1); c2 = np.clip(1 - worley2(n, 24, 6) * 1.3, 0, 1)
    cells = norm(np.maximum(c1, c2 * 0.8) * (0.6 + 0.4 * norm(perlin2(n, 6, 6, 9))))
    pf = sum(perlin2(n, 8 << o, 8 << o, 20 + o) * 0.5 ** o for o in range(4))
    wf = 1 - np.clip(worley2(n, 10, 31), 0, 1)
    pw = norm(np.clip(remap(norm(pf), -(1 - wf), 1, 0, 1), 0, 1))
    reg = norm(sum(perlin2(n, 2 << o, 2 << o, 40 + o) * 0.5 ** o for o in range(3)))
    cir = norm(sum(perlin2(n, 2 << o, 16 << o, 60 + o) * 0.55 ** o for o in range(4)))
    return np.stack([cells, pw, reg, cir], -1)

if __name__ == '__main__':
    root = os.path.join(os.path.dirname(__file__), '..', '..')
    out = os.path.join(root, 'www', 'assets', 'clouds'); os.makedirs(out, exist_ok=True)
    s = shape(); d = detail()
    print('shape mean %.3f p10 %.3f p90 %.3f' % (s.mean(), np.percentile(s, 10), np.percentile(s, 90)))
    print('detail mean %.3f' % d.mean())
    # texture layout: x fastest, then y, then z (WebGL/WebGPU 3D texture order)
    w = weather()
    for i, nm in enumerate('cells pw regional cirrus'.split()): print('weather', nm, 'mean %.3f' % w[..., i].mean())
    blob = np.concatenate([(np.transpose(s, (2, 1, 0)) * 255 + 0.5).astype(np.uint8).ravel(),
                           (np.transpose(d, (2, 1, 0)) * 255 + 0.5).astype(np.uint8).ravel(),
                           (np.transpose(w, (1, 0, 2)) * 255 + 0.5).astype(np.uint8).ravel()])
    blob.tofile(os.path.join(out, 'noise3d.bin'))
    print('wrote', os.path.join(out, 'noise3d.bin'), blob.size, 'bytes')

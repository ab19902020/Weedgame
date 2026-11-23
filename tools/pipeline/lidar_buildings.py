"""Measure every building's height and roof from Environment Agency LIDAR and patch the world tiles.

Sources (Open Government Licence v3.0, "Contains public sector information licensed under the Open
Government Licence v3.0. (c) Environment Agency copyright and/or database right."):
  * LIDAR Composite DSM, last return, 1 m  (roofs; last return sees through more tree canopy)
  * LIDAR Composite DTM, 1 m               (ground under each building)
fetched through the EA public WCS in 1 km blocks (+40 m margin), processed and discarded.

For each OSM footprint in www/world/tiles/*.bin (outer ring minus courtyards, eroded 1 m so wall
edges don't mix in), with nDSM = DSM - DTM:
  * flat roof if the inner spread p90-p25 < 0.9 m: wall = p75, no pitched roof
  * otherwise pitched: ridge = p97, eaves (wall top) = p12 - 0.3, roof height = ridge - eaves;
    ridge direction from the principal axis of the top 0.35 m band; hip vs gable from how much of
    the roof rectangle's length that band covers; the roof rectangle is turned 90 deg when the
    measured ridge runs across it, and created from the footprint's oriented box when OSM had none
  * storeys re-derived from the measured wall height
Buildings with too few clean pixels, no LIDAR, hand-modelled landmarks and canopies are left as they
were. The 16th record field (height source) becomes 3 = LIDAR.

Usage: python3 tools/pipeline/lidar_buildings.py www/world [--only E0,N0] [--threads 6]
Writes docs/lidar-buildings.json (counts and comparisons) next to the repo docs.
"""
import sys, os, io, json, math, struct, zlib, time, argparse, concurrent.futures, urllib.request
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import E0, N0, K, TILE

UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) wcs-client'}
DSM = ('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-last-return-dsm-1m/wcs'
       '?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=9ba4d5ac-d596-445a-9056-dae3ddec0178__Lidar_Composite_Elevation_LZ_DSM_1m'
       '&format=image/tiff&subset=E({e0},{e1})&subset=N({n0},{n1})')
DTM = ('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs'
       '?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m'
       '&format=image/tiff&subset=E({e0},{e1})&subset=N({n0},{n1})')
BLOCK, MARGIN, NM = 1000, 40, 16
TYPES = {'f4': np.float32, 'i2': np.int16, 'u2': np.uint16, 'u1': np.uint8, 'i4': np.int32, 'u4': np.uint32, 'i1': np.int8}
CODES = {np.dtype(v): k for k, v in TYPES.items()}

def read_tile(path):
    raw = zlib.decompress(open(path, 'rb').read())
    assert raw[:4] == b'GCT1'
    hl = struct.unpack('<I', raw[4:8])[0]
    hdr = json.loads(raw[8:8 + hl]); base = 8 + hl
    arrays = {k: np.frombuffer(raw, TYPES[t], n, base + off).copy() for k, (t, off, n) in hdr['arrays'].items()}
    return hdr, arrays

def write_tile(path, hdr, arrays):
    meta = {k: v for k, v in hdr.items() if k != 'arrays'}
    h = {'arrays': {}, **meta}; blobs, off = [], 0
    for k, a in arrays.items():
        a = np.ascontiguousarray(a); b = a.tobytes()
        h['arrays'][k] = [CODES[a.dtype], off, int(a.size)]
        blobs.append(b); pad = (-len(b)) % 8; blobs.append(b'\0' * pad); off += len(b) + pad
    hj = json.dumps(h, separators=(',', ':'), ensure_ascii=False).encode()
    hj += b' ' * ((-(len(hj) + 8)) % 8)
    data = b'GCT1' + struct.pack('<I', len(hj)) + hj + b''.join(blobs)
    tmp = path + '.tmp'; open(tmp, 'wb').write(zlib.compress(data, 9)); os.replace(tmp, path)

def fetch(url):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                a = np.array(Image.open(io.BytesIO(r.read())), np.float32)
            a[(a < -100) | (a > 1000)] = np.nan
            return a
        except Exception as ex:
            err = ex; time.sleep(2 + attempt * 3)
    raise RuntimeError(f'{url[:120]}: {err}')

def obb(pts):
    c = pts.mean(0); q = pts - c
    best = None
    for k in range(len(pts)):
        d = pts[(k + 1) % len(pts)] - pts[k]; L = math.hypot(*d)
        if L < 0.5: continue
        u = d / L; v = np.array([-u[1], u[0]])
        a, b = q @ u, q @ v
        area = (a.max() - a.min()) * (b.max() - b.min())
        if best is None or area < best[0]:
            best = (area, math.atan2(u[1], u[0]), a.min(), a.max(), b.min(), b.max(), u, v)
    if best is None: return None
    _, ang, a0, a1, b0, b1, u, v = best
    cx, cz = c + u * (a0 + a1) / 2 + v * (b0 + b1) / 2
    L, W = a1 - a0, b1 - b0
    return (cx, cz, ang, L, W) if L >= W else (cx, cz, ang + math.pi / 2, W, L)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('world'); ap.add_argument('--only'); ap.add_argument('--threads', type=int, default=6)
    ap.add_argument('--dry', action='store_true'); args = ap.parse_args()
    tdir = os.path.join(args.world, 'tiles')
    tiles, blds = {}, []
    for fn in sorted(os.listdir(tdir)):
        if not fn.endswith('.bin'): continue
        hdr, A = read_tile(os.path.join(tdir, fn))
        if 'bM' not in A or A['bM'].size == 0: continue
        tiles[fn] = (hdr, A)
        ox, oz = hdr['ix'] * TILE, hdr['iz'] * TILE
        M = A['bM'].reshape(-1, NM); P, R, C = A['bP'], A['bR'], A['bC'].reshape(-1, 2) / 10.0
        ci = ri = 0
        for bi in range(len(P)):
            rings = []
            for _ in range(int(P[bi])):
                n = int(R[ri]); ri += 1
                rings.append(C[ci:ci + n] + [ox, oz]); ci += n
            if M[bi, 14] > 0.5 or int(M[bi, 10]) == 13: continue   # landmarks, canopies
            w = rings[0]
            E = w[:, 0] * K + E0; Nn = N0 - w[:, 1] * K
            blds.append((fn, bi, rings, float(E.mean()), float(Nn.mean())))
    print('tiles', len(tiles), 'buildings', len(blds), flush=True)
    by_block = {}
    for b in blds:
        key = (int(b[3] // BLOCK) * BLOCK, int(b[4] // BLOCK) * BLOCK)
        by_block.setdefault(key, []).append(b)
    keys = sorted(by_block)
    if args.only:
        e, n = map(int, args.only.split(',')); keys = [k for k in keys if k == (e // BLOCK * BLOCK, n // BLOCK * BLOCK)]
    S = dict(measured=0, skipped_few=0, skipped_nodata=0, no_building=0, flat=0, pitched=0, gable=0, hip=0, rotated=0, new_rect=0,
             to_flat=0, to_pitched=0, blocks=0, failed_blocks=0)
    dH = []          # measured top height minus previous model top height
    def job(k):
        e0, n0 = k; e1, n1 = e0 + BLOCK, n0 + BLOCK
        sub = dict(e0=e0 - MARGIN, e1=e1 + MARGIN, n0=n0 - MARGIN, n1=n1 + MARGIN)
        return k, fetch(DSM.format(**sub)), fetch(DTM.format(**sub))
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(args.threads) as ex:
        futs = [ex.submit(job, k) for k in keys]
        for f in concurrent.futures.as_completed(futs):
            try: k, dsm, dtm = f.result()
            except Exception as e:
                S['failed_blocks'] += 1; print('block failed', e, flush=True); continue
            S['blocks'] += 1
            e0, n0 = k[0] - MARGIN, k[1] - MARGIN; n1 = k[1] + BLOCK + MARGIN
            nd = dsm - dtm
            Hh, Ww = nd.shape
            for (fn, bi, rings, ce, cn) in by_block[k]:
                hdr, A = tiles[fn]; M = A['bM'].reshape(-1, NM); m = M[bi]
                # rasterise the footprint (outer ring minus courtyards) on the 1 m grid
                px = [np.stack([r[:, 0] * K + E0 - e0, n1 - (N0 - r[:, 1] * K)], 1) for r in rings]
                lo = np.floor(px[0].min(0)).astype(int) - 2; hi = np.ceil(px[0].max(0)).astype(int) + 2
                lo = np.maximum(lo, 0); hi = np.minimum(hi, [Ww, Hh])
                if (hi - lo).min() < 3: S['skipped_few'] += 1; continue
                img = Image.new('L', (int(hi[0] - lo[0]), int(hi[1] - lo[1])), 0); dr = ImageDraw.Draw(img)
                dr.polygon([tuple(p - lo) for p in px[0]], fill=1)
                for h in px[1:]: dr.polygon([tuple(p - lo) for p in h], fill=0)
                mask = np.array(img, bool)
                er = mask.copy(); er[1:] &= mask[:-1]; er[:-1] &= mask[1:]; er[:, 1:] &= mask[:, :-1]; er[:, :-1] &= mask[:, 1:]
                use = er if er.sum() >= 8 else mask
                win = nd[lo[1]:hi[1], lo[0]:hi[0]]
                v = win[use]; v = v[np.isfinite(v)]
                if v.size < 6: S['skipped_nodata' if np.isnan(win[use]).all() else 'skipped_few'] += 1; continue
                p12, p25, p75, p90, p97 = np.percentile(v, [12, 25, 75, 90, 97])
                if p90 < 1.6: S['no_building'] += 1; continue
                old_top = float(m[2] + (m[4] if m[3] > 0 else 0))
                ox, oz = hdr['ix'] * TILE, hdr['iz'] * TILE
                cls = int(m[10])
                if p90 - p25 < 0.9 or p97 > 60:
                    wall = float(max(2.2, p75)); S['flat'] += 1
                    if m[3] > 0: S['to_flat'] += 1
                    m[2] = round(wall, 2); m[3] = 0; m[4] = 0
                    new_top = wall
                else:
                    ridge = float(p97); wall = float(max(2.2, p12 - 0.3)); rh = max(0.8, ridge - wall)
                    if rh > 9: wall = max(2.2, ridge - 9); rh = ridge - wall
                    # ridge band -> direction (world x = E, z = -N)
                    rr, cc = np.nonzero(use & (win >= ridge - 0.35))
                    rect = None
                    if m[8] > 0: rect = [float(m[5] + ox), float(m[6] + oz), float(m[7]), float(m[8]), float(m[9])]
                    else:
                        o = obb(rings[0])
                        if o and o[4] <= 24 and o[3] >= 3: rect = list(o); S['new_rect'] += 1
                    gable = True
                    if rect and len(rr) >= 4:
                        wx = (cc + lo[0] + 0.5 + e0 - E0) / K; wz = -((n1 - (rr + lo[1] + 0.5)) - N0) / K
                        q = np.stack([wx - wx.mean(), wz - wz.mean()], 1)
                        ev, evec = np.linalg.eigh(q.T @ q / len(q))
                        if ev[1] > 2.5 * max(ev[0], 1e-3):
                            d = evec[:, 1]; ang = math.atan2(d[1], d[0])
                            if abs(math.cos(ang - rect[2])) < 0.5:
                                rect[2] += math.pi / 2; rect[3], rect[4] = rect[4], rect[3]; S['rotated'] += 1
                            ext = (q @ d).max() - (q @ d).min() + 1.0
                            gable = ext >= 0.72 * rect[3]
                        else:
                            gable = False          # square-ish ridge band: hipped / pyramidal
                    if rect and rect[4] <= 24:
                        if m[3] == 0: S['to_pitched'] += 1
                        m[3] = 1 if gable else 2; S['gable' if gable else 'hip'] += 1
                        m[5], m[6], m[7], m[8], m[9] = rect[0] - ox, rect[1] - oz, rect[2], rect[3], rect[4]
                        m[2] = round(wall, 2); m[4] = round(rh, 2); S['pitched'] += 1
                        new_top = wall + rh
                    else:
                        m[2] = round(float(max(2.2, p75)), 2); m[3] = 0; m[4] = 0; S['flat'] += 1; new_top = m[2]
                per = 2.75 if cls in (1, 2, 3) else 3.6 if cls in (6, 7, 10, 11) else 4.5 if cls == 8 else 3.0
                m[11] = max(1, round(float(m[2]) / per))
                m[15] = 3
                S['measured'] += 1; dH.append(new_top - old_top)
            print(f"block {k} done ({S['blocks']}/{len(keys)}), measured {S['measured']}, {time.time() - t0:.0f}s", flush=True)
    if not args.dry:
        for fn, (hdr, A) in tiles.items(): write_tile(os.path.join(tdir, fn), hdr, A)
    d = np.array(dH) if dH else np.zeros(1)
    S['top_change_m'] = dict(mean=round(float(d.mean()), 2), median=round(float(np.median(d)), 2), p10=round(float(np.percentile(d, 10)), 2),
                             p90=round(float(np.percentile(d, 90)), 2), mean_abs=round(float(np.abs(d).mean()), 2))
    S['buildings_total'] = len(blds); S['seconds'] = round(time.time() - t0)
    print(json.dumps(S, indent=1))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'docs', 'lidar-buildings.json')
    if not args.dry: json.dump(S, open(out, 'w'), indent=1)

if __name__ == '__main__':
    main()

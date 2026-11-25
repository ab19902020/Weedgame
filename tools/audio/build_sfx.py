"""Builds the world sound bank (www/sfx/world.ogg + src/worldCues.json + the credit list in www/sfx/CREDITS.txt) from
real recordings on Freesound: tyre squeal and skids, road roar, metal scrape, rain, wind, distant traffic, a British
police siren, UK pedestrian-crossing bleeps, and the impacts of knocked-down street furniture (lamp posts, pillar
boxes, bins, fences, trees, hedges, walls, glass). Nothing in the game is synthesised any more.

Every source is CC0 except two CC BY recordings, which are credited in CREDITS.txt. The previews Freesound serves
(high-quality Ogg) are fetched once into a cache directory.

Edits: excerpting, mono mix, resampling, band-limiting, gain (and levelling of one surging screech), fades, seamless loops (an equal-power crossfade of the
loop's tail into its head), layering of two recordings for a falling tree and a collapsing wall, and Ogg Vorbis
encoding.

  python3 tools/audio/build_sfx.py <cache dir> www/sfx/world.ogg src/worldCues.json
"""
import sys, os, re, json, subprocess, tempfile, html
import numpy as np

SR = 44100
CACHE, OUT_OGG, OUT_JSON = sys.argv[1], sys.argv[2], sys.argv[3]
UA = 'Mozilla/5.0 (X11; Linux x86_64) sfx-build'
os.makedirs(CACHE, exist_ok=True)

# ---------------------------------------------------------------- sources (Freesound id -> what it is)
SOURCES = {
    481668: 'old car tyre skid',                      104026: 'tyres squeaking',
    536769: 'tyre skid',                              614627: 'screeching tyres',
    521766: 'highway drive, interior',                385939: 'metal rail scrape',
    584945: 'rain',                                   123021: 'rain on a car, interior',
    478644: 'really windy',                           817192: 'wind through leaves',
    460114: 'suburban ambience with distant traffic', 706296: 'British police car siren',
    255849: 'UK pelican crossing, Hereford',          395610: 'UK pedestrian crossing',
    160087: 'metal lamp post hit',                    569555: 'metal impacts',
    406490: 'metal pipe hit 1',                       406489: 'metal pipe hit 2',
    400645: 'wood panel cracking and snapping',       400653: 'wood panel snap',
    369986: 'branches snapping',                      660471: 'branch crack',
    825422: 'dry bush 1',                             825423: 'dry bush 2',
    540278: 'tree shake',                             770112: 'plants and ferns',
    648723: 'plastic bin hits',                       91040: 'bin hit',
    848472: 'debris smash',                           569501: 'stone rubble 5',
    569503: 'stone rubble 7',                         569504: 'stone rubble 8',
    566446: 'glass break 3',                          566448: 'glass break 1',
    848312: 'glass smash',
}

def curl(url, dest=None):
    a = ['curl', '-sfL', '--retry', '4', '--max-time', '240', '-A', UA, url] + (['-o', dest] if dest else [])
    r = subprocess.run(a, capture_output=True)
    if r.returncode: raise RuntimeError(f'{url}: curl exit {r.returncode}')
    return r.stdout

META = os.path.join(CACHE, 'meta.json')
meta = json.load(open(META)) if os.path.exists(META) else {}
def fetch(i):
    k, f = str(i), os.path.join(CACHE, f'{i}.ogg')
    if k in meta and os.path.exists(f): return f
    t = curl(f'https://freesound.org/s/{i}/').decode('utf8', 'replace')
    pv = re.search(r'https://cdn\.freesound\.org/previews/\d+/' + k + r'_\d+-[hl]q\.ogg', t)
    title = re.search(r'<meta property="og:title" content="([^"]*)"', t)
    user = re.search(r'/people/([^/"]+)/sounds/' + k, t)
    lic = re.search(r'(https?://creativecommons\.org/(?:licenses|publicdomain)/[^"\']+)', t)
    curl(pv.group(0).replace('-lq', '-hq'), f)
    meta[k] = {'title': html.unescape(title.group(1)).rsplit(' by ', 1)[0] if title else '', 'author': html.unescape(user.group(1)) if user else '',
               'licence': lic.group(1) if lic else '', 'page': f'https://freesound.org/s/{i}/'}
    json.dump(meta, open(META, 'w'), indent=1)
    return f

_cache = {}
def load(i):
    if i not in _cache:
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', fetch(i), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
        _cache[i] = np.frombuffer(raw, np.float32).astype(np.float64)
    return _cache[i]

# ---------------------------------------------------------------- helpers
def seg(x, a, d): return x[int(a * SR):int((a + d) * SR)].copy()
def band(x, lo=None, hi=None):
    s = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    if lo: s *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** 4)
    if hi: s *= 1 / np.sqrt(1 + (f / hi) ** 4)
    return np.fft.irfft(s, len(x))
def db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
def peak(x, p=0.9): return x / (np.abs(x).max() + 1e-12) * p
def rms(x, target=-20.0): return x * 10 ** ((target - db(x)) / 20)
def fades(x, i=0.004, o=0.08):
    n, m = max(1, int(i * SR)), max(1, int(o * SR)); x[:n] *= np.linspace(0, 1, n); x[-m:] *= np.cos(np.linspace(0, np.pi / 2, m)) ** 2; return x
def steady(x, length, lo=0.0, hi=None, frame=0.1):
    """start of the steadiest window (least level variation) among the louder half of the recording"""
    hi = hi or len(x) / SR
    n = int(frame * SR); fr = x[int(lo * SR):int(hi * SR)]; m = len(fr) // n
    lv = 20 * np.log10(np.sqrt((fr[:m * n].reshape(m, n) ** 2).mean(1)) + 1e-12)
    w = int(length / frame); best, at = 1e9, 0
    med = np.median([lv[k:k + w].mean() for k in range(0, m - w)])
    for k in range(0, m - w - 1):
        c = lv[k:k + w]
        if c.mean() < med - 1: continue
        s = c.std()
        if s < best: best, at = s, k
    return lo + at * frame
def flatten(x, win=0.3):
    """even out slow swells in level (a sliding-window gain), keeping the texture: for recordings that surge"""
    n = int(win * SR); env = np.sqrt(np.convolve(x ** 2, np.hanning(n) / np.hanning(n).sum(), 'same')) + 1e-4
    return x / env * np.sqrt(np.mean(x ** 2))
def loop(x, a, length, xf):
    """a seamless loop: the material after the loop end is crossfaded (equal power) over the loop's head"""
    y = seg(x, a, length + xf); L, X = int(length * SR), int(xf * SR)
    body = y[:L].copy()
    t = np.linspace(0, np.pi / 2, X)
    body[:X] = body[:X] * np.sin(t) + y[L:L + X] * np.cos(t)
    return body
def onset(x, a, d, thresh=-24):
    """trim to the first transient: from a few ms before the level first comes within `thresh` dB of the peak"""
    y = seg(x, a, d); n = int(0.002 * SR); m = len(y) // n
    lv = 20 * np.log10(np.sqrt((y[:m * n].reshape(m, n) ** 2).mean(1)) + 1e-12)
    k = int(np.argmax(lv > lv.max() + thresh)); return y[max(0, k * n - 3 * n):]
def tail(y, floor=-50):
    """cut the decay where it falls `floor` dB below the peak level"""
    n = int(0.01 * SR); m = len(y) // n
    lv = 20 * np.log10(np.sqrt((y[:m * n].reshape(m, n) ** 2).mean(1)) + 1e-12)
    above = np.nonzero(lv > lv.max() + floor)[0]
    return y[:min(len(y), (above[-1] + 2) * n)] if len(above) else y
def shot(i, a, d, lo=None, hi=None, p=0.9, floor=-50):
    y = tail(onset(band(load(i), lo, hi) if (lo or hi) else load(i), a, d), floor)
    return fades(peak(y, p), 0.002, min(0.25, len(y) / SR * 0.3))
def mix(*layers):
    n = max(int(o * SR) + len(y) for y, o in layers); out = np.zeros(n)
    for y, o in layers: out[int(o * SR):int(o * SR) + len(y)] += y
    return out

# ---------------------------------------------------------------- the bank
loops, shots = {}, {}
# tyres: a steady squeal for slides and locked wheels, a heavier screech for big drifts, skid starts
sq = load(481668); a = steady(sq, 2.2, 2.6, 5.4, 0.05); loops['squeal'] = rms(band(loop(sq, a, 2.2, 0.2), 300, 9000), -18)
sc = load(614627); a = steady(sc, 3.0, 0, 60); loops['screech'] = rms(band(loop(flatten(seg(sc, a - 0.5, 4.3)), 0.5, 3.0, 0.3), 300, 10000), -18)
shots['skid'] = [shot(104026, 0, 1.6), shot(536769, 0.05, 1.6)]
# road roar under the car (tyres on asphalt), metal scraping along a wall or barrier
rd = load(521766); a = steady(rd, 6, 4, 46); loops['road'] = rms(band(loop(rd, a, 6, 0.6), 45, 6000), -20)
loops['scrape'] = rms(band(loop(load(385939), 0.15, 3.6, 0.4), 150), -18)
# weather: rain in the open, rain drumming on a car, wind, wind in leaves, a distant traffic bed
rn = load(584945); a = steady(rn, 8, 0, 70); loops['rain'] = rms(band(loop(rn, a, 8, 1.0), 120), -20)
rr = load(123021); a = steady(rr, 8, 20, 300); loops['rainroof'] = rms(band(loop(rr, a, 8, 1.0), 60), -20)
wd = load(478644); a = steady(wd, 10, 5, 300); loops['wind'] = rms(band(loop(wd, a, 10, 1.5), 40, 5000), -20)
loops['leaves'] = rms(band(loop(load(817192), 10, 10, 1.2), 300), -20)
tf = load(460114); a = steady(tf, 12, 2, 110); loops['traffic'] = rms(band(loop(tf, a, 12, 1.5), 40), -20)
# British police siren: two whole cycles of its sweep (period measured from the recording, 9.26 s)
loops['siren'] = rms(band(loop(load(706296), 1.0, 9.26, 0.06), 300, 7000), -16)
# UK crossing bleeps: four bleeps of a pelican crossing in Hereford (0.1845 s period) and nine of a newer crossing
loops['crossing'] = rms(band(loop(load(255849), 0.17, 0.738, 0.012), 1500), -16)
loops['crossing2'] = rms(band(loop(load(395610), 3.093, 2.330, 0.02), 1500), -16)
# knocked-down street furniture
shots['lamp'] = [shot(160087, 0, 0.44), shot(569555, 26.66, 1.6), shot(569555, 23.45, 1.8)]
shots['clang'] = [shot(406490, 0, 3.0), shot(406489, 0, 3.0)]
shots['iron'] = [shot(569555, 38.13, 0.8), shot(569555, 33.68, 0.9)]
shots['can'] = [shot(569555, 8.54, 0.6), shot(569555, 13.78, 0.6), shot(569555, 16.18, 0.65)]
shots['wood'] = [shot(400645, 72.09, 0.5), shot(400645, 71.81, 0.3), shot(400653, 0.13, 0.5), shot(400645, 68.13, 0.4)]
shots['pole'] = [shot(660471, 2.2, 1.9, floor=-45), shot(400645, 69.95, 2.6, floor=-45)]
shots['tree'] = [shot(369986, 7.62, 0.6), shot(660471, 3.2, 1.0)]
shots['treefall'] = [fades(peak(mix((onset(load(400645), 67.9, 4.6), 0), (0.6 * peak(load(540278)), 3.5), (0.5 * peak(load(825422)), 3.9))), 0.002, 0.3)]
shots['leaves'] = [shot(825422, 0, 1.0), shot(825423, 0, 1.3), shot(540278, 0, 1.25), shot(770112, 11.9, 0.7)]
shots['bin'] = [shot(648723, 12.75, 1.0), shot(648723, 9.65, 1.2), shot(648723, 2.6, 1.3), shot(91040, 1.8, 0.35)]
shots['thud'] = [shot(569504, 0, 1.0), shot(569503, 0, 1.0), shot(569501, 0, 1.0)]
shots['brick'] = [shot(848472, 0, 2.2), fades(peak(mix((onset(load(569501), 0, 1), 0), (onset(load(569503), 0, 1), 0.11), (onset(load(569504), 0, 1), 0.27), (0.7 * onset(load(848472), 1.85, 0.9), 0.35))), 0.002, 0.2)]
shots['glass'] = [shot(566446, 0.04, 0.7), shot(566448, 0.29, 0.9), shot(848312, 0.22, 1.3)]

# ---------------------------------------------------------------- write
parts, cues, t, gap = [], {'loops': {}, 'shots': {}}, 0.0, 0.08
def put(x):
    global t
    x = np.clip(x, -0.99, 0.99).astype(np.float32); start = t
    parts.append(x); parts.append(np.zeros(int(gap * SR), np.float32)); t += len(x) / SR + gap
    return [round(start, 5), round(len(x) / SR, 5)]
for k, x in loops.items(): cues['loops'][k] = put(x)
for k, xs in shots.items(): cues['shots'][k] = [put(x) for x in xs]
bank = np.concatenate(parts)
with tempfile.TemporaryDirectory() as d:
    w = os.path.join(d, 'bank.f32'); bank.tofile(w)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', w, '-c:a', 'libvorbis', '-q:a', '4', OUT_OGG], check=True)
json.dump(cues, open(OUT_JSON, 'w'), indent=1)
used = sorted(SOURCES)
credits = ['', 'World sound bank (world.ogg): tyres, road, scrape, weather, traffic, siren, crossing bleeps and street-furniture impacts.',
           'Game edits: excerpting, mono mix, resampling, band-limiting, gain, fades, seamless loop crossfades, layering and Ogg Vorbis encoding (tools/audio/build_sfx.py).', '']
for i in used:
    m = meta[str(i)]; lic = m['licence']
    name = 'CC0' if 'zero' in lic else 'CC BY ' + re.search(r'/by/([\d.]+)', lic).group(1) if '/by/' in lic else lic
    credits.append(f"{m['title']} — {m['author']}, {name}\n{m['page']}" + (f'\n{lic}' if '/by/' in lic else ''))
open(os.path.join(CACHE, 'credits.txt'), 'w').write('\n\n'.join(credits) + '\n')
print(f'{len(bank) / SR:.1f} s bank, {os.path.getsize(OUT_OGG) / 1e6:.2f} MB; loops', {k: v[1] for k, v in cues['loops'].items()})
print('shots', {k: len(v) for k, v in cues['shots'].items()})

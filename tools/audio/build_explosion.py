"""Builds the explosion sound bank (www/sfx/explosion.ogg + src/explosionCues.json) from real recordings: single blasts
cut from Fg2's field recordings of the explosions at the Toshogu Spring Festival in Nikko (Wikimedia Commons, public
domain). audio.js plays them pitched down (a fuel tank going up is a deep whump, not a crack), layered with a
low-passed copy of itself for the body of it, delayed and dulled with distance.

Edits: excerpting, mono mix, high-pass, levelling, fades, Ogg Vorbis encoding. src/explosionCues.json gives each cue's
[start, length] in seconds.

  python3 tools/audio/build_explosion.py <cache dir> www/sfx/explosion.ogg src/explosionCues.json
"""
import sys, os, json, subprocess, time
import numpy as np

SR = 44100
CACHE, OUT_OGG, OUT_JSON = sys.argv[1], sys.argv[2], sys.argv[3]
UA = 'GreenCountyGame/0.47 (sound bank build)'
os.makedirs(CACHE, exist_ok=True)

BASE = 'https://upload.wikimedia.org/wikipedia/commons/'
SRC = {
    'Explosion-LS100155.ogg': 'b/b9/Explosion-LS100155.ogg',
    'Explosions-LS100150.ogg': '1/19/Explosions-LS100150.ogg',
    'Explosions-LS100152.ogg': 'e/e9/Explosions-LS100152.ogg',
    'Explosions-LS100155.ogg': '3/31/Explosions-LS100155.ogg',
}
# the blasts: (file, onset, end) in seconds; each runs on to just short of the next one, keeping its echo
CUTS = [
    ('Explosion-LS100155.ogg', 0.57, 1.57),
    ('Explosions-LS100152.ogg', 0.58, 1.54),
    ('Explosions-LS100152.ogg', 1.54, 2.69),
    ('Explosions-LS100155.ogg', 1.18, 2.30),
    ('Explosions-LS100155.ogg', 2.30, 3.45),
    ('Explosions-LS100150.ogg', 2.22, 3.60),
]

def load(name):
    f = os.path.join(CACHE, name)
    if not os.path.exists(f) or os.path.getsize(f) < 10000:
        for attempt in range(5):
            r = subprocess.run(['curl', '-sfL', '--max-time', '120', '-A', UA, BASE + SRC[name], '-o', f])
            if r.returncode == 0 and os.path.getsize(f) > 10000: break
            time.sleep(8 * (attempt + 1))
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', f, '-ac', '1', '-ar', str(SR), '-af', 'highpass=f=25', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)

def cut(x, a, b):
    s = x[int(a * SR):int(b * SR)].copy()
    n_in, n_out = int(0.002 * SR), int(0.3 * SR)
    s[:n_in] *= np.linspace(0, 1, n_in)
    s[-n_out:] *= np.linspace(1, 0, n_out) ** 2
    return s * (10 ** (-1 / 20) / (np.abs(s).max() + 1e-12))

X = {n: load(n) for n in SRC}
parts, cues, pos = [], {'blasts': []}, 0.0
GAP = np.zeros(int(0.1 * SR))
for name, a, b in CUTS:
    s = cut(X[name], a, b)
    cues['blasts'].append([round(pos, 4), round(len(s) / SR, 4)])
    parts += [s, GAP]; pos += (len(s) + len(GAP)) / SR
y = np.concatenate(parts).astype(np.float32)
wav = OUT_OGG + '.wav.f32'
y.tofile(wav)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', wav, '-c:a', 'libvorbis', '-q:a', '5', OUT_OGG], check=True)
os.remove(wav)
json.dump(cues, open(OUT_JSON, 'w'), indent=1)
print(OUT_OGG, os.path.getsize(OUT_OGG), 'bytes;', len(cues['blasts']), 'blasts')

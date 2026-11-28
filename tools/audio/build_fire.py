"""Builds the fire loop (www/sfx/fire.ogg) from a real recording: the crackle of a coke-and-wood fire in a forge
("Fire of the forge", Work With Sounds / La Fonderie, Wikimedia Commons, CC BY 4.0). audio.js loops it at the nearest
big fire, with a copy an octave down and low-passed under it for the roar of a car well alight.

Edits: the steadiest stretch of crackle picked (no hammer blows or tool clanks: the loudest short peaks are kept out),
mono, high-passed, the loudest pops softened, levelled, crossfaded into a seamless loop, Ogg Vorbis.

  python3 tools/audio/build_fire.py <cache dir> www/sfx/fire.ogg
"""
import sys, os, subprocess, time
import numpy as np

SR = 44100
CACHE, OUT = sys.argv[1], sys.argv[2]
UA = 'GreenCountyGame/0.47 (sound bank build)'
URL = 'https://upload.wikimedia.org/wikipedia/commons/0/01/WWS_Fireoftheforge.ogg'
LOOP, XF = 9.0, 0.6   # seconds

f = os.path.join(CACHE, 'WWS_Fireoftheforge.ogg')
if not os.path.exists(f) or os.path.getsize(f) < 20000:
    for attempt in range(6):
        subprocess.run(['curl', '-sfL', '--max-time', '120', '-A', UA, URL, '-o', f])
        if os.path.exists(f) and os.path.getsize(f) > 20000: break
        time.sleep(30 * (attempt + 1))
raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', f, '-ac', '1', '-ar', str(SR), '-af', 'highpass=f=60,lowpass=f=12000', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
x = np.frombuffer(raw, np.float32).astype(np.float64)
# 50 ms windows: loudness, and the peak against it (a hammer blow or a clank is a peak far above the crackle)
w = int(0.05 * SR); n = len(x) // w
rms = np.array([np.sqrt((x[i * w:(i + 1) * w] ** 2).mean()) + 1e-9 for i in range(n)])
pk = np.array([np.abs(x[i * w:(i + 1) * w]).max() for i in range(n)])
need = int((LOOP + XF) / 0.05)
med = np.median(rms)
best, bi = 1e9, 0
for i in range(0, n - need, 2):
    r, p = rms[i:i + need], pk[i:i + need]
    if r.mean() < 0.7 * med: continue                          # (not a quiet gap)
    score = r.std() / med + 0.6 * p.max() / (med * 10)          # steady, and no big blow or clank in it
    if score < best: best, bi = score, i
a = bi * w
s = x[a:a + int((LOOP + XF) * SR)].copy()
L, K = int(LOOP * SR), int(XF * SR)
t = np.linspace(0, 1, K)
s[:K] = s[:K] * np.sin(t * np.pi / 2) + s[L:L + K] * np.cos(t * np.pi / 2)   # the tail crossfaded into the head
s = s[:L]
# the odd pop far above the crackle softened (tanh), so the fire holds its level instead of being a whisper with spikes
lim = 5 * np.sqrt((s ** 2).mean()); s = np.tanh(s / lim) * lim
s *= 10 ** (-21 / 20) / (np.sqrt((s ** 2).mean()) + 1e-12)
s *= min(1, 10 ** (-1.5 / 20) / (np.abs(s).max() + 1e-12))
tmp = OUT + '.f32'; s.astype(np.float32).tofile(tmp)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', tmp, '-c:a', 'libvorbis', '-q:a', '4', OUT], check=True)
os.remove(tmp)
print(OUT, os.path.getsize(OUT), 'bytes; loop from %.2f s of %.1f s (score %.3f)' % (a / SR, len(x) / SR, best))

"""Builds the Range Rover engine sound bank (www/sfx/rangerover.ogg + src/rangeroverCues.json) from CC0
recordings on Freesound:

  610774 "Crown Victoria Startup and idle" by Therancher01 (Ford 4.6 V8), CC0 1.0
         - start-up (0.0-3.3 s) used as is
         - idle (17.0-20.2 s, firing frequency 68.5 Hz, about 1,030 rpm) is the source of every rpm loop
  505321 "S63 AMG V8 Engine Revs" by marcelweiss, CC0 1.0 - a short blip used for throttle stabs

Each rpm loop is made by pitch-synchronous overlap-add from the real idle: individual firing pulses are
cut out (Hann grains centred on each pulse) and laid down again at the firing interval for that rpm, in
their original order, so the exhaust tone and the V8's uneven beat survive at every speed instead of the
chipmunk sound of simply speeding a recording up. Every loop is periodic (whole grain sequence), so it loops
seamlessly. The game crossfades the two nearest loops and fine-tunes their rate (src/audio.js).

  python3 tools/vehicles/engine_bank.py 610774.mp3 505321.mp3 www/sfx/rangerover.ogg src/rangeroverCues.json
"""
import sys, json, subprocess, tempfile, os
import numpy as np

SR = 44100
def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

crown, s63 = load(sys.argv[1]), load(sys.argv[2])
out_ogg, out_json = sys.argv[3], sys.argv[4]

def seg(x, a, b): return x[int(a * SR):int(b * SR)].copy()
def fade(x, i=0.01, o=0.05):
    n, m = int(i * SR), int(o * SR); x[:n] *= np.linspace(0, 1, n); x[-m:] *= np.linspace(1, 0, m); return x
def norm(x, peak=0.9): return x / (np.max(np.abs(x)) + 1e-9) * peak

# --- firing epochs in the idle: band-limited energy peaks one firing interval apart
idle = seg(crown, 17.0, 20.2)
f0 = 68.5
T0 = SR / f0
spec = np.fft.rfft(idle); fr = np.fft.rfftfreq(len(idle), 1 / SR)
env = np.fft.irfft(spec * ((fr > 30) & (fr < 400)), len(idle))
env = np.convolve(np.abs(env), np.hanning(int(T0 * 0.5)), 'same')
epochs, i = [], int(np.argmax(env[:int(T0)]))
while i < len(idle) - T0:
    epochs.append(i)
    lo, hi = int(i + T0 * 0.8), int(i + T0 * 1.2)
    i = lo + int(np.argmax(env[lo:hi]))
epochs = epochs[1:-1]
# keep a whole number of engine cycles (8 firings) so the beat pattern repeats cleanly
epochs = epochs[:len(epochs) // 8 * 8]
G = int(T0)                                   # half-width of a grain: one source firing interval
grains = [idle[e - G:e + G] * np.hanning(2 * G) for e in epochs]
print(f'{len(grains)} firing grains, source firing {f0} Hz (~{f0 * 15:.0f} rpm)')

def rpm_loop(rpm):
    f = rpm / 60 * 4                          # V8: four firings per crank revolution
    step = SR / f
    n = len(grains); L = int(round(n * step))
    out = np.zeros(L + 4 * G)
    for k in range(n):
        g = grains[k]
        # shorter grains at high rpm keep the pulses distinct (less comb-filter buzz)
        w = min(len(g), max(int(step * 2.2), 64))
        c = (len(g) - w) // 2; g = g[c:c + w] * np.hanning(w)
        p = int(round(k * step)) - w // 2 + 2 * G
        out[p:p + w] += g
    # wrap the tail onto the head so the loop is seamless
    body = out[2 * G:2 * G + L].copy(); body[:2 * G] += out[2 * G + L:4 * G + L]; body[-2 * G:] += out[:2 * G]
    return norm(body, 0.8)

cues, parts, t = {}, [], 0.0
def add(name, x, gap=0.05):
    global t
    parts.append(x.astype(np.float32)); cues[name] = [round(t, 5), round(len(x) / SR, 5)]
    parts.append(np.zeros(int(gap * SR), np.float32)); t += len(x) / SR + gap
add('start', norm(fade(seg(crown, 0.0, 3.3), 0.002, 0.25), 0.9))
for rpm in (800, 1300, 2000, 3000, 4200, 5600):
    add(f'r{rpm}', rpm_loop(rpm))
# throttle blip from the S63 recording (the first rev)
add('blip', norm(fade(seg(s63, 0.35, 1.6), 0.005, 0.2), 0.8))
bank = np.concatenate(parts)
with tempfile.TemporaryDirectory() as d:
    w = os.path.join(d, 'bank.f32')
    bank.tofile(w)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', w, '-c:a', 'libvorbis', '-q:a', '5', out_ogg], check=True)
json.dump({'rpm': [800, 1300, 2000, 3000, 4200, 5600], 'cues': cues}, open(out_json, 'w'), indent=1)
print('cues', cues)

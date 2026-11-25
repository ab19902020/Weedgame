"""Builds the four-cylinder engine sound bank (www/sfx/inline4.ogg + src/inline4Cues.json) for every car that is not
a V8 (hatchbacks, saloons, estates, SUVs, vans, police cars), from CC0 recordings of a Peugeot 308 on Freesound
by Nox_Sound:

  522225 "Vehicle_Car_Peugeot_308_Idle_Exterior_Loop_Mono_02" - the idle (2.0-7.0 s, firing frequency 24.85 Hz,
         about 745 rpm) is the source of every rpm loop
  522221 "Vehicle_Car_Peugeot_308_Acceleration_Idle_Mono" - a real throttle blip from idle (0.9-4.6 s)

Same method as the Range Rover V8 bank (engine_bank.py): the firing pulses of the real idle are cut out (Hann
grains centred on each pulse) and laid down again at the firing interval for each rpm, in their original order,
whole engine cycles at a time, so the exhaust note and the four-cylinder's half-order beat survive at every speed.
Each loop is periodic, so it loops seamlessly; the game crossfades the two nearest and fine-tunes their rate.

  python3 tools/vehicles/engine_bank_i4.py 522225.ogg 522221.ogg www/sfx/inline4.ogg src/inline4Cues.json
"""
import sys, json, subprocess, tempfile, os
import numpy as np

SR = 44100
RPMS = (800, 1300, 2000, 3000, 4200, 5600, 7200)
def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

idle_src, accel = load(sys.argv[1]), load(sys.argv[2])
out_ogg, out_json = sys.argv[3], sys.argv[4]

def seg(x, a, b): return x[int(a * SR):int(b * SR)].copy()
def fade(x, i=0.01, o=0.05):
    n, m = int(i * SR), int(o * SR); x[:n] *= np.linspace(0, 1, n); x[-m:] *= np.linspace(1, 0, m); return x
def norm(x, peak=0.9): return x / (np.max(np.abs(x)) + 1e-9) * peak
def highpass(x, f):
    s = np.fft.rfft(x); fr = np.fft.rfftfreq(len(x), 1 / SR); s *= 1 / (1 + (f / np.maximum(fr, 1e-3)) ** 4); return np.fft.irfft(s, len(x))

# --- firing epochs in the idle: band-limited energy peaks one firing interval apart
idle = highpass(seg(idle_src, 2.0, 7.0), 18)
f0 = 24.85
T0 = SR / f0
spec = np.fft.rfft(idle); fr = np.fft.rfftfreq(len(idle), 1 / SR)
env = np.fft.irfft(spec * ((fr > 20) & (fr < 300)), len(idle))
env = np.convolve(np.abs(env), np.hanning(int(T0 * 0.5)), 'same')
epochs, i = [], int(np.argmax(env[:int(T0)]))
while i < len(idle) - T0:
    epochs.append(i)
    lo, hi = int(i + T0 * 0.8), int(i + T0 * 1.2)
    i = lo + int(np.argmax(env[lo:hi]))
epochs = [e for e in epochs[1:-1] if e - int(T0) >= 0 and e + int(T0) <= len(idle)]
# whole engine cycles (two crank revolutions = four firings), so the half-order beat repeats cleanly
epochs = epochs[:len(epochs) // 4 * 4]
G = int(T0)
grains = [idle[e - G:e + G] * np.hanning(2 * G) for e in epochs]
print(f'{len(grains)} firing grains, source firing {f0} Hz (~{f0 * 30:.0f} rpm)')

def rpm_loop(rpm):
    f = rpm / 60 * 2                          # inline four: two firings per crank revolution
    step = SR / f
    n = len(grains); L = int(round(n * step))
    out = np.zeros(L + 4 * G)
    for k in range(n):
        g = grains[k]
        w = min(len(g), max(int(step * 2.2), 64))
        c = (len(g) - w) // 2; g = g[c:c + w] * np.hanning(w)
        p = int(round(k * step)) - w // 2 + 2 * G
        out[p:p + w] += g
    body = out[2 * G:2 * G + L].copy(); body[:2 * G] += out[2 * G + L:4 * G + L]; body[-2 * G:] += out[:2 * G]
    return norm(body, 0.8)

cues, parts, t = {}, [], 0.0
def add(name, x, gap=0.05):
    global t
    parts.append(x.astype(np.float32)); cues[name] = [round(t, 5), round(len(x) / SR, 5)]
    parts.append(np.zeros(int(gap * SR), np.float32)); t += len(x) / SR + gap
for rpm in RPMS:
    add(f'r{rpm}', rpm_loop(rpm))
add('blip', norm(fade(seg(accel, 0.9, 4.6), 0.005, 0.4), 0.8))
bank = np.concatenate(parts)
with tempfile.TemporaryDirectory() as d:
    w = os.path.join(d, 'bank.f32')
    bank.tofile(w)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', w, '-c:a', 'libvorbis', '-q:a', '5', out_ogg], check=True)
json.dump({'rpm': list(RPMS), 'cues': cues}, open(out_json, 'w'), indent=1)
print('cues', cues)

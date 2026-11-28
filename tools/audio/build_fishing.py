"""Builds the fishing sound bank (www/sfx/fishing.ogg + src/fishingCues.json) from real recordings on Freesound, all CC0:
the reel being wound and line running off against the clutch, a rod cast with the line peeling off the spool, the
swish of a strike, a float or lure plopping in and a lead going in, fish splashing (released fish, and fish thrashing
in a pond), a line snapping, and a piezo buzzer (the kind of sounder in a carp bite alarm) for the alarm's bleeps.

Edits: excerpting, mono mix, high-pass, levelling, short fades, seamless loops (the loop's tail crossfaded, equal
power, into its head), and Ogg Vorbis encoding. src/fishingCues.json gives each cue's [start, length] in seconds.

  python3 tools/audio/build_fishing.py <cache dir> www/sfx/fishing.ogg src/fishingCues.json
"""
import sys, os, json, subprocess
import numpy as np

SR = 44100
CACHE, OUT_OGG, OUT_JSON = sys.argv[1], sys.argv[2], sys.argv[3]
UA = 'Mozilla/5.0 (X11; Linux x86_64) sfx-build'
os.makedirs(CACHE, exist_ok=True)

# Freesound id: (preview, author, title)
SRC = {
    507078: ('507/507078_8682843-hq.mp3', 'paulprit', 'Angel Fly Fish Reel Slow Wind_1.wav'),
    507099: ('507/507099_8682843-hq.mp3', 'paulprit', 'Fly Fishing Reel Running_5.wav'),
    853287: ('853/853287_9129912-hq.mp3', 'el_boss', 'Casting Fishing Rod for Game Fishing SFX'),
    725426: ('725/725426_14375679-hq.mp3', 'mwchristian95', 'Fishing Rod Cast - Swoosh'),
    853279: ('853/853279_9129912-hq.mp3', 'el_boss', 'Fishing Lure Plop Water - Game SFX (2 or 2)'),
    178735: ('178/178735_2596329-hq.mp3', 'jc144940', 'Rock In Water Splash-Plop 1.aif'),
    507094: ('507/507094_8682843-hq.mp3', 'paulprit', 'Fish Splashing Release 1.wav'),
    507093: ('507/507093_8682843-hq.mp3', 'paulprit', 'Fish Splashing Release 2.wav'),
    443380: ('443/443380_4089273-hq.mp3', 'kylecutsfilms', 'Fish Splashing Pond.wav'),
    866245: ('866/866245_15591201-hq.mp3', 'canberries4', 'big_cast_or_snap'),
    723998: ('723/723998_15639698-hq.mp3', 'D31V228', 'Piezo Buzzer Alarm'),
}

def load(i):
    f = os.path.join(CACHE, f'{i}.mp3')
    if not os.path.exists(f):
        subprocess.run(['curl', '-sfL', '--retry', '4', '--max-time', '240', '-A', UA, 'https://cdn.freesound.org/previews/' + SRC[i][0], '-o', f], check=True)
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', f, '-ac', '1', '-ar', str(SR), '-af', 'highpass=f=70', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)

def cut(x, a, b, fade=0.006):
    s = x[int(a * SR):int(b * SR)].copy(); n = min(len(s) // 2, int(fade * SR))
    if n: r = np.linspace(0, 1, n); s[:n] *= r; s[-n:] *= r[::-1]
    return s

def level(s, rms_db=None, peak_db=-1.5):
    if rms_db is not None: s = s * 10 ** (rms_db / 20) / (np.sqrt((s ** 2).mean()) + 1e-12)
    p = np.abs(s).max() + 1e-12; lim = 10 ** (peak_db / 20)
    return s * (lim / p) if p > lim or rms_db is None else s

def loop(x, a, b, xf=0.35):
    s = x[int(a * SR):int(b * SR) + int(xf * SR)].copy(); n = int((b - a) * SR); k = int(xf * SR); t = np.linspace(0, 1, k)
    s[:k] = s[:k] * np.sin(t * np.pi / 2) + s[n:n + k] * np.cos(t * np.pi / 2)
    return s[:n]

X = {i: load(i) for i in SRC}
parts, cues, pos = [], {'loops': {}, 'shots': {}}, 0.0
GAP = np.zeros(int(0.08 * SR))
def add(kind, name, s):
    global pos
    entry = [round(pos, 4), round(len(s) / SR, 4)]
    if kind == 'loops': cues['loops'][name] = entry
    else: cues['shots'].setdefault(name, []).append(entry)
    parts.append(s); parts.append(GAP); pos += (len(s) + len(GAP)) / SR

add('loops', 'reel', level(loop(X[507078], 1.0, 6.2), rms_db=-20))            # the reel wound in
add('loops', 'clutch', level(loop(X[507099], 1.0, 8.6), rms_db=-17))          # line pulled off against the clutch
add('shots', 'cast', level(cut(X[853287], 0.0, 2.85, 0.004), peak_db=-2))     # the cast: a swish, the spool spinning
add('shots', 'swish', level(cut(X[725426], 0.0, 1.0), peak_db=-3))            # a strike
add('shots', 'plop', level(cut(X[853279], 0.0, 0.38, 0.002), peak_db=-4))     # a float or lure going in
add('shots', 'lead', level(cut(X[178735], 0.42, 1.5, 0.003), peak_db=-3))     # a lead going in
for a, b in [(0.0, 1.85)]: add('shots', 'splash', level(cut(X[507094], a, b), peak_db=-2))
for a, b in [(0.25, 1.55), (1.6, 3.2)]: add('shots', 'splash', level(cut(X[507093], a, b), peak_db=-2))
for a, b in [(1.15, 2.0), (2.55, 3.45), (12.0, 13.2)]: add('shots', 'thrash', level(cut(X[443380], a, b, 0.02), peak_db=-3))
add('shots', 'snap', level(cut(X[866245], 0.0, 0.64, 0.002), peak_db=-3))     # the line goes
add('shots', 'beep', level(cut(X[723998], 0.30, 0.43, 0.004), peak_db=-6))    # one bleep of the alarm (3.2 kHz piezo)

audio = np.concatenate(parts).astype(np.float32)
os.makedirs(os.path.dirname(OUT_OGG), exist_ok=True)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libvorbis', '-q:a', '5', OUT_OGG],
               input=audio.tobytes(), check=True)
cues['sources'] = {str(i): {'author': v[1], 'title': v[2], 'url': f'https://freesound.org/s/{i}/', 'licence': 'CC0'} for i, v in SRC.items()}
json.dump(cues, open(OUT_JSON, 'w'), indent=1)
print('fishing bank', round(len(audio) / SR, 2), 's', os.path.getsize(OUT_OGG) // 1024, 'KB', ', '.join(list(cues['loops']) + list(cues['shots'])))

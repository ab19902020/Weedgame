"""Builds the Kestrel drone's motor sound (www/sfx/drone.ogg) from a real recording: "UAS Drone Hover 01.wav" by
DCPoke on Freesound (CC0), a DJI Phantom 4 Pro hovering, recorded outdoors on a Tascam DR-40.

The steady part of the hover (18.0 to 27.4 s, the props' blade-pass tone at ~350 Hz) becomes one seamless loop:
mono mix, a 110 Hz high-pass (wind on the mic and handling rumble), levelled to -18 dBFS RMS, and the loop's tail
crossfaded (equal power) into its head. src/audio.js plays it at the drone, re-pitched by the four motors' speeds
(drone.js `motor`), two copies a few hundred milliseconds apart so the front and rear pairs beat against each other.

  python3 tools/audio/build_drone.py <cache dir> www/sfx/drone.ogg
"""
import sys, os, subprocess
import numpy as np

SR = 44100
CACHE, OUT = sys.argv[1], sys.argv[2]
UA = 'Mozilla/5.0 (X11; Linux x86_64) sfx-build'
URL = 'https://cdn.freesound.org/previews/387/387985_6221013-hq.ogg'   # https://freesound.org/people/DCPoke/sounds/387985/
START, LEN, XF = 18.0, 9.4, 0.45

os.makedirs(CACHE, exist_ok=True)
src = os.path.join(CACHE, '387985.ogg')
if not os.path.exists(src):
    subprocess.run(['curl', '-sfL', '--retry', '4', '--max-time', '240', '-A', UA, URL, '-o', src], check=True)
raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', str(SR), '-af', 'highpass=f=110:poles=2',
                      '-f', 'f32le', '-'], capture_output=True, check=True).stdout
x = np.frombuffer(raw, np.float32).astype(np.float64)

a, n, xf = int(START * SR), int(LEN * SR), int(XF * SR)
seg = x[a:a + n + xf].copy()
# seamless loop: the extra tail fades out over the head as the head fades in (equal power)
t = np.linspace(0, 1, xf)
head, tail = seg[:xf], seg[n:n + xf]
seg[:xf] = head * np.sin(t * np.pi / 2) + tail * np.cos(t * np.pi / 2)
loop = seg[:n]
loop *= 10 ** (-18 / 20) / np.sqrt((loop ** 2).mean())
peak = np.abs(loop).max()
if peak > 0.97: loop *= 0.97 / peak

os.makedirs(os.path.dirname(OUT), exist_ok=True)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libvorbis',
                '-q:a', '4', OUT], input=loop.astype(np.float32).tobytes(), check=True)
print('drone loop', round(LEN, 2), 's', os.path.getsize(OUT) // 1024, 'KB')

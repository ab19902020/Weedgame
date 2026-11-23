# Performance checklist · collecting real device numbers

Nobody has measured Green County on a phone yet. The target is the **Honor Magic 6 Pro at 30 fps**. The quality budgets in `src/perf.js` (`BUDGETS.low / medium / high`) are design targets, not measurements. This checklist turns them into real numbers.

Figures from the development container (SwiftShader software GL on a Xeon VM) are useful only for counting draw calls and triangles, which don't depend on the GPU. Its frame times say nothing about phones.

## Before you start

1. Install the APK you built after merging (`npm run apk`) and uninstall older Green County builds first.
2. Charge to at least 50 %, turn off battery saver, close other apps, and let the phone cool to room temperature. Note the room temperature and whether the phone was on charge.
3. Launch the game and open **Dev**. The line near the bottom says `Renderer WebGPU` or `Renderer WebGL2` and the quality preset. **Write down the backend shown.** If WebGPU failed, the game falls back to WebGL2 and remembers that.

## Run the flythrough

The flythrough drives a fixed road route, **Woodley precinct → A3290 → Reading town centre** (7.0 km at 14 m/s, about 8½ minutes), in wall-clock time. Every run covers the same streets in the same time, so you can compare runs directly.

1. Open **Dev → World → Perf flythrough**. A toast shows the route length. Don't touch the screen until it finishes. **Stop flythrough** on the same row aborts it, and a partial log is still saved.
2. When it finishes, a toast shows `Saved /storage/emulated/0/Android/data/uk.greencounty.game/files/perf-<timestamp>.json` with average fps, p95 frame time and stalls. Your brother returns to where he was. The flythrough position is never saved.
3. Do **three runs** per configuration. The first run warms the shader cache, so report runs 2 and 3:
   * medium + WebGPU (the default, if WebGPU works)
   * medium + WebGL2 (**Dev → Use WebGL2**)
   * low + whichever backend is faster (start a browser build with `?quality=low`; on the APK, see "Quality on the APK" below)
4. Optional: tap **Perf overlay** to watch fps, p95, draws, triangles, heap and pixel ratio live, and use **Save perf log** for a free-roam session log.

## Get the files

```bash
adb pull /sdcard/Android/data/uk.greencounty.game/files/ ./perf-logs/
node tools/test/perf-summary.js perf-logs/perf-*.json     # Markdown table of every log
```

## What to read in each log

| Field | Meaning | Target (medium) |
|---|---|---|
| `backend`, `gpu`, `userAgent` | what produced the numbers; quote these with every figure | — |
| `summary.fps` | mean fps over the whole route | ≥ 30 |
| `summary.p95` / `p99` | 95th / 99th percentile frame time (ms) | p95 ≤ 40 ms |
| `summary.stalls` | frames over 100 ms (hitches; mostly tile streaming and shader compiles) | ≤ 1 per km after warm-up |
| `summary.heapMaxMB` | peak JS heap (Chrome/WebView only; null elsewhere) | < 450 MB |
| `summary.drawCallsP95`, `trisP95` | render cost incl. shadow pass | ≤ 220 draws, ≤ 600k tris |
| `legs[]` | the same stats per leg (residential Woodley vs A3290 vs town centre) | — |
| `samples[]` | every 2 s: position, fps, p95, draws, tris, heap, pixel ratio, tiles loaded and pending, cars, people | — |

The dynamic resolution moves the pixel ratio between the preset's min and max to hold about 30 fps. A run that "holds 30 fps" at `pr` 0.7 isn't the same as one at 1.35, so read `samples[].pr` alongside fps.

## Report back

Fill in one row per run and put it in `docs/COVERAGE.md` (performance section) with the date:

| Date | Phone | Backend | Quality | Run | fps | p95 ms | stalls | heap max MB | draws p95 | min pr | Notes (temp, charging) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | Honor Magic 6 Pro | | | | | | | | | | |

## If it's too slow

In order of payoff (all in `src/perf.js` budgets unless noted):

1. Drop `pixelRatio` min/start for the preset.
2. Reduce `shadow.size` / `shadow.extent`, or switch shadows off.
3. Reduce `r1` (LOD1 radius) and `r0` (LOD0 radius).
4. Reduce `treeDist`, `lampDist`, `markDist`, `signDist`.
5. Lower `vehicles` / `people` (simulation cost; look for high frame times where `samples[].vehicles` is high).
6. Lower `cloudSteps` (sky raymarch, fill-rate bound).

## Quality on the APK

The APK opens `index.html` without query parameters, so touch devices start on **medium**. To try `low` or `high` on the phone, connect Chrome DevTools (`chrome://inspect`) to the WebView and run `location.search = '?quality=low'`. The setting lasts until the app restarts.

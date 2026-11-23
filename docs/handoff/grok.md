# Hand-off · Grok · simulation, performance and test infrastructure (`grok/sim-perf`)

Branch `grok/sim-perf`, cut from `ccr-0546346a-2h4fov` at `c653995`. Every task in the brief has a commit; see `git log c653995..grok/sim-perf`.

**Measurement caveat.** All figures below were measured in this container: headed Chromium under Xvfb, backend **WebGL2**, renderer `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` (CPU software rendering), on an 8-vCPU Intel Xeon VM with 15 GB RAM, viewport 915 × 412. Draw calls, triangles and object counts depend only on the scene and budget, so they carry over to phones. **Frame times, fps, stalls and heap from this software renderer say nothing about the Honor Magic 6 Pro or any phone.** Phone numbers have to come from the APK flythrough (`docs/PERF-CHECKLIST.md`).

## What changed

### 1 · Performance budget (`src/perf.js`, small edits in `main.js`, `app.js`, `hud.js`)
* Explicit `BUDGETS` for `low` / `medium` / `high`: tile radii r0/r1, draw calls (120 / 220 / 320), triangles (300k / 600k / 900k), people (60 / 120 / 170), moving vehicles (120 / 220 / 260), cloud steps (4 / 8 / 12), pixel ratio [min, start, max] for dynamic resolution, shadows (off / 1024 px over ±70 m, far 450 / 2048 px over ±100 m, far 600), antialias, and draw distances for trees, lamps, signs, markings, vehicles and people.
* Draw-call counter fixed. The old overlay showed `info.render.calls`, which counts render() calls, not draws. It now reads `drawCalls`, resetting `renderer.info` once per frame.
* Draw-call cuts (`RenderBudget` in perf.js, no edits to `tiles.js`, `landmarks.js` or `materials.js`):
  * LOD1 buildings are merged per 4 × 4-tile cluster, rebuilt one cluster per frame once membership has been stable for 0.6 s.
  * Landmark canopy and bus-shelter groups (about 380 meshes in Woodley and Reading) are baked into one mesh per material per 512 m cell.
  * LOD1 tile groups are frustum-culled.
  * LOD0 trees, lamps, signs and markings are culled by distance per budget.
  * Empty instanced meshes are hidden.
  * `?nobatch` turns all of this off for A/B checks.
  * Per-tile ground, markings and struct could not be merged into one mesh: they use three different materials, and the terrain material samples the landcover atlas through `positionLocal`, so it can't be batched across tiles without changes in `materials.js` (Astra's). That is left as a proposal.
* **Perf flythrough.** Dev panel → *Perf flythrough* (`data-act="perf-flythrough"`):
  * Drives a temporary car at 14 m/s wall-clock (`?flyspeed=`) along a fixed 7.02 km road route: Woodley precinct → A3290 → Reading town centre.
  * Records per-frame times, per-leg stats and 2-second samples (draw calls, triangles, heap, pixel ratio, tiles, vehicles, people).
  * Puts the brother back where he was, and suspends saves while it runs.
  * Writes `perf-flythrough-<time>.json` through `GCNative.savePerf` on Android (app external files dir), or as a browser download otherwise. The last log is also kept in `localStorage['greenCounty.perf.last']`.
* `docs/PERF-CHECKLIST.md` covers phone steps, the `adb pull` path, the fields to read, targets, a report table and a tuning order. `tools/test/perf-summary.js` turns logs into a Markdown table.

### 2 · Persistent traffic (`src/traffic.js`, small edits in `save.js`, `app.js`)
* Every save stores the moving fleet within 250 m of either brother: ids, kind, model, paint, half-edge, position, lane, speed, next 12 route steps and destination. Buses also store their route index and next stop, so they rebind to their route on load. At most 600 records; a typical save is 2–4 KB.
* On load the fleet is restored with the same ids, before the brothers' own cars. `nextId` never collides with restored ids.
* Traffic around the inactive brother is frozen in place, so swapping finds the same cars where they were.

### 3 · Traffic behaviour (`src/traffic.js`, `src/signals.js`)
* **Lane choice for the next turn.** Uses `net.turnLanes` where present (feature-detected). Otherwise UK rules apply: right turn → offside lane, left → nearside. Lane changes are smooth lateral moves that need a gap.
* **Right turns** give way to oncoming traffic at junctions with three or more arms. After about 20 s waiting they nose through a gap.
* **Roundabouts.** The exit is planned on entry. Exits within 135° use the left lane, later exits the right lane, and drivers move left before their exit.
* **Bus lanes.** Buses use the nearside lane where `net.psv` flags it. Other traffic keeps out unless it is turning left.
* **Demand-actuated signals** (simulated detectors 60 m back from each stop line):
  * min green 7 s, gap-out after 3 s with no arrivals, max green 1.6 × nominal;
  * rests on green when no other approach is calling;
  * skips stages with no demand, and skips the pedestrian stage until the button is pressed.
* Kept: blocked-lane recovery (overtake or lane change past a stationary obstacle), the junction-box rule and zebra occupancy.

### 4 · Pedestrians (`src/peds.js`, new `src/walkgraph.js`)
* **Walk graph.** Built on the network's walkable half-edges, plus 1,370 links that join dangling footway ends (within 22 m) to pavement or footway nodes. Built in about 21 ms. `WalkGraph.path()` does A* and returns a walking polyline: on the pavement side for roads, on the centre line for footways.
* People prefer mapped footways and pedestrian streets. Pavement offsets are skipped on roads that have a parallel mapped sidewalk.
* **Corners** are rounded with a bezier at junction mouths instead of cutting across.
* **Doors.** People route to building doors: `tile.data.doors` when present, otherwise the frontage-edge midpoint. They enter and leave out of view, at a reach of 14 m.
* **Density** follows hourly footfall profiles: town centre vs local, and weekday / Saturday / Sunday. Examples: a Saturday afternoon on Broad Street vs a Woodley close at dawn. Capped by the people budget.

### 5 · Police (`src/police.js`, `src/traffic.js`)
* **Long-route dispatch.**
  * The full route is planned at dispatch (A*, 250k-node limit, with fallbacks) and re-planned when it runs out or overshoots.
  * The stand-down limit scales with route length (300 s + length/6).
  * Units on blue lights squeeze past cars that are pulling over. Overtakes are only abandoned once the unit is past the obstacle (the old code merged back into it).
  * A unit blocked more than 25 s within 350 m of the scene parks, and its officers attend on foot.
* **Second incident type: broken-down car blocking a lane.**
  * Hazards go on, and the driver waits on the pavement and phones it in.
  * A patrol attends and protects the scene. A yellow recovery truck comes from upstream, pulls up behind and loads the car (about 20 s).
  * The lane reopens. There is a 300 s fallback clear. Natural breakdowns occur every 8–18 min near the player; the Dev panel adds *Stage breakdown nearby*.
* **Foot chase.**
  * Triggered by walking or running away from a foot officer during a stop, or when the player leaves the car in a pursuit (an officer gets out).
  * The officer runs at 4.7 m/s; when caught: *detained* → *Released. Control returned.* The chase is called off if the player is lost.
  * Non-graphic, with no injuries.
* **Pursuit off the road graph.** The pursuing car leaves the graph slowly, steering around buildings, and rejoins the nearest road when the pursuit ends.
* Every case resolves to `none` with control returned. `tools/test/police.js` checks all four; its last run is in `docs/handoff/police-check.json`.

### 6 · Trains, stretch (new `src/trains.js`, `tools/rail/build_rail.mjs`, `www/world/rail.json`)
* `tools/rail/build_rail.mjs` (`npm run rail`) builds the rail data:
  * It reads the OSM `railway=rail` centre lines already in the tiles and joins pieces across tile edges.
  * It bridges gaps: bridges are omitted by the pipeline, so links are added where the track continues in line, up to 200 m, joining mid-edge where needed. Track outside the mapped area becomes hidden links up to 3 km.
  * It gives every point a terrain height (median and mean smoothed), then finds no-reversal paths (turns < 35°) for each line.
* Stations come from `manifest.stations` when present, otherwise from Wikipedia WGS84 coordinates snapped to the track (1–59 m; logged in `docs/SOURCES.md`).
* **Reading–Waterloo line.** 19.8 km: Reading → Earley → Winnersh Triangle → Winnersh → Wokingham → Bracknell → Martins Heron. Three 4-car units, top speed 33 m/s.
* **Great Western main line.** 10 km of four-track main line through Reading, which is its only station inside the map. Two 6-car units, top speed 45 m/s. Twyford and Tilehurst are outside the map, so they are not served.
* There is no timetable. Trains run evenly spaced on a precomputed run profile: accelerate 0.6 m/s², brake 0.75 m/s², 40 s dwell, 4 min turnaround. Carriages are instanced (one draw call) and drawn only on loaded tiles within view range.

### 7 · Test infrastructure (`tools/test/*`, `package.json`)
* `walkTo` in the acceptance run follows the walk graph (waypoints every 10 m), still driving only the touch joystick. The collision and crossing steps keep `straight: true`.
* Dev-panel taps use stable `data-act` ids (`spot-woodley-signal-crossing`, `sim-8`, `weather-rain`, `time-18.5`, `perf-flythrough`, …) instead of label text.
* New acceptance steps: *Perf flythrough from the Dev panel* (short run, stop, check the brother is restored and a log was saved) and *Traffic persists across save, reload and brother swap*.
* `npm run test` runs `node --test` on `tools/test/unit/*.test.mjs`, 17 tests:
  * `network.route` contiguity and one-way legality;
  * signal stage cycling, rest-on-green, calls, max-green hold and gap-out;
  * weather timeline determinism, wet/dry integration and save continuity;
  * save round trip, fresh start, and legacy prototype migration (the legacy key is never overwritten);
  * fleet snapshot/restore, walk-graph paths, and train paths, stops and spacing.
* `npm run acceptance:quick` runs a subset (collision, signal crossing, police collision, flythrough, traffic persistence, mission checks, migration) to `/tmp/acceptance-quick`.
* Dev tools: `probe.js` (draw calls, triangles and a per-material tally at fixed spots), `flythrough.js`, `fleet.js`, `police.js`, `simcheck.js`, `trains.js` and `perf-summary.js`.

### Fix found along the way
* Parked cars leaked whenever a tile swapped between LOD0 and LOD1. The tile object is replaced without an `unload` event, so its cars were never removed; the flythrough grew to about 1,900 vehicles and 500 MB of heap. `Parking` (`services.js`) now tracks cars by tile key.
* After that fix, a second leak showed up: the LOD1 batcher created a new `Mesh` on every cluster rebuild, and the renderer kept state for each one. JS heap grew about 0.5 MB/s during the flythrough, to 516 MB. Each cluster now keeps one mesh and only swaps its geometry. Measured with forced GC at about 50% of the route: 120 MB, against 109 MB with `?nobatch` and 174 MB before the fix. The per-tile LOD1 meshes are now hidden rather than disposed, which keeps a second GPU copy of LOD1 building geometry.

## Measured results (software renderer, see the caveat at the top; not phone figures)

**Draw calls at fixed spots** (`tools/test/probe.js`, max over 12 frames; `docs/perf/probe-*.json`; taken at `5d70dc7`, before the two leak fixes, which don't change what is drawn):

| Spot | base `c653995` medium | medium | low | high | medium triangles |
|---|---:|---:|---:|---:|---:|
| Woodley precinct | 336 | 134 | 79 | 143 | 407k |
| Cemetery Junction | 179 | 137 | 80 | 154 | 361k |
| Reading town centre | 307 | 158 | 161 | 196 | 256k |
| A3290 flyover | – | 111 | 69 | 120 | 311k |

Every spot is inside its preset's draw-call and triangle budget except **low at Reading town centre: 161 against a budget of 120**. That is a peak frame; a settled frame tallies about 96. The extra draws come from the hand-built landmark sub-meshes, which aren't mine to merge.

**Perf flythrough**, medium, full 7.02 km route, final code (`docs/perf/perf-flythrough-medium.json`):
* completed; the brother was put back where he was;
* 2.1 fps average; frame time p50 368 ms, p95 591 ms, p99 846 ms;
* every frame is a "stall" at this frame rate (1,332);
* draw calls p50 128 / p95 163; triangles p95 474k;
* JS heap 77–240 MB;
* legs: Woodley → A3290 2.8 fps, A3290 → Reading 1.7 fps.

These say nothing about phones.

**Traffic persistence** (`tools/test/fleet.js`, also an acceptance step):
* Leon in Earley, Cal in Woodley; save 2.9 KB with 16 fleet records.
* After reload, 100% of ids within 200 m of each brother were kept (4 and 6 cars).
* After swapping to Leon and back, 100% were kept.

**Traffic behaviour** (`tools/test/simcheck.js`, Cemetery Junction, 120 sim s): no gridlock; average speed 8.5 m/s against 8.0 on base; 20 signal stage changes against 251 on base, because stages are now skipped and greens rest under actuation.

**Police** (`tools/test/police.js`, `docs/handoff/police-check.json`):

| Case | Result |
|---|---|
| Long-route dispatch (Wokingham, 3.6 km away, 4.5 km route) | arrived after 173 sim s, cleared |
| Breakdown | patrol on scene after 91 s, car **towed** |
| Foot chase | stop → footchase → detained → none |
| Off-road pursuit | pursuit → footchase → detained → none; unit back on the road |

**Trains** (`tools/test/trains.js`):
* Reading–Waterloo: 19.8 km, 7 stops, 3 units, 45.5 min cycle.
* GWML: 10 km, 2 units, 20.7 min cycle.
* A train was drawn calling at Earley. Captures: `docs/captures/T1-train-at-earley.png`, `T2-train-at-wokingham.png`.

**Unit tests:** `npm run test` passes 17/17.

## Still simulated or estimated
* All signal timings: there are no detector or phase data; detectors are virtual.
* Turn-lane choice uses UK rules unless `net.turnLanes` exists (it doesn't yet). Bus lanes need `net.psv` (absent, so the fallback means no bus lanes). Doors need `tile.data.doors` (absent, so the frontage midpoint is used).
* Pedestrian footfall profiles are plausible shapes, not counts.
* The train service has no timetable (even headways). Station positions are Wikipedia coordinates snapped to OSM track until `manifest.stations` exists. Track heights are terrain-following and smoothed; bridges are straight interpolated links; track outside the map is hidden.
* Police and recovery behaviour is fictional and simplified.

## Still undone / known gaps
* **No phone measurements.** The APK flythrough exists; the user needs to run it (`docs/PERF-CHECKLIST.md`). WebGPU is unverified here: SwiftShader only gives WebGL2.
* Per-tile ground, markings and struct aren't merged into one draw. Terrain can't be batched across tiles without a change to the material in `materials.js`.
* Low preset at Reading town centre peaks above its 120 draw-call budget.
* JS heap still climbs slowly while streaming new areas, even with `?nobatch` (about 60 MB over half the route). Not investigated further; it may be caches that settle.
* GWML stations beyond Reading (Twyford, Tilehurst) are outside the map. There are no level crossings or platform pedestrians, trains have no sounds, and the player is not blocked by trains.
* The "Still to do" bullets in `docs/COVERAGE.md` about lanes, pedestrians, police and railways are generated outside the sections I may edit, so they are stale. The report owner should update them.

## Shared files touched (all small, local edits)
* `src/app.js`:
  * imports and creates `Trains`;
  * `traffic.maxVehicles` comes from the budget;
  * fleet restore and anchors;
  * the flythrough replaces player update while active;
  * vehicle draw distance comes from the budget;
  * `trains.update` / `trains.draw`, and `perf.render.update()` after `perf.frame`;
  * dynamic-resolution limits come from the budget.
* `src/main.js`: `budgetFor(quality)` drives antialias, start pixel ratio, shadow enable, size, extent and far, cloud steps and r0/r1; `G.budget` is added.
* `src/hud.js`:
  * `btn()` sets `data-act` (via an exported `slug()`), with explicit ids for time, speed, weather, sim, go-to and test-spot buttons;
  * new *Stage breakdown nearby* and *Perf flythrough / Stop flythrough* buttons.
* `src/save.js`: saves `fleet` and adds a `fleet` getter.
* `package.json` / `package-lock.json`: adds `playwright` as a dev dependency, plus the `test`, `acceptance:quick`, `test:police` and `rail` scripts.
* `docs/SOURCES.md`: one line for the rail and station sources.
* `www/world/rail.json` is new, generated by `tools/rail/build_rail.mjs` from the committed tiles. It sits in Astra's directory but no existing file was modified.
* `tools/pipeline/report.py`: only the acceptance section and a new performance section (plus the hardware-performance bullet).
* Not touched: `src/tiles.js`, `src/landmarks.js`, `src/materials.js`, the pipeline and the Android sources.

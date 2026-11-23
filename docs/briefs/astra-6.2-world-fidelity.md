# Brief for Astra 6.2 · World fidelity and reference quality

You own **what the world looks like and where things are**: the geodata pipeline, tile geometry, materials and hand-modelled landmarks. Another agent (Grok) owns simulation, performance and tests at the same time. Keep to your files (listed below) so the two branches merge cleanly.

## Start here

1. Repo `ab19902020/Weedgame`, branch `ccr-0546346a-2h4fov` at commit `9ac9064` or later. Create your own branch `astra/world-fidelity` from it.
2. Read, in this order: `CLAUDE-PROMPT.md` (the brief), `README.md` (build, run, layout), `docs/COVERAGE.md` (what is measured, inferred, estimated and missing), `docs/SOURCES.md` (licences). The "Still to do" list in COVERAGE is your backlog. This brief sets the priority.
3. Set up:
   ```bash
   npm install && npm run build && npm run serve      # http://localhost:8080
   pip install osmium pyproj shapely numpy pillow
   # OSTN15 grid: download uk_os_OSTN15_NTv2_OSGBtoETRS.tif from cdn.proj.org into pyproj's data dir
   mkdir -p data && curl -o data/south_east.osm.pbf https://download.openstreetmap.fr/extracts/europe/united_kingdom/england/south_east-latest.osm.pbf
   python3 tools/pipeline/extract_osm.py data/south_east.osm.pbf data/berks.osm.pbf
   python3 tools/pipeline/fetch_terrain.py data       # EA LIDAR DTM via WCS, ~30 s
   npm run world                                       # ~80 s, rewrites www/world/
   ```

## Ground rules (non-negotiable)

- **Sandbox only.** No missions, objectives, calls, deliveries or sales.
- **No invented accuracy.** Report counts and computed comparisons only. Every new estimated dimension, inferred feature or simulated value goes into `docs/COVERAGE.md` (via `tools/pipeline/report.py`) as estimated or inferred.
- **Licences.** Only use references you are allowed to use: OSM (ODbL), OGL data, CC-licensed photos with the licence recorded. Log every new source in `docs/SOURCES.md` with licence, date and use. Show shop names as plain text only, never logos or brand marks.
- **Never claim a capture you didn't take.** Screenshots must come from the running game.
- **Don't commit APKs.** The development signing key wasn't committed and is gone, so any rebuilt APK has a new key. The user will rebuild after merging.

## Files you own

`tools/pipeline/*`, `src/tileWorker.js`, `src/materials.js`, `src/landmarks.js`, `src/signs.js`, `src/sky.js`, `src/env.js`, generated `www/world/**`, and the world sections of `docs/COVERAGE.md` and `docs/SOURCES.md`.

Shared files (`src/app.js`, `src/hud.js`, `src/main.js`, `src/tiles.js`): small, local edits only (for example new test spots in `TESTSPOTS`). Don't reformat them. Say what you touched in your hand-off.

## Tasks, in priority order

1. **Reading Town Hall, visible and verified.** The model is built (bbox x −7346…−7293, z −2630…−2564), but no street view shows it cleanly. From Friar Street, Blagrave Street, Valpy Street and Town Hall Square, check what stands in front: overlapping OSM footprints, `building:part`, the museum wing, the generic-mesh skip. Then:
   - Fix the cause.
   - Place the clock tower from a cited reference and record any estimates.
   - Produce a real capture from a public vantage point and add a matching test spot.
2. **Cemetery Junction gateway, reference quality.**
   - Refine the proportions of the arch and lodges from permitted references (Historic England list text, CC-licensed photos with licences recorded).
   - Add collision on the lodge bays only; the carriage arch must stay passable.
   - Add the boundary walls and railings beside it.
   - Capture it from London Road and from Wokingham Road.
3. **Woodley precinct, reference quality.**
   - Correct shopfront frontage on every unit facing the pedestrian area.
   - Improve fascia placement and size.
   - Check that canopy depth and continuity match evidence; if unsurveyed, keep them flagged as estimates.
   - Add precinct furniture only where OSM maps it (benches, bins, the war memorial, cycle stands).
4. **Building detail from tags.**
   - Wire up `building:colour`, `building:material`, `roof:colour` and `roof:material`. They are read in `build_world.py` but never reach the shader; encode them in `bM`.
   - Add bay windows on house frontages (seeded, inferred), porches, gutters and downpipes, and garages attached to semis.
   - Keep per-building attributes rounded in the shader. Interpolated seeds fed to a sine hash give speckled façades.
5. **Roads.**
   - Lane arrows and turn lanes from OSM `turn:lanes`.
   - Bus lanes (red surfacing where `lanes:psv`, `busway` or `psv` is tagged).
   - Box junctions where tagged.
   - Double yellows in the town-centre cores: add a `core` flag to the tile header; the worker already checks `header.core`.
   - Roundabout circulation markings.
6. **Underpasses and tunnels.** Carve the terrain for `tunnel=yes` and for cuttings, so roads in underpasses are not buried.
7. **Railway and stations.** Platforms and canopies at Reading, Earley, Winnersh, Winnersh Triangle, Wokingham and Bracknell from OSM, with platform edges and shelters. (Grok may run trains on your rails; see the data contract below.)
8. **Rear plots (stretch).** Inferred rear fences between houses within residential blocks, flagged as inferred.

## Data contract with Grok (simulation)

Grok will read these if present and must not break if they are absent. Add them as new arrays or header keys; never change the meaning of existing ones.

- `network.bin` arrays:
  - `turnLanes` per half-edge: a string-table index for the `turn:lanes` value, or −1.
  - `psv` per edge: bus-lane flag.
- Per-tile `doors`: `[x, z, buildingIndex, isShop]` on each building's frontage edge. Grok will route pedestrians to them.
- `manifest.json`: `stations`, a list of `[name, x, z, platformEdgeIndices]`.

Bump `manifest.version` and describe the fields in `README.md` under "Data contract".

## Gotchas already found

- In WGSL, implicit-derivative `textureSample` is not allowed inside loops or branches. Use `.level(n)` there, as the cloud raymarch does.
- `pow()` with a negative base is NaN in GLSL. Multiply the value by itself instead.
- Never rebuild `www/world/` or `www/app.js` while a browser test is running, because the test reloads and reads them.
- Software rendering here runs at about 1 fps. Use `?backend=webgl&fixedres=1&r0=250&r1=600` for quick looks. In headless Chromium, WebGPU is unreliable; headed Chromium under Xvfb with `CHROMIUM_WEBGL_RENDERER=lavapipe` works best. Every material must still compile for WebGPU.

## Done means

- `python3 tools/pipeline/verify.py data www/world docs/verification.json` still shows distance, route-length and area differences ≤ 0.01%.
- Total tile data stays ≤ 30 MB.
- New captures in `docs/captures/` (prefix `A-`): Town Hall, the Cemetery Junction gateway from two sides, the Woodley precinct, a terraced street with bay windows, a station. Take them with `tools/test/landmarks.js` (touch only) or an extension of it.
- `ONLY="launch,walk,cross at,clouds,mission" xvfb-run -a node tools/test/acceptance.js <dir>` passes. Also run the full acceptance once before handing off.
- No new console errors on WebGL2. Materials compile under the WebGPU backend.
- `docs/handoff/astra-6.2.md`: what changed, what was verified (with numbers), what is estimated or inferred, what is still undone, and which shared files you touched.

# Green County · Berkshire sandbox (v0.6.0)

A free-roam, 1:1 slice of Berkshire: Reading town centre, Cemetery Junction, Earley, Woodley, Winnersh, Wokingham and Bracknell, joined by the A329 and A329(M). It starts in **sandbox mode**: you control Cal or Leon Ward and can explore indefinitely. There are no missions, objectives, phone calls, deliveries or sales. The cannabis-empire layer from the v0.3–v0.5 prototype will sit on this world later; its save data is carried along untouched.

* `CLAUDE-PROMPT.md`: the brief this version implements.
* `docs/COVERAGE.md`: what matches reference data, what is inferred or estimated, and what still needs work.
* `docs/SOURCES.md`: asset and source register (licences, dates, signing key).
* `docs/verification.json`: computed comparisons of the world against its inputs.
* `docs/captures/`: gameplay captures, `acceptance-run-8x.mp4` (the whole touch-driven run at 8× speed; software rendering here ran at ~1 fps), `acceptance.json` (step log) and landmark views (`L*.png`).
* `builds/Green-County-0.7.0-dev.apk`: signed development APK (v0.7: photographic surfaces, leaf-card trees, rounded cars, post-processing).

## Play

* **Android**: install `builds/Green-County-0.7.0-dev.apk`. It uses the same development key as v0.6.0, so it installs over v0.6.0; builds older than v0.6 must be uninstalled first. Landscape only.
* **Browser**: `npm run serve`, then open http://localhost:8080. Chrome or Edge recommended; WebGPU is used when available, otherwise WebGL2.

Touch controls (landscape): drag on the **left side** to move (a floating stick appears under your thumb). Drag on the **right side** to orbit the camera. **Run** (on foot) doubles as **Brake** in a vehicle. **Get in / Exit** works on any parked car. **Horn** appears while driving. **Swap** switches between Cal and Leon wherever each is. **Map** opens the full map, **Dev** the developer panel.
Keyboard: WASD or arrows, Shift run, F get in/out, Space brake, H horn, Tab swap, M map, P dev panel, Q/E orbit.

The developer panel can set the hour and clock speed, force any weather (clear, broken, overcast, drizzle, rain, mist, clearing), soak or dry the roads, stage a collision for the police to attend, run extra simulation steps, teleport to districts and test spots, show the performance overlay, save a performance log (written to app storage on Android), and switch between WebGPU and WebGL2.

URL options (browser): `?backend=webgl|webgpu`, `?quality=low|medium|high`, `?perf` (overlay), `?time=17.5`, `?weather=rain`, `?scale=120`, `?sim=4`, `?r0=…&r1=…` (streaming radii).

## What runs

* **World**: 1,067 streamed 256 m tiles in two LOD rings, built from OSM and EA LIDAR. Each building footprint becomes its own closed mesh with gabled or hipped roofs, chimneys, procedural façades, front doors, shopfronts and lit windows. Carriageways, kerbed pavements, paths and plazas are seamless polygons; markings include centre and lane lines, stop and give-way lines, zebras with zig-zags, and studs at signalised crossings. Bridges and flyovers have decks, parapets and piers on separate levels. Also streamed: street lamps, trees, walls, hedges, fences, shop fascias, rails, bus stops and shelters, canopies, the Cemetery Junction gateway and Reading Town Hall.
* **Brothers**: Cal and Leon are the only playable characters. Each keeps his own outfit, position, heading and vehicle across swaps and relaunches. You can walk, run, drive, park and get out (on the driver's side). Collisions apply against buildings, vehicles and people.
* **Traffic**: vehicles have stable IDs and persistent state, follow A*-routed journeys, keep to UK left-hand lanes, car-follow with IDM, obey signals, give way at junctions and roundabouts, don't block junction boxes, stop for zebras, and change lanes or overtake round stopped vehicles. Buses run the OSM bus routes and serve stops and queues. The bubble is simulated at full rate near you and more cheaply further out, without despawning anything in view.
* **People**: pedestrians walk pavements with destinations and time-of-day and district density. They walk in groups, chat, queue at bus stops, cross at signals (pressing the button) and zebras, react to horns, collisions, disturbances and rain (umbrellas, hurrying, sheltering), and get knocked down and back up (non-graphic).
* **Police**: a patrol car on each of six beats plus foot patrols. Witnessed incidents are phoned in; the nearest unit responds under blue lights while traffic pulls over, attends, clears and resumes patrol. If you cause trouble in sight of officers you get a proportionate stop (words of advice) or a pursuit, which ends cleanly (lost them, or detained and released) and hands control back.
* **Weather and light**: one clock and weather timeline for the whole map, saved across swaps and relaunches. Raymarched clouds are lit by the same sun, cast moving shadows on the streets, and drift with the wind. Rain is kept out from under roofs, canopies and shelters. Roads darken and turn reflective, with puddles and light streaks, then dry gradually. Dawn, dusk and night drive the street lamps, lit windows and shop fronts, and vehicle lights.
* **Sound**: synthesised and spatial. Rain changes under a canopy or inside a car; there's wind and leaves, engines and wet-tyre hiss, footsteps by surface, crowd murmur, crossing beeps, horns and two-tone sirens.

## Build

```bash
npm install                 # three 0.186.1, esbuild
npm run build               # src/ -> www/app.js + www/worker.js
npm run serve               # http://localhost:8080
npm run apk                 # signed dev APK -> builds/ (needs JDK 17+ and Android SDK 35; see tools/android/build.sh)
```

### Rebuilding the world data

```bash
pip install osmium pyproj shapely numpy pillow
# put uk_os_OSTN15_NTv2_OSGBtoETRS.tif (cdn.proj.org) in pyproj's data dir for OSTN15 transforms
mkdir -p data && curl -o data/south_east.osm.pbf https://download.openstreetmap.fr/extracts/europe/united_kingdom/england/south_east-latest.osm.pbf
python3 tools/pipeline/extract_osm.py data/south_east.osm.pbf data/berks.osm.pbf
python3 tools/pipeline/fetch_terrain.py data          # EA LIDAR DTM via WCS, 4 m
npm run world                                          # tiles, network, overview map, manifest
python3 tools/pipeline/verify.py data www/world docs/verification.json
python3 tools/pipeline/report.py                       # docs/COVERAGE.md
```

### Acceptance run

`xvfb-run -a node tools/test/acceptance.js docs/captures` (with `npm run serve` running) drives the game with real touch events. It launches into Woodley, walks into buildings, crosses at a signal, watches a bus and a pedestrian at Cemetery Junction, parks and swaps brothers, drives under the A3290, cycles the weather, waits out a police response, resumes from a save and checks that no mission UI appears. It writes screenshots, a video and `acceptance.json`.

## Layout

```
src/            runtime (ES modules): main/app, tiles + tileWorker, materials, sky, weather, atmos,
                network, traffic, signals, peds, police, services, player, characters, vehicles,
                landmarks, hud, input, audio, save, perf
www/            static app (index.html, hud.css, built app.js/worker.js) and world/ data
tools/pipeline  geodata pipeline (extract, terrain, build_world, canopies, fit_ll, verify, report)
tools/android   WebView wrapper (virtual https origin, legacy-save hand-over, perf export) + build.sh
tools/test      touch-driven acceptance run
legacy/         v0.3–v0.5 prototype (business/mission code, old map extract and native wrapper)
```

Map data © OpenStreetMap contributors (ODbL 1.0); `www/world/` is the distributed derived database. Terrain contains public sector information licensed under the Open Government Licence v3.0 (Environment Agency LIDAR).

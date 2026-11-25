# Green County · Berkshire sandbox (v0.16.0)

A free-roam, 1:1 slice of Berkshire: Reading town centre, Cemetery Junction, Earley, Woodley, Winnersh, Wokingham and Bracknell, joined by the A329 and A329(M). It starts in **sandbox mode**: you control Cal or Leon Ward and can explore indefinitely. There are no missions, objectives, phone calls, deliveries or sales. The cannabis-empire layer from the v0.3–v0.5 prototype will sit on this world later; its save data is carried along untouched.

* `CLAUDE-PROMPT.md`: the brief this version implements.
* `docs/COVERAGE.md`: what matches reference data, what is inferred or estimated, and what still needs work.
* `docs/SOURCES.md`: asset and source register (licences, dates, signing key).
* `docs/verification.json`: computed comparisons of the world against its inputs.
* `docs/captures/`: gameplay captures, `acceptance-run-8x.mp4` (the whole touch-driven run at 8× speed; software rendering here ran at ~1 fps), `acceptance.json` (step log) and landmark views (`L*.png`).
* `builds/Green-County-0.16.0-dev.apk`: signed development APK. v0.7 added the visual overhaul; v0.8 Grok's simulation and performance work; v0.9 detailed people and cars (with sports models), camera modes, summer lighting with screen-space reflections, 60 fps streaming work and LIDAR-measured buildings; v0.10 FSR upscaling with dynamic resolution, a baked cloud sky, distant car LODs, procedural house detail, street furniture with telegraph wires, and baked faces and hair; v0.11 real driving physics, impulse collisions with damage, rebuilt car bodies with per-pixel lamps and glass, tyre marks and smoke, headlight pools and engine sound; v0.12 merges every agent's work: GPT's Road Atlas and sat-nav, start/pause menu, DualShock controller, rideable buses and trains with interiors, resident routines and fire crews; Grok's lived-in town look (roads, gardens, tree species, glazed chain shopfronts); 124 licensed sound recordings; the physically based sky, stars and rain; v0.13 detailed rigged models for Cal and Leon with their full animation sets; v0.14 the brothers' Range Rover; v0.15 a visual pass: properly green, leafy trees, shrubs and leafy hedges filling open ground, emptier car parks, solid Range Rover glass and clad big-store walls; v0.16 things give way: lamp posts, poles, young trees, bins, benches, hedges, shrubs, fences and garden walls break, topple, fly or flatten instead of stopping you dead, and crashes throw glass, paint, plastic, sparks, plates and trim, jolt the body and steam.
* `docs/PERF-CHECKLIST.md`: how to record real frame times on a phone with the perf flythrough.
* `docs/handoff/grok.md` and `docs/briefs/visual-overhaul-notes.md`: hand-off notes for the simulation/performance and visual work.

## Play

* **Android**: install `builds/Green-County-0.16.0-dev.apk`. It uses the same development key as v0.6–v0.15, so it installs over them; builds older than v0.6 must be uninstalled first. Landscape only.
* **Browser**: `npm run serve`, then open http://localhost:8080. Chrome or Edge recommended; WebGPU is used when available, otherwise WebGL2.

Touch controls (landscape): drag on the **left side** to move (a floating stick appears under your thumb). Driving: push the stick up for throttle, pull it back to brake and then reverse, and steer sideways. Drag on the **right side** to orbit the camera. **Run** (on foot) doubles as the **handbrake** in a vehicle (it locks the rear wheels, so it swings the tail round at speed). **Get in / Exit** works on any parked car. **Horn** appears while driving. **Swap** switches between Cal and Leon wherever each is. **Map** opens the full map, **Dev** the developer panel.
Keyboard: WASD or arrows, Shift run, F get in/out, Space handbrake, H horn, C/V camera, Tab swap, M map, P dev panel, Q/E orbit.
Controller (DualShock or any standard-mapping pad): left stick moves and steers, right stick looks. Driving: R2 throttle, L2 brake and reverse, Cross/Square/L1 handbrake, R1 camera view, Circle or L3 horn. On foot: Cross run, Square jump, Circle/R2 hit, L1/R1 pick up a parcel. Triangle gets in or out, boards a bus or train, and requests the next stop. Options or PS opens the menu, and Share or the touchpad opens the Road Atlas. On the Atlas, the stick pans, L1/R1 zoom and Triangle drops a waypoint. D-pad: up opens the Atlas, down swaps brothers, left/right turn the camera 90°. R3 recentres the camera. In menus, the d-pad moves, Cross selects and Circle goes back.
Start menu: **Enter free roam**, **Road Atlas** (search places, drop a pin anywhere and follow the route on the minimap and in-car sat nav) and **Settings** (minimap orientation and size, route colour).

The developer panel can set the hour and clock speed, force any weather (clear, broken, overcast, drizzle, rain, mist, clearing), soak or dry the roads, stage a collision for the police to attend, run extra simulation steps, teleport to districts and test spots, show the performance overlay, save a performance log (written to app storage on Android), and switch between WebGPU and WebGL2.

URL options (browser): `?backend=webgl|webgpu`, `?quality=low|medium|high`, `?perf` (overlay), `?time=17.5`, `?weather=rain`, `?scale=120`, `?sim=4`, `?r0=…&r1=…` (streaming radii), `?post=0`, `?ao=0`, `?ibl=0`, `?grass=0|1`, `?ssr=0`, `?fsr=0` (no upscaling), `?skybake=0` (per-pixel sky), `?tm=aces` (look A/B), `?nobatch` (render batching off).

## What runs

* **World**: 1,067 streamed 256 m tiles in two LOD rings, built from OSM and EA LIDAR. Each building footprint becomes its own closed mesh with gabled or hipped roofs, chimneys, procedural façades, front doors, shopfronts and lit windows. Carriageways, kerbed pavements, paths and plazas are seamless polygons; markings include centre and lane lines, stop and give-way lines, zebras with zig-zags, and studs at signalised crossings. Bridges and flyovers have decks, parapets and piers on separate levels. Also streamed: street lamps, trees, walls, hedges, fences, shop fascias, rails, bus stops and shelters, canopies, the Cemetery Junction gateway and Reading Town Hall.
* **Procedural detail and street life**: houses get canted bay windows (some two-storey), door hoods on brackets, fascias, soffits, gutters and downpipes, bargeboards, ridge tiles, chimney pots and a plinth. Streets get wheelie bins, telegraph poles with line wires and drops to the houses, pillar boxes, litter bins and benches. All of it is built inside the existing tile meshes, so it adds no draw calls.
* **Image and frame rate**: the scene renders at a dynamic internal resolution and is upscaled with FSR 1 (edge-adaptive upsampling + sharpening), so the image stays sharp while the scale moves to hold 60 fps (30 fps evenly paced as the floor). The cloud sky is baked into a cube map four times a second instead of raymarched per pixel; cars beyond 70 m use a light LOD.
* **Buildings measured from LIDAR**: every footprint's wall height, roof type (flat, gabled, hipped), roof height and ridge direction come from the Environment Agency LIDAR surface model (OGL), registered to the OSM footprints block by block (`tools/pipeline/lidar_buildings.py`, summary in `docs/COVERAGE.md`).
* **Driving and crashes** (`src/carPhysics.js`): each car is a rigid body on slip-angle tyres, with weight transfer, an engine power curve and automatic gearbox (5–7 gears), drag, engine braking and a rear-locking handbrake. Grip drops on wet roads, gravel and grass. Light stability assists (counter-steer and a yaw limiter) are tuned per model, weakest on the sports cars. Collisions are impulses at the contact point against buildings, walls, big trees and other cars: glancing blows scrape and turn you, struck cars are shoved and spin, and hard hits are reported to the police. Street things give way (`src/breakables.js`, thresholds in `src/breakSpec.js`): hit hard enough, lamp posts and telegraph poles snap and topple (lamps go dark), young trees fall, wheelie bins, litter bins, benches and fence panels are thrown, pillar boxes go over, hedges and shrubs are flattened and garden walls burst into bricks, each taking only part of your speed; nose into them slowly and they stop you. Buildings, mature trees, tall walls and guard rails always stop you. Crashes throw glass, paint chips, plastic and sparks, shed number plates and trim, jolt the body on its springs, leave smashed fronts steaming, and play the biggest hits in a moment of slow motion (`?slowmo=0` turns that off). Four damage zones per car crumple the bodywork, crack glass and break lamps; a smashed front loses power and pulls to one side (Dev panel → Repair). Also: skid marks, tyre smoke, an engine note that follows rpm, tyre squeal and scrapes, sprung bodies that dive and roll, a speed-widened camera and impact shake. `tools/test/unit/carphysics.test.mjs` checks 0–60 times, top speeds, braking distances (wet and dry), cornering, handbrake turns, crashes and tunnelling.
* **The brothers' Range Rover** (`src/heroCars.js`, `www/vehicles/rangerover.glb`): Cal's and Leon's own cars are Range Rovers, parked at the start; either brother can drive either one, and Dev → Range Rover delivers another.
  - The model is the supplied one, with the wheels on their real axles: they roll with the distance driven and the fronts steer.
  - Handling: permanent four-wheel drive, a 330 kW V8 through eight gears and 2.45 t on air suspension; about 4.5 s to 60 mph and 150 mph flat out.
  - Lights are lit per pixel where the model's lenses are: headlights with DRLs, tail and brake lights, the high-level brake light, reversing lights and indicators.
  - The glass is glossy and tinted, and crashes crumple, scuff and break the lamps.
  - Sound: a real V8 (CC0 recordings) rebuilt into rpm-matched loops, with its own start-up and throttle blips.
* **People and cars**: one continuous, procedurally skinned body per person (eight canvas-baked faces with eyes, lashes, brows, stubble, beards, lips and age lines; strand-textured hair on hairline-following shells; clothing, hats, hoods, umbrellas, hi-vis), animated walking, running and posing on the GPU; detailed cars (hatch, hot hatch, saloon, estate, SUV, van, coupé, mid-engined sports car, police). Bodies are lofted shells with flat sides, a shoulder crease and a realistic cabin. Glass with pillars, swept headlights with projector bowls and LED strips, wraparound tail lights (brake, reversing, indicators), grilles, badges, shut lines and road grime are drawn per pixel. Cars also have UK plates, mirrors, cockpits, alloys and contact shadows, and AI cars indicate before turns.
* **Cameras**: the Cam button (or C) cycles Chase, Far chase, High, Driver and Cinematic while driving, and Close, Far and High on foot.
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
npm run test                # unit tests (node --test, tools/test/unit)
bash tools/shadercheck/run.sh   # every material on WebGL2 (GLSL errors) and WebGPU (WGSL validated with naga, vertex-buffer limits)
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

# Asset and source register · v0.6.0

Every input that ends up in the game or the APK, with its licence, date and use. Generated data can be rebuilt from these inputs with `tools/pipeline/` (see the README).

## Geographic data

| Source | Licence and attribution | Version / date | Coverage | Used for | Confidence |
|---|---|---|---|---|---|
| OpenStreetMap, South East England extract (`south_east-latest.osm.pbf`, download.openstreetmap.fr, md5 `b9fde87b30fc4a58dfc25b42e75b23c3`) | ODbL 1.0, “© OpenStreetMap contributors”. `www/world/` is a derived database and is distributed under ODbL. | Replication timestamp 2026-11-19T02:11:32Z | Cut to lon −1.10…−0.70, lat 51.385…51.52 (`tools/pipeline/extract_osm.py`; the world is the study area lon −1.005…−0.725, lat 51.385…51.485 plus a corridor along the M4 from J12 to J8/9) | Building footprints and tags, roads and lanes, bridges and layers, traffic signals, crossings, bus routes and stops, landuse, water, railways, barriers, street lamps, trees, shop names | Measured geometry as mapped. Attribute completeness is in docs/COVERAGE.md |
| Environment Agency LIDAR Composite Digital Terrain Model 1 m, WCS `Lidar_Composite_Elevation_DTM_1m` | Open Government Licence v3.0, “Contains public sector information licensed under the Open Government Licence v3.0. © Environment Agency copyright and/or database right.” | Fetched 2026-11-22, extended 2026-11-25 | BNG E 463000–491000, N 165000–181000 at 4 m posting (`tools/pipeline/fetch_terrain.py`, extended by `tools/pipeline/extend_terrain.py`) | Terrain heights, road and bridge-end heights, building bases | Measured (bare-earth LIDAR); resampled to 4 m |
| Environment Agency LIDAR Composite DSM 1 m, last return, WCS `Lidar_Composite_Elevation_LZ_DSM_1m`, with the 1 m DTM above | Open Government Licence v3.0, “Contains public sector information licensed under the Open Government Licence v3.0. © Environment Agency copyright and/or database right.” | Fetched 2026-11-23, re-measured 2026-11-25 | Every 1 km block holding a building in the world (BNG E 463000–491000, N 165000–181000; `tools/pipeline/lidar_buildings.py`); not stored | Per-building wall height, roof type, roof height and ridge direction (DSM − DTM inside each OSM footprint) | Measured; one roof per footprint (see COVERAGE) |
| AWS Terrain Tiles (Tilezen/Mapzen, EU-DEM 30 m over this area) | Attribution per tilezen/joerd docs (EU-DEM: Copernicus/EEA) | Static dataset | Void fill only | Not needed for this area: 0 voids | – |
| OSTN15 NTv2 grid (`uk_os_OSTN15_NTv2_OSGBtoETRS.tif`, cdn.proj.org) | Ordnance Survey; free to use, distributed via PROJ-data | PROJ-data | GB | WGS84 → British National Grid transform in the pipeline | Sub-metre transform |
| Historic England, list entry 1001641 (cited in the v0.5 hand-off, docs/CITY-DESIGN.md, as describing the two lodges and Bath-stone carriage arch) | Historic England list text | Not re-checked in this session | Cemetery Junction | Design reference for the arch/lodges model; no dimensions taken from it | Reference description only |
| Reading Museum, “Our building history” (cited in docs/CITY-DESIGN.md) | Website text | Not re-checked in this session | Reading Town Hall | Design reference: Waterhouse clock tower, terracotta, contrasting local brick | Reference description only |

## Characters

`www/characters/cal.glb` and `www/characters/leon.glb` are the two playable brothers. Both were supplied by the project owner as Tripo-generated models with their animation sets, and were processed with `tools/characters/prepare-hero.mjs` (see `docs/CLAUDE-CHARACTERS.md`). `officer.glb` and `civilian.glb` come from the earlier character hand-over.

## Vehicles

`www/vehicles/rangerover.glb` is the brothers' Range Rover. It is a Tripo-generated model supplied by the project owner, processed with `tools/vehicles/prepare-car.mjs`: the body merged into one mesh, the four wheels split out about their axles, and the textures resized. The game draws it with `src/heroCars.js`, scaled to 4.95 m. The Range Rover name and badging belong to Jaguar Land Rover; the project uses them for the owner's private game.

## Sound recordings

`www/sfx/berkshire.ogg` holds 124 field-recording and foley cues (traffic, engines, horns, footsteps by surface, crowd, crashes). They are cut from CC0 and CC BY 3.0 recordings on OpenGameArt and Freesound. Each source, author and licence is listed in `www/sfx/CREDITS.txt`, which ships in the APK beside the bank; the CC BY items need that attribution kept. Cue offsets are in `src/soundCues.json`.

Nothing in the game is synthesised: every sound is a real recording.

`www/sfx/world.ogg` holds the rest of the world's sound, built by `tools/audio/build_sfx.py` from 39 Freesound recordings (37 CC0, two CC BY):
- tyre squeal, screech and skids, road roar and metal scrape for the player's car;
- rain (open air, and drumming on a car roof), wind, wind in leaves and a distant-traffic bed;
- a British police car siren, and UK pelican-crossing bleeps recorded in Hereford;
- the impacts of knocked-down street furniture: struck lamp posts, a pillar box, bins, timber poles, fences, trees, hedges, garden walls and glass.

The build excerpts each recording, levels it and turns loops seamless with an equal-power crossfade. The cue offsets are in `src/worldCues.json`.

`www/sfx/inline4.ogg` is the four-cylinder engine used by every car that is not a V8. `tools/vehicles/engine_bank_i4.py` builds it from Nox_Sound's CC0 recordings of a Peugeot 308: its idle is rebuilt as seamless loops at 800–7,200 rpm, with a real throttle blip on top.

Every recording is credited in `www/sfx/CREDITS.txt`.

`www/sfx/rangerover.ogg` is the Range Rover's V8, built by `tools/vehicles/engine_bank.py` from two CC0 recordings on Freesound:
- "Crown Victoria Startup and idle" by Therancher01 (Ford 4.6 V8, https://freesound.org/s/610774/). The start-up is used as recorded, and its idle is rebuilt as seamless loops at 800–5,600 rpm.
- "S63 AMG V8 Engine Revs" by marcelweiss (https://freesound.org/s/505321/), for the throttle blip.

No official Land Rover audio is used: none is available under a licence the game could use. Both recordings are credited in `www/sfx/CREDITS.txt`.

## Surface textures (photographic, CC0)

Downloaded from Poly Haven (polyhaven.com) on 2026-11-23 by `tools/assets/fetch_textures.py`. All Poly Haven textures are **CC0 1.0** (public domain, no attribution required; credited here anyway). Each is reduced to 512 px: the albedo has its AO map multiplied in at 35%, and the second image packs the OpenGL normal map (RG) with roughness (B). The files are `www/assets/tex/<layer>_a.jpg` and `<layer>_n.jpg`, about 3.4 MB in total. Colours are re-tinted in the shaders per building, landcover class and weather.

| Poly Haven asset | Used as | Metres per repeat |
|---|---|---|
| `asphalt_02` | asphalt | 3.0 m |
| `concrete_pavement` | flags | 1.8 m |
| `herringbone_pavement` | blocks | 2.0 m |
| `concrete` | concrete | 4.0 m |
| `leafy_grass` | grass | 2.0 m |
| `red_brick_03` | brick_red | 1.0 m |
| `brick_wall_001` | brick_dark | 3.0 m |
| `brick_wall_02` | brick_buff | 2.0 m |
| `painted_plaster_wall` | render | 2.0 m |
| `pebble_embedded_concrete` | pebbledash | 2.6 m |
| `clay_roof_tiles` | roof_clay | 4.0 m |
| `roof_slates_02` | roof_slate | 3.0 m |
| `asphalt_04` | felt | 4.04 m |
| `corrugated_iron_02` | cladding | 2.7 m |
| `gravel_floor` | gravel | 2.25 m |
| `bark_brown_02` | bark | 1.0 m |
| `farm_soil` | soil | 2.0 m |
| `sandstone_blocks_08` | stone | 3.0 m |
| `plaster_grey_04` | concrete_wall | 1.5 m |
| `forest_leaves_02` | forest | 3.001 m |

The leaf-cluster texture for tree crowns is drawn procedurally on a canvas at start-up (`src/vegetation.js`).

## Software

| Component | Licence | Version | Use |
|---|---|---|---|
| three.js (WebGPURenderer, TSL, Earcut copy in `src/extras/lib/earcut.js`) | MIT | 0.186.1 | Rendering, node materials, polygon triangulation (worker) |
| esbuild | MIT | 0.25.10 | Bundling `www/app.js` and `www/worker.js` |
| pyosmium, pyproj, shapely, numpy, Pillow | BSD / MIT / BSD / BSD / HPND | 4.3.2 / 3.8.0 / 2.2.0 / 2.5.3 / current | Data pipeline only (not shipped) |
| Playwright + Chromium | Apache 2.0 / BSD | Pre-installed | Acceptance run and captures only (not shipped) |
| Android SDK build-tools 35.0.0, platform android-35 | Android SDK licence | 35 | Building the APK (not shipped beyond the platform runtime) |

## Generated in this project (original work)

* **Textures**: value-noise, FBM and Worley textures, cloud noise, window interiors (parallax rooms, shop shelving, curtains), road markings and the tree leaf clusters are procedural (`src/env.js`, `src/materials.js`, `src/vegetation.js`). Surface materials (brick, render, roof tiles, asphalt, paving, grass, bark and so on) use the CC0 photographs listed above.
* **Models**: people, vehicles (hatchback, saloon, estate, SUV, van, single- and double-deck bus, police estate in Battenburg-style livery), street lamps, signal heads, Belisha beacons, bus shelters, canopies, the Cemetery Junction gateway and Reading Town Hall are procedural geometry in `src/`.
* **Shop fascia text**: rendered at runtime from OSM `name` tags in plain type. These are factual street names and shop names, not logos. Brand marks are never reproduced.
* **Launcher icon**: drawn by `tools/android/icon.py`.
* **Railway stations and train paths** (`www/world/rail.json`, built by `tools/rail/build_rail.mjs`): track centre lines are the OSM `railway=rail` lines already in the tiles (ODbL). Station positions are the WGS84 coordinates on the English Wikipedia articles (Reading, Reading West, Earley, Winnersh Triangle, Winnersh, Wokingham, Bracknell, Martins Heron; fetched via the MediaWiki `prop=coordinates` API, Nov 2026), snapped to the nearest track (1–59 m). `manifest.stations` replaces them when the world data provides it. There is no timetable: trains run evenly spaced.

## Legacy prototype assets (kept in `legacy/`, not shipped in v0.6)

| Asset | Licence | Note |
|---|---|---|
| `legacy/assets/portrait.jpg`, `portrait.js` (Lee Perry-Smith head scan, Infinite-Realities, via three.js examples) | CC BY 3.0 | Used by the v0.3–v0.5 prototype only |
| `legacy/assets/facades.jpg` | Prototype asset (origin recorded in the prototype hand-off) | Not used by v0.6 |
| `legacy/map.js` | ODbL (OSM-derived) | Prototype corridor extract, superseded by `www/world/` |

## Signing

`builds/Green-County-0.20.0-dev.apk` is signed (APK signature scheme v2; the app needs Android 8+) with the original **development key** (`CN=Green County Development`, SHA-256 `2e65a803dd6285bca94a1d76cb7ae7dd8ab4475b6d847c957a09bb8c4e2f7ff3`), which also signed v0.6–v0.18. v0.19.0 was signed in another build container with a different key (SHA-256 `2e5c058127d712fe261a6074481d794115c08e73a50c4d56bbeda295ba650e2b`), so going from v0.19.0 to v0.20.0 needs an uninstall. v0.20.0 is version code 20, built with the Android SDK by `tools/android/build.sh`. The key isn't committed (`*.keystore` is git-ignored). Android won't install a differently-signed update over the top: uninstall first. The previous v0.5 APK used another key, so v0.6 needs a fresh install too. Prototype saves held by the old file:// WebView origin are handed over by `migrate.html` only when that data is still on the device.

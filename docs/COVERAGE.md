# Green County · world coverage report (v0.6.0)

Built 2026-11-22T22:02:40Z from the OpenStreetMap South East England extract (2026-11-19T02:11:32Z) and the Environment Agency LIDAR Composite DTM 1m (WCS, resampled to 4 m), Open Government Licence v3.0. Every number below is a count taken from the build or a computed comparison against those inputs. Nothing here is an accuracy estimate.

## Coverage area

* Continuous coverage polygon: **52.02 km²**, streamed as **1067 tiles** of 256 × 256 m (tiles whose edge comes within 150 m of the polygon).
* Union of district discs (Reading town centre, Cemetery Junction, East Reading, Earley, Lower Earley, Woodley, Winnersh, Wokingham, Bracknell town centre) plus a 380 m buffer around every A329 and A329(M) carriageway between Reading town centre and Bracknell. The polygon is stored in `www/world/manifest.json` (`coverage`).
* Frame: British National Grid (EPSG:27700, OSTN15) → world metres `x = (E − 479000)/K`, `z = −(N − 171000)/K`, `K = 0.999677` (scale factor at the centre), `y` = metres above Ordnance Datum Newlyn. Each tile renders relative to its own origin.
* Outside the polygon the streamed tiles still carry terrain, roads and landcover, but no buildings.

## Buildings by district

| District | Buildings | Height from `height` tag | from `building:levels` | inferred from type / area / location | Roof shape tagged | Roof inferred | Pitched | Flat |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Reading town centre | 10654 | 2 (0.0%) | 369 (3.5%) | 10283 (96.5%) | 133 | 10521 | 8712 | 1942 |
| Woodley | 9771 | 0 (0.0%) | 80 (0.8%) | 9691 (99.2%) | 0 | 9771 | 8037 | 1734 |
| Earley | 6578 | 13 (0.2%) | 269 (4.1%) | 6296 (95.7%) | 63 | 6515 | 5600 | 978 |
| Lower Earley | 5725 | 0 (0.0%) | 15 (0.3%) | 5710 (99.7%) | 0 | 5725 | 4594 | 1131 |
| A329 / A329(M) corridor | 3510 | 0 (0.0%) | 36 (1.0%) | 3474 (99.0%) | 2 | 3508 | 3134 | 376 |
| Cemetery Junction | 3254 | 0 (0.0%) | 42 (1.3%) | 3212 (98.7%) | 69 | 3185 | 3024 | 230 |
| Winnersh | 3172 | 0 (0.0%) | 96 (3.0%) | 3076 (97.0%) | 1 | 3171 | 2699 | 473 |
| Bracknell town centre | 1919 | 74 (3.9%) | 447 (23.3%) | 1398 (72.9%) | 79 | 1840 | 1305 | 614 |
| Wokingham | 1740 | 0 (0.0%) | 42 (2.4%) | 1698 (97.6%) | 3 | 1737 | 1432 | 308 |
| East Reading | 305 | 0 (0.0%) | 3 (1.0%) | 302 (99.0%) | 1 | 304 | 235 | 70 |
| **All** | **46628** | 89 (0.2%) | 1399 (3.0%) | 45140 (96.8%) | 351 | 46277 | 38772 | 7856 |

*Footprints* are measured geometry (OSM, mostly traced from Ordnance Survey OpenData / aerial imagery by mappers). Each one becomes its own closed mesh with courtyards (inner rings) kept. *Heights* fall back to type-based storey heights when untagged (house 2 storeys × 2.75 m, terrace and semi the same, bungalow 1, garage 2.5 m, town-centre cores 3–5 storeys, retail sheds 6.5 m, industrial 8–11 m). *Pitched roofs* go on houses whose footprint fills its minimum rectangle, or whose largest inscribed rectangle covers at least 45% of it; rear extensions then get flat roofs. Gabled versus hipped is a deterministic per-building choice unless `roof:shape` is tagged.

**Façades are procedural, not photographed.** No façade photography was imported. Brick, render, pebbledash, cladding, window rhythm, stone sills, doors (on the side facing the nearest road), shopfronts (any building containing an OSM shop or amenity point; frontage on the side facing the street or pedestrian precinct) and lit windows at night are generated per building from its type and a stable seed. Shop fascia names come from OSM `shop`/`amenity` nodes (1048 signs).

## Roads, junctions and street furniture

* Graph: 41415 edges (23772 drivable, 19232 named), 397 bridge and 139 tunnel edges. Carriageway, pavement, path and plaza surfaces are polygon unions per tile, so junctions have no overlaps; pavements are raised 0.12 m behind kerbs.
* Lanes tagged on 6317 edges, width tagged on 363, maxspeed on 15572; the rest use UK defaults by road class (documented in `build_world.py`). Pavement presence is tagged on 8293 edges and inferred elsewhere (urban classes within 45 m of a building).
* Bridges: deck heights interpolate the LIDAR ground at each end and are raised wherever clearance over a lower road, railway or watercourse would fall below 5.6 m, 6.2 m or 1.2 m respectively (730 adjustments). Flyovers and underpasses keep separate surfaces: walkers and vehicles take whichever deck is nearest their current height.
* Signals: 253 controllers covering 1383 vehicle approaches and 707 signalised pedestrian crossings. **All timings are simulated** (simulated (no published phase data imported)): 14–38 s greens by road class, 3 s amber, 2 s red-amber, 2 s all-red, a demand-called pedestrian stage (7 s green man, 5 s flashing), and pelican-style standalone crossings. Approaches are grouped into stages by road axis at runtime.
* Crossings mapped on drivable roads: 707 signalised, 307 zebra (with zig-zags and Belisha beacons), 3686 uncontrolled.
* Buses: 136 of 136 OSM bus-route relations reconstructed onto the graph (longest continuous run inside the area); 645 stops, 207 tagged with shelters (only those get shelter models). Routes: 1, 10, 108, 11, 126, 127, 128, 129, 13, 14, 143, 15, 156, 16, 17, 171, 172, 18, 194, 19a, 19b, 19c, 2, 200, 201, 202, 21, 21a, 22, 23, 24, 25, 26, 27, 28, 28a, 29, 2a, 3, 33, 3b, 4, 400, 401, 403, 444, 4a, 5, 50, 507, 508, 509, 50a, 6, 702, 703, 8, 850, 9, 9a.
* Street lamps: 97 mapped in OSM; 14824 **inferred** (placed every 30–36 m on urban roads where none are mapped).
* Trees: 1936 mapped individually; 283304 **scattered** by landcover density (woodland, parks, gardens, cemeteries).
* Boundary walls, fences, hedges and guard rails: 1285 mapped lines are modelled with collision.
* Front gardens (**inferred**): every house whose frontage wall sits at least 1.6 m behind the back of the pavement gets a boundary. That is a hedge (40%), a low brick wall (42%) or an open frontage, with collision, plus a gap holding either a 3 m driveway (block paving or tarmac) or a flagged front path to the house. Mapped boundaries take precedence visually but are not de-duplicated against the inferred ones.
* Parking: 35730 slots, **inferred** (car-park polygons on a 2.6 × 7.5 m grid; kerbside on residential roads). Occupancy is stable per slot ID.

## Terrain

* Environment Agency LIDAR Composite DTM 1m (WCS, resampled to 4 m), Open Government Licence v3.0. Fetched at 4 m posting through the public WCS; no voids in this area, so the EU-DEM fill was not needed. Sampled on a 4 m grid in each tile (16 m for the far ring). Surfaces drape onto the same triangles, and the terrain is sunk 0.25 m under hard surfaces.

## Hand-authored and reference-modelled places

| Place | Status | Evidence used | Estimated |
|---|---|---|---|
| Cemetery Junction gateway (1843) | Reference-modelled on the OSM `Cemetery Arch` footprint (13.3 × 7.0 m) | OSM footprint and orientation; Historic England description of a Bath-stone carriage arch with lodges | Arch opening 4.2 × 5.6 m, overall height 9.7 m, lodge bay height 5 m, pilaster and cornice detail. Lodge bays have no collision. |
| Reading Town Hall (Waterhouse, 1875) | Reference-modelled: OSM footprint walls with polychrome brick, stone banding and gothic window rhythm, hipped slate roof, clock tower with faces showing world time | OSM footprint (1,833 m², tagged 4 levels); Reading Museum’s description of the Waterhouse tower, terracotta and local brick | Wall height 15.5 m, tower 6.2 m square × 26 m plus 9 m spire, tower placed at the footprint corner nearest Town Hall Square |
| Woodley precinct | OSM shops, pedestrian area and footprints; **58 canopy segments** generated along every shop frontage facing the pedestrian area (2.6 m deep, 3.1 m high), which also shelter from rain | OSM geometry | Canopy depth, height and continuity are assumptions; they have not been surveyed |
| `building=roof` canopies | 83 OSM roof structures (petrol stations, car washes, walkways) drawn as roofs on posts | OSM | Height 3.4 m (4.6 m at fuel stations) unless tagged |
| Town-centre approaches | Same pipeline as everywhere else; no extra authored detail yet | OSM | – |

## Verification against the inputs

Recomputed by `tools/pipeline/verify.py`, which writes `docs/verification.json`.

| Check | Result |
|---|---|
| Landmark positions (OSM centroid → world → WGS84) | round-trip error ≤ 0.0 m for 6 landmarks |
| Distances between 6 landmarks (world metres vs WGS84 geodesic) | max difference 0.0050% (e.g. Cemetery Arch (Cemetery Junction) → Woodley Library (precinct): 3072.32 m vs 3072.47 m) |
| A329 route length, Reading TC to Bracknell (all carriageways, 505 OSM ways) | world 32.09 km vs geodesic 32.089 km (+0.0032%) |
| A329(M) route length, Reading TC to Bracknell (all carriageways, 41 OSM ways) | world 17.177 km vs geodesic 17.176 km (+0.0043%) |
| Building footprint areas (48144 footprints) | world 5.9862 km² vs ellipsoid 5.9858 km²; per-building ratio mean 1.00005, 1st–99th percentile 0.99998–1.00012 |
| Signal coverage | 591 of 593 OSM `traffic_signals` nodes lie within a modelled controller; documented phase timings imported: 0 |

## Still to do, by area and system

* **Hardware performance is unmeasured.** Nothing has run on an Honor Magic 6 Pro or any phone. Frame time, memory and stall figures exist only from software rendering in this container, which says nothing about device performance. The APK writes a performance log from the Dev panel (Save perf log).
* **WebGPU rendering is unverified.** The renderer starts on WebGPU where `navigator.gpu` exists and switches itself to WebGL2 (remembered per version) on device loss or pipeline errors. In this container WebGPU failed (SwiftShader/lavapipe), so every capture uses WebGL2. Whether Android WebView exposes WebGPU on the target phone still has to be checked.
* Façade photography, shopfront detail and per-building materials (OSM `building:colour`/`building:material` are read but not yet used).
* Front gardens and driveways are inferred, not surveyed; there are no bay windows, porches, gutters or attached garages yet, and no rear gardens or fences between plots.
* Signal timings: no published phase data (Reading Borough Council / Bracknell Forest UTC) has been imported; all timings are simulated.
* Lane-level junction geometry: no turn lanes or slip-lane markings from `turn:lanes`; vehicles keep lane counts but don’t pick lanes for turns; roundabout markings are minimal.
* Underpasses and tunnels cut into terrain (OSM `tunnel=*`) are not carved out of the terrain mesh.
* Railways: track and ballast only. No stations beyond the OSM buildings, and no trains.
* Pedestrians follow pavement offsets on the road graph with crossings, but not the separately mapped OSM sidewalks; corners are cut at junction mouths.
* Police: one patrol car per beat (6) and four foot-patrol pairs; incidents are rear-end shunts (natural ones every 5–12 minutes near the player, or staged from the Dev panel) and player offences. Witnesses phone it in, the nearest unit is dispatched, attends for about 75 s, and returns to patrol.
* Audio is synthesised (no recorded sounds); voices are formant-filtered murmur, not speech.
* Benchmarks: Woodley precinct and Cemetery Junction have the most hand detail (canopies, arch), but neither has been compared with photographs from public vantage points yet.

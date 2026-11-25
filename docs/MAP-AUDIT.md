# Map audit: roads, paths and water (v0.17.0)

What was checked, what was wrong and what changed. Every number is computed from the OSM extract
(`berks.osm.pbf`, South East England extract of 2026-11-19, cut to lon −1.005…−0.725, lat 51.385…51.485), the
EA LIDAR DTM and the built world (`www/world`). Scripts: `tools/pipeline/build_world.py` (world),
`tools/test/unit/*.test.mjs` (tests).

## The finding

The world used to be built only inside a "coverage" shape: a disc around each of nine districts plus a 380 m
band along the A329/A329(M), **52 km²** of the **206 km²** study area. Everything else on the map was missing.
Roads were not dropped by type; they were cut off at the edge of that shape:

| | before (v0.16) | after (v0.17) |
|---|---|---|
| World area | 52.0 km², 1,067 tiles | **206.4 km², 3,432 tiles** (the whole study area) |
| Drivable road (OSM ways touching the study area: 2,145 km, some running past its edge) | 894 km inside the world | **1,927 km**, 97% of it one connected network |
| Footways, paths, cycleways, bridleways, tracks, steps (1,134 km in the extract) | 450 km inside the world | **1,124 km** (footway 605, cycleway 227, path 145, track 106, bridleway 31, pedestrian 6, steps 4) |
| Whole network (roads and paths together) | — | **3,256 km**, 99.5% one connected network |
| Named drivable roads mostly outside the world | 2,082 of 4,074 | 0 (only roads crossing the study-area edge are cut, at the edge) |
| Open water inside the world | 132 ha of 612 ha | **605 ha** (the rest lies beyond the study-area edge) |
| Buildings | 46,628 | 85,420 |

Examples: **Sandford Lane** (1.5 km, Hurst/Dinton Pastures) was 45% inside the world and stopped half way; it is now
all there, all 23 sections in the main drivable network. Lodge Road, Hurst Road, Sindlesham Road, Mole Road,
Bearwood Road, Park Lane, Whistley Mill Lane, Broadcommon Road and Church Lane were entirely missing; they are now in.

Road classes kept (all of them): motorway, trunk, primary, secondary, tertiary, unclassified, residential, living
street, service, their link roads and busways for traffic; footway, path, pedestrian, steps, cycleway, bridleway,
track and corridor for people. `highway=road` (type not yet surveyed, 0.3 km) used to be dropped and is now driven as
unclassified. Only roads under construction and `highway=no` are left out.

Detached drivable pieces that remain (3% of the length) are roads that leave the study area and come back, or
private service roads reached only on foot. The largest are Nashgrove Lane (5.8 km) and Oak Drive (2.4 km) at the
southern edge.

## Water

Every mapped water area and open (not culverted) waterway in the study area is now water you can see, wade and
swim in. The EA DTM is flat over open water, so it gives each water body's real surface level; the beds are carved
below it (inferred depths, deepest away from the shore).

| Water | Level (m ODN) | Deepest |
|---|---|---|
| Redgrave Pinsent Rowing Lake | 34.3 | 6.0 m |
| Black Swan Lake (Dinton Pastures) | 37.19 | 5.8 m |
| White Swan Lake (Dinton Pastures, joined to Black Swan) | 37.19 | 5.8 m |
| Bearwood Lake | 55.99 | 4.75 m |
| South Lake (Woodley) | 52.97 | 3.5 m |
| Sandford Lake (Dinton Pastures) | 36.97 | 3.4 m |
| Lea Farm Lake | 36.74 | 3.3 m |
| Charvil Country Park lakes | 33.7–34.6 | 3.2–3.35 m |
| Whiteknights Lake | 57.32 | 3.3 m |
| Lavell's Lake (Dinton Pastures) | 36.81 | 2.8 m |
| Herons Water, Tufties Corner, The Moors, Redwood Lake, Middlemarsh (Dinton Pastures) | 37.0–37.9 | 2.0–2.6 m |
| River Thames (Caversham to Sonning) | 38.3 falling to 34.3 downstream | ~4 m |
| River Kennet | 36.6 → 35.5 | 2.9–4 m |
| River Loddon | 37.2 → 37.0 | 3.4–4 m |
| Emm Brook and other brooks | follow the valley | 0.4–0.6 m |

424 lakes and ponds, 32 river and canal channels and 446 brooks and ditches in all (`docs/COVERAGE.md`).

## Limits

* Lake and river **beds are inferred**: no bathymetry was imported. Levels are measured.
* Narrow brooks and ditches are drawn at least about 4 m wide (the terrain grid is 4 m).
* **Building heights in the new areas are not yet LIDAR-measured.** The 46,059 buildings measured before were carried
  across unchanged (`tools/pipeline/carry_lidar.py`, footprints matched exactly; 3 no longer matched). The ~39,000
  buildings new to the world keep OSM or inferred heights until `tools/pipeline/lidar_buildings.py` is run again: the
  Environment Agency LIDAR service returned 504 (gateway timeout) when this build was made.
* Roads that run out of the study area stop at its edge.

## Rebuilding

```
npm run world                                                     # build_world + fit_ll + canopies
python3 tools/pipeline/carry_lidar.py <previous www/world> www/world # or lidar_buildings.py when the EA WCS is up
npm run rail
```

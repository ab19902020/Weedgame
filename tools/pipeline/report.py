"""Generate docs/COVERAGE.md from www/world/coverage.json, docs/verification.json and (if present)
docs/captures/acceptance.json. Only counts and computed comparisons are reported; there are no
invented accuracy figures."""
import json, os, sys
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
cov = json.load(open(os.path.join(ROOT, 'www/world/coverage.json')))
man = json.load(open(os.path.join(ROOT, 'www/world/manifest.json')))
ver = json.load(open(os.path.join(ROOT, 'docs/verification.json')))
accp = os.path.join(ROOT, 'docs/captures/acceptance.json')
acc = json.load(open(accp)) if os.path.exists(accp) else None
def pct(a, b): return f'{(100 * a / b):.1f}%' if b else '–'
L = []
w = L.append
w('# Green County · world coverage report (v0.6.0)\n')
w(f"Built {cov['built']} from the OpenStreetMap South East England extract ({man['sources']['osm']['timestamp']}) and the {man['sources']['terrain']}. "
  'Every number below is a count taken from the build or a computed comparison against those inputs. Nothing here is an accuracy estimate.\n')
w('## Coverage area\n')
w(f"* Continuous coverage polygon: **{cov['coverageAreaKm2']} km²**, streamed as **{cov['tiles']} tiles** of 256 × 256 m (tiles whose edge comes within 150 m of the polygon).")
w('* Union of district discs (Reading town centre, Cemetery Junction, East Reading, Earley, Lower Earley, Woodley, Winnersh, Wokingham, Bracknell town centre) plus a 380 m buffer around every A329 and A329(M) carriageway between Reading town centre and Bracknell. The polygon is stored in `www/world/manifest.json` (`coverage`).')
w('* Frame: British National Grid (EPSG:27700, OSTN15) → world metres `x = (E − 479000)/K`, `z = −(N − 171000)/K`, `K = 0.999677` (scale factor at the centre), `y` = metres above Ordnance Datum Newlyn. Each tile renders relative to its own origin.')
w('* Outside the polygon the streamed tiles still carry terrain, roads and landcover, but no buildings.\n')
w('## Buildings by district\n')
w('| District | Buildings | Height from `height` tag | from `building:levels` | inferred from type / area / location | Roof shape tagged | Roof inferred | Pitched | Flat |')
w('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
tot = {}
for d, s in sorted(cov['buildings'].items(), key=lambda kv: -kv[1]['buildings']):
    n = s['buildings']
    for k, v in s.items(): tot[k] = tot.get(k, 0) + v
    w(f"| {d} | {n} | {s.get('height_tag:height', 0)} ({pct(s.get('height_tag:height', 0), n)}) | {s.get('height_tag:levels', 0)} ({pct(s.get('height_tag:levels', 0), n)}) | {s.get('height_inferred', 0)} ({pct(s.get('height_inferred', 0), n)}) | {s.get('roof_tag', 0)} | {s.get('roof_inferred', 0)} | {s.get('pitched', 0)} | {s.get('flat', 0)} |")
n = tot['buildings']
w(f"| **All** | **{n}** | {tot.get('height_tag:height', 0)} ({pct(tot.get('height_tag:height', 0), n)}) | {tot.get('height_tag:levels', 0)} ({pct(tot.get('height_tag:levels', 0), n)}) | {tot.get('height_inferred', 0)} ({pct(tot.get('height_inferred', 0), n)}) | {tot.get('roof_tag', 0)} | {tot.get('roof_inferred', 0)} | {tot.get('pitched', 0)} | {tot.get('flat', 0)} |\n")
w('*Footprints* are measured geometry (OSM, mostly traced from Ordnance Survey OpenData / aerial imagery by mappers). Each one becomes its own closed mesh with courtyards (inner rings) kept. *Heights* fall back to type-based storey heights when untagged (house 2 storeys × 2.75 m, terrace and semi the same, bungalow 1, garage 2.5 m, town-centre cores 3–5 storeys, retail sheds 6.5 m, industrial 8–11 m). *Pitched roofs* go on houses whose footprint fills its minimum rectangle, or whose largest inscribed rectangle covers at least 45% of it; rear extensions then get flat roofs. Gabled versus hipped is a deterministic per-building choice unless `roof:shape` is tagged.\n')
w('**Façades are procedural, not photographed.** No façade photography was imported. Brick, render, pebbledash, cladding, window rhythm, stone sills, doors (on the side facing the nearest road), shopfronts (any building containing an OSM shop or amenity point; frontage on the side facing the street or pedestrian precinct) and lit windows at night are generated per building from its type and a stable seed. Shop fascia names come from OSM `shop`/`amenity` nodes (' + str(cov['shopSigns']) + ' signs).\n')
r = cov['roads']
w('## Roads, junctions and street furniture\n')
w(f"* Graph: {r['edges']} edges ({r['drivable']} drivable, {r['named']} named), {r['bridges']} bridge and {r['tunnels']} tunnel edges. Carriageway, pavement, path and plaza surfaces are polygon unions per tile, so junctions have no overlaps; pavements are raised 0.12 m behind kerbs.")
w(f"* Lanes tagged on {r['lanesTagged']} edges, width tagged on {r['widthTagged']}, maxspeed on {r['maxspeedTagged']}; the rest use UK defaults by road class (documented in `build_world.py`). Pavement presence is tagged on {r['pavementsTagged']} edges and inferred elsewhere (urban classes within 45 m of a building).")
w(f"* Bridges: deck heights interpolate the LIDAR ground at each end and are raised wherever clearance over a lower road, railway or watercourse would fall below 5.6 m, 6.2 m or 1.2 m respectively ({r['bridgeClearanceAdjustments']} adjustments). Flyovers and underpasses keep separate surfaces: walkers and vehicles take whichever deck is nearest their current height.")
s = cov['signals']
w(f"* Signals: {s['controllers']} controllers covering {s['approaches']} vehicle approaches and {s['pedestrianSignalCrossings']} signalised pedestrian crossings. **All timings are simulated** ({s['timings']}): 14–38 s greens by road class, 3 s amber, 2 s red-amber, 2 s all-red, a demand-called pedestrian stage (7 s green man, 5 s flashing), and pelican-style standalone crossings. Approaches are grouped into stages by road axis at runtime.")
c = cov['crossings']
w(f"* Crossings mapped on drivable roads: {c['signal']} signalised, {c['zebra']} zebra (with zig-zags and Belisha beacons), {c['uncontrolled']} uncontrolled.")
b = cov['busRoutes']
w(f"* Buses: {b['reconstructed']} of {b['relations']} OSM bus-route relations reconstructed onto the graph (longest continuous run inside the area); {cov['busStops']} stops, {cov['busStopsWithShelterTag']} tagged with shelters (only those get shelter models). Routes: {', '.join(b['refs'][:60])}.")
w(f"* Street lamps: {cov['lamps']['mapped']} mapped in OSM; {cov['lamps']['inferred']} **inferred** (placed every 30–36 m on urban roads where none are mapped).")
w(f"* Trees: {cov['trees']['mapped']} mapped individually; {cov['trees']['total'] - cov['trees']['mapped']} **scattered** by landcover density (woodland, parks, gardens, cemeteries).")
w(f"* Boundary walls, fences, hedges and guard rails: {cov['barriers']} mapped lines are modelled with collision.")
w('* Front gardens (**inferred**): every house whose frontage wall sits at least 1.6 m behind the back of the pavement gets a boundary. That is a hedge (40%), a low brick wall (42%) or an open frontage, with collision, plus a gap holding either a 3 m driveway (block paving or tarmac) or a flagged front path to the house. Mapped boundaries take precedence visually but are not de-duplicated against the inferred ones.')
w(f"* Parking: {cov['parkingSlots']} slots, **inferred** (car-park polygons on a 2.6 × 7.5 m grid; kerbside on residential roads). Occupancy is stable per slot ID.\n")
w('## Terrain\n')
w(f"* {man['sources']['terrain']}. Fetched at 4 m posting through the public WCS; no voids in this area, so the EU-DEM fill was not needed. Sampled on a 4 m grid in each tile (16 m for the far ring). Surfaces drape onto the same triangles, and the terrain is sunk 0.25 m under hard surfaces.\n")
w('## Hand-authored and reference-modelled places\n')
w('| Place | Status | Evidence used | Estimated |')
w('|---|---|---|---|')
w('| Cemetery Junction gateway (1843) | Reference-modelled on the OSM `Cemetery Arch` footprint (13.3 × 7.0 m) | OSM footprint and orientation; Historic England description of a Bath-stone carriage arch with lodges | Arch opening 4.2 × 5.6 m, overall height 9.7 m, lodge bay height 5 m, pilaster and cornice detail. Lodge bays have no collision. |')
w('| Reading Town Hall (Waterhouse, 1875) | Reference-modelled: OSM footprint walls with polychrome brick, stone banding and gothic window rhythm, hipped slate roof, clock tower with faces showing world time | OSM footprint (1,833 m², tagged 4 levels); Reading Museum’s description of the Waterhouse tower, terracotta and local brick | Wall height 15.5 m, tower 6.2 m square × 26 m plus 9 m spire, tower placed at the footprint corner nearest Town Hall Square |')
w(f"| Woodley precinct | OSM shops, pedestrian area and footprints; **{sum(1 for c in man['canopies'] if c[6] == 0)} canopy segments** generated along every shop frontage facing the pedestrian area (2.6 m deep, 3.1 m high), which also shelter from rain | OSM geometry | Canopy depth, height and continuity are assumptions; they have not been surveyed |")
w(f"| `building=roof` canopies | {sum(1 for c in man['canopies'] if c[6] == 1)} OSM roof structures (petrol stations, car washes, walkways) drawn as roofs on posts | OSM | Height 3.4 m (4.6 m at fuel stations) unless tagged |")
w('| Town-centre approaches | Same pipeline as everywhere else; no extra authored detail yet | OSM | – |\n')
w('## Verification against the inputs\n')
w('Recomputed by `tools/pipeline/verify.py`, which writes `docs/verification.json`.\n')
w('| Check | Result |')
w('|---|---|')
dm = max(abs(d['diffPct']) for d in ver['distances'])
w(f"| Landmark positions (OSM centroid → world → WGS84) | round-trip error ≤ {max(l['roundTripErrorM'] for l in ver['landmarks'])} m for {len(ver['landmarks'])} landmarks |")
w(f"| Distances between {len(ver['landmarks'])} landmarks (world metres vs WGS84 geodesic) | max difference {dm:.4f}% (e.g. {ver['distances'][0]['from']} → {ver['distances'][0]['to']}: {ver['distances'][0]['geodesicM']} m vs {ver['distances'][0]['worldM']} m) |")
for k, v in ver['routes'].items():
    w(f"| {k} route length, Reading TC to Bracknell (all carriageways, {v['ways']} OSM ways) | world {v['worldKm']} km vs geodesic {v['geodesicKm']} km ({v['diffPct']:+.4f}%) |")
bb = ver['buildings']
w(f"| Building footprint areas ({bb['count']} footprints) | world {bb['worldAreaKm2']} km² vs ellipsoid {bb['ellipsoidAreaKm2']} km²; per-building ratio mean {bb['areaRatio']['mean']}, 1st–99th percentile {bb['areaRatio']['p01']}–{bb['areaRatio']['p99']} |")
sg = ver['signals']
w(f"| Signal coverage | {sg['withinAController']} of {sg['osmTrafficSignalNodes']} OSM `traffic_signals` nodes lie within a modelled controller; documented phase timings imported: {sg['documentedTimings']} |\n")
if acc:
    w('## Acceptance run (touch input)\n')
    env = acc.get('environment', {})
    w(f"Run {acc.get('started')} in headed Chromium ({env.get('userAgent', '')[:60]}…) under Xvfb with software GL ({env.get('gl')}), backend **{env.get('backend')}**, viewport {env.get('viewport')}. All input went through CDP touch events on the on-screen joystick, camera drag and HUD buttons. Captures are in `docs/captures/`.\n")
    w('| Step | Result | Notes |')
    w('|---|---|---|')
    for s_ in acc['steps']:
        notes = '; '.join(s_.get('notes', []))[:420].replace('|', '/')
        res = 'pass' if s_['ok'] else 'FAIL'
        if s_.get('rerun'):
            fa = s_.get('firstAttempt') or {}
            res += ' (re-run)'
            if fa.get('ok'):
                notes += ' — also passed in the main run; repeated in the re-run'
            else:
                notes += f" — main run failed ({(fa.get('fail') or (fa.get('error') or '')[:120])}); passed when re-run after the fix noted below"
        w(f"| {s_['name']} | {res} | {notes}{(' — ' + (s_.get('fail') or s_.get('error', '')[:200])) if not s_['ok'] else ''} |")
    w('')
    for r in acc.get('reruns', []):
        w(f"Re-run {r['started']}: {r['reason']}\n")
capdir = os.path.join(ROOT, 'docs/captures')
if os.path.isdir(capdir):
    w('## Captures\n')
    w('Real gameplay frames from the runs above (software WebGL2 at 915 × 412). `acceptance-run-8x.mp4` is the whole main run at 8× speed. `25-pursuit-emerged-during-drive.png` comes from the main run: during the flyover drive the driving script clipped another car within sight of a patrol, and a pursuit followed and resolved ("Police lost sight of you"). It was not staged. `L*.png` are landmark views taken by touch after the run. Reading Town Hall has no clean capture yet: its model is built and in place (bounding box x −7346…−7293, z −2630…−2564, spire top 80 m above datum, checked at runtime), but from the street views tried, neighbouring buildings or Forbury Gardens trees block it at the third-person camera distance.\n')
    w(', '.join(f'`{f}`' for f in sorted(os.listdir(capdir)) if f.endswith(('.png', '.mp4'))) + '\n')
w('## Still to do, by area and system\n')
for item in [
    '**Hardware performance is unmeasured.** Nothing has run on an Honor Magic 6 Pro or any phone. Frame time, memory and stall figures exist only from software rendering in this container, which says nothing about device performance. The APK writes a performance log from the Dev panel (Save perf log).',
    '**WebGPU rendering is unverified.** The renderer starts on WebGPU where `navigator.gpu` exists and switches itself to WebGL2 (remembered per version) on device loss or pipeline errors. In this container WebGPU failed (SwiftShader/lavapipe), so every capture uses WebGL2. Whether Android WebView exposes WebGPU on the target phone still has to be checked.',
    'Façade photography, shopfront detail and per-building materials (OSM `building:colour`/`building:material` are read but not yet used).',
    'Front gardens and driveways are inferred, not surveyed; there are no bay windows, porches, gutters or attached garages yet, and no rear gardens or fences between plots.',
    'Signal timings: no published phase data (Reading Borough Council / Bracknell Forest UTC) has been imported; all timings are simulated.',
    'Lane-level junction geometry: no turn lanes or slip-lane markings from `turn:lanes`; vehicles keep lane counts but don’t pick lanes for turns; roundabout markings are minimal.',
    'Underpasses and tunnels cut into terrain (OSM `tunnel=*`) are not carved out of the terrain mesh.',
    'Railways: track and ballast only. No stations beyond the OSM buildings, and no trains.',
    'Pedestrians follow pavement offsets on the road graph with crossings, but not the separately mapped OSM sidewalks; corners are cut at junction mouths.',
    'Police: one patrol car per beat (6) and four foot-patrol pairs; incidents are rear-end shunts (natural ones every 5–12 minutes near the player, or staged from the Dev panel) and player offences. Witnesses phone it in, the nearest unit is dispatched, attends for about 75 s, and returns to patrol.',
    'Audio is synthesised (no recorded sounds); voices are formant-filtered murmur, not speech.',
    'Benchmarks: Woodley precinct and Cemetery Junction have the most hand detail (canopies, arch), but neither has been compared with photographs from public vantage points yet.',
]:
    w('* ' + item)
open(os.path.join(ROOT, 'docs/COVERAGE.md'), 'w').write('\n'.join(L) + '\n')
print('wrote docs/COVERAGE.md')

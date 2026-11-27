# Road integrity pass — 27 November 2026
Base: `628eeeb` (latest atlas/home TV, audio and handling work).
Changes: remove invented centre barriers from bridge/ramp decks; guard all support rectangles and abutments against all drive levels and rail corridors; solve clearance from interpolated crossing heights, including connectors between spans; record approach/sag decks for audit; audit complete pier footprints and fail on tile errors.
Priority regression: Reading A329 IDR (Castle Hill, Windrush and the connecting ramps), then A33, A329(M), M4 J10 and all remaining roads.
Verification required on a complete checkout:
```sh
npm ci
npm test
TILES=-31_-9,-31_-10,-30_-7,-29_-12 node tools/test/workerAudit.mjs
npm run audit:roads
npm run build
```
The source pass is not a completed all-road visual audit: the connector cannot retrieve the binary world tiles or run the APK. Check both directions on the IDR at game speed, every grade-separated junction and tunnel entrance, road/marking alignment, underside headroom, collision and traffic routing. The existing world pipeline flags tunnels but does not construct a dedicated tunnel mesh or vertical profile; this remains a separate world-data/rendering task, not verified by this patch. No new APK or bundled worker is included; rebuild before playtesting.

The full road audit samples every drivable edge at intervals of no more than 8 m, at the centre and two quarter-width points; it compares the network height with the actual rendered road triangles, including bridge triangles emitted by neighbouring tiles. It lists missing surfaces, vertical mismatches over 35 cm, steep grades, and discontinuous junction heights, with IDR candidates prioritised in `road-audit.json`. This is an offline diagnostic, not proof that every vehicle collision or tunnel is correct. For selected-tile surface tests, include surrounding tiles because some decks are emitted by a neighbouring tile.

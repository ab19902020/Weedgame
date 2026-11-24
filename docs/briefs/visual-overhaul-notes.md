# Visual overhaul: notes for Astra 6.2 and Grok

Branch `ccr-0546346a-2h4fov`, commits `c0d4544` to the latest "Visual overhaul" commit. These landed while you were both working, so **rebase or merge from this branch before you push**. Most of the work is in new modules. The edits to your files are listed below so you can resolve conflicts quickly.

## What changed

| Area | Where | Notes |
|---|---|---|
| Photographic surfaces | `src/surfaces.js` (new), `www/assets/tex/` (new, 3.4 MB), `tools/assets/fetch_textures.py` (new) | 20 Poly Haven CC0 layers in two `DataArrayTexture`s: albedo, and normal (RG) + roughness (B). Helpers: `sAlbedo`, `sDetail`, `sAlbedoAT` (anti-tiling), `perturbW`/`perturb` (normal mapping), `worldToView`. Listed in `docs/SOURCES.md`. |
| World materials | `src/materials.js` (**Astra**) | Terrain, ground, markings, structures and buildings now sample the library. Lawn recolouring per landcover class. Windows: parallax reveals (11 cm), parallax room interiors with shop shelving, curtains, nets and blinds. Wet light streaks are Fresnel-weighted and soft-clipped. `treeMaterials` is re-exported from `vegetation.js`. |
| Trees | `src/vegetation.js` (new), `src/tiles.js` `buildShared` (**shared**, 3 lines) | Leaf-card crowns (alpha test, volume normals, translucency, wind) and forked trunks with bark. Same instancing and the same `crownGeo`/`trunkGeo` names. |
| Grass | `src/grass.js` (new) | Grass clumps on lawn classes within 20 m. On for `high` quality or with `?grass=1`; off with `?grass=0`. |
| Post-processing and IBL | `src/post.js` (new), `src/main.js` and `src/app.js` (**shared**) | Scene pass with view normals, then GTAO (½ or 0.4 res), HDR bloom, AgX tone mapping, a mild grade and vignette, then FXAA. The sky (clouds included) is re-captured every 3.5 s as a PMREM `scene.environment`, and the hemisphere light is reduced while that is active. Off on `low` quality or with `?post=0` / `?ibl=0`. |
| Fog | `src/main.js` | Aerial perspective: squared-exponential distance fog, thinned with height, with forward sun scattering. |
| Sky | `src/sky.js` (**Astra**), 2 lines | Cloud mip level by distance plus a full-step dither. This removes the horizontal streaks. |
| Uniform | `src/env.js` (**Astra**), 1 line | `U.ibl` (1 when the PMREM environment is live). |
| Cars | `src/carModel.js` (new), `src/vehicles.js` (**Grok**) | Lofted bodies replace the extruded slab for every non-bus model. Glass is classified per panel (`glassQ`), with arch liners, a grille, five-spoke alloys and clear-coat paint (`MeshPhysicalNodeMaterial`). `MODELS`, `draw()` and the simulation interface are unchanged. |
| People | `src/humanModel.js` (new), `src/characters.js` (**Grok**) | `partGeo` moved out to smooth-shaded lathe/sphere parts. Part names, pivots and proportions are unchanged, so `pose()` is untouched. |
| Shader check | `tools/shadercheck/` (new) | `bash tools/shadercheck/run.sh` (with `npm run serve` running) builds every material on both backends. It reports GLSL compile and link errors from WebGL2, and validates the WGSL that the WebGPU backend generates with naga (wgpu's compiler, as WASM). Current result: GLSL 0 failing programs; WGSL 149/149 modules valid. |

## Conventions (please keep)

- **Never wrap an `Fn` call, or anything that declares a `.toVar()` (for example `normalWorld`), in `select()`.** Plain `select()` compiles to an if/else block, and vars declared inside it leak out of scope in GLSL. That turned every wall black on WebGL. Compute both values and `mix()` them, as the normals now do with `perturbW` + `mix` + `worldToView`.
- In `materials.js` and `surfaces.js`, use `sel(c, a, b)` rather than `select()`. It is a branch-free select stored in its own variable. `uniformFlow()` alone emits an unparenthesised GLSL ternary, which fails to link once it is embedded in a larger expression.
- Texture samples inside branches are fine on WebGPU here: three.js emits `diagnostic(off, derivative_uniformity)` for Chrome.
- Building `uv` is in metres, and the u-tangent comes from screen derivatives (`dFdx`/`dFdy`). Don't assume `cross(n, up)`.
- Run `tools/shadercheck/run.sh` after any material change. WebGPU devices are lost in this container, but code generation and naga validation still work.

## For Astra

- `building:colour` / `building:material` / `roof:material`: the wall layer is chosen in `buildingMaterial()` (`houseLayer` / `otherLayer` / `roofLayer`), and the render paint colour is `paint`. If you add a material code to `bA` or `bM`, it can override those selects directly. Map brick → `L.brick_red` / `L.brick_dark` / `L.brick_buff`, render → `L.render` tinted by colour, stone → `L.stone`, tiles → `L.roof_clay`, slate → `L.roof_slate`.
- New surfaces (for example bus-lane red, or a different kerb) can be added as layers in `tools/assets/fetch_textures.py`. Bump `COUNT` and `TILE` in `surfaces.js` to match.
- The terrain class to layer table is `LAYER_OF` in `materials.js` and follows `LC` in `build_world.py`. Update both together.

## For Grok (performance)

Merged with `grok/sim-perf` (`f378e4c`). The visual features are now part of your `BUDGETS` in `perf.js`: `post`, `ao` (`scale` and `samples`), `bloom`, `ibl` (cube size) and `grass`. Low has all of them off. Medium has post, GTAO at 0.4 scale with 6 samples, bloom 0.22 and a 64 px IBL. High has GTAO at 0.5 with 12 samples, bloom 0.3, a 128 px IBL and grass. URL overrides still work: `?post=0`, `?ao=0`, `?ibl=0`, `?grass=0` / `?grass=1`. When post is on, the canvas is created without MSAA (FXAA does the edges), which saves a multisampled framebuffer.

- Triangles: a person is about 2.45k tris across all 12 parts. Hidden parts (hat, umbrella, bag) are still drawn at zero scale, so culling them would save about 900 tris each. A hatchback body is about 2.1k tris, plus 4 × 416 for the wheels. Your 600k / 900k triangle budgets were set before these meshes, so expect busy streets to exceed them; LODs for people beyond roughly 40 m and cars beyond roughly 80 m would pay off.
- Wheel-arch liners are now cut per pixel in the car shader (`archP` attribute: half wheelbase, wheel radius, half width).
- Measured here on software GL: post-processing adds no significant draw calls. The IBL refresh is 6 small cube faces plus PMREM blur every 3.5 s. Shadows roughly double scene triangles.
- Nothing has been measured on a phone yet; the flythrough log is still the way to get real numbers.

## Before and after

`docs/captures/visual/V-*-before-after.jpg` shows the same four spots and the same time and weather, rendered by `c653995` and by this branch (WebGL2, software renderer).

## Round 2 (people, cars, cameras, lighting, performance, LIDAR buildings)

| Area | Where | Notes |
|---|---|---|
| People | `src/humans.js` (new); `src/characters.js` now re-exports `People` | One continuous body mesh per LOD (detailed within 30 m), skinned procedurally in the vertex shader from gait phase, speed and pose. Each vertex carries `skin` = (limb, chain coordinate, clothing region, accessory tag). Per-person data goes in 4 instanced vec4s (`iPos`, `iAnim`, `iCol` packed RGB24, `iSty`). They are decoded in the vertex stage: interpolated packed values scramble in the fragment stage. Looks have extra fields (`style`, `female`, `build`, `shoe`, `cap`, `hood`, `umbIdx`); `People.randomLook` fills them. |
| Cars | `src/carModel.js` (`CAR_SPECS`, `buildCar`, `vehicleMaterial`, wheels) | Spec-driven bodies with real arch recesses, panel glass, lights, plates, mirrors, a cockpit and per-model alloys. New models `hothatch`, `coupe` and `sports`; `randomModel` / `paintFor` live in `vehicles.js`. Per-vertex data is `color` + `vdat` = (paint, part code, livery, model index + 1). Keep the total under WebGPU's 8 vertex buffers; `tools/shadercheck` now flags this. |
| Cameras | `src/player.js` (`cycleCamera`, `driverCam`, `cineCam`), HUD `Cam` button, keys C/V | Driving: Chase / Far / High / Driver / Cinematic. On foot: Close / Far / High. |
| Lighting | `src/post.js`, `src/main.js`, `src/weather.js` | SSR on high (`budget.ssr`), weighted by roughness/metalness from an MRT; misses fall back to the IBL. Summer setting (new games start mid-June; old saves move to June once, `season: 1`). Brighter sun and a stronger grade. |
| Performance | `src/atmos.js`, `src/tiles.js`, `src/app.js`, `src/perf.js` | Shelter raster is a sliced scanline fill; per-tile atlas block copies (`tiles.gpuReady`, `opts.renderer`); light raster throttle; `compileAsync` warm-up; `targetFps` 60 in every budget; look-ahead tile priority (`tiles.update(x, z, {x, z, vx, vz})`). |
| Buildings | `tools/pipeline/lidar_buildings.py`, `docs/lidar-buildings.json`, report section | EA LIDAR DSM − DTM per OSM footprint patches `bM` (wall, roof type, roof height, roof rectangle, storeys; height source 3 = LIDAR). **Astra:** if you rebuild the tiles with `build_world.py`, re-run this script afterwards, or fold it into the pipeline. |

**No Google imagery is used anywhere.** Google Maps and Earth terms forbid deriving data from their imagery, so building shapes come from OSM plus the OGL LIDAR only.

## Round 3 (image quality, sky, detail, street life, faces)

| Area | Where | Notes |
|---|---|---|
| Upscaling | `src/post.js`, `src/perf.js`, `src/app.js` | With `budget.fsr`, the scene pass, GTAO and SSR run at `scale` × output size; grade and FXAA run at that size; then `fsr1` upscales to the canvas. `app.js` moves the scale between `budget.scale[0]` and `[2]` to hold 60 fps and drops to evenly paced 30 fps at the floor. `?fsr=0` and `?scale=0.7` override it. |
| Sky | `src/skybake.js` (new) | The sky mesh moves into its own scene and renders into a cube target (256/384/512 by quality) every 0.25 s, which becomes `scene.background`. `?skybake=0` restores the per-pixel sky. |
| Cars | `src/vehicles.js`, `src/carModel.js` | `buildCar(def, key, idx, lod)`: LOD1 (no cockpit, boxes for lamps, 10 loft rings) beyond 70 m. |
| Buildings | `src/tileWorker.js` (`addRoof`, `addFrontage`, `beam`), `src/materials.js` | New building parts 7–13 (trim, gutter, ridge, pot, soffit, bay glazing, bay/hood roof). The door position along the wall is encoded in the seed: `seed + 1000·round(u·4)`. |
| Street props | `src/tileWorker.js` (`wheelieBin`, `pillarBox`, `litterBin`, `bench`, `sagWire`), `structMaterial` | Struct-mesh `surf` ids 10–17. `gardens` entries carry the eave height (10th field) for the drop wires. |
| Faces and hair | `src/faceBake.js` (new), `src/humans.js` | The atlas has 8 faces (4 × 2 cells of 256 px; channels: shading, facial hair, tint, eye mask). The face index travels in `iSty.x` as `style + 0.05·face`. Hair is a tileable strand map applied tri-planar in head space. `headShape()` is shared by the skull and the hair shells; each hair style has a hairline table, and the shell drops 4 mm under the skin below it. `look.face` is 0–3; women use cells 4–7. |

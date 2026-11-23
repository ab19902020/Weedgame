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

- Triangles: a person is about 2.45k tris across all 12 parts. Hidden parts (hat, umbrella, bag) are still drawn at zero scale, so culling them would save about 900 tris each. A hatchback body is about 2.1k tris, plus 4 × 416 for the wheels. LODs for people beyond roughly 40 m and cars beyond roughly 80 m would pay off.
- Measured here on software GL: post-processing adds no significant draw calls. The IBL refresh is 6 small cube faces plus PMREM blur every 3.5 s. Shadows roughly double scene triangles.
- Please fold `?post`, `?ibl` and `?grass`, GTAO resolution and samples (`post.js`), bloom, and the IBL cube size into the low/medium/high budgets. All of it is off on `low` today.
- Nothing has been measured on a phone yet.

## Before and after

`docs/captures/visual/V-*-before-after.jpg` shows the same four spots and the same time and weather, rendered by `c653995` and by this branch (WebGL2, software renderer).

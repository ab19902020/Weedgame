# Green County characters

Cal and Leon, the playable brothers, are the only skinned GLB characters (`src/riggedPeople.js`). Everyone else on the street, police on foot included, is the procedural crowd in `src/humans.js`: one instanced body mesh, skinned in the vertex shader, with its clothes, hair, accessories, gait and hit and shot reactions all generated in code. The officer and civilian GLBs from the earlier hand-over were removed in v0.36 at the owner's request, together with their Blender rigging script.

Open **Dev → Character preview** and pick **cal** or **leon** to stand a copy of a brother beside you, then choose any of his clips. Select **off** afterwards.

## Cal and Leon (the playable brothers)

Both brothers use detailed rigged models: `www/characters/cal.glb` (Cal, man in a jacket) and `www/characters/leon.glb` (Leon, man in a tracksuit). Both are built from the supplied Tripo GLBs by `tools/characters/prepare-hero.mjs`; the usage notes are at the top of that script.

- **Source:** Tripo exports with a 78–79-joint skin (fingers, twist bones, eyes) and three 4096 px maps (base colour, normal, roughness/metal), about 14 MB each. Leon came as 26 skinned meshes, Cal as one.
- **Fixes made by the script:**
  - Leon had five vertices bound only to `neutral_bone`, a joint no clip animates. Their triangles stretched back to the origin as spikes, so they now take the weights of their nearest neighbour.
  - Every clip had root motion (walk travelled 1.5 units per cycle). The hips' net travel is now removed linearly, so clips play in place; bob, crouch and jump arcs stay. Cal's `.001` suffixes are dropped from clip names.
  - Leon had no idle, so one was added: the standing pose from the start of `laugh_01`. Cal has his own `standing_relax`.
  - All parts are merged into one draw call, redundant keyframes are dropped, and textures are cut to 1024 px. That is about 16 MB of GPU memory per character instead of 256 MB, and 5.4–5.8 MB on disk.
- **Leon's clips (20):**
  - Game states: `idle`, `walk`, `run`, `jump`, `swim`.
  - Gestures: `agree`, `greet_01`, `laugh_01`, `afraid`, `turn`, `make_a_call_01`, `make_a_call_02`.
  - Moves: `front_kick_01`, `front_kick_02`, `flip`, `pitch_baseball`, `shovel`, `climb`, `jump_down`, `run_upstairs`.
- **Cal's clips (21):**
  - Game states: `standing_relax`, `walk`, `run`, `swim`.
  - Gestures: `scratch`, `turn`, `dance_04`, `make_a_call_01`.
  - Fighting: `box_01`, `box_02`, `front_kick_01`, `front_kick_02`, `chop`, `slash`.
  - Moves: `run_upstairs`, `shovel`, `surf`, `fall`.
  - Seated: `sit`, `play_mobile_game`, `play_video_game`.
- **In game** (`src/riggedPeople.js`, roles `cal` and `leon`, actors `brother0` and `brother1`): the brothers always use these rigs within 160 m and take priority over the NPC rigs. Cal is scaled to 1.78 m and Leon to 1.81 m; both cast shadows. Walk and run are speed-matched; natural speeds are Cal 1.16 and 4.18 m/s, Leon 1.21 and 4.38 m/s.
  - Jump plays Leon's `jump` and Cal's `run_upstairs` knee-lift (Cal's model has no jump).
  - Hit plays Leon's `front_kick_02` and Cal's `box_01`.
  - Standing still, Leon sometimes nods, laughs, looks round or takes a call; Cal scratches his head or looks round.
  - Cal's seated clips and his phone call (which is also seated) are preview only.
- **Preview:** Dev → Character preview → cal or leon, then any clip in the Cal or Leon row.

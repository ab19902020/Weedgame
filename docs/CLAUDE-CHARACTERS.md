# Green County character handover

The two character uploads are already integrated. Cal and Leon remain the playable brothers. Existing police foot patrols and incident officers use the officer rig near the camera. One in four numbered pedestrians uses the female civilian rig. The civilian wears a green top, jeans and dark footwear.

## Try both characters on mobile

Open **Dev → Character preview**, pick **officer** or **civilian**, then choose an animation and close the panel using ×. The preview stands beside the active brother, facing the camera. Select **off** afterwards. Use **Walk** and **Run** to inspect the opposite arm and leg swings from the front and side. **Jump** repeats a take-off and landing in preview. **Swim** shows a prone stroke. **WeaponHold** shows a hand-attached prop.

## Runtime integration

- The portable, textured GLBs live at `www/characters/officer.glb` and `www/characters/civilian.glb`. Each includes its own 19-joint skin, mesh, materials and six in-place animation clips. The jump includes a pelvis lift. The source downloads contained nested ZIP archives with an FBX and matching FBM texture folder at the innermost level.
- `src/riggedPeople.js` loads the templates once, clones skeletons, crossfades actions, faces each model along the existing actor heading and caps detailed actors at eight within 44 metres. The existing instanced people renderer covers the rest of the crowd and the loading interval.
- For new simulation behaviour, set `actor.pose` to `jump`, `swim` or `weaponHold`. Set it back to `walk` or `idle` when the action ends. Ordinary locomotion uses `speedNow` in metres per second. In-world pedestrians can run when fleeing. The preview exercises special actions independently of AI or controls. Water entry, jump collision and weapon gameplay would need their own simulation logic. Existing social gestures are represented by locomotion or idle on these detailed rigs.
- The prop attaches to `HandR`. Both hands have a single hand bone. Individual fingers, contact IK and motion capture are possible future improvements.
- To regenerate, use Blender 4.3 with the extracted FBX alongside its original FBM directory. Run `blender -b -P tools/characters/rig.py -- civilian /path/to/model.fbx www/characters/civilian.glb` from the project root. Substitute `officer` for the other model. Joint coordinates are fitted to these particular meshes.
- Run `npm ci && npm run build && npm run serve`, then open `http://localhost:8080/`. The Android packaging script includes the characters directory. Rebuild and sign with the project's Android SDK setup for a device test. The APKs already in the repository predate the character work.

## Release checks

Inspect shoulders, elbows, shoe contact and prop alignment while orbiting both models. Check the frame rate around a patrol in a busy street on the Honor Magic 6 Pro, including the transition to distant crowd models. Browser testing used software WebGL2. Android hardware and WebGPU still need verification.

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

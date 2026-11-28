# Green County characters

Cal, the playable character, is the only skinned GLB character (`src/riggedPeople.js`). Everyone else on the street, police on foot included, is the procedural crowd in `src/humans.js`: one instanced body mesh, skinned in the vertex shader, with its clothes, hair, accessories, gait and hit and shot reactions all generated in code. The officer and civilian GLBs from the earlier hand-over were removed in v0.36 at the owner's request, together with their Blender rigging script.

## Pedestrians: the citizen pack

Four in five ordinary pedestrians are one of the fourteen people of the supplied "Citizen NPC Pack 1" (00amza, CC-BY-4.0): eight men and six women, five of them in skirts. The pack has no skeleton, so `tools/characters/bake-citizens.py` fits each one to the crowd's procedural skeleton. It stands them at 1.79 m (the instance scale gives each their own height), finds their joints, sorts every vertex into torso, arm, leg or skirt with its place along the limb, and brings the A-pose arms down to hang at the sides. They then walk, run, sit, stand in their own ways and take blows and rounds exactly like the rest of the crowd, as fourteen instanced draws. Shop staff, police on duty and bus and train passengers stay procedural (uniforms, hi-vis, seating). Rebuild with `python3 tools/characters/bake-citizens.py <unzipped pack>` after unzipping `source-assets/incoming/citizen_npc_pack_1_character_lowpoly_mobile.zip`.

Open **Dev → Character preview** and pick **cal** to stand a copy of him beside you, then choose any of his clips. Select **off** afterwards.

## Cal (the playable character)

Cal Ward is the one playable character (until v0.47 the game had two brothers to swap between; Cal was kept for his fuller set of clips, his own standing idle and the better hold on a gun). He is a detailed rigged model, `www/characters/cal.glb` (man in a jacket), built from the supplied Tripo GLB by `tools/characters/prepare-hero.mjs`; the usage notes are at the top of that script.

- **Source:** a Tripo export with a 78-joint skin (fingers, twist bones, eyes) and three 4096 px maps (base colour, normal, roughness/metal), about 14 MB.
- **Fixes made by the script:**
  - Every clip had root motion (walk travelled 1.5 units per cycle). The hips' net travel is now removed linearly, so clips play in place; bob, crouch and jump arcs stay. The `.001` suffixes are dropped from clip names.
  - All parts are merged into one draw call, redundant keyframes are dropped, and textures are cut to 1024 px. That is about 16 MB of GPU memory instead of 256 MB, and 5.4 MB on disk.
- **Cal's clips (21):**
  - Game states: `standing_relax`, `walk`, `run`, `swim`.
  - Gestures: `scratch`, `turn`, `dance_04`, `make_a_call_01`.
  - Fighting: `box_01`, `box_02`, `front_kick_01`, `front_kick_02`, `chop`, `slash`.
  - Moves: `run_upstairs`, `shovel`, `surf`, `fall`.
  - Seated: `sit`, `play_mobile_game`, `play_video_game`.
- **In game** (`src/riggedPeople.js`, role `cal`, actor `brother0`): he always uses this rig within 160 m and takes priority over the NPC rigs. He is scaled to 1.78 m and casts shadows. Walk and run are speed-matched (natural speeds 1.16 and 4.18 m/s).
  - Jump plays the `run_upstairs` knee-lift (the model has no jump).
  - Hit plays `box_01`.
  - Standing still, he sometimes scratches his head or looks round.
  - The seated clips and the phone call (which is also seated) are used for the sofa (`sit`) or are preview only.
- **Preview:** Dev → Character preview → cal, then any clip in the Cal row.

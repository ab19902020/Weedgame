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

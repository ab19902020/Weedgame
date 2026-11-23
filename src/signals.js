// Signal controllers built from the OSM-derived junction clusters. Timings are simulated
// (no published phase data was imported) and labelled as such in the coverage report.
import * as THREE from 'three/webgpu';
import { mergeGeos } from './tiles.js';

const AMBER = 3, ALLRED = 2, REDAMBER = 2, PED_GREEN = 7, PED_FLASH = 5;
// Demand-actuated (vehicle-actuated) control, simulated: approach detectors ~60 m back from each stop line
// extend the green up to a maximum and stages with nobody waiting are skipped. Timings are simulated.
export const MIN_GREEN = 7, GAP = 3, MAX_GREEN_K = 1.6, DEMAND_MEMORY = 4;

export class Signals {
  constructor(net) {
    this.net = net; this.t = 0;
    this.ctl = net.controllers.map((c, i) => {
      const stages = [];
      for (let g = 0; g < c.groups; g++) stages.push({ kind: 'veh', g, green: c.green[g] || 25 });
      if (c.peds.length && !c.standalone) stages.push({ kind: 'ped' });
      return { ...c, i, stages, stage: 0, phase: 'G', timer: (i * 7.3) % 20, demand: false, standaloneGreen: 0, det: new Float64Array(Math.max(1, c.groups || 1)).fill(-1e9) };
    });
    this.actuated = true;
  }
  // a vehicle is on the approach detector of controller ci, signal group g
  detect(ci, g) { const c = this.ctl[ci]; if (c && c.det && g < c.det.length) c.det[g] = this.t; }
  wanted(c, g) { return this.t - c.det[g] < DEMAND_MEMORY; }
  // does any stage other than the current one have demand?
  otherDemand(c) {
    for (let k = 0; k < c.stages.length; k++) {
      if (k === c.stage) continue;
      const st = c.stages[k];
      if (st.kind === 'ped' ? c.demand : this.wanted(c, st.g)) return true;
    }
    return false;
  }
  update(dt) {
    this.t += dt;
    for (const c of this.ctl) {
      c.timer += dt;
      if (c.standalone) {
        // pelican/puffin: vehicles green until a pedestrian demands; min green 18 s
        switch (c.phase) {
          case 'G': if (c.demand && c.timer > 18) { c.phase = 'A'; c.timer = 0; } break;
          case 'A': if (c.timer > AMBER) { c.phase = 'R'; c.timer = 0; } break;
          case 'R': if (c.timer > 1.5) { c.phase = 'W'; c.timer = 0; c.demand = false; } break;   // walk
          case 'W': if (c.timer > PED_GREEN) { c.phase = 'F'; c.timer = 0; } break;              // flashing
          case 'F': if (c.timer > PED_FLASH) { c.phase = 'RA'; c.timer = 0; } break;
          case 'RA': if (c.timer > REDAMBER) { c.phase = 'G'; c.timer = 0; } break;
        }
        continue;
      }
      const st = c.stages[c.stage];
      if (st.kind === 'veh') {
        if (c.phase === 'RA' && c.timer > REDAMBER) { c.phase = 'G'; c.timer = 0; }
        else if (c.phase === 'G' && this.actuated) {
          // hold the green while vehicles keep arriving (up to the max); gap out when the detector is
          // quiet and someone else is waiting; rest on green when nobody else wants the junction
          const gapOut = c.timer > MIN_GREEN && this.t - c.det[st.g] > GAP, maxOut = c.timer > st.green * MAX_GREEN_K;
          if ((gapOut || maxOut) && this.otherDemand(c)) { c.phase = 'A'; c.timer = 0; }
        }
        else if (c.phase === 'G' && c.timer > st.green) { c.phase = 'A'; c.timer = 0; }
        else if (c.phase === 'A' && c.timer > AMBER) { c.phase = 'X'; c.timer = 0; }
        else if (c.phase === 'X' && c.timer > ALLRED) this.next(c);
      } else {
        if (c.phase !== 'W' && c.phase !== 'F') { c.phase = 'W'; c.timer = 0; }
        else if (c.phase === 'W' && c.timer > PED_GREEN) { c.phase = 'F'; c.timer = 0; }
        else if (c.phase === 'F' && c.timer > PED_FLASH) this.next(c);
      }
    }
  }
  next(c) {
    const from = c.stage;
    c.stage = (c.stage + 1) % c.stages.length;
    // skip stages nobody is waiting for (pedestrian stage without a button press; with actuation, vehicle
    // stages with a quiet detector). If nobody at all is waiting, take the next vehicle stage.
    for (let k = 0; k < c.stages.length; k++) {
      const st = c.stages[c.stage];
      const want = st.kind === 'ped' ? c.demand : (!this.actuated || this.wanted(c, st.g));
      if (want) break;
      c.stage = (c.stage + 1) % c.stages.length;
    }
    if (c.stages[c.stage].kind === 'ped' && !c.demand) { c.stage = (from + 1) % c.stages.length; if (c.stages[c.stage].kind === 'ped') c.stage = (c.stage + 1) % c.stages.length; }
    if (c.stages[c.stage].kind === 'ped') c.demand = false;
    c.phase = c.stages[c.stage].kind === 'veh' ? 'RA' : 'W'; c.timer = 0;
  }
  // vehicle aspect for controller ci / group g: 'G', 'A', 'R', 'RA'
  aspect(ci, g) {
    const c = this.ctl[ci]; if (!c) return 'G';
    if (c.standalone) return c.phase === 'G' ? 'G' : c.phase === 'A' ? 'A' : c.phase === 'RA' ? 'RA' : c.phase === 'F' ? 'FA' : 'R';
    const st = c.stages[c.stage];
    if (st.kind !== 'veh' || st.g !== g) return 'R';
    return c.phase === 'X' ? 'R' : c.phase;
  }
  // pedestrian aspect: 'walk', 'flash', 'wait'
  ped(ci) {
    const c = this.ctl[ci]; if (!c) return 'wait';
    if (c.phase === 'W') return 'walk';
    if (c.phase === 'F') return 'flash';
    return 'wait';
  }
  press(ci) { const c = this.ctl[ci]; if (c) c.demand = true; }
  timeTo(ci) { const c = this.ctl[ci]; return c ? c.timer : 0; }
}

// Instanced signal heads, pedestrian heads and Belisha beacons near the camera.
export class SignalRenderer {
  constructor(scene, net, signals) {
    this.net = net; this.sig = signals;
    const pole = new THREE.CylinderGeometry(0.06, 0.06, 3.3, 6).translate(0, 1.65, 0);
    const head = new THREE.BoxGeometry(0.32, 0.95, 0.25).translate(0, 3.0, 0);
    const back = new THREE.BoxGeometry(0.55, 1.15, 0.03).translate(0, 3.0, -0.14);
    this.poles = new THREE.InstancedMesh(mergeGeos([pole.toNonIndexed(), head.toNonIndexed(), back.toNonIndexed()]), new THREE.MeshStandardNodeMaterial({ color: 0x111214, roughness: 0.6 }), 900);
    const lens = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10).rotateX(Math.PI / 2);
    this.lamps = new THREE.InstancedMesh(lens, new THREE.MeshBasicNodeMaterial({ color: 0xffffff }), 2700);
    const beaconPole = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8).translate(0, 1.3, 0);
    this.beacons = new THREE.InstancedMesh(beaconPole, new THREE.MeshStandardNodeMaterial({ color: 0xdddddd }), 600);
    this.globes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicNodeMaterial({ color: 0xffffff }), 600);
    for (const m of [this.poles, this.lamps, this.beacons, this.globes]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
    this.lamps.setColorAt(0, new THREE.Color()); this.globes.setColorAt(0, new THREE.Color());
    // precompute head positions per approach
    this.heads = [];
    const tmp = [0, 0, 0, 0, 0];
    net.controllers.forEach((c, ci) => {
      for (const [e, d, stop, g] of c.approaches) {
        const h = e * 2 + (d === 1 ? 0 : 1);
        net.at(h, Math.min(net.len[e], stop + 1.0), tmp);
        const w = net.width[e], lx = tmp[4], lz = -tmp[3];   // left of travel
        const off = (net.flags[e] & 1 ? w / 2 : w / 2) + 0.7;
        this.heads.push({ ci, g, x: tmp[0] + lx * off, y: tmp[1], z: tmp[2] + lz * off, face: Math.atan2(-tmp[4], -tmp[3]), ped: false });
      }
      for (const [x, z, hdg, w] of c.peds) {
        for (const s of [-1, 1]) {
          const nx = Math.sin(hdg), nz = -Math.cos(hdg);
          this.heads.push({ ci, g: -1, x: x + nx * s * (w / 2 + 0.3), y: null, z: z + nz * s * (w / 2 + 0.3), face: Math.atan2(-nz * s, -nx * s), ped: true });
        }
      }
    });
    this.zebras = [];
    for (const c of net.crossings) if (c[2] === 'zebra') {
      const [e, idx, , x, z, hdg, w] = c;
      const nx = Math.sin(hdg), nz = -Math.cos(hdg);
      for (const s of [-1, 1]) this.zebras.push({ x: x + nx * s * (w / 2 + 0.5), z: z + nz * s * (w / 2 + 0.5), y: null });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color(); this._o = new THREE.Vector3();
  }
  draw(cam, ground, t) {
    let np = 0, nl = 0, nb = 0;
    const R2 = 260 * 260;
    const Y = new THREE.Vector3(0, 1, 0);
    for (const h of this.heads) {
      const dx = h.x - cam.x, dz = h.z - cam.z; if (dx * dx + dz * dz > R2) continue;
      if (h.gy == null) { const gy = ground(h.x, h.z); if (gy == null) continue; h.gy = gy + 0.17; }
      this._q.setFromAxisAngle(Y, -h.face + Math.PI / 2);
      this._m.compose(this._v.set(h.x, h.gy, h.z), this._q, this._s.set(1, h.ped ? 0.72 : 1, 1));
      this.poles.setMatrixAt(np++, this._m);
      const lit = [];
      if (!h.ped) {
        const a = this.sig.aspect(h.ci, h.g);
        lit.push([3.32, a === 'R' || a === 'RA' ? 0xff1a0a : 0x2a0503], [3.0, a === 'A' || a === 'RA' || (a === 'FA' && Math.floor(t * 2) % 2) ? 0xffa000 : 0x2a1a02], [2.68, a === 'G' ? 0x20ff70 : 0x032a10]);
      } else {
        const p = this.sig.ped(h.ci);
        lit.push([2.38, p === 'wait' ? 0xff2010 : 0x200402], [2.1, p === 'walk' || (p === 'flash' && Math.floor(t * 2) % 2) ? 0x30ff80 : 0x032a10]);
      }
      for (const [yy, col] of lit) {
        const ox = Math.cos(h.face) * 0.14, oz = Math.sin(h.face) * 0.14;
        this._m.compose(this._v.set(h.x + ox, h.gy + yy, h.z + oz), this._q, this._s.set(1, 1, 1));
        this.lamps.setMatrixAt(nl, this._m); this.lamps.setColorAt(nl, this._c.setHex(col)); nl++;
      }
    }
    for (const z of this.zebras) {
      const dx = z.x - cam.x, dz = z.z - cam.z; if (dx * dx + dz * dz > R2) continue;
      if (z.y == null) { const gy = ground(z.x, z.z); if (gy == null) continue; z.y = gy + 0.17; }
      this._m.makeTranslation(z.x, z.y, z.z); this.beacons.setMatrixAt(nb, this._m);
      this._m.makeTranslation(z.x, z.y + 2.75, z.z); this.globes.setMatrixAt(nb, this._m);
      this.globes.setColorAt(nb, this._c.setHex(Math.floor(t * 1.4) % 2 ? 0xffb000 : 0x553300)); nb++;
    }
    this.poles.count = np; this.lamps.count = nl; this.beacons.count = nb; this.globes.count = nb;
    for (const m of [this.poles, this.lamps, this.beacons, this.globes]) m.instanceMatrix.needsUpdate = true;
    this.lamps.instanceColor.needsUpdate = true; this.globes.instanceColor.needsUpdate = true;
  }
  // nearest lit lamps for wet-road reflections
  nearLights(cam, out, max) {
    for (const h of this.heads) {
      if (out.length >= max) break;
      const dx = h.x - cam.x, dz = h.z - cam.z; if (dx * dx + dz * dz > 90 * 90 || h.ped || h.gy == null) continue;
      const a = this.sig.aspect(h.ci, h.g);
      const col = a === 'G' ? [0.1, 1, 0.4] : a === 'A' ? [1, 0.6, 0] : [1, 0.08, 0.03];
      out.push([h.x, h.gy + 3, h.z, 1.2, ...col, dx * dx + dz * dz]);
    }
  }
}

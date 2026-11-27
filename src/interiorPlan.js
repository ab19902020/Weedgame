// Floor plans for the enterable buildings (www/world/interiors.json, picked by tools/interiors/pick.mjs): rooms,
// walls with their doors and windows, stairs, furniture and what you bump into, all generated from the site's
// size, kind and seed so no two are alike. Pure data (no three.js): interiorMesh.js draws it, interiors.js walks
// you round it.
// Local frame: x along the front wall (0..W), y from the front wall inwards (0..D), h up from the ground floor.

import { STYLE } from './food.js';

export function rng(seed) { let s = (seed >>> 0) || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
const pick = (R, a) => a[Math.floor(R() * a.length) % a.length];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ palettes (each site picks its own)
const PAINT = { magnolia: 0xefe4cf, white: 0xf2f0ea, grey: 0xc9c9c4, greige: 0xd6cbb9, sage: 0xb9c4a8, duck: 0x8fb3b6, navy: 0x3c4a63, blush: 0xe3c2b6,
  lemon: 0xefe0a8, lilac: 0xcbbfd6, cream: 0xf1e6c8, green: 0x7f9c80, teal: 0x4f7f80, mustard: 0xd1a54a, smoke: 0x9aa0a3, nicotine: 0xd9c48f };
const CARPET = [0xb9a98f, 0x8c8f93, 0x6d7280, 0x9b6e5c, 0x5d6d58, 0xc7b8a3, 0x7a5a64, 0x4f5a6e];
const WOOD = [0xffffff, 0xe8d2b2, 0xc59a6a, 0x9a7050, 0xf0e3cc];          // tints on the wood texture: natural to dark
const SOFA = [0x6b7079, 0x3f4a5f, 0x5b4636, 0x7c8a6d, 0x9b3e3a, 0x2f5d57, 0xc0b49d, 0x4a4a4e];
const UNITS = [[0xf4f4f1, 'white gloss'], [0xe8ddc7, 'cream shaker'], [0x8fa38c, 'sage shaker'], [0x2e3d55, 'navy'], [0x9b7653, 'oak'], [0x6f7378, 'grey']];
const DUVET = [0xf3f3f3, 0x9fb3c8, 0xd9b7b0, 0x7d8e74, 0x3e4b61, 0xe7d9b8];

// ------------------------------------------------------------------ the plan
export class Plan {
  constructor(site) {
    this.site = site; this.R = rng(site.seed || site.id || 1);
    this.W = site.W; this.D = site.D; this.fh = site.floorH;
    this.levels = [];
    this.stairs = [];        // { lv, x0, y0, x1, y1, dir: 'y'|'x', up: +1|-1, rise, n, side }
    this.items = [];         // furniture: { lv, type, x, y, w, d, h, rot, col, solid, ... }
    this.doors = [];         // { lv, a, b, at, w, top, kind }
    this.exit = { x: site.doorX, y: 0.75 };
    this.party = new Set();  // outer sides with no windows (shared walls): 'x0' | 'x1' | 'y1'
    this.style = {};
  }
  level(ceil) { const lv = { i: this.levels.length, h: this.levels.length * this.fh, ceil, rooms: [], walls: [], holes: [], rails: [], cols: [] }; this.levels.push(lv); return lv; }
  room(lv, name, x0, y0, x1, y1, o = {}) {
    const r = { lv: lv.i, name, group: o.group || name, x0, y0, x1, y1, floor: o.floor || ['carpet', CARPET[0]], wall: o.wall || ['plaster', PAINT.magnolia], ceil: o.ceil || 0xf4f2ec,
      windows: o.windows ?? 1, frosted: !!o.frosted, light: o.light ?? 1, kind: o.kind || name, cover: o.cover || null, sill: o.sill ?? 0.9, head: o.head ?? 2.05, winW: o.winW };
    lv.rooms.push(r); return r;
  }
  door(lv, a, b, o = {}) { this.doors.push({ lv: lv.i, a, b, at: o.at, w: o.w ?? 0.82, top: o.top ?? 2.02, kind: o.kind || 'door', leaf: o.leaf ?? 'open' }); }
  arch(lv, a, b, o = {}) { this.door(lv, a, b, { ...o, w: o.w ?? 1.6, top: o.top ?? 2.1, kind: 'arch', leaf: 'none' }); }
  add(lv, type, x, y, w, d, h, o = {}) { const it = { lv: lv.i, type, x, y, w, d, h, rot: o.rot || 0, col: o.col, col2: o.col2, solid: o.solid ?? true, ...o }; this.items.push(it); return it; }
  find(lv, name) { return lv.rooms.find(r => r.name === name); }

  // ---------------------------------------------------------------- walls from the rooms
  finish() {
    if (this.done) return this; this.done = true;
    const { W, D } = this, EPS = 0.02;
    for (const lv of this.levels) {
      const segs = [];
      // every room edge, as a piece of line with the room on one side
      const edges = [];
      for (const r of lv.rooms) {
        edges.push({ o: 'h', c: r.y0, a: r.x0, b: r.x1, r, s: +1 }, { o: 'h', c: r.y1, a: r.x0, b: r.x1, r, s: -1 },
          { o: 'v', c: r.x0, a: r.y0, b: r.y1, r, s: +1 }, { o: 'v', c: r.x1, a: r.y0, b: r.y1, r, s: -1 });
      }
      // outer walls: room edges on the building's boundary
      for (const e of edges) {
        const outer = (e.o === 'h' && (Math.abs(e.c) < EPS || Math.abs(e.c - D) < EPS)) || (e.o === 'v' && (Math.abs(e.c) < EPS || Math.abs(e.c - W) < EPS));
        if (!outer) continue;
        const side = e.o === 'h' ? (e.c < EPS ? 'y0' : 'y1') : (e.c < EPS ? 'x0' : 'x1');
        segs.push({ o: e.o, c: e.c, a: e.a, b: e.b, outer: side, rooms: [e.r], sides: [e.s], open: [] });
      }
      // partitions: where a room on one side meets a room of another group on the other
      for (const e of edges) {
        if (e.s !== -1) continue;
        for (const f of edges) {
          if (f.s !== +1 || f.o !== e.o || Math.abs(f.c - e.c) > EPS || f.r === e.r) continue;
          const a = Math.max(e.a, f.a), b = Math.min(e.b, f.b); if (b - a < 0.05) continue;
          if (e.r.group === f.r.group) continue;
          segs.push({ o: e.o, c: e.c, a, b, outer: null, rooms: [e.r, f.r], sides: [-1, +1], open: [] });
        }
      }
      lv.walls = segs;
    }
    // doors between rooms: on the longest wall the two share
    for (const d of this.doors) {
      const lv = this.levels[d.lv];
      const cand = lv.walls.filter(s => !s.outer && s.rooms.some(r => r.name === d.a) && s.rooms.some(r => r.name === d.b)).sort((p, q) => (q.b - q.a) - (p.b - p.a));
      const s = cand[0]; if (!s) continue;
      const w = Math.min(d.w, s.b - s.a - 0.1), at = clamp(d.at ?? (s.a + s.b) / 2, s.a + w / 2 + 0.05, s.b - w / 2 - 0.05);
      s.open.push({ a: at - w / 2, b: at + w / 2, bot: 0, top: d.top, kind: d.kind, leaf: d.leaf });
    }
    // the front door, windows on the outer walls
    for (const lv of this.levels) {
      for (const s of lv.walls) {
        if (!s.outer) continue;
        const r = s.rooms[0];
        if (lv.i === 0 && s.outer === 'y0') {
          const fx = this.site.doorX;
          if (fx > s.a + 0.3 && fx < s.b - 0.3) s.open.push({ a: fx - (this.frontW || 0.47), b: fx + (this.frontW || 0.47), bot: 0, top: this.frontTop || 2.05, kind: 'front', leaf: 'closed' });
        }
        if (this.party.has(s.outer) || !r.windows) continue;
        const L = s.b - s.a; if (L < 1.1) continue;
        const n = r.windows === 'many' ? Math.max(1, Math.floor(L / 3.2)) : 1;
        for (let k = 0; k < n; k++) {
          const ww = r.winW ? Math.min(r.winW, L / n - 0.5) : Math.min(1.7, Math.max(0.6, L / n * 0.45));
          const at = s.a + L * (k + 0.5) / n;
          const win = { a: at - ww / 2, b: at + ww / 2, bot: r.sill, top: Math.min(lv.ceil - 0.15, r.head), kind: 'window', frosted: r.frosted, cover: r.cover };
          // not over a door or the front door
          if (s.open.some(o => o.b > win.a - 0.25 && o.a < win.b + 0.25)) continue;
          s.open.push(win);
        }
      }
      for (const s of lv.walls) s.open.sort((p, q) => p.a - q.a);
    }
    return this;
  }
  // collision: walls minus their doorways, stair rails, the stairwell's guard rails, solid furniture
  collisions() {
    for (const lv of this.levels) {
      lv.cols = []; lv.rails = []; lv.holes = [];
      for (const s of lv.walls) {
        let a = s.a;
        for (const o of s.open) { if (o.bot < 0.3) { if (o.a > a) lv.cols.push(seg(s, a, o.a)); a = o.b; } }
        if (s.b > a) lv.cols.push(seg(s, a, s.b));
        if (s.outer === 'y0' && lv.i === 0) for (const o of s.open) if (o.kind === 'front') lv.cols.push(seg(s, o.a, o.b));   // the front door is shut behind you
      }
    }
    for (const st of this.stairs) {
      // ground: a banister along the open side, past the first steps; upstairs: rails round the stairwell except the top
      const lv0 = this.levels[st.lv], lv1 = this.levels[st.lv + 1];
      const along = st.dir === 'y';
      const open = st.side;      // the side of the flight away from the wall: x0|x1 (or y0|y1)
      const c = open === 'x0' ? st.x0 : open === 'x1' ? st.x1 : open === 'y0' ? st.y0 : st.y1;
      const [a0, a1] = along ? [st.y0, st.y1] : [st.x0, st.x1];
      const foot = st.up > 0 ? a0 : a1, head = st.up > 0 ? a1 : a0;
      const sFoot = st.up > 0 ? [a0 + 0.55, a1] : [a0, a1 - 0.55];
      lv0.cols.push(along ? [c, sFoot[0], c, sFoot[1]] : [sFoot[0], c, sFoot[1], c]);
      lv0.rails.push({ o: along ? 'v' : 'h', c, a: sFoot[0], b: sFoot[1], h0: 0, rise: st.rise, st });
      if (lv1) {
        lv1.holes.push({ x0: st.x0, y0: st.y0, x1: st.x1, y1: st.y1 });
        lv1.cols.push(along ? [c, a0, c, a1] : [a0, c, a1, c]);
        lv1.rails.push({ o: along ? 'v' : 'h', c, a: a0, b: a1, h0: 0, top: true });
        // the end of the well away from the top step
        const ce = foot;
        const [b0, b1] = along ? [st.x0, st.x1] : [st.y0, st.y1];
        lv1.cols.push(along ? [b0, ce, b1, ce] : [ce, b0, ce, b1]);
        lv1.rails.push({ o: along ? 'h' : 'v', c: ce, a: b0, b: b1, h0: 0, top: true });
        void head;
      }
    }
    for (const it of this.items) {
      if (!it.solid) continue;
      const lv = this.levels[it.lv], c = Math.cos(it.rot), s = Math.sin(it.rot), hw = it.w / 2, hd = it.d / 2;
      const P = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [it.x + u * c - v * s, it.y + u * s + v * c]);
      for (let k = 0; k < 4; k++) lv.cols.push([...P[k], ...P[(k + 1) % 4]]);
    }
    return this;
  }

  // ---------------------------------------------------------------- walking: floor height and collision
  // floor height under (x, y) for someone whose feet are at h (stairs are ramps)
  floorAt(x, y, h) {
    for (const st of this.stairs) {
      if (x < st.x0 - 0.02 || x > st.x1 + 0.02 || y < st.y0 - 0.02 || y > st.y1 + 0.02) continue;
      const t = st.dir === 'y' ? (y - st.y0) / (st.y1 - st.y0) : (x - st.x0) / (st.x1 - st.x0);
      const f = clamp(st.up > 0 ? t : 1 - t, 0, 1);
      const base = this.levels[st.lv].h, top = base + st.rise;
      // only if you're on the flight already (from its foot, or coming down from the top)
      if (h > base - 0.4 && h < top + 0.4) return base + f * st.rise;
    }
    let best = 0;
    for (const lv of this.levels) if (h > lv.h - 0.6) best = lv.h;
    return best;
  }
  levelAt(h) { let i = 0; for (const lv of this.levels) if (h > lv.h - 0.6) i = lv.i; return i; }
  // push a circle (x, y, r) out of the walls and furniture of the level at height h
  collide(x, y, r, h) {
    const li = this.levelAt(h + 0.3), cols = this.levels[li].cols;
    for (let it = 0; it < 2; it++) for (const [ax, ay, bx, by] of cols) {
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1; let t = ((x - ax) * vx + (y - ay) * vy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + vx * t, py = ay + vy * t, dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
      if (d < r) { const k = (r - d) / (d || 1); x += dx * k; y += dy * k; if (!d) y += r; }
    }
    // and inside the shell
    return [clamp(x, r, this.W - r), clamp(y, r, this.D - r)];
  }
  // the first wall a ray from (x, y) at height h towards (tx, ty) hits: fraction 0..1 (doorways let it through)
  // (h1, li: the camera's sight line rises from h to h1 on level li; it only goes through a doorway below its top)
  ray(x, y, tx, ty, h, h1 = h, li = this.levelAt(h), rise = null) {
    const lv = this.levels[li]; let best = 1;
    const dx = tx - x, dy = ty - y;
    for (const s of lv.walls) {
      const den = s.o === 'h' ? dy : dx; if (Math.abs(den) < 1e-6) continue;
      const t = ((s.o === 'h' ? s.c - y : s.c - x)) / den; if (t <= 0 || t >= best) continue;
      const u = s.o === 'h' ? x + dx * t : y + dy * t; if (u < s.a || u > s.b) continue;
      const hh = (rise != null ? Math.min(h1, h + rise * t) : h + (h1 - h) * t) - lv.h;
      if (s.open.some(o => u > o.a + 0.08 && u < o.b - 0.08 && hh > o.bot + 0.1 && hh < o.top - 0.1 && o.kind !== 'window' && o.kind !== 'front')) continue;
      best = t;
    }
    return best;
  }
}
// the indoor camera's other check: how far along (x, y) -> (tx, ty) it can come before it would be inside
// something tall on level li (furniture, the back bar, racking, a fruit machine, a hanging lamp) that spans
// heights h0..h1 (relative to the building's floor). 1 = nothing in the way.
const CAM_SKIP = new Set(['rug', 'doormat', 'floorlines', 'picture', 'clock', 'tv', 'dartboard', 'whiteboard', 'oche', 'clothes', 'post', 'cans', 'pizzaboxes', 'runner', 'beam', 'exitsign', 'towelrail', 'cuerack']);
// the solid shapes the camera keeps out of on level li: [cx, cy, halfW, halfD, rot, b0, b1] (heights from the
// building's floor). The mall's gallery is its two walkways, not one block over the whole hall.
Plan.prototype.camBoxes = function (li) {
  const lv = this.levels[li];
  if (lv._camBoxes && lv._camBoxesN === this.items.length + (lv.hang || []).length) return lv._camBoxes;
  const out = [];
  for (const it of this.items) {
    if (it.lv !== li || it.skip || CAM_SKIP.has(it.type) || it.w < 0.2 || it.d < 0.2) continue;
    const b0 = lv.h + (it.base || 0), b1 = b0 + (it.h || 0);
    if (it.type === 'gallery') { for (const [a, b] of [[it.y0, it.y0 + 3.5], [it.y1 - 3.5, it.y1]]) out.push([it.x, (a + b) / 2, it.w / 2, (b - a) / 2, 0, b1 - 0.3, b1 + 1.1]); continue; }
    out.push([it.x, it.y, it.w / 2, it.d / 2, it.rot || 0, b0, b1]);
  }
  for (const [hx, hy, r, b0, b1] of lv.hang || []) out.push([hx, hy, r, r, 0, b0, b1]);
  lv._camBoxes = out; lv._camBoxesN = this.items.length + (lv.hang || []).length;
  return out;
};
Plan.prototype.rayItems = function (li, x, y, tx, ty, h0, h1) {
  const lvH = this.levels[li].h;
  let best = 1;
  // where the segment first enters a box (centre, axes, half sizes, heights b0..b1): with a margin, or, when
  // you're standing within the margin (right up against it), the box itself; 1 if it never does
  const enter = (u0, v0, du, dv, hu, hv, b0, b1) => {
    for (const m of [0.14, 0.02]) {
      const ax = [[u0, du, -hu - m, hu + m], [v0, dv, -hv - m, hv + m], [h0, h1 - h0, b0 - m, b1 + m]];
      if (ax.every(([p, , lo, hi]) => p > lo && p < hi)) continue;   // starting inside: try the tighter box
      let t0 = 0, t1 = 1, hit = true;
      for (const [p, d, lo, hi] of ax) {
        if (Math.abs(d) < 1e-9) { if (p <= lo || p >= hi) { hit = false; break; } continue; }
        let a = (lo - p) / d, b = (hi - p) / d; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { hit = false; break; }
      }
      return hit ? t0 : 1;
    }
    return 1;
  };
  const ex = tx - x, ey = ty - y;
  for (const [bx, by, hw, hd, rot, b0, b1] of this.camBoxes(li)) {
    const c = Math.cos(rot), s = Math.sin(rot), dx = x - bx, dy = y - by;
    best = Math.min(best, enter(dx * c + dy * s, -dx * s + dy * c, ex * c + ey * s, -ex * s + ey * c, hw, hd, b0, b1));
  }
  return best;
};
// what (if anything tall) the point (x, y) at height h on level li is inside: { b0, b1 } heights, or null
Plan.prototype.camInside = function (li, x, y, h) {
  for (const [bx, by, hw, hd, rot, b0, b1] of this.camBoxes(li)) {
    if (h < b0 - 0.06 || h > b1 + 0.06) continue;
    const c = Math.cos(rot), s = Math.sin(rot), dx = x - bx, dy = y - by;
    if (Math.abs(dx * c + dy * s) < hw + 0.06 && Math.abs(-dx * s + dy * c) < hd + 0.06) return { b0, b1 };
  }
  return null;
};
// push the camera (x, y) on level li at least r off every wall (doorways stay open), like the player
Plan.prototype.camClear = function (li, x, y, r, h) {
  const lv = this.levels[li], hh = h - lv.h;
  for (let k = 0; k < 2; k++) for (const s of lv.walls) {
    const [ax, ay, bx, by] = seg(s, s.a, s.b), vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
    let t = ((x - ax) * vx + (y - ay) * vy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const u = s.a + (s.b - s.a) * t;
    if (s.open.some(o => o.bot < 0.3 && hh < o.top - 0.12 && u > o.a + 0.05 && u < o.b - 0.05)) continue;   // in a doorway (below its head)
    const px = ax + vx * t, py = ay + vy * t, dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
    if (d < r && d > 1e-6) { const q = (r - d) / d; x += dx * q; y += dy * q; }
  }
  return [x, y];
};
const seg = (s, a, b) => s.o === 'h' ? [a, s.c, b, s.c] : [s.c, a, s.c, b];

// ------------------------------------------------------------------ furniture against walls
// a spot of width w along one wall of room r ('y0' front, 'y1' back, 'x0', 'x1'), clear of its doors (and of
// its windows if tall); at: 0..1 preference along the wall. Returns { x, y, rot } for an item of depth d whose
// back is to that wall, or null.
export function against(P, lv, r, side, w, d, o = {}) {
  const horiz = side === 'y0' || side === 'y1';
  const a0 = horiz ? r.x0 : r.y0, a1 = horiz ? r.x1 : r.y1, c = side === 'y0' ? r.y0 : side === 'y1' ? r.y1 : side === 'x0' ? r.x0 : r.x1;
  const blocked = [];
  for (const s of lv.walls) {
    if (s.o !== (horiz ? 'h' : 'v') || Math.abs(s.c - c) > 0.03) continue;
    for (const op of s.open) if (op.bot < 0.3 || (o.tall && op.kind === 'window') || (op.kind === 'window' && op.bot < (o.h || 0) + 0.02)) blocked.push([op.a - (op.bot < 0.3 ? 0.5 : 0.05), op.b + (op.bot < 0.3 ? 0.5 : 0.05)]);
  }
  // stairs and their feet
  for (const st of P.stairs) if (st.lv === lv.i || st.lv + 1 === lv.i) {
    const [s0, s1] = horiz ? [st.x0, st.x1] : [st.y0, st.y1], [t0, t1] = horiz ? [st.y0, st.y1] : [st.x0, st.x1];
    const near = side === 'y0' || side === 'x0' ? t0 < c + d + 0.9 && t1 > c : t1 > c - d - 0.9 && t0 < c;
    if (near) blocked.push([s0 - 0.6, s1 + 0.6]);
  }
  for (const it of P.items) if (it.lv === lv.i && it.wall === r.name + side) blocked.push([it.along - it.w / 2 - 0.05, it.along + it.w / 2 + 0.05]);
  const want = a0 + 0.05 + (a1 - a0 - 0.1 - w) * (o.at ?? 0.5) + w / 2;
  let best = null;
  for (let k = 0; k <= 40; k++) {
    for (const sg of [1, -1]) {
      const u = want + sg * k * 0.1;
      if (u - w / 2 < a0 + 0.03 || u + w / 2 > a1 - 0.03) continue;
      if (blocked.some(([b0, b1]) => u + w / 2 > b0 && u - w / 2 < b1)) continue;
      best = u; break;
    }
    if (best != null) break;
  }
  if (best == null) return null;
  const off = d / 2 + 0.02;
  const pos = side === 'y0' ? { x: best, y: c + off, rot: 0 } : side === 'y1' ? { x: best, y: c - off, rot: Math.PI } : side === 'x0' ? { x: c + off, y: best, rot: -Math.PI / 2 } : { x: c - off, y: best, rot: Math.PI / 2 };
  return { ...pos, along: best, wall: r.name + side };
}
// put an item against a wall (if there's room)
function wallItem(P, lv, r, side, type, w, d, h, o = {}) {
  const p = against(P, lv, r, side, w, d, { ...o, h }); if (!p) return null;
  return P.add(lv, type, p.x, p.y, w, d, h, { ...o, rot: p.rot, along: p.along, wall: p.wall });
}
const mid = r => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
const sides = ['y0', 'y1', 'x0', 'x1'];

function livingWalls(P, level, room, preferred, sofaWidth, tvWidth) {
  const opposite = { x0:'x1', x1:'x0', y0:'y1', y1:'y0' };
  for (const scale of [1, 0.85, 0.7, 0.55]) {
    for (const side of [preferred, ...sides.filter(s => s !== preferred)]) {
      const sofa = Math.max(1.05, sofaWidth * scale), tv = Math.max(0.65, tvWidth * scale);
      if (against(P, level, room, side, tv, 0.42, {h:0.5}) &&
          against(P, level, room, opposite[side], sofa, 0.92, {h:0.85})) {
        return {side, opposite:opposite[side], sofa, tv};
      }
    }
  }
  return {side:preferred, opposite:opposite[preferred], sofa:sofaWidth, tv:tvWidth};
}

function kitchenItem(P, level, room, side, type, width, depth, height, options) {
  for (const w of type === 'units' ? [width, Math.min(width, 2.4), Math.min(width, 1.6), 1.2] : [width]) {
    for (const wall of [side, ...sides.filter(s => s !== side)]) {
      const item = wallItem(P, level, room, wall, type, w, depth, height, options);
      if (item) return item;
    }
  }
}

// ------------------------------------------------------------------ houses
function stairsFit(P, fh, room) {
  const n = Math.max(11, Math.round(fh / 0.195)), rise = fh;
  let g = 0.235; const space = room - 0.2;
  if (n * g > space) g = Math.max(0.2, space / n);
  return { n, g, len: n * g, rise };
}
function house(P, s) {
  const R = P.R, { W, D, fh } = P;
  const kind = s.kind, trap = kind === 'trap', nice = kind === 'nice', cottage = kind === 'cottage';
  const wide = W >= 8.5;
  const sw = 0.92, hw = W < 5.2 ? 1.7 : 1.85;
  const hx0 = s.brothersHome ? W - hw - 3.0 : wide ? clamp(s.doorX - (sw + hw) / 2, 2.4, W - hw - 2.4) : 0;
  if (!s.brothersHome) P.site.doorX = hx0 + (sw + hw) / 2;
  P.exit.x = P.site.doorX;
  // the back of the house needs 2.45 m upstairs (a landing and the bathroom): the flight starts 0.5-0.95 m in
  const st = stairsFit(P, fh, D - 2.45 - 0.2 - 0.5 + 0.2);
  const ys0 = s.brothersHome ? 1.85 : clamp(D - 2.45 - 0.2 - st.len, 0.5, 0.95);
  const ys1 = ys0 + st.len, yh = ys1 + 0.2;
  // party walls: terraces both sides, semis one (the side away from the hall)
  if (kind === 'terrace') { P.party.add('x0'); P.party.add('x1'); }
  if (kind === 'semi' || kind === 'trap') P.party.add(R() < 0.5 ? 'x0' : 'x1');
  // style
  const paint = trap ? pick(R, [0xc9b78a, 0xb9ad94, 0xa9a69a]) : pick(R, Object.values(PAINT));
  const paint2 = trap ? 0xcfc4a8 : pick(R, [PAINT.white, PAINT.magnolia, PAINT.greige, PAINT.grey, PAINT.cream]);
  const feature = trap ? null : R() < 0.5 ? ['wallpaper', pick(R, [0xb7c4cf, 0xd9c7a7, 0x9cae9a, 0xc9a5a0, 0x6f7f95, 0xe6dccb])] : null;
  const carpet = trap ? pick(R, [0x6f6556, 0x6b5f60, 0x5f5c52]) : pick(R, CARPET);
  const woodFloor = !trap && (nice || cottage || R() < 0.45);
  const wood = s.brothersHome ? 0xcfad84 : nice ? 0xf0dcc0 : pick(R, WOOD);
  const units = trap ? [0xe8e3d6, 'tired white'] : nice ? pick(R, [[0x2e3d55, 'navy'], [0x8fa38c, 'sage shaker'], [0xf4f4f1, 'white gloss']]) : pick(R, UNITS);
  const kitchenFloor = trap ? ['tile', 0xb8ab94] : nice ? ['tile', 0xd8d2c8] : pick(R, [['tile', 0xe4e0d8], ['tile', 0xc9c2b4], ['wood', 0xd9c09c], ['tile', 0x9a9a98]]);
  P.style = { paint, paint2, carpet, units: units[1], trap, nice };
  const living = woodFloor ? ['wood', wood] : ['carpet', carpet];
  const wallL = s.brothersHome ? ['plaster', 0xcbd6c9] : feature && R() < 0.5 ? ['wallpaper', feature[1]] : ['plaster', paint];
  // ---- ground floor
  const g = P.level(fh - 0.22);
  const hall = P.room(g, 'hall', hx0, 0, hx0 + hw, yh, { floor: trap ? ['carpet', 0x5f574b] : woodFloor ? living : ['tile', 0xb9b0a2], wall: ['plaster', paint2], windows: 0 });
  P.stairs.push({ lv: 0, x0: hx0, x1: hx0 + sw, y0: ys0, y1: ys1, dir: 'y', up: +1, rise: fh, n: st.n, side: 'x1', col: trap ? 0x7a6d5c : woodFloor ? 0xb58a5e : carpet });
  if (wide) {
    P.room(g, 'living', 0, 0, hx0, yh, { floor: living, wall: wallL, windows: 1, cover: trap ? 'boards' : null });
    P.room(g, 'dining', hx0 + hw, 0, W, yh, { floor: living, wall: ['plaster', paint2], windows: 1 });
  } else P.room(g, 'living', hw, 0, W, yh, { floor: living, wall: wallL, windows: 1, cover: trap ? 'boards' : null });
  const back = D - yh, openPlan = nice || R() < 0.45;
  if (back >= 4.8 && !wide) {
    P.room(g, 'dining', 0, yh, W, yh + back * 0.45, { group: openPlan ? 'kd' : 'dining', floor: living, wall: ['plaster', paint2] });
    P.room(g, 'kitchen', 0, yh + back * 0.45, W, D, { group: openPlan ? 'kd' : 'kitchen', floor: kitchenFloor, wall: ['plaster', paint2] });
  } else P.room(g, 'kitchen', 0, yh, W, D, { floor: kitchenFloor, wall: ['plaster', paint2], winW: 1.3 });
  if (s.brothersHome) P.arch(g, 'living', 'kitchen', { at: s.doorX, w: 1.8 });
  P.door(g, 'hall', 'living', { at: s.brothersHome ? 0.88 : wide ? yh - 1.2 : clamp(1.7, 0.6, yh - 0.6) });
  if (wide) P.door(g, 'hall', 'dining', { at: yh - 1.2 });
  const kitchenBehind = back >= 4.8 && !wide ? 'dining' : 'kitchen';
  P.door(g, 'hall', kitchenBehind, { at: hx0 + sw + (hw - sw) / 2 });
  if (!wide) (openPlan ? P.arch : P.door).call(P, g, 'living', kitchenBehind, { at: W - 1.4 });
  if (back >= 4.8 && !wide && !openPlan) P.door(g, 'dining', 'kitchen', { at: W / 2 });
  // ---- first floor
  const f = P.level(fh - 0.22 - (cottage ? 0.15 : 0));
  const land = P.room(f, 'landing', hx0, 0, hx0 + hw, yh, { floor: trap ? ['carpet', 0x5f574b] : ['carpet', carpet], wall: ['plaster', paint2], windows: wide ? 1 : 0, cover: trap ? 'foil' : null });
  const bw = wide ? hw : clamp(W * 0.4, hw, 2.7);
  const bathCol = pick(R, [0xffffff, 0xdfe8ea, 0xe9e4da]);
  const bedFloor = woodFloor && R() < 0.4 ? living : ['carpet', trap ? 0x6b6157 : pick(R, CARPET)];
  if (wide) {
    P.room(f, 'bed1', 0, 0, hx0, yh, { floor: bedFloor, wall: ['plaster', pick(R, Object.values(PAINT))] });
    P.room(f, 'bed2', hx0 + hw, 0, W, yh, { floor: bedFloor, wall: ['plaster', pick(R, Object.values(PAINT))] });
    P.room(f, 'landing2', hx0, yh, hx0 + hw, Math.min(D - 1.35, yh + 0.95), { group: 'landing', floor: ['carpet', carpet], wall: ['plaster', paint2], windows: 0 });
    P.room(f, 'bath', hx0, Math.min(D - 1.35, yh + 0.95), hx0 + hw, D, { floor: ['tile', bathCol], wall: ['tile', 0xf2f1ec], frosted: true, winW: 0.7 });
    P.room(f, 'bed3', 0, yh, hx0, D, { floor: bedFloor, wall: ['plaster', paint2] });
    P.room(f, s.brothersHome?'study':'bed4', hx0 + hw, yh, W, D, { floor: bedFloor, wall: ['plaster', pick(R, Object.values(PAINT))] });
    P.door(f, 'landing', 'bed1', { at: yh - 0.6 }); P.door(f, 'landing', 'bed2', { at: yh - 0.6 });
    P.door(f, 'landing2', 'bed3', { at: yh + 0.47 }); P.door(f, 'landing2', s.brothersHome?'study':'bed4', { at: yh + 0.47 }); P.door(f, 'landing2', 'bath', {});
  } else {
    const yb = Math.max(yh + 0.85, Math.min(D - 1.55, yh + 0.95));
    P.room(f, 'bed1', hw, 0, W, yh, { floor: bedFloor, wall: trap ? ['plaster', PAINT.smoke] : ['plaster', pick(R, Object.values(PAINT))], cover: trap ? 'foil' : null });
    P.room(f, 'landing2', 0, yh, bw, yb, { group: 'landing', floor: ['carpet', trap ? 0x5f574b : carpet], wall: ['plaster', paint2], windows: 0 });
    P.room(f, 'bath', 0, yb, bw, D, { floor: ['tile', bathCol], wall: ['tile', trap ? 0xe2dccd : 0xf2f1ec], frosted: true, winW: 0.6 });
    P.room(f, 'bed2', bw, yh, W, D, { floor: bedFloor, wall: ['plaster', trap ? PAINT.magnolia : paint2], cover: trap ? 'foil' : null });
    P.door(f, 'landing', 'bed1', { at: yh - 0.6 });
    P.door(f, 'landing2', 'bath', { at: 0.6 });
    P.door(f, 'landing2', 'bed2', { at: (yh + yb) / 2 });
  }
  void land;
  P.finish();
  furnishHouse(P, s);
}

function furnishHouse(P, s) {
  const R = P.R, [g, f] = P.levels, trap = P.style.trap, nice = P.style.nice;
  const L = P.find(g, 'living'), K = P.find(g, 'kitchen'), Dn = P.find(g, 'dining'), H = P.find(g, 'hall');
  const sofa = trap ? pick(R, [0x5b4a3e, 0x3d3a3a, 0x6a5b4c]) : pick(R, SOFA);
  // living room: the sofa facing the TV across the room, coffee table, armchair, rug, a lamp, plants
  if (L) {
    const tvSide = s.brothersHome ? 'y1' : L.x1 - L.x0 > L.y1 - L.y0 ? (R() < 0.5 ? 'x0' : 'x1') : 'y1';
    const longW = tvSide[0] === 'x' ? L.y1 - L.y0 : L.x1 - L.x0;
    const sw = clamp(longW * 0.55, 1.6, nice ? 3.0 : 2.3);
    const layout = livingWalls(P, g, L, tvSide, sw, clamp(sw * 0.7, 1.0, 1.8));
    const opp = layout.opposite;
    const tvU = wallItem(P, g, L, layout.side, 'tvunit', layout.tv, 0.42, 0.5, { col: trap ? 0x2c2a28 : pick(R, [0x2c2a28, 0xe9e4da, 0x9a7a58, 0x55585c]) });
    // (the brothers' own: a big 16:9 set, about 90 inches, black until it's switched on: homeTV.js)
    if (tvU) P.add(g, 'tv', tvU.x, tvU.y, s.brothersHome ? 2.0 : trap ? 1.45 : nice ? 1.6 : 1.15, 0.08, s.brothersHome ? 1.13 : 0.7, { rot: tvU.rot, base: 0.5, solid: false, dark: !!s.brothersHome });
    if(tvU)P.add(g,'radio',tvU.x-.35*Math.cos(tvU.rot),tvU.y-.35*Math.sin(tvU.rot),.24,.16,.15,{base:.5,rot:tvU.rot,solid:false});
    if(s.brothersHome && tvU)P.add(g,'box',tvU.x+.55*Math.cos(tvU.rot),tvU.y+.55*Math.sin(tvU.rot),.26,.21,.065,{base:.5,col:0x21252c,rot:tvU.rot,solid:false});
    const so = wallItem(P, g, L, opp, nice ? 'sofaL' : 'sofa', layout.sofa, 0.92, 0.85, { col: sofa, col2: trap ? 0x4a3d32 : null, worn: trap });
    if (so && tvU) {
      const [cx, cy] = [(so.x + tvU.x) / 2, (so.y + tvU.y) / 2];
      P.add(g, 'rug', cx, cy, sw * 0.95, 1.6, 0.01, { rot: so.rot, col: trap ? 0x4f463b : pick(R, [0xb8a68a, 0x7d8c9c, 0x9a5b4b, 0xd8cfc0, 0x4d5a4e]), solid: false, stained: trap });
      P.add(g, 'coffeetable', cx, cy, 1.0, 0.55, 0.42, { rot: so.rot, col: trap ? 0x6b5236 : pick(R, [0x6b5236, 0xd8c29a, 0x2c2a28]), clutter: trap ? 'trap' : R() < 0.5 ? 'books' : null });
    }
    wallItem(P, g, L, R() < 0.5 ? 'y0' : opp === 'y0' ? 'y1' : 'y0', 'armchair', 0.85, 0.85, 0.85, { col: trap ? 0x6d5a45 : pick(R, SOFA), at: 0.2 });
    if (!trap) { wallItem(P, g, L, pick(R, sides), 'plant', 0.45, 0.45, 1.1, { at: R(), solid: true }); wallItem(P, g, L, pick(R, sides), 'lamp', 0.35, 0.35, 1.55, { at: R() < 0.5 ? 0.05 : 0.95 }); }
    // the chimney breast: a fireplace with a mirror over it on one of the side walls, a clock
    if (!trap) { const fs = sides.filter(x => x !== tvSide && x !== opp && x !== 'y0'); wallItem(P, g, L, fs.length ? pick(R, fs) : pick(R, sides.filter(x => x !== tvSide && x !== opp)), 'homefire', 1.3, 0.38, 2.0, { tall: true, col: nice ? 0xf2f1ec : pick(R, [0xf2f1ec, 0x8a6a4a, 0x55585c, 0xd8c29a]), lit: R() < 0.5, at: 0.5 }); }
    if (s.brothersHome) {
      wallItem(P, g, L, 'x0', 'lamp', 0.48, 0.48, 1.55, { at: 0.2 });
      wallItem(P, g, L, 'y1', 'shelves', 1.15, 0.32, 1.55, { at: 0.16, col: 0x856548 });
    }
    if (!trap) wallItem(P, g, L, pick(R, sides), 'clock', 0.32, 0.04, 0.32, { base: 2.0, solid: false, tall: true });
    if (!trap && R() < 0.7) wallItem(P, g, L, pick(R, sides), 'shelves', 0.9, 0.32, 1.8, { tall: true, col: pick(R, [0xe9e4da, 0x8a6a4a, 0x2c2a28]) });
    if (trap) { wallItem(P, g, L, pick(R, sides), 'binbags', 0.8, 0.6, 0.6, { at: 0.95 }); P.add(g, 'cans', (L.x0 + L.x1) / 2 + 0.6, L.y1 - 0.5, 0.5, 0.4, 0.12, { solid: false }); wallItem(P, g, L, pick(R, sides), 'cctv', 0.5, 0.35, 1.0, { col: 0x222222, at: 0.9 }); }
  }
  // kitchen: a run of units with worktop along the back, sink under the window, the cooker, a fridge-freezer,
  // a table
  const kitchen = K || Dn;
  if (kitchen) {
    const run = kitchen.x1 - kitchen.x0 - 0.2;
    const kSide = kitchen.y1 >= P.D - 0.01 ? 'y1' : 'x1';
    const it = kitchenItem(P, g, kitchen, kSide, 'units', Math.min(run, nice ? 5 : 3.6), 0.62, 0.92, { splash: trap ? 0xd9d2bf : pick(R, [0xf2f1ec, 0xdfe8ea, 0x9fb3c8, 0xd9c7a7, 0x2c2c2c]), col: P.style.units === 'tired white' ? 0xe8e3d6 : UNITS.find(u => u[1] === P.style.units)?.[0], top: trap ? 0x8c8270 : nice ? 0xeae6e0 : pick(R, [0x3b3b3b, 0xd9d2c4, 0x8a6a4a, 0xf0efe9]), tall: false, at: 0.4, sink: true });
    if (it) P.add(g, 'wallunits', it.x, it.y, it.w * 0.8, 0.34, 0.7, { rot: it.rot, base: 1.45, col: it.col, solid: false });
    kitchenItem(P, g, kitchen, kSide === 'y1' ? (R() < 0.5 ? 'x0' : 'x1') : 'y1', 'fridge', 0.62, 0.65, 1.8, { tall: true, col: trap ? 0xe9e7e0 : pick(R, [0xe9e7e0, 0xb9bcbf, 0x2c2c2c]), at: R() < 0.5 ? 0.04 : 0.96 });
    if (nice) { const [cx, cy] = mid(kitchen); P.add(g, 'island', cx, cy - 0.2, 2.2, 1.0, 0.92, { col: UNITS.find(u => u[1] === P.style.units)?.[0] || 0x2e3d55, top: 0xeae6e0 }); }
    const tableRoom = Dn && Dn !== kitchen ? Dn : kitchen;
    const [tx, ty] = mid(tableRoom);
    if (!nice || tableRoom !== kitchen) {
      const tw = clamp((tableRoom.x1 - tableRoom.x0) * 0.35, 1.0, nice ? 2.2 : 1.5);
      P.add(g, 'table', tx, ty + (tableRoom === kitchen ? 0.3 : 0), tw, 0.85, 0.75, { col: trap ? 0x6b5a46 : pick(R, [0x8a6a4a, 0xd8c29a, 0xf0efe9, 0x3b3b3b]), chairs: trap ? 2 : nice ? 6 : 4, chairCol: pick(R, [0x3b3b3b, 0xd8c29a, 0x7f9c80, 0xe9e4da]), clutter: trap ? 'scales' : R() < 0.4 ? 'fruit' : null });
    }
    if (trap) { wallItem(P, g, kitchen, 'x0', 'binbags', 0.9, 0.7, 0.7, { at: 0.9 }); P.add(g, 'pizzaboxes', tx - 0.9, ty + 0.4, 0.45, 0.45, 0.2, { solid: false }); }
  }
  // hall: a coat rack or a console, a mirror, a doormat; post piling up in the trap house
  if (H) {
    P.add(g, 'doormat', P.site.doorX, 0.45, 0.8, 0.5, 0.01, { solid: false, col: 0x6b5236 });
    if (trap) P.add(g, 'post', P.site.doorX + 0.15, 0.7, 0.5, 0.4, 0.03, { solid: false });
    else { wallItem(P, g, H, H.x0 > 0.1 ? 'x0' : 'x1', 'console', 0.8, 0.3, 0.8, { at: 0.08 }); wallItem(P, g, H, H.x0 > 0.1 ? 'x1' : 'x0', 'coathooks', 0.9, 0.3, 1.7, { at: 0.06, solid: false }); }
  }
  // the nicer houses: a dado rail in the hall, the living and dining rooms
  if (!trap && (nice || P.R() < 0.4)) for (const r of [H, L, Dn]) if (r) r.dado = true;
  // pictures on the walls (not in the trap house)
  if (!trap) for (const r of [L, H, Dn, ...f.rooms.filter(q => /^bed/.test(q.name))]) if (r) for (let k = 0; k < (r === L ? 2 : 1); k++) wallItem(P, r.lv ? f : g, r, pick(R, sides), 'picture', 0.5 + R() * 0.5, 0.04, 0.4 + R() * 0.35, { base: 1.35, solid: false, tall: true, seed: Math.floor(R() * 16), col: pick(R, [0x2a2a2a, 0xc9b26a, 0xf2f1ec, 0x8a6a4a]) });
  // upstairs: beds (a mattress on the floor in the trap house), wardrobes, bedside tables; the bathroom suite
  for (const r of f.rooms) {
    if (/^bed/.test(r.name)) {
      const big = (r.x1 - r.x0) * (r.y1 - r.y0) > 9;
      const duvet = trap ? pick(R, [0x6f6a62, 0x4f5a6e]) : pick(R, DUVET);
      const bedSide = (r.x1 - r.x0) > (r.y1 - r.y0) ? (r.y0 < 0.01 ? 'y1' : 'y0') : (r.x0 < 0.01 ? 'x0' : 'x1');
      if (trap && r.name === 'bed2') {
        // the back bedroom's a grow room
        const [cx, cy] = mid(r);
        P.add(f, 'growtent', cx, cy, Math.min(1.5, r.x1 - r.x0 - 0.8), Math.min(1.5, r.y1 - r.y0 - 0.8), 2.0, { col: 0x1c1c1c });
        wallItem(P, f, r, 'x1', 'binbags', 0.7, 0.6, 0.6, { at: 0.1 });
        continue;
      }
      const b = wallItem(P, f, r, bedSide, trap ? 'mattress' : big ? 'bed2' : 'bed1', trap ? 1.4 : big ? (nice ? 1.8 : 1.5) : 0.95, trap ? 1.95 : 2.05, trap ? 0.22 : 0.55, { col: duvet, frame: trap ? null : pick(R, [0x8a6a4a, 0xe9e4da, 0x55585c, 0xd8c29a]), at: 0.5 });
      if (b && !trap) { for (const sgn of [-1, 1]) { const ox = Math.cos(b.rot) * sgn * (b.w / 2 + 0.3), oy = Math.sin(b.rot) * sgn * (b.w / 2 + 0.3); const bx = b.x + ox - Math.sin(b.rot) * -(b.d / 2 - 0.25), by = b.y + oy + Math.cos(b.rot) * -(b.d / 2 - 0.25); if (bx > r.x0 + 0.25 && bx < r.x1 - 0.25 && by > r.y0 + 0.25 && by < r.y1 - 0.25) P.add(f, 'bedside', bx, by, 0.45, 0.4, 0.5, { rot: b.rot, col: b.frame }); } }
      if (!trap) wallItem(P, f, r, pick(R, sides.filter(x => x !== bedSide)), 'wardrobe', big ? 1.5 : 1.0, 0.6, 2.0, { tall: true, col: pick(R, [0xe9e4da, 0x8a6a4a, 0xd8c29a, 0x55585c]), at: R() < 0.5 ? 0.05 : 0.95 });
      if (!trap && R() < 0.6) wallItem(P, f, r, pick(R, sides), 'drawers', 0.8, 0.45, 0.8, { col: pick(R, [0xe9e4da, 0x8a6a4a, 0xd8c29a]) });
      if (!trap && big) wallItem(P, f, r, pick(R, sides.filter(x => x !== bedSide)), 'dressing', 1.0, 0.45, 1.5, { col: pick(R, [0xe9e4da, 0x8a6a4a, 0xd8c29a]), tall: true });
      if (!trap && b) { const [cx, cy] = mid(r); P.add(f, 'rug', b.x + (cx - b.x) * 0.15 - Math.sin(b.rot) * 0, b.y + (cy - b.y) * 0.15, b.w + 0.8, 1.2, 0.01, { rot: b.rot, col: pick(R, [0xd8cfc0, 0x7d8c9c, 0xb8a68a, 0x9a5b4b]), solid: false }); }
      if (trap) { wallItem(P, f, r, pick(R, sides), 'clothes', 0.9, 0.6, 0.35, { solid: false }); wallItem(P, f, r, pick(R, sides), 'binbags', 0.7, 0.6, 0.6, {}); }
    }
    if (r.name === 'bath') {
      const bl = Math.min(1.7, Math.max(r.x1 - r.x0, r.y1 - r.y0) - 0.1);
      const along = (r.x1 - r.x0) >= (r.y1 - r.y0) ? 'y1' : (r.x0 < 0.01 ? 'x0' : 'x1');
      wallItem(P, f, r, along, nice ? 'freebath' : 'bath', bl, 0.72, 0.55, { col: 0xf7f7f4, at: 0.5, dirty: trap });
      const other = along === 'y1' ? (r.x0 < 0.01 ? 'x0' : 'x1') : 'y1';
      wallItem(P, f, r, other, 'toilet', 0.4, 0.65, 0.75, { col: trap ? 0xe9e4d4 : 0xf7f7f4, at: 0.85 });
      wallItem(P, f, r, other === 'x0' ? 'x1' : other === 'x1' ? 'x0' : 'y0', 'basin', 0.55, 0.42, 0.85, { col: 0xf7f7f4, mirror: true, at: 0.5 });
      if (!trap) { wallItem(P, f, r, pick(R, sides.filter(x => x !== along)), 'towelrail', 0.55, 0.1, 1.15, { col: pick(R, [0xf2f2ee, 0x9fb3c8, 0xd8c29a, 0x7f9c80]), at: R() < 0.5 ? 0.15 : 0.85, solid: false }); const [cx, cy] = mid(r); P.add(f, 'rug', cx, cy, 0.8, 0.5, 0.01, { col: pick(R, [0x9fb3c8, 0xf2f2ee, 0x7f9c80]), solid: false }); }
    }
  }
}

// ------------------------------------------------------------------ a bungalow (one floor, a corridor down the middle)
function bungalow(P, s) {
  const R = P.R, { W, D, fh } = P;
  const cx0 = W / 2 - 0.55, cx1 = W / 2 + 0.55;
  P.site.doorX = W / 2; P.exit.x = W / 2;
  const paint = pick(R, Object.values(PAINT)), paint2 = pick(R, [PAINT.white, PAINT.magnolia, PAINT.cream, PAINT.greige]);
  const carpet = pick(R, CARPET), woodFloor = R() < 0.4, wood = pick(R, WOOD);
  const living = woodFloor ? ['wood', wood] : ['carpet', carpet];
  const units = pick(R, UNITS);
  P.style = { paint, paint2, carpet, units: units[1] };
  const g = P.level(fh - 0.12);
  const yl = D * 0.55, yb1 = (D - 2.0) / 2;
  P.room(g, 'corridor', cx0, 0, cx1, D, { floor: woodFloor ? living : ['carpet', carpet], wall: ['plaster', paint2], windows: 0 });
  P.room(g, 'living', 0, 0, cx0, yl, { floor: living, wall: ['plaster', paint] });
  P.room(g, 'kitchen', 0, yl, cx0, D, { floor: pick(R, [['tile', 0xe4e0d8], ['tile', 0xc9c2b4], ['wood', 0xd9c09c]]), wall: ['plaster', paint2], winW: 1.2 });
  P.room(g, 'bed1', cx1, 0, W, yb1, { floor: ['carpet', pick(R, CARPET)], wall: ['plaster', pick(R, Object.values(PAINT))] });
  P.room(g, 'bath', cx1, yb1, W, yb1 + 2.0, { floor: ['tile', 0xe9e4da], wall: ['tile', 0xf2f1ec], frosted: true, winW: 0.6 });
  P.room(g, 'bed2', cx1, yb1 + 2.0, W, D, { floor: ['carpet', pick(R, CARPET)], wall: ['plaster', pick(R, Object.values(PAINT))] });
  for (const [r, at] of [['living', yl - 0.8], ['kitchen', yl + 0.8], ['bed1', yb1 - 0.6], ['bath', yb1 + 1.0], ['bed2', yb1 + 2.6]]) P.door(g, 'corridor', r, { at });
  P.door(g, 'living', 'kitchen', { at: cx0 / 2 });
  P.finish();
  // the same furnishing as a house, all on one floor
  const L = P.find(g, 'living'), K = P.find(g, 'kitchen');
  const sofaCol = pick(R, SOFA);
  const layout = livingWalls(P, g, L, 'x0', clamp((L.y1 - L.y0) * 0.55, 1.5, 2.2), 1.2);
  const tv = wallItem(P, g, L, layout.side, 'tvunit', layout.tv, 0.42, 0.5, { col: pick(R, [0x2c2a28, 0xe9e4da, 0x9a7a58]) });
  if (tv) { P.add(g, 'tv', tv.x, tv.y, 1.1, 0.08, 0.65, { rot: tv.rot, base: 0.5, solid: false }); P.add(g,'radio',tv.x-.3*Math.cos(tv.rot),tv.y-.3*Math.sin(tv.rot),.24,.16,.15,{base:.5,rot:tv.rot,solid:false}); }
  const so = wallItem(P, g, L, layout.opposite, 'sofa', layout.sofa, 0.9, 0.85, { col: sofaCol });
  if (so && tv) { P.add(g, 'rug', (so.x + tv.x) / 2, (so.y + tv.y) / 2, 1.8, 1.4, 0.01, { rot: so.rot, col: pick(R, [0xb8a68a, 0x7d8c9c, 0x9a5b4b, 0xd8cfc0]), solid: false }); P.add(g, 'coffeetable', (so.x + tv.x) / 2, (so.y + tv.y) / 2, 0.9, 0.5, 0.42, { rot: so.rot, col: 0x6b5236, clutter: 'books' }); }
  wallItem(P, g, L, 'y1', 'homefire', 1.3, 0.38, 2.0, { tall: true, col: pick(R, [0xf2f1ec, 0x8a6a4a, 0xd8c29a]), lit: R() < 0.5, at: 0.3 });
  wallItem(P, g, L, 'x0', 'lamp', 0.35, 0.35, 1.55, { at: 0.05 });
  wallItem(P, g, L, 'x1', 'picture', 0.7, 0.04, 0.5, { base: 1.35, solid: false, tall: true, seed: Math.floor(R() * 16), col: pick(R, [0x2a2a2a, 0xc9b26a, 0xf2f1ec]) });
  wallItem(P, g, L, 'y0', 'armchair', 0.85, 0.85, 0.85, { col: pick(R, SOFA), at: 0.15 });
  wallItem(P, g, L, 'y1', 'shelves', 0.9, 0.32, 1.8, { tall: true, col: pick(R, [0xe9e4da, 0x8a6a4a]) });
  wallItem(P, g, L, 'y0', 'plant', 0.45, 0.45, 1.0, { at: 0.9 });
  const u = kitchenItem(P, g, K, 'y1', 'units', Math.min(K.x1 - K.x0 - 0.2, 3.2), 0.62, 0.92, { col: units[0], top: pick(R, [0x3b3b3b, 0xd9d2c4, 0x8a6a4a]), sink: true });
  if (u) P.add(g, 'wallunits', u.x, u.y, u.w * 0.8, 0.34, 0.7, { rot: u.rot, base: 1.45, col: units[0], solid: false });
  kitchenItem(P, g, K, 'x0', 'fridge', 0.62, 0.65, 1.8, { tall: true, col: 0xe9e7e0, at: 0.9 });
  const [tx, ty] = mid(K); P.add(g, 'table', tx, ty - 0.2, 1.1, 0.8, 0.75, { col: pick(R, [0x8a6a4a, 0xd8c29a]), chairs: 2, chairCol: pick(R, [0x3b3b3b, 0xd8c29a]) });
  for (const r of g.rooms) if (/^bed/.test(r.name)) {
    const big = r.name === 'bed1';
    const b = wallItem(P, g, r, 'x1', big ? 'bed2' : 'bed1', big ? 1.5 : 0.95, 2.05, 0.55, { col: pick(R, DUVET), frame: pick(R, [0x8a6a4a, 0xe9e4da, 0x55585c]) });
    if (b) { for (const sgn of [-1, 1]) { const by = b.y + sgn * (b.w / 2 + 0.3); if (by > r.y0 + 0.25 && by < r.y1 - 0.25) P.add(g, 'bedside', b.x + (b.d / 2 - 0.25), by, 0.45, 0.4, 0.5, { rot: b.rot, col: b.frame }); } P.add(g, 'rug', (r.x0 + r.x1) / 2 - 0.3, (r.y0 + r.y1) / 2, 1.2, b.w + 0.6, 0.01, { col: pick(R, [0xd8cfc0, 0x7d8c9c, 0xb8a68a]), solid: false }); }
    wallItem(P, g, r, r.name === 'bed1' ? 'y0' : 'y1', 'wardrobe', 1.0, 0.6, 2.0, { tall: true, col: pick(R, [0xe9e4da, 0x8a6a4a]), at: 0.9 });
  }
  const B = P.find(g, 'bath');
  wallItem(P, g, B, 'x1', 'bath', Math.min(1.7, B.y1 - B.y0 - 0.1), 0.72, 0.55, { col: 0xf7f7f4 });
  wallItem(P, g, B, 'y0', 'toilet', 0.4, 0.65, 0.75, { col: 0xf7f7f4, at: 0.2 });
  wallItem(P, g, B, 'y1', 'basin', 0.55, 0.42, 0.85, { col: 0xf7f7f4, mirror: true, at: 0.2 });
  wallItem(P, g, B, 'y1', 'towelrail', 0.55, 0.1, 1.15, { col: pick(R, [0xf2f2ee, 0x9fb3c8, 0x7f9c80]), at: 0.85, solid: false });
  wallItem(P, g, P.find(g, 'corridor'), 'x0', 'coathooks', 0.9, 0.3, 1.7, { at: 0.08, solid: false });
}

// ------------------------------------------------------------------ a warehouse
function warehouse(P, s) {
  const R = P.R, { W, D, fh } = P;
  P.site.doorX = clamp(s.doorX, 2, W - 2); P.exit.x = P.site.doorX; P.frontW = 0.5;
  const g = P.level(fh);
  const clad = pick(R, [0xb9c0c6, 0xc9c4b8, 0x9fb0bf, 0xd0d0cc]);
  P.room(g, 'floor', 0, 0, W, D, { floor: ['concrete', 0xd8d6d0], wall: ['metal', clad], windows: 'many', sill: Math.min(fh - 1.6, 4), head: Math.min(fh - 0.4, 5.4), ceil: 0xc9ccce, kind: 'warehouse' });
  // the office in the front corner
  const ow = Math.min(6, W * 0.25), od = Math.min(4.5, D * 0.2);
  const corner = P.site.doorX > W / 2 ? 'left' : 'right';
  const ox0 = corner === 'left' ? 0 : W - ow;
  P.style = { warehouse: true };
  P.finish();
  P.add(g, 'cabin', ox0 + ow / 2, od / 2, ow, od, 2.7, { col: 0xe9e7e0, frame: 0x4a5a6a, door: corner === 'left' ? 'x1' : 'x0' });
  // racking: rows along the depth, aisles between, clear of the office and the door
  const aisle = 3.2, rackD = 1.1, rackH = Math.min(fh - 1.2, 7);
  const colA = pick(R, [0x2f5fa8, 0x3a6b4a, 0x6a6f75]), colB = pick(R, [0xe0782a, 0xe0a02a, 0xd84a3a]);
  const y0 = od + 2.5, y1 = D - 3.5;
  for (let x = 2.5, k = 0; x + rackD < W - 2; x += rackD + aisle, k++) {
    if (Math.abs(x + rackD / 2 - P.site.doorX) < 2.2 && y0 < 6) continue;
    if (y1 - y0 < 5) break;
    P.add(g, 'racking', x + rackD / 2, (y0 + y1) / 2, rackD, y1 - y0, rackH, { col: colA, col2: colB, rot: 0, seed: k });
  }
  // a forklift, pallets, a roller door on the back wall
  P.add(g, 'forklift', W * 0.5 + 1.6, D - 2.0, 1.2, 2.2, 2.1, { rot: Math.PI / 2, col: pick(R, [0xf0b81c, 0xd84a3a, 0x3a6b4a]) });
  for (let k = 0; k < 6; k++) P.add(g, 'pallet', 2 + R() * (W - 4), D - 1.6 + (R() - 0.5) * 0.6, 1.2, 1.0, 0.15 + R() * 1.2, { rot: R() < 0.5 ? 0 : Math.PI / 2 });
  P.add(g, 'rollerdoor', W / 2, D - 0.06, Math.min(5, W * 0.3), 0.12, Math.min(5, fh - 1), { solid: false });
  P.add(g, 'floorlines', W / 2, D / 2, W, D, 0.005, { solid: false });
  P.add(g, 'exitsign', P.site.doorX, 0.1, 0.44, 0.06, 0.16, { base: Math.min(fh - 0.6, 3.2), solid: false, rot: 0 });
  P.add(g, 'pallettruck', W * 0.5 - 1.6, D - 2.6, 0.6, 1.6, 1.2, { rot: 0.3, col: pick(R, [0xd84a3a, 0x2f5fa8, 0xf0b81c]) });
  const cbx = corner === 'left' ? ow + 0.5 : W - ow - 0.5;
  P.add(g, 'barrier', cbx, od / 2, od - 0.4, 0.12, 1.0, { rot: Math.PI / 2 });
}

// ------------------------------------------------------------------ an office (two floors, stairs in a core)
function office(P, s) {
  const R = P.R, { W, D, fh } = P;
  P.site.doorX = clamp(s.doorX, 3, W - 3); P.exit.x = P.site.doorX; P.frontW = 0.9; P.frontTop = 2.3;
  const brand = pick(R, [0x2f6fb0, 0x3a8a6a, 0xc0392b, 0x8e44ad, 0xe67e22, 0x16a085]);
  P.style = { office: true, brand };
  const carpet = pick(R, [0x5a6170, 0x6b6f75, 0x4f5866, 0x7a7466]);
  const lvls = s.lv >= 2 ? 2 : 1;
  // the core: stairs and toilets at the back on one side; reception at the front
  const coreW = 4.2, coreX = R() < 0.5 ? 0 : W - coreW, st = stairsFit(P, fh, Math.min(D - 2, 6.5));
  const sy0 = D - 1.4 - st.len, sy1 = D - 1.4;
  for (let i = 0; i < lvls; i++) {
    const lv = P.level(fh - 0.35);
    P.room(lv, 'open' + i, coreX ? 0 : coreW, 0, coreX ? coreX : W, D, { floor: ['carpettile', carpet], wall: ['plaster', i ? PAINT.white : PAINT.grey], windows: 'many', ceil: 0xf2f2ee, kind: 'office', sill: 0.75, head: Math.min(2.6, fh - 0.5) });
    P.room(lv, 'core' + i, coreX, 0, coreX + coreW, D, { floor: ['tile', 0xc8c6c0], wall: ['plaster', PAINT.white], windows: 0, group: 'core' + i });
    P.door(lv, 'open' + i, 'core' + i, { at: i ? sy1 - 0.2 : sy0 - 1.2, w: 1.0 });
    if (!i) P.door(lv, 'open' + i, 'core' + i, { at: 2.2, w: 1.0 });
  }
  if (lvls > 1) P.stairs.push({ lv: 0, x0: coreX + 0.3, x1: coreX + 1.5, y0: sy0, y1: sy1, dir: 'y', up: +1, rise: fh, n: st.n, side: 'x1', col: 0x8a8d90 });
  P.finish();
  for (let i = 0; i < lvls; i++) {
    const lv = P.levels[i], r = P.find(lv, 'open' + i);
    if (!i) {
      // reception: a desk facing the door, sofas, a logo wall
      P.add(lv, 'reception', P.site.doorX, 3.0, 2.4, 0.8, 1.05, { col: 0xf2f2ee, col2: brand });
      P.add(lv, 'sofa', P.site.doorX + (P.site.doorX > W / 2 ? -3.2 : 3.2), 1.0, 1.8, 0.85, 0.8, { col: brand, rot: 0 });
      P.add(lv, 'plant', P.site.doorX - 1.8, 1.0, 0.5, 0.5, 1.3, {});
    }
    // desks in clusters of four
    const x0 = r.x0 + 1.5, x1 = r.x1 - 1.5, y0 = i ? 1.5 : 5.2, y1 = r.y1 - 2.0;
    let k = 0;
    for (let y = y0; y + 1.6 < y1; y += 3.4) for (let x = x0; x + 2.8 < x1; x += 3.8) {
      if (k > 40) break;
      P.add(lv, 'deskpod', x + 1.4, y + 0.8, 2.8, 1.6, 0.74, { col: 0xeeeeea, col2: pick(R, [0x3b3b3b, 0x5a6170]), seed: k++ });
    }
    // a meeting room's table at the back, a kitchenette by the core
    P.add(lv, 'meeting', (r.x0 + r.x1) / 2, r.y1 - 1.3, Math.min(4, r.x1 - r.x0 - 2), 1.2, 0.74, { col: 0xd8c29a, chairs: 8, chairCol: brand });
    const c = P.find(lv, 'core' + i);
    wallItem(P, lv, c, c.x0 < 0.1 ? 'x0' : 'x1', 'units', Math.min(2.6, D * 0.3), 0.62, 0.92, { col: 0xf2f2ee, top: 0x3b3b3b, sink: true, at: 0.35, noHob: true });
    wallItem(P, lv, c, c.x0 < 0.1 ? 'x0' : 'x1', 'fridge', 0.62, 0.65, 1.8, { tall: true, col: 0xb9bcbf, at: 0.15 });
    wallItem(P, lv, r, 'y1', 'plant', 0.5, 0.5, 1.3, { at: 0.05 }); wallItem(P, lv, r, 'y1', 'printer', 0.9, 0.6, 1.0, { at: 0.95, col: 0xe9e9e6 });
    const side = coreX ? 'x0' : 'x1';
    if (!i) P.add(lv, 'exitsign', P.site.doorX, 0.1, 0.44, 0.06, 0.16, { base: 2.35, solid: false, rot: 0 });
    wallItem(P, lv, r, side, 'whiteboard', 1.8, 0.05, 1.1, { base: 0.95, solid: false, tall: true, at: 0.85 });
    wallItem(P, lv, r, 'y1', 'watercooler', 0.45, 0.4, 1.4, { at: 0.18 });
    for (const at of [0.62, 0.7]) wallItem(P, lv, r, side, 'filing', 0.5, 0.62, 1.32, { at, col: pick(R, [0x8a8d90, 0xd8d6d0, 0x55585c]) });
  }
}

// ------------------------------------------------------------------ a shop (a convenience store)
// the chain's colours for a shop's fittings (staff tops, the counter front, the chiller trim): by name; an
// independent gets its own from the seed
const CHAIN = [[/co-?op/i, 0x00a1cc], [/nisa/i, 0xd71920], [/londis/i, 0xe4002b], [/one stop/i, 0x1d4f91], [/spar/i, 0x00843d], [/premier/i, 0x6a1b9a],
  [/budgens/i, 0x5c8a2e], [/costcutter/i, 0xe2001a], [/tesco/i, 0x00539f], [/sainsbury/i, 0xf06c00], [/best-?one/i, 0x1b3f8b], [/mace/i, 0xc8102e],
  [/\bbp\b|bp shop/i, 0x009b3a], [/shell/i, 0xdd1d21], [/esso/i, 0x1a3c8f], [/asda/i, 0x7dc242], [/m&s|marks/i, 0x1c1c1c], [/morrisons/i, 0x00563f]];
export const shopColour = (name, R) => CHAIN.find(([re]) => re.test(name || ''))?.[1] ?? [0x2f6fb0, 0xd84a3a, 0x3a8a6a, 0x7d3c98, 0xe08a1e, 0x1f7a7a][Math.floor(R() * 6)];
function shop(P, s) {
  const R = P.R, { W, D, fh } = P;
  P.site.doorX = clamp(s.doorX, 1.5, W - 1.5); P.exit.x = P.site.doorX; P.frontW = 0.85; P.frontTop = 2.2;
  const g = P.level(Math.min(fh - 0.3, 3.2));
  const sd = Math.max(2.2, Math.min(3.5, D * 0.22));
  const brand = shopColour(s.name, R);
  // a few looks: floor tiles, wall colour
  const floor = pick(R, [0xdcdad4, 0xc9c6bd, 0xe6e2d8, 0xb9b4a8, 0xd8d2c4]), wall = pick(R, [PAINT.white, PAINT.white, PAINT.cream, PAINT.greige]);
  P.room(g, 'shop', 0, 0, W, D - sd, { floor: ['tile', floor], wall: ['plaster', wall], windows: 'many', sill: 0.3, head: 2.3, ceil: 0xf2f2ee, kind: 'shop' });
  P.room(g, 'stock', 0, D - sd, W, D, { floor: ['concrete', 0xc8c6c0], wall: ['plaster', PAINT.grey], windows: 0 });
  P.door(g, 'shop', 'stock', { at: W - 1.0 });
  P.style = { shop: true, brand };
  P.finish();
  const r = P.find(g, 'shop');
  // the counter: freestanding by the door on one side, the shopkeeper behind it with the gantry (cigarettes behind
  // their shutters, spirits above) on the wall at their back; the chillers down the other side, aisles between
  const cs = P.site.doorX > W / 2 ? 'x0' : 'x1', cw = cs === 'x0' ? 'x1' : 'x0', sg = cw === 'x0' ? 1 : -1, wx = cw === 'x0' ? 0 : W;
  const cy = clamp(2.2 + R() * 0.8, 1.8, r.y1 - 2.2), cl = clamp(2.4 + R() * 0.6, 2, r.y1 - 1.2);
  const counterX = wx + sg * 1.32, rot = cw === 'x0' ? -Math.PI / 2 : Math.PI / 2;
  P.add(g, 'counter', counterX, cy, cl, 0.66, 1.0, { col: pick(R, [0x8a6a4a, 0x3b3b3b, 0xe9e4da]), till: true, sweets: true, noBack: true, rot, col2: brand });
  P.add(g, 'gantry', wx + sg * 0.17, cy, cl + 0.4, 0.32, 2.2, { rot, col: brand });
  P.tills = [{ x: wx + sg * 2.15, y: cy }];
  P.staffSpots = [{ x: wx + sg * 0.7, y: cy, dx: sg, dy: 0, till: 0 }];
  P.seats = []; P.games = [];
  // the counter's ends meet the wall, so the space behind it is the shopkeeper's
  P.add(g, 'box', wx + sg * 0.66, cy - cl / 2 - 0.05, 1.32, 0.1, 1.0, { col: 0x8a8a88, rot: 0 });
  P.add(g, 'box', wx + sg * 0.66, cy + cl / 2 + 0.05, 1.32, 0.1, 1.0, { col: 0x8a8a88, rot: 0 });
  wallItem(P, g, r, cs, 'chiller', Math.min(5, D - sd - 1.5), 0.8, 2.0, { tall: true, at: 0.6, col: brand });
  wallItem(P, g, r, 'y1', 'gondola', Math.min(W - 2.5, 6), 0.45, 1.7, { at: 0.5, seed: 1 });
  const ax0 = cw === 'x0' ? 2.9 : 1.6, ax1 = W - (cw === 'x1' ? 2.9 : 1.6);
  for (let y = 2.4 + (R() < 0.5 ? 0.4 : 0), k = 0; y < D - sd - 1.6; y += 2.0 + R() * 0.3, k++) if (ax1 - ax0 > 2) P.add(g, 'gondola2', (ax0 + ax1) / 2, y, ax1 - ax0 - 0.6, 0.9, 1.5, { seed: k + 2 });
  // by the door: baskets, the papers; an ice-cream freezer at the front of the chillers; a cash machine (not every shop)
  const dsg = cs === 'x0' ? -1 : 1;
  P.add(g, 'basketstack', clamp(P.site.doorX + dsg * 1.15, 0.5, W - 0.5), 0.7, 0.45, 0.33, 0.62, { col: brand });
  if (W > 5.5 && R() < 0.75) P.add(g, 'newsstand', clamp(P.site.doorX - dsg * 1.5, 1.0, W - 1.0), 1.0, 1.0, 0.45, 1.05, { rot: 0 });
  if (R() < 0.8) wallItem(P, g, r, cs, 'freezer', 1.3, 0.72, 0.85, { at: 0.04, col: pick(R, [0x2f6fb0, 0xc0392b, 0xe67e22]) });
  if (R() < 0.6) wallItem(P, g, r, 'y1', 'atm', 0.6, 0.45, 1.7, { tall: true, at: R() < 0.5 ? 0.05 : 0.95, col: brand });
  P.add(g, 'doormat', P.site.doorX, 0.45, 1.2, 0.6, 0.01, { solid: false, col: 0x2a2a2a });
  const st = P.find(g, 'stock');
  // Deliveries line the back wall, leaving the stockroom door and a walking aisle clear.
  for (let x = 0.7; x < W - 0.8; x += 1.15) {
    const height = 0.42 + R() * 0.28;
    P.add(g, 'box', x, st.y1 - 0.48, 0.84, 0.66, height, { col: 0xb08a5a });
    if (R() < 0.65) P.add(g, 'box', x, st.y1 - 0.48, 0.62, 0.48, 0.38, { base: height, col: 0xc49a68 });
  }
}

// ------------------------------------------------------------------ a pub
function pub(P, s) {
  const R = P.R, { W, D } = P;
  P.site.doorX = clamp(s.doorX, 1.5, W - 1.5); P.exit.x = P.site.doorX;
  const ceil = clamp(P.fh - 0.15, 2.45, 3.0);
  const g = P.level(ceil);
  const carpet = pick(R, [0x6b2f35, 0x2f4a3a, 0x3a3550, 0x5a3a2a]), paper = pick(R, [0xb99d6b, 0x9a6b5b, 0x7a8a6b, 0x8a7a9a]);
  P.room(g, 'bar', 0, 0, W, D, { floor: ['carpet', carpet], wall: ['wallpaper', paper], windows: 'many', ceil: 0xe9dcc0, kind: 'pub', sill: 0.85, winW: 1.2 });
  P.style = { pub: true };
  P.finish();
  const r = P.find(g, 'bar'); r.dado = true;
  s.food = 'pub';
  const wood = pick(R, [0x5b3a22, 0x4a2f1c, 0x6b4a2f]);
  // the bar along the back, a staff aisle behind it, the back bar on the wall; closed at the ends
  const barW = Math.min(W - 2.4, 8.5), bx = W / 2, yb = D - 1.95;
  P.add(g, 'barcounter', bx, yb, barW, 0.7, 1.08, { col: wood });
  P.add(g, 'backbar', bx, D - 0.25, barW + 0.6, 0.4, 2.1, { col: wood });
  for (const sgn of [-1, 1]) P.add(g, 'box', bx + sgn * (barW / 2 + 0.3), (yb + 0.35 + D - 0.45) / 2, 0.6, D - 0.45 - yb - 0.35 + 0.05, 1.08, { col: wood });
  P.tills = []; P.staffSpots = []; P.seats = []; P.games = [];
  const n = clamp(Math.floor(barW / 2.6), 1, 3);
  for (let k = 0; k < n; k++) { const x = bx - barW / 2 + barW * (k + 0.5) / n; P.tills.push({ x, y: yb - 0.95 }); P.staffSpots.push({ x, y: yb + 0.95, dx: 0, dy: -1, till: k }); }
  // drinkers on the bar stools (barcounter draws them 0.45 m in front, 0.8 m apart)
  for (let u = -barW / 2 + 0.4; u < barW / 2; u += 0.8) if (!P.tills.some(t => Math.abs(t.x - (bx + u)) < 0.6)) P.seats.push({ x: bx + u, y: yb - 0.8, dx: 0, dy: 1, stool: true });
  // the front of the room, clear of the door and the queue at the bar
  const front = yb - 1.7, used = [];
  const free = (x0, y0, x1, y1) => x0 >= 0.15 && x1 <= W - 0.15 && y0 >= 0.15 && y1 <= front && Math.abs((x0 + x1) / 2 - P.site.doorX) > (x1 - x0) / 2 + 0.9 - 0.01 * 0 && !used.some(u => x0 < u[2] && x1 > u[0] && y0 < u[3] && y1 > u[1]);
  const take = (a) => used.push(a);
  take([P.site.doorX - 1.0, 0, P.site.doorX + 1.0, 1.6]);
  // a pool table (2.0 x 1.1) with room to play round it, on the side away from the door
  const tl = 2.0, tw = 1.1, mx = 1.15, my = 1.0;
  const left = P.site.doorX > W / 2;
  for (const cx of left ? [mx + tl / 2 + 0.1, W - mx - tl / 2 - 0.1, W / 2] : [W - mx - tl / 2 - 0.1, mx + tl / 2 + 0.1, W / 2]) {
    const cy = clamp(front / 2 + 0.2, my + tw / 2, front - my - tw / 2);
    const a = [cx - tl / 2 - mx, cy - tw / 2 - my, cx + tl / 2 + mx, cy + tw / 2 + my];
    if (a[0] < 0 || a[2] > W || a[1] < 0 || a[3] > front + 0.3 || used.some(u => a[0] < u[2] && a[2] > u[0] && a[1] < u[3] && a[3] > u[1])) continue;
    P.add(g, 'pooltable', cx, cy, tl, tw, 0.8, { col: wood });
    P.add(g, 'poollight', cx, cy, 1.6, 0.4, 0.25, { base: ceil - 0.85, solid: false });
    P.add(g, 'cuerack', 0, 0, 0, 0, 0, { skip: true, solid: false });
    take(a); P.games.push({ type: 'pool', x: cx, y: cy - tw / 2 - 0.55, look: [cx, cy] });
    break;
  }
  // the dartboard on a side wall, the oche 2.37 m out from it
  for (const side of left ? ['x0', 'x1'] : ['x1', 'x0']) {
    const wx = side === 'x0' ? 0 : W, dir = side === 'x0' ? 1 : -1;
    for (const cy of [front * 0.5, front * 0.3, front * 0.7]) {
      const a = side === 'x0' ? [0, cy - 0.7, 3.1, cy + 0.7] : [W - 3.1, cy - 0.7, W, cy + 0.7];
      if (cy < 1 || used.some(u => a[0] < u[2] && a[2] > u[0] && a[1] < u[3] && a[3] > u[1]) || Math.abs(cy - 0) < 0.5) continue;
      P.add(g, 'dartboard', wx + dir * 0.06, cy, 0.62, 0.1, 0.62, { base: 1.42, solid: false, rot: dir > 0 ? -Math.PI / 2 : Math.PI / 2 });
      P.add(g, 'oche', wx + dir * 2.37, cy, 0.6, 0.05, 0.01, { solid: false, rot: dir > 0 ? -Math.PI / 2 : Math.PI / 2 });
      take(a); P.games.push({ type: 'darts', x: wx + dir * 2.6, y: cy, look: [wx, cy] });
      break;
    }
    if (P.games.some(q => q.type === 'darts')) break;
  }
  // the fruit machine against the front wall, else a side wall
  for (const [x, y, rot] of [[left ? 0.5 : W - 0.5, 0.45, 0], [0.45, front - 0.6, -Math.PI / 2], [W - 0.45, front - 0.6, Math.PI / 2], [left ? W - 0.5 : 0.5, 0.45, 0]]) {
    const a = [x - 0.5, y - 0.5, x + 0.5, y + 0.5];
    if (used.some(u => a[0] < u[2] && a[2] > u[0] && a[1] < u[3] && a[3] > u[1]) || a[0] < 0 || a[2] > W) continue;
    P.add(g, 'fruitmachine', x, y, 0.7, 0.6, 1.85, { rot });
    take([x - 0.8, y - 0.8, x + 0.8, y + 0.8]);
    const dx = -Math.sin(rot), dy = Math.cos(rot);
    P.games.push({ type: 'fruit', x: x + dx * 0.9, y: y + dy * 0.9, look: [x, y] });
    break;
  }
  // a fireplace on a side wall if there's room, a banquette, tables and chairs in what's left
  wallItem(P, g, r, R() < 0.5 ? 'x0' : 'x1', 'fireplace', 1.5, 0.45, 1.2, { at: 0.85 });
  let k = 0;
  for (let y = 1.2; y + 0.9 < front; y += 2.2) for (let x = 1.2; x < W - 1.0; x += 2.4) {
    const round = (k++ + Math.floor(y)) % 2 === 0, hw = round ? 0.95 : 1.15, hd = round ? 0.95 : 1.0;
    if (!free(x - hw, y - hd, x + hw, y + hd)) continue;
    take([x - hw, y - hd, x + hw, y + hd]);
    P.add(g, round ? 'pubtable' : 'table', x, y, round ? 0.75 : 0.9, 0.75, 0.74, { col: wood, chairs: round ? 2 : 4, chairCol: pick(R, [0x4a2f1c, 0x6b2f35, 0x2f4a3a]) });
    if (round) { P.seats.push({ x, y: y - 0.62, dx: 0, dy: 1 }, { x, y: y + 0.62, dx: 0, dy: -1 }); }
    else for (const u of [-0.225, 0.225]) P.seats.push({ x: x + u, y: y - 0.69, dx: 0, dy: 1 }, { x: x + u, y: y + 0.69, dx: 0, dy: -1 });
  }
  // dark beams across the ceiling, pictures and brass on the walls
  for (let x = 1.2; x < W - 0.5; x += 1.7) P.add(g, 'beam', x, D / 2, 0.22, D, 0.2, { base: ceil - 0.2, solid: false, col: 0x3a2616 });
  g.camTop = ceil - 0.2 - 0.3;   // the camera stays clear below the beams (it used to ride up among them)
  for (const side of ['y0', 'x0', 'x1']) for (let q = 0; q < 2; q++) wallItem(P, g, r, side, 'picture', 0.55 + R() * 0.3, 0.04, 0.45 + R() * 0.2, { base: 1.5, solid: false, tall: true, seed: Math.floor(R() * 16), at: 0.2 + q * 0.55, col: 0xc9b26a });
}

// ------------------------------------------------------------------ a church
function church(P, s) {
  const R = P.R, { W, D } = P;
  const fh = Math.max(P.fh, 6);
  P.site.doorX = W / 2; P.exit.x = W / 2; P.frontW = 0.8; P.frontTop = 2.6;
  const g = P.level(fh);
  P.room(g, 'nave', 0, 0, W, D, { floor: ['tile', 0xc9c2b4], wall: ['plaster', PAINT.cream], windows: 'many', sill: 1.8, head: Math.min(fh - 0.8, 5.5), winW: 1.0, ceil: 0xe9e0cc, kind: 'church', stained: true });
  P.style = { church: true };
  P.finish();
  // pews either side of the aisle, the altar on a step at the far end, a lectern, the font by the door
  P.add(g, 'dais', W / 2, D - 1.6, W - 0.4, 3.2, 0.3, { col: 0x8a6a4a, solid: false, platform: 0.3 });
  P.add(g, 'altar', W / 2, D - 1.0, 2.0, 0.8, 1.0, { col: 0xf2efe6, col2: 0x7d1f2a });
  P.add(g, 'lectern', W / 2 - 2.0, D - 3.6, 0.6, 0.5, 1.2, { col: 0x8a6a4a });
  P.add(g, 'font', W / 2 + 1.8, 2.2, 0.8, 0.8, 1.0, { col: 0xb9b2a4 });
  const aisle = 1.6, pw = (W - aisle) / 2 - 0.9;
  for (let y = 3.5; y < D - 4.2; y += 1.0) for (const sgn of [-1, 1]) P.add(g, 'pew', W / 2 + sgn * (aisle / 2 + pw / 2), y, pw, 0.55, 0.95, { col: 0x7a5232 });
  P.add(g, 'runner', W / 2, (D - 3.2) / 2, aisle - 0.3, D - 3.4, 0.01, { col: 0x7d1f2a, solid: false });
}

// ------------------------------------------------------------------ The Oracle: a long concourse with shops both sides
const MALL_SHOPS = ['Fashion House', 'Step Shoes', 'TechZone', 'Bean & Leaf', 'Bookends', 'Toy Town', 'Glow Beauty', 'Sports Hub', 'Gold & Co', 'Phone Point',
  'Card Corner', 'Burger Bar', 'Little Ones', 'Home Store', 'Specs', 'Denim Co', 'Sweet Spot', 'Game Zone', 'Outdoor Gear', 'Watch World'];
function mall(P, s) {
  const R = P.R, { W, D } = P;
  const fh = Math.max(P.fh, 8);
  P.site.doorX = W / 2; P.exit.x = W / 2; P.frontW = 2.2; P.frontTop = 3.2;
  const g = P.level(fh);
  const cy0 = D / 2 - 7, cy1 = D / 2 + 7, uw = 9;
  // the concourse runs from the entrance (front middle) along x; units both sides of it, a front strip either side
  const yA = Math.max(6, cy0), yB = Math.min(D - 6, cy1);
  P.room(g, 'concourse', 0, yA, W, yB, { floor: ['marble', 0xf4f1ea], wall: ['plaster', 0xeeeeea], windows: 0, ceil: 0xf6f6f2, kind: 'mall' });
  P.room(g, 'entrance', W / 2 - 6, 0, W / 2 + 6, yA, { group: 'concourse', floor: ['marble', 0xf4f1ea], wall: ['plaster', 0xeeeeea], windows: 'many', sill: 0.2, head: 3.4, kind: 'mall' });
  const units = [];
  const n = Math.floor((W - 12) / 2 / uw);
  let k = 0;
  for (const sideY of ['front', 'back']) {
    const y0 = sideY === 'front' ? 0 : yB, y1 = sideY === 'front' ? yA : D;
    // the front strip either side of the entrance, the back strip whole
    const spans = sideY === 'front' ? [[0, W / 2 - 6], [W / 2 + 6, W]] : [[0, W]];
    for (const [a, b] of spans) {
      const m = Math.max(1, Math.round((b - a) / uw));
      for (let i = 0; i < m; i++) {
        const x0 = a + (b - a) * i / m, x1 = a + (b - a) * (i + 1) / m, name = MALL_SHOPS[k++ % MALL_SHOPS.length];
        const r = P.room(g, 'unit' + k, x0, y0, x1, y1, { floor: ['tile', pick(R, [0xe9e4da, 0xd8d2c8, 0xc9c2b4, 0xf2efe9])], wall: ['plaster', pick(R, [0xffffff, 0xf2efe9, 0xe8eef2, 0xf4ece4])], windows: 0, ceil: 0xf6f6f2, kind: 'unit', shopName: name, brand: pick(R, [0x2f6fb0, 0xd84a3a, 0x3a8a6a, 0x7d3c98, 0x222222, 0xe67e22, 0xc0392b, 0x16a085]) });
        units.push(r);
        P.door(g, 'concourse', r.name, { w: Math.min(4.5, (x1 - x0) * 0.55), top: 3.0, kind: 'shopfront', leaf: 'none' });
      }
    }
    void n;
  }
  P.style = { mall: true, units };
  P.finish();
  // the shopfronts: glass either side of the doorways
  for (const s of g.walls) for (const o of s.open) if (o.kind === 'shopfront') o.glass = true;
  // benches and planters down the middle, a kiosk or two, the upper gallery and an escalator (to look at)
  for (let x = 8; x < W - 8; x += 11) {
    P.add(g, 'planter', x, D / 2, 2.2, 2.2, 0.7, { col: 0x9a9a98 });
    P.add(g, 'bench', x + 3.2, D / 2 - 1.2, 2.0, 0.6, 0.45, { col: 0x8a6a4a });
    P.add(g, 'bench', x + 3.2, D / 2 + 1.2, 2.0, 0.6, 0.45, { col: 0x8a6a4a, rot: Math.PI });
  }
  P.add(g, 'kiosk', W * 0.3, D / 2 - 3.6, 2.4, 1.6, 2.4, { col: 0x3a8a6a });
  P.add(g, 'escalator', W * 0.62, D / 2, 9, 1.4, 4.5, { col: 0xc9cdd2, rot: 0 });
  P.add(g, 'gallery', W / 2, D / 2, W, 14, 4.5, { solid: false, y0: yA, y1: yB });
  // a few things in each unit
  for (const u of units) {
    const [cx, cy] = mid(u);
    for (let q = 0; q < 3; q++) P.add(g, 'display', u.x0 + (u.x1 - u.x0) * (q + 1) / 4, cy + (u.y0 < 1 ? -0.8 : 0.8), 1.2, 0.8, 0.9, { col: u.brand, seed: q, rot: 0 });
    void cx;
  }
}

// ------------------------------------------------------------------ a fast-food place: dining room, counter with
// tills and menu boards over it, staff behind, the kitchen along the back wall
function food(P, s) {
  const R = P.R, { W, D } = P, cat = s.food || 'burger', st = STYLE[cat] || STYLE.burger;
  const ceil = Math.max(2.7, Math.min(P.fh - 0.15, 3.3));
  P.site.doorX = clamp(s.doorX, 1.3, W - 1.3); P.exit.x = P.site.doorX; P.frontW = 0.9; P.frontTop = 2.2;
  const g = P.level(ceil);
  P.room(g, 'restaurant', 0, 0, W, D, { floor: ['tile', st.floor], wall: ['plaster', st.wall], windows: 'many', sill: 0.4, head: Math.min(2.4, ceil - 0.3), ceil: 0xf2f2ee, kind: 'food', winW: 1.6 });
  P.style = { food: cat, st };
  P.finish();
  const r = P.find(g, 'restaurant');
  // the counter right across the room (staff only behind it), tills along it
  const back = clamp(D * 0.36, 3.2, 5.2), yc = D - back;
  P.add(g, 'foodcounter', W / 2, yc + 0.35, W, 0.7, 1.05, { col: st.accent, top: 0xd8d6d0, cat });
  const n = clamp(Math.floor((W - 1) / 2.3), 1, 4);
  P.tills = []; P.staffSpots = []; P.seats = [];
  for (let k = 0; k < n; k++) {
    const x = W * (k + 0.5) / n;
    P.add(g, 'till', x, yc + 0.45, 0.42, 0.36, 0.32, { base: 1.05, solid: false, rot: Math.PI });
    P.tills.push({ x, y: yc - 0.55 }); P.staffSpots.push({ x, y: yc + 1.05, dx: 0, dy: -1, till: k });
  }
  // menu boards hung over the back of the counter, facing the customers
  const nb = clamp(Math.round(W / 3.2), 1, 4), bw = Math.min(2.6, (W - 0.6) / nb - 0.2), bh = Math.min(0.9, ceil - 2.15);
  for (let k = 0; k < nb; k++) P.add(g, 'menuboard', W * (k + 0.5) / nb, yc + 0.9, bw, 0.06, bh, { rot: Math.PI, base: ceil - bh - 0.12, solid: false, cat, panel: k, panels: nb });
  // the kitchen along the back wall, by the kind of place
  const K = { burger: ['grill', 'fryer', 'fryer', 'warmer', 'drinks'], chicken: ['fryer', 'fryer', 'fryer', 'warmer', 'drinks'], piri: ['grill', 'grill', 'steel', 'drinks'],
    sub: ['breadoven', 'steel', 'fridge2', 'drinks'], bakery: ['breadoven', 'breadoven', 'breadrack', 'coffee'], chippy: ['fryrange', 'steel', 'fridge2'],
    kebab: ['doner', 'doner', 'grill', 'fryer', 'steel'], pizza: ['pizzaoven', 'steel', 'fridge2', 'steel'], mex: ['grill', 'steel', 'warmer', 'drinks'] }[cat] || ['steel'];
  const KW = { grill: 1.3, fryer: 0.8, warmer: 1.2, drinks: 1.0, steel: 1.4, breadoven: 1.0, fridge2: 0.9, breadrack: 0.9, coffee: 0.9, fryrange: 2.8, doner: 0.7, pizzaoven: 1.6 };
  let at = 0.06;
  for (const t of K) { const it = wallItem(P, g, r, 'y1', t, KW[t] || 1, t === 'pizzaoven' ? 1.3 : 0.75, t === 'drinks' || t === 'fridge2' || t === 'breadrack' ? 1.9 : 0.95, { at, cat, tall: t === 'drinks' || t === 'fridge2' || t === 'breadrack' }); if (it) P.staffSpots.push({ x: it.x, y: it.y - 0.95, dx: 0, dy: 1, kitchen: true }); at = Math.min(0.94, at + 0.22); }
  // on the counter: a glass case of bakes, or a sub line
  if (cat === 'bakery' || cat === 'sub' || cat === 'chippy') P.add(g, cat === 'sub' ? 'subline' : 'pastrycase', W / 2 + (n > 1 ? W / (2 * n) : 0) * 0, yc + 0.35, Math.min(W * 0.4, 2.4), 0.6, 0.45, { base: 1.05, solid: false, cat });
  // the dining room: booths along the side walls, tables in the middle, a window bar, condiments and a bin
  const qy = yc - 1.7;                               // keep the queue clear in front of the counter
  const aisle = (x, w) => Math.abs(x - P.site.doorX) < 0.95 + w / 2;
  const seat = (x, y, hx, hy) => P.seats.push({ x, y, dx: hx, dy: hy });
  if (W >= 6.4) for (const side of [0, 1]) {
    const bx = side ? W - 0.62 : 0.62;
    for (let y = 1.4; y + 1.6 < qy; y += 2.0) {
      if (aisle(bx, 1.2)) continue;
      P.add(g, 'banquette', bx, y, 1.2, 0.55, 0.95, { col: st.seat, rot: 0 });
      P.add(g, 'table', bx, y + 0.8, 1.0, 0.7, 0.74, { col: 0xd8c29a, chairs: 0 });
      P.add(g, 'banquette', bx, y + 1.6, 1.2, 0.55, 0.95, { col: st.seat, rot: Math.PI });
      seat(bx - 0.28, y + 0.05, 0, 1); seat(bx + 0.28, y + 0.05, 0, 1); seat(bx - 0.28, y + 1.55, 0, -1); seat(bx + 0.28, y + 1.55, 0, -1);
    }
  }
  const mx0 = W >= 6.4 ? 1.9 : 0.9, mx1 = W >= 6.4 ? W - 1.9 : W - 0.9;
  for (let y = 1.7; y + 0.9 < qy; y += 2.0) for (let x = mx0 + 0.55; x + 0.55 < mx1 + 0.01; x += 1.9) {
    if (aisle(x, 1.6)) continue;
    const four = R() < 0.55, w = four ? 1.0 : 0.75;
    P.add(g, 'table', x, y, w, 0.75, 0.74, { col: pick(R, [0xd8c29a, 0xe9e4da, 0x3b3b3b]), chairs: four ? 4 : 2, chairCol: st.seat });
    if (four) for (const u of [-w / 4, w / 4]) { seat(x + u, y - 0.69, 0, 1); seat(x + u, y + 0.69, 0, -1); }
    else { seat(x, y - 0.69, 0, 1); seat(x, y + 0.69, 0, -1); }
  }
  // the window bar either side of the door, with stools
  for (const [a, b] of [[0.3, P.site.doorX - 1.1], [P.site.doorX + 1.1, W - 0.3]]) if (b - a > 1.4) {
    P.add(g, 'windowbar', (a + b) / 2, 0.32, b - a, 0.4, 1.05, { col: 0xd8c29a });
    for (let x = a + 0.4; x < b - 0.2; x += 0.7) { P.add(g, 'stool', x, 0.85, 0.36, 0.36, 0.75, { col: st.seat }); seat(x, 0.85, 0, -1); }
  }
  wallItem(P, g, r, P.site.doorX < W / 2 ? 'x1' : 'x0', 'binunit', 0.9, 0.55, 1.15, { col: st.accent, at: 0.15 });
  // framed pictures along the side walls, a feature panel in the house colour, plants by the door
  for (const side of ['x0', 'x1']) for (let k = 0; k < Math.max(1, Math.floor(qy / 3)); k++) wallItem(P, g, r, side, 'picture', 0.9, 0.04, 0.65, { base: 1.5, solid: false, tall: true, seed: (s.seed + k * 7 + (side === 'x1' ? 3 : 0)) % 16, at: (k + 0.5) / Math.max(1, Math.floor(qy / 3)) * (qy / D), col: 0x2a2a2a });
  r.feature = st.accent;
  if (W >= 7) for (const sgn of [-1, 1]) { const x = P.site.doorX + sgn * 1.25; if (x > 0.5 && x < W - 0.5) P.add(g, 'plant', x, 0.55, 0.45, 0.45, 1.2, {}); }
  wallItem(P, g, r, P.site.doorX < W / 2 ? 'x1' : 'x0', 'condiments', 1.0, 0.5, 1.0, { col: 0xd8d6d0, at: 0.55 });
  if (cat === 'burger' && W >= 8) for (const sgn of [-1, 1]) P.add(g, 'orderkiosk', P.site.doorX + sgn * 1.7, 2.4, 0.55, 0.35, 1.75, { rot: Math.PI });
  if (cat === 'chippy' || cat === 'kebab') wallItem(P, g, r, P.site.doorX < W / 2 ? 'x1' : 'x0', 'fridge2', 0.9, 0.7, 1.9, { tall: true, at: 0.9, cat });
}

const LAYOUT = { food, trap: house, nice: house, terrace: house, semi: house, detached: house, cottage: house, bungalow, warehouse, office, shop, pub, church, mall };
export function makePlan(site) {
  const P = new Plan({ ...site });
  (LAYOUT[site.kind] || house)(P, P.site);
  P.finish(); P.collisions();
  return P;
}

// Shop fascia text rendered into a shared canvas atlas (one texture, one material).
import * as THREE from 'three/webgpu';
import { Fn, texture, uv, vec3, float, positionWorld, mix } from 'three/tsl';
import { U } from './env.js';

const W = 2048, H = 2048, SW = 256, SH = 32, COLS = W / SW, ROWS = H / SH;
const CAT = { 1: ['#16324f', '#f3efe6'], 2: ['#2b1d14', '#e9c98a'], 3: ['#5a1f1f', '#fbefe0'], 4: ['#1f3b2c', '#f1f1ea'] };

export class SignAtlas {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.free_ = Array.from({ length: COLS * ROWS }, (_, i) => i);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
    const c = texture(this.tex, uv()).rgb;
    m.colorNode = c;
    m.emissiveNode = c.mul(U.night).mul(0.9);
    this.material = m;
    this.dirty = false;
  }
  alloc(text, cat) {
    const slot = this.free_.shift(); if (slot == null) return null;
    const cx = (slot % COLS) * SW, cy = Math.floor(slot / COLS) * SH, p = this.ctx;
    const [bg, fg] = CAT[cat] || CAT[4];
    p.fillStyle = bg; p.fillRect(cx, cy, SW, SH);
    p.fillStyle = fg; p.textAlign = 'center'; p.textBaseline = 'middle';
    let size = 22; p.font = `600 ${size}px system-ui, sans-serif`;
    while (p.measureText(text).width > SW - 12 && size > 10) { size--; p.font = `600 ${size}px system-ui, sans-serif`; }
    p.fillText(text, cx + SW / 2, cy + SH / 2 + 1);
    this.dirty = true;
    // canvas y down; texture flipY true -> v = 1 - y/H
    return { slot, uv: [cx / W, 1 - (cy + SH) / H, (cx + SW) / W, 1 - cy / H] };
  }
  free(slot) { this.free_.push(slot); }
  flush() { if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; } }
}

// Shop fascia boards. One shared atlas, one material. The tile worker places each board;
// the painting here is the chain's colours and its real name.
import * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import { U } from './env.js';
import { fasciaBrand } from './brands.js';

const W = 2048, H = 2048, SW = 256, SH = 32, COLS = W / SW, ROWS = H / SH;
const FALLBACK = { bg: '#16324F', fg: '#F4F0E6', weight: 700, track: '0px', serif: false, italic: false, upper: false, bar: null, barColor: '#ffffff', mark: null };

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = k => Math.max(0, Math.min(255, Math.round(((n >> k) & 255) * f)));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
function fontOf(b, size) {
  const style = b.italic ? 'italic' : 'normal';
  const family = b.serif ? 'Georgia, "Times New Roman", serif' : 'Arial, Helvetica, sans-serif';
  return `${style} ${b.weight || 700} ${size}px ${family}`;
}

export class SignAtlas {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.free_ = Array.from({ length: COLS * ROWS }, (_, i) => i);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.38, metalness: 0 });
    const c = texture(this.tex, uv()).rgb;
    m.colorNode = c;
    m.emissiveNode = c.mul(U.night).mul(1.15);
    this.material = m;
    this.dirty = false;
  }
  alloc(text) {
    const slot = this.free_.shift(); if (slot == null || !text) { if (slot != null) this.free_.unshift(slot); return null; }
    const b = fasciaBrand(text, true) || FALLBACK;
    const cx = (slot % COLS) * SW, cy = Math.floor(slot / COLS) * SH, p = this.ctx;
    paintFascia(p, cx, cy, SW, SH, b.label || text, b);
    this.dirty = true;
    return { slot, uv: [cx / W, 1 - (cy + SH) / H, (cx + SW) / W, 1 - cy / H] };
  }
  free(slot) { this.free_.push(slot); }
  flush() { if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; } }
}

function paintFascia(p, x, y, w, h, text, b) {
  p.save();
  p.fillStyle = b.bg; p.fillRect(x, y, w, h);
  if (b.mark === 'aldi') { p.fillStyle = '#FF6200'; p.fillRect(x, y, w * 0.2, h); }
  if (b.mark === 'split') { p.fillStyle = '#0054A6'; p.fillRect(x + w * 0.5, y, w * 0.5, h); }
  const gloss = p.createLinearGradient(0, y, 0, y + h);
  gloss.addColorStop(0, 'rgba(255,255,255,0.28)');
  gloss.addColorStop(0.42, 'rgba(255,255,255,0)');
  gloss.addColorStop(1, 'rgba(0,0,0,0.2)');
  p.fillStyle = gloss; p.fillRect(x, y, w, h);
  if (b.bar) {
    p.fillStyle = b.barColor || '#ffffff';
    const bh = Math.max(3, Math.round(h * 0.14));
    if (b.bar === 'top') p.fillRect(x, y, w, bh); else p.fillRect(x, y + h - bh, w, bh);
  }
  if (b.mark === 'dots') {
    p.fillStyle = '#EE1C2E';
    const n = 7, r = 2.1, yb = y + h - 5;
    for (let i = 0; i < n; i++) { p.beginPath(); p.arc(x + w * (0.32 + 0.36 * i / (n - 1)), yb, r, 0, Math.PI * 2); p.fill(); }
  }
  let label = b.upper ? String(text).toUpperCase() : String(text);
  let left = 8;
  if (b.mark === 'lidl') {
    const cx = x + 18, cy = y + h / 2;
    p.fillStyle = '#FFD200'; p.beginPath(); p.arc(cx, cy, 11, 0, Math.PI * 2); p.fill();
    p.fillStyle = '#E30613'; p.beginPath(); p.arc(cx, cy, 7, 0, Math.PI * 2); p.fill();
    p.fillStyle = '#0050AA'; p.beginPath(); p.arc(cx, cy, 3.5, 0, Math.PI * 2); p.fill();
    left = 32;
  } else if (b.mark === 'clover') {
    clover(p, x + 16, y + h / 2, 7, b.fg);
    left = 30;
  } else if (b.mark === 'aldi') left = Math.round(w * 0.2) + 4;
  p.fillStyle = b.fg;
  p.textAlign = 'center'; p.textBaseline = 'middle';
  const light = parseInt(b.fg.slice(1), 16) > 0x888888;
  p.shadowColor = light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.25)';
  p.shadowBlur = 0; p.shadowOffsetY = 1;
  let size = b.serif ? 18 : 20;
  p.font = fontOf(b, size);
  const maxW = w - left - 10;
  while (p.measureText(label).width > maxW && size > 9) { size--; p.font = fontOf(b, size); }
  p.letterSpacing = b.track || '0px';
  const cx = x + left + (w - left) / 2;
  const cy = y + h / 2 + (b.bar === 'bottom' ? -1 : 0);
  p.fillText(label, cx, cy);
  p.letterSpacing = '0px';
  p.shadowColor = 'transparent';
  p.strokeStyle = shade(b.bg, 0.55); p.lineWidth = 2;
  p.strokeRect(x + 1, y + 1, w - 2, h - 2);
  p.restore();
}
function clover(p, x, y, r, color) {
  p.fillStyle = color;
  for (const [dx, dy] of [[0, -0.72], [0, 0.72], [-0.72, 0], [0.72, 0]]) {
    p.beginPath(); p.arc(x + dx * r, y + dy * r, r * 0.48, 0, Math.PI * 2); p.fill();
  }
}

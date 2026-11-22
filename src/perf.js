// Frame-time / stall / memory recorder. Shown with ?perf or the Dev panel; exportable as JSON
// (downloaded in a browser, written to app storage on Android via the native bridge).
export class Perf {
  constructor(G) { this.G = G; this.frames = []; this.stalls = 0; this.samples = []; this.t0 = performance.now(); this.last = performance.now(); this.acc = 0; }
  frame(dt) {
    const now = performance.now(), ms = now - this.last; this.last = now;
    this.frames.push(ms); if (this.frames.length > 240) this.frames.shift();
    if (ms > 100) this.stalls++;
    this.acc += dt;
    if (this.acc > 2) {
      this.acc = 0;
      const G = this.G, f = [...this.frames].sort((a, b) => a - b);
      const me = G.brothers?.me;
      this.samples.push({ t: +((now - this.t0) / 1000).toFixed(1), fps: +(1000 / avg(this.frames)).toFixed(1), p50: +f[Math.floor(f.length * 0.5)].toFixed(1), p95: +f[Math.floor(f.length * 0.95)].toFixed(1),
        stalls: this.stalls, calls: G.renderer.info.render.calls, tris: G.renderer.info.render.triangles, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        tiles: G.tiles.tiles.size, vehicles: G.traffic?.list.length, peds: G.peds?.list.length, x: me ? Math.round(me.x) : null, z: me ? Math.round(me.z) : null, speed: G.brothers ? +(G.brothers.speedNow || 0).toFixed(1) : null });
      if (this.samples.length > 1800) this.samples.shift();
    }
  }
  text() {
    const s = this.samples[this.samples.length - 1] || {}; const G = this.G;
    return `${G.backend} · ${s.fps ?? '–'} fps · p95 ${s.p95 ?? '–'} ms · stalls ${this.stalls} · calls ${s.calls ?? '–'} · tris ${s.tris ?? '–'} · heap ${s.heapMB ?? 'n/a'} MB · tiles ${s.tiles ?? '–'} · cars ${s.vehicles ?? '–'} · people ${s.peds ?? '–'}`;
  }
  report() { const G = this.G; return { userAgent: navigator.userAgent, backend: G.backend, quality: G.quality, devicePixelRatio: devicePixelRatio, screen: [screen.width, screen.height], cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory ?? null, samples: this.samples, stalls: this.stalls }; }
  export() {
    const json = JSON.stringify(this.report(), null, 1);
    if (window.GCNative && GCNative.savePerf) { const p = GCNative.savePerf(json); this.G.hud.toast('Saved ' + p, 5); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = `green-county-perf-${Date.now()}.json`; a.click();
  }
}
function avg(a) { return a.reduce((x, y) => x + y, 0) / Math.max(1, a.length); }

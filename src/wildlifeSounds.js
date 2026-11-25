// Animal calls, synthesised (the sound bank has no animal recordings): short oscillator and noise patches shaped
// after the real calls (a mallard's descending quacks, a wood pigeon's five-note coo, a tawny owl's hoot, a red
// kite's whistle...), played where the animal is through audio.js oneShot.
const noiseBufs = new WeakMap();
function noiseBuf(A) {
  let b = noiseBufs.get(A);
  if (!b) { b = A.createBuffer(1, A.sampleRate, A.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noiseBufs.set(A, b); }
  return b;
}
// a voiced note: oscillator (pitch path [[t, f], ...]) through an optional band-pass "throat", with an envelope
function note(A, out, t0, dur, type, f0, path, bp, Q, peak, attack = 0.012, trem = 0) {
  const o = A.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0);
  for (const [t, f] of path) o.frequency.linearRampToValueAtTime(f, t0 + t);
  const g = A.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + attack); g.gain.setTargetAtTime(0.0001, t0 + dur * 0.65, dur * 0.15 + 0.01);
  let n = o;
  if (bp) { const fl = A.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = bp; fl.Q.value = Q; o.connect(fl); n = fl; }
  if (trem) {   // amplitude flutter (a sheep's bleat, a moorhen's churr)
    const l = A.createOscillator(), lg = A.createGain(), tg = A.createGain(); l.frequency.value = trem; lg.gain.value = 0.5; tg.gain.value = 0.5;
    l.connect(lg); lg.connect(tg.gain); n.connect(tg); n = tg; l.start(t0); l.stop(t0 + dur + 0.2);
  }
  n.connect(g); g.connect(out);
  o.start(t0); o.stop(t0 + dur + 0.25);
}
function hiss(A, out, t0, dur, bp, Q, peak) {
  const s = A.createBufferSource(); s.buffer = noiseBuf(A);
  const fl = A.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = bp; fl.Q.value = Q;
  const g = A.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.01); g.gain.setTargetAtTime(0.0001, t0 + dur * 0.6, dur * 0.2 + 0.01);
  s.connect(fl); fl.connect(g); g.connect(out); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.2);
}
const R = (a, b) => a + Math.random() * (b - a);

export const SYNTH = {
  bark(A, o, t, size = 1) {   // big dogs low, little dogs yappy
    const f = 430 / Math.max(0.6, size), n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { const s = t + i * R(0.22, 0.34); note(A, o, s, 0.14, 'sawtooth', f, [[0.025, f * 1.35], [0.13, f * 0.75]], f * 2.6, 1.6, 0.55); hiss(A, o, s, 0.08, f * 3, 1.2, 0.12); }
  },
  meow(A, o, t) { const f = R(480, 620); note(A, o, t, R(0.5, 0.8), 'sawtooth', f, [[0.18, f * 1.6], [0.6, f * 1.1]], 1150, 2.4, 0.22, 0.06); },
  moo(A, o, t) { const f = R(105, 130); note(A, o, t, R(1.3, 1.8), 'sawtooth', f, [[0.35, f * 1.3], [1.1, f * 1.15], [1.6, f * 0.8]], 480, 1.3, 0.6, 0.15); },
  baa(A, o, t) { const f = R(280, 360); note(A, o, t, R(0.6, 0.9), 'sawtooth', f, [[0.6, f * 0.92]], 1000, 2, 0.3, 0.04, 22); },
  snort(A, o, t) { hiss(A, o, t, 0.4, 650, 0.8, 0.35); hiss(A, o, t + 0.45, 0.3, 600, 0.8, 0.25); },
  foxbark(A, o, t) {
    if (Math.random() < 0.35) { note(A, o, t, 0.9, 'sawtooth', 1050, [[0.2, 1250], [0.85, 800]], 1400, 1.5, 0.3, 0.03, 45); hiss(A, o, t, 0.8, 1800, 1, 0.08); return; }   // the vixen's scream
    for (let i = 0; i < 3; i++) note(A, o, t + i * 0.32, 0.12, 'sawtooth', 720, [[0.1, 480]], 1300, 3, 0.3);
  },
  muntjac(A, o, t) { note(A, o, t, 0.16, 'sawtooth', 820, [[0.14, 520]], 1500, 2.2, 0.4); },
  roebark(A, o, t) { note(A, o, t, 0.28, 'sawtooth', 420, [[0.25, 300]], 900, 1.4, 0.35); hiss(A, o, t, 0.25, 1000, 1, 0.12); },
  coo(A, o, t) {   // wood pigeon: coo-COO-coo, coo-coo
    const f = R(400, 450); let s = t;
    for (const [d, k] of [[0.32, 0.8], [0.55, 1], [0.3, 0.8], [0.3, 0.75], [0.3, 0.7]]) { note(A, o, s, d, 'sine', f, [[d, f * 0.9]], 0, 0, 0.16 * k, 0.05); s += d + 0.12; }
  },
  pigeon(A, o, t) { note(A, o, t, 0.6, 'sine', 360, [[0.25, 420], [0.55, 330]], 0, 0, 0.12, 0.08, 16); },
  clatter(A, o, t) { for (let i = 0; i < 6; i++) hiss(A, o, t + i * 0.065, 0.04, 1900, 1.4, 0.3); },
  caw(A, o, t) { const n = 2 + Math.floor(Math.random() * 3), f = R(480, 540); for (let i = 0; i < n; i++) { const s = t + i * 0.5; note(A, o, s, 0.32, 'sawtooth', f, [[0.3, f * 0.88]], 1000, 1.5, 0.35, 0.02); hiss(A, o, s, 0.28, 1400, 1, 0.06); } },
  rook(A, o, t) { const f = R(560, 640); note(A, o, t, 0.25, 'sawtooth', f, [[0.22, f * 0.92]], 1150, 1.6, 0.3); hiss(A, o, t, 0.22, 1600, 1, 0.06); },
  chatter(A, o, t) { for (let i = 0; i < 8; i++) { hiss(A, o, t + i * 0.085, 0.05, 2300, 2, 0.22); note(A, o, t + i * 0.085, 0.05, 'square', 1200, [], 2300, 3, 0.05); } },
  chack(A, o, t) { for (let i = 0; i < 2; i++) note(A, o, t + i * 0.18, 0.08, 'square', 950, [[0.07, 800]], 1800, 3, 0.18); },
  robin(A, o, t) {   // thin, high, tumbling notes
    let s = t;
    for (let i = 0, n = 8 + Math.floor(Math.random() * 7); i < n; i++) { const d = R(0.05, 0.16), f = R(3000, 6200); note(A, o, s, d, 'sine', f, [[d, f * R(0.75, 1.3)]], 0, 0, 0.06, 0.008); s += d + R(0.01, 0.09); }
  },
  blackbird(A, o, t) {   // rich fluting phrase, a twitter at the end
    let s = t;
    for (let i = 0, n = 5 + Math.floor(Math.random() * 4); i < n; i++) { const d = R(0.12, 0.3), f = R(1500, 2700); note(A, o, s, d, 'sine', f, [[d * 0.5, f * R(0.9, 1.15)], [d, f * R(0.85, 1.1)]], 0, 0, 0.09, 0.02); s += d + R(0.02, 0.08); }
    for (let i = 0; i < 4; i++) { note(A, o, s, 0.04, 'sine', R(4000, 6000), [], 0, 0, 0.03, 0.005); s += 0.05; }
  },
  tit(A, o, t) { note(A, o, t, 0.1, 'sine', 6200, [[0.1, 5800]], 0, 0, 0.05); note(A, o, t + 0.16, 0.1, 'sine', 6200, [[0.1, 5800]], 0, 0, 0.05); for (let i = 0; i < 6; i++) note(A, o, t + 0.34 + i * 0.06, 0.04, 'sine', 3600, [], 0, 0, 0.04, 0.005); },
  cheep(A, o, t) { for (let i = 0, n = 2 + Math.floor(Math.random() * 3); i < n; i++) note(A, o, t + i * R(0.15, 0.3), 0.07, 'triangle', R(2800, 3400), [[0.06, 2400]], 3000, 2, 0.07, 0.005); },
  starling(A, o, t) { note(A, o, t, 0.5, 'sine', 2000, [[0.2, 4000], [0.45, 1500]], 0, 0, 0.05, 0.02); for (let i = 0; i < 5; i++) hiss(A, o, t + 0.55 + i * 0.05, 0.02, 4000, 3, 0.05); },
  parakeet(A, o, t) { for (let i = 0; i < 3; i++) { const s = t + i * 0.2; note(A, o, s, 0.13, 'sawtooth', 2800, [[0.12, 3300]], 3000, 2.5, 0.12, 0.008); note(A, o, s, 0.13, 'square', 2950, [[0.12, 3100]], 3100, 3, 0.04, 0.008); } },
  pheasant(A, o, t) { for (let i = 0; i < 2; i++) note(A, o, t + i * 0.22, 0.14, 'sawtooth', 1150, [[0.12, 900]], 1300, 2.5, 0.45); for (let i = 0; i < 10; i++) hiss(A, o, t + 0.5 + i * 0.04, 0.03, 900, 1, 0.1); },
  yaffle(A, o, t) { for (let i = 0; i < 10; i++) note(A, o, t + i * 0.11, 0.08, 'sine', 1950 - i * 45, [[0.07, 1850 - i * 45]], 0, 0, 0.14, 0.01); },
  gull(A, o, t) { note(A, o, t, 0.45, 'sawtooth', 1100, [[0.12, 1250], [0.42, 880]], 1500, 2, 0.25, 0.02); hiss(A, o, t, 0.4, 1800, 1.5, 0.06); },
  heron(A, o, t) { note(A, o, t, 0.4, 'sawtooth', 360, [[0.38, 270]], 800, 1.2, 0.45, 0.01); hiss(A, o, t, 0.35, 900, 0.8, 0.2); },
  hoot(A, o, t) {   // the male's hoo ... hu, hu-hoo-oo-oo or the female's ke-wick
    if (Math.random() < 0.4) { note(A, o, t, 0.28, 'sine', 1500, [[0.12, 2300], [0.26, 1800]], 0, 0, 0.18, 0.02); return; }
    note(A, o, t, 0.6, 'sine', 400, [[0.55, 370]], 0, 0, 0.25, 0.08);
    note(A, o, t + 2.1, 0.12, 'sine', 380, [], 0, 0, 0.18, 0.03);
    note(A, o, t + 2.5, 1.0, 'sine', 400, [[0.9, 360]], 0, 0, 0.25, 0.05, 7);
  },
  kite(A, o, t) {   // weee-oo, wee-oo-wee-oo
    let s = t;
    for (const d of [0.55, 0.3, 0.3, 0.3]) { note(A, o, s, d, 'sine', 2500, [[d * 0.6, 2700], [d, 1650]], 0, 0, 0.16, 0.03); s += d + 0.05; }
  },
  mew(A, o, t) { note(A, o, t, 0.95, 'sine', 2400, [[0.15, 2500], [0.9, 1700]], 0, 0, 0.18, 0.04, 9); },
  swift(A, o, t) {   // the screaming party
    for (let i = 0, n = 2 + Math.floor(Math.random() * 3); i < n; i++) { const s = t + i * R(0.15, 0.4), f = R(5200, 6800); note(A, o, s, R(0.3, 0.6), 'sawtooth', f, [[0.3, f * 0.9]], f, 6, 0.05, 0.02, 45); }
  },
  twitter(A, o, t) { for (let i = 0; i < 6; i++) note(A, o, t + i * 0.09, 0.06, 'sine', R(3000, 4500), [[0.05, R(2500, 4000)]], 0, 0, 0.05, 0.005); },
  quack(A, o, t) {   // QUACK quack quack quack, falling away
    const n = 2 + Math.floor(Math.random() * 4), f = R(260, 320);
    for (let i = 0; i < n; i++) { const s = t + i * R(0.22, 0.3), k = 1 - i * 0.16; note(A, o, s, 0.16, 'sawtooth', f, [[0.14, f * 0.82]], 1050, 4, 0.4 * k, 0.012); note(A, o, s, 0.16, 'sawtooth', f, [[0.14, f * 0.82]], 2500, 6, 0.15 * k, 0.012); }
  },
  coot(A, o, t) { note(A, o, t, 0.1, 'square', 900, [[0.09, 760]], 1200, 3, 0.22, 0.005); },
  moorhen(A, o, t) { note(A, o, t, 0.22, 'sawtooth', 700, [[0.2, 640]], 1100, 2, 0.22, 0.01, 30); },
  honk(A, o, t) { for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) { const s = t + i * 0.42; note(A, o, s, 0.28, 'sawtooth', 280, [[0.06, 420], [0.26, 380]], 900, 2.5, 0.4, 0.01); } },
  honk2(A, o, t) { for (let i = 0; i < 3; i++) note(A, o, t + i * 0.3, 0.24, 'sawtooth', 255, [[0.22, 240]], 700, 2, 0.35, 0.02); },
  egyptian(A, o, t) { note(A, o, t, 0.3, 'sawtooth', 620, [[0.28, 520]], 1000, 1.5, 0.25); hiss(A, o, t, 0.3, 1300, 1, 0.15); },
};

// play one call at the animal: audio.js oneShot gives a panner at (x, z) feeding the master bus
export function playCall(audio, c) {
  const fn = SYNTH[c.call]; if (!fn || !audio) return;
  audio.oneShot((A, out) => fn(A, out, A.currentTime + 0.02, c.size), c.x, c.z, c.gain ?? 1);
}

// Parses and validates captured WGSL modules with naga-wasm. Usage: node check.mjs wgsl.json
import { parseWgsl, validate } from 'naga-wasm';
import fs from 'fs';
const codes = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let ok = 0, bad = 0;
const seen = new Map();
codes.forEach((code, i) => {
  try { const m = parseWgsl(code); const info = validate(m); info.free?.(); m.free?.(); ok++; }
  catch (e) {
    bad++;
    const msg = String(e.message || e).split('\n').slice(0, 8).join(' | ').slice(0, 500);
    const key = msg.replace(/\d+/g, '#').slice(0, 120);
    if (!seen.has(key)) { seen.set(key, 1); console.log(`#${i} ${code.includes('@fragment') ? 'frag' : code.includes('@vertex') ? 'vert' : 'comp'}: ${msg}\n`); }
  }
});
console.log('ok', ok, 'failed', bad);

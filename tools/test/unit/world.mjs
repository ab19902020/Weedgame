// Loads the committed world network in Node for unit tests (no browser).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, inflate } from '../../../src/data.js';
import { Network } from '../../../src/network.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let cached = null;
export async function loadNet() {
  if (cached) return cached;
  const raw = fs.readFileSync(path.join(root, 'www/world/network.bin'));
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  let c; try { c = decode(ab); } catch { c = decode(await inflate(ab)); }
  cached = new Network(c);
  return cached;
}
export function manifest() { return JSON.parse(fs.readFileSync(path.join(root, 'www/world/manifest.json'), 'utf8')); }

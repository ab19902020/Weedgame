// GCT1 container decoding shared by the main thread and the tile worker.
// Layout: 'GCT1' | u32 header length | JSON header | 8-byte aligned typed arrays.
const TYPES = { f4: Float32Array, i2: Int16Array, u2: Uint16Array, u1: Uint8Array, i4: Int32Array, u4: Uint32Array, i1: Int8Array };

export async function inflate(buf) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

export function decode(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'GCT1') throw new Error('bad container');
  const hl = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
  const base = 8 + hl;
  const arrays = {};
  for (const [k, [t, off, n]] of Object.entries(header.arrays)) {
    const C = TYPES[t];
    arrays[k] = new C(buf, base + off, n);
  }
  return { header, arrays };
}

export async function fetchContainer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return decode(await inflate(await r.arrayBuffer()));
}

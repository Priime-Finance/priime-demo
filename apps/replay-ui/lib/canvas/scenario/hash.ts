/* ─────────────────────────────────────────────────────────────────────────
 * PORTED VERBATIM (plan WP-2, docs/plans/ROUTER_LANE_PLAN.md, ruling R7).
 *
 *   source repo   ~/Desktop/autoloop-clean/autoloop-frontend
 *   source path   lib/canvas/scenario/hash.ts
 *   source commit eb6d33a96954819b370e93727fc2d7dcd6ba23bc
 *
 * The body below is the live app's file, byte for byte, with this header
 * prepended and NOTHING ELSE CHANGED. Any import that did not resolve in the
 * demo is listed in the WP-2 report rather than silently rewritten here; a
 * ported file that quietly diverges from its source is a second
 * implementation wearing the first one's name.
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * CANONICAL SERIALIZATION AND A SYNCHRONOUS SHA-256.
 *
 * `generateBundle` is a PURE, SYNCHRONOUS function, and the bundle carries the
 * hash its own pins reference, so the hash has to be computable inside it.
 * Neither of this repo's two existing hashers can do that from a module a
 * client may reach: `hl-scan.contentHash` is `node:crypto`, and
 * `serialize.contentHash` is Web Crypto and therefore async. So this is a
 * standalone implementation, and `scenario-engine.test.ts` pins it byte for
 * byte against `node:crypto` over the bundles the engine actually produces.
 *
 * `canonicalJson` is the SAME recursively-key-sorted form `hl-scan` uses, so a
 * scenario hash and a scan hash are computed over the same shape of input.
 */

/** Canonical JSON: recursively sorted keys. The content-hash input. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** sha-256 hex of a UTF-8 string. Synchronous, isomorphic, allocation-light. */
export function sha256Hex(input: string): string {
  const msg = new TextEncoder().encode(input);
  const bitLen = msg.length * 8;
  const blocks = Math.ceil((msg.length + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  // Length is written as a 64-bit big-endian bit count. The high word is the
  // bit count above 2^32, which no bundle reaches; it is written anyway so the
  // implementation is the algorithm and not a special case of it.
  view.setUint32(buf.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(buf.length - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    const off = b * 64;
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b1 = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b1) ^ (a & c) ^ (b1 & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b1;
      b1 = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b1) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("");
}

export function contentHash(v: unknown): string {
  return sha256Hex(canonicalJson(v));
}

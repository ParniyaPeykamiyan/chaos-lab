// Entropy pool: gathers raw motion samples, turns each one into a visible bit,
// and finally mixes everything with crypto.getRandomValues() to make a seed.
//
// Why the result is never weaker than the browser's own randomness:
//   seed = SHA-256(all motion data)  XOR  32 bytes from crypto.getRandomValues()
// XOR-ing anything with independent uniform random bytes gives uniform random
// bytes, so the motion data can only add unpredictability, never remove it.

const MAX_SAMPLES = 60000;

// FNV-1a over the quantised sample values, then a murmur-style finaliser.
function hashSample(values) {
  let h = 0x811c9dc5;
  for (const v of values) {
    const q = Math.round((Number(v) || 0) * 1e6) | 0;
    for (let s = 0; s < 32; s += 8) {
      h ^= (q >>> s) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function parity32(x) {
  x ^= x >>> 16; x ^= x >>> 8; x ^= x >>> 4; x ^= x >>> 2; x ^= x >>> 1;
  return x & 1;
}

// Used only when crypto.subtle is unavailable (non-https pages such as a phone
// hitting Live Server over the LAN). Still XOR-ed with crypto bytes afterwards.
function fallbackDigest(bytes) {
  const out = new Uint8Array(32);
  for (let lane = 0; lane < 8; lane++) {
    let h = (0x9e3779b9 * (lane + 1)) >>> 0;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
      h ^= h >>> 15;
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    out[lane * 4] = h & 0xff; out[lane * 4 + 1] = (h >>> 8) & 0xff;
    out[lane * 4 + 2] = (h >>> 16) & 0xff; out[lane * 4 + 3] = h >>> 24;
  }
  return out;
}

// Turns seed bytes into unbiased choices.
export class SeedStream {
  constructor(bytes) { this.bytes = bytes; this.pos = 0; }
  nextUint32() {
    if (this.pos + 4 > this.bytes.length) {
      // out of seed: stretch with fresh system randomness
      const more = crypto.getRandomValues(new Uint8Array(32));
      for (let i = 0; i < 32; i++) more[i] ^= this.bytes[i % this.bytes.length];
      this.bytes = more; this.pos = 0;
    }
    const b = this.bytes, p = this.pos;
    this.pos += 4;
    return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  }
  // Uniform integer in [0, n) using rejection sampling (no modulo bias).
  pickIndex(n) {
    if (n <= 1) return 0;
    const limit = Math.floor(0x100000000 / n) * n;
    for (;;) {
      const r = this.nextUint32();
      if (r < limit) return r % n;
    }
  }
}

export class EntropyPool {
  constructor() { this.reset(); }

  reset() {
    this.samples = [];
    this.bitLog = [];
  }

  // Record raw sensor numbers. Returns one bit derived from them.
  addSample(values) {
    const withClock = [...values, performance.now()];
    if (this.samples.length < MAX_SAMPLES) this.samples.push(...withClock);
    return parity32(hashSample(withClock));
  }

  logBit(bit) { this.bitLog.push(bit); }

  async seal() {
    const raw = new Float64Array(this.samples.length + this.bitLog.length + 1);
    raw.set(this.samples, 0);
    raw.set(this.bitLog, this.samples.length);
    raw[raw.length - 1] = performance.now();

    let digest;
    try {
      digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw.buffer));
    } catch {
      digest = fallbackDigest(new Uint8Array(raw.buffer));
    }
    const system = crypto.getRandomValues(new Uint8Array(32));
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = digest[i] ^ system[i];
    return new SeedStream(seed);
  }
}

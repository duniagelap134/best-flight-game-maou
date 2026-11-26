// Seeded randomness for Ember Isle: every number the world is built from comes
// from one fixed seed, so the island, the course and the clouds are identical on
// every run and every machine. Nothing in this file touches Math.random or the clock.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A small deterministic 2D value-noise field: smooth hills that tile well enough
// for one island, built from a seeded lattice and cosine interpolation.
export function makeNoise2D(seed) {
  const rand = mulberry32(seed);
  const SIZE = 256;
  const lattice = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  function latticeAt(ix, iz) {
    const x = ((ix % SIZE) + SIZE) % SIZE;
    const z = ((iz % SIZE) + SIZE) % SIZE;
    return lattice[z * SIZE + x];
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  return function noise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = smooth(x - ix), fz = smooth(z - iz);
    const a = latticeAt(ix, iz), b = latticeAt(ix + 1, iz);
    const c = latticeAt(ix, iz + 1), d = latticeAt(ix + 1, iz + 1);
    const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
    return ab + (cd - ab) * fz; // 0..1
  };
}

// Fractal brownian motion: a few octaves of the base noise, normalised to 0..1.
export function makeFbm(seed, octaves) {
  const noise = makeNoise2D(seed);
  return function fbm(x, z) {
    let sum = 0, amp = 0.5, total = 0, freq = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, z * freq);
      total += amp;
      amp *= 0.5; freq *= 2.03;
    }
    return sum / total;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function degToRad(d) { return d * Math.PI / 180; }
export function radToDeg(r) { return r * 180 / Math.PI; }

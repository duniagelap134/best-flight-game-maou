// Ember Isle — seeded random numbers.
// A tiny deterministic generator so the island, clouds and trees look the
// same on every run, and so physics never depends on Math.random.
export function makeRng(seed) {
  let state = (seed >>> 0) || 1;
  return function next() {
    // Mulberry32: small, fast, and good enough for scenery.
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng, low, high) {
  return low + rng() * (high - low);
}

export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

// Deterministic pseudo-noise in one dimension: a smooth wobble built from
// sines, used for gusts and drifting scenery. Pure function of time.
export function wobble(t, period, phase) {
  return Math.sin((t / period) * Math.PI * 2 + phase);
}

// The island of Ember Isle: one volcanic island in a golden-hour sea, with a
// coastal valley, a mountain ridge, a beach ring and a lit runway on the flat
// southern shore. All heights come from the seeded noise in rng.js, so the
// island never changes between runs.

import { makeFbm, mulberry32, clamp, lerp } from './rng.js';

export const WORLD = {
  seed: 20261126,
  // Island radius in metres; beyond it the sea runs flat to the horizon.
  islandRadius: 5200,
  // Sea level is height 0; terrain below it is water.
  seaLevel: 0,
  // The volcano peak height and the valley floor the course follows.
  peakHeight: 640,
  valleyFloor: 55,
};

// Two noise fields: broad island shape and fine hill detail.
const islandNoise = makeFbm(WORLD.seed, 4);
const detailNoise = makeFbm(WORLD.seed + 101, 3);
const peakRand = mulberry32(WORLD.seed + 7);

// The volcano sits north-west of centre; the runway sits on the flat south shore.
export const VOLCANO = { x: -1150, z: -1450, radius: 1500 };
export const RUNWAY = {
  // Centre of the strip (runways 18/36). Takeoff is northbound on 36; the ring
  // run comes back down the valley and lands southbound on 18.
  x: 350, z: 2350,
  heading: 0, // radians, 0 = north (-z)
  length: 900, width: 46,
  // Touchdown zone: the first third of the strip, where a good landing counts.
  touchdownZ: 2350 - 180,
};

// Height of the ground at world (x, z), in metres. Sea level is 0.
export function groundHeight(x, z) {
  const dx = x, dz = z;
  const dist = Math.hypot(dx, dz);
  // Falloff: the island sinks into the sea past its radius.
  const coast = clamp((WORLD.islandRadius - dist) / 900, 0, 1);
  const coastSmooth = coast * coast * (3 - 2 * coast);
  if (coastSmooth <= 0) return -30; // open sea
  // Broad rolling hills over the whole island.
  let h = islandNoise(x * 0.00045 + 40, z * 0.00045 + 40) * 260;
  // Fine detail for ridges and gullies.
  h += (detailNoise(x * 0.0021 + 9, z * 0.0021 + 9) - 0.5) * 90;
  // The volcano cone rises in the north-west.
  const vd = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  const cone = Math.max(0, 1 - vd / VOLCANO.radius);
  h += cone * cone * WORLD.peakHeight;
  // A gentle valley runs south from the volcano to the runway: carve it down so
  // the ring course has a readable low path through the hills.
  const valley = valleyDepth(x, z);
  h = lerp(h, WORLD.valleyFloor + detailNoise(x * 0.004, z * 0.004) * 24, valley);
  // The runway apron is flattened to the valley floor.
  const apron = apronWeight(x, z);
  h = lerp(h, WORLD.valleyFloor, apron);
  // Beach: anything near sea level flattens out to sand.
  if (h < 14 && coastSmooth > 0.15) h = lerp(h, 6, clamp((14 - h) / 14, 0, 1) * 0.7);
  return (h - 40) * coastSmooth + 8 * coastSmooth - 30 * (1 - coastSmooth);
}

// How strongly the valley carve applies at (x, z): 1 on the valley centreline.
export function valleyDepth(x, z) {
  // Centreline wanders from the volcano's south slope down to the runway.
  const t = clamp((z + 1400) / 3600, 0, 1);
  const centreX = lerp(-900, RUNWAY.x, t) + Math.sin(t * 9.1) * 260;
  const d = Math.abs(x - centreX);
  const w = clamp(1 - d / 520, 0, 1);
  return w * w * (0.55 + 0.45 * Math.sin(t * Math.PI));
}

function apronWeight(x, z) {
  const dx = Math.abs(x - RUNWAY.x);
  const dz = Math.abs(z - RUNWAY.z);
  const wx = clamp(1 - (dx - RUNWAY.width / 2 - 60) / 160, 0, 1);
  const wz = clamp(1 - (dz - RUNWAY.length / 2 - 60) / 160, 0, 1);
  return clamp(wx * wz, 0, 1);
}

// Colour of the ground at a point, by height and slope, as [r, g, b].
// Golden hour: warm grass, dark pine, pale rock, snow on the peak, sand at shore.
export function groundColor(x, z, h) {
  const n = detailNoise(x * 0.006 + 3, z * 0.006 + 3);
  const jitter = (n - 0.5) * 10;
  if (h < 2) return [196 + jitter, 168 + jitter, 118 + jitter]; // wet sand
  if (h < 12) return [214 + jitter, 188 + jitter, 132 + jitter]; // dry sand
  if (h > 470) return [238 + jitter, 232 + jitter, 226 + jitter]; // snow cap
  if (h > 300) return [122 + jitter * 0.6, 104 + jitter * 0.6, 92 + jitter * 0.6]; // rock
  if (h > 150) return [52 + jitter * 0.5, 84 + jitter * 0.5, 44 + jitter * 0.5]; // pine forest
  return [104 + jitter, 138 + jitter, 62 + jitter]; // warm valley grass
}

export function waterColor(depth) {
  const t = clamp(-depth / 60, 0, 1);
  return [lerp(64, 18, t), lerp(122, 58, t), lerp(148, 108, t)];
}

// The ring course: eight gold rings threading the valley from the north ridge
// down to the runway, then the runway itself. Each ring knows its centre, its
// radius and the heading that threads it cleanly.
export const RINGS = buildCourse();

function buildCourse() {
  const rand = mulberry32(WORLD.seed + 31);
  const stops = [
    { x: -820, z: -900, y: 300, r: 42 },
    { x: -560, z: -250, y: 235, r: 40 },
    { x: -180, z: 320, y: 185, r: 38 },
    { x: 240, z: 780, y: 165, r: 38 },
    { x: -120, z: 1180, y: 150, r: 36 },
    { x: 420, z: 1480, y: 140, r: 36 },
    { x: 180, z: 1830, y: 125, r: 34 },
    // The last ring hangs over the runway itself: thread it, then put her
    // down on the strip still ahead of you.
    { x: 350, z: 2300, y: 85, r: 34 },
  ];
  return stops.map((s, i) => {
    const ground = groundHeight(s.x, s.z);
    return {
      index: i,
      x: s.x + (rand() - 0.5) * 24,
      z: s.z + (rand() - 0.5) * 24,
      y: Math.max(s.y, ground + 55),
      radius: s.r,
      passed: false,
    };
  });
}

// Distance from a point to the runway centreline, and whether it is over the strip.
export function runwayFrame(px, pz) {
  const dx = px - RUNWAY.x, dz = pz - RUNWAY.z;
  const along = -dz; // north is -z; positive along = past the threshold
  const across = dx;
  const overStrip = Math.abs(across) <= RUNWAY.width / 2 + 30
    && along >= -RUNWAY.length / 2 - 120 && along <= RUNWAY.length / 2 + 120;
  return { along, across, overStrip };
}

// Clouds: seeded puffs floating over the island, drawn as soft ellipses.
export const CLOUDS = (() => {
  const rand = mulberry32(WORLD.seed + 77);
  const out = [];
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2;
    const d = 900 + rand() * 4200;
    out.push({
      x: Math.cos(a) * d,
      z: Math.sin(a) * d,
      y: 520 + rand() * 260,
      size: 120 + rand() * 200,
      shade: 0.75 + rand() * 0.25,
    });
  }
  return out;
})();

// Scattered pine copses and beach palms, for the terrain painter to dot in.
export const TREES = (() => {
  const rand = mulberry32(WORLD.seed + 55);
  const out = [];
  for (let i = 0; i < 340; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * (WORLD.islandRadius - 300);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = groundHeight(x, z);
    if (h > 14 && h < 290) out.push({ x, z, h, s: 7 + rand() * 9 });
  }
  return out;
})();

export function peakGlow() { return peakRand(); }

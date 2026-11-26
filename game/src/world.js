// Ember Isle — the world: terrain, runway, rings, wind, clouds, trees.
// Everything here is a pure function of position or time, so the island is
// identical on every machine and the physics can be tested in Node.
import { makeRng, range } from './rng.js';

export const ISLAND_RADIUS = 2600; // metres from the island centre
export const SEA_LEVEL = 0;

// The volcano rises in the far north-east of the island, clear of the
// valley course so the rings stay in open air.
export const VOLCANO = { x: 700, z: 900, height: 430, radius: 420 };
export const CRATER = { x: 700, z: 900, y: 500, radius: 90 };

// The runway runs north-south on the flat southern shore.
export const RUNWAY = {
  x: 0,
  zStart: -2240, // southern threshold (runway 18)
  zEnd: -1420, // northern threshold (runway 36)
  width: 46,
  heading: 0, // 0 = north, the direction of runway 36
  elevation: 9,
};

export const RING_RADIUS = 19;
export const RING_NEAR_BAND = 34;

// The valley course: eight rings from the southern shore, up the valley,
// and back to the runway approach. The last ring hangs over the approach
// so a good run ends lined up for landing.
const COURSE = [
  { x: 0, y: 150, z: -1020 },
  { x: 62, y: 172, z: -620 },
  { x: -68, y: 162, z: -220 },
  { x: 44, y: 192, z: 190 },
  { x: -58, y: 182, z: 610 },
  { x: 72, y: 202, z: 1010 },
  { x: -120, y: 178, z: 800 },
  { x: 0, y: 132, z: -1100 },
];

// Storm Front shoves the rings sideways, alternating sides, so the pilot
// has to crab into the wind to thread them.
const STORM_SHIFT = [92, -86, 96, -82, 100, -90, 86, 0];

export function ringsFor(mission) {
  return COURSE.map((ring, i) => ({
    x: mission === 3 ? ring.x + STORM_SHIFT[i] : ring.x,
    y: ring.y,
    z: ring.z,
    index: i,
  }));
}

// A smooth 0..1 ramp between two edges.
function smoothstep(a, b, v) {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function bump(x, z, cx, cz, height, spread) {
  const dx = x - cx;
  const dz = z - cz;
  return height * Math.exp(-(dx * dx + dz * dz) / (2 * spread * spread));
}

// Ground height in metres at (x, z). The island is a broad dome with a
// volcano cone, a few wooded hills, a carved valley along the course, and
// a flat pad under the runway. Outside the island the sea floor is -12.
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r > ISLAND_RADIUS + 400) return -12;
  const dome = 74 * (1 - smoothstep(1500, ISLAND_RADIUS, r));
  const shore = smoothstep(ISLAND_RADIUS, ISLAND_RADIUS - 260, r);
  let h = dome * shore;
  h += bump(x, z, VOLCANO.x, VOLCANO.z, VOLCANO.height, VOLCANO.radius);
  h += bump(x, z, -900, 300, 96, 420);
  h += bump(x, z, 1050, -500, 82, 380);
  h += bump(x, z, -1250, -950, 64, 330);
  h += bump(x, z, 1500, 1300, 88, 360);
  // Carve the valley so the ring course stays clear of the ground.
  const valley = Math.exp(-(x * x) / (2 * 190 * 190));
  const inValley = smoothstep(-1250, -700, z) * (1 - smoothstep(1150, 1650, z));
  h -= 52 * valley * inValley;
  // Flatten the runway pad.
  const onPad =
    smoothstep(-70, -30, x) * (1 - smoothstep(30, 70, x)) *
    smoothstep(RUNWAY.zStart - 80, RUNWAY.zStart + 60, z) *
    (1 - smoothstep(RUNWAY.zEnd - 60, RUNWAY.zEnd + 80, z));
  h = h * (1 - onPad) + RUNWAY.elevation * onPad;
  if (r > ISLAND_RADIUS) h = h * (1 - smoothstep(ISLAND_RADIUS, ISLAND_RADIUS + 400, r)) - 12 * smoothstep(ISLAND_RADIUS, ISLAND_RADIUS + 400, r);
  return Math.max(h, -12);
}

// The surface you can hit: the terrain on land, the sea surface (y=0)
// once you are past the shore. Without this a ditching jet would fly
// on forever underneath the water.
export function surfaceHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r > ISLAND_RADIUS) return Math.max(terrainHeight(x, z), 0);
  return terrainHeight(x, z);
}

export function onRunway(x, z) {
  return (
    Math.abs(x - RUNWAY.x) <= RUNWAY.width / 2 &&
    z >= RUNWAY.zStart &&
    z <= RUNWAY.zEnd
  );
}

export function runwayCentreDistance(x) {
  return Math.abs(x - RUNWAY.x);
}

// Wind: a pure deterministic function of mission time (seconds).
// Missions 1-2 get a calm north-west breeze; mission 3 gets a westerly
// storm with gusts built from two slow sines, so it repeats exactly.
// Returns { speedKt, fromDeg, x, z } where (x, z) is the wind vector in
// m/s pointing where the air is going (x east, z north).
export function windAt(mission, t) {
  const ktToMs = 0.514444;
  if (mission === 3) {
    const base = 26;
    const gust =
      7 * Math.sin((t / 9) * Math.PI * 2 + 0.6) +
      4 * Math.sin((t / 23) * Math.PI * 2 + 2.1);
    const speedKt = base + gust;
    // From the west (270 deg): the air moves toward the east (+x).
    const fromRad = (270 * Math.PI) / 180;
    const toRad = fromRad + Math.PI;
    const ms = speedKt * ktToMs;
    return {
      speedKt,
      fromDeg: 270,
      gustKt: gust,
      x: Math.sin(toRad) * ms,
      z: Math.cos(toRad) * ms,
    };
  }
  const speedKt = 7;
  const fromRad = (315 * Math.PI) / 180; // from the north-west
  const toRad = fromRad + Math.PI;
  const ms = speedKt * ktToMs;
  return {
    speedKt,
    fromDeg: 315,
    gustKt: 0,
    x: Math.sin(toRad) * ms,
    z: Math.cos(toRad) * ms,
  };
}

// Crosswind component on the runway, in knots. The runway points north,
// so the east-west part of the wind is the crosswind.
export function crosswindKt(mission, t) {
  const w = windAt(mission, t);
  return Math.abs(w.x) / 0.514444;
}

// Scenery, generated once from a fixed seed so every run matches.
function buildScenery() {
  const rng = makeRng(20261126);
  const trees = [];
  for (let i = 0; i < 240; i++) {
    const x = range(rng, -2300, 2300);
    const z = range(rng, -2300, 2300);
    const h = terrainHeight(x, z);
    if (h < 14 || h > 210) continue;
    if (onRunway(x, z)) continue;
    if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < 320) continue;
    trees.push({ x, z, y: h, size: range(rng, 7, 15), shade: range(rng, 0.75, 1) });
  }
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    clouds.push({
      x: range(rng, -3200, 3200),
      y: range(rng, 330, 560),
      z: range(rng, -3200, 3200),
      size: range(rng, 130, 320),
      speed: range(rng, 4, 9),
      shade: range(rng, 0.82, 1),
    });
  }
  return { trees, clouds };
}

export const SCENERY = buildScenery();

// A smoke puff above the crater, as a pure function of time. Each puff
// rises, grows, fades, and is carried downwind; looping every 26 s.
export function smokePuff(i, t) {
  const cycle = 26;
  const age = ((t * 0.9 + i * (cycle / 22)) % cycle) / cycle; // 0..1
  const wind = windAt(3, t);
  const rise = age * 260;
  return {
    x: CRATER.x + wind.x * age * 14 + Math.sin(i * 2.4 + age * 5) * 22,
    y: CRATER.y + rise,
    z: CRATER.z + wind.z * age * 14 + Math.cos(i * 1.7 + age * 4) * 22,
    radius: 26 + age * 64,
    alpha: 0.5 * (1 - age) * (0.55 + 0.45 * Math.sin(i * 3.1)),
  };
}
export const SMOKE_PUFFS = 22;

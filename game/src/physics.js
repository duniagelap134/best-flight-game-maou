// Ember Isle — flight physics. Arcade, deterministic, and testable in Node:
// every step is a pure function of (state, input, dt) plus the wind, which
// itself is a pure function of mission time. No Math.random anywhere.
import {
  terrainHeight,
  surfaceHeight,
  onRunway,
  runwayCentreDistance,
  windAt,
  crosswindKt,
  ringsFor,
  RING_RADIUS,
  RING_NEAR_BAND,
  RUNWAY,
  VOLCANO,
  CRATER,
} from './world.js';

export const STALL_SPEED = 30; // m/s: slower than this with the nose up, you sink
export const MAX_SPEED = 96;
export const RING_POINTS = 300;

const KT_TO_MS = 0.514444;

export function createFlight(mission) {
  const rings = ringsFor(mission);
  return {
    mission,
    mode: 'flying',
    time: 0,
    timeLeft: mission === 2 ? 150 : null,
    pos: { x: 0, y: RUNWAY.elevation + 2, z: RUNWAY.zStart + 60 },
    heading: 0, // radians, 0 = north, clockwise
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: 100,
    damage: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    rings,
    ringIndex: 0,
    ringsHit: rings.map(() => false),
    nearMissArmed: false,
    nearMissRing: -1,
    minRingDist: Infinity,
    stall: false,
    airborneOnce: false,
    verticalSpeed: 0,
    groundSpeed: 0,
    message: '',
    messageTime: 0,
    landedQuality: null,
    offCentre: null,
    crosswindAtLanding: null,
    crashReason: '',
    ringsScored: 0,
  };
}

export function ringNormal(rings, i) {
  const cur = rings[i];
  const prev = i === 0
    ? { x: 0, y: RUNWAY.elevation + 2, z: RUNWAY.zStart + 60 }
    : rings[i - 1];
  const dx = cur.x - prev.x;
  const dy = cur.y - prev.y;
  const dz = cur.z - prev.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function note(state, text) {
  state.message = text;
  state.messageTime = 3;
}

export function landingQuality(state) {
  const cross = state.crosswindAtLanding ?? 0;
  const off = state.offCentre ?? 0;
  const sink = Math.abs(state.verticalSpeed);
  const speedOff = Math.abs(state.speed - 38);
  const q = 100 - cross * 1 - off * 0.8 - sink * 3 - speedOff * 0.5;
  return Math.max(5, Math.min(100, Math.round(q)));
}

// One fixed step. input: { pitch: -1..1 (positive pulls the nose up),
// roll: -1..1 (positive banks right), throttle: -1..1 (delta per second) }.
export function stepFlight(state, input, dt) {
  if (state.mode !== 'flying') return state;
  state.time += dt;
  if (state.messageTime > 0) state.messageTime -= dt;

  // Throttle and fuel.
  state.throttle = clamp(state.throttle + (input.throttle || 0) * dt, 0, 1);
  if (state.fuel > 0) {
    state.fuel = Math.max(0, state.fuel - (0.25 + state.throttle * 0.75) * 0.55 * dt);
  }
  const thrust = state.fuel > 0 ? state.throttle : 0;

  // Speed: thrust against drag, plus a little help rolling down the strip.
  const drag = 0.0028 * state.speed * state.speed;
  let accel = thrust * 26 - drag;
  const ground = surfaceHeight(state.pos.x, state.pos.z);
  const airborne = state.pos.y > ground + 3 || state.speed > 25;
  if (!airborne && state.speed < 12) accel += 2.5;
  state.speed = clamp(state.speed + accel * dt, 0, MAX_SPEED);

  // Attitude: the stick sets a target attitude and the jet eases toward
  // it, so holding the stick holds a climb or a bank instead of winding
  // the pitch up to the stops. No input eases back to level flight.
  const targetPitch = (input.pitch || 0) * 0.55;
  state.pitch += (targetPitch - state.pitch) * Math.min(1, 2.0 * dt);
  const targetRoll = (input.roll || 0) * 1.1;
  state.roll += (targetRoll - state.roll) * Math.min(1, 2.5 * dt);

  // Turning: banked flight turns, faster when you are fast.
  state.heading += state.roll * (state.speed / 55) * 0.55 * dt;
  if (state.heading > Math.PI) state.heading -= Math.PI * 2;
  if (state.heading < -Math.PI) state.heading += Math.PI * 2;

  // Vertical speed: climb on the wing, sink when stalled or slow — but
  // only in the air. On the ground the wheels hold you up.
  const groundNow = surfaceHeight(state.pos.x, state.pos.z);
  const isAirborne = state.pos.y > groundNow + 3 || state.speed > 25;
  if (isAirborne) state.airborneOnce = true;
  let vy = state.speed * Math.sin(state.pitch);
  state.stall = state.speed < STALL_SPEED && state.pitch > 0.12 && isAirborne;
  if (state.stall) vy -= (STALL_SPEED - state.speed) * 0.9;
  if (state.speed < 18 && isAirborne) vy -= (18 - state.speed) * 0.35;
  state.verticalSpeed = vy;

  // Wind pushes the ground track, never the heading: you must crab.
  const wind = windAt(state.mission, state.time);
  const fx = Math.sin(state.heading);
  const fz = Math.cos(state.heading);
  const airX = fx * state.speed;
  const airZ = fz * state.speed;
  const push = airborne || state.speed > 25 ? 1 : 0;
  const gx = airX + wind.x * push;
  const gz = airZ + wind.z * push;
  state.pos.x += gx * dt;
  state.pos.z += gz * dt;
  state.pos.y += vy * dt;
  state.groundSpeed = Math.hypot(gx, gz);

  // The clock in the time trial.
  if (state.timeLeft !== null) {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      state.mode = 'crashed';
      state.crashReason = 'Out of time — the canyon clock hit zero.';
      return state;
    }
  }

  const nowGround = surfaceHeight(state.pos.x, state.pos.z);

  // The volcano is a hard wall: fly into the cone and you are done.
  const craterDist = Math.hypot(state.pos.x - CRATER.x, state.pos.z - CRATER.z);
  if (craterDist < 110 && state.pos.y < CRATER.y + 60 && state.pos.y > nowGround) {
    state.mode = 'crashed';
    state.damage = 100;
    state.crashReason = 'You flew into the volcano.';
    return state;
  }

  // Rings: thread, near-miss, or fly past.
  if (state.ringIndex < state.rings.length) {
    const ring = state.rings[state.ringIndex];
    const dx = state.pos.x - ring.x;
    const dy = state.pos.y - ring.y;
    const dz = state.pos.z - ring.z;
    const dist = Math.hypot(dx, dy, dz);
    state.minRingDist = Math.min(state.minRingDist, dist);
    if (dist < RING_RADIUS) {
      const mult = 1 + 0.25 * state.combo;
      const gained = Math.round(RING_POINTS * mult);
      state.score += gained;
      state.combo += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      state.ringsHit[state.ringIndex] = true;
      state.ringsScored += 1;
      note(state, `RING ${state.ringIndex + 1}  +${gained}  (combo x${state.combo})`);
      state.ringIndex += 1;
      state.nearMissArmed = false;
      state.minRingDist = Infinity;
    } else {
      if (dist < RING_NEAR_BAND) {
        state.nearMissArmed = true;
        state.nearMissRing = state.ringIndex;
      } else if (state.nearMissArmed && dist > RING_NEAR_BAND + 8) {
        // Left the band without threading it: the combo is gone.
        if (state.combo > 0) note(state, 'Near miss — combo lost');
        state.combo = 0;
        state.nearMissArmed = false;
      }
      // Clean fly-past: crossed the ring plane without ever getting close.
      const n = ringNormal(state.rings, state.ringIndex);
      const along = dx * n.x + dy * n.y + dz * n.z;
      if (along > RING_RADIUS + 12 && state.minRingDist > RING_NEAR_BAND) {
        if (state.combo > 0) note(state, 'Flew past a ring — combo lost');
        state.combo = 0;
        state.minRingDist = Infinity;
      }
    }
  }

  // Ground contact. A jet that has never left the ground is just taxiing:
  // clamp it to the strip and keep rolling, no landing and no crash.
  if (state.pos.y <= nowGround + 1.5) {
    state.pos.y = nowGround + 1.5;
    if (!state.airborneOnce) {
      state.speed = Math.max(0, state.speed - 5 * dt);
      return state;
    }
    const onStrip = onRunway(state.pos.x, state.pos.z);
    const gentle = Math.abs(vy) < 6 && state.speed < 52 && state.pitch > -0.18;
    if (onStrip && gentle) {
      state.mode = 'landed';
      state.offCentre = runwayCentreDistance(state.pos.x);
      state.crosswindAtLanding = crosswindKt(state.mission, state.time);
      state.landedQuality = landingQuality(state);
      state.score += state.landedQuality + 50 * state.bestCombo;
      state.speed = Math.max(0, state.speed - 30 * dt);
      return state;
    }
    if (state.speed > 30 || Math.abs(vy) > 6) {
      state.mode = 'crashed';
      state.damage = 100;
      state.crashReason = onStrip
        ? 'Hard landing — you came in too fast or too steep.'
        : 'You hit the terrain.';
      return state;
    }
    // A slow roll-out on rough ground: it just stops you.
    state.speed = Math.max(0, state.speed - 40 * dt);
    if (state.speed === 0 && state.pos.y <= nowGround + 1.6) {
      state.mode = 'crashed';
      state.crashReason = 'You ran out of runway and stopped in the rough.';
    }
  }

  // Out of fuel over the sea is a glide, not a crash — until the ground.
  if (state.fuel <= 0 && state.speed < 8 && !airborne) {
    state.mode = 'crashed';
    state.crashReason = 'Out of fuel — you glided to a stop short of the strip.';
  }
  return state;
}

// Where the aircraft starts a mission: south end of the strip, nose north.
export function startPose() {
  return {
    pos: { x: 0, y: RUNWAY.elevation + 2, z: RUNWAY.zStart + 60 },
    heading: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
  };
}

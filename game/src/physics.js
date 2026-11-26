// The flight model for Ember Isle: an arcade jet that rewards throttle and turn
// discipline. Speed comes from the throttle, lift from speed, turns from bank,
// and the ground, the sea and a hard landing all end the flight. Fuel drains
// with throttle, and damage from rough handling degrades the airframe: a bent
// jet flies slower, shakes, and answers the stick late.

import { clamp, wrapAngle, lerp } from './rng.js';
import { groundHeight, RINGS, RUNWAY, runwayFrame } from './world.js';

export const MISSIONS = {
  ringRun: {
    id: 'ringRun',
    name: 'RING RUN',
    blurb: 'Thread all 8 gold rings down the valley, then land on runway 18.',
    fuel: 100, fuelDrain: 0.55, ringScore: 250, timeBonus: true,
  },
  timeTrial: {
    id: 'timeTrial',
    name: 'CANYON TIME TRIAL',
    blurb: 'Same 8 rings, half the fuel, against the clock. Fast is everything.',
    fuel: 55, fuelDrain: 0.85, ringScore: 150, timeBonus: true,
  },
};

export function newFlight(missionId) {
  const mission = MISSIONS[missionId] || MISSIONS.ringRun;
  return {
    mission,
    // Position: parked at the runway threshold, facing north down the strip.
    x: RUNWAY.x, z: RUNWAY.z + RUNWAY.length / 2 - 60, y: groundHeight(RUNWAY.x, RUNWAY.z + RUNWAY.length / 2 - 60) + 2,
    heading: 0, pitch: 0, roll: 0,
    speed: 0, // knots-ish, 0..260
    throttle: 0,
    verticalSpeed: 0,
    fuel: mission.fuel,
    damage: 0, // 0..100; past 70 the jet barely answers
    score: 0,
    ringsPassed: 0,
    nextRing: 0,
    time: 0,
    state: 'title', // title | flying | paused | landed | crashed
    crashReason: '',
    landingQuality: 0, // 0..100, softness of the touchdown
    message: '',
    messageUntil: 0,
    stallWarn: false,
    pullUpWarn: false,
    engineOut: false,
    shake: 0,
    maxHeightAbove: 0, // highest the jet has flown above the ground: a landing
    // only counts once the jet has actually been airborne.
    grazed: false,
  };
}

// One physics step, dt in seconds. Input is the held-keys object from input.js.
export function stepFlight(f, input, dt) {
  if (f.state !== 'flying') return;
  f.time += dt;

  // --- Throttle and engine ---
  if (input.throttleUp) f.throttle = clamp(f.throttle + dt * 0.55, 0, 1);
  if (input.throttleDown) f.throttle = clamp(f.throttle - dt * 0.7, 0, 1);
  const maxSpeed = 260 * (1 - f.damage * 0.004); // damage caps top speed
  const targetSpeed = f.fuel > 0 ? 40 + f.throttle * (maxSpeed - 40) : 0;
  const accel = f.fuel > 0 ? 26 : 10;
  f.speed += clamp(targetSpeed - f.speed, -accel * dt, accel * dt * 0.8);
  if (f.fuel <= 0 && !f.engineOut) {
    f.engineOut = true;
    f.message = 'FUEL EMPTY — GLIDE TO THE RUNWAY';
    f.messageUntil = f.time + 4;
  }

  // --- Stick: pitch and roll, softened as damage grows ---
  const authority = 1 - f.damage * 0.006;
  const rollTarget = (input.rollRight ? 1 : 0) - (input.rollLeft ? 1 : 0);
  const pitchTarget = (input.pitchUp ? 1 : 0) - (input.pitchDown ? 1 : 0);
  const rollRate = 1.9 * authority, pitchRate = 1.1 * authority;
  f.roll += clamp(rollTarget * 1.15 - f.roll, -rollRate * dt, rollRate * dt);
  f.pitch += clamp(pitchTarget * 0.42 - f.pitch, -pitchRate * dt, pitchRate * dt);
  // Wings level themselves gently when the stick is centred.
  if (rollTarget === 0) f.roll = lerp(f.roll, 0, dt * 0.55);
  if (pitchTarget === 0) f.pitch = lerp(f.pitch, 0, dt * 0.8);

  // --- Turning: bank turns the nose; pitch trades speed for climb ---
  // Banking right (positive roll) swings the nose right, toward east.
  const turnRate = f.roll * (0.55 + f.speed / 420);
  f.heading = wrapAngle(f.heading + turnRate * dt);
  const speedMs = f.speed * 0.514;
  const groundNow = groundHeight(f.x, f.z);
  const heightNow = f.y - groundNow;
  const airborne = heightNow > 2;
  // Below flying speed the wing stops lifting and the nose drops — but only
  // in the air, and only once the jet has actually flown. A parked jet on the
  // runway sits still instead of sinking through the concrete, and it cannot
  // lift off below rotate speed.
  const stall = f.speed < 78;
  f.stallWarn = stall && heightNow > 12;
  const sink = stall && heightNow > 0.5 && f.maxHeightAbove > 3 ? 14 : 0;
  let climb = Math.sin(f.pitch) * speedMs * 0.9;
  if (!airborne && f.speed < 70) climb = Math.min(climb, 0);
  f.verticalSpeed = climb - sink;
  f.y += f.verticalSpeed * dt;
  f.x += Math.sin(f.heading) * Math.cos(f.pitch) * speedMs * dt;
  f.z -= Math.cos(f.heading) * Math.cos(f.pitch) * speedMs * dt;
  // Soft ceiling and the edge of the charted island.
  if (f.y > 900) { f.y = 900; f.pitch = Math.min(f.pitch, 0); }
  const far = Math.hypot(f.x, f.z);
  if (far > 6800) f.heading = wrapAngle(f.heading + Math.PI); // turn back in

  // --- Fuel burn: throttle and hard manoeuvres drink it ---
  const burn = f.mission.fuelDrain * (0.25 + f.throttle * 0.75 + Math.abs(f.roll) * 0.25);
  f.fuel = Math.max(0, f.fuel - burn * dt);

  // --- Damage shake grows with damage ---
  f.shake = f.damage * 0.02 * (0.5 + Math.abs(Math.sin(f.time * 31)) * 0.5);

  // --- Rings: fly through the glowing hoop to score ---
  const ring = RINGS[f.nextRing];
  if (ring) {
    const dx = f.x - ring.x, dy = f.y - ring.y, dz = f.z - ring.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < ring.radius) {
      ring.passed = true;
      f.ringsPassed++;
      f.nextRing++;
      const bonus = f.mission.ringScore + Math.round(f.speed / 10);
      f.score += bonus;
      f.message = `RING ${f.ringsPassed}/8  +${bonus}`;
      f.messageUntil = f.time + 2.5;
    }
    // Near miss on the current ring scrapes paint, not the airframe.
    else if (d < ring.radius + 26 && !ring.nearMissed) {
      ring.nearMissed = true;
    }
  }

  // --- Ground, sea and runway ---
  const ground = groundHeight(f.x, f.z);
  const frame = runwayFrame(f.x, f.z);
  const heightAbove = f.y - ground;
  f.maxHeightAbove = Math.max(f.maxHeightAbove, heightAbove);
  f.pullUpWarn = heightAbove < 45 && f.verticalSpeed < -4 && f.speed > 90;
  // Touching the ground resolves here: always within half a metre, and within
  // 2.5 m when descending onto it or slow over it, so a stalled jet cannot
  // hover two metres above the strip forever. A fast level low pass does not
  // count as touching.
  const descending = f.verticalSpeed < -0.5;
  const slow = f.speed < 55;
  if (heightAbove <= 0.5 || (heightAbove <= 2.5 && (descending || slow))) {
    const onRunway = frame.overStrip && ground < 80;
    const gentle = Math.abs(f.verticalSpeed) < 9 && Math.abs(f.roll) < 0.35 && f.speed < 150;
    if (onRunway && gentle && f.speed > 55 && f.maxHeightAbove > 15) {
      // A landing: score the touchdown, then roll out.
      f.state = 'landed';
      f.landingQuality = Math.round(clamp(100 - Math.abs(f.verticalSpeed) * 6 - Math.abs(f.roll) * 40 - Math.max(0, f.speed - 120) * 0.4, 5, 100));
      const timeBonus = f.mission.timeBonus ? Math.max(0, Math.round((420 - f.time) * 2)) : 0;
      const ringBonus = f.ringsPassed * 100;
      f.score += f.landingQuality * 5 + timeBonus + ringBonus;
      f.y = ground + 1.5;
    } else if (onRunway && f.speed <= 55 && f.verticalSpeed > -12 && f.maxHeightAbove > 15) {
      // Rolling out slowly on the strip after a long flare still counts.
      f.state = 'landed';
      f.landingQuality = 55;
      f.score += 275 + f.ringsPassed * 100;
      f.y = ground + 1.5;
    } else if (onRunway && f.maxHeightAbove <= 15) {
      // Never left the ground: just taxiing on the strip, not a landing.
      f.y = ground + 1.5;
      f.verticalSpeed = 0;
    } else {
      // Terrain, sea or a runway strike too hard to walk away from.
      const inSea = ground < 2;
      f.state = 'crashed';
      f.crashReason = inSea ? 'DITCHED IN THE SEA' : (frame.overStrip ? 'HARD LANDING — AIRFRAME BROKE UP' : 'CONTROLLED FLIGHT INTO TERRAIN');
      f.y = ground + 1;
    }
  }
  // Graze: clipping a ridge at speed bends the jet instead of ending it, once.
  if (heightAbove > 0.5 && heightAbove < 6 && f.speed > 120 && !f.grazed) {
    f.grazed = true;
    f.damage = Math.min(100, f.damage + 22);
    f.message = 'RIDGE STRIKE — DAMAGE 22% — EASE OFF';
    f.messageUntil = f.time + 3.5;
  }
}

// Heading in degrees (0 = north, 90 = east), speed in knots, altitude in
// feet, for the HUD. Heading follows the world: east is +90.
export function flightReadout(f) {
  const headingDeg = ((f.heading * 180 / Math.PI) % 360 + 360) % 360;
  return {
    heading: Math.round(headingDeg),
    speed: Math.round(f.speed),
    altitude: Math.round(f.y * 3.28084),
    verticalSpeed: Math.round(f.verticalSpeed * 196.85),
    fuel: Math.round(f.fuel),
    damage: Math.round(f.damage),
  };
}

// Bearing and distance from the jet to the current objective (next ring, else runway).
export function objectiveReadout(f) {
  let tx, tz, label;
  const ring = RINGS[f.nextRing];
  if (ring) { tx = ring.x; tz = ring.z; label = `RING ${f.nextRing + 1}`; }
  else { tx = RUNWAY.x; tz = RUNWAY.z; label = 'RUNWAY 18'; }
  const dx = tx - f.x, dz = tz - f.z;
  const bearing = ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360;
  const dist = Math.hypot(dx, dz);
  return { bearing: Math.round(bearing), distance: Math.round(dist), label };
}

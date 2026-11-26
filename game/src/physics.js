// The flight model for Ember Isle: an arcade jet that rewards throttle and turn
// discipline. Speed comes from the throttle, lift from speed, turns from bank,
// and the ground, the sea and a hard landing all end the flight. Fuel drains
// with throttle, and damage from rough handling degrades the airframe: a bent
// jet flies slower, shakes, and answers the stick late.

import { clamp, wrapAngle, lerp } from './rng.js';
import { groundHeight, RINGS, RUNWAY, runwayFrame, ringAt } from './world.js';

// The wind: a direction the air blows TOWARD, in heading radians (0 = north,
// PI/2 = east), and a speed in knots. Every mission has wind — a light breeze
// on the calm days, a gale in Storm Front — and the gusts are a pure function
// of mission time, so two flights with the same inputs see the same sky.
// The breeze blows from the north-west toward the south-east; the storm
// blows straight in from the west, across the valley and across the runway.
export const WIND = {
  calm: { base: 7, dir: Math.PI * 0.75, gustAmp: 2 },
  storm: { base: 26, dir: Math.PI / 2, gustAmp: 11 },
};

export function windAt(time, missionId) {
  const spec = missionId === 'stormFront' ? WIND.storm : WIND.calm;
  // Two slow sines, out of phase, so gusts swell and fade instead of
  // ticking like a metronome. Deterministic: same time, same gust.
  const gust = Math.sin(time * 0.9) * 0.6 * spec.gustAmp
    + Math.sin(time * 0.37 + 1.7) * 0.4 * spec.gustAmp;
  const speed = Math.max(0, spec.base + gust);
  return { speed, dir: spec.dir, gust: speed - spec.base };
}

// Crosswind across the runway strip, in knots: positive blows east across
// a southbound landing on 18. The runway axis runs north-south, so the
// crosswind is the wind's east component.
export function crosswindKt(wind) {
  return wind.speed * Math.sin(wind.dir);
}

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
  stormFront: {
    id: 'stormFront',
    name: 'STORM FRONT',
    blurb: 'Eight rings in a crosswind gale. Crab into the wind, hold the line.',
    fuel: 100, fuelDrain: 0.6, ringScore: 300, timeBonus: true,
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
    // Wind, combo and landing detail for Storm Front and the HUD.
    wind: windAt(0, missionId),
    combo: 0, // consecutive rings threaded without a scrape or a miss
    maxCombo: 0,
    closestToRing: Infinity, // closest the jet has come to the current ring
    nearMissArmed: false, // true while the jet is inside the current ring's scrape band
    crosswindAtLanding: 0,
    landingAcross: 0, // metres off the centreline at touchdown
    maxHeightAbove: 0, // highest the jet has flown above the ground: a landing
    // only counts once the jet has actually been airborne.
    grazed: false,
  };
}

// One physics step, dt in seconds. Input is the held-keys object from input.js.
export function stepFlight(f, input, dt) {
  if (f.state !== 'flying') return;
  f.time += dt;

  // --- Wind: gusts swell and fade with mission time; the HUD reads f.wind ---
  f.wind = windAt(f.time, f.mission.id);

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
  // --- Wind push: the air mass carries the jet across the ground. A parked
  // jet stays put — the push only bites once airborne (or rolling fast) —
  // and the heading never changes, so the pilot must crab into the wind to
  // hold a ground track: nose east of the course when the gale blows east.
  if (heightNow > 2 || f.speed > 40) {
    const windMs = f.wind.speed * 0.514;
    f.x += Math.sin(f.wind.dir) * windMs * dt;
    f.z -= Math.cos(f.wind.dir) * windMs * dt;
  }
  // Soft ceiling and the edge of the charted island.
  if (f.y > 900) { f.y = 900; f.pitch = Math.min(f.pitch, 0); }
  const far = Math.hypot(f.x, f.z);
  if (far > 6800) f.heading = wrapAngle(f.heading + Math.PI); // turn back in

  // --- Fuel burn: throttle and hard manoeuvres drink it ---
  const burn = f.mission.fuelDrain * (0.25 + f.throttle * 0.75 + Math.abs(f.roll) * 0.25);
  f.fuel = Math.max(0, f.fuel - burn * dt);

  // --- Damage shake grows with damage ---
  f.shake = f.damage * 0.02 * (0.5 + Math.abs(Math.sin(f.time * 31)) * 0.5);

  // --- Rings: fly through the glowing hoop to score. Threading rings in a
  // row builds a combo: each consecutive ring pays a growing multiplier, so
  // a clean run is worth far more than eight scattered ones. A scrape in the
  // near-miss band, or flying clean past a ring after getting close to it,
  // breaks the chain — the combo, not the rings, is what a sloppy pass costs.
  const ring = ringAt(f.nextRing, f.mission.id);
  const baseRing = RINGS[f.nextRing];
  // ringAt returns a copy for Storm Front (offset positions), so the
  // passed / near-miss flags always live on the base ring, never the copy.
  if (ring) {
    const dx = f.x - ring.x, dy = f.y - ring.y, dz = f.z - ring.z;
    const d = Math.hypot(dx, dy, dz);
    f.closestToRing = Math.min(f.closestToRing, d);
    if (d < ring.radius) {
      baseRing.passed = true;
      f.ringsPassed++;
      f.nextRing++;
      f.closestToRing = Infinity;
      f.nearMissArmed = false;
      f.combo++;
      f.maxCombo = Math.max(f.maxCombo, f.combo);
      const mult = 1 + (f.combo - 1) * 0.25;
      const bonus = Math.round((f.mission.ringScore + Math.round(f.speed / 10)) * mult);
      f.score += bonus;
      f.message = f.combo > 1
        ? `RING ${f.ringsPassed}/8  +${bonus}  COMBO x${f.combo}`
        : `RING ${f.ringsPassed}/8  +${bonus}`;
      f.messageUntil = f.time + 2.5;
    }
    // Near miss: the scrape band is crossed on every honest approach, so
    // merely being in it means nothing. The combo only breaks when the jet
    // leaves the band again without threading the ring — it came close and
    // flew on by.
    else {
      if (d < ring.radius + 26) f.nearMissArmed = true;
      else if (f.nearMissArmed) {
        f.nearMissArmed = false;
        if (!baseRing.nearMissed) {
          baseRing.nearMissed = true;
          if (f.combo > 0) {
            f.combo = 0;
            f.message = 'SCRAPE — COMBO LOST';
            f.messageUntil = f.time + 2.5;
          }
        }
      }
      // Flown clean past the ring after getting close to it: the chain
      // breaks once, even if the jet never entered the scrape band.
      if (d > 400 && f.closestToRing < 120 && !baseRing.comboLost) {
        baseRing.comboLost = true;
        if (f.combo > 0) {
          f.combo = 0;
          f.message = 'RING MISSED — COMBO LOST';
          f.messageUntil = f.time + 2.5;
        }
      }
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
    // Touchdown quality: soft and level is the base, and the wind and the
    // centreline decide the rest. A crosswind touchdown costs a point per
    // knot across the strip, and every metre off the centreline costs almost
    // a point — a greaser in a gale, dead on the paint, is the best landing
    // this island hands out. The combo pays out here too: the best chain of
    // the flight is worth 50 points a ring.
    const cross = crosswindKt(f.wind);
    f.crosswindAtLanding = cross;
    f.landingAcross = frame.across;
    const qualityFor = (base) => Math.round(clamp(
      base - Math.abs(f.verticalSpeed) * 6 - Math.abs(f.roll) * 40
      - Math.max(0, f.speed - 120) * 0.4 - Math.abs(cross) * 1.0
      - Math.abs(frame.across) * 0.8,
      5, 100));
    if (onRunway && gentle && f.speed > 55 && f.maxHeightAbove > 15) {
      // A landing: score the touchdown, then roll out.
      f.state = 'landed';
      f.landingQuality = qualityFor(100);
      const timeBonus = f.mission.timeBonus ? Math.max(0, Math.round((420 - f.time) * 2)) : 0;
      const ringBonus = f.ringsPassed * 100;
      const comboBonus = f.maxCombo * 50;
      f.score += f.landingQuality * 5 + timeBonus + ringBonus + comboBonus;
      f.y = ground + 1.5;
    } else if (onRunway && f.speed <= 55 && f.verticalSpeed > -12 && f.maxHeightAbove > 15) {
      // Rolling out slowly on the strip after a long flare still counts.
      f.state = 'landed';
      f.landingQuality = qualityFor(55);
      f.score += f.landingQuality * 5 + f.ringsPassed * 100 + f.maxCombo * 50;
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
  const wind = f.wind || windAt(f.time || 0, f.mission.id);
  return {
    heading: Math.round(headingDeg),
    speed: Math.round(f.speed),
    altitude: Math.round(f.y * 3.28084),
    verticalSpeed: Math.round(f.verticalSpeed * 196.85),
    fuel: Math.round(f.fuel),
    damage: Math.round(f.damage),
    windSpeed: Math.round(wind.speed),
    windDir: Math.round(((wind.dir * 180 / Math.PI) % 360 + 360) % 360),
    windGust: Math.round(wind.gust),
    crosswind: Math.round(crosswindKt(wind)),
  };
}

// Bearing and distance from the jet to the current objective (next ring, else runway).
export function objectiveReadout(f) {
  let tx, tz, label;
  const ring = ringAt(f.nextRing, f.mission.id);
  if (ring) { tx = ring.x; tz = ring.z; label = `RING ${f.nextRing + 1}`; }
  else { tx = RUNWAY.x; tz = RUNWAY.z; label = 'RUNWAY 18'; }
  const dx = tx - f.x, dz = tz - f.z;
  const bearing = ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360;
  const dist = Math.hypot(dx, dz);
  return { bearing: Math.round(bearing), distance: Math.round(dist), label };
}

// Ember Isle — Golden Hour Run: the game loop.
// Owns the mission state, the fixed-step physics loop, the screenshot
// poses (?shot=start|play|storm|low|landed) and the test autopilot
// (?auto=1), which flies the course hands-free for verification.
import { createFlight, stepFlight } from './physics.js';
import { render } from './render.js';
import { drawHud } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { RUNWAY, terrainHeight, windAt } from './world.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const params = new URLSearchParams(location.search);
const AUTO = params.get('auto') === '1';
const SHOT = params.get('shot') || '';
const FREEZE = params.get('freeze') === '1';

const audio = createAudio();
const input = createInput(canvas);

let flight = null;
let lastRings = 0;
let lastMode = '';

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function startMission(mission) {
  flight = createFlight(mission);
  lastRings = 0;
  lastMode = 'flying';
  audio.ensure();
  input.clearPressed();
}

// The title screen flies a slow camera over the island.
function titleFlight() {
  const f = createFlight(1);
  f.mode = 'title';
  f.pos = { x: -400, y: 430, z: -2700 };
  f.heading = 0.35;
  f.pitch = -0.06;
  f.roll = 0;
  f.speed = 0;
  f.time = 0;
  return f;
}

flight = titleFlight();

// Deterministic poses for the screenshots. Each one is a fixed moment in
// a flight, so the four pictures show the game honestly.
function applyShot(shot) {
  if (shot === 'start') {
    flight = titleFlight();
    return;
  }
  if (shot === 'play') {
    flight = createFlight(1);
    flight.time = 24;
    flight.pos = { x: 30, y: 185, z: -760 };
    flight.heading = 0.12;
    flight.pitch = 0.02;
    flight.speed = 58;
    flight.groundSpeed = 58;
    flight.throttle = 0.72;
    flight.fuel = 88;
    flight.ringsScored = 1;
    flight.ringsHit[0] = true;
    flight.ringIndex = 1;
    flight.score = 300;
    return;
  }
  if (shot === 'storm') {
    flight = createFlight(3);
    flight.time = 34;
    flight.pos = { x: 96, y: 178, z: -300 };
    flight.heading = 0.08;
    flight.pitch = 0.02;
    flight.speed = 54;
    flight.groundSpeed = 54;
    flight.throttle = 0.78;
    flight.fuel = 91;
    flight.ringsScored = 2;
    flight.ringsHit[0] = true;
    flight.ringsHit[1] = true;
    flight.ringIndex = 2;
    flight.combo = 2;
    flight.bestCombo = 2;
    flight.score = 660;
    return;
  }
  if (shot === 'low') {
    flight = createFlight(1);
    flight.time = 92;
    flight.pos = { x: 6, y: 62, z: -2650 };
    flight.heading = 0.02;
    flight.pitch = -0.04;
    flight.speed = 52;
    flight.groundSpeed = 52;
    flight.throttle = 0.5;
    flight.fuel = 41;
    flight.ringsScored = 5;
    for (let i = 0; i < 5; i++) flight.ringsHit[i] = true;
    flight.ringIndex = 5;
    flight.score = 1875;
    return;
  }
  if (shot === 'landed') {
    flight = createFlight(1);
    flight.mode = 'landed';
    flight.time = 128;
    flight.pos = { x: 2, y: RUNWAY.elevation + 1.5, z: -1750 };
    flight.heading = 0;
    flight.speed = 0;
    flight.throttle = 0;
    flight.fuel = 22;
    flight.ringsScored = 8;
    flight.ringsHit = flight.ringsHit.map(() => true);
    flight.ringIndex = 8;
    flight.bestCombo = 8;
    flight.combo = 8;
    flight.score = 4017;
    flight.landedQuality = 82;
    flight.offCentre = 2;
    flight.crosswindAtLanding = 5;
    return;
  }
}

if (SHOT) applyShot(SHOT);

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Hands-free flying for the live playtest: steer at the next ring, then
// line up on the runway and put it down.
function autopilot() {
  if (!flight || flight.mode !== 'flying') return { pitch: 0, roll: 0, throttle: 0 };
  let target;
  if (flight.ringIndex < flight.rings.length) {
    target = flight.rings[flight.ringIndex];
  } else if (flight.pos.z < -2050) {
    target = { x: 0, y: RUNWAY.elevation + 6, z: -2200 };
  } else {
    target = { x: 0, y: RUNWAY.elevation + 6, z: -2050 };
  }
  const dx = target.x - flight.pos.x;
  const dy = target.y - flight.pos.y;
  const dz = target.z - flight.pos.z;
  const desiredHeading = Math.atan2(dx, dz);
  const err = wrapAngle(desiredHeading - flight.heading);
  const roll = Math.max(-1, Math.min(1, err * 1.4));
  const dist = Math.hypot(dx, dz);
  // Descend gradually: the pitch target is scaled by distance, so a ring
  // 30 m below you 500 m away is a gentle glide, not a dive.
  let pitch = Math.max(-0.6, Math.min(0.6, dy / Math.max(90, Math.min(400, dist * 0.6))));
  let throttle = 0.55;
  if (flight.ringIndex >= flight.rings.length) {
    // Final: fly south down the centreline, not at a point. Aim a touch
    // west when east of the line (and vice versa), so the correction can
    // never cancel the heading error. Bleed speed to ~45 m/s, descend at
    // about -8 m/s, flare under 26 m.
    const wind = windAt(flight.mission, flight.time);
    const comp = Math.asin(Math.max(-0.6, Math.min(0.6, wind.x / Math.max(30, flight.speed))));
    const desired = Math.PI + comp + Math.max(-0.3, Math.min(0.3, flight.pos.x / 150));
    const rollF = Math.max(-1, Math.min(1, wrapAngle(desired - flight.heading) * 1.6));
    if (flight.speed > 58) {
      return { pitch: 0.15, roll: rollF, throttle: -0.7 };
    }
    if (flight.pos.y > 14) {
      // Do not descend until over the strip: level off and crab back to
      // the centreline first, or the storm puts you in the rough.
      if (Math.abs(flight.pos.x) > 25 && flight.pos.y > 60 && flight.speed > 35) {
        return { pitch: 0, roll: rollF, throttle: flight.speed > 48 ? -0.5 : flight.speed < 38 ? 0.4 : 0 };
      }
      return { pitch: -0.35, roll: rollF, throttle: flight.speed > 48 ? -0.5 : flight.speed < 38 ? 0.4 : 0 };
    }
    return { pitch: -0.2, roll: rollF, throttle: -0.6 };
  }
  if (flight.speed < 42) {
    throttle = 0.9;
  } else if (flight.ringIndex === 7 && flight.speed > 70) {
    throttle = -0.5;
  }
  return { pitch, roll, throttle };
}

let last = performance.now();
let accumulator = 0;
const STEP = 1 / 60;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // One-shot keys.
  if (input.take('1')) startMission(1);
  if (input.take('2')) startMission(2);
  if (input.take('3')) startMission(3);
  if (input.take('p') || input.take('P')) {
    if (flight.mode === 'flying') flight.mode = 'paused';
    else if (flight.mode === 'paused') flight.mode = 'flying';
  }
  if (input.take('r') || input.take('R')) {
    if (flight.mode !== 'title') startMission(flight.mission);
  }
  if (input.take('m') || input.take('M')) audio.toggleMute();
  if (input.take('Escape') && flight.mode === 'paused') flight.mode = 'flying';

  if (!FREEZE) {
    if (flight.mode === 'title') {
      flight.time += dt;
      flight.heading += dt * 0.02;
    } else if (flight.mode === 'flying') {
      input.poll();
      const control = AUTO ? autopilot() : input;
      const before = flight.ringsScored;
      accumulator += dt;
      while (accumulator >= STEP) {
        stepFlight(flight, control, STEP);
        accumulator -= STEP;
        if (flight.mode !== 'flying') break;
      }
      if (flight.ringsScored > before) audio.ring();
      if (flight.mode === 'landed' || flight.mode === 'crashed') audio.thud();
      audio.update(flight.throttle, flight.speed, flight.mode === 'flying');
    }
  }

  render(ctx, flight, canvas.width, canvas.height);
  drawHud(ctx, flight, canvas.width, canvas.height);

  const label =
    flight.mode === 'title'
      ? 'Ember Isle — Golden Hour Run. Press 1, 2 or 3 to choose a mission.'
      : `Score ${flight.score}. Rings ${flight.ringsScored} of 8. ` +
        `Speed ${Math.round(flight.speed * 1.94)} knots. ` +
        `Altitude ${Math.round(flight.pos.y * 3.28)} feet. Fuel ${Math.round(flight.fuel)} percent. ` +
        (flight.mode === 'landed' ? `Landed, quality ${flight.landedQuality}.` : '') +
        (flight.mode === 'crashed' ? `Crashed. ${flight.crashReason}` : '');
  if (label !== lastMode) {
    statusEl.textContent = label;
    lastMode = label;
  }
  requestAnimationFrame(frame);
}

canvas.addEventListener('pointerdown', () => audio.ensure());
requestAnimationFrame(frame);

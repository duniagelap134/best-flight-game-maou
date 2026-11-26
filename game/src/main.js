// Ember Isle — Golden Hour Run: the game loop, the screens and the states.
// Title, flying, paused, landed and crashed, plus deterministic screenshot
// poses (?shot=start|play|low|landed) that set the scene up exactly, so the
// cover and the play shots are real renders of this code in a browser.

import { newFlight, stepFlight } from './physics.js';
import { renderScene, drawJet } from './render.js';
import { drawHud, drawTitle, drawPaused, drawLanded, drawCrashed } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { RINGS, RUNWAY, groundHeight } from './world.js';
import { clamp } from './rng.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const input = createInput(canvas);
const audio = createAudio();

let flight = newFlight('ringRun');
let missionId = 'ringRun';
let lastTime = performance.now();
let screenTime = 0; // wall-clock seconds since load, for animation only
let lastRings = 0;
let lastState = 'title';

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function width() { return window.innerWidth; }
function height() { return window.innerHeight; }

function startMission(id) {
  missionId = id;
  for (const ring of RINGS) { ring.passed = false; ring.nearMissed = false; }
  flight = newFlight(id);
  flight.state = 'flying';
  flight.throttle = 0.55;
  lastRings = 0;
  lastState = 'flying';
  audio.unlock();
  setStatus('Flying. Thread the gold rings, then land on runway 18.');
}

function restart() {
  startMission(missionId);
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

// ---- Deterministic screenshot poses -------------------------------------
// ?shot=start  — title screen, jet parked on the runway at golden hour
// ?shot=play   — mid-flight, banked toward ring 3 over the valley, HUD lit
// ?shot=low    — low on final approach, runway lights ahead, 7 rings done
// ?shot=landed — wheels down, win screen with the score breakdown
// The poses only set state the game itself can reach; the render path is the
// same one the player sees.
function applyShot(shot) {
  if (!shot) return;
  if (shot === 'start') {
    flight = newFlight('ringRun');
    flight.state = 'title';
    flight.throttle = 0.35;
    screenTime = 6;
    return;
  }
  if (shot === 'play') {
    startMission('ringRun');
    // North of ring 3, heading south toward it: the gold ring sits dead
    // ahead over the valley, with the sun low to the right.
    flight.x = -260; flight.z = -120;
    flight.y = 210;
    flight.heading = 2.96; flight.pitch = 0.02; flight.roll = -0.3;
    flight.speed = 168; flight.throttle = 0.78; flight.fuel = 74;
    flight.ringsPassed = 2; flight.nextRing = 2;
    RINGS[0].passed = true; RINGS[1].passed = true;
    flight.score = 540; flight.time = 96;
    return;
  }
  if (shot === 'low') {
    startMission('ringRun');
    flight.x = 330; flight.z = 2950;
    flight.y = 122;
    flight.heading = 0.02; flight.pitch = -0.06; flight.roll = 0.04;
    flight.speed = 132; flight.throttle = 0.42; flight.fuel = 31;
    flight.ringsPassed = 7; flight.nextRing = 7;
    for (let i = 0; i < 7; i++) RINGS[i].passed = true;
    flight.score = 1980; flight.time = 243;
    return;
  }
  if (shot === 'landed') {
    startMission('ringRun');
    flight.x = RUNWAY.x; flight.z = RUNWAY.z + 120;
    flight.y = groundHeight(RUNWAY.x, RUNWAY.z + 120) + 1.5;
    flight.heading = 0; flight.speed = 0; flight.throttle = 0;
    flight.fuel = 18; flight.time = 312;
    flight.ringsPassed = 8; flight.nextRing = 8;
    for (const ring of RINGS) ring.passed = true;
    flight.score = 3420;
    flight.landingQuality = 92;
    flight.state = 'landed';
    return;
  }
}

const params = new URLSearchParams(window.location.search);
applyShot(params.get('shot'));

// A tiny debug handle for playtesting: window.__ember exposes the live state
// and lets a test drive the game. It changes nothing the player sees.
window.__ember = {
  flight: () => flight,
  start: startMission,
  shot: applyShot,
  rings: () => RINGS.map((r) => ({ x: r.x, y: r.y, z: r.z, passed: r.passed })),
};

// ---- Main loop ------------------------------------------------------------
function frame(now) {
  const dt = clamp((now - lastTime) / 1000, 0.001, 0.05);
  lastTime = now;
  screenTime += dt;
  const w = width(), h = height();

  input.applyMouse(w, h);

  // One-shot keys.
  if (input.consume('Enter')) {
    audio.unlock();
    if (flight.state === 'title' || flight.state === 'landed' || flight.state === 'crashed') {
      startMission(missionId);
    }
  }
  if (input.consume('KeyR')) restart();
  if (input.consume('KeyP') || input.consume('Escape')) {
    if (flight.state === 'flying') { flight.state = 'paused'; setStatus('Paused.'); }
    else if (flight.state === 'paused') { flight.state = 'flying'; setStatus('Flying.'); }
  }
  if (input.consume('KeyM')) {
    audio.unlock();
    const muted = audio.toggleMute();
    setStatus(muted ? 'Sound muted.' : 'Sound on.');
  }
  if (flight.state === 'title') {
    if (input.consume('Digit1')) missionId = 'ringRun';
    if (input.consume('Digit2')) missionId = 'timeTrial';
  }

  // Physics, only while flying.
  if (flight.state === 'flying') {
    const before = flight.ringsPassed;
    stepFlight(flight, input, dt);
    if (flight.ringsPassed > before) audio.chime();
    if (flight.state === 'crashed') { audio.thud(true); setStatus(`Crashed: ${flight.crashReason}`); }
    if (flight.state === 'landed') { audio.thud(false); setStatus(`Landed. Score ${flight.score}.`); }
    lastRings = flight.ringsPassed;
  }
  audio.update(flight.throttle, flight.speed, flight.state === 'flying');

  // Render: the world, then the HUD, then the jet in front of the HUD's
  // horizon ball, then the screen for the state. The end screens carry their
  // own score lines, so they skip the HUD and stay readable.
  ctx.clearRect(0, 0, w, h);
  renderScene(ctx, w, h, flight, screenTime);
  if (flight.state === 'flying' || flight.state === 'paused') {
    drawHud(ctx, w, h, flight, screenTime);
  }
  drawJet(ctx, w, h, flight, screenTime);
  if (flight.state === 'title') drawTitle(ctx, w, h, flight, screenTime, missionId);
  if (flight.state === 'paused') drawPaused(ctx, w, h, flight);
  if (flight.state === 'landed') drawLanded(ctx, w, h, flight);
  if (flight.state === 'crashed') drawCrashed(ctx, w, h, flight);

  if (flight.state !== lastState) lastState = flight.state;
  void lastRings;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

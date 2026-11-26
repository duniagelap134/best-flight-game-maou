// The painter for Ember Isle: a golden-hour sky, a perspective-projected island
// heightfield, the lit runway, the gold ring course and the chase-view jet.
// Everything is drawn on one 2D canvas, far to near, from the pilot's camera.

import { groundHeight, groundColor, waterColor, RINGS, RUNWAY, CLOUDS, TREES, VOLCANO } from './world.js';
import { clamp, lerp } from './rng.js';

// Sun sits low in the west, so the valley glows and the sea sparkles.
const SUN_AZIMUTH = Math.PI * 0.78; // radians from north, west-ish
const SUN_ELEVATION = 0.21;

function cameraBasis(f) {
  const ch = Math.cos(f.heading), sh = Math.sin(f.heading);
  const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
  // Forward, right and up before roll.
  const fwd = [sh * cp, sp, -ch * cp];
  const right = [ch, 0, sh];
  const up = [-sh * sp, cp, ch * sp];
  // Roll the right/up pair around the forward axis.
  const cr = Math.cos(f.roll), sr = Math.sin(f.roll);
  const r2 = [
    right[0] * cr + up[0] * sr,
    right[1] * cr + up[1] * sr,
    right[2] * cr + up[2] * sr,
  ];
  const u2 = [
    up[0] * cr - right[0] * sr,
    up[1] * cr - right[1] * sr,
    up[2] * cr - right[2] * sr,
  ];
  return { fwd, right: r2, up: u2 };
}

function project(p, cam, basis, cx, cy, focal) {
  const vx = p[0] - cam[0], vy = p[1] - cam[1], vz = p[2] - cam[2];
  const depth = vx * basis.fwd[0] + vy * basis.fwd[1] + vz * basis.fwd[2];
  if (depth < 6) return null;
  const rx = vx * basis.right[0] + vy * basis.right[1] + vz * basis.right[2];
  const ux = vx * basis.up[0] + vy * basis.up[1] + vz * basis.up[2];
  return { x: cx + focal * rx / depth, y: cy - focal * ux / depth, depth };
}

function rgb(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }

export function renderScene(ctx, w, h, f, time) {
  const cx = w / 2, cy = h * 0.52;
  const focal = (h / 2) / Math.tan(0.62); // ~71 degree vertical field of view
  // On the title screen the camera sits a little higher and looks slightly up,
  // so the runway, the valley and the volcano all read behind the menu.
  const titleLift = f.state === 'title' ? 16 : 0;
  const titlePitch = f.state === 'title' ? 0.06 : 0;
  const cam = [f.x, f.y + 2.5 + titleLift, f.z];
  const basis = cameraBasis({ ...f, pitch: f.pitch + titlePitch });
  const shakeX = f.shake ? Math.sin(time * 47) * f.shake : 0;
  const shakeY = f.shake ? Math.cos(time * 39) * f.shake : 0;

  drawSky(ctx, w, h, basis, cx, cy, focal);
  drawClouds(ctx, cam, basis, cx, cy, focal);
  drawTerrain(ctx, cam, basis, cx, cy, focal, w, h);
  drawRunway(ctx, cam, basis, cx, cy, focal, time);
  drawRings(ctx, cam, basis, cx, cy, focal, f, time);
  drawTrees(ctx, cam, basis, cx, cy, focal);
  drawHaze(ctx, w, h);
  drawVignette(ctx, w, h);
  if (shakeX || shakeY) { ctx.translate(shakeX, shakeY); }
}

function drawSky(ctx, w, h, basis, cx, cy, focal) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2c4a7a');
  g.addColorStop(0.35, '#7d8fb5');
  g.addColorStop(0.52, '#e8a56b');
  g.addColorStop(0.62, '#f7c98a');
  g.addColorStop(1, '#3a2a4d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // The low sun: project a far point in the sun's direction.
  const sunDir = [
    Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    Math.sin(SUN_ELEVATION),
    -Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  ];
  const sp = project([sunDir[0] * 9000, sunDir[1] * 9000 + 60, sunDir[2] * 9000], [0, 60, 0], basis, cx, cy, focal);
  if (sp) {
    const glow = ctx.createRadialGradient(sp.x, sp.y, 4, sp.x, sp.y, 190);
    glow.addColorStop(0, 'rgba(255,236,180,0.95)');
    glow.addColorStop(0.25, 'rgba(255,190,110,0.55)');
    glow.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sp.x - 200, sp.y - 200, 400, 400);
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 26, 0, Math.PI * 2); ctx.fill();
  }
}

function drawClouds(ctx, cam, basis, cx, cy, focal) {
  for (const c of CLOUDS) {
    const p = project([c.x, c.y, c.z], cam, basis, cx, cy, focal);
    if (!p || p.x < -400 || p.x > 2000 || p.y < -200 || p.y > 1200) continue;
    const s = Math.min(240, focal * c.size / p.depth);
    if (s < 4) continue;
    // Warm sunset-lit puffs, never grey slabs.
    const shade = Math.round(255 * c.shade);
    ctx.fillStyle = `rgba(${shade},${Math.round(shade * 0.90)},${Math.round(shade * 0.80)},0.38)`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, s, s * 0.30, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x - s * 0.5, p.y + s * 0.06, s * 0.6, s * 0.20, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x + s * 0.5, p.y + s * 0.05, s * 0.65, s * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTerrain(ctx, cam, basis, cx, cy, focal, w, h) {
  // A fan of sample rows ahead of the camera: the nearest rows start metres
  // from the wheels, so the ground fills the frame even from a parked jet.
  const rows = [6, 10, 16, 24, 34, 48, 68, 96, 135, 190, 265, 370, 520, 730, 1020, 1430, 2000, 2800, 3900, 5000];
  const COLS = 48;
  const halfSpan = 0.98; // radians either side of the nose
  // Precompute the grid, far row first so we can paint far to near.
  const grid = [];
  for (let r = 0; r < rows.length; r++) {
    const d = rows[r];
    const row = [];
    for (let c = 0; c <= COLS; c++) {
      const a = -halfSpan + (2 * halfSpan * c) / COLS;
      const lat = Math.tan(a) * d;
      const wx = cam[0] + basis.fwd[0] * d + basis.right[0] * lat;
      const wz = cam[2] + basis.fwd[2] * d + basis.right[2] * lat;
      const gh = groundHeight(wx, wz);
      const wy = gh < 0 ? 0 : gh;
      const p = project([wx, wy, wz], cam, basis, cx, cy, focal);
      row.push({ p, h: gh, x: wx, z: wz });
    }
    grid.push(row);
  }
  // Paint far to near, one quad per cell.
  for (let r = rows.length - 2; r >= 0; r--) {
    const far = grid[r + 1], near = grid[r];
    for (let c = 0; c < COLS; c++) {
      const a = far[c], b = far[c + 1], cc = near[c + 1], d = near[c];
      if (!a.p || !b.p || !cc.p || !d.p) continue;
      // Skip cells entirely off screen.
      const minX = Math.min(a.p.x, b.p.x, cc.p.x, d.p.x);
      const maxX = Math.max(a.p.x, b.p.x, cc.p.x, d.p.x);
      const minY = Math.min(a.p.y, b.p.y, cc.p.y, d.p.y);
      const maxY = Math.max(a.p.y, b.p.y, cc.p.y, d.p.y);
      if (maxX < 0 || minX > w || maxY < 0 || minY > h) continue;
      // Colour from the near edge's ground; water where the ground is below sea.
      const hMid = (a.h + b.h + cc.h + d.h) / 4;
      let col;
      if (hMid < 0) {
        const depth = Math.min(60, -hMid + 8);
        col = waterColor(-depth);
        // Warm sun glitter on the water near the sun's azimuth.
        const glint = Math.max(0, Math.sin((a.x + d.x) * 0.0021) * Math.sin((a.z + d.z) * 0.0017));
        if (glint > 0.86) col = [232, 178, 110];
      } else {
        col = groundColor((a.x + d.x) / 2, (a.z + d.z) / 2, hMid);
      }
      ctx.fillStyle = rgb(col);
      ctx.beginPath();
      ctx.moveTo(a.p.x, a.p.y); ctx.lineTo(b.p.x, b.p.y);
      ctx.lineTo(cc.p.x, cc.p.y); ctx.lineTo(d.p.x, d.p.y);
      ctx.closePath(); ctx.fill();
    }
  }
  // The volcano's smoke: a soft dark plume above the peak.
  const plume = project([VOLCANO.x, 780, VOLCANO.z], cam, basis, cx, cy, focal);
  if (plume && plume.depth > 0 && plume.depth < 6000) {
    const s = clamp(focal * 260 / plume.depth, 6, 130);
    ctx.fillStyle = 'rgba(90,80,95,0.35)';
    ctx.beginPath();
    ctx.ellipse(plume.x, plume.y, s, s * 0.55, -0.3, 0, Math.PI * 2);
    ctx.ellipse(plume.x + s * 0.7, plume.y - s * 0.35, s * 0.7, s * 0.4, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRunway(ctx, cam, basis, cx, cy, focal, time) {
  // The strip is painted station by station down its length, so the part
  // ahead of the camera always renders even when the tail of it is behind.
  const hw = RUNWAY.width / 2, hl = RUNWAY.length / 2;
  const ground = groundHeight(RUNWAY.x, RUNWAY.z) + 0.6;
  const stations = 14;
  const gy = ground;
  // Asphalt: one quad per station pair.
  ctx.fillStyle = '#3d3a44';
  for (let i = 0; i < stations; i++) {
    const z0 = RUNWAY.z - hl + (2 * hl * i) / stations;
    const z1 = RUNWAY.z - hl + (2 * hl * (i + 1)) / stations;
    const a = project([RUNWAY.x - hw, gy, z0], cam, basis, cx, cy, focal);
    const b = project([RUNWAY.x + hw, gy, z0], cam, basis, cx, cy, focal);
    const c = project([RUNWAY.x + hw, gy, z1], cam, basis, cx, cy, focal);
    const d = project([RUNWAY.x - hw, gy, z1], cam, basis, cx, cy, focal);
    if (!a || !b || !c || !d) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath(); ctx.fill();
  }
  // Edge lines, station by station.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= stations; i++) {
      const z = RUNWAY.z - hl + (2 * hl * i) / stations;
      const p = project([RUNWAY.x + side * hw, gy + 0.1, z], cam, basis, cx, cy, focal);
      if (!p) { pen = false; continue; }
      if (!pen) { ctx.moveTo(p.x, p.y); pen = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  // Centreline dashes.
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 9; i++) {
    const t0 = i / 9, t1 = (i + 0.55) / 9;
    const a = project([RUNWAY.x, gy + 0.2, RUNWAY.z - hl + (2 * hl) * t0], cam, basis, cx, cy, focal);
    const b = project([RUNWAY.x, gy + 0.2, RUNWAY.z - hl + (2 * hl) * t1], cam, basis, cx, cy, focal);
    if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  // Threshold bars at the north end.
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 4;
  for (let k = -2; k <= 2; k++) {
    const a = project([RUNWAY.x + k * 8 - 3, gy + 0.2, RUNWAY.z - hl + 26], cam, basis, cx, cy, focal);
    const b = project([RUNWAY.x + k * 8 + 3, gy + 0.2, RUNWAY.z - hl + 26], cam, basis, cx, cy, focal);
    if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  // Edge lights: warm dots that blink in sequence down the strip.
  for (let i = 0; i <= 12; i++) {
    const z = RUNWAY.z - hl + (2 * hl * i) / 12;
    for (const side of [-1, 1]) {
      const p = project([RUNWAY.x + side * (hw + 4), gy + 0.6, z], cam, basis, cx, cy, focal);
      if (!p) continue;
      const on = (Math.floor(time * 2 + i) % 2) === 0;
      ctx.fillStyle = on ? '#ffd27a' : '#8a6a2a';
      ctx.beginPath(); ctx.arc(p.x, p.y, clamp(focal * 1.6 / p.depth, 1, 5), 0, Math.PI * 2); ctx.fill();
    }
  }
  // Runway number 18 painted near the north threshold, where the southbound
  // landing comes in.
  const num = project([RUNWAY.x, gy + 0.3, RUNWAY.z - hl + 70], cam, basis, cx, cy, focal);
  if (num && num.depth > 900 && num.depth < 2600) {
    const size = clamp(focal * 26 / num.depth, 8, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('18', num.x, num.y);
  }
}

function drawRings(ctx, cam, basis, cx, cy, focal, f, time) {
  // Far rings first so near rings paint over them.
  const ordered = [...RINGS].map((r, i) => ({ r, i })).sort((a, b) => {
    const da = Math.hypot(a.r.x - cam[0], a.r.z - cam[2]);
    const db = Math.hypot(b.r.x - cam[0], b.r.z - cam[2]);
    return db - da;
  });
  for (const { r, i } of ordered) {
    const p = project([r.x, r.y, r.z], cam, basis, cx, cy, focal);
    if (!p) continue;
    const screenR = focal * r.radius / p.depth;
    if (screenR < 2 || screenR > 900) continue;
    const isNext = i === f.nextRing;
    const passed = r.passed;
    const pulse = isNext ? 1 + Math.sin(time * 5) * 0.08 : 1;
    const rad = screenR * pulse;
    // Ground tether: a thin line down to the valley so the ring's height reads.
    const gp = project([r.x, groundHeight(r.x, r.z), r.z], cam, basis, cx, cy, focal);
    if (gp) {
      ctx.strokeStyle = passed ? 'rgba(120,220,140,0.35)' : 'rgba(255,210,110,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(gp.x, gp.y); ctx.stroke();
    }
    // Halo.
    ctx.strokeStyle = passed ? 'rgba(110,220,140,0.9)' : (isNext ? 'rgba(255,205,90,0.95)' : 'rgba(255,190,80,0.55)');
    ctx.lineWidth = clamp(rad * 0.16, 2, 14);
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = clamp(rad * 0.04, 1, 3);
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.stroke();
    // Number tag above the next ring.
    if (isNext && rad > 14) {
      ctx.fillStyle = '#ffd25a';
      ctx.font = `bold ${clamp(rad * 0.5, 12, 30)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${i + 1}`, p.x, p.y - rad - 6);
    }
  }
}

function drawTrees(ctx, cam, basis, cx, cy, focal) {
  // Only the copses near the camera are worth dots; the rest is in the ground colour.
  for (const t of TREES) {
    const dx = t.x - cam[0], dz = t.z - cam[2];
    if (dx * dx + dz * dz > 900 * 900) continue;
    const p = project([t.x, t.h, t.z], cam, basis, cx, cy, focal);
    if (!p) continue;
    const s = clamp(focal * t.s / p.depth, 1.5, 26);
    ctx.fillStyle = '#2e5230';
    ctx.beginPath(); ctx.arc(p.x, p.y - s * 0.5, s * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3d6b38';
    ctx.beginPath(); ctx.arc(p.x, p.y - s * 0.9, s * 0.4, 0, Math.PI * 2); ctx.fill();
  }
}

// The chase-view jet, drawn last so it always sits in front of the HUD's
// horizon ball: the aircraft is the thing the pilot is flying, not a layer
// under the instruments.
export function drawJet(ctx, w, h, f, time) {
  // Chase view: the jet sits just below centre, banked with the roll, nose
  // pitched with the pitch. It is drawn, not modelled: a built-looking twin
  // tail jet with canopy glint, swept wings and lit engines.
  const jx = w / 2, jy = h * 0.66 - f.pitch * 60;
  const scale = clamp(w / 1280, 0.7, 1.3);
  ctx.save();
  ctx.translate(jx, jy);
  ctx.rotate(f.roll * 0.9 + (f.shake ? Math.sin(time * 43) * f.shake * 0.02 : 0));
  ctx.scale(scale, scale);
  // Engine glow, brighter with throttle.
  const glow = 0.35 + f.throttle * 0.65;
  const grad = ctx.createRadialGradient(0, 26, 2, 0, 30, 34 * glow + 8);
  grad.addColorStop(0, `rgba(255,190,90,${0.85 * glow})`);
  grad.addColorStop(0.5, `rgba(255,120,40,${0.45 * glow})`);
  grad.addColorStop(1, 'rgba(255,100,30,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 30, 34 * glow + 8, 0, Math.PI * 2); ctx.fill();
  // Swept wings.
  ctx.fillStyle = '#c8ccd6';
  ctx.beginPath();
  ctx.moveTo(-8, -6); ctx.lineTo(-108, 34); ctx.lineTo(-96, 48); ctx.lineTo(-6, 16);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, -6); ctx.lineTo(108, 34); ctx.lineTo(96, 48); ctx.lineTo(6, 16);
  ctx.closePath(); ctx.fill();
  // Wing shading.
  ctx.fillStyle = 'rgba(70,80,110,0.35)';
  ctx.beginPath();
  ctx.moveTo(-8, -6); ctx.lineTo(-108, 34); ctx.lineTo(-96, 48); ctx.lineTo(-6, 16);
  ctx.closePath(); ctx.fill();
  // Tail fins.
  ctx.fillStyle = '#9aa2b5';
  ctx.beginPath(); ctx.moveTo(-10, 18); ctx.lineTo(-34, -16); ctx.lineTo(-22, -20); ctx.lineTo(-2, 14); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(10, 18); ctx.lineTo(34, -16); ctx.lineTo(22, -20); ctx.lineTo(2, 14); ctx.closePath(); ctx.fill();
  // Fuselage: tapered body with a warm sunset stripe.
  const body = ctx.createLinearGradient(-14, 0, 14, 0);
  body.addColorStop(0, '#8d94a8');
  body.addColorStop(0.5, '#e8ecf4');
  body.addColorStop(1, '#7d8499');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -52);
  ctx.quadraticCurveTo(13, -30, 12, 6);
  ctx.quadraticCurveTo(11, 30, 0, 38);
  ctx.quadraticCurveTo(-11, 30, -12, 6);
  ctx.quadraticCurveTo(-13, -30, 0, -52);
  ctx.closePath(); ctx.fill();
  // Sunset stripe down the spine.
  ctx.fillStyle = '#e8862e';
  ctx.beginPath();
  ctx.moveTo(0, -50); ctx.quadraticCurveTo(4, -20, 3, 10); ctx.lineTo(-3, 10); ctx.quadraticCurveTo(-4, -20, 0, -50);
  ctx.closePath(); ctx.fill();
  // Canopy glint.
  ctx.fillStyle = 'rgba(40,60,110,0.9)';
  ctx.beginPath(); ctx.ellipse(0, -30, 6.5, 13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(190,225,255,0.85)';
  ctx.beginPath(); ctx.ellipse(-2, -34, 2.2, 6, -0.25, 0, Math.PI * 2); ctx.fill();
  // Twin nozzles.
  ctx.fillStyle = '#2c2f38';
  ctx.beginPath(); ctx.arc(-6, 34, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(6, 34, 4.5, 0, Math.PI * 2); ctx.fill();
  // Nav lights: red port, green starboard, blinking white tail strobe.
  ctx.fillStyle = '#ff3b30';
  ctx.beginPath(); ctx.arc(-106, 40, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#34e07a';
  ctx.beginPath(); ctx.arc(106, 40, 3, 0, Math.PI * 2); ctx.fill();
  if (Math.floor(time * 1.6) % 2 === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(0, -50, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawHaze(ctx, w, h) {
  // Warm haze hugging the horizon line.
  const g = ctx.createLinearGradient(0, h * 0.38, 0, h * 0.62);
  g.addColorStop(0, 'rgba(247,201,138,0)');
  g.addColorStop(0.5, 'rgba(247,201,138,0.10)');
  g.addColorStop(1, 'rgba(247,201,138,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.38, w, h * 0.24);
}

function drawVignette(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(10,8,20,0)');
  g.addColorStop(1, 'rgba(10,8,20,0.34)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

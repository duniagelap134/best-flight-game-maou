// Ember Isle — Canvas 2D chase-view renderer.
// A small software 3D projector: the camera sits behind the jet, the island
// is a projected heightfield, and rings, clouds, smoke and rain are drawn
// in painter's order. No images, no network — everything is drawn.
import {
  terrainHeight,
  SCENERY,
  RUNWAY,
  VOLCANO,
  CRATER,
  smokePuff,
  SMOKE_PUFFS,
  windAt,
} from './world.js';
import { ringNormal } from './physics.js';

const GRID_STEP = 220;
const GRID_EXTENT = 2640;

// Precomputed terrain sample grid.
const GRID = [];
for (let z = -GRID_EXTENT; z <= GRID_EXTENT; z += GRID_STEP) {
  const row = [];
  for (let x = -GRID_EXTENT; x <= GRID_EXTENT; x += GRID_STEP) {
    row.push({ x, z, y: terrainHeight(x, z) });
  }
  GRID.push(row);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function groundColor(h, x, z) {
  const craterDist = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  if (craterDist < 200) return '#3a3230';
  if (h < 3) return '#c9a06a'; // sand
  if (h < 45) return '#4d7a3d'; // low grass
  if (h < 120) return '#3a6332'; // forest floor
  if (h < 240) return '#5d5a48'; // high scrub
  if (h < 360) return '#6b5646'; // rock
  return '#463a34'; // volcanic rock
}

export function makeCamera(state, W, H) {
  const h = state.heading;
  const p = state.pitch;
  const fx = Math.sin(h) * Math.cos(p);
  const fy = Math.sin(p);
  const fz = Math.cos(h) * Math.cos(p);
  const cam = {
    x: state.pos.x - fx * 20,
    y: state.pos.y - fy * 20 + 5.5,
    z: state.pos.z - fz * 20,
  };
  // Right = forward x world-up, then roll the basis around forward.
  let rx = fz;
  let ry = 0;
  let rz = -fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  // Up = forward x right. (Right x forward points down — that flips the
  // whole world upside down, so do not "simplify" this.)
  let ux = fy * rz - fz * ry;
  let uy = fz * rx - fx * rz;
  let uz = fx * ry - fy * rx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const roll = state.roll;
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const R = {
    x: rx * c + ux * s,
    y: ry * c + uy * s,
    z: rz * c + uz * s,
  };
  const U = {
    x: ux * c - rx * s,
    y: uy * c - ry * s,
    z: uz * c - rz * s,
  };
  const F = { x: fx, y: fy, z: fz };
  const f = H * 1.05;
  function project(px, py, pz) {
    const dx = px - cam.x;
    const dy = py - cam.y;
    const dz = pz - cam.z;
    const cx = dx * R.x + dy * R.y + dz * R.z;
    const cy = dx * U.x + dy * U.y + dz * U.z;
    const cz = dx * F.x + dy * F.y + dz * F.z;
    if (cz < 3) return null;
    return {
      x: W / 2 + (cx / cz) * f,
      y: H / 2 - (cy / cz) * f,
      d: cz,
      scale: f / cz,
    };
  }
  return { cam, F, R, U, f, project, pitch: Math.asin(clamp(fy, -1, 1)) };
}

function skyGradient(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#241640');
  g.addColorStop(0.42, '#7a2f4e');
  g.addColorStop(0.62, '#e0703a');
  g.addColorStop(0.75, '#ffb45e');
  g.addColorStop(1, '#3a2b52');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawSun(ctx, camera, W, H) {
  // Low in the west, a little north: the golden-hour sun.
  const dir = { x: -0.94, y: 0.16, z: 0.28 };
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const p = camera.project(
    camera.cam.x + (dir.x / len) * 6000,
    camera.cam.y + (dir.y / len) * 6000,
    camera.cam.z + (dir.z / len) * 6000,
  );
  if (!p) return;
  const glow = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 190);
  glow.addColorStop(0, 'rgba(255, 214, 130, 0.95)');
  glow.addColorStop(0.25, 'rgba(255, 170, 80, 0.55)');
  glow.addColorStop(1, 'rgba(255, 150, 60, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(p.x - 200, p.y - 200, 400, 400);
  ctx.fillStyle = '#ffe9b0';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
  ctx.fill();
}

function drawSea(ctx, camera, W, H) {
  // The sea is everything below the eye-level horizon.
  const horizonY = H / 2 + Math.tan(camera.pitch) * camera.f;
  ctx.save();
  ctx.translate(W / 2, horizonY);
  ctx.rotate(-camera.R.y * 0.4);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ff9e57');
  g.addColorStop(0.25, '#c65a4a');
  g.addColorStop(1, '#2c2a55');
  ctx.fillStyle = g;
  ctx.fillRect(-W, 0, W * 2, H * 2);
  // Sun glitter: short bright dashes on the water, west of centre.
  ctx.fillStyle = 'rgba(255, 220, 150, 0.5)';
  for (let i = 0; i < 26; i++) {
    const yy = horizonY + 24 + ((i * 53) % (H - horizonY - 30));
    const xx = W * 0.14 + ((i * 97) % (W * 0.24));
    const w = 26 + (i % 5) * 9;
    ctx.fillRect(xx - w / 2, yy, w, 2.5);
  }
  ctx.restore();
}

function drawTerrain(ctx, camera, W, H) {
  const cells = [];
  for (let r = 0; r < GRID.length - 1; r++) {
    for (let c = 0; c < GRID[r].length - 1; c++) {
      const a = GRID[r][c];
      const b = GRID[r][c + 1];
      const d = GRID[r + 1][c + 1];
      const e = GRID[r + 1][c];
      const pa = camera.project(a.x, a.y, a.z);
      const pb = camera.project(b.x, b.y, b.z);
      const pd = camera.project(d.x, d.y, d.z);
      const pe = camera.project(e.x, e.y, e.z);
      if (!pa || !pb || !pd || !pe) continue;
      const avg = (pa.d + pb.d + pd.d + pe.d) / 4;
      cells.push({ pts: [pa, pb, pd, pe], avg, x: a.x, z: a.z, h: a.y });
    }
  }
  cells.sort((m, n) => n.avg - m.avg);
  for (const cell of cells) {
    ctx.fillStyle = groundColor(cell.h, cell.x, cell.z);
    ctx.beginPath();
    ctx.moveTo(cell.pts[0].x, cell.pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(cell.pts[i].x, cell.pts[i].y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawRunway(ctx, camera) {
  const hw = RUNWAY.width / 2;
  const corners = [
    camera.project(-hw, RUNWAY.elevation + 0.6, RUNWAY.zStart),
    camera.project(hw, RUNWAY.elevation + 0.6, RUNWAY.zStart),
    camera.project(hw, RUNWAY.elevation + 0.6, RUNWAY.zEnd),
    camera.project(-hw, RUNWAY.elevation + 0.6, RUNWAY.zEnd),
  ];
  if (corners.some((p) => !p)) return;
  ctx.fillStyle = '#2e2e33';
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fill();
  // Centreline dashes.
  ctx.fillStyle = '#f5f0e0';
  for (let z = RUNWAY.zStart + 80; z < RUNWAY.zEnd - 40; z += 90) {
    const a = camera.project(-2.5, RUNWAY.elevation + 0.9, z);
    const b = camera.project(2.5, RUNWAY.elevation + 0.9, z);
    const c2 = camera.project(2.5, RUNWAY.elevation + 0.9, z + 42);
    const d2 = camera.project(-2.5, RUNWAY.elevation + 0.9, z + 42);
    if (!a || !b || !c2 || !d2) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c2.x, c2.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.fill();
  }
  // Threshold numbers, sized by distance.
  ctx.fillStyle = '#f5f0e0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const n18 = camera.project(0, RUNWAY.elevation + 1, RUNWAY.zStart + 130);
  if (n18) {
    ctx.font = `bold ${clamp(n18.scale * 34, 10, 64)}px sans-serif`;
    ctx.fillText('18', n18.x, n18.y);
  }
  const n36 = camera.project(0, RUNWAY.elevation + 1, RUNWAY.zEnd - 130);
  if (n36) {
    ctx.font = `bold ${clamp(n36.scale * 34, 10, 64)}px sans-serif`;
    ctx.fillText('36', n36.x, n36.y);
  }
}

function drawTrees(ctx, camera, state) {
  const items = [];
  for (const tree of SCENERY.trees) {
    const dx = tree.x - state.pos.x;
    const dz = tree.z - state.pos.z;
    if (dx * dx + dz * dz > 1500 * 1500) continue;
    const p = camera.project(tree.x, tree.y + tree.size, tree.z);
    if (!p) continue;
    items.push({ p, tree });
  }
  items.sort((a, b) => b.p.d - a.p.d);
  for (const { p, tree } of items) {
    const s = p.scale * tree.size;
    if (s < 2) continue;
    ctx.fillStyle = `rgba(26, 74, 32, ${0.85 * tree.shade})`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - s);
    ctx.lineTo(p.x - s * 0.55, p.y);
    ctx.lineTo(p.x + s * 0.55, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(16, 52, 22, ${0.85 * tree.shade})`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - s * 1.7);
    ctx.lineTo(p.x - s * 0.4, p.y - s * 0.6);
    ctx.lineTo(p.x + s * 0.4, p.y - s * 0.6);
    ctx.closePath();
    ctx.fill();
  }
}

function drawClouds(ctx, camera, state, W) {
  const wind = windAt(state.mission, state.time);
  const items = [];
  for (const cloud of SCENERY.clouds) {
    const span = 7000;
    const x = ((cloud.x + (cloud.speed + wind.x) * state.time + span / 2) % span) - span / 2;
    const p = camera.project(x, cloud.y, cloud.z);
    if (!p) continue;
    items.push({ p, cloud, x });
  }
  items.sort((a, b) => b.p.d - a.p.d);
  for (const { p, cloud, x } of items) {
    const s = p.scale * cloud.size;
    if (s < 4) continue;
    ctx.fillStyle = `rgba(255, 226, 200, ${0.75 * cloud.shade})`;
    for (const [ox, oy, r] of [[-0.5, 0.1, 0.42], [0, -0.12, 0.5], [0.5, 0.08, 0.4]]) {
      ctx.beginPath();
      ctx.ellipse(p.x + ox * s, p.y + oy * s, r * s, r * s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Moving ground shadow.
    const g = camera.project(x, 2, cloud.z);
    if (g) {
      ctx.fillStyle = 'rgba(20, 16, 40, 0.16)';
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, s * 0.7, s * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSmoke(ctx, camera, state) {
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    const puff = smokePuff(i, state.time);
    const p = camera.project(puff.x, puff.y, puff.z);
    if (!p) continue;
    const r = p.scale * puff.radius;
    if (r < 1) continue;
    ctx.fillStyle = `rgba(120, 110, 115, ${puff.alpha * 0.55})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRings(ctx, camera, state) {
  const items = [];
  state.rings.forEach((ring, i) => {
    const p = camera.project(ring.x, ring.y, ring.z);
    if (!p) return;
    items.push({ p, ring, i });
  });
  items.sort((a, b) => b.p.d - a.p.d);
  for (const { p, ring, i } of items) {
    const n = ringNormal(state.rings, i);
    // Two in-plane axes for the ring circle.
    let ux = n.z;
    let uy = 0;
    let uz = -n.x;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = n.y * uz - n.z * uy;
    const vy = n.z * ux - n.x * uz;
    const vz = n.x * uy - n.y * ux;
    const hit = state.ringsHit[i];
    const next = i === state.ringIndex;
    ctx.strokeStyle = hit ? 'rgba(120, 220, 140, 0.75)' : next ? '#ffd24a' : '#e8a93c';
    ctx.lineWidth = next ? 7 : 5;
    ctx.shadowColor = next ? 'rgba(255, 210, 74, 0.9)' : 'rgba(232, 169, 60, 0.5)';
    ctx.shadowBlur = next ? 22 : 8;
    ctx.beginPath();
    for (let k = 0; k <= 26; k++) {
      const a = (k / 26) * Math.PI * 2;
      const px = ring.x + (ux * Math.cos(a) + vx * Math.sin(a)) * 19;
      const py = ring.y + (uy * Math.cos(a) + vy * Math.sin(a)) * 19;
      const pz = ring.z + (uz * Math.cos(a) + vz * Math.sin(a)) * 19;
      const q = camera.project(px, py, pz);
      if (!q) continue;
      if (k === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (next) {
      ctx.fillStyle = '#fff3c4';
      ctx.font = `bold ${clamp(p.scale * 16, 12, 30)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), p.x, p.y - p.scale * 30);
    }
  }
}

function drawRain(ctx, camera, state, W, H) {
  if (state.mission !== 3) return;
  const wind = windAt(3, state.time);
  const gust = Math.max(0, wind.gustKt);
  const count = 50 + Math.round(gust * 7);
  ctx.strokeStyle = 'rgba(190, 210, 235, 0.4)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const x = ((i * 137.5 + state.time * 620) % (W + 120)) - 60;
    const y = ((i * 271.3 + state.time * 1500) % (H + 60)) - 30;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 9, y + 26);
  }
  ctx.stroke();
}

function drawPlane(ctx, W, H, state) {
  const cx = W / 2;
  const cy = H * 0.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.roll * 0.55);
  ctx.fillStyle = '#e8e2d4';
  ctx.beginPath();
  ctx.moveTo(0, -46);
  ctx.lineTo(7, -8);
  ctx.lineTo(7, 26);
  ctx.lineTo(3, 34);
  ctx.lineTo(-3, 34);
  ctx.lineTo(-7, 26);
  ctx.lineTo(-7, -8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c9c0ab';
  ctx.beginPath();
  ctx.moveTo(-58, 6);
  ctx.lineTo(-8, -2);
  ctx.lineTo(-8, 10);
  ctx.lineTo(-58, 16);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(58, 6);
  ctx.lineTo(8, -2);
  ctx.lineTo(8, 10);
  ctx.lineTo(58, 16);
  ctx.closePath();
  ctx.fill();
  // Lit wingtips and a warm canopy glint.
  ctx.fillStyle = '#ff5a3c';
  ctx.beginPath();
  ctx.arc(-58, 11, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#37e08a';
  ctx.beginPath();
  ctx.arc(58, 11, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffb45e';
  ctx.beginPath();
  ctx.ellipse(0, -24, 4, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function render(ctx, state, W, H) {
  const camera = makeCamera(state, W, H);
  skyGradient(ctx, W, H);
  drawSun(ctx, camera, W, H);
  drawSea(ctx, camera, W, H);
  drawTerrain(ctx, camera, W, H);
  drawRunway(ctx, camera);
  drawTrees(ctx, camera, state);
  drawClouds(ctx, camera, state, W);
  drawSmoke(ctx, camera, state);
  drawRings(ctx, camera, state);
  drawRain(ctx, camera, state, W, H);
  if (state.mode !== 'title') drawPlane(ctx, W, H, state);
  return camera;
}

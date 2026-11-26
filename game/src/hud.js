// Ember Isle — the HUD: tapes, horizon, wind panel, and all the screens.
// Drawn in screen space after the world, with warm backlit instruments.
import { windAt } from './world.js';

const AMBER = '#ffb45e';
const PANEL = 'rgba(16, 12, 28, 0.62)';
const LINE = 'rgba(255, 200, 140, 0.85)';

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 180, 94, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function compassLabel(deg) {
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  if (names[deg] !== undefined) return names[deg];
  return String(deg).padStart(3, '0');
}

function drawCompass(ctx, state, W) {
  const w = 340;
  const h = 34;
  const x = (W - w) / 2;
  const y = 14;
  panel(ctx, x, y, w, h);
  const headingDeg = ((state.heading * 180) / Math.PI % 360 + 360) % 360;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = LINE;
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pxPerDeg = 3.2;
  for (let d = -180; d <= 180; d += 5) {
    const deg = Math.round((headingDeg + d + 360) % 360);
    const sx = x + w / 2 + d * pxPerDeg;
    if (sx < x - 10 || sx > x + w + 10) continue;
    const major = deg % 45 === 0;
    const mid = deg % 15 === 0;
    ctx.fillRect(sx - 0.5, y + (major ? 4 : 10), 1, major ? 12 : 6);
    if (major) ctx.fillText(compassLabel(deg), sx, y + h - 9);
    else if (mid) ctx.fillText(String(deg), sx, y + h - 9);
  }
  ctx.restore();
  // Centre caret and readout.
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - 6, y + 1);
  ctx.lineTo(x + w / 2 + 6, y + 1);
  ctx.lineTo(x + w / 2, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff3c4';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(`${String(Math.round(headingDeg)).padStart(3, '0')}°`, x + w / 2, y + h + 16);
}

function drawTape(ctx, value, unit, label, x, y, w, h, step, format) {
  panel(ctx, x, y, w, h);
  const mid = y + h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = LINE;
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const pxPerUnit = h / (step * 6);
  const base = Math.floor(value / step) * step;
  for (let v = base - step * 3; v <= base + step * 3; v += step) {
    const sy = mid - (v - value) * pxPerUnit;
    if (sy < y + 6 || sy > y + h - 6) continue;
    ctx.fillRect(x + 8, sy - 0.5, v % (step * 5) === 0 ? 14 : 8, 1);
    if (v % (step * 5) === 0) ctx.fillText(format(v), x + 26, sy);
  }
  ctx.restore();
  // Centre readout.
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(x + w, mid - 9);
  ctx.lineTo(x + w + 10, mid);
  ctx.lineTo(x + w, mid + 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff3c4';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${format(Math.round(value))}`, x + w - 8, mid);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = 'rgba(255, 220, 170, 0.8)';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h + 13);
}

function drawHorizon(ctx, state, W, H) {
  const cx = W / 2;
  const cy = H * 0.42;
  const r = 62;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  // Sky above the horizon line, ground below, rolled with the jet.
  ctx.translate(cx, cy);
  ctx.rotate(-state.roll);
  const drop = state.pitch * r * 1.4;
  ctx.fillStyle = '#e0703a';
  ctx.fillRect(-r, -r, r * 2, r + drop);
  ctx.fillStyle = '#3a5a34';
  ctx.fillRect(-r, drop, r * 2, r * 2 - drop);
  ctx.strokeStyle = '#fff3c4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r, drop);
  ctx.lineTo(r, drop);
  ctx.stroke();
  ctx.restore();
  // Fixed wings marker and the bezel.
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 16, cy);
  ctx.lineTo(cx - 5, cy);
  ctx.moveTo(cx + 5, cy);
  ctx.lineTo(cx + 16, cy);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 180, 94, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBars(ctx, state, W, H) {
  const w = 210;
  const x = 16;
  let y = H - 118;
  const rows = [
    ['THR', state.throttle, '#ffb45e'],
    ['FUEL', state.fuel / 100, state.fuel < 20 ? '#ff5a3c' : '#37e08a'],
    ['DMG', state.damage / 100, '#ff5a3c'],
  ];
  for (const [label, frac, color] of rows) {
    ctx.fillStyle = '#fff3c4';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 8);
    ctx.fillStyle = 'rgba(16, 12, 28, 0.62)';
    ctx.fillRect(x + 48, y, w - 48, 16);
    ctx.fillStyle = color;
    ctx.fillRect(x + 48, y, (w - 48) * Math.max(0, Math.min(1, frac)), 16);
    y += 24;
  }
  if (state.stall) {
    ctx.fillStyle = '#ff5a3c';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('STALL — NOSE DOWN', x, y + 12);
  }
}

function drawWind(ctx, state, W) {
  const wind = windAt(state.mission, state.time);
  const w = 168;
  const h = state.mission === 3 ? 96 : 78;
  const x = W - w - 16;
  const y = 14;
  panel(ctx, x, y, w, h);
  ctx.fillStyle = '#fff3c4';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('WIND', x + 12, y + 15);
  // Arrow: points where the wind is blowing TO.
  const toRad = ((wind.fromDeg + 180) * Math.PI) / 180;
  const ax = x + 34;
  const ay = y + 44;
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ax - Math.sin(toRad) * 18, ay - Math.cos(toRad) * 18);
  ctx.lineTo(ax + Math.sin(toRad) * 18, ay + Math.cos(toRad) * 18);
  ctx.stroke();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(ax + Math.sin(toRad) * 22, ay + Math.cos(toRad) * 22, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff3c4';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(`${Math.round(wind.speedKt)} KT`, x + 62, y + 40);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(255, 220, 170, 0.85)';
  ctx.fillText(`from ${wind.fromDeg}°`, x + 62, y + 60);
  if (state.mission === 3) {
    const gusting = wind.gustKt > 2;
    ctx.fillStyle = gusting ? '#ff5a3c' : 'rgba(255, 220, 170, 0.85)';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(
      gusting ? `GUSTING +${Math.round(wind.gustKt)} KT` : 'STORM FRONT',
      x + 12,
      y + 80,
    );
  }
}

function drawScore(ctx, state, W) {
  const x = W - 184;
  const y = 122;
  panel(ctx, x, y, 168, 92);
  ctx.fillStyle = '#fff3c4';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`SCORE  ${state.score}`, x + 12, y + 18);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = 'rgba(255, 220, 170, 0.9)';
  ctx.fillText(`RINGS  ${state.ringsScored}/8`, x + 12, y + 42);
  ctx.fillStyle = state.combo > 1 ? '#ffd24a' : 'rgba(255, 220, 170, 0.9)';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(state.combo > 1 ? `COMBO x${state.combo}` : 'COMBO —', x + 12, y + 66);
  if (state.timeLeft !== null) {
    ctx.fillStyle = state.timeLeft < 30 ? '#ff5a3c' : '#fff3c4';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(`TIME ${Math.ceil(state.timeLeft)}s`, x + 12, y + 86);
  }
}

function drawMessage(ctx, state, W, H) {
  if (state.messageTime > 0 && state.message) {
    ctx.fillStyle = `rgba(255, 243, 196, ${Math.min(1, state.messageTime)})`;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.message, W / 2, H * 0.24);
  }
  // Next-ring bearing chevron.
  if (state.mode === 'flying' && state.ringIndex < state.rings.length) {
    const ring = state.rings[state.ringIndex];
    const dx = ring.x - state.pos.x;
    const dz = ring.z - state.pos.z;
    const bearing = Math.atan2(dx, dz);
    let rel = bearing - state.heading;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const dist = Math.hypot(dx, dz);
    ctx.save();
    ctx.translate(W / 2, 74);
    ctx.rotate(rel);
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 8);
    ctx.lineTo(-10, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff3c4';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`RING ${state.ringIndex + 1} — ${Math.round(dist)} m`, W / 2, 100);
  }
}

function drawScreens(ctx, state, W, H) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (state.mode === 'title') {
    ctx.fillStyle = 'rgba(12, 8, 24, 0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffe9b0';
    ctx.font = 'bold 54px sans-serif';
    ctx.fillText('EMBER ISLE', W / 2, H * 0.2);
    ctx.fillStyle = '#ffb45e';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('— Golden Hour Run —', W / 2, H * 0.2 + 44);
    ctx.fillStyle = '#fff3c4';
    ctx.font = '17px sans-serif';
    ctx.fillText('Thread 8 gold rings over the volcano, then land on runway 18/36.', W / 2, H * 0.2 + 82);
    const cards = [
      ['1', 'RING RUN', 'All 8 rings, then land. Calm breeze.'],
      ['2', 'CANYON TIME TRIAL', 'All 8 rings against a 150 s clock.'],
      ['3', 'STORM FRONT', 'Crosswind rings in a 26 kt storm.'],
    ];
    const cw = 250;
    const gap = 22;
    const total = cards.length * cw + (cards.length - 1) * gap;
    let x = (W - total) / 2;
    const y = H * 0.42;
    for (const [key, title, desc] of cards) {
      panel(ctx, x, y, cw, 120);
      ctx.fillStyle = AMBER;
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(`[${key}]  ${title}`, x + cw / 2, y + 30);
      ctx.fillStyle = '#fff3c4';
      ctx.font = '15px sans-serif';
      ctx.fillText(desc, x + cw / 2, y + 66);
      x += cw + gap;
    }
    ctx.fillStyle = 'rgba(255, 220, 170, 0.9)';
    ctx.font = '15px sans-serif';
    ctx.fillText('W/S or ↑/↓ throttle · A/D or ←/→ bank · mouse steers too · P pause · R restart', W / 2, H * 0.42 + 168);
    ctx.fillText('Press 1, 2 or 3 to fly. Click the window first if the keys do nothing.', W / 2, H * 0.42 + 196);
  } else if (state.mode === 'paused') {
    ctx.fillStyle = 'rgba(12, 8, 24, 0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffe9b0';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText('PAUSED', W / 2, H * 0.45);
    ctx.fillStyle = '#fff3c4';
    ctx.font = '17px sans-serif';
    ctx.fillText('P to resume · R to restart · 1/2/3 to switch mission', W / 2, H * 0.45 + 44);
  } else if (state.mode === 'landed') {
    ctx.fillStyle = 'rgba(12, 8, 24, 0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#37e08a';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText('LANDED', W / 2, H * 0.32);
    ctx.fillStyle = '#fff3c4';
    ctx.font = '19px sans-serif';
    ctx.fillText(`Landing quality ${state.landedQuality}/100`, W / 2, H * 0.32 + 44);
    ctx.fillText(`Crosswind ${Math.round(state.crosswindAtLanding ?? 0)} kt · ${Math.round(state.offCentre ?? 0)} m off centreline`, W / 2, H * 0.32 + 74);
    ctx.fillText(`Best combo x${state.bestCombo} · Rings ${state.ringsScored}/8 · Score ${state.score}`, W / 2, H * 0.32 + 104);
    ctx.fillStyle = 'rgba(255, 220, 170, 0.9)';
    ctx.font = '16px sans-serif';
    ctx.fillText('R to fly again · 1/2/3 for another mission', W / 2, H * 0.32 + 146);
  } else if (state.mode === 'crashed') {
    ctx.fillStyle = 'rgba(24, 6, 10, 0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff5a3c';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText('CRASHED', W / 2, H * 0.36);
    ctx.fillStyle = '#fff3c4';
    ctx.font = '19px sans-serif';
    ctx.fillText(state.crashReason || 'You went down.', W / 2, H * 0.36 + 44);
    ctx.fillText(`Rings ${state.ringsScored}/8 · Score ${state.score}`, W / 2, H * 0.36 + 74);
    ctx.fillStyle = 'rgba(255, 220, 170, 0.9)';
    ctx.font = '16px sans-serif';
    ctx.fillText('R to try again', W / 2, H * 0.36 + 116);
  }
}

export function drawHud(ctx, state, W, H) {
  if (state.mode === 'title') {
    drawScreens(ctx, state, W, H);
    return;
  }
  drawCompass(ctx, state, W);
  // Speed tape (left) in knots, altitude tape (right) in feet.
  drawTape(ctx, state.groundSpeed / 0.514444, 'kt', 'SPEED', 14, H * 0.3, 74, 210, 10, (v) => String(v));
  drawTape(ctx, Math.max(0, state.pos.y) * 3.28084, 'ft', 'ALT FT', W - 88, H * 0.3, 74, 210, 100, (v) => String(v));
  drawHorizon(ctx, state, W, H);
  drawBars(ctx, state, W, H);
  drawWind(ctx, state, W);
  drawScore(ctx, state, W);
  drawMessage(ctx, state, W, H);
  drawScreens(ctx, state, W, H);
}

// The HUD and the screens for Ember Isle: compass tape, speed and altitude
// tapes, artificial horizon, throttle and fuel, ring counter, timer and score,
// plus the title, pause, landed and crashed screens. Everything is drawn on
// the same canvas as the world, so a screenshot always shows the instruments.

import { clamp, lerp } from './rng.js';
import { flightReadout, objectiveReadout, MISSIONS } from './physics.js';

const CREAM = '#ffe9b8';
const AMBER = '#ffb347';
const PANEL = 'rgba(12,16,34,0.62)';
const PANEL_LINE = 'rgba(255,210,130,0.45)';

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = PANEL_LINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill(); ctx.stroke();
}

function compassLabel(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[i];
}

export function drawHud(ctx, w, h, f, time) {
  const r = flightReadout(f);
  const obj = objectiveReadout(f);
  drawCompass(ctx, w, h, r.heading, obj);
  drawSpeedTape(ctx, w, h, r.speed);
  drawAltitudeTape(ctx, w, h, r.altitude, r.verticalSpeed);
  drawHorizon(ctx, w, h, f);
  drawThrottleFuel(ctx, w, h, f);
  drawMission(ctx, w, h, f, time);
  drawWarnings(ctx, w, h, f, time);
  drawObjectiveArrow(ctx, w, h, f, obj);
  if (f.message && time < f.messageUntil) {
    ctx.fillStyle = CREAM;
    ctx.font = `bold ${Math.round(h * 0.032)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8;
    ctx.fillText(f.message, w / 2, h * 0.30);
    ctx.shadowBlur = 0;
  }
}

function drawCompass(ctx, w, h, heading, obj) {
  const cw = Math.min(460, w * 0.36), ch = 46;
  const x0 = (w - cw) / 2, y0 = 12;
  panel(ctx, x0, y0, cw, ch);
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, cw, ch); ctx.clip();
  const pxPerDeg = cw / 120;
  for (let d = -60; d <= 60; d += 5) {
    const deg = Math.round(((heading + d) % 360 + 360) % 360);
    const x = x0 + cw / 2 + d * pxPerDeg;
    const major = deg % 30 === 0;
    ctx.strokeStyle = major ? CREAM : 'rgba(255,233,184,0.4)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(x, y0 + ch - 8); ctx.lineTo(x, y0 + ch - (major ? 20 : 13)); ctx.stroke();
    if (major) {
      ctx.fillStyle = CREAM;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const label = deg % 90 === 0 ? compassLabel(deg) : String(deg).padStart(3, '0');
      ctx.fillText(label, x, y0 + 5);
    }
  }
  ctx.restore();
  // Heading caret and digital readout.
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 7, y0 + ch + 2); ctx.lineTo(w / 2 + 7, y0 + ch + 2); ctx.lineTo(w / 2, y0 + ch + 11);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = CREAM;
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`${String(heading).padStart(3, '0')}°`, x0 + cw + 12, y0 + ch / 2);
  // Objective bearing + distance, right of the compass.
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffd25a';
  ctx.fillText(`${obj.label}  ${obj.bearing}°  ${(obj.distance / 1000).toFixed(1)} km`, x0 - 12, y0 + ch / 2);
}

function drawSpeedTape(ctx, w, h, speed) {
  const x0 = 14, y0 = h * 0.26, th = Math.min(300, h * 0.42), tw = 74;
  panel(ctx, x0, y0, tw, th);
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, tw, th); ctx.clip();
  const pxPerKt = th / 160;
  for (let v = Math.max(0, speed - 80); v <= speed + 80; v += 10) {
    const y = y0 + th / 2 - (v - speed) * pxPerKt;
    const major = v % 20 === 0;
    ctx.strokeStyle = major ? CREAM : 'rgba(255,233,184,0.35)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(x0 + tw - 8, y); ctx.lineTo(x0 + tw - (major ? 20 : 12), y); ctx.stroke();
    if (major) {
      ctx.fillStyle = CREAM;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(String(v), x0 + tw - 24, y);
    }
  }
  ctx.restore();
  // Digital speed box.
  ctx.fillStyle = '#1b2a4a';
  ctx.fillRect(x0, y0 + th / 2 - 17, tw, 34);
  ctx.strokeStyle = AMBER; ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0 + th / 2 - 17, tw, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(speed), x0 + tw / 2, y0 + th / 2 + 1);
  ctx.fillStyle = CREAM;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('KNOTS', x0, y0 - 16);
}

function drawAltitudeTape(ctx, w, h, alt, vs) {
  const tw = 84, th = Math.min(300, h * 0.42);
  const x0 = w - tw - 14, y0 = h * 0.26;
  panel(ctx, x0, y0, tw, th);
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, tw, th); ctx.clip();
  const pxPerFt = th / 1600;
  const low = Math.max(0, alt - 800);
  for (let v = low; v <= alt + 800; v += 100) {
    if (v < 0) continue;
    const y = y0 + th / 2 - (v - alt) * pxPerFt;
    const major = v % 500 === 0;
    ctx.strokeStyle = major ? CREAM : 'rgba(255,233,184,0.35)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(x0 + 8, y); ctx.lineTo(x0 + (major ? 20 : 12), y); ctx.stroke();
    if (major) {
      ctx.fillStyle = CREAM;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(String(v), x0 + 24, y);
    }
  }
  ctx.restore();
  ctx.fillStyle = '#1b2a4a';
  ctx.fillRect(x0, y0 + th / 2 - 17, tw, 34);
  ctx.strokeStyle = AMBER; ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0 + th / 2 - 17, tw, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(alt), x0 + tw / 2, y0 + th / 2 + 1);
  ctx.fillStyle = CREAM;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ALT FT', x0, y0 - 16);
  // Vertical speed arrow.
  const arrow = vs > 30 ? '▲' : vs < -30 ? '▼' : '—';
  ctx.fillStyle = vs < -600 ? '#ff6b5e' : CREAM;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`${arrow} ${Math.abs(vs)} fpm`, x0, y0 + th + 18);
}

function drawHorizon(ctx, w, h, f) {
  const cx = w / 2, cy = h * 0.52, r = Math.min(58, h * 0.075);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  ctx.rotate(-f.roll);
  const pitchPx = clamp(f.pitch * r * 1.4, -r, r);
  // Sky half and ground half, split by the pitch line.
  ctx.fillStyle = '#7fb2e0';
  ctx.fillRect(-r, -r, 2 * r, r + pitchPx);
  ctx.fillStyle = '#8a6a3f';
  ctx.fillRect(-r, pitchPx, 2 * r, r - pitchPx + 1);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-r, pitchPx); ctx.lineTo(r, pitchPx); ctx.stroke();
  // Pitch ladder rungs.
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.5;
  for (const p of [-0.3, -0.15, 0.15, 0.3]) {
    const y = pitchPx - p * r * 1.4;
    ctx.beginPath(); ctx.moveTo(-r * 0.45, y); ctx.lineTo(r * 0.45, y); ctx.stroke();
  }
  ctx.restore();
  // Fixed wings marker and bank pointer.
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r + 6, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.stroke();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  const bx = cx + Math.sin(f.roll) * (r + 10), by = cy - Math.cos(f.roll) * (r + 10);
  ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 16, cy); ctx.lineTo(cx - 4, cy);
  ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + 16, cy);
  ctx.moveTo(cx, cy - 3); ctx.lineTo(cx, cy + 3);
  ctx.stroke();
  ctx.strokeStyle = PANEL_LINE; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}

function drawThrottleFuel(ctx, w, h, f) {
  const x0 = 14, y0 = h - 118, bw = 190, bh = 16;
  // Throttle bar.
  ctx.fillStyle = CREAM;
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('THR', x0, y0 + bh / 2);
  panel(ctx, x0 + 44, y0, bw, bh);
  ctx.fillStyle = f.throttle > 0.85 ? '#ff9a3d' : '#7fd0ff';
  ctx.fillRect(x0 + 46, y0 + 2, (bw - 4) * f.throttle, bh - 4);
  ctx.fillStyle = CREAM;
  ctx.fillText(`${Math.round(f.throttle * 100)}%`, x0 + 44 + bw + 10, y0 + bh / 2);
  // Fuel bar.
  const y1 = y0 + 26;
  ctx.fillText('FUEL', x0, y1 + bh / 2);
  panel(ctx, x0 + 44, y1, bw, bh);
  const fuelFrac = f.fuel / f.mission.fuel;
  ctx.fillStyle = fuelFrac < 0.2 ? '#ff5b4d' : (fuelFrac < 0.45 ? '#ffb347' : '#7be382');
  ctx.fillRect(x0 + 46, y1 + 2, (bw - 4) * clamp(fuelFrac, 0, 1), bh - 4);
  ctx.fillStyle = CREAM;
  ctx.fillText(`${Math.round(f.fuel)}`, x0 + 44 + bw + 10, y1 + bh / 2);
  // Damage bar, only once the airframe is bent.
  if (f.damage > 0) {
    const y2 = y0 + 52;
    ctx.fillText('DMG', x0, y2 + bh / 2);
    panel(ctx, x0 + 44, y2, bw, bh);
    ctx.fillStyle = '#ff6b5e';
    ctx.fillRect(x0 + 46, y2 + 2, (bw - 4) * clamp(f.damage / 100, 0, 1), bh - 4);
    ctx.fillStyle = CREAM;
    ctx.fillText(`${Math.round(f.damage)}%`, x0 + 44 + bw + 10, y2 + bh / 2);
  }
}

function drawMission(ctx, w, h, f, time) {
  // Top-right: mission, rings, timer, score — clear of the altitude tape.
  const x0 = w - 250, y0 = 66;
  panel(ctx, x0, y0, 236, 104);
  ctx.fillStyle = '#ffd25a';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(f.mission.name, x0 + 14, y0 + 16);
  // Ring pips.
  for (let i = 0; i < 8; i++) {
    const px = x0 + 16 + i * 26, py = y0 + 42;
    ctx.fillStyle = i < f.ringsPassed ? '#7be382' : (i === f.nextRing ? '#ffd25a' : 'rgba(255,233,184,0.25)');
    ctx.beginPath(); ctx.arc(px, py, i === f.nextRing ? 9 : 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10142a';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), px, py + 0.5);
  }
  const mm = String(Math.floor(f.time / 60)).padStart(2, '0');
  const ss = String(Math.floor(f.time % 60)).padStart(2, '0');
  ctx.fillStyle = CREAM;
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`RINGS ${f.ringsPassed}/8`, x0 + 14, y0 + 72);
  ctx.fillText(`TIME ${mm}:${ss}`, x0 + 128, y0 + 72);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`SCORE ${f.score}`, x0 + 14, y0 + 96);
  void time;
}

function drawWarnings(ctx, w, h, f, time) {
  const blink = Math.floor(time * 3) % 2 === 0;
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (f.pullUpWarn && blink) {
    ctx.fillStyle = '#ff5b4d';
    ctx.fillText('▲ PULL UP ▲', w / 2, h * 0.40);
  }
  if (f.stallWarn && blink) {
    ctx.fillStyle = '#ffb347';
    ctx.fillText('STALL — NOSE DOWN, THROTTLE UP', w / 2, h * 0.44);
  }
  if (f.engineOut && f.fuel <= 0) {
    ctx.fillStyle = '#ff5b4d';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('ENGINE OUT — GLIDING', w / 2, h * 0.36);
  }
}

function drawObjectiveArrow(ctx, w, h, f, obj) {
  // A small chevron at the top of the view pointing toward the objective.
  const rel = ((obj.bearing - flightReadout(f).heading + 540) % 360) - 180;
  const cx = w / 2 + clamp(rel * 2.4, -w * 0.32, w * 0.32);
  const cy = h * 0.115;
  ctx.fillStyle = '#ffd25a';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 9, cy + 6); ctx.lineTo(cx - 9, cy + 6);
  ctx.closePath(); ctx.fill();
}

// ---------- Screens ----------

function dim(ctx, w, h, alpha) {
  ctx.fillStyle = `rgba(8,10,26,${alpha})`;
  ctx.fillRect(0, 0, w, h);
}

export function drawTitle(ctx, w, h, f, time, missionId) {
  dim(ctx, w, h, 0.42);
  const pulse = 1 + Math.sin(time * 2.4) * 0.02;
  ctx.save();
  ctx.translate(w / 2, h * 0.20);
  ctx.scale(pulse, pulse);
  ctx.translate(-w / 2, -h * 0.20);
  ctx.fillStyle = '#ffd25a';
  ctx.font = `bold ${Math.round(h * 0.075)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 16;
  ctx.fillText('EMBER ISLE', w / 2, h * 0.15);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(h * 0.042)}px sans-serif`;
  ctx.fillText('GOLDEN HOUR RUN', w / 2, h * 0.215);
  ctx.restore();
  ctx.shadowBlur = 0;
  ctx.fillStyle = CREAM;
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('A volcanic island at sunset. Eight gold rings down the valley.', w / 2, h * 0.285);
  ctx.fillText('Thread them all, then put her down gently on runway 18.', w / 2, h * 0.315);
  // Mission cards.
  const cardW = Math.min(330, w * 0.36), cardH = 92, gap = 24;
  const x0 = w / 2 - cardW - gap / 2, x1 = w / 2 + gap / 2;
  const y0 = h * 0.36;
  for (const [i, id] of ['ringRun', 'timeTrial'].entries()) {
    const m = MISSIONS[id];
    const x = i === 0 ? x0 : x1;
    const selected = missionId === id;
    ctx.fillStyle = selected ? 'rgba(255,210,90,0.22)' : PANEL;
    ctx.strokeStyle = selected ? '#ffd25a' : PANEL_LINE;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.beginPath(); ctx.roundRect(x, y0, cardW, cardH, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = selected ? '#ffd25a' : CREAM;
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${i + 1} · ${m.name}`, x + cardW / 2, y0 + 24);
    ctx.fillStyle = CREAM;
    ctx.font = '14px sans-serif';
    ctx.fillText(m.blurb, x + cardW / 2, y0 + 52, cardW - 24);
    ctx.font = '12px sans-serif';
    ctx.fillText(id === 'ringRun' ? 'Fuel 100 · Rings +250' : 'Fuel 55 · Rings +150 · Beat the clock', x + cardW / 2, y0 + 74);
  }
  // Controls footer.
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ENTER — fly the selected mission      1 / 2 — pick mission', w / 2, h * 0.58);
  ctx.fillStyle = CREAM;
  ctx.font = '15px sans-serif';
  ctx.fillText('↑ ↓ pitch · ← → bank · SHIFT throttle up · C throttle down · mouse steers too', w / 2, h * 0.625);
  ctx.fillText('R restart · P pause · M sound', w / 2, h * 0.66);
  ctx.fillStyle = '#ffb347';
  ctx.fillText('Watch the fuel. Mind the ridges — a scrape bends the jet.', w / 2, h * 0.70);
  void f;
}

export function drawPaused(ctx, w, h, f) {
  dim(ctx, w, h, 0.55);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(h * 0.06)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('PAUSED', w / 2, h * 0.42);
  ctx.fillStyle = CREAM;
  ctx.font = '17px sans-serif';
  ctx.fillText('P or ESC — resume      R — restart      M — sound', w / 2, h * 0.52);
  void f;
}

export function drawLanded(ctx, w, h, f) {
  dim(ctx, w, h, 0.5);
  ctx.fillStyle = '#7be382';
  ctx.font = `bold ${Math.round(h * 0.062)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('WHEELS DOWN — LANDED', w / 2, h * 0.30);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(`SCORE  ${f.score}`, w / 2, h * 0.42);
  ctx.fillStyle = CREAM;
  ctx.font = '18px sans-serif';
  const mm = String(Math.floor(f.time / 60)).padStart(2, '0');
  const ss = String(Math.floor(f.time % 60)).padStart(2, '0');
  ctx.fillText(`Rings ${f.ringsPassed}/8   ·   Landing quality ${f.landingQuality}%   ·   Time ${mm}:${ss}   ·   Fuel left ${Math.round(f.fuel)}`, w / 2, h * 0.50);
  ctx.fillText(f.ringsPassed === 8 ? 'A perfect run — every ring, and the runway. The island is yours.' : 'Landed safe — fly the rings next time for the full score.', w / 2, h * 0.57);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText('ENTER — fly again      R — restart', w / 2, h * 0.66);
}

export function drawCrashed(ctx, w, h, f) {
  dim(ctx, w, h, 0.55);
  ctx.fillStyle = '#ff5b4d';
  ctx.font = `bold ${Math.round(h * 0.058)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('CRASHED', w / 2, h * 0.30);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(f.crashReason, w / 2, h * 0.40);
  ctx.fillStyle = CREAM;
  ctx.font = '18px sans-serif';
  ctx.fillText(`Rings ${f.ringsPassed}/8   ·   Score ${f.score}   ·   Damage ${Math.round(f.damage)}%`, w / 2, h * 0.49);
  ctx.fillText('The valley forgives a scrape. It does not forgive the ground.', w / 2, h * 0.56);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText('ENTER or R — try again', w / 2, h * 0.65);
}

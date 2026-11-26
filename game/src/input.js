// Ember Isle — keyboard and mouse input.
// Keys: W/S or Up/Down throttle, A/D or Left/Right bank, Up/Down arrows
// also pitch the nose, P pause, R restart, 1/2/3 pick a mission, M mute.
// The mouse steers too: hold the button and move — left/right banks, up/down
// pitches. Returns a fresh input snapshot every frame; the game reads it
// and the autopilot (only under ?auto=1) can override it.
export function createInput(canvas) {
  const keys = new Set();
  const input = {
    pitch: 0,
    roll: 0,
    throttle: 0,
    mouse: { active: false, dx: 0, dy: 0 },
    pressed: new Set(),
  };

  function keyName(e) {
    return e.key.length === 1 ? e.key.toLowerCase() : e.key;
  }

  window.addEventListener('keydown', (e) => {
    const k = keyName(e);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    if (!keys.has(k)) input.pressed.add(k);
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(keyName(e));
  });
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('mousedown', (e) => {
    input.mouse.active = true;
    input.mouse.dx = 0;
    input.mouse.dy = 0;
    input.mouse.x = e.clientX;
    input.mouse.y = e.clientY;
  });
  window.addEventListener('mouseup', () => {
    input.mouse.active = false;
    input.mouse.dx = 0;
    input.mouse.dy = 0;
  });
  window.addEventListener('mousemove', (e) => {
    if (!input.mouse.active) return;
    input.mouse.dx = (e.clientX - (input.mouse.x ?? e.clientX)) / 120;
    input.mouse.dy = (e.clientY - (input.mouse.y ?? e.clientY)) / 120;
  });

  input.poll = function poll() {
    const down = (a, b) => keys.has(a) || (b && keys.has(b));
    let pitch = 0;
    let roll = 0;
    let throttle = 0;
    if (down('arrowup')) pitch += 1;
    if (down('arrowdown')) pitch -= 1;
    if (down('arrowleft', 'a')) roll -= 1;
    if (down('arrowright', 'd')) roll += 1;
    if (down('w')) throttle += 1;
    if (down('s')) throttle -= 1;
    if (down('shift')) throttle += 0.6;
    if (down('control')) throttle -= 0.6;
    if (input.mouse.active) {
      roll += Math.max(-1, Math.min(1, input.mouse.dx));
      pitch -= Math.max(-1, Math.min(1, input.mouse.dy));
    }
    input.pitch = Math.max(-1, Math.min(1, pitch));
    input.roll = Math.max(-1, Math.min(1, roll));
    input.throttle = Math.max(-1, Math.min(1, throttle));
    return input;
  };

  // One-shot keys: true once per press, consumed by the caller.
  input.take = function take(k) {
    if (input.pressed.has(k)) {
      input.pressed.delete(k);
      return true;
    }
    return false;
  };
  input.clearPressed = function clearPressed() {
    input.pressed.clear();
  };
  return input;
}

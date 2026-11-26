// Input for Ember Isle: keyboard and mouse. Arrows or WASD fly the jet,
// Shift feeds the throttle, C bleeds it, R restarts, P pauses, M mutes, and
// Enter starts. The mouse steers too: hold the button and the jet follows the
// pointer's offset from the centre of the screen.

export function createInput(canvas) {
  const input = {
    pitchUp: false, pitchDown: false,
    rollLeft: false, rollRight: false,
    throttleUp: false, throttleDown: false,
    mouseSteer: false,
    mouseX: 0, mouseY: 0,
    pressed: {}, // one-shot keys, consumed by the main loop
  };

  const KEYMAP = {
    ArrowUp: 'pitchUp', KeyW: 'pitchUp',
    ArrowDown: 'pitchDown', KeyS: 'pitchDown',
    ArrowLeft: 'rollLeft', KeyA: 'rollLeft',
    ArrowRight: 'rollRight', KeyD: 'rollRight',
    ShiftLeft: 'throttleUp', ShiftRight: 'throttleUp',
    KeyC: 'throttleDown', ControlLeft: 'throttleDown',
  };

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const held = KEYMAP[event.code];
    if (held) {
      input[held] = true;
      event.preventDefault();
    }
    input.pressed[event.code] = true;
    if (event.code === 'Space') event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    const held = KEYMAP[event.code];
    if (held) input[held] = false;
  });

  window.addEventListener('blur', () => {
    input.pitchUp = input.pitchDown = false;
    input.rollLeft = input.rollRight = false;
    input.throttleUp = input.throttleDown = false;
    input.mouseSteer = false;
  });

  canvas.addEventListener('pointerdown', (event) => {
    input.mouseSteer = true;
    input.mouseX = event.clientX;
    input.mouseY = event.clientY;
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!input.mouseSteer) return;
    input.mouseX = event.clientX;
    input.mouseY = event.clientY;
  });
  window.addEventListener('pointerup', () => { input.mouseSteer = false; });

  // Fold the mouse offset into the stick each frame: pointer right of centre
  // banks right, pointer above centre pitches up.
  input.applyMouse = function applyMouse(w, h) {
    if (!input.mouseSteer) return;
    const nx = (input.mouseX - w / 2) / (w / 2);
    const ny = (input.mouseY - h / 2) / (h / 2);
    input.rollRight = nx > 0.12;
    input.rollLeft = nx < -0.12;
    input.pitchUp = ny < -0.12;
    input.pitchDown = ny > 0.12;
  };

  input.consume = function consume(code) {
    if (input.pressed[code]) {
      delete input.pressed[code];
      return true;
    }
    return false;
  };

  input.clearPressed = function clearPressed() {
    input.pressed = {};
  };

  return input;
}

// Ember Isle — tiny WebAudio sound: engine hum tied to throttle, a chime
// for rings, and a thud for landing. Everything is synthesized; there are
// no audio files and nothing is fetched. Silent until the first gesture.
export function createAudio() {
  const audio = {
    ctx: null,
    engine: null,
    engineGain: null,
    muted: false,
    ensure() {
      if (audio.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio.ctx = new AC();
      const osc = audio.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 52;
      const filter = audio.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      audio.engineGain = audio.ctx.createGain();
      audio.engineGain.gain.value = 0;
      osc.connect(filter);
      filter.connect(audio.engineGain);
      audio.engineGain.connect(audio.ctx.destination);
      osc.start();
      audio.engine = osc;
    },
    update(throttle, speed, flying) {
      if (!audio.ctx || audio.muted) return;
      const target = flying ? 0.03 + throttle * 0.05 + speed * 0.0004 : 0;
      audio.engineGain.gain.setTargetAtTime(target, audio.ctx.currentTime, 0.2);
      if (audio.engine) {
        audio.engine.frequency.setTargetAtTime(48 + throttle * 70 + speed * 0.35, audio.ctx.currentTime, 0.15);
      }
    },
    blip(freq, dur, vol) {
      if (!audio.ctx || audio.muted) return;
      const osc = audio.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = audio.ctx.createGain();
      gain.gain.setValueAtTime(vol, audio.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(audio.ctx.destination);
      osc.start();
      osc.stop(audio.ctx.currentTime + dur);
    },
    ring() {
      audio.blip(880, 0.35, 0.16);
      setTimeout(() => audio.blip(1318, 0.4, 0.14), 90);
    },
    thud() {
      audio.blip(70, 0.3, 0.3);
    },
    toggleMute() {
      audio.muted = !audio.muted;
      if (audio.engineGain) {
        audio.engineGain.gain.value = audio.muted ? 0 : 0.05;
      }
      return audio.muted;
    },
  };
  return audio;
}

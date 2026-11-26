// Sound for Ember Isle, all synthesized with WebAudio oscillators and filtered
// noise — no audio files, no network. Engine hum follows the throttle, wind
// follows the speed, rings chime, landings thud. Silent until the first key
// press, and M mutes everything.

export function createAudio() {
  const audio = {
    ctx: null,
    muted: false,
    engineOsc: null,
    engineGain: null,
    engineFilter: null,
    windGain: null,
    windSource: null,
    started: false,
  };

  audio.unlock = function unlock() {
    if (audio.started) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      audio.ctx = ctx;
      // Engine: two detuned sawtooths through a low-pass filter.
      audio.engineOsc = ctx.createOscillator();
      audio.engineOsc.type = 'sawtooth';
      audio.engineOsc.frequency.value = 52;
      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = 78;
      audio.engineFilter = ctx.createBiquadFilter();
      audio.engineFilter.type = 'lowpass';
      audio.engineFilter.frequency.value = 320;
      audio.engineGain = ctx.createGain();
      audio.engineGain.gain.value = 0;
      audio.engineOsc.connect(audio.engineFilter);
      osc2.connect(audio.engineFilter);
      audio.engineFilter.connect(audio.engineGain);
      audio.engineGain.connect(ctx.destination);
      audio.engineOsc.start();
      osc2.start();
      audio.engineOsc2 = osc2;
      // Wind: looped noise through a band-pass filter.
      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 480;
      windFilter.Q.value = 0.6;
      audio.windGain = ctx.createGain();
      audio.windGain.gain.value = 0;
      source.connect(windFilter);
      windFilter.connect(audio.windGain);
      audio.windGain.connect(ctx.destination);
      source.start();
      audio.windSource = source;
      audio.started = true;
    } catch (err) {
      // No audio on this machine: the game plays silent.
      audio.ctx = null;
    }
  };

  audio.update = function update(throttle, speed, flying) {
    if (!audio.ctx || audio.muted) return;
    const t = audio.ctx.currentTime;
    const target = flying ? 0.028 + throttle * 0.05 : 0.0;
    audio.engineGain.gain.setTargetAtTime(target, t, 0.12);
    audio.engineOsc.frequency.setTargetAtTime(46 + throttle * 66 + speed * 0.12, t, 0.1);
    audio.engineOsc2.frequency.setTargetAtTime(69 + throttle * 99 + speed * 0.18, t, 0.1);
    audio.engineFilter.frequency.setTargetAtTime(280 + throttle * 700, t, 0.15);
    audio.windGain.gain.setTargetAtTime(flying ? Math.min(0.05, speed * 0.00022) : 0, t, 0.2);
  };

  audio.chime = function chime() {
    if (!audio.ctx || audio.muted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = audio.ctx.createOscillator();
      const gain = audio.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = audio.ctx.currentTime + i * 0.07;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.connect(gain);
      gain.connect(audio.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  };

  audio.thud = function thud(hard) {
    if (!audio.ctx || audio.muted) return;
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hard ? 90 : 60, audio.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(28, audio.ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(hard ? 0.5 : 0.25, audio.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(audio.ctx.destination);
    osc.start();
    osc.stop(audio.ctx.currentTime + 0.45);
  };

  audio.toggleMute = function toggleMute() {
    audio.muted = !audio.muted;
    if (audio.ctx) {
      const t = audio.ctx.currentTime;
      if (audio.engineGain) audio.engineGain.gain.setTargetAtTime(audio.muted ? 0 : 0.03, t, 0.05);
      if (audio.windGain) audio.windGain.gain.setTargetAtTime(0, t, 0.05);
    }
    return audio.muted;
  };

  return audio;
}

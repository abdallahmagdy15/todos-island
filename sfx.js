'use strict';
// Shared WebAudio sound-effect synth — no audio assets, everything synthesized.
// Load with <script src="sfx.js"> then window.SFX.play('complete').
// Set window.SFX.enabled from the app's soundOn setting before playing.
(function () {
  let ctx = null;
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // f: Hz, or [fromHz, toHz] glide · delay/dur: ms · type: waveform · peak: gain
  function tone(f, delay, dur, type, peak) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + delay / 1000;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    if (Array.isArray(f)) {
      osc.frequency.setValueAtTime(f[0], t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, f[1]), t0 + dur / 1000);
    } else osc.frequency.value = f;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / 1000);
    osc.connect(g).connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur / 1000 + 0.03);
  }
  const SOUNDS = {
    complete: { notes: [[523, 0, 100], [659, 85, 100], [784, 170, 100], [1047, 255, 260]], type: 'triangle', peak: 0.11 }, // achievement arpeggio C5-E5-G5-C6
    starOn:   { notes: [[440, 0, 70], [660, 60, 110]], type: 'sine', peak: 0.09 },
    starOff:  { notes: [[660, 0, 70], [440, 60, 110]], type: 'sine', peak: 0.08 },
    delete:   { glide: [300, 140], dur: 150, type: 'sawtooth', peak: 0.07 },
    add:      { notes: [[880, 0, 45], [1175, 55, 70]], type: 'sine', peak: 0.09 },
    undo:     { glide: [330, 990], dur: 160, type: 'sine', peak: 0.08 },
    pin:      { notes: [[1250, 0, 35]], type: 'sine', peak: 0.07 },
    tick:     { notes: [[950, 0, 28]], type: 'sine', peak: 0.05 },
    show:     { notes: [[660, 0, 60], [880, 70, 70]], type: 'sine', peak: 0.06 }
  };
  window.SFX = {
    enabled: true,
    play(name) {
      if (!this.enabled) return;
      const s = SOUNDS[name];
      if (!s) return;
      if (s.glide) tone(s.glide, 0, s.dur, s.type, s.peak);
      else for (const [f, d, dur] of s.notes) tone(f, d, dur, s.type, s.peak);
    }
  };
})();

// Small synthesised sounds (no audio files). Off by default.

let ctx = null;
let master = null;
let enabled = false;
let lastBit = 0;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setEnabled(on) {
  enabled = on;
  if (on) ensure();
}
export const isEnabled = () => enabled;

function tone(freq, t, attack, peak, decay, type = 'sine') {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

// a faint glassy tick as a bit settles
export function bit() {
  if (!enabled || !ensure()) return;
  const now = ctx.currentTime;
  if (now - lastBit < 0.06) return;
  lastBit = now;
  tone(2200 + Math.random() * 900, now, 0.004, 0.025, 0.12);
}

// a soft low tone when part of a fact appears
export function hum() {
  if (!enabled || !ensure()) return;
  const t = ctx.currentTime;
  tone(196, t, 0.3, 0.08, 1.6);
  tone(293.66, t + 0.08, 0.3, 0.05, 1.5);
}

// a quiet low swell while the lights go down
export function swell(seconds = 2.6) {
  if (!enabled || !ensure()) return;
  const t = ctx.currentTime;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(220, t);
  filter.frequency.linearRampToValueAtTime(700, t + seconds * 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + seconds * 0.65);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  filter.connect(g).connect(master);
  [[98, 'sawtooth'], [146.83, 'sine'], [196, 'sine'], [98.6, 'sawtooth']].forEach(([f, type]) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.connect(filter);
    o.start(t);
    o.stop(t + seconds + 0.1);
  });
}

// two gentle bell notes for the full reveal
export function chime() {
  if (!enabled || !ensure()) return;
  const t = ctx.currentTime;
  [523.25, 783.99].forEach((f, i) => {
    tone(f, t + i * 0.35, 0.01, 0.12, 2.2);
    tone(f * 2, t + i * 0.35, 0.01, 0.02, 1.2);
  });
}

// a quiet falling sweep when the jar empties
export function pour() {
  if (!enabled || !ensure()) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 5; i++) tone(1800 - i * 220, t + i * 0.06, 0.004, 0.02, 0.15);
}

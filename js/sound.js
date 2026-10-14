// Small synthesised sounds (no audio files). Off by default.
//
// Browsers only let a page start audio from inside a user gesture (tap, click,
// key). So the AudioContext is created and resumed in unlock(), which must be
// called from a gesture handler. Nothing is scheduled while the context is not
// running, otherwise the sound would be queued on a frozen clock and lost.

let ctx = null;
let master = null;
let enabled = false;
let lastBit = 0;
let keepAlive = null;

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function create() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  // a gentle compressor keeps the louder moments from clipping on small speakers
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp).connect(ctx.destination);
  return ctx;
}

// A short silent WAV, built once. Playing it through an <audio> element moves
// iOS into the "playback" audio session, so sound works with the silent switch on.
function silentWavUrl() {
  const rate = 8000, samples = 4000; // half a second
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128); // 8-bit silence
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

// Call from inside a user gesture. Resolves to true once audio is running.
export function unlock() {
  const c = create();
  if (!c) return Promise.resolve(false);

  // iPhone: let Web Audio play even when the ring/silent switch is on
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older Safari */ }
  if (isIOS && enabled) {
    if (!keepAlive) {
      keepAlive = new Audio(silentWavUrl());
      keepAlive.loop = true;
      keepAlive.setAttribute('playsinline', '');
      keepAlive.setAttribute('x-webkit-airplay', 'deny');
    }
    keepAlive.play().catch(() => {});
  }

  // older WebKit only unlocks once a sound has actually been started in the gesture
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch { /* ignore */ }

  const p = c.state === 'running' ? Promise.resolve() : c.resume();
  return Promise.resolve(p).then(() => c.state === 'running').catch(() => false);
}

export function setEnabled(on) {
  enabled = on;
  if (!on && keepAlive) keepAlive.pause();
}
export const isEnabled = () => enabled;

// Only play into a running context; if it's suspended/interrupted, ask it to resume
// (which succeeds on the next gesture) and skip this sound.
function ready() {
  if (!enabled || !ctx) return false;
  if (ctx.state !== 'running') { ctx.resume().catch(() => {}); return false; }
  return true;
}

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

const now = () => ctx.currentTime + 0.02;

// a soft glassy tick as a bit settles
export function bit() {
  if (!ready()) return;
  const t = now();
  if (t - lastBit < 0.07) return;
  lastBit = t;
  tone(1800 + Math.random() * 900, t, 0.004, 0.09, 0.09);
}

// a soft low tone when part of a fact appears
export function hum() {
  if (!ready()) return;
  const t = now();
  tone(196, t, 0.25, 0.22, 1.6);
  tone(293.66, t + 0.08, 0.25, 0.14, 1.5);
}

// a quiet low swell while the lights go down
export function swell(seconds = 2.6) {
  if (!ready()) return;
  const t = now();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(240, t);
  filter.frequency.linearRampToValueAtTime(900, t + seconds * 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + seconds * 0.65);
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

// two gentle bell notes when the fact finishes decoding
export function chime() {
  if (!ready()) return;
  const t = now();
  [523.25, 783.99].forEach((f, i) => {
    tone(f, t + i * 0.32, 0.008, 0.38, 2.0);
    tone(f * 2, t + i * 0.32, 0.008, 0.07, 1.0);
  });
}

// a short, light confirmation when sound is switched on
export function testChime() {
  if (!ready()) return;
  const t = now();
  tone(659.25, t, 0.006, 0.3, 0.5);
  tone(987.77, t + 0.11, 0.006, 0.26, 0.8);
}

// a quiet falling sweep when the jar empties
export function pour() {
  if (!ready()) return;
  const t = now();
  for (let i = 0; i < 5; i++) tone(1800 - i * 220, t + i * 0.06, 0.004, 0.07, 0.14);
}

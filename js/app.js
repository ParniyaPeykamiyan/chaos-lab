import { EntropyPool } from './entropy.js';
import { Jar } from './jar.js';
import * as sound from './sound.js';

// ---------------------------------------------------------------- settings

const TARGET = 128;          // bits to fill the jar
const STILL_MS = 1500;       // no movement for this long = "they stopped"
const MIN_PARTIAL = 0.2;     // below this, reveal nothing yet
const MIN_BIT_GAP = 28;      // ms; caps the pour at ~35 bits per second

const INPUT = {
  phone: { active: 1.1, perBit: 3.2 },  // m/s² of change between sensor readings
  mouse: { active: 2,   perBit: 36 },   // pixels travelled
  touch: { active: 1.5, perBit: 26 },
};

const LS = {
  explained: 'chaoslab.explained.v1',
  collected: 'chaoslab.collected.v1',
  sound: 'chaoslab.sound.v1',
  subject: 'chaoslab.subject.v1',
};

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------- elements

const $ = id => document.getElementById(id);
const els = {
  views: { booth: $('booth'), collection: $('collection') },
  navCollection: $('navCollection'),
  intro: $('introLine'),
  status: $('statusLine'),
  select: $('subjectSelect'),
  begin: $('beginBtn'),
  stage: $('stage'),
  canvas: $('bitsCanvas'),
  digits: $('counterDigits'),
  target: $('counterTarget'),
  partial: $('partial'),
  pSubject: $('partialSubject'),
  pText: $('partialText'),
  pPrompt: $('partialPrompt'),
  reveal: $('reveal'),
  rSubject: $('revealSubject'),
  rText: $('revealText'),
  rSource: $('revealSource'),
  rSourceLink: $('revealSourceLink'),
  rActions: $('revealActions'),
  again: $('againBtn'),
  share: $('shareBtn'),
  skip: $('skipBtn'),
  sr: $('srStatus'),
  how: $('howBtn'),
  dialog: $('explain'),
  dialogOk: $('explainOk'),
  soundBtn: $('soundBtn'),
  collTotal: $('collTotal'),
  collList: $('collList'),
  clear: $('clearBtn'),
  toast: $('toast'),
};

// ---------------------------------------------------------------- state

const pool = new EntropyPool();
const jar = new Jar(els.canvas, TARGET);

let subjects = [];
let facts = [];
const subjectById = new Map();

const state = {
  view: 'booth',
  phase: 'intro',     // intro | collecting | explaining | revealing | revealed
  mode: null,         // phone | mouse | touch
  bits: 0,
  energy: 0,
  lastBitAt: 0,
  lastActive: 0,
  stillHandled: true,
  sawMotion: false,
  fact: null,
  lockPromise: null,
  partial: false,
  shownWords: 0,
  skip: null,
};

const device = (() => {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  return {
    phoneLike: coarse && touch,
    hasMotion: typeof window.DeviceMotionEvent !== 'undefined',
    needsPermission: typeof window.DeviceMotionEvent !== 'undefined'
      && typeof DeviceMotionEvent.requestPermission === 'function',
  };
})();

// ---------------------------------------------------------------- copy

const LINES = {
  intro: { phone: 'Shake your phone to fill the jar.', mouse: 'Move your mouse to fill the jar.', touch: 'Move your finger around the jar to fill it.' },
  keep: { phone: 'Keep shaking.', mouse: 'Keep moving.', touch: 'Keep moving.' },
  rest: { phone: 'Keep shaking to reveal the rest.', mouse: 'Keep moving to reveal the rest.', touch: 'Keep moving to reveal the rest.' },
  noMotion: 'No motion sensor found. Move your finger around the jar instead.',
};

function setBody(phase) {
  state.phase = phase;
  const map = { explaining: 'collecting' };
  document.body.dataset.state = map[phase] || phase;
}

// ---------------------------------------------------------------- facts

async function loadFacts() {
  try {
    const res = await fetch('data/facts.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    subjects = data.subjects;
    facts = data.facts;
    subjects.forEach(s => subjectById.set(s.id, s));
  } catch (err) {
    els.status.textContent = 'The facts could not be loaded. Open this page through a local server.';
    els.begin.disabled = true;
    console.error(err);
    return;
  }
  els.select.innerHTML = [`<option value="any">Any subject</option>`]
    .concat(subjects.map(s => `<option value="${s.id}">${s.name}</option>`)).join('');
  const saved = store.get(LS.subject, 'any');
  els.select.value = subjectById.has(saved) ? saved : 'any';
  if (state.view === 'collection') renderCollection();
}

const collected = () => new Set(store.get(LS.collected, []));
const subjectName = fact => subjectById.get(fact.subject).name;

function chooseFact(seed) {
  const subj = els.select.value;
  const inSubject = subj === 'any' ? facts : facts.filter(f => f.subject === subj);
  const have = collected();
  const fresh = inSubject.filter(f => !have.has(f.id));
  const candidates = fresh.length ? fresh : inSubject;
  return candidates[seed.pickIndex(candidates.length)];
}

function lockFact() {
  if (!state.lockPromise) {
    els.select.disabled = true;
    state.lockPromise = pool.seal().then(seed => (state.fact = chooseFact(seed)));
  }
  return state.lockPromise;
}

// ---------------------------------------------------------------- input

function setMode(mode, note) {
  state.mode = mode;
  els.intro.textContent = LINES.intro[mode];
  if (note) setStatus(note);
}

function feed(amount, values, kind) {
  if (state.phase !== 'collecting' || state.view !== 'booth' || document.hidden) return;
  const cfg = INPUT[kind];
  if (amount < cfg.active) return;
  const now = performance.now();
  state.lastActive = now;
  if (state.stillHandled) {
    state.stillHandled = false;
    if (!state.partial) setStatus('');
  }
  const bitValue = pool.addSample(values);
  state.energy = Math.min(state.energy + amount, cfg.perBit * 2);
  if (state.energy >= cfg.perBit && now - state.lastBitAt >= MIN_BIT_GAP) {
    state.energy -= cfg.perBit;
    state.lastBitAt = now;
    addBit(bitValue);
  }
}

let prevMotion = null;
function onMotion(e) {
  const a = e.accelerationIncludingGravity || e.acceleration;
  if (!a || a.x == null) return;
  if (!state.sawMotion) {
    state.sawMotion = true;
    if (state.mode === 'touch') setMode('phone');
  }
  const r = e.rotationRate || {};
  const cur = [a.x, a.y, a.z];
  if (prevMotion) {
    const d = Math.abs(cur[0] - prevMotion[0]) + Math.abs(cur[1] - prevMotion[1]) + Math.abs(cur[2] - prevMotion[2]);
    feed(d, [...cur, r.alpha || 0, r.beta || 0, r.gamma || 0, e.timeStamp], 'phone');
  }
  prevMotion = cur;
}

const lastPointer = new Map();
function onPointerMove(e) {
  const prev = lastPointer.get(e.pointerId);
  lastPointer.set(e.pointerId, [e.clientX, e.clientY]);
  if (!prev) return;
  const d = Math.hypot(e.clientX - prev[0], e.clientY - prev[1]);
  const data = [e.clientX, e.clientY, e.movementX || 0, e.movementY || 0, e.pressure || 0, e.timeStamp];
  if (e.pointerType === 'touch') {
    if (!els.stage.contains(e.target)) return;
    feed(d, data, 'touch');
  } else {
    feed(d, data, 'mouse');
  }
}

async function begin() {
  if (sound.isEnabled()) sound.setEnabled(true); // unlock audio inside the tap

  if (device.phoneLike) {
    let granted = device.hasMotion;
    if (device.needsPermission) {
      // iPhone: must be requested directly from the tap
      try { granted = (await DeviceMotionEvent.requestPermission()) === 'granted'; }
      catch { granted = false; }
    }
    if (granted) {
      window.addEventListener('devicemotion', onMotion);
      setMode('phone');
      setTimeout(() => {
        if (!state.sawMotion && state.mode === 'phone') setMode('touch', LINES.noMotion);
      }, 2000);
    } else {
      setMode('touch', device.needsPermission ? 'Motion access was declined. Move your finger around the jar instead.' : LINES.noMotion);
    }
    els.stage.style.touchAction = 'none';
  } else {
    setMode('mouse');
  }
  startCollecting();
}

// ---------------------------------------------------------------- collecting

function startCollecting() {
  setBody('collecting');
  Object.assign(state, {
    bits: 0, energy: 0, fact: null, lockPromise: null,
    partial: false, shownWords: 0, stillHandled: true,
  });
  pool.reset();
  els.select.disabled = false;
  els.partial.hidden = true;
  document.body.classList.remove('has-partial');
  updateCounter();
}

function addBit(bitValue) {
  pool.logBit(bitValue);
  state.bits++;
  jar.addBit(bitValue);
  sound.bit();
  updateCounter();
  if (state.partial && state.fact) renderPartial();
  if (state.bits >= TARGET) fullReveal();
}

function updateCounter() {
  els.digits.textContent = state.bits;
}

function setStatus(text) {
  els.status.textContent = text;
}

async function onStill() {
  if (state.bits / TARGET < MIN_PARTIAL) {
    setStatus(LINES.keep[state.mode] || LINES.keep.mouse);
    return;
  }
  if (state.partial) return;
  setBody('explaining');
  await lockFact();
  await ensureExplained();
  if (state.phase !== 'explaining') return;
  setBody('collecting');
  state.stillHandled = true;
  showPartial();
}

// ---------------------------------------------------------------- partial reveal

// Typographic quotes for display: it's -> it’s, 'word' -> ‘word’
const smart = s => s
  .replace(/(\w)'(\w)/g, '$1’$2')
  .replace(/(^|[\s(])'/g, '$1‘')
  .replace(/'/g, '’')
  .replace(/(^|[\s(])"/g, '$1“')
  .replace(/"/g, '”');
const words = text => smart(text).split(' ');
const scrambleOf = str => str.replace(/\S/g, () => (Math.random() < 0.5 ? '0' : '1'));
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showPartial() {
  state.partial = true;
  state.shownWords = 0;
  setStatus('');
  els.pSubject.textContent = subjectName(state.fact);
  els.pPrompt.textContent = LINES.rest[state.mode] || LINES.rest.mouse;
  els.pText.innerHTML = words(state.fact.text).map(w => `<span class="w">${escapeHtml(w)}</span>`).join(' ')
    + ' <span class="scramble" aria-hidden="true"></span>';
  els.partial.hidden = false;
  document.body.classList.add('has-partial');
  renderPartial();
  sound.hum();
  els.sr.textContent = 'Part of your fact is visible. Keep going to reveal the rest.';
  requestAnimationFrame(() => els.partial.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'nearest' }));
}

// Reveal words in proportion to how full the jar is; the hidden rest shows as binary.
function renderPartial() {
  const w = words(state.fact.text);
  const show = Math.max(1, Math.min(w.length, Math.floor(w.length * (state.bits / TARGET))));
  if (show === state.shownWords) return;
  const spans = els.pText.querySelectorAll('.w');
  spans.forEach((el, i) => {
    const visible = i < show;
    el.hidden = !visible;
    if (visible && !el.classList.contains('on')) {
      if (state.shownWords > 0) el.classList.add('new');
      requestAnimationFrame(() => el.classList.add('on'));
      setTimeout(() => el.classList.remove('new'), 1400);
    }
  });
  state.shownWords = show;
  els.pText.querySelector('.scramble').textContent = scrambleOf(w.slice(show).join(' '));
}

setInterval(() => {
  if (!state.partial || state.phase !== 'collecting') return;
  const el = els.pText.querySelector('.scramble');
  if (el) el.textContent = scrambleOf(el.textContent);
}, reducedMotion.matches ? 2000 : 450);

// ---------------------------------------------------------------- full reveal

function makeSkippable() {
  const timers = new Set();
  const ctl = {
    skipped: false,
    wait(ms) {
      return new Promise(resolve => {
        if (ctl.skipped) return resolve();
        const entry = { resolve, id: setTimeout(() => { timers.delete(entry); resolve(); }, ms) };
        timers.add(entry);
      });
    },
    skip() {
      ctl.skipped = true;
      timers.forEach(t => { clearTimeout(t.id); t.resolve(); });
      timers.clear();
    },
  };
  return ctl;
}

async function fullReveal() {
  if (state.phase === 'revealing' || state.phase === 'revealed') return;
  setBody('explaining');
  await lockFact();
  await ensureExplained();
  runRevealSequence();
}

// Everything fades away, a pause, the subject appears small, then the fact fades in word by word.
async function runRevealSequence() {
  const fact = state.fact;
  const ctl = makeSkippable();
  state.skip = ctl;
  const quick = reducedMotion.matches;

  setBody('reveal');
  state.phase = 'revealing';
  els.rSubject.textContent = subjectName(fact);
  els.rSubject.classList.remove('on');
  els.rText.innerHTML = words(fact.text).map(w => `<span class="w">${escapeHtml(w)}</span>`).join(' ');
  els.rSource.hidden = true;
  els.rActions.hidden = true;
  els.reveal.hidden = false;
  els.skip.hidden = quick;

  await ctl.wait(quick ? 0 : 1100);          // fade out + pause
  els.rSubject.classList.add('on');
  sound.chime();
  await ctl.wait(quick ? 0 : 700);

  const spans = [...els.rText.querySelectorAll('.w')];
  const step = Math.max(45, Math.min(110, 1500 / spans.length));
  for (const el of spans) {
    if (ctl.skipped) break;
    el.classList.add('on');
    await ctl.wait(quick ? 0 : step);
  }
  await ctl.wait(quick ? 0 : 500);
  finishReveal();
}

function finishReveal() {
  if (state.phase === 'revealed') return;
  const fact = state.fact;
  state.skip = null;
  state.partial = false;
  setBody('revealed');
  els.skip.hidden = true;
  els.reveal.hidden = false;
  els.rSubject.classList.add('on');
  els.rText.querySelectorAll('.w').forEach(el => el.classList.add('on'));
  els.rSourceLink.href = fact.source;
  els.rSourceLink.textContent = `Source: ${fact.sourceName || new URL(fact.source).hostname}`;
  els.rSource.hidden = false;
  els.rActions.hidden = false;
  els.sr.textContent = `${subjectName(fact)}. ${fact.text}`;
  window.scrollTo(0, 0);

  const have = collected();
  if (!have.has(fact.id)) {
    have.add(fact.id);
    store.set(LS.collected, [...have]);
  }
}

function again() {
  jar.empty();
  sound.pour();
  els.reveal.hidden = true;
  setStatus('');
  startCollecting();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- explanation

function openExplain(gate) {
  els.dialogOk.textContent = gate ? 'Continue' : 'Close';
  return new Promise(resolve => {
    els.dialog.addEventListener('close', () => { store.set(LS.explained, true); resolve(); }, { once: true });
    els.dialog.showModal();
  });
}

function ensureExplained() {
  if (store.get(LS.explained, false)) return Promise.resolve();
  return openExplain(true);
}

// ---------------------------------------------------------------- share, toast, sound

async function shareFact() {
  const fact = state.fact;
  if (!fact) return;
  const url = location.origin + location.pathname;
  const text = `${fact.text}\n\n(${subjectName(fact)}, via Chaos Lab) ${url}`;
  // phones: the native share sheet (it also offers Copy)
  if (device.phoneLike && navigator.share) {
    try { await navigator.share({ title: 'Chaos Lab', text: `${fact.text}\n\n(${subjectName(fact)}, via Chaos Lab)`, url }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  toast(ok ? 'Copied fact and link' : 'Copying was blocked by the browser');
}

let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-on'), 2200);
}

function renderSoundBtn() {
  const on = sound.isEnabled();
  els.soundBtn.setAttribute('aria-pressed', String(on));
  els.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
}

// ---------------------------------------------------------------- collection

function renderCollection() {
  const have = collected();
  const got = facts.filter(f => have.has(f.id)).length;
  els.collTotal.textContent = `${got} of ${facts.length} facts`;
  els.collList.innerHTML = subjects.map(s => {
    const all = facts.filter(f => f.subject === s.id);
    const mine = all.filter(f => have.has(f.id));
    const pct = all.length ? (mine.length / all.length) * 100 : 0;
    const list = mine.length
      ? `<ul class="subj__facts">${mine.map(f => `<li>${escapeHtml(smart(f.text))}<a href="${escapeHtml(f.source)}" target="_blank" rel="noopener">source</a></li>`).join('')}</ul>`
      : `<p class="subj__empty">None yet.</p>`;
    return `<details class="subj">
      <summary>
        <span class="subj__name">${escapeHtml(s.name)}</span>
        <span class="subj__count">${mine.length} / ${all.length}</span>
        <span class="subj__bar" role="progressbar" aria-label="${escapeHtml(s.name)}" aria-valuemin="0" aria-valuemax="${all.length}" aria-valuenow="${mine.length}"><span style="width:${pct}%"></span></span>
      </summary>
      ${list}
    </details>`;
  }).join('');
}

// ---------------------------------------------------------------- routing

function route() {
  const view = location.hash === '#collection' ? 'collection' : 'booth';
  state.view = view;
  document.body.dataset.view = view;
  Object.entries(els.views).forEach(([k, el]) => { el.hidden = k !== view; });
  // the nav's first link toggles between the jar and the collection
  els.navCollection.textContent = view === 'collection' ? 'Jar' : 'Collection';
  els.navCollection.href = view === 'collection' ? '#' : '#collection';
  if (view === 'collection') renderCollection();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- main loop

function loop(now) {
  jar.draw(now);
  if (state.phase === 'collecting' && state.bits > 0 && !state.stillHandled && now - state.lastActive > STILL_MS) {
    state.stillHandled = true;
    onStill();
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- wiring

function init() {
  els.target.textContent = TARGET;
  els.intro.textContent = device.phoneLike ? LINES.intro.phone : LINES.intro.mouse;

  sound.setEnabled(store.get(LS.sound, false) === true);
  renderSoundBtn();

  els.begin.addEventListener('click', begin);
  els.again.addEventListener('click', again);
  els.share.addEventListener('click', shareFact);
  els.skip.addEventListener('click', () => state.skip && state.skip.skip());
  els.how.addEventListener('click', () => openExplain(false));
  els.select.addEventListener('change', () => store.set(LS.subject, els.select.value));
  els.soundBtn.addEventListener('click', () => {
    sound.setEnabled(!sound.isEnabled());
    store.set(LS.sound, sound.isEnabled());
    renderSoundBtn();
    if (sound.isEnabled()) sound.chime();
  });
  els.clear.addEventListener('click', () => {
    if (confirm('Clear every fact from your collection?')) {
      store.set(LS.collected, []);
      renderCollection();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.skip) state.skip.skip();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', e => lastPointer.delete(e.pointerId));
  window.addEventListener('pointercancel', e => lastPointer.delete(e.pointerId));

  route();
  loadFacts();
  requestAnimationFrame(loop);
}

init();

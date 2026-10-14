// Draws small monochrome 0s and 1s settling quietly into the jar.
// Everything is drawn in the jar SVG's own coordinate space (viewBox -10 0 250 290).

const VB = { x: -10, y: 0, w: 250, h: 290 };
const INNER = { left: 36, right: 164, top: 104, bottom: 254 };
const COLS = 12;
const GLASS = new Path2D('M64 52 C64 70 28 74 28 102 L28 236 Q28 262 54 262 L146 262 Q172 262 172 236 L172 102 C172 74 136 70 136 52 Z');

const easeOut = t => 1 - (1 - t) * (1 - t) * (1 - t);
const rand = (a, b) => a + Math.random() * (b - a);

export class Jar {
  constructor(canvas, capacity) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.capacity = capacity;
    this.rows = Math.ceil(capacity / COLS);
    this.cellW = (INNER.right - INNER.left) / COLS;
    this.cellH = (INNER.bottom - INNER.top) / this.rows;
    this.bits = [];
    this.leaving = [];
    this.heights = new Array(COLS).fill(0);
    this.sprites = null;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.buildSprites());
    if (document.fonts) document.fonts.ready.then(() => this.buildSprites());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scale = this.canvas.width / VB.w;
    this.buildSprites();
  }

  // Glyphs are pre-rendered once per size/theme in the current text colour.
  buildSprites() {
    if (!this.scale) return;
    const color = getComputedStyle(this.canvas).color;
    const px = Math.max(6, Math.round(this.cellH * 0.78 * this.scale));
    const size = Math.ceil(px * 1.4);
    this.sprites = ['0', '1'].map(ch => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `${px}px "IBM Plex Mono", ui-monospace, monospace`;
      g.fillStyle = color;
      g.fillText(ch, size / 2, size / 2 + 0.5);
      return c;
    });
    this.spriteSize = size / this.scale;
  }

  get count() { return this.bits.length; }

  addBit(value) {
    if (this.bits.length >= this.capacity) return;
    const min = Math.min(...this.heights);
    const options = [];
    this.heights.forEach((h, i) => { if (h === min && h < this.rows) options.push(i); });
    const col = options[Math.floor(Math.random() * options.length)];
    const row = this.heights[col]++;
    const tx = INNER.left + this.cellW * (col + 0.5);
    const ty = INNER.bottom - this.cellH * (row + 0.5);
    this.bits.push({
      value, tx, ty,
      sx: rand(80, 120), sy: rand(30, 46),
      born: performance.now(),
      dur: rand(900, 1300),
    });
  }

  // Stillness: any bit still falling lands immediately.
  settleAll() {
    const now = performance.now();
    for (const b of this.bits) b.born = Math.min(b.born, now - b.dur);
  }

  // Hand every bit over (in screen coordinates) and leave the jar empty.
  takeAll() {
    const r = this.canvas.getBoundingClientRect();
    const toScreen = (x, y) => ({
      x: r.left + ((x - VB.x) / VB.w) * r.width,
      y: r.top + ((y - VB.y) / VB.h) * r.height,
    });
    const bits = this.bits.map(b => ({ ...toScreen(b.tx, b.ty), value: b.value }));
    this.bits = [];
    this.leaving = [];
    this.heights.fill(0);
    const size = this.cellH * 0.78 * (r.width / VB.w);
    return { bits, mouth: toScreen(100, 30), size };
  }

  empty() {
    const now = performance.now();
    this.leaving = this.bits.map(b => ({ ...b, gone: now }));
    this.bits = [];
    this.heights.fill(0);
  }

  draw(now) {
    const { ctx, canvas, sprites } = this;
    if (!this.scale) return;
    // follow the text colour (it glides when the lights go down)
    if (!this.colorCheck || now - this.colorCheck > 120) {
      this.colorCheck = now;
      const c = getComputedStyle(canvas).color;
      if (c !== this.color) { this.color = c; this.buildSprites(); }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sprites) return;
    const s = this.scale;
    ctx.setTransform(s, 0, 0, s, -VB.x * s, -VB.y * s);
    const half = this.spriteSize / 2;

    ctx.save();
    ctx.clip(GLASS);
    for (const b of this.bits) {
      const t = Math.min(1, (now - b.born) / b.dur);
      const e = easeOut(t);
      const x = b.sx + (b.tx - b.sx) * e;
      const y = b.sy + (b.ty - b.sy) * e;
      ctx.globalAlpha = t < 1 ? Math.min(1, t * 2.5) * 0.7 : 0.7;
      ctx.drawImage(sprites[b.value], x - half, y - half, half * 2, half * 2);
    }
    // emptied bits simply fade where they lie
    if (this.leaving.length) {
      const keep = [];
      for (const b of this.leaving) {
        const age = now - b.gone;
        if (age > 800) continue;
        keep.push(b);
        ctx.globalAlpha = 0.7 * (1 - age / 800);
        ctx.drawImage(sprites[b.value], b.tx - half, b.ty - half, half * 2, half * 2);
      }
      this.leaving = keep;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

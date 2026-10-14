// Full-screen layer for the reveal: the bits rise out of the jar's mouth and
// drift to the words they will become, then fade as each word decodes.

const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rand = (a, b) => a + Math.random() * (b - a);

export class Flight {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bits = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  get active() { return this.bits.length > 0; }

  // bits: [{x, y, value}] in screen coordinates
  // mouth: {x, y} screen point of the jar's opening
  // wordRects: DOMRects of the (still invisible) words of the fact
  launch(bits, mouth, wordRects, now, size = 9) {
    this.size0 = size;
    const n = bits.length;
    // the topmost bits leave first, like a jar being poured upward
    const order = bits.map((b, i) => i).sort((a, b) => bits[a].y - bits[b].y);
    this.bits = order.map((idx, rank) => {
      const b = bits[idx];
      const word = Math.floor((rank / n) * wordRects.length);
      const r = wordRects[Math.min(word, wordRects.length - 1)];
      return {
        value: b.value,
        word,
        x0: b.x, y0: b.y,
        // out through the mouth, curving up and over toward the words
        cx: mouth.x + rand(-30, 30),
        cy: Math.min(mouth.y, r.top) - rand(50, 130),
        x1: rand(r.left + 2, r.right - 2),
        y1: rand(r.top + r.height * 0.25, r.bottom - r.height * 0.25),
        start: now + (rank / n) * 550 + rand(0, 100),
        dur: rand(1000, 1300),
        fadeAt: Infinity,
        drift: rand(0, Math.PI * 2),
      };
    });
  }

  fadeWord(word, now) {
    for (const b of this.bits) if (b.word === word && b.fadeAt === Infinity) b.fadeAt = now;
  }

  clear() { this.bits = []; this.draw(performance.now()); }

  draw(now) {
    const { ctx, canvas, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.bits.length) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(canvas).color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const keep = [];
    for (const b of this.bits) {
      let alpha = 0.75;
      if (b.fadeAt !== Infinity) {
        const f = (now - b.fadeAt) / 380;
        if (f >= 1) continue;
        alpha *= 1 - f;
      }
      keep.push(b);
      const t = Math.max(0, Math.min(1, (now - b.start) / b.dur));
      const e = easeInOut(t), u = 1 - e;
      let x = u * u * b.x0 + 2 * u * e * b.cx + e * e * b.x1;
      let y = u * u * b.y0 + 2 * u * e * b.cy + e * e * b.y1;
      if (t >= 1) { // hover gently while waiting to be decoded
        x += Math.sin(now / 600 + b.drift) * 1.2;
        y += Math.cos(now / 700 + b.drift) * 1.2;
      }
      // glyphs grow slightly as they reach the words
      const px = this.size0 + (12 - this.size0) * e;
      ctx.font = `${px.toFixed(1)}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.globalAlpha = alpha;
      ctx.fillText(b.value ? '1' : '0', x, y);
    }
    this.bits = keep;
    ctx.globalAlpha = 1;
  }
}

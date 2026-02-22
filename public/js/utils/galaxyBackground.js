/**
 * Signal Aurora — Background Animation
 *
 * Three layers:
 *  1. CSS aurora blobs  — purple/violet gradients drifting behind the UI
 *  2. Cursor glow       — subtle radial light that follows the mouse
 *  3. Ripple canvas     — broadcast-signal pulse rings on click + idle ambient pulses
 */
class SignalAurora {
  constructor() {
    this.canvas  = null;
    this.ctx     = null;
    this.ripples = [];
    this.idleTimer   = null;
    this.rafId       = null;
    this.lastInteract = Date.now();
    this.init();
  }

  init() {
    this.canvas = document.getElementById('bg-ripple');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    this.bindEvents();
    this.scheduleIdlePulse();
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  bindEvents() {
    // Update CSS custom properties so the cursor glow follows the mouse
    window.addEventListener('mousemove', e => {
      document.documentElement.style.setProperty('--cursor-x', e.clientX + 'px');
      document.documentElement.style.setProperty('--cursor-y', e.clientY + 'px');
    }, { passive: true });

    // Emit a ripple on every click
    window.addEventListener('click', e => {
      this.lastInteract = Date.now();
      this.addRipple(e.clientX, e.clientY, 0.58);
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.resize(), 150);
    });
  }

  /**
   * Push a ripple onto the queue.
   * @param {number} x
   * @param {number} y
   * @param {number} alpha  initial opacity
   */
  addRipple(x, y, alpha = 0.38) {
    this.ripples.push({
      x, y,
      r:    0,
      maxR: 170 + Math.random() * 90,
      alpha,
    });
  }

  /**
   * Every 4–8 s, if the user hasn't interacted for 3 s, spawn a quiet
   * ambient pulse from a random position — makes the background feel alive.
   */
  scheduleIdlePulse() {
    const delay = 4000 + Math.random() * 4000;
    this.idleTimer = setTimeout(() => {
      if (this.canvas && Date.now() - this.lastInteract > 3000) {
        const x = this.canvas.width  * (0.15 + Math.random() * 0.70);
        const y = this.canvas.height * (0.15 + Math.random() * 0.70);
        this.addRipple(x, y, 0.20);
      }
      this.scheduleIdlePulse();
    }, delay);
  }

  loop() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    this.ripples = this.ripples.filter(r => r.alpha > 0.003);

    for (const r of this.ripples) {
      // Ease: start fast, slow as the ring approaches max radius
      const progress = r.r / r.maxR;
      r.r    += 2.4 + (1 - progress) * 1.6;
      r.alpha *= 0.953;

      // Outer ring — primary purple
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(177, 20, 255, ${r.alpha})`;
      ctx.lineWidth   = 1.3;
      ctx.stroke();

      // Inner trailing ring — lighter violet, appears once outer ring has expanded
      if (r.r > 26) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r - 20, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(212, 91, 255, ${r.alpha * 0.28})`;
        ctx.lineWidth   = 0.7;
        ctx.stroke();
      }
    }

    this.rafId = requestAnimationFrame(() => this.loop());
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.idleTimer);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.signalAurora = new SignalAurora();
  }
});


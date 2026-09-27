'use strict';
// window.Motion — tiny WAAPI wrapper. The CSS reduced-motion rule does NOT reach el.animate(), so it is gated here.
// play() always returns a Promise and resolves instantly under reduced motion, so callers can await it unconditionally.
(() => {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const EASE_OUT = 'cubic-bezier(.22, 1, .36, 1)';
  window.Motion = {
    EASE_OUT,
    EASE_IN: 'cubic-bezier(.4, 0, 1, 1)',
    get reduced() { return mq.matches; },
    play(el, frames, opts) {
      if (!el || mq.matches || !el.animate) return Promise.resolve();
      return el.animate(frames, { easing: EASE_OUT, fill: 'forwards', ...opts }).finished.catch(() => {});
    },
    // Apple-style spring (damping = 1 − bounce, response in seconds) → progress fn of t (s), overshoot allowed.
    // Sample it into keyframes with easing 'linear' — that keeps X and Y on independent springs.
    spring({ bounce = 0, response = 0.4 } = {}) {
      const z = 1 - bounce, w0 = 2 * Math.PI / response;
      if (z >= 1) return t => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
      const wd = w0 * Math.sqrt(1 - z * z);
      return t => 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
    },
    // small horizontal nudge for "can't do that" (no bounce — two short shifts, linear)
    nudge(el) {
      return this.play(el, [
        { transform: 'translateX(0)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' },
        { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }
      ], { duration: 160, easing: 'linear', fill: 'none' });
    }
  };
})();

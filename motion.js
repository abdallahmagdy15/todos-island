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
    // small horizontal nudge for "can't do that" (no bounce — two short shifts, linear)
    nudge(el) {
      return this.play(el, [
        { transform: 'translateX(0)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' },
        { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }
      ], { duration: 160, easing: 'linear', fill: 'none' });
    }
  };
})();

'use strict';
// Image attachment lines (owner 2026-11-12, E2a): a pasted screenshot becomes a FILE in <userData>/images and ONE
// Markdown link line in the note — "[🖼 img-k3x9q2](file:///C:/…/images/img-k3x9q2.png)" as a description line under
// the subtask (or the task). The app reads only the NAME from that line and finds the file in ITS folder; it never
// trusts the path in the note. Pure + dual-mode like lib/share.js (window.ImgLines / module.exports): no fs, no electron.
(() => {
  const NAME_RE = /^img-[0-9a-z]{6}$/;
  // a line that is ONLY the link: leading/trailing whitespace allowed, no text around it. \uFE0F? = the variation
  // selector the Windows emoji picker appends, so a hand-typed line reads too
  const LINE_RE = /^\s*\[🖼\uFE0F? (img-[0-9a-z]{6})\]\([^"]*\)\s*$/u;
  const isImageLine = text => LINE_RE.test(String(text || ''));
  const imageName = text => { const m = String(text || '').match(LINE_RE); return m ? m[1] : null; };
  // dir is a Windows path ("C:\Users\Me X\…\images"): the drive segment stays, every other segment gets
  // encodeURIComponent (spaces → %20), forward slashes, then "/<name>.png" — Obsidian opens it as a file:// link
  function imageLine(name, dir) {
    const segs = String(dir || '').split(/[\\/]/).filter(s => s !== '');
    const url = segs.map((s, i) => i === 0 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)).join('/');
    return `[🖼 ${name}](file:///${url}/${name}.png)`;
  }
  // description lines in → { text: the non-image lines, images: the link names in order }
  function split(lines) {
    const text = [], images = [];
    for (const l of lines || []) { const n = imageName(l); if (n) images.push(n); else text.push(l); }
    return { text, images };
  }
  // 'img-' + 6 random chars [0-9a-z], retried until taken(name) is false (max 50, then throw).
  // Math.random, not crypto: it runs in renderers too.
  function newName(taken) {
    const CH = '0123456789abcdefghijklmnopqrstuvwxyz';
    for (let tries = 0; tries < 50; tries++) {
      let n = 'img-';
      for (let i = 0; i < 6; i++) n += CH[Math.floor(Math.random() * CH.length)];
      if (!taken || !taken(n)) return n;
    }
    throw new Error('images: no free name in 50 tries');
  }
  const API = { NAME_RE, LINE_RE, isImageLine, imageName, imageLine, split, newName };
  if (typeof window !== 'undefined') window.ImgLines = API;
  if (typeof module !== 'undefined') module.exports = API;
})();

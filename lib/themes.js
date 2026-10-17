// themes.js — theme presets (owner 2026-10-17, demo design-demos/theme-presets.html). Pure; dual mode like the locales:
// the windows read window.THEMES (Settings → Look tiles, UI.applyTheme), main.js require()s it (validation, defaults).
// A theme is a set of SETTINGS values; picking one writes them. Which theme is "on" is DERIVED from the settings
// (themeOf), never stored, so it can't drift: change any knob in Advanced → Customize theme and it reads Custom.
// Notebook (paper) themes are Frosted only — never glossy (owner rule 2026-10-17): normalize() forces it.
(function () {
  const PAPER = ['dot', 'kraft'];
  // the paper knobs and their allowed values (first = default for a fresh install / a bad value)
  const OPTIONS = {
    paperHand: ['architects', 'shantell', 'caveat', 'gochi'],
    paperHandAr: ['marhey', 'ruqaa'],
    paperPattern: ['fibers', 'dots', 'lines', 'plain'],
    kraftShadeLight: ['light', 'lighter'], // kraft dark has one shade
    dotShadeLight: ['warm', 'today'],
    dotShadeDark: ['slate', 'today'],
  };
  const DEFAULTS = Object.fromEntries(Object.entries(OPTIONS).map(([k, v]) => [k, v[0]]));
  const SHADE_KEYS = { kraft: ['kraftShadeLight'], dot: ['dotShadeLight', 'dotShadeDark'] };
  const PAPER_COMMON = ['paperHand', 'paperHandAr', 'paperPattern'];
  const THEMES = [
    { id: 'kraft-notebook', kind: 'paper', en: 'Kraft Notebook', ar: 'دفتر كرافت',
      v: { islandTheme: 'kraft', accent: 'graphite', material: 'frosted', kraftShadeLight: 'light', paperPattern: 'fibers', paperHand: 'architects', paperHandAr: 'marhey' } },
    { id: 'dot-journal', kind: 'paper', en: 'Dot Journal', ar: 'دفتر منقّط',
      v: { islandTheme: 'dot', accent: 'blue', material: 'frosted', dotShadeLight: 'warm', dotShadeDark: 'slate', paperPattern: 'dots', paperHand: 'shantell', paperHandAr: 'marhey' } },
    { id: 'mist', kind: 'glass', en: 'Mist', ar: 'ضباب', v: { islandTheme: 'mist', accent: 'blue', material: 'liquid', glassLevel: 3 } },
    { id: 'dusk', kind: 'glass', en: 'Dusk', ar: 'غسق', v: { islandTheme: 'dusk', accent: 'violet', material: 'liquid', glassLevel: 3 } },
    { id: 'lagoon', kind: 'glass', en: 'Lagoon', ar: 'بحيرة', v: { islandTheme: 'lagoon', accent: 'teal', material: 'liquid', glassLevel: 3 } },
    { id: 'bloom', kind: 'glass', en: 'Bloom', ar: 'زهر', v: { islandTheme: 'bloom', accent: 'pink', material: 'liquid', glassLevel: 3 } },
    { id: 'dune', kind: 'glass', en: 'Dune', ar: 'كثبان', v: { islandTheme: 'dune', accent: 'graphite', material: 'liquid', glassLevel: 3 } },
  ];
  const isPaper = s => PAPER.includes(s && s.islandTheme);
  // the theme these settings ARE (every value the theme sets matches), else null = Custom
  const themeOf = s => (THEMES.find(t => Object.entries(t.v).every(([k, v]) => s[k] === v)) || null);
  const byId = id => THEMES.find(t => t.id === id) || null;
  // the settings patch picking a theme writes
  const patchFor = id => { const t = byId(id); return t ? { ...t.v } : null; };
  // a bad / missing paper knob → its default; a paper theme → Frosted (never glossy). Returns a NEW object.
  function normalize(s) {
    const o = { ...s };
    for (const [k, list] of Object.entries(OPTIONS)) if (!list.includes(o[k])) o[k] = DEFAULTS[k];
    if (isPaper(o)) o.material = 'frosted';
    return o;
  }
  // the html attributes UI.applyTheme sets (null = not a paper theme: remove them all)
  function attrs(s) {
    if (!isPaper(s)) return null;
    const o = normalize(s), kraft = o.islandTheme === 'kraft';
    return {
      hand: o.paperHand, handAr: o.paperHandAr, pattern: o.paperPattern,
      shadeL: (kraft ? o.kraftShadeLight === 'lighter' : o.dotShadeLight === 'today') ? 'alt' : '',
      shadeD: (!kraft && o.dotShadeDark === 'today') ? 'alt' : '',
    };
  }
  const api = { PAPER, OPTIONS, DEFAULTS, SHADE_KEYS, PAPER_COMMON, THEMES, isPaper, themeOf, byId, patchFor, normalize, attrs };
  if (typeof window !== 'undefined') window.THEMES = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

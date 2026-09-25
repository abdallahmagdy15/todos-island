'use strict';
// Locale resolution + string lookup + document application. Dual-mode: window.I18N (renderer, after
// the locales/*.js script tags) or require() from main/tests. Notation never translates.
(() => {
  const byRequire = typeof require === 'function' ? (() => {
    try { return { en: require('../locales/en.js'), ar: require('../locales/ar.js') }; }
    catch (e) { return null; }
  })() : null;
  const REG = (typeof window !== 'undefined' && window.LOCALES) || (byRequire || {});

  const SUPPORTED = ['en', 'ar']; // add a locales/<code>.js + one entry here — nothing else moves
  function resolveLang(setting, systemLocale) {
    const s = String(setting || 'system').toLowerCase();
    if (SUPPORTED.includes(s)) return s;
    return String(systemLocale || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
  }
  function t(lang, key, params) {
    const dict = REG[lang] || REG.en || {};
    let s = dict[key] !== undefined ? dict[key] : (REG.en && REG.en[key]);
    if (s === undefined) return key; // missing everywhere — show the key, never crash
    if (params) for (const [k, v] of Object.entries(params)) s = s.split('{' + k + '}').join(String(v));
    return s;
  }
  const dirOf = lang => (lang === 'ar' ? 'rtl' : 'ltr');

  // Renderer: apply to the live document — data-i18n (text), data-i18n-ph (placeholder),
  // data-i18n-title (title), data-i18n-aria (aria-label). Sets <html lang/dir> for RTL.
  function applyDoc(lang) {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(lang, el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(lang, el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(lang, el.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(lang, el.dataset.i18nAria)); });
  }

  const I18N = { SUPPORTED, resolveLang, t, dirOf, applyDoc };
  if (typeof window !== 'undefined') window.I18N = I18N;
  if (typeof module !== 'undefined') module.exports = I18N;
})();

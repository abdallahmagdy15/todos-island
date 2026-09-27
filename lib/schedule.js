'use strict';
// Pure scheduling brain — when should the island next pop?
// Three modes for "now":
//   night — before today's dayStart (any day): quiet till dayStart; midnight caps evening reminders, so no 3 AM pops
//   off   — after dayEnd, or a weekend when weekendAware (weekend = personal time)
//   work  — inside dayStart..dayEnd; weekends count as workdays only when weekendAware is off
// weekend days (JS getDay: 0 = Sun … 6 = Sat). settings.weekendDays is already resolved by main ('auto' → the region's).
const WEEKENDS = { 'sat-sun': [6, 0], 'fri-sat': [5, 6] };
const isWeekend = (settings, date) => (WEEKENDS[settings.weekendDays] || WEEKENDS['sat-sun']).includes(date.getDay());
function nextFireAt(settings, lastShown, now) {
  const d = now instanceof Date ? now : new Date(now);
  const [sh, sm] = String(settings.dayStart).split(':').map(Number);
  const [eh, em] = String(settings.dayEnd).split(':').map(Number);
  const s = new Date(d); s.setHours(sh, sm, 0, 0);
  const e = new Date(d); e.setHours(eh, em, 0, 0);
  if (d < s) return s.getTime(); // night → next event is the day starting
  const weekend = settings.weekendAware && isWeekend(settings, d);
  if (weekend || d > e) {
    if (settings.offRemindersOn !== false) {
      const nf = Math.max(lastShown + settings.offIntervalMin * 60000, d.getTime());
      const nd = new Date(nf);
      if (nd.getDate() !== d.getDate() || nd.getMonth() !== d.getMonth()) {
        // crossed midnight — evening is over; resume at tomorrow's dayStart (no 00:00 pops or bogus tooltips)
        const t = new Date(s); t.setDate(t.getDate() + 1);
        return t.getTime();
      }
      return nf;
    }
    // off reminders disabled → sleep till the next real workday start (e.g. Fri eve → Mon, or Thu eve → Sun)
    const t = new Date(s); t.setDate(t.getDate() + 1);
    if (settings.weekendAware) while (isWeekend(settings, t)) t.setDate(t.getDate() + 1);
    return t.getTime();
  }
  if (settings.workRemindersOn !== false) {
    return Math.max(lastShown + settings.workIntervalMin * 60000, d.getTime());
  }
  return e.getTime(); // work reminders off but off-hours on → transition exactly at dayEnd
}

module.exports = { nextFireAt, isWeekend, WEEKENDS };

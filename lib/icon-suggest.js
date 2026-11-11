// icon-suggest.js — suggested task icons from a title (M6, owner 2026-11-11). Pure and tiny on purpose: it runs once
// when the picker opens, over ~146 icons and the title's few words (well under 1 ms).
// Dual mode like task-icons.js: the windows read window.ICON_SUGGEST; tests require() it.
//
// Score per icon = the best hit among the title's words: a GLOSSARY word that names it = 3 · a word that IS one of the
// icon's own words (n / en / ar / k) = 2 · a shared start of 4+ letters (develop ↔ developer) = 1. Ties go to the icon
// you use most (counts). When fewer than `n` icons score, the rest fill with your most-used icons that are not already
// in Recent (owner pick). Arabic is compared normalized (أإآ→ا, ة→ه, ى→ي, a leading ال / وال dropped).
(function () {
  // the owner's recurring words (from both notes, 2026-11-11) → the icon that means them. Keys are normalized (norm()).
  const GLOSSARY = {
    // dev
    publish: 'publish', release: 'deploy', deploy: 'deploy', ship: 'deploy', live: 'deploy',
    bug: 'fix', bugs: 'fix', fix: 'fix', fixes: 'fix', error: 'fix', hotfix: 'fix', crash: 'fix', failed: 'fix',
    refactor: 'refactor', cleanup: 'refactor', restructure: 'refactor',
    develop: 'code', development: 'code', implement: 'code', feature: 'code', code: 'code', build: 'code', coding: 'code',
    review: 'review', test: 'test', testing: 'test', tests: 'test', verify: 'test',
    docs: 'docs', document: 'docs', documentation: 'docs', readme: 'docs',
    setup: 'tool', install: 'tool', harness: 'tool', tools: 'tool',
    server: 'server', database: 'data', sql: 'data', table: 'data',
    integration: 'api', integrate: 'api', api: 'api', endpoint: 'api', webhook: 'api',
    connect: 'link', link: 'link', url: 'link',
    workflow: 'workflow', automation: 'workflow', automate: 'workflow', plugin: 'workflow',
    config: 'config', settings: 'config', configuration: 'config',
    sync: 'sync', update: 'sync', updates: 'sync', upgrade: 'sync',
    website: 'web', web: 'web', crawl: 'crawl', scrape: 'crawl', crawler: 'crawl',
    laptop: 'laptop', mobile: 'mobile', android: 'mobile', ios: 'mobile',
    antivirus: 'antivirus', acronis: 'antivirus', virus: 'antivirus', security: 'security', permission: 'security', permissions: 'security',
    backup: 'backup', network: 'network', wifi: 'network', cloud: 'cloud', azure: 'cloud',
    model: 'localai', llm: 'localai', ai: 'ai', pc: 'devices', db: 'data', qa: 'test', ui: 'design', ux: 'design', log: 'terminal', logs: 'terminal', check: 'test', gpu: 'localai', local: 'localai',
    // business
    quotation: 'invoice', quote: 'invoice', invoice: 'invoice', contract: 'contract', contracts: 'contract',
    payment: 'pay', pay: 'pay', salary: 'payroll', payroll: 'payroll',
    employee: 'employee', employees: 'employee', recruitment: 'hire', recruit: 'hire', hiring: 'hire', hire: 'hire', candidate: 'hire',
    bank: 'bank', money: 'wallet', budget: 'wallet', rich: 'growth', invest: 'growth', profit: 'growth', sales: 'growth',
    report: 'report', reports: 'report', dashboard: 'analytics', analytics: 'analytics', stats: 'analytics',
    ticket: 'ticket', tickets: 'ticket', issue: 'ticket', legal: 'legal', law: 'legal',
    // talk
    meeting: 'meeting', meet: 'meeting', call: 'call', phone: 'call', email: 'email', mail: 'email', reply: 'reply',
    discuss: 'discuss', discussion: 'discuss', brainstorming: 'brainstorm', chat: 'chat', message: 'chat',
    leader: 'lead', manager: 'lead', boss: 'lead', present: 'present', presentation: 'present', demo: 'present',
    // learn
    research: 'research', study: 'study', learn: 'study', learning: 'study', course: 'study', read: 'read', book: 'read',
    brainstorm: 'brainstorm', idea: 'idea', ideas: 'idea', agent: 'ai', claude: 'ai', gpt: 'ai',
    goal: 'goal', goals: 'goal', plan: 'goal', planning: 'goal', strategy: 'strategy', theory: 'strategy', game: 'strategy',
    interview: 'interview', skill: 'skill', skills: 'skill', notes: 'notes', obsidian: 'notes',
    // content
    post: 'post', reddit: 'post', linkedin: 'linkedin', write: 'write', writing: 'write', article: 'write', blog: 'write',
    video: 'motion', motion: 'motion', animation: 'motion', design: 'design', photo: 'photo', portfolio: 'portfolio', gallery: 'portfolio',
    stream: 'stream', streaming: 'stream', voice: 'voice', record: 'voice', recording: 'voice', audio: 'audio', podcast: 'audio',
    // life
    shop: 'shop', buy: 'shop', shopping: 'shop', doctor: 'doctor', clinic: 'doctor', medicine: 'medicine', gym: 'workout', workout: 'workout',
    travel: 'travel', trip: 'travel', flight: 'travel', car: 'car', gift: 'gift', clean: 'clean', cook: 'cook', family: 'love',
    coffee: 'coffee', sleep: 'sleep', haircut: 'haircut', repair: 'repair', maintenance: 'repair', delivery: 'delivery',
    // marks
    urgent: 'urgent', asap: 'urgent', critical: 'urgent', remind: 'remind', reminder: 'remind', wait: 'wait', waiting: 'wait',
    pending: 'wait', blocked: 'blocked', stuck: 'blocked', question: 'question', ask: 'question',
    // Arabic (normalized: ة→ه, أإآ→ا, ى→ي, no leading ال)
    'نشر': 'publish', 'اصلاح': 'fix', 'باج': 'fix', 'مشكله': 'fix', 'خطا': 'fix', 'تطوير': 'code', 'كود': 'code', 'برمجه': 'code',
    'مراجعه': 'review', 'اختبار': 'test', 'تجربه': 'test', 'توثيق': 'docs', 'اعداد': 'config', 'سيرفر': 'server', 'داتا': 'data',
    'ربط': 'api', 'تكامل': 'api', 'موقع': 'web', 'موبايل': 'mobile', 'نسخه': 'backup', 'شبكه': 'network',
    'اجتماع': 'meeting', 'مكالمه': 'call', 'ايميل': 'email', 'رد': 'reply', 'نقاش': 'discuss', 'مناقشه': 'discuss', 'مدير': 'lead', 'ليدر': 'lead',
    'تقرير': 'report', 'سعر': 'invoice', 'فاتوره': 'invoice', 'عقد': 'contract', 'دفع': 'pay', 'راتب': 'payroll', 'توظيف': 'hire',
    'مقابله': 'interview', 'بنك': 'bank', 'فلوس': 'wallet', 'تذكره': 'ticket',
    'بحث': 'research', 'تعلم': 'study', 'دراسه': 'study', 'قراءه': 'read', 'فكره': 'idea', 'هدف': 'goal', 'خطه': 'goal',
    'بوست': 'post', 'كتابه': 'write', 'فيديو': 'motion', 'تصميم': 'design', 'صور': 'photo', 'تسجيل': 'voice', 'صوت': 'voice',
    'عاجل': 'urgent', 'مهم': 'urgent', 'تذكير': 'remind', 'سؤال': 'question', 'استفسار': 'question',
    'شراء': 'shop', 'دكتور': 'doctor', 'دواء': 'medicine', 'علاج': 'medicine', 'سفر': 'travel', 'عربيه': 'car', 'هديه': 'gift',
    'تنظيف': 'clean', 'طبخ': 'cook', 'قهوه': 'coffee', 'نوم': 'sleep', 'تصليح': 'repair', 'صيانه': 'repair', 'شحن': 'delivery',
  };
  const STOP = new Set(('the and for with from into onto over under about after before this that these those your you our their them '
    + 'show shows are was were has have had not but all any can will should must need needs make get got put set new now then than very also just '
    + 'في من على الى عن مع هو هي ده دي دا كده بس لو او ثم كل اي ايه انا انت احنا هم اللي التي الذي يعني').split(' '));
  const norm = w => {
    let s = String(w || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '');
    if (/^[؀-ۿ]/.test(s)) { if (s.startsWith('وال') && s.length > 5) s = s.slice(3); else if (s.startsWith('ال') && s.length > 4) s = s.slice(2); }
    return s;
  };
  const isLatin = w => /^[a-z]/.test(w);
  // a title → its distinct, meaningful words: no hidden comments, markdown marks, ticket numbers, digits or stop words
  function words(title) {
    const clean = String(title || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/#\d+/g, ' ').replace(/[*_~`]/g, ' ');
    const out = [];
    for (const raw of clean.split(/[^\p{L}]+/u)) {
      const w = norm(raw);
      if (!w || STOP.has(w) || (w.length < 3 && !GLOSSARY[w]) || (!isLatin(w) && w.length < 2)) continue; // a short glossary word (ai, pc, qa) stays
      if (!out.includes(w)) out.push(w);
    }
    return out;
  }
  // icons = [{ n, en, ar, k }] (lib/task-icons.js shape); each one's own words are computed once per list and cached
  const cache = new WeakMap();
  const ownWords = icon => {
    let s = cache.get(icon);
    if (!s) { s = new Set(`${icon.n} ${icon.en} ${icon.ar} ${icon.k || ''}`.split(/[^\p{L}\d]+/u).map(norm).filter(Boolean)); cache.set(icon, s); }
    return s;
  };
  // the WHOLE shorter word (4+ letters) starts the longer one: develop ↔ developer, update ↔ updates — never aware ↔ award
const prefixHit = (a, b) => { const [x, y] = a.length <= b.length ? [a, b] : [b, a]; return x.length >= 4 && x !== y && y.startsWith(x); };
  // → { s: the best hit, at: the index of the title word that gave it } (s = 0: no hit)
  function score(icon, ws) {
    let s = 0, at = Infinity;
    const own = ownWords(icon);
    ws.forEach((w, i) => {
      const h = GLOSSARY[w] === icon.n ? 3 : own.has(w) ? 2 : [...own].some(o => prefixHit(w, o)) ? 1 : 0;
      if (h > s) { s = h; at = i; }
    });
    return { s, at };
  }
  // → up to n icon names: the title's best matches first (ties: the icon used most, then the EARLIER title word — a
  // title usually names its subject first: "Bank file upload fixes" → bank), then, when short, the most-used icons
  // not in `recent`
  function suggest(title, icons, { counts = {}, recent = [], n = 3 } = {}) {
    const ws = words(title);
    const used = name => counts[name] || 0;
    const out = ws.length ? icons.map(i => ({ n: i.n, ...score(i, ws) })).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || used(b.n) - used(a.n) || a.at - b.at).slice(0, n).map(x => x.n) : [];
    if (out.length < n) {
      const known = new Set(icons.map(i => i.n));
      const fill = Object.keys(counts).filter(k => known.has(k) && used(k) > 0 && !out.includes(k) && !recent.includes(k)).sort((a, b) => used(b) - used(a));
      out.push(...fill.slice(0, n - out.length));
    }
    return out;
  }
  // a pick → the new { list, counts }: the name moves to the front of Recent (max `max`, distinct) and its count grows by 1
  function remember(state, name, max = 7) {
    const list = [name, ...((state && state.list) || []).filter(x => x !== name)].slice(0, max);
    const counts = { ...((state && state.counts) || {}) };
    counts[name] = (counts[name] || 0) + 1;
    return { list, counts };
  }
  // first run: seed from the icons already on tasks / subtasks (names in any order, repeats = usage)
  function seed(names, max = 7) {
    const counts = {};
    for (const n of names) if (n) counts[n] = (counts[n] || 0) + 1;
    return { list: Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, max), counts };
  }
  const api = { GLOSSARY, words, norm, score, suggest, remember, seed };
  if (typeof window !== 'undefined') window.ICON_SUGGEST = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

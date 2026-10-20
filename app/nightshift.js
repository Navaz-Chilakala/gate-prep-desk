// Night shift: slow, careful work done while you're away from the keyboard.
// - checks the answers of PYQs that have none yet (so the Daily mix and paper mode can use them)
// - fact-checks topic lessons, book lessons, flashcards and mini lessons written before the fact-checker
// - writes PYQ masterclasses ahead (optional, slowest)
// One window does it (Web Locks). It starts after 3 idle minutes (no typing, clicking or scrolling in any
// app window, nothing else running) and stops the moment you come back; every task is saved as it finishes,
// so a stopped task just runs again later. Settings live in hub.night: { on, tasks: { verify, facts, master } }.

const Night = {
  IDLE_MS: 3 * 60 * 1000,
  ctl: null, current: '', running: false,
  touch() {   // any input in any window counts as "you're here" (shared through localStorage)
    const now = Date.now();
    if (now - (this._t || 0) > 5000) { this._t = now; Cfg.set('lastInput', String(now)); }
    if (this.ctl && !this.manual) this.ctl.abort();
  },
  idleFor() { return Date.now() - (+Cfg.get('lastInput', '0') || 0); },
  cfg() { const n = (H && H.night) || {}; return { on: !!n.on, tasks: { verify: true, facts: true, master: false, ...(n.tasks || {}) } }; },
  start() {
    ['keydown', 'pointerdown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => this.touch(), { passive: true, capture: true }));
    addEventListener('storage', e => { if (e.key === 'gt_lastInput' && this.ctl && !this.manual) this.ctl.abort(); });
    this.touch();
    const loop = async () => {
      for (;;) {
        await new Promise(r => setTimeout(r, 30000));
        try { await this.tick(); } catch (e) { if (e.name !== 'AbortError') console.warn('night shift', e); }
      }
    };
    if (navigator.locks) navigator.locks.request('gate-desk-night', loop); else loop();
  },
  // Is the machine free? Nothing running in this window, no book being read, no PYQ pages waiting.
  async busy() {
    if (Jobs.size) return true;
    const h = await Store.getHub();
    return (h.queue || []).some(q => q.status === 'reading' || q.status === 'queued') || (h.pyqScan || []).length > 0;
  },
  async tick() {
    const h = await Store.getHub(), n = h.night || {};
    if (!n.on || this.idleFor() < this.IDLE_MS || await this.busy()) return;
    const done = await this.work(false);
    if (done) toast(`While you were away, the night shift finished ${done} task${done > 1 ? "s" : ""} (Settings → Night shift).`, "ok", 9000);
  },
  // Does tasks one after another until there's nothing left or you come back. manual = "Run now" (ignores idle).
  async work(manual) {
    if (this.running) return;
    this.running = true; this.manual = manual;
    this.ctl = new AbortController();
    const signal = this.ctl.signal;
    let done = 0;
    try {
      for (;;) {
        if (!manual && this.idleFor() < this.IDLE_MS) break;
        const t = await this.next();
        if (!t) break;
        this.current = t.label; announce({ type: 'night' });
        const t0 = Date.now();
        await t.run(signal);
        done++;
        await updateHub(h2 => { h2.nightLog = (h2.nightLog || []).concat([{ at: new Date().toISOString(), what: t.label, secs: Math.round((Date.now() - t0) / 1000) }]).slice(-60); });
      }
    } catch (e) { if (e.name !== 'AbortError') { console.warn('night shift task', e); await updateHub(h2 => { h2.nightLog = (h2.nightLog || []).concat([{ at: new Date().toISOString(), what: `Stopped: ${this.current} (${e.message})`, error: true }]).slice(-60); }); } }
    finally { this.running = false; this.manual = false; this.ctl = null; this.current = ''; announce({ type: 'night' }); }
    return done;
  },
  stop() { if (this.ctl) this.ctl.abort(); },
  // What's left, per kind (for Settings).
  async todo() {
    const h = await Store.getHub(), c = { verify: 0, topics: 0, lessons: 0, cards: 0, minis: 0, master: 0 };
    for (const p of h.pyqs || []) { if (!p.answer) c.verify++; else if ((p.parts || []).length < 3) c.master++; }
    c.topics = Object.values(h.topics || {}).filter(t => t.md && !t.review).length;
    c.minis = Object.values(h.miniLessons || {}).filter(m => m.md && !m.review).length;
    c.cards = (h.cards || []).filter(x => !x.checked).length;
    for (const s of await Store.listSites()) { try { const d = await Store.getData(s.id); c.lessons += (d.lessons || []).filter(l => l.md && !l.review).length; } catch {} }
    return c;
  },
  // The next task in priority order: answers first (they unlock practice), then fact-checks, then masterclasses.
  async next() {
    const h = await Store.getHub(), tk = { verify: true, facts: true, master: false, ...((h.night || {}).tasks || {}) };
    if (tk.verify) {
      const p = (h.pyqs || []).find(x => !x.answer && x.text);
      if (p) return { label: `Checking the answer of GATE ${p.year || ''} PYQ${pyqNum(p) ? ' Q.' + pyqNum(p) : ''}`, run: async signal => {
        const a = await pyqVerify(p, signal);
        await updateHub(h2 => { const x = (h2.pyqs || []).find(y => y.id === p.id); if (x && !x.answer) x.answer = a; });
      } };
    }
    if (tk.facts) {
      const fc = Cfg.get('factcheck', 'on') === 'on';
      const key = Object.keys(h.topics || {}).find(k => h.topics[k].md && !h.topics[k].review);
      if (key && fc) { const t = h.topics[key]; return { label: `Fact-checking the lesson "${t.title}"`, run: async signal => {
        const r = await factCheck(t.md, { title: t.title, subject: t.subject || lessonSubject(t.md) || '', kind: 'topic lesson', signal });
        await updateHub(h2 => { const x = h2.topics[key]; if (x && x.md === t.md) { x.md = r.md; x.review = r.review; } });
      } }; }
      for (const s of await Store.listSites()) {
        let d; try { d = await Store.getData(s.id); } catch { continue; }
        const i = (d.lessons || []).findIndex(l => l.md && !l.review);
        if (i < 0 || !fc) continue;
        const L = d.lessons[i], title = L.title || ((L.md.match(/^#\s+(.+)$/m) || [])[1]) || `Pages ${L.from}-${L.to}`;
        return { label: `Fact-checking "${title}" (${prettyName(s.name)})`, run: async signal => {
          const material = (d.pages || []).filter(p => p && p.md != null && p.n >= L.from && p.n <= L.to).map(p => `--- Page ${p.n} ---\n${p.md}`).join('\n\n');
          const r = await factCheck(L.md, { title, subject: L.subject || '', material, kind: 'book lesson', signal });
          await updateData(s.id, cur => { const x = (cur.lessons || [])[i]; if (x && x.md === L.md) { x.md = r.md; x.review = r.review; } });
        } };
      }
      const mk = Object.keys(h.miniLessons || {}).find(k => h.miniLessons[k].md && !h.miniLessons[k].review);
      if (mk && fc) { const m = h.miniLessons[mk]; return { label: `Fact-checking the mini lesson on ${m.concept}`, run: async signal => {
        const r = await factCheck(m.md, { title: m.concept, kind: 'mini lesson', signal });
        await updateHub(h2 => { const x = (h2.miniLessons || {})[mk]; if (x && x.md === m.md) { x.md = r.md; x.review = r.review; } });
      } }; }
      const cards = (h.cards || []).filter(c => !c.checked).slice(0, 8);
      if (cards.length) return { label: `Checking ${cards.length} flashcard${cards.length > 1 ? 's' : ''}`, run: async signal => {
        const res = await checkCards(cards, signal);
        await updateHub(h2 => { for (const r of res) { const x = (h2.cards || []).find(c => c.id === r.id); if (x) Object.assign(x, r.patch); } });
      } };
    }
    if (tk.master) {
      const p = (h.pyqs || []).find(x => x.answer && (x.parts || []).length < 3);
      if (p) return { label: `Writing the masterclass for GATE ${p.year || ''} PYQ${pyqNum(p) ? ' Q.' + pyqNum(p) : ''}`, run: async signal => { await pyqMasterclass(p, signal); } };
    }
    return null;
  },
};

// Flashcards: each back is checked as one statement (front + back). Clear errors are corrected only when the
// correction itself is confirmed; doubtful ones are marked so the card shows a "double-check" note.
async function checkCards(cards, signal) {
  const out = [];
  for (const c of cards) {
    const claim = `${plainText(c.front)} → ${plainText(c.back)}`.slice(0, 600);
    const facts = factsFor(claim, 4, c.subject || '');
    const v = await truthCheck(`Flashcard. Question: ${plainText(c.front)}\nAnswer on the card: ${plainText(c.back)}`, { facts, signal });
    const patch = { checked: new Date().toISOString() };
    if (v.verdict === 'false' && v.confidence >= 70) {
      let fixed = '';
      try {
        fixed = (await ollamaChat([{ role: 'system', content: 'This flashcard\'s answer is wrong. Write the correct answer in the same style and length (Markdown, LaTeX for math). Return only the answer.' },
          { role: 'user', content: `Question: ${c.front}\nWrong answer: ${c.back}\nWhy it is wrong: ${v.why}${factsBlock(facts)}` }], { signal, model: checkModel(), temperature: 0, maxTokens: 500 })).trim();
      } catch (e) { if (e.name === 'AbortError') throw e; }
      const ok = fixed && (await truthCheck(`Flashcard. Question: ${plainText(c.front)}\nAnswer on the card: ${plainText(fixed)}`, { facts, signal }));
      if (ok && ok.verdict === 'true' && ok.confidence >= 70) Object.assign(patch, { back: fixed, wasBack: c.back, fixNote: v.why });
      else patch.doubt = v.why || 'The checker thinks this answer may be wrong.';
    } else if (v.verdict !== 'true' || v.confidence < 60) patch.doubt = v.why || 'The checker could not confirm this answer.';
    out.push({ id: c.id, patch });
  }
  return out;
}
// The note under a flashcard's answer after a check: corrected, or "double-check this".
function cardNote(c) {
  if (c.wasBack) return `<p class="small card-note fixed">Corrected by the fact-checker (it used to say: ${escapeHtml(plainText(c.wasBack).slice(0, 140))}). ${escapeHtml(c.fixNote || '')}</p>`;
  if (c.doubt) return `<p class="small card-note doubt">Double-check this answer: ${escapeHtml(c.doubt)}</p>`;
  return '';
}

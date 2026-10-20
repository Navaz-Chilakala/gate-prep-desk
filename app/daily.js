// Daily mix: one focused ~15-minute session that interleaves everything due today: mistakes due for their
// spaced review, flashcards due, and a few PYQs with checked answers (weak subjects first). Mixing kinds
// (interleaving) makes you decide *which* idea applies, which is what the exam asks.
// Opens as a full-screen focus overlay; every answer updates the same schedules as the Mistake lab and
// flashcards, so nothing is counted twice.

// A PYQ as a test question (so the Mistake lab can grade its reviews). null if its answer can't be graded.
function pyqAsQuestion(p, stem, opts, type) {
  const a = String(p.answer.text || '').trim(), q = p.text;
  const base = { question: stem, options: opts.slice(0, 4), subject: p.subject, concept: p.concept || '', label: `GATE ${p.year || ''} PYQ`, marks: 2 };
  // The explanation: section 9 of the masterclass ("the question") when it's written, else the checked answer.
  const sec9 = ((p.master || '').match(/^##\s*9\.[^\n]*\n([\s\S]*?)(?=^##\s*\d+\.|$(?![\s\S]))/m) || [])[1] || '';
  const explanation = `**Answer: ${a}** (${p.answer.level === 'official' ? 'official GATE key' : `checked by ${p.answer.by || 'the tutor'}`}).${sec9 ? '\n\n' + sec9.trim().slice(0, 3000) : '\n\nOpen this PYQ in the PYQs tab for the full masterclass.'}`;
  if (type !== 'NAT') {
    let letters = /^[A-D](;[A-D])*$/.test(a) ? a.split(';') : (normAnswer(a, q).kind === 'opt' ? normAnswer(a, q).v.split(',') : []);
    if (!letters.length || letters.some(l => 'ABCD'.indexOf(l) >= opts.length)) return null;
    // An official MCQ key with two letters means either was accepted: grade on the first.
    const msq = /\bMSQ\b|one or more|more than one/i.test(q) && letters.length > 1;
    return { ...base, type: msq ? 'MSQ' : 'MCQ', correct: msq ? letters.sort() : [letters[0]], explanation };
  }
  const r = a.match(/^(-?[\d.]+) to (-?[\d.]+)$/), v = parseFloat((a.match(/-?\d+(?:\.\d+)?/) || [])[0]);
  if (r) return { ...base, type: 'NAT', nat_min: +r[1], nat_max: +r[2], explanation, correct: [] };
  if (!isFinite(v)) return null;
  const tol = Number.isInteger(v) ? 0 : Math.max(0.01, Math.abs(v) * 0.005);
  return { ...base, type: 'NAT', nat_min: +(v - tol).toFixed(4), nat_max: +(v + tol).toFixed(4), explanation, correct: [] };
}
// ---------- formula drills ----------
// What you're asked to recall: the formula's name, else what it computes (its note). Formulas with neither are skipped.
function formulaCue(f) {
  const name = String(f.name || '').trim(), note = String(f.note || '').trim();
  return name ? `${name}${f.subject && f.subject !== 'Other' ? ` (${f.subject})` : ''}` : note.length > 8 ? `The formula for: ${note.replace(/\s*\$\$?[^$]*\$\$?/g, '').slice(0, 160)}` : '';
}
// Due ones first, then up to `fresh` never-drilled ones (weak subjects first).
function formulasDue(n, fresh = 2) {
  const now = Date.now(), all = (H.formulas || []).filter(f => f.tex && formulaCue(f));
  const due = all.filter(f => f.drill && f.drill.due <= now).sort((a, b) => a.drill.due - b.drill.due);
  const weakS = {}; (H.mistakes || []).forEach(m => { weakS[m.q.subject] = (weakS[m.q.subject] || 0) + 1; });
  const fresh_ = all.filter(f => !f.drill).sort((a, b) => (weakS[b.subject] || 0) - (weakS[a.subject] || 0)).slice(0, fresh);
  return due.concat(fresh_).slice(0, n);
}
const DailyMix = {
  plan() {
    const now = Date.now();
    const mistakes = dueMistakes(H.mistakes).sort((a, b) => reviewInfo(a).due - reviewInfo(b).due).slice(0, 6).map(m => ({ kind: 'mistake', id: m.id }));
    const cards = H.cards.filter(c => c.due <= now).sort((a, b) => a.due - b.due).slice(0, 6).map(c => ({ kind: 'card', id: c.id }));
    // PYQs with a checked answer, on your weakest concepts first (then weak subjects), then ones you haven't seen in a mix.
    const weakC = weakConcepts(12), weakS = {};
    weakC.forEach(c => { weakS[c.subject] = (weakS[c.subject] || 0) + (1 - c.acc); });
    const fit = p => {
      const toks = new Set(topicTokens(`${p.concept || ''} ${plainText(p.text).slice(0, 400)}`));
      const c = weakC.find(w => p.subject === w.subject && topicTokens(w.concept).filter(t => toks.has(t)).length >= Math.min(2, topicTokens(w.concept).length));
      return (c ? 3 * (1 - c.acc) : 0) + (weakS[p.subject] || 0);
    };
    const seen = new Set((H.mixSeen || []).slice(-200)), open = new Set(H.mistakes.map(m => m.pyqId).filter(Boolean));
    // Only answers that were actually verified (official key / exact calculator / agreeing checks): never quiz you on a guess.
    // A PYQ you got wrong comes back through its spaced review instead.
    const pyqs = (H.pyqs || []).filter(p => p.answer && p.answer.text && p.answer.text !== 'MTA' && ['official', 'exact', 'high', 'good'].includes(p.answer.level) && !open.has(p.id))
      .map(p => ({ p, s: fit(p) })).sort((a, b) => (seen.has(a.p.id) - seen.has(b.p.id)) || (b.s - a.s) || (Math.random() - .5)).slice(0, 3).map(({ p }) => ({ kind: 'pyq', id: p.id }));
    const formulas = formulasDue(4).map(f => ({ kind: 'formula', id: f.id }));
    // Interleave: mistake, card, pyq, formula, mistake, card, ...
    const lists = [mistakes, cards, pyqs, formulas], out = [];
    for (let i = 0; lists.some(l => l[i]); i++) lists.forEach(l => { if (l[i]) out.push(l[i]); });
    return out;
  },
  start(items = null, { kicker = 'Daily mix', title = 'Today' } = {}) {
    this.items = items || this.plan();
    if (!this.items.length) { toast(items ? 'No formulas are due right now.' : 'Nothing due today.'); return; }
    this.i = 0; this.stats = { advanced: 0, conquered: 0, reset: 0, early: 0, cards: 0, forgot: 0, pyqRight: 0, pyqWrong: 0, formulas: 0, fForgot: 0 }; this.t0 = Date.now();
    let el = $('#mixOverlay');
    if (!el) { el = document.createElement('div'); el.id = 'mixOverlay'; el.className = 'mix-overlay'; document.body.appendChild(el); }
    el.innerHTML = `<div class="mix-shell" role="dialog" aria-label="Daily mix">
      <header class="mix-head"><div><div class="mix-kicker">${escapeHtml(kicker)}</div><div class="mix-title">${escapeHtml(title)}</div></div>
        <span class="mix-count"></span><button class="link mix-close" title="End the session (Esc)">✕</button></header>
      <div class="mix-bar"><span></span></div>
      <div class="mix-body"></div></div>`;
    el.classList.add('open'); document.body.classList.add('mix-open');
    $('.mix-close', el).onclick = () => this.finish();
    this._esc = e => { if (e.key === 'Escape') this.finish(); };
    document.addEventListener('keydown', this._esc);
    this.show();
  },
  progress() {
    const el = $('#mixOverlay');
    $('.mix-count', el).textContent = `${Math.min(this.i + 1, this.items.length)} of ${this.items.length}`;
    $('.mix-bar span', el).style.width = `${100 * this.i / this.items.length}%`;
  },
  show() {
    if (this.i >= this.items.length) return this.summary();
    this.progress();
    const it = this.items[this.i], body = $('#mixOverlay .mix-body');
    if (it.kind === 'card') return this.showCard(body, H.cards.find(c => c.id === it.id));
    if (it.kind === 'formula') return this.showFormula(body, (H.formulas || []).find(f => f.id === it.id));
    if (it.kind === 'mistake') return this.showQuestion(body, it, H.mistakes.find(m => m.id === it.id));
    return this.showQuestion(body, it, null, (H.pyqs || []).find(p => p.id === it.id));
  },
  next() { this.i++; this.show(); },
  badge(kind, extra) {
    const k = { mistake: ['Mistake review', 'red'], card: ['Flashcard', 'amber'], pyq: ['GATE PYQ', 'violet'], formula: ['Formula recall', 'green'] }[kind];
    return `<div class="mix-tag tone-${k[1]}"><span></span>${k[0]}${extra ? ` · ${escapeHtml(extra)}` : ''}</div>`;
  },
  showCard(body, c) {
    if (!c) return this.next();
    body.innerHTML = `${this.badge('card', c.subject)}
      <div class="mix-card md">${renderMd(c.front)}</div>
      <div class="mix-back md hidden">${renderMd(c.back)}${cardNote(c)}</div>
      <div class="mix-actions"><button class="primary mx-show">Show answer <kbd>Space</kbd></button></div>
      <div class="mix-actions mx-grades hidden">
        <button data-g="0">Forgot <kbd>1</kbd></button><button data-g="1">Shaky <kbd>2</kbd></button><button data-g="2" class="primary">Got it <kbd>3</kbd></button><button data-g="3">Easy <kbd>4</kbd></button></div>`;
    const reveal = () => { body.querySelector('.mix-back').classList.remove('hidden'); body.querySelector('.mx-grades').classList.remove('hidden'); body.querySelector('.mx-show').parentElement.classList.add('hidden'); };
    $('.mx-show', body).onclick = reveal;
    const grade = async g => {
      await updateHub(h => { const x = h.cards.find(y => y.id === c.id); if (x) scheduleCard(x, g); });
      await refreshHub();
      this.stats.cards++; if (g === 0) this.stats.forgot++;
      this.next();
    };
    body.querySelectorAll('[data-g]').forEach(b => b.onclick = () => grade(+b.dataset.g));
    this.keys = e => {
      if (e.target.closest('input, textarea')) return;
      if (e.key === ' ' && body.querySelector('.mix-back.hidden')) { e.preventDefault(); reveal(); }
      else if (/^[1-4]$/.test(e.key) && !body.querySelector('.mx-grades').classList.contains('hidden')) grade(+e.key - 1);
    };
  },
  // A formula from your formula book: recall it from its name/meaning, then grade yourself (same spacing as flashcards).
  showFormula(body, f) {
    if (!f) return this.next();
    body.innerHTML = `${this.badge('formula', f.subject)}
      <div class="mix-card md"><p><b>${escapeHtml(formulaCue(f))}</b></p></div>
      <div class="mix-back md hidden">${renderMd('$$' + f.tex + '$$')}${f.note ? `<p class="small">${escapeHtml(f.note)}</p>` : ''}</div>
      <div class="mix-actions"><button class="primary mx-show">Show the formula <kbd>Space</kbd></button></div>
      <div class="mix-actions mx-grades hidden"><span class="small muted">Did you have it right?</span>
        <button data-g="0">No <kbd>1</kbd></button><button data-g="1">Partly <kbd>2</kbd></button><button data-g="2" class="primary">Yes <kbd>3</kbd></button><button data-g="3">Easily <kbd>4</kbd></button></div>`;
    const reveal = () => { body.querySelector('.mix-back').classList.remove('hidden'); body.querySelector('.mx-grades').classList.remove('hidden'); body.querySelector('.mx-show').parentElement.classList.add('hidden'); };
    $('.mx-show', body).onclick = reveal;
    const grade = async g => {
      await updateHub(h => { const x = (h.formulas || []).find(y => y.id === f.id); if (x) x.drill = scheduleCard(x.drill || { due: 0, interval: 0, ease: 2.5, reps: 0 }, g); });
      await refreshHub();
      this.stats.formulas++; if (g === 0) this.stats.fForgot++;
      this.next();
    };
    body.querySelectorAll('[data-g]').forEach(b => b.onclick = () => grade(+b.dataset.g));
    this.keys = e => {
      if (e.target.closest('input, textarea')) return;
      if (e.key === ' ' && body.querySelector('.mix-back.hidden')) { e.preventDefault(); reveal(); }
      else if (/^[1-4]$/.test(e.key) && !body.querySelector('.mx-grades').classList.contains('hidden')) grade(+e.key - 1);
    };
  },
  // A mistake (counts as its spaced review) or a PYQ (checked against its verified answer).
  showQuestion(body, it, m, p) {
    if (!m && !p) return this.next();
    const q = m ? fixInlineOptions(m.q) : null;
    // PYQs: clean scanner slips ("©)" → "(C)") and pull inline options out of the text.
    let opts, stem;
    if (m) { opts = q.options; stem = q.question; }
    else {
      const t = fixScanMarks(p.text), inl = fixInlineOptions({ question: t, options: [], type: 'MCQ' });
      if (inl.options.length === 4) { opts = inl.options; stem = inl.question; }
      else { opts = Object.values(optionsIn(t)); stem = opts.length >= 2 ? t.split('\n').filter(l => !/^\s*\(?[A-D][).:]\s/.test(l)).join('\n') : t; }
    }
    const type = m ? q.type : (opts.length >= 2 ? 'MCQ' : 'NAT');
    const multi = type === 'MSQ';
    const qForCheck = stem + (opts.length ? '\n' + opts.map((o, k) => `(${'ABCD'[k]}) ${o}`).join('\n') : '');
    const extra = m ? `${q.subject || ''}${reviewInfo(m).day ? ` · day-${reviewInfo(m).day} review` : ''}` : `GATE ${p.year || ''} · ${p.subject}`;
    body.innerHTML = `${this.badge(it.kind, extra)}
      <div class="mix-q md">${renderMd(stem)}</div>
      <div class="mix-opts">${type === 'NAT' ? `<label class="mix-nat">Your answer <input type="text" class="mx-nat" autocomplete="off" placeholder="number or short answer"></label>`
        : opts.map((o, k) => `<label class="opt"><input type="${multi ? 'checkbox' : 'radio'}" name="mx" value="${'ABCD'[k]}"><b>${'ABCD'[k]}.</b><div class="md">${renderMd(o)}</div></label>`).join('')}</div>
      <div class="mix-actions"><button class="primary mx-check">Check <kbd>Enter</kbd></button><button class="link mx-skip">Skip</button></div>
      <div class="mx-verdict"></div>`;
    const getAns = () => type === 'NAT' ? $('.mx-nat', body).value.trim() : multi ? [...body.querySelectorAll('input:checked')].map(x => x.value) : (body.querySelector('input:checked') || {}).value;
    const check = async () => {
      const a = getAns();
      if (!isAnswered(a)) { toast('Pick an answer first.'); return; }
      let html;
      if (m) {
        const r = grade(q, a), out = await reviewMistake(m.id, r.status === 'correct');
        await refreshHub();
        this.stats[out] = (this.stats[out] || 0) + 1;
        const now = H.mistakes.find(x => x.id === m.id), after = now && reviewInfo(now);
        html = r.status === 'correct'
          ? `<div class="m-win">${icon('check')} <b>${out === 'conquered' ? 'Day-7 review passed: conquered!' : out === 'advanced' ? `Right. Next review ${after ? fmtDue(after.due) : ''}.` : 'Right.'}</b></div>`
          : `<div class="m-lose">Not yet: the answer is <b>${escapeHtml(keyOf(q))}</b>. It comes back tomorrow.</div>`;
        html += `<div class="md mix-expl">${renderMd(q.explanation)}</div>`;
      } else {
        const given = Array.isArray(a) ? a.join(', ') : a;
        const right = (p.answer.level === 'official' ? officialAgrees(p.answer.text, given, qForCheck) : voteMatch(given, p.answer.text, qForCheck)) === true;
        this.stats[right ? 'pyqRight' : 'pyqWrong']++;
        // A wrong PYQ becomes a mistake with the day 1 / 3 / 7 review schedule (as a gradable question).
        const mq = !right ? pyqAsQuestion(p, stem, opts, type) : null;
        await updateHub(h => {
          h.mixSeen = (h.mixSeen || []).concat(p.id).slice(-300);
          h.pyqResults = (h.pyqResults || []).concat([{ id: p.id, concept: p.concept || '', subject: p.subject, right, at: new Date().toISOString() }]).slice(-500);
          if (mq && !h.mistakes.some(m => m.pyqId === p.id)) h.mistakes.push({ id: uid(), q: mq, pyqId: p.id, source: `GATE ${p.year || ''} PYQ (Daily mix)`.replace('  ', ' '), at: new Date().toISOString(), answer: a, errorType: null, review: { stage: 0, base: new Date().toISOString() } });
        });
        html = (right ? `<div class="m-win">${icon('check')} <b>Right.</b> The answer is ${escapeHtml(p.answer.text)}.</div>` : `<div class="m-lose">The answer is <b>${escapeHtml(p.answer.text)}</b> (${p.answer.level === 'official' ? 'official GATE key' : `checked by ${escapeHtml(p.answer.by || 'the tutor')}`}).${mq ? ' It\'s in your Mistake lab now and comes back tomorrow for its day-1 review.' : ''}</div>`)
          + `<p class="small"><a href="#" class="mx-master">Open its full masterclass</a> after this session.</p>`;
      }
      $('.mx-verdict', body).innerHTML = html + `<div class="mix-actions"><button class="primary mx-next">Next <kbd>Enter</kbd></button></div>`;
      $('.mx-check', body).remove(); $('.mx-skip', body).remove();
      body.querySelectorAll('.mix-opts input').forEach(i => i.disabled = true);
      const ma = $('.mx-master', body); if (ma) ma.onclick = e => { e.preventDefault(); this.finish(); openTab('pyq'); openPyq(p.id); };
      $('.mx-next', body).onclick = () => this.next();
      $('.mx-next', body).focus();
      this.keys = e => { if (e.key === 'Enter') { e.preventDefault(); this.next(); } };
    };
    $('.mx-check', body).onclick = check;
    $('.mx-skip', body).onclick = () => this.next();
    this.keys = e => {
      if (e.key === 'Enter') { e.preventDefault(); check(); }
      else if (type !== 'NAT' && /^[a-dA-D]$/.test(e.key) && !e.target.closest('input[type=text]')) { const inp = body.querySelector(`input[value="${e.key.toUpperCase()}"]`); if (inp) { inp.checked = multi ? !inp.checked : true; } }
    };
    const nat = $('.mx-nat', body); if (nat) nat.focus();
  },
  summary() {
    const s = this.stats, el = $('#mixOverlay'), body = $('.mix-body', el);
    $('.mix-bar span', el).style.width = '100%'; $('.mix-count', el).textContent = 'Done';
    const mins = Math.max(1, Math.round((Date.now() - this.t0) / 60000));
    const left = dueMistakes(H.mistakes).length + H.cards.filter(c => c.due <= Date.now()).length;
    body.innerHTML = `<div class="mix-done"><div class="es-ico">${icon('check')}</div><h2>Session complete</h2><p class="muted">${this.items.length} items in about ${mins} minute${mins > 1 ? 's' : ''}.</p>
      <div class="mix-sum">
        ${s.conquered ? `<div><b>${s.conquered}</b><span>mistakes conquered</span></div>` : ''}
        <div><b>${s.advanced}</b><span>moved to the next review</span></div>
        <div><b>${s.reset}</b><span>start over tomorrow</span></div>
        <div><b>${s.cards}</b><span>flashcards${s.forgot ? ` (${s.forgot} to see again)` : ''}</span></div>
        ${s.formulas ? `<div><b>${s.formulas - s.fForgot}/${s.formulas}</b><span>formulas recalled</span></div>` : ''}
        <div><b>${s.pyqRight}/${s.pyqRight + s.pyqWrong}</b><span>PYQs right</span></div>
      </div>
      <p>${left ? `${left} item${left > 1 ? 's' : ''} still due (cards you forgot come back in 10 minutes).` : 'Everything due today is done. See you tomorrow.'}</p>
      <div class="mix-actions" style="justify-content:center"><button class="primary mx-end">Back to my story</button></div></div>`;
    $('.mx-end', body).onclick = () => this.finish();
    this.keys = e => { if (e.key === 'Enter') this.finish(); };
  },
  finish() {
    const el = $('#mixOverlay');
    if (el) el.classList.remove('open');
    document.body.classList.remove('mix-open');
    document.removeEventListener('keydown', this._esc);
    this.keys = null;
    refreshHub().then(() => { renderToday(); if (tab === 'mistakes') renderMistakes(); if (tab === 'practice') renderPractice(); });
  },
};
document.addEventListener('keydown', e => { if (DailyMix.keys && document.body.classList.contains('mix-open') && !e.ctrlKey && !e.metaKey && !e.altKey) DailyMix.keys(e); });
// Formula book → "Drill formulas": a focused recall session of formulas due (plus a few new ones).
document.addEventListener('click', e => {
  if (!e.target.closest('#fDrill')) return;
  const list = formulasDue(12, 6).map(f => ({ kind: 'formula', id: f.id }));
  DailyMix.start(list, { kicker: 'Formula drill', title: "Recall, then check" });
});

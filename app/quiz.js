// Quiz engine: question generation (+ answer-key verification), GATE-style runner with calculator,
// grading, review, AI analysis with error types, mistake notebook and flashcards.

const Q_SCHEMA = () => ({
  type: 'object', required: ['questions'],
  properties: { questions: { type: 'array', items: {
    type: 'object',
    required: ['type', 'marks', 'subject', 'concept', 'question', 'options', 'correct', 'nat_min', 'nat_max', 'explanation'],
    properties: {
      type: { type: 'string', enum: ['MCQ', 'MSQ', 'NAT'] },
      marks: { type: 'integer', enum: [1, 2] },
      subject: { type: 'string', enum: SUBJECTS },
      concept: { type: 'string' },
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
      correct: { type: 'array', items: { type: 'string', enum: ['A', 'B', 'C', 'D'] } },
      nat_min: { type: 'number' }, nat_max: { type: 'number' },
      explanation: { type: 'string' },
    } } } },
});
const SOLVE_SCHEMA = { type: 'object', required: ['correct', 'nat_value'], properties: {
  correct: { type: 'array', items: { type: 'string', enum: ['A', 'B', 'C', 'D'] } }, nat_value: { type: 'number' } } };

// Some generated questions put the options inside the question text and leave just "A".."D" as options.
// Move them back out so they show (and can be clicked) properly.
function fixInlineOptions(q) {
  if (!q || q.type === 'NAT' || !Array.isArray(q.options)) return q;
  if (!q.options.length || q.options.every(o => /^\s*\(?[A-Da-d]\)?[.)]?\s*$/.test(String(o)))) {
    const m = String(q.question).match(/\(?A[).]\s*([\s\S]+?)\s+\(?B[).]\s*([\s\S]+?)\s+\(?C[).]\s*([\s\S]+?)\s+\(?D[).]\s*([\s\S]+?)\s*$/);
    if (m) { q.options = [m[1], m[2], m[3], m[4]].map(s => s.trim()); q.question = String(q.question).slice(0, m.index).trim(); }
  }
  return q;
}
function cleanQuestion(q) {
  if (!q || !q.question || !['MCQ', 'MSQ', 'NAT'].includes(q.type)) return null;
  q.marks = q.marks === 2 ? 2 : 1;
  if (!SUBJECTS.includes(q.subject)) q.subject = null;
  if (q.type === 'NAT') {
    q.options = []; q.correct = [];
    if (!isFinite(q.nat_min) || !isFinite(q.nat_max)) return null;
    if (q.nat_min > q.nat_max) [q.nat_min, q.nat_max] = [q.nat_max, q.nat_min];
  } else {
    fixInlineOptions(q);
    q.options = (q.options || []).map(o => String(o).replace(/^\s*\(?[A-Da-d][).:]\s+/, ''));
    q.correct = [...new Set(q.correct || [])].sort();
    if (q.options.length !== 4 || !q.correct.length) return null;
    if (q.type === 'MCQ' && q.correct.length !== 1) return null;
    // Quality gate: four real, different options (no blanks, no duplicates, no "all/none of the above" twins).
    const norm = o => plainText(o).toLowerCase().replace(/\s+/g, ' ').trim();
    if (q.options.some(o => !norm(o)) || new Set(q.options.map(norm)).size < 4) return null;
  }
  // Every calculation written out in the explanation is recomputed exactly (factcheck.js). Fixed slips stay;
  // an explanation with many wrong results is dropped. The key is compared with the explanation afterwards.
  if (q.explanation && typeof arithmeticSweep === 'function') {
    const sw = arithmeticSweep(String(q.explanation));
    if (sw.items.some(x => x.status !== 'fixed')) return null;
    if (sw.items.length) { q.explanation = sw.md; q.sweepFixes = sw.items.length; }
  }
  q.id = uid();
  return q;
}

// One generation call (<= 6 questions). material may be '' (then the model uses its own GATE knowledge).
const TWISTED = `
MASTERY CHECK - make every question TWISTED, so only a student who grasped the exact essence can answer:
- target a classic misconception; make every wrong option the answer a half-understanding student would pick
- use edge and boundary cases, reversed conditions, "which is NOT / always / never", counter-intuitive outcomes
- small changed details that flip the answer (e.g. preemptive vs non-preemptive, < vs <=, 0- vs 1-indexed)
- no pure recall or definition questions; each must need reasoning about WHY it works
- in "explanation", name the misconception each wrong option represents`;
async function generateQuestions({ material = '', focus = '', subject = '', count = 4, types = ['MCQ', 'MSQ', 'NAT'], diff = 'GATE level', oneMarkOnly = false, twisted = false, signal, avoid = [], reported = '', marks = 0 }) {
  const sys = `You are a GATE CS paper setter. Write ORIGINAL, unambiguous exam questions${material ? ' strictly based on the given material' : ''}.
Allowed types: ${types.join(', ')}. MCQ: 4 options, exactly 1 correct. MSQ: 4 options, one or more correct. NAT: numeric answer as a range [nat_min, nat_max] (equal if exact), options empty, correct empty.
${oneMarkOnly || marks === 1 ? 'All questions are 1 mark: direct, solvable in about 90 seconds.' : marks === 2 ? 'All questions are 2 marks: multi-step, needing 2-4 minutes of working.' : 'Use marks 1 for direct questions and 2 for multi-step ones.'}
Difficulty: ${diff}. "correct" uses letters A-D. "subject" must be the GATE subject. "concept" = the exact concept tested in 2-5 words.
"explanation" = a clear step-by-step solution in simple words. Double-check every answer.${twisted ? TWISTED : ''}${WRITING_RULES}`;
  const user = [
    material ? `Material:\n${material.slice(0, 9000)}` : '',
    subject ? `Subject: ${subject}` : '',
    focus ? `Focus on: ${focus}` : '',
    reported ? `The student reported problems with earlier generated questions. Learn from them and do not make the same mistakes:\n${reported}` : '',
    avoid.length ? `Do not repeat these questions:\n- ${avoid.slice(-12).map(a => a.slice(0, 100)).join('\n- ')}` : '',
    factsBlock(factsFor(`${subject} ${focus} ${material.slice(0, 1500)}`, 6, subject)).trim(),
    `Write ${count} questions with a mix of the allowed types.`,
  ].filter(Boolean).join('\n\n');
  const raw = await ollamaChat([{ role: 'system', content: sys }, { role: 'user', content: user }],
    { signal, format: Q_SCHEMA(), temperature: 0.7, maxTokens: 300 + 750 * count, onToken: (_, o) => live(o, signal) });
  let qs = [];
  try { qs = (parseJSON(raw).questions || []).map(cleanQuestion).filter(Boolean).filter(q => types.includes(q.type)); } catch { qs = []; }
  qs.forEach(q => { if (!q.subject && subject) q.subject = subject; if (oneMarkOnly) q.marks = 1; if (marks) q.marks = marks; });
  return qs.slice(0, count);
}

// A quick solve first; only if it disagrees with the key does a thinking solve decide (thinking is right far more
// often on calculations, 45 vs 37 of 47 in the self-test, but takes ~50 s instead of ~5 s).
async function verifyQuestion(q, material, signal) {
  const opts = q.options.map((o, i) => `${'ABCD'[i]}. ${o}`).join('\n');
  const kind = q.type === 'MSQ' ? 'one or more options correct' : q.type === 'MCQ' ? 'exactly one option correct' : 'numerical answer: put it in nat_value and leave correct empty';
  const solve = async think => {
    // Working space first (a bare answer from a small model is close to a guess), then the answer.
    const r = parseJSON(await ollamaChat([
      { role: 'system', content: 'You are a GATE CS expert. Solve the question carefully and independently: "working" = short step-by-step reasoning (do every calculation), then the answer in "correct" (option letters) or "nat_value" (number). Return only JSON.' },
      { role: 'user', content: `${material ? `Reference material:\n${material.slice(0, 6000)}\n\n` : ''}${q.type} question (${kind}):\n${q.question}\n${opts}${factsBlock(factsFor(q.question + ' ' + (q.concept || ''), 4, q.subject || ''))}` },
    ], { signal, format: { type: 'object', required: ['working', 'correct', 'nat_value'], properties: { working: { type: 'string' }, ...SOLVE_SCHEMA.properties } }, temperature: 0, maxTokens: 1500, model: checkModel(), think }));
    if (q.type === 'NAT') return isFinite(r.nat_value) && r.nat_value >= q.nat_min - 1e-6 && r.nat_value <= q.nat_max + 1e-6;
    return [...new Set(r.correct || [])].sort().join() === q.correct.join();
  };
  let quick = false;
  try { quick = await solve(false); } catch (e) { if (e.name === 'AbortError') throw e; }
  return quick || await solve(true);
}

// Does the written explanation arrive at the same answer as the key? false = clear mismatch (the question is
// dropped), null = can't tell. Catches keys the model wrote inconsistently with its own working.
function explanationAgrees(q) {
  const ex = plainText(q.explanation || '');
  if (!ex) return null;
  const tail = ex.slice(-400);
  if (q.type === 'NAT') {
    const nums = (tail.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (!nums.length) return null;
    const v = nums[nums.length - 1], tol = Math.max(0.011, Math.abs(v) * 0.005);
    if (v >= q.nat_min - tol && v <= q.nat_max + tol) return true;
    return nums.some(n => n >= q.nat_min - tol && n <= q.nat_max + tol) ? null : false;
  }
  const m = [...tail.matchAll(/(?:answer|correct (?:option|answer)s?|option|options|hence|therefore)\s*(?:is|are|:)?\s*\(?([A-D])\)?(?:\s*(?:,|and)\s*\(?([A-D])\)?)*/gi)];
  if (!m.length) return null;
  const last = m[m.length - 1][0], letters = [...new Set((last.match(/\b[A-D]\b/g) || []))].sort().join();
  if (!letters) return null;
  return letters === q.correct.join() ? true : (q.type === 'MSQ' ? null : false);
}
function questionWithOptions(q) { return q.question + (q.options && q.options.length ? '\n' + q.options.map((o, i) => `(${'ABCD'[i]}) ${o}`).join('\n') : ''); }
// true = an exact calculator confirms the key, false = it disproves it, null = no calculator applies.
async function solverKeyCheck(q, signal) {
  const text = questionWithOptions(q);
  if (!Solvers.candidates(text).length && !(typeof Runners !== 'undefined' && Runners.candidates(text).length)) return null;   // calculators or runners (C, SQL …)
  const s = await Solvers.answer(text, signal);
  if (!s) return null;
  if (q.type === 'NAT') {
    const v = parseFloat(s.value);
    if (!isFinite(v)) return null;
    return v >= q.nat_min - Math.max(0.011, Math.abs(v) * 0.005) && v <= q.nat_max + Math.max(0.011, Math.abs(v) * 0.005);
  }
  const r = compareAnswers(s.value, s.text, q.correct.join(', '), text);
  return r == null ? null : r;
}

// plan: [{ material, focus, subject, label, count }]
// Learns from your reports: subjects with reported questions get stricter checks, and the generator
// is told what went wrong before (and never repeats a reported question).
async function buildTest({ name, kind = 'practice', plan, types, diff, verify = true, oneMarkOnly = false, twisted = false, minutes, signal }) {
  const test = { id: uid(), name, kind, created: new Date().toISOString(), questions: [], minutes };
  const total = plan.reduce((s, p) => s + p.count, 0);
  const reports = ((await Store.getHub()).reports || []).filter(r => r.q);
  for (const p of plan) {
    const mine = reports.filter(r => !p.subject || r.q.subject === p.subject);
    const strict = mine.length > 0;
    const lessons = mine.slice(-5).map(r => `- "${String(r.q.question).slice(0, 90)}…" was reported as: ${r.reason}`).join('\n');
    const avoidReported = mine.map(r => r.q.question);
    let need = p.count, tries = 0;
    while (need > 0 && tries < 3) {
      tries++;
      jobLabel(`Writing questions: ${p.label || p.subject || 'test'} (${test.questions.length}/${total})`, signal);
      progress(test.questions.length, total, signal);
      const qs = await generateQuestions({ ...p, count: Math.min(6, need), types, diff, oneMarkOnly, twisted, signal, reported: lessons,
        avoid: test.questions.map(q => q.question).concat(p.avoid || [], avoidReported) });
      for (const q of qs) {
        if (need <= 0) break;
        if (explanationAgrees(q) === false) { live('Dropped a question whose explanation reaches a different answer than its key.', signal); continue; }
        if (verify || strict) {
          // Exact calculator first (when the question is one it covers); its verdict is final.
          jobLabel(`Checking answer keys with the exact calculators (${test.questions.length}/${total})`, signal);
          let exact = null;
          try { exact = await solverKeyCheck(q, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
          if (exact === false) { live('Dropped a question whose key the exact calculator disproved.', signal); continue; }
          if (exact === true) q.solverChecked = true;
          else {
            jobLabel(`Double-checking answer keys (${test.questions.length}/${total})`, signal);
            let ok = false;
            try { ok = await verifyQuestion(q, p.material, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
            if (!ok) { live('Dropped a question whose answer key could not be confirmed.', signal); continue; }
          }
          q.verified = true;
        }
        // Numeric questions in subjects you've reported problems in also get a program check.
        if (strict && q.type === 'NAT') {
          jobLabel(`Extra check: computing the answer with a program (${test.questions.length}/${total})`, signal);
          let c = null;
          try { c = await crossCheck(q.question, `## Answer\n${keyOf(q)}`, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
          if (c && c.agree === false) { live('Dropped a question the program disagreed with.', signal); continue; }
          if (c && c.agree) q.programChecked = true;
        }
        q.label = p.label || q.subject || p.subject || 'General';
        if (p.lesson != null) q.lesson = p.lesson;
        if (p.section) q.section = p.section;
        if (p.mistakeId) q.mistakeId = p.mistakeId;
        test.questions.push(q); need--;
      }
    }
  }
  progress(total, total, signal);
  if (!test.questions.length) throw new Error('No valid questions were produced. Try again, or untick "Double-check answer keys".');
  return test;
}

// ---------- grading ----------
function isAnswered(a) { return a != null && a !== '' && !(Array.isArray(a) && !a.length); }
function grade(q, a) {
  if (q.mta) return { status: 'correct', marks: q.marks };   // official key: "marks to all"
  if (!isAnswered(a)) return { status: 'skipped', marks: 0 };
  let ok;
  if (q.type === 'MCQ') ok = a === q.correct[0] || (q.alsoAccepted || []).includes(a);
  else if (q.type === 'MSQ') ok = [...a].sort().join() === q.correct.join();
  else { const v = parseFloat(a); ok = isFinite(v) && v >= q.nat_min - 1e-9 && v <= q.nat_max + 1e-9; }
  if (ok) return { status: 'correct', marks: q.marks };
  return { status: 'wrong', marks: q.type === 'MCQ' ? -q.marks / 3 : 0 };
}
function testMarks(t) { return t.questions.reduce((s, q) => s + q.marks, 0); }
function durationMin(t) { return t.minutes || Math.max(5, Math.round(testMarks(t) * 1.8)); }
function keyOf(q) { return q.type === 'NAT' ? (q.nat_min === q.nat_max ? String(q.nat_min) : `${q.nat_min} to ${q.nat_max}`) : q.correct.join(', '); }
function fmtAns(a) { return !isAnswered(a) ? '-' : Array.isArray(a) ? a.join(', ') : String(a); }

// ---------- on-screen calculator (like GATE's virtual calculator) ----------
function calcEval(expr) {
  let e = String(expr).toLowerCase().replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  if (!/^[0-9+\-*/().,^%a-z]*$/.test(e)) throw new Error('bad');
  const fns = { sqrt: 'Math.sqrt', log: 'Math.log10', ln: 'Math.log', sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', abs: 'Math.abs', pow: 'Math.pow', floor: 'Math.floor', ceil: 'Math.ceil', pi: 'Math.PI', e: 'Math.E' };
  const words = e.match(/[a-z]+/g) || [];
  if (words.some(w => !(w in fns))) throw new Error('bad');
  e = e.replace(/[a-z]+/g, w => fns[w]).replace(/\^/g, '**').replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
  return Function('"use strict";return (' + e + ')')();
}
// Like GATE's on-screen calculator: click the keys (or type), = evaluates, the result stays for the next step.
const CALC_KEYS = [['C', 'clear'], ['⌫', 'back'], ['(', '('], [')', ')'], ['÷', '/'],
  ['7', '7'], ['8', '8'], ['9', '9'], ['×', '*'], ['√', 'sqrt('],
  ['4', '4'], ['5', '5'], ['6', '6'], ['−', '-'], ['xʸ', '^'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+'], ['log', 'log('],
  ['0', '0'], ['.', '.'], ['π', 'pi'], ['=', 'eq'], ['ln', 'ln(']];
function calculatorHtml() {
  return `<details class="card calc" open><summary><b>Calculator</b> <span class="small muted">like the one in the exam</span></summary>
    <div class="vcalc-screen" style="margin-top:8px"><input type="text" class="calc-in" placeholder="0" style="width:100%;border:0;background:transparent;text-align:right;font:inherit;padding:0"><div class="res calc-out"></div></div>
    <div class="vcalc">${CALC_KEYS.map(([l, k]) => `<button type="button" data-ck="${escapeHtml(k)}" class="${k === 'eq' ? 'eq' : ''}">${l}</button>`).join('')}</div></details>`;
}
function wireCalculator(root) {
  const inp = $('.calc-in', root), out = $('.calc-out', root);
  const go = () => { try { const v = calcEval(inp.value); const s = Number.isFinite(v) ? String(+v.toPrecision(12)) : String(v); out.textContent = s; inp.value = s; } catch { out.textContent = 'Error'; } };
  root.querySelectorAll('[data-ck]').forEach(b => b.onclick = () => {
    const k = b.dataset.ck;
    if (k === 'eq') go();
    else if (k === 'clear') { inp.value = ''; out.textContent = ''; }
    else if (k === 'back') inp.value = inp.value.slice(0, -1);
    else inp.value += k;
  });
  inp.onkeydown = e => { if (e.key === 'Enter') go(); };
}

// ---------- test runner ----------
class TestRunner {
  constructor(el, test, { onSubmit, onExit } = {}) {
    this.el = el; this.test = test; this.onSubmit = onSubmit; this.onExit = onExit;
    this.i = 0; this.answers = {}; this.review = {}; this.time = {}; this.enter = Date.now();
    this.ends = Date.now() + durationMin(test) * 60000;
    el.innerHTML = `
      <div class="card row"><b style="flex:1">${escapeHtml(test.name)}</b><span class="pill warn tr-timer"></span>
        <button class="tr-exit">Exit</button><button class="primary tr-submit">Submit</button></div>
      <div class="layout">
        <div><div class="card"><b class="small">Question palette</b><div class="palette tr-pal" style="margin-top:8px"></div>
          <p class="small muted">Green = answered, amber = marked for review.</p></div>${calculatorHtml()}</div>
        <div class="card">
          <div class="row"><b class="tr-num"></b><span class="pill tr-meta"></span></div>
          <div class="md tr-q" style="margin:10px 0"></div><div class="tr-in"></div>
          <div class="row" style="margin-top:14px">
            <button class="tr-prev">&larr; Prev</button><button class="tr-clear">Clear</button>
            <button class="tr-review">Mark for review &amp; next</button><span style="flex:1"></span>
            <button class="primary tr-next">Save &amp; next &rarr;</button></div>
        </div></div>`;
    wireCalculator(el);
    $('.tr-prev', el).onclick = () => this.go(this.i - 1);
    $('.tr-next', el).onclick = () => this.go(this.i + 1);
    $('.tr-review', el).onclick = () => { this.review[this.i] = true; this.go(this.i + 1); };
    $('.tr-clear', el).onclick = () => { delete this.answers[this.i]; this.review[this.i] = false; this.render(); };
    $('.tr-submit', el).onclick = () => {
      const left = test.questions.length - Object.keys(this.answers).filter(k => isAnswered(this.answers[k])).length;
      if (confirm(left ? `${left} question(s) unanswered. Submit anyway?` : 'Submit the test?')) this.submit(false);
    };
    $('.tr-exit', el).onclick = () => { if (confirm('Exit without submitting? Your answers will be lost.')) { this.stop(); this.onExit && this.onExit(); } };
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick(); this.render();
  }
  stop() { clearInterval(this.timer); }
  tick() {
    const left = Math.max(0, this.ends - Date.now());
    $('.tr-timer', this.el).textContent = new Date(left).toISOString().slice(11, 19);
    if (left <= 0) this.submit(true);
  }
  leave() { this.time[this.i] = (this.time[this.i] || 0) + (Date.now() - this.enter) / 1000; this.enter = Date.now(); }
  go(i) { this.leave(); this.i = Math.max(0, Math.min(this.test.questions.length - 1, i)); this.render(); this.el.scrollIntoView({ behavior: 'smooth' }); }
  render() {
    const t = this.test, q = t.questions[this.i], a = this.answers[this.i], el = this.el;
    const pal = $('.tr-pal', el);
    pal.innerHTML = t.questions.map((q, k) => (q.section && (k === 0 || t.questions[k - 1].section !== q.section) ? `<span class="pal-sec">${escapeHtml(q.section)}</span>` : '') + `<button data-go="${k}" class="${isAnswered(this.answers[k]) ? 'answered' : ''} ${this.review[k] ? 'review' : ''} ${k === this.i ? 'current' : ''}">${k + 1}</button>`).join('');
    pal.querySelectorAll('[data-go]').forEach(b => b.onclick = () => this.go(+b.dataset.go));
    $('.tr-num', el).textContent = `Q${this.i + 1} of ${t.questions.length}`;
    $('.tr-meta', el).textContent = `${q.type} · ${q.marks}m · ` + (q.type === 'MCQ' ? `−${q.marks === 2 ? '2/3' : '1/3'} if wrong` : 'no negative');
    $('.tr-q', el).innerHTML = renderMd(q.question);
    const box = $('.tr-in', el);
    if (q.type === 'NAT') {
      box.innerHTML = `<label>Your answer <input type="number" step="any" inputmode="decimal" class="nat-in" style="width:180px"></label>`;
      const inp = $('.nat-in', box); inp.value = a ?? '';
      inp.oninput = () => { this.answers[this.i] = inp.value.trim(); this.paintPalette(); };
    } else {
      const multi = q.type === 'MSQ';
      box.innerHTML = (multi ? '<p class="small muted">Select all correct options.</p>' : '') + q.options.map((o, k) => {
        const L = 'ABCD'[k], on = multi ? (a || []).includes(L) : a === L;
        return `<label class="opt"><input type="${multi ? 'checkbox' : 'radio'}" name="opt" value="${L}" ${on ? 'checked' : ''}><b>${L}.</b><div class="md">${renderMd(o)}</div></label>`;
      }).join('');
      box.querySelectorAll('input').forEach(inp => inp.onchange = () => {
        this.answers[this.i] = multi ? [...box.querySelectorAll('input:checked')].map(x => x.value) : inp.value;
        this.paintPalette();
      });
    }
    $('.tr-prev', el).disabled = this.i === 0;
  }
  paintPalette() { $('.tr-pal', this.el).querySelectorAll('[data-go]').forEach(b => b.classList.toggle('answered', isAnswered(this.answers[+b.dataset.go]))); }
  submit(timeUp) {
    if (this.submitted) return;
    this.submitted = true;
    this.leave(); this.stop();
    const t = this.test;
    const results = t.questions.map((q, k) => ({ ...grade(q, this.answers[k]), answer: this.answers[k] ?? null, time: Math.round(this.time[k] || 0) }));
    const attempt = { id: uid(), testId: t.id, testName: t.name, at: new Date().toISOString(), timeUp, results,
      score: +results.reduce((s, r) => s + r.marks, 0).toFixed(2), max: testMarks(t), analysis: '' };
    this.onSubmit && this.onSubmit(attempt);
  }
}

// ---------- review & analysis ----------
const ERR_SCHEMA = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: {
  type: 'object', required: ['q', 'type'], properties: { q: { type: 'integer' }, type: { type: 'string', enum: ['conceptual', 'calculation', 'misread', 'guess'] } } } } } };

async function analyzeAttempt(test, attempt, { signal, onToken } = {}) {
  const lines = attempt.results.map((r, k) => {
    const q = test.questions[k];
    return `Q${k + 1} [${q.type}, ${q.marks}m, ${q.subject || ''} / ${q.label || ''}, concept: ${q.concept}] ${r.status.toUpperCase()} | student: ${fmtAns(r.answer)} | key: ${keyOf(q)} | time ${r.time}s | ${q.question.slice(0, 200).replace(/\n/g, ' ')}`;
  }).join('\n');
  const c = attempt.results.filter(r => r.status === 'correct').length, w = attempt.results.filter(r => r.status === 'wrong').length;
  const wrongIdx = attempt.results.map((r, k) => r.status === 'wrong' ? k : -1).filter(k => k >= 0);
  if (wrongIdx.length) {
    jobLabel('Classifying your mistakes', signal);
    try {
      const j = parseJSON(await ollamaChat([
        { role: 'system', content: 'Classify each wrong answer in a GATE mock test: conceptual (does not know the concept), calculation (right method, arithmetic slip), misread (answered a different question / missed a word like NOT), guess (answered very fast or randomly). Return JSON.' },
        { role: 'user', content: wrongIdx.map(k => lines.split('\n')[k]).join('\n') + '\n\nUse q = the question number.' },
      ], { signal, format: ERR_SCHEMA, temperature: 0 }));
      (j.items || []).forEach(it => { const r = attempt.results[it.q - 1]; if (r && r.status === 'wrong') r.errorType = it.type; });
    } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  jobLabel('Writing your analysis', signal);
  attempt.analysis = await ollamaChat([
    { role: 'system', content: `You are a GATE CS mentor analysing a mock test. Be specific, honest and encouraging. Use Markdown with these sections:
## Overall verdict
## Strengths
## Weak areas
(for each: the concept, what the mistake suggests and exactly how to fix it)
## Negative marking & time strategy
## Revision plan
(ordered list: what to revise and practise next, naming the topics)
Keep it concise and in points.${langNote()}` },
    { role: 'user', content: `Score ${attempt.score}/${attempt.max}. Correct ${c}, wrong ${w}, skipped ${attempt.results.length - c - w}.${attempt.timeUp ? ' Time ran out.' : ''}\n\nPer question:\n${lines}` },
  ], { signal, numCtx: 12288, onToken });
  return attempt;
}

function attemptStats(test, attempt) {
  const by = {};
  attempt.results.forEach((r, k) => {
    const q = test.questions[k];
    const key = q.label || q.subject || 'General';
    by[key] = by[key] || { correct: 0, wrong: 0, skipped: 0, marks: 0, max: 0 };
    by[key][r.status]++; by[key].marks += r.marks; by[key].max += q.marks;
  });
  const c = attempt.results.filter(r => r.status === 'correct').length, w = attempt.results.filter(r => r.status === 'wrong').length;
  return { by, c, w, s: attempt.results.length - c - w };
}
// Horizontal bars, one hue; the number is written in ink. rows: [{ label, value (0-100), text, title }]
function hbars(rows, { target } = {}) {
  return rows.map(r => `<div class="hbar" title="${escapeHtml(r.title || '')}"><span>${escapeHtml(r.label)}</span>
    <div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, r.value))}%"></div>${target != null ? `<span class="target" style="left:${target}%"></span>` : ''}</div>
    <span class="val">${escapeHtml(r.text)}</span></div>`).join('');
}
function barHtml(label, val, max, right) {
  const pct = max ? Math.max(0, Math.min(100, 100 * val / max)) : 0;
  return `<div style="margin-top:10px"><div class="row small"><span style="flex:1">${escapeHtml(label)}</span><span>${right}</span></div>
    <div class="bar"><div style="width:${pct}%;background:${pct >= 70 ? 'var(--ok)' : pct >= 40 ? 'var(--warn)' : 'var(--bad)'}"></div></div></div>`;
}
// Renders score tiles, breakdown, AI analysis and per-question review into el.
// How sure we are about a question's answer key.
function keyLevel(q) { return q.solverChecked ? 'exact' : q.programChecked ? 'high' : q.verified ? 'good' : 'unchecked'; }
function confidenceTag(q) {
  const cal = t => escapeHtml(t + (Calib.note(keyLevel(q)) ? ' ' + Calib.note(keyLevel(q)) : ''));
  if (q.solverChecked) return `<span class="conf high" title="${cal('A built-in exact calculator computed the same answer')}">✓ computed exactly</span>`;
  if (q.programChecked) return `<span class="conf high" title="${cal('A step-by-step program computed the same answer')}">✓ checked by program</span>`;
  if (q.verified) return `<span class="conf good" title="${cal('Solved a second time independently; both agree')}">✓ key double-checked</span>`;
  return '<span class="conf low" title="This key was not independently checked">key not verified</span>';
}
const SECOND_SCHEMA = { type: 'object', required: ['method', 'working', 'correct', 'nat_value'], properties: {
  method: { type: 'string' }, working: { type: 'string' },
  correct: { type: 'array', items: { type: 'string', enum: ['A', 'B', 'C', 'D'] } }, nat_value: { type: 'number' } } };
// Re-solves a question from scratch by a different method and compares with the key.
async function secondOpinion(q, signal) {
  const opts = q.options.map((o, i) => `${'ABCD'[i]}. ${o}`).join('\n');
  const r = parseJSON(await ollamaChat([
    { role: 'system', content: `You are a second GATE CS examiner. Solve the question from scratch WITHOUT trusting any given answer, preferably by a different method than the obvious one (e.g. work backwards, eliminate options, use a small concrete example, or simulate). "working" = your concise step-by-step solution in Markdown (LaTeX allowed). Then give the final answer: options in "correct" (empty for numeric) and the number in "nat_value" (0 if not numeric).` },
    { role: 'user', content: `${q.type} question:\n${q.question}\n${opts}` },
  ], { signal, format: SECOND_SCHEMA, temperature: 0.2, maxTokens: 1800, model: checkModel() }));
  let agree;
  if (q.type === 'NAT') agree = isFinite(r.nat_value) && r.nat_value >= q.nat_min - 1e-6 && r.nat_value <= q.nat_max + 1e-6;
  else agree = [...new Set(r.correct || [])].sort().join() === q.correct.join();
  return { agree, method: r.method, working: r.working, answer: q.type === 'NAT' ? String(r.nat_value) : (r.correct || []).join(', ') || '-' };
}
function verdictFor(pct) {
  return pct >= 85 ? ['GATE-ready on this. Excellent!', 'var(--green)'] : pct >= 70 ? ['Solid work.', 'var(--green)']
    : pct >= 40 ? ['Getting there. Fix the few below.', 'var(--amber)'] : ['A rough one. Let\'s fix it together.', 'var(--red)'];
}
// ---------- time coaching (any test with 8+ questions) ----------
// GATE gives 180 minutes for 100 marks: about 1.8 minutes per mark, so ~110 s for a 1-mark and ~220 s for a 2-mark question.
// Plain arithmetic on the time you spent on each question; no model involved.
function timeCoach(test, attempt) {
  const rows = attempt.results.map((r, k) => ({ r, q: test.questions[k], k, ideal: 108 * (test.questions[k].marks || 1) }));
  if (rows.length < 8) return null;
  const by = m => { const x = rows.filter(o => (o.q.marks || 1) === m && o.r.status !== 'skipped'); const t = x.reduce((s, o) => s + o.r.time, 0); return { n: x.length, avgSec: x.length ? t / x.length : 0, right: x.filter(o => o.r.status === 'correct').length, marks: x.reduce((s, o) => s + o.r.marks, 0), perMin: t ? x.reduce((s, o) => s + o.r.marks, 0) / (t / 60) : 0 }; };
  const one = by(1), two = by(2);
  const sinks = rows.filter(o => o.r.time > 2 * o.ideal && o.r.status !== 'correct').sort((a, b) => b.r.time - a.r.time);
  const rushed = rows.filter(o => o.r.status === 'wrong' && o.r.time < 0.25 * o.ideal && o.r.time > 0);
  const slowRight = rows.filter(o => o.r.status === 'correct' && o.r.time > 2 * o.ideal);
  const lostTime = sinks.reduce((s, o) => s + o.r.time - o.ideal, 0);
  // Unseen at the end because time ran out: trailing skipped questions with (almost) no time on them.
  let tail = 0; for (let k = rows.length - 1; k >= 0 && rows[k].r.status === 'skipped' && rows[k].r.time < 10; k--) tail++;
  const tips = [];
  if (attempt.timeUp && tail) tips.push(`Time ran out with <b>${tail}</b> question${tail > 1 ? 's' : ''} never seen. Do a first pass that skips anything you can't start within a minute, then come back.`);
  if (sinks.length) tips.push(`<b>${sinks.length}</b> question${sinks.length > 1 ? 's' : ''} took more than twice their share of time and still didn't score (about ${Math.round(lostTime / 60)} min lost). Set yourself a cut-off: 3½ min for a 1-mark, 7 min for a 2-mark, then mark for review and move on.`);
  if (rushed.length) tips.push(`<b>${rushed.length}</b> wrong answer${rushed.length > 1 ? 's were' : ' was'} given in under a quarter of the usual time: slow down on the read; ${rushed.some(o => o.q.type === 'MCQ') ? 'a rushed MCQ also costs negative marks.' : 'a re-read costs less than a wrong answer.'}`);
  if (one.n && two.n && one.perMin && two.perMin) tips.push(one.perMin >= two.perMin * 1.2 ? `You score faster on 1-mark questions (${one.perMin.toFixed(2)} vs ${two.perMin.toFixed(2)} marks a minute): sweep all the 1-mark questions first.` : two.perMin >= one.perMin * 1.2 ? `You score faster on 2-mark questions (${two.perMin.toFixed(2)} vs ${one.perMin.toFixed(2)} marks a minute): start with the 2-mark questions you recognise.` : 'Your marks per minute are similar on 1- and 2-mark questions, so the order matters less than the cut-off.');
  if (!tips.length) tips.push('Good pacing: no time sinks and no rushed answers.');
  return { one, two, sinks: sinks.slice(0, 5), slowRight: slowRight.length, tips };
}
function timeCoachHtml(test, attempt) {
  const t = timeCoach(test, attempt);
  if (!t) return '';
  const sec = s => s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
  const line = (lab, x, ideal) => x.n ? `<div class="stat"><span>${lab}</span><b>${sec(x.avgSec)}</b><span class="small muted">each (aim ≈ ${ideal}) · ${x.right}/${x.n} right</span></div>` : '';
  return `<div class="card time-coach"><div class="card-title">How you used your time</div>
    <div class="stats" style="margin-top:8px">${line('1-mark questions', t.one, '1m 50s')}${line('2-mark questions', t.two, '3m 40s')}</div>
    <ul class="small" style="margin:10px 0 0">${t.tips.map(x => `<li>${x}</li>`).join('')}</ul>
    ${t.sinks.length ? `<p class="small muted" style="margin-top:8px">Biggest time sinks: ${t.sinks.map(o => `Q${o.k + 1} (${sec(o.r.time)}, ${o.r.status === 'wrong' ? 'wrong' : 'skipped'})`).join(' · ')}</p>` : ''}</div>`;
}
// Renders the results: score reveal, "redo these first", mentor's review, breakdown, then each question.
// opts: { onReanalyze, onReport, onRetest(questions) }
function renderAttempt(el, test, attempt, { onReanalyze, onReport, onRetest } = {}) {
  const { by, c, w, s } = attemptStats(test, attempt);
  const attempted = c + w, time = attempt.results.reduce((x, r) => x + r.time, 0);
  const neg = attempt.results.reduce((x, r) => x + (r.marks < 0 ? -r.marks : 0), 0);
  const pct = attempt.max ? Math.max(0, 100 * attempt.score / attempt.max) : 0;
  const [verdict, vColor] = verdictFor(pct);
  const redo = attempt.results.map((r, k) => ({ r, q: test.questions[k], k })).filter(x => x.r.status === 'wrong')
    .sort((a, b) => b.q.marks - a.q.marks || a.r.marks - b.r.marks).slice(0, 3);
  el.innerHTML = `
    <div class="card result-hero">
      <div class="score-ring big" style="--p:0"><b class="count">0</b><span>of ${attempt.max}</span></div>
      <div style="flex:1;min-width:220px">
        <div class="hand" style="font-size:30px;color:${vColor}">${escapeHtml(verdict)}</div>
        <div class="stats" style="margin-top:10px">
          <div class="stat"><span>Accuracy</span><b>${attempted ? Math.round(100 * c / attempted) : 0}%</b></div>
          <div class="stat"><span>Right · wrong · skipped</span><b>${c} · ${w} · ${s}</b></div>
          <div class="stat"><span>Lost to negatives</span><b>${neg ? '&minus;' + neg.toFixed(2) : '0'}</b></div>
          <div class="stat"><span>Time used</span><b>${Math.round(time / 60)} min</b></div>
        </div>
      </div>
    </div>
    ${redo.length ? `<div class="card redo"><div class="row"><div class="card-title" style="flex:1">Redo these first</div>${onRetest ? '<button class="primary ra-retest">Retest just these</button>' : ''}</div>
      <p class="small muted" style="margin:2px 0 8px">Your costliest mistakes. Understand these and the rest follows.</p>
      ${redo.map(x => `<div class="redo-item"><b>Q${x.k + 1} · ${escapeHtml(x.q.concept || 'Concept')}</b> <span class="pill bad">${x.q.marks} mark${x.q.marks > 1 ? 's' : ''}${x.r.marks < 0 ? `, &minus;${(-x.r.marks).toFixed(2)}` : ''}</span>
        <div class="small muted">${escapeHtml(plainText(x.q.explanation).replace(/\s+/g, ' ').slice(0, 160))}…</div></div>`).join('')}</div>` : ''}
    ${timeCoachHtml(test, attempt)}
    <div class="card"><div class="row"><div class="card-title" style="flex:1">Mentor's review</div>${onReanalyze ? '<button class="link ra-re">Write it again</button>' : ''}</div>
      <div class="md analysis-box">${attempt.analysis ? renderMd(attempt.analysis) : '<p class="empty">Going through your answers&hellip;</p>'}</div></div>
    <div class="card"><div class="card-title">Where the marks went</div><p class="small muted" style="margin:2px 0 8px">Dashed line = 70% target.</p>${hbars(Object.entries(by).map(([k, v]) => ({ label: k, value: v.max ? 100 * Math.max(0, v.marks) / v.max : 0, text: `${+v.marks.toFixed(2)} / ${v.max}`, title: `${v.correct} right, ${v.wrong} wrong, ${v.skipped} skipped` })), { target: 70 })}</div>
    <div class="card"><div class="row"><div class="card-title" style="flex:1">Question by question</div>
      <div class="subj-tabs ra-filter" style="margin:0"><button data-f="all" class="active">All ${attempt.results.length}</button><button data-f="wrong">Wrong ${w}</button><button data-f="skipped">Skipped ${s}</button><button data-f="correct">Right ${c}</button></div></div>
      ${attempt.results.map((r, k) => {
        const q = test.questions[k];
        const opts = q.type === 'NAT' ? '' : q.options.map((o, j) => {
          const L = 'ABCD'[j], picked = Array.isArray(r.answer) ? r.answer.includes(L) : r.answer === L;
          return `<div class="opt ${q.correct.includes(L) ? 'correct' : picked ? 'wrong' : ''}"><b>${L}.</b><div class="md">${renderMd(o)}</div>${picked ? '<span class="small">your pick</span>' : ''}</div>`;
        }).join('');
        return `<details class="review-q" data-status="${r.status}" ${r.status === 'wrong' ? 'open' : ''}>
          <summary class="row"><b>Q${k + 1}</b><span class="pill ${r.status === 'correct' ? 'ok' : r.status === 'wrong' ? 'bad' : ''}">${r.status === 'correct' ? 'right' : r.status} (${r.marks > 0 ? '+' : ''}${+r.marks.toFixed(2)})</span>
            ${r.errorType ? `<span class="pill warn">${r.errorType}</span>` : ''}<span class="small muted" style="flex:1">${q.type} · ${escapeHtml(q.concept || '')} · ${r.time}s</span>${confidenceTag(q)}</summary>
          <div class="md">${renderMd(q.question)}</div>${opts}
          ${q.type === 'NAT' ? `<p>Your answer: <b>${escapeHtml(fmtAns(r.answer))}</b> &middot; Correct: <b>${escapeHtml(keyOf(q))}</b></p>` : ''}
          <div class="md explain"><b>Explanation</b>${renderMd(q.explanation)}</div>
          <div class="row" style="margin-top:8px"><button class="link" data-second="${k}">${icon('refresh')} Second opinion</button>${onReport ? `<button class="link" data-report="${k}">Report wrong question</button>` : ''}</div>
          <div class="second-out" data-out="${k}"></div></details>`;
      }).join('')}</div>`;
  // Score reveal: ring fills and the number counts up.
  const ring = $('.score-ring.big', el), num = $('.count', el), t0 = performance.now(), target = attempt.score;
  const step = now => { const f = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - f, 3); ring.style.setProperty('--p', pct * e); num.textContent = (+(target * e).toFixed(2)).toString(); if (f < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  setTimeout(() => { ring.style.setProperty('--p', pct); num.textContent = String(target); }, 1200);   // in case animation frames are paused
  if (onReanalyze) $('.ra-re', el).onclick = onReanalyze;
  if (onRetest && redo.length) $('.ra-retest', el).onclick = () => onRetest(redo.map(x => x.q));
  el.querySelectorAll('.ra-filter [data-f]').forEach(b => b.onclick = () => {
    el.querySelectorAll('.ra-filter [data-f]').forEach(x => x.classList.toggle('active', x === b));
    el.querySelectorAll('.review-q').forEach(d => d.classList.toggle('hidden', b.dataset.f !== 'all' && d.dataset.status !== b.dataset.f));
  });
  el.querySelectorAll('[data-second]').forEach(b => b.onclick = () => {
    const k = +b.dataset.second, q = test.questions[k], out = $(`[data-out="${k}"]`, el);
    b.disabled = true;
    out.innerHTML = '<p class="empty">Solving it again, a different way&hellip;</p>';
    runJob('Getting a second opinion', async signal => {
      const r = await secondOpinion(q, signal);
      out.innerHTML = `<div class="check ${r.agree ? 'ok' : 'bad'}">${r.agree ? '✓ Second opinion agrees with the key.' : `⚠ Second opinion disagrees: it gets <b>${escapeHtml(r.answer)}</b> (key: <b>${escapeHtml(keyOf(q))}</b>). Look at both workings; if the key is wrong, report the question.`}
        <details ${r.agree ? '' : 'open'}><summary class="small">Its working (${escapeHtml(r.method || 'independent method')})</summary><div class="md">${renderMd(r.working)}</div></details></div>`;
    }, () => { b.disabled = false; });
  });
  if (onReport) el.querySelectorAll('[data-report]').forEach(b => b.onclick = () => {
    const reason = prompt('What is wrong with this question? (e.g. wrong answer key, ambiguous)');
    if (reason == null) return;
    onReport(test.questions[+b.dataset.report], reason);
    b.disabled = true; b.textContent = 'Reported. Future questions will avoid this.';
  });
}

// ---------- hub bookkeeping ----------
function recordAttempt(source, test, attempt) {
  return updateHub(h => {
    h.attempts.push({
      id: attempt.id, source, name: test.name, kind: test.kind, at: attempt.at, score: attempt.score, max: attempt.max, timeUp: attempt.timeUp,
      results: attempt.results.map((r, k) => { const q = test.questions[k]; return { subject: q.subject, concept: q.concept, label: q.label, status: r.status, marks: r.marks, max: q.marks, time: r.time, errorType: r.errorType || null }; }),
    });
    const outcome = { advanced: 0, conquered: 0, early: 0, reset: 0 };
    attempt.results.forEach((r, k) => {
      const q = test.questions[k];
      const m = h.mistakes.find(x => (q.mistakeId && x.id === q.mistakeId) || x.q.question === q.question);
      if (m && r.status !== 'skipped') outcome[reviewApply(h, m, r.status === 'correct', 'retest', attempt.at)]++;
      else if (r.status === 'wrong' && !m) {
        h.mistakes.push({ id: uid(), q, source, at: attempt.at, answer: r.answer, errorType: r.errorType || null, attemptId: attempt.id, k, review: { stage: 0, base: attempt.at }, ...(q.pyqId ? { pyqId: q.pyqId } : {}) });
      }
    });
    lastReviewOutcome = outcome;
  });
}
let lastReviewOutcome = null;   // what the last test did to the review schedule (shown after a review)

// ---------- spaced mistake reviews ----------
// A mistake comes back 1, 3 and 7 days after it was made. A correct answer counts only once that review is
// due; passing the day-7 review conquers it. A wrong answer restarts the schedule from that moment.
const REVIEW_DAYS = [1, 3, 7];
function reviewInfo(m, now = Date.now()) {
  const r = m.review || { stage: 0, base: m.at };
  const stage = Math.min(r.stage || 0, REVIEW_DAYS.length - 1);
  const due = new Date(new Date(r.base || m.at).getTime() + REVIEW_DAYS[stage] * 864e5);
  return { stage, base: r.base || m.at, due, isDue: now >= due.getTime(), day: REVIEW_DAYS[stage], lapses: r.lapses || 0 };
}
// Applies one review answer to mistake m inside an updateHub. Returns 'advanced' | 'conquered' | 'early' | 'reset'.
function reviewApply(h, m, correct, how, at = new Date().toISOString()) {
  const info = reviewInfo(m, new Date(at).getTime());
  if (!correct) {
    m.review = { stage: 0, base: at, lapses: info.lapses + 1, last: at };
    return 'reset';
  }
  if (!info.isDue) return 'early';   // answering right before the review is due doesn't count yet
  if (info.stage + 1 >= REVIEW_DAYS.length) {
    h.fixed = (h.fixed || []).concat([fixedEntry(m, 'review', at)]).slice(-300);
    h.mistakes = h.mistakes.filter(x => x.id !== m.id);
    return 'conquered';
  }
  m.review = { stage: info.stage + 1, base: info.base, lapses: info.lapses, last: at, passed: (m.review && m.review.passed || []).concat([REVIEW_DAYS[info.stage]]) };
  return 'advanced';
}
function dueMistakes(list, now = Date.now()) { return list.filter(m => reviewInfo(m, now).isDue); }
function fixedEntry(m, how, at = new Date().toISOString()) {
  return { id: m.id, at, how, since: m.at, concept: m.q.concept || '', subject: m.q.subject || '', errorType: m.errorType || null, question: plainText(m.q.question).replace(/\s+/g, ' ').slice(0, 140) };
}
// One review answered in the Mistake lab card. Resolves to the outcome.
async function reviewMistake(id, correct) {
  let out = null;
  await updateHub(h => { const m = h.mistakes.find(x => x.id === id); if (m) out = reviewApply(h, m, correct, 'retry'); });
  return out;
}
// "Not a real mistake" (a bad question): removed without counting as conquered.
function removeMistake(id) { return updateHub(h => { h.mistakes = h.mistakes.filter(x => x.id !== id); }); }
function patchAttemptErrors(attempt) {
  return updateHub(h => {
    const a = h.attempts.find(x => x.id === attempt.id);
    if (a) attempt.results.forEach((r, k) => { if (a.results[k]) a.results[k].errorType = r.errorType || null; });
    h.mistakes.forEach(m => { if (m.attemptId === attempt.id && attempt.results[m.k]) m.errorType = attempt.results[m.k].errorType || null; });
  });
}
function reportQuestion(q, reason, source) {
  return updateHub(h => {
    h.reports.push({ at: new Date().toISOString(), reason, source, q });
    // A reported key counts as a miss for its confidence level, so the labels stay honest.
    h.calib = h.calib || {}; const c = h.calib[keyLevel(q)] = h.calib[keyLevel(q)] || { n: 0, right: 0 }; c.n++;
    h.mistakes = h.mistakes.filter(m => m.q.question !== q.question);
  });
}

// ---------- flashcards (spaced repetition, SM-2 style) ----------
const CARD_SCHEMA = { type: 'object', required: ['cards'], properties: { cards: { type: 'array', items: {
  type: 'object', required: ['front', 'back'], properties: { front: { type: 'string' }, back: { type: 'string' } } } } } };
async function makeCards(md, signal) {
  const raw = await ollamaChat([
    { role: 'system', content: 'Create GATE CS revision flashcards from the lesson: key formulas, definitions, facts and common traps. Front = a short question/prompt; back = a crisp answer of at most 2 sentences (use LaTeX $...$ for math). Never work through a long example on a card. 6 to 10 cards. Return JSON.' },
    { role: 'user', content: md.slice(0, 8000) },
  ], { signal, format: CARD_SCHEMA, temperature: 0.3 });
  let cards = [];
  try { cards = parseJSON(raw).cards || []; } catch {}
  // A reply cut off mid-card (one answer ran on until the length limit) is not valid JSON: keep the complete cards.
  if (!cards.length) for (const m of String(raw).matchAll(/\{\s*"front"\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*"back"\s*:\s*("(?:[^"\\]|\\.)*")\s*\}/g)) { try { cards.push({ front: JSON.parse(m[1]), back: JSON.parse(m[2]) }); } catch {} }
  return cards.filter(c => c.front && c.back && c.back.length <= 600).slice(0, 12);   // a rambling answer is not a flashcard
}
function addCards(cards, subject, source) {
  return updateHub(h => {
    const now = Date.now();
    for (const c of cards) {
      if (h.cards.some(x => x.front === c.front)) continue;
      h.cards.push({ id: uid(), front: c.front, back: c.back, subject, source, due: now, interval: 0, ease: 2.5, reps: 0 });
    }
  });
}
// g: 0 again, 1 hard, 2 good, 3 easy
function scheduleCard(c, g) {
  const day = 86400000;
  if (g === 0) { c.reps = 0; c.interval = 0; c.ease = Math.max(1.3, c.ease - 0.2); c.due = Date.now() + 10 * 60000; return c; }
  c.reps++;
  c.interval = c.reps === 1 ? 1 : c.reps === 2 ? 3 : Math.round(c.interval * c.ease * (g === 1 ? 0.8 : g === 3 ? 1.3 : 1));
  c.ease = Math.min(2.8, Math.max(1.3, c.ease + (g - 2) * 0.1));
  c.due = Date.now() + c.interval * day;
  return c;
}

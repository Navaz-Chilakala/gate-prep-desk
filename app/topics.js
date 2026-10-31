// Covered-topics list: every lesson adds subject > topic > subtopics > key terms. Asking for something
// again (even a subtopic inside an older lesson) finds it, and the list is mirrored to
// "My GATE topics.md" in the app folder.

const TOPIC_STOP = new Set('the a an of in on and or for to with what is are how why explain teach me about using use vs versus between gate cs basics basic intro introduction concept concepts part step lesson notes topic please tell give simple'.split(' '));
function topicTokens(s) {
  return String(s || '').toLowerCase().replace(/\$[^$]*\$/g, ' ').replace(/[^a-z0-9+#]+/g, ' ').split(' ')
    .filter(w => w.length > 1 && !TOPIC_STOP.has(w)).map(w => w.length > 4 ? w.replace(/(ing|ies|es|s)$/, '') : w);
}
function stripMd(s) { return plainText(s).replace(/\s+/g, ' ').trim(); }

const GENERIC_STEP = /^(the\s+)?(core idea|intuiti|precise definition|definition and rules|formal definition|how it works|mechanic|(a\s+)?fully worked example|worked example|variants|edge cases|harder gate|gate-style|mathematical proof|why it works|comparison|putting it together|summary)/i;
// Labels from worked examples and action phrases are not concepts ("Given", "Problem", "Check ready queue").
const GENERIC_TERM = /^(definition|example|analogy|note|why|key terms?|mistake|correction|answer|q|a|step \d*|given|problem|solution|result|results|rules?|formal rules?|scenario|case \d*|input|output|calculation|final answer|observation|conclusion|recap|setup|initial state|final state|example d+|(check|select|calculate|compute|find|update|repeat|add|move|pick|run|start|stop|go)\b.*)$/i;
// Headings that are not real subtopics (connectors, questions to the reader, placeholders).
const JUNK_SUB = /^(and|or|but|so|why\??|what\??|how\??|when\??|question|questions|answer|numbers?|characters?|current state|summary|recap|overview|intro(duction)?|\W*|.{0,2})$/i;
// Topic, subtopics (lesson steps) and key terms (bold words inside each step) from a lesson's Markdown.
function lessonOutline(md, fallbackTitle) {
  // Heading without a leading subject name ("Computer Organization and Architecture - Pipelining" -> "Pipelining");
  // a heading that is only a subject falls back to what was asked.
  let title = stripMd(((String(md).match(/^#\s+(.+)$/m) || [])[1] || '').trim());
  for (const s of SUBJECTS) if (title.toLowerCase().startsWith(s.toLowerCase())) title = title.slice(s.length).replace(/^[\s:\-–—|]+/, '');
  if (!title) title = fallbackTitle || 'Untitled';
  const parts = String(md).split(/^(?=## )/m).slice(1);
  const subtopics = [];
  for (const p of parts) {
    const h = ((p.match(/^##\s*(.+)$/m) || [])[1] || '').trim();
    if (!h || /formula|fact|trap|mistake|quick check|try it|summary|practice|big picture|before we start|prerequisite/i.test(h)) continue;
    const name = stripMd(h.replace(/^step\s*\d+\s*[:.\-–]\s*/i, ''));
    const terms = [...new Set([...p.matchAll(/\*\*([^*\n]{2,40})\*\*/g)].map(m => stripMd(m[1]).replace(/[:.]$/, '')).filter(t => t && !GENERIC_TERM.test(t)))].slice(0, 8);
    // A step titled only by its role ("The core idea", "Worked example") is filed under the concepts it teaches.
    if (GENERIC_STEP.test(name)) { terms.slice(0, 2).forEach(t => { if (!subtopics.some(s => s.name.toLowerCase() === t.toLowerCase())) subtopics.push({ name: t, terms: [] }); }); continue; }
    if (name) subtopics.push({ name, terms });
  }
  return { subject: lessonSubject(md) || 'Other', topic: title, subtopics };
}

function sourceKey(src) { return src.kind === 'topic' ? 'topic:' + src.key : `lesson:${src.siteId}:${src.from}-${src.to}`; }
async function recordCovered(md, source) {
  if (!md || !md.trim()) return;
  const o = lessonOutline(md, source.title);
  const now = source.at || new Date().toISOString(), key = sourceKey(source);
  await updateHub(h => {
    h.covered = h.covered || [];
    const e = h.covered.find(x => x.key === key);
    if (e) Object.assign(e, o, { source, last: now, times: (e.times || 1) + (source.revisit ? 1 : 0) });
    else h.covered.push(Object.assign({ id: uid(), key, source, first: now, last: now, times: 1 }, o));
  });
  syncTopicsFile();
  const label = source.kind === 'topic' ? `Lesson: ${o.topic}` : `${prettyName(source.siteName || 'Notes')}: ${o.topic}`;
  await collectFormulas(md, o.subject, { kind: source.kind, label, href: source.kind === 'topic' ? `index.html?topic=${encodeURIComponent(source.key)}#ask` : coveredHref({ source }) });
}
async function noteRevisit(key) {
  await updateHub(h => { const e = (h.covered || []).find(x => x.key === key); if (e) { e.times = (e.times || 1) + 1; e.last = new Date().toISOString(); } });
  syncTopicsFile();
}

// Best earlier match for a request: { entry, level: 'topic' | 'subtopic' | 'term', name } or null.
function findCovered(query, covered) {
  const q = topicTokens(query);
  if (!q.length) return null;
  let best = null;
  const consider = (entry, level, name, weight) => {
    const c = topicTokens(name);
    if (!c.length) return;
    const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));   // cache ~ caching
    const inter = q.filter(w => c.some(x => same(w, x))).length, inC = c.filter(x => q.some(w => same(w, x))).length;
    const cover = inter / q.length, fit = inC / c.length;
    // Most of the request is in the name, or the whole name is in the request ("cache memory" ~ "Caching").
    // (the second rule only for whole topics: a one-word term like "Structure" must not match "PCB structure")
    if (!((cover >= 0.75 && fit >= 0.5) || (level === 'topic' && fit === 1 && cover >= 0.5))) return;
    const score = cover * 2 + fit + weight;
    if (!best || score > best.score) best = { entry, level, name, score };
  };
  for (const e of covered || []) {
    consider(e, 'topic', e.topic, 0.3);
    for (const s of e.subtopics || []) {
      consider(e, 'subtopic', s.name, 0.2);
      for (const t of s.terms || []) consider(e, 'term', t, 0);
    }
  }
  return best;
}
function whereLabel(e) { return e.source.kind === 'topic' ? 'Learn' : (prettyName(e.source.siteName || 'your notes') + (e.source.from ? `, pages ${e.source.from}–${e.source.to}` : '')); }
function coveredHref(e) { return e.source.kind === 'lesson' ? `site.html?id=${e.source.siteId}&lesson=${e.source.lesson}#learn` : null; }
function fmtDay(iso) { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }

// "You've already covered this" card. Returns a Promise<'open' | 'again'>.
function askCovered(el, hit) {
  const e = hit.entry;
  const what = hit.level === 'topic' ? `<b>${escapeHtml(e.topic)}</b>`
    : `<b>${escapeHtml(hit.name)}</b>, as part of your lesson <i>${escapeHtml(e.topic)}</i>`;
  el.innerHTML = `<div class="card covered-note">
    <div class="hand" style="font-size:24px;color:var(--green)">You've been here before!</div>
    <p style="margin:6px 0 4px">You already covered ${what}.</p>
    <p class="small muted" style="margin:0 0 12px">${escapeHtml(e.subject)} &middot; ${escapeHtml(whereLabel(e))} &middot; first on ${fmtDay(e.first)}${e.times > 1 ? ` &middot; studied ${e.times} times` : ''}</p>
    <div class="row"><button class="primary" data-c="open">${icon('book')} Open that lesson</button><button data-c="again">${icon('refresh')} Teach it again anyway</button></div></div>`;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return new Promise(res => el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { el.classList.add('hidden'); el.innerHTML = ''; res(b.dataset.c); }));
}

// ---------- the list as Markdown (file on the laptop + download) ----------
function topicsMarkdown(covered) {
  const bySubject = {};
  (covered || []).forEach(e => (bySubject[e.subject] = bySubject[e.subject] || []).push(e));
  const order = SUBJECTS.concat(['Other']);
  const out = ['# My GATE topics', `_Updated ${new Date().toLocaleString()} · ${(covered || []).length} lessons_`, ''];
  Object.keys(bySubject).sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach(s => {
    out.push(`## ${s}`, '');
    bySubject[s].sort((a, b) => a.topic.localeCompare(b.topic)).forEach(e => {
      out.push(`### ${e.topic}`, `_${whereLabel(e)} · first ${fmtDay(e.first)} · last ${fmtDay(e.last)} · studied ${e.times || 1}×_`, '');
      (e.subtopics || []).forEach(st => out.push(`- ${st.name}${st.terms && st.terms.length ? ` — ${st.terms.join(', ')}` : ''}`));
      out.push('');
    });
  });
  return out.join('\n');
}
let topicsSyncTimer = null;
function syncTopicsFile() {
  clearTimeout(topicsSyncTimer);
  topicsSyncTimer = setTimeout(async () => {
    if (Store.mode !== 'server') return;
    try { const h = await Store.getHub(); await fetch('/api/topics-file', { method: 'PUT', body: topicsMarkdown(h.covered) }); } catch {}
  }, 800);
}

// ---------- mastery: a topic is "closed" only after passing a twisted quiz ----------
async function markMastery(key, passed, score) {
  await updateHub(h => {
    const e = (h.covered || []).find(x => x.key === key);
    if (!e) return;
    e.tries = (e.tries || 0) + 1;
    e.lastTry = new Date().toISOString();
    if (passed) { e.mastered = e.lastTry; e.masteryScore = score; }
  });
  syncTopicsFile();
}
// Mounts the mastery check under a lesson.
// opts: { key, topic, subject, material(), source, onPass(), lessonMd() }
class MasteryCheck {
  constructor(el, opts) { this.el = el; this.o = opts; this.asked = []; }
  async render() {
    const h = await Store.getHub();
    const e = (h.covered || []).find(x => x.key === this.o.key);
    this.el.classList.remove('hidden');
    if (e && e.mastered) {
      this.el.innerHTML = `<div class="card mastery done"><div class="row"><div style="flex:1"><div class="hand" style="font-size:26px;color:var(--green)">${icon('check')} Topic closed</div>
        <p class="small muted" style="margin:2px 0 0">Passed ${fmtDay(e.mastered)}${e.masteryScore ? ` (${e.masteryScore})` : ''}.</p></div>
        <button class="link" data-m="start">Retake</button></div></div>`;
    } else {
      this.el.innerHTML = `<div class="card mastery"><div class="card-title">Mastery check</div>
        <p class="lede" style="margin:4px 0 12px">5 tricky questions · 4 correct closes the topic.${e && e.tries ? ` <span class="muted">(${e.tries} earlier tr${e.tries > 1 ? 'ies' : 'y'})</span>` : ''}</p>
        <div class="row"><button class="primary" data-m="start">${icon('pencil')} Start</button><span class="small muted">~15 min</span></div></div>`;
    }
    this.el.querySelectorAll('[data-m=start]').forEach(b => b.onclick = () => this.start());
  }
  start() {
    let test = null;
    runJob('Writing your mastery check', async signal => {
      const make = (count, avoid) => buildTest({
        name: `Mastery check: ${this.o.topic}`, kind: 'mastery', minutes: 15,
        plan: [{ material: this.o.material(), label: this.o.topic, subject: this.o.subject || '', count, avoid }],
        types: ['MCQ', 'MSQ', 'NAT'], diff: 'Hard', verify: true, twisted: true, signal,
      });
      test = await make(5, this.asked);
      // The answer-key check drops questions it can't confirm: write the missing ones once more.
      if (test.questions.length < 5) {
        const more = await make(5 - test.questions.length, [...this.asked, ...test.questions.map(q => q.question)]).catch(e => { if (e.name === 'AbortError') throw e; return { questions: [] }; });
        test.questions.push(...more.questions);
      }
      this.asked.push(...test.questions.map(q => q.question));
    }, () => { if (test) this.run(test); });
  }
  run(test) {
    new TestRunner(this.el, test, {
      onExit: () => this.render(),
      onSubmit: async attempt => {
        const n = test.questions.length, right = attempt.results.filter(r => r.status === 'correct').length;
        const need = Math.ceil(n * 0.8), passed = n >= 3 && right >= need;   // too few checked questions can't close a topic
        await recordAttempt('Mastery: ' + this.o.topic, test, attempt);
        await markMastery(this.o.key, passed, `${right}/${n}`);
        this.result(test, attempt, right, n, passed);
        if (passed && this.o.onPass) this.o.onPass();
      },
    });
    this.el.scrollIntoView({ behavior: 'smooth' });
  }
  result(test, attempt, right, n, passed) {
    const missed = attempt.results.map((r, k) => ({ r, q: test.questions[k] })).filter(x => x.r.status !== 'correct');
    this.el.innerHTML = `<div class="card mastery ${passed ? 'done' : 'retry'}">
      <div class="score-ring" style="--p:${100 * right / n}"><b>${right}/${n}</b></div>
      ${passed
        ? `<div class="hand" style="font-size:30px;color:var(--green)">You've got the essence. Topic closed!</div><p class="muted">Marked as mastered in My topics. On to the next one.</p>`
        : `<div class="hand" style="font-size:30px;color:var(--red)">Not yet. This topic stays open.</div>
           <p class="muted">You need ${Math.ceil(n * 0.8)} of ${n}. These ideas tripped you up:</p>
           <ul>${missed.map(x => `<li><b>${escapeHtml(x.q.concept || 'Concept')}</b>: ${escapeHtml(plainText(x.q.question).replace(/\s+/g, ' ').slice(0, 120))}…</li>`).join('')}</ul>
           <div class="row"><button class="primary" data-m="explain">${icon('book')} Re-explain what I missed</button><button data-m="start">${icon('refresh')} New mastery check</button></div>
           <div class="md mastery-fix" style="margin-top:14px"></div>`}
      <details style="margin-top:14px"><summary class="small">See every question with explanations</summary><div class="m-review"></div></details></div>`;
    renderAttempt($('.m-review', this.el), test, attempt, { onReport: (q, reason) => reportQuestion(q, reason, 'Mastery') });
    this.el.querySelectorAll('[data-m=start]').forEach(b => b.onclick = () => this.start());
    const ex = $('[data-m=explain]', this.el);
    if (ex) ex.onclick = () => runJob('Re-explaining what you missed', async signal => {
      const box = $('.mastery-fix', this.el);
      const items = missed.map(({ r, q }, i) => `${i + 1}. ${q.question}\nOptions: ${q.options.map((o, j) => 'ABCD'[j] + ') ' + o).join(' | ') || '(numeric)'}\nStudent answered: ${fmtAns(r.answer)} · Correct: ${keyOf(q)}\nWhy: ${q.explanation}`).join('\n\n');
      await ollamaChat([
        { role: 'system', content: `You are a GATE CS tutor re-teaching ONLY the ideas a student just got wrong in a mastery check. For each missed question: name the misconception behind the student's answer, explain the correct reasoning step by step from first principles, and end with a one-line rule they can remember. Then finish with "## The core idea, once more": the topic's essence in 3-5 crisp bullets. Use LaTeX for math.${langNote()}` },
        { role: 'user', content: `Topic: ${this.o.topic}\n\nLesson:\n${(this.o.lessonMd() || '').slice(0, 6000)}\n\nMissed questions:\n${items}` },
      ], { signal, maxTokens: 3500, onToken: (_, o) => { box.innerHTML = renderMd(o); } });
    });
  }
}

// Marks each prerequisite in a lesson as already covered (link back) or new ("Learn this first").
// onLearn(name) teaches a missing prerequisite; onOpen(entry) opens a covered one.
async function decoratePrereqs(kind, card, { onLearn, onOpen, self }) {
  if (kind !== 'prereq') return;
  const covered = ((await Store.getHub()).covered || []).filter(e => e.key !== self);   // not the lesson itself
  card.querySelectorAll('li').forEach(li => {
    const strong = li.querySelector('strong');
    if (!strong || li.querySelector('.pre-tag')) return;
    const name = strong.textContent.replace(/[:.]\s*$/, '').trim();
    const hit = findCovered(name, covered);
    const tag = document.createElement('span');
    tag.className = 'pre-tag';
    if (hit) {
      tag.innerHTML = `<button class="pre-ok" title="${escapeHtml(hit.entry.topic)}">${icon('check')} ${hit.entry.mastered ? 'mastered' : 'covered'}</button>`;
      tag.firstChild.onclick = () => onOpen(hit.entry);
    } else {
      tag.innerHTML = `<button class="pre-new">Learn this first ${icon('arrowR')}</button>`;
      tag.firstChild.onclick = () => onLearn(name);
    }
    strong.after(tag);
  });
}

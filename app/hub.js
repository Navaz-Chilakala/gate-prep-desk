// Hub page: topic tutor, image question solver, practice (adaptive/mock/subject/drill/mistakes/flashcards),
// study-space management + search, settings.
let H = null;          // hub data (progress)
let tab = 'ask';

async function refreshHub() { H = await Store.getHub(); }
function show(id, on = true) { $(id).classList.toggle('hidden', !on); }

// ---------- tabs ----------
document.querySelectorAll('#tabs [data-tab]').forEach(b => b.onclick = () => openTab(b.dataset.tab));
function openTab(t) {
  tab = t;
  try { history.replaceState(null, '', '#' + t); } catch {}
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('main > section').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + t));
  ({ ask: renderAsk, solve: renderSolved, practice: renderPractice, pyq: renderPyq, mistakes: renderMistakes, topics: renderTopics, notes: () => NotesUI.render(), formulas: renderFormulas, files: renderFiles, settings: renderSettings })[t]();
}

// ---------- shared: run a test inside a container, record, analyse ----------
function closeRun(el) { el.innerHTML = ''; if (el.id === 'pyqRun') { show('#pyqHome'); renderPyq(); } if (el.id === 'practiceRun') backToPractice(); if (el.id === 'mlRun') { refreshHub().then(() => { renderMistakes(); }); } }
function runTestIn(el, test, source) {
  el.innerHTML = '';
  const runner = new TestRunner(el, test, {
    onExit: () => closeRun(el),
    onSubmit: async attempt => {
      await recordAttempt(source, test, attempt);
      await updateHub(h => { const a = h.attempts.find(x => x.id === attempt.id); if (a) { a.test = test; a.full = attempt; } });
      await refreshHub();
      // A mistake review: say what it did to the schedule.
      const o = lastReviewOutcome;
      if (test.kind === 'mistakes' && o) {
        const parts = [o.conquered && `${o.conquered} conquered`, o.advanced && `${o.advanced} moved to the next review`, o.reset && `${o.reset} start over tomorrow`, o.early && `${o.early} not due yet (not counted)`].filter(Boolean);
        if (parts.length) toast(`Review done: ${parts.join(', ')}.`, o.reset ? 'info' : 'ok', 8000);
      }
      renderToday();
      showAttempt(el, test, attempt, source);
      analyseAndShow(el, test, attempt, source);
    },
  });
  el.scrollIntoView({ behavior: 'smooth' });
  return runner;
}
function showAttempt(el, test, attempt, source) {
  renderAttempt(el, test, attempt, {
    onReanalyze: () => analyseAndShow(el, test, attempt, source),
    onReport: (q, reason) => reportQuestion(q, reason, source),
    onRetest: qs => runTestIn(el, { id: uid(), name: `Retest: ${qs.length} mistake${qs.length > 1 ? 's' : ''}`, kind: 'retest', created: new Date().toISOString(), questions: qs.map(q => ({ ...q, id: uid() })) }, source),
  });
  const close = document.createElement('div');
  close.className = 'row';
  close.innerHTML = '<button>Close results</button>';
  close.firstChild.onclick = () => closeRun(el);
  el.prepend(close);
}
function analyseAndShow(el, test, attempt, source) {
  runJob('Analysing your answers', async signal => {
    await analyzeAttempt(test, attempt, { signal, onToken: (_, o) => { const b = $('.analysis-box', el); if (b) b.innerHTML = renderMd(o); } });
    await patchAttemptErrors(attempt);
    await updateHub(h => { const a = h.attempts.find(x => x.id === attempt.id); if (a) a.full = attempt; });
  }, async () => { await refreshHub(); if (el.isConnected && el.innerHTML) showAttempt(el, test, attempt, source); });
}
function practiceOpts() { return { verify: $('#pVerify').checked, diff: $('#pDiff').value }; }
function startGenerated(label, el, source, makePlan, extra = {}) {
  let test = null;
  runJob(label, async signal => {
    const plan = makePlan();
    try {
      test = await buildTest({ name: label, plan, types: ['MCQ', 'MSQ', 'NAT'], ...practiceOpts(), ...extra, signal });
    } catch (e) {
      if (e.name === 'AbortError' && extra.partial && extra.partial.questions.length) test = extra.partial;
      else throw e;
    }
  }, () => { if (test) runTestIn(el, test, source); else if (el.id === 'practiceRun') backToPractice(); });
}

// ---------- LEARN (ask a topic) ----------
const askViewer = new LessonViewer($('#askLesson'), {
  finishLabel: 'Take the mastery check', onFinish: () => $('#askMastery').scrollIntoView({ behavior: 'smooth' }),
  decorate: (kind, card) => { markUnverified(card, curTopic && H.topics[curTopic.key] && H.topics[curTopic.key].review); decoratePrereqs(kind, card, { self: curTopic && 'topic:' + curTopic.key, onLearn: name => teachTopic(name), onOpen: e => openCovered(e) }); },
  onFormula: tex => curTopic && TutorChat.open('lesson:' + curTopic.key, `Explain this formula step by step: what each symbol means, why it holds, and a small worked example. $$${tex}$$`),
});
const askChat = new ChatBox($('#askChat'), {
  system: 'You are a patient GATE CS tutor. Answer the student\'s doubt clearly in short numbered steps, in simple words, using the lesson below and your own knowledge. Use LaTeX for math.',
  context: () => `Lesson:\n${(curTopic && curTopic.md || '').slice(0, 6000)}`,
});
let curTopic = null;
// Today: what's worth doing right now, one click away.
// ---------- TODAY: your GATE story ----------
// The home screen reads like a story: where you are (day N, days to GATE), the one best next scene,
// your chapters (subjects) with progress, this week in numbers, and the story so far.
function gateDate() { const d = Cfg.get('gateDate', ''); return d ? new Date(d + 'T09:00:00') : null; }
function relDay(iso) {
  const d = new Date(iso), days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return days <= 0 ? `today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function subjectStats() {
  const pyqs = H.pyqs || [], fixed = H.fixed || [];
  return SYLLABUS.map(s => {
    const cov = (H.covered || []).filter(e => e.subject === s.subject), mastered = cov.filter(e => e.mastered).length;
    const res = H.attempts.flatMap(a => a.results || []).filter(r => r.subject === s.subject);
    const right = res.filter(r => r.status === 'correct').length, acc = res.length ? right / res.length : null;
    const mist = H.mistakes.filter(m => m.q.subject === s.subject).length;
    const pct = Math.min(1, (mastered + 0.45 * (cov.length - mastered)) / Math.max(3, s.topics.length));
    const status = !cov.length && !res.length ? 'new' : mist >= 3 || (acc != null && acc < 0.5 && res.length >= 3) ? 'weak' : pct >= 0.6 && (acc == null || acc >= 0.7) ? 'strong' : 'going';
    return { s: s.subject, topics: s.topics, cov: cov.length, mastered, acc, answered: res.length, mist, pyqs: pyqs.filter(p => p.subject === s.subject).length, fixed: fixed.filter(f => f.subject === s.subject).length, pct, status };
  });
}
function storyEvents() {
  const ev = [];
  for (const e of H.covered || []) {
    ev.push({ at: e.first, ico: 'book', cls: '', t: `Learned <b>${escapeHtml(e.topic)}</b>`, sub: e.subject });
    if (e.mastered) ev.push({ at: e.mastered, ico: 'check', cls: 'green', t: `Closed <b>${escapeHtml(e.topic)}</b> with the mastery check`, sub: e.masteryScore ? `scored ${e.masteryScore}` : e.subject });
  }
  for (const a of H.attempts) ev.push({ at: a.at, ico: 'pencil', cls: 'violet', t: `Took <b>${escapeHtml(a.name || 'a test')}</b>`, sub: `${+(+a.score).toFixed(2)} / ${a.max} marks` });
  for (const f of H.fixed || []) ev.push({ at: f.at, ico: 'spark', cls: 'teal', t: `Turned a mistake into a strength: <b>${escapeHtml(f.concept || 'a question')}</b>`, sub: f.subject });
  for (const p of H.pyqs || []) if ((p.parts || []).length >= 3) ev.push({ at: p.added, ico: 'clock', cls: 'amber', t: `Studied a <b>GATE ${escapeHtml(p.year || '')} PYQ</b>${p.concept ? ` on ${escapeHtml(p.concept)}` : ''}`, sub: p.subject });
  for (const s of H.solved) ev.push({ at: s.at, ico: 'camera', cls: '', t: 'Cleared a photo doubt', sub: plainText(s.question).replace(/\s+/g, ' ').slice(0, 60) + '…' });
  return ev.filter(e => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
function nextScene(stats, due, open, reading) {
  const weak = stats.filter(x => x.status === 'weak').sort((a, b) => b.mist - a.mist)[0];
  const freshPyq = (H.pyqs || []).find(p => !(p.parts || []).length);
  const unstarted = stats.find(x => x.status === 'new' && x.s !== 'General Aptitude');
  const dueM = dueMistakes(H.mistakes);
  if (dueM.length || due >= 3) {
    const bits = [dueM.length && `${dueM.length} mistake review${dueM.length > 1 ? 's' : ''}`, due && `${due} flashcard${due > 1 ? 's' : ''}`, (H.pyqs || []).some(p => p.answer) && 'a few PYQs'].filter(Boolean);
    return { tone: 'red', ico: 'refresh', kicker: 'Up next · Daily mix', title: bits.join(' · ').replace(/^./, c => c.toUpperCase()), body: `~15 min${weak ? ` · weakest: <b>${escapeHtml(weak.s)}</b>` : ''}`, cta: 'Start', act: 'mix' };
  }
  if (open.length) { const e = open[open.length - 1]; return { tone: 'blue', ico: 'check', kicker: 'Up next · Mastery check', title: e.topic, body: `Learned ${relDay(e.first)} · 5 questions`, cta: 'Start', act: 'close' }; }
  if (due >= 5) return { tone: 'amber', ico: 'cards', kicker: 'Up next · Flashcards', title: `${due} due`, body: '~5 min', cta: 'Review', act: 'cards' };
  if (freshPyq) return { tone: 'violet', ico: 'clock', kicker: 'Up next · PYQ', title: `GATE ${freshPyq.year || ''} · ${freshPyq.concept || freshPyq.subject}`, body: escapeHtml(freshPyq.subject || ''), cta: 'Open', act: 'pyq', id: freshPyq.id };
  if (reading && reading.n) return { tone: 'green', ico: 'book', kicker: 'Up next · Book', title: prettyName(reading.site.name), body: `${reading.n} pages read`, cta: 'Continue', act: 'read' };
  if (unstarted) return { tone: 'blue', ico: 'spark', kicker: 'Up next · New chapter', title: unstarted.s, body: escapeHtml(unstarted.topics[0]), cta: 'Teach me', act: 'teach', topic: `${unstarted.topics[0]} (${unstarted.s})` };
  return { tone: 'amber', ico: 'pencil', kicker: 'Up next · Mock', title: 'Mini GATE mock', body: '15 questions · 45 min', cta: 'Prepare', act: 'mock' };
}
async function renderToday() {
  const el = $('#today');
  if (!el) return;
  el.classList.toggle('hidden', !$('#askLesson').classList.contains('hidden'));   // step aside while a lesson is open
  const lessonOpen = !$('#askLesson').classList.contains('hidden');
  $('#tab-ask').classList.toggle('reading', lessonOpen);   // compact header while a lesson is open
  if (!lessonOpen) $('#askHook').innerHTML = '';
  if ($('#askLesson').classList.contains('hidden') && $('#askReview')) $('#askReview').remove();
  const now = Date.now();
  const due = H.cards.filter(c => c.due <= now).length;
  const open = (H.covered || []).filter(e => !e.mastered);
  const sites = await Store.listSites().catch(() => []);
  let reading = null;
  if (sites[0]) { try { const d = await Store.getData(sites[0].id); const n = (d.pages || []).filter(p => p && p.md != null).length; reading = { site: sites[0], n, lessons: (d.lessons || []).length }; } catch {} }
  const stats = subjectStats(), events = storyEvents();
  // Where you are in the story.
  const first = [events.length ? events[events.length - 1].at : null, H.settings.firstSeen].filter(Boolean).sort()[0];
  if (!H.settings.firstSeen) updateHub(h => { h.settings.firstSeen = new Date().toISOString(); });
  const day = first ? Math.max(1, Math.floor((now - new Date(first)) / 864e5) + 1) : 1;
  const g = gateDate(), left = g ? Math.ceil((g - now) / 864e5) : null;
  $('#storyEyebrow').innerHTML = `Day ${day}${left != null ? ` · <span class="countdown">${left > 0 ? `${left} days to GATE` : 'GATE day'}</span>` : ` · <a href="#" id="setGateLink">Set exam date</a>`}`;
  const lastLearn = events.find(e => e.ico === 'book' || e.ico === 'check');
  const started = stats.filter(x => x.status !== 'new').length;
  $('#storyLine').innerHTML = !events.length ? '' : `${lastLearn ? `Last: ${lastLearn.t.replace(/^(Learned|Closed) /, "")} (${relDay(lastLearn.at)}) · ` : ''}${started}/${stats.length} chapters started`;
  const gl = $('#setGateLink'); if (gl) gl.onclick = e => { e.preventDefault(); openTab('settings'); $('#setGate').focus(); };
  // The next scene.
  const ns = nextScene(stats, due, open, reading);
  // This week in numbers.
  const wk = now - 7 * 864e5, inWeek = iso => iso && new Date(iso) >= wk;
  const wkRes = H.attempts.filter(a => inWeek(a.at)).flatMap(a => a.results || []);
  const wkAcc = wkRes.length ? Math.round(100 * wkRes.filter(r => r.status === 'correct').length / wkRes.length) : null;
  const week = [
    { n: (H.covered || []).filter(e => inWeek(e.first)).length, l: 'topics learned' },
    { n: wkRes.length, l: 'questions answered' },
    { n: wkAcc == null ? '–' : wkAcc + '%', l: 'accuracy' },
    { n: (H.fixed || []).filter(f => inWeek(f.at)).length, l: 'mistakes fixed' },
  ];
  const statusTxt = { new: 'Not started', going: 'In progress', strong: 'Strong', weak: 'Needs work' };
  el.innerHTML = `
    <button class="scene tone-${ns.tone}" data-act="${ns.act}"><span class="scene-ico">${icon(ns.ico)}</span>
      <span class="scene-body"><span class="scene-kicker">${ns.kicker}</span><span class="scene-title">${escapeHtml(ns.title)}</span><span class="scene-text">${ns.body}</span></span>
      <span class="scene-cta">${escapeHtml(ns.cta)} ${icon('arrowR')}</span></button>
    <div class="week">${week.map(w => `<div class="wk"><b>${w.n}</b><span>${w.l}</span></div>`).join('')}<div class="wk-cap">this week</div></div>
    <div class="section-title"><h3>Chapters</h3><span class="muted">${started}/${stats.length} started</span></div>
    <div class="chapters">${stats.map((x, i) => `<button class="chapter st-${x.status}" data-ch="${i}">
      <span class="ch-top"><span class="ch-num">${String(i + 1).padStart(2, '0')}</span><span class="ch-status">${statusTxt[x.status]}</span></span>
      <span class="ch-name">${escapeHtml(x.s)}</span>
      <span class="ch-bar"><span style="width:${Math.round(x.pct * 100)}%"></span></span>
      <span class="ch-meta">${x.cov ? `${x.mastered}/${x.cov} topics closed` : `${x.topics.length} syllabus topics`}${x.acc != null ? ` · ${Math.round(x.acc * 100)}% right` : ''}${x.mist ? ` · <span class="ch-mist">${x.mist} to fix</span>` : ''}${x.pyqs ? ` · ${x.pyqs} PYQs` : ''}</span></button>`).join('')}</div>
    ${events.length ? `<div class="section-title"><h3>Recent activity</h3></div><ol class="timeline">${events.slice(0, 7).map(e => `<li class="tl ${e.cls}"><span class="tl-dot">${icon(e.ico)}</span><div><div class="tl-t">${e.t}</div><div class="tl-sub">${escapeHtml(e.sub || '')} · ${relDay(e.at)}</div></div></li>`).join('')}</ol>` : ''}
    <div class="section-title"><h3>Quick actions</h3></div>
    <div class="quick">
      <button data-act="mix">${icon('refresh')}<span><b>Daily mix</b><small>~15 min</small></span></button>
      <button data-act="solve">${icon('camera')}<span><b>Photo doubt</b></span></button>
      <button data-act="pyqs">${icon('clock')}<span><b>PYQs</b><small>${(H.pyqs || []).length}</small></span></button>
      <button data-act="cards">${icon('cards')}<span><b>Flashcards</b><small>${due} due</small></span></button>
      <button data-act="mock">${icon('pencil')}<span><b>Mock test</b></span></button>
      <button data-act="upload">${icon('upload')}<span><b>Upload</b></span></button>
    </div>`;
  const acts = {
    cards: () => { openTab('practice'); $('#cardsGo').click(); $('#cardBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    close: () => openCovered(open[open.length - 1]),
    read: () => { location.href = `site.html?id=${reading.site.id}#learn`; },
    mistakes: () => openTab('mistakes'),
    review: () => { openTab('mistakes'); $('#mistakeRetest').click(); },
    mix: () => DailyMix.start(),
    pyq: () => { openTab('pyq'); openPyq(ns.id); },
    pyqs: () => openTab('pyq'),
    teach: () => { $('#askIn').value = ns.topic; teachTopic(ns.topic); },
    upload: () => openTab('files'), solve: () => openTab('solve'), mock: () => { openTab('practice'); $('#mockGo').scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  };
  el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => acts[b.dataset.act]());
  el.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => {
    const x = stats[+b.dataset.ch];
    if (x.mist) { mistFilter = { subject: x.s, type: '' }; openTab('mistakes'); }
    else if (x.pyqs) { pyqSub = x.s; pyqYr = ''; openTab('pyq'); }
    else { const t = x.topics[Math.min(x.cov, x.topics.length - 1)]; $('#askIn').value = `${t} (${x.s})`; $('#askIn').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); toast(`Press “Teach me” to start ${t}.`); }
  });
  // Badges in the sidebar: flashcards due on Practice, open mistakes on Mistakes.
  const badge = (tabName, n, cls = '') => { const b = $(`#tabs [data-tab="${tabName}"]`); if (!b) return; let c = $('.nav-count', b); if (n) { if (!c) { c = document.createElement('span'); b.appendChild(c); } c.className = 'nav-count ' + cls; c.textContent = n; c.title = tabName === 'practice' ? 'Flashcards due' : 'Mistakes due for review'; } else if (c) c.remove(); };
  badge('practice', due, 'info'); badge('mistakes', dueMistakes(H.mistakes).length);
}
function renderAsk() {
  renderToday();
  const recent = Object.entries(H.topics).sort((a, b) => (b[1].at || '').localeCompare(a[1].at || '')).slice(0, 15);
  const mastered = new Set((H.covered || []).filter(e => e.mastered).map(e => e.key));
  $('#recentTopics').innerHTML = recent.length ? '<span class="small muted">Recent:</span> ' + recent.map(([k, t]) => `<button class="chip" data-topic="${escapeHtml(k)}">${mastered.has('topic:' + k) ? '&#10003; ' : ''}${escapeHtml(t.title)}</button>`).join('') : '';
  $('#recentTopics').querySelectorAll('[data-topic]').forEach(b => b.onclick = () => openTopic(H.topics[b.dataset.topic], b.dataset.topic));
}
function openTopic(t, key) {
  curTopic = { ...t, key };
  show('#today', false); $('#tab-ask').classList.add('reading');
  show('#askLesson'); show('#askActions'); show('#askChatCard');
  show('#askCovered', false);
  askViewer.set(t.md);
  // Top of the lesson: its exact topic animation (anim.js), then the optional analogy picture (hooks.js, off by default).
  $('#askHook').innerHTML = '<div class="ta-slot"></div><div class="hook-slot"></div>';
  if (typeof TopicAnim !== 'undefined') TopicAnim.mount($('#askHook .ta-slot'), { topic: t.title, md: t.md, anim: t.anim, isNew: Date.now() - Date.parse(t.at || 0) < 30 * 60e3, save: async a => { await updateHub(hh => { if (hh.topics[key]) hh.topics[key].anim = a; }); await refreshHub(); } });
  if (typeof MemoryHook !== 'undefined') MemoryHook.mount($('#askHook .hook-slot'), { topic: t.title, md: t.md, hook: t.hook, save: async h => { await updateHub(hh => { if (hh.topics[key]) hh.topics[key].hook = h; }); await refreshHub(); } });
  askChat.reset();
  $('#askActions .sources') && $('#askActions .sources').remove();
  if (t.sources && t.sources.length) $('#askActions').insertAdjacentHTML('beforeend', Web.html(t.sources));
  if (t.books && t.books.length) $('#askActions').insertAdjacentHTML('beforeend', `<div class="sources"><span class="small muted">${icon('book')} Also used your books:</span> ${t.books.map(b => `<a href="site.html?id=${b.site}&page=${b.page}#digitize">${escapeHtml(b.name)}, p.${b.page}</a>`).join(' ')}</div>`);
  // Fact-check panel above the lesson (or a button to run it on older lessons).
  $('#askReview') && $('#askReview').remove();
  $('#askLesson').insertAdjacentHTML('beforebegin', `<div id="askReview">${t.review ? reviewHtml(t.review) : `<div class="card fc-panel fc-none row"><span class="fc-ico">${icon('help')}</span><span style="flex:1"><b>Not fact-checked</b></span><button id="askFc">Fact-check</button></div>`}</div>`);
  if ($('#askFc')) $('#askFc').onclick = () => factCheckTopic(key);
  if (t.review) wireReview($('#askReview'), { items: () => (H.topics[key].review || {}).items || [], md: () => H.topics[key].md, setMd: md => { H.topics[key].md = md; },
    save: () => updateHub(h => { const x = h.topics[key]; if (x) { x.md = H.topics[key].md; x.review = H.topics[key].review; } }),
    rerender: () => openTopic(H.topics[key], key), subject: t.subject || lessonSubject(t.md) || '', title: t.title });
  $('#askTest').innerHTML = '';
  $('#askIn').value = t.title;
  new MasteryCheck($('#askMastery'), {
    key: 'topic:' + key, topic: t.title, subject: t.subject || lessonSubject(t.md),
    material: () => t.md, lessonMd: () => t.md, onPass: () => refreshHub().then(renderAsk),
  }).render();
}
// Fact-check an existing topic lesson on demand.
function factCheckTopic(key) {
  const t = H.topics[key];
  if (!t || !t.md) return;
  runJob(`Fact-checking: ${t.title}`, async signal => {
    const fc = await factCheck(t.md, { title: t.title, subject: t.subject || lessonSubject(t.md) || '', kind: 'topic lesson', signal, onStage: s => jobLabel(`Fact-checking: ${s}`, signal) });
    await updateHub(h => { const x = h.topics[key]; if (x) { x.md = fc.md; x.review = fc.review; } });
  }, async () => { await refreshHub(); if (curTopic && curTopic.key === key) openTopic(H.topics[key], key); });
}
// Opens whatever an earlier "covered" entry points to.
// { mastery: true } jumps straight to the topic's mastery check.
function openCovered(e, { mastery = false } = {}) {
  noteRevisit(e.key);
  if (e.source.kind === 'topic' && H.topics[e.source.key]) {
    openTab('ask');   // the lesson lives on Learn: switch there first (this was missing, so nothing seemed to happen)
    openTopic(H.topics[e.source.key], e.source.key);
    if (mastery) setTimeout(() => $('#askMastery').scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (coveredHref(e)) location.href = coveredHref(e).replace('#learn', mastery ? '&mastery=1#learn' : '#learn');
}
async function teachTopic(title, { force = false, style = '' } = {}) {
  title = title.trim();
  if (!title) return;
  openTab('ask');
  const key = slug(title);
  if (!force) {
    const hit = findCovered(title, H.covered);
    if (hit) {
      show('#askLesson', false); show('#askActions', false); show('#askChatCard', false); show('#askMastery', false);
      if ((await askCovered($('#askCovered'), hit)) === 'open') { openCovered(hit.entry); return; }
    }
  }
  const again = !!H.topics[key];
  show('#today', false); $('#tab-ask').classList.add('reading');
  curTopic = { title, key, md: '' };
  $('#askReview') && $('#askReview').remove();
  show('#askCovered', false); show('#askLesson'); show('#askActions', false); show('#askChatCard', false); show('#askMastery', false);
  $('#askTest').innerHTML = '';
  askViewer.set(''); $('#askHook').innerHTML = '';
  runJob(`Teaching: ${title}`, async signal => {
    let web = [];
    if (Web.on()) { jobLabel('Looking it up online first', signal); web = await Web.search(title, signal); jobLabel(`Teaching: ${title}`, signal); }
    const mine = myNotesFor(title, (await Store.getHub()).notes);
    jobLabel('Gathering verified facts and your books', signal);
    const ground = await groundingFor(title);
    jobLabel(`Teaching: ${title}`, signal);
    let md = await ollamaChat([
      { role: 'system', content: lessonFromTopicSys(topicKind(title), style) },
      { role: 'user', content: title + (mine ? `\n\nTHE STUDENT'S OWN NOTES on this (build on them, use their wording where it helps, and gently correct anything wrong):\n${mine}` : '') + ground.text + Web.context(web) },
    ], { signal, maxTokens: 7000, onToken: (_, o) => askViewer.set(o, { keepStep: true }) });
    // Fact-check before you study it (Settings → Fact-check lessons).
    let review = null;
    if (Cfg.get('factcheck', 'on') === 'on') {
      const fc = await factCheck(md, { title, subject: lessonSubject(md) || '', kind: 'topic lesson', signal, onStage: t => jobLabel(`Fact-checking: ${t}`, signal) });
      md = fc.md; review = fc.review;
      askViewer.set(md, { keepStep: true });
    }
    curTopic.md = md;
    // A rewrite ("Explain differently") keeps the lesson's memory-hook picture: same topic, same analogy.
    await updateHub(h => { const hook = h.topics[key] && h.topics[key].hook; h.topics[key] = { title, md, at: new Date().toISOString(), subject: lessonSubject(md), sources: Web.brief(web), books: ground.cites, review, kind: topicKind(title), style, ...(hook ? { hook } : {}) }; });
    await recordCovered(md, { kind: 'topic', key, title, revisit: again });
  }, async () => { await refreshHub(); if (curTopic.md) openTopic(H.topics[key] || curTopic, key); renderAsk(); });
}
$('#askGo').onclick = () => teachTopic($('#askIn').value);
$('#askIn').onkeydown = e => { if (e.key === 'Enter') teachTopic($('#askIn').value); };
$('#askRedo').onclick = e => curTopic && styleMenu(e.currentTarget, style => teachTopic(curTopic.title, { force: true, style }));
$('#askCards').onclick = () => {
  if (!curTopic || !curTopic.md) return;
  const t = curTopic;
  let n = 0;
  runJob('Making flashcards', async signal => {
    const cards = await makeCards(t.md, signal);
    n = cards.length;
    await addCards(cards, t.subject || lessonSubject(t.md), 'Topic: ' + t.title);
  }, async () => { await refreshHub(); toast(n ? `${n} flashcards added` : 'No flashcards could be made. Try again.', n ? 'ok' : 'bad'); });
};

// ---------- MY TOPICS ----------
// ---------- syllabus map: every syllabus topic, coloured by coverage, mastery and weakness ----------
function syllabusStatus() {
  const covered = H.covered || [], weak = conceptWeakness().filter(e => e.acc < 0.6), pyqs = H.pyqs || [];
  const toks = s => new Set(topicTokens(s));
  const hits = (a, b) => { const A = toks(a); return topicTokens(b).filter(t => A.has(t)).length; };
  return SYLLABUS.map(s => ({ subject: s.subject, topics: s.topics.map(t => {
    const cov = covered.filter(e => e.subject === s.subject && (hits(t, e.topic) >= 1 || (e.subtopics || []).some(x => hits(t, x.name) >= 2)));
    const w = weak.filter(e => e.subject === s.subject && hits(t, e.concept) >= 1);
    const nP = pyqs.filter(p => p.subject === s.subject && hits(t, `${p.concept || ''}`) >= 1).length;
    const status = w.length ? 'weak' : cov.some(e => e.mastered) ? 'mastered' : cov.length ? 'studied' : '';
    return { t, status, cov, weak: w, nP };
  }) }));
}
function renderSyllabusMap() {
  const el = $('#syllabusMap');
  if (!el) return;
  const map = syllabusStatus();
  el.innerHTML = map.map((s, si) => {
    const done = s.topics.filter(t => t.status === 'mastered').length, seen = s.topics.filter(t => t.status).length;
    return `<div class="sy-subj"><div class="sy-head"><b>${escapeHtml(s.subject)}</b><span class="small muted">${seen} of ${s.topics.length} started · ${done} mastered</span>
      <span class="sy-bar"><span style="width:${Math.round(100 * done / s.topics.length)}%" class="m"></span><span style="width:${Math.round(100 * (seen - done) / s.topics.length)}%" class="s"></span></span></div>
      <div class="sy-topics">${s.topics.map((t, ti) => `<button class="sy-chip ${t.status}" data-sy="${si}:${ti}" title="${escapeHtml(t.weak.length ? `Weak: ${t.weak.map(w => `${w.concept} ${Math.round(100 * w.acc)}%`).join(', ')}` : t.cov.length ? `Studied: ${t.cov.map(c => c.topic).join(', ')}` : 'Not started: click to learn it')}">${escapeHtml(t.t)}${t.nP ? ` <span class="muted">(${t.nP})</span>` : ''}</button>`).join('')}</div></div>`;
  }).join('');
  el.querySelectorAll('[data-sy]').forEach(b => b.onclick = () => {
    const [si, ti] = b.dataset.sy.split(':').map(Number), t = map[si].topics[ti];
    if (t.cov.length && !t.weak.length) openCovered(t.cov[0]); else teachTopic(`${t.t} (${map[si].subject})`);
  });
}
function renderTopics() {
  renderSyllabusMap();
  const all = H.covered || [];
  const q = $('#topicSearch').value.trim();
  const shown = q ? all.filter(e => findCovered(q, [e]) || e.topic.toLowerCase().includes(q.toLowerCase())) : all;
  const mastered = all.filter(e => e.mastered).length, subs = all.reduce((s, e) => s + (e.subtopics || []).length, 0);
  $('#topicStats').innerHTML = all.length
    ? `<div class="stat"><span>Topics covered</span><b>${all.length}</b></div><div class="stat"><span>Subtopics</span><b>${subs}</b></div><div class="stat"><span>Mastered (closed)</span><b>${mastered}</b></div><div class="stat"><span>Still open</span><b>${all.length - mastered}</b></div>`
    : '';
  if (!shown.length) { $('#topicList').innerHTML = `<div class="card"><p class="empty">${all.length ? 'Nothing matches that.' : 'Nothing yet. Every lesson you take is added here automatically.'}</p></div>`; return; }
  const by = {};
  shown.forEach(e => (by[e.subject] = by[e.subject] || []).push(e));
  const order = SUBJECTS.concat(['Other']);
  $('#topicList').innerHTML = Object.keys(by).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(s => `
    <details class="card t-subject" open><summary class="row"><b style="flex:1;font-family:var(--serif);font-size:19px">${escapeHtml(s)}</b>
      <span class="pill ok">${by[s].filter(e => e.mastered).length} mastered</span><span class="pill">${by[s].length} topics</span></summary>
      ${by[s].sort((a, b) => (b.last || '').localeCompare(a.last || '')).map(e => `<div class="t-row">
        <div class="row"><div style="flex:1;min-width:200px"><b>${escapeHtml(e.topic)}</b> ${e.mastered ? `<span class="pill ok">${icon('check')} Mastered</span>` : '<span class="pill warn">Open</span>'}<br>
          <span class="small muted">${escapeHtml(whereLabel(e))} &middot; ${fmtDay(e.first)}${e.times > 1 ? ` &middot; studied ${e.times}&times;` : ''}${e.tries ? ` &middot; ${e.tries} mastery tr${e.tries > 1 ? 'ies' : 'y'}` : ''}</span></div>
          ${e.mastered ? `<button data-open="${e.id}" title="Open the lesson again">${icon('book')} Revisit</button>`
            : `<button class="primary" data-open="${e.id}" data-mastery="1" title="Pass 4 of 5 twisted questions to close this topic">${icon('check')} Take mastery check</button>`}<button class="link danger" data-forget="${e.id}" title="Remove from the list">${icon('trash')}</button></div>
        <div class="t-subs">${(e.subtopics || []).filter(st => !JUNK_SUB.test(String(st.name).trim())).map(st => `<span class="t-sub" title="${escapeHtml((st.terms || []).join(', '))}">${escapeHtml(st.name)}${st.terms && st.terms.length ? ` <i>&middot; ${st.terms.length}</i>` : ''}</span>`).join('')}</div>
      </div>`).join('')}
    </details>`).join('');
  $('#topicList').querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCovered(all.find(e => e.id === b.dataset.open), { mastery: !!b.dataset.mastery }));
  $('#topicList').querySelectorAll('[data-forget]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this topic from your list? The lesson itself is kept.')) return;
    await updateHub(h => { h.covered = (h.covered || []).filter(e => e.id !== b.dataset.forget); });
    syncTopicsFile(); await refreshHub(); renderTopics();
  });
}
$('#topicSearch').oninput = () => renderTopics();
$('#topicsDownload').onclick = () => downloadText(topicsMarkdown(H.covered), 'My GATE topics.md', 'text/markdown;charset=utf-8');

// ---------- SOLVE FROM IMAGE ----------
let solveImgs = [];   // [{ url, canvas }]
let solved = null;    // { question, md }
const solveChat = new ChatBox($('#solveChat'), {
  system: 'You are a patient GATE CS tutor. The student is asking about a question you just solved. Explain in simple words, in short steps. Use LaTeX for math.',
  context: () => solved ? `Question:\n${solved.question.slice(0, 4000)}\n\nYour solution:\n${solved.md.slice(0, 6000)}` : '',
});
async function addSolveImages(files) {
  for (const f of files) {
    try {
      const file = await normalizeUpload(f);
      if ((await sniffExt(file)) === 'pdf') { alert('For PDFs use "My PDFs & images". Here, add photos or screenshots.'); continue; }
      const canvas = await blobToCanvas(file, 2400);
      solveImgs.push({ url: canvas.toDataURL('image/jpeg', 0.7), canvas });
    } catch (e) { alert(e.message); }
  }
  solveImgs = solveImgs.slice(-4);
  renderThumbs();
}
function renderThumbs() {
  $('#imgPrev').innerHTML = solveImgs.map((im, i) => `<div class="thumb"><img src="${im.url}" alt="question image ${i + 1}"><button data-rm="${i}" title="Remove">&times;</button></div>`).join('');
  $('#imgPrev').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { solveImgs.splice(+b.dataset.rm, 1); renderThumbs(); });
}
$('#camIn').onchange = e => { addSolveImages([...e.target.files]); e.target.value = ''; };
$('#imgIn').onchange = e => { addSolveImages([...e.target.files]); e.target.value = ''; };
document.addEventListener('paste', e => {
  const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  if (tab === 'solve') addSolveImages(files);
});
$('#clearImgs').onclick = () => { solveImgs = []; solved = null; renderThumbs(); $('#qText').value = ''; ['#readCard', '#solveOut', '#solveActions', '#solveChatCard'].forEach(s => show(s, false)); $('#solveTest').innerHTML = ''; };
$('#qText').oninput = () => { $('#qPreview').innerHTML = renderMd($('#qText').value); };
async function readQuestion(signal) {
  let text = '';
  for (let i = 0; i < solveImgs.length; i++) {
    jobLabel(`Reading image ${i + 1} of ${solveImgs.length} (OCR + vision)`, signal);
    progress(i, solveImgs.length, signal);
    const r = await readImage(solveImgs[i].canvas, { label: `Image ${i + 1}`, signal, detailed: $('#solveDetailed').checked, onToken: (_, o) => live(o, signal) });
    text += (text ? '\n\n' : '') + r.md;
  }
  $('#qText').value = text;
  if (hasPyqMark(text)) pyqFromPhoto(text);
  $('#qPreview').innerHTML = renderMd(text);
  show('#readCard');
}
$('#readQ').onclick = () => {
  if (!solveImgs.length) { alert('Add a photo or screenshot first.'); return; }
  runJob('Reading the question', readQuestion);
};
function renderSolution() {
  $('#solveOut').innerHTML = confidenceHtml(solved.conf) + renderMd(solved.md) + (solved.check ? crossCheckHtml(solved.check)
    : '<div class="check" style="background:var(--amber-soft);color:var(--amber)">Not checked by a calculator or program (no single computable answer). Use "Second opinion" if you want it re-solved independently.</div>')
    + (solved.second ? `<div class="check ${solved.second.agree === false ? 'bad' : 'ok'}">${solved.second.agree === false ? `⚠ <b>Second opinion disagrees:</b> it arrives at <b>${escapeHtml(solved.second.answer)}</b>.` : solved.second.agree ? '✓ Second opinion agrees with this answer.' : 'Second opinion (answers could not be compared automatically):'}<details><summary class="small">Its working</summary><div class="md">${renderMd(solved.second.md)}</div></details></div>` : '')
    + Web.html(solved.sources);
  const fix = $('#solveOut .cc-fix');
  if (fix) fix.onclick = () => solveQuestion(String(solved.check.computed), solved.check.solver ? solved.check : null);
}
function solveQuestion(verified, fromCheck) {
  let autoFix = null;
  if (!solveImgs.length && !$('#qText').value.trim()) { alert('Add a photo/screenshot, or type the question in the box after reading.'); return; }
  runJob('Solving', async signal => {
    if (!$('#qText').value.trim() && solveImgs.length) await readQuestion(signal);
    const question = $('#qText').value.trim();
    show('#solveOut'); $('#solveOut').innerHTML = '<p class="empty">Working it out&hellip;</p>';
    let web = [];
    if (Web.on()) {   // search with the question's wording, minus options and numbers
      const q = plainText(question).replace(/\(?[A-D]\)[^\n]*/g, ' ').replace(/[\d.,]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      jobLabel('Looking it up online first', signal); web = await Web.search(q, signal);
    }
    jobLabel('Explaining step by step', signal);
    const simple = $('#solveSimple').checked ? '\nThe student is a beginner: avoid jargon, use analogies, and never skip a step.' : '';
    const hint = verified ? `\n\n(For you, not the student: the correct final answer, computed exactly, is ${verified}. Work every step carefully so your solution naturally arrives at it, rounded the way the question asks. Do not mention that you were given it, and do not discuss rounding of this hint.)` : '';
    const md = await ollamaChat([
      { role: 'system', content: `You are an expert GATE CS teacher solving a question from an image for a student.\n${SOLVE_FORMAT}${simple}${langNote()}` },
      { role: 'user', content: `Question (read from the image${solveImgs.length ? 's attached' : ''}):\n${question}${hint}${factsBlock(factsFor(question, 6))}${Web.context(web)}\n\nSolve and explain it.`, images: solveImgs.slice(0, 3).map(im => canvasB64(im.canvas)) },
    ], { signal, model: solveImgs.length ? visionModel() : teachModel(), onToken: (_, o) => { $('#solveOut').innerHTML = renderMd(o); } });
    solved = { question, md, check: null, sources: Web.brief(web) };
    if (!verified) {
      const a = await assessSolution(question, md, signal, { onStep: t => jobLabel(t, signal) });
      solved.check = a.check; solved.conf = a;
      // The exact calculator is plain code: if it disagrees, rewrite the explanation around its answer straight away.
      if (a.check && a.check.solver && a.check.agree === false) autoFix = a.check;
    } else if (fromCheck) { solved.check = { ...fromCheck, agree: true, shown: String(verified) }; solved.conf = { level: 'exact', votes: [], check: solved.check }; }
    else { solved.check = { computed: verified, agree: true }; solved.conf = { level: 'good', votes: [] }; }
    if (autoFix) return;   // the corrected explanation is the one worth keeping
    await updateHub(h => { h.solved.unshift({ id: uid(), at: new Date().toISOString(), question, md, check: solved.check, conf: solved.conf, sources: solved.sources }); h.solved = h.solved.slice(0, 100); });
    await collectFormulas(md, lessonSubject(question + '\n' + md) || 'Other', { kind: 'solved', label: 'Photo question: ' + plainText(question).replace(/\s+/g, ' ').slice(0, 50), href: 'index.html#solve' });
  }, async () => {
    await refreshHub();
    if (solved) { renderSolution(); show('#solveActions'); show('#solveChatCard'); solveChat.reset(); }
    renderSolved();
    if (autoFix) {
      toast(`The exact ${autoFix.solver} calculator got ${autoFix.computed}, not ${String(autoFix.shown).slice(0, 30)}. Rewriting the explanation to match.`, 'warn', 7000);
      solveQuestion(String(autoFix.computed), autoFix);
    }
  });
}
$('#explainQ').onclick = () => solveQuestion();
$('#solveDetailed').checked = Cfg.get('solveDetailed', 'on') === 'on';
$('#solveDetailed').onchange = () => Cfg.set('solveDetailed', $('#solveDetailed').checked ? 'on' : 'off');
$('#solveSpeak').onclick = () => solved && speak(solved.md);
$('#solveSecond').onclick = () => {
  if (!solved) return;
  const s = solved;
  runJob('Getting a second opinion', async signal => {
    const md = await ollamaChat([
      { role: 'system', content: `You are a second GATE CS examiner. Solve the question from scratch, by a different method than usual if possible (work backwards, eliminate options, a small concrete example, or simulate). Be concise: numbered steps, then a final section "## Answer" with just the final answer/option(s). Use LaTeX for math.` },
      { role: 'user', content: s.question },
    ], { signal, model: checkModel(), maxTokens: 2500 });
    s.second = { md, answer: answerOf(md).slice(0, 80), agree: voteMatch(answerOf(md), answerOf(s.md), s.question) };
  }, () => { if (solved === s) renderSolution(); });
};
$('#solveQuiz').onclick = () => {
  if (!solved) return;
  const s = solved;
  startGenerated('Similar questions', $('#solveTest'), 'Photo doubt', () => [{ material: `Original question:\n${s.question}\n\nSolution:\n${s.md}`, focus: 'the same concept as the original question, with different numbers/situations', label: 'Similar questions', count: 5 }]);
};
// ---------- exact calculators panel ----------
$('#calcSel').innerHTML = Solvers.list.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.subject)})</option>`).join('');
const calcForm = (params) => { $('#calcForm').innerHTML = Solvers.formHtml($('#calcSel').value, params); $('#calcErr').textContent = ''; };
$('#calcSel').onchange = () => { calcForm(); $('#calcOut').innerHTML = ''; };
calcForm();
$('#calcGo').onclick = () => {
  try {
    const id = $('#calcSel').value, params = Solvers.formRead($('#calcForm')), r = Solvers.solve(id, params);
    $('#calcErr').textContent = '';
    // the answer, its drawing (computed from the calculator's numbers) with "what if" inputs, then the working
    if (typeof CalcViz !== 'undefined') CalcViz.mount($('#calcOut'), id, params, r);
    else $('#calcOut').innerHTML = `<div class="check ok">Answer: <b>${escapeHtml(r.text)}</b></div>` + renderMd(r.steps);
  } catch (e) { $('#calcErr').textContent = e.message; $('#calcOut').innerHTML = ''; }
};
$('#calcFill').onclick = () => {
  const q = $('#qText').value.trim();
  if (!q) { toast('Read or type a question in the box above first.'); return; }
  runJob('Reading the inputs for the calculator', async signal => {
    const c = Solvers.candidates(q);
    if (c.length && !c.some(x => x.id === $('#calcSel').value)) $('#calcSel').value = c[0].id;
    const params = await Solvers.read($('#calcSel').value, q, signal);
    calcForm(params);
  }, () => { $('#calcGo').click(); });
};

// ---------- check my working ----------
let workImg = null;
$('#workImg').onchange = async e => { const f = e.target.files[0]; if (!f) return; workImg = await blobToCanvas(await normalizeUpload(f), 2400); $('#workImgName').textContent = f.name; };
const WORK_SYS = `You are a strict but kind GATE CS examiner checking a student's own working. Go through THEIR steps in order. Do not just re-solve; judge what they wrote. Markdown format:
## Verdict
(one line: Correct / Right method, slip in calculation / Wrong approach / Incomplete)
## Your steps, checked
(numbered; for each of the student's steps: ✓ or ✗, and one short reason)
## The first mistake
(quote the exact step, say what is wrong and what kind of mistake it is: concept, calculation, misread, or missing case. Write "None" if all is correct)
## Fixed from that point
(continue correctly from the first wrong step to the final answer)
## Remember
(one line the student should remember next time)
Use LaTeX for math ($...$).`;
$('#workGo').onclick = () => {
  if (!$('#workText').value.trim() && !workImg) { alert('Type your working or add a photo of it.'); return; }
  if (!$('#qText').value.trim() && !solveImgs.length) { alert('Add the question first (photo or text, at the top of this page).'); return; }
  runJob('Checking your working', async signal => {
    if (!$('#qText').value.trim() && solveImgs.length) await readQuestion(signal);
    const question = $('#qText').value.trim();
    let work = $('#workText').value.trim();
    if (workImg) {
      jobLabel('Reading your handwriting', signal);
      const r = await readImage(workImg, { label: 'Your working', signal, detailed: true, onToken: (_, o) => live(o, signal) });
      work = (work ? work + '\n\n' : '') + r.md;
    }
    show('#workOut'); $('#workOut').innerHTML = '<p class="empty">Looking for an exact answer to compare with&hellip;</p>';
    let ref = null;
    try { ref = await Solvers.answer(question, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
    jobLabel('Checking each of your steps', signal);
    const refNote = ref ? `\n\nThe correct final answer, computed exactly by a calculator, is: ${ref.text}. Worked solution for your reference:\n${ref.steps}` : '';
    const md = await ollamaChat([
      { role: 'system', content: WORK_SYS + langNote() },
      { role: 'user', content: `QUESTION:\n${question}${refNote}\n\nSTUDENT'S WORKING:\n${work}` },
    ], { signal, onToken: (_, o) => { $('#workOut').innerHTML = renderMd(o); } });
    $('#workOut').innerHTML = (ref ? `<div class="check ok">✓ Correct answer computed exactly by the ${escapeHtml(ref.name)} calculator: <b>${escapeHtml(ref.text)}</b></div>` : '') + renderMd(md);
  });
};

function renderSolved() {
  $('#solvedList').innerHTML = H.solved.length ? H.solved.slice(0, 30).map(s =>
    `<div class="list-item"><div class="grow">${escapeHtml(plainText(s.question).replace(/\s+/g, ' ').slice(0, 140))}&hellip;<br><span class="small muted">${new Date(s.at).toLocaleString()}${s.check && s.check.agree ? ' &middot; answer checked' : ''}</span></div><button data-sv="${s.id}">Open</button></div>`).join('') : '<p class="empty">No questions yet.</p>';
  $('#solvedList').querySelectorAll('[data-sv]').forEach(b => b.onclick = () => {
    const s = H.solved.find(x => x.id === b.dataset.sv);
    solved = { question: s.question, md: s.md, check: s.check || null, conf: s.conf || null, sources: s.sources || [] };
    $('#qText').value = s.question; $('#qPreview').innerHTML = renderMd(s.question);
    show('#readCard'); show('#solveOut'); show('#solveActions'); show('#solveChatCard');
    renderSolution(); solveChat.reset();
    $('#solveOut').scrollIntoView({ behavior: 'smooth' });
  });
}

// ---------- PRACTICE ----------
function practiceRunOpts() {
  show('#practiceHome', false);
  return { onDone: () => {} };
}
function backToPractice() { $('#practiceRun').innerHTML = ''; show('#practiceHome'); renderPractice(); }
// ---------- spot the error: a worked solution with one planted mistake ----------
// Topics an exact calculator covers (solvers.js) are built without the model: the inputs are picked here, the
// calculator does the working, the steps are written from its numbers, and ONE "a op b = c" result is changed to a
// plausible wrong value. Later steps reuse the wrong value as a student's would, so the exact recalculation flags only
// that step. Concept topics are still written by the model, and their planted mistake is checked before you see it:
// a calculation slip must be the only step the recalculation flags; a wrong formula or concept must be judged false
// (and its correction true) by the fact-checker.
const seRand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const sePick = a => a[Math.floor(Math.random() * a.length)];
const seNum = x => String(Math.round(x * 1e4) / 1e4);
const SE_OPS = new Set(['+', '−', '×', '/', '^']);
// A step is a list of parts: text, v => text, or a value. seEq is an arithmetic result whose tokens are numbers,
// operators or the keys of earlier results; seVal is a derived value that is never the planted mistake.
const seEq = (key, label, tokens, o = {}) => {
  const show = v => tokens.map(t => typeof t === 'number' ? seNum(t) : SE_OPS.has(t) ? t : seNum(v[t])).join(' ');
  return { key, ...o, calc: v => calcEval(show(v).replace(/−/g, '-').replace(/×/g, '*')), say: (v, r) => `${label} = ${show(v)} = ${seNum(r)}` };
};
const seVal = (key, calc, say = () => '') => ({ key, calc, say, fixed: true });
function seRun(steps, slip) {
  const v = {}, eqs = [];
  const text = steps.map((parts, si) => parts.map(p => {
    if (typeof p === 'string') return p;
    if (typeof p === 'function') return p(v);
    let r = Math.round(p.calc(v) * 1e4) / 1e4;
    if (!p.fixed) eqs.push({ key: p.key, step: si, value: r, wrong: p.wrong, strict: p.strict });
    if (slip && slip.key === p.key) r = slip.value;
    v[p.key] = r;
    return p.say(v, r);
  }).join(''));
  return { text, v, eqs };
}
// A plausible wrong result: the step's own typical slips (forgot the −1, used the hit rate, …), else a near miss.
function seWrong(e) {
  const r = e.value, far = x => Number.isFinite(x) && x >= 0 && Math.abs(x - r) > Math.max(0.011, Math.abs(r) * 0.01);
  const own = (e.wrong ? e.wrong(r) : []).filter(far);
  if (own.length) return sePick(own);
  if (e.strict) return null;
  const dec = Math.max(1, (String(r).split('.')[1] || '').length);
  const near = Number.isInteger(r) ? [r + 1, r - 1, r + 2, r - 2] : [r * 1.1, r * 0.9, r * 2, r / 2].map(x => +x.toFixed(dec));
  const ok = near.filter(far);
  return ok.length ? sePick(ok) : null;
}
const seSame = (a, b) => typeof b === 'number' ? Math.abs(+a - b) <= Math.max(1e-3, Math.abs(b) * 1e-4) : String(a) === String(b);
const seSum = keys => keys.flatMap((k, i) => i ? ['+', k] : [k]);
// One builder per calculator: params() picks the inputs, steps(sol) writes the working from the calculator's result.
const SE_BUILDERS = [
  { id: 'cpu', re: /schedul|round.?robin|fcfs|\bsjf\b|srtf|shortest.?(job|remaining)|priority|turn.?around|waiting time|\bcpu\b/i, not: /disk|seek/i, make(topic) {
    const algo = /round.?robin|\brr\b|quantum/i.test(topic) ? 'RR' : /srtf|remaining|preemptive sjf/i.test(topic) ? 'SRTF' : /sjf|shortest/i.test(topic) ? 'SJF'
      : /priority/i.test(topic) ? 'PRIORITY' : /fcfs|first.?come/i.test(topic) ? 'FCFS' : sePick(['FCFS', 'SJF', 'SRTF', 'RR', 'PRIORITY']);
    let at = 0;
    const procs = [1, 2, 3, 4].map(i => ({ name: 'P' + i, arrival: i === 1 ? 0 : (at += seRand(0, 3)), burst: seRand(2, 8), ...(algo === 'PRIORITY' ? { priority: seRand(1, 5) } : {}) }));
    const quantum = algo === 'RR' ? seRand(2, 4) : undefined, ask = sePick(['avg_waiting', 'avg_turnaround']), W = ask === 'avg_waiting';
    const params = { algorithm: algo, processes: procs, quantum, ask, lower_number_higher_priority: true };
    const name = { FCFS: 'FCFS', SJF: 'non-preemptive SJF', SRTF: 'SRTF (preemptive SJF)', RR: `Round robin with time quantum ${quantum}`, PRIORITY: 'non-preemptive priority scheduling (a lower number means a higher priority)' }[algo];
    return { params, question: `Four processes are scheduled with **${name}**; ties go to the process that arrived first. Ignore context-switch time.\n\n` +
      mdTable(['Process', 'Arrival', 'Burst', ...(algo === 'PRIORITY' ? ['Priority'] : [])], procs.map(p => [p.name, p.arrival, p.burst, ...(algo === 'PRIORITY' ? [p.priority] : [])])) +
      `\n\nWhat is the ${W ? 'average waiting time' : 'average turnaround time'}?`,
    steps: sol => {
      const ct = procs.map(p => Solvers.solve('cpu', { ...params, ask: 'completion_of', target: p.name }).value);
      const gantt = (sol.steps.match(/\*\*Gantt chart:\*\*\s*(.*)/) || [])[1];
      if (!gantt) throw new Error('no Gantt chart');
      return [[`Gantt chart: ${gantt}. Completion times: ${procs.map((p, i) => `${p.name} at ${ct[i]}`).join(', ')}.`],
        ...procs.map((p, i) => [`${p.name}: `, seEq('t' + i, 'turnaround = completion − arrival', [ct[i], '−', p.arrival], { wrong: () => p.arrival ? [ct[i]] : [] }), '; ',
          seEq('w' + i, 'waiting = turnaround − burst', ['t' + i, '−', p.burst])]),
        [seEq('sum', `Total ${W ? 'waiting' : 'turnaround'} time`, seSum(procs.map((p, i) => (W ? 'w' : 't') + i)))],
        [seEq('avg', `Average ${W ? 'waiting' : 'turnaround'} time`, ['sum', '/', procs.length])]];
    }, answer: v => v.avg };
  } },
  { id: 'page', re: /page.?(replacement|fault)|\blru\b|\bfifo\b|optimal page|belady|reference string/i, make(topic) {
    const algo = /lru|least.?recently/i.test(topic) ? 'LRU' : /\bopt|optimal/i.test(topic) ? 'OPT' : /fifo|first.?in/i.test(topic) ? 'FIFO' : sePick(['FIFO', 'LRU', 'OPT']);
    const refs = [];
    while (refs.length < 12) refs.push(refs.length > 2 && Math.random() < 0.35 ? sePick(refs.slice(-4)) : seRand(0, 5));
    const ask = sePick(['faults', 'hit_ratio']);
    return { params: { algorithm: algo, frames: 3, references: refs, ask },
      question: `A process has **3 page frames**, all empty at the start, and uses **${algo === 'OPT' ? 'optimal (OPT)' : algo}** page replacement. For the reference string **${refs.join(', ')}**, ${ask === 'faults' ? 'how many page faults occur?' : 'what is the hit ratio?'}`,
    steps: sol => {
      const rows = sol.steps.split('\n').filter(l => /^\|\s*\d/.test(l)).map(l => l.split('|').map(c => c.trim())).map(c => ({ ref: c[1], frames: c[2], fault: /fault/.test(c[3]) }));
      if (rows.length !== refs.length) throw new Error('trace mismatch');
      const part = [rows.slice(0, 4), rows.slice(4, 8), rows.slice(8)], n = part.map(ch => ch.filter(r => r.fault).length);
      const trace = ch => ch.map(r => `${r.ref} → [${r.frames}] ${r.fault ? 'fault' : 'hit'}`).join(', ');
      return [[`References 1 to 4: ${trace(part[0])}. Faults so far: ${n[0]}.`, seVal('f0', () => n[0])],
        [`References 5 to 8: ${trace(part[1])}. That is ${n[1]} more, so `, seEq('f1', 'faults so far', ['f0', '+', n[1]])],
        [`References 9 to 12: ${trace(part[2])}. That is ${n[2]} more, so `, seEq('f2', 'total faults', ['f1', '+', n[2]])],
        [seEq('hits', 'Hits = references − faults', [refs.length, '−', 'f2']), ...(ask === 'hit_ratio' ? ['; ', seEq('hr', 'hit ratio = hits / references', ['hits', '/', refs.length])] : [])]];
    }, answer: v => ask === 'faults' ? v.f2 : v.hr };
  } },
  { id: 'cache', re: /cache|tag (bits|field|directory)|set.?associative|direct.?mapped/i, make() {
    const kb = sePick([8, 16, 32, 64, 128]), B = sePick([16, 32, 64, 128]), ways = sePick([1, 2, 4, 8]), A = sePick([32, 32, 36]), ask = sePick(['tag_bits', 'tag_directory_bits']);
    return { params: { cache_size: kb + 'KB', block_size: B + 'B', ways, address_bits: A, ask },
      question: `A **${kb} KB ${ways === 1 ? 'direct-mapped' : `${ways}-way set-associative`}** cache has **${B}-byte blocks**, and the processor uses **${A}-bit byte addresses**. ${ask === 'tag_bits' ? 'How many bits are in the tag field?' : 'Ignoring valid, dirty and replacement bits, what is the size of the tag directory in bits?'}`,
    steps: () => [[seEq('size', 'Cache size in bytes', [kb, '×', 1024], { fixed: true })],
      [seEq('lines', 'Lines = cache size / block size', ['size', '/', B], { wrong: r => [r * 2, r / 2], strict: true })],
      [seEq('sets', 'Sets = lines / ways', ['lines', '/', ways], { wrong: r => [r * 2, r / 2].filter(x => x >= 2), strict: true })],
      [seVal('off', () => Math.log2(B), (v, r) => `Offset bits = log₂(${B}) = ${r}`), '; ', seVal('idx', v => Math.log2(v.sets), (v, r) => `index bits = log₂(${seNum(v.sets)}) = ${seNum(r)}`)],
      [seEq('tag', 'Tag bits = address bits − index bits − offset bits', [A, '−', 'idx', '−', 'off'], { wrong: r => [r + 1, r - 1], strict: true })],
      ...(ask === 'tag_directory_bits' ? [[seEq('dir', 'Tag directory = lines × tag bits', ['lines', '×', 'tag'])]] : [])],
    answer: v => ask === 'tag_bits' ? v.tag : v.dir };
  } },
  { id: 'amat', re: /cache|memory access time|\bamat\b|memory hierarchy|miss penalty/i, make() {
    const t1 = sePick([1, 2, 5]), h1 = sePick([0.8, 0.9, 0.95]), t2 = sePick([10, 15, 20]), h2 = sePick([0.5, 0.8, 0.9]), tm = sePick([100, 150, 200]);
    return { params: { levels: [{ hit_time: t1, hit_rate: h1 }, { hit_time: t2, hit_rate: h2 }], memory_time: tm, mode: 'hierarchical' },
      question: `A two-level cache: **L1** takes ${t1} ns with hit rate ${h1}; **L2** takes ${t2} ns with hit rate ${h2} (of the accesses that reach it); **main memory** takes ${tm} ns. An access tries L1, on a miss L2, and on an L2 miss memory, paying each level's time on the way. What is the average memory access time in ns?`,
    steps: () => [[seEq('m1', 'L1 miss rate', [1, '−', h1], { wrong: () => [h1] }), '; ', seEq('m2', 'L2 miss rate', [1, '−', h2], { wrong: () => [h2] })],
      [seEq('below', 'Average memory penalty of an access that reaches L2 (ns)', ['m2', '×', tm])],
      [seEq('l2', 'Average time of an access that reaches L2 (ns)', [t2, '+', 'below'])],
      [seEq('l1miss', 'Average extra time per access from L1 misses (ns)', ['m1', '×', 'l2'])],
      [seEq('T', 'Average memory access time (ns)', [t1, '+', 'l1miss'])]],
    answer: v => v.T };
  } },
  { id: 'pipe', re: /pipelin/i, make() {
    const d = Array.from({ length: 5 }, () => seRand(2, 10)), latch = sePick([0, 1, 2]), n = sePick([10, 20, 50, 100]), ask = sePick(['total_time', 'speedup']);
    const mx = Math.max(...d), sum = d.reduce((a, b) => a + b, 0);
    return { params: { stage_delays: d, latch_delay: latch, instructions: n, ask },
      question: `A 5-stage pipeline has stage delays **${d.join(', ')} ns**${latch ? ` and a **${latch} ns** latch delay between stages` : ' and no latch delay'}. ` +
        (ask === 'total_time' ? `How long (in ns) does it take to run **${n} instructions**, with no stalls?` : `What is the speedup for **${n} instructions** over a non-pipelined processor that takes ${sum} ns (the sum of the stage delays) per instruction? Assume no stalls.`),
    steps: () => [[`The slowest stage takes ${mx} ns, and every stage must fit in one clock cycle.`],
      [seEq('cyc', 'Cycle time = slowest stage + latch (ns)', [mx, '+', latch])],
      [seEq('cycles', 'Cycles = stages + instructions − one', [5, '+', n, '−', 1], { wrong: r => [r + 1] })],
      [seEq('total', 'Pipelined time (ns)', ['cycles', '×', 'cyc'])],
      ...(ask === 'speedup' ? [[seEq('np', 'Non-pipelined time (ns)', [n, '×', sum])], [seEq('S', 'Speedup = non-pipelined / pipelined', ['np', '/', 'total'])]] : [])],
    answer: v => ask === 'total_time' ? v.total : v.S };
  } },
  { id: 'tlb', re: /\btlb\b|translation look|effective (memory )?access|paging|virtual memory/i, make() {
    const tl = sePick([5, 10, 20]), m = sePick([50, 80, 100]), h = sePick([0.75, 0.8, 0.9, 0.95]), L = sePick([1, 1, 2]);
    return { params: { tlb_time: tl, memory_time: m, tlb_hit_rate: h, page_table_levels: L, tlb_mode: 'sequential' },
      question: `A TLB lookup takes **${tl} ns** and a memory access **${m} ns**. The page table has **${L === 1 ? 'one level' : `${L} levels`}** in main memory. The TLB is searched first; on a miss the page table is walked and then the data is read. The TLB hit ratio is **${h}**. What is the effective memory access time in ns? Ignore page faults.`,
    steps: () => [[seEq('hit', 'Cost of a TLB hit = TLB + one memory access', [tl, '+', m])],
      [seEq('miss', `Cost of a TLB miss = TLB + ${L === 1 ? 'two' : 'three'} memory accesses`, [tl, '+', L + 1, '×', m], { wrong: r => [r - m] })],
      [seEq('mr', 'TLB miss ratio', [1, '−', h], { wrong: () => [h] })],
      [seEq('ph', 'Hit part', [h, '×', 'hit']), '; ', seEq('pm', 'miss part', ['mr', '×', 'miss'])],
      [seEq('T', 'Effective access time (ns)', ['ph', '+', 'pm'])]],
    answer: v => v.T };
  } },
  { id: 'disk', re: /disk|seek|sstf|\bc?-?scan\b|\bc?-?look\b|head movement|cylinder/i, make(topic) {
    const algo = /sstf|shortest.?seek/i.test(topic) ? 'SSTF' : /look/i.test(topic) ? 'LOOK' : /scan|elevator/i.test(topic) ? 'SCAN' : /fcfs|fifo/i.test(topic) ? 'FCFS' : sePick(['FCFS', 'SSTF', 'SCAN', 'LOOK']);
    const head = seRand(40, 140), reqs = [];
    while (reqs.length < 6) { const r = seRand(0, 199); if (r !== head && !reqs.includes(r)) reqs.push(r); }
    return { params: { algorithm: algo, head, requests: reqs, direction: 'up', min_cylinder: 0, max_cylinder: 199, ask: 'total_movement' },
      question: `A disk has cylinders 0 to 199. The head is at cylinder **${head}**${/SCAN|LOOK/.test(algo) ? ', moving towards higher cylinder numbers' : ''}. The request queue, in arrival order, is **${reqs.join(', ')}**. Using **${algo}**, what is the total head movement in cylinders?`,
    steps: sol => {
      const path = ((sol.steps.match(/Order: (.*)/) || [])[1] || '').split(' → ').map(Number);
      if (path.length < 3 || path.some(x => !Number.isFinite(x))) throw new Error('no order');
      const legs = path.slice(1).map((x, i) => [path[i], x]), out = [[`Service order: ${path.join(' → ')}.`]];
      for (let g = 0; g * 3 < legs.length; g++) {
        const grp = legs.slice(g * 3, g * 3 + 3).map((l, j) => ({ l, k: 'd' + (g * 3 + j) }));
        out.push([...grp.flatMap(({ l: [a, b], k }, j) => [j ? '; ' : '', seEq(k, `move ${a}→${b}`, [Math.max(a, b), '−', Math.min(a, b)])]), '; ',
          seEq('s' + g, legs.length > (g + 1) * 3 ? 'running total' : 'total head movement', seSum([...(g ? ['s' + (g - 1)] : []), ...grp.map(x => x.k)]))]);
      }
      return out;
    }, answer: v => v['s' + (Math.ceil((Object.keys(v).filter(k => /^d\d/.test(k)).length) / 3) - 1)] };
  } },
  { id: 'ip', re: /subnet|\bip\b|ipv4|ip address|cidr|netmask|broadcast address|network address/i, make() {
    const prefix = seRand(25, 30), a = sePick([10, 172, 192, 200]), b = seRand(0, 255), c = seRand(0, 255), d = seRand(1, 254), pre = `${a}.${b}.${c}.`;
    const ask = sePick(['broadcast', 'network', 'last_host', 'hosts']);
    return { params: { ip: `${pre}${d}/${prefix}`, ask },
      question: `A host has the IP address **${pre}${d}/${prefix}**. ${{ broadcast: 'What is the broadcast address of its subnet?', network: 'What is its network (subnet) address?', last_host: 'What is the last usable host address in its subnet?', hosts: 'How many usable host addresses does its subnet have?' }[ask]}`,
    steps: () => [[seEq('hb', 'Host bits = 32 − prefix', [32, '−', prefix], { wrong: r => [r + 1, r - 1], strict: true })],
      [seEq('blk', 'Addresses per subnet', [2, '^', 'hb'], { wrong: r => [r * 2, r / 2], strict: true })],
      [seEq('mk', 'Last octet of the mask', [256, '−', 'blk']), v => `, so the mask is 255.255.255.${seNum(v.mk)}`],
      [seVal('off', v => d % v.blk, (v, r) => `${d} mod ${seNum(v.blk)} is ${seNum(r)}, so `), seEq('net', 'last octet of the network address', [d, '−', 'off']), v => `: the network address is ${pre}${seNum(v.net)}`],
      [seEq('bc', 'Last octet of the broadcast address = network + addresses − one', ['net', '+', 'blk', '−', 1], { wrong: r => [r + 1] }), v => `: the broadcast address is ${pre}${seNum(v.bc)}`],
      [seEq('hosts', 'Usable hosts = addresses − two', ['blk', '−', 2], { wrong: r => [r + 2] }), '; ', seEq('last', 'last host’s last octet = broadcast − one', ['bc', '−', 1]), v => `: ${pre}${seNum(v.last)}`]],
    answer: v => ({ broadcast: `${pre}${v.bc}`, network: `${pre}${v.net}`, last_host: `${pre}${v.last}`, hosts: v.hosts })[ask] };
  } },
];
function makeCalcSpotDrill(topic, subject) {
  const fits = SE_BUILDERS.filter(b => b.re.test(topic) && !(b.not && b.not.test(topic)));
  if (!fits.length) return null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const b = sePick(fits), x = b.make(topic);
    let sol, steps, right;
    try { sol = Solvers.solve(b.id, x.params); steps = x.steps(sol); right = seRun(steps); } catch { continue; }
    // The written working must reach the calculator's answer, and none of its sums may be off.
    if (!seSame(x.answer(right.v), sol.value) || right.text.some(s => /NaN|Infinity|undefined/.test(s) || arithmeticSweep(plainText(s)).items.length)) continue;
    // Try the steps in random order; prefer a slip that changes the final answer, as a real one usually does.
    const truth = x.answer(right.v);
    let pickd = null;
    for (const e of right.eqs.slice().sort(() => Math.random() - 0.5)) {
      const wrong = seWrong(e);
      if (wrong == null) continue;
      const bad = seRun(steps, { key: e.key, value: wrong });
      const flagged = bad.text.map((s, i) => arithmeticSweep(plainText(s)).items.length ? i : -1).filter(i => i >= 0);
      if (!(flagged.length === 1 && flagged[0] === e.step) || bad.text.some(s => /NaN|Infinity|undefined/.test(s))) continue;
      const cand = { e, bad, shown: x.answer(bad.v) };
      if (!seSame(cand.shown, truth)) { pickd = cand; break; }
      pickd = pickd || cand;
    }
    if (!pickd) continue;
    const { e, bad, shown } = pickd, slip = arithmeticSweep(plainText(bad.text[e.step])).items[0];
    const tail = seSame(shown, truth) ? `This slip happens not to change the final answer, ${truth}.` : `The wrong value is carried forward, so the solution ends at ${shown} instead of **${truth}**.`;
    const sname = Solvers.byId(b.id).name;
    return { kind: 'calc', checkedBy: `the exact ${sname} calculator`, question: x.question, steps: bad.text, k: e.step, correct_step: right.text[e.step],
      explanation: `${slip.problem} ${tail} The correct answer was computed by the exact ${sname} calculator.`, concept: topic, topic, subject: subject || Solvers.byId(b.id).subject };
  }
  return null;
}
const SPOT_SCHEMA = { type: 'object', required: ['question', 'steps', 'error_step', 'error_kind', 'correct_step', 'explanation', 'concept'], properties: {
  question: { type: 'string' }, concept: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, error_step: { type: 'integer' },
  error_kind: { type: 'string', enum: ['calculation', 'formula', 'concept'] }, correct_step: { type: 'string' }, explanation: { type: 'string' } } };
async function makeSpotDrill(topic, subject, signal) {
  const calc = makeCalcSpotDrill(topic, subject);
  if (calc) return calc;
  for (let attempt = 0; attempt < 3; attempt++) {
    jobLabel(`Writing a solution with one planted mistake${attempt ? ` (try ${attempt + 1})` : ''}`, signal);
    const kind = attempt === 0 && /formula|theory|concept/i.test(topic) ? 'formula or concept' : 'calculation';
    let j; try { j = parseJSON(await ollamaChat([
      { role: 'system', content: `Write a GATE CS practice exercise on the given topic: a short GATE-style numerical question and its worked solution as 4 to 7 steps. Make EXACTLY ONE step wrong on purpose (a ${kind} mistake that a student could plausibly make), and keep every other step completely correct. Write every calculation as an explicit equation with its result, e.g. "0.9 × 10 + 0.1 × 110 = 20". Later steps may follow from the wrong value. error_step: the number (1-based) of the wrong step. correct_step: that step written correctly. explanation: why the original step is wrong, in 1-2 sentences. Use LaTeX for math only inside $...$, and keep numbers plain in equations. Return JSON.` },
      { role: 'user', content: `Topic: ${topic}${subject ? ` (${subject})` : ''}${factsBlock(factsFor(topic, 4, subject))}` },
    ], { signal, temperature: 0.6, maxTokens: 2200, format: SPOT_SCHEMA })); } catch (e) { if (e.name === "AbortError") throw e; continue; }   // a broken draft is one failed try
    const steps = (j.steps || []).map(s => String(s)), k = (j.error_step | 0) - 1;
    if (steps.length < 3 || k < 0 || k >= steps.length) continue;
    const flagged = steps.map((s, i) => arithmeticSweep(plainText(s)).items.length ? i : -1).filter(i => i >= 0);
    let checkedBy = 'exact recalculation';
    // The small model often labels a reasoning slip "calculation" while every sum in it is right: then there is no
    // arithmetic to recheck, so the planted step is verified like a formula or concept mistake instead.
    if (j.error_kind === 'calculation' && flagged.length) {
      // Steps after the slip may reuse the wrong value consistently; only the slip itself should miscalculate.
      if (!(flagged.length === 1 && flagged[0] === k)) continue;
      if (arithmeticSweep(plainText(j.correct_step)).items.length) continue;
    } else {
      if (flagged.length) continue;   // an unplanted arithmetic error somewhere: not a one-mistake drill
      const facts = factsFor(`${topic} ${steps[k]}`, 4, subject);
      // The step is judged with the question and the steps before it: "P1 finishes at t=14" can't be confirmed without them.
      const before = steps.slice(0, k).map((s, i) => `Step ${i + 1}: ${s}`).join('\n'), material = `QUESTION: ${j.question}${before ? `\n\nSOLUTION SO FAR (correct):\n${before}` : ''}`;
      const bad = await truthCheck(steps[k], { facts, material, signal }), good = await truthCheck(j.correct_step, { facts, material, signal });
      if (!(bad.verdict === 'false' && bad.confidence >= 60 && good.verdict === 'true' && good.confidence >= 60)) continue;
      checkedBy = 'the fact-checker';
    }
    return { ...j, steps, k, topic, subject, kind: 'model', checkedBy };
  }
  return null;
}
function spotDrill(topic) {
  const weak = weakConcepts(5)[0];
  const t = (topic || '').trim() || (weak && weak.concept) || ['Cache memory', 'CPU scheduling', 'Page replacement', 'Subnetting', 'Pipelining'][Math.floor(Math.random() * 5)];
  const subject = (!topic && weak && weak.subject) || lessonSubject(t) || '';
  const el = $('#practiceRun'); practiceRunOpts();
  el.innerHTML = '<div class="card"><p class="muted">Writing a solution with one planted mistake and checking that the mistake is real&hellip;</p></div>';
  let d = null;
  runJob('Spot the error', async signal => { d = await makeSpotDrill(t, subject, signal); }, () => {
    if (!d) { el.innerHTML = `<div class="card"><p>I couldn't make a drill on <b>${escapeHtml(t)}</b> whose mistake I could verify. Try another topic.</p><div class="row"><button class="se-back">Back</button></div></div>`; $('.se-back', el).onclick = backToPractice; return; }
    el.innerHTML = `<div class="card se">
      <div class="row"><div class="eyebrow" style="flex:1">Spot the error · ${escapeHtml(d.concept || t)}</div><button class="link se-back">Back to practice</button></div>
      <div class="small muted se-kind">${d.kind === 'calc' ? `${icon('check')} Exact calculation drill: the working comes from ${escapeHtml(d.checkedBy)}, with one slip planted in it.` : `Concept drill written by the model; the planted mistake was confirmed by ${escapeHtml(d.checkedBy)}.`}</div>
      <div class="md se-q">${renderMd(d.question)}</div>
      <p class="small muted">Click the wrong step.</p>
      <ol class="se-steps">${d.steps.map((s, i) => `<li><button class="se-step" data-i="${i}"><span class="se-n">${i + 1}</span><span class="md">${renderMd(s)}</span></button></li>`).join('')}</ol>
      <div class="se-verdict"></div></div>`;
    $('.se-back', el).onclick = backToPractice;
    el.querySelectorAll('.se-step').forEach(b => b.onclick = async () => {
      const i = +b.dataset.i, right = i === d.k;
      el.querySelectorAll('.se-step').forEach(x => { x.disabled = true; if (+x.dataset.i === d.k) x.classList.add('wrong-step'); });
      if (!right) b.classList.add('picked');
      $('.se-verdict', el).innerHTML = `<div class="${right ? 'm-win' : 'm-lose'}">${right ? `${icon('check')} <b>Found it.</b>` : `Not quite: the mistake is in <b>step ${d.k + 1}</b>.`}</div>
        <div class="md" style="margin-top:8px"><p><b>Correct step ${d.k + 1}:</b></p>${renderMd(d.correct_step)}${renderMd(d.explanation)}</div>
        <div class="row" style="margin-top:10px"><button class="primary se-again">Another one</button><button class="se-back2">Back to practice</button></div>`;
      $('.se-again', el).onclick = () => spotDrill(topic);
      $('.se-back2', el).onclick = backToPractice;
      await updateHub(h => { h.spotResults = (h.spotResults || []).concat([{ concept: d.concept || t, subject: d.subject || subject, right, at: new Date().toISOString() }]).slice(-300); });
      await refreshHub();
    });
  });
}
$('#seGo').onclick = () => spotDrill($('#seTopic').value);
const subjOpts = SUBJECTS.map(s => `<option>${escapeHtml(s)}</option>`).join('');
document.querySelectorAll('select.subj').forEach(s => s.innerHTML = subjOpts);

// ---------- concept-level strength: every signal about a concept, recent ones counting more ----------
// Sources: test answers (mistake retests included), failed spaced reviews, conquered mistakes, mastery checks
// and PYQs answered in the Daily mix. Strength = (right + 1) / (tries + 2), each try weighted by recency
// (half-life 3 weeks), so one lucky answer doesn't make a concept "strong" and old slips fade.
function conceptKey(c) { return String(c || '').toLowerCase().replace(/\b(algorithms?|problems?|basics|concepts?|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function conceptWeakness() {
  const now = Date.now(), w = at => Math.pow(0.5, Math.max(0, now - (new Date(at || now).getTime() || now)) / (21 * 864e5));
  const st = {};
  const add = (concept, subject, right, at, src) => {
    const c = String(concept || '').trim(), k = conceptKey(c);
    if (!k) return;
    const e = st[k] = st[k] || { key: k, concept: c, subject: subject || '', right: 0, n: 0, tries: 0, wrong: 0, src: {}, last: '' };
    const x = w(at);
    e.n += x; if (right) e.right += x; else e.wrong++;
    e.tries++; e.src[src] = (e.src[src] || 0) + 1;
    if (!e.subject && subject) e.subject = subject;
    if (at && at > e.last) e.last = at;
  };
  for (const a of H.attempts || []) for (const r of a.results || []) if (r.status !== 'skipped') add(r.concept, r.subject, r.status === 'correct', a.at, 'tests');
  for (const m of H.mistakes || []) { const lp = reviewInfo(m).lapses; for (let i = 0; i < lp; i++) add(m.q.concept, m.q.subject, false, (m.review || {}).last || m.at, 'reviews'); if (m.pyqId) add(m.q.concept, m.q.subject, false, m.at, 'PYQs'); }
  for (const f of H.fixed || []) add(f.concept, f.subject, true, f.at, 'conquered');
  for (const e of H.covered || []) {
    const fails = Math.max(0, (e.tries || 0) - (e.mastered ? 1 : 0));
    for (let i = 0; i < fails; i++) add(e.topic, e.subject, false, e.lastTry, 'mastery checks');
    if (e.mastered) add(e.topic, e.subject, true, e.mastered, 'mastery checks');
  }
  for (const p of H.pyqResults || []) if (p.right) add(p.concept, p.subject, true, p.at, 'PYQs');   // wrong ones are counted through their mistake
  for (const s of H.spotResults || []) add(s.concept, s.subject, s.right, s.at, 'spot-the-error');
  return Object.values(st).map(e => ({ ...e, acc: (e.right + 1) / (e.n + 2) }));
}
function weakConcepts(n = 6) {
  return conceptWeakness().filter(e => e.acc < 0.6).sort((a, b) => a.acc - b.acc || b.tries - a.tries).slice(0, n);
}
// The Mistake lab panel: weakest concepts with what they're based on, and a way to work on each.
function conceptPanelHtml() {
  const all = conceptWeakness(), weak = all.filter(e => e.acc < 0.6).sort((a, b) => a.acc - b.acc || b.tries - a.tries).slice(0, 8);
  const strong = all.filter(e => e.acc >= 0.75 && e.tries >= 3).sort((a, b) => b.acc - a.acc).slice(0, 4);
  if (!weak.length && !strong.length) return '';
  const bar = e => `<span class="cw-bar"><span style="width:${Math.round(100 * e.acc)}%"></span></span><b>${Math.round(100 * e.acc)}%</b>`;
  return `<div class="section-title"><h3>Concept strength <span class="tip" tabindex="0" title="From tests, reviews, mastery checks and PYQs; recent answers count more">${icon('help')}</span></h3></div>
    <div class="card cw">${weak.map(e => `<div class="cw-row"><div class="cw-name"><b>${escapeHtml(e.concept)}</b><span class="small muted">${escapeHtml(e.subject)} · ${e.tries} answer${e.tries > 1 ? "s" : ""}</span></div>${bar(e)}
      <button class="small" data-cwteach="${escapeHtml(e.concept)}">Teach me</button><button class="small primary" data-cwprac="${escapeHtml(e.key)}">Practise 5</button></div>`).join('')}
      ${strong.length ? `<div class="small muted" style="margin-top:10px">Strong: ${strong.map(e => `<b>${escapeHtml(e.concept)}</b> ${Math.round(100 * e.acc)}%`).join(' · ')}</div>` : ''}</div>`;
}
function wireConceptPanel(root) {
  root.querySelectorAll('[data-cwteach]').forEach(b => b.onclick = () => teachTopic(b.dataset.cwteach));
  root.querySelectorAll('[data-cwprac]').forEach(b => b.onclick = () => {
    const e = conceptWeakness().find(x => x.key === b.dataset.cwprac);
    if (!e) return;
    startGenerated(`Practice: ${e.concept}`, $('#mlRun'), 'Mistakes', () => [{ subject: e.subject || '', focus: e.concept, label: e.concept, count: 5 }], { onDone: () => {} });
  });
}
$('#adGo').onclick = () => {
  const total = +$('#adCount').value;
  const weak = weakConcepts(6);
  if (!weak.length && !confirm('No weak areas found yet (take a few tests first). Start a mixed test across all subjects instead?')) return;
  practiceRunOpts();
  startGenerated('Adaptive test', $('#practiceRun'), 'Practice', () => {
    if (!weak.length) return SUBJECTS.filter(s => s !== 'General Aptitude').slice(0, total).map(s => ({ subject: s, label: s, count: 1 }));
    const per = Math.ceil(total / weak.length);
    return weak.map(w => ({ subject: w.subject || '', focus: w.concept, label: w.concept, count: per }));
  }, { onDone: () => {} });
};
// GATE CS marks weightage (approx.), used to spread mock questions.
const MOCK_WEIGHTS = { 'General Aptitude': 15, 'Discrete Mathematics': 6, 'Linear Algebra': 2, 'Calculus': 2, 'Probability and Statistics': 3, 'Digital Logic': 5,
  'Computer Organization and Architecture': 9, 'Programming and Data Structures': 12, 'Algorithms': 9, 'Theory of Computation': 8, 'Compiler Design': 6,
  'Operating System': 9, 'Databases': 8, 'Computer Networks': 9 };
$('#mockGo').onclick = () => {
  const size = $('#mockSize').value;
  const { n, minutes } = { mini: { n: 15, minutes: 45 }, half: { n: 33, minutes: 90 }, full: { n: 65, minutes: 180 } }[size];
  // Real GATE pattern: General Aptitude 10 Q (5 × 1 mark, 5 × 2 marks); technical 55 Q (25 × 1, 30 × 2), spread by subject weight.
  const ga = Math.round(n * 10 / 65), tech = n - ga, ga1 = Math.ceil(ga / 2), t1 = Math.round(tech * 25 / 55);
  const techW = Object.entries(MOCK_WEIGHTS).filter(([s]) => s !== 'General Aptitude');
  const spread = total => {   // largest-remainder split of `total` questions over the technical subjects
    const sum = techW.reduce((a, [, w]) => a + w, 0);
    const raw = techW.map(([s, w]) => ({ s, x: total * w / sum }));
    raw.forEach(r => { r.c = Math.floor(r.x); });
    let left = total - raw.reduce((a, r) => a + r.c, 0);
    raw.slice().sort((a, b) => (b.x - b.c) - (a.x - a.c)).forEach(r => { if (left > 0) { r.c++; left--; } });
    return raw.filter(r => r.c > 0);
  };
  const plan = [
    { subject: 'General Aptitude', label: 'General Aptitude', section: 'General Aptitude', count: ga1, marks: 1 },
    { subject: 'General Aptitude', label: 'General Aptitude', section: 'General Aptitude', count: ga - ga1, marks: 2 },
  ].filter(p => p.count > 0);
  const t1s = spread(t1), t2s = spread(tech - t1);
  for (const [s] of techW) {
    const a = t1s.find(r => r.s === s), b = t2s.find(r => r.s === s);
    if (a) plan.push({ subject: s, label: s, section: 'Technical', count: a.c, marks: 1 });
    if (b) plan.push({ subject: s, label: s, section: 'Technical', count: b.c, marks: 2 });
  }
  const partial = { id: uid(), name: `GATE mock (${size})`, kind: 'mock', created: new Date().toISOString(), questions: [], minutes };
  practiceRunOpts();
  // Build incrementally so "Stop" keeps what's been written.
  let ready = null;
  runJob(`Generating GATE mock (${n} questions)`, async signal => {
    for (const p of plan) {
      const t = await buildTest({ name: partial.name, kind: 'mock', plan: [p], types: ['MCQ', 'MSQ', 'NAT'], ...practiceOpts(), minutes, signal }).catch(e => { if (e.name === 'AbortError') throw e; return { questions: [] }; });
      partial.questions.push(...t.questions);
      jobLabel(`Mock: ${partial.questions.length} / ${n} questions ready`, signal);
      progress(partial.questions.length, n, signal);
    }
  }, () => {
    if (partial.questions.length) { partial.minutes = Math.max(10, Math.round(minutes * partial.questions.length / n)); ready = partial; runTestIn($('#practiceRun'), ready, 'Mock'); }
    else backToPractice();
  });
};
$('#subGo').onclick = () => {
  const s = $('#subSel').value, n = +$('#subCount').value, focus = $('#subFocus').value.trim();
  practiceRunOpts();
  startGenerated(`${s} test`, $('#practiceRun'), 'Practice', () => [{ subject: s, focus, label: focus || s, count: n }], { onDone: () => {} });
};
$('#drillGo').onclick = () => {
  const s = $('#drillSel').value;
  practiceRunOpts();
  startGenerated(`Speed drill: ${s}`, $('#practiceRun'), 'Drill', () => [{ subject: s, label: s, count: 10 }], { oneMarkOnly: true, minutes: 15, onDone: () => {} });
};
// Today's review: only the mistakes whose day-1 / day-3 / day-7 review is due.
$('#mistakeRetest').onclick = () => {
  const list = dueMistakes(mistShown());
  if (!list.length) {
    const next = H.mistakes.map(m => reviewInfo(m).due).sort((a, b) => a - b)[0];
    toast(next ? `Nothing due right now. The next review is ${fmtDue(next)}.` : 'No mistakes yet. Every wrong answer from a test lands here.');
    return;
  }
  const qs = list.slice(0, 20).map(m => ({ ...fixInlineOptions(m.q), id: uid(), mistakeId: m.id, label: m.q.label || m.q.concept }));
  runTestIn($('#mlRun'), { id: uid(), name: `Today's mistake review (${qs.length})`, kind: 'mistakes', created: new Date().toISOString(), questions: qs }, 'Mistakes');
};
function fmtDue(d) {
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? `on ${new Date(d).toLocaleDateString(undefined, { weekday: 'long' })}` : `on ${new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
$('#mistakeSimilar').onclick = () => {
  const list = mistShown();
  if (!list.length) { toast('No mistakes yet.'); return; }
  const concepts = [];
  for (const m of list) if (m.q.concept && !concepts.some(c => c.concept === m.q.concept)) concepts.push(m.q);
  startGenerated('New questions on my weak concepts', $('#mlRun'), 'Mistakes',
    () => concepts.slice(0, 6).map(q => ({ subject: q.subject || '', focus: q.concept, label: q.concept, count: 2, material: `Example of a question the student got wrong:\n${q.question}\nSolution: ${q.explanation}` })), { onDone: () => {} });
};
$('#goMistakes').onclick = () => openTab('mistakes');
$('#mixGo').onclick = () => DailyMix.start();
$('#mlMix').onclick = () => DailyMix.start();
// Every screen opens like a chapter: its first card becomes a header with an eyebrow label.
for (const [t, label] of Object.entries({ solve: 'Photo doubt', pyq: 'Previous-year questions', topics: 'My library · Topics', notes: 'My library · Notes', formulas: 'My library · Formula book', files: 'My library · Notes & books', settings: 'Settings' })) {
  const card = $('#tab-' + t + ' .card');
  if (card && card.querySelector('h2') && !card.classList.contains('page-head')) card.classList.add('page-head');   // the heading names the page: no extra label above it
}

// ---------- MISTAKE LAB ----------
const ERR_META = {
  conceptual: { name: 'Concept gap', ico: 'book', tip: 'The idea itself isn\'t solid yet. Re-learn it from first principles (Teach me), then retry the question cold.', why: 'You didn\'t yet own the idea behind it.' },
  calculation: { name: 'Calculation slip', ico: 'sigma', tip: 'Right method, wrong arithmetic. Write every step, and check numericals with the exact calculators in Photo doubt.', why: 'Right approach, a slip in the working.' },
  misread: { name: 'Misread', ico: 'search', tip: 'Underline NOT / EXCEPT / always / at most, and restate the question in your own words before solving.', why: 'A word or condition changed what was asked.' },
  guess: { name: 'Rushed guess', ico: 'clock', tip: 'Give every question at least a minute: eliminate two options first, and skip MCQs you can\'t narrow down (negative marking).', why: 'Answered faster than it could be solved.' },
  unknown: { name: 'Not classified', ico: 'help', tip: 'Open "Why did I get it wrong?" to find out.', why: 'Not classified yet.' },
};
let mistFilter = { subject: '', type: '' };
const mistType = m => ERR_META[m.errorType] ? m.errorType : 'unknown';
// Due reviews first, then the rest by when they come back.
function mistShown() {
  return H.mistakes.filter(m => (!mistFilter.subject || m.q.subject === mistFilter.subject) && (!mistFilter.type || mistType(m) === mistFilter.type))
    .sort((a, b) => reviewInfo(a).due - reviewInfo(b).due);
}
// Day 1 → Day 3 → Day 7 dots for a card.
function stageDots(m) {
  const info = reviewInfo(m);
  return `<span class="rv-dots" title="Reviews on day 1, 3 and 7 after the mistake. Pass all three to conquer it.">${REVIEW_DAYS.map((d, i) => `<span class="rv-dot ${i < info.stage ? 'done' : i === info.stage ? (info.isDue ? 'due' : 'next') : ''}">Day ${d}</span>`).join('<i></i>')}</span>`;
}
function renderMistakes() {
  if ($('#mlRun').innerHTML) return;   // a retest is running here
  const all = H.mistakes, fixed = (H.fixed || []).slice().reverse();
  const count = (l, f) => l.reduce((o, x) => (o[f(x)] = (o[f(x)] || 0) + 1, o), {});
  const byType = count(all, mistType), bySub = count(all, m => m.q.subject || 'Other');
  const topType = Object.entries(byType).filter(([t]) => t !== 'unknown').sort((a, b) => b[1] - a[1])[0];
  const topSub = Object.entries(bySub).sort((a, b) => b[1] - a[1])[0];
  const due = dueMistakes(all);
  $('#mlLine').innerHTML = !all.length ? (fixed.length ? `${fixed.length} fixed` : '')
    : [`${all.length} open`, fixed.length && `${fixed.length} fixed`, topSub && `mostly <b>${escapeHtml(topSub[0])}</b>`, topType && `usual cause: <b>${ERR_META[topType[0]].name.toLowerCase()}</b>`].filter(Boolean).join(' · ');
  $('#mistakeRetest').innerHTML = `${icon('refresh')} ${due.length ? `Review (${due.length})` : 'Nothing due'}`;
  $('#mistakeRetest').classList.toggle('primary', due.length > 0);
  // The review plan: what's due today, and the coming week.
  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; });
  const perDay = week.map((d, i) => all.filter(m => { const due = reviewInfo(m).due; return i === 0 ? due < new Date(d.getTime() + 864e5) : due >= d && due < new Date(d.getTime() + 864e5); }).length);
  const reviewHtml = all.length ? `<div class="card ml-review">
    <div class="rv-left"><div class="rv-kicker">Spaced review <span class="tip" tabindex="0" title="Each mistake returns on day 1, 3 and 7. Right when due moves it on; a wrong answer restarts it.">${icon('help')}</span></div><div class="rv-big">${due.length ? `${due.length} due today` : 'All caught up'}</div></div>
    <div class="rv-week">${week.map((d, i) => `<div class="rv-day ${i === 0 ? 'today' : ''} ${perDay[i] ? 'has' : ''}"><span>${i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}</span><b>${perDay[i] || '·'}</b></div>`).join('')}</div>
  </div>` : '';
  // Patterns: what kind of slips, where, and what to do about the biggest one.
  const total = Math.max(1, all.length);
  $('#mlInsights').innerHTML = reviewHtml + (all.length ? `<div class="ml-grid">
    <div class="card ml-stat"><div class="ml-num">${all.length}</div><div class="muted">open</div><div class="ml-num green">${fixed.length}</div><div class="muted">fixed</div>
      <div class="ml-ring" style="--p:${Math.round(100 * fixed.length / Math.max(1, fixed.length + all.length))}"><span>${Math.round(100 * fixed.length / Math.max(1, fixed.length + all.length))}%</span></div><div class="small muted">fixed</div></div>
    <div class="card"><div class="card-title">Why you slip</div>
      ${Object.keys(ERR_META).filter(t => byType[t]).map(t => `<button class="ml-type ${mistFilter.type === t ? 'on' : ''}" data-mt="${t}"><span class="mt-ico et-${t}">${icon(ERR_META[t].ico)}</span><span class="mt-name">${ERR_META[t].name}</span><span class="mt-bar"><span class="et-${t}" style="width:${100 * byType[t] / total}%"></span></span><b>${byType[t]}</b></button>`).join('')}
      ${topType ? `<div class="ml-tip"><b>Tip:</b> ${ERR_META[topType[0]].tip}</div>` : ''}</div>
    <div class="card"><div class="card-title">Where</div>
      ${Object.entries(bySub).sort((a, b) => b[1] - a[1]).map(([s, n]) => `<button class="ml-sub ${mistFilter.subject === s ? 'on' : ''}" data-ms="${escapeHtml(s)}"><span>${escapeHtml(s)}</span><b>${n}</b></button>`).join('')}</div>
  </div>` : `<div class="card empty-state"><div class="es-ico">${icon('check')}</div><h3>No open mistakes</h3><button class="primary" id="mlPractice">Practice</button></div>`) + conceptPanelHtml() + miniLessonsHtml();
  $('#mlFilters').innerHTML = (mistFilter.subject || mistFilter.type) ? `<span class="small muted">Showing ${mistFilter.type ? ERR_META[mistFilter.type].name.toLowerCase() : ''}${mistFilter.type && mistFilter.subject ? ' in ' : ''}${escapeHtml(mistFilter.subject)}</span><button class="link small" id="mlClear">Show all</button>` : '';
  const list = mistShown();
  $('#mistakeCount').textContent = all.length || '';
  $('#mistakeList').innerHTML = list.map(m => {
    const t = mistType(m), q = fixInlineOptions(m.q), yours = [].concat(m.answer || []), rv = reviewInfo(m);
    return `<article class="mcard ${rv.isDue ? 'is-due' : ''}" data-mid="${m.id}">
      <header class="m-head"><span class="m-type et-${t}">${icon(ERR_META[t].ico)} ${ERR_META[t].name}</span><span class="m-where">${escapeHtml(q.subject || '')}${q.concept ? ' · ' + escapeHtml(q.concept) : ''}</span><span class="m-when">${relDay(m.at)} · ${escapeHtml(m.source || 'test')}</span></header>
      <div class="m-sched">${stageDots(m)}<span class="rv-when ${rv.isDue ? 'due' : ''}">${rv.isDue ? `Day-${rv.day} review due now` : `Day-${rv.day} review ${fmtDue(rv.due)}`}${rv.lapses ? ` · restarted ${rv.lapses}×` : ''}</span></div>
      <div class="md m-q">${renderMd(q.question)}</div>
      ${q.options.length ? `<ol class="m-opts">${q.options.map((o, k) => `<li class="${yours.includes('ABCD'[k]) ? 'yours' : ''}"><b>${'ABCD'[k]}</b><span class="md">${renderMd(o)}</span></li>`).join('')}</ol>` : ''}
      <div class="m-body"></div>
      <div class="m-answers"><span class="m-yours">You answered <b>${escapeHtml(fmtAns(m.answer))}</b></span><span class="m-hint">${ERR_META[t].why}</span></div>
      ${m.why ? `<details class="m-why"><summary>Why I got it wrong</summary><div class="md">${renderMd(m.why)}</div></details>` : ''}
      <div class="m-actions"><button class="${rv.isDue ? 'primary' : ''}" data-try="${m.id}">${icon('refresh')} ${rv.isDue ? 'Review' : 'Practise'}</button><button data-why="${m.id}">${icon('help')} ${m.why ? 'Explain again' : 'Why wrong?'}</button>
        <button data-like="${m.id}">${icon('spark')} 3 similar</button><span style="flex:1"></span><button class="link small" data-got="${m.id}" title="The question itself was wrong or unfair: remove it without counting it as fixed">Remove</button></div>
    </article>`;
  }).join('') || (all.length ? '<p class="empty">Nothing matches this filter.</p>' : '');
  $('#mlFixedCount').textContent = fixed.length ? String(fixed.length) : '';
  $('#mlFixed').innerHTML = fixed.length ? `<div class="conquered">${fixed.slice(0, 12).map(f => `<div class="cq"><span class="cq-ico">${icon('check')}</span><div><b>${escapeHtml(f.concept || 'A question')}</b><div class="small muted">${escapeHtml(f.subject || '')} · ${f.how === 'review' ? `passed its day-7 review ${relDay(f.at)}` : `fixed ${relDay(f.at)}`}</div></div></div>`).join('')}</div>`
    : '<p class="small muted">None yet.</p>';
  // wiring
  $('#mlInsights').querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { mistFilter.type = mistFilter.type === b.dataset.mt ? '' : b.dataset.mt; renderMistakes(); });
  $('#mlInsights').querySelectorAll('[data-ms]').forEach(b => b.onclick = () => { mistFilter.subject = mistFilter.subject === b.dataset.ms ? '' : b.dataset.ms; renderMistakes(); });
  if ($('#mlClear')) $('#mlClear').onclick = () => { mistFilter = { subject: '', type: '' }; renderMistakes(); };
  if ($('#mlPractice')) $('#mlPractice').onclick = () => openTab('practice');
  wireMiniLessons(); wireConceptPanel($('#mlInsights'));
  const byId = id => H.mistakes.find(x => x.id === id);
  $('#mistakeList').querySelectorAll('[data-try]').forEach(b => b.onclick = () => mistTry(byId(b.dataset.try), b.closest('.mcard')));
  $('#mistakeList').querySelectorAll('[data-why]').forEach(b => b.onclick = () => mistWhy(byId(b.dataset.why), b.closest('.mcard')));
  $('#mistakeList').querySelectorAll('[data-like]').forEach(b => b.onclick = () => {
    const m = byId(b.dataset.like);
    startGenerated(`3 like this: ${m.q.concept || 'my mistake'}`, $('#mlRun'), 'Mistakes', () => [{ subject: m.q.subject || '', focus: m.q.concept, label: m.q.concept || 'Similar', count: 3, material: `A question the student got wrong (make new ones on the same concept, with different numbers/situations):\n${m.q.question}\nSolution: ${m.q.explanation}` }], { onDone: () => {} });
  });
  $('#mistakeList').querySelectorAll('[data-got]').forEach(b => b.onclick = async () => {
    const id = b.dataset.got, m = byId(id), card = b.closest('.mcard');
    card.classList.add('leaving');
    await removeMistake(id); await refreshHub();
    setTimeout(() => { renderMistakes(); renderToday(); }, 350);
    toastUndo('Removed (not counted as conquered).', async () => { await updateHub(h => { h.mistakes.push(m); }); await refreshHub(); renderMistakes(); renderToday(); });
  });
}
// ---------- mini lessons: concepts that keep tripping you ----------
// A concept with 2+ open mistakes (or one you've already got wrong again in a review) gets a short lesson
// built from your actual wrong answers. Saved in hub.miniLessons[concept key].
function trippingConcepts() {
  const groups = {};
  for (const m of H.mistakes) {
    const c = (m.q.concept || '').trim(), key = slug(c || m.q.subject || 'general');
    if (!c) continue;
    (groups[key] = groups[key] || { key, concept: c, subject: m.q.subject || '', items: [], lapses: 0 }).items.push(m);
    groups[key].lapses += reviewInfo(m).lapses;
  }
  // Also merge near-identical concept names ("Page replacement" / "Page Replacement Algorithms").
  const list = Object.values(groups);
  const same = (a, b) => { const A = new Set(topicTokens(a)), B = new Set(topicTokens(b)), shared = [...A].filter(x => B.has(x)).length; return shared >= 2 || (shared >= 1 && (shared === A.size || shared === B.size)); };
  for (const g of list) for (const o of list) if (o !== g && o.items.length && g.items.length && g.subject === o.subject && same(g.concept, o.concept)) { g.items.push(...o.items); g.lapses += o.lapses; o.items = []; }
  return list.filter(g => g.items.length >= 2 || g.lapses >= 1).sort((a, b) => (b.items.length + b.lapses) - (a.items.length + a.lapses)).slice(0, 4);
}
function miniLessonsHtml() {
  const tc = trippingConcepts();
  if (!tc.length) return '';
  const saved = H.miniLessons || {};
  return `<div class="section-title"><h3>Recurring concepts</h3></div>
    <div class="trips">${tc.map(g => `<div class="card trip" data-trip="${g.key}">
      <div class="row"><div style="flex:1"><b>${escapeHtml(g.concept)}</b><div class="small muted">${escapeHtml(g.subject)} · ${g.items.length} mistake${g.items.length > 1 ? 's' : ''}${g.lapses ? ` · got wrong again ${g.lapses}×` : ''}</div></div>
        <button class="${saved[g.key] ? '' : 'primary'}" data-mini="${g.key}">${icon('book')} ${saved[g.key] ? 'Mini lesson' : '5-min lesson'}</button></div>
      <div class="trip-body md hidden"></div></div>`).join('')}</div>`;
}
function wireMiniLessons() {
  const tc = trippingConcepts();
  document.querySelectorAll('[data-mini]').forEach(b => b.onclick = () => {
    const g = tc.find(x => x.key === b.dataset.mini), card = b.closest('.trip'), body = $('.trip-body', card);
    body.classList.remove('hidden');
    const saved = (H.miniLessons || {})[g.key];
    const footer = `<div class="row" style="margin-top:12px"><button class="link" data-full="${escapeHtml(g.concept)}">Teach me the whole topic</button><button class="link" data-remini="${g.key}">Write it again</button></div>`;
    const wireFoot = () => {
      const f = $('[data-full]', body); if (f) f.onclick = () => { openTab('ask'); $('#askIn').value = `${g.concept} (${g.subject})`; teachTopic($('#askIn').value); };
      const r = $('[data-remini]', body); if (r) r.onclick = () => { delete (H.miniLessons || {})[g.key]; write(); };
    };
    const write = () => runJob('Writing your mini lesson', async signal => {
      const cases = g.items.slice(0, 5).map((m, i) => `Mistake ${i + 1} (${ERR_META[mistType(m)].name}): ${plainText(m.q.question).replace(/\s+/g, ' ').slice(0, 400)}${m.q.options.length ? ' Options: ' + m.q.options.map((o, k) => `${'ABCD'[k]}) ${o}`).join(' ') : ''}\nStudent answered: ${fmtAns(m.answer)} · Correct: ${keyOf(m.q)}`).join('\n\n');
      let md = await ollamaChat([
        { role: 'system', content: `You are a GATE CS mentor. The student keeps making mistakes on one concept. Write a SHORT, focused lesson (about 5 minutes of reading) in Markdown:
## The idea in one line
## What keeps going wrong
(name the exact misconception behind THEIR answers below, kindly, in 2-4 sentences)
## The rule, built from scratch
(the correct mental model in 3-6 steps, with a tiny example; derive, don't just state)
## Worked example
(one GATE-style question solved step by step)
## Your 3-second check
(one question to ask yourself before answering this kind of question again)
Use LaTeX for math. Add a mermaid diagram only if it really helps.${langNote()}` },
        { role: 'user', content: `Concept: ${g.concept} (${g.subject})\n\nThe student's mistakes:\n${cases}${factsBlock(factsFor(g.concept + ' ' + cases.slice(0, 1500), 6, g.subject))}` },
      ], { signal, maxTokens: 2200, onToken: (_, o) => { body.innerHTML = renderMd(o); } });
      let review = null;
      if (Cfg.get('factcheck', 'on') === 'on') { const fc = await factCheck(md, { title: g.concept, subject: g.subject, kind: 'mini lesson', signal, onStage: t => jobLabel(`Fact-checking: ${t}`, signal) }); md = fc.md; review = fc.review; }
      await updateHub(h => { h.miniLessons = h.miniLessons || {}; h.miniLessons[g.key] = { concept: g.concept, md, at: new Date().toISOString(), review }; });
      await refreshHub();
      body.innerHTML = (review ? reviewHtml(review, { actions: false }) : '') + renderMd(md) + footer; wireFoot();
      b.classList.remove('primary'); b.innerHTML = `${icon('book')} Read my mini lesson`;
    });
    if (saved) { body.innerHTML = (saved.review ? reviewHtml(saved.review, { actions: false }) : '') + renderMd(saved.md) + footer; wireFoot(); }
    else { body.innerHTML = '<p class="muted">Looking at your mistakes&hellip;</p>'; write(); }
  });
}
// Try it again, right in the card: answer it cold, then see the verdict.
function mistTry(m, card) {
  fixInlineOptions(m.q);
  const q = m.q, box = $('.m-body', card);
  card.classList.add('trying');
  $('.m-answers', card).classList.add('hidden');
  const multi = q.type === 'MSQ';
  box.innerHTML = `<div class="m-try">${q.type === 'NAT' ? `<label>Your answer <input type="number" step="any" class="m-nat" style="width:160px"></label>`
    : q.options.map((o, k) => `<label class="opt"><input type="${multi ? 'checkbox' : 'radio'}" name="mt-${m.id}" value="${'ABCD'[k]}"><b>${'ABCD'[k]}.</b><div class="md">${renderMd(o)}</div></label>`).join('')}
    <div class="row" style="margin-top:10px"><button class="primary m-check">Check my answer</button><button class="link m-cancel">Cancel</button></div><div class="m-verdict"></div></div>`;
  $('.m-cancel', box).onclick = () => { box.innerHTML = ''; card.classList.remove('trying'); $('.m-answers', card).classList.remove('hidden'); };
  $('.m-check', box).onclick = async () => {
    const a = q.type === 'NAT' ? $('.m-nat', box).value.trim() : multi ? [...box.querySelectorAll('input:checked')].map(x => x.value) : (box.querySelector('input:checked') || {}).value;
    if (!isAnswered(a)) { toast('Pick an answer first.'); return; }
    const r = grade(q, a), before = reviewInfo(m);
    const out = await reviewMistake(m.id, r.status === 'correct');
    await refreshHub();
    const now = H.mistakes.find(x => x.id === m.id), after = now && reviewInfo(now);
    const msg = {
      conquered: `<div class="m-win">${icon('check')} <b>Day-7 review passed. Conquered!</b> Three spaced reviews in a row: this one is yours now.</div>`,
      advanced: `<div class="m-win">${icon('check')} <b>Day-${before.day} review passed.</b> It comes back for its day-${after && after.day} review ${after ? fmtDue(after.due) : ''}.</div>`,
      early: `<div class="m-win soft">${icon('check')} <b>Correct.</b> Its day-${before.day} review isn't due until ${fmtDue(before.due)}, so this doesn't count yet. Answer it then, from memory, to move it on.</div>`,
      reset: `<div class="m-lose">Not yet: the answer is <b>${escapeHtml(keyOf(q))}</b>. The schedule starts over: it comes back tomorrow for its day-1 review.</div>`,
    }[out] || '';
    $('.m-verdict', box).innerHTML = msg + `<div class="md">${renderMd(q.explanation)}</div>`;
    $('.m-check', box).remove();
    if (out === 'conquered' || out === 'advanced') card.classList.add('won');
    if (out === 'conquered') setTimeout(() => { renderMistakes(); renderToday(); }, 3000);
    else $('.m-cancel', box).textContent = 'Done';
    $('.m-cancel', box).onclick = () => { renderMistakes(); renderToday(); };
  };
}
// Why did I get it wrong? The tutor explains the specific misconception (saved with the mistake).
function mistWhy(m, card) {
  const q = m.q;
  let out = $('.m-why', card);
  if (!out) { card.querySelector('.m-actions').insertAdjacentHTML('beforebegin', '<details class="m-why" open><summary>Why I got it wrong</summary><div class="md"></div></details>'); out = $('.m-why', card); }
  out.open = true;
  const md = $('.md', out);
  md.innerHTML = '<p class="muted">Thinking about your answer&hellip;</p>';
  runJob('Explaining your mistake', async signal => {
    const opts = q.options.length ? '\n' + q.options.map((o, i) => `${'ABCD'[i]}. ${o}`).join('\n') : '';
    const text = await ollamaChat([
      { role: 'system', content: `You are a kind, sharp GATE CS mentor. A student got this question wrong. Explain, in Markdown:
## What you were probably thinking
(the specific misconception that leads to their answer, in 2-3 sentences, without blaming)
## Where it breaks
(the exact point where that thinking fails)
## The right way, step by step
(3-6 short steps to the correct answer)
## Remember
(one line rule that prevents this mistake next time)
Use LaTeX for math.${langNote()}` },
      { role: 'user', content: `Question (${q.type}):\n${q.question}${opts}\n\nStudent answered: ${fmtAns(m.answer)}\nCorrect answer: ${keyOf(q)}\nReference solution: ${q.explanation}\nMistake type (from analysis): ${ERR_META[mistType(m)].name}${factsBlock(factsFor(q.question + ' ' + (q.concept || ''), 5, q.subject))}` },
    ], { signal, maxTokens: 1500, onToken: (_, o) => { md.innerHTML = renderMd(o); } });
    await updateHub(h => { const x = h.mistakes.find(y => y.id === m.id); if (x) x.why = text; });
    await refreshHub();
  });
}
// ---------- PYQs tab: subject → year → questions; each opens as a masterclass ----------
let pyqSub = Cfg.get('pyqSub', ''), pyqYr = '', pyqOrder = [], pyqCur = null;
function pyqAll() { return (H.pyqs || []); }
function renderPyq() {
  const paperOn = !!$('#pyqRun').innerHTML;   // a paper is being taken here
  show('#pyqHome', !pyqCur && !paperOn); show('#pyqStudy', !!pyqCur && !paperOn);
  const all = pyqAll(), cnt = (l, f) => l.reduce((m, p) => (m[f(p)] = (m[f(p)] || 0) + 1, m), {});
  $('#pyqCount').textContent = all.length;
  // Pages from other books waiting to be checked for GATE-marked questions (uploads have their own panel).
  const other = (H.pyqScan || []).filter(x => !(H.pyqSources || {})[x.siteId]).length;
  $('#pyqScanInfo').textContent = other ? `Checking ${other} page${other > 1 ? 's' : ''} from your other books for GATE-marked questions…` : '';
  renderPyqProgress(); renderPyqKeys(); renderPyqPapers();
  const subs = cnt(all, p => p.subject || 'Unsorted');
  if (pyqSub && !subs[pyqSub]) pyqSub = '';
  $('#pyqSubTabs').innerHTML = Object.entries(subs).sort((a, b) => b[1] - a[1]).map(([s, n]) => `<button class="chip ${s === pyqSub ? 'on' : ''}" data-ps="${escapeHtml(s)}">${escapeHtml(s)} <span class="muted">${n}</span></button>`).join('') || '<p class="empty">No PYQs found yet. Upload a GATE paper or a book with "GATE 2019"-style markings, or add one from Photo doubt.</p>';
  $('#pyqSubTabs').querySelectorAll('[data-ps]').forEach(b => b.onclick = () => { pyqSub = b.dataset.ps; pyqYr = ''; Cfg.set('pyqSub', pyqSub); renderPyq(); });
  const inSub = all.filter(p => (p.subject || 'Unsorted') === pyqSub);
  show('#pyqYearWrap', !!pyqSub);
  const yrs = cnt(inSub, p => p.year || 'Year unknown');
  $('#pyqYearTabs').innerHTML = Object.entries(yrs).sort((a, b) => b[0].localeCompare(a[0])).map(([y, n]) => `<button class="chip ${y === pyqYr ? 'on' : ''}" data-py="${y}">${y} <span class="muted">${n}</span></button>`).join('');
  $('#pyqYearTabs').querySelectorAll('[data-py]').forEach(b => b.onclick = () => { pyqYr = b.dataset.py; renderPyq(); });
  const list = !pyqSub ? [] : inSub.filter(p => !pyqYr || (p.year || 'Year unknown') === pyqYr).sort((a, b) => (b.year || '').localeCompare(a.year || ''));
  pyqOrder = list.map(p => p.id);
  $('#pyqList').innerHTML = !pyqSub ? '<div class="card"><p class="empty">Pick a subject above.</p></div>' : list.map(p => `<div class="card row"><div style="flex:1;min-width:220px">
      <div class="small muted">GATE ${escapeHtml(p.year || '?')}${p.concept ? ' · ' + escapeHtml(p.concept) : ''} · ${p.source.kind === 'file' ? escapeHtml(prettyName(p.source.site || '')) + ', p.' + p.source.page : 'photo'}${p.master && (p.parts || []).length >= 3 ? ' · masterclass ready' : ''}${p.answer && p.answer.level === 'official' ? ' · <b>official key</b>' + (p.answer.tutorAgree === false ? ' <span style="color:var(--red)">(tutor had it wrong)</span>' : '') : p.answer ? ' · answer checked' : ''}${p.keyConflict ? ' · <span style="color:var(--red)">masterclass needs a rewrite</span>' : ''}${p.needsCheck ? ' · <b style="color:var(--red)">needs checking</b>' : p.reread && p.reread.ok ? ' · re-read carefully' : p.handChecked ? ' · fixed by you' : ''}</div>
      <div>${escapeHtml(plainText(p.text).replace(/\s+/g, ' ').slice(0, 180))}…</div></div><button class="primary" data-po="${p.id}">Teach me this PYQ</button></div>`).join('');
  $('#pyqList').querySelectorAll('[data-po]').forEach(b => b.onclick = () => openPyq(b.dataset.po));
}
const pyqViewer = new LessonViewer($('#pyqLesson'), {
  finishLabel: 'continue → next PYQ',
  onFinish: () => pyqNext(),
  decorate: (kind, card) => {
    const h = card.querySelector('h2');
    if (h && /RETURN TO THE ORIGINAL/i.test(h.textContent) && pyqCur && pyqCur.answer) card.insertAdjacentHTML('afterbegin', pyqAnswerHtml(pyqCur));
    markUnverified(card, mergeReviews(pyqCur && pyqCur.reviews));
  },
});
function pyqNext() {
  const i = pyqOrder.indexOf(pyqCur && pyqCur.id);
  if (i >= 0 && i < pyqOrder.length - 1) openPyq(pyqOrder[i + 1]);
  else { toast('That was the last PYQ in this year. Pick another year or subject.', 'ok'); pyqCur = null; renderPyq(); }
}
window.onContinue = () => { if (tab === 'pyq' && pyqCur) { TutorChat.close(); pyqNext(); return true; } return false; };
function openPyq(id, rewrite) {
  const p = pyqAll().find(x => x.id === id);
  if (!p) return;
  pyqCur = p; renderPyq(); window.scrollTo({ top: 0 });
  $('#pyqMeta').innerHTML = `<b>GATE ${escapeHtml(p.year || '?')}</b> · ${escapeHtml(p.subject)}${p.concept ? ' · ' + escapeHtml(p.concept) : ''}`;
  if (p.keyConflict && !rewrite) $('#pyqMeta').insertAdjacentHTML('beforeend', `<div class="small" style="color:var(--red)">This masterclass was written before the official key arrived and teaches a different answer (${escapeHtml(p.answer.tutor ? p.answer.tutor.text : '?')}, the key says ${escapeHtml(p.answer.text)}). Press Rewrite.</div>`);
  $('#pyqMeta').insertAdjacentHTML('beforeend', ` <button class="link small" id="pyqEditGo">${icon('pencil')} Edit question</button>`);
  $('#pyqEditGo').onclick = () => pyqEditOpen(p);
  $('#pyqEdit') && $('#pyqEdit').remove();
  $('#pyqCheck') && $('#pyqCheck').remove();
  // Misread text: show what was read and why it's doubtful; nothing is checked or taught from it until it is fixed.
  if (p.needsCheck) {
    mountPyqReview({});
    pyqViewer.set('');
    const g = p.garble || {}, rr = p.reread;
    $('#pyqLesson').insertAdjacentHTML('beforebegin', `<div id="pyqCheck" class="card" style="border-left:3px solid var(--red)">
      <div class="card-title" style="color:var(--red)">This question needs checking</div>
      <p class="small">Its text looks misread, so it is left out of paper mode and no answer check or masterclass is made from it until it is fixed:</p>
      <ul class="small">${(g.issues || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
      ${rr ? `<p class="small muted">${rr.why ? escapeHtml(rr.why) : 'The page was read again carefully, but the new reading still had problems.'}</p>` : p.source && p.source.kind === 'file' ? '<p class="small muted">The page it came from is no longer in your library, so it can\'t be read again.</p>' : ''}
      <div class="small muted" style="margin-top:6px">What was read:</div>
      <pre style="white-space:pre-wrap;font-size:13px;max-height:320px;overflow:auto">${escapeHtml(p.text)}</pre>
      <div class="row" style="margin-top:8px"><button class="primary" id="pyqCheckEdit">${icon('pencil')} Edit question</button><button class="link" id="pyqCheckOk">It's correct as it is</button></div></div>`);
    $('#pyqCheckEdit').onclick = () => pyqEditOpen(p);
    $('#pyqCheckOk').onclick = async () => {
      if (!confirm('Keep this text as it is? It goes back into paper mode, and its answer is checked and its masterclass written from this text.')) return;
      await pyqSaveEdit(p.id, p.text, p.answer || null);
      await refreshHub(); openPyq(p.id);
    };
    return;
  }
  if (rewrite) { p.parts = []; p.master = ''; p.reviews = []; }
  mountPyqReview(p);
  pyqViewer.set(p.master || '');
  if (p.answer && (p.parts || []).length >= 3) return;
  let flagged = false;
  runJob('PYQ masterclass', async signal => {
    // This window's copy may predate a misread check (another window or the background scan): never teach a flagged one.
    const cur = ((await Store.getHub()).pyqs || []).find(x => x.id === p.id);
    if (cur && cur.needsCheck) { flagged = true; return; }
    if (!p.answer) { p.answer = await pyqVerify(p, signal); await updateHub(h => { const x = (h.pyqs || []).find(y => y.id === p.id); if (x) x.answer = p.answer; }); }
    await pyqMasterclass(p, signal, md => { if (pyqCur === p) pyqViewer.set(md, { keepStep: true }); });
  }, async () => {
    await refreshHub();
    if (flagged) { if (pyqCur && pyqCur.id === p.id) openPyq(p.id); return; }
    if (pyqCur && pyqCur.id === p.id) {
      pyqCur = pyqAll().find(x => x.id === p.id) || p;
      mountPyqReview(pyqCur);
      pyqViewer.set(pyqCur.master || '', { keepStep: true });
    }
  });
}
// The masterclass's fact-check panel. Its text lives in three parts, so a decision is applied to the part holding it.
function mountPyqReview(p) {
  $('#pyqReview') && $('#pyqReview').remove();
  const r = mergeReviews(p.reviews);
  if (!r) return;
  $('#pyqLesson').insertAdjacentHTML('beforebegin', `<div id="pyqReview">${reviewHtml(r)}</div>`);
  wireReview($('#pyqReview'), {
    items: () => (p.reviews || []).flatMap(x => (x && x.items) || []),
    apply: (item, a) => {
      const parts = p.parts || [], look = a === 'undo' ? item.fix : item.quote;
      const k = parts.findIndex(t => locate(t, look));
      if (k >= 0) parts[k] = fcApply(parts[k], item, a); else fcApply('', item, a);
      p.master = parts.join('\n\n');
    },
    save: () => updateHub(h => { const x = (h.pyqs || []).find(y => y.id === p.id); if (x) { x.parts = (p.parts || []).slice(); x.master = p.master; x.reviews = p.reviews; } }),
    rerender: () => { mountPyqReview(p); pyqViewer.set(p.master || '', { keepStep: true }); },
    subject: p.subject, title: `GATE ${p.year || ''} PYQ: ${p.concept || p.subject}`,
  });
}
// "Edit question": fix a misread question by hand. The text is split into the statement and options (A)-(D);
// saving re-checks it for misreads, runs the exact calculators / runners on it (C programs really run), and the
// masterclass is written again from the corrected text.
function pyqEditSplit(text) {
  const t = fixScanMarks(String(text || '')), opts = optionLabels(t), o = {};
  for (const x of opts) if (!(x.L in o)) o[x.L] = x.text;
  return opts.length >= 2 ? { stem: t.slice(0, opts[0].at).trim(), o } : { stem: t.trim(), o: {} };
}
function pyqEditJoin() {
  const stem = $('#peStem').value.trim(), opts = 'ABCD'.split('').map(L => [L, $(`#peOpt${L}`).value.trim()]).filter(([, v]) => v);
  return opts.length ? `${stem}\n${opts.map(([L, v]) => `(${L}) ${v}`).join('\n')}` : stem;
}
function pyqEditOpen(p) {
  $('#pyqEdit') && $('#pyqEdit').remove();
  const s = pyqEditSplit(p.text), rr = p.reread && p.reread.text;
  const ans = p.officialKey ? '' : String((p.answer && p.answer.level !== 'unchecked' && p.answer.level !== 'conflict' ? (p.answer.key || p.answer.text) : '') || '').replace(/\s*\(.*\)$/, '');
  $('#pyqLesson').insertAdjacentHTML('beforebegin', `<div id="pyqEdit" class="card">
    <div class="card-title">Edit question</div>
    <p class="small muted">Correct the text as printed in the paper. Code can go in a \`\`\`c block. Leave the options empty for a numerical-answer question.</p>
    ${rr ? `<p class="small">The careful re-read of its page got a different text. <button class="link small" id="peUseReread">Load it into the form</button></p>` : ''}
    <label class="small">Question</label>
    <textarea id="peStem" rows="10" style="width:100%;font-family:var(--mono, monospace)">${escapeHtml(s.stem)}</textarea>
    ${'ABCD'.split('').map(L => `<div class="row" style="margin-top:4px"><b style="width:28px">(${L})</b><input id="peOpt${L}" style="flex:1" value="${escapeHtml(s.o[L] || '')}"></div>`).join('')}
    <div class="row" style="margin-top:8px"><label class="small" style="width:120px">Correct answer</label>${p.officialKey
      ? `<span class="small">${escapeHtml(p.officialKey)} <span class="muted">(official GATE key: it stays)</span></span>`
      : `<input id="peAns" style="width:140px" placeholder="e.g. D or 18" value="${escapeHtml(ans)}"><span class="small muted">optional: checked against the exact calculators where one applies</span>`}</div>
    <div id="peIssues" class="small" style="margin-top:8px"></div>
    <div class="row" style="margin-top:8px"><button class="primary" id="peSave">${icon('check')} Save and check</button><button class="link" id="peCancel">Cancel</button></div></div>`);
  const lint = () => { const g = pyqGarble(pyqEditJoin(), { year: p.year }); $('#peIssues').innerHTML = g.bad ? `<span style="color:var(--red)">Still looks misread:</span><ul>${g.issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : `<span style="color:var(--green)">${icon('check')} No misreads found.</span>${g.minor.length ? ` <span class="muted">(${escapeHtml(g.minor.join('; '))})</span>` : ''}`; return g; };
  $('#pyqEdit').querySelectorAll('textarea, input').forEach(el => el.oninput = lint);
  lint();
  if (rr) $('#peUseReread').onclick = () => { const r = pyqEditSplit(rr); $('#peStem').value = r.stem; 'ABCD'.split('').forEach(L => { $(`#peOpt${L}`).value = r.o[L] || ''; }); lint(); };
  $('#peCancel').onclick = () => $('#pyqEdit').remove();
  $('#pyqEdit').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#peSave').onclick = () => {
    const text = pyqEditJoin(), g = lint();
    if (plainText(text).trim().length < 20) { toast('The question is too short.'); return; }
    if (g.bad && !confirm(`It still looks misread:\n- ${g.issues.join('\n- ')}\n\nSave it anyway?`)) return;
    let given = p.officialKey ? '' : $('#peAns').value.trim();
    if (/^\(?[a-d]\)?$/i.test(given)) given = given.replace(/[()]/g, '').toUpperCase();
    $('#peSave').disabled = true;
    let res = null;
    runJob('Checking the edited PYQ', async signal => {
      jobLabel('Checking the answer with the exact calculators and runners', signal);
      res = await pyqCheckEdit(text, given, signal);
    }, async () => {
      if (!res) { $('#peSave').disabled = false; return; }
      let answer = null, msg = 'Saved.';
      if (p.officialKey) msg = res.exact ? `Saved. The official key (${p.officialKey}) stays; ${res.exact.by} gets ${res.exact.text}.` : `Saved. The official key (${p.officialKey}) stays.`;
      else if (res.exact && given && res.agree === false) {
        const useCalc = confirm(`${res.exact.by[0].toUpperCase() + res.exact.by.slice(1)} gets ${res.exact.text}, but you entered ${given}.\n\nOK = use the calculator's answer\nCancel = keep yours`);
        answer = useCalc ? res.exact : { text: given, level: 'good', by: 'the answer you entered (an exact calculator disagreed)', key: given, keyAgree: false, check: res.exact.check, votes: [] };
        msg = useCalc ? `Saved with the calculator's answer, ${res.exact.text}.` : `Saved with your answer, ${given}.`;
      } else if (res.exact) { answer = res.exact; msg = `Saved. ${res.exact.by[0].toUpperCase() + res.exact.by.slice(1)} gets ${res.exact.text}${given ? (res.agree ? ', same as your answer' : '') : ''}.`; }
      else if (given) { answer = { text: given, level: 'good', by: 'the answer you entered when you fixed the question', key: given, votes: [] }; msg = `Saved with your answer, ${given} (no exact calculator applies to this one).`; }
      else msg = 'Saved. Its answer is checked when you open it.';
      await pyqSaveEdit(p.id, text, answer);
      await refreshHub();
      toast(msg, 'ok', 8000);
      openPyq(p.id);
    });
  };
}
$('#pyqBack').onclick = () => { pyqCur = null; renderPyq(); };
$('#pyqRegen').onclick = () => pyqCur && confirm('Rewrite this masterclass from scratch?') && openPyq(pyqCur.id, true);
$('#pyqAsk').onclick = () => TutorChat.open('pyq');
TutorChat.provide(() => pyqCur ? [{ id: 'pyq', label: 'This PYQ masterclass', text: () => `PYQ (GATE ${pyqCur.year}):\n${pyqCur.text}\n\nCorrect answer: ${pyqCur.answer ? pyqCur.answer.text : '?'}\n\n${(pyqCur.master || '').slice(0, 12000)}` }] : []);
$('#pyqScan').onclick = async () => { await PyqScan.scanAll(); toast('Scanning your files for GATE-marked questions in the background.', 'ok'); await refreshHub(); renderPyq(); };
$('#goPyq').onclick = () => openTab('pyq');
// Uploads from the PYQs tab: everything in them is treated as a PYQ, classified, and the first new one is taught.
const pyqUpYear = () => ($('#pyqUpYear').value.match(/(19|20)\d{2}/) || [''])[0];
// ---------- upload progress panel ----------
let pyqPhoto = null;            // { total, i, stage, name, found, done, t0 }
const pyqScanning = {};         // siteId -> pages being scanned right now
const pyqBar = (pct, label, right) => `<div class="pyq-prog"><div class="row small"><span style="flex:1">${label}</span><span class="muted">${right}</span></div>
  <div class="bar"><div style="width:${Math.max(2, Math.min(100, pct))}%;background:var(--blue)"></div></div></div>`;
function renderPyqProgress() {
  const el = $('#pyqProgress'), rows = [];
  if (pyqPhoto) {
    const p = pyqPhoto, pct = p.done ? 100 : 100 * (p.i + (p.stage.startsWith('Finding') ? 0.6 : 0.1)) / p.total;
    rows.push(`<div class="pyq-up"><b>${icon('image')} ${p.total} photo${p.total > 1 ? 's' : ''}</b>
      ${pyqBar(pct, p.done ? `Done: ${p.found} question${p.found === 1 ? '' : 's'} found` : `${escapeHtml(p.stage)}${p.name && !p.stage.startsWith('Filing') ? ` · ${escapeHtml(p.name)}` : ''}`, p.done ? `${fmtDurShort((Date.now() - p.t0) / 1000)}` : `image ${Math.min(p.i + 1, p.total)} of ${p.total} · ${p.found} found`)}</div>`);
  }
  const hide = new Set(JSON.parse(Cfg.get('pyqHidden', '[]')));
  for (const [sid, src] of Object.entries(H.pyqSources || {})) {
    if (hide.has(sid)) continue;
    if (src.duplicate) {
      rows.push(`<div class="pyq-up"><div class="row"><b style="flex:1">${icon('folder')} ${escapeHtml(prettyName(src.name || 'PDF'))}</b><button class="link small" data-pyqhide="${sid}">Hide</button></div>
        <p class="small muted">Duplicate: already in your bank.</p></div>`);
      continue;
    }
    const q = (H.queue || []).find(x => x.siteId === sid);
    const scanned = Object.keys(H.pyqDone || {}).filter(k => k.startsWith(sid + ':')).length;
    const pending = (H.pyqScan || []).filter(x => x.siteId === sid).length;
    const found = (H.pyqs || []).filter(p => p.source && p.source.siteId === sid).length;
    const reading = q && ['queued', 'reading'].includes(q.status);
    const name = prettyName((q && q.name) || src.name || 'PDF');
    const totalPages = q && q.total ? q.total : scanned + pending;
    const done = !reading && !pending && !pyqScanning[sid];
    const cov = pyqCov[sid];
    const covLine = cov && cov.printed ? `<div class="row small" style="margin-top:8px"><span style="flex:1">Questions printed in the paper: <b>${cov.printed}</b> · in your bank: <b>${cov.found}</b>${cov.missing.length ? ` · <span style="color:var(--red)">missing ${cov.missing.slice(0, 12).map(n => 'Q.' + n).join(', ')}${cov.missing.length > 12 ? '…' : ''}</span>` : ' · <span style="color:var(--green)">all found ✓</span>'}</span>
      ${cov.missing.length && done ? `<button class="small" data-pyqfix="${sid}">Find the missing ones</button>` : ''}</div>` : '';
    rows.push(`<div class="pyq-up"><div class="row"><b style="flex:1">${icon('folder')} ${escapeHtml(name)}</b>${done && cov && !cov.missing.length ? `<button class="link small" data-pyqhide="${sid}">Hide</button>` : ''}</div>
      ${q && q.status === 'error' ? `<p class="small" style="color:var(--red)">Couldn't read it: ${escapeHtml(q.error || '')}</p>` : ''}
      ${pyqBar(q && q.total ? 100 * (q.k || 0) / q.total : reading ? 0 : 100, reading ? (q.status === 'queued' ? 'Waiting to start reading' : 'Reading pages') : q && q.status === 'paused' ? 'Reading paused' : 'Pages read', q && q.total ? `${q.k || 0} of ${q.total} pages` : reading ? 'opening…' : '')}
      ${covLine}
      ${pyqBar(totalPages ? 100 * scanned / Math.max(1, scanned + pending) : 0, pyqScanning[sid] ? `Finding questions on page${pyqScanning[sid].length > 1 ? 's' : ''} ${pyqScanning[sid].join('–')}` : pending ? 'Waiting to look for questions' : done ? 'Questions found' : 'Looking for questions as pages are read', `${scanned} page${scanned === 1 ? '' : 's'} checked · <b>${found}</b> question${found === 1 ? '' : 's'} found`)}</div>`);
  }
  el.innerHTML = rows.length ? `<div class="card-title">Uploads</div>${rows.join('')}` : '';
  show('#pyqProgress', rows.length > 0);
  el.querySelectorAll('[data-pyqhide]').forEach(b => b.onclick = () => { hide.add(b.dataset.pyqhide); Cfg.set('pyqHidden', JSON.stringify([...hide])); renderPyqProgress(); });
  el.querySelectorAll('[data-pyqfix]').forEach(b => b.onclick = async () => {
    const sid = b.dataset.pyqfix, c = pyqCov[sid];
    b.disabled = true; b.textContent = 'Queued…';
    await pyqRecheck(sid, c.pages);
    toast(`Re-checking ${c.pages.length} page${c.pages.length > 1 ? 's' : ''} for ${c.missing.length} missing question${c.missing.length > 1 ? 's' : ''}.`, 'ok');
    await refreshHub(); renderPyqProgress();
  });
  pyqCovRefresh();
}
// Coverage is computed in the background (it reads each paper's pages) and redrawn when it changes.
const pyqCov = {};
let pyqCovBusy = false, pyqCovAt = 0;
async function pyqCovRefresh(force) {
  if (pyqCovBusy || (!force && Date.now() - pyqCovAt < 5000)) return;
  pyqCovBusy = true; pyqCovAt = Date.now();
  try {
    let changed = false;
    for (const sid of Object.keys(H.pyqSources || {})) {
      if (H.pyqSources[sid].duplicate) continue;
      const c = await pyqCoverage(sid);
      if (JSON.stringify(c) !== JSON.stringify(pyqCov[sid])) { pyqCov[sid] = c; changed = true; }
    }
    if (changed) renderPyqProgress();
  } finally { pyqCovBusy = false; }
}
let pyqProgT = null;
onBus(m => {
  if (m.type === 'pyq-scan') { if (m.pages) pyqScanning[m.siteId] = m.pages; else delete pyqScanning[m.siteId]; }
  if (!['reader', 'pages', 'pyqs', 'pyq-scan'].includes(m.type) || tab !== 'pyq') return;
  clearTimeout(pyqProgT);
  pyqProgT = setTimeout(async () => { await refreshHub(); renderPyqProgress(); if (!pyqCur) renderPyq(); }, 400);
});
async function pyqUploadImages(files) {
  files = [...files]; if (!files.length) return;
  let fresh = [];
  pyqPhoto = { total: files.length, i: 0, stage: 'Starting', name: '', found: 0, done: false, t0: Date.now() };
  if (pyqCur) { pyqCur = null; renderPyq(); }
  renderPyqProgress();
  $('#pyqProgress').scrollIntoView({ behavior: 'smooth', block: 'center' });
  runJob('Reading your PYQ photos', async signal => { fresh = await pyqFromImages(files, pyqUpYear(), signal, s => { Object.assign(pyqPhoto, s); renderPyqProgress(); }); }, async () => {
    pyqPhoto.done = true; pyqPhoto.found = fresh.length; renderPyqProgress();
    setTimeout(() => { if (pyqPhoto && pyqPhoto.done) { pyqPhoto = null; renderPyqProgress(); } }, 20000);
    await refreshHub();
    if (!fresh.length) { toast('No questions found in those images. Try a clearer photo, or type it in Photo doubt.'); renderPyq(); return; }
    pyqSub = fresh[0].subject || 'Unsorted'; pyqYr = fresh[0].year || 'Year unknown'; Cfg.set('pyqSub', pyqSub);
    renderPyq();
    toast(`${fresh.length} question${fresh.length > 1 ? 's' : ''} filed under ${fresh.map(p => `${p.subject} · ${p.year || 'year unknown'}`).filter((v, i, a) => a.indexOf(v) === i).join(', ')}. Starting the first masterclass.`, 'ok', 7000);
    openPyq(fresh[0].id);
  });
}
$('#pyqImgIn').onchange = e => { pyqUploadImages(e.target.files); e.target.value = ''; };
$('#pyqCamIn').onchange = e => { pyqUploadImages(e.target.files); e.target.value = ''; };
$('#pyqPdfIn').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  try { await pyqFromPdfs(files, pyqUpYear()); } catch (err) { alert(err.message); return; }
  toast(`Reading ${files.length > 1 ? files.length + ' papers' : files[0].name} in the background. Progress is shown under "Uploads".`, 'ok', 7000);
  await refreshHub(); renderPyq(); renderPyqProgress();
  $('#pyqProgress').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
// ---------- full paper mode ----------
function renderPyqPapers() {
  const papers = pyqPapers(pyqAll()), sel = $('#pyqPaperSel'), keep = sel.value;
  sel.innerHTML = papers.length ? papers.map(p => `<option value="${escapeHtml(p.key)}" ${p.key === keep ? 'selected' : ''}>GATE ${escapeHtml(p.key)}: ${p.gradable} of ${p.total} gradable</option>`).join('') : '<option value="">No PYQs with a year yet</option>';
  const p = papers.find(x => x.key === sel.value);
  $('#pyqPaperGo').disabled = !p || !p.gradable;
  const pat = +p?.year <= 2009 ? 'Q1–20: 1 mark, rest: 2' : +p?.year <= 2013 ? 'Q1–25, Q56–60: 1 mark, rest: 2' : 'Q1–5, Q11–35: 1 mark, rest: 2';
  const chk = p && p.check ? ` <span title="Their text looks misread. Open one and use Edit question to fix it.">${p.check} need${p.check === 1 ? 's' : ''} checking, left out</span>` : '';
  $('#pyqPaperInfo').innerHTML = !p ? '' : !p.gradable ? `No checked answers yet: upload the official key or use Night shift.${chk ? ' ·' + chk : ''}`
    : `${p.gradable} question${p.gradable > 1 ? 's' : ''}${p.total - p.check > p.gradable ? ` <span title="Questions without a checked answer are left out until the official key or Night shift adds one">(${p.total - p.check - p.gradable} unchecked, left out)</span>` : ''}${chk ? ' ·' + chk : ''} · ${pat}`;
  sel.onchange = renderPyqPapers;
}
$('#pyqPaperGo').onclick = () => {
  const p = pyqPapers(pyqAll()).find(x => x.key === $('#pyqPaperSel').value);
  if (!p) return;
  const test = buildPaperTest(p, pyqAll());
  if (!test.questions.length) { toast('No gradable questions in that paper yet.'); return; }
  if (!confirm(`Start ${test.name}? ${test.questions.length} questions, ${test.minutes} minutes. The timer starts now.`)) return;
  show('#pyqHome', false);
  runTestIn($('#pyqRun'), test, `GATE ${p.year} paper`);
};

// ---------- official answer keys: read → you check the list → save → applied to that year's PYQs ----------
function renderPyqKeys() {
  const all = H.officialKeys || {}, rows = Object.entries(all).sort((a, b) => b[1].year.localeCompare(a[1].year));
  $('#pyqKeyList').innerHTML = rows.map(([id, k]) => {
    const mine = pyqAll().filter(p => p.officialKey && officialKeyFor(p, all) && officialKeyFor(p, all).id === id);
    const wrong = mine.filter(p => p.answer && p.answer.tutorAgree === false).length, ok = mine.filter(p => p.answer && p.answer.tutorAgree).length;
    return `<div class="pyq-up row"><div style="flex:1;min-width:220px"><b>GATE ${escapeHtml(k.year)}${k.set ? ' · ' + escapeHtml(k.set) : ''}</b>
      <span class="small muted"> · ${Object.keys(k.keys).length} answer${Object.keys(k.keys).length === 1 ? "" : "s"} · matched to ${mine.length} PYQ${mine.length === 1 ? '' : 's'} in your bank${ok + wrong ? ` · the tutor had <b>${ok}</b> right${wrong ? `, <b style="color:var(--red)">${wrong} wrong</b>` : ''}` : ''}</span></div>
      <button class="link small" data-kedit="${escapeHtml(id)}">Edit</button><button class="link small" data-kdel="${escapeHtml(id)}">Remove</button></div>`;
  }).join('');
  $('#pyqKeyList').querySelectorAll('[data-kedit]').forEach(b => b.onclick = () => { const k = all[b.dataset.kedit]; pyqKeyReview({ keys: k.keys, year: k.year, set: k.set, name: k.name, replace: b.dataset.kedit }); });
  $('#pyqKeyList').querySelectorAll('[data-kdel]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this answer key? Its PYQs go back to the tutor\'s own checked answers.')) return;
    await updateHub(h => { delete (h.officialKeys || {})[b.dataset.kdel]; });
    await applyOfficialKeys(); await refreshHub(); renderPyq();
  });
}
// The list read from the key, editable, one "number answer" per line. Nothing is used until you save it.
function pyqKeyReview({ keys = {}, year = '', set = '', name = '', replace = '', note = '' }) {
  const el = $('#pyqKeyEdit'), n = Object.keys(keys).length;
  show('#pyqKeyEdit');
  el.innerHTML = `<div class="pyq-up">
    <p class="small">${note || (n ? `I read <b>${n}</b> answers${name ? ` from ${escapeHtml(name)}` : ''}. <b>Check them against the key before saving</b>: scanners misread letters, and these become the final answers.` : 'One question per line: the number, then the answer. For example <code>42 D</code>, <code>27 3.5 to 3.6</code> (a range), <code>30 A;C</code> (MSQ) or <code>9 MTA</code> (marks to all).')}</p>
    <div class="row"><label class="small muted">GATE year <input type="text" id="kYear" value="${escapeHtml(year)}" placeholder="e.g. 2019" style="width:90px"></label>
      <label class="small muted">Paper / set (only if the year had two) <input type="text" id="kSet" value="${escapeHtml(set)}" placeholder="e.g. CS1" style="width:90px"></label></div>
    <textarea id="kText" rows="10" style="width:100%;margin-top:8px;font-family:var(--mono, monospace)">${escapeHtml(keyLines(keys))}</textarea>
    <p id="kInfo" class="small muted"></p>
    <div class="row"><button class="primary" id="kSave">${icon('check')} Save and apply</button><button class="link" id="kCancel">Cancel</button></div></div>`;
  const count = () => { const k = parseKeyText($('#kText').value); $('#kInfo').textContent = `${Object.keys(k).length} answers understood.`; return k; };
  $('#kText').oninput = count; count();
  $('#kCancel').onclick = () => { show('#pyqKeyEdit', false); el.innerHTML = ''; };
  $('#kSave').onclick = async () => {
    const yr = ($('#kYear').value.match(/(19|20)\d{2}/) || [''])[0], st = $('#kSet').value.trim(), k = count();
    if (!yr) { toast('Which GATE year is this key for?'); $('#kYear').focus(); return; }
    if (!Object.keys(k).length) { toast('No answers to save. Write one per line, like "42 D".'); return; }
    const id = yr + (st ? '-' + keySetNorm(st) : '');
    await updateHub(h => { h.officialKeys = h.officialKeys || {}; if (replace && replace !== id) delete h.officialKeys[replace]; h.officialKeys[id] = { year: yr, set: st, keys: k, name, added: new Date().toISOString() }; });
    const r = await applyOfficialKeys();
    await refreshHub();
    show('#pyqKeyEdit', false); el.innerHTML = '';
    toast(r.matched ? `Key saved. ${r.matched} PYQ${r.matched > 1 ? 's' : ''} now use the official answer${r.disagreed ? `; the tutor had ${r.disagreed} of them wrong (marked on each one)` : ''}.` : `Key saved for GATE ${yr}. It will be used as soon as PYQs from that paper are in your bank.`, 'ok', 8000);
    renderPyq();
  };
}
$('#pyqKeyPaste').onclick = () => pyqKeyReview({ year: pyqUpYear() });
$('#pyqKeyIn').onchange = e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  let r = null;
  pyqKeyReview({ note: 'Reading the key&hellip;', year: pyqUpYear() });
  runJob('Reading the answer key', async signal => { r = await keyFromFiles(files, signal, t => { jobLabel(t, signal); const i = $('#kInfo'); if (i) i.textContent = t; }); }, () => {
    if (!r) return;
    pyqKeyReview({ keys: r.keys, year: pyqUpYear() || r.year, name: files.map(f => f.name).join(', '),
      note: Object.keys(r.keys).length ? '' : 'I couldn\'t find a "number → answer" table in that file. Type the answers in below (one per line, like "42 D").' });
  });
};
onBus(async m => { if ((m.type === 'reader' || m.type === 'pages') && tab === 'pyq' && !pyqCur) { await refreshHub(); renderPyq(); } });
onBus(async m => { if (m.type === 'pyqs' && tab === 'pyq') { await refreshHub(); if (!pyqCur) renderPyq(); } });
// Photo doubt: a question carrying a GATE year marking goes to PYQs by itself; otherwise "Add to PYQs".
async function pyqFromPhoto(text, year) {
  if (!text) return;
  await addPYQs([{ text, year: year || pyqYearOf(text), source: { kind: 'photo' } }]);
}
$('#solvePyq').onclick = async () => { const q = $('#qText').value.trim(); if (!q) { toast('Read a question first.'); return; } await pyqFromPhoto(q, $('#solvePyqYear').value.trim().match(/(19|20)\d{2}/) ? $('#solvePyqYear').value.trim().match(/(19|20)\d{2}/)[0] : ''); await refreshHub(); };
function renderPractice() {
  show('#practiceHome', !$('#practiceRun').innerHTML);
  const mixPlan = DailyMix.plan(), mk = k => mixPlan.filter(x => x.kind === k).length;
  $('#mixInfo').textContent = mixPlan.length ? [mk('mistake') && `${mk('mistake')} mistakes`, mk('card') && `${mk('card')} cards`, mk('pyq') && `${mk('pyq')} PYQ${mk('pyq') > 1 ? 's' : ''}`].filter(Boolean).join(' · ') : 'Nothing due';
  const res = H.attempts.flatMap(a => a.results || []), acc = res.length ? Math.round(100 * res.filter(r => r.status === 'correct').length / res.length) : null;
  $('#practiceLine').innerHTML = H.attempts.length
    ? `${H.attempts.length} test${H.attempts.length > 1 ? 's' : ''} · <b>${acc}%</b> correct${H.mistakes.length ? ` · ${H.mistakes.length} open mistake${H.mistakes.length > 1 ? 's' : ''}` : ''}`
    : '';
  $('#mistakeCount').textContent = H.mistakes.length || '';
  const due = H.cards.filter(c => c.due <= Date.now()).length;
  $('#cardsDue').textContent = `${due} due / ${H.cards.length}`;
}
// flashcard review
let reviewQueue = [];
$('#cardsGo').onclick = () => {
  reviewQueue = H.cards.filter(c => c.due <= Date.now()).sort((a, b) => a.due - b.due).map(c => c.id);
  if (!reviewQueue.length) { $('#cardBox').innerHTML = `<p class="empty">${H.cards.length ? 'All caught up.' : 'No cards yet.'}</p>`; return; }
  showCard();
};
function showCard() {
  const c = H.cards.find(x => x.id === reviewQueue[0]);
  if (!c) { $('#cardBox').innerHTML = '<p class="empty">Done for today. Well played!</p>'; renderPractice(); return; }
  $('#cardBox').innerHTML = `<div class="flash"><div class="small muted">${escapeHtml(c.subject || '')} · ${reviewQueue.length} left</div>
    <div class="md flash-front">${renderMd(c.front)}</div><div class="md flash-back hidden">${renderMd(c.back)}${cardNote(c)}</div>
    <div class="row" style="margin-top:14px"><button class="primary fc-show">Show answer</button></div>
    <div class="row fc-grades hidden" style="margin-top:14px"><button data-g="0">Forgot</button><button data-g="1">Shaky</button><button data-g="2" class="primary">Got it</button><button data-g="3">Easy</button></div></div>`;
  $('.fc-show').onclick = () => { show('.flash-back'); show('.fc-grades'); $('.fc-show').classList.add('hidden'); };
  $('#cardBox').querySelectorAll('[data-g]').forEach(b => b.onclick = async () => {
    const g = +b.dataset.g;
    await updateHub(h => { const x = h.cards.find(y => y.id === c.id); if (x) scheduleCard(x, g); });
    await refreshHub();
    reviewQueue.shift();
    if (g === 0) reviewQueue.push(c.id);
    showCard();
  });
}

// ---------- FILES (study sites) ----------
async function createSiteFrom(files) {
  files = [...files];
  if (!files.length) return;
  $('#upMsg').textContent = 'Uploading...';
  try {
    const norm = [];
    for (const f of files) norm.push(await normalizeUpload(f));
    const name = norm.length > 1 ? `${files[0].name || 'photo'} + ${norm.length - 1} more` : (files[0].name || 'photo.jpg');
    const meta = await Store.createSite(norm[0], name);
    for (const f of norm.slice(1)) await Store.addFile(meta.id, f);
    await Reader.enqueue({ siteId: meta.id, name });   // start reading straight away, in the background
    location.href = 'site.html?id=' + meta.id;
  } catch (e) { $('#upMsg').textContent = e.message; }
}
$('#fileIn').onchange = e => createSiteFrom(e.target.files);
$('#fileCam').onchange = e => createSiteFrom(e.target.files);
$('#importIn').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  $('#upMsg').textContent = 'Importing...';
  try { const meta = await importSite(f); location.href = 'site.html?id=' + meta.id; } catch (err) { $('#upMsg').textContent = err.message; }
};
const drop = $('#drop');
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); createSiteFrom(e.dataTransfer.files); };
// Uploaded books stay until you delete them yourself (the old "delete after N days" option removed books silently).
async function renderFiles() {
  const sites = await Store.listSites();
  const el = $('#siteList');
  if (!sites.length) { el.innerHTML = '<p class="empty">Nothing uploaded yet. Drop your first PDF above.</p>'; return; }
  const queued = new Set((H.queue || []).filter(q => !['done', 'cancelled'].includes(q.status)).map(q => q.siteId));
  el.innerHTML = sites.map(s => `
    <div class="list-item"><div class="grow"><b>${escapeHtml(s.name)}</b><br>
      <span class="small muted">${new Date(s.created).toLocaleDateString()} &middot; ${fmtSize(s.size)}</span></div>
      <a class="btn primary" href="site.html?id=${s.id}">${icon('book')} Open</a>
      ${queued.has(s.id) ? '' : `<button data-readall="${s.id}" data-name="${escapeHtml(s.name)}" title="Read every page in the background">${icon('pencil')} Read all pages</button>`}
      <button data-exp="${s.id}" title="Save as one file">${icon('download')}</button><button class="danger" data-del="${s.id}" title="Delete this space">${icon('trash')}</button></div>`).join('');
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this study space and everything in it (files, the text I read, lessons, tests)?')) return;
    const q = (H.queue || []).find(x => x.siteId === b.dataset.del && !['done', 'cancelled'].includes(x.status));
    if (q) await Reader.command(q.id, 'cancel');
    await Store.deleteSite(b.dataset.del); await refreshHub(); renderFiles();
  });
  el.querySelectorAll('[data-exp]').forEach(b => b.onclick = async () => { b.disabled = true; try { await exportSite(b.dataset.exp); } catch (e) { alert(e.message); } b.disabled = false; });
  el.querySelectorAll('[data-readall]').forEach(b => b.onclick = async () => {
    await Reader.enqueue({ siteId: b.dataset.readall, name: b.dataset.name });
    toast('Added to the reading queue.', 'ok');
    await refreshHub(); renderFiles();
  });
  renderQueue();
}
// Reading queue panel: saved items + live progress from whichever window is reading.
const liveQ = {};
function renderQueue() {
  const items = (H.queue || []).filter(q => q.status !== 'cancelled').slice(-12);
  $('#queueCard').classList.toggle('hidden', !items.length);
  $('#queueList').innerHTML = items.map(q => {
    const L = Object.assign({}, q, liveQ[q.id] || {});
    const pct = L.total ? 100 * L.k / L.total : (L.status === 'done' ? 100 : 0);
    const what = L.status === 'reading' ? (L.total ? `Reading page ${L.page || '…'}: ${L.k} of ${L.total}${L.eta > 5 ? ` · about ${fmtDurShort(L.eta)} left` : ''}` : 'Opening…')
      : L.status === 'done' ? `Ready${L.total ? ` · ${L.total} pages read` : ''}` : L.status === 'paused' ? 'Paused' : L.status === 'error' ? `Stopped: ${L.error || 'error'}` : 'Waiting its turn';
    const btns = L.status === 'done' ? `<a class="btn" href="site.html?id=${q.siteId}#learn">Start learning</a><button class="link" data-qx="${q.id}" data-c="clear">Clear</button>`
      : `${L.status === 'paused' || L.status === 'error' ? `<button class="primary" data-qx="${q.id}" data-c="resume">Resume</button>` : `<button data-qx="${q.id}" data-c="pause">Pause</button>`}<button class="link" data-qx="${q.id}" data-c="cancel">Cancel</button>`;
    return `<div class="q-item"><div><b>${escapeHtml(prettyName(q.name))}</b><br><span class="small muted">${escapeHtml(what)}</span></div><div class="row">${btns}</div>
      ${L.status === 'done' ? '' : `<div class="progress"><div style="width:${pct}%"></div></div>`}</div>`;
  }).join('');
  $('#queueList').querySelectorAll('[data-qx]').forEach(b => b.onclick = async () => {
    if (b.dataset.c === 'clear') await updateHub(h => { h.queue = (h.queue || []).filter(x => x.id !== b.dataset.qx); });
    else await Reader.command(b.dataset.qx, b.dataset.c);
    await refreshHub(); renderFiles();
  });
}
function fmtDurShort(s) { s = Math.round(s); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round(s % 3600 / 60)}m` : s >= 60 ? `${Math.round(s / 60)} min` : `${s}s`; }
let qRefresh = null;
onBus(m => {
  if (m.type !== 'reader') return;
  liveQ[m.id] = Object.assign(liveQ[m.id] || {}, m);
  if (tab !== 'files') return;
  if (m.status === 'reading') renderQueue();
  else { clearTimeout(qRefresh); qRefresh = setTimeout(async () => { await refreshHub(); renderFiles(); }, 500); }
});
$('#searchGo').onclick = async () => {
  const q = $('#searchIn').value.trim().toLowerCase();
  const out = $('#searchOut');
  if (q.length < 2) { out.textContent = 'Type at least 2 characters.'; return; }
  out.textContent = 'Searching...';
  const hits = [];
  const snip = (text) => { const t = plainText(text), i = t.toLowerCase().indexOf(q); return i < 0 ? null : (i > 60 ? '...' : '') + t.slice(Math.max(0, i - 60), i + 120) + '...'; };
  for (const [k, t] of Object.entries(H.topics)) { const s = snip(t.md); if (s) hits.push({ where: 'Topic: ' + t.title, s, go: () => { openTab('ask'); openTopic(t, k); } }); }
  for (const x of H.solved) { const s = snip(x.question + '\n' + x.md); if (s) hits.push({ where: 'Solved question', s, go: () => { openTab('solve'); solved = { question: x.question, md: x.md }; show('#solveOut'); $('#solveOut').innerHTML = renderMd(x.md); } }); }
  for (const site of await Store.listSites()) {
    const d = await Store.getData(site.id);
    (d.pages || []).forEach(p => { if (!p) return; const s = snip(p.md || ''); if (s) hits.push({ where: `${site.name} · page ${p.n}`, s, href: `site.html?id=${site.id}&page=${p.n}#digitize` }); });
    (d.lessons || []).forEach((l, i) => { const s = snip(l.md || ''); if (s) hits.push({ where: `${site.name} · lesson ${i + 1}`, s, href: `site.html?id=${site.id}&lesson=${i}#learn` }); });
  }
  if (!hits.length) { out.innerHTML = '<p class="empty">Couldn\'t find that anywhere.</p>'; return; }
  out.innerHTML = hits.slice(0, 50).map((h, i) => `<div class="list-item"><div class="grow"><b>${escapeHtml(h.where)}</b><br><span class="muted">${escapeHtml(h.s)}</span></div>${h.href ? `<a class="btn" href="${h.href}">Open</a>` : `<button data-hit="${i}">Open</button>`}</div>`).join('');
  out.querySelectorAll('[data-hit]').forEach(b => b.onclick = () => hits[+b.dataset.hit].go());
};
$('#searchIn').onkeydown = e => { if (e.key === 'Enter') $('#searchGo').click(); };

// ---------- SETTINGS ----------
let models = [];
function renderMyFacts() {
  const mine = H.myFacts || [], rej = H.factRejects || [];
  $('#myFactsCount').textContent = mine.length ? `(${mine.length})` : '(none yet)';
  $('#myFactsList').innerHTML = mine.map((f, i) => `<div class="st-row"><span><b class="muted">M${i + 1}</b> ${escapeHtml(f.f)}</span><span class="small muted">${escapeHtml(f.s || '')}</span><button class="link small" data-mfdel="${f.id}">Remove</button></div>`).join('');
  if (!$('#myFactSubj').options.length) $('#myFactSubj').innerHTML = SUBJECTS.map(s => `<option>${escapeHtml(s)}</option>`).join('');
  $('#myFactsList').querySelectorAll('[data-mfdel]').forEach(b => b.onclick = async () => {
    await updateHub(h => { h.myFacts = (h.myFacts || []).filter(f => f.id !== b.dataset.mfdel); });
    await loadMyFacts(); announce({ type: 'facts' }); await refreshHub(); renderMyFacts();
  });
  $('#myRejects').innerHTML = rej.length ? `${rej.length} statement${rej.length > 1 ? 's' : ''} you confirmed as right: the fact-checker won't change ${rej.length > 1 ? 'them' : 'it'} again. <button class="link small" id="myRejClear">Forget these</button>` : '';
  if ($('#myRejClear')) $('#myRejClear').onclick = async () => { if (!confirm('Let the fact-checker re-check statements you confirmed before?')) return; await updateHub(h => { delete h.factRejects; }); await refreshHub(); renderMyFacts(); };
}
$('#myFactAdd').onclick = async () => {
  try { await saveMyFact({ f: $('#myFactNew').value, s: $('#myFactSubj').value, from: 'Settings' }); } catch (e) { toast(e.message); return; }
  $('#myFactNew').value = ''; await refreshHub(); renderMyFacts(); toast('Added to your reference.', 'ok');
};
function renderSettings() {
  const opts = cur => (models.length ? models : [cur]).map(m => `<option ${m === cur ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
  $('#setModel').innerHTML = opts(teachModel());
  $('#setVModel').innerHTML = opts(visionModel());
  $('#setCModel').innerHTML = opts(checkModel());
  { const cur = Cfg.get('bigmodel', 'auto'), auto = (() => { const p = Cfg.get('bigmodel', 'auto'); Cfg.set('bigmodel', 'auto'); const b = bigModel(); Cfg.set('bigmodel', p); return b; })();
    const thinks = m => THINKS[m] ? ', thinking first' : '';   // second opinions think when the model can
    $('#setBigModel').innerHTML = [`<option value="auto" ${cur === 'auto' ? 'selected' : ''}>Automatic${auto ? ` (${escapeHtml(auto)}${thinks(auto)})` : ' (no bigger model installed)'}</option>`, `<option value="none" ${cur === 'none' ? 'selected' : ''}>Off</option>`].concat(models.map(m => `<option value="${escapeHtml(m)}" ${m === cur ? 'selected' : ''}>${escapeHtml(m)}${thinks(m) ? ' (thinking first)' : ''}</option>`)).join(''); }
  $('#setGate').value = Cfg.get('gateDate', '');
  $('#setLang').value = Cfg.get('lang', 'en');
  $('#setOllama').value = ollamaUrl();
  $('#setWeb').value = Cfg.get('web', 'on');
  $('#setWebKey').value = Cfg.get('webkey', '');
  $('#webState').textContent = Cfg.get('web', 'on') !== 'on' ? '' : navigator.onLine ? 'Online.' : 'Offline.';
  renderInstall();
  if (!$('#stOut').dataset.live) $('#stOut').innerHTML = selfTestHtml((H.selfTests || []).slice(-1)[0]);
  $('#setFactcheck').checked = Cfg.get('factcheck', 'on') === 'on';
  $('#setFactcheck').onchange = () => Cfg.set('factcheck', $('#setFactcheck').checked ? 'on' : 'off');
  const fcs = H.factChecks || [], items = fcs.flatMap(f => f.items || []);
  const fixed = items.filter(x => x.status === 'fixed').length, unsure = items.filter(x => x.status === 'unsure').length, kept = items.filter(x => x.status === 'kept').length;
  const both = items.filter(x => x.agree != null), agree = both.filter(x => x.agree).length;
  $('#fcStats').innerHTML = fcs.length ? `<div class="week fc-week"><div class="wk"><b>${fcs.length}</b><span>lessons checked</span></div><div class="wk"><b>${fixed}</b><span>errors corrected</span></div><div class="wk"><b>${kept}</b><span>suspicions cleared</span></div><div class="wk"><b>${unsure}</b><span>flagged to double-check</span></div></div>
    ${both.length ? `<p class="small muted" style="margin-top:10px">Local model and internet agreed on ${agree} of ${both.length} disputed points; the other ${both.length - agree} were settled by deeper thinking.</p>` : ''}
    <details style="margin-top:8px"><summary class="small">Recent checks</summary>${fcs.slice(-12).reverse().map(f => `<div class="st-row"><span>${escapeHtml(f.title || 'Lesson')}</span><span class="small muted">${escapeHtml(f.kind || '')}</span><span class="small">${(f.items || []).filter(x => x.status === 'fixed').length} fixed · ${(f.items || []).filter(x => x.status === 'unsure').length} flagged</span></div>`).join('')}</details>`
    : '<p class="small muted">No lessons checked yet.</p>';
  if (!$('#fcTestOut').dataset.live) $('#fcTestOut').innerHTML = fcTestHtml((H.fcTests || []).slice(-1)[0]);
  renderMyFacts(); renderModelCompare(); renderAutoBackup(); renderNight(); renderHealth(); renderReliability(); renderHookSettings();
  { const n = officialGolden().length, o = $('#stSize').querySelector('[value="pyq"]') || $('#stSize').appendChild(document.createElement('option')); o.value = 'pyq'; o.textContent = `Real GATE PYQs with official keys (${n})`; o.disabled = !n; }
  const reps = (H.reports || []).filter(r => r.q);
  $('#reportList').innerHTML = reps.length ? reps.slice().reverse().map((r, i) => `<div class="list-item"><div class="grow"><b>${escapeHtml(plainText(r.q.question).replace(/\s+/g, ' ').slice(0, 110))}…</b><br>
      <span class="small muted">${escapeHtml(r.q.subject || '')} &middot; "${escapeHtml(r.reason)}" &middot; ${new Date(r.at).toLocaleDateString()}</span></div>
      <button class="link" data-unreport="${reps.length - 1 - i}">Undo</button></div>`).join('')
    : '<p class="empty">None.</p>';
  $('#reportList').querySelectorAll('[data-unreport]').forEach(b => b.onclick = async () => {
    const r = reps[+b.dataset.unreport];
    await updateHub(h => { h.reports = (h.reports || []).filter(x => !(x.at === r.at && x.reason === r.reason)); });
    await refreshHub(); renderSettings();
  });
}
$('#setModel').onchange = () => Cfg.set('model', $('#setModel').value);
$('#setVModel').onchange = () => Cfg.set('vmodel', $('#setVModel').value);
$('#setCModel').onchange = () => Cfg.set('cmodel', $('#setCModel').value);
$('#setBigModel').onchange = () => Cfg.set('bigmodel', $('#setBigModel').value);
$('#setGate').onchange = () => { Cfg.set('gateDate', $('#setGate').value); toast($('#setGate').value ? 'Exam date saved. The countdown is on your home screen.' : 'Exam date cleared.', 'ok'); };
$('#setLang').onchange = () => Cfg.set('lang', $('#setLang').value);
$('#setWeb').onchange = () => { Cfg.set('web', $('#setWeb').value); renderSettings(); toast($('#setWeb').value === 'on' ? 'Internet add-on is on.' : 'Staying fully offline.', 'ok'); };
$('#setWebKey').onchange = () => { Cfg.set('webkey', $('#setWebKey').value.trim()); toast($('#setWebKey').value.trim() ? 'Key saved. Whole-web search is on.' : 'Key removed. Using Wikipedia only.', 'ok'); };
$('#setOllama').onchange = async () => { Cfg.set('ollama', $('#setOllama').value.trim()); models = await checkOllama($('#status')); renderSettings(); };
$('#fcTestGo').onclick = () => {
  $('#fcTestOut').dataset.live = '1';
  $('#fcTestOut').innerHTML = '<p class="small muted">Running… you can keep studying.</p>';
  runJob('Testing the fact-checker', signal => runFactCheckTest(signal, s => { $('#fcTestOut').innerHTML = `<p class="small muted">${escapeHtml(s)}…</p>`; }), async () => { delete $('#fcTestOut').dataset.live; await refreshHub(); renderSettings(); });
};
$('#stGo').onclick = () => {
  const out = $('#stOut');
  out.dataset.live = '1';
  out.innerHTML = '<p class="small muted">Starting&hellip; you can keep studying; this runs in the task tray.</p>';
  const rows = [];
  const sz = $('#stSize').value;
  if (sz === 'pyq' && !officialGolden().length) { delete out.dataset.live; out.innerHTML = '<p class="small muted">No PYQs with an official key yet. Upload a key in the PYQs tab first.</p>'; return; }
  runJob('Self-test', signal => runSelfTest(sz === 'pyq' ? 'pyq' : +sz, signal, (r, k, n) => {
    rows.push(r);
    out.innerHTML = `<p class="small muted">${k + 1} of ${n} done · alone ${rows.filter(x => x.aloneRight).length} right · with checks ${rows.filter(x => x.right).length} right</p>`;
  }), async () => { delete out.dataset.live; await refreshHub(); renderSettings(); });
};
async function renderHookSettings() {
  // Lesson visuals: the exact topic animation is the main one; the AI analogy picture is optional (off by default).
  if (!$('#setShowAnalogy')) $('#hookCard').insertAdjacentHTML('beforeend', `<div class="row small" style="gap:6px 18px;margin-top:6px">
    <label><input type="checkbox" id="setAutoAnim"> Animate new lessons (an exact step-by-step animation of the lesson's own example)</label>
    <label><input type="checkbox" id="setShowAnalogy"> Show analogy pictures</label></div>`);
  $('#setAutoAnim').checked = Cfg.get('autoanim', 'on') === 'on';
  $('#setAutoAnim').onchange = () => Cfg.set('autoanim', $('#setAutoAnim').checked ? 'on' : 'off');
  $('#setShowAnalogy').checked = Cfg.get('showanalogy', 'off') === 'on';
  $('#setShowAnalogy').onchange = () => Cfg.set('showanalogy', $('#setShowAnalogy').checked ? 'on' : 'off');
  $('#setAutoHook').checked = Cfg.get('autohook', 'off') === 'on';
  $('#setAutoHook').onchange = () => Cfg.set('autohook', $('#setAutoHook').checked ? 'on' : 'off');
  $('#setHookStyle').innerHTML = Object.entries(MemoryHook.STYLES).map(([k, s]) => `<option value="${k}" ${Cfg.get('hookstyle', 'flat') === k ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
  $('#setHookStyle').onchange = () => Cfg.set('hookstyle', $('#setHookStyle').value);
  const st = await MemoryHook.status(true);
  $('#hookState').innerHTML = !st.installed ? '<span style="color:var(--red)">Not installed (no image model in tools\\sd)</span>'
    : `${icon('check')} Ready · <span class="muted">${escapeHtml(st.model)}</span>${st.running ? ` · loaded${st.backend ? ` (${escapeHtml(st.backend.toUpperCase())})` : ''} <button class="link small" id="hookStop">Unload</button>` : ''}`;
  if ($('#hookStop')) $('#hookStop').onclick = async () => { await fetch('/api/imagegen/stop', { method: 'POST' }); renderHookSettings(); };
}
// ---------- reliability per subject (self-tests, official keys, fact-checks, reports) ----------
function renderReliability() {
  const subj = {};
  const S = s => subj[s] = subj[s] || { n: 0, right: 0, alone: 0, aloneN: 0, keyN: 0, keyRight: 0, fixed: 0, reports: 0 };
  for (const run of H.selfTests || []) for (const r of run.rows || []) { const x = S(r.s); x.n++; if (r.right) x.right++; x.aloneN++; if (r.aloneRight) x.alone++; }
  for (const p of H.pyqs || []) if (p.answer && p.answer.level === 'official' && p.answer.tutorAgree != null) { const x = S(p.subject || 'Unsorted'); x.keyN++; if (p.answer.tutorAgree) x.keyRight++; }
  for (const f of H.factChecks || []) if (f.subject) S(f.subject).fixed += (f.items || []).filter(i => i.status === 'fixed').length;
  for (const r of H.reports || []) if (r.q && r.q.subject) S(r.q.subject).reports++;
  const rows = Object.entries(subj).map(([s, x]) => ({ s, ...x, acc: (x.right + x.keyRight) / Math.max(1, x.n + x.keyN), total: x.n + x.keyN })).filter(r => r.total || r.fixed || r.reports).sort((a, b) => (a.total ? a.acc : 2) - (b.total ? b.acc : 2));
  const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : '—';
  const cal = Calib.data || {};
  $('#relOut').innerHTML = !rows.length ? '<p class="small muted">No data yet: run a self-test or upload an official key.</p>'
    : `<table class="mc-table"><thead><tr><th>Subject</th><th>Checked answers right</th><th>Model alone</th><th>Lesson errors fixed</th><th>Your reports</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.total >= 3 && r.acc < 0.7 ? 'weak' : ''}"><td><b>${escapeHtml(r.s)}</b></td><td>${r.total ? `<b>${pct(r.right + r.keyRight, r.total)}</b> <span class="small muted">(${r.right + r.keyRight}/${r.total}${r.keyN ? `, ${r.keyN} vs official keys` : ''})</span>` : '—'}</td>
        <td>${pct(r.alone, r.aloneN)}</td><td>${r.fixed || '—'}</td><td>${r.reports || '—'}</td></tr>`).join('')}</tbody></table>
      ${Object.keys(cal).length ? `<p class="small muted" style="margin-top:8px">By confidence label: ${Object.entries(cal).filter(([k]) => CONF_TEXT[k]).map(([k, c]) => `${CONF_TEXT[k].split(':')[0]} ${c.right}/${c.n}`).join(' · ')}</p>` : ''}`;
}
function renderModelCompare() {
  const ticked = new Set(JSON.parse(Cfg.get('mcTicked', '[]')));
  const list = (models.length ? models : [teachModel()]).filter(m => !/embed/i.test(m));
  if (!$('#mcModels').dataset.busy) $('#mcModels').innerHTML = list.map(m => `<label class="small"><input type="checkbox" value="${escapeHtml(m)}" ${ticked.has(m) || (!ticked.size && m === teachModel()) ? 'checked' : ''}> ${escapeHtml(m)}</label>`).join('');
  $('#mcModels').querySelectorAll('input').forEach(i => i.onchange = () => Cfg.set('mcTicked', JSON.stringify([...$('#mcModels').querySelectorAll('input:checked')].map(x => x.value))));
  $('#mcOut').innerHTML = modelRunsHtml(H.modelRuns);
  $('#mcOut').querySelectorAll('[data-usemodel]').forEach(b => b.onclick = () => {
    Cfg.set('model', b.dataset.usemodel); Cfg.set('cmodel', b.dataset.usemodel);
    toast(`Now using ${b.dataset.usemodel} for teaching and checking.`, 'ok'); renderSettings();
  });
}
$('#mcGo').onclick = () => {
  const pick = [...$('#mcModels').querySelectorAll('input:checked')].map(x => x.value);
  if (!pick.length) { toast('Tick at least one model.'); return; }
  const fc = $('#mcFc').checked;
  $('#mcModels').dataset.busy = '1'; $('#mcGo').disabled = true;
  runJob(`Comparing ${pick.length} model${pick.length > 1 ? 's' : ''}`, signal => runModelComparison(pick, { factcheck: fc, signal, onStep: s => { $('#mcLive').textContent = s; jobLabel(s, signal); } }),
    async () => { delete $('#mcModels').dataset.busy; $('#mcGo').disabled = false; $('#mcLive').textContent = ''; await refreshHub(); renderSettings(); });
};
function renderInstall() {
  const installed = matchMedia('(display-mode: standalone)').matches;
  $('#installGo').classList.toggle('hidden', installed || !installPrompt);
  $('#appInfo').textContent = installed ? 'Installed.' : installPrompt ? '' : 'Install from the browser menu: Apps → Install.';
}
document.addEventListener('gt-installable', renderInstall);
$('#installGo').onclick = async () => { if (await installApp()) toast('Installed. Look for "GATE Prep Desk" in your Start menu.'); renderInstall(); };
$('#quitGo').onclick = async () => {
  if (!confirm('Shut down GATE Prep Desk? Your work is saved. Open it again from the desktop shortcut.')) return;
  try { await fetch('/api/quit', { method: 'POST' }); } catch {}
  document.body.innerHTML = '<main><div class="card" style="margin-top:60px;text-align:center"><h2 class="h">See you next study session!</h2><p class="muted">The app has shut down. You can close this window.</p></div></main>';
};
$('#backupGo').onclick = async () => { await refreshHub(); downloadText(JSON.stringify({ format: 'gate-tutor-progress', version: 1, hub: H }), 'gate-progress-backup.json'); };
$('#restoreIn').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.format !== 'gate-tutor-progress') throw new Error('Not a GATE Tutor progress backup.');
    if (!confirm('Replace your current progress with this backup?')) return;
    await Store.putHub(j.hub); await refreshHub(); alert('Progress restored.');
  } catch (err) { alert(err.message); }
};

// ---------- command palette (Ctrl+K): what this page can jump to ----------
Palette.provide(() => {
  const out = [
    { group: 'Do', label: 'Start the daily mix', sub: 'mistake reviews, flashcards and PYQs', ico: 'refresh', run: () => DailyMix.start() },
    { group: 'Do', label: 'Snap a doubt (photo of a question)', ico: 'camera', run: () => openTab('solve') },
    { group: 'Do', label: 'Prepare a GATE mock', ico: 'clock', run: () => { openTab('practice'); $('#mockGo').scrollIntoView({ block: 'center' }); } },
    { group: 'Do', label: 'Upload PYQ papers or photos', ico: 'upload', run: () => openTab('pyq') },
    { group: 'Do', label: 'Scan handwritten notes', ico: 'note', run: () => { openTab('notes'); $('#nScanIn').click(); } },
    { group: 'Do', label: 'Make a revision pack', ico: 'book', run: () => { openTab('topics'); $('#packSubj').focus(); } },
    { group: 'Do', label: 'Download a full backup (.zip)', ico: 'download', run: () => { openTab('settings'); $('#zipGo').click(); } },
    { group: 'Do', label: 'Run the self-test', ico: 'check', run: () => { openTab('settings'); $('#stGo').scrollIntoView({ block: 'center' }); } },
  ];
  SUBJECTS.forEach(s => out.push({ group: 'Chapters', label: s, sub: 'teach me where I left off', ico: 'book', run: () => { openTab('ask'); $('#askIn').value = `${s}: `; $('#askIn').focus(); } }));
  (H.covered || []).forEach(e => out.push({ group: 'My topics', label: e.topic, sub: `${e.subject}${e.mastered ? ' · closed' : ' · open'}`, ico: 'list', run: () => openCovered(e) }));
  (H.pyqs || []).forEach(p => out.push({ group: 'PYQs', label: `GATE ${p.year || ''} · ${p.concept || p.subject}`, sub: plainText(fixScanMarks(p.text)).replace(/\s+/g, ' ').slice(0, 90), ico: 'clock', run: () => { openTab('pyq'); openPyq(p.id); } }));
  (H.formulas || []).forEach(f => out.push({ group: 'Formulas', label: f.name || plainText(f.tex).slice(0, 60), sub: f.subject, ico: 'sigma', run: () => { openTab('formulas'); $('#fSearch').value = f.name || ''; $('#fSearch').dispatchEvent(new Event('input')); } }));
  for (const [s, list] of Object.entries(H.notes || {})) list.filter(t => t.text.trim() || t.subs.some(x => x.text.trim())).forEach(t => out.push({ group: 'My notes', label: t.name, sub: s, ico: 'note', run: () => { NotesUI.subject = s; openTab('notes'); } }));
  H.mistakes.forEach(m => out.push({ group: 'Mistakes', label: m.q.concept || plainText(m.q.question).slice(0, 60), sub: `${m.q.subject || ''} · ${reviewInfo(m).isDue ? 'review due' : 'next review ' + fmtDue(reviewInfo(m).due)}`, ico: 'refresh', run: () => { mistFilter = { subject: m.q.subject || '', type: '' }; openTab('mistakes'); } }));
  return out;
});

// ---------- printable revision pack (one subject) ----------
// Topics, formula sheet, your mistakes (with why), mini lessons, checked PYQs and your own notes, in one
// print-ready page. "Save as PDF" in the print dialog keeps it offline.
function revisionPackHtml(subject) {
  const covered = (H.covered || []).filter(e => e.subject === subject);
  const formulas = (H.formulas || []).filter(f => f.subject === subject);
  const mistakes = H.mistakes.filter(m => m.q.subject === subject);
  const fixed = (H.fixed || []).filter(f => f.subject === subject);
  const minis = Object.values(H.miniLessons || {}).filter(l => (H.mistakes.concat([])).some(m => m.q.subject === subject && (m.q.concept || '') === l.concept) || (l.concept && covered.some(c => noteMatches(l.concept, [c.topic]))));
  const pyqs = (H.pyqs || []).filter(p => p.subject === subject && p.answer && ['official', 'exact', 'high', 'good'].includes(p.answer.level));
  const notes = ((H.notes || {})[subject] || []).filter(t => t.text.trim() || t.subs.some(s => s.text.trim()));
  const sec = (title, body, cls = '') => body ? `<section class="rp-sec ${cls}"><h2>${title}</h2>${body}</section>` : '';
  const html = `
    <header class="rp-head"><div class="rp-kicker">GATE Prep Desk · Revision pack</div><h1>${escapeHtml(subject)}</h1>
      <p>${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} · ${covered.length} topics · ${formulas.length} formulas · ${mistakes.length} open mistakes · ${pyqs.length} checked PYQs</p></header>
    ${sec('Topics covered', covered.length ? `<ul class="rp-topics">${covered.map(e => `<li><b>${escapeHtml(e.topic)}</b> ${e.mastered ? '<span class="rp-ok">closed</span>' : '<span class="rp-open">open</span>'}${(e.subtopics || []).filter(s => !JUNK_SUB.test(s.name)).length ? `<div class="rp-subs">${(e.subtopics || []).filter(s => !JUNK_SUB.test(s.name)).map(s => escapeHtml(s.name)).join(' · ')}</div>` : ''}</li>`).join('')}</ul>` : '')}
    ${sec('Formula sheet', formulas.length ? `<div class="rp-formulas">${formulas.map(f => `<div class="rp-f"><div class="rp-fname">${escapeHtml(f.name || '')}</div><div class="md">${renderMd('$$' + f.tex + '$$')}</div>${f.note ? `<div class="rp-fnote">${escapeHtml(cleanNote(f.note, f.name))}</div>` : ''}</div>`).join('')}</div>` : '', 'rp-break')}
    ${sec('My mistakes: what went wrong', mistakes.length ? mistakes.map(m => `<div class="rp-m"><div class="md">${renderMd(fixInlineOptions(m.q).question)}</div>${m.q.options.length ? `<ol class="rp-opts" type="A">${m.q.options.map(o => `<li class="md">${renderMd(o)}</li>`).join('')}</ol>` : ''}
      <p><span class="rp-bad">I answered ${escapeHtml(fmtAns(m.answer))}</span> · <span class="rp-good">Correct: ${escapeHtml(keyOf(m.q))}</span> · ${ERR_META[mistType(m)].name}</p>
      <div class="md rp-why">${renderMd(m.why || m.q.explanation || '')}</div></div>`).join('') : '', 'rp-break')}
    ${sec('Mini lessons', minis.map(l => `<div class="md rp-mini">${renderMd(l.md)}</div>`).join(''), 'rp-break')}
    ${sec('Previous-year questions', pyqs.map(p => `<div class="rp-m"><div class="rp-tag">GATE ${escapeHtml(p.year || '')}${p.concept ? ' · ' + escapeHtml(p.concept) : ''}</div><div class="md">${renderMd(fixScanMarks(p.text))}</div><p class="rp-good">Answer: ${p.answer.text === 'MTA' ? 'Marks to all' : escapeHtml(p.answer.text)}${p.answer.level === 'official' ? ' (official key)' : ''}</p></div>`).join(''), 'rp-break')}
    ${sec('My notes', notes.map(t => `<div class="rp-note"><h3>${escapeHtml(t.name)}</h3>${t.text.trim() ? `<div class="md">${renderMd(t.text)}</div>` : ''}${t.subs.filter(s => s.text.trim()).map(s => `<h4>${escapeHtml(s.name)}</h4><div class="md">${renderMd(s.text)}</div>`).join('')}</div>`).join(''), 'rp-break')}
    ${fixed.length ? `<footer class="rp-foot">${fixed.length} mistake${fixed.length > 1 ? 's' : ''} in ${escapeHtml(subject)} already conquered.</footer>` : ''}`;
  return html;
}
function openRevisionPack(subject) {
  const body = revisionPackHtml(subject);
  if (!/<h2/.test(body)) { toast(`Nothing for ${subject || 'this subject'} yet.`); return; }   // no sections: don't open an empty page
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups for this app to open the revision pack.'); return; }
  const base = location.origin + '/';
  w.document.write(`<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><title>Revision pack · ${escapeHtml(subject)}</title>
    <link rel="stylesheet" href="${base}style.css"><link rel="stylesheet" href="${base}ui.css"><link rel="stylesheet" href="${base}story.css"><link rel="stylesheet" href="${base}vendor/katex/katex.min.css">
    <style>
      body { background: #fff; } .rp { max-width: 820px; margin: 0 auto; padding: 36px 40px 60px; }
      .rp-bar { position: sticky; top: 0; background: #fff; padding: 12px 0; display: flex; gap: 10px; justify-content: flex-end; border-bottom: 1px solid var(--rule); }
      .rp-head { border-bottom: 3px solid var(--blue); padding-bottom: 16px; margin-bottom: 10px; }
      .rp-kicker { font: 700 11px var(--sans); letter-spacing: .12em; text-transform: uppercase; color: var(--blue); }
      .rp-head h1 { font: 600 34px var(--serif); margin: 6px 0; } .rp-head p { color: var(--muted); margin: 0; }
      .rp-sec h2 { font: 600 22px var(--serif); margin: 30px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--rule); }
      .rp-topics { padding-left: 20px; } .rp-topics li { margin: 6px 0; } .rp-subs { font-size: 13px; color: var(--muted); }
      .rp-ok, .rp-open { font: 700 10px var(--sans); text-transform: uppercase; letter-spacing: .06em; padding: 2px 7px; border-radius: 99px; margin-left: 6px; }
      .rp-ok { background: var(--green-soft); color: var(--green); } .rp-open { background: var(--amber-soft); color: var(--amber); }
      .rp-formulas { display: grid; grid-template-columns: 1fr; gap: 8px; }
      .rp-f { border: 1px solid var(--rule); border-radius: 10px; padding: 10px 14px; break-inside: avoid; } .rp-fname { font-weight: 700; font-size: 14px; } .rp-fnote { font-size: 12.5px; color: var(--muted); }
      .rp-f { display: grid; grid-template-columns: 200px 1fr; gap: 4px 16px; align-items: center; } .rp-f .rp-fnote { grid-column: 2; }
      .rp-f .katex-display { margin: 4px 0; padding: 2px 0; overflow: visible; text-align: left; } .rp-f .katex-display > .katex { font-size: 1em; text-align: left; }
      .rp-m { border: 1px solid var(--rule); border-radius: 10px; padding: 12px 16px; margin-bottom: 12px; break-inside: avoid; }
      .rp-bad { color: var(--red); font-weight: 600; } .rp-good { color: var(--green); font-weight: 600; } .rp-why { font-size: 14px; color: var(--ink-2); border-top: 1px dashed var(--rule); margin-top: 8px; padding-top: 8px; }
      .rp-tag { font: 700 11px var(--sans); color: var(--violet); text-transform: uppercase; letter-spacing: .06em; }
      .rp-mini { border-left: 4px solid var(--violet); padding: 4px 16px; margin-bottom: 18px; }
      .rp-note h3 { font: 600 18px var(--serif); margin: 18px 0 6px; } .rp-note h4 { margin: 12px 0 4px; }
      .rp-foot { margin-top: 30px; padding-top: 12px; border-top: 1px solid var(--rule); color: var(--green); font-weight: 600; }
      @media print { .rp-bar { display: none; } .rp { padding: 0; } .rp-break { break-before: auto; } a { color: inherit; } .rp-sec h2 { break-after: avoid; } }
      @page { margin: 16mm 14mm; }
    </style></head><body><div class="rp"><div class="rp-bar"><button onclick="window.print()" class="primary">Print / Save as PDF</button><button onclick="window.close()">Close</button></div>${body}</div></body></html>`);
  w.document.close();
}
$('#packGo') && ($('#packGo').onclick = () => openRevisionPack($('#packSubj').value));

// Full offline backup / restore (.zip of everything; made by the local server).
$('#zipGo').onclick = async () => {
  if (Store.mode !== 'server') { toast('The full backup needs the app started from its desktop shortcut.'); return; }
  const btn = $('#zipGo'); btn.disabled = true; $('#zipInfo').textContent = 'Packing everything into one .zip…';
  try {
    const r = await fetch('/api/backup');
    if (!r.ok) throw new Error('Backup failed (' + r.status + ')');
    const blob = await r.blob();
    const name = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'GATE-Prep-Desk-backup.zip';
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    $('#zipInfo').textContent = `${name} · ${fmtSize(blob.size)}. Copy it to a USB drive to keep it safe.`;
  } catch (e) { $('#zipInfo').textContent = e.message; }
  finally { btn.disabled = false; }
};
$('#zipIn').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (!confirm(`Restore everything from ${f.name}? Your current data is zipped into the app folder first, so nothing is lost.`)) return;
  $('#zipInfo').textContent = 'Restoring…';
  try {
    const r = await fetch('/api/restore', { method: 'POST', body: f });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Restore failed');
    $('#zipInfo').textContent = `Restored. Your previous data was saved as ${j.safety} in the app folder.`;
    toast('Backup restored. Reloading…', 'ok');
    setTimeout(() => location.reload(), 1500);
  } catch (err) { $('#zipInfo').textContent = err.message; }
};

// Daily automatic backup (kept: newest 7). On unless you turn it off; an empty folder means the default,
// Documents\GATE Prep Desk backups (outside the app folder). Settings live in hub.autoBackup.
const AB_EVERY = 864e5, AB_ON = ab => ab.on !== false;
const AutoBackup = {
  async run(folder, { quiet = false } = {}) {
    const r = await fetch('/api/autobackup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: folder || '', keep: 7 }) });
    const j = await r.json().catch(() => ({}));
    const at = new Date().toISOString();
    if (!r.ok || !j.ok) {
      await updateHub(h => { h.autoBackup = { ...(h.autoBackup || {}), error: j.error || `Backup failed (${r.status})`, errorAt: at }; });
      throw new Error(j.error || `Backup failed (${r.status})`);
    }
    await updateHub(h => { h.autoBackup = { ...(h.autoBackup || {}), last: at, lastPath: j.path, lastSize: j.size, kept: j.kept, error: '' }; });
    if (!quiet) toast(`Backup saved: ${j.path} (${fmtSize(j.size)}).`, 'ok', 7000);
    return j;
  },
  // At start-up: if it's on and the last one is a day old, back up (once, in one window), after things settle.
  async maybe() {
    if (Store.mode !== 'server') return;
    const ab = (await Store.getHub()).autoBackup || {};
    if (!AB_ON(ab) || (ab.last && Date.now() - new Date(ab.last).getTime() < AB_EVERY)) return;
    if (ab.errorAt && Date.now() - new Date(ab.errorAt).getTime() < 6 * 3600e3) return;   // don't retry a failing folder every launch
    const go = async () => {
      const again = (await Store.getHub()).autoBackup || {};
      if (again.last && Date.now() - new Date(again.last).getTime() < AB_EVERY) return;
      try { await this.run(again.folder, { quiet: true }); toast('Daily backup saved.', 'ok'); }
      catch (e) { toast(`Daily backup didn't work: ${e.message}. Check the folder in Settings.`, 'info', 9000); }
      if (tab === 'settings') { await refreshHub(); renderAutoBackup(); }
    };
    setTimeout(() => navigator.locks ? navigator.locks.request('gate-desk-autobackup', { ifAvailable: true }, l => l && go()) : go(), 90000);
  },
};
function renderAutoBackup() {
  const ab = H.autoBackup || {};
  $('#abOn').checked = AB_ON(ab);
  if (document.activeElement !== $('#abFolder')) $('#abFolder').value = ab.folder || '';
  const next = ab.last ? new Date(new Date(ab.last).getTime() + AB_EVERY) : null;
  $('#abInfo').innerHTML = ab.error ? `<span style="color:var(--red)">Last try failed: ${escapeHtml(ab.error)}</span>`
    : ab.last ? `Last: ${relDay(ab.last)} · <span title="${escapeHtml(ab.lastPath || '')}">${fmtSize(ab.lastSize || 0)}</span>${AB_ON(ab) ? ` · next: ${next < new Date() ? 'on next start' : next.toLocaleDateString()}` : ''}`
    : '';
}
const abSave = async () => {
  const folder = $('#abFolder').value.trim(), on = $('#abOn').checked;
  await updateHub(h => { h.autoBackup = { ...(h.autoBackup || {}), on, folder }; });
  await refreshHub(); renderAutoBackup();
};
$('#abOn').onchange = abSave;
$('#abFolder').onchange = abSave;
$('#abNow').onclick = async () => {
  const folder = $('#abFolder').value.trim();
  if (Store.mode !== 'server') { toast('Backups need the app started from its desktop shortcut.'); return; }
  const b = $('#abNow'); b.disabled = true; $('#abInfo').textContent = 'Packing everything into one .zip…';
  try { await updateHub(h => { h.autoBackup = { ...(h.autoBackup || {}), folder }; }); await AutoBackup.run(folder); } catch (e) { toast(e.message); }
  finally { b.disabled = false; await refreshHub(); renderAutoBackup(); }
};

// ---------- Night shift (nightshift.js): settings and what it's doing ----------
async function renderNight() {
  const c = Night.cfg();
  $('#nightOn').checked = c.on;
  $('#nightCard').querySelectorAll('[data-nt]').forEach(i => { i.checked = !!c.tasks[i.dataset.nt]; });
  $('#nightRun').textContent = Night.running ? 'Stop' : 'Run now';
  const t = await Night.todo(), log = (H.nightLog || []).slice(-8).reverse();
  const left = [t.verify && `${t.verify} PYQ answer${t.verify > 1 ? 's' : ''} to check`, (t.topics + t.lessons) && `${t.topics + t.lessons} lesson${t.topics + t.lessons > 1 ? 's' : ''} to fact-check`,
    t.minis && `${t.minis} mini lesson${t.minis > 1 ? 's' : ''}`, t.cards && `${t.cards} flashcard${t.cards > 1 ? 's' : ''}`, c.tasks.master && t.master && `${t.master} masterclass${t.master > 1 ? 'es' : ''} to write`].filter(Boolean);
  $('#nightState').innerHTML = `${Night.running ? `<p class="small"><b>Working now:</b> ${escapeHtml(Night.current || 'starting…')}</p>` : ''}
    <p class="small muted">${left.length ? 'Still to do: ' + left.join(' · ') + '.' : 'Nothing left to do. New PYQs and lessons are picked up automatically.'}</p>
    ${log.length ? `<details><summary class="small">Recently done (${(H.nightLog || []).length})</summary>${log.map(l => `<div class="st-row"><span class="small" ${l.error ? 'style="color:var(--red)"' : ''}>${escapeHtml(l.what)}</span><span class="small muted">${relDay(l.at)}${l.secs ? ` · ${fmtDurShort(l.secs)}` : ''}</span></div>`).join('')}</details>` : ''}`;
}
const nightSave = async () => {
  const tasks = {}; $('#nightCard').querySelectorAll('[data-nt]').forEach(i => { tasks[i.dataset.nt] = i.checked; });
  await updateHub(h => { h.night = { on: $('#nightOn').checked, tasks }; });
  await refreshHub(); renderNight();
};
$('#nightOn').onchange = nightSave;
$('#nightCard').querySelectorAll('[data-nt]').forEach(i => i.onchange = nightSave);
$('#nightRun').onclick = async () => {
  if (Night.running) { Night.stop(); return; }
  await nightSave();
  toast('Night shift started. It keeps going while you watch; press Stop to end it.', 'ok');
  const n = await Night.work(true);
  await refreshHub(); renderNight();
  if (n) toast(`Night shift: ${n} task${n > 1 ? 's' : ''} done.`, 'ok');
};
onBus(m => { if (m.type === 'night' && tab === 'settings') refreshHub().then(renderNight); });

// ---------- boot ----------
(async () => {
  await Store.init();
  Calib.load();
  PyqScan.start();
  await refreshHub();
  ensureBusyUI();
  hydrateIcons();
  const hr = new Date().getHours();
  $('#greet').textContent = `${hr < 5 ? 'Up late?' : hr < 12 ? 'Good morning!' : hr < 17 ? 'Good afternoon!' : 'Good evening!'} What shall we learn today?`;
  if (H.settings.autoDeleteDays != null) await updateHub(h => { delete h.settings.autoDeleteDays; }).catch(() => {});   // retire the old auto-delete setting
  Reader.start();
  AutoBackup.maybe();
  Night.start();
  RunnerPanel.mount();
  models = await checkOllama($('#status'));
  if (models.length) {
    if (!models.includes(teachModel())) Cfg.set('model', models[0]);
    if (!models.includes(visionModel())) Cfg.set('vmodel', models[0]);
  }
  const t = location.hash.slice(1);
  // Lessons from before the topics list existed get added once.
  const known = new Set((H.covered || []).map(e => e.key));
  for (const [k, tp] of Object.entries(H.topics)) if (tp.md && !known.has('topic:' + k)) await recordCovered(tp.md, { kind: 'topic', key: k, title: tp.title, at: tp.at });
  // Formula book: collect from lessons and solved questions from before it existed (once).
  if (!H.settings.formulaBackfill) {
    await collectMany(Object.entries(H.topics).filter(([, t]) => t.md).map(([k, t]) => ({ md: t.md, subject: lessonSubject(t.md) || 'Other', source: { kind: 'topic', label: `Lesson: ${t.title}`, href: `index.html?topic=${encodeURIComponent(k)}#ask` } }))
      .concat(H.solved.map(s => ({ md: s.md, subject: lessonSubject(s.question + '\n' + s.md) || 'Other', source: { kind: 'solved', label: 'Photo question: ' + plainText(s.question).replace(/\s+/g, ' ').slice(0, 50), href: 'index.html#solve' } }))));
    await updateHub(h => { h.settings.formulaBackfill = true; });
  }
  await updateHub(h => { h.formulas = (h.formulas || []).filter(f => formulaish(f.tex)); });   // drop worked arithmetic picked up earlier
  // Keep titles/subjects/subtopics in step with the latest rules (dates and mastery untouched).
  await updateHub(h => (h.covered || []).forEach(e => { const tp = e.source.kind === 'topic' && h.topics[e.source.key]; if (tp && tp.md) Object.assign(e, lessonOutline(tp.md, tp.title)); }));
  syncTopicsFile();
  await refreshHub();
  if (!H.settings.pyqInit) { await updateHub(h => { h.settings.pyqInit = true; }); PyqScan.scanAll(); }   // files read before PYQs existed
  openTab(['ask', 'solve', 'practice', 'pyq', 'mistakes', 'topics', 'notes', 'formulas', 'files', 'settings'].includes(t) ? t : 'ask');
  // Links from study spaces: ?learn=<topic> teaches it, ?topic=<key> opens a Learn lesson.
  const qp = new URLSearchParams(location.search);
  if (qp.get('topic') && H.topics[qp.get('topic')]) { openTab('ask'); openTopic(H.topics[qp.get('topic')], qp.get('topic')); }
  else if (qp.get('learn')) { $('#askIn').value = qp.get('learn'); teachTopic(qp.get('learn')); }
  if (qp.toString()) history.replaceState(null, '', location.pathname + location.hash);
})().catch(e => { console.error(e); alert('Failed to start: ' + e.message); });

// ---------- tutor chat contexts on the home page ----------
TutorChat.provide(() => {
  const list = [];
  if (curTopic && curTopic.md) list.push({ id: 'lesson:' + curTopic.key, label: 'This lesson: ' + curTopic.title, text: () => curTopic.md.slice(0, 16000) });
  if (solved) list.push({ id: 'solved', label: 'The question I just solved', text: () => `Question:\n${solved.question}\n\nMy solution:\n${solved.md}`.slice(0, 16000) });
  return list;
});
$('#askChatOpen').onclick = () => curTopic && TutorChat.open('lesson:' + curTopic.key);
$('#solveChatOpen').onclick = () => TutorChat.open('solved');
TutorChat.mount();

// ---------- FORMULA BOOK ----------
let fSubject = 'All';
function renderFormulas() {
  const all = H.formulas || [];
  const q = $('#fSearch').value.trim().toLowerCase();
  const counts = {};
  all.forEach(f => { counts[f.subject] = (counts[f.subject] || 0) + 1; });
  const order = SUBJECTS.concat(['Other']).filter(s => counts[s]);
  if (fSubject !== 'All' && !counts[fSubject]) fSubject = 'All';
  $('#fSubjects').innerHTML = [`<button data-s="All" class="${fSubject === 'All' ? 'active' : ''}">All <span>${all.length}</span></button>`]
    .concat(order.map(s => `<button data-s="${escapeHtml(s)}" class="${fSubject === s ? 'active' : ''}">${escapeHtml(s)} <span>${counts[s]}</span></button>`)).join('');
  $('#fSubjects').querySelectorAll('[data-s]').forEach(b => b.onclick = () => { fSubject = b.dataset.s; renderFormulas(); });
  const shown = all.filter(f => (fSubject === 'All' || f.subject === fSubject) && (!q || (f.tex + ' ' + f.note + ' ' + f.subject).toLowerCase().includes(q)));
  if (!shown.length) { $('#fList').innerHTML = `<div class="card"><p class="empty">${all.length ? 'Nothing matches that.' : 'No formulas yet. They appear here as you learn, read your notes and solve questions.'}</p></div>`; return; }
  // Same formula in different notations (same subject and name) is shown once, with "Also written as".
  const groupKey = f => f.subject + '|' + (f.name || f.key).toLowerCase().replace(/\b(formula|definition|calculation|equation|rule|expression|basic)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const kt = tex => { try { return katex.renderToString(tex, { throwOnError: false }); } catch { return escapeHtml(tex); } };
  const bySubject = {};
  const groups = new Map();
  shown.forEach(f => { const k = groupKey(f); if (!groups.has(k)) { groups.set(k, [f]); (bySubject[f.subject] = bySubject[f.subject] || []).push(groups.get(k)); } else groups.get(k).push(f); });
  $('#fList').innerHTML = Object.keys(bySubject).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(s => `
    ${fSubject === 'All' ? `<h3 class="h f-subject">${escapeHtml(s)}</h3>` : ''}
    ${bySubject[s].map(g => { const f = g[0], more = g.slice(1), src = [...new Map(g.flatMap(x => x.sources).map(x => [x.label, x])).values()];
      return `<div class="card f-card" data-id="${f.id}" data-ids="${g.map(x => x.id).join(',')}">
      ${f.name ? `<p class="f-name">${escapeHtml(f.name.replace(/\s+(formula|definition|calculation)$/i, ''))}</p>` : ''}
      <div class="f-tex${f.tex.replace(/\\[a-z]+|[{}]/gi, '').length > 42 ? ' long' : ''}" title="Tap to have the tutor explain this formula">${(() => { try { return katex.renderToString(f.tex, { displayMode: true, throwOnError: false }); } catch { return escapeHtml(f.tex); } })()}</div>
      ${more.length ? `<p class="f-alt small muted">Also written as: ${more.map(x => kt(x.tex)).join(' &nbsp;·&nbsp; ')}</p>` : ''}
      ${(() => { const n = cleanNote(f.note, f.name); return n ? `<p class="f-note">${escapeHtml(n)}</p>` : ''; })()}
      <div class="f-foot"><span class="small muted f-src">${src.slice(0, 2).map(x => x.href ? `<a href="${escapeHtml(x.href)}">${escapeHtml(x.label)}</a>` : escapeHtml(x.label)).join(' &middot; ')}${src.length > 2 ? ` &middot; +${src.length - 2} more` : ''}</span>
        <span style="flex:1"></span>
        <select class="f-move" title="File under another subject">${SUBJECTS.concat(['Other']).map(x => `<option ${x === f.subject ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('')}</select>
        <button class="link f-copy" title="Copy the LaTeX">Copy</button><button class="link danger f-del" title="Remove">${icon('trash')}</button></div>
    </div>`; }).join('')}`).join('');
  $('#fList').querySelectorAll('.f-card').forEach(card => {
    const f = all.find(x => x.id === card.dataset.id), ids = new Set(card.dataset.ids.split(','));
    $('.f-tex', card).onclick = () => TutorChat.open('none', `Explain this ${f.subject} formula for GATE: what each symbol means, when to use it, a common trap, and a small worked example. $$${f.tex}$$`);
    $('.f-copy', card).onclick = async () => { try { await navigator.clipboard.writeText(f.tex); toast('LaTeX copied.', 'ok'); } catch { toast(f.tex); } };
    $('.f-move', card).onchange = async e => { await updateHub(h => (h.formulas || []).forEach(y => { if (ids.has(y.id)) y.subject = e.target.value; })); syncFormulasFile(); await refreshHub(); renderFormulas(); toast(`Moved to ${e.target.value}.`, 'ok'); };
    $('.f-del', card).onclick = async () => {
      const removed = all.filter(y => ids.has(y.id));
      await updateHub(h => { h.formulas = (h.formulas || []).filter(y => !ids.has(y.id)); }); syncFormulasFile(); await refreshHub(); renderFormulas();
      toastUndo('Formula removed.', async () => { await updateHub(h => { h.formulas = (h.formulas || []).concat(removed); }); syncFormulasFile(); await refreshHub(); renderFormulas(); });
    };
  });
}
$('#fSearch').oninput = () => renderFormulas();
$('#fDownload').onclick = () => downloadText(formulasMarkdown(H.formulas), 'My GATE formulas.md', 'text/markdown;charset=utf-8');
$('#fPrint').onclick = () => window.print();

// ---------- MY NOTES ----------
$('#nAdd').onclick = () => NotesUI.addTopic();
$('#nSearch').oninput = () => { NotesUI.q = $('#nSearch').value.trim(); NotesUI.paint(); };
$('#nDownload').onclick = async () => downloadText(notesMarkdown((await Store.getHub()).notes), 'My GATE notes.md', 'text/markdown;charset=utf-8');
$('#fResort').onclick = () => {
  $('#fResort').disabled = true;
  toast('Re-checking every formula in the background. The list updates as it goes.');
  curateFormulas({ all: true, onProgress: async () => { await refreshHub(); if (tab === 'formulas') renderFormulas(); } })
    .finally(async () => { $('#fResort').disabled = false; await refreshHub(); if (tab === 'formulas') renderFormulas(); toast('Formula book re-sorted.', 'ok'); });
};
window.addEventListener('gt-formulas', async () => { await refreshHub(); if (tab === 'formulas') renderFormulas(); });
curateSoon();   // check any formulas not looked at yet

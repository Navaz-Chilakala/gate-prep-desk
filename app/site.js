// Study site for one upload (PDFs and/or images, up to book size): digitize -> learn -> questions -> test -> results.
const params = new URLSearchParams(location.search);
const SITE_ID = params.get('id') || '';
let S = { pages: [], lessons: [], tests: [], attempts: [], questions: [] };
let meta, PAGES = [], FILES = [], OUTLINE = [];
let tab = 'digitize', curPage = 1, curLesson = 0, curAttempt = null, runner = null;

// ---------- persistence ----------
let saveChain = Promise.resolve();
// Saves this page's state but keeps any pages the background reader wrote meanwhile.
function save() {
  const snap = JSON.parse(JSON.stringify(S));
  saveChain = saveChain.then(() => updateData(SITE_ID, cur => {
    const theirs = cur.pages || [], mine = snap.pages || [];
    Object.assign(cur, snap);
    cur.pages = Array.from({ length: Math.max(theirs.length, mine.length) }, (_, i) => mine[i] || theirs[i] || null);
  })).catch(e => console.error('save failed', e));
  return saveChain;
}
function show(sel, on = true) { $(sel).classList.toggle('hidden', !on); }

// ---------- tabs ----------
document.querySelectorAll('#tabs [data-tab]').forEach(b => b.onclick = () => openTab(b.dataset.tab));
function openTab(t) {
  tab = t;
  try { history.replaceState(null, '', location.pathname + '?id=' + SITE_ID + '#' + t); } catch {}
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('main > section').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + t));
  render();
}
function render() {
  ({ digitize: renderDigitize, learn: renderLearn, questions: renderQuestions, test: renderTests, results: renderResults, sheet: renderSheet, manage: renderManage })[tab]();
}

// ---------- pages (the reading itself lives in reader.js) ----------
const VIA_LABEL = { detailed: 'very detailed reading', text: 'typed text', ocr: 'OCR', 'text+vision': 'typed text + close look', 'ocr+vision': 'OCR + close look', vision: 'close look', edited: 'fixed by you', blank: 'blank page', duplicate: 'same as the page before' };
function isDone(i) { return !!(S.pages[i] && S.pages[i].md != null); }
function digitizedCount() { let n = 0; for (let i = 0; i < PAGES.length; i++) if (isDone(i)) n++; return n; }
function fmtDur(s) { s = Math.round(s); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round(s % 3600 / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; }
// Reads pages right here (when a lesson needs its pages now), saving each one as it lands.
async function readHere(indexes, signal, mode = $('#digiMode').value) {
  const t0 = Date.now();
  await readPages(PAGES, indexes, {
    mode, useOcr: $('#optOcr').checked, signal, onToken: (_, o) => live(o, signal),
    onPage: async (i, r, k) => {
      S.pages[i] = r;
      progress(k + 1, indexes.length, signal);
      jobLabel(`Reading page ${i + 1} (${k + 1} of ${indexes.length})` + (k + 1 < indexes.length ? ` · about ${fmtDur((Date.now() - t0) / 1000 / (k + 1) * (indexes.length - k - 1))} left` : ''), signal);
      await updateData(SITE_ID, cur => { cur.pages = cur.pages || []; cur.pages[i] = r; });
      await collectFormulas(r.md, lessonSubject(r.md) || await siteSubject(SITE_ID), { kind: 'page', label: `${prettyName(meta.name)} p.${i + 1}`, href: `site.html?id=${SITE_ID}&page=${i + 1}#digitize` });
      PyqScan.queuePages(SITE_ID, meta.name, [{ n: i + 1, md: r.md }]);
    },
  });
}
async function digitizeRange(from, to, signal) {
  const todo = [];
  for (let n = from; n <= to; n++) if (!isDone(n - 1)) todo.push(n - 1);
  await readHere(todo, signal);
  // The plan was sized with estimated page lengths; redo it with real ones while nothing is written yet.
  if (todo.length && !S.lessons.some(l => l.md)) { buildLessonPlan(); await save(); }
}
$('#btnDigitize').onclick = async () => {
  const from = Math.max(1, +$('#rngFrom').value || 1), to = Math.min(PAGES.length, +$('#rngTo').value || PAGES.length);
  if (from > to) { alert('Check the page range.'); return; }
  let todo = 0;
  for (let n = from; n <= to; n++) if (!isDone(n - 1)) todo++;
  if (!todo) { toast(`Pages ${from}–${to} are already read.`, 'ok'); return; }
  await Reader.enqueue({ siteId: SITE_ID, name: meta.name, from, to, mode: $('#digiMode').value, ocr: $('#optOcr').checked });
  toast(`Reading ${todo} page${todo > 1 ? 's' : ''} in the background. Keep studying; I'll tell you when it's done.`, 'ok');
  queueState = { status: 'queued', k: 0, total: todo };
  renderQueueStatus();
};
$('#btnRedoPage').onclick = () => runJob(`Taking a closer look at page ${curPage}`, s => readHere([curPage - 1], s, 'thorough'), render);

// Live status of this space in the background reading queue.
let queueState = null, queueItemId = null;
function renderQueueStatus() {
  const el = $('#queueStatus');
  if (!queueState || ['done', 'cancelled'].includes(queueState.status)) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const s = queueState;
  const line = s.status === 'reading'
    ? (s.total ? `Reading in the background: page ${s.page || '…'} (${s.k} of ${s.total})${s.eta > 5 ? ` · about ${fmtDur(s.eta)} left` : ''}` : (s.note || 'Starting…'))
    : s.status === 'paused' ? 'Reading is paused.' : s.status === 'error' ? `Reading stopped: ${s.error || 'something went wrong'}` : 'Waiting its turn in the reading queue…';
  el.innerHTML = `<div class="row"><span class="busy-title" style="flex:1">${escapeHtml(line)}</span>
    ${s.status === 'paused' || s.status === 'error' ? '<button class="primary" data-q="resume">Resume</button>' : '<button data-q="pause">Pause</button>'}
    <button class="link" data-q="cancel">Cancel</button></div>
    <div class="progress"><div style="width:${s.total ? 100 * s.k / s.total : 0}%"></div></div>`;
  el.querySelectorAll('[data-q]').forEach(b => b.onclick = async () => {
    if (!queueItemId) { const h = await Store.getHub(); const q = (h.queue || []).find(x => x.siteId === SITE_ID); queueItemId = q && q.id; }
    if (queueItemId) await Reader.command(queueItemId, b.dataset.q);
    if (b.dataset.q === 'cancel') queueState = null; else if (b.dataset.q === 'resume') queueState.status = 'queued'; else queueState.status = 'paused';
    renderQueueStatus();
  });
}
let pagesRefresh = null;
async function mergeRemotePages() {
  const d = await Store.getData(SITE_ID);
  (d.pages || []).forEach((p, i) => { if (p && p.md != null && !isDone(i)) S.pages[i] = p; });
  if (tab === 'digitize') renderDigitize();
  if (tab === 'learn') renderLessonList();
}
onBus(m => {
  if (m.siteId !== SITE_ID) return;
  if (m.type === 'reader') {
    queueItemId = m.id;
    queueState = Object.assign(queueState || {}, m);
    renderQueueStatus();
    if (m.status === 'done') { if (!S.lessons.some(l => l.md)) { buildLessonPlan(); save(); } mergeRemotePages(); }
  }
  if (m.type === 'pages') { clearTimeout(pagesRefresh); pagesRefresh = setTimeout(mergeRemotePages, 400); }
});
$('#pageSel').onchange = () => { curPage = +$('#pageSel').value || 1; renderDigitize(); };
$('#pgPrev').onclick = () => { if (curPage > 1) { curPage--; renderDigitize(); } };
$('#pgNext').onclick = () => { if (curPage < PAGES.length) { curPage++; renderDigitize(); } };
$('#pageSave').onclick = async () => {
  S.pages[curPage - 1] = { n: curPage, md: $('#pageEdit').value, via: 'edited' };
  await save(); renderDigitize();
};
async function renderDigitize() {
  const total = PAGES.length, done = digitizedCount();
  $('#digiBar').style.width = (total ? 100 * done / total : 0) + '%';
  const byVia = {};
  S.pages.forEach(p => { if (p && p.md != null) byVia[p.via] = (byVia[p.via] || 0) + 1; });
  $('#digiInfo').textContent = done === total ? `All ${total} pages read` : `${done} of ${total} pages read so far`;
  if (done) $('#digiInfo').textContent += ' (' + Object.entries(byVia).map(([k, v]) => `${v} ${VIA_LABEL[k] || k}`).join(', ') + ')';
  if (!$('#rngFrom').value) $('#rngFrom').value = 1;
  if (!$('#rngTo').value) $('#rngTo').value = total;
  $('#rngFrom').max = $('#rngTo').max = $('#pageSel').max = $('#saveFrom').max = $('#saveTo').max = total;
  if (!$('#saveFrom').value) $('#saveFrom').value = 1;
  if (!$('#saveTo').value) $('#saveTo').value = total;
  $('#saveGo').disabled = !done;
  $('#digiEta').textContent = total > 60 && done < total ? `Big book! Smart mode reads typed pages instantly and only looks closely at figures, tables and scans. You don't have to wait for all of it: open any lesson and I'll read its pages first.` : '';
  curPage = Math.max(1, Math.min(curPage, total));
  $('#pageSel').value = curPage;
  $('#pageCount').textContent = `of ${total}`;
  const p = S.pages[curPage - 1];
  $('#pageVia').textContent = p && p.md != null ? (VIA_LABEL[p.via] || p.via) : 'not read yet';
  $('#pageSrc').textContent = PAGES[curPage - 1] ? PAGES[curPage - 1].label : '';
  $('#pageMd').innerHTML = p && p.md != null ? renderMd(p.md || '_(empty page)_') : '<p class="empty">I haven\'t read this page yet.</p>';
  if (p && p.unsure && p.via !== 'edited') {
    const n = markWords($('#pageMd'), p.unsure.filter(w => !WEB_STOP.has(w.toLowerCase()) && !TOPIC_STOP.has(w.toLowerCase())));
    if (n) $('#pageMd').insertAdjacentHTML('afterbegin', `<div class="check" style="background:var(--amber-soft);color:var(--ink)"><b>${n} word${n > 1 ? 's' : ''} to double-check</b> (highlighted): the scanner wasn't sure about them. Compare with the page image, and fix them under "Fix the text of this page" if needed.</div>`);
  }
  $('#pageEdit').value = p && p.md != null ? p.md : '';
  renderQueueStatus();
  if (!total) return;
  const want = curPage;
  const c = await pageCanvas(PAGES[want - 1], 900);
  if (want === curPage) $('#pageImg').src = c.toDataURL('image/jpeg', 0.8);
}

// ---------- save what's been read to the laptop ----------
function digitizedMarkdown(from, to, withLessons) {
  const out = [`# ${prettyName(meta.name)}`, `_Pages ${from}–${to}, read with GATE Prep Desk on ${new Date().toLocaleDateString()}_`];
  let chapter = null, pages = 0;
  for (let n = from; n <= to; n++) {
    const p = S.pages[n - 1];
    if (!p || p.md == null) continue;
    const L = S.lessons.find(l => n >= l.from && n <= l.to);
    if (L && !L.auto && L.chapter && L.chapter !== chapter) { chapter = L.chapter; out.push(`\n# ${chapter}`); }
    out.push(`\n## Page ${n}\n\n${p.md.trim()}`);
    pages++;
  }
  let lessons = 0;
  if (withLessons) {
    const ls = S.lessons.filter(l => l.md && l.to >= from && l.from <= to);
    if (ls.length) {
      out.push('\n---\n\n# My lessons');
      ls.forEach(l => { out.push('\n' + l.md.trim().replace(/^(#{1,5}) /gm, '#$1 ')); lessons++; });
    }
  }
  return { md: out.join('\n'), pages, lessons };
}
function standaloneHtml(md, title, autoPrint) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css">
<style>body{font:16px/1.65 Georgia,'Times New Roman',serif;color:#1f2433;max-width:820px;margin:40px auto;padding:0 20px;background:#fffdf7}
h1,h2,h3{line-height:1.25}h2{border-top:1px solid #e7dfcd;padding-top:16px;margin-top:34px;color:#2c4bb3;font-size:17px}
table{border-collapse:collapse;margin:10px 0}th,td{border:1px solid #d3c8b0;padding:4px 9px}pre{background:#f6f1e6;padding:10px;overflow-x:auto}
blockquote{border-left:3px solid #2c4bb3;margin:10px 0;padding:4px 14px;background:#eef1fb}code{font-family:Consolas,monospace}
@media print{body{margin:0;background:#fff;max-width:none}h2{break-after:avoid}}</style></head>
<body>${renderMd(md)}${autoPrint ? '<script>window.onload=()=>setTimeout(()=>print(),500)<\/script>' : ''}</body></html>`;
}
$('#saveGo').onclick = () => {
  const from = Math.max(1, +$('#saveFrom').value || 1), to = Math.min(PAGES.length, +$('#saveTo').value || PAGES.length);
  if (from > to) { $('#saveInfo').textContent = 'Check the page range.'; return; }
  const { md, pages, lessons } = digitizedMarkdown(from, to, $('#saveLessons').checked);
  if (!pages) { $('#saveInfo').textContent = `I haven't read any pages between ${from} and ${to} yet. Read them first, then save.`; return; }
  const base = prettyName(meta.name) + (from === 1 && to === PAGES.length ? '' : ` (pages ${from}-${to})`);
  const fmt = $('#saveFmt').value;
  if (fmt === 'md') downloadText(md, base + '.md', 'text/markdown;charset=utf-8');
  else if (fmt === 'txt') downloadText(md.split('\n').map(l => /^#{1,6}\s/.test(l) ? plainText(l).trim() : plainText(l)).join('\n').replace(/\n{3,}/g, '\n\n'), base + '.txt', 'text/plain;charset=utf-8');
  else if (fmt === 'html') downloadText(standaloneHtml(md, base), base + '.html', 'text/html;charset=utf-8');
  else {
    const w = window.open(URL.createObjectURL(new Blob([standaloneHtml(md, base, true)], { type: 'text/html' })), '_blank');
    if (!w) { $('#saveInfo').textContent = 'Your browser blocked the print window. Allow pop-ups for this page and try again.'; return; }
  }
  $('#saveInfo').textContent = `${fmt === 'pdf' ? 'Opened for printing' : 'Saved to your Downloads folder'}: ${pages} page${pages > 1 ? 's' : ''}${lessons ? ` + ${lessons} lesson${lessons > 1 ? 's' : ''}` : ''}${pages < to - from + 1 ? ` (${to - from + 1 - pages} not read yet were skipped)` : ''}.`;
};

// ---------- lesson plan (chapters from PDF bookmarks, lessons ~9k chars each) ----------
function estChars(n) { const p = S.pages[n - 1]; return p && p.md != null ? p.md.length : 2500; }
function rangeChars(L) { let c = 0; for (let n = L.from; n <= L.to; n++) c += estChars(n); return c; }
function buildLessonPlan() {
  const N = PAGES.length;
  const marks = OUTLINE.slice().sort((a, b) => a.page - b.page || a.level - b.level);
  if (!marks.length || marks[0].page > 1) marks.unshift({ title: marks.length ? 'Introduction' : meta.name.replace(/\.[^.]*$/, ''), level: 1, page: 1 });
  const segs = [];
  let chapter = marks[0].title;
  marks.forEach((m, i) => {
    if (m.level === 1) chapter = m.title;
    const next = marks.slice(i + 1).find(x => x.page > m.page);
    const end = (next ? next.page : N + 1) - 1;
    const last = segs[segs.length - 1];
    if (last && last.from === m.page) { if (m.level > 1) last.title = m.title; last.chapter = chapter; return; }
    if (end >= m.page) segs.push({ chapter, title: m.title, from: m.page, to: end, auto: !!m.auto });
  });
  const lessons = [];
  for (const s of segs) {
    const pieces = [];
    let from = s.from, chars = 0;
    for (let n = s.from; n <= s.to; n++) {
      const c = estChars(n);
      if (chars + c > 9000 && n > from) { pieces.push({ from, to: n - 1 }); from = n; chars = 0; }
      chars += c;
    }
    pieces.push({ from, to: s.to });
    pieces.forEach((p, k) => lessons.push({ chapter: s.chapter, title: s.auto ? '' : s.title + (pieces.length > 1 ? ` (part ${k + 1})` : ''), from: p.from, to: p.to, auto: s.auto }));
  }
  const merged = [];
  for (const L of lessons) {
    const prev = merged[merged.length - 1];
    if (prev && prev.chapter === L.chapter && rangeChars(L) < 1500 && rangeChars(prev) + rangeChars(L) < 9000) prev.to = L.to;
    else merged.push(L);
  }
  // Keep lessons already written for the same page range.
  const old = new Map(S.lessons.map(l => [`${l.from}-${l.to}`, l]));
  S.lessons = merged.map(L => Object.assign({ id: uid(), md: '', done: false }, L, old.get(`${L.from}-${L.to}`) ? { id: old.get(`${L.from}-${L.to}`).id, md: old.get(`${L.from}-${L.to}`).md, done: old.get(`${L.from}-${L.to}`).done, subject: old.get(`${L.from}-${L.to}`).subject } : {}));
}
function sourceFor(L) {
  return S.pages.filter(p => p && p.md != null && p.n >= L.from && p.n <= L.to).map(p => `--- Page ${p.n} ---\n${p.md}`).join('\n\n');
}
function lessonTitle(L, i) {
  const m = ((L && L.md) || '').match(/^#\s+(.+)$/m);
  if (L && L.auto) return m ? m[1].trim() : `Pages ${L.from}-${L.to}`;
  return (L && L.title) || (m ? m[1].trim() : `Lesson ${i + 1}`);
}
function pagesMissing(L) { let n = 0; for (let p = L.from; p <= L.to; p++) if (!isDone(p - 1)) n++; return n; }
async function generateLesson(i, signal, style = '') {
  const L = S.lessons[i];
  if (pagesMissing(L)) { jobLabel(`Digitizing pages ${L.from}-${L.to} first`, signal); await digitizeRange(L.from, L.to, signal); }
  // Online: look the lesson's subject up first, so notes + web + the tutor's knowledge are combined.
  let web = [];
  if (Web.on()) {
    const heading = (sourceFor(L).match(/^#{1,3}\s+(.{4,80})$/m) || [])[1];
    const q = (!L.auto && L.title) ? L.title.replace(/\(part \d+\)/i, '') : heading;
    if (q) { jobLabel('Looking it up online first', signal); web = await Web.search(plainText(q), signal); }
  }
  jobLabel(`Writing lesson: ${lessonTitle(L, i)}`, signal);
  const src = sourceFor(L);
  if (!src.trim()) throw new Error('These pages have no readable text.');
  const facts = factsFor(`${L.title || ''}\n${src.slice(0, 3000)}`, 8);
  L.md = await ollamaChat([
    { role: 'system', content: lessonFromMaterialSys(topicKind(L.title || L.chapter ? `${L.chapter || ''} ${L.title || ''}` : src.slice(0, 600)), style) },
    { role: 'user', content: `Section: ${L.chapter ? L.chapter + ' > ' : ''}${L.title || ''}\nStudy material (pages ${L.from}-${L.to}):\n\n${src.slice(0, 16000)}${factsBlock(facts)}${Web.context(web)}\n\nWrite the lesson.` },
  ], { signal, maxTokens: 7000, onToken: (_, o) => { if (tab === 'learn' && curLesson === i) { show('#lessonEmpty', false); viewer.set(o, { keepStep: true }); } else live(o, signal); } });
  L.subject = lessonSubject(L.md);
  L.sources = Web.brief(web);
  // Fact-check against the reference, your pages and (when online) the internet before you study it.
  if (Cfg.get('factcheck', 'on') === 'on') {
    const fc = await factCheck(L.md, { title: lessonTitle(L, i), subject: L.subject || '', material: src, kind: 'book lesson', signal, onStage: t => jobLabel(`Fact-checking: ${t}`, signal) });
    L.md = fc.md; L.review = fc.review;
    if (tab === 'learn' && curLesson === i) viewer.set(L.md, { keepStep: true });
  }
  await save();
  await recordCovered(L.md, lessonSource(L, i));
}
function lessonSource(L, i) { return { kind: 'lesson', siteId: SITE_ID, siteName: meta.name, from: L.from, to: L.to, lesson: i, title: lessonTitle(L, i) }; }
function lessonKey(L) { return `lesson:${SITE_ID}:${L.from}-${L.to}`; }
let masteredKeys = new Set();
$('#btnPlan').onclick = () => { if (!S.lessons.some(l => l.md) || confirm('Rebuild the lesson plan? Lessons for unchanged page ranges are kept.')) { buildLessonPlan(); save(); renderLearn(); } };
$('#btnLessons').onclick = () => {
  const todo = S.lessons.map((l, i) => i).filter(i => !S.lessons[i].md);
  if (!todo.length) { alert('All lessons are written.'); return; }
  if (todo.length > 10 && !confirm(`${todo.length} lessons to write (plus digitizing any pages not done yet). This can take a long time; you can stop at any point and continue later. Start?`)) return;
  runJob('Writing lessons', async signal => {
    for (let k = 0; k < todo.length; k++) { progress(k, todo.length, signal); await generateLesson(todo[k], signal); if (tab === 'learn') renderLessonList(); }
  }, render);
};
$('#btnRedoLesson').onclick = e => S.lessons[curLesson] && styleMenu(e.currentTarget, style => { const i = curLesson; runJob(style ? `Re-teaching: ${LESSON_STYLE[style].label.toLowerCase()}` : 'Regenerating lesson', s => generateLesson(i, s, style), render); });
$('#btnCards').onclick = () => {
  const L = S.lessons[curLesson];
  if (!L || !L.md) { alert('Open a written lesson first.'); return; }
  let n = 0;
  runJob('Making flashcards', async signal => { const cards = await makeCards(L.md, signal); n = cards.length; await addCards(cards, L.subject, meta.name); },
    () => toast(n ? `${n} flashcards added` : 'No flashcards could be made. Try again.', n ? 'ok' : 'bad'));
};
const viewer = new LessonViewer($('#lessonView'), {
  finishLabel: 'Next lesson →',
  onFormula: tex => { const L = S.lessons[curLesson]; TutorChat.open(L && `${SITE_ID}:lesson:${L.from}-${L.to}`, `Explain this formula step by step: what each symbol means, why it holds, and a small worked example. $$${tex}$$`); },
  decorate: (kind, card) => (tagSources(card, S.lessons[curLesson]), markUnverified(card, S.lessons[curLesson] && S.lessons[curLesson].review), decoratePrereqs(kind, card, {
    self: S.lessons[curLesson] && lessonKey(S.lessons[curLesson]),
    onLearn: name => window.open('index.html?learn=' + encodeURIComponent(name) + '#ask', '_blank'),
    onOpen: e => {
      if (e.source.kind === 'lesson' && e.source.siteId === SITE_ID) { curLesson = e.source.lesson; chat.reset(); renderLearn(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else window.open(e.source.kind === 'topic' ? 'index.html?topic=' + encodeURIComponent(e.source.key) + '#ask' : coveredHref(e), '_blank');
    },
  })),
  onDoneToggle: done => { const L = S.lessons[curLesson]; if (L) { L.done = done; save(); renderLessonList(); } },
  onFinish: () => {
    const L = S.lessons[curLesson];
    // You move on only after the mastery check closes this lesson.
    if (L && !masteredKeys.has(lessonKey(L))) {
      toast('Pass the mastery check to close this lesson and move on.');
      $('#lessonMastery').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    nextLesson();
  },
});
// "Show sources": tags each paragraph / bullet with the page of your file it matches best, and marks
// points that aren't in your pages at all (the tutor's own knowledge: worth checking against the book).
$('#srcTags').checked = Cfg.get('srcTags', 'off') === 'on';
$('#srcTags').onchange = () => { Cfg.set('srcTags', $('#srcTags').checked ? 'on' : 'off'); viewer.render(); };
const pageTokCache = new Map();
function pageTokens(n) {
  const p = S.pages[n - 1];
  if (!p || !p.md) return null;
  const c = pageTokCache.get(n);
  if (c && c.md === p.md) return c.set;
  const set = new Set(topicTokens(p.md));
  pageTokCache.set(n, { md: p.md, set });
  return set;
}
function tagSources(card, L) {
  if (!$('#srcTags').checked || !L || !L.md) return;
  const pages = [];
  for (let n = L.from; n <= L.to; n++) { const set = pageTokens(n); if (set) pages.push({ n, set }); }
  if (!pages.length) return;
  card.querySelectorAll('p, li').forEach(el => {
    if (el.closest('.src-skip, details, blockquote.addition') || el.querySelector('p, li')) return;
    const text = el.textContent || '';
    if (text.length < 60) return;
    const toks = [...new Set(topicTokens(text).filter(t => t.length >= 4 && !/^\d+$/.test(t)))];
    if (toks.length < 4) return;
    let best = { n: 0, r: 0 };
    for (const p of pages) { const r = toks.filter(t => p.set.has(t)).length / toks.length; if (r > best.r) best = { n: p.n, r }; }
    if (best.r >= 0.6) el.insertAdjacentHTML('beforeend', `<span class="src-tag" data-pg="${best.n}" title="Matches page ${best.n} of your file (${Math.round(best.r * 100)}% of its key words). Click to open the page.">p. ${best.n}</span>`);
    else if (best.r < 0.3) el.insertAdjacentHTML('beforeend', `<span class="src-tag off" title="Not found in your pages: this comes from the tutor's own knowledge. Worth checking against your book.">tutor</span>`);
  });
  card.querySelectorAll('.src-tag[data-pg]').forEach(t => t.onclick = () => { curPage = +t.dataset.pg; openTab('digitize'); });
}
function nextLesson() {
  if (curLesson < S.lessons.length - 1) { curLesson++; chat.reset(); renderLearn(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else openTab('test');
}
const chat = new ChatBox($('#lessonChat'), {
  system: 'You are a patient GATE CS tutor. Answer the doubt in short numbered steps in simple words, using the source pages and lesson. Cite the pages you used like (p. 3).',
  context: () => { const L = S.lessons[curLesson]; return L ? `Source pages:\n${sourceFor(L).slice(0, 12000)}\n\nLesson:\n${(L.md || '').slice(0, 4000)}` : ''; },
  linkify: html => html.replace(/\(p(?:age|g)?\.?\s*(\d{1,4})\)/gi, (m, n) => `<a href="#" data-page="${n}">${m}</a>`),
});
$('#lessonChat').addEventListener('click', e => {
  const a = e.target.closest('a[data-page]');
  if (!a) return;
  e.preventDefault(); curPage = +a.dataset.page; openTab('digitize');
});
// Command palette (Ctrl+K): this book's lessons and pages.
Palette.provide(() => (S.lessons || []).map((L, i) => ({ group: 'Lessons in this book', label: lessonTitle(L, i), sub: `pages ${L.from}–${L.to}${L.md ? '' : ' · not written yet'}`, ico: 'book', run: () => { curLesson = i; chat.reset(); openTab('learn'); renderLearn(); } }))
  .concat([{ group: 'Do', label: 'Go to page…', ico: 'search', run: () => { openTab('digitize'); $('#pageSel').focus(); } }, { group: 'Do', label: 'Back to the desk', ico: 'arrowL', run: () => { location.href = 'index.html'; } }]));
function renderLessonList() {
  const written = S.lessons.filter(l => l.md).length;
  $('#learnInfo').textContent = S.lessons.length ? `${S.lessons.length} lessons · ${written} written · ${S.lessons.filter(l => l.done).length} understood` : '';
  const chapters = [];
  S.lessons.forEach((L, i) => { const c = L.chapter || ''; if (!chapters.length || chapters[chapters.length - 1].name !== c) chapters.push({ name: c, items: [] }); chapters[chapters.length - 1].items.push(i); });
  const btn = i => { const L = S.lessons[i]; return `<button data-l="${i}" class="${i === curLesson ? 'active' : ''}">${L.done ? '&#10003; ' : L.md ? '' : '&#9675; '}${escapeHtml(lessonTitle(L, i))}<br><span class="small muted">pages ${L.from}-${L.to}</span></button>`; };
  $('#lessonList').innerHTML = !S.lessons.length ? '<p class="empty">No lessons yet.</p>' : chapters.length === 1
    ? chapters[0].items.map(btn).join('')
    : chapters.map(c => { const done = c.items.filter(i => S.lessons[i].done).length;
        return `<details ${c.items.includes(curLesson) ? 'open' : ''}><summary class="small"><b>${escapeHtml(c.name || 'Lessons')}</b> <span class="muted">${done}/${c.items.length}</span></summary>${c.items.map(btn).join('')}</details>`; }).join('');
  $('#lessonList').querySelectorAll('[data-l]').forEach(b => b.onclick = () => { curLesson = +b.dataset.l; chat.reset(); renderLearn(); });
}
// "From your notes": the original pages of the current lesson, tap to view full size.
const thumbCache = new Map();
async function pageThumb(i, w = 320) {
  const k = i + ':' + w;
  if (!thumbCache.has(k)) thumbCache.set(k, pageCanvas(PAGES[i], w).then(c => c.toDataURL('image/jpeg', w > 600 ? 0.88 : 0.75)));
  return thumbCache.get(k);
}
function renderNotesStrip(L) {
  const el = $('#lessonPages');
  if (!L || !PAGES.length) { el.classList.add('hidden'); return; }
  const idx = [];
  for (let n = L.from; n <= L.to && idx.length < 14; n++) idx.push(n - 1);
  el.classList.remove('hidden');
  el.innerHTML = `<div class="row"><div class="card-title" style="flex:1">From your notes</div><span class="small muted">pages ${L.from}–${L.to}${L.to - L.from + 1 > idx.length ? ` (first ${idx.length} shown)` : ''} &middot; tap to read</span></div>
    <div class="notes-strip">${idx.map(i => `<figure data-i="${i}"><img alt="Page ${i + 1}"><figcaption>p. ${i + 1}</figcaption></figure>`).join('')}</div>`;
  if (L.sources && L.sources.length) el.insertAdjacentHTML('beforeend', Web.html(L.sources));
  el.querySelectorAll('figure').forEach(f => {
    const i = +f.dataset.i;
    pageThumb(i).then(src => { const img = $('img', f); if (img) img.src = src; });
    f.onclick = () => {
      openLightbox.preview = k => pageThumb(idx[0] + k);   // the small version shows at once, the sharp one replaces it
      openLightbox(k => pageThumb(idx[0] + k, 1100), i - idx[0], L.to - L.from + 1, k => `Page ${idx[0] + k + 1} of ${PAGES.length} · ${PAGES[idx[0] + k].label}`);
    };
  });
}
function renderLearn() {
  if (!S.lessons.length && PAGES.length) buildLessonPlan();
  curLesson = Math.max(0, Math.min(curLesson, S.lessons.length - 1));
  renderLessonList();
  const L = S.lessons[curLesson];
  const closed = L && masteredKeys.has(lessonKey(L));
  viewer.finishLabel = !closed ? 'Take the mastery check' : curLesson < S.lessons.length - 1 ? 'Next lesson' : 'Go to test series';
  show('#lessonMastery', false);
  renderNotesStrip(L);
  if (L && !L.md) {
    const miss = pagesMissing(L);
    $('#lessonEmpty').innerHTML = `<h3 class="h">${escapeHtml(lessonTitle(L, curLesson))}</h3>
      <p class="muted">${L.chapter ? escapeHtml(L.chapter) + ' &middot; ' : ''}pages ${L.from}&ndash;${L.to}${miss ? ` &middot; I'll read ${miss} page${miss > 1 ? 's' : ''} first` : ''}</p>
      <button class="primary" id="teachThis">Teach me this ${icon('arrowR')}</button>`;
    show('#lessonEmpty'); show('#lessonView', false);
    $('#lessonReview') && $('#lessonReview').remove();
    $('#lessonHook').innerHTML = '';
    $('#teachThis').onclick = () => { const i = curLesson; runJob('Preparing lesson', async s => { await generateLesson(i, s); if (typeof TopicAnim !== 'undefined' && S.lessons[i] && S.lessons[i].md) TopicAnim.fresh.add(S.lessons[i].md); }, render); };
  } else {
    show('#lessonEmpty', false); show('#lessonView');
    viewer.set(L ? L.md : '', { done: !!(L && L.done) });
    $('#lessonReview') && $('#lessonReview').remove();
    // Top of the lesson: its exact topic animation (anim.js), then the optional analogy picture (hooks.js, off by default).
    $('#lessonHook').innerHTML = L && L.md ? '<div class="ta-slot"></div><div class="hook-slot"></div>' : '';
    if (L && L.md && typeof TopicAnim !== 'undefined') TopicAnim.mount($('#lessonHook .ta-slot'), { topic: lessonTitle(L, curLesson), md: L.md, anim: L.anim, isNew: TopicAnim.fresh.has(L.md), save: async a => { L.anim = a; await save(); } });
    if (L && L.md && typeof MemoryHook !== 'undefined') MemoryHook.mount($('#lessonHook .hook-slot'), { topic: lessonTitle(L, curLesson), md: L.md, hook: L.hook, save: async h => { L.hook = h; await save(); } });
    if (L && L.md) {
      $('#lessonView').insertAdjacentHTML('beforebegin', `<div id="lessonReview">${L.review ? reviewHtml(L.review) : `<div class="card fc-panel fc-none row"><span class="fc-ico">${icon('help')}</span><span style="flex:1"><b>Not fact-checked</b></span><button id="lessonFc">Fact-check</button></div>`}</div>`);
      if ($('#lessonFc')) $('#lessonFc').onclick = () => { const k = curLesson, LL = S.lessons[k]; runJob('Fact-checking the lesson', async s => { const fc = await factCheck(LL.md, { title: lessonTitle(LL, k), subject: LL.subject || '', material: sourceFor(LL), kind: 'book lesson', signal: s, onStage: t => jobLabel(`Fact-checking: ${t}`, s) }); LL.md = fc.md; LL.review = fc.review; await save(); }, render); };
      if (L.review) wireReview($('#lessonReview'), { items: () => L.review.items, md: () => L.md, setMd: md => { L.md = md; }, save: () => save(), rerender: render, subject: L.subject || '', title: lessonTitle(L, curLesson) });
    }
    if (L && L.md) {
      const i = curLesson;
      new MasteryCheck($('#lessonMastery'), {
        key: lessonKey(L), topic: lessonTitle(L, i), subject: L.subject,
        material: () => sourceFor(L).slice(0, 8000) + '\n\nLesson:\n' + L.md.slice(0, 4000), lessonMd: () => L.md,
        onPass: () => { masteredKeys.add(lessonKey(L)); L.done = true; save(); renderLessonList(); viewer.finishLabel = i < S.lessons.length - 1 ? 'Next lesson' : 'Go to test series'; viewer.render(); },
      }).render();
    }
  }
}

// ---------- questions found in the file (PYQ mode) ----------
const FOUND_SCHEMA = { type: 'object', required: ['questions'], properties: { questions: { type: 'array', items: {
  type: 'object', required: ['page', 'text'], properties: { page: { type: 'integer' }, number: { type: 'string' }, text: { type: 'string' } } } } } };
const LOOKS_LIKE_Q = /(\bQ\s*\.?\s*\d+|\bQuestion\s*\d+|^\s*\d{1,3}\s*[.)]\s+\S|\(\s*[A-Da-d]\s*\)|^\s*[A-D][.)]\s|which of the following|how many|what is the|consider the|find the|calculate|\?\s*$)/im;
$('#btnFindQ').onclick = () => {
  const from = Math.max(1, +$('#qFrom').value || 1), to = Math.min(PAGES.length, +$('#qTo').value || PAGES.length);
  const pages = S.pages.filter(p => p && p.md && p.n >= from && p.n <= to && LOOKS_LIKE_Q.test(p.md));
  if (!pages.length) { alert(digitizedCount() ? 'No question-like pages in that range (digitize it first if needed).' : 'Digitize the file first.'); return; }
  runJob('Finding questions', async signal => {
    const found = [];
    for (let i = 0; i < pages.length; i += 2) {
      const batch = pages.slice(i, i + 2);
      progress(i, pages.length, signal); jobLabel(`Scanning page ${batch[0].n}${batch[1] ? '-' + batch[1].n : ''} for questions (${i + 1}/${pages.length})`, signal);
      try {
        const j = parseJSON(await ollamaChat([
          { role: 'system', content: 'Extract every exam/practice question from these pages. For each, copy the COMPLETE question exactly, including all options (A-D), given data, code and figure descriptions, in Markdown. Do not solve. Skip theory text and answer keys. Return JSON; page = the page number it is on.' },
          { role: 'user', content: batch.map(p => `--- Page ${p.n} ---\n${p.md}`).join('\n\n').slice(0, 12000) },
        ], { signal, format: FOUND_SCHEMA, temperature: 0, onToken: (_, o) => live(o, signal) }));
        (j.questions || []).forEach(q => { if (q.text && q.text.trim().length > 15) found.push({ id: uid(), page: q.page || batch[0].n, number: q.number || '', text: q.text.trim(), solution: '' }); });
      } catch (e) { if (e.name === 'AbortError') throw e; }
      if (i % 10 === 0) { mergeFound(found, from, to); await save(); }
    }
    mergeFound(found, from, to);
    await save();
    // Questions marked with a GATE year (on the question or its page) also go to the PYQs tab.
    await addPYQs(found.map(q => { const pg = (S.pages[q.page - 1] || {}).md || ''; return { text: q.text, year: pyqYearOf(q.text) || (hasPyqMark(pg) ? pyqYearOf(pg) : ''), number: q.number, source: { kind: 'file', siteId: SITE_ID, site: meta.name, page: q.page } }; }).filter(q => q.year));
  }, render);
};
function mergeFound(found, from, to) {
  const old = new Map((S.questions || []).map(q => [q.text, q]));
  const keep = (S.questions || []).filter(q => q.page < from || q.page > to);
  S.questions = keep.concat(found.map(q => old.get(q.text) || q)).sort((a, b) => a.page - b.page);
}
async function solveFound(q, signal, verified, fromCheck) {
  const pageMd = (S.pages[q.page - 1] || {}).md || '';
  const hint = verified ? `\n\n(For you, not the student: the correct final answer, computed exactly, is ${verified}. Work every step carefully so your solution naturally arrives at it, rounded the way the question asks. Do not mention that you were given it.)` : '';
  q.solution = await ollamaChat([
    { role: 'system', content: `You are an expert GATE CS teacher solving a question for a student.\n${SOLVE_FORMAT}\nThe student is a beginner: avoid jargon and never skip a step.${langNote()}` },
    { role: 'user', content: `Question (from page ${q.page}):\n${q.text}${hint}\n\nFull page for context (figures/data):\n${pageMd.slice(0, 5000)}` },
  ], { signal, onToken: (_, o) => { const el = document.querySelector(`[data-sol="${q.id}"]`); if (el) el.innerHTML = renderMd(o); else live(o, signal); } });
  q.check = null; q.conf = null;
  if (fromCheck) { q.check = { ...fromCheck, agree: true, shown: String(verified) }; q.conf = { level: 'exact', votes: [], check: q.check }; }
  else if (verified) { q.check = { computed: verified, agree: true }; q.conf = { level: 'good', votes: [] }; }
  else {
    const a = await assessSolution(q.text, q.solution, signal, { onStep: t => jobLabel(t, signal) });
    q.check = a.check; q.conf = a;
    // The exact calculator is plain code: if it disagrees, rewrite the solution around its answer.
    if (a.check && a.check.solver && a.check.agree === false) { jobLabel('The exact calculator disagreed: rewriting the solution', signal); return solveFound(q, signal, String(a.check.computed), a.check); }
  }
  await save();
}
$('#btnSolveAll').onclick = () => runJob('Solving questions', async signal => {
  const todo = (S.questions || []).filter(q => !q.solution);
  for (let k = 0; k < todo.length; k++) {
    progress(k, todo.length, signal); jobLabel(`Solving question ${k + 1} of ${todo.length}`, signal);
    await solveFound(todo[k], signal);
  }
}, render);
const Q_PAGE = 30;
let qShown = Q_PAGE;
function renderQuestions() {
  if (!$('#qFrom').value) $('#qFrom').value = 1;
  if (!$('#qTo').value) $('#qTo').value = PAGES.length;
  const qs = S.questions || [];
  $('#qInfo').textContent = qs.length ? `${qs.length} questions found · ${qs.filter(q => q.solution).length} solved` : '';
  $('#qList').innerHTML = qs.slice(0, qShown).map((q, k) => `
    <div class="card"><div class="row"><b>Q${escapeHtml(q.number || k + 1)}</b><span class="small muted">page ${q.page}</span><span style="flex:1"></span>
      <button class="${q.solution ? 'link' : 'primary'}" data-solve="${q.id}">${q.solution ? 'Solve again' : 'Walk me through it'}</button>${q.solution ? `<button data-speak="${q.id}" title="Listen">${icon('speaker')}</button>` : ''}<button class="link" data-gopage="${q.page}">See the page</button></div>
      <div class="md">${renderMd(q.text)}</div>
      <details ${q.solution ? '' : 'class="hidden"'} ${q.check && q.check.agree === false ? 'open' : ''}><summary><b>Solution</b></summary><div class="md" data-sol="${q.id}">${renderMd(q.solution)}</div>
        <div data-cc="${q.id}">${confidenceHtml(q.conf)}${crossCheckHtml(q.check)}</div></details></div>`).join('')
    + (qs.length > qShown ? `<button id="qMore">Show more (${qs.length - qShown} left)</button>` : '')
    || '<div class="card"><p class="empty">No questions picked out yet. Tap "Find questions".</p></div>';
  if ($('#qMore')) $('#qMore').onclick = () => { qShown += Q_PAGE; renderQuestions(); };
  $('#qList').querySelectorAll('[data-solve]').forEach(b => b.onclick = () => {
    const q = qs.find(x => x.id === b.dataset.solve);
    const det = b.closest('.card').querySelector('details'); det.classList.remove('hidden'); det.open = true;
    runJob('Solving', s => solveFound(q, s), render);
  });
  $('#qList').querySelectorAll('[data-cc] .cc-fix').forEach(b => b.onclick = () => {
    const q = qs.find(x => x.id === b.closest('[data-cc]').dataset.cc);
    runJob('Re-explaining with the computed answer', s => solveFound(q, s, String(q.check.computed)), render);
  });
  $('#qList').querySelectorAll('[data-speak]').forEach(b => b.onclick = () => speak(qs.find(x => x.id === b.dataset.speak).solution));
  $('#qList').querySelectorAll('[data-gopage]').forEach(b => b.onclick = () => { curPage = +b.dataset.gopage; openTab('digitize'); });
}

// ---------- tests ----------
function lessonsInScope(scope) {
  const cur = S.lessons[curLesson];
  let list = S.lessons.map((L, i) => ({ L, i }));
  if (scope === 'lesson') list = list.filter(x => x.i === curLesson);
  else if (scope === 'chapter' && cur) list = list.filter(x => x.L.chapter === cur.chapter);
  return list.filter(x => sourceFor(x.L).length > 400);
}
function updateScopeInfo() {
  const scope = $('#tScope').value, list = lessonsInScope(scope), cur = S.lessons[curLesson];
  const where = scope === 'lesson' ? `lesson "${cur ? lessonTitle(cur, curLesson) : '-'}"` : scope === 'chapter' ? `chapter "${cur && cur.chapter || '-'}"` : 'the whole file';
  $('#scopeInfo').textContent = list.length ? `Covers ${where}: ${list.length} lesson section(s) with digitized pages.` : `Nothing digitized yet in ${where}. Digitize pages first (step 1).`;
}
$('#tScope').onchange = updateScopeInfo;
$('#btnGenTest').onclick = () => {
  const list = lessonsInScope($('#tScope').value);
  if (!list.length) { alert('Nothing to test yet: digitize the pages for this scope first.'); return; }
  const types = ['MCQ', 'MSQ', 'NAT'].filter(t => $('#t' + t).checked);
  if (!types.length) { alert('Pick at least one question type.'); return; }
  const total = Math.max(3, Math.min(65, +$('#qTotal').value || 10));
  // Spread questions evenly across the lessons in scope.
  const picks = list.length > total ? Array.from({ length: total }, (_, k) => list[Math.floor(k * list.length / total)]) : list;
  const counts = picks.map((_, k) => Math.floor(total / picks.length) + (k < total % picks.length ? 1 : 0));
  const scopeName = { lesson: 'lesson', chapter: 'chapter', all: 'full file' }[$('#tScope').value];
  const test = { id: uid(), name: `${meta.name} - Test ${S.tests.length + 1} (${scopeName})`, kind: 'pdf', created: new Date().toISOString(), questions: [] };
  runJob('Generating test', async signal => {
    for (let k = 0; k < picks.length; k++) {
      const { L, i } = picks[k];
      progress(test.questions.length, total, signal);
      const material = sourceFor(L).slice(0, 9000) + (L.md ? `\n\nLesson summary:\n${L.md.slice(0, 2500)}` : '');
      const t = await buildTest({ name: test.name, plan: [{ material, label: lessonTitle(L, i), subject: L.subject || '', count: counts[k], lesson: i }],
        types, diff: $('#qDiff').value, verify: $('#qVerify').checked, signal }).catch(e => { if (e.name === 'AbortError') throw e; return { questions: [] }; });
      test.questions.push(...t.questions);
      jobLabel(`${test.questions.length} of ${total} questions ready`, signal);
    }
  }, async () => {
    if (test.questions.length) { S.tests.push(test); await save(); }
    else alert('No questions were produced. Try again, or untick "Double-check answer keys".');
    render();
  });
};
function renderTests() {
  show('#testSetup', !runner);
  if (runner) return;
  updateScopeInfo();
  $('#testList').innerHTML = S.tests.length ? S.tests.map((t, k) => {
    const n = S.attempts.filter(a => a.testId === t.id).length;
    return `<div class="list-item"><div class="grow"><b>${escapeHtml(t.name)}</b><br><span class="muted">${t.questions.length} questions · ${testMarks(t)} marks · ${durationMin(t)} min · ${n} attempt(s)</span></div>
      <button class="primary" data-start="${k}">Start</button><button class="danger" data-deltest="${k}" title="Delete test">${icon('trash')}</button></div>`;
  }).join('') : '<p class="empty">No tests yet. Prepare one above.</p>';
  $('#testList').querySelectorAll('[data-start]').forEach(b => b.onclick = () => startTest(S.tests[+b.dataset.start]));
  $('#testList').querySelectorAll('[data-deltest]').forEach(b => b.onclick = () => { if (confirm('Delete this test?')) { S.tests.splice(+b.dataset.deltest, 1); save(); renderTests(); } });
}
function startTest(t) {
  show('#testSetup', false);
  runner = new TestRunner($('#testRun'), t, {
    onExit: () => { runner = null; $('#testRun').innerHTML = ''; renderTests(); },
    onSubmit: async attempt => {
      runner = null; $('#testRun').innerHTML = '';
      S.attempts.push(attempt); await save();
      await recordAttempt(SITE_ID, t, attempt);
      curAttempt = attempt.id; openTab('results');
      analyse(attempt);
    },
  });
}
function analyse(att) {
  const t = S.tests.find(x => x.id === att.testId);
  if (!t) return;
  runJob('Analysing your answers', async signal => {
    await analyzeAttempt(t, att, { signal, onToken: (_, o) => { const b = $('#attemptView .analysis-box'); if (b && curAttempt === att.id) b.innerHTML = renderMd(o); } });
    await save(); await patchAttemptErrors(att);
  }, render);
}

// ---------- results ----------
function renderResults() {
  $('#attemptList').innerHTML = S.attempts.length ? S.attempts.slice().reverse().map(a =>
    `<div class="list-item"><div class="grow"><b>${escapeHtml(a.testName)}</b> <span class="muted">${new Date(a.at).toLocaleString()}</span></div>
     <span class="pill">${a.score} / ${a.max}</span><button data-att="${a.id}" class="${a.id === curAttempt ? 'primary' : ''}">View</button></div>`).join('') : '<p class="empty">Take a test and your review shows up here.</p>';
  $('#attemptList').querySelectorAll('[data-att]').forEach(b => b.onclick = () => { curAttempt = b.dataset.att; renderResults(); });
  const att = S.attempts.find(a => a.id === curAttempt) || S.attempts[S.attempts.length - 1];
  if (!att) { $('#attemptView').innerHTML = ''; return; }
  curAttempt = att.id;
  const t = S.tests.find(x => x.id === att.testId);
  if (!t) { $('#attemptView').innerHTML = '<div class="card muted">The test for this attempt was deleted.</div>'; return; }
  renderAttempt($('#attemptView'), t, att, {
    onReanalyze: () => analyse(att), onReport: (q, reason) => reportQuestion(q, reason, SITE_ID),
    onRetest: qs => { const rt = { id: uid(), name: `Retest: ${qs.length} mistake${qs.length > 1 ? 's' : ''}`, kind: 'retest', created: new Date().toISOString(), questions: qs.map(q => ({ ...q, id: uid() })) }; S.tests.push(rt); save(); openTab('test'); startTest(rt); },
  });
}

// ---------- cheat sheet ----------
function section(md, name) {
  const m = String(md || '').match(new RegExp('^##\\s*' + name + '[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))', 'mi'));
  return m ? m[1].trim() : '';
}
function renderSheet() {
  let chapter = null;
  const parts = [];
  S.lessons.forEach((L, i) => {
    if (!L.md) return;
    const f = section(L.md, 'Key formulas'), t = section(L.md, 'Common GATE traps');
    if (!f && !t) return;
    if (L.chapter && L.chapter !== chapter) { chapter = L.chapter; parts.push(`## ${chapter}`); }
    parts.push(`### ${lessonTitle(L, i)}\n${f ? '**Formulas & facts**\n' + f + '\n' : ''}${t ? '\n**Traps**\n' + t : ''}`);
  });
  $('#sheet').innerHTML = parts.length ? renderMd(`# ${meta.name}: cheat sheet\n\n` + parts.join('\n\n')) : '<p class="empty">Learn a few lessons first. Their formulas and traps collect here.</p>';
}

// ---------- manage ----------
function renderManage() {
  $('#fileList').innerHTML = FILES.map(f => `<div class="list-item"><div class="grow">${escapeHtml(prettyName(displayName(f.name)))}</div><span class="muted">${f.pages} page(s)${f.outline ? ` · ${f.outline} bookmarks` : ''}</span></div>`).join('') || 'No files.';
}
async function addFiles(list) {
  try {
    for (const f of list) await Store.addFile(SITE_ID, await normalizeUpload(f));
    location.reload();
  } catch (e) { alert(e.message); }
}
$('#addIn').onchange = e => addFiles([...e.target.files]);
$('#addCam').onchange = e => addFiles([...e.target.files]);
$('#exportGo').onclick = async () => { try { await exportSite(SITE_ID); } catch (e) { alert(e.message); } };
$('#delSite').onclick = async () => {
  if (!confirm('Delete this whole study site (files, digitized pages, lessons, tests and results)? This cannot be undone.')) return;
  if (Job.ctl) Job.ctl.abort();
  await Store.deleteSite(SITE_ID);
  location.href = 'index.html#files';
};

// ---------- boot ----------
(async () => {
  if (!ID_RE.test(SITE_ID)) throw new Error('Missing or invalid site id.');
  await Store.init();
  Calib.load();
  PyqScan.start();
  ensureBusyUI();
  hydrateIcons();
  checkOllama($('#status'));
  meta = await Store.getMeta(SITE_ID);
  document.title = meta.name + ' - GATE Tutor';
  $('#title').textContent = meta.name;
  S = Object.assign({ pages: [], lessons: [], tests: [], attempts: [], questions: [] }, await Store.getData(SITE_ID));
  S.pages.forEach(p => { if (p && p.md && /vision/.test(p.via || '')) p.md = cleanTranscript(p.md); });
  const book = await Book.open(SITE_ID, f => { $('#title').textContent = `${meta.name} (opening ${f}…)`; });
  PAGES = book.pages; FILES = book.files; OUTLINE = book.outline;
  $('#title').textContent = meta.name;
  Reader.start();
  const qi = ((await Store.getHub()).queue || []).find(q => q.siteId === SITE_ID && !['done', 'cancelled'].includes(q.status));
  if (qi) { queueItemId = qi.id; queueState = { status: qi.status, k: qi.k || 0, total: qi.total || 0, error: qi.error }; }
  if (!S.lessons.length || S.lessons.some(l => l.chapter === undefined && !l.md)) buildLessonPlan();
  // Topics list: add lessons written before it existed; remember which lessons are closed.
  const hub = await Store.getHub(), known = new Set((hub.covered || []).map(e => e.key));
  for (const [i, L] of S.lessons.entries()) if (L.md && !known.has(lessonKey(L))) await recordCovered(L.md, lessonSource(L, i));
  masteredKeys = new Set(((await Store.getHub()).covered || []).filter(e => e.mastered).map(e => e.key));
  // Formula book: scan pages read before it existed (or since the last scan).
  if ((S.formulaScan || 0) !== digitizedCount()) {
    const subj = await siteSubject(SITE_ID);
    await collectMany(S.pages.map((p, i) => p && p.md ? { md: p.md, subject: lessonSubject(p.md) || subj,
      source: { kind: 'page', label: `${prettyName(meta.name)} p.${i + 1}`, href: `site.html?id=${SITE_ID}&page=${i + 1}#digitize` } } : null).filter(Boolean));
    S.formulaScan = digitizedCount(); save();
  }
  if (params.get('page')) curPage = +params.get('page');
  if (params.get('lesson')) curLesson = +params.get('lesson');
  if (params.get('mastery')) setTimeout(() => { const m = $('#lessonMastery'); if (m && !m.classList.contains('hidden')) m.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 1200);
  let t = location.hash.slice(1);
  if (!['digitize', 'learn', 'questions', 'test', 'results', 'sheet', 'manage'].includes(t)) {
    t = 'digitize';
    if (S.lessons.some(l => l.md)) t = 'learn';
    if (S.attempts.length) t = 'results';
  }
  openTab(t);
})().catch(e => { console.error(e); $('#title').textContent = 'Could not open this site: ' + e.message; });

// ---------- tutor chat contexts in a study space ----------
TutorChat.provide(() => {
  const list = [], L = S.lessons[curLesson], p = S.pages[curPage - 1];
  const lesson = L && { id: `${SITE_ID}:lesson:${L.from}-${L.to}`, label: L.auto ? `This lesson (pages ${L.from}–${L.to})` : `This lesson: ${lessonTitle(L, curLesson)} (pages ${L.from}–${L.to})`,
    text: () => `Source pages:\n${sourceFor(L)}`.slice(0, 16000) + (L.md ? `\n\nLesson:\n${L.md.slice(0, 5000)}` : '') };
  const page = p && p.md && { id: `${SITE_ID}:page:${curPage}`, label: `This page (page ${curPage})`, text: () => `--- Page ${curPage} ---\n${p.md}` };
  const order = tab === 'digitize' ? [page, lesson] : [lesson, page];
  order.forEach(c => c && list.push(c));
  if (L && L.chapter && !L.auto) list.push({ id: `${SITE_ID}:chapter:${L.chapter}`, label: `This chapter: ${L.chapter}`,
    text: () => S.lessons.filter(x => x.chapter === L.chapter).map(x => sourceFor(x)).join('\n\n').slice(0, 22000) });
  list.push({ id: `${SITE_ID}:book`, label: `The whole file (I find the right pages)`, text: q => {
    const idx = relevantPages(S.pages, q);
    return idx.length ? `Most relevant pages for this question:\n\n` + idx.map(i => `--- Page ${i + 1} ---\n${S.pages[i].md}`).join('\n\n') : '';
  } });
  return list;
});
TutorChat.linkify = html => html.replace(/\(p(?:age|g)?\.?\s*(\d{1,4})\)/gi, (m, n) => `<a href="#" data-page="${n}">${m}</a>`);
document.addEventListener('click', e => {
  const a = e.target.closest('#chatDrawer a[data-page]');
  if (!a) return;
  e.preventDefault(); curPage = +a.dataset.page; openTab('digitize'); window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('#lessonChatOpen').onclick = () => { const L = S.lessons[curLesson]; TutorChat.open(L ? `${SITE_ID}:lesson:${L.from}-${L.to}` : undefined); };
TutorChat.mount();

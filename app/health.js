// Data health check (Settings): finds broken or half-finished entries and offers safe repairs.
// Every repair keeps what's useful (e.g. of two copies of a PYQ, the one with a masterclass), and removed
// items are listed so nothing disappears silently. Disk use per book comes from the server (/api/sizes).

const Health = {
  async scan() {
    const h = await Store.getHub(), sites = await Store.listSites(), ids = new Set(sites.map(s => s.id));
    let sizes = { sites: [], hub: 0 };
    try { sizes = await (await fetch('/api/sizes')).json(); } catch {}
    const issues = [];
    const add = (id, title, items, fix, note = '') => { if (items.length) issues.push({ id, title, items, fix, note }); };

    // Lessons
    add('topics-short', 'Topic lessons that are empty or cut off', Object.entries(h.topics || {}).filter(([, t]) => !t.md || plainText(t.md).length < 300).map(([k, t]) => ({ key: k, label: t.title || k })), 'rewrite',
      'Usually a lesson that was stopped while being written. "Rewrite" teaches it again.');
    // PYQs
    const pyqs = h.pyqs || [];
    const groups = {}; pyqs.forEach(p => { const k = pyqKey(p.text); (groups[k] = groups[k] || []).push(p); });
    add('pyq-dup', 'PYQs saved twice', Object.values(groups).filter(g => g.length > 1).map(g => ({ ids: g.map(p => p.id), label: `GATE ${g[0].year || '?'}: ${plainText(g[0].text).replace(/\s+/g, ' ').slice(0, 80)}… (${g.length} copies)` })), 'dedupe',
      'Keeps the copy with the most work (masterclass, checked answer) and merges the rest into it.');
    add('pyq-short', 'PYQs with too little text to be a question', pyqs.filter(p => plainText(p.text).trim().length < 40).map(p => ({ id: p.id, label: `GATE ${p.year || '?'}: "${plainText(p.text).trim().slice(0, 60)}"` })), 'remove-pyq',
      'Scanner fragments. Use "Find the missing ones" on the paper to re-read its page if a real question was lost.');
    add('pyq-opts', 'PYQs that mention options but have fewer than 2', pyqs.filter(p => /\(\s*[A-D]\s*\)/.test(p.text) && Object.keys(optionsIn(fixScanMarks(p.text))).length < 2).map(p => ({ id: p.id, label: `GATE ${p.year || '?'}${pyqNum(p) ? ' Q.' + pyqNum(p) : ''}: ${plainText(p.text).replace(/\s+/g, ' ').slice(0, 70)}…` })), '',
      'The options were not read cleanly, so these can\'t be used in paper mode. Open the source page and use "Look again at this page", then "Find the missing ones".');
    const label = p => `GATE ${p.year || '?'}${pyqNum(p) ? ' Q.' + pyqNum(p) : ''}: ${((p.garble || {}).issues || [])[0] || 'looks misread'}`;
    add('pyq-check', 'PYQs that need checking (text looks misread)', pyqs.filter(p => p.needsCheck).map(p => ({ id: p.id, pyq: p.id, label: label(p) })), '',
      'Left out of paper mode and not taught until fixed. Open one and use "Edit question" to correct it (or "It\'s correct as it is").');
    add('pyq-reread', 'PYQs waiting to be re-read carefully', (h.pyqReread || []).map(r => pyqs.find(p => p.id === r.id)).filter(Boolean).map(p => ({ id: p.id, pyq: p.id, label: label(p) })), '',
      'Their pages are read again at high resolution in the background; any that still look wrong move to "need checking".');
    add('pyq-nosort', 'PYQs without a subject or year', pyqs.filter(p => !p.year || !p.subject || p.subject === 'Unsorted').map(p => ({ id: p.id, label: `${p.year ? 'GATE ' + p.year : 'No year'} · ${p.subject || 'no subject'}: ${plainText(p.text).replace(/\s+/g, ' ').slice(0, 60)}…` })), '',
      'They still work, but are harder to find and can\'t go into a full paper without a year.');
    add('pyq-half', 'Masterclasses left half-written', pyqs.filter(p => (p.parts || []).length > 0 && (p.parts || []).length < 3).map(p => ({ id: p.id, label: `GATE ${p.year || '?'}${pyqNum(p) ? ' Q.' + pyqNum(p) : ''} (${p.parts.length} of 3 parts)` })), 'night',
      'Opening the PYQ continues where it stopped, or tick "Write PYQ masterclasses ahead" for the Night shift.');
    // Practice data
    const badQ = q => !q || !q.question || (q.type !== 'NAT' && ((q.options || []).length < 2 || !(q.correct || []).length && !q.mta)) || (q.type === 'NAT' && !isFinite(q.nat_min));
    add('mistake-broken', 'Mistakes whose question can\'t be graded', (h.mistakes || []).filter(m => badQ(m.q)).map(m => ({ id: m.id, label: plainText((m.q || {}).question || '(no question)').replace(/\s+/g, ' ').slice(0, 80) })), 'remove-mistake',
      'They would always mark you wrong in reviews. Removing them doesn\'t count them as conquered.');
    add('card-empty', 'Flashcards with an empty side', (h.cards || []).filter(c => !plainText(c.front || '').trim() || !plainText(c.back || '').trim()).map(c => ({ id: c.id, label: plainText(c.front || c.back || '(empty)').slice(0, 80) })), 'remove-card');
    add('formula-empty', 'Formulas with no formula text', (h.formulas || []).filter(f => !String(f.tex || '').trim()).map(f => ({ id: f.id, label: f.name || f.note || '(no name)' })), 'remove-formula');
    // References to books that no longer exist
    add('orphans', 'Leftovers from deleted books', [
      ...(h.queue || []).filter(q => !ids.has(q.siteId)).map(q => ({ kind: 'queue', id: q.id, label: `Reading queue: ${q.name || q.siteId}` })),
      ...(h.pyqScan || []).filter(x => !ids.has(x.siteId)).map(x => ({ kind: 'pyqScan', id: `${x.siteId}:${x.page}`, label: `PYQ scan waiting: ${x.name || x.siteId} p.${x.page}` })),
      ...Object.keys(h.pyqSources || {}).filter(id => !ids.has(id)).map(id => ({ kind: 'pyqSources', id, label: `Upload record: ${(h.pyqSources[id] || {}).name || id}` })),
      ...(h.covered || []).filter(e => e.source && e.source.kind === 'lesson' && e.source.siteId && !ids.has(e.source.siteId)).map(e => ({ kind: 'covered', id: e.key, label: `Topic list entry: ${e.topic} (its book was deleted)` })),
    ], 'clean-orphans', 'Safe to remove: they point to books that are gone. Topics you studied from a deleted book stay in "My topics" unless you remove them here.');
    // Disk
    const known = new Set(sites.map(s => s.id));
    const disk = (sizes.sites || []).map(s => ({ ...s, name: ({ _images: 'Memory-hook pictures' })[s.id] || (sites.find(x => x.id === s.id) || {}).name || '(no name: folder without a book record)', system: s.id.startsWith('_'), orphan: !known.has(s.id) && !s.id.startsWith('_') })).sort((a, b) => b.bytes - a.bytes);
    const hubBytes = sizes.hub || new Blob([JSON.stringify(h)]).size;
    return { issues, disk, hubBytes, at: new Date().toISOString() };
  },
  async fix(issue) {
    const ids = new Set(issue.items.map(i => i.id));
    if (issue.fix === 'rewrite') { for (const it of issue.items) { teachTopic(H.topics[it.key] ? H.topics[it.key].title : it.label, { force: true }); break; } return 'Rewriting the first one now; run the check again for the rest.'; }
    if (issue.fix === 'night') { await updateHub(h => { h.night = { on: true, tasks: { verify: true, facts: true, ...((h.night || {}).tasks || {}), master: true } }; }); return 'The Night shift will finish them while you\'re away.'; }
    await updateHub(h => {
      if (issue.fix === 'dedupe') for (const it of issue.items) {
        const g = (h.pyqs || []).filter(p => it.ids.includes(p.id));
        const keep = g.slice().sort((a, b) => ((b.parts || []).length - (a.parts || []).length) || (!!b.answer - !!a.answer) || (b.text.length - a.text.length))[0];
        for (const p of g) if (p !== keep) { for (const f of ['year', 'set', 'number', 'materialKey', 'officialKey', 'concept']) if (!keep[f] && p[f]) keep[f] = p[f]; if (!keep.answer && p.answer) keep.answer = p.answer; }
        h.pyqs = h.pyqs.filter(p => p === keep || !it.ids.includes(p.id));
        h.mistakes.forEach(m => { if (m.pyqId && it.ids.includes(m.pyqId)) m.pyqId = keep.id; });
      }
      if (issue.fix === 'remove-pyq') h.pyqs = (h.pyqs || []).filter(p => !ids.has(p.id));
      if (issue.fix === 'remove-mistake') h.mistakes = (h.mistakes || []).filter(m => !ids.has(m.id));
      if (issue.fix === 'remove-card') h.cards = (h.cards || []).filter(c => !ids.has(c.id));
      if (issue.fix === 'remove-formula') h.formulas = (h.formulas || []).filter(f => !ids.has(f.id));
      if (issue.fix === 'clean-orphans') {
        const of = k => new Set(issue.items.filter(i => i.kind === k).map(i => i.id));
        const q = of('queue'), ps = of('pyqScan'), src = of('pyqSources'), cov = of('covered');
        h.queue = (h.queue || []).filter(x => !q.has(x.id));
        h.pyqScan = (h.pyqScan || []).filter(x => !ps.has(`${x.siteId}:${x.page}`));
        for (const id of src) if (h.pyqSources) delete h.pyqSources[id];
        h.covered = (h.covered || []).filter(e => !cov.has(e.key));
      }
      h.healthLog = (h.healthLog || []).concat([{ at: new Date().toISOString(), fix: issue.title, n: issue.items.length, removed: issue.items.map(i => i.label).slice(0, 50) }]).slice(-30);
    });
    announce({ type: 'pyqs' });
    return `Fixed: ${issue.title.toLowerCase()} (${issue.items.length}).`;
  },
};
async function renderHealth(run = false) {
  const el = $('#healthOut');
  if (!el) return;
  if (!run && !Health.last) { el.innerHTML = '<p class="small muted">Not checked yet in this session.</p>'; return; }
  if (run) { el.innerHTML = '<p class="small muted">Checking everything&hellip;</p>'; Health.last = await Health.scan(); }
  const r = Health.last, total = r.disk.reduce((a, s) => a + s.bytes, 0);
  const FIX = { rewrite: 'Rewrite', dedupe: 'Merge the copies', 'remove-pyq': 'Remove them', 'remove-mistake': 'Remove them', 'remove-card': 'Remove them', 'remove-formula': 'Remove them', 'clean-orphans': 'Clean up', night: 'Queue for Night shift' };
  el.innerHTML = `${r.issues.length ? r.issues.map((it, i) => `<div class="pyq-up"><div class="row"><b style="flex:1"${it.note ? ` title="${escapeHtml(it.note)}"` : ''}>${escapeHtml(it.title)} <span class="pill">${it.items.length}</span></b>${it.fix ? `<button class="small" data-hfix="${i}">${FIX[it.fix]}</button>` : ''}</div>
      
      ${it.note && it.id.startsWith('pyq-') && it.items.some(x => x.pyq) ? `<p class="small muted">${escapeHtml(it.note)}</p>` : ''}
      <details${it.id === 'pyq-check' ? ' open' : ''}><summary class="small">Show</summary><ul class="small">${it.items.slice(0, 40).map(x => `<li>${x.pyq ? `<a href="#" data-hpyq="${escapeHtml(x.pyq)}">${escapeHtml(x.label)}</a>` : escapeHtml(x.label)}</li>`).join('')}${it.items.length > 40 ? `<li>… and ${it.items.length - 40} more</li>` : ''}</ul></details></div>`).join('')
    : `<p class="small" style="color:var(--green)">${icon('check')} Everything looks healthy.</p>`}
    <div class="card-title" style="margin-top:14px">Disk use</div>
    <p class="small muted">Books and uploads: ${fmtSize(total)} · your progress file: ${fmtSize(r.hubBytes)}.</p>
    ${r.disk.slice(0, 12).map(s => barHtml(`${prettyName(s.name)}${s.orphan ? ' (not linked to any book)' : ''}`, s.bytes, Math.max(1, r.disk[0].bytes), s.system ? fmtSize(s.bytes) : `${fmtSize(s.bytes)} · ${s.files} file${s.files === 1 ? '' : 's'}`)).join('')}
    <p class="small muted" style="margin-top:8px">Checked ${relDay(r.at)}</p>`;
  el.querySelectorAll('[data-hpyq]').forEach(a => a.onclick = e => { e.preventDefault(); openTab('pyq'); openPyq(a.dataset.hpyq); });
  el.querySelectorAll('[data-hfix]').forEach(b => b.onclick = async () => {
    const it = r.issues[+b.dataset.hfix];
    if (/^remove|clean|dedupe/.test(it.fix) && !confirm(`${FIX[it.fix]}: ${it.items.length} item${it.items.length > 1 ? 's' : ''}? They're listed under "Show".`)) return;
    b.disabled = true;
    const msg = await Health.fix(it);
    await refreshHub(); toast(msg, 'ok'); renderHealth(true);
  });
}
document.addEventListener('click', e => { if (e.target.closest('#healthGo')) renderHealth(true); });

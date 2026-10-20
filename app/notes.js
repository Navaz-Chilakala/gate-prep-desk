// My notes: your own points, per subject > topic > subtopic. Starts from the GATE syllabus plus what
// you've studied; you can add, rename and remove anything. Autosaves, mirrors to "My GATE notes.md",
// and the tutor reads matching notes when it teaches or answers.

// hub.notes = { [subject]: [{ id, name, text, from, subs: [{ id, name, text }] }] }
// hub.notesRemoved = { [subject]: ['topic', 'topic>subtopic', ...] } (lower case): names you removed or renamed
// away from, so the syllabus and your lessons don't add them back. Using a name again brings it back.
const noteKey = (topic, sub) => (sub == null ? topic : topic + '>' + sub).toLowerCase();
function seedNotes(h, subject) {
  h.notes = h.notes || {};
  const list = h.notes[subject] = h.notes[subject] || [];
  const gone = new Set((h.notesRemoved || {})[subject] || []);
  const has = name => list.find(t => t.name.toLowerCase() === name.toLowerCase());
  // Tidy: drop empty subtopics that were only generic lesson-step names.
  list.forEach(t => { t.subs = t.subs.filter(s => s.text.trim() || !(GENERIC_STEP.test(s.name) || GENERIC_TERM.test(s.name))); });
  const syl = SYLLABUS.find(s => s.subject === subject);
  if (syl) syl.topics.forEach(t => { if (!has(t) && !gone.has(noteKey(t))) list.push({ id: uid(), name: t, text: '', from: 'syllabus', subs: [] }); });
  (h.covered || []).filter(e => e.subject === subject).forEach(e => {
    let t = has(e.topic);
    if (!t && gone.has(noteKey(e.topic))) return;
    if (!t) { t = { id: uid(), name: e.topic, text: '', from: 'studied', subs: [] }; list.push(t); }
    (e.subtopics || []).forEach(st => { if (!gone.has(noteKey(t.name, st.name)) && !t.subs.some(x => x.name.toLowerCase() === st.name.toLowerCase())) t.subs.push({ id: uid(), name: st.name, text: '' }); });
  });
  return list;
}
// Looser than the "already covered" check: notes help even when only part of the question matches.
function noteMatches(query, names) {
  const q = topicTokens(query), same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
  return names.some(n => {
    const c = topicTokens(n);
    const shared = c.filter(x => q.some(w => same(w, x))).length;
    return shared >= 2 || (shared >= 1 && shared / c.length >= 0.5);
  });
}
function notesWritten(list) { return (list || []).reduce((n, t) => n + (t.text.trim() ? 1 : 0) + t.subs.filter(s => s.text.trim()).length, 0); }

// Your notes that match a question/topic, as text for the tutor ('' if none).
function myNotesFor(query, notes) {
  const out = [];
  for (const [subject, list] of Object.entries(notes || {})) for (const t of list) {
    const parts = [t.text.trim() ? `${t.name}:\n${t.text.trim()}` : ''].concat(t.subs.filter(s => s.text.trim()).map(s => `${t.name} > ${s.name}:\n${s.text.trim()}`)).filter(Boolean);
    if (!parts.length) continue;
    if (!query || noteMatches(query, [t.name].concat(t.subs.map(s => s.name)))) out.push(`[${subject}] ${parts.join('\n\n')}`);
  }
  return out.join('\n\n').slice(0, 8000);
}
function notesMarkdown(notes) {
  const out = ['# My GATE notes', `_Updated ${new Date().toLocaleString()}_`, ''];
  const order = SUBJECTS.concat(['Other']);
  Object.keys(notes || {}).sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach(subject => {
    const list = (notes[subject] || []).filter(t => t.text.trim() || t.subs.some(s => s.text.trim()));
    if (!list.length) return;
    out.push(`## ${subject}`, '');
    list.forEach(t => {
      out.push(`### ${t.name}`, '');
      if (t.text.trim()) out.push(t.text.trim(), '');
      t.subs.filter(s => s.text.trim()).forEach(s => out.push(`#### ${s.name}`, '', s.text.trim(), ''));
    });
  });
  return out.join('\n');
}
let notesSyncTimer = null;
function syncNotesFile() {
  clearTimeout(notesSyncTimer);
  notesSyncTimer = setTimeout(async () => {
    if (Store.mode !== 'server') return;
    try { const h = await Store.getHub(); await fetch('/api/notes-file', { method: 'PUT', body: notesMarkdown(h.notes) }); } catch {}
  }, 1500);
}

// ---------- the tab ----------
const NotesUI = {
  subject: SUBJECTS[0], q: '',
  open: new Set(),   // topics you've expanded stay expanded while you work
  seenOpen: new Set(),
  async render() {
    let list;
    await this.flush();
    await updateHub(h => { list = seedNotes(h, this.subject); });
    const h = await Store.getHub();
    this.list = h.notes[this.subject];
    this.removed = new Set((h.notesRemoved || {})[this.subject] || []);
    // First visit to a subject: open the topics that already have your notes.
    if (!this.seenOpen.has(this.subject)) { this.seenOpen.add(this.subject); this.list.forEach(t => { if (t.text.trim() || t.subs.some(s => s.text.trim())) this.open.add(t.id); }); }
    $('#nSubjects').innerHTML = SUBJECTS.map(s => { const n = notesWritten((h.notes || {})[s]); return `<button data-s="${escapeHtml(s)}" class="${s === this.subject ? 'active' : ''}">${escapeHtml(s)}${n ? ` <span class="pill">${n}</span>` : ''}</button>`; }).join('');
    $('#nSubjects').querySelectorAll('[data-s]').forEach(b => b.onclick = () => { this.subject = b.dataset.s; this.render(); });
    $('#nTitle').textContent = this.subject;
    this.paint();
  },
  paint() {
    const q = this.q.toLowerCase();
    const match = t => !q || (t.name + ' ' + t.text + ' ' + t.subs.map(s => s.name + ' ' + s.text).join(' ')).toLowerCase().includes(q);
    const shown = this.list.filter(match);
    $('#nList').innerHTML = shown.length ? shown.map(t => `
      <details class="card n-topic" data-t="${t.id}" ${this.open.has(t.id) || q ? 'open' : ''}>
        <summary class="row"><b class="n-name" style="flex:1">${escapeHtml(t.name)}</b>
          ${t.from === 'studied' ? '<span class="pill ok">studied</span>' : ''}<span class="small muted">${notesWritten([t]) || ''}</span>
          <button class="link n-ren" title="Rename">${icon('pencil')}</button><button class="link danger n-del" title="Remove topic">${icon('trash')}</button></summary>
        ${this.noteBox(t, 'Your points on this topic')}
        <div class="n-subs">${t.subs.map(s => `<div class="n-sub" data-s="${s.id}"><div class="row"><span class="n-sname" style="flex:1">${escapeHtml(s.name)}</span>
          <button class="link n-sren" title="Rename">${icon('pencil')}</button><button class="link danger n-sdel" title="Remove subtopic">${icon('trash')}</button></div>${this.noteBox(s, 'Your points')}</div>`).join('')}</div>
        <button class="link n-addsub">${icon('plus')} Add a subtopic</button>
      </details>`).join('') : '<div class="card"><p class="empty">Nothing matches that.</p></div>';
    this.wire();
  },
  noteBox(item, placeholder) {
    return `<div class="n-note md ${item.text.trim() ? '' : 'empty-note'}" data-id="${item.id}" tabindex="0" title="Click to edit">${item.text.trim() ? renderMd(item.text) : `<span class="muted">${placeholder}…</span>`}</div>`;
  },
  find(id) { for (const t of this.list) { if (t.id === id) return t; const s = t.subs.find(x => x.id === id); if (s) return s; } return null; },
  // Typing waits 600 ms before saving; adding, renaming and removing save at once (now = true).
  // Anything still waiting is saved before the tab re-reads the hub and when the window is hidden or closed.
  save(now) {
    clearTimeout(this._t);
    const subject = this.subject, list = JSON.parse(JSON.stringify(this.list)), removed = [...this.removed];
    this._pending = async () => { this._pending = null; await updateHub(h => { h.notes = h.notes || {}; h.notes[subject] = list; (h.notesRemoved = h.notesRemoved || {})[subject] = removed; }); syncNotesFile(); };
    if (now) return this.flush();
    this._t = setTimeout(() => this.flush(), 600);
  },
  flush() { clearTimeout(this._t); return this._pending ? this._pending() : Promise.resolve(); },
  forget(key) { this.removed.add(key); },
  remember(key) { this.removed.delete(key); },
  edit(box) {
    const item = this.find(box.dataset.id);
    if (!item || box.querySelector('textarea')) return;
    box.classList.remove('empty-note');
    box.innerHTML = `<textarea rows="4" placeholder="- one point per line&#10;- $formulas$ work, so do \`\`\`mermaid diagrams">${escapeHtml(item.text)}</textarea><div class="small muted">Saved as you type · click outside to finish</div>`;
    const ta = $('textarea', box);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(90, ta.scrollHeight + 4) + 'px'; };
    grow(); ta.focus();
    ta.oninput = () => { item.text = ta.value; grow(); this.save(); };
    // Close the editor only after the click that took focus away has landed; closing at once shifts
    // the layout and the click (say on "Add a subtopic") would hit empty space.
    ta.onblur = () => setTimeout(() => { if (box.isConnected && document.activeElement !== ta) { box.outerHTML = this.noteBox(item, 'Your points'); this.wire(); } }, 250);
  },
  // Inline text box (no pop-up dialogs, which app windows can block). Enter saves, Esc cancels.
  ask(anchor, value, placeholder, done) {
    const box = document.createElement('div');
    box.className = 'n-ask row';
    box.innerHTML = `<input type="text" placeholder="${escapeHtml(placeholder)}" style="flex:1;min-width:180px"><button class="primary">Save</button><button class="link">Cancel</button>`;
    anchor.after(box);
    const inp = $('input', box);
    inp.value = value || ''; inp.focus(); inp.select();
    const finish = ok => { const v = inp.value.trim(); box.remove(); if (ok && v) done(v); };
    $('.primary', box).onclick = () => finish(true);
    $('.link', box).onclick = () => finish(false);
    inp.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  },
  wire() {
    const root = $('#nList');
    root.querySelectorAll('.n-note').forEach(b => { b.onclick = () => this.edit(b); b.onkeydown = e => { if (e.key === 'Enter' && !b.querySelector('textarea')) { e.preventDefault(); this.edit(b); } }; });
    root.querySelectorAll('.n-topic').forEach(d => {
      const t = this.list.find(x => x.id === d.dataset.t);
      d.ontoggle = () => { if (d.open) this.open.add(t.id); else this.open.delete(t.id); };
      $('.n-ren', d).onclick = e => { e.preventDefault(); d.open = true; this.ask($('summary', d), t.name, 'Topic name', v => { this.forget(noteKey(t.name)); this.remember(noteKey(v)); t.name = v; this.save(true); this.paint(); }); };
      $('.n-del', d).onclick = e => { e.preventDefault(); this.remove(d, `"${t.name}" removed.`, () => { this.forget(noteKey(t.name)); this.list.splice(this.list.indexOf(t), 1); }, i => { this.remember(noteKey(t.name)); this.list.splice(i, 0, t); }, this.list.indexOf(t)); };
      $('.n-addsub', d).onclick = e => this.ask(e.currentTarget, '', 'New subtopic name, then Enter', v => {
        const s = { id: uid(), name: v, text: '' }; this.remember(noteKey(t.name, v)); t.subs.push(s); this.save(true); this.paint();
        setTimeout(() => { const b = $(`.n-note[data-id="${s.id}"]`); b && this.edit(b); }, 50);
      });
      d.querySelectorAll('.n-sub').forEach(sd => {
        const s = t.subs.find(x => x.id === sd.dataset.s);
        $('.n-sren', sd).onclick = () => this.ask($('.row', sd), s.name, 'Subtopic name', v => { this.forget(noteKey(t.name, s.name)); this.remember(noteKey(t.name, v)); s.name = v; this.save(true); this.paint(); });
        $('.n-sdel', sd).onclick = () => this.remove(sd, `"${s.name}" removed.`, () => { this.forget(noteKey(t.name, s.name)); t.subs.splice(t.subs.indexOf(s), 1); }, i => { this.remember(noteKey(t.name, s.name)); t.subs.splice(i, 0, s); }, t.subs.indexOf(s));
      });
    });
  },
  addTopic() {
    const anchor = $('#nAdd').closest('.card');
    if (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('n-ask')) return;
    this.ask(anchor, '', `New topic in ${this.subject}, then Enter`, v => {
      const t = { id: uid(), name: v, text: '', from: 'mine', subs: [] };
      this.remember(noteKey(v)); this.list.unshift(t); this.open.add(t.id); this.save(true); this.paint();
      setTimeout(() => { const b = $(`.n-note[data-id="${t.id}"]`); b && this.edit(b); }, 50);
    });
  },
  // Remove with an Undo toast instead of a "Are you sure?" pop-up.
  remove(el, msg, doRemove, undo, index) {
    doRemove(); this.save(true); this.paint();
    toastUndo(msg, () => { undo(index); this.save(true); this.paint(); });
  },

  // ---------- scan handwritten notes ----------
  // Each photo: very detailed reading (multi-pass), then rewritten into clean, structured notes that keep
  // every point, then filed (subject/topic suggested). You review before it's saved.
  scans: [],
  async scan(files) {
    files = [...files]; if (!files.length) return;
    const box = $('#nScan');
    runJob('Scanning your notes', async signal => {
      for (let i = 0; i < files.length; i++) {
        const name = files[i].name || `Photo ${i + 1}`;
        const card = { id: uid(), name, stage: 'Starting', raw: '', md: '', subject: '', topic: '' };
        this.scans.push(card); this.paintScans();
        const stage = t => { card.stage = t; jobLabel(`${name} (${i + 1} of ${files.length}): ${t}`, signal); this.paintScans(); };
        const canvas = await blobToCanvas(await normalizeUpload(files[i]), 2400);
        const r = await readImage(canvas, { label: name, signal, detailed: true, onStage: stage, onToken: (_, o) => live(o, signal) });
        card.raw = r.md;
        stage('Turning it into clean, structured notes');
        // Only restructure: these are YOUR notes. If the model adds content (output grows a lot), redo it more
        // strictly, and if it still adds, keep the exact transcription.
        const tidy = strict => ollamaChat([
          { role: 'system', content: `You format a student's own handwritten GATE CS notes into clean Markdown. You are a typesetter, not a teacher.
STRICT RULES:
- Keep every point, value, example and formula, in the same order. Drop nothing.
- ADD NOTHING: no definitions, explanations, examples, introductions or summaries that are not already in the notes. Every sentence of your output must come from the notes.
- Allowed changes only: expand abbreviations ("excl" → "exclusion", "algo" → "algorithm", "no." → "number"), fix spelling, and organise: a "##" title, "###" for the parts the notes already have, bullets/numbered steps as written, a Markdown table where the notes are tabular, **bold** for terms the notes emphasise.
- A flow written with arrows (A → B → C) or a "Figure" of a flow, tree, graph or state machine may also be drawn as a \`\`\`mermaid diagram, kept next to the original line.
- Keep [unclear] markers exactly where they are.${strict ? '\n- Your output must be about the same length as the input. Short notes stay short.' : ''}${WRITING_RULES}
Output only the notes.` },
          { role: 'user', content: r.md.slice(0, 9000) },
        ], { signal, maxTokens: 4000, temperature: 0, onToken: (_, o) => { card.md = o; this.paintScans(); } });
        const words = s => plainText(s).replace(/```mermaid[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length;
        const rawWords = words(r.md);
        let md = cleanTranscript(await tidy(false));
        if (words(md) > rawWords * 1.5 + 25) { stage('Tidying more strictly (it added text)'); md = cleanTranscript(await tidy(true)); }
        card.added = words(md) > rawWords * 1.5 + 25;
        // Nothing may go missing: every formula/expression in the reading must still be in the clean version.
        const norm = s => String(s).replace(/\\(?:rightarrow|to|Rightarrow|implies)/g, '>').replace(/\\[a-zA-Z]+/g, '').replace(/[^A-Za-z0-9>=<+\-*/]/g, '').toLowerCase();
        const cleanN = norm(md);
        card.missing = [...r.md.matchAll(/\$\$?([^$]+?)\$\$?/g)].map(m => m[1]).filter(t => norm(t).length >= 3 && !cleanN.includes(norm(t))).slice(0, 6);
        card.md = card.added ? r.md : md;
        card.keep = card.added || card.missing.length ? 'raw' : 'clean';
        stage('Choosing where to file it');
        try {
          const j = parseJSON(await ollamaChat([
            { role: 'system', content: 'Classify these study notes: the GATE CS subject, the main topic (2-6 words, like a syllabus topic name), and the subtopic (2-6 words, or "" if the notes cover the whole topic). Return JSON.' },
            { role: 'user', content: card.md.slice(0, 3000) },
          ], { signal, temperature: 0, maxTokens: 120, model: checkModel(), format: { type: 'object', required: ['subject', 'topic', 'subtopic'], properties: { subject: { type: 'string', enum: SUBJECTS }, topic: { type: 'string' }, subtopic: { type: 'string' } } } }));
          card.subject = j.subject; card.topic = String(j.topic || '').trim(); card.subtopic = String(j.subtopic || '').trim();
        } catch (e) { if (e.name === 'AbortError') throw e; card.subject = this.subject; }
        card.stage = 'ready'; this.paintScans();
      }
    });
  },
  paintScans() {
    const box = $('#nScan');
    if (!box) return;
    box.innerHTML = this.scans.map(c => {
      if (c.stage !== 'ready') return `<div class="card n-scan"><div class="row"><b style="flex:1">${icon('camera')} ${escapeHtml(c.name)}</b><span class="small muted">${escapeHtml(c.stage)}…</span></div>
        ${c.md ? `<div class="md n-scan-preview">${renderMd(c.md)}</div>` : '<div class="skel"><i></i><i></i><i></i></div>'}</div>`;
      const topics = ((typeof H !== 'undefined' && H && H.notes) || {})[c.subject] || [];
      return `<div class="card n-scan" data-scan="${c.id}">
        <div class="row"><b style="flex:1">${icon('check')} ${escapeHtml(c.name)}: ready to save</b>
          <span class="seg"><button class="${c.keep !== 'raw' ? 'on' : ''}" data-keep="clean" ${c.added ? 'disabled title="The tidy-up added text that is not in your notes, so only the exact version is offered"' : ''}>Clean version</button><button class="${c.keep === 'raw' ? 'on' : ''}" data-keep="raw">Exactly as written</button></span></div>
        ${c.missing && c.missing.length ? `<div class="ml-tip small">The clean version left out ${c.missing.map(t => renderMd('$' + t + '$')).join(', ')}, so <b>Exactly as written</b> is selected. You can still pick the clean one.</div>` : ''}
        <div class="md n-scan-preview">${renderMd(c.keep === 'raw' ? c.raw : c.md)}</div>
        ${c.keep !== 'raw' ? `<details class="n-raw-box"><summary class="small">Compare with exactly what was read from the photo</summary><div class="md">${renderMd(c.raw)}</div></details>` : ''}
        <div class="form n-file">
          <label>Subject <select class="ns-sub">${SUBJECTS.map(s => `<option ${s === c.subject ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select></label>
          <label>Topic <input type="text" class="ns-topic" value="${escapeHtml(c.topic || '')}" list="ns-topics-${c.id}"><datalist id="ns-topics-${c.id}">${topics.map(t => `<option value="${escapeHtml(t.name)}">`).join('')}</datalist></label>
          <label>Subtopic (optional) <input type="text" class="ns-subt" value="${escapeHtml(c.subtopic || '')}"></label>
        </div>
        <div class="row" style="margin-top:12px"><button class="primary ns-save">${icon('check')} Save to my notes</button><button class="link ns-drop">Discard</button>
          <span class="small muted">${/\[unclear\]/i.test(c.md) ? 'Some words were unreadable and are marked [unclear]: fix them after saving.' : ''}</span></div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-scan]').forEach(el => {
      const c = this.scans.find(x => x.id === el.dataset.scan);
      el.querySelectorAll('[data-keep]').forEach(b => b.onclick = () => { c.keep = b.dataset.keep; this.paintScans(); });
      $('.ns-drop', el).onclick = () => { this.scans = this.scans.filter(x => x !== c); this.paintScans(); };
      $('.ns-save', el).onclick = async () => {
        const subject = $('.ns-sub', el).value, topic = $('.ns-topic', el).value.trim() || 'Scanned notes', subt = $('.ns-subt', el).value.trim();
        const stamp = `*From a scan, ${new Date().toLocaleDateString()}*\n\n`;
        await updateHub(h => {
          // Filing a scan under a removed name brings that name back.
          const back = [noteKey(topic), noteKey(topic, subt)];
          h.notesRemoved = h.notesRemoved || {};
          h.notesRemoved[subject] = (h.notesRemoved[subject] || []).filter(k => !back.includes(k));
          if (subject === this.subject && this.removed) back.forEach(k => this.removed.delete(k));
          const list = seedNotes(h, subject);
          let t = list.find(x => x.name.toLowerCase() === topic.toLowerCase());
          if (!t) { t = { id: uid(), name: topic, text: '', from: 'scan', subs: [] }; list.unshift(t); }
          if (subt) {
            let s = t.subs.find(x => x.name.toLowerCase() === subt.toLowerCase());
            if (!s) { s = { id: uid(), name: subt, text: '' }; t.subs.push(s); }
            s.text = (s.text.trim() ? s.text.trim() + '\n\n' : '') + stamp + (c.keep === 'raw' ? c.raw : c.md);
          } else t.text = (t.text.trim() ? t.text.trim() + '\n\n' : '') + stamp + (c.keep === 'raw' ? c.raw : c.md);
          this.open.add(t.id);
        });
        syncNotesFile();
        this.scans = this.scans.filter(x => x !== c);
        this.subject = subject;
        toast(`Saved under ${subject} › ${topic}${subt ? ' › ' + subt : ''}.`, 'ok');
        this.render(); this.paintScans();
      };
    });
  },
};
$('#nScanIn') && ($('#nScanIn').onchange = e => { NotesUI.scan(e.target.files); e.target.value = ''; });
// Closing or hiding the window saves notes that are still waiting for the typing pause.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') NotesUI.flush(); });
addEventListener('pagehide', () => NotesUI.flush());

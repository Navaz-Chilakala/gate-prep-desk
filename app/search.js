// Search everything (Ctrl+Shift+F, the header search button's "Search everything", or the palette):
// full text of topic lessons, book lessons and every page of your books, notes, PYQs and their masterclasses,
// formulas, mistakes, mini lessons, flashcards and tutor-chat answers. Every word you type must appear;
// results are grouped by where they live, with the matching text highlighted, and open in place.

const SearchAll = {
  // Everything searchable in the hub (books are added from their own data, below).
  hubDocs() {
    const d = [], add = (group, ico, title, text, open, sub = '') => { if (text) d.push({ group, ico, title, text: plainText(String(text)), open, sub }); };
    for (const [k, t] of Object.entries(H.topics || {})) add('Lessons', 'book', t.title, t.md, () => { openTab('ask'); openTopic(H.topics[k], k); }, t.subject || '');
    for (const p of H.pyqs || []) add('PYQs', 'help', `GATE ${p.year || '?'}${pyqNum(p) ? ' Q.' + pyqNum(p) : ''}${p.concept ? ' · ' + p.concept : ''}`, `${p.text}\n${p.master || ''}`, () => { openTab('pyq'); openPyq(p.id); }, p.subject || '');
    for (const f of H.formulas || []) add('Formulas', 'sigma', f.name || f.note || 'Formula', `${f.name || ''} ${f.tex} ${f.note || ''}`, () => { openTab('formulas'); const s = $('#fSearch'); if (s) { s.value = (f.name || f.note || '').slice(0, 40); s.dispatchEvent(new Event('input')); } }, f.subject || '');
    for (const [subj, list] of Object.entries(H.notes || {})) for (const t of list || []) {
      add('My notes', 'pencil', `${t.name}`, [t.text, ...(t.subs || []).map(s => `${s.name}: ${s.text}`)].join('\n'), () => openTab('notes'), subj);
    }
    for (const m of H.mistakes || []) add('Mistakes', 'refresh', m.q.concept || 'A mistake', `${m.q.question}\n${(m.q.options || []).join('\n')}\n${m.q.explanation || ''}\n${m.why || ''}`, () => openTab('mistakes'), m.q.subject || '');
    for (const l of Object.values(H.miniLessons || {})) add('Mini lessons', 'book', l.concept, l.md, () => openTab('mistakes'));
    for (const c of H.cards || []) add('Flashcards', 'cards', plainText(c.front).slice(0, 80), `${c.front}\n${c.back}`, () => openTab('practice'), c.subject || '');
    for (const [ctx, msgs] of Object.entries(H.chats || {})) (msgs || []).forEach((m, i) => {
      if (m.role !== 'assistant') return;
      const q = (msgs.slice(0, i).reverse().find(x => x.role === 'user') || {}).content || 'Tutor answer';
      add('Tutor chat', 'chat', plainText(q).slice(0, 80), m.content, () => TutorChat.open(ctx));
    });
    return d;
  },
  async bookDocs() {
    const out = [];
    try {
      for (const s of await Store.listSites()) {
        let d; try { d = await Store.getData(s.id); } catch { continue; }
        (d.pages || []).forEach((p, i) => { if (p && p.md) out.push({ group: 'Book pages', ico: 'folder', title: `${prettyName(s.name)}, p.${i + 1}`, text: plainText(p.md), open: () => { location.href = `site.html?id=${s.id}&page=${i + 1}#digitize`; } }); });
        (d.lessons || []).forEach(L => { if (L.md) out.push({ group: 'Book lessons', ico: 'book', title: `${L.title || (L.md.match(/^#\s+(.+)$/m) || [])[1] || `Pages ${L.from}-${L.to}`}`, sub: prettyName(s.name), text: plainText(L.md), open: () => { location.href = `site.html?id=${s.id}#learn`; } }); });
      }
    } catch {}
    return out;
  },
  words(q) { return [...new Set(q.toLowerCase().split(/\s+/).filter(w => w.length >= 2))]; },
  // A word matches at the start of a word ("hit" finds "hit ratio", "hits", not "architecture").
  wre(w, flags = 'iu') { return new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, flags); },
  match(doc, words) {
    let s = 0;
    for (const w of words) {
      const inTitle = this.wre(w).test(doc.title), n = (doc.text.match(this.wre(w, 'giu')) || []).length;
      if (!n && !inTitle) return null;
      s += (inTitle ? 5 : 0) + Math.min(5, n);
    }
    return s;
  },
  snippet(text, words) {
    const t = text.replace(/\s+/g, ' '), low = t.toLowerCase();
    const pos = words.map(w => { const m = t.match(this.wre(w)); return m ? m.index : Infinity; }).filter(Number.isFinite), at = Math.max(0, (pos.length ? Math.min(...pos) : 0) - 70);
    let s = (at ? '…' : '') + t.slice(at, at + 220) + (t.length > at + 220 ? '…' : '');
    s = escapeHtml(s);
    for (const w of words) s = s.replace(this.wre(escapeHtml(w), 'giu'), m => `<mark>${m}</mark>`);
    return s;
  },
  async run(q) {
    const words = this.words(q);
    if (!words.length) return [];
    if (!this.books || Date.now() - this.booksAt > 120000) { this.books = await this.bookDocs(); this.booksAt = Date.now(); }
    const docs = this.hubDocs().concat(this.books), hits = [];
    for (const d of docs) { const s = this.match(d, words); if (s != null) hits.push({ ...d, s }); }
    return hits.sort((a, b) => b.s - a.s);
  },
  open() {
    let el = $('#searchAll');
    if (!el) {
      el = document.createElement('div'); el.id = 'searchAll'; el.className = 'pal-overlay';
      el.innerHTML = `<div class="pal-box sa-box" role="dialog" aria-label="Search everything"><div class="pal-in">${icon('search')}<input type="text" placeholder="Search everything: lessons, book pages, notes, PYQs, formulas, mistakes, chats…" aria-label="Search everything"><kbd>Esc</kbd></div>
        <div class="sa-groups small"></div><div class="pal-list sa-list"></div><div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span>every word must appear</span></div></div>`;
      document.body.appendChild(el);
      el.onclick = e => { if (e.target === el) this.close(); };
      const inp = $('input', el);
      inp.oninput = () => { clearTimeout(this.t); this.t = setTimeout(() => this.search(inp.value), 220); };
      inp.onkeydown = e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); this.sel = Math.min(this.shown.length - 1, this.sel + 1); this.paint(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.sel = Math.max(0, this.sel - 1); this.paint(); }
        else if (e.key === 'Enter') { e.preventDefault(); this.pick(this.shown[this.sel]); }
        else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      };
    }
    el.classList.add('open'); this.filter = '';
    const inp = $('input', el); setTimeout(() => { inp.focus(); inp.select(); }, 10);
    if (inp.value) this.search(inp.value); else { this.hits = []; this.shown = []; this.paint(); }
  },
  close() { const el = $('#searchAll'); if (el) el.classList.remove('open'); },
  async search(q) {
    const el = $('#searchAll');
    $('.sa-list', el).innerHTML = '<p class="empty">Searching&hellip;</p>';
    this.q = q; this.hits = await this.run(q);
    if (this.q !== q) return;
    this.sel = 0; this.paint();
  },
  paint() {
    const el = $('#searchAll'), hits = this.hits || [], words = this.words(this.q || '');
    const groups = {}; hits.forEach(h => { groups[h.group] = (groups[h.group] || 0) + 1; });
    $('.sa-groups', el).innerHTML = hits.length ? [['', `All ${hits.length}`], ...Object.entries(groups).map(([g, n]) => [g, `${g} ${n}`])].map(([g, l]) => `<button class="chip ${this.filter === g ? 'on' : ''}" data-sg="${escapeHtml(g)}">${escapeHtml(l)}</button>`).join('') : '';
    $('.sa-groups', el).querySelectorAll('[data-sg]').forEach(b => b.onclick = () => { this.filter = b.dataset.sg; this.sel = 0; this.paint(); $('input', el).focus(); });
    this.shown = hits.filter(h => !this.filter || h.group === this.filter).slice(0, 60);
    $('.sa-list', el).innerHTML = !words.length ? '<p class="empty">Type a word or two. Every word must appear in the result.</p>' : !this.shown.length ? '<p class="empty">Nothing found. Try fewer or different words.</p>'
      : this.shown.map((h, i) => `<button class="pal-item sa-item ${i === this.sel ? 'on' : ''}" data-i="${i}">${icon(h.ico)}<span class="sa-main"><span class="sa-title"><b>${escapeHtml(h.title)}</b> <span class="muted">${escapeHtml(h.group)}${h.sub ? ' · ' + escapeHtml(h.sub) : ''}</span></span><span class="sa-snip">${this.snippet(h.text, words)}</span></span></button>`).join('');
    $('.sa-list', el).querySelectorAll('[data-i]').forEach(b => { b.onclick = () => this.pick(this.shown[+b.dataset.i]); b.onmousemove = () => { if (this.sel !== +b.dataset.i) { this.sel = +b.dataset.i; this.paint(); } }; });
    const cur = $('.sa-item.on', el); if (cur) cur.scrollIntoView({ block: 'nearest' });
  },
  pick(h) { if (!h) return; this.close(); h.open(); },
};
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); SearchAll.open(); } });
// Esc closes the search wherever the focus is (not only in its box).
document.addEventListener('keydown', e => { const el = $('#searchAll'); if (e.key === 'Escape' && el && el.classList.contains('open')) { e.preventDefault(); SearchAll.close(); } });
Palette.provide(() => [{ group: 'Do', label: 'Search everything (full text)', hint: 'Ctrl+Shift+F', ico: 'search', run: () => SearchAll.open() }]);

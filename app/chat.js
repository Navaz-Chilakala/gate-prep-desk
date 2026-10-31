// Tutor chat: a side panel on every page, laid out like a modern AI chat. The + button in the composer attaches
// images (sent to the vision model) and picks the context sent to the local model (a lesson, a page, a chapter,
// the whole book via page search, your notes, your topics, or nothing); "What's sent" shows it exactly.
// Answers stream in, code blocks have a Copy button, and each answer can be copied, retried or fact-checked.
//
// Pages describe their contexts with TutorChat.provide(() => [{ id, label, text(question) | async text(question), cite }]).

const CHAT_SYS = `You are a GATE CS tutor chatting with a student. Answer their question clearly and in depth, in order: the short answer first, then the reasoning step by step, then an example if it helps. Use the context below as your main source and add your own knowledge where it helps (say so when you go beyond the context). If the context cites pages, mention the pages you used like (p. 12). Use LaTeX for math ($...$). Put any code, query or command in a fenced code block with its language (\`\`\`c, \`\`\`sql, \`\`\`python …).
If the student attached images, read them carefully (questions, diagrams, handwriting) and answer about what they show.
${DIAGRAMS.replace('1-3 diagrams per lesson (at least one), placed right where they explain the step', 'include 1 diagram whenever the answer involves a process, structure, states or a timeline (skip it only for one-line factual answers)')}
At the very end, on its own line, write exactly: FOLLOW-UPS: <question 1> || <question 2> || <question 3>
(three short, natural next questions the student might ask, building on your answer).`;

function chatTokens(s) { return topicTokens(s); }
// The answer a chat reply gives: its "Answer" section ("## Answer", "## Short answer", "**Final answer:** …"), else its
// first paragraph (the system prompt asks for the short answer first).
function chatAnswerOf(md) {
  const t = String(md || '');
  const sec = t.match(/^#{1,4}[^\n]*\banswer\b[^\n]*\n+([\s\S]*?)(?=\n#{1,4}\s|$)/im) || t.match(/\*\*(?:final |short )?answer:?\*\*:?\s*([^\n]+)/i);
  const first = t.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^#/.test(p));
  return plainText((sec ? sec[1] : first) || '').trim().slice(0, 400);
}
// Picks the pages most relevant to a question (simple keyword scoring; good enough for notes and books).
function relevantPages(pages, question, limitChars = 22000) {
  const q = [...new Set(chatTokens(question))];
  if (!q.length) return [];
  const scored = [];
  pages.forEach((p, i) => {
    if (!p || !p.md) return;
    const words = chatTokens(p.md);
    if (!words.length) return;
    let score = 0;
    for (const w of q) { const n = words.filter(x => x === w || (w.length >= 4 && x.startsWith(w))).length; if (n) score += 1 + Math.log(n); }
    if (score) scored.push({ i, score: score / Math.sqrt(words.length / 200 + 1) });
  });
  scored.sort((a, b) => b.score - a.score);
  const out = [];
  let used = 0;
  for (const s of scored) {
    const md = pages[s.i].md;
    if (used + md.length > limitChars) continue;
    out.push(s.i); used += md.length;
    if (out.length >= 8) break;
  }
  return out.sort((a, b) => a - b);
}

// A few line icons the shared set doesn't have.
const TC_ICON = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
  done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9M19.5 4.5V9H15M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15M4.5 19.5V15H9"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6"/></svg>',
  shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 10H14V4.5M4.5 14H10v5.5M14 10l5.5-5.5M10 14l-5.5 5.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  newchat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h7.5M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4z"/></svg>',
  ctx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4.5h10l4 4v11H5z"/><path d="M14.5 4.5v4h4M8.5 12.5h7M8.5 16h5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 13.8 9 19.5 10.5 13.8 12 12 17.5 10.2 12 4.5 10.5 10.2 9z"/><path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg>',
};

const TutorChat = {
  providers: [],
  msgs: [],             // { role, content, followups?, sources?, review?, ran?, thumbs?, images? (in memory only) }
  convKey: null,        // which saved conversation is open (the context it was started in)
  ctxId: null,          // the context sent with the next message (changeable from the + menu)
  ctl: null,
  status: '',           // a short line shown while working ("Reading the image…")
  pending: [],          // images attached to the next message: { b64, thumb, name }
  wide: false,
  provide(fn) { this.providers.push(fn); },
  contexts() {
    const list = [];
    for (const fn of this.providers) { try { list.push(...(fn() || [])); } catch (e) { console.error(e); } }
    list.push({ id: 'mynotes', label: 'My notes', text: async q => { const n = (await Store.getHub()).notes; return myNotesFor(q, n) || myNotesFor('', n); } });
    list.push({ id: 'topics', label: 'My topics list', text: async () => topicsMarkdown((await Store.getHub()).covered) });
    list.push({ id: 'none', label: 'No context', text: () => '' });
    return list;
  },
  mount() {
    if ($('#chatFab')) return;
    const fab = document.createElement('button');
    fab.id = 'chatFab'; fab.className = 'primary chat-fab';
    fab.innerHTML = `${icon('chat')} Ask the tutor`;
    fab.onclick = () => this.open();
    // In the header (never covers page content); floating only if a page has no header.
    const header = document.querySelector('header.top'), status = document.getElementById('status');
    if (header && status) header.insertBefore(fab, status); else document.body.appendChild(fab);
    const d = document.createElement('aside');
    d.id = 'chatDrawer'; d.className = 'chat-drawer tc'; d.setAttribute('aria-label', 'Tutor chat');
    d.innerHTML = `
      <div class="tc-head"><div class="tc-title"><span class="tc-mark">${TC_ICON.spark}</span><b>Tutor</b></div>
        <button class="tc-ib tc-new" title="New chat">${TC_ICON.newchat}</button>
        <button class="tc-ib tc-wide" title="Expand">${TC_ICON.expand}</button>
        <button class="tc-ib tc-close" title="Close (Esc)">${TC_ICON.close}</button></div>
      <div class="tc-thread" aria-live="polite"></div>
      <div class="tc-foot">
        <div class="tc-composer">
          <div class="tc-attach"></div>
          <textarea rows="1" placeholder="Ask anything…" aria-label="Message"></textarea>
          <div class="tc-bar">
            <div class="tc-plus-wrap"><button class="tc-ib tc-plus" title="Add image or context" aria-haspopup="menu">${icon('plus')}</button><div class="tc-menu hidden" role="menu"></div></div>
            <span class="tc-model small"></span><span style="flex:1"></span>
            <button class="tc-send" title="Send (Enter)">${TC_ICON.up}</button></div>
        </div>
        <input type="file" class="tc-file" accept="image/*" multiple hidden>
      </div>
      <div class="tc-drop hidden"><div>Drop images to attach</div></div>`;
    document.body.appendChild(d);
    $('.tc-close', d).onclick = () => this.close();
    $('.tc-new', d).onclick = () => { this.stop(); this.msgs = []; this.pending = []; this.save(); this.render(); $('textarea', d).focus(); };
    $('.tc-wide', d).onclick = () => { this.wide = !this.wide; d.classList.toggle('wide', this.wide); $('.tc-wide', d).innerHTML = this.wide ? TC_ICON.shrink : TC_ICON.expand; $('.tc-wide', d).title = this.wide ? 'Narrow' : 'Expand'; };
    const ta = $('textarea', d);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(220, ta.scrollHeight) + 'px'; this.renderSend(); };
    ta.oninput = grow;
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(ta.value); } };
    $('.tc-send', d).onclick = () => this.ctl ? this.stop() : this.send(ta.value);
    // + menu: images, context, what's sent
    $('.tc-plus', d).onclick = e => { e.stopPropagation(); this.menu(); };
    document.addEventListener('click', e => { if (!e.target.closest('.tc-plus-wrap')) $('.tc-menu', d).classList.add('hidden'); });
    $('.tc-file', d).onchange = e => { this.attach([...e.target.files]); e.target.value = ''; };
    // paste or drop images
    ta.addEventListener('paste', e => { const files = [...(e.clipboardData || {}).files || []].filter(f => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); this.attach(files); } });
    let depth = 0;
    d.addEventListener('dragenter', e => { if ([...(e.dataTransfer.types || [])].includes('Files')) { depth++; $('.tc-drop', d).classList.remove('hidden'); } });
    d.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('.tc-drop', d).classList.add('hidden'); } });
    d.addEventListener('dragover', e => e.preventDefault());
    d.addEventListener('drop', e => { e.preventDefault(); depth = 0; $('.tc-drop', d).classList.add('hidden'); this.attach([...e.dataTransfer.files]); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && d.classList.contains('open') && !document.querySelector('.dg-full')) { const m = $('.tc-menu', d); if (!m.classList.contains('hidden')) m.classList.add('hidden'); else this.close(); } });
  },
  // Opens the panel, optionally choosing a context and asking a question straight away.
  async open(ctxId, question) {
    this.mount();
    const d = $('#chatDrawer');
    const list = this.contexts();
    const id = ctxId && list.some(c => c.id === ctxId) ? ctxId : (list.some(c => c.id === this.ctxId) ? this.ctxId : list[0].id);
    if (id !== this.convKey || !this.msgs.length) { this.convKey = id; await this.load(); }
    this.ctxId = id;
    d.classList.add('open'); document.body.classList.add('chat-open');
    this.render();
    if (question) this.send(question);
    else setTimeout(() => $('textarea', d).focus(), 200);
  },
  close() { const d = $('#chatDrawer'); if (d) d.classList.remove('open'); document.body.classList.remove('chat-open'); },
  stop() { if (this.ctl) this.ctl.abort(); },
  ctx() { return this.contexts().find(c => c.id === this.ctxId) || { id: 'none', label: 'No context', text: () => '' }; },
  async load() { const h = await Store.getHub(); this.msgs = ((h.chats || {})[this.convKey] || []).slice(-40); },
  save() {
    const key = this.convKey || this.ctxId || 'none';
    const m = this.msgs.slice(-40).map(({ role, content, followups, sources, review, ran, thumbs, pages }) => ({ role, content, followups, sources, review, ran, thumbs, pages }));
    updateHub(h => { h.chats = h.chats || {}; h.chats[key] = m; });
  },
  // ---------- the + menu ----------
  menu() {
    const d = $('#chatDrawer'), m = $('.tc-menu', d);
    if (!m.classList.contains('hidden')) { m.classList.add('hidden'); return; }
    const list = this.contexts();
    m.innerHTML = `<button class="tc-mi" data-act="img" role="menuitem">${icon('image')}<span>Add images</span><kbd>Ctrl+V</kbd></button>
      <div class="tc-msep"></div><div class="tc-mh">Context</div>
      ${list.map(c => `<button class="tc-mi ${c.id === this.ctxId ? 'on' : ''}" data-ctx="${escapeHtml(c.id)}" role="menuitemradio" aria-checked="${c.id === this.ctxId}">${c.id === 'none' ? TC_ICON.close : TC_ICON.ctx}<span>${escapeHtml(c.label)}</span>${c.id === this.ctxId ? `<i class="tc-tick">${TC_ICON.done}</i>` : ''}</button>`).join('')}
      <div class="tc-msep"></div><button class="tc-mi" data-act="peek" role="menuitem">${TC_ICON.eye}<span>What's sent</span></button>`;
    m.classList.remove('hidden');
    m.querySelectorAll('[data-ctx]').forEach(b => b.onclick = () => { this.ctxId = b.dataset.ctx; m.classList.add('hidden'); this.render(); $('textarea', d).focus(); });
    $('[data-act=img]', m).onclick = () => { m.classList.add('hidden'); $('.tc-file', d).click(); };
    $('[data-act=peek]', m).onclick = () => { m.classList.add('hidden'); this.peek(); };
  },
  // Exactly what goes to the model with the next message.
  async peek() {
    const lastQ = [...this.msgs].reverse().find(m => m.role === 'user');
    const ta = $('#chatDrawer textarea');
    const q = (ta && ta.value.trim()) || (lastQ ? lastQ.content : '');
    const c = this.ctx(), t = await c.text(q);
    const ov = document.createElement('div');
    ov.className = 'dg-full';
    ov.innerHTML = `<div class="dg-full-box tc-peek"><button class="dg-close" title="Close (Esc)">✕</button><div class="card-title">${escapeHtml(c.label)}</div>
      <p class="small muted">${t ? `${t.length.toLocaleString()} characters` : 'Only your message and the conversation.'}${this.pending.length ? ` · ${this.pending.length} image${this.pending.length > 1 ? 's' : ''} (vision model)` : ''}</p>${t ? `<pre class="log">${escapeHtml(t.slice(0, 6000))}${t.length > 6000 ? '\n…' : ''}</pre>` : ''}</div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc, true); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    ov.onclick = e => { if (e.target === ov || e.target.classList.contains('dg-close')) close(); };
    document.addEventListener('keydown', esc, true);
    document.body.appendChild(ov);
  },
  // ---------- images ----------
  async attach(files) {
    const imgs = files.filter(f => f && f.type && f.type.startsWith('image/')).slice(0, 4 - this.pending.length);
    for (const f of imgs) {
      try {
        const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        const scaled = (max, q) => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q); };
        // The model gets a sharp copy (up to 1600 px); the thread keeps a small thumbnail.
        this.pending.push({ b64: scaled(1600, 0.9).split(',')[1], thumb: scaled(240, 0.7), name: f.name || 'image' });
      } catch { toast(`Couldn't read ${f.name || 'that image'}.`, 'bad'); }
    }
    if (files.length > imgs.length) toast('Up to 4 images per message.');
    this.render();
    $('#chatDrawer textarea').focus();
  },
  // Same fact-check as lessons: exact recalculation, local + internet checks, deeper thinking on disagreement.
  factCheck(i) {
    const m = this.msgs[i], q = [...this.msgs.slice(0, i)].reverse().find(x => x.role === 'user');
    if (!m) return;
    runJob('Fact-checking the answer', async signal => {
      const fc = await factCheck(m.content, { title: q ? q.content.slice(0, 160) : 'Tutor chat answer', kind: 'chat answer', signal, onStage: t => jobLabel(`Fact-checking: ${t}`, signal) });
      m.content = fc.md; m.review = fc.review;
    }, () => { this.save(); this.render(); });
  },
  retry(i) {
    if (this.ctl) return;
    const u = this.msgs[i - 1];
    if (!u || u.role !== 'user') return;
    this.msgs.splice(i - 1);   // the question goes again, with its images if still in memory
    this.send(u.content, { images: u.images || [], thumbs: u.thumbs || [] });
  },
  // ---------- drawing ----------
  renderSend() {
    const d = $('#chatDrawer'); if (!d) return;
    const b = $('.tc-send', d), has = $('textarea', d).value.trim() || this.pending.length;
    b.innerHTML = this.ctl ? TC_ICON.stop : TC_ICON.up;
    b.title = this.ctl ? 'Stop' : 'Send (Enter)';
    b.classList.toggle('ready', !!(this.ctl || has));
    b.classList.toggle('stop', !!this.ctl);
  },
  starters() {
    const c = this.ctx();
    if (c.id === 'none' || c.id === 'topics') return ['Explain the four deadlock conditions', 'Compare TCP and UDP for GATE', 'How does LR(0) parsing work?'];
    if (c.id === 'mynotes') return ['Quiz me on my notes', 'What is missing from my notes?', 'Summarise my notes in 5 points'];
    return ['Summarise this in 5 points', 'Give me one GATE-style question on this', 'What traps do students fall into here?'];
  },
  // Your own message stays plain text, but formulas in it ($…$, $$…$$) are typeset like the answers.
  userText(s) {
    const k = window.katex;
    if (!k) return escapeHtml(s);
    return String(s).split(/(\$\$[\s\S]+?\$\$|\$(?=\S)[^$\n]*?\S\$)/g).map((part, i) => {
      if (i % 2 === 0) return escapeHtml(part);
      const display = part.startsWith('$$'), tex = part.slice(display ? 2 : 1, display ? -2 : -1);
      try { return k.renderToString(tex, { displayMode: display, throwOnError: false }); } catch { return escapeHtml(part); }
    }).join('');
  },
  render(streaming) {
    const d = $('#chatDrawer');
    if (!d) return;
    const th = $('.tc-thread', d);
    const nearBottom = th.scrollHeight - th.scrollTop - th.clientHeight < 80;
    const items = this.msgs.concat(streaming != null ? [{ role: 'assistant', content: streaming, live: true }] : []);
    const html = md => this.linkify ? this.linkify(renderMd(md)) : renderMd(md);
    const last = this.msgs[this.msgs.length - 1];
    const fu = streaming == null && last && last.role === 'assistant' ? (last.followups || []) : [];
    if (!items.length) {
      th.innerHTML = `<div class="tc-empty"><div class="tc-mark big">${TC_ICON.spark}</div><h3>How can I help?</h3>
        <p class="small muted">${escapeHtml(this.ctx().label)}</p>
        <div class="tc-starters">${this.starters().map(s => `<button class="tc-starter">${escapeHtml(s)}</button>`).join('')}</div></div>`;
      th.querySelectorAll('.tc-starter').forEach(b => b.onclick = () => this.send(b.textContent));
    } else {
      th.innerHTML = items.map((m, i) => {
        if (m.role === 'user') return `<div class="tc-msg user">${(m.thumbs || []).length ? `<div class="tc-thumbs">${m.thumbs.map(t => `<img src="${t}" alt="">`).join('')}</div>` : ''}<div class="tc-bubble">${this.userText(m.content)}</div></div>`;
        const done = !m.live && m.content && !/^_\(stopped\)_|^_Sorry/.test(m.content);
        const body = m.live && !m.content ? `<div class="tc-thinking"><span></span><span></span><span></span>${this.status ? `<em>${escapeHtml(this.status)}</em>` : ''}</div>` : `<div class="md tc-md">${html(m.content || '')}</div>`;
        return `<div class="tc-msg assistant">${body}
          ${m.ran ? `<div class="tc-ran small">${TC_ICON.done}<span>${m.ran.calc ? 'Computed exactly' : 'Checked by running it'} · <b>${escapeHtml(m.ran.name)}</b>: ${escapeHtml(String(m.ran.text).slice(0, 160))}</span></div>` : ''}
          ${(m.pages || []).length ? `<div class="tc-pages small"><span class="muted">From your book:</span> ${m.pages.map(n => `<a href="#" data-page="${n}">p. ${n}</a>`).join('')}</div>` : ''}${Web.html(m.sources)}
          ${m.review ? `<div class="cd-fc" data-mi="${i}">${reviewHtml(m.review)}</div>` : ''}
          ${done ? `<div class="tc-acts"><button class="tc-ib sm" data-copy="${i}" title="Copy">${TC_ICON.copy}</button><button class="tc-ib sm" data-retry="${i}" title="Retry">${TC_ICON.retry}</button>${m.review ? '' : `<button class="tc-ib sm" data-fc="${i}" title="Fact-check">${TC_ICON.shield}</button>`}</div>` : ''}
        </div>`;
      }).join('') + (fu.length ? `<div class="tc-follow">${fu.map(q => `<button class="tc-fu">${escapeHtml(q)}<span>${TC_ICON.up}</span></button>`).join('')}</div>` : '');
      this.decorateCode(th);
      th.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => this.copy(this.msgs[+b.dataset.copy].content, b));
      th.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => this.retry(+b.dataset.retry));
      th.querySelectorAll('[data-fc]').forEach(b => b.onclick = () => this.factCheck(+b.dataset.fc));
      th.querySelectorAll('.tc-fu').forEach((b, k) => b.onclick = () => this.send(fu[k]));
      th.querySelectorAll('.cd-fc').forEach(el => { const m = this.msgs[+el.dataset.mi]; if (m && m.review) wireReview(el, { items: () => m.review.items, md: () => m.content, setMd: md => { m.content = md; }, save: () => this.save(), rerender: () => this.render(), title: 'Tutor chat answer' }); });
    }
    if (nearBottom || streaming === '' || streaming == null) th.scrollTop = th.scrollHeight;
    // composer: attachments, context chip, model in use
    const att = $('.tc-attach', d), c = this.ctx();
    att.innerHTML = this.pending.map((p, k) => `<span class="tc-chip img"><img src="${p.thumb}" alt=""><button data-rm="${k}" title="Remove">${TC_ICON.close}</button></span>`).join('')
      + (c.id !== 'none' ? `<span class="tc-chip ctx" title="Sent with your message">${TC_ICON.ctx}<span>${escapeHtml(c.label)}</span><button data-noctx title="Remove context">${TC_ICON.close}</button></span>` : '');
    att.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { this.pending.splice(+b.dataset.rm, 1); this.render(); });
    const nc = $('[data-noctx]', att); if (nc) nc.onclick = () => { this.ctxId = 'none'; this.render(); };
    $('.tc-model', d).textContent = `${this.pending.length ? visionModel() : teachModel()} · on this laptop`;
    this.renderSend();
  },
  // Code blocks: a header with the language and a Copy button (diagram blocks are drawn, not shown as code).
  decorateCode(root) {
    root.querySelectorAll('.tc-md pre').forEach(pre => {
      if (pre.parentElement.classList.contains('tc-code')) return;
      const code = pre.querySelector('code'), lang = ((code && code.className.match(/language-([\w+#-]+)/)) || [])[1] || 'text';
      const box = document.createElement('div');
      box.className = 'tc-code';
      box.innerHTML = `<div class="tc-code-bar"><span>${escapeHtml(lang)}</span><button class="tc-copy">${TC_ICON.copy}<span>Copy</span></button></div>`;
      pre.replaceWith(box); box.appendChild(pre);
      $('.tc-copy', box).onclick = () => this.copy((code || pre).innerText, $('.tc-copy', box));
    });
  },
  async copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    if (btn) { const old = btn.innerHTML; btn.innerHTML = btn.classList.contains('tc-copy') ? `${TC_ICON.done}<span>Copied</span>` : TC_ICON.done; btn.classList.add('copied'); setTimeout(() => { btn.innerHTML = old; btn.classList.remove('copied'); }, 1400); }
  },
  setStatus(s) { this.status = s; },
  async send(text, again = null) {
    text = String(text || '').trim();
    const d = $('#chatDrawer');
    const images = again ? again.images : this.pending.map(p => p.b64), thumbs = again ? again.thumbs : this.pending.map(p => p.thumb);
    if ((!text && !images.length) || this.ctl) return;
    if (!text) text = images.length > 1 ? 'Explain these images.' : 'Explain this image.';
    if (/^continue[.!]?$/i.test(text) && !images.length && window.onContinue && window.onContinue()) { $('textarea', d).value = ''; return; }   // next PYQ
    $('textarea', d).value = ''; $('textarea', d).style.height = 'auto';
    this.pending = [];
    this.msgs.push({ role: 'user', content: text, ...(thumbs.length ? { thumbs, images } : {}) });
    this.ctl = new AbortController(); this.partial = "";
    this.status = images.length ? 'Looking at the image…' : '';
    this.render('');
    try {
      const c = this.ctx();
      const context = await c.text(text);
      const web = Web.on() ? await Web.search(text, this.ctl.signal) : [];
      // Your own notes on this, if any, always come along (unless they're already the chosen context).
      const mine = c.id === 'mynotes' ? '' : myNotesFor(text, (await Store.getHub()).notes);
      // An attached image is read first (the vision model writes out the question), so the exact checks below can use it.
      let seen = '';
      if (images.length) {
        this.status = 'Reading the image…'; this.render('');
        try {
          seen = (await ollamaChat([{ role: 'user', content: 'Write out the question or text in this image exactly: every number, list, option and code line. If it is a diagram, describe its parts and labels precisely. No solving, no commentary.', images }],
            { signal: this.ctl.signal, model: visionModel(), temperature: 0, maxTokens: 700 })).trim();
        } catch (e) { if (e.name === 'AbortError') throw e; }
      }
      // Code, a query or an expression is run for real (C with gcc, both scopings when asked; SQL with SQLite …), and a
      // computational question goes to the exact calculators (page faults, scheduling, subnetting …), the same checks
      // Photo doubt uses. The answer must then agree with that result. Questions without numbers skip the calculators.
      let ran = null;
      const checkText = [seen, text].filter(Boolean).join('\n\n');
      const runnable = typeof Runners !== 'undefined' && Runners.candidates(checkText).length;
      const computable = typeof Solvers !== 'undefined' && /\d/.test(checkText) && Solvers.candidates(checkText).length;
      if (runnable || computable) {
        this.status = runnable ? 'Running it for real first…' : 'Computing it exactly…'; this.render('');
        try { ran = runnable && !computable ? await Runners.answer(checkText, this.ctl.signal) : await Solvers.answer(checkText, this.ctl.signal); } catch (e) { if (e.name === 'AbortError') throw e; }
      }
      this.status = images.length ? 'Looking at the image…' : 'Thinking…'; this.render('');
      // A calculator result (Solvers) or a program actually run (Runners): the wording differs, the rule is the same.
      const calc = !!(ran && ran.solver && typeof Solvers !== 'undefined' && Solvers.byId(ran.solver));
      const how = calc ? 'COMPUTED EXACTLY BY THE BUILT-IN CALCULATOR' : 'VERIFIED BY ACTUALLY RUNNING IT';
      const ranNote = ran ? `\n\n${how} (${ran.name}): ${ran.text}\n${String(ran.steps || '').slice(0, 3000)}\nYour answer MUST agree with this result${calc ? ' (it is plain code, not a guess)' : ''}. Explain step by step why it is exactly this${/scoping/.test(ran.name) ? ', and how static and dynamic scoping differ here' : ''}.` : '';
      const sys = `${CHAT_SYS}${langNote()}\n\n${context ? `CONTEXT (${c.label}):\n${context}` : 'No extra context: answer from your own GATE CS knowledge.'}${mine ? `\n\nTHE STUDENT'S OWN NOTES on this (use them, and gently correct anything wrong):\n${mine}` : ''}${factsBlock(factsFor(text + (context ? ' ' + context.slice(0, 1500) : ''), 6))}${Web.context(web)}${ranNote}${/--- Page \d+ ---/.test(context) ? "\n\nThe context above is pages from the student's own book. After each point you take from it, cite its page in brackets like (p. 12); give at least one citation." : ''}`;
      const history = this.msgs.slice(-9).map(m => ({ role: m.role, content: m.content }));
      // The real result also goes into your message itself: small models weigh the last message most.
      if (ran) history[history.length - 1].content += calc ? `\n\n(Computed exactly by the ${ran.name} calculator: ${ran.text}. Your final answer must be this; explain step by step why.)` : `\n\n(Checked by actually running it — ${ran.name}: ${ran.text}. Explain why it prints exactly this.)`;
      // Images go with this message only, to the vision model, along with what was read from them.
      if (images.length) { history[history.length - 1].images = images; if (seen) history[history.length - 1].content += `\n\n(The image reads: ${seen.slice(0, 2500)})`; }
      const model = images.length ? visionModel() : undefined;
      const ask = msgs => ollamaChat(msgs, { signal: this.ctl.signal, maxTokens: 3000, model, onToken: (_, o) => { this.partial = o.replace(/\n*FOLLOW-?UPS?:[\s\S]*$/i, ''); this.render(this.partial); } });
      let raw = await ask([{ role: 'system', content: sys }, ...history]);
      // Does the answer agree with what really happened? Once more if not; then a clear warning.
      const outs = ran ? String(ran.text).replace(/^[A-D] \(|\)$/g, '').split(' · ').map(s => s.replace(/^\w+ scoping:\s*/, '').trim()).filter(s => /\d|\w/.test(s) && !/error/.test(s)) : [];
      // A calculator answer is compared with the final answer stated (as Photo doubt does), not just found anywhere in the text.
      const agrees = t => {
        if (calc) { const shown = chatAnswerOf(t); if (shown) return compareAnswers(ran.value, ran.text, shown, checkText) !== false; }
        return outs.every(o => new RegExp(o.split(/\s+/).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s,]*')).test(t.replace(/[*`$]/g, '')));
      };
      let contradicts = false;
      if (ran && outs.length && !agrees(raw)) {
        raw = await ask([{ role: 'system', content: sys }, ...history, { role: 'assistant', content: raw }, { role: 'user', content: calc ? `That contradicts the exact result. The ${ran.name} calculator (plain code) computed: ${ran.text}. Redo the working step by step so it reaches exactly this, and state it as the final answer.` : `That contradicts the real result. The program was compiled and run: ${ran.text}. Start from that exact output and explain step by step why it prints it. Do not say it fails to compile unless the result says so.` }]);
        contradicts = !agrees(raw);
      }
      const m = raw.match(/\n*FOLLOW-?UPS?:\s*([\s\S]*)$/i);
      const followups = m ? m[1].split(/\|\||\s\|\s|\n/).map(s => s.replace(/^[\s\-*\d.)]+|<|>/g, '').trim()).filter(s => s.length > 4).slice(0, 3) : [];
      let answer = raw.replace(/\n*FOLLOW-?UPS?:[\s\S]*$/i, '').trim();
      if (contradicts && calc) answer = `> **Careful:** the explanation below doesn't reach the exact result (**${ran.text}**, computed by the ${ran.name} calculator). Trust the calculator.\n\n${answer}`;
      else if (contradicts) answer = `> **Careful:** the explanation below doesn't match what the program really prints (**${ran.text}**, from ${ran.name}). Trust the real output.\n\n${answer}`;
      this.msgs.push({ role: 'assistant', content: answer, followups, sources: Web.brief(web), pages: [...new Set((String(context).match(/--- Page (\d+) ---/g) || []).map(s => +s.match(/\d+/)[0]))].slice(0, 8),...(ran ? { ran: { name: ran.name, text: ran.text, calc } } : {}) });
      collectFormulas(answer, lessonSubject(text + '\n' + answer) || 'Other', { kind: 'chat', label: 'Tutor chat: ' + text.slice(0, 50) });
    } catch (e) {
      if (e.name !== 'AbortError') this.msgs.push({ role: 'assistant', content: `_Sorry, I couldn't answer: ${e.message}_` });
      else this.msgs.push({ role: 'assistant', content: this.partial ? `${this.partial.trim()}\n\n_(stopped)_` : '_(stopped)_' });   // keep what was written so far
    } finally {
      this.ctl = null; this.status = ''; this.partial = '';
      this.save();
      this.render();
    }
  },
};

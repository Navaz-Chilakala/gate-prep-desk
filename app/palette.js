// Command palette (Ctrl+K) and keyboard shortcuts.
// Pages add their own items with Palette.provide(() => [{ group, label, hint, ico, run }]).
//   Ctrl+K        open the palette (type to search screens, topics, PYQs, formulas, notes, actions)
//   Alt+1 … Alt+9 jump to the screens in the sidebar, in order
//   /             focus the main box on this screen (Learn: "Teach me", otherwise its search)
//   ?             list the shortcuts
//   Esc           close what's open

const Palette = {
  providers: [],
  provide(fn) { this.providers.push(fn); },
  items() {
    const out = [];
    // Screens: whatever the sidebar holds on this page.
    document.querySelectorAll('#tabs [data-tab], #tabs .nav-back').forEach((b, i) => {
      const label = (b.querySelector('span') || b).textContent.trim();
      out.push({ group: 'Go to', label, hint: i < 9 && b.dataset.tab ? `Alt+${[...document.querySelectorAll('#tabs [data-tab]')].indexOf(b) + 1}` : '', ico: 'arrowR', run: () => b.click() });
    });
    for (const fn of this.providers) { try { out.push(...(fn() || [])); } catch (e) { console.warn(e); } }
    out.push({ group: 'Settings', label: 'Switch light / dark theme', ico: 'spark', run: () => Theme.cycle() });
    out.push({ group: 'Settings', label: 'Keyboard shortcuts', hint: '?', ico: 'help', run: () => this.help() });
    return out;
  },
  // Fuzzy match: all query letters in order; bonus for word starts and contiguous runs.
  score(q, text) {
    const t = text.toLowerCase();
    // Every typed word found as a word in the text beats any scattered-letter match.
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length && words.every(w => t.includes(w))) return 1000 + words.reduce((a, w) => a + (new RegExp(`(^|[\\s\\-·›(])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t) ? 20 : 8), 0) - t.length * 0.01;
    q = q.replace(/\s+/g, '');
    let s = 0, j = 0, run = 0;
    for (const ch of q) {
      const k = t.indexOf(ch, j);
      if (k < 0) return -1;
      run = k === j ? run + 1 : 0;
      s += 1 + run * 2 + (k === 0 || /[\s\-·›(]/.test(t[k - 1]) ? 3 : 0) - Math.min(3, (k - j) * 0.1);
      j = k + 1;
    }
    return s - t.length * 0.01;
  },
  open() {
    let el = document.getElementById('palette');
    if (!el) {
      el = document.createElement('div'); el.id = 'palette'; el.className = 'pal-overlay';
      el.innerHTML = `<div class="pal-box" role="dialog" aria-label="Command palette"><div class="pal-in">${typeof icon === 'function' ? icon('search') : ''}<input type="text" placeholder="Search screens, topics, PYQs, formulas, notes, actions…" aria-label="Search"><kbd>Esc</kbd></div><div class="pal-list" role="listbox"></div><div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>?</kbd> shortcuts</span></div></div>`;
      document.body.appendChild(el);
      el.onclick = e => { if (e.target === el) this.close(); };
      const inp = el.querySelector('input');
      inp.oninput = () => { this.sel = 0; this.paint(); };
      inp.onkeydown = e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); this.sel = Math.min(this.shown.length - 1, this.sel + 1); this.paint(true); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.sel = Math.max(0, this.sel - 1); this.paint(true); }
        else if (e.key === 'Enter') { e.preventDefault(); this.pick(this.shown[this.sel]); }
        else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      };
    }
    this.all = this.items(); this.sel = 0;
    el.classList.add('open');
    const inp = el.querySelector('input'); inp.value = ''; this.paint(); setTimeout(() => inp.focus(), 10);
  },
  close() { const el = document.getElementById('palette'); if (el) el.classList.remove('open'); },
  pick(it) { if (!it) return; this.close(); setTimeout(() => it.run(), 10); },
  paint(keepScroll) {
    const el = document.getElementById('palette'), q = el.querySelector('input').value.trim().toLowerCase();
    const list = q ? this.all.map(it => ({ it, s: this.score(q, `${it.label} ${it.group} ${it.sub || ''}`) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).map(x => x.it)
      : this.all.filter(it => it.group === 'Go to' || it.group === 'Do' || it.group === 'Settings');
    this.shown = list.slice(0, 60);
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let last = '';
    el.querySelector('.pal-list').innerHTML = this.shown.map((it, i) => {
      const head = it.group !== last ? `<div class="pal-group">${esc(it.group)}</div>` : ''; last = it.group;
      return `${head}<button class="pal-item ${i === this.sel ? 'on' : ''}" data-i="${i}" role="option">${typeof icon === 'function' ? icon(it.ico || 'arrowR') : ''}<span class="pal-label">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`;
    }).join('') || '<p class="pal-empty">Nothing matches. Try fewer letters.</p>';
    el.querySelectorAll('.pal-item').forEach(b => { b.onclick = () => this.pick(this.shown[+b.dataset.i]); b.onmousemove = () => { if (this.sel !== +b.dataset.i) { this.sel = +b.dataset.i; this.paint(true); } }; });
    const on = el.querySelector('.pal-item.on'); if (on && keepScroll) on.scrollIntoView({ block: 'nearest' });
  },
  help() {
    let el = document.getElementById('kbdHelp');
    if (!el) {
      el = document.createElement('div'); el.id = 'kbdHelp'; el.className = 'pal-overlay';
      el.innerHTML = `<div class="pal-box kbd-help" role="dialog" aria-label="Keyboard shortcuts"><h3>Keyboard shortcuts</h3><table>
        <tr><td><kbd>Ctrl</kbd> <kbd>K</kbd></td><td>Search everything and jump there</td></tr>
        <tr><td><kbd>Alt</kbd> <kbd>1</kbd> … <kbd>9</kbd></td><td>Go to the screens in the sidebar, in order</td></tr>
        <tr><td><kbd>/</kbd></td><td>Focus the main box ("Teach me", or this screen's search)</td></tr>
        <tr><td><kbd>?</kbd></td><td>This list</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close a panel, chat or dialog</td></tr>
        <tr><td colspan="2" class="kh-sub">In the daily mix and tests</td></tr>
        <tr><td><kbd>A</kbd>–<kbd>D</kbd></td><td>Choose an option</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Check / next</td></tr>
        <tr><td><kbd>Space</kbd>, <kbd>1</kbd>–<kbd>4</kbd></td><td>Flashcards: show answer, then rate it</td></tr>
      </table><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="primary">Got it</button></div></div>`;
      document.body.appendChild(el);
      el.onclick = e => { if (e.target === el || e.target.tagName === 'BUTTON') el.classList.remove('open'); };
    }
    el.classList.add('open');
  },
};
// A search button in the header, so the palette is discoverable.
document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('header.top'), status = document.getElementById('status');
  if (!header || document.getElementById('palBtn')) return;
  const b = document.createElement('button');
  b.id = 'palBtn'; b.className = 'pal-btn'; b.title = 'Search everything (Ctrl+K)';
  b.innerHTML = `${typeof icon === 'function' ? icon('search') : ''}<span>Search</span><kbd>Ctrl K</kbd>`;
  b.onclick = () => Palette.open();
  header.insertBefore(b, header.querySelector('.chat-fab') || status || null);
});
document.addEventListener('keydown', e => {
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); Palette.open(); return; }
  if (e.key === 'Escape') { const h = document.getElementById('kbdHelp'); if (h && h.classList.contains('open')) h.classList.remove('open'); }
  if (document.body.classList.contains('mix-open') || (document.getElementById('palette') || {}).classList?.contains('open')) return;
  if (e.altKey && /^[1-9]$/.test(e.key)) {
    const b = document.querySelectorAll('#tabs [data-tab]')[+e.key - 1];
    if (b) { e.preventDefault(); b.click(); }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); Palette.help(); }
  else if (e.key === '/') {
    const sec = [...document.querySelectorAll('main > section')].find(s => !s.classList.contains('hidden'));
    const target = (sec && sec.querySelector('#askIn, input[type=text]:not([hidden])')) || document.querySelector('#askIn');
    if (target) { e.preventDefault(); target.focus(); target.select && target.select(); }
  }
});

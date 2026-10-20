// Light / dark theme. Loaded in <head> (before the page draws) so there is no flash.
// Choice: 'auto' (follow Windows), 'light' or 'dark', remembered in localStorage (gt_theme).
// Sets <html data-theme="light|dark">; the CSS keys its dark colours off that attribute.

const Theme = {
  modes: ['auto', 'light', 'dark'],
  labels: { auto: 'Auto (follows Windows)', light: 'Light', dark: 'Dark' },
  mq: matchMedia('(prefers-color-scheme: dark)'),
  choice() { try { const v = localStorage.getItem('gt_theme'); return this.modes.includes(v) ? v : 'auto'; } catch { return 'auto'; } },
  effective() { const c = this.choice(); return c === 'auto' ? (this.mq.matches ? 'dark' : 'light') : c; },
  isDark() { return document.documentElement.dataset.theme === 'dark'; },
  apply(animate) {
    const root = document.documentElement, next = this.effective();
    if (root.dataset.theme === next) { this.paintButton(); return; }
    if (animate) { root.classList.add('theme-anim'); clearTimeout(this.t); this.t = setTimeout(() => root.classList.remove('theme-anim'), 350); }
    root.dataset.theme = next;
    this.paintButton();
    document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
  },
  set(mode) {
    try { localStorage.setItem('gt_theme', mode); } catch {}
    this.apply(true);
    const sel = document.getElementById('setTheme');
    if (sel) sel.value = mode;
  },
  cycle() {
    const next = this.modes[(this.modes.indexOf(this.choice()) + 1) % this.modes.length];
    this.set(next);
    if (typeof toast === 'function') toast(`Theme: ${this.labels[next]}`);
  },
  icons: {
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7L5.3 5.3"/>',
    dark: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
    auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
  },
  paintButton() {
    const b = document.getElementById('themeBtn');
    if (!b) return;
    const c = this.choice();
    b.innerHTML = `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${this.icons[c]}</svg>`;
    b.title = `Theme: ${this.labels[c]}. Click to switch.`;
    b.setAttribute('aria-label', b.title);
  },
  // Header button (before the status pill) plus the Settings dropdown if the page has one.
  mount() {
    const header = document.querySelector('header.top'), status = document.getElementById('status');
    if (header && !document.getElementById('themeBtn')) {
      const b = document.createElement('button');
      b.id = 'themeBtn'; b.className = 'theme-btn';
      b.onclick = () => this.cycle();
      header.insertBefore(b, status || null);
    }
    const sel = document.getElementById('setTheme');
    if (sel) { sel.value = this.choice(); sel.onchange = () => this.set(sel.value); }
    this.paintButton();
  },
};
// Accessibility: text size (whole-app zoom) and high contrast, applied before the page draws.
const Access = {
  sizes: { '90': 'Smaller', '100': 'Normal', '112': 'Large', '125': 'Larger', '140': 'Largest' },
  get(k, d) { try { return localStorage.getItem('gt_' + k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gt_' + k, v); } catch {} this.apply(); },
  apply() {
    const z = +this.get('zoom', '100') / 100;
    document.documentElement.style.zoom = z === 1 ? '' : String(z);
    if (this.get('contrast', 'off') === 'on') document.documentElement.dataset.contrast = 'high'; else delete document.documentElement.dataset.contrast;
  },
  mount() {
    const s = document.getElementById('setZoom'), c = document.getElementById('setContrast');
    if (s) { s.innerHTML = Object.entries(this.sizes).map(([v, l]) => `<option value="${v}">${l} (${v}%)</option>`).join(''); s.value = this.get('zoom', '100'); s.onchange = () => this.set('zoom', s.value); }
    if (c) { c.checked = this.get('contrast', 'off') === 'on'; c.onchange = () => this.set('contrast', c.checked ? 'on' : 'off'); }
  },
};
Access.apply();
document.addEventListener('DOMContentLoaded', () => Access.mount());
Theme.apply(false);
Theme.mq.addEventListener('change', () => { if (Theme.choice() === 'auto') Theme.apply(true); });
// Another window changed it: follow along.
addEventListener('storage', e => { if (e.key === 'gt_theme') { Theme.apply(true); const s = document.getElementById('setTheme'); if (s) s.value = Theme.choice(); } });
document.addEventListener('DOMContentLoaded', () => Theme.mount());

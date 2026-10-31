// Diagrams: ```mermaid blocks in any lesson, solution or chat answer are drawn as flowcharts,
// state diagrams, sequence diagrams, trees/graphs or Gantt charts, with a Play button that
// lights up each step in order. Everything runs locally (vendor/mermaid).

const Diagrams = {
  ready: false, cache: new Map(), n: 0,
  init() {
    if (this.ready || !window.mermaid) return;
    this.configure();
    this.ready = true;
    // Light/dark switch: recolour and redraw every diagram on the page.
    document.addEventListener('themechange', () => {
      this.configure(); this.cache.clear();
      document.querySelectorAll('.diagram[data-drawn]').forEach(el => el.removeAttribute('data-drawn'));
      this.drawAll();
    });
    // Draw diagrams wherever they appear (lessons stream in, chats update, etc.).
    new MutationObserver(() => { clearTimeout(this.t); this.t = setTimeout(() => this.drawAll(), 350); })
      .observe(document.body, { childList: true, subtree: true });
    this.drawAll();
  },
  configure() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const css = getComputedStyle(document.documentElement), v = name => css.getPropertyValue(name).trim();
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: 'Source Sans 3, Segoe UI, sans-serif',
      flowchart: { curve: 'basis', htmlLabels: false, nodeSpacing: 46, rankSpacing: 54, padding: 18, wrappingWidth: 220 }, gantt: { barHeight: 24, fontSize: 13, barGap: 6 },
      state: { padding: 10 }, sequence: { mirrorActors: false, messageMargin: 34 },
      themeVariables: {
        darkMode: dark, background: v('--sheet'), primaryColor: v('--blue-soft'), primaryBorderColor: v('--blue'), primaryTextColor: v('--ink'),
        lineColor: v('--ink-2'), secondaryColor: v('--green-soft'), tertiaryColor: v('--amber-soft'), textColor: v('--ink'), fontSize: '15px',
      },
    });
  },
  async drawAll(root = document) {
    // Boxes are sized by measuring the text, so measure it in the font it is shown in (fonts load on first use).
    if (!this.fontsOk) { try { await Promise.race([Promise.all(['400 15px', '600 15px', '650 13px', '650 12px'].map(f => document.fonts.load(`${f} 'Source Sans 3'`))), new Promise(r => setTimeout(r, 1500))]); } catch {} this.fontsOk = true; }
    if (typeof Viz !== 'undefined') Viz.drawAll(root);
    for (const el of root.querySelectorAll('.diagram:not(.viz):not([data-drawn])')) {
      el.setAttribute('data-drawn', '1');
      const src = decodeURIComponent(el.dataset.src || '');
      try {
        let svg = this.cache.get(src);
        if (!svg) {
          // Lessons written before the fact-checker repaired diagrams can hold invalid code: repair it by rule here.
          let code = src;
          if (typeof mermaidOk === 'function' && (await mermaidOk(code)) !== true && typeof mermaidTidy === 'function') { const t = mermaidTidy(code); if ((await mermaidOk(t)) === true) code = t; }
          svg = (await mermaid.render('dg' + (++this.n), code)).svg; this.cache.set(src, svg);
        }
        el.innerHTML = `<div class="dg-svg">${svg}</div><div class="dg-bar"><button class="link dg-play">▶ Play step by step</button><button class="link dg-src">Source</button></div>`;
        $('.dg-play', el).onclick = () => this.play(el);
        $('.dg-src', el).onclick = () => { toast('Copied the diagram source.'); navigator.clipboard && navigator.clipboard.writeText(src).catch(() => {}); };
        this.polish(el);
        if (typeof DiagramTools !== 'undefined') DiagramTools.attach(el);
      } catch (e) {
        // Half-written while streaming, or invalid: keep the source visible and retry on the next change.
        el.removeAttribute('data-drawn');
        document.querySelectorAll('[id^="ddg"], [id^="dg"]').forEach(x => { if (x.tagName === 'svg' && !x.closest('.diagram')) x.remove(); });
      }
    }
  },
  // Flowcharts read better with shape meaning: start/end rounded and green, decisions amber, steps blue, and
  // input/output in violet. Done on the drawn SVG, so the model's diagram code needs nothing special.
  polish(el) {
    const svg = $('svg', el);
    if (!svg) return;
    svg.classList.add('dg-polished');
    // With plain-SVG labels mermaid shows "<" as the literal text "&lt;" (n <= 1 becomes "n &lt;= 1"): put the characters back.
    const ent = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
    svg.querySelectorAll('text, tspan').forEach(t => {
      if (t.children.length) return;
      const s = t.textContent;
      if (/&(lt|gt|amp|quot|#39|#x27|nbsp);/.test(s)) { let v = s; for (let k = 0; k < 2; k++) v = v.replace(/&(lt|gt|amp|quot|#39|#x27|nbsp);/g, m => ent[m]); t.textContent = v; }
    });
    svg.querySelectorAll('g.node').forEach(g => {
      const label = (g.textContent || '').trim().toLowerCase();
      const shape = g.querySelector('rect, polygon, circle, path');
      // A decision is a diamond (two corners straight above each other); a slanted parallelogram is input/output.
      const poly = g.querySelector('polygon'), pts = poly ? (poly.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number) : [];
      const xs = []; for (let k = 0; k + 1 < pts.length; k += 2) xs.push(Math.round(pts[k]));
      const diamond = poly && xs.length === 4 && xs.some((x, k) => xs.indexOf(x) !== k);
      if (/^(read|input|print|output|display|write|scan)\b/.test(label) || (poly && !diamond)) g.classList.add('dg-io');
      else if (diamond) g.classList.add('dg-decision');
      else if (/^(start|begin|end|stop|done|finish|exit|return\b)/.test(label)) g.classList.add('dg-terminal');
      if (shape && shape.tagName === 'rect') { shape.setAttribute('rx', g.classList.contains('dg-terminal') ? 18 : 8); shape.setAttribute('ry', g.classList.contains('dg-terminal') ? 18 : 8); }
    });
    // arrow labels as rounded pills; sequence/state boxes rounded too
    svg.querySelectorAll('.edgeLabel rect, .labelBkg, rect.actor, g.stateGroup rect, .statediagram-state rect').forEach(r => { if (r.tagName === 'rect') { r.setAttribute('rx', 6); r.setAttribute('ry', 6); } });
    // each arrow label's background fitted to its text (after the fixes above), so no line shows through the letters
    svg.querySelectorAll('.edgeLabel').forEach(l => {
      const r = l.querySelector('rect'), t = l.querySelector('text');
      if (!r || !t || !t.textContent.trim()) return;
      try { const b = t.getBBox(); if (b.width) { r.setAttribute('x', b.x - 5); r.setAttribute('y', b.y - 2); r.setAttribute('width', b.width + 10); r.setAttribute('height', b.height + 4); } } catch {}
    });
  },
  // Lights up nodes, arrows and bars one by one, in drawing order.
  play(el) {
    const svg = $('svg', el);
    if (!svg) return;
    const parts = [...svg.querySelectorAll('g.node, path.flowchart-link, .edgeLabel, g.stateGroup, .actor, .messageLine0, .messageLine1, .messageText, rect.task, .taskText')]
      .filter(x => { const r = x.getBoundingClientRect(); return r.width > 0 || r.height > 0; });
    if (!parts.length) return;
    // Screen position (top to bottom, then left to right); an arrow counts from where it starts.
    const pos = x => { const r = x.getBoundingClientRect(); return x.matches('path') ? { y: r.top + 2, x: r.left } : { y: r.top + r.height / 2, x: r.left }; };
    const order = parts.map(p => ({ p, at: pos(p) })).sort((a, b) => (a.at.y - b.at.y) || (a.at.x - b.at.x)).map(o => o.p);
    (el._timers || []).forEach(clearTimeout);
    parts.forEach(p => p.classList.remove('dg-on'));
    svg.classList.add('dg-playing');
    el._timers = order.map((p, i) => setTimeout(() => p.classList.add('dg-on'), 420 * i));
    el._timers.push(setTimeout(() => { svg.classList.remove('dg-playing'); parts.forEach(p => p.classList.remove('dg-on')); }, 420 * order.length + 1500));
  },
};
window.addEventListener('load', () => Diagrams.init());

// Exact drawings for GATE topics: trees, graphs, automata (DFA/NFA), Gantt charts, arrays, stacks/queues,
// memory layouts and pipeline diagrams, drawn as SVG from a small JSON description (```viz blocks in any lesson,
// solution or chat answer, and the simulators' step-by-step frames). Unlike a picture made by a model, every
// node, edge and number is exactly what the data says. Colours come from the theme (light/dark) through CSS classes.
//
// Specs ({ "type": … }):
//   tree      { root: { v, c: [child|null, …] } }  or  { level: [v|null, …] } (level order, binary)
//   graph     { nodes: [..], edges: [[u, v, w?], …], directed?, highlight?: [[u, v], …], mark?: [v, …] }
//   dfa / nfa { states: [..], start, finals: [..], transitions: [[from, symbol, to], …] }
//   gantt     { bars: [[name, start, end], …] }            (CPU scheduling; idle = name "idle")
//   array     { cells: [..], highlight?: [i], pointers?: { "i": "label" }, title? }
//   stack / queue { items: [..] }  (bottom→top / front→rear)
//   memory    { blocks: [[label, size, "free"?], …], unit? }
//   pipeline  { stages: ["IF", "ID", …], rows: [[instr, firstCycle, stalls?], …] }
//   frames    { frames: [spec, …], captions: [..], start?: "last" }   (step-by-step, with ◀ ▶ and Play)
//   bits      { segments: [[label, bits, value?], …], title? }        (address split: tag | index | offset …)
//   range     { segments: [[label, from, to, startText, endText?], …], marks?: [[value, text]], title? }
//   track     { path: [head, …], min?, max?, jumps?: [leg index], title? }   (disk head movement)
//   kmap      { vars, names?, ones: [..], dc?: [..], groups?: ["1-0-", …], terms?: [..] }
//   refgrid   { refs: [..], slots: [[frame contents after each ref], …], faults: [bool], changed: [slot|-1], upto? }
//   table     { head: [..], rows: [[..]], hi?: [row], done?: [row], title? }
//   line      { points: [[x, y], …], hlines?: [[y, text]], marks?: [[x, text]], xLabel?, yLabel?, title? }
//   group     { items: [spec, …], titles?: [..], dir?: "row" | "col" }   (several drawings in one picture)
//   algo      { algorithm: "dijkstra" | "bfs" | "dfs" | "bubble" | "insertion" | "selection" | "merge" | "quick" | "heap"
//               | "lru" | "fifo" | "rr", …input }   (the steps are computed here, then played like frames)
// Gantt bars, graph nodes and edges, array cells and most other parts carry an SVG <title> (a hover tooltip).

const Viz = {
  esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  svg(w, h, body, title = '') {
    return `<svg class="vz" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" width="${Math.ceil(w)}" role="img" aria-label="${this.esc(title)}" xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="vzArrow" viewBox="0 0 12 10" refX="10.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="10" orient="auto-start-reverse"><path d="M0,0.8 L11,5 L0,9.2 L2.6,5 z" class="vz-arrowhead"/></marker>
      <marker id="vzArrowHi" viewBox="0 0 12 10" refX="10.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="10" orient="auto-start-reverse"><path d="M0,0.8 L11,5 L0,9.2 L2.6,5 z" class="vz-arrowhead hi"/></marker>
      </defs>${body}</svg>`;
  },
  text(x, y, t, cls = '', anchor = 'middle') { return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="central" class="vz-t ${cls}">${this.esc(t)}</text>`; },
  // Width of a label in the drawing's own font (measured, so boxes, circles and spacing fit the real text), plus padding.
  textW(t, size = 13, fam) {
    const s = String(t ?? '');
    if (!this._ctx) { try { this._ctx = document.createElement('canvas').getContext('2d'); } catch { this._ctx = null; } }
    if (!this._ctx) return (fam === 'mono' ? 8.2 : 7.6) * s.length * size / 13 + 6;
    this._ctx.font = fam === 'mono' ? `600 ${size}px Consolas, 'Cascadia Mono', ui-monospace, monospace` : `650 ${size}px 'Source Sans 3', 'Segoe UI', system-ui, sans-serif`;
    return Math.ceil(this._ctx.measureText(s).width + 0.13 * s.length + 10);
  },
  tip(t) { return t == null || t === '' ? '' : `<title>${this.esc(t)}</title>`; },
  num(x) { return typeof x === 'number' && isFinite(x) ? String(+x.toFixed(4)) : String(x ?? ''); },
  // Labels in rows: each { x, w, anchor } goes to the first row where it touches no label already there. Returns rows.
  rowPlace(items, gap = 4) {
    const ends = [];
    return items.map(it => {
      const l = it.anchor === 'start' ? it.x : it.anchor === 'end' ? it.x - it.w : it.x - it.w / 2, r = l + it.w;
      let row = 0; while ((ends[row] || []).some(([a, b]) => l < b + gap && a < r + gap)) row++;
      (ends[row] = ends[row] || []).push([l, r]);
      return row;
    });
  },
  // The parts of a drawing ({ w, h, body }) without its <svg> wrapper, so several can be placed in one picture.
  parts(spec) {
    const o = this.svg; let got = null;
    this.svg = (w, h, body, title) => { got = { w, h, body, title }; return ''; };
    try { this.render(spec); } finally { this.svg = o; }
    return got || { w: 10, h: 10, body: '' };
  },
  // Places edge labels: for each edge, the first spot along it (middle first) that covers no node, no other label and
  // no other line. edges: [{ g: geometry from edgePath, text }], circles: [{ x, y, r }]. Returns [{ x, y, w }].
  placeLabels(edges, circles) {
    const pts = edges.map(e => Array.from({ length: 33 }, (_, k) => e.g.at(k / 32)));
    const placed = [], out = [];
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    edges.forEach((e, i) => {
      if (e.text == null || e.text === '') { out.push(null); return; }
      const w = this.textW(e.text, 12), h = 20;
      const ts = e.g.loop ? [0.5] : [0.5, 0.4, 0.6, 0.32, 0.68, 0.25, 0.75, 0.18, 0.82];
      let best = null, bestCost = Infinity;
      for (const t of ts) for (const side of e.g.curved || e.g.loop ? [0] : [1, -1]) {
        const p = e.g.at(t), x = p.x + side * 13 * e.g.nx, y = p.y + side * 13 * e.g.ny, box = { x: x - w / 2, y: y - h / 2, w, h };
        let cost = Math.abs(t - 0.45) * 2 + (side < 0 ? 0.3 : 0);
        for (const c of circles) { const qx = Math.max(box.x, Math.min(c.x, box.x + w)), qy = Math.max(box.y, Math.min(c.y, box.y + h)); if (Math.hypot(qx - c.x, qy - c.y) < c.r + 3) cost += 100; }
        for (const b of placed) if (hit({ x: box.x - 3, y: box.y - 2, w: w + 6, h: h + 4 }, b)) cost += 60;
        // another line under the label is bad; one just beside it makes it unclear which line the label belongs to
        pts.forEach((ps, k) => { if (k === i) return; if (ps.some(q => q.x > box.x + 1 && q.x < box.x + w - 1 && q.y > box.y + 1 && q.y < box.y + h - 1)) cost += 8; else if (ps.some(q => q.x > box.x - 7 && q.x < box.x + w + 7 && q.y > box.y - 7 && q.y < box.y + h + 7)) cost += 2.5; });
        if (cost < bestCost) { bestCost = cost; best = { x, y, w, box }; }
        if (cost < 1) break;
      }
      placed.push(best.box);
      out.push(best);
    });
    return out;
  },
  pill(l, text) { return l ? `<g class="vz-elabel"><rect x="${(l.x - l.w / 2).toFixed(1)}" y="${(l.y - 10).toFixed(1)}" width="${l.w}" height="20" rx="6"/>${this.text(l.x, l.y, text)}</g>` : ''; },
  // After a drawing is on the page: grow the picture so nothing (a self-loop label, a long name) is cut off at the edge.
  fit(svg) {
    if (!svg || !svg.viewBox || !svg.viewBox.baseVal) return;
    let bb; try { bb = svg.getBBox(); } catch { return; }
    if (!bb || !bb.width) return;   // not displayed yet
    const vb = svg.viewBox.baseVal, pad = 6;
    const x0 = Math.min(vb.x, bb.x - pad), y0 = Math.min(vb.y, bb.y - pad), x1 = Math.max(vb.x + vb.width, bb.x + bb.width + pad), y1 = Math.max(vb.y + vb.height, bb.y + bb.height + pad);
    if (x0 < vb.x || y0 < vb.y || x1 > vb.x + vb.width || y1 > vb.y + vb.height) {
      svg.setAttribute('viewBox', `${Math.floor(x0)} ${Math.floor(y0)} ${Math.ceil(x1 - x0)} ${Math.ceil(y1 - y0)}`);
      svg.setAttribute('width', Math.ceil(x1 - x0));
    }
  },
  render(spec) {
    if (!spec || typeof spec !== 'object') throw new Error('A drawing must be a JSON object with a "type".');
    const f = this.kinds[spec && spec.type];
    if (!f) throw new Error(`Unknown drawing type "${spec && spec.type}"`);
    return f.call(this, spec);
  },
  kinds: {
    // ---------- trees: tidy layout (leaves left to right, parents centred over their children) ----------
    tree(s) {
      let root = s.root;
      if (!root && s.level) {   // level order with nulls: index i has children 2i+1, 2i+2
        const mk = i => i < s.level.length && s.level[i] != null && s.level[i] !== '' ? { v: s.level[i], c: [mk(2 * i + 1), mk(2 * i + 2)] } : null;
        root = mk(0);
      }
      if (!root) return this.svg(60, 30, this.text(30, 15, '(empty tree)', 'muted'));
      const hi = new Set((s.highlight || []).map(String)), R = 19;
      let dx = 52, dy = 64;
      let next = 0, maxD = 0;
      // Binary nodes ([left, right], either may be null) get in-order positions, so a left child is always to the
      // left and a right child to the right (what BST/AVL/heap questions need). Other nodes: centred over children.
      const place = (n, d) => {
        if (!n) return null;
        maxD = Math.max(maxD, d);
        const kids = n.c || [];
        if (kids.length === 2) {
          const l = place(kids[0], d + 1), x = next++, r = place(kids[1], d + 1);
          return { v: n.v, x, d, kids: [l, r], mark: n.mark };
        }
        const placed = kids.map(k => place(k, d + 1)), real = placed.filter(Boolean);
        const x = real.length ? (real[0].x + real[real.length - 1].x) / 2 : next++;
        return { v: n.v, x, d, kids: placed, mark: n.mark };
      };
      const t = place(root, 0);
      let minX = Infinity, maxX = -Infinity;
      const walk = n => { if (!n) return; minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); n.kids.forEach(walk); };
      walk(t);
      // spacing from the widest node, so long keys never collide with their neighbours
      // A short key sits in a circle; a long one in a rounded pill of the same height (a giant circle looks wrong).
      const half = v => Math.max(R, this.textW(v) / 2 + 3);
      const allR = []; const rw = n => { if (!n) return; allR.push(half(n.v)); n.kids.forEach(rw); }; rw(t);
      const maxR = Math.max(...allR); dx = Math.max(dx, 2 * maxR + 12);
      const X = x => maxR + 12 + (x - minX) * dx, Y = d => R + 10 + d * dy;
      let edges = '', nodes = '';
      const draw = n => {
        if (!n) return;
        n.kids.forEach(k => { if (k) edges += `<line x1="${X(n.x)}" y1="${Y(n.d)}" x2="${X(k.x)}" y2="${Y(k.d)}" class="vz-edge"/>`; draw(k); });
        const on = hi.has(String(n.v)) || n.mark;
        const label = String(n.v), hw = half(label), cx = X(n.x), cy = Y(n.d);
        const shape = hw > R + 4 ? `<rect x="${cx - hw}" y="${cy - R}" width="${2 * hw}" height="${2 * R}" rx="${R}"/>` : `<circle cx="${cx}" cy="${cy}" r="${R}"/>`;
        nodes += `<g class="vz-node ${on ? 'hi' : ''}">${shape}${this.text(cx, cy, label)}</g>`;
      };
      draw(t);
      return this.svg(X(maxX) + maxR + 12, Y(maxD) + R + 10, edges + nodes, 'Tree');
    },
    // ---------- graphs: circle layout for small graphs, a few rounds of spring layout otherwise ----------
    graph(s) {
      const ids = [...new Set([...(s.nodes || []), ...(s.edges || []).flatMap(e => [e[0], e[1]])].map(String))];
      const n = ids.length, pos = {};
      const W = Math.max(260, 70 * Math.sqrt(n) * 2.2), H = W * 0.72, cx = W / 2, cy = H / 2;
      const order = n <= 10 ? this.fewestCrossings(ids, s.edges || []) : ids;
      order.forEach((id, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / n; pos[id] = { x: cx + (W / 2 - 40) * Math.cos(a), y: cy + (H / 2 - 36) * Math.sin(a) }; });
      if (n > 10) this.spring(ids, s.edges || [], pos, W, H);
      const hi = new Set((s.highlight || []).map(e => `${e[0]}|${e[1]}`)), mark = new Set((s.mark || []).map(String));
      const pairs = new Set((s.edges || []).map(e => `${e[0]}|${e[1]}`));
      let edges = '', labels = '', nodes = '';
      const rad = id => Math.max(20, this.textW(id) / 2 + 3), drawn = [], grp = s.groups || {}, tips = s.tips || {};
      const deg = {}; (s.edges || []).forEach(e => { deg[e[0]] = (deg[e[0]] || 0) + 1; if (String(e[0]) !== String(e[1])) deg[e[1]] = (deg[e[1]] || 0) + 1; });
      for (const e of s.edges || []) {
        const [u, v, w] = [String(e[0]), String(e[1]), e[2]], a = pos[u], b = pos[v];
        const on = hi.has(`${u}|${v}`) || (!s.directed && hi.has(`${v}|${u}`));
        const back = s.directed && pairs.has(`${v}|${u}`) && u !== v;
        const g = this.edgePath(a, b, rad(u), back ? 26 : 0, s.directed, rad(v));
        // a wide invisible stroke under the edge makes its tooltip easy to hover
        const tip = this.tip(`${u} ${s.directed ? '→' : '–'} ${v}${w != null && w !== '' ? `, weight ${w}` : ''}${on ? ' (highlighted)' : ''}`);
        edges += `<path d="${g.path}" class="vz-hover">${tip}</path><path d="${g.path}" class="vz-edge ${on ? 'hi' : ''}" ${s.directed ? `marker-end="url(#${on ? 'vzArrowHi' : 'vzArrow'})"` : ''}>${tip}</path>`;
        drawn.push({ g, text: w });
      }
      this.placeLabels(drawn, ids.map(id => ({ ...pos[id], r: rad(id) }))).forEach((l, k) => { labels += this.pill(l, drawn[k].text); });
      for (const id of ids) {
        const gk = grp[id] != null && !mark.has(id) ? ` grp c${(+grp[id] || 0) % 6}` : '';
        nodes += `<g class="vz-node ${mark.has(id) ? 'hi' : ''}${gk}">${this.tip(tips[id] || `${id}: ${deg[id] || 0} edge${deg[id] === 1 ? '' : 's'}`)}<circle cx="${pos[id].x}" cy="${pos[id].y}" r="${rad(id)}"/>${this.text(pos[id].x, pos[id].y, id)}</g>`;
      }
      return this.svg(W, H, edges + labels + nodes, 'Graph');
    },
    // ---------- automata: states in layers by distance from the start state ----------
    dfa(s) { return this.automaton(s); },
    nfa(s) { return this.automaton(s); },
    // ---------- Gantt chart ----------
    gantt(s) {
      const bars = (s.bars || []).map(b => ({ name: String(b[0]), a: +b[1], b: +b[2], tip: b[3] })).filter(b => isFinite(b.a) && isFinite(b.b) && b.b > b.a);
      if (!bars.length) return this.svg(80, 30, this.text(40, 15, '(no bars)', 'muted'));
      const end = Math.max(+s.end || 0, ...bars.map(b => b.b)), start = Math.min(0, ...bars.map(b => b.a)), unit = Math.max(26, Math.min(60, 640 / (end - start)));
      const X = t => 14 + (t - start) * unit, names = [...new Set(bars.filter(b => b.name !== 'idle').map(b => b.name))];
      // A name too wide for its bar goes above it, with a short leader line; above-names that would touch
      // each other step up a row. Bars sit on the time axis, and every bar edge has a tick and its time.
      const lift = [], aboveRows = [];
      for (const b of bars) {
        const w = this.textW(b.name), cx = (X(b.a) + X(b.b)) / 2;
        if (w <= X(b.b) - X(b.a) - 2) { lift.push(0); continue; }
        let row = 0; while ((aboveRows[row] || []).some(([l, r]) => cx - w / 2 < r + 4 && l < cx + w / 2 + 4)) row++;
        (aboveRows[row] = aboveRows[row] || []).push([cx - w / 2, cx + w / 2]); lift.push(row + 1);
      }
      const top = 14 + 18 * aboveRows.length, barB = top + 40;
      let g = '';
      bars.forEach((b, i) => {
        const idle = /^(idle|cs)$/i.test(b.name), k = names.filter(n => !/^cs$/i.test(n)).indexOf(b.name), cx = (X(b.a) + X(b.b)) / 2;
        const lab = lift[i] ? `<line x1="${cx}" y1="${top - 18 * (lift[i] - 1) - 6}" x2="${cx}" y2="${top + 6}" class="vz-axis vz-lead"/>${this.text(cx, top - 18 * lift[i] + 4, b.name, 'gname')}` : this.text(cx, top + 20, b.name);
        const tip = b.tip || (b.name.toLowerCase() === 'idle' ? `CPU idle ${this.num(b.a)}–${this.num(b.b)}` : /^cs$/i.test(b.name) ? `Context switch ${this.num(b.a)}–${this.num(b.b)}` : `${b.name} runs ${this.num(b.a)}–${this.num(b.b)} (${this.num(b.b - b.a)} units)`);
        g += `<g class="vz-bar ${idle ? 'idle' : 'c' + (k % 6)}">${this.tip(tip)}<rect x="${X(b.a)}" y="${top}" width="${X(b.b) - X(b.a)}" height="40" rx="4"/>${lab}</g>`;
      });
      // time labels: a second row when two would touch (short bars)
      const ticks = [...new Set(bars.flatMap(b => [b.a, b.b]))].sort((a, b) => a - b), tickEnd = [-1e9, -1e9];
      g += `<line x1="${X(start)}" y1="${barB + 3}" x2="${X(end)}" y2="${barB + 3}" class="vz-axis vz-base"/>`;
      let low = false;
      for (const t of ticks) {
        const lab = String(+t.toFixed(2)), w = this.textW(lab, 11) - 4, x = X(t);
        const row = x - w / 2 >= tickEnd[0] + 3 ? 0 : x - w / 2 >= tickEnd[1] + 3 ? 1 : 0;
        tickEnd[row] = x + w / 2; if (row) low = true;
        g += `<line x1="${x}" y1="${barB}" x2="${x}" y2="${barB + 7 + 13 * row}" class="vz-axis"/>${this.text(x, barB + 17 + 13 * row, lab, 'idx')}`;
      }
      return this.svg(X(end) + 18, barB + (low ? 43 : 30), g, 'Gantt chart');
    },
    // ---------- array with indices, highlights and named pointers ----------
    array(s) {
      const cells = s.cells || [], hi = new Set((s.highlight || []).map(Number)), done = new Set((s.done || []).map(Number)), ptr = s.pointers || {};
      // index labels: 0, 1, 2 … (or 1, 2, 3 … with base1, or names, e.g. the vertices of a distance table)
      const idx = i => Array.isArray(s.index) ? s.index[i] ?? '' : s.base1 ? i + 1 : i;
      const cw = Math.max(40, ...cells.map(c => this.textW(c)), ...(Array.isArray(s.index) ? s.index.map(t => this.textW(t, 11)) : [])), top = s.title ? 26 : 8;
      let g = s.title ? this.text(10, 12, s.title, 'muted', 'start') : '';
      cells.forEach((c, i) => {
        const tip = (s.tips || [])[i] || `${Array.isArray(s.index) ? idx(i) : `index ${idx(i)}`}: ${c ?? ''}${hi.has(i) ? ' (highlighted)' : ''}`;
        g += `<g class="vz-cell ${hi.has(i) ? 'hi' : done.has(i) ? 'done' : ''}">${this.tip(tip)}<rect x="${10 + i * cw}" y="${top}" width="${cw}" height="38"/>${this.text(10 + i * cw + cw / 2, top + 19, c ?? '')}</g>${this.text(10 + i * cw + cw / 2, top + 50, idx(i), 'idx')}`;
      });
      // Pointers (a pointer one past the end, like high = n, is drawn there too). A label that would touch its
      // neighbour drops to the next row, with a longer arrow; two pointers on one cell share a label.
      const at = {};
      Object.entries(ptr).forEach(([i, lab]) => { const k = Math.round(+i); if (isFinite(k) && k >= -1) (at[k] = at[k] || []).push(lab); });
      const ends = [], rowsUsed = [];
      let span = cells.length;
      Object.keys(at).map(Number).sort((a, b) => a - b).forEach(k => {
        const lab = at[k].join(', '), x = 10 + k * cw + cw / 2, w = this.textW(lab, 12) - 6;
        let row = 0; while (ends[row] != null && x - w / 2 < ends[row] + 6) row++;
        ends[row] = x + w / 2; rowsUsed[row] = 1; span = Math.max(span, k + 1);
        const y = top + 94 + 16 * row;
        g += `<path d="M${x},${y - 10} L${x},${top + 62}" class="vz-edge hi" marker-end="url(#vzArrowHi)"/>${this.text(x, y, lab, 'ptr')}`;
      });
      const width = Math.max(20 + span * cw, s.title ? this.textW(s.title, 11) + 14 : 0, ...ends.filter(e => e != null).map(e => e + 8));
      return this.svg(width, top + (rowsUsed.length ? 104 + 16 * (rowsUsed.length - 1) : 62), g, 'Array');
    },
    stack(s) {
      const items = s.items || [], cw = Math.max(70, ...items.map(c => this.textW(c) + 16)), h = 34;
      let g = items.map((it, i) => `<g class="vz-cell ${i === items.length - 1 ? 'hi' : ''}"><rect x="30" y="${10 + (items.length - 1 - i) * h}" width="${cw}" height="${h}"/>${this.text(30 + cw / 2, 10 + (items.length - 1 - i) * h + h / 2, it)}</g>`).join('');
      g += `<path d="M24,6 L24,${12 + items.length * h} L${36 + cw},${12 + items.length * h} L${36 + cw},6" class="vz-axis" fill="none"/>`;
      if (items.length) g += this.text(46 + cw, 10 + h / 2, '← top', 'ptr', 'start');
      return this.svg(cw + 110, items.length * h + 24, g, 'Stack');
    },
    queue(s) {
      const items = s.items || [], cw = Math.max(48, ...items.map(c => this.textW(c)));
      let g = items.map((it, i) => `<g class="vz-cell"><rect x="${50 + i * cw}" y="14" width="${cw}" height="36"/>${this.text(50 + i * cw + cw / 2, 32, it)}</g>`).join('');
      if (!items.length) { g += `<g class="vz-cell later"><rect x="50" y="14" width="${cw + 20}" height="36"/>${this.text(60 + cw / 2, 32, 'empty', 'muted')}</g>`; }
      const n = Math.max(items.length, items.length ? 0 : 1), extra = items.length ? 0 : 20;
      g += this.text(25, 32, 'front', 'ptr') + this.text(75 + n * cw + extra, 32, 'rear', 'ptr');
      return this.svg(110 + n * cw + extra, 64, g, 'Queue');
    },
    // ---------- memory layout (partitions, segments, pages) ----------
    memory(s) {
      const blocks = (s.blocks || []).map(b => ({ label: String(b[0]), size: +b[1] || 1, free: b[2] === 'free' || /^free|hole$/i.test(b[0]) }));
      const total = blocks.reduce((a, b) => a + b.size, 0) || 1, H = Math.max(160, Math.min(420, blocks.length * 40));
      const W = Math.max(220, ...blocks.map(b => this.textW(`${b.label} (${b.size}${s.unit || ''})`) + 50));
      let y = 10, g = '', k = 0;
      for (const b of blocks) {   // each process its own colour; holes dashed
        const h = Math.max(22, H * b.size / total);
        g += `<g class="${b.free ? 'vz-cell free' : `vz-bar c${k++ % 6} vz-mem`}"><rect x="20" y="${y}" width="${W - 40}" height="${h}"/>${this.text(W / 2, y + h / 2, `${b.label} (${b.size}${s.unit || ''})`)}</g>`;
        y += h;
      }
      return this.svg(W, y + 10, g, 'Memory');
    },
    // ---------- pipeline space-time diagram ----------
    pipeline(s) {
      const st = s.stages || ['IF', 'ID', 'EX', 'MEM', 'WB'], rows = s.rows || [];
      // columns as wide as the longest stage name, the name column as wide as the longest instruction
      const cyc = Math.max(1, ...rows.map(r => (+r[1] || 1) + (+r[2] || 0) + st.length - 1)), rh = 30;
      const cw = Math.max(44, ...st.map(n => this.textW(n) + 6), rows.some(r => +r[2]) ? this.textW('stall') + 6 : 0), lw = Math.max(70, ...rows.map(r => this.textW(r[0]) + 12));
      let g = Array.from({ length: cyc }, (_, c) => this.text(lw + c * cw + cw / 2, 12, c + 1, 'idx')).join('');
      rows.forEach((r, i) => {
        const y = 24 + i * rh, first = +r[1] || i + 1, stalls = +r[2] || 0;
        g += this.text(8, y + rh / 2 - 2, r[0], '', 'start');
        st.forEach((name, k) => {
          const c = first - 1 + k + (k >= 2 ? stalls : 0);   // stalls are inserted before EX
          if (s.upto != null && c + 1 > +s.upto) return;     // step by step: only the cycles so far
          g += `<g class="vz-bar c${k % 6}">${this.tip(`${r[0]} in ${name}: cycle ${c + 1}`)}<rect x="${lw + c * cw + 1}" y="${y}" width="${cw - 2}" height="${rh - 4}" rx="3"/>${this.text(lw + c * cw + cw / 2, y + rh / 2 - 2, name)}</g>`;
        });
        for (let q = 0; q < stalls; q++) { const c = first - 1 + 2 + q; if (s.upto != null && c + 1 > +s.upto) continue; g +=`<g class="vz-bar idle"><rect x="${lw + c * cw + 1}" y="${y}" width="${cw - 2}" height="${rh - 4}" rx="3"/>${this.text(lw + c * cw + cw / 2, y + rh / 2 - 2, 'stall')}</g>`; }
      });
      if (s.upto != null && +s.upto >= 1 && +s.upto <= cyc) g += `<rect x="${lw + (s.upto - 1) * cw - 1}" y="2" width="${cw + 2}" height="${22 + rows.length * rh}" rx="5" class="vz-cur"/>`;
      return this.svg(lw + cyc * cw + 10, 30 + rows.length * rh, g, 'Pipeline');
    },
    // ---------- step-by-step frames: drawn by the stepper (see mount) ----------
    frames(s) {
      const fr = s.frames || [];
      if (!Array.isArray(fr) || !fr.length) throw new Error('Frames need "frames": [drawing, …].');
      return this.render(fr[s.start === 'last' ? fr.length - 1 : 0]);
    },
    // ---------- several drawings in one picture (one above the other, or side by side) ----------
    group(s) {
      const items = (s.items || []).map(x => this.parts(x)), titles = s.titles || [], row = s.dir === 'row', gap = row ? 28 : 18;
      if (!items.length) throw new Error('A group needs "items": [drawing, …].');
      const tw = items.map((p, i) => titles[i] ? this.textW(titles[i], 11) + 4 : 0), th = items.map((p, i) => titles[i] ? 18 : 0);
      const W = row ? items.reduce((a, p, i) => a + Math.max(p.w, tw[i]), 0) + gap * (items.length - 1) : Math.max(...items.map((p, i) => Math.max(p.w, tw[i])));
      const H = row ? Math.max(...items.map((p, i) => p.h + th[i])) : items.reduce((a, p, i) => a + p.h + th[i], 0) + gap * (items.length - 1);
      let x = 0, y = 0, g = '';
      items.forEach((p, i) => {
        const w = Math.max(p.w, tw[i]), ox = row ? x : (W - w) / 2;   // stacked drawings are centred
        if (titles[i]) g += this.text(ox + 6, y + 8, titles[i], 'muted', 'start');
        g += `<g transform="translate(${ox.toFixed(1)},${(y + th[i]).toFixed(1)})">${p.body}</g>`;
        if (row) x += w + gap; else y += p.h + th[i] + gap;
      });
      return this.svg(W, H, g, s.title || 'Drawing');
    },
    // ---------- an address split into fields (tag | index | offset, page number | offset, network | host) ----------
    bits(s) {
      const segs = (s.segments || []).map(x => ({ label: String(x[0]), n: Math.round(+x[1]), val: x[2] == null ? '' : String(x[2]) })).filter(x => x.n > 0);
      if (!segs.length) throw new Error('A bit split needs "segments": [[label, bits], …] with at least one field.');
      const total = segs.reduce((a, x) => a + x.n, 0), u = Math.max(320, Math.min(600, total * 20)) / total;
      const nb = n => `${n} bit${n > 1 ? 's' : ''}`;
      let hi = total - 1;
      segs.forEach(x => {
        x.hi = hi; x.lo = hi - x.n + 1; hi = x.lo - 1;
        // proportional to the bits, but never narrower than its own text
        x.w = Math.max(x.n * u, this.textW(x.label) + 8, this.textW(nb(x.n), 11) + 2, x.val ? this.textW(x.val, 12, 'mono') + 4 : 0, x.n > 1 ? this.textW(`${x.hi}–${x.lo}`, 11) : 0);
      });
      const L = 10, top = (s.title ? 22 : 2) + 18, h = 46, anyVal = segs.some(x => x.val);
      let g = s.title ? this.text(L, 10, s.title, 'muted', 'start') : '', x = L;
      segs.forEach((seg, k) => {
        g += `<g class="vz-bar c${k % 6} vz-seg">${this.tip(`${seg.label}: ${nb(seg.n)} (bit ${seg.hi}${seg.n > 1 ? ` down to ${seg.lo}` : ''})${seg.val ? ` = ${seg.val}` : ''}`)}<rect x="${x}" y="${top}" width="${seg.w}" height="${h}" rx="4"/>${this.text(x + seg.w / 2, top + 16, seg.label)}${this.text(x + seg.w / 2, top + 33, nb(seg.n), 'idx')}</g>`;
        if (seg.val) g += this.text(x + seg.w / 2, top + h + 14, seg.val, 'bitv');
        // bit numbers above: the field's highest bit at its left edge, its lowest at the right edge
        const a = this.textW(seg.hi, 11) - 10, b = this.textW(seg.lo, 11) - 10;
        if (seg.n === 1) g += this.text(x + seg.w / 2, top - 9, seg.hi, 'idx');
        else if (a + b + 10 < seg.w) g += this.text(x + 3, top - 9, seg.hi, 'idx', 'start') + this.text(x + seg.w - 3, top - 9, seg.lo, 'idx', 'end');
        else g += this.text(x + seg.w / 2, top - 9, `${seg.hi}–${seg.lo}`, 'idx');
        x += seg.w;
      });
      const tot = `= ${total} bits`;
      g += this.text(x + 10, top + h / 2, tot, 'muted', 'start');
      return this.svg(x + 10 + this.textW(tot, 11) + 2, top + h + (anyVal ? 26 : 8), g, 'Address fields');
    },
    // ---------- a block of numbers (an IP subnet: network | hosts | broadcast) with the given value marked ----------
    range(s) {
      const segs = (s.segments || []).map(x => ({ label: String(x[0]), a: +x[1], b: +x[2], st: x[3] == null ? '' : String(x[3]), et: x[4] == null ? '' : String(x[4]) }));
      if (!segs.length || segs.some(x => !isFinite(x.a) || !isFinite(x.b) || x.b < x.a)) throw new Error('A range needs "segments": [[label, from, to, startText, endText], …] with from ≤ to.');
      const span = segs.reduce((t, x) => t + x.b - x.a + 1, 0);
      segs.forEach(x => { x.w = Math.max((x.b - x.a + 1) / span * 520, this.textW(x.label) + 12); });
      const L = 10, marks = (s.marks || []).map(m => ({ v: +m[0], t: String(m[1]) })).filter(m => isFinite(m.v));
      let x = L; segs.forEach(sg => { sg.x = x; x += sg.w; });
      const at = v => { const sg = segs.find(q => v >= q.a && v <= q.b); if (!sg) return null; return sg.a === sg.b ? sg.x + sg.w / 2 : Math.min(sg.x + sg.w - 5, Math.max(sg.x + 5, sg.x + (v - sg.a) / (sg.b - sg.a) * sg.w)); };
      const mk = marks.map(m => ({ ...m, x: at(m.v), w: this.textW(m.t, 12) - 6 })).filter(m => m.x != null);
      const mrow = this.rowPlace(mk.map(m => ({ x: m.x, w: m.w }))), mRows = mk.length ? Math.max(...mrow) + 1 : 0;
      const top = (s.title ? 22 : 4) + (mRows ? 16 * mRows + 18 : 0), h = 40;
      let g = s.title ? this.text(L, 10, s.title, 'muted', 'start') : '';
      segs.forEach((sg, k) => { g += `<g class="vz-bar c${k % 6} vz-seg">${this.tip(`${sg.label}: ${sg.st}${sg.et && sg.a !== sg.b ? ` to ${sg.et}` : ''}`)}<rect x="${sg.x}" y="${top}" width="${sg.w}" height="${h}" rx="4"/>${this.text(sg.x + sg.w / 2, top + h / 2, sg.label)}</g>`; });
      mk.forEach((m, k) => {
        const y = top - 18 - 16 * mrow[k];
        g += `<path d="M${m.x},${y + 7} L${m.x},${top - 2}" class="vz-edge hi" marker-end="url(#vzArrowHi)"/>${this.text(m.x, y, m.t, 'ptr')}`;
      });
      // the numbers at each end of each part, below the bar; crowded ones drop a row
      const ends = [];
      segs.forEach(sg => {
        if (sg.a === sg.b || !sg.et) ends.push({ x: sg.x + sg.w / 2, t: sg.st, anchor: 'middle', tick: sg.x + sg.w / 2 });
        else ends.push({ x: sg.x + 3, t: sg.st, anchor: 'start', tick: sg.x + 1 }, { x: sg.x + sg.w - 3, t: sg.et, anchor: 'end', tick: sg.x + sg.w - 1 });
      });
      const er = this.rowPlace(ends.map(e => ({ x: e.x, w: this.textW(e.t, 11) - 8, anchor: e.anchor })), 6);
      ends.forEach((e, k) => { const y = top + h + 14 + 14 * er[k]; if (er[k]) g += `<line x1="${e.tick}" y1="${top + h + 2}" x2="${e.tick}" y2="${y - 6}" class="vz-axis vz-lead"/>`; g += this.text(e.x, y, e.t, 'idx', e.anchor); });
      const rightMost = Math.max(x, ...ends.map((e, k) => e.anchor === 'middle' ? e.x + this.textW(e.t, 11) / 2 : e.x + (e.anchor === 'start' ? this.textW(e.t, 11) : 0)), ...mk.map(m => m.x + m.w / 2));
      return this.svg(rightMost + 10, top + h + 22 + 14 * (ends.length ? Math.max(...er) : 0), g, 'Range');
    },
    // ---------- disk head movement: cylinder across, one row per move down ----------
    track(s) {
      const path = (s.path || []).map(Number);
      if (path.length < 2 || path.some(v => !isFinite(v))) throw new Error('A head-movement chart needs "path": [head, next cylinder, …].');
      const lo = Math.min(isFinite(+s.min) && s.min !== null && s.min !== '' ? +s.min : Infinity, ...path), hi = Math.max(isFinite(+s.max) && s.max !== null && s.max !== '' ? +s.max : -Infinity, ...path);
      const W = Math.max(440, Math.min(660, (hi - lo) * 3)), L = 34, rowH = 30, top = (s.title ? 22 : 4) + 30, jumps = new Set((s.jumps || []).map(Number));
      const X = c => L + (c - lo) / (hi - lo || 1) * W, Y = i => top + 18 + i * rowH;
      let g = s.title ? this.text(10, 10, s.title, 'muted', 'start') : '';
      g += `<line x1="${X(lo)}" y1="${top}" x2="${X(hi)}" y2="${top}" class="vz-axis vz-base"/>`;
      [...new Set(path)].forEach(c => { g += `<line x1="${X(c)}" y1="${top - 4}" x2="${X(c)}" y2="${top + 4}" class="vz-axis"/>`; });
      g += `<line x1="${X(lo)}" y1="${top - 6}" x2="${X(lo)}" y2="${top + 6}" class="vz-axis"/><line x1="${X(hi)}" y1="${top - 6}" x2="${X(hi)}" y2="${top + 6}" class="vz-axis"/>`;
      g += this.text(X(lo), top - 14, lo, 'idx') + this.text(X(hi), top - 14, hi, 'idx') + this.text((X(lo) + X(hi)) / 2, top - 14, 'cylinder →', 'idx');
      const P = path.map((c, i) => ({ x: X(c), y: Y(i) })), segs = [];
      let total = 0;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1], d = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, mv = Math.abs(path[i + 1] - path[i]);
        total += mv;
        g += `<path d="M${(a.x + ux * 5).toFixed(1)},${(a.y + uy * 5).toFixed(1)} L${(b.x - ux * 6).toFixed(1)},${(b.y - uy * 6).toFixed(1)}" class="vz-hover">${this.tip(`${path[i]} → ${path[i + 1]}: ${mv} cylinders${jumps.has(i) ? ' (return jump)' : ''}`)}</path>`;
        g += `<path d="M${(a.x + ux * 5).toFixed(1)},${(a.y + uy * 5).toFixed(1)} L${(b.x - ux * 6).toFixed(1)},${(b.y - uy * 6).toFixed(1)}" class="vz-edge ${jumps.has(i) ? 'jump' : 'hi'}" marker-end="url(#${jumps.has(i) ? 'vzArrow' : 'vzArrowHi'})">${this.tip(`${path[i]} → ${path[i + 1]}: ${mv} cylinders${jumps.has(i) ? ' (return jump)' : ''}`)}</path>`;
        for (let k = 0; k <= 16; k++) segs.push({ x: a.x + (b.x - a.x) * k / 16, y: a.y + (b.y - a.y) * k / 16 });
      }
      // each cylinder number goes beside its dot, on the side no line passes through
      const placed = [];
      P.forEach((p, i) => {
        const t = String(path[i]) + (i === 0 ? ' (head)' : ''), w = this.textW(t, 12) - 6, hgt = 14;
        let best = null, bestC = Infinity;
        for (const [dx, dy, an] of [[9, 0, 'start'], [-9, 0, 'end'], [9, -11, 'start'], [-9, -11, 'end'], [9, 11, 'start'], [-9, 11, 'end'], [0, -14, 'middle'], [0, 14, 'middle']]) {
          const bx = an === 'start' ? p.x + dx : an === 'end' ? p.x + dx - w : p.x - w / 2, box = { x: bx, y: p.y + dy - hgt / 2, w, h: hgt };
          let c = Math.abs(dy) / 20 + (dx < 0 ? 0.1 : 0);
          for (const q of segs) if (q.x > box.x - 2 && q.x < box.x + w + 2 && q.y > box.y - 2 && q.y < box.y + hgt + 2) c += 5;
          for (const b of placed) if (box.x < b.x + b.w + 3 && b.x < box.x + w + 3 && box.y < b.y + b.h && b.y < box.y + hgt) c += 40;
          if (box.x < 2) c += 20;
          if (c < bestC) { bestC = c; best = { box, x: p.x + dx, y: p.y + dy, an }; }
        }
        placed.push(best.box);
        g += `<circle cx="${p.x}" cy="${p.y}" r="4.5" class="vz-dot ${i === 0 ? 'head' : ''}">${this.tip(`${i === 0 ? 'Head starts at' : `Move ${i}: to`} cylinder ${path[i]}`)}</circle>${this.text(best.x, best.y, t, i === 0 ? 'ptr' : '', best.an)}`;
      });
      const right = Math.max(X(hi), ...placed.map(b => b.x + b.w));
      return this.svg(right + 12, Y(P.length - 1) + 22, g, 'Head movement');
    },
    // ---------- Karnaugh map with the chosen groups ----------
    kmap(s) {
      const n = +(s.vars ?? s.variables);
      if (!(n >= 1 && n <= 6) || !Number.isInteger(n)) throw new Error('A K-map needs "vars" from 1 to 6.');
      const nm = String(s.names || '').replace(/[\s,]/g, ''), names = (nm.length === n ? nm : 'ABCDEF'.slice(0, n)).split('');
      const r = Math.floor(n / 2), c = n - r, R = 2 ** r, C = 2 ** c;
      const gray = (k, b) => b ? (k ^ (k >> 1)).toString(2).padStart(b, '0') : '';
      const ones = new Set((s.ones || []).map(Number)), dc = new Set((s.dc || s.dont_cares || []).map(Number));
      const groups = (s.groups || []).map(String), terms = s.terms || [];
      if (groups.some(p => p.length !== n || /[^01-]/.test(p))) throw new Error(`Each K-map group is a pattern of ${n} characters from 0, 1 and - (e.g. "1-0-").`);
      const rn = names.slice(0, r).join(''), cn = names.slice(r).join(''), corner = r ? `${rn} \\ ${cn}` : cn;
      const cs = 44, lw = Math.max(this.textW(corner, 12), r ? this.textW('0'.repeat(r), 12) : 0) + 4;
      const top = s.title ? 22 : 4, gx = 10 + lw, gy = top + 26;
      let g = s.title ? this.text(10, 10, s.title, 'muted', 'start') : '';
      g += this.text(gx - 6, top + 10, corner, 'muted', 'end');
      for (let j = 0; j < C; j++) g += this.text(gx + j * cs + cs / 2, top + 10, gray(j, c), 'idx');
      // cells first, then the group loops, then the cell text on top (with a halo), so a loop never hides a number
      let texts = '';
      for (let i = 0; i < R; i++) {
        if (r) g += this.text(gx - 8, gy + i * cs + cs / 2, gray(i, r), 'idx', 'end');
        for (let j = 0; j < C; j++) {
          const m = parseInt(gray(i, r) + gray(j, c), 2), v = ones.has(m) ? '1' : dc.has(m) ? 'X' : '0';
          g += `<g class="vz-cell kcell">${this.tip(`m${m} (${gray(i, r) + gray(j, c)}): ${v === 'X' ? "don't care" : v}`)}<rect x="${gx + j * cs}" y="${gy + i * cs}" width="${cs}" height="${cs}"/></g>`;
          texts += this.text(gx + j * cs + cs / 2, gy + i * cs + cs / 2 + 2, v, v === '1' ? 'khalo' : 'k0 khalo') + this.text(gx + j * cs + 3, gy + i * cs + 7, m, 'kidx khalo', 'start');
        }
      }
      // A group is a pattern over the variables; the rows and columns it covers can wrap around the edges, so each
      // contiguous run of rows × run of columns is drawn as its own rounded box (inset a little more for each group).
      const match = (code, pat) => [...pat].every((ch, k) => ch === '-' || ch === code[k]);
      const runs = (list) => { const out = []; list.forEach(k => { const l = out[out.length - 1]; if (l && l[1] === k - 1) l[1] = k; else out.push([k, k]); }); return out; };
      groups.forEach((p, gi) => {
        const rows = runs([...Array(R).keys()].filter(i => match(gray(i, r), p.slice(0, r)))), cols = runs([...Array(C).keys()].filter(j => match(gray(j, c), p.slice(r))));
        const cov = []; for (let m = 0; m < 2 ** n; m++) if (match(m.toString(2).padStart(n, '0'), p)) cov.push(m);
        const inset = 4 + (gi % 4) * 3, tip = this.tip(`${terms[gi] || p}: covers m(${cov.join(', ')})`);
        rows.forEach(([r0, r1]) => cols.forEach(([c0, c1]) => {
          g += `<rect x="${gx + c0 * cs + inset}" y="${gy + r0 * cs + inset}" width="${(c1 - c0 + 1) * cs - 2 * inset}" height="${(r1 - r0 + 1) * cs - 2 * inset}" rx="12" class="vz-grp c${gi % 6}">${tip}</rect>`;
        }));
      });
      g += texts;
      // legend: each group's colour and its product term, wrapped to the map's width
      let lx = 10, ly = gy + R * cs + 18; const maxW = Math.max(gx + C * cs, 220);
      groups.forEach((p, gi) => {
        const t = String(terms[gi] || p), w = 22 + this.textW(t, 12) - 4;
        if (lx + w > maxW && lx > 10) { lx = 10; ly += 20; }
        g += `<rect x="${lx}" y="${ly - 6}" width="16" height="12" rx="4" class="vz-grp c${gi % 6}"/>${this.text(lx + 21, ly, t, '', 'start')}`;
        lx += w + 12;
      });
      return this.svg(Math.max(gx + C * cs + 10, maxW + 10), (groups.length ? ly + 14 : gy + R * cs + 10), g, 'K-map');
    },
    // ---------- page replacement: what each frame holds after every reference ----------
    refgrid(s) {
      const refs = s.refs || [], slots = s.slots || [], faults = s.faults || [], changed = s.changed || [];
      if (!refs.length || slots.length !== refs.length) throw new Error('A frames table needs "refs" and one "slots" column per reference.');
      const F = Math.max(1, +s.frames || 0, ...slots.map(col => (col || []).length)), upto = s.upto == null ? refs.length - 1 : Math.min(refs.length - 1, +s.upto);
      const cw = Math.max(32, ...refs.map(v => this.textW(v)), ...slots.flat().map(v => this.textW(v ?? ''))), rh = 30;
      const lw = Math.max(this.textW(`Frame ${F}`, 12), this.textW('Result', 12)) + 2, top = s.title ? 22 : 4, x0 = 8 + lw, y0 = top + 26;
      let g = s.title ? this.text(8, 10, s.title, 'muted', 'start') : '';
      g += this.text(x0 - 8, top + 12, 'Ref', 'muted', 'end');
      for (let f = 0; f < F; f++) g += this.text(x0 - 8, y0 + f * rh + rh / 2, `Frame ${f + 1}`, 'muted', 'end');
      g += this.text(x0 - 8, y0 + F * rh + 14, 'Result', 'muted', 'end');
      let nf = 0, nh = 0;
      refs.forEach((ref, i) => {
        const x = x0 + i * cw, shown = i <= upto, col = slots[i] || [], prev = slots[i - 1] || [];
        const ev = shown && faults[i] && changed[i] >= 0 && prev[changed[i]] != null ? prev[changed[i]] : null;
        if (shown) faults[i] ? nf++ : nh++;
        const tip = shown ? this.tip(`Reference ${i + 1}: page ${ref}, ${faults[i] ? `fault${changed[i] >= 0 ? `, loaded into frame ${changed[i] + 1}` : ''}${ev != null ? `, replacing ${ev}` : ''}` : 'hit'}`) : '';
        g += this.text(x + cw / 2, top + 12, ref, i === upto && s.upto != null ? 'ptr' : '');
        for (let f = 0; f < F; f++) {
          const v = shown ? col[f] : null, cls = !shown ? 'later' : faults[i] && changed[i] === f ? 'hi' : !faults[i] && String(v) === String(ref) ? 'hitc' : '';
          g += `<g class="vz-cell ${cls}">${tip}<rect x="${x}" y="${y0 + f * rh}" width="${cw}" height="${rh}"/>${v != null ? this.text(x + cw / 2, y0 + f * rh + rh / 2, v) : ''}</g>`;
        }
        if (shown) g += this.text(x + cw / 2, y0 + F * rh + 14, faults[i] ? 'F' : 'H', faults[i] ? 'fault' : 'hit');
      });
      if (s.upto != null) g += `<rect x="${x0 + upto * cw - 2}" y="${top}" width="${cw + 4}" height="${F * rh + 50}" rx="6" class="vz-cur"/>`;
      g += this.text(x0, y0 + F * rh + 36, `Faults ${nf} · Hits ${nh}${upto < refs.length - 1 ? ` (after ${upto + 1} of ${refs.length} references)` : ''}`, 'muted', 'start');
      return this.svg(Math.max(x0 + refs.length * cw + 10, x0 + this.textW(`Faults ${nf} · Hits ${nh} (after ${upto + 1} of ${refs.length} references)`, 11) + 10), y0 + F * rh + 48, g, 'Page frames');
    },
    // ---------- a small table (Banker's state, probe sequences) ----------
    table(s) {
      const head = (s.head || []).map(String), rows = (s.rows || []).map(r => (r || []).map(v => String(v ?? '')));
      if (!rows.length) throw new Error('A table needs "rows": [[…], …].');
      const nc = Math.max(head.length, ...rows.map(r => r.length)), hi = new Set((s.hi || []).map(Number)), done = new Set((s.done || []).map(Number));
      const w = Array.from({ length: nc }, (_, j) => Math.max(40, this.textW(head[j] || '', 12) + 4, ...rows.map(r => this.textW(r[j] || '') + 4)));
      const xs = w.reduce((a, v) => (a.push(a[a.length - 1] + v), a), [10]), rh = 28, top = s.title ? 22 : 4, y0 = top + (head.length ? rh : 0);
      let g = s.title ? this.text(10, 10, s.title, 'muted', 'start') : '';
      head.forEach((t, j) => { g += `<g class="vz-cell th"><rect x="${xs[j]}" y="${top}" width="${w[j]}" height="${rh}"/>${this.text(xs[j] + w[j] / 2, top + rh / 2, t, 'muted')}</g>`; });
      // single cells can be marked too: hiCells (blue, the one being filled), depCells (amber, what it is computed from)
      const hc = new Set((s.hiCells || []).map(c => `${c[0]}|${c[1]}`)), dc = new Set((s.depCells || []).map(c => `${c[0]}|${c[1]}`));
      rows.forEach((r, i) => {
        const cls0 = hi.has(i) ? 'hi' : done.has(i) ? 'done' : '', tip = this.tip((s.tips || [])[i] || '');
        for (let j = 0; j < nc; j++) g += `<g class="vz-cell ${hc.has(`${i}|${j}`) ? 'hi' : dc.has(`${i}|${j}`) ? 'dep' : cls0}">${tip}<rect x="${xs[j]}" y="${y0 + i * rh}" width="${w[j]}" height="${rh}"/>${this.text(xs[j] + w[j] / 2, y0 + i * rh + rh / 2, r[j] || '')}</g>`;
      });
      return this.svg(xs[nc] + 10, y0 + rows.length * rh + 8, g, s.title || 'Table');
    },
    // ---------- a line chart (TCP congestion window per round, …) ----------
    line(s) {
      const pts = (s.points || []).map(p => [+p[0], +p[1]]).filter(p => isFinite(p[0]) && isFinite(p[1]));
      if (pts.length < 2) throw new Error('A line chart needs "points": [[x, y], …] (two or more).');
      const hl = (s.hlines || []).map(h => [+h[0], String(h[1] ?? '')]).filter(h => isFinite(h[0])), mk = (s.marks || []).map(m => [+m[0], String(m[1] ?? '')]).filter(m => isFinite(m[0]));
      const dsh = (s.dashed || []).map(p => [+p[0], +p[1]]).filter(p => isFinite(p[0]) && isFinite(p[1])), dl = String(s.dashedLabel || '');
      const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y1 = Math.max(1, ...pts.map(p => p[1]), ...hl.map(h => h[0]), ...dsh.map(p => p[1]));
      const yl = s.yLabel ? String(s.yLabel) : '', xl = s.xLabel ? String(s.xLabel) : '';
      const L = 14 + Math.max(this.textW(this.num(y1), 11), 20) + (yl ? 4 : 0), top = (s.title ? 22 : 6) + (yl ? 16 : 0) + 14 + (mk.length ? 18 : 0), Hc = 200;
      const Wc = Math.max(360, Math.min(680, (x1 - x0) * 30));
      const hlW = Math.max(0, ...hl.map(h => this.textW(h[1], 11)), dsh.length && dl ? this.textW(dl, 11) : 0);
      const X = v => L + (v - x0) / (x1 - x0 || 1) * Wc, Y = v => top + Hc - v / y1 * Hc;
      let g = s.title ? this.text(10, 10, s.title, 'muted', 'start') : '';
      if (yl) g += this.text(10, top - 24, yl, 'muted', 'start');
      g += `<line x1="${L}" y1="${top}" x2="${L}" y2="${top + Hc}" class="vz-axis"/><line x1="${L}" y1="${top + Hc}" x2="${L + Wc}" y2="${top + Hc}" class="vz-axis vz-base"/>`;
      // x ticks every step that leaves room for its number; y: 0, the top and each marked level
      const stepX = Math.max(1, Math.ceil((x1 - x0) / Math.floor(Wc / 26)));
      for (let v = Math.ceil(x0); v <= x1; v += stepX) g += `<line x1="${X(v)}" y1="${top + Hc}" x2="${X(v)}" y2="${top + Hc + 5}" class="vz-axis"/>${this.text(X(v), top + Hc + 14, v, 'idx')}`;
      for (const v of [...new Set([0, y1])]) g += this.text(L - 6, Y(v), this.num(v), 'idx', 'end');
      hl.forEach(([v, t]) => { g += `<line x1="${L}" y1="${Y(v)}" x2="${L + Wc}" y2="${Y(v)}" class="vz-hline">${this.tip(`${t}: ${this.num(v)}`)}</line>${this.text(L + Wc + 6, Y(v), t, 'idx', 'start')}`; });
      mk.forEach(([v, t]) => { g += `<line x1="${X(v)}" y1="${top - 18}" x2="${X(v)}" y2="${top + Hc}" class="vz-hline">${this.tip(t)}</line>${this.text(X(v), top - 26, t, 'ptr')}`; });
      // a second, dashed level that changes in steps (ssthresh): held until the next point, then jumps
      if (dsh.length) {
        const pp = dsh.flatMap((p, i) => i ? [[p[0], dsh[i - 1][1]], p] : [p]).concat([[x1, dsh[dsh.length - 1][1]]]);
        g += `<polyline points="${pp.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" class="vz-hline" fill="none">${this.tip(dl)}</polyline>`;
        if (dl) g += this.text(L + Wc + 6, Y(dsh[dsh.length - 1][1]), dl, 'idx', 'start');
      }
      g += `<polyline points="${pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" class="vz-edge hi" fill="none"/>`;
      // values above the dots, skipped where they would touch the one before
      let lastR = -1e9;
      pts.forEach(p => {
        const t = this.num(p[1]), w = this.textW(t, 11) - 8, x = X(p[0]);
        g += `<circle cx="${x}" cy="${Y(p[1])}" r="3.5" class="vz-dot">${this.tip(`${xl || 'x'} ${this.num(p[0])}: ${this.num(p[1])}`)}</circle>`;
        if (x - w / 2 > lastR + 3) { g += this.text(x, Y(p[1]) - 11, t, 'idx khalo'); lastR = x + w / 2; }
      });
      if (xl) g += this.text(L + Wc / 2, top + Hc + 30, xl, 'muted');
      return this.svg(L + Wc + (hlW ? hlW + 10 : 14), top + Hc + (xl ? 40 : 24), g, s.title || 'Chart');
    },
    // ---------- message sequence between two (or more) parties: TCP handshake, sliding window ----------
    seq(s) {
      const actors = (s.actors || []).map(String), msgs = (s.messages || []).map(m => ({ a: String(m[0]), b: String(m[1]), t: String(m[2] ?? ''), lost: !!m[3] }));
      if (actors.length < 2 || msgs.some(m => !actors.includes(m.a) || !actors.includes(m.b))) throw new Error('A sequence needs "actors" and "messages": [[from, to, label], …] between those actors.');
      const upto = s.upto == null ? msgs.length : +s.upto, states = s.states || [];
      const stW = Math.max(0, ...states.flat().map(t => this.textW(t ?? '', 11)));
      const lab = Math.max(160, ...msgs.map(m => this.textW(m.t, 12) + 30)), gap = lab + 20, L = 16 + stW, top = 46, rowH = 46;
      const X = i => L + 50 + i * gap;
      let g = '';
      actors.forEach((a, i) => { const w = Math.max(90, this.textW(a) + 16); g += `<g class="vz-cell th"><rect x="${X(i) - w / 2}" y="6" width="${w}" height="28" rx="6"/>${this.text(X(i), 20, a)}</g><line x1="${X(i)}" y1="34" x2="${X(i)}" y2="${top + msgs.length * rowH + 10}" class="vz-axis vz-lead"/>`; });
      msgs.forEach((m, k) => {
        if (k >= upto) return;
        const ia = actors.indexOf(m.a), ib = actors.indexOf(m.b), y0 = top + k * rowH, y1 = y0 + rowH - 12, x0 = X(ia), x1 = X(ib), dir = x1 > x0 ? 1 : -1;
        const ex = m.lost ? x0 + (x1 - x0) * 0.6 : x1 - dir * 3, ey = m.lost ? y0 + (y1 - y0) * 0.6 : y1;
        g += `<path d="M${x0 + dir * 2},${y0} L${ex},${ey}" class="vz-edge ${k === upto - 1 ? 'hi' : ''} ${m.lost ? 'jump' : ''}" ${m.lost ? '' : `marker-end="url(#${k === upto - 1 ? 'vzArrowHi' : 'vzArrow'})"`}>${this.tip(`${m.a} → ${m.b}: ${m.t}${m.lost ? ' (lost)' : ''}`)}</path>`;
        if (m.lost) g += this.text(ex + dir * 8, ey, '✕', 'fault');
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - 9, w = this.textW(m.t, 12);
        g += `<g class="vz-elabel"><rect x="${mx - w / 2}" y="${my - 10}" width="${w}" height="20" rx="6"/>${this.text(mx, my, m.t)}</g>`;
        const st = states[k] || [];
        if (st[0]) g += this.text(X(0) - 8, y1, st[0], 'idx', 'end');
        if (st[1]) g += this.text(X(actors.length - 1) + 8, y1, st[1], 'idx', 'start');
      });
      return this.svg(X(actors.length - 1) + 50 + stW + 10, top + msgs.length * rowH + 16, g, 'Message sequence');
    },
    // ---------- an algorithm run step by step: the frames are computed here (see Viz.algos) ----------
    algo(s) { return this.render(this.expand(s)); },
  },
  // An "algo" drawing → a frames drawing: the algorithm runs here, on the given input, and every step becomes a frame.
  expand(s) {
    const name = String(s.algorithm || '').toLowerCase(), f = this.algos[name];
    if (!f) throw new Error(`Unknown algorithm "${s.algorithm}" (one of: ${Object.keys(this.algos).join(', ')}).`);
    const out = f.call(this, s);
    if (out.frames.length > 240) throw new Error('Too many steps to animate: use a smaller input.');
    return { type: 'frames', frames: out.frames, captions: out.captions, start: s.start };
  },
  algoGraph(s) {
    const edges = (s.edges || []).map(e => Array.isArray(e) ? [String(e[0]), String(e[1]), e[2]] : [String(e.u), String(e.v), e.w]);
    if (!edges.length || edges.some(e => e[0] === 'undefined' || e[1] === 'undefined')) throw new Error('The algorithm needs "edges": [[u, v, weight?], …].');
    const ids = [...new Set([...(s.nodes || []).map(String), ...edges.flatMap(e => [e[0], e[1]])])];
    if (ids.length > 16) throw new Error('At most 16 nodes, so the drawing stays readable.');
    const cmp = (a, b) => (isFinite(a) && isFinite(b) ? a - b : String(a).localeCompare(String(b)));
    const adj = {}; ids.forEach(v => { adj[v] = []; });
    edges.forEach(([u, v, w]) => { adj[u].push([v, w]); if (!s.directed) adj[v].push([u, w]); });
    ids.forEach(v => adj[v].sort((a, b) => cmp(a[0], b[0])));
    return { ids, edges, adj, base: { type: 'graph', nodes: ids, edges: edges.map(e => e[2] == null || e[2] === '' ? [e[0], e[1]] : e), directed: !!s.directed } };
  },
  algoArray(s) {
    const a = (s.array || s.cells || s.items || []).slice();
    if (!a.length) throw new Error('The algorithm needs "array": [numbers].');
    if (a.length > 14) throw new Error('At most 14 numbers, so every step stays readable.');
    const nums = a.every(v => v !== '' && v != null && isFinite(v));
    return { a: nums ? a.map(Number) : a.map(String), less: nums ? (x, y) => x < y : (x, y) => String(x) < String(y) };
  },
  // Round robin as solvers.js runs it: arrivals during a slice join the queue before the preempted process; a context
  // switch (if any) is charged between different processes. Returns the Gantt segments and the queue after each slice.
  rrSim(procsIn, q, cs = 0) {
    const procs = procsIn.map((p, i) => ({ name: String(p.name), at: +p.at || 0, bt: +p.bt, rem: +p.bt, i }));
    if (!procs.length || procs.some(p => !(p.bt > 0))) throw new Error('Every process needs a burst time.');
    if (!(q > 0)) throw new Error('Round robin needs a time quantum.');
    const segs = [], slices = [], order = procs.slice().sort((a, b) => a.at - b.at || a.i - b.i), queue = [];
    let t = 0, k = 0, last = null, guard = 0;
    const admit = () => { while (k < order.length && order[k].at <= t + 1e-9) queue.push(order[k++]); };
    while (procs.some(p => p.rem > 0) && guard++ < 5000) {
      admit();
      if (!queue.length) { const nxt = Math.min(...procs.filter(p => p.rem > 0).map(p => p.at)); if (nxt > t) { segs.push({ name: 'idle', from: t, to: nxt }); t = nxt; } continue; }
      const x = queue.shift(), len = Math.min(q, x.rem);
      if (last && last !== x && cs) { segs.push({ name: 'CS', from: t, to: t + cs }); t += cs; }
      const from = t, prev = segs[segs.length - 1];
      if (prev && prev.name === x.name && prev.to === t) prev.to = t + len; else segs.push({ name: x.name, from: t, to: t + len });
      t += len; x.rem -= len; last = x;
      if (x.rem <= 1e-9) { x.rem = 0; x.ct = t; }
      admit();
      if (x.rem > 0) queue.push(x);
      slices.push({ name: x.name, from, to: t, rem: x.rem, queue: queue.map(p => p.name), bars: segs.map(sg => [sg.name, sg.from, sg.to]) });
    }
    return { segs, slices, procs };
  },
  algos: {
    rr(s) {
      const procs = (s.processes || []).map((p, i) => Array.isArray(p) ? { name: p[0] ?? 'P' + (i + 1), at: p[1], bt: p[2] } : { name: p.name ?? 'P' + (i + 1), at: p.arrival ?? p.at, bt: p.burst ?? p.bt });
      if (procs.length > 10) throw new Error('At most 10 processes.');
      const { slices } = this.rrSim(procs, +s.quantum, +s.context_switch || 0);
      const frames = [], captions = [];
      slices.forEach(sl => {
        frames.push({ type: 'group', items: [{ type: 'gantt', bars: sl.bars, end: slices[slices.length - 1].to }, { type: 'queue', items: sl.queue }], titles: ['Gantt chart so far', 'Ready queue after this slice'] });
        captions.push(`${this.num(sl.from)}–${this.num(sl.to)}: ${sl.name} runs${sl.rem > 0 ? `, ${this.num(sl.rem)} left, back to the end of the queue` : ', finished'}. Queue: ${sl.queue.join(' ') || 'empty'}.`);
      });
      return { frames, captions };
    },
    lru(s) { return this.pageAlgo(s, 'LRU'); },
    fifo(s) { return this.pageAlgo(s, 'FIFO'); },
    opt(s) { return this.pageAlgo(s, 'OPT'); },
    // binary search on a sorted array: lo, mid, hi each step
    binary(s) {
      const { a, less } = this.algoArray(s), t = s.target, frames = [], captions = [];
      const T = a.every(v => typeof v === 'number') ? +t : String(t);
      if (t == null || t === '' || (typeof T === 'number' && !isFinite(T))) throw new Error('Binary search needs a "target".');
      if (a.some((v, i) => i && less(v, a[i - 1]))) throw new Error('Binary search needs a sorted array.');
      let lo = 0, hi = a.length - 1, found = -1;
      const snap = (ptr, hl, done, cap) => { frames.push({ type: 'array', cells: a, highlight: hl, done, pointers: ptr }); captions.push(cap); };
      snap({ 0: 'lo', [a.length - 1]: 'hi' }, [], [], `Search for ${T} in the sorted array: lo = 0, hi = ${a.length - 1}.`);
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2), ptr = {}; ptr[lo] = 'lo'; ptr[hi] = ptr[hi] ? `${ptr[hi]}, hi` : 'hi'; ptr[mid] = ptr[mid] ? `${ptr[mid]}, mid` : 'mid';
        if (a[mid] === T) { found = mid; snap(ptr, [mid], [mid], `mid = ⌊(${lo} + ${hi}) / 2⌋ = ${mid}: a[${mid}] = ${a[mid]} = ${T}. Found at index ${mid}.`); break; }
        const right = less(a[mid], T);
        snap(ptr, [mid], [], `mid = ⌊(${lo} + ${hi}) / 2⌋ = ${mid}: a[${mid}] = ${a[mid]} ${right ? '<' : '>'} ${T}, so search the ${right ? 'right' : 'left'} half.`);
        if (right) lo = mid + 1; else hi = mid - 1;
      }
      if (found < 0) snap(lo < a.length ? { [lo]: 'lo' } : {}, [], [], `lo > hi: ${T} is not in the array (it would go at index ${lo}).`);
      return { frames, captions };
    },
    // minimum spanning trees
    kruskal(s) {
      const { ids, edges, base } = this.algoGraph(s);
      if (edges.some(e => !isFinite(e[2]) || e[2] === '' || e[2] == null)) throw new Error('Kruskal needs a weight on every edge.');
      const parent = Object.fromEntries(ids.map(v => [v, v])), find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
      const sorted = edges.slice().sort((x, y) => x[2] - y[2]), tree = [], frames = [], captions = [];
      let total = 0;
      frames.push({ ...base, highlight: [] }); captions.push(`Sort the edges by weight: ${sorted.map(e => `${e[0]}–${e[1]} (${e[2]})`).join(', ')}.`);
      for (const [u, v, w] of sorted) {
        if (tree.length === ids.length - 1) break;
        const a = find(u), b = find(v), ok = a !== b;
        if (ok) { parent[a] = b; tree.push([u, v]); total += +w; }
        frames.push({ ...base, highlight: tree.slice(), mark: [u, v] });
        captions.push(`${u}–${v} (${w}): ${ok ? `joins two separate trees: take it (total ${this.num(total)})` : 'would close a cycle: skip it'}.`);
      }
      frames.push({ ...base, highlight: tree.slice() }); captions.push(`MST: ${tree.map(e => e.join('–')).join(', ')}; weight ${this.num(total)}.`);
      return { frames, captions };
    },
    prim(s) {
      const { ids, edges, adj, base } = this.algoGraph(s), start = String(s.start ?? s.source ?? ids[0]);
      if (!ids.includes(start)) throw new Error(`Start "${start}" is not a node.`);
      if (edges.some(e => !isFinite(e[2]) || e[2] === '' || e[2] == null)) throw new Error('Prim needs a weight on every edge.');
      const inT = new Set([start]), tree = [], frames = [], captions = [];
      let total = 0;
      frames.push({ ...base, mark: [start], groups: {} }); captions.push(`Start the tree at ${start}.`);
      while (inT.size < ids.length) {
        let best = null;
        for (const u of inT) for (const [v, w] of adj[u]) if (!inT.has(v) && (!best || +w < best[2] || (+w === best[2] && ids.indexOf(v) < ids.indexOf(best[1])))) best = [u, v, +w];
        if (!best) break;
        inT.add(best[1]); tree.push([best[0], best[1]]); total += best[2];
        frames.push({ ...base, highlight: tree.slice(), mark: [best[1]], groups: Object.fromEntries([...inT].filter(v => v !== best[1]).map(v => [v, 1])) });
        captions.push(`The lightest edge leaving the tree is ${best[0]}–${best[1]} (${best[2]}): add ${best[1]} (total ${this.num(total)}).`);
      }
      frames.push({ ...base, highlight: tree.slice(), groups: Object.fromEntries([...inT].map(v => [v, 1])) }); captions.push(`MST weight ${this.num(total)}${inT.size < ids.length ? ' (the graph is disconnected: only this component)' : ''}.`);
      return { frames, captions };
    },
    dijkstra(s) {
      const { ids, edges, adj, base } = this.algoGraph(s), src = String(s.source ?? s.start ?? ids[0]);
      if (!ids.includes(src)) throw new Error(`Source "${src}" is not a node.`);
      if (edges.some(e => !isFinite(e[2]) || e[2] === '' || e[2] == null)) throw new Error('Dijkstra needs a weight on every edge.');
      if (edges.some(e => +e[2] < 0)) throw new Error('Dijkstra needs non-negative weights (use Bellman-Ford for negative ones).');
      const dist = {}, prev = {}, done = new Set(), frames = [], captions = [];
      ids.forEach(v => { dist[v] = Infinity; }); dist[src] = 0;
      const tree = () => Object.entries(prev).map(([v, u]) => [u, v]);
      const snap = (cur, changed, cap) => {
        frames.push({ type: 'group', items: [{ ...base, mark: cur ? [cur] : [], groups: Object.fromEntries([...done].map(v => [v, 1])), highlight: tree() },
          { type: 'array', cells: ids.map(v => dist[v] === Infinity ? '∞' : this.num(dist[v])), index: ids, highlight: changed.map(v => ids.indexOf(v)), done: [...done].map(v => ids.indexOf(v)), title: `Distance from ${src}` }] });
        captions.push(cap);
      };
      snap(null, [src], `Start: distance to ${src} is 0, every other node ∞. Green = finished, blue lines = best paths found so far.`);
      for (;;) {
        const u = ids.filter(v => !done.has(v)).sort((a, b) => dist[a] - dist[b] || ids.indexOf(a) - ids.indexOf(b))[0];
        if (u == null || dist[u] === Infinity) break;
        done.add(u);
        const changed = [], notes = [];
        for (const [v, w] of adj[u]) if (!done.has(v)) {
          if (dist[u] + +w < dist[v]) { notes.push(`${v}: ${dist[v] === Infinity ? '∞' : this.num(dist[v])} → ${this.num(dist[u] + +w)}`); dist[v] = dist[u] + +w; prev[v] = u; changed.push(v); }
        }
        done.delete(u); snap(u, changed, `Take ${u} (smallest distance, ${this.num(dist[u])}) and relax its edges: ${notes.join(', ') || 'nothing improves'}.`); done.add(u);
      }
      const left = ids.filter(v => dist[v] === Infinity);
      snap(null, [], `Done. Shortest distances from ${src}: ${ids.map(v => `${v} = ${dist[v] === Infinity ? '∞' : this.num(dist[v])}`).join(', ')}${left.length ? ` (${left.join(', ')} unreachable)` : ''}.`);
      return { frames, captions };
    },
    bfs(s) { return this.traverse(s, 'bfs'); },
    dfs(s) { return this.traverse(s, 'dfs'); },
    bubble(s) {
      const { a, less } = this.algoArray(s), n = a.length, frames = [], captions = [], done = new Set();
      const snap = (hi, cap) => { frames.push({ type: 'array', cells: a.slice(), highlight: hi, done: [...done] }); captions.push(cap); };
      snap([], 'Start. Each pass swaps neighbours that are out of order, so the largest left moves to the end.');
      for (let i = 0; i < n - 1; i++) {
        let swapped = false;
        for (let j = 0; j < n - 1 - i; j++) {
          const x = a[j], y = a[j + 1], sw = less(y, x);
          if (sw) { a[j] = y; a[j + 1] = x; swapped = true; }
          snap([j, j + 1], `Pass ${i + 1}: compare ${x} and ${y}: ${sw ? 'swap' : 'already in order'}.`);
        }
        done.add(n - 1 - i);
        if (!swapped) { for (let k = 0; k < n; k++) done.add(k); snap([], `No swap in pass ${i + 1}: the array is sorted, stop early.`); return { frames, captions }; }
      }
      for (let k = 0; k < n; k++) done.add(k);
      snap([], 'Sorted.');
      return { frames, captions };
    },
    insertion(s) {
      const { a, less } = this.algoArray(s), n = a.length, frames = [], captions = [];
      const snap = (hi, ptr, sorted, cap) => { frames.push({ type: 'array', cells: a.slice(), highlight: hi, pointers: ptr, done: [...Array(sorted).keys()].filter(k => !hi.includes(k)) }); captions.push(cap); };
      snap([], {}, 1, 'Start: the first element alone is sorted (green).');
      for (let i = 1; i < n; i++) {
        const key = a[i]; let j = i - 1;
        snap([i], { [i]: 'key' }, i, `Take key = ${key}.`);
        while (j >= 0 && less(key, a[j])) { a[j + 1] = a[j]; snap([j + 1], { [j]: 'key goes left of' }, i + 1, `${a[j]} > ${key}: shift ${a[j]} one place right.`); j--; }
        a[j + 1] = key;
        snap([j + 1], {}, i + 1, `Insert ${key} at index ${j + 1}.`);
      }
      snap([], {}, n, 'Sorted.');
      return { frames, captions };
    },
    selection(s) {
      const { a, less } = this.algoArray(s), n = a.length, frames = [], captions = [];
      const snap = (hi, ptr, sorted, cap) => { frames.push({ type: 'array', cells: a.slice(), highlight: hi, pointers: ptr, done: [...Array(sorted).keys()] }); captions.push(cap); };
      snap([], {}, 0, 'Start. Each pass finds the smallest of the unsorted part and swaps it to the front of that part.');
      for (let i = 0; i < n - 1; i++) {
        let m = i;
        for (let j = i + 1; j < n; j++) if (less(a[j], a[m])) m = j;
        snap([i, m], m === i ? { [i]: 'i = min' } : { [i]: 'i', [m]: 'min' }, i, `Pass ${i + 1}: the smallest of a[${i}..${n - 1}] is ${a[m]} at index ${m}${m === i ? ', already in place' : `: swap it with a[${i}] = ${a[i]}`}.`);
        [a[i], a[m]] = [a[m], a[i]];
        snap([i], {}, i + 1, `${a[i]} is now in its final place.`);
      }
      snap([], {}, n, 'Sorted.');
      return { frames, captions };
    },
    merge(s) {
      const { a, less } = this.algoArray(s), frames = [], captions = [];
      const snap = (lo, hi, cap) => { frames.push({ type: 'array', cells: a.slice(), highlight: lo == null ? [] : [...Array(hi - lo + 1).keys()].map(k => lo + k), pointers: lo == null ? {} : lo === hi ? { [lo]: 'lo = hi' } : { [lo]: 'lo', [hi]: 'hi' } }); captions.push(cap); };
      snap(null, null, 'Start. Merge sort splits the array in halves down to single elements, then merges sorted halves back.');
      const sort = (lo, hi) => {
        if (lo >= hi) return;
        const mid = Math.floor((lo + hi) / 2);
        sort(lo, mid); sort(mid + 1, hi);
        const L = a.slice(lo, mid + 1), R = a.slice(mid + 1, hi + 1), out = [];
        let i = 0, j = 0; while (i < L.length && j < R.length) out.push(less(R[j], L[i]) ? R[j++] : L[i++]);
        out.push(...L.slice(i), ...R.slice(j));
        out.forEach((v, k) => { a[lo + k] = v; });
        snap(lo, hi, `Merge [${L.join(', ')}] and [${R.join(', ')}] → [${out.join(', ')}].`);
      };
      sort(0, a.length - 1);
      snap(null, null, 'Sorted.');
      return { frames, captions };
    },
    quick(s) {
      const { a, less } = this.algoArray(s), frames = [], captions = [], fixed = new Set();
      const snap = (hi, ptr, cap) => { frames.push({ type: 'array', cells: a.slice(), highlight: hi, pointers: ptr, done: [...fixed] }); captions.push(cap); };
      snap([], {}, 'Start. Lomuto partition: the pivot is the last element; smaller-or-equal elements are swapped to the left part.');
      const qs = (lo, hi) => {
        if (lo > hi) return;
        if (lo === hi) { fixed.add(lo); snap([], {}, `a[${lo}] = ${a[lo]} alone: in place.`); return; }
        const p = a[hi]; let i = lo - 1;
        snap([hi], { [lo]: 'lo', [hi]: 'pivot' }, `Partition a[${lo}..${hi}] around pivot ${p}.`);
        for (let j = lo; j < hi; j++) if (!less(p, a[j])) {
          i++;
          if (i !== j) { [a[i], a[j]] = [a[j], a[i]]; snap([i, j], { [i]: 'i', [j]: 'j', [hi]: 'pivot' }, `${a[i]} ≤ ${p}: swap it into the left part (index ${i}).`); }
          else snap([i], { [i]: 'i = j', [hi]: 'pivot' }, `${a[i]} ≤ ${p}: already in the left part.`);
        }
        [a[i + 1], a[hi]] = [a[hi], a[i + 1]]; fixed.add(i + 1);
        snap([i + 1], { [i + 1]: 'pivot' }, `Put pivot ${p} at index ${i + 1}: everything left of it is ≤ ${p}, everything right is > ${p}.`);
        qs(lo, i); qs(i + 2, hi);
      };
      qs(0, a.length - 1);
      a.forEach((_, k) => fixed.add(k));
      snap([], {}, 'Sorted.');
      return { frames, captions };
    },
    heap(s) {
      const { a, less } = this.algoArray(s), n = a.length, frames = [], captions = [];
      let size = n;
      const snap = (hi, cap) => {
        frames.push({ type: 'group', items: [{ type: 'tree', level: a.slice(0, size), highlight: hi.filter(i => i < size).map(i => a[i]) }, { type: 'array', cells: a.slice(), highlight: hi, done: [...Array(n - size).keys()].map(k => size + k) }], titles: ['Heap (max-heap)', 'Array (green = sorted)'] });
        captions.push(cap);
      };
      const sift = (i, phase) => {
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < size && less(a[m], a[l])) m = l;
          if (r < size && less(a[m], a[r])) m = r;
          if (m === i) return;
          [a[i], a[m]] = [a[m], a[i]];
          snap([i, m], `${phase}: ${a[m]} is smaller than its child ${a[i]}: swap them.`);
          i = m;
        }
      };
      snap([], 'Start: the array read as a complete binary tree.');
      for (let i = Math.floor(n / 2) - 1; i >= 0; i--) sift(i, `Build heap (heapify index ${i})`);
      snap([], 'Max-heap built: every parent ≥ its children.');
      for (let end = n - 1; end > 0; end--) {
        [a[0], a[end]] = [a[end], a[0]]; size = end;
        snap([end], `Move the maximum ${a[end]} to the end (index ${end}); the heap shrinks to ${size}.`);
        sift(0, 'Sift down');
      }
      size = 0; snap([], 'Sorted.');
      return { frames, captions };
    },
  },
  // FIFO / LRU on a reference string, one frame per reference (the same rules as the page-replacement calculator).
  pageAlgo(s, algo) {
    const F = +s.frames, refs = (Array.isArray(s.references) ? s.references : String(s.references || '').split(/[\s,;]+/)).filter(x => x !== '').map(x => isFinite(x) ? +x : String(x));
    if (!(F >= 1) || !refs.length) throw new Error('Page replacement needs "frames" (a number) and "references": [pages].');
    if (refs.length > 40) throw new Error('At most 40 references.');
    const sim = this.pageSim(refs, F, algo), frames = [], captions = [];
    refs.forEach((r, i) => {
      frames.push({ type: 'refgrid', refs, slots: sim.slots, faults: sim.faults, changed: sim.changed, frames: F, upto: i });
      const ev = sim.faults[i] && sim.changed[i] >= 0 && i && sim.slots[i - 1][sim.changed[i]] != null ? sim.slots[i - 1][sim.changed[i]] : null;
      captions.push(`Reference ${r}: ${sim.faults[i] ? `fault${ev != null ? `, replace ${ev} (${algo === 'LRU' ? 'least recently used' : algo === 'OPT' ? 'not needed for the longest time' : 'loaded earliest'})` : `, load into free frame ${sim.changed[i] + 1}`}` : 'hit'}.`);
    });
    return { frames, captions };
  },
  pageSim(refs, F, algo) {
    const fr = [], slots = [], faults = [], changed = [], lastUse = new Map(), fifo = [];
    refs.forEach((r, i) => {
      const hit = fr.some(v => String(v) === String(r));
      let at = -1;
      if (!hit) {
        if (fr.length < F) { fr.push(r); at = fr.length - 1; fifo.push(r); }
        else {
          // OPT: the page not needed for the longest time (never again counts as farthest; ties: the lower frame)
          const next = x => { const k = refs.findIndex((y, j) => j > i && String(y) === String(x)); return k < 0 ? Infinity : k; };
          const victim = algo === 'LRU' ? fr.slice().sort((a, b) => lastUse.get(String(a)) - lastUse.get(String(b)))[0] : algo === 'OPT' ? fr.slice().sort((a, b) => next(b) - next(a) || fr.indexOf(a) - fr.indexOf(b))[0] : fifo.shift();
          at = fr.indexOf(victim); fr[at] = r; if (algo === 'FIFO') fifo.push(r);
        }
      }
      lastUse.set(String(r), i);
      slots.push(fr.slice()); faults.push(!hit); changed.push(at);
    });
    return { slots, faults, changed };
  },
  // BFS (queue) and DFS (recursion, shown as its stack); neighbours are taken in increasing order.
  traverse(s, kind) {
    const { ids, adj, base } = this.algoGraph(s), start = String(s.start ?? s.source ?? ids[0]);
    if (!ids.includes(start)) throw new Error(`Start "${start}" is not a node.`);
    const seen = new Set([start]), order = [], tree = [], frames = [], captions = [];
    const snap = (cur, box, cap) => {
      frames.push({ type: 'group', items: [{ ...base, mark: cur ? [cur] : [], groups: Object.fromEntries(order.map(v => [v, 1])), highlight: tree.slice() },
        { type: 'group', dir: 'row', items: [kind === 'bfs' ? { type: 'queue', items: box } : { type: 'stack', items: box }, { type: 'array', cells: order.slice(), title: 'Visit order' }], titles: [kind === 'bfs' ? 'Queue' : 'Call stack', ''] }] });
      captions.push(cap);
    };
    if (kind === 'bfs') {
      const q = [start];
      snap(null, q.slice(), `Start at ${start}: mark it and put it in the queue. Neighbours are taken in increasing order.`);
      while (q.length) {
        const u = q.shift(); order.push(u);
        const added = [];
        for (const [v] of adj[u]) if (!seen.has(v)) { seen.add(v); q.push(v); tree.push([u, v]); added.push(v); }
        snap(u, q.slice(), `Visit ${u}: ${added.length ? `enqueue ${added.join(', ')}` : 'no new neighbours'}.`);
      }
    } else {
      const stack = [];
      const visit = (u, from) => {
        order.push(u); stack.push(u); if (from != null) tree.push([from, u]);
        snap(u, stack.slice(), from == null ? `Start at ${start}. Neighbours are taken in increasing order.` : `Go deeper: visit ${u} (from ${from}).`);
        for (const [v] of adj[u]) if (!seen.has(v)) { seen.add(v); visit(v, u); }
        stack.pop();
        if (stack.length) snap(stack[stack.length - 1], stack.slice(), `${u} has no unvisited neighbours: back to ${stack[stack.length - 1]}.`);
      };
      visit(start, null);
    }
    const missed = ids.filter(v => !seen.has(v));
    snap(null, [], `Done. ${kind.toUpperCase()} order: ${order.join(' → ')}${missed.length ? ` (not reachable from ${start}: ${missed.join(', ')})` : ''}.`);
    return { frames, captions };
  },
  // A straight (or bent, for a reverse edge) path between two circles; label point.
  edgePath(a, b, r, bend, directed, r2 = r) {
    // Also returns at(t) (a point along the edge) and the normal, for placing the label (placeLabels).
    if (a === b || (a.x === b.x && a.y === b.y)) {   // self loop, above the node
      const p0 = [a.x - 10, a.y - r + 2], c1 = [a.x - 34, a.y - r - 44], c2 = [a.x + 34, a.y - r - 44], p3 = [a.x + 10, a.y - r + 2];
      const at = t => { const u = 1 - t; return { x: u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], y: u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1] - (t === 0.5 ? 12 : 0) }; };
      return { path: `M${p0} C${c1} ${c2} ${p3}`, lx: a.x, ly: a.y - r - 45, at, loop: true, nx: 0, ny: -1 };
    }
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const sx = a.x + ux * r, sy = a.y + uy * r, ex = b.x - ux * (r2 + (directed ? 2 : 0)), ey = b.y - uy * (r2 + (directed ? 2 : 0));
    if (!bend) return { path: `M${sx},${sy} L${ex},${ey}`, lx: sx + (ex - sx) * 0.4 - uy * 12, ly: sy + (ey - sy) * 0.4 + ux * 12, at: t => ({ x: sx + (ex - sx) * t, y: sy + (ey - sy) * t }), nx: -uy, ny: ux };
    const mx = (sx + ex) / 2 - uy * bend, my = (sy + ey) / 2 + ux * bend;
    const at = t => { const u = 1 - t; return { x: u * u * sx + 2 * u * t * mx + t * t * ex, y: u * u * sy + 2 * u * t * my + t * t * ey }; };
    return { path: `M${sx},${sy} Q${mx},${my} ${ex},${ey}`, lx: (sx + 2 * mx + ex) / 4, ly: (sy + 2 * my + ey) / 4, at, curved: true, nx: -uy, ny: ux };
  },
  // The order of nodes around the circle with the fewest edge crossings (all orders up to 7 nodes, sampled above).
  fewestCrossings(ids, edges) {
    const n = ids.length, E = edges.map(e => [String(e[0]), String(e[1])]).filter(([a, b]) => a !== b);
    if (n <= 3 || !E.length) return ids;
    const cross = order => {
      const at = {}; order.forEach((id, i) => { at[id] = i; });
      let c = 0;
      for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
        const [a, b] = E[i], [x, y] = E[j];
        if (a === x || a === y || b === x || b === y) continue;
        // chords (p,q) and (r,s) on a circle cross iff exactly one of r, s lies strictly between p and q
        const p = Math.min(at[a], at[b]), q = Math.max(at[a], at[b]), inR = at[x] > p && at[x] < q, inS = at[y] > p && at[y] < q;
        if (inR !== inS) c++;
      }
      return c;
    };
    let best = ids, bestC = cross(ids);
    if (n <= 7) {
      const rest = ids.slice(1), perm = (arr, k = 0) => {   // node 0 fixed: rotations don't change crossings
        if (!bestC) return;
        if (k === arr.length) { const o = [ids[0], ...arr], c = cross(o); if (c < bestC) { bestC = c; best = o; } return; }
        for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; perm(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
      };
      perm(rest.slice());
    } else {
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let t = 0; t < 4000 && bestC; t++) { const o = ids.slice().sort(() => rnd() - 0.5), c = cross(o); if (c < bestC) { bestC = c; best = o; } }
    }
    return best;
  },
  spring(ids, edges, pos, W, H) {
    const k = Math.sqrt(W * H / ids.length) * 0.75;
    for (let it = 0; it < 220; it++) {
      const disp = {}; ids.forEach(i => { disp[i] = { x: 0, y: 0 }; });
      for (const a of ids) for (const b of ids) if (a !== b) { const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y, d = Math.max(1, Math.hypot(dx, dy)), f = k * k / d; disp[a].x += dx / d * f; disp[a].y += dy / d * f; }
      for (const e of edges) { const a = String(e[0]), b = String(e[1]); if (a === b || !pos[a] || !pos[b]) continue; const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y, d = Math.max(1, Math.hypot(dx, dy)), f = d * d / k; disp[a].x -= dx / d * f; disp[a].y -= dy / d * f; disp[b].x += dx / d * f; disp[b].y += dy / d * f; }
      const t = 30 * (1 - it / 220);
      for (const i of ids) { const d = Math.max(1, Math.hypot(disp[i].x, disp[i].y)); pos[i].x = Math.min(W - 30, Math.max(30, pos[i].x + disp[i].x / d * Math.min(d, t))); pos[i].y = Math.min(H - 30, Math.max(30, pos[i].y + disp[i].y / d * Math.min(d, t))); }
    }
  },
  automaton(s) {
    const states = [...new Set([...(s.states || []), s.start, ...(s.finals || []), ...(s.transitions || []).flatMap(t => [t[0], t[2]])].filter(x => x != null).map(String))];
    const finals = new Set((s.finals || []).map(String)), start = String(s.start ?? states[0]);
    // layers by BFS from the start state; unreachable states go last
    const layer = { [start]: 0 }, q = [start];
    while (q.length) { const u = q.shift(); for (const t of s.transitions || []) if (String(t[0]) === u && !(String(t[2]) in layer)) { layer[String(t[2])] = layer[u] + 1; q.push(String(t[2])); } }
    const maxL = Math.max(0, ...Object.values(layer));
    states.forEach(st => { if (!(st in layer)) layer[st] = maxL + 1; });
    const byL = {}; states.forEach(st => (byL[layer[st]] = byL[layer[st]] || []).push(st));
    const L = Math.max(...Object.keys(byL).map(Number)), rows = Math.max(...Object.values(byL).map(a => a.length));
    // circles fit the state names (subset-construction states like {q0,q1,q2} are long); spacing follows the biggest
    const rad = st => Math.max(24, this.textW(st) / 2 + 5), maxR = Math.max(...states.map(rad));
    const colW = Math.max(150, 2 * maxR + 96), rowH = Math.max(110, 2 * maxR + 66);
    const W = 160 + L * colW, H = Math.max(170, rows * rowH + 50), pos = {};
    Object.entries(byL).forEach(([l, arr]) => arr.forEach((st, i) => { pos[st] = { x: 120 + (+l) * colW, y: H / 2 + (i - (arr.length - 1) / 2) * rowH }; }));
    // merge parallel edges: "a,b"
    const merged = {};
    for (const t of s.transitions || []) { const k = `${t[0]}|${t[2]}`; (merged[k] = merged[k] || { u: String(t[0]), v: String(t[2]), syms: [] }).syms.push(String(t[1] === '' || t[1] == null ? 'ε' : t[1])); }
    const list = Object.values(merged);
    // An edge that skips layers on the same row arcs below the row (self-loops are above), deep enough to clear every
    // state in between; skip edges whose spans overlap are stacked one level deeper each, so no two share a path.
    const skips = list.filter(e => e.u !== e.v && Math.abs(pos[e.u].y - pos[e.v].y) < 1 && Math.abs(layer[e.u] - layer[e.v]) > 1)
      .sort((p, q) => Math.abs(pos[p.u].x - pos[p.v].x) - Math.abs(pos[q.u].x - pos[q.v].x));
    const done = [];
    for (const e of skips) {
      const lo = Math.min(pos[e.u].x, pos[e.v].x), hi = Math.max(pos[e.u].x, pos[e.v].x), n = Math.round((hi - lo) / colW);
      const level = 1 + Math.max(0, ...done.filter(d => d.lo < hi - 1 && lo < d.hi - 1 && Math.abs(d.y - pos[e.u].y) < 1).map(d => d.level));
      const apex = Math.max((maxR + 18) * n * n / (4 * (n - 1)), maxR + 18) + 30 * (level - 1);
      e.bend = (pos[e.u].x > pos[e.v].x ? -1 : 1) * 2 * apex;
      done.push({ lo, hi, y: pos[e.u].y, level });
    }
    let edges = '', labels = '', nodes = '';
    const drawn = [];
    // a run on an input: the current state and the move just taken are highlighted (current, edge: [from, to])
    const cur = s.current != null ? String(s.current) : null, act = s.edge ? `${s.edge[0]}|${s.edge[1]}` : null;
    for (const e of list) {
      const a = pos[e.u], b = pos[e.v], back = e.u !== e.v && merged[`${e.v}|${e.u}`], on = act === `${e.u}|${e.v}`;
      const g = this.edgePath(a, b, rad(e.u), e.bend || (back ? 30 : 0), true, rad(e.v));
      edges += `<path d="${g.path}" class="vz-edge ${on ? 'hi' : ''}" marker-end="url(#${on ? 'vzArrowHi' : 'vzArrow'})">${this.tip(`${e.u} → ${e.v} on ${[...new Set(e.syms)].join(', ')}`)}</path>`;
      drawn.push({ g, text: [...new Set(e.syms)].join(', ') });
    }
    this.placeLabels(drawn, states.map(st => ({ ...pos[st], r: rad(st) }))).forEach((l, k) => { labels += this.pill(l, drawn[k].text); });
    const sr = rad(start);
    edges += `<path d="M${pos[start].x - sr - 40},${pos[start].y} L${pos[start].x - sr - 2},${pos[start].y}" class="vz-edge" marker-end="url(#vzArrow)"/>${this.text(pos[start].x - sr - 46, pos[start].y, 'start', 'ptr', 'end')}`;
    for (const st of states) nodes += `<g class="vz-node state ${finals.has(st) ? 'final' : ''} ${cur === st ? 'cur' : ''}">${this.tip(`${st}${st === start ? ' (start)' : ''}${finals.has(st) ? ' (accepting)' : ''}`)}<circle cx="${pos[st].x}" cy="${pos[st].y}" r="${rad(st)}"/>${finals.has(st) ? `<circle cx="${pos[st].x}" cy="${pos[st].y}" r="${rad(st) - 5}" class="inner"/>` : ''}${this.text(pos[st].x, pos[st].y, st)}</g>`;
    return this.svg(W + 40 + maxR, H, edges + labels + nodes, 'Automaton');
  },
  // Draws every ```viz block inside root (called by diagrams.js on page changes).
  drawAll(root = document) {
    for (const el of root.querySelectorAll('.diagram.viz:not([data-drawn])')) {
      el.setAttribute('data-drawn', '1');
      let spec;
      try { spec = JSON.parse(decodeURIComponent(el.dataset.viz || '')); } catch { el.removeAttribute('data-drawn'); continue; }   // still streaming
      try {
        if (spec.type === 'frames') this.mountFrames(el, spec);
        else if (spec.type === 'algo') this.mountFrames(el, this.expand(spec));
        else el.innerHTML = `<div class="dg-svg">${this.render(spec)}</div>${spec.caption ? `<p class="vz-cap">${this.esc(spec.caption)}</p>` : ''}`;
        DiagramTools.attach(el);
      } catch (e) { el.innerHTML = `<p class="small muted">Couldn't draw this: ${this.esc(e.message)}</p>`; }
    }
    // Fit each drawing once it is displayed (one drawn in a hidden tab is fitted on a later pass).
    for (const svg of root.querySelectorAll('svg.vz:not([data-fit])')) {
      this.fit(svg);
      try { if (svg.getBBox().width) svg.setAttribute('data-fit', '1'); } catch {}
      const d = svg.closest('.diagram'); if (d && d._size) d._size();
    }
  },
  // Step-by-step: one frame at a time, ◀ ▶ and Play.
  mountFrames(el, spec) {
    const frames = spec.frames || [], caps = spec.captions || [];
    let i = spec.start === 'last' ? Math.max(0, frames.length - 1) : 0, timer = null;
    el.innerHTML = `<div class="vz-steps"><button class="small vz-prev">◀</button><span class="small vz-pos"></span><button class="small vz-next">▶</button><button class="small vz-play">▶ Play</button></div><div class="dg-svg"></div><p class="vz-cap"></p>`;
    let prevLabels = null;
    const show = () => {
      const box = $('.dg-svg', el);
      box.innerHTML = this.render(frames[i]);
      this.fit($('svg', box));
      if (el._size) el._size();
      // What changed since the step before: new nodes/cells glow for a moment; the whole drawing fades in.
      // (labels from the visible text only: hover tooltips must not make an unchanged item look new)
      const items = [...box.querySelectorAll('g.vz-node, g.vz-cell, g.vz-bar')], labels = items.map(g => [...g.querySelectorAll('text')].map(t => t.textContent).join('|').trim());
      if (prevLabels) { const before = prevLabels.slice(); items.forEach((g, k) => { const at = before.indexOf(labels[k]); if (at >= 0) before.splice(at, 1); else g.classList.add('vz-new'); }); }
      prevLabels = labels;
      box.classList.remove('vz-fade'); void box.offsetWidth; box.classList.add('vz-fade');
      $('.vz-pos', el).textContent = `Step ${i + 1} of ${frames.length}`;
      $('.vz-cap', el).textContent = caps[i] || frames[i].caption || '';
      $('.vz-prev', el).disabled = i === 0; $('.vz-next', el).disabled = i === frames.length - 1;
    };
    $('.vz-prev', el).onclick = () => { i = Math.max(0, i - 1); show(); };
    $('.vz-next', el).onclick = () => { i = Math.min(frames.length - 1, i + 1); show(); };
    $('.vz-play', el).onclick = e => {
      if (timer) { clearInterval(timer); timer = null; e.target.textContent = '▶ Play'; return; }
      if (i === frames.length - 1) i = 0;
      e.target.textContent = '❚❚ Pause'; show();
      timer = setInterval(() => { if (i >= frames.length - 1 || !el.isConnected) { clearInterval(timer); timer = null; e.target.textContent = '▶ Play'; return; } i++; show(); }, 1300);
    };
    show();
  },
};

// ---------- toolbar for every drawing (viz and mermaid): zoom, fit, full screen, download SVG / PNG ----------
const DiagramTools = {
  attach(el) {
    if (el.querySelector(':scope > .dg-tools')) return;
    const bar = document.createElement('div');
    bar.className = 'dg-tools';
    bar.innerHTML = `<button title="Zoom out">−</button><button title="Fit">⤢</button><button title="Zoom in">+</button><button title="Full screen">⛶</button><button title="Download SVG">SVG</button><button title="Download PNG">PNG</button>`;
    el.prepend(bar);
    let z = 1;
    const svg = () => el.querySelector('.dg-svg svg');
    // A tall drawing may be limited to most of the screen height, but never shrunk below 85%: small text is unreadable.
    const s0 = svg(), vb0 = s0 && s0.viewBox && s0.viewBox.baseVal;
    if (vb0 && vb0.height) s0.style.maxHeight = `max(62vh, ${Math.round(vb0.height * 0.85)}px)`;
    const apply = () => {
      const s = svg(); if (!s) return;
      const w = (s.viewBox.baseVal && s.viewBox.baseVal.width) || s.getBBox().width;
      s.style.maxWidth = z === 1 ? '' : 'none'; s.style.maxHeight = z === 1 ? (vb0 && vb0.height ? `max(62vh, ${Math.round(vb0.height * 0.85)}px)` : '') : 'none';
      s.style.width = z === 1 ? '' : `${w * z}px`; s.style.height = z === 1 ? '' : 'auto';
      el.querySelector('.dg-svg').style.overflow = z === 1 ? '' : 'auto';
      if (z === 1) size();
    };
    // Size for the space the drawing has: its natural size when that fits; when it doesn't (a phone, a narrow
    // panel), never below 80% of it, so the text stays readable, scrolling sideways inside its box instead.
    const size = () => {
      const s = svg(), vb = s && s.viewBox && s.viewBox.baseVal, box = el.querySelector('.dg-svg');
      if (!vb || !vb.width || !box || z !== 1) return;
      const cw = box.clientWidth; if (!cw) return;
      const w = vb.width <= cw ? vb.width : Math.max(cw, 0.8 * vb.width), wide = w > cw + 1;
      Object.assign(s.style, { width: `${Math.round(w)}px`, maxWidth: 'none', minWidth: '0', height: 'auto', flexShrink: '0' });
      Object.assign(box.style, { overflowX: wide ? 'auto' : '', justifyContent: wide ? 'flex-start' : '' });
    };
    el._size = size;
    size();
    if (window.ResizeObserver) { let last = 0; new ResizeObserver(() => { const w = el.clientWidth; if (Math.abs(w - last) > 2) { last = w; size(); } }).observe(el); }
    const [out, fit, inn, full, dsvg, dpng] = bar.querySelectorAll('button');
    out.onclick = () => { z = Math.max(0.5, z / 1.25); apply(); };
    inn.onclick = () => { z = Math.min(4, z * 1.25); apply(); };
    fit.onclick = () => { z = 1; apply(); };
    full.onclick = () => { const s = svg(); if (s && s.matches('.vz')) Viz.fit(s); this.fullscreen(el); };
    dsvg.onclick = () => { const s = svg(); if (s && s.matches('.vz')) Viz.fit(s); if (s) downloadText(this.standalone(s), 'diagram.svg', 'image/svg+xml'); };
    dpng.onclick = () => { const s = svg(); if (s && s.matches('.vz')) Viz.fit(s); if (s) this.png(s); };
  },
  // A self-contained copy: computed colours written inline, so it looks the same outside the app.
  standalone(svg) {
    const c = svg.cloneNode(true), src = [svg, ...svg.querySelectorAll('*')], dst = [c, ...c.querySelectorAll('*')];
    src.forEach((n, i) => { const cs = getComputedStyle(n); ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'opacity', 'stroke-dasharray'].forEach(p => { const v = cs.getPropertyValue(p); if (v) dst[i].style.setProperty(p, v); }); });
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    c.style.background = getComputedStyle(document.body).backgroundColor;
    return new XMLSerializer().serializeToString(c);
  },
  png(svg) {
    const vb = svg.viewBox.baseVal, w = (vb && vb.width) || svg.getBoundingClientRect().width, h = (vb && vb.height) || svg.getBoundingClientRect().height, scale = 2;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = w * scale; cv.height = h * scale;
      const g = cv.getContext('2d'); g.fillStyle = getComputedStyle(document.body).backgroundColor; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'diagram.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(this.standalone(svg));
  },
  fullscreen(el) {
    const ov = document.createElement('div');
    ov.className = 'dg-full';
    ov.innerHTML = `<div class="dg-full-box"><button class="dg-close" title="Close (Esc)">✕</button><div class="dg-full-body"></div></div>`;
    const svg = el.querySelector('.dg-svg svg');
    if (!svg) return;
    const big = svg.cloneNode(true), vb = svg.viewBox && svg.viewBox.baseVal;
    // as large as the screen allows: up to 2.5× the drawing's own size
    if (vb && vb.width) { big.style.width = `${Math.min(window.innerWidth - 80, 1160, vb.width * 2.5)}px`; big.style.maxWidth = '100%'; big.style.maxHeight = '82vh'; big.removeAttribute('width'); }
    $('.dg-full-body', ov).appendChild(big);
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    ov.onclick = e => { if (e.target === ov || e.target.classList.contains('dg-close')) close(); };
    document.addEventListener('keydown', esc);
    document.body.appendChild(ov);
  },
};

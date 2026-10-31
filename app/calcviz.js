// Drawings of the exact calculators' results (solvers.js), made from the calculator's own numbers, never by a model:
// the Gantt chart of a CPU schedule, the frames after every page reference, the bits of an address, the subnet's range,
// a pipeline's space-time chart, Banker's steps, the disk head's path, the minimal DFA, the MST / shortest paths, the
// K-map groups, the hash table's probes. Each drawing reads the calculator's worked solution (its tables and lines),
// so what is drawn is exactly what was computed; where a step needs re-running (the round-robin queue, the hash probes)
// it is re-run here and drawn only if it reproduces the calculator's result.
//
// CalcViz.specs(id, params, result) → [{ title, spec }]   (empty for a calculator with no drawing, or an unknown id)
// CalcViz.html(id, params, result)  → HTML of the drawings (viz.js draws them)
// CalcViz.mount(box, id, params, result) → answer + drawings + "what if" inputs that re-run the calculator instantly

const CalcViz = {
  // ---------- reading the calculator's worked solution ----------
  table(md) {   // the first Markdown table: { head: [..], rows: [[..]] }
    const lines = String(md || '').split('\n').map(l => l.trim());
    const at = lines.findIndex(l => l.startsWith('|'));
    if (at < 0) return null;
    const cells = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim().replace(/\*\*/g, ''));
    const rows = [];
    for (let i = at + 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(cells(lines[i]));
    return { head: cells(lines[at]), rows };
  },
  col(t, re) { return t ? t.head.findIndex(h => re.test(h)) : -1; },
  n(x) { const v = parseFloat(String(x).replace(/[^\d.eE+-]/g, '')); return isFinite(v) ? v : NaN; },
  fmt(x) { return typeof Viz !== 'undefined' ? Viz.num(x) : String(x); },
  list(v) { return Array.isArray(v) ? v.map(Number) : String(v || '').split(/[\s,;]+/).filter(Boolean).map(Number); },

  specs(id, p, r) {
    const f = this.kinds[id];
    if (!f || !r || !r.steps) return [];
    try { return (f.call(this, p || {}, r) || []).filter(x => x && x.spec); } catch (e) { console.warn('calcviz', id, e); return []; }
  },
  html(id, p, r) {
    return this.specs(id, p, r).map(x => {
      let ok = true; try { Viz.render(x.spec); } catch { ok = false; }   // never show a drawing that fails to draw
      return ok ? `<div class="cv-item">${x.title ? `<p class="cv-title">${escapeHtml(x.title)}</p>` : ''}<div class="diagram viz" data-viz="${encodeURIComponent(JSON.stringify(x.spec))}"><p class="small muted">Drawing&hellip;</p></div></div>` : '';
    }).join('');
  },

  kinds: {
    // ---------- CPU scheduling: Gantt chart; the ready queue at each slice ----------
    cpu(p, r) {
      const m = r.steps.match(/\*\*Gantt chart:\*\* (.+)/);
      if (!m) return [];
      const segs = m[1].split(' → ').map(x => x.match(/^(.*) \[(-?[\d.e+-]+)–(-?[\d.e+-]+)\]$/)).filter(Boolean).map(x => ({ name: x[1], a: +x[2], b: +x[3] }));
      const t = this.table(r.steps), info = {};
      const ci = { at: this.col(t, /^Arrival/), bt: this.col(t, /^Burst/), ct: this.col(t, /^Completion/), tat: this.col(t, /^Turnaround/), wt: this.col(t, /^Waiting/), rt: this.col(t, /^Response/) };
      (t ? t.rows : []).forEach(row => { info[row[0]] = Object.fromEntries(Object.entries(ci).map(([k, j]) => [k, j >= 0 ? row[j] : ''])); });
      const tip = (name, a, b) => {
        const x = info[name];
        if (!x) return null;
        return `${name}: runs ${this.fmt(a)}–${this.fmt(b)}\nArrival ${x.at}, burst ${x.bt}\nCompletion ${x.ct}, turnaround ${x.tat}, waiting time ${x.wt}`;
      };
      const avg = r.steps.match(/Average waiting = ([^,]+), average turnaround = ([^,]+)/);
      const out = [{ title: 'Gantt chart (hover a bar for its times)', spec: { type: 'gantt', bars: segs.map(s => [s.name, s.a, s.b, tip(s.name, s.a, s.b)]), caption: avg ? `Average waiting time ${avg[1]}, average turnaround time ${avg[2]}` : '' } }];
      const fr = this.cpuFrames(p, segs, info, tip);
      if (fr) out.push({ title: 'Step by step, with the ready queue', spec: fr });
      return out;
    },
    // ---------- page replacement: the frames after every reference ----------
    page(p, r) {
      const t = this.table(r.steps);
      if (!t || !t.rows.length) return [];
      const refs = t.rows.map(x => x[0]), slots = t.rows.map(x => x[1].split(/\s+/).filter(Boolean)), faults = t.rows.map(x => /fault/i.test(x[2]));
      const changed = slots.map((s, i) => {
        if (!faults[i]) return -1;
        const prev = slots[i - 1] || [];
        if (s.length > prev.length) return s.length - 1;
        return s.findIndex((v, k) => v !== prev[k]);
      });
      const algo = String(p.algorithm || 'FIFO').toUpperCase(), F = +p.frames || Math.max(...slots.map(s => s.length));
      const why = { FIFO: 'loaded earliest', LRU: 'least recently used', OPT: 'not needed for the longest time', OPTIMAL: 'not needed for the longest time', LFU: 'least frequently used', MRU: 'most recently used' }[algo] || '';
      const frames = refs.map((_, i) => ({ type: 'refgrid', refs, slots, faults, changed, frames: F, upto: i }));
      const captions = refs.map((ref, i) => {
        const ev = faults[i] && i && changed[i] >= 0 ? (slots[i - 1] || [])[changed[i]] : null;
        return `Reference ${ref}: ${faults[i] ? `fault, ${ev != null ? `replace ${ev}${why ? ` (${why})` : ''}` : `load into free frame ${changed[i] + 1}`}` : 'hit'}.`;
      });
      return [{ title: `${algo} with ${F} frames: what each frame holds after every reference (F = fault, H = hit)`, spec: { type: 'frames', frames, captions, start: 'last' } }];
    },
    // ---------- cache: the address split into tag | index | offset ----------
    cache(p, r) {
      const s = r.steps, g = re => { const m = s.match(re); return m ? +m[m.length - 1] : NaN; };
      const off = g(/Offset bits = [^*]*\*\*(\d+)\*\*/), idx = g(/Index \(set\) bits = [^*]*\*\*(\d+)\*\*/), tag = g(/Tag bits = [^*]*\*\*(-?\d+)\*\*/), A = g(/(\d+)-bit \(byte\) addresses/);
      const lines = g(/Lines = [^*]*\*\*(\d+)\*\*/), sets = g(/Sets = [^*]*\*\*(\d+)\*\*/), kind = (s.match(/(direct mapped|fully associative|\d+-way set associative)/) || [])[1] || '';
      if (![off, idx, tag, A].every(isFinite) || tag < 0) return [];
      const label = /direct/.test(kind) ? 'Line index' : 'Set index';
      return [{ title: `${A}-bit address, ${kind} cache: ${lines} lines${sets !== lines && sets > 1 ? `, ${sets} sets` : ''}`, spec: { type: 'bits', segments: [['Tag', tag], [label, idx], ['Block offset', off]] } }];
    },
    // ---------- paging: virtual and physical address fields, and the multi-level split ----------
    paging(p, r) {
      const s = r.steps, m = (re) => s.match(re);
      const off = m(/Offset bits = [^*]*\*\*(\d+)\*\*/), vpn = m(/Page number bits = (\d+) − \d+ = \*\*(-?\d+)\*\*/), fr = m(/Frame bits = (\d+) − \d+ = \*\*(-?\d+)\*\*/), lv = m(/⌈\d+ \/ ([\d.]+)⌉ = \*\*(\d+)\*\*/);
      if (!off || !vpn || +vpn[2] < 0) return [];
      const o = +off[1], items = [{ type: 'bits', segments: [['Page number', +vpn[2]], ['Offset', o]] }], titles = [`Virtual address (${vpn[1]} bits): ${2 ** +vpn[2]} pages`];
      if (fr && +fr[2] > 0) { items.push({ type: 'bits', segments: [['Frame number', +fr[2]], ['Offset', o]] }); titles.push(`Physical address (${fr[1]} bits): ${2 ** +fr[2]} frames`); }
      if (lv && +lv[2] > 1 && Number.isInteger(+lv[1])) {
        const L = +lv[2], per = +lv[1], segs = [];
        for (let k = 0; k < L; k++) segs.push([`Level ${k + 1}`, k === 0 ? +vpn[2] - per * (L - 1) : per]);
        segs.push(['Offset', o]);
        if (segs[0][1] > 0) { items.push({ type: 'bits', segments: segs }); titles.push(`${L}-level page table: each inner table indexes ${per} bits (a table fills one page)`); }
      }
      return [{ title: 'Address fields', spec: { type: 'group', items, titles } }];
    },
    // ---------- IPv4: network | host bits, and the block's range ----------
    ip(p, r) {
      const s = r.steps, g = re => (s.match(re) || [])[1];
      const prefix = +g(/\/(\d+) leaves/), net = g(/Network address[^*]*\*\*([\d.]+)\*\*/), bc = g(/Broadcast[^*]*\*\*([\d.]+)\*\*/);
      const hm = s.match(/Usable hosts: ([\d.]+) to ([\d.]+) = [^*]*\*\*(\d+)\*\*/), ipStr = String(p.ip || '').trim().split('/')[0];
      if (!(prefix >= 0) || !net || !bc || !/^\d+(\.\d+){3}$/.test(ipStr)) return [];
      const int = d => d.split('.').reduce((a, o) => a * 256 + +o, 0), bin = int(ipStr).toString(2).padStart(32, '0');
      const dotted = (b, from) => [...b].map((c, k) => (k && (from + k) % 8 === 0 ? '.' : '') + c).join('');
      const out = [{ title: `${ipStr}/${prefix} in binary: the first ${prefix} bits name the network`, spec: { type: 'bits', segments: [['Network', prefix, dotted(bin.slice(0, prefix), 0)], ['Host', 32 - prefix, dotted(bin.slice(prefix), prefix)]] } }];
      const a = int(net), b = int(bc), segs = hm && +hm[3] > 0
        ? [['Network', a, a, net], [`${hm[3]} usable hosts`, a + 1, b - 1, hm[1], hm[2]], ['Broadcast', b, b, bc]]
        : [['Block', a, b, net, bc]];
      out.push({ title: `The block ${net}/${prefix} (${b - a + 1} addresses)`, spec: { type: 'range', segments: segs, marks: [[int(ipStr), `${ipStr} (given)`]] } });
      return out;
    },
    // ---------- pipeline: space-time chart ----------
    pipe(p, r) {
      const cyc = +((r.steps.match(/Cycles = [^*]*\*\*(\d+)\*\*/) || [])[1]);
      const k = this.list(p.stage_delays).length || +p.stages, n = +p.instructions, st = +p.stall_cycles || 0;
      if (!(k > 0) || !(n > 0) || !isFinite(cyc) || k > 12) return [];
      const names = k === 5 ? ['IF', 'ID', 'EX', 'MEM', 'WB'] : k === 4 ? ['IF', 'ID', 'EX', 'WB'] : k === 3 ? ['IF', 'ID', 'EX'] : Array.from({ length: k }, (_, i) => `S${i + 1}`);
      const show = Math.min(n, 6), rows = [];
      // the question gives only the total stall cycles: they are drawn on I2, and every later instruction waits too
      for (let i = 0; i < show; i++) rows.push([`I${i + 1}`, i + 1 + (i >= 2 ? st : 0), i === 1 ? st : 0]);
      const last = n + st + k - 1;
      if (last !== cyc) return [];
      return [{ title: `${k}-stage pipeline: ${n} instructions take k + n − 1${st ? ' + stalls' : ''} = ${cyc} cycles`, spec: { type: 'pipeline', stages: names, rows,
        caption: `${n > show ? `The first ${show} of ${n} instructions; I${n} finishes in cycle ${cyc}. ` : ''}${st ? `The ${st} stall cycle${st > 1 ? 's are' : ' is'} drawn on I2 (only the total is given).` : ''}` } }];
    },
    // ---------- Banker's: Need ≤ Work, run, release, step by step ----------
    banker(p, r) {
      const t = this.table(r.steps);
      if (!t || !t.rows.length) return [];
      const L = v => this.list(v), alloc = (p.allocation || []).map(L), n = alloc.length;
      const names = (p.names && p.names.length ? p.names : alloc.map((_, i) => 'P' + i)).map(String);
      let need = p.need && p.need.length ? p.need.map(L) : (p.max || []).map(L).map((row, i) => row.map((v, j) => v - alloc[i][j]));
      let avail = p.available && L(p.available).length ? L(p.available) : L(p.total).map((v, j) => v - alloc.reduce((s, row) => s + row[j], 0));
      if (/^Pretend to grant/.test(r.steps)) {
        const i = names.findIndex(x => x.toLowerCase() === String(p.request_process).toLowerCase()), req = L(p.request);
        avail = avail.map((v, j) => v - req[j]); alloc[i] = alloc[i].map((v, j) => v + req[j]); need = need.map((row, k) => k === i ? row.map((v, j) => v - req[j]) : row);
      }
      if (!n || need.length !== n) return [];
      const res = avail.map((_, j) => String.fromCharCode(65 + j)), vec = v => v.join(' ');
      const done = [], frames = [], captions = [];
      const snap = (hi, work, cap, seq) => {
        frames.push({ type: 'group', items: [{ type: 'table', head: ['Process', 'Allocation', 'Need', 'Finished'], rows: names.map((x, i) => [x, vec(alloc[i]), vec(need[i]), done.includes(i) ? '✓' : '']), hi: hi == null ? [] : [hi], done: done.filter(i => i !== hi) },
          { type: 'group', dir: 'row', items: [{ type: 'array', cells: work, index: res }, { type: 'array', cells: seq.length ? seq : [''], highlight: seq.length ? [seq.length - 1] : [] }], titles: ['Work', 'Safe sequence so far'] }] });
        captions.push(cap);
      };
      snap(null, avail, `Start: Work = Available = (${vec(avail)}).`, []);
      const seq = [];
      for (const row of t.rows) {
        const i = names.indexOf(row[0]);
        if (i < 0) return [];
        seq.push(row[0]);
        const before = row[2].split(/\s+/), after = row[3].split(/\s+/);
        snap(i, after, `${row[0]}: Need (${row[1]}) ≤ Work (${row[2]}), so it can finish and release its allocation (${vec(alloc[i])}): Work = (${row[3]}).`, seq.slice());
        done.push(i);
        if (before.length !== avail.length) return [];
      }
      const safe = done.length === n;
      snap(null, (t.rows.length ? t.rows[t.rows.length - 1][3] : vec(avail)).split(/\s+/), safe ? `Every process finished: the state is safe. Safe sequence ${seq.join(' → ')}.` : `Stuck: ${names.filter((_, i) => !done.includes(i)).join(', ')} need more than Work. The state is unsafe.`, seq.slice());
      return [{ title: "Banker's safety check, step by step", spec: { type: 'frames', frames, captions, start: 'last' } }];
    },
    // ---------- disk scheduling: the head's path ----------
    disk(p, r) {
      const om = r.steps.match(/Order: (.+)/);
      if (!om) return [];
      const path = om[1].split(' → ').map(Number);
      const legLine = r.steps.split('\n').find(l => /→\d+ \(\d+/.test(l)) || '';
      const legs = legLine.split(' + '), jumps = legs.map((l, i) => /return jump/.test(l) ? i : -1).filter(i => i >= 0);
      const total = (r.steps.match(/Total head movement = \*\*(\d+)\*\*/) || [])[1];
      const lo = p.min_cylinder != null && p.min_cylinder !== '' ? +p.min_cylinder : 0, hi = p.max_cylinder != null && p.max_cylinder !== '' ? +p.max_cylinder : null;
      const algo = (r.steps.match(/^\*\*(\w+)\*\*/) || [])[1] || String(p.algorithm || '');
      return [{ title: `${algo}: total head movement ${total} cylinders (hover a move for its length)`, spec: { type: 'track', path, min: lo, max: hi, jumps } }];
    },
    // ---------- K-map with the chosen groups ----------
    kmap(p, r) {
      const n = +p.variables, all = 2 ** n, L = v => this.list(v);
      if (!(n >= 1 && n <= 6)) return [];
      const dc = L(p.dont_cares).filter(x => x >= 0 && x < all);
      let mins = L(p.minterms).filter(x => x >= 0 && x < all);
      if (!mins.length && L(p.maxterms).length) { const M = new Set(L(p.maxterms)); mins = [...Array(all).keys()].filter(x => !M.has(x) && !dc.includes(x)); }
      mins = [...new Set(mins)].filter(x => !dc.includes(x));
      const nm = String(p.names || '').replace(/[\s,]/g, ''), names = (nm.length === n ? nm : 'ABCDEFGH'.slice(0, n)).split('');
      const em = r.steps.match(/\*\*F = (.+?)\*\*/), terms = em ? em[1].split(' + ').map(x => x.trim()) : [];
      const groups = [];
      for (const term of terms) {
        const pat = Array(n).fill('-');
        if (term !== '1') {
          let i = 0;
          while (i < term.length) {
            const k = names.indexOf(term[i]);
            if (k < 0) return [];
            const neg = term[i + 1] === "'";
            pat[k] = neg ? '0' : '1'; i += neg ? 2 : 1;
          }
        }
        groups.push(pat.join(''));
      }
      // every group must cover only 1s and don't-cares (a check that the expression was read back right)
      const ok = new Set([...mins, ...dc]);
      for (const g of groups) for (let m = 0; m < all; m++) if ([...g].every((ch, k) => ch === '-' || ch === m.toString(2).padStart(n, '0')[k]) && !ok.has(m)) return [];
      return [{ title: em ? `F = ${em[1]}: one coloured loop per product term` : 'K-map', spec: { type: 'kmap', vars: n, names: names.join(''), ones: mins, dc, groups, terms } }];
    },
    // ---------- hashing: the probes for every key ----------
    hash(p, r) {
      const t = this.table(r.steps);
      if (!t) return [];
      const m = +p.table_size, keys = this.list(p.keys), method = String(p.method || 'linear').toLowerCase(), R = +p.r || 7;
      if (!(m > 0) || m > 31) return [];
      const h1 = k => ((k % m) + m) % m, h2 = k => R - (k % R), table = Array(m).fill(null), frames = [], captions = [];
      for (const [n, k] of keys.entries()) {
        const probes = [];
        let placed = -1;
        for (let i = 0; i < m * (method.startsWith('quad') ? 2 : 1); i++) {
          const slot = method.startsWith('quad') ? (h1(k) + i * i) % m : method.startsWith('double') ? (h1(k) + i * h2(k)) % m : (h1(k) + i) % m;
          probes.push(slot);
          if (table[slot] == null) { table[slot] = k; placed = slot; break; }
        }
        const row = t.rows[n];
        if (!row || String(placed < 0 ? 'not placed' : placed) !== row[2]) return [];   // must match the calculator
        const ptr = {}; probes.forEach((sl, j) => { ptr[sl] = `${j + 1}${sl === placed ? ' ✓' : ' ✗'}`; });
        frames.push({ type: 'array', cells: table.map(v => v ?? ''), highlight: placed >= 0 ? [placed] : [], pointers: ptr, title: `Insert ${k}`, tips: table.map((v, i) => `slot ${i}: ${v ?? 'empty'}`) });
        captions.push(`Insert ${k}: h(${k}) = ${h1(k)}${method.startsWith('double') ? `, h₂ = ${h2(k)}` : ''}; ${probes.length > 1 ? `probes ${probes.join(' → ')} (${probes.length - 1} taken)` : 'free at once'}${placed < 0 ? ', no free slot found' : `, placed in slot ${placed}`}.`);
      }
      return [{ title: `${method} probing into ${m} slots: the probes for each key (✗ taken, ✓ placed)`, spec: { type: 'frames', frames, captions, start: 'last' } }];
    },
    // ---------- minimal DFA: the original and the merged one ----------
    dfa(p, r) {
      const tr = (p.transitions || []).map(t => [String(t.from).trim(), String(t.symbol).trim(), String(t.to).trim()]);
      const start = String(p.start || (tr[0] && tr[0][0]) || '').trim(), finals = (p.finals || []).map(s => String(s).trim());
      const cm = r.steps.match(/Equivalence classes: (.+)/), am = r.steps.match(/Alphabet \{([^}]*)\}/);
      if (!cm || !am || !tr.length) return [];
      const classes = [...cm[1].matchAll(/\{([^}]*)\}/g)].map(x => x[1].split(', ').map(s => s.trim()));
      const alpha = am[1].split(', ').map(s => s.trim()).filter(Boolean), delta = {};
      tr.forEach(([a, s, b]) => { delta[a + '|' + s] = b; });
      const name = c => c.length === 1 ? c[0] : `{${c.join(',')}}`, of = st => classes.find(c => c.includes(st));
      const min = [];
      classes.forEach(c => alpha.forEach(a => { const to = delta[c[0] + '|' + a] ?? '∅', tc = of(to); if (tc) min.push([name(c), a, name(tc)]); }));
      const sc = of(start);
      if (!sc) return [];
      const orig = { type: 'dfa', states: [...new Set(tr.flatMap(t => [t[0], t[2]]))], start, finals, transitions: tr };
      const mn = { type: 'dfa', states: classes.map(name), start: name(sc), finals: classes.filter(c => c.some(s => finals.includes(s))).map(name), transitions: min };
      return [{ title: `Minimal DFA: ${classes.length} states (◀ shows the original)`, spec: { type: 'frames', frames: [orig, mn], captions: ['The DFA as given.', `Equivalent states merged: ${classes.map(name).join(', ')}.`], start: 'last' } }];
    },
    // ---------- graphs: MST edges, shortest paths, components ----------
    graph(p, r) {
      const E = (p.edges || []).map(e => ({ u: String(e.u).trim(), v: String(e.v).trim(), w: e.w == null || e.w === '' ? 1 : +e.w, given: !(e.w == null || e.w === '') })).filter(e => e.u && e.v);
      if (!E.length || E.length > 40) return [];
      const nodes = [...new Set(E.flatMap(e => [e.u, e.v]))].sort(), directed = !!p.directed, weighted = E.some(e => e.given);
      if (nodes.length > 16) return [];
      const base = { type: 'graph', nodes, edges: E.map(e => weighted ? [e.u, e.v, e.w] : [e.u, e.v]), directed };
      const ask = p.ask || 'mst_weight';
      if (ask === 'mst_weight' || ask === 'mst_edges') {
        const line = r.steps.split('\n\n')[1] || '', chosen = [...line.matchAll(/(\S+)–(\S+) \((-?[\d.]+)\)/g)].map(x => [x[1], x[2]]);
        const w = (r.steps.match(/MST weight = \*\*(-?[\d.]+)\*\*/) || [])[1];
        return [{ title: `Minimum spanning tree (Kruskal), weight ${w}: its ${chosen.length} edges are blue`, spec: { ...base, highlight: chosen } }];
      }
      if (ask === 'shortest_distance') {
        const t = this.table(r.steps);
        if (!t || /negative cycle/.test(r.text)) return [{ title: 'The graph', spec: base }];
        const dist = {}; t.rows.forEach(row => { dist[row[0]] = row[1] === '∞' ? Infinity : +row[1]; });
        const src = String(p.source || nodes[0]).trim(), dst = String(p.target || '').trim();
        const arcs = directed ? E : E.concat(E.map(e => ({ ...e, u: e.v, v: e.u })));
        const pred = {};
        for (const v of nodes) if (v !== src && isFinite(dist[v])) { const a = arcs.find(e => e.v === v && isFinite(dist[e.u]) && Math.abs(dist[e.u] + e.w - dist[v]) < 1e-9 && e.u !== v); if (a) pred[v] = a.u; }
        let hl = [];
        if (dst && pred[dst] != null) { let v = dst, guard = 0; while (v !== src && pred[v] != null && guard++ < 50) { hl.push([pred[v], v]); v = pred[v]; } hl.reverse(); }
        else hl = Object.entries(pred).map(([v, u]) => [u, v]);
        const dpath = dst && hl.length ? [src, ...hl.map(e => e[1])].join(' → ') : '';
        return [{ title: dst ? `Shortest path ${src} → ${dst}${dpath ? `: ${dpath}` : ''}, distance ${isFinite(dist[dst]) ? this.fmt(dist[dst]) : '∞'}` : `Shortest-path tree from ${src}`, spec: { type: 'group', items: [{ ...base, highlight: hl, mark: [src, dst].filter(Boolean),
          tips: Object.fromEntries(nodes.map(v => [v, `${v}: distance ${isFinite(dist[v]) ? this.fmt(dist[v]) : '∞'} from ${src}${pred[v] != null ? `, reached from ${pred[v]}` : ''}`])) },
          { type: 'array', cells: nodes.map(v => isFinite(dist[v]) ? this.fmt(dist[v]) : '∞'), index: nodes, highlight: dst ? [nodes.indexOf(dst)] : [], title: `Distance from ${src}` }] } }];
      }
      const parent = {}; nodes.forEach(v => { parent[v] = v; });
      const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
      E.forEach(e => { parent[find(e.u)] = find(e.v); });
      const roots = [...new Set(nodes.map(find))];
      return [{ title: `${roots.length} connected component${roots.length > 1 ? 's' : ''}${directed ? ' (weakly connected)' : ''}, one colour each`, spec: { ...base, groups: Object.fromEntries(nodes.map(v => [v, roots.indexOf(find(v))])) } }];
    },
  },

  // (the calculators below return their results as data too, so the drawings use that data directly)
  more: {
    // ---------- shortest paths: Dijkstra step by step (or Bellman–Ford pass by pass), then the path ----------
    sp(p, r) {
      const nodes = r.nodes, E = r.edges;
      if (!nodes || !E || nodes.length > 16 || E.length > 40) return [];
      const base = { type: 'graph', nodes, edges: E.map(e => [e.u, e.v, e.w]), directed: !!r.directed }, src = r.source, tgt = String(p.target ?? '').trim();
      const show = d => d == null || d === Infinity ? '∞' : this.fmt(d);
      const tree = pred => Object.entries(pred).filter(([, u]) => u != null).map(([v, u]) => [u, v]);
      const frames = [], captions = [];
      const snap = (dist, pred, cur, done, changed, cap) => {
        frames.push({ type: 'group', items: [{ ...base, highlight: tree(pred), mark: cur ? [cur] : [], groups: Object.fromEntries(done.filter(v => v !== cur).map(v => [v, 1])) },
          { type: 'array', cells: nodes.map(v => show(dist[v])), index: nodes, highlight: changed.map(v => nodes.indexOf(v)), done: done.map(v => nodes.indexOf(v)), title: `Distance from ${src}` }] });
        captions.push(cap);
      };
      if (r.algorithm === 'dijkstra' && r.order) {
        // replay the calculator's own finalising order with its relaxation rule; it must end at its distances
        const arcs = r.directed ? E : E.flatMap(e => [e, { u: e.v, v: e.u, w: e.w }]), dist = {}, pred = {}, done = [];
        nodes.forEach(v => { dist[v] = Infinity; }); dist[src] = 0;
        snap(dist, pred, null, [], [src], `Start: ${src} = 0, the rest ∞. Green = finalised, blue = the best path to each vertex so far.`);
        for (const u of r.order) {
          done.push(u);
          const ch = [];
          for (const e of arcs) if (e.u === u && !done.includes(e.v) && dist[u] + e.w < dist[e.v]) { dist[e.v] = dist[u] + e.w; pred[e.v] = u; ch.push(e.v); }
          snap(dist, pred, u, done.slice(), ch, `Finalise ${u} (distance ${show(dist[u])}), relax its edges: ${ch.map(v => `${v} → ${show(dist[v])}`).join(', ') || 'nothing improves'}.`);
        }
        if (nodes.some(v => (r.distances[v] ?? Infinity) !== dist[v])) return [];
      } else if (r.passes && r.passes.length) {
        const d0 = Object.fromEntries(nodes.map(v => [v, v === src ? 0 : Infinity]));
        snap(d0, {}, null, [], [src], `Start: ${src} = 0, the rest ∞. Each pass relaxes every edge.`);
        r.passes.forEach((d, i) => { const prev = i ? r.passes[i - 1] : d0; snap(d, i === r.passes.length - 1 ? r.predecessors : {}, null, [], nodes.filter(v => (d[v] ?? Infinity) !== (prev[v] ?? Infinity)), `After pass ${i + 1}: ${nodes.map(v => `${v} ${show(d[v])}`).join(', ')}.`); });
      } else return [];
      // the answer: the path to the target (or the whole tree), marked
      let hl = tree(r.predecessors || {});
      if (tgt && r.predecessors && r.predecessors[tgt] != null) { hl = []; let v = tgt, g = 0; while (v !== src && r.predecessors[v] != null && g++ < 40) { hl.unshift([r.predecessors[v], v]); v = r.predecessors[v]; } }
      frames.push({ type: 'group', items: [{ ...base, highlight: hl, mark: [src, tgt].filter(Boolean) }, { type: 'array', cells: nodes.map(v => show(r.distances[v])), index: nodes, highlight: tgt ? [nodes.indexOf(tgt)] : [], title: `Distance from ${src}` }] });
      captions.push(tgt ? `Shortest path ${src} → ${tgt}: ${(r.steps.match(/Path [^:]+: (.+)/) || [])[1] || ''}` : 'Done: the shortest-path tree.');
      return [{ title: `${r.algorithm === 'dijkstra' ? 'Dijkstra' : 'Bellman–Ford'} from ${src}, step by step`, spec: { type: 'frames', frames, captions, start: 'last' } }];
    },
    // ---------- topological sort: Kahn's algorithm taking the smallest available vertex ----------
    topo(p, r) {
      if (!r.nodes || r.nodes.length > 16 || !r.edges) return [];
      const base = { type: 'graph', nodes: r.nodes, edges: r.edges.map(e => [e.u, e.v]), directed: true }, frames = [], captions = [];
      const t = this.table(r.steps);
      frames.push({ type: 'group', items: [base, { type: 'array', cells: [''], title: 'Order so far' }] }); captions.push('Start: take a vertex with no incoming edge from a vertex not yet taken.');
      (t ? t.rows : []).forEach((row, i) => {
        const taken = r.order.slice(0, i + 1);
        frames.push({ type: 'group', items: [{ ...base, mark: [row[2]], groups: Object.fromEntries(taken.slice(0, -1).map(v => [v, 1])) }, { type: 'array', cells: taken, highlight: [i], title: 'Order so far' }] });
        captions.push(`Available (in-degree 0): ${row[1]}. Take the smallest, ${row[2]}.`);
      });
      if (frames.length < 2) return [{ title: r.cyclic ? 'The graph has a cycle: no topological order' : 'The graph', spec: base }];
      return [{ title: `Topological order ${r.order.join(', ')}${r.count != null ? ` (one of ${r.count})` : ''}`, spec: { type: 'frames', frames, captions, start: 'last' } }];
    },
    // ---------- Huffman: the code tree, and each symbol's code ----------
    huffman(p, r) {
      if (!r.merges || !r.codes || r.merges.length > 30) return [];
      const made = new Map(), leaf = name => ({ v: `${name}`, c: [] });
      const node = label => made.get(label) || leaf(label);
      r.merges.forEach(m => { made.set(m.label, { v: this.fmt(m.w), c: [node(m.a), node(m.b)] }); made.delete(m.a); made.delete(m.b); });
      const root = made.get(r.merges[r.merges.length - 1].label);
      if (!root) return [];
      const syms = Object.keys(r.codes), freq = Object.fromEntries((this.table(r.steps.split('\n\n').slice(2).join('\n\n')) || { rows: [] }).rows.map(x => [x[0], x[1]]));
      return [{ title: `Huffman tree (left = 0, right = 1); average ${this.fmt(r.avg_bits)} bits per symbol`, spec: { type: 'group', dir: 'row', items: [{ type: 'tree', root },
        { type: 'table', head: ['Symbol', 'Freq', 'Code', 'Bits'], rows: syms.map(s => [s, freq[s] ?? '', r.codes[s], r.lengths[s]]) }] } }];
    },
    // ---------- IP fragmentation: the payload cut into fragments ----------
    frag(p, r) {
      const F = r.fragments;
      if (!F || !F.length || F.length > 12) return [];
      return [{ title: `${F.length} fragment${F.length > 1 ? 's' : ''}: data per fragment ≤ ${r.max_data} bytes (MTU ${r.mtu} − ${r.header_size} header, a multiple of 8)`, spec: { type: 'group', items: [
        { type: 'range', segments: F.map(f => [`#${f.index}: ${f.data} B`, f.first_byte, f.last_byte, `byte ${f.first_byte}`, `${f.last_byte}`]) },
        { type: 'table', head: ['#', 'Data', 'Total length', 'Offset (×8)', 'MF'], rows: F.map(f => [f.index, f.data, f.total_length, `${f.offset} (${f.offset_bytes})`, f.mf]) }] } }];
    },
    // ---------- TCP: cwnd per round with ssthresh and the loss events ----------
    tcp(p, r) {
      const S = r.series;
      if (!S || S.length < 2 || S.length > 80) return [];
      const ss = S.filter(s => s.ssthresh != null).map(s => [s.round, s.ssthresh]);
      return [{ title: `TCP ${r.variant === 'reno' ? 'Reno' : 'Tahoe'}: congestion window per round (MSS)`, spec: { type: 'line', points: S.map(s => [s.round, s.cwnd]), dashed: ss, dashedLabel: 'ssthresh',
        marks: S.filter(s => s.event).map(s => [s.round, s.event === 'timeout' ? 'timeout' : '3 dup ACKs']), xLabel: 'transmission round', yLabel: 'cwnd (MSS)' } }];
    },
  },

  // The CPU schedule step by step: the Gantt chart growing, with the ready queue when each slice starts.
  // Round robin's queue is re-run (viz.js rrSim, the calculator's rule) and used only if it gives the same chart.
  cpuFrames(p, segs, info, tip) {
    const algo = String(p.algorithm || 'FCFS').toUpperCase().replace(/[\s_-]+/g, '');
    const procs = (p.processes || []).map((x, i) => ({ name: String(x.name || 'P' + (i + 1)), at: +x.arrival || 0, bt: +x.burst }));
    if (!procs.length || procs.length > 12 || segs.length > 60) return null;
    const frames = [], captions = [];
    const bars = k => segs.slice(0, k + 1).map(s => [s.name, s.a, s.b, tip(s.name, s.a, s.b)]);
    if (algo === 'RR') {
      let sim; try { sim = Viz.rrSim(procs, +p.quantum, +p.context_switch || 0); } catch { return null; }
      const same = sim.segs.length === segs.length && sim.segs.every((s, k) => s.name === segs[k].name && Math.abs(s.from - segs[k].a) < 1e-3 && Math.abs(s.to - segs[k].b) < 1e-3);
      if (!same) return null;
      sim.slices.forEach(sl => {
        const k = segs.findIndex(s => s.a <= sl.from + 1e-9 && s.b >= sl.to - 1e-9 && s.name === sl.name);
        frames.push({ type: 'group', items: [{ type: 'gantt', bars: bars(k).map(b => b[0] === sl.name && Math.abs(b[2] - segs[k].b) < 1e-9 ? [b[0], b[1], sl.to, b[3]] : b), end: segs[segs.length - 1].b }, { type: 'queue', items: sl.queue }], titles: ['Gantt chart so far', 'Ready queue after this slice'] });
        captions.push(`${this.fmt(sl.from)}–${this.fmt(sl.to)}: ${sl.name} runs ${this.fmt(sl.to - sl.from)}${sl.rem > 0 ? `, ${this.fmt(sl.rem)} left: back to the end of the queue` : ', finished'}. Queue: ${sl.queue.join(' ') || 'empty'}.`);
      });
    } else {
      // the queue when a slice starts: arrived, not finished, not the one running (by arrival)
      segs.forEach((s, k) => {
        const ct = n => +((info[n] || {}).ct);
        const q = procs.filter(x => x.at <= s.a + 1e-9 && ct(x.name) > s.a + 1e-9 && x.name !== s.name).sort((a, b) => a.at - b.at).map(x => x.name);
        frames.push({ type: 'group', items: [{ type: 'gantt', bars: bars(k), end: segs[segs.length - 1].b }, { type: 'queue', items: q }], titles: ['Gantt chart so far', `Waiting at time ${this.fmt(s.a)}`] });
        captions.push(s.name === 'idle' ? `${this.fmt(s.a)}–${this.fmt(s.b)}: nothing has arrived, the CPU is idle.` : s.name === 'CS' ? `${this.fmt(s.a)}–${this.fmt(s.b)}: context switch.` : `${this.fmt(s.a)}–${this.fmt(s.b)}: ${s.name} runs${q.length ? ` while ${q.join(', ')} wait${q.length === 1 ? 's' : ''}` : ''}${+((info[s.name] || {}).ct) === s.b ? ` and finishes at ${this.fmt(s.b)}` : ''}.`);
      });
    }
    return frames.length > 1 ? { type: 'frames', frames, captions } : null;
  },

  // ---------- "what if": the key inputs beside the drawing; changing one re-runs the calculator at once ----------
  WHATIF: {
    cpu: [{ k: 'algorithm', opts: ['FCFS', 'SJF', 'SRTF', 'RR', 'PRIORITY', 'PRIORITY_PREEMPTIVE', 'HRRN'] }, { k: 'quantum', label: 'time quantum', when: p => /^RR$/i.test(p.algorithm || '') }, { k: 'context_switch', label: 'context switch' }],
    page: [{ k: 'algorithm', opts: ['FIFO', 'LRU', 'OPT', 'LFU', 'MRU'] }, { k: 'frames', min: 1 }],
    cache: [{ k: 'cache_size', text: true }, { k: 'block_size', text: true }, { k: 'ways', label: 'ways (0 = fully assoc.)', min: 0 }],
    paging: [{ k: 'page_size', text: true }, { k: 'pte_size', label: 'PTE size', text: true }],
    ip: [{ k: 'prefix', label: 'prefix /', min: 1, max: 32, get: p => { const m = String(p.ip || '').match(/\/(\d+)/); return m ? +m[1] : p.prefix; }, set: (p, v) => ({ ...p, ip: String(p.ip || '').split('/')[0], prefix: v, mask: undefined }) }],
    pipe: [{ k: 'instructions', min: 1 }, { k: 'stall_cycles', label: 'stall cycles', min: 0 }, { k: 'latch_delay', label: 'latch delay', min: 0 }],
    disk: [{ k: 'algorithm', opts: ['FCFS', 'SSTF', 'SCAN', 'CSCAN', 'LOOK', 'CLOOK'] }, { k: 'head', min: 0 }, { k: 'direction', opts: ['up', 'down'] }],
    hash: [{ k: 'table_size', label: 'table size', min: 1 }, { k: 'method', opts: ['linear', 'quadratic', 'double'] }],
    sp: [{ k: 'source', text: true }, { k: 'target', text: true }, { k: 'algorithm', opts: ['dijkstra', 'bellman_ford'] }],
    frag: [{ k: 'mtu', label: 'MTU', min: 29 }, { k: 'header_size', label: 'IP header', min: 20 }],
    tcp: [{ k: 'variant', opts: ['tahoe', 'reno'] }, { k: 'ssthresh', text: true }, { k: 'initial_cwnd', label: 'initial cwnd', text: true }],
    graph: [{ k: 'ask', label: 'show', opts: ['mst_weight', 'shortest_distance', 'components'] }, { k: 'source', text: true, when: p => p.ask === 'shortest_distance' }, { k: 'target', text: true, when: p => p.ask === 'shortest_distance' }],
  },
  whatIfHtml(id, p) {
    const ctl = (this.WHATIF[id] || []).filter(c => !c.when || c.when(p));
    if (!ctl.length) return '';
    return `<div class="cv-whatif"><span class="cv-wi-h">What if</span>${ctl.map(c => {
      const v = c.get ? c.get(p) : p[c.k], lab = escapeHtml(c.label || c.k.replace(/_/g, ' '));
      if (c.opts) return `<label>${lab}<select data-wi="${c.k}">${c.opts.map(o => `<option ${String(v ?? '').toUpperCase() === o.toUpperCase() ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
      return `<label>${lab}<input data-wi="${c.k}" ${c.text ? 'type="text"' : `type="number" step="any"${c.min != null ? ` min="${c.min}"` : ''}${c.max != null ? ` max="${c.max}"` : ''}`} value="${escapeHtml(v ?? '')}"></label>`;
    }).join('')}<button class="link small cv-reset" style="display:none">Back to my inputs</button><span class="cv-wi-msg small"></span></div>`;
  },
  // box gets: the answer, the what-if inputs, the drawings and the worked solution. Changing an input re-solves and
  // redraws straight away; the answer line shows the new value next to the original one.
  mount(box, id, params, result) {
    const orig = { params, result };
    let cur = params;
    const paint = (p, r, keepCtl) => {
      const changed = p !== orig.params;
      const ans = `<div class="check ok cv-ans">Answer: <b>${escapeHtml(r.text)}</b>${changed ? ` <span class="small muted">(your own inputs gave ${escapeHtml(orig.result.text)})</span>` : ''}</div>`;
      const draw = this.html(id, p, r);
      if (!keepCtl) box.innerHTML = ans + (draw ? this.whatIfHtml(id, p) : '') + `<div class="cv-draw">${draw}</div><div class="cv-steps">${renderMd(r.steps)}</div>`;
      else {
        $('.cv-ans', box).outerHTML = ans;
        $('.cv-draw', box).innerHTML = draw;
        $('.cv-steps', box).innerHTML = renderMd(r.steps);
      }
      const rs = $('.cv-reset', box); if (rs) rs.style.display = changed ? '' : 'none';
      if (typeof Viz !== 'undefined') Viz.drawAll(box);
      if (!keepCtl) wire();
    };
    let tmr = null;
    const wire = () => {
      box.querySelectorAll('[data-wi]').forEach(el => { el.oninput = el.onchange = () => { clearTimeout(tmr); tmr = setTimeout(rerun, el.tagName === 'SELECT' ? 0 : 160); }; });
      const rs = $('.cv-reset', box);
      if (rs) rs.onclick = () => { cur = orig.params; paint(orig.params, orig.result, false); };
    };
    const rerun = () => {
      let p = { ...cur };
      for (const el of box.querySelectorAll('[data-wi]')) {
        const c = (this.WHATIF[id] || []).find(x => x.k === el.dataset.wi), raw = el.value.trim();
        if (raw === '') continue;
        const v = el.tagName === 'SELECT' || c.text ? raw : +raw;
        p = c.set ? c.set(p, v) : { ...p, [c.k]: v };
      }
      Object.keys(p).forEach(k => p[k] === undefined && delete p[k]);
      const msg = $('.cv-wi-msg', box);
      try {
        const r = Solvers.solve(id, p);
        cur = p; msg.textContent = '';
        const before = (this.WHATIF[id] || []).filter(c => !c.when || c.when(p)).map(c => c.k).join();
        const ctlNow = [...box.querySelectorAll('[data-wi]')].map(el => el.dataset.wi).join();
        // a control that appears or disappears (time quantum for round robin) rebuilds the inputs
        if (before !== ctlNow) { paint(p, r, false); return; }
        paint(p, r, true);
      } catch (e) { msg.textContent = e.message; box.querySelector('.cv-draw')?.classList.add('cv-stale'); return; }
      box.querySelector('.cv-draw')?.classList.remove('cv-stale');
    };
    paint(params, result, false);
  },
};

// An exact check shown with an answer (Photo doubt, PYQs) also gets the calculator's drawing, inside "The exact working".
if (typeof crossCheckHtml === 'function') {
  const baseCrossCheck = crossCheckHtml;
  // eslint-disable-next-line no-global-assign
  crossCheckHtml = function (c) {
    let html = baseCrossCheck(c);
    try {
      if (c && c.solver && c.params && typeof Solvers !== 'undefined') {
        const s = Solvers.list.find(x => x.name === c.solver || x.id === c.solver);
        if (s && CalcViz.kinds[s.id]) {
          const draw = CalcViz.html(s.id, c.params, Solvers.solve(s.id, c.params));
          if (draw) html = html.replace(/<\/details>(\s*<\/div>)$/, `<div class="cv-draw">${draw}</div></details>$1`);
        }
      }
    } catch {}
    return html;
  };
}
// Drawings inside a closed <details> are fitted when it opens.
document.addEventListener('toggle', e => { if (e.target.open && typeof Viz !== 'undefined' && e.target.querySelector('.diagram.viz')) Viz.drawAll(e.target); }, true);
Object.assign(CalcViz.kinds, CalcViz.more);

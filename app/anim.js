// Topic animations: one exact, step-by-step animation at the top of every lesson, made from the lesson's OWN worked
// example. The model only picks a template and copies the example's inputs out of the lesson (a JSON form); the
// inputs are checked against the lesson's text, and then plain code computes every frame (viz.js algorithms, the exact
// calculators in solvers.js, the data-structure simulator in dsim.js). Nothing drawn in a frame comes from the model.
//
// A lesson's animation is saved with it ({ template, params, label, notice, at }) and rebuilt from the inputs each
// time it is shown (so it is always exact). If no template fits, the lesson's own exact ```viz drawing is used, or
// nothing at all: never an unrelated picture.
//
// TopicAnim.make(title, md, signal, onStage) → anim record
// TopicAnim.build(anim) → { spec, label, notice, warn?, whatIf? }
// TopicAnim.mount(box, { topic, md, anim, save })   (Learn: hub.js openTopic; books: site.js lesson view)

const TopicAnim = {
  // ---------- helpers ----------
  S: (type, extra = {}) => ({ type, ...extra }),
  // A list as the model wrote it: [7, 0, 1], "7 0 1", or wrapped in LaTeX ("R = \langle 7, 0, 1 \rangle", "{7}") → items
  nums(v) {
    // (an item like "PF(3) = 6" is a result the model copied by mistake, not part of the list)
    const parts = (Array.isArray(v) ? v : [v]).filter(x => !/[A-Za-z]+\s*\(\s*[\w,\s]+\)\s*=/.test(String(x ?? ''))).flatMap(x => String(x ?? '').replace(/\\[a-zA-Z]+/g, ' ').replace(/^\s*[A-Za-z]+\s*=\s*/, '').replace(/[{}$<>⟨⟩()[\]]/g, ' ').split(/[\s,;]+/));
    return parts.map(x => x.trim()).filter(Boolean);
  },
  int(x) { const m = String(x ?? '').match(/\d+/); return m ? +m[0] : NaN; },
  val(x) { return x !== '' && isFinite(x) ? +x : String(x); },
  // block names written B4, B_4, $B_{4}$ → 4 (the number is what decides the line); other names stay as they are
  blocks(v) { return this.nums(v).map(x => { const m = String(x).replace(/[$\\{}]/g, '').match(/^[A-Za-z]+_?(\d+)$/); return m ? m[1] : x; }); },
  fmt(x) { return Viz.num(x); },
  plural(n, w) { return `${n} ${w}${n === 1 ? '' : 's'}`; },
  // the last line of a frames spec's captions, for "what to notice"
  frames(out, extra = {}) { return { type: 'frames', frames: out.frames, captions: out.captions, ...extra }; },
  // Does the lesson contain this value? Numbers are compared as numbers (3 = 3.0), names as whole words.
  inLesson(md, v) {
    const s = String(v ?? '').trim();
    if (!s) return true;
    if (isFinite(s)) { const n = +s; return (this._nums || []).some(x => Math.abs(x - n) < 1e-9); }
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_])${esc}($|[^A-Za-z0-9_])`).test(md) || md.includes(s);
  },
  prepNums(md) {
    // numbers in the text, also those written in LaTeX ($P_1$, 10^3, \frac{30}{3}) or as hex
    const t = String(md).replace(/\\[a-zA-Z]+/g, ' ');
    this._nums = [...t.matchAll(/0x[0-9a-f]+|\d+(?:\.\d+)?/gi)].map(m => /^0x/i.test(m[0]) ? parseInt(m[0], 16) : +m[0]);
  },

  // ---------- the templates ----------
  // kw: words in the topic or lesson that make the template a candidate; schema: what the model copies out of the
  // lesson; tokens(p): the values that must appear in the lesson; build(p): the exact animation.
  T: {
    page_replacement: {
      label: 'Page replacement', kw: /page replacement|page fault|reference string|\blru\b|\bfifo\b|optimal|belady|replacement polic/i,
      desc: 'page (or cache block) replacement FIFO / LRU / OPT on a reference string with a number of frames',
      schema: { required: ['algorithm', 'frames', 'references'], properties: { algorithm: { type: 'string', enum: ['FIFO', 'LRU', 'OPT'] }, frames: { type: 'integer' }, references: { type: 'array', items: { type: 'string' }, description: 'the reference string: one page per item, nothing else' } } },
      tokens: p => [TopicAnim.int(p.frames), ...TopicAnim.nums(p.references)],
      seqs: p => [TopicAnim.nums(p.references)],
      whatIf: [{ k: 'frames', label: 'frames', min: 1 }, { k: 'algorithm', opts: ['FIFO', 'LRU', 'OPT'] }],
      build(p) {
        const refs = TopicAnim.nums(p.references).map(TopicAnim.val), F = TopicAnim.int(p.frames), algo = String(p.algorithm || 'FIFO').toUpperCase();
        if (!(F >= 1 && F <= 8) || refs.length < 2 || refs.length > 30) throw new Error('needs 1–8 frames and 2–30 references');
        const out = Viz.pageAlgo({ frames: F, references: refs }, algo), sim = Viz.pageSim(refs, F, algo), nf = sim.faults.filter(Boolean).length;
        return { spec: TopicAnim.frames(out), label: `${algo} page replacement, ${F} frames`, notice: `${nf} faults and ${refs.length - nf} hits on ${refs.length} references (F = fault, H = hit; the outlined column is the current reference).`, result: [nf, refs.length - nf] };
      },
    },
    belady: {
      label: "Belady's anomaly", kw: /belady/i,
      desc: "Belady's anomaly: FIFO on the same reference string with fewer vs more frames",
      schema: { required: ['references', 'frames_small', 'frames_large'], properties: { references: { type: 'array', items: { type: 'string' }, description: 'the reference string: one page number per item, nothing else' }, frames_small: { type: 'integer' }, frames_large: { type: 'integer' } } },
      tokens: p => [TopicAnim.int(p.frames_small), TopicAnim.int(p.frames_large), ...TopicAnim.nums(p.references)],
      seqs: p => [TopicAnim.nums(p.references)],
      build(p) {
        const refs = TopicAnim.nums(p.references).map(TopicAnim.val), a = TopicAnim.int(p.frames_small), b = TopicAnim.int(p.frames_large);
        if (!(a >= 1 && b > a && b <= 8) || refs.length < 3 || refs.length > 24) throw new Error('needs two frame counts and a reference string');
        const run = (refs, a, b, tag) => {
          const A = Viz.pageSim(refs, a, 'FIFO'), B = Viz.pageSim(refs, b, 'FIFO');
          const frames = refs.map((_, i) => ({ type: 'group', items: [{ type: 'refgrid', refs, slots: A.slots, faults: A.faults, changed: A.changed, frames: a, upto: i }, { type: 'refgrid', refs, slots: B.slots, faults: B.faults, changed: B.changed, frames: b, upto: i }], titles: [`${tag}FIFO with ${TopicAnim.plural(a, 'frame')}`, `${tag}FIFO with ${b} frames`] }));
          const captions = refs.map((r, i) => `${tag}Reference ${r}: ${TopicAnim.plural(a, 'frame')} → ${A.faults[i] ? 'fault' : 'hit'}; ${b} frames → ${B.faults[i] ? 'fault' : 'hit'}. Faults so far: ${A.faults.slice(0, i + 1).filter(Boolean).length} vs ${B.faults.slice(0, i + 1).filter(Boolean).length}.`);
          return { frames, captions, fa: A.faults.filter(Boolean).length, fb: B.faults.filter(Boolean).length };
        };
        const own = run(refs, a, b, ''), frames = own.frames.slice(), captions = own.captions.slice();
        let notice = `${TopicAnim.plural(a, 'frame')} → ${own.fa} faults vs ${b} frames → ${own.fb} faults: ${own.fb > own.fa ? 'more frames, MORE faults. That is Belady\'s anomaly (FIFO is not a stack algorithm).' : 'no anomaly on this string.'}`;
        // The lesson's own string shows no anomaly: the classic string (fixed here, not from the model) follows, so the
        // anomaly itself is still seen exactly.
        if (own.fb <= own.fa) {
          const cl = run([1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5], 3, 4, 'Classic string: ');
          captions[captions.length - 1] += ` No anomaly here: every page in this string is ${new Set(refs.map(String)).size === refs.length ? 'different, so every reference faults whatever the frame count' : 'handled at least as well with more frames'}. Next: the classic string that does show it.`;
          frames.push(...cl.frames); captions.push(...cl.captions);
          notice += ` The classic string 1 2 3 4 1 2 5 1 2 3 4 5 (played after it) gives ${cl.fa} faults with 3 frames but ${cl.fb} with 4: that is the anomaly.`;
        }
        return { spec: { type: 'frames', frames, captions }, label: `Belady's anomaly: FIFO with ${a} vs ${b} frames on the lesson's string`, notice, result: [own.fb, own.fa] };
      },
    },
    cpu_scheduling: {
      label: 'CPU scheduling', kw: /schedul|fcfs|first.come|sjf|srtf|shortest.job|round.robin|time quantum|priority|gantt|turnaround|waiting time/i,
      desc: 'CPU scheduling (FCFS, SJF, SRTF, Round Robin, Priority) of processes with arrival and burst times',
      schema: { required: ['algorithm', 'quantum', 'processes'], properties: { algorithm: { type: 'string', enum: ['FCFS', 'SJF', 'SRTF', 'RR', 'PRIORITY', 'PRIORITY_PREEMPTIVE'] }, quantum: { type: 'number', description: 'the time quantum for round robin (0 for other algorithms)' },
        processes: { type: 'array', items: { type: 'object', required: ['name', 'arrival', 'burst'], properties: { name: { type: 'string' }, arrival: { type: 'number' }, burst: { type: 'number' }, priority: { type: 'number' } } } } } },
      tokens: p => [...(p.processes || []).flatMap(x => [x.burst, +x.arrival ? x.arrival : '', x.priority ?? '']), /^RR$/i.test(p.algorithm) ? p.quantum : ''],
      whatIf: [{ k: 'algorithm', opts: ['FCFS', 'SJF', 'SRTF', 'RR', 'PRIORITY'] }, { k: 'quantum', label: 'time quantum', min: 1, when: p => /^RR$/i.test(p.algorithm) }],
      build(p) {
        const procs = (p.processes || []).map((x, i) => ({ name: String(x.name || `P${i + 1}`).replace(/[$_{}\\]/g, ''), arrival: +x.arrival || 0, burst: +x.burst, priority: x.priority }));
        if (procs.length < 2 || procs.length > 8) throw new Error('needs 2–8 processes');
        const params = { algorithm: p.algorithm, processes: procs, quantum: p.quantum, ask: 'avg_waiting' }, r = Solvers.solve('cpu', params);
        const specs = CalcViz.specs('cpu', params, r), fr = specs.find(x => x.spec.type === 'frames') || specs[0];
        if (!fr) throw new Error('no schedule');
        const avg = r.steps.match(/Average waiting = ([^,]+), average turnaround = ([^,]+)/), tb = CalcViz.table(r.steps), ci = CalcViz.col(tb, /^Completion/);
        const fin = tb && ci >= 0 ? tb.rows.map(row => [row[0], +row[ci]]).sort((a, b) => a[1] - b[1]) : [];
        return { spec: fr.spec, label: `${String(p.algorithm).toUpperCase()}${/^RR$/i.test(p.algorithm) ? ` (quantum ${p.quantum})` : ''} scheduling of ${procs.map(x => x.name).join(', ')}`,
          notice: `${fin.length ? `They finish in the order ${fin.map(f => `${f[0]} (${f[1]})`).join(', ')}. ` : ''}Average waiting time ${avg ? +(+avg[1]).toFixed(2) : r.text}, average turnaround time ${avg ? +(+avg[2]).toFixed(2) : '?'}. Watch who waits in the queue while another runs.`,
          // the main answer first, then every other exact number of the schedule (completion, turnaround, waiting times)
          result: [+r.value, ...(avg ? [+avg[2]] : []), ...((CalcViz.table(r.steps) || { rows: [] }).rows.flatMap(row => row.slice(1).map(Number)).filter(isFinite))] };
      },
    },
    cache_mapping: {
      label: 'Cache mapping', kw: /cache|mapping|direct.mapped|set.associative|fully associative|conflict miss|tag\b/i,
      desc: 'cache mapping (direct, set-associative or fully associative): a sequence of memory block accesses into a cache with a number of lines, hits and misses',
      schema: { required: ['mapping', 'lines', 'accesses'], properties: { mapping: { type: 'string', enum: ['direct', 'set_associative', 'fully_associative'] }, lines: { type: 'integer' }, ways: { type: 'integer' },
        accesses: { type: 'array', items: { type: 'string' }, description: 'block numbers (or block names for fully associative)' }, replacement: { type: 'string', enum: ['LRU', 'FIFO'] } } },
      tokens: p => [p.lines, p.mapping === 'set_associative' ? p.ways : '', ...TopicAnim.blocks(p.accesses)],
      seqs: p => [TopicAnim.blocks(p.accesses)],
      whatIf: [{ k: 'mapping', opts: ['direct', 'set_associative', 'fully_associative'] }, { k: 'lines', min: 1 }, { k: 'ways', min: 1, when: p => p.mapping === 'set_associative' }],
      build(p) {
        const L = +p.lines, acc = TopicAnim.blocks(p.accesses).map(TopicAnim.val), map = p.mapping || 'direct', repl = String(p.replacement || 'LRU').toUpperCase();
        const ways = map === 'direct' ? 1 : map === 'fully_associative' ? L : Math.max(1, +p.ways || 2), sets = Math.max(1, Math.floor(L / ways));
        if (!(L >= 1 && L <= 32) || acc.length < 2 || acc.length > 24) throw new Error('needs 1–32 lines and 2–24 accesses');
        if (sets > 1 && acc.some(a => typeof a !== 'number')) throw new Error('block numbers are needed to find the line');
        const store = Array.from({ length: sets }, () => []), frames = [], captions = [], name = b => typeof b === 'number' ? `B${b}` : String(b);
        const hist = []; let hits = 0;
        const unit = map === 'direct' ? 'Line' : 'Set', rowsShown = () => sets <= 16 ? [...Array(sets).keys()] : [...new Set(acc.slice(0, hist.length).map(b => b % sets))].sort((x, y) => x - y);
        acc.forEach((b, i) => {
          const s = sets > 1 ? b % sets : 0, set = store[s], at = set.findIndex(x => x.b === b);
          let cap;
          if (at >= 0) { hits++; if (repl === 'LRU') set.push(set.splice(at, 1)[0]); cap = `${name(b)}${sets > 1 ? ` → ${unit.toLowerCase()} ${b} mod ${sets} = ${s}` : ''}: hit.`; hist.push('H'); }
          else {
            let ev = null;
            if (set.length >= ways) ev = set.shift();
            set.push({ b });
            cap = `${name(b)}${sets > 1 ? ` → ${unit.toLowerCase()} ${b} mod ${sets} = ${s}` : ''}: miss${ev ? `, evicts ${name(ev.b)} (${map === 'direct' ? 'only one place for it: a conflict miss' : repl === 'LRU' ? 'least recently used' : 'loaded first'})` : ', loaded into a free place'}.`;
            hist.push('M');
          }
          const rows = rowsShown();
          frames.push({ type: 'group', items: [{ type: 'table', head: [unit, ...Array.from({ length: Math.min(ways, 8) }, (_, k) => ways === 1 ? 'Block' : `Way ${k + 1}`)], rows: rows.map(r => [String(r), ...Array.from({ length: Math.min(ways, 8) }, (_, k) => store[r][k] ? name(store[r][k].b) : '')]), hi: [rows.indexOf(s)] },
            { type: 'array', cells: acc.map(name), index: acc.map((_, k) => k < hist.length ? (hist[k] === 'H' ? 'hit' : 'miss') : ''), highlight: [i], done: hist.map((h, k) => h === 'H' ? k : -1).filter(k => k >= 0), title: 'Accesses' }] });
          captions.push(cap);
        });
        return { spec: { type: 'frames', frames, captions }, label: `${map === 'direct' ? 'Direct-mapped' : map === 'fully_associative' ? 'Fully associative' : `${ways}-way set-associative`} cache with ${L} lines`,
          notice: `${hits} hits, ${acc.length - hits} misses. ${map === 'direct' ? 'Blocks with the same (block mod lines) fight for one line.' : 'A block may go in any free way of its set; when full, the ' + (repl === 'LRU' ? 'least recently used' : 'oldest') + ' one leaves.'}`, result: hits };
      },
    },
    paging_translation: {
      label: 'Address translation', kw: /paging|page table|virtual address|logical address|address translation|\btlb\b|page number|offset/i,
      desc: 'paging address translation: a virtual address split into page number and offset, looked up in a page table to get the physical address',
      schema: { required: ['page_size', 'virtual_address', 'page_table'], properties: { page_size: { type: 'integer', description: 'bytes' }, virtual_address: { type: 'string', description: 'decimal or 0x hex' },
        page_table: { type: 'array', items: { type: 'object', required: ['page', 'frame'], properties: { page: { type: 'integer' }, frame: { type: 'integer' } } } } } },
      tokens: p => [p.page_size, p.virtual_address, ...(p.page_table || []).flatMap(e => [e.page, e.frame])],
      build(p) {
        const P = +p.page_size, va = /^0x/i.test(String(p.virtual_address).trim()) ? parseInt(p.virtual_address, 16) : +p.virtual_address;
        if (!(P >= 2) || !Number.isInteger(Math.log2(P)) || !(va >= 0)) throw new Error('needs a power-of-two page size and an address');
        const off = Math.log2(P), vpn = Math.floor(va / P), o = va % P, pt = (p.page_table || []).map(e => ({ page: +e.page, frame: +e.frame }));
        const maxPage = Math.max(vpn, ...pt.map(e => e.page)), vbits = Math.max(1, Math.ceil(Math.log2(maxPage + 1))), fbits = Math.max(1, Math.ceil(Math.log2(Math.max(1, ...pt.map(e => e.frame)) + 1)));
        const bin = (x, n) => x.toString(2).padStart(n, '0'), hit = pt.find(e => e.page === vpn);
        const tableSpec = hi => ({ type: 'table', head: ['Page', 'Frame'], rows: pt.map(e => [e.page, e.frame]), hi: hi ? [pt.indexOf(hit)] : [] });
        const frames = [{ type: 'bits', segments: [['Page number', vbits, bin(vpn, vbits)], ['Offset', off, bin(o, off)]], title: `Virtual address ${va} (page size ${P} = 2^${off}: the low ${off} bits are the offset)` }];
        const captions = [`Split: page = ⌊${va} / ${P}⌋ = ${vpn}, offset = ${va} mod ${P} = ${o}.`];
        frames.push({ type: 'group', items: [frames[0], tableSpec(true)], titles: ['', 'Page table'] });
        captions.push(hit ? `Look up page ${vpn} in the page table: frame ${hit.frame}.` : `Page ${vpn} is not in the page table: a page fault (the OS must load it).`);
        if (hit) {
          const pa = hit.frame * P + o;
          frames.push({ type: 'group', items: [frames[0], tableSpec(true), { type: 'bits', segments: [['Frame number', fbits, bin(hit.frame, fbits)], ['Offset', off, bin(o, off)]], title: `Physical address ${pa}` }] });
          captions.push(`Physical address = frame × page size + offset = ${hit.frame} × ${P} + ${o} = ${pa}. The offset is copied unchanged.`);
          return { spec: { type: 'frames', frames, captions }, label: `Translating virtual address ${va}`, notice: `VA ${va} → page ${vpn}, offset ${o} → frame ${hit.frame} → PA ${pa}. Only the page number is translated.`, result: pa };
        }
        return { spec: { type: 'frames', frames, captions }, label: `Translating virtual address ${va}`, notice: `Page ${vpn} is not mapped: page fault.`, result: 'fault' };
      },
    },
    pipeline: {
      label: 'Pipelining', kw: /pipelin|hazard|stall|speed.?up|stage/i,
      desc: 'an instruction pipeline: instructions moving through stages cycle by cycle, with stall cycles if any',
      schema: { required: ['stages', 'instructions'], properties: { stages: { type: 'array', items: { type: 'string' }, description: 'stage names, e.g. IF ID EX MEM WB' },
        instructions: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, stalls: { type: 'integer', description: 'stall cycles before its execute stage' } } } } } },
      tokens: p => [...(p.stages || []).map(s => String(s).replace(/[$\\{}]/g, '')), ...(p.instructions || []).map(i => +i.stalls ? i.stalls : '')],
      whatIf: [{ k: 'count', label: 'instructions', min: 1, get: p => (p.instructions || []).length, set: (p, v) => ({ ...p, instructions: Array.from({ length: Math.max(1, Math.min(10, v)) }, (_, i) => (p.instructions || [])[i] || { name: `I${i + 1}` }) }) }],
      build(p) {
        const st = (p.stages || []).map(s => String(s).replace(/[$\\{}]/g, '')).filter(Boolean), ins = (p.instructions || []).map((x, i) => ({ name: String(x.name || `I${i + 1}`).replace(/[$\\{}_]/g, ''), stalls: Math.max(0, +x.stalls || 0) }));
        if (st.length < 2 || st.length > 8 || ins.length < 1 || ins.length > 10) throw new Error('needs 2–8 stages and 1–10 instructions');
        let shift = 0;
        const rows = ins.map((x, i) => { const r = [x.name, i + 1 + shift, x.stalls]; shift += x.stalls; return r; });
        const k = st.length, n = ins.length, total = k + n - 1 + shift, frames = [], captions = [];
        for (let c = 1; c <= total; c++) {
          frames.push({ type: 'pipeline', stages: st, rows, upto: c });
          const busy = rows.map(r => { const j = c - r[1]; if (j < 0) return null; const stall = r[2] && j >= 2 && j < 2 + r[2]; const si = j < 2 ? j : stall ? -1 : j - r[2]; return si >= 0 && si < k ? `${r[0]} in ${st[si]}` : stall ? `${r[0]} stalled` : null; }).filter(Boolean);
          captions.push(`Cycle ${c}: ${busy.join(', ')}.`);
        }
        return { spec: { type: 'frames', frames, captions }, label: `${k}-stage pipeline, ${n} instruction${n > 1 ? 's' : ''}`, notice: `${total} cycles = k + n − 1${shift ? ` + ${shift} stall${shift > 1 ? 's' : ''}` : ''} = ${k} + ${n} − 1${shift ? ` + ${shift}` : ''}, against ${n * k} without pipelining. After the first instruction fills the pipe, one finishes every cycle.`, result: total };
      },
    },
    deadlock_rag: {
      label: 'Resource-allocation graph', kw: /deadlock|resource.allocation graph|\brag\b|circular wait|wait.for graph/i,
      desc: 'deadlock: a resource-allocation graph with processes holding and requesting resources (single instances), checked for a cycle',
      schema: { required: ['holds', 'requests'], properties: { holds: { type: 'array', items: { type: 'object', required: ['process', 'resource'], properties: { process: { type: 'string' }, resource: { type: 'string' } } } },
        requests: { type: 'array', items: { type: 'object', required: ['process', 'resource'], properties: { process: { type: 'string' }, resource: { type: 'string' } } } } } },
      tokens: p => [...(p.holds || []), ...(p.requests || [])].flatMap(e => [e.process, e.resource]),
      build(p) {
        const clean = s => String(s).replace(/[$\\{}_]/g, '');
        const E = [...(p.holds || []).map(e => [clean(e.resource), clean(e.process), 'holds']), ...(p.requests || []).map(e => [clean(e.process), clean(e.resource), 'requests'])];
        if (E.length < 2 || E.length > 16) throw new Error('needs 2–16 edges');
        const nodes = [...new Set(E.flatMap(e => [e[0], e[1]]))], frames = [], captions = [];
        E.forEach((e, i) => {
          frames.push({ type: 'graph', nodes, edges: E.slice(0, i + 1).map(x => [x[0], x[1]]), directed: true, highlight: [[e[0], e[1]]] });
          captions.push(e[2] === 'holds' ? `${e[0]} is held by ${e[1]} (edge ${e[0]} → ${e[1]}).` : `${e[0]} requests ${e[1]} (edge ${e[0]} → ${e[1]}).`);
        });
        // a cycle (single-instance resources: a cycle means deadlock)
        const adj = {}; E.forEach(([u, v]) => (adj[u] = adj[u] || []).push(v));
        let cyc = null; const state = {}, stack = [];
        const dfs = u => { state[u] = 1; stack.push(u); for (const v of adj[u] || []) { if (cyc) return; if (state[v] === 1) { cyc = stack.slice(stack.indexOf(v)).concat(v); return; } if (!state[v]) dfs(v); } stack.pop(); state[u] = 2; };
        nodes.forEach(u => { if (!state[u] && !cyc) dfs(u); });
        frames.push({ type: 'graph', nodes, edges: E.map(x => [x[0], x[1]]), directed: true, highlight: cyc ? cyc.slice(1).map((v, i) => [cyc[i], v]) : [], mark: cyc ? cyc.slice(0, -1) : [] });
        captions.push(cyc ? `Cycle ${cyc.join(' → ')}: every process in it waits for the next one. Deadlock.` : 'No cycle: no deadlock.');
        return { spec: { type: 'frames', frames, captions }, label: 'Resource-allocation graph', notice: cyc ? `The cycle ${cyc.join(' → ')} means deadlock (with one instance of each resource).` : 'No cycle, so no deadlock.', result: cyc ? 'deadlock' : 'no deadlock' };
      },
    },
    bankers: {
      label: "Banker's algorithm", kw: /banker|safe state|safe sequence|deadlock avoidance/i,
      desc: "Banker's algorithm safety check: Allocation, Max (or Need) and Available matrices, finding a safe sequence",
      schema: { required: ['allocation', 'available'], properties: { names: { type: 'array', items: { type: 'string' } }, allocation: { type: 'array', items: { type: 'array', items: { type: 'integer' } } }, max: { type: 'array', items: { type: 'array', items: { type: 'integer' } } }, need: { type: 'array', items: { type: 'array', items: { type: 'integer' } } }, available: { type: 'array', items: { type: 'integer' } } } },
      tokens: p => [...(p.allocation || []).flat(), ...(p.available || [])],
      seqs: p => [(p.allocation || []).flat()],
      build(p) {
        const params = { ...p, names: (p.names || []).map(s => String(s).replace(/[$\\{}_]/g, '')), ask: 'safe_sequence' }, r = Solvers.solve('banker', params), sp = CalcViz.specs('banker', params, r)[0];
        if (!sp) throw new Error('no table');
        return { spec: { ...sp.spec, start: undefined }, label: "Banker's algorithm: is the state safe?", notice: /→/.test(r.text) ? `Safe sequence ${r.text}: each process's Need fits in Work when its turn comes.` : 'Unsafe: no process can finish with the available resources.', result: r.text };
      },
    },
    sorting: {
      label: 'Sorting', kw: /sort|bubble|insertion|selection|merge|quick|heap ?sort|partition|pivot/i,
      desc: 'a sorting algorithm (bubble, insertion, selection, merge, quick, heap sort) on an array',
      schema: { required: ['algorithm', 'array'], properties: { algorithm: { type: 'string', enum: ['bubble', 'insertion', 'selection', 'merge', 'quick', 'heap'] }, array: { type: 'array', items: { type: 'number' } } } },
      tokens: p => p.array || [],
      seqs: p => [p.array || []],
      whatIf: [{ k: 'algorithm', opts: ['bubble', 'insertion', 'selection', 'merge', 'quick', 'heap'] }],
      build(p) {
        const out = Viz.expand({ type: 'algo', algorithm: p.algorithm, array: p.array });
        return { spec: out, label: `${p.algorithm[0].toUpperCase() + p.algorithm.slice(1)} sort of [${p.array.join(', ')}]`, notice: `${out.frames.length - 1} steps. ${{ bubble: 'Each pass bubbles the largest remaining element to the end.', insertion: 'The green prefix is always sorted; each key slides left into place.', selection: 'Each pass picks the smallest remaining element.', merge: 'Sorted halves merge into longer sorted runs.', quick: 'Each partition puts one pivot in its final place.', heap: 'The maximum leaves the heap root and goes to the end each round.' }[p.algorithm]}` };
      },
    },
    binary_search: {
      label: 'Binary search', kw: /binary search|bisection|\bmid\b|lo.*hi|sorted array/i,
      desc: 'binary search for a target in a sorted array (lo, mid, hi pointers)',
      schema: { required: ['array', 'target'], properties: { array: { type: 'array', items: { type: 'number' } }, target: { type: 'number' } } },
      tokens: p => [...(p.array || []), p.target],
      seqs: p => [p.array || []],
      whatIf: [{ k: 'target', label: 'target' }],
      build(p) {
        const out = Viz.expand({ type: 'algo', algorithm: 'binary', array: p.array, target: p.target });
        return { spec: out, label: `Binary search for ${p.target}`, notice: `${out.frames.length - 1} comparison${out.frames.length === 2 ? "" : "s"} (never more than ⌈log₂(n + 1)⌉ = ${Math.ceil(Math.log2(p.array.length + 1))} for n = ${p.array.length}). Each step halves the range.` };
      },
    },
    graph_algorithm: {
      label: 'Graph algorithm', kw: /graph|bfs|dfs|breadth|depth.first|dijkstra|shortest path|spanning tree|\bmst\b|prim|kruskal|traversal/i,
      desc: 'a graph algorithm (BFS, DFS, Dijkstra, Prim, Kruskal) on a small graph with its edges (and weights)',
      schema: { required: ['algorithm', 'edges'], properties: { algorithm: { type: 'string', enum: ['bfs', 'dfs', 'dijkstra', 'prim', 'kruskal'] }, directed: { type: 'boolean' }, start: { type: 'string' },
        edges: { type: 'array', items: { type: 'object', required: ['u', 'v'], properties: { u: { type: 'string' }, v: { type: 'string' }, w: { type: 'number' } } } } } },
      tokens: p => (p.edges || []).flatMap(e => [e.u, e.v, ['dijkstra', 'prim', 'kruskal'].includes(p.algorithm) ? e.w : '']),
      whatIf: [{ k: 'algorithm', opts: ['bfs', 'dfs', 'dijkstra', 'prim', 'kruskal'] }, { k: 'start', text: true }],
      build(p) {
        const edges = (p.edges || []).map(e => [String(e.u), String(e.v), e.w == null || e.w === '' ? undefined : +e.w]);
        const out = Viz.expand({ type: 'algo', algorithm: p.algorithm, edges, directed: !!p.directed, start: p.start || undefined, source: p.start || undefined });
        const A = { bfs: 'Breadth-first search', dfs: 'Depth-first search', dijkstra: "Dijkstra's shortest paths", prim: "Prim's MST", kruskal: "Kruskal's MST" }[p.algorithm];
        return { spec: out, label: `${A}${p.start ? ` from ${p.start}` : ''}`, notice: out.captions[out.captions.length - 1], result: out.captions[out.captions.length - 1] };
      },
    },
    stack_queue: {
      label: 'Stack / queue', kw: /\bstack\b|\bqueue\b|push|pop|enqueue|dequeue|lifo|fifo order/i,
      desc: 'stack or queue operations (push/pop, enqueue/dequeue) in order',
      schema: { required: ['kind', 'ops'], properties: { kind: { type: 'string', enum: ['stack', 'queue'] }, ops: { type: 'array', items: { type: 'object', required: ['op'], properties: { op: { type: 'string', enum: ['push', 'pop', 'enqueue', 'dequeue'] }, key: { type: 'string' } } } } } },
      tokens: p => (p.ops || []).map(o => o.key ?? ''),
      build(p) {
        const ops = (p.ops || []).map(o => ({ op: o.op, key: o.key != null && isFinite(o.key) ? +o.key : o.key }));
        if (!ops.length || ops.length > 24) throw new Error('needs 1–24 operations');
        const r = DS.sq(ops, p.kind);
        return { spec: { type: 'frames', frames: r.frames, captions: r.caps }, label: `${p.kind === 'stack' ? 'Stack' : 'Queue'} operations`, notice: `${p.kind === 'stack' ? 'Last in, first out' : 'First in, first out'}: removed in the order ${r.out.join(', ') || '(none)'}.`, result: r.out.join(',') };
      },
    },
    tree_insert: {
      label: 'Tree inserts', kw: /\bbst\b|binary search tree|avl|rotation|heap|b\+? ?tree|insert(ion)? into/i,
      desc: 'inserting keys into a BST, AVL tree, max/min heap or B+ tree, one by one',
      schema: { required: ['structure', 'keys'], properties: { structure: { type: 'string', enum: ['bst', 'avl', 'max_heap', 'min_heap', 'bplus_tree'] }, keys: { type: 'array', items: { type: 'number' } }, order: { type: 'integer', description: 'B+ tree order (max children)' } } },
      tokens: p => [...(p.keys || []), p.structure === 'bplus_tree' ? p.order : ''],
      seqs: p => [p.keys || []],
      whatIf: [{ k: 'structure', opts: ['bst', 'avl', 'max_heap', 'min_heap'] }],
      build(p) {
        const keys = (p.keys || []).map(Number);
        if (keys.length < 2 || keys.length > 16) throw new Error('needs 2–16 keys');
        const ops = keys.map(k => ({ op: 'insert', key: k })), s = p.structure;
        const r = s === 'avl' ? DS.avl(ops) : s === 'max_heap' ? DS.heap(ops, 'max') : s === 'min_heap' ? DS.heap(ops, 'min') : s === 'bplus_tree' ? DS.bplus(keys, Math.max(3, +p.order || 3)) : DS.bst(ops);
        const name = { bst: 'BST', avl: 'AVL tree', max_heap: 'Max-heap', min_heap: 'Min-heap', bplus_tree: `B+ tree (order ${Math.max(3, +p.order || 3)})` }[s];
        return { spec: { type: 'frames', frames: r.frames, captions: r.caps }, label: `Inserting ${keys.join(', ')} into ${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`, notice: s === 'avl' ? 'Watch the rotations keep every node balanced (heights differ by at most 1).' : s.includes('heap') ? 'Each new key bubbles up until its parent is ' + (s === 'max_heap' ? 'larger.' : 'smaller.') : s === 'bplus_tree' ? `${r.splits} split${r.splits === 1 ? '' : 's'}; height ${r.height}.` : 'Smaller keys go left, larger go right; the shape depends on the insertion order.' };
      },
    },
    hashing: {
      label: 'Hashing', kw: /hash|probing|collision|open addressing|chaining/i,
      desc: 'hashing keys into a table with linear / quadratic probing or double hashing',
      schema: { required: ['table_size', 'keys', 'method'], properties: { table_size: { type: 'integer' }, keys: { type: 'array', items: { type: 'integer' } }, method: { type: 'string', enum: ['linear', 'quadratic', 'double'] }, r: { type: 'integer', description: 'double hashing: h2(k) = r − (k mod r)' } } },
      tokens: p => [p.table_size, ...(p.keys || [])],
      seqs: p => [p.keys || []],
      whatIf: [{ k: 'table_size', label: 'table size', min: 1 }, { k: 'method', opts: ['linear', 'quadratic', 'double'] }],
      build(p) {
        const params = { ...p, ask: 'total_probes' }, r = Solvers.solve('hash', params), sp = CalcViz.specs('hash', params, r)[0];
        if (!sp) throw new Error('no table');
        return { spec: { ...sp.spec, start: undefined }, label: `${p.method} probing, table of ${p.table_size}`, notice: `${r.value} probes in total. A collision sends the key to the next slot in the probe sequence.`, result: r.value };
      },
    },
    dfa_run: {
      label: 'DFA on an input', kw: /\bdfa\b|\bnfa\b|automat|finite state|accept|regular language|transition/i,
      desc: 'a DFA running on an input string, state by state',
      schema: { required: ['states', 'start', 'finals', 'transitions', 'input'], properties: { states: { type: 'array', items: { type: 'string' } }, start: { type: 'string' }, finals: { type: 'array', items: { type: 'string' } },
        transitions: { type: 'array', items: { type: 'object', required: ['from', 'symbol', 'to'], properties: { from: { type: 'string' }, symbol: { type: 'string' }, to: { type: 'string' } } } }, input: { type: 'string' } } },
      tokens: p => [...(p.states || []), p.input],
      whatIf: [{ k: 'input', text: true }],
      build(p) {
        const clean = s => String(s).replace(/[$\\{}]/g, '').replace(/_/g, '');
        const tr = (p.transitions || []).map(t => [clean(t.from), String(t.symbol), clean(t.to)]), finals = (p.finals || []).map(clean), start = clean(p.start), input = String(p.input || '').replace(/\s/g, '');
        if (!tr.length || input.length > 20) throw new Error('needs transitions and an input of at most 20 symbols');
        const base = { type: 'dfa', states: (p.states || []).map(clean), start, finals, transitions: tr }, frames = [], captions = [];
        const tape = k => ({ type: 'array', cells: input.split(''), highlight: k >= 0 && k < input.length ? [k] : [], done: [...Array(Math.max(0, k)).keys()], title: 'Input' });
        let q = start;
        frames.push({ type: 'group', items: [{ ...base, current: q }, tape(0)] }); captions.push(`Start in ${q}.`);
        for (let i = 0; i < input.length; i++) {
          const t = tr.find(x => x[0] === q && x[1] === input[i]);
          if (!t) { frames.push({ type: 'group', items: [{ ...base, current: q }, tape(i)] }); captions.push(`No move from ${q} on ${input[i]}: the input is rejected.`); q = null; break; }
          frames.push({ type: 'group', items: [{ ...base, current: t[2], edge: [t[0], t[2]] }, tape(i + 1)] });
          captions.push(`Read ${input[i]}: ${t[0]} → ${t[2]}.`); q = t[2];
        }
        const ok = q != null && finals.includes(q);
        captions[captions.length - 1] += q != null ? ` End of input in ${q}: ${ok ? 'accepting, so the string is accepted' : 'not accepting, so the string is rejected'}.` : '';
        return { spec: { type: 'frames', frames, captions }, label: `The DFA reading "${input}"`, notice: `"${input}" ${ok ? 'is accepted' : 'is rejected'}${q ? ` (it ends in ${q})` : ''}. Only the state at the end matters.`, result: ok ? 'accepted' : 'rejected' };
      },
    },
    tcp_handshake: {
      label: 'TCP three-way handshake', kw: /handshake|syn|three.way|connection establishment|tcp connection/i,
      desc: 'TCP three-way handshake with the client and server initial sequence numbers',
      schema: { required: ['client_isn', 'server_isn'], properties: { client_isn: { type: 'integer' }, server_isn: { type: 'integer' } } },
      tokens: p => [p.client_isn, p.server_isn],
      build(p) {
        const x = +p.client_isn, y = +p.server_isn;
        const msgs = [['Client', 'Server', `SYN, seq = ${x}`], ['Server', 'Client', `SYN+ACK, seq = ${y}, ack = ${x + 1}`], ['Client', 'Server', `ACK, seq = ${x + 1}, ack = ${y + 1}`]];
        const states = [['SYN-SENT', 'SYN-RCVD'], ['', ''], ['ESTABLISHED', 'ESTABLISHED']];
        const caps = [`The client picks ISN ${x} and sends SYN (it uses up one sequence number).`, `The server answers SYN+ACK with its own ISN ${y}, acknowledging ${x + 1}.`, `The client acknowledges ${y + 1}. Both sides are ESTABLISHED; data starts at ${x + 1}.`];
        return { spec: { type: 'frames', frames: msgs.map((_, i) => ({ type: 'seq', actors: ['Client', 'Server'], messages: msgs, states, upto: i + 1 })), captions: caps }, label: 'TCP three-way handshake', notice: `SYN and SYN+ACK each consume one sequence number: ack = ISN + 1 (${x + 1} and ${y + 1}).`, result: `${x + 1},${y + 1}` };
      },
    },
    sliding_window: {
      label: 'Sliding window', kw: /sliding window|go.back.n|selective repeat|\bgbn\b|stop.and.wait|window size/i,
      desc: 'Go-Back-N or Selective Repeat with a window size, a number of frames and one lost frame',
      schema: { required: ['protocol', 'window', 'frames'], properties: { protocol: { type: 'string', enum: ['go_back_n', 'selective_repeat'] }, window: { type: 'integer' }, frames: { type: 'integer' }, lost_frame: { type: 'integer', description: 'number of the frame that is lost once (optional)' } } },
      tokens: p => [p.window, p.frames, p.lost_frame ?? ''],
      whatIf: [{ k: 'window', min: 1 }, { k: 'lost_frame', label: 'lost frame' }],
      build(p) {
        const W = +p.window, N = +p.frames, lost = p.lost_frame != null && p.lost_frame !== '' ? +p.lost_frame : -1, gbn = p.protocol !== 'selective_repeat';
        if (!(W >= 1 && W <= 8 && N >= 1 && N <= 12)) throw new Error('needs a window of 1–8 and 1–12 frames');
        // Rounds: the sender sends what its window allows; a lost frame times out and is re-sent in the next round
        // (Go-Back-N: it and everything after it, which the receiver discarded; Selective Repeat: only it).
        const msgs = [], caps = [], sentOnce = new Set();
        let lostOnce = false, guard = 0;
        if (gbn) {
          let expected = 0, next = 0;
          while (expected < N && guard++ < 20) {
            const end = Math.min(expected + W, N);
            for (let f = next; f < end; f++) {
              const again = sentOnce.has(f), l = f === lost && !lostOnce; sentOnce.add(f);
              msgs.push(['Sender', 'Receiver', `Frame ${f}${again ? ' (again)' : ''}`, l]); caps.push(l ? `Frame ${f} is lost.` : `${again ? 'Timeout: re-send' : 'Send'} frame ${f}.`);
              if (l) { lostOnce = true; continue; }
              if (f === expected) { expected++; msgs.push(['Receiver', 'Sender', `ACK ${expected}`]); caps.push(`Frame ${f} is the one expected: accept it, ACK ${expected} (the next frame it wants).`); }
              else { msgs.push(['Receiver', 'Sender', `discard, ACK ${expected}`]); caps.push(`Frame ${f} is out of order: Go-Back-N discards it and repeats ACK ${expected}.`); }
            }
            next = expected < end ? expected : end;
          }
        } else {
          const acked = new Set(), resend = new Set(); let base = 0;
          while (acked.size < N && guard++ < 20) {
            const end = Math.min(base + W, N), send = [];
            for (let f = base; f < end; f++) if (!acked.has(f) && (!sentOnce.has(f) || resend.has(f))) send.push(f);
            resend.clear();
            if (!send.length) break;
            for (const f of send) {
              const again = sentOnce.has(f), l = f === lost && !lostOnce; sentOnce.add(f);
              msgs.push(['Sender', 'Receiver', `Frame ${f}${again ? ' (again)' : ''}`, l]); caps.push(l ? `Frame ${f} is lost.` : `${again ? 'Timeout: re-send only' : 'Send'} frame ${f}.`);
              if (l) { lostOnce = true; resend.add(f); continue; }
              const out = [...Array(f).keys()].some(k => !acked.has(k)); acked.add(f);
              msgs.push(['Receiver', 'Sender', `ACK ${f}`]); caps.push(out ? `Frame ${f} arrives out of order: Selective Repeat buffers it and ACKs ${f}.` : `Frame ${f} accepted: ACK ${f}.`);
            }
            while (acked.has(base)) base++;
          }
        }
        if (msgs.length > 44) throw new Error('too many messages');
        const frames = msgs.map((_, i) => ({ type: 'seq', actors: ['Sender', 'Receiver'], messages: msgs, upto: i + 1 }));
        const resent = msgs.filter(m => m[0] === 'Sender').length - N;
        return { spec: { type: 'frames', frames, captions: caps }, label: `${gbn ? 'Go-Back-N' : 'Selective Repeat'}, window ${W}, ${N} frames`, notice: `${msgs.filter(m => m[0] === 'Sender').length} frames sent for ${N}${resent ? ` (${resent} re-sent)` : ''}. ${gbn ? 'After a loss, Go-Back-N re-sends the lost frame and every frame after it.' : 'Selective Repeat re-sends only the lost frame.'}`, result: resent };
      },
    },
    subnetting: {
      label: 'Subnetting', kw: /subnet|cidr|ip address|netmask|broadcast address|network address|ipv4/i,
      desc: 'IPv4 subnetting of one address with its prefix length',
      schema: { required: ['ip', 'prefix'], properties: { ip: { type: 'string', description: 'e.g. 192.168.10.77' }, prefix: { type: 'integer' } } },
      tokens: p => [String(p.ip).split('/')[0], p.prefix],
      whatIf: [{ k: 'prefix', label: 'prefix /', min: 1 }],
      build(p) {
        const params = { ip: String(p.ip).split('/')[0], prefix: +p.prefix, ask: 'network' }, r = Solvers.solve('ip', params), specs = CalcViz.specs('ip', params, r);
        if (specs.length < 2) throw new Error('no drawing');
        const g = k => (r.steps.match(new RegExp(k + '[^*]*\\*\\*([\\d.]+)\\*\\*')) || [])[1];
        return { spec: { type: 'frames', frames: specs.map(s => s.spec), captions: [specs[0].title + '.', `${specs[1].title}: network ${g('Network address')}, broadcast ${g('Broadcast')}.`] }, label: `Subnet of ${params.ip}/${params.prefix}`, notice: `Network ${g('Network address')}, broadcast ${g('Broadcast')}, ${2 ** (32 - params.prefix) - 2 > 0 ? 2 ** (32 - params.prefix) - 2 : 0} usable hosts: the host bits all 0 / all 1.`, result: g('Network address') };
      },
    },
    recursion: {
      label: 'Recursion', kw: /recurs|call stack|factorial|fibonacci|stack frame|activation record/i,
      desc: 'a recursion trace (factorial or Fibonacci) showing the call stack, calls and returns',
      schema: { required: ['function', 'n'], properties: { function: { type: 'string', enum: ['factorial', 'fibonacci'] }, n: { type: 'integer' } } },
      tokens: p => [p.n],
      whatIf: [{ k: 'n', min: 0 }],
      build(p) {
        const n = +p.n, fib = p.function === 'fibonacci';
        if (!(n >= 0) || n > (fib ? 6 : 9)) throw new Error('n too large to animate');
        const frames = [], captions = [], stack = [], f = fib ? 'fib' : 'fact';
        let root = null, calls = 0;
        const snap = cap => { frames.push(fib ? { type: 'group', dir: 'row', items: [{ type: 'stack', items: stack.map(x => x.label) }, { type: 'tree', root: JSON.parse(JSON.stringify(root)) }], titles: ['Call stack', 'Calls so far'] } : { type: 'stack', items: stack.map(x => x.label) }); captions.push(cap); };
        const call = (k, node) => {
          calls++;
          const fr = { label: `${f}(${k})` }; stack.push(fr);
          if (node) node.v = `${f}(${k})`;
          snap(`Call ${f}(${k}).`);
          let v;
          if (fib) {
            if (k <= 1) v = k;
            else { node.c = [{ v: '', c: [] }, null]; const a = call(k - 1, node.c[0]); node.c[1] = { v: '', c: [] }; const b = call(k - 2, node.c[1]); v = a + b; }
          } else v = k <= 1 ? 1 : k * call(k - 1, null);
          stack.pop(); if (node) node.v = `${f}(${k}) = ${v}`;
          snap(fib ? `${f}(${k}) returns ${v}${k > 1 ? ` (= ${f}(${k - 1}) + ${f}(${k - 2}))` : ''}.` : `${f}(${k}) returns ${v}${k > 1 ? ` = ${k} × ${f}(${k - 1})` : ''}.`);
          return v;
        };
        if (fib) root = { v: '', c: [] };
        const v = call(n, root);
        return { spec: { type: 'frames', frames, captions }, label: `${fib ? 'Fibonacci' : 'Factorial'} recursion for n = ${n}`, notice: fib ? `${calls} calls for fib(${n}) = ${v}: the same values are recomputed again and again (that is what memoization saves).` : `${n}! = ${v}: the stack grows to ${Math.max(1, n)} frames, then unwinds, multiplying on the way back.`, result: v };
      },
    },
    ll1_parse: {
      label: 'LL(1) parsing', kw: /ll\s*\(?1\)?|predictive pars|top.down pars|parsing table|first\s*(and|&)?\s*follow|recursive descent/i,
      desc: 'an LL(1) table-driven parse of an input string with a grammar (stack, input and action per step)',
      schema: { required: ['grammar'], properties: { grammar: { type: 'string', description: 'productions like "S -> a A | b B ; A -> c ; B -> d" (ε for empty)' }, input: { type: 'string', description: 'a string to parse from the lesson; empty if none' } } },
      tokens: p => TopicAnim.grammarTokens(p.grammar),
      whatIf: [{ k: 'input', text: true }],
      build(p) { return TopicAnim.parseLL1(p); },
    },
    lr_parse: {
      label: 'Shift-reduce parsing', kw: /\blr\s*\(?[01k]?\)?|slr|lalr|bottom.up|shift.reduce|handle|canonical (lr|collection)|items?\b/i,
      desc: 'a bottom-up (SLR) shift-reduce parse of an input string with a grammar',
      schema: { required: ['grammar'], properties: { grammar: { type: 'string', description: 'productions like "E -> E + T | T ; T -> id"' }, input: { type: 'string', description: 'a string to parse from the lesson; empty if none' } } },
      tokens: p => TopicAnim.grammarTokens(p.grammar),
      whatIf: [{ k: 'input', text: true }],
      build(p) { return TopicAnim.parseSLR(p); },
    },
    dp_table: {
      label: 'Dynamic programming table', kw: /dynamic programming|\bdp\b|memoi|tabulation|knapsack|longest common subsequence|\blcs\b|climbing stairs|fibonacci|optimal substructure/i,
      desc: 'a dynamic-programming table filled step by step: climbing stairs / Fibonacci (n), longest common subsequence (two strings) or 0/1 knapsack (weights, values, capacity)',
      schema: { required: ['problem'], properties: { problem: { type: 'string', enum: ['climbing_stairs', 'fibonacci', 'lcs', 'knapsack'] }, n: { type: 'integer' }, a: { type: 'string' }, b: { type: 'string' },
        weights: { type: 'array', items: { type: 'integer' } }, values: { type: 'array', items: { type: 'integer' } }, capacity: { type: 'integer' } } },
      tokens: p => p.problem === 'lcs' ? [p.a, p.b] : p.problem === 'knapsack' ? [...(p.weights || []), ...(p.values || []), p.capacity] : [p.n],
      whatIf: [{ k: 'n', min: 1, when: p => /stairs|fib/.test(p.problem) }],
      build(p) { return TopicAnim.dp(p); },
    },
    disk_scheduling: {
      label: 'Disk scheduling', kw: /disk schedul|head movement|seek|sstf|c-?scan|c-?look|cylinder/i,
      desc: 'disk scheduling (FCFS, SSTF, SCAN, C-SCAN, LOOK, C-LOOK): head position and request queue',
      schema: { required: ['algorithm', 'head', 'requests'], properties: { algorithm: { type: 'string', enum: ['FCFS', 'SSTF', 'SCAN', 'CSCAN', 'LOOK', 'CLOOK'] }, head: { type: 'integer' }, requests: { type: 'array', items: { type: 'integer' } }, direction: { type: 'string', enum: ['up', 'down'] }, max_cylinder: { type: 'integer' } } },
      tokens: p => [p.head, ...(p.requests || [])],
      seqs: p => [p.requests || []],
      whatIf: [{ k: 'algorithm', opts: ['FCFS', 'SSTF', 'SCAN', 'CSCAN', 'LOOK', 'CLOOK'] }],
      build(p) {
        const params = { ...p, ask: 'total_movement' }, r = Solvers.solve('disk', params), sp = CalcViz.specs('disk', params, r)[0];
        if (!sp) throw new Error('no path');
        const path = sp.spec.path, frames = [], captions = [];
        for (let i = 1; i < path.length; i++) { frames.push({ ...sp.spec, path: path.slice(0, i + 1), jumps: (sp.spec.jumps || []).filter(j => j < i) }); captions.push(`${path[i - 1]} → ${path[i]}: ${Math.abs(path[i] - path[i - 1])} cylinders.`); }
        return { spec: { type: 'frames', frames, captions }, label: `${String(p.algorithm).toUpperCase()} disk scheduling from cylinder ${p.head}`, notice: `Total head movement ${r.value} cylinders.`, result: r.value };
      },
    },
  },

  // ---------- grammars: LL(1) and SLR(1) parses, computed here ----------
  // Read like solvers.js parseGrammar (same shape, so its firstFollow works on it), except that only ε, eps, epsilon,
  // λ or an empty alternative mean "empty": a lone E or e is a symbol (S -> E is a real production).
  grammar(text) {
    const lines = String(text || '').replace(/\\+n/g, '\n').replace(/→|::=|=>|\\to\b|\\rightarrow\b/g, '->').replace(/\$/g, '').split(/\n|;/).map(s => s.trim()).filter(s => s.includes('->'));
    const prods = [], nts = [];
    const spaced = lines.some(l => l.split('->')[1].split('|').some(a => /\S\s+\S/.test(a.trim())));
    for (const line of lines) {
      const [lhs, rhs] = line.split('->'), A = lhs.trim().replace(/\\/g, '');
      if (!nts.includes(A)) nts.push(A);
      for (const alt of rhs.split('|')) {
        const a = alt.trim().replace(/\\epsilon|\\varepsilon/g, 'ε');
        let syms;
        if (!a || /^(ε|eps|epsilon|λ|''|"")$/.test(a)) syms = [];
        else if (spaced || /\s/.test(a)) syms = a.split(/\s+/).filter(s => !/^(ε|eps|epsilon|λ)$/.test(s));
        else syms = a.match(/[A-Z]'*|./g).filter(s => s !== 'ε');
        prods.push({ A, syms });
      }
    }
    if (!prods.length) throw new Error('no productions');
    const isNT = s => nts.includes(s);
    return { prods, nts, terms: [...new Set(prods.flatMap(p => p.syms).filter(s => !isNT(s)))], start: nts[0], isNT };
  },
  grammarTokens(gs) {
    try { return this.grammar(gs).terms; } catch { return ['(bad grammar)']; }
  },
  // A short sentence of the grammar (when the lesson gives none): the shortest string each non-terminal derives.
  sample(g) {
    const best = {}; let ch = true, guard = 0;
    while (ch && guard++ < 50) {
      ch = false;
      for (const pr of g.prods) {
        if (pr.syms.some(s => g.isNT(s) && !best[s])) continue;
        const w = pr.syms.flatMap(s => g.isNT(s) ? best[s] : [s]);
        if (!best[pr.A] || w.length < best[pr.A].length) { best[pr.A] = w; ch = true; }
      }
    }
    // Prefer a sentence of 3 to 7 symbols (it shows more of the grammar): breadth-first over leftmost derivations.
    const q = [[g.start]], seen = new Set();
    for (let n = 0; n < q.length && n < 3000; n++) {
      const f = q[n], k = f.findIndex(s => g.isNT(s));
      if (k < 0) { if (f.length >= 3) return f; continue; }
      for (const pr of g.prods.filter(p => p.A === f[k])) {
        const nf = [...f.slice(0, k), ...pr.syms, ...f.slice(k + 1)], key = nf.join(' ');
        if (nf.filter(s => !g.isNT(s)).length <= 7 && nf.length <= 10 && !seen.has(key)) { seen.add(key); q.push(nf); }
      }
    }
    return best[g.start] || [];
  },
  tokensOf(g, input, spaced) {
    const s = String(input || '').trim();
    if (!s) return this.sample(g);
    // an "input" that is not a string of the grammar's terminals (a model's slip) is replaced by a sentence of the grammar
    if (/\s/.test(s)) { const t = s.split(/\s+/).filter(x => x && x !== '$'); return t.every(x => g.terms.includes(x)) ? t : this.sample(g); }
    // no spaces: longest terminal first (so "id" stays one token)
    const ts = g.terms.slice().sort((a, b) => b.length - a.length), out = [];
    let i = 0;
    while (i < s.length) { if (s[i] === '$') { i++; continue; } const t = ts.find(x => s.startsWith(x, i)); if (!t) return this.sample(g); out.push(t); i += t.length; }
    return out;
  },
  parseLL1(p) {
    const g = this.grammar(p.grammar), { follow, firstOf } = firstFollow(g), M = {};
    let conflict = null;
    g.prods.forEach((pr, i) => {
      const f = firstOf(pr.syms), cells = [...f].filter(x => x !== 'ε').concat(f.has('ε') ? [...follow[pr.A]] : []);
      for (const a of cells) { const k = pr.A + '|' + a; if (M[k] != null && M[k] !== i) conflict = conflict || `M[${pr.A}, ${a}]`; else M[k] = i; }
    });
    if (conflict) throw new Error(`not LL(1): two productions in ${conflict}`);
    const toks = this.tokensOf(g, p.input).concat('$'), stack = ['$', g.start], rows = [], frames = [], captions = [];
    const prodStr = i => `${g.prods[i].A} → ${g.prods[i].syms.join(' ') || 'ε'}`;
    const terms = [...g.terms.filter(t => t !== 'ε'), '$'];
    const tableSpec = cell => ({ type: 'table', head: ['', ...terms], rows: g.nts.map(A => [A, ...terms.map(a => M[A + '|' + a] != null ? prodStr(M[A + '|' + a]) : '')]), hiCells: cell ? [cell] : [] });
    let i = 0, ok = false, guard = 0;
    while (guard++ < 60) {
      const X = stack[stack.length - 1], a = toks[i], st = stack.slice().reverse().join(' '), inp = toks.slice(i).join(' ');
      let act, cell = null;
      if (X === '$' && a === '$') { act = 'accept'; ok = true; }
      else if (!g.isNT(X)) { if (X === a) { act = `match ${a}`; stack.pop(); i++; } else { act = `error: expected ${X}`; } }
      else { const k = M[X + '|' + a]; if (k == null) act = `error: M[${X}, ${a}] is empty`; else { act = prodStr(k); cell = [g.nts.indexOf(X), terms.indexOf(a) + 1]; stack.pop(); stack.push(...g.prods[k].syms.slice().reverse()); } }
      rows.push([st, inp, act]);
      frames.push({ type: 'group', items: [{ type: 'table', head: ['Stack (top first)', 'Input', 'Action'], rows: rows.slice(), hi: [rows.length - 1] }, tableSpec(cell)], titles: ['Parse', 'LL(1) table'] });
      captions.push(act === 'accept' ? 'Stack and input both end in $: accept.' : /^match/.test(act) ? `Top of stack ${a} matches the input: pop it and move on.` : /^error/.test(act) ? `Error: ${act.slice(7)}.` : `${X} on top, next input ${a}: use ${act} (from the table) and push its right side.`);
      if (act === 'accept' || /^error/.test(act)) break;
    }
    return { spec: { type: 'frames', frames, captions }, input: toks.slice(0, -1).join(' '), label: `LL(1) parse of "${toks.slice(0, -1).join(' ')}"`, notice: `${ok ? 'Accepted' : 'Rejected'} in ${rows.length} steps. One look at the next input symbol always picks the production: that is what LL(1) means.`, result: ok ? 'accept' : 'reject' };
  },
  parseSLR(p) {
    const g = this.grammar(p.grammar), { follow } = firstFollow(g);
    const aug = [{ A: g.start + "'", syms: [g.start] }].concat(g.prods);
    const key = I => I.map(([a, d]) => a + '.' + d).sort().join(' ');
    const closure = I => { const out = I.slice(), seen = new Set(out.map(([a, d]) => a + '.' + d)); for (let k = 0; k < out.length; k++) { const B = aug[out[k][0]].syms[out[k][1]]; if (B && g.isNT(B)) aug.forEach((pr, j) => { if (pr.A === B && !seen.has(j + '.0')) { seen.add(j + '.0'); out.push([j, 0]); } }); } return out; };
    const states = [closure([[0, 0]])], keys = [key(states[0])], go = {};
    for (let s = 0; s < states.length && s < 60; s++) for (const X of [...new Set(states[s].map(([a, d]) => aug[a].syms[d]).filter(Boolean))]) {
      const J = closure(states[s].filter(([a, d]) => aug[a].syms[d] === X).map(([a, d]) => [a, d + 1])), k = key(J);
      let t = keys.indexOf(k); if (t < 0) { states.push(J); keys.push(k); t = states.length - 1; }
      go[s + '|' + X] = t;
    }
    const act = {};
    let conflict = null;
    states.forEach((I, s) => {
      for (const [a, d] of I) {
        const X = aug[a].syms[d];
        if (X && !g.isNT(X)) { const k = s + '|' + X, v = 's' + go[k]; if (act[k] && act[k] !== v) conflict = conflict || `I${s} on ${X}`; act[k] = v; }
        if (!X) { if (a === 0) act[s + '|$'] = 'acc'; else for (const t of follow[aug[a].A]) { const k = s + '|' + t, v = 'r' + a; if (act[k] && act[k] !== v) conflict = conflict || `I${s} on ${t}`; act[k] = v; } }
      }
    });
    if (conflict) throw new Error(`not SLR(1): conflict in ${conflict}`);
    const toks = this.tokensOf(g, p.input).concat('$'), st = [0], sy = [], rows = [], frames = [], captions = [];
    const prodStr = a => `${aug[a].A} → ${aug[a].syms.join(' ') || 'ε'}`;
    let i = 0, ok = false, guard = 0;
    while (guard++ < 80) {
      const s = st[st.length - 1], a = toks[i], A = act[s + '|' + a], stackStr = st.map((x, k) => (k ? sy[k - 1] + ' ' : '') + x).join(' ');
      let what, cap;
      if (!A) { what = `error (no action in I${s} on ${a})`; cap = `No action for state ${s} on ${a}: reject.`; }
      else if (A === 'acc') { what = 'accept'; ok = true; cap = 'Accept: the whole input reduced to the start symbol.'; }
      else if (A[0] === 's') { const t = +A.slice(1); what = `shift ${a}, go to ${t}`; cap = `State ${s} on ${a}: shift it and go to state ${t}.`; st.push(t); sy.push(a); i++; }
      else {
        const pr = +A.slice(1), n = aug[pr].syms.length;
        st.splice(st.length - n, n); sy.splice(sy.length - n, n);
        const t = go[st[st.length - 1] + '|' + aug[pr].A]; st.push(t); sy.push(aug[pr].A);
        what = `reduce ${prodStr(pr)}`; cap = `The handle ${aug[pr].syms.join(' ') || 'ε'} is on top and ${a} is in FOLLOW(${aug[pr].A}): reduce by ${prodStr(pr)}, then go to state ${t}.`;
      }
      rows.push([stackStr, toks.slice(i - (what.startsWith('shift') ? 1 : 0)).join(' '), what]);
      frames.push({ type: 'table', head: ['Stack (states and symbols)', 'Input', 'Action'], rows: rows.slice(), hi: [rows.length - 1] });
      captions.push(cap);
      if (what === 'accept' || what.startsWith('error')) break;
    }
    return { spec: { type: 'frames', frames, captions }, input: toks.slice(0, -1).join(' '), label: `SLR(1) shift-reduce parse of "${toks.slice(0, -1).join(' ')}"`, notice: `${ok ? 'Accepted' : 'Rejected'}: ${TopicAnim.plural(rows.filter(r => r[2].startsWith('shift')).length, 'shift')}, ${TopicAnim.plural(rows.filter(r => r[2].startsWith('reduce')).length, 'reduction')}, using ${states.length} LR(0) states. A reduction happens only when the next input is in FOLLOW of the left side.`, result: ok ? 'accept' : 'reject' };
  },
  // ---------- dynamic programming tables ----------
  dp(p) {
    const frames = [], captions = [];
    if (p.problem === 'climbing_stairs' || p.problem === 'fibonacci') {
      const n = +p.n, st = p.problem === 'climbing_stairs';
      if (!(n >= 1 && n <= 20)) throw new Error('n from 1 to 20');
      const d = st ? [1, 1] : [0, 1], name = st ? 'ways' : 'F';
      // column 0 holds the row name, so value i sits in column i + 1
      const row = (upto, k) => ({ type: 'table', head: ['i', ...[...Array(n + 1).keys()].map(String)], rows: [[name, ...[...Array(n + 1).keys()].map(i => i <= upto ? String(d[i]) : '')]], hiCells: k ? [[0, k + 1]] : [], depCells: k ? [[0, k], [0, k - 1]] : [] });
      frames.push(row(1, 0)); captions.push(`Base cases: ${name}(0) = ${d[0]}, ${name}(1) = ${d[1]}.`);
      for (let k = 2; k <= n; k++) { d[k] = d[k - 1] + d[k - 2]; frames.push(row(k, k)); captions.push(`${name}(${k}) = ${name}(${k - 1}) + ${name}(${k - 2}) = ${d[k - 1]} + ${d[k - 2]} = ${d[k]}.`); }
      return { spec: { type: 'frames', frames, captions }, label: `${st ? 'Climbing stairs' : 'Fibonacci'} table for n = ${n}`, notice: `${name}(${n}) = ${d[n]}. Each cell is filled once from the two before it (amber), so the work is O(n) instead of exponential.`, result: d[n] };
    }
    if (p.problem === 'lcs') {
      const A = String(p.a || '').replace(/["\s]/g, ''), B = String(p.b || '').replace(/["\s]/g, '');
      if (!A || !B || A.length > 9 || B.length > 9) throw new Error('two strings of 1–9 characters');
      const L = Array.from({ length: A.length + 1 }, () => Array(B.length + 1).fill(0));
      const tab = (ci, cj, dep) => ({ type: 'table', head: ['', 'ε', ...B.split('')], rows: L.map((r, i) => [i ? A[i - 1] : 'ε', ...r.map((v, j) => (i < ci || (i === ci && j <= cj) || i === 0 || j === 0) ? String(v) : '')]), hiCells: ci ? [[ci, cj + 1]] : [], depCells: dep || [] });
      frames.push(tab(0, 0)); captions.push('Row and column 0 are 0 (an empty string has no common subsequence).');
      for (let i = 1; i <= A.length; i++) for (let j = 1; j <= B.length; j++) {
        const m = A[i - 1] === B[j - 1];
        L[i][j] = m ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
        frames.push(tab(i, j, m ? [[i - 1, j]] : [[i - 1, j + 1], [i, j]]));
        captions.push(m ? `${A[i - 1]} = ${B[j - 1]}: diagonal + 1 = ${L[i][j]}.` : `${A[i - 1]} ≠ ${B[j - 1]}: max(up ${L[i - 1][j]}, left ${L[i][j - 1]}) = ${L[i][j]}.`);
      }
      return { spec: { type: 'frames', frames, captions }, label: `LCS of "${A}" and "${B}"`, notice: `LCS length = ${L[A.length][B.length]} (bottom-right cell). Matching characters step diagonally; otherwise take the larger of up and left.`, result: L[A.length][B.length] };
    }
    if (p.problem === 'knapsack') {
      const w = (p.weights || []).map(Number), v = (p.values || []).map(Number), W = +p.capacity;
      if (!w.length || w.length !== v.length || w.length > 6 || !(W >= 1 && W <= 15)) throw new Error('up to 6 items and capacity up to 15');
      const K = Array.from({ length: w.length + 1 }, () => Array(W + 1).fill(0));
      const tab = (ri, dep) => ({ type: 'table', head: ['item (w, v)', ...[...Array(W + 1).keys()].map(String)], rows: K.map((r, i) => [i ? `${i} (${w[i - 1]}, ${v[i - 1]})` : 'none', ...r.map(x => i <= ri ? String(x) : '')]), hi: ri ? [ri] : [], depCells: dep || [] });
      frames.push(tab(0)); captions.push('Row 0: no items, value 0 for every capacity.');
      for (let i = 1; i <= w.length; i++) {
        for (let c = 0; c <= W; c++) K[i][c] = Math.max(K[i - 1][c], c >= w[i - 1] ? v[i - 1] + K[i - 1][c - w[i - 1]] : -Infinity);
        frames.push(tab(i)); captions.push(`Item ${i} (weight ${w[i - 1]}, value ${v[i - 1]}): each cell = max(skip it: the cell above, take it: ${v[i - 1]} + the cell above ${w[i - 1]} columns to the left).`);
      }
      return { spec: { type: 'frames', frames, captions }, label: `0/1 knapsack, capacity ${W}`, notice: `Best value ${K[w.length][W]} (bottom-right). Each row adds one item; each cell decides "take it or skip it".`, result: K[w.length][W] };
    }
    throw new Error('unknown DP problem');
  },

  // ---------- building and checking ----------
  build(anim) {
    if (!anim) return null;
    if (anim.template === 'lesson_viz') {
      const spec = anim.spec, out = spec.type === 'algo' ? Viz.expand(spec) : spec;
      Viz.render(out);
      return { spec: out, label: anim.label || 'The lesson\'s drawing', notice: anim.notice || '' };
    }
    const t = this.T[anim.template];
    if (!t) return null;
    const b = t.build.call(t, anim.params);
    // the drawing engine must draw every step
    const all = b.spec.type === 'frames' ? b.spec.frames : [b.spec];
    all.forEach(f => Viz.render(f));
    if (b.spec.type === 'frames' && b.spec.frames.length > 240) throw new Error('too many steps');
    return { ...b, whatIf: t.whatIf };
  },
  // Every input the model copied must be in the lesson's text (so it really is the lesson's example).
  // A list (an array to sort, a reference string, keys) must also appear in the lesson in that order, close together:
  // small numbers like 2, 5, 9 occur in any lesson, the sequence 5, 2, 9, 1 does not.
  seqInLesson(md, list) {
    const xs = list.map(x => String(x).trim()).filter(Boolean);
    if (xs.length < 3) return true;
    const toks = [...String(md).replace(/\\[a-zA-Z]+/g, ' ').matchAll(/[A-Za-z]+\d*|\d+(?:\.\d+)?/g)].map(m => m[0]);
    const eq = (a, b) => a === b || (isFinite(a) && isFinite(b) && +a === +b);
    for (let s = 0; s < toks.length; s++) {
      if (!eq(toks[s], xs[0])) continue;
      let k = 1, j = s + 1;
      while (k < xs.length && j < toks.length && j - s <= 3 * xs.length + 4) { if (eq(toks[j], xs[k])) k++; j++; }
      if (k === xs.length) return true;
    }
    return false;
  },
  check(md, template, params) {
    this.prepNums(md);
    const t = this.T[template], toks = (t.tokens ? t.tokens(params) : []).filter(x => x !== '' && x != null);
    const missing = toks.filter(x => !this.inLesson(md, x));
    for (const list of (t.seqs ? t.seqs(params) : [])) if (!this.seqInLesson(md, list)) missing.push(`the sequence ${list.join(', ')}`);
    return { ok: !missing.length, missing };
  },
  // The lesson states a result for its example: compare it with the exact one.
  // result: the exact value(s) (a number, or a list where the first is the main answer). The lesson's final number
  // (the last one it states) must be one of them, to 2%; otherwise the card says so.
  compare(stated, result) {
    if (stated == null || stated === '' || result == null) return null;
    // only a short final answer is compared (a long narrative's last number is rarely the answer)
    if (String(stated).length > 80 || (String(stated).match(/\d+(?:\.\d+)?/g) || []).length > 4) return null;
    const ns = String(stated).replace(/\\frac\{(\d+)\}\{(\d+)\}/g, '$1/$2').match(/-?\d+(?:\.\d+)?/g), rs = (Array.isArray(result) ? result : [result]).filter(x => typeof x === 'number' && isFinite(x));
    if (!ns || !rs.length) return null;
    const last = +ns[ns.length - 1];
    if (rs.some(r => Math.abs(last - r) <= 0.02 * Math.max(1, Math.abs(r)) || Math.abs(last - r) < 0.011)) return null;
    return `The lesson's example says "${String(stated).replace(/\s+/g, ' ').slice(0, 90)}", which does not match the exact computation shown here. Trust the animation.`;
  },
  candidates(title, md) {
    const head = `${title}\n${String(md).split('\n').filter(l => /^#/.test(l)).join('\n')}`, body = String(md).slice(0, 6000);
    const byTitle = Object.entries(this.T).filter(([, t]) => t.kw.test(title)), byHead = Object.entries(this.T).filter(([, t]) => t.kw.test(head)), byBody = Object.entries(this.T).filter(([, t]) => t.kw.test(body));
    const seen = new Set(), out = [];
    [...byTitle, ...byHead, ...byBody].forEach(([k]) => { if (!seen.has(k)) { seen.add(k); out.push(k); } });
    return out.slice(0, 8);
  },
  lessonViz(md) {
    const m = String(md).match(/```viz\s*\n([\s\S]*?)```/);
    if (!m) return null;
    try { const spec = JSON.parse(m[1]); this.build({ template: 'lesson_viz', spec }); return spec; } catch { return null; }
  },
  // The model picks the template and copies the example's inputs; code checks them and computes the animation.
  async make(title, md, signal, onStage = () => {}) {
    const cands = this.candidates(title, md), text = plainText(md).slice(0, 7000);
    const tried = [];
    if (cands.length) {
      onStage('Picking the example to animate');
      const pick = parseJSON(await ollamaChat([
        { role: 'system', content: `You choose how to animate a GATE CS lesson. Pick the ONE template that best animates the lesson's main idea using a concrete worked example that is IN the lesson (with its actual numbers). Pick "none" if no template fits the lesson's topic or the lesson has no usable example for it.\n${cands.map(k => `- ${k}: ${this.T[k].desc}`).join('\n')}` },
        { role: 'user', content: `Lesson: ${title}\n\n${text}` },
      ], { signal, model: checkModel(), temperature: 0, maxTokens: 120, format: { type: 'object', required: ['template'], properties: { template: { type: 'string', enum: [...cands, 'none'] } } } }));
      const order = pick.template && pick.template !== 'none' ? [pick.template, ...cands.filter(c => c !== pick.template && this.T[c].kw.test(title))].slice(0, 2) : [];
      for (const id of order) {
        const t = this.T[id];
        onStage(`Reading the example's inputs (${t.label})`);
        const schema = { type: 'object', required: [...t.schema.required, 'lesson_result'], properties: { ...t.schema.properties, lesson_result: { type: 'string', description: 'the final answer the lesson states for this example (empty if none)' } } };
        let params;
        try {
          params = parseJSON(await ollamaChat([
            { role: 'system', content: `Copy the inputs of the lesson's worked example for this animation: ${t.desc}. Copy every number, name and string EXACTLY as the lesson gives it (no LaTeX, no $ signs; P_1 is written P1). Use the lesson's main worked example (the first fully worked one that fits). lesson_result: the final answer the lesson states for that same example. Return JSON.` },
            { role: 'user', content: `Lesson: ${title}\n\n${text}` },
          ], { signal, model: checkModel(), temperature: 0, maxTokens: 900, format: schema }));
        } catch (e) { if (e.name === 'AbortError') throw e; continue; }
        const stated = params.lesson_result; delete params.lesson_result;
        const ck = this.check(md, id, params);
        if (!ck.ok) { tried.push(`${id}: not in the lesson: ${ck.missing.slice(0, 4).join(', ')}`); continue; }
        try {
          onStage('Computing every step');
          const b = this.build({ template: id, params });
          if (b.input != null) params.input = b.input;   // the sentence actually parsed (the what-if box shows it)
          const warn = this.compare(stated, b.result);
          return { template: id, params, label: b.label, notice: b.notice, warn: warn || '', stated: stated || '', ...(tried.length ? { tried } : {}), at: new Date().toISOString() };
        } catch (e) { tried.push(`${id}: ${e.message}`); }
      }
    }
    const lv = this.lessonViz(md);
    if (lv) return { template: 'lesson_viz', spec: lv, label: "The lesson's own exact drawing", notice: 'No step-by-step template fits this lesson, so its own exact drawing is shown.', at: new Date().toISOString() };
    return { none: true, tried, at: new Date().toISOString() };
  },

  // ---------- the card at the top of a lesson ----------
  whatIfHtml(wi, p) {
    const ctl = (wi || []).filter(c => !c.when || c.when(p));
    if (!ctl.length) return '';
    return `<div class="cv-whatif ta-whatif"><span class="cv-wi-h">What if</span>${ctl.map(c => {
      const v = c.get ? c.get(p) : p[c.k], lab = escapeHtml(c.label || c.k.replace(/_/g, ' '));
      if (c.opts) return `<label>${lab}<select data-wi="${c.k}">${c.opts.map(o => `<option ${String(v ?? '').toLowerCase() === o.toLowerCase() ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
      return `<label>${lab}<input data-wi="${c.k}" ${c.text ? 'type="text"' : `type="number" step="any"${c.min != null ? ` min="${c.min}"` : ''}`} value="${escapeHtml(v ?? '')}"></label>`;
    }).join('')}<button class="link small cv-reset" style="display:none">Back to the lesson's example</button><span class="cv-wi-msg small"></span></div>`;
  },
  cardHtml(b, anim, changed) {
    return `<div class="eyebrow">Topic animation</div><h3 class="ta-title">${escapeHtml(b.label)}</h3>
      <p class="ta-notice"><b>What to notice:</b> ${escapeHtml(b.notice || '')}</p>${anim.warn && !changed ? `<p class="ta-warn">⚠ ${escapeHtml(anim.warn)}</p>` : ''}
      ${this.whatIfHtml(b.whatIf, anim.params || {})}
      <div class="diagram viz ta-viz" data-viz="${encodeURIComponent(JSON.stringify(b.spec))}"><p class="small muted">Drawing&hellip;</p></div>
      <div class="row ta-foot"><span class="small muted">${anim.template === 'lesson_viz' ? 'Drawn exactly from the lesson\'s drawing data.' : 'Every step is computed by the app from the lesson\'s own example; the model only picked the example.'}</span><button class="link small ta-redo" title="Pick the example again">${icon('refresh')} Re-make</button></div>`;
  },
  // box: where the card goes; anim: the saved record (undefined = never tried); save(anim) stores it with the lesson.
  fresh: new Set(),   // book lessons written in this visit (their md), so they are animated automatically
  // isNew: a lesson just written gets its animation automatically; an older one shows "Animate this topic".
  mount(box, { topic, md, anim, save, isNew }) {
    if (!box || typeof Viz === 'undefined') return;
    // A lesson rewritten since: an animation whose inputs are no longer in it is made again.
    if (anim && anim.template && anim.template !== 'lesson_viz' && md && !this.check(md, anim.template, anim.params).ok) anim = undefined;
    let cur = anim, params = anim && anim.params;
    const go = () => {
      box.innerHTML = `<div class="card ta-card ta-loading"><div class="eyebrow">Topic animation</div><p class="ta-stage small">Starting&hellip;</p><div class="hook-bar"><span></span></div></div>`;
      let made = null, n = 0;
      runJob(`Topic animation: ${topic}`, async signal => {
        made = await this.make(topic, md, signal, t => { jobLabel(`Topic animation: ${t}`, signal); const s = $('.ta-stage', box); if (s) s.textContent = t + '…'; const b = $('.hook-bar span', box); if (b) b.style.width = `${Math.min(95, 15 + 22 * ++n)}%`; });
      }, async () => {
        if (made) { await save(made); cur = made; params = made.params; }
        paint();
      });
    };
    const paint = (p = params) => {
      if (!cur) {
        box.innerHTML = md ? `<div class="hook-empty-row ta-empty"><button class="link small ta-go" title="An exact step-by-step animation of this lesson's example">▶ Animate this topic</button></div>` : '';
        const b = $('.ta-go', box); if (b) b.onclick = go;
        return;
      }
      if (cur.none) {
        box.innerHTML = `<div class="hook-empty-row ta-empty"><span class="small muted" title="${escapeHtml((cur.tried || []).join('\n'))}">No exact animation fits this lesson.</span><button class="link small ta-go">${icon('refresh')} Try again</button></div>`;
        $('.ta-go', box).onclick = go;
        return;
      }
      let b;
      try { b = this.build(cur.template === 'lesson_viz' ? cur : { ...cur, params: p }); }
      catch (e) {
        if (p !== cur.params) { const m = $('.cv-wi-msg', box); if (m) m.textContent = e.message; return; }
        box.innerHTML = `<div class="hook-empty-row ta-empty"><span class="small muted">The saved animation could not be drawn (${escapeHtml(e.message)}).</span><button class="link small ta-go">${icon('refresh')} Make it again</button></div>`;
        $('.ta-go', box).onclick = go; return;
      }
      const changed = p !== cur.params;
      box.innerHTML = `<div class="card ta-card">${this.cardHtml(b, { ...cur, params: p }, changed)}</div>`;
      Viz.drawAll(box);
      const rs = $('.cv-reset', box); if (rs) { rs.style.display = changed ? '' : 'none'; rs.onclick = () => { params = cur.params; paint(); }; }
      $('.ta-redo', box).onclick = go;
      let tmr = null;
      box.querySelectorAll('[data-wi]').forEach(el => { el.oninput = el.onchange = () => { clearTimeout(tmr); tmr = setTimeout(() => {
        const c = (b.whatIf || []).find(x => x.k === el.dataset.wi), raw = el.value.trim();
        if (raw === '' || !c) return;
        const v = el.tagName === 'SELECT' || c.text ? raw : +raw;
        params = c.set ? c.set(params, v) : { ...params, [c.k]: v };
        paint(params);
        const again = box.querySelector(`[data-wi="${c.k}"]`); if (again && el.tagName !== 'SELECT') { again.focus(); try { again.setSelectionRange(99, 99); } catch {} }
      }, el.tagName === 'SELECT' ? 0 : 250); }; });
    };
    paint();
    // New lessons get their animation straight away (Settings → Memory-hook pictures → "Animate new lessons").
    if (cur === undefined && isNew && md && Cfg.get('autoanim', 'on') === 'on' && !box.dataset.auto) { box.dataset.auto = '1'; go(); }
  },
};

// Data-structure simulators: the exact final state after a sequence of operations, plus a step-by-step drawing
// (viz "frames") for the explanation.
//   BST insert / delete (in-order successor), AVL insert with rotations, binary heaps (insert, delete root,
//   bottom-up build), B+ tree insert (order = max children), stacks and queues, and a binary tree rebuilt from
//   inorder + preorder/postorder. Answers: traversals, height, leaves, root, array form, splits, rotations, outputs.

const DS = {
  // ---------- trees as { v, l, r } ----------
  toViz(t) { const f = n => n ? { v: n.v, c: [f(n.l), f(n.r)] } : null; return f(t); },
  height(t) { return t ? 1 + Math.max(this.height(t.l), this.height(t.r)) : 0; },   // nodes on the longest path
  order(t, kind) { const o = []; const go = n => { if (!n) return; if (kind === 'pre') o.push(n.v); go(n.l); if (kind === 'in') o.push(n.v); go(n.r); if (kind === 'post') o.push(n.v); }; go(t); return o; },
  level(t) { const o = [], q = t ? [t] : []; while (q.length) { const n = q.shift(); o.push(n.v); if (n.l) q.push(n.l); if (n.r) q.push(n.r); } return o; },
  leaves(t) { return !t ? 0 : !t.l && !t.r ? 1 : this.leaves(t.l) + this.leaves(t.r); },
  count(t) { return t ? 1 + this.count(t.l) + this.count(t.r) : 0; },
  clone(t) { return t ? { v: t.v, l: this.clone(t.l), r: this.clone(t.r) } : null; },
  // ---------- BST ----------
  bst(ops) {
    let t = null; const frames = [], caps = [];
    const ins = (n, v) => !n ? { v, l: null, r: null } : (v < n.v ? (n.l = ins(n.l, v), n) : v > n.v ? (n.r = ins(n.r, v), n) : n);
    const del = (n, v) => {
      if (!n) return null;
      if (v < n.v) { n.l = del(n.l, v); return n; }
      if (v > n.v) { n.r = del(n.r, v); return n; }
      if (!n.l) return n.r; if (!n.r) return n.l;
      let s = n.r; while (s.l) s = s.l;   // in-order successor
      n.v = s.v; n.r = del(n.r, s.v); return n;
    };
    for (const o of ops) {
      if (o.op === 'delete') { t = del(t, o.key); caps.push(`Delete ${o.key}${''}`); }
      else { t = ins(t, o.key); caps.push(`Insert ${o.key}`); }
      frames.push({ type: 'tree', root: this.toViz(this.clone(t)), highlight: o.op === 'delete' ? [] : [o.key] });
    }
    return { t, frames, caps };
  },
  // ---------- AVL ----------
  avl(ops) {
    let t = null; const frames = [], caps = []; let rotations = [];
    const h = n => n ? n.h : 0, upd = n => { n.h = 1 + Math.max(h(n.l), h(n.r)); return n; };
    const rr = y => { const x = y.l; y.l = x.r; x.r = y; upd(y); return upd(x); };   // right rotation
    const rl = x => { const y = x.r; x.r = y.l; y.l = x; upd(x); return upd(y); };   // left rotation
    const ins = (n, v) => {
      if (!n) return { v, l: null, r: null, h: 1 };
      if (v < n.v) n.l = ins(n.l, v); else if (v > n.v) n.r = ins(n.r, v); else return n;
      upd(n);
      const b = h(n.l) - h(n.r);
      if (b > 1 && v < n.l.v) { rotations.push(`LL at ${n.v} (right rotation)`); return rr(n); }
      if (b < -1 && v > n.r.v) { rotations.push(`RR at ${n.v} (left rotation)`); return rl(n); }
      if (b > 1 && v > n.l.v) { rotations.push(`LR at ${n.v} (left then right)`); n.l = rl(n.l); return rr(n); }
      if (b < -1 && v < n.r.v) { rotations.push(`RL at ${n.v} (right then left)`); n.r = rr(n.r); return rl(n); }
      return n;
    };
    const all = [];
    for (const o of ops) {
      rotations = [];
      t = ins(t, o.key);
      all.push(...rotations);
      caps.push(`Insert ${o.key}${rotations.length ? ': ' + rotations.join(', ') : ''}`);
      frames.push({ type: 'tree', root: this.toViz(t), highlight: [o.key] });
    }
    return { t, frames, caps, rotations: all };
  },
  // ---------- binary heap (array, 0-based) ----------
  heap(ops, kind = 'max', build = false) {
    const a = [], frames = [], caps = [], better = (x, y) => kind === 'max' ? x > y : x < y;
    const up = i => { while (i > 0) { const p = (i - 1) >> 1; if (better(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; } };
    const down = i => { for (;;) { const l = 2 * i + 1, r = l + 1; let b = i; if (l < a.length && better(a[l], a[b])) b = l; if (r < a.length && better(a[r], a[b])) b = r; if (b === i) break; [a[i], a[b]] = [a[b], a[i]]; i = b; } };
    const snap = cap => { frames.push({ type: 'tree', level: a.slice() }); caps.push(cap + ` · array: [${a.join(', ')}]`); };
    const removed = [];
    if (build) {   // bottom-up heapify of the given keys
      a.push(...ops.filter(o => o.op === 'insert').map(o => o.key));
      snap('The keys as given');
      for (let i = (a.length >> 1) - 1; i >= 0; i--) { down(i); snap(`Heapify at index ${i}`); }
      ops = ops.filter(o => o.op !== 'insert');
    }
    for (const o of ops) {
      if (o.op === 'insert') { a.push(o.key); up(a.length - 1); snap(`Insert ${o.key}`); }
      else if (o.op === 'deleteRoot') { if (!a.length) continue; removed.push(a[0]); a[0] = a[a.length - 1]; a.pop(); down(0); snap(`Delete the ${kind === 'max' ? 'maximum' : 'minimum'} (${removed[removed.length - 1]})`); }
    }
    return { a, frames, caps, removed };
  },
  // ---------- B+ tree (order p = max children; a node holds at most p - 1 keys) ----------
  // Leaf split: the left leaf keeps ceil(p/2) keys, the first key of the right leaf is copied up.
  // Internal split: the middle key moves up. (Conventions differ between books; this one is stated in the working.)
  bplus(keys, p) {
    const max = p - 1; let root = { leaf: true, keys: [] }, splits = 0;
    const frames = [], caps = [];
    const insert = (n, k) => {
      if (n.leaf) {
        if (n.keys.includes(k)) return null;
        n.keys.push(k); n.keys.sort((x, y) => x - y);
        if (n.keys.length <= max) return null;
        splits++;
        const cut = Math.ceil((max + 1) / 2), right = { leaf: true, keys: n.keys.slice(cut) };
        n.keys = n.keys.slice(0, cut);
        return { key: right.keys[0], node: right };
      }
      let i = n.keys.findIndex(x => k < x); if (i < 0) i = n.keys.length;
      const up = insert(n.kids[i], k);
      if (!up) return null;
      n.keys.splice(i, 0, up.key); n.kids.splice(i + 1, 0, up.node);
      if (n.keys.length <= max) return null;
      splits++;
      const mid = Math.floor(n.keys.length / 2), upKey = n.keys[mid];
      const right = { leaf: false, keys: n.keys.slice(mid + 1), kids: n.kids.slice(mid + 1) };
      n.keys = n.keys.slice(0, mid); n.kids = n.kids.slice(0, mid + 1);
      return { key: upKey, node: right };
    };
    const vizOf = n => ({ v: n.keys.join(' | '), c: n.leaf ? [] : n.kids.map(vizOf) });
    for (const k of keys) {
      const up = insert(root, k);
      if (up) root = { leaf: false, keys: [up.key], kids: [root, up.node] };
      frames.push({ type: 'tree', root: vizOf(root) }); caps.push(`Insert ${k}`);
    }
    const levels = []; let n = root; while (n) { levels.push(n); n = n.leaf ? null : n.kids[0]; }
    const countNodes = x => 1 + (x.leaf ? 0 : x.kids.reduce((s, c) => s + countNodes(c), 0));
    return { root, splits, height: levels.length, nodes: countNodes(root), frames, caps };
  },
  // ---------- tree from traversals ----------
  fromTraversals(inorder, other, kind) {
    const idx = new Map(inorder.map((v, i) => [String(v), i]));
    if (idx.size !== inorder.length) throw new Error('keys must be distinct');
    if (kind === 'pre') { let k = 0; const go = (lo, hi) => { if (lo > hi) return null; const v = other[k++], m = idx.get(String(v)); if (m == null || m < lo || m > hi) throw new Error('these traversals don\'t fit one tree'); return { v, l: go(lo, m - 1), r: go(m + 1, hi) }; }; const t = go(0, inorder.length - 1); if (k !== other.length) throw new Error('length mismatch'); return t; }
    let k = other.length - 1; const go = (lo, hi) => { if (lo > hi) return null; const v = other[k--], m = idx.get(String(v)); if (m == null || m < lo || m > hi) throw new Error('these traversals don\'t fit one tree'); const r = go(m + 1, hi); return { v, l: go(lo, m - 1), r }; };
    return go(0, inorder.length - 1);
  },
  // ---------- stack / queue ----------
  sq(ops, kind) {
    const s = [], out = [], frames = [], caps = [];
    for (const o of ops) {
      if (o.op === 'push' || o.op === 'enqueue' || o.op === 'insert') s.push(o.key);
      else if (o.op === 'pop' || o.op === 'dequeue' || o.op === 'delete') { if (!s.length) throw new Error(`${o.op} on an empty ${kind}`); out.push(kind === 'stack' ? s.pop() : s.shift()); }
      frames.push({ type: kind, items: s.slice() }); caps.push(o.op + (o.key != null && /push|enqueue|insert/.test(o.op) ? ` ${o.key}` : ` → ${out[out.length - 1]}`));
    }
    return { s, out, frames, caps };
  },
};

// ---------- the runner ----------
const DS_SCHEMA = { type: 'object', required: ['structure', 'ops', 'ask'], properties: {
  structure: { type: 'string', enum: ['bst', 'avl', 'max_heap', 'min_heap', 'bplus_tree', 'stack', 'queue', 'traversals', 'none'] },
  ops: { type: 'array', items: { type: 'object', required: ['op'], properties: { op: { type: 'string', enum: ['insert', 'delete', 'delete_root', 'push', 'pop', 'enqueue', 'dequeue'] }, key: { type: 'number' } } } },
  build_heap: { type: 'boolean', description: 'true if the heap is built from the given array with the bottom-up (heapify) method' },
  order: { type: 'integer', description: 'B+ tree order (max children per node)' },
  inorder: { type: 'array', items: { type: 'number' } }, preorder: { type: 'array', items: { type: 'number' } }, postorder: { type: 'array', items: { type: 'number' } },
  ask: { type: 'string', enum: ['preorder', 'postorder', 'inorder', 'levelorder', 'height', 'leaves', 'nodes', 'root', 'array', 'rotations', 'splits', 'popped', 'final_contents', 'tree'] },
  key: { type: 'number', description: 'the key the question asks about, if any' } } };
async function dsRunner(q, signal) {
  if (!/\b(insert\w*|delet\w*|push\w*|pop\w*|enqueue\w*|dequeue\w*|heapify|build\w*|traversal|preorder|postorder|inorder|pre-order|post-order|in-order)\b/i.test(q)) return null;
  if (!/\b(bst|binary search tree|avl|heap|b\+\s*-?\s*tree|stack|queue|binary tree)\b/i.test(q)) return null;
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'Read this GATE data-structure question for an exact simulator. structure: which structure. ops: the operations in order, with keys exactly as given (for "insert 10, 20, 30 in that order" give three inserts). For a heap built from a given array by heapify, set build_heap true and give the array as inserts. For "construct the tree from its inorder and preorder/postorder", use structure "traversals" and copy the sequences. ask: what the question asks for. Return JSON.' },
    { role: 'user', content: q.slice(0, 4000) },
  ], { signal, model: checkModel(), temperature: 0, maxTokens: 1500, format: DS_SCHEMA }));
  if (!j.structure || j.structure === 'none') return null;
  // The keys must appear in the question in the same order (no invented or reordered data).
  const qNums = (q.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const inOrder = list => { let k = 0; for (const x of qNums) if (k < list.length && x === list[k]) k++; return k === list.length; };
  const keys = (j.ops || []).map(o => o.key).filter(k => k != null);
  if (j.structure === 'traversals') { if (!(j.inorder || []).length || !inOrder(j.inorder) || !inOrder(j.preorder || j.postorder || [])) return null; }
  else if (!keys.length || !inOrder(keys)) return null;
  const ops = (j.ops || []).map(o => ({ op: o.op === 'delete_root' ? 'deleteRoot' : o.op, key: o.key }));
  let r, answer, frames, caps, extra = '';
  const list = a => a.join(', ');
  try {
    if (j.structure === 'bst' || j.structure === 'avl') {
      r = j.structure === 'bst' ? DS.bst(ops) : DS.avl(ops); frames = r.frames; caps = r.caps;
      const t = r.t;
      answer = { preorder: list(DS.order(t, 'pre')), postorder: list(DS.order(t, 'post')), inorder: list(DS.order(t, 'in')), levelorder: list(DS.level(t)), height: `${DS.height(t) - 1} (edges; ${DS.height(t)} levels)`,
        leaves: DS.leaves(t), nodes: DS.count(t), root: t && t.v, rotations: r.rotations ? `${r.rotations.length}: ${r.rotations.join('; ') || 'none'}` : '0', tree: list(DS.level(t)) }[j.ask] ?? list(DS.order(t, 'pre'));
      extra = `Final tree: preorder ${list(DS.order(t, 'pre'))}; inorder ${list(DS.order(t, 'in'))}; postorder ${list(DS.order(t, 'post'))}; height ${DS.height(t) - 1} (counting edges).`;
    } else if (/heap/.test(j.structure)) {
      r = DS.heap(ops, j.structure === 'min_heap' ? 'min' : 'max', !!j.build_heap); frames = r.frames; caps = r.caps;
      answer = { array: list(r.a), levelorder: list(r.a), root: r.a[0], popped: list(r.removed), nodes: r.a.length }[j.ask] ?? list(r.a);
      extra = `Final heap array: [${list(r.a)}]${r.removed.length ? `; removed in order: ${list(r.removed)}` : ''}.`;
    } else if (j.structure === 'bplus_tree') {
      if (!(j.order >= 3)) return null;
      r = DS.bplus(keys, j.order); frames = r.frames; caps = r.caps;
      answer = { splits: r.splits, height: r.height, nodes: r.nodes }[j.ask] ?? r.splits;
      extra = `Order ${j.order} (at most ${j.order - 1} keys per node): ${r.splits} split${r.splits === 1 ? '' : 's'}, ${r.height} level${r.height > 1 ? 's' : ''}, ${r.nodes} nodes. Convention: a full leaf splits with the left half keeping ⌈${j.order}/2⌉ keys and the right leaf's first key copied up; an internal node pushes its middle key up. Check that your book uses the same convention.`;
    } else if (j.structure === 'stack' || j.structure === 'queue') {
      r = DS.sq(ops, j.structure); frames = r.frames; caps = r.caps;
      answer = { popped: list(r.out), final_contents: list(r.s) }[j.ask] ?? list(r.out);
      extra = `Removed in order: ${list(r.out) || 'nothing'}; left in the ${j.structure}: ${list(r.s) || 'nothing'}.`;
    } else if (j.structure === 'traversals') {
      const t = DS.fromTraversals(j.inorder, j.preorder && j.preorder.length ? j.preorder : j.postorder, j.preorder && j.preorder.length ? 'pre' : 'post');
      frames = [{ type: 'tree', root: DS.toViz(t) }]; caps = ['The only tree with these traversals'];
      answer = { preorder: list(DS.order(t, 'pre')), postorder: list(DS.order(t, 'post')), levelorder: list(DS.level(t)), height: DS.height(t) - 1, leaves: DS.leaves(t), root: t.v }[j.ask] ?? list(DS.order(t, 'post'));
      extra = `Rebuilt tree: preorder ${list(DS.order(t, 'pre'))}; postorder ${list(DS.order(t, 'post'))}; level order ${list(DS.level(t))}.`;
    } else return null;
  } catch (e) { console.warn('ds simulator', e.message); return null; }
  const opt = optionForOutput(String(answer).replace(/\s*\(.*\)$/, ''), q);
  const num = /^-?\d+(\.\d+)?$/.test(String(answer)) ? +answer : null;
  const drawing = frames && frames.length ? `\n\n\`\`\`viz\n${JSON.stringify(frames.length > 1 ? { type: 'frames', frames: frames.slice(-40), captions: caps.slice(-40) } : { ...frames[0], caption: caps[0] })}\n\`\`\`` : '';
  return { solver: 'ds', name: `${{ bst: 'BST', avl: 'AVL tree', max_heap: 'Max-heap', min_heap: 'Min-heap', bplus_tree: 'B+ tree', stack: 'Stack', queue: 'Queue', traversals: 'Tree from traversals' }[j.structure]} simulator`,
    params: { operations: ops.map(o => o.op + (o.key != null ? ' ' + o.key : '')).join(', ').slice(0, 300), asked: j.ask },
    value: opt || num || String(answer), text: opt ? `${opt} (${answer})` : String(answer),
    steps: `${extra}${drawing}` };
}

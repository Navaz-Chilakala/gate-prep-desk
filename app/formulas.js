// Formula book: every formula seen anywhere (lessons, your PDF and image pages, solved photo
// questions, tutor chat answers) is collected per subject, without duplicates, and mirrored to
// "My GATE formulas.md" in the app folder.

function formulaKey(tex) { return String(tex).replace(/\\(left|right|displaystyle|,|;|!|quad|qquad)/g, '').replace(/\s+/g, '').replace(/\\text\{([^}]*)\}/g, '$1').toLowerCase(); }
// Looks like a formula (not just a symbol like $P_1$ or $n$).
function formulaish(tex) {
  const t = String(tex).trim();
  if (t.length < 5 || !/(=|\\le|\\ge|\\leq|\\geq|<|>|\\approx|\\propto|\\frac|\\sum|\\prod|\\log|\\lceil|\\lfloor|\\binom|\\times|\^)/.test(t) || /^[A-Za-z]_?\{?\w*\}?$/.test(t)) return false;
  // Skip worked arithmetic ("Avg = (5+7+14)/3 = 8.67", "32 KB = 32 x 1024 = 32768"): more digits than symbols.
  const core = t.replace(/\\text\{[^}]*\}|\\mathrm\{[^}]*\}/g, ' ').replace(/\\[a-zA-Z]+/g, ' ');
  const digits = (core.match(/\d/g) || []).length, letters = (core.match(/[A-Za-z]/g) || []).length;
  return digits < letters || (digits <= 2 && letters > 0) || (letters === 0 && digits === 0);
}
function describe(text) { return plainText(String(text || '')).replace(/\$[^$]*\$/g, '').replace(/\s+/g, ' ').replace(/^[\s:–—\-,.]+|[\s:–—\-,]+$/g, '').slice(0, 140); }

// Pulls formulas out of Markdown. Returns [{ tex, note }].
function extractFormulas(md) {
  const out = [], seen = new Set(), s = String(md || '');
  const add = (tex, note) => {
    tex = String(tex).trim();
    if (!formulaish(tex) || looksLikeExample(tex)) return;   // worked-example steps never enter the book
    const k = formulaKey(tex);
    if (seen.has(k)) return;
    seen.add(k); out.push({ tex, note: describe(note) });
  };
  // Display math, with the line before it as the note.
  const lines = s.split('\n');
  const flat = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => `$$${t}$$`);
  for (const m of flat.matchAll(/\$\$([\s\S]+?)\$\$/g)) {
    const before = flat.slice(0, m.index).split('\n').filter(l => l.trim()).pop() || '';
    add(m[1], before);
  }
  // Inline formulas with a relation in them, with their bullet/sentence as the note.
  for (const line of lines) {
    for (const m of line.replace(/\$\$[\s\S]*?\$\$/g, '').matchAll(/\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g)) {
      const tex = m[1] || m[2];
      if (/=|\\le|\\ge|\\approx/.test(tex) && tex.length >= 6) add(tex, line);
    }
  }
  return out.slice(0, 40);
}

// source: { kind: 'lesson' | 'topic' | 'page' | 'solved' | 'chat', label, href }
async function collectFormulas(md, subject, source) { return collectMany([{ md, subject, source }]); }
// items: [{ md, subject, source }] -> saved in one go (used for whole books).
async function collectMany(items) {
  const batches = items.map(it => ({ it, found: extractFormulas(it.md) })).filter(b => b.found.length);
  if (!batches.length) return 0;
  let added = 0;
  const now = new Date().toISOString();
  await updateHub(h => {
    h.formulas = h.formulas || [];
    const index = new Map(h.formulas.map(f => [f.key, f])), rejected = new Set(h.formulaRejects || []);
    for (const { it: { subject, source }, found } of batches) for (const f of found) {
      const key = formulaKey(f.tex);
      if (rejected.has(key)) continue;   // the tutor already judged this not a formula
      const have = index.get(key);
      if (have) {
        if (!have.sources.some(x => x.label === source.label)) have.sources = have.sources.concat([source]).slice(-6);
        if (!have.note && f.note) have.note = f.note;
        if ((!have.subject || have.subject === 'Other') && subject && subject !== 'Other') have.subject = subject;
      } else {
        const item = { id: uid(), key, tex: f.tex, note: f.note, subject: formulaSubject(f) || subject || "Other", srcSubject: subject || "Other", sources: [source], at: now };
        h.formulas.push(item); index.set(key, item); added++;
      }
    }
  });
  if (added) { syncFormulasFile(); curateSoon(); }
  return added;
}

function formulasMarkdown(list) {
  const by = {};
  (list || []).forEach(f => (by[f.subject] = by[f.subject] || []).push(f));
  const order = SUBJECTS.concat(['Other']);
  const out = ['# My GATE formulas', `_Updated ${new Date().toLocaleString()} · ${(list || []).length} formulas_`, ''];
  Object.keys(by).sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach(s => {
    out.push(`## ${s}`, '');
    by[s].forEach(f => out.push(`- $${f.tex}$${f.note ? ` — ${f.note}` : ''}  _(from ${f.sources.map(x => x.label).slice(0, 2).join('; ')})_`));
    out.push('');
  });
  return out.join('\n');
}
let formulasSyncTimer = null;
function syncFormulasFile() {
  clearTimeout(formulasSyncTimer);
  formulasSyncTimer = setTimeout(async () => {
    if (Store.mode !== 'server') return;
    try { const h = await Store.getHub(); await fetch('/api/formulas-file', { method: 'PUT', body: formulasMarkdown(h.formulas) }); } catch {}
  }, 1000);
}
// The subject a study space is mostly about (from its lessons in the topics list), for pages that don't say.
async function siteSubject(siteId) {
  const counts = {};
  ((await Store.getHub()).covered || []).filter(e => e.source && e.source.siteId === siteId && e.subject !== 'Other').forEach(e => { counts[e.subject] = (counts[e.subject] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || 'Other';
}

// ---------- curation: the tutor checks each new formula once ----------
// Is it a real, reusable formula (not a worked-example step or an assignment like "Q = 10")?
// Which GATE subject does THIS formula belong to? What is it called?
const CURATE_SCHEMA = () => ({ type: 'object', required: ['items'], properties: { items: { type: 'array', items: {
  type: 'object', required: ['i', 'keep', 'subject', 'name'], properties: {
    i: { type: 'integer' }, keep: { type: 'boolean' }, subject: { type: 'string', enum: SUBJECTS.concat(['Other']) }, name: { type: 'string' } } } } } });
let curating = false;
async function curateFormulas({ all = false, onProgress } = {}) {
  if (curating) return;
  curating = true;
  try {
    for (;;) {
      const h = await Store.getHub();
      const todo = (h.formulas || []).filter(f => all ? !f.recheck : !f.checked).slice(0, 25);
      if (!todo.length) break;
      const list = todo.map((f, i) => `${i}. $${f.tex}$  | note: ${f.note || '-'} | from: ${f.sources.map(s => s.label).slice(0, 2).join('; ')}`).join('\n');
      let res = [];
      try {
        res = (parseJSON(await ollamaChat([
          { role: 'system', content: `You curate a GATE CS formula book. For each numbered item decide:
- keep: true only for a general, reusable formula, definition, identity, law or rule a student should memorise (e.g. AMAT = hit time + miss rate x miss penalty, TAT = CT - AT, FIRST/FOLLOW definitions). false for worked-example steps, specific numbers, variable assignments (Q = 10, PC = 200), register-transfer steps of one example, item sets or states of one example.
- subject: the GATE subject THIS formula belongs to (judge the formula itself, not where it was found).
- name: a short standard name (2-6 words), e.g. "Average memory access time".
Return JSON with one entry per item, using its number as i.` },
          { role: 'user', content: list },
        ], { format: CURATE_SCHEMA(), temperature: 0, maxTokens: 2500 })).items || []);
      } catch (e) { console.warn('formula check failed', e); break; }
      const byKey = new Map(todo.map((f, i) => [i, f.key]));
      await updateHub(h2 => {
        const index = new Map((h2.formulas || []).map(f => [f.key, f]));
        const drop = new Set();
        todo.forEach((f, i) => {
          const r = res.find(x => x.i === i), cur = index.get(byKey.get(i));
          if (!cur) return;
          cur.checked = true; if (all) cur.recheck = true;
          if (!r) return;
          // Drop example steps (clear shape), or what the model calls an example/misconception note.
          if (looksLikeExample(cur.tex) || (r.keep === false && /example|misconception|\bstep\b|\bnote\b/i.test(r.name || ''))) { drop.add(cur.key); return; }
          if (r.name && r.name.length < 60) cur.name = r.name.trim();
          // Vocabulary first, then the lesson it came from, then the model.
          const fromSource = cur.srcSubject && cur.srcSubject !== "Other" ? cur.srcSubject : null;
          cur.subject = formulaSubject(cur) || fromSource || (SUBJECTS.includes(r.subject) ? r.subject : cur.subject);
        });
        h2.formulas = (h2.formulas || []).filter(f => !drop.has(f.key));
        // Remember what was dropped so it isn't collected again.
        h2.formulaRejects = (h2.formulaRejects || []).concat([...drop]).slice(-500);
      });
      if (onProgress) onProgress();
    }
    if (all) await updateHub(h => (h.formulas || []).forEach(f => { delete f.recheck; }));
  } finally { curating = false; syncFormulasFile(); }
}
let curateTimer = null;
function curateSoon() { clearTimeout(curateTimer); curateTimer = setTimeout(() => curateFormulas({ onProgress: () => window.dispatchEvent(new Event('gt-formulas')) }), 4000); }

// Subject-specific words in a formula, its name or note decide its subject first (most reliable),
// then the lesson it came from, and only then the model's guess.
const FORMULA_VOCAB = {
  'Computer Organization and Architecture': ['cache', 'hit ratio', 'hit rate', 'miss rate', 'miss penalty', 'amat', 'memory access time', 'tag', 'block offset', 'set associative', 'pipeline', 'speedup', 'cpi', 'clock cycle', 'throughput of pipeline', 'stall', 'instruction', 'addressing mode', 'dma', 'interrupt', 'bus'],
  'Operating System': ['round robin', 'scheduling', 'fcfs', 'sjf', 'srtf', 'turnaround', 'waiting time', 'burst', 'arrival time', 'completion time', 'response time', 'quantum', 'context switch', 'page fault', 'page table', 'tlb', 'effective access time', 'frame', 'semaphore', 'deadlock', 'banker', 'disk scheduling', 'seek time', 'rotational latency'],
  'Compiler Design': ['first(', 'follow(', 'first set', 'follow set', 'goto(', 'closure', 'lr(', 'll(1)', 'slr', 'lalr', 'parse', 'grammar', 'production', 'lexeme', 'token'],
  'Databases': ['attribute closure', 'functional dependenc', 'candidate key', 'normal form', 'bcnf', 'relational algebra', 'b+ tree', 'b tree order', 'tuple', 'join', 'serializab'],
  'Computer Networks': ['bandwidth', 'propagation delay', 'transmission delay', 'rtt', 'window size', 'efficiency of stop', 'sliding window', 'throughput', 'subnet', 'cidr', 'crc', 'hamming distance', 'checksum', 'ethernet', 'aloha', 'csma'],
  'Theory of Computation': ['dfa', 'nfa', 'regular expression', 'pumping', 'pda', 'turing', 'language', 'automat'],
  'Algorithms': ['master theorem', 'recurrence', 'big o', 'time complexity', 'dijkstra', 'bellman', 'kruskal', 'prim', 'dynamic programming', 'knapsack', 'lcs', 'matrix chain'],
  'Programming and Data Structures': ['height of', 'binary tree', 'heap', 'bst', 'hash', 'load factor', 'linked list', 'stack', 'queue', 'array index', 'row major', 'column major'],
  'Digital Logic': ['boolean', 'k-map', 'flip-flop', 'flip flop', 'multiplexer', 'decoder', 'two\'s complement', 'ieee 754', 'mantissa', 'exponent bias', 'minterm', 'maxterm'],
  'Probability and Statistics': ['probability', 'p(a', 'bayes', 'expectation', 'variance', 'binomial', 'poisson', 'normal distribution', 'standard deviation', 'e[x]'],
  'Discrete Mathematics': ['permutation', 'combination', 'pigeonhole', 'graph', 'degree', 'euler', 'hamilton', 'lattice', 'group', 'relation', 'generating function', 'recurrence relation'],
  'Linear Algebra': ['eigen', 'determinant', 'rank', 'matrix', 'inverse', 'trace'],
  'Calculus': ['derivative', 'integral', 'limit', 'maxima', 'minima', 'taylor'],
};
function formulaSubject(f) {
  const text = ` ${f.name || ''} ${f.note || ''} ${f.tex || ''} `.toLowerCase().replace(/\\text\{([^}]*)\}/g, '$1');
  let best = null, bestHits = 0;
  for (const [subject, words] of Object.entries(FORMULA_VOCAB)) {
    const hits = words.filter(w => text.includes(w)).length;
    if (hits > bestHits) { best = subject; bestHits = hits; }
  }
  return best;
}
// What a worked-example step looks like (specific numbers, register transfers, one example's sets/states, plain assignments).
function looksLikeExample(tex) {
  const t = String(tex).replace(/\\text\{[^}]*\}/g, 'x');
  return /\\leftarrow|\\gets/.test(t) || /\bI_\{?\d|goto\s*\(\s*I_|closure\s*\(\s*I_/i.test(t) ||
    /^\s*[A-Za-z]\w*(_\{?\w+\}?)?\s*=\s*-?[\d.\\]+(\s*\\?[a-z]+)?\s*$/i.test(t) || /^\s*[A-Za-z]\s*=\s*[a-z]\s*,/.test(t) ||
    (t.match(/\d/g) || []).length >= 4 || /\begin\{aligned\}/.test(t);
}
// A formula's note without leftover LaTeX, and hidden when it only repeats the name.
function cleanNote(note, name) {
  let n = String(note || '');
  if (/\\[a-zA-Z]+|[{}^_]/.test(n)) n = n.split(/[:=]/)[0];   // "First Set: FIRST(\alpha) = ..." -> "First Set"
  n = n.replace(/\s+/g, ' ').trim().replace(/[:,-]$/, '');
  const base = s => String(s || '').toLowerCase().replace(/\b(formula|definition|calculation|set)\b|[^a-z0-9]/g, '');
  return n.length > 3 && base(n) !== base(name) && !base(name).includes(base(n)) ? n : '';
}

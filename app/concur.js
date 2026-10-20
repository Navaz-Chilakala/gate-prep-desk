// Exact checkers for concurrency questions (operating systems) and transaction schedules (databases).
//
// Concurrency: every possible interleaving of the processes is tried (with semaphores; "x = x + 1" either atomic or
// as load / compute / store), and the possible outputs, final values and deadlocks are listed. The model only copies
// the processes out of the question, and every statement it copies must appear in the question.
//
// Schedules: read straight from the question text (r1(A) w2(B) c1 …, no model). Precedence graph, conflict and view
// serializability (with an equivalent serial order), recoverable / cascadeless / strict, and basic timestamp ordering.

// ======================= concurrency =======================
const Concur = {
  // One process statement → steps. Non-atomic assignments read each shared variable in its own step.
  compile(stmts, shared, atomic) {
    const steps = [];
    for (const raw of stmts) {
      const s = String(raw).trim().replace(/;$/, '');
      let m;
      if ((m = s.match(/^(?:wait|P|down|acquire)\s*\(\s*(\w+)\s*\)$/i))) steps.push({ k: 'P', sem: m[1] });
      else if ((m = s.match(/^(?:signal|V|up|release)\s*\(\s*(\w+)\s*\)$/i))) steps.push({ k: 'V', sem: m[1] });
      else if ((m = s.match(/^(?:print|printf|output)\s*\(\s*(?:"[^"]*"\s*,\s*)?(.+?)\s*\)$/i))) steps.push({ k: 'print', e: m[1] });
      else if ((m = s.match(/^(\w+)\s*(\+\+|--)$/))) this.assign(steps, m[1], `${m[1]} ${m[2][0]} 1`, shared, atomic);
      else if ((m = s.match(/^(\w+)\s*([+\-*/%]?)=\s*(.+)$/))) this.assign(steps, m[1], m[2] ? `${m[1]} ${m[2]} (${m[3]})` : m[3], shared, atomic);
      else throw new Error(`can't simulate "${s}"`);
    }
    return steps;
  },
  assign(steps, v, e, shared, atomic) {
    const reads = [...new Set((e.match(/\b[A-Za-z_]\w*\b/g) || []).filter(w => w in shared))];
    if (atomic || !reads.length) { steps.push({ k: 'set', v, e }); return; }
    let ex = e;
    reads.forEach((r, i) => { steps.push({ k: 'set', v: `__r${i}`, e: r, local: true }); ex = ex.replace(new RegExp(`\\b${r}\\b`, 'g'), `__r${i}`); });
    steps.push({ k: 'set', v, e: ex });
  },
  evalE(e, env) {
    const t = e.replace(/\b[A-Za-z_]\w*\b/g, w => { if (!(w in env)) throw new Error(`"${w}" has no value`); return `(${env[w]})`; });
    if (!/^[\d\s+\-*/%()<>=!&|.]+$/.test(t)) throw new Error(`can't evaluate "${e}"`);
    const v = Function(`"use strict";return (${t.replace(/(\d+(?:\.\d+)?|\([^()]*\))\s*\/\s*(\d+(?:\.\d+)?|\([^()]*\))/g, 'Math.trunc($1/$2)')})`)();
    return typeof v === 'boolean' ? +v : v;
  },
  // Depth-first search over all interleavings (memoised). Returns outputs, final states and deadlocks.
  explore({ shared = {}, semaphores = {}, processes = [], atomic = true }) {
    const procs = processes.map(p => this.compile(p.steps || p, shared, atomic));
    const outs = new Set(), finals = new Map(), dead = new Set(), seen = new Set();
    let count = 0;
    const go = (pcs, vars, sems, locals, out, trace) => {
      if (++count > 400000) throw new Error('too many interleavings to try');
      const key = JSON.stringify([pcs, vars, sems, locals, out]);
      if (seen.has(key)) return; seen.add(key);
      let moved = false;
      procs.forEach((steps, i) => {
        if (pcs[i] >= steps.length) return;
        const st = steps[pcs[i]];
        if (st.k === 'P' && !(sems[st.sem] > 0)) return;
        moved = true;
        const P = pcs.slice(), V = { ...vars }, S = { ...sems }, L = locals.map(l => ({ ...l }));
        let O = out;
        P[i]++;
        if (st.k === 'P') S[st.sem]--;
        else if (st.k === 'V') S[st.sem] = (S[st.sem] || 0) + 1;
        else if (st.k === 'print') O = out + (out ? ' ' : '') + this.evalE(st.e, { ...V, ...L[i] });
        else { const val = this.evalE(st.e, { ...V, ...L[i] }); if (st.local || !(st.v in shared)) L[i][st.v] = val; else V[st.v] = val; }
        go(P, V, S, L, O, trace.concat(i));
      });
      if (!moved) {
        if (pcs.every((p, i) => p >= procs[i].length)) { outs.add(out); const k = JSON.stringify(vars); if (!finals.has(k)) finals.set(k, vars); }
        else dead.add(JSON.stringify({ at: pcs.map((p, i) => p < procs[i].length ? `P${i + 1} blocked at step ${p + 1}` : `P${i + 1} done`), vars }));
      }
    };
    go(procs.map(() => 0), { ...shared }, { ...semaphores }, procs.map(() => ({})), '', []);
    return { outputs: [...outs], finals: [...finals.values()], deadlocks: [...dead].map(d => JSON.parse(d)), states: seen.size };
  },
};
const CONC_SCHEMA = { type: 'object', required: ['shared', 'semaphores', 'processes', 'atomic', 'ask'], properties: {
  shared: { type: 'object', additionalProperties: { type: 'number' } }, semaphores: { type: 'object', additionalProperties: { type: 'integer' } },
  processes: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, atomic: { type: 'boolean' },
  ask: { type: 'string', enum: ['final_values', 'outputs', 'deadlock', 'min', 'max', 'count'] }, variable: { type: 'string' } } };
async function concurRunner(q, signal) {
  if (!/\b(process(es)?|threads?|concurrent(ly)?|interleav\w*|semaphores?|P\d\b|T\d\b)/i.test(q) || !/(=|wait\s*\(|signal\s*\(|\bP\s*\(|\bV\s*\()/.test(q)) return null;
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'Copy the concurrent processes from this question for a simulator. shared: shared variables and their initial values. semaphores: semaphores and initial values. processes: one array per process with its statements in order, each copied exactly as written (e.g. "wait(S)", "x = x + 1", "signal(S)", "print(x)"); unroll loops with a fixed small count. atomic: true if each statement runs indivisibly, false if the question says statements like x = x + 1 are a load, an add and a store (non-atomic). ask: what the question asks (final_values of a variable, possible outputs, whether deadlock is possible, min or max final value, or the count of distinct values); variable: which variable. Return JSON.' },
    { role: 'user', content: q.slice(0, 4000) },
  ], { signal, model: checkModel(), temperature: 0, maxTokens: 1500, format: CONC_SCHEMA }));
  // Process labels ("P1", "Process 2:") sometimes come along as if they were statements: drop them.
  const procs = (j.processes || []).map(p => (p || []).map(s => String(s).replace(/^\s*(?:process\s*|thread\s*)?[PT]?\d+\s*[:.)-]\s*/i, '').trim()).filter(s => s && !/^(process|thread)?\s*[PT]?\d+$/i.test(s) && !/^(begin|end|repeat|forever|do|while\s*\(?\s*(true|1)\s*\)?)\b/i.test(s))).filter(p => p.length);
  if (procs.length < 2) return null;
  // every copied statement must be in the question (loops may be unrolled, so a statement can repeat)
  if (!procs.flat().every(s => inQuestion(String(s).replace(/;$/, ''), q))) return null;
  let r;
  try { r = Concur.explore({ shared: j.shared || {}, semaphores: j.semaphores || {}, processes: procs, atomic: j.atomic !== false }); } catch (e) { console.warn('concurrency', e.message); return null; }
  const v = j.variable && (j.variable in (j.shared || {})) ? j.variable : Object.keys(j.shared || {})[0];
  const vals = [...new Set(r.finals.map(f => f[v]))].sort((a, b) => a - b);
  let value, text;
  if (j.ask === 'deadlock') { value = r.deadlocks.length ? 'yes' : 'no'; text = r.deadlocks.length ? `Deadlock is possible (${r.deadlocks.length} way${r.deadlocks.length > 1 ? 's' : ''})` : 'No deadlock is possible'; }
  else if (j.ask === 'outputs') { value = r.outputs.join(' | '); text = `Possible outputs: ${r.outputs.map(o => `"${o}"`).join(', ')}`; }
  else if (j.ask === 'min') { value = vals[0]; text = `Minimum final ${v}: ${vals[0]}`; }
  else if (j.ask === 'max') { value = vals[vals.length - 1]; text = `Maximum final ${v}: ${vals[vals.length - 1]}`; }
  else if (j.ask === 'count') { value = vals.length; text = `${vals.length} distinct final value${vals.length > 1 ? 's' : ''} of ${v}: ${vals.join(', ')}`; }
  else { value = vals.join(', '); text = `Possible final values of ${v}: ${vals.join(', ')}`; }
  // For "which output/value is (not) possible" questions, pick the option(s).
  // "not atomic" / "non-atomic" describe the statements, not the question: ignore them when looking for "NOT possible".
  const stem = q.replace(/\n\s*\(?[A-D][).][^\n]*/g, '').replace(/\bnot\s+(atomic|indivisible)\b|\bnon[-\s]?atomic\b/gi, '');
  const opts = optionsIn(q), notQ = /\bnot\b|impossible|cannot|never/i.test(stem);
  if (Object.keys(opts).length >= 2 && (j.ask === 'outputs' || j.ask === 'final_values')) {
    const nums = s => (String(s).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
    const multi = Object.values(opts).some(o => nums(o).length > 1);
    const can = L => j.ask === 'outputs' ? r.outputs.some(o => o.replace(/\s+/g, '') === String(opts[L]).replace(/[\s,]+/g, ''))
      : multi ? sameSet([...new Set(nums(opts[L]))], vals) : vals.includes(nums(opts[L])[0]);   // "1 or 2" = the whole set; "2" = one possible value
    const pick = Object.keys(opts).filter(L => notQ ? !can(L) : can(L));
    if (pick.length && pick.length < Object.keys(opts).length) { value = pick.join(', '); text = `${pick.join(', ')} (${text})`; }
  }
  return { solver: 'concurrency', name: `Every interleaving tried (${j.atomic === false ? 'non-atomic updates' : 'atomic statements'})`, params: { processes: procs.map((p, i) => `P${i + 1}: ${p.join('; ')}`).join(' | ') }, value, text,
    steps: `Tried every interleaving of ${procs.length} processes (${r.states} distinct states)${j.atomic === false ? ', with each update split into load / compute / store' : ''}:\n\n${procs.map((p, i) => `- **P${i + 1}**: \`${p.join('; ')}\``).join('\n')}\n\n` +
      `**Possible final values of ${v}:** ${vals.join(', ') || '—'}\n\n${r.outputs.some(Boolean) ? `**Possible outputs:** ${r.outputs.map(o => `\`${o}\``).join(', ')}\n\n` : ''}**Deadlock:** ${r.deadlocks.length ? `possible, e.g. ${r.deadlocks[0].at.join(', ')}` : 'not possible'}` };
}

// ======================= transaction schedules =======================
// "r1(A) w2(A) c1", "R1(X); W2(X)", "read(T1, A)", "w_1(x)" … plus commits/aborts. Returns ops or null.
function parseSchedule(txt) {
  const ops = [];
  const re = /\b([rRwW])\s*_?\s*\{?(\d+)\}?\s*\(\s*([A-Za-z]\w*)\s*\)|\b(read|write)\s*\(\s*T?(\d+)\s*,\s*([A-Za-z]\w*)\s*\)|\b([cCaA])\s*_?\s*\{?(\d+)\}?\b(?!\s*\()|\b(commit|abort)\s*\(?\s*T?(\d+)\s*\)?/gi;
  for (const m of String(txt).matchAll(re)) {
    if (m[1]) ops.push({ op: m[1].toLowerCase(), t: +m[2], x: m[3] });
    else if (m[4]) ops.push({ op: m[4][0].toLowerCase(), t: +m[5], x: m[6] });
    else if (m[7]) ops.push({ op: m[7].toLowerCase(), t: +m[8] });
    else if (m[9]) ops.push({ op: m[9][0].toLowerCase(), t: +m[10] });
  }
  return ops.filter(o => o.op === 'r' || o.op === 'w').length >= 2 ? ops : null;
}
function analyseSchedule(ops) {
  const txns = [...new Set(ops.map(o => o.t))].sort((a, b) => a - b), rw = ops.filter(o => o.op === 'r' || o.op === 'w');
  // precedence graph
  const edges = new Set();
  rw.forEach((a, i) => rw.slice(i + 1).forEach(b => { if (a.t !== b.t && a.x === b.x && (a.op === 'w' || b.op === 'w')) edges.add(`${a.t}>${b.t}`); }));
  const E = [...edges].map(e => e.split('>').map(Number));
  const topo = (() => { const indeg = {}, out = {}; txns.forEach(t => { indeg[t] = 0; out[t] = []; }); E.forEach(([a, b]) => { out[a].push(b); indeg[b]++; }); const q = txns.filter(t => !indeg[t]), order = []; while (q.length) { const t = q.shift(); order.push(t); out[t].forEach(u => { if (!--indeg[u]) q.push(u); }); } return order.length === txns.length ? order : null; })();
  // view serializability: same reads-from and final writes as some serial order
  const view = s => { const rf = [], last = {}; s.forEach((o, i) => { if (o.op === 'r') { let src = 0; for (let k = i - 1; k >= 0; k--) if (s[k].op === 'w' && s[k].x === o.x) { src = s[k].t; break; } rf.push(`${o.t}:${o.x}<-${src}`); } if (o.op === 'w') last[o.x] = o.t; }); return JSON.stringify([rf.sort(), Object.entries(last).sort()]); };
  const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
  let viewOrder = null;
  if (txns.length <= 7) { const target = view(rw); for (const p of perms(txns)) { const serial = p.flatMap(t => rw.filter(o => o.t === t)); if (view(serial) === target) { viewOrder = p; break; } } }
  // recoverability family
  const commitAt = {}; ops.forEach((o, i) => { if (o.op === 'c' && !(o.t in commitAt)) commitAt[o.t] = i; });
  const endAt = t => { const i = ops.findIndex(o => (o.op === 'c' || o.op === 'a') && o.t === t); return i < 0 ? Infinity : i; };
  let recoverable = true, cascadeless = true, strict = true;
  const why = [];
  ops.forEach((o, i) => {
    if (o.op !== 'r' && o.op !== 'w') return;
    for (let k = i - 1; k >= 0; k--) {
      const p = ops[k];
      if (p.op === 'w' && p.x === o.x && p.t !== o.t) {
        const committed = endAt(p.t) < i;
        if (!committed) { strict = false; if (o.op === 'r') { cascadeless = false; why.push(`T${o.t} reads ${o.x} written by T${p.t} before T${p.t} commits`); } }
        if (o.op === 'r' && (o.t in commitAt) && !(commitAt[p.t] < commitAt[o.t])) { recoverable = false; why.push(`T${o.t} reads ${o.x} from T${p.t} but commits first`); }
        break;
      }
      if (p.op === 'w' && p.x === o.x && p.t === o.t) break;
    }
  });
  // basic timestamp ordering (timestamps in order of first appearance, or by number)
  const ts = {}; ops.forEach(o => { if (!(o.t in ts)) ts[o.t] = Object.keys(ts).length + 1; });
  const RTS = {}, WTS = {}; let toOK = true, toFail = '';
  for (const o of rw) {
    const T = ts[o.t];
    if (o.op === 'r') { if (T < (WTS[o.x] || 0)) { toOK = false; toFail = `r${o.t}(${o.x}) is rejected: a younger transaction already wrote ${o.x}`; break; } RTS[o.x] = Math.max(RTS[o.x] || 0, T); }
    else { if (T < (RTS[o.x] || 0) || T < (WTS[o.x] || 0)) { toOK = false; toFail = `w${o.t}(${o.x}) is rejected: a younger transaction already ${T < (RTS[o.x] || 0) ? 'read' : 'wrote'} ${o.x}`; break; } WTS[o.x] = T; }
  }
  return { txns, edges: E, conflict: !!topo, serialOrder: topo, view: !!viewOrder, viewOrder, recoverable, cascadeless, strict, to: toOK, toFail, why, hasCommits: ops.some(o => o.op === 'c') };
}
// Does an option's statement hold? ("conflict serializable but not view serializable", "S1 is recoverable and S2 is not" …)
function scheduleClaim(opt, results) {
  const props = [['conflict', /conflict[-\s]*serializ/i], ['view', /view[-\s]*serializ/i], ['strict', /\bstrict\b/i], ['cascadeless', /cascade[-\s]*less|avoids? cascad|\baca\b/i], ['recoverable', /\brecoverable\b/i], ['to', /timestamp/i], ['conflict', /\bserializ/i]];
  // "neither X nor Y" = "not X, not Y"; "both X and Y" = "X, Y"
  const o = String(opt).replace(/\bneither\b([\s\S]*?)\bnor\b/gi, 'not$1, not').replace(/\bboth\b/gi, '');
  const clauses = o.split(/,|;|\bbut\b|\band\b|\bwhereas\b/i).map(s => s.trim()).filter(Boolean);
  let known = 0, pending = [];   // "S1 and S2 are X": a schedule named without a property takes the next property
  const negOf = c => /\bnot\b|\bnon[-\s]|\bneither\b|\bnor\b|\bisn't\b|\bun\w*recoverable\b/i.test(c);
  let lastName = null, lastProp = null;
  const check = (name, prop, neg) => { const r = results[name ? +name - 1 : 0]; if (!r) return null; known++; return r[prop] !== neg; };
  for (const c of clauses) {
    const name = (c.match(/\bS\s*_?\s*(\d)\b/i) || [])[1] || null;
    const p = props.find(([, re]) => re.test(c));
    if (!p) { if (name) pending.push({ name, neg: negOf(c) }); continue; }
    const neg = negOf(c), subj = name || (pending.length ? null : lastName);   // "… but not cascadeless" is about the same schedule
    for (const s of [...pending, { name: subj, neg }]) { const ok = check(s.name, p[0], s.neg || neg); if (ok === null) return null; if (!ok) return false; }
    pending = []; lastName = subj; lastProp = p[0];
  }
  for (const s of pending) { if (!lastProp) return null; const ok = check(s.name, lastProp, s.neg); if (ok === null) return null; if (!ok) return false; }   // "… and S2 is not"
  return known ? true : null;
}
function scheduleRunner(q) {
  if (!/serializ|recoverable|cascad|strict|precedence graph|timestamp|schedule/i.test(q)) return null;
  // one or more schedules: "S1: r1(A) …" or just the operations
  const stem = q.replace(/\n\s*\(?[A-D][).][^\n]*/g, '');
  const labeled = [...stem.matchAll(/\bS\s*_?\s*(\d)\s*[:=]\s*([^\n]+)/gi)].map(m => ({ n: +m[1], ops: parseSchedule(m[2]) })).filter(s => s.ops);
  const scheds = labeled.length ? labeled.sort((a, b) => a.n - b.n).map(s => s.ops) : [parseSchedule(stem)].filter(Boolean);
  if (!scheds.length) return null;
  const results = scheds.map(analyseSchedule);
  const yes = b => b ? 'yes' : 'no';
  const lines = results.map((r, i) => `**${scheds.length > 1 ? 'S' + (labeled[i] ? labeled[i].n : i + 1) : 'The schedule'}**: precedence graph ${r.edges.length ? r.edges.map(([a, b]) => `T${a}→T${b}`).join(', ') : '(no edges)'} · conflict serializable: **${yes(r.conflict)}**${r.serialOrder ? ` (as ${r.serialOrder.map(t => 'T' + t).join(' → ')})` : ' (cycle)'} · view serializable: **${yes(r.view)}**${r.viewOrder && !r.conflict ? ` (as ${r.viewOrder.map(t => 'T' + t).join(' → ')})` : ''}`
    + (r.hasCommits ? ` · recoverable: **${yes(r.recoverable)}** · cascadeless: **${yes(r.cascadeless)}** · strict: **${yes(r.strict)}**` : ' · (no commits given, so recoverability isn\'t judged)')
    + ` · basic timestamp ordering: **${r.to ? 'allowed' : 'rejected'}**${r.toFail ? ` (${r.toFail})` : ''}${r.why.length ? `\n  - ${[...new Set(r.why)].join('\n  - ')}` : ''}`);
  const opts = optionsIn(q), truth = Object.fromEntries(Object.keys(opts).map(L => [L, scheduleClaim(opts[L], results)]));
  const trueOpts = Object.keys(truth).filter(L => truth[L] === true), decided = Object.values(truth).every(v => v != null);
  const value = decided && trueOpts.length ? trueOpts.join(', ') : results.length === 1 ? (results[0].conflict ? 'conflict serializable' : results[0].view ? 'view serializable only' : 'not serializable') : '';
  return { solver: 'schedule', name: 'Schedule checker (exact)', params: { schedules: scheds.length }, value, text: decided && trueOpts.length ? `${trueOpts.join(', ')}` : value || 'see the analysis',
    steps: lines.join('\n\n') + (Object.keys(opts).length ? `\n\nOptions: ${Object.keys(opts).map(L => `(${L}) ${truth[L] === true ? 'true' : truth[L] === false ? 'false' : "can't tell"}`).join(' · ')}` : '') };
}

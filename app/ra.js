// Relational algebra, NFA → DFA, and grammar ambiguity.
//
// Relational algebra (σ π ρ ⋈ × ∪ ∩ − ÷, LaTeX or symbols) is translated to SQL with set semantics and run with
// SQLite on the tables printed in the question (the same table copying and checks as the SQL runner).
// NFA → DFA: subset construction, counting the reachable DFA states (with and without the dead state).
// Ambiguity: a breadth-first search over leftmost derivations; a grammar is reported ambiguous only with a
// witness string that has two different leftmost derivations (unambiguity can't be proved by searching).

// ======================= relational algebra =======================
function raNormalize(s) {
  return String(s).replace(/\$/g, '').replace(/\\sigma/g, 'σ').replace(/\\pi|\\Pi/g, 'π').replace(/\\rho/g, 'ρ').replace(/\\bowtie|\\Join|⋈|\|><\|/g, '⋈').replace(/\\times/g, '×')
    .replace(/\\cup/g, '∪').replace(/\\cap/g, '∩').replace(/\\div|\\divide/g, '÷').replace(/\\setminus|\\minus/g, '−').replace(/\\land|\\wedge/g, '∧').replace(/\\lor|\\vee/g, '∨').replace(/\\lnot|\\neg/g, '¬')
    .replace(/\\neq?|\\ne\b/g, '≠').replace(/\\leq?\b|\\le\b/g, '≤').replace(/\\geq?\b|\\ge\b/g, '≥').replace(/\\text\{([^}]*)\}|\\mathrm\{([^}]*)\}/g, (m, a, b) => a || b).replace(/\\,|\\;|\\ /g, ' ');
}
function raParse(src) {
  const s = raNormalize(src); let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const sub = () => {   // subscript: _{...} or _x
    ws(); if (s[i] !== '_') return '';
    i++; ws();
    if (s[i] === '{') { let d = 0, j = i; for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; } const t = s.slice(i + 1, j); i = j + 1; return t; }
    const m = s.slice(i).match(/^[^\s(]+/); i += m[0].length; return m[0];
  };
  function expr() {
    let l = term();
    for (;;) {
      ws();
      const op = s[i];
      if (!op || !'∪∩−-×⋈÷'.includes(op)) return l;
      i++;
      const r = term();
      l = { k: op === '-' ? '−' : op, l, r };
    }
  }
  function term() {
    ws();
    const c = s[i];
    if (c === '(') { i++; const e = expr(); ws(); if (s[i] !== ')') throw new Error('missing )'); i++; return e; }
    if (c === 'σ' || c === 'π' || c === 'ρ') { i++; const a = sub(); ws(); if (s[i] !== '(') { const e = term(); return { k: c, a, e }; } i++; const e = expr(); ws(); if (s[i] !== ')') throw new Error('missing )'); i++; return { k: c, a, e }; }
    const m = s.slice(i).match(/^[A-Za-z]\w*/);
    if (!m) throw new Error(`unexpected "${c || 'end'}"`);
    i += m[0].length;
    return { k: 'rel', name: m[0] };
  }
  const e = expr(); ws();
  if (i < s.length) throw new Error(`unexpected "${s[i]}"`);
  return e;
}
const raCond = c => c.replace(/∧/g, ' AND ').replace(/∨/g, ' OR ').replace(/¬/g, ' NOT ').replace(/≠/g, '<>').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/\b(and|or|not)\b/gi, m => ` ${m.toUpperCase()} `)
  .replace(/(['"])([^'"]*)\1/g, "'$2'").replace(/(?<![<>!=])==(?!=)/g, '=');
// Translates with a live database (needed to know the columns for ÷ and ρ).
function raToSql(e, db) {
  const cols = sql => db.prepare(`SELECT * FROM (${sql}) LIMIT 0`).getColumnNames();
  const go = e => {
    switch (e.k) {
      case 'rel': return `SELECT DISTINCT * FROM "${e.name}"`;
      case 'σ': return `SELECT DISTINCT * FROM (${go(e.e)}) WHERE ${raCond(e.a)}`;
      case 'π': return `SELECT DISTINCT ${e.a.split(',').map(x => x.trim()).filter(Boolean).join(', ')} FROM (${go(e.e)})`;
      case 'ρ': { const m = e.a.match(/^\s*\w*\s*\(([^)]*)\)\s*$/); if (!m) return go(e.e); const inner = go(e.e), old = cols(inner), nn = m[1].split(',').map(x => x.trim()); return `SELECT DISTINCT ${old.map((c, k) => `"${c}" AS ${nn[k] || c}`).join(', ')} FROM (${inner})`; }
      case '⋈': return `SELECT DISTINCT * FROM (${go(e.l)}) NATURAL JOIN (${go(e.r)})`;
      case '×': { const a = go(e.l), b = go(e.r), ca = cols(a), cb = cols(b); return `SELECT ${ca.map(c => `t1."${c}" AS "${cb.includes(c) ? 'L.' + c : c}"`).concat(cb.map(c => `t2."${c}" AS "${ca.includes(c) ? 'R.' + c : c}"`)).join(', ')} FROM (${a}) t1, (${b}) t2`; }
      case '∪': return `${go(e.l)} UNION ${go(e.r)}`;
      case '∩': return `${go(e.l)} INTERSECT ${go(e.r)}`;
      case '−': return `${go(e.l)} EXCEPT ${go(e.r)}`;
      case '÷': {
        const a = go(e.l), b = go(e.r), ca = cols(a), cb = cols(b), x = ca.filter(c => !cb.includes(c));
        if (!x.length || cb.some(c => !ca.includes(c))) throw new Error('division needs the divisor\'s columns inside the dividend');
        return `SELECT DISTINCT ${x.map(c => `r1."${c}"`).join(', ')} FROM (${a}) r1 WHERE NOT EXISTS (SELECT * FROM (${b}) s WHERE NOT EXISTS (SELECT * FROM (${a}) r2 WHERE ${x.map(c => `r2."${c}" = r1."${c}"`).concat(cb.map(c => `r2."${c}" = s."${c}"`)).join(' AND ')}))`;
      }
    }
    throw new Error('bad expression');
  };
  return go(e);
}
async function runRA(tables, expr) {
  const SQL = await sqlEngine(), db = new SQL.Database();
  try {
    for (const t of tables) {
      const cols = t.columns.map(c => String(c).trim().replace(/\W+/g, '_'));
      db.run(`CREATE TABLE "${t.name}" (${cols.map(c => `"${c}"`).join(', ')})`);
      const st = db.prepare(`INSERT INTO "${t.name}" VALUES (${cols.map(() => '?').join(', ')})`);
      for (const r of t.rows) st.run(cols.map((_, i) => sqlVal(r[i])));
      st.free();
    }
    const sql = raToSql(raParse(expr), db), res = db.exec(sql);
    const last = res[res.length - 1] || { columns: db.prepare(sql).getColumnNames(), values: [] };
    return { sql, columns: last.columns, rows: last.values };
  } finally { db.close(); }
}
const RA_SCHEMA = { type: 'object', required: ['tables', 'expression', 'ask'], properties: {
  tables: SQL_SCHEMA.properties.tables, expression: { type: 'string' }, ask: { type: 'string', enum: ['row_count', 'value', 'rows'] } } };
async function raRunner(q, signal) {
  if (!/σ|π|⋈|÷|\\sigma|\\pi|\\bowtie|\\div|relational algebra/i.test(q)) return null;
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'Copy out of this GATE question: every table printed in it (name, column names, every row exactly as printed) and the relational algebra expression exactly as printed (character for character, LaTeX included). ask: "row_count" if it asks how many tuples the result has, "value" for a single value, "rows" for which tuples. Return JSON.' },
    { role: 'user', content: q.slice(0, 6000) },
  ], { signal, model: checkModel(), temperature: 0, maxTokens: 3000, format: RA_SCHEMA }));
  if (!j.expression || !(j.tables || []).length || !inQuestion(j.expression, q)) return null;
  const cells = j.tables.flatMap(t => t.rows.flat()).map(v => String(v).trim()).filter(v => v && !/^null$/i.test(v));
  if (!cells.length || cells.filter(v => squash(q).includes(squash(v))).length < cells.length * 0.95) return null;
  let r;
  try { r = await runRA(j.tables, j.expression); } catch (e) { console.warn('relational algebra', e.message); return null; }
  const one = r.rows.length === 1 && r.columns.length === 1;
  const value = j.ask === 'row_count' ? r.rows.length : one ? r.rows[0][0] : r.rows.map(x => `(${x.join(', ')})`).join(', ');
  const opt = optionForOutput(String(value), q);
  return { solver: 'ra', name: 'Relational algebra (run on the tables)', params: { expression: j.expression }, value: opt || value, text: opt ? `${opt} (${j.ask === 'row_count' ? r.rows.length + ' tuples' : value})` : j.ask === 'row_count' ? `${r.rows.length} tuples` : String(value),
    steps: `Translated to SQL (set semantics: duplicates removed) and run with SQLite on the question's tables:\n\n\`\`\`sql\n${r.sql}\n\`\`\`\n\nResult (${r.rows.length} tuple${r.rows.length === 1 ? '' : 's'}):\n\n${resultMd(r)}` };
}

// ======================= NFA → DFA =======================
function subsetConstruction(nfa) {
  const syms = [...new Set(nfa.transitions.map(t => String(t[1])).filter(s => !/^(ε|e|eps|epsilon|λ)$/i.test(s)))].sort();
  const isEps = s => /^(ε|e|eps|epsilon|λ)$/i.test(String(s)) || s === '';
  const close = set => { const st = [...set], out = new Set(set); while (st.length) { const u = st.pop(); for (const t of nfa.transitions) if (String(t[0]) === u && isEps(t[1]) && !out.has(String(t[2]))) { out.add(String(t[2])); st.push(String(t[2])); } } return out; };
  const key = set => [...set].sort().join(',');
  const start = close(new Set([String(nfa.start)])), seen = new Map([[key(start), start]]), q = [start], trans = [];
  let dead = false;
  while (q.length) {
    const S = q.shift();
    for (const a of syms) {
      const nx = new Set(); S.forEach(u => nfa.transitions.forEach(t => { if (String(t[0]) === u && String(t[1]) === a) nx.add(String(t[2])); }));
      const T = close(nx), k = key(T);
      if (!T.size) dead = true;
      if (!seen.has(k)) { seen.set(k, T); q.push(T); }
      trans.push([`{${key(S)}}`, a, `{${k}}`]);
    }
  }
  const finals = new Set((nfa.finals || []).map(String));
  const states = [...seen.keys()].map(k => `{${k}}`);
  return { states, count: seen.size, withoutDead: seen.size - (seen.has('') ? 1 : 0), dead: seen.has(''), syms, trans, start: `{${key(start)}}`, finals: [...seen.entries()].filter(([, S]) => [...S].some(x => finals.has(x))).map(([k]) => `{${k}}`) };
}
const NFA_SCHEMA = { type: 'object', required: ['transitions', 'start', 'finals', 'ask'], properties: {
  transitions: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '[from, symbol, to]; symbol "ε" for epsilon moves' },
  start: { type: 'string' }, finals: { type: 'array', items: { type: 'string' } }, ask: { type: 'string', enum: ['dfa_states', 'dfa_states_without_dead'] } } };
async function nfaRunner(q, signal) {
  if (!/\bnfa\b|non-?deterministic finite/i.test(q) || !/\bdfa\b|deterministic|subset construction/i.test(q) || !/\bstates?\b/i.test(q)) return null;
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'Copy the NFA from this question: every transition as [from, symbol, to] (one entry per target state; "ε" for epsilon moves), the start state and the final states, exactly as named in the question. ask: "dfa_states" for the number of states of the equivalent DFA from subset construction, or "dfa_states_without_dead" if the question excludes the dead/trap state. Return JSON.' },
    { role: 'user', content: q.slice(0, 4000) },
  ], { signal, model: checkModel(), temperature: 0, maxTokens: 1500, format: NFA_SCHEMA }));
  const names = [...new Set((j.transitions || []).flatMap(t => [t[0], t[2]]))];
  if (!names.length || !names.every(n => squash(q).includes(squash(n)))) return null;
  let r; try { r = subsetConstruction(j); } catch { return null; }
  const n = j.ask === 'dfa_states_without_dead' ? r.withoutDead : r.count;
  const opt = optionForOutput(String(n), q);
  return { solver: 'nfa', name: 'Subset construction (exact)', params: { transitions: (j.transitions || []).length }, value: opt || n, text: opt ? `${opt} (${n} states)` : `${n} states`,
    steps: `Subset construction from the start state's ε-closure: **${r.count}** reachable DFA states${r.dead ? ` (including the dead state {}; ${r.withoutDead} without it)` : ''}. (This counts the subset-construction DFA; the minimal DFA can be smaller.)\n\n\`\`\`viz\n${JSON.stringify({ type: 'dfa', states: r.states, start: r.start, finals: r.finals, transitions: r.trans })}\n\`\`\`` };
}

// ======================= grammar ambiguity (witness search) =======================
// Two different leftmost derivations reaching the same sentential form ⇒ ambiguous; the witness is that form with
// every nonterminal replaced by its shortest terminal string.
function ambiguityWitness(g, maxLen = 7, budget = 80000) {
  const best = {};
  for (let changed = true; changed;) {
    changed = false;
    for (const p of g.prods) if (p.syms.every(s => !g.isNT(s) || best[s])) { const w = p.syms.flatMap(s => g.isNT(s) ? best[s] : [s]); if (!best[p.A] || w.length < best[p.A].length) { best[p.A] = w; changed = true; } }
  }
  const realize = form => form.every(s => !g.isNT(s) || best[s]) ? form.flatMap(s => g.isNT(s) ? best[s] : [s]).join(g.terms.some(t => t.length > 1) ? ' ' : '') : null;
  const seen = new Set([g.start]);
  let frontier = [[g.start]], steps = 0;
  while (frontier.length && steps < budget) {
    const next = [];
    for (const form of frontier) {
      const i = form.findIndex(s => g.isNT(s));
      if (i < 0) continue;
      for (const p of g.prods.filter(p => p.A === form[i])) {
        steps++;
        const nf = [...form.slice(0, i), ...p.syms, ...form.slice(i + 1)];
        if (nf.filter(x => !g.isNT(x)).length > maxLen || nf.length > 2 * maxLen + 4) continue;
        const k = nf.join('\u0001');
        if (seen.has(k)) { const w = realize(nf); if (w != null) return { ambiguous: true, witness: w || 'ε', form: nf.join(' '), derivations: 2 }; continue; }
        seen.add(k); next.push(nf);
      }
    }
    frontier = next;
  }
  return { ambiguous: false };
}
async function ambiguityRunner(q, signal) {
  if (!/\bambiguous\b|\bambiguity\b/i.test(q) || !/(->|→|::=)/.test(q)) return null;
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'Copy the grammar from this question as productions separated by ";" in the form "S -> a S b | ε ; A -> ...", start symbol first, exactly as printed. Return JSON.' },
    { role: 'user', content: q.slice(0, 3000) },
  ], { signal, model: checkModel(), temperature: 0, maxTokens: 400, format: { type: 'object', required: ['grammar'], properties: { grammar: { type: 'string' } } } }));
  let g; try { g = parseGrammar(j.grammar); } catch { return null; }
  if (!String(j.grammar).split(/;|\n/).every(p => p.split(/->|→|::=/)[1] == null || p.split(/->|→|::=/)[1].split('|').every(a => /^\s*(ε|epsilon|eps|λ)?\s*$/i.test(a) || squash(q).includes(squash(a))))) return null;
  const r = ambiguityWitness(g);
  if (!r.ambiguous) return null;   // not finding one up to a length proves nothing, so no claim is made
  const opt = optionForOutput('ambiguous', q);
  return { solver: 'ambiguity', name: 'Ambiguity search (exact witness)', params: { grammar: j.grammar }, value: opt || 'ambiguous', text: `Ambiguous: "${r.witness}" has two different leftmost derivations`,
    steps: `Searched all leftmost derivations of strings up to length 7. Two different leftmost derivations reach the same sentential form \`${r.form}\`, so the string **"${r.witness}"** derived from it has two different parse trees: the grammar is ambiguous.` };
}

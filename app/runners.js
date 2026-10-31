// Exact runners: instead of asking the model what an SQL query returns, what a C program prints, or which
// expression / regular expression / string matches, run the real thing.
// - SQL: SQLite in the browser (vendor/sqljs), on the tables printed in the question.
// - C: a real C compiler on this laptop, through the local server (only when one is installed).
// - Boolean expressions: truth tables. Regular expressions: NFA → DFA, exact equivalence and membership.
// - Grammars: which strings they generate (Earley recogniser).
// The model is only used to copy the program / tables / expressions out of the question, and every copy is
// checked against the question text, so a misread can't sneak in. Anything that doesn't fit returns null.
// Each runner returns the same shape as an exact calculator: { solver, name, params, value, text, steps }.

function loadScriptOnce(src) {
  loadScriptOnce.p = loadScriptOnce.p || {};
  return loadScriptOnce.p[src] = loadScriptOnce.p[src] || new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
}
const squash = s => plainText(String(s || '')).replace(/[`$\\]/g, '').replace(/\s+/g, '').toLowerCase();
// Is this text really in the question (ignoring spacing, case, Markdown and LaTeX wrappers)?
function inQuestion(text, question) { const t = squash(text).replace(/;+$/, ''); return t.length >= 3 && squash(question).includes(t); }

// ======================= SQL =======================
let SQLJS = null;
async function sqlEngine() {
  if (!SQLJS) { await loadScriptOnce('/vendor/sqljs/sql-wasm.js'); SQLJS = await initSqlJs({ locateFile: f => '/vendor/sqljs/' + f }); }
  return SQLJS;
}
// SQLite has no "x > ALL (subquery)" / "x = ANY (subquery)": rewrite them with the same meaning (NULLs included).
function sqlCompat(q) {
  let s = String(q).trim().replace(/;+\s*$/, '');
  for (let guard = 0; guard < 10; guard++) {
    const m = s.match(/([\w.]+|\([^()]*\))\s*(<=|>=|<>|!=|=|<|>)\s*(ALL|ANY|SOME)\s*\(/i);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    let depth = 0, close = -1;
    for (let i = open; i < s.length; i++) { if (s[i] === '(') depth++; else if (s[i] === ')' && --depth === 0) { close = i; break; } }
    if (close < 0) break;
    let sub = s.slice(open + 1, close).trim();
    const sel = sub.match(/^SELECT\s+(DISTINCT\s+)?([\s\S]+?)\s+FROM\s/i);
    if (!sel) break;
    sub = sub.replace(sel[0], `SELECT ${sel[1] || ''}${sel[2]} AS __c FROM `);
    const [, x, op, kind] = m, o = op === '!=' ? '<>' : op;
    const rep = /ALL/i.test(kind) ? `NOT EXISTS (SELECT 1 FROM (${sub}) WHERE (${x} ${o} __c) IS NOT TRUE)` : `EXISTS (SELECT 1 FROM (${sub}) WHERE ${x} ${o} __c)`;
    s = s.slice(0, m.index) + rep + s.slice(close + 1);
  }
  return s;
}
const sqlVal = v => { const t = String(v ?? '').trim().replace(/^['"]|['"]$/g, ''); return /^(null|-|—)?$/i.test(t) ? null : /^-?\d+(\.\d+)?$/.test(t) ? +t : t; };
async function runSql(tables, query) {
  const SQL = await sqlEngine(), db = new SQL.Database();
  try {
    for (const t of tables) {
      const cols = t.columns.map(c => String(c).trim().replace(/\W+/g, '_'));
      db.run(`CREATE TABLE "${t.name}" (${cols.map(c => `"${c}"`).join(', ')})`);
      const st = db.prepare(`INSERT INTO "${t.name}" VALUES (${cols.map(() => '?').join(', ')})`);
      for (const r of t.rows) st.run(cols.map((_, i) => sqlVal(r[i])));
      st.free();
    }
    const res = db.exec(sqlCompat(query));
    const last = res[res.length - 1] || { columns: [], values: [] };
    return { columns: last.columns, rows: last.values };
  } finally { db.close(); }
}
const SQL_SCHEMA = { type: 'object', required: ['tables', 'query', 'ask'], properties: {
  tables: { type: 'array', items: { type: 'object', required: ['name', 'columns', 'rows'], properties: { name: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } } } },
  query: { type: 'string' }, ask: { type: 'string', enum: ['row_count', 'value', 'rows'] } } };
function resultMd(r) {
  if (!r.columns.length) return '_(no rows)_';
  return `| ${r.columns.join(' | ')} |\n|${r.columns.map(() => '---').join('|')}|\n` + (r.rows.length ? r.rows.map(x => `| ${x.map(v => v == null ? 'NULL' : v).join(' | ')} |`).join('\n') : `| ${r.columns.map(() => ' ').join(' | ')} |`);
}
async function sqlRunner(q, signal) {
  if (!/\bSELECT\b[\s\S]+\bFROM\b/i.test(q)) return null;
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'Copy out of this GATE question: every table printed in it (name, column names, and every row exactly as printed; NULL as "NULL"), and the SQL query exactly as printed (character for character, do not fix or reformat it). ask: "row_count" if the question asks how many rows/tuples the query returns, "value" if it asks for the single value it outputs, "rows" if it asks which rows/tuples are returned. Return JSON.' },
    { role: 'user', content: q.slice(0, 6000) },
  ], { signal, model: checkModel(), temperature: 0, maxTokens: 3000, format: SQL_SCHEMA }));
  if (!j.query || !j.tables || !j.tables.length || !inQuestion(j.query, q)) return null;
  // Every value copied into the tables must be printed in the question.
  const cells = j.tables.flatMap(t => t.rows.flat()).map(v => String(v).trim()).filter(v => v && !/^null$/i.test(v));
  if (!cells.length || cells.filter(v => inQuestion(v, q) || squash(q).includes(squash(v))).length < cells.length * 0.95) return null;
  let r;
  try { r = await runSql(j.tables, j.query); } catch (e) { console.warn('sql runner', e.message); return null; }
  const one = r.rows.length === 1 && r.columns.length === 1;
  const value = j.ask === 'row_count' ? r.rows.length : one ? r.rows[0][0] : r.rows.map(x => `(${x.join(', ')})`).join(', ');
  const text = j.ask === 'row_count' ? `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}` : String(value ?? 'NULL');
  return { solver: 'sql', name: 'SQL runner', params: { query: j.query, tables: j.tables.map(t => `${t.name} (${t.rows.length} rows)`).join(', ') }, value: typeof value === 'number' ? value : String(value), text,
    steps: `Ran the query on the question's tables with SQLite:\n\n\`\`\`sql\n${j.query}\n\`\`\`\n\nResult:\n\n${resultMd(r)}` };
}

// ======================= C (through the local server's compiler) =======================
let CC = null;
// "Installed" is remembered; "not installed" (or a failed check) is asked again after 30 s, so installing one later just works.
async function ccInfo() {
  if (!CC || (!CC.available && Date.now() - CC.at > 30000)) { try { CC = { ...(await (await fetch('/api/cc')).json()), at: Date.now() }; } catch { CC = { available: false, at: Date.now() }; } }
  return CC;
}
async function runC(code, stdin = '') {
  const r = await fetch('/api/runc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, stdin }) });
  return r.json();
}
// The program part of a question: from the first #include / declaration to the last closing brace.
function cCodeIn(q) {
  // Raw text, never plainText(): Markdown clean-up would eat "#include", "*p" and "**q".
  const t = String(q).replace(/\r/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const fence = String(q).match(/```(?:c|cpp|C)?\s*\n([\s\S]*?)```/);
  if (fence) return fence[1];
  const lines = t.split('\n');
  const start = lines.findIndex(l => /^\s*(#include|#define|(static\s+|const\s+|unsigned\s+)*(int|void|char|float|double|long|short|struct|unsigned|typedef)\b[^;]*[({=;])/.test(l));
  let end = -1; lines.forEach((l, i) => { if (/}\s*;?\s*$/.test(l)) end = i; });
  if (start >= 0 && end > start) return lines.slice(start, end + 1).join('\n');
  // Pseudo-code (Pascal/ALGOL style): from the first declaration/procedure line to the last "end".
  const ps = lines.findIndex(l => /^\s*(var\b|procedure\b|function\b|program\b|begin\b|integer\b|int\b|[A-Za-z_]\w*\s*(:|:=)\s*)/i.test(l));
  let pe = -1; lines.forEach((l, i) => { if (/^\s*end\b/i.test(l)) pe = i; });
  return ps >= 0 && pe > ps ? lines.slice(ps, pe + 1).join('\n') : '';
}
const looksPseudo = q => /\b(begin|procedure)\b[\s\S]*\bend\b/i.test(q) || /:=/.test(q);
// ---------- static vs dynamic scoping ----------
// GCC compiles with static (lexical) scoping. For dynamic scoping the program is rewritten so it behaves that way
// ("shallow binding"): every variable that a function declares (or takes as a parameter) and that some other function
// uses as a non-local becomes one global binding. On entry the function saves the old value and binds its own; on
// every return it restores the old value. A function using the name therefore sees the most recent active binding in
// the call chain, which is exactly dynamic scoping. Then both programs are compiled and run.
const C_TYPES = 'int|char|float|double|long|short|unsigned|signed|bool|_Bool';
const C_WORDS = new Set(('auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL '
  + 'main printf scanf puts putchar getchar malloc calloc free strlen strcpy strcmp strcat abs pow sqrt exit include define stdio stdlib string math').split(' '));
const stripStrings = s => s.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
const depthAt = (s, i) => { let d = 0; for (let k = 0; k < i; k++) { if (s[k] === '{') d++; else if (s[k] === '}') d--; } return d; };
function matchBrace(s, open) { let d = 0; for (let i = open; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return i; } return -1; }
// Top-level function definitions (old-style "main() {" without a return type too).
function cFunctions(code) {
  const s = stripStrings(code), out = [];
  const re = new RegExp(`(^|[;}\\n])([ \\t]*)((?:(?:static|inline)\\s+)*(?:(?:${C_TYPES}|void|struct\\s+\\w+)[\\w\\s*]*?)?)\\b([A-Za-z_]\\w*)\\s*\\(([^()]*)\\)\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(s))) {
    const at = m.index + m[1].length + m[2].length, bo = m.index + m[0].length - 1;
    if (/^(if|while|for|switch|return|sizeof)$/.test(m[4]) || depthAt(s, at) !== 0) continue;
    const bc = matchBrace(s, bo);
    if (bc < 0) continue;
    const ps = m[5].trim();
    const params = !ps || ps === 'void' ? [] : ps.split(',').map(p => { const t = p.trim(), nm = (t.match(/([A-Za-z_]\w*)\s*(\[\s*\])?$/) || [])[1] || ''; return { type: (t.slice(0, t.lastIndexOf(nm)).replace(/\*/g, '').trim()) || 'int', name: nm, ptr: /\*/.test(t) || /\[/.test(t) }; });
    out.push({ ret: (m[3] || '').replace(/\b(static|inline)\b/g, '').trim() || 'int', name: m[4], params, hs: at, bo, bc });
    re.lastIndex = bc;
  }
  return out;
}
// Declarations "T a = 1, *p, x;" in a piece of code: [{ type, name, init, isStatic, ptr, start, end (of the statement) }].
function cDecls(s, from, to) {
  // A declaration starts a statement: at the start, or after ; { } or a line break (spaces allowed in between).
  const out = [], re = new RegExp(`(?<=(?:^|[;{}\\n])[ \\t]*)()()((?:(?:static|register|auto|const|extern)\\s+)*)(${C_TYPES})((?:\\s+(?:${C_TYPES}))*)\\b([^;(){}]*(?:\\([^;]*\\))?[^;{}]*);`, 'g');
  re.lastIndex = from;
  let m;
  while ((m = re.exec(s)) && m.index < to) {
    const start = m.index, end = m.index + m[0].length;
    if (end > to) break;
    const before = s.slice(Math.max(0, start - 6), start);
    if (/for\s*\(\s*$/.test(before)) continue;   // "for (int i = 0; ...)"
    // split declarators at top-level commas
    const parts = []; let d = 0, cur = '';
    for (const ch of m[6]) { if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--; if (ch === ',' && !d) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    for (const p of parts) {
      const mm = p.match(/^\s*(\**)\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*(?:=\s*([\s\S]+))?$/);
      if (!mm || mm[2].includes('(')) continue;
      out.push({ type: (m[4] + (m[5] || '')).trim(), name: mm[2], init: mm[4] ? mm[4].trim() : null, isStatic: /static/.test(m[3]), ptr: !!mm[1] || !!mm[3], start, end, raw: p });
    }
  }
  return out;
}
const cIdents = s => [...s.matchAll(/(?<![\w.]|->)\b([A-Za-z_]\w*)\b(?!\s*\()/g)].map(m => m[1]).filter(w => !C_WORDS.has(w));
function cAnalyse(code) {
  const s = stripStrings(code), fns = cFunctions(code);
  let outside = s; fns.forEach(f => { outside = outside.slice(0, f.hs) + ' '.repeat(f.bc + 1 - f.hs) + outside.slice(f.bc + 1); });
  const globals = cDecls(outside, 0, outside.length).filter(d => !d.ptr), gNames = new Set(globals.map(g => g.name));
  const macros = new Set([...s.matchAll(/#\s*define\s+([A-Za-z_]\w*)/g)].map(m => m[1]));
  const fnNames = new Set(fns.map(f => f.name));
  for (const f of fns) {
    f.locals = cDecls(s, f.bo + 1, f.bc);
    const own = new Set([...f.params.map(p => p.name), ...f.locals.map(l => l.name)]);
    f.free = [...new Set(cIdents(s.slice(f.bo + 1, f.bc)))].filter(w => !own.has(w) && !gNames.has(w) && !fnNames.has(w) && !macros.has(w));
  }
  return { fns, globals, gNames };
}
// The dynamically scoped version of a program (null if there's nothing to change or it can't be done safely).
function cDynamicScope(code) {
  const { fns, globals, gNames } = cAnalyse(code);
  if (!fns.length) return null;
  const typeOf = {};
  globals.forEach(g => { typeOf[g.name] = g.type; });
  fns.forEach(f => { f.params.forEach(p => { if (!p.ptr) typeOf[p.name] = typeOf[p.name] || p.type; }); f.locals.forEach(l => { if (!l.ptr && !l.isStatic) typeOf[l.name] = typeOf[l.name] || l.type; }); });
  // Names bound dynamically: globals that some function re-declares, and names a function uses without declaring them.
  const declaredIn = n => fns.some(f => f.params.some(p => p.name === n && !p.ptr) || f.locals.some(l => l.name === n && !l.isStatic && !l.ptr));
  const usedFree = n => fns.some(f => f.free.includes(n));
  const D = new Set([...Object.keys(typeOf)].filter(n => declaredIn(n) && (gNames.has(n) || usedFree(n))));
  if (!D.size) return null;
  const missing = [...D].filter(n => !gNames.has(n));
  if (fns.some(f => f.free.some(n => !D.has(n) && !typeOf[n]))) return null;   // a name nobody declares: not something we can run
  let out = code;
  for (const f of fns.slice().sort((a, b) => b.bo - a.bo)) {
    const shadowP = f.params.filter(p => D.has(p.name) && !p.ptr), shadowL = f.locals.filter(l => D.has(l.name) && !l.isStatic && !l.ptr);
    const names = [...new Set([...shadowP, ...shadowL].map(x => x.name))];
    if (!names.length) continue;
    const restore = names.slice().reverse().map(n => `${n} = __sv_${n};`).join(' ');
    const isVoid = /^void$/.test(f.ret);
    let body = out.slice(f.bo + 1, f.bc);
    const sb = stripStrings(body);
    // declarations → assignments (other declarators on the same line stay declarations)
    const edits = [];
    const byStmt = {};
    for (const l of shadowL) (byStmt[l.start] = byStmt[l.start] || { start: l.start - f.bo - 1, end: l.end - f.bo - 1, ls: [] }).ls.push(l);
    for (const st of Object.values(byStmt)) {
      const all = cDecls(sb, st.start, st.end).filter(d => d.start - 0 === st.start);
      const keep = all.filter(d => !st.ls.some(l => l.name === d.name)), type = all[0] ? all[0].type : 'int';
      const assigns = st.ls.map(l => `${l.name} = ${l.init != null ? l.init : 0};`).join(' ');
      edits.push({ a: st.start, b: st.end, text: (keep.length ? `${type} ${keep.map(d => d.raw.trim()).join(', ')}; ` : '') + assigns });
    }
    // returns → restore first
    for (const m of sb.matchAll(/\breturn\b([^;]*);/g)) {
      const e = body.slice(m.index + 6, m.index + m[0].length - 1).trim();
      edits.push({ a: m.index, b: m.index + m[0].length, text: isVoid || !e ? `{ ${restore} return; }` : `{ __ret = (${e}); ${restore} return __ret; }` });
    }
    edits.sort((x, y) => y.a - x.a).forEach(e => { body = body.slice(0, e.a) + e.text + body.slice(e.b); });
    const prologue = names.map(n => `${typeOf[n]} __sv_${n} = ${n};`).join(' ') + ' ' + shadowP.map(p => `${p.name} = __p_${p.name};`).join(' ') + (isVoid ? '' : ` ${f.ret} __ret;`);
    let header = out.slice(f.hs, f.bo);
    for (const p of shadowP) header = header.replace(new RegExp(`\\b${p.name}\\b(?=\\s*(\\[\\s*\\])?\\s*[,)])`), `__p_${p.name}`);
    out = out.slice(0, f.hs) + header + '{ ' + prologue + body + ' ' + restore + ' ' + out.slice(f.bc);
  }
  if (missing.length) {
    const first = Math.min(...fns.map(f => f.hs));
    out = out.slice(0, first) + missing.map(n => `${typeOf[n]} ${n};`).join(' ') + '   /* bound dynamically */\n' + out.slice(first);
  }
  return out;
}
const scopingAsked = q => {
  const s = q.replace(/\n\s*\(?[A-D][).][^\n]*/g, '');
  // "static scoping", "statically scoped", "static and dynamic scoping", "dynamic vs lexical scoping" …
  const both = /\b(static|lexical|dynamic)(ally)?\s+(and|or|vs\.?|versus|\/)\s+(static|lexical|dynamic)(ally)?\s*(scop|bind)/i.test(s);
  const dyn = both || /\bdynamic(ally)?\s*(scop|bind)/i.test(s), stat = both || /\b(static(ally)?|lexical(ly)?)\s*(scop|bind)/i.test(s);
  const pd = s.search(/\bdynamic/i), ps = s.search(/\b(static|lexical)/i);
  return { dyn, stat: stat || !dyn, order: dyn && stat && pd >= 0 && ps >= 0 && pd < ps ? ['dynamic', 'static'] : ['static', 'dynamic'] };
};
// Which option says exactly what was printed (spacing, commas and quotes ignored; else the same numbers in order).
function optionForOutput(out, q) {
  const opts = optionsIn(q), canon = s => String(s).replace(/\$|\\text\{|\}/g, '').replace(/[\s,;"'`]/g, '').toLowerCase(), nums = s => (String(s).match(/-?\d+(\.\d+)?/g) || []).join(' ');
  let hit = Object.keys(opts).filter(L => canon(opts[L]) === canon(out));
  if (hit.length !== 1 && nums(out)) hit = Object.keys(opts).filter(L => nums(opts[L]) === nums(out));
  return hit.length === 1 ? hit[0] : null;
}
async function cRunner(q, signal) {
  if (!(/\b(printf|print|main\s*\(|#include|return\s+[^;]+;)/.test(q) && /[{}]/.test(q)) && !looksPseudo(q)) return null;
  if (!(await ccInfo()).available) return null;
  const given = cCodeIn(q);
  if (given.length < 20) return null;
  let program = given;
  if (!/\bmain\s*\(/.test(given) && !looksPseudo(given)) {
    // A function only ("what does f(5) return?"): the model writes main() around it; the given code must stay verbatim.
    const j = parseJSON(await ollamaChat([
      { role: 'system', content: 'The question gives C code without main(). Write a complete C program: the given code copied EXACTLY (do not change a single character), then a main() that does precisely what the question asks and prints the asked value with printf (just the value). Return JSON.' },
      { role: 'user', content: q.slice(0, 5000) },
    ], { signal, model: checkModel(), temperature: 0, maxTokens: 1500, format: { type: 'object', required: ['program'], properties: { program: { type: 'string' } } } }));
    program = String(j.program || '');
    const norm = s => s.replace(/\s+/g, '');
    if (!norm(program).includes(norm(given))) program = given;   // not C as given (pseudo-code?): the converter below takes over
  }
  const ask = scopingAsked(q);
  let res = await runScoped(program, ask), converted = false;
  if (!res.ok) {
    // Pseudo-code ("print x", "begin … end") or not-quite-C: the model converts the syntax only, and the result is used
    // only if every number and every name of the original is still there, in the same order.
    const conv = await pseudoToC(program, q, signal);
    if (conv) { const r2 = await runScoped(conv, ask); if (r2.ok) { res = r2; program = conv; converted = true; } }
  }
  if (!res.ok) { console.warn('c runner', res.error); return null; }
  const parts = (ask.dyn && ask.stat ? ask.order : [ask.dyn ? 'dynamic' : 'static']).map(k => ({ k, ...res[k] }));
  const text = parts.length > 1 ? parts.map(p => `${p.k} scoping: ${p.out || p.err}`).join(' · ') : parts[0].out;
  const joined = parts.map(p => p.out || '').join(' ').trim();
  const opt = optionForOutput(joined, q), num = parts.length === 1 && /^-?\d+(\.\d+)?$/.test(joined) ? +joined : null;
  const show = (title, code, p) => `**${title}**\n\n\`\`\`c\n${code}\n\`\`\`\n\nOutput:\n\n\`\`\`\n${p.out || p.err || '(nothing printed)'}\n\`\`\``;
  const steps = [`Compiled and ran with ${escapeHtml(res.compiler || 'gcc')} (32-bit int, 64-bit pointers)${converted ? '. The question\'s pseudo-code was converted to C first (syntax only; every name and number was checked to be unchanged)' : ''}:`,
    ...parts.map(p => p.k === 'dynamic'
      ? show(res.dynamic.same ? 'Dynamic scoping (no variable is re-bound by a caller, so it behaves like static scoping)' : 'Dynamic scoping: the same program rewritten so each name refers to the most recent binding in the call chain', res.dynamic.program, p)
      : show(ask.dyn ? 'Static (lexical) scoping: the program as C runs it' : 'The program', withIncludes(program), p))].join('\n\n');
  return { solver: 'c', name: `C program run (${res.compiler || 'gcc'})${ask.dyn && ask.stat ? ', static and dynamic scoping' : ask.dyn ? ', dynamic scoping' : ''}`, params: { program: program.length > 400 ? program.slice(0, 400) + '…' : program, scoping: parts.map(p => p.k).join(' + ') },
    value: opt || num || joined, text: opt ? `${opt} (${text})` : text, steps };
}
const withIncludes = p => /#include\s*<stdio\.h>/.test(p) ? p : '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n' + p;
// Runs the program with static scoping (as C does) and, when asked, with dynamic scoping.
async function runScoped(program, ask) {
  const out = { ok: false };
  const run = async code => { const r = await runC(withIncludes(code)); out.compiler = r.compiler || out.compiler; return r.ok ? { out: String(r.stdout || '').trim() } : { err: r.compileError ? 'does not compile' : r.error, detail: r.compileError || r.error }; };
  out.static = await run(program);
  if (ask.dyn) {
    const dp = cDynamicScope(program);
    out.dynamic = dp ? { ...(await run(dp)), program: withIncludes(dp) } : out.static.out != null ? { ...out.static, program: withIncludes(program), same: true } : { err: 'could not be rewritten for dynamic scoping' };
  }
  // Under static scoping a name used but declared only in a caller is a compile error: that is a real answer then.
  if (ask.dyn && out.static.err === 'does not compile' && out.dynamic && out.dynamic.out != null) out.static = { err: 'compile error under static scoping (a name is not declared where it is used)' };
  const need = (ask.dyn && ask.stat ? ['static', 'dynamic'] : [ask.dyn ? 'dynamic' : 'static']);
  out.ok = need.every(k => out[k] && (out[k].out || (k === 'static' && ask.dyn && out[k].err && out.dynamic.out)));
  out.error = need.map(k => out[k] && (out[k].detail || out[k].err)).filter(Boolean).join(' / ');
  return out;
}
// Pascal/ALGOL-style GATE pseudo-code → C, by fixed rules (no model): var/integer declarations, procedure/function
// headers with their local declarations, begin/end blocks (the last top-level one is main), := assignments,
// if … then / else / while … do, print/write, and procedure calls with or without "call". Null if a line doesn't fit.
function pseudoToCDet(src, opts = {}) {
  const lines = stripStrings(src).split('\n').map(l => l.replace(/\/\/.*$|\{\*[\s\S]*?\*\}/g, '').trim()).filter(Boolean);
  const procs = new Set(lines.map(l => (l.match(/^(?:procedure|function|proc)\s+(\w+)/i) || [])[1]).filter(Boolean));
  const T = t => /real|float/i.test(t) ? 'float' : /char/i.test(t) ? 'char' : 'int';
  const expr = e => e.replace(/<>/g, '!=').replace(/\band\b/gi, '&&').replace(/\bor\b/gi, '||').replace(/\bnot\b/gi, '!').replace(/\bdiv\b/gi, '/').replace(/\bmod\b/gi, '%').replace(/:=/g, '=')
    .replace(/\b(\w+)\b(?!\s*\()/g, (m, w) => procs.has(w) ? `${w}()` : m);
  const cond = e => expr(e).replace(/(?<![<>!=])=(?!=)/g, '==');
  // Pascal "var" parameters are by reference: written "&x" for the interpreter (GCC can't run those).
  const params = p => !p ? '' : p.split(/;/).flatMap(g => { const m = g.match(/^\s*(var\s+)?([\w\s,]+?)\s*:\s*(\w+)\s*$/i); return m ? m[2].split(',').map(n => `${T(m[3])} ${m[1] && opts.refParams ? '&' : ''}${n.trim()}`) : [g.trim().replace(/:=/g, '=')]; }).join(', ');
  const out = [], stack = [];
  for (let raw of lines) {
    let l = raw.replace(/;\s*$/, '').replace(/\.$/, '').trim(), m;
    if (!l) continue;
    if ((m = l.match(/^(?:var\s+)?(\w+(?:\s*,\s*\w+)*)\s*:\s*(integer|int|real|float|char|boolean)\s*(?:(?::=|=)\s*(.+))?$/i))) {
      out.push(`${T(m[2])} ${m[1].split(',').map(n => n.trim() + (m[3] != null ? ` = ${expr(m[3])}` : '')).join(', ')};`); continue;
    }
    if ((m = l.match(/^(?:var\s+)?(integer|int|real|float|char)\s+(.+)$/i))) { out.push(`${T(m[1])} ${expr(m[2])};`); continue; }
    if ((m = l.match(/^(?:procedure|function|proc)\s+(\w+)\s*(?:\((.*)\))?\s*(?::\s*(\w+))?$/i))) {
      out.push(`${m[3] ? T(m[3]) : /^function/i.test(l) ? 'int' : 'void'} ${m[1]}(${params(m[2])}) {`); stack.push({ k: 'proc', name: m[1], awaitBegin: true }); continue;
    }
    if (/^begin$/i.test(l)) {
      const top = stack[stack.length - 1];
      if (top && top.k === 'proc' && top.awaitBegin) { top.awaitBegin = false; continue; }
      if (!stack.length) { out.push('int main() {'); stack.push({ k: 'main' }); } else { out.push('{'); stack.push({ k: 'block' }); }
      continue;
    }
    if (/^(end(\s*(if|while|for|\w+))?|endif|endwhile|fi|od)$/i.test(l)) { const top = stack.pop(); if (!top) return null; out.push(top.k === 'main' ? 'return 0; }' : '}'); continue; }
    if ((m = l.match(/^if\s+(.+?)\s+then\s+(.+?)(?:\s+else\s+(.+))?$/i)) && !/^begin$/i.test(m[2])) { out.push(`if (${cond(m[1])}) { ${stmt(m[2])} }${m[3] ? ` else { ${stmt(m[3])} }` : ''}`); continue; }
    if ((m = l.match(/^if\s+(.+?)\s+then(\s+begin)?$/i))) { out.push(`if (${cond(m[1])}) {`); stack.push({ k: 'if' }); continue; }
    if ((m = l.match(/^else(\s+begin)?$/i))) { const top = stack[stack.length - 1]; if (top && top.k === 'if') out.push('} else {'); else { out.push('else {'); stack.push({ k: 'block' }); } continue; }
    if ((m = l.match(/^while\s+(.+?)\s+do(\s+begin)?$/i))) { out.push(`while (${cond(m[1])}) {`); stack.push({ k: 'while' }); continue; }
    const s = stmt(l);
    if (s == null) return null;
    out.push(s);
  }
  if (stack.length) return null;
  return out.join('\n');
  function stmt(l) {
    let m;
    l = l.replace(/;\s*$/, '').trim();
    if ((m = l.match(/^(?:print|write|writeln|output|display)\s*\(?\s*(.*?)\s*\)?$/i))) return m[1].split(',').map(a => `printf("%d ", ${expr(a.trim())});`).join(' ');
    if ((m = l.match(/^call\s+(\w+)\s*(\(.*\))?$/i)) || ((m = l.match(/^(\w+)\s*(\(.*\))?$/)) && procs.has(m[1]))) return `${m[1]}${m[2] ? expr(m[2]) : '()'};`;
    if ((m = l.match(/^return\b\s*(.*)$/i))) return `return ${expr(m[1])};`.replace('return ;', 'return;');
    if ((m = l.match(/^(\w+(?:\[[^\]]*\])?)\s*(?::=|←|<-|=)\s*(.+)$/))) {
      const fn = stack.slice().reverse().find(x => x.k === 'proc');
      if (fn && fn.name === m[1]) return `return ${expr(m[2])};`;   // Pascal: assigning to the function name sets its result
      return `${m[1]} = ${expr(m[2])};`;
    }
    if (/[{};]$/.test(l) || /^(int|void|printf|for|if|while)\b/.test(l)) return expr(l);   // already C
    return null;
  }
}
// Pseudo-code → C, syntax only. Accepted only if the original's numbers appear in the same order and every name survives.
async function pseudoToC(code, q, signal) {
  const det = pseudoToCDet(code);
  if (det && pseudoKeeps(code, det)) return det;
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'Rewrite this program from a GATE question as a complete C program. Change ONLY the syntax: keep every variable and function name, every number, every statement and their order exactly. "print x" or "write(x)" becomes printf("%d ", x). Do not fix, simplify or add logic, and do not add declarations for variables a function uses without declaring them (they may be meant for dynamic scoping). Add #include <stdio.h>. Return JSON.' },
    { role: 'user', content: `Question:\n${q.slice(0, 3000)}\n\nProgram to rewrite:\n${code}` },
  ], { signal, model: checkModel(), temperature: 0, maxTokens: 2000, format: { type: 'object', required: ['program'], properties: { program: { type: 'string' } } } }));
  const c = String(j.program || '').replace(/^```\w*\s*|```\s*$/g, '');
  return c.includes('{') && pseudoKeeps(code, c) ? c : null;
}
// The conversion kept the program: the original's numbers appear in the same order (a few added, e.g. "return 0"),
// and every name of the original is still there.
function pseudoKeeps(code, c) {
  const nums = s => (stripStrings(s).replace(/#include[^\n]*/g, '').match(/\b\d+(\.\d+)?\b/g) || []);
  const a = nums(code), b = nums(c);
  let k = 0; for (const x of b) if (k < a.length && x === a[k]) k++;
  if (k < a.length || b.length > a.length + 3) return false;
  const skip = new Set(['begin', 'end', 'print', 'write', 'writeln', 'output', 'display', 'procedure', 'proc', 'function', 'var', 'then', 'do', 'call', 'program', 'integer', 'real', 'boolean', 'endif', 'endwhile', 'fi', 'od', 'and', 'or', 'not', 'div', 'mod', 'printf']);
  const names = [...new Set((stripStrings(code).match(/\b[A-Za-z_]\w*\b/g) || []).filter(w => !skip.has(w.toLowerCase()) && !C_WORDS.has(w)))];
  return names.every(n => new RegExp(`\\b${n}\\b`).test(c));
}

// ======================= Boolean expressions =======================
// Grammar: or := xor ('+' xor)* ; xor := and (('⊕'|'^'|'⊙') and)* ; and := not (('.'|'·'|'*'|implicit) not)* ;
// not := ('~'|'¬'|'!') not | atom ("'")* ; atom := var | 0 | 1 | '(' or ')'.  Variables: one letter, optional digits.
function boolNormalize(s) {
  let t = String(s).replace(/\$/g, '').replace(/\\overline\s*\{([^{}]*)\}/g, '~($1)').replace(/\\bar\s*\{([^{}]*)\}/g, '~($1)').replace(/\\bar\s*([A-Za-z])/g, '~$1')
    .replace(/\\(?:cdot|land|wedge)/g, '.').replace(/\\(?:lor|vee)/g, '+').replace(/\\oplus/g, '⊕').replace(/\\odot/g, '⊙').replace(/\\(?:neg|lnot|sim)/g, '~')
    .replace(/[’′`]/g, "'").replace(/\b([A-Za-z])_\{?(\d+)\}?/g, '$1$2').replace(/[{}]/g, '').replace(/\s+/g, '');
  return t;
}
function boolParse(src) {
  const s = boolNormalize(src); let i = 0;
  const vars = new Set();
  const peek = () => s[i];
  function or() { let n = xor(); while (peek() === '+' || peek() === '|' || peek() === '∨') { i++; const r = xor(), l = n; n = e => l(e) || r(e); } return n; }
  function xor() { let n = and(); while (peek() === '⊕' || peek() === '^' || peek() === '⊙') { const op = s[i++], r = and(), l = n; n = op === '⊙' ? e => l(e) === r(e) : e => l(e) !== r(e); } return n; }
  function and() {
    let n = not();
    for (;;) {
      if (peek() === '.' || peek() === '·' || peek() === '*' || peek() === '&' || peek() === '∧') { i++; }
      else if (!(peek() && /[A-Za-z01(~¬!]/.test(peek()))) break;
      const r = not(), l = n; n = e => l(e) && r(e);
    }
    return n;
  }
  function not() {
    if (peek() === '~' || peek() === '¬' || peek() === '!') { i++; const a = not(); return e => !a(e); }
    let a = atom();
    while (peek() === "'") { i++; const b = a; a = e => !b(e); }
    return a;
  }
  function atom() {
    const c = peek();
    if (c === '(') { i++; const n = or(); if (peek() !== ')') throw new Error('missing )'); i++; return n; }
    if (c === '0' || c === '1') { i++; const v = c === '1'; return () => v; }
    const m = s.slice(i).match(/^[A-Za-z]\d*/);
    if (!m) throw new Error(`unexpected "${c || 'end'}"`);
    i += m[0].length; vars.add(m[0]); const v = m[0];
    return e => e[v];
  }
  const f = or();
  if (i < s.length) throw new Error(`unexpected "${s[i]}"`);
  return { f, vars: [...vars] };
}
function boolTable(exprs) {
  const ps = exprs.map(boolParse), vars = [...new Set(ps.flatMap(p => p.vars))].sort();
  if (vars.length > 10) throw new Error('too many variables');
  const rows = 1 << vars.length;
  return ps.map(p => { let bits = ''; for (let r = 0; r < rows; r++) { const e = {}; vars.forEach((v, k) => { e[v] = !!(r >> (vars.length - 1 - k) & 1); }); bits += p.f(e) ? '1' : '0'; } return bits; }).concat([vars]);
}
function looksBoolean(t) { return /^[A-Za-z0-9\s'’+.·()~¬⊕⊙^*\\{}$_]+$/.test(String(t).trim()) && /[A-Za-z]/.test(t) && !/\b[A-Za-z]{3,}\b/.test(boolNormalize(t).replace(/\\[a-z]+/g, '')); }
async function boolRunner(q, signal) {
  const opts = optionsIn(q), letters = Object.keys(opts);
  if (letters.length < 2 || !letters.every(L => looksBoolean(opts[L]))) return null;
  if (!/\b(equivalent|equal|equals|same as|simplif\w*|minimi[sz]\w*|represents?|function|expression|reduces? to)\b/i.test(q)) return null;
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'Copy the Boolean expression that the options are compared with (the given function F), exactly as printed in the question. If the function is only given as minterms or a table, return "". Return JSON.' },
    { role: 'user', content: q.slice(0, 3000) },
  ], { signal, model: checkModel(), temperature: 0, maxTokens: 200, format: { type: 'object', required: ['expression'], properties: { expression: { type: 'string' } } } }));
  const target = String(j.expression || '').replace(/^\s*[A-Za-z]\w*\s*(\([^)]*\))?\s*=\s*/, '');
  if (!target || !inQuestion(target, q)) return null;
  let t;
  try { t = boolTable([target, ...letters.map(L => opts[L])]); } catch { return null; }
  const vars = t.pop(), base = t[0], same = letters.filter((L, k) => t[k + 1] === base);
  const notQ = /\bnot\s+(equivalent|equal)|\bis\s+not\b|\bNOT\b/.test(q);
  const pick = notQ ? letters.filter(L => !same.includes(L)) : same;
  if (!pick.length || pick.length === letters.length) return null;
  return { solver: 'bool', name: 'Truth-table check', params: { function: target, variables: vars.join(', ') }, value: pick.join(', '), text: pick.join(', '),
    steps: `Truth table over ${vars.join(', ')} (rows ${'0'.repeat(vars.length)} … ${'1'.repeat(vars.length)}):\n\n| | output column |\n|---|---|\n| given | \`${base}\` |\n` + letters.map((L, k) => `| (${L}) ${opts[L]} | \`${t[k + 1]}\` ${t[k + 1] === base ? '✓ same' : '✗ differs'} |`).join('\n') };
}

// ======================= Regular expressions =======================
// GATE notation: + is union, juxtaposition is concatenation, * star (also ^*), ε / ∅. Thompson NFA → subset DFA.
function reNormalize(s) {
  return String(s).replace(/\$/g, '').replace(/\\epsilon|\\varepsilon/g, 'ε').replace(/\\emptyset|\\phi|\\varnothing/g, '∅').replace(/\^\s*\{?\s*\*\s*\}?/g, '*').replace(/\^\s*\{?\s*\+\s*\}?/g, '⁺')
    .replace(/\\cup|∪|\|/g, '+').replace(/\\cdot|·|\./g, '').replace(/[{}\\]/g, '').replace(/\s+/g, '');
}
function reParse(src) {
  const s = reNormalize(src); let i = 0, id = 0;
  const node = () => ({ id: id++, eps: [], on: {} });
  const frag = (st, en) => ({ st, en });
  const sym = c => { const a = node(), b = node(); a.on[c] = [b]; return frag(a, b); };
  const epsF = () => { const a = node(), b = node(); a.eps.push(b); return frag(a, b); };
  function union() { let f = cat(); while (s[i] === '+') { i++; const g = cat(), a = node(), b = node(); a.eps.push(f.st, g.st); f.en.eps.push(b); g.en.eps.push(b); f = frag(a, b); } return f; }
  function cat() { let f = null; while (i < s.length && s[i] !== '+' && s[i] !== ')') { const g = post(); if (!f) f = g; else { f.en.eps.push(g.st); f = frag(f.st, g.en); } } return f || epsF(); }
  function post() {
    let f = atom();
    while (s[i] === '*' || s[i] === '⁺') {
      const plus = s[i++] === '⁺', a = node(), b = node();
      a.eps.push(f.st); if (!plus) a.eps.push(b); f.en.eps.push(f.st, b); f = frag(a, b);
    }
    return f;
  }
  function atom() {
    const c = s[i];
    if (c === '(') { i++; const f = union(); if (s[i] !== ')') throw new Error('missing )'); i++; return f; }
    if (c === 'ε') { i++; return epsF(); }
    if (c === '∅') { i++; const a = node(), b = node(); return frag(a, b); }
    if (c && /[A-Za-z0-9]/.test(c)) { i++; return sym(c); }
    throw new Error(`unexpected "${c || 'end'}"`);
  }
  const f = union();
  if (i < s.length) throw new Error(`unexpected "${s[i]}"`);
  return f;
}
function reClosure(set) { const st = [...set], seen = new Set(set); while (st.length) { const n = st.pop(); for (const m of n.eps) if (!seen.has(m)) { seen.add(m); st.push(m); } } return seen; }
function reAlphabet(f) { const al = new Set(), seen = new Set([f.st]), st = [f.st]; while (st.length) { const n = st.pop(); for (const [c, ts] of Object.entries(n.on)) { al.add(c); ts.forEach(t => { if (!seen.has(t)) { seen.add(t); st.push(t); } }); } n.eps.forEach(t => { if (!seen.has(t)) { seen.add(t); st.push(t); } }); } return al; }
function reMatch(f, str) {
  let cur = reClosure([f.st]);
  for (const c of str) { const nx = []; cur.forEach(n => (n.on[c] || []).forEach(t => nx.push(t))); cur = reClosure(nx); if (!cur.size) return false; }
  return cur.has(f.en);
}
// Exact equivalence: walk both DFAs (built on the fly) together; any reachable pair that disagrees on acceptance → different.
function reEquivalent(a, b, alphabet) {
  const key = s => [...s].map(n => n.id).sort((x, y) => x - y).join(',');
  const step = (set, c) => { const nx = []; set.forEach(n => (n.on[c] || []).forEach(t => nx.push(t))); return reClosure(nx); };
  const start = [reClosure([a.st]), reClosure([b.st])], seen = new Set([key(start[0]) + '|' + key(start[1])]), q = [[...start, '']];
  while (q.length) {
    const [x, y, w] = q.shift();
    if (x.has(a.en) !== y.has(b.en)) return { same: false, witness: w };
    for (const c of alphabet) { const nx = step(x, c), ny = step(y, c), k = key(nx) + '|' + key(ny); if (!seen.has(k)) { seen.add(k); q.push([nx, ny, w + c]); } }
    if (seen.size > 20000) throw new Error('too big');
  }
  return { same: true };
}
const looksRegex = t => { const n = reNormalize(t); return n.length > 0 && /^[A-Za-z0-9()+*⁺ε∅]+$/.test(n) && /[*+()]/.test(n); };
const looksString = t => /^\s*(ε|\\epsilon|[A-Za-z0-9]{1,30})\s*$/.test(String(t).replace(/\$/g, ''));
async function regexRunner(q, signal) {
  if (!/\b(regular expressions?|regex(es)?|r\s*=|L\s*\(|language|denote|generated|accepted)\b/i.test(q)) return null;
  const opts = optionsIn(q), letters = Object.keys(opts);
  if (letters.length < 2) return null;
  const optRe = letters.every(L => looksRegex(opts[L])), optStr = letters.every(L => looksString(opts[L]));
  if (!optRe && !optStr) return null;
  // Read it straight from the question when there's exactly one regular-expression-looking piece; else ask the model to copy it.
  const stem = q.replace(/\n\s*\(?[A-D][).][^\n]*/g, '');
  const found = [...new Set((stem.match(/\$[^$\n]+\$|[(\w][\w()+*|ε∅^{}·]*[*)][\w()+*|ε∅^{}·]*/g) || []).filter(s => looksRegex(s) && /[*(]/.test(s)))];
  let target = found.length === 1 ? found[0] : '';
  if (!target) {
    const j = parseJSON(await ollamaChat([
      { role: 'system', content: 'Copy the regular expression that the question is about (the one the options are compared with, or that the strings must match), exactly as printed, keeping "+" for union. If there is none (e.g. the language is described in words), return "". Return JSON.' },
      { role: 'user', content: q.slice(0, 3000) },
    ], { signal, model: checkModel(), temperature: 0, maxTokens: 200, format: { type: 'object', required: ['regex'], properties: { regex: { type: 'string' } } } }));
    target = String(j.regex || '').replace(/^\s*[rRL]\w*\s*=\s*/, '');
    if (target && !inQuestion(target, q) && inQuestion(target.replace(/\|/g, '+'), q)) target = target.replace(/\|/g, '+');
  }
  if (!target || !inQuestion(target, q) || !looksRegex(target)) return null;
  let T; try { T = reParse(target); } catch { return null; }
  const notQ = /\bnot\b|\bNOT\b|cannot|does not|doesn't/.test(q.replace(/\n\s*\(?[A-D][).][^\n]*/g, ''));
  const rows = [];
  try {
    for (const L of letters) {
      if (optRe) { const O = reParse(opts[L]); const al = new Set([...reAlphabet(T), ...reAlphabet(O)]); const r = reEquivalent(T, O, al); rows.push({ L, yes: r.same, note: r.same ? 'same language' : `differs on "${r.witness || 'ε'}"` }); }
      else { const w = /ε|epsilon/.test(opts[L]) ? '' : opts[L].replace(/\$/g, '').trim(); const m = reMatch(T, w); rows.push({ L, yes: m, note: m ? 'matches' : 'does not match' }); }
    }
  } catch { return null; }
  const pick = rows.filter(r => notQ ? !r.yes : r.yes).map(r => r.L);
  if (!pick.length || pick.length === letters.length) return null;
  return { solver: 'regex', name: optRe ? 'Regular-expression equivalence (exact)' : 'Regular-expression membership (exact)', params: { regex: target }, value: pick.join(', '), text: pick.join(', '),
    steps: `Built automata for \`${target}\` and ${optRe ? 'each option, then compared the languages exactly (shortest string where they differ shown)' : 'ran each option string through it'}:\n\n` + rows.map(r => `- (${r.L}) \`${opts[r.L]}\`: ${r.note}`).join('\n') };
}

// ======================= Grammars: which strings are generated =======================
function earley(g, toks) {
  const S = Array.from({ length: toks.length + 1 }, () => []), add = (k, it) => { if (!S[k].some(x => x.p === it.p && x.d === it.d && x.o === it.o)) S[k].push(it); };
  g.prods.forEach((p, pi) => { if (p.A === g.start) add(0, { p: pi, d: 0, o: 0 }); });
  for (let k = 0; k <= toks.length; k++) {
    for (let n = 0; n < S[k].length; n++) {
      const it = S[k][n], pr = g.prods[it.p], X = pr.syms[it.d];
      if (X === undefined) S[it.o].forEach(b => { const pb = g.prods[b.p]; if (pb.syms[b.d] === pr.A) add(k, { p: b.p, d: b.d + 1, o: b.o }); });
      else if (g.isNT(X)) { g.prods.forEach((p, pi) => { if (p.A === X) add(k, { p: pi, d: 0, o: k }); }); if (S[k].some(c => g.prods[c.p].A === X && c.d === g.prods[c.p].syms.length && c.o === k)) add(k, { p: it.p, d: it.d + 1, o: it.o }); }
      else if (toks[k] === X) add(k + 1, { p: it.p, d: it.d + 1, o: it.o });
    }
  }
  return S[toks.length].some(it => g.prods[it.p].A === g.start && it.d === g.prods[it.p].syms.length && it.o === 0);
}
function tokenize(g, str) {
  const terms = g.terms.slice().sort((a, b) => b.length - a.length), out = [];
  let s = str.replace(/\s+/g, '');
  while (s) { const t = terms.find(x => s.startsWith(x)); if (!t) return null; out.push(t); s = s.slice(t.length); }
  return out;
}
async function grammarRunner(q, signal) {
  if (!/(->|→|::=)/.test(q) || !/\b(generat|deriv|belong|in the language|accepted by|produced by)\w*/i.test(q)) return null;
  const opts = optionsIn(q), letters = Object.keys(opts);
  if (letters.length < 2 || !letters.every(L => looksString(opts[L]) || /^[\w+*()\s]{1,30}$/.test(opts[L]))) return null;
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'Copy the grammar from this question as productions separated by ";" in the form "S -> a S b | ε ; A -> ...", with the start symbol first, exactly as printed (same symbols). Return JSON.' },
    { role: 'user', content: q.slice(0, 3000) },
  ], { signal, model: checkModel(), temperature: 0, maxTokens: 400, format: { type: 'object', required: ['grammar'], properties: { grammar: { type: 'string' } } } }));
  let g; try { g = parseGrammar(j.grammar); } catch { return null; }
  // Every alternative must be printed in the question.
  if (!String(j.grammar).split(/;|\n/).every(p => p.split(/->|→|::=/)[1] == null || p.split(/->|→|::=/)[1].split('|').every(a => /^\s*(ε|epsilon|eps|λ)?\s*$/i.test(a) || squash(q).includes(squash(a))))) return null;
  const notQ = /\bnot\b|\bNOT\b|cannot/.test(q.replace(/\n\s*\(?[A-D][).][^\n]*/g, ''));
  const rows = [];
  for (const L of letters) {
    const w = /ε|epsilon/.test(opts[L]) ? '' : opts[L].replace(/\$/g, '').trim(), toks = tokenize(g, w);
    rows.push({ L, yes: !!toks && earley(g, toks) });
  }
  const pick = rows.filter(r => notQ ? !r.yes : r.yes).map(r => r.L);
  if (!pick.length || pick.length === letters.length) return null;
  return { solver: 'grammar-member', name: 'Grammar membership (exact parser)', params: { grammar: j.grammar }, value: pick.join(', '), text: pick.join(', '),
    steps: `Parsed each option string with the grammar (Earley parser):\n\n` + rows.map(r => `- (${r.L}) \`${opts[r.L]}\`: ${r.yes ? 'generated' : 'not generated'}`).join('\n') };
}

// ======================= entry point =======================
const Runners = {
  list: [
    { id: 'sql', hint: /\bSELECT\b[\s\S]+\bFROM\b/i, run: sqlRunner },
    { id: 'ra', hint: /σ|π|⋈|÷|\\sigma|\\pi\b|\\bowtie|relational algebra/i, run: (q, s) => raRunner(q, s) },
    { id: 'nfa', hint: /\bnfa\b[\s\S]*\bdfa\b|\bdfa\b[\s\S]*\bnfa\b|subset construction/i, run: (q, s) => nfaRunner(q, s) },
    { id: 'ambiguity', hint: /\bambigu(ous|ity)\b[\s\S]*(->|→|::=)|(->|→|::=)[\s\S]*\bambigu(ous|ity)\b/i, run: (q, s) => ambiguityRunner(q, s) },
    { id: 'ds', hint: /\b(bst|binary search tree|avl|heap|b\+\s*-?\s*tree|stack|queue|binary tree)\b[\s\S]*\b(insert\w*|delet\w*|push\w*|pop\w*|enqueue\w*|dequeue\w*|heapify|traversal|preorder|postorder|inorder)|\b(insert\w*|push\w*|heapify|preorder|inorder|postorder)\b[\s\S]*\b(bst|binary search tree|avl|heap|b\+\s*-?\s*tree|stack|queue|binary tree)\b/i, run: (q, s) => dsRunner(q, s) },
    { id: 'schedule', hint: /\b[rRwW]\s*_?\s*\{?\d\}?\s*\(\s*[A-Za-z]\w*\s*\)[\s\S]*\b[rRwW]\s*_?\s*\{?\d\}?\s*\(|\bread\s*\(\s*T?\d/, run: q => scheduleRunner(q) },
    { id: 'concurrency', hint: /\b(semaphores?|wait\s*\(\s*\w+\s*\)|signal\s*\(\s*\w+\s*\)|interleav\w*|concurrent(ly)?|race condition)\b|\b(processes|threads)\b[\s\S]*\b(shared?|simultaneous(ly)?|in parallel|atomic)\b/i, run: (q, s) => concurRunner(q, s) },
    { id: 'interp', hint: /\b(call|pass(ed)?)[-\s]*by[-\s]*(value[-\s]*result|reference|name|need)\b|copy[-\s]*restore|value[-\s]*result|\bnested\b[\s\S]*\bdynamic(ally)?\s*scop/i, run: (q, s) => interpRunner(q, s) },
    { id: 'c', hint: /\bprintf\s*\(|#include|\bmain\s*\(|\bint\s+\w+\s*\([^)]*\)\s*\{|\b(begin|procedure)\b[\s\S]*\bend\b|\b(static|dynamic)(ally)?\s+scop/i, run: cRunner },
    { id: 'bool', hint: /\b(equivalent|equal|simplif|minimi[sz]|represents?|reduces?)\b/i, run: boolRunner },
    { id: 'regex', hint: /\b(regular expressions?|regex(es)?)\b/i, run: regexRunner },
    { id: 'grammar-member', hint: /(->|→|::=)[\s\S]*\b(generat|deriv|belong|accepted)/i, run: grammarRunner },
  ],
  candidates(q) { return this.list.filter(r => r.hint.test(q)); },
  async answer(question, signal) {
    const q = String(question || '');
    for (const r of this.candidates(q)) {
      try { const out = await r.run(q, signal); if (out) return out; }
      catch (e) { if (e.name === 'AbortError') throw e; console.warn('runner', r.id, e.message); }
    }
    return null;
  },
};

// ======================= the "Run it for real" panel (Solve tab) =======================
const RUN_FORMS = {
  sql: { fields: [['tables', 'Tables: a header line "name(col1, col2, …)", then one row per line (comma separated; NULL for null). Blank line between tables.', 'emp(id, dept, salary)\n1, CS, 100\n2, CS, 200\n3, EE, NULL'], ['query', 'Query', 'SELECT dept, COUNT(*) FROM emp GROUP BY dept;']] },
  c: { fields: [['code', 'C program (with main, or it is added for you if you just print something)', '#include <stdio.h>\nint main() {\n  int a[] = {1, 2, 3, 4}, *p = a;\n  printf("%d\n", *p++ + *++p);\n  return 0;\n}'], ['stdin', 'Input (stdin), optional', '']] },
  bool: { fields: [['exprs', 'One expression per line (A\'B + AB\', ~(A+B), A ⊕ B, x1x2 …)', "A'B + AB'\n(A + B)(A' + B')\nA ⊕ B\nAB + A'B'"]] },
  regex: { fields: [['re', 'Regular expression (+ is union, * star, ε)', '(a+b)*abb'], ['items', 'Other regular expressions to compare, or strings to test, one per line', 'aabb\nabab\n(a+b)*ab(b)\nε']] },
  grammar: { fields: [['g', 'Grammar ("S -> a S b | ε", one rule per line; first rule is the start)', 'S -> a S b | S S | ε'], ['items', 'Strings to test, one per line', 'aabb\nabab\naab']] },
};
function parseTablesText(t) {
  return String(t).trim().split(/\n\s*\n/).map(block => {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean), h = lines[0].match(/^(\w+)\s*\(([^)]*)\)/);
    if (!h) throw new Error(`Start each table with a header like emp(id, name): "${lines[0]}"`);
    return { name: h[1], columns: h[2].split(',').map(s => s.trim()), rows: lines.slice(1).map(l => l.split(/\s*[,|\t]\s*/)) };
  });
}
const RunnerPanel = {
  mount() {
    const sel = $('#runSel');
    if (!sel) return;
    const draw = () => {
      const f = RUN_FORMS[sel.value];
      $('#runForm').innerHTML = f.fields.map(([k, label, ph]) => `<label class="small" style="display:block;margin-top:6px">${escapeHtml(label)}<textarea data-rk="${k}" rows="${k === 'stdin' ? 2 : 6}" style="width:100%;font-family:var(--mono, monospace)" placeholder="${escapeHtml(ph)}"></textarea></label>`).join('')
        + (sel.value === 'c' ? '<p class="small muted" id="ccNote"></p>' : '');
      $('#runOut').innerHTML = ''; $('#runErr').textContent = '';
      if (sel.value === 'c') ccInfo().then(i => { $('#ccNote').innerHTML = i.available ? `Runs with <b>${escapeHtml(i.compiler)}</b> on this laptop (5-second limit, standard headers only).` : 'No C compiler is installed on this laptop, so C programs can\'t be run yet. See the README ("C runner") for a one-line install; the app finds it by itself.'; });
    };
    sel.onchange = draw; draw();
    $('#runGo').onclick = () => this.run().catch(e => { $('#runErr').textContent = e.message; });
  },
  async run() {
    const v = k => { const el = $(`#runForm [data-rk="${k}"]`); return el ? (el.value.trim() || el.placeholder) : ''; };
    $('#runErr').textContent = ''; $('#runOut').innerHTML = '<p class="muted">Running&hellip;</p>';
    const kind = $('#runSel').value;
    let md = '';
    if (kind === 'sql') { const r = await runSql(parseTablesText(v('tables')), v('query')); md = `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}:\n\n${resultMd(r)}`; }
    else if (kind === 'c') {
      if (!(await ccInfo()).available) throw new Error('No C compiler installed (see the note above).');
      let code = v('code'); if (!/#include\s*<stdio\.h>/.test(code)) code = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n' + code;
      const r = await runC(code, $(`#runForm [data-rk="stdin"]`).value);
      if (!r.ok) throw new Error(r.compileError ? 'Compile error: ' + r.compileError : r.error);
      md = `Output (exit code ${r.exit}):\n\n\`\`\`\n${r.stdout || '(nothing printed)'}\n\`\`\``;
    } else if (kind === 'bool') {
      const ex = v('exprs').split('\n').map(s => s.trim()).filter(Boolean), t = boolTable(ex), vars = t.pop();
      const groups = {}; ex.forEach((e, k) => (groups[t[k]] = groups[t[k]] || []).push(e));
      md = `Variables: ${vars.join(', ')}. Output columns for rows ${'0'.repeat(vars.length)} … ${'1'.repeat(vars.length)}:\n\n| Expression | Output | Minterms |\n|---|---|---|\n` + ex.map((e, k) => `| \`${e}\` | \`${t[k]}\` | Σm(${[...t[k]].map((b, i) => b === '1' ? i : null).filter(x => x != null).join(', ')}) |`).join('\n')
        + `\n\n**Equivalent groups:** ${Object.values(groups).map(g => g.map(e => `\`${e}\``).join(' ≡ ')).join(' · ')}`;
    } else if (kind === 'regex') {
      const T = reParse(v('re'));
      md = `\`${v('re')}\`:\n\n` + v('items').split('\n').map(s => s.trim()).filter(Boolean).map(it => {
        if (looksRegex(it)) { const O = reParse(it), r = reEquivalent(T, O, new Set([...reAlphabet(T), ...reAlphabet(O)])); return `- \`${it}\`: ${r.same ? '**same language**' : `different (shortest string in one but not the other: "${r.witness || 'ε'}")`}`; }
        const w = /^(ε|epsilon)$/.test(it) ? '' : it; return `- "${it}": ${reMatch(T, w) ? '**matches**' : 'does not match'}`;
      }).join('\n');
    } else if (kind === 'grammar') {
      const g = parseGrammar(v('g'));
      md = v('items').split('\n').map(s => s.trim()).filter(Boolean).map(it => { const w = /^(ε|epsilon)$/.test(it) ? '' : it, toks = tokenize(g, w); return `- "${it}": ${toks && earley(g, toks) ? '**generated**' : 'not generated'}`; }).join('\n');
    }
    $('#runOut').innerHTML = renderMd(md);
  },
};

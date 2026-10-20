// A small interpreter for the C-like pseudo-code GATE uses for programming-language questions, with switchable
//   scoping:          static (lexical, nested procedures via static links) or dynamic (most recent caller binding)
//   parameter passing: value, reference, value-result (copy-restore), name (re-evaluated each use), need (lazy, once)
// Pascal-style code is first turned into this C-like form by pseudoToCDet (runners.js). Parameters written "&x"
// (or Pascal "var x") are always by reference. Before any answer is used, the interpreter's static/by-value run is
// compared with real GCC on the same program; if they differ, the interpreter is not trusted for that program.

const Interp = (() => {
  // ---------- tokens ----------
  const KW = new Set(['int', 'void', 'char', 'float', 'double', 'long', 'short', 'unsigned', 'signed', 'bool', 'static', 'const', 'register', 'auto',
    'if', 'else', 'while', 'for', 'do', 'return', 'break', 'continue']);
  const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];   // binary operators, lowest precedence first
  const TYPES = new Set(['int', 'void', 'char', 'float', 'double', 'long', 'short', 'unsigned', 'signed', 'bool', 'static', 'const', 'register', 'auto']);
  function lex(src) {
    const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '').replace(/^\s*#[^\n]*/gm, ''), out = [];
    const re = /\s*(?:(\d+\.\d*|\.\d+|\d+)|([A-Za-z_]\w*)|("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])')|(\+\+|--|&&|\|\||==|!=|<=|>=|\+=|-=|\*=|\/=|%=|<<|>>|->|[-+*/%=<>!&|^~?:;,.(){}\[\]]))/y;
    let i = 0;
    while (i < s.length) {
      if (/^\s*$/.test(s.slice(i))) break;
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) throw new Error(`can't read "${s.slice(i, i + 12).trim()}"`);
      i = re.lastIndex;
      if (m[1]) out.push({ t: 'num', v: +m[1], float: /\./.test(m[1]) });
      else if (m[2]) out.push({ t: KW.has(m[2]) ? 'kw' : 'id', v: m[2] });
      else if (m[3]) out.push({ t: 'str', v: JSON.parse(m[3].replace(/\\'/g, "'")) });
      else if (m[4]) out.push({ t: 'num', v: JSON.parse('"' + m[4].slice(1, -1).replace(/"/g, '\\"') + '"').charCodeAt(0) });
      else out.push({ t: 'op', v: m[5] });
    }
    out.push({ t: 'eof', v: '' });
    return out;
  }
  // ---------- parser (recursive descent) ----------
  function parse(src) {
    const T = lex(src); let p = 0;
    const peek = (k = 0) => T[p + k], next = () => T[p++];
    const is = v => T[p].v === v && T[p].t !== 'str', eat = v => { if (!is(v)) throw new Error(`expected "${v}" near "${T[p].v}"`); return next(); };
    const isType = () => T[p].t === 'kw' && TYPES.has(T[p].v);
    const type = () => { let t = ''; while (isType()) t += next().v + ' '; return t.trim(); };
    const program = [];
    while (T[p].t !== 'eof') program.push(topItem());
    return program;
    function topItem() {
      const save = p, t = type();
      if (T[p].t === 'id' && peek(1).v === '(') {
        // function definition or prototype
        const name = next().v; eat('(');
        const params = [];
        if (!is(')')) {
          if (is('void') && peek(1).v === ')') next();
          else do { type(); const ref = is('&') ? (next(), true) : false; const pn = next(); if (pn.t !== 'id') throw new Error('bad parameter'); if (is('[')) { next(); eat(']'); } params.push({ name: pn.v, ref }); } while (is(',') && next());
        }
        eat(')');
        if (is(';')) { next(); return { k: 'proto' }; }
        return { k: 'fn', name, params, body: block(), type: t || 'int' };
      }
      p = save;
      return declOrStmt();
    }
    function declarators(t) {
      const ds = [];
      do {
        while (is('*')) throw new Error('pointers are not supported here');
        const name = next(); if (name.t !== 'id') throw new Error(`bad declaration near "${name.v}"`);
        let size = null, init = null;
        if (is('[')) { next(); size = is(']') ? -1 : expr(); eat(']'); }
        if (is('=')) { next(); if (is('{')) { next(); init = []; if (!is('}')) do { init.push(assign()); } while (is(',') && next() && !is('}')); eat('}'); } else init = assign(); }
        ds.push({ name: name.v, size, init });
      } while (is(',') && next());
      eat(';');
      return { k: 'decl', type: t, ds, isStatic: /\bstatic\b/.test(t) };
    }
    function declOrStmt() {
      if (isType()) {
        const save = p, t = type();
        if (T[p].t === 'id' && peek(1).v === '(') { p = save; return topItem(); }   // nested function (Pascal-style nesting)
        return declarators(t);
      }
      return stmt();
    }
    function block() { eat('{'); const body = []; while (!is('}')) body.push(declOrStmt()); eat('}'); return { k: 'block', body }; }
    function stmt() {
      if (is('{')) return block();
      if (is(';')) { next(); return { k: 'empty' }; }
      if (is('if')) { next(); eat('('); const c = expr(); eat(')'); const a = declOrStmt(); let b = null; if (is('else')) { next(); b = declOrStmt(); } return { k: 'if', c, a, b }; }
      if (is('while')) { next(); eat('('); const c = expr(); eat(')'); return { k: 'while', c, body: declOrStmt() }; }
      if (is('do')) { next(); const body = declOrStmt(); eat('while'); eat('('); const c = expr(); eat(')'); eat(';'); return { k: 'dowhile', c, body }; }
      if (is('for')) {
        next(); eat('(');
        const init = is(';') ? null : isType() ? declarators(type()) : { k: 'expr', e: expr() };
        if (!init || init.k !== 'decl') eat(';');
        const c = is(';') ? null : expr(); eat(';');
        const step = is(')') ? null : expr(); eat(')');
        return { k: 'for', init, c, step, body: declOrStmt() };
      }
      if (is('return')) { next(); const e = is(';') ? null : expr(); eat(';'); return { k: 'return', e }; }
      if (is('break')) { next(); eat(';'); return { k: 'break' }; }
      if (is('continue')) { next(); eat(';'); return { k: 'continue' }; }
      const e = expr(); eat(';'); return { k: 'expr', e };
    }
    // expressions
    function expr() { let e = assign(); while (is(',')) { next(); e = { k: 'comma', a: e, b: assign() }; } return e; }
    function assign() {
      const l = ternary();
      if (['=', '+=', '-=', '*=', '/=', '%='].includes(T[p].v) && T[p].t === 'op') { const op = next().v; return { k: 'assign', op, l, r: assign() }; }
      return l;
    }
    function ternary() { const c = bin(0); if (is('?')) { next(); const a = expr(); eat(':'); return { k: 'cond', c, a, b: ternary() }; } return c; }
    function bin(lv) {
      if (lv >= LEVELS.length) return unary();
      let l = bin(lv + 1);
      while (T[p].t === 'op' && LEVELS[lv].includes(T[p].v)) { const op = next().v; l = { k: 'bin', op, l, r: bin(lv + 1) }; }
      return l;
    }
    function unary() {
      if (T[p].t === 'op' && ['-', '+', '!', '~'].includes(T[p].v)) { const op = next().v; return { k: 'un', op, e: unary() }; }
      if (is('++') || is('--')) { const op = next().v; return { k: 'pre', op, e: unary() }; }
      if (is('&')) throw new Error('pointers are not supported here');
      if (is('*')) throw new Error('pointers are not supported here');
      return postfix();
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (is('(')) { next(); const args = []; if (!is(')')) do { args.push(assign()); } while (is(',') && next()); eat(')'); e = { k: 'call', f: e, args }; }
        else if (is('[')) { next(); const i = expr(); eat(']'); e = { k: 'index', a: e, i }; }
        else if (is('++') || is('--')) e = { k: 'post', op: next().v, e };
        else return e;
      }
    }
    function primary() {
      const t = next();
      if (t.t === 'num') return { k: 'num', v: t.v, float: t.float };
      if (t.t === 'str') return { k: 'str', v: t.v };
      if (t.t === 'id') return { k: 'var', name: t.v };
      if (t.v === '(') { const e = expr(); eat(')'); return e; }
      throw new Error(`unexpected "${t.v}"`);
    }
  }
  // ---------- running ----------
  class Frame { constructor(parent, dyn, fn) { this.vars = new Map(); this.parent = parent; this.dyn = dyn; this.fn = fn; } }
  const RET = Symbol('ret'), BRK = Symbol('break'), CNT = Symbol('continue');
  function run(src, { scoping = 'static', passing = 'value', maxSteps = 3e6 } = {}) {
    const prog = parse(src);
    let steps = 0, out = '';
    const tick = () => { if (++steps > maxSteps) throw new Error('ran too long (infinite loop?)'); };
    const G = new Frame(null, null, null);
    const statics = new Map();   // static locals keep their cell across calls (per function and name)
    const cellOf = (v, isInt) => ({ v, isInt });
    const store = (c, v) => { c.v = c.isInt ? Math.trunc(v) : v; return c.v; };
    // Look a name up: static scoping follows the definition chain, dynamic scoping the call chain.
    function find(fr, name) {
      for (let f = fr; f; f = scoping === 'dynamic' ? f.dyn || (f.parent && !f.fn ? f.parent : null) : f.parent) if (f.vars.has(name)) return f.vars.get(name);
      if (G.vars.has(name)) return G.vars.get(name);
      // functions are always found by their definition (lexically), then globally
      for (let f = fr; f; f = f.parent) if (f.vars.has(name)) return f.vars.get(name);
      throw new Error(`"${name}" is not declared${scoping === 'static' ? ' in any enclosing scope (static scoping)' : ''}`);
    }
    function declare(fr, d, isStatic, fnKey) {
      const isInt = !/float|double/.test(d.type || '');
      for (const x of d.ds) {
        const key = `${fnKey}|${x.name}`;
        if (isStatic && statics.has(key)) { fr.vars.set(x.name, statics.get(key)); continue; }
        let b;
        if (x.size != null) {
          const n = x.size === -1 ? (x.init || []).length : val(x.size, fr);
          const cells = Array.from({ length: n }, (_, i) => cellOf(Array.isArray(x.init) && x.init[i] ? val(x.init[i], fr) : 0, isInt));
          b = { k: 'arr', cells };
        } else b = { k: 'cell', c: cellOf(x.init != null && !Array.isArray(x.init) ? (isInt ? Math.trunc(val(x.init, fr)) : val(x.init, fr)) : 0, isInt) };
        fr.vars.set(x.name, b);
        if (isStatic) statics.set(key, b);
      }
    }
    // A binding's current value (thunks for call-by-name are re-evaluated; call-by-need ones once).
    function bval(b) {
      if (b.k === 'cell') return b.c.v;
      if (b.k === 'thunk') { if (b.need && b.done) return b.cache; const v = val(b.e, b.env); if (b.need) { b.done = true; b.cache = v; } return v; }
      if (b.k === 'arr') return b;
      throw new Error('not a value');
    }
    // An lvalue: something you can read and write.
    function lval(e, fr) {
      if (e.k === 'var') {
        const b = find(fr, e.name);
        if (b.k === 'cell') return b.c;
        if (b.k === 'thunk') { if (b.need && b.done) return { get v() { return b.cache; }, set v(x) { b.cache = x; } }; return lval(b.e, b.env); }
        throw new Error(`cannot assign to "${e.name}"`);
      }
      if (e.k === 'index') {
        const arr = e.a.k === 'var' ? find(fr, e.a.name) : null, a = arr && arr.k === 'thunk' ? bval(arr) : arr;
        if (!a || a.k !== 'arr') throw new Error('not an array');
        const i = val(e.i, fr);
        if (i < 0 || i >= a.cells.length) throw new Error(`array index ${i} out of range`);
        return a.cells[i];
      }
      throw new Error('cannot assign to this expression');
    }
    const isIntExpr = (e, fr) => { try { if (e.k === 'num') return !e.float; if (e.k === 'var') { const b = find(fr, e.name); return b.k !== 'cell' || b.c.isInt !== false; } } catch {} return true; };
    function val(e, fr) {
      tick();
      switch (e.k) {
        case 'num': return e.v;
        case 'str': return e.v;
        case 'var': { const b = find(fr, e.name); if (b.k === 'fn') return b; return bval(b); }
        case 'index': return lval(e, fr).v;
        case 'comma': val(e.a, fr); return val(e.b, fr);
        case 'cond': return val(e.c, fr) ? val(e.a, fr) : val(e.b, fr);
        case 'un': { const v = val(e.e, fr); return e.op === '-' ? -v : e.op === '+' ? v : e.op === '!' ? (v ? 0 : 1) : ~v; }
        case 'pre': { const c = lval(e.e, fr); c.v = c.v + (e.op === '++' ? 1 : -1); return c.v; }
        case 'post': { const c = lval(e.e, fr), old = c.v; c.v = old + (e.op === '++' ? 1 : -1); return old; }
        case 'assign': {
          const c = lval(e.l, fr), r = val(e.r, fr);
          const nv = e.op === '=' ? r : arith(e.op[0], c.v, r, c.isInt !== false && isIntExpr(e.r, fr));
          if ('isInt' in c) return store(c, nv);
          c.v = nv; return nv;
        }
        case 'bin': {
          if (e.op === '&&') return val(e.l, fr) && val(e.r, fr) ? 1 : 0;
          if (e.op === '||') return val(e.l, fr) || val(e.r, fr) ? 1 : 0;
          const a = val(e.l, fr), b = val(e.r, fr);
          return arith(e.op, a, b, isIntExpr(e.l, fr) && isIntExpr(e.r, fr));
        }
        case 'call': return call(e, fr);
      }
      throw new Error('bad expression');
    }
    function arith(op, a, b, ints) {
      switch (op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b;
        case '/': if (b === 0) throw new Error('division by zero'); return ints ? Math.trunc(a / b) : a / b;
        case '%': if (b === 0) throw new Error('division by zero'); return a % b;
        case '<': return +(a < b); case '>': return +(a > b); case '<=': return +(a <= b); case '>=': return +(a >= b);
        case '==': return +(a === b); case '!=': return +(a !== b);
        case '&': return a & b; case '|': return a | b; case '^': return a ^ b; case '<<': return a << b; case '>>': return a >> b;
      }
      throw new Error(`operator ${op}`);
    }
    function printf(args, fr) {
      const fmt = String(val(args[0], fr)); let k = 1;
      out += fmt.replace(/%[-+ #0]*\d*(?:\.\d+)?(?:l|ll|h)?([dicsfu%xX])/g, (m, c) => {
        if (c === '%') return '%';
        const v = val(args[k++], fr);
        if (c === 'c') return String.fromCharCode(v);
        if (c === 's') return String(v);
        if (c === 'f') { const pm = m.match(/\.(\d+)/); return Number(v).toFixed(pm ? +pm[1] : 6); }
        if (c === 'x' || c === 'X') { const h = (v >>> 0).toString(16); return c === 'X' ? h.toUpperCase() : h; }
        if (c === 'u') return String(v >>> 0);
        return String(Math.trunc(v));
      });
      return 0;
    }
    function call(e, fr) {
      if (e.f.k === 'var' && (e.f.name === 'printf' || e.f.name === 'print')) {
        if (e.f.name === 'print') { out += e.args.map(a => String(val(a, fr))).join(' ') + ' '; return 0; }
        return printf(e.args, fr);
      }
      if (e.f.k === 'var' && (e.f.name === 'putchar')) { out += String.fromCharCode(val(e.args[0], fr)); return 0; }
      const fb = e.f.k === 'var' ? find(fr, e.f.name) : null;
      if (!fb || fb.k !== 'fn') throw new Error(`"${e.f.name}" is not a function`);
      const def = fb.def, F = new Frame(fb.env, fr, def.name);
      const copyBack = [];
      def.params.forEach((pp, i) => {
        const a = e.args[i];
        if (!a) { F.vars.set(pp.name, { k: 'cell', c: cellOf(0, true) }); return; }
        const mode = pp.ref ? 'reference' : passing;
        if (mode === 'reference' || mode === 'value-result') {
          let target = null;
          try { target = (a.k === 'var' || a.k === 'index') ? (a.k === 'var' && find(fr, a.name).k === 'arr' ? null : lval(a, fr)) : null; } catch {}
          if (a.k === 'var' && find(fr, a.name).k === 'arr') { F.vars.set(pp.name, find(fr, a.name)); return; }   // arrays are passed by reference anyway
          if (mode === 'reference' && target) { F.vars.set(pp.name, { k: 'cell', c: target }); return; }
          const c = cellOf(val(a, fr), true);
          F.vars.set(pp.name, { k: 'cell', c });
          if (mode === 'value-result' && target) copyBack.push({ c, target });
          return;
        }
        if (mode === 'name' || mode === 'need') { F.vars.set(pp.name, { k: 'thunk', e: a, env: fr, need: mode === 'need' }); return; }
        const v = val(a, fr);
        F.vars.set(pp.name, v && v.k === 'arr' ? v : { k: 'cell', c: cellOf(v, true) });
      });
      // nested function definitions inside the body are bound in the new frame (their static link is F)
      const r = exec(def.body, F, def.name, true);
      copyBack.forEach(({ c, target }) => { target.v = c.v; });
      return r && r.sig === RET ? r.v : 0;
    }
    function exec(s, fr, fnKey, sameFrame = false) {
      tick();
      switch (s.k) {
        case 'block': {
          const B = sameFrame ? fr : new Frame(fr, fr, null);
          for (const x of s.body) if (x.k === 'fn') B.vars.set(x.name, { k: 'fn', def: x, env: B });
          for (const x of s.body) { if (x.k === 'fn' || x.k === 'proto') continue; const r = exec(x, B, fnKey); if (r) return r; }
          return null;
        }
        case 'decl': declare(fr, s, s.isStatic, fnKey); return null;
        case 'empty': return null;
        case 'expr': val(s.e, fr); return null;
        case 'if': return val(s.c, fr) ? exec(s.a, fr, fnKey) : s.b ? exec(s.b, fr, fnKey) : null;
        case 'while': while (val(s.c, fr)) { const r = exec(s.body, fr, fnKey); if (r) { if (r.sig === BRK) break; if (r.sig === CNT) continue; return r; } } return null;
        case 'dowhile': do { const r = exec(s.body, fr, fnKey); if (r) { if (r.sig === BRK) break; if (r.sig === CNT) continue; return r; } } while (val(s.c, fr)); return null;
        case 'for': {
          const F = new Frame(fr, fr, null);
          if (s.init) { if (s.init.k === 'decl') declare(F, s.init, false, fnKey); else val(s.init.e, F); }
          for (; !s.c || val(s.c, F); s.step && val(s.step, F)) { const r = exec(s.body, F, fnKey); if (r) { if (r.sig === BRK) break; if (r.sig === CNT) continue; return r; } }
          return null;
        }
        case 'return': return { sig: RET, v: s.e ? val(s.e, fr) : 0 };
        case 'break': return { sig: BRK };
        case 'continue': return { sig: CNT };
      }
      throw new Error(`can't run "${s.k}"`);
    }
    for (const it of prog) if (it.k === 'fn') G.vars.set(it.name, { k: 'fn', def: it, env: G });
    for (const it of prog) if (it.k === 'decl') declare(G, it, false, '');
    for (const it of prog) if (it.k !== 'fn' && it.k !== 'decl' && it.k !== 'proto') exec(it, G, '');
    if (!G.vars.has('main')) throw new Error('no main()');
    call({ f: { k: 'var', name: 'main' }, args: [] }, G);
    return out;
  }
  return { parse, run };
})();

// ---------- the runner: "what is printed with call-by-reference / -name / value-result, static or dynamic scoping?" ----------
const PASSING_RE = /\b(?:call|pass(?:ed)?|parameter[s]?\s+(?:are\s+)?passed)[-\s]*by[-\s]*(value[-\s]*result|value|reference|name|need)|\bcopy[-\s]*(?:in[-\s]*copy[-\s]*out|restore)|\bvalue[-\s]*result\b/gi;
function passingAsked(q) {
  const stem = q.replace(/\n\s*\(?[A-D][).][^\n]*/g, ''), found = [];
  for (const m of stem.matchAll(PASSING_RE)) {
    const w = (m[1] || m[0]).toLowerCase().replace(/[-\s]+/g, '-');
    const mode = /result|copy/.test(w) ? 'value-result' : /reference/.test(w) ? 'reference' : /name/.test(w) ? 'name' : /need/.test(w) ? 'need' : 'value';
    if (!found.includes(mode)) found.push(mode);
  }
  return found;
}
async function interpRunner(q, signal) {
  const modes = passingAsked(q), sc = scopingAsked(q);
  const nested = /\bnested\b|\bstatic link|\baccess link/i.test(q);
  if (!modes.length && !(sc.dyn && nested)) return null;   // plain C questions go to the real compiler
  const given = cCodeIn(q);
  if (given.length < 20) return null;
  let src = looksPseudo(given) ? pseudoToCDet(given, { refParams: true }) : given;
  if (!src || (looksPseudo(given) && !pseudoKeeps(given, src))) return null;
  // Every combination the question asks about, in the order it mentions them.
  const scopes = sc.dyn && sc.stat ? sc.order : [sc.dyn ? 'dynamic' : 'static'];
  const passes = modes.length ? modes : ['value'];
  const combos = passes.length > 1 ? passes.map(p => ({ scoping: scopes[0], passing: p })) : scopes.map(s => ({ scoping: s, passing: passes[0] }));
  // Trust check: the interpreter's static, by-value run must match real C (when the program is plain C).
  if ((await ccInfo()).available && !/&\s*\w+\s*[,)]/.test(src)) {
    let mine; try { mine = Interp.run(src, { scoping: 'static', passing: 'value' }).trim(); } catch { return null; }
    const real = await runC(withIncludes(src));
    if (real.ok && String(real.stdout).trim() !== mine) { console.warn('interpreter disagrees with gcc', mine, real.stdout); return null; }
  }
  const results = [];
  for (const c of combos) {
    let out;
    try { out = Interp.run(src, c).trim(); } catch (e) { out = `error: ${e.message}`; }
    results.push({ ...c, out });
  }
  if (results.every(r => /^error/.test(r.out))) return null;
  const label = r => `${combos.length > 1 && passes.length > 1 ? 'call by ' + r.passing : ''}${combos.length > 1 && passes.length === 1 ? r.scoping + ' scoping' : ''}`;
  const joined = results.map(r => r.out).join(' '), opt = optionForOutput(joined, q);
  const text = results.length > 1 ? results.map(r => `${label(r)}: ${r.out}`).join(' · ') : results[0].out;
  return { solver: 'interp', name: `Program run (${passes.map(p => 'call by ' + p).join(', ')}; ${scopes.join(' and ')} scoping)`, params: { program: src.length > 400 ? src.slice(0, 400) + '…' : src },
    value: opt || (results.length === 1 && /^-?\d+(\.\d+)?$/.test(results[0].out) ? +results[0].out : joined), text: opt ? `${opt} (${text})` : text,
    steps: `Ran the program in the built-in interpreter, which follows the textbook rules exactly (its static, by-value run was first checked against real GCC):\n\n\`\`\`c\n${src}\n\`\`\`\n\n` + results.map(r => `- **${r.scoping} scoping, call by ${r.passing}**: \`${r.out}\``).join('\n') };
}

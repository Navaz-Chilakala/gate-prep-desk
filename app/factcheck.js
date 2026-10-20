// Accuracy layer for generated content.
// 1. Grounding: the verified GATE reference (facts.js) and the most relevant pages of YOUR uploaded books
//    (BM25 ranking) go into prompts, so the model teaches from checked facts and your material.
// 2. Fact-check: after a lesson is written, a reviewer lists suspected factual / formula / calculation errors.
//    For each one we gather evidence (reference facts + an internet lookup when online) and get two verdicts:
//    the local model alone, and the local model reading the internet evidence. If they agree, that's the
//    answer; if they disagree (or the local verdict is weak), the local model re-judges with step-by-step
//    thinking on all the evidence. A correction is applied only with confidence ≥ 70; the rest are flagged.
// Every check is logged in hub.factChecks for the accuracy panel in Settings.

// ---------- grounding: your own books (BM25 over every digitized page) ----------
const BookIndex = {
  docs: null, at: 0,
  async load() {
    if (this.docs && Date.now() - this.at < 5 * 60000) return this.docs;
    const docs = [];
    try {
      for (const s of await Store.listSites()) {
        let d; try { d = await Store.getData(s.id); } catch { continue; }
        (d.pages || []).forEach((p, i) => { if (p && p.md && p.md.length > 80) docs.push({ site: s.id, name: s.name, page: i + 1, md: p.md, toks: topicTokens(p.md) }); });
      }
    } catch {}
    const df = {};
    docs.forEach(d => new Set(d.toks).forEach(t => { df[t] = (df[t] || 0) + 1; }));
    this.df = df; this.avg = docs.reduce((a, d) => a + d.toks.length, 0) / Math.max(1, docs.length);
    this.docs = docs; this.at = Date.now();
    return docs;
  },
  async search(query, k = 3) {
    const docs = await this.load(), q = [...new Set(topicTokens(query))];
    if (!docs.length || !q.length) return [];
    const N = docs.length, k1 = 1.4, b = 0.75;
    const scored = docs.map(d => {
      const tf = {}; d.toks.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
      let s = 0, hits = 0;
      for (const t of q) {
        const f = tf[t]; if (!f) continue; hits++;
        const idf = Math.log(1 + (N - this.df[t] + 0.5) / (this.df[t] + 0.5));
        s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * d.toks.length / this.avg));
      }
      return { d, s, cover: hits / q.length };
    }).filter(x => x.cover >= 0.5 && x.s > 2).sort((a, b) => b.s - a.s);
    const seen = new Set(), out = [];   // the same page uploaded twice counts once
    for (const x of scored) { const key = x.d.md.slice(0, 300); if (seen.has(key)) continue; seen.add(key); out.push(x.d); if (out.length >= k) break; }
    return out;
  },
};
async function booksBlock(query, maxChars = 4500) {
  const hits = await BookIndex.search(query, 3);
  if (!hits.length) return { text: '', cites: [] };
  let used = 0; const parts = [], cites = [];
  for (const h of hits) {
    const t = h.md.slice(0, Math.max(600, Math.floor(maxChars / hits.length)));
    if (used + t.length > maxChars) break;
    used += t.length; parts.push(`[${prettyName(h.name)}, p.${h.page}]\n${t}`); cites.push({ name: prettyName(h.name), site: h.site, page: h.page });
  }
  return { text: `\n\nFROM THE STUDENT'S OWN BOOKS (most relevant pages; prefer their terminology, cite as [book, p.N] when you use them):\n${parts.join('\n\n')}`, cites };
}
// Reference facts + your books, as one block for a prompt.
async function groundingFor(query, subject = '') {
  const facts = factsFor(query, 8, subject);
  const books = await booksBlock(query);
  return { text: factsBlock(facts) + books.text, facts, cites: books.cites };
}

// ---------- fact-check ----------
const ISSUE_SCHEMA = { type: 'object', required: ['issues'], properties: { issues: { type: 'array', items: { type: 'object', required: ['quote', 'problem', 'fix', 'kind'], properties: {
  quote: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'formula', 'calculation', 'definition', 'contradiction'] } } } } } };
const VERDICT_SCHEMA = { type: 'object', required: ['winner', 'confidence', 'why'], properties: {
  winner: { type: 'string', enum: ['original', 'fix', 'unsure'] }, confidence: { type: 'integer' }, why: { type: 'string' } } };

// Finds the quote in the text even if spacing/markdown differs slightly. Returns [start, end] or null.
function locate(md, quote) {
  const q = String(quote || '').trim();
  if (q.length < 8) return null;
  let i = md.indexOf(q);
  if (i >= 0) return [i, i + q.length];
  // whitespace-insensitive search
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const m = md.match(new RegExp(esc));
  return m ? [m.index, m.index + m[0].length] : null;
}
// ---- exact checks (no model): arithmetic written out in the text, and worked examples the solvers cover ----
// "0.8 × 120 + 0.2 × 220 = 150" → recompute the left side. Returns { ok: true|false|null, computed }.
function arithmeticCheck(text) {
  const t = plainText(String(text)).replace(/\\times|×|·|\\cdot/g, '*').replace(/÷|\\div/g, '/').replace(/−|–/g, '-').replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))');
  const re = /((?:\(?\s*-?\d+(?:\.\d+)?\s*\)?\s*[-+*/^]\s*)+\(?\s*-?\d+(?:\.\d+)?\s*\)?)\s*=\s*(-?\d+(?:\.\d+)?)(?!\s*[-+*/^]\s*\d)/g;
  let m, any = false, bad = null;
  while ((m = re.exec(t))) {
    let v; try { v = calcEval(m[1]); } catch { continue; }
    if (!Number.isFinite(v)) continue;
    any = true;
    const stated = parseFloat(m[2]), tol = Math.max(0.011, Math.abs(v) * 0.005);
    if (Math.abs(v - stated) > tol) bad = { expr: m[1].trim(), stated, computed: +v.toPrecision(10) };
  }
  return bad ? { ok: false, computed: bad.computed, expr: bad.expr } : { ok: any ? true : null };
}
// A statement that states the result of a worked example the exact solvers can compute ("FIFO causes 9 faults").
async function solverCheck(text, signal) {
  if (!Solvers.candidates(text).length) return { ok: null };
  let s = null;
  try { s = await Solvers.answer(text, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
  if (!s || typeof s.value !== 'number') return { ok: null };
  const nums = (plainText(text).match(/-?\d+(?:\.\d+)?/g) || []).map(Number), last = nums[nums.length - 1];
  if (last == null) return { ok: null };
  const tol = Math.max(0.011, Math.abs(s.value) * 0.005);
  return { ok: Math.abs(last - s.value) <= tol, computed: s.text, solver: s.name };
}
// ---- model check: is ONE statement true? (simpler and more reliable for a small model than "which of two") ----
async function truthCheck(statement, { facts = [], web = [], material = '', signal, think = false } = {}) {
  const evidence = [
    facts.length ? `VERIFIED REFERENCE (always correct):\n${facts.map(f => `[${f.id}] ${f.f}`).join('\n')}` : '',
    web.length ? `INTERNET:\n${web.map((w, i) => `[W${i + 1}] ${w.title}: ${w.text.slice(0, 1800)}`).join('\n\n')}` : '',
    material ? `STUDENT'S MATERIAL:\n${material.slice(0, 2500)}` : '',
  ].filter(Boolean).join('\n\n');
  // A malformed reply is asked again once (with more room); a second one counts as "unsure", never as a failure.
  let j = null;
  for (let attempt = 0; attempt < 2 && !j; attempt++) {
    try {
      j = parseJSON(await ollamaChat([
        { role: 'system', content: `You check ONE statement from a GATE CS lesson. Is it correct? Use the evidence (the verified reference is always right) and careful reasoning; recompute any numbers yourself step by step. Standard GATE conventions apply. "verdict": "true" if the statement is correct, "false" if it is wrong, "unsure" if you cannot tell. "confidence": 0-100. "why": one or two sentences citing [R..]/[W..] or your calculation. Return JSON.` },
        { role: 'user', content: `STATEMENT: ${statement}${evidence ? `\n\n${evidence}` : ''}` },
      ], { signal, model: checkModel(), temperature: 0, think, maxTokens: (think ? 6000 : 400) * (attempt + 1), format: { type: 'object', required: ['verdict', 'confidence', 'why'], properties: { verdict: { type: 'string', enum: ['true', 'false', 'unsure'] }, confidence: { type: 'integer' }, why: { type: 'string' } } } }));
    } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  if (!j) return { verdict: 'unsure', confidence: 0, why: 'The checker gave no usable answer for this statement.' };
  return { verdict: ['true', 'false', 'unsure'].includes(j.verdict) ? j.verdict : 'unsure', confidence: Math.max(0, Math.min(100, +j.confidence || 0)), why: String(j.why || '').slice(0, 400) };
}
// Reviews a lesson (or any teaching text). Returns { md (corrected), items, at }.
async function factCheck(md, { title = '', subject = '', material = '', kind = 'lesson', signal, onStage = () => {} } = {}) {
  const items = [];
  const facts = factsFor(title + '\n' + md.slice(0, 4000), 10, subject);
  onStage('Reviewing it for factual, formula and calculation errors');
  let issues = [];
  try {
    const j = parseJSON(await ollamaChat([
      { role: 'system', content: `You are a strict GATE CS reviewer. Find CLEAR errors in the lesson below: wrong facts, wrong formulas, wrong definitions, arithmetic or calculation mistakes in worked examples (recompute every number), and statements that contradict the verified reference. Ignore style, wording, missing topics and anything debatable. For each error: "quote" = the exact wrong text copied VERBATIM from the lesson (one sentence or formula, at most ~200 characters), "problem" = what is wrong, "fix" = the corrected replacement for exactly that quote (same Markdown/LaTeX style), "kind". If there are no clear errors, return an empty list. At most 6 issues. Return JSON.` },
      { role: 'user', content: `${factsBlock(facts)}${material ? `\n\nSTUDENT'S MATERIAL (the lesson should agree with it):\n${material.slice(0, 4000)}` : ''}\n\nLESSON:\n${md.slice(0, 14000)}` },
    ], { signal, model: checkModel(), temperature: 0, maxTokens: 2500, format: ISSUE_SCHEMA }));
    issues = (j.issues || []).filter(x => x && x.quote && x.fix && x.quote.trim() !== x.fix.trim()).slice(0, 6);
  } catch (e) { if (e.name === 'AbortError') throw e; }
  let out = md;
  const rejects = ((await Store.getHub()).factRejects || []).map(r => fcNorm(r.quote));
  for (let n = 0; n < issues.length; n++) {
    const it = issues[n], loc = locate(out, it.quote);
    const rec = { quote: it.quote.slice(0, 300), fix: it.fix.slice(0, 400), problem: it.problem.slice(0, 300), kind: it.kind, status: 'kept', confidence: 0, decidedBy: '', why: '', web: [] };
    if (!loc) { rec.status = 'not-found'; items.push(rec); continue; }
    // You already said this statement is right (you undid a correction of it, or confirmed it): leave it alone.
    if (rejects.includes(fcNorm(it.quote))) { Object.assign(rec, { status: 'kept', decidedBy: 'you, earlier', confidence: 100, why: 'You confirmed this statement before, so the suggested change was not applied.' }); items.push(rec); continue; }
    const claim = out.slice(loc[0], loc[1]);
    const step = s => onStage(`Checking ${n + 1} of ${issues.length}: ${s}`);
    // 1. Exact checks decide on their own when they apply.
    step('recomputing it exactly');
    let exact = arithmeticCheck(claim);
    let exactBy = 'exact recalculation';
    if (exact.ok === null) { const s = await solverCheck(claim, signal); if (s.ok !== null) { exact = s; exactBy = `the exact ${s.solver} calculator`; } }
    if (exact.ok !== null) {
      const fixOk = exact.ok ? null : (arithmeticCheck(it.fix).ok !== false && (await solverCheck(it.fix, signal)).ok !== false);
      Object.assign(rec, { decidedBy: exactBy, confidence: 99 });
      if (exact.ok) { rec.status = 'kept'; rec.why = `Recomputed exactly: the original is right${exact.computed != null ? ` (${exact.computed})` : ''}, so the suggested change was rejected.`; }
      else if (fixOk) { out = out.slice(0, loc[0]) + it.fix + out.slice(loc[1]); rec.status = 'fixed'; rec.why = `Recomputed exactly: ${exact.expr ? `${exact.expr} = ${exact.computed}` : `the answer is ${exact.computed}`}, not ${exact.stated ?? 'what was written'}.`; }
      else { rec.status = 'unsure'; rec.why = `The original is wrong (exact value ${exact.computed}), but the suggested fix doesn't match it either: correct it to ${exact.computed}.`; }
      items.push(rec); continue;
    }
    // 2. Is the original true? Local model with the reference, then the internet, escalating to step-by-step thinking.
    const ev = factsFor(claim + ' ' + it.problem, 4, subject);
    step('local check');
    const local = await truthCheck(claim, { facts: ev, material, signal });
    let web = [];
    if (Web.on()) { step('looking it up online'); web = await Web.search(plainText(claim).slice(0, 160), signal); }
    let final = local, by = ev.length ? 'local model with the reference' : 'local model';
    if (web.length) {
      step('checking against the internet');
      const net = await truthCheck(claim, { facts: ev, web, material, signal });
      rec.local = local; rec.net = net; rec.web = Web.brief(web);
      if (net.verdict === local.verdict && net.verdict !== 'unsure') { final = { ...net, confidence: Math.min(97, Math.round((net.confidence + local.confidence) / 2) + 10) }; by = 'local and internet agree'; }
      else { step('local and internet disagree: thinking it through'); final = await truthCheck(claim, { facts: ev, web, material, signal, think: true }); by = 'deep thinking (local and internet disagreed)'; }
    } else if (local.verdict === 'unsure' || local.confidence < 75) {
      step('not sure yet: thinking it through');
      final = await truthCheck(claim, { facts: ev, material, signal, think: true });
      by = ev.length ? 'deep thinking with the reference' : 'deep thinking';
    }
    let fixV = null;
    if (final.verdict === 'false') { step('checking the correction'); fixV = await truthCheck(it.fix, { facts: ev, web, material, signal }); }
    Object.assign(rec, { decidedBy: by, why: final.why, confidence: final.confidence });
    if (final.verdict === 'false' && final.confidence >= 70 && fixV && fixV.verdict === 'true' && fixV.confidence >= 70) {
      out = out.slice(0, loc[0]) + it.fix + out.slice(loc[1]); rec.status = 'fixed'; rec.confidence = Math.min(final.confidence, fixV.confidence);
      rec.why = fixV.why || rec.why;   // the reasoning that confirmed the correction
    } else if (final.verdict === 'true' && final.confidence >= 60) rec.status = 'kept';
    else { rec.status = 'unsure'; if (fixV && fixV.verdict !== 'true') rec.why += ' The suggested fix could not be confirmed either.'; }
    items.push(rec);
  }
  // Exact passes over the whole text: every written calculation, and every diagram.
  onStage('Recomputing every calculation exactly');
  const sw = arithmeticSweep(out); out = sw.md;
  for (const x of sw.items) if (!items.some(y => y.status === 'fixed' && fcNorm(y.fix).includes(fcNorm(x.quote)))) items.push(x);
  onStage('Checking the diagrams');
  const dg = await checkDiagrams(out, signal); out = dg.md; items.push(...dg.items);
  onStage('Running the C programs');
  const cp = await checkPrograms(out, signal); out = cp.md; items.push(...cp.items);
  const review = { at: new Date().toISOString(), items: items.filter(x => x.status !== 'not-found'), checked: issues.length + sw.items.length + dg.items.length + cp.items.length, facts: facts.length, web: Web.on() };
  await updateHub(h => { h.factChecks = (h.factChecks || []).concat([{ at: review.at, title: title.slice(0, 120), kind, subject, items: review.items.map(x => ({ status: x.status, confidence: x.confidence, decidedBy: x.decidedBy, kind: x.kind, agree: x.local && x.net ? x.local.verdict === x.net.verdict : null })) }]).slice(-300); });
  return { md: out, review };
}
// In a rendered lesson card, underline the paragraphs / bullets the checker could not verify (status "unsure").
function markUnverified(card, review) {
  if (!card || !review) return;
  const norm = s => plainText(String(s)).replace(/\\[a-zA-Z]+|[{}$^_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const it of (review.items || []).filter(x => x.status === 'unsure')) {
    const key = norm(it.quote).slice(0, 48);
    if (key.length < 12) continue;
    for (const el of card.querySelectorAll('p, li, td')) {
      if (el.querySelector('p, li') || el.classList.contains('unverified')) continue;
      if (!norm(el.textContent).includes(key.slice(0, 32))) continue;
      el.classList.add('unverified');
      el.title = `Not verified: ${it.why || it.problem || 'the fact-checker could not confirm this'}${it.fix ? `\nPossible correction: ${plainText(it.fix)}` : ''}`;
      break;
    }
  }
}
// Several part reviews (a masterclass) as one.
function mergeReviews(list) {
  const rs = (list || []).filter(Boolean);
  if (!rs.length) return null;
  return { at: rs[rs.length - 1].at, items: rs.flatMap(r => r.items || []), checked: rs.reduce((a, r) => a + (r.checked || 0), 0), facts: Math.max(...rs.map(r => r.facts || 0)), web: rs.some(r => r.web) };
}
// The panel shown above a checked lesson. With actions, each item gets your buttons (see wireReview).
function reviewHtml(review, { actions = true } = {}) {
  if (!review) return '';
  const fixed = review.items.filter(x => x.status === 'fixed'), unsure = review.items.filter(x => x.status === 'unsure'), kept = review.items.filter(x => x.status === 'kept' || x.status === 'rejected');
  const head = !review.items.length ? `<b title="Checked against ${review.facts} reference facts${review.web ? ' and the web' : ''}">Fact-checked · no errors</b>`
    : `<b>Fact-checked · ${fixed.length ? `${fixed.length} corrected` : 'no corrections'}${unsure.length ? ` · ${unsure.length} to verify` : ''}</b>`;
  const btn = (x, a, label, cls = 'link') => `<button class="${cls} small" data-fca="${a}" data-fci="${fcItemId(x)}">${label}</button>`;
  const acts = x => !actions || x.kind === 'diagram' ? '' : `<div class="row fc-acts">${
    x.status === 'fixed' ? btn(x, 'undo', 'Undo') + btn(x, 'fact', 'Save as fact')
    : x.status === 'unsure' ? btn(x, 'apply', 'Apply fix', '') + btn(x, 'confirm', 'Keep original', '') + btn(x, 'fact', 'Save as fact')
    : btn(x, 'fact', 'Save as fact')}</div>`;
  const badge = x => x.status === 'fixed' ? 'Corrected' : x.status === 'unsure' ? 'Verify' : 'Kept';
  const row = x => `<li class="fc-item fc-${x.status}"><div class="fc-top"><span class="fc-badge">${badge(x)}</span><span class="small muted">${x.decidedBy === 'you' ? 'decided by you' : `${x.confidence}% confident · ${escapeHtml(x.decidedBy)}`}</span></div>
    <div class="fc-was"><span class="small muted">${x.status === 'fixed' ? 'Was:' : 'Says:'}</span> <span class="md">${renderMd(x.quote)}</span></div>
    ${x.status === 'fixed' || x.status === 'unsure' || x.status === 'rejected' ? `<div class="fc-now"><span class="small muted">${x.status === 'fixed' ? 'Now:' : x.status === 'rejected' ? 'Rejected change:' : 'Possible fix:'}</span> <span class="md">${renderMd(x.fix)}</span></div>` : ''}
    <div class="small fc-why">${escapeHtml(x.why || x.problem)}</div>${x.web && x.web.length ? Web.html(x.web) : ''}${acts(x)}</li>`;
  return `<details class="card fc-panel ${fixed.length ? 'has-fix' : ''} ${unsure.length ? 'has-unsure' : ''}"><summary><span class="fc-ico">${icon('check')}</span><span class="fc-head">${head}</span></summary>
    ${review.items.length ? `<ul class="fc-list">${[...fixed, ...unsure, ...kept].map(row).join('')}</ul>` : ''}</details>`;
}

// ---------- exact sweep: every written-out calculation "a × b + c = d" in the whole text ----------
// Wrong results are corrected in place (no model involved). Many wrong results in one text usually mean the
// worked example itself is muddled, so then they are only flagged.
const SWEEP_OP = String.raw`(?:[-+*/^×·÷−–]|\\times|\\cdot|\\div)`;
// Not part of a bigger expression with symbols ("t_1 + 3 × 4 = 14" is not "3 × 4 = 14").
const SWEEP_RE = new RegExp(String.raw`(?<![\w^_{}\\.])(?<![\w^_{}\\.)\]]\s*${SWEEP_OP}\s*)((?:\(?\s*-?\d+(?:\.\d+)?\s*\)?\s*${SWEEP_OP}\s*)+\(?\s*-?\d+(?:\.\d+)?\s*\)?)(\s*=\s*)(-?\d+(?:\.\d+)?)(?![\d.])(?!\s*${SWEEP_OP}\s*\d)`, 'g');
function arithmeticSweep(md) {
  const found = [];
  let inCode = false;
  md.split('\n').forEach((line, li) => {
    if (/^\s*```/.test(line)) { inCode = !inCode; return; }
    if (inCode) return;
    SWEEP_RE.lastIndex = 0;
    let m;
    while ((m = SWEEP_RE.exec(line))) {
      const expr = m[1].replace(/\\times|×|·|\\cdot/g, '*').replace(/÷|\\div/g, '/').replace(/−|–/g, '-');
      let v; try { v = calcEval(expr); } catch { continue; }
      if (!Number.isFinite(v)) continue;
      const stated = parseFloat(m[3]), tol = Math.max(0.011, Math.abs(v) * 0.005);
      if (Math.abs(v - stated) <= tol) continue;
      const dec = (m[3].split('.')[1] || '').length;
      found.push({ li, at: m.index, len: m[0].length, was: m[0], now: m[1] + m[2] + String(+v.toFixed(Math.max(2, dec))), expr: m[1].trim(), stated, computed: +v.toPrecision(10) });
    }
  });
  if (!found.length) return { md, items: [] };
  const apply = found.length <= 4, lines = md.split('\n');
  if (apply) for (const f of found.slice().reverse()) lines[f.li] = lines[f.li].slice(0, f.at) + f.now + lines[f.li].slice(f.at + f.len);
  const items = found.map(f => ({ quote: f.was.trim(), fix: f.now.trim(), problem: `${f.expr} is ${f.computed}, not ${f.stated}.`, kind: 'calculation',
    status: apply ? 'fixed' : 'unsure', confidence: 99, decidedBy: 'exact recalculation',
    why: apply ? `Recomputed exactly: ${f.expr} = ${f.computed}. Check that later steps use the corrected value.` : `Recomputed exactly: ${f.expr} = ${f.computed}, not ${f.stated}. This example has several wrong results, so it was flagged rather than patched.`, web: [] }));
  return { md: apply ? lines.join('\n') : md, items };
}

// ---------- diagrams: every mermaid block must draw; automata diagrams must match their transition tables ----------
function mermaidBlocks(md) { const out = []; md.replace(/```mermaid\s*\n([\s\S]*?)```/g, (all, src, at) => { out.push({ all, src, at }); return all; }); return out; }
// Common slips a small model makes, fixed without asking it: LaTeX/$ in labels, unquoted labels with brackets.
// Flowchart lines are split at their arrows; every node label and arrow label that isn't quoted gets quoted, so
// brackets, parentheses and pipes inside a label ("A[Array dp[W+1]]", "-->|Later (from F(4))|") stop breaking it.
function mermaidTidy(src) {
  let s = src.replace(/\$([^$\n]*)\$/g, '$1').replace(/\\(?:text|mathrm)\{([^}]*)\}/g, '$1').replace(/\\(?:to|rightarrow)\b/g, '→').replace(/\\(?:le|leq)\b/g, '≤').replace(/\\(?:ge|geq)\b/g, '≥');
  if (!/^\s*(flowchart|graph)\b/m.test(s)) return s;
  const q = t => `"${t.trim().replace(/^"|"$/g, '').replace(/"/g, "'")}"`;
  const OPEN = { '[': ']', '{': '}', '(': ')' };
  const node = seg => {   // "A[label]", "B{label}", "C(label)", "D((label))", "E[[label]]" …
    const m = seg.match(/^(\s*)([A-Za-z_][\w]*)\s*([[{(]+)([\s\S]*?)([\]})]+)(\s*(?::::\w+)?\s*)$/);
    if (!m) return seg;
    const [, pre, id, open, body, close, post] = m;
    // the opening run tells the shape; the matching closing run is at the very end
    const want = open.split('').reverse().map(c => OPEN[c]).join('');
    if (!close.endsWith(want)) return seg;
    const label = (body + close).slice(0, (body + close).length - want.length);
    if (/^\s*".*"\s*$/.test(label)) return seg;
    return `${pre}${id}${open}${q(label)}${want}${post}`;
  };
  return s.split('\n').map(line => {
    if (/^\s*(flowchart|graph|subgraph|end\b|classDef|class\b|style\b|linkStyle|click\b|%%)/.test(line)) return line;
    // split at arrows, keeping them (and their |labels|)
    const parts = line.split(/(\s*(?:<?-{2,}>?|<?={2,}>?|-\.+->?|--[^-|>\n]+-->)\s*(?:\|[^|\n]*\|)?\s*)/);
    return parts.map((p, i) => i % 2 ? p.replace(/\|([^|\n]*)\|/, (_, t) => /^\s*".*"\s*$/.test(t) ? `|${t}|` : `|${q(t)}|`) : p.split('&').map(node).join('&')).join('');
  }).join('\n');
}
async function mermaidOk(src) { try { await mermaid.parse(src); return true; } catch (e) { return String(e && e.message || e).slice(0, 300); } }
// ```viz drawings: the JSON must parse and draw. Small slips (single quotes, trailing commas, comments) are fixed by
// rule; anything else is repaired by the model and re-checked, or removed.
function vizBlocks(md) { const out = []; md.replace(/```viz\s*\n([\s\S]*?)```/g, (all, src, at) => { out.push({ all, src, at }); return all; }); return out; }
function vizTry(src) {
  const tries = [src, src.replace(/\/\/[^\n]*/g, '').replace(/,\s*([}\]])/g, '$1'), src.replace(/\/\/[^\n]*/g, '').replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')];
  // Drawing it is the check; step-by-step drawings ("frames", and "algo" whose steps the engine computes) must draw at
  // every step, not just the first.
  const drawAll = spec => {
    if (typeof Viz === 'undefined') return;
    const sp = spec && spec.type === 'algo' ? Viz.expand(spec) : spec;
    Viz.render(sp);
    if (sp && sp.type === 'frames') sp.frames.forEach(f => Viz.render(f));
  };
  for (const t of tries) { try { const spec = JSON.parse(t); drawAll(spec); return { ok: true, json: JSON.stringify(spec) }; } catch (e) { var err = e.message; } }
  return { ok: false, err };
}
async function checkVizBlocks(md, signal) {
  const items = [];
  for (const b of vizBlocks(md).reverse()) {
    let r = vizTry(b.src), by = 'automatic repair';
    let orig = null; try { orig = JSON.stringify(JSON.parse(b.src)); } catch {}
    if (r.ok && r.json === orig) continue;   // fine as written
    if (!r.ok) {
      try {
        const fixed = (await ollamaChat([
          { role: 'system', content: 'Fix this JSON drawing description so it is valid JSON in the documented shape (keep every value and number). Return ONLY the JSON.' },
          { role: 'user', content: `JSON:\n${b.src}\n\nError: ${r.err}` },
        ], { signal, model: checkModel(), temperature: 0, maxTokens: 1200, format: 'json' })).trim();
        const r2 = vizTry(fixed); if (r2.ok) { r = r2; by = 'the model, re-checked by drawing it'; }
      } catch (e) { if (e.name === 'AbortError') throw e; }
    }
    if (r.ok) md = md.slice(0, b.at) + '```viz\n' + r.json + '\n```' + md.slice(b.at + b.all.length);
    else md = md.slice(0, b.at) + md.slice(b.at + b.all.length);
    if (r.ok && by === 'automatic repair') continue;   // a silent formatting fix
    items.push({ quote: 'A drawing that could not be drawn', fix: r.ok ? 'The same drawing, repaired' : '(removed)', problem: 'Invalid drawing data.', kind: 'diagram', status: r.ok ? 'fixed' : 'unsure', confidence: 95, decidedBy: r.ok ? by : 'the drawing engine', why: r.ok ? 'The drawing data was broken; it was repaired and now draws.' : 'The drawing data was broken and could not be repaired, so it was removed.', web: [] });
  }
  return { md, items };
}
async function checkDiagrams(md, signal) {
  const vz = await checkVizBlocks(md, signal);
  md = vz.md;
  if (!window.mermaid) return { md, items: vz.items.concat(automataConsistency(md)) };
  const items = vz.items;
  for (const b of mermaidBlocks(md).reverse()) {
    let err = await mermaidOk(b.src);
    if (err === true) continue;
    let src = mermaidTidy(b.src), by = 'automatic repair';
    err = await mermaidOk(src);
    if (err !== true) {
      try {
        const fixed = (await ollamaChat([
          { role: 'system', content: 'Fix this Mermaid diagram so it parses. Keep its meaning, nodes and edges. Put every node label in double quotes. No LaTeX or $ anywhere. Return ONLY the corrected Mermaid code, no fences, no explanation.' },
          { role: 'user', content: `Diagram:\n${src}\n\nParser error:\n${err}` },
        ], { signal, model: checkModel(), temperature: 0, maxTokens: 1500 })).replace(/^```(?:mermaid)?\s*|```\s*$/g, '').trim();
        if ((await mermaidOk(fixed)) === true) { src = fixed; err = true; by = 'the model, re-checked by the diagram parser'; }
      } catch (e) { if (e.name === 'AbortError') throw e; }
    }
    if (err === true) {
      md = md.slice(0, b.at) + '```mermaid\n' + src.trim() + '\n```' + md.slice(b.at + b.all.length);
      items.push({ quote: 'A diagram that could not be drawn', fix: 'The same diagram, repaired so it draws', problem: 'Invalid diagram code.', kind: 'diagram', status: 'fixed', confidence: 99, decidedBy: by, why: 'The diagram code had a syntax error; it was repaired and now passes the diagram parser.', web: [] });
    } else {
      md = md.slice(0, b.at) + md.slice(b.at + b.all.length);
      items.push({ quote: 'A diagram that could not be drawn', fix: '(removed)', problem: 'Invalid diagram code.', kind: 'diagram', status: 'unsure', confidence: 90, decidedBy: 'the diagram parser', why: 'The diagram code was broken and could not be repaired, so it was removed. The text explains the same steps.', web: [] });
    }
  }
  return { md, items: items.concat(automataConsistency(md)) };
}
// A state diagram (q0 --> q1 : a) and a transition table in the same text must say the same thing.
function automataConsistency(md) {
  const ns = s => String(s).replace(/\$|\\|[{}*→>()\s]|-(?=>)|^-+|_/g, '').replace(/^(start|init)$/i, '').toLowerCase();
  const fromDiagram = {};
  for (const b of mermaidBlocks(md)) {
    if (!/^\s*stateDiagram/.test(b.src)) continue;
    b.src.replace(/^\s*([\w$\\{}]+)\s*-->\s*([\w$\\{}]+)\s*:\s*(.+)$/gm, (_, a, c, lab) => {
      if (a === '[*]' || c === '[*]') return;
      lab.split(/[,;/]|\bor\b/).map(x => x.replace(/["'$]/g, '').trim()).filter(Boolean).forEach(sym => { fromDiagram[`${ns(a)}|${sym.toLowerCase()}`] = ns(c); });
    });
  }
  for (const b of vizBlocks(md)) {   // exact DFA drawings too
    let spec; try { spec = JSON.parse(b.src); } catch { continue; }
    if (!spec || spec.type !== 'dfa') continue;
    for (const t of spec.transitions || []) fromDiagram[`${ns(t[0])}|${String(t[1]).toLowerCase()}`] = ns(t[2]);
  }
  if (!Object.keys(fromDiagram).length) return [];
  const fromTable = {};
  const rows = md.split('\n').filter(l => /^\s*\|.*\|\s*$/.test(l));
  for (let i = 0; i < rows.length - 1; i++) {
    const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    if (!/^\s*\|?\s*:?-{2,}/.test(rows[i + 1])) continue;
    const head = cells(rows[i]);
    if (!/state|δ|delta|^$|q/i.test(head[0] || '')) continue;
    const syms = head.slice(1).map(h => h.replace(/[$`*]/g, '').trim().toLowerCase());
    for (let j = i + 2; j < rows.length && !/^\s*\|?\s*:?-{2,}/.test(rows[j]); j++) {
      const c = cells(rows[j]), st = ns(c[0]);
      if (!st) continue;
      syms.forEach((sym, k) => { const t = ns((c[k + 1] || '').replace(/[{}]/g, '')); if (sym && t && !/,/.test(c[k + 1] || '')) fromTable[`${st}|${sym}`] = t; });
    }
  }
  const out = [];
  for (const [k, t] of Object.entries(fromTable)) {
    if (!(k in fromDiagram) || fromDiagram[k] === t) continue;
    const [st, sym] = k.split('|');
    out.push({ quote: `From ${st} on "${sym}": the table says ${t}, the diagram says ${fromDiagram[k]}.`, fix: 'Check which one is right and trust that one.', problem: 'The state diagram and the transition table disagree.', kind: 'diagram', status: 'unsure', confidence: 95, decidedBy: 'comparing the diagram with the table', why: 'The same transition is drawn one way and tabulated another way, so one of them is wrong. Work the transition out yourself before relying on either.', web: [] });
  }
  return out.slice(0, 4);
}

// ---------- C programs in a text: compile and run them, and check the output the text claims ----------
// The claimed output is the fenced block (no language, or text/output) right after the program, or "Output: `…`".
// Where the program reads and changes a variable in one expression (undefined behaviour), a mismatch is only flagged.
async function checkPrograms(md, signal) {
  if (typeof runC !== 'function' || !(await ccInfo()).available) return { md, items: [] };
  const items = [], blocks = [];
  for (const m of md.matchAll(/```(?:c|C)[ \t]*\n([\s\S]*?)```/g)) blocks.push({ code: m[1], start: m.index, end: m.index + m[0].length });
  for (const b of blocks.reverse()) {
    if (signal && signal.aborted) throw new DOMException('Stopped', 'AbortError');
    if (!/\bmain\s*\(/.test(b.code) || !/\b(printf|puts|putchar)\s*\(/.test(b.code)) continue;
    const near = md.slice(Math.max(0, b.start - 500), b.end + 300);
    if (/\bdynamic(ally)?\s*scop/i.test(near)) continue;   // which scoping a claimed output refers to is ambiguous here
    const after = md.slice(b.end, b.end + 400);
    let claim = null;
    const fm = after.match(/^\s*(?:[*_]*\s*(?:Output|It prints|Prints)[^`\n]*\n+)?```(?:text|output|console|plaintext|)[ \t]*\n([\s\S]*?)```/i);
    if (fm) claim = { text: fm[1], at: b.end + fm.index + fm[0].length - 3 - fm[1].length };
    else { const om = after.match(/\b(?:output|prints?)\b[^`\n]{0,30}`([^`\n]+)`/i); if (om) claim = { text: om[1], at: b.end + om.index + om[0].length - 1 - om[1].length }; }
    if (!claim) continue;
    const r = await runC(withIncludes(b.code));
    if (!r.ok) continue;
    const got = String(r.stdout || '').replace(/\s+$/, ''), norm = s => String(s).replace(/\s+/g, ' ').trim();
    if (norm(got) === norm(claim.text)) continue;
    const ub = /\b(\w+)\s*(\+\+|--)[^;]*\b\1\b|(\+\+|--)\s*(\w+)\b[^;]*\b\4\b/.test(b.code.replace(/for\s*\([^)]*\)/g, ''));
    if (!ub) md = md.slice(0, claim.at) + got + (claim.text.match(/\s*$/)[0] || '') + md.slice(claim.at + claim.text.length);
    items.push({ quote: claim.text.trim().slice(0, 300), fix: got.trim().slice(0, 300) || '(nothing printed)', problem: 'The stated output is not what the program prints.', kind: 'calculation',
      status: ub ? 'unsure' : 'fixed', confidence: ub ? 80 : 99, decidedBy: `compiled and ran it (${r.compiler || 'gcc'})`,
      why: ub ? 'GCC prints something different, but this program reads and changes the same variable in one expression (undefined behaviour), so different compilers may differ. Check the reasoning.' : 'The program was compiled and run; this is what it actually prints. Check that the explanation around it matches.', web: [] });
  }
  return { md, items };
}

// ---------- your corrections: undo a wrong correction, settle a doubt, save a fact ----------
function fcNorm(s) { return plainText(String(s || '')).replace(/\s+/g, ' ').trim().toLowerCase(); }
function fcItemId(x) { const s = fcNorm(x.quote) + '|' + fcNorm(x.fix); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
// Applies your decision to the text; updates the item. Returns the new text.
function fcApply(md, item, action) {
  const swap = (from, to) => { const loc = locate(md, from); return loc ? md.slice(0, loc[0]) + to + md.slice(loc[1]) : md; };
  if (action === 'undo') { md = swap(item.fix, item.quote); Object.assign(item, { status: 'rejected', decidedBy: 'you', confidence: 100, why: 'You marked this correction as wrong, so the original text is back. Future checks will leave it alone.' }); }
  else if (action === 'apply') { md = swap(item.quote, item.fix); Object.assign(item, { status: 'fixed', decidedBy: 'you', confidence: 100, why: 'You confirmed this correction.' }); }
  else if (action === 'confirm') Object.assign(item, { status: 'rejected', decidedBy: 'you', confidence: 100, why: 'You confirmed the original is right. Future checks will leave it alone.' });
  return md;
}
// Wires the buttons of a review panel. ctx: { items(): the live review items, md(): the text,
// setMd(md), save(), rerender(), subject, title }, or apply(item, action) instead of md/setMd for text kept in parts.
function wireReview(root, ctx) {
  if (!root) return;
  root.querySelectorAll('[data-fca]').forEach(b => b.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    const item = ctx.items().find(x => fcItemId(x) === b.dataset.fci), a = b.dataset.fca;
    if (!item) return;
    if (a === 'fact') return factEditor(b.closest('.fc-item'), item, ctx);
    const md = ctx.apply ? null : fcApply(ctx.md(), item, a);
    if (a === 'undo' || a === 'confirm') await updateHub(h => { h.factRejects = (h.factRejects || []).filter(r => fcNorm(r.quote) !== fcNorm(item.quote)).concat([{ quote: item.quote, fix: item.fix, at: new Date().toISOString() }]).slice(-500); });
    if (ctx.apply) await ctx.apply(item, a); else await ctx.setMd(md);
    await ctx.save();
    toast(a === 'undo' ? 'Correction undone: the original is back.' : a === 'apply' ? 'Fix applied.' : 'Marked as right.', 'ok');
    ctx.rerender();
  });
}
// A small inline form: the fact (editable), its subject, Save.
function factEditor(li, item, ctx) {
  if (!li || li.querySelector('.fc-fact')) return;
  const text = plainText(item.status === 'fixed' ? item.fix : item.quote).replace(/\s+/g, ' ').trim();
  li.insertAdjacentHTML('beforeend', `<div class="fc-fact"><p class="small muted">Write it as a general fact (it joins the verified reference and is used in every future lesson and check).</p>
    <textarea rows="3" style="width:100%">${escapeHtml(text)}</textarea>
    <div class="row"><select class="fc-subj">${SUBJECTS.map(s => `<option ${s === ctx.subject ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
    <button class="primary small fc-fsave">Save fact</button><button class="link small fc-fcancel">Cancel</button></div></div>`);
  const box = li.querySelector('.fc-fact');
  box.querySelector('.fc-fcancel').onclick = () => box.remove();
  box.querySelector('.fc-fsave').onclick = async () => {
    try { await saveMyFact({ f: box.querySelector('textarea').value, s: box.querySelector('.fc-subj').value, from: ctx.title || '' }); }
    catch (err) { toast(err.message); return; }
    box.innerHTML = `<p class="small" style="color:var(--green)">${icon('check')} Saved to your reference.</p>`;
  };
}

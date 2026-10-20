// Previous-year GATE questions (PYQs). Found automatically wherever they appear: pages of your PDFs and
// notes as they are read, questions picked out of a file, and photos in Solve. Each is filed by subject
// and year, gets a checked answer (exact calculators / the material's own key / independent votes), and is
// taught as a "masterclass" in the student's 22-part format: concepts first, the question only after.
//
// Store: hub.pyqs = [{ id, key, text, year, set, number, subject, concept, source, materialKey, answer, master, added }]
//        hub.pyqScan = [{ siteId, name, page }]   pages waiting to be scanned for PYQs

// A GATE marking next to a question: "GATE 2019", "GATE CSE 2021", "[GATE-2015]", "GATE-CS-2008", "(GATE IT 2007)".
const PYQ_MARK = /\bGATE[\s\-–_:(\[]*(?:(?:CSE?|IT|CS\/IT)[\s\-–_:]*)?((?:19|20)\d{2})\b/i;
function pyqYearOf(...texts) { for (const t of texts) { const m = String(t || '').match(PYQ_MARK); if (m) return m[1]; } return ''; }
function hasPyqMark(md) { return PYQ_MARK.test(String(md || '')); }
// Whole-text fingerprint: linked questions share a long opening statement, so a prefix isn't enough.
function pyqKey(text) {
  const t = plainText(text).toLowerCase().replace(/gate[\s\S]{0,12}?(19|20)\d{2}/g, '').replace(/[^a-z0-9]+/g, '');
  let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return t.slice(0, 40) + ':' + t.length + ':' + h.toString(36);
}
function pyqSubjectGuess(text) { return formulaSubject({ name: text }) || lessonSubject(text) || ''; }

// ---------- "needs checking": PYQs whose text looks misread ----------
// p.garble = { ver, issues, minor } from pyqGarble. A flagged PYQ whose source page still exists is queued for a
// careful re-read (hub.pyqReread = [{ id, siteId, page }]); if that fails too, or the page is gone (photo, deleted
// book), it is marked p.needsCheck: shown on the PYQ, left out of paper mode, and no masterclass is written from it
// until it is fixed (Edit question). p.handChecked = the student corrected or confirmed it by hand.
async function liveSiteIds() { try { return new Set((await Store.listSites()).map(s => s.id)); } catch { return null; } }
function pyqMark(p, h, live) {
  const g = pyqGarble(p.text, { year: p.year });
  p.garble = { ver: GARBLE_VER, issues: g.issues, minor: g.minor };
  if (!g.bad || p.handChecked) { delete p.needsCheck; return; }
  const src = p.source || {};
  const canReread = src.kind === 'file' && src.siteId && src.page && !p.reread && live && live.has(src.siteId);
  if (canReread) {
    h.pyqReread = h.pyqReread || [];
    if (!h.pyqReread.some(x => x.id === p.id)) h.pyqReread.push({ id: p.id, siteId: src.siteId, page: src.page });
  } else p.needsCheck = true;
}
// Re-checks the bank once per version of the check (cheap: no model calls).
async function pyqGarbleSweep() {
  const h0 = await Store.getHub();
  if (!(h0.pyqs || []).some(p => !p.garble || p.garble.ver !== GARBLE_VER)) return 0;
  const live = await liveSiteIds();
  let n = 0;
  await updateHub(h => { for (const p of h.pyqs || []) if (!p.garble || p.garble.ver !== GARBLE_VER) { pyqMark(p, h, live); n++; } });
  announce({ type: 'pyqs' });
  return n;
}
// New wording for a PYQ (careful re-read or the student's edit): the old answer check and masterclass were made
// from the old text, so they go (an official key stays: it belongs to the question number, not the wording).
function pyqSetText(p, text) {
  p.text = String(text).trim(); p.key = pyqKey(p.text);
  if (!p.officialKey) p.answer = null;
  p.parts = []; p.master = ''; p.reviews = []; delete p.keyConflict;
}
// One careful re-read: the page is read again (reader.js), its questions extracted, and this PYQ's question
// replaces the old text only if it passes the misread check. Otherwise the PYQ is marked "needs checking".
async function pyqRereadOne(item, signal) {
  const h = await Store.getHub(), p = (h.pyqs || []).find(x => x.id === item.id);
  let fresh = null, why = '';
  if (p) {
    announce({ type: 'pyq-scan', siteId: item.siteId, pages: [item.page] });
    try {
      const md = await Reader.rereadPage(item.siteId, item.page, { signal });
      if (md == null) why = 'The page it came from no longer exists.';
      else {
        const src = (h.pyqSources || {})[item.siteId];
        const qs = await pyqExtract([{ n: item.page, md }], { upload: src ? { year: src.year || p.year } : null, signal });
        const n = pyqNum(p);
        fresh = qs.find(q => n && pyqNum(q) === n) || (!n && qs.length === 1 ? qs[0] : null);
        if (!fresh) why = 'The careful re-read did not find this question on the page.';
      }
    } catch (e) { if (e.name === 'AbortError') throw e; console.warn('pyq re-read', e); why = `The re-read failed (${e.message}).`; }
  }
  let ok = false;
  await updateHub(h2 => {
    h2.pyqReread = (h2.pyqReread || []).filter(x => x.id !== item.id);
    const x = (h2.pyqs || []).find(y => y.id === item.id);
    if (!x) return;
    const g = fresh && pyqGarble(fresh.text, { year: x.year });
    x.reread = { at: new Date().toISOString(), text: fresh ? fresh.text : '', issues: g ? g.issues : [], why };
    if (g && !g.bad) { pyqSetText(x, fresh.text); x.garble = { ver: GARBLE_VER, issues: [], minor: g.minor }; delete x.needsCheck; x.reread.ok = true; ok = true; }
    else x.needsCheck = true;
  });
  announce({ type: 'pyq-scan', siteId: item.siteId });
  announce({ type: 'pyqs' });
  return ok;
}

// Adds PYQs (deduplicated by their wording). Returns how many were new.
async function addPYQs(list) {
  let added = 0;
  const live = await liveSiteIds();
  await updateHub(h => {
    h.pyqs = h.pyqs || [];
    for (const p of list) {
      if (!p.text || p.text.trim().length < 20) continue;
      const key = pyqKey(p.text);
      const old = h.pyqs.find(x => (x.key = pyqKey(x.text)) === key);   // (re-keys older entries too)
      // Kept from a book you deleted and found again in a new upload: point it at the new copy.
      if (old && live && old.source && old.source.siteId && !live.has(old.source.siteId) && p.source && p.source.siteId) old.source = p.source;
      if (old) { if (!old.year && p.year) old.year = p.year; if (!old.materialKey && p.materialKey) old.materialKey = p.materialKey; continue; }
      h.pyqs.push({ id: uid(), key, text: p.text.trim(), year: p.year || '', set: p.set || '', number: p.number || '', subject: p.subject || pyqSubjectGuess(p.text) || 'Unsorted',
        concept: p.concept || '', source: p.source || { kind: 'photo' }, materialKey: p.materialKey || '', answer: null, master: '', added: new Date().toISOString() });
      pyqMark(h.pyqs[h.pyqs.length - 1], h, live);
      added++;
    }
  });
  if (added && (await Store.getHub()).officialKeys) await applyOfficialKeys();
  if (added) { announce({ type: 'pyqs' }); toast(`Found ${added} GATE PYQ${added > 1 ? 's' : ''}. Added to the PYQs tab.`, 'ok'); }
  return added;
}

// ---------- finding PYQs in pages (background, one window at a time) ----------
const PYQ_FIND_SCHEMA = { type: 'object', required: ['questions'], properties: { questions: { type: 'array', items: {
  type: 'object', required: ['page', 'year', 'subject', 'topic', 'text', 'answer_key'], properties: {
    page: { type: 'integer' }, year: { type: 'string' }, set: { type: 'string' }, number: { type: 'string' },
    subject: { type: 'string', enum: SUBJECTS }, topic: { type: 'string' }, text: { type: 'string' }, answer_key: { type: 'string' } } } } } };
// Pulls the questions out of some pages of text. upload = the student said these are PYQs (uploaded from the
// PYQs tab), so every question counts; otherwise only questions with a GATE year marking do.
async function pyqExtract(pages, { upload = null, signal } = {}) {
  const rule = upload
    ? `The student uploaded these pages as previous-year GATE questions${upload.year ? ` (GATE ${upload.year})` : ''}. Extract EVERY exam question on them. year = the GATE year printed with the question or in a heading/header of the page; if none is printed, ${upload.year ? `use "${upload.year}"` : 'use ""'}.`
    : 'Extract ONLY questions explicitly marked as GATE questions with a year: a marking like "GATE 2019", "GATE CSE 2021", "[GATE-2015]" next to the question, or a heading saying the questions below are from GATE <year>. Skip unmarked practice questions. year = the 4-digit GATE year.';
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: `You extract previous-year GATE CS questions (PYQs) from study material. ${rule} Make EVERY numbered question its own item, including both questions of a "common data" or "linked answer" pair: copy the shared statement (e.g. "Statement for Linked Answer Questions 80 & 81: ...") at the start of EACH of them, so each item makes sense on its own. Copy each COMPLETE question exactly as printed, in Markdown: the full statement, all given data, code, tables, figure descriptions, and every option on its own line as (A) ... (B) ... (C) ... (D) .... Do not solve. subject = the GATE CS subject it tests. topic = the specific topic tested, in 2-4 words. answer_key = the answer exactly as printed in the material for that question (e.g. "B" or "12"), or "" if none is printed. Skip theory text, solutions and answer-key tables (but use a printed key to fill answer_key). Return JSON.` },
    { role: 'user', content: pages.map(p => `--- Page ${p.n} ---\n${p.md}`).join('\n\n').slice(0, 12000) },
  ], { signal, format: PYQ_FIND_SCHEMA, temperature: 0, maxTokens: 6000, model: checkModel() }));
  // Coverage: every "Q.n" printed on the pages must come out. Re-ask for any that were dropped.
  const qs = (j.questions || []).slice();
  const want = new Set(pages.flatMap(p => qNumbers(p.md)));
  const got = () => new Set(qs.map(q => pyqNum(q)).filter(Boolean));
  let missing = [...want].filter(n => !got().has(n));
  for (let round = 0; round < 2 && missing.length; round++) {
    const more = parseJSON(await ollamaChat([
      { role: 'system', content: `You extract GATE exam questions from study material. Extract ONLY these questions: ${missing.map(n => 'Q.' + n).join(', ')}. ${upload ? `They are previous-year GATE questions${upload.year ? ` (GATE ${upload.year})` : ''}.` : ''} Each is its own item; for a "common data" or "linked answer" question, copy the shared statement at the start of it. Copy each COMPLETE question exactly as printed, in Markdown, with every option on its own line as (A) ... (B) ... (C) ... (D) .... number = its question number. year = the GATE year if printed. subject = the GATE CS subject. topic = the specific topic in 2-4 words. answer_key = the answer if printed, else "". Return JSON.` },
      { role: 'user', content: pages.map(p => `--- Page ${p.n} ---\n${p.md}`).join('\n\n').slice(0, 12000) },
    ], { signal, format: PYQ_FIND_SCHEMA, temperature: 0, maxTokens: 4000, model: checkModel() }));
    qs.push(...(more.questions || []).filter(q => { const n = pyqNum(q); return n && missing.includes(n) && !got().has(n); }));
    missing = [...want].filter(n => !got().has(n));
  }
  const out = [];
  for (const q of qs) {
    if (!q.text || q.text.trim().length < 20) continue;
    const pg = pages.find(p => p.n === q.page) || pages[0];
    let year = /^(19|20)\d{2}$/.test(String(q.year).trim()) ? String(q.year).trim() : pyqYearOf(q.text, pg.md);
    if (!year && upload) year = upload.year || '';
    if (!year && !upload) continue;   // never file an unmarked question as a PYQ
    // Only trust an answer key the page really prints (small models invent one otherwise).
    const key = /\b(answer|ans\b|ans\.|key|correct option|solution)\s*[:\-=.)]?/i.test(pg.md) ? String(q.answer_key || '').trim().slice(0, 40) : '';
    out.push({ text: fixScanMarks(withOptions(q.text, pg.md, qs.filter(x => (x.page || pg.n) === pg.n).length)), year, number: String(pyqNum(q) || q.number || ''), set: q.set || '', subject: q.subject, concept: String(q.topic || '').slice(0, 40), materialKey: key, page: pg.n });
  }
  return out;
}
// Question numbers printed on a page: "Q.7", "Q 12", "Q.I1" (scanned 11), "Q.52b".
function qNumOf(s) { const m = String(s || '').replace(/[Il|]/g, '1').replace(/O/g, '0').match(/\d{1,3}/); return m ? +m[0] : null; }
function pyqNum(q) { return qNumbers(q.text).slice(-1)[0] || qNumOf(q.number); }   // the last "Q.n" in the text is the question itself
function qNumbers(md) {
  const out = [];
  // Not ranges or lists in instructions like "Q.1 to Q.20 carry one mark" or "Q.77, Q.79 and Q.81".
  String(md || '').replace(/(?:^|\n)[\s*_#>]*Q\s*\.?\s*([0-9Il|O]{1,3})\b(?!\s*(?:,|to|-|–|—|and|or)\s*Q?\s*\.?\s*\d)/g, (_, n) => { const v = qNumOf(n); if (v && v <= 150 && !out.includes(v)) out.push(v); });
  return out;
}
// Scanner slips in option labels: "©)" → "(C)", "®B)" / "®" → "(B)".
function fixScanMarks(t) { return String(t).replace(/©\)?/g, '(C)').replace(/®\s?B?\)?/g, '(B)').replace(/\(\(([A-D])\)\)/g, '($1)'); }
// The model sometimes drops the options. If the page has (A)…(D) options and this is the only question on it, put them back.
function withOptions(text, md, nOnPage) {
  const hasOpts = s => /(^|\s)\(?[A-D]\)\s*\S/.test(s) || /^\s*[A-D][.)]\s+\S/m.test(s);
  if (hasOpts(text) || !hasOpts(md) || nOnPage > 1) return text;
  const m = md.match(/(\(?A\)[\s\S]*?\(?D\)[^\n]*)/);
  if (!m) return text;
  return text.trim() + '\n\n' + m[1].replace(/\s+(?=\(?[B-D]\)\s)/g, '\n').trim();
}
// ---------- misread check: text a scanner or the vision model got wrong ----------
// Flags only what can't be right in a real question (so a clean question is never held back):
// code whose brackets don't balance or that holds impossible tokens ("5a", "f£"), stray symbols (£ § ™ «),
// numbers broken by OCR ("1O0", an option "S5" among numbers), option lists with missing / repeated letters
// or two identical options, quotes and $…$ left open, and text cut off mid-sentence.
// Returns { bad, issues: [strong problems], minor: [likely slips that don't block the question] }.
const GARBLE_VER = 2;
const GARBLE_STRAY = /[£§™¢¥¤«»¦¿¡°þð]/;
const C_KEYWORD_LINE = /\b(int|char|float|double|void|long|unsigned|return|if|else|while|for|do|switch|case|struct|static|printf|scanf|main|begin|end|procedure)\b/;
function codeSpan(lines) {
  const isCode = l => /^\s*[{}]|[{};]\s*$|^\s*#(include|define)/.test(l) || (C_KEYWORD_LINE.test(l) && /[(;{=]/.test(l) && !/^\s*(Q\s*\.?\s*\d+|Consider|What|Which|How|The|Assume|Let|Suppose)\b/i.test(l));
  const idx = lines.map((l, i) => isCode(l) ? i : -1).filter(i => i >= 0);
  if (idx.length < 2) return [];
  let a = idx[0], b = idx[idx.length - 1];
  // A garbled last line ("[8s") right after the code still belongs to it.
  while (b + 1 < lines.length && lines[b + 1].trim().length < 20 && !/[A-Za-z]{4,}/.test(lines[b + 1]) && !/^\s*\(?[A-D][).]/.test(lines[b + 1])) b++;
  return lines.slice(a, b + 1);
}
// Option labels "(A)" / "A)" / "A." with their text, in order (labels inside math like "(A + B)" don't count).
function labelSpans(t) {
  const out = [], re = /(^|[\s(])(\(([A-D])\)|([A-D])\)|^([A-D])\.(?=\s))/gm;
  let m;
  while ((m = re.exec(t))) {
    const L = m[3] || m[4] || m[5], at = m.index + m[1].length;
    if (!m[3]) {
      const before = t.slice(0, at).replace(/\s+$/, ''), line = before.slice(before.lastIndexOf('\n') + 1).replace(/\(\(?[A-D]\)\)?/g, '');
      // "(A + B)", "f(A, B)", "(A B)'": a letter closing a bracket opened earlier on the line is math, not a label
      if (/[+\-*/=^&|,(]$/.test(before) || m[1] === '(' || (line.match(/\(/g) || []).length > (line.match(/\)/g) || []).length) continue;
    }
    out.push({ L, at, end: at + m[2].length });
  }
  return out;
}
function optionLabels(t) {
  const out = labelSpans(t), first = out.findIndex(o => o.L === 'A');
  const opts = first < 0 ? out : out.slice(first);
  return opts.map((o, i) => ({ L: o.L, at: o.at, text: t.slice(o.end, i + 1 < opts.length ? opts[i + 1].at : t.length).trim() }));
}
function pyqGarble(text, { year = '', page = false } = {}) {
  const issues = [], minor = [];
  const raw = String(text || '').replace(/\r/g, '');
  const t = fixScanMarks(raw).replace(/^```\w*\s*$/gm, '');
  const lines = t.split('\n');
  // 1. Code
  const code = codeSpan(lines);
  if (code.length) {
    const src = code.join('\n').replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
    const bal = (o, c) => (src.split(o).length - 1) - (src.split(c).length - 1);
    for (const [o, c, name] of [['(', ')', 'parentheses'], ['{', '}', 'braces'], ['[', ']', 'square brackets']]) { const d = bal(o, c); if (d) issues.push(`The code's ${name} don't balance (${Math.abs(d)} more "${d > 0 ? o : c}")`); }
    const glued = (src.match(/(?<![\w.$])\d+[A-Za-z_]\w*/g) || []).filter(w => !/^0x[0-9a-f]+$|^\d+(u|l|ul|lu|ll|ull)$|^\d+e\d+$/i.test(w));   // ("5f" is not C: a float needs "5.0f")
    if (glued.length) issues.push(`Impossible token${glued.length > 1 ? 's' : ''} in the code: ${[...new Set(glued)].slice(0, 4).map(w => `"${w}"`).join(', ')} (a name can't start with a digit)`);
    const stray = [...new Set(code.join('').match(/[£§™¢¥¤«»¦¿¡°©®]/g) || [])];
    if (stray.length) issues.push(`Stray symbol${stray.length > 1 ? 's' : ''} in the code: ${stray.join(' ')}`);
    const oddQ = code.filter(l => ((l.replace(/\\"/g, '').match(/"/g) || []).length % 2));
    if (oddQ.length) issues.push(`A string in the code is not closed: "${oddQ[0].trim().slice(0, 40)}"`);
    const brace = code.join('\n').match(/\}[ \t]*(?!else\b|while\b)[A-Za-z]\w*/);
    if (brace) issues.push(`"${brace[0].trim()}" can't follow a closing brace`);
    if (code.some(l => /[“”‘’]/.test(l))) minor.push('Curly quotes in the code (they were probably straight quotes)');
  }
  // 2. Symbols, numbers and quotes anywhere (option-label slips like "©)" are already repaired)
  const body = t.replace(/\(([A-D])\)/g, ' ');
  const stray = [...new Set((body.match(new RegExp(GARBLE_STRAY.source, 'g')) || []).concat(body.match(/[©®]/g) || []))];
  if (stray.length && !code.some(l => stray.some(s => l.includes(s)))) issues.push(`Stray symbol${stray.length > 1 ? 's' : ''}: ${stray.join(' ')} (scanner noise)`);
  const broken = [...new Set(body.match(/\b\d+[OI]+\d*\b|\b\d+l\d+\b/g) || [])];
  if (broken.length) issues.push(`Number${broken.length > 1 ? 's' : ''} broken by the scanner: ${broken.slice(0, 4).map(w => `"${w}"`).join(', ')}`);
  const gluedWord = [...new Set(body.match(/\b\d+(?:to|of|in|is|the|and|or|at|on|by|be|as|it|if)\b/g) || [])];
  if (gluedWord.length) issues.push(`A number glued to a word: ${gluedWord.slice(0, 3).map(w => `"${w}"`).join(', ')}`);
  const vx = body.match(/\(V[a-z]\)/);
  if (vx) issues.push(`"${vx[0]}" is a misread symbol (∀ or √)`);
  if (!page) {
    if ((body.replace(/\\"/g, '').match(/"/g) || []).length % 2) issues.push('A quotation mark is not closed');
    if ((body.replace(/\\\$/g, '').match(/\$/g) || []).length % 2) issues.push('A math formula ($…$) is not closed');
  }
  if (/\blog,\s*\w/.test(body)) minor.push('"log, n": the base subscript was lost (probably log₂ n)');
  if (page) return { bad: issues.length > 0, issues, minor };
  // 3. The question itself: the part after its own "Q.n" (a linked pair carries its partner's text before it)
  const marks = [...t.matchAll(/(?:^|\n)[\s*_#>]*Q\s*\.?\s*\d{1,3}\b/g)];   // "Q.7", or "**Q.7**" from the vision model
  const own = marks.length ? t.slice(marks[marks.length - 1].index) : t;
  const opts = optionLabels(own), letters = opts.map(o => o.L);
  // Brackets over the whole text, shared statement included (an interval like [0, 1) still balances: opens and closes are counted together)
  let flat = t;
  for (const s of labelSpans(t).reverse()) flat = flat.slice(0, s.at) + ' '.repeat(s.end - s.at) + flat.slice(s.end);
  flat = flat.replace(/\\[{}]/g, '').replace(/^\s*\(?([ivx]{1,4}|\d{1,2})\)/gm, ' ');
  const d = (flat.match(/[([{]/g) || []).length - (flat.match(/[)\]}]/g) || []).length;
  if (!code.length && Math.abs(d) >= 2) issues.push(`Brackets don't balance (${Math.abs(d)} more ${d > 0 ? 'opening' : 'closing'})`);
  else if (!code.length && d) minor.push('One bracket is not closed');
  const stem = (opts.length ? own.slice(0, opts[0].at) : own).replace(/^[\s*_#>]*Q\s*\.?\s*\d{1,3}[\s*_]*/, '').trim();
  if (opts.length) {
    const dup = letters.filter((L, i) => letters.indexOf(L) !== i);
    if (dup.length) issues.push(`Option ${[...new Set(dup)].join(', ')} appears twice`);
    const missing = 'ABCD'.split('').filter(L => !letters.includes(L));
    if (missing.length && missing.length < 4) issues.push(`Option${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing`);
    const norm = s => String(s).replace(/[\s$`]+/g, '').toLowerCase();   // (not plainText: "n*" and "n" must stay different)
    const texts = opts.map(o => norm(o.text));
    if (opts.length < 2) issues.push('Fewer than 2 options were read');
    else if (texts.filter(Boolean).length < 2) issues.push('The options have no text (pictures that were not read?)');
    else {
      const same = opts.filter((o, i) => texts[i] && texts.indexOf(texts[i]) !== i);
      if (same.length) issues.push(`Two options are the same: "${plainText(same[0].text).trim().slice(0, 30)}"`);
      const isNum = s => /^-?\d+(\.\d+)?$/.test(s);
      if (texts.filter(isNum).length >= 2) {
        const odd = opts.filter((o, i) => texts[i] && !isNum(texts[i]) && /^[\dsoilzb.,]+$/i.test(texts[i]) && /[a-z]/i.test(texts[i]));
        if (odd.length) issues.push(`Option ${odd.map(o => `${o.L} "${o.text.trim()}"`).join(', ')}: a number broken by the scanner`);
      }
      const junk = opts.filter((o, i) => texts[i] && (/^[,.;:]/.test(texts[i]) || !/[A-Za-z0-9]/.test(texts[i])));
      if (junk.length) issues.push(`Option ${junk.map(o => o.L).join(', ')} looks misread: "${junk[0].text.trim().slice(0, 30)}"`);
    }
  } else {
    // GATE CS papers up to 2013 had only multiple-choice questions; later ones ask for options when they say so.
    if ((year && +year <= 2013) || /which (one )?of the following/i.test(stem)) issues.push('No options found (A)–(D)');
    if (/(\b(the|a|an|of|to|is|are|and|or|in|with|for|by|from|that|which|than|as)|[,(])\s*$/i.test(stem)) issues.push(`The question is cut off: "…${stem.slice(-30)}"`);
  }
  if (plainText(stem).replace(/\s+/g, ' ').trim().length < 25) issues.push('The question text is too short');
  // A linked question saved without its shared statement ("the above reference string", "the grammar", "answer to Q.76").
  const before = marks.length ? t.slice(0, marks[marks.length - 1].index).trim() : '';
  const myNum = (own.match(/^[\s*_#>]*Q\s*\.?\s*(\d{1,3})/) || [])[1];
  const refs = stem.match(/\b(the above|above \w+|this (automaton|grammar|program|code|table|figure|diagram|circuit)|the (automaton|grammar|FSA|DFA|CFG)\b)/i)
    || [...stem.matchAll(/\bQ\s*\.?\s*(\d{1,3})\b/g)].find(m => m[1] !== myNum);
  if (refs && before.length < 40 && !/\b(consider|let|suppose)\b|\bgiven (that|the|a|an|below|following)\b/i.test(stem)) issues.push(`It refers to "${refs[0]}", but the shared statement it needs is not in the text`);
  return { bad: issues.length > 0, issues, minor };
}
function yearHint(...texts) { for (const t of texts) { const m = String(t || '').match(PYQ_MARK) || String(t || '').match(/\b((?:19|20)\d{2})\b/); if (m) return m[1]; } return ''; }
// Photos/screenshots uploaded in the PYQs tab: read each (OCR + vision), then pull out and classify its questions.
// onStep({ i, total, stage, name, found }) reports progress for the upload panel.
async function pyqFromImages(files, year, signal, onStep = () => {}) {
  const found = [];
  for (let i = 0; i < files.length; i++) {
    const name = files[i].name || `Image ${i + 1}`;
    jobLabel(`Reading image ${i + 1} of ${files.length}`, signal); progress(i, files.length, signal);
    onStep({ i, total: files.length, stage: 'Reading the text (OCR + vision)', name, found: found.length });
    const file = await normalizeUpload(files[i]);
    const r = await readImage(await blobToCanvas(file, 2400), { label: name, signal, detailed: true, onToken: (_, o) => live(o, signal), onStage: t => { jobLabel(`${name}: ${t}`, signal); onStep({ i, total: files.length, stage: t, name, found: found.length }); } });
    jobLabel(`Finding the questions in image ${i + 1}`, signal);
    onStep({ i, total: files.length, stage: 'Finding and classifying the questions', name, found: found.length });
    const qs = await pyqExtract([{ n: 1, md: r.md }], { upload: { year: year || yearHint(r.md, files[i].name) }, signal });
    found.push(...qs.map(q => ({ ...q, source: { kind: 'photo', label: name } })));
    onStep({ i: i + 1, total: files.length, stage: qs.length ? `Found ${qs.length} question${qs.length > 1 ? 's' : ''}` : 'No questions on this one', name, found: found.length });
  }
  progress(files.length, files.length, signal);
  onStep({ i: files.length, total: files.length, stage: 'Filing them by subject and year', found: found.length });
  const before = new Set(((await Store.getHub()).pyqs || []).map(p => p.id));
  await addPYQs(found);
  return ((await Store.getHub()).pyqs || []).filter(p => !before.has(p.id));
}
// PDFs uploaded in the PYQs tab: kept as a file (so pages can be cited), read in the background, and every
// question on every page goes to PYQs.
// How complete a paper's extraction is: question numbers printed on its pages vs questions in the bank.
async function pyqCoverage(sid) {
  const h = await Store.getHub(), src = (h.pyqSources || {})[sid] || {};
  let d; try { d = await Store.getData(sid); } catch { return null; }
  const pageOf = {}, printed = [];
  (d.pages || []).forEach((p, i) => { if (p && p.md) qNumbers(p.md).forEach(n => { if (!(n in pageOf)) { pageOf[n] = i + 1; printed.push(n); } }); });
  // The same paper may have been uploaded twice: count questions from any copy (same file name).
  const names = Object.fromEntries((await Store.listSites()).map(s => [s.id, s.name]));
  const sameIds = new Set(Object.keys(h.pyqSources || {}).filter(id => names[id] && names[id] === names[sid]).concat(sid));
  const found = new Set((h.pyqs || []).filter(p => p.source && sameIds.has(p.source.siteId)).map(p => pyqNum(p)).filter(Boolean));
  const missing = printed.filter(n => !found.has(n)).sort((a, b) => a - b);
  return { printed: printed.length, found: printed.filter(n => found.has(n)).length, missing, pages: [...new Set(missing.map(n => pageOf[n]))] };
}
// Re-checks only the pages holding the missing questions.
async function pyqRecheck(sid, pages) {
  const src = ((await Store.getHub()).pyqSources || {})[sid] || {};
  await updateHub(h => {
    pages.forEach(n => { if (h.pyqDone) delete h.pyqDone[`${sid}:${n}`]; });
    if (h.pyqSources && h.pyqSources[sid]) delete h.pyqSources[sid].complete;
  });
  let d = {}; try { d = await Store.getData(sid); } catch {}
  await PyqScan.queuePages(sid, src.name || 'PDF', pages.map(n => ({ n, md: ((d.pages || [])[n - 1] || {}).md })));
}
async function pyqFromPdfs(files, year) {
  const h = await Store.getHub(), sites = new Set((await Store.listSites()).map(s => s.id));
  for (const f of files) {
    const dup = Object.entries(h.pyqSources || {}).find(([id, s]) => s.name === f.name && sites.has(id));
    if (dup) { toast(`${f.name} was already uploaded. Use "Find the missing ones" on it if questions are missing.`); continue; }
    const meta = await Store.createSite(f, f.name);
    await updateHub(h => { h.pyqSources = h.pyqSources || {}; h.pyqSources[meta.id] = { year: year || yearHint(f.name), name: f.name, added: new Date().toISOString() }; });
    await Reader.enqueue({ siteId: meta.id, name: f.name });
  }
}
// The same paper uploaded again (same file name, uploaded later): its questions are already in the bank.
async function pyqDupOf(sid) {
  const h = await Store.getHub();
  if (!(h.pyqSources || {})[sid]) return null;
  const sites = await Store.listSites(), me = sites.find(s => s.id === sid);
  if (!me) return null;
  const other = sites.find(s => s.id !== sid && s.name === me.name && (h.pyqSources || {})[s.id] && s.created < me.created);
  return other ? other.id : null;
}
const PyqScan = {
  async queuePages(siteId, name, pages) {   // pages: [{ n, md }]
    if (await pyqDupOf(siteId)) return;
    const src = ((await Store.getHub()).pyqSources || {})[siteId];
    const hits = pages.filter(p => p && p.md && (src ? p.md.trim().length > 60 : hasPyqMark(p.md)));
    if (!hits.length) return;
    await updateHub(h => {
      h.pyqScan = h.pyqScan || [];
      h.pyqDone = h.pyqDone || {};
      for (const p of hits) { const k = `${siteId}:${p.n}`; if (!h.pyqDone[k] && !h.pyqScan.some(x => x.siteId === siteId && x.page === p.n)) h.pyqScan.push({ siteId, name, page: p.n }); }
    });
    this.kick();
  },
  kick() { bus.postMessage({ type: 'pyq-kick' }); if (this._wake) this._wake(); },
  start() {
    bus.addEventListener('message', e => { if ((e.data || {}).type === 'pyq-kick' && this._wake) this._wake(); });
    const loop = async () => { for (;;) { let did = false; try { did = await this.step(); } catch (e) { console.warn('pyq scan', e); } if (!did) await new Promise(r => { this._wake = r; setTimeout(r, 15000); }); } };
    if (navigator.locks) navigator.locks.request('gate-desk-pyq', loop); else loop();
  },
  // Catch-up: pages of an uploaded paper that were read but never queued (e.g. read by a window running older code).
  async reconcile() {
    if (Date.now() - (this._rec || 0) < 60000) return;
    this._rec = Date.now();
    const h = await Store.getHub();
    let live = null;
    try { live = new Set((await Store.listSites()).map(s => s.id)); } catch {}
    for (const [sid, src] of Object.entries(h.pyqSources || {})) {
      if (src.complete) continue;
      // The book was deleted (its PYQs stay in the bank): nothing left to read, so stop retrying it every minute.
      if (live && !live.has(sid)) { await updateHub(h2 => { if (h2.pyqSources && h2.pyqSources[sid]) Object.assign(h2.pyqSources[sid], { complete: true, deleted: true }); h2.pyqScan = (h2.pyqScan || []).filter(x => x.siteId !== sid); }); continue; }
      if (await pyqDupOf(sid)) {   // drop its queued pages too
        await updateHub(h2 => { h2.pyqScan = (h2.pyqScan || []).filter(x => x.siteId !== sid); if (h2.pyqSources[sid]) Object.assign(h2.pyqSources[sid], { complete: true, duplicate: true, name: src.name || h2.pyqSources[sid].name }); });
        continue;
      }
      let d; try { d = await Store.getData(sid); } catch { continue; }
      const read = (d.pages || []).map((p, i) => p && p.md != null ? { n: i + 1, md: p.md } : null).filter(Boolean);
      const todo = read.filter(p => !(h.pyqDone || {})[`${sid}:${p.n}`] && !(h.pyqScan || []).some(x => x.siteId === sid && x.page === p.n));
      if (todo.length) await this.queuePages(sid, src.name || 'PDF', todo);
      const q = (h.queue || []).find(x => x.siteId === sid);
      if (!todo.length && read.length && (!q || q.status === 'done') && !(h.pyqScan || []).some(x => x.siteId === sid))
        await updateHub(h2 => { if (h2.pyqSources && h2.pyqSources[sid]) h2.pyqSources[sid].complete = true; });
    }
  },
  async step() {
    await this.reconcile();
    await pyqGarbleSweep();
    const h = await Store.getHub();
    const todo = h.pyqScan || [];
    // Pages still to scan come first; then misread questions are re-read carefully, one at a time.
    if (!todo.length && (h.pyqReread || []).length) { await pyqRereadOne(h.pyqReread[0]); return true; }
    if (!todo.length) return false;
    // Uploaded papers are dense: one page per call so the answer can't overflow. Other books: two pages.
    const first = todo[0], batch = todo.filter(x => x.siteId === first.siteId).slice(0, (h.pyqSources || {})[first.siteId] ? 1 : 2);
    announce({ type: 'pyq-scan', siteId: first.siteId, pages: batch.map(b => b.page) });
    let d = {};
    try { d = await Store.getData(first.siteId); } catch {}
    const pages = batch.map(b => ({ n: b.page, md: ((d.pages || [])[b.page - 1] || {}).md || '' })).filter(p => p.md);
    const found = [];
    if (pages.length) {
      const src = (h.pyqSources || {})[first.siteId];
      // A paper's year is often printed only on its first page: look there too.
      const firstPage = src && !src.year ? ((d.pages || [])[0] || {}).md : '';
      const upload = src ? { year: src.year || yearHint(firstPage, first.name) } : null;
      const qs = await pyqExtract(pages, { upload });
      found.push(...qs.map(q => ({ ...q, source: { kind: 'file', siteId: first.siteId, site: first.name, page: q.page } })));
    }
    await updateHub(h2 => {
      h2.pyqDone = h2.pyqDone || {};
      batch.forEach(b => { h2.pyqDone[`${b.siteId}:${b.page}`] = 1; });
      h2.pyqScan = (h2.pyqScan || []).filter(x => !batch.some(b => b.siteId === x.siteId && b.page === x.page));
    });
    if (found.length) await addPYQs(found);
    // One item per question number in a paper: the newest extraction wins (it replaces e.g. an older item that
    // swallowed a linked pair), unless an older one already has a written masterclass.
    if (found.length) await updateHub(h2 => {
      const best = {};
      for (const p of (h2.pyqs || []).filter(p => p.source && p.source.siteId === first.siteId)) {
        const n = pyqNum(p); if (!n) continue;
        const b = best[n];
        if (!b || (!b.master && (p.master || p.added >= b.added))) best[n] = p;
      }
      const keep = new Set(Object.values(best));
      h2.pyqs = (h2.pyqs || []).filter(p => !(p.source && p.source.siteId === first.siteId && pyqNum(p)) || keep.has(p));
    });
    announce({ type: 'pyq-scan', siteId: first.siteId });
    return true;
  },
  // Re-checks every file you've already read (and the questions already picked out of them).
  async scanAll() {
    const direct = [];
    for (const s of await Store.listSites()) {
      let d; try { d = await Store.getData(s.id); } catch { continue; }
      await this.queuePages(s.id, s.name, (d.pages || []).map((p, i) => p && { n: i + 1, md: p.md }).filter(Boolean));
      for (const q of d.questions || []) {
        const page = (d.pages || [])[q.page - 1];
        const year = pyqYearOf(q.text) || (page && hasPyqMark(page.md) ? pyqYearOf(page.md) : '');
        if (year) direct.push({ text: q.text, year, source: { kind: 'file', siteId: s.id, site: s.name, page: q.page } });
      }
    }
    if (direct.length) await addPYQs(direct);
  },
};

// ---------- the checked answer ----------
// An exact calculator's / runner's result as a PYQ answer.
function exactAnswer(s, q, key = '') {
  const keyAgree = key ? compareAnswers(s.value, s.text, key, q) : null;
  const o = normAnswer(s.value, q);   // a number that matches an option: show both, e.g. "C (9)"
  return { text: o.kind === 'opt' && !/^[A-D]\b/.test(s.text) ? `${o.v} (${s.text})` : s.text, level: 'exact', by: `the exact ${s.name} calculator`, key, keyAgree, check: { solver: s.name, computed: s.text, steps: s.steps, params: s.params }, votes: [] };
}
// "Edit question": the corrected text is checked with the exact calculators / runners (C programs run for real).
// given = the answer the student typed ('' = none). Returns { exact, agree }: exact = the calculator's answer or
// null when none applies; agree = whether it matches the typed answer (null if either is missing).
async function pyqCheckEdit(text, given, signal) {
  let s = null;
  try { s = await Solvers.answer(text, signal); } catch (e) { if (e.name === 'AbortError') throw e; console.warn('edit check', e); }
  if (!s) return { exact: null, agree: null };
  return { exact: exactAnswer(s, text, given || ''), agree: given ? compareAnswers(s.value, s.text, given, text) : null };
}
// Saves a hand-corrected PYQ. answer: the answer object to keep (null = check it again when it is opened).
async function pyqSaveEdit(id, text, answer) {
  await updateHub(h => {
    const x = (h.pyqs || []).find(y => y.id === id);
    if (!x) return;
    // A new text or a new answer: the masterclass taught the old one, so it is written again.
    const ansChanged = !x.officialKey && String((x.answer || {}).text || '') !== String((answer || {}).text || '');
    if (x.text.trim() !== String(text).trim()) { x.textBefore = x.textBefore || x.text; pyqSetText(x, text); }
    else if (ansChanged) { x.parts = []; x.master = ''; x.reviews = []; }
    if (!x.officialKey) x.answer = answer;
    x.handChecked = new Date().toISOString();
    const g = pyqGarble(x.text, { year: x.year });
    x.garble = { ver: GARBLE_VER, issues: g.issues, minor: g.minor };
    delete x.needsCheck;
    h.pyqReread = (h.pyqReread || []).filter(r => r.id !== id);
  });
  announce({ type: 'pyqs' });
}
// Priority: an exact calculator; else the answer printed in your material if independent solves agree
// with it; else the majority of 3 independent solves, with a program check. Disagreements are reported.
async function pyqVerify(p, signal) {
  const q = p.text, key = p.materialKey || '';
  if (p.officialKey) return officialAnswer(p, null);
  let s = null;
  jobLabel('Checking the answer with the exact calculators', signal);
  try { s = await Solvers.answer(q, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
  if (s) return exactAnswer(s, q, key);
  const answers = [];
  for (const t of [0, 0.5, 0.7]) {
    jobLabel(`Solving it independently (${answers.length + 1} of 3)`, signal);
    try { answers.push(await blindAnswer(q, signal, t)); } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  const grouped = () => { const gs = []; for (const a of answers.filter(Boolean)) { const g = gs.find(g => voteMatch(a, g[0], q)); if (g) g.push(a); else gs.push([a]); } return gs.sort((a, b) => b.length - a.length); };
  let groups = grouped(), bigAns = null;
  // The solves split: the bigger model (if installed) gets a vote too.
  const bm = bigModel();
  if (bm && groups.length > 1) {
    jobLabel(`The solves disagree: asking the bigger model (${bm})`, signal);
    try { bigAns = (await secondOpinion(q, signal)).answer; answers.push(bigAns); groups = grouped(); } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  const maj = groups.length ? groups[0][0] : '';
  const votes = answers.map((a, i) => ({ answer: a.slice(0, 60), match: voteMatch(a, maj, q), ...(bigAns != null && i === answers.length - 1 ? { big: true, model: bm } : {}) }));
  // The printed key is used only if at least one independent solve reaches it; otherwise it is reported as a likely misprint.
  const backers = key ? answers.filter(a => voteMatch(a, key, q)).length : 0;
  if (key && backers) {
    const keyAgree = maj ? voteMatch(key, maj, q) : null;
    return { text: key, level: backers === answers.length ? 'high' : keyAgree ? 'good' : 'low', by: 'the answer key printed in your material', key, keyAgree,
      votes: answers.map(a => ({ answer: a.slice(0, 60), match: voteMatch(a, key, q) })), majority: maj };
  }
  let check = null;
  jobLabel('Cross-checking with a program', signal);
  try { check = await crossCheck(q, `## Answer\n${maj}`, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
  const keyNote = key ? { key, keyAgree: false } : {};
  if (check && check.agree === false && check.computed != null) return { text: maj, level: 'conflict', by: 'a majority of independent solves', votes, check, ...keyNote };
  return { text: maj, level: key ? 'low' : confidenceLevel(check, votes), by: 'a majority of independent solves', votes, check, ...keyNote, majority: maj };
}
function pyqAnswerHtml(p) {
  const a = p.answer;
  if (!a) return '';
  if (a.level === 'official') {
    const t = a.tutor;
    const vs = !t ? '' : a.tutorAgree === false
      ? `<p class="small"><b>Note:</b> before the key was added, ${escapeHtml(t.by || 'the tutor')} had worked out <b>${escapeHtml(t.text)}</b> (${escapeHtml(CONF_TEXT[t.level] || t.level)}). That was wrong; the official key wins.${p.master ? ' If the masterclass below was written before the key, press <b>Rewrite</b> so it teaches the official answer.' : ''}</p>`
      : a.tutorAgree ? `<p class="small muted">The tutor's own solving got the same answer (${escapeHtml(t.text)}).</p>` : '';
    return `<div class="pyq-answer">${confidenceHtml({ level: 'official' })}
      <div class="row"><span class="small muted">Correct answer</span><b class="pyq-ans">${a.text === 'MTA' ? 'Marks to all' : escapeHtml(a.text)}</b><span class="small muted">from ${escapeHtml(a.by)}</span></div>
      ${a.text === 'MTA' ? '<p class="small">The official key gave marks to everyone for this question: it was judged flawed or ambiguous. Section 9 discusses why.</p>' : ''}${vs}</div>`;
  }
  const keyNote = a.key && a.keyAgree === false ? `<p class="small"><b>Note:</b> the key printed in your material says <b>${escapeHtml(a.key)}</b>, but ${a.check && a.check.solver ? 'the exact calculator' : 'independent solving'} gets <b>${escapeHtml(a.check && a.check.solver ? a.text : (a.majority || a.text))}</b>. Printed keys are sometimes wrong; section 9 discusses it.</p>` : '';
  return `<div class="pyq-answer">${confidenceHtml({ level: a.level, votes: a.votes || [], check: a.check })}
    <div class="row"><span class="small muted">Correct answer</span><b class="pyq-ans">${escapeHtml(a.text || '?')}</b><span class="small muted">checked by ${escapeHtml(a.by || '')}</span></div>${keyNote}
    ${a.check && a.check.solver ? crossCheckHtml({ ...a.check, agree: true }) : ''}</div>`;
}

// ---------- official GATE answer keys ----------
// hub.officialKeys = { '<year>' or '<year>-<set>': { year, set, keys: { 42: 'D', 27: '3.5 to 3.6', 9: 'MTA', 30: 'A;C' }, name, added } }
// A key beats every other source of an answer. When one arrives, the tutor's earlier answers are compared with it
// (that also tells the calibration how often each confidence level was really right).
function normKeyAns(s) {
  const a = String(s || '').trim().replace(/^\(|\)$/g, '').replace(/\s+/g, ' ');
  if (/^(mta|marks? to all|marks given to all|all)$/i.test(a)) return 'MTA';
  const r = a.match(/^(-?\d+(?:\.\d+)?)\s*(?:to|:|–|—|~)\s*(-?\d+(?:\.\d+)?)$/i);
  if (r) return +r[1] === +r[2] ? r[1] : `${r[1]} to ${r[2]}`;
  if (/^[A-D](?:\s*(?:[;,&/]|or|and)\s*[A-D])*$/i.test(a)) return [...new Set(a.toUpperCase().match(/[A-D]/g))].sort().join(';');
  if (/^-?\d+(?:\.\d+)?$/.test(a)) return a;
  return '';
}
// Pulls "question number → answer" out of the text of a key. Handles the official table rows
// ("27 1 NAT CS 3.5 to 3.6 2": number, session, type, section, key, marks) and plain lists ("1 B 2 C", "42. D").
function parseKeyText(text) {
  const keys = {};
  const put = (n, a) => { n = +n; a = normKeyAns(a); if (n >= 1 && n <= 150 && a && !(n in keys)) keys[n] = a; };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\bQ\s*\.?\s*(?:No\.?\s*)?(?=\d)/gi, '').replace(/[|\t]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const row = line.match(/^(\d{1,3}) (?:\d )?(MCQ|MSQ|NAT) [A-Z]{2,3}\d? (.+?) ([12])$/i);
    if (row) { put(row[1], row[3]); continue; }
    const re = /(?:^|\s)(\d{1,3})\s*[.):=–-]?\s+\(?(MTA|Marks to all|[A-D](?:\s*[;,&]\s*[A-D])*|-?\d+(?:\.\d+)?(?:\s*(?:to|:)\s*-?\d+(?:\.\d+)?)?)\)?(?=\s|$)/gi;
    const pairs = []; let m;
    while ((m = re.exec(line))) pairs.push([m[1], m[2]]);
    // Several pairs on one line: only trust lettered or range answers (a row of plain numbers could be anything).
    for (const [n, a] of pairs) if (pairs.length === 1 || !/^-?\d+(\.\d+)?$/.test(a.trim())) put(n, a);
  }
  return keys;
}
const KEY_SCHEMA = { type: 'object', required: ['answers'], properties: { answers: { type: 'array', items: { type: 'object', required: ['number', 'answer'], properties: { number: { type: 'integer' }, answer: { type: 'string' } } } } } };
async function keyByModel(text, signal) {
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'This is the official answer key of a GATE exam paper. List every question number with its key exactly as printed: an option letter (e.g. "B"), several letters for MSQ (e.g. "A;C"), a number, a numeric range (e.g. "3.5 to 3.6"), or "MTA" for marks to all. Skip headers, marks and section names. Return JSON.' },
    { role: 'user', content: String(text).slice(0, 12000) },
  ], { signal, format: KEY_SCHEMA, temperature: 0, maxTokens: 4000, model: checkModel() }));
  const keys = {};
  for (const r of j.answers || []) { const a = normKeyAns(r.answer); if (r.number >= 1 && r.number <= 150 && a) keys[r.number] = a; }
  return keys;
}
// Text of a key file: the PDF text layer row by row (scanned pages are OCR'd), or OCR of a photo.
async function keyFileText(file, signal, onStage = () => {}) {
  if ((await sniffExt(file)) === 'pdf') {
    const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (signal && signal.aborted) throw new DOMException('Stopped', 'AbortError');
      onStage(`Reading page ${n} of ${doc.numPages}`);
      const page = await doc.getPage(n), tc = await page.getTextContent();
      const rows = {};
      for (const it of tc.items) { if (!it.str.trim()) continue; const y = Math.round(it.transform[5] / 3); (rows[y] = rows[y] || []).push(it); }
      let t = Object.keys(rows).sort((a, b) => b - a).map(y => rows[y].sort((a, b) => a.transform[4] - b.transform[4]).map(it => it.str.trim()).join(' ')).join('\n');
      if (t.replace(/\s/g, '').length < 40) {   // a scanned page
        onStage(`Page ${n}: no text layer, reading it with OCR`);
        const vp = page.getViewport({ scale: 1 }), sc = Math.min(3, 2200 / vp.width), v = page.getViewport({ scale: sc });
        const c = document.createElement('canvas'); c.width = v.width; c.height = v.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
        t = (await ocrCanvas(c)).text;
      }
      out.push(t);
    }
    return out.join('\n');
  }
  onStage('Reading the image with OCR');
  return (await ocrCanvas(await blobToCanvas(await normalizeUpload(file), 2400))).text;
}
// Reads key files into "number answer" lines for the student to check before saving.
async function keyFromFiles(files, signal, onStage) {
  let text = '';
  for (const f of files) text += '\n' + await keyFileText(f, signal, t => onStage(`${f.name}: ${t}`));
  let keys = parseKeyText(text);
  if (Object.keys(keys).length < 5 && text.replace(/\s/g, '').length > 60) {
    onStage('Reading the table with the model');
    const more = await keyByModel(text, signal);
    if (Object.keys(more).length > Object.keys(keys).length) keys = more;
  }
  return { keys, text, year: yearHint(text, files.map(f => f.name).join(' ')) };
}
function keyLines(keys) { return Object.keys(keys).map(Number).sort((a, b) => a - b).map(n => `${n} ${keys[n]}`).join('\n'); }
function keySetNorm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(CSE?|SET|PAPER|SESSION)/, ''); }
// The key entry for a PYQ: same year and question number; a set-specific key needs the same set, unless it is the year's only key.
function officialKeyFor(p, all) {
  const n = pyqNum(p);
  if (!p.year || !n) return null;
  const cands = Object.entries(all || {}).filter(([, k]) => k.year === p.year && k.keys && k.keys[n] != null);
  const fit = cands.filter(([, k]) => !k.set || (p.set && keySetNorm(k.set) === keySetNorm(p.set)));
  const use = fit.length ? fit[0] : cands.length === 1 ? cands[0] : null;
  return use ? { id: use[0], ans: use[1].keys[n], label: `the official GATE ${use[1].year}${use[1].set ? ' (' + use[1].set + ')' : ''} answer key` } : null;
}
// Does an answer agree with an official key? null = can't tell (marks to all, or not comparable).
function officialAgrees(key, ans, q) {
  if (!ans || !key || key === 'MTA') return null;
  const r = key.match(/^(-?[\d.]+) to (-?[\d.]+)$/);
  if (r) { const v = parseFloat((String(ans).match(/-?\d+(?:\.\d+)?/) || [])[0]); return isNaN(v) ? null : v >= +r[1] - 1e-9 && v <= +r[2] + 1e-9; }
  if (/^[A-D](;[A-D])*$/.test(key)) {
    const o = normAnswer(ans, q);
    if (o.kind !== 'opt') return null;
    const want = key.split(';'), got = o.v.split(',');
    if (want.join() === got.join()) return true;
    // An MCQ key listing two letters means either was accepted; an MSQ key means all of them.
    const msq = /\bMSQ\b|one or more|more than one|which of the following (?:is|are) (?:correct|true)\?[\s\S]*\bselect all/i.test(q);
    return !msq && want.length > 1 && got.length === 1 && want.includes(got[0]);
  }
  return voteMatch(ans, key, q);
}
function officialAnswer(p, prev) {
  const k = p.officialKey, tutor = prev && prev.level !== 'official' ? { text: prev.text, level: prev.level, by: prev.by } : prev && prev.tutor || null;
  return { text: k, level: 'official', by: p.officialFrom || 'the official GATE answer key', tutor, tutorAgree: tutor ? officialAgrees(k, tutor.text, p.text) : null, votes: [] };
}
// Applies every saved key to the bank. Returns { matched, changed, disagreed }.
async function applyOfficialKeys() {
  let matched = 0, changed = 0, disagreed = 0;
  const calib = [];
  await updateHub(h => {
    for (const p of h.pyqs || []) {
      const k = officialKeyFor(p, h.officialKeys);
      if (!k) { if (p.officialKey) { delete p.officialKey; delete p.officialFrom; if (p.answer && p.answer.level === 'official') p.answer = p.answer.tutor ? { ...p.answer.tutor, votes: [] } : null; } continue; }
      matched++;
      if (p.officialKey === k.ans && p.answer && p.answer.level === 'official') continue;
      const prev = p.answer;
      p.officialKey = k.ans; p.officialFrom = k.label;
      p.answer = officialAnswer(p, prev);
      changed++;
      if (p.answer.tutorAgree === false) { disagreed++; p.keyConflict = !!p.master; }
      // How often was the tutor right at that confidence level? (only the first time a key meets that answer)
      if (prev && prev.level !== 'official' && p.answer.tutorAgree != null) calib.push({ level: prev.level, right: p.answer.tutorAgree });
    }
  });
  if (calib.length) await Calib.record(calib);
  if (changed) announce({ type: 'pyqs' });
  return { matched, changed, disagreed };
}

// ---------- the masterclass (the student's 22-part PYQ format) ----------
const PYQ_ROLE = `You are an elite Computer Science professor, GATE instructor and technical interviewer. The PYQ (previous-year GATE question) is the ENTRY POINT into the lesson, not the lesson. The student may know very little about the topic. The goal is NOT "I can solve this PYQ" but "I understand the principle deeply enough to solve a completely NEW question on it". PYQ → understanding → derivation → mastery, never PYQ → memorised answer.
Rules: never start with the answer. Reverse-engineer the PYQ into every concept and hidden prerequisite it needs, and teach missing prerequisites first. Never write "as you know", "obviously", "simply apply the formula", "this can be skipped". Teach from first principles. Formulas are derived, never just stated: why it exists, what each term means, where it comes from, why it works, when it can and cannot be used, how an examiner can modify it. Never hide intermediate steps: for A → B → C, explain why each arrow holds. Teach the conceptual neighbourhood, not just the minimum needed for this answer. Mnemonics only after understanding.
Source integrity: the material the student provided (below) is the primary source; keep its terminology. When you add your own knowledge, label it "Additional explanation:". Never claim something came from the material if it did not.
Visuals: use ASCII diagrams inside \`\`\`text blocks for concept maps, trees and flows. Use a \`\`\`mermaid diagram only when it materially improves understanding. Comparison tables in Markdown when related concepts exist. LaTeX for math ($...$).`;
const PYQ_PARTS = [
  { max: 7000, sections: `## 1. ORIGINAL PYQ
(reproduce the question accurately with all options, and its GATE year; do not alter its meaning)
## 2. WHAT IS THIS QUESTION REALLY TESTING?
(the hidden concepts; what the examiner is actually testing)
## 3. QUESTION CLASSIFICATION
### Difficulty
(⭐ Easy … ⭐⭐⭐⭐⭐ Advanced/Tricky, and why)
### Question Type
(conceptual / numerical / derivation / application / trick / multi-concept / statement-based / algorithmic / programming / proof-based, and why)
## 4. CONCEPT MAP
(ASCII tree: PYQ → concepts → prerequisites → required theory → solution)
## 5. PREREQUISITE CHECK
(every prerequisite marked ✅ already covered or ⚠️ needs teaching; teach each ⚠️ one properly here)
## 6. FIRST-PRINCIPLES TEACHING
(for EVERY required concept, these sub-headings: ### Why does it exist? ### What problem does it solve? ### What existed before it? ### Intuition ### Real-world analogy ### Simple example ### Formal definition ### Explain every term ### Internal working ### Properties ### Counterexamples ### Common misconceptions)
## 7. DERIVATIONS
(derive the formulas, rules, conditions, theorems or algorithms needed, every step justified; say when each can NOT be used)
## 8. WORKED EXAMPLES
### Example 1 — Very Simple
### Example 2 — Moderate
### Example 3 — PYQ-Level
(new examples, not the PYQ itself; every step shown)
Do NOT solve the original PYQ and do NOT reveal or hint at its answer in these sections.` },
  { max: 7000, sections: `## 9. RETURN TO THE ORIGINAL PYQ
(STEP 1 read and interpret · STEP 2 exactly what is asked · STEP 3 the tested concept · STEP 4 the given information · STEP 5 the required principle · STEP 6 apply it · STEP 7 EVERY intermediate step · STEP 8 the answer · STEP 9 verify it independently · STEP 10 why it is correct. If the question is ambiguous, has a typo, a missing assumption or a wrong printed key, say so: literal interpretation, likely examiner intent, standard interpretation, result under each.)
## 10. OPTION-BY-OPTION ANALYSIS
(EVERY option: why someone might choose it, why it is correct/incorrect, what misconception it represents. For a numerical answer, analyse the typical wrong answers instead.)
## 11. WHY THE ANSWER WORKS
(the fundamental reason, not "the formula gives it")
## 12. FAST EXAM METHOD
(METHOD 1 fundamental, METHOD 2 faster exam method, METHOD 3 alternative reasoning if any; which to use in the exam and why; ### GATE Shortcut and when it fails)
## 13. COMMON TRAPS
(for each: ❌ Mistake · why students make it · why it is wrong · ✅ correct mental model)
## 14. WHEN YOU SEE THIS IN GATE
(pattern recognition: "If you see X → think Y")` },
  { max: 6000, sections: `## 15. GENERALIZATION
(3-5 variations: small modification, conceptual twist, numerical modification, reverse question, difficult/tricky version; fully solve two representative ones)
## 16. RELATED PYQ PATTERNS
(Same concept: Easy → Moderate → Tricky → Advanced patterns. Label a question as ACTUAL PYQ, with its real GATE year (for example "**ACTUAL PYQ, GATE 2014**"), ONLY if it is in the student's bank listed below; label everything you write yourself "**PRACTICE QUESTION**". Never call a practice question an actual PYQ.)
## 17. INTERVIEW PERSPECTIVE
(what an interviewer asks next, follow-ups, deeper and practical questions)
## 18. REAL-WORLD APPLICATION
(only meaningful uses: Linux, PostgreSQL/MySQL, TCP/IP, LLVM/GCC, modern CPUs, JVM… skip it if forced)
## 19. MEMORY FRAMEWORK
(only now: mnemonics, mental models, memory tricks, key relationships)
## 20. FINAL KNOWLEDGE MAP
(compact ASCII map: topic → concepts → principles → PYQ → general rule → new questions)
## 21. SELF-TEST
(3 conceptual, 2 numerical, 2 tricky, 1 interview question, 1 harder variation. Questions only; then put ALL answers inside one block: <details><summary>Show answers</summary> … </details>)
## 22. FINAL REVISION SHEET
(concise: core concepts, essential formulas, important conditions, common traps, recognition patterns, exam shortcuts)
After section 22 stop: the student will press "continue" for the next PYQ.` },
];
// Keeps only this part's sections (the model sometimes runs on into sections 23, 24… or repeats one), each once, in order.
function keepSections(md, nums) {
  const chunks = String(md).split(/^(?=##\s*\d+\b)/m), seen = new Set(), keep = [];
  for (const c of chunks) {
    const n = (c.match(/^##\s*(\d+)\b/) || [])[1];
    if (n == null) { if (!keep.length) keep.push(c); continue; }   // text before the first heading
    if (!nums.includes(+n) || seen.has(+n)) continue;
    seen.add(+n); keep.push(c);
  }
  return keep.filter(c => /^##/.test(c)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]).join('').trim();
}
async function pyqMaterial(p) {
  if (!p.source || p.source.kind !== 'file') return '';
  try {
    const d = await Store.getData(p.source.siteId), pg = p.source.page;
    return [pg - 1, pg].map(n => ((d.pages || [])[n - 1] || {}).md || '').filter(Boolean).join('\n\n').slice(0, 5000);
  } catch { return ''; }
}
function pyqRelated(p, all) {
  const toks = new Set(topicTokens((p.concept || '') + ' ' + p.text));
  return all.filter(x => x.id !== p.id && x.subject === p.subject).map(x => ({ x, s: topicTokens((x.concept || '') + ' ' + x.text).filter(t => toks.has(t)).length }))
    .filter(o => o.s >= 2).sort((a, b) => b.s - a.s).slice(0, 5).map(o => `- GATE ${o.x.year || '(year unknown)'}: ${plainText(o.x.text).replace(/\s+/g, ' ').slice(0, 260)}`).join('\n');
}
// Writes (or resumes) the masterclass in three parts. onText(md) is called while it streams.
async function pyqMasterclass(p, signal, onText = () => {}) {
  const parts = (p.parts || []).slice();
  const material = await pyqMaterial(p), all = (await Store.getHub()).pyqs || [];
  const mine = myNotesFor(p.text, (await Store.getHub()).notes);
  const head = `PYQ (GATE ${p.year || 'year unknown'}${p.set ? ', ' + p.set : ''}${p.number ? ', Q' + p.number : ''}${p.subject ? ', ' + p.subject : ''}):\n${p.text}` +
    (material ? `\n\nPROVIDED MATERIAL (the page it came from; primary source):\n${material}` : '') + (mine ? `\n\nTHE STUDENT'S OWN NOTES on this:\n${mine}` : '') +
    factsBlock(factsFor(p.text + ' ' + (p.concept || ''), 8, p.subject));
  for (let k = parts.length; k < PYQ_PARTS.length; k++) {
    jobLabel(`Writing the masterclass, part ${k + 1} of 3`, signal);
    const before = parts.join('\n\n');
    const outline = before ? '\n\nAlready written (do not repeat it):\n' + (before.match(/^##+ .+$/gm) || []).join('\n') + (k === 2 ? '\n\nKey teaching so far (for consistency):\n' + before.slice(0, 2500) : '') : '';
    const ans = k >= 1 && p.answer && p.answer.level === 'official' ? (p.answer.text === 'MTA'
        ? `\n\nOFFICIAL GATE KEY: marks to all (the question was judged flawed or ambiguous). Do not pretend one option is the official answer: work out the most defensible answer, then explain under question validity why it was dropped.`
        : `\n\nOFFICIAL GATE ANSWER (from ${p.answer.by}): ${p.answer.text}. Your solution must arrive at exactly this${/ to /.test(p.answer.text) ? ' (any value in that range was accepted)' : ''}.`)
      : k >= 1 && p.answer ? `\n\nVERIFIED ANSWER (for you; checked by ${p.answer.by}): ${p.answer.text}. Your solution must arrive at exactly this, rounded as the question asks.${p.answer.key && p.answer.keyAgree === false ? ` The key printed in the material says ${p.answer.key}, which disagrees: discuss this under question validity.` : ''}` : '';
    const rel = k === 2 ? `\n\nACTUAL PYQs in the student's bank on related topics (the only ones you may call ACTUAL PYQ):\n${pyqRelated(p, all) || '(none yet: so every related question you write is a PRACTICE QUESTION)'}` : '';
    const sys = `${PYQ_ROLE}\n\nWrite ONLY these sections now, in Markdown, with exactly these headings:\n${PYQ_PARTS[k].sections}${langNote()}`;
    let md = (await ollamaChat([{ role: 'system', content: sys }, { role: 'user', content: head + outline + ans + rel }],
      { signal, maxTokens: PYQ_PARTS[k].max, temperature: 0.3, onToken: (_, o) => onText([before, o].filter(Boolean).join('\n\n')) })).trim();
    // Every section must be there: write any the model ran out of room for (or skipped).
    const want = PYQ_PARTS[k].sections.match(/^## \d+\. .+$/gm) || [];
    const nums = want.map(hd => +hd.match(/\d+/)[0]);
    md = keepSections(md, nums);
    const missing = want.filter(hd => !new RegExp('^##\\s*' + hd.match(/\d+/)[0] + '\\b', 'm').test(md));
    if (missing.length) {
      jobLabel(`Writing the missing section${missing.length > 1 ? 's' : ''} ${missing.map(m => m.match(/\d+/)[0]).join(', ')}`, signal);
      const specs = PYQ_PARTS[k].sections.split(/^(?=## \d+\.)/m).filter(s => missing.some(m => s.startsWith(m))).join('');
      const more = await ollamaChat([{ role: 'system', content: `${PYQ_ROLE}\n\nWrite ONLY these sections now, in Markdown, with exactly these headings:\n${specs}${langNote()}` },
        { role: 'user', content: head + '\n\nAlready written (do not repeat it):\n' + ((before + '\n' + md).match(/^##+ .+$/gm) || []).join('\n') + ans }],
        { signal, maxTokens: 3500, temperature: 0.3, onToken: (_, o) => onText([before, md, o].filter(Boolean).join('\n\n')) });
      md = keepSections(md.replace(/\n*$/, '') + '\n\n' + more.trim(), nums);
    }
    // Fact-check this part before you read it (the verified answer and the question are the material to agree with).
    p.reviews = (p.reviews || []).slice(0, k);
    if (Cfg.get('factcheck', 'on') === 'on') {
      const fc = await factCheck(md, { title: `GATE ${p.year || ''} PYQ: ${p.concept || p.subject}`, subject: p.subject, kind: 'PYQ masterclass',
        material: `${p.text}${p.answer ? `\n\nVERIFIED ANSWER: ${p.answer.text} (checked by ${p.answer.by})` : ''}${p.officialKey ? `\nOFFICIAL GATE KEY: ${p.officialKey}` : ''}`,
        signal, onStage: t => jobLabel(`Fact-checking part ${k + 1}: ${t}`, signal) });
      md = keepSections(fc.md, nums); p.reviews[k] = fc.review;
      onText([before, md].filter(Boolean).join('\n\n'));
    }
    parts.push(md);
    p.parts = parts.slice();
    await updateHub(h => { const x = (h.pyqs || []).find(y => y.id === p.id); if (x) { x.parts = parts.slice(); x.master = parts.join('\n\n'); x.reviews = (p.reviews || []).slice(); if (parts.length >= PYQ_PARTS.length) delete x.keyConflict; } });
  }
  p.master = parts.join('\n\n');
  return p.master;
}

// ---------- full paper mode: one year's PYQs as a timed GATE paper ----------
// Marks per question follow the paper pattern of that year (stated on screen as an assumption):
// up to 2009: Q1-20 one mark, the rest two; 2010-2013: Q1-25 and Q56-60 one mark; 2014 on: Q1-5 and Q11-35 one mark.
function pyqMarks(year, n) {
  const y = +year;
  if (!n) return 1;
  if (y && y <= 2009) return n <= 20 ? 1 : 2;
  if (y && y <= 2013) return n <= 25 || (n >= 56 && n <= 60) ? 1 : 2;
  return n <= 5 || (n >= 11 && n <= 35) ? 1 : 2;
}
const GRADABLE = ['official', 'exact', 'high', 'good'];
// The papers you can sit: year (+ set) with how many questions can be graded.
function pyqPapers(all) {
  const by = {};
  for (const p of all || []) {
    if (!/^(19|20)\d{2}$/.test(p.year || '')) continue;
    const k = p.year + (p.set ? ' · ' + p.set : '');
    const e = by[k] = by[k] || { key: k, year: p.year, set: p.set || '', total: 0, gradable: 0, check: 0 };
    e.total++;
    if (p.needsCheck) e.check++;   // misread text: left out until it is fixed
    else if (p.answer && p.answer.text && GRADABLE.includes(p.answer.level)) e.gradable++;
  }
  return Object.values(by).sort((a, b) => b.year.localeCompare(a.year));
}
// One PYQ as a gradable test question (null if its answer can't be graded).
function pyqTestQuestion(p) {
  if (p.needsCheck) return null;   // the text looks misread: never graded until it is fixed
  const a = String((p.answer || {}).text || '').trim();
  if (!a || !GRADABLE.includes(p.answer.level)) return null;
  const t = fixScanMarks(p.text), inl = fixInlineOptions({ question: t, options: [], type: 'MCQ' });
  let opts, stem;
  if (inl.options.length === 4) { opts = inl.options; stem = inl.question; }
  else { opts = Object.values(optionsIn(t)); stem = opts.length >= 2 ? t.split('\n').filter(l => !/^\s*\(?[A-D][).:]\s/.test(l)).join('\n') : t; }
  const n = pyqNum(p), base = { question: stem, subject: p.subject, concept: p.concept || '', label: `GATE ${p.year} Q.${n || '?'}`, marks: pyqMarks(p.year, n), pyqId: p.id, explanation: '' };
  const sec9 = ((p.master || '').match(/^##\s*9\.[^\n]*\n([\s\S]*?)(?=^##\s*\d+\.|$(?![\s\S]))/m) || [])[1] || '';
  base.explanation = `**Answer: ${a === 'MTA' ? 'marks to all' : a}** (${p.answer.level === 'official' ? 'official GATE key' : `checked by ${p.answer.by || 'the tutor'}`}).${sec9 ? '\n\n' + sec9.trim().slice(0, 3000) : ''}`;
  if (a === 'MTA') return { ...base, type: opts.length >= 2 ? 'MCQ' : 'NAT', options: opts.length >= 2 ? opts.slice(0, 4) : [], correct: [], nat_min: 0, nat_max: 0, mta: true };
  if (opts.length >= 2) {
    const letters = /^[A-D](;[A-D])*$/.test(a) ? a.split(';') : (normAnswer(a, t).kind === 'opt' ? normAnswer(a, t).v.split(',') : []);
    if (!letters.length || letters.some(L => 'ABCD'.indexOf(L) >= opts.length)) return null;
    const msq = /\bMSQ\b|one or more|more than one|select all/i.test(t) && letters.length > 1;
    return { ...base, type: msq ? 'MSQ' : 'MCQ', options: opts.slice(0, 4), correct: msq ? letters.sort() : [letters[0]], alsoAccepted: !msq && letters.length > 1 ? letters.slice(1) : [] };
  }
  const r = a.match(/^(-?[\d.]+) to (-?[\d.]+)$/), v = parseFloat((a.match(/-?\d+(?:\.\d+)?/) || [])[0]);
  if (r) return { ...base, type: 'NAT', options: [], correct: [], nat_min: +r[1], nat_max: +r[2] };
  if (!isFinite(v)) return null;
  const tol = Number.isInteger(v) ? 0 : Math.max(0.01, Math.abs(v) * 0.005);
  return { ...base, type: 'NAT', options: [], correct: [], nat_min: +(v - tol).toFixed(4), nat_max: +(v + tol).toFixed(4) };
}
function buildPaperTest(paper, all) {
  const ps = (all || []).filter(p => p.year === paper.year && (p.set || '') === paper.set).sort((a, b) => (pyqNum(a) || 999) - (pyqNum(b) || 999));
  const qs = ps.map(pyqTestQuestion).filter(Boolean);
  const full = +paper.year <= 2009 ? 85 : 65;
  return { id: uid(), name: `GATE ${paper.year}${paper.set ? ' (' + paper.set + ')' : ''}: full paper`, kind: 'pyq-paper', created: new Date().toISOString(),
    minutes: Math.max(10, Math.round(180 * Math.min(1, qs.length / full))), questions: qs.map(q => ({ ...q, id: uid() })), left: ps.length - qs.length };
}

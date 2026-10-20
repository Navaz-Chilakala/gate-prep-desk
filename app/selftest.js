// Self-test: a fixed set of GATE-style questions with known answers. Runs the model alone, then the
// full checked pipeline (exact calculators, votes, program check), and reports real accuracy per subject.
// Each checked answer's confidence level and whether it was right feed Calib, so the confidence labels
// shown everywhere else say how often that level has actually been right on this machine.

const GOLDEN = [
  // Operating System
  { s: 'Operating System', q: 'Four processes P1, P2, P3, P4 all arrive at time 0 with CPU burst times 6, 8, 7 and 3 ms. Using non-preemptive SJF, what is the average waiting time in ms?', a: 7 },
  { s: 'Operating System', q: 'Processes (arrival, burst) in ms: P1 (0, 8), P2 (1, 4), P3 (2, 9), P4 (3, 5). Using preemptive SRTF scheduling, what is the average waiting time in ms?', a: 6.5 },
  { s: 'Operating System', q: 'P1, P2, P3 arrive at time 0 in that order with bursts 24, 3 and 3 ms. Round robin with a time quantum of 4 ms is used. What is the average waiting time in ms (to 2 decimal places)?', a: 5.67 },
  { s: 'Operating System', q: 'With 3 page frames, initially empty, and the reference string 7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1, how many page faults does FIFO replacement cause?', a: 15 },
  { s: 'Operating System', q: 'With 3 page frames, initially empty, and the reference string 7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1, how many page faults does LRU replacement cause?', a: 12 },
  { s: 'Operating System', q: "Belady's anomaly can occur with which page replacement algorithm?\n(A) LRU\n(B) Optimal\n(C) FIFO\n(D) Every stack algorithm", a: 'C' },
  { s: 'Operating System', q: 'The disk head is at cylinder 53. The request queue is 98, 183, 37, 122, 14, 124, 65, 67. What is the total head movement (in cylinders) under SSTF?', a: 236 },
  { s: 'Operating System', q: 'TLB lookup takes 20 ns and a memory access takes 100 ns. The TLB hit ratio is 80% and a single-level page table is used (TLB checked first). What is the effective memory access time in ns?', a: 140 },
  { s: 'Operating System', q: 'A system has 32-bit virtual addresses, 4 KB pages and 4-byte page table entries. What is the size of a single-level page table in MB?', a: 4 },
  { s: 'Operating System', q: 'A counting semaphore is initialised to 10. Then 6 P (wait) and 4 V (signal) operations are performed. What is its final value?', a: 8 },
  { s: 'Operating System', q: 'Which of these is NOT one of the necessary conditions for deadlock?\n(A) Mutual exclusion\n(B) Hold and wait\n(C) Preemption of resources\n(D) Circular wait', a: 'C' },
  // Computer Organization and Architecture
  { s: 'Computer Organization and Architecture', q: 'A 32 KB, 4-way set associative cache has 32-byte blocks. Addresses are 32 bits (byte addressable). How many bits are in the tag field?', a: 19 },
  { s: 'Computer Organization and Architecture', q: 'A 64 KB direct-mapped cache has 16-byte blocks, with 32-bit byte addresses. How many bits are in the index (line) field?', a: 12 },
  { s: 'Computer Organization and Architecture', q: 'A cache has a 1 ns hit time and a 90% hit rate. Main memory takes 100 ns. With hierarchical access (on a miss, the cache time is paid and then memory), what is the average memory access time in ns?', a: 11 },
  { s: 'Computer Organization and Architecture', q: 'A 5-stage pipeline has stage delays of 150, 120, 160, 140 and 130 ps, and a latch delay of 10 ps between stages. How long (in ns) does it take to execute 100 instructions with no stalls?', a: 17.68 },
  { s: 'Computer Organization and Architecture', q: 'A 4-stage pipeline has equal stage delays and no stalls. What is the ideal speedup over a non-pipelined design for a very large number of instructions?', a: 4 },
  // Computer Networks
  { s: 'Computer Networks', q: 'What is the network address of the host 200.10.12.77/26?\n(A) 200.10.12.0\n(B) 200.10.12.64\n(C) 200.10.12.77\n(D) 200.10.12.128', a: 'B' },
  { s: 'Computer Networks', q: 'How many usable host addresses does a /26 subnet have?', a: 62 },
  { s: 'Computer Networks', q: 'A 1 Mbps link uses stop-and-wait with 1000-byte frames. The one-way propagation delay is 20 ms. What is the link efficiency in percent (2 decimal places)? Ignore ACK transmission time.', a: 16.67 },
  { s: 'Computer Networks', q: 'The message 1101011011 is sent with CRC using the generator 10011. What is the CRC remainder appended to the message?\n(A) 1110\n(B) 0111\n(C) 1011\n(D) 0110', a: 'A' },
  { s: 'Computer Networks', q: 'Go-Back-N uses a sender window of 7 frames. What is the minimum number of bits needed for the sequence number?', a: 3 },
  { s: 'Computer Networks', q: 'At which OSI layer does a router mainly operate?\n(A) Physical\n(B) Data link\n(C) Network\n(D) Transport', a: 'C' },
  // Digital Logic
  { s: 'Digital Logic', q: "What is the 8-bit two's complement representation of -5?\n(A) 11111011\n(B) 11111010\n(C) 10000101\n(D) 11111100", a: 'A' },
  { s: 'Digital Logic', q: 'How many prime implicants does f(A, B, C) = Σm(0, 1, 2, 5, 6, 7) have?', a: 6 },
  { s: 'Digital Logic', q: 'Minimise f(A, B, C, D) = Σm(0, 2, 5, 7, 8, 10, 13, 15) as a sum of products. How many literals are in the minimal expression?', a: 4 },
  { s: 'Digital Logic', q: 'What is 1.5 in IEEE 754 single precision, in hexadecimal?\n(A) 0x3FC00000\n(B) 0x3F800000\n(C) 0x40000000\n(D) 0x3FA00000', a: 'A' },
  { s: 'Digital Logic', q: 'Convert the binary number 1011.101 to decimal.', a: 11.625 },
  { s: 'Digital Logic', q: "What is the smallest (most negative) number representable in 8-bit two's complement?", a: -128 },
  // Algorithms
  { s: 'Algorithms', q: 'Solve T(n) = 2T(n/2) + n.\n(A) Θ(n)\n(B) Θ(n log n)\n(C) Θ(n^2)\n(D) Θ(log n)', a: 'B' },
  { s: 'Algorithms', q: 'Solve T(n) = 8T(n/2) + n^2.\n(A) Θ(n^2)\n(B) Θ(n^2 log n)\n(C) Θ(n^3)\n(D) Θ(n^8)', a: 'C' },
  { s: 'Algorithms', q: 'What is the maximum number of comparisons binary search needs on a sorted array of 1024 elements?', a: 11 },
  { s: 'Algorithms', q: 'How many edges does a spanning tree of a connected graph with 10 vertices have?', a: 9 },
  { s: 'Algorithms', q: 'Which of these sorting algorithms is NOT stable in its standard form?\n(A) Merge sort\n(B) Insertion sort\n(C) Heap sort\n(D) Bubble sort', a: 'C' },
  // Programming and Data Structures
  { s: 'Programming and Data Structures', q: 'Keys 43, 165, 62, 123, 142 are inserted in that order into an empty hash table of size 10 with h(k) = k mod 10 and linear probing. At which index does 142 end up?', a: 6 },
  { s: 'Programming and Data Structures', q: 'What is the maximum number of nodes in a binary tree of height 4, where a single node has height 0?', a: 31 },
  { s: 'Programming and Data Structures', q: 'What is the postfix form of a + b * c?\n(A) abc*+\n(B) ab+c*\n(C) +a*bc\n(D) abc+*', a: 'A' },
  // Theory of Computation
  { s: 'Theory of Computation', q: 'Which of these languages is NOT context-free?\n(A) { a^n b^n | n ≥ 0 }\n(B) { a^n b^n c^n | n ≥ 0 }\n(C) Palindromes over {a, b}\n(D) (ab)*', a: 'B' },
  { s: 'Theory of Computation', q: 'How many states does the minimal complete DFA have for binary strings that end in 01?', a: 3 },
  // Databases
  { s: 'Databases', q: 'R(A, B, C, D) has the functional dependencies A → B and B → C. What is the attribute closure of A?\n(A) {A, B}\n(B) {A, B, C}\n(C) {A, B, C, D}\n(D) {A}', a: 'B' },
  { s: 'Databases', q: 'R(A, B, C) has the functional dependencies A → B, B → C and C → A. How many candidate keys does R have?', a: 3 },
  { s: 'Databases', q: 'A relation in which the left side of every non-trivial functional dependency is a superkey is in which normal form (the highest one guaranteed)?\n(A) 2NF\n(B) 3NF\n(C) BCNF\n(D) 4NF', a: 'C' },
  // Compiler Design
  { s: 'Compiler Design', q: 'Which of these parsers can handle the largest class of grammars?\n(A) SLR(1)\n(B) LALR(1)\n(C) Canonical LR(1)\n(D) LL(1)', a: 'C' },
  // Maths & aptitude
  { s: 'Discrete Mathematics', q: 'In how many ways can the letters of the word GATE be arranged?', a: 24 },
  { s: 'Linear Algebra', q: 'What is the determinant of the matrix [[1, 2], [3, 4]]?', a: -2 },
  { s: 'Linear Algebra', q: 'What is the sum of the eigenvalues of the matrix [[2, 0], [0, 3]]?', a: 5 },
  { s: 'Probability and Statistics', q: 'A fair coin is tossed 3 times. What is the probability of at least one head (as a decimal)?', a: 0.875 },
  { s: 'General Aptitude', q: '6 workers finish a job in 12 days. Working at the same rate, how many days do 9 workers take?', a: 8 },
];

// ---------- fact-checker test: lessons with planted errors ----------
// bad: wrong text that must be corrected (and the wrong token must disappear); good: correct text that must stay.
const FC_TESTS = [
  { title: 'Page replacement and TLB', subject: 'Operating System', md: `# Page replacement and TLB

## Step 1: Belady's anomaly
Belady's anomaly can occur in LRU page replacement: giving it more frames can increase the number of page faults.

## Step 2: FIFO example
With 3 frames and the reference string 1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5, FIFO causes 9 page faults.

## Step 3: TLB access time
With a TLB hit ratio of 0.8, TLB time 20 ns and memory time 100 ns (single-level page table), EMAT = 0.8 × 120 + 0.2 × 220 = 150 ns.

## Step 4: Deadlock
Deadlock requires all four conditions: mutual exclusion, hold and wait, no preemption and circular wait.`,
    bad: [{ text: 'can occur in LRU', gone: 'in LRU' }, { text: '= 150 ns', gone: '= 150 ns' }], good: ['FIFO causes 9 page faults', 'no preemption and circular wait'] },
  { title: 'Networks and normal forms', subject: 'Computer Networks', md: `# Networks and normal forms

## Step 1: ALOHA
The maximum throughput of slotted ALOHA is about 18.4% of the channel capacity.

## Step 2: Stop-and-wait
With a = 2, stop-and-wait efficiency is 1/(1 + 2a) = 1/5 = 0.25.

## Step 3: Subnets
A /26 subnet has 62 usable host addresses.

## Step 4: Normal forms
Every relation in BCNF is also in 3NF.`,
    bad: [{ text: 'slotted ALOHA is about 18.4%', gone: 'slotted ALOHA is about 18.4%' }, { text: '= 0.25', gone: '1/5 = 0.25' }], good: ['62 usable host addresses', 'BCNF is also in 3NF'] },
];
async function runFactCheckTest(signal, onStep = () => {}, { record = true } = {}) {
  const rows = [];
  for (let k = 0; k < FC_TESTS.length; k++) {
    const t = FC_TESTS[k];
    onStep(`Lesson ${k + 1} of ${FC_TESTS.length}: ${t.title}`);
    const r = await factCheck(t.md, { title: t.title, subject: t.subject, kind: 'fact-checker test', signal, onStage: s => jobLabel(`Fact-checker test ${k + 1}/${FC_TESTS.length}: ${s}`, signal) });
    for (const b of t.bad) rows.push({ lesson: t.title, kind: 'error', text: b.text, ok: !r.md.includes(b.gone) });
    for (const g of t.good) rows.push({ lesson: t.title, kind: 'correct', text: g, ok: r.md.includes(g) });
  }
  // test runs are not real lessons: keep them out of the accuracy log
  await updateHub(h => { h.factChecks = (h.factChecks || []).filter(f => f.kind !== 'fact-checker test'); if (record) h.fcTests = (h.fcTests || []).concat([{ at: new Date().toISOString(), model: checkModel(), rows }]).slice(-10); });
  return rows;
}
function fcTestHtml(run) {
  if (!run) return '';
  const err = run.rows.filter(r => r.kind === 'error'), good = run.rows.filter(r => r.kind === 'correct');
  return `<p class="small" style="margin-top:10px"><b>Fact-checker test:</b> caught ${err.filter(r => r.ok).length} of ${err.length} planted errors · left ${good.filter(r => r.ok).length} of ${good.length} correct statements untouched <span class="muted">(${new Date(run.at).toLocaleString()}, ${escapeHtml(run.model)})</span></p>
    <details><summary class="small">Details</summary>${run.rows.map(r => `<div class="st-row"><span>${escapeHtml(r.text)}</span><span class="small muted">${r.kind === 'error' ? 'planted error' : 'correct statement'}</span><span class="small" style="color:${r.ok ? 'var(--green)' : 'var(--red)'}">${r.ok ? (r.kind === 'error' ? '✓ corrected' : '✓ untouched') : (r.kind === 'error' ? '✗ missed' : '✗ wrongly changed')}</span></div>`).join('')}</details>`;
}
// Every PYQ with an official key (not "marks to all") is a self-test question with a known answer.
function officialGolden() {
  return (H.pyqs || []).filter(p => p.officialKey && p.officialKey !== 'MTA' && p.text).map(p => ({ q: fixScanMarks(p.text), a: p.officialKey, s: p.subject || 'Unsorted', pyq: p.id, year: p.year, num: pyqNum(p) || '?', i: -1 }));
}
function goldenRight(item, answer) {
  if (!answer) return false;
  if (item.pyq) return officialAgrees(item.a, answer, item.q) === true;   // ranges, MSQ sets, either-option keys
  const r = compareAnswers(item.a, String(item.a), answer, item.q);
  return r === true;
}
// Picks n questions spread across subjects (stable order, so runs are comparable).
function goldenSample(n) {
  if (n >= GOLDEN.length) return GOLDEN.map((g, i) => ({ ...g, i }));
  const by = {};
  GOLDEN.forEach((g, i) => (by[g.s] = by[g.s] || []).push({ ...g, i }));
  const out = [], lists = Object.values(by);
  for (let k = 0; out.length < n; k++) for (const l of lists) { if (l[k] && out.length < n) out.push(l[k]); }
  return out;
}
// thinkAlone: the "model alone" solve thinks first (measures what thinking adds to a single check).
async function runSelfTest(n, signal, onItem = () => {}, { record = true, thinkAlone = false } = {}) {
  const items = n === 'pyq' ? officialGolden() : goldenSample(n), rows = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k], t0 = Date.now();
    progress(k, items.length, signal);
    jobLabel(`Self-test ${k + 1} of ${items.length}: model alone`, signal);
    let alone = '';
    try { alone = await blindAnswer(it.q, signal, 0, checkModel(), thinkAlone); } catch (e) { if (e.name === 'AbortError') throw e; }
    // The checked pipeline: exact calculator if one applies, else 3 votes (majority), a second opinion
    // when they split (as in PYQ checks), and a program check.
    jobLabel(`Self-test ${k + 1} of ${items.length}: with checks`, signal);
    let final = alone, level = 'unchecked', big = null;
    let s = null;
    try { s = await Solvers.answer(it.q, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
    if (s) { final = s.text; level = 'exact'; }
    else {
      const answers = [alone];
      for (const t of [0.5, 0.7]) { try { answers.push(await blindAnswer(it.q, signal, t)); } catch (e) { if (e.name === 'AbortError') throw e; } }
      const grouped = () => { const gs = []; for (const a of answers.filter(Boolean)) { const g = gs.find(g => voteMatch(a, g[0], it.q)); if (g) g.push(a); else gs.push([a]); } return gs.sort((a, b) => b.length - a.length); };
      let groups = grouped();
      if (groups.length > 1 && bigModel()) {
        jobLabel(`Self-test ${k + 1} of ${items.length}: the solves disagree, second opinion`, signal);
        try { const v = await secondOpinion(it.q, signal); big = { model: v.model, answer: v.answer, right: goldenRight(it, v.answer) }; answers.push(v.answer); groups = grouped(); } catch (e) { if (e.name === 'AbortError') throw e; }
      }
      final = groups.length ? groups[0][0] : '';
      let check = null;
      try { check = await crossCheck(it.q, `## Answer\n${final}`, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
      if (check && check.solver) { final = String(check.computed); level = 'exact'; }
      else level = confidenceLevel(check, answers.slice(1).map(a => ({ answer: a, match: voteMatch(a, final, it.q) })).concat([{ match: voteMatch(alone, final, it.q) }]));
    }
    const row = { i: it.i, q: it.q.split('\n')[0].slice(0, 110), pyq: it.pyq ? `GATE ${it.year} Q.${it.num}` : '', s: it.s, alone, final, level, big, aloneRight: goldenRight(it, alone), right: goldenRight(it, final), secs: Math.round((Date.now() - t0) / 1000) };
    rows.push(row); onItem(row, k, items.length);
  }
  progress(items.length, items.length, signal);
  const run = { at: new Date().toISOString(), model: teachModel(), checkModel: checkModel(), n: rows.length,
    alone: rows.filter(r => r.aloneRight).length, checked: rows.filter(r => r.right).length, rows };
  if (record) {
    await updateHub(h => { h.selfTests = (h.selfTests || []).concat([run]).slice(-10); });
    await Calib.record(rows.map(r => ({ level: r.level, right: r.right })));
  }
  return run;
}
// ---------- model comparison: the same quick self-test (and optionally the fact-checker test) on each model ----------
// Runs in this window only (MODEL_OVERRIDE); your chosen models and the calibration are left alone.
async function runModelComparison(models, { size = 15, factcheck = false, signal, onStep = () => {} } = {}) {
  const out = [];
  try {
    for (let k = 0; k < models.length; k++) {
      const m = models[k];
      MODEL_OVERRIDE = m;
      onStep(`Model ${k + 1} of ${models.length}: ${m} (self-test)`);
      const t0 = Date.now();
      const run = await runSelfTest(size, signal, (row, i, n) => onStep(`Model ${k + 1} of ${models.length}: ${m} · question ${i + 1} of ${n}`), { record: false });
      const secs = (Date.now() - t0) / 1000 / Math.max(1, run.n);
      let fc = null;
      if (factcheck) {
        onStep(`Model ${k + 1} of ${models.length}: ${m} (fact-checker test)`);
        const rows = await runFactCheckTest(signal, s => onStep(`Model ${k + 1} of ${models.length}: ${m} · ${s}`), { record: false });
        fc = { caught: rows.filter(r => r.kind === 'error' && r.ok).length, errors: rows.filter(r => r.kind === 'error').length, kept: rows.filter(r => r.kind === 'correct' && r.ok).length, correct: rows.filter(r => r.kind === 'correct').length };
      }
      const res = { at: new Date().toISOString(), model: m, n: run.n, alone: run.alone, checked: run.checked, secs: Math.round(secs), fc };
      out.push(res);
      await updateHub(h => { h.modelRuns = (h.modelRuns || []).concat([res]).slice(-30); });
    }
  } finally { MODEL_OVERRIDE = ''; }
  return out;
}
function modelRunsHtml(runs) {
  if (!runs || !runs.length) return '<p class="small muted">No comparisons yet.</p>';
  const latest = {};
  runs.forEach(r => { latest[r.model] = r; });
  const list = Object.values(latest).sort((a, b) => b.checked / b.n - a.checked / a.n || a.secs - b.secs);
  const pct = r => Math.round(100 * r.checked / r.n);
  const cur = teachModel();
  return `<table class="mc-table"><thead><tr><th>Model</th><th>Alone</th><th>With checks</th><th>Fact-checker</th><th>Time per question</th><th></th></tr></thead><tbody>
    ${list.map((r, i) => `<tr class="${i === 0 ? 'best' : ''}"><td><b>${escapeHtml(r.model)}</b>${i === 0 ? ' <span class="pill">most accurate</span>' : ''}</td>
      <td>${Math.round(100 * r.alone / r.n)}%</td><td><b>${pct(r)}%</b> <span class="small muted">(${r.checked}/${r.n})</span></td>
      <td>${r.fc ? `${r.fc.caught}/${r.fc.errors} caught · ${r.fc.kept}/${r.fc.correct} kept` : '<span class="muted">—</span>'}</td>
      <td>${fmtDurShort(r.secs)}</td>
      <td>${r.model === cur ? '<span class="small muted">in use</span>' : `<button class="small" data-usemodel="${escapeHtml(r.model)}">Use it</button>`}</td></tr>`).join('')}</tbody></table>
    <p class="small muted">Latest run per model · ${list[0].n} questions · ${new Date(list[0].at).toLocaleDateString()}</p>`;
}
function selfTestHtml(run) {
  if (!run) return '<p class="empty">No self-test yet. Run one to see how often the tutor is actually right.</p>';
  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
  const subj = {};
  run.rows.forEach(r => { const x = subj[r.s] = subj[r.s] || { n: 0, a: 0, c: 0 }; x.n++; if (r.aloneRight) x.a++; if (r.right) x.c++; });
  const lv = {};
  run.rows.forEach(r => { const x = lv[r.level] = lv[r.level] || { n: 0, r: 0 }; x.n++; if (r.right) x.r++; });
  return `<p><b>${pct(run.alone, run.n)}%</b> right with the model alone &rarr; <b>${pct(run.checked, run.n)}%</b> with checks <span class="small muted">(${run.n} questions, ${escapeHtml(run.model)}${run.checkModel !== run.model ? ' + ' + escapeHtml(run.checkModel) + ' checking' : ''}, ${new Date(run.at).toLocaleString()})</span></p>
    <div class="pyq-bars">${hbars(Object.entries(subj).sort((a, b) => a[1].c / a[1].n - b[1].c / b[1].n).map(([s, x]) => ({ label: s, value: pct(x.c, x.n), text: `${x.c}/${x.n} (alone ${x.a})` })))}</div>
    <p class="small muted" style="margin-top:10px">Right by confidence label: ${Object.entries(lv).map(([k, x]) => `${CONF_TEXT[k].split(':')[0]} ${x.r}/${x.n}`).join(' · ')}</p>
    <details><summary class="small">Every question</summary>${run.rows.map(r => `<div class="st-row"><span>${r.pyq ? `<b>${escapeHtml(r.pyq)}</b> ` : ''}${escapeHtml(r.q || (GOLDEN[r.i] ? GOLDEN[r.i].q.split('\n')[0].slice(0, 110) : ''))}</span>
      <span class="small ${r.aloneRight ? '' : 'muted'}" title="Model alone">${r.aloneRight ? '✓' : '✗'} ${escapeHtml(String(r.alone).slice(0, 18))}</span>
      <span class="small" title="With checks (${r.level})" style="color:${r.right ? 'var(--green)' : 'var(--red)'}">${r.right ? '✓' : '✗'} ${escapeHtml(String(r.final).slice(0, 18))}</span></div>`).join('')}</details>`;
}

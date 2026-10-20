// Exact solvers for the GATE numericals small models get wrong in their heads.
// The model only READS the inputs out of the question (JSON); the arithmetic and simulation is plain,
// tested code here. Every solver returns { value, text, steps } where steps is a Markdown worked solution.
//
// Solvers.answer(question) -> null | { solver, name, params, value, text, steps }
// Solvers.list is also used by the "Exact calculators" panel in Solve.

// ---------- unit parsing (sizes in bytes, bits, times in seconds, rates in bits/s) ----------
function parseQty(s, units, dflt = 1) {
  if (typeof s === 'number') return s * dflt;
  let t = String(s || '').trim().replace(/,/g, '').replace(/\s+/g, '');
  if (!t) return NaN;
  let base;
  const pow = t.match(/^(\d+(?:\.\d+)?)?\*?2\^\(?(-?\d+)\)?(.*)$/);
  if (pow) { base = (pow[1] ? parseFloat(pow[1]) : 1) * Math.pow(2, +pow[2]); t = pow[3]; }
  else { const m = t.match(/^(-?\d*\.?\d+(?:e-?\d+)?)(.*)$/i); if (!m) return NaN; base = parseFloat(m[1]); t = m[2]; }
  if (!t) return base * dflt;
  for (const [re, mul] of units) if (re.test(t)) return base * mul;
  return NaN;
}
const SIZE_UNITS = [[/^(b|bytes?)$/, 1], [/^(kb|kib|k|kbytes?)$/i, 1024], [/^(mb|mib|m)$/i, 1024 ** 2], [/^(gb|gib|g)$/i, 1024 ** 3], [/^(tb|tib|t)$/i, 1024 ** 4],
  [/^(bits?)$/, 1 / 8], [/^(kbits?|kbit)$/i, 128], [/^(mbits?)$/i, 131072], [/^words?$/i, NaN]];
const parseBytes = s => parseQty(s, [[/^B$/, 1], ...SIZE_UNITS]);
const parseBitsSize = s => { const t = String(s); return /bit/i.test(t) && !/byte/i.test(t) ? parseQty(t.replace(/bits?/i, ''), [[/^k$/i, 1000], [/^m$/i, 1e6]]) : parseBytes(t) * 8; };
const parseTime = s => parseQty(s, [[/^(s|sec|secs|seconds?)$/i, 1], [/^(ms|msec|millisec\w*)$/i, 1e-3], [/^(us|µs|μs|microsec\w*)$/i, 1e-6], [/^(ns|nanosec\w*)$/i, 1e-9], [/^(ps)$/i, 1e-12]], 1);
const parseRate = s => parseQty(s, [[/^(bps|b\/s|bits?\/s(ec)?)$/i, 1], [/^(kbps|kb\/s|kbits?\/s)$/i, 1e3], [/^(mbps|mb\/s|mbits?\/s)$/i, 1e6], [/^(gbps|gb\/s|gbits?\/s)$/i, 1e9],
  [/^(Bps|B\/s|bytes?\/s)$/, 8], [/^(MBps|MB\/s)$/, 8e6], [/^(KBps|KB\/s)$/, 8e3]]);
const log2 = x => Math.log2(x);
const isPow2 = x => x > 0 && Number.isInteger(log2(x));
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const fmtN = x => Number.isFinite(x) ? String(round(x, 4)) : String(x);
function fmtSizeB(b) { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && Number.isInteger(b / 1024) && i < 4) { b /= 1024; i++; } return `${b} ${u[i]}`; }
const listNums = v => Array.isArray(v) ? v.map(Number) : String(v || '').split(/[\s,;]+/).filter(Boolean).map(Number);
function mdTable(head, rows) { return `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n` + rows.map(r => `| ${r.join(' | ')} |`).join('\n'); }

// ---------- CPU scheduling ----------
function cpuSchedule(p) {
  const algo = String(p.algorithm || 'FCFS').toUpperCase().replace(/[\s_-]+/g, '');
  const lowIsHigh = p.lower_number_higher_priority !== false;
  const cs = +p.context_switch || 0, q = +p.quantum || 0;
  const procs = (p.processes || []).map((x, i) => ({ name: String(x.name || 'P' + (i + 1)), at: +x.arrival || 0, bt: +x.burst, pr: +x.priority || 0, i, rem: +x.burst, start: null, ct: null }));
  if (!procs.length || procs.some(x => !(x.bt > 0))) throw new Error('Every process needs a burst time.');
  if (algo === 'RR' && !(q > 0)) throw new Error('Round robin needs a time quantum.');
  const prio = x => lowIsHigh ? x.pr : -x.pr;
  const segs = []; let t = 0, last = null, switches = 0;
  const run = (x, len) => {
    if (last && last !== x && cs) { segs.push({ name: 'CS', from: t, to: t + cs }); t += cs; }
    if (last && last !== x) switches++;
    if (x.start == null) x.start = t;
    const prev = segs[segs.length - 1];
    if (prev && prev.name === x.name && prev.to === t) prev.to = t + len; else segs.push({ name: x.name, from: t, to: t + len });
    t += len; x.rem -= len; last = x;
    if (x.rem <= 1e-9) { x.rem = 0; x.ct = t; }
  };
  const arrived = () => procs.filter(x => x.rem > 0 && x.at <= t + 1e-9);
  const idleTo = () => { const nxt = Math.min(...procs.filter(x => x.rem > 0).map(x => x.at)); if (nxt > t) { segs.push({ name: 'idle', from: t, to: nxt }); t = nxt; } };
  const by = (...keys) => (a, b) => { for (const k of keys) { const d = k(a) - k(b); if (Math.abs(d) > 1e-12) return d; } return 0; };
  if (algo === 'RR') {
    const order = procs.slice().sort(by(x => x.at, x => x.i));
    const queue = []; let k = 0;
    const admit = () => { while (k < order.length && order[k].at <= t + 1e-9) queue.push(order[k++]); };
    while (procs.some(x => x.rem > 0)) {
      admit();
      if (!queue.length) { idleTo(); continue; }
      const x = queue.shift();
      run(x, Math.min(q, x.rem));
      admit();                       // arrivals during the slice join before the preempted process
      if (x.rem > 0) queue.push(x);
    }
  } else if (['SRTF', 'SRJF', 'SJFPREEMPTIVE', 'PRIORITYPREEMPTIVE', 'PREEMPTIVEPRIORITY'].includes(algo)) {
    const key = algo.startsWith('S') ? (x => x.rem) : prio;
    while (procs.some(x => x.rem > 0)) {
      const ready = arrived();
      if (!ready.length) { idleTo(); continue; }
      ready.sort(by(key, x => (x === last ? 0 : 1), x => x.at, x => x.i));
      const x = ready[0];
      const nextArr = Math.min(Infinity, ...procs.filter(y => y.rem > 0 && y.at > t + 1e-9).map(y => y.at));
      run(x, Math.min(x.rem, nextArr - t));
    }
  } else {
    const key = { FCFS: x => 0, FIFO: x => 0, SJF: x => x.bt, SJN: x => x.bt, SPN: x => x.bt, PRIORITY: prio, NONPREEMPTIVEPRIORITY: prio, HRRN: x => -((t - x.at + x.bt) / x.bt) }[algo];
    if (!key) throw new Error('Unknown algorithm ' + p.algorithm);
    while (procs.some(x => x.rem > 0)) {
      const ready = arrived();
      if (!ready.length) { idleTo(); continue; }
      ready.sort(by(key, x => x.at, x => x.i));
      run(ready[0], ready[0].rem);
    }
  }
  procs.forEach(x => { x.tat = x.ct - x.at; x.wt = x.tat - x.bt; x.rt = x.start - x.at; });
  const avg = f => procs.reduce((s, x) => s + f(x), 0) / procs.length;
  const out = { avg_waiting: avg(x => x.wt), avg_turnaround: avg(x => x.tat), avg_response: avg(x => x.rt), context_switches: switches, total_time: t,
    throughput: procs.length / t, cpu_utilization: procs.reduce((s, x) => s + x.bt, 0) / (t - Math.min(...procs.map(x => x.at))) };
  const target = procs.find(x => x.name.toLowerCase() === String(p.target || '').toLowerCase()) || null;
  const ask = p.ask || 'avg_waiting';
  const per = { completion_of: 'ct', waiting_of: 'wt', turnaround_of: 'tat', response_of: 'rt' }[ask];
  if (per && !target) throw new Error('Which process? (set "target")');
  const value = per ? target[per] : out[ask];
  const gantt = segs.map(s => `${s.name} [${fmtN(s.from)}–${fmtN(s.to)}]`).join(' → ');
  const steps = `**${algo}${algo === 'RR' ? ` (quantum ${q})` : ''}**${cs ? `, context switch ${cs}` : ''}${/PRIOR/.test(algo) ? `, ${lowIsHigh ? 'lower' : 'higher'} number = higher priority` : ''}\n\n**Gantt chart:** ${gantt}\n\n` +
    mdTable(['Process', 'Arrival', 'Burst', ...(/PRIOR/.test(algo) ? ['Priority'] : []), 'Completion', 'Turnaround = CT − AT', 'Waiting = TAT − BT', 'Response'],
      procs.map(x => [x.name, x.at, x.bt, ...(/PRIOR/.test(algo) ? [x.pr] : []), fmtN(x.ct), fmtN(x.tat), fmtN(x.wt), fmtN(x.rt)])) +
    `\n\nAverage waiting = ${fmtN(out.avg_waiting)}, average turnaround = ${fmtN(out.avg_turnaround)}, average response = ${fmtN(out.avg_response)}, context switches = ${switches}.` +
    (algo === 'RR' ? '\n\n_Convention: a process arriving while a slice runs joins the queue before the preempted process._' : '');
  return { value, text: fmtN(value), steps };
}

// ---------- page replacement ----------
function pageReplace(p) {
  const algo = String(p.algorithm || 'FIFO').toUpperCase(), F = +p.frames, refs = listNums(p.references);
  if (!(F > 0) || !refs.length) throw new Error('Need the number of frames and the reference string.');
  let frames = [], faults = 0, fifo = [];
  const lastUse = new Map(), freq = new Map();
  const rows = refs.map((r, i) => {
    let hit = frames.includes(r);
    freq.set(r, (freq.get(r) || 0) + 1);
    if (!hit) {
      faults++;
      if (frames.length < F) { frames.push(r); fifo.push(r); }
      else {
        let victim;
        if (algo === 'FIFO') victim = fifo.shift();
        else if (algo === 'LRU') victim = frames.slice().sort((a, b) => lastUse.get(a) - lastUse.get(b))[0];
        else if (algo === 'MRU') victim = frames.slice().sort((a, b) => lastUse.get(b) - lastUse.get(a))[0];
        else if (algo === 'LFU') victim = frames.slice().sort((a, b) => freq.get(a) - freq.get(b) || lastUse.get(a) - lastUse.get(b))[0];
        else if (algo === 'OPT' || algo === 'OPTIMAL') {
          const next = x => { const k = refs.indexOf(x, i + 1); return k < 0 ? Infinity : k; };
          victim = frames.slice().sort((a, b) => next(b) - next(a) || frames.indexOf(a) - frames.indexOf(b))[0];
        } else throw new Error('Unknown algorithm ' + algo);
        frames[frames.indexOf(victim)] = r;
        if (algo === 'FIFO') fifo.push(r);
      }
    }
    lastUse.set(r, i);
    return [r, frames.join(' '), hit ? 'hit' : '**fault**'];
  });
  const hits = refs.length - faults;
  const out = { faults, hits, hit_ratio: hits / refs.length, miss_ratio: faults / refs.length };
  const value = out[p.ask || 'faults'];
  return { value, text: fmtN(value), steps: `**${algo}, ${F} frames, starting empty** (first loads count as faults)\n\n${mdTable(['Ref', 'Frames after', 'Result'], rows)}\n\nFaults = ${faults}, hits = ${hits}, hit ratio = ${hits}/${refs.length} = ${fmtN(out.hit_ratio)}.` };
}

// ---------- cache address split ----------
function cacheMap(p) {
  const C = parseBytes(p.cache_size), B = parseBytes(p.block_size);
  let A = p.address_bits ? +p.address_bits : (p.main_memory_size ? log2(parseBytes(p.main_memory_size)) : NaN);
  const lines = C / B;
  const ways = +p.ways === 0 || /full/i.test(p.ways) ? lines : (+p.ways || 1);
  if (!isPow2(C) || !isPow2(B) || !Number.isInteger(A)) throw new Error('Need cache size, block size and address bits (or memory size), powers of two.');
  const sets = lines / ways, offset = log2(B), index = log2(sets), tag = A - index - offset;
  const extra = +p.extra_bits_per_line || 0;
  const out = { offset_bits: offset, index_bits: index, set_bits: index, tag_bits: tag, lines, sets, tag_directory_bits: lines * (tag + extra), tag_directory_bytes: lines * (tag + extra) / 8 };
  const value = out[p.ask || 'tag_bits'];
  const kind = ways === 1 ? 'direct mapped' : ways === lines ? 'fully associative' : `${ways}-way set associative`;
  return { value, text: fmtN(value), steps: `Cache ${fmtSizeB(C)}, block ${fmtSizeB(B)}, ${kind}, ${A}-bit (byte) addresses.\n
1. Lines = cache / block = ${fmtSizeB(C)} / ${fmtSizeB(B)} = **${lines}**
2. Sets = lines / ways = ${lines} / ${ways} = **${sets}**
3. Offset bits = log₂(${B}) = **${offset}**
4. Index (set) bits = log₂(${sets}) = **${index}**
5. Tag bits = ${A} − ${index} − ${offset} = **${tag}**
6. Tag directory = lines × (tag${extra ? ` + ${extra} extra` : ''} bits) = ${lines} × ${tag + extra} = **${out.tag_directory_bits} bits** (${fmtN(out.tag_directory_bytes)} bytes)` };
}

// ---------- average memory access time ----------
function amat(p) {
  const lv = (p.levels || []).map(l => ({ t: +l.hit_time, h: l.hit_rate != null && l.hit_rate !== '' ? +l.hit_rate : 1 - +l.miss_rate }))
    .map(l => ({ ...l, h: l.h > 1 ? l.h / 100 : l.h }));
  const tm = +p.memory_time;
  if (!lv.length || lv.some(l => !isFinite(l.t) || !isFinite(l.h)) || !isFinite(tm)) throw new Error('Need each level\'s time and hit rate, and the memory time.');
  const simultaneous = /simul|parallel/i.test(p.mode || '');
  let T, steps;
  if (simultaneous) {
    let reach = 1; T = 0; const parts = [];
    lv.forEach((l, i) => { T += reach * l.h * l.t; parts.push(`${fmtN(reach * l.h)}×${l.t}`); reach *= 1 - l.h; });
    T += reach * tm; parts.push(`${fmtN(reach)}×${tm}`);
    steps = `**Simultaneous (parallel) access:** each access costs only the time of the level that finally hits.\n\nT = ${parts.join(' + ')} = **${fmtN(T)}**`;
  } else {
    T = tm;
    for (let i = lv.length - 1; i >= 0; i--) T = lv[i].t + (1 - lv[i].h) * T;
    steps = `**Hierarchical access:** a miss at a level pays that level's time and then goes down.\n\nT = t₁ + m₁(t₂ + m₂(… + mₙ·T_mem)) with ${lv.map((l, i) => `t${i + 1}=${l.t}, m${i + 1}=${fmtN(1 - l.h)}`).join('; ')}, T_mem=${tm}\n\nT = **${fmtN(T)}**`;
  }
  return { value: T, text: fmtN(T), steps };
}

// ---------- pipeline ----------
function pipeline(p) {
  const st = listNums(p.stage_delays);
  const k = st.length || +p.stages, n = +p.instructions, latch = +p.latch_delay || 0, stalls = +p.stall_cycles || 0;
  if (!(k > 0) || !(n > 0)) throw new Error('Need the stages (or their delays) and the number of instructions.');
  const cycle = p.cycle_time ? +p.cycle_time : Math.max(...st) + latch;
  const total = (k + n - 1 + stalls) * cycle;
  const nonPerInstr = p.nonpipelined_time_per_instruction ? +p.nonpipelined_time_per_instruction : (st.length ? st.reduce((a, b) => a + b, 0) : k * cycle);
  const out = { total_time: total, cycle_time: cycle, speedup: n * nonPerInstr / total, throughput: n / total, cycles: k + n - 1 + stalls };
  const value = out[p.ask || 'total_time'];
  return { value, text: fmtN(value), steps: `1. Cycle time = slowest stage + latch = ${st.length ? `max(${st.join(', ')})` : cycle - latch} + ${latch} = **${fmtN(cycle)}**
2. Cycles = k + n − 1${stalls ? ' + stalls' : ''} = ${k} + ${n} − 1${stalls ? ` + ${stalls}` : ''} = **${out.cycles}**
3. Pipelined time = ${out.cycles} × ${fmtN(cycle)} = **${fmtN(total)}**
4. Non-pipelined time = n × ${fmtN(nonPerInstr)} = ${fmtN(n * nonPerInstr)}
5. Speedup = ${fmtN(n * nonPerInstr)} / ${fmtN(total)} = **${fmtN(out.speedup)}**` };
}

// ---------- IPv4 subnetting ----------
function ipv4(p) {
  const ipStr = String(p.ip || '').trim();
  const m = ipStr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?$/);
  if (!m || m.slice(1, 5).some(o => +o > 255)) throw new Error('Need an IPv4 address like 192.168.10.77/26');
  let prefix = m[5] != null ? +m[5] : (p.prefix != null && p.prefix !== '' ? +p.prefix : NaN);
  if (!isFinite(prefix) && p.mask) {
    const mk = String(p.mask).trim();
    prefix = /^\/?\d{1,2}$/.test(mk) ? +mk.replace('/', '') : /^\d+(\.\d+){3}$/.test(mk) ? mk.split('.').map(o => (+o >>> 0).toString(2).padStart(8, '0')).join('').replace(/0+$/, '').length : NaN;
  }
  if (!(prefix >= 1 && prefix <= 32)) throw new Error('Need the prefix length or subnet mask.');
  const ip = m.slice(1, 5).reduce((a, o) => a * 256 + +o, 0);
  const size = 2 ** (32 - prefix), net = Math.floor(ip / size) * size, bc = net + size - 1;
  const dot = x => [24, 16, 8, 0].map(s => Math.floor(x / 2 ** s) % 256).join('.');
  const out = { network: dot(net), broadcast: dot(bc), first_host: dot(net + 1), last_host: dot(bc - 1), hosts: Math.max(0, size - 2), mask: dot(2 ** 32 - size), addresses: size };
  if (p.new_prefix) out.subnets = 2 ** (+p.new_prefix - prefix);
  const ask = p.ask || 'network', value = out[ask];
  return { value, text: String(value), steps: `/${prefix} leaves ${32 - prefix} host bits, so each block has 2^${32 - prefix} = ${size} addresses.\n
- Mask: **${out.mask}**
- Network address (host bits 0): **${out.network}**
- Broadcast (host bits 1): **${out.broadcast}**
- Usable hosts: ${out.first_host} to ${out.last_host} = 2^${32 - prefix} − 2 = **${out.hosts}**${out.subnets != null ? `\n- Subnets when going to /${p.new_prefix}: 2^(${p.new_prefix} − ${prefix}) = **${out.subnets}**` : ''}` };
}

// ---------- Banker's algorithm ----------
function bankers(p) {
  const alloc = (p.allocation || []).map(listNums), n = alloc.length;
  let need = p.need && p.need.length ? p.need.map(listNums) : (p.max || []).map(listNums).map((r, i) => r.map((v, j) => v - alloc[i][j]));
  let avail = p.available && listNums(p.available).length ? listNums(p.available) : listNums(p.total).map((v, j) => v - alloc.reduce((s, r) => s + r[j], 0));
  const names = (p.names && p.names.length ? p.names : alloc.map((_, i) => 'P' + i)).map(String);
  if (!n || need.length !== n || !avail.length) throw new Error('Need Allocation, Max (or Need) and Available (or Total).');
  let note = '';
  if (p.request_process != null && p.request_process !== '' && p.request) {
    const i = names.findIndex(x => x.toLowerCase() === String(p.request_process).toLowerCase());
    const req = listNums(p.request);
    if (i < 0) throw new Error('Unknown process ' + p.request_process);
    if (req.some((v, j) => v > need[i][j])) return { value: 'no', text: 'Cannot grant (request exceeds need)', steps: `${names[i]} asks for more than its remaining need, so the request is an error.` };
    if (req.some((v, j) => v > avail[j])) return { value: 'no', text: 'Cannot grant now (must wait)', steps: `Request (${req}) exceeds Available (${avail}); ${names[i]} must wait.` };
    avail = avail.map((v, j) => v - req[j]); alloc[i] = alloc[i].map((v, j) => v + req[j]); need = need.map((r, k) => k === i ? r.map((v, j) => v - req[j]) : r);
    note = `Pretend to grant ${names[i]}'s request (${req}): Available becomes (${avail}).\n\n`;
  }
  const done = Array(n).fill(false), seq = [], rows = [];
  let work = avail.slice(), progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < n; i++) if (!done[i] && need[i].every((v, j) => v <= work[j])) {
      rows.push([names[i], need[i].join(' '), work.join(' '), work.map((v, j) => v + alloc[i][j]).join(' ')]);
      work = work.map((v, j) => v + alloc[i][j]); done[i] = true; seq.push(names[i]); progress = true;
    }
  }
  const safe = done.every(Boolean);
  const ask = p.ask || 'safe';
  const value = ask === 'safe_sequence' ? seq.join(', ') : safe ? 'yes' : 'no';
  return { value, text: ask === 'safe_sequence' ? (safe ? seq.join(' → ') : 'no safe sequence') : (safe ? (p.request ? 'Yes, the request can be granted (state stays safe)' : 'Safe') : (p.request ? 'No, granting leads to an unsafe state' : 'Unsafe')),
    steps: `${note}Repeatedly pick a process whose Need ≤ Work, let it finish and release its allocation.\n\n${mdTable(['Runs', 'Need', 'Work before', 'Work after'], rows)}\n\n${safe ? `All finish: **safe**, sequence ${seq.join(' → ')} (other orders may also work).` : `Stuck with ${names.filter((_, i) => !done[i]).join(', ')} unable to finish: **unsafe**.`}` };
}

// ---------- disk scheduling ----------
function diskSchedule(p) {
  const algo = String(p.algorithm || 'FCFS').toUpperCase().replace(/[\s_-]+/g, ''), head = +p.head, reqs = listNums(p.requests);
  const lo = p.min_cylinder != null && p.min_cylinder !== '' ? +p.min_cylinder : 0, hi = +p.max_cylinder;
  const up = !/down|low|left|decreas|toward.?0/i.test(p.direction || 'up');
  const countJump = p.count_return_jump !== false;
  if (!isFinite(head) || !reqs.length) throw new Error('Need the head position and the request queue.');
  let path = [head];
  const above = reqs.filter(r => r >= head).sort((a, b) => a - b), below = reqs.filter(r => r < head).sort((a, b) => b - a);
  if (algo === 'FCFS' || algo === 'FIFO') path.push(...reqs);
  else if (algo === 'SSTF') {
    const left = reqs.slice(); let cur = head;
    while (left.length) { let b = 0; left.forEach((r, i) => { if (Math.abs(r - cur) < Math.abs(left[b] - cur)) b = i; }); cur = left.splice(b, 1)[0]; path.push(cur); }
  } else {
    const first = up ? above : below, second = up ? below : above;
    const needEnd = /^C?SCAN$/.test(algo);
    if ((needEnd) && !isFinite(hi) && up) throw new Error('SCAN/C-SCAN going up needs the last cylinder number.');
    const end = up ? hi : lo, start = up ? lo : hi;
    path.push(...first);
    if (algo === 'SCAN' || algo === 'ELEVATOR') { if (second.length) path.push(end); path.push(...second); }
    else if (algo === 'LOOK') path.push(...second);
    else if (algo === 'CSCAN') { if (second.length) { path.push(end, start); path.push(...second.slice().reverse()); } }
    else if (algo === 'CLOOK') { path.push(...second.slice().reverse()); }
    else throw new Error('Unknown algorithm ' + algo);
  }
  path = path.filter((x, i) => i === 0 || x !== path[i - 1]);
  let total = 0; const legs = [];
  for (let i = 1; i < path.length; i++) {
    const jump = (algo === 'CSCAN' && ((up && path[i - 1] === hi && path[i] === lo) || (!up && path[i - 1] === lo && path[i] === hi))) ||
      (algo === 'CLOOK' && (up ? path[i] < path[i - 1] : path[i] > path[i - 1]));
    const d = Math.abs(path[i] - path[i - 1]);
    if (!jump || countJump) total += d;
    legs.push(`${path[i - 1]}→${path[i]} (${d}${jump ? (countJump ? ', return jump counted' : ', return jump not counted') : ''})`);
  }
  const value = p.ask === 'order' ? path.slice(1).join(', ') : total;
  return { value, text: String(value), steps: `**${algo}**, head at ${head}, moving ${up ? 'towards higher' : 'towards lower'} cylinders.\n\nOrder: ${path.join(' → ')}\n\n${legs.join(' + ')}\n\nTotal head movement = **${total}** cylinders.${/SCAN/.test(algo) ? `\n\n_SCAN/C-SCAN travel to the disk end (${up ? hi : lo}) before turning; LOOK/C-LOOK turn at the last request._` : ''}` };
}

// ---------- number systems ----------
function numberSystems(p) {
  const mode = p.mode || 'convert', bits = +p.bits;
  const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (mode === 'convert') {
    const from = +p.from_base || 10, to = +p.to_base || 2;
    const [ip, fp = ''] = String(p.value).trim().toUpperCase().replace(/^0X/, '').split('.');
    let v = 0; for (const c of ip) { const d = digits.indexOf(c); if (d < 0 || d >= from) throw new Error(`"${c}" is not a base-${from} digit`); v = v * from + d; }
    let f = 0; [...fp].forEach((c, i) => { f += digits.indexOf(c) / from ** (i + 1); });
    let out = v.toString(to).toUpperCase();
    if (fp) { let x = f, s = ''; for (let i = 0; i < 12 && x > 0; i++) { x *= to; const d = Math.floor(x + 1e-12); s += digits[d]; x -= d; } out += '.' + (s || '0'); }
    return { value: out, text: out, steps: `(${p.value})₍${from}₎ = ${round(v + f, 8)} in decimal = **(${out})₍${to}₎**` };
  }
  if (!(bits > 0)) throw new Error('Need the number of bits.');
  if (mode === 'twos_complement_of') {
    const v = parseInt(p.value, 10), min = -(2 ** (bits - 1)), max = 2 ** (bits - 1) - 1;
    if (v < min || v > max) return { value: 'overflow', text: `${v} does not fit in ${bits}-bit two's complement (range ${min} to ${max})`, steps: `Range is −2^${bits - 1} to 2^${bits - 1}−1.` };
    const s = ((v + 2 ** bits) % 2 ** bits).toString(2).padStart(bits, '0');
    return { value: s, text: s, steps: v < 0 ? `|${v}| = ${(-v).toString(2).padStart(bits, '0')}; invert the bits and add 1 → **${s}**` : `Positive: plain binary → **${s}**` };
  }
  if (mode === 'signed_value_of') {
    const s = String(p.value).replace(/\s/g, '').padStart(bits, '0'), rep = p.representation || 'twos';
    const u = parseInt(s, 2), neg = s[0] === '1';
    const v = rep === 'ones' ? (neg ? -((~u >>> 0) & (2 ** bits - 1)) : u) : rep === 'sign_magnitude' ? (neg ? -parseInt(s.slice(1), 2) : u) : (neg ? u - 2 ** bits : u);
    return { value: v, text: String(v), steps: `${s} read as ${rep.replace('_', '-')}: **${v}**` };
  }
  if (mode === 'range') {
    const rep = p.representation || 'twos';
    const r = rep === 'twos' ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1] : rep === 'unsigned' ? [0, 2 ** bits - 1] : [-(2 ** (bits - 1) - 1), 2 ** (bits - 1) - 1];
    const one = p.which === 'min' ? r[0] : p.which === 'max' ? r[1] : null;
    return { value: one ?? `${r[0]} to ${r[1]}`, text: one != null ? String(one) : `${r[0]} to ${r[1]}`, steps: `${bits}-bit ${rep}: **${r[0]} to ${r[1]}**${rep === 'twos' ? ' (one more negative than positive)' : rep === 'unsigned' ? '' : ' (two zeros: +0 and −0)'}` };
  }
  throw new Error('Unknown mode ' + mode);
}

// ---------- IEEE 754 ----------
function ieee754(p) {
  const dbl = /double|64/i.test(p.precision || ''), dv = new DataView(new ArrayBuffer(8));
  const B = dbl ? 64 : 32, E = dbl ? 11 : 8, bias = dbl ? 1023 : 127;
  if ((p.mode || 'to_bits') === 'to_bits') {
    const v = parseFloat(p.value);
    if (dbl) dv.setFloat64(0, v); else dv.setFloat32(0, v);
    const bitsStr = Array.from({ length: B / 8 }, (_, i) => dv.getUint8(i).toString(2).padStart(8, '0')).join('');
    const hex = Array.from({ length: B / 8 }, (_, i) => dv.getUint8(i).toString(16).padStart(2, '0')).join('').toUpperCase();
    const s = bitsStr[0], e = bitsStr.slice(1, 1 + E), f = bitsStr.slice(1 + E), ev = parseInt(e, 2);
    const ask = p.ask || 'hex', out = { hex: '0x' + hex, bits: bitsStr, exponent_field: ev, biased_exponent: ev, mantissa_bits: f };
    return { value: out[ask], text: String(out[ask]), steps: `${v} in ${dbl ? 'double' : 'single'} precision:\n\n- Sign = ${s}\n- Exponent field = ${e} (= ${ev}, actual exponent ${ev - bias} with bias ${bias})\n- Fraction = ${f}\n\nAll bits: \`${bitsStr}\` = **0x${hex}**` };
  }
  let t = String(p.value).trim().replace(/\s/g, '');
  const bitsStr = /^0x/i.test(t) || /[a-f2-9]/i.test(t) ? BigInt('0x' + t.replace(/^0x/i, '')).toString(2).padStart(B, '0') : t.padStart(B, '0');
  for (let i = 0; i < B / 8; i++) dv.setUint8(i, parseInt(bitsStr.slice(i * 8, i * 8 + 8), 2));
  const v = dbl ? dv.getFloat64(0) : dv.getFloat32(0);
  const ev = parseInt(bitsStr.slice(1, 1 + E), 2);
  return { value: v, text: String(v), steps: `Sign ${bitsStr[0]}, exponent field ${ev} (actual ${ev - bias}), fraction ${bitsStr.slice(1 + E)} → value = (−1)^${bitsStr[0]} × 1.f × 2^${ev - bias} = **${v}**` };
}

// ---------- Boolean minimisation (Quine-McCluskey + exact cover) ----------
function booleanMin(p) {
  const n = +p.variables, all = 2 ** n;
  if (!(n >= 1 && n <= 8)) throw new Error('Need 1 to 8 variables.');
  const dc = listNums(p.dont_cares).filter(x => x >= 0 && x < all);
  let mins = listNums(p.minterms).filter(x => x >= 0 && x < all);
  if (!mins.length && listNums(p.maxterms).length) { const M = new Set(listNums(p.maxterms)); mins = [...Array(all).keys()].filter(x => !M.has(x) && !dc.includes(x)); }
  mins = [...new Set(mins)].filter(x => !dc.includes(x));
  const names = (p.names && String(p.names).replace(/[\s,]/g, '').length === n) ? String(p.names).replace(/[\s,]/g, '').split('') : 'ABCDEFGH'.slice(0, n).split('');
  if (!mins.length) return { value: '0', text: 'F = 0', steps: 'No minterms: F = 0.' };
  // terms as strings over {0,1,-}
  const toS = x => x.toString(2).padStart(n, '0');
  let cur = [...new Set([...mins, ...dc])].map(x => ({ s: toS(x), used: false }));
  const primes = new Set();
  while (cur.length) {
    const next = new Map();
    for (let i = 0; i < cur.length; i++) for (let j = i + 1; j < cur.length; j++) {
      const a = cur[i].s, b = cur[j].s; let diff = -1, ok = true;
      for (let k = 0; k < n; k++) if (a[k] !== b[k]) { if (diff >= 0 || a[k] === '-' || b[k] === '-') { ok = false; break; } diff = k; }
      if (ok && diff >= 0) { cur[i].used = cur[j].used = true; const s = a.slice(0, diff) + '-' + a.slice(diff + 1); next.set(s, { s, used: false }); }
    }
    cur.forEach(t => { if (!t.used) primes.add(t.s); });
    cur = [...next.values()];
  }
  const covers = (s, m) => { const b = toS(m); for (let k = 0; k < n; k++) if (s[k] !== '-' && s[k] !== b[k]) return false; return true; };
  const P = [...primes].filter(s => mins.some(m => covers(s, m)));
  const lit = s => [...s].filter(c => c !== '-').length;
  const essential = P.filter(s => mins.some(m => covers(s, m) && P.filter(t => covers(t, m)).length === 1));
  const left = mins.filter(m => !essential.some(s => covers(s, m)));
  const rest = P.filter(s => !essential.includes(s));
  let best = null;
  if (left.length) {
    if (rest.length > 20) throw new Error('Too many prime implicants to search.');
    for (let mask = 1; mask < 2 ** rest.length; mask++) {
      const pick = rest.filter((_, i) => mask & (1 << i));
      if (best && pick.length > best.length) continue;
      if (!left.every(m => pick.some(s => covers(s, m)))) continue;
      if (!best || pick.length < best.length || pick.reduce((a, s) => a + lit(s), 0) < best.reduce((a, s) => a + lit(s), 0)) best = pick;
    }
  }
  const chosen = essential.concat(best || []);
  const term = s => [...s].map((c, k) => c === '1' ? names[k] : c === '0' ? names[k] + "'" : '').join('') || '1';
  const expr = chosen.map(term).join(' + ');
  const out = { prime_implicants: P.length, essential_prime_implicants: essential.length, terms: chosen.length, literals: chosen.reduce((a, s) => a + lit(s), 0), expression: expr };
  const ask = p.ask || 'expression', value = out[ask];
  return { value, text: String(value), steps: `F(${names.join(',')}) = Σm(${mins.sort((a, b) => a - b).join(', ')})${dc.length ? ` + d(${dc.join(', ')})` : ''}\n
- Prime implicants (${P.length}): ${P.map(term).join(', ')}
- Essential prime implicants (${essential.length}): ${essential.map(term).join(', ') || 'none'}
- Minimal SOP: **F = ${expr}** (${out.terms} terms, ${out.literals} literals)${(best || []).length ? '\n\n_After the essentials, the cheapest cover of the remaining minterms was chosen; other equally small covers may exist._' : ''}` };
}

// ---------- recurrences (master theorem) ----------
function masterTheorem(p) {
  const a = +p.a, b = +p.b, k = +p.k || 0, pw = +p.log_power || 0;
  const ln = x => (x === 0 ? '' : x === 1 ? ' log n' : ` log^${x} n`);
  const npow = x => x === 0 ? '1' : x === 1 ? 'n' : `n^${round(x, 3)}`;
  const tidy = s => s.replace(/Θ\(1 (?=log)/, 'Θ(').replace(/Θ\(1 · /, 'Θ(');
  if (/decrease|subtract|n-|n −/i.test(p.form || '')) {
    if (!(a > 0) || !(b > 0)) throw new Error('Need a and b.');
    const r = tidy(a < 1 ? `Θ(${npow(k)}${ln(pw)})` : a === 1 ? `Θ(${npow(k + 1)}${ln(pw)})` : `Θ(${npow(k)}${ln(pw)} · ${a}^(n/${b}))`);
    return { value: r, text: r, steps: `T(n) = ${a}T(n−${b}) + ${npow(k)}${ln(pw)}: ${a < 1 ? 'a < 1, the work term dominates' : a === 1 ? 'a = 1, the n/b levels each add f(n)' : 'a > 1, the recursion tree grows exponentially'} → **${r}**` };
  }
  if (!(a >= 1) || !(b > 1)) throw new Error('Master theorem needs a ≥ 1 and b > 1.');
  const c = Math.log(a) / Math.log(b);
  let r, why;
  if (Math.abs(c - k) < 1e-9) {
    r = pw > -1 ? `Θ(${npow(k)}${ln(pw + 1)})` : pw === -1 ? `Θ(${npow(k)} log log n)` : `Θ(${npow(k)})`;
    why = `log_b a = ${round(c, 3)} = k: case 2`;
  } else if (c > k) { r = `Θ(${npow(c)})`; why = `log_b a = ${round(c, 3)} > k = ${k}: case 1, the leaves dominate`; }
  else { r = pw >= 0 ? `Θ(${npow(k)}${ln(pw)})` : `Θ(${npow(k)})`; why = `log_b a = ${round(c, 3)} < k = ${k}: case 3, the root's work dominates`; }
  r = tidy(r);
  return { value: r, text: r, steps: `T(n) = ${a}T(n/${b}) + ${npow(k)}${ln(pw)}\n\n${why} → **${r}**` };
}

// ---------- hashing ----------
function hashing(p) {
  const m = +p.table_size, keys = listNums(p.keys), method = String(p.method || 'linear').toLowerCase(), R = +p.r || 7;
  if (!(m > 0) || !keys.length) throw new Error('Need the table size and the keys.');
  const table = Array(m).fill(null), rows = []; let probes = 0, collisions = 0;
  const h1 = k => ((k % m) + m) % m, h2 = k => R - (k % R);
  for (const k of keys) {
    let placed = -1, i = 0;
    for (; i < m * (method.startsWith('quad') ? 2 : 1); i++) {
      const slot = method.startsWith('quad') ? (h1(k) + i * i) % m : method.startsWith('double') ? (h1(k) + i * h2(k)) % m : (h1(k) + i) % m;
      probes++;
      if (table[slot] == null) { table[slot] = k; placed = slot; break; }
    }
    if (i > 0) collisions++;
    rows.push([k, h1(k), placed < 0 ? 'not placed' : placed, i]);
  }
  const t = p.target != null && p.target !== '' ? +p.target : null;
  const ask = p.ask || 'position_of';
  const value = ask === 'key_at' ? table[t] : ask === 'total_probes' ? probes : ask === 'collisions' ? collisions : table.indexOf(t);
  return { value, text: String(value), steps: `${method} probing, h(k) = k mod ${m}${method.startsWith('double') ? `, h₂(k) = ${R} − (k mod ${R})` : ''}\n\n${mdTable(['Key', 'h(k)', 'Slot', 'Collisions'], rows)}\n\nTable: ${table.map((x, i) => `[${i}] ${x ?? '–'}`).join(', ')}` };
}

// ---------- paging & TLB ----------
function paging(p) {
  const P = parseBytes(p.page_size), off = log2(P);
  const va = p.virtual_address_bits ? +p.virtual_address_bits : log2(parseBytes(p.virtual_memory_size));
  const pa = p.physical_address_bits ? +p.physical_address_bits : (p.physical_memory_size ? log2(parseBytes(p.physical_memory_size)) : NaN);
  if (!isPow2(P) || !Number.isInteger(va)) throw new Error('Need the page size and the virtual address size.');
  const vpn = va - off, frameBits = pa - off, extra = +p.extra_bits || 0;
  const pteBytes = p.pte_size ? parseBytes(p.pte_size) : Math.ceil((frameBits + extra) / 8);
  const ptSize = 2 ** vpn * pteBytes;
  const perPage = P / pteBytes, levels = Math.ceil(vpn / log2(perPage));
  const out = { pages: 2 ** vpn, frames: Number.isFinite(frameBits) ? 2 ** frameBits : NaN, offset_bits: off, vpn_bits: vpn, frame_bits: frameBits, pte_bits_min: frameBits + extra, page_table_bytes: ptSize, levels };
  const value = out[p.ask || 'page_table_bytes'];
  return { value, text: fmtN(value), steps: `1. Offset bits = log₂(page size ${fmtSizeB(P)}) = **${off}**
2. Page number bits = ${va} − ${off} = **${vpn}** → ${2 ** vpn} pages
${Number.isFinite(frameBits) ? `3. Frame bits = ${pa} − ${off} = **${frameBits}** → ${2 ** frameBits} frames; a PTE needs at least ${frameBits}${extra ? ` + ${extra}` : ''} bits\n` : ''}4. PTE size used = ${pteBytes} bytes; page table = ${2 ** vpn} × ${pteBytes} = **${fmtSizeB(ptSize)}**
5. Entries per page = ${P} / ${pteBytes} = ${perPage} → levels so each table fits in a page = ⌈${vpn} / ${log2(perPage)}⌉ = **${levels}**` };
}
function tlbEmat(p) {
  const tl = +p.tlb_time || 0, m = +p.memory_time, h0 = +p.tlb_hit_rate, h = h0 > 1 ? h0 / 100 : h0, L = +p.page_table_levels || 1;
  const pf0 = +p.page_fault_rate || 0, pf = pf0 > 1 ? pf0 / 100 : pf0, sv = +p.page_fault_service_time || 0;
  if (!isFinite(m) || !isFinite(h)) throw new Error('Need memory time and TLB hit rate.');
  const parallel = /parallel|simul/i.test(p.tlb_mode || '');
  // Sequential: the TLB is checked first, so a miss pays its time too. Parallel: the page walk starts alongside the TLB lookup.
  const hitCost = tl + m, missCost = (parallel ? 0 : tl) + (L + 1) * m;
  const base = h * hitCost + (1 - h) * missCost;
  const T = pf ? (1 - pf) * base + pf * sv : base;
  return { value: T, text: fmtN(T), steps: `TLB hit: ${tl} + ${m} = ${hitCost}. TLB miss: ${parallel ? '' : `${tl} + `}${L + 1} × ${m} (${L} page-table level${L > 1 ? 's' : ''} + the data) = ${missCost}.\n\nEMAT = ${h} × ${hitCost} + ${round(1 - h, 6)} × ${missCost} = **${fmtN(base)}**${pf ? `\n\nWith page faults: (1 − ${pf}) × ${fmtN(base)} + ${pf} × ${sv} = **${fmtN(T)}**` : ''}` };
}

// ---------- sliding window / link efficiency ----------
function slidingWindow(p) {
  const B = parseRate(p.bandwidth), L = parseBitsSize(p.frame_size);
  let Tp = p.propagation_delay ? parseTime(p.propagation_delay) : NaN;
  if (!isFinite(Tp) && p.distance && p.signal_speed) Tp = parseQty(p.distance, [[/^m$/i, 1], [/^km$/i, 1000]]) / parseQty(p.signal_speed, [[/^m\/s$/i, 1], [/^km\/s$/i, 1000]]);
  if (!(B > 0) || !(L > 0) || !isFinite(Tp)) {
    // No link data: sequence-number bits and window size still follow from the window / bits and the protocol.
    const proto = String(p.protocol || '').toLowerCase(), sr = /sr|selective/.test(proto), sw = /stop/.test(proto);
    const ask = p.ask || 'seq_bits', k = +p.sequence_bits;
    let W = sw ? 1 : Math.round(+p.window);
    if (!(W > 0) && k > 0 && ask === 'min_window') W = sw ? 1 : sr ? 2 ** (k - 1) : 2 ** k - 1;
    if (!(W > 0) || !proto || !/seq_bits|min_window/.test(ask)) throw new Error('Need bandwidth, frame size and propagation delay (or distance and signal speed).');
    const seqBits = sr ? Math.ceil(log2(2 * W)) : Math.ceil(log2(W + 1));
    const name = sw ? 'Stop-and-Wait' : sr ? 'Selective Repeat' : 'Go-Back-N';
    const value = ask === 'min_window' ? W : seqBits;
    const rule = sw ? 'W = 1, so 2 sequence numbers (0, 1)' : sr ? 'W ≤ 2ᵏ⁻¹, i.e. 2W ≤ 2ᵏ' : 'W ≤ 2ᵏ − 1, i.e. W + 1 ≤ 2ᵏ';
    const steps = ask === 'min_window' && !(+p.window > 0) && !sw
      ? `${name} with ${k}-bit sequence numbers (2^${k} = ${2 ** k} numbers): ${rule} → window = **${W}** frames`
      : `${name}: ${rule}. With W = ${W}: k = ${sr ? `⌈log₂(2 × ${W})⌉ = ⌈log₂ ${2 * W}⌉` : `⌈log₂(${W} + 1)⌉ = ⌈log₂ ${W + 1}⌉`} = **${seqBits}** bits${ask === 'min_window' ? `; window = **${W}** frames` : ''}`;
    return { value, text: fmtN(value), steps };
  }
  const Tt = L / B, a = Tp / Tt, proto = String(p.protocol || 'stop_and_wait').toLowerCase();
  const W = /stop/.test(proto) ? 1 : +p.window || 1;
  const eff = Math.min(1, W / (1 + 2 * a));
  const minW = Math.ceil(1 + 2 * a);
  const seqBits = /sr|selective/.test(proto) ? Math.ceil(log2(2 * minW)) : Math.ceil(log2(minW + 1));
  const out = { efficiency: eff, throughput_bps: eff * B, a, transmission_time: Tt, min_window: minW, seq_bits: seqBits };
  const value = out[p.ask || 'efficiency'];
  return { value, text: fmtN(value), steps: `1. Transmission time Tt = L / B = ${L} bits / ${B} bps = ${fmtN(Tt * 1000)} ms
2. a = Tp / Tt = ${fmtN(Tp * 1000)} ms / ${fmtN(Tt * 1000)} ms = **${fmtN(a)}**
3. Efficiency = min(1, W / (1 + 2a)) with W = ${W} → **${fmtN(eff)}** (${fmtN(eff * 100)}%), throughput = ${fmtN(eff * B / 1000)} kbps
4. For 100% utilisation: W ≥ 1 + 2a → **${minW}** frames; sequence-number bits = ${/sr|selective/.test(proto) ? `⌈log₂(2W)⌉` : '⌈log₂(W+1)⌉'} = **${seqBits}**
_Sizes in bytes use 1 KB = 1024 B; bandwidth uses 1 kbps = 1000 bps._` };
}

// ---------- CRC ----------
function crc(p) {
  const msg = String(p.message || '').replace(/\s/g, ''), gen = String(p.generator || '').replace(/\s/g, '');
  if (!/^[01]+$/.test(msg) || !/^1[01]*$/.test(gen)) throw new Error('Message and generator must be bit strings (generator starting with 1).');
  const r = gen.length - 1, bits = (msg + '0'.repeat(r)).split('').map(Number), g = gen.split('').map(Number);
  for (let i = 0; i + r < bits.length; i++) if (bits[i]) for (let j = 0; j <= r; j++) bits[i + j] ^= g[j];
  const rem = bits.slice(-r).join('');
  return { value: p.ask === 'transmitted' ? msg + rem : rem, text: p.ask === 'transmitted' ? msg + rem : rem,
    steps: `Append ${r} zeros (degree of the generator), divide ${msg}${'0'.repeat(r)} by ${gen} with XOR (mod-2) division.\n\nRemainder (CRC) = **${rem}**, transmitted frame = **${msg + rem}**` };
}

// ---------- grammars: FIRST / FOLLOW / LL(1) / LR(0) / SLR(1) ----------
const EPS = 'ε';
// "S -> a A B | b ; A -> c | ε" (also →, ::=, one production per line). Without spaces, single capital letters
// (optionally with ') are non-terminals and every other character is a terminal.
function parseGrammar(text) {
  const lines = String(text || '').replace(/→|::=|=>/g, '->').split(/\n|;/).map(s => s.trim()).filter(s => s.includes('->'));
  const prods = [], nts = [];
  // If any alternative is written with spaces, the whole grammar is space-separated (so "id" stays one terminal).
  const spaced = lines.some(l => l.split('->')[1].split('|').some(a => /\S\s+\S/.test(a.trim())));
  for (const line of lines) {
    const [lhs, rhs] = line.split('->');
    const A = lhs.trim();
    if (!nts.includes(A)) nts.push(A);
    for (const alt of rhs.split('|')) {
      const a = alt.trim();
      let syms;
      if (!a || /^(ε|e|eps|epsilon|λ|#|''|"")$/i.test(a)) syms = [];
      else if (spaced || /\s/.test(a)) syms = a.split(/\s+/).filter(s => !/^(ε|eps|epsilon|λ)$/i.test(s));
      else syms = a.match(/[A-Z]'*|./g).filter(s => s !== EPS);
      prods.push({ A, syms });
    }
  }
  if (!prods.length) throw new Error('Write the grammar like: S -> a A | b ; A -> c | ε');
  const isNT = s => nts.includes(s);
  const terms = [...new Set(prods.flatMap(p => p.syms).filter(s => !isNT(s)))];
  return { prods, nts, terms, start: nts[0], isNT };
}
function firstFollow(g) {
  const first = {}, follow = {};
  g.nts.forEach(A => { first[A] = new Set(); follow[A] = new Set(); });
  const firstOf = syms => {   // FIRST of a string of symbols
    const out = new Set();
    for (const s of syms) {
      if (!g.isNT(s)) { out.add(s); return out; }
      first[s].forEach(x => x !== EPS && out.add(x));
      if (!first[s].has(EPS)) return out;
    }
    out.add(EPS); return out;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of g.prods) { const before = first[p.A].size; firstOf(p.syms).forEach(x => first[p.A].add(x)); if (first[p.A].size !== before) changed = true; }
  }
  follow[g.start].add('$');
  changed = true;
  while (changed) {
    changed = false;
    for (const p of g.prods) p.syms.forEach((B, i) => {
      if (!g.isNT(B)) return;
      const rest = firstOf(p.syms.slice(i + 1)), before = follow[B].size;
      rest.forEach(x => x !== EPS && follow[B].add(x));
      if (rest.has(EPS)) follow[p.A].forEach(x => follow[B].add(x));
      if (follow[B].size !== before) changed = true;
    });
  }
  return { first, follow, firstOf };
}
const setStr = s => `{ ${[...s].sort((a, b) => (a === '$') - (b === '$') || (a === EPS) - (b === EPS) || a.localeCompare(b)).join(', ')} }`;
function grammarSolver(p) {
  const g = parseGrammar(p.grammar), { first, follow, firstOf } = firstFollow(g);
  const ask = p.ask || 'is_ll1', X = String(p.symbol || '').trim() || g.start;
  // LL(1) table
  const table = {}, ll1Conf = [];
  g.prods.forEach((pr, i) => {
    const f = firstOf(pr.syms), cells = [...f].filter(x => x !== EPS).concat(f.has(EPS) ? [...follow[pr.A]] : []);
    for (const a of cells) { const k = pr.A + '|' + a; table[k] = (table[k] || []).concat(i); if (table[k].length === 2) ll1Conf.push(`M[${pr.A}, ${a}]`); }
  });
  // LR(0) canonical collection (augmented grammar), then SLR(1) conflicts.
  const aug = [{ A: g.start + "'", syms: [g.start] }].concat(g.prods);
  const key = I => I.map(([p, d]) => p + '.' + d).sort().join(' ');
  const closure = I => {
    const out = I.slice(), seen = new Set(out.map(([p, d]) => p + '.' + d));
    for (let k = 0; k < out.length; k++) {
      const [pi, d] = out[k], B = aug[pi].syms[d];
      if (B && g.isNT(B)) aug.forEach((pr, j) => { if (pr.A === B && !seen.has(j + '.0')) { seen.add(j + '.0'); out.push([j, 0]); } });
    }
    return out;
  };
  const states = [closure([[0, 0]])], keys = [key(states[0])], trans = [];
  for (let s = 0; s < states.length; s++) {
    const syms = [...new Set(states[s].map(([p, d]) => aug[p].syms[d]).filter(Boolean))];
    for (const X2 of syms) {
      const J = closure(states[s].filter(([p, d]) => aug[p].syms[d] === X2).map(([p, d]) => [p, d + 1])), k = key(J);
      let t = keys.indexOf(k);
      if (t < 0) { states.push(J); keys.push(k); t = states.length - 1; }
      trans.push([s, X2, t]);
    }
  }
  let lr0 = 0, slr = 0; const slrConf = [];
  states.forEach((I, s) => {
    const reds = I.filter(([p, d]) => d === aug[p].syms.length && p !== 0), shifts = new Set(I.map(([p, d]) => aug[p].syms[d]).filter(t => t && !g.isNT(t)));
    if (reds.length && (shifts.size || reds.length > 1)) lr0++;
    const seen = {};
    for (const [pi] of reds) for (const a of follow[aug[pi].A]) {
      if (shifts.has(a)) { slr++; slrConf.push(`I${s}: shift/reduce on ${a}`); }
      if (seen[a] != null) { slr++; slrConf.push(`I${s}: reduce/reduce on ${a}`); }
      seen[a] = pi;
    }
  });
  const out = { first_of: g.isNT(X) ? setStr(first[X]) : setStr(firstOf([X])), follow_of: g.isNT(X) ? setStr(follow[X]) : '-', is_ll1: ll1Conf.length ? 'no' : 'yes',
    lr0_states: states.length, is_lr0: lr0 ? 'no' : 'yes', is_slr: slr ? 'no' : 'yes', ll1_conflicts: ll1Conf.length, slr_conflicts: slr };
  const value = out[ask];
  return { value, text: String(value), steps: `Grammar (${g.prods.length} productions, start ${g.start}): ${g.prods.map(pr => `${pr.A} → ${pr.syms.join(' ') || EPS}`).join(' · ')}\n\n` +
    mdTable(['Non-terminal', 'FIRST', 'FOLLOW'], g.nts.map(A => [A, setStr(first[A]), setStr(follow[A])])) +
    `\n\n**LL(1):** ${ll1Conf.length ? `not LL(1): two productions in ${[...new Set(ll1Conf)].join(', ')}` : 'every table cell has at most one production, so it is LL(1)'}.` +
    `\n\n**LR(0) automaton:** ${states.length} states (augmented with ${g.start}' → ${g.start}). LR(0): ${lr0 ? `${lr0} state(s) with a conflict` : 'no conflicts'}. SLR(1): ${slr ? slrConf.join('; ') : 'no conflicts (reductions only on FOLLOW)'}.` };
}

// ---------- minimal DFA ----------
function minDfa(p) {
  const tr = (p.transitions || []).map(t => ({ from: String(t.from).trim(), sym: String(t.symbol).trim(), to: String(t.to).trim() }));
  const start = String(p.start || (tr[0] && tr[0].from) || '').trim(), finals = new Set((p.finals || []).map(String).map(s => s.trim()));
  if (!tr.length || !start) throw new Error('Need the transitions, the start state and the final states.');
  const alpha = [...new Set(tr.map(t => t.sym))].sort();
  const delta = {}; tr.forEach(t => { delta[t.from + '|' + t.sym] = t.to; });
  // reachable states; a missing move goes to a dead state (complete DFA)
  const reach = [start]; let dead = false;
  for (let i = 0; i < reach.length; i++) for (const a of alpha) {
    const t = delta[reach[i] + '|' + a];
    if (t == null) { dead = true; delta[reach[i] + '|' + a] = '∅'; if (!reach.includes('∅')) reach.push('∅'); }
    else if (!reach.includes(t)) reach.push(t);
  }
  alpha.forEach(a => { if (reach.includes('∅')) delta['∅|' + a] = '∅'; });
  let part = [reach.filter(s => finals.has(s)), reach.filter(s => !finals.has(s))].filter(b => b.length);
  for (;;) {
    const blockOf = s => part.findIndex(b => b.includes(s));
    const next = part.flatMap(b => { const g = {}; b.forEach(s => { const sig = alpha.map(a => blockOf(delta[s + '|' + a])).join(','); (g[sig] = g[sig] || []).push(s); }); return Object.values(g); });
    if (next.length === part.length) break;
    part = next;
  }
  const allStates = [...new Set(tr.flatMap(t => [t.from, t.to]))];
  const unreachable = allStates.filter(s => !reach.includes(s));
  const out = { min_states: part.length, min_states_without_dead: part.filter(b => !(b.length === 1 && b[0] === '∅')).length };
  const value = out[p.ask || 'min_states'];
  return { value, text: String(value), steps: `Alphabet {${alpha.join(', ')}}, start ${start}, final {${[...finals].join(', ')}}.\n
1. Reachable from ${start}: ${reach.join(', ')}${unreachable.length ? ` (removed unreachable: ${unreachable.join(', ')})` : ''}${dead ? '. Missing moves go to a dead state ∅ so the DFA is complete.' : ''}
2. Split final / non-final, then keep splitting blocks whose states move to different blocks on some symbol.
3. Equivalence classes: ${part.map(b => `{${b.join(', ')}}`).join(' ')}\n
Minimal complete DFA: **${out.min_states} states**${dead ? ` (${out.min_states_without_dead} without the dead state)` : ''}.` };
}
// "strings that end in 01" / "start with ab" / "contain 101" (or "do not ..."): the DFA is built by rule,
// since a small model often draws it wrong. Returns null when the question gives an automaton or another condition.
function dfaFromWords(q) {
  const s = String(q);
  if (/\btransitions?\b|δ|\bstates?\s+q\d|\bq\d\s*(→|->|on\b)|\blength\b|divisible|\bnumber of (0|1|a|b)s?\b|\b(even|odd)\b/i.test(s)) return null;
  const verb = /\b(end(?:s|ing)?|start(?:s|ing)?|begin(?:s|ning)?|contain(?:s|ing)?)\b/gi;
  if ((s.match(verb) || []).length !== 1) return null;
  const m = s.match(/\b(do(?:es)?\s+not\s+|don'?t\s+|not\s+)?(end|start|begin|contain)\w*\s+(?:with\s+|in\s+)?(?:the\s+)?(?:sub-?string\s+|pattern\s+)?['"‘“]?([01]+|[ab]+)['"’”]?(?![\w])/i);
  if (!m) return null;
  const neg = !!m[1], kind = m[2].toLowerCase(), w = m[3];
  const given = s.match(/(?:alphabet|over|Σ\s*=?)\s*\{\s*([a-z0-9])\s*,\s*([a-z0-9])\s*\}/i);
  const alpha = given ? [given[1], given[2]] : /^[01]+$/.test(w) ? ['0', '1'] : ['a', 'b'];
  if (![...w].every(c => alpha.includes(c))) return null;
  const n = w.length, st = i => 'q' + i, transitions = [];
  // longest prefix of w that is a suffix of (w[0..i) + c): the KMP automaton
  const kmp = (i, c) => { const t = w.slice(0, i) + c; for (let k = Math.min(n, t.length); k > 0; k--) if (t.endsWith(w.slice(0, k))) return k; return 0; };
  for (let i = 0; i <= n; i++) for (const c of alpha) {
    let to;
    if (kind === 'start' || kind === 'begin') to = i === n ? n : c === w[i] ? i + 1 : 'dead';
    else if (kind === 'contain') to = i === n ? n : kmp(i, c);
    else to = kmp(i, c);
    transitions.push({ from: st(i), symbol: c, to: to === 'dead' ? 'dead' : st(to) });
  }
  if (kind === 'start' || kind === 'begin') alpha.forEach(c => transitions.push({ from: 'dead', symbol: c, to: 'dead' }));
  const all = [...new Set(transitions.flatMap(t => [t.from, t.to]))];
  const finals = neg ? all.filter(x => x !== st(n)) : [st(n)];
  return { transitions, start: st(0), finals };
}

// ---------- graphs: MST, shortest paths, components ----------
function graphSolver(p) {
  const edges = (p.edges || []).map(e => ({ u: String(e.u).trim(), v: String(e.v).trim(), w: e.w == null || e.w === '' ? 1 : +e.w })).filter(e => e.u && e.v);
  if (!edges.length) throw new Error('Need the edges (u v weight).');
  const directed = !!p.directed, nodes = [...new Set(edges.flatMap(e => [e.u, e.v]))].sort();
  const ask = p.ask || 'mst_weight';
  if (ask === 'mst_weight' || ask === 'mst_edges') {
    const parent = {}; nodes.forEach(n => parent[n] = n);
    const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
    const chosen = [];
    edges.slice().sort((a, b) => a.w - b.w).forEach(e => { const a = find(e.u), b = find(e.v); if (a !== b) { parent[a] = b; chosen.push(e); } });
    const total = chosen.reduce((s, e) => s + e.w, 0);
    return { value: ask === 'mst_edges' ? chosen.length : total, text: String(ask === 'mst_edges' ? chosen.length : total),
      steps: `Kruskal: take edges from lightest to heaviest, skipping any that would close a cycle.\n\n${chosen.map(e => `${e.u}–${e.v} (${e.w})`).join(', ')}\n\nMST weight = **${total}**${chosen.length < nodes.length - 1 ? ' (graph is disconnected: this is a spanning forest)' : ''}.` };
  }
  if (ask === 'shortest_distance') {
    const src = String(p.source || nodes[0]).trim(), dst = String(p.target || '').trim();
    const dist = {}; nodes.forEach(n => dist[n] = Infinity); dist[src] = 0;
    const arcs = directed ? edges : edges.concat(edges.map(e => ({ u: e.v, v: e.u, w: e.w })));
    const neg = arcs.some(e => e.w < 0);
    for (let i = 0; i < nodes.length - 1; i++) for (const e of arcs) if (dist[e.u] + e.w < dist[e.v]) dist[e.v] = dist[e.u] + e.w;   // Bellman-Ford (fine for exam sizes; same result as Dijkstra without negatives)
    const cycle = arcs.some(e => dist[e.u] + e.w < dist[e.v]);
    const value = dst ? dist[dst] : null;
    return { value: cycle ? 'negative cycle' : value, text: cycle ? 'negative cycle' : String(value),
      steps: `${neg ? 'Negative weights present: Bellman-Ford.' : 'Non-negative weights: Dijkstra (same distances).'} From ${src}:\n\n${mdTable(['Vertex', 'Distance'], nodes.map(n => [n, dist[n] === Infinity ? '∞' : dist[n]]))}${dst ? `\n\nShortest ${src} → ${dst} = **${dist[dst]}**` : ''}` };
  }
  // connected components (weakly connected if directed)
  const parent = {}; nodes.forEach(n => parent[n] = n);
  const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
  edges.forEach(e => { parent[find(e.u)] = find(e.v); });
  const extra = (p.vertices ? +p.vertices : nodes.length) - nodes.length;
  const comps = new Set(nodes.map(find)).size + Math.max(0, extra);
  return { value: comps, text: String(comps), steps: `Union the endpoints of every edge; count distinct groups${extra > 0 ? ` (+${extra} isolated vertices)` : ''}: **${comps}** components.` };
}

// ---------- functional dependencies: closure, keys, normal form ----------
function parseAttrs(s) { const t = String(s || '').trim(); return /[,\s]/.test(t) ? t.split(/[\s,]+/).filter(Boolean) : t.split(''); }
function fdSolver(p) {
  const attrs = parseAttrs(p.attributes);
  const fds = (p.fds || []).flatMap(f => String(f).split(/[;\n]/)).map(f => f.replace(/→/g, '->')).filter(f => f.includes('->')).map(f => { const [l, r] = f.split('->'); return { l: parseAttrs(l), r: parseAttrs(r) }; });
  if (!attrs.length || !fds.length) throw new Error('Need the attributes and the functional dependencies (like AB->C).');
  const closure = X => { const c = new Set(X); let ch = true; while (ch) { ch = false; for (const f of fds) if (f.l.every(a => c.has(a)) && !f.r.every(a => c.has(a))) { f.r.forEach(a => c.add(a)); ch = true; } } return c; };
  const isSuper = X => closure(X).size >= attrs.length && attrs.every(a => closure(X).has(a));
  // candidate keys: minimal superkeys (search by size; attributes never on a right side are in every key)
  const core = attrs.filter(a => !fds.some(f => f.r.includes(a)));
  const rest = attrs.filter(a => !core.includes(a)), keys = [];
  for (let size = 0; size <= rest.length && keys.length < 50; size++) {
    const combo = (start, pick) => {
      if (pick.length === size) { const X = core.concat(pick); if (isSuper(X) && !keys.some(k => k.every(a => X.includes(a)))) keys.push(X); return; }
      for (let i = start; i < rest.length; i++) combo(i + 1, pick.concat(rest[i]));
    };
    combo(0, []);
  }
  const prime = new Set(keys.flat());
  const single = fds.flatMap(f => f.r.filter(a => !f.l.includes(a)).map(a => ({ l: f.l, a })));
  const bcnf = single.every(f => isSuper(f.l)), nf3 = single.every(f => isSuper(f.l) || prime.has(f.a));
  const nf2 = single.every(f => prime.has(f.a) || !keys.some(k => f.l.every(x => k.includes(x)) && f.l.length < k.length));
  const nf = bcnf ? 'BCNF' : nf3 ? '3NF' : nf2 ? '2NF' : '1NF';
  const X = parseAttrs(p.closure_of || '');
  const out = { closure: X.length ? [...closure(X)].sort().join('') : '', candidate_keys: keys.map(k => k.join('')).join(', '), key_count: keys.length, prime_count: prime.size, normal_form: nf };
  const ask = p.ask || 'candidate_keys', value = out[ask];
  // a closure is a set: shown as {A, B, C} so it matches options written that way
  const text = ask === 'closure' && value ? `{${[...closure(X)].sort().join(', ')}}` : String(value);
  return { value, text, steps: `R(${attrs.join(', ')}), FDs: ${fds.map(f => `${f.l.join('')}→${f.r.join('')}`).join(', ')}\n
${X.length ? `- Closure ${X.join('')}⁺ = {${[...closure(X)].sort().join(', ')}}\n` : ''}- Attributes never on a right side (in every key): ${core.join(', ') || 'none'}
- Candidate keys (${keys.length}): **${out.candidate_keys}**; prime attributes: ${[...prime].sort().join(', ')}
- BCNF needs every determinant to be a superkey: ${bcnf ? 'yes' : 'no'}. 3NF also allows a prime right side: ${nf3 ? 'yes' : 'no'}. 2NF: no partial dependency of a non-prime attribute on part of a key: ${nf2 ? 'yes' : 'no'}.
- Highest normal form: **${nf}**` };
}

// ---------- probability: binomial / Poisson / geometric ----------
function probSolver(p) {
  const dist = String(p.distribution || 'binomial').toLowerCase(), k = +p.k || 0, ask = p.ask || 'exactly';
  const C = (n, r) => { let c = 1; for (let i = 1; i <= r; i++) c = c * (n - r + i) / i; return c; };
  let pmf, mean, varr, lo = 0, hi, label;
  if (dist.startsWith('bin')) { const n = +p.n, q = +p.p; if (!(n >= 0) || !(q >= 0 && q <= 1)) throw new Error('Binomial needs n and p.'); pmf = x => C(n, x) * q ** x * (1 - q) ** (n - x); mean = n * q; varr = n * q * (1 - q); hi = n; label = `Binomial(n=${n}, p=${q})`; }
  else if (dist.startsWith('poi')) { const l = +p.lambda; if (!(l > 0)) throw new Error('Poisson needs λ.'); pmf = x => { let f = 1; for (let i = 2; i <= x; i++) f *= i; return Math.exp(-l) * l ** x / f; }; mean = l; varr = l; hi = Math.max(k, Math.ceil(l * 10 + 20)); label = `Poisson(λ=${l})`; }
  else { const q = +p.p; if (!(q > 0 && q <= 1)) throw new Error('Geometric needs p.'); pmf = x => x >= 1 ? (1 - q) ** (x - 1) * q : 0; mean = 1 / q; varr = (1 - q) / q / q; lo = 1; hi = Math.max(k, 400); label = `Geometric(p=${q}), X = trial of the first success`; }
  const sum = (a, b) => { let s = 0; for (let x = Math.max(lo, a); x <= b; x++) s += pmf(x); return s; };
  const out = { exactly: pmf(k), at_least: dist.startsWith('poi') || dist.startsWith('geo') ? 1 - sum(lo, k - 1) : sum(k, hi), at_most: sum(lo, k), mean, variance: varr };
  const value = out[ask];
  return { value, text: fmtN(value), steps: `${label}.\n\n- P(X = ${k}) = ${fmtN(out.exactly)}\n- P(X ≥ ${k}) = ${fmtN(out.at_least)}\n- P(X ≤ ${k}) = ${fmtN(out.at_most)}\n- E[X] = ${fmtN(mean)}, Var(X) = ${fmtN(varr)}\n\nAnswer: **${fmtN(value)}**` };
}

// ---------- shared helpers for the solvers below ----------
const ORDINAL_WORDS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
const CARDINAL_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function ordinalNum(w) {
  if (typeof w === 'number') return w;
  const s = String(w ?? '').trim().toLowerCase();
  if (ORDINAL_WORDS.indexOf(s) > 0) return ORDINAL_WORDS.indexOf(s);
  if (CARDINAL_WORDS.indexOf(s) > 0) return CARDINAL_WORDS.indexOf(s);
  const m = s.match(/^(\d+)(?:st|nd|rd|th)?$/);
  return m ? +m[1] : NaN;
}
// Vertex names sort as numbers when both are numbers, else alphabetically.
const natCmp = (a, b) => { const x = Number(a), y = Number(b); return a !== '' && b !== '' && Number.isFinite(x) && Number.isFinite(y) ? x - y : String(a).localeCompare(String(b)); };
function svEdges(list, weighted) {
  return (list || []).map(e => {
    if (typeof e === 'string') { const t = e.trim().split(/\s*(?:->|→|,|\s)\s*/).filter(Boolean); e = { u: t[0], v: t[1], w: t[2] }; }
    return { u: String(e.u ?? '').trim(), v: String(e.v ?? '').trim(), w: e.w == null || e.w === '' ? 1 : +e.w };
  }).filter(e => e.u && e.v && (!weighted || Number.isFinite(e.w)));
}

// ---------- linear algebra (exact fractions with BigInt) ----------
const frGcd = (a, b) => { if (a < 0n) a = -a; if (b < 0n) b = -b; while (b) [a, b] = [b, a % b]; return a; };
function frQ(n, d = 1n) { if (d === 0n) throw new Error('Division by zero.'); if (d < 0n) { n = -n; d = -d; } const g = frGcd(n, d) || 1n; return { n: n / g, d: d / g }; }
function frOf(x) {
  if (x && typeof x === 'object' && typeof x.n === 'bigint') return x;
  const s = String(x ?? '').trim().replace(/−/g, '-');
  let m = s.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (m) return frQ(BigInt(m[1]), BigInt(m[2]));
  const v = Number(s);
  if (s === '' || !Number.isFinite(v)) throw new Error(`"${x}" is not a number.`);
  m = String(v).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (m) { const f = m[3] || ''; return frQ(BigInt(m[1] + m[2] + f), 10n ** BigInt(f.length)); }
  return frQ(BigInt(Math.round(v * 1e12)), 10n ** 12n);
}
const frAdd = (a, b) => frQ(a.n * b.d + b.n * a.d, a.d * b.d), frSub = (a, b) => frQ(a.n * b.d - b.n * a.d, a.d * b.d);
const frMul = (a, b) => frQ(a.n * b.n, a.d * b.d), frDiv = (a, b) => frQ(a.n * b.d, a.d * b.n);
const frZ = a => a.n === 0n, frNum = a => Number(a.n) / Number(a.d), frStr = a => a.d === 1n ? String(a.n) : `${a.n}/${a.d}`;
const frAbs = a => a.n < 0n ? frQ(-a.n, a.d) : a;
function frRref(M) {   // Gauss-Jordan; det is only meaningful for a square matrix
  const A = M.map(r => r.slice()), R = A.length, C = A[0].length;
  let det = frQ(1n), r = 0; const pivots = [];
  for (let c = 0; c < C && r < R; c++) {
    let p = r; while (p < R && frZ(A[p][c])) p++;
    if (p === R) { det = frQ(0n); continue; }
    if (p !== r) { [A[p], A[r]] = [A[r], A[p]]; det = frQ(-det.n, det.d); }
    const pv = A[r][c]; det = frMul(det, pv);
    A[r] = A[r].map(x => frDiv(x, pv));
    for (let i = 0; i < R; i++) if (i !== r && !frZ(A[i][c])) { const f = A[i][c]; A[i] = A[i].map((x, j) => frSub(x, frMul(f, A[r][j]))); }
    pivots.push(c); r++;
  }
  if (r < Math.min(R, C) || R !== C) det = r < R ? frQ(0n) : det;
  return { A, rank: r, det, pivots };
}
function frCharPoly(A) {   // det(λI − A), highest power first (Faddeev–LeVerrier, exact)
  const n = A.length, zero = frQ(0n);
  const mul = (X, Y) => X.map(r => Y[0].map((_, j) => r.reduce((s, x, k) => frAdd(s, frMul(x, Y[k][j])), zero)));
  let M = A.map(r => r.map(() => zero)); const c = [frQ(1n)];
  for (let k = 1; k <= n; k++) {
    M = mul(A, M).map((r, i) => r.map((x, j) => i === j ? frAdd(x, c[k - 1]) : x));
    const tr = mul(A, M).reduce((s, r, i) => frAdd(s, r[i]), zero);
    c.push(frQ(-tr.n, tr.d * BigInt(k)));
  }
  return c;
}
const frPolyEval = (c, x) => c.reduce((s, a) => frAdd(frMul(s, x), a), frQ(0n));
const frPolyDiv = (c, r) => { const out = [c[0]]; for (let i = 1; i < c.length - 1; i++) out.push(frAdd(c[i], frMul(out[i - 1], r))); return out; };
function frPolyStr(c, v = 'λ') {
  const parts = c.map((a, i) => {
    const k = c.length - 1 - i; if (frZ(a)) return '';
    const abs = frAbs(a), one = abs.n === 1n && abs.d === 1n;
    const coef = one && k > 0 ? '' : abs.d !== 1n && k > 0 ? `(${frStr(abs)})` : frStr(abs);
    return `${a.n < 0n ? ' − ' : ' + '}${coef}${k > 0 ? v + (k > 1 ? `^${k}` : '') : ''}`;
  }).join('');
  return parts.replace(/^ \+ /, '').replace(/^ − /, '−') || '0';
}
function polyRootsNumeric(cf) {   // Durand–Kerner on real coefficients (highest first)
  const n = cf.length - 1, a = cf.map(x => x / cf[0]);
  const mul = (x, y) => ({ re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re }), sub = (x, y) => ({ re: x.re - y.re, im: x.im - y.im });
  const div = (x, y) => { const d = y.re * y.re + y.im * y.im; return { re: (x.re * y.re + x.im * y.im) / d, im: (x.im * y.re - x.re * y.im) / d }; };
  const ev = x => a.reduce((s, c) => ({ re: s.re * x.re - s.im * x.im + c, im: s.re * x.im + s.im * x.re }), { re: 0, im: 0 });
  let z = [{ re: 1, im: 0 }]; for (let k = 1; k < n; k++) z.push(mul(z[k - 1], { re: 0.4, im: 0.9 }));
  for (let it = 0; it < 2000; it++) {
    let moved = 0;
    z = z.map((zi, i) => { let den = { re: 1, im: 0 }; z.forEach((zj, j) => { if (j !== i) den = mul(den, sub(zi, zj)); }); const step = div(ev(zi), den); moved = Math.max(moved, Math.hypot(step.re, step.im)); return sub(zi, step); });
    if (moved < 1e-14) break;
  }
  return z.map(x => ({ re: x.re, im: Math.abs(x.im) < 1e-7 ? 0 : x.im }));
}
function frEigen(c) {   // roots of the characteristic polynomial: rational ones exactly, then a quadratic as surds, else numerically
  const roots = []; let poly = c.slice();
  const add = (exact, re, im = 0) => roots.push({ exact, re, im });
  while (poly.length > 1 && frZ(poly[poly.length - 1])) { add('0', 0); poly = poly.slice(0, -1); }
  const divisors = x => { if (x < 0n) x = -x; if (x > 10n ** 10n) return null; const out = []; for (let i = 1n; i * i <= x; i++) if (x % i === 0n) { out.push(i); if (i * i !== x) out.push(x / i); } return out; };
  for (let found = true; found && poly.length > 2;) {
    found = false;
    const L = poly.reduce((l, a) => l / frGcd(l, a.d) * a.d, 1n), ints = poly.map(a => a.n * (L / a.d));
    const P = divisors(ints[ints.length - 1]), Qs = divisors(ints[0]);
    if (!P || !Qs) break;
    outer: for (const p of P) for (const q of Qs) for (const s of [1n, -1n]) {
      const r = frQ(s * p, q);
      if (frZ(frPolyEval(poly, r))) { add(frStr(r), frNum(r)); poly = frPolyDiv(poly, r); found = true; break outer; }
    }
  }
  let how = roots.length ? 'rational-root test' : '';
  if (poly.length === 2) { const r = frDiv(frQ(-poly[1].n, poly[1].d), poly[0]); add(frStr(r), frNum(r)); }
  else if (poly.length === 3) {
    const [a, b, cc] = poly, D = frSub(frMul(b, b), frMul(frQ(4n), frMul(a, cc)));
    const mid = frDiv(frQ(-b.n, b.d), frMul(frQ(2n), a));
    let N = D.n * D.d; const neg = N < 0n; if (neg) N = -N;
    let k = 1n, m = N;
    if (m < 10n ** 12n) for (let i = 2n; i * i <= m; i++) while (m % (i * i) === 0n) { m /= i * i; k *= i; }
    const h = frAbs(frDiv(frQ(k, D.d), frMul(frQ(2n), a))), hv = frNum(h) * Math.sqrt(Number(m)), mv = frNum(mid);
    const hs = (h.n === 1n && h.d === 1n ? '' : h.d !== 1n ? `(${frStr(h)})` : frStr(h)) + (m === 1n ? '' : `√${m}`);
    const ms = frZ(mid) ? '' : frStr(mid) + ' ';
    if (m === 1n && !neg) { add(frStr(frSub(mid, h)), mv - hv); add(frStr(frAdd(mid, h)), mv + hv); }
    else if (!neg) { add(`${ms}− ${hs}`.replace(/^− /, '−'), mv - hv); add(`${ms}+ ${hs}`.replace(/^\+ /, ''), mv + hv); }
    else { add(`${ms}− ${hs}i`.replace(/^− /, '−'), mv, -hv); add(`${ms}+ ${hs}i`.replace(/^\+ /, ''), mv, hv); }
    how = (how ? how + ', then ' : '') + 'quadratic formula';
  } else if (poly.length > 3) {
    polyRootsNumeric(poly.map(frNum)).forEach(z => add(z.im ? `${round(z.re, 4)} ${z.im < 0 ? '−' : '+'} ${round(Math.abs(z.im), 4)}i` : String(round(z.re, 4)), z.re, z.im));
    how = (how ? how + ', then ' : '') + 'numerically (4 decimals)';
  }
  roots.sort((x, y) => x.re - y.re || x.im - y.im);
  return { roots, how: how || 'rational-root test' };
}
function linearAlgebra(p) {
  let rows = p.matrix;
  if (typeof rows === 'string') {
    const t = rows.trim();
    if (/^\[\s*\[/.test(t)) { try { rows = JSON.parse(t); } catch { rows = null; } }
    if (!Array.isArray(rows)) rows = t.replace(/^\[|\]$/g, '').split(/;|\n|\]\s*,?\s*\[/).map(r => r.replace(/[\[\]]/g, '').trim()).filter(Boolean).map(r => r.split(/[\s,]+/));
  }
  if (!Array.isArray(rows) || !rows.length) throw new Error('Need the matrix (one row per line).');
  const M = rows.map(r => (Array.isArray(r) ? r : String(r).split(/[\s,]+/).filter(Boolean)).map(frOf));
  const R = M.length, C = M[0].length;
  if (!C || M.some(r => r.length !== C)) throw new Error('Every row of the matrix needs the same number of entries.');
  const ask = p.ask || 'determinant', square = R === C;
  if (!square && ask !== 'rank') throw new Error(`A ${R}×${C} matrix is not square; only its rank is defined.`);
  if (R > 8 || C > 8) throw new Error('Matrices up to 8×8.');
  const show = A => A.map(r => r.map(frStr).join('  ')).join(' ; ');
  const { rank, det } = frRref(M);
  const out = { rank, matrix: M.map(r => r.map(frStr)) };
  let steps = `A = [ ${show(M)} ] (${R}×${C})\n\n1. Row-reduce A: **rank = ${rank}** (number of non-zero rows / pivots).`;
  let value, text;
  if (square) {
    const n = R, trace = M.reduce((s, r, i) => frAdd(s, r[i]), frQ(0n));
    const cp = frCharPoly(M), eig = frEigen(cp);
    const sumE = eig.roots.reduce((s, z) => s + z.re, 0);
    const prodE = eig.roots.reduce((s, z) => { const re = s.re * z.re - s.im * z.im, im = s.re * z.im + s.im * z.re; return { re, im }; }, { re: 1, im: 0 }).re;
    Object.assign(out, { determinant: frStr(det), trace: frStr(trace), char_poly: frPolyStr(cp), eigenvalues: eig.roots.map(z => ({ exact: z.exact, re: round(z.re, 6), im: round(z.im, 6) })) });
    steps += `\n2. Determinant (product of the pivots, sign flipped once per row swap): **det A = ${frStr(det)}**` +
      `\n3. Trace = sum of the diagonal = ${M.map((r, i) => frStr(r[i])).join(' + ')} = **${frStr(trace)}**` +
      `\n4. Characteristic polynomial det(λI − A) = **${out.char_poly}**` +
      `\n5. Eigenvalues (${eig.how}): **${eig.roots.map(z => z.exact).join(', ')}**` +
      `\n6. Check: sum of eigenvalues = ${fmtN(sumE)} = trace ${frStr(trace)} ${Math.abs(sumE - frNum(trace)) < 1e-6 ? '✓' : '✗'}; product = ${fmtN(prodE)} = det ${frStr(det)} ${Math.abs(prodE - frNum(det)) < 1e-6 * Math.max(1, Math.abs(frNum(det))) ? '✓' : '✗'}`;
    let inv = null;
    if (!frZ(det)) {
      const aug = M.map((r, i) => r.concat(M.map((_, j) => frQ(i === j ? 1n : 0n))));
      inv = frRref(aug).A.map(r => r.slice(n));
      out.inverse = inv.map(r => r.map(frStr));
      if (/inverse/.test(ask)) steps += `\n7. Row-reduce [A | I] to [I | A⁻¹]: **A⁻¹ = [ ${show(inv)} ]**${n === 2 ? ` (= (1/${frStr(det)}) × [ ${frStr(M[1][1])}  ${frStr(frQ(-M[0][1].n, M[0][1].d))} ; ${frStr(frQ(-M[1][0].n, M[1][0].d))}  ${frStr(M[0][0])} ])` : ''}`;
    } else if (/inverse/.test(ask)) steps += '\n7. det A = 0, so A is singular: **no inverse**.';
    const real = eig.roots.filter(z => !z.im);
    const pickReal = f => { if (!real.length) throw new Error('No real eigenvalues.'); return real.reduce((b, z) => f(z.re, b.re) ? z : b); };
    const num = q => ({ value: frNum(q), text: frStr(q) + (q.d !== 1n ? ` (= ${fmtN(frNum(q))})` : '') });
    if (ask === 'determinant' || ask === 'product_eigenvalues') ({ value, text } = num(det));
    else if (ask === 'trace' || ask === 'sum_eigenvalues') ({ value, text } = num(trace));
    else if (ask === 'rank') { value = rank; text = String(rank); }
    else if (ask === 'char_poly') { value = text = out.char_poly; }
    else if (ask === 'eigenvalues') { value = text = eig.roots.map(z => z.exact).join(', '); }
    else if (ask === 'largest_eigenvalue' || ask === 'smallest_eigenvalue') { const z = pickReal(ask[0] === 'l' ? (a, b) => a > b : (a, b) => a < b); value = round(z.re, 4); text = z.exact === String(value) ? z.exact : `${z.exact} ≈ ${fmtN(z.re)}`; }
    else if (ask === 'inverse') { value = text = inv ? `[ ${show(inv)} ]` : 'singular (no inverse)'; }
    else if (ask === 'inverse_entry') {
      if (!inv) throw new Error('The matrix is singular, so it has no inverse.');
      const i = +p.row - 1, j = +p.col - 1; if (!(inv[i] && inv[i][j])) throw new Error('Which entry? (row and col, from 1)');
      ({ value, text } = num(inv[i][j]));
    } else throw new Error('Unknown ask ' + ask);
  } else { value = rank; text = String(rank); }
  return { value, text, steps, ...out };
}

// ---------- counting ----------
const bigFact = n => { let r = 1n; for (let i = 2n; i <= BigInt(n); i++) r *= i; return r; };
const bigPerm = (n, r) => { if (r < 0 || r > n) return 0n; let x = 1n; for (let i = 0; i < r; i++) x *= BigInt(n - i); return x; };
const bigChoose = (n, r) => { if (r < 0 || n < 0 || r > n) return 0n; r = Math.min(r, n - r); let x = 1n; for (let i = 1; i <= r; i++) x = x * BigInt(n - r + i) / BigInt(i); return x; };
const bigOut = x => x <= BigInt(Number.MAX_SAFE_INTEGER) && x >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x.toString();
function countingSolver(p) {
  const ask = String(p.ask || '').toLowerCase().replace(/[\s-]+/g, '_');
  const int = x => x != null && x !== '' ? +x : NaN, n = int(p.n), r = int(p.r);
  const need = (...xs) => { if (!xs.every(x => Number.isInteger(x) && x >= 0 && x <= 5000)) throw new Error('Need whole numbers n (and r) for this count.'); };
  let v, steps, extra = {};
  if (ask === 'npr') { need(n, r); v = bigPerm(n, r); steps = `Ordered selection of ${r} from ${n}: P(${n}, ${r}) = ${n}!/(${n} − ${r})! = ${Array.from({ length: Math.min(r, 8) }, (_, i) => n - i).join(' × ')}${r > 8 ? ' × …' : ''} = **${v}**`; }
  else if (ask === 'ncr') { need(n, r); v = bigChoose(n, r); steps = `Unordered selection of ${r} from ${n}: C(${n}, ${r}) = ${n}!/(${r}! × ${n - r}!) = **${v}**`; }
  else if (ask === 'sequences') { need(n, r); v = BigInt(n) ** BigInt(r); steps = `Each of the ${r} positions can be any of the ${n} items (repetition allowed): ${n}^${r} = **${v}**`; }
  else if (ask === 'multichoose') { need(n, r); v = bigChoose(n + r - 1, r); steps = `Choosing ${r} from ${n} kinds with repetition (order does not matter) is stars and bars: C(n + r − 1, r) = C(${n + r - 1}, ${r}) = **${v}**`; }
  else if (ask === 'multiset') {
    let counts = listNums(p.counts).filter(x => x > 0), label = '';
    const word = String(p.word || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (word) { const m = {}; for (const ch of word) m[ch] = (m[ch] || 0) + 1; counts = Object.values(m); label = `${word}: ${word.length} letters, ` + Object.entries(m).filter(([, c]) => c > 1).map(([k, c]) => `${k}×${c}`).join(', ') + ' repeated'; }
    if (!counts.length) throw new Error('Need the word, or how many times each item repeats.');
    const N = counts.reduce((a, b) => a + b, 0); v = bigFact(N); counts.forEach(c => { v /= bigFact(c); });
    steps = `${label ? label + '.\n\n' : ''}Arrangements of ${N} items with repeats = ${N}! / (${counts.filter(c => c > 1).map(c => c + '!').join(' × ') || '1'}) = **${v}**`;
  } else if (ask === 'derangement') {
    need(n); const k = int(p.fixed_points) || 0; if (k > n) throw new Error('More fixed points than items.');
    const D = [1n, 0n]; for (let i = 2; i <= n; i++) D.push(BigInt(i - 1) * (D[i - 1] + D[i - 2]));
    v = bigChoose(n, k) * D[n - k];
    steps = `Derangements: D(m) = (m − 1)(D(m − 1) + D(m − 2)), D(0) = 1, D(1) = 0 (also D(m) = m! Σ (−1)^i / i!).\n\nD: ${D.slice(0, Math.min(n - k, 10) + 1).map((x, i) => `D(${i})=${x}`).join(', ')}${n - k > 10 ? ', …' : ''}\n\n` +
      (k ? `Exactly ${k} of ${n} in their own place: C(${n}, ${k}) × D(${n - k}) = ${bigChoose(n, k)} × ${D[n - k]} = **${v}**` : `None of the ${n} in its own place: **D(${n}) = ${v}**`);
  } else if (ask === 'stars_and_bars') {
    const total = int(p.total); let k = int(p.variables);
    if (!Number.isInteger(total) || !(k >= 1)) throw new Error('Need the total and the number of variables.');
    let lo = listNums(p.lower_bounds); lo = lo.length === 1 ? Array(k).fill(lo[0]) : lo.length === k ? lo : Array(k).fill(0);
    let hi = listNums(p.upper_bounds); hi = hi.length === 1 ? Array(k).fill(hi[0]) : hi.length === k ? hi : Array(k).fill(Infinity);
    if (p.at_most) { k++; lo.push(0); hi.push(Infinity); }
    const left = total - lo.reduce((a, b) => a + b, 0), bounded = hi.map((h, i) => [h, i]).filter(([h]) => Number.isFinite(h));
    if (bounded.length > 16) throw new Error('Too many upper bounds.');
    const terms = []; v = 0n;
    for (let mask = 0; mask < 2 ** bounded.length; mask++) {
      const S = bounded.filter((_, i) => mask & (1 << i)), cut = S.reduce((s, [h, i]) => s + h - lo[i] + 1, 0), m = left - cut;
      const c = m < 0 ? 0n : bigChoose(m + k - 1, k - 1);
      v += S.length % 2 ? -c : c; if (bounded.length) terms.push(`${S.length % 2 ? '−' : '+'} C(${m + k - 1}, ${k - 1})`);
    }
    steps = `x₁ + … + x${k}${p.at_most ? ' (incl. a slack variable for "≤")' : ''} = ${total}${lo.some(Boolean) ? `, with xᵢ ≥ ${[...new Set(lo)].join('/')}: substitute yᵢ = xᵢ − lowerᵢ, leaving ${left}` : ''}.\n\n` +
      (bounded.length ? `Upper bounds by inclusion–exclusion (subtract the cases where a variable exceeds its bound): ${terms.join(' ').replace(/^\+ /, '')} = **${v}**` : `Stars and bars: C(${left} + ${k} − 1, ${k} − 1) = C(${left + k - 1}, ${k - 1}) = **${v}**`);
  } else if (ask === 'circular') {
    need(n); const rr = Number.isInteger(r) && r > 0 ? r : n; if (rr > n) throw new Error('Cannot seat more than n.');
    v = bigPerm(n, rr) / BigInt(rr); const flip = !!p.reflections_same && rr >= 3; if (flip) v /= 2n;
    steps = `${rr === n ? `${n} distinct items in a circle: rotations are the same arrangement, so (n − 1)! = ${n - 1}!` : `${rr} of ${n} around a circle: P(${n}, ${rr}) / ${rr}`} = ${flip ? bigPerm(n, rr) / BigInt(rr) : v}${flip ? `; turning it over gives the same (necklace/garland), so ÷ 2 = **${v}**` : ` → **${v}**`}`;
  } else if (ask === 'inclusion_exclusion') {
    let S, U = int(p.universe), lines = [], nsets;
    const divs = listNums(p.divisors).filter(x => x > 0);
    if (divs.length) {
      const hiN = int(p.range_max), loN = Number.isFinite(int(p.range_min)) ? int(p.range_min) : 1;
      if (!(hiN >= loN)) throw new Error('Need the range, e.g. 1 to 1000.');
      const g = (a, b) => b ? g(b, a % b) : a, lcm = (a, b) => a / g(a, b) * b, cnt = d => Math.floor(hiN / d) - Math.floor((loN - 1) / d);
      S = Array(divs.length + 1).fill(0); nsets = divs.length;
      for (let mask = 1; mask < 2 ** divs.length; mask++) { const ds = divs.filter((_, i) => mask & (1 << i)), L = ds.reduce(lcm, 1); S[ds.length] += cnt(L); lines.push(`divisible by ${ds.join(' and ')}${ds.length > 1 ? ` (lcm ${L})` : ''}: ⌊${hiN}/${L}⌋${loN > 1 ? ` − ⌊${loN - 1}/${L}⌋` : ''} = ${cnt(L)}`); }
      U = hiN - loN + 1;
    } else {
      const sizes = listNums(p.set_sizes), pairs = listNums(p.pair_intersections), triple = int(p.triple_intersection) || 0;
      if (sizes.length < 2) throw new Error('Need the set sizes (and their intersections), or the divisors and range.');
      nsets = sizes.length; S = [0, sizes.reduce((a, b) => a + b, 0), pairs.reduce((a, b) => a + b, 0), triple].slice(0, nsets + 1);
      lines.push(`Σ|Aᵢ| = ${S[1]}`, `Σ|Aᵢ ∩ Aⱼ| = ${S[2]}`); if (nsets > 2) lines.push(`|A ∩ B ∩ C| = ${S[3]}`);
    }
    const K = S.length - 1;
    const exactly = m => { let s = 0; for (let j = m; j <= K; j++) s += (-1) ** (j - m) * Number(bigChoose(j, m)) * (S[j] || 0); return s; };
    const union = S.reduce((s, x, j) => j ? s + (-1) ** (j + 1) * x : s, 0);
    const outs = { union, none: U - union, exactly_one: exactly(1), exactly_two: exactly(2), at_least_two: union - exactly(1), all: S[nsets] };
    const ie = p.ie_ask || 'union';
    if (!(ie in outs)) throw new Error('Unknown ie_ask ' + ie);
    if (ie === 'none' && !Number.isFinite(U)) throw new Error('"Neither/none" needs the size of the whole set (universe).');
    v = BigInt(outs[ie]);
    extra = { counts: outs };
    steps = `${lines.map(l => '- ' + l).join('\n')}\n\n|union| = S₁ − S₂ + S₃ − … = ${S.slice(1).join(' − ').replace(/− (\d+) − (\d+)/, '− $1 + $2')} = **${union}**` +
      `${Number.isFinite(U) ? `\n\nIn none = ${U} − ${union} = ${U - union}` : ''}\n\nExactly one = ${outs.exactly_one}; at least two = ${outs.at_least_two}; in all = ${outs.all}.\n\nAnswer (${ie.replace(/_/g, ' ')}): **${v}**`;
  } else throw new Error('Which count? (set "ask": nPr, nCr, sequences, multichoose, multiset, derangement, stars_and_bars, circular, inclusion_exclusion)');
  const value = bigOut(v);
  return { value, text: String(value), steps, ...extra };
}

// ---------- recurrence values: evaluate T(n) exactly, count calls and additions ----------
const REC_FUNCS = { floor: Math.floor, ceil: Math.ceil, log: Math.log2, lg: Math.log2, ln: Math.log, sqrt: Math.sqrt };
function recParse(src) {
  let s = String(src || '').replace(/⌊/g, 'floor(').replace(/⌈/g, 'ceil(').replace(/[⌋⌉]/g, ')').replace(/\\lfloor/g, 'floor(').replace(/\\lceil/g, 'ceil(').replace(/\\r(floor|ceil)/g, ')')
    .replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/\\cdot|\\times/g, '*').replace(/√/g, 'sqrt').replace(/\*\*/g, '^').replace(/\$/g, '')
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\\(log|lg|ln|sqrt)/g, '$1')
    .replace(/\blog_?2\s*/g, 'lg ').replace(/\b(log|lg|ln|sqrt)(?=n\b)/g, '$1 ').replace(/\bn(?=(log|lg|sqrt)\b)/g, 'n ');
  let fname = 'T', rhs = s;
  const eq = s.match(/^\s*([A-Za-z]\w*)\s*\(\s*n\s*\)\s*=(.*)$/);
  if (eq) { fname = eq[1]; rhs = eq[2]; }
  rhs = rhs.split(/\s+(?:for|if|when|where|with)\b|[,;]/)[0].replace(/[.?]\s*$/, '');
  const toks = []; const re = /\s*(\d+(?:\.\d+)?|[A-Za-z_]\w*|\S)/g; let m;
  while ((m = re.exec(rhs))) toks.push(m[1]);
  let i = 0; const peek = () => toks[i];
  const fail = () => { throw new Error(`Could not read the recurrence near "${toks.slice(i, i + 4).join('') || 'the end'}".`); };
  const expect = t => { if (toks[i] !== t) fail(); i++; };
  function expr() { let a = term(); while (peek() === '+' || peek() === '-') { const op = toks[i++]; a = { t: 'bin', op, a, b: term() }; } return a; }
  function term() { let a = unary(); for (;;) { const t = peek(); if (t === '*' || t === '/') { i++; a = { t: 'bin', op: t, a, b: unary() }; } else if (t != null && /^[\d(A-Za-z_]/.test(t)) a = { t: 'bin', op: '*', a, b: power() }; else return a; } }
  function unary() { if (peek() === '-') { i++; return { t: 'neg', a: unary() }; } if (peek() === '+') { i++; return unary(); } return power(); }
  function power() { const a = primary(); if (peek() === '^') { i++; return { t: 'bin', op: '^', a, b: unary() }; } return a; }
  function primary() {
    const t = toks[i++];
    if (t == null) fail();
    if (/^\d/.test(t)) return { t: 'num', v: +t };
    if (t === '(') { const e = expr(); expect(')'); return e; }
    if (/^[A-Za-z_]/.test(t)) {
      if (t === fname && peek() === '(') { i++; const arg = expr(); expect(')'); return { t: 'rec', arg }; }
      if (REC_FUNCS[t]) { if (peek() === '(') { i++; const arg = expr(); expect(')'); return { t: 'fn', f: t, arg }; } return { t: 'fn', f: t, arg: power() }; }
      if (t === 'n') return { t: 'n' };
      throw new Error(`Unknown symbol "${t}" in the recurrence (give constants as numbers).`);
    }
    i--; fail();
  }
  const ast = expr();
  if (i < toks.length) fail();
  return { fname, ast, rhs: rhs.trim() };
}
function recEval(node, n, get, cnt) {
  switch (node.t) {
    case 'num': return node.v;
    case 'n': return n;
    case 'neg': return -recEval(node.a, n, get, cnt);
    case 'fn': return REC_FUNCS[node.f](recEval(node.arg, n, get, null));
    case 'rec': return get(recEval(node.arg, n, null, null));
    default: {
      const a = recEval(node.a, n, get, cnt), b = recEval(node.b, n, get, cnt);
      if (node.op === '+' && cnt) cnt.adds++;
      return node.op === '+' ? a + b : node.op === '-' ? a - b : node.op === '*' ? a * b : node.op === '/' ? a / b : a ** b;
    }
  }
}
function recurrenceValue(p) {
  const { fname, ast, rhs } = recParse(p.recurrence);
  const mode = /ceil/i.test(p.division || '') ? 'ceil' : /exact|real/i.test(p.division || '') ? 'exact' : 'floor';
  const rnd = x => mode === 'exact' ? x : mode === 'ceil' ? Math.ceil(x - 1e-9) : Math.floor(x + 1e-9);
  const base = new Map();
  (p.base_cases || []).forEach(b => {
    if (typeof b === 'string') { const m = b.match(/\(\s*(-?\d+(?:\.\d+)?)\s*\)\s*=\s*(-?\d+(?:\.\d+)?)/) || b.match(/^\s*(-?\d+(?:\.\d+)?)[\s,:=]+(-?\d+(?:\.\d+)?)\s*$/); if (m) base.set(+m[1], +m[2]); }
    else if (b && b.n != null && b.n !== '' && b.value != null && b.value !== '') base.set(+b.n, +b.value);
  });
  const upto = p.base_upto != null && p.base_upto !== '' ? +p.base_upto : null, uptoVal = +p.base_upto_value || 0;
  const N = +p.n;
  if (!Number.isFinite(N)) throw new Error(`Which n? (e.g. find ${fname}(10) → n = 10)`);
  if (!base.size && upto == null) throw new Error(`Need the base case(s), e.g. ${fname}(1) = 1.`);
  const minBase = Math.min(...base.keys(), upto ?? Infinity);
  const isBase = m => base.has(m) || (upto != null && m <= upto + 1e-12);
  const recs = []; (function walk(x) { if (x.t === 'rec') { recs.push(x); return; } for (const k of ['a', 'b', 'arg']) if (x[k]) walk(x[k]); })(ast);
  const memo = new Map(), stack = [N]; let guard = 0;
  while (stack.length) {
    const m = stack[stack.length - 1];
    if (memo.has(m)) { stack.pop(); continue; }
    if (isBase(m)) { memo.set(m, { v: base.has(m) ? base.get(m) : uptoVal, calls: 1, adds: 0 }); stack.pop(); continue; }
    if (++guard > 3e6) throw new Error('Too many values to compute.');
    const missing = recs.map(r => rnd(recEval(r.arg, m, null, null))).filter(a => !memo.has(a));
    if (missing.length) {
      for (const a of missing) {
        if (!(a < m)) throw new Error(`${fname}(${fmtN(m)}) needs ${fname}(${fmtN(a)}), which is not smaller: a base case must stop it.`);
        if (a < minBase && !isBase(a)) throw new Error(`${fname}(${fmtN(a)}) is needed but no base case gives it.`);
        stack.push(a);
      }
      continue;
    }
    const cnt = { adds: 0 }; let calls = 1, adds = 0;
    const v = recEval(ast, m, a => { const e = memo.get(rnd(a)); calls += e.calls; adds += e.adds; return e.v; }, cnt);
    memo.set(m, { v, calls, adds: adds + cnt.adds });
    stack.pop();
  }
  const keys = [...memo.keys()].sort((a, b) => a - b), top = memo.get(N);
  const shown = keys.length <= 16 ? keys : keys.slice(0, 7).concat(null, keys.slice(-7));
  const table = keys.map(k => ({ n: k, value: memo.get(k).v, calls: memo.get(k).calls, additions: memo.get(k).adds }));
  const out = { value: top.v, calls: top.calls, additions: top.adds, distinct: memo.size };
  const ask = p.ask || 'value', value = out[ask];
  if (value == null) throw new Error('Unknown ask ' + ask);
  const big = x => Math.abs(x) > Number.MAX_SAFE_INTEGER ? ' (beyond 2^53: approximate)' : '';
  const steps = `**${fname}(n) = ${rhs}**; base: ${[...base].map(([k, v]) => `${fname}(${k}) = ${v}`).join(', ')}${upto != null ? `${base.size ? '; ' : ''}${fname}(n) = ${uptoVal} for n ≤ ${upto}` : ''}${recs.length && mode !== 'exact' && /\//.test(rhs) ? ` (n/b rounded ${mode === 'ceil' ? 'up' : 'down'})` : ''}\n\n` +
    `Values are built from the smallest needed n upward (each one only uses smaller ones):\n\n` +
    mdTable(['n', `${fname}(n)`, 'calls (naive recursion)', "additions ('+' in the formula)"], shown.map(k => k == null ? ['…', '…', '…', '…'] : [k, fmtN(memo.get(k).v), memo.get(k).calls, memo.get(k).adds])) +
    `\n\n**${fname}(${N}) = ${fmtN(top.v)}**${big(top.v)}. Computing it by plain recursion makes **${top.calls}** calls (counting the first, and every base-case call) and **${top.adds}** additions; with memoisation only ${memo.size} distinct values are needed.`;
  return { value, text: fmtN(value), steps, table };
}

// ---------- shortest paths: Dijkstra and Bellman–Ford, step by step ----------
function shortestPaths(p) {
  const edges = svEdges(p.edges, true);
  if (!edges.length) throw new Error('Need the edges (u v weight).');
  const directed = !!p.directed, nodes = [...new Set(edges.flatMap(e => [e.u, e.v]))].sort(natCmp);
  const src = String(p.source ?? '').trim() || nodes[0], tgt = String(p.target ?? '').trim();
  if (!nodes.includes(src)) throw new Error(`Source ${src} is not in the graph.`);
  if (tgt && !nodes.includes(tgt)) throw new Error(`Vertex ${tgt} is not in the graph.`);
  const arcs = directed ? edges : edges.flatMap(e => [e, { u: e.v, v: e.u, w: e.w }]);
  const ask = p.ask || 'distances', neg = arcs.some(e => e.w < 0);
  const algo = /bell|ford|\bbf\b/i.test(p.algorithm || '') || ['negative_cycle', 'distances_after_passes'].includes(ask) || (!/dijk/i.test(p.algorithm || '') && neg) ? 'bellman_ford' : 'dijkstra';
  const show = d => d === Infinity ? '∞' : fmtN(d), fmtMap = d => nodes.map(x => `${x}: ${show(d[x])}`).join(', ');
  const init = () => { const d = {}; nodes.forEach(x => { d[x] = Infinity; }); d[src] = 0; return d; };
  const bf = (k, rows) => {
    const d = init(), pr = {}, snaps = [];
    const total = Math.max(k, nodes.length - 1);
    for (let i = 1; i <= total; i++) {
      let changed = false;
      for (const e of arcs) if (d[e.u] + e.w < d[e.v]) { d[e.v] = d[e.u] + e.w; pr[e.v] = e.u; changed = true; }
      snaps.push({ ...d }); if (rows) rows.push([i, fmtMap(d)]);
      if (!changed && i >= k) break;
    }
    return { d, pr, snaps, cycle: arcs.some(e => d[e.u] + e.w < d[e.v]) };
  };
  let dist, pred = {}, order = [], passes = [], negCycle = false, steps;
  const head = `**${algo === 'dijkstra' ? 'Dijkstra' : 'Bellman–Ford'}** from ${src} on a${directed ? ' directed' : 'n undirected'} graph (${nodes.length} vertices, ${edges.length} edges).`;
  if (algo === 'dijkstra') {
    dist = init(); const done = new Set(), rows = [];
    for (;;) {
      const cand = nodes.filter(x => !done.has(x) && dist[x] < Infinity).sort((a, b) => dist[a] - dist[b] || natCmp(a, b));
      if (!cand.length) break;
      const u = cand[0]; done.add(u); order.push(u);
      const upd = [];
      for (const e of arcs) if (e.u === u && !done.has(e.v) && dist[u] + e.w < dist[e.v]) { dist[e.v] = dist[u] + e.w; pred[e.v] = u; upd.push(`${e.v} → ${fmtN(dist[e.v])}`); }
      rows.push([order.length, `**${u}** (${show(dist[u])})`, upd.join(', ') || '—', nodes.filter(x => !done.has(x)).map(x => `${x}: ${show(dist[x])}`).join(', ') || '—']);
    }
    steps = `${head}\n\nEach step finalises the unfinished vertex with the smallest tentative distance (ties: smaller label first), then relaxes its out-edges to unfinished vertices.\n\n` +
      mdTable(['Step', 'Finalised (distance)', 'Updated', 'Tentative after this step'], rows) + `\n\nOrder finalised: **${order.join(', ')}**`;
    if (neg) {
      const t = bf(nodes.length - 1);
      const wrong = nodes.filter(x => !t.cycle && t.d[x] !== dist[x]);
      steps += `\n\n_Negative edge weights: Dijkstra is not guaranteed correct here. ${t.cycle ? 'The graph even has a negative cycle.' : wrong.length ? `True distances (Bellman–Ford) differ at ${wrong.map(x => `${x} (${show(t.d[x])})`).join(', ')}.` : 'Here its distances happen to match Bellman–Ford.'}_`;
    }
  } else {
    const k = p.passes != null && p.passes !== '' ? Math.max(0, Math.floor(+p.passes)) : nodes.length - 1, rows = [];
    const r = bf(k, rows); dist = r.d; pred = r.pr; passes = r.snaps; negCycle = r.cycle;
    steps = `${head}\n\nEach pass relaxes every edge in the order listed${directed ? '' : ' (both directions)'}, updating distances in place; ${nodes.length - 1} passes suffice without a negative cycle.\n\n` +
      mdTable(['Pass', 'Distances after it'], rows) + `\n\nOne more pass ${negCycle ? '**still improves a distance: negative cycle reachable from ' + src + '**' : 'changes nothing: no negative cycle'}.`;
    if (k !== nodes.length - 1) steps += `\n\nAfter ${k} pass${k === 1 ? '' : 'es'}: ${fmtMap(k ? passes[Math.min(k, passes.length) - 1] : init())}`;
  }
  const pathTo = x => { const path = [x]; let guard = 0; while (path[0] !== src && pred[path[0]] != null && guard++ < nodes.length) path.unshift(pred[path[0]]); return path[0] === src ? path.join(' → ') : 'unreachable'; };
  const needT = () => { if (!tgt) throw new Error('Which vertex? (set "target")'); };
  if (negCycle && ['distances', 'distance_to', 'path', 'predecessor'].includes(ask)) return { value: 'negative cycle', text: 'Negative cycle: shortest distances are undefined', steps, algorithm: algo, negative_cycle: true };
  let value;
  if (ask === 'distances') value = fmtMap(dist);
  else if (ask === 'distance_to') { needT(); value = dist[tgt] === Infinity ? 'unreachable' : dist[tgt]; }
  else if (ask === 'order') { if (algo !== 'dijkstra') throw new Error('The finalising order is a Dijkstra question.'); value = order.join(', '); }
  else if (ask === 'predecessor') { needT(); value = pred[tgt] ?? 'none'; }
  else if (ask === 'path') { needT(); value = pathTo(tgt); }
  else if (ask === 'negative_cycle') value = negCycle ? 'yes' : 'no';
  else if (ask === 'distances_after_passes') { const k = Math.max(0, Math.floor(+p.passes || 0)), d = k ? passes[Math.min(k, passes.length) - 1] : init(); value = tgt ? (d[tgt] === Infinity ? '∞' : d[tgt]) : fmtMap(d); }
  else throw new Error('Unknown ask ' + ask);
  const distOut = Object.fromEntries(nodes.map(x => [x, dist[x] === Infinity ? null : dist[x]]));
  return { value, text: String(value), steps: steps + (tgt && ask !== 'order' ? `\n\nPath ${src} → ${tgt}: ${pathTo(tgt)}` : ''), algorithm: algo, source: src, directed, nodes, edges,
    distances: distOut, predecessors: Object.fromEntries(nodes.map(x => [x, pred[x] ?? null])), order, passes: passes.map(d => Object.fromEntries(nodes.map(x => [x, d[x] === Infinity ? null : d[x]]))), negative_cycle: negCycle };
}

// ---------- topological sort ----------
function topoSort(p) {
  const edges = svEdges(p.edges, false);
  const extra = (Array.isArray(p.vertices) ? p.vertices : String(p.vertices || '').split(/[\s,]+/)).map(x => String(x).trim()).filter(Boolean);
  const nodes = [...new Set([...extra, ...edges.flatMap(e => [e.u, e.v])])].sort(natCmp), n = nodes.length;
  if (!n) throw new Error('Need the edges (u v meaning u must come before v).');
  const idx = new Map(nodes.map((x, i) => [x, i]));
  const kahn = last => {
    const indeg = nodes.map(() => 0), out = [], rows = []; edges.forEach(e => indeg[idx.get(e.v)]++);
    const done = new Set();
    for (;;) {
      const avail = nodes.filter((x, i) => !done.has(x) && indeg[i] === 0);
      if (!avail.length) break;
      const pick = last ? avail[avail.length - 1] : avail[0];
      rows.push([out.length + 1, avail.join(', '), `**${pick}**`]);
      done.add(pick); out.push(pick); edges.forEach(e => { if (e.u === pick) indeg[idx.get(e.v)]--; });
    }
    return { out, rows };
  };
  const small = kahn(false), large = kahn(true), cyclic = small.out.length < n;
  let count = null;
  if (cyclic) count = 0;
  else if (n <= 20) {
    const pm = nodes.map(() => 0); edges.forEach(e => { pm[idx.get(e.v)] |= 1 << idx.get(e.u); });
    const f = new Float64Array(2 ** n); f[0] = 1;
    for (let mask = 0; mask < f.length; mask++) if (f[mask]) for (let v = 0; v < n; v++) if (!(mask & (1 << v)) && (pm[v] & ~mask) === 0) f[mask | (1 << v)] += f[mask];
    count = f[f.length - 1];
  }
  const parseOrder = s => { const t = String(s).trim().split(/[\s,>→\-]+/).filter(Boolean); return t.length === 1 && t[0].length === n && nodes.every(x => x.length === 1) ? t[0].split('') : t; };
  const orders = (Array.isArray(p.orders) ? p.orders : String(p.orders || p.order || '').split(/[;|\n]/)).map(x => String(x).trim()).filter(Boolean).map(parseOrder);
  const check = o => {
    if (o.length !== n || new Set(o).size !== n || o.some(x => !idx.has(x))) return `not a permutation of the ${n} vertices`;
    const pos = new Map(o.map((x, i) => [x, i])), bad = edges.find(e => pos.get(e.u) > pos.get(e.v));
    return bad ? `${bad.u} → ${bad.v} but ${bad.v} comes first` : '';
  };
  const checks = orders.map(o => ({ order: o.join(' '), problem: check(o) }));
  const ask = p.ask || 'count';
  let value;
  if (ask === 'count') { if (count == null) throw new Error('Counting orders is limited to 20 vertices.'); value = count; }
  else if (ask === 'smallest_order' || ask === 'largest_order') { if (cyclic) value = 'none (the graph has a cycle)'; else value = (ask === 'smallest_order' ? small : large).out.join(', '); }
  else if (ask === 'is_valid') {
    if (!checks.length) throw new Error('Which order(s) to check? (set "orders")');
    value = checks.length === 1 ? (checks[0].problem ? 'no' : 'yes') : `valid: ${checks.filter(c => !c.problem).map(c => c.order).join(' | ') || 'none'}; not valid: ${checks.filter(c => c.problem).map(c => c.order).join(' | ') || 'none'}`;
  } else throw new Error('Unknown ask ' + ask);
  const steps = `DAG with ${n} vertices (${nodes.join(', ')}) and ${edges.length} edges "u before v".\n\n` +
    (cyclic ? `Kahn's algorithm gets stuck after ${small.out.join(', ') || 'nothing'}: the rest lie on a **cycle**, so there is **no topological order** (0 orders).` :
      `Kahn's algorithm, always taking the smallest available vertex:\n\n${mdTable(['Step', 'Available (in-degree 0)', 'Taken'], small.rows)}\n\nLexicographically smallest order: **${small.out.join(', ')}**; largest: ${large.out.join(', ')}.` +
      (count != null ? `\n\nNumber of topological orders (count over sets of already-placed vertices: a vertex can be added once all its predecessors are placed): **${count}**` : '')) +
    (checks.length ? `\n\n${checks.map(c => `- ${c.order}: ${c.problem ? `**not valid** (${c.problem})` : '**valid**'}`).join('\n')}` : '');
  return { value, text: String(value), steps, nodes, edges, order: small.out, largest_order: large.out, count, cyclic, checks };
}

// ---------- Huffman coding ----------
function huffmanCode(p) {
  const syms = (p.symbols || []).map((s, i) => typeof s === 'string' ? (m => m ? { name: m[1], f: +m[2] } : null)(s.match(/^\s*(\S+)[\s:=,]+(\d*\.?\d+)\s*%?\s*$/)) : { name: String(s.name ?? s.symbol ?? `s${i + 1}`).trim(), f: +s.freq }).filter(Boolean);
  if (syms.length < 2 || syms.some(s => !(s.f > 0))) throw new Error('Need at least two symbols with positive frequencies.');
  if (new Set(syms.map(s => s.name)).size !== syms.length) throw new Error('Symbol names must be different.');
  let seq = 0;
  let nodes = syms.map((s, i) => ({ w: s.f, members: [i], seq: seq++, label: s.name }));
  const len = syms.map(() => 0), code = syms.map(() => ''), merges = [], short = syms.every(s => s.name.length === 1);
  while (nodes.length > 1) {
    nodes.sort((a, b) => Math.abs(a.w - b.w) > 1e-9 ? a.w - b.w : a.seq - b.seq);
    const [a, b] = nodes.splice(0, 2);
    a.members.forEach(i => { len[i]++; code[i] = '0' + code[i]; }); b.members.forEach(i => { len[i]++; code[i] = '1' + code[i]; });
    const w = round(a.w + b.w, 9), label = short ? a.label + b.label : `${a.label}+${b.label}`;
    merges.push({ a: a.label, wa: a.w, b: b.label, wb: b.w, w, label });
    nodes.push({ w, members: a.members.concat(b.members), seq: seq++, label });
  }
  const sumF = syms.reduce((s, x) => s + x.f, 0), weighted = syms.reduce((s, x, i) => s + x.f * len[i], 0), avg = weighted / sumF;
  const msg = +p.message_length || 0, total = msg ? avg * msg : weighted, fixed = Math.ceil(log2(syms.length));
  const ask = p.ask || 'total_bits';
  let value;
  const tIdx = () => { const t = String(p.target ?? '').trim(); let i = syms.findIndex(s => s.name === t); if (i < 0) i = syms.findIndex(s => s.name.toLowerCase() === t.toLowerCase()); if (i < 0) throw new Error('Which symbol? (set "target")'); return i; };
  if (ask === 'total_bits') value = round(total, 6);
  else if (ask === 'avg_bits') value = round(avg, 6);
  else if (ask === 'code_length_of') value = len[tIdx()];
  else if (ask === 'code_of') value = code[tIdx()];
  else if (ask === 'max_length') value = Math.max(...len);
  else if (ask === 'min_length') value = Math.min(...len);
  else if (ask === 'fixed_length_bits') value = msg ? fixed * msg : fixed * sumF;
  else if (ask === 'codes') value = syms.map((s, i) => `${s.name}: ${code[i]}`).join(', ');
  else throw new Error('Unknown ask ' + ask);
  const steps = `Repeatedly merge the two lightest nodes (ties: the node created earlier first, original symbols in the order given before merged nodes; the first taken gets bit 0).\n\n` +
    mdTable(['Merge', 'Lightest', 'Next', 'New node'], merges.map((m, i) => [i + 1, `${m.a} (${fmtN(m.wa)})`, `${m.b} (${fmtN(m.wb)})`, `${m.label} (${fmtN(m.w)})`])) + '\n\n' +
    mdTable(['Symbol', 'Frequency', 'Code', 'Length', 'freq × length'], syms.map((s, i) => [s.name, fmtN(s.f), code[i], len[i], fmtN(s.f * len[i])])) +
    `\n\nΣ freq × length = **${fmtN(weighted)}**; average = ${fmtN(weighted)} / ${fmtN(sumF)} = **${fmtN(avg)} bits/symbol**${msg ? `; for ${msg} symbols: ${fmtN(avg)} × ${msg} = **${fmtN(total)} bits**` : ''}.` +
    `\n\nFixed-length code would need ⌈log₂ ${syms.length}⌉ = ${fixed} bits/symbol. _Ties can change individual codes, never the total or average length._`;
  return { value, text: String(value), steps, codes: Object.fromEntries(syms.map((s, i) => [s.name, code[i]])), lengths: Object.fromEntries(syms.map((s, i) => [s.name, len[i]])), merges, avg_bits: avg, total_bits: total };
}

// ---------- IPv4 fragmentation ----------
function ipFragment(p) {
  const num = x => x != null && x !== '' ? +x : NaN;
  const H = Number.isFinite(num(p.header_size)) ? num(p.header_size) : 20, Hf = Number.isFinite(num(p.fragment_header_size)) ? num(p.fragment_header_size) : H;
  const mtu = num(p.mtu), th = num(p.transport_header_size) || 0;
  let data = Number.isFinite(num(p.data_size)) ? num(p.data_size) : num(p.datagram_size) - H;
  data += th;
  if (!(mtu > Hf + 8) || !(data > 0)) throw new Error('Need the MTU and the datagram size (or its data size).');
  const start = num(p.start_offset) || 0, lastMf = !!p.original_mf;
  const maxData = Math.floor((mtu - Hf) / 8) * 8, fits = data + H <= mtu;
  if (!fits && p.dont_fragment) return { value: 'dropped', text: 'Dropped (DF set, too big for the MTU)', steps: `${data + H} bytes > MTU ${mtu} and DF = 1, so the router drops it (and sends ICMP "fragmentation needed").`, fragments: [] };
  const n = fits ? 1 : Math.ceil(data / maxData), frags = [];
  for (let i = 0; i < n; i++) {
    const d = fits ? data : Math.min(maxData, data - i * maxData), ob = (fits ? 0 : i * maxData) + start * 8;
    frags.push({ index: i + 1, data: d, total_length: d + (fits ? H : Hf), offset: ob / 8, offset_bytes: ob, mf: i < n - 1 ? 1 : (lastMf ? 1 : 0), first_byte: ob, last_byte: ob + d - 1 });
  }
  const t = String(p.target ?? '').trim(), k = /last/i.test(t) ? n : ordinalNum(t), f = frags[k - 1];
  const needF = () => { if (!f) throw new Error(`Which fragment? (1 to ${n}, or "last")`); return f; };
  const last = frags[n - 1], totalBytes = frags.reduce((s, x) => s + x.total_length, 0);
  const ask = p.ask || 'fragments';
  const fields = x => `MF = ${x.mf}, offset = ${x.offset}, total length = ${x.total_length} bytes`;
  const out = { fragments: n, offset_of: () => needF().offset, mf_of: () => needF().mf, length_of: () => needF().total_length, data_of: () => needF().data, fields_of: () => fields(needF()),
    last_offset: last.offset, last_size: last.total_length, last_data: last.data, total_bytes: totalBytes, overhead_bytes: totalBytes - (data + H) };
  if (!(ask in out)) throw new Error('Unknown ask ' + ask);
  const value = typeof out[ask] === 'function' ? out[ask]() : out[ask];
  const text = ask === 'fragments' ? `${n} fragments (last: ${fields(last)})` : String(value);
  const steps = `Payload to carry = ${th ? `${data - th} + ${th} (transport header) = ` : Number.isFinite(num(p.data_size)) ? '' : `${num(p.datagram_size)} − ${H} (header) = `}**${data} bytes**${start ? `, starting at offset ${start} (this is a fragment being fragmented again)` : ''}.\n\n` +
    (fits ? `${data} + ${H} ≤ MTU ${mtu}: **no fragmentation**.` :
      `Data per fragment = MTU − header = ${mtu} − ${Hf} = ${mtu - Hf}, rounded down to a multiple of 8 (offsets count 8-byte units) = **${maxData} bytes**.\n\nFragments = ⌈${data} / ${maxData}⌉ = **${n}**\n\n` +
      mdTable(['#', 'Data (bytes)', 'Total length', 'Offset (×8 = byte)', 'MF', 'Bytes carried'], frags.map(x => [x.index, x.data, x.total_length, `${x.offset} (${x.offset_bytes})`, x.mf, `${x.first_byte}–${x.last_byte}`])) +
      `\n\nTotal bytes sent = ${totalBytes} (${totalBytes - (data + H)} more than the original, for the extra headers).`);
  return { value, text, steps, fragments: frags, max_data: maxData, mtu, header_size: Hf };
}

// ---------- TCP congestion control (Tahoe / Reno) ----------
function tcpCongestion(p) {
  const mss = p.mss != null && p.mss !== '' ? parseBytes(p.mss) : NaN;
  const toSeg = v => {
    if (v == null || v === '') return NaN;
    const s = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(s) || /(mss|segments?)$/i.test(s)) return parseFloat(s);
    const b = parseBytes(s);
    if (!Number.isFinite(b)) return NaN;
    if (!Number.isFinite(mss)) throw new Error(`"${s}" is in bytes: give the MSS too.`);
    return b / mss;
  };
  const variant = /reno/i.test(p.variant || '') ? 'reno' : 'tahoe';
  const start = toSeg(p.initial_cwnd) > 0 ? toSeg(p.initial_cwnd) : 1;
  const reset = toSeg(p.reset_cwnd) > 0 ? toSeg(p.reset_cwnd) : start;
  const half = x => Math.max(1, Math.floor(x / 2));
  let ssth = toSeg(p.ssthresh); if (!(ssth > 0)) ssth = Infinity;
  const lossW = toSeg(p.loss_window);
  if (lossW > 0) ssth = half(lossW);
  const rwnd = toSeg(p.receiver_window), cap = p.slow_start_cap !== false, plus3 = !!p.fast_recovery_plus3;
  const evs = new Map();
  (p.events || []).forEach(e => { const r = ordinalNum(e.round); if (r > 0) evs.set(r, /dup|triple|3/i.test(e.event || '') ? 'triple_dup' : 'timeout'); });
  const tRound = ordinalNum(p.target_round), goal = toSeg(p.target_window);
  const Rmin = Math.max(1, +p.rounds || 0, tRound > 0 ? tRound : 0, ...evs.keys());
  const series = []; let cw = start;
  for (let r = 1; r <= 2000; r++) {
    if (rwnd > 0) cw = Math.min(cw, rwnd);
    const ev = evs.get(r) || '';
    series.push({ round: r, cwnd: cw, ssthresh: ssth === Infinity ? null : ssth, phase: cw < ssth ? 'slow start' : 'congestion avoidance', event: ev });
    if (r >= Rmin && (!(goal > 0) || cw >= goal)) break;
    if (ev === 'timeout' || (ev === 'triple_dup' && variant === 'tahoe')) { ssth = half(cw); cw = reset; }
    else if (ev === 'triple_dup') { ssth = half(cw); cw = ssth + (plus3 ? 3 : 0); }
    else cw = cw < ssth ? (cap ? Math.min(2 * cw, ssth) : 2 * cw) : cw + 1;
  }
  const reachRow = goal > 0 ? series.find(s => s.cwnd >= goal) : null;
  if (goal > 0 && !reachRow) throw new Error('The window never reaches that size (receiver window too small?).');
  const rtt = String(p.rtt ?? '').match(/^\s*(\d+(?:\.\d+)?)\s*([a-zµ]*)/i);
  const unitOut = /kb/i.test(p.answer_in || '') && mss > 0 ? 'KB' : /byte/i.test(p.answer_in || '') && mss > 0 ? 'bytes' : 'MSS';
  const conv = x => x == null ? x : unitOut === 'KB' ? round(x * mss / 1024, 4) : unitOut === 'bytes' ? x * mss : x;
  const wTxt = x => x == null ? '∞' : `${fmtN(x)} MSS${mss > 0 ? ` (${fmtN(x * mss / 1024)} KB)` : ''}`;
  const ask = p.ask || 'cwnd_at';
  const row = () => { if (!(tRound > 0) || !series[tRound - 1]) throw new Error('Which transmission round? (set "target_round")'); return series[tRound - 1]; };
  let value, text;
  if (ask === 'cwnd_at') { const s = row(); value = conv(s.cwnd); text = `${fmtN(value)} ${unitOut} (ssthresh ${wTxt(s.ssthresh)})`; }
  else if (ask === 'ssthresh_at') { const s = row(); value = conv(s.ssthresh); text = `${value == null ? '∞' : fmtN(value) + ' ' + unitOut} (cwnd ${wTxt(s.cwnd)})`; if (value == null) value = 'infinite (not yet set)'; }
  else if (ask === 'rounds_to_reach' || ask === 'time_to_reach') {
    if (!reachRow) throw new Error('Which window size to reach? (set "target_window")');
    const n = reachRow.round - 1;
    if (ask === 'rounds_to_reach' || !rtt) { value = n; text = `${n} RTTs`; }
    else { value = round(n * +rtt[1], 6); text = `${fmtN(value)} ${rtt[2] || ''} (${n} RTTs × ${rtt[1]} ${rtt[2] || ''})`.replace(/\s+\)/g, ')'); }
  } else if (ask === 'series') { value = series.map(s => fmtN(conv(s.cwnd))).join(', '); text = value; }
  else throw new Error('Unknown ask ' + ask);
  const steps = `**TCP ${variant === 'reno' ? 'Reno' : 'Tahoe'}**, windows in MSS${mss > 0 ? ` (1 MSS = ${fmtSizeB(mss)})` : ''}. Start cwnd = ${fmtN(start)}, ssthresh = ${lossW > 0 ? `half of the window at the loss (${fmtN(lossW)}) = ${half(lossW)}` : ssth === Infinity && !evs.size ? '∞' : fmtN(toSeg(p.ssthresh) || Infinity)}.\n\n` +
    `Rules: slow start doubles cwnd each RTT while cwnd < ssthresh${cap ? ' (never past ssthresh)' : ''}; then +1 MSS per RTT. Timeout${variant === 'tahoe' ? ' or 3 duplicate ACKs' : ''}: ssthresh = ⌊cwnd/2⌋, cwnd = ${fmtN(reset)}.${variant === 'reno' ? ` 3 duplicate ACKs: ssthresh = ⌊cwnd/2⌋, cwnd = ssthresh${plus3 ? ' + 3' : ''} (fast recovery).` : ''} A loss "in round r" uses round r's window; round r+1 starts with the new one.\n\n` +
    mdTable(['Round', 'cwnd', 'ssthresh', 'Phase', 'Event'], series.map(s => [s.round, fmtN(s.cwnd), s.ssthresh == null ? '∞' : fmtN(s.ssthresh), s.phase, s.event ? (s.event === 'timeout' ? '**timeout**' : '**3 dup ACKs**') : ''])) +
    (reachRow ? `\n\ncwnd first reaches ${wTxt(goal)} in round ${reachRow.round}, i.e. after **${reachRow.round - 1} RTTs**${rtt ? ` = ${fmtN((reachRow.round - 1) * +rtt[1])} ${rtt[2] || ''}` : ''}.` : '');
  return { value, text, steps, series, variant, mss: mss > 0 ? mss : null };
}

// ---------- registry ----------
const S_ =(type, extra = {}) => ({ type, ...extra });
const Solvers = {
  list: [
    { id: 'cpu', name: 'CPU scheduling', subject: 'Operating System', run: cpuSchedule,
      hint: /\b(fcfs|sjf|srtf|srjf|shortest[- ]remaining|shortest[- ]job|round[- ]robin|time quantum|time slice|priority scheduling|hrrn|response ratio|turn ?around time|waiting time)\b/i,
      schema: { type: 'object', required: ['algorithm', 'processes', 'ask'], properties: {
        algorithm: S_('string', { enum: ['FCFS', 'SJF', 'SRTF', 'RR', 'PRIORITY', 'PRIORITY_PREEMPTIVE', 'HRRN'] }),
        processes: { type: 'array', items: { type: 'object', required: ['name', 'arrival', 'burst'], properties: { name: S_('string'), arrival: S_('number'), burst: S_('number'), priority: S_('number') } } },
        quantum: S_('number'), context_switch: S_('number'), lower_number_higher_priority: S_('boolean'),
        ask: S_('string', { enum: ['avg_waiting', 'avg_turnaround', 'avg_response', 'completion_of', 'waiting_of', 'turnaround_of', 'response_of', 'context_switches', 'total_time', 'cpu_utilization'] }),
        target: S_('string', { description: 'process name when ask is about one process' }) } } },
    { id: 'page', name: 'Page replacement', subject: 'Operating System', run: pageReplace,
      hint: /\b(page faults?|page replacement|reference string|lru|fifo|optimal page|belady)\b/i,
      schema: { type: 'object', required: ['algorithm', 'frames', 'references', 'ask'], properties: {
        algorithm: S_('string', { enum: ['FIFO', 'LRU', 'OPT', 'LFU', 'MRU'] }), frames: S_('integer'), references: { type: 'array', items: S_('integer') },
        ask: S_('string', { enum: ['faults', 'hits', 'hit_ratio', 'miss_ratio'] }) } } },
    { id: 'cache', name: 'Cache address split', subject: 'Computer Organization and Architecture', run: cacheMap,
      hint: /\b(tag bits?|tag field|index bits?|set[- ]associative|direct[- ]mapped|fully associative|tag directory|block offset|cache lines?)\b/i,
      schema: { type: 'object', required: ['cache_size', 'block_size', 'ways', 'ask'], properties: {
        cache_size: S_('string', { description: 'e.g. "32KB"' }), block_size: S_('string', { description: 'e.g. "64B"' }), ways: S_('integer', { description: '1 = direct mapped, 0 = fully associative' }),
        address_bits: S_('integer'), main_memory_size: S_('string'), extra_bits_per_line: S_('integer', { description: 'valid/dirty/replacement bits per line, if asked for tag memory size' }),
        ask: S_('string', { enum: ['tag_bits', 'index_bits', 'offset_bits', 'lines', 'sets', 'tag_directory_bits', 'tag_directory_bytes'] }) } } },
    { id: 'amat', name: 'Average memory access time', subject: 'Computer Organization and Architecture', run: amat,
      hint: /\b(average (memory )?access time|effective (memory )?access time|amat|hit (ratio|rate)|miss (ratio|rate)|miss penalty)\b/i,
      schema: { type: 'object', required: ['levels', 'memory_time', 'mode'], properties: {
        levels: { type: 'array', items: { type: 'object', required: ['hit_time'], properties: { hit_time: S_('number'), hit_rate: S_('number'), miss_rate: S_('number') } } },
        memory_time: S_('number'), mode: S_('string', { enum: ['hierarchical', 'simultaneous'] }) } } },
    { id: 'pipe', name: 'Pipeline timing', subject: 'Computer Organization and Architecture', run: pipeline,
      hint: /\b(pipelin\w*|stages?|speed ?up|latch)\b/i,
      schema: { type: 'object', required: ['instructions', 'ask'], properties: {
        stage_delays: { type: 'array', items: S_('number') }, stages: S_('integer'), instructions: S_('integer'), latch_delay: S_('number'), cycle_time: S_('number'),
        stall_cycles: S_('integer'), nonpipelined_time_per_instruction: S_('number'), ask: S_('string', { enum: ['total_time', 'speedup', 'cycle_time', 'throughput', 'cycles'] }) } } },
    { id: 'ip', name: 'IPv4 subnetting', subject: 'Computer Networks', run: ipv4,
      hint: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|subnet|cidr|broadcast address|network address|netmask)\b/i,
      schema: { type: 'object', required: ['ip', 'ask'], properties: { ip: S_('string', { description: 'e.g. "200.10.12.77/26"' }), prefix: S_('integer'), mask: S_('string'), new_prefix: S_('integer'),
        ask: S_('string', { enum: ['network', 'broadcast', 'first_host', 'last_host', 'hosts', 'mask', 'subnets', 'addresses'] }) } } },
    { id: 'banker', name: "Banker's algorithm", subject: 'Operating System', run: bankers,
      hint: /\b(banker|safe state|safe sequence|unsafe|max(imum)? (need|demand)|allocation matrix)\b/i,
      schema: { type: 'object', required: ['allocation', 'ask'], properties: {
        names: { type: 'array', items: S_('string') }, allocation: { type: 'array', items: { type: 'array', items: S_('integer') } },
        max: { type: 'array', items: { type: 'array', items: S_('integer') } }, need: { type: 'array', items: { type: 'array', items: S_('integer') } },
        available: { type: 'array', items: S_('integer') }, total: { type: 'array', items: S_('integer') },
        request_process: S_('string'), request: { type: 'array', items: S_('integer') }, ask: S_('string', { enum: ['safe', 'safe_sequence', 'can_grant'] }) } } },
    { id: 'disk', name: 'Disk scheduling', subject: 'Operating System', run: diskSchedule,
      hint: /\b(head movement|disk scheduling|cylinders?|sstf|c-?scan|c-?look|seek)\b/i,
      schema: { type: 'object', required: ['algorithm', 'head', 'requests'], properties: {
        algorithm: S_('string', { enum: ['FCFS', 'SSTF', 'SCAN', 'CSCAN', 'LOOK', 'CLOOK'] }), head: S_('integer'), requests: { type: 'array', items: S_('integer') },
        direction: S_('string', { enum: ['up', 'down'] }), min_cylinder: S_('integer'), max_cylinder: S_('integer'), count_return_jump: S_('boolean'), ask: S_('string', { enum: ['total_movement', 'order'] }) } } },
    { id: 'num', name: 'Number systems', subject: 'Digital Logic', run: numberSystems,
      hint: /\b(base[- ]?\d+|radix|octal|hexa?decimal|(in|to|into|from) binary|binary (number|representation|equivalent|value)|2'?s complement|two's complement|1'?s complement|one's complement|sign[- ]magnitude)\b|\)\s*_\{?\d+\}?|\(\s*[0-9A-F.]+\s*\)\s*\d{1,2}\b/i,
      schema: { type: 'object', required: ['mode', 'value'], properties: {
        mode: S_('string', { enum: ['convert', 'twos_complement_of', 'signed_value_of', 'range'] }), value: S_('string'), from_base: S_('integer'), to_base: S_('integer'), bits: S_('integer'),
        representation: S_('string', { enum: ['twos', 'ones', 'sign_magnitude', 'unsigned'] }) } } },
    { id: 'ieee', name: 'IEEE 754 floating point', subject: 'Digital Logic', run: ieee754,
      hint: /\b(ieee[- ]?754|single precision|double precision|floating[- ]point representation|mantissa|exponent bias)\b/i,
      schema: { type: 'object', required: ['mode', 'value'], properties: { mode: S_('string', { enum: ['to_bits', 'from_bits'] }), value: S_('string'),
        precision: S_('string', { enum: ['single', 'double'] }), ask: S_('string', { enum: ['hex', 'bits', 'exponent_field', 'mantissa_bits'] }) } } },
    { id: 'kmap', name: 'Boolean minimisation (K-map)', subject: 'Digital Logic', run: booleanMin,
      hint: /\b(k-?map|karnaugh|minterms?|maxterms?|prime implicants?|sum of products|minimi[sz]ed? (sop|expression|form)|Σ\s*m|\bsum\s*m\s*\()/i,
      schema: { type: 'object', required: ['variables', 'ask'], properties: { variables: S_('integer'), minterms: { type: 'array', items: S_('integer') }, maxterms: { type: 'array', items: S_('integer') },
        dont_cares: { type: 'array', items: S_('integer') }, names: S_('string'), ask: S_('string', { enum: ['expression', 'prime_implicants', 'essential_prime_implicants', 'terms', 'literals'] }) } } },
    { id: 'master', name: 'Recurrence (master theorem)', subject: 'Algorithms', run: masterTheorem,
      hint: /T\s*\(\s*n\s*\)\s*=|\brecurrence\b|\bmaster theorem\b/i,
      schema: { type: 'object', required: ['a', 'b', 'k'], properties: { form: S_('string', { enum: ['divide', 'decrease'] }), a: S_('number'), b: S_('number'),
        k: S_('number', { description: 'f(n) = n^k (log n)^log_power' }), log_power: S_('number') } } },
    { id: 'hash', name: 'Hashing (open addressing)', subject: 'Programming and Data Structures', run: hashing,
      hint: /\b(linear probing|quadratic probing|double hashing|open addressing|hash table|mod \d+)\b/i,
      schema: { type: 'object', required: ['table_size', 'keys', 'method', 'ask'], properties: { table_size: S_('integer'), keys: { type: 'array', items: S_('integer') },
        method: S_('string', { enum: ['linear', 'quadratic', 'double'] }), r: S_('integer'), target: S_('integer'), ask: S_('string', { enum: ['position_of', 'key_at', 'total_probes', 'collisions'] }) } } },
    { id: 'paging', name: 'Paging & page tables', subject: 'Operating System', run: paging,
      hint: /\b(page[- ]table|page size|\d+\s*[KMG]?B pages|virtual address|logical address|pte|multi-?level paging|frames?)\b/i,
      schema: { type: 'object', required: ['page_size', 'ask'], properties: { page_size: S_('string'), virtual_address_bits: S_('integer'), virtual_memory_size: S_('string'),
        physical_address_bits: S_('integer'), physical_memory_size: S_('string'), pte_size: S_('string'), extra_bits: S_('integer'),
        ask: S_('string', { enum: ['page_table_bytes', 'pages', 'frames', 'offset_bits', 'vpn_bits', 'frame_bits', 'pte_bits_min', 'levels'] }) } } },
    { id: 'tlb', name: 'TLB effective access time', subject: 'Operating System', run: tlbEmat,
      hint: /\b(tlb|translation look-?aside|associative memory)\b/i,
      schema: { type: 'object', required: ['memory_time', 'tlb_hit_rate'], properties: { tlb_time: S_('number'), memory_time: S_('number'), tlb_hit_rate: S_('number'),
        page_table_levels: S_('integer'), tlb_mode: S_('string', { enum: ['sequential', 'parallel'] }), page_fault_rate: S_('number'), page_fault_service_time: S_('number') } } },
    { id: 'window', name: 'Link efficiency & sliding window', subject: 'Computer Networks', run: slidingWindow,
      hint: /\b(stop[- ]and[- ]wait|go[- ]back[- ]n|selective repeat|sliding window|propagation delay|link utili[sz]ation|efficiency|sequence number bits?)\b/i,
      schema: { type: 'object', required: ['bandwidth', 'frame_size', 'protocol', 'ask'], properties: { bandwidth: S_('string', { description: 'e.g. "1 Mbps"' }),
        frame_size: S_('string', { description: 'e.g. "1000 bytes" or "8000 bits"' }), propagation_delay: S_('string', { description: 'e.g. "10 ms"' }), distance: S_('string'), signal_speed: S_('string'),
        protocol: S_('string', { enum: ['stop_and_wait', 'go_back_n', 'selective_repeat'] }), window: S_('integer'), sequence_bits: S_('integer', { description: 'only if the question gives the sequence-number field size' }),
        ask: S_('string', { enum: ['efficiency', 'throughput_bps', 'min_window', 'seq_bits', 'a', 'transmission_time'] }) } } },
    { id: 'crc', name: 'CRC remainder', subject: 'Computer Networks', run: crc,
      hint: /\b(crc|cyclic redundancy|generator polynomial|divisor)\b/i,
      schema: { type: 'object', required: ['message', 'generator'], properties: { message: S_('string'), generator: S_('string', { description: 'as bits, e.g. x^3+x+1 = "1011"' }), ask: S_('string', { enum: ['remainder', 'transmitted'] }) } } },
    { id: 'grammar', name: 'Grammar: FIRST/FOLLOW, LL(1), LR(0), SLR', subject: 'Compiler Design', run: grammarSolver,
      hint: /\b(first\s*\(|follow\s*\(|first set|follow set|ll\s*\(\s*1\s*\)|lr\s*\(\s*0\s*\)|slr|lalr|canonical (collection|lr)|parsing table|grammar)\b/i,
      schema: { type: 'object', required: ['grammar', 'ask'], properties: { grammar: S_('string', { description: 'productions separated by ";" e.g. "S -> a A | b ; A -> c | ε"' }), symbol: S_('string'),
        ask: S_('string', { enum: ['first_of', 'follow_of', 'is_ll1', 'll1_conflicts', 'lr0_states', 'is_lr0', 'is_slr', 'slr_conflicts'] }) } } },
    { id: 'dfa', name: 'Minimal DFA', subject: 'Theory of Computation', run: minDfa,
      hint: /\b(minimi[sz]ed|minimal|minimum)\b[\s\S]{0,40}\b(dfa|automaton|states)\b|\bequivalent states\b/i,
      schema: { type: 'object', required: ['transitions', 'start', 'finals'], properties: { transitions: { type: 'array', items: { type: 'object', required: ['from', 'symbol', 'to'], properties: { from: S_('string'), symbol: S_('string'), to: S_('string') } } },
        start: S_('string'), finals: { type: 'array', items: S_('string') }, ask: S_('string', { enum: ['min_states', 'min_states_without_dead'] }) } } },
    { id: 'graph', name: 'Graph: MST, shortest path, components', subject: 'Algorithms', run: graphSolver,
      hint: /\b(minimum spanning tree|mst|kruskal|prim'?s|shortest path|dijkstra|bellman|connected components?|edge weights?)\b/i,
      schema: { type: 'object', required: ['edges', 'ask'], properties: { edges: { type: 'array', items: { type: 'object', required: ['u', 'v'], properties: { u: S_('string'), v: S_('string'), w: S_('number') } } },
        directed: S_('boolean'), source: S_('string'), target: S_('string'), vertices: S_('integer'), ask: S_('string', { enum: ['mst_weight', 'mst_edges', 'shortest_distance', 'components'] }) } } },
    { id: 'fd', name: 'Functional dependencies: keys, closure, normal form', subject: 'Databases', run: fdSolver,
      hint: /\b(candidate keys?|functional dependenc|attribute closure|closure of|normal form|bcnf|3nf|2nf|prime attributes?|superkey)\b/i,
      schema: { type: 'object', required: ['attributes', 'fds', 'ask'], properties: { attributes: S_('string', { description: 'e.g. "ABCDE"' }), fds: { type: 'array', items: S_('string', { description: 'e.g. "AB->C"' }) },
        closure_of: S_('string'), ask: S_('string', { enum: ['candidate_keys', 'key_count', 'closure', 'prime_count', 'normal_form'] }) } } },
    { id: 'prob', name: 'Probability: binomial, Poisson, geometric', subject: 'Probability and Statistics', run: probSolver,
      hint: /\b(binomial|poisson|geometric distribution|independent trials|probability of (exactly|at least|at most))\b/i,
      schema: { type: 'object', required: ['distribution', 'ask'], properties: { distribution: S_('string', { enum: ['binomial', 'poisson', 'geometric'] }), n: S_('integer'), p: S_('number'), lambda: S_('number'), k: S_('integer'),
        ask: S_('string', { enum: ['exactly', 'at_least', 'at_most', 'mean', 'variance'] }) } } },
    { id: 'linalg', name: 'Matrix: determinant, rank, inverse, eigenvalues', subject: 'Engineering Mathematics', run: linearAlgebra,
      hint: /\b(determinant|eigen\s*values?|eigen\s*vectors?|characteristic (equation|polynomial)|rank of|inverse of (the |a |this )?matrix|trace of|invertible|(non-?)?singular matrix)\b/i,
      schema: { type: 'object', required: ['matrix', 'ask'], properties: { matrix: { type: 'array', items: { type: 'array', items: S_('number') } },
        ask: S_('string', { enum: ['determinant', 'rank', 'inverse', 'inverse_entry', 'eigenvalues', 'largest_eigenvalue', 'smallest_eigenvalue', 'sum_eigenvalues', 'product_eigenvalues', 'trace', 'char_poly'] }),
        row: S_('integer', { description: 'for inverse_entry, from 1' }), col: S_('integer', { description: 'for inverse_entry, from 1' }) } } },
    { id: 'count', name: 'Counting: permutations, combinations, derangements, stars and bars', subject: 'Discrete Mathematics', run: countingSolver,
      hint: /^(?![\s\S]*\bprobabilit)[\s\S]*\b(how many ways|number of (ways|arrangements|permutations|combinations|selections|integer solutions|solutions)|permutations?|combinations?|arrangements?|derangements?|\d+\s*[CP]\s*\d+|n[CP]r|non-?negative integers?|integer solutions|round (a )?table|circular(ly)?|necklace|garland|inclusion[- ]exclusion|divisible by|identical (balls|objects|items|coins)|distinct (boxes|bins))\b/i,
      schema: { type: 'object', required: ['ask'], properties: {
        ask: S_('string', { enum: ['nPr', 'nCr', 'sequences', 'multichoose', 'multiset', 'derangement', 'stars_and_bars', 'circular', 'inclusion_exclusion'], description: 'sequences = n^r with repetition; multichoose = choose r of n kinds with repetition; multiset = arrangements of a word / items with repeats' }),
        n: S_('integer'), r: S_('integer'), word: S_('string'), counts: { type: 'array', items: S_('integer') }, fixed_points: S_('integer', { description: 'derangement: exactly this many in their own place' }),
        total: S_('integer', { description: 'stars and bars: x1 + ... + xk = total' }), variables: S_('integer'), lower_bounds: { type: 'array', items: S_('integer') }, upper_bounds: { type: 'array', items: S_('integer') },
        at_most: S_('boolean', { description: 'sum ≤ total instead of =' }), reflections_same: S_('boolean', { description: 'necklace/garland: flipping gives the same' }),
        set_sizes: { type: 'array', items: S_('integer') }, pair_intersections: { type: 'array', items: S_('integer') }, triple_intersection: S_('integer'), universe: S_('integer'),
        divisors: { type: 'array', items: S_('integer') }, range_min: S_('integer'), range_max: S_('integer'),
        ie_ask: S_('string', { enum: ['union', 'none', 'exactly_one', 'exactly_two', 'at_least_two', 'all'] }) } } },
    { id: 'recval', name: 'Recurrence values: T(n), number of calls', subject: 'Algorithms', run: recurrenceValue,
      hint: /T\s*\(\s*n\s*\)\s*=|\b[a-z]\w*\s*\(\s*n\s*\)\s*=[^\n]*\(\s*n\s*[-\/]|\brecurrence\b|\bfibonacci\b/i,
      schema: { type: 'object', required: ['recurrence', 'base_cases', 'n', 'ask'], properties: { recurrence: S_('string', { description: 'e.g. "T(n) = 2T(n/2) + n"' }),
        base_cases: { type: 'array', items: { type: 'object', required: ['n', 'value'], properties: { n: S_('number'), value: S_('number') } } }, n: S_('number', { description: 'evaluate T at this n' }),
        division: S_('string', { enum: ['floor', 'ceil', 'exact'] }), base_upto: S_('number', { description: 'T(n) = base_upto_value for all n ≤ this' }), base_upto_value: S_('number'),
        ask: S_('string', { enum: ['value', 'calls', 'additions', 'distinct'] }) } } },
    { id: 'sp', name: 'Shortest paths: Dijkstra / Bellman–Ford steps', subject: 'Algorithms', run: shortestPaths,
      hint: /\b(dijkstra'?s?|bellman[- ]?ford|shortest[- ]paths?|single[- ]source|negative[- ](weight )?cycles?|relax\w*)\b/i,
      schema: { type: 'object', required: ['edges', 'source', 'ask'], properties: { edges: { type: 'array', items: { type: 'object', required: ['u', 'v', 'w'], properties: { u: S_('string'), v: S_('string'), w: S_('number') } } },
        directed: S_('boolean'), source: S_('string'), target: S_('string'), algorithm: S_('string', { enum: ['dijkstra', 'bellman_ford'] }), passes: S_('integer', { description: 'Bellman–Ford: distances after this many passes' }),
        ask: S_('string', { enum: ['distances', 'distance_to', 'order', 'predecessor', 'path', 'negative_cycle', 'distances_after_passes'] }) } } },
    { id: 'topo', name: 'Topological sort: count, smallest order, check', subject: 'Algorithms', run: topoSort,
      hint: /\btopolog\w*\s*(sort\w*|order\w*|sequence)|\btopologically\b/i,
      schema: { type: 'object', required: ['edges', 'ask'], properties: { edges: { type: 'array', items: { type: 'object', required: ['u', 'v'], properties: { u: S_('string'), v: S_('string') } } },
        vertices: S_('string', { description: 'all vertex names, incl. isolated ones' }), orders: S_('string', { description: 'order(s) to check, separated by ";" e.g. "a b c d; a c b d"' }),
        ask: S_('string', { enum: ['count', 'smallest_order', 'largest_order', 'is_valid'] }) } } },
    { id: 'huffman', name: 'Huffman coding', subject: 'Algorithms', run: huffmanCode,
      hint: /\b(huffman|prefix[- ]free code|optimal prefix code|variable[- ]length (code|coding|encoding))\b/i,
      schema: { type: 'object', required: ['symbols', 'ask'], properties: { symbols: { type: 'array', items: { type: 'object', required: ['name', 'freq'], properties: { name: S_('string'), freq: S_('number') } } },
        message_length: S_('integer', { description: 'number of characters in the message/file, if given' }), target: S_('string', { description: 'symbol, for code_length_of / code_of' }),
        ask: S_('string', { enum: ['total_bits', 'avg_bits', 'code_length_of', 'code_of', 'max_length', 'min_length', 'fixed_length_bits', 'codes'] }) } } },
    { id: 'frag', name: 'IP fragmentation', subject: 'Computer Networks', run: ipFragment,
      hint: /\b(fragment\w*|mtu|maximum transmission unit|more fragments?|mf (bit|flag))\b/i,
      schema: { type: 'object', required: ['mtu', 'ask'], properties: { datagram_size: S_('integer', { description: 'total IP datagram length incl. header, bytes' }), data_size: S_('integer', { description: 'IP payload bytes, if given instead' }),
        transport_header_size: S_('integer', { description: 'UDP/TCP header to add when only the user data size is given' }), header_size: S_('integer', { description: 'IP header bytes (default 20)' }), mtu: S_('integer'),
        start_offset: S_('integer', { description: 'offset (8-byte units) of an arriving fragment being fragmented again' }), original_mf: S_('boolean'), dont_fragment: S_('boolean'),
        target: S_('string', { description: 'which fragment: 1, 2, ... or "last"' }),
        ask: S_('string', { enum: ['fragments', 'offset_of', 'mf_of', 'length_of', 'data_of', 'fields_of', 'last_offset', 'last_size', 'last_data', 'total_bytes', 'overhead_bytes'] }) } } },
    { id: 'tcp', name: 'TCP congestion window (Tahoe/Reno)', subject: 'Computer Networks', run: tcpCongestion,
      hint: /\b(congestion window|cwnd|slow[- ]start|ssthresh|tahoe|reno|aimd|additive[- ]increase|congestion avoidance|triple duplicate|(3|three) duplicate)\b/i,
      schema: { type: 'object', required: ['ask'], properties: { variant: S_('string', { enum: ['tahoe', 'reno'] }), mss: S_('string', { description: 'e.g. "2KB"; leave empty if windows are in MSS' }),
        initial_cwnd: S_('string', { description: 'e.g. "1" (MSS) or "2KB"' }), ssthresh: S_('string', { description: 'initial threshold, e.g. "8" or "16KB"' }),
        loss_window: S_('string', { description: 'cwnd when the timeout happened, if the question starts from that' }), reset_cwnd: S_('string'), receiver_window: S_('string'),
        events: { type: 'array', items: { type: 'object', required: ['round', 'event'], properties: { round: S_('integer'), event: S_('string', { enum: ['timeout', 'triple_dup'] }) } } },
        target_round: S_('integer'), target_window: S_('string'), rtt: S_('string', { description: 'e.g. "100 ms"' }), fast_recovery_plus3: S_('boolean'), answer_in: S_('string', { enum: ['MSS', 'KB', 'bytes'] }),
        ask: S_('string', { enum: ['cwnd_at', 'ssthresh_at', 'rounds_to_reach', 'time_to_reach', 'series'] }) } } },
  ],
  byId(id) { return this.list.find(s => s.id === id); },
  candidates(question) { return this.list.filter(s => s.hint.test(question)); },
  solve(id, params) { const s = this.byId(id); return { solver: id, name: s.name, params, ...s.run(params) }; },
  // Reads the inputs with the model, then computes exactly. Returns null when no solver fits.
  async answer(question, signal) {
    const q = String(question || '');
    // Programs, queries, expressions and grammars are run for real first (runners.js).
    if (typeof Runners !== 'undefined') { const rr = await Runners.answer(q, signal); if (rr) return rr; }
    let cands = this.candidates(q);
    if (!cands.length) return null;
    // If exactly one candidate's "what is asked" wording matches (e.g. "how many page faults"), use it directly;
    // it still needs the data in the question to compute, so a theory question just fails and returns null.
    let strong = cands.filter(c => askFromWords(c.id, q));
    // Two claim it: keep the ones whose wording is in the asked sentence, then the more specific calculator.
    if (strong.length > 1) { const inAsked = strong.filter(c => askFromWords(c.id, askedPart(q))); if (inAsked.length) strong = inAsked; }
    if (strong.length > 1) strong = strong.filter(c => !strong.some(o => (PREFER_OVER[o.id] || []).includes(c.id)));
    if (strong.length === 1) {
      const params = await this.read(strong[0].id, q, signal);
      try {
        const r = this.solve(strong[0].id, params);
        if (r.value != null && r.value !== '' && !(typeof r.value === 'number' && !Number.isFinite(r.value))) return adjustUnits(strong[0].id, params, r, q);
      } catch {}
    }
    // Otherwise ask: keywords alone can't tell "binary search" from a base conversion.
    const j = parseJSON(await ollamaChat([
      { role: 'system', content: `You route GATE questions to exact calculators. First decide "kind": "computation" if the question gives concrete data (numbers, a list, sizes, an address, bit strings, a recurrence) and asks for a value computed from it; "theory" if it asks about a definition, property, comparison or concept. For a computation, pick the calculator that computes exactly what is asked; pick "none" for theory or if no calculator below computes it.\n` + cands.map(c => `- ${c.id}: ${c.name}`).join('\n') },
      { role: 'user', content: q.slice(0, 3000) },
    ], { signal, model: checkModel(), temperature: 0, maxTokens: 80, format: { type: 'object', required: ['kind', 'solver'], properties: { kind: { type: 'string', enum: ['computation', 'theory'] }, solver: { type: 'string', enum: [...cands.map(c => c.id), 'none'] } } } }));
    const pick = j.kind === 'theory' ? null : this.byId(j.solver);
    if (!pick) return null;
    const params = await this.read(pick.id, q, signal);
    try {
      const r = this.solve(pick.id, params);
      if (r.value == null || r.value === '' || (typeof r.value === 'number' && !Number.isFinite(r.value))) return null;
      return adjustUnits(pick.id, params, r, q);
    } catch (e) { console.warn('solver', pick.id, e.message, params); return null; }
  },
  async read(id, question, signal) {
    const pick = this.byId(id);
    const params = parseJSON(await ollamaChat([
      { role: 'system', content: `Read the inputs of this GATE question for a ${pick.name} calculator. Copy numbers exactly as given (keep units in string fields, e.g. "32KB", "10 ms"). "ask" must be exactly the quantity the question's final sentence asks for. If the question does not actually fit this calculator, still fill what you can; it will be validated.` },
      { role: 'user', content: String(question).slice(0, 4000) },
    ], { signal, model: checkModel(), temperature: 0, maxTokens: 900, format: pick.schema }));
    // What is asked is read by plain rules where the wording is clear (the model sometimes mixes up e.g. hits and faults).
    const asked = askFromWords(id, question);
    if (asked) Object.assign(params, asked);
    fillFromText(id, params, String(question));
    return params;
  },
  // ---- form for the manual calculators panel ----
  formHtml(id, params = {}) {
    const s = this.byId(id), props = s.schema.properties;
    return Object.entries(props).map(([k, d]) => {
      const lab = k.replace(/_/g, ' '), v = params[k], tip = d.description ? ` <span class="muted">(${escapeHtml(d.description)})</span>` : '';
      if (d.enum) return `<label>${lab}<select data-k="${k}"><option value=""></option>${d.enum.map(o => `<option ${v === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
      if (d.type === 'boolean') return `<label>${lab}<select data-k="${k}" data-t="bool"><option value=""></option><option value="true" ${v === true ? 'selected' : ''}>yes</option><option value="false" ${v === false ? 'selected' : ''}>no</option></select></label>`;
      if (d.type === 'array' && d.items.type === 'object') {
        const f = Object.keys(d.items.properties);
        const txt = (v || []).map(o => f.map(x => o[x] ?? '').join(' ')).join('\n');
        return `<label class="wide">${lab} <span class="muted">(one per line: ${f.join(' ')})</span><textarea rows="4" data-k="${k}" data-t="objs" data-f="${f.join(',')}">${escapeHtml(txt)}</textarea></label>`;
      }
      if (d.type === 'array' && d.items.type === 'array') return `<label class="wide">${lab} <span class="muted">(one row per line)</span><textarea rows="3" data-k="${k}" data-t="matrix">${escapeHtml((v || []).map(r => r.join(' ')).join('\n'))}</textarea></label>`;
      if (d.type === 'array') return `<label${k === 'references' || k === 'requests' || k === 'keys' ? ' class="wide"' : ''}>${lab} <span class="muted">(comma separated)</span><input type="text" data-k="${k}" data-t="list" data-n="${d.items.type !== 'string'}" value="${escapeHtml((v || []).join(', '))}"></label>`;
      return `<label>${lab}${tip}<input type="text" data-k="${k}" data-t="${d.type}" value="${escapeHtml(v ?? '')}"></label>`;
    }).join('');
  },
  formRead(root) {
    const out = {};
    root.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k, t = el.dataset.t, v = el.value.trim();
      if (v === '') return;
      if (t === 'bool') out[k] = v === 'true';
      else if (t === 'number' || t === 'integer') out[k] = isFinite(+v) ? +v : v;
      else if (t === 'list') out[k] = v.split(/[\s,;]+/).filter(Boolean).map(x => el.dataset.n === 'true' && isFinite(+x) ? +x : x);
      else if (t === 'matrix') out[k] = v.split('\n').map(r => r.trim().split(/[\s,]+/).filter(Boolean).map(Number)).filter(r => r.length);
      else if (t === 'objs') {
        const f = el.dataset.f.split(',');
        out[k] = v.split('\n').map(r => r.trim().split(/[\s,]+/)).filter(r => r[0]).map(r => Object.fromEntries(f.map((x, i) => [x, r[i] == null ? undefined : (isFinite(+r[i]) && x !== 'name' ? +r[i] : r[i])]).filter(([, y]) => y !== undefined)));
      } else out[k] = v;
    });
    return out;
  },
};
// ---------- what is asked, and in which unit ----------
// The part of the question that asks (last sentence with "?" or a question word), where units and the target live.
function askedPart(q) {
  const parts = String(q).replace(/\n\s*\(?[A-D][).][^\n]*/g, '').split(/(?<=[.?!])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const qs = parts.filter(s => /\?|\b(what|which|find|compute|calculate|determine|how (many|much|long)|is the)\b/i.test(s));
  return (qs.length ? qs[qs.length - 1] : parts[parts.length - 1] || '');
}
const ASK_RULES = {
  cpu: [[/average\s+waiting/i, 'avg_waiting'], [/average\s+turn\s*-?around/i, 'avg_turnaround'], [/average\s+response/i, 'avg_response'],
    [/completion\s+time\s+of\s+(?:process\s+)?(P\d+\w*)/i, 'completion_of'], [/waiting\s+time\s+of\s+(?:process\s+)?(P\d+\w*)/i, 'waiting_of'], [/turn\s*-?around\s+time\s+of\s+(?:process\s+)?(P\d+\w*)/i, 'turnaround_of'],
    [/response\s+time\s+of\s+(?:process\s+)?(P\d+\w*)/i, 'response_of'], [/\b(P\d+\w*)\s+(completes|finishes)/i, 'completion_of'], [/context\s+switch/i, 'context_switches'], [/utili[sz]ation/i, 'cpu_utilization']],
  page: [[/hit\s+ratio|hit\s+rate/i, 'hit_ratio'], [/miss\s+ratio|miss\s+rate|fault\s+rate/i, 'miss_ratio'], [/fault/i, 'faults'], [/\bhits\b/i, 'hits']],
  cache: [[/tag\s+(directory|memory|store|ram)/i, 'tag_directory_bits'], [/tag/i, 'tag_bits'], [/(index|set|line)\s+(field|bits)|bits\s+(for|in)\s+the\s+(index|set|line)/i, 'index_bits'],
    [/offset|word\s+field/i, 'offset_bits'], [/number\s+of\s+sets|how\s+many\s+sets/i, 'sets'], [/number\s+of\s+(cache\s+)?(lines|blocks)|how\s+many\s+(cache\s+)?(lines|blocks)/i, 'lines']],
  pipe: [[/speed\s*-?up/i, 'speedup'], [/throughput/i, 'throughput'], [/cycle\s+time|clock\s+(period|cycle)/i, 'cycle_time'], [/time|how\s+long/i, 'total_time']],
  ip: [[/broadcast/i, 'broadcast'], [/first\s+(usable\s+|valid\s+)?host/i, 'first_host'], [/last\s+(usable\s+|valid\s+)?host/i, 'last_host'], [/network\s+(address|id)/i, 'network'],
    [/how\s+many\s+subnets|number\s+of\s+subnets/i, 'subnets'], [/how\s+many.*(hosts?|addresses)|number\s+of.*(hosts?|addresses)/i, 'hosts'], [/mask/i, 'mask']],
  banker: [[/sequence/i, 'safe_sequence'], [/grant|request/i, 'can_grant'], [/safe/i, 'safe']],
  disk: [[/order|sequence\s+in\s+which/i, 'order'], [/movement|distance|cylinders|seek/i, 'total_movement']],
  kmap: [[/essential/i, 'essential_prime_implicants'], [/prime\s+implicant/i, 'prime_implicants'], [/literal/i, 'literals'], [/(product\s+)?terms/i, 'terms']],
  hash: [[/probes/i, 'total_probes'], [/collision/i, 'collisions']],
  paging: [[/how\s+many\s+levels|number\s+of\s+levels|levels\s+of\s+pag/i, 'levels'], [/page\s+table\s+size|size\s+of\s+(the\s+)?page\s+table/i, 'page_table_bytes'], [/(size\s+of|bits\s+in)\s+(a\s+|each\s+)?(page\s+table\s+entry|pte)/i, 'pte_bits_min'],
    [/number\s+of\s+pages|how\s+many\s+pages/i, 'pages'], [/number\s+of\s+frames|how\s+many\s+frames/i, 'frames'], [/offset/i, 'offset_bits']],
  window: [[/sequence\s+number|seq\w*\s+bits/i, 'seq_bits'], [/window\s+size|minimum\s+window|how\s+many\s+frames/i, 'min_window'], [/throughput/i, 'throughput_bps'], [/efficiency|utili[sz]ation/i, 'efficiency']],
  crc: [[/transmitted|frame\s+(sent|transmitted)|codeword/i, 'transmitted'], [/remainder|crc|check\s+bits/i, 'remainder']],
  grammar: [[/follow/i, 'follow_of'], [/first/i, 'first_of'], [/number of (states|items)|how many states|lr\s*\(\s*0\s*\)\s*(items|states)/i, 'lr0_states'], [/\bslr/i, 'is_slr'], [/lr\s*\(\s*0\s*\)/i, 'is_lr0'], [/ll\s*\(\s*1\s*\)/i, 'is_ll1']],
  fd: [[/how many candidate keys|number of candidate keys/i, 'key_count'], [/candidate key|primary key/i, 'candidate_keys'], [/closure/i, 'closure'], [/prime attributes?/i, 'prime_count'], [/normal form|bcnf|3nf|2nf/i, 'normal_form']],
  prob: [[/at least/i, 'at_least'], [/at most|no more than/i, 'at_most'], [/variance/i, 'variance'], [/expect|mean/i, 'mean'], [/exactly|probability/i, 'exactly']],
  graph: [[/spanning tree|mst/i, 'mst_weight'], [/shortest|distance|cost of the path/i, 'shortest_distance'], [/components?/i, 'components']],
  // A third element `true` means: only when the wording is in the asked sentence (not anywhere in the question).
  linalg: [[/sum of (all )?(the )?eigen/i, 'sum_eigenvalues'], [/product of (all )?(the )?eigen/i, 'product_eigenvalues'], [/(largest|larger|maximum|greatest|dominant|biggest|bigger|higher)\s+(of the (two |three )?)?(real\s+)?eigen/i, 'largest_eigenvalue'],
    [/(smallest|smaller|minimum|least|lowest|lower)\s+(of the (two |three )?)?(real\s+)?eigen/i, 'smallest_eigenvalue'], [/eigen\s*values?/i, 'eigenvalues'], [/characteristic (equation|polynomial)/i, 'char_poly'],
    [/determinant/i, 'determinant'], [/\brank\b/i, 'rank'], [/inverse/i, 'inverse'], [/\btrace\b/i, 'trace']],
  count: [[/derangement|(none|no one|nobody|no \w+) (of (the |them )?\w*\s*)?(is |are |gets? |goes? |receives? |sits? |ends? up )?(in |into |to |at )?(its|their|his|her) (own|correct|right|original|assigned)|wrong (envelope|position|place|seat)/i, 'derangement'],
    [/divisible by/i, 'inclusion_exclusion'], [/integer solutions|solutions (to|of) (the equation )?\s*[a-z]_?\{?1\}?\s*\+/i, 'stars_and_bars'],
    [/round (a )?(circular )?table|circular|in a circle|around a circle|necklace|garland/i, 'circular'], [/letters of the word|(arrangements|permutations) of (the )?(word|letters)/i, 'multiset']],
  master: [[/complexity|asymptotic|order of growth|growth rate|\bbig[- ]?(o|oh|theta)\b|[Θθ]\s*\(|\bO\s*\(|\btheta\b|tight bound|solves? to|solution (of|to) (the|this) recurrence/i, 'theta', true],
    [/^\s*solve\b[^\n]*=/i, 'theta', true], [/\n\s*\(?[A-D][).]\s*[ΘθOΩ]\s*\(/, 'theta']],   // "Solve T(n) = ..." / options in Θ(...) notation
  recval: [[/how many (times|calls|function calls|recursive calls|invocations)|number of (calls|function calls|recursive calls|invocations|times)/i, 'calls', true], [/(number of |how many )additions/i, 'additions', true],
    [/(value of|find|compute|evaluate|what is|calculate|determine)\s+(the\s+)?(value\s+of\s+)?[A-Za-z]\w*\s*\(\s*\d+\s*\)/i, 'value', true], [/[A-Za-z]\w*\s*\(\s*\d+\s*\)\s*(=\s*)?(is\s*)?(\?|_{2,}|…|\.\.\.)/i, 'value', true]],
  sp: [[/after\s+(the\s+)?\w+\s+(pass(es)?|iterations?|rounds?)\b|\b(first|second|third|fourth|\d+(st|nd|rd|th))\s+(pass|iteration|round)\b/i, 'distances_after_passes'], [/negative[- ](weight\s+)?cycle/i, 'negative_cycle', true],
    [/predecessor|parent of|previous (vertex|node)/i, 'predecessor', true],
    [/order\b[\s\S]{0,60}\b(finali[sz]ed|extracted|selected|removed|visited|added|deleted|processed|dequeued|included|marked)|(finali[sz]ed|extracted|selected|removed|visited|added|deleted|processed|dequeued|included|marked)\b[\s\S]{0,40}\border|sequence in which/i, 'order', true]],
  topo: [[/how many|number of/i, 'count', true], [/lexicograph|alphabetical|smallest/i, 'smallest_order', true], [/largest|reverse alphabetical/i, 'largest_order', true], [/\bnot\b|valid|possible|which of the following/i, 'is_valid', true]],
  huffman: [[/(length|size) of the (encoded|compressed|coded) (message|file|text|string|data)|bits (needed|required) to (encode|transmit|store|send)/i, 'total_bits'], [/average|expected|bits per (symbol|character|letter)/i, 'avg_bits'], [/(?:length|bits)\s+(?:of\s+)?(?:the\s+)?(?:code(?:word)?\s+)?(?:for|of|assigned to)\s+(?:the\s+)?(?:symbol\s+|character\s+|letter\s+)?['"‘“]?([A-Za-z0-9])['"’”]?(?=[\s?.,]|$)/i, 'code_length_of'],
    [/longest|maximum (code(word)? )?length/i, 'max_length'], [/total|how many bits|number of bits|size/i, 'total_bits']],
  frag: [[/how many (ip )?fragments|number of (ip )?fragments|total (number of )?fragments/i, 'fragments'], [/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th))\s+(ip\s+)?fragment/i, 'fields_of'],
    [/offset/i, 'last_offset'], [/total (number of )?bytes|overhead/i, 'total_bytes']],
  tcp: [[/how (long|much time)|time (taken|required|needed|to reach|elapsed)|\bin (ms|msec|milliseconds|seconds)\b/i, 'time_to_reach'], [/how many (rtts?|round[- ]trips?|transmission rounds|rounds)/i, 'rounds_to_reach'],
    [/threshold/i, 'ssthresh_at', true], [/window|cwnd/i, 'cwnd_at']],
};
// When two calculators claim a question by its wording, the more specific one wins.
const PREFER_OVER = { sp: ['graph'], recval: ['master'] };
function askFromWords(id, q) {
  const rules = ASK_RULES[id];
  if (!rules) return null;
  const asked = askedPart(q);
  for (const text of [asked, String(q)]) {
    for (const [re, ask, onlyAsked] of rules) {
      if (onlyAsked && text !== asked) continue;
      const m = text.match(re);
      if (!m) continue;
      const out = { ask };
      if (/_of$/.test(ask) && m[1]) out.target = m[1];
      if (id === 'hash') { const t = text.match(/\b(\d+)\b(?=[^\d]*$)/); if (t) out.target = +t[1]; }
      return out;
    }
  }
  if (id === 'hash') {   // "where does 142 end up" / "position of 142" / "which key is at index 3"
    const t = askedPart(q), at = t.match(/(?:key|element)\s+(?:is\s+)?(?:at|in)\s+(?:index|slot|location|position)\s+(\d+)/i);
    if (at) return { ask: 'key_at', target: +at[1] };
    const pos = t.match(/(\d+)\s+(?:end|be|get|is)\b|(?:position|index|slot|location)\s+of\s+(?:key\s+)?(\d+)|does\s+(?:key\s+)?(\d+)/i);
    if (pos) return { ask: 'position_of', target: +(pos[1] || pos[2] || pos[3]) };
  }
  return null;
}
// Inputs that plain patterns read more reliably than a small model (address widths, IP/prefix).
function addrBits(q, kind) {
  const w = kind ? `(?:${kind})\\s+` : '';
  const m = q.match(new RegExp(`(\\d+)\\s*-?\\s*bits?\\s+(?:byte[- ]?(?:addressable\\s+)?)?${w}address`, 'i')) || q.match(new RegExp(`${w}address(?:es)?\\s+(?:are|is|of|has|have)\\s+(\\d+)\\s*bits?`, 'i'));
  return m ? +m[1] : null;
}
function fillFromText(id, p, q) {
  if (id === 'cache' && !p.address_bits && !p.main_memory_size) { const b = addrBits(q, 'physical') || addrBits(q, ''); if (b) p.address_bits = b; }
  if (id === 'paging') {
    if (!p.virtual_address_bits && !p.virtual_memory_size) { const b = addrBits(q, 'virtual|logical') || addrBits(q, ''); if (b) p.virtual_address_bits = b; }
    if (!p.physical_address_bits && !p.physical_memory_size) { const b = addrBits(q, 'physical'); if (b) p.physical_address_bits = b; }
  }
  if (id === 'cpu' && /round[- ]robin|\bRR\b|quantum|time slice/i.test(q)) {
    p.algorithm = 'RR';
    const m = q.match(/(?:quantum|slice)\D{0,15}?(\d+(?:\.\d+)?)/i) || q.match(/(\d+(?:\.\d+)?)\s*(?:ms|units?)?\s*(?:time\s+)?(?:quantum|slice)/i);
    if (m) p.quantum = +m[1];
  }
  if (id === 'dfa') { const d = dfaFromWords(q); if (d) Object.assign(p, d); }
  if (id === 'window') {
    if (/go[- ]back[- ]n|\bGBN\b/i.test(q)) p.protocol = 'go_back_n'; else if (/selective[- ]repeat|\bSR\b/i.test(q)) p.protocol = 'selective_repeat'; else if (/stop[- ]and[- ]wait/i.test(q)) p.protocol = 'stop_and_wait';
    const w = q.match(/window\s+(?:size\s+)?(?:of\s+|is\s+|=\s*)?(\d+)(?![\d^.])/i) || q.match(/(\d+)\s*-?\s*frames?\s+(?:sender\s+|sending\s+)?window/i);
    if (w) p.window = +w[1];
    const k = q.match(/(\d+)\s*-?\s*bits?\s+(?:for\s+(?:the\s+)?)?sequence/i); if (k) p.sequence_bits = +k[1];
    // A link rate the question never gave was made up by the reader; drop it so the window-only path answers.
    if (!/bps|b\/s|bits?\s*(?:per|\/)\s*s|bandwidth|data\s+rate|link\s+(?:speed|rate)|transmission\s+rate/i.test(q)) delete p.bandwidth;
    else if (!(parseRate(p.bandwidth) > 0)) { const r = q.match(/(\d+(?:\.\d+)?)\s*([KMG]?bps)\b/i); if (r) p.bandwidth = `${r[1]} ${r[2]}`; }
  }
  if (id === 'tlb') {
    if (!/page\s*fault/i.test(q)) { delete p.page_fault_rate; delete p.page_fault_service_time; }
    if (/parallel|simultaneous/i.test(q)) p.tlb_mode = 'parallel'; else if (/first|sequential/i.test(q)) p.tlb_mode = 'sequential';
  }
  if (id === 'ieee') {
    const v = String(p.value || '').trim();
    p.mode = /^0x/i.test(v) || /^[01\s]{16,}$/.test(v) || /^[0-9A-F]{8}$/.test(v) && /[A-F]/.test(v) ? 'from_bits' : 'to_bits';
    if (/double/i.test(q)) p.precision = 'double'; else if (/single|32-?bit/i.test(q)) p.precision = 'single';
    if (/hex/i.test(askedPart(q))) p.ask = 'hex';
  }
  if (id === 'num') {
    const bits = q.match(/(\d+)\s*-?\s*bits?\b/i);
    if (bits) p.bits = +bits[1];
    const rep = /two'?s|2'?s/i.test(q) ? 'twos' : /one'?s|1'?s/i.test(q) ? 'ones' : /sign[- ]?magnitude/i.test(q) ? 'sign_magnitude' : /unsigned/i.test(q) ? 'unsigned' : null;
    if (rep) p.representation = rep;
    const a = askedPart(q);
    if (/smallest|most negative|minimum|lowest/i.test(a)) { p.mode = 'range'; p.which = 'min'; }
    else if (/largest|maximum|highest|most positive/i.test(a)) { p.mode = 'range'; p.which = 'max'; }
    else if (/\brange\b/i.test(a)) p.mode = 'range';
  }
  if (id === 'master') {
    // T(n) = aT(n/b) + f(n), or T(n) = aT(n-b) + f(n), read straight from the text.
    const m = q.replace(/\s+/g, '').match(/T\(n\)=(\d*(?:\.\d+)?)\*?T\(n([\/-])(\d+(?:\.\d+)?)\)\+([^,.;?\n]+)/i);
    if (m) {
      const f = m[4].replace(/\$|\\/g, '').toLowerCase();
      let k = 0, lp = 0;
      const pw = f.match(/n\^\{?(\d+(?:\.\d+)?)\}?/); if (pw) k = +pw[1]; else if (/sqrt\(?n|n\^\(?1\/2/.test(f)) k = 0.5; else if (/n(?!\^)/.test(f.replace(/log\^?\{?\d*\}?\(?n\)?/g, ''))) k = 1;
      const lg = f.match(/log\^\{?(\d+)\}?/); if (lg) lp = +lg[1]; else if (/log/.test(f)) lp = 1;
      if (/loglog/.test(f)) lp = 0;
      Object.assign(p, { a: +(m[1] || 1), b: +m[3], k, log_power: lp, form: m[2] === '-' ? 'decrease' : 'divide' });
    }
  }
  if (id === 'grammar') { const m = askedPart(q).match(/(?:FIRST|FOLLOW)\s*\(\s*([A-Za-z]'*)\s*\)/i) || askedPart(q).match(/(?:first|follow)\s+(?:set\s+)?of\s+([A-Z]'*)/i); if (m) p.symbol = m[1]; }
  if (id === 'fd') { const m = askedPart(q).match(/\(?\s*([A-Z]{1,6})\s*\)?\s*\+|closure of\s+\{?\s*([A-Z ,]{1,12}?)\s*\}?(?:\s|\?|\.|$)/); if (m) p.closure_of = (m[1] || m[2] || '').replace(/[\s,]/g, ''); }
  if (id === 'ip') {
    const m = q.match(/(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})\b/);
    if (m) { p.ip = m[1]; p.prefix = +m[2]; delete p.mask; }
    else { const mk = q.match(/mask\D{0,20}(255(?:\.\d{1,3}){3})/i); if (mk) { p.mask = mk[1]; delete p.prefix; } }
  }
  if (id === 'recval') {
    const t = q.replace(/[−–]/g, '-');
    // the recursive equation is the "X(n) = ..." whose right side calls X again
    const rec = [...t.matchAll(/\b([A-Za-z]\w*)\s*\(\s*n\s*\)\s*=\s*([^\n;]+)/g)].find(m => new RegExp(`\\b${m[1]}\\s*\\(`).test(m[2]));
    if (rec) {
      const f = rec[1], rhs = rec[2].split(/,\s*(?=[A-Za-z]\w*\s*\(\s*-?\d)|\s+(?:for|if|when|where|with|and)\s+|[,;](?:\s|$)|\.(?:\s|$)|\?/)[0].trim();
      p.recurrence = `${f}(n) = ${rhs}`;
      const bases = [...t.matchAll(new RegExp(`\\b${f}\\s*\\(\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\)\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`, 'g'))].map(m => ({ n: +m[1], value: +m[2] }));
      if (bases.length) p.base_cases = bases;
      const up = t.match(new RegExp(`\\b${f}\\s*\\(\\s*n\\s*\\)\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*,?\\s*(?:if|for|when)\\s+n\\s*(<=|≤|<|=)\\s*(\\d+)`));
      if (up) { if (up[2] === '=') p.base_cases = (p.base_cases || []).concat({ n: +up[3], value: +up[1] }); else { p.base_upto = up[2] === '<' ? +up[3] - 1 : +up[3]; p.base_upto_value = +up[1]; } }
      const ns = [...askedPart(q).matchAll(new RegExp(`\\b${f}\\s*\\(\\s*(\\d+)\\s*\\)`, 'g'))];
      if (ns.length) p.n = +ns[ns.length - 1][1];
    }
    if (/ceil|⌈/i.test(q) && !/floor|⌊/i.test(q)) p.division = 'ceil';
  }
  if (id === 'sp') {
    if (/\bundirected\b/i.test(q)) p.directed = false; else if (/\b(directed|digraph)\b/i.test(q)) p.directed = true;
    if (/bellman|\bford\b/i.test(q)) p.algorithm = 'bellman_ford'; else if (/dijkstra/i.test(q)) p.algorithm = 'dijkstra';
    const ps = askedPart(q).match(/after\s+(?:the\s+)?(\w+)\s+(?:pass|iteration|round)|\b(\w+)\s+(?:pass(?:es)?|iterations?|rounds?)\b/i);
    if (ps) { const k = ordinalNum(ps[1] || ps[2]); if (k > 0) p.passes = k; }
  }
  if (id === 'frag') {
    const m = askedPart(q).match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th))\s+(?:ip\s+)?fragment/i);
    if (m) p.target = m[1];
    const mtu = q.match(/\bMTU\b\D{0,25}?(\d+)\s*(?:bytes|B)\b/i) || q.match(/(\d+)\s*(?:bytes|B)\s*(?:of\s+)?MTU\b/i); if (mtu) p.mtu = +mtu[1];
    const hd = q.match(/\bIP header\D{0,30}?(\d+)\s*bytes/i); if (hd) p.header_size = +hd[1];
    const user = q.match(/(\d+)\s*bytes\s+of\s+(?:user|application|payload)?\s*data/i);
    const ds = q.match(/(?:packet|datagram)\s+(?:of\s+)?(?:size|length)?\s*(?:of\s+)?(\d+)\s*(?:bytes|B)\b/i) || q.match(/(\d+)\s*-?\s*bytes?\s+(?:IP\s+)?(?:packet|datagram)/i);
    if (user) {
      p.data_size = +user[1]; delete p.datagram_size;
      const tp = q.match(/\b(UDP|TCP) header\D{0,25}?(\d+)\s*bytes/i); p.transport_header_size = tp ? +tp[2] : /\budp\b/i.test(q) ? 8 : 0;
    } else if (ds) { p.datagram_size = +ds[1]; delete p.data_size; delete p.transport_header_size; }
  }
  if (id === 'tcp') {
    if (/\breno\b/i.test(q)) p.variant = 'reno'; else if (/\btahoe\b/i.test(q)) p.variant = 'tahoe';
    const a = askedPart(q);
    const r = a.match(/\b(\w+)\s+(?:transmission|round|rtt)\b|\b(?:round|rtt|transmission)\s+(?:number\s+)?(\d+)/i);
    if (r) { const k = ordinalNum(r[1] || r[2]); if (k > 0) p.target_round = k; }
    const evs = [], kind = s => /out/i.test(s) ? 'timeout' : 'triple_dup';
    const EV = '(time\\s*-?\\s*out|triple[- ]duplicate|(?:3|three)\\s+dup\\w*)';
    for (const m of q.matchAll(new RegExp(`${EV}[^.]{0,40}?\\b(?:during|at|in|after|on)\\s+(?:the\\s+)?(\\w+)\\s+(?:transmission|round|rtt)\\b`, 'gi'))) { const k = ordinalNum(m[2]); if (k > 0) evs.push({ round: k, event: kind(m[1]) }); }
    for (const m of q.matchAll(new RegExp(`\\b(?:during|at|in|after|on)\\s+(?:the\\s+)?(\\w+)\\s+(?:transmission|round|rtt)\\b[^.]{0,40}?${EV}`, 'gi'))) { const k = ordinalNum(m[1]); if (k > 0 && !evs.some(e => e.round === k)) evs.push({ round: k, event: kind(m[2]) }); }
    if (evs.length) p.events = evs;
    const data = q.replace(a, ' '), W = '(\\d+(?:\\.\\d+)?\\s*(?:MSS|[KM]B|bytes)?)';
    const iw = data.match(new RegExp(`(?:window|cwnd)[^.]{0,15}?(?:at the start of|initially|is initially|starts at|begins at)[^.\\d]{0,40}?${W}`, 'i')) || data.match(new RegExp(`(?:initial|starting)\\s+(?:congestion\\s+)?(?:window|cwnd)[^.\\d]{0,30}?${W}`, 'i'));
    if (iw) p.initial_cwnd = iw[1].trim();
    const th = data.match(new RegExp(`(?:threshold|ssthresh)[^.\\d]{0,50}?${W}`, 'i')); if (th) p.ssthresh = th[1].trim();
    const lw = q.match(/(\d+(?:\.\d+)?\s*(?:[KM]B|bytes|MSS))\s+when\s+(?:a\s+)?time\s*-?\s*out/i); if (lw) p.loss_window = lw[1];
    const goal = a.match(/(?:back to|reach(?:es)?|grow to|attain)\s+(?:a\s+|the\s+)?(?:congestion\s+)?(?:window\s+)?(?:size\s+)?(?:of\s+)?(\d+(?:\.\d+)?\s*(?:[KM]B|bytes|MSS)?)/i); if (goal) p.target_window = goal[1].trim();
    const mss = q.match(/(?:maximum segment size|\bMSS\b)[^\d]{0,25}(\d+(?:\.\d+)?\s*[KM]?B)\b/i); if (mss) p.mss = mss[1];
    const rtt = q.match(/(?:round[- ]trip time|\bRTT\b)[^\d]{0,25}(\d+(?:\.\d+)?\s*(?:ms|msec|milliseconds?|s|sec|seconds?))\b/i); if (rtt) p.rtt = rtt[1];
    if (/\bKB\b|kilobytes/i.test(a) && p.mss) p.answer_in = 'KB';
  }
  if (id === 'count') {
    const w = q.match(/\bword\s+["'“‘]?([A-Z][A-Za-z]{2,})/); if (w && p.ask === 'multiset') p.word = w[1];
    if (p.ask === 'inclusion_exclusion') {
      const a = askedPart(q);
      p.ie_ask = /neither|none of|not divisible|nor\b/i.test(a) ? 'none' : /exactly (one|1)\b|only one/i.test(a) ? 'exactly_one' : /exactly (two|2)\b/i.test(a) ? 'exactly_two' : /at least (two|2)\b/i.test(a) ? 'at_least_two' : /\ball (three|of them)\b|each of/i.test(a) ? 'all' : 'union';
      const dv = q.match(/divisible by\s+(\d+(?:\s*(?:,|,?\s*or|,?\s*and(?:\/or)?)\s*\d+)*)/i);
      if (dv) { const ds = (dv[1].match(/\d+/g) || []).map(Number); if (ds.length) p.divisors = ds; }
      const rg = q.match(/(?:between|from)\s+(\d+)\s+(?:and|to)\s+(\d+)/i), lt = q.match(/(?:less than|below|smaller than)\s+(\d+)/i), le = q.match(/(?:up to|not exceeding|at most)\s+(\d+)/i);
      if (rg) { p.range_min = +rg[1]; p.range_max = +rg[2]; } else if (lt) { p.range_min = 1; p.range_max = +lt[1] - 1; } else if (le) { p.range_min = 1; p.range_max = +le[1]; }
    }
    if (p.ask === 'stars_and_bars' && !listNums(p.lower_bounds).length) { if (/positive integ/i.test(q)) p.lower_bounds = [1]; else if (/non-?negative/i.test(q)) p.lower_bounds = [0]; }
  }
}
// What each answer is measured in, so "in MB", "in ns" or "in percent" can be honoured.
const OUT_UNIT = { 'paging.page_table_bytes': 'bytes', 'cache.tag_directory_bits': 'bits', 'cache.tag_directory_bytes': 'bytes', 'pipe.total_time': 'time', 'pipe.cycle_time': 'time',
  'amat.': 'time', 'tlb.': 'time', 'window.efficiency': 'ratio', 'page.hit_ratio': 'ratio', 'page.miss_ratio': 'ratio', 'cpu.cpu_utilization': 'ratio', 'window.transmission_time': 'seconds' };
const TIME_S = { ps: 1e-12, ns: 1e-9, us: 1e-6, 'µs': 1e-6, ms: 1e-3, s: 1 };
function adjustUnits(id, params, r, q) {
  const kind = OUT_UNIT[`${id}.${params.ask || ''}`];
  if (!kind || typeof r.value !== 'number') return r;
  const a = askedPart(q);
  let v = r.value, note = '';
  if (kind === 'bytes' || kind === 'bits') {
    const m = a.match(/\bin\s+(bits|bytes|B|KB|K\s*bytes|MB|GB|kilobytes|megabytes)\b/i);
    if (m) {
      const u = m[1].toLowerCase().replace(/\s/g, ''), bytes = kind === 'bits' ? v / 8 : v;
      v = /^bits$/.test(u) ? bytes * 8 : /^(kb|kbytes|kilobytes)$/.test(u) ? bytes / 1024 : /^(mb|megabytes)$/.test(u) ? bytes / 1024 ** 2 : /^gb$/.test(u) ? bytes / 1024 ** 3 : bytes;
      note = ` = ${fmtN(v)} ${m[1]}`;
    }
  } else if (kind === 'time' || kind === 'seconds') {
    const m = a.match(/\bin\s+(ps|ns|µs|us|ms|s|seconds|milliseconds|microseconds|nanoseconds|picoseconds)\b/i);
    const from = kind === 'seconds' ? 's' : (params.time_unit || (String(q).match(/\d\s*(ps|ns|µs|us|ms)\b/i) || [])[1] || '').toLowerCase();
    if (m && TIME_S[from]) {
      const to = { seconds: 's', milliseconds: 'ms', microseconds: 'us', nanoseconds: 'ns', picoseconds: 'ps' }[m[1].toLowerCase()] || m[1].toLowerCase();
      if (TIME_S[to] && to !== from) { v = v * TIME_S[from] / TIME_S[to]; note = ` = ${fmtN(v)} ${to}`; }
    }
  } else if (kind === 'ratio' && /percent|%/i.test(a)) { v = v * 100; note = ` = ${fmtN(v)}%`; }
  if (!note) return r;
  return { ...r, value: v, text: fmtN(v), steps: r.steps + `\n\n**In the unit asked:** ${fmtN(r.value)}${note}` };
}

// Pretty list of the inputs a solver used (shown so you can catch a misread number).
function solverInputsMd(params) {
  const show = v => Array.isArray(v) ? (v.length && typeof v[0] === 'object' && !Array.isArray(v[0]) ? v.map(o => Object.values(o).join('/')).join('; ') : v.map(x => Array.isArray(x) ? `(${x.join(' ')})` : x).join(', ')) : String(v);
  return Object.entries(params || {}).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)).map(([k, v]) => `**${k.replace(/_/g, ' ')}**: ${escapeHtml(show(v))}`).join(' · ');
}

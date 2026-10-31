// Shared core: settings, storage (local server or browser IndexedDB), Ollama client, OCR,
// markdown+math rendering, background jobs, lesson viewer, doubt chat, GATE syllabus.

// ---------- settings ----------
const Cfg = {
  get(k, d) { try { const v = localStorage.getItem('gt_' + k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gt_' + k, v); } catch {} },
};
const DEFAULT_MODEL = 'qwen3.5:4b';
const ID_RE = /^[a-z0-9]{12,40}$/;
function isPrivateHost(h) { return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h); }
function ollamaUrl() { return Cfg.get('ollama', isPrivateHost(location.hostname) ? `http://${location.hostname}:11434` : 'http://localhost:11434').replace(/\/+$/, ''); }
let MODEL_OVERRIDE = '';   // set only while comparing models (this window only)
function teachModel() { return MODEL_OVERRIDE || Cfg.get('model', DEFAULT_MODEL); }
function visionModel() { return Cfg.get('vmodel', DEFAULT_MODEL); }
function checkModel() { return MODEL_OVERRIDE || Cfg.get('cmodel', teachModel()); }   // double-checks, votes, second opinions, solver inputs
const VOICE = '\nVoice: talk to the student directly as "you", like a warm, sharp human teacher at a desk. Plain words, short sentences. No filler ("Great question", "Certainly", "As an AI", "I hope this helps").';
// How every piece of generated text should be written: professional formatting, and math that typesets.
const WRITING_RULES = `
Formatting (professional, like a well-edited textbook): clear "##"/"###" headings, short paragraphs, numbered steps for procedures, bullet points for lists, **bold** only for key terms, Markdown tables for comparisons. No emojis, no filler, no "Note:" spam.
Math: write EVERY formula, variable, expression and number-with-operator in LaTeX: inline $...$, display $$...$$ on its own line for important or long formulas. Use proper subscripts and superscripts with braces: $a_{i}$, $x_{ij}$, $T_{\text{avg}}$, $2^{n}$, $2^{k+1}$, $n^{2}$, $\log_{2} n$. Fractions with \\frac{}{}, roots with \\sqrt{}, products with \\times or \\cdot (never the letter x), comparisons with \\le \\ge \\ne, sets with \\{ \\}, floors/ceilings with \\lfloor \\rfloor / \\lceil \\rceil, tall brackets with \\left( ... \\right). Complexity as $O(n \\log n)$, $\\Theta(n^{2})$. Words inside math with \\text{}. Never write bare ^ or _ outside $...$. Units and plain prose stay outside math.`;
function langNote() {
  return (Cfg.get('lang', 'en') === 'hinglish'
    ? '\nWrite in simple Hinglish (Hindi in Roman script mixed with English technical terms), like a friendly Indian GATE teacher.'
    : '\nWrite in simple, clear English.') + VOICE + WRITING_RULES;
}

// ---------- file type sniffing (magic bytes, not file names) ----------
async function sniffExt(blob) {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const s = String.fromCharCode(...b);
  if (s.startsWith('%PDF-')) return 'pdf';
  if (b[0] === 0x89 && s.slice(1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (s.startsWith('GIF8')) return 'gif';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp';
  if (s.startsWith('BM')) return 'bmp';
  return null;
}
function displayName(fname) { return fname.replace(/^f\d{3}__/, ''); }
// Makes any uploaded picture storable: unknown formats (e.g. HEIC) and huge camera photos become a JPEG <= 2000px.
async function normalizeUpload(file) {
  const ext = await sniffExt(file);
  if (ext === 'pdf' || (ext && file.size < 2.5e6)) return file;
  try {
    const c = await blobToCanvas(file, 2000);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return new File([blob], (file.name || 'photo').replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    if (ext) return file;
    throw new Error((file.name || 'File') + ' is not a PDF or an image this browser can read.');
  }
}

// ---------- storage ----------
// "server" = local PowerShell server (sites in .\sites\<id>\); "browser" = static hosting (e.g. Vercel), sites in IndexedDB.
let idbPromise = null;
function idb() {
  return idbPromise || (idbPromise = new Promise((res, rej) => {
    const r = indexedDB.open('gate-tutor', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function kv(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(req ? req.result : undefined);
    tx.onerror = () => rej(tx.error);
  });
}
async function jsonOrThrow(r) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Request failed: ' + r.status));
  return j;
}
function newId() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

const Store = {
  mode: null,
  async init() {
    if (this.mode) return this.mode;
    try {
      const r = await fetch('/api/ping');
      this.mode = r.ok && (await r.text()).trim() === 'gate-tutor' ? 'server' : 'browser';
    } catch { this.mode = 'browser'; }
    return this.mode;
  },
  async listSites() {
    if (this.mode === 'server') return jsonOrThrow(await fetch('/api/sites'));
    const all = await kv('readonly', st => st.getAll(IDBKeyRange.bound('meta:', 'meta:￿')));
    return all.sort((a, b) => b.created.localeCompare(a.created));
  },
  async createSite(file, name) {
    if (!(await sniffExt(file))) throw new Error((file.name || 'File') + ' is not a PDF or image.');
    const fileName = name || file.name || 'file';
    if (this.mode === 'server') {
      return jsonOrThrow(await fetch('/api/sites', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(fileName) }, body: file }));
    }
    const id = newId();
    const meta = { id, name: fileName, size: file.size, created: new Date().toISOString() };
    await kv('readwrite', st => { st.put(meta, 'meta:' + id); st.put([], 'files:' + id); });
    await this.addFile(id, file, fileName);
    return meta;
  },
  async addFile(id, file, name) {
    const ext = await sniffExt(file);
    if (!ext) throw new Error((file.name || 'File') + ' is not a PDF or image.');
    const fileName = name || file.name || 'file';
    if (this.mode === 'server') {
      return jsonOrThrow(await fetch(`/api/sites/${id}/files`, { method: 'POST', headers: { 'X-Filename': encodeURIComponent(fileName) }, body: file }));
    }
    const files = (await kv('readonly', st => st.get('files:' + id))) || [];
    const base = fileName.replace(/\.[^.]*$/, '').replace(/[^\w.-]/g, '_').slice(0, 60) || 'file';
    const fname = `f${String(files.length + 1).padStart(3, '0')}__${base}.${ext}`;
    files.push(fname);
    await kv('readwrite', st => { st.put(file, `file:${id}:${fname}`); st.put(files, 'files:' + id); });
    return { file: fname };
  },
  async listFiles(id) {
    if (this.mode === 'server') return jsonOrThrow(await fetch(`/api/sites/${id}/files`));
    return (await kv('readonly', st => st.get('files:' + id))) || [];
  },
  async getFile(id, fname) {
    if (this.mode === 'server') {
      const r = await fetch(`/api/sites/${id}/files/${encodeURIComponent(fname)}`);
      if (!r.ok) throw new Error('Missing file ' + fname);
      return r.blob();
    }
    return kv('readonly', st => st.get(`file:${id}:${fname}`));
  },
  async getMeta(id) {
    if (this.mode === 'server') return jsonOrThrow(await fetch(`/api/sites/${id}`));
    const m = await kv('readonly', st => st.get('meta:' + id));
    if (!m) throw new Error('This site was deleted (or was created in a different browser).');
    return m;
  },
  async getData(id) {
    if (this.mode === 'server') return jsonOrThrow(await fetch(`/api/sites/${id}/data`));
    return (await kv('readonly', st => st.get('data:' + id))) || {};
  },
  async putData(id, data) {
    if (this.mode === 'server') {
      await jsonOrThrow(await fetch(`/api/sites/${id}/data`, { method: 'PUT', body: JSON.stringify(data) }));
      return;
    }
    await kv('readwrite', st => st.put(JSON.parse(JSON.stringify(data)), 'data:' + id));
  },
  // Deleting a book deletes everything taken from it too (see purgeSiteData), so nothing from it comes back.
  async deleteSite(id) {
    if (this.mode === 'server') await jsonOrThrow(await fetch(`/api/sites/${id}`, { method: 'DELETE' }));
    else await kv('readwrite', st => {
      st.delete('meta:' + id); st.delete('files:' + id); st.delete('data:' + id);
      st.delete(IDBKeyRange.bound(`file:${id}:`, `file:${id}:￿`));
    });
    await updateHub(h => purgeSiteData(h, id));
    announce({ type: 'pyqs' });
  },
  async getHub() {
    let h;
    if (this.mode === 'server') h = await jsonOrThrow(await fetch('/api/hub'));
    else h = (await kv('readonly', st => st.get('hub'))) || {};
    return Object.assign({ topics: {}, attempts: [], mistakes: [], cards: [], syllabus: {}, solved: [], reports: [], settings: {}, plan: '' }, h);
  },
  async putHub(h) {
    if (this.mode === 'server') { await jsonOrThrow(await fetch('/api/hub', { method: 'PUT', body: JSON.stringify(h) })); return; }
    await kv('readwrite', st => st.put(JSON.parse(JSON.stringify(h)), 'hub'));
  },
};
// Removes book `sid`'s reading and PYQ-scan records from the hub, so nothing keeps working on (or listing) a
// deleted book, and re-uploading the PDF later is read fresh instead of being taken for a duplicate.
// What you got out of it stays: PYQs, formulas, mistakes, test history and topics studied.
function purgeSiteData(h, sid) {
  let n = 0;
  const drop = (key, keep) => { if (!Array.isArray(h[key])) return; const before = h[key].length; h[key] = h[key].filter(keep); n += before - h[key].length; };
  drop('queue', q => q.siteId !== sid);
  drop('pyqScan', x => x.siteId !== sid);
  if (h.pyqSources && h.pyqSources[sid]) { delete h.pyqSources[sid]; n++; }
  for (const k of Object.keys(h.pyqDone || {})) if (k.startsWith(sid + ':')) delete h.pyqDone[k];
  return n;
}
// Read-modify-write so the hub and study-site tabs don't overwrite each other's progress.
let hubChain = Promise.resolve();
function updateHub(fn) {
  // The lock is shared by every app window (hub, books, background readers), so one window's read-change-write
  // can't overwrite another's: without it a change made in one window could be undone by a save from another.
  const once = async () => { const h = await Store.getHub(); await fn(h); await Store.putHub(h); return h; };
  const p = hubChain.then(() => navigator.locks ? navigator.locks.request('gate-desk-hub', once) : once());
  hubChain = p.catch(() => {});
  return p;
}

// ---------- site export / import (single .json file) ----------
function blobToB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
}
async function exportSite(id) {
  const meta = await Store.getMeta(id), data = await Store.getData(id), names = await Store.listFiles(id);
  const files = [];
  for (const n of names) files.push({ name: displayName(n), b64: await blobToB64(await Store.getFile(id, n)) });
  downloadText(JSON.stringify({ format: 'gate-tutor-site', version: 1, meta, data, files }), meta.name.replace(/\.[^.]*$/, '') + '.gatesite.json');
}
async function importSite(file) {
  const j = JSON.parse(await file.text());
  if (j.format !== 'gate-tutor-site' || !j.files || !j.files.length) throw new Error('Not a GATE Tutor site export.');
  const toBlob = b64 => new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]);
  const meta = await Store.createSite(toBlob(j.files[0].b64), j.meta.name || j.files[0].name);
  for (const f of j.files.slice(1)) await Store.addFile(meta.id, toBlob(f.b64), f.name);
  await Store.putData(meta.id, j.data || {});
  return meta;
}
function downloadText(text, filename, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Ollama ----------
let INSTALLED_MODELS = [];
async function listModels() {
  const r = await fetch(ollamaUrl() + '/api/tags');
  if (!r.ok) throw new Error('Ollama not reachable');
  INSTALLED_MODELS = (await r.json()).models.map(m => m.name);
  await Promise.all(INSTALLED_MODELS.map(canThink));   // fills THINKS for bigModel()
  return INSTALLED_MODELS;
}
// Second opinions: when the usual checks disagree, one more solve (Settings → "Second-opinion model", "none" = off).
// "auto" = the checking model itself, thinking first, when it can think: qwen3.5:4b thinking was right on 45 of 47
// self-test questions (37 without; mistral-nemo 12B: 27), stays on the GPU and needs no model swap.
// Otherwise the largest installed model bigger than the checking model.
const modelSize = name => { const m = String(name).match(/(\d+(?:\.\d+)?)\s*b\b/i); return m ? +m[1] : 0; };
function bigModel() {
  const pick = Cfg.get('bigmodel', 'auto');
  if (pick === 'none') return '';
  if (pick !== 'auto') return pick;
  if (THINKS[checkModel()]) return checkModel();
  const best = INSTALLED_MODELS.filter(m => !/embed/i.test(m) && m !== checkModel()).sort((a, b) => modelSize(b) - modelSize(a))[0];
  return best && modelSize(best) > modelSize(checkModel()) ? best : '';
}
// "In Operating System, checked answers were right 9 of 11 times in your self-tests" (null if too little data).
async function reliabilityNote(subject) {
  if (!subject) return '';
  let h; try { h = await Store.getHub(); } catch { return ''; }
  const rows = (h.selfTests || []).flatMap(r => r.rows || []).filter(r => r.s === subject);
  const keyed = (h.pyqs || []).filter(p => p.subject === subject && p.answer && p.answer.level === 'official' && p.answer.tutorAgree != null);
  const n = rows.length + keyed.length, right = rows.filter(r => r.right).length + keyed.filter(p => p.answer.tutorAgree).length;
  return n >= 3 ? `In ${subject}, the tutor's checked answers were right ${right} of ${n} times so far (self-tests and official keys).` : '';
}
// One fixed context size for every call: Ollama reloads the model (10s+) whenever num_ctx changes.
const NUM_CTX = 16384;   // room for ~20k characters of notes plus a long, deep lesson
// Thinking (models with Ollama's "thinking" capability, e.g. qwen3.5) is only for hard checks. The reasoning
// arrives in message.thinking and is never used as the answer: only message.content is. A 4B model can think for
// 6000+ tokens on an easy question, so thinking has a budget; past it the model is stopped and answers from
// its reasoning so far (thinking off). Models without the capability simply answer without it.
const THINK_BUDGET = 3000;   // thinking tokens, ~50 s at 60 tokens/s
const MODEL_CAPS = {}, THINKS = {};   // model → promise / known answer: can it think?
function canThink(model) {
  if (!(model in MODEL_CAPS)) MODEL_CAPS[model] = fetch(ollamaUrl() + '/api/show', { method: 'POST', body: JSON.stringify({ model }) })
    .then(r => r.ok ? r.json() : {}).then(j => (THINKS[model] = (j.capabilities || []).includes('thinking'))).catch(() => false);
  return MODEL_CAPS[model];
}
// Streams a chat completion. images: base64 strings (no data: prefix) on a message.
// maxTokens caps runaway generations (small models sometimes loop); thinking gets THINK_BUDGET on top.
async function ollamaChat(messages, opts = {}) {
  const { format, onToken, temperature = 0.3, signal, maxTokens = 4000 } = opts;
  const model = opts.model || teachModel(), think = !!opts.think && await canThink(model);
  const stop = new AbortController(), onAbort = () => stop.abort();
  if (signal) { if (signal.aborted) stop.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const job = think && signal ? jobOf(signal) : null, base = job ? job.label : '';
  let buf = '', out = '', thought = '', nThink = 0, cut = false;
  try {
    const res = await fetch(ollamaUrl() + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages, stream: true, think, format,
        options: { temperature, num_ctx: NUM_CTX, num_predict: maxTokens + (think ? THINK_BUDGET : 0) },
      }),
      signal: stop.signal,
    });
    if (!res.ok) throw new Error('Ollama error ' + res.status + ': ' + (await res.text()));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    read: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        const th = (j.message && j.message.thinking) || '';
        if (th) {
          thought += th;
          if (job && ++nThink % 20 === 1) jobLabel(`${base} · Thinking… (${nThink} tokens)`, signal);
          if (nThink >= THINK_BUDGET) { cut = true; break read; }
        }
        const t = (j.message && j.message.content) || '';
        if (t) { out += t; if (onToken) onToken(t, out); }
      }
    }
  } finally {
    if (cut) stop.abort();
    if (signal) signal.removeEventListener('abort', onAbort);
    if (job && nThink) jobLabel(base, signal);
  }
  if (think && !out.trim() && thought) {   // out of thinking budget: answer from the reasoning so far
    if (job) jobLabel(`${base} · Answering from its reasoning`, signal);
    return ollamaChat(messages.concat([{ role: 'user', content: `Your reasoning so far (unfinished, and it may contain slips):\n\n${thought.slice(-10000)}\n\nStop reasoning now. Check it, then give your final response in the required format.` }]), { ...opts, think: false });
  }
  return out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
// LaTeX inside JSON strings: a model writing "\frac" means \frac, but JSON reads \f as a form feed (and \t, \b,
// \r, \n likewise: \times, \beta, \right, \neq…). Double the backslash before any LaTeX command name first.
const TEX_CMDS = 'frac|dfrac|tfrac|times|theta|Theta|tau|text|textbf|tilde|beta|binom|bar|right|rho|rceil|rfloor|rangle|nu|neq|ne|nabla|neg|not|notin|nmid|log|ln|lim|sum|sqrt|le|leq|ge|geq|leftarrow|left|lfloor|lceil|langle|cdot|cdots|ldots|dots|alpha|infty|in|pi|sigma|Sigma|lambda|mu|delta|Delta|epsilon|varepsilon|forall|exists|land|lor|oplus|subseteq|subset|supseteq|cup|cap|emptyset|to|rightarrow|Rightarrow|Leftrightarrow|approx|equiv|mod|pmod|bmod|max|min|exp|mathbb|mathrm|mathcal|overline|underline|hat|vec|quad|qquad|prod|int|partial|phi|omega|Omega|gamma|Gamma|wedge|vee|implies|iff|over|choose|circ|bullet|star|mid|parallel|perp|angle|deg|det|gcd|sin|cos|tan|operatorname|boxed|underbrace|overbrace|begin|end|hline|substack|limits';
const TEX_ESC_RE = new RegExp(`(?<!\\\\)\\\\(?=(?:${TEX_CMDS})(?![a-zA-Z]))`, 'g');
function parseJSON(text) {
  const s = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim().replace(TEX_ESC_RE, '\\\\');
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('Model did not return valid JSON');
}

// ---------- images, OCR (Tesseract.js in the browser) ----------
async function blobToCanvas(blob, maxW = 1400) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxW / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
function canvasB64(c) { return c.toDataURL('image/jpeg', 0.88).split(',')[1]; }
let ocrWorker = null;
async function ocrCanvas(canvas) {
  if (!ocrWorker) {
    // Bundled locally (tools\make-offline.ps1) so OCR works without internet.
    const base = location.origin + '/vendor/tesseract/';
    ocrWorker = await Tesseract.createWorker('eng', 1, { workerPath: base + 'worker.min.js', corePath: base + 'core', langPath: base + 'lang' });
  }
  const { data } = await ocrWorker.recognize(canvas, {}, { text: true, blocks: true });
  // Words the scanner wasn't sure about, so the page view can highlight them for checking.
  let words = data.words;
  if (!words && data.blocks) words = data.blocks.flatMap(b => (b.paragraphs || []).flatMap(p => (p.lines || []).flatMap(l => l.words || [])));
  const unsure = [...new Set((words || []).filter(w => w.confidence < 60 && /[A-Za-z0-9]{3,}/.test(w.text || '')).map(w => w.text.replace(/^[^\w]+|[^\w]+$/g, '')))].filter(w => w.length >= 3).slice(0, 40);
  return { text: (data.text || '').trim(), confidence: Math.round(data.confidence || 0), unsure };
}
// Wraps every whole-word occurrence of the given words inside el's text in <mark class="unsure">. Returns the count.
function markWords(el, words) {
  if (!words || !words.length) return 0;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(${words.map(esc).join('|')})\\b`, 'gi');
  const nodes = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('.katex, code, pre, mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  while (walk.nextNode()) nodes.push(walk.currentNode);
  let count = 0;
  for (const n of nodes) {
    if (!re.test(n.nodeValue)) continue;
    re.lastIndex = 0;
    const span = document.createElement('span');
    span.innerHTML = escapeHtml(n.nodeValue).replace(re, m => { count++; return `<mark class="unsure" title="The scanner wasn't sure about this word. Compare it with the page image.">${m}</mark>`; });
    n.replaceWith(...span.childNodes);
  }
  return count;
}
const READ_SYS = `You read images of GATE Computer Science material (notes, textbook pages, question papers, handwritten work, screenshots).
Use the IMAGE as ground truth; the OCR text is only a hint and may contain errors. Produce a faithful, complete Markdown transcription:
- keep headings, lists, definitions, question numbers and all options exactly
- tables as Markdown tables; code in fenced blocks
- ALL math in LaTeX ($...$ inline, $$...$$ display), reproducing exactly what is written: subscripts $a_{i}$, $x_{ij}$, superscripts $2^{n}$, $n^{k+1}$, fractions \\frac{}{}, roots, sums with limits, brackets, primes ($x'$), bars/complements ($\\overline{A}$), Greek letters. Look closely at small raised/lowered characters: they are exponents/indices, not normal text
- for every diagram (trees, graphs, automata, circuits, K-maps, pipelines, Gantt/timing charts, ER diagrams) write a "> **Figure:**" block describing nodes, edges, labels and values precisely enough to solve questions from it
Do not summarize, solve, skip or invent anything. Output only the Markdown.`;
// Vision-model transcription of one image, using OCR/text-layer output as a hint.
async function visionTranscribe(canvas, hint, hintKind, { signal, onToken, label = 'image' } = {}) {
  const md = await ollamaChat([
    { role: 'system', content: READ_SYS },
    { role: 'user', content: `${label}. ${hintKind}:\n"""\n${String(hint || '').slice(0, 6000) || '(none)'}\n"""\nTranscribe it into Markdown.`, images: [canvasB64(canvas)] },
  ], { signal, onToken, model: visionModel(), maxTokens: 2500 });
  return fixMathTranscript(cleanTranscript(md));
}
// Drops chatty preambles like "Based on the image provided, here is the transcription..." and code fences.
function cleanTranscript(md) {
  return String(md || '').replace(/^\s*(?:based on|here is|here's|below is|sure|certainly)[^\n]*\n+(?:\s*(?:\*\*\*|---)\s*\n+)?/i, '').replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, '$1');
}
// ---------- very detailed reading (notes, handwriting, PYQ photos): slow on purpose, for the best output ----------
// 1. clean the image (grayscale, contrast) for OCR  2. OCR the cleaned image  3. the vision model reads
// overlapping parts at high resolution (small handwriting, sub/superscripts)  4. a final pass checks the
// whole draft against the page image line by line and fixes it.
function enhanceCanvas(src) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  // grayscale + histogram stretch (2nd..98th percentile), so faint pencil and shadows become clear ink on white
  const hist = new Uint32Array(256), n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; }
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const span = Math.max(30, hi - lo);
  for (let i = 0; i < d.length; i += 4) { let y = (d[i] - lo) * 255 / span; y = y < 0 ? 0 : y > 255 ? 255 : y; y = 255 * Math.pow(y / 255, 1.25); d[i] = d[i + 1] = d[i + 2] = y; }
  g.putImageData(img, 0, 0);
  return c;
}
function cropCanvas(src, y0, y1, maxW = 1500) {
  const top = Math.round(src.height * y0), h = Math.round(src.height * (y1 - y0));
  const s = Math.min(1, maxW / src.width), c = document.createElement('canvas');
  c.width = Math.round(src.width * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, top, src.width, h, 0, 0, c.width, c.height);
  return c;
}
const VERIFY_SYS = `You are a meticulous proof-reader of transcriptions of GATE Computer Science material (often handwritten notes). You get the PAGE IMAGE (ground truth), OCR text (noisy hint) and a DRAFT transcription${''} made from overlapping close-ups of the page.
Produce the FINAL transcription of the whole page, in reading order, in Markdown:
- go line by line against the image: fix misread letters, digits and symbols, restore anything the draft missed, remove text duplicated where close-ups overlapped, drop anything that is not on the page
- keep the page's own structure: headings, numbered points, bullets, arrows/flows (as "→"), boxed or underlined key points (as **bold**), tables (Markdown tables), code (fenced blocks)
- ALL math in LaTeX exactly as written: subscripts $a_{i}$, superscripts $2^{n}$, fractions \\frac{}{}, roots, sums with limits, brackets, primes, overlines, Greek letters; small raised or lowered characters are exponents or indices, and they belong to the symbol or word just BEFORE them (a small 2 right after "log" is $\\log_{2}$, so "log₂(S)" is $\\log_{2}(S)$, never $\\log(S)_{2}$)
- diagrams: a "> **Figure:**" block describing every node, edge, label and value precisely
- if something is genuinely unreadable, write [unclear] instead of guessing
Do not summarize, explain or solve. Output only the final Markdown.`;
async function detailedTranscribe(canvas, { hint = '', signal, onToken, label = 'page', onStage = () => {} } = {}) {
  onStage('Cleaning up the image for text recognition');
  const enh = enhanceCanvas(canvas);
  onStage('Recognising the text (OCR)');
  let ocr = null;
  try { ocr = await ocrCanvas(enh); } catch {}
  const ocrText = hint.length >= 300 ? hint : (ocr ? ocr.text : hint);
  // Overlapping close-ups: 1 for landscape, 2 for a normal page, 3 for a long photo.
  const ratio = canvas.height / canvas.width, n = ratio > 1.9 ? 3 : ratio > 0.9 ? 2 : 1, parts = [];
  const where = n === 1 ? ['whole page'] : n === 2 ? ['top half', 'bottom half'] : ['top third', 'middle third', 'bottom third'];
  for (let i = 0; i < n; i++) {
    onStage(`Reading the ${where[i]} closely${n > 1 ? ` (${i + 1} of ${n})` : ''}`);
    const y0 = Math.max(0, i / n - 0.07), y1 = Math.min(1, (i + 1) / n + 0.07);
    const md = await ollamaChat([
      { role: 'system', content: READ_SYS },
      { role: 'user', content: `${label}: a close-up of the ${where[i]} of the page${n > 1 ? ' (it overlaps the neighbouring part a little)' : ''}. OCR of the whole page, as a hint:\n"""\n${String(ocrText || '').slice(0, 5000) || '(none)'}\n"""\nTranscribe ONLY what is visible in this close-up, completely and exactly. If a line is cut at the edge, transcribe the visible part.`, images: [canvasB64(cropCanvas(canvas, y0, y1))] },
    ], { signal, model: visionModel(), maxTokens: 3000, onToken: (_, o) => onToken && onToken(_, o) });
    parts.push(cleanTranscript(md));
  }
  // A whole-page reading too: it keeps layout and positions that close-ups can split.
  let whole = '';
  if (n > 1) {
    onStage('Reading the whole page once more for layout');
    whole = await visionTranscribe(scaleCanvas(canvas, 1500), ocrText, 'OCR text', { signal, label });
  }
  onStage('Checking everything against the page, line by line');
  const final = await ollamaChat([
    { role: 'system', content: VERIFY_SYS },
    { role: 'user', content: `${label}.\n\nOCR text (noisy):\n"""\n${String(ocrText || '').slice(0, 5000) || '(none)'}\n"""\n\nDRAFT A${n > 1 ? ' (close-ups in order; neighbouring parts overlap; best for small details)' : ''}:\n"""\n${parts.map((p, i) => n > 1 ? `[${where[i]}]\n${p}` : p).join('\n\n')}\n"""${whole ? `\n\nDRAFT B (whole page at once; best for layout and where each small character sits):\n"""\n${whole}\n"""\nWhere the drafts differ, decide by looking at the image.` : ''}\n\nWrite the final transcription of the whole page.`, images: [canvasB64(scaleCanvas(canvas, 1500))] },
  ], { signal, model: visionModel(), maxTokens: 5000, onToken });
  const out = fixMathTranscript(cleanTranscript(final));
  // A model that returns almost nothing (or gives up) falls back to the joined close-ups.
  return out.trim().length >= parts.join('').trim().length * 0.5 ? out : parts.join('\n\n');
}
// Small, safe fixes to transcribed math: misplaced log bases, "..." in math, doubled backslashes.
function fixMathTranscript(md) {
  return String(md || '')
    .replace(/\\(log|lg)\s*\(([^()]*)\)_(\{[^{}]*\}|\w)/g, (m, f, arg, b) => `\\${f}_{${b.replace(/[{}]/g, '')}}(${arg})`)
    .replace(/\$([^$\n]*?)\.\.\.([^$\n]*?)\$/g, (m, a, b) => `$${a}\\dots${b}$`)
    .replace(/\\\\(?=[a-zA-Z]{2,})/g, '\\');
}
function scaleCanvas(c, maxW) {
  if (c.width <= maxW) return c;
  const s = document.createElement('canvas');
  s.width = maxW; s.height = Math.round(c.height * maxW / c.width);
  s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
  return s;
}

// OCR + vision transcription of one image (canvas). hintText = PDF text layer if any.
// detailed: the slow multi-pass reading above (best for handwritten notes and photos of questions).
async function readImage(canvas, { hintText = '', useOcr = true, useVision = true, signal, onToken, label = 'image', detailed = false, onStage } = {}) {
  if (detailed && useVision) {
    const md = await detailedTranscribe(canvas, { hint: hintText, signal, onToken, label, onStage: onStage || (t => jobLabel(`${label}: ${t}`, signal)) });
    return { md, via: 'detailed' };
  }
  let ocr = null;
  if (useOcr && hintText.length < 300) ocr = await ocrCanvas(canvas);
  const hint = hintText.length >= 300 ? hintText : (ocr ? ocr.text : hintText);
  if (!useVision) return { md: hint, via: ocr ? 'ocr' : 'text', ocr: ocr && ocr.text };
  const md = await visionTranscribe(canvas, hint, ocr ? `OCR text (confidence ${ocr.confidence}%)` : 'Extracted text layer', { signal, onToken, label });
  return { md, via: ocr ? 'ocr+vision' : 'text+vision', ocr: ocr && ocr.text };
}

// ---------- rendering ----------
// Unicode math symbols small models (and OCR) produce, as LaTeX.
const UNI_TEX = { '×': '\\times ', '÷': '\\div ', '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '→': '\\to ', '←': '\\leftarrow ', '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ',
  '∞': '\\infty ', '−': '-', '·': '\\cdot ', '∑': '\\sum ', '∏': '\\prod ', '√': '\\sqrt ', '∫': '\\int ', '∈': '\\in ', '∉': '\\notin ', '⊆': '\\subseteq ', '⊂': '\\subset ', '∪': '\\cup ', '∩': '\\cap ',
  '∅': '\\emptyset ', '∀': '\\forall ', '∃': '\\exists ', '¬': '\\neg ', '∧': '\\land ', '∨': '\\lor ', '⊕': '\\oplus ', 'Θ': '\\Theta ', 'θ': '\\theta ', 'Ω': '\\Omega ', 'ω': '\\omega ', 'α': '\\alpha ', 'β': '\\beta ',
  'γ': '\\gamma ', 'δ': '\\delta ', 'Δ': '\\Delta ', 'ε': '\\varepsilon ', 'λ': '\\lambda ', 'μ': '\\mu ', 'π': '\\pi ', 'σ': '\\sigma ', 'Σ': '\\Sigma ', 'φ': '\\phi ', 'ρ': '\\rho ', 'τ': '\\tau ', '…': '\\ldots ', '′': "'" };
// Makes model-written LaTeX render: unicode symbols, doubled backslashes from JSON, unbalanced braces/brackets.
function repairTex(tex) {
  let t = String(tex).replace(/\\\\(?=[a-zA-Z]{2,})/g, '\\').replace(/[×÷≤≥≠≈→←⇒⇔∞−·∑∏√∫∈∉⊆⊂∪∩∅∀∃¬∧∨⊕ΘθΩωαβγδΔελμπσΣφρτ…′]/g, c => UNI_TEX[c] || c);
  const count = (re) => (t.match(re) || []).length;
  let open = count(/(?<!\\)\{/g) - count(/(?<!\\)\}/g);
  if (open > 0) t += '}'.repeat(open); else if (open < 0) t = '{'.repeat(-open) + t;
  const L = count(/\\left\b/g), R = count(/\\right\b/g);
  if (L > R) t += ' \\right.'.repeat(L - R); else if (R > L) t = '\\left.'.repeat(R - L) + t;
  return t;
}
function texToHtml(tex, display) {
  if (!display) tex = String(tex).replace(/\\frac(?=\s*\{)/g, '\\dfrac');   // inline fractions at full, readable size
  const opts = { displayMode: display, throwOnError: true, strict: 'ignore', trust: false };
  try { return katex.renderToString(tex, opts); } catch {}
  try { return katex.renderToString(repairTex(tex), opts); } catch {}
  // Still not valid LaTeX: show it as tidy monospace text rather than a red error.
  return `<code class="tex-fallback">${escapeHtml(tex)}</code>`;
}
// Math written without $…$ (common from small models): x^2, 2^{n+1}, a_i, T_{n}, log_2 n, O(n^2), \frac{a}{b}.
// Wrapped in $…$ so it typesets, and so Markdown doesn't turn a_i … b_j into italics.
// wrap(tex) returns what replaces the match; renderMd passes one that locks the formula in straight away,
// so later rules never nest inside an earlier one.
function autoMath(s, wrap = t => `$${t}$`) {
  const fn = { 'Θ': '\\Theta', 'Ω': '\\Omega', 'θ': '\\theta', Theta: '\\Theta', Omega: '\\Omega' };
  const bigO = inner => inner.replace(/\blog\b/g, '\\log').replace(/\bsqrt\s*\(([^()]*)\)/g, '\\sqrt{$1}').replace(/(\w|\))\^(\{[^{}]*\}|-?\w+|\([^()]*\))/g, (m, b, e) => `${b}^{${e.replace(/^[{(]|[})]$/g, '')}}`).replace(/([A-Za-z])_(\{[^{}]*\}|\w{1,3})/g, (m, b, i) => `${b}_{${i.replace(/[{}]/g, '')}}`);
  return s
    .replace(/(?<![\w$\\@])([OΘΩθo]|Theta|Omega)\(([^()\n]*?(?:\([^()\n]*\)[^()\n]*?)*)\)(?=[^\w]|$)/g, (m, f, inner) => /[\^_]|log|sqrt|\\/.test(inner) ? wrap(`${fn[f] || f}(${bigO(inner)})`) : m)
    .replace(/(?<![\w$\\@])log_(\{[^{}\n]{1,10}\}|[0-9a-z]{1,3})(\s*\(?[A-Za-z0-9]{1,3}\)?)?/g, (m, b, x) => wrap(`\\log_{${b.replace(/[{}]/g, '')}}${x || ''}`))
    .replace(/(?<![\w$\\@])([A-Za-z])_(\{[^{}\n]{1,16}\}|[A-Za-z0-9]{1,3})\^(\{[^{}\n]{1,16}\}|-?[A-Za-z0-9]{1,4})(?![\w])/g, (m, b, i, e) => wrap(`${b}_{${i.replace(/[{}]/g, '')}}^{${e.replace(/[{}]/g, '')}}`))
    .replace(/(?<![\w$\\@])((?:[A-Za-z0-9]{1,6}|\([^()\s]{1,24}\)))\^(\{[^{}\n]{1,24}\}|-?[A-Za-z0-9]{1,6}|\([^()\n]{1,20}\))(?![\w^])/g, (m, b, e) => wrap(`${b}^{${e.replace(/^[{(]|[})]$/g, '')}}`))
    .replace(/(?<![\w$\\@])([A-Za-z])_(\{[^{}\n]{1,16}\}|[A-Za-z0-9]{1,3})(?![\w])/g, (m, b, i) => wrap(`${b}_{${i.replace(/[{}]/g, '')}}`))
    .replace(/(?<![\w$@])(\\(?:frac|dfrac|sqrt|sum|prod|int|lfloor|lceil|binom)\b(?:\{[^{}\n]*\}|\[[^\]\n]*\]|[^\s{}$@])*)/g, m => wrap(m))
    .replace(/(?<![\w$\\@])\\(times|cdot|leq?|geq?|neq?|to|rightarrow|Rightarrow|infty|in|notin|subseteq|cup|cap|land|lor|neg|oplus|theta|Theta|Omega|alpha|beta|lambda|mu|sigma|pi|epsilon|varepsilon|delta|Delta|log|ln)\b/g, m => wrap(m));
}
// Markdown with LaTeX math ($..$, $$..$$, \(..\), \[..\]) -> sanitized HTML.
function renderMd(md) {
  const math = [];
  const keep = (tex, display) => { math.push(texToHtml(tex, display)); return '@@MATH' + (math.length - 1) + '@@'; };
  // Code (fenced blocks, diagrams and `inline code`) is kept away from the math steps so "$", "^" and "_" inside stay as is.
  const code = [];
  const stash = m => { code.push(m); return `@@CODE${code.length - 1}@@`; };
  let s = String(md || '')
    .replace(/```[\s\S]*?(```|$)/g, m => `\n${stash(m)}\n`)
    .replace(/`[^`\n]+`/g, stash)
    .replace(/\\\$/g, '@@DOLLAR@@')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => keep(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => keep(t, false))
    .replace(/\$([^$\n]+?)\$/g, (_, t) => keep(t, false));
  s = autoMath(s, t => keep(t, false))
    .replace(/@@CODE(\d+)@@/g, (_, i) => code[+i]).replace(/@@DOLLAR@@/g, '\\$');
  let html = marked.parse(s).replace(/@@MATH(\d+)@@/g, (_, i) => math[+i]);
  // ```mermaid blocks become diagrams (drawn by diagrams.js); the source stays as a fallback.
  html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_, c) => {
    const src = c.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return `<div class="diagram" data-src="${encodeURIComponent(src)}"><pre class="diagram-src"><code>${c}</code></pre></div>`;
  });
  // ```viz blocks (exact drawings: trees, graphs, automata, Gantt, arrays…) are drawn by viz.js.
  html = html.replace(/<pre><code class="language-viz">([\s\S]*?)<\/code><\/pre>/g, (_, c) => {
    const src = c.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return `<div class="diagram viz" data-viz="${encodeURIComponent(src)}"><p class="small muted">Drawing&hellip;</p></div>`;
  });
  return DOMPurify.sanitize(html, { ADD_TAGS: ['details', 'summary'] });
}
// Markdown to plain text. Only real markup goes: comparisons like "a < b", "F(k+1) > F(k)" and "x <= y" stay.
function plainText(md) {
  return String(md || '').replace(/\$+([^$]+)\$+/g, '$1')
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, '')   // HTML tags
    .replace(/^[ \t]*>+[ \t]?/gm, '')                         // blockquote markers
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, '')   // table rule lines
    .replace(/\|/g, ' ').replace(/[#*_`]/g, '');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }
function $(sel, el = document) { return el.querySelector(sel); }
function uid() { return Math.random().toString(36).slice(2, 10); }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); }

// ---------- read aloud ----------
function speak(md) {
  if (!('speechSynthesis' in window)) { alert('Read-aloud is not supported in this browser.'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(plainText(md).slice(0, 6000));
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find(v => /en-IN/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

// ---------- line icons (drawn, 24px grid, currentColor) ----------
const ICONS = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
  speaker: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  arrowR: '<path d="M5 12h13M13 7l5 5-5 5"/>',
  arrowL: '<path d="M19 12H6M11 7l-5 5 5 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19h14"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
  pencil: '<path d="M5 19l1-4 10-10 3 3-10 10z"/><path d="M14 7l3 3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cards: '<rect x="4" y="7" width="13" height="12" rx="1.5"/><path d="M8 4h11.5A.5.5 0 0 1 20 4.5V16"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  refresh: '<path d="M19 7v4h-4"/><path d="M18.5 11A7 7 0 1 0 17 16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.6"/>',
  note: '<path d="M6 3.5h9l4 4V20.5H6z"/><path d="M14.5 3.5V8H19M9 12h7M9 15.5h7"/>',
  sigma: '<path d="M17.5 5H6.5l6 7-6 7h11"/>',
  folder: '<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 9h8M8 12h8M8 15h5"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.6"/><path d="M12 16.8h.01" stroke-width="2.6"/>',
  spark: '<path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chat: '<path d="M4 5.5h16v10H10l-4.5 3.5V15.5H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
};
function icon(name) { return `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`; }
// Replaces <i data-i="name"></i> placeholders in static HTML with the icon.
// An icon with a title (the "?" hints) keeps its hover text and can be reached by keyboard.
function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-i]').forEach(el => {
    const t = el.getAttribute('title'), c = el.className;
    el.outerHTML = t || c ? `<span class="${escapeHtml(c)}"${t ? ` title="${escapeHtml(t)}" aria-label="${escapeHtml(t)}" role="img" tabindex="0"` : ''}>${icon(el.dataset.i)}</span>` : icon(el.dataset.i);
  });
}

// ---------- tutor (Ollama) status ----------
async function checkOllama(statusEl) {
  try {
    const models = await listModels();
    statusEl.textContent = 'Tutor ready';
    statusEl.className = 'status ok';
    statusEl.title = 'Running on your laptop with ' + teachModel();
    return models;
  } catch {
    const hosted = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
    statusEl.textContent = 'Tutor offline';
    statusEl.className = 'status bad';
    const msg = hosted
      ? `This page runs AI on your own laptop. Set the environment variable OLLAMA_ORIGINS=${location.origin} (and OLLAMA_HOST=0.0.0.0 if using a phone on Wi-Fi), quit and restart Ollama, then reload. Allow "local network access" if the browser asks.`
      : 'The tutor needs Ollama. Open the Ollama app (or run "ollama serve"), then reload this page.';
    statusEl.title = msg;
    const note = document.getElementById('ollamaNote');
    if (note) { note.textContent = msg; note.classList.remove('hidden'); }
    return [];
  }
}

// ---------- tasks: several can run at once; each shows in the task tray with its own Stop ----------
// A task's progress calls pass its AbortSignal, which points back to the task (signal.__job).
const Jobs = new Set();
const Job = {
  get busy() { return Jobs.size > 0; },
  get ctl() { const all = [...Jobs]; return all.length ? all[all.length - 1].ctl : null; },
};
function jobOf(signal) { return (signal && signal.__job) || [...Jobs].pop() || null; }
function ensureBusyUI() {
  if ($('#busy')) return;
  const d = document.createElement('div');
  d.id = 'busy'; d.className = 'busy hidden';
  document.querySelector('header').after(d);
}
function paintJobs() {
  const tray = $('#busy');
  if (!tray) return;
  tray.classList.toggle('hidden', !Jobs.size);
  const ids = new Set([...Jobs].map(j => j.id));
  tray.querySelectorAll('.job').forEach(r => { if (!ids.has(r.dataset.id)) r.remove(); });
  for (const j of Jobs) {
    let row = tray.querySelector(`.job[data-id="${j.id}"]`);
    if (!row) {
      row = document.createElement('div');
      row.className = 'job'; row.dataset.id = j.id;
      row.innerHTML = `<div class="row"><span class="busy-title job-label"></span><span class="small muted job-count"></span><span style="flex:1"></span><button class="job-stop">${icon('stop')} Stop</button></div>
        <div class="progress"><div class="job-bar"></div></div>
        <details><summary>Peek at the draft</summary><div class="log job-live"></div></details>`;
      $('.job-stop', row).onclick = () => j.ctl.abort();
      tray.appendChild(row);
    }
    paintJob(j, row);
  }
}
function paintJob(j, row = document.querySelector(`#busy .job[data-id="${j.id}"]`)) {
  if (!row) return;
  $('.job-label', row).textContent = j.label;
  $('.job-count', row).textContent = j.total ? `${j.done} / ${j.total}` : '';
  $('.job-bar', row).style.width = (j.total ? 100 * j.done / j.total : 0) + '%';
  const lv = $('.job-live', row);
  if (lv.textContent !== j.live) { lv.textContent = j.live; lv.scrollTop = lv.scrollHeight; }
}
function live(text, signal) { const j = jobOf(signal); if (j) { j.live = String(text).slice(-600); paintJob(j); } }
function jobLabel(t, signal) { const j = jobOf(signal); if (j) { j.label = t; paintJob(j); } }
function progress(done, total, signal) { const j = jobOf(signal); if (j) { j.done = done; j.total = total; paintJob(j); } }
async function runJob(label, fn, after) {
  ensureBusyUI();
  if ([...Jobs].some(j => j.start === label)) { toast('Already working on that. See the task tray at the top.'); return; }
  const job = { id: uid(), start: label, label, done: 0, total: 0, live: '', ctl: new AbortController() };
  job.ctl.signal.__job = job;
  Jobs.add(job); paintJobs();
  const t0 = Date.now();
  let ok = false;
  try { await fn(job.ctl.signal); ok = true; }
  catch (e) { if (e.name !== 'AbortError') { console.error(e); alert('Error: ' + e.message); } }
  finally {
    Jobs.delete(job); paintJobs();
    if (ok && Date.now() - t0 > 45000 && (document.hidden || !document.hasFocus())) Notify.show(`Done: ${label.replace(/\.\.\.$|…$/, '')}`, '');
    if (after) await after();
  }
}

// ---------- prompts ----------
const LESSON_FORMAT = `Follow this exact order and format (Markdown). Depth matters more than length limits: be as thorough as the topic needs.
# <Topic title>
**GATE subject:** Subject name - topic name   (the subject must be one of: ${'{SUBJECTS}'})

## The big picture
- where this topic sits in its subject and what comes before/after it
- the problem it solves: why it exists at all (what breaks without it)
- one everyday analogy that captures the core idea
- how GATE tests it: typical question types (MCQ/MSQ/NAT), usual marks, how often it appears

## Before we start: prerequisites
(2-5 bullets; each starts with the prerequisite's real name in bold, e.g. "- **Process states**: ...", then the exact piece of it needed here, refreshed in 1-2 lines)

Then the explanation as numbered steps. Each step heading is "## Step N: " followed by YOUR OWN short title for what that step teaches (for example "## Step 1: Why we need a time quantum"). Never copy these instructions as headings. Plan the steps in this order:
1. the core idea, intuitively, in plain words with a tiny example
2. the precise definition and rules
3. how it works, mechanically, step by step
4. a fully worked example with every step shown
5 onwards: variants and cases, edge cases, why it works (proof or reasoning), comparison with related ideas, and a harder GATE-style worked example
(usually 6-10 steps; one idea per bullet; define every term before using it; never skip arithmetic)

## Key formulas & facts
- ...

## Common GATE traps
- the misconception, and why it is wrong

## Quick check
**Q:** <one GATE-style question>
<details><summary>Answer</summary>
<worked answer>
</details>

Use LaTeX for math ($...$).
${'{DIAGRAMS}'}`;
// How to draw: small, valid Mermaid diagrams where a picture explains better than words.
const DIAGRAMS = `Visuals are expected, not optional: the student learns best from pictures. Whenever the explanation has ANY flow, steps, states, structure, hierarchy, tree, graph, layers, timeline or before/after (almost every GATE CS topic does), include a diagram as a fenced block with the language "mermaid". Pick the right kind: flowchart for algorithms/procedures/decisions, stateDiagram-v2 for automata/process states/protocol states, flowchart with nodes and edges for trees, graphs, memory hierarchies and layered models, sequenceDiagram for message exchanges (TCP handshake, protocols), gantt for scheduling timelines. Use Markdown tables for comparisons. Keep each diagram valid and simple:
- flowchart: \`\`\`mermaid
flowchart TD
  A["Process arrives"] --> B{"CPU free?"}
  B -->|yes| C["Run for one time quantum"]
  B -->|no| D["Wait in ready queue"]
\`\`\`
- also allowed: stateDiagram-v2 (automata: use [*] for start), sequenceDiagram (protocols), and gantt (CPU scheduling: dateFormat X, axisFormat %s, each task "P1 :0, 3")
- always put node text in double quotes, no LaTeX or $ inside diagrams, at most about 12 nodes
EXACT DRAWINGS: for trees, graphs, automata, Gantt charts, arrays, stacks, queues, memory layouts and pipelines, DO NOT use mermaid. Write a fenced block with the language "viz" containing one JSON object; the app draws it exactly. Formats (copy the shape, use real data from the example):
- binary tree (level order, null for a missing child): \`\`\`viz
{"type": "tree", "level": [50, 30, 70, 20, 40, null, 80], "highlight": [40]}
\`\`\`
- graph: {"type": "graph", "nodes": ["A", "B", "C"], "edges": [["A", "B", 4], ["B", "C", 1]], "directed": false, "highlight": [["A", "B"]]}
- DFA / NFA: {"type": "dfa", "states": ["q0", "q1"], "start": "q0", "finals": ["q1"], "transitions": [["q0", "a", "q1"], ["q1", "b", "q0"]]} (use "nfa" and "ε" for epsilon moves)
- Gantt chart (CPU scheduling): {"type": "gantt", "bars": [["P1", 0, 3], ["P2", 3, 7], ["idle", 7, 8]]}
- array with pointers: {"type": "array", "cells": [3, 8, 12, 17], "highlight": [2], "pointers": {"0": "low", "3": "high"}}
- stack (bottom to top): {"type": "stack", "items": ["a", "b"]}; queue (front to rear): {"type": "queue", "items": [1, 2]}
- memory partitions: {"type": "memory", "blocks": [["OS", 100], ["P1", 200], ["free", 150, "free"]], "unit": "K"}
- pipeline: {"type": "pipeline", "stages": ["IF", "ID", "EX", "MEM", "WB"], "rows": [["I1", 1], ["I2", 2, 1]]} (third number = stall cycles before EX)
- step by step (an algorithm running): {"type": "frames", "frames": [<one of the above>, …], "captions": ["what changed in step 1", …]}
- ALGORITHM ANIMATIONS (best for "how it runs"): give only the input and the app computes every step itself, exactly: {"type": "algo", "algorithm": "dijkstra", "edges": [["A", "B", 4], ["A", "C", 2], ["B", "C", 1]], "source": "A"} (also "bfs" / "dfs" with "start"; edges without weights are fine); sorting {"type": "algo", "algorithm": "quick", "array": [5, 2, 9, 1]} ("bubble", "insertion", "selection", "merge", "quick", "heap"); page replacement {"type": "algo", "algorithm": "lru", "frames": 3, "references": [7, 0, 1, 2, 0, 3]} (or "fifo"); round robin {"type": "algo", "algorithm": "rr", "quantum": 2, "processes": [["P1", 0, 5], ["P2", 1, 3]]} (name, arrival, burst). Prefer these to hand-written frames for these algorithms.
- address split into fields: {"type": "bits", "segments": [["Tag", 19], ["Set index", 7], ["Offset", 6]]}; K-map: {"type": "kmap", "vars": 4, "ones": [0, 1, 2, 5], "dc": [], "groups": ["000-"], "terms": ["A'B'C'"]}
The JSON must be valid (double quotes, no comments) and every number must match the worked example exactly.
- 1-3 drawings per lesson (at least one), placed right where they explain the step`;
function lessonFormat() { return LESSON_FORMAT.replace('{SUBJECTS}', SYLLABUS.map(s => s.subject).join(', ')).replace('{DIAGRAMS}', DIAGRAMS); }
// ---------- lesson templates: numerical, procedure and conceptual topics are taught differently ----------
const NUMERIC_TOPIC = /\b(page faults?|page replacement|cache|hit (?:ratio|rate)|miss (?:ratio|rate|penalty)|amat|effective (?:memory )?access|tlb|pipelin|speed ?up|cpi|mips|throughput|cpu scheduling|scheduling|waiting time|turnaround|round robin|sjf|srtf|disk|seek time|rotational|bandwidth|delay|propagation|transmission|efficiency|sliding window|go.back.n|selective repeat|stop.and.wait|subnet|cidr|ip address|crc|hamming|checksum|probabilit|expectation|expected value|variance|distribution|bayes|permutation|combination|counting|pigeonhole|derangement|eigen|determinant|rank of|matri(?:x|ces)|integra(?:l|tion)|limits?|derivative|differentiation|recurrence|master theorem|time complexity|asymptotic|hashing|probing|b\+? ?tree|floating point|ieee|number system|two'?s complement|banker|paging|page table|segmentation|fragmentation|token bucket|leaky bucket|nyquist|shannon|amdahl|memory chips?|interleav|aptitude|percentage|ratio)/i;
const PROCEDURE_TOPIC = /\b(dijkstra|bellman|floyd|prim|kruskal|minimum spanning|shortest path|bfs|dfs|breadth.first|depth.first|topological|sorting|sort\b|binary search|traversal|huffman|knapsack|lcs|longest common|matrix chain|dynamic programming|greedy|parsing|parser|ll\(1\)|lr\(0\)|slr|lalr|clr|first and follow|follow set|dfa|nfa|minimi[sz]|subset construction|regular expression|pumping lemma|cyk|normali[sz]ation|normal form|attribute closure|candidate key|3nf|bcnf|decomposition|serializab|precedence graph|two.phase locking|avl|heap|rotation|k-?map|karnaugh|quine|booth|routing|distance vector|link state|deadlock detection|syntax directed|three.address|code generation)/i;
function topicKind(text) {
  const t = String(text || '');
  if (NUMERIC_TOPIC.test(t)) return 'numerical';
  if (PROCEDURE_TOPIC.test(t)) return 'procedure';
  if (typeof Solvers !== 'undefined' && Solvers.candidates(t).length) return 'numerical';
  return 'theory';
}
const LESSON_KIND = {
  numerical: `THIS IS A NUMERICAL TOPIC: GATE mostly asks you to compute a value. So: derive every formula from the idea before using it (never just state it); include a step titled with the solving procedure that lists the exact steps to solve any question on it; give at least THREE fully worked examples of rising difficulty (a warm-up, a GATE 1-mark and a GATE 2-mark numerical); write EVERY intermediate calculation as an explicit equation with its result, for example "$0.9 \\times 10 + 0.1 \\times 110 = 20$ ns", with units at every step (these are re-computed by a program, so they must be exactly right); point out unit conversions and rounding. The Quick check must be a numerical (NAT) question.`,
  procedure: `THIS IS A PROCEDURE TOPIC: GATE asks you to run an algorithm or construction by hand. So: state the procedure as numbered rules; trace it on a small concrete input with a Markdown table that shows the full state after EVERY step (nothing skipped); then a second, trickier trace that hits an edge case (ties, cycles, an empty set, ε, a conflict); derive its time and space complexity; and say which convention GATE uses where textbooks differ. The Quick check must ask for the result of a short trace.`,
  theory: `THIS IS A CONCEPTUAL TOPIC: GATE asks "which of these statements are true" (often MSQ). So: give precise definitions in bold; every property with the reason it holds (a short proof sketch or argument); a counterexample for every "not" or "not necessarily"; a comparison table against the closest related ideas; and a step titled "Statement check" with 5-8 tricky GATE-style statements, each marked True or False with a one-line reason. The Quick check must be an MSQ-style statement question.`,
};
// "Explain it differently": the same topic, taught another way.
const LESSON_STYLE = {
  analogy: { label: 'With an analogy', text: 'TEACHING STYLE FOR THIS VERSION: build the whole explanation around ONE vivid everyday analogy, introduced first and mapped piece by piece onto the real concept (a small table "in the analogy → in the real system"), then say exactly where the analogy breaks down. Keep every technical fact exact.' },
  visual: { label: 'Visual walk-through', text: 'TEACHING STYLE FOR THIS VERSION: teach it visually. Use 3-5 Mermaid diagrams and step-by-step tables that show the state changing, one picture per step, with only short text around each picture explaining what changed and why.' },
  example: { label: 'Example first', text: 'TEACHING STYLE FOR THIS VERSION: start with a concrete worked example straight away (before any definitions), let the rules emerge from it ("notice that..."), then state the general rule and finish with a second example that tests the rule.' },
  simpler: { label: 'Simpler', text: 'TEACHING STYLE FOR THIS VERSION: the student found the earlier version too hard. Assume no background: shorter sentences, one idea per step, every term defined in plain words the first time, smaller numbers in the examples, and a one-line recap after each step. Do not drop any exam-relevant fact.' },
  deeper: { label: 'Deeper', text: 'TEACHING STYLE FOR THIS VERSION: the student knows the basics. Go deeper: why each rule holds (proofs or derivations), edge cases, how it connects to related topics, tricky GATE 2-mark patterns with full solutions, and the common wrong options and why they tempt.' },
};
// A small menu under an "Explain it differently" button. onPick(styleKey) ('' = just rewrite it).
function styleMenu(btn, onPick) {
  const old = document.querySelector('.style-menu');
  if (old) { old.remove(); if (old._for === btn) return; }
  const m = document.createElement('div');
  m.className = 'style-menu card'; m._for = btn;
  m.innerHTML = `<div class="small muted" style="margin-bottom:6px">Teach it again, but:</div>` + Object.entries(LESSON_STYLE).map(([k, s]) => `<button class="chip" data-st="${k}">${s.label}</button>`).join('') + `<button class="chip" data-st="">Just rewrite it</button>`;
  btn.insertAdjacentElement('afterend', m);
  m.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { m.remove(); onPick(b.dataset.st); });
  setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target) && e.target !== btn) { m.remove(); document.removeEventListener('click', off); } }), 0);
}
function lessonExtras(kind, style) { return `${kind && LESSON_KIND[kind] ? '\n\n' + LESSON_KIND[kind] : ''}${style && LESSON_STYLE[style] ? '\n\n' + LESSON_STYLE[style].text : ''}`; }
function lessonFromMaterialSys(kind = '', style = '') {
  return `You are an expert GATE CS teacher (IIT-level). The student's own notes are given. Use them as the backbone: follow their order, notation and examples, and use any figure descriptions. Then go deeper using everything you know: fill gaps the notes skip, add missing steps, intuition, extra worked examples, edge cases, related GATE patterns and connected ideas. Put each addition that is not in the notes in a blockquote that starts with "**Tutor's addition:**" so the student can tell the two apart. Never contradict the notes silently: if the notes look wrong, say so in a Tutor's addition.\n${lessonFormat()}${lessonExtras(kind, style)}${langNote()}`;
}
function lessonFromTopicSys(kind = '', style = '') {
  return `You are an expert GATE CS teacher (IIT-level). The student asks about a topic or a question. Teach it as deeply as you can, from basics to GATE level, accurately and simply, using everything you know. If they asked a specific question, the big picture should restate it in simple words, and the steps must solve it fully while teaching the underlying concept.\n${lessonFormat()}${lessonExtras(kind, style)}${langNote()}`;
}
const SOLVE_FORMAT = `Explain like a patient teacher to a student who finds this hard. Use this Markdown format:
## What the question is asking
(in very simple words)
## Concept you need
(short explanation of the idea, with a tiny example)
## Step-by-step solution
1. ... (every step, no skipped arithmetic)
## Answer
**<final answer / correct option(s)>**
## Why the other options are wrong
(only for MCQ/MSQ)
## GATE tip
(trap to avoid or shortcut)
## Try this similar question
**Q:** ...
<details><summary>Answer</summary>...</details>
If the image has several questions, repeat this whole format for each, with a "# Question N" heading. Use LaTeX for math ($...$).
${DIAGRAMS.replace('1-3 diagrams per lesson (at least one), placed right where they explain the step', '1-2 diagrams (at least one whenever the question involves a process, structure, states or a timeline), placed in the solution steps')}`;
// ---------- computed cross-check (program-of-thought) ----------
// Small models slip on counting/simulation in their head, but write decent code. We ask for a JS
// program that computes the answer, run it in a locked-down Worker (no network, no DOM, 3 s limit),
// and compare with the explanation's answer.
function runSandboxed(code, ms = 3000) {
  const src = `self.fetch=undefined;self.XMLHttpRequest=undefined;self.WebSocket=undefined;self.importScripts=undefined;self.EventSource=undefined;
    self.onmessage=e=>{try{const code=e.data;let r=(new Function(code))();
      if(r===undefined){const m=code.match(/function\\s+([A-Za-z_$][\\w$]*)\\s*\\(|(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:function|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)/);
        if(m)r=(new Function(code+'\\nreturn '+(m[1]||m[2])+'();'))();}
      postMessage({ok:true,r:JSON.stringify(r)})}catch(err){postMessage({ok:false,r:String(err)})}};`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  return new Promise(res => {
    const done = v => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); res(v); };
    const t = setTimeout(() => done({ ok: false, r: 'timeout' }), ms);
    w.onmessage = e => done(e.data);
    w.onerror = e => { e.preventDefault(); done({ ok: false, r: e.message }); };
    w.postMessage(code);
  });
}
const CODE_SCHEMA = { type: 'object', required: ['computable', 'code'], properties: { computable: { type: 'boolean' }, code: { type: 'string' } } };
function answerOf(md) {
  const m = String(md || '').match(/##\s*Answer[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  return m ? plainText(m[1]).trim() : '';
}
function optionsIn(question) {
  const opts = {};
  // One option per line, "(A) text" / "A. text" / "A) text": take the whole line (options like Θ(n^2) contain brackets).
  String(question).split('\n').forEach(line => { const m = line.match(/^\s*\(?([A-D])[).:]\s*(.+?)\s*$/); if (m) opts[m[1]] = m[2]; });
  if (Object.keys(opts).length >= 2) return opts;
  String(question).replace(/\(?\b([A-D])[).]\s*([^\n(]+?)(?=\s*\(?\b[A-D][).]|\n|$)/g, (_, L, t) => { opts[L] = t.trim(); });
  return opts;
}
function normAnswer(ans, question) {
  const s = String(ans).replace(/^"|"$/g, '').trim();
  const letters = (s.match(/\(([A-D])\)|\b(?:option\s*)?([A-D])\b(?=[).,:\s]|$)/gi) || []).map(x => x.replace(/[^A-D]/gi, '').toUpperCase()).filter(Boolean);
  if (letters.length) return { kind: 'opt', v: [...new Set(letters)].sort().join(',') };
  const num = s.match(/-?\d+(?:\.\d+)?/);
  if (num) {
    const n = parseFloat(num[0]);
    const opts = optionsIn(question);
    const hit = Object.entries(opts).filter(([, t]) => { const m = t.match(/-?\d+(?:\.\d+)?/); return m && Math.abs(parseFloat(m[0]) - n) < 1e-6; }).map(([L]) => L);
    if (hit.length === 1) return { kind: 'opt', v: hit[0], num: n };
    return { kind: 'num', v: n };
  }
  return { kind: 'text', v: s.toLowerCase() };
}
function sameAnswer(a, b) {
  if (a.kind === 'num' && b.kind === 'num') return Math.abs(a.v - b.v) <= Math.max(0.011, Math.abs(a.v) * 0.005);
  if (a.kind === 'opt' && b.kind === 'opt') return a.v === b.v;
  if (a.num != null && b.kind === 'num') return Math.abs(a.num - b.v) < 1e-6;
  if (b.num != null && a.kind === 'num') return Math.abs(b.num - a.v) < 1e-6;
  return null; // not comparable
}
// Text answers (Θ(n log n), an expression, an IP): compare loosely, or through the option they match.
function normText(s) { return String(s || '').toLowerCase().replace(/\\theta|θ|\\left|\\right|\\,|\$|\*\*|\s|\\|[{}]/g, '').replace(/\^1(?!\d)/g, ''); }
function textAgree(computed, shown, question) {
  const isLetter = x => /^\s*(option\s*)?\(?[A-D]\)?(\s*(,|and)\s*\(?[A-D]\)?)*[\s.]*$/i.test(String(x)) || /^\s*\(?[A-D]\)[\s.]/.test(String(x));
  // One side is an option letter: map the other side to the option whose text it matches.
  if (isLetter(computed) || isLetter(shown)) {
    const opts = Object.entries(optionsIn(question));
    const toOpt = x => {
      if (isLetter(x)) return normAnswer(x, question).v;
      const c = normText(x);
      const hit = opts.find(([, t]) => normText(t) === c) || opts.find(([, t]) => normText(t).length > 1 && (normText(t).includes(c) || c.includes(normText(t))));
      return hit ? hit[0] : null;
    };
    const a = toOpt(computed), b = toOpt(shown);
    return a && b ? a === b : null;
  }
  const c = normText(computed), s = normText(shown);
  if (!c || !s) return null;
  if (s === c || s.includes(c) || c.includes(s)) return true;
  return c.length < 25 && s.length < 25 ? false : null;
}
function compareAnswers(computedValue, computedText, shown, question) {
  if (typeof computedValue === 'number' || /^-?\d+(\.\d+)?$/.test(String(computedValue))) {
    const r = sameAnswer(normAnswer(computedValue, question), normAnswer(shown, question));
    if (r != null) return r;
  }
  return textAgree(computedText, shown, question);
}
// Returns null (not computable / failed) or { computed, agree, solver? }.
// First choice: an exact built-in solver (the model only reads the inputs). Otherwise a model-written program.
async function crossCheck(question, solutionMd, signal) {
  let s = null;
  try { s = typeof Solvers !== 'undefined' ? await Solvers.answer(question, signal) : null; } catch (e) { if (e.name === 'AbortError') throw e; }
  if (s) {
    const shown = answerOf(solutionMd);
    return { computed: s.text, agree: compareAnswers(s.value, s.text, shown, question), shown, solver: s.name, steps: s.steps, params: s.params };
  }
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: `You verify GATE CS answers by writing JavaScript. If the question has a definite numeric or option answer that can be computed or simulated (counting, page replacement, scheduling, addressing, probability, recurrences, number systems, cache/memory math, etc.), set computable=true and write the BODY of a function that simulates/computes it step by step and ends with "return <answer>;" where the answer is a number, or the option letter as a string ("A".."D") when you must compare against options. Use only plain JavaScript (no imports, no I/O). If the question is purely conceptual, set computable=false and code="".` },
    { role: 'user', content: question.slice(0, 4000) },
  ], { signal, format: CODE_SCHEMA, temperature: 0, maxTokens: 1500, model: checkModel() }));
  if (!j.computable || !j.code || !j.code.includes('return')) return null;
  const run = await runSandboxed(j.code);
  if (!run.ok || run.r == null || run.r === 'null' || run.r === undefined) return null;
  const computed = JSON.parse(run.r);
  const a = normAnswer(computed, question), b = normAnswer(answerOf(solutionMd), question);
  return { computed, code: j.code, agree: sameAnswer(a, b), shown: answerOf(solutionMd) };
}
function crossCheckHtml(c) {
  if (!c) return '';
  if (c.solver) {
    const work = `<details class="small"><summary>The exact working (${escapeHtml(c.solver)})</summary><p class="small muted">Inputs read from the question: ${c.params ? solverInputsMd(c.params) : ''}. If one of these is misread, fix the question text and solve again.</p><div class="md">${renderMd(c.steps || '')}</div></details>`;
    if (c.agree === false) return `<div class="check bad">&#9888; <b>The exact ${escapeHtml(c.solver)} calculator disagrees.</b> It computed <b>${escapeHtml(String(c.computed))}</b>, but the explanation says <b>${escapeHtml(String(c.shown || '').slice(0, 80))}</b>. The calculator is plain code, so trust it unless it misread an input.
      <div class="row" style="margin-top:6px"><button class="primary cc-fix">Re-explain using ${escapeHtml(String(c.computed))}</button></div>${work}</div>`;
    return `<div class="check ok">&#10003; <b>Computed exactly</b> by the built-in ${escapeHtml(c.solver)} calculator: <b>${escapeHtml(String(c.computed))}</b>${c.agree ? ', same as the explanation.' : '.'}${work}</div>`;
  }
  if (c.agree === true) return `<div class="check ok">&#10003; Cross-checked: a step-by-step program also got <b>${escapeHtml(String(c.computed))}</b>.</div>`;
  if (c.agree === false) return `<div class="check bad">&#9888; <b>Cross-check disagrees.</b> A step-by-step program computed <b>${escapeHtml(String(c.computed))}</b>, but the explanation says <b>${escapeHtml(c.shown.slice(0, 80))}</b>. For counting/simulation questions the program is usually right.
    <div class="row" style="margin-top:6px"><button class="primary cc-fix">Re-explain using ${escapeHtml(String(c.computed))}</button></div>
    <details class="small"><summary>See the program</summary><pre><code>${escapeHtml(c.code)}</code></pre></details></div>`;
  return '';
}

// ---------- votes, confidence and calibration ----------
// A few independent, quick solves (checker model, some randomness). If they all land on the same
// answer as the explanation, we're more confident; a split vote is a warning sign.
const BLIND_SCHEMA = { type: 'object', required: ['working', 'final_answer'], properties: { working: { type: 'string' }, final_answer: { type: 'string' } } };
// think: a second opinion (any model other than the checker) thinks first, if the model can.
async function blindAnswer(question, signal, temperature = 0.6, model = checkModel(), think = model !== checkModel()) {
  const j = parseJSON(await ollamaChat([
    { role: 'system', content: 'Solve this GATE CS question on your own, carefully. "working": your short step-by-step reasoning (at most ~12 lines, do every calculation). "final_answer": ONLY the final answer: option letter(s) like "B" or "A, C" if there are options, otherwise the number (no units) or a very short phrase.' },
    { role: 'user', content: String(question).slice(0, 4000) + (typeof factsFor === 'function' ? factsBlock(factsFor(question, 4)) : '') },
  ], { signal, model, temperature, maxTokens: 1500, format: BLIND_SCHEMA, think }));
  return String(j.final_answer || '').trim();
}
// Settings → "Model for second opinions" solves it once more, thinking first when the model can.
async function secondOpinion(question, signal) {
  const model = bigModel();
  return { model, answer: model ? await blindAnswer(question, signal, 0, model, true) : '' };
}
function voteMatch(vote, shown, question) {
  const r = sameAnswer(normAnswer(vote, question), normAnswer(shown, question));
  return r != null ? r : textAgree(vote, shown, question);
}
// Levels, most to least sure: exact (built-in calculator agrees), high (program + all votes agree),
// good (program agrees or all votes agree), low (votes split), conflict (a check disagrees), unchecked.
const CONF_TEXT = { official: 'Official GATE answer key', exact: 'Very sure: computed exactly', high: 'Very likely right', good: 'Probably right', low: 'Unsure: independent tries disagree', conflict: 'Warning: a check disagrees', unchecked: 'Not checked (no single answer to compare)' };
function confidenceLevel(check, votes) {
  if (check && check.agree === false) return 'conflict';
  if (check && check.solver && check.agree) return 'exact';
  const cmp = (votes || []).filter(v => v.match != null);
  const all = cmp.length >= 2 && cmp.every(v => v.match), some = cmp.some(v => v.match === false);
  if (check && check.agree && all) return 'high';
  if ((check && check.agree && !some) || all) return 'good';
  if (some) return 'low';
  return 'unchecked';
}
// Runs the computed check and (when no exact calculator applies) a 2-vote check. onStep(label) reports progress.
async function assessSolution(question, solutionMd, signal, { votes: nVotes = 2, onStep = () => {} } = {}) {
  onStep('Checking the answer with an exact calculator or a program');
  let check = null;
  try { check = await crossCheck(question, solutionMd, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
  const shown = answerOf(solutionMd), votes = [];
  if (!(check && check.solver) && shown) {
    for (let i = 0; i < nVotes; i++) {
      onStep(`Solving it again independently (${i + 1} of ${nVotes})`);
      try { const v = await blindAnswer(question, signal, 0.5 + 0.2 * i); votes.push({ answer: v.slice(0, 60), match: voteMatch(v, shown, question) }); }
      catch (e) { if (e.name === 'AbortError') throw e; }
    }
  }
  let level = confidenceLevel(check, votes), big = null, rel = '';
  // Not sure? A second opinion (not when an exact calculator decided): a thinking solve, by default.
  const bm = bigModel();
  if (bm && shown && !(check && check.solver) && ['low', 'unchecked', 'conflict'].includes(level)) {
    onStep(bm === checkModel() ? 'Not sure yet: solving it once more with step-by-step thinking' : `Not sure yet: asking the bigger model (${bm})`);
    try { const v = (await secondOpinion(question, signal)).answer; big = { model: bm, answer: v.slice(0, 60), match: voteMatch(v, shown, question) }; votes.push({ ...big, big: true }); level = confidenceLevel(check, votes); }
    catch (e) { if (e.name === 'AbortError') throw e; }
  }
  if (['low', 'unchecked', 'conflict'].includes(level)) rel = await reliabilityNote(lessonSubject(question + '\n' + solutionMd));
  return { check, votes, level, big, rel };
}
// How often each level has really been right (from your self-tests and reports).
const Calib = {
  data: {},
  async load() { try { this.data = (await Store.getHub()).calib || {}; } catch {} return this.data; },
  note(level) {
    const c = this.data[level];
    if (!c || c.n < 5) return '';
    return `In your self-tests, answers at this level were right ${c.right} of ${c.n} times (${Math.round(100 * c.right / c.n)}%).`;
  },
  async record(entries) {   // [{ level, right }]
    await updateHub(h => { h.calib = h.calib || {}; for (const e of entries) { const c = h.calib[e.level] = h.calib[e.level] || { n: 0, right: 0 }; c.n++; if (e.right) c.right++; } });
    await this.load();
  },
};
function confidenceHtml(conf) {
  if (!conf || !conf.level) return '';
  const lv = conf.level, cal = Calib.note(lv);
  const small = (conf.votes || []).filter(v => !v.big), big = (conf.votes || []).find(v => v.big);
  // One compact line of evidence; the longer notes (track record, calibration) sit in the hover text.
  const mark = m => m ? ' ✓' : m === false ? ' ✗' : '';
  const c = conf.check, bits = [];
  if (c && c.computed != null && (lv === 'conflict' || lv === 'exact')) bits.push(`${c.solver ? escapeHtml(c.solver) : 'Check'}: <b>${escapeHtml(String(c.computed))}</b>`);
  if (small.length) bits.push(`Re-solves: ${small.map(v => `<b>${escapeHtml(v.answer || '?')}</b>${mark(v.match)}`).join(', ')}`);
  if (big) bits.push(`<span title="${escapeHtml(big.model)}">Second opinion</span>: <b>${escapeHtml(big.answer || '?')}</b>${mark(big.match)}`);
  const unsure = ['low', 'conflict', 'unchecked'].includes(lv);
  const tipText = [cal, unsure && conf.rel].filter(Boolean).join(' ');
  return `<div class="conf-banner lv-${lv}"${tipText ? ` title="${escapeHtml(tipText)}"` : ''}><span class="conf-dot"></span><div><b>${CONF_TEXT[lv].split(':')[0]}</b>${bits.length ? `<span class="small"> · ${bits.join(' · ')}</span>` : ''}${unsure ? '<div class="small conf-unsure">Verify the final step, or use Second opinion.</div>' : ''}</div></div>`;
}

function lessonSubject(md) {
  const m = String(md || '').match(/\*\*GATE subject:\*\*\s*([^\n]+)/i);
  const line = ' ' + (m ? m[1] : String(md || '').slice(0, 1500)).toLowerCase() + ' ';
  // The subject named earliest wins ("Operating System - Scheduling Algorithms" is OS), full names before aliases.
  const earliest = list => list.filter(x => x.at >= 0).sort((a, b) => a.at - b.at)[0];
  const byName = earliest(SYLLABUS.map(x => ({ x, at: line.indexOf(x.subject.toLowerCase()) })));
  const byAlias = earliest(SYLLABUS.map(x => ({ x, at: Math.min(...x.alias.map(a => { const i = line.indexOf(a); return i < 0 ? Infinity : i; })) })).map(o => ({ x: o.x, at: o.at === Infinity ? -1 : o.at })));
  const s = (byName || byAlias || {}).x;
  return s ? s.subject : null;
}

// ---------- lesson viewer (step by step) ----------
// Kind of page a lesson section is drawn on: numbered notebook step, sticky note (traps),
// index card (formulas) or a "try it" card (quick check).
function stepKind(md) {
  const h = (String(md).match(/^##\s*(.+)$/m) || [, ''])[1].toLowerCase();
  if (/big picture|context|where this fits/.test(h)) return 'context';
  if (/prerequisite|before we start/.test(h)) return 'prereq';
  if (/trap|mistake|pitfall/.test(h)) return 'sticky';
  if (/formula|fact|summary|cheat/.test(h)) return 'index';
  if (/quick check|try|practice|exercise/.test(h)) return 'try';
  return 'step';
}
function stepHtml(md) {
  const kind = stepKind(md);
  let html = renderMd(md);
  if (kind === 'step') html = html.replace(/<h2>\s*Step\s*(\d+)\s*[:.\-–]\s*/i, (_, n) => `<span class="step-num" aria-hidden="true">${n}</span><h2 class="step-h">`);
  if (kind === 'sticky') html = html.replace(/<h2>[^<]*<\/h2>/i, '<h2>Watch out!</h2>');
  if (kind === 'try') html = html.replace(/<h2>[^<]*<\/h2>/i, '<h2>Try it yourself</h2>');
  if (kind === 'context') html = html.replace(/<h2>[^<]*<\/h2>/i, '<h2>The big picture</h2>');
  if (kind === 'prereq') html = html.replace(/<h2>[^<]*<\/h2>/i, '<h2>Before we start: what you need</h2>');
  // "Tutor's addition" blockquotes get their own look so they stand apart from your notes.
  html = html.replace(/<blockquote>(\s*<p>\s*<strong>Tutor['’]s addition:?<\/strong>)/gi, '<blockquote class="addition">$1');
  return { kind, html };
}
class LessonViewer {
  constructor(el, { onFinish, finishLabel = 'Done', onDoneToggle, decorate, onFormula } = {}) {
    this.el = el; this.onFinish = onFinish; this.finishLabel = finishLabel; this.onDoneToggle = onDoneToggle; this.decorate = decorate; this.onFormula = onFormula;
    this.md = ''; this.step = 0; this.showAll = Cfg.get('lessonView', 'all') === 'all'; this.done = false; this.seen = new Set();
    el.innerHTML = `<div class="card"><div class="lv-head md"></div><div class="row small lv-tools"></div></div>
      <div class="lv-body"></div>
      <div class="card lv-nav"><button class="lv-prev">${icon('arrowL')} Back</button><div class="lv-dots" role="tablist"></div>
        <button class="lv-speak" title="Read this step aloud">${icon('speaker')} Listen</button><button class="link lv-all"></button>
        <button class="primary lv-next"></button></div>`;
    $('.lv-prev', el).onclick = () => { this.step--; this.render(); };
    $('.lv-all', el).onclick = () => { this.showAll = !this.showAll; Cfg.set('lessonView', this.showAll ? 'all' : 'steps'); this.render(); };
    $('.lv-speak', el).onclick = () => (window.speechSynthesis && speechSynthesis.speaking) ? speechSynthesis.cancel() : speak(this.current());
    $('.lv-next', el).onclick = () => {
      if (!this.showAll && this.step < this.steps().length - 1) { this.step++; this.render(); el.scrollIntoView({ behavior: 'smooth' }); }
      else if (this.onFinish) this.onFinish();
    };
  }
  set(md, { done = false, keepStep = false } = {}) { this.md = md || ''; this.done = done; if (!keepStep) { this.step = 0; this.seen = new Set(); } this.render(); }
  parts() { const p = this.md.split(/^(?=## )/m); return { head: p[0] || '', steps: p.slice(1) }; }
  steps() { return this.parts().steps; }
  current() { const s = this.steps(); return this.showAll ? s.join('\n\n') : (s[this.step] || this.parts().head); }
  render() {
    const { head, steps } = this.parts();
    this.step = Math.max(0, Math.min(this.step, steps.length - 1));
    this.seen.add(this.step);
    const subj = (head.match(/\*\*GATE subject:\*\*\s*([^\n]+)/i) || [])[1];
    const cleanHead = head.replace(/\*\*GATE subject:\*\*[^\n]*\n?/i, '');
    $('.lv-head', this.el).innerHTML = (cleanHead.trim() ? renderMd(cleanHead) : '<p class="empty" style="margin-bottom:6px">Writing your lesson&hellip;</p><div class="skel"><i></i><i></i><i></i><i></i></div>') +
      (subj ? `<div class="lesson-meta">${escapeHtml(plainText(subj).replace(/<\s*(topic|one of)?\s*/gi, '').replace(/>|\(the subject must[^)]*\)?/gi, '').trim())}</div>` : '');
    const tools = $('.lv-tools', this.el);
    tools.innerHTML = this.onDoneToggle ? `<label><input type="checkbox" class="lv-done" ${this.done ? 'checked' : ''}> I've understood this lesson</label>` : '';
    if (this.onDoneToggle) $('.lv-done', tools).onchange = e => { this.done = e.target.checked; this.onDoneToggle(this.done); };
    const shown = this.showAll ? steps : (steps[this.step] != null ? [steps[this.step]] : []);
    const moved = this._shownKey !== this.step + ':' + this.showAll;   // animate only when you change steps, not while text streams in
    this._shownKey = this.step + ':' + this.showAll;
    $('.lv-body', this.el).innerHTML = shown.map(s => { const { kind, html } = stepHtml(s); return `<div class="card step-card md ${kind === 'step' ? '' : kind}${moved ? ' enter' : ''}" data-kind="${kind}">${html}</div>`; }).join('');
    if (this.decorate) this.el.querySelectorAll('.lv-body [data-kind]').forEach(card => this.decorate(card.dataset.kind, card));
    if (this.onFormula) this.el.querySelectorAll('.lv-body .katex-display').forEach(f => { f.title = 'Tap to have the tutor explain this formula'; f.onclick = () => this.onFormula(texOf(f)); });
    $('.lv-dots', this.el).innerHTML = this.showAll ? '' : steps.map((s, i) => `<span role="tab" title="${escapeHtml(plainText((s.match(/^##\s*(.+)$/m) || [, ''])[1]))}" class="${i === this.step ? 'on' : this.seen.has(i) ? 'seen' : ''}" data-s="${i}"></span>`).join('');
    this.el.querySelectorAll('.lv-dots [data-s]').forEach(d => d.onclick = () => { this.step = +d.dataset.s; this.render(); });
    $('.lv-prev', this.el).disabled = this.showAll || this.step === 0;
    $('.lv-all', this.el).textContent = this.showAll ? 'One step at a time' : 'Show the whole lesson';
    $('.lv-next', this.el).innerHTML = (!this.showAll && this.step < steps.length - 1 ? 'Next step' : escapeHtml(this.finishLabel.replace(/\s*[→↓]$/, ''))) + ' ' + icon('arrowR');
    $('.lv-nav', this.el).classList.toggle('hidden', !steps.length);
  }
}

// ---------- doubt chat (multi-turn) ----------
class ChatBox {
  constructor(el, { system, context, placeholder = 'Ask a doubt...', linkify } = {}) {
    this.el = el; this.system = system; this.context = context; this.linkify = linkify; this.msgs = [];
    el.innerHTML = `<div class="chat-thread"></div><div class="row" style="margin-top:8px">
      <input type="text" class="chat-in" placeholder="${escapeHtml(placeholder)}" style="flex:1;min-width:200px"><button class="chat-send">Ask</button><button class="chat-clear">Clear</button></div>`;
    $('.chat-send', el).onclick = () => this.send();
    $('.chat-clear', el).onclick = () => { this.msgs = []; this.render(); };
    $('.chat-in', el).onkeydown = e => { if (e.key === 'Enter') this.send(); };
  }
  reset() { this.msgs = []; this.render(); }
  render(partial) {
    const items = this.msgs.concat(partial != null ? [{ role: 'assistant', content: partial }] : []);
    $('.chat-thread', this.el).innerHTML = items.map(m => `<div class="chat-msg ${m.role}">${m.role === 'user' ? escapeHtml(m.content) : this.html(m.content)}</div>`).join('');
  }
  html(md) { const h = renderMd(md); return this.linkify ? this.linkify(h) : h; }
  send() {
    const inp = $('.chat-in', this.el), q = inp.value.trim();
    if (!q) return;
    inp.value = '';
    this.msgs.push({ role: 'user', content: q });
    this.render('');
    runJob('Answering your doubt', async signal => {
      const sys = `${typeof this.system === 'function' ? this.system() : this.system}${langNote()}\n\n${this.context ? this.context() : ''}`;
      const ans = await ollamaChat([{ role: 'system', content: sys }, ...this.msgs.slice(-8)], { signal, numCtx: 12288, onToken: (_, o) => this.render(o) });
      this.msgs.push({ role: 'assistant', content: ans });
    }, () => this.render());
  }
}

// ---------- GATE CS syllabus ----------
const SYLLABUS = [
  { subject: 'General Aptitude', alias: ['aptitude', 'verbal', 'quantitative'], topics: ['Verbal ability', 'Quantitative aptitude', 'Analytical aptitude', 'Spatial aptitude'] },
  { subject: 'Discrete Mathematics', alias: ['discrete', 'logic', 'combinatorics', 'graph theory', 'set theory'], topics: ['Propositional and first-order logic', 'Sets, relations, functions', 'Partial orders and lattices', 'Monoids and groups', 'Graphs: connectivity, matching, colouring', 'Combinatorics: counting', 'Recurrence relations', 'Generating functions'] },
  { subject: 'Linear Algebra', alias: ['matrix', 'matrices', 'eigen'], topics: ['Matrices and determinants', 'System of linear equations', 'Eigenvalues and eigenvectors', 'LU decomposition'] },
  { subject: 'Calculus', alias: ['limit', 'integration', 'differentiation'], topics: ['Limits, continuity, differentiability', 'Maxima and minima', 'Mean value theorem', 'Integration'] },
  { subject: 'Probability and Statistics', alias: ['probability', 'statistics', 'random variable'], topics: ['Random variables', 'Uniform, normal, exponential distributions', 'Poisson and binomial distributions', 'Mean, median, mode, standard deviation', 'Conditional probability and Bayes theorem'] },
  { subject: 'Digital Logic', alias: ['digital', 'boolean', 'k-map', 'flip-flop'], topics: ['Boolean algebra', 'Combinational circuits', 'Sequential circuits', 'Minimization (K-maps)', 'Number representations', 'Computer arithmetic: fixed and floating point'] },
  { subject: 'Computer Organization and Architecture', alias: ['coa', 'computer organization', 'architecture', 'pipeline', 'cache'], topics: ['Machine instructions and addressing modes', 'ALU, data-path and control unit', 'Instruction pipelining and hazards', 'Cache memory', 'Main memory and secondary storage', 'I/O interface: interrupt and DMA'] },
  { subject: 'Programming and Data Structures', alias: ['programming', 'data structure', 'c programming', 'linked list', 'stack', 'queue', 'tree', 'heap'], topics: ['Programming in C', 'Recursion', 'Arrays, stacks, queues', 'Linked lists', 'Trees and binary search trees', 'Binary heaps', 'Graphs (representation)'] },
  { subject: 'Algorithms', alias: ['algorithm', 'sorting', 'complexity', 'dynamic programming', 'greedy'], topics: ['Searching, sorting, hashing', 'Asymptotic complexity', 'Greedy algorithms', 'Dynamic programming', 'Divide and conquer', 'Graph traversals (BFS/DFS)', 'Minimum spanning trees', 'Shortest paths'] },
  { subject: 'Theory of Computation', alias: ['toc', 'automata', 'computation', 'regular', 'context-free', 'turing'], topics: ['Regular expressions and finite automata', 'Context-free grammars and PDA', 'Regular and context-free languages, pumping lemma', 'Turing machines and undecidability'] },
  { subject: 'Compiler Design', alias: ['compiler', 'parsing', 'lexical'], topics: ['Lexical analysis', 'Parsing (LL, LR)', 'Syntax-directed translation', 'Runtime environments', 'Intermediate code generation', 'Local optimisation', 'Data flow analysis: constant propagation, liveness, CSE'] },
  { subject: 'Operating System', alias: ['operating system', ' os', 'os ', 'process', 'deadlock', 'scheduling', 'paging'], topics: ['System calls, processes, threads', 'Inter-process communication', 'Concurrency and synchronization', 'Deadlock', 'CPU and I/O scheduling', 'Memory management and virtual memory', 'File systems'] },
  { subject: 'Databases', alias: ['dbms', 'database', 'sql', 'normal form', 'transaction'], topics: ['ER model', 'Relational algebra and tuple calculus', 'SQL', 'Integrity constraints and normal forms', 'File organization and indexing (B/B+ trees)', 'Transactions and concurrency control'] },
  { subject: 'Computer Networks', alias: ['network', ' cn', 'tcp', 'routing', 'ip address'], topics: ['Layering: OSI and TCP/IP', 'Packet, circuit and virtual-circuit switching', 'Data link layer: framing, error detection, MAC, Ethernet bridging', 'Routing: shortest path, flooding, distance vector, link state', 'IPv4, CIDR, fragmentation', 'ARP, DHCP, ICMP, NAT', 'Transport layer: UDP, TCP, flow and congestion control, sockets', 'Application layer: DNS, SMTP, HTTP, FTP, email'] },
];
const SUBJECTS = SYLLABUS.map(s => s.subject);
function topicKey(subject, topic) { return slug(subject) + '|' + slug(topic); }

// ---------- installable app ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; document.dispatchEvent(new Event('gt-installable')); });
async function installApp() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  const r = await installPrompt.userChoice;
  installPrompt = null;
  return r.outcome === 'accepted';
}

// ---------- toasts (replace blocking alert() pop-ups) ----------
function toast(msg, kind = 'info', ms = 4200) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = String(msg).replace(/^Error:\s*/, '');
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const close = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); };
  t.onclick = close;
  setTimeout(close, kind === 'bad' ? ms * 1.6 : ms);
}
window.alert = msg => toast(msg, /error|fail|not |couldn|can't|invalid|no valid/i.test(String(msg)) ? 'bad' : 'info');

// ---------- safe saves when several parts of the app write the same study space ----------
// fn(current) mutates the latest stored data; runs under a per-space lock (Web Locks) so the
// background reader and an open study page never overwrite each other's pages.
async function updateData(siteId, fn) {
  const work = async () => { const cur = await Store.getData(siteId); await fn(cur); await Store.putData(siteId, cur); return cur; };
  return navigator.locks ? navigator.locks.request('gt-site-' + siteId, work) : work();
}
const bus = 'BroadcastChannel' in window ? new BroadcastChannel('gate-desk') : { postMessage() {}, addEventListener() {} };

// ---------- notifications (toast here + system notification when you're in another window) ----------
const Notify = {
  async ask() {
    if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
  },
  show(title, body = '', kind = 'ok') {
    toast(title + (body ? ' ' + body : ''), kind);
    if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
      try { new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'gate-desk' }); } catch {}
    }
  },
};
// Messages for every open app window, including this one.
function announce(m) { bus.postMessage(m); window.dispatchEvent(new CustomEvent('gt-bus', { detail: m })); }
function onBus(fn) { bus.addEventListener('message', e => fn(e.data || {})); window.addEventListener('gt-bus', e => fn(e.detail || {})); }

// ---------- page viewer (lightbox) ----------
// getSrc(i) -> Promise<dataURL>; shows page i of n with previous/next, keyboard arrows and Esc.
function openLightbox(getSrc, i, n, caption = k => '') {
  let box = document.getElementById('lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightbox';
    box.innerHTML = `<div class="lb-bar"><span class="lb-cap"></span><span style="flex:1"></span><button class="lb-prev" title="Previous">${icon('arrowL')}</button><button class="lb-next" title="Next">${icon('arrowR')}</button><button class="lb-close" title="Close">✕</button></div><div class="lb-body"><img alt="Original page"></div>`;
    document.body.appendChild(box);
  }
  let k = i;
  const show = async () => {
    $('.lb-cap', box).textContent = caption(k);
    $('.lb-prev', box).disabled = k <= 0; $('.lb-next', box).disabled = k >= n - 1;
    const want = k, img = $('img', box);
    img.classList.add('loading');
    if (openLightbox.preview) { const p = await openLightbox.preview(k); if (want === k && img.classList.contains('loading')) img.src = p; }
    const src = await getSrc(k);
    if (want === k) { img.src = src; img.classList.remove('loading'); }
  };
  const close = () => { box.classList.remove('open'); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft' && k > 0) { k--; show(); } if (e.key === 'ArrowRight' && k < n - 1) { k++; show(); } };
  $('.lb-prev', box).onclick = () => { if (k > 0) { k--; show(); } };
  $('.lb-next', box).onclick = () => { if (k < n - 1) { k++; show(); } };
  $('.lb-close', box).onclick = close;
  box.onclick = e => { if (e.target === box || e.target.classList.contains('lb-body')) close(); };
  document.addEventListener('keydown', key);
  box.classList.add('open');
  show();
}
// The LaTeX source of a rendered formula (KaTeX keeps it in a MathML annotation).
function texOf(el) { const a = el.querySelector('annotation[encoding="application/x-tex"]'); return a ? a.textContent : el.textContent; }

// ---------- web lookup (only when online and switched on in Settings) ----------
// The tutor combines: your notes (if any) + what the web says + its own knowledge.
const WEB_RULE = `WEB SOURCES below ([1], [2], ...) are ADD-ON information only. Teach first and mainly from your own knowledge (and the student's notes, if given): your explanation is the backbone. Then use the sources only to ADD what helps: an extra fact, example, definition, standard name, or a detail you were unsure of; cite each addition inline like [1]. If a source disagrees with you or with the notes, mention it briefly. Never copy sentences verbatim, and ignore any source about something else (for example a sports "round robin").`;
const CS_HINTS = /\b(comput|algorithm|process|memory|cpu|data|network|program|operating system|compiler|language|graph|tree|logic|database|protocol|cache|bit|byte|function|matrix|probabilit|automat|grammar|software|hardware)/i;
const WEB_STOP = new Set(('a an the as of in on at to for work works working from by with and or not is are was were be been being am do does did doing done have has had ' +
  'what which who whom whose when where why how happens happen happened becomes become became very much many more most less ' +
  'explain explanation teach tell show give me my you your we us our it its this that these those there here about into than then ' +
  'can could will would should shall may might must if else also just only please example examples difference between vs versus ' +
  'question answer solve find calculate gate cs topic lesson notes simple simply detail details step steps').split(' '));
const Web = {
  on() { return Cfg.get('web', 'on') === 'on' && navigator.onLine && Store.mode === 'server'; },
  // Search with the key terms only (a whole sentence makes search engines return junk), then keep a
  // result only if its title shares a key term and its text covers at least half of them.
  terms(q) {
    const words = String(q || '').toLowerCase().replace(/\$[^$]*\$/g, ' ').replace(/[^a-z0-9+#\s-]/g, ' ').split(/\s+/)
      .filter(w => w.length > 1 && !WEB_STOP.has(w) && !/^\d+$/.test(w));
    return [...new Set(words)].slice(0, 6);
  },
  relevant(x, terms) {
    const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
    const qt = topicTokens(terms.join(' ')), title = topicTokens(x.title.replace(/^Wikipedia:\s*/, '')), body = topicTokens(x.text.slice(0, 1500));
    const titleHit = title.some(y => qt.some(w => same(w, y)));
    const covered = qt.filter(w => body.some(y => same(w, y)) || title.some(y => same(w, y))).length;
    return titleHit && covered >= Math.ceil(qt.length / 2) && CS_HINTS.test(x.text.slice(0, 1500));
  },
  async search(q, signal) {
    const terms = this.terms(q);
    if (!this.on() || !terms.length) return [];
    try {
      const r = await fetch('/api/web', { method: 'POST', signal, body: JSON.stringify({ q: terms.join(' '), key: Cfg.get('webkey', '') }) });
      const j = await r.json();
      return [].concat(j.results || []).filter(x => x && x.text && this.relevant(x, terms)).slice(0, 4);
    } catch (e) { if (e.name === 'AbortError') throw e; return []; }
  },
  context(results) { return results.length ? `\n\nWEB SOURCES:\n${results.map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.text.slice(0, 3500)}`).join('\n\n')}\n\n${WEB_RULE}` : ''; },
  brief(results) { return results.map(r => ({ title: r.title, url: r.url })); },
  html(sources) {
    if (!sources || !sources.length) return '';
    return `<div class="sources"><span class="small muted">${icon('search')} Also checked online:</span> ${sources.map((s, i) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">[${i + 1}] ${escapeHtml(s.title)}</a>`).join(' ')}</div>`;
  },
};
// A toast with an Undo button (used instead of "Are you sure?" pop-ups).
function toastUndo(msg, undo, ms = 6000) {
  toast(msg, 'info', ms);
  const t = [...document.querySelectorAll('#toasts .toast')].pop();
  if (!t) return;
  const b = document.createElement('button');
  b.className = 'link toast-undo'; b.textContent = 'Undo';
  b.onclick = e => { e.stopPropagation(); undo(); t.remove(); };
  t.appendChild(b);
}

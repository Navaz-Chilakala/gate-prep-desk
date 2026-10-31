// Page reading for study spaces + the background reading queue.
// - Book.open(siteId): loads a space's PDFs/images as one list of pages (+ chapters from PDF bookmarks).
// - readPages(...): reads pages fast: CPU work (render + OCR) for the next page overlaps GPU work
//   (vision model) on the current one; blank pages are skipped and repeated pages reused.
// - Reader: a queue saved with your progress, worked through by exactly one open app window
//   (Web Locks), so you can keep studying while books are read.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';

function prettyName(label) { return String(label).replace(/\.[^.]*$/, '').replace(/_+/g, ' ').trim(); }

async function collectOutline(doc, offset) {
  const out = [];
  let ol = null;
  try { ol = await doc.getOutline(); } catch {}
  async function walk(items, level) {
    for (const it of items || []) {
      let page = null;
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) page = typeof dest[0] === 'number' ? dest[0] + 1 : (await doc.getPageIndex(dest[0])) + 1;
      } catch {}
      if (page) out.push({ title: String(it.title || '').trim() || `Page ${offset + page}`, level, page: offset + page });
      if (level < 2) await walk(it.items, level + 1);
    }
  }
  if (ol) await walk(ol, 1);
  return out;
}

const Book = {
  async open(siteId, onFile) {
    const pages = [], files = [], outline = [];
    let prevImage = false;
    for (const name of await Store.listFiles(siteId)) {
      if (onFile) onFile(displayName(name));
      const blob = await Store.getFile(siteId, name);
      const label = prettyName(displayName(name)), offset = pages.length;
      if ((await sniffExt(blob)) === 'pdf') {
        const doc = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
        for (let p = 1; p <= doc.numPages; p++) pages.push({ kind: 'pdf', doc, p, label: `${label} p.${p}` });
        const ol = await collectOutline(doc, offset);
        if (ol.length) outline.push(...ol);
        else for (let p = 1; p <= doc.numPages; p += 25) {   // no bookmarks: 25-page chapters, lessons named by content
          outline.push({ title: `${label}: pages ${p}-${Math.min(doc.numPages, p + 24)}`, level: 1, page: offset + p, auto: true });
        }
        files.push({ name, pages: doc.numPages, outline: ol.length });
        prevImage = false;
      } else {
        pages.push({ kind: 'img', blob, label });
        if (!prevImage) outline.push({ title: 'Photos & images', level: 1, page: offset + 1 });
        files.push({ name, pages: 1 });
        prevImage = true;
      }
    }
    return { pages, files, outline };
  },
};

// ---------- one page ----------
async function pageCanvas(P, maxW = 1400, maxScale = 2.5) {
  if (P.kind === 'img') return blobToCanvas(P.blob, maxW);
  const page = await P.doc.getPage(P.p);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(maxScale, maxW / vp1.width) });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  // intent 'print' renders without requestAnimationFrame, which browsers pause in background windows.
  await page.render({ canvasContext: g, viewport: vp, intent: 'print' }).promise;
  page.cleanup();
  return c;
}
async function pageText(P) {
  if (P.kind !== 'pdf') return '';
  const tc = await (await P.doc.getPage(P.p)).getTextContent();
  return tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim();
}
// Pictures or many drawn lines (diagrams, tables) mean the text layer alone isn't enough.
async function pageHasFigures(P) {
  if (P.kind !== 'pdf') return true;
  const ops = await (await P.doc.getPage(P.p)).getOperatorList();
  const O = pdfjsLib.OPS;
  let img = 0, path = 0;
  for (const fn of ops.fnArray) {
    if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageMaskXObject || fn === O.paintJpegXObject) img++;
    else if (fn === O.constructPath) path++;
  }
  return img > 0 || path > 40;
}
// 16x16 average hash (for spotting repeated pages) + ink amount (for spotting blank pages).
function pageFingerprint(c) {
  const s = document.createElement('canvas'); s.width = 16; s.height = 16;
  const g = s.getContext('2d'); g.drawImage(c, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data, lum = [];
  for (let i = 0; i < d.length; i += 4) lum.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
  const t = document.createElement('canvas'); t.width = 120; t.height = Math.max(1, Math.round(120 * c.height / c.width));
  const tg = t.getContext('2d'); tg.drawImage(c, 0, 0, t.width, t.height);
  const td = tg.getImageData(0, 0, t.width, t.height).data;
  let dark = 0;
  for (let i = 0; i < td.length; i += 4) if (td[i] + td[i + 1] + td[i + 2] < 450) dark++;
  return { hash: lum.map(v => (v > mean ? '1' : '0')).join(''), blank: dark / (td.length / 4) < 0.004 && sd < 6 };
}
function hamming(a, b) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; }

// Stage A (CPU): text layer, render, fingerprint, OCR.
async function prepPage(P, mode, useOcr) {
  const text = await pageText(P);
  if (text.length >= 300 && (mode === 'fast' || (mode === 'smart' && !(await pageHasFigures(P))))) return { text, direct: true };
  const canvas = await pageCanvas(P, mode === 'thorough' || (P.kind === 'img' && mode !== 'fast') ? 2400 : 1600);   // high resolution for the detailed reading
  const fp = pageFingerprint(canvas);
  let ocr = null;
  if (!fp.blank && text.length < 300 && useOcr) ocr = await ocrCanvas(canvas);
  return { text, canvas, fp, ocr };
}
// Stage B (GPU): decide, and use the vision model where needed.
async function finishPage(a, P, n, total, mode, prev, signal, onToken) {
  if (a.direct) return { n, md: a.text, via: 'text' };
  const hash = a.fp.hash;
  if (a.fp.blank && a.text.length < 20) return { n, md: '', via: 'blank', hash };
  if (prev && prev.hash && prev.md && hamming(prev.hash, hash) <= 2) return { n, md: prev.md, via: 'duplicate', hash };
  const label = `Page ${n} of ${total} (${P.label})`, img = scaleCanvas(a.canvas, 1280);
  if (a.text.length >= 300) return { n, md: await visionTranscribe(img, a.text, 'Extracted text layer', { signal, onToken, label }), via: 'text+vision', hash };
  // Photos of notes (and every scanned page in "very detailed" mode): the slow multi-pass reading.
  if (mode === 'thorough' || (P.kind === 'img' && mode !== 'fast')) {
    const md = await detailedTranscribe(a.canvas, { hint: a.ocr ? a.ocr.text : a.text, signal, onToken, label, onStage: t => jobLabel(`${label}: ${t}`, signal) });
    return { n, md, via: 'detailed', hash, unsure: a.ocr && a.ocr.unsure && a.ocr.unsure.length ? a.ocr.unsure : undefined };
  }
  const good = a.ocr && a.ocr.confidence >= 80 && a.ocr.text.length >= 300;
  const unsure = a.ocr && a.ocr.unsure && a.ocr.unsure.length ? a.ocr.unsure : undefined;
  if (mode === 'fast' || (mode === 'smart' && good && P.kind === 'pdf')) return { n, md: a.ocr ? a.ocr.text : a.text, via: a.ocr ? 'ocr' : 'text', hash, unsure };
  const md = await visionTranscribe(img, a.ocr ? a.ocr.text : a.text, a.ocr ? `OCR text (confidence ${a.ocr.confidence}%)` : 'Extracted text layer', { signal, onToken, label });
  return { n, md, via: a.ocr ? 'ocr+vision' : 'vision', hash, unsure };
}
// Careful reading of one page whose text looks misread (pyqGarble in pyq.js): rendered at high resolution
// (about 2800 px wide) and read with the slow multi-pass reading used for Photo doubt. A text layer that is
// itself garbled is not passed as the hint: the page's own OCR at this resolution is better.
async function carefulRead(P, n, total, { signal, onToken, onStage } = {}) {
  const text = await pageText(P);
  const canvas = await pageCanvas(P, 2800, 5);
  const label = `Page ${n} of ${total} (${P.label})`;
  const badHint = typeof pyqGarble === 'function' && pyqGarble(text, { page: true }).bad;
  const md = await detailedTranscribe(canvas, { hint: badHint ? '' : text, signal, onToken, label, onStage: onStage || (signal ? t => jobLabel(`${label}: ${t}`, signal) : () => {}) });   // (no job: don't relabel someone else's)
  return { n, md, via: 'careful', hash: pageFingerprint(canvas).hash, reread: new Date().toISOString() };
}
// A page read in the normal way whose text can't be right (garbled code, stray symbols, broken numbers):
// read it again carefully and keep whichever reading has fewer problems.
async function recheckPage(P, n, total, r, opts = {}) {
  if (typeof pyqGarble !== 'function' || !r || !r.md || r.via === 'careful' || r.via === 'detailed') return r;
  const g = pyqGarble(r.md, { page: true });
  if (!g.bad) return r;
  if (opts.onStage) opts.onStage(`Page ${n} looks misread (${g.issues[0]}): reading it again carefully`);
  try {
    const r2 = await carefulRead(P, n, total, opts);
    const g2 = pyqGarble(r2.md, { page: true });
    return g2.issues.length < g.issues.length && r2.md.trim().length > r.md.trim().length * 0.6 ? { ...r2, unsure: r.unsure } : { ...r, garble: g.issues };
  } catch (e) { if (e.name === 'AbortError') throw e; console.warn('careful re-read', e); return r; }
}
// Reads page indexes in order with stage A of the next page overlapping stage B of the current one.
// onPage(index, result, k) is called after each page.
async function readPages(pages, indexes, { mode = 'smart', useOcr = true, signal, onToken, onPage, prev = null } = {}) {
  let next = indexes.length ? prepPage(pages[indexes[0]], mode, useOcr) : null;
  for (let k = 0; k < indexes.length; k++) {
    if (signal && signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const i = indexes[k];
    const a = await next;
    next = k + 1 < indexes.length ? prepPage(pages[indexes[k + 1]], mode, useOcr) : null;
    if (next) next.catch(() => {});
    const r = await finishPage(a, pages[i], i + 1, pages.length, mode, prev, signal, onToken);
    prev = r;
    await onPage(i, r, k);
  }
}

// ---------- background reading queue ----------
const Reader = {
  running: null,   // queue item id this window is reading
  ctl: null,
  stopAs: 'paused',
  async enqueue({ siteId, name, from = 1, to = 99999, mode = 'smart', ocr = true }) {
    Notify.ask();
    await updateHub(h => {
      h.queue = (h.queue || []).filter(q => !(q.siteId === siteId && ['done', 'cancelled'].includes(q.status)));
      const same = h.queue.find(q => q.siteId === siteId && q.status !== 'error');
      if (same) Object.assign(same, { from: Math.min(same.from, from), to: Math.max(same.to, to), mode, ocr, status: same.status === 'reading' ? 'reading' : 'queued' });
      else h.queue.push({ id: uid(), siteId, name, from, to, mode, ocr, status: 'queued', added: new Date().toISOString(), k: 0, total: 0 });
    });
    this.kick();
  },
  async command(id, cmd) {   // pause | resume | cancel
    if (cmd === 'resume') await updateHub(h => { const q = (h.queue || []).find(x => x.id === id); if (q) { q.status = 'queued'; delete q.stop; } });
    // A reading item may be in another window or browser: leave it a "stop" note it checks after every page.
    if (cmd === 'cancel') await updateHub(h => { const q = (h.queue || []).find(x => x.id === id); if (q && q.status === 'reading') q.stop = 'cancel'; h.queue = (h.queue || []).filter(x => x.id !== id || x.status === 'reading'); });
    if (cmd === 'pause') await updateHub(h => { const q = (h.queue || []).find(x => x.id === id); if (q) { if (q.status === 'reading') q.stop = 'pause'; else q.status = 'paused'; } });
    this.handle({ type: 'reader-cmd', id, cmd });
    bus.postMessage({ type: 'reader-cmd', id, cmd });
    this.kick();
  },
  handle(m) {
    if (m.type === 'reader-cmd' && m.id === this.running && m.cmd !== 'resume') { this.stopAs = m.cmd === 'cancel' ? 'cancelled' : 'paused'; this.ctl && this.ctl.abort(); }
    if (m.type === 'queue-kick' && this._wake) this._wake();
  },
  kick() { bus.postMessage({ type: 'queue-kick' }); if (this._wake) this._wake(); },
  // Reads one page of a book again carefully (high resolution, multi-pass) and saves it. Returns its new text,
  // or null when the book or page no longer exists.
  async rereadPage(siteId, n, { signal, onStage } = {}) {
    let book;
    try { book = await Book.open(siteId); } catch { return null; }
    const P = book.pages[n - 1];
    if (!P) return null;
    const r = await carefulRead(P, n, book.pages.length, { signal, onStage });
    await updateData(siteId, cur => { cur.pages = cur.pages || []; cur.pages[n - 1] = { ...(cur.pages[n - 1] || {}), ...r }; });
    announce({ type: 'pages', siteId });
    return r.md;
  },
  start() {
    bus.addEventListener('message', e => this.handle(e.data || {}));
    if (navigator.locks) navigator.locks.request('gate-desk-reader', () => this.loop());
    else this.loop();
  },
  me: uid(),
  // Claims the next item for this window. A "reading" item whose reader stopped sending heartbeats
  // (window closed, different browser) is taken over after a minute.
  async claim() {
    let got = null;
    await updateHub(h => {
      const now = Date.now(), stale = q => q.status === 'reading' && (!q.beat || now - q.beat > 60000);
      const q = (h.queue || []).find(x => stale(x) || (x.status === 'reading' && x.owner === this.me)) || (h.queue || []).find(x => x.status === 'queued');
      if (q) { q.status = 'reading'; q.owner = this.me; q.beat = now; delete q.stop; got = Object.assign({}, q); }
    });
    return got;
  },
  async loop() {
    for (;;) {
      let item = null;
      try { item = await this.claim(); } catch {}
      if (item) await this.run(item);
      else await new Promise(r => { this._wake = r; setTimeout(r, 10000); });
    }
  },
  async run(item) {
    this.running = item.id; this.ctl = new AbortController(); this.stopAs = 'paused';
    const setItem = patch => updateHub(h => {
      const q = (h.queue || []).find(x => x.id === item.id);
      if (!q) return;
      Object.assign(q, patch);
      if (q.stop && this.ctl && !this.ctl.signal.aborted) { this.stopAs = q.stop === 'cancel' ? 'cancelled' : 'paused'; delete q.stop; this.ctl.abort(); }
    });
    const say = extra => announce(Object.assign({ type: 'reader', id: item.id, siteId: item.siteId, name: item.name }, extra));
    let buffer = {}, lastFlush = Date.now(), total = 0;
    const flush = async () => {
      const b = buffer; buffer = {};
      if (!Object.keys(b).length) return;
      await updateData(item.siteId, cur => { cur.pages = cur.pages || []; for (const [i, r] of Object.entries(b)) cur.pages[+i] = r; });
      lastFlush = Date.now();
      // Any formulas on these pages go into the formula book.
      const subj = await siteSubject(item.siteId);
      await collectMany(Object.entries(b).map(([i, r]) => ({ md: r.md, subject: lessonSubject(r.md) || subj,
        source: { kind: 'page', label: `${prettyName(item.name)} p.${+i + 1}`, href: `site.html?id=${item.siteId}&page=${+i + 1}#digitize` } })));
      announce({ type: 'pages', siteId: item.siteId });
      // Pages carrying a GATE year marking get scanned for PYQs.
      if (typeof PyqScan !== 'undefined') PyqScan.queuePages(item.siteId, item.name, Object.entries(b).map(([i, r]) => ({ n: +i + 1, md: r.md })));
    };
    try {
      await setItem({ error: null, beat: Date.now() });
      say({ status: 'reading', k: 0, total: 0, note: 'Opening the file…' });
      const beat = setInterval(() => setItem({ beat: Date.now() }), 20000);   // keeps the claim while a slow page is read
      this._beat = beat;
      const book = await Book.open(item.siteId);
      const data = await Store.getData(item.siteId);
      const have = data.pages || [];
      const from = Math.max(1, item.from), to = Math.min(book.pages.length, item.to);
      const todo = [];
      for (let n = from; n <= to; n++) if (!(have[n - 1] && have[n - 1].md != null)) todo.push(n - 1);
      total = todo.length;
      const t0 = Date.now();
      const prevPage = todo.length && have[todo[0] - 1] ? have[todo[0] - 1] : null;
      // Uploaded question papers: a page that comes out garbled is read again carefully before its questions are taken.
      const isPaper = !!((await Store.getHub()).pyqSources || {})[item.siteId];
      await readPages(book.pages, todo, {
        mode: item.mode, useOcr: item.ocr !== false, signal: this.ctl.signal, prev: prevPage,
        onPage: async (i, r, k) => {
          if (isPaper) r = await recheckPage(book.pages[i], i + 1, book.pages.length, r, { signal: this.ctl.signal, onStage: note => say({ status: 'reading', k, total, page: i + 1, note }) });
          buffer[i] = r;
          const eta = (Date.now() - t0) / 1000 / (k + 1) * (total - k - 1);
          say({ status: 'reading', k: k + 1, total, page: i + 1, eta });
          if (Date.now() - lastFlush > 12000 || k === total - 1) await flush();
          setItem({ k: k + 1, total, beat: Date.now() });
        },
      });
      await flush();
      await setItem({ status: 'done', k: total, total, finished: new Date().toISOString() });
      say({ status: 'done', k: total, total });
      Notify.show(`${prettyName(item.name)} is ready.`, total ? `I've read ${total} page${total > 1 ? 's' : ''}. Open it to start learning.` : 'Every page was already read.');
    } catch (e) {
      await flush().catch(() => {});
      if (e.name === 'AbortError') {
        if (this.stopAs === 'cancelled') await updateHub(h => { h.queue = (h.queue || []).filter(x => x.id !== item.id); });
        else await setItem({ status: 'paused' });
        say({ status: this.stopAs });
      } else {
        console.error(e);
        await setItem({ status: 'error', error: e.message });
        say({ status: 'error', error: e.message });
        Notify.show(`Couldn't finish reading ${prettyName(item.name)}.`, e.message, 'bad');
      }
    } finally { clearInterval(this._beat); this.running = null; this.ctl = null; }
  },
};

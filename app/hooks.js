// Memory hooks: one vivid everyday analogy per lesson, drawn as a picture by the local image generator
// (stable-diffusion.cpp + SDXL-Turbo, through the app's server; see tools\sd). The picture is a memory aid, never a
// technical diagram: image models garble labels and structure, so exact diagrams stay with viz.js and mermaid.
// A hook is saved with its lesson: { url, caption, analogy, prompt, at }.

const MemoryHook = {
  _status: null,
  async status(force = false) {
    if (!this._status || force || (!this._status.installed && Date.now() - this._status.at > 30000)) {
      try { this._status = { ...(await (await fetch('/api/imagegen/status')).json()), at: Date.now() }; } catch { this._status = { installed: false, at: Date.now() }; }
    }
    return this._status;
  },
  // The analogy and the picture description, from the lesson.
  async idea(topic, md, signal) {
    const j = parseJSON(await ollamaChat([
      { role: 'system', content: 'You create a memory hook for a GATE CS topic: ONE vivid everyday analogy that captures the core idea so a student remembers it, and the scene of a picture showing that analogy. analogy: 1-2 sentences mapping the analogy onto the concept ("The cache is the small desk next to a huge library: what you used recently stays on the desk"); use ONE consistent set of everyday objects throughout (never mix, e.g. chopsticks and forks), and make every part of the analogy match the concept. caption: a short title naming the analogy, at most 7 words, like "Cache = the desk beside the library". scene: 15-40 words describing ONLY what is visible: the people, objects, where they are and what they are doing, e.g. "a student at a small desk with a few open books, next to enormous library shelves stretching back, a librarian fetching a book from a far shelf". No text, letters, numbers, labels, screens or diagrams. Do not describe the art style. The analogy must be accurate for the concept. Return JSON.' },
      { role: 'user', content: `Topic: ${topic}\n\nLesson (for context):\n${plainText(md || '').slice(0, 2500)}` },
    ], { signal, temperature: 0.7, maxTokens: 600, format: { type: 'object', required: ['analogy', 'caption', 'scene'], properties: { analogy: { type: 'string' }, caption: { type: 'string' }, scene: { type: 'string' } } } }));
    if (!j.analogy) throw new Error('No idea for a picture came back.');
    // A scene that is really just style words ("flat vector illustration…") draws nothing useful: use the caption instead.
    const styleOnly = s => String(s || '').replace(/\b(flat|vector|illustration|friendly|soft|colou?rs?|clean|background|style|cartoon|high|quality|minimal|simple)\b|[,.]/gi, '').trim().split(/\s+/).filter(Boolean).length < 5;
    j.prompt = styleOnly(j.scene) ? `${j.caption}, ${String(j.analogy).split(/[:;.]/)[0]}` : j.scene;
    j.caption = String(j.caption || '').split(/\s+/).slice(0, 8).join(' ');
    return j;
  },
  // Picture styles (Settings → Pictures). SDXL-Turbo follows short, concrete style words best.
  STYLES: {
    flat: { label: 'Flat illustration', words: 'flat vector illustration, clean simple shapes, soft pastel colours, plain light background, friendly, minimal, high quality' },
    storybook: { label: 'Storybook watercolour', words: 'soft watercolour storybook illustration, gentle colours, light paper texture, warm and friendly, high quality' },
    clay: { label: '3D clay', words: 'cute 3D clay render, soft studio lighting, pastel colours, rounded shapes, plain background, high quality' },
    sketch: { label: 'Textbook sketch', words: 'clean ink line drawing with a light colour wash, textbook illustration, white background, high quality' },
  },
  style() { return this.STYLES[Cfg.get('hookstyle', 'flat')] || this.STYLES.flat; },
  // 768 px with 6 steps: sharper and closer to the scene than 512 / 4, about 5 s once the engine is loaded.
  async draw(prompt, signal, seed = -1) {
    const r = await fetch('/api/imagegen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ prompt: `${prompt}, ${this.style().words}`, negative: 'text, letters, words, numbers, watermark, logo, blurry, deformed hands, extra fingers', width: 768, height: 768, steps: 6, seed }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'The picture could not be made.');
    return j.url;
  },
  // The vision model looks at a picture: does it show the scene, and is there garbled text in it? Score 0-10.
  async judge(url, scene, signal) {
    try {
      const blob = await (await fetch(url)).blob();
      const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
      // Two steps: the small vision model scores badly when made to answer in JSON straight from the image
      // (it returns default zeros), but describes pictures well. So: describe, then compare the description.
      const seen = await ollamaChat([
        { role: 'user', content: 'Describe this picture in 2-3 sentences: the people, objects and what they are doing. Say whether any letters or writing are clearly visible, and whether anything looks badly malformed (melted faces, extra limbs).', images: [b64] },
      ], { signal, model: visionModel(), temperature: 0, maxTokens: 300 });
      // A short reason before the score (asked for a bare number, the model returns 0 whatever the picture shows).
      const j = parseJSON(await ollamaChat([
        { role: 'system', content: 'You check whether a picture shows the scene it was meant to show, using a description of the picture. reason: one short sentence comparing the main people and objects. score: 0-10, where 10 = the main people and objects are there, 5 = only some of them, 0 = a different scene. Small details (exact gestures, counts, poses) matter little. text: true only if the description says clear letters or words are visible. broken: true only if it says something is badly malformed. Return JSON.' },
        { role: 'user', content: `Intended scene: ${scene}\n\nDescription of the picture: ${seen}` },
      ], { signal, temperature: 0, maxTokens: 300, format: { type: 'object', required: ['reason', 'score', 'text', 'broken'], properties: { reason: { type: 'string' }, score: { type: 'integer' }, text: { type: 'boolean' }, broken: { type: 'boolean' } } } }));
      return Math.max(0, Math.min(10, +j.score || 0)) - (j.text ? 3 : 0) - (j.broken ? 4 : 0);
    } catch (e) { if (e.name === 'AbortError') throw e; return null; }   // no vision model: no score
  },
  async make(topic, md, signal, onStage = () => {}) {
    onStage('Thinking of an analogy');
    const idea = await this.idea(topic, md, signal);
    // Two pictures with different seeds; the vision model keeps the better one, and one more try if both are poor.
    const tries = [];
    for (let k = 0; k < 3; k++) {
      if (k === 2 && tries.some(t => t.score == null || t.score >= 6)) break;
      onStage(k === 0 ? 'Drawing it (the first picture also loads the image model)' : k === 1 ? 'Drawing a second version' : 'Both were weak: drawing a simpler version');
      const prompt = k === 2 ? `${idea.prompt}, simple composition, few objects, clear and uncluttered` : idea.prompt;
      const url = await this.draw(prompt, signal, Math.floor(Math.random() * 1e9));
      onStage('Checking the picture matches the analogy');
      tries.push({ url, score: await this.judge(url, idea.prompt, signal) });
    }
    const best = tries.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
    // the losers are deleted, so only the kept picture stays on disk
    for (const t of tries) if (t !== best) fetch('/api/image/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: t.url }) }).catch(() => {});
    return { url: best.url, caption: idea.caption, analogy: idea.analogy, prompt: idea.prompt, score: best.score, style: Cfg.get('hookstyle', 'flat'), at: new Date().toISOString() };
  },
  // Click the picture: see it large.
  enlarge(hook) {
    const ov = document.createElement('div');
    ov.className = 'dg-full';
    ov.innerHTML = `<div class="dg-full-box hook-full"><button class="dg-close" title="Close (Esc)">✕</button><img src="${escapeHtml(hook.url)}" alt=""><div class="hook-full-cap"><b>${escapeHtml(hook.caption || '')}</b><p>${escapeHtml(hook.analogy || '')}</p></div></div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    ov.onclick = e => { if (e.target === ov || e.target.classList.contains('dg-close')) close(); };
    document.addEventListener('keydown', esc);
    document.body.appendChild(ov);
  },
  // The card above a lesson. hook may be null (then a button to draw one, if the generator is installed).
  html(hook, installed) {
    if (hook && hook.url) return `<div class="card hook"><button class="hook-img" title="See it larger"><img src="${escapeHtml(hook.url)}" alt="${escapeHtml(hook.caption || 'Memory hook')}" loading="lazy"></button>
      <div class="hook-body"><div class="eyebrow">Memory hook</div><h3>${escapeHtml(hook.caption || '')}</h3><p class="hook-analogy">${escapeHtml(hook.analogy || '')}</p>
      <div class="row hook-foot"><span class="pill" title="AI-generated analogy picture${hook.score != null ? `, ${Math.max(0, hook.score)}/10 match by the vision model` : ''}. Exact diagrams are in the lesson.">AI image</span><button class="link small hook-again">${icon('refresh')} Redraw</button></div></div></div>`;
    if (!installed) return '';
    return `<div class="hook-empty-row"><button class="link small hook-go" title="An everyday-analogy picture for this lesson (~30 s)">${icon('image')} Memory hook</button></div>`;
  },
  loadingHtml: '<div class="card hook hook-loading"><div class="hook-shimmer"></div><div class="hook-body"><div class="eyebrow">Memory hook</div><p class="hook-stage">Starting&hellip;</p><div class="hook-bar"><span></span></div></div></div>',
  // Mounts the card into box; save(hook) stores it with the lesson.
  async mount(box, { topic, md, hook, save }) {
    if (!box) return;
    // Analogy pictures are optional (Settings → Memory-hook pictures → Show analogy pictures, off by default): the
    // lesson's main visual is its exact topic animation (anim.js). Saved pictures are kept, just not shown.
    if (Cfg.get('showanalogy', 'off') !== 'on') { box.innerHTML = ''; return; }
    const st = await this.status();
    let cur = hook;
    box.innerHTML = this.html(cur, st.installed);
    const go = () => {
      box.innerHTML = this.loadingHtml;
      let made = null, n = 0;
      runJob(`Memory hook: ${topic}`, async signal => { made = await this.make(topic, md, signal, t => { jobLabel(`Memory hook: ${t}`, signal); const s = $('.hook-stage', box); if (s) s.textContent = t + '…'; const b = $('.hook-bar span', box); if (b) b.style.width = `${Math.min(95, 12 + 16 * ++n)}%`; }); }, async () => {
        if (made) {
          const old = cur && cur.url;
          await save(made); cur = made;
          if (old && old !== made.url) fetch('/api/image/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: old }) }).catch(() => {});
        }
        box.innerHTML = this.html(cur, st.installed);
        wire();
      });
    };
    const wire = () => {
      const a = $('.hook-go', box) || $('.hook-again', box); if (a) a.onclick = go;
      const im = $('.hook-img', box); if (im) im.onclick = () => this.enlarge(cur);
    };
    wire();
    // Automatic: Settings → "Draw a memory hook for new lessons".
    if (!hook && st.installed && md && Cfg.get('autohook', 'off') === 'on' && !box.dataset.auto) { box.dataset.auto = '1'; go(); }
  },
};

(() => {
  const KW = (window.__KW_CONSOLE_PLAYER__ ||= {});
  if (KW.running) {
    console.warn("[KW] ya está corriendo. stop: window.__KW_CONSOLE_PLAYER__.stop()");
    return;
  }
  KW.running = true;

  const CFG = {
    debug: true,
    rehookMs: 1000,
    pollMsTrack: 250,
    pollMsVisual: 450,
    visualReselectMs: 1200,
    keepControlsMs: 850,
    cooldownMs: 650,
    burstMs: 450,
    autoOpenPanelOnSubs: false
  };

  const log = (...a) => CFG.debug && console.log("[KW]", ...a);
  const normalize = (s) => String(s ?? "").replace(/\u00A0/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  let active = false;
  let modo = "lector";       // "lector" | "sintetizador" | "off"
  let fuente = "auto";       // "auto" | "track" | "visual"
  let trackIndex = 0;
  let effectiveFuente = "visual";

  let voiceES = null;
  let liveRegion = null;

  let currentVideo = null;
  let currentTrack = null;

  let visualNode = null;
  let visualSelectors = null;
  let visualObserver = null;
  let visualObserverActive = false;

  let lastEmitText = "";
  let lastEmitAt = 0;
  let lastTrackSeen = "";
  let lastVisualSeen = "";

  let overlayRoot = null, overlayPanel = null, overlayPill = null, overlayStatus = null, overlayText = null, overlayModo = null, overlayFuente = null, overlayTrackSel = null;

  let timers = [];

  const getPlatform = () => (location.hostname.includes("flow.com.ar") ? "flow" : "generic");

  const listVoicesDebug = () => {
    try {
      if (typeof speechSynthesis === "undefined") return { ok: false, reason: "speechSynthesis undefined" };
      const voces = speechSynthesis.getVoices() || [];
      return { ok: true, count: voces.length, langs: voces.slice(0, 15).map(v => v.lang).filter(Boolean) };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  };

  const cargarVozES = () => {
    try {
      if (typeof speechSynthesis === "undefined") return;
      const voces = speechSynthesis.getVoices() || [];
      voiceES =
        voces.find(v => (v.lang || "").toLowerCase().startsWith("es-ar")) ||
        voces.find(v => (v.lang || "").toLowerCase().startsWith("es")) ||
        null;

      if (!voiceES) {
        speechSynthesis.onvoiceschanged = () => {
          const v2 = speechSynthesis.getVoices() || [];
          voiceES =
            v2.find(v => (v.lang || "").toLowerCase().startsWith("es-ar")) ||
            v2.find(v => (v.lang || "").toLowerCase().startsWith("es")) ||
            null;
        };
      }
    } catch {}
  };

  const asegurarLiveRegion = () => {
    if (liveRegion) return liveRegion;
    liveRegion = document.createElement("div");
    liveRegion.id = "kw-console-live";
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("aria-atomic", "true");
    Object.assign(liveRegion.style, { position: "fixed", left: "-9999px", top: "0", width: "1px", height: "1px", overflow: "hidden", zIndex: 999999999 });
    document.body.appendChild(liveRegion);
    return liveRegion;
  };

  const pushToLive = (t) => {
    const lr = asegurarLiveRegion();
    lr.textContent = "";
    setTimeout(() => (lr.textContent = t), 10);
  };

  const speakTTS = (t) => {
    try {
      if (typeof speechSynthesis === "undefined") return { ok: false, reason: "speechSynthesis undefined" };
      cargarVozES();
      if (!voiceES) return { ok: false, reason: "No encuentro voz ES" };
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.voice = voiceES;
      u.lang = voiceES.lang || "es-AR";
      u.onerror = (ev) => console.warn("[KW] TTS error:", ev?.error || ev);
      speechSynthesis.speak(u);
      return { ok: true, selectedLang: voiceES.lang, speaking: speechSynthesis.speaking, pending: speechSynthesis.pending, paused: speechSynthesis.paused };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  };

  const shouldEmit = (t) => {
    const now = Date.now();
    if (!t) return false;
    if (t === lastEmitText && (now - lastEmitAt) < CFG.burstMs) return false;
    if (t === lastEmitText && (now - lastEmitAt) < CFG.cooldownMs) return false;
    lastEmitText = t;
    lastEmitAt = now;
    return true;
  };

  const shouldReadNow = () => {
    if (!active) return false;
    if (!currentVideo) return true;
    try { if (currentVideo.paused || currentVideo.ended) return false; } catch {}
    return true;
  };

  const read = (text) => {
    const t = normalize(text);
    if (!t) return;
    if (!shouldEmit(t)) return;

    if (overlayRoot) overlayText.textContent = t;

    if (!active || modo === "off") return;
    if (!shouldReadNow()) return;

    if (modo === "lector") return pushToLive(t);

    const res = speakTTS(t);
    if (!res.ok) {
      console.warn("[KW] TTS FALLÓ:", res);
      console.warn("[KW] Voices debug:", listVoicesDebug());
      try {
        console.warn("[KW] speechSynthesis state:", {
          speaking: speechSynthesis.speaking,
          pending: speechSynthesis.pending,
          paused: speechSynthesis.paused
        });
      } catch {}
    } else {
      CFG.debug && console.log("[KW] TTS OK:", res);
    }
  };

  const findVideos = () => Array.from(document.querySelectorAll("video"));
  const pickMainVideo = () => {
    const vids = findVideos();
    if (!vids.length) return null;
    return vids
      .map(v => {
        const r = v.getBoundingClientRect();
        return { v, a: Math.max(0, r.width) * Math.max(0, r.height) };
      })
      .sort((a,b) => b.a - a.a)[0].v;
  };

  const platformSelectors = () => {
    if (getPlatform() === "flow") return [".theoplayer-ttml-texttrack-", ".theoplayer-texttracks", ".theoplayer-texttracks *"];
    return ["[class*='subtitle']", "[class*='caption']", "[aria-live='polite']", "[role='status']"];
  };

  const looksLikeNoise = (node, text) => {
    const t = normalize(text);
    if (!t) return true;
    if (t.length < 2 || t.length > 260) return true;
    const tag = (node?.tagName || "").toUpperCase();
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;
    return false;
  };

  const pickBestVisualNode = () => {
    const nodes = [];
    for (const sel of (visualSelectors || [])) {
      try { document.querySelectorAll(sel).forEach(n => nodes.push(n)); } catch {}
    }
    const ttml = nodes.find(n => (n.className || "").toString().includes("theoplayer-ttml-texttrack-"));
    if (ttml) return ttml;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const t = normalize(n.textContent);
      if (!looksLikeNoise(n, t)) return n;
    }
    return null;
  };

  const stopVisualObs = () => {
    try { visualObserver?.disconnect?.(); } catch {}
    visualObserver = null;
    visualObserverActive = false;
  };

  const startVisual = () => {
    visualSelectors = platformSelectors();
    const next = pickBestVisualNode();
    if (next) visualNode = next;
    stopVisualObs();

    if (visualNode) {
      visualObserver = new MutationObserver(() => {
        if (!shouldReadNow()) return;
        if (effectiveFuente !== "visual") return;
        const t = normalize(visualNode.textContent);
        if (!t || looksLikeNoise(visualNode, t)) return;
        if (t === lastVisualSeen) return;
        lastVisualSeen = t;
        read(t);
      });
      try {
        visualObserver.observe(visualNode, { childList: true, subtree: true, characterData: true });
        visualObserverActive = true;
        log("VISUAL observer listo en", visualNode);
      } catch {}
    }
  };

  const readActiveCues = (track) => {
    try {
      const active = track?.activeCues ? Array.from(track.activeCues) : [];
      return normalize(active.map(c => c.text || "").join(" / "));
    } catch { return ""; }
  };

  const pickBestTrack = (v) => {
    const list = Array.from(v?.textTracks || []);
    if (!list.length) return null;
    const idx = clamp(trackIndex, 0, list.length - 1);
    return list[idx] || list[0] || null;
  };

  const attachTrack = (t) => {
    if (!t) return;
    try { if (t.mode === "disabled") t.mode = "hidden"; } catch {}
    try { t.oncuechange = null; } catch {}
    t.oncuechange = () => {
      if (!shouldReadNow()) return;
      if (effectiveFuente !== "track") return;
      const txt = readActiveCues(t);
      if (!txt || txt === lastTrackSeen) return;
      lastTrackSeen = txt;
      read(txt);
    };
  };

  // Flow in-place labeling
  const normName = (el) => normalize(el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.textContent || "");
  const isVisibleEl = (el) => {
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 14 || r.height < 14) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity || 1) < 0.05) return false;
    return true;
  };
  const intersectsVideo = (el, vr) => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(vr.right, r.right) - Math.max(vr.left, r.left));
    const y = Math.max(0, Math.min(vr.bottom, r.bottom) - Math.max(vr.top, r.top));
    return (x * y) > 120;
  };

  const labelFlowControls = () => {
    if (getPlatform() !== "flow") return 0;
    const v = currentVideo || pickMainVideo();
    if (!v) return 0;
    const vr = v.getBoundingClientRect();

    const all = Array.from(document.querySelectorAll("button,[role='button'],[tabindex]"))
      .filter(el => isVisibleEl(el) && intersectsVideo(el, vr));

    const items = all.map(el => {
      const r = el.getBoundingClientRect();
      return { el, cx: r.left + r.width/2, cy: r.top + r.height/2, w: r.width, h: r.height, name: normName(el), testId: el.getAttribute("data-testid") || "", cls: String(el.className||"") };
    });

    items.sort((a,b) => a.cy - b.cy);
    const rows = [];
    for (const it of items) {
      let placed = false;
      for (const row of rows) {
        if (Math.abs(row.cy - it.cy) < 16) { row.items.push(it); row.cy = (row.cy + it.cy)/2; placed = true; break; }
      }
      if (!placed) rows.push({ cy: it.cy, items: [it] });
    }
    rows.forEach(r => r.items.sort((a,b)=>a.cx-b.cx));

    let labeled = 0;
    for (const row of rows) {
      const big = row.items.filter(x => x.w >= 60 && x.h >= 32 && x.w <= 110);
      if (big.length >= 3) {
        const labels = ["Reiniciar","Atrasar 10 segundos","Pausar/Reproducir","Adelantar 10 segundos","Episodio siguiente"];
        big.sort((a,b)=>a.cx-b.cx);
        for (let i=0;i<big.length && i<labels.length;i++){
          if (big[i].name) continue;
          big[i].el.setAttribute("aria-label", labels[i]);
          big[i].el.setAttribute("tabindex", big[i].el.getAttribute("tabindex") || "0");
          big[i].el.setAttribute("role", big[i].el.getAttribute("role") || "button");
          labeled++;
        }
      }
    }

    for (const row of rows) {
      const small = row.items.filter(x => x.w <= 60 && x.h <= 60);
      if (small.length >= 3) {
        for (const s of small) {
          if (s.name) continue;
          let label = "Control del reproductor";
          if (s.testId === "volume-btn") label = "Volumen / Silenciar";
          s.el.setAttribute("aria-label", label);
          s.el.setAttribute("tabindex", s.el.getAttribute("tabindex") || "0");
          s.el.setAttribute("role", s.el.getAttribute("role") || "button");
          labeled++;
        }
      }
    }
    return labeled;
  };

  const keepControlsTick = () => {
    if (!active) return;
    const v = currentVideo || pickMainVideo();
    if (!v) return;
    if (!["flow"].includes(getPlatform())) return;

    try {
      const r = v.getBoundingClientRect();
      const x = r.left + r.width * 0.5;
      const y = r.top + r.height * 0.9;
      v.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
      v.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));
      if (document.activeElement !== v) {
        v.setAttribute("tabindex", v.getAttribute("tabindex") || "-1");
        v.focus?.({ preventScroll: true });
      }
    } catch {}

    if (getPlatform() === "flow") {
      const n = labelFlowControls();
      if (n && CFG.debug) console.log("[KW] FlowMode: etiqueté", n, "controles del player.");
    }
  };

  const buildUI = () => {
    if (overlayRoot) return;

    overlayRoot = document.createElement("div");
    overlayRoot.id = "kw-console-root";
    Object.assign(overlayRoot.style, { position:"fixed", right:"14px", bottom:"14px", zIndex:999999999, fontFamily:"system-ui, Segoe UI, Arial" });

    overlayPanel = document.createElement("div");
    Object.assign(overlayPanel.style, { display:"none", marginBottom:"10px", padding:"12px 14px", borderRadius:"12px", background:"rgba(0,0,0,0.78)", color:"#fff", maxWidth:"75vw", boxShadow:"0 8px 24px rgba(0,0,0,0.25)" });

    overlayStatus = document.createElement("div");
    overlayStatus.style.opacity = ".9";
    overlayStatus.style.fontSize = "13px";
    overlayStatus.style.marginBottom = "6px";

    overlayText = document.createElement("div");
    overlayText.style.whiteSpace = "pre-wrap";
    overlayText.style.fontSize = "16px";
    overlayText.style.lineHeight = "1.35";

    overlayModo = document.createElement("select");
    overlayModo.innerHTML = `<option value="off">Desactivado</option><option value="sintetizador">Voz</option><option value="lector">Lector</option>`;
    overlayFuente = document.createElement("select");
    overlayFuente.innerHTML = `<option value="auto">Auto</option><option value="track">TRACK</option><option value="visual">VISUAL</option>`;
    overlayTrackSel = document.createElement("select");
    overlayTrackSel.innerHTML = `<option value="0">Pista 1</option>`;

    const row = document.createElement("div");
    Object.assign(row.style, { display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", marginTop:"10px" });
    row.appendChild(overlayModo);
    row.appendChild(overlayFuente);

    overlayPanel.appendChild(overlayStatus);
    overlayPanel.appendChild(overlayText);
    overlayPanel.appendChild(row);
    overlayPanel.appendChild(overlayTrackSel);

    overlayPill = document.createElement("button");
    overlayPill.textContent = "KW";
    overlayPill.setAttribute("aria-label","Abrir KathWare Media Player (consola)");
    Object.assign(overlayPill.style, { width:"46px", height:"46px", borderRadius:"999px", border:"0", cursor:"pointer", background:"rgba(0,0,0,0.78)", color:"#fff", fontWeight:"700", boxShadow:"0 8px 24px rgba(0,0,0,0.25)" });

    overlayPill.onclick = () => (overlayPanel.style.display = overlayPanel.style.display === "none" ? "block" : "none");
    overlayModo.onchange = () => { modo = overlayModo.value; log("Modo =>", modo); };
    overlayFuente.onchange = () => { fuente = overlayFuente.value; restart(); log("Fuente =>", fuente); };
    overlayTrackSel.onchange = () => { trackIndex = Number(overlayTrackSel.value)||0; restart(); };

    overlayRoot.appendChild(overlayPanel);
    overlayRoot.appendChild(overlayPill);
    document.body.appendChild(overlayRoot);

    updateUI();
  };

  const destroyUI = () => {
    try { overlayRoot?.remove?.(); } catch {}
    overlayRoot = overlayPanel = overlayPill = overlayStatus = overlayText = overlayModo = overlayFuente = overlayTrackSel = null;
  };

  const updateUI = () => {
    if (!overlayRoot) return;
    overlayModo.value = modo;
    overlayFuente.value = fuente;
    overlayStatus.textContent = `${active ? "🟢 ON" : "🔴 OFF"} | ${fuente}→${effectiveFuente} | ${getPlatform()}`;
  };

  const restart = () => {
    lastTrackSeen = "";
    lastVisualSeen = "";
    stopVisualObs();
    visualNode = null;
    visualSelectors = null;
    try { if (currentTrack) currentTrack.oncuechange = null; } catch {}
    currentTrack = null;
  };

  const rehookTick = () => {
    const v = pickMainVideo();
    if (v !== currentVideo) {
      currentVideo = v;
      restart();
    }
    if (!active) return;

    const hasTracks = !!(currentVideo?.textTracks && currentVideo.textTracks.length);
    effectiveFuente = (fuente === "auto") ? (hasTracks ? "track" : "visual") : (fuente === "track" ? "track" : "visual");

    if (effectiveFuente === "track") {
      const t = pickBestTrack(currentVideo);
      if (t && t !== currentTrack) { currentTrack = t; attachTrack(t); }
    } else {
      startVisual();
    }

    updateUI();
    if (getPlatform() === "flow") labelFlowControls();
  };

  const pollTrack = () => {
    if (!active || !shouldReadNow()) return;
    if (effectiveFuente !== "track" || !currentTrack) return;
    const t = readActiveCues(currentTrack);
    if (!t || t === lastTrackSeen) return;
    lastTrackSeen = t;
    read(t);
  };

  const pollVisual = () => {
    if (!active || !shouldReadNow()) return;
    if (effectiveFuente !== "visual") return;
    if (!visualSelectors) visualSelectors = platformSelectors();
    if (!visualNode) { visualNode = pickBestVisualNode(); if (visualNode) startVisual(); return; }
    if (visualObserverActive) return;
    const t = normalize(visualNode.textContent);
    if (!t || looksLikeNoise(visualNode, t)) return;
    if (t === lastVisualSeen) return;
    lastVisualSeen = t;
    read(t);
  };

  const startTimers = () => {
    timers.push(setInterval(rehookTick, CFG.rehookMs));
    timers.push(setInterval(pollTrack, CFG.pollMsTrack));
    timers.push(setInterval(pollVisual, CFG.pollMsVisual));
    timers.push(setInterval(() => {
      if (!active || effectiveFuente !== "visual") return;
      const next = pickBestVisualNode() || visualNode;
      if (next && next !== visualNode) { visualNode = next; startVisual(); }
    }, CFG.visualReselectMs));
    timers.push(setInterval(keepControlsTick, CFG.keepControlsMs));
  };

  const stopTimers = () => { timers.forEach(t => clearInterval(t)); timers = []; };

  const toggle = () => {
    active = !active;
    if (active) {
      buildUI();
      cargarVozES();
      startTimers();
      rehookTick();
      log("ON ✅  Hotkey: Ctrl+Shift+K (toggle UI+engine)");
    } else {
      stopTimers();
      stopVisualObs();
      try { speechSynthesis?.cancel?.(); } catch {}
      try { liveRegion?.remove?.(); } catch {}
      liveRegion = null;
      destroyUI();
      log("OFF 🛑");
    }
    updateUI();
  };

  const onKey = (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key || "").toLowerCase() === "k") {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }
  };
  document.addEventListener("keydown", onKey, true);

  KW.stop = () => {
    try { document.removeEventListener("keydown", onKey, true); } catch {}
    if (active) toggle();
    KW.running = false;
    console.log("[KW] stop ok.");
  };

  console.log("[KW] listo. Hotkey: Ctrl+Shift+K  | stop: window.__KW_CONSOLE_PLAYER__.stop()");
})();

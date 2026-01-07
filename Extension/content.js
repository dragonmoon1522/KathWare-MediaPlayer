// ====================================================
// KathWare Media Player - content.js (MV3) - v2.0.0
// Engine v4-ish (rehook + polling + overlay pill + TRACK/VISUAL)
// - TRACK: lee video.textTracks (oncuechange + poll activeCues fallback)
// - VISUAL: lee captions por selectores por plataforma + observer (poll solo fallback)
// - Overlay: pill siempre disponible, panel se expande con subtítulos o click
// - Controles de teclado estilo HTML5 cuando aplica (no secuestra al escribir)
// - ON/OFF: via command (background) + fallback hotkey in-page (configurable)
// Compat: Chromium (chrome.*) + Firefox (browser.*)
// ====================================================

(() => {
  if (window.__KATHWARE_MEDIA_PLAYER__?.loadedAt) return;
  window.__KATHWARE_MEDIA_PLAYER__ = { loadedAt: Date.now(), version: "2.0.0" };

  const api =
    (typeof chrome !== "undefined" && chrome?.runtime) ? chrome :
    (typeof browser !== "undefined" && browser?.runtime) ? browser :
    null;

  const CFG = {
    debug: true,

    // Engine timings
    pollMsTrack: 250,
    rehookMs: 1000,
    pollMsVisual: 450,
    cooldownMs: 650,
    burstMs: 450,

    // Visual reselect (para SPA que recrea captions)
    visualReselectMs: 1200,

    // keyboard controls
    seekSmall: 5,
    seekBig: 10,
    volStep: 0.05,

    // Hotkey fallback in-page (por si commands no está o choca)
    hotkeys: {
      toggle: { ctrl: true, alt: true, shift: false, key: "k" },
      mode:   { ctrl: true, alt: true, shift: false, key: "l" },
      panel:  { ctrl: true, alt: true, shift: false, key: "o" },
    },
  };

  const log = (...a) => CFG.debug && console.log("[KathWare]", ...a);

  // -------------------- Estado (settings) --------------------
  let extensionActiva = false;

  // "off" | "sintetizador" | "lector"
  let modoNarradorGlobal = "lector";

  // "auto" | "track" | "visual"
  let fuenteSubGlobal = "auto";
  let trackIndexGlobal = 0;

  // Fuente efectiva real (pipeline)
  // "track" | "visual"
  let effectiveFuente = "visual";

  // Voice
  let voiceES = null;

  // Live region
  let liveRegion = null;

  // Engine refs
  let currentVideo = null;
  let currentTrack = null;

  // Timers/observers
  let pollTimerTrack = null;
  let rehookTimer = null;
  let pollTimerVisual = null;
  let visualReselectTimer = null;
  let visualObserver = null;
  let visualObserverActive = false;

  // Visual node/sel
  let visualNode = null;
  let visualSelectors = null;

  // Overlay
  let overlayRoot = null;
  let overlayPanel = null;
  let overlayPill = null;
  let overlayStatus = null;
  let overlayText = null;
  let overlayTrackSelect = null;
  let overlayModoSelect = null;
  let overlayFuenteSelect = null;

  // Toast
  let toastEl = null;
  let toastTimer = null;

  // Dedupe
  let lastEmitText = "";
  let lastEmitAt = 0;

  // -------------------- Utils --------------------
  const normalize = (s) =>
    String(s ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const isTyping = () => {
    const ae = document.activeElement;
    if (!ae) return false;
    const tag = (ae.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (ae.isContentEditable) return true;
    return false;
  };

  function getPlatform() {
    const h = location.hostname.toLowerCase();
    if (h.includes("netflix")) return "netflix";
    if (h.includes("disneyplus") || h.includes("disney")) return "disney";
    if (h.includes("hbomax") || h.includes("max.com") || h.includes("play.hbomax.com")) return "max";
    if (h.includes("youtube")) return "youtube";
    if (h.includes("primevideo") || h.includes("amazon")) return "prime";
    if (h.includes("paramountplus")) return "paramount";
    if (h.includes("flow.com.ar")) return "flow";
    return "generic";
  }

  function platformLabel(p) {
    return ({
      netflix: "Netflix",
      disney: "Disney+",
      max: "Max",
      youtube: "YouTube",
      prime: "Prime Video",
      paramount: "Paramount+",
      flow: "Flow",
      generic: "Sitio"
    })[p] || "Sitio";
  }

  // -------------------- Storage --------------------
  function cargarConfigDesdeStorage(cb) {
    if (!api?.storage?.local) return cb && cb();

    api.storage.local.get(
      ["modoNarrador", "fuenteSub", "trackIndex", "debug", "hotkeys"],
      (data) => {
        try {
          if (typeof data?.debug === "boolean") CFG.debug = data.debug;
          if (data?.modoNarrador) modoNarradorGlobal = data.modoNarrador;
          if (data?.fuenteSub) fuenteSubGlobal = data.fuenteSub;

          if (typeof data?.trackIndex !== "undefined") {
            const n = Number(data.trackIndex);
            trackIndexGlobal = Number.isFinite(n) ? n : 0;
          }

          if (data?.hotkeys && typeof data.hotkeys === "object") {
            CFG.hotkeys = { ...CFG.hotkeys, ...data.hotkeys };
          }
        } catch (_) {}
        cb && cb();
      }
    );
  }

  // -------------------- Voice / LiveRegion --------------------
  function cargarVozES() {
    try {
      if (typeof speechSynthesis === "undefined") return;
      const voces = speechSynthesis.getVoices() || [];
      voiceES = voces.find(v => v.lang && v.lang.startsWith("es")) || null;

      if (!voiceES) {
        speechSynthesis.onvoiceschanged = () => {
          const v2 = speechSynthesis.getVoices() || [];
          voiceES = v2.find(v => v.lang && v.lang.startsWith("es")) || null;
        };
      }
    } catch (_) {}
  }

  function asegurarLiveRegion() {
    if (liveRegion) return liveRegion;
    liveRegion = document.createElement("div");
    liveRegion.id = "kathware-live-region";
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("aria-atomic", "true");
    liveRegion.style.position = "fixed";
    liveRegion.style.left = "-9999px";
    liveRegion.style.top = "0";
    liveRegion.style.width = "1px";
    liveRegion.style.height = "1px";
    liveRegion.style.overflow = "hidden";
    document.documentElement.appendChild(liveRegion);
    return liveRegion;
  }

  function detenerLectura() {
    try { speechSynthesis?.cancel?.(); } catch (_) {}
    if (liveRegion) {
      try { liveRegion.remove(); } catch (_) {}
      liveRegion = null;
    }
    lastEmitText = "";
    lastEmitAt = 0;
  }

  function shouldEmit(t) {
    const now = Date.now();
    if (!t) return false;
    if (t === lastEmitText && (now - lastEmitAt) < CFG.burstMs) return false;
    if (t === lastEmitText && (now - lastEmitAt) < CFG.cooldownMs) return false;
    lastEmitText = t;
    lastEmitAt = now;
    return true;
  }

  function pushToLiveRegion(texto) {
    const lr = asegurarLiveRegion();
    lr.textContent = "";
    setTimeout(() => { lr.textContent = texto; }, 10);
  }

  function speakTTS(texto) {
    if (typeof speechSynthesis === "undefined") return;
    if (!voiceES) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto);
      u.voice = voiceES;
      u.lang = voiceES.lang || "es-AR";
      speechSynthesis.speak(u);
    } catch (_) {}
  }

  function shouldReadNow() {
    if (!extensionActiva) return false;
    if (!currentVideo) return true;
    try {
      if (currentVideo.paused || currentVideo.ended) return false;
    } catch (_) {}
    return true;
  }

  function leerTextoAccesible(texto) {
    const t = normalize(texto);
    if (!t) return;
    if (!shouldEmit(t)) return;

    updateOverlayText(t);

    if (!extensionActiva) return;
    if (modoNarradorGlobal === "off") return;
    if (!shouldReadNow()) return;

    if (modoNarradorGlobal === "lector") pushToLiveRegion(t);
    else if (modoNarradorGlobal === "sintetizador") speakTTS(t);
  }

  // -------------------- Toast --------------------
  function notify(msg) {
    // A11y
    pushToLiveRegion(msg);

    try {
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.id = "kw-toast";
        toastEl.setAttribute("role", "status");
        toastEl.setAttribute("aria-live", "polite");
        Object.assign(toastEl.style, {
          position: "fixed",
          top: "1rem",
          right: "1rem",
          background: "rgba(0,0,0,0.85)",
          color: "#fff",
          padding: "0.75rem 1rem",
          borderRadius: "10px",
          zIndex: "2147483647",
          fontSize: "14px",
          maxWidth: "70vw",
          boxShadow: "0 8px 30px rgba(0,0,0,0.35)"
        });
        document.documentElement.appendChild(toastEl);
      }
      toastEl.textContent = msg;

      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        if (toastEl) toastEl.textContent = "";
      }, 2000);
    } catch (_) {}
  }

  // -------------------- Overlay --------------------
  function ensureOverlay() {
    if (overlayRoot) return;

    overlayRoot = document.createElement("div");
    overlayRoot.id = "kathware-overlay-root";
    overlayRoot.style.position = "fixed";
    overlayRoot.style.right = "14px";
    overlayRoot.style.bottom = "14px";
    overlayRoot.style.zIndex = "2147483647";
    overlayRoot.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";

    overlayPanel = document.createElement("div");
    overlayPanel.id = "kathware-overlay-panel";
    Object.assign(overlayPanel.style, {
      display: "none",
      marginBottom: "10px",
      padding: "12px 14px",
      borderRadius: "12px",
      background: "rgba(0,0,0,0.78)",
      color: "#fff",
      maxWidth: "75vw",
      boxShadow: "0 8px 24px rgba(0,0,0,0.25)"
    });

    overlayStatus = document.createElement("div");
    overlayStatus.style.opacity = ".9";
    overlayStatus.style.fontSize = "13px";
    overlayStatus.style.marginBottom = "6px";

    overlayText = document.createElement("div");
    overlayText.style.whiteSpace = "pre-wrap";
    overlayText.style.fontSize = "16px";
    overlayText.style.lineHeight = "1.35";

    const settingsRow = document.createElement("div");
    settingsRow.style.display = "grid";
    settingsRow.style.gridTemplateColumns = "1fr 1fr";
    settingsRow.style.gap = "8px";
    settingsRow.style.marginTop = "10px";

    overlayModoSelect = document.createElement("select");
    overlayModoSelect.setAttribute("aria-label", "Modo de lectura");
    overlayModoSelect.innerHTML = `
      <option value="off">Desactivado</option>
      <option value="sintetizador">Voz</option>
      <option value="lector">Lector</option>
    `;

    overlayFuenteSelect = document.createElement("select");
    overlayFuenteSelect.setAttribute("aria-label", "Fuente de subtítulos");
    overlayFuenteSelect.innerHTML = `
      <option value="auto">Auto</option>
      <option value="track">TRACK</option>
      <option value="visual">VISUAL</option>
    `;

    settingsRow.appendChild(overlayModoSelect);
    settingsRow.appendChild(overlayFuenteSelect);

    overlayTrackSelect = document.createElement("select");
    overlayTrackSelect.setAttribute("aria-label", "Pista de subtítulos");
    overlayTrackSelect.style.marginTop = "8px";
    overlayTrackSelect.innerHTML = `<option value="0">Pista 1</option>`;

    const controlsRow = document.createElement("div");
    controlsRow.style.display = "flex";
    controlsRow.style.flexWrap = "wrap";
    controlsRow.style.gap = "8px";
    controlsRow.style.marginTop = "10px";

    const mkBtn = (label, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      Object.assign(b.style, {
        padding: "6px 10px",
        borderRadius: "10px",
        border: "0",
        cursor: "pointer"
      });
      b.addEventListener("click", onClick);
      return b;
    };

    const btnToggle = mkBtn("ON/OFF", () => toggleExtension());
    const btnPlay   = mkBtn("▶️", () => currentVideo?.play?.());
    const btnPause  = mkBtn("⏸️", () => currentVideo?.pause?.());
    const btnBack   = mkBtn("⏪", () => seekBy(-CFG.seekBig));
    const btnFwd    = mkBtn("⏩", () => seekBy(+CFG.seekBig));
    const btnMute   = mkBtn("M", () => toggleMute());
    const btnCC     = mkBtn("C", () => toggleCaptions());
    const btnFull   = mkBtn("⛶", () => requestFull());
    const btnClose  = mkBtn("Cerrar", () => setPanelOpen(false));

    controlsRow.appendChild(btnToggle);
    controlsRow.appendChild(btnPlay);
    controlsRow.appendChild(btnPause);
    controlsRow.appendChild(btnBack);
    controlsRow.appendChild(btnFwd);
    controlsRow.appendChild(btnMute);
    controlsRow.appendChild(btnCC);
    controlsRow.appendChild(btnFull);
    controlsRow.appendChild(btnClose);

    overlayPanel.appendChild(overlayStatus);
    overlayPanel.appendChild(overlayText);
    overlayPanel.appendChild(settingsRow);
    overlayPanel.appendChild(overlayTrackSelect);
    overlayPanel.appendChild(controlsRow);

    overlayPill = document.createElement("button");
    overlayPill.type = "button";
    overlayPill.setAttribute("aria-label", "Abrir KathWare Media Player");
    overlayPill.textContent = "KW";
    Object.assign(overlayPill.style, {
      width: "46px",
      height: "46px",
      borderRadius: "999px",
      border: "0",
      cursor: "pointer",
      background: "rgba(0,0,0,0.78)",
      color: "#fff",
      fontWeight: "700",
      boxShadow: "0 8px 24px rgba(0,0,0,0.25)"
    });

    overlayPill.addEventListener("click", () => {
      const open = overlayPanel.style.display !== "none";
      setPanelOpen(!open);
    });

    overlayRoot.appendChild(overlayPanel);
    overlayRoot.appendChild(overlayPill);
    document.documentElement.appendChild(overlayRoot);

    overlayModoSelect.addEventListener("change", () => {
      modoNarradorGlobal = overlayModoSelect.value;
      api?.storage?.local?.set?.({ modoNarrador: modoNarradorGlobal });
      if (modoNarradorGlobal === "off") detenerLectura();
      updateOverlayStatus();
    });

    overlayFuenteSelect.addEventListener("change", () => {
      fuenteSubGlobal = overlayFuenteSelect.value;
      api?.storage?.local?.set?.({ fuenteSub: fuenteSubGlobal });
      if (extensionActiva) restartPipeline();
      updateOverlayStatus();
    });

    overlayTrackSelect.addEventListener("change", () => {
      const idx = Number(overlayTrackSelect.value);
      if (Number.isFinite(idx)) {
        trackIndexGlobal = idx;
        api?.storage?.local?.set?.({ trackIndex: trackIndexGlobal });
        if (extensionActiva) restartPipeline();
        updateOverlayStatus();
      }
    });
  }

  function setPanelOpen(open) {
    ensureOverlay();
    overlayPanel.style.display = open ? "block" : "none";
  }

  function updateOverlayText(text) {
    ensureOverlay();
    overlayText.textContent = text || "";
    if (text && text.trim()) setPanelOpen(true); // auto-expand cuando hay subtítulos
  }

  function describeTrack(t) {
    if (!t) return "Sin track";
    let cuesLen = "?";
    try { cuesLen = t.cues ? t.cues.length : 0; } catch {}
    return `${t.label || "(sin label)"} lang=${t.language || "??"} mode=${t.mode} cues=${cuesLen}`;
  }

  function updateOverlayTracksList() {
    ensureOverlay();
    const v = currentVideo;
    const tracks = v?.textTracks ? Array.from(v.textTracks) : [];
    overlayTrackSelect.innerHTML = "";

    if (!tracks.length) {
      const opt = document.createElement("option");
      opt.value = "0";
      opt.textContent = "Sin pistas";
      overlayTrackSelect.appendChild(opt);
      overlayTrackSelect.disabled = true;
      return;
    }

    tracks.forEach((t, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = (t.label || t.language || `Pista ${idx + 1}`);
      overlayTrackSelect.appendChild(opt);
    });

    overlayTrackSelect.disabled = false;
    overlayTrackSelect.value = String(clamp(trackIndexGlobal, 0, tracks.length - 1));
  }

  function updateOverlayStatus() {
    ensureOverlay();
    const p = getPlatform();
    const label = platformLabel(p);

    const enabled = extensionActiva ? "🟢 ON" : "🔴 OFF";
    const modeEmoji =
      modoNarradorGlobal === "lector" ? "🧏" :
      modoNarradorGlobal === "sintetizador" ? "🗣️" : "🙊";

    const src = fuenteSubGlobal === "track" ? "🎛️TRACK"
              : fuenteSubGlobal === "visual" ? "👀VISUAL"
              : `🤖AUTO→${effectiveFuente.toUpperCase()}`;

    const trackInfo = currentTrack ? describeTrack(currentTrack) : "Sin track";

    overlayModoSelect.value = modoNarradorGlobal;
    overlayFuenteSelect.value = fuenteSubGlobal;

    overlayStatus.textContent = `${enabled} ${modeEmoji} | ${src} | ${label} | ${trackInfo}`;
  }

  // -------------------- Video detection (shadowRoot + largest) --------------------
  function findVideosRecursively(root = document, out = new Set()) {
    try {
      root.querySelectorAll("video").forEach(v => out.add(v));
      root.querySelectorAll("*").forEach(el => el.shadowRoot && findVideosRecursively(el.shadowRoot, out));
    } catch (_) {}
    return Array.from(out);
  }

  function pickLargestVideo(videos) {
    if (!videos.length) return null;
    try {
      return videos
        .map(v => {
          const r = v.getBoundingClientRect();
          return { v, area: Math.max(0, r.width) * Math.max(0, r.height) };
        })
        .sort((a, b) => b.area - a.area)[0]?.v || videos[0];
    } catch {
      return videos[0];
    }
  }

  function getMainVideo() {
    const vids = findVideosRecursively();
    return pickLargestVideo(vids);
  }

  // -------------------- TRACK pipeline --------------------
  function readActiveCues(track) {
    try {
      const active = track?.activeCues ? Array.from(track.activeCues) : [];
      const joined = active.map(c => c.text || "").join(" / ");
      return normalize(joined);
    } catch {
      return "";
    }
  }

  function trackSeemsUsable(track) {
    if (!track) return false;
    try { if (track.mode === "disabled") track.mode = "hidden"; } catch (_) {}

    try {
      const txt = readActiveCues(track);
      if (txt) return true;

      const len = track.cues ? track.cues.length : 0;
      if (len > 0) return true;
    } catch (_) {
      return false;
    }
    return false;
  }

  function videoHasUsableTracks(video) {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return false;
    return list.some(trackSeemsUsable);
  }

  function pickBestTrack(video) {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return null;

    const idx = clamp(trackIndexGlobal, 0, list.length - 1);
    return (
      list[idx] ||
      list.find(t => t.mode === "showing") ||
      list.find(t => t.mode === "hidden" && t.cues && t.cues.length) ||
      list.find(t => t.mode === "hidden") ||
      list[0] ||
      null
    );
  }

  function attachTrack(track) {
    if (!track) return;
    try { if (track.mode === "disabled") track.mode = "hidden"; } catch (_) {}
    try { track.oncuechange = null; } catch (_) {}

    track.oncuechange = () => {
      if (!shouldReadNow()) return;
      if (effectiveFuente !== "track") return;

      const txt = readActiveCues(track);
      if (txt) leerTextoAccesible(txt);
    };

    const initial = readActiveCues(track);
    if (initial) leerTextoAccesible(initial);
  }

  function startTrack() {
    const v = currentVideo;
    if (!v?.textTracks || !v.textTracks.length) {
      currentTrack = null;
      updateOverlayStatus();
      return false;
    }

    const best = pickBestTrack(v);
    if (!best) {
      currentTrack = null;
      updateOverlayStatus();
      return false;
    }

    if (!trackSeemsUsable(best)) {
      log("TRACK no usable, fallback a VISUAL:", describeTrack(best));
      currentTrack = null;
      updateOverlayStatus();
      return false;
    }

    if (best !== currentTrack) {
      currentTrack = best;
      attachTrack(best);
      updateOverlayTracksList();
      updateOverlayStatus();
      log("TRACK activo:", describeTrack(best));
    }
    return true;
  }

  function pollTrackTick() {
    if (!shouldReadNow()) return;
    if (effectiveFuente !== "track") return;
    if (!currentTrack) return;

    const txt = readActiveCues(currentTrack);
    if (txt) leerTextoAccesible(txt);
  }

  // -------------------- VISUAL pipeline --------------------
  function platformSelectors(p) {
    if (p === "max") {
      return [
        "[data-testid='cueBoxRowTextCue']",
        "[data-testid*='cueBoxRowTextCue']",
        "[class*='TextCue']"
      ];
    }
    if (p === "netflix") {
      return [
        ".player-timedtext-text-container",
        ".player-timedtext",
        "span.player-timedtext-text",
        "div[data-uia*='subtitle']",
        "div[data-uia*='captions']"
      ];
    }
    if (p === "disney") {
      return [
        "[class*='subtitle']",
        "[class*='subtitles']",
        "[class*='caption']",
        "[class*='captions']",
        "[class*='timedText']",
        "[class*='timed-text']",
        "[data-testid*='subtitle']",
        "[data-testid*='caption']",
        "[aria-label*='Subt']",
        "[aria-live='polite']",
        "[role='status']"
      ];
    }
    if (p === "youtube") {
      return [
        ".ytp-caption-segment",
        ".captions-text .caption-visual-line",
        ".ytp-caption-window-container"
      ];
    }
    return [
      ".plyr__caption",
      ".flirc-caption",
      "[class*='subtitle']",
      "[class*='caption']",
      "[class*='cc']",
      "[aria-live='polite']",
      "[role='status']"
    ];
  }

  function looksLikeNoise(node, text) {
    const t = normalize(text);
    if (!t) return true;

    const tag = (node?.tagName || "").toUpperCase();
    if (["H1","H2","H3","H4","H5","H6","HEADER","NAV","MAIN","ARTICLE","ASIDE","FOOTER"].includes(tag)) return true;
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;

    if (t.length < 2 || t.length > 260) return true;

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;

    return false;
  }

  function pickBestVisualNode() {
    const nodes = [];
    for (const sel of (visualSelectors || [])) {
      try { document.querySelectorAll(sel).forEach(n => nodes.push(n)); } catch (_) {}
    }
    if (!nodes.length) return null;

    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const t = normalize(n?.textContent);
      if (!looksLikeNoise(n, t)) return n;
    }
    return null;
  }

  function stopVisualObserver() {
    try { visualObserver?.disconnect?.(); } catch (_) {}
    visualObserver = null;
    visualObserverActive = false;
  }

  function startVisual() {
    const p = getPlatform();
    visualSelectors = platformSelectors(p);

    const next = pickBestVisualNode();
    if (next) visualNode = next;

    stopVisualObserver();

    if (visualNode) {
      try {
        visualObserver = new MutationObserver(() => {
          if (!shouldReadNow()) return;
          if (effectiveFuente !== "visual") return;

          const t = normalize(visualNode?.textContent);
          if (!looksLikeNoise(visualNode, t)) leerTextoAccesible(t);
        });

        visualObserver.observe(visualNode, { childList: true, subtree: true, characterData: true });
        visualObserverActive = true;
      } catch (_) {
        visualObserverActive = false;
      }
    }

    updateOverlayStatus();
    log("VISUAL activo:", p);
  }

  function pollVisualTick() {
    if (!shouldReadNow()) return;
    if (effectiveFuente !== "visual") return;

    if (!visualSelectors) visualSelectors = platformSelectors(getPlatform());

    // re-selección si no hay nodo
    if (!visualNode) {
      visualNode = pickBestVisualNode();
      if (visualNode) startVisual();
      return;
    }

    // Si observer está activo, poll no emite (evita duplicados)
    if (visualObserverActive) return;

    // Fallback: solo si no hay observer
    const t = normalize(visualNode.textContent);
    if (!looksLikeNoise(visualNode, t)) leerTextoAccesible(t);
  }

  // -------------------- Rehook --------------------
  function computeSignature(v, t) {
    const vSig = v ? (v.currentSrc || v.src || "v") : "noV";
    const tSig = t ? (t.label + "|" + t.language + "|" + t.mode) : "noT";
    let cues = 0;
    try { cues = t?.cues?.length || 0; } catch (_) {}
    return `${vSig}|${tSig}|${cues}`;
  }

  let lastSig = "";

  function rehookTick() {
    const v = getMainVideo();

    if (v !== currentVideo) {
      currentVideo = v;
      try { if (currentTrack) currentTrack.oncuechange = null; } catch (_) {}
      currentTrack = null;

      visualNode = null;
      visualSelectors = null;
      stopVisualObserver();

      updateOverlayTracksList();
      updateOverlayStatus();
    }

    ensureOverlay();
    updateOverlayStatus();

    if (!extensionActiva) return;

    const hasUsableTracks = videoHasUsableTracks(currentVideo);

    effectiveFuente =
      fuenteSubGlobal === "auto"
        ? (hasUsableTracks ? "track" : "visual")
        : (fuenteSubGlobal === "track" ? "track" : "visual");

    // mutear pipeline que no corresponde
    if (effectiveFuente === "track") {
      stopVisualObserver();
      visualNode = null;
      visualSelectors = null;
    } else {
      try { if (currentTrack) currentTrack.oncuechange = null; } catch (_) {}
      currentTrack = null;
    }

    const bestTrack = (effectiveFuente === "track") ? pickBestTrack(currentVideo) : null;
    const sig = computeSignature(currentVideo, bestTrack);

    if (sig !== lastSig) {
      lastSig = sig;

      if (effectiveFuente === "track") {
        const ok = startTrack();
        if (!ok) {
          effectiveFuente = "visual";
          startVisual();
        }
      } else {
        startVisual();
      }

      updateOverlayStatus();
    }
  }

  // -------------------- Keyboard controls --------------------
  function isNonAccessibleScenario() {
    return getPlatform() === "flow";
  }

  function seekBy(delta) {
    const v = currentVideo;
    if (!v) return;
    try {
      const dur = Number.isFinite(v.duration) ? v.duration : (v.currentTime + delta);
      v.currentTime = clamp((v.currentTime || 0) + delta, 0, dur);
    } catch (_) {}
  }

  function toggleMute() {
    const v = currentVideo;
    if (!v) return;
    try { v.muted = !v.muted; } catch (_) {}
  }

  function requestFull() {
    const v = currentVideo;
    if (!v) return;
    try { v.requestFullscreen?.(); } catch (_) {}
  }

  function toggleCaptions() {
    const v = currentVideo;
    if (!v?.textTracks?.length) {
      notify("⚠️ No hay pistas de subtítulos para alternar.");
      return;
    }
    const t = currentTrack || pickBestTrack(v);
    if (!t) return;

    try {
      if (t.mode === "showing") t.mode = "hidden";
      else if (t.mode === "hidden") t.mode = "showing";
      else t.mode = "hidden";
      currentTrack = t;
      updateOverlayStatus();
      notify(`CC: ${t.mode === "showing" ? "ON" : "OFF"}`);
    } catch (_) {}
  }

  function handlePlayerHotkeys(e) {
    if (!extensionActiva) return false;
    if (isTyping()) return false;

    if (e.ctrlKey || e.altKey || e.metaKey) return false;

    const panelOpen = overlayPanel && overlayPanel.style.display !== "none";
    if (!panelOpen && !isNonAccessibleScenario()) return false;

    const key = (e.key || "").toLowerCase();

    if (key === "k" || key === " ") {
      e.preventDefault();
      const v = currentVideo;
      if (!v) return true;
      try { v.paused ? v.play() : v.pause(); } catch (_) {}
      return true;
    }

    if (key === "arrowleft") {
      e.preventDefault();
      seekBy(e.shiftKey ? -CFG.seekBig : -CFG.seekSmall);
      return true;
    }
    if (key === "arrowright") {
      e.preventDefault();
      seekBy(e.shiftKey ? +CFG.seekBig : +CFG.seekSmall);
      return true;
    }

    if (key === "j") { e.preventDefault(); seekBy(-CFG.seekBig); return true; }
    if (key === "l") { e.preventDefault(); seekBy(+CFG.seekBig); return true; }

    if (key === "m") { e.preventDefault(); toggleMute(); return true; }
    if (key === "c") { e.preventDefault(); toggleCaptions(); return true; }
    if (key === "f") { e.preventDefault(); requestFull(); return true; }

    if (key === "arrowup") {
      e.preventDefault();
      const v = currentVideo;
      if (!v) return true;
      try { v.volume = clamp((v.volume ?? 1) + CFG.volStep, 0, 1); } catch (_) {}
      return true;
    }
    if (key === "arrowdown") {
      e.preventDefault();
      const v = currentVideo;
      if (!v) return true;
      try { v.volume = clamp((v.volume ?? 1) - CFG.volStep, 0, 1); } catch (_) {}
      return true;
    }

    return false;
  }

  // -------------------- Pipeline control --------------------
  function stopTimers() {
    try { clearInterval(pollTimerTrack); } catch (_) {}
    try { clearInterval(rehookTimer); } catch (_) {}
    try { clearInterval(pollTimerVisual); } catch (_) {}
    try { clearInterval(visualReselectTimer); } catch (_) {}

    pollTimerTrack = null;
    rehookTimer = null;
    pollTimerVisual = null;
    visualReselectTimer = null;
  }

  function stopAll() {
    stopTimers();

    try { if (currentTrack) currentTrack.oncuechange = null; } catch (_) {}
    currentTrack = null;

    stopVisualObserver();
    visualNode = null;
    visualSelectors = null;

    detenerLectura();
    updateOverlayStatus();
  }

  function startTimers() {
    stopTimers();

    rehookTimer = setInterval(rehookTick, CFG.rehookMs);

    pollTimerTrack = setInterval(pollTrackTick, CFG.pollMsTrack);
    pollTimerVisual = setInterval(pollVisualTick, CFG.pollMsVisual);

    visualReselectTimer = setInterval(() => {
      if (!extensionActiva) return;
      if (effectiveFuente !== "visual") return;

      if (!visualSelectors) visualSelectors = platformSelectors(getPlatform());

      const prev = visualNode;
      const next = pickBestVisualNode() || prev;

      if (next && next !== prev) {
        visualNode = next;
        startVisual();
      }
    }, CFG.visualReselectMs);
  }

  function restartPipeline() {
    try { if (currentTrack) currentTrack.oncuechange = null; } catch (_) {}
    currentTrack = null;

    stopVisualObserver();
    visualNode = null;
    visualSelectors = null;

    lastEmitText = "";
    lastEmitAt = 0;

    rehookTick();
    updateOverlayStatus();
  }

  function toggleExtension() {
    extensionActiva = !extensionActiva;

    ensureOverlay();
    updateOverlayStatus();

    const p = getPlatform();
    const label = platformLabel(p);

    if (extensionActiva) {
      cargarVozES();
      notify(`🟢 KathWare ON — ${label}`);
      startTimers();
      rehookTick();
      if (p === "flow") setPanelOpen(true);
    } else {
      notify(`🔴 KathWare OFF — ${label}`);
      stopAll();
    }
  }

  // -------------------- Hotkeys fallback in-page --------------------
  function matchHotkey(e, hk) {
    const key = (e.key || "").toLowerCase();
    return (
      key === hk.key &&
      !!e.ctrlKey === !!hk.ctrl &&
      !!e.altKey === !!hk.alt &&
      !!e.shiftKey === !!hk.shift
    );
  }

  document.addEventListener("keydown", (e) => {
    if (matchHotkey(e, CFG.hotkeys.toggle)) {
      e.preventDefault();
      e.stopPropagation();
      toggleExtension();
      return;
    }
    if (matchHotkey(e, CFG.hotkeys.mode)) {
      e.preventDefault();
      e.stopPropagation();
      const order = ["lector", "sintetizador", "off"];
      const i = order.indexOf(modoNarradorGlobal);
      modoNarradorGlobal = order[(i + 1) % order.length];
      api?.storage?.local?.set?.({ modoNarrador: modoNarradorGlobal });
      notify(`Modo: ${modoNarradorGlobal}`);
      updateOverlayStatus();
      return;
    }
    if (matchHotkey(e, CFG.hotkeys.panel)) {
      e.preventDefault();
      e.stopPropagation();
      const open = overlayPanel && overlayPanel.style.display !== "none";
      setPanelOpen(!open);
      return;
    }

    if (handlePlayerHotkeys(e)) return;
  }, true);

  // -------------------- Mensajes desde background/popup --------------------
  if (api?.runtime?.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (message?.action === "toggleNarrator") {
          toggleExtension();
          sendResponse?.({ status: "ok" });
          return false;
        }

        if (message?.action === "updateSettings") {
          cargarConfigDesdeStorage(() => {
            updateOverlayStatus();
            updateOverlayTracksList();
            if (extensionActiva) restartPipeline();
            sendResponse?.({ status: "ok" });
          });
          return true;
        }

        if (message?.action === "setTrack") {
          const idx = Number(message.index);
          if (Number.isFinite(idx)) {
            trackIndexGlobal = idx;
            api?.storage?.local?.set?.({ trackIndex: trackIndexGlobal });
            if (extensionActiva) restartPipeline();
            updateOverlayTracksList();
            updateOverlayStatus();
          }
          sendResponse?.({ status: "ok" });
          return false;
        }

        if (message?.type === "getTracks") {
          const v = getMainVideo();
          const tracks = v?.textTracks
            ? Array.from(v.textTracks).map(t => ({
                label: t.label || t.language || "Pista",
                language: t.language || ""
              }))
            : [];
          sendResponse?.({ tracks });
          return false;
        }

        if (message?.action === "toggleOverlayPanel") {
          const open = overlayPanel && overlayPanel.style.display !== "none";
          setPanelOpen(!open);
          sendResponse?.({ status: "ok" });
          return false;
        }

        return false;
      } catch (e) {
        log("onMessage error", e);
        sendResponse?.({ status: "error" });
        return false;
      }
    });
  }

  // -------------------- Init --------------------
  ensureOverlay();
  cargarConfigDesdeStorage(() => {
    currentVideo = getMainVideo();
    updateOverlayTracksList();
    updateOverlayStatus();
    log("content.js listo en", location.hostname, "plataforma:", getPlatform());
  });
})();

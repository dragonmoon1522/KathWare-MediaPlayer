// ====================================================
// KathWare Media Player - content.js (MV3) - v2.0.0
// Engine v4-ish (rehook + polling + overlay pill + TRACK/VISUAL)
// - TRACK: lee video.textTracks (oncuechange + poll activeCues fallback)
// - VISUAL: lee captions por selectores por plataforma + observer (poll solo fallback)
// - Overlay: SOLO visible cuando usuario activa (Alt+Shift+K o command)
// - KeepControls: mantiene visibles controles de reproductores “tímidos” (Flow/Max/Netflix)
// - Flow A11y: etiqueta controles nativos del reproductor (in-place) - DYNAMIC LABELING
// - ON/OFF: via command (background) + fallback hotkey in-page (Alt+Shift+K)
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
    visualReselectMs: 1200,

    // keep controls
    keepControlsMs: 850,

    // keyboard controls
    seekSmall: 5,
    seekBig: 10,
    volStep: 0.05,

    // Hotkey fallback in-page (si commands no está o choca)
    // PEDIDO: Alt+Shift+K
    hotkeys: {
      toggle: { ctrl: true, alt: false, shift: true, key: "k" },
      mode:   { ctrl: true, alt: true,  shift: false, key: "l" },
      panel:  { ctrl: true, alt: true,  shift: false, key: "o" },
    },

    // UI behavior
    autoOpenPanelOnSubs: false, // (antes auto-expand; ahora NO para no confundir)
  };

  const log = (...a) => CFG.debug && console.log("[KathWare]", ...a);

  // -------------------- Estado (settings) --------------------
  let extensionActiva = false;

  // "off" | "sintetizador" | "lector"
  let modoNarradorGlobal = "lector";

  // "auto" | "track" | "visual"
  let fuenteSubGlobal = "auto";
  let trackIndexGlobal = 0;

  // Fuente efectiva real
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
  let keepControlsTimer = null;

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

  // Per-source change detection
  let lastTrackSeen = "";
  let lastVisualSeen = "";

  // Flow labeling
  let flowLabelTimer = null;

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
  function listVoicesDebug() {
    try {
      if (typeof speechSynthesis === "undefined") return { ok: false, reason: "speechSynthesis undefined" };
      const voces = speechSynthesis.getVoices() || [];
      return {
        ok: true,
        count: voces.length,
        langs: voces.slice(0, 15).map(v => v.lang).filter(Boolean)
      };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  }

  function cargarVozES() {
    try {
      if (typeof speechSynthesis === "undefined") return;
      const voces = speechSynthesis.getVoices() || [];
      // preferimos es-AR si existe, sino cualquier es
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
    // edge-trigger para NVDA/JAWS
    lr.textContent = "";
    setTimeout(() => { lr.textContent = texto; }, 10);
  }

  function speakTTS(texto) {
    try {
      if (typeof speechSynthesis === "undefined") return { ok: false, reason: "speechSynthesis undefined" };
      cargarVozES();
      if (!voiceES) return { ok: false, reason: "No encuentro voz ES (getVoices vacío o sin es-*)" };

      speechSynthesis.cancel();

      const u = new SpeechSynthesisUtterance(texto);
      u.voice = voiceES;
      u.lang = voiceES.lang || "es-AR";

      // debug hooks
      u.onend = () => CFG.debug && console.log("[KathWare] TTS end");
      u.onerror = (ev) => CFG.debug && console.warn("[KathWare] TTS error:", ev?.error || ev);

      speechSynthesis.speak(u);

      return {
        ok: true,
        selectedLang: voiceES.lang,
        speaking: !!speechSynthesis.speaking,
        pending: !!speechSynthesis.pending,
        paused: !!speechSynthesis.paused
      };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
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

    if (modoNarradorGlobal === "lector") {
      pushToLiveRegion(t);
      return;
    }

    if (modoNarradorGlobal === "sintetizador") {
      const res = speakTTS(t);
      if (!res.ok) {
        // debug de por qué no lee
        console.warn("[KathWare] TTS FALLÓ:", res);
        console.warn("[KathWare] Voices debug:", listVoicesDebug());
        try {
          console.warn("[KathWare] speechSynthesis state:", {
            speaking: speechSynthesis.speaking,
            pending: speechSynthesis.pending,
            paused: speechSynthesis.paused
          });
        } catch {}
      } else {
        CFG.debug && console.log("[KathWare] TTS OK:", res);
      }
    }
  }

  // -------------------- Toast --------------------
  function notify(msg) {
    // A11y
    if (extensionActiva) pushToLiveRegion(msg);

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

  // -------------------- Overlay (solo cuando está activo) --------------------
  function destroyOverlay() {
    try { overlayRoot?.remove?.(); } catch (_) {}
    overlayRoot = null;
    overlayPanel = null;
    overlayPill = null;
    overlayStatus = null;
    overlayText = null;
    overlayTrackSelect = null;
    overlayModoSelect = null;
    overlayFuenteSelect = null;
  }

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

    const mkBtn = (label, onClick, aria) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (aria) b.setAttribute("aria-label", aria);
      Object.assign(b.style, {
        padding: "6px 10px",
        borderRadius: "10px",
        border: "0",
        cursor: "pointer"
      });
      b.addEventListener("click", onClick);
      return b;
    };

    const btnPlay   = mkBtn("▶️", () => currentVideo?.play?.(), "Reproducir");
    const btnPause  = mkBtn("⏸️", () => currentVideo?.pause?.(), "Pausar");
    const btnBack   = mkBtn("⏪", () => seekBy(-CFG.seekBig), "Atrasar 10 segundos");
    const btnFwd    = mkBtn("⏩", () => seekBy(+CFG.seekBig), "Adelantar 10 segundos");
    const btnMute   = mkBtn("M",  () => toggleMute(), "Silenciar / Activar sonido");
    const btnCC     = mkBtn("C",  () => toggleCaptions(), "Subtítulos");
    const btnFull   = mkBtn("⛶", () => requestFull(), "Pantalla completa");
    const btnClose  = mkBtn("Cerrar", () => setPanelOpen(false), "Cerrar panel");

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
    if (!overlayRoot) return;
    overlayText.textContent = text || "";
    if (CFG.autoOpenPanelOnSubs && text && text.trim()) setPanelOpen(true);
  }

  function describeTrack(t) {
    if (!t) return "Sin track";
    let cuesLen = "?";
    try { cuesLen = t.cues ? t.cues.length : 0; } catch {}
    return `${t.label || "(sin label)"} lang=${t.language || "??"} mode=${t.mode} cues=${cuesLen}`;
  }

  function updateOverlayTracksList() {
    if (!overlayRoot) return;
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
    if (!overlayRoot) return;
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
      if (!txt) return;

      if (txt === lastTrackSeen) return;
      lastTrackSeen = txt;

      leerTextoAccesible(txt);
    };

    const initial = readActiveCues(track);
    if (initial && initial !== lastTrackSeen) {
      lastTrackSeen = initial;
      leerTextoAccesible(initial);
    }
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
    if (!txt) return;

    if (txt === lastTrackSeen) return;
    lastTrackSeen = txt;

    leerTextoAccesible(txt);
  }

  // -------------------- VISUAL pipeline --------------------
  function platformSelectors(p) {
    if (p === "flow") {
      return [
        ".theoplayer-ttml-texttrack-",
        ".theoplayer-texttracks",
        ".theoplayer-texttracks *"
      ];
    }
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

    const theoTTML = nodes.find(n => (n.className || "").toString().includes("theoplayer-ttml-texttrack-"));
    if (theoTTML) return theoTTML;

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
          if (!t) return;
          if (looksLikeNoise(visualNode, t)) return;

          if (t === lastVisualSeen) return;
          lastVisualSeen = t;

          leerTextoAccesible(t);
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

    if (!visualNode) {
      visualNode = pickBestVisualNode();
      if (visualNode) startVisual();
      return;
    }

    if (visualObserverActive) return;

    const t = normalize(visualNode.textContent);
    if (!t) return;
    if (looksLikeNoise(visualNode, t)) return;

    if (t === lastVisualSeen) return;
    lastVisualSeen = t;

    leerTextoAccesible(t);
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
      lastTrackSeen = "";
      lastVisualSeen = "";
      try { if (currentTrack) currentTrack.oncuechange = null; } catch (_) {}
      currentTrack = null;

      visualNode = null;
      visualSelectors = null;
      stopVisualObserver();

      updateOverlayTracksList();
      updateOverlayStatus();
    }

    if (!extensionActiva) return;

    const hasUsableTracks = videoHasUsableTracks(currentVideo);

    effectiveFuente =
      fuenteSubGlobal === "auto"
        ? (hasUsableTracks ? "track" : "visual")
        : (fuenteSubGlobal === "track" ? "track" : "visual");

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

    // Flow labeling in-place
    if (getPlatform() === "flow") labelFlowControls();
  }

  // -------------------- KeepControls --------------------
  function keepControlsTick() {
    if (!extensionActiva) return;
    const v = currentVideo || getMainVideo();
    if (!v) return;

    const p = getPlatform();
    const needs = (p === "flow" || p === "max" || p === "netflix");
    if (!needs) return;

    try {
      const r = v.getBoundingClientRect();
      const x = r.left + r.width * 0.5;
      const y = r.top + r.height * 0.90;

      v.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
      v.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));

      if (document.activeElement !== v && !isTyping()) {
        v.setAttribute("tabindex", v.getAttribute("tabindex") || "-1");
        v.focus?.({ preventScroll: true });
      }
    } catch (_) {}

    if (p === "flow") labelFlowControls();
  }

  // -------------------- Flow A11y labeling (in-place) - DYNAMIC --------------------
  function isVisibleEl(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 14 || r.height < 14) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity || 1) < 0.05) return false;
    if (cs.pointerEvents === "none") return false;
    return true;
  }

  function intersectsVideo(el, vr) {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(vr.right, r.right) - Math.max(vr.left, r.left));
    const y = Math.max(0, Math.min(vr.bottom, r.bottom) - Math.max(vr.top, r.top));
    return (x * y) > 120;
  }

  function visibleText(el) {
    return normalize(el?.innerText || el?.textContent || "");
  }

  function guessIconOnlyLabel(testId, cls) {
    const blob = normalize(`${testId} ${cls}`).toLowerCase();
    if (testId === "volume-btn" || blob.includes("volume") || blob.includes("mute")) return "Volumen / Silenciar";
    if (testId === "cast-btn" || blob.includes("cast") || blob.includes("chromecast")) return "Transmitir (Cast)";
    if (testId === "full-screen-btn" || blob.includes("full") || blob.includes("screen")) return "Pantalla completa";
    if (testId === "audio-subtitle-btn" || blob.includes("subtitle") || blob.includes("audio")) return "Audio y subtítulos";
    if (testId === "more-emissions-btn" || blob.includes("emission") || blob.includes("episod")) return "Ir a episodios";
    if (testId === "back-btn" || blob.includes("back")) return "Volver";
    return "Control del reproductor";
  }

  function applyA11yLabel(el, label) {
    if (!el) return 0;
    const t = normalize(label);
    if (!t) return 0;

    const prev = el.getAttribute("aria-label") || "";
    const prevAuto = el.getAttribute("data-kw-autolabel") === "1";

    // Si no tiene aria-label, o si lo pusimos nosotros antes, lo actualizamos
    if (!prev || prevAuto) {
      el.setAttribute("aria-label", t);
      el.setAttribute("data-kw-autolabel", "1");
    }

    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (!el.getAttribute("role")) el.setAttribute("role", "button");

    return 1;
  }

  function labelFlowControls() {
    if (getPlatform() !== "flow") return 0;

    const v = currentVideo || getMainVideo();
;
    if (!v) return 0;
    const vr = v.getBoundingClientRect();

    const all = Array.from(document.querySelectorAll("button,[role='button'],[tabindex],[data-testid]"))
      .filter(el =>
        el.getBoundingClientRect &&
        isVisibleEl(el) &&
        intersectsVideo(el, vr) &&
        !el.closest("#kathware-overlay-root,#kathware-overlay-panel,#kw-toast,#kathware-live-region")
      );

    let labeled = 0;

    for (const el of all) {
      const txt = visibleText(el);
      const testId = el.getAttribute("data-testid") || "";
      const cls = String(el.className || "");
      const label = txt || guessIconOnlyLabel(testId, cls);
      labeled += applyA11yLabel(el, label);
    }

    if (labeled && CFG.debug) {
      console.log("[KathWare] FlowMode:", { mode: "dynamic-label", labeled, hasVideo: true });
    }

    return labeled;
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
    try { clearInterval(keepControlsTimer); } catch (_) {}
    try { clearInterval(flowLabelTimer); } catch (_) {}

    pollTimerTrack = null;
    rehookTimer = null;
    pollTimerVisual = null;
    visualReselectTimer = null;
    keepControlsTimer = null;
    flowLabelTimer = null;
  }

  function stopAll() {
    stopTimers();

    try { if (currentTrack) currentTrack.oncuechange = null; } catch (_) {}
    currentTrack = null;

    stopVisualObserver();
    visualNode = null;
    visualSelectors = null;

    detenerLectura();
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

    keepControlsTimer = setInterval(keepControlsTick, CFG.keepControlsMs);

    // Flow: reforzar etiquetado cada tanto (SPA re-render)
    flowLabelTimer = setInterval(() => {
      if (!extensionActiva) return;
      if (getPlatform() !== "flow") return;
      const n = labelFlowControls();
      if (n && CFG.debug) console.log("[KathWare] FlowMode:", { labeled: n });
    }, 1200);
  }

  function restartPipeline() {
    try { if (currentTrack) currentTrack.oncuechange = null; } catch (_) {}
    currentTrack = null;

    stopVisualObserver();
    visualNode = null;
    visualSelectors = null;

    lastTrackSeen = "";
    lastVisualSeen = "";

    lastEmitText = "";
    lastEmitAt = 0;

    effectiveFuente = "visual";
    rehookTick();
    updateOverlayTracksList();
    updateOverlayStatus();
  }

  function setUIVisible(visible) {
    if (visible) {
      ensureOverlay();
      updateOverlayTracksList();
      updateOverlayStatus();
    } else {
      destroyOverlay();
    }
  }

  function toggleExtension() {
    extensionActiva = !extensionActiva;

    const p = getPlatform();
    const label = platformLabel(p);

    if (extensionActiva) {
      setUIVisible(true);
      cargarVozES();
      notify(`🟢 KathWare ON — ${label}`);
      startTimers();
      effectiveFuente = "visual";
      rehookTick();
    } else {
      notify(`🔴 KathWare OFF — ${label}`);
      stopAll();
      setUIVisible(false);
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
      if (!overlayRoot) return;
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
          if (!overlayRoot) return sendResponse?.({ status: "no-ui" });
          const open = overlayPanel && overlayPanel.style.display !== "none";
          setPanelOpen(!open);
          sendResponse?.({ status: "ok" });
          return false;
        }

        sendResponse?.({ status: "noop" });
        return false;
      } catch (e) {
        log("onMessage error", e);
        sendResponse?.({ status: "error", error: String(e?.message || e) });
        return false;
      }
    });
  }

  // -------------------- Init (NO mostramos UI) --------------------
  cargarConfigDesdeStorage(() => {
    currentVideo = getMainVideo();
    log("content.js listo en", location.hostname, "plataforma:", getPlatform(), "UI: a demanda (Alt+Shift+K)");
  });
})();

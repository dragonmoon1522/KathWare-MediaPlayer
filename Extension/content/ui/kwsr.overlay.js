// ====================================================
// KathWare SubtitleReader - kwsr.overlay.js
// - UI (pill + panel) + controles del player + hotkeys player
// - Importante: se crea SOLO cuando ensureOverlay() es llamado (lazy)
//
// FIX:
// - Evita crashear con "Extension context invalidated" cuando la extensión se recarga
//   y la pestaña todavía no fue recargada.
// - Se blinda storage.set / runtime calls en handlers del overlay.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.overlay) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;

  const clamp = KWSR.utils?.clamp || ((n, min, max) => Math.min(max, Math.max(min, n)));
  const isTyping = KWSR.utils?.isTyping || (() => {
    const ae = document.activeElement;
    if (!ae) return false;
    const tag = (ae.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (ae.isContentEditable) return true;
    return false;
  });

  // ------------------ Safety: context invalidated ------------------
  function isContextInvalidatedError(err) {
    const msg = String(err?.message || err || "");
    return (
      msg.includes("Extension context invalidated") ||
      msg.includes("context invalidated") ||
      msg.includes("message channel closed") ||
      msg.includes("The message port closed")
    );
  }

  function notifyReloadNeeded() {
    try { KWSR.toast?.notify?.("⚠️ La extensión se recargó. Recargá la página (F5) y probá de nuevo."); } catch {}
    try { S.overlayPanel && (S.overlayPanel.style.display = "none"); } catch {}
    try { S.overlayRoot && (S.overlayRoot.style.display = "none"); } catch {}
  }

  function safeExtCall(fn) {
    try {
      // Si el runtime existe pero no hay runtime.id, suele ser invalidación.
      if (typeof chrome !== "undefined" && chrome?.runtime && !chrome.runtime.id) {
        throw new Error("Extension context invalidated.");
      }
      return fn();
    } catch (e) {
      if (isContextInvalidatedError(e)) {
        notifyReloadNeeded();
        return;
      }
      throw e;
    }
  }

  // ------------------ UI ------------------
  function ensureOverlay() {
    if (S.overlayRoot) return;

    const root = document.createElement("div");
    root.id = "kathware-overlay-root";
    Object.assign(root.style, {
      position: "fixed",
      right: "14px",
      bottom: "14px",
      zIndex: "2147483647",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      display: "none" // ✅ arranca oculto; pipeline lo muestra al activar
    });

    const panel = document.createElement("div");
    panel.id = "kathware-overlay-panel";
    Object.assign(panel.style, {
      display: "none",
      marginBottom: "10px",
      padding: "12px 14px",
      borderRadius: "12px",
      background: "rgba(0,0,0,0.78)",
      color: "#fff",
      maxWidth: "75vw",
      boxShadow: "0 8px 24px rgba(0,0,0,0.25)"
    });

    const status = document.createElement("div");
    Object.assign(status.style, { opacity: ".9", fontSize: "13px", marginBottom: "6px" });

    const text = document.createElement("div");
    Object.assign(text.style, { whiteSpace: "pre-wrap", fontSize: "16px", lineHeight: "1.35" });

    const settingsRow = document.createElement("div");
    Object.assign(settingsRow.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "8px",
      marginTop: "10px"
    });

    const modoSelect = document.createElement("select");
    modoSelect.setAttribute("aria-label", "Modo de lectura");
    modoSelect.innerHTML = `
      <option value="off">Desactivado</option>
      <option value="sintetizador">Voz</option>
      <option value="lector">Lector</option>
    `;

    const fuenteSelect = document.createElement("select");
    fuenteSelect.setAttribute("aria-label", "Fuente de texto");
    fuenteSelect.innerHTML = `
      <option value="auto">Auto</option>
      <option value="track">TRACK</option>
      <option value="visual">VISUAL</option>
    `;

    settingsRow.append(modoSelect, fuenteSelect);

    const trackSelect = document.createElement("select");
    trackSelect.setAttribute("aria-label", "Pista de subtítulos");
    trackSelect.style.marginTop = "8px";
    trackSelect.innerHTML = `<option value="0">Pista 1</option>`;

    const controlsRow = document.createElement("div");
    Object.assign(controlsRow.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      marginTop: "10px"
    });

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

    const btnPlay  = mkBtn("▶️", () => S.currentVideo?.play?.(), "Reproducir");
    const btnPause = mkBtn("⏸️", () => S.currentVideo?.pause?.(), "Pausar");
    const btnBack  = mkBtn("⏪", () => seekBy(-CFG.seekBig), "Atrasar 10 segundos");
    const btnFwd   = mkBtn("⏩", () => seekBy(+CFG.seekBig), "Adelantar 10 segundos");
    const btnMute  = mkBtn("M",   () => toggleMute(), "Silenciar / Activar sonido");
    const btnCC    = mkBtn("C",   () => toggleCaptions(), "Subtítulos");
    const btnFull  = mkBtn("⛶",  () => requestFull(), "Pantalla completa");
    const btnClose = mkBtn("Cerrar", () => setPanelOpen(false), "Cerrar panel");

    controlsRow.append(btnPlay, btnPause, btnBack, btnFwd, btnMute, btnCC, btnFull, btnClose);

    panel.append(status, text, settingsRow, trackSelect, controlsRow);

    const pill = document.createElement("button");
    pill.type = "button";
    pill.setAttribute("aria-label", "Abrir KathWare SubtitleReader");
    pill.textContent = "KW";
    Object.assign(pill.style, {
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

    pill.addEventListener("click", () => {
      const open = panel.style.display !== "none";
      setPanelOpen(!open);
    });

    root.append(panel, pill);
    document.documentElement.appendChild(root);

    // store refs
    S.overlayRoot = root;
    S.overlayPanel = panel;
    S.overlayPill = pill;
    S.overlayStatus = status;
    S.overlayText = text;
    S.overlayTrackSelect = trackSelect;
    S.overlayModoSelect = modoSelect;
    S.overlayFuenteSelect = fuenteSelect;

    // listeners (BLINDADOS)
    modoSelect.addEventListener("change", () => {
      safeExtCall(() => {
        S.modoNarradorGlobal = modoSelect.value;
        KWSR.api?.storage?.local?.set?.({ modoNarrador: S.modoNarradorGlobal });
        if (S.modoNarradorGlobal === "off") KWSR.voice?.detenerLectura?.();
        updateOverlayStatus();
      });
    });

    fuenteSelect.addEventListener("change", () => {
      safeExtCall(() => {
        S.fuenteSubGlobal = fuenteSelect.value;
        KWSR.api?.storage?.local?.set?.({ fuenteSub: S.fuenteSubGlobal });
        if (S.extensionActiva) KWSR.pipeline?.restartPipeline?.();
        updateOverlayStatus();
      });
    });

    trackSelect.addEventListener("change", () => {
      safeExtCall(() => {
        const idx = Number(trackSelect.value);
        if (Number.isFinite(idx)) {
          S.trackIndexGlobal = idx;
          KWSR.api?.storage?.local?.set?.({ trackIndex: S.trackIndexGlobal });
          if (S.extensionActiva) KWSR.pipeline?.restartPipeline?.();
          updateOverlayStatus();
        }
      });
    });
  }

  // ✅ mostrar/ocultar TODO el overlay (pill + panel)
  function setOverlayVisible(visible) {
    if (!S.overlayRoot) return;
    S.overlayRoot.style.display = visible ? "block" : "none";
    if (!visible) {
      try { S.overlayPanel.style.display = "none"; } catch {}
    }
  }

  function setPanelOpen(open) {
    ensureOverlay();
    // si abrimos panel, aseguramos que el root esté visible
    setOverlayVisible(true);
    S.overlayPanel.style.display = open ? "block" : "none";
  }

  function updateOverlayText(t) {
    if (!S.overlayRoot) return;
    S.overlayText.textContent = t || "";
    if (CFG.autoOpenPanelOnSubs && t && String(t).trim()) setPanelOpen(true);
  }

  function describeTrack(t) {
    if (!t) return "Sin track";
    let cuesLen = "?";
    try { cuesLen = t.cues ? t.cues.length : 0; } catch {}
    return `${t.label || "(sin label)"} lang=${t.language || "??"} mode=${t.mode} cues=${cuesLen}`;
  }

  function updateOverlayTracksList() {
    if (!S.overlayRoot) return;
    const v = S.currentVideo;
    const tracks = v?.textTracks ? Array.from(v.textTracks) : [];
    const sel = S.overlayTrackSelect;

    sel.innerHTML = "";

    if (!tracks.length) {
      const opt = document.createElement("option");
      opt.value = "0";
      opt.textContent = "Sin pistas";
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }

    tracks.forEach((t, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = (t.label || t.language || `Pista ${idx + 1}`);
      sel.appendChild(opt);
    });

    sel.disabled = false;
    sel.value = String(clamp(S.trackIndexGlobal, 0, tracks.length - 1));
  }

  function updateOverlayStatus() {
    if (!S.overlayRoot) return;

    const label = KWSR.platforms?.platformLabel?.(KWSR.platforms?.getPlatform?.() || "generic") || "Sitio";
    const enabled = S.extensionActiva ? "🟢 ON" : "🔴 OFF";

    const modeEmoji =
      S.modoNarradorGlobal === "lector" ? "🧏" :
      S.modoNarradorGlobal === "sintetizador" ? "🗣️" : "🙊";

    const src = S.fuenteSubGlobal === "track" ? "🎛️TRACK"
              : S.fuenteSubGlobal === "visual" ? "👀VISUAL"
              : `🤖AUTO→${String(S.effectiveFuente || "visual").toUpperCase()}`;

    const trackInfo = S.currentTrack ? describeTrack(S.currentTrack) : "Sin track";

    if (S.overlayModoSelect) S.overlayModoSelect.value = S.modoNarradorGlobal;
    if (S.overlayFuenteSelect) S.overlayFuenteSelect.value = S.fuenteSubGlobal;

    S.overlayStatus.textContent = `${enabled} ${modeEmoji} | ${src} | ${label} | ${trackInfo}`;
  }

  // --- player helpers (para botones y hotkeys) ---
  function seekBy(delta) {
    const v = S.currentVideo;
    if (!v) return;
    try {
      const dur = Number.isFinite(v.duration) ? v.duration : (v.currentTime + delta);
      v.currentTime = clamp((v.currentTime || 0) + delta, 0, dur);
    } catch {}
  }

  function toggleMute() {
    const v = S.currentVideo;
    if (!v) return;
    try { v.muted = !v.muted; } catch {}
  }

  function requestFull() {
    const v = S.currentVideo;
    if (!v) return;

    // Aviso útil: fullscreen puede cortar el flujo accesible en varios sitios
    KWSR.toast?.notify?.("⚠️ En pantalla completa la lectura automática puede fallar.");

    try { v.requestFullscreen?.(); } catch {}
  }

  function toggleCaptions() {
    const v = S.currentVideo;
    if (!v?.textTracks?.length) {
      KWSR.toast?.notify?.("⚠️ No hay pistas de subtítulos para alternar.");
      return;
    }

    const t = S.currentTrack || KWSR.track?.pickBestTrack?.(v);
    if (!t) return;

    try {
      if (t.mode === "showing") t.mode = "hidden";
      else if (t.mode === "hidden") t.mode = "showing";
      else t.mode = "hidden";
      S.currentTrack = t;
      updateOverlayStatus();
      KWSR.toast?.notify?.(`CC: ${t.mode === "showing" ? "ON" : "OFF"}`);
    } catch {}
  }

  function handlePlayerHotkeys(e) {
    if (!S.extensionActiva) return false;
    if (isTyping()) return false;
    if (e.ctrlKey || e.altKey || e.metaKey) return false;

    const panelOpen = S.overlayPanel && S.overlayPanel.style.display !== "none";

    // Por defecto, hotkeys del player solo si el panel está abierto,
    // excepto plataformas con controles difíciles.
    const p = KWSR.platforms?.getPlatform?.() || "generic";
    const caps = KWSR.platforms?.platformCapabilities?.(p) || { keepAlive: false, nonAccessibleFixes: false };

    if (!panelOpen && !caps.nonAccessibleFixes) return false;

    const key = (e.key || "").toLowerCase();

    if (key === "k" || key === " ") {
      e.preventDefault();
      const v = S.currentVideo;
      if (!v) return true;
      try { v.paused ? v.play() : v.pause(); } catch {}
      return true;
    }

    if (key === "arrowleft")  { e.preventDefault(); seekBy(e.shiftKey ? -CFG.seekBig : -CFG.seekSmall); return true; }
    if (key === "arrowright") { e.preventDefault(); seekBy(e.shiftKey ? +CFG.seekBig : +CFG.seekSmall); return true; }
    if (key === "j") { e.preventDefault(); seekBy(-CFG.seekBig); return true; }
    if (key === "l") { e.preventDefault(); seekBy(+CFG.seekBig); return true; }
    if (key === "m") { e.preventDefault(); toggleMute(); return true; }
    if (key === "c") { e.preventDefault(); toggleCaptions(); return true; }
    if (key === "f") { e.preventDefault(); requestFull(); return true; }

    if (key === "arrowup") {
      e.preventDefault();
      const v = S.currentVideo;
      if (!v) return true;
      try { v.volume = clamp((v.volume ?? 1) + CFG.volStep, 0, 1); } catch {}
      return true;
    }
    if (key === "arrowdown") {
      e.preventDefault();
      const v = S.currentVideo;
      if (!v) return true;
      try { v.volume = clamp((v.volume ?? 1) - CFG.volStep, 0, 1); } catch {}
      return true;
    }

    return false;
  }

  KWSR.overlay = {
    ensureOverlay,
    setOverlayVisible,
    setPanelOpen,
    updateOverlayText,
    describeTrack,
    updateOverlayTracksList,
    updateOverlayStatus,
    handlePlayerHotkeys
  };

})();

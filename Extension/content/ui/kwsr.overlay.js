// ====================================================
// KathWare SubtitleReader - kwsr.overlay.js
// ====================================================
//
// Este módulo crea la UI flotante (overlay) dentro de la página:
//
// 1) "Pill" (botón redondo) con texto "KW"
//    - Sirve para abrir/cerrar el panel
//
// 2) "Panel" (caja)
//    - Muestra estado (ON/OFF, modo, fuente, plataforma, track actual)
//    - Muestra el último subtítulo leído (solo como feedback visual)
//    - Permite cambiar:
//        - modo de lectura (off / sintetizador / lector)
//        - fuente (auto / track / visual)
//        - trackIndex (pista) si existen textTracks
//    - Incluye controles accesibles del reproductor (play/pause/seek/vol/etc.)
//
// IMPORTANTE (Lazy UI):
// - Este overlay NO se crea automáticamente al cargar la página.
// - Se crea recién cuando el pipeline llama a ensureOverlay() (cuando el usuario activa ON).
//
// ACCESIBILIDAD:
/// - Botones con aria-label.
/// - Panel simple, controlable por teclado.
/// - Evitamos interferir cuando el usuario está escribiendo (inputs/textarea/etc.).
//
// SEGURIDAD (MV3 / recarga de extensión):
// - A veces Chrome invalida el "contexto" del content-script si la extensión se recarga
//   pero la pestaña NO se recargó.
// - En ese caso, llamadas como storage.set o runtime.* pueden fallar.
// - Por eso blindamos esos handlers con safeExtCall() y mostramos un toast.
//
// NOTA SOBRE "NO LEERNOS A NOSOTROS":
// - Nuestro overlay está dentro de #kathware-overlay-root.
// - Los motores VISUAL/adapters filtran nodos con closest("#kathware-overlay-root", etc).
//   Eso evita que el lector agarre el texto de nuestra UI.
//
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.overlay) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;

  // Helpers básicos (si utils no está por alguna razón, ponemos fallback)
  const clamp = KWSR.utils?.clamp || ((n, min, max) => Math.min(max, Math.max(min, n)));
  const isTyping =
    KWSR.utils?.isTyping ||
    (() => {
      const ae = document.activeElement;
      if (!ae) return false;
      const tag = (ae.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (ae.isContentEditable) return true;
      return false;
    });

  // ------------------------------------------------------------
  // 1) Manejo de error: "Extension context invalidated"
  // ------------------------------------------------------------

  // Detecta errores típicos cuando la extensión se recarga
  // pero la pestaña aún usa el content-script viejo (invalida el contexto).
  function isContextInvalidatedError(err) {
    const msg = String(err?.message || err || "");
    return (
      msg.includes("Extension context invalidated") ||
      msg.includes("context invalidated") ||
      msg.includes("message channel closed") ||
      msg.includes("The message port closed")
    );
  }

  // Muestra aviso amigable y esconde UI para evitar comportamientos raros
  function notifyReloadNeeded() {
    try {
      KWSR.toast?.notify?.("⚠️ La extensión se recargó. Recargá la página (F5) y probá de nuevo.");
    } catch {}

    // Escondemos el panel y el root para que el usuario no interactúe con algo roto
    try {
      if (S.overlayPanel) S.overlayPanel.style.display = "none";
    } catch {}
    try {
      if (S.overlayRoot) S.overlayRoot.style.display = "none";
    } catch {}
  }

  // Wrapper para ejecutar llamadas que dependen del runtime/storage de la extensión.
  // Si el contexto está invalidado, avisamos y no reventamos.
  function safeExtCall(fn) {
    try {
      // En Chrome MV3: si chrome.runtime existe pero runtime.id no,
      // suele indicar invalidación del contexto.
      if (typeof chrome !== "undefined" && chrome?.runtime && !chrome.runtime.id) {
        throw new Error("Extension context invalidated.");
      }
      return fn();
    } catch (e) {
      if (isContextInvalidatedError(e)) {
        notifyReloadNeeded();
        return;
      }
      // Si no es ese error específico, lo re-lanzamos para no ocultar bugs reales.
      throw e;
    }
  }

  // ------------------------------------------------------------
  // 2) Construcción del overlay (root + panel + pill)
  // ------------------------------------------------------------

  // Crea el overlay completo SOLO si todavía no existe.
  function ensureOverlay() {
    if (S.overlayRoot) return;

    // Root: contenedor fijo, arriba de todo (zIndex máximo)
    const root = document.createElement("div");
    root.id = "kathware-overlay-root";
    Object.assign(root.style, {
      position: "fixed",
      right: "14px",
      bottom: "14px",
      zIndex: "2147483647",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      display: "none" // arranca oculto, el pipeline lo muestra al activar ON
    });

    // Panel: se muestra/oculta al abrir/cerrar desde pill u hotkey
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

    // Estado (ON/OFF + modo + fuente + plataforma + info track)
    const status = document.createElement("div");
    Object.assign(status.style, { opacity: ".9", fontSize: "13px", marginBottom: "6px" });

    // Texto: último subtítulo leído (solo feedback visual)
    const text = document.createElement("div");
    Object.assign(text.style, { whiteSpace: "pre-wrap", fontSize: "16px", lineHeight: "1.35" });

    // Settings row: modo + fuente
    const settingsRow = document.createElement("div");
    Object.assign(settingsRow.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "8px",
      marginTop: "10px"
    });

    // Select Modo
    const modoSelect = document.createElement("select");
    modoSelect.setAttribute("aria-label", "Modo de lectura");
    modoSelect.innerHTML = `
      <option value="off">Desactivado</option>
      <option value="sintetizador">Voz</option>
      <option value="lector">Lector</option>
    `;

    // Select Fuente
    const fuenteSelect = document.createElement("select");
    fuenteSelect.setAttribute("aria-label", "Fuente de texto");
    fuenteSelect.innerHTML = `
      <option value="auto">Auto</option>
      <option value="track">TRACK</option>
      <option value="visual">VISUAL</option>
    `;

    settingsRow.append(modoSelect, fuenteSelect);

    // Select Track: se llena según video.textTracks
    const trackSelect = document.createElement("select");
    trackSelect.setAttribute("aria-label", "Pista de subtítulos");
    trackSelect.style.marginTop = "8px";
    trackSelect.innerHTML = `<option value="0">Pista 1</option>`;

    // Controles del reproductor (botones)
    const controlsRow = document.createElement("div");
    Object.assign(controlsRow.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      marginTop: "10px"
    });

    // Helper para crear botones de forma consistente
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

    // Botones básicos (operan sobre S.currentVideo)
    const btnPlay  = mkBtn("▶️", () => S.currentVideo?.play?.(), "Reproducir");
    const btnPause = mkBtn("⏸️", () => S.currentVideo?.pause?.(), "Pausar");
    const btnBack  = mkBtn("⏪", () => seekBy(-CFG.seekBig), "Atrasar 10 segundos");
    const btnFwd   = mkBtn("⏩", () => seekBy(+CFG.seekBig), "Adelantar 10 segundos");
    const btnMute  = mkBtn("M",   () => toggleMute(), "Silenciar / Activar sonido");
    const btnCC    = mkBtn("C",   () => toggleCaptions(), "Subtítulos");
    const btnFull  = mkBtn("⛶",  () => requestFull(), "Pantalla completa");
    const btnClose = mkBtn("Cerrar", () => setPanelOpen(false), "Cerrar panel");

    controlsRow.append(btnPlay, btnPause, btnBack, btnFwd, btnMute, btnCC, btnFull, btnClose);

    // Composición del panel
    panel.append(status, text, settingsRow, trackSelect, controlsRow);

    // Pill: botón redondo "KW"
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

    // Click: toggle panel abierto/cerrado
    pill.addEventListener("click", () => {
      const open = panel.style.display !== "none";
      setPanelOpen(!open);
    });

    // Montaje final en el DOM
    root.append(panel, pill);
    document.documentElement.appendChild(root);

    // Guardamos referencias en el estado global
    S.overlayRoot = root;
    S.overlayPanel = panel;
    S.overlayPill = pill;
    S.overlayStatus = status;
    S.overlayText = text;
    S.overlayTrackSelect = trackSelect;
    S.overlayModoSelect = modoSelect;
    S.overlayFuenteSelect = fuenteSelect;

    // ------------------------------------------------------------
    // 3) Listeners (configuración) - BLINDADOS con safeExtCall
    // ------------------------------------------------------------

    // Cambiar modo (lector / sintetizador / off)
    modoSelect.addEventListener("change", () => {
      safeExtCall(() => {
        S.modoNarradorGlobal = modoSelect.value;

        // Persistimos para que el popup y la próxima carga lo recuerden
        KWSR.api?.storage?.local?.set?.({ modoNarrador: S.modoNarradorGlobal });

        // Si el usuario apaga, detenemos lectura inmediatamente
        if (S.modoNarradorGlobal === "off") KWSR.voice?.detenerLectura?.();

        updateOverlayStatus();
      });
    });

    // Cambiar fuente (auto / track / visual)
    fuenteSelect.addEventListener("change", () => {
      safeExtCall(() => {
        S.fuenteSubGlobal = fuenteSelect.value;
        KWSR.api?.storage?.local?.set?.({ fuenteSub: S.fuenteSubGlobal });

        // Si está ON, reiniciamos pipeline para aplicar cambio
        if (S.extensionActiva) KWSR.pipeline?.restartPipeline?.();

        updateOverlayStatus();
      });
    });

    // Cambiar pista (si existen tracks)
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

  // ------------------------------------------------------------
  // 4) Mostrar / ocultar overlay y panel
  // ------------------------------------------------------------

  // Muestra/oculta root entero (pill + panel)
  function setOverlayVisible(visible) {
    if (!S.overlayRoot) return;
    S.overlayRoot.style.display = visible ? "block" : "none";
    if (!visible) {
      try { S.overlayPanel.style.display = "none"; } catch {}
    }
  }

  // Abre/cierra panel
  function setPanelOpen(open) {
    ensureOverlay();
    setOverlayVisible(true);
    S.overlayPanel.style.display = open ? "block" : "none";
  }

  // Actualiza texto leído (solo feedback visual)
  function updateOverlayText(t) {
    if (!S.overlayRoot) return;
    S.overlayText.textContent = t || "";

    // Si está activado en config, abrir panel cuando llegan subtítulos
    if (CFG.autoOpenPanelOnSubs && t && String(t).trim()) setPanelOpen(true);
  }

  // ------------------------------------------------------------
  // 5) Tracks list + status
  // ------------------------------------------------------------

  function describeTrack(t) {
    if (!t) return "Sin track";
    let cuesLen = "?";
    try { cuesLen = t.cues ? t.cues.length : 0; } catch {}
    return `${t.label || "(sin label)"} lang=${t.language || "??"} mode=${t.mode} cues=${cuesLen}`;
  }

  // Carga las pistas disponibles del video principal
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

  // Línea de estado (para que el usuario entienda qué está pasando)
  function updateOverlayStatus() {
    if (!S.overlayRoot) return;

    const label =
      KWSR.platforms?.platformLabel?.(KWSR.platforms?.getPlatform?.() || "generic") || "Sitio";

    const enabled = S.extensionActiva ? "🟢 ON" : "🔴 OFF";

    const modeEmoji =
      S.modoNarradorGlobal === "lector" ? "🧏" :
      S.modoNarradorGlobal === "sintetizador" ? "🗣️" : "🙊";

    const src =
      S.fuenteSubGlobal === "track" ? "🎛️TRACK"
      : S.fuenteSubGlobal === "visual" ? "👀VISUAL"
      : `🤖AUTO→${String(S.effectiveFuente || "visual").toUpperCase()}`;

    const trackInfo = S.currentTrack ? describeTrack(S.currentTrack) : "Sin track";

    // Sincronizamos selects con el estado actual
    if (S.overlayModoSelect) S.overlayModoSelect.value = S.modoNarradorGlobal;
    if (S.overlayFuenteSelect) S.overlayFuenteSelect.value = S.fuenteSubGlobal;

    S.overlayStatus.textContent = `${enabled} ${modeEmoji} | ${src} | ${label} | ${trackInfo}`;
  }

  // ------------------------------------------------------------
  // 6) Helpers del reproductor (botones + hotkeys)
  // ------------------------------------------------------------

  // Salto en tiempo (seek)
  function seekBy(delta) {
    const v = S.currentVideo;
    if (!v) return;
    try {
      const dur = Number.isFinite(v.duration) ? v.duration : (v.currentTime + delta);
      v.currentTime = clamp((v.currentTime || 0) + delta, 0, dur);
    } catch {}
  }

  // Mute/unmute
  function toggleMute() {
    const v = S.currentVideo;
    if (!v) return;
    try { v.muted = !v.muted; } catch {}
  }

  // Fullscreen (puede romper lectura en algunos sitios)
  function requestFull() {
    const v = S.currentVideo;
    if (!v) return;

    KWSR.toast?.notify?.("⚠️ En pantalla completa la lectura automática puede fallar.");
    try { v.requestFullscreen?.(); } catch {}
  }

  // Toggle captions (si hay tracks accesibles)
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

  // Hotkeys del reproductor (cuando el panel está abierto, o cuando la plataforma lo necesita)
  function handlePlayerHotkeys(e) {
    if (!S.extensionActiva) return false;
    if (isTyping()) return false;

    // No queremos chocar con combinaciones del sistema/lectores
    if (e.ctrlKey || e.altKey || e.metaKey) return false;

    const panelOpen = S.overlayPanel && S.overlayPanel.style.display !== "none";

    // Por defecto: hotkeys del player solo si panel está abierto.
    // Excepción: plataformas con UI difícil (nonAccessibleFixes).
    const p = KWSR.platforms?.getPlatform?.() || "generic";
    const caps =
      KWSR.platforms?.platformCapabilities?.(p) || { keepAlive: false, nonAccessibleFixes: false };

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

  // Export público del módulo
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

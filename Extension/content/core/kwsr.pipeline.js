// ====================================================
// KathWare SubtitleReader - kwsr.pipeline.js
// - Control del pipeline: timers, rehook, toggle, init
// - Importante: NO crea UI hasta que el usuario active (ON)
// - Integra adapters:
//    - KWSR.keepAlive.tick() (controles visibles)
//    - KWSR.nonAccessiblePlatforms.* (fixes UI no accesible)
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.pipeline) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;

  const getPlatform = () => KWSR.platforms?.getPlatform?.() || "generic";
  const platformLabel = (p) => KWSR.platforms?.platformLabel?.(p) || "Sitio";
  const getCaps = (p) => KWSR.platforms?.platformCapabilities?.(p) || {};

  function stopTimers() {
    try { clearInterval(S.pollTimerTrack); } catch {}
    try { clearInterval(S.rehookTimer); } catch {}
    try { clearInterval(S.pollTimerVisual); } catch {}
    try { clearInterval(S.visualReselectTimer); } catch {}
    try { clearInterval(S.adaptersTimer); } catch {}
    S.pollTimerTrack = S.rehookTimer = S.pollTimerVisual = S.visualReselectTimer = S.adaptersTimer = null;
  }

  function stopAll() {
    stopTimers();

    // adapters teardown
    try { KWSR.nonAccessiblePlatforms?.stopMenuObserver?.(); } catch {}

    // track teardown
    try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
    S.currentTrack = null;

    // visual teardown
    try { KWSR.visual?.stopVisualObserver?.(); } catch {}
    S.visualNode = null;
    S.visualSelectors = null;

    // voice teardown
    try { KWSR.voice?.detenerLectura?.(); } catch {}
  }

  function startTimers() {
    stopTimers();

    // Rehook: detecta cambios de video/track/selector
    S.rehookTimer = setInterval(() => rehookTick(), CFG.rehookMs);

    // Track polling fallback
    S.pollTimerTrack = setInterval(() => {
      KWSR.track?.pollTrackTick?.();
    }, CFG.pollMsTrack);

    // Visual polling fallback
    S.pollTimerVisual = setInterval(() => {
      KWSR.visual?.pollVisualTick?.();
    }, CFG.pollMsVisual);

    // Visual reselection (si estamos en visual)
    S.visualReselectTimer = setInterval(() => {
      if (!S.extensionActiva) return;
      if (S.effectiveFuente !== "visual") return;
      KWSR.visual?.visualReselectTick?.();
    }, CFG.visualReselectMs);

    // Adapters: keepAlive + nonAccessible ticks (gated por capabilities)
    S.adaptersTimer = setInterval(() => {
      // mantén controles visibles en plataformas que lo necesiten
      KWSR.keepAlive?.tick?.();

      // etiquetas dinámicas / menús audio-subs (solo si caps lo pide)
      KWSR.nonAccessiblePlatforms?.tick?.();
    }, CFG.adaptersMs);

    // Menús: observer solo si la plataforma declara fixes no accesibles
    const caps = getCaps(getPlatform());
    if (caps.nonAccessibleFixes) KWSR.nonAccessiblePlatforms?.startMenuObserver?.();
  }

  function restartPipeline() {
    // track reset
    try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
    S.currentTrack = null;

    // visual reset
    try { KWSR.visual?.stopVisualObserver?.(); } catch {}
    S.visualNode = null;
    S.visualSelectors = null;

    // dedupe reset
    S.lastTrackSeen = "";
    S.lastVisualSeen = "";
    S.lastEmitText = "";
    S.lastEmitAt = 0;

    // recompute
    S.effectiveFuente = "visual";
    S.lastSig = "";

    rehookTick();
    KWSR.overlay?.updateOverlayTracksList?.();
    KWSR.overlay?.updateOverlayStatus?.();
  }

  // ✅ Solo crea/actualiza UI cuando visible=true
  function setUIVisible(visible) {
    if (!visible) {
      // Ocultar todo (si existe) + cerrar panel
      KWSR.overlay?.setPanelOpen?.(false);
      KWSR.overlay?.setOverlayVisible?.(false);
      return;
    }

    // Crear overlay SOLO cuando ON
    KWSR.overlay?.ensureOverlay?.();
    KWSR.overlay?.setOverlayVisible?.(true);

    KWSR.overlay?.setPanelOpen?.(false); // panel cerrado por defecto
    KWSR.overlay?.updateOverlayTracksList?.();
    KWSR.overlay?.updateOverlayStatus?.();
  }

  function computeSignature(v, t) {
    const vSig = v ? (v.currentSrc || v.src || "v") : "noV";
    const tSig = t ? (t.label + "|" + t.language + "|" + t.mode) : "noT";
    let cues = 0;
    try { cues = t?.cues?.length || 0; } catch {}
    return `${vSig}|${tSig}|${cues}`;
  }

  function rehookTick() {
    // 1) video main
    const v = KWSR.video?.getMainVideo?.() || null;
    if (v !== S.currentVideo) {
      S.currentVideo = v;

      S.lastTrackSeen = "";
      S.lastVisualSeen = "";

      try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
      S.currentTrack = null;

      S.visualNode = null;
      S.visualSelectors = null;
      try { KWSR.visual?.stopVisualObserver?.(); } catch {}

      KWSR.overlay?.updateOverlayTracksList?.();
      KWSR.overlay?.updateOverlayStatus?.();
    }

    if (!S.extensionActiva) return;

    // 2) elegir fuente efectiva
    const hasUsableTracks = KWSR.track?.videoHasUsableTracks?.(S.currentVideo) || false;

    S.effectiveFuente =
      S.fuenteSubGlobal === "auto"
        ? (hasUsableTracks ? "track" : "visual")
        : (S.fuenteSubGlobal === "track" ? "track" : "visual");

    // 3) limpiar pipeline contrario
    if (S.effectiveFuente === "track") {
      try { KWSR.visual?.stopVisualObserver?.(); } catch {}
      S.visualNode = null;
      S.visualSelectors = null;
    } else {
      try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
      S.currentTrack = null;
    }

    // 4) signature
    const bestTrack = (S.effectiveFuente === "track")
      ? (KWSR.track?.pickBestTrack?.(S.currentVideo) || null)
      : null;

    const sig = computeSignature(S.currentVideo, bestTrack);

    if (sig !== S.lastSig) {
      S.lastSig = sig;

      if (S.effectiveFuente === "track") {
        const ok = KWSR.track?.startTrack?.();
        if (!ok) {
          S.effectiveFuente = "visual";
          KWSR.visual?.startVisual?.();
        }
      } else {
        KWSR.visual?.startVisual?.();
      }

      KWSR.overlay?.updateOverlayStatus?.();
    }

    // Si aplica fixes para UI no accesible, etiquetamos controles (sin hardcode por plataforma)
    const caps = getCaps(getPlatform());
    if (caps.nonAccessibleFixes) KWSR.nonAccessiblePlatforms?.labelControlsNearVideo?.();
  }

  function toggleExtension() {
    S.extensionActiva = !S.extensionActiva;
    const p = getPlatform();
    const label = platformLabel(p);

    if (S.extensionActiva) {
      KWSR.log?.("Toggle ON", { platform: p });

      // ✅ recién ahora creamos UI visible
      setUIVisible(true);

      KWSR.voice?.cargarVozES?.();
      KWSR.toast?.notify?.(`🟢 KathWare ON — ${label}`);

      startTimers();
      S.effectiveFuente = "visual";
      rehookTick();
    } else {
      KWSR.log?.("Toggle OFF", { platform: p });

      KWSR.toast?.notify?.(`🔴 KathWare OFF — ${label}`);
      stopAll();

      // ✅ ocultar UI (sin dejar pill/panel)
      setUIVisible(false);
    }
  }

  function init() {
    // ✅ NO crear UI en init
    const after = () => {
      S.currentVideo = KWSR.video?.getMainVideo?.() || null;
      KWSR.log?.("content cargado (UI lazy)", { host: location.hostname, platform: getPlatform() });
      // No overlay, no panel, no live region.
    };

    if (KWSR.storage?.cargarConfigDesdeStorage) {
      KWSR.storage.cargarConfigDesdeStorage(after);
    } else {
      after();
    }
  }

  KWSR.pipeline = {
    init,
    toggleExtension,
    restartPipeline,
    rehookTick,
    startTimers,
    stopAll,
    setUIVisible
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Rebrand: KWMP -> KWSR.
  - Se eliminó el hardcode “flow” del pipeline.
  - Nuevo timer unificado para adapters (CFG.adaptersMs):
      - KWSR.keepAlive.tick() -> mantiene visibles controles que se esconden
      - KWSR.nonAccessiblePlatforms.tick() -> autolabeling de controles cerca del video
  - Menús audio/subs: startMenuObserver/stopMenuObserver ahora dependen de
    platformCapabilities().nonAccessibleFixes (no del hostname “flow”).
  - rehookTick: sigue el mismo esquema (AUTO -> TRACK si hay pistas usables, si no VISUAL),
    pero al final aplica fixes genéricos si capabilities lo pide.
  - UI sigue siendo lazy: NO se crea overlay hasta que el usuario activa (ON).
  */
})();

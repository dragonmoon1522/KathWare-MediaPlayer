// ----------------------------------------------------
// KathWare SubtitleReader - kwsr.pipeline.js
// ----------------------------------------------------
//
// QUÉ ES ESTE ARCHIVO
// -------------------
// Este módulo es el “director de orquesta” del sistema.
// En vez de hacer cosas por sí solo, decide:
//
// - cuándo la extensión está ON u OFF
// - si usamos subtítulos TRACK o VISUAL
// - qué timers están activos
// - cuándo reiniciar motores
// - cómo evitar lecturas duplicadas
//
// Pensalo como un coordinador, no como un motor.
//
// OBJETIVO CLAVE
// --------------
// - Evitar duplicados de lectura
// - Evitar timers corriendo de más
// - Reaccionar bien a cambios reales de video
//
// CONCEPTO IMPORTANTE
// -------------------
// "Pipeline" = flujo de ejecución.
// No es un loop infinito descontrolado,
// sino una secuencia de decisiones bien delimitadas.
// ----------------------------------------------------

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.pipeline) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG || {};

  // --------------------------------------------------
  // Helpers de plataforma
  // --------------------------------------------------
  const getPlatform = () =>
    KWSR.platforms?.getPlatform?.() || "generic";

  const platformLabel = (p) =>
    KWSR.platforms?.platformLabel?.(p) || "Sitio";

  const getCaps = (p) =>
    KWSR.platforms?.platformCapabilities?.(p) || {};

  // --------------------------------------------------
  // Timings seguros (fallbacks)
  // --------------------------------------------------
  const POLL_TRACK_MS =
    Number.isFinite(CFG.pollMsTrack) ? CFG.pollMsTrack : 450;

  const POLL_VISUAL_MS =
    Number.isFinite(CFG.pollMsVisual) ? CFG.pollMsVisual : 650;

  const REHOOK_MS =
    Number.isFinite(CFG.rehookMs) ? CFG.rehookMs : 900;

  const ADAPTERS_MS =
    Number.isFinite(CFG.adaptersMs) ? CFG.adaptersMs : 1200;

  const VISUAL_RESELECT_MS =
    Number.isFinite(CFG.visualReselectMs) ? CFG.visualReselectMs : 2600;

  // --------------------------------------------------
  // CAMBIO REAL DE VIDEO
  // --------------------------------------------------
  // Algunas plataformas reutilizan el mismo <video>
  // pero cambian el contenido (src).
  // Por eso usamos una "key" del contenido.
  // --------------------------------------------------
  function getVideoContentKey(v) {
    try {
      if (!v) return "noVideo";
      return String(v.currentSrc || v.src || "noSrc");
    } catch {
      return "noVideo";
    }
  }

  function isBigVideoChange(nextVideo) {
    const prevVideo = S.currentVideo || null;
    const prevKey = S.currentVideoKey || getVideoContentKey(prevVideo);
    const nextKey = getVideoContentKey(nextVideo);

    return (
      nextVideo !== prevVideo ||
      (nextKey && nextKey !== prevKey)
    );
  }

  function markCurrentVideo(v) {
    S.currentVideo = v || null;
    S.currentVideoKey = getVideoContentKey(v);
  }

  // --------------------------------------------------
  // TIMERS: APAGAR TODO
  // --------------------------------------------------
  function stopTimers() {
    try { clearInterval(S.rehookTimer); } catch {}
    try { clearInterval(S.pollTimerTrack); } catch {}
    try { clearInterval(S.pollTimerVisual); } catch {}
    try { clearInterval(S.visualReselectTimer); } catch {}
    try { clearInterval(S.adaptersTimer); } catch {}

    S.rehookTimer = null;
    S.pollTimerTrack = null;
    S.pollTimerVisual = null;
    S.visualReselectTimer = null;
    S.adaptersTimer = null;
  }

  // --------------------------------------------------
  // APAGADO TOTAL
  // --------------------------------------------------
  // Se usa SOLO cuando:
  // - apagamos la extensión
  // - reiniciamos completamente el sistema
  // --------------------------------------------------
  function stopAll() {
    stopTimers();

    try { KWSR.nonAccessiblePlatforms?.stopMenuObserver?.(); } catch {}

    try {
      if (S.currentTrack) S.currentTrack.oncuechange = null;
    } catch {}
    S.currentTrack = null;

    try { KWSR.visual?.stopVisualObserver?.(); } catch {}
    S.visualNode = null;
    S.visualSelectors = null;

    try { KWSR.visual?.resetVisualDedupe?.(); } catch {}
    try { KWSR.voice?.detenerLectura?.(); } catch {}
  }

  // --------------------------------------------------
  // ASEGURAR TIMERS SEGÚN FUENTE ACTIVA
  // --------------------------------------------------
  function ensureSourceTimers() {
    const wantTrack =
      S.extensionActiva && S.effectiveFuente === "track";

    const wantVisual =
      S.extensionActiva && S.effectiveFuente === "visual";

    if (!wantTrack && S.pollTimerTrack) {
      clearInterval(S.pollTimerTrack);
      S.pollTimerTrack = null;
    }

    if (wantTrack && !S.pollTimerTrack) {
      S.pollTimerTrack = setInterval(() => {
        KWSR.track?.pollTrackTick?.();
      }, POLL_TRACK_MS);
    }

    if (!wantVisual && S.pollTimerVisual) {
      clearInterval(S.pollTimerVisual);
      S.pollTimerVisual = null;
    }

    if (wantVisual && !S.pollTimerVisual) {
      S.pollTimerVisual = setInterval(() => {
        KWSR.visual?.pollVisualTick?.();
      }, POLL_VISUAL_MS);
    }

    if (!wantVisual && S.visualReselectTimer) {
      clearInterval(S.visualReselectTimer);
      S.visualReselectTimer = null;
    }

    if (wantVisual && !S.visualReselectTimer) {
      S.visualReselectTimer = setInterval(() => {
        if (!S.extensionActiva) return;
        if (S.effectiveFuente !== "visual") return;
        KWSR.visual?.visualReselectTick?.();
      }, VISUAL_RESELECT_MS);
    }
  }

  // --------------------------------------------------
  // START TIMERS BASE
  // --------------------------------------------------
  function startTimers() {
    stopTimers();

    S.rehookTimer = setInterval(rehookTick, REHOOK_MS);

    S.adaptersTimer = setInterval(() => {
      KWSR.keepAlive?.tick?.();
      KWSR.nonAccessiblePlatforms?.tick?.();
    }, ADAPTERS_MS);

    const caps = getCaps(getPlatform());
    if (caps.nonAccessibleFixes) {
      try {
        KWSR.nonAccessiblePlatforms?.startMenuObserver?.();
      } catch {}
    }

    ensureSourceTimers();
  }

  // --------------------------------------------------
  // REINICIO FUERTE (pedido del usuario)
  // --------------------------------------------------
  function restartPipeline() {
    try { KWSR.voice?.detenerLectura?.(); } catch {}

    try {
      if (S.currentTrack) S.currentTrack.oncuechange = null;
    } catch {}
    S.currentTrack = null;

    try { KWSR.visual?.stopVisualObserver?.(); } catch {}
    try { KWSR.visual?.resetVisualDedupe?.(); } catch {}

    S.visualNode = null;
    S.visualSelectors = null;

    S.lastTrackSeen = "";
    S.lastVisualSeen = "";
    S.lastSig = "";
    S.effectiveFuente = "visual";

    rehookTick();
    ensureSourceTimers();

    KWSR.overlay?.updateOverlayTracksList?.();
    KWSR.overlay?.updateOverlayStatus?.();
  }

  // --------------------------------------------------
  // UI LAZY (solo cuando está ON)
  // --------------------------------------------------
  function setUIVisible(visible) {
    if (!visible) {
      KWSR.overlay?.setPanelOpen?.(false);
      KWSR.overlay?.setOverlayVisible?.(false);
      return;
    }

    KWSR.overlay?.ensureOverlay?.();
    KWSR.overlay?.setOverlayVisible?.(true);
    KWSR.overlay?.setPanelOpen?.(false);
    KWSR.overlay?.updateOverlayTracksList?.();
    KWSR.overlay?.updateOverlayStatus?.();
  }

  // --------------------------------------------------
  // FIRMA DEL ESTADO ACTUAL
  // --------------------------------------------------
  function computeSignature(video, track) {
    const vSig =
      video ? (video.currentSrc || video.src || "video") : "noVideo";

    const tSig =
      track ? `${track.label}|${track.language}|${track.mode}` : "noTrack";

    let cues = 0;
    try { cues = track?.cues?.length || 0; } catch {}

    return `${vSig}|${tSig}|${cues}`;
  }

  // --------------------------------------------------
  // DECIDIR FUENTE EFECTIVA
  // --------------------------------------------------
  function pickEffectiveSource(video) {
    const hasTracks =
      KWSR.track?.videoHasUsableTracks?.(video) || false;

    const requested = S.fuenteSubGlobal || "auto";

    if (requested === "auto") {
      return hasTracks ? "track" : "visual";
    }
    return requested;
  }

  // --------------------------------------------------
  // REHOOK TICK (corazón del pipeline)
  // --------------------------------------------------
  function rehookTick() {
    const v = KWSR.video?.getMainVideo?.() || null;

    if (isBigVideoChange(v)) {
      markCurrentVideo(v);

      S.lastTrackSeen = "";
      S.lastVisualSeen = "";
      S.lastSig = "";

      try {
        if (S.currentTrack) S.currentTrack.oncuechange = null;
      } catch {}
      S.currentTrack = null;

      try { KWSR.visual?.stopVisualObserver?.(); } catch {}
      try { KWSR.visual?.resetVisualDedupe?.(); } catch {}

      S.visualNode = null;
      S.visualSelectors = null;

      ensureSourceTimers();

      KWSR.overlay?.updateOverlayTracksList?.();
      KWSR.overlay?.updateOverlayStatus?.();
    } else {
      if (v !== S.currentVideo) markCurrentVideo(v);
    }

    if (!S.extensionActiva) return;

    const nextFuente = pickEffectiveSource(S.currentVideo);

    if (nextFuente !== S.effectiveFuente) {
      S.effectiveFuente = nextFuente;

      if (nextFuente === "track") {
        try { KWSR.visual?.stopVisualObserver?.(); } catch {}
      } else {
        try {
          if (S.currentTrack) S.currentTrack.oncuechange = null;
        } catch {}
        S.currentTrack = null;
      }

      ensureSourceTimers();
      S.lastSig = "";
    }

    const bestTrack =
      S.effectiveFuente === "track"
        ? KWSR.track?.pickBestTrack?.(S.currentVideo) || null
        : null;

    const sig = computeSignature(S.currentVideo, bestTrack);

    if (sig !== S.lastSig) {
      S.lastSig = sig;

      if (S.effectiveFuente === "track") {
        const ok = KWSR.track?.startTrack?.();
        if (!ok) {
          S.effectiveFuente = "visual";
          ensureSourceTimers();
          KWSR.visual?.startVisual?.();
        }
      } else {
        KWSR.visual?.startVisual?.();
      }

      KWSR.overlay?.updateOverlayStatus?.();
    }

    const caps = getCaps(getPlatform());
    if (caps.nonAccessibleFixes) {
      try {
        KWSR.nonAccessiblePlatforms?.labelControlsNearVideo?.();
      } catch {}
    }
  }

  // --------------------------------------------------
  // TOGGLE ON / OFF
  // --------------------------------------------------
  function toggleExtension() {
    S.extensionActiva = !S.extensionActiva;

    const p = getPlatform();
    const label = platformLabel(p);

    if (S.extensionActiva) {
      setUIVisible(true);

      try { KWSR.voice?.detenerLectura?.(); } catch {}
      try { KWSR.visual?.resetVisualDedupe?.(); } catch {}

      S.lastTrackSeen = "";
      S.lastVisualSeen = "";
      S.lastSig = "";

      KWSR.voice?.cargarVozES?.();
      KWSR.toast?.notify?.(`🟢 KathWare ON — ${label}`);

      markCurrentVideo(KWSR.video?.getMainVideo?.() || null);
      startTimers();
      S.effectiveFuente = "visual";
      rehookTick();

    } else {
      KWSR.toast?.notify?.(`🔴 KathWare OFF — ${label}`);
      stopAll();
      setUIVisible(false);
    }
  }

  // --------------------------------------------------
  // INIT (se ejecuta una sola vez)
  // --------------------------------------------------
  function init() {
    const after = () => {
      markCurrentVideo(KWSR.video?.getMainVideo?.() || null);

      if (!S.fuenteSubGlobal) S.fuenteSubGlobal = "auto";
      if (!S.modoNarradorGlobal) S.modoNarradorGlobal = "lector";

      KWSR.log?.("content cargado (pipeline listo)", {
        host: location.hostname,
        platform: getPlatform()
      });
    };

    if (KWSR.storage?.cargarConfigDesdeStorage) {
      KWSR.storage.cargarConfigDesdeStorage(after);
    } else {
      after();
    }
  }

  // --------------------------------------------------
  // EXPORT
  // --------------------------------------------------
  KWSR.pipeline = {
    init,
    toggleExtension,
    restartPipeline,
    rehookTick,
    startTimers,
    stopAll,
    setUIVisible
  };

})();
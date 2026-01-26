// ====================================================
// KathWare SubtitleReader - kwsr.pipeline.js
// ====================================================
//
// Este módulo es el "director de orquesta" (pipeline).
// Pipeline, en español, sería algo como:
//   "cadena de procesamiento" o "flujo de ejecución".
// Acá coordinamos:
// - cuándo la extensión está ON/OFF
// - qué motor usa (TRACK o VISUAL)
// - timers (intervalos) y reinicios
// - rehook: detectar cambios importantes del reproductor
//
// Objetivo clave (bug visible):
// - Evitar lecturas duplicadas (especialmente cuando VISUAL + timers + mutaciones).
//
// Cambio importante en esta versión:
// - Solo activamos el polling del motor que está activo (TRACK o VISUAL).
//   El otro polling NO corre, para evitar duplicados y trabajo innecesario.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.pipeline) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;

  const getPlatform = () => KWSR.platforms?.getPlatform?.() || "generic";
  const platformLabel = (p) => KWSR.platforms?.platformLabel?.(p) || "Sitio";
  const getCaps = (p) => KWSR.platforms?.platformCapabilities?.(p) || {};

  // ------------------------------------------------------------
  // Timers: los guardamos en state para poder apagarlos siempre
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // stopAll:
  // Apaga todo: timers + observers + track handlers + voz
  // ------------------------------------------------------------
  function stopAll() {
    stopTimers();

    // Adapters teardown
    try { KWSR.nonAccessiblePlatforms?.stopMenuObserver?.(); } catch {}

    // TRACK teardown
    try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
    S.currentTrack = null;

    // VISUAL teardown
    try { KWSR.visual?.stopVisualObserver?.(); } catch {}
    S.visualNode = null;
    S.visualSelectors = null;

    // VOICE teardown
    try { KWSR.voice?.detenerLectura?.(); } catch {}
  }

  // ------------------------------------------------------------
  // ensureSourceTimers:
  // Garantiza que SOLO exista el polling del motor efectivo.
  // Esto reduce lecturas duplicadas:
  // - Si el motor es VISUAL: NO se hace poll de TRACK.
  // - Si el motor es TRACK: NO se hace poll de VISUAL.
  //
  // Igual dejamos rehook siempre activo porque es el que detecta cambios.
  // ------------------------------------------------------------
  function ensureSourceTimers() {
    // Track poll
    const wantTrack = (S.extensionActiva && S.effectiveFuente === "track");
    if (!wantTrack && S.pollTimerTrack) {
      try { clearInterval(S.pollTimerTrack); } catch {}
      S.pollTimerTrack = null;
    }
    if (wantTrack && !S.pollTimerTrack) {
      S.pollTimerTrack = setInterval(() => {
        // Fallback polling (por si la plataforma no dispara oncuechange bien)
        KWSR.track?.pollTrackTick?.();
      }, CFG.pollMsTrack);
    }

    // Visual poll
    const wantVisual = (S.extensionActiva && S.effectiveFuente === "visual");
    if (!wantVisual && S.pollTimerVisual) {
      try { clearInterval(S.pollTimerVisual); } catch {}
      S.pollTimerVisual = null;
    }
    if (wantVisual && !S.pollTimerVisual) {
      S.pollTimerVisual = setInterval(() => {
        // Fallback polling (si el observer no existe o falla)
        KWSR.visual?.pollVisualTick?.();
      }, CFG.pollMsVisual);
    }

    // Visual reselection (solo tiene sentido en VISUAL)
    const wantReselect = (S.extensionActiva && S.effectiveFuente === "visual");
    if (!wantReselect && S.visualReselectTimer) {
      try { clearInterval(S.visualReselectTimer); } catch {}
      S.visualReselectTimer = null;
    }
    if (wantReselect && !S.visualReselectTimer) {
      S.visualReselectTimer = setInterval(() => {
        if (!S.extensionActiva) return;
        if (S.effectiveFuente !== "visual") return;
        KWSR.visual?.visualReselectTick?.();
      }, CFG.visualReselectMs);
    }
  }

  // ------------------------------------------------------------
  // startTimers:
  // Crea timers base:
  // - rehook (siempre)
  // - adapters (siempre)
  // - y luego delega en ensureSourceTimers() para track/visual
  // ------------------------------------------------------------
  function startTimers() {
    stopTimers();

    // Rehook: detecta cambios de video/track/selector
    S.rehookTimer = setInterval(() => rehookTick(), CFG.rehookMs);

    // Adapters: keepAlive + nonAccessible ticks (si capabilities lo pide)
    S.adaptersTimer = setInterval(() => {
      KWSR.keepAlive?.tick?.();
      KWSR.nonAccessiblePlatforms?.tick?.();
    }, CFG.adaptersMs);

    // Menús: observer solo si la plataforma declara fixes no accesibles
    const caps = getCaps(getPlatform());
    if (caps.nonAccessibleFixes) {
      try { KWSR.nonAccessiblePlatforms?.startMenuObserver?.(); } catch {}
    }

    // Importante: timers de fuente (TRACK/VISUAL) se manejan acá
    ensureSourceTimers();
  }

  // ------------------------------------------------------------
  // restartPipeline:
  // Reinicia el motor elegido (sin apagar toda la extensión).
  // Se usa cuando cambia settings (modo, fuente, track index).
  //
  // OJO: no reseteamos "todo el mundo", pero sí:
  // - desenganchamos track/observer
  // - reseteamos dedupe interno
  // - recomputamos y rehook
  // ------------------------------------------------------------
  function restartPipeline() {
    // Track reset
    try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
    S.currentTrack = null;

    // Visual reset
    try { KWSR.visual?.stopVisualObserver?.(); } catch {}
    S.visualNode = null;
    S.visualSelectors = null;

    // Dedupe reset (global)
    S.lastTrackSeen = "";
    S.lastVisualSeen = "";
    S.lastEmitText = "";
    S.lastEmitAt = 0;

    // Dedupe track (si existe)
    S.lastTrackKey = "";
    S.lastTrackAt = 0;

    // Recompute
    S.effectiveFuente = "visual"; // default seguro (rehook ajusta)
    S.lastSig = "";

    // Volvemos a enganchar lo que corresponda
    rehookTick();

    // Ajusta timers al motor efectivo (evita doble poll)
    ensureSourceTimers();

    // UI update
    KWSR.overlay?.updateOverlayTracksList?.();
    KWSR.overlay?.updateOverlayStatus?.();
  }

  // ------------------------------------------------------------
  // UI "lazy":
  // Solo creamos overlay si el usuario activó ON.
  // ------------------------------------------------------------
  function setUIVisible(visible) {
    if (!visible) {
      KWSR.overlay?.setPanelOpen?.(false);
      KWSR.overlay?.setOverlayVisible?.(false);
      return;
    }

    KWSR.overlay?.ensureOverlay?.();
    KWSR.overlay?.setOverlayVisible?.(true);

    // Panel cerrado por defecto
    KWSR.overlay?.setPanelOpen?.(false);
    KWSR.overlay?.updateOverlayTracksList?.();
    KWSR.overlay?.updateOverlayStatus?.();
  }

  // ------------------------------------------------------------
  // Signature:
  // "huella" del estado actual para saber si cambió algo importante
  // (cambio de video o de track seleccionado / cues).
  // Si cambia la firma -> reiniciamos el motor correspondiente.
  // ------------------------------------------------------------
  function computeSignature(v, t) {
    const vSig = v ? (v.currentSrc || v.src || "v") : "noV";
    const tSig = t ? (t.label + "|" + t.language + "|" + t.mode) : "noT";
    let cues = 0;
    try { cues = t?.cues?.length || 0; } catch {}
    return `${vSig}|${tSig}|${cues}`;
  }

  // ------------------------------------------------------------
  // pickEffectiveSource:
  // Decide si se usa TRACK o VISUAL.
  //
  // - Si user puso "auto":
  //     TRACK si hay tracks usables, si no VISUAL
  // - Si user forzó "track":
  //     TRACK
  // - Si user forzó "visual":
  //     VISUAL
  //
  // Nota: aunque el usuario pida TRACK, si no hay track usable,
  // el motor TRACK puede fallar y caemos a VISUAL.
  // ------------------------------------------------------------
  function pickEffectiveSource(video) {
    const hasUsableTracks = KWSR.track?.videoHasUsableTracks?.(video) || false;

    const requested = S.fuenteSubGlobal || "auto";

    if (requested === "auto") return hasUsableTracks ? "track" : "visual";
    if (requested === "track") return "track";
    return "visual";
  }

  // ------------------------------------------------------------
  // rehookTick:
  // Rehook = "reenganchar".
  // Cada X ms revisa:
  // - ¿cambió el video principal?
  // - ¿cambió la fuente efectiva?
  // - ¿cambió la firma? (video/track/cues)
  //
  // Si cambia algo importante:
  // - corta el motor anterior
  // - arranca el motor correcto
  // - ajusta timers para no duplicar lecturas
  // ------------------------------------------------------------
  function rehookTick() {
    // 1) Descubrir video principal
    const v = KWSR.video?.getMainVideo?.() || null;

    // Si el video cambió, reseteamos referencias y dedupe "visto"
    if (v !== S.currentVideo) {
      S.currentVideo = v;

      // Reset "lo último leído"
      S.lastTrackSeen = "";
      S.lastVisualSeen = "";

      // Desenganchar track anterior
      try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
      S.currentTrack = null;

      // Detener visual observer
      S.visualNode = null;
      S.visualSelectors = null;
      try { KWSR.visual?.stopVisualObserver?.(); } catch {}

      // UI update (si existe)
      KWSR.overlay?.updateOverlayTracksList?.();
      KWSR.overlay?.updateOverlayStatus?.();
    }

    // Si está OFF, no hacemos nada más.
    if (!S.extensionActiva) return;

    // 2) Elegir fuente efectiva
    const nextFuente = pickEffectiveSource(S.currentVideo);

    // Si cambia la fuente efectiva, cortamos el motor contrario
    if (nextFuente !== S.effectiveFuente) {
      S.effectiveFuente = nextFuente;

      if (S.effectiveFuente === "track") {
        // Cortar VISUAL
        try { KWSR.visual?.stopVisualObserver?.(); } catch {}
        S.visualNode = null;
        S.visualSelectors = null;
      } else {
        // Cortar TRACK
        try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
        S.currentTrack = null;
      }

      // Ajustar timers para que solo pollee el motor activo
      ensureSourceTimers();
    }

    // 3) Calcular signature del estado
    const bestTrack =
      (S.effectiveFuente === "track")
        ? (KWSR.track?.pickBestTrack?.(S.currentVideo) || null)
        : null;

    const sig = computeSignature(S.currentVideo, bestTrack);

    // 4) Si cambió firma -> arrancar motor correspondiente
    if (sig !== S.lastSig) {
      S.lastSig = sig;

      if (S.effectiveFuente === "track") {
        const ok = KWSR.track?.startTrack?.();
        if (!ok) {
          // Si TRACK no puede arrancar, caemos a VISUAL
          S.effectiveFuente = "visual";
          ensureSourceTimers();
          KWSR.visual?.startVisual?.();
        }
      } else {
        KWSR.visual?.startVisual?.();
      }

      KWSR.overlay?.updateOverlayStatus?.();
    }

    // 5) Fixes de UI no accesible (si aplica)
    const caps = getCaps(getPlatform());
    if (caps.nonAccessibleFixes) {
      try { KWSR.nonAccessiblePlatforms?.labelControlsNearVideo?.(); } catch {}
    }
  }

  // ------------------------------------------------------------
  // toggleExtension:
  // ON/OFF real de la extensión en la pestaña actual
  // ------------------------------------------------------------
  function toggleExtension() {
    S.extensionActiva = !S.extensionActiva;

    const p = getPlatform();
    const label = platformLabel(p);

    if (S.extensionActiva) {
      KWSR.log?.("Toggle ON", { platform: p });

      // UI recién cuando ON
      setUIVisible(true);

      KWSR.voice?.cargarVozES?.();
      KWSR.toast?.notify?.(`🟢 KathWare ON — ${label}`);

      // Timers base
      startTimers();

      // Fuente default antes de rehook (rehook decide final)
      S.effectiveFuente = "visual";
      S.lastSig = "";

      // Enganchar motores
      rehookTick();

    } else {
      KWSR.log?.("Toggle OFF", { platform: p });

      KWSR.toast?.notify?.(`🔴 KathWare OFF — ${label}`);

      // Apaga todo (motores + observers + timers)
      stopAll();

      // Oculta UI
      setUIVisible(false);
    }
  }

  // ------------------------------------------------------------
  // init:
  // Se ejecuta una vez cuando se carga el content script.
  // NO crea UI.
  // Solo carga settings y deja listo state.
  // ------------------------------------------------------------
  function init() {
    const after = () => {
      S.currentVideo = KWSR.video?.getMainVideo?.() || null;
      KWSR.log?.("content cargado (UI lazy)", {
        host: location.hostname,
        platform: getPlatform()
      });
      // Importante: no overlay, no panel, no live region en init.
    };

    if (KWSR.storage?.cargarConfigDesdeStorage) {
      KWSR.storage.cargarConfigDesdeStorage(after);
    } else {
      after();
    }
  }

  // Export
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

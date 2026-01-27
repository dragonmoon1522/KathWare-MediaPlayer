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
//
// Nota sobre dedupe (MUY importante):
// - El dedupe "histórico" de VISUAL no debe resetearse por micro-rehooks.
// - Solo lo reseteamos en eventos “grandes”:
//   * Toggle OFF/ON real
//   * Cambio de video (nuevo contenido)
//   * restartPipeline (reinicio fuerte por settings)
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.pipeline) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG || {};

  const getPlatform = () => KWSR.platforms?.getPlatform?.() || "generic";
  const platformLabel = (p) => KWSR.platforms?.platformLabel?.(p) || "Sitio";
  const getCaps = (p) => KWSR.platforms?.platformCapabilities?.(p) || {};

  // Defaults seguros (por si CFG no está completo)
  const POLL_TRACK_MS = Number.isFinite(CFG.pollMsTrack) ? CFG.pollMsTrack : 450;
  const POLL_VISUAL_MS = Number.isFinite(CFG.pollMsVisual) ? CFG.pollMsVisual : 650;
  const REHOOK_MS = Number.isFinite(CFG.rehookMs) ? CFG.rehookMs : 900;
  const ADAPTERS_MS = Number.isFinite(CFG.adaptersMs) ? CFG.adaptersMs : 1200;
  const VISUAL_RESELECT_MS = Number.isFinite(CFG.visualReselectMs) ? CFG.visualReselectMs : 2600;

  // ------------------------------------------------------------
  // Helpers: detectar “cambio de contenido” incluso si el <video> es el mismo
  // ------------------------------------------------------------
  function getVideoContentKey(v) {
    try {
      if (!v) return "noV";
      // Netflix/Max: a veces el nodo es el mismo pero currentSrc cambia
      const src = v.currentSrc || v.src || "";
      return String(src || "noSrc");
    } catch {
      return "noV";
    }
  }

  function isBigVideoChange(nextVideo) {
    // Big change = cambió el nodo, o cambió el contenido (src)
    const prevV = S.currentVideo || null;
    const prevKey = S.currentVideoKey || getVideoContentKey(prevV);
    const nextKey = getVideoContentKey(nextVideo);

    const nodeChanged = (nextVideo !== prevV);
    const contentChanged = (nextKey && nextKey !== prevKey);

    return nodeChanged || contentChanged;
  }

  function markCurrentVideo(nextVideo) {
    S.currentVideo = nextVideo || null;
    S.currentVideoKey = getVideoContentKey(nextVideo);
  }

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
  // (Esto es “apagado total”.)
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

    // Dedupe VISUAL histórico (apagado total => sí lo borramos)
    try { KWSR.visual?.resetVisualDedupe?.(); } catch {}

    // VOICE teardown (también limpia dedupe global/tts)
    try { KWSR.voice?.detenerLectura?.(); } catch {}
  }

  // ------------------------------------------------------------
  // ensureSourceTimers:
  // Garantiza que SOLO exista el polling del motor efectivo.
  // ------------------------------------------------------------
  function ensureSourceTimers() {
    // TRACK poll
    const wantTrack = (S.extensionActiva && S.effectiveFuente === "track");
    if (!wantTrack && S.pollTimerTrack) {
      try { clearInterval(S.pollTimerTrack); } catch {}
      S.pollTimerTrack = null;
    }
    if (wantTrack && !S.pollTimerTrack) {
      S.pollTimerTrack = setInterval(() => {
        KWSR.track?.pollTrackTick?.();
      }, POLL_TRACK_MS);
    }

    // VISUAL poll
    const wantVisual = (S.extensionActiva && S.effectiveFuente === "visual");
    if (!wantVisual && S.pollTimerVisual) {
      try { clearInterval(S.pollTimerVisual); } catch {}
      S.pollTimerVisual = null;
    }
    if (wantVisual && !S.pollTimerVisual) {
      S.pollTimerVisual = setInterval(() => {
        // Ojo: el visual poll NO debe hablar si el observer está activo (lo hace el módulo).
        KWSR.visual?.pollVisualTick?.();
      }, POLL_VISUAL_MS);
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
      }, VISUAL_RESELECT_MS);
    }
  }

  // ------------------------------------------------------------
  // startTimers:
  // Crea timers base:
  // - rehook (siempre)
  // - adapters (siempre)
  // - luego ensureSourceTimers() para track/visual
  // ------------------------------------------------------------
  function startTimers() {
    stopTimers();

    S.rehookTimer = setInterval(() => rehookTick(), REHOOK_MS);

    S.adaptersTimer = setInterval(() => {
      KWSR.keepAlive?.tick?.();
      KWSR.nonAccessiblePlatforms?.tick?.();
    }, ADAPTERS_MS);

    // Menús: observer solo si la plataforma declara fixes no accesibles
    const caps = getCaps(getPlatform());
    if (caps.nonAccessibleFixes) {
      try { KWSR.nonAccessiblePlatforms?.startMenuObserver?.(); } catch {}
    }

    ensureSourceTimers();
  }

  // ------------------------------------------------------------
  // restartPipeline:
  // Reinicio fuerte (settings cambiaron / modo cambió / etc.).
  // Acá SÍ reseteamos dedupe (porque el usuario “pidió reinicio”).
  // ------------------------------------------------------------
  function restartPipeline() {
    // Cortar salida (TTS / dedupe global) para reinicio limpio
    try { KWSR.voice?.detenerLectura?.(); } catch {}

    // TRACK reset
    try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
    S.currentTrack = null;

    // VISUAL reset (observer sí, dedupe sí porque es reinicio fuerte)
    try { KWSR.visual?.stopVisualObserver?.(); } catch {}
    try { KWSR.visual?.resetVisualDedupe?.(); } catch {}
    S.visualNode = null;
    S.visualSelectors = null;

    // Dedupe globals “vistos”
    S.lastTrackSeen = "";
    S.lastVisualSeen = "";

    // Firma y estado
    S.lastSig = "";
    S.effectiveFuente = "visual";

    // Reenganchar
    rehookTick();

    // Ajustar timers al motor efectivo
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
  // ------------------------------------------------------------
  function rehookTick() {
    // 1) Descubrir video principal
    const v = KWSR.video?.getMainVideo?.() || null;

    // Evento grande: cambió el video O cambió su contenido (src)
    if (isBigVideoChange(v)) {
      markCurrentVideo(v);

      S.lastTrackSeen = "";
      S.lastVisualSeen = "";

      // TRACK teardown
      try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
      S.currentTrack = null;

      // VISUAL teardown
      try { KWSR.visual?.stopVisualObserver?.(); } catch {}
      // ✅ reset dedupe visual SOLO acá (nuevo contenido real)
      try { KWSR.visual?.resetVisualDedupe?.(); } catch {}
      S.visualNode = null;
      S.visualSelectors = null;

      // Firma cambia seguro
      S.lastSig = "";

      // Al cambiar video, re-chequeamos timers por si cambia fuente
      // (ej: video nuevo ahora sí tiene tracks).
      ensureSourceTimers();

      // UI update (si existe)
      KWSR.overlay?.updateOverlayTracksList?.();
      KWSR.overlay?.updateOverlayStatus?.();
    } else {
      // Si no hubo big change, igual mantenemos currentVideo actualizado por seguridad
      // (por si el video fue null->same, o ref cambió pero key no).
      if (v !== S.currentVideo) markCurrentVideo(v);
    }

    // Si está OFF, no hacemos nada más.
    if (!S.extensionActiva) return;

    // 2) Elegir fuente efectiva
    const nextFuente = pickEffectiveSource(S.currentVideo);

    // Si cambia la fuente efectiva, cortamos el motor contrario
    if (nextFuente !== S.effectiveFuente) {
      S.effectiveFuente = nextFuente;

      if (S.effectiveFuente === "track") {
        // Cortar VISUAL (NO reseteamos dedupe histórico acá)
        try { KWSR.visual?.stopVisualObserver?.(); } catch {}
        S.visualNode = null;
        S.visualSelectors = null;
      } else {
        // Cortar TRACK
        try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
        S.currentTrack = null;
      }

      ensureSourceTimers();
      S.lastSig = ""; // fuerza arranque del motor correcto en este tick
    }

    // 3) Calcular signature
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

      // Encendido real => reinicio limpio de dedupe grande
      try { KWSR.voice?.detenerLectura?.(); } catch {}
      try { KWSR.visual?.resetVisualDedupe?.(); } catch {}
      S.lastTrackSeen = "";
      S.lastVisualSeen = "";
      S.lastSig = "";

      KWSR.voice?.cargarVozES?.();
      KWSR.toast?.notify?.(`🟢 KathWare ON — ${label}`);

      // Guardar video key apenas encendemos (evita primer rehook "fantasma")
      markCurrentVideo(KWSR.video?.getMainVideo?.() || null);

      startTimers();

      // Default antes de rehook (rehook decide final)
      S.effectiveFuente = "visual";

      rehookTick();

    } else {
      KWSR.log?.("Toggle OFF", { platform: p });
      KWSR.toast?.notify?.(`🔴 KathWare OFF — ${label}`);

      // Apagado total
      stopAll();

      // Oculta UI
      setUIVisible(false);
    }
  }

  // ------------------------------------------------------------
  // init:
  // Se ejecuta una vez cuando se carga el content script.
  // NO crea UI.
  // ------------------------------------------------------------
  function init() {
    const after = () => {
      markCurrentVideo(KWSR.video?.getMainVideo?.() || null);

      // Defaults de state (por si storage todavía no puso nada)
      if (!S.fuenteSubGlobal) S.fuenteSubGlobal = "auto";
      if (!S.modoNarradorGlobal) S.modoNarradorGlobal = "lector";

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

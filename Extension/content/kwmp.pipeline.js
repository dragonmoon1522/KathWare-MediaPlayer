(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.pipeline) return;

  const S = KWMP.state;
  const CFG = KWMP.CFG;

  const getPlatform = () => KWMP.platforms.getPlatform();
  const platformLabel = (p) => KWMP.platforms.platformLabel(p);

  function stopTimers() {
    try { clearInterval(S.pollTimerTrack); } catch {}
    try { clearInterval(S.rehookTimer); } catch {}
    try { clearInterval(S.pollTimerVisual); } catch {}
    try { clearInterval(S.visualReselectTimer); } catch {}
    try { clearInterval(S.keepControlsTimer); } catch {}
    S.pollTimerTrack = S.rehookTimer = S.pollTimerVisual = S.visualReselectTimer = S.keepControlsTimer = null;
  }

  function stopAll() {
    stopTimers();
    KWMP.flowA11y?.stopFlowMenuObserver?.();

    try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
    S.currentTrack = null;

    KWMP.visual?.stopVisualObserver?.();
    S.visualNode = null;
    S.visualSelectors = null;

    KWMP.voice.detenerLectura();
  }

  function startTimers() {
    stopTimers();

    S.rehookTimer = setInterval(() => rehookTick(), CFG.rehookMs);

    S.pollTimerTrack = setInterval(() => {
      KWMP.track?.pollTrackTick?.();
    }, CFG.pollMsTrack);

    S.pollTimerVisual = setInterval(() => {
      KWMP.visual?.pollVisualTick?.();
    }, CFG.pollMsVisual);

    S.visualReselectTimer = setInterval(() => {
      if (!S.extensionActiva) return;
      if (S.effectiveFuente !== "visual") return;

      KWMP.visual?.visualReselectTick?.();
    }, CFG.visualReselectMs);

    S.keepControlsTimer = setInterval(() => {
      KWMP.flowA11y?.keepControlsTick?.();
    }, CFG.keepControlsMs);

    if (getPlatform() === "flow") KWMP.flowA11y?.startFlowMenuObserver?.();
  }

  function restartPipeline() {
    try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
    S.currentTrack = null;

    KWMP.visual?.stopVisualObserver?.();
    S.visualNode = null;
    S.visualSelectors = null;

    S.lastTrackSeen = "";
    S.lastVisualSeen = "";
    S.lastEmitText = "";
    S.lastEmitAt = 0;

    S.effectiveFuente = "visual";
    S.lastSig = "";

    rehookTick();
    KWMP.overlay?.updateOverlayTracksList?.();
    KWMP.overlay?.updateOverlayStatus?.();
  }

  function setUIVisible(visible) {
    // pill siempre visible
    KWMP.overlay?.ensureOverlay?.();
    if (!visible) KWMP.overlay?.setPanelOpen?.(false);
    KWMP.overlay?.updateOverlayTracksList?.();
    KWMP.overlay?.updateOverlayStatus?.();
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
    const v = KWMP.video?.getMainVideo?.();
    if (v !== S.currentVideo) {
      S.currentVideo = v;

      S.lastTrackSeen = "";
      S.lastVisualSeen = "";

      try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
      S.currentTrack = null;

      S.visualNode = null;
      S.visualSelectors = null;
      KWMP.visual?.stopVisualObserver?.();

      KWMP.overlay?.updateOverlayTracksList?.();
      KWMP.overlay?.updateOverlayStatus?.();
    }

    if (!S.extensionActiva) return;

    // 2) elegir fuente efectiva
    const hasUsableTracks = KWMP.track?.videoHasUsableTracks?.(S.currentVideo) || false;

    S.effectiveFuente =
      S.fuenteSubGlobal === "auto"
        ? (hasUsableTracks ? "track" : "visual")
        : (S.fuenteSubGlobal === "track" ? "track" : "visual");

    // 3) limpiar pipeline contrario
    if (S.effectiveFuente === "track") {
      KWMP.visual?.stopVisualObserver?.();
      S.visualNode = null;
      S.visualSelectors = null;
    } else {
      try { if (S.currentTrack) S.currentTrack.oncuechange = null; } catch {}
      S.currentTrack = null;
    }

    // 4) signature
    const bestTrack = (S.effectiveFuente === "track")
      ? (KWMP.track?.pickBestTrack?.(S.currentVideo) || null)
      : null;

    const sig = computeSignature(S.currentVideo, bestTrack);

    if (sig !== S.lastSig) {
      S.lastSig = sig;

      if (S.effectiveFuente === "track") {
        const ok = KWMP.track?.startTrack?.();
        if (!ok) {
          S.effectiveFuente = "visual";
          KWMP.visual?.startVisual?.();
        }
      } else {
        KWMP.visual?.startVisual?.();
      }

      KWMP.overlay?.updateOverlayStatus?.();
    }

    if (getPlatform() === "flow") KWMP.flowA11y?.labelFlowControls?.();
  }

  function toggleExtension() {
    S.extensionActiva = !S.extensionActiva;
    const label = platformLabel(getPlatform());

    if (S.extensionActiva) {
      setUIVisible(true);
      KWMP.voice.cargarVozES();
      KWMP.toast?.notify?.(`🟢 KathWare ON — ${label}`);
      startTimers();
      S.effectiveFuente = "visual";
      rehookTick();
    } else {
      KWMP.toast?.notify?.(`🔴 KathWare OFF — ${label}`);
      stopAll();
      setUIVisible(false);
    }
  }

  function init() {
    // storage (si está)
    KWMP.storage?.cargarConfigDesdeStorage?.(() => {
      S.currentVideo = KWMP.video?.getMainVideo?.() || null;

      // pill siempre visible desde arranque
      KWMP.overlay?.ensureOverlay?.();
      KWMP.overlay?.setPanelOpen?.(false);
      KWMP.overlay?.updateOverlayTracksList?.();
      KWMP.overlay?.updateOverlayStatus?.();

      KWMP.log("content listo en", location.hostname, "plataforma:", getPlatform(), "Hotkey: Ctrl+Alt+K");
    }) || (() => {
      // fallback si no hay storage
      S.currentVideo = KWMP.video?.getMainVideo?.() || null;
      KWMP.overlay?.ensureOverlay?.();
      KWMP.overlay?.setPanelOpen?.(false);
      KWMP.overlay?.updateOverlayTracksList?.();
      KWMP.overlay?.updateOverlayStatus?.();
      KWMP.log("content listo (sin storage) en", location.hostname, "plataforma:", getPlatform(), "Hotkey: Ctrl+Alt+K");
    })();
  }

  KWMP.pipeline = {
    init,
    toggleExtension,
    restartPipeline,
    rehookTick,
    startTimers,
    stopAll,
    setUIVisible
  };
})();

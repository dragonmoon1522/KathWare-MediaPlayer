// ----------------------------------------------------
// KathWare SubtitleReader - kwsr.bootstrap.js
// ----------------------------------------------------
//
// ARCHIVO: bootstrap (arranque)
// - Es el PRIMER archivo del content-script.
// - Prepara el terreno: namespace + cfg/state + logs + storage loader.
//
// NO debe hacer:
// - NO UI
// - NO timers/observers
// - NO lectura de subtítulos
//
// Regla de oro:
// - Seguro para ejecutar 1 sola vez.
// - Si se ejecuta 2 veces: bugs graves (duplicados, timers dobles).
// ----------------------------------------------------

(() => {
  // --------------------------------------------------
  // Guarda anti-doble-carga
  // --------------------------------------------------
  if (window.KWSR) return;

  // --------------------------------------------------
  // Detección de API de extensión
  // - Chromium: chrome
  // - Firefox: browser (a veces también chrome)
  // --------------------------------------------------
  const api =
    (typeof chrome !== "undefined" && chrome?.runtime) ? chrome :
    (typeof browser !== "undefined" && browser?.runtime) ? browser :
    null;

  // --------------------------------------------------
  // Objeto central KWSR (namespace)
  // --------------------------------------------------
  const KWSR = {
    version: "2.0.0",
    api,

    // ------------------------------------------------
    // CFG: configuración técnica (defaults)
    // - No es estado vivo.
    // - Se puede pisar desde storage o debug.
    // ------------------------------------------------
    CFG: {
      // Debug
      debug: false,
      debugVisual: false,

      // Logs remotos (opt-in)
      allowRemoteLogs: false,

      // Hotkeys (si se usa, viene de storage)
      hotkeys: null,

      // Timings (coherentes con pipeline actual)
      rehookMs: 900,
      pollMsTrack: 450,
      pollMsVisual: 650,
      visualReselectMs: 2600,
      adaptersMs: 1200,

      // Controles del reproductor
      seekSmall: 5,
      seekBig: 10,
      volStep: 0.05,

      // Dedupe / anti-eco (global)
      echoMs: 380,
      cooldownMs: 650,

      // TRACK
      trackEchoMs: 350,

      // TTS watchdog
      ttsEchoMs: 350,
      ttsWatchdogMs: 4500,

      // UI
      autoOpenPanelOnSubs: false,
      overlayShowText: false
    },

    // ------------------------------------------------
    // state: estado vivo del sistema
    // ------------------------------------------------
    state: {
      // Overlay / UI
      overlayRoot: null,
      overlayPanel: null,
      overlayPill: null,
      overlayStatus: null,
      overlayText: null,
      overlayModoSelect: null,

      // Toast
      toastEl: null,
      toastTimer: null,
      toastLiveRegion: null,

      // Settings usuario
      extensionActiva: false,
      modoNarradorGlobal: "lector", // lector | sintetizador | off
      fuenteSubGlobal: "auto",      // auto | track | visual
      trackIndexGlobal: 0,

      // Fuente efectiva real (decidida por pipeline)
      effectiveFuente: "visual",

      // Motor de lectura
      voiceES: null,
      liveRegion: null,

      // Video / track actual
      currentVideo: null,
      currentVideoKey: "",
      currentTrack: null,

      // Timers / observers
      pollTimerTrack: null,
      rehookTimer: null,
      pollTimerVisual: null,
      visualReselectTimer: null,
      adaptersTimer: null,

      visualObserver: null,
      visualObserverActive: false,

      // VISUAL
      visualNode: null,
      visualSelectors: null,
      visualSelectorUsed: null,
      visualDirty: false,
      visualDirtyAt: 0,
      _visualScheduled: false,

      // Dedupe global (voice)
      lastEmitText: "",
      lastEmitAt: 0,
      lastEmitStrictKey: "",
      lastEmitLooseKey: "",
      lastEmitVideoTimeSec: null,

      // TRACK dedupe (track.js)
      lastTrackSeen: "",
      lastTrackKey: "",
      lastTrackAt: 0,

      // VISUAL dedupe (visual.js)
      lastVisualSeen: "",
      _visualLastAt: 0,
      _visualLastText: "",
      _visualLastKey: "",
      _visualLastStrict: "",
      _visualLastLoose: "",
      _visualLastVideoTimeSec: null,

      // Rehook
      lastSig: "",

      // Plataformas no accesibles (adapter)
      lastNonAccControlsSig: "",
      lastNonAccLabeledCount: 0,
      nonAccMenuObserver: null,
      nonAccMenusProcessed: null // lazy init en el adapter
    }
  };

  // Exponer KWSR globalmente
  window.KWSR = KWSR;

  // --------------------------------------------------
  // Sistema de logs
  // - console solo si debug
  // - remoto solo si allowRemoteLogs (opt-in)
  // --------------------------------------------------
  const safeStringify = (x) => {
    try {
      if (typeof x === "string") return x;
      return JSON.stringify(x);
    } catch {
      try { return String(x); } catch { return "[unstringifiable]"; }
    }
  };

  const toMsg = (arr) => arr.map(safeStringify).join(" ");

  KWSR.emitLog = (level, payload = {}) => {
    try {
      if (!KWSR.CFG.allowRemoteLogs) return;
      if (!KWSR.api?.runtime?.sendMessage) return;

      KWSR.api.runtime.sendMessage({
        action: "logEvent",
        payload: {
          level,
          version: KWSR.version,
          url: location.href,
          platform: KWSR.platforms?.getPlatform?.() || "unknown",
          ...payload
        }
      }, () => void KWSR.api?.runtime?.lastError);
    } catch {}
  };

  KWSR.log = (...a) => {
    if (KWSR.CFG.debug) console.log("[KathWare]", ...a);
    KWSR.emitLog("log", { msg: toMsg(a) });
  };

  KWSR.warn = (...a) => {
    if (KWSR.CFG.debug) console.warn("[KathWare]", ...a);
    KWSR.emitLog("warn", { msg: toMsg(a) });
  };

  KWSR.error = (...a) => {
    console.error("[KathWare]", ...a);
    KWSR.emitLog("error", { msg: toMsg(a) });
  };

  // --------------------------------------------------
  // Storage loader
  // - Lee configuración persistida y aplica sobre CFG/state.
  // --------------------------------------------------
  KWSR.storage = {
    cargarConfigDesdeStorage(cb) {
      if (!KWSR.api?.storage?.local) {
        cb && cb();
        return;
      }

      KWSR.api.storage.local.get(
        ["modoNarrador", "fuenteSub", "trackIndex", "debug", "debugVisual", "hotkeys", "allowRemoteLogs"],
        (data) => {
          try {
            if (typeof data?.debug === "boolean") KWSR.CFG.debug = data.debug;
            if (typeof data?.debugVisual === "boolean") KWSR.CFG.debugVisual = data.debugVisual;
            if (typeof data?.allowRemoteLogs === "boolean") KWSR.CFG.allowRemoteLogs = data.allowRemoteLogs;

            if (data?.modoNarrador) KWSR.state.modoNarradorGlobal = data.modoNarrador;
            if (data?.fuenteSub) KWSR.state.fuenteSubGlobal = data.fuenteSub;

            if (typeof data?.trackIndex !== "undefined") {
              const n = Number(data.trackIndex);
              KWSR.state.trackIndexGlobal = Number.isFinite(n) ? n : 0;
            }

            if (data?.hotkeys && typeof data.hotkeys === "object") {
              KWSR.CFG.hotkeys = { ...(KWSR.CFG.hotkeys || {}), ...data.hotkeys };
            }
          } catch {}
          cb && cb();
        }
      );
    }
  };

})();
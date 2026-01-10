// ====================================================
// KathWare Media Player - kwmp.bootstrap.js
// - Crea window.KWMP (namespace global)
// - Detecta API (chrome/browser)
// - Logger -> consola + background (kathLogs) vía runtime.sendMessage
// - Storage loader (modo/fuente/track/debug/hotkeys)
// ====================================================

(() => {
  if (window.KWMP) return;

  const api =
    (typeof chrome !== "undefined" && chrome?.runtime) ? chrome :
    (typeof browser !== "undefined" && browser?.runtime) ? browser :
    null;

  const KWMP = {
    version: "2.0.0",
    api,
    CFG: {
      debug: true,
      allowRemoteLogs: true, // logs al background (para popup / issues)
      // hotkeys se definen en kwmp.hotkeys.js (fallback), y pueden venir del storage
      hotkeys: null
    },
    state: {
      // overlay refs
      overlayRoot: null,
      overlayPanel: null,
      overlayPill: null,
      overlayStatus: null,
      overlayText: null,
      overlayTrackSelect: null,
      overlayModoSelect: null,
      overlayFuenteSelect: null,

      // toast
      toastEl: null,
      toastTimer: null,

      // settings
      extensionActiva: false,
      modoNarradorGlobal: "lector", // "off" | "sintetizador" | "lector"
      fuenteSubGlobal: "auto",      // "auto" | "track" | "visual"
      trackIndexGlobal: 0,
      effectiveFuente: "visual",

      // voice/live region
      voiceES: null,
      liveRegion: null,

      // engine refs
      currentVideo: null,
      currentTrack: null,

      // timers/observers
      pollTimerTrack: null,
      rehookTimer: null,
      pollTimerVisual: null,
      visualReselectTimer: null,
      keepControlsTimer: null,

      visualObserver: null,
      visualObserverActive: false,

      // visual node/sel
      visualNode: null,
      visualSelectors: null,

      // flow observers
      flowMenuObserver: null,
      flowMenusProcessed: new WeakSet(),

      // dedupe lectura
      lastEmitText: "",
      lastEmitAt: 0,

      // per-source change detection
      lastTrackSeen: "",
      lastVisualSeen: "",

      // flow labeling signature
      lastFlowControlsSig: "",
      lastFlowLabeledCount: 0,

      // rehook signature
      lastSig: ""
    }
  };

  window.KWMP = KWMP;

  // ---------------- Logger ----------------
  const safeStringify = (x) => {
    try {
      if (typeof x === "string") return x;
      return JSON.stringify(x);
    } catch {
      try { return String(x); } catch { return "[unstringifiable]"; }
    }
  };

  const toMsg = (arr) => arr.map(safeStringify).join(" ");

  KWMP.emitLog = (level, payload = {}) => {
    try {
      if (!KWMP.CFG.allowRemoteLogs) return;
      if (!KWMP.api?.runtime?.sendMessage) return;

      KWMP.api.runtime.sendMessage({
        action: "logEvent",
        payload: {
          level,
          version: KWMP.version,
          url: location.href,
          platform: KWMP.platforms?.getPlatform?.() || "unknown",
          ...payload
        }
      });
    } catch (_) {}
  };

  KWMP.log = (...a) => {
    if (KWMP.CFG.debug) console.log("[KathWare]", ...a);
    KWMP.emitLog("log", { msg: toMsg(a) });
  };

  KWMP.warn = (...a) => {
    if (KWMP.CFG.debug) console.warn("[KathWare]", ...a);
    KWMP.emitLog("warn", { msg: toMsg(a) });
  };

  KWMP.error = (...a) => {
    console.error("[KathWare]", ...a);
    KWMP.emitLog("error", { msg: toMsg(a) });
  };

  // ---------------- Storage loader ----------------
  // Lo dejamos como módulo KWMP.storage para que lo use pipeline/hotkeys
  KWMP.storage = {
    cargarConfigDesdeStorage(cb) {
      if (!KWMP.api?.storage?.local) return cb && cb();

      KWMP.api.storage.local.get(
        ["modoNarrador", "fuenteSub", "trackIndex", "debug", "hotkeys"],
        (data) => {
          try {
            if (typeof data?.debug === "boolean") KWMP.CFG.debug = data.debug;

            if (data?.modoNarrador) KWMP.state.modoNarradorGlobal = data.modoNarrador;
            if (data?.fuenteSub) KWMP.state.fuenteSubGlobal = data.fuenteSub;

            if (typeof data?.trackIndex !== "undefined") {
              const n = Number(data.trackIndex);
              KWMP.state.trackIndexGlobal = Number.isFinite(n) ? n : 0;
            }

            if (data?.hotkeys && typeof data.hotkeys === "object") {
              KWMP.CFG.hotkeys = { ...(KWMP.CFG.hotkeys || {}), ...data.hotkeys };
            }
          } catch (_) {}
          cb && cb();
        }
      );
    }
  };

})();

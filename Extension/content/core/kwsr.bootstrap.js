// ----------------------------------------------------
// KathWare SubtitleReader - kwsr.bootstrap.js
// ----------------------------------------------------
//
// ARCHIVO: bootstrap (arranque)
// -----------------------------
// Este es el PRIMER archivo que se ejecuta del content-script.
// Su función NO es “hacer cosas”, sino preparar el terreno.
//
// Qué SÍ hace:
// 1) Crea el objeto global window.KWSR (namespace único).
// 2) Detecta la API del navegador (chrome / browser).
// 3) Define sistema de logs (local + remoto opcional).
// 4) Define loader de configuración desde storage.
//
// Qué NO debe hacer (importante):
// - NO crea UI (overlay, panel, botones).
// - NO inicia timers ni observers.
// - NO lee subtítulos.
// Todo eso vive en pipeline / overlay / engine.
//
// Regla de oro:
// - Este archivo DEBE ser seguro de ejecutar una sola vez.
// - Si se ejecuta dos veces, aparecen bugs graves (doble lectura, timers duplicados).
// ----------------------------------------------------

(() => {
  // --------------------------------------------------
  // GUARDA ANTI-DOBLE-CARGA
  // --------------------------------------------------
  // Si window.KWSR ya existe, salimos inmediatamente.
  // Esta guarda es CRÍTICA. No tocar sin saber lo que se hace.
  // --------------------------------------------------
  if (window.KWSR) return;

  // --------------------------------------------------
  // DETECCIÓN DE API DE EXTENSIÓN
  // --------------------------------------------------
  // Chromium: expone `chrome`
  // Firefox: expone `browser` (a veces también `chrome`)
  //
  // Si no hay ninguna, la extensión puede funcionar
  // parcialmente (sin storage, sin mensajes).
  // --------------------------------------------------
  const api =
    (typeof chrome !== "undefined" && chrome?.runtime) ? chrome :
    (typeof browser !== "undefined" && browser?.runtime) ? browser :
    null;

  // --------------------------------------------------
  // OBJETO CENTRAL KWSR (namespace)
  // --------------------------------------------------
  // Acá cuelga TODO el sistema.
  // Evitamos variables sueltas en window.
  // --------------------------------------------------
  const KWSR = {
    version: "2.0.0",
    api,

    // ------------------------------------------------
    // CFG: configuración técnica (parámetros)
    // ------------------------------------------------
    // - No es estado vivo.
    // - Son valores por defecto.
    // - Pueden ser pisados por storage o debug.
    // ------------------------------------------------
    CFG: {
      // Debug visual / consola:
      // OFF por defecto (usuario final).
      debug: false,

      // Logs remotos:
      // OFF por defecto por privacidad y performance.
      allowRemoteLogs: false,

      // Hotkeys personalizados (se completan luego)
      hotkeys: null,

      // Timings del motor
      rehookMs: 1200,
      pollMsTrack: 220,
      pollMsVisual: 220,
      visualReselectMs: 1300,
      adaptersMs: 650,

      // Controles del reproductor
      seekSmall: 5,
      seekBig: 10,
      volStep: 0.05,

      // Anti-eco / deduplicación
      burstMs: 300,
      cooldownMs: 800,

      // UI
      autoOpenPanelOnSubs: false
    },

    // ------------------------------------------------
    // state: estado vivo del sistema
    // ------------------------------------------------
    // TODO lo que cambia durante la ejecución vive acá.
    // ------------------------------------------------
    state: {
      // Overlay / UI
      overlayRoot: null,
      overlayPanel: null,
      overlayPill: null,
      overlayStatus: null,
      overlayText: null,
      overlayTrackSelect: null,
      overlayModoSelect: null,
      overlayFuenteSelect: null,

      // Toast
      toastEl: null,
      toastTimer: null,
      toastLiveRegion: null,

      // Settings de usuario
      extensionActiva: false,
      modoNarradorGlobal: "lector", // lector | sintetizador | off
      fuenteSubGlobal: "auto",      // auto | track | visual
      trackIndexGlobal: 0,

      // Fuente efectiva real
      effectiveFuente: "visual",

      // Motor de lectura
      voiceES: null,
      liveRegion: null,

      // Video / track actual
      currentVideo: null,
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

      // Dedupe global
      lastEmitText: "",
      lastEmitAt: 0,
      lastEmitStrictKey: "",
      lastEmitLooseKey: "",

      // TRACK / VISUAL dedupe
      lastTrackSeen: "",
      lastVisualSeen: "",
      lastTrackKey: "",
      lastTrackAt: 0,

      // Rehook
      lastSig: "",

      // Plataformas no accesibles
      lastNonAccControlsSig: "",
      lastNonAccLabeledCount: 0,
      nonAccMenuObserver: null,
      nonAccMenusProcessed: new WeakSet()
    }
  };

  // Exponemos KWSR globalmente
  window.KWSR = KWSR;

  // --------------------------------------------------
  // SISTEMA DE LOGS
  // --------------------------------------------------
  // - KWSR.log / warn / error
  // - Logs remotos solo si allowRemoteLogs = true
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
  // STORAGE LOADER
  // --------------------------------------------------
  // Lee configuración persistida y la aplica sobre CFG/state.
  // --------------------------------------------------
  KWSR.storage = {
    cargarConfigDesdeStorage(cb) {
      if (!KWSR.api?.storage?.local) return cb && cb();

      KWSR.api.storage.local.get(
        ["modoNarrador", "fuenteSub", "trackIndex", "debug", "hotkeys"],
        (data) => {
          try {
            if (typeof data?.debug === "boolean") KWSR.CFG.debug = data.debug;
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
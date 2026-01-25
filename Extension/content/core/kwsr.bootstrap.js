// ====================================================
// KathWare SubtitleReader - kwsr.bootstrap.js
// - Crea window.KWSR (namespace global)
// - Detecta API (chrome/browser)
// - Logger -> consola + background (kathLogs) vía runtime.sendMessage
// - Storage loader (modo/fuente/track/debug/hotkeys)
// ====================================================

(() => {
  if (window.KWSR) return;

  const api =
    (typeof chrome !== "undefined" && chrome?.runtime) ? chrome :
    (typeof browser !== "undefined" && browser?.runtime) ? browser :
    null;

  const KWSR = {
    version: "2.0.0",
    api,
    CFG: {
      debug: true,
      allowRemoteLogs: true, // logs al background (para popup / issues)

      // Hotkeys se definen en kwsr.hotkeys.js (fallback) y pueden venir del storage
      hotkeys: null,

      // Pipeline timings (defaults “sanos”)
      rehookMs: 1200,
      pollMsTrack: 220,
      pollMsVisual: 220,
      visualReselectMs: 1300,

      // Adapters (keepAlive + nonAccessible)
      adaptersMs: 650,

      // Player controls
      seekSmall: 5,
      seekBig: 10,
      volStep: 0.05,

      // Voice dedupe
      burstMs: 300,
      cooldownMs: 800,

      // Overlay behavior
      autoOpenPanelOnSubs: false
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
      adaptersTimer: null,

      visualObserver: null,
      visualObserverActive: false,

      // visual node/sel
      visualNode: null,
      visualSelectors: null,

      // dedupe lectura (global)
      lastEmitText: "",
      lastEmitAt: 0,

      // per-source change detection
      lastTrackSeen: "",
      lastVisualSeen: "",

      // rehook signature
      lastSig: "",

      // --- Adapters: nonAccessible platforms ---
      lastNonAccControlsSig: "",
      lastNonAccLabeledCount: 0,
      nonAccMenuObserver: null,
      nonAccMenusProcessed: new WeakSet()
    }
  };

  window.KWSR = KWSR;

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
      });
    } catch (_) {}
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
  // ==========================
  // Debug bridge (Netflix-proof)
  // ==========================
  // Permite usar desde consola (main world):
  //   await window.KWSR_CMD("setCFG", { debugVisual:true })
  //   await window.KWSR_CMD("getCFG")
  //   await window.KWSR_CMD("getState")
  try {
    // Listener en content-script (isolated) que recibe comandos
    window.addEventListener("message", (ev) => {
      if (ev.source !== window) return;
      const data = ev.data || {};
      if (data.__KWSR_CMD__ !== true) return;

      const { id, cmd, payload } = data;

      const reply = (ok, out) => {
        try { window.postMessage({ __KWSR_RSP__: true, id, ok, out }, "*"); } catch {}
      };

      try {
        if (cmd === "setCFG") {
          const obj = payload && typeof payload === "object" ? payload : {};
          Object.assign(KWSR.CFG, obj);
          reply(true, { CFG: KWSR.CFG });
          return;
        }
        if (cmd === "getCFG") {
          reply(true, { CFG: KWSR.CFG });
          return;
        }
        if (cmd === "getState") {
          const s = KWSR.state || {};
          reply(true, {
            extensionActiva: s.extensionActiva,
            modoNarradorGlobal: s.modoNarradorGlobal,
            fuenteSubGlobal: s.fuenteSubGlobal,
            effectiveFuente: s.effectiveFuente,
            trackIndexGlobal: s.trackIndexGlobal,
            lastSig: s.lastSig,
            lastTrackSeen: s.lastTrackSeen,
            lastVisualSeen: s.lastVisualSeen,
            visualSelectorUsed: s.visualSelectorUsed || null
          });
          return;
        }
        reply(false, { error: "unknown_cmd" });
      } catch (e) {
        reply(false, { error: String(e?.message || e) });
      }
    }, false);

    // Inyecta helper en main world (consola)
    const s = document.createElement("script");
    s.textContent = `
      (function(){
        if (window.KWSR_CMD) return;
        let seq = 0;
        const pending = new Map();

        window.KWSR_CMD = function(cmd, payload){
          return new Promise((resolve, reject) => {
            const id = "kwsr_" + (++seq) + "_" + Date.now();
            pending.set(id, { resolve, reject });
            window.postMessage({ __KWSR_CMD__: true, id, cmd, payload }, "*");
            setTimeout(() => {
              if (!pending.has(id)) return;
              pending.delete(id);
              reject(new Error("KWSR_CMD timeout"));
            }, 1500);
          });
        };

        window.addEventListener("message", (ev) => {
          const d = ev.data || {};
          if (d.__KWSR_RSP__ !== true) return;
          const p = pending.get(d.id);
          if (!p) return;
          pending.delete(d.id);
          (d.ok ? p.resolve : p.reject)(d.out);
        }, false);
      })();
    `;
    document.documentElement.appendChild(s);
    s.remove();
  } catch {}

  // ---------------- Storage loader ----------------
  // Lo dejamos como módulo KWSR.storage para que lo use pipeline/hotkeys
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
          } catch (_) {}
          cb && cb();
        }
      );
    }
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Renombre global: window.KWMP -> window.KWSR.
  - Se movieron defaults de timings al CFG (incluye adaptersMs + seek/vol + dedupe).
  - State actualizado para:
      - pipeline nuevo (adaptersTimer en lugar de keepControlsTimer)
      - adapters no-accessible: firmas, contadores, observer y WeakSet de menús
  - Logger mantiene el envío a background (logEvent) y ahora reporta platform via KWSR.platforms.getPlatform() si existe.
  - Storage loader mantiene compat: modoNarrador / fuenteSub / trackIndex / debug / hotkeys.
  */
})();

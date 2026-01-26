// ====================================================
// KathWare SubtitleReader - kwsr.bootstrap.js
// ====================================================
//
// Este archivo es el "punto de arranque" del content-script.
// Se carga primero (ver manifest) y hace 4 cosas base:
//
// 1) Crea un objeto global: window.KWSR
//    - Es un "contenedor" donde cuelgan todos los módulos.
//    - Así evitamos variables sueltas por todos lados.
//
// 2) Detecta la API del navegador (chrome o browser).
//    - Chrome / Edge / Opera / Brave (Chromium) suelen exponer `chrome`.
//    - Firefox suele exponer `browser` (y a veces también `chrome`).
//
// 3) Define un sistema de logs:
//    - Log local (console.log/warn/error)
//    - Log remoto opcional (manda eventos al background para poder adjuntarlos en reportes)
//
// 4) Carga configuración desde storage.local:
//    - modoNarrador (off / sintetizador / lector)
//    - fuenteSub (auto / track / visual)
//    - trackIndex
//    - debug
//    - hotkeys
//
// IMPORTANTÍSIMO (para evitar bugs):
// - Este archivo usa "guardas" para que NO se cargue dos veces.
// - Si se ejecuta dos veces por error, podemos duplicar observers/timers y leer subtítulos repetidos.
//
// ====================================================

(() => {
  // ------------------------------------------------------------
  // GUARDA: si ya existe window.KWSR, salimos.
  // Esto evita doble carga y bugs de duplicación.
  // ------------------------------------------------------------
  if (window.KWSR) return;

  // ------------------------------------------------------------
  // Detectar API de extensión:
  // - En Chromium: `chrome`
  // - En Firefox: `browser`
  //
  // Si no encontramos ninguna, api queda null y la extensión igual puede
  // funcionar parcialmente (por ejemplo, sin storage o sin logs remotos).
  // ------------------------------------------------------------
  const api =
    (typeof chrome !== "undefined" && chrome?.runtime) ? chrome :
    (typeof browser !== "undefined" && browser?.runtime) ? browser :
    null;

  // ------------------------------------------------------------
  // KWSR = "objeto central" donde guardamos:
  // - version: versión de la extensión (para logs/reportes)
  // - api: chrome/browser API (si existe)
  // - CFG: configuración técnica (timings, dedupe, etc.)
  // - state: estado vivo de ejecución (refs DOM, timers, etc.)
  // ------------------------------------------------------------
  const KWSR = {
    version: "2.0.0",
    api,

    // ==========================================================
    // CFG (Configuración técnica)
    // ==========================================================
    // - Son valores "por defecto" para el funcionamiento interno.
    // - Se pueden modificar desde storage o desde consola (debug).
    // - NO es estado cambiante; son parámetros.
    CFG: {
      // Si debug = true, hacemos console.log en pantalla.
      // Igual, los logs remotos pueden estar prendidos/apagados aparte.
      debug: true,

      // Si allowRemoteLogs = true, mandamos logs al background para:
      // - Adjuntarlos en reportes (GitHub Issues)
      // - Diagnóstico cuando el usuario habilita "Adjuntar logs"
      allowRemoteLogs: true,

      // Hotkeys (atajos) personalizados:
      // - Se completan en kwsr.hotkeys.js
      // - También pueden venir del storage (por si a futuro el usuario los cambia)
      hotkeys: null,

      // ---- Timings del motor ("flujo"/pipeline) ----
      // rehookMs: cada cuánto revisamos si cambió el video/track (porque las páginas mutan DOM)
      rehookMs: 1200,

      // Polling fallback:
      // - TRACK: por si oncuechange no dispara o dispara mal
      pollMsTrack: 220,

      // - VISUAL: por si el MutationObserver falla o la plataforma no lo dispara bien
      pollMsVisual: 220,

      // VISUAL: cada cuánto re-elegimos selector si el DOM cambió (plataformas que re-renderizan)
      visualReselectMs: 1300,

      // Adapters: keepAlive + nonAccessible tick
      adaptersMs: 650,

      // Controles del reproductor (overlay/hotkeys player)
      seekSmall: 5,
      seekBig: 10,
      volStep: 0.05,

      // ----------------------------
      // DEDUPE / Anti-eco
      // ----------------------------
      // "dedupe" significa "deduplicación":
      // evitar leer lo mismo dos veces (o tres) cuando una plataforma dispara eventos duplicados.
      burstMs: 300,
      cooldownMs: 800,

      // Overlay: abrir panel automáticamente cuando detectamos subtítulos
      autoOpenPanelOnSubs: false
    },

    // ==========================================================
    // state (Estado vivo)
    // ==========================================================
    // - Referencias a elementos DOM creados por nosotros (overlay, toast, live regions)
    // - Timers activos
    // - "último texto leído" para dedupe
    // - Video/track actual elegido
    // ==========================================================
    state: {
      // IDs/refs de UI (overlay)
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
      toastLiveRegion: null, // lo crea kwsr.toast.js

      // settings de usuario (guardados en storage)
      extensionActiva: false,
      modoNarradorGlobal: "lector", // "off" | "sintetizador" | "lector"
      fuenteSubGlobal: "auto",      // "auto" | "track" | "visual"
      trackIndexGlobal: 0,

      // Fuente efectiva real (lo decide pipeline según disponibilidad)
      effectiveFuente: "visual",

      // voice/live region (motor de lectura)
      voiceES: null,
      liveRegion: null,

      // engine refs
      currentVideo: null,
      currentTrack: null,

      // timers/observers (se limpian en pipeline.stopAll)
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

      // dedupe global (para lectura final)
      lastEmitText: "",
      lastEmitAt: 0,
      lastEmitStrictKey: "",
      lastEmitLooseKey: "",

      // per-source (para TRACK/VISUAL)
      lastTrackSeen: "",
      lastVisualSeen: "",

      // TRACK dedupe keys (si están en uso)
      lastTrackKey: "",
      lastTrackAt: 0,

      // rehook signature (para detectar cambios)
      lastSig: "",

      // --- Adapters: nonAccessible platforms ---
      lastNonAccControlsSig: "",
      lastNonAccLabeledCount: 0,
      nonAccMenuObserver: null,
      nonAccMenusProcessed: new WeakSet()
    }
  };

  // Lo exponemos globalmente para que el resto de módulos lo use:
  window.KWSR = KWSR;

  // ==========================================================
  // LOGGER (logs)
  // ==========================================================
  // - KWSR.log / warn / error imprimen en consola
  // - emitLog manda al background si allowRemoteLogs está ON
  // ==========================================================

  // Convierte cualquier cosa a string sin romper
  const safeStringify = (x) => {
    try {
      if (typeof x === "string") return x;
      return JSON.stringify(x);
    } catch {
      try { return String(x); } catch { return "[unstringifiable]"; }
    }
  };

  const toMsg = (arr) => arr.map(safeStringify).join(" ");

  // Envía un log al background (para guardar en storage.local[kathLogs])
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
      }, () => {
        // Evita warnings en algunos navegadores si nadie responde
        void KWSR.api?.runtime?.lastError;
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

  // ==========================================================
  // DEBUG BRIDGE (puente para consola)
  // ==========================================================
  // Problema real:
  // - Los content scripts viven en un "mundo aislado".
  // - Si abrís la consola normal del sitio, no siempre podés acceder directo
  //   a variables del content script como window.KWSR.
  //
  // Solución:
  // - Creamos un mini-sistema de comandos usando window.postMessage.
  // - Inyectamos un helper window.KWSR_CMD(...) en el "mundo principal".
  //
  // Ejemplos:
  //   await window.KWSR_CMD("getCFG")
  //   await window.KWSR_CMD("setCFG", { debugVisual:true })
  //   await window.KWSR_CMD("getState")
  // ==========================================================
  try {
    // 1) Listener en el content-script (mundo aislado) que recibe comandos del sitio
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

    // 2) Inyección del helper en el mundo principal (para usarlo en consola)
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

            // Timeout por si el sitio bloquea el canal o algo raro pasa
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

  // ==========================================================
  // STORAGE LOADER
  // ==========================================================
  // Lee valores guardados por el popup/overlay/hotkeys:
  // - modoNarrador
  // - fuenteSub
  // - trackIndex
  // - debug
  // - hotkeys
  //
  // Se expone como KWSR.storage.cargarConfigDesdeStorage(cb)
  // para que pipeline/hotkeys lo llamen sin duplicar lógica.
  // ==========================================================
  KWSR.storage = {
    cargarConfigDesdeStorage(cb) {
      if (!KWSR.api?.storage?.local) return cb && cb();

      KWSR.api.storage.local.get(
        ["modoNarrador", "fuenteSub", "trackIndex", "debug", "hotkeys"],
        (data) => {
          try {
            // debug
            if (typeof data?.debug === "boolean") KWSR.CFG.debug = data.debug;

            // modo/fuente
            if (data?.modoNarrador) KWSR.state.modoNarradorGlobal = data.modoNarrador;
            if (data?.fuenteSub) KWSR.state.fuenteSubGlobal = data.fuenteSub;

            // track index
            if (typeof data?.trackIndex !== "undefined") {
              const n = Number(data.trackIndex);
              KWSR.state.trackIndexGlobal = Number.isFinite(n) ? n : 0;
            }

            // hotkeys (merge con lo existente)
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
  Glosario rápido (sin humo)
  ===========================
  - Namespace global: un objeto único (window.KWSR) que agrupa todo.
  - CFG: "configuración" (parámetros del motor).
  - state: "estado" (lo que cambia mientras corre).
  - dedupe: "deduplicar" → evitar repetir el mismo texto.
  - rehook: "reenganchar" → re-detectar video/track/selector cuando la página cambia el DOM.
  - pipeline: "flujo" o "cadena de procesamiento" → cómo se conectan track/visual → voice → UI.
  */
})();

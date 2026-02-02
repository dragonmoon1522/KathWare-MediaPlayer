// ====================================================
// KathWare SubtitleReader - kwsr.hotkeys.js
// ====================================================
//
// OBJETIVO
// --------
// Este módulo es el “puente” entre:
//
// 1) Teclas presionadas dentro de la página (fallback).
// 2) Mensajes que llegan desde background/popup (MV3).
// 3) El inicio del motor principal: al final llama KWSR.pipeline.init()
//
// RUTA DE LECTURA RÁPIDA (para no perderse)
// ----------------------------------------
// 1) DEFAULT_HOTKEYS + matchHotkey()  -> cómo detectamos atajos.
// 2) keydown listener (captura)       -> qué acciones dispara.
// 3) runtime.onMessage listener       -> órdenes del popup/background.
// 4) export mínimo + pipeline.init()  -> cómo se conecta con el resto.
//
// POR QUÉ EXISTE UN "FALLBACK" DE HOTKEYS
// --------------------------------------
// En MV3, chrome.commands (en manifest) funciona, pero puede fallar o no
// disparar en algunos escenarios (teclados, layouts, OS, páginas).
// Por eso escuchamos keydown directamente en el documento como respaldo.
//
// PRINCIPIOS IMPORTANTES (accesibilidad + estabilidad)
// ----------------------------------------------------
// - Usamos Alt+Shift+... (sin Ctrl) para evitar conflictos con lectores de pantalla.
// - Cuando la extensión está OFF: NO creamos UI (overlay/panel).
// - Cuando está ON: sí permitimos abrir/cerrar panel y hotkeys del player.
//
// ZONA DELICADA (MV3 / mensajes)
// ------------------------------
// - En onMessage: solo retornamos true si realmente respondemos async.
// - Si respondemos async, SIEMPRE garantizamos sendResponse (con safety-timeout),
//   para evitar warnings del tipo "message channel closed".
//
// GLOSARIO MINI (sin humo)
// ------------------------
// - fallback: alternativa de respaldo si el método principal falla.
// - async: una operación que termina más tarde (por ejemplo storage.get).
// - capturing (addEventListener true): escuchamos antes que la página.
// ====================================================

(() => {
  // ------------------------------------------------------------
  // Guarda de doble carga:
  // - Si KWSR no existe, no hacemos nada.
  // - Si este módulo ya se registró (KWSR.hotkeys), no lo cargamos de nuevo.
  // Esto evita duplicar listeners y comportamientos.
  // ------------------------------------------------------------
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.hotkeys) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;

  // ------------------------------------------------------------
  // Hotkeys por defecto (sin Ctrl):
  // - Toggle ON/OFF: Alt + Shift + K
  // - Abrir/Cerrar panel: Alt + Shift + O
  // - Cambiar modo (lector/sintetizador/off): Alt + Shift + L
  //
  // Nota: el comando del manifest también está en Alt+Shift+K.
  // Esto es el "fallback" in-page (por si el comando global no dispara).
  // ------------------------------------------------------------
  const DEFAULT_HOTKEYS = {
    toggle: { alt: true, shift: true, key: "k" }, // Alt+Shift+K
    panel:  { alt: true, shift: true, key: "o" }, // Alt+Shift+O
    mode:   { alt: true, shift: true, key: "l" }, // Alt+Shift+L
  };

  // ------------------------------------------------------------
  // Merge de hotkeys:
  // - Si no hay hotkeys en CFG -> usamos defaults.
  // - Si hay hotkeys custom -> mezclamos con defaults para completar campos.
  //
  // Por qué merge y no overwrite:
  // - Permite que el usuario cambie solo una parte sin romper el resto.
  // ------------------------------------------------------------
  if (!CFG.hotkeys) {
    CFG.hotkeys = DEFAULT_HOTKEYS;
  } else {
    CFG.hotkeys = {
      toggle: { ...DEFAULT_HOTKEYS.toggle, ...(CFG.hotkeys.toggle || {}) },
      panel:  { ...DEFAULT_HOTKEYS.panel,  ...(CFG.hotkeys.panel  || {}) },
      mode:   { ...DEFAULT_HOTKEYS.mode,   ...(CFG.hotkeys.mode   || {}) },
    };
  }

  // ------------------------------------------------------------
  // matchHotkey(e, hk):
  // Devuelve true si:
  // - La tecla presionada coincide con hk.key
  // - Los modificadores Alt y Shift coinciden
  // - NO se está presionando Ctrl ni Meta (para evitar conflictos)
  //
  // Nota sobre e.key:
  // - e.key ya viene como "k", "K", "ArrowLeft", etc.
  // - Normalizamos a lower-case para comparar sin importar mayúsculas.
  // ------------------------------------------------------------
  function matchHotkey(e, hk) {
    const key = String(e.key || "").toLowerCase();
    const hkKey = String(hk?.key || "").toLowerCase();

    return (
      key === hkKey &&
      !!e.altKey === !!hk.alt &&
      !!e.shiftKey === !!hk.shift &&
      // Bloqueamos Ctrl/Meta si el usuario los presiona:
      // evita combinaciones raras y conflictos con atajos del sistema/lector.
      e.ctrlKey === false &&
      e.metaKey === false
    );
  }

  // ==========================================================
  // HOTKEYS IN-PAGE (fallback)
  // ==========================================================
  // Listener global de keydown en "captura" (true):
  // - Captura primero que la web para que el sitio no "se coma" el atajo.
  // - IMPORTANTE: usamos preventDefault/stopPropagation solo cuando
  //   realmente coincidimos con un atajo.
  // ==========================================================
  document.addEventListener("keydown", (e) => {
    // 1) Toggle ON/OFF
    // - Enciende/apaga la extensión (pipeline decide qué iniciar/detener)
    if (matchHotkey(e, CFG.hotkeys.toggle)) {
      e.preventDefault();
      e.stopPropagation();
      KWSR.log?.("Hotkey toggle (fallback)", {});
      KWSR.pipeline?.toggleExtension?.();
      return;
    }

    // 2) Cambiar modo (lector / sintetizador / off)
    // - Si está OFF, igual dejamos cambiar el setting (queda guardado),
    //   pero NO creamos UI ni arrancamos timers.
    if (matchHotkey(e, CFG.hotkeys.mode)) {
      e.preventDefault();
      e.stopPropagation();

      // Orden fijo del ciclo:
      // lector -> sintetizador -> off -> lector ...
      const order = ["lector", "sintetizador", "off"];
      const i = order.indexOf(S.modoNarradorGlobal);
      S.modoNarradorGlobal = order[(i + 1) % order.length];

      // Persistimos el setting si tenemos storage:
      try { KWSR.api?.storage?.local?.set?.({ modoNarrador: S.modoNarradorGlobal }); } catch {}

      // Feedback suave (si existe toast):
      KWSR.toast?.notify?.(`Modo: ${S.modoNarradorGlobal}`);

      // Si el modo queda en off, detenemos lectura actual (si existe).
      if (S.modoNarradorGlobal === "off") {
        KWSR.voice?.detenerLectura?.();
      }

      // Si la UI está montada (porque la extensión estaba ON),
      // actualizamos estado visible.
      KWSR.overlay?.updateOverlayStatus?.();
      KWSR.log?.("Hotkey mode cycle", { modo: S.modoNarradorGlobal });
      return;
    }

    // 3) Toggle panel (solo si extensión ON)
    // - OFF = no UI, así que ignoramos esta hotkey.
    if (matchHotkey(e, CFG.hotkeys.panel)) {
      if (!S.extensionActiva) return;

      e.preventDefault();
      e.stopPropagation();

      // Asegura que exista overlay antes de abrir/cerrar panel:
      KWSR.overlay?.ensureOverlay?.();

      // Estado actual: visible si display != "none"
      // (Nota: esto asume que overlay usa display para ocultar/mostrar.)
      const open = S.overlayPanel && S.overlayPanel.style.display !== "none";
      KWSR.overlay?.setPanelOpen?.(!open);

      KWSR.log?.("Hotkey panel toggle", { open: !open });
      return;
    }

    // 4) Hotkeys del player (si aplica)
    // Esto SOLO actúa si la extensión está ON (overlay valida internamente).
    if (KWSR.overlay?.handlePlayerHotkeys?.(e)) return;

  }, true);

  // ==========================================================
  // MENSAJES DESDE BACKGROUND / POPUP
  // ==========================================================
  // - Background manda: {action:"toggleExtension"} (por comando del manifest)
  // - Popup manda: {action:"updateSettings"}, {type:"getTracks"}, etc.
  //
  // ZONA DELICADA:
  // - En MV3 hay que cuidar return true/false y sendResponse.
  // ==========================================================
  const api = KWSR.api;
  if (api?.runtime?.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Respondemos una sola vez (protección contra doble-respuesta).
      let responded = false;

      const safeRespond = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse?.(payload); } catch {}
      };

      // Safety timeout:
      // Si entramos en un camino async y algo falla o se cuelga,
      // respondemos igual para evitar warnings de Chrome.
      let safetyTimer = null;
      const armSafety = () => {
        try {
          safetyTimer = setTimeout(() => {
            safeRespond({ status: "ok", note: "safety-timeout" });
          }, 1500);
        } catch {}
      };
      const clearSafety = () => {
        try { if (safetyTimer) clearTimeout(safetyTimer); } catch {}
        safetyTimer = null;
      };

      try {
        // 1) Toggle desde background (command global del manifest)
        if (message?.action === "toggleExtension") {
          KWSR.log?.("Msg toggleExtension", { from: "background" });
          KWSR.pipeline?.toggleExtension?.();
          safeRespond({ status: "ok" });
          return false; // sync
        }

        // 1b) Compat con versiones viejas
        // IMPORTANTE: esto es "deprecated" (no lo uses en nuevas versiones).
        // Nota: acá está mapeado a toggleExtension por compat histórica.
        if (message?.action === "toggleNarrator") {
          KWSR.warn?.("Msg toggleNarrator (deprecated)", { from: "background" });
          KWSR.pipeline?.toggleExtension?.();
          safeRespond({ status: "ok" });
          return false;
        }

        // 2) Popup cambió settings -> recargar storage y aplicar
        if (message?.action === "updateSettings") {
          KWSR.log?.("Msg updateSettings", { from: "popup" });

          // Vamos async porque storage.get es async
          armSafety();

          if (KWSR.storage?.cargarConfigDesdeStorage) {
            KWSR.storage.cargarConfigDesdeStorage(() => {
              try {
                // Si la extensión está OFF:
                // - solo actualizamos state (storage loader ya lo hizo)
                // - NO creamos UI ni reiniciamos timers
                if (S.extensionActiva) {
                  KWSR.overlay?.updateOverlayStatus?.();
                  KWSR.overlay?.updateOverlayTracksList?.();
                  KWSR.pipeline?.restartPipeline?.();
                }
              } catch (e) {
                KWSR.error?.("updateSettings callback error", e);
              } finally {
                clearSafety();
                safeRespond({ status: "ok" });
              }
            });

            return true; // ✅ async real (respondemos después)
          }

          // Fallback ultra simple (si no hay loader por alguna razón)
          if (S.extensionActiva) {
            KWSR.overlay?.updateOverlayStatus?.();
            KWSR.overlay?.updateOverlayTracksList?.();
            KWSR.pipeline?.restartPipeline?.();
          }
          clearSafety();
          safeRespond({ status: "ok" });
          return false;
        }

        // 3) Popup: set track (elige una pista por índice)
        if (message?.action === "setTrack") {
          const idx = Number(message.index);
          KWSR.log?.("Msg setTrack", { index: idx });

          if (Number.isFinite(idx)) {
            S.trackIndexGlobal = idx;
            try { api?.storage?.local?.set?.({ trackIndex: S.trackIndexGlobal }); } catch {}

            // Si está ON, reiniciamos pipeline para aplicar el track elegido.
            if (S.extensionActiva) KWSR.pipeline?.restartPipeline?.();

            // Actualizamos UI (si existe).
            KWSR.overlay?.updateOverlayTracksList?.();
            KWSR.overlay?.updateOverlayStatus?.();
          }

          safeRespond({ status: "ok" });
          return false;
        }

        // 4) Popup: list tracks (devuelve pistas del video principal)
        if (message?.type === "getTracks") {
          const v = KWSR.video?.getMainVideo?.() || null;
          const tracks = v?.textTracks
            ? Array.from(v.textTracks).map(t => ({
                label: t.label || t.language || "Pista",
                language: t.language || ""
              }))
            : [];
          safeRespond({ tracks });
          return false;
        }

        // 5) Popup: toggle panel (abre/cierra panel desde UI del popup)
        if (message?.action === "toggleOverlayPanel") {
          if (!S.extensionActiva) {
            safeRespond({ status: "off" });
            return false;
          }
          KWSR.overlay?.ensureOverlay?.();
          const open = S.overlayPanel && S.overlayPanel.style.display !== "none";
          KWSR.overlay?.setPanelOpen?.(!open);
          safeRespond({ status: "ok" });
          return false;
        }

        // Mensaje no reconocido
        safeRespond({ status: "noop" });
        return false;

      } catch (e) {
        KWSR.error?.("onMessage error", e);
        safeRespond({ status: "error", error: String(e?.message || e) });
        return false;
      }
    });
  }

  // Export mínimo (por si otro módulo quiere reusar matchHotkey)
  KWSR.hotkeys = { matchHotkey };

  // ==========================================================
  // ENTRYPOINT FINAL
  // ==========================================================
  // Inicializa el pipeline del core.
  // Importante: init() NO debería crear UI automáticamente si la extensión
  // arranca en OFF (esa lógica vive en pipeline/overlay).
  // ==========================================================
  KWSR.pipeline?.init?.();

})();
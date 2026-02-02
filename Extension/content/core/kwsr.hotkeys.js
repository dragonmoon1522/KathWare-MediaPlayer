// ----------------------------------------------------
// KathWare SubtitleReader - kwsr.hotkeys.js
// ----------------------------------------------------
//
// OBJETIVO
// --------
// Este módulo es el “puente” entre:
//
// 1) Teclas presionadas dentro de la página (hotkeys fallback).
// 2) Mensajes que llegan desde background o popup (MV3).
// 3) El inicio del motor principal: al final llama KWSR.pipeline.init().
//
// RUTA DE LECTURA RÁPIDA (para no perderse)
// ----------------------------------------
// 1) DEFAULT_HOTKEYS + matchHotkey()  -> cómo detectamos atajos.
// 2) Listener keydown (captura)       -> qué acciones dispara.
// 3) runtime.onMessage listener       -> órdenes externas.
// 4) Export mínimo + pipeline.init()  -> conexión con el core.
//
// POR QUÉ EXISTE UN "FALLBACK" DE HOTKEYS
// --------------------------------------
// En MV3, chrome.commands (definido en el manifest) funciona,
// pero puede fallar según:
// - navegador
// - layout de teclado
// - sistema operativo
// - foco de la página
//
// Por eso escuchamos keydown directamente en el documento
// como mecanismo de respaldo.
//
// PRINCIPIOS IMPORTANTES (accesibilidad + estabilidad)
// ----------------------------------------------------
// - Usamos Alt + Shift (sin Ctrl) para evitar conflictos con lectores de pantalla.
// - Cuando la extensión está OFF: NO creamos UI.
// - Cuando está ON: habilitamos panel y hotkeys del reproductor.
//
// ZONA DELICADA (mensajes MV3)
// ----------------------------
// - En onMessage: solo retornamos true si realmente respondemos async.
// - Si respondemos async, SIEMPRE garantizamos sendResponse,
//   usando un safety-timeout para evitar warnings.
//
// GLOSARIO MINI (sin humo)
// ------------------------
// - fallback: mecanismo de respaldo.
// - async: algo que termina más tarde.
// - capturing: escuchar eventos antes que la página.
// ----------------------------------------------------

(() => {
  // --------------------------------------------------
  // GUARDA DE DOBLE CARGA
  // --------------------------------------------------
  // - Si window.KWSR no existe, no hacemos nada.
  // - Si este módulo ya fue cargado (KWSR.hotkeys existe),
  //   salimos para evitar duplicar listeners.
  // --------------------------------------------------
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.hotkeys) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;

  // --------------------------------------------------
  // HOTKEYS POR DEFECTO (sin Ctrl)
  // --------------------------------------------------
  // - Toggle ON/OFF: Alt + Shift + K
  // - Abrir/Cerrar panel: Alt + Shift + O
  // - Cambiar modo: Alt + Shift + L
  //
  // Nota:
  // El comando del manifest también usa Alt+Shift+K.
  // Esto es el fallback in-page.
  // --------------------------------------------------
  const DEFAULT_HOTKEYS = {
    toggle: { alt: true, shift: true, key: "k" },
    panel:  { alt: true, shift: true, key: "o" },
    mode:   { alt: true, shift: true, key: "l" }
  };

  // --------------------------------------------------
  // MERGE DE HOTKEYS
  // --------------------------------------------------
  // - Si no hay hotkeys custom -> usamos defaults.
  // - Si hay hotkeys custom -> mergeamos con defaults.
  //
  // Motivo:
  // El usuario puede cambiar solo una parte sin romper todo.
  // --------------------------------------------------
  if (!CFG.hotkeys) {
    CFG.hotkeys = { ...DEFAULT_HOTKEYS };
  } else {
    CFG.hotkeys = {
      toggle: { ...DEFAULT_HOTKEYS.toggle, ...(CFG.hotkeys.toggle || {}) },
      panel:  { ...DEFAULT_HOTKEYS.panel,  ...(CFG.hotkeys.panel  || {}) },
      mode:   { ...DEFAULT_HOTKEYS.mode,   ...(CFG.hotkeys.mode   || {}) }
    };
  }

  // --------------------------------------------------
  // matchHotkey(event, hotkey)
  // --------------------------------------------------
  // Devuelve true si:
  // - La tecla coincide
  // - Alt y Shift coinciden
  // - NO se presionan Ctrl ni Meta
  //
  // Normalizamos e.key a minúsculas.
  // --------------------------------------------------
  function matchHotkey(e, hk) {
    const key = String(e.key || "").toLowerCase();
    const hkKey = String(hk?.key || "").toLowerCase();

    return (
      key === hkKey &&
      !!e.altKey === !!hk.alt &&
      !!e.shiftKey === !!hk.shift &&
      e.ctrlKey === false &&
      e.metaKey === false
    );
  }

  // --------------------------------------------------
  // HOTKEYS IN-PAGE (fallback)
  // --------------------------------------------------
  // Listener keydown en modo captura:
  // - Se ejecuta antes que la página.
  // - Solo bloqueamos el evento si realmente usamos el atajo.
  // --------------------------------------------------
  document.addEventListener("keydown", (e) => {
    // 1) Toggle ON / OFF
    if (matchHotkey(e, CFG.hotkeys.toggle)) {
      e.preventDefault();
      e.stopPropagation();
      KWSR.log?.("Hotkey toggle (fallback)");
      KWSR.pipeline?.toggleExtension?.();
      return;
    }

    // 2) Ciclar modo (lector / sintetizador / off)
    if (matchHotkey(e, CFG.hotkeys.mode)) {
      e.preventDefault();
      e.stopPropagation();

      const order = ["lector", "sintetizador", "off"];
      const i = order.indexOf(S.modoNarradorGlobal);
      S.modoNarradorGlobal = order[(i + 1) % order.length];

      try {
        KWSR.api?.storage?.local?.set?.({
          modoNarrador: S.modoNarradorGlobal
        });
      } catch {}

      KWSR.toast?.notify?.(`Modo: ${S.modoNarradorGlobal}`);

      if (S.modoNarradorGlobal === "off") {
        KWSR.voice?.detenerLectura?.();
      }

      KWSR.overlay?.updateOverlayStatus?.();
      KWSR.log?.("Hotkey mode cycle", { modo: S.modoNarradorGlobal });
      return;
    }

    // 3) Abrir / cerrar panel (solo si está ON)
    if (matchHotkey(e, CFG.hotkeys.panel)) {
      if (!S.extensionActiva) return;

      e.preventDefault();
      e.stopPropagation();

      KWSR.overlay?.ensureOverlay?.();
      const open = S.overlayPanel &&
                   S.overlayPanel.style.display !== "none";

      KWSR.overlay?.setPanelOpen?.(!open);
      KWSR.log?.("Hotkey panel toggle", { open: !open });
      return;
    }

    // 4) Hotkeys del reproductor (si existen)
    if (KWSR.overlay?.handlePlayerHotkeys?.(e)) return;

  }, true);

  // --------------------------------------------------
  // MENSAJES DESDE BACKGROUND / POPUP
  // --------------------------------------------------
  const api = KWSR.api;
  if (api?.runtime?.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      let responded = false;

      const safeRespond = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch {}
      };

      let safetyTimer = null;
      const armSafety = () => {
        safetyTimer = setTimeout(() => {
          safeRespond({ status: "ok", note: "safety-timeout" });
        }, 1500);
      };
      const clearSafety = () => {
        if (safetyTimer) clearTimeout(safetyTimer);
        safetyTimer = null;
      };

      try {
        if (message?.action === "toggleExtension") {
          KWSR.pipeline?.toggleExtension?.();
          safeRespond({ status: "ok" });
          return false;
        }

        if (message?.action === "toggleNarrator") {
          KWSR.warn?.("toggleNarrator deprecated");
          KWSR.pipeline?.toggleExtension?.();
          safeRespond({ status: "ok" });
          return false;
        }

        if (message?.action === "updateSettings") {
          armSafety();
          KWSR.storage?.cargarConfigDesdeStorage?.(() => {
            if (S.extensionActiva) {
              KWSR.overlay?.updateOverlayStatus?.();
              KWSR.overlay?.updateOverlayTracksList?.();
              KWSR.pipeline?.restartPipeline?.();
            }
            clearSafety();
            safeRespond({ status: "ok" });
          });
          return true;
        }

        if (message?.action === "setTrack") {
          const idx = Number(message.index);
          if (Number.isFinite(idx)) {
            S.trackIndexGlobal = idx;
            try {
              api?.storage?.local?.set?.({ trackIndex: idx });
            } catch {}
            if (S.extensionActiva) {
              KWSR.pipeline?.restartPipeline?.();
            }
            KWSR.overlay?.updateOverlayTracksList?.();
            KWSR.overlay?.updateOverlayStatus?.();
          }
          safeRespond({ status: "ok" });
          return false;
        }

        if (message?.type === "getTracks") {
          const v = KWSR.video?.getMainVideo?.();
          const tracks = v?.textTracks
            ? Array.from(v.textTracks).map(t => ({
                label: t.label || t.language || "Pista",
                language: t.language || ""
              }))
            : [];
          safeRespond({ tracks });
          return false;
        }

        if (message?.action === "toggleOverlayPanel") {
          if (!S.extensionActiva) {
            safeRespond({ status: "off" });
            return false;
          }
          KWSR.overlay?.ensureOverlay?.();
          const open = S.overlayPanel &&
                       S.overlayPanel.style.display !== "none";
          KWSR.overlay?.setPanelOpen?.(!open);
          safeRespond({ status: "ok" });
          return false;
        }

        safeRespond({ status: "noop" });
        return false;

      } catch (e) {
        KWSR.error?.("onMessage error", e);
        safeRespond({ status: "error" });
        return false;
      }
    });
  }

  // --------------------------------------------------
  // EXPORT MÍNIMO
  // --------------------------------------------------
  KWSR.hotkeys = { matchHotkey };

  // --------------------------------------------------
  // ENTRYPOINT FINAL
  // --------------------------------------------------
  // Inicializa el pipeline del core.
  // El pipeline decide si crear UI o no.
  // --------------------------------------------------
  KWSR.pipeline?.init?.();

})();
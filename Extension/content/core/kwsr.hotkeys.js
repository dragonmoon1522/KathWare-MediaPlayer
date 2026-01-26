// ====================================================
// KathWare SubtitleReader - kwsr.hotkeys.js
// ====================================================
//
// Este módulo maneja:
// 1) Atajos de teclado dentro de la página (fallback).
// 2) Mensajes que llegan desde el background o el popup.
// 3) Punto de entrada: al final llama KWSR.pipeline.init()
//
// Por qué existe un "fallback" de hotkeys:
// - En MV3 el comando del manifest (chrome.commands) funciona,
//   pero no siempre en todos los escenarios/teclados/OS.
// - Entonces, además del comando global, escuchamos keydown en la página.
//
// IMPORTANTE:
// - Usamos Alt+Shift+... para evitar Ctrl (según tu decisión).
// - Cuando la extensión está OFF: NO creamos overlay ni panel.
// - Cuando está ON: sí permitimos abrir/cerrar panel y hotkeys del player.
//
// FIX importante:
// - En onMessage: solo retornamos true si realmente respondemos async.
// - Y si respondemos async, SIEMPRE garantizamos sendResponse (safety-timeout).
// ====================================================

(() => {
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
  // Esto es el "fallback" in-page.
  // ------------------------------------------------------------
  const DEFAULT_HOTKEYS = {
    toggle: { alt: true, shift: true, key: "k" }, // Alt+Shift+K
    panel:  { alt: true, shift: true, key: "o" }, // Alt+Shift+O
    mode:   { alt: true, shift: true, key: "l" }, // Alt+Shift+L
  };

  // Si no hay hotkeys en CFG, ponemos defaults.
  // Si hay hotkeys custom, las mezclamos con defaults (merge).
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
  // matchHotkey:
  // Devuelve true si la tecla + modificadores coinciden con el atajo.
  //
  // OJO: acá SOLO comparamos Alt+Shift+Key
  // (no usamos Ctrl ni Meta).
  // ------------------------------------------------------------
  function matchHotkey(e, hk) {
    const key = String(e.key || "").toLowerCase();
    const hkKey = String(hk?.key || "").toLowerCase();

    return (
      key === hkKey &&
      !!e.altKey === !!hk.alt &&
      !!e.shiftKey === !!hk.shift &&
      // Bloqueamos Ctrl/Meta si el usuario los presiona:
      // evita conflictos y combinaciones raras.
      e.ctrlKey === false &&
      e.metaKey === false
    );
  }

  // ------------------------------------------------------------
  // Keydown global (captura true para ganar contra el sitio)
  // ------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    // 1) Toggle ON/OFF
    if (matchHotkey(e, CFG.hotkeys.toggle)) {
      e.preventDefault();
      e.stopPropagation();
      KWSR.log?.("Hotkey toggle (fallback)", {});
      KWSR.pipeline?.toggleExtension?.();
      return;
    }

    // 2) Cambiar modo (lector / sintetizador / off)
    if (matchHotkey(e, CFG.hotkeys.mode)) {
      // Si está OFF, igual dejamos cambiar el setting (así queda guardado),
      // pero NO creamos UI.
      e.preventDefault();
      e.stopPropagation();

      const order = ["lector", "sintetizador", "off"];
      const i = order.indexOf(S.modoNarradorGlobal);
      S.modoNarradorGlobal = order[(i + 1) % order.length];

      try { KWSR.api?.storage?.local?.set?.({ modoNarrador: S.modoNarradorGlobal }); } catch {}

      // Feedback suave
      KWSR.toast?.notify?.(`Modo: ${S.modoNarradorGlobal}`);

      if (S.modoNarradorGlobal === "off") {
        KWSR.voice?.detenerLectura?.();
      }

      // Si el overlay existe (porque estamos ON), lo actualizamos.
      KWSR.overlay?.updateOverlayStatus?.();
      KWSR.log?.("Hotkey mode cycle", { modo: S.modoNarradorGlobal });
      return;
    }

    // 3) Toggle panel (solo si extensión ON)
    if (matchHotkey(e, CFG.hotkeys.panel)) {
      if (!S.extensionActiva) return; // OFF = no UI

      e.preventDefault();
      e.stopPropagation();

      KWSR.overlay?.ensureOverlay?.();
      const open = S.overlayPanel && S.overlayPanel.style.display !== "none";
      KWSR.overlay?.setPanelOpen?.(!open);

      KWSR.log?.("Hotkey panel toggle", { open: !open });
      return;
    }

    // 4) Hotkeys del player (si aplica)
    // Esto SOLO actúa si la extensión está ON (lo valida el overlay internamente).
    if (KWSR.overlay?.handlePlayerHotkeys?.(e)) return;

  }, true);

  // ==========================================================
  // Mensajes desde background / popup
  // ==========================================================
  // - Background manda: {action:"toggleExtension"} (por comando del manifest)
  // - Popup manda: {action:"updateSettings"} y {type:"getTracks"} etc
  // ==========================================================
  const api = KWSR.api;
  if (api?.runtime?.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Respondemos una sola vez
      let responded = false;

      const safeRespond = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse?.(payload); } catch {}
      };

      // Safety timeout:
      // Si entramos en un camino async y algo falla, respondemos igual
      // para evitar el warning de Chrome ("message channel closed").
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
        // 1) Toggle desde background (command global)
        if (message?.action === "toggleExtension") {
          KWSR.log?.("Msg toggleExtension", { from: "background" });
          KWSR.pipeline?.toggleExtension?.();
          safeRespond({ status: "ok" });
          return false; // sync
        }

        // Compat con versiones viejas
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
                // - solo actualizamos state (ya lo hizo storage loader)
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

            return true; // ✅ async real
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

        // 3) Popup: set track
        if (message?.action === "setTrack") {
          const idx = Number(message.index);
          KWSR.log?.("Msg setTrack", { index: idx });

          if (Number.isFinite(idx)) {
            S.trackIndexGlobal = idx;
            try { api?.storage?.local?.set?.({ trackIndex: S.trackIndexGlobal }); } catch {}
            if (S.extensionActiva) KWSR.pipeline?.restartPipeline?.();
            KWSR.overlay?.updateOverlayTracksList?.();
            KWSR.overlay?.updateOverlayStatus?.();
          }

          safeRespond({ status: "ok" });
          return false;
        }

        // 4) Popup: list tracks
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

        // 5) Popup: toggle panel
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

        safeRespond({ status: "noop" });
        return false;

      } catch (e) {
        KWSR.error?.("onMessage error", e);
        safeRespond({ status: "error", error: String(e?.message || e) });
        return false;
      }
    });
  }

  // Export mínimo
  KWSR.hotkeys = { matchHotkey };

  // ==========================================================
  // Entrypoint final: inicializa el pipeline (sin crear UI)
  // ==========================================================
  KWSR.pipeline?.init?.();

})();

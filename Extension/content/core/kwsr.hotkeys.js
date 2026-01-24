// ====================================================
// KathWare SubtitleReader - kwsr.hotkeys.js
// - Hotkeys in-page (fallback) + mensajes desde background/popup
// - Entry: KWSR.pipeline.init()
//
// FIX:
// - Blindaje de runtime.onMessage para evitar:
//   “A listener indicated an asynchronous response by returning true,
//    but the message channel closed before a response was received”
// - Regla: solo return true cuando realmente respondemos async,
//   y SIEMPRE garantizamos sendResponse (con timeout de seguridad).
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.hotkeys) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;

  // ✅ Fallback igual que commands: Alt+Shift+K
  const DEFAULT_HOTKEYS = {
    toggle: { ctrl: false, alt: true,  shift: true,  key: "k" }, // Alt+Shift+K
    mode:   { ctrl: true,  alt: true,  shift: false, key: "l" }, // Ctrl+Alt+L
    panel:  { ctrl: true,  alt: true,  shift: false, key: "o" }, // Ctrl+Alt+O
  };

  if (!CFG.hotkeys) CFG.hotkeys = DEFAULT_HOTKEYS;
  else {
    CFG.hotkeys = {
      toggle: { ...DEFAULT_HOTKEYS.toggle, ...(CFG.hotkeys.toggle || {}) },
      mode:   { ...DEFAULT_HOTKEYS.mode,   ...(CFG.hotkeys.mode || {}) },
      panel:  { ...DEFAULT_HOTKEYS.panel,  ...(CFG.hotkeys.panel || {}) },
    };
  }

  function matchHotkey(e, hk) {
    const key = (e.key || "").toLowerCase();
    return (
      key === (hk.key || "").toLowerCase() &&
      !!e.ctrlKey === !!hk.ctrl &&
      !!e.altKey === !!hk.alt &&
      !!e.shiftKey === !!hk.shift
    );
  }

  document.addEventListener("keydown", (e) => {
    // Toggle extensión
    if (matchHotkey(e, CFG.hotkeys.toggle)) {
      e.preventDefault();
      e.stopPropagation();
      KWSR.log?.("Hotkey toggle (fallback)", {});
      KWSR.pipeline?.toggleExtension?.();
      return;
    }

    // Cycle modo narrador
    if (matchHotkey(e, CFG.hotkeys.mode)) {
      e.preventDefault();
      e.stopPropagation();

      const order = ["lector", "sintetizador", "off"];
      const i = order.indexOf(S.modoNarradorGlobal);
      S.modoNarradorGlobal = order[(i + 1) % order.length];

      KWSR.api?.storage?.local?.set?.({ modoNarrador: S.modoNarradorGlobal });

      KWSR.toast?.notify?.(`Modo: ${S.modoNarradorGlobal}`);
      if (S.modoNarradorGlobal === "off") KWSR.voice?.detenerLectura?.();
      KWSR.overlay?.updateOverlayStatus?.();
      KWSR.log?.("Hotkey mode cycle", { modo: S.modoNarradorGlobal });
      return;
    }

    // Toggle panel
    if (matchHotkey(e, CFG.hotkeys.panel)) {
      // Si está OFF, no creamos UI. Panel solo si ON.
      if (!S.extensionActiva) return;

      e.preventDefault();
      e.stopPropagation();

      KWSR.overlay?.ensureOverlay?.();
      const open = S.overlayPanel && S.overlayPanel.style.display !== "none";
      KWSR.overlay?.setPanelOpen?.(!open);

      KWSR.log?.("Hotkey panel toggle", { open: !open });
      return;
    }

    // Hotkeys del player (si aplica)
    if (KWSR.overlay?.handlePlayerHotkeys?.(e)) return;
  }, true);

  // Mensajes desde background/popup
  const api = KWSR.api;
  if (api?.runtime?.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      let responded = false;

      const safeRespond = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse?.(payload); } catch {}
      };

      // Timeout de seguridad: si por alguna razón el async no vuelve,
      // respondemos igual para que Chrome no se queje.
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
        // ✅ Background command: toggle
        if (message?.action === "toggleExtension") {
          KWSR.log?.("Msg toggleExtension", { from: "background" });
          KWSR.pipeline?.toggleExtension?.();
          safeRespond({ status: "ok" });
          return false;
        }

        // ✅ Compat: background viejo
        if (message?.action === "toggleNarrator") {
          KWSR.warn?.("Msg toggleNarrator (deprecated)", { from: "background" });
          KWSR.pipeline?.toggleExtension?.();
          safeRespond({ status: "ok" });
          return false;
        }

        // Popup: update settings (async)
        if (message?.action === "updateSettings") {
          KWSR.log?.("Msg updateSettings", { from: "popup" });

          // Armamos safety porque vamos async sí o sí acá
          armSafety();

          if (KWSR.storage?.cargarConfigDesdeStorage) {
            KWSR.storage.cargarConfigDesdeStorage(() => {
              try {
                // Si está OFF no creamos UI, solo guardamos state.
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

            return true; // ✅ async
          }

          // Fallback: sin loader, hacemos lo mínimo y respondemos sync
          if (S.extensionActiva) {
            KWSR.overlay?.updateOverlayStatus?.();
            KWSR.overlay?.updateOverlayTracksList?.();
            KWSR.pipeline?.restartPipeline?.();
          }
          clearSafety();
          safeRespond({ status: "ok" });
          return false;
        }

        // Popup: set track
        if (message?.action === "setTrack") {
          const idx = Number(message.index);
          KWSR.log?.("Msg setTrack", { index: idx });

          if (Number.isFinite(idx)) {
            S.trackIndexGlobal = idx;
            api?.storage?.local?.set?.({ trackIndex: S.trackIndexGlobal });
            if (S.extensionActiva) KWSR.pipeline?.restartPipeline?.();
            KWSR.overlay?.updateOverlayTracksList?.();
            KWSR.overlay?.updateOverlayStatus?.();
          }
          safeRespond({ status: "ok" });
          return false;
        }

        // Popup: list tracks
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

        // Popup: toggle overlay panel
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

  KWSR.hotkeys = { matchHotkey };

  // ✅ entrypoint final (no UI)
  KWSR.pipeline?.init?.();

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Blindaje de onMessage:
      - safeRespond() garantiza responder solo una vez
      - safety-timeout para caminos async que se queden colgados
      - return true SOLO en updateSettings async real
  - No cambia la lógica de hotkeys ni mensajes: solo robustez.
  */
})();

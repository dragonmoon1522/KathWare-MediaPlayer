// ====================================================
// KathWare Media Player - kwmp.hotkeys.js
// - Hotkeys in-page (fallback) + mensajes desde background/popup
// - Entry: KWMP.pipeline.init()
// ====================================================

(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.hotkeys) return;

  const S = KWMP.state;
  const CFG = KWMP.CFG;

  // ✅ Fallback igual que commands: Alt+Shift+K
  const DEFAULT_HOTKEYS = {
    toggle: { ctrl: false, alt: true,  shift: true,  key: "k" }, // Alt+Shift+K
    mode:   { ctrl: true,  alt: true,  shift: false, key: "l" }, // Ctrl+Alt+L (te lo dejo como estaba)
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
    if (matchHotkey(e, CFG.hotkeys.toggle)) {
      e.preventDefault();
      e.stopPropagation();
      KWMP.log?.("Hotkey toggle (fallback)", {});
      KWMP.pipeline?.toggleExtension?.();
      return;
    }

    if (matchHotkey(e, CFG.hotkeys.mode)) {
      e.preventDefault();
      e.stopPropagation();

      const order = ["lector", "sintetizador", "off"];
      const i = order.indexOf(S.modoNarradorGlobal);
      S.modoNarradorGlobal = order[(i + 1) % order.length];

      KWMP.api?.storage?.local?.set?.({ modoNarrador: S.modoNarradorGlobal });

      KWMP.toast?.notify?.(`Modo: ${S.modoNarradorGlobal}`);
      if (S.modoNarradorGlobal === "off") KWMP.voice?.detenerLectura?.();
      KWMP.overlay?.updateOverlayStatus?.();
      KWMP.log?.("Hotkey mode cycle", { modo: S.modoNarradorGlobal });
      return;
    }

    if (matchHotkey(e, CFG.hotkeys.panel)) {
      // Si está OFF, no creamos UI. Panel solo si ON.
      if (!S.extensionActiva) return;

      e.preventDefault();
      e.stopPropagation();

      KWMP.overlay?.ensureOverlay?.();
      const open = S.overlayPanel && S.overlayPanel.style.display !== "none";
      KWMP.overlay?.setPanelOpen?.(!open);

      KWMP.log?.("Hotkey panel toggle", { open: !open });
      return;
    }

    if (KWMP.overlay?.handlePlayerHotkeys?.(e)) return;
  }, true);

  // Mensajes desde background/popup
  const api = KWMP.api;
  if (api?.runtime?.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (message?.action === "toggleNarrator") {
          KWMP.log?.("Msg toggleNarrator", { from: "background" });
          KWMP.pipeline?.toggleExtension?.();
          sendResponse?.({ status: "ok" });
          return false;
        }

        if (message?.action === "updateSettings") {
          KWMP.log?.("Msg updateSettings", { from: "popup" });

          if (KWMP.storage?.cargarConfigDesdeStorage) {
            KWMP.storage.cargarConfigDesdeStorage(() => {
              // Si está OFF no creamos UI, solo guardamos state.
              if (S.extensionActiva) {
                KWMP.overlay?.updateOverlayStatus?.();
                KWMP.overlay?.updateOverlayTracksList?.();
                KWMP.pipeline?.restartPipeline?.();
              }
              sendResponse?.({ status: "ok" });
            });
            return true;
          }

          if (S.extensionActiva) {
            KWMP.overlay?.updateOverlayStatus?.();
            KWMP.overlay?.updateOverlayTracksList?.();
            KWMP.pipeline?.restartPipeline?.();
          }
          sendResponse?.({ status: "ok" });
          return false;
        }

        if (message?.action === "setTrack") {
          const idx = Number(message.index);
          KWMP.log?.("Msg setTrack", { index: idx });

          if (Number.isFinite(idx)) {
            S.trackIndexGlobal = idx;
            api?.storage?.local?.set?.({ trackIndex: S.trackIndexGlobal });
            if (S.extensionActiva) KWMP.pipeline?.restartPipeline?.();
            KWMP.overlay?.updateOverlayTracksList?.();
            KWMP.overlay?.updateOverlayStatus?.();
          }
          sendResponse?.({ status: "ok" });
          return false;
        }

        if (message?.type === "getTracks") {
          const v = KWMP.video?.getMainVideo?.() || null;
          const tracks = v?.textTracks
            ? Array.from(v.textTracks).map(t => ({
                label: t.label || t.language || "Pista",
                language: t.language || ""
              }))
            : [];
          sendResponse?.({ tracks });
          return false;
        }

        if (message?.action === "toggleOverlayPanel") {
          if (!S.extensionActiva) {
            sendResponse?.({ status: "off" });
            return false;
          }
          KWMP.overlay?.ensureOverlay?.();
          const open = S.overlayPanel && S.overlayPanel.style.display !== "none";
          KWMP.overlay?.setPanelOpen?.(!open);
          sendResponse?.({ status: "ok" });
          return false;
        }

        sendResponse?.({ status: "noop" });
        return false;
      } catch (e) {
        KWMP.error?.("onMessage error", e);
        sendResponse?.({ status: "error", error: String(e?.message || e) });
        return false;
      }
    });
  }

  KWMP.hotkeys = { matchHotkey };

  // ✅ entrypoint final (no UI)
  KWMP.pipeline?.init?.();
})();

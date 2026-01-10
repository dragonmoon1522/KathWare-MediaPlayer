(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.hotkeys) return;

  const S = KWMP.state;
  const CFG = KWMP.CFG;

  function matchHotkey(e, hk) {
    const key = (e.key || "").toLowerCase();
    return (
      key === hk.key &&
      !!e.ctrlKey === !!hk.ctrl &&
      !!e.altKey === !!hk.alt &&
      !!e.shiftKey === !!hk.shift
    );
  }

  document.addEventListener("keydown", (e) => {
    if (matchHotkey(e, CFG.hotkeys.toggle)) {
      e.preventDefault();
      e.stopPropagation();
      KWMP.pipeline.toggleExtension();
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
      if (S.modoNarradorGlobal === "off") KWMP.voice.detenerLectura();
      KWMP.overlay?.updateOverlayStatus?.();
      return;
    }
    if (matchHotkey(e, CFG.hotkeys.panel)) {
      e.preventDefault();
      e.stopPropagation();
      KWMP.overlay?.ensureOverlay?.();
      const open = S.overlayPanel && S.overlayPanel.style.display !== "none";
      KWMP.overlay?.setPanelOpen?.(!open);
      return;
    }

    // hotkeys del reproductor (si overlay lo expone)
    if (KWMP.overlay?.handlePlayerHotkeys?.(e)) return;
  }, true);

  // Mensajes desde background/popup
  const api = KWMP.api;
  if (api?.runtime?.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (message?.action === "toggleNarrator") {
          KWMP.pipeline.toggleExtension();
          sendResponse?.({ status: "ok" });
          return false;
        }

        if (message?.action === "updateSettings") {
          // Si existe storage, refresca CFG/state desde storage
          if (KWMP.storage?.cargarConfigDesdeStorage) {
            KWMP.storage.cargarConfigDesdeStorage(() => {
              KWMP.overlay?.updateOverlayStatus?.();
              KWMP.overlay?.updateOverlayTracksList?.();
              if (S.extensionActiva) KWMP.pipeline.restartPipeline();
              sendResponse?.({ status: "ok" });
            });
            return true;
          }
          // fallback sin storage
          KWMP.overlay?.updateOverlayStatus?.();
          KWMP.overlay?.updateOverlayTracksList?.();
          if (S.extensionActiva) KWMP.pipeline.restartPipeline();
          sendResponse?.({ status: "ok" });
          return false;
        }

        if (message?.action === "setTrack") {
          const idx = Number(message.index);
          if (Number.isFinite(idx)) {
            S.trackIndexGlobal = idx;
            api?.storage?.local?.set?.({ trackIndex: S.trackIndexGlobal });
            if (S.extensionActiva) KWMP.pipeline.restartPipeline();
            KWMP.overlay?.updateOverlayTracksList?.();
            KWMP.overlay?.updateOverlayStatus?.();
          }
          sendResponse?.({ status: "ok" });
          return false;
        }

        if (message?.type === "getTracks") {
          const v = KWMP.video?.getMainVideo?.();
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
          KWMP.overlay?.ensureOverlay?.();
          const open = S.overlayPanel && S.overlayPanel.style.display !== "none";
          KWMP.overlay?.setPanelOpen?.(!open);
          sendResponse?.({ status: "ok" });
          return false;
        }

        sendResponse?.({ status: "noop" });
        return false;
      } catch (e) {
        KWMP.log("onMessage error", e);
        sendResponse?.({ status: "error", error: String(e?.message || e) });
        return false;
      }
    });
  }

  KWMP.hotkeys = { matchHotkey };

  // ✅ entrypoint final
  KWMP.pipeline.init();
})();

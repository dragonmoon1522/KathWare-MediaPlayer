(() => {
  if (window.KWMP?.loadedAt) return;

  const api =
    (typeof chrome !== "undefined" && chrome?.runtime) ? chrome :
    (typeof browser !== "undefined" && browser?.runtime) ? browser :
    null;

  window.KWMP = {
    version: "2.0.0",
    loadedAt: Date.now(),
    api,

    CFG: {
      debug: true,

      pollMsTrack: 250,
      rehookMs: 1000,
      pollMsVisual: 450,
      cooldownMs: 650,
      burstMs: 450,
      visualReselectMs: 1200,
      keepControlsMs: 850,

      seekSmall: 5,
      seekBig: 10,
      volStep: 0.05,

      hotkeys: {
        toggle: { ctrl: true, alt: true,  shift: false, key: "k" },
        mode:   { ctrl: true, alt: true,  shift: false, key: "l" },
        panel:  { ctrl: true, alt: true,  shift: false, key: "o" }
      },

      autoOpenPanelOnSubs: false
    },

    // Estado único (acá van TODAS las variables sueltas de tu content.js)
    state: {
      extensionActiva: false,

      // settings
      modoNarradorGlobal: "lector",
      fuenteSubGlobal: "auto",
      trackIndexGlobal: 0,
      effectiveFuente: "visual",

      // refs
      currentVideo: null,
      currentTrack: null,

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

      // live region + voice
      liveRegion: null,
      voiceES: null,

      // timers
      pollTimerTrack: null,
      rehookTimer: null,
      pollTimerVisual: null,
      visualReselectTimer: null,
      keepControlsTimer: null,

      // visual observer
      visualObserver: null,
      visualObserverActive: false,
      visualNode: null,
      visualSelectors: null,

      // dedupe read
      lastEmitText: "",
      lastEmitAt: 0,
      lastTrackSeen: "",
      lastVisualSeen: "",

      // flow a11y
      flowMenuObserver: null,
      flowMenusProcessed: new WeakSet(),
      lastFlowControlsSig: "",
      lastFlowLabeledCount: 0,

      // signature
      lastSig: ""
    }
  };

  // Logger común
  window.KWMP.log = (...a) => window.KWMP.CFG.debug && console.log("[KathWare]", ...a);

  window.KWMP.log("bootstrap listo", location.hostname);
})();

(() => {
  // ============================
  // KathWareMediaPlayer - Console Probe (v4) [repo-ready]
  // Goal: paste in DevTools console and work on (almost) any player:
  // - Rehook when site replaces tracks/video (SPA-proof-ish)
  // - Poll activeCues (prevents stuck overlay / missed cuechange)
  // - Full cleanup of previous runs
  //
  // Hotkeys:
  //   Ctrl+Alt+K -> ON/OFF
  //   Ctrl+Alt+L -> cycle outputMode (live/tts/both/none)
  //
  // API:
  //   __kathware.toggle()
  //   __kathware.mode()
  //   __kathware.status()
  //   __kathware.set({ enabled, outputMode, debug })
  //   __kathware.rebind()
  //   __kathware.destroy()
  //   __kathware.help()
  // ============================

  const VERSION = "v4.1-repo";

  // --- Cleanup any previous instance hard ---
  try { window.__kathware?.destroy?.(); } catch {}
  try {
    const old = document.getElementById("kathware-overlay");
    if (old) old.remove();
    // Live region intentionally kept (optional)
  } catch {}

  const CFG = {
    debug: true,
    enabled: true,
    outputMode: "live", // "live" | "tts" | "both" | "none"
    cooldownMs: 700,
    cancelSpeechEachCue: true,

    pollMs: 250,
    rehookMs: 1000,

    hotkeys: {
      toggle: { ctrl: true, alt: true, shift: false, key: "k" },
      mode:   { ctrl: true, alt: true, shift: false, key: "l" },
    },
  };

  const log = (...a) => CFG.debug && console.log("[KATHWARE DEBUG]", ...a);
  const normalize = (s) =>
    (s ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const isActiveMode = (mode) => mode === "showing" || mode === "hidden";

  // ---------- Live Region ----------
  const ensureLiveRegion = () => {
    let lr = document.getElementById("kathware-live-region");
    if (!lr) {
      lr = document.createElement("div");
      lr.id = "kathware-live-region";
      lr.setAttribute("role", "status");
      lr.setAttribute("aria-live", "polite");
      lr.setAttribute("aria-atomic", "true");
      lr.style.position = "fixed";
      lr.style.left = "-9999px";
      lr.style.top = "0";
      lr.style.width = "1px";
      lr.style.height = "1px";
      lr.style.overflow = "hidden";
      document.documentElement.appendChild(lr);
      log("✅ LiveRegion creada");
    }
    return lr;
  };

  const pushToLiveRegion = (() => {
    const lr = ensureLiveRegion();
    let last = "";
    let lastAt = 0;
    return (text) => {
      const t = normalize(text);
      if (!t) return;

      const ts = Date.now();
      if (t === last && ts - lastAt < CFG.cooldownMs) return;
      last = t; lastAt = ts;

      lr.textContent = "";
      setTimeout(() => { lr.textContent = t; }, 10);
    };
  })();

  // ---------- TTS ----------
  const speakTTS = (() => {
    let last = "";
    let lastAt = 0;
    return (text) => {
      const t = normalize(text);
      if (!t) return;

      const ts = Date.now();
      if (t === last && ts - lastAt < CFG.cooldownMs) return;
      last = t; lastAt = ts;

      try {
        if (CFG.cancelSpeechEachCue) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(t);
        u.lang = "es-AR";
        speechSynthesis.speak(u);
      } catch (e) {
        log("❌ TTS error:", e);
      }
    };
  })();

  // ---------- Overlay ----------
  const ensureOverlay = () => {
    let box = document.getElementById("kathware-overlay");
    if (!box) {
      box = document.createElement("div");
      box.id = "kathware-overlay";
      box.style.position = "fixed";
      box.style.left = "16px";
      box.style.bottom = "16px";
      box.style.maxWidth = "75vw";
      box.style.zIndex = "2147483647";
      box.style.pointerEvents = "none";
      box.style.padding = "12px 14px";
      box.style.borderRadius = "12px";
      box.style.background = "rgba(0,0,0,0.78)";
      box.style.color = "#fff";
      box.style.fontSize = "16px";
      box.style.lineHeight = "1.35";
      box.style.fontFamily =
        "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
      box.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
      box.innerHTML = `
        <div id="kathware-overlay-status" style="opacity:.9;font-size:13px;margin-bottom:6px;"></div>
        <div id="kathware-overlay-text" style="white-space:pre-wrap;"></div>
        <div style="opacity:.7;font-size:12px;margin-top:8px;">
          KathWare Probe ${VERSION} | Hotkeys: Ctrl+Alt+K ON/OFF | Ctrl+Alt+L modo
        </div>
      `;
      document.documentElement.appendChild(box);
      log("✅ Overlay creado");
    }
    return box;
  };

  const overlay = (() => {
    const box = ensureOverlay();
    const statusEl = box.querySelector("#kathware-overlay-status");
    const textEl = box.querySelector("#kathware-overlay-text");

    const render = ({ enabled, outputMode, trackInfo, state, text }) => {
      const modeEmoji =
        outputMode === "live" ? "🧏" :
        outputMode === "tts"  ? "🗣️" :
        outputMode === "both" ? "🧏+🗣️" : "🙊";

      statusEl.textContent =
        `${enabled ? "🟢 ON" : "🔴 OFF"} ${modeEmoji} ${outputMode.toUpperCase()} | ${state} | ${trackInfo}`;
      textEl.textContent = text || "";
      box.style.display = enabled ? "block" : "none";
    };

    return { render };
  })();

  // ---------- Video + Track selection ----------
  const findVideosRecursively = (root = document, out = new Set()) => {
    try {
      root.querySelectorAll("video").forEach((v) => out.add(v));
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) findVideosRecursively(el.shadowRoot, out);
      });
    } catch {}
    return Array.from(out);
  };

  const pickLargestVideo = (videos) => {
    if (!videos.length) return null;
    try {
      return (
        videos
          .map((v) => {
            const r = v.getBoundingClientRect();
            return { v, area: Math.max(0, r.width) * Math.max(0, r.height) };
          })
          .sort((a, b) => b.area - a.area)[0]?.v || videos[0]
      );
    } catch {
      return videos[0];
    }
  };

  const describeTrack = (t) => {
    if (!t) return "Sin track";
    const cuesLen = (() => { try { return t.cues ? t.cues.length : 0; } catch { return "?"; } })();
    return `${t.label || "(sin label)"} lang=${t.language || "??"} mode=${t.mode} cues=${cuesLen}`;
  };

  const pickBestTrack = (video) => {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return null;

    return (
      list.find((t) => t.mode === "showing") ||
      list.find((t) => t.mode === "hidden" && t.cues && t.cues.length) ||
      list.find((t) => t.mode === "hidden") ||
      list[0] ||
      null
    );
  };

  // ---------- Engine ----------
  const engine = {
    video: null,
    track: null,
    lastText: "",
    lastEmitted: "",
    onKeyDown: null,
    pollTimer: null,
    rehookTimer: null,
  };

  const updateOverlay = () => {
    const trackInfo = describeTrack(engine.track);
    const state = engine.track ? (isActiveMode(engine.track.mode) ? "ACTIVO" : "INACTIVO") : "SIN TRACK";
    overlay.render({
      enabled: CFG.enabled,
      outputMode: CFG.outputMode,
      trackInfo,
      state,
      text: engine.lastText || "",
    });
  };

  const output = (text) => {
    const t = normalize(text);
    if (!t) return;

    engine.lastText = t;
    updateOverlay();

    if (!CFG.enabled) return;

    if (CFG.outputMode === "live") pushToLiveRegion(t);
    else if (CFG.outputMode === "tts") speakTTS(t);
    else if (CFG.outputMode === "both") { pushToLiveRegion(t); speakTTS(t); }
  };

  const readActiveCues = (track) => {
    try {
      const active = track?.activeCues ? Array.from(track.activeCues) : [];
      const joined = active.map((c) => c.text || "").join(" / ");
      return normalize(joined);
    } catch {
      return "";
    }
  };

  const attachHandlers = (track) => {
    if (!track) return;

    try { track.oncuechange = null; } catch {}

    track.oncuechange = () => {
      const text = readActiveCues(track);
      if (text) {
        log("🎯 cuechange:", text);
        output(text);
      }
    };

    log("✅ Hook oncuechange en:", describeTrack(track));

    const initial = readActiveCues(track);
    if (initial) {
      log("▶️ activeCues inicial:", initial);
      output(initial);
    } else {
      updateOverlay();
    }
  };

  const bind = () => {
    const vids = findVideosRecursively();
    const chosen = pickLargestVideo(vids);

    if (!chosen) {
      engine.video = null;
      engine.track = null;
      engine.lastText = "⛔ No se detectaron videos (ni en shadowRoot).";
      updateOverlay();
      return;
    }

    const best = pickBestTrack(chosen);
    engine.video = chosen;
    engine.track = best;

    if (!best) {
      engine.lastText = "⛔ No hay video.textTracks (posible subtítulo visual).";
      updateOverlay();
      return;
    }

    try { if (best.mode === "disabled") best.mode = "hidden"; } catch {}

    log("🎥 Video:", chosen);
    log("⭐ Track:", describeTrack(best));
    attachHandlers(best);
    updateOverlay();
  };

  const startPolling = () => {
    engine.pollTimer = setInterval(() => {
      if (!engine.track) return;
      const text = readActiveCues(engine.track);
      if (!text) return;

      if (text !== engine.lastEmitted) {
        engine.lastEmitted = text;
        log("⏱️ poll:", text);
        output(text);
      }
    }, CFG.pollMs);
  };

  const startRehooking = () => {
    let lastSig = "";
    engine.rehookTimer = setInterval(() => {
      const vids = findVideosRecursively();
      const chosen = pickLargestVideo(vids);
      const best = chosen ? pickBestTrack(chosen) : null;

      const sig = `${chosen ? (chosen.currentSrc || chosen.src || "v") : "noV"}|${best ? (best.label + best.language + best.mode) : "noT"}|${best ? (best.cues ? best.cues.length : 0) : 0}`;
      if (sig !== lastSig) {
        lastSig = sig;
        log("🔄 Rehook detectado (cambio de video/track)", sig);
        bind();
      }
    }, CFG.rehookMs);
  };

  // ---------- Hotkeys ----------
  const matchHotkey = (e, hk) => {
    const key = (e.key || "").toLowerCase();
    return (
      key === hk.key &&
      !!e.ctrlKey === hk.ctrl &&
      !!e.altKey === hk.alt &&
      !!e.shiftKey === hk.shift
    );
  };

  const toggleEnabled = () => {
    CFG.enabled = !CFG.enabled;
    log(CFG.enabled ? "🟢 ENABLED" : "🔴 DISABLED");
    if (!CFG.enabled) { try { speechSynthesis.cancel(); } catch {} }
    updateOverlay();
  };

  const cycleMode = () => {
    const modes = ["live", "tts", "both", "none"];
    const i = modes.indexOf(CFG.outputMode);
    CFG.outputMode = modes[(i + 1) % modes.length];
    log("🔁 outputMode =>", CFG.outputMode);
    updateOverlay();
  };

  engine.onKeyDown = (e) => {
    if (matchHotkey(e, CFG.hotkeys.toggle)) {
      e.preventDefault();
      e.stopPropagation();
      toggleEnabled();
      return;
    }
    if (matchHotkey(e, CFG.hotkeys.mode)) {
      e.preventDefault();
      e.stopPropagation();
      cycleMode();
    }
  };

  window.addEventListener("keydown", engine.onKeyDown, true);

  // ---------- Public API ----------
  window.__kathware = {
    toggle: toggleEnabled,
    mode: cycleMode,
    set: (opts = {}) => {
      if (typeof opts.debug === "boolean") CFG.debug = opts.debug;
      if (typeof opts.enabled === "boolean") CFG.enabled = opts.enabled;
      if (typeof opts.outputMode === "string") CFG.outputMode = opts.outputMode;
      log("⚙️ set:", { debug: CFG.debug, enabled: CFG.enabled, outputMode: CFG.outputMode });
      updateOverlay();
    },
    status: () => ({
      version: VERSION,
      enabled: CFG.enabled,
      outputMode: CFG.outputMode,
      track: engine.track ? describeTrack(engine.track) : null,
      lastText: engine.lastText,
    }),
    rebind: () => bind(),
    destroy: () => {
      try { window.removeEventListener("keydown", engine.onKeyDown, true); } catch {}
      try { clearInterval(engine.pollTimer); } catch {}
      try { clearInterval(engine.rehookTimer); } catch {}
      log("🧹 Probe destruido.");
    },
    help: () => ({
      version: VERSION,
      hotkeys: "Ctrl+Alt+K (ON/OFF) | Ctrl+Alt+L (modo)",
      modes: ["live", "tts", "both", "none"],
      tips: [
        "Filtrá la consola por 'KATHWARE' para ver solo lo nuestro.",
        "Si no hay textTracks, ese player usa subtítulos visuales (habrá que hacer un probe visual).",
        "En algunos sitios, captions cargan tarde: dejá correr unos segundos.",
      ],
    }),
  };

  log(`✨ KathWare Console Probe ${VERSION} listo.`);
  log("⌨️ Hotkeys: Ctrl+Alt+K (ON/OFF) | Ctrl+Alt+L (modo)");
  log("🧩 API: __kathware.toggle() | __kathware.mode() | __kathware.set(...) | __kathware.status() | __kathware.rebind() | __kathware.destroy() | __kathware.help()");

  // ---------- Start ----------
  bind();
  startPolling();
  startRehooking();
})();

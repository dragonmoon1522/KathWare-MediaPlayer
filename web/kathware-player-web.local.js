// ====================================================
// KathWare Player - Reproductor accesible para la web
// (core + lógica del player unificados) - v4 engine
// - Rehook + Polling (no se congela)
// - Overlay minimizado: se expande solo si hay subtítulos
// - Hotkeys configurables (localStorage) para demo consola/repo
// ====================================================

document.addEventListener("DOMContentLoaded", () => {
  const video        = document.getElementById("videoPlayer");
  const inputVideo   = document.getElementById("videoInput");
  const inputSubs    = document.getElementById("subtitleInput");
  const modoNarrador = document.getElementById("modoNarrador"); // off | lector | sintetizador
  const fuenteSub    = document.getElementById("fuenteSub");    // auto | track | visual
  const liveRegion   = document.getElementById("sub-accesible"); // si existe, lo usamos

  // Para que los botones inline (onclick="video...") sigan funcionando
  window.video = video;

  // -------------------- Config demo (hotkeys) --------------------
  // En la demo guardamos hotkeys en localStorage.
  // En extensión real esto irá a storage + commands.
  const DEFAULT_HOTKEYS = {
    toggle: "Ctrl+Alt+K",
    mode: "Ctrl+Alt+L",
  };

  const loadHotkeys = () => {
    try {
      const raw = localStorage.getItem("kathware_hotkeys");
      return raw ? { ...DEFAULT_HOTKEYS, ...JSON.parse(raw) } : { ...DEFAULT_HOTKEYS };
    } catch {
      return { ...DEFAULT_HOTKEYS };
    }
  };

  const saveHotkeys = (hk) => {
    localStorage.setItem("kathware_hotkeys", JSON.stringify(hk));
  };

  // API pública para la demo:
  // KathWare.setHotkeys({ toggle: "Ctrl+Shift+Y", mode: "Alt+L" })
  window.KathWare = window.KathWare || {};
  window.KathWare.setHotkeys = (hk) => {
    const current = loadHotkeys();
    const next = { ...current, ...hk };
    saveHotkeys(next);
    console.log("[KathWare] Hotkeys guardados:", next);
    return next;
  };
  window.KathWare.getHotkeys = () => loadHotkeys();

  // -------------------- Engine state --------------------
  const CFG = {
    debug: true,
    enabled: true,

    // "live" | "tts" | "both" | "none"
    outputMode: "live",

    // "auto" | "track" | "visual"
    sourceMode: "auto",

    cooldownMs: 650,
    cancelSpeechEachCue: true,

    pollMs: 250,
    rehookMs: 1000,
  };

  let voiceES = null;

  const log = (...a) => CFG.debug && console.log("[KATHWARE]", ...a);

  const normalize = (s) =>
    (s ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const stripHtml = (s) => (s || "").replace(/<[^>]+>/g, "");

  function cargarVozES() {
    if (typeof speechSynthesis === "undefined") return;

    const pick = () => {
      const voces = speechSynthesis.getVoices() || [];
      voiceES = voces.find(v => v.lang && v.lang.startsWith("es")) || null;
    };

    pick();
    if (!voiceES) {
      speechSynthesis.onvoiceschanged = () => pick();
    }
  }

  function detenerLectura() {
    try { speechSynthesis.cancel(); } catch {}
    if (liveRegion) liveRegion.textContent = "";
    engine.lastEmitted = "";
    engine.lastText = "";
    updateOverlay(""); // minimiza
  }

  // -------------------- Output (live region / tts) --------------------
  const pushToLiveRegion = (() => {
    let last = "";
    let lastAt = 0;

    return (text) => {
      if (!liveRegion) return;
      const t = normalize(text);
      if (!t) return;

      const ts = Date.now();
      if (t === last && ts - lastAt < CFG.cooldownMs) return;
      last = t; lastAt = ts;

      // truco SR: limpiar y set con micro-delay
      liveRegion.textContent = "";
      setTimeout(() => { liveRegion.textContent = t; }, 10);
    };
  })();

  const speakTTS = (() => {
    let last = "";
    let lastAt = 0;

    return (text) => {
      const t = normalize(text);
      if (!t) return;

      const ts = Date.now();
      if (t === last && ts - lastAt < CFG.cooldownMs) return;
      last = t; lastAt = ts;

      if (typeof speechSynthesis === "undefined") return;
      if (!voiceES) return;

      try {
        if (CFG.cancelSpeechEachCue) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(t);
        u.voice = voiceES;
        u.lang = voiceES.lang || "es-AR";
        speechSynthesis.speak(u);
      } catch (e) {
        log("❌ TTS error:", e);
      }
    };
  })();

  // -------------------- Overlay (minimizado, expande con subtítulos) --------------------
  const overlay = (() => {
    let root = null;
    let pill = null;
    let panel = null;
    let statusEl = null;
    let textEl = null;

    const ensure = () => {
      if (root) return;

      root = document.createElement("div");
      root.id = "kathware-overlay";
      root.style.position = "fixed";
      root.style.right = "14px";
      root.style.bottom = "14px";
      root.style.zIndex = "2147483647";
      root.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";

      // pill (siempre visible)
      pill = document.createElement("button");
      pill.type = "button";
      pill.setAttribute("aria-label", "Abrir KathWare Player");
      pill.textContent = "KW";
      pill.style.width = "46px";
      pill.style.height = "46px";
      pill.style.borderRadius = "999px";
      pill.style.border = "0";
      pill.style.cursor = "pointer";
      pill.style.background = "rgba(0,0,0,0.78)";
      pill.style.color = "#fff";
      pill.style.fontWeight = "700";
      pill.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";

      // panel (solo visible cuando hay subs o cuando el user abre)
      panel = document.createElement("div");
      panel.style.display = "none";
      panel.style.marginBottom = "10px";
      panel.style.padding = "12px 14px";
      panel.style.borderRadius = "12px";
      panel.style.background = "rgba(0,0,0,0.78)";
      panel.style.color = "#fff";
      panel.style.maxWidth = "75vw";
      panel.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";

      statusEl = document.createElement("div");
      statusEl.style.opacity = ".9";
      statusEl.style.fontSize = "13px";
      statusEl.style.marginBottom = "6px";

      textEl = document.createElement("div");
      textEl.style.whiteSpace = "pre-wrap";
      textEl.style.fontSize = "16px";
      textEl.style.lineHeight = "1.35";

      const controls = document.createElement("div");
      controls.style.marginTop = "10px";
      controls.style.display = "flex";
      controls.style.gap = "8px";
      controls.style.flexWrap = "wrap";

      const btnToggle = document.createElement("button");
      btnToggle.type = "button";
      btnToggle.textContent = "ON/OFF";
      btnToggle.style.padding = "6px 10px";
      btnToggle.style.borderRadius = "10px";
      btnToggle.style.border = "0";
      btnToggle.style.cursor = "pointer";

      const btnMode = document.createElement("button");
      btnMode.type = "button";
      btnMode.textContent = "Modo";
      btnMode.style.padding = "6px 10px";
      btnMode.style.borderRadius = "10px";
      btnMode.style.border = "0";
      btnMode.style.cursor = "pointer";

      const btnClose = document.createElement("button");
      btnClose.type = "button";
      btnClose.textContent = "Cerrar";
      btnClose.style.padding = "6px 10px";
      btnClose.style.borderRadius = "10px";
      btnClose.style.border = "0";
      btnClose.style.cursor = "pointer";

      btnToggle.addEventListener("click", () => engine.toggleEnabled());
      btnMode.addEventListener("click", () => engine.cycleOutputMode());
      btnClose.addEventListener("click", () => setExpanded(false));

      controls.appendChild(btnToggle);
      controls.appendChild(btnMode);
      controls.appendChild(btnClose);

      panel.appendChild(statusEl);
      panel.appendChild(textEl);
      panel.appendChild(controls);

      root.appendChild(panel);
      root.appendChild(pill);

      document.documentElement.appendChild(root);

      pill.addEventListener("click", () => {
        // Si no hay texto, igual permite abrir para usar controles manuales
        setExpanded(panel.style.display === "none");
      });
    };

    const setExpanded = (expanded) => {
      ensure();
      panel.style.display = expanded ? "block" : "none";
    };

    const render = ({ enabled, outputMode, sourceMode, trackInfo, state, text }) => {
      ensure();

      const modeEmoji =
        outputMode === "live" ? "🧏" :
        outputMode === "tts"  ? "🗣️" :
        outputMode === "both" ? "🧏+🗣️" : "🙊";

      const srcEmoji =
        sourceMode === "track" ? "🎛️TRACK" :
        sourceMode === "visual" ? "👀VISUAL" : "🤖AUTO";

      statusEl.textContent =
        `${enabled ? "🟢 ON" : "🔴 OFF"} ${modeEmoji} ${outputMode.toUpperCase()} | ${srcEmoji} | ${state} | ${trackInfo}`;

      textEl.textContent = text || "";

      // Requisito: solo expandir automáticamente cuando hay subtítulos (texto)
      if (text && text.trim()) {
        setExpanded(true);
      }
    };

    return { render, setExpanded };
  })();

  const updateOverlay = (text) => {
    overlay.render({
      enabled: CFG.enabled,
      outputMode: CFG.outputMode,
      sourceMode: CFG.sourceMode,
      trackInfo: engine.track ? engine.describeTrack(engine.track) : "Sin track",
      state: engine.track ? (engine.isActiveTrack(engine.track) ? "ACTIVO" : "INACTIVO") : "SIN TRACK",
      text: text || "",
    });
  };

  // -------------------- Track reading helpers --------------------
  function convertirSRTaVTT(srt) {
    return "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  }

  // -------------------- Local video/audio inputs --------------------
  inputVideo?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    video.src = url;
    video.load();
    log("🎥 Video local cargado:", file.name);
  });

  inputSubs?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop().toLowerCase();
    const reader = new FileReader();

    reader.onload = () => {
      let texto = reader.result;

      if (ext === "srt") texto = convertirSRTaVTT(texto);

      const blob = new Blob([texto], { type: "text/vtt" });
      const trackEl = document.createElement("track");
      trackEl.kind = "subtitles";
      trackEl.label = "Subtítulos";
      trackEl.srclang = "es";
      trackEl.src = URL.createObjectURL(blob);
      trackEl.default = true;

      video.appendChild(trackEl);

      // Esperar a que textTracks aparezcan y reenganchar
      setTimeout(() => {
        engine.rebind();
      }, 350);

      log("💬 Subtítulos cargados:", file.name);
    };

    reader.readAsText(file);
  });

  // -------------------- Engine v4 (rehook + polling) --------------------
  const engine = {
    videoEl: video,
    track: null,
    lastText: "",
    lastEmitted: "",
    pollTimer: null,
    rehookTimer: null,

    describeTrack(t) {
      if (!t) return "Sin track";
      let cuesLen = "?";
      try { cuesLen = t.cues ? t.cues.length : 0; } catch {}
      return `${t.label || "(sin label)"} lang=${t.language || "??"} mode=${t.mode} cues=${cuesLen}`;
    },

    isActiveTrack(t) {
      return t && (t.mode === "showing" || t.mode === "hidden");
    },

    pickBestTrack(videoEl) {
      const list = Array.from(videoEl?.textTracks || []);
      if (!list.length) return null;

      return (
        list.find(t => t.mode === "showing") ||
        list.find(t => t.mode === "hidden" && t.cues && t.cues.length) ||
        list.find(t => t.mode === "hidden") ||
        list[0] ||
        null
      );
    },

    readActiveCues(t) {
      try {
        const active = t?.activeCues ? Array.from(t.activeCues) : [];
        const joined = active.map(c => c.text || "").join(" / ");
        return normalize(stripHtml(joined));
      } catch {
        return "";
      }
    },

    output(text) {
      const t = normalize(stripHtml(text));
      if (!t) return;

      // Overlay siempre
      this.lastText = t;
      updateOverlay(t);

      if (!CFG.enabled) return;

      if (CFG.outputMode === "live") pushToLiveRegion(t);
      else if (CFG.outputMode === "tts") speakTTS(t);
      else if (CFG.outputMode === "both") { pushToLiveRegion(t); speakTTS(t); }
      else { /* none */ }
    },

    attachTrack(t) {
      if (!t) return;

      // En auto/track: aseguramos hidden si estaba disabled
      try { if (t.mode === "disabled") t.mode = "hidden"; } catch {}

      // Reemplazar handler (evitar duplicados)
      try { t.oncuechange = null; } catch {}

      t.oncuechange = () => {
        if (CFG.sourceMode === "visual") return; // si el user forzó visual, ignorar
        const txt = this.readActiveCues(t);
        if (txt) {
          log("🎯 cuechange:", txt);
          this.output(txt);
          this.lastEmitted = txt;
        }
      };

      // Inicial
      const initial = this.readActiveCues(t);
      if (initial) {
        log("▶️ activeCues inicial:", initial);
        this.output(initial);
        this.lastEmitted = initial;
      } else {
        updateOverlay(this.lastText);
      }

      log("✅ Track hook:", this.describeTrack(t));
    },

    readVisualCaption() {
      // Para demo local: plyr + heurísticas generales
      const el = document.querySelector(
        ".plyr__caption, .flirc-caption, [class*='caption'], [class*='cc'], [aria-label*='closed']"
      );
      const txt = normalize(stripHtml(el?.textContent || ""));
      return txt;
    },

    poll() {
      // 1) TRACK si corresponde
      if (CFG.sourceMode !== "visual" && this.track) {
        const txt = this.readActiveCues(this.track);
        if (txt && txt !== this.lastEmitted) {
          log("⏱️ poll(track):", txt);
          this.lastEmitted = txt;
          this.output(txt);
          return; // si hay track, priorizamos
        }
      }

      // 2) VISUAL si corresponde (o auto sin track útil)
      if (CFG.sourceMode === "visual" || (CFG.sourceMode === "auto" && !this.track)) {
        const txt = this.readVisualCaption();
        if (txt && txt !== this.lastEmitted) {
          log("⏱️ poll(visual):", txt);
          this.lastEmitted = txt;
          this.output(txt);
        }
      }
    },

    rebind() {
      // Elegir track nuevamente (por si cambió)
      const best = this.pickBestTrack(this.videoEl);
      if (best !== this.track) {
        this.track = best;
        log("🔄 Rebind track =>", this.describeTrack(best));
        if (best) this.attachTrack(best);
      }
      updateOverlay(this.lastText);
    },

    start() {
      // aplicar selects al engine
      this.syncFromUI();

      // timers
      this.pollTimer = setInterval(() => this.poll(), CFG.pollMs);
      this.rehookTimer = setInterval(() => this.rebind(), CFG.rehookMs);

      // primer bind
      this.rebind();
      log("🚀 Engine v4 iniciado");
    },

    stop() {
      try { clearInterval(this.pollTimer); } catch {}
      try { clearInterval(this.rehookTimer); } catch {}
      this.pollTimer = null;
      this.rehookTimer = null;
      detenerLectura();
      log("🧹 Engine detenido");
    },

    toggleEnabled() {
      CFG.enabled = !CFG.enabled;
      if (!CFG.enabled) detenerLectura();
      updateOverlay(this.lastText);
      log(CFG.enabled ? "🟢 ENABLED" : "🔴 DISABLED");
    },

    cycleOutputMode() {
      const modes = ["live", "tts", "both", "none"];
      const idx = modes.indexOf(CFG.outputMode);
      CFG.outputMode = modes[(idx + 1) % modes.length];
      updateOverlay(this.lastText);
      log("🔁 outputMode =>", CFG.outputMode);
    },

    syncFromUI() {
      // Modo narrador (select viejo) -> outputMode
      if (modoNarrador) {
        const m = modoNarrador.value || "off";
        if (m === "off") CFG.outputMode = "none";
        else if (m === "lector") CFG.outputMode = "live";
        else if (m === "sintetizador") CFG.outputMode = "tts";
      }

      // Fuente subs -> sourceMode
      if (fuenteSub) {
        const f = fuenteSub.value || "auto";
        CFG.sourceMode = (f === "track" || f === "visual") ? f : "auto";
      }

      updateOverlay(this.lastText);
    },
  };

  // -------------------- UI listeners --------------------
  modoNarrador?.addEventListener("change", () => {
    engine.syncFromUI();
    if (modoNarrador.value === "off") detenerLectura();
  });

  fuenteSub?.addEventListener("change", () => {
    engine.syncFromUI();
    engine.rebind();
  });

  // -------------------- Hotkeys (configurables) --------------------
  const parseCombo = (combo) => {
    // "Ctrl+Alt+K" => {ctrl:true, alt:true, shift:false, key:"k"}
    const parts = String(combo || "").split("+").map(p => p.trim().toLowerCase()).filter(Boolean);
    const key = parts.find(p => !["ctrl","control","alt","shift","meta","cmd","command"].includes(p)) || "";
    return {
      ctrl: parts.includes("ctrl") || parts.includes("control"),
      alt: parts.includes("alt"),
      shift: parts.includes("shift"),
      meta: parts.includes("meta") || parts.includes("cmd") || parts.includes("command"),
      key,
    };
  };

  const matchCombo = (e, comboObj) => {
    const k = (e.key || "").toLowerCase();
    return (
      k === comboObj.key &&
      !!e.ctrlKey === !!comboObj.ctrl &&
      !!e.altKey === !!comboObj.alt &&
      !!e.shiftKey === !!comboObj.shift &&
      !!e.metaKey === !!comboObj.meta
    );
  };

  let hk = loadHotkeys();
  let hkToggle = parseCombo(hk.toggle);
  let hkMode   = parseCombo(hk.mode);

  // Si el user cambia hotkeys vía API en runtime, recargamos
  const refreshHotkeys = () => {
    hk = loadHotkeys();
    hkToggle = parseCombo(hk.toggle);
    hkMode   = parseCombo(hk.mode);
    log("⌨️ Hotkeys:", hk);
  };
  refreshHotkeys();

  document.addEventListener("keydown", (e) => {
    // No secuestrar cuando escribe
    const ae = document.activeElement;
    const typing =
      ae &&
      (ae.tagName === "INPUT" ||
        ae.tagName === "TEXTAREA" ||
        ae.tagName === "SELECT" ||
        ae.isContentEditable);
    if (typing) return;

    // Releer por si cambiaron
    // (barato; si querés optimizar, lo atamos a un evento)
    refreshHotkeys();

    if (matchCombo(e, hkToggle)) {
      e.preventDefault();
      e.stopPropagation();
      engine.toggleEnabled();
    } else if (matchCombo(e, hkMode)) {
      e.preventDefault();
      e.stopPropagation();
      engine.cycleOutputMode();
    }
  }, true);

  // -------------------- Init --------------------
  cargarVozES();
  engine.start();
});

// ====================================================
// KathWare SubtitleReader - kwsr.voice.js
// - Voice engine (TTS + "lector" via liveRegion)
// - FIX: manejo real de errores async (no throw en onerror)
// - Anti-freeze watchdog + fallback a live region
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.voice) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;
  const { normalize } = KWSR.utils;

  let lastSpeakAt = 0;
  let ttsBrokenUntil = 0;
  let lastTtsError = "";
  let watchdogTimer = null;

  // Si querés que al fallar TTS cambie automáticamente el modo a "lector":
  const AUTO_SWITCH_TO_READER_ON_TTS_FAIL = true;

  function ensureLiveRegion() {
    if (S.liveRegion) return;

    const div = document.createElement("div");
    div.id = "kwsr-live-region";
    div.setAttribute("role", "status");
    div.setAttribute("aria-live", "polite");
    div.setAttribute("aria-atomic", "true");

    // Offscreen (NO opacity:0; algunos SR ignoran elementos totalmente invisibles)
    Object.assign(div.style, {
      position: "fixed",
      left: "-9999px",
      top: "0",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      clip: "rect(1px, 1px, 1px, 1px)",
      clipPath: "inset(50%)",
      whiteSpace: "nowrap"
    });

    document.documentElement.appendChild(div);
    S.liveRegion = div;
  }

  function writeLiveRegion(text) {
    ensureLiveRegion();
    try {
      // Forzar anuncio
      S.liveRegion.textContent = "";
      setTimeout(() => {
        if (!S.liveRegion) return;
        S.liveRegion.textContent = text;
      }, 10);
    } catch {}
  }

  function isTTSAvailable() {
    return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  }

  function cargarVozES() {
    try {
      if (!isTTSAvailable()) return;
      const voces = speechSynthesis.getVoices?.() || [];
      S.voiceES =
        voces.find(v => (v.lang || "").toLowerCase().startsWith("es-ar")) ||
        voces.find(v => (v.lang || "").toLowerCase().startsWith("es")) ||
        voces.find(v => (v.lang || "").toLowerCase().includes("es")) ||
        voces[0] ||
        null;

      // Algunos navegadores cargan voces async
      speechSynthesis.onvoiceschanged = () => {
        try {
          const v2 = speechSynthesis.getVoices?.() || [];
          S.voiceES =
            v2.find(v => (v.lang || "").toLowerCase().startsWith("es-ar")) ||
            v2.find(v => (v.lang || "").toLowerCase().startsWith("es")) ||
            v2.find(v => (v.lang || "").toLowerCase().includes("es")) ||
            v2[0] ||
            S.voiceES ||
            null;
        } catch {}
      };
    } catch {}
  }

  function hardResetTTS() {
    try {
      if (!isTTSAvailable()) return;
      speechSynthesis.cancel?.();
    } catch {}
  }

  function clearWatchdog() {
    try { if (watchdogTimer) clearTimeout(watchdogTimer); } catch {}
    watchdogTimer = null;
  }

  function markTTSBroken(reason) {
    lastTtsError = String(reason || "unknown");
    ttsBrokenUntil = Date.now() + 4000;
    S.ttsLastError = lastTtsError;
    S.ttsBrokenUntil = ttsBrokenUntil;

    KWSR.warn?.("TTS error", { msg: lastTtsError });

    // Fallback fuerte para que NO muera el flujo
    hardResetTTS();

    if (AUTO_SWITCH_TO_READER_ON_TTS_FAIL) {
      S.modoNarradorGlobal = "lector";
      try { KWSR.api?.storage?.local?.set?.({ modoNarrador: "lector" }); } catch {}
      try { KWSR.toast?.notify?.("⚠️ Falló la voz. Pasé a modo Lector automáticamente."); } catch {}
      try { KWSR.overlay?.updateOverlayStatus?.(); } catch {}
    }
  }

  function maybeUnstickTTS() {
    try {
      if (!isTTSAvailable()) return;

      const now = Date.now();
      const stuckTooLong = speechSynthesis.speaking && (now - lastSpeakAt > 5500);
      if (stuckTooLong) {
        KWSR.warn?.("TTS parecía colgado, cancel()");
        hardResetTTS();
        // lo tratamos como “fallo” para que el pipeline no se quede esperando
        markTTSBroken("stuck_speaking_timeout");
      }
    } catch {}
  }

  function shouldReadNow() {
    if (!S.extensionActiva) return false;
    if (!S.modoNarradorGlobal || S.modoNarradorGlobal === "off") return false;

    // Anti-freeze
    maybeUnstickTTS();

    // (El gating por video pausado lo maneja pipeline/track/visual.
    // Acá solo evitamos que el motor se muera.)
    return true;
  }

  function emitToOverlay(text) {
    try { KWSR.overlay?.updateOverlayText?.(text); } catch {}
  }

  function dedupe(raw) {
    const t = normalize(raw);
    if (!t) return "";

    const now = Date.now();
    const same = (t === S.lastEmitText);

    if (same && (now - (S.lastEmitAt || 0) < (CFG.burstMs || 300))) return "";
    if (same && (now - (S.lastEmitAt || 0) < (CFG.cooldownMs || 800))) return "";

    S.lastEmitText = t;
    S.lastEmitAt = now;
    return t;
  }

  function speakTTS(text) {
    if (!isTTSAvailable()) {
      markTTSBroken("speechSynthesis_not_available");
      return false;
    }

    const now = Date.now();
    if (now < ttsBrokenUntil) return false;

    // Cargar voz (best effort)
    cargarVozES();

    try {
      clearWatchdog();

      // Cancel antes de hablar para evitar cola infinita (Chrome)
      try { speechSynthesis.cancel?.(); } catch {}

      const u = new SpeechSynthesisUtterance(text);
      if (S.voiceES) u.voice = S.voiceES;
      u.lang = (S.voiceES?.lang) || "es-ES";
      u.rate = 1;
      u.pitch = 1;
      u.volume = 1;

      let finished = false;

      u.onstart = () => {
        lastSpeakAt = Date.now();
      };

      u.onend = () => {
        finished = true;
        clearWatchdog();
      };

      u.onerror = (ev) => {
        finished = true;
        clearWatchdog();
        const msg = String(ev?.error || ev?.message || "tts_error");
        markTTSBroken(msg);
      };

      // Watchdog: si Chrome no dispara end/error, lo reseteamos nosotros
      watchdogTimer = setTimeout(() => {
        if (finished) return;
        markTTSBroken("watchdog_no_end_no_error");
      }, Math.max(2500, (CFG.ttsWatchdogMs || 4500)));

      speechSynthesis.speak(u);
      lastSpeakAt = Date.now();
      return true;
    } catch (e) {
      markTTSBroken(String(e?.message || e));
      return false;
    }
  }

  function leerTextoAccesible(raw) {
    if (!shouldReadNow()) return;

    const text = dedupe(raw);
    if (!text) return;

    // Siempre reflejar en overlay
    emitToOverlay(text);

    // Lector: live region directo
    if (S.modoNarradorGlobal === "lector") {
      writeLiveRegion(text);
      return;
    }

    // Sintetizador: intentar TTS, si falla -> fallback a live region (sin depender de throw)
    const ok = speakTTS(text);
    if (!ok) {
      // No insistimos con TTS, pero nunca dejamos de leer
      writeLiveRegion(text);
    }
  }

  function detenerLectura() {
    try { clearWatchdog(); } catch {}
    try { hardResetTTS(); } catch {}
    try { if (S.liveRegion) S.liveRegion.textContent = ""; } catch {}
  }

  KWSR.voice = {
    cargarVozES,
    shouldReadNow,
    leerTextoAccesible,
    detenerLectura
  };
})();

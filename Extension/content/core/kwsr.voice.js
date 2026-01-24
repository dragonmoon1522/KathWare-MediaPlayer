// ====================================================
// KathWare SubtitleReader - kwsr.voice.js
// - Voice engine (TTS + "lector" via liveRegion)
// - FIX: manejo real de errores async (no throw en onerror)
// - Anti-freeze watchdog + fallback a live region
// - FIX (2026-01): Anti-eco + dedupe robusto (Netflix/Max repite 2-3 veces)
//   * fingerprint fuerte (trim/lower/whitespace/zero-width)
//   * ventana "echoMs" corta para duplicados inmediatos
//   * cooldown dinámico por longitud para re-render pesado
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
        markTTSBroken("stuck_speaking_timeout");
      }
    } catch {}
  }

  function shouldReadNow() {
    if (!S.extensionActiva) return false;
    if (!S.modoNarradorGlobal || S.modoNarradorGlobal === "off") return false;

    maybeUnstickTTS();
    return true;
  }

  function emitToOverlay(text) {
    try { KWSR.overlay?.updateOverlayText?.(text); } catch {}
  }

  // -------------------- Dedupe robusto (anti-eco) --------------------
  function fingerprint(text) {
    return normalize(text)
      .replace(/\u00A0/g, " ")                 // nbsp -> space
      .replace(/[\u200B-\u200D\uFEFF]/g, "")   // zero-width chars
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function dedupe(raw) {
    const clean = normalize(raw);
    if (!clean) return "";

    const key = fingerprint(clean);
    if (!key) return "";

    const now = Date.now();

    const dt = now - (S.lastEmitAt || 0);
    const sameKey = (key === (S.lastEmitKey || ""));

    // 1) Anti-eco inmediato (corta el “lo dijo 2 veces”)
    const echoMs = (CFG.echoMs ?? 320);
    if (sameKey && dt < echoMs) return "";

    // 2) Cooldown normal (anti re-render pesado)
    const base = (CFG.cooldownMs ?? 900);
    const extra = Math.min(1400, key.length * 18);
    const windowMs = base + extra;

    if (sameKey && dt < windowMs) return "";

    S.lastEmitKey = key;
    S.lastEmitAt = now;
    S.lastEmitText = clean;
    return clean;
  }

  function speakTTS(text) {
    if (!isTTSAvailable()) {
      markTTSBroken("speechSynthesis_not_available");
      return false;
    }

    const now = Date.now();
    if (now < ttsBrokenUntil) return false;

    cargarVozES();

    try {
      clearWatchdog();

      // Extra anti-eco TTS (por si algo se coló): si íbamos a decir lo mismo demasiado pegado, no cancelamos ni re-hablamos
      const tKey = fingerprint(text);
      if (tKey && (tKey === (S.lastSpokenKey || "")) && (now - (S.lastSpokenAt || 0) < (CFG.ttsEchoMs ?? 350))) {
        return true;
      }

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
        // Registramos “lo que se empezó a hablar” (no antes)
        S.lastSpokenKey = tKey || "";
        S.lastSpokenAt = Date.now();
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

    emitToOverlay(text);

    if (S.modoNarradorGlobal === "lector") {
      writeLiveRegion(text);
      return;
    }

    const ok = speakTTS(text);
    if (!ok) writeLiveRegion(text);
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

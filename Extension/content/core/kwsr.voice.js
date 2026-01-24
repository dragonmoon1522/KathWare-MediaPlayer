// ====================================================
// KathWare SubtitleReader - kwsr.voice.js
// - Voice engine (TTS + "lector" via liveRegion)
// - shouldReadNow(): gating + dedupe + anti-freeze
//
// FIX:
// - Si TTS falla -> NO se rompe el pipeline: fallback a "lector"
// - Anti-freeze: si speechSynthesis queda "speaking" colgado, lo resetea
// - Mejor logging del error real
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.voice) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;
  const { normalize } = KWSR.utils;

  let lastSpeakAt = 0;
  let ttsBrokenUntil = 0; // cooldown cuando TTS explota
  let lastTtsError = "";

  function ensureLiveRegion() {
    if (S.liveRegion) return;

    const div = document.createElement("div");
    div.id = "kwsr-live-region";
    div.setAttribute("role", "status");
    div.setAttribute("aria-live", "polite");
    div.setAttribute("aria-atomic", "true");

    // offscreen pero presente
    Object.assign(div.style, {
      position: "fixed",
      left: "-9999px",
      top: "0",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      opacity: "0"
    });

    document.documentElement.appendChild(div);
    S.liveRegion = div;
  }

  function writeLiveRegion(text) {
    ensureLiveRegion();
    try {
      // Truquito clásico: vaciar y volver a poner para forzar anuncio
      S.liveRegion.textContent = "";
      // microtask
      setTimeout(() => {
        if (!S.liveRegion) return;
        S.liveRegion.textContent = text;
      }, 0);
    } catch {}
  }

  function cargarVozES() {
    try {
      if (typeof speechSynthesis === "undefined") return;
      const voces = speechSynthesis.getVoices?.() || [];
      S.voiceES =
        voces.find(v => (v.lang || "").toLowerCase().startsWith("es")) ||
        voces.find(v => (v.lang || "").toLowerCase().includes("es")) ||
        voces[0] ||
        null;

      // Algunos navegadores cargan voces async
      speechSynthesis.onvoiceschanged = () => {
        try {
          const v2 = speechSynthesis.getVoices?.() || [];
          S.voiceES =
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
      if (typeof speechSynthesis === "undefined") return;
      speechSynthesis.cancel?.();
    } catch {}
  }

  function isTTSAvailable() {
    return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  }

  function maybeUnstickTTS() {
    // Si el motor queda colgado "speaking" pero no avanza, lo reseteamos.
    try {
      if (!isTTSAvailable()) return;

      const now = Date.now();
      const stuckTooLong = speechSynthesis.speaking && (now - lastSpeakAt > 5000);
      if (stuckTooLong) {
        KWSR.warn?.("TTS parecía colgado, cancel()");
        hardResetTTS();
      }
    } catch {}
  }

  function shouldReadNow() {
    if (!S.extensionActiva) return false;
    if (!S.modoNarradorGlobal || S.modoNarradorGlobal === "off") return false;

    // Anti-freeze
    maybeUnstickTTS();

    // Dedupe global (burst/cooldown)
    const now = Date.now();

    // Si estamos “en cooldown” por error de TTS, igual permitimos lectura (pero vía lector)
    return true;
  }

  function emitToOverlay(text) {
    try { KWSR.overlay?.updateOverlayText?.(text); } catch {}
  }

  function dedupe(text) {
    const t = normalize(text);
    if (!t) return "";

    const now = Date.now();
    const same = (t === S.lastEmitText);

    // burst: si llega el mismo texto en ráfaga, ignorar
    if (same && (now - (S.lastEmitAt || 0) < (CFG.burstMs || 300))) return "";

    // cooldown: si es el mismo texto repetido, ignorar un rato
    if (same && (now - (S.lastEmitAt || 0) < (CFG.cooldownMs || 800))) return "";

    S.lastEmitText = t;
    S.lastEmitAt = now;
    return t;
  }

  function speakTTS(text) {
    if (!isTTSAvailable()) throw new Error("speechSynthesis no disponible");

    // Si el motor está en mala racha, cortamos y tiramos fallback
    const now = Date.now();
    if (now < ttsBrokenUntil) throw new Error("TTS en cooldown por error previo");

    const u = new SpeechSynthesisUtterance(text);
    if (S.voiceES) u.voice = S.voiceES;
    u.lang = (S.voiceES?.lang) || "es-ES";
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;

    u.onstart = () => { lastSpeakAt = Date.now(); };
    u.onend = () => { /* ok */ };
    u.onerror = (ev) => {
      const msg = String(ev?.error || ev?.message || "unknown");
      lastTtsError = msg;
      throw new Error(msg);
    };

    // IMPORTANT: cancel antes de speak evita colas infinitas
    try { speechSynthesis.cancel?.(); } catch {}
    speechSynthesis.speak(u);

    lastSpeakAt = Date.now();
  }

  function leerTextoAccesible(raw) {
    if (!shouldReadNow()) return;

    const text = dedupe(raw);
    if (!text) return;

    // Siempre reflejar en overlay, aunque la voz falle
    emitToOverlay(text);

    // Si el modo es "lector", ni intentamos TTS
    if (S.modoNarradorGlobal === "lector") {
      writeLiveRegion(text);
      return;
    }

    // Si el modo es "sintetizador", intentamos TTS; si falla, fallback a lector
    try {
      speakTTS(text);
    } catch (e) {
      const msg = String(e?.message || e || "");
      KWSR.warn?.("TTS error", { msg, lastTtsError });

      // Marcamos TTS como roto por un ratito para no spamear errores
      ttsBrokenUntil = Date.now() + 4000;

      // Fallback automático: lector (live region)
      // (Mantiene el proyecto usable incluso si el TTS de Chrome se rompe en ese sitio)
      S.modoNarradorGlobal = "lector";
      try { KWSR.api?.storage?.local?.set?.({ modoNarrador: "lector" }); } catch {}

      writeLiveRegion(text);
      try { KWSR.toast?.notify?.("⚠️ Falló la voz. Pasé a modo Lector automáticamente."); } catch {}

      // Reset duro por las dudas
      hardResetTTS();
      try { KWSR.overlay?.updateOverlayStatus?.(); } catch {}
    }
  }

  function detenerLectura() {
    try {
      hardResetTTS();
    } catch {}
    try {
      if (S.liveRegion) S.liveRegion.textContent = "";
    } catch {}
  }

  KWSR.voice = {
    cargarVozES,
    shouldReadNow,
    leerTextoAccesible,
    detenerLectura
  };

})();

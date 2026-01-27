// ====================================================
// KathWare SubtitleReader - kwsr.voice.js
// ====================================================
//
// ¿Qué hace este módulo?
// - Es el “motor de salida” accesible:
//   1) Modo "lector": anuncia por un aria-live (live region).
//   2) Modo "sintetizador": usa speechSynthesis (TTS del navegador).
//   3) Modo "off": no lee.
//
// ¿Por qué existe?
// - Porque no todos los usuarios quieren TTS.
// - Porque algunos prefieren su lector de pantalla (NVDA/JAWS/TalkBack).
// - Porque speechSynthesis puede fallar o “colgarse” en ciertos sitios.
//
// Qué PROBLEMA grande resolvemos acá:
// - Repeticiones: aunque VISUAL/TRACK intenten dedupe, algunas plataformas
//   re-renderizan y/o disparan eventos duplicados. Acá hacemos el filtro final.
//
// Importante:
// - Este módulo NO busca subtítulos.
// - Este módulo NO hace observers.
// - Solo recibe texto “ya detectado” y decide si lo lee y cómo.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.voice) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;
  const { normalize } = KWSR.utils;

  // --- Estado interno del TTS ---
  let lastSpeakAt = 0;
  let ttsBrokenUntil = 0;
  let lastTtsError = "";
  let watchdogTimer = null;

  // Si querés que al fallar TTS cambie automáticamente a "lector":
  const AUTO_SWITCH_TO_READER_ON_TTS_FAIL = true;

  // ------------------------------------------------------------
  // Live Region (aria-live) para modo "lector"
  // ------------------------------------------------------------
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

  // pushToLiveRegion:
  // - Esta función la necesita también el toast (para feedback accesible).
  function pushToLiveRegion(text) {
    ensureLiveRegion();

    try {
      S.liveRegion.textContent = "";
      setTimeout(() => {
        if (!S.liveRegion) return;
        S.liveRegion.textContent = String(text ?? "");
      }, 10);
    } catch {}
  }

  // ------------------------------------------------------------
  // TTS del navegador (speechSynthesis)
  // ------------------------------------------------------------
  function isTTSAvailable() {
    return (
      typeof speechSynthesis !== "undefined" &&
      typeof SpeechSynthesisUtterance !== "undefined"
    );
  }

  // cargarVozES:
  // - Intentamos elegir una voz española si existe.
  // - Esto NO detecta idioma del lector de pantalla.
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

    hardResetTTS();

    if (AUTO_SWITCH_TO_READER_ON_TTS_FAIL) {
      S.modoNarradorGlobal = "lector";
      try { KWSR.api?.storage?.local?.set?.({ modoNarrador: "lector" }); } catch {}
      try { KWSR.toast?.notify?.("⚠️ Falló la voz. Pasé a modo Lector automáticamente."); } catch {}
      try { KWSR.overlay?.updateOverlayStatus?.(); } catch {}
    }
  }

  // Detecta si speechSynthesis quedó “colgado” hablando para siempre.
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

  // ------------------------------------------------------------
  // ¿Debemos leer ahora?
  // ------------------------------------------------------------
  function shouldReadNow() {
    if (!S.extensionActiva) return false;
    if (!S.modoNarradorGlobal || S.modoNarradorGlobal === "off") return false;

    // Ajuste defensivo: si tenemos video, no leer en pausa (evita “spam” en menús)
    try {
      const v = S.currentVideo;
      if (v && (v.paused || v.ended)) return false;
    } catch {}

    maybeUnstickTTS();
    return true;
  }

  function emitToOverlay(text) {
    try { KWSR.overlay?.updateOverlayText?.(text); } catch {}
  }

  // ------------------------------------------------------------
  // DEDUPE final (anti eco global)
  // ------------------------------------------------------------
  function fpStrict(text) {
    return normalize(text)
      .replace(/\u00A0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function fpLoose(text) {
    return normalize(text)
      .replace(/\u00A0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[\/|·•–—]+/g, " ")
      .replace(/[.,;:!?¡¿"“”'’()\[\]{}]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function dedupe(raw) {
    const clean = normalize(raw);
    if (!clean) return "";

    const strictKey = fpStrict(clean);
    const looseKey  = fpLoose(clean);
    if (!strictKey && !looseKey) return "";

    const now = Date.now();
    const dt  = now - (S.lastEmitAt || 0);

    const lastStrict = S.lastEmitStrictKey || "";
    const lastLoose  = S.lastEmitLooseKey  || "";

    // 1) Anti-eco inmediato (doble disparo típico)
    const echoMs = (CFG.echoMs ?? 380);

    if (
      dt < echoMs &&
      (
        strictKey === lastStrict ||
        looseKey === lastLoose ||
        (lastLoose && looseKey && (lastLoose.includes(looseKey) || looseKey.includes(lastLoose)))
      )
    ) {
      return "";
    }

    // 2) Cooldown normal (más largo si el texto es largo)
    const base = (CFG.cooldownMs ?? 650);
    const extra = Math.min(1100, strictKey.length * 12);
    const windowMs = base + extra;

    if (strictKey === lastStrict && dt < windowMs) return "";

    // Guardamos estado de dedupe global
    S.lastEmitStrictKey = strictKey;
    S.lastEmitLooseKey  = looseKey;
    S.lastEmitAt = now;
    S.lastEmitText = clean;

    return clean;
  }

  // ------------------------------------------------------------
  // speakTTS(text): intenta hablar con speechSynthesis
  // ------------------------------------------------------------
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

      // Anti-eco extra de TTS
      const tKey = fpStrict(text);
      if (
        tKey &&
        (tKey === (S.lastSpokenKey || "")) &&
        (now - (S.lastSpokenAt || 0) < (CFG.ttsEchoMs ?? 350))
      ) {
        return true;
      }

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

  // ------------------------------------------------------------
  // API pública: leerTextoAccesible(raw)
  // ------------------------------------------------------------
  function leerTextoAccesible(raw) {
    if (!shouldReadNow()) return;

    const text = dedupe(raw);
    if (!text) return;

    emitToOverlay(text);

    if (S.modoNarradorGlobal === "lector") {
      pushToLiveRegion(text);
      return;
    }

    const ok = speakTTS(text);
    if (!ok) pushToLiveRegion(text);
  }

  function detenerLectura() {
    try { clearWatchdog(); } catch {}
    try { hardResetTTS(); } catch {}
    try { if (S.liveRegion) S.liveRegion.textContent = ""; } catch {}

    // Ajuste defensivo: limpiar dedupe global al “stop”
    S.lastEmitAt = 0;
    S.lastEmitText = "";
    S.lastEmitStrictKey = "";
    S.lastEmitLooseKey = "";
    S.lastSpokenAt = 0;
    S.lastSpokenKey = "";
  }

  // Export del módulo
  KWSR.voice = {
    cargarVozES,
    shouldReadNow,
    leerTextoAccesible,
    detenerLectura,
    pushToLiveRegion
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - pushToLiveRegion() existe y es público (toast lo usa).
  - Dedupe final robusto (strict + loose + echo + cooldown adaptativo).
  - Watchdog anti-freeze: si TTS se cuelga, cancel() + fallback a lector (opcional).
  - Ajuste: si hay video en state, no leer en pausa/ended (anti-spam).
  - Ajuste: detenerLectura() limpia dedupe global para reinicios limpios.
  */
})();

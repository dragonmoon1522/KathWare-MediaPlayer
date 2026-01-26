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
/// - Repeticiones: aunque VISUAL/TRACK intenten dedupe, algunas plataformas
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
  // (esto evita que se “muera” la lectura si TTS se rompe)
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
  // - En tu versión anterior el toast la llamaba, pero no existía: bug.
  function pushToLiveRegion(text) {
    ensureLiveRegion();

    try {
      // Forzar anuncio: limpiamos y luego escribimos con un mini delay.
      // (Esto ayuda a que SR anuncie aunque el texto sea parecido.)
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
  // - Ojo: esto NO “detecta idioma del SR”. Solo selecciona una voz TTS.
  // - Si querés, más adelante podemos no forzar nada y dejar la default.
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

    // Guardamos info útil en state para debug/overlay si se quisiera
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

    maybeUnstickTTS();
    return true;
  }

  // Mandamos el texto al overlay (si existe) para que el usuario lo vea.
  function emitToOverlay(text) {
    try { KWSR.overlay?.updateOverlayText?.(text); } catch {}
  }

  // ------------------------------------------------------------
  // DEDUPE final (anti eco global)
  // ------------------------------------------------------------
  // fpStrict: comparación fuerte (para “lo mismo” con espacios raros)
  function fpStrict(text) {
    return normalize(text)
      .replace(/\u00A0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // fpLoose: ignora signos y separadores típicos (para re-renders con micro-cambios)
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

  // dedupe(raw):
  // - Devuelve "" si se considera duplicado.
  // - Devuelve texto limpio si hay que leerlo.
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

    // 1) Anti-eco inmediato (doble disparo típico: observer + poll, o re-render)
    // echoMs: ventana corta donde NO repetimos lo mismo.
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

    // 2) Cooldown normal: si es exactamente igual (strict) y todavía estamos
    // dentro de una ventana, no lo repetimos.
    const base = (CFG.cooldownMs ?? 650);
    const extra = Math.min(1100, strictKey.length * 12); // más largo => más cooldown
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

      // Anti-eco extra de TTS:
      // Si por alguna razón nos llega el mismo texto muy pegado, no re-disparamos.
      const tKey = fpStrict(text);
      if (
        tKey &&
        (tKey === (S.lastSpokenKey || "")) &&
        (now - (S.lastSpokenAt || 0) < (CFG.ttsEchoMs ?? 350))
      ) {
        return true;
      }

      // Cancel antes de hablar para evitar cola infinita (Chrome)
      try { speechSynthesis.cancel?.(); } catch {}

      const u = new SpeechSynthesisUtterance(text);

      // Si hay voz ES detectada, la usamos; si no, dejamos default.
      if (S.voiceES) u.voice = S.voiceES;

      // lang: si tenemos voz, usamos su lang; si no, es-ES genérico.
      u.lang = (S.voiceES?.lang) || "es-ES";

      // Defaults “seguros”
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

      // Watchdog: si no hay end/error, asumimos que se colgó.
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
  // - Aplica dedupe final
  // - Actualiza overlay
  // - Decide si usa live region o TTS
  // ------------------------------------------------------------
  function leerTextoAccesible(raw) {
    if (!shouldReadNow()) return;

    const text = dedupe(raw);
    if (!text) return;

    emitToOverlay(text);

    // Modo lector: solo aria-live
    if (S.modoNarradorGlobal === "lector") {
      pushToLiveRegion(text);
      return;
    }

    // Modo sintetizador: intentamos TTS; si falla, fallback a aria-live
    const ok = speakTTS(text);
    if (!ok) pushToLiveRegion(text);
  }

  function detenerLectura() {
    try { clearWatchdog(); } catch {}
    try { hardResetTTS(); } catch {}
    try { if (S.liveRegion) S.liveRegion.textContent = ""; } catch {}
  }

  // Export del módulo
  KWSR.voice = {
    cargarVozES,
    shouldReadNow,
    leerTextoAccesible,
    detenerLectura,
    pushToLiveRegion // ✅ usado por toast y por modo lector
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - FIX: Se agregó pushToLiveRegion() (toast lo necesitaba).
  - FIX: Se eliminó el llamado a fingerprint() inexistente: ahora usamos fpStrict().
  - FIX: Dedupe final más robusto (strict + loose + ventana echo + cooldown).
  - Watchdog anti-freeze: si TTS se cuelga, cancel() + fallback a lector (opcional).
  - Mantiene: live region offscreen + SpeechSynthesisUtterance con voz ES si existe.
  */
})();

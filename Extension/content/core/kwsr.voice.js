// ====================================================
// KathWare SubtitleReader - kwsr.voice.js
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

  const AUTO_SWITCH_TO_READER_ON_TTS_FAIL = true;

  // ------------------------------------------------------------
  // Helpers plataforma / videoTime
  // ------------------------------------------------------------
  function platform() {
    try { return KWSR.platforms?.getPlatform?.() || "generic"; } catch { return "generic"; }
  }

  function isRerenderPlatform() {
    const p = platform();
    return (p === "netflix" || p === "max");
  }

  function getVideoTimeSec() {
    try {
      const v = S.currentVideo || KWSR.video?.getMainVideo?.();
      if (!v) return null;
      const t = Number(v.currentTime || 0);
      return Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------
  // Live Region (aria-live)
  // ------------------------------------------------------------
  function ensureLiveRegion() {
    if (S.liveRegion) return;

    const div = document.createElement("div");
    div.id = "kwsr-live-region";
    div.setAttribute("role", "status");
    div.setAttribute("aria-live", "polite");
    div.setAttribute("aria-atomic", "true");

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
  // TTS
  // ------------------------------------------------------------
  function isTTSAvailable() {
    return (
      typeof speechSynthesis !== "undefined" &&
      typeof SpeechSynthesisUtterance !== "undefined"
    );
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
  // Should read
  // ------------------------------------------------------------
  function shouldReadNow() {
    if (!S.extensionActiva) return false;
    if (!S.modoNarradorGlobal || S.modoNarradorGlobal === "off") return false;

    try {
      const v = S.currentVideo;
      if (v && (v.paused || v.ended)) return false;
    } catch {}

    maybeUnstickTTS();
    return true;
  }

  // ------------------------------------------------------------
  // Fingerprints
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

  // ------------------------------------------------------------
  // Delta logic (para Max rolling captions)
  // ------------------------------------------------------------
  function computeDelta(prevClean, currClean) {
    const prev = normalize(prevClean);
    const curr = normalize(currClean);
    if (!prev || !curr) return "";

    // Normalizamos espacios para comparar “prefijos”
    const prevN = prev.replace(/\s+/g, " ").trim();
    const currN = curr.replace(/\s+/g, " ").trim();

    if (currN.length <= prevN.length) return "";

    // Caso ideal: curr empieza con prev
    if (currN.toLowerCase().startsWith(prevN.toLowerCase())) {
      let tail = currN.slice(prevN.length).trim();

      // Si quedó pegado por puntuación/guiones
      tail = tail.replace(/^[-–—:|•]+\s*/g, "").trim();

      return tail;
    }

    // Caso “casi”: loose de curr contiene loose de prev (pero quizá cambió algún signo)
    const prevL = fpLoose(prevN);
    const currL = fpLoose(currN);
    if (prevL && currL && currL.startsWith(prevL) && currN.length > prevN.length) {
      // Intento: buscar el prevN dentro de currN por coincidencia case-insensitive
      const idx = currN.toLowerCase().indexOf(prevN.toLowerCase());
      if (idx === 0) {
        let tail = currN.slice(prevN.length).trim();
        tail = tail.replace(/^[-–—:|•]+\s*/g, "").trim();
        return tail;
      }
    }

    return "";
  }

  // ------------------------------------------------------------
  // Dedupe final + delta
  // ------------------------------------------------------------
  function dedupeAndDelta(raw) {
    const clean = normalize(raw);
    if (!clean) return "";

    const strictKey = fpStrict(clean);
    const looseKey  = fpLoose(clean);
    if (!strictKey && !looseKey) return "";

    const now = Date.now();
    const dt  = now - (S.lastEmitAt || 0);

    const lastStrict = S.lastEmitStrictKey || "";
    const lastLoose  = S.lastEmitLooseKey  || "";

    const sameTextish =
      (strictKey && strictKey === lastStrict) ||
      (looseKey && looseKey === lastLoose) ||
      (lastLoose && looseKey && (lastLoose.includes(looseKey) || looseKey.includes(lastLoose)));

    // 0) Gate por videoTime (anti re-render)
    if (isRerenderPlatform() && sameTextish) {
      const tNow = getVideoTimeSec();
      const lastT = (typeof S.lastEmitVideoTimeSec === "number") ? S.lastEmitVideoTimeSec : null;

      if (tNow != null && lastT != null) {
        const dtVideo = Math.abs(tNow - lastT);
        const gate = (platform() === "max") ? 0.45 : 0.35;
        if (dtVideo < gate) {
          S.lastEmitVideoTimeSec = tNow;
          return "";
        }
      }
    }

    // 1) Anti-eco inmediato
    const baseEcho = (CFG.echoMs ?? 380);
    const echoMs = isRerenderPlatform() ? Math.max(baseEcho, 520) : baseEcho;

    if (dt < echoMs && sameTextish) {
      return "";
    }

    // 2) COOLDOWN normal
    const base = (CFG.cooldownMs ?? 650);
    const extra = Math.min(1100, strictKey.length * 12);
    const windowMs = base + extra;

    // 👇 Acá viene lo lindo: Max rolling captions
    // Si el texto nuevo contiene al anterior, hablamos SOLO el delta.
    // Esto evita exactamente tu patrón:
    // "Hola" -> "Hola + Está todo bien?" -> "Está todo bien? + Vine..."
    const p = platform();
    const canDelta = (p === "max" || p === "netflix"); // si querés solo max, dejá p==="max"
    if (canDelta && S.lastEmitText) {
      const tNow = getVideoTimeSec();
      const lastT = (typeof S.lastEmitVideoTimeSec === "number") ? S.lastEmitVideoTimeSec : null;

      // Solo intentamos delta si está dentro de una ventana “de la misma escena”
      const okWindow = (tNow != null && lastT != null) ? (Math.abs(tNow - lastT) < 1.25) : (dt < 1600);

      if (okWindow) {
        const delta = computeDelta(S.lastEmitText, clean);
        if (delta && delta.length >= 2) {
          // Guardamos igualmente el “texto completo actual” como base para el próximo delta
          S.lastEmitStrictKey = strictKey;
          S.lastEmitLooseKey  = looseKey;
          S.lastEmitAt = now;
          S.lastEmitText = clean;

          const vt = getVideoTimeSec();
          if (vt != null) S.lastEmitVideoTimeSec = vt;

          return delta; // ✅ habla solo lo nuevo
        }
      }
    }

    if (strictKey === lastStrict && dt < windowMs) return "";

    // Guardamos estado global
    S.lastEmitStrictKey = strictKey;
    S.lastEmitLooseKey  = looseKey;
    S.lastEmitAt = now;
    S.lastEmitText = clean;

    const vt = getVideoTimeSec();
    if (vt != null) S.lastEmitVideoTimeSec = vt;

    return clean;
  }

  // ------------------------------------------------------------
  // speakTTS
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
  // API pública
  // ------------------------------------------------------------
  function leerTextoAccesible(raw) {
    if (!shouldReadNow()) return;

    const text = dedupeAndDelta(raw);
    if (!text) return;

    // No re-imprimir subtítulos en pantalla (solo si se habilita explícitamente)
    if (CFG?.overlayShowText === true) {
      try { KWSR.overlay?.updateOverlayText?.(text); } catch {}
    }

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

    S.lastEmitAt = 0;
    S.lastEmitText = "";
    S.lastEmitStrictKey = "";
    S.lastEmitLooseKey = "";
    S.lastEmitVideoTimeSec = null;

    S.lastSpokenAt = 0;
    S.lastSpokenKey = "";
  }

  KWSR.voice = {
    cargarVozES,
    shouldReadNow,
    leerTextoAccesible,
    detenerLectura,
    pushToLiveRegion
  };
})();

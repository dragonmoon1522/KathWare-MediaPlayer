// -----------------------------------------------------------------------------
// KathWare SubtitleReader - kwsr.voice.js
// -----------------------------------------------------------------------------
//
// OBJETIVO
// --------
// Este módulo define la “salida” final del subtítulo.
// Es decir: cuando ya tenemos un texto (TRACK o VISUAL), acá decidimos:
//
// - ¿Se lee o no se lee ahora?
// - Si se lee: ¿por LECTOR (aria-live) o por TTS (speechSynthesis)?
// - ¿Cómo evitamos repetir lo mismo 2, 3, 5 veces? (dedupe global)
// - ¿Cómo manejamos “rolling captions” (Max/Netflix) leyendo solo lo nuevo? (delta)
//
// MODOS DE NARRADOR
// -----------------
// S.modoNarradorGlobal puede ser:
// - "lector"       -> usa aria-live (el lector de pantalla lo lee)
// - "sintetizador" -> usa speechSynthesis (voz del sistema)
// - "off"          -> no lee nada
//
// IMPORTANTE
// ----------
// Este módulo NO detecta subtítulos.
// Solo recibe texto y lo convierte en “salida accesible”.
//
// Notas MV3 / estabilidad
// -----------------------
// - speechSynthesis puede colgarse o fallar en algunos sitios/dispositivos.
// - Si falla, hacemos fallback a "lector" (opcional).
// - Hay watchdog anti-colgado para evitar que la cola de TTS quede pegada.
//
// -----------------------------------------------------------------------------


(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.voice) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;
  const normalize = KWSR.utils?.normalize || ((x) => String(x ?? "").trim());

  // Estado interno del módulo (no se guarda en storage)
  let lastSpeakAt = 0;
  let ttsBrokenUntil = 0;
  let lastTtsError = "";
  let watchdogTimer = null;

  // Esto controla el “auto fallback”:
  // si TTS falla, pasamos a "lector" para no dejar a la usuaria sin subtítulos.
  const AUTO_SWITCH_TO_READER_ON_TTS_FAIL = true;

  // Evitar re-enganchar onvoiceschanged muchas veces
  let voicesHooked = false;

  // ---------------------------------------------------------------------------
  // Helpers: plataforma / videoTime
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Live Region (aria-live)
  // ---------------------------------------------------------------------------
  //
  // ¿Qué es?
  // - Un div “invisible” que el lector de pantalla escucha.
  // - Al cambiar el texto, el lector lo anuncia.
  //
  // Por qué role="status" y aria-live="polite"
  // - status: anuncia cambios sin robar foco.
  // - polite: no interrumpe bruscamente lo que el usuario está escuchando.
  //
  function ensureLiveRegion() {
    if (S.liveRegion) return;

    const div = document.createElement("div");
    div.id = "kwsr-live-region";
    div.setAttribute("role", "status");
    div.setAttribute("aria-live", "polite");
    div.setAttribute("aria-atomic", "true");

    // Estilo “visualmente oculto” (clásico accesible)
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

  // pushToLiveRegion(text)
  // - Truco: limpiar primero y luego setear con timeout corto.
  // - Algunos lectores no “re-anuncian” si el texto se repite rápido.
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

  // ---------------------------------------------------------------------------
  // TTS (speechSynthesis)
  // ---------------------------------------------------------------------------
  function isTTSAvailable() {
    return (
      typeof speechSynthesis !== "undefined" &&
      typeof SpeechSynthesisUtterance !== "undefined"
    );
  }

  // cargarVozES()
  // - Selecciona una voz “es-AR” si existe.
  // - Si no existe, usa alguna “es-*”.
  // - Si nada, usa la primera disponible.
  //
  // Nota:
  // - En muchos navegadores, getVoices() devuelve vacío hasta que
  //   el sistema “carga” voces. Por eso usamos onvoiceschanged una vez.
  function cargarVozES() {
    try {
      if (!isTTSAvailable()) return;

      const pick = (voices) => {
        return (
          voices.find(v => (v.lang || "").toLowerCase().startsWith("es-ar")) ||
          voices.find(v => (v.lang || "").toLowerCase().startsWith("es")) ||
          voices.find(v => (v.lang || "").toLowerCase().includes("es")) ||
          voices[0] ||
          null
        );
      };

      const voces = speechSynthesis.getVoices?.() || [];
      if (voces.length) {
        S.voiceES = pick(voces);
      }

      if (!voicesHooked) {
        voicesHooked = true;

        speechSynthesis.onvoiceschanged = () => {
          try {
            const v2 = speechSynthesis.getVoices?.() || [];
            if (v2.length) S.voiceES = pick(v2) || S.voiceES || null;
          } catch {}
        };
      }
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

  // markTTSBroken(reason)
  // - Marca TTS como “en falla” por unos segundos.
  // - Limpia cola con cancel().
  // - Opcional: cambia a modo lector automáticamente.
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

  // maybeUnstickTTS()
  // - Si speechSynthesis queda “speaking” demasiado tiempo,
  //   lo consideramos colgado.
  function maybeUnstickTTS() {
    try {
      if (!isTTSAvailable()) return;

      const now = Date.now();
      const speaking = !!speechSynthesis.speaking;
      const stuckTooLong = speaking && (now - lastSpeakAt > 5500);

      if (stuckTooLong) {
        KWSR.warn?.("TTS parecía colgado, cancel()");
        hardResetTTS();
        markTTSBroken("stuck_speaking_timeout");
      }
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // shouldReadNow()
  // ---------------------------------------------------------------------------
  //
  // Decide si “se permite leer” en este instante.
  // Condiciones:
  // - extensión activa
  // - modo narrador != off
  // - video no pausado/terminado (evita loops al pausar)
  //
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

  // ---------------------------------------------------------------------------
  // Fingerprints (huellas) para comparación “como si fuera lo mismo”
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Delta logic (rolling captions)
  // ---------------------------------------------------------------------------
  //
  // Caso típico (rolling captions):
  // - antes:  "Hola"
  // - ahora:  "Hola ¿todo bien?"
  // Queremos hablar SOLO "¿todo bien?"
  //
  function computeDelta(prevClean, currClean) {
    const prev = normalize(prevClean);
    const curr = normalize(currClean);
    if (!prev || !curr) return "";

    const prevN = prev.replace(/\s+/g, " ").trim();
    const currN = curr.replace(/\s+/g, " ").trim();

    if (currN.length <= prevN.length) return "";

    // Caso ideal: curr empieza con prev
    if (currN.toLowerCase().startsWith(prevN.toLowerCase())) {
      let tail = currN.slice(prevN.length).trim();
      tail = tail.replace(/^[-–—:|•]+\s*/g, "").trim();
      return tail;
    }

    // Caso “casi”: compara loose
    const prevL = fpLoose(prevN);
    const currL = fpLoose(currN);

    if (prevL && currL && currL.startsWith(prevL) && currN.length > prevN.length) {
      const idx = currN.toLowerCase().indexOf(prevN.toLowerCase());
      if (idx === 0) {
        let tail = currN.slice(prevN.length).trim();
        tail = tail.replace(/^[-–—:|•]+\s*/g, "").trim();
        return tail;
      }
    }

    return "";
  }

  // ---------------------------------------------------------------------------
  // dedupeAndDelta(raw)
  // ---------------------------------------------------------------------------
  //
  // Recibe texto crudo (TRACK/VISUAL) y devuelve:
  // - "" (vacío) si NO hay que hablarlo
  // - texto final si SÍ hay que hablarlo
  //
  // Incluye:
  // - dedupe por huellas (strict/loose)
  // - gate por videoTime en plataformas que re-renderizan (Netflix/Max)
  // - delta para rolling captions (hablar solo lo nuevo)
  //
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

    // 1) Anti-eco inmediato (misma frase en milisegundos)
    const baseEcho = (CFG.echoMs ?? 380);
    const echoMs = isRerenderPlatform() ? Math.max(baseEcho, 520) : baseEcho;

    if (dt < echoMs && sameTextish) {
      return "";
    }

    // 2) Cooldown “normal” (ventana dinámica)
    const base = (CFG.cooldownMs ?? 650);
    const extra = Math.min(1100, strictKey.length * 12);
    const windowMs = base + extra;

    // 3) Delta (rolling captions)
    // Si el texto nuevo “contiene” al anterior, hablamos solo lo nuevo.
    const p = platform();
    const canDelta = (p === "max" || p === "netflix");

    if (canDelta && S.lastEmitText) {
      const tNow = getVideoTimeSec();
      const lastT = (typeof S.lastEmitVideoTimeSec === "number") ? S.lastEmitVideoTimeSec : null;

      // Ventana de “misma escena”
      const okWindow = (tNow != null && lastT != null)
        ? (Math.abs(tNow - lastT) < 1.25)
        : (dt < 1600);

      if (okWindow) {
        const delta = computeDelta(S.lastEmitText, clean);
        if (delta && delta.length >= 2) {
          // Guardamos el texto completo como base para el próximo delta
          S.lastEmitStrictKey = strictKey;
          S.lastEmitLooseKey  = looseKey;
          S.lastEmitAt = now;
          S.lastEmitText = clean;

          const vt = getVideoTimeSec();
          if (vt != null) S.lastEmitVideoTimeSec = vt;

          return delta;
        }
      }
    }

    // 4) Si es exactamente lo mismo dentro de la ventana, no repetir
    if (strictKey === lastStrict && dt < windowMs) return "";

    // Guardamos estado global de dedupe
    S.lastEmitStrictKey = strictKey;
    S.lastEmitLooseKey  = looseKey;
    S.lastEmitAt = now;
    S.lastEmitText = clean;

    const vt = getVideoTimeSec();
    if (vt != null) S.lastEmitVideoTimeSec = vt;

    return clean;
  }

  // ---------------------------------------------------------------------------
  // speakTTS(text)
  // ---------------------------------------------------------------------------
  //
  // Devuelve:
  // - true  si intentó hablar (o decidió que ya estaba hablado)
  // - false si no pudo (y conviene fallback a lector)
  //
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

      // Anti-eco TTS (por si el mismo texto llega dos veces muy pegado)
      const tKey = fpStrict(text);
      if (
        tKey &&
        (tKey === (S.lastSpokenKey || "")) &&
        (now - (S.lastSpokenAt || 0) < (CFG.ttsEchoMs ?? 350))
      ) {
        return true;
      }

      // Limpiamos cola para evitar “acumulación”
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

      // Watchdog: si no termina ni falla, lo damos por “colgado”
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

  // ---------------------------------------------------------------------------
  // API pública: leerTextoAccesible(raw)
  // ---------------------------------------------------------------------------
  //
  // Entrada principal desde TRACK/VISUAL.
  // - aplica dedupe global + delta
  // - decide lector vs sintetizador
  // - si falla TTS, fallback a lector
  //
  function leerTextoAccesible(raw) {
    if (!shouldReadNow()) return;

    const text = dedupeAndDelta(raw);
    if (!text) return;

    // Mostrar en overlay solo si se habilita explícitamente
    if (CFG?.overlayShowText === true) {
      try { KWSR.overlay?.updateOverlayText?.(text); } catch {}
    }

    // Modo lector: aria-live
    if (S.modoNarradorGlobal === "lector") {
      pushToLiveRegion(text);
      return;
    }

    // Modo sintetizador: speechSynthesis
    const ok = speakTTS(text);
    if (!ok) pushToLiveRegion(text);
  }

  // ---------------------------------------------------------------------------
  // API pública: detenerLectura()
  // ---------------------------------------------------------------------------
  //
  // Se usa cuando:
  // - se apaga la extensión
  // - el usuario pasa a modo "off"
  // - reinicio fuerte del pipeline
  //
  function detenerLectura() {
    try { clearWatchdog(); } catch {}
    try { hardResetTTS(); } catch {}
    try { if (S.liveRegion) S.liveRegion.textContent = ""; } catch {}

    // Reset dedupe global
    S.lastEmitAt = 0;
    S.lastEmitText = "";
    S.lastEmitStrictKey = "";
    S.lastEmitLooseKey = "";
    S.lastEmitVideoTimeSec = null;

    // Reset anti-eco TTS
    S.lastSpokenAt = 0;
    S.lastSpokenKey = "";
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  KWSR.voice = {
    cargarVozES,
    shouldReadNow,
    leerTextoAccesible,
    detenerLectura,
    pushToLiveRegion
  };

})();
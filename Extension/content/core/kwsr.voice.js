// ====================================================
// KathWare SubtitleReader - kwsr.voice.js
// - Live region + TTS + dedupe + leerTextoAccesible
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.voice) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;

  // normalize safe (por si utils carga después por error de orden)
  const normalize = (s) => {
    const fn = KWSR.utils?.normalize;
    if (typeof fn === "function") return fn(s);
    return String(s ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  const listVoicesDebug = () => {
    try {
      if (typeof speechSynthesis === "undefined") return { ok: false, reason: "speechSynthesis undefined" };
      const voces = speechSynthesis.getVoices() || [];
      return {
        ok: true,
        count: voces.length,
        langs: voces.slice(0, 15).map(v => v.lang).filter(Boolean)
      };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  };

  const cargarVozES = () => {
    try {
      if (typeof speechSynthesis === "undefined") return;

      const pick = () => {
        const voces = speechSynthesis.getVoices() || [];
        S.voiceES =
          voces.find(v => (v.lang || "").toLowerCase().startsWith("es-ar")) ||
          voces.find(v => (v.lang || "").toLowerCase().startsWith("es")) ||
          null;
      };

      pick();

      if (!S.voiceES) {
        speechSynthesis.onvoiceschanged = () => {
          try { pick(); } catch {}
        };
      }
    } catch (e) {
      KWSR.warn?.("cargarVozES error", e);
    }
  };

  const asegurarLiveRegion = () => {
    if (S.liveRegion) return S.liveRegion;

    const lr = document.createElement("div");
    lr.id = "kathware-live-region";
    lr.setAttribute("role", "status");
    lr.setAttribute("aria-live", "polite");
    lr.setAttribute("aria-atomic", "true");

    Object.assign(lr.style, {
      position: "fixed",
      left: "-9999px",
      top: "0",
      width: "1px",
      height: "1px",
      overflow: "hidden",
    });

    document.documentElement.appendChild(lr);
    S.liveRegion = lr;
    return lr;
  };

  const pushToLiveRegion = (texto) => {
    const t = normalize(texto);
    if (!t) return;

    const lr = asegurarLiveRegion();
    lr.textContent = "";
    setTimeout(() => { lr.textContent = t; }, 10);
  };

  const detenerLectura = () => {
    try { speechSynthesis?.cancel?.(); } catch {}
    if (S.liveRegion) {
      try { S.liveRegion.remove(); } catch {}
      S.liveRegion = null;
    }
    S.lastEmitText = "";
    S.lastEmitAt = 0;
  };

  const shouldEmit = (t) => {
    const now = Date.now();
    if (!t) return false;

    // Bloqueo anti-spam: misma frase muy seguida
    if (t === S.lastEmitText && (now - S.lastEmitAt) < CFG.burstMs) return false;
    if (t === S.lastEmitText && (now - S.lastEmitAt) < CFG.cooldownMs) return false;

    S.lastEmitText = t;
    S.lastEmitAt = now;
    return true;
  };

  const speakTTS = (texto) => {
    try {
      const t = normalize(texto);
      if (!t) return { ok: false, reason: "empty" };

      if (typeof speechSynthesis === "undefined") {
        return { ok: false, reason: "speechSynthesis undefined" };
      }

      cargarVozES();
      if (!S.voiceES) {
        return { ok: false, reason: "No encuentro voz ES (getVoices vacío o sin es-*)" };
      }

      speechSynthesis.cancel();

      const u = new SpeechSynthesisUtterance(t);
      u.voice = S.voiceES;
      u.lang = S.voiceES.lang || "es-AR";

      // Debug fino (sale a kathLogs)
      u.onend = () => KWSR.log?.("TTS end", { lang: u.lang });
      u.onerror = (ev) => KWSR.warn?.("TTS error", { err: ev?.error || ev, lang: u.lang });

      speechSynthesis.speak(u);

      return { ok: true, selectedLang: S.voiceES.lang };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  };

  const shouldReadNow = () => {
    if (!S.extensionActiva) return false;

    // Si no tenemos video, igual permitimos lectura (casos: captions/transcript fuera de <video>)
    if (!S.currentVideo) return true;

    try {
      if (S.currentVideo.paused || S.currentVideo.ended) return false;
    } catch {}

    return true;
  };

  const leerTextoAccesible = (texto) => {
    const t = normalize(texto);
    if (!t) return;
    if (!shouldEmit(t)) return;

    // overlay text (si existe)
    KWSR.overlay?.updateOverlayText?.(t);

    if (!S.extensionActiva) return;
    if (S.modoNarradorGlobal === "off") return;
    if (!shouldReadNow()) return;

    if (S.modoNarradorGlobal === "lector") {
      pushToLiveRegion(t);
      return;
    }

    if (S.modoNarradorGlobal === "sintetizador") {
      const res = speakTTS(t);
      if (!res.ok) {
        // ✅ queda en kathLogs (y puede ir al Issue)
        KWSR.warn?.("TTS FALLÓ", { res, voices: listVoicesDebug() });
      }
    }
  };

  KWSR.voice = {
    listVoicesDebug,
    cargarVozES,
    asegurarLiveRegion,
    pushToLiveRegion,
    detenerLectura,
    speakTTS,
    shouldReadNow,
    leerTextoAccesible
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Rebrand: KWMP -> KWSR.
  - Se mantiene el modelo “emisor → mensaje → receptor”:
      - Emisor: track/visual
      - Mensaje: texto normalizado
      - Receptor: live region (lector) o TTS (sintetizador)
  - Dedupe global:
      - burstMs + cooldownMs en CFG para evitar spam del mismo texto.
  - shouldReadNow():
      - Si no hay <video> principal, permite lectura igual (pensando a futuro en captions/transcripts tipo Teams).
      - Si hay video, no lee cuando está paused/ended.
  - Live region:
      - role=status + aria-live=polite + aria-atomic=true
      - push con “vaciar y setTimeout” para forzar anuncio.
  - TTS:
      - elige es-AR si existe; fallback es-*
      - loggea errores a kathLogs vía warn.
  */
})();

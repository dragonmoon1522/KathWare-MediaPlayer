(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.voice) return;

  const S = KWMP.state;
  const CFG = KWMP.CFG;
  const { normalize } = KWMP.utils;

  const listVoicesDebug = () => {
    try {
      if (typeof speechSynthesis === "undefined") return { ok: false, reason: "speechSynthesis undefined" };
      const voces = speechSynthesis.getVoices() || [];
      return { ok: true, count: voces.length, langs: voces.slice(0, 15).map(v => v.lang).filter(Boolean) };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  };

  const cargarVozES = () => {
    try {
      if (typeof speechSynthesis === "undefined") return;
      const voces = speechSynthesis.getVoices() || [];
      S.voiceES =
        voces.find(v => (v.lang || "").toLowerCase().startsWith("es-ar")) ||
        voces.find(v => (v.lang || "").toLowerCase().startsWith("es")) ||
        null;

      if (!S.voiceES) {
        speechSynthesis.onvoiceschanged = () => {
          const v2 = speechSynthesis.getVoices() || [];
          S.voiceES =
            v2.find(v => (v.lang || "").toLowerCase().startsWith("es-ar")) ||
            v2.find(v => (v.lang || "").toLowerCase().startsWith("es")) ||
            null;
        };
      }
    } catch {}
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
    const lr = asegurarLiveRegion();
    lr.textContent = "";
    setTimeout(() => { lr.textContent = texto; }, 10);
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
    if (t === S.lastEmitText && (now - S.lastEmitAt) < CFG.burstMs) return false;
    if (t === S.lastEmitText && (now - S.lastEmitAt) < CFG.cooldownMs) return false;
    S.lastEmitText = t;
    S.lastEmitAt = now;
    return true;
  };

  const speakTTS = (texto) => {
    try {
      if (typeof speechSynthesis === "undefined") return { ok: false, reason: "speechSynthesis undefined" };
      cargarVozES();
      if (!S.voiceES) return { ok: false, reason: "No encuentro voz ES" };

      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto);
      u.voice = S.voiceES;
      u.lang = S.voiceES.lang || "es-AR";
      speechSynthesis.speak(u);
      return { ok: true, selectedLang: S.voiceES.lang };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  };

  const shouldReadNow = () => {
    if (!S.extensionActiva) return false;
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
    KWMP.overlay?.updateOverlayText?.(t);

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
        console.warn("[KathWare] TTS FALLÓ:", res);
        console.warn("[KathWare] Voices debug:", listVoicesDebug());
      }
    }
  };

  KWMP.voice = {
    listVoicesDebug,
    cargarVozES,
    asegurarLiveRegion,
    pushToLiveRegion,
    detenerLectura,
    speakTTS,
    shouldReadNow,
    leerTextoAccesible
  };
})();

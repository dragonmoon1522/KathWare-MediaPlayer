// ====================================================
// KathWare Media Player - Content Script (MV3) - v2.0.0 (estable)
// - Overlay SOLO para Flow / reproductores no accesibles
// - TRACK: lee textTracks cuando existen
// - VISUAL: lee subtítulos desde DOM (selectores + auto-detección por comportamiento)
// - MAX: nodos re-render -> re-selección dinámica por tick (solo Max)
// - Disney/otros: target más estable (evita enganchar UI/aria-live random)
// - a11y: live region aria-live polite / role alert (modo lector)
// ====================================================

(() => {
  if (window.__KATHWARE_MEDIA_PLAYER__) return;
  window.__KATHWARE_MEDIA_PLAYER__ = { loadedAt: Date.now() };
  console.log("[KathWare] content.js cargado en", location.hostname);

  // -------------------- Core (voz + lectura) --------------------
  let voiceES = null;
  let liveRegion = null;
  let ultimoTexto = "";

  let modoNarradorGlobal = "sintetizador"; // "off" | "sintetizador" | "lector"
  let fuenteSubGlobal = "track";           // "track" | "visual"
  let trackIndexGlobal = 0;

  function cargarVozES() {
    try {
      if (typeof speechSynthesis === "undefined") return;
      const voces = speechSynthesis.getVoices();
      voiceES = (voces || []).find(v => v.lang && v.lang.startsWith("es")) || null;

      if (!voiceES && typeof speechSynthesis !== "undefined") {
        speechSynthesis.onvoiceschanged = () => {
          const voces2 = speechSynthesis.getVoices();
          voiceES = (voces2 || []).find(v => v.lang && v.lang.startsWith("es")) || null;
        };
      }
    } catch (_) {}
  }
  cargarVozES();

  function normalizarTexto(t) {
    return String(t || "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function asegurarLiveRegion() {
    if (liveRegion) return liveRegion;
    liveRegion = document.createElement("div");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("role", "alert");
    liveRegion.style.position = "absolute";
    liveRegion.style.left = "-9999px";
    document.body.appendChild(liveRegion);
    return liveRegion;
  }

  function leerTextoAccesible(texto, modo) {
    texto = normalizarTexto(texto);
    if (!texto || texto === ultimoTexto) return;
    ultimoTexto = texto;

    modo = modo || modoNarradorGlobal;
    if (modo === "off") return;

    if (modo === "lector") {
      asegurarLiveRegion().textContent = texto;
      return;
    }

    if (modo === "sintetizador" && voiceES && typeof speechSynthesis !== "undefined") {
      try {
        const utter = new SpeechSynthesisUtterance(texto);
        utter.voice = voiceES;
        utter.lang = voiceES.lang;
        speechSynthesis.cancel();
        speechSynthesis.speak(utter);
      } catch (_) {}
    }
  }

  function detenerLectura() {
    try {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    } catch (_) {}
    if (liveRegion) {
      liveRegion.remove();
      liveRegion = null;
    }
    ultimoTexto = "";
  }

  // -------------------- Estado --------------------
  let extensionActiva = false;

  // Overlay
  let overlayActivo = false;
  let overlayElement = null;

  // Track
  let trackLectura = null;

  // Visual
  let visualInterval = null;
  let visualObserver = null;
  let visualTarget = null;

  // -------------------- Storage --------------------
  function cargarConfigDesdeStorage(cb) {
    try {
      if (typeof chrome === "undefined" || !chrome?.storage?.local) {
        cb && cb();
        return;
      }

      chrome.storage.local.get(["modoNarrador", "fuenteSub", "trackIndex"], (data) => {
        if (data?.modoNarrador) modoNarradorGlobal = data.modoNarrador;
        if (data?.fuenteSub) fuenteSubGlobal = data.fuenteSub;

        if (typeof data?.trackIndex !== "undefined") {
          const n = Number(data.trackIndex);
          trackIndexGlobal = Number.isFinite(n) ? n : 0;
        }

        cb && cb();
      });
    } catch (_) {
      cb && cb();
    }
  }

  // -------------------- Video principal --------------------
  function getMainVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (!videos.length) return null;

    const conTracks = videos.find(v => v.textTracks && v.textTracks.length > 0);
    if (conTracks) return conTracks;

    const playing = videos.find(v => !v.paused && !v.ended);
    if (playing) return playing;

    return videos[0];
  }

  // -------------------- Detección de tipo --------------------
  function detectarTipoReproductor() {
    const v = getMainVideo();
    if (!v) return "ninguno";

    const dominio = location.hostname.toLowerCase();

    const dominiosAccesibles = [
      "netflix",
      "disneyplus",
      "disney",
      "primevideo",
      "amazon",
      "youtube",
      "paramountplus",
      "hbomax",
      "max.com",
      "starplus"
    ];

    if (dominiosAccesibles.some(d => dominio.includes(d))) {
      return fuenteSubGlobal === "visual" ? "visual" : "lector";
    }

    const esFlow =
      dominio.includes("flow.com.ar") ||
      (v.src && v.src.startsWith("blob:") && !v.hasAttribute("controls"));

    if (esFlow) return "flow";

    if (v.textTracks && v.textTracks.length > 0) return "lector";
    return "visual";
  }

  // -------------------- Overlay (solo Flow) --------------------
  function iniciarOverlay(video) {
    if (overlayActivo) return;
    overlayActivo = true;

    const cont = document.createElement("div");
    cont.id = "kathware-overlay";
    cont.setAttribute("role", "region");
    cont.setAttribute("aria-label", "Reproductor accesible de KathWare");

    Object.assign(cont.style, {
      position: "fixed",
      bottom: "1rem",
      left: "1rem",
      background: "#000",
      color: "#fff",
      padding: "1rem",
      zIndex: "999999",
      border: "2px solid #fff",
      fontSize: "1rem",
      maxWidth: "95%",
      borderRadius: "6px"
    });

    cont.innerHTML = `
      <div style="margin-bottom:0.5rem;"><strong>KathWare Media Player (Overlay)</strong></div>
      <button id="kw-play">Reproducir</button>
      <button id="kw-pause">Pausar</button>
      <button id="kw-back">-10s</button>
      <button id="kw-fwd">+10s</button>
      <button id="kw-volup">Vol +</button>
      <button id="kw-voldown">Vol -</button>
      <button id="kw-full">Pantalla completa</button>
      <select id="kw-modo" style="margin-left:0.5rem;">
        <option value="off">Desactivado</option>
        <option value="sintetizador">Voz</option>
        <option value="lector">Lector</option>
      </select>
      <button id="kw-close" style="margin-left:0.5rem;">Cerrar</button>
    `;

    document.body.appendChild(cont);
    overlayElement = cont;

    cont.querySelector("#kw-play").onclick = () => video.play();
    cont.querySelector("#kw-pause").onclick = () => video.pause();
    cont.querySelector("#kw-back").onclick = () => { video.currentTime -= 10; };
    cont.querySelector("#kw-fwd").onclick = () => { video.currentTime += 10; };
    cont.querySelector("#kw-volup").onclick = () => { video.volume = Math.min(video.volume + 0.1, 1); };
    cont.querySelector("#kw-voldown").onclick = () => { video.volume = Math.max(video.volume - 0.1, 0); };
    cont.querySelector("#kw-full").onclick = () => { if (video.requestFullscreen) video.requestFullscreen(); };
    cont.querySelector("#kw-close").onclick = () => cerrarOverlay();

    const sel = cont.querySelector("#kw-modo");
    sel.value = modoNarradorGlobal;
    sel.addEventListener("change", () => { modoNarradorGlobal = sel.value; });

    console.log("[KathWare] Overlay activado (Flow/no accesible).");
  }

  // -------------------- TRACK --------------------
  function iniciarLecturaSubtitulos(video) {
    if (!video?.textTracks || !video.textTracks.length) {
      console.warn("[KathWare] No hay textTracks disponibles.");
      return false;
    }

    cargarVozES();

    const idx = Math.max(0, Math.min(trackIndexGlobal, video.textTracks.length - 1));
    if (trackLectura) trackLectura.oncuechange = null;

    trackLectura = video.textTracks[idx];
    trackLectura.mode = "hidden";

    trackLectura.oncuechange = () => {
      if (fuenteSubGlobal !== "track") return;
      const cue = trackLectura.activeCues && trackLectura.activeCues[0];
      if (!cue) return;
      leerTextoAccesible(cue.text || "", modoNarradorGlobal);
    };

    console.log(`[KathWare] Lectura TRACK activa (pista ${idx}).`);
    return true;
  }

  // -------------------- Visual: filtros --------------------
  function looksLikeNoise(node, text) {
    const t = normalizarTexto(text);
    if (!t) return true;

    const tag = (node?.tagName || "").toUpperCase();
    if (["H1","H2","H3","H4","H5","H6","HEADER","NAV","MAIN","ARTICLE","ASIDE","FOOTER"].includes(tag)) return true;
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;

    if (t.length < 2 || t.length > 220) return true;

    try {
      const r = node.getBoundingClientRect?.();
      if (r) {
        if (r.height > window.innerHeight * 0.35) return true;
        if (r.width > window.innerWidth * 0.95 && r.height > 80) return true;
      }
    } catch {}

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;
    if (/me gusta|like|compart|share|guardad|saved|coment|comment|suscrib|subscribe/i.test(t)) return true;
    if (/^\d+([:.]\d+)*$/.test(t)) return true;

    return false;
  }

  function elegirTargetVisualRapido() {
    // Prioridad por plataformas (pero no dependemos de esto)
    let t =
      document.querySelector("[data-testid='cueBoxRowTextCue']") ||   // Max
      document.querySelector(".playkit-subtitles") ||                 // Playkit/Kaltura
      document.querySelector(
        ".plyr__caption, .flirc-caption, [class*='caption'], [class*='subtitle'], [class*='subtitles'], [class*='cc']," +
        " [class*='cue'], [class*='texttrack'], [class*='timed'], [class*='ttml']," +
        " [aria-label*='closed'], [aria-label*='caption'], [aria-label*='subt'], [aria-live='polite'], [aria-live='assertive'], [role='status']"
      );

    if (!t) return null;
    const txt = normalizarTexto(t.textContent);
    if (looksLikeNoise(t, txt)) return null;
    return t;
  }

  // Auto-detección por comportamiento (cuando no sabemos el selector)
  function detectarNodoSubtitulosAuto(video, opts = {}) {
    const cfg = { scanMs: opts.scanMs ?? 3500, maxNodes: opts.maxNodes ?? 450 };
    const now = () => performance.now();

    const videoRect = video?.getBoundingClientRect?.();
    const nodes = Array.from(document.querySelectorAll("div,span,p")).slice(0, cfg.maxNodes);
    const stats = new Map();
    let lastVideoTime = video?.currentTime ?? 0;

    function isVisible(n) {
      const r = n.getBoundingClientRect?.();
      if (!r || r.width <= 0 || r.height <= 0) return false;
      const st = getComputedStyle(n);
      if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
      return true;
    }

    function isNearVideoStrict(n) {
      if (!videoRect) return false;
      const r = n.getBoundingClientRect?.();
      if (!r) return false;

      const xInside =
        r.left < videoRect.right + 20 &&
        r.right > videoRect.left - 20;

      if (!xInside) return false;

      const withinVideo = r.top < videoRect.bottom && r.bottom > videoRect.top;
      const justBelow = r.top >= videoRect.bottom - 10 && r.top <= videoRect.bottom + 170;

      if (!(withinVideo || justBelow)) return false;

      const centerX = (r.left + r.right) / 2;
      const videoCenterX = (videoRect.left + videoRect.right) / 2;
      const centered = Math.abs(centerX - videoCenterX) <= (videoRect.width * 0.45);

      return centered;
    }

    const mo = new MutationObserver(() => {
      // solo queremos muestras cuando avanza el video
      const vt = video.currentTime ?? 0;
      const advancing = vt > lastVideoTime + 0.05;
      lastVideoTime = vt;
      if (!advancing) return;

      for (const n of nodes) {
        if (!isVisible(n)) continue;
        if (!isNearVideoStrict(n)) continue;

        const t = normalizarTexto(n.textContent);
        if (looksLikeNoise(n, t)) continue;

        const s = stats.get(n) || { last: "", changes: 0, lenSum: 0, lastChangeT: 0, dtSum: 0 };

        if (t && t !== s.last) {
          const tNow = now();
          if (s.lastChangeT) s.dtSum += (tNow - s.lastChangeT);
          s.lastChangeT = tNow;
          s.last = t;
          s.changes += 1;
          s.lenSum += t.length;
        }

        stats.set(n, s);
      }
    });

    mo.observe(document.body, { subtree: true, childList: true, characterData: true });

    return new Promise((resolve) => {
      setTimeout(() => {
        try { mo.disconnect(); } catch {}

        const ranked = [];
        for (const [n, s] of stats.entries()) {
          if (s.changes < 2) continue;
          const avgLen = s.lenSum / s.changes;
          const avgDt = s.changes > 1 ? (s.dtSum / (s.changes - 1)) : 999999;

          const dtOk = avgDt >= 250 && avgDt <= 8000;
          const lenOk = avgLen >= 5 && avgLen <= 120;
          if (!dtOk || !lenOk) continue;

          const score = Math.min(10, s.changes) * 10 + 60; // base alto porque ya pasó filtros estrictos
          ranked.push({ n, score });
        }

        ranked.sort((a, b) => b.score - a.score);
        resolve(ranked[0]?.n || null);
      }, cfg.scanMs);
    });
  }

  function limpiarVisual() {
    if (visualInterval) {
      clearInterval(visualInterval);
      visualInterval = null;
    }
    if (visualObserver) {
      try { visualObserver.disconnect(); } catch (_) {}
      visualObserver = null;
    }
    visualTarget = null;
  }

  // -------------------- VISUAL (estable) --------------------
  async function iniciarLecturaVisual(forzar = false) {
    cargarVozES();
    limpiarVisual();

    if (modoNarradorGlobal === "off") return;
    if (!forzar && fuenteSubGlobal !== "visual") return;

    const video = getMainVideo(); // ✅ FIX: siempre definido acá
    if (!video) {
      console.warn("[KathWare] Visual: no hay <video> para asociar.");
      return;
    }

    // 1) rápido
    visualTarget = elegirTargetVisualRapido();

    // 2) auto si no encontramos
    if (!visualTarget) {
      visualTarget = await detectarNodoSubtitulosAuto(video, { scanMs: 3500 });
    }

    if (!visualTarget) {
      console.warn("[KathWare] Visual: no pude detectar un nodo de subtítulos en este documento.");
      return;
    }

    const esMax = /play\.hbomax\.com|max\.com|hbomax/.test(location.hostname.toLowerCase());

    const leerTick = () => {
      if (modoNarradorGlobal === "off") return;

      let node = visualTarget;

      // ✅ SOLO Max: re-selección dinámica por tick
      if (esMax) {
        const all = document.querySelectorAll("[data-testid='cueBoxRowTextCue']");
        if (all && all.length) node = all[all.length - 1];
      } else {
        // ✅ Disney/otros: si el nodo murió, revalidar suave
        if (!node || !document.contains(node)) {
          node = elegirTargetVisualRapido() || node;
          visualTarget = node || visualTarget;
        }
      }

      if (!node) return;

      const texto = normalizarTexto(node.textContent);
      if (!looksLikeNoise(node, texto) && texto.length > 1) {
        leerTextoAccesible(texto, modoNarradorGlobal);
      }
    };

    // Observamos el body para reaccionar a re-renders (sin casarnos con un solo nodo)
    visualObserver = new MutationObserver(() => leerTick());
    visualObserver.observe(document.body, { subtree: true, childList: true, characterData: true });

    // Poll backup (Max más rápido)
    visualInterval = setInterval(leerTick, esMax ? 350 : 650);

    console.log("[KathWare] Lectura visual activa.", forzar ? "(fallback)" : "(config)", "modo:", esMax ? "MAX-dynamic" : "normal");
  }

  // -------------------- Limpieza general --------------------
  function cerrarOverlay() {
    overlayActivo = false;
    if (overlayElement) {
      overlayElement.remove();
      overlayElement = null;
    }
  }

  function limpiarTodo() {
    limpiarVisual();

    if (trackLectura) {
      trackLectura.oncuechange = null;
      trackLectura = null;
    }

    cerrarOverlay();
    detenerLectura();
  }

  // -------------------- Inicio / modos --------------------
  function iniciarModoDetectado() {
    const tipo = detectarTipoReproductor();
    const video = getMainVideo();

    console.log("[KathWare] Tipo detectado:", tipo);

    if (tipo === "flow") {
      if (video) iniciarOverlay(video);

      if (video?.textTracks && video.textTracks.length > 0) {
        iniciarLecturaSubtitulos(video);
      } else if (fuenteSubGlobal === "visual") {
        iniciarLecturaVisual(false);
      }
      return;
    }

    if (tipo === "lector") {
      const hayTracks = video?.textTracks && video.textTracks.length > 0;

      if (hayTracks) {
        iniciarLecturaSubtitulos(video);
        if (fuenteSubGlobal === "visual") iniciarLecturaVisual(false);
      } else {
        console.warn("[KathWare] No hay textTracks; usando fallback visual.");
        iniciarLecturaVisual(true);
      }
      return;
    }

    if (tipo === "visual") {
      iniciarLecturaVisual(false);
      if (video?.textTracks && video.textTracks.length > 0) iniciarLecturaSubtitulos(video);
      return;
    }
  }

  function toggleExtension() {
    extensionActiva = !extensionActiva;
    console.log(`[KathWare] ${extensionActiva ? "Activado" : "Desactivado"}`);

    if (extensionActiva) {
      cargarConfigDesdeStorage(() => iniciarModoDetectado());
    } else {
      limpiarTodo();
    }
  }

  // -------------------- Atajo local --------------------
  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      toggleExtension();
    }
  });

  // -------------------- Mensajes (popup/background) --------------------
  if (typeof chrome !== "undefined" && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.action === "toggleNarrator") {
        toggleExtension();
        sendResponse && sendResponse({ status: "ok" });
        return false;
      }

      if (message?.action === "setTrack") {
        const video = getMainVideo();
        const idx = Number(message.index);

        if (video?.textTracks && Number.isFinite(idx) && idx >= 0 && idx < video.textTracks.length) {
          trackIndexGlobal = idx;
          if (extensionActiva) iniciarLecturaSubtitulos(video);
          sendResponse && sendResponse({ status: "ok" });
          return false;
        }

        sendResponse && sendResponse({ status: "ignored" });
        return false;
      }

      if (message?.action === "updateSettings") {
        cargarConfigDesdeStorage(() => {
          console.log("[KathWare] Settings actualizados:", {
            modoNarradorGlobal,
            fuenteSubGlobal,
            trackIndexGlobal
          });

          if (extensionActiva) {
            limpiarTodo();
            iniciarModoDetectado();
          }
        });

        sendResponse && sendResponse({ status: "ok" });
        return false;
      }

      if (message?.type === "getTracks") {
        const video = getMainVideo();
        const tracks = video?.textTracks
          ? Array.from(video.textTracks).map(t => ({
              label: t.label || t.language || "Pista",
              language: t.language || ""
            }))
          : [];
        sendResponse && sendResponse({ tracks });
        return false;
      }

      return false;
    });
  }
})();

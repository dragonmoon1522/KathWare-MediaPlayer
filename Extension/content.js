// ====================================================
// KathWare Media Player - Content Script (MV3) - v2.0.0 (plataformas)
// - Overlay SOLO para Flow / reproductores no accesibles
// - TRACK: lee textTracks cuando existen
// - VISUAL: lee subtítulos por selectores POR PLATAFORMA
// - Notificación ON/OFF por Ctrl+Shift+K (toast + aria-live)
// ====================================================

(() => {
  if (window.__KATHWARE_MEDIA_PLAYER__) return;
  window.__KATHWARE_MEDIA_PLAYER__ = { loadedAt: Date.now() };
  console.log("[KathWare] content.js cargado en", location.hostname);

  // -------------------- Core voz + lectura --------------------
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

      if (!voiceES) {
        speechSynthesis.onvoiceschanged = () => {
          const voces2 = speechSynthesis.getVoices();
          voiceES = (voces2 || []).find(v => v.lang && v.lang.startsWith("es")) || null;
        };
      }
    } catch (_) {}
  }
  cargarVozES();

  function normalizarTexto(t) {
    return String(t || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
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
    } else if (modo === "sintetizador" && voiceES && typeof speechSynthesis !== "undefined") {
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
    try { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); } catch (_) {}
    if (liveRegion) { liveRegion.remove(); liveRegion = null; }
    ultimoTexto = "";
  }

  // -------------------- Notificaciones (toast + a11y) --------------------
  let toastEl = null;
  let toastTimer = null;

  function notify(msg) {
    // a11y
    asegurarLiveRegion().textContent = msg;

    // visual toast
    try {
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.id = "kw-toast";
        toastEl.setAttribute("role", "status");
        toastEl.setAttribute("aria-live", "polite");
        Object.assign(toastEl.style, {
          position: "fixed",
          top: "1rem",
          right: "1rem",
          background: "rgba(0,0,0,0.85)",
          color: "#fff",
          padding: "0.75rem 1rem",
          borderRadius: "10px",
          zIndex: "999999",
          fontSize: "14px",
          maxWidth: "70vw",
          boxShadow: "0 8px 30px rgba(0,0,0,0.35)"
        });
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;

      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        if (toastEl) toastEl.textContent = "";
      }, 2000);
    } catch (_) {}
  }

  // -------------------- Estado extensión --------------------
  let extensionActiva = false;

  // Overlay (Flow)
  let overlayActivo = false;
  let overlayElement = null;

  // Track
  let trackLectura = null;

  // Visual
  let visualInterval = null;
  let visualTarget = null;

  // -------------------- Storage (settings) --------------------
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

  // -------------------- Plataforma --------------------
  function getPlatform() {
    const h = location.hostname.toLowerCase();
    if (h.includes("netflix")) return "netflix";
    if (h.includes("disneyplus") || h.includes("disney")) return "disney";
    if (h.includes("hbomax") || h.includes("max.com") || h.includes("play.hbomax.com")) return "max";
    if (h.includes("youtube")) return "youtube";
    if (h.includes("primevideo") || h.includes("amazon")) return "prime";
    if (h.includes("paramountplus")) return "paramount";
    if (h.includes("flow.com.ar")) return "flow";
    return "generic";
  }

  function platformLabel(p) {
    return ({
      netflix: "Netflix",
      disney: "Disney+",
      max: "Max",
      youtube: "YouTube",
      prime: "Prime Video",
      paramount: "Paramount+",
      flow: "Flow",
      generic: "Sitio"
    })[p] || "Sitio";
  }

  // -------------------- Detección de modo --------------------
  function detectarTipoReproductor() {
    const v = getMainVideo();
    if (!v) return "ninguno";

    const p = getPlatform();

    // Flow: overlay
    if (p === "flow") return "flow";

    // Preferencia del usuario
    if (fuenteSubGlobal === "visual") return "visual";

    // TRACK si hay
    if (v.textTracks && v.textTracks.length > 0) return "lector";

    // Sino visual
    return "visual";
  }

  // -------------------- Overlay SOLO Flow --------------------
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
  function iniciarLecturaTrack(video) {
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

  // -------------------- Visual por plataforma --------------------
  function looksLikeNoise(node, text) {
    const t = normalizarTexto(text);
    if (!t) return true;

    const tag = (node?.tagName || "").toUpperCase();
    if (["H1","H2","H3","H4","H5","H6","HEADER","NAV","MAIN","ARTICLE","ASIDE","FOOTER"].includes(tag)) return true;
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;

    if (t.length < 2 || t.length > 220) return true;

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;
    if (/me gusta|like|compart|share|guardad|saved|coment|comment|suscrib|subscribe/i.test(t)) return true;

    return false;
  }

  function platformSelectors(p) {
    // 👇 Acá está la “verdad” por plataforma (podés ir ampliándola)
    if (p === "max") {
      return [
        "[data-testid='cueBoxRowTextCue']",
        "[data-testid*='cueBoxRowTextCue']",
        "[class*='TextCue']"
      ];
    }
    if (p === "netflix") {
      return [
        ".player-timedtext-text-container",
        ".player-timedtext",
        "span.player-timedtext-text",
        "div[data-uia*='subtitle']",
        "div[data-uia*='captions']"
      ];
    }
    if (p === "disney") {
      // Disney es cambiante: ponemos varios “probables”
      return [
        "[class*='subtitle']",
        "[class*='subtitles']",
        "[class*='caption']",
        "[class*='captions']",
        "[class*='timedText']",
        "[class*='timed-text']",
        "[data-testid*='subtitle']",
        "[data-testid*='caption']",
        "[aria-label*='Subt']",
        // último recurso: aria-live pero filtrado por texto
        "[aria-live='polite']",
        "[role='status']"
      ];
    }
    if (p === "youtube") {
      return [
        ".ytp-caption-segment",
        ".captions-text .caption-visual-line",
        ".ytp-caption-window-container"
      ];
    }
    // genérico
    return [
      ".plyr__caption",
      ".flirc-caption",
      "[class*='subtitle']",
      "[class*='caption']",
      "[class*='cc']",
      "[aria-live='polite']",
      "[role='status']"
    ];
  }

  function pickBestNodeFromSelectors(selectors) {
    const nodes = [];
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(n => nodes.push(n));
      } catch (_) {}
    }
    if (!nodes.length) return null;

    // Preferir el último “cue-like” (muchos players apilan/recrean nodos)
    // pero filtrando ruido.
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const t = normalizarTexto(n?.textContent);
      if (!looksLikeNoise(n, t)) return n;
    }
    return null;
  }

  function limpiarVisual() {
    if (visualInterval) {
      clearInterval(visualInterval);
      visualInterval = null;
    }
    visualTarget = null;
  }

  function iniciarLecturaVisualPorPlataforma() {
    cargarVozES();
    limpiarVisual();

    const p = getPlatform();
    const sels = platformSelectors(p);

    const tick = () => {
      if (modoNarradorGlobal === "off") return;

      // re-selección controlada (solo selectores de la plataforma)
      visualTarget = pickBestNodeFromSelectors(sels) || visualTarget;
      if (!visualTarget) return;

      const texto = normalizarTexto(visualTarget.textContent);
      if (!looksLikeNoise(visualTarget, texto) && texto.length > 1) {
        leerTextoAccesible(texto, modoNarradorGlobal);
      }
    };

    // Poll. Disney a veces necesita más frecuencia porque re-renderiza fuerte.
    const pMs = (p === "disney" || p === "max" || p === "netflix") ? 350 : 650;
    visualInterval = setInterval(tick, pMs);

    console.log("[KathWare] Lectura visual activa (plataforma:", p, "ms:", pMs, ")");
  }

  // -------------------- Limpieza --------------------
  function cerrarOverlay() {
    overlayActivo = false;
    if (overlayElement) {
      overlayElement.remove();
      overlayElement = null;
    }
  }

  function limpiarTodo() {
    limpiarVisual();
    if (trackLectura) { trackLectura.oncuechange = null; trackLectura = null; }
    cerrarOverlay();
    detenerLectura();
  }

  // -------------------- Start --------------------
  function iniciarModoDetectado() {
    const tipo = detectarTipoReproductor();
    const video = getMainVideo();
    const p = getPlatform();

    console.log("[KathWare] Tipo detectado:", tipo);

    if (tipo === "flow") {
      if (video) iniciarOverlay(video);

      // Flow: si hay tracks, TRACK. Si no, visual por plataforma (Flow suele no tener)
      if (video?.textTracks && video.textTracks.length > 0) {
        iniciarLecturaTrack(video);
      } else {
        iniciarLecturaVisualPorPlataforma();
      }
      return;
    }

    if (tipo === "lector") {
      const ok = iniciarLecturaTrack(video);
      if (!ok) {
        console.warn("[KathWare] No hay textTracks; usando visual por plataforma.");
        iniciarLecturaVisualPorPlataforma();
      }
      return;
    }

    if (tipo === "visual") {
      iniciarLecturaVisualPorPlataforma();
      return;
    }
  }

  function toggleExtension() {
    extensionActiva = !extensionActiva;

    const p = getPlatform();
    const label = platformLabel(p);

    if (extensionActiva) {
      console.log("[KathWare] Activado");
      notify(`🟢 KathWare ON — ${label}`);
      cargarConfigDesdeStorage(() => iniciarModoDetectado());
    } else {
      console.log("[KathWare] Desactivado");
      notify(`🔴 KathWare OFF — ${label}`);
      limpiarTodo();
    }
  }

  // -------------------- Hotkey --------------------
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
          if (extensionActiva) iniciarLecturaTrack(video);
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

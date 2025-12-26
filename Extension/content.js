// ====================================================
// KathWare Media Player - Content Script (MV3)
// - Overlay SOLO para Flow / reproductores no accesibles
// - Lectura TRACK cuando existan textTracks
// - Fallback visual si el usuario elige "visual"
// - Selector de pista desde popup (trackIndex) + setTrack
// - En Flow/no accesibles: SI hay subtítulos detectables, también los lee
// ====================================================

// -------------------- Core (voz + lectura) --------------------
let voiceES = null;
let liveRegion = null;
let ultimoTexto = "";

let modoNarradorGlobal = "sintetizador"; // "off" | "sintetizador" | "lector"
let fuenteSubGlobal = "track";           // "track" | "visual"
let trackIndexGlobal = 0;                // índice elegido desde popup

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

function leerTextoAccesible(texto, modo) {
  if (!texto) return;
  texto = String(texto).trim();
  if (!texto || texto === ultimoTexto) return;
  ultimoTexto = texto;

  modo = modo || modoNarradorGlobal;
  if (modo === "off") return;

  // Limpio tags por si el cue trae markup
  texto = texto.replace(/<[^>]+>/g, "");

  if (modo === "lector") {
    if (!liveRegion) {
      liveRegion = document.createElement("div");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.setAttribute("role", "alert");
      liveRegion.style.position = "absolute";
      liveRegion.style.left = "-9999px";
      document.body.appendChild(liveRegion);
    }
    liveRegion.textContent = texto;
  } else if (modo === "sintetizador" && voiceES && typeof speechSynthesis !== "undefined") {
    const utter = new SpeechSynthesisUtterance(texto);
    utter.voice = voiceES;
    utter.lang = voiceES.lang;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
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

// -------------------- Extensión (estado) --------------------
let extensionActiva = false;
let overlayActivo = false;
let overlayElement = null;
let trackLectura = null;
let visualInterval = null;

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

// -------------------- Utilidad: obtener video "mejor candidato" --------------------
function getMainVideo() {
  const videos = Array.from(document.querySelectorAll("video"));
  if (!videos.length) return null;

  // Preferimos el que tenga textTracks o el que esté reproduciendo
  const conTracks = videos.find(v => v.textTracks && v.textTracks.length > 0);
  if (conTracks) return conTracks;

  const playing = videos.find(v => !v.paused && !v.ended);
  if (playing) return playing;

  // Fallback: el primero
  return videos[0];
}

// -------------------- Detección de reproductor --------------------
function detectarTipoReproductor() {
  const video = getMainVideo();
  if (!video) return "ninguno";

  const dominio = location.hostname.toLowerCase();

  const dominiosAccesibles = [
    "netflix",
    "disney",
    "primevideo",
    "amazon",
    "youtube",
    "paramountplus",
    "hbomax",
    "max.com",
    "starplus"
  ];

  // 1) Plataformas conocidas accesibles: NO clasificar como flow aunque sea blob y sin controls
  if (dominiosAccesibles.some(d => dominio.includes(d))) {
    return fuenteSubGlobal === "visual" ? "visual" : "lector";
  }

  // 2) Flow u otros DRM sin controles accesibles (heurística)
  const esFlow =
    dominio.includes("flow.com.ar") ||
    (video.src && video.src.startsWith("blob:") && !video.hasAttribute("controls"));

  if (esFlow) return "flow";

  // 3) Si hay textTracks, TRACK
  if (video.textTracks && video.textTracks.length > 0) return "lector";

  // 4) Fallback visual
  return "visual";
}

// -------------------- Toggle / inicio --------------------
function toggleExtension() {
  extensionActiva = !extensionActiva;
  console.log(`[KathWare] ${extensionActiva ? "Activado" : "Desactivado"}`);

  if (extensionActiva) {
    cargarConfigDesdeStorage(() => iniciarModoDetectado());
  } else {
    limpiarTodo();
  }
}

function iniciarModoDetectado() {
  const tipo = detectarTipoReproductor();
  const video = getMainVideo();

  if (!video) {
    console.warn("[KathWare] No se encontró ningún <video> en la página.");
    return;
  }

  console.log("[KathWare] Tipo detectado:", tipo);

  // Regla: overlay SOLO si es flow/no accesible
  if (tipo === "flow") {
    iniciarOverlay(video); // overlay controles
    // pero igual intentamos lectura, por si hay tracks o captions detectables
    if (video.textTracks && video.textTracks.length > 0) {
      iniciarLecturaSubtitulos(video);
    } else if (fuenteSubGlobal === "visual") {
      iniciarLecturaVisual();
    }
    return;
  }

  // Plataformas accesibles / normales:
  if (tipo === "lector") {
    iniciarLecturaSubtitulos(video);
    // si el user elige visual, igual activamos visual
    if (fuenteSubGlobal === "visual") iniciarLecturaVisual();
    return;
  }

  // visual
  if (tipo === "visual") {
    iniciarLecturaVisual();
    // y si existieran tracks, también
    if (video.textTracks && video.textTracks.length > 0) iniciarLecturaSubtitulos(video);
    return;
  }
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
  sel.addEventListener("change", () => {
    modoNarradorGlobal = sel.value;
  });

  console.log("[KathWare] Overlay activado (Flow/no accesible).");
}

// -------------------- TRACK --------------------
function iniciarLecturaSubtitulos(video) {
  if (!video?.textTracks || !video.textTracks.length) {
    console.warn("[KathWare] No hay textTracks disponibles.");
    return;
  }

  cargarVozES();

  // elegimos el índice guardado (clamp)
  const idx = Math.max(0, Math.min(trackIndexGlobal, video.textTracks.length - 1));

  // apagar track anterior
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
}

// -------------------- Visual fallback --------------------
function iniciarLecturaVisual() {
  cargarVozES();
  if (visualInterval) clearInterval(visualInterval);

  visualInterval = setInterval(() => {
    if (modoNarradorGlobal === "off") return;
    if (fuenteSubGlobal !== "visual") return;

    // candidatos comunes (genéricos)
    const visual = document.querySelector(
      ".plyr__caption, .flirc-caption, [class*='caption'], [class*='cc'], [class*='subtitle'], [aria-label*='closed'], [aria-label*='caption']"
    );

    const texto = visual?.textContent?.trim();
    if (texto) leerTextoAccesible(texto, modoNarradorGlobal);
  }, 800);

  console.log("[KathWare] Lectura visual activa.");
}

// -------------------- Limpieza --------------------
function cerrarOverlay() {
  overlayActivo = false;
  if (overlayElement) {
    overlayElement.remove();
    overlayElement = null;
  }
  // Ojo: NO llamamos detenerLectura acá si querés seguir leyendo subtítulos sin overlay.
  // Pero en esta extensión, cerrar overlay suele implicar "apagado" del overlay, no del narrador.
}

function limpiarTodo() {
  if (visualInterval) {
    clearInterval(visualInterval);
    visualInterval = null;
  }
  if (trackLectura) {
    trackLectura.oncuechange = null;
    trackLectura = null;
  }
  cerrarOverlay();
  detenerLectura();
}

// -------------------- Atajo local --------------------
document.addEventListener("keydown", e => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    toggleExtension();
  }
});

// -------------------- Mensajes (background/popup) --------------------
if (typeof chrome !== "undefined" && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Toggle
    if (message?.action === "toggleNarrator") {
      toggleExtension();
      sendResponse && sendResponse({ status: "ok" });
      return true;
    }

    // Cambio de pista directo desde popup
    if (message?.action === "setTrack") {
      const video = getMainVideo();
      const idx = Number(message.index);

      if (video?.textTracks && Number.isFinite(idx) && idx >= 0 && idx < video.textTracks.length) {
        trackIndexGlobal = idx;

        // si está activa, aplicamos inmediato
        if (extensionActiva) {
          iniciarLecturaSubtitulos(video);
        }

        sendResponse && sendResponse({ status: "ok" });
        return true;
      }

      sendResponse && sendResponse({ status: "ignored" });
      return true;
    }

    // Settings actualizados (modo narrador, fuente, trackIndex)
    if (message?.action === "updateSettings") {
      cargarConfigDesdeStorage(() => {
        console.log("[KathWare] Settings actualizados:", {
          modoNarradorGlobal,
          fuenteSubGlobal,
          trackIndexGlobal
        });

        // Si está activa, re-inicia el modo para aplicar cambios
        if (extensionActiva) {
          limpiarTodo();
          iniciarModoDetectado();
        }
      });

      sendResponse && sendResponse({ status: "ok" });
      return true;
    }

    // Lista de pistas para el popup
    if (message?.type === "getTracks") {
      const video = getMainVideo();
      const tracks = video?.textTracks
        ? Array.from(video.textTracks).map(t => ({
            label: t.label || t.language || "Pista",
            language: t.language || ""
          }))
        : [];
      sendResponse && sendResponse({ tracks });
      return true;
    }

    return false;
  });
}

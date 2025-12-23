// ====================================================
// KathWare Media Player - Content Script (MV3)
// - Overlay SOLO para Flow / reproductores no accesibles
// - Lectura TRACK para plataformas HTML5 accesibles
// - Fallback visual si el usuario elige "visual"
// ====================================================

// -------------------- Core (voz + lectura) --------------------
let trackIndexGlobal = 0; // índice elegido desde el popup
let voiceES = null;
let liveRegion = null;
let ultimoTexto = "";

let modoNarradorGlobal = "sintetizador"; // "off" | "sintetizador" | "lector"
let fuenteSubGlobal = "track";           // "track" | "visual"

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
      if (typeof data?.trackIndex !== "undefined") trackIndexGlobal = Number(data.trackIndex) || 0;
      if (data?.fuenteSub) fuenteSubGlobal = data.fuenteSub;
      cb && cb();
    });
  } catch (_) {
    cb && cb();
  }
}

// -------------------- Detección de reproductor --------------------
function detectarTipoReproductor() {
  const video = document.querySelector("video");
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

  const esFlow =
    dominio.includes("flow.com.ar") ||
    (video.src && video.src.startsWith("blob:") && !video.hasAttribute("controls"));

  if (esFlow) return "flow";

  // En plataformas conocidas accesibles: por defecto TRACK (o visual si lo eligió)
  if (dominiosAccesibles.some(d => dominio.includes(d))) {
    return fuenteSubGlobal === "visual" ? "visual" : "lector";
  }

  // Si hay textTracks, TRACK
  if (video.textTracks && video.textTracks.length > 0) return "lector";

  // Fallback visual
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
  const video = document.querySelector("video");
  if (!video) {
    console.warn("[KathWare] No se encontró ningún <video> en la página.");
    return;
  }

  console.log("[KathWare] Tipo detectado:", tipo);

  if (tipo === "flow") return iniciarOverlay(video);
  if (tipo === "lector") return iniciarLecturaSubtitulos(video);
  if (tipo === "visual") return iniciarLecturaVisual();
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
    <div style="margin-bottom:0.5rem;"><strong>KathWare Media Player (Flow)</strong></div>
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

  console.log("[KathWare] Overlay activado (Flow).");
}

// -------------------- TRACK --------------------
function iniciarLecturaSubtitulos(video) {
  if (!video.textTracks || !video.textTracks.length) {
    console.warn("[KathWare] No hay textTracks disponibles.");
    return;
  }

  cargarVozES();

  // Usar primera pista (luego lo refinamos con selectorTrack)
const idx = Math.max(0, Math.min(trackIndexGlobal, video.textTracks.length - 1));
trackLectura = video.textTracks[idx];

  trackLectura.mode = "hidden";

  trackLectura.oncuechange = () => {
    if (fuenteSubGlobal !== "track") return;
    const cue = trackLectura.activeCues && trackLectura.activeCues[0];
    if (!cue) return;
    leerTextoAccesible(cue.text || "", modoNarradorGlobal);
  };

  console.log("[KathWare] Lectura TRACK activa.");
}

// -------------------- Visual fallback --------------------
function iniciarLecturaVisual() {
  cargarVozES();
  if (visualInterval) clearInterval(visualInterval);

  visualInterval = setInterval(() => {
    if (modoNarradorGlobal === "off") return;
    if (fuenteSubGlobal !== "visual") return;

    const visual = document.querySelector(
      ".plyr__caption, .flirc-caption, [class*='caption'], [class*='cc'], [aria-label*='closed']"
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
  detenerLectura();
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
    if (message?.action === "toggleNarrator") {
      toggleExtension();
      sendResponse && sendResponse({ status: "ok" });
      return true;
    }

    if (message?.action === "updateSettings") {
      cargarConfigDesdeStorage(() => {
        console.log("[KathWare] Settings actualizados:", { modoNarradorGlobal, fuenteSubGlobal });

        // Si está activa, re-inicia el modo para aplicar cambios (importante)
        if (extensionActiva) {
          limpiarTodo();
          iniciarModoDetectado();
        }
      });
      sendResponse && sendResponse({ status: "ok" });
      return true;
    }
if (message?.action === "setTrack") {
  const video = document.querySelector("video");
  const idx = Number(message.index);

  if (video?.textTracks && Number.isFinite(idx) && idx >= 0 && idx < video.textTracks.length) {
    trackIndexGlobal = idx;

    // Si estamos en modo TRACK y la extensión está activa, cambiamos de pista en caliente
    if (extensionActiva) {
      // apagar track anterior
      if (trackLectura) trackLectura.oncuechange = null;

      // activar el nuevo
      trackLectura = video.textTracks[trackIndexGlobal];
      trackLectura.mode = "hidden";

      trackLectura.oncuechange = () => {
        if (fuenteSubGlobal !== "track") return;
        const cue = trackLectura.activeCues && trackLectura.activeCues[0];
        if (cue) leerTextoAccesible(cue.text || "", modoNarradorGlobal);
      };
    }

    sendResponse && sendResponse({ status: "ok" });
    return true;
  }

  sendResponse && sendResponse({ status: "ignored" });
  return true;
}

    if (message?.type === "getTracks") {
      const video = document.querySelector("video");
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

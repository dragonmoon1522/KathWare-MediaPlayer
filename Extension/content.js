<<<<<<< HEAD
// ====================================================
// KathWare Core - Funciones comunes de voz y subtítulos
// ====================================================

let voiceES = null;
let liveRegion = null;
let ultimoTexto = "";

let modoNarradorGlobal = "sintetizador"; // "off" | "sintetizador" | "lector"
let fuenteSubGlobal = "track";           // "track" | "visual"

// 🔊 Inicializar voz del sistema en español
function cargarVozES() {
  const voces = speechSynthesis.getVoices();
  voiceES = voces.find(v => v.lang && v.lang.startsWith("es"));
  if (!voiceES) {
    speechSynthesis.onvoiceschanged = cargarVozES;
  }
}
cargarVozES();

// 🗣️ Leer texto accesible según modo elegido
function leerTextoAccesible(texto, modo) {
  if (!texto) return;
  texto = texto.trim();
  if (!texto || texto === ultimoTexto) return;
  ultimoTexto = texto;

  if (!modo) modo = modoNarradorGlobal;
  if (modo === "off") return;

  if (modo === "lector") {
    if (!liveRegion) {
      liveRegion = document.createElement("div");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.style.position = "absolute";
      liveRegion.style.left = "-9999px";
      document.body.appendChild(liveRegion);
    }
    liveRegion.textContent = texto;
  } else if (modo === "sintetizador" && voiceES) {
    const utter = new SpeechSynthesisUtterance(texto);
    utter.voice = voiceES;
    utter.lang = voiceES.lang;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  }
}

// 📄 Convertir SRT a VTT (no la usamos acá, pero la dejamos por si hace falta luego)
function convertirSRTaVTT(srt) {
  return "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

// 🧹 Detener lectura
function detenerLectura() {
  speechSynthesis.cancel();
  if (liveRegion) {
    liveRegion.remove();
    liveRegion = null;
  }
  ultimoTexto = "";
}

// ====================================================
// KathWare Media Player - Extensión Chrome (Content Script)
// ====================================================

let extensionActiva = false;
let overlayActivo = false;
let overlayElement = null;
let originalVideo = null;
let trackLectura = null;
let visualInterval = null;

// 🔧 Cargar configuración desde storage (modo narrador y fuente)
function cargarConfigDesdeStorage(cb) {
  if (!chrome || !chrome.storage || !chrome.storage.local) {
    cb && cb();
    return;
  }
  chrome.storage.local.get(["modoNarrador", "fuenteSub"], (data) => {
    if (data.modoNarrador) modoNarradorGlobal = data.modoNarrador;
    if (data.fuenteSub) fuenteSubGlobal = data.fuenteSub;
    cb && cb();
  });
}
cargarConfigDesdeStorage();

// 🧭 Detectar tipo de reproductor
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

  // Flow u otros DRM sin controles accesibles
  const esFlow = dominio.includes("flow.com.ar") ||
                 (video.src.startsWith("blob:") && !video.hasAttribute("controls"));

  if (esFlow) return "flow";

  // Plataformas HTML5 accesibles
  if (dominiosAccesibles.some(d => dominio.includes(d))) {
    // Si el usuario eligió "visual" en el popup, respetamos eso
    return fuenteSubGlobal === "visual" ? "visual" : "lector";
  }

  // Si hay textTracks, usamos modo lector
  if (video.textTracks && video.textTracks.length > 0) return "lector";

  // Fallback: intentar lectura visual (captions en el DOM)
  return "visual";
}

// 🧩 Activar / desactivar extensión
function toggleExtension() {
  extensionActiva = !extensionActiva;
  console.log(`KathWare Media Player ${extensionActiva ? "🟢 Activado" : "🔴 Desactivado"}`);

  if (extensionActiva) {
    cargarConfigDesdeStorage(() => {
      iniciarModoDetectado();
    });
  } else {
    limpiarTodo();
  }
}

// 🚀 Iniciar según tipo de reproductor
function iniciarModoDetectado() {
  const tipo = detectarTipoReproductor();
  const video = document.querySelector("video");
  originalVideo = video;
  if (!video) {
    console.warn("⚠️ No se encontró ningún video en la página.");
    return;
  }

  console.log("[KathWare] Tipo de reproductor detectado:", tipo);

  if (tipo === "flow") return iniciarOverlay(video);
  if (tipo === "lector") return iniciarLecturaSubtitulos(video);
  if (tipo === "visual") return iniciarLecturaVisual();
}

// 🧱 Overlay para Flow (controles accesibles)
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
    borderRadius: "4px"
  });

  cont.innerHTML = `
    <div style="margin-bottom:0.5rem;"><strong>Reproductor accesible (Flow):</strong></div>
    <button id="kw-play">▶️ Reproducir</button>
    <button id="kw-pause">⏸️ Pausar</button>
    <button id="kw-back">⏪ -10s</button>
    <button id="kw-fwd">⏩ +10s</button>
    <button id="kw-volup">🔊 +Vol</button>
    <button id="kw-voldown">🔉 -Vol</button>
    <button id="kw-full">🖥️ Pantalla completa</button>
    <select id="modoLecturaFlow" style="margin-left:0.5rem;">
      <option value="off">Desactivado</option>
      <option value="sintetizador">Voz</option>
      <option value="lector">Lector</option>
    </select>
    <button id="kw-close" style="margin-left:0.5rem;">❌ Cerrar</button>
  `;

  document.body.appendChild(cont);
  overlayElement = cont;

  // Controles
  const v = video;
  cont.querySelector("#kw-play").onclick = () => v.play();
  cont.querySelector("#kw-pause").onclick = () => v.pause();
  cont.querySelector("#kw-back").onclick = () => { v.currentTime -= 10; };
  cont.querySelector("#kw-fwd").onclick = () => { v.currentTime += 10; };
  cont.querySelector("#kw-volup").onclick = () => { v.volume = Math.min(v.volume + 0.1, 1); };
  cont.querySelector("#kw-voldown").onclick = () => { v.volume = Math.max(v.volume - 0.1, 0); };
  cont.querySelector("#kw-full").onclick = () => { v.requestFullscreen && v.requestFullscreen(); };
  cont.querySelector("#kw-close").onclick = () => cerrarOverlay();

  const selectorModoFlow = cont.querySelector("#modoLecturaFlow");
  selectorModoFlow.value = modoNarradorGlobal;
  selectorModoFlow.addEventListener("change", () => {
    modoNarradorGlobal = selectorModoFlow.value;
  });

  console.log("✅ Overlay KathWare activado (Flow)");

  // Flow en general NO expone textTracks, así que acá normalmente no hay lectura posible.
  // Si alguna vez expone, podrías llamar iniciarLecturaSubtitulos(video) acá.
}

// 🔊 Lectura de subtítulos TRACK (Netflix, YouTube, etc.)
function iniciarLecturaSubtitulos(video) {
  if (!video.textTracks || !video.textTracks.length) {
    console.warn("[KathWare] No hay subtítulos disponibles (textTracks vacío).");
    return;
  }

  cargarVozES();

  // Por simplicidad, usamos la primera pista
  trackLectura = video.textTracks[0];
  trackLectura.mode = "hidden";

  trackLectura.oncuechange = () => {
    const cue = trackLectura.activeCues && trackLectura.activeCues[0];
    if (!cue) return;
    const texto = cue.text ? cue.text.replace(/<[^>]+>/g, "") : "";
    leerTextoAccesible(texto, modoNarradorGlobal);
  };

  console.log("🗣️ Lector de subtítulos activado (modo TRACK)");
}

// 🪄 Lectura visual (captura captions HTML)
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

  console.log("🗣️ Lector visual de subtítulos activo (modo Fallback)");
}

// 🧹 Cierre y limpieza
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
  cerrarOverlay();
  if (trackLectura) {
    trackLectura.oncuechange = null;
    trackLectura = null;
  }
  detenerLectura();
}

// ⚡ Atajo de teclado dentro de la página
document.addEventListener("keydown", e => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    toggleExtension();
  }
});

// 📡 Escuchar mensajes desde background / popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "toggleNarrator") {
    toggleExtension();
    sendResponse && sendResponse({ status: "ok" });
    return true;
  }

  if (message.action === "updateSettings") {
    cargarConfigDesdeStorage(() => {
      console.log("[KathWare] Configuración actualizada desde popup:", {
        modoNarradorGlobal,
        fuenteSubGlobal
      });
    });
    sendResponse && sendResponse({ status: "ok" });
    return true;
  }

  // Responder lista de pistas al popup
  if (message.type === "getTracks") {
    const video = document.querySelector("video");
    const tracks = video && video.textTracks
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
=======
(function () {
  // 💡 Estado global
  let video = null;
  let trackSeleccionado = null;
  let voiceES = null;
  let ultimoTexto = "";
  let narradorActivo = true;
  let usarTrack = true;
  let modoLector = false;

  // 🔊 Inicializa voz en español
  function initVoice() {
    const voces = window.speechSynthesis.getVoices();
    voiceES = voces.find(v => v.lang.startsWith("es"));
    if (!voiceES) {
      console.warn("⚠️ No se encontró voz en español.");
    }
  }

  // 🗣️ Función para anunciar texto
  function anunciarTexto(texto) {
    if (!narradorActivo || !texto || texto === ultimoTexto) return;
    ultimoTexto = texto;

    if (modoLector) {
      const live = document.getElementById("sub-accesible-kathware");
      if (live) live.textContent = texto;
    } else {
      const utter = new SpeechSynthesisUtterance(texto);
      if (voiceES) utter.voice = voiceES;
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
    }
  }

  // 🎯 Crea UI accesible
  function initUI() {
    if (!document.getElementById("sub-accesible-kathware")) {
      const liveRegion = document.createElement("div");
      liveRegion.id = "sub-accesible-kathware";
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.style.position = "absolute";
      liveRegion.style.left = "-9999px";
      document.body.appendChild(liveRegion);
    }

    const btn = document.createElement("button");
    btn.id = "kathwareToggle";
    btn.setAttribute("aria-label", "🎧 Narrador: ON");
    btn.textContent = "🎧 Narrador: ON";
    btn.style.position = "fixed";
    btn.style.bottom = "1rem";
    btn.style.right = "1rem";
    btn.style.zIndex = "9999";
    btn.style.padding = "10px";
    btn.style.background = "#222";
    btn.style.color = "#fff";
    btn.style.border = "1px solid #999";
    btn.style.cursor = "pointer";
    btn.setAttribute("data-kathware-ignore", "true");
    btn.onclick = () => {
      narradorActivo = !narradorActivo;
      btn.textContent = `🎧 Narrador: ${narradorActivo ? "ON" : "OFF"}`;
    };
    document.body.appendChild(btn);
  }

  // 🔍 Detecta subtítulos con .textTracks
  function activarTextTrack() {
    if (!video || !video.textTracks) return;

    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i];
      if (track.mode === "showing" || track.mode === "hidden") {
        track.mode = "hidden";
        track.oncuechange = () => {
          const cue = track.activeCues?.[0];
          if (cue && cue.text) {
            console.log("🎬 Subtítulo detectado:", cue.text);
            anunciarTexto(cue.text);
          }
        };
        trackSeleccionado = track;
        console.log("✅ Track seleccionado:", track.label || track.language);
        return;
      }
    }

    console.warn("🚫 No se detectaron pistas activas. Activando modo DOM...");
    detectarSubtitulosDesdeDOM();
  }

  // 🕵️ Fallback: Detecta subtítulos visibles en el DOM
  function detectarSubtitulosDesdeDOM() {
    console.warn("🎯 Activando modo detective de subtítulos visuales (fallback DOM)");

    const encontrarNodoDeSubtitulo = () => {
      const candidatos = Array.from(document.querySelectorAll("div, span, p")).filter(el => {
        const styles = window.getComputedStyle(el);
        const visible = styles.display !== "none" && styles.visibility !== "hidden";
        const contieneClave = /caption|subtitle|subt[ií]tulo/i.test(
          (el.className || "") +
          (el.id || "") +
          (el.getAttribute("data-testid") || "")
        );
        const texto = el.innerText?.trim();
        return visible && contieneClave && texto?.length > 4;
      });

      if (candidatos.length > 0) {
        console.log("✅ Nodo de subtítulo visual detectado:", candidatos[0]);
        return candidatos[0];
      } else {
        console.warn("🚫 No se encontraron nodos con subtítulos visibles.");
        return null;
      }
    };

    const nodo = encontrarNodoDeSubtitulo();
    if (!nodo) return;

    let ultimoTextoDOM = "";

    setInterval(() => {
      const textoActual = nodo.innerText?.trim();
      if (textoActual && textoActual !== ultimoTextoDOM) {
        ultimoTextoDOM = textoActual;
        console.log("🗣️ Subtítulo visual:", textoActual);
        anunciarTexto(textoActual);
      }
    }, 400);
  }

  // 📺 Detecta video, incluyendo shadowRoot
  function buscarVideo() {
    const buscarEnNodos = (root) => {
      const videos = root.querySelectorAll("video");
      for (let vid of videos) {
        if (vid.textTracks?.length > 0) {
          return vid;
        }
      }

      // Revisa shadowRoots si los hay
      const all = root.querySelectorAll("*");
      for (let el of all) {
        if (el.shadowRoot) {
          const vid = buscarEnNodos(el.shadowRoot);
          if (vid) return vid;
        }
      }
      return null;
    };

    return buscarEnNodos(document);
  }

  // 🚀 Inicializa todo
  function init() {
    initVoice();
    initUI();

    const intentar = setInterval(() => {
      video = buscarVideo();
      if (video) {
        clearInterval(intentar);
        console.log("🎥 Video detectado:", video);
        setTimeout(activarTextTrack, 500); // pequeño delay por las dudas
      }
    }, 1000);
  }

  // 💤 Espera a que las voces estén cargadas
  if (speechSynthesis.getVoices().length === 0) {
    speechSynthesis.addEventListener("voiceschanged", init);
  } else {
    init();
  }
})();
>>>>>>> ca74f3e05933883809650aa17f5acb569b40f646

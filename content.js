let trackSeleccionado = null;
let voiceES = null;
let ultimoTexto = "";
let errores = [];
let autoNarrador = false;

const modoNarrador = document.getElementById("modoNarrador");
const fuenteSub = document.getElementById("fuenteSub");
const trackSelector = document.getElementById("selectorTrack");
const liveRegion = document.getElementById("sub-accesible");
const video = document.getElementById("videoPlayer");

// Inicializar voz del sistema
function cargarVoz() {
  const voces = speechSynthesis.getVoices();
  voiceES = voces.find(v => v.lang.startsWith("es"));
}
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = cargarVoz;
}
cargarVoz();

// Detectar y poblar subtítulos TRACK disponibles
function poblarSelectorTracks() {
  const pistas = Array.from(video.textTracks);
  trackSelector.innerHTML = pistas.map((t, i) =>
    `<option value="${i}">${t.label || t.language || "Pista " + (i + 1)}</option>`).join("");

  if (pistas.length > 0) {
    pistas.forEach((t, i) => t.mode = i === 0 ? "hidden" : "disabled");
    trackSeleccionado = pistas[0];
    iniciarLecturaTrack();
  }
}
trackSelector.addEventListener("change", (e) => {
  const idx = parseInt(e.target.value);
  if (!isNaN(idx)) {
    Array.from(video.textTracks).forEach((t, i) => t.mode = i === idx ? "hidden" : "disabled");
    trackSeleccionado = video.textTracks[idx];
  }
});
poblarSelectorTracks();

// Lectura por cambios en subtítulo TRACK
function iniciarLecturaTrack() {
  if (!trackSeleccionado) return;

  trackSeleccionado.oncuechange = () => {
    const cue = trackSeleccionado.activeCues?.[0];
    if (!cue) return;

    const texto = cue.text.trim();
    if (texto && texto !== ultimoTexto) {
      ultimoTexto = texto;
      anunciarTexto(texto);
    }
  };
}

// Lectura visual de subtítulos en plataformas no accesibles
setInterval(() => {
  if (modoNarrador.value === "off" || fuenteSub.value === "track") return;

  const visual = document.querySelector(
    ".plyr__caption, .flirc-caption, [class*='caption'], [class*='cc'], [aria-label*='closed']"
  );
  const texto = visual?.textContent.trim();

  if (texto && texto !== ultimoTexto) {
    ultimoTexto = texto;
    anunciarTexto(texto);
  }
}, 500);

// Función que decide cómo leer el texto
function anunciarTexto(texto) {
  if (modoNarrador.value === "lector") {
    liveRegion.textContent = texto;
  } else if (modoNarrador.value === "sintetizador" && voiceES) {
    const utter = new SpeechSynthesisUtterance(texto);
    utter.voice = voiceES;
    utter.lang = voiceES.lang;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  }
}

// Atajo Ctrl + Shift + K
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "toggleNarrator") {
    autoNarrador = !autoNarrador;
    modoNarrador.value = autoNarrador ? "sintetizador" : "off";
    if (!autoNarrador) speechSynthesis.cancel();
    alert(autoNarrador ? "Narrador activado" : "Narrador desactivado");
    sendResponse({ status: "ok" });
  }
});

// Registro de errores
window.onerror = function (msg, url, line, col, error) {
  const detalle = {
    mensaje: msg,
    archivo: url,
    linea: line,
    columna: col,
    stack: error?.stack || "sin stack",
    fecha: new Date().toISOString()
  };
  errores.push(detalle);
  guardarErroresLocal(detalle);
  return false;
};

function guardarErroresLocal(error) {
  const entry = { ...error };
  const data = JSON.stringify(entry);
  const req = indexedDB.open("store.db", 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("errores")) {
      db.createObjectStore("errores", { autoIncrement: true });
    }
  };
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction("errores", "readwrite");
    tx.objectStore("errores").add(entry);
  };
}

// Envío manual de errores
function enviarErroresAlServidor() {
  const req = indexedDB.open("store.db", 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction("errores", "readonly");
    const store = tx.objectStore("errores");
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const erroresGuardados = getAll.result;
      if (erroresGuardados.length > 0) {
        fetch("https://kathware.com.ar/api/errores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ errores: erroresGuardados })
        }).then(() => {
          const clearTx = db.transaction("errores", "readwrite");
          clearTx.objectStore("errores").clear();
        });
      }
    };
  };
}

// ====================================================
// KathWare Player - Reproductor accesible para la web
// (core + lógica del player unificados)
// ====================================================

document.addEventListener("DOMContentLoaded", () => {
  const video        = document.getElementById("videoPlayer");
  const inputVideo   = document.getElementById("videoInput");
  const inputSubs    = document.getElementById("subtitleInput");
  const modoNarrador = document.getElementById("modoNarrador");
  const fuenteSub    = document.getElementById("fuenteSub");
  const liveRegion   = document.getElementById("sub-accesible");

  // Para que los botones inline (onclick="video...") sigan funcionando
  window.video = video;

  // -------- Core unificado --------
  let voiceES = null;
  let ultimoTexto = "";
  let trackSeleccionado = null;
  let visualInterval = null;

  function cargarVozES() {
    if (typeof speechSynthesis === "undefined") return;
    const voces = speechSynthesis.getVoices();
    voiceES = voces.find(v => v.lang && v.lang.startsWith("es")) || null;

    if (!voiceES) {
      speechSynthesis.onvoiceschanged = () => {
        const voces2 = speechSynthesis.getVoices();
        voiceES = voces2.find(v => v.lang && v.lang.startsWith("es")) || null;
      };
    }
  }

  function detenerLectura() {
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
    }
    if (liveRegion) liveRegion.textContent = "";
    ultimoTexto = "";
  }

  function leerTextoAccesible(texto) {
    if (!texto) return;
    texto = texto.trim();
    if (!texto || texto === ultimoTexto) return;
    ultimoTexto = texto;

    if (!modoNarrador) return;
    const modo = modoNarrador.value || "off";
    if (modo === "off") return;

    texto = texto.replace(/<[^>]+>/g, "");

    if (modo === "lector") {
      if (liveRegion) {
        liveRegion.textContent = texto;
      }
    } else if (modo === "sintetizador" && voiceES && typeof speechSynthesis !== "undefined") {
      const utter = new SpeechSynthesisUtterance(texto);
      utter.voice = voiceES;
      utter.lang = voiceES.lang;
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
    }
  }

  function convertirSRTaVTT(srt) {
    return "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  }

  // -------- Manejo de video/audio local --------
  inputVideo?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    video.src = url;
    video.load();
  });

  // -------- Manejo de subtítulos locales (VTT / SRT) --------
  inputSubs?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split(".").pop().toLowerCase();
    const reader = new FileReader();

    reader.onload = () => {
      let texto = reader.result;

      if (ext === "srt") {
        texto = convertirSRTaVTT(texto);
      }

      const blob = new Blob([texto], { type: "text/vtt" });
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = "Subtítulos";
      track.srclang = "es";
      track.src = URL.createObjectURL(blob);
      track.default = true;
      video.appendChild(track);

      setTimeout(() => {
        const pistas = video.textTracks;
        if (!pistas || !pistas.length) {
          console.warn("[KathWare] No se detectaron pistas de subtítulos.");
          return;
        }
        trackSeleccionado = pistas[pistas.length - 1];
        iniciarLecturaTrack(trackSeleccionado);
      }, 300);
    };

    reader.readAsText(file);
  });

  function iniciarLecturaTrack(track) {
    if (!track) return;
    track.mode = "hidden";

    track.oncuechange = () => {
      if (fuenteSub && fuenteSub.value !== "track") return;
      const cue = track.activeCues && track.activeCues[0];
      if (!cue) return;
      leerTextoAccesible(cue.text || "");
    };
  }

  // -------- Modo "visual" (fallback) --------
  function iniciarLecturaVisual() {
    if (visualInterval) clearInterval(visualInterval);

    visualInterval = setInterval(() => {
      if (!modoNarrador || modoNarrador.value === "off") return;
      if (!fuenteSub || fuenteSub.value !== "visual") return;

      const visual = document.querySelector(
        ".plyr__caption, .flirc-caption, [class*='caption'], [class*='cc'], [aria-label*='closed']"
      );
      const texto = visual?.textContent?.trim();
      if (texto) leerTextoAccesible(texto);
    }, 800);
  }

  if (fuenteSub && fuenteSub.value === "visual") {
    iniciarLecturaVisual();
  }

  fuenteSub?.addEventListener("change", () => {
    if (fuenteSub.value === "visual") {
      iniciarLecturaVisual();
    } else if (visualInterval) {
      clearInterval(visualInterval);
      visualInterval = null;
    }
  });

  // -------- Atajo Ctrl+K para alternar narrador --------
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (!modoNarrador) return;
      if (modoNarrador.value === "off") {
        modoNarrador.value = "sintetizador";
        alert("🟢 Narrador activado");
      } else {
        modoNarrador.value = "off";
        detenerLectura();
        alert("🔴 Narrador desactivado");
      }
    }
  });

  cargarVozES();
});

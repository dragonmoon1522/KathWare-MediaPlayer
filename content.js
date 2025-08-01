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

(function () {
  let video = null;
  let trackSeleccionado = null;
  let voiceES = null;
  let ultimoTexto = "";
  let narradorActivo = true;
  let usarTrack = true;
  let modoLector = false;

  // 🎯 Crear UI accesible si no existe
  function initUI() {
    if (!document.getElementById("sub-accesible-kathware")) {
      const liveRegion = document.createElement("div");
      liveRegion.id = "sub-accesible-kathware";
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.setAttribute("data-kathware-ignore", "true");
      liveRegion.style.position = "absolute";
      liveRegion.style.left = "-9999px";
      document.body.appendChild(liveRegion);
    }

    const makeButton = (id, text, bottom, color) => {
      if (document.getElementById(id)) return;
      const btn = document.createElement("button");
      btn.id = id;
      btn.innerText = text;
      btn.setAttribute("aria-label", text);
      btn.setAttribute("data-kathware-ignore", "true");
      Object.assign(btn.style, {
        position: "fixed",
        bottom,
        right: "1rem",
        zIndex: "9999",
        padding: "10px",
        background: color,
        color: "#fff",
        border: "1px solid #999",
        cursor: "pointer"
      });
      document.body.appendChild(btn);
    };

    makeButton("kathwareToggle", "🎧 Narrador: ON", "1rem", "#222");
    makeButton("kathwareFuente", "📄 Fuente: TRACK", "4rem", "#444");
    makeButton("kathwareModo", "🦻 Modo: SINTETIZADOR", "7rem", "#555");

    if (!document.getElementById("kathwareSelector")) {
      const sel = document.createElement("select");
      sel.id = "kathwareSelector";
      sel.setAttribute("data-kathware-ignore", "true");
      Object.assign(sel.style, {
        position: "fixed",
        bottom: "10rem",
        right: "1rem",
        zIndex: "9999",
        padding: "10px",
        background: "#333",
        color: "#fff",
        border: "1px solid #999",
        cursor: "pointer"
      });
      document.body.appendChild(sel);
    }
  }

  // 🎤 Cargar voz
  function cargarVoz() {
    const voces = speechSynthesis.getVoices();
    voiceES = voces.find(v => v.lang.startsWith("es"));
  }
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = cargarVoz;
  }
  cargarVoz();

  // 🧠 Eventos UI
  function initEventosUI() {
    document.getElementById("kathwareToggle").onclick = () => {
      narradorActivo = !narradorActivo;
      document.getElementById("kathwareToggle").innerText = `🎧 Narrador: ${narradorActivo ? "ON" : "OFF"}`;
      if (!narradorActivo) speechSynthesis.cancel();
    };

    document.getElementById("kathwareFuente").onclick = () => {
      usarTrack = !usarTrack;
      const btn = document.getElementById("kathwareFuente");
      btn.innerText = usarTrack ? "📄 Fuente: TRACK" : "📄 Fuente: VISUAL";
      btn.style.background = usarTrack ? "#444" : "#165016";
      ultimoTexto = "";
      speechSynthesis.cancel();
    };

    document.getElementById("kathwareModo").onclick = () => {
      modoLector = !modoLector;
      const btn = document.getElementById("kathwareModo");
      btn.innerText = modoLector ? "🦻 Modo: LECTOR" : "🦻 Modo: SINTETIZADOR";
      btn.style.background = modoLector ? "#2266aa" : "#555";
      ultimoTexto = "";
      speechSynthesis.cancel();
    };

    document.getElementById("kathwareSelector").onchange = (e) => {
      const idx = parseInt(e.target.value);
      if (!isNaN(idx)) {
        Array.from(video.textTracks).forEach((t, i) => t.mode = i === idx ? "hidden" : "disabled");
        trackSeleccionado = video.textTracks[idx];
        iniciarLecturaTrack();
      }
    };
  }

  // 📡 Detectar video
  function detectarVideo() {
    video = document.querySelector("video");
    if (!video) {
      const observer = new MutationObserver(() => {
        const nuevo = document.querySelector("video");
        if (nuevo) {
          video = nuevo;
          observer.disconnect();
          poblarSelectorTracks();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      poblarSelectorTracks();
    }
  }

  // 🎬 Pistas de subtítulo
  function poblarSelectorTracks() {
    const sel = document.getElementById("kathwareSelector");
    const pistas = Array.from(video.textTracks);
    sel.innerHTML = pistas.map((t, i) =>
      `<option value="${i}">${t.label || t.language || "Pista " + (i + 1)}</option>`).join("");

    if (pistas.length > 0) {
      pistas.forEach((t, i) => t.mode = i === 0 ? "hidden" : "disabled");
      trackSeleccionado = pistas[0];
      iniciarLecturaTrack();
    }
  }

  // 📖 Lectura de subtítulos TRACK
  function iniciarLecturaTrack() {
    if (!trackSeleccionado) return;
    trackSeleccionado.oncuechange = () => {
      const cue = trackSeleccionado.activeCues?.[0];
      if (cue) anunciarTexto(cue.text.trim());
    };
  }

  // 🔍 Lectura de subtítulos visuales
  setInterval(() => {
    if (!narradorActivo || usarTrack) return;

    const visuales = Array.from(document.querySelectorAll(
      ".plyr__caption, .flirc-caption, [class*='caption'], [class*='cc'], [aria-label*='closed']"
    )).filter(el => !el.closest("[data-kathware-ignore]"));

    const texto = visuales.find(v => v.textContent.trim())?.textContent.trim();

    if (texto && texto !== ultimoTexto && texto.length > 5) {
      ultimoTexto = texto;
      anunciarTexto(texto);
    }
  }, 500);

  // 📢 Narrador: lector o sintetizador
  function anunciarTexto(texto) {
    if (!texto || texto === ultimoTexto) return;
    ultimoTexto = texto;
    const liveRegion = document.getElementById("sub-accesible-kathware");

    if (modoLector) {
      liveRegion.textContent = texto;
    } else if (voiceES) {
      const utter = new SpeechSynthesisUtterance(texto);
      utter.voice = voiceES;
      utter.lang = voiceES.lang;
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
    }
  }

  // 🚀 Iniciar todo
  initUI();
  initEventosUI();
  detectarVideo();
})();

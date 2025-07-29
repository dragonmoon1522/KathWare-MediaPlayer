(function () {
  // 💡 Config y estado
  let video = null;
  let trackSeleccionado = null;
  let voiceES = null;
  let ultimoTexto = "";
  let narradorActivo = true;
  let usarTrack = true;
  let modoLector = false;

  // 🎯 Crea UI si no existe (modo consola/bookmarklet)
  function initUI() {
    if (!document.getElementById("sub-accesible-kathware")) {
      const liveRegion = document.createElement("div");
      liveRegion.id = "sub-accesible-kathware";
      liveRegion.setAttribute("aria-live", "polite");
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

  // 🎤 Carga voz en español
  function cargarVoz() {
    const voces = speechSynthesis.getVoices();
    voiceES = voces.find(v => v.lang.startsWith("es"));
  }
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = cargarVoz;
  }
  cargarVoz();

  // 🧠 Eventos de UI
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

  // 📡 Detectar <video>
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

  // 🎬 Detectar tracks y poblar selector
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

  // 📖 Lectura por TRACK
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

  // 🔍 Lectura por subtítulos visibles
  setInterval(() => {
    if (!narradorActivo || usarTrack) return;
    const visual = document.querySelector(
      ".plyr__caption, .flirc-caption, [class*='caption'], [class*='cc'], [aria-label*='closed']"
    );
    const texto = visual?.textContent.trim();
    if (texto && texto !== ultimoTexto) {
      ultimoTexto = texto;
      anunciarTexto(texto);
    }
  }, 500);

  // 📢 Anunciar texto
  function anunciarTexto(texto) {
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

  // 🚀 Lanzamiento
  initUI();
  initEventosUI();
  detectarVideo();
})();

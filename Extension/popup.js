document.addEventListener("DOMContentLoaded", () => {
  const modoNarrador = document.getElementById("modoNarrador");
  const fuenteSub = document.getElementById("fuenteSub");
  const selectorTrack = document.getElementById("selectorTrack");
  const reporteError = document.getElementById("reporteError");
  const enviarReporte = document.getElementById("enviarReporte");
  const permitirEnvioLogs = document.getElementById("permitirEnvioLogs");

  // === Helpers ===
  function withActiveTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs?.[0]?.id;
      if (!tabId) return;
      cb(tabId);
    });
  }

  function notificarCambio() {
    withActiveTab((tabId) => {
      chrome.tabs.sendMessage(tabId, { action: "updateSettings" });
    });
  }

  // === Cargar valores guardados ===
  chrome.storage.local.get(["modoNarrador", "fuenteSub", "trackIndex"], (data) => {
    if (data.modoNarrador) modoNarrador.value = data.modoNarrador;
    if (data.fuenteSub) fuenteSub.value = data.fuenteSub;
    if (typeof data.trackIndex !== "undefined") selectorTrack.value = String(data.trackIndex);
  });

  // === Guardar configuraciones + notificar al content.js ===
  modoNarrador.addEventListener("change", () => {
    chrome.storage.local.set({ modoNarrador: modoNarrador.value }, notificarCambio);
  });

  fuenteSub.addEventListener("change", () => {
    chrome.storage.local.set({ fuenteSub: fuenteSub.value }, notificarCambio);
  });

  selectorTrack.addEventListener("change", () => {
    const idx = parseInt(selectorTrack.value, 10);
    chrome.storage.local.set({ trackIndex: idx }, () => {
      notificarCambio();
      // opcional: setTrack inmediato (si lo implementás en content.js)
      withActiveTab((tabId) => {
        chrome.tabs.sendMessage(tabId, { action: "setTrack", index: idx });
      });
    });
  });

  // === Enviar reporte de error ===
  enviarReporte.addEventListener("click", () => {
    const mensaje = (reporteError.value || "").trim();
    if (!mensaje) {
      alert("Por favor, escribí una descripción del problema.");
      return;
    }

    const reporte = { mensaje, fecha: new Date().toISOString() };

    if (permitirEnvioLogs.checked) {
      chrome.storage.local.get("kathLogs", (data) => {
        reporte.logs = data.kathLogs || [];
        enviarReporteFinal(reporte);
      });
    } else {
      enviarReporteFinal(reporte);
    }
  });

  function enviarReporteFinal(reporte) {
    chrome.storage.local.get("reportesEnviados", (data) => {
      const reportes = data.reportesEnviados || [];
      reportes.push(reporte);
      chrome.storage.local.set({ reportesEnviados: reportes }, () => {
        alert("¡Gracias! Tu reporte fue guardado localmente.");
        reporteError.value = "";
      });
    });
  }

  // === Obtener tracks desde content.js ===
  withActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, { type: "getTracks" }, (response) => {
      const tracks = response?.tracks || [];
      selectorTrack.innerHTML = "";

      tracks.forEach((track, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = track.label || `Pista ${index + 1}`;
        selectorTrack.appendChild(option);
      });

      chrome.storage.local.get("trackIndex", (data) => {
        const idx = (typeof data.trackIndex !== "undefined") ? String(data.trackIndex) : "0";
        if (selectorTrack.querySelector(`option[value="${idx}"]`)) {
          selectorTrack.value = idx;
        }
      });
    });
  });
});

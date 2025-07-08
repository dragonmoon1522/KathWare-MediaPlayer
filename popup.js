document.addEventListener("DOMContentLoaded", () => {
  const modoNarrador = document.getElementById("modoNarrador");
  const fuenteSub = document.getElementById("fuenteSub");
  const selectorTrack = document.getElementById("selectorTrack");
  const reporteError = document.getElementById("reporteError");
  const enviarReporte = document.getElementById("enviarReporte");
  const permitirEnvioLogs = document.getElementById("permitirEnvioLogs");

  // Cargar valores guardados
  chrome.storage.local.get(["modoNarrador", "fuenteSub", "trackIndex"], (data) => {
    if (data.modoNarrador) modoNarrador.value = data.modoNarrador;
    if (data.fuenteSub) fuenteSub.value = data.fuenteSub;
    if (typeof data.trackIndex !== "undefined") selectorTrack.selectedIndex = data.trackIndex;
  });

  // Guardar configuraciones
  modoNarrador.addEventListener("change", () => {
    chrome.storage.local.set({ modoNarrador: modoNarrador.value });
  });

  fuenteSub.addEventListener("change", () => {
    chrome.storage.local.set({ fuenteSub: fuenteSub.value });
  });

  selectorTrack.addEventListener("change", () => {
    chrome.storage.local.set({ trackIndex: selectorTrack.selectedIndex });
  });

  // Enviar reporte de error
  enviarReporte.addEventListener("click", () => {
    const mensaje = reporteError.value.trim();

    if (!mensaje) {
      alert("Por favor, escribí una descripción del problema.");
      return;
    }

    const reporte = {
      mensaje,
      fecha: new Date().toISOString(),
    };

    // Si el usuario permite el envío de logs, los recuperamos
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
    // Por ahora lo guardamos en localStorage (simulación)
    chrome.storage.local.get("reportesEnviados", (data) => {
      const reportes = data.reportesEnviados || [];
      reportes.push(reporte);
      chrome.storage.local.set({ reportesEnviados: reportes });
      alert("¡Gracias! Tu reporte fue guardado localmente.");
      reporteError.value = "";
    });
  }

  // Recibir lista de pistas desde el content script
  chrome.runtime.sendMessage({ type: "getTracks" }, (response) => {
    if (response && response.tracks) {
      selectorTrack.innerHTML = "";
      response.tracks.forEach((track, index) => {
        const option = document.createElement("option");
        option.value = index;
        option.textContent = track.label || `Pista ${index + 1}`;
        selectorTrack.appendChild(option);
      });

      chrome.storage.local.get("trackIndex", (data) => {
        if (typeof data.trackIndex !== "undefined") {
          selectorTrack.selectedIndex = data.trackIndex;
        }
      });
    }
  });
});

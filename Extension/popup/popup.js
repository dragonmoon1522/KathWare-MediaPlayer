// ====================================================
// KathWare SubtitleReader - popup.js
// Popup informativo + configuración básica
//
// El popup NO decide:
// - fuente de subtítulos (track / visual)
// - pista activa
//
// Todo eso se detecta automáticamente en el content script.
// ====================================================

document.addEventListener("DOMContentLoaded", () => {
  const modoNarrador = document.getElementById("modoNarrador");

  const reporteError = document.getElementById("reporteError");
  const enviarReporte = document.getElementById("enviarReporte");
  const permitirEnvioLogs = document.getElementById("permitirEnvioLogs");

  const GITHUB_OWNER = "dragonmoon1522";
  const GITHUB_REPO = "KathWare-SubtitleReader";

  // ---------------- Helpers ----------------

  function withActiveTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.id) return;
      cb(tab.id, tab);
    });
  }

  function notifyContentScript() {
    withActiveTab((tabId) => {
      chrome.tabs.sendMessage(
        tabId,
        { action: "updateSettings" },
        () => void chrome.runtime.lastError
      );
    });
  }

  // ---------------- Cargar configuración ----------------

  chrome.storage.local.get(["modoNarrador"], (data) => {
    if (data?.modoNarrador && modoNarrador) {
      modoNarrador.value = data.modoNarrador;
    }
  });

  // ---------------- Guardar modo de lectura ----------------

  modoNarrador?.addEventListener("change", () => {
    chrome.storage.local.set(
      { modoNarrador: modoNarrador.value },
      notifyContentScript
    );
  });

  // ---------------- Reporte de errores ----------------

  function inferPlatformFromUrl(url) {
    try {
      const h = new URL(url).hostname.toLowerCase();
      if (h.includes("netflix")) return "netflix";
      if (h.includes("disney")) return "disney";
      if (h.includes("max")) return "max";
      if (h.includes("primevideo")) return "prime";
      if (h.includes("paramount")) return "paramount";
      if (h.includes("flow")) return "flow";
      return "generic";
    } catch {
      return "generic";
    }
  }

  function buildIssueBody(reporte) {
    const lines = [];

    lines.push("## Descripción");
    lines.push(reporte.mensaje);
    lines.push("");

    lines.push("## Información");
    lines.push(`- Fecha: ${reporte.fecha}`);
    lines.push(`- Versión: ${reporte.version}`);
    lines.push(`- Plataforma: ${reporte.platform}`);
    lines.push(`- URL: ${reporte.url}`);
    lines.push(`- Modo de lectura: ${reporte.modoNarrador}`);
    lines.push(`- Navegador / SO: ${reporte.ua}`);
    lines.push("");

    if (reporte.logs?.length) {
      lines.push("## Logs");
      lines.push("```");
      reporte.logs.forEach(l => lines.push(String(l.msg || l)));
      lines.push("```");
    }

    return lines.join("\n");
  }

  function openGithubIssue(reporte) {
    const title = encodeURIComponent(
      `Bug: ${reporte.platform} — lectura de subtítulos`
    );

    const body = encodeURIComponent(
      buildIssueBody(reporte).slice(0, 7000)
    );

    const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/new?title=${title}&body=${body}`;
    chrome.tabs.create({ url });
  }

  enviarReporte?.addEventListener("click", () => {
    const mensaje = (reporteError?.value || "").trim();
    if (!mensaje) {
      alert("Por favor, describí el problema encontrado.");
      return;
    }

    const reporte = {
      mensaje,
      fecha: new Date().toISOString(),
      version: chrome.runtime.getManifest().version,
      modoNarrador: modoNarrador?.value || "desconocido",
      url: "",
      platform: "",
      ua: navigator.userAgent
    };

    withActiveTab((_, tab) => {
      reporte.url = tab.url || "";
      reporte.platform = inferPlatformFromUrl(reporte.url);

      if (permitirEnvioLogs?.checked) {
        chrome.storage.local.get("kathLogs", (data) => {
          reporte.logs = (data?.kathLogs || []).slice(-100);
          openGithubIssue(reporte);
          reporteError.value = "";
        });
      } else {
        openGithubIssue(reporte);
        reporteError.value = "";
      }
    });
  });
});

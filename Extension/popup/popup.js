// -----------------------------------------------------------------------------
// KathWare SubtitleReader - popup.js
// Popup informativo + configuración básica
//
// El popup NO decide:
// - fuente de subtítulos (track / visual)
// - pista activa
//
// Todo eso se detecta automáticamente en el content script.
// -----------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  const api =
    (typeof chrome !== "undefined" && chrome?.runtime) ? chrome :
    (typeof browser !== "undefined" && browser?.runtime) ? browser :
    null;

  if (!api) {
    console.warn("[KWSR] No runtime API (chrome/browser).");
    return;
  }

  const modoNarrador = document.getElementById("modoNarrador");

  const reporteError = document.getElementById("reporteError");
  const enviarReporte = document.getElementById("enviarReporte");
  const permitirEnvioLogs = document.getElementById("permitirEnvioLogs");

  const GITHUB_OWNER = "dragonmoon1522";
  const GITHUB_REPO = "KathWare-SubtitleReader";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function withActiveTab(cb) {
    try {
      api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        cb(tab || null);
      });
    } catch {
      cb(null);
    }
  }

  function notifyContentScript() {
    withActiveTab((tab) => {
      if (!tab?.id) return;

      try {
        api.tabs.sendMessage(
          tab.id,
          { action: "updateSettings" },
          () => void api.runtime.lastError // silenciar si no hay content script
        );
      } catch {
        // Silencioso
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Cargar configuración
  // ---------------------------------------------------------------------------

  try {
    api.storage.local.get(["modoNarrador"], (data) => {
      if (data?.modoNarrador && modoNarrador) {
        modoNarrador.value = data.modoNarrador;
      }
    });
  } catch {
    // Silencioso
  }

  // ---------------------------------------------------------------------------
  // Guardar modo de lectura
  // ---------------------------------------------------------------------------

  modoNarrador?.addEventListener("change", () => {
    try {
      api.storage.local.set(
        { modoNarrador: modoNarrador.value },
        notifyContentScript
      );
    } catch {
      // Silencioso
    }
  });

  // ---------------------------------------------------------------------------
  // Reporte de errores
  // ---------------------------------------------------------------------------

  function inferPlatformFromUrl(url) {
    try {
      const h = new URL(url).hostname.toLowerCase();
      if (h.includes("netflix")) return "netflix";
      if (h.includes("disney")) return "disney";
      if (h.includes("max")) return "max";
      if (h.includes("primevideo") || h.includes("amazon")) return "prime";
      if (h.includes("paramount")) return "paramount";
      if (h.includes("flow")) return "flow";
      if (h.includes("youtube")) return "youtube";
      return "generic";
    } catch {
      return "generic";
    }
  }

  function safeLine(x) {
    const s = String(x ?? "").replace(/\u0000/g, "").trim();
    if (!s) return "";
    return s.length > 300 ? (s.slice(0, 300) + "…") : s;
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
      lines.push("## Logs (opt-in)");
      lines.push("```");
      reporte.logs.forEach((l) => {
        const msg = (typeof l === "object" && l)
          ? (l.msg ?? JSON.stringify(l))
          : l;
        const line = safeLine(msg);
        if (line) lines.push(line);
      });
      lines.push("```");
    }

    return lines.join("\n");
  }

  function openGithubIssue(reporte) {
    const title = encodeURIComponent(`Bug: ${reporte.platform} — lectura de subtítulos`);
    const body = encodeURIComponent(buildIssueBody(reporte).slice(0, 7000));
    const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/new?title=${title}&body=${body}`;
    try {
      api.tabs.create({ url });
    } catch {
      // Silencioso
    }
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
      version: api.runtime.getManifest().version,
      modoNarrador: modoNarrador?.value || "desconocido",
      url: "",
      platform: "",
      ua: navigator.userAgent,
      logs: []
    };

    withActiveTab((tab) => {
      reporte.url = tab?.url || "(sin URL o pestaña no compatible)";
      reporte.platform = inferPlatformFromUrl(tab?.url || "");

      if (permitirEnvioLogs?.checked) {
        try {
          api.storage.local.get("kathLogs", (data) => {
            reporte.logs = (data?.kathLogs || []).slice(-100);
            openGithubIssue(reporte);
            if (reporteError) reporteError.value = "";
          });
        } catch {
          openGithubIssue(reporte);
          if (reporteError) reporteError.value = "";
        }
      } else {
        openGithubIssue(reporte);
        if (reporteError) reporteError.value = "";
      }
    });
  });
});
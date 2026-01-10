// ====================================================
// KathWare Media Player - popup.js
// - Cambios de settings -> storage + sendMessage(updateSettings)
// - Track list via content.js -> type:getTracks
// - Reporte -> abre GitHub Issue prellenado (repo: dragonmoon1522/KathWare-MediaPlayer)
// ====================================================

document.addEventListener("DOMContentLoaded", () => {
  const modoNarrador = document.getElementById("modoNarrador");
  const fuenteSub = document.getElementById("fuenteSub");
  const selectorTrack = document.getElementById("selectorTrack");

  const reporteError = document.getElementById("reporteError");
  const enviarReporte = document.getElementById("enviarReporte");
  const permitirEnvioLogs = document.getElementById("permitirEnvioLogs");

  const GITHUB_OWNER = "dragonmoon1522";
  const GITHUB_REPO = "KathWare-MediaPlayer";

  // === Helpers ===
  function withActiveTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      const tabId = tab?.id;
      if (!tabId) return;
      cb(tabId, tab);
    });
  }

  function notificarCambio() {
    withActiveTab((tabId) => {
      chrome.tabs.sendMessage(tabId, { action: "updateSettings" }, () => {
        // evita warnings en consola del popup si no hay content script
        void chrome.runtime.lastError;
      });
    });
  }

  // === Cargar valores guardados ===
  chrome.storage.local.get(["modoNarrador", "fuenteSub", "trackIndex"], (data) => {
    if (data.modoNarrador && modoNarrador) modoNarrador.value = data.modoNarrador;
    if (data.fuenteSub && fuenteSub) fuenteSub.value = data.fuenteSub;
    if (typeof data.trackIndex !== "undefined" && selectorTrack) selectorTrack.value = String(data.trackIndex);
  });

  // === Guardar configuraciones + notificar al content.js ===
  modoNarrador?.addEventListener("change", () => {
    chrome.storage.local.set({ modoNarrador: modoNarrador.value }, notificarCambio);
  });

  fuenteSub?.addEventListener("change", () => {
    chrome.storage.local.set({ fuenteSub: fuenteSub.value }, notificarCambio);
  });

  selectorTrack?.addEventListener("change", () => {
    const idx = parseInt(selectorTrack.value, 10);
    chrome.storage.local.set({ trackIndex: idx }, () => {
      notificarCambio();
      withActiveTab((tabId) => {
        chrome.tabs.sendMessage(tabId, { action: "setTrack", index: idx }, () => {
          void chrome.runtime.lastError;
        });
      });
    });
  });

  // === Obtener tracks desde content.js ===
  withActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, { type: "getTracks" }, (response) => {
      // si no hay content script, no rompemos el popup
      const err = chrome.runtime.lastError;
      if (err) {
        if (selectorTrack) {
          selectorTrack.innerHTML = "";
          const opt = document.createElement("option");
          opt.value = "0";
          opt.textContent = "Abrí un video y activá la extensión";
          selectorTrack.appendChild(opt);
          selectorTrack.disabled = true;
        }
        return;
      }

      const tracks = response?.tracks || [];
      if (!selectorTrack) return;

      selectorTrack.innerHTML = "";
      selectorTrack.disabled = !tracks.length;

      if (!tracks.length) {
        const opt = document.createElement("option");
        opt.value = "0";
        opt.textContent = "Sin pistas";
        selectorTrack.appendChild(opt);
        return;
      }

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

  // === Reporte -> GitHub Issue prellenado ===
  function inferPlatformFromUrl(url) {
    try {
      const h = new URL(url).hostname.toLowerCase();
      if (h.includes("netflix")) return "netflix";
      if (h.includes("disneyplus") || h.includes("disney")) return "disney";
      if (h.includes("hbomax") || h.includes("max.com") || h.includes("play.hbomax.com")) return "max";
      if (h.includes("youtube")) return "youtube";
      if (h.includes("primevideo") || h.includes("amazon")) return "prime";
      if (h.includes("paramountplus")) return "paramount";
      if (h.includes("flow.com.ar")) return "flow";
      return "generic";
    } catch {
      return "generic";
    }
  }

  function safeLogLine(l) {
    try {
      const ts = l.ts || "";
      const lvl = l.level || "";
      let msg = l.msg || "";
      if (!msg) msg = JSON.stringify(l);
      msg = String(msg).replace(/\s+/g, " ").trim();
      if (msg.length > 400) msg = msg.slice(0, 400) + "…";
      return `[${ts}] ${lvl}: ${msg}`;
    } catch {
      return "[log inválido]";
    }
  }

  function buildIssueBody(reporte) {
    const lines = [];
    lines.push("## Descripción");
    lines.push(reporte.mensaje);
    lines.push("");
    lines.push("## Info");
    lines.push(`- Fecha: ${reporte.fecha}`);
    lines.push(`- Versión: ${reporte.version || "(desconocida)"}`);
    lines.push(`- Plataforma: ${reporte.platform || "(desconocida)"}`);
    lines.push(`- URL: ${reporte.url || "(no disponible)"}`);
    lines.push(`- Modo narrador: ${reporte.modoNarrador || "(n/a)"}`);
    lines.push(`- Fuente subs: ${reporte.fuenteSub || "(n/a)"}`);
    lines.push(`- Track index: ${String(reporte.trackIndex ?? "(n/a)")}`);
    lines.push(`- Navegador/OS: ${reporte.ua || "(n/a)"}`);
    lines.push("");

    if (reporte.logs?.length) {
      lines.push("## Logs (últimos)");
      lines.push("```");
      for (const l of reporte.logs) lines.push(safeLogLine(l));
      lines.push("```");
    } else {
      lines.push("## Logs");
      lines.push("_El usuario no adjuntó logs._");
    }
    return lines.join("\n");
  }

  function openGithubIssue(reporte) {
    const short = (reporte.mensaje || "Problema").replace(/\s+/g, " ").trim().slice(0, 70);
    const title = encodeURIComponent(`Bug: ${reporte.platform || "sitio"} — ${short}`);
    const body = encodeURIComponent(buildIssueBody(reporte).slice(0, 7000)); // cap para URL
    const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/new?title=${title}&body=${body}`;
    chrome.tabs.create({ url });
  }

  enviarReporte?.addEventListener("click", () => {
    const mensaje = (reporteError?.value || "").trim();
    if (!mensaje) {
      alert("Por favor, escribí una descripción del problema.");
      return;
    }

    const reporte = {
      mensaje,
      fecha: new Date().toISOString(),
      version: chrome.runtime.getManifest().version || "",
      modoNarrador: modoNarrador?.value || "",
      fuenteSub: fuenteSub?.value || "",
      trackIndex: selectorTrack ? parseInt(selectorTrack.value, 10) : undefined,
      url: "",
      platform: "",
      ua: navigator.userAgent || ""
    };

    withActiveTab((tabId, tab) => {
      reporte.url = tab?.url || "";
      reporte.platform = inferPlatformFromUrl(reporte.url);

      if (permitirEnvioLogs?.checked) {
        chrome.storage.local.get("kathLogs", (data) => {
          reporte.logs = (data?.kathLogs || []).slice(-120);
          openGithubIssue(reporte);
          if (reporteError) reporteError.value = "";
        });
      } else {
        openGithubIssue(reporte);
        if (reporteError) reporteError.value = "";
      }
    });
  });
});

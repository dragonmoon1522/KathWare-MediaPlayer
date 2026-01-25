// ====================================================
// KathWare SubtitleReader - kwsr.platforms.js
// - Detección de plataforma por hostname
// - Labels amigables
// - Selectores VISUAL por plataforma (con fallback universal)
// - Capabilities:
//    - keepAlive: revelar controles que se esconden
//    - nonAccessibleFixes: autolabel + menús audio/subs
//    - visualDocObserver: visual engine observa documentElement (mejor para DOM que se recrea)
// - Debug:
//    - CFG.debugVisual: habilita selectores "agresivos" y logs extra desde visual.js
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.platforms) return;

  function host() {
    return (location.hostname || "").toLowerCase();
  }

  function getPlatform() {
    const h = host();

    // --- Streaming / Video ---
    if (h.includes("netflix")) return "netflix";
    if (h.includes("disneyplus") || h === "www.disneyplus.com" || h.includes("disney")) return "disney";
    if (h === "max.com" || h.endsWith(".max.com") || h.includes("play.hbomax.com") || h.includes("hbomax")) return "max";
    if (h.includes("youtube") || h.includes("youtu.be")) return "youtube";
    if (h.includes("primevideo.com")) return "prime";
    if (h.includes("paramountplus")) return "paramount";
    if (h.includes("hulu")) return "hulu";
    if (h.includes("peacocktv")) return "peacock";
    if (h.includes("crunchyroll")) return "crunchyroll";
    if (h.includes("tv.apple.com")) return "appletv";
    if (h.includes("mubi")) return "mubi";
    if (h.includes("pluto.tv")) return "plutotv";
    if (h.includes("tubi.tv")) return "tubi";
    if (h.includes("viki.com")) return "viki";
    if (h.includes("dailymotion")) return "dailymotion";
    if (h.includes("vimeo")) return "vimeo";
    if (h.includes("twitch")) return "twitch";
    if (h.includes("flow.com.ar")) return "flow";

    // --- Meetings / Collaboration (para el futuro) ---
    if (h.includes("teams.microsoft") || h.includes("teams.live") || h.includes("teams.microsoft.com")) return "teams_web";
    if (h.includes("zoom.us")) return "zoom_web";
    if (h.includes("meet.google.com")) return "google_meet";

    return "generic";
  }

  function platformLabel(p) {
    return ({
      netflix: "Netflix",
      disney: "Disney+",
      max: "Max",
      youtube: "YouTube",
      prime: "Prime Video",
      paramount: "Paramount+",
      hulu: "Hulu",
      peacock: "Peacock",
      crunchyroll: "Crunchyroll",
      appletv: "Apple TV",
      mubi: "MUBI",
      plutotv: "Pluto TV",
      tubi: "Tubi",
      viki: "Viki",
      dailymotion: "Dailymotion",
      vimeo: "Vimeo",
      twitch: "Twitch",
      flow: "Flow",
      teams_web: "Microsoft Teams (Web)",
      zoom_web: "Zoom (Web)",
      google_meet: "Google Meet",
      generic: "Sitio"
    })[p] || "Sitio";
  }

  // Capabilities por plataforma
  function platformCapabilities(p) {
    const caps = {
      keepAlive: false,
      nonAccessibleFixes: false,
      visualDocObserver: false
    };

    // Plataformas donde el DOM de captions/control se recrea mucho → conviene observar documentElement
    if (p === "disney" || p === "netflix" || p === "max" || p === "prime" || p === "paramount" || p === "hulu" || p === "peacock" || p === "twitch") {
      caps.visualDocObserver = true;
    }

    if (p === "netflix" || p === "max" || p === "disney" || p === "prime" || p === "paramount" || p === "hulu" || p === "peacock") {
      caps.keepAlive = true;
    }

    if (p === "flow") {
      caps.keepAlive = true;
      caps.nonAccessibleFixes = true;
      caps.visualDocObserver = true;
    }

    if (p === "twitch") {
      caps.keepAlive = true;
      caps.nonAccessibleFixes = true;
      caps.visualDocObserver = true;
    }

    return caps;
  }

  // -------------------- Selectores universales (fallback) --------------------
  // Estos son "agresivos" pero filtrables por visual.js (noise filter + menus).
  // Se usan SIEMPRE al final, y antes si CFG.debugVisual===true.
  function universalVisualSelectors() {
    return [
      // ARIA / roles típicos de captions
      "[aria-live='polite']",
      "[aria-live='assertive']",
      "[role='status']",
      "[role='log']",

      // Clases genéricas (muchas plataformas usan substring)
      "[class*='subtitle']",
      "[class*='subtitles']",
      "[class*='caption']",
      "[class*='captions']",
      "[class*='timedtext']",
      "[class*='timed-text']",
      "[class*='texttrack']",
      "[class*='text-track']",
      "[class*='cc']",

      // data-testid genérico
      "[data-testid*='subtitle']",
      "[data-testid*='caption']",
      "[data-testid*='timed']"
    ];
  }

  // -------------------- Selectores por plataforma --------------------
  function platformSelectors(p) {
    const debugVisual = !!KWSR?.CFG?.debugVisual;

    // Insert helper: si debugVisual, ponemos universales arriba también
    const addDebugHead = (arr) => debugVisual ? [...universalVisualSelectors(), ...arr] : arr;
    const addUniversalTail = (arr) => [...arr, ...universalVisualSelectors()];

    if (p === "flow") {
      return addUniversalTail(addDebugHead([
        ".theoplayer-ttml-texttrack-",
        ".theoplayer-texttracks",
        ".theoplayer-texttracks *",
        "p span",
        "p br"
      ]));
    }

    if (p === "max") {
      return addUniversalTail(addDebugHead([
        // Estructura real que pegaste
        "[data-testid='cueBoxRowTextCue']",
        "[data-testid*='cueBoxRowTextCue']",
        "[class*='CaptionWindow'] [data-testid*='cueBoxRowTextCue']",
        "[class*='TextCue']"
      ]));
    }

    if (p === "netflix") {
      return addUniversalTail(addDebugHead([
        ".player-timedtext-text-container",
        ".player-timedtext",
        "span.player-timedtext-text",
        // Netflix suele tener wrappers que cambian; data-uia a veces salva
        "div[data-uia*='subtitle']",
        "div[data-uia*='captions']",
        // algunos builds meten “timedText” en otros contenedores
        "[class*='timedtext']",
        "[class*='timedText']"
      ]));
    }

    if (p === "disney") {
      return addUniversalTail(addDebugHead([
        // Winner real-world: líneas hive
        ".hive-subtitle-renderer-line",
        "[class*='hive-subtitle-renderer-line']",
        "[class*='hive-subtitle']",
        "[class*='hiveSubtitle']"
      ]));
    }

    if (p === "youtube") {
      return addUniversalTail(addDebugHead([
        ".ytp-caption-segment",
        ".captions-text .caption-visual-line",
        ".ytp-caption-window-container",
        ".caption-window"
      ]));
    }

    if (p === "prime") {
      return addUniversalTail(addDebugHead([
        "[class*='atvwebplayersdk-captions']",
        "[class*='atvwebplayersdk-texttrack']",
        "[class*='captions']",
        "[class*='subtitle']",
        "[data-testid*='subtitle']"
      ]));
    }

    if (p === "paramount") {
      return addUniversalTail(addDebugHead([
        "[class*='caption']",
        "[class*='subtitles']",
        "[class*='subtitle']"
      ]));
    }

    if (p === "crunchyroll") {
      return addUniversalTail(addDebugHead([
        "[class*='subtitle']",
        "[class*='subtitles']",
        "[class*='caption']",
        "[class*='captions']"
      ]));
    }

    if (p === "appletv") {
      return addUniversalTail(addDebugHead([
        "[class*='caption']",
        "[class*='subtitles']",
        "[class*='subtitle']"
      ]));
    }

    if (p === "twitch") {
      return addUniversalTail(addDebugHead([
        "[class*='captions']",
        "[class*='subtitle']",
        "[class*='caption']"
      ]));
    }

    if (p === "dailymotion" || p === "vimeo" || p === "mubi" || p === "plutotv" || p === "tubi" || p === "viki" || p === "hulu" || p === "peacock") {
      return addUniversalTail(addDebugHead([
        ".plyr__caption",
        ".flirc-caption"
      ]));
    }

    if (p === "teams_web" || p === "zoom_web" || p === "google_meet") {
      return addUniversalTail(addDebugHead([
        "[aria-live='polite']",
        "[role='status']",
        "[role='log']"
      ]));
    }

    return addUniversalTail(addDebugHead([
      ".plyr__caption",
      ".flirc-caption"
    ]));
  }

  KWSR.platforms = {
    getPlatform,
    platformLabel,
    platformCapabilities,
    platformSelectors,
    // export útil para debug / inspección
    universalVisualSelectors
  };
})();

// ====================================================
// KathWare SubtitleReader - kwsr.platforms.js
// - Detección de plataforma por hostname
// - Labels amigables
// - Selectores VISUAL por plataforma
// - Capabilities:
//    - keepAlive: revelar controles que se esconden
//    - nonAccessibleFixes: autolabel + menús audio/subs (adapter nonAccessiblePlatforms)
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

    // Apple TV: mejor ser estrictos para no matchear cualquier apple.com
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
    // Ojo: microsoft.com es demasiado broad; lo recortamos a dominios típicos de Teams web.
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
    const caps = { keepAlive: false, nonAccessibleFixes: false };

    if (p === "netflix" || p === "max" || p === "disney" || p === "prime" || p === "paramount" || p === "hulu" || p === "peacock") {
      caps.keepAlive = true;
    }

    if (p === "flow") {
      caps.keepAlive = true;
      caps.nonAccessibleFixes = true;
    }

    if (p === "twitch") {
      caps.keepAlive = true;
      caps.nonAccessibleFixes = true;
    }

    return caps;
  }

  // Selectores VISUAL por plataforma
  function platformSelectors(p) {
    if (p === "flow") {
      return [
        ".theoplayer-ttml-texttrack-",
        ".theoplayer-texttracks",
        ".theoplayer-texttracks *"
      ];
    }

    if (p === "max") {
      return [
        "[data-testid='cueBoxRowTextCue']",
        "[data-testid*='cueBoxRowTextCue']",
        "[class*='TextCue']"
      ];
    }

    if (p === "netflix") {
      return [
        ".player-timedtext-text-container",
        ".player-timedtext",
        "span.player-timedtext-text",
        "div[data-uia*='subtitle']",
        "div[data-uia*='captions']"
      ];
    }

    if (p === "disney") {
      return [
        // ✅ Disney real-world winner (líneas)
        ".hive-subtitle-renderer-line",
        // ✅ por si mañana cambia nombre de clase pero queda el wrapper
        "[class*='hive-subtitle']",

        // fallbacks genéricos
        "[class*='subtitle']",
        "[class*='subtitles']",
        "[class*='caption']",
        "[class*='captions']",
        "[class*='timedText']",
        "[class*='timed-text']",
        "[data-testid*='subtitle']",
        "[data-testid*='caption']",
        "[aria-label*='Subt']",
        "[aria-live='polite']",
        "[role='status']"
      ];
    }

    if (p === "youtube") {
      return [
        ".ytp-caption-segment",
        ".captions-text .caption-visual-line",
        ".ytp-caption-window-container"
      ];
    }

    if (p === "prime") {
      return [
        "[class*='atvwebplayersdk-captions']",
        "[class*='captions']",
        "[class*='subtitle']",
        "[data-testid*='subtitle']",
        "[aria-live='polite']",
        "[role='status']"
      ];
    }

    if (p === "paramount") {
      return [
        "[class*='caption']",
        "[class*='subtitles']",
        "[class*='subtitle']",
        "[aria-live='polite']",
        "[role='status']"
      ];
    }

    if (p === "crunchyroll") {
      return [
        "[class*='subtitle']",
        "[class*='subtitles']",
        "[class*='caption']",
        "[class*='captions']",
        "[aria-live='polite']",
        "[role='status']"
      ];
    }

    if (p === "appletv") {
      return [
        "[class*='caption']",
        "[class*='subtitles']",
        "[class*='subtitle']",
        "[aria-live='polite']",
        "[role='status']"
      ];
    }

    if (p === "twitch") {
      return [
        "[class*='captions']",
        "[class*='subtitle']",
        "[class*='caption']",
        "[aria-live='polite']",
        "[role='status']"
      ];
    }

    if (p === "dailymotion" || p === "vimeo" || p === "mubi" || p === "plutotv" || p === "tubi" || p === "viki" || p === "hulu" || p === "peacock") {
      return [
        ".plyr__caption",
        ".flirc-caption",
        "[class*='subtitle']",
        "[class*='caption']",
        "[class*='cc']",
        "[aria-live='polite']",
        "[role='status']"
      ];
    }

    if (p === "teams_web" || p === "zoom_web" || p === "google_meet") {
      return [
        "[aria-live='polite']",
        "[role='status']",
        "[role='log']"
      ];
    }

    return [
      ".plyr__caption",
      ".flirc-caption",
      "[class*='subtitle']",
      "[class*='caption']",
      "[class*='cc']",
      "[aria-live='polite']",
      "[role='status']"
    ];
  }

  KWSR.platforms = {
    getPlatform,
    platformLabel,
    platformCapabilities,
    platformSelectors
  };
})();

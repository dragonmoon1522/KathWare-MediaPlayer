// ====================================================
// KathWare SubtitleReader - kwsr.platforms.js
// - Detección de plataforma por hostname
// - Labels amigables
// - Selectores VISUAL por plataforma
// - Capabilities:
//    - keepAlive
//    - nonAccessibleFixes
//    - visualDocObserver (solo donde hace falta, ej Disney)
//    - freezeWhenTimeNotMoving (Netflix: evita loop cuando está pausado/idle)
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.platforms) return;

  function host() { return (location.hostname || "").toLowerCase(); }

  function getPlatform() {
    const h = host();
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

  function platformCapabilities(p) {
    const caps = {
      keepAlive: false,
      nonAccessibleFixes: false,
      visualDocObserver: false,
      freezeWhenTimeNotMoving: false
    };

    if (["netflix","max","disney","prime","paramount","hulu","peacock"].includes(p)) {
      caps.keepAlive = true;
    }

    if (p === "flow" || p === "twitch") {
      caps.keepAlive = true;
      caps.nonAccessibleFixes = true;
    }

    // Disney recrea DOM a lo bestia → doc observer ayuda
    if (p === "disney") caps.visualDocObserver = true;

    // Netflix puede mutar captions aun pausado → congelar si el tiempo no avanza
    if (p === "netflix") caps.freezeWhenTimeNotMoving = true;

    return caps;
  }

  function platformSelectors(p) {
    if (p === "flow") return [".theoplayer-ttml-texttrack-", ".theoplayer-texttracks", ".theoplayer-texttracks *"];

    if (p === "max") return ["[data-testid='cueBoxRowTextCue']", "[data-testid*='cueBoxRowTextCue']", "[class*='TextCue']"];

    if (p === "netflix") {
      // 👇 más “leafy”: buscamos los spans del timedtext, no contenedores gigantes
      return [
        ".player-timedtext-text-container span",
        ".player-timedtext span",
        "span.player-timedtext-text",
        "div[data-uia*='subtitle'] span",
        "div[data-uia*='captions'] span"
      ];
    }

    if (p === "disney") {
      return [
        ".hive-subtitle-renderer-line",
        "[class*='hive-subtitle']",
        "[class*='subtitle']",
        "[class*='caption']",
        "[aria-live='polite']",
        "[role='status']"
      ];
    }

    if (p === "youtube") return [".ytp-caption-segment", ".captions-text .caption-visual-line", ".ytp-caption-window-container"];

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

  KWSR.platforms = { getPlatform, platformLabel, platformCapabilities, platformSelectors };
})();

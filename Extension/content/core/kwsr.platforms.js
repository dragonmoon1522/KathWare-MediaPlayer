// ----------------------------------------------------
// KathWare SubtitleReader - kwsr.platforms.js
// ----------------------------------------------------
//
// QUÉ HACE ESTE MÓDULO
// -------------------
// Este archivo NO lee subtítulos ni crea UI.
// Solo describe el “mapa del mundo” donde corre la extensión.
//
// Concretamente hace 4 cosas:
//
// 1) Detecta en qué plataforma estamos (según hostname).
// 2) Devuelve un nombre amigable para mostrar al usuario.
// 3) Define “capacidades” por plataforma (flags).
// 4) Define selectores CSS para lectura VISUAL.
//
// CONCEPTO CLAVE
// --------------
// - TRACK  = leer pistas del <video> (video.textTracks).
// - VISUAL = leer texto renderizado en pantalla (DOM).
//
// Este módulo NO decide qué usar:
// solo informa al pipeline.
// ----------------------------------------------------

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.platforms) return;

  // --------------------------------------------------
  // Hostname normalizado
  // --------------------------------------------------
  function host() {
    return (location.hostname || "").toLowerCase();
  }

  // --------------------------------------------------
  // getPlatform()
  // --------------------------------------------------
  // Determina la plataforma a partir del hostname.
  //
  // Nota de diseño:
  // - Acá solo listamos plataformas de streaming / video.
  // - No mezclamos “apps”, “noticias”, etc.
  // --------------------------------------------------
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

    return "generic";
  }

  // --------------------------------------------------
  // platformLabel()
  // --------------------------------------------------
  // Nombre “humano” para mostrar en UI, logs y toasts.
  // --------------------------------------------------
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
      generic: "Sitio"
    })[p] || "Sitio";
  }

  // --------------------------------------------------
  // platformCapabilities()
  // --------------------------------------------------
  // “Interruptores” por plataforma.
  //
  // IMPORTANTE:
  // - Esto NO ejecuta lógica.
  // - Solo informa al pipeline qué ayudas conviene activar.
  //
  // Capabilities:
  // - keepAlive: simular interacción para mostrar controles.
  // - nonAccessibleFixes: agregar aria-label/roles/tabindex.
  // - visualDocObserver: observar documentElement (DOM volátil).
  // - freezeWhenTimeNotMoving: evitar loops cuando el tiempo no avanza.
  // --------------------------------------------------
  function platformCapabilities(p) {
    const caps = {
      keepAlive: false,
      nonAccessibleFixes: false,
      visualDocObserver: false,
      freezeWhenTimeNotMoving: false
    };

    // Controles que se esconden al mirar video
    if (["netflix", "max", "disney", "prime", "paramount", "hulu", "peacock"].includes(p)) {
      caps.keepAlive = true;
    }

    // Plataformas con UI poco accesible
    if (p === "flow" || p === "twitch") {
      caps.keepAlive = true;
      caps.nonAccessibleFixes = true;
    }

    // DOM extremadamente dinámico
    if (p === "disney") {
      caps.visualDocObserver = true;
    }

    // Renderizan captions aun con tiempo “quieto”
    if (p === "netflix" || p === "max") {
      caps.freezeWhenTimeNotMoving = true;
    }

    return caps;
  }

  // --------------------------------------------------
  // platformSelectors()
  // --------------------------------------------------
  // Lista de selectores CSS para lectura VISUAL.
  //
  // Regla de oro:
  // - Preferir nodos “hoja” (texto real).
  // - Evitar contenedores gigantes o "*".
  // - Menos ruido = menos duplicados.
  // --------------------------------------------------
  function platformSelectors(p) {

    // ------------------------------
    // Flow (THEOplayer)
    // ------------------------------
    if (p === "flow") {
      return [
        ".theoplayer-texttracks .theoplayer-texttrack-cue",
        ".theoplayer-texttracks .theoplayer-texttrack-line",
        ".theoplayer-texttracks [class*='texttrack'] [class*='cue']",
        ".theoplayer-texttracks [class*='ttml'] [class*='cue']",
        ".theoplayer-texttracks span",
        ".theoplayer-texttracks div span"
      ];
    }

    // ------------------------------
    // Max
    // ------------------------------
    if (p === "max") {
      return [
        "[data-testid='cueBoxRowTextCue']",
        "[data-testid*='cueBoxRowTextCue']",
        "[data-testid*='TextCue']",
        "[class*='cueBox'] [class*='TextCue']",
        "[class*='TextCue'] span",
        "[class*='caption'] span",
        "[class*='subtitle'] span"
      ];
    }

    // ------------------------------
    // Netflix
    // ------------------------------
    if (p === "netflix") {
      return [
        ".player-timedtext-text-container span",
        ".player-timedtext span",
        "span.player-timedtext-text",
        "[data-uia*='subtitle'] span",
        "[data-uia*='captions'] span",
        "[class*='timedtext'] span"
      ];
    }

    // ------------------------------
    // Disney+
    // ------------------------------
    if (p === "disney") {
      return [
        ".hive-subtitle-renderer-line",
        "[class*='hive-subtitle']",
        "[class*='subtitle']",
        "[class*='caption']"
      ];
    }

    // ------------------------------
    // YouTube
    // ------------------------------
    if (p === "youtube") {
      return [
        ".ytp-caption-segment",
        ".captions-text .caption-visual-line .ytp-caption-segment",
        ".captions-text .caption-visual-line"
      ];
    }

    // ------------------------------
    // Genérico (último recurso)
    // ------------------------------
    return [
      ".plyr__captions .plyr__caption",
      ".plyr__captions span",
      "[class*='subtitle'] span",
      "[class*='caption'] span",
      "[class*='cc'] span",
      "[class*='subtitle']",
      "[class*='caption']"
    ];
  }

  // --------------------------------------------------
  // EXPORT
  // --------------------------------------------------
  KWSR.platforms = {
    getPlatform,
    platformLabel,
    platformCapabilities,
    platformSelectors
  };

})();
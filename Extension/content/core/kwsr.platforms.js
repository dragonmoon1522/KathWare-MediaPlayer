// ====================================================
// KathWare SubtitleReader - kwsr.platforms.js
// ====================================================
//
// Este módulo hace 4 cosas:
//
// 1) Detecta en qué plataforma estamos (por hostname).
// 2) Devuelve un nombre "lindo" para mostrarle al usuario (label).
// 3) Define "capacidades" (capabilities) por plataforma.
// 4) Define selectores VISUAL (cómo buscar subtítulos visibles en el DOM).
//
// IMPORTANTE (concepto):
// - "VISUAL" = leer texto que aparece en pantalla (captions renderizados en HTML).
// - "TRACK"  = leer pistas de subtítulos del video (video.textTracks).
//
// Capabilities (en español):
// - keepAlive: algunas plataformas esconden controles; simulamos mousemove para que aparezcan.
// - nonAccessibleFixes: plataformas donde los controles son íconos sin etiquetas;
//   les agregamos aria-label/role/tabindex dinámicamente.
// - visualDocObserver: hay sitios que reconstruyen todo el DOM; observar documentElement ayuda.
// - freezeWhenTimeNotMoving: algunos sitios mutan captions aun pausado o con time “quieto”.
//   Esto se usa como señal en el engine para evitar loops/repetición.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.platforms) return;

  // Devuelve hostname normalizado (minúsculas)
  function host() {
    return (location.hostname || "").toLowerCase();
  }

  // ------------------------------------------------------------
  // getPlatform():
  // Determina la plataforma según el hostname.
  // Nota: acá solo dejamos STREAMING (como acordamos).
  // ------------------------------------------------------------
  function getPlatform() {
    const h = host();

    // Netflix
    if (h.includes("netflix")) return "netflix";

    // Disney+
    if (h.includes("disneyplus") || h === "www.disneyplus.com" || h.includes("disney")) return "disney";

    // Max (HBO Max / max.com)
    if (h === "max.com" || h.endsWith(".max.com") || h.includes("play.hbomax.com") || h.includes("hbomax")) return "max";

    // YouTube
    if (h.includes("youtube") || h.includes("youtu.be")) return "youtube";

    // Prime Video
    if (h.includes("primevideo.com")) return "prime";

    // Paramount+
    if (h.includes("paramountplus")) return "paramount";

    // Hulu / Peacock
    if (h.includes("hulu")) return "hulu";
    if (h.includes("peacocktv")) return "peacock";

    // Crunchyroll / Apple TV / MUBI / Pluto / Tubi / Viki
    if (h.includes("crunchyroll")) return "crunchyroll";
    if (h.includes("tv.apple.com")) return "appletv";
    if (h.includes("mubi")) return "mubi";
    if (h.includes("pluto.tv")) return "plutotv";
    if (h.includes("tubi.tv")) return "tubi";
    if (h.includes("viki.com")) return "viki";

    // Otros players de video populares
    if (h.includes("dailymotion")) return "dailymotion";
    if (h.includes("vimeo")) return "vimeo";
    if (h.includes("twitch")) return "twitch";

    // Flow (Argentina)
    if (h.includes("flow.com.ar")) return "flow";

    return "generic";
  }

  // ------------------------------------------------------------
  // platformLabel():
  // Nombre amigable para UI/logs.
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // platformCapabilities():
  // "Interruptores" por plataforma.
  //
  // Esto NO hace nada por sí mismo: solo informa al resto del código
  // si conviene activar ciertas ayudas.
  // ------------------------------------------------------------
  function platformCapabilities(p) {
    // Defaults seguros: todo apagado
    const caps = {
      keepAlive: false,
      nonAccessibleFixes: false,
      visualDocObserver: false,
      freezeWhenTimeNotMoving: false
    };

    // keepAlive:
    // Streaming clásico suele ocultar controles mientras mirás.
    if (["netflix", "max", "disney", "prime", "paramount", "hulu", "peacock"].includes(p)) {
      caps.keepAlive = true;
    }

    // nonAccessibleFixes:
    // Flow suele tener controles icon-only y menús que “ensucian” visual.
    // Twitch también a veces.
    if (p === "flow" || p === "twitch") {
      caps.keepAlive = true;
      caps.nonAccessibleFixes = true;
    }

    // visualDocObserver:
    // Disney suele rearmar DOM.
    // Netflix/Max también pueden hacerlo, pero en general con body alcanza.
    // (Si ves que Netflix “pierde” captions tras overlays, lo activamos también.)
    if (p === "disney") {
      caps.visualDocObserver = true;
    }

    // freezeWhenTimeNotMoving:
    // Netflix y Max re-renderizan captions incluso con time casi quieto.
    // Esto ayuda al engine a cortar loops/repetición.
    if (p === "netflix" || p === "max") {
      caps.freezeWhenTimeNotMoving = true;
    }

    return caps;
  }

  // ------------------------------------------------------------
  // platformSelectors():
  // Lista de selectores CSS para VISUAL.
  //
  // Regla de oro:
  // - Preferimos “hojas” (spans del texto) o “líneas” de captions.
  // - Evitamos contenedores gigantes o "*" porque mete ruido.
  // ------------------------------------------------------------
  function platformSelectors(p) {
    // ----------------------------------------------------------
    // Flow (THEOplayer)
    // ----------------------------------------------------------
    // Problema típico:
    // - THEOplayer puede renderizar captions como:
    //   - contenedores "texttracks"/"ttml" y spans internos
    // - Si usamos "*" nos tragamos UI.
    // Estrategia:
    // - apuntar a capas/lines de captions, y luego a spans dentro.
    if (p === "flow") {
      return [
        // THEOplayer captions layers/lines (comunes)
        ".theoplayer-texttracks .theoplayer-texttrack-cue",
        ".theoplayer-texttracks .theoplayer-texttrack-line",
        ".theoplayer-texttracks [class*='texttrack'] [class*='cue']",
        ".theoplayer-texttracks [class*='ttml'] [class*='cue']",
        // fallback: spans dentro de texttracks (sin usar * global)
        ".theoplayer-texttracks span",
        ".theoplayer-texttracks div span"
      ];
    }

    // ----------------------------------------------------------
    // Max
    // ----------------------------------------------------------
    // Problema típico:
    // - UI cambia y los testid varían, pero suelen contener "cue" / "TextCue"
    // Estrategia:
    // - empezar por data-testid, luego fallbacks por cue/textcue
    if (p === "max") {
      return [
        "[data-testid='cueBoxRowTextCue']",
        "[data-testid*='cueBoxRowTextCue']",
        "[data-testid*='TextCue']",
        "[class*='cueBox'] [class*='TextCue']",
        "[class*='TextCue'] span",
        // fallback más genérico pero todavía “caption-ish”
        "[class*='caption'] span",
        "[class*='subtitle'] span"
      ];
    }

    // ----------------------------------------------------------
    // Netflix
    // ----------------------------------------------------------
    // Problema típico:
    // - re-render fuerte: mismo texto, nodos nuevos
    // Estrategia:
    // - apuntar a timedtext spans (texto), con varios caminos
    // - evitar contenedores gigantes (menos ruido, menos duplicados)
    if (p === "netflix") {
      return [
        // El clásico
        ".player-timedtext-text-container span",
        // Variantes
        ".player-timedtext span",
        "span.player-timedtext-text",
        // data-uia (Netflix usa mucho esto)
        "[data-uia*='subtitle'] span",
        "[data-uia*='captions'] span",
        // fallback moderado
        "[class*='timedtext'] span"
      ];
    }

    // ----------------------------------------------------------
    // Disney
    // ----------------------------------------------------------
    if (p === "disney") {
      return [
        ".hive-subtitle-renderer-line",
        "[class*='hive-subtitle']",
        "[class*='subtitle']",
        "[class*='caption']"
        // OJO: NO metemos aria-live/role=status acá por defecto,
        // porque aumenta el riesgo de leer menús/tooltips.
        // Si alguna vez Disney cambia y no hay nada, lo re-agregamos.
      ];
    }

    // ----------------------------------------------------------
    // YouTube
    // ----------------------------------------------------------
    if (p === "youtube") {
      return [
        ".ytp-caption-segment",
        ".captions-text .caption-visual-line .ytp-caption-segment",
        ".captions-text .caption-visual-line"
      ];
    }

    // ----------------------------------------------------------
    // Genérico (amplio espectro, pero sin volvernos locos)
    // ----------------------------------------------------------
    return [
      ".plyr__captions .plyr__caption",
      ".plyr__captions span",
      "[class*='subtitle'] span",
      "[class*='caption'] span",
      "[class*='cc'] span",
      // fallback final (con riesgo):
      "[class*='subtitle']",
      "[class*='caption']"
    ];
  }

  // Exponemos el módulo
  KWSR.platforms = {
    getPlatform,
    platformLabel,
    platformCapabilities,
    platformSelectors
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Flow: se eliminaron selectores demasiado amplios ("*") y el selector "cortado".
    Ahora apuntamos a cues/lines/spans dentro de .theoplayer-texttracks.
  - Max: se amplió cobertura de cues (data-testid + TextCue + fallbacks de captions).
  - Netflix: se agregaron fallbacks moderados y se evitó apuntar a contenedores gigantes.
  - Disney: se quitaron aria-live/role=status del listado (ruido alto); se prioriza hive/subtitle/caption.
  - Capabilities: freezeWhenTimeNotMoving ahora también para Max.
  */
})();

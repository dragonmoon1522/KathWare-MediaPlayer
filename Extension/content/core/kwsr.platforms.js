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
// - freezeWhenTimeNotMoving: algunos sitios cambian captions aun pausado; se evita loop.
//   (Ojo: esto se usa en el engine, no en este archivo).
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

    // Hulu / Peacock (no las probamos, pero son streaming)
    if (h.includes("hulu")) return "hulu";
    if (h.includes("peacocktv")) return "peacock";

    // Crunchyroll / Apple TV / MUBI / Pluto / Tubi / Viki
    if (h.includes("crunchyroll")) return "crunchyroll";
    if (h.includes("tv.apple.com")) return "appletv";
    if (h.includes("mubi")) return "mubi";
    if (h.includes("pluto.tv")) return "plutotv";
    if (h.includes("tubi.tv")) return "tubi";
    if (h.includes("viki.com")) return "viki";

    // Otros player de video populares
    if (h.includes("dailymotion")) return "dailymotion";
    if (h.includes("vimeo")) return "vimeo";
    if (h.includes("twitch")) return "twitch";

    // Flow (Argentina)
    if (h.includes("flow.com.ar")) return "flow";

    // Si no matchea nada: "sitio genérico con video"
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
    // Esto nos permite "despertar" controles (mousemove artificial).
    if (["netflix", "max", "disney", "prime", "paramount", "hulu", "peacock"].includes(p)) {
      caps.keepAlive = true;
    }

    // nonAccessibleFixes:
    // Plataformas donde detectamos controles poco accesibles o menús mal etiquetados.
    // (Ej: Flow. También Twitch a veces tiene botones icon-only sin label.)
    if (p === "flow" || p === "twitch") {
      caps.keepAlive = true;
      caps.nonAccessibleFixes = true;
    }

    // visualDocObserver:
    // Disney suele rearmar el DOM en cambios de escena / overlays.
    // Observar documentElement ayuda a no perdernos mutaciones.
    if (p === "disney") {
      caps.visualDocObserver = true;
    }

    // freezeWhenTimeNotMoving:
    // Netflix puede "mutar" captions incluso pausado (según implementación),
    // y eso puede generar loops/repetición si el engine no lo maneja.
    // (El engine decide cómo usar esto.)
    if (p === "netflix") {
      caps.freezeWhenTimeNotMoving = true;
    }

    return caps;
  }

  // ------------------------------------------------------------
  // platformSelectors():
  // Lista de selectores CSS para VISUAL.
  //
  // Idea:
  // - probamos selectores en orden
  // - elegimos el primero que devuelva texto usable
  //
  // Nota:
  // - Cada plataforma renderiza captions distinto.
  // - En genérico mantenemos una lista “de amplio espectro”.
  // ------------------------------------------------------------
  function platformSelectors(p) {
    // Flow (Theoplayer)
    if (p === "flow") {
      return [
        ".theoplayer-ttml-texttrack-",
        ".theoplayer-texttracks",
        ".theoplayer-texttracks *"
      ];
    }

    // Max: data-testid típico de captions (varía por UI)
    if (p === "max") {
      return [
        "[data-testid='cueBoxRowTextCue']",
        "[data-testid*='cueBoxRowTextCue']",
        "[class*='TextCue']"
      ];
    }

    // Netflix:
    // Nota: Netflix cambia MUCHO el DOM; preferimos “hojas” (spans del texto),
    // no contenedores gigantes (que podrían incluir menús / overlays).
    if (p === "netflix") {
      return [
        ".player-timedtext-text-container span",
        ".player-timedtext span",
        "span.player-timedtext-text",
        "div[data-uia*='subtitle'] span",
        "div[data-uia*='captions'] span"
      ];
    }

    // Disney:
    // hive-subtitle-renderer-line es el más directo cuando existe.
    // luego caemos a heurísticas más genéricas.
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

    // YouTube
    if (p === "youtube") {
      return [
        ".ytp-caption-segment",
        ".captions-text .caption-visual-line",
        ".ytp-caption-window-container"
      ];
    }

    // Genérico:
    // Esto intenta cubrir players comunes.
    // OJO: cuanto más genérico, más riesgo de “ruido”.
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

  // Exponemos el módulo
  KWSR.platforms = {
    getPlatform,
    platformLabel,
    platformCapabilities,
    platformSelectors
  };

})();

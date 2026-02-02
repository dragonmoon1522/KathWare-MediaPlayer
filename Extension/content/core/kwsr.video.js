// -----------------------------------------------------------------------------
// KathWare SubtitleReader - kwsr.video.js
// -----------------------------------------------------------------------------
//
// OBJETIVO
// --------
// Este módulo NO lee subtítulos.
// Solo encuentra y elige el <video> “principal” de la página.
//
// ¿Para qué lo necesitamos?
// - Para que el motor sepa a qué video engancharse (TRACK).
// - Para que VISUAL busque subtítulos cerca del reproductor.
// - Para que el overlay controle play/pause/seek/volumen.
//
// Nota sobre Shadow DOM:
// - Intentamos entrar en shadowRoot cuando existe.
// - Si el Shadow DOM es “closed”, no se puede acceder (y está bien).
// -----------------------------------------------------------------------------

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.video) return;

  // ---------------------------------------------------------------------------
  // findVideosRecursively(root, out)
  // ---------------------------------------------------------------------------
  // Recorre el DOM (y Shadow DOM accesible) y acumula todos los <video>.
  //
  // Parámetros:
  // - root: nodo raíz desde el cual buscar (por defecto: document)
  // - out: Set donde guardamos videos sin duplicados
  //
  // Importante:
  // - Esto es “best effort”: si algo falla, lo ignoramos para no romper la web.
  // - Ojo: root.querySelectorAll("*") puede ser pesado en páginas enormes,
  //   pero lo usamos porque muchas plataformas meten el video en sombras.
  // ---------------------------------------------------------------------------
  function findVideosRecursively(root = document, out = new Set()) {
    try {
      // 1) Videos normales dentro del root
      root.querySelectorAll("video").forEach(v => out.add(v));

      // 2) Intentar atravesar shadowRoot cuando existe
      root.querySelectorAll("*").forEach(el => {
        try {
          if (el && el.shadowRoot) findVideosRecursively(el.shadowRoot, out);
        } catch {
          // Shadow inaccesible o error -> ignoramos
        }
      });
    } catch {
      // Si el root no soporta querySelectorAll o algo raro pasa, no rompemos.
    }

    return Array.from(out);
  }

  // ---------------------------------------------------------------------------
  // isInOurUI(video)
  // ---------------------------------------------------------------------------
  // Evita elegir un <video> que esté dentro de nuestra UI (overlay/toast/etc).
  //
  // Hoy no ponemos videos en la UI, pero esta guarda es sana:
  // - previene futuros bugs
  // - evita casos raros de embeds o previews internos
  // ---------------------------------------------------------------------------
  function isInOurUI(v) {
    try {
      return !!v.closest?.(
        "#kathware-overlay-root," +
        "#kathware-overlay-panel," +
        "#kw-toast," +
        "#kwsr-live-region," +
        "#kathware-live-region"
      );
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // isInsideViewport(rect)
  // ---------------------------------------------------------------------------
  // Devuelve true si el rect NO está completamente fuera de pantalla.
  //
  // Nota:
  // - No exigimos que esté totalmente visible.
  // - Solo descartamos casos “obvios” (completamente afuera).
  // ---------------------------------------------------------------------------
  function isInsideViewport(r) {
    try {
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;

      // Si no sabemos tamaño de ventana, no bloqueamos.
      if (!vw || !vh) return true;

      const completelyLeft  = r.right < 0;
      const completelyRight = r.left > vw;
      const completelyAbove = r.bottom < 0;
      const completelyBelow = r.top > vh;

      return !(completelyLeft || completelyRight || completelyAbove || completelyBelow);
    } catch {
      return true;
    }
  }

  // ---------------------------------------------------------------------------
  // isVisibleVideo(video)
  // ---------------------------------------------------------------------------
  // Decide si un <video> “parece candidato real”.
  //
  // Criterios:
  // 1) No está dentro de nuestra UI.
  // 2) Tiene tamaño mínimo (evita thumbnails o previews mini).
  // 3) No está completamente fuera del viewport.
  // 4) No está oculto por CSS (display/visibility/opacity).
  //
  // Importante:
  // - Esto es heurístico. Si falla algo, preferimos “no romper”.
  // ---------------------------------------------------------------------------
  function isVisibleVideo(v) {
    try {
      if (!v || !v.getBoundingClientRect) return false;
      if (isInOurUI(v)) return false;

      const r = v.getBoundingClientRect();
      const w = Math.max(0, r.width || 0);
      const h = Math.max(0, r.height || 0);

      // Evita elegir previews muy chiquitos
      if (w < 80 || h < 80) return false;

      // Evita videos totalmente fuera de pantalla
      if (!isInsideViewport(r)) return false;

      const cs = getComputedStyle(v);
      if (cs.display === "none") return false;
      if (cs.visibility === "hidden") return false;
      if (Number(cs.opacity || 1) < 0.05) return false;

      return true;
    } catch {
      // Si algo falla, no tiramos abajo el sistema.
      // Preferimos “asumir visible” antes que bloquear.
      return true;
    }
  }

  // ---------------------------------------------------------------------------
  // areaOf(video)
  // ---------------------------------------------------------------------------
  // Área aproximada del video (ancho x alto).
  // Se usa para puntuar candidatos: más grande => más probable principal.
  // ---------------------------------------------------------------------------
  function areaOf(v) {
    try {
      const r = v.getBoundingClientRect();
      const w = Math.max(0, r.width || 0);
      const h = Math.max(0, r.height || 0);
      return w * h;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // scoreVideo(video)
  // ---------------------------------------------------------------------------
  // Le asigna un “puntaje” al video candidato.
  //
  // Heurística:
  // - Tamaño grande suma.
  // - readyState alto suma (está cargado).
  // - Tener src/currentSrc suma (hay contenido real).
  // - Si está reproduciendo, suma mucho (casi seguro es el principal).
  // - currentTime > 0 suma (hubo playback real).
  // - Si no está muteado, suma un poquito.
  //
  // Penalización:
  // - networkState = NO_SOURCE resta (video roto o sin fuente).
  // ---------------------------------------------------------------------------
  function scoreVideo(v) {
    let score = areaOf(v);

    try {
      const rs = Number(v.readyState || 0); // 0..4
      score += rs * 5000;

      const src = (v.currentSrc || v.src || "");
      if (src) score += 25000;

      if (v.paused === false && v.ended === false) score += 50000;

      const ct = Number(v.currentTime || 0);
      if (ct > 0) score += 20000;

      if (v.muted === false) score += 1500;
    } catch {
      // Ignoramos errores de propiedades del video
    }

    try {
      // NETWORK_NO_SOURCE suele ser 3
      if ((v.networkState || 0) === 3) score -= 10000;
    } catch {
      // Ignorar
    }

    return score;
  }

  // ---------------------------------------------------------------------------
  // pickBestVideo(videos)
  // ---------------------------------------------------------------------------
  // - Filtra candidatos visibles.
  // - Si no hay visibles, usa el primero de la lista (fallback).
  // - Si hay visibles, elige el de mayor score.
  // ---------------------------------------------------------------------------
  function pickBestVideo(videos) {
    const list = (videos || []).filter(isVisibleVideo);

    // Fallback: si no hay visibles, devolvemos el primero encontrado (si existe)
    if (!list.length) return (videos && videos[0]) || null;

    try {
      const best = list
        .map(v => ({ v, score: scoreVideo(v) }))
        .sort((a, b) => b.score - a.score)[0];

      return best?.v || list[0];
    } catch {
      return list[0];
    }
  }

  // ---------------------------------------------------------------------------
  // getMainVideo()
  // ---------------------------------------------------------------------------
  // Punto de entrada principal para el resto del engine.
  // ---------------------------------------------------------------------------
  function getMainVideo() {
    const vids = findVideosRecursively();
    return pickBestVideo(vids);
  }

  // ---------------------------------------------------------------------------
  // getVideosDebug(limit)
  // ---------------------------------------------------------------------------
  // Helper de depuración:
  // Devuelve info de los primeros N videos detectados.
  //
  // Útil cuando:
  // - una plataforma tiene previews
  // - hay más de un reproductor en la página
  // - el “principal” no se elige bien
  // ---------------------------------------------------------------------------
  function getVideosDebug(limit = 6) {
    const vids = findVideosRecursively();

    return vids.slice(0, limit).map(v => {
      const r = v.getBoundingClientRect?.() || { width: 0, height: 0, top: 0, left: 0 };

      return {
        area: Math.round(Math.max(0, r.width) * Math.max(0, r.height)),
        inViewport: isInsideViewport(r),

        paused: !!v.paused,
        ended: !!v.ended,
        readyState: v.readyState,

        currentTime: Number(v.currentTime || 0),
        currentSrc: (v.currentSrc || v.src || "").slice(0, 80),

        ignoredByOurUI: isInOurUI(v)
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Export público del módulo
  // ---------------------------------------------------------------------------
  KWSR.video = {
    findVideosRecursively,
    pickBestVideo,
    getMainVideo,
    getVideosDebug
  };

  // ---------------------------------------------------------------------------
  // Notas rápidas
  // ---------------------------------------------------------------------------
  // - Filtramos videos dentro de la UI de KathWare (guardia sana).
  // - Filtramos videos totalmente fuera del viewport (previews invisibles).
  // - Elegimos por score (tamaño + reproducción + carga + src + tiempo).
  // ----------------------------------------------------------------------------
})();
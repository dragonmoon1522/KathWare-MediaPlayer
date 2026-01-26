// ====================================================
// KathWare SubtitleReader - kwsr.video.js
// ====================================================
//
// ¿Qué hace este módulo?
// - Busca elementos <video> en la página (incluyendo Shadow DOM).
// - Elige el “video principal” (el que probablemente el usuario está mirando).
//
// ¿Por qué necesitamos esto?
// Porque la extensión tiene que saber “a qué video” asociarse para:
// - leer subtítulos (track / visual cerca del player)
// - controlar play/pause/seek/volumen desde el overlay
//
// Importante:
// - Esto NO lee subtítulos. Solo identifica el video.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.video) return;

  // ------------------------------------------------------------
  // findVideosRecursively(root):
  // Recorre el DOM y junta <video>.
  // También intenta entrar en shadowRoot cuando existe.
  //
  // Nota: Shadow DOM traversal es “best effort”.
  // Hay sombras cerradas (closed) donde no se puede entrar.
  // ------------------------------------------------------------
  function findVideosRecursively(root = document, out = new Set()) {
    try {
      // 1) videos normales
      root.querySelectorAll("video").forEach(v => out.add(v));

      // 2) intentar atravesar Shadow DOM (si está accesible)
      root.querySelectorAll("*").forEach(el => {
        try {
          if (el && el.shadowRoot) findVideosRecursively(el.shadowRoot, out);
        } catch {}
      });
    } catch {}

    return Array.from(out);
  }

  // ------------------------------------------------------------
  // isInOurUI(v):
  // Evita elegir videos que estén dentro de nuestro overlay/toast/live region.
  // (Hoy no metemos <video> ahí, pero es una guarda sana.)
  // ------------------------------------------------------------
  function isInOurUI(v) {
    try {
      return !!v.closest?.("#kathware-overlay-root,#kathware-overlay-panel,#kw-toast,#kwsr-live-region,#kathware-live-region");
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------
  // isInsideViewport(rect):
  // Filtra videos que existen pero están totalmente fuera de pantalla.
  // Evita agarrar previews ocultos o players “pre-cargados” en otro lado.
  // ------------------------------------------------------------
  function isInsideViewport(r) {
    try {
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;
      if (!vw || !vh) return true; // si no sabemos, no bloqueamos

      // si está completamente fuera, lo descartamos
      const completelyLeft   = r.right < 0;
      const completelyRight  = r.left > vw;
      const completelyAbove  = r.bottom < 0;
      const completelyBelow  = r.top > vh;

      return !(completelyLeft || completelyRight || completelyAbove || completelyBelow);
    } catch {
      return true;
    }
  }

  // ------------------------------------------------------------
  // isVisibleVideo(v):
  // Decide si un <video> “parece real” y visible.
  //
  // Reglas:
  // - tamaño mínimo (evita thumbnails)
  // - display/visibility/opacity
  // - dentro del viewport (no totalmente fuera)
  // - no dentro de nuestra UI
  // ------------------------------------------------------------
  function isVisibleVideo(v) {
    try {
      if (!v || !v.getBoundingClientRect) return false;
      if (isInOurUI(v)) return false;

      const r = v.getBoundingClientRect();
      const w = Math.max(0, r.width || 0);
      const h = Math.max(0, r.height || 0);

      if (w < 80 || h < 80) return false; // evita previews minúsculos
      if (!isInsideViewport(r)) return false;

      const cs = getComputedStyle(v);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (Number(cs.opacity || 1) < 0.05) return false;

      return true;
    } catch {
      // Si algo falla, preferimos no romper.
      return true;
    }
  }

  // ------------------------------------------------------------
  // areaOf(v):
  // Área visible aproximada (width * height).
  // Sirve para puntuar candidatos.
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // scoreVideo(v):
  // “Puntúa” el video candidato.
  // No es perfecto, pero suele elegir bien.
  //
  // Ideas:
  // - Más grande = más probable que sea el principal.
  // - Si está reproduciendo (paused=false) = casi seguro principal.
  // - readyState alto = está cargado
  // - currentSrc/src existe = hay contenido
  // - currentTime > 0 = playback real
  // ------------------------------------------------------------
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

      // Extra suave: si no está muteado, suma un poquito
      if (v.muted === false) score += 1500;
    } catch {}

    try {
      // Penaliza videos que no tienen source válido
      if ((v.networkState || 0) === 3) score -= 10000; // NETWORK_NO_SOURCE
    } catch {}

    return score;
  }

  // ------------------------------------------------------------
  // pickBestVideo(videos):
  // Filtra y elige el mejor candidato.
  // ------------------------------------------------------------
  function pickBestVideo(videos) {
    const list = (videos || []).filter(isVisibleVideo);
    if (!list.length) return (videos && videos[0]) || null;

    try {
      return list
        .map(v => ({ v, score: scoreVideo(v) }))
        .sort((a, b) => b.score - a.score)[0]?.v || list[0];
    } catch {
      return list[0];
    }
  }

  // ------------------------------------------------------------
  // getMainVideo():
  // Punto de entrada principal para el resto del engine.
  // ------------------------------------------------------------
  function getMainVideo() {
    const vids = findVideosRecursively();
    return pickBestVideo(vids);
  }

  // ------------------------------------------------------------
  // getVideosDebug(limit):
  // Helper para depurar qué videos detecta y qué datos tienen.
  // Útil cuando una plataforma tiene múltiples players o previews.
  // ------------------------------------------------------------
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

  // Export público del módulo
  KWSR.video = {
    findVideosRecursively,
    pickBestVideo,
    getMainVideo,
    getVideosDebug
  };

  /*
  ===========================
  Cambios / notas
  ===========================
  - Se agregó filtro para no seleccionar videos dentro de la UI de KathWare.
  - Se agregó filtro “fuera del viewport” para evitar previews invisibles.
  - Se mantiene lógica de score (área + reproducción + readyState + src + time).
  */
})();

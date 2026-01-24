// ====================================================
// KathWare SubtitleReader - kwsr.video.js
// - Descubre videos incluso dentro de shadow DOM
// - Elige el video “principal” por score (área + reproducción)
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.video) return;

  function findVideosRecursively(root = document, out = new Set()) {
    try {
      root.querySelectorAll("video").forEach(v => out.add(v));

      // Shadow DOM traversal (best effort)
      root.querySelectorAll("*").forEach(el => {
        try {
          if (el && el.shadowRoot) findVideosRecursively(el.shadowRoot, out);
        } catch {}
      });
    } catch {}

    return Array.from(out);
  }

  function isVisibleVideo(v) {
    try {
      if (!v || !v.getBoundingClientRect) return false;
      const r = v.getBoundingClientRect();
      const w = Math.max(0, r.width || 0);
      const h = Math.max(0, r.height || 0);
      if (w < 80 || h < 80) return false; // evita previews minúsculos

      const cs = getComputedStyle(v);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (Number(cs.opacity || 1) < 0.05) return false;

      return true;
    } catch {
      return true; // best effort
    }
  }

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

  function scoreVideo(v) {
    // Base: área visible
    let score = areaOf(v);

    // Bonus: parece “el que está activo”
    try {
      // readyState: 0..4 (HAVE_ENOUGH_DATA ~ 4)
      const rs = Number(v.readyState || 0);
      score += rs * 5000;

      // Tiene src real
      const src = (v.currentSrc || v.src || "");
      if (src) score += 25000;

      // Está reproduciendo (no paused)
      if (v.paused === false && v.ended === false) score += 50000;

      // currentTime > 0 suele ser playback real
      const ct = Number(v.currentTime || 0);
      if (ct > 0) score += 20000;

      // Si está muted o no, no importa; pero ayuda a no elegir previews “sin audio”
      // (muy suave, para no sesgar de más)
      if (v.muted === false) score += 1500;
    } catch {}

    // Penalizaciones suaves
    try {
      // videos “poster-only” / sin carga
      if ((v.networkState || 0) === 3) score -= 10000; // NETWORK_NO_SOURCE
    } catch {}

    return score;
  }

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

  function getMainVideo() {
    const vids = findVideosRecursively();
    return pickBestVideo(vids);
  }

  // Debug helper opcional (no rompe nada)
  function getVideosDebug(limit = 6) {
    const vids = findVideosRecursively();
    return vids.slice(0, limit).map(v => {
      const r = v.getBoundingClientRect?.() || { width: 0, height: 0 };
      return {
        area: Math.round(Math.max(0, r.width) * Math.max(0, r.height)),
        paused: !!v.paused,
        ended: !!v.ended,
        readyState: v.readyState,
        currentTime: Number(v.currentTime || 0),
        currentSrc: (v.currentSrc || v.src || "").slice(0, 80)
      };
    });
  }

  KWSR.video = {
    findVideosRecursively,
    pickBestVideo,
    getMainVideo,
    getVideosDebug
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Se mantiene DOM + shadow DOM traversal.
  - Se reemplaza “largest by area” por “best by score”:
      - área + (reproduciendo) + readyState + currentSrc + currentTime
  - Se filtran videos invisibles o mini-previews (w/h < 80).
  - Se agrega helper opcional getVideosDebug() para ver qué está eligiendo.
  */
})();

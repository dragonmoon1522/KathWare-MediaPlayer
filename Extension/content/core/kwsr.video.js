// ====================================================
// KathWare SubtitleReader - kwsr.video.js
// - Descubre videos incluso dentro de shadow DOM
// - Elige el video “principal” por área visible
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

  function pickLargestVideo(videos) {
    if (!videos.length) return null;

    try {
      return videos
        .map(v => {
          const r = v.getBoundingClientRect();
          const w = Math.max(0, r.width || 0);
          const h = Math.max(0, r.height || 0);
          return { v, area: w * h };
        })
        .sort((a, b) => b.area - a.area)[0]?.v || videos[0];
    } catch {
      return videos[0];
    }
  }

  function getMainVideo() {
    const vids = findVideosRecursively();
    return pickLargestVideo(vids);
  }

  KWSR.video = {
    findVideosRecursively,
    pickLargestVideo,
    getMainVideo
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Rebrand: KWMP -> KWSR.
  - Se mantiene la estrategia:
      - Buscar <video> en DOM + shadow roots (best effort)
      - Elegir el de mayor área visible como “main video”
  - Ajuste menor: clamp de width/height a >=0 para evitar NaN raros.
  */
})();

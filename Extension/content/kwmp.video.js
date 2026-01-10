(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.video) return;

  function findVideosRecursively(root = document, out = new Set()) {
    try {
      root.querySelectorAll("video").forEach(v => out.add(v));
      root.querySelectorAll("*").forEach(el => el.shadowRoot && findVideosRecursively(el.shadowRoot, out));
    } catch {}
    return Array.from(out);
  }

  function pickLargestVideo(videos) {
    if (!videos.length) return null;
    try {
      return videos
        .map(v => {
          const r = v.getBoundingClientRect();
          return { v, area: Math.max(0, r.width) * Math.max(0, r.height) };
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

  KWMP.video = {
    findVideosRecursively,
    pickLargestVideo,
    getMainVideo
  };
})();

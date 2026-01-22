(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.track) return;

  const S = KWMP.state;
  const { normalize, clamp } = KWMP.utils;

  function readActiveCues(track) {
    try {
      const active = track?.activeCues ? Array.from(track.activeCues) : [];
      const joined = active.map(c => c.text || "").join(" / ");
      return normalize(joined);
    } catch {
      return "";
    }
  }

  function trackSeemsUsable(track) {
    if (!track) return false;
    try { if (track.mode === "disabled") track.mode = "hidden"; } catch {}
    try {
      const txt = readActiveCues(track);
      if (txt) return true;
      const len = track.cues ? track.cues.length : 0;
      if (len > 0) return true;
    } catch {
      return false;
    }
    return false;
  }

  function videoHasUsableTracks(video) {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return false;
    return list.some(trackSeemsUsable);
  }

  function pickBestTrack(video) {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return null;

    const idx = clamp(S.trackIndexGlobal, 0, list.length - 1);
    return (
      list[idx] ||
      list.find(t => t.mode === "showing") ||
      list.find(t => t.mode === "hidden" && t.cues && t.cues.length) ||
      list.find(t => t.mode === "hidden") ||
      list[0] ||
      null
    );
  }

  function attachTrack(track) {
    if (!track) return;
    try { if (track.mode === "disabled") track.mode = "hidden"; } catch {}
    try { track.oncuechange = null; } catch {}

    track.oncuechange = () => {
      if (!KWMP.voice.shouldReadNow()) return;
      if (S.effectiveFuente !== "track") return;

      const txt = readActiveCues(track);
      if (!txt) return;

      if (txt === S.lastTrackSeen) return;
      S.lastTrackSeen = txt;

      KWMP.voice.leerTextoAccesible(txt);
    };

    const initial = readActiveCues(track);
    if (initial && initial !== S.lastTrackSeen) {
      S.lastTrackSeen = initial;
      KWMP.voice.leerTextoAccesible(initial);
    }
  }

  function startTrack() {
    const v = S.currentVideo;
    if (!v?.textTracks || !v.textTracks.length) {
      S.currentTrack = null;
      KWMP.overlay?.updateOverlayStatus?.();
      return false;
    }

    const best = pickBestTrack(v);
    if (!best) {
      S.currentTrack = null;
      KWMP.overlay?.updateOverlayStatus?.();
      return false;
    }

    if (!trackSeemsUsable(best)) {
      S.currentTrack = null;
      KWMP.overlay?.updateOverlayStatus?.();
      return false;
    }

    if (best !== S.currentTrack) {
      S.currentTrack = best;
      attachTrack(best);
      KWMP.overlay?.updateOverlayTracksList?.();
      KWMP.overlay?.updateOverlayStatus?.();
      KWMP.log("TRACK activo:", KWMP.overlay?.describeTrack?.(best) || best);
    }
    return true;
  }

  function pollTrackTick() {
    if (!KWMP.voice.shouldReadNow()) return;
    if (S.effectiveFuente !== "track") return;
    if (!S.currentTrack) return;

    const txt = readActiveCues(S.currentTrack);
    if (!txt) return;

    if (txt === S.lastTrackSeen) return;
    S.lastTrackSeen = txt;

    KWMP.voice.leerTextoAccesible(txt);
  }

  KWMP.track = {
    readActiveCues,
    trackSeemsUsable,
    videoHasUsableTracks,
    pickBestTrack,
    attachTrack,
    startTrack,
    pollTrackTick
  };
})();

// ====================================================
// KathWare SubtitleReader - kwsr.track.js
// - TRACK engine: lee video.textTracks (oncuechange + polling fallback)
//
// FIX:
// - Evita “tracks fantasma” que hacen que AUTO elija TRACK sin cues reales
// - Priorización mejor en pickBestTrack()
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.track) return;

  const S = KWSR.state;
  const { normalize, clamp } = KWSR.utils;

  function readActiveCues(track) {
    try {
      const active = track?.activeCues ? Array.from(track.activeCues) : [];
      const joined = active.map(c => c.text || "").join(" / ");
      return normalize(joined);
    } catch {
      return "";
    }
  }

  function hasCues(track) {
    try {
      const len = track?.cues ? track.cues.length : 0;
      return len > 0;
    } catch {
      return false;
    }
  }

  function trackSeemsUsable(track) {
    if (!track) return false;

    // Intento: habilitar lectura sin “mostrar” visualmente (hidden)
    try { if (track.mode === "disabled") track.mode = "hidden"; } catch {}

    // 1) Si ya hay activeCues con texto -> usable
    const now = readActiveCues(track);
    if (now) return true;

    // 2) Si hay cues pero track nunca va a activar (algunas plataformas dejan cues vacíos/raros)
    //    Igual lo consideramos usable PERO con prioridad menor (pickBestTrack)
    if (hasCues(track)) return true;

    return false;
  }

  function videoHasUsableTracks(video) {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return false;

    // Importante: no queremos que "tenga tracks" implique usable.
    // Debe haber al menos uno que parezca usable.
    return list.some(trackSeemsUsable);
  }

  function scoreTrack(t) {
    // Score simple para elegir mejor:
    // showing > hidden > disabled
    // cues > sin cues
    // label/lang presentes suman un poquito
    let s = 0;
    const mode = (t?.mode || "").toLowerCase();
    if (mode === "showing") s += 50;
    else if (mode === "hidden") s += 30;
    else if (mode === "disabled") s += 0;

    if (hasCues(t)) s += 20;

    const hasMeta = !!(t?.label || t?.language);
    if (hasMeta) s += 5;

    // Si tiene activeCues ahora mismo, es el rey
    const activeNow = readActiveCues(t);
    if (activeNow) s += 100;

    return s;
  }

  function pickBestTrack(video) {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return null;

    // 1) Si el índice global apunta a algo usable, lo respetamos
    const idx = clamp(S.trackIndexGlobal, 0, list.length - 1);
    const byIdx = list[idx];
    if (byIdx && trackSeemsUsable(byIdx)) return byIdx;

    // 2) Si hay alguno usable, elegimos el de mayor score
    const usable = list.filter(trackSeemsUsable);
    if (!usable.length) return null;

    usable.sort((a, b) => scoreTrack(b) - scoreTrack(a));
    return usable[0] || null;
  }

  function attachTrack(track) {
    if (!track) return;

    try { if (track.mode === "disabled") track.mode = "hidden"; } catch {}
    try { track.oncuechange = null; } catch {}

    track.oncuechange = () => {
      if (!KWSR.voice.shouldReadNow()) return;
      if (S.effectiveFuente !== "track") return;

      const txt = readActiveCues(track);
      if (!txt) return;

      if (txt === S.lastTrackSeen) return;
      S.lastTrackSeen = txt;

      KWSR.voice.leerTextoAccesible(txt);
    };

    // Primera lectura inmediata (si ya hay cue activo)
    const initial = readActiveCues(track);
    if (initial && initial !== S.lastTrackSeen) {
      S.lastTrackSeen = initial;
      KWSR.voice.leerTextoAccesible(initial);
    }
  }

  function startTrack() {
    const v = S.currentVideo;
    if (!v?.textTracks || !v.textTracks.length) {
      S.currentTrack = null;
      KWSR.overlay?.updateOverlayStatus?.();
      return false;
    }

    const best = pickBestTrack(v);
    if (!best) {
      S.currentTrack = null;
      KWSR.overlay?.updateOverlayStatus?.();
      return false;
    }

    if (!trackSeemsUsable(best)) {
      S.currentTrack = null;
      KWSR.overlay?.updateOverlayStatus?.();
      return false;
    }

    if (best !== S.currentTrack) {
      S.currentTrack = best;
      attachTrack(best);
      KWSR.overlay?.updateOverlayTracksList?.();
      KWSR.overlay?.updateOverlayStatus?.();
      KWSR.log?.("TRACK activo:", KWSR.overlay?.describeTrack?.(best) || {
        label: best.label, lang: best.language, mode: best.mode, cues: best.cues?.length ?? 0
      });
    }

    return true;
  }

  function pollTrackTick() {
    if (!KWSR.voice.shouldReadNow()) return;
    if (S.effectiveFuente !== "track") return;
    if (!S.currentTrack) return;

    const txt = readActiveCues(S.currentTrack);
    if (!txt) return;

    if (txt === S.lastTrackSeen) return;
    S.lastTrackSeen = txt;

    KWSR.voice.leerTextoAccesible(txt);
  }

  KWSR.track = {
    readActiveCues,
    trackSeemsUsable,
    videoHasUsableTracks,
    pickBestTrack,
    attachTrack,
    startTrack,
    pollTrackTick
  };

})();

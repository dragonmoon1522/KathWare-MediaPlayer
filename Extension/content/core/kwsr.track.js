// ====================================================
// KathWare SubtitleReader - kwsr.track.js
// - TRACK engine: lee video.textTracks (oncuechange + polling fallback)
//
// FIX:
// - Evita “tracks fantasma” que hacen que AUTO elija TRACK sin cues reales
// - Priorización mejor en pickBestTrack()
// - Anti-duplicados Netflix/Max:
//    * dedupe por cueKey (timing + texto normalizado)
//    * anti-eco por ventana corta (oncuechange + poll)
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.track) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;
  const { normalize, clamp } = KWSR.utils;

  // --------- Helpers: normalización fuerte para keys ---------
  function normKey(s) {
    return String(s ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // --------- Lectura de cues ---------
  function readActiveCues(track) {
    try {
      const active = track?.activeCues ? Array.from(track.activeCues) : [];
      const joined = active.map(c => c.text || "").join(" / ");
      return normalize(joined);
    } catch {
      return "";
    }
  }

  // Key estable por cue(s) activos: timing + texto (normalizado fuerte)
  // Esto evita que cambios mínimos en join/espacios hagan “nuevo texto” y se repita.
  function activeCuesKey(track) {
    try {
      const active = track?.activeCues ? Array.from(track.activeCues) : [];
      if (!active.length) return "";

      const parts = active.map(c => {
        const st = Number.isFinite(c?.startTime) ? c.startTime.toFixed(3) : "s?";
        const et = Number.isFinite(c?.endTime) ? c.endTime.toFixed(3) : "e?";
        const tx = normKey(c?.text || "");
        return `${st}-${et}:${tx}`;
      });

      // Orden estable
      parts.sort();
      return parts.join("||");
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

    // 2) Si hay cues -> usable (prioridad menor)
    if (hasCues(track)) return true;

    return false;
  }

  function videoHasUsableTracks(video) {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return false;
    return list.some(trackSeemsUsable);
  }

  function scoreTrack(t) {
    let s = 0;
    const mode = (t?.mode || "").toLowerCase();
    if (mode === "showing") s += 50;
    else if (mode === "hidden") s += 30;

    if (hasCues(t)) s += 20;

    const hasMeta = !!(t?.label || t?.language);
    if (hasMeta) s += 5;

    const activeNow = readActiveCues(t);
    if (activeNow) s += 100;

    return s;
  }

  function pickBestTrack(video) {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return null;

    const idx = clamp(S.trackIndexGlobal, 0, list.length - 1);
    const byIdx = list[idx];
    if (byIdx && trackSeemsUsable(byIdx)) return byIdx;

    const usable = list.filter(trackSeemsUsable);
    if (!usable.length) return null;

    usable.sort((a, b) => scoreTrack(b) - scoreTrack(a));
    return usable[0] || null;
  }

  // --------- Core: attach + dedupe ---------
  function shouldEmitTrackKey(key) {
    if (!key) return false;

    const now = Date.now();
    const dt = now - (S.lastTrackAt || 0);
    const echoMs = (CFG.trackEchoMs ?? 350);

    // Anti-eco: mismo cueKey llegando pegado (cuechange + poll, o doble cuechange)
    if (key === (S.lastTrackKey || "") && dt < echoMs) return false;

    // Misma clave exacta (mismo cue/s activo/s) => no repetir
    if (key === (S.lastTrackKey || "")) return false;

    S.lastTrackKey = key;
    S.lastTrackAt = now;
    return true;
  }

  function attachTrack(track) {
    if (!track) return;

    try { if (track.mode === "disabled") track.mode = "hidden"; } catch {}
    try { track.oncuechange = null; } catch {}

    track.oncuechange = () => {
      if (!KWSR.voice.shouldReadNow()) return;
      if (S.effectiveFuente !== "track") return;

      const key = activeCuesKey(track);
      if (!key) return;

      if (!shouldEmitTrackKey(key)) return;

      const txt = readActiveCues(track);
      if (!txt) return;

      // fallback extra por texto (por si alguna plataforma no da timings)
      if (txt === S.lastTrackSeen) return;
      S.lastTrackSeen = txt;

      KWSR.voice.leerTextoAccesible(txt);
    };

    // Primera lectura inmediata (si ya hay cue activo)
    const initKey = activeCuesKey(track);
    if (initKey && shouldEmitTrackKey(initKey)) {
      const initial = readActiveCues(track);
      if (initial && initial !== S.lastTrackSeen) {
        S.lastTrackSeen = initial;
        KWSR.voice.leerTextoAccesible(initial);
      }
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

    const key = activeCuesKey(S.currentTrack);
    if (!key) return;

    if (!shouldEmitTrackKey(key)) return;

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

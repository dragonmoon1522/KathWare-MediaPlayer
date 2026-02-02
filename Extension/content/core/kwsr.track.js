// ----------------------------------------------------
// KathWare SubtitleReader - kwsr.track.js
// ----------------------------------------------------
//
// QUÉ HACE ESTE MÓDULO
// -------------------
// Implementa la fuente TRACK.
//
// TRACK significa:
// - Leer subtítulos desde las pistas del video (<video>.textTracks).
// - Usar cues (fragmentos con tiempo de inicio, fin y texto).
//
// Este módulo NO decide cuándo usar TRACK.
// Eso lo decide el pipeline.
// Acá solo nos encargamos de:
// - elegir una pista válida
// - leer sus cues
// - evitar lecturas duplicadas
//
// IDEA GENERAL (en criollo)
// ------------------------
// 1) El video puede tener varias pistas (idiomas, CC, etc).
// 2) Elegimos la mejor pista disponible.
// 3) Escuchamos cambios con oncuechange.
// 4) Usamos polling como respaldo (por si el evento falla).
// 5) Aplicamos dedupe fuerte para no leer dos veces lo mismo.
//
// PROBLEMA REAL QUE RESUELVE
// --------------------------
// - Muchas plataformas disparan eventos duplicados.
// - O tienen pistas “fantasma” (existen pero no traen texto).
// - O el evento falla y solo el polling ve el cambio.
//
// Este archivo existe para que eso NO se note.
// ----------------------------------------------------

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.track) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;
  const { normalize, clamp } = KWSR.utils;

  // --------------------------------------------------
  // normKey()
  // --------------------------------------------------
  // Normalización fuerte para comparación de texto.
  //
  // IMPORTANTE:
  // - Esto NO es lo que se lee en voz.
  // - Es solo para generar claves estables de dedupe.
  // --------------------------------------------------
  function normKey(s) {
    return String(s ?? "")
      .replace(/\u00A0/g, " ")               // NBSP -> espacio normal
      .replace(/[\u200B-\u200D\uFEFF]/g, "") // caracteres invisibles
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // --------------------------------------------------
  // readActiveCues()
  // --------------------------------------------------
  // Lee el texto de los cues activos AHORA.
  //
  // Si hay más de un cue activo (dos líneas):
  // - los unimos con " / "
  // - evitamos usar coma (puede ser parte del diálogo)
  // --------------------------------------------------
  function readActiveCues(track) {
    try {
      const active = track?.activeCues ? Array.from(track.activeCues) : [];
      const joined = active.map(c => c.text || "").join(" / ");
      return normalize(joined);
    } catch {
      return "";
    }
  }

  // --------------------------------------------------
  // activeCuesKey()
  // --------------------------------------------------
  // Clave estable para dedupe de TRACK.
  //
  // Incluye:
  // - startTime y endTime (redondeados)
  // - texto normalizado fuerte
  //
  // Así evitamos re-lecturas por:
  // - espacios
  // - reordenamientos
  // - eventos duplicados
  // --------------------------------------------------
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

      // Orden estable por seguridad
      parts.sort();
      return parts.join("||");
    } catch {
      return "";
    }
  }

  // --------------------------------------------------
  // hasCues()
  // --------------------------------------------------
  // Algunas pistas ya tienen cues cargados
  // aunque todavía no haya activeCues.
  // --------------------------------------------------
  function hasCues(track) {
    try {
      return (track?.cues?.length || 0) > 0;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------
  // trackSeemsUsable()
  // --------------------------------------------------
  // Decide si una pista parece “real” y usable.
  //
  // Heurística:
  // 1) Si hay texto activo ahora -> sí
  // 2) Si hay cues cargados -> probablemente sí
  // 3) Si no hay nada -> probablemente pista fantasma
  //
  // Además:
  // - intentamos poner el track en "hidden"
  //   porque algunos sitios con "disabled" no exponen cues.
  // --------------------------------------------------
  function trackSeemsUsable(track) {
    if (!track) return false;

    try {
      if (track.mode === "disabled") track.mode = "hidden";
    } catch {}

    if (readActiveCues(track)) return true;
    if (hasCues(track)) return true;

    return false;
  }

  // --------------------------------------------------
  // videoHasUsableTracks()
  // --------------------------------------------------
  // Usado por el pipeline en modo AUTO.
  // Sirve para decidir si conviene TRACK o VISUAL.
  // --------------------------------------------------
  function videoHasUsableTracks(video) {
    const list = Array.from(video?.textTracks || []);
    return list.some(trackSeemsUsable);
  }

  // --------------------------------------------------
  // scoreTrack()
  // --------------------------------------------------
  // Puntaje heurístico para elegir la mejor pista.
  // Más puntaje = más probable que sea la correcta.
  // --------------------------------------------------
  function scoreTrack(t) {
    let s = 0;

    const mode = (t?.mode || "").toLowerCase();
    if (mode === "showing") s += 50;
    else if (mode === "hidden") s += 30;

    if (hasCues(t)) s += 20;

    if (t?.label || t?.language) s += 5;

    if (readActiveCues(t)) s += 100;

    return s;
  }

  // --------------------------------------------------
  // pickBestTrack()
  // --------------------------------------------------
  // Orden de prioridad:
  // 1) trackIndexGlobal (si es válido y usable)
  // 2) pista usable con mayor score
  // --------------------------------------------------
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

  // --------------------------------------------------
  // shouldEmitTrackKey()
  // --------------------------------------------------
  // Dedupe principal de TRACK.
  //
  // Problema típico:
  // - oncuechange dispara
  // - poll también ve el mismo cue
  //
  // Solución:
  // - bloqueamos repeticiones inmediatas
  // - y bloqueamos repetir la misma key exacta
  // --------------------------------------------------
  function shouldEmitTrackKey(key) {
    if (!key) return false;

    const now = Date.now();
    const dt = now - (S.lastTrackAt || 0);
    const echoMs = (CFG.trackEchoMs ?? 350);

    if (key === S.lastTrackKey && dt < echoMs) return false;
    if (key === S.lastTrackKey) return false;

    S.lastTrackKey = key;
    S.lastTrackAt = now;
    return true;
  }

  // --------------------------------------------------
  // attachTrack()
  // --------------------------------------------------
  // Engancha oncuechange al track elegido.
  // También intenta una lectura inicial si ya hay texto activo.
  // --------------------------------------------------
  function attachTrack(track) {
    if (!track) return;

    try { if (track.mode === "disabled") track.mode = "hidden"; } catch {}
    try { track.oncuechange = null; } catch {}

    track.oncuechange = () => {
      if (!KWSR.voice?.shouldReadNow?.()) return;
      if (S.effectiveFuente !== "track") return;

      const key = activeCuesKey(track);
      if (!shouldEmitTrackKey(key)) return;

      const txt = readActiveCues(track);
      if (!txt || txt === S.lastTrackSeen) return;

      S.lastTrackSeen = txt;
      KWSR.voice?.leerTextoAccesible?.(txt);
    };

    // Lectura inicial (si hay cue activo al enganchar)
    const initKey = activeCuesKey(track);
    if (initKey && shouldEmitTrackKey(initKey)) {
      const initial = readActiveCues(track);
      if (initial && initial !== S.lastTrackSeen) {
        S.lastTrackSeen = initial;
        KWSR.voice?.leerTextoAccesible?.(initial);
      }
    }
  }

  // --------------------------------------------------
  // startTrack()
  // --------------------------------------------------
  // Activa TRACK como fuente efectiva.
  // --------------------------------------------------
  function startTrack() {
    const v = S.currentVideo;
    if (!v?.textTracks?.length) {
      S.currentTrack = null;
      KWSR.overlay?.updateOverlayStatus?.();
      return false;
    }

    const best = pickBestTrack(v);
    if (!best || !trackSeemsUsable(best)) {
      S.currentTrack = null;
      KWSR.overlay?.updateOverlayStatus?.();
      return false;
    }

    if (best !== S.currentTrack) {
      S.currentTrack = best;
      attachTrack(best);

      KWSR.overlay?.updateOverlayTracksList?.();
      KWSR.overlay?.updateOverlayStatus?.();

      KWSR.log?.("TRACK activo:", {
        label: best.label,
        lang: best.language,
        mode: best.mode,
        cues: best.cues?.length ?? 0
      });
    }

    return true;
  }

  // --------------------------------------------------
  // pollTrackTick()
  // --------------------------------------------------
  // Fallback por timer.
  // Sirve cuando oncuechange no es confiable.
  // --------------------------------------------------
  function pollTrackTick() {
    if (!KWSR.voice?.shouldReadNow?.()) return;
    if (S.effectiveFuente !== "track") return;
    if (!S.currentTrack) return;

    const key = activeCuesKey(S.currentTrack);
    if (!shouldEmitTrackKey(key)) return;

    const txt = readActiveCues(S.currentTrack);
    if (!txt || txt === S.lastTrackSeen) return;

    S.lastTrackSeen = txt;
    KWSR.voice?.leerTextoAccesible?.(txt);
  }

  // --------------------------------------------------
  // EXPORT
  // --------------------------------------------------
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
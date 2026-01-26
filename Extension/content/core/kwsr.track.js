// ====================================================
// KathWare SubtitleReader - kwsr.track.js
// ====================================================
//
// Este módulo implementa la fuente TRACK:
// Lee subtítulos desde las pistas del video (video.textTracks).
//
// Cómo funciona (en criollo):
// - El video puede traer varias "pistas" de texto (idiomas, CC, etc).
// - Cada pista tiene "cues" (fragmentos con startTime/endTime + texto).
// - Si la pista está activa, podemos leer "activeCues" en tiempo real.
//
// Estrategia:
// 1) Elegimos el mejor track disponible (pickBestTrack).
// 2) Nos enganchamos con oncuechange (evento del track).
// 3) Además hacemos polling (pollTrackTick) como fallback por si el evento falla.
// 4) Dedupe: evitamos leer lo mismo dos veces (evento + poll suelen duplicar).
//
// Nota importante:
// - En algunas plataformas hay "tracks fantasma" (existen pero no traen cues reales).
// - Por eso trackSeemsUsable() intenta ser prudente.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.track) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;
  const { normalize, clamp } = KWSR.utils;

  // ------------------------------------------------------------
  // normKey():
  // Normalización fuerte para comparar strings como “lo mismo”.
  // (Se usa para crear claves estables, no para mostrar texto.)
  // ------------------------------------------------------------
  function normKey(s) {
    return String(s ?? "")
      .replace(/\u00A0/g, " ")              // NBSP -> espacio normal
      .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // ------------------------------------------------------------
  // readActiveCues():
  // Lee el texto de los cues activos ahora mismo.
  //
  // Si hay varios cues activos (dos líneas), los unimos con " / ".
  // Eso ayuda a no mezclar con coma (que puede ser parte del texto).
  // ------------------------------------------------------------
  function readActiveCues(track) {
    try {
      const active = track?.activeCues ? Array.from(track.activeCues) : [];
      const joined = active.map(c => c.text || "").join(" / ");
      return normalize(joined);
    } catch {
      return "";
    }
  }

  // ------------------------------------------------------------
  // activeCuesKey():
  // Dedupe principal: clave estable del/los cue(s) activos.
  //
  // Incluye:
  // - startTime y endTime (con 3 decimales) para estabilidad
  // - texto normalizado fuerte
  //
  // Esto evita que “pequeños cambios” (espacios, join) disparen re-lecturas.
  // ------------------------------------------------------------
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

      // Orden estable (por si el array viene en distinto orden)
      parts.sort();
      return parts.join("||");
    } catch {
      return "";
    }
  }

  // ------------------------------------------------------------
  // hasCues():
  // Algunas pistas tienen .cues cargados aunque no haya activeCues aún.
  // ------------------------------------------------------------
  function hasCues(track) {
    try {
      const len = track?.cues ? track.cues.length : 0;
      return len > 0;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------
  // trackSeemsUsable():
  // Decide si una pista “parece real” y usable.
  //
  // Heurística:
  // 1) Si ya hay activeCues con texto -> sí
  // 2) Si hay cues cargados -> probablemente sí (pero menor prioridad)
  //
  // También intentamos poner el track en "hidden" si estaba disabled,
  // porque en algunos sitios disabled => no te da activeCues.
  // ------------------------------------------------------------
  function trackSeemsUsable(track) {
    if (!track) return false;

    // Intento de habilitación “silenciosa”
    try {
      if (track.mode === "disabled") track.mode = "hidden";
    } catch {}

    // Caso ideal: hay texto activo ahora
    const now = readActiveCues(track);
    if (now) return true;

    // Caso probable: la pista tiene cues cargados
    if (hasCues(track)) return true;

    // Si no tiene nada, puede ser fantasma
    return false;
  }

  // ------------------------------------------------------------
  // videoHasUsableTracks():
  // Se usa en AUTO para decidir si conviene TRACK.
  // ------------------------------------------------------------
  function videoHasUsableTracks(video) {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return false;
    return list.some(trackSeemsUsable);
  }

  // ------------------------------------------------------------
  // scoreTrack():
  // Puntaje para elegir "mejor pista".
  // Más score = más probable que sea la correcta.
  // ------------------------------------------------------------
  function scoreTrack(t) {
    let s = 0;

    // Mode: showing > hidden > disabled
    const mode = (t?.mode || "").toLowerCase();
    if (mode === "showing") s += 50;
    else if (mode === "hidden") s += 30;

    // Si tiene cues, suma
    if (hasCues(t)) s += 20;

    // Meta (label/language) suma un poquito
    const hasMeta = !!(t?.label || t?.language);
    if (hasMeta) s += 5;

    // Si hay activeCues con texto ahora, eso manda
    const activeNow = readActiveCues(t);
    if (activeNow) s += 100;

    return s;
  }

  // ------------------------------------------------------------
  // pickBestTrack():
  // Elige pista en este orden:
  // 1) trackIndexGlobal (si existe y es usable)
  // 2) si no, el mejor score entre pistas usables
  // ------------------------------------------------------------
  function pickBestTrack(video) {
    const list = Array.from(video?.textTracks || []);
    if (!list.length) return null;

    // Si el usuario eligió índice, lo respetamos si sirve
    const idx = clamp(S.trackIndexGlobal, 0, list.length - 1);
    const byIdx = list[idx];
    if (byIdx && trackSeemsUsable(byIdx)) return byIdx;

    // Si no, buscamos la mejor pista usable
    const usable = list.filter(trackSeemsUsable);
    if (!usable.length) return null;

    usable.sort((a, b) => scoreTrack(b) - scoreTrack(a));
    return usable[0] || null;
  }

  // ------------------------------------------------------------
  // shouldEmitTrackKey():
  // Dedupe principal para TRACK.
  //
  // Problema típico:
  // - oncuechange dispara
  // - poll también ve el mismo cue
  // => se lee 2 veces.
  //
  // Solución:
  // - guardamos lastTrackKey + lastTrackAt
  // - bloqueamos duplicados inmediatos dentro de una ventana corta (echoMs)
  // - y bloqueamos repetir exactamente la misma key en general
  // ------------------------------------------------------------
  function shouldEmitTrackKey(key) {
    if (!key) return false;

    const now = Date.now();
    const dt = now - (S.lastTrackAt || 0);
    const echoMs = (CFG.trackEchoMs ?? 350);

    // Anti-eco inmediato (evento+poll, o doble evento)
    if (key === (S.lastTrackKey || "") && dt < echoMs) return false;

    // Si la key es idéntica a la anterior, no repetimos
    if (key === (S.lastTrackKey || "")) return false;

    S.lastTrackKey = key;
    S.lastTrackAt = now;
    return true;
  }

  // ------------------------------------------------------------
  // attachTrack():
  // Engancha el evento oncuechange al track seleccionado.
  // También intenta una lectura inicial si ya hay un cue activo.
  // ------------------------------------------------------------
  function attachTrack(track) {
    if (!track) return;

    // Intento: habilitar
    try { if (track.mode === "disabled") track.mode = "hidden"; } catch {}

    // Limpieza de handler viejo
    try { track.oncuechange = null; } catch {}

    // Evento de cambio de cues
    track.oncuechange = () => {
      // Gate general (si está OFF no leemos)
      if (!KWSR.voice?.shouldReadNow?.()) return;
      if (S.effectiveFuente !== "track") return;

      const key = activeCuesKey(track);
      if (!key) return;

      if (!shouldEmitTrackKey(key)) return;

      const txt = readActiveCues(track);
      if (!txt) return;

      // Fallback por texto (por si la plataforma tiene cues raros)
      if (txt === S.lastTrackSeen) return;
      S.lastTrackSeen = txt;

      KWSR.voice?.leerTextoAccesible?.(txt);
    };

    // Lectura inicial (si ya hay cue activo)
    const initKey = activeCuesKey(track);
    if (initKey && shouldEmitTrackKey(initKey)) {
      const initial = readActiveCues(track);
      if (initial && initial !== S.lastTrackSeen) {
        S.lastTrackSeen = initial;
        KWSR.voice?.leerTextoAccesible?.(initial);
      }
    }
  }

  // ------------------------------------------------------------
  // startTrack():
  // Activa TRACK como fuente efectiva.
  // - elige mejor pista
  // - engancha eventos
  // - actualiza overlay
  // ------------------------------------------------------------
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

    // Si cambió la pista, re-attach
    if (best !== S.currentTrack) {
      S.currentTrack = best;
      attachTrack(best);

      KWSR.overlay?.updateOverlayTracksList?.();
      KWSR.overlay?.updateOverlayStatus?.();

      KWSR.log?.("TRACK activo:", KWSR.overlay?.describeTrack?.(best) || {
        label: best.label,
        lang: best.language,
        mode: best.mode,
        cues: best.cues?.length ?? 0
      });
    }

    return true;
  }

  // ------------------------------------------------------------
  // pollTrackTick():
  // Fallback por timer. Sirve cuando:
  // - la plataforma no dispara oncuechange confiable
  // - o hay frames donde se pierde el evento
  //
  // Nota: dedupe por key evita duplicar con oncuechange.
  // ------------------------------------------------------------
  function pollTrackTick() {
    if (!KWSR.voice?.shouldReadNow?.()) return;
    if (S.effectiveFuente !== "track") return;
    if (!S.currentTrack) return;

    const key = activeCuesKey(S.currentTrack);
    if (!key) return;

    if (!shouldEmitTrackKey(key)) return;

    const txt = readActiveCues(S.currentTrack);
    if (!txt) return;

    if (txt === S.lastTrackSeen) return;
    S.lastTrackSeen = txt;

    KWSR.voice?.leerTextoAccesible?.(txt);
  }

  // Export del módulo
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

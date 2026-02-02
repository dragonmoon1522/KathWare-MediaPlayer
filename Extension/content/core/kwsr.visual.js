// -----------------------------------------------------------------------------
// KathWare SubtitleReader - kwsr.visual.js
// -----------------------------------------------------------------------------
//
// OBJETIVO
// --------
// Este módulo implementa la fuente VISUAL:
// lee subtítulos que están “dibujados” en el DOM (spans/divs).
//
// ¿Por qué existe?
// - Algunas plataformas NO exponen pistas por video.textTracks,
//   o las exponen vacías / “ghost”.
// - Entonces necesitamos plan B: leer el texto que se ve en pantalla.
//
// El problema real (Netflix/Max)
// ------------------------------
// Que el subtítulo “se vea quieto” NO significa que el DOM esté quieto.
// Netflix/Max re-renderizan el mismo texto muchas veces:
// - reemplazan spans
// - duplican nodos
// - cambian <br> / layout interno
// - mutan sin que el texto visible cambie
//
// Si leemos “por cualquier mutación”, terminamos repitiendo el subtítulo.
//
// Solución canónica que aplicamos acá
// ----------------------------------
// 1) Netflix/Max: leemos un “snapshot” del CONTENEDOR (bloque completo),
//    no de cada span suelto.
// 2) Gate determinístico: si el texto es el mismo (o casi) y el video
//    casi no avanzó, entonces fue re-render => NO leer otra vez.
//
// Importante
// ----------
// - Este módulo NO crea UI.
// - Este módulo NO habla directo (no TTS acá).
//   Todo pasa por KWSR.voice (que decide lector/sintetizador/off).
// -----------------------------------------------------------------------------

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.visual) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;
  const normalize = KWSR.utils?.normalize || ((x) => String(x ?? "").trim());

  // Debug opt-in: para ver logs específicos de VISUAL
  // Recomendación: activar solo cuando estés depurando.
  const DEBUG = () => !!(CFG?.debug && CFG?.debugVisual);

  // -----------------------------------------------------------------------------
  // Plataforma y capacidades
  // -----------------------------------------------------------------------------
  function platform() {
    return KWSR.platforms?.getPlatform?.() || "generic";
  }

  function caps() {
    const p = platform();
    return KWSR.platforms?.platformCapabilities?.(p) || {};
  }

  // -----------------------------------------------------------------------------
  // Guardas: no leer nuestra UI (overlay/toast/live-region)
  // -----------------------------------------------------------------------------
  function isInsideKathWareUI(node) {
    try {
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      if (!el || !el.closest) return false;

      return !!el.closest(
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

  // -----------------------------------------------------------------------------
  // Anti “menú de idioma/audio/subtítulos”
  // -----------------------------------------------------------------------------
  // Esto evita leer cosas del tipo:
  // “Audio: English, Español, Français…” o paneles de configuración.
  function isLanguageMenuText(text) {
    const t = normalize(text);
    if (!t) return false;

    const lower = t.toLowerCase();

    const strong =
      lower.includes("audio") ||
      lower.includes("subtítulos") ||
      lower.includes("subtitulos") ||
      lower.includes("subtitles") ||
      lower.includes("[cc]") ||
      lower.includes("cc ");

    if (!strong) return false;

    // Si aparecen muchos idiomas juntos, casi seguro es un menú.
    const hits = [
      "english","deutsch","español","espanol","français","francais","italiano","português","portugues",
      "polski","magyar","dansk","norsk","svenska","suomi","türkçe","turkce","čeština","cestina",
      "română","romana","slovenčina","slovencina","nederlands","ελληνικά","日本語","한국어",
      "chinese","简体","繁體","粵語","bokmål","brasil","canada"
    ].reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);

    if (hits >= 3) return true;

    // Menú largo + palabras de audio/subs => también sospechoso
    if (t.length > 160 && strong) return true;

    return false;
  }

  // -----------------------------------------------------------------------------
  // looksLikeNoise(node, text)
  // -----------------------------------------------------------------------------
  // Filtro “anti-basura”:
  // - no leer botones/links/tooltips/overlays
  // - no leer nuestra UI
  // - no leer cosas demasiado cortas o demasiado largas
  function looksLikeNoise(node, text) {
    const t = normalize(text);
    if (!t) return true;

    if (isInsideKathWareUI(node)) return true;
    if (isLanguageMenuText(t)) return true;

    // Elementos interactivos típicos: casi seguro NO son subtítulos.
    const tag = (node?.tagName || "").toUpperCase();
    if (["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "LABEL"].includes(tag)) return true;

    // Longitud razonable de subtítulo
    if (t.length < 2 || t.length > 420) return true;

    // Clases típicas de UI flotante
    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;

    return false;
  }

  // -----------------------------------------------------------------------------
  // Visibilidad (especialmente útil en Disney)
  // -----------------------------------------------------------------------------
  function isVisible(el) {
    try {
      if (!el || !(el instanceof Element)) return false;
      if (isInsideKathWareUI(el)) return false;

      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === "none" || style.visibility === "hidden") return false;

      const opacity = parseFloat(style.opacity || "1");
      if (opacity <= 0.01) return false;

      const r = el.getBoundingClientRect?.();
      if (!r) return true;
      if (r.width < 2 && r.height < 2) return false;

      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------------
  // Selectores por plataforma (desde kwsr.platforms.js)
  // -----------------------------------------------------------------------------
  function getSelectors() {
    const p = platform();
    return KWSR.platforms?.platformSelectors?.(p) || [];
  }

  function getFreshNodesBySelector(sel) {
    try {
      // Ojo: solo en document (no Shadow DOM).
      // Para captions suele alcanzar, y es más barato.
      return Array.from(document.querySelectorAll(sel)).filter(n => !isInsideKathWareUI(n));
    } catch {
      return [];
    }
  }

  // -----------------------------------------------------------------------------
  // containerKeyForNode(node)
  // -----------------------------------------------------------------------------
  // Genera una “clave” del contenedor de captions.
  // Sirve para dedupe: si el texto viene del mismo bloque del DOM.
  function containerKeyForNode(n) {
    try {
      const el = n?.nodeType === 1 ? n : n?.parentElement;
      if (!el) return "no-el";
      if (isInsideKathWareUI(el)) return "kathware-ui";

      const wrap =
        el.closest?.(
          "[data-testid*='cue']," +
          "[data-uia*='subtitle']," +
          "[data-uia*='captions']," +
          "[class*='caption']," +
          "[class*='subtitle']," +
          "[class*='timedtext']"
        ) || el;

      const tag = (wrap.tagName || "").toLowerCase();
      const tid = wrap.getAttribute("data-testid") || "";
      const uia = wrap.getAttribute("data-uia") || "";
      const cls = String(wrap.className || "").slice(0, 120);

      return `${tag}|${tid}|${uia}|${cls}`;
    } catch {
      return "key-err";
    }
  }

  // -----------------------------------------------------------------------------
  // smartJoinLines(parts)
  // -----------------------------------------------------------------------------
  // Une pedazos de texto (spans) en una frase “humana”.
  // Evita pegar palabras sin espacio.
  function smartJoinLines(parts) {
    if (!parts || !parts.length) return "";

    let out = "";

    for (let i = 0; i < parts.length; i++) {
      const chunk = normalize(parts[i]);
      if (!chunk) continue;

      if (!out) {
        out = chunk;
        continue;
      }

      const prev = out;
      const lastChar = prev.slice(-1);
      const firstChar = chunk.slice(0, 1);

      const needSpace =
        /[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(lastChar) &&
        /[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(firstChar);

      const strongPunct = /[.!?…]$/.test(prev.trim());

      out = prev.trim() + (strongPunct || needSpace ? " " : "") + chunk;
    }

    return normalize(out);
  }

  // -----------------------------------------------------------------------------
  // readTextFromNodes(nodes, platform)
  // -----------------------------------------------------------------------------
  // Punto clave:
  // - Netflix/Max: snapshot del CONTENEDOR (bloque completo).
  // - Resto: juntamos spans/divs y armamos texto.
  function readTextFromNodes(nodes, p) {
    if (!nodes?.length) return { text: "", key: "" };

    // Netflix/Max: snapshot del contenedor (tolerante al re-render)
    if (p === "netflix" || p === "max") {
      for (const n of nodes) {
        const el = n?.nodeType === 1 ? n : n?.parentElement;
        if (!el) continue;
        if (isInsideKathWareUI(el)) continue;

        // Netflix suele tener .player-timedtext-text-container como contenedor real.
        // Si el selector apuntó a un span interno, subimos al contenedor.
        const cont = el.closest?.(".player-timedtext-text-container") || el;

        // innerText suele respetar <br> mejor que textContent
        let raw = "";
        try { raw = cont.innerText || cont.textContent || ""; } catch {}

        const t = normalize(raw);
        if (!t) continue;

        if (isLanguageMenuText(t)) continue;
        if (looksLikeNoise(cont, t)) continue;

        const key = containerKeyForNode(cont);
        return { text: t, key };
      }

      return { text: "", key: "" };
    }

    // Default: resto de plataformas
    const parts = [];
    let key = "";

    for (const n of nodes) {
      if (!n) continue;
      if (isInsideKathWareUI(n)) continue;

      // Disney: gate por visibilidad para no leer basura del DOM
      if (p === "disney" && !isVisible(n)) continue;

      const t = normalize(n.textContent);
      if (!t) continue;

      if (p === "disney" && isLanguageMenuText(t)) continue;
      if (looksLikeNoise(n, t)) continue;

      if (!key) key = containerKeyForNode(n);
      parts.push(t);
    }

    if (!parts.length) return { text: "", key: "" };

    const joined = smartJoinLines(parts).replace(/\s+/g, " ").trim();
    return { text: joined, key: key || "no-key" };
  }

  // -----------------------------------------------------------------------------
  // pickBestSelector(platform)
  // -----------------------------------------------------------------------------
  // Elige el primer selector que entregue texto “real”.
  function pickBestSelector(p) {
    const selectors = getSelectors();
    for (const sel of selectors) {
      const nodes = getFreshNodesBySelector(sel);
      if (!nodes.length) continue;

      const { text } = readTextFromNodes(nodes, p);
      if (text) return sel;
    }
    return "";
  }

  // -----------------------------------------------------------------------------
  // Fingerprints (huellas) para dedupe
  // -----------------------------------------------------------------------------
  function fpStrict(text) {
    return normalize(text)
      .replace(/\u00A0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function fpLoose(text) {
    return normalize(text)
      .replace(/\u00A0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[\/|·•–—]+/g, " ")
      .replace(/[.,;:!?¡¿"“”'’()\[\]{}]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // -----------------------------------------------------------------------------
  // Tiempo del video (para gate Netflix/Max)
  // -----------------------------------------------------------------------------
  function getVideoTimeSec() {
    try {
      const v = S.currentVideo || KWSR.video?.getMainVideo?.();
      if (!v) return null;

      const t = Number(v.currentTime || 0);
      return Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------------
  // Control del observer
  // -----------------------------------------------------------------------------
  function stopVisualObserver() {
    try { S.visualObserver?.disconnect?.(); } catch {}
    S.visualObserver = null;
    S.visualObserverActive = false;

    S._visualScheduled = false;
    S.visualDirty = false;
    S.visualDirtyAt = 0;
  }

  // Resetea la “memoria” de dedupe visual.
  // Usar solo en: apagado total / cambio real de video / restart fuerte.
  function resetVisualDedupe() {
    S._visualLastAt = 0;
    S._visualLastText = "";
    S._visualLastKey = "";
    S._visualLastStrict = "";
    S._visualLastLoose = "";
    S._visualLastVideoTimeSec = null;

    // compat con lógica previa
    S.lastVisualSeen = "";
  }

  // -----------------------------------------------------------------------------
  // Scheduler: 1 lectura por frame si hubo mutaciones
  // -----------------------------------------------------------------------------
  function requestVisualFrame(reasonNode) {
    if (S._visualScheduled) return;
    S._visualScheduled = true;

    // RAF reduce “ráfagas”: muchas mutaciones -> 1 lectura final
    requestAnimationFrame(() => {
      S._visualScheduled = false;
      pollVisualTick(true, reasonNode);
    });
  }

  function scheduleVisualRead(reasonNode) {
    if (S.effectiveFuente !== "visual") return;
    if (reasonNode && isInsideKathWareUI(reasonNode)) return;

    const p = platform();

    // Disney: si la mutación no toca la zona de subtitles, ignoramos
    if (p === "disney" && reasonNode) {
      try {
        const el = reasonNode.nodeType === 1 ? reasonNode : reasonNode.parentElement;
        if (el && !el.closest?.(".hive-subtitle-renderer-line,[class*='hive-subtitle-renderer-line']")) {
          return;
        }
      } catch {}
    }

    S.visualDirty = true;
    S.visualDirtyAt = performance.now();
    requestVisualFrame(reasonNode);
  }

  // -----------------------------------------------------------------------------
  // startVisual()
  // -----------------------------------------------------------------------------
  // - Elige selector “mejor”
  // - Enciende MutationObserver
  // - Observa documentElement o body según capabilities
  function startVisual() {
    const p = platform();

    S.visualSelectors = getSelectors();
    S.visualSelectorUsed = pickBestSelector(p);

    stopVisualObserver();

    const useDocObserver = !!caps().visualDocObserver;

    try {
      S.visualObserver = new MutationObserver((mutations) => {
        if (!mutations || !mutations.length) return;

        let reasonNode = null;
        for (const m of mutations) {
          if (m.target) { reasonNode = m.target; break; }
          if (m.addedNodes && m.addedNodes[0]) { reasonNode = m.addedNodes[0]; break; }
        }

        if (reasonNode && isInsideKathWareUI(reasonNode)) return;
        scheduleVisualRead(reasonNode);
      });

      const target = useDocObserver ? document.documentElement : (document.body || document.documentElement);

      S.visualObserver.observe(target, {
        childList: true,
        subtree: true,
        characterData: true
      });

      S.visualObserverActive = true;

      if (DEBUG()) {
        KWSR.log?.("VISUAL start", {
          platform: p,
          selector: S.visualSelectorUsed,
          docObserver: useDocObserver
        });
      }
    } catch (e) {
      S.visualObserverActive = false;
      if (DEBUG()) KWSR.warn?.("VISUAL observer failed", { err: String(e?.message || e) });
    }

    KWSR.overlay?.updateOverlayStatus?.();
  }

  // -----------------------------------------------------------------------------
  // pollVisualTick(fromObserver, reasonNode)
  // -----------------------------------------------------------------------------
  // - Si observer está activo, el poll es fallback (no debe hablar solo).
  // - Si viene del observer, solo lee si hubo “dirty”.
  // - Aplica dedupe robusto + (Netflix/Max) gate por tiempo del video.
  function pollVisualTick(fromObserver = false, reasonNode = null) {
    if (!KWSR.voice?.shouldReadNow?.()) return;
    if (S.effectiveFuente !== "visual") return;

    // Si hay observer activo, el poll “manual” no debe hablar
    if (!fromObserver && S.visualObserverActive) return;

    if (fromObserver) {
      if (!S.visualDirty) return;
      S.visualDirty = false;
    }

    if (reasonNode && isInsideKathWareUI(reasonNode)) return;

    const p = platform();
    if (!S.visualSelectors) S.visualSelectors = getSelectors();

    // Si no tenemos selector elegido, intentamos elegir uno
    if (!S.visualSelectorUsed) {
      S.visualSelectorUsed = pickBestSelector(p);
      if (!S.visualSelectorUsed) return;
    }

    const nodes = getFreshNodesBySelector(S.visualSelectorUsed);
    const { text, key } = readTextFromNodes(nodes, p);
    if (!text) return;

    const strict = fpStrict(text);
    const loose  = fpLoose(text);

    // -------------------------------------------------------------------------
    // Netflix/Max: gate determinístico contra re-render
    // -------------------------------------------------------------------------
    const isRerenderPlatform = (p === "netflix" || p === "max");

    const tNow = getVideoTimeSec();
    const lastT = (typeof S._visualLastVideoTimeSec === "number") ? S._visualLastVideoTimeSec : null;

    const lastStrict = (S._visualLastStrict || "");
    const lastLoose  = (S._visualLastLoose  || "");

    const sameTextish =
      (strict && strict === lastStrict) ||
      (loose  && loose  === lastLoose)  ||
      (lastLoose && loose && (lastLoose.includes(loose) || loose.includes(lastLoose)));

    if (isRerenderPlatform && tNow != null && lastT != null && sameTextish) {
      const dtVideo = Math.abs(tNow - lastT);

      // Umbral: cuánto “avanza” el video para considerar que es otro subtitle
      const gate = (p === "max") ? 0.40 : 0.35;

      // Si el video no avanzó y el texto “es el mismo”, fue re-render
      if (dtVideo < gate) {
        // Actualizamos estado para cortar ráfagas
        S._visualLastVideoTimeSec = tNow;
        S._visualLastStrict = strict;
        S._visualLastLoose = loose;

        if (DEBUG()) KWSR.log?.("VISUAL dedupe (videoTime+textish)", { dtVideo, gate, text });
        return;
      }
    }

    // -------------------------------------------------------------------------
    // Dedupe normal (ventanas temporales + key)
    // -------------------------------------------------------------------------
    const now = performance.now();

    const minRepeatMs = isRerenderPlatform ? 950 : 700;
    const allowRepeatAfterMs = isRerenderPlatform ? 2200 : 1700;

    const sameKey = key && key === (S._visualLastKey || "");
    const sameStrict = strict && strict === lastStrict;
    const sameLoose  = loose  && loose  === lastLoose;

    if ((sameStrict || sameLoose) && sameKey) {
      const dt = now - (S._visualLastAt || 0);

      // “fast”: duplicado inmediato (muy probable re-render o doble mutación)
      if (dt < minRepeatMs) {
        if (DEBUG()) KWSR.log?.("VISUAL dedupe (fast)", { dt: Math.round(dt), text });
        return;
      }

      // “grey”: repetición en ventana gris (todavía probable re-render)
      if (dt < allowRepeatAfterMs) {
        if (DEBUG()) KWSR.log?.("VISUAL dedupe (grey)", { dt: Math.round(dt), text });
        return;
      }
    }

    // Fallback histórico si el poll corre sin observer
    if (!fromObserver && strict && strict === S.lastVisualSeen) return;
    S.lastVisualSeen = strict || text;

    // Guardar estado dedupe
    S._visualLastText = text;
    S._visualLastKey = key || "";
    S._visualLastAt = now;
    S._visualLastStrict = strict;
    S._visualLastLoose = loose;

    if (tNow != null) S._visualLastVideoTimeSec = tNow;

    if (DEBUG()) KWSR.log?.("VISUAL speak", { selector: S.visualSelectorUsed, key, fromObserver, text });

    // Delegamos salida final a VOICE (TTS/lector/dedupe global)
    KWSR.voice?.leerTextoAccesible?.(text);
  }

  // -----------------------------------------------------------------------------
  // visualReselectTick()
  // -----------------------------------------------------------------------------
  // Re-evalúa selector si el DOM cambió fuerte (plataformas que re-renderizan todo).
  function visualReselectTick() {
    const p = platform();
    const next = pickBestSelector(p);

    if (next && next !== (S.visualSelectorUsed || "")) {
      S.visualSelectorUsed = next;
      startVisual();
    }
  }

  // -----------------------------------------------------------------------------
  // Export del módulo
  // -----------------------------------------------------------------------------
  KWSR.visual = {
    startVisual,
    stopVisualObserver,
    pollVisualTick,
    visualReselectTick,
    resetVisualDedupe
  };

})();
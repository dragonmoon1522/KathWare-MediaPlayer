// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// ====================================================
//
// ¿Qué hace este módulo?
// - Lee subtítulos “VISUALES”: texto renderizado en el DOM (spans/divs).
//
// ¿Por qué existe?
// - Algunas plataformas NO exponen pistas accesibles por video.textTracks,
//   o las exponen “vacías/ghost”. Entonces necesitamos plan B: leer lo que se ve.
//
// El problema real (Netflix/Max):
// - Que el subtítulo “se vea quieto” NO significa que el DOM esté quieto.
// - Netflix/Max re-renderizan el mismo texto varias veces:
//     * reemplazan spans,
//     * meten/quitan <br>,
//     * duplican spans,
//     * cambian nodos sin cambiar el texto visible.
// - Si nosotros disparamos lectura por “cualquier mutación”, terminamos repitiendo.
//
// La solución canónica:
// 1) Para Netflix/Max: leer un “snapshot” del CONTENEDOR de captions (bloque completo),
//    no cada span suelto. Así no importa si hay <br> o si duplican spans.
// 2) Gate determinístico: si el texto es el mismo y el video casi no avanzó,
//    consideramos re-render => NO leer de nuevo.
//
// Importante:
// - Este módulo NO crea UI.
// - Este módulo NO usa TTS directo: delega a KWSR.voice.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.visual) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;
  const { normalize } = KWSR.utils;

  // Debug opt-in: CFG.debugVisual = true
  const DEBUG = () => !!(CFG?.debug && CFG?.debugVisual);

  // ------------------------------------------------------------
  // Plataforma / capabilities
  // ------------------------------------------------------------
  function platform() {
    return KWSR.platforms?.getPlatform?.() || "generic";
  }

  function caps() {
    const p = platform();
    return KWSR.platforms?.platformCapabilities?.(p) || {};
  }

  // ------------------------------------------------------------
  // Guardas: NO leer nuestra UI (overlay/toast/live-region)
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // Anti “menú de idiomas / audio / subtítulos” (ruido común)
  // ------------------------------------------------------------
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

    const hits = [
      "english","deutsch","español","espanol","français","francais","italiano","português","portugues",
      "polski","magyar","dansk","norsk","svenska","suomi","türkçe","turkce","čeština","cestina",
      "română","romana","slovenčina","slovencina","nederlands","ελληνικά","日本語","한국어",
      "chinese","简体","繁體","粵語","bokmål","brasil","canada"
    ].reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);

    if (hits >= 3) return true;
    if (t.length > 160 && strong) return true;

    return false;
  }

  // ------------------------------------------------------------
  // looksLikeNoise(node, text):
  // Filtro anti-basura para no leer UI, botones, tooltips, etc.
  // ------------------------------------------------------------
  function looksLikeNoise(node, text) {
    const t = normalize(text);
    if (!t) return true;

    // Nunca leer nuestra UI.
    if (isInsideKathWareUI(node)) return true;

    // Menús de idioma/audio/subs: ruido.
    if (isLanguageMenuText(t)) return true;

    // Elementos típicos de UI interactiva: no son subtítulos.
    const tag = (node?.tagName || "").toUpperCase();
    if (["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "LABEL"].includes(tag)) return true;

    // Reglas de longitud razonables.
    if (t.length < 2 || t.length > 420) return true;

    // Clases típicas de UI flotante/alertas: ruido.
    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;

    return false;
  }

  // ------------------------------------------------------------
  // Visibilidad (especialmente útil en Disney, pero aplica en general)
  // ------------------------------------------------------------
  function isVisible(el) {
    try {
      if (!el || !(el instanceof Element)) return false;

      // Nunca “visible” si es nuestra UI.
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

  // ------------------------------------------------------------
  // Selectores por plataforma (vienen del módulo platforms)
  // ------------------------------------------------------------
  function getSelectors() {
    const p = platform();
    return KWSR.platforms?.platformSelectors?.(p) || [];
  }

  function getFreshNodesBySelector(sel) {
    try {
      return Array.from(document.querySelectorAll(sel)).filter(n => !isInsideKathWareUI(n));
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------
  // containerKeyForNode:
  // “Clave” del contenedor de captions.
  // Sirve para dedupe: si viene del mismo “bloque” (misma zona del DOM).
  // ------------------------------------------------------------
  function containerKeyForNode(n) {
    try {
      const el = n?.nodeType === 1 ? n : n?.parentElement;
      if (!el) return "no-el";

      // Nunca key de nuestra UI.
      if (isInsideKathWareUI(el)) return "kathware-ui";

      const wrap =
        el.closest?.(
          "[data-testid*='cue'],[data-uia*='subtitle'],[data-uia*='captions'],[class*='caption'],[class*='subtitle'],[class*='timedtext']"
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

  // ------------------------------------------------------------
  // smartJoinLines:
  // Une pedazos de subtítulos de forma “humana”.
  // (Lo usamos en plataformas donde el texto viene partido por spans)
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // readTextFromNodes(nodes, p):
  //
  // Este es EL lugar clave del cambio Netflix/Max.
  //
  // Antes:
  // - Leíamos textContent de spans individuales.
  // - Si Netflix duplicaba spans o cambiaba <br>, leíamos repetido.
  //
  // Ahora (Netflix/Max):
  // - Leemos el “bloque contenedor” del subtítulo:
  //     .player-timedtext-text-container
  // - Y hacemos snapshot con innerText (respeta <br> como salto).
  //
  // Resultado:
  // - No importa si Netflix cambia el render (con <br> o sin <br>, 1 span o 2 spans),
  //   porque el texto final visible del contenedor es el que manda.
  // ------------------------------------------------------------
  function readTextFromNodes(nodes, p) {
    if (!nodes?.length) return { text: "", key: "" };

    // ✅ Netflix/Max: snapshot del contenedor (independiente del “layout” interno)
    if (p === "netflix" || p === "max") {
      for (const n of nodes) {
        const el = n?.nodeType === 1 ? n : n?.parentElement;
        if (!el) continue;
        if (isInsideKathWareUI(el)) continue;

        // Netflix: el contenedor real suele ser player-timedtext-text-container.
        // A veces el selector apunta a un span interno: subimos al contenedor.
        const isNetflixContainer =
          el.classList?.contains("player-timedtext-text-container") ||
          el.closest?.(".player-timedtext-text-container") === el;

        const cont = isNetflixContainer
          ? el
          : (el.closest?.(".player-timedtext-text-container") || el);

        // innerText respeta <br> como salto; textContent a veces “pega” líneas.
        let raw = "";
        try { raw = cont.innerText || cont.textContent || ""; } catch {}

        // Normalizamos: saltos de línea -> espacio.
        const t = normalize(raw).replace(/\s*\n+\s*/g, " ").trim();

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

      // Disney: DOM caótico → gate por visibilidad
      if (p === "disney" && !isVisible(n)) continue;

      const raw = n.textContent;
      const t = normalize(raw);
      if (!t) continue;

      if (p === "disney" && isLanguageMenuText(t)) continue;
      if (looksLikeNoise(n, t)) continue;

      if (!key) key = containerKeyForNode(n);
      parts.push(t);
    }

    if (!parts.length) return { text: "", key: "" };

    // Dedup y join “humano”
    const joined = smartJoinLines(parts).replace(/\s+/g, " ").trim();
    return { text: joined, key: key || "no-key" };
  }

  // ------------------------------------------------------------
  // pickBestSelector:
  // Encuentra el primer selector que devuelva texto “real”
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // Fingerprints para dedupe
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // Tiempo de video:
  // Lo usamos como “compuerta determinística” contra re-render:
  // Si el video no avanzó y el texto “es el mismo”, no es un subtítulo nuevo.
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // Observer control
  // ------------------------------------------------------------
  function stopVisualObserver() {
    try { S.visualObserver?.disconnect?.(); } catch {}
    S.visualObserver = null;
    S.visualObserverActive = false;

    S._visualScheduled = false;
    S.visualDirty = false;
    S.visualDirtyAt = 0;
  }

  // Reset “memoria” del visual.
  // Ojo: esto solo debería usarse en apagado total / nuevo video / restart.
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

  // RAF scheduler: 1 lectura por frame si hubo mutaciones.
  function requestVisualFrame(reasonNode) {
    if (S._visualScheduled) return;
    S._visualScheduled = true;

    requestAnimationFrame(() => {
      S._visualScheduled = false;
      pollVisualTick(true, reasonNode);
    });
  }

  function scheduleVisualRead(reasonNode) {
    if (S.effectiveFuente !== "visual") return;
    if (reasonNode && isInsideKathWareUI(reasonNode)) return;

    // Disney gating extra: si la mutación no toca subtítulos, ignoramos
    const p = platform();
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

  // ------------------------------------------------------------
  // startVisual:
  // - Elige selector “mejor”
  // - Prende observer (doc o body según caps)
  // ------------------------------------------------------------
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

      if (DEBUG()) KWSR.log?.("VISUAL start", { platform: p, selector: S.visualSelectorUsed, docObserver: useDocObserver });
    } catch (e) {
      S.visualObserverActive = false;
      if (DEBUG()) KWSR.warn?.("VISUAL observer failed", { err: String(e?.message || e) });
    }

    KWSR.overlay?.updateOverlayStatus?.();
  }

  // ------------------------------------------------------------
  // pollVisualTick:
  // - Si observer está activo, poll es fallback (no habla por sí mismo).
  // - Si viene del observer, solo lee si hubo “dirty”.
  // - Aplica dedupe robusto + (Netflix/Max) dedupe por tiempo de video.
  // ------------------------------------------------------------
  function pollVisualTick(fromObserver = false, reasonNode = null) {
    if (!KWSR.voice?.shouldReadNow?.()) return;
    if (S.effectiveFuente !== "visual") return;

    if (!fromObserver && S.visualObserverActive) return;

    if (fromObserver) {
      if (!S.visualDirty) return;
      S.visualDirty = false;
    }

    if (reasonNode && isInsideKathWareUI(reasonNode)) return;

    const p = platform();
    if (!S.visualSelectors) S.visualSelectors = getSelectors();

    if (!S.visualSelectorUsed) {
      S.visualSelectorUsed = pickBestSelector(p);
      if (!S.visualSelectorUsed) return;
    }

    const nodes = getFreshNodesBySelector(S.visualSelectorUsed);
    const { text, key } = readTextFromNodes(nodes, p);
    if (!text) return;

    const strict = fpStrict(text);
    const loose  = fpLoose(text);

    // ------------------------------------------------------------
    // Netflix/Max: “compuerta determinística” anti re-render
    // ------------------------------------------------------------
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
      const gate = (p === "max") ? 0.40 : 0.35;

      // Si el video no avanzó casi nada y el texto “es el mismo”:
      // => Netflix solo re-renderizó, NO es subtítulo nuevo.
      if (dtVideo < gate) {
        // Actualizamos igual para cortar ráfagas en renderers nerviosos
        S._visualLastVideoTimeSec = tNow;
        S._visualLastStrict = strict;
        S._visualLastLoose = loose;

        if (DEBUG()) KWSR.log?.("VISUAL dedupe (videoTime+textish)", { dtVideo, gate, text });
        return;
      }
    }

    // ------------------------------------------------------------
    // Dedupe “normal” (por key + ventanas temporales)
    // ------------------------------------------------------------
    const now = performance.now();

    const minRepeatMs = isRerenderPlatform ? 950 : 700;
    const allowRepeatAfterMs = isRerenderPlatform ? 2200 : 1700;

    const sameKey = key && key === (S._visualLastKey || "");
    const sameStrict = strict && strict === lastStrict;
    const sameLoose  = loose  && loose  === lastLoose;

    if ((sameStrict || sameLoose) && sameKey) {
      const dt = now - (S._visualLastAt || 0);
      if (dt < minRepeatMs) {
        if (DEBUG()) KWSR.log?.("VISUAL dedupe (fast)", { dt: Math.round(dt), text });
        return;
      }
      if (dt < allowRepeatAfterMs) {
        if (DEBUG()) KWSR.log?.("VISUAL dedupe (grey)", { dt: Math.round(dt), text });
        return;
      }
    }

    // Fallback histórico (por si el poll corre sin observer)
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

    // Delegamos salida final a VOICE (dedupe global + lector/TTS)
    KWSR.voice?.leerTextoAccesible?.(text);
  }

  // ------------------------------------------------------------
  // visualReselectTick:
  // Re-evalúa selector por si el DOM cambió fuerte
  // ------------------------------------------------------------
  function visualReselectTick() {
    const p = platform();
    const next = pickBestSelector(p);
    if (next && next !== (S.visualSelectorUsed || "")) {
      S.visualSelectorUsed = next;
      startVisual();
    }
  }

  // Export público
  KWSR.visual = {
    startVisual,
    stopVisualObserver,
    pollVisualTick,
    visualReselectTick,
    resetVisualDedupe
  };

})();

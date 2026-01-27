// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// ====================================================
//
// ¿Qué hace este módulo?
// - Lee subtítulos “VISUALES”: texto renderizado en el DOM (spans/divs).
//
// ¿Por qué existe?
// - Muchas plataformas NO exponen tracks accesibles via video.textTracks.
// - O exponen tracks “fantasma” sin cues útiles.
// - Entonces necesitamos un plan B: leer lo que se ve en pantalla.
//
// Cómo funciona (idea simple):
// 1) Elegimos un selector CSS candidato (según plataforma).
// 2) Observamos cambios en el DOM (MutationObserver).
// 3) Cuando cambia algo, leemos el texto y lo mandamos a KWSR.voice.
// 4) Tenemos dedupe fuerte para no leer lo mismo 2-10 veces.
//
// Importante:
// - Este módulo NO crea UI.
// - Este módulo NO usa TTS directamente: delega en KWSR.voice.
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
  // Helpers de plataforma / capabilities
  // ------------------------------------------------------------
  function platform() {
    return KWSR.platforms?.getPlatform?.() || "generic";
  }

  function caps() {
    const p = platform();
    return KWSR.platforms?.platformCapabilities?.(p) || {};
  }

  // ------------------------------------------------------------
  // Guardas: NO leer nuestra propia UI (overlay/toast/live-region)
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
  // “Clave” del contenedor de captions para diferenciar dónde salió el texto.
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
  // Une líneas/pedazos de subtítulos de forma “humana”.
  // Evita "limpiamosel" cuando separan spans sin espacios.
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
  // readTextFromNodes(nodes):
  // - Filtra ruido
  // - Dedup interna de piezas exactas
  // - Devuelve { text, key }
  // ------------------------------------------------------------
  function readTextFromNodes(nodes, p) {
    if (!nodes?.length) return { text: "", key: "" };

    const parts = [];
    let key = "";

    for (const n of nodes) {
      if (!n) continue;

      if (isInsideKathWareUI(n)) continue;

      // Disney: gate por visibilidad (DOM caótico)
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

    const uniq = [];
    const seen = new Set();
    for (const x of parts) {
      if (seen.has(x)) continue;
      seen.add(x);
      uniq.push(x);
    }

    return { text: smartJoinLines(uniq), key: key || "no-key" };
  }

  // ------------------------------------------------------------
  // pickBestSelector:
  // Encuentra el primer selector que “devuelva texto real”.
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
  // Fingerprints para dedupe VISUAL
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
  // Tiempo de video (para Netflix/Max anti re-render)
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

  // Nota importante:
  // - stopVisualObserver() SOLO desconecta el observer y resetea flags de scheduling.
  // - NO borra el dedupe histórico, para no re-leer el mismo subtítulo si rehook/reselect reinicia.
  function stopVisualObserver() {
    try { S.visualObserver?.disconnect?.(); } catch {}
    S.visualObserver = null;
    S.visualObserverActive = false;

    S._visualScheduled = false;
    S.visualDirty = false;
    S.visualDirtyAt = 0;
  }

  // Esto se usa cuando realmente querés "borrar memoria" del visual:
  // (por ejemplo, al apagar extensión o reiniciar pipeline completo).
  function resetVisualDedupe() {
    S._visualLastAt = 0;
    S._visualLastText = "";
    S._visualLastKey = "";
    S._visualLastStrict = "";
    S._visualLastLoose = "";
    S._visualLastVideoTimeSec = null;

    // para compat con tu lógica previa
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
  // - Elige selectores
  // - Elige “mejor selector”
  // - Prende observer (doc o body según caps)
  // ------------------------------------------------------------
  function startVisual() {
    const p = platform();
    S.visualSelectors = getSelectors();
    S.visualSelectorUsed = pickBestSelector(p);

    // Ojo: acá NO reseteamos dedupe histórico.
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
  // - Si observer está activo, poll es SOLO fallback (no habla).
  // - Si viene del observer, solo lee si hubo “dirty”.
  // - Aplica dedupe robusto + (Netflix/Max) dedupe por tiempo de video.
  // ------------------------------------------------------------
  function pollVisualTick(fromObserver = false, reasonNode = null) {
    if (!KWSR.voice?.shouldReadNow?.()) return;
    if (S.effectiveFuente !== "visual") return;

    // Si el tick NO viene del observer y el observer está activo: no hacemos nada.
    if (!fromObserver && S.visualObserverActive) return;

    // Si viene del observer pero no hubo cambios: nada.
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
    // Netflix/Max: anti re-render por tiempo de video (independiente del key)
    // ------------------------------------------------------------
    const isRerenderPlatform = (p === "netflix" || p === "max");
    const tNow = getVideoTimeSec();
    const lastT = (typeof S._visualLastVideoTimeSec === "number") ? S._visualLastVideoTimeSec : null;

    if (isRerenderPlatform && tNow != null && lastT != null) {
      const dtVideo = Math.abs(tNow - lastT);

      const sameText =
        (strict && strict === (S._visualLastStrict || "")) ||
        (loose  && loose  === (S._visualLastLoose  || ""));

      // Netflix vs Max: umbral distinto (Max suele ser más "re-render con delay")
      const gate = (p === "max") ? 0.40 : 0.35;

      // Si el texto es el mismo y el video no avanzó casi nada, es re-render => no repetir
      if (sameText && dtVideo < gate) {
        // 🔧 tweak: actualizar lastVideoTime igual, para cortar ráfagas con microavance
        S._visualLastVideoTimeSec = tNow;

        if (DEBUG()) KWSR.log?.("VISUAL dedupe (videoTime)", { dtVideo, gate, text });
        return;
      }
    }

    // ------------------------------------------------------------
    // Dedupe VISUAL robusto (strict/loose + key + ventanas)
    // ------------------------------------------------------------
    const now = performance.now();

    // Netflix/Max: más agresivo en ventana corta
    const minRepeatMs = isRerenderPlatform ? 950 : 700;
    const allowRepeatAfterMs = isRerenderPlatform ? 2200 : 1700;

    const sameKey = key && key === (S._visualLastKey || "");
    const sameStrict = strict && strict === (S._visualLastStrict || "");
    const sameLoose  = loose  && loose  === (S._visualLastLoose  || "");

    // Caso “normal”: mismo contenedor + mismo texto => bloquear dentro de ventanas
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

    // Extra: si por alguna razón no hay key estable, igual evitamos loops obvios en poll
    if (!fromObserver && strict && strict === S.lastVisualSeen) return;
    S.lastVisualSeen = strict || text;

    // Guardar estado dedupe
    S._visualLastText = text;
    S._visualLastKey = key || "";
    S._visualLastAt = now;
    S._visualLastStrict = strict;
    S._visualLastLoose = loose;

    // Guardar tiempo de video si existe (para Netflix/Max)
    if (tNow != null) S._visualLastVideoTimeSec = tNow;

    if (DEBUG()) KWSR.log?.("VISUAL speak", { selector: S.visualSelectorUsed, key, fromObserver, text });

    // Delegamos la salida final al módulo voice (que tiene dedupe global también)
    KWSR.voice?.leerTextoAccesible?.(text);
  }

  // ------------------------------------------------------------
  // visualReselectTick:
  // Re-evalúa qué selector es “mejor” (por si el DOM cambió fuerte).
  // Si cambia, reinicia observer (sin borrar dedupe histórico).
  // ------------------------------------------------------------
  function visualReselectTick() {
    const p = platform();
    const next = pickBestSelector(p);
    if (next && next !== (S.visualSelectorUsed || "")) {
      S.visualSelectorUsed = next;
      startVisual();
    }
  }

  // Export público del módulo
  KWSR.visual = {
    startVisual,
    stopVisualObserver,
    pollVisualTick,
    visualReselectTick,

    // útil para pipeline cuando hace “apagado total”
    resetVisualDedupe
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - FIX: Nunca leer nodos dentro de la UI de KathWare (overlay/toast/live region).
  - FIX: Dedupe VISUAL robusto (fingerprint strict/loose + key + ventanas temporales).
  - FIX: Netflix/Max: dedupe adicional por tiempo de video (evita re-render eco aunque cambie el contenedor).
  - NEW: Netflix gate = 0.35s, Max gate = 0.40s.
  - NEW: En dedupe por videoTime, actualizamos _visualLastVideoTimeSec igual para cortar ráfagas.
  - FIX: smartJoinLines evita “palabras pegadas” cuando el DOM separa nodos.
  - FIX: No se borra dedupe histórico al rehook/reselect (evita repetir subtítulo por restart del observer).
  - Se mantiene: Observer + Poll fallback (poll no habla si observer está activo).
  */
})();

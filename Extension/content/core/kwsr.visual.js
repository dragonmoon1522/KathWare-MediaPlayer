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

  // Debug opt-in: CFG.debugVisual = true (por consola con KWSR_CMD si querés)
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
  // Esto es CLAVE para evitar “auto-lectura” si alguna vez un selector
  // genérico matchea cosas nuestras.
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
      // Importante: filtramos nuestros nodos de UI acá también.
      return Array.from(document.querySelectorAll(sel)).filter(n => !isInsideKathWareUI(n));
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------
  // containerKeyForNode:
  // “Clave” del contenedor de captions para diferenciar dónde salió el texto.
  // Sirve para dedupe (texto igual, contenedor distinto = puede ser otra cosa).
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
  //
  // Cambio importante:
  // - Siempre asegura un espacio entre palabras si corresponde.
  // - Evita casos tipo "limpiamosel" cuando la plataforma separa nodos raro.
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

      // Si ambos lados son letras/números, metemos un espacio seguro.
      const needSpace =
        /[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(lastChar) &&
        /[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(firstChar);

      // Si el anterior termina con puntuación fuerte, también separo con espacio.
      const strongPunct = /[.!?…]$/.test(prev.trim());

      out = prev.trim() + (strongPunct || needSpace ? " " : "") + chunk;
    }

    return normalize(out);
  }

  // ------------------------------------------------------------
  // readTextFromNodes(nodes):
  // - Lee texto de una lista de nodos candidatos.
  // - Filtra ruido.
  // - Deduplica piezas exactas dentro del mismo frame.
  // - Devuelve: { text, key }
  // ------------------------------------------------------------
  function readTextFromNodes(nodes, p) {
    if (!nodes?.length) return { text: "", key: "" };

    const parts = [];
    let key = "";

    for (const n of nodes) {
      if (!n) continue;

      // Nunca leer nuestra UI.
      if (isInsideKathWareUI(n)) continue;

      // Disney: gate por visibilidad (porque rompe el DOM a lo bestia).
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

    // Uniq “exacto” (antes del join final).
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
  // Dedupe VISUAL (robusto):
  // Algunas plataformas re-renderizan el mismo subtítulo varias veces
  // con micro-diferencias (espacios, signos, separadores).
  //
  // Solución:
  // - fingerprintStrict: muy literal (normaliza fuerte + min cambios)
  // - fingerprintLoose: ignora signos comunes y separadores
  //
  // Si coincide dentro de una ventana temporal => NO hablar.
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
  // Observer control
  // ------------------------------------------------------------
  function stopVisualObserver() {
    try { S.visualObserver?.disconnect?.(); } catch {}
    S.visualObserver = null;
    S.visualObserverActive = false;

    // Scheduler flags
    S._visualScheduled = false;
    S.visualDirty = false;
    S.visualDirtyAt = 0;

    // Dedupe visual-only
    S._visualLastAt = 0;
    S._visualLastText = "";
    S._visualLastKey = "";
    S._visualLastStrict = "";
    S._visualLastLoose = "";
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

    // Nunca reaccionar a mutaciones causadas por nuestra UI.
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

        // Si la mutación fue dentro de nuestra UI, no hacemos nada.
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
  // - Aplica dedupe robusto.
  // ------------------------------------------------------------
  function pollVisualTick(fromObserver = false, reasonNode = null) {
    if (!KWSR.voice?.shouldReadNow?.()) return;
    if (S.effectiveFuente !== "visual") return;

    // Si el tick NO viene del observer y el observer está activo: no hacemos nada.
    if (!fromObserver && S.visualObserverActive) return;

    // Si viene del observer pero no hubo cambios “relevantes”: no hacemos nada.
    if (fromObserver) {
      if (!S.visualDirty) return;
      S.visualDirty = false;
    }

    // Si la mutación viene de nuestra UI, ignorar.
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

    // ----- Dedupe VISUAL robusto -----
    const now = performance.now();

    // Ventanas temporales:
    // - minRepeatMs: no repetir “inmediato”
    // - allowRepeatAfterMs: permitir repetir si pasó bastante tiempo
    const minRepeatMs = 700;
    const allowRepeatAfterMs = 1700;

    const strict = fpStrict(text);
    const loose  = fpLoose(text);

    const sameKey = key && key === (S._visualLastKey || "");
    const sameStrict = strict && strict === (S._visualLastStrict || "");
    const sameLoose  = loose  && loose  === (S._visualLastLoose  || "");

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

    // Extra: dedupe global visualSeen (para evitar loops raros sin key estable)
    // (Usamos strict como valor estable en vez del texto crudo.)
    if (!fromObserver && strict && strict === S.lastVisualSeen) return;
    S.lastVisualSeen = strict || text;

    // Guardar estado para dedupe visual-only
    S._visualLastText = text;
    S._visualLastKey = key || "";
    S._visualLastAt = now;
    S._visualLastStrict = strict;
    S._visualLastLoose = loose;

    if (DEBUG()) KWSR.log?.("VISUAL speak", { selector: S.visualSelectorUsed, key, fromObserver, text });

    // Delegamos dedupe final y salida (TTS/live region) al módulo voice.
    KWSR.voice?.leerTextoAccesible?.(text);
  }

  // ------------------------------------------------------------
  // visualReselectTick:
  // Re-evalúa qué selector es “mejor” (por si el DOM cambió fuerte).
  // Si cambia, reinicia observer.
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
    visualReselectTick
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - FIX: Nunca leer nodos dentro de la UI de KathWare (overlay/toast/live region).
  - FIX: Dedupe VISUAL robusto (fingerprint strict/loose + key + ventanas temporales).
  - FIX: Unión de líneas más segura (evita “palabras pegadas” cuando el DOM separa nodos).
  - Se mantiene: Observer + Poll fallback (poll no habla si observer está activo).
  */
})();

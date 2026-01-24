// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// - VISUAL engine: detecta texto “en pantalla” vía selectores por plataforma
// - MutationObserver + polling fallback + reselection
//
// FIX (Disney+):
// - Prioriza ".hive-subtitle-renderer-line"
// - Lee múltiples líneas (join) en vez de 1 solo nodo
// - NO guarda referencias a spans (Disney los reemplaza) -> re-query por selector
// - Ordena líneas por posición visual (top/left) para mantener frases coherentes
// - Guarda selector usado para debug
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.visual) return;

  const S = KWSR.state;
  const { normalize } = KWSR.utils;

  // Anti-spam de logs (solo debug)
  let lastDebugAt = 0;
  function debugLog(tag, payload) {
    const now = Date.now();
    if (now - lastDebugAt < 900) return;
    lastDebugAt = now;
    KWSR.log?.(tag, payload);
  }

  function looksLikeNoise(node, text) {
    const t = normalize(text);
    if (!t) return true;

    const tag = (node?.tagName || "").toUpperCase();
    if (["H1","H2","H3","H4","H5","H6","HEADER","NAV","MAIN","ARTICLE","ASIDE","FOOTER"].includes(tag)) return true;
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;

    if (t.length < 2 || t.length > 420) return true;

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;

    return false;
  }

  function ensureDisneySelectorsFirst(selectors) {
    const p = KWSR.platforms?.getPlatform?.() || "generic";
    if (p !== "disney") return selectors || [];

    // Disney: el ganador real que viste en DevTools
    const must = [".hive-subtitle-renderer-line"];

    const out = [];
    for (const m of must) if (!out.includes(m)) out.push(m);
    for (const s of (selectors || [])) if (!out.includes(s)) out.push(s);
    return out;
  }

  function queryNodes(sel) {
    try { return Array.from(document.querySelectorAll(sel)); } catch { return []; }
  }

  function sortByVisualPosition(nodes) {
    // Ordena por top, luego left (para leer de arriba hacia abajo)
    try {
      return nodes
        .map(n => {
          const r = n.getBoundingClientRect?.();
          return { n, top: r?.top ?? 0, left: r?.left ?? 0 };
        })
        .sort((a, b) => (a.top - b.top) || (a.left - b.left))
        .map(x => x.n);
    } catch {
      return nodes;
    }
  }

  function readVisualTextFromSelector(sel) {
    if (!sel) return "";

    let nodes = queryNodes(sel);
    if (!nodes.length) return "";

    // Flow/theoplayer: heurística histórica (dejarlo)
    const theoTTML = nodes.find(n => (n.className || "").toString().includes("theoplayer-ttml-texttrack-"));
    if (theoTTML) nodes = [theoTTML];

    // Orden estable (importante para Disney multi-line)
    nodes = sortByVisualPosition(nodes);

    const parts = [];
    const seen = new Set();

    for (const n of nodes) {
      const t = normalize(n?.textContent);
      if (!t) continue;
      if (looksLikeNoise(n, t)) continue;

      if (seen.has(t)) continue;
      seen.add(t);
      parts.push(t);
    }

    // Join con espacio; normalize final para limpiar duplicados de whitespace
    return normalize(parts.join(" "));
  }

  function pickBestVisualSelector() {
    const selectors = ensureDisneySelectorsFirst(S.visualSelectors || []);
    for (const sel of selectors) {
      const t = readVisualTextFromSelector(sel);
      if (t) return sel;
    }
    return "";
  }

  function stopVisualObserver() {
    try { S.visualObserver?.disconnect?.(); } catch {}
    S.visualObserver = null;
    S.visualObserverActive = false;
  }

  function startVisual() {
    const p = KWSR.platforms?.getPlatform?.() || "generic";
    S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
    S.visualSelectors = ensureDisneySelectorsFirst(S.visualSelectors);

    // Elegimos SOLO el selector ganador (no guardamos nodos)
    S.visualSelectorUsed = pickBestVisualSelector() || "";

    stopVisualObserver();

    if (S.visualSelectorUsed) {
      try {
        S.visualObserver = new MutationObserver(() => {
          if (!KWSR.voice.shouldReadNow()) return;
          if (S.effectiveFuente !== "visual") return;

          const t = readVisualTextFromSelector(S.visualSelectorUsed);
          if (!t) return;

          if (t === S.lastVisualSeen) return;
          S.lastVisualSeen = t;

          debugLog("VISUAL", {
            sel: S.visualSelectorUsed,
            text: t.slice(0, 140)
          });

          KWSR.voice.leerTextoAccesible(t);
        });

        // Observamos un root estable:
        // - Si el selector es hive line, el parent suele existir pero puede variar.
        //   Observamos documentElement para no perder recambios de nodos.
        // (Sí, es más caro, pero lo mitigamos con dedupe + throttled log)
        S.visualObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true
        });

        S.visualObserverActive = true;
      } catch {
        S.visualObserverActive = false;
      }
    } else {
      S.visualObserverActive = false;
    }

    KWSR.overlay?.updateOverlayStatus?.();
  }

  function pollVisualTick() {
    if (!KWSR.voice.shouldReadNow()) return;
    if (S.effectiveFuente !== "visual") return;

    if (!S.visualSelectors) {
      const p = KWSR.platforms?.getPlatform?.() || "generic";
      S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
      S.visualSelectors = ensureDisneySelectorsFirst(S.visualSelectors);
    }

    // Si no tenemos selector ganador, lo buscamos
    if (!S.visualSelectorUsed) {
      S.visualSelectorUsed = pickBestVisualSelector() || "";
      if (S.visualSelectorUsed) startVisual();
      return;
    }

    // Si observer está activo, poll no hace falta
    if (S.visualObserverActive) return;

    const t = readVisualTextFromSelector(S.visualSelectorUsed);
    if (!t) return;

    if (t === S.lastVisualSeen) return;
    S.lastVisualSeen = t;

    debugLog("VISUAL(poll)", {
      sel: S.visualSelectorUsed,
      text: t.slice(0, 140)
    });

    KWSR.voice.leerTextoAccesible(t);
  }

  function visualReselectTick() {
    if (!S.visualSelectors) {
      const p = KWSR.platforms?.getPlatform?.() || "generic";
      S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
      S.visualSelectors = ensureDisneySelectorsFirst(S.visualSelectors);
    }

    const prevSel = S.visualSelectorUsed || "";
    const nextSel = pickBestVisualSelector() || "";

    // Rehook si cambió el selector ganador (ej: Disney cambia layout)
    if (nextSel && nextSel !== prevSel) {
      S.visualSelectorUsed = nextSel;
      startVisual();
    }
  }

  KWSR.visual = {
    looksLikeNoise,
    startVisual,
    stopVisualObserver,
    pollVisualTick,
    visualReselectTick
  };
})();

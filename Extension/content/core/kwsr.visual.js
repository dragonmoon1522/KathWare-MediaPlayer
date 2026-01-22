// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// - VISUAL engine: detecta texto “en pantalla” vía selectores por plataforma
// - MutationObserver + polling fallback + reselection
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.visual) return;

  const S = KWSR.state;
  const { normalize } = KWSR.utils;

  function looksLikeNoise(node, text) {
    const t = normalize(text);
    if (!t) return true;

    const tag = (node?.tagName || "").toUpperCase();
    if (["H1","H2","H3","H4","H5","H6","HEADER","NAV","MAIN","ARTICLE","ASIDE","FOOTER"].includes(tag)) return true;
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;

    if (t.length < 2 || t.length > 260) return true;

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;

    return false;
  }

  function pickBestVisualNode() {
    const nodes = [];
    for (const sel of (S.visualSelectors || [])) {
      try { document.querySelectorAll(sel).forEach(n => nodes.push(n)); } catch {}
    }
    if (!nodes.length) return null;

    // Preferencia histórica: Theoplayer TTML (Flow)
    const theoTTML = nodes.find(n => (n.className || "").toString().includes("theoplayer-ttml-texttrack-"));
    if (theoTTML) return theoTTML;

    // Elegimos desde el final (a menudo el último coincide con el “overlay activo”)
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const t = normalize(n?.textContent);
      if (!looksLikeNoise(n, t)) return n;
    }
    return null;
  }

  function stopVisualObserver() {
    try { S.visualObserver?.disconnect?.(); } catch {}
    S.visualObserver = null;
    S.visualObserverActive = false;
  }

  function startVisual() {
    const p = KWSR.platforms?.getPlatform?.() || "generic";
    S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];

    const next = pickBestVisualNode();
    if (next) S.visualNode = next;

    stopVisualObserver();

    if (S.visualNode) {
      try {
        S.visualObserver = new MutationObserver(() => {
          if (!KWSR.voice.shouldReadNow()) return;
          if (S.effectiveFuente !== "visual") return;

          const t = normalize(S.visualNode?.textContent);
          if (!t) return;
          if (looksLikeNoise(S.visualNode, t)) return;

          if (t === S.lastVisualSeen) return;
          S.lastVisualSeen = t;

          KWSR.voice.leerTextoAccesible(t);
        });

        S.visualObserver.observe(S.visualNode, { childList: true, subtree: true, characterData: true });
        S.visualObserverActive = true;
      } catch {
        S.visualObserverActive = false;
      }
    }

    KWSR.overlay?.updateOverlayStatus?.();
  }

  function pollVisualTick() {
    if (!KWSR.voice.shouldReadNow()) return;
    if (S.effectiveFuente !== "visual") return;

    if (!S.visualSelectors) {
      const p = KWSR.platforms?.getPlatform?.() || "generic";
      S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
    }

    if (!S.visualNode) {
      S.visualNode = pickBestVisualNode();
      if (S.visualNode) startVisual();
      return;
    }

    // Si observer está activo, no necesitamos poll
    if (S.visualObserverActive) return;

    const t = normalize(S.visualNode.textContent);
    if (!t) return;
    if (looksLikeNoise(S.visualNode, t)) return;

    if (t === S.lastVisualSeen) return;
    S.lastVisualSeen = t;

    KWSR.voice.leerTextoAccesible(t);
  }

  function visualReselectTick() {
    if (!S.visualSelectors) {
      const p = KWSR.platforms?.getPlatform?.() || "generic";
      S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
    }

    const prev = S.visualNode;
    const next = pickBestVisualNode() || prev;

    if (next && next !== prev) {
      S.visualNode = next;
      startVisual();
    }
  }

  KWSR.visual = {
    looksLikeNoise,
    pickBestVisualNode,
    stopVisualObserver,
    startVisual,
    pollVisualTick,
    visualReselectTick
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Rebrand: KWMP -> KWSR.
  - Sigue el mismo enfoque:
      - selectors por plataforma (KWSR.platforms.platformSelectors)
      - elegir “mejor nodo” evitando ruido
      - MutationObserver + polling fallback + reselection periódica
  - Se mantiene preferencia por Theoplayer TTML cuando existe (caso Flow),
    pero el módulo ya es “agnóstico” (solo es una heurística).
  - Respeta gating:
      - voice.shouldReadNow()
      - effectiveFuente === "visual"
      - dedupe por S.lastVisualSeen
  */
})();

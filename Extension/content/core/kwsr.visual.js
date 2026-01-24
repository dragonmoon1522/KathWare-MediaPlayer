// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// - VISUAL engine: detecta texto “en pantalla” vía selectores por plataforma
// - MutationObserver + polling fallback + reselection
//
// FIX (Disney+):
// - Prioriza ".hive-subtitle-renderer-line"
// - Lee múltiples líneas (join) en vez de 1 solo nodo
// - Guarda selector usado para debug
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

    if (t.length < 2 || t.length > 420) return true;

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;

    return false;
  }

  function ensureDisneySelectorsFirst(selectors) {
    // Si estamos en Disney, ponemos el selector ganador al principio.
    const p = KWSR.platforms?.getPlatform?.() || "generic";
    if (p !== "disney") return selectors;

    const must = [".hive-subtitle-renderer-line"];
    const out = [];

    for (const m of must) if (!out.includes(m)) out.push(m);
    for (const s of (selectors || [])) if (!out.includes(s)) out.push(s);

    return out;
  }

  function queryAllForSelectors(selectors) {
    const nodes = [];
    for (const sel of (selectors || [])) {
      try {
        document.querySelectorAll(sel).forEach(n => nodes.push(n));
      } catch {}
    }
    return nodes;
  }

  function readVisualTextFromNodes(nodes) {
    // Lee todas las líneas relevantes y arma un bloque estable.
    if (!nodes?.length) return "";

    // Filtramos ruido y juntamos
    const parts = [];
    for (const n of nodes) {
      const t = normalize(n?.textContent);
      if (!t) continue;
      if (looksLikeNoise(n, t)) continue;
      parts.push(t);
    }

    // Dedup simple dentro del mismo tick
    const uniq = [];
    const seen = new Set();
    for (const p of parts) {
      if (seen.has(p)) continue;
      seen.add(p);
      uniq.push(p);
    }

    return normalize(uniq.join(" "));
  }

  function pickBestVisualSet() {
    const selectorsRaw = S.visualSelectors || [];
    const selectors = ensureDisneySelectorsFirst(selectorsRaw);

    for (const sel of selectors) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch { nodes = []; }

      if (!nodes.length) continue;

      // Caso Flow/theoplayer: preferencia histórica
      const theoTTML = nodes.find(n => (n.className || "").toString().includes("theoplayer-ttml-texttrack-"));
      if (theoTTML) {
        return { selector: sel, nodes: [theoTTML] };
      }

      // Caso Disney: muchas líneas (spans)
      const text = readVisualTextFromNodes(nodes);
      if (text) return { selector: sel, nodes };

      // Si no hay texto útil, probamos otro selector.
    }

    return { selector: "", nodes: [] };
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

    const picked = pickBestVisualSet();
    S.visualSelectorUsed = picked.selector || "";
    S.visualNodes = picked.nodes || [];

    stopVisualObserver();

    if (S.visualNodes?.length) {
      try {
        S.visualObserver = new MutationObserver(() => {
          if (!KWSR.voice.shouldReadNow()) return;
          if (S.effectiveFuente !== "visual") return;

          const t = readVisualTextFromNodes(S.visualNodes);
          if (!t) return;

          if (t === S.lastVisualSeen) return;
          S.lastVisualSeen = t;

          // Log suave (no spamear)
          KWSR.log?.("VISUAL", {
            sel: S.visualSelectorUsed,
            nodes: S.visualNodes.length,
            text: t.slice(0, 120)
          });

          KWSR.voice.leerTextoAccesible(t);
        });

        // Observamos el parent común si existe; si no, observamos cada nodo
        // (Disney suele mutar nodos internos)
        const first = S.visualNodes[0];
        const root = first?.parentElement || first;

        S.visualObserver.observe(root, { childList: true, subtree: true, characterData: true });
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

    // Si no tenemos set, buscamos
    if (!S.visualNodes || !S.visualNodes.length) {
      const picked = pickBestVisualSet();
      S.visualSelectorUsed = picked.selector || "";
      S.visualNodes = picked.nodes || [];
      if (S.visualNodes.length) startVisual();
      return;
    }

    // Si observer está activo, poll no hace falta
    if (S.visualObserverActive) return;

    const t = readVisualTextFromNodes(S.visualNodes);
    if (!t) return;

    if (t === S.lastVisualSeen) return;
    S.lastVisualSeen = t;

    KWSR.log?.("VISUAL(poll)", {
      sel: S.visualSelectorUsed,
      nodes: S.visualNodes.length,
      text: t.slice(0, 120)
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
    const prevCount = S.visualNodes?.length || 0;

    const picked = pickBestVisualSet();
    const nextSel = picked.selector || "";
    const nextCount = picked.nodes?.length || 0;

    // Rehook si cambió algo relevante (selector o cantidad de nodos)
    if ((nextSel && nextSel !== prevSel) || (nextCount && nextCount !== prevCount)) {
      S.visualSelectorUsed = nextSel;
      S.visualNodes = picked.nodes || [];
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

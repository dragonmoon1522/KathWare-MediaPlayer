(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.visual) return;

  const S = KWMP.state;
  const { normalize } = KWMP.utils;

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

    // Flow Theoplayer TTML preferido
    const theoTTML = nodes.find(n => (n.className || "").toString().includes("theoplayer-ttml-texttrack-"));
    if (theoTTML) return theoTTML;

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
    const p = KWMP.platforms.getPlatform();
    S.visualSelectors = KWMP.platforms.platformSelectors(p);

    const next = pickBestVisualNode();
    if (next) S.visualNode = next;

    stopVisualObserver();

    if (S.visualNode) {
      try {
        S.visualObserver = new MutationObserver(() => {
          if (!KWMP.voice.shouldReadNow()) return;
          if (S.effectiveFuente !== "visual") return;

          const t = normalize(S.visualNode?.textContent);
          if (!t) return;
          if (looksLikeNoise(S.visualNode, t)) return;

          if (t === S.lastVisualSeen) return;
          S.lastVisualSeen = t;

          KWMP.voice.leerTextoAccesible(t);
        });

        S.visualObserver.observe(S.visualNode, { childList: true, subtree: true, characterData: true });
        S.visualObserverActive = true;
      } catch {
        S.visualObserverActive = false;
      }
    }

    KWMP.overlay?.updateOverlayStatus?.();
  }

  function pollVisualTick() {
    if (!KWMP.voice.shouldReadNow()) return;
    if (S.effectiveFuente !== "visual") return;

    if (!S.visualSelectors) S.visualSelectors = KWMP.platforms.platformSelectors(KWMP.platforms.getPlatform());

    if (!S.visualNode) {
      S.visualNode = pickBestVisualNode();
      if (S.visualNode) startVisual();
      return;
    }

    if (S.visualObserverActive) return;

    const t = normalize(S.visualNode.textContent);
    if (!t) return;
    if (looksLikeNoise(S.visualNode, t)) return;

    if (t === S.lastVisualSeen) return;
    S.lastVisualSeen = t;

    KWMP.voice.leerTextoAccesible(t);
  }

  function visualReselectTick() {
    if (!S.visualSelectors) S.visualSelectors = KWMP.platforms.platformSelectors(KWMP.platforms.getPlatform());
    const prev = S.visualNode;
    const next = pickBestVisualNode() || prev;
    if (next && next !== prev) {
      S.visualNode = next;
      startVisual();
    }
  }

  KWMP.visual = {
    looksLikeNoise,
    pickBestVisualNode,
    stopVisualObserver,
    startVisual,
    pollVisualTick,
    visualReselectTick
  };
})();

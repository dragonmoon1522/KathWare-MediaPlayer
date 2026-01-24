// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// - VISUAL engine: detecta texto “en pantalla” vía selectores por plataforma
// - MutationObserver + polling fallback + reselection
//
// FIX (Disney+):
// - Modo estricto: si existen ".hive-subtitle-renderer-line", NO usar fallbacks genéricos
// - Anti-UI: ignora menús/drawers/dialogs y listas tipo "Subtítulos disponibles: ..."
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.visual) return;

  const S = KWSR.state;
  const { normalize } = KWSR.utils;

  function platform() {
    return KWSR.platforms?.getPlatform?.() || "generic";
  }

  function isInsideUiChrome(node) {
    // Si el texto está dentro de un menú/drawer/dialog, casi seguro NO es subtítulo “del video”.
    try {
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      if (!el?.closest) return false;

      return !!el.closest(
        [
          "[role='dialog']",
          "[role='menu']",
          "[role='listbox']",
          "[role='navigation']",
          "[aria-modal='true']",
          "[class*='drawer']",
          "[class*='Drawer']",
          "[class*='modal']",
          "[class*='Modal']",
          "[class*='menu']",
          "[class*='Menu']",
          "[class*='settings']",
          "[class*='Settings']"
        ].join(",")
      );
    } catch {
      return false;
    }
  }

  function looksLikeCaptionOptionsText(text) {
    const t = normalize(text).toLowerCase();
    if (!t) return false;

    // Frases típicas de UI de audio/subs
    if (t.includes("subtítulos disponibles") || t.includes("subtitulos disponibles")) return true;
    if (t.includes("audio y subtítulos") || t.includes("audio y subtitulos")) return true;

    // Listas de idiomas frecuentes
    // (ej: "español, español latinoamérica, english, ...")
    const hasLanguages =
      t.includes("español") || t.includes("latino") || t.includes("english") || t.includes("portugu") || t.includes("français") || t.includes("francais");

    const looksLikeList = (t.includes(",") || t.includes("·") || t.includes("|")) && t.length > 25;

    // Formato "X: Y, Z, W"
    const looksLikeColonList = t.includes(":") && looksLikeList;

    return hasLanguages && (looksLikeList || looksLikeColonList);
  }

  function looksLikeNoise(node, text) {
    const t = normalize(text);
    if (!t) return true;

    if (isInsideUiChrome(node)) return true;
    if (looksLikeCaptionOptionsText(t)) return true;

    const tag = (node?.tagName || "").toUpperCase();
    if (["H1","H2","H3","H4","H5","H6","HEADER","NAV","MAIN","ARTICLE","ASIDE","FOOTER"].includes(tag)) return true;
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;

    // Un toque más permisivo para Disney (a veces son 2 líneas largas)
    if (t.length < 2 || t.length > 420) return true;

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|notif|banner|sr-only|screenreader-only/.test(cls)) return true;

    return false;
  }

  function ensureDisneySelectorsFirst(selectors) {
    const p = platform();
    if (p !== "disney") return selectors;

    const must = [".hive-subtitle-renderer-line", "[class*='hive-subtitle']"];
    const out = [];

    for (const m of must) if (!out.includes(m)) out.push(m);
    for (const s of (selectors || [])) if (!out.includes(s)) out.push(s);

    return out;
  }

  function readVisualTextFromNodes(nodes) {
    if (!nodes?.length) return "";

    const parts = [];
    for (const n of nodes) {
      const t = normalize(n?.textContent);
      if (!t) continue;
      if (looksLikeNoise(n, t)) continue;
      parts.push(t);
    }

    // dedupe simple
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
    const p = platform();
    const selectorsRaw = S.visualSelectors || [];
    const selectors = ensureDisneySelectorsFirst(selectorsRaw);

    // ✅ DISNEY STRICT MODE:
    // Si hay hive lines, NO seguimos probando fallbacks genéricos.
    if (p === "disney") {
      // 1) hive-subtitle-renderer-line
      try {
        const nodes = Array.from(document.querySelectorAll(".hive-subtitle-renderer-line"));
        const text = readVisualTextFromNodes(nodes);
        if (text) return { selector: ".hive-subtitle-renderer-line", nodes };
      } catch {}

      // 2) hive wrapper fallback
      try {
        const nodes = Array.from(document.querySelectorAll("[class*='hive-subtitle']"));
        const text = readVisualTextFromNodes(nodes);
        if (text) return { selector: "[class*='hive-subtitle']", nodes };
      } catch {}

      // Si no hay nada, recién ahí dejamos que siga con el resto
      // (pero lo ideal es que en Disney siempre aparezcan esas líneas cuando hay subs)
    }

    for (const sel of selectors) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch { nodes = []; }
      if (!nodes.length) continue;

      // Flow/theoplayer preferencia histórica
      const theoTTML = nodes.find(n => (n.className || "").toString().includes("theoplayer-ttml-texttrack-"));
      if (theoTTML) return { selector: sel, nodes: [theoTTML] };

      const text = readVisualTextFromNodes(nodes);
      if (text) return { selector: sel, nodes };
    }

    return { selector: "", nodes: [] };
  }

  function stopVisualObserver() {
    try { S.visualObserver?.disconnect?.(); } catch {}
    S.visualObserver = null;
    S.visualObserverActive = false;
  }

  function startVisual() {
    const p = platform();
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
          KWSR.voice.leerTextoAccesible(t);
        });

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
      const p = platform();
      S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
      S.visualSelectors = ensureDisneySelectorsFirst(S.visualSelectors);
    }

    if (!S.visualNodes || !S.visualNodes.length) {
      const picked = pickBestVisualSet();
      S.visualSelectorUsed = picked.selector || "";
      S.visualNodes = picked.nodes || [];
      if (S.visualNodes.length) startVisual();
      return;
    }

    if (S.visualObserverActive) return;

    const t = readVisualTextFromNodes(S.visualNodes);
    if (!t) return;
    if (t === S.lastVisualSeen) return;

    S.lastVisualSeen = t;
    KWSR.voice.leerTextoAccesible(t);
  }

  function visualReselectTick() {
    if (!S.visualSelectors) {
      const p = platform();
      S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
      S.visualSelectors = ensureDisneySelectorsFirst(S.visualSelectors);
    }

    const prevSel = S.visualSelectorUsed || "";
    const prevCount = S.visualNodes?.length || 0;

    const picked = pickBestVisualSet();
    const nextSel = picked.selector || "";
    const nextCount = picked.nodes?.length || 0;

    if ((nextSel && nextSel !== prevSel) || (nextCount && nextCount !== prevCount)) {
      S.visualSelectorUsed = nextSel;
      S.visualNodes = picked.nodes || [];
      startVisual();
    }
  }

  KWSR.visual = {
    startVisual,
    stopVisualObserver,
    pollVisualTick,
    visualReselectTick
  };
})();

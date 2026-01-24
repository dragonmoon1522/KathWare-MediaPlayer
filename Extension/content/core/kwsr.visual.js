// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// - VISUAL engine: detecta texto “en pantalla” vía selectores por plataforma
// - MutationObserver + polling fallback + reselection
//
// FIX (Disney+):
// - NO cachea nodes (Disney los recrea): re-query por selector en cada tick
// - Prioriza ".hive-subtitle-renderer-line"
// - Lee múltiples líneas (join)
// - Filtro anti “menú de idiomas” por contenido (sin depender de dialogs/drawers)
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.visual) return;

  const S = KWSR.state;
  const { normalize } = KWSR.utils;

  function platform() {
    return KWSR.platforms?.getPlatform?.() || "generic";
  }

  function looksLikeLanguageMenuBlob(text) {
    const t = normalize(text);
    if (!t) return false;

    const lower = t.toLowerCase();

    // “Audio … Subtítulos … <lista gigante de idiomas>”
    const hasAudioSubs =
      lower.includes("audio") &&
      (lower.includes("subtítulos") || lower.includes("subtitulos") || lower.includes("subtitles"));

    if (!hasAudioSubs) return false;

    const langHits = [
      "english","deutsch","español","espanol","français","francais","italiano","português","portugues",
      "polski","magyar","dansk","norsk","svenska","suomi","türkçe","turkce","čeština","cestina",
      "română","romana","slovenčina","slovencina","nederlands","ελληνικά","日本語","한국어","chinese"
    ].reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);

    if (langHits >= 4) return true;

    // blobs largos con CC suelen ser menú
    if (t.length > 180 && (lower.includes("[cc]") || /\bcc\b/.test(lower))) return true;

    // demasiado largo: UI, no subs
    if (t.length > 240) return true;

    return false;
  }

  function looksLikeNoise(node, text) {
    const t = normalize(text);
    if (!t) return true;

    // 🚫 anti “salchicha”
    if (looksLikeLanguageMenuBlob(t)) return true;

    const tag = (node?.tagName || "").toUpperCase();
    if (["H1","H2","H3","H4","H5","H6","HEADER","NAV","MAIN","ARTICLE","ASIDE","FOOTER"].includes(tag)) return true;
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;

    if (t.length < 2 || t.length > 420) return true;

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;

    return false;
  }

  function ensureDisneySelectorsFirst(selectors) {
    if (platform() !== "disney") return selectors || [];

    const must = [
      ".hive-subtitle-renderer-line",
      "[class*='hive-subtitle']"
    ];

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

    // dedupe dentro del mismo tick
    const uniq = [];
    const seen = new Set();
    for (const p of parts) {
      if (seen.has(p)) continue;
      seen.add(p);
      uniq.push(p);
    }

    return normalize(uniq.join(" "));
  }

  // 🔥 clave: en Disney NO cachear nodes (se reemplazan); cacheamos SOLO selector y re-queryamos.
  function getFreshNodesBySelector(sel) {
    if (!sel) return [];
    try { return Array.from(document.querySelectorAll(sel)); } catch { return []; }
  }

  function pickBestSelector() {
    const p = platform();
    const selectorsRaw = S.visualSelectors || [];
    const selectors = ensureDisneySelectorsFirst(selectorsRaw);

    for (const sel of selectors) {
      const nodes = getFreshNodesBySelector(sel);
      if (!nodes.length) continue;

      // Flow/theoplayer prefer
      const theoTTML = nodes.find(n => (n.className || "").toString().includes("theoplayer-ttml-texttrack-"));
      if (theoTTML) return sel;

      const text = readVisualTextFromNodes(nodes);
      if (text) return sel;
    }

    return "";
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

    // Elegimos selector (no nodes)
    const pickedSel = pickBestSelector();
    S.visualSelectorUsed = pickedSel || "";

    stopVisualObserver();

    // Observamos algo estable:
    // - Disney: documentElement (porque hive-lines se recrean)
    // - Otros: también sirve documentElement (más simple/robusto)
    try {
      S.visualObserver = new MutationObserver(() => {
        if (!KWSR.voice.shouldReadNow()) return;
        if (S.effectiveFuente !== "visual") return;

        // Si no hay selector, intentamos encontrar uno
        if (!S.visualSelectorUsed) {
          const sel = pickBestSelector();
          if (sel) S.visualSelectorUsed = sel;
          else return;
        }

        const nodes = getFreshNodesBySelector(S.visualSelectorUsed);
        const t = readVisualTextFromNodes(nodes);
        if (!t) return;

        if (t === S.lastVisualSeen) return;
        S.lastVisualSeen = t;

        KWSR.log?.("VISUAL", {
          sel: S.visualSelectorUsed,
          nodes: nodes.length,
          text: t.slice(0, 120)
        });

        KWSR.voice.leerTextoAccesible(t);
      });

      S.visualObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });

      S.visualObserverActive = true;
    } catch {
      S.visualObserverActive = false;
    }

    KWSR.overlay?.updateOverlayStatus?.();
  }

  function pollVisualTick() {
    if (!KWSR.voice.shouldReadNow()) return;
    if (S.effectiveFuente !== "visual") return;

    const p = platform();

    if (!S.visualSelectors) {
      S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
      S.visualSelectors = ensureDisneySelectorsFirst(S.visualSelectors);
    }

    if (!S.visualSelectorUsed) {
      const sel = pickBestSelector();
      if (sel) {
        S.visualSelectorUsed = sel;
        // si no hay observer activo, lo arrancamos
        if (!S.visualObserverActive) startVisual();
      } else {
        return;
      }
    }

    // Si observer está activo, poll no hace falta, pero lo dejamos como fallback suave
    // (en Disney a veces el observer no dispara como esperás)
    const nodes = getFreshNodesBySelector(S.visualSelectorUsed);
    const t = readVisualTextFromNodes(nodes);
    if (!t) return;

    if (t === S.lastVisualSeen) return;
    S.lastVisualSeen = t;

    KWSR.log?.("VISUAL(poll)", {
      sel: S.visualSelectorUsed,
      nodes: nodes.length,
      text: t.slice(0, 120)
    });

    KWSR.voice.leerTextoAccesible(t);
  }

  function visualReselectTick() {
    const p = platform();

    if (!S.visualSelectors) {
      S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
      S.visualSelectors = ensureDisneySelectorsFirst(S.visualSelectors);
    }

    const prevSel = S.visualSelectorUsed || "";
    const nextSel = pickBestSelector();

    if (nextSel && nextSel !== prevSel) {
      S.visualSelectorUsed = nextSel;
      startVisual();
    }

    // Si perdimos selector (DOM cambió), reintentar
    if (!nextSel && prevSel) {
      // si el selector anterior ya no devuelve nada, lo soltamos
      const nodes = getFreshNodesBySelector(prevSel);
      if (!nodes.length) {
        S.visualSelectorUsed = "";
      }
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

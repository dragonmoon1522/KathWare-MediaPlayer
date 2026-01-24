// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// - VISUAL engine: detecta texto “en pantalla” vía selectores por plataforma
// - MutationObserver + polling fallback + reselection
//
// FIX (Disney+):
// - Lock fuerte a ".hive-subtitle-renderer-line" cuando aparece
// - Lee múltiples líneas (join) en vez de 1 solo nodo
// - Bloquea lecturas cuando hay drawer/dialog abierto (Audio/Subtítulos)
// - Filtro por contenido para evitar “salchicha de idiomas”
// - Guarda selector usado para debug
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.visual) return;

  const S = KWSR.state;
  const { normalize } = KWSR.utils;

  function platform() {
    return KWSR.platforms?.getPlatform?.() || "generic";
  }

  function looksLikeNoise(node, text) {
    const t = normalize(text);
    if (!t) return true;

    // 🚫 anti “menú de idiomas” (Disney drawer)
    if (looksLikeLanguageMenuBlob(t)) return true;

    const tag = (node?.tagName || "").toUpperCase();
    if (["H1","H2","H3","H4","H5","H6","HEADER","NAV","MAIN","ARTICLE","ASIDE","FOOTER"].includes(tag)) return true;
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;

    // captions suelen ser cortos/medios; UI blobs gigantes => afuera
    if (t.length < 2 || t.length > 420) return true;

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;

    return false;
  }

  function hasOpenDialogMenu() {
    // Si hay un drawer/dialog visible, casi seguro está mutando UI, no subs.
    try {
      const el = document.querySelector(
        "[role='dialog'],[aria-modal='true'],[class*='drawer'],[class*='Drawer'],[class*='modal'],[class*='Modal']"
      );
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity || 1) < 0.05) return false;
      return true;
    } catch {
      return false;
    }
  }

  function looksLikeLanguageMenuBlob(text) {
    const t = normalize(text);
    if (!t) return false;

    const lower = t.toLowerCase();

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

    if (t.length > 180 && (lower.includes("[cc]") || /\bcc\b/.test(lower))) return true;

    // Muy largo = UI
    if (t.length > 240) return true;

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
    if (!nodes?.length) return "";

    const parts = [];
    for (const n of nodes) {
      const t = normalize(n?.textContent);
      if (!t) continue;
      if (looksLikeNoise(n, t)) continue;
      parts.push(t);
    }

    // Dedup dentro del mismo tick
    const uniq = [];
    const seen = new Set();
    for (const p of parts) {
      if (seen.has(p)) continue;
      seen.add(p);
      uniq.push(p);
    }

    return normalize(uniq.join(" "));
  }

  // -------------------- Disney lock --------------------
  function disneyPreferredNodesNow() {
    // “Lock target”: siempre intentamos hive-lines primero (si existen).
    if (platform() !== "disney") return null;

    try {
      const hive = Array.from(document.querySelectorAll(".hive-subtitle-renderer-line"));
      const txt = readVisualTextFromNodes(hive);
      if (hive.length && txt) {
        return { selector: ".hive-subtitle-renderer-line", nodes: hive, text: txt };
      }
    } catch {}
    return null;
  }

  function pickBestVisualSet() {
    // 1) Disney: si hay hive-lines, lock inmediato
    const disneyLock = disneyPreferredNodesNow();
    if (disneyLock) return { selector: disneyLock.selector, nodes: disneyLock.nodes };

    // 2) General: probamos selectors en orden
    const selectorsRaw = S.visualSelectors || [];
    const selectors = ensureDisneySelectorsFirst(selectorsRaw);

    for (const sel of selectors) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch { nodes = []; }
      if (!nodes.length) continue;

      // Preferencia histórica: Theoplayer TTML (Flow)
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

  function observeRootFor(nodes) {
    // Observamos un parent común para capturar cambios internos (Disney muta mucho)
    const first = nodes?.[0];
    if (!first) return null;

    // Si todas las nodes comparten parentElement, mejor ese.
    try {
      const p = first.parentElement;
      if (p) return p;
    } catch {}

    return first;
  }

  function startVisual() {
    const p = platform();
    S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
    S.visualSelectors = ensureDisneySelectorsFirst(S.visualSelectors);

    // Si ya está lockeado en Disney, mantenelo salvo que esté “vacío”
    const picked = pickBestVisualSet();

    S.visualSelectorUsed = picked.selector || "";
    S.visualNodes = picked.nodes || [];

    stopVisualObserver();

    if (S.visualNodes?.length) {
      try {
        const obsRoot = observeRootFor(S.visualNodes);

        S.visualObserver = new MutationObserver(() => {
          if (!KWSR.voice.shouldReadNow()) return;
          if (S.effectiveFuente !== "visual") return;

          // Disney: si el drawer está abierto, NO leer UI
          if (p === "disney" && hasOpenDialogMenu()) return;

          // Disney: si aparece hive-lines ahora, cambiamos lock en caliente
          if (p === "disney") {
            const lockNow = disneyPreferredNodesNow();
            if (lockNow && S.visualSelectorUsed !== lockNow.selector) {
              S.visualSelectorUsed = lockNow.selector;
              S.visualNodes = lockNow.nodes;
              // rehook observer al nuevo root
              startVisual();
              return;
            }
          }

          const t = readVisualTextFromNodes(S.visualNodes);
          if (!t) return;

          if (t === S.lastVisualSeen) return;
          S.lastVisualSeen = t;

          KWSR.log?.("VISUAL", {
            sel: S.visualSelectorUsed,
            nodes: S.visualNodes.length,
            text: t.slice(0, 120)
          });

          KWSR.voice.leerTextoAccesible(t);
        });

        if (obsRoot) {
          S.visualObserver.observe(obsRoot, { childList: true, subtree: true, characterData: true });
          S.visualObserverActive = true;
        } else {
          S.visualObserverActive = false;
        }
      } catch {
        S.visualObserverActive = false;
      }
    } else {
      S.visualObserverActive = false;
    }

    // Disney lock bookkeeping
    if (p === "disney") {
      S.visualDisneyLock = (S.visualSelectorUsed === ".hive-subtitle-renderer-line");
      if (S.visualDisneyLock) S.visualDisneyLockSeenAt = Date.now();
    }

    KWSR.overlay?.updateOverlayStatus?.();
  }

  function pollVisualTick() {
    if (!KWSR.voice.shouldReadNow()) return;
    if (S.effectiveFuente !== "visual") return;

    const p = platform();

    // Disney: si el drawer está abierto, ignoramos
    if (p === "disney" && hasOpenDialogMenu()) return;

    if (!S.visualSelectors) {
      S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
      S.visualSelectors = ensureDisneySelectorsFirst(S.visualSelectors);
    }

    // Disney: lock en cada poll si hive-lines están disponibles
    if (p === "disney") {
      const lockNow = disneyPreferredNodesNow();
      if (lockNow) {
        // Si no estamos lockeados, lockeamos
        if (S.visualSelectorUsed !== lockNow.selector) {
          S.visualSelectorUsed = lockNow.selector;
          S.visualNodes = lockNow.nodes;
          startVisual();
          return;
        }
      }
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
    const p = platform();

    if (!S.visualSelectors) {
      S.visualSelectors = KWSR.platforms?.platformSelectors?.(p) || [];
      S.visualSelectors = ensureDisneySelectorsFirst(S.visualSelectors);
    }

    // Disney: si estamos lockeados, NO reseleccionamos salvo que “desaparezca” por un rato.
    if (p === "disney") {
      const lockNow = disneyPreferredNodesNow();
      if (lockNow) {
        // lock vivo => mantenemos
        if (S.visualSelectorUsed !== lockNow.selector) {
          S.visualSelectorUsed = lockNow.selector;
          S.visualNodes = lockNow.nodes;
          startVisual();
        }
        return;
      }

      // Si no hay lockNow, esperamos un ratito antes de abandonar el lock anterior
      const lockWas = (S.visualSelectorUsed === ".hive-subtitle-renderer-line");
      if (lockWas) {
        const since = Date.now() - (S.visualDisneyLockSeenAt || 0);
        if (since < 1500) return; // tolerancia
      }
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
    looksLikeNoise,
    startVisual,
    stopVisualObserver,
    pollVisualTick,
    visualReselectTick
  };

})();

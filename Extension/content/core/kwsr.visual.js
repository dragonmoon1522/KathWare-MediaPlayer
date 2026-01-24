// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// - VISUAL engine: detecta texto “en pantalla” vía selectores por plataforma
//
// Disney hard-fix (Hive):
// - En Disney SOLO leemos líneas hive (renderer-line).
// - Bloqueo duro anti menú Audio/Subtítulos + idiomas.
// - Gating del observer: procesar solo mutaciones que toquen hive-line.
// - Debounce + rate limit para evitar lecturas repetidas por re-render.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.visual) return;

  const S = KWSR.state;
  const { normalize } = KWSR.utils;

  function platform() {
    return KWSR.platforms?.getPlatform?.() || "generic";
  }

  // -------------------- Anti “Audio/Subtítulos + idiomas” (hard) --------------------
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

  function looksLikeNoise(node, text) {
    const t = normalize(text);
    if (!t) return true;

    if (isLanguageMenuText(t)) return true;

    const tag = (node?.tagName || "").toUpperCase();
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;

    if (t.length < 2 || t.length > 420) return true;

    return false;
  }

  // -------------------- Helpers visual --------------------
  function isVisible(el) {
    try {
      if (!el || !(el instanceof Element)) return false;
      // offsetParent = null cuando display:none (no siempre con position:fixed, pero igual suma)
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === "none" || style.visibility === "hidden") return false;
      const opacity = parseFloat(style.opacity || "1");
      if (opacity <= 0.01) return false;
      // si no ocupa nada, suele ser UI fantasma
      const r = el.getBoundingClientRect?.();
      if (!r) return true;
      if (r.width < 2 && r.height < 2) return false;
      return true;
    } catch {
      return false;
    }
  }

  // -------------------- Disney: aceptar SOLO hive subtitles --------------------
  function disneyOnlySelectors() {
    // Importante: NO usar ".hive-subtitle-renderer-line *" porque a veces trae spans extraños.
    return [
      ".hive-subtitle-renderer-line",
      "[class*='hive-subtitle-renderer-line']",
      "[class*='hiveSubtitle'][class*='Line']",
      "[class*='hive-subtitle'][class*='line']"
    ];
  }

  function getSelectors() {
    const p = platform();
    if (p === "disney") return disneyOnlySelectors();
    return KWSR.platforms?.platformSelectors?.(p) || [];
  }

  function getFreshNodesBySelector(sel) {
    try { return Array.from(document.querySelectorAll(sel)); } catch { return []; }
  }

  function readTextFromNodes(nodes, p) {
    if (!nodes?.length) return "";

    const parts = [];

    for (const n of nodes) {
      if (!n) continue;

      // Disney: solo líneas visibles
      if (p === "disney" && !isVisible(n)) continue;

      const raw = n.textContent;
      const t = normalize(raw);
      if (!t) continue;

      if (p === "disney" && isLanguageMenuText(t)) continue;
      if (p === "disney" && t.length > 140) continue;
      if (p === "disney" && /t\d+\s*:\s*e\d+/i.test(t) && t.length > 60) continue;

      if (looksLikeNoise(n, t)) continue;

      parts.push(t);
    }

    if (!parts.length) return "";

    // dedupe dentro del tick
    const uniq = [];
    const seen = new Set();
    for (const x of parts) {
      if (seen.has(x)) continue;
      seen.add(x);
      uniq.push(x);
    }

    function smartJoin(lines) {
  if (!lines.length) return "";

  const out = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const prev = out[out.length - 1];
    const curr = lines[i];

    // si la línea anterior termina “cerrada”, unir normal
    if (/[.!?…]$/.test(prev.trim())) {
      out[out.length - 1] = prev + " " + curr;
    } else {
      // si no, es probable salto de línea visual
      out[out.length - 1] = prev + " / " + curr;
    }
  }

  return normalize(out.join(""));
}

    return smartJoin(uniq);

  }

  function pickBestSelector(p) {
    const selectors = getSelectors();
    for (const sel of selectors) {
      const nodes = getFreshNodesBySelector(sel);
      if (!nodes.length) continue;

      const text = readTextFromNodes(nodes, p);
      if (text) return sel;
    }
    return "";
  }

  function stopVisualObserver() {
    try { S.visualObserver?.disconnect?.(); } catch {}
    S.visualObserver = null;
    S.visualObserverActive = false;

    // scheduler flags
    S._visualScheduled = false;
    S._visualLastSpokenAt = 0;
    S._visualLastSpokenText = "";
  }

  // -------------------- Scheduler anti-spam --------------------
  function scheduleVisualRead(reasonNode) {
    // Gate general
    if (!KWSR.voice.shouldReadNow()) return;
    if (S.effectiveFuente !== "visual") return;

    // Disney gating: si la mutación no está tocando una hive-line, ignoramos.
    const p = platform();
    if (p === "disney" && reasonNode) {
      try {
        const el = reasonNode.nodeType === 1 ? reasonNode : reasonNode.parentElement;
        if (el && !el.closest?.(".hive-subtitle-renderer-line,[class*='hive-subtitle-renderer-line']")) {
          return;
        }
      } catch { /* ignore */ }
    }

    if (S._visualScheduled) return;
    S._visualScheduled = true;

    // Debounce por frame (Disney re-renderiza múltiples veces seguidas)
    requestAnimationFrame(() => {
      S._visualScheduled = false;
      pollVisualTick(true);
    });
  }

  function startVisual() {
    const p = platform();
    S.visualSelectors = getSelectors();

    S.visualSelectorUsed = pickBestSelector(p);

    stopVisualObserver();

    try {
      S.visualObserver = new MutationObserver((mutations) => {
        if (!mutations || !mutations.length) return;

        // Elegimos “un nodo motivo” para gating Disney: el primero relevante
        let reasonNode = null;
        for (const m of mutations) {
          if (m.target) { reasonNode = m.target; break; }
          if (m.addedNodes && m.addedNodes[0]) { reasonNode = m.addedNodes[0]; break; }
        }

        scheduleVisualRead(reasonNode);
      });

      // Disney recrea DOM: observar doc entero, pero con gating dentro del scheduler.
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

  function pollVisualTick(fromObserver = false) {
    if (!KWSR.voice.shouldReadNow()) return;
    if (S.effectiveFuente !== "visual") return;

    const p = platform();
    if (!S.visualSelectors) S.visualSelectors = getSelectors();

    if (!S.visualSelectorUsed) {
      S.visualSelectorUsed = pickBestSelector(p);
      if (!S.visualSelectorUsed) return;
    }

    const nodes = getFreshNodesBySelector(S.visualSelectorUsed);
    const t = readTextFromNodes(nodes, p);
    if (!t) return;

    // Dedupe + rate limit (evita re-lecturas por re-render)
    const now = performance.now();

    // Si es exactamente el mismo texto MUY pegado, lo ignoramos
    const minRepeatMs = 450; // ajustable: 350-600 según pruebas
    if (t === (S._visualLastSpokenText || "") && (now - (S._visualLastSpokenAt || 0)) < minRepeatMs) {
      return;
    }

    // También evitamos repetir lastVisualSeen en tick normal,
    // pero NO lo usamos como único freno (porque “Sí.” puede repetirse legítimo)
    if (!fromObserver && t === S.lastVisualSeen) return;
    S.lastVisualSeen = t;

    S._visualLastSpokenText = t;
    S._visualLastSpokenAt = now;

    KWSR.voice.leerTextoAccesible(t);
  }

  function visualReselectTick() {
    const p = platform();
    const next = pickBestSelector(p);
    if (next && next !== (S.visualSelectorUsed || "")) {
      S.visualSelectorUsed = next;
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

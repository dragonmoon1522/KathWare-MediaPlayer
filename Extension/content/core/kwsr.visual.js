// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// - VISUAL engine: detecta texto “en pantalla” vía selectores por plataforma
//
// Disney hard-fix:
// - En Disney SOLO leemos hive subtitles (líneas) y nada más.
// - Bloqueo duro anti menú Audio/Subtítulos + idiomas (aunque el selector matchee)
// - Re-query constante (Disney recrea nodos)
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

    // Señales fuertes del menú
    const strong =
      lower.includes("audio") ||
      lower.includes("subtítulos") ||
      lower.includes("subtitulos") ||
      lower.includes("subtitles") ||
      lower.includes("[cc]") ||
      lower.includes("cc ");

    if (!strong) return false;

    // Conteo de idiomas / tokens típicos del listado
    const hits = [
      "english","deutsch","español","espanol","français","francais","italiano","português","portugues",
      "polski","magyar","dansk","norsk","svenska","suomi","türkçe","turkce","čeština","cestina",
      "română","romana","slovenčina","slovencina","nederlands","ελληνικά","日本語","한국어",
      "chinese","简体","繁體","粵語","bokmål","brasil","canada"
    ].reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);

    // Si aparecen varios idiomas, es menú casi seguro
    if (hits >= 3) return true;

    // Textos larguísimos con esas palabras => menú
    if (t.length > 160 && strong) return true;

    return false;
  }

  function looksLikeNoise(node, text) {
    const t = normalize(text);
    if (!t) return true;

    // 🚫 bloqueo duro del menú, siempre
    if (isLanguageMenuText(t)) return true;

    const tag = (node?.tagName || "").toUpperCase();
    if (["A","BUTTON","INPUT","TEXTAREA","SELECT","LABEL"].includes(tag)) return true;

    // límites generales
    if (t.length < 2 || t.length > 420) return true;

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|menu|drawer|sheet|panel|settings/.test(cls)) {
      // ojo: esto puede cortar subtítulos si el player usa “panel” en class, pero en Disney hive-line no debería caer acá.
      // igual lo dejamos suave: si parece subtítulo, lo permitimos después.
    }

    return false;
  }

  // -------------------- Disney: aceptar SOLO hive subtitles --------------------
  function disneyOnlySelectors() {
    return [
      ".hive-subtitle-renderer-line",
      ".hive-subtitle-renderer-line *",
      "[class*='hive-subtitle']",
      "[class*='hiveSubtitle']"
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
      const raw = n?.textContent;
      const t = normalize(raw);
      if (!t) continue;

      // Disney: si por algún motivo cuela el menú, lo cortamos acá también
      if (p === "disney" && isLanguageMenuText(t)) continue;

      // Disney: subtítulo real suele ser corto. Si es larguísimo, no es.
      if (p === "disney" && t.length > 140) continue;

      // Heurística extra: evitar cosas con “T##:E##” (título/episodio) pegado al menú
      if (p === "disney" && /t\d+\s*:\s*e\d+/i.test(t) && t.length > 60) continue;

      // ruido general
      if (looksLikeNoise(n, t)) continue;

      parts.push(t);
    }

    if (!parts.length) return "";

    // dedupe dentro del tick
    const uniq = [];
    const seen = new Set();
    for (const p of parts) {
      if (seen.has(p)) continue;
      seen.add(p);
      uniq.push(p);
    }

    return normalize(uniq.join(" "));
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
  }

  function startVisual() {
    const p = platform();
    S.visualSelectors = getSelectors();

    // selector “ganador”
    S.visualSelectorUsed = pickBestSelector(p);

    stopVisualObserver();

    try {
      S.visualObserver = new MutationObserver(() => {
        if (!KWSR.voice.shouldReadNow()) return;
        if (S.effectiveFuente !== "visual") return;

        if (!S.visualSelectorUsed) {
          S.visualSelectorUsed = pickBestSelector(p);
          if (!S.visualSelectorUsed) return;
        }

        const nodes = getFreshNodesBySelector(S.visualSelectorUsed);
        const t = readTextFromNodes(nodes, p);
        if (!t) return;

        if (t === S.lastVisualSeen) return;
        S.lastVisualSeen = t;

        KWSR.voice.leerTextoAccesible(t);
      });

      // Disney recrea DOM: observar doc entero
      S.visualObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
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
    if (!S.visualSelectors) S.visualSelectors = getSelectors();

    if (!S.visualSelectorUsed) {
      S.visualSelectorUsed = pickBestSelector(p);
      if (!S.visualSelectorUsed) return;
    }

    const nodes = getFreshNodesBySelector(S.visualSelectorUsed);
    const t = readTextFromNodes(nodes, p);
    if (!t) return;

    if (t === S.lastVisualSeen) return;
    S.lastVisualSeen = t;

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

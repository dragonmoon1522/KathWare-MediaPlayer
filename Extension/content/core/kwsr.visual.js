// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// - VISUAL engine: detecta texto “en pantalla” vía selectores por plataforma
//
// Disney hard-fix (Hive):
// - En Disney SOLO leemos líneas hive (renderer-line).
// - Bloqueo duro anti menú Audio/Subtítulos + idiomas.
// - Gating del observer: procesar solo mutaciones que toquen hive-line.
// - Debounce + estabilización universal (anti re-render / texto parcial)
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.visual) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG || {};
  const { normalize } = KWSR.utils;

  // Defaults “universales” (si no existen en CFG)
  const VISUAL_STABLE_MS   = Number.isFinite(CFG.visualStableMs)   ? CFG.visualStableMs   : 160; // 120..220
  const VISUAL_MIN_REPEAT  = Number.isFinite(CFG.visualMinRepeatMs)? CFG.visualMinRepeatMs: 450; // 450..700
  const DEBUG_VISUAL       = !!CFG.debugVisual;

  function platform() {
    return KWSR.platforms?.getPlatform?.() || "generic";
  }

  const dlog = (...a) => DEBUG_VISUAL && console.log("[KWSR][VISUAL]", ...a);

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

    // límites generales (sub puede ser largo, pero no infinito)
    if (t.length < 2 || t.length > 420) return true;

    return false;
  }

  // -------------------- Helpers visual --------------------
  function isVisible(el) {
    try {
      if (!el || !(el instanceof Element)) return false;
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

  // -------------------- Disney: aceptar SOLO hive subtitles --------------------
  function disneyOnlySelectors() {
    return [
      ".hive-subtitle-renderer-line",
      "[class*='hive-subtitle-renderer-line']",
      "[class*='hiveSubtitle'][class*='Line']",
      "[class*='hive-subtitle'][class*='line']"
    ];
  }

  // Fallback genérico si una plataforma nueva no tiene selector:
  // (ojo: no es “perfecto”, pero te da chances sin hardcodear hostnames)
  function genericFallbackSelectors() {
    return [
      // los clásicos “SR / live regions”
      "[aria-live='polite']",
      "[aria-live='assertive']",
      "[role='status']",
      // palabras comunes
      "[class*='caption']",
      "[class*='subtit']",
      "[class*='timedtext']",
      "[class*='timed-text']",
      "[data-testid*='caption']",
      "[data-testid*='subtitle']",
    ];
  }

  function getSelectors() {
    const p = platform();
    if (p === "disney") return disneyOnlySelectors();

    const fromPlatform = KWSR.platforms?.platformSelectors?.(p) || [];
    if (fromPlatform.length) return fromPlatform;

    // si no sabemos nada: fallback “best effort”
    return genericFallbackSelectors();
  }

  function getFreshNodesBySelector(sel) {
    try { return Array.from(document.querySelectorAll(sel)); } catch { return []; }
  }

  function smartJoin(lines) {
    if (!lines || !lines.length) return "";
    let result = lines[0];

    for (let i = 1; i < lines.length; i++) {
      const prev = result.trim();
      const curr = lines[i];

      // Si ya hay puntuación fuerte, no inventamos nada
      if (/[.!?…]$/.test(prev)) {
        result = prev + " " + curr;
        continue;
      }

      // Si ambas parecen fragmentos cortos e independientes → coma
      if (prev.length < 40 && curr.length < 40) {
        result = prev + ", " + curr;
        continue;
      }

      // Caso general: continuidad natural
      result = prev + " " + curr;
    }

    return normalize(result);
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

      // Disney: hard filters extra
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

  // -------------------- Estabilizador universal (anti texto parcial / re-render) --------------------
  function stableKey(text) {
    return normalize(text)
      .replace(/\u00A0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function scheduleStableEmit(text, p) {
    const key = stableKey(text);
    if (!key) return;

    // filtro extra: si por algún motivo entra menú, ni candidato
    if (isLanguageMenuText(text)) return;

    S._visualCandidateText = text;
    S._visualCandidateKey = key;

    // cada update reinicia el timer → emitimos el “último estado estable”
    try { if (S._visualStableTimer) clearTimeout(S._visualStableTimer); } catch {}
    S._visualStableTimer = setTimeout(() => emitStableNow(p), VISUAL_STABLE_MS);
  }

  function emitStableNow(p) {
    const text = S._visualCandidateText || "";
    if (!text) return;

    const key = S._visualCandidateKey || stableKey(text);
    if (!key) return;

    const now = performance.now();

    // Anti eco por re-render (mismo texto en ventana chica)
    if (key === (S._visualLastSpokenKey || "") && (now - (S._visualLastSpokenAt || 0)) < VISUAL_MIN_REPEAT) {
      return;
    }

    S._visualLastSpokenKey = key;
    S._visualLastSpokenAt = now;
    S.lastVisualSeen = text;

    dlog("emit", { p, key, text });
    KWSR.voice.leerTextoAccesible(text);
  }

  function stopVisualObserver() {
    try { S.visualObserver?.disconnect?.(); } catch {}
    S.visualObserver = null;
    S.visualObserverActive = false;

    // scheduler flags
    S._visualScheduled = false;

    // stable emitter state
    try { if (S._visualStableTimer) clearTimeout(S._visualStableTimer); } catch {}
    S._visualStableTimer = null;
    S._visualCandidateText = "";
    S._visualCandidateKey = "";

    // last spoken
    S._visualLastSpokenAt = 0;
    S._visualLastSpokenKey = "";
  }

  // -------------------- Scheduler anti-spam (observer -> debounce) --------------------
  function scheduleVisualRead(reasonNode) {
    if (!KWSR.voice.shouldReadNow()) return;
    if (S.effectiveFuente !== "visual") return;

    const p = platform();

    // Disney gating: si la mutación no toca hive-line, ignoramos.
    if (p === "disney" && reasonNode) {
      try {
        const el = reasonNode.nodeType === 1 ? reasonNode : reasonNode.parentElement;
        if (el && !el.closest?.(".hive-subtitle-renderer-line,[class*='hive-subtitle-renderer-line']")) {
          return;
        }
      } catch {}
    }

    if (S._visualScheduled) return;
    S._visualScheduled = true;

    // Debounce por frame: juntamos mutaciones del mismo frame
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

        // nodo motivo (para gating Disney)
        let reasonNode = null;
        for (const m of mutations) {
          if (m.target) { reasonNode = m.target; break; }
          if (m.addedNodes && m.addedNodes[0]) { reasonNode = m.addedNodes[0]; break; }
        }
        scheduleVisualRead(reasonNode);
      });

      // observar doc entero (universal) + gating en scheduler para Disney
      S.visualObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });

      S.visualObserverActive = true;
    } catch {
      S.visualObserverActive = false;
    }

    dlog("start", { p, selector: S.visualSelectorUsed, selectors: S.visualSelectors });
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

    // En vez de “leer ya”, estabilizamos SIEMPRE (universal)
    scheduleStableEmit(t, p);

    // opcional: en polling (no observer) evitamos recalentar la CPU con logs
    if (!fromObserver) {
      // nada
    }
  }

  function visualReselectTick() {
    const p = platform();
    const next = pickBestSelector(p);
    if (next && next !== (S.visualSelectorUsed || "")) {
      dlog("reselect", { p, from: S.visualSelectorUsed, to: next });
      S.visualSelectorUsed = next;
      startVisual();
    }
  }

  // -------------------- Debug helper: scan de candidatos “raros” --------------------
  // Útil para plataformas donde no sabés el selector:
  // KWSR.visual.debugScanCandidates()
  function debugScanCandidates(limit = 20) {
    try {
      const sels = getSelectors();
      const p = platform();

      const items = [];
      for (const sel of sels) {
        const nodes = getFreshNodesBySelector(sel);
        if (!nodes.length) continue;

        const text = readTextFromNodes(nodes, p);
        if (!text) continue;

        items.push({ sel, nodes: nodes.length, text });
      }

      items.sort((a, b) => (b.text.length - a.text.length));
      console.log("[KWSR][VISUAL][SCAN]", {
        platform: p,
        selectorUsed: S.visualSelectorUsed,
        stableMs: VISUAL_STABLE_MS,
        minRepeatMs: VISUAL_MIN_REPEAT,
        top: items.slice(0, limit)
      });
    } catch (e) {
      console.warn("[KWSR][VISUAL][SCAN] error", e);
    }
  }

  KWSR.visual = {
    startVisual,
    stopVisualObserver,
    pollVisualTick,
    visualReselectTick,
    debugScanCandidates
  };
})();

// ====================================================
// KathWare SubtitleReader - kwsr.visual.js
// - VISUAL engine: detecta texto “en pantalla” vía selectores por plataforma
//
// Fix anti-spam universal:
// - Observer + Poll NO duplican: si observer está activo, poll solo fallback
// - Scheduler con RAF (debounce por frame) + dirty flag
// - Dedupe por (texto + key contenedor) + ventana temporal
// - Permite repeticiones legítimas (si pasa cierto tiempo)
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.visual) return;

  const S = KWSR.state;
  const CFG = KWSR.CFG;
  const { normalize } = KWSR.utils;

  const DEBUG = () => !!(CFG?.debug && CFG?.debugVisual);

  function platform() {
    return KWSR.platforms?.getPlatform?.() || "generic";
  }
  function caps() {
    const p = platform();
    return KWSR.platforms?.platformCapabilities?.(p) || {};
  }

  // -------------------- Anti “Audio/Subtítulos + idiomas” (general) --------------------
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

    const cls = ((node?.className || "") + " " + (node?.id || "")).toLowerCase();
    if (/toast|snack|tooltip|popover|modal|dialog|notif|banner|sr-only|screenreader-only/.test(cls)) return true;

    return false;
  }

  // -------------------- Helpers --------------------
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

  function getSelectors() {
    const p = platform();
    return KWSR.platforms?.platformSelectors?.(p) || [];
  }

  function getFreshNodesBySelector(sel) {
    try { return Array.from(document.querySelectorAll(sel)); } catch { return []; }
  }

  // “key” para distinguir contenedor de captions sin depender del texto
  function containerKeyForNode(n) {
    try {
      const el = n?.nodeType === 1 ? n : n?.parentElement;
      if (!el) return "no-el";

      const wrap =
        el.closest?.(
          "[data-testid*='cue'],[data-uia*='subtitle'],[data-uia*='captions'],[class*='caption'],[class*='subtitle'],[class*='timedtext']"
        ) || el;

      const tag = (wrap.tagName || "").toLowerCase();
      const tid = wrap.getAttribute("data-testid") || "";
      const uia = wrap.getAttribute("data-uia") || "";
      const cls = String(wrap.className || "").slice(0, 120);
      return `${tag}|${tid}|${uia}|${cls}`;
    } catch {
      return "key-err";
    }
  }

  function smartJoin(lines) {
    if (!lines || !lines.length) return "";
    let result = lines[0];

    for (let i = 1; i < lines.length; i++) {
      const prev = result.trim();
      const curr = lines[i];

      if (/[.!?…]$/.test(prev)) { result = prev + " " + curr; continue; }
      if (prev.length < 40 && curr.length < 40) { result = prev + ", " + curr; continue; }
      result = prev + " " + curr;
    }

    return normalize(result);
  }

  function readTextFromNodes(nodes, p) {
    if (!nodes?.length) return { text: "", key: "" };

    const parts = [];
    let key = "";

    for (const n of nodes) {
      if (!n) continue;

      if (p === "disney" && !isVisible(n)) continue;

      const raw = n.textContent;
      const t = normalize(raw);
      if (!t) continue;

      if (p === "disney" && isLanguageMenuText(t)) continue;
      if (looksLikeNoise(n, t)) continue;

      if (!key) key = containerKeyForNode(n);
      parts.push(t);
    }

    if (!parts.length) return { text: "", key: "" };

    const uniq = [];
    const seen = new Set();
    for (const x of parts) {
      if (seen.has(x)) continue;
      seen.add(x);
      uniq.push(x);
    }

    return { text: smartJoin(uniq), key: key || "no-key" };
  }

  function pickBestSelector(p) {
    const selectors = getSelectors();
    for (const sel of selectors) {
      const nodes = getFreshNodesBySelector(sel);
      if (!nodes.length) continue;

      const { text } = readTextFromNodes(nodes, p);
      if (text) return sel;
    }
    return "";
  }

  // -------------------- Observer control --------------------
  function stopVisualObserver() {
    try { S.visualObserver?.disconnect?.(); } catch {}
    S.visualObserver = null;
    S.visualObserverActive = false;

    // scheduler flags
    S._visualScheduled = false;
    S.visualDirty = false;
    S.visualDirtyAt = 0;

    // dedupe (visual-only)
    S._visualLastAt = 0;
    S._visualLastText = "";
    S._visualLastKey = "";
  }

  // RAF scheduler: 1 lectura por frame si hubo mutaciones
  function requestVisualFrame(reasonNode) {
    if (S._visualScheduled) return;
    S._visualScheduled = true;

    requestAnimationFrame(() => {
      S._visualScheduled = false;
      // Consumimos dirty dentro del tick
      pollVisualTick(true, reasonNode);
    });
  }

  function scheduleVisualRead(reasonNode) {
    if (S.effectiveFuente !== "visual") return;

    // Disney gating: si la mutación no toca hive-line, ignoramos
    const p = platform();
    if (p === "disney" && reasonNode) {
      try {
        const el = reasonNode.nodeType === 1 ? reasonNode : reasonNode.parentElement;
        if (el && !el.closest?.(".hive-subtitle-renderer-line,[class*='hive-subtitle-renderer-line']")) {
          return;
        }
      } catch {}
    }

    S.visualDirty = true;
    S.visualDirtyAt = performance.now();

    requestVisualFrame(reasonNode);
  }

  function startVisual() {
    const p = platform();
    S.visualSelectors = getSelectors();
    S.visualSelectorUsed = pickBestSelector(p);

    stopVisualObserver();

    const useDocObserver = !!caps().visualDocObserver; // si algún día querés cap por plataforma

    try {
      S.visualObserver = new MutationObserver((mutations) => {
        if (!mutations || !mutations.length) return;

        let reasonNode = null;
        for (const m of mutations) {
          if (m.target) { reasonNode = m.target; break; }
          if (m.addedNodes && m.addedNodes[0]) { reasonNode = m.addedNodes[0]; break; }
        }

        scheduleVisualRead(reasonNode);
      });

      const target = useDocObserver ? document.documentElement : (document.body || document.documentElement);

      S.visualObserver.observe(target, {
        childList: true,
        subtree: true,
        characterData: true
      });

      S.visualObserverActive = true;

      if (DEBUG()) KWSR.log?.("VISUAL start", { platform: p, selector: S.visualSelectorUsed, docObserver: useDocObserver });
    } catch (e) {
      S.visualObserverActive = false;
      if (DEBUG()) KWSR.warn?.("VISUAL observer failed", { err: String(e?.message || e) });
    }

    KWSR.overlay?.updateOverlayStatus?.();
  }

  // -------------------- Poll tick (fallback + dedupe) --------------------
  function pollVisualTick(fromObserver = false, reasonNode = null) {
    if (!KWSR.voice?.shouldReadNow?.()) return;
    if (S.effectiveFuente !== "visual") return;

    // ✅ si no viene del observer y el observer está activo => fallback puro (no habla)
    if (!fromObserver && S.visualObserverActive) return;

    // ✅ si viene del observer, solo leemos si hubo dirty
    if (fromObserver) {
      if (!S.visualDirty) return;
      S.visualDirty = false;
    }

    const p = platform();
    if (!S.visualSelectors) S.visualSelectors = getSelectors();

    if (!S.visualSelectorUsed) {
      S.visualSelectorUsed = pickBestSelector(p);
      if (!S.visualSelectorUsed) return;
    }

    const nodes = getFreshNodesBySelector(S.visualSelectorUsed);
    const { text, key } = readTextFromNodes(nodes, p);
    if (!text) return;

    // ----- Dedupe robusto -----
    const now = performance.now();

    const minRepeatMs = 750;
    const allowRepeatAfterMs = 1800;

    const sameText = text === (S._visualLastText || "");
    const sameKey  = key && key === (S._visualLastKey || "");

    if (sameText && sameKey) {
      const dt = now - (S._visualLastAt || 0);
      if (dt < minRepeatMs) {
        if (DEBUG()) KWSR.log?.("VISUAL dedupe (rerender)", { dt: Math.round(dt), text });
        return;
      }
      if (dt < allowRepeatAfterMs) {
        if (DEBUG()) KWSR.log?.("VISUAL dedupe (grey)", { dt: Math.round(dt), text });
        return;
      }
    }

    if (!fromObserver && text === S.lastVisualSeen) return;
    S.lastVisualSeen = text;

    S._visualLastText = text;
    S._visualLastKey = key || "";
    S._visualLastAt = now;

    if (DEBUG()) KWSR.log?.("VISUAL speak", { selector: S.visualSelectorUsed, key, fromObserver, text });

    KWSR.voice?.leerTextoAccesible?.(text);
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

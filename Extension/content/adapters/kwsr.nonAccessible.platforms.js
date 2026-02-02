// -----------------------------------------------------------------------------
// KathWare SubtitleReader - kwsr.nonAccessible.platforms.js
// -----------------------------------------------------------------------------
//
// PARA QUÉ EXISTE
// --------------
// Hay reproductores con botones “solo ícono” o menús de audio/subtítulos con
// elementos sin texto accesible.
//
// Resultado típico:
// - el lector de pantalla dice “botón” / “sin nombre”
// - navegar es un suplicio
//
// QUÉ HACE
// --------
// 1) Autolabeling cerca del video:
//    - busca controles visibles que se superponen con el área del video
//    - si no tienen nombre accesible, les agrega aria-label / role / tabindex
//    - nunca pisa labels reales del sitio (solo pisa labels nuestros anteriores)
//
// 2) Menús de audio/subtítulos:
//    - detecta “menús” o paneles con opciones de audio/subs
//    - etiqueta ítems visibles (idiomas, CC, etc.)
//
// CUÁNDO CORRE
// -----------
// - solo si la extensión está ON
// - solo si la plataforma declara nonAccessibleFixes = true
//
// IMPORTANTE
// ----------
// - NO lee subtítulos
// - NO toca TRACK/VISUAL
// - NO toca nuestra UI (overlay/toast/live region)
//
// NOTA DE RENDIMIENTO
// -------------------
// QuerySelectorAll gigante cada ~650ms puede ser caro.
// Por eso:
// - gate por capabilities
// - firma (signature) para no relabelar si “no cambió nada”
// - throttle interno por si el timer viene agresivo
// -----------------------------------------------------------------------------

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.nonAccessiblePlatforms) return;

  const S = KWSR.state;

  // Fallback simple si utils todavía no existe por algún motivo.
  const normalize = KWSR.utils?.normalize || (s => String(s || "").replace(/\s+/g, " ").trim());

  // No tocar nada que sea nuestro (evita auto-etiquetar overlay/toast/live region).
  const OUR_UI_SELECTOR =
    "#kathware-overlay-root," +
    "#kathware-overlay-panel," +
    "#kw-toast," +
    "#kwsr-live-region," +
    "#kathware-live-region";

  // Throttle: evita escanear demasiado seguido si el timer se dispara rápido.
  const THROTTLE_MS = 350;
  let lastScanAt = 0;

  // ---------------------------------------------------------------------------
  // shouldRun()
  // ---------------------------------------------------------------------------
  function shouldRun() {
    if (!S.extensionActiva) return false;

    const p = KWSR.platforms?.getPlatform?.() || "generic";
    const caps = KWSR.platforms?.platformCapabilities?.(p) || {};
    return !!caps.nonAccessibleFixes;
  }

  // ---------------------------------------------------------------------------
  // isVisibleEl(el)
  // ---------------------------------------------------------------------------
  function isVisibleEl(el) {
    try {
      if (!el || !el.getBoundingClientRect) return false;

      const r = el.getBoundingClientRect();
      if (r.width < 14 || r.height < 14) return false;

      const cs = getComputedStyle(el);
      if (!cs) return false;
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (Number(cs.opacity || 1) < 0.05) return false;
      if (cs.pointerEvents === "none") return false;

      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // intersectsVideo(el, vr)
  // ---------------------------------------------------------------------------
  // vr = rect del video.
  // Intersección por área (evita “casi cerca”).
  function intersectsVideo(el, vr) {
    try {
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(vr.right, r.right) - Math.max(vr.left, r.left));
      const y = Math.max(0, Math.min(vr.bottom, r.bottom) - Math.max(vr.top, r.top));
      return (x * y) > 120; // umbral para evitar micro solapes
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // stableElKey(el)
  // ---------------------------------------------------------------------------
  // “Huella” del elemento para armar signature del conjunto.
  // No es único perfecto, pero sirve para detectar cambios.
  function stableElKey(el) {
    try {
      const tag = (el.tagName || "").toLowerCase();
      const tid = el.getAttribute("data-testid") || "";
      const role = el.getAttribute("role") || "";
      const aria = el.getAttribute("aria-label") || "";
      const cls = String(el.className || "").slice(0, 80);
      return `${tag}|${tid}|${role}|${aria}|${cls}`;
    } catch {
      return "bad-el";
    }
  }

  // ---------------------------------------------------------------------------
  // controlsSignature(els)
  // ---------------------------------------------------------------------------
  function controlsSignature(els) {
    try {
      const parts = els.slice(0, 120).map(stableElKey);
      return `${els.length}::${parts.join("§")}`;
    } catch {
      return String(els?.length || 0);
    }
  }

  // ---------------------------------------------------------------------------
  // guessIconOnlyLabel(testId, cls)
  // ---------------------------------------------------------------------------
  function guessIconOnlyLabel(testId, cls) {
    const blob = normalize(`${testId} ${cls}`).toLowerCase();

    if (testId === "volume-btn" || blob.includes("volume") || blob.includes("mute")) return "Volumen / Silenciar";
    if (testId === "cast-btn" || blob.includes("cast") || blob.includes("chromecast")) return "Transmitir (Cast)";
    if (testId === "full-screen-btn" || blob.includes("full") || blob.includes("screen")) return "Pantalla completa";
    if (testId === "audio-subtitle-btn" || blob.includes("subtitle") || blob.includes("audio")) return "Audio y subtítulos";
    if (testId === "more-emissions-btn" || blob.includes("emission") || blob.includes("episod")) return "Ir a episodios";
    if (testId === "back-btn" || blob.includes("back") || blob.includes("volver")) return "Volver";

    // Fallbacks típicos
    if (blob.includes("play")) return "Reproducir";
    if (blob.includes("pause")) return "Pausar";
    if (blob.includes("rewind") || blob.includes("backward")) return "Retroceder";
    if (blob.includes("forward") || blob.includes("next")) return "Adelantar";
    if (blob.includes("settings")) return "Configuración";

    return "Control del reproductor";
  }

  // ---------------------------------------------------------------------------
  // applyA11yLabel(el, label)
  // ---------------------------------------------------------------------------
  // Aplica label de manera conservadora:
  // - si ya hay aria-label real, no tocamos
  // - si era autolabel nuestro anterior, podemos actualizar
  function applyA11yLabel(el, label) {
    try {
      if (!el) return 0;

      const t = normalize(label);
      if (!t) return 0;

      const prev = el.getAttribute("aria-label") || "";
      const prevAuto = el.getAttribute("data-kw-autolabel") === "1";

      // Solo seteamos si:
      // - no hay aria-label, o
      // - era autogenerado por nosotros y cambió
      const shouldSet = (!prev) || (prevAuto && prev !== t);

      if (shouldSet) {
        el.setAttribute("aria-label", t);
        el.setAttribute("data-kw-autolabel", "1");
      }

      // Semántica mínima
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      if (!el.getAttribute("role")) el.setAttribute("role", "button");

      return shouldSet ? 1 : 0;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // getControlCandidates()
  // ---------------------------------------------------------------------------
  // Nota: [tabindex] trae mucho “ruido”, pero lo filtramos fuerte con:
  // - visibilidad
  // - intersección con video
  // - excluir nuestra UI
  function getControlCandidates() {
    try {
      return Array.from(
        document.querySelectorAll(
          "button," +
          "[role='button']," +
          "[aria-controls]," +
          "[data-testid]," +
          "[tabindex]"
        )
      );
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // labelControlsNearVideo()
  // ---------------------------------------------------------------------------
  function labelControlsNearVideo() {
    if (!shouldRun()) return 0;

    const now = Date.now();
    if (now - lastScanAt < THROTTLE_MS) return 0;
    lastScanAt = now;

    const v = S.currentVideo || KWSR.video?.getMainVideo?.();
    if (!v) return 0;

    let vr;
    try { vr = v.getBoundingClientRect(); } catch { return 0; }
    if (!vr || vr.width < 20 || vr.height < 20) return 0;

    const candidates = getControlCandidates();

    const filtered = candidates.filter(el => {
      try {
        if (!el) return false;
        if (el.closest?.(OUR_UI_SELECTOR)) return false;
        if (!isVisibleEl(el)) return false;
        if (!intersectsVideo(el, vr)) return false;
        return true;
      } catch {
        return false;
      }
    });

    // Signature para evitar relabel constante
    const sig = controlsSignature(filtered);
    if (sig === S.lastNonAccControlsSig) return 0;
    S.lastNonAccControlsSig = sig;

    let labeled = 0;

    for (const el of filtered) {
      // Preferimos texto visible si existe
      const txt = normalize(el.innerText || el.textContent || "");

      // Si no hay texto, inferimos por data-testid / className
      const testId = el.getAttribute("data-testid") || "";
      const cls = String(el.className || "");
      const label = txt || guessIconOnlyLabel(testId, cls);

      labeled += applyA11yLabel(el, label);
    }

    // Debug suave (no spamear consola)
    if (KWSR.CFG?.debug && labeled !== S.lastNonAccLabeledCount) {
      console.log("[KathWare] nonAccessible fixes:", { labeled, changed: true });
      S.lastNonAccLabeledCount = labeled;
    }

    return labeled;
  }

  // ---------------------------------------------------------------------------
  // findA11yMenus()
  // ---------------------------------------------------------------------------
  // Busca menús/paneles visibles que parecen de Audio/Subtítulos.
  function findA11yMenus() {
    const candidates = Array.from(document.querySelectorAll(
      "[role='menu']," +
      "[role='dialog']," +
      "[role='listbox']," +
      "[class*='menu']," +
      "[class*='Menu']," +
      "[class*='settings']," +
      "[class*='Settings']"
    ));

    return candidates.filter(el => {
      try {
        if (!isVisibleEl(el)) return false;
        if (el.closest?.(OUR_UI_SELECTOR)) return false;

        const t = normalize(el.innerText || el.textContent || "");
        if (!t) return false;

        return /audio|sub|subt[ií]t|idioma|lengua|cc|captions/i.test(t);
      } catch {
        return false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // labelMenu(menuEl)
  // ---------------------------------------------------------------------------
  // Etiqueta items del menú para que sean navegables.
  // Usamos WeakMap con “firma” para reprocesar si el menú cambió fuerte.
  let menuSigMap = null;

  function menuSignature(menuEl) {
    try {
      const t = normalize(menuEl.innerText || menuEl.textContent || "");
      return `${t.length}::${t.slice(0, 140).toLowerCase()}`;
    } catch {
      return "menu-err";
    }
  }

  function labelMenu(menuEl) {
    if (!menuEl) return 0;

    if (!menuSigMap) menuSigMap = new WeakMap();

    const sig = menuSignature(menuEl);
    const prevSig = menuSigMap.get(menuEl);

    // Si el menú ya fue procesado con la misma firma, no repetimos.
    if (prevSig && prevSig === sig) return 0;
    menuSigMap.set(menuEl, sig);

    try {
      if (!menuEl.getAttribute("role")) menuEl.setAttribute("role", "dialog");
      if (!menuEl.getAttribute("aria-label")) menuEl.setAttribute("aria-label", "Audio y subtítulos");
    } catch {}

    const items = Array.from(
      menuEl.querySelectorAll("button,[role='menuitem'],[role='option'],li,[tabindex]")
    ).filter(isVisibleEl);

    let labeled = 0;

    for (const it of items) {
      if (!it || it.closest?.(OUR_UI_SELECTOR)) continue;

      const txt = normalize(it.innerText || it.textContent || "");
      if (!txt) continue;

      labeled += applyA11yLabel(it, txt);
    }

    if (KWSR.CFG?.debug && labeled) {
      console.log("[KathWare] nonAccessible menu:", { labeledItems: labeled });
    }

    return labeled;
  }

  // ---------------------------------------------------------------------------
  // Menu observer
  // ---------------------------------------------------------------------------
  function startMenuObserver() {
    if (S.nonAccMenuObserver) return;

    S.nonAccMenuObserver = new MutationObserver(() => {
      if (!shouldRun()) return;

      const menus = findA11yMenus();
      for (const m of menus) labelMenu(m);
    });

    try {
      S.nonAccMenuObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      // No es crítico: silencioso.
    }
  }

  function stopMenuObserver() {
    try { S.nonAccMenuObserver?.disconnect?.(); } catch {}
    S.nonAccMenuObserver = null;
  }

  // ---------------------------------------------------------------------------
  // tick()
  // ---------------------------------------------------------------------------
  // Llamado por el timer de adapters del pipeline.
  function tick() {
    if (!shouldRun()) return;

    // 1) Etiquetado de controles “encima/cerca” del video
    labelControlsNearVideo();

    // 2) Menús se manejan por observer (mucho más eficiente que scannear siempre)
  }

  // Export público
  KWSR.nonAccessiblePlatforms = {
    shouldRun,
    isVisibleEl,
    intersectsVideo,
    stableElKey,
    controlsSignature,
    guessIconOnlyLabel,
    applyA11yLabel,

    labelControlsNearVideo,

    findA11yMenus,
    labelMenu,
    startMenuObserver,
    stopMenuObserver,

    tick
  };

  // ---------------------------------------------------------------------------
  // Nota de mantenimiento
  // ---------------------------------------------------------------------------
  // Este módulo edita DOM de terceros (aria-label/role/tabindex).
  // Regla de oro:
  // - ser conservadores
  // - no tocar labels reales del sitio
  // - jamás tocar nuestra UI (OUR_UI_SELECTOR)
  // -----------------------------------------------------------------------------

})();
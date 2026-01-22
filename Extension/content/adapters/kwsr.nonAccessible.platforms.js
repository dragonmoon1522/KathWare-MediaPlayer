// ====================================================
// KathWare SubtitleReader - kwsr.nonAccessible.platforms.js
// - Adaptaciones para plataformas con UI poco accesible:
//   1) Autolabeling: agrega aria-label/role/tabindex a controles cerca del video
//   2) Observer de menús (audio/subtítulos): etiqueta items visibles
// - Se activa solo si platformCapabilities().nonAccessibleFixes === true
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.nonAccessiblePlatforms) return;

  const S = KWSR.state;
  const normalize = KWSR.utils?.normalize || (s => String(s || "").trim());

  function shouldRun() {
    if (!S.extensionActiva) return false;
    const p = KWSR.platforms?.getPlatform?.() || "generic";
    const caps = KWSR.platforms?.platformCapabilities?.(p) || {};
    return !!caps.nonAccessibleFixes;
  }

  function isVisibleEl(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 14 || r.height < 14) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity || 1) < 0.05) return false;
    if (cs.pointerEvents === "none") return false;
    return true;
  }

  function intersectsVideo(el, vr) {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(vr.right, r.right) - Math.max(vr.left, r.left));
    const y = Math.max(0, Math.min(vr.bottom, r.bottom) - Math.max(vr.top, r.top));
    return (x * y) > 120;
  }

  function stableElKey(el) {
    const tag = (el.tagName || "").toLowerCase();
    const tid = el.getAttribute("data-testid") || "";
    const role = el.getAttribute("role") || "";
    const aria = el.getAttribute("aria-label") || "";
    const cls = String(el.className || "").slice(0, 80);
    return `${tag}|${tid}|${role}|${aria}|${cls}`;
  }

  function controlsSignature(els) {
    try {
      const parts = els.slice(0, 120).map(stableElKey);
      return `${els.length}::${parts.join("§")}`;
    } catch {
      return String(els.length);
    }
  }

  function guessIconOnlyLabel(testId, cls) {
    const blob = normalize(`${testId} ${cls}`).toLowerCase();

    if (testId === "volume-btn" || blob.includes("volume") || blob.includes("mute")) return "Volumen / Silenciar";
    if (testId === "cast-btn" || blob.includes("cast") || blob.includes("chromecast")) return "Transmitir (Cast)";
    if (testId === "full-screen-btn" || blob.includes("full") || blob.includes("screen")) return "Pantalla completa";
    if (testId === "audio-subtitle-btn" || blob.includes("subtitle") || blob.includes("audio")) return "Audio y subtítulos";
    if (testId === "more-emissions-btn" || blob.includes("emission") || blob.includes("episod")) return "Ir a episodios";
    if (testId === "back-btn" || blob.includes("back") || blob.includes("volver")) return "Volver";

    // fallback genérico
    if (blob.includes("play")) return "Reproducir";
    if (blob.includes("pause")) return "Pausar";
    if (blob.includes("rewind") || blob.includes("backward")) return "Retroceder";
    if (blob.includes("forward") || blob.includes("next")) return "Adelantar";
    if (blob.includes("settings")) return "Configuración";

    return "Control del reproductor";
  }

  function applyA11yLabel(el, label) {
    if (!el) return 0;
    const t = normalize(label);
    if (!t) return 0;

    const prev = el.getAttribute("aria-label") || "";
    const prevAuto = el.getAttribute("data-kw-autolabel") === "1";
    const shouldSet = (!prev) || (prevAuto && prev !== t);

    if (shouldSet) {
      el.setAttribute("aria-label", t);
      el.setAttribute("data-kw-autolabel", "1");
    }

    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (!el.getAttribute("role")) el.setAttribute("role", "button");

    return shouldSet ? 1 : 0;
  }

  function labelControlsNearVideo() {
    if (!shouldRun()) return 0;

    const v = S.currentVideo || KWSR.video?.getMainVideo?.();
    if (!v) return 0;
    const vr = v.getBoundingClientRect();

    // Controles candidatos (acá la clave es: pocos falsos positivos + no tocar overlay nuestro)
    const all = Array.from(
      document.querySelectorAll("button,[role='button'],[tabindex],[data-testid]")
    ).filter(el =>
      el.getBoundingClientRect &&
      isVisibleEl(el) &&
      intersectsVideo(el, vr) &&
      !el.closest("#kathware-overlay-root,#kathware-overlay-panel,#kw-toast,#kathware-live-region")
    );

    const sig = controlsSignature(all);
    if (sig === S.lastNonAccControlsSig) return 0;
    S.lastNonAccControlsSig = sig;

    let labeled = 0;
    for (const el of all) {
      const txt = normalize(el.innerText || el.textContent || "");
      const testId = el.getAttribute("data-testid") || "";
      const cls = String(el.className || "");
      const label = txt || guessIconOnlyLabel(testId, cls);
      labeled += applyA11yLabel(el, label);
    }

    if (KWSR.CFG?.debug && labeled !== S.lastNonAccLabeledCount) {
      console.log("[KathWare] nonAccessible fix:", { mode: "dynamic-label", labeled, changed: true });
    }
    S.lastNonAccLabeledCount = labeled;

    return labeled;
  }

  // ---- Menús (audio/subs) ----
  function findA11yMenus() {
    const candidates = Array.from(document.querySelectorAll(
      "[role='menu'],[role='dialog'],[role='listbox'],[class*='menu'],[class*='Menu'],[class*='settings'],[class*='Settings']"
    ));

    return candidates.filter(el => {
      try {
        if (!isVisibleEl(el)) return false;
        if (el.closest("#kathware-overlay-root,#kathware-overlay-panel,#kw-toast")) return false;
        const t = normalize(el.innerText || el.textContent || "");
        if (!t) return false;
        return /audio|sub|subt[ií]t|idioma|lengua|cc|captions/i.test(t);
      } catch {
        return false;
      }
    });
  }

  function labelMenu(menuEl) {
    if (!menuEl) return 0;

    // Usamos WeakSet para no re-procesar el mismo menú
    if (!S.nonAccMenusProcessed) S.nonAccMenusProcessed = new WeakSet();
    if (S.nonAccMenusProcessed.has(menuEl)) return 0;
    S.nonAccMenusProcessed.add(menuEl);

    if (!menuEl.getAttribute("role")) menuEl.setAttribute("role", "dialog");
    if (!menuEl.getAttribute("aria-label")) menuEl.setAttribute("aria-label", "Audio y subtítulos");

    const items = Array.from(menuEl.querySelectorAll("button,[role='menuitem'],[role='option'],li,[tabindex]"))
      .filter(isVisibleEl);

    let labeled = 0;
    for (const it of items) {
      const txt = normalize(it.innerText || it.textContent || "");
      if (!txt) continue;
      labeled += applyA11yLabel(it, txt);
    }

    if (KWSR.CFG?.debug && labeled) console.log("[KathWare] nonAccessible menu:", { labeledItems: labeled });
    return labeled;
  }

  function startMenuObserver() {
    if (S.nonAccMenuObserver) return;

    S.nonAccMenuObserver = new MutationObserver(() => {
      if (!shouldRun()) return;
      const menus = findA11yMenus();
      for (const m of menus) labelMenu(m);
    });

    try {
      S.nonAccMenuObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
  }

  function stopMenuObserver() {
    try { S.nonAccMenuObserver?.disconnect?.(); } catch {}
    S.nonAccMenuObserver = null;
  }

  function tick() {
    // tick de adapters para ser llamado por pipeline timer
    if (!shouldRun()) return;

    // 1) autolabel de controles cercanos
    labelControlsNearVideo();
  }

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

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Renombre conceptual: el viejo flowA11y pasa a ser un adapter genérico:
    kwsr.nonAccessible.platforms.js (independiente de Flow).
  - Gate por capabilities: solo corre si platformCapabilities().nonAccessibleFixes === true.
  - Mantiene la lógica de autolabel (aria-label + role + tabindex) para botones/icon-only
    cerca del video, evitando tocar nuestro overlay/toast/live region.
  - Se añadió observer genérico de menús (audio/subs) para etiquetar items al abrirse.
  - Se guardan firmas/contadores en state para evitar reprocesar constantemente:
    S.lastNonAccControlsSig, S.lastNonAccLabeledCount, WeakSet de menús.
  */
})();

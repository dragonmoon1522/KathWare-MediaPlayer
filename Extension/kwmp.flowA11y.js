(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.flowA11y) return;

  const S = KWMP.state;
  const { normalize } = KWMP.utils;

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

  function flowControlsSignature(els) {
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
    if (testId === "back-btn" || blob.includes("back")) return "Volver";
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

  function labelFlowControls() {
    if (KWMP.platforms.getPlatform() !== "flow") return 0;

    const v = S.currentVideo || KWMP.video.getMainVideo();
    if (!v) return 0;
    const vr = v.getBoundingClientRect();

    const all = Array.from(document.querySelectorAll("button,[role='button'],[tabindex],[data-testid]"))
      .filter(el =>
        el.getBoundingClientRect &&
        isVisibleEl(el) &&
        intersectsVideo(el, vr) &&
        !el.closest("#kathware-overlay-root,#kathware-overlay-panel,#kw-toast,#kathware-live-region")
      );

    const sig = flowControlsSignature(all);
    if (sig === S.lastFlowControlsSig) return 0;
    S.lastFlowControlsSig = sig;

    let labeled = 0;
    for (const el of all) {
      const txt = normalize(el.innerText || el.textContent || "");
      const testId = el.getAttribute("data-testid") || "";
      const cls = String(el.className || "");
      const label = txt || guessIconOnlyLabel(testId, cls);
      labeled += applyA11yLabel(el, label);
    }

    if (KWMP.CFG.debug && labeled !== S.lastFlowLabeledCount) {
      console.log("[KathWare] FlowMode:", { mode: "dynamic-label", labeled, changed: true });
    }
    S.lastFlowLabeledCount = labeled;

    return labeled;
  }

  function findFlowMenus() {
    const candidates = Array.from(document.querySelectorAll(
      "[role='menu'],[role='dialog'],[role='listbox'],[class*='menu'],[class*='Menu'],[class*='settings'],[class*='Settings']"
    ));

    return candidates.filter(el => {
      try {
        if (!isVisibleEl(el)) return false;
        if (el.closest("#kathware-overlay-root,#kathware-overlay-panel,#kw-toast")) return false;
        const t = normalize(el.innerText || el.textContent || "");
        if (!t) return false;
        return /audio|sub|subt[ií]t|idioma|lengua|cc/i.test(t);
      } catch { return false; }
    });
  }

  function labelFlowMenu(menuEl) {
    if (!menuEl || S.flowMenusProcessed.has(menuEl)) return 0;
    S.flowMenusProcessed.add(menuEl);

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

    if (KWMP.CFG.debug && labeled) console.log("[KathWare] FlowMenu captured:", { labeledItems: labeled });
    return labeled;
  }

  function startFlowMenuObserver() {
    if (S.flowMenuObserver) return;
    S.flowMenuObserver = new MutationObserver(() => {
      if (!S.extensionActiva) return;
      if (KWMP.platforms.getPlatform() !== "flow") return;

      const menus = findFlowMenus();
      for (const m of menus) labelFlowMenu(m);
    });

    try { S.flowMenuObserver.observe(document.documentElement, { childList: true, subtree: true }); } catch {}
  }

  function stopFlowMenuObserver() {
    try { S.flowMenuObserver?.disconnect?.(); } catch {}
    S.flowMenuObserver = null;
  }

  // keep controls + call a11y labels on Flow
  function keepControlsTick() {
    if (!S.extensionActiva) return;
    const v = S.currentVideo || KWMP.video.getMainVideo();
    if (!v) return;

    const p = KWMP.platforms.getPlatform();
    const needs = (p === "flow" || p === "max" || p === "netflix");
    if (!needs) return;

    try {
      const r = v.getBoundingClientRect();
      const x = r.left + r.width * 0.5;
      const y = r.top + r.height * 0.90;
      v.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
      v.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));
    } catch {}

    if (p === "flow") labelFlowControls();
  }

  KWMP.flowA11y = {
    isVisibleEl,
    intersectsVideo,
    stableElKey,
    flowControlsSignature,
    guessIconOnlyLabel,
    applyA11yLabel,
    labelFlowControls,
    findFlowMenus,
    labelFlowMenu,
    startFlowMenuObserver,
    stopFlowMenuObserver,
    keepControlsTick
  };
})();

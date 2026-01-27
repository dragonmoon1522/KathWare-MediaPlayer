// ====================================================
// KathWare SubtitleReader - kwsr.keepAlive.js
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.keepAlive) return;

  const S = KWSR.state;

  function shouldRun() {
    if (!S.extensionActiva) return false;

    const p = KWSR.platforms?.getPlatform?.() || "generic";
    const caps = KWSR.platforms?.platformCapabilities?.(p) || {};
    return !!caps.keepAlive;
  }

  function fire(el, type, x, y) {
    try {
      if (!el) return;
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    } catch {}
  }

  function firePointer(el, type, x, y) {
    try {
      if (!el) return;
      // PointerEvent no existe en algunos contextos raros; si falla, no rompemos.
      const Ev = window.PointerEvent;
      if (!Ev) return;
      el.dispatchEvent(new Ev(type, { bubbles: true, clientX: x, clientY: y, pointerType: "mouse" }));
    } catch {}
  }

  function tick() {
    if (!shouldRun()) return;

    const v = S.currentVideo || KWSR.video?.getMainVideo?.();
    if (!v) return;

    try {
      const r = v.getBoundingClientRect();
      if (!r || r.width < 20 || r.height < 20) return;

      const x = r.left + r.width * 0.5;
      const y = r.top + r.height * 0.90;

      const parent = v.parentElement || null;

      // 1) video
      fire(v, "mousemove", x, y);
      fire(v, "mouseover", x, y);
      fire(v, "mouseenter", x, y);
      firePointer(v, "pointermove", x, y);

      // 2) parent container (muchas UIs escuchan arriba del video)
      fire(parent, "mousemove", x, y);
      fire(parent, "mouseover", x, y);
      fire(parent, "mouseenter", x, y);
      firePointer(parent, "pointermove", x, y);

      // 3) document (Netflix/Max suelen escuchar acá)
      fire(document, "mousemove", x, y);
      fire(document, "mouseover", x, y);
      firePointer(document, "pointermove", x, y);

      // 4) window (último recurso)
      fire(window, "mousemove", x, y);
      firePointer(window, "pointermove", x, y);
    } catch {
      // silencioso
    }
  }

  KWSR.keepAlive = { tick };
})();

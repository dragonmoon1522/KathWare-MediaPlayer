// ====================================================
// KathWare SubtitleReader - kwsr.keepAlive.js
// - Mantiene visibles los controles del reproductor en plataformas donde
//   se esconden automáticamente (streaming clásico).
// - Se activa solo si platformCapabilities().keepAlive === true
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

  function tick() {
    if (!shouldRun()) return;

    const v = S.currentVideo || KWSR.video?.getMainVideo?.();
    if (!v) return;

    try {
      const r = v.getBoundingClientRect();
      if (!r || r.width < 20 || r.height < 20) return;

      // Punto cerca del borde inferior-centro (donde suelen “despertar” controles)
      const x = r.left + r.width * 0.5;
      const y = r.top + r.height * 0.90;

      v.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
      v.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));
    } catch {}
  }

  KWSR.keepAlive = { tick };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Nuevo módulo “adapter”: extrae la lógica de mantener controles visibles fuera del viejo flowA11y.
  - Se ejecuta solo cuando la extensión está ON y la plataforma declara keepAlive=true vía platformCapabilities().
  - Usa el video principal (state o getter) y emite eventos mousemove/mouseover cerca del borde inferior
    para “revelar” controles en Netflix/Max/Disney/etc.
  */
})();

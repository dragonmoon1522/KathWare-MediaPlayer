// -----------------------------------------------------------------------------
// KathWare SubtitleReader - kwsr.keepAlive.js
// -----------------------------------------------------------------------------
//
// OBJETIVO
// --------
// Algunas plataformas esconden los controles del reproductor si no “detectan”
// movimiento del mouse (o actividad del puntero).
//
// Esto es un problema de accesibilidad porque:
// - si los controles desaparecen, el usuario pierde play/pause/seek rápido
// - y muchas veces la UI es la única forma de habilitar/cambiar subtítulos/audio
//
// ¿Qué hace este módulo?
// - Cada cierto tiempo (lo llama pipeline con un timer), simula actividad del mouse
//   cerca del video (y en contenedores comunes) para “mantener vivos” los controles.
//
// Importante:
// - Esto NO hace click.
// - Esto NO toca teclas.
// - Solo dispara eventos de movimiento/hover.
//
// Activación
// ----------
// Solo corre si:
// - la extensión está ON (S.extensionActiva)
// - la plataforma declara caps.keepAlive = true
//
// -----------------------------------------------------------------------------

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.keepAlive) return;

  const S = KWSR.state;

  // ---------------------------------------------------------------------------
  // Configs internas (seguras, no críticas)
  // ---------------------------------------------------------------------------

  // Evita spamear eventos si tick() se llama demasiado seguido.
  // (Si el timer es 650ms, un throttle de 300ms es suficiente.)
  const THROTTLE_MS = 300;
  let lastTickAt = 0;

  // Si querés que keepAlive NO corra cuando el video está pausado, poné true.
  // (En algunos sitios igual conviene que corra pausado, porque el menú de
  // audio/subs desaparece. Por eso lo dejo en false por defecto.)
  const SKIP_WHEN_PAUSED = false;

  // Coordenada vertical dentro del video:
  // - 0.90 (90%) suele ser donde aparecen controles
  // - si una plataforma se pone terca, podés probar 0.80 o 0.95
  const Y_RATIO = 0.90;

  // ---------------------------------------------------------------------------
  // shouldRun()
  // ---------------------------------------------------------------------------
  function shouldRun() {
    if (!S.extensionActiva) return false;

    const p = KWSR.platforms?.getPlatform?.() || "generic";
    const caps = KWSR.platforms?.platformCapabilities?.(p) || {};
    return !!caps.keepAlive;
  }

  // ---------------------------------------------------------------------------
  // Helpers de eventos
  // ---------------------------------------------------------------------------

  // fire(el, type, x, y)
  // - MouseEvent funciona casi siempre.
  function fire(el, type, x, y) {
    try {
      if (!el) return;
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    } catch {}
  }

  // firePointer(el, type, x, y)
  // - PointerEvent NO existe en todos lados.
  // - Cuando existe, ayuda en UIs modernas.
  function firePointer(el, type, x, y) {
    try {
      if (!el) return;
      const Ev = window.PointerEvent;
      if (!Ev) return;
      el.dispatchEvent(new Ev(type, { bubbles: true, clientX: x, clientY: y, pointerType: "mouse" }));
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // getTargets(video)
  // ---------------------------------------------------------------------------
  //
  // Devuelve una lista de elementos donde suele “escuchar” la UI:
  // - el video
  // - un contenedor cercano (muchas plataformas escuchan arriba del video)
  // - document/window como últimos recursos
  //
  function getTargets(v) {
    const targets = [];

    try {
      targets.push(v);

      const parent = v?.parentElement || null;
      if (parent) targets.push(parent);

      // Contenedor más “player-like” si existe
      // (no siempre aplica, pero suma en Disney/Max/Netflix según DOM)
      const wrapper =
        v?.closest?.("[class*='player'],[class*='Player'],[data-testid*='player'],[id*='player']") ||
        null;
      if (wrapper && wrapper !== parent) targets.push(wrapper);

      // document y window como fallback
      targets.push(document);
      targets.push(window);
    } catch {}

    // Filtramos null/undefined y duplicados
    return Array.from(new Set(targets.filter(Boolean)));
  }

  // ---------------------------------------------------------------------------
  // tick()
  // ---------------------------------------------------------------------------
  //
  // Lo llama pipeline en un intervalo.
  // Si no corresponde correr, sale sin hacer nada.
  //
  function tick() {
    if (!shouldRun()) return;

    const now = Date.now();
    if (now - lastTickAt < THROTTLE_MS) return;
    lastTickAt = now;

    const v = S.currentVideo || KWSR.video?.getMainVideo?.();
    if (!v) return;

    // Opción: no molestar si está pausado (configurable)
    if (SKIP_WHEN_PAUSED) {
      try {
        if (v.paused || v.ended) return;
      } catch {}
    }

    try {
      const r = v.getBoundingClientRect?.();
      if (!r || r.width < 20 || r.height < 20) return;

      // Coordenadas “cerca de controles”
      const x = r.left + r.width * 0.5;
      const y = r.top + r.height * Y_RATIO;

      const targets = getTargets(v);

      // En orden: eventos típicos de hover/move
      // Nota: NO hacemos click.
      for (const el of targets) {
        fire(el, "mousemove", x, y);
        fire(el, "mouseover", x, y);
        fire(el, "mouseenter", x, y);
        firePointer(el, "pointermove", x, y);
      }
    } catch {
      // silencioso: keepAlive nunca debe romper nada
    }
  }

  // Export
  KWSR.keepAlive = { tick };

})();
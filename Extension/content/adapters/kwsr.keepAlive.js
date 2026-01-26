// ====================================================
// KathWare SubtitleReader - kwsr.keepAlive.js
// ====================================================
//
// ¿Qué es "keepAlive" acá?
// - No tiene nada que ver con "mantener viva la extensión".
// - Es un "despertador" del reproductor: en muchas plataformas los controles
//   (play/pausa/tiempo/subs) se esconden si no hay movimiento de mouse.
// - Algunas personas (y lectores de pantalla) dependen de esos controles visibles.
//
// ¿Qué hace este módulo?
// - Cada cierto tiempo (timer en kwsr.pipeline.js) simula un movimiento de mouse
//   SOBRE el video para que la UI del reproductor vuelva a aparecer.
//
// ¿Cuándo corre?
// - Solo si la extensión está en ON (S.extensionActiva === true)
// - Solo si la plataforma lo declara en platformCapabilities().keepAlive === true
//
// Importante:
// - Esto NO lee subtítulos.
// - Esto NO toca tracks.
// - Solo emite eventos tipo mousemove/mouseover.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.keepAlive) return;

  const S = KWSR.state;

  // ----------------------------------------------------
  // shouldRun()
  // ----------------------------------------------------
  // Decide si este adapter debe correr en esta página.
  // ----------------------------------------------------
  function shouldRun() {
    if (!S.extensionActiva) return false;

    const p = KWSR.platforms?.getPlatform?.() || "generic";
    const caps = KWSR.platforms?.platformCapabilities?.(p) || {};
    return !!caps.keepAlive;
  }

  // ----------------------------------------------------
  // tick()
  // ----------------------------------------------------
  // Se llama en intervalos regulares (pipeline.adaptersTimer).
  // Simula actividad del mouse cerca del borde inferior-centro del video,
  // que suele ser donde se "despiertan" los controles.
  // ----------------------------------------------------
  function tick() {
    if (!shouldRun()) return;

    // Video principal detectado por el engine.
    const v = S.currentVideo || KWSR.video?.getMainVideo?.();
    if (!v) return;

    try {
      const r = v.getBoundingClientRect();
      if (!r || r.width < 20 || r.height < 20) return;

      // Punto "seguro": zona inferior-central.
      // (Si lo hacés en el centro, algunas plataformas interpretan clicks/pausa;
      //  por eso preferimos más abajo, tipo “zona de controles”.)
      const x = r.left + r.width * 0.5;
      const y = r.top + r.height * 0.90;

      // Emitimos eventos que muchas UIs usan para mostrar controles.
      v.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
      v.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));
    } catch {
      // Silencioso: si falla, no debe romper la lectura.
    }
  }

  // Exponemos el módulo
  KWSR.keepAlive = { tick };

  /*
  ===========================
  Notas de mantenimiento
  ===========================
  - Este adapter se ejecuta por timer, así que debe ser liviano.
  - No agregues querySelectorAll masivos acá.
  - Si alguna plataforma reacciona mal a mouseover/mousemove,
    se puede ajustar la capability por plataforma o cambiar el punto (x,y).
  */
})();

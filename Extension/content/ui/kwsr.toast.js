// ====================================================
// KathWare SubtitleReader - kwsr.toast.js
// ====================================================
//
// Qué es esto:
// - Un "toast" es un cartelito breve (visual) que aparece y desaparece,
//   para avisar cosas como "ON", "OFF", "falló la voz", etc.
//
// Qué hace este módulo:
// 1) Crea un toast visual (#kw-toast) cuando hace falta (lazy).
// 2) Crea una "live region" oculta para avisos accesibles (#kw-toast-live).
//    - Esto NO son subtítulos.
//    - Esto es feedback de la extensión (estado/errores).
//
// Importante:
// - No debe depender de funciones que puedan no existir.
// - No debe romper si la extensión está OFF.
// - Debe ser fácil de excluir del motor VISUAL (por id y por clase).
//
// Nota sobre "no leernos a nosotros mismos":
// - El toast tiene id #kw-toast y la live region #kw-toast-live.
// - En adapters ya se excluye #kw-toast.
// - En VISUAL conviene excluir también #kw-toast y #kw-toast-live.
//
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.toast) return;

  const S = KWSR.state;

  // ------------------------------------------------------------
  // 1) Crear / obtener el toast visual
  // ------------------------------------------------------------
  function ensureToastEl() {
    if (S.toastEl) return S.toastEl;

    const el = document.createElement("div");
    el.id = "kw-toast";

    // Accesibilidad básica del toast visual:
    // - role=status y aria-live=polite sirven, pero OJO:
    //   algunos lectores de pantalla pueden leerlo si está visible.
    // Por eso usamos además una live region OFFSCREEN separada.
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

    // Estilos inline para no depender de CSS externo
    Object.assign(el.style, {
      position: "fixed",
      top: "1rem",
      right: "1rem",
      background: "rgba(0,0,0,0.85)",
      color: "#fff",
      padding: "0.75rem 1rem",
      borderRadius: "10px",
      zIndex: "2147483647",
      fontSize: "14px",
      maxWidth: "70vw",
      boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
      pointerEvents: "none" // no molesta al mouse/teclado
    });

    document.documentElement.appendChild(el);
    S.toastEl = el;
    return el;
  }

  // ------------------------------------------------------------
  // 2) Crear / obtener live region oculta (para SR/braille)
  // ------------------------------------------------------------
  function ensureToastLiveRegion() {
    if (S.toastLiveRegion) return S.toastLiveRegion;

    const div = document.createElement("div");
    div.id = "kw-toast-live";

    // role=status + polite: anuncia sin interrumpir brutalmente
    div.setAttribute("role", "status");
    div.setAttribute("aria-live", "polite");
    div.setAttribute("aria-atomic", "true");

    // Offscreen real (no opacity:0)
    Object.assign(div.style, {
      position: "fixed",
      left: "-9999px",
      top: "0",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      clip: "rect(1px, 1px, 1px, 1px)",
      clipPath: "inset(50%)",
      whiteSpace: "nowrap"
    });

    document.documentElement.appendChild(div);
    S.toastLiveRegion = div;
    return div;
  }

  // Escribe en la live region de toast (anuncio accesible)
  function announce(msg) {
    const text = String(msg ?? "").trim();
    if (!text) return;

    try {
      const lr = ensureToastLiveRegion();

      // Truco para forzar anuncio: vaciar y luego setear
      lr.textContent = "";
      setTimeout(() => {
        if (!S.toastLiveRegion) return;
        S.toastLiveRegion.textContent = text;
      }, 10);
    } catch {}
  }

  // ------------------------------------------------------------
  // 3) API pública: notify + clear
  // ------------------------------------------------------------
  function notify(msg, opts = {}) {
    const text = String(msg ?? "").trim();
    if (!text) return;

    const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : 2000;
    const announceToSR = (typeof opts.announceToSR === "boolean") ? opts.announceToSR : true;
    const logToConsole = (typeof opts.logToConsole === "boolean") ? opts.logToConsole : true;

    // Log técnico (esto además puede ir al background si CFG.allowRemoteLogs está ON)
    if (logToConsole) {
      try { KWSR.log?.("toast", { msg: text }); } catch {}
    }

    // Aviso accesible (no depende del motor de voz/subtítulos)
    if (announceToSR) {
      announce(text);
    }

    // Toast visual
    try {
      const el = ensureToastEl();
      el.textContent = text;

      if (S.toastTimer) clearTimeout(S.toastTimer);
      S.toastTimer = setTimeout(() => {
        if (S.toastEl) S.toastEl.textContent = "";
      }, durationMs);
    } catch {}
  }

  // Limpia todo: timer + nodos DOM (visual y live region)
  function clear() {
    try {
      if (S.toastTimer) clearTimeout(S.toastTimer);
    } catch {}
    S.toastTimer = null;

    if (S.toastEl) {
      try { S.toastEl.remove(); } catch {}
      S.toastEl = null;
    }

    if (S.toastLiveRegion) {
      try { S.toastLiveRegion.remove(); } catch {}
      S.toastLiveRegion = null;
    }
  }

  KWSR.toast = { notify, clear };

  /*
  ===========================
  Cambios / decisiones
  ===========================
  - Se eliminó la dependencia de KWSR.voice.pushToLiveRegion (no existía).
  - Se creó una live region propia del toast (#kw-toast-live) para anuncios accesibles.
  - El toast visual (#kw-toast) usa pointerEvents:none para no estorbar.
  - notify() admite opciones (durationMs, announceToSR, logToConsole) sin complicar.
  - clear() elimina tanto toast visual como live region.
  */
})();

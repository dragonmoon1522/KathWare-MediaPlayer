// -----------------------------------------------------------------------------
// KathWare SubtitleReader - kwsr.toast.js
// -----------------------------------------------------------------------------
//
// Qué es esto:
// - Un "toast" es un cartelito breve (visual) que aparece y desaparece,
//   para avisar cosas como "ON", "OFF", "falló la voz", etc.
//
// Qué hace este módulo:
// 1) Crea un toast visual (#kw-toast) cuando hace falta (lazy).
// 2) Anuncia accesible (SR/braille) de forma independiente a subtítulos:
//
//    Preferencia:
//    - Si existe KWSR.voice.pushToLiveRegion(): lo usamos (UN solo live region global).
//
//    Fallback:
//    - Si voice aún no está disponible, creamos una live region propia (#kw-toast-live).
//
// Importante:
// - No debe romper si la extensión está OFF.
// - Debe ser fácil de excluir del motor VISUAL (por id).
// -----------------------------------------------------------------------------

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.toast) return;

  const S = KWSR.state;

  // -----------------------------------------------------------------------------
  // 1) Toast visual
  // -----------------------------------------------------------------------------
  function ensureToastEl() {
    if (S.toastEl) return S.toastEl;

    const el = document.createElement("div");
    el.id = "kw-toast";

    // Importante:
    // - Evitamos aria-live acá para NO provocar lecturas “dobles”
    //   (la parte accesible la manejamos por live region dedicada).
    el.setAttribute("role", "presentation");

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
      maxWidth: "min(520px, 70vw)",
      boxShadow: "0 10px 28px rgba(0,0,0,0.32)",
      pointerEvents: "none"
    });

    document.documentElement.appendChild(el);
    S.toastEl = el;
    return el;
  }

  // -----------------------------------------------------------------------------
  // 2) Live region fallback (solo si no existe KWSR.voice.pushToLiveRegion)
  // -----------------------------------------------------------------------------
  function ensureToastLiveRegion() {
    if (S.toastLiveRegion) return S.toastLiveRegion;

    const div = document.createElement("div");
    div.id = "kw-toast-live";
    div.setAttribute("role", "status");
    div.setAttribute("aria-live", "polite");
    div.setAttribute("aria-atomic", "true");

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

  function announce(msg) {
    const text = String(msg ?? "").trim();
    if (!text) return;

    // Preferencia: usar la live region global del motor voice
    // (así no creamos 2 live regions distintas).
    if (KWSR.voice?.pushToLiveRegion) {
      try { KWSR.voice.pushToLiveRegion(text); } catch {}
      return;
    }

    // Fallback: live region propia
    try {
      const lr = ensureToastLiveRegion();
      lr.textContent = "";
      setTimeout(() => {
        if (!S.toastLiveRegion) return;
        S.toastLiveRegion.textContent = text;
      }, 10);
    } catch {}
  }

  // -----------------------------------------------------------------------------
  // 3) API pública
  // -----------------------------------------------------------------------------
  function notify(msg, opts = {}) {
    const text = String(msg ?? "").trim();
    if (!text) return;

    const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : 2000;
    const announceToSR = (typeof opts.announceToSR === "boolean") ? opts.announceToSR : true;
    const logToConsole = (typeof opts.logToConsole === "boolean") ? opts.logToConsole : true;

    if (logToConsole) {
      try { KWSR.log?.("toast", { msg: text }); } catch {}
    }

    if (announceToSR) announce(text);

    try {
      const el = ensureToastEl();
      el.textContent = text;

      if (S.toastTimer) clearTimeout(S.toastTimer);
      S.toastTimer = setTimeout(() => {
        if (S.toastEl) S.toastEl.textContent = "";
      }, durationMs);
    } catch {}
  }

  function clear() {
    try { if (S.toastTimer) clearTimeout(S.toastTimer); } catch {}
    S.toastTimer = null;

    if (S.toastEl) {
      try { S.toastEl.remove(); } catch {}
      S.toastEl = null;
    }

    // Solo removemos el fallback live region si lo creamos nosotros
    if (S.toastLiveRegion) {
      try { S.toastLiveRegion.remove(); } catch {}
      S.toastLiveRegion = null;
    }
  }

  KWSR.toast = { notify, clear };

})();
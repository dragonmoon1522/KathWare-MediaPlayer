// ====================================================
// KathWare SubtitleReader - kwsr.toast.js
// - Toast visual + feedback accesible (live region)
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.toast) return;

  const S = KWSR.state;

  function ensureToastEl() {
    if (S.toastEl) return S.toastEl;

    const el = document.createElement("div");
    el.id = "kw-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

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
      boxShadow: "0 8px 30px rgba(0,0,0,0.35)"
    });

    document.documentElement.appendChild(el);
    S.toastEl = el;
    return el;
  }

  function notify(msg) {
    const text = String(msg ?? "");

    // Log (con remote logs si está habilitado)
    KWSR.log?.("toast", { msg: text });

    // Feedback accesible: si está ON, empujamos a live region también
    try {
      if (S.extensionActiva) KWSR.voice?.pushToLiveRegion?.(text);
    } catch {}

    // Toast visual
    try {
      const el = ensureToastEl();
      el.textContent = text;

      if (S.toastTimer) clearTimeout(S.toastTimer);
      S.toastTimer = setTimeout(() => {
        if (S.toastEl) S.toastEl.textContent = "";
      }, 2000);
    } catch {}
  }

  function clear() {
    try {
      if (S.toastTimer) clearTimeout(S.toastTimer);
    } catch {}
    S.toastTimer = null;

    if (S.toastEl) {
      try { S.toastEl.remove(); } catch {}
      S.toastEl = null;
    }
  }

  KWSR.toast = { notify, clear };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - FIX CRÍTICO: el archivo original cerraba el IIFE antes de definir clear() y antes de asignar KWMP.toast,
    lo que rompía por scope (S y KWMP quedaban fuera) y dejaba notify/clear inaccesibles.
  - Rebrand: KWMP -> KWSR.
  - Se encapsuló la creación del elemento en ensureToastEl() para evitar duplicación y estados raros.
  - notify() ahora siempre maneja msg seguro (String(msg ?? "")) y reporta por KWSR.log.
  - Accesibilidad: si la extensión está activa, el toast también se envía a live region vía KWSR.voice.pushToLiveRegion().
  - clear() limpia timer y elimina el nodo del DOM de forma segura.
  */
})();

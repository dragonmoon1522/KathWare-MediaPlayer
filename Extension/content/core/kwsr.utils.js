// ====================================================
// KathWare SubtitleReader - kwsr.utils.js
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.utils) return;

  KWSR.utils = {
    normalize(s) {
      return String(s ?? "")
        .replace(/\u00A0/g, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    },

    clamp(n, min, max) {
      return Math.min(max, Math.max(min, n));
    },

    isTyping() {
      const ae = document.activeElement;
      if (!ae) return false;
      const tag = (ae.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (ae.isContentEditable) return true;
      return false;
    }
  };

  /*
  ===========================
  Cambios aplicados (resumen)
  ===========================
  - Rebrand: KWMP -> KWSR.
  - Sin cambios funcionales: normalize/clamp/isTyping se mantienen igual.
  - normalize limpia NBSP, tags HTML y espacios múltiples (dedupe + lectura).
  */
})();

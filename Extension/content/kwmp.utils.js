(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.utils) return;

  KWMP.utils = {
    normalize(s) {
      return String(s ?? "")
        .replace(/\u00A0/g, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    },
    clamp(n, min, max) { return Math.min(max, Math.max(min, n)); },
    isTyping() {
      const ae = document.activeElement;
      if (!ae) return false;
      const tag = (ae.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (ae.isContentEditable) return true;
      return false;
    }
  };
})();

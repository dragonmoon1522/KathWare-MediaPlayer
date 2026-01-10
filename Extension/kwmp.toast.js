(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.toast) return;

  const S = KWMP.state;

  function notify(msg) {
    // Si está ON, empujamos a live region también (como en el monolito)
    try {
      if (S.extensionActiva) KWMP.voice?.pushToLiveRegion?.(msg);
    } catch {}

    try {
      if (!S.toastEl) {
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
      }

      S.toastEl.textContent = msg;

      if (S.toastTimer) clearTimeout(S.toastTimer);
      S.toastTimer = setTimeout(() => {
        if (S.toastEl) S.toastEl.textContent = "";
      }, 2000);
    } catch {}
  }

  KWMP.toast = { notify };
})();

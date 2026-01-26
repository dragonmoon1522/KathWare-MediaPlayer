// ====================================================
// KathWare SubtitleReader - kwsr.nonAccessible.platforms.js
// ====================================================
//
// ¿Para qué existe este archivo?
// - Hay plataformas donde el reproductor tiene botones “solo ícono”
//   (sin texto accesible) o menús de audio/subtítulos con items sin etiqueta.
// - Resultado: el lector de pantalla dice “botón” o “sin nombre”, y navegar es un infierno.
//
// ¿Qué hace este adapter?
// 1) Autolabeling cerca del video:
//    - Busca controles (botones/elementos clickeables) que estén VISIBLES
//      y físicamente cerca/sobre el área del video.
//    - Les agrega aria-label / role / tabindex si falta.
//    - Si el control ya trae aria-label real (del sitio), no lo pisa.
//      Solo pisa si era un autolabel nuestro anterior.
//
// 2) Menús de audio/subtítulos:
//    - Cuando aparece un menú con opciones de idioma/subtítulos,
//      lo detecta y etiqueta los ítems visibles.
//
// ¿Cuándo corre?
// - Solo si la extensión está ON.
// - Solo si la plataforma declara: platformCapabilities().nonAccessibleFixes === true
//
// Importante:
// - NO lee subtítulos.
// - NO toca el engine visual/track.
// - Evita tocar nuestro overlay/toast/live region con un filtro .closest().
//
// Nota de rendimiento:
// - Hacer querySelectorAll gigante cada 650ms puede ser caro.
//   Por eso: (a) gate por capabilities, (b) dedupe por "firma" (signature)
//   para no relabelar lo mismo una y otra vez.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.nonAccessiblePlatforms) return;

  const S = KWSR.state;

  // normalize: función utilitaria para limpiar espacios y evitar comparaciones raras.
  const normalize = KWSR.utils?.normalize || (s => String(s || "").trim());

  // ----------------------------------------------------
  // shouldRun()
  // ----------------------------------------------------
  // Decide si este adapter debe ejecutar acciones en este sitio.
  // ----------------------------------------------------
  function shouldRun() {
    if (!S.extensionActiva) return false;

    const p = KWSR.platforms?.getPlatform?.() || "generic";
    const caps = KWSR.platforms?.platformCapabilities?.(p) || {};
    return !!caps.nonAccessibleFixes;
  }

  // ----------------------------------------------------
  // isVisibleEl(el)
  // ----------------------------------------------------
  // Filtra elementos invisibles, demasiado chicos o no interactuables.
  // Esto reduce falsos positivos y evita etiquetar cosas irrelevantes.
  // ----------------------------------------------------
  function isVisibleEl(el) {
    if (!el || !el.getBoundingClientRect) return false;

    const r = el.getBoundingClientRect();
    if (r.width < 14 || r.height < 14) return false;

    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (Number(cs.opacity || 1) < 0.05) return false;
    if (cs.pointerEvents === "none") return false;

    return true;
  }

  // ----------------------------------------------------
  // intersectsVideo(el, vr)
  // ----------------------------------------------------
  // Comprueba si el elemento se superpone con el rectángulo del video.
  // Usamos área de intersección para evitar “está cerca pero no encima”.
  // ----------------------------------------------------
  function intersectsVideo(el, vr) {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(vr.right, r.right) - Math.max(vr.left, r.left));
    const y = Math.max(0, Math.min(vr.bottom, r.bottom) - Math.max(vr.top, r.top));
    return (x * y) > 120; // umbral: evita micro solapes irrelevantes
  }

  // ----------------------------------------------------
  // stableElKey(el)
  // ----------------------------------------------------
  // Genera una “huella” del elemento para construir una firma del set de controles.
  // No es una ID única perfecta, pero es suficiente para detectar “no cambió nada”.
  // ----------------------------------------------------
  function stableElKey(el) {
    const tag = (el.tagName || "").toLowerCase();
    const tid = el.getAttribute("data-testid") || "";
    const role = el.getAttribute("role") || "";
    const aria = el.getAttribute("aria-label") || "";
    const cls = String(el.className || "").slice(0, 80);
    return `${tag}|${tid}|${role}|${aria}|${cls}`;
  }

  // ----------------------------------------------------
  // controlsSignature(els)
  // ----------------------------------------------------
  // Firma del conjunto de controles visibles cerca del video.
  // Si la firma no cambió desde la última vez, no relabelamos.
  // ----------------------------------------------------
  function controlsSignature(els) {
    try {
      const parts = els.slice(0, 120).map(stableElKey);
      return `${els.length}::${parts.join("§")}`;
    } catch {
      return String(els.length);
    }
  }

  // ----------------------------------------------------
  // guessIconOnlyLabel(testId, cls)
  // ----------------------------------------------------
  // Fallback para botones sin texto (solo ícono).
  // Intentamos inferir por data-testid o className.
  // ----------------------------------------------------
  function guessIconOnlyLabel(testId, cls) {
    const blob = normalize(`${testId} ${cls}`).toLowerCase();

    if (testId === "volume-btn" || blob.includes("volume") || blob.includes("mute")) return "Volumen / Silenciar";
    if (testId === "cast-btn" || blob.includes("cast") || blob.includes("chromecast")) return "Transmitir (Cast)";
    if (testId === "full-screen-btn" || blob.includes("full") || blob.includes("screen")) return "Pantalla completa";
    if (testId === "audio-subtitle-btn" || blob.includes("subtitle") || blob.includes("audio")) return "Audio y subtítulos";
    if (testId === "more-emissions-btn" || blob.includes("emission") || blob.includes("episod")) return "Ir a episodios";
    if (testId === "back-btn" || blob.includes("back") || blob.includes("volver")) return "Volver";

    // Fallbacks típicos
    if (blob.includes("play")) return "Reproducir";
    if (blob.includes("pause")) return "Pausar";
    if (blob.includes("rewind") || blob.includes("backward")) return "Retroceder";
    if (blob.includes("forward") || blob.includes("next")) return "Adelantar";
    if (blob.includes("settings")) return "Configuración";

    return "Control del reproductor";
  }

  // ----------------------------------------------------
  // applyA11yLabel(el, label)
  // ----------------------------------------------------
  // Aplica aria-label + role + tabindex de manera “segura”:
  // - Si ya tiene aria-label real, no lo pisa.
  // - Si el aria-label era autogenerado por nosotros, sí lo actualiza.
  // - Marca el label autogenerado con data-kw-autolabel="1".
  // ----------------------------------------------------
  function applyA11yLabel(el, label) {
    if (!el) return 0;

    const t = normalize(label);
    if (!t) return 0;

    const prev = el.getAttribute("aria-label") || "";
    const prevAuto = el.getAttribute("data-kw-autolabel") === "1";

    // Solo seteamos si:
    // - No hay aria-label, o
    // - Es uno nuestro anterior y cambió el texto
    const shouldSet = (!prev) || (prevAuto && prev !== t);

    if (shouldSet) {
      el.setAttribute("aria-label", t);
      el.setAttribute("data-kw-autolabel", "1");
    }

    // Aseguramos que sea navegable por teclado y reconocido como botón
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (!el.getAttribute("role")) el.setAttribute("role", "button");

    return shouldSet ? 1 : 0;
  }

  // ----------------------------------------------------
  // labelControlsNearVideo()
  // ----------------------------------------------------
  // Busca controles visibles cerca del video y los etiqueta.
  //
  // (Clave) Evita tocar nuestra UI:
  // - overlay root/panel
  // - toast
  // - live region
  // ----------------------------------------------------
  function labelControlsNearVideo() {
    if (!shouldRun()) return 0;

    const v = S.currentVideo || KWSR.video?.getMainVideo?.();
    if (!v) return 0;

    let vr;
    try { vr = v.getBoundingClientRect(); } catch { return 0; }
    if (!vr || vr.width < 20 || vr.height < 20) return 0;

    // Candidatos: cosas “clickeables” comunes.
    // Ojo: [tabindex] agarra mucho, pero luego filtramos por visibilidad + intersección.
    const candidates = Array.from(
      document.querySelectorAll("button,[role='button'],[tabindex],[data-testid]")
    );

    const all = candidates.filter(el =>
      el &&
      el.getBoundingClientRect &&
      isVisibleEl(el) &&
      intersectsVideo(el, vr) &&
      // NO tocar elementos propios:
      !el.closest("#kathware-overlay-root,#kathware-overlay-panel,#kw-toast,#kathware-live-region")
    );

    // Firma para no relabelar siempre lo mismo
    const sig = controlsSignature(all);
    if (sig === S.lastNonAccControlsSig) return 0;
    S.lastNonAccControlsSig = sig;

    let labeled = 0;

    for (const el of all) {
      // Preferimos texto visible del botón.
      const txt = normalize(el.innerText || el.textContent || "");

      // Si no hay texto, inferimos por data-testid / className.
      const testId = el.getAttribute("data-testid") || "";
      const cls = String(el.className || "");
      const label = txt || guessIconOnlyLabel(testId, cls);

      labeled += applyA11yLabel(el, label);
    }

    // Debug suave: solo loguea si cambió la cantidad etiquetada
    if (KWSR.CFG?.debug && labeled !== S.lastNonAccLabeledCount) {
      console.log("[KathWare] nonAccessible fix:", { mode: "dynamic-label", labeled, changed: true });
    }
    S.lastNonAccLabeledCount = labeled;

    return labeled;
  }

  // ----------------------------------------------------
  // findA11yMenus()
  // ----------------------------------------------------
  // Busca menús visibles que parezcan de "Audio y subtítulos".
  // ----------------------------------------------------
  function findA11yMenus() {
    const candidates = Array.from(document.querySelectorAll(
      "[role='menu'],[role='dialog'],[role='listbox'],[class*='menu'],[class*='Menu'],[class*='settings'],[class*='Settings']"
    ));

    return candidates.filter(el => {
      try {
        if (!isVisibleEl(el)) return false;
        if (el.closest("#kathware-overlay-root,#kathware-overlay-panel,#kw-toast,#kathware-live-region")) return false;

        const t = normalize(el.innerText || el.textContent || "");
        if (!t) return false;

        // Palabras clave típicas
        return /audio|sub|subt[ií]t|idioma|lengua|cc|captions/i.test(t);
      } catch {
        return false;
      }
    });
  }

  // ----------------------------------------------------
  // labelMenu(menuEl)
  // ----------------------------------------------------
  // Etiqueta items del menú (idiomas/subtítulos) para que sean navegables.
  // Usa WeakSet para no reprocesar el MISMO nodo menú.
  // ----------------------------------------------------
  function labelMenu(menuEl) {
    if (!menuEl) return 0;

    // WeakSet: memoria segura (si el menú desaparece, el GC lo limpia)
    if (!S.nonAccMenusProcessed) S.nonAccMenusProcessed = new WeakSet();
    if (S.nonAccMenusProcessed.has(menuEl)) return 0;
    S.nonAccMenusProcessed.add(menuEl);

    // Aseguramos semántica mínima
    if (!menuEl.getAttribute("role")) menuEl.setAttribute("role", "dialog");
    if (!menuEl.getAttribute("aria-label")) menuEl.setAttribute("aria-label", "Audio y subtítulos");

    // Ítems típicos dentro del menú
    const items = Array.from(
      menuEl.querySelectorAll("button,[role='menuitem'],[role='option'],li,[tabindex]")
    ).filter(isVisibleEl);

    let labeled = 0;
    for (const it of items) {
      const txt = normalize(it.innerText || it.textContent || "");
      if (!txt) continue;
      labeled += applyA11yLabel(it, txt);
    }

    if (KWSR.CFG?.debug && labeled) console.log("[KathWare] nonAccessible menu:", { labeledItems: labeled });
    return labeled;
  }

  // ----------------------------------------------------
  // startMenuObserver()
  // ----------------------------------------------------
  // Observa el DOM y cuando aparecen menús nuevos, intenta etiquetarlos.
  // Solo se arranca si caps.nonAccessibleFixes es true (pipeline lo decide).
  // ----------------------------------------------------
  function startMenuObserver() {
    if (S.nonAccMenuObserver) return;

    S.nonAccMenuObserver = new MutationObserver(() => {
      if (!shouldRun()) return;
      const menus = findA11yMenus();
      for (const m of menus) labelMenu(m);
    });

    try {
      S.nonAccMenuObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      // Silencioso: no es crítico para la lectura de subtítulos.
    }
  }

  function stopMenuObserver() {
    try { S.nonAccMenuObserver?.disconnect?.(); } catch {}
    S.nonAccMenuObserver = null;
  }

  // ----------------------------------------------------
  // tick()
  // ----------------------------------------------------
  // Llamado por el timer de adapters en el pipeline.
  // ----------------------------------------------------
  function tick() {
    if (!shouldRun()) return;

    // 1) Etiquetar controles cerca del video
    labelControlsNearVideo();

    // 2) Menús se manejan por observer (no por tick) para no scannear tanto
  }

  // Exponemos API del módulo (útil para debug y tests)
  KWSR.nonAccessiblePlatforms = {
    shouldRun,
    isVisibleEl,
    intersectsVideo,
    stableElKey,
    controlsSignature,
    guessIconOnlyLabel,
    applyA11yLabel,
    labelControlsNearVideo,

    findA11yMenus,
    labelMenu,
    startMenuObserver,
    stopMenuObserver,

    tick
  };

  /*
  ===========================
  Notas de mantenimiento
  ===========================
  - Este archivo modifica el DOM de terceros (aria-label/role/tabindex).
    Hay que ser conservadores para no romper UI ni accesibilidad nativa.
  - La regla más importante: NO tocar nuestros nodos (overlay/toast/live region).
  - Si alguna plataforma se vuelve “lenta”, el culpable suele ser querySelectorAll
    demasiado frecuente. En ese caso:
      - subir CFG.adaptersMs
      - reducir candidatos del querySelectorAll
      - o agregar gating extra por plataforma
  */
})();

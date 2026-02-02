// ----------------------------------------------------
// KathWare SubtitleReader - kwsr.utils.js
// ----------------------------------------------------
//
// QUÉ ES ESTE ARCHIVO
// -------------------
// Un “cajón de herramientas” chico y sin drama.
// Tiene utilidades simples que se usan en varios módulos.
//
// POR QUÉ EXISTE
// --------------
// Porque hay tareas repetidas en toda la extensión, por ejemplo:
// - normalizar texto (espacios raros, saltos de línea, etc.)
// - limitar números a un rango (volumen, índice de track, seek)
// - detectar si el usuario está escribiendo (para no robar teclas)
//
// REGLA DE ORO
// ------------
// - Helpers chiquitos.
// - Sin dependencias de plataforma.
// - Sin efectos colaterales raros.
// ----------------------------------------------------

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.utils) return;

  KWSR.utils = {
    // ------------------------------------------------
    // normalize(text)
    // ------------------------------------------------
    // Limpia texto para:
    // - lectura en voz
    // - comparación/dedupe
    //
    // Qué hace:
    // - NBSP -> espacio normal
    // - elimina “tags” si se colaron como texto (raro, pero pasa)
    // - colapsa espacios / tabs / saltos de línea
    // - trim (quita espacios al inicio y al final)
    //
    // Qué NO hace:
    // - no traduce
    // - no corrige gramática
    // - no divide frases
    // ------------------------------------------------
    normalize(s) {
      return String(s ?? "")
        .replace(/\u00A0/g, " ")    // NBSP -> espacio normal
        .replace(/<[^>]+>/g, "")   // si aparecen tags como texto, los saca
        .replace(/\s+/g, " ")      // colapsa whitespace múltiple
        .trim();
    },

    // ------------------------------------------------
    // clamp(n, min, max)
    // ------------------------------------------------
    // “Encierra” un número dentro de un rango:
    // - clamp(2, 0, 1) => 1
    // - clamp(-1, 0, 1) => 0
    //
    // Se usa para:
    // - volumen (0..1)
    // - índices (0..N-1)
    // - tiempos (0..duración)
    //
    // Nota:
    // - Si n no es un número (NaN), usamos min como fallback seguro.
    // ------------------------------------------------
    clamp(n, min, max) {
      const nn = Number(n);
      if (!Number.isFinite(nn)) return min;
      return Math.min(max, Math.max(min, nn));
    },

    // ------------------------------------------------
    // isTyping()
    // ------------------------------------------------
    // Devuelve true si el foco está en algo “editable”,
    // o sea, donde el usuario podría estar escribiendo.
    //
    // Importante:
    // - Si el usuario está escribiendo, NO interceptamos hotkeys.
    //
    // Detecta:
    // - input / textarea / select
    // - contenteditable (divs editables tipo chats)
    // ------------------------------------------------
    isTyping() {
      const ae = document.activeElement;
      if (!ae) return false;

      const tag = (ae.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (ae.isContentEditable) return true;

      return false;
    }
  };

  // ------------------------------------------------
  // Nota de mantenimiento
  // ------------------------------------------------
  // Este módulo:
  // - NO depende de plataforma
  // - debería ser puro (sin tocar DOM “grande” ni crear timers)
  //
  // Si agregás helpers nuevos:
  // - que sean chiquitos
  // - que sean previsibles
  // - que no sorprendan (sin side-effects)
  // ------------------------------------------------
})();
// ====================================================
// KathWare SubtitleReader - kwsr.utils.js
// ====================================================
//
// Este archivo tiene utilidades chiquitas que se usan en toda la extensión.
// La idea es: “funciones simples, sin depender de plataforma”.
//
// ¿Por qué existe?
// Porque hay tareas que repetimos en varios módulos:
// - Limpiar textos (subtítulos del DOM pueden venir con espacios raros o tags)
// - Limitar números (volumen, índice de track, seek)
// - Saber si el usuario está escribiendo (para no robarle teclas al navegador)
//
// Nota: no es “magia del lenguaje”; TODO esto lo escribimos nosotros.
// ====================================================

(() => {
  const KWSR = window.KWSR;
  if (!KWSR || KWSR.utils) return;

  KWSR.utils = {
    // ------------------------------------------------------------
    // normalize(text):
    // Limpia un texto para lectura/comparación.
    //
    // Qué hace:
    // - Convierte NBSP (espacio raro) a espacio normal
    // - Elimina tags HTML si vinieran incrustados en textContent (a veces pasa)
    // - Reduce espacios múltiples a uno
    // - Trim (saca espacios al inicio/final)
    //
    // Qué NO hace:
    // - NO traduce idiomas
    // - NO “corrige gramática”
    // - NO segmenta frases (eso es otra lógica)
    // ------------------------------------------------------------
    normalize(s) {
      return String(s ?? "")
        .replace(/\u00A0/g, " ")   // NBSP -> espacio normal
        .replace(/<[^>]+>/g, "")  // borra tags tipo <i>...</i> si aparecen
        .replace(/\s+/g, " ")     // colapsa espacios/tab/nuevas líneas
        .trim();
    },

    // ------------------------------------------------------------
    // clamp(n, min, max):
    // “Encierra” un número dentro de un rango.
    // Ejemplo: clamp(2, 0, 1) => 1
    // Se usa para:
    // - volumen (0..1)
    // - índices (0..N-1)
    // - currentTime del video (0..duración)
    // ------------------------------------------------------------
    clamp(n, min, max) {
      return Math.min(max, Math.max(min, n));
    },

    // ------------------------------------------------------------
    // isTyping():
    // Devuelve true si el foco está en un campo donde el usuario escribe.
    // Importante para hotkeys: si está escribiendo, NO interceptamos teclas.
    //
    // Detecta:
    // - input, textarea, select
    // - contenteditable (divs editables tipo chats)
    // ------------------------------------------------------------
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
  Nota de mantenimiento
  ===========================
  - Este módulo NO depende de plataforma.
  - Si necesitás agregar helpers nuevos, la regla es:
      * que sean chiquitos
      * que no toquen DOM “grande”
      * que no tengan side effects raros
  */
})();

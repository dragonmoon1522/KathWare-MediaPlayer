## Historial de Versiones KathWare SubtitleReader

**Última actualización:** 2026-01-26
✍ **Autora:** Katherine Vargas [(KathWare)](https://kathware.com.ar)

---

### **Versión 2.0.0 — en desarrollo (pre-lanzamiento)**

> ⚠️ Versión en consolidación previa al lanzamiento público.

#### Cambios conceptuales y de arquitectura

* Cambio de nombre del proyecto a **KathWare SubtitleReader**, reflejando su objetivo principal:
  lectura accesible de subtítulos, no reemplazo del reproductor.
* Separación clara de responsabilidades por módulos (`pipeline`, `track`, `visual`, `voice`, `overlay`, `adapters`).
* Activación **lazy** de la interfaz:
  el overlay y el panel **solo se crean cuando el usuario activa la extensión**.
* Eliminación de cualquier lógica que **fuerce idioma o comportamiento del lector de pantalla**.
  El idioma y la voz dependen exclusivamente de la configuración del usuario.
* Unificación de atajos de teclado sin uso de `Ctrl`, para evitar conflictos:

  * `Alt + Shift + K` → Activar / desactivar extensión
  * `Alt + Shift + L` → Rotar modo de lectura (lector → voz → desactivado)
  * `Alt + Shift + O` → Abrir / cerrar panel accesible

#### Lectura de subtítulos

* Detección automática de la **mejor fuente de subtítulos disponible**:

  * **TRACK** cuando existen pistas reales (`textTracks`) con cues utilizables.
  * **VISUAL** cuando los subtítulos solo están renderizados en el DOM.
* Eliminación de selectores manuales irrelevantes cuando solo existe una fuente válida.
* El selector de pistas de subtítulos solo se muestra cuando **existen múltiples pistas reales** (por ejemplo, subtítulos vs CC).
* La extensión **no reimprime subtítulos en pantalla**:
  utiliza únicamente el contenido ya visible o disponible para la lectura.

#### Accesibilidad y compatibilidad

* Adaptaciones automáticas para plataformas con interfaces poco accesibles:

  * etiquetado dinámico de botones sin texto,
  * menús de audio y subtítulos accesibles al abrirse.
* Mantenimiento de controles visibles en reproductores que los ocultan automáticamente.
* Controles del reproductor accesibles por teclado desde el panel cuando es necesario.

#### Logs y diagnóstico

* Sistema de logs técnicos internos para depuración.
* Envío de logs **solo bajo decisión explícita del usuario** al reportar un error.
* Mejora de mensajes y reportes para facilitar reproducción de bugs reales.

#### ⚠️ Problema conocido (crítico)

* En algunas plataformas (Netflix, Max, Flow y similares) se detectan **lecturas duplicadas o múltiples del mismo subtítulo**.
* El bug está identificado en la interacción entre:

  * detección visual,
  * polling,
  * y eventos de actualización del DOM.
* **Este problema bloquea el lanzamiento público** hasta su resolución completa.

---

### **Versión 2.0.0 beta — 2025-11-09**

* Unificación de ramas previas en una arquitectura común para la extensión.
* Detección automática de reproductores HTML5 y reproductores no accesibles.
* Integración inicial de:

  * lectura por lector de pantalla,
  * lectura por sintetizador de voz.
* Selector manual de fuente de subtítulos (TRACK / VISUAL).
* Selector de pistas cuando existen múltiples `textTracks`.
* Sincronización de preferencias mediante `chrome.storage.local`.
* Refactorización inicial de logs y mensajes de consola.
* Atajo `Ctrl + Shift + K` para activar/desactivar la extensión.
* Base técnica preparada para futuras funciones de transcripción.

---

### **Versión 1.0.0-beta — 2025-07-08**

* Lectura funcional de subtítulos TRACK y visuales.
* Selector de modo de lectura: sintetizador o lector de pantalla (`aria-live`).
* Controles accesibles por teclado (reproducir, pausar, volumen, saltos).
* Panel flotante accesible desde `popup.html`.
* Guardado local de errores y sistema de envío voluntario.
* Detección automática de reproductores no accesibles.
* Integración inicial con plataformas como Flow, Max y Disney+.
* Incorporación de la **Licencia de Accesibilidad Universal (LAU)**.

---

**Licencia:**
Este contenido está licenciado bajo **Licencia de Accesibilidad Universal (LAU)** y **Creative Commons BY-NC-SA 4.0**.
Más información en:
[Normas de Uso y Licencias de KathWare](https://kathware.com.ar/normas-de-uso-y-licencias-de-kathware/)
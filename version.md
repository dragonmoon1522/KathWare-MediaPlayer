## Historial de Versiones KathWare SubtitleReader

**Última actualización:** 2026-01-26  
✍ **Autora:** Katherine Vargas [(KathWare)](https://kathware.com.ar)

---

### **Versión 2.0.0 — en desarrollo (pre-lanzamiento)**

> ⚠️ Versión en consolidación previa al lanzamiento público.

#### Cambios conceptuales y de arquitectura

* Cambio de nombre del proyecto a **KathWare SubtitleReader**, reflejando su objetivo real:
  lectura accesible de subtítulos, **no** reemplazo del reproductor.
* Reescritura del núcleo con **separación estricta de responsabilidades**:
  `bootstrap`, `pipeline`, `track`, `visual`, `voice`, `overlay`, `toast`, `adapters`.
* Arranque seguro mediante `kwsr.bootstrap.js`:
  * creación de un único namespace global (`window.KWSR`),
  * guarda crítica contra doble carga del content script.
* Activación **lazy** de la interfaz:
  * el overlay y el panel **solo existen cuando la extensión está activa**,
  * no se inyecta UI innecesaria en páginas inactivas.
* Eliminación total de lógica que **fuerce idioma, voz o comportamiento** del lector de pantalla.
  El idioma y la voz dependen exclusivamente de la configuración del usuario.
* Unificación y normalización de atajos de teclado, evitando `Ctrl` para reducir conflictos:

  * `Alt + Shift + K` → Activar / desactivar la extensión
  * `Alt + Shift + L` → Rotar modo de lectura (lector → voz → desactivado)
  * `Alt + Shift + O` → Abrir / cerrar panel accesible

#### Lectura de subtítulos

* Detección automática de la **mejor fuente de subtítulos disponible**:
  * **TRACK** cuando existen pistas reales (`textTracks`) con cues utilizables.
  * **VISUAL** cuando los subtítulos solo están renderizados en el DOM.
* Eliminación de selectores manuales irrelevantes:
  el usuario **no elige TRACK/VISUAL**, el pipeline decide dinámicamente.
* Reescritura completa del motor VISUAL:
  * lectura por **snapshot del contenedor** en Netflix y Max,
  * independencia del layout interno (spans, `<br>`, re-render).
* Implementación de deduplicación robusta:
  * fingerprints estrictos y laxos,
  * compuerta por tiempo de video para detectar re-render,
  * ventanas temporales anti-eco.
* Implementación de **lectura por delta** en subtítulos progresivos
  (rolling captions en Max / Netflix):
  * solo se vocaliza el texto nuevo agregado.
* La extensión **no reimprime subtítulos en pantalla**:
  utiliza únicamente el contenido ya visible o disponible para la lectura.

#### Accesibilidad y compatibilidad

* Adaptaciones automáticas para plataformas con interfaces poco accesibles:
  * etiquetado dinámico de botones sin texto (`aria-label`, `role`, `tabindex`),
  * detección y etiquetado de menús de audio y subtítulos.
* Corrección de reproductores que ocultan controles por inactividad:
  * módulo `keepAlive` que mantiene la UI visible sin interferir con el usuario.
* Panel accesible minimalista:
  * muestra estado real (ON/OFF, modo, motor efectivo),
  * permite solo acciones seguras (modo de lectura, controles del reproductor).
* Controles del reproductor accesibles por teclado:
  * reproducir / pausar,
  * avanzar / retroceder,
  * volumen,
  * pantalla completa (con advertencia de posibles limitaciones).

#### Voz, lector y estabilidad

* Sistema híbrido:
  * **lector de pantalla** mediante una única *live region* global,
  * **sintetizador de voz** opcional (Web Speech API).
* Watchdog de TTS:
  * detección de bloqueos del sintetizador,
  * cancelación automática y fallback a modo lector.
* Cambio automático a modo lector si el TTS falla,
  sin interrumpir la experiencia del usuario.

#### Logs y diagnóstico

* Sistema interno de logs técnicos desacoplado del flujo principal.
* Persistencia local en `storage.local` con límite de tamaño.
* Envío de logs **solo bajo decisión explícita del usuario** al reportar un error.
* Integración directa con GitHub Issues desde el popup accesible.

#### Estado actual

* El bug crítico de **lecturas duplicadas** en Netflix y Max
  fue **identificado, aislado y corregido** mediante:
  * snapshot de contenedor,
  * dedupe por texto + tiempo de video,
  * gating por re-render.
* La versión se encuentra en **fase final de validación cruzada**
  antes del lanzamiento público.

---

### **Versión 2.0.0 beta — 2025-11-09**

* Unificación de ramas previas en una arquitectura común.
* Detección automática de reproductores HTML5 y no accesibles.
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
Este contenido está licenciado bajo **Licencia de Accesibilidad Universal (LAU)**  
y **Creative Commons BY-NC-SA 4.0**.

Más información en:  
[Normas de Uso y Licencias de KathWare](https://kathware.com.ar/normas-de-uso-y-licencias-de-kathware/)
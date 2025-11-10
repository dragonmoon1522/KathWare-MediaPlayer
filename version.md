## Historial de Versiones KathWare Media Player  

**Última actualización:** 2025-11-09  
✍**Autora:** Katherine Vargas [(KathWare)](https://kathware.com.ar)  

---

### **Versión 2.0.0 betta — 2025-11-09**  

- Se unificaron las distintas ramas del proyecto en un único `content.js` híbrido para la extensión de Chrome.  
- Detección automática del tipo de reproductor:  
  - **Accesibles (HTML5):** Netflix, YouTube, Disney+, Prime Video, Paramount+, Max y otros que exponen `textTracks` o captions en el DOM.  
  - **No accesibles (DRM / blob sin controles):** Flow y reproductores similares.  
- Activación de **modo lector** en reproductores HTML5 accesibles y de **overlay accesible KathWare** solo cuando el reproductor no presenta controles accesibles.  
- Integración completa con `popup.html`, permitiendo configurar:  
  - Modo de lectura: desactivado, voz del sistema (sintetizador) o lector de pantalla (`aria-live`).  
  - Fuente de subtítulos: pista TRACK o subtítulos visuales (CC rendereados en el DOM).  
  - Pista de subtítulos activa cuando la página expone múltiples `textTracks`.  
- Sincronización de preferencias mediante `chrome.storage.local` y actualización en vivo vía mensaje `updateSettings`.  
- Mejora de la lectura en español con `speechSynthesis`, evitando repeticiones y limpiando etiquetas HTML de los subtítulos.  
- Modo visual *fallback* para intentar leer subtítulos visibles en el DOM cuando no existe pista de subtítulos accesible.  
- Mantenimiento del atajo global `Ctrl + Shift + K` para activar/desactivar narrador u overlay en la pestaña actual.  
- Refactorización de logs y mensajes de consola para facilitar la depuración.  
- Base técnica preparada para futuras funciones de extracción de transcripciones y traducción simultánea de subtítulos.  

---

### **Versión 1.0.0-beta — 2025-07-08**  

- Lectura funcional de subtítulos TRACK y visuales.  
- Selector de voz: sintetizador o lector de pantalla (`aria-live`).  
- Controles accesibles por teclado (reproducir, pausar, volumen, saltos).  
- Panel flotante accesible en `popup.html`.  
- Guardado de errores locales en `store.db`.  
- Sistema de envío voluntario de errores.  
- Atajo `Ctrl + Shift + K` para activar/desactivar narrador.  
- Detección automática de reproductores no accesibles.  
- Eliminación de emojis para mejorar la experiencia con lectores de pantalla.  
- Integración base con plataformas como Flow, Max, Disney+, etc.  
- Licencia LAU incorporada.  

---

**Licencia:**  
Este contenido está licenciado bajo **Licencia de Accesibilidad Universal (LAU)** y **Creative Commons BY-NC-SA 4.0**.  
Más información en: [Normas de Uso y Licencias de KathWare](https://kathware.com.ar/normas-de-uso-y-licencias-de-kathware/)

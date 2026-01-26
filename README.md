## **KathWare SubtitleReader**

**Autora:** Katherine Vargas | [(KathWare)](https://kathware.com.ar)
**Última actualización:** 2026-01-26

---

### **Descripción del Proyecto**

**KathWare SubtitleReader** es una extensión accesible para navegador que permite la **lectura automática de subtítulos** en plataformas de video, incluso cuando el reproductor **no ofrece accesibilidad nativa** o presenta barreras para lectores de pantalla (como ocurre en Netflix, Max, Flow y plataformas similares).

Forma parte del ecosistema **KathWare** y se desarrolla como proyecto independiente dentro del entorno GitHub de `dragonmoon1522`.

El objetivo principal de la extensión es **garantizar acceso al contenido audiovisual**, respetando siempre la configuración del usuario y **sin imponer idioma, voz ni comportamiento al lector de pantalla o sintetizador**.

Incluye:

* Activación y control completos desde teclado.
* Lectura automática de subtítulos mediante lector de pantalla o sintetizador del sistema.
* Detección inteligente de subtítulos visibles cuando no existen pistas accesibles.
* Adaptaciones automáticas para reproductores con interfaces poco accesibles.
* Herramientas de diagnóstico y compatibilidad para pruebas de accesibilidad.

---

### Tecnologías utilizadas

* HTML, CSS y JavaScript puro.
* Web Speech API (SpeechSynthesis), opcional y controlada por el usuario.
* Lectura accesible mediante *live regions* (no se fuerza idioma).
* Almacenamiento local del navegador (`storage.local`).
* Detección dinámica de:

  * elementos `<video>`,
  * pistas de subtítulos (`textTracks`),
  * subtítulos renderizados visualmente en el DOM.

---

### Licencias y manifiestos

* 🛡 [Licencia de Accesibilidad Universal (LAU) — Español](https://kathware.com.ar/lau/)
* [Creative Commons BY-NC-SA 4.0](https://kathware.com.ar/normas-de-uso-y-licencias-de-kathware/)

> Todos los proyectos del ecosistema KathWare están protegidos por la LAU y por licencias libres no comerciales.

---

### Funcionalidades principales

* **Activación por atajo universal:** `Alt + Shift + K`.
* **Panel accesible opcional**, disponible solo cuando la extensión está activa.
* Lectura automática de subtítulos:

  * mediante lector de pantalla (modo *lector*), o
  * mediante sintetizador de voz del sistema (modo *voz*).
* Cambio rápido de modo de lectura desde teclado:

  * `Alt + Shift + L` (lector → voz → desactivado).
* Apertura y cierre del panel:

  * `Alt + Shift + O`.
* Detección automática de la mejor fuente de subtítulos disponible:

  * pistas accesibles (`track`) cuando existen,
  * subtítulos visibles (`visual`) cuando no hay pistas reales.
* Adaptaciones automáticas para plataformas con controles poco accesibles:

  * etiquetado dinámico de botones,
  * menús de audio y subtítulos accesibles.
* Lectura sincronizada con el video, **sin repeticiones ni eco**.
* Controles del reproductor accesibles por teclado:

  * reproducir / pausar,
  * avanzar / retroceder,
  * volumen,
  * pantalla completa (con aviso de posibles limitaciones de accesibilidad).

> ⚠️ La extensión **no reimprime subtítulos en pantalla**: utiliza únicamente el contenido ya visible o disponible en la plataforma para la lectura, evitando duplicación o confusión visual.

---

### Instalación de la extensión (modo desarrollador)

#### En Google Chrome o Microsoft Edge:

1. Descargá o cloná este repositorio.
2. Abrí el navegador y accedé a: `chrome://extensions/`
3. Activá la opción **"Modo de desarrollador"**.
4. Seleccioná el botón **"Cargar sin comprimir"**.
5. Indicá la carpeta donde se encuentra este repositorio.

> 🛈 Si usás lector de pantalla, podés navegar por tabulaciones hasta el botón “Cargar sin comprimir”.

---

### Cómo contribuir o reportar errores

Podés contribuir de las siguientes formas:

* Enviando un **pull request** con mejoras o correcciones.
* Abriendo un **Issue** en GitHub con la descripción del problema.
* Usando el **formulario accesible integrado en la extensión** para enviar errores.
* Activando la opción de **envío de logs de diagnóstico**, que solo se adjuntan cuando el usuario decide reportarlos.

---

### Licencia de este proyecto

Este proyecto está licenciado bajo:

* [Licencia de Accesibilidad Universal (LAU) v1.2](https://kathware.com.ar/lau/)
* [Creative Commons BY-NC-SA 4.0](https://kathware.com.ar/normas-de-uso-y-licencias-de-kathware/)

---

### Historial de versiones

🔗 [Consultar `version.md`](./version.md)
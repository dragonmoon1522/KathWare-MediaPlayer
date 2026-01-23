## **KathWare Media Player**

**Autora:** Katherine Vargas | [(KathWare)](https://kathware.com.ar)  
**Última actualización:** 2025-07-08  

---

### **Descripción del Proyecto**

**KathWare Media Player** es una extensión accesible para navegador que permite la lectura automática de subtítulos en plataformas de video, incluso cuando el reproductor no ofrece accesibilidad nativa (como ocurre en Flow, ok.ru, entre otras).

Forma parte del ecosistema KathWare y se encuentra alojada como proyecto individual dentro del entorno GitHub de `dragonmoon1522`.

Incluye:

- Panel accesible flotante con opciones de control total desde teclado.
- Lectura de subtítulos por lector de pantalla o sintetizador del sistema.
- Detección de reproductores no accesibles con overlay automático.
- Funciones avanzadas para pruebas de accesibilidad y compatibilidad.

---

### Tecnologías utilizadas

- HTML, CSS y JavaScript puro.
- Sintetizador de voz (SpeechSynthesis API).
- Almacenamiento local con `store.db`.
- Integración con múltiples plataformas mediante detección de `<video>` y subtítulos visibles o por `track`.

---

### Licencias y manifiestos

- 🛡[Licencia de Accesibilidad Universal (LAU) — Español](https://kathware.com.ar/lau/)  
- [Creative Commons BY-NC-SA 4.0](https://kathware.com.ar/normas-de-uso-y-licencias-de-kathware/)

> Todos los proyectos del ecosistema KathWare están protegidos por la LAU y por licencias libres no comerciales.

---

### Funcionalidades principales

- Activación por atajo universal: `Ctrl + Shift + K`.
- Panel accesible con selección de:
  - Fuente: Subtítulo convencional (track) o visible (CC).
  - Voz: Lectura por screen reader o sintetizador del sistema.
- Auto detección de reproductores inaccesibles.
- Lectura automática de subtítulos al ritmo del video.
- Controles de velocidad, volumen, pausa, y navegación.
- Compatibilidad con teclado, lector de pantalla y navegación asistida.
- Panel de reporte accesible para que el usuario pueda informar errores o sugerencias.

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

- Enviando un **pull request** con mejoras o correcciones.
- Abriendo un **Issue** en GitHub con la descripción del problema.
- Usando el **formulario accesible integrado en la extensión** para enviar errores.
- Activando la opción de **enviar logs de errores**, almacenados en `store.db` hasta que el usuario los remite.

---

### Licencia de este proyecto

Este proyecto está licenciado bajo:

- [Licencia de Accesibilidad Universal (LAU) v1.2](https://kathware.com.ar/lau/)
- [Creative Commons BY-NC-SA 4.0](https://kathware.com.ar/normas-de-uso-y-licencias-de-kathware/)

---

### Historial de versiones

🔗 [Consultar `version.md`](./version.md)

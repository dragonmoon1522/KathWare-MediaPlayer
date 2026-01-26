// ====================================================
// KathWare SubtitleReader - background.js (Manifest V3)
// ====================================================
//
// ¿Qué hace este archivo?
// - Vive en el "service worker" de la extensión (no en la página).
// - Recibe mensajes desde los content scripts y guarda logs en storage.
// - Maneja el comando global (atajo configurado en manifest.json).
//
// Importante sobre MV3:
// - El service worker NO está siempre vivo. Chrome lo "duerme" y lo "despierta".
// - Por eso: no dependemos de variables en memoria para cosas importantes.
// - Los logs se guardan en chrome.storage.local.
//
// Nota sobre "return true" en onMessage:
// - SOLO se devuelve true si vamos a responder de forma asíncrona.
// - Si devolvés true y nunca llamás a sendResponse, Chrome se queja con:
//   “A listener indicated an asynchronous response by returning true,
//    but the message channel closed before a response was received”
//
// ====================================================

const LOG_KEY = "kathLogs";     // Clave donde guardamos los logs en storage.local
const MAX_LOGS = 400;          // Límite para no crecer infinito (rendimiento + privacidad)

// ----------------------------------------------------
// pushLog(entry, cb)
// ----------------------------------------------------
// Guarda un evento de log en chrome.storage.local[LOG_KEY].
//
// - entry: objeto con los datos del log (timestamp, nivel, mensaje, etc.)
// - cb: callback opcional al terminar de guardar
//
// Por qué así:
// - storage.local es persistente (sobrevive reinicios).
// - recortamos a MAX_LOGS para no inflar storage.
// ----------------------------------------------------
function pushLog(entry, cb) {
  try {
    chrome.storage.local.get([LOG_KEY], (data) => {
      const arr = Array.isArray(data?.[LOG_KEY]) ? data[LOG_KEY] : [];

      arr.push(entry);

      // Recortamos: nos quedamos con los últimos MAX_LOGS
      if (arr.length > MAX_LOGS) {
        arr.splice(0, arr.length - MAX_LOGS);
      }

      chrome.storage.local.set({ [LOG_KEY]: arr }, () => {
        // runtime.lastError puede existir si el SW se interrumpe o hay problemas de storage.
        // No rompemos flujo: esto es logging, no lógica crítica.
        void chrome.runtime.lastError;
        cb && cb();
      });
    });
  } catch (e) {
    console.warn("[KathWare] pushLog error:", e);
    cb && cb();
  }
}

// ----------------------------------------------------
// onInstalled
// ----------------------------------------------------
// Se ejecuta cuando se instala o actualiza la extensión.
// Lo usamos para log de instalación (diagnóstico básico).
// ----------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  console.log("[KathWare] SubtitleReader instalado/actualizado.");
});

// ----------------------------------------------------
// commands.onCommand
// ----------------------------------------------------
// Recibe comandos globales definidos en manifest.json.
// En nuestro caso: toggle_kathware_subtitlereader
//
// Qué hace:
// - Busca la pestaña activa.
// - Envía un mensaje al content script para alternar ON/OFF.
//
// Nota:
// - Esto NO ejecuta lógica de lectura de subtítulos.
// - Solo "toca el timbre" al content script de esa pestaña.
// ----------------------------------------------------
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle_kathware_subtitlereader") return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;

    chrome.tabs.sendMessage(tabId, { action: "toggleExtension" }, () => {
      // Si la pestaña no tiene content script (o no es una URL válida), Chrome tira error.
      // Lo ignoramos para no ensuciar la consola del usuario.
      void chrome.runtime.lastError;
    });
  });
});

// ----------------------------------------------------
// runtime.onMessage
// ----------------------------------------------------
// Recibe mensajes desde:
// - content scripts (cuando quieren guardar logs)
// - (posiblemente) popup u otros componentes
//
// Caso principal:
// - action === "logEvent": guardar un log en storage.local
//
// Regla de oro:
// - Solo return true si respondemos luego (async).
// ----------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    // 1) Guardar logs enviados por content scripts
    if (request?.action === "logEvent") {
      const entry = {
        ts: new Date().toISOString(),
        tabId: sender?.tab?.id ?? null,
        tabUrl: sender?.tab?.url || "",
        // payload contiene: level, msg, platform, version, etc.
        ...(request.payload || {})
      };

      // Respondemos ASYNC cuando storage terminó.
      pushLog(entry, () => {
        try {
          sendResponse({ status: "ok" });
        } catch {
          // Si el canal ya se cerró, no hacemos nada.
        }
      });

      return true; // ✅ canal abierto: respuesta async
    }

    // 2) Mensajes no reconocidos: respondemos sync sin romper
    sendResponse({ status: "ok" });
    return false;
  } catch (e) {
    console.warn("[KathWare] background error:", e);
    try {
      sendResponse({ status: "error", error: String(e?.message || e) });
    } catch {}
    return false;
  }
});

// ====================================================
// KathWare Media Player - background.js (MV3)
// - Guarda logs en storage.local[kathLogs] para que el popup pueda adjuntarlos
// - Recibe logs desde content scripts vía runtime.sendMessage({action:"logEvent"})
// - Hotkey commands: toggle_kathware_narrator
// ====================================================

const LOG_KEY = "kathLogs";
const MAX_LOGS = 400;

function pushLog(entry) {
  try {
    chrome.storage.local.get([LOG_KEY], (data) => {
      const arr = Array.isArray(data?.[LOG_KEY]) ? data[LOG_KEY] : [];
      arr.push(entry);
      if (arr.length > MAX_LOGS) arr.splice(0, arr.length - MAX_LOGS);
      chrome.storage.local.set({ [LOG_KEY]: arr }, () => {
        void chrome.runtime.lastError;
      });
    });
  } catch (e) {
    console.warn("[KathWare] pushLog error:", e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[KathWare] Extensión instalada correctamente.");
});

// Atajos de teclado (commands)
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle_kathware_narrator") return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { action: "toggleNarrator" }, () => {
      void chrome.runtime.lastError;
    });
  });
});

// Listener general (logs / acciones futuras)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    // ✅ LOGS: content/popup -> background -> storage.local.kathLogs
    if (request?.action === "logEvent") {
      const entry = {
        ts: new Date().toISOString(),
        tabId: sender?.tab?.id ?? null,
        tabUrl: sender?.tab?.url || "",
        ...request.payload
      };

      console.log("[KathWare Log]", entry);
      pushLog(entry);

      sendResponse?.({ status: "ok" });
      return true; // async OK
    }

    // Overlay toggle (si lo usás)
    if (request?.action === "toggleKathwareOverlay") {
      const tabId = sender?.tab?.id;
      if (tabId) chrome.tabs.sendMessage(tabId, { action: "toggleKathwareOverlay" }, () => {
        void chrome.runtime.lastError;
      });
      sendResponse?.({ status: "ok" });
      return true;
    }

    sendResponse?.({ status: "ok" });
    return true;
  } catch (e) {
    console.warn("[KathWare] background error:", e);
    sendResponse?.({ status: "error" });
    return true;
  }
});

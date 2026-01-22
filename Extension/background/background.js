// ====================================================
// KathWare SubtitleReader - background.js (MV3)
// - Guarda logs en storage.local[kathLogs] para adjuntar desde el popup
// - Recibe logs desde content scripts vía runtime.sendMessage({action:"logEvent"})
// - Hotkey commands: toggle_kathware_subtitlereader
// ====================================================

const LOG_KEY = "kathLogs";
const MAX_LOGS = 400;

function pushLog(entry) {
  try {
    chrome.storage.local.get([LOG_KEY], (data) => {
      const arr = Array.isArray(data?.[LOG_KEY]) ? data[LOG_KEY] : [];
      arr.push(entry);
      if (arr.length > MAX_LOGS) arr.splice(0, arr.length - MAX_LOGS);
      chrome.storage.local.set({ [LOG_KEY]: arr }, () => void chrome.runtime.lastError);
    });
  } catch (e) {
    console.warn("[KathWare] pushLog error:", e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[KathWare] SubtitleReader instalado correctamente.");
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle_kathware_subtitlereader") return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;

    chrome.tabs.sendMessage(tabId, { action: "toggleExtension" }, () => {
      void chrome.runtime.lastError;
    });
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request?.action === "logEvent") {
      const entry = {
        ts: new Date().toISOString(),
        tabId: sender?.tab?.id ?? null,
        tabUrl: sender?.tab?.url || "",
        ...request.payload
      };

      pushLog(entry);
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

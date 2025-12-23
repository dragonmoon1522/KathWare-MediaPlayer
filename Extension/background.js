// ====================================================
// KathWare Media Player - background.js (MV3)
// ====================================================

chrome.runtime.onInstalled.addListener(() => {
  console.log("[KathWare] Extensión instalada correctamente.");
});

// Atajos de teclado (commands)
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle_kathware_narrator") return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { action: "toggleNarrator" });
  });
});

// Listener general (logs / acciones futuras)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request?.action === "logEvent") {
      console.log("[KathWare Log]", request.payload);
      sendResponse({ status: "ok" });
      return true;
    }

    if (request?.action === "toggleKathwareOverlay") {
      const tabId = sender?.tab?.id;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: "toggleKathwareOverlay" });
      }
      sendResponse({ status: "ok" });
      return true;
    }

    sendResponse({ status: "ok" });
    return true;
  } catch (e) {
    console.warn("[KathWare] background error:", e);
    sendResponse({ status: "error" });
    return true;
  }
});

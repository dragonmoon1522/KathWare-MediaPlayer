chrome.runtime.onInstalled.addListener(() => {
  console.log("[KathWare] Extensión instalada correctamente.");
});

// Listener para atajos de teclado
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_kathware_narrator") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggleNarrator" });
      }
    });
  }
});

// Servicio de escucha para acciones externas si hiciera falta
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "logEvent") {
    console.log("[KathWare Log]", request.payload);
  }
  sendResponse({ status: "ok" });
});

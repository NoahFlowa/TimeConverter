async function toggle(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["src/parser.js", "src/content.js"],
  });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      if (typeof globalThis.__tcToggle === "function") globalThis.__tcToggle();
    },
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id == null) return;
  try {
    await toggle(tab.id);
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
  } catch (error) {
    console.error("UTC to Local Time could not run on this page.", error);
    try {
      await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#8a4b12" });
    } catch {
      // The badge is only a fallback when the page itself cannot be changed.
    }
  }
});

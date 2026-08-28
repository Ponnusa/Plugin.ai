(function (root) {
  const CACHE_KEY_PREFIX = "pageCache_";

  async function getCachedExtraction(tab) {
    const key = CACHE_KEY_PREFIX + tab.id;
    const stored = await chrome.storage.session.get(key);
    const cached = stored[key];
    if (cached && cached.url === tab.url) {
      return cached.extraction;
    }
    return null;
  }

  async function setCachedExtraction(tab, extraction) {
    const key = CACHE_KEY_PREFIX + tab.id;
    await chrome.storage.session.set({ [key]: { url: tab.url, extraction } });
  }

  function clearCachedExtraction(tabId) {
    return chrome.storage.session.remove(CACHE_KEY_PREFIX + tabId);
  }

  root.BeaconPageCache = { getCachedExtraction, setCachedExtraction, clearCachedExtraction };
})(typeof self !== "undefined" ? self : this);

importScripts("lib/pageCache.js");

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("Failed to set side panel behavior", err));

// Ambient zoom: automatically apply the user's calibrated preferred zoom
// (set during onboarding) to whatever page becomes active — same idea as a
// sighted user's browser just always being at a comfortable size, rather
// than something they have to ask for on every tab.
const manuallyZoomedTabs = new Set();
const RESTRICTED_URL_SCHEMES = ["chrome:", "chrome-extension:", "edge:", "about:", "devtools:", "view-source:"];

function isRestrictedUrl(url) {
  if (!url) return true;
  try {
    return RESTRICTED_URL_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return true;
  }
}

async function applyPreferredZoom(tabId, url) {
  if (isRestrictedUrl(url) || manuallyZoomedTabs.has(tabId)) return;

  const { onboardingComplete, preferredZoomPercent } = await chrome.storage.local.get([
    "onboardingComplete",
    "preferredZoomPercent",
  ]);
  if (!onboardingComplete || typeof preferredZoomPercent !== "number") return;

  try {
    await chrome.tabs.setZoom(tabId, preferredZoomPercent / 100);
  } catch {
    // Tab may have closed or navigated away mid-call — safe to ignore.
  }
}

// Invalidate the cached extraction and any manual zoom override whenever a
// tab starts loading (covers both navigating to a new URL and a plain
// refresh), apply the preferred zoom once a page finishes loading, and clean
// up on tab close.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    BeaconPageCache.clearCachedExtraction(tabId);
    manuallyZoomedTabs.delete(tabId); // a fresh page load resets to the calibrated default
  }
  if (changeInfo.status === "complete") {
    applyPreferredZoom(tabId, tab.url);
  }
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) applyPreferredZoom(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  BeaconPageCache.clearCachedExtraction(tabId);
  manuallyZoomedTabs.delete(tabId);
});

async function extractPageText(tab) {
  const cached = await BeaconPageCache.getCachedExtraction(tab);
  if (cached) return cached;

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["lib/Readability.js"],
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });

  if (result && !result.error) {
    await BeaconPageCache.setCachedExtraction(tab, result);
  }
  return result;
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;

async function executeCommand(tabId, command, args) {
  if (command.startsWith("zoom")) {
    // A voice-driven zoom change is a deliberate in-session choice — don't let
    // ambient auto-apply (on the next tab switch back to this tab) undo it.
    manuallyZoomedTabs.add(tabId);
  }

  switch (command) {
    case "zoomIn": {
      const current = await chrome.tabs.getZoom(tabId);
      await chrome.tabs.setZoom(tabId, Math.min(current + ZOOM_STEP, ZOOM_MAX));
      return {};
    }
    case "zoomOut": {
      const current = await chrome.tabs.getZoom(tabId);
      await chrome.tabs.setZoom(tabId, Math.max(current - ZOOM_STEP, ZOOM_MIN));
      return {};
    }
    case "zoomTo": {
      const percent = args?.percent;
      if (!percent || percent < ZOOM_MIN * 100 || percent > ZOOM_MAX * 100) {
        return { error: "invalid_zoom_percent" };
      }
      await chrome.tabs.setZoom(tabId, percent / 100);
      return {};
    }
    case "zoomReset":
      await chrome.tabs.setZoom(tabId, 1);
      return {};
    case "scrollUp":
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.scrollBy({ top: -window.innerHeight * 0.8, behavior: "smooth" }),
      });
      return {};
    case "scrollDown":
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" }),
      });
      return {};
    case "scrollToTop":
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.scrollTo({ top: 0, behavior: "smooth" }),
      });
      return {};
    case "scrollToBottom":
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }),
      });
      return {};
    case "goBack":
      await chrome.tabs.goBack(tabId);
      return {};
    case "goForward":
      await chrome.tabs.goForward(tabId);
      return {};
    default:
      return { error: "unknown_command" };
  }
}

const BACKEND_URL = "http://localhost:8000";

async function callBackend(pageTitle, pageText, query) {
  const res = await fetch(`${BACKEND_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageTitle, pageText, query }),
  });

  if (!res.ok) {
    return { error: "backend_error", message: `HTTP ${res.status}` };
  }

  const data = await res.json();
  return { response: data.response, language: data.language };
}

async function askAI(tab, query) {
  const extraction = await extractPageText(tab);
  if (!extraction || extraction.error) {
    return { error: "no_content" };
  }
  return callBackend(extraction.title, extraction.text, query);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "EXTRACT_PAGE_TEXT") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          sendResponse({ error: "no_active_tab" });
          return;
        }
        sendResponse(await extractPageText(tab));
      } catch (err) {
        sendResponse({ error: "extraction_failed", message: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (message?.type === "EXECUTE_COMMAND") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          sendResponse({ error: "no_active_tab" });
          return;
        }
        sendResponse(await executeCommand(tab.id, message.command, message.args));
      } catch (err) {
        sendResponse({ error: "command_failed", message: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (message?.type === "ASK_AI") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          sendResponse({ error: "no_active_tab" });
          return;
        }
        sendResponse(await askAI(tab, message.query));
      } catch (err) {
        sendResponse({ error: "ask_ai_failed", message: String(err?.message || err) });
      }
    })();
    return true;
  }

  // Used for content the caller already extracted itself (e.g. the side panel
  // extracting PDF text directly, since pdf.js can't run inside this service
  // worker — see extraction-with-pdfjs in sidepanel.js).
  if (message?.type === "ASK_AI_WITH_CONTENT") {
    (async () => {
      try {
        if (!message.pageText) {
          sendResponse({ error: "no_content" });
          return;
        }
        sendResponse(await callBackend(message.pageTitle, message.pageText, message.query));
      } catch (err) {
        sendResponse({ error: "ask_ai_failed", message: String(err?.message || err) });
      }
    })();
    return true;
  }
});

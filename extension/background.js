importScripts("lib/pageCache.js");

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("Failed to set side panel behavior", err));

// PROTOTYPE: page-content contrast override. Reuses the same theme colors as
// the panel's own CSS themes. Targeted at text-carrying elements only —
// deliberately leaves img/video/canvas/svg untouched, since Beacon's actual
// scope is text-heavy pages, not general web-app re-theming (that's what
// Dark Reader spends years of engineering on).
const PAGE_THEME_COLORS = {
  dark: { bg: "#000000", text: "#ffffff", link: "#6db4ff" },
  "yellow-black": { bg: "#ffee00", text: "#000000", link: "#0033cc" },
  "black-yellow": { bg: "#000000", text: "#ffee00", link: "#66ccff" },
};
const TEXT_SELECTORS =
  "html, body, p, div, span, article, section, header, footer, main, aside, nav, " +
  "h1, h2, h3, h4, h5, h6, li, ul, ol, td, th, table, label, blockquote, figcaption";

function buildPageThemeCss(theme) {
  const colors = PAGE_THEME_COLORS[theme];
  if (!colors) return null;
  return (
    `${TEXT_SELECTORS} { background-color: ${colors.bg} !important; color: ${colors.text} !important; } ` +
    `a, a * { color: ${colors.link} !important; }`
  );
}

const injectedPageThemeCss = new Map(); // tabId -> css string currently applied, for clean removal

async function applyPageTheme(tabId, theme) {
  const previousCss = injectedPageThemeCss.get(tabId);
  if (previousCss) {
    await chrome.scripting
      .removeCSS({ target: { tabId }, css: previousCss, origin: "USER" })
      .catch((err) => console.error(`[Beacon pageTheme] removeCSS failed for tab ${tabId}:`, err));
    injectedPageThemeCss.delete(tabId);
  }

  const css = buildPageThemeCss(theme);
  if (!css) return; // "light" (or unknown) theme -> just remove, nothing to add

  await chrome.scripting.insertCSS({ target: { tabId }, css, origin: "USER" });
  injectedPageThemeCss.set(tabId, css);
  console.log(`[Beacon pageTheme] insertCSS applied for tab ${tabId}, theme=${theme}`);
}

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

// Ambient page theme: unlike zoom (which can legitimately vary per page —
// a dense article may need more magnification than the baseline), contrast
// theme is a single stable accessibility preference, so there's no per-tab
// "manual override" concept to track — every tab just always reflects
// whichever theme is currently stored, and saying a theme command updates
// that stored value globally.
async function applyPreferredPageTheme(tabId, url) {
  if (isRestrictedUrl(url)) {
    console.log(`[Beacon pageTheme] skipping restricted url for tab ${tabId}: ${url}`);
    return;
  }
  const { contrastTheme } = await chrome.storage.local.get(["contrastTheme"]);
  console.log(`[Beacon pageTheme] applying theme=${contrastTheme || "light"} to tab ${tabId} (${url})`);
  try {
    await applyPageTheme(tabId, contrastTheme || "light");
  } catch (err) {
    console.error(`[Beacon pageTheme] failed for tab ${tabId}:`, err);
  }
}

// Invalidate the cached extraction and any manual zoom override whenever a
// tab starts loading (covers both navigating to a new URL and a plain
// refresh — a fresh page load has no CSS injected yet, so the theme map
// entry is stale too), apply the preferred zoom + page theme once a page
// finishes loading, and clean up on tab close.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    BeaconPageCache.clearCachedExtraction(tabId);
    manuallyZoomedTabs.delete(tabId); // a fresh page load resets to the calibrated default
    injectedPageThemeCss.delete(tabId);
  }
  if (changeInfo.status === "complete") {
    applyPreferredZoom(tabId, tab.url);
    applyPreferredPageTheme(tabId, tab.url);
  }
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) {
    applyPreferredZoom(tabId, tab.url);
    applyPreferredPageTheme(tabId, tab.url);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedPageThemeCss.delete(tabId);
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
    case "navigateTo": {
      const url = args?.url;
      if (!url) return { error: "invalid_url" };
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { error: "invalid_url" };
        }
      } catch {
        return { error: "invalid_url" };
      }
      await chrome.tabs.update(tabId, { url });
      return {};
    }
    default:
      return { error: "unknown_command" };
  }
}

const BACKEND_URL = "https://beacon-ai-production-4999.up.railway.app"; // set to "http://localhost:8000" for local backend dev

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

  if (message?.type === "APPLY_PAGE_THEME") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          sendResponse({ error: "no_active_tab" });
          return;
        }
        await applyPageTheme(tab.id, message.theme);
        sendResponse({});
      } catch (err) {
        sendResponse({ error: "page_theme_failed", message: String(err?.message || err) });
      }
    })();
    return true;
  }
});

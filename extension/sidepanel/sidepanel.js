const listenBtn = document.getElementById("listenBtn");
const micLabelEl = listenBtn.querySelector(".mic-label");
const busySpinnerEl = document.getElementById("busySpinner");
const voiceStatusEl = document.getElementById("voiceStatus");
const transcriptEl = document.getElementById("transcript");
const micSetupBtn = document.getElementById("micSetupBtn");
const helpBtn = document.getElementById("helpBtn");
const privacyBtn = document.getElementById("privacyBtn");
const aiResponseEl = document.getElementById("aiResponse");
const stopSpeakingBtn = document.getElementById("stopSpeakingBtn");

const extractBtn = document.getElementById("extractBtn");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");

const onboardingEl = document.getElementById("onboarding");
const onboardingPromptEl = document.getElementById("onboardingPrompt");
const onboardingActionsEl = document.getElementById("onboardingActions");
const skipOnboardingBtn = document.getElementById("skipOnboardingBtn");
const mainContentEl = document.getElementById("mainContent");
const redoSetupBtn = document.getElementById("redoSetupBtn");

// PDF text extraction runs here in the side panel, not in background.js —
// pdf.js needs a real Worker (or dynamic import() as a fallback), and Chrome's
// spec explicitly disallows both patterns inside a service worker.
const PDF_MAX_PAGES = 50; // safety cap so a pathologically large PDF can't hang extraction
let pdfjsLibPromise = null;

function isPdfUrl(url) {
  if (!url) return false;
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

async function getPdfjsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(chrome.runtime.getURL("lib/pdf.min.mjs")).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.mjs");
      return mod;
    });
  }
  return pdfjsLibPromise;
}

async function extractPdfTextRaw(url) {
  const pdfjsLib = await getPdfjsLib();

  const res = await fetch(url);
  if (!res.ok) return { error: "no_content" };

  const arrayBuffer = await res.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageCount = Math.min(pdf.numPages, PDF_MAX_PAGES);
  const pageTexts = [];
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    pageTexts.push(textContent.items.map((item) => item.str).join(" "));
  }
  const text = pageTexts.join("\n\n").trim();

  if (!text) return { error: "no_content" };

  let title = "";
  try {
    const meta = await pdf.getMetadata();
    title = meta?.info?.Title || "";
  } catch {
    // metadata unavailable — fall back to filename below
  }
  if (!title) {
    const filename = decodeURIComponent(url.split("/").pop().split("?")[0]);
    title = filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  }

  return { title, text, source: "pdf" };
}

async function extractPdfText(tab) {
  const cached = await BeaconPageCache.getCachedExtraction(tab);
  if (cached) return cached;

  const extraction = await extractPdfTextRaw(tab.url);
  if (extraction && !extraction.error) {
    await BeaconPageCache.setCachedExtraction(tab, extraction);
  }
  return extraction;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Shared extraction path (PDF vs. regular page), reused by the debug
// "Extract Page Text" button and by listResults/openResult below. Returns
// whatever content.js/extractPdfText produced, including `.links` when
// available (PDFs don't currently extract links -- see content.js).
async function extractCurrentPage() {
  const tab = await getActiveTab();
  if (!tab?.id) return { error: "no_active_tab" };

  if (isPdfUrl(tab.url)) {
    try {
      return await extractPdfText(tab);
    } catch (err) {
      return { error: "pdf_extraction_failed", message: String(err?.message || err) };
    }
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "EXTRACT_PAGE_TEXT" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: "extraction_failed", message: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

const CONFIRMATIONS = {
  zoomIn: "Zoomed in",
  zoomOut: "Zoomed out",
  zoomTo: "Zoom set",
  zoomReset: "Zoom reset to 100 percent",
  scrollUp: "Scrolled up",
  scrollDown: "Scrolled down",
  scrollToTop: "Scrolled to the top",
  scrollToBottom: "Scrolled to the bottom",
  goBack: "Went back",
  goForward: "Went forward",
};

// Categorized rather than one long flat list — a wall of spoken commands is
// exactly the linear cognitive-overload pattern this project is trying to
// move away from. Give a short map first, let the user drill into a category.
const HELP_TEXT = {
  helpOverview:
    "Here's what I can help with. Say \"help with navigation\" to move around the page. Say \"help with " +
    'understanding" to read, summarize, or ask about this page. Or say "help with settings" to adjust speech ' +
    "and appearance.",
  helpNavigation:
    "For navigation, you can say: zoom in, zoom out, or zoom to a percent; scroll up, down, to the top, or to " +
    "the bottom; and go back or go forward.",
  helpUnderstanding:
    "To understand this page, you can say: read this page; summarize this page; give me the key points; " +
    'simplify this; define a word, like "define osmosis"; translate this to a language, like "translate this ' +
    'to Spanish"; or just ask me any question about the page.',
  helpSettings:
    "For settings, you can say: speak faster or slower; continue reading; switch to a dark theme, yellow " +
    "background, or yellow on black; redo setup to recalibrate everything; and say \"privacy\" any time to " +
    "hear what happens with your information.",
};

const PRIVACY_TEXT =
  "Here's what happens with your information, plainly. When you speak, your voice goes to Google's speech " +
  "recognition service to turn it into text — Beacon doesn't record or store your voice. When you ask about " +
  "a page, that page's visible text is sent to Anthropic's Claude AI service to generate a response — never " +
  "anything you type into forms, passwords, or private fields, only what's readable on the page. Your " +
  "personal preferences, like speech speed, zoom, and color theme, are stored only on this device. Beacon " +
  "itself doesn't keep a permanent record of what you've asked or read.";

const SPEECH_RATE_MIN = 0.5;
const SPEECH_RATE_MAX = 2.0;
const SPEECH_RATE_STEP = 0.25;
const LOCAL_SPEECH_COMMANDS = new Set(["speechFaster", "speechSlower", "speechRateReset"]);
let speechRate = 1.0;

// Tracks the currently-resumable AI response, so an interruption (rate change,
// or an explicit "continue reading") can pick back up instead of losing it.
let lastSpokenText = null;
let lastSpokenLang = null;
let lastSpokenCharIndex = 0;
let isSpeechTrackable = false;
let isSpeaking = false;

const ONBOARDING_ZOOM_STEP = 25; // percent
const ONBOARDING_ZOOM_MIN = 50;
const ONBOARDING_ZOOM_MAX = 400;
let onboardingZoomPercent = 100;

const THEMES = [
  { value: "light", label: "Light (default)" },
  { value: "dark", label: "Dark — black background, white text" },
  { value: "yellow-black", label: "Yellow background, black text" },
  { value: "black-yellow", label: "Black background, yellow text" },
];
let contrastTheme = "light";

function applyTheme(theme) {
  contrastTheme = theme;
  if (theme === "light") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

chrome.storage.local.get(
  ["speechRate", "onboardingComplete", "preferredZoomPercent", "contrastTheme"],
  (result) => {
    if (typeof result.speechRate === "number") {
      speechRate = result.speechRate;
    }

    if (typeof result.contrastTheme === "string") {
      applyTheme(result.contrastTheme);
    }

    if (!result.onboardingComplete) {
      showOnboarding();
      return;
    }

    if (typeof result.preferredZoomPercent === "number") {
      onboardingZoomPercent = result.preferredZoomPercent;
      // Apply the calibrated zoom to whatever page is active when the panel opens.
      chrome.runtime.sendMessage({
        type: "EXECUTE_COMMAND",
        command: "zoomTo",
        args: { percent: onboardingZoomPercent },
      });
    }

    // Same redundant-safety-net reasoning as zoom above: background.js's
    // ambient listeners cover future tab switches, but not a tab that was
    // already active before the extension/panel loaded.
    if (typeof result.contrastTheme === "string") {
      chrome.runtime.sendMessage({ type: "APPLY_PAGE_THEME", theme: result.contrastTheme });
    }
  }
);

// Onboarding is voice-driven wherever possible, not just button-driven —
// someone who can't click (fully blind, no screen-reader fluency yet) still
// needs a way through setup. Buttons stay too, both as a fallback and for
// sighted/low-vision users who simply prefer them.
let currentOnboardingActions = [];
let onboardingRetryCount = 0; // per-question — reset whenever a new step is presented

function setOnboardingActions(buttons) {
  currentOnboardingActions = buttons;
  onboardingRetryCount = 0;
  onboardingActionsEl.innerHTML = "";
  buttons.forEach(({ label, primary, onClick }) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    if (primary) btn.classList.add("primary");
    btn.addEventListener("click", onClick);
    onboardingActionsEl.appendChild(btn);
  });
}

function matchOnboardingVoice(transcript) {
  const text = transcript.trim().toLowerCase();
  if (/^skip\b|skip for now|skip setup/.test(text)) return { onClick: skipOnboarding };
  for (const action of currentOnboardingActions) {
    if (action.voiceTriggers?.some((trigger) => text.includes(trigger))) {
      return action;
    }
  }
  return null;
}

async function isMicPermissionGranted() {
  if (!navigator.permissions?.query) return false;
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

async function startOnboardingListening() {
  if (!recognition || onboardingEl.hidden) return;
  if (!(await isMicPermissionGranted())) return; // stay button-only until mic access exists
  try {
    recognition.start();
  } catch {
    // Already listening, or transiently unavailable — the buttons still work either way.
  }
}

function describeOnboardingOptions() {
  const labels = currentOnboardingActions.map((a) => a.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return `You can say "${labels[0]}."`;
  const quoted = labels.map((l) => `"${l}"`);
  return `You can say ${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1]}.`;
}

// Shared by "heard nothing" (silence timeout) and "heard something, but it
// didn't match" — from the user's side these are the same event: they still
// need an answer. Always repeats the options and keeps listening again;
// never just gives up. After a few tries, adds a gentle nudge toward the
// buttons in case voice recognition itself isn't working well right now.
function promptOnboardingRetry(reasonPrefix) {
  onboardingRetryCount += 1;
  const escalation =
    onboardingRetryCount >= 3
      ? " I'm having a little trouble hearing you — you can also just click one of the buttons in the panel."
      : "";
  const message = `${reasonPrefix} ${describeOnboardingOptions()}${escalation}`;
  speak(message).then(() => startOnboardingListening());
}

function handleOnboardingTranscript(transcript) {
  const action = matchOnboardingVoice(transcript);
  if (action) {
    action.onClick();
    return;
  }
  promptOnboardingRetry("Sorry, I didn't catch that.");
}

function showOnboarding() {
  mainContentEl.hidden = true;
  onboardingEl.hidden = false;
  startOnboardingWelcome();
}

function finishOnboarding() {
  onboardingEl.hidden = true;
  mainContentEl.hidden = false;
}

function skipOnboarding() {
  chrome.storage.local.set({ onboardingComplete: true });
  finishOnboarding();
}

async function startOnboardingWelcome() {
  const message =
    "Welcome to Beacon AI. Let's quickly set up your preferences so everything is comfortable for you. " +
    'This will only take a minute. Say "get started" whenever you\'re ready, or click the button below.';
  onboardingPromptEl.textContent = message;
  setOnboardingActions([
    {
      label: "Get Started",
      primary: true,
      onClick: startSpeechRateCalibration,
      voiceTriggers: ["get started", "start", "begin", "ready", "yes"],
    },
  ]);
  await speak(message);
  startOnboardingListening();
}

async function startSpeechRateCalibration() {
  const sample = "This is a sample of how I will sound when I read to you.";
  const prompt = 'Is that speed comfortable for you? Say "comfortable," "faster," or "slower."';
  onboardingPromptEl.textContent = `Listen to this sample. ${prompt}`;
  setOnboardingActions([
    {
      label: "That's comfortable",
      primary: true,
      onClick: startZoomCalibration,
      voiceTriggers: ["comfortable", "good", "fine", "yes", "that works"],
    },
    {
      label: "Slower",
      voiceTriggers: ["slower", "slow down", "too fast"],
      onClick: () => {
        speechRate = Math.max(SPEECH_RATE_MIN, +(speechRate - SPEECH_RATE_STEP).toFixed(2));
        chrome.storage.local.set({ speechRate });
        startSpeechRateCalibration();
      },
    },
    {
      label: "Faster",
      voiceTriggers: ["faster", "speed up", "too slow"],
      onClick: () => {
        speechRate = Math.min(SPEECH_RATE_MAX, +(speechRate + SPEECH_RATE_STEP).toFixed(2));
        chrome.storage.local.set({ speechRate });
        startSpeechRateCalibration();
      },
    },
  ]);
  await speak(sample);
  await speak(prompt);
  startOnboardingListening();
}

function applyOnboardingZoom() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "EXECUTE_COMMAND", command: "zoomTo", args: { percent: onboardingZoomPercent } },
      resolve
    );
  });
}

async function startZoomCalibration() {
  await applyOnboardingZoom();
  const message = `I've set the page zoom to ${onboardingZoomPercent} percent. Take a look at the page — can you read it comfortably? Say "yes," "bigger," or "smaller."`;
  onboardingPromptEl.textContent = message;
  setOnboardingActions([
    {
      label: "Yes, I can read it",
      primary: true,
      onClick: startThemeCalibration,
      voiceTriggers: ["yes", "comfortable", "good", "fine", "i can read it"],
    },
    {
      label: "Make it bigger",
      voiceTriggers: ["bigger", "larger", "increase"],
      onClick: async () => {
        onboardingZoomPercent = Math.min(ONBOARDING_ZOOM_MAX, onboardingZoomPercent + ONBOARDING_ZOOM_STEP);
        await startZoomCalibration();
      },
    },
    {
      label: "Make it smaller",
      voiceTriggers: ["smaller", "decrease"],
      onClick: async () => {
        onboardingZoomPercent = Math.max(ONBOARDING_ZOOM_MIN, onboardingZoomPercent - ONBOARDING_ZOOM_STEP);
        await startZoomCalibration();
      },
    },
  ]);
  await speak(message);
  startOnboardingListening();
}

let onboardingThemeIndex = 0;

async function startThemeCalibration() {
  const theme = THEMES[onboardingThemeIndex];
  applyTheme(theme.value);
  chrome.runtime.sendMessage({ type: "APPLY_PAGE_THEME", theme: theme.value }); // preview on the real page too
  const message = `Here's the ${theme.label} color scheme. Take a look at both this panel and the page behind it — does this look comfortable? Say "good" or "try another."`;
  onboardingPromptEl.textContent = message;
  setOnboardingActions([
    {
      label: "This looks good",
      primary: true,
      onClick: completeOnboarding,
      voiceTriggers: ["good", "yes", "comfortable", "looks good", "fine"],
    },
    {
      label: "Try another",
      voiceTriggers: ["another", "try another", "next", "different"],
      onClick: () => {
        onboardingThemeIndex = (onboardingThemeIndex + 1) % THEMES.length;
        startThemeCalibration();
      },
    },
  ]);
  await speak(message);
  startOnboardingListening();
}

function completeOnboarding() {
  chrome.storage.local.set({
    onboardingComplete: true,
    speechRate,
    preferredZoomPercent: onboardingZoomPercent,
    contrastTheme,
  });
  speak('All set. You can say "redo setup" any time to change these preferences again.');
  finishOnboarding();
}

skipOnboardingBtn.addEventListener("click", skipOnboarding);

redoSetupBtn.addEventListener("click", () => {
  onboardingZoomPercent = 100;
  onboardingThemeIndex = 0;
  showOnboarding();
});

function loadVoices() {
  // Re-check live every call — never cache an empty result, since the browser
  // can finish loading voices well after the first speak() call goes out.
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const onVoicesChanged = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    // Some platforms never fire voiceschanged — don't hang forever.
    setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }, 1000);
  });
}

function findVoiceForLang(voices, lang) {
  if (!lang) return null;
  const target = lang.toLowerCase();
  const base = target.split("-")[0];
  return (
    voices.find((v) => v.lang.toLowerCase() === target) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    null
  );
}

function setSpeakingUI(speaking) {
  isSpeaking = speaking;
  stopSpeakingBtn.hidden = !speaking;
}

stopSpeakingBtn.addEventListener("click", () => {
  window.speechSynthesis.cancel();
});

// Resolves once the utterance finishes (naturally or interrupted), so callers
// that need to sequence "speak, then listen" can just `await speak(...)`.
// Callers that don't care can keep calling it fire-and-forget as before.
async function speak(text, lang, { trackable = false } = {}) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();

  isSpeechTrackable = trackable;
  if (trackable) {
    lastSpokenText = text;
    lastSpokenLang = lang;
    lastSpokenCharIndex = 0;
  }

  const voices = await loadVoices();
  const voice = findVoiceForLang(voices, lang);

  if (lang && lang.toLowerCase() !== "en" && !voice) {
    console.log(`[Beacon TTS] no voice for lang=${lang} (voices seen: ${voices.length}) -> fallback message`);
    return new Promise((resolve) => {
      const fallback = new SpeechSynthesisUtterance(
        "I don't have a voice available to read this language aloud, but you can see the text above."
      );
      fallback.rate = speechRate;
      fallback.onstart = () => setSpeakingUI(true);
      fallback.onend = () => {
        setSpeakingUI(false);
        resolve();
      };
      fallback.onerror = () => {
        setSpeakingUI(false);
        resolve();
      };
      window.speechSynthesis.speak(fallback);
    });
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = speechRate;
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else if (lang) {
    utterance.lang = lang;
  }

  console.log(`[Beacon TTS] lang=${lang || "(none)"} voices=${voices.length} voice=${voice?.name || "(none)"} utter.lang=${utterance.lang || "(default)"} rate=${speechRate}`);
  return new Promise((resolve) => {
    utterance.onstart = () => setSpeakingUI(true);
    utterance.onboundary = (e) => {
      if (trackable) lastSpokenCharIndex = e.charIndex;
    };
    utterance.onend = () => {
      setSpeakingUI(false);
      if (trackable) lastSpokenCharIndex = text.length;
      resolve();
    };
    utterance.onerror = (e) => {
      setSpeakingUI(false);
      if (trackable) lastSpokenCharIndex = text.length;
      // "canceled"/"interrupted" just mean a later speak() call cut this one off
      // (our own cancel-before-speak pattern) — expected, not a real failure.
      if (e.error !== "canceled" && e.error !== "interrupted") {
        console.error("[Beacon TTS] error", e.error);
      }
      resolve();
    };
    window.speechSynthesis.speak(utterance);
  });
}

function setListeningUI(isListening) {
  micLabelEl.textContent = isListening ? "Stop Listening" : "Start Listening";
  listenBtn.setAttribute("aria-pressed", String(isListening));
}

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

if (SpeechRecognitionImpl) {
  recognition = new SpeechRecognitionImpl();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isListening = true;
    setListeningUI(true);
    voiceStatusEl.textContent = "Listening...";
  };

  recognition.onend = () => {
    isListening = false;
    setListeningUI(false);
  };

  recognition.onerror = (event) => {
    isListening = false;
    setListeningUI(false);

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      const reason =
        "Microphone access needs to be set up once. Click 'Set Up Microphone Access' below.";
      voiceStatusEl.textContent = reason;
      speak("Microphone access needs to be set up once. Use the setup button below.");
      micSetupBtn.hidden = false;
      return;
    }

    if (event.error === "no-speech" && !onboardingEl.hidden) {
      // Silence, not a misheard answer — but staying quiet here would leave
      // a blind user with no way to tell "still waiting" from "broken."
      // Re-announce the options rather than restarting listening silently.
      promptOnboardingRetry("I didn't hear anything.");
      return;
    }

    const reason =
      event.error === "no-speech"
        ? "I didn't hear anything."
        : event.error === "audio-capture"
        ? "No microphone was found."
        : "Voice input isn't available right now.";
    voiceStatusEl.textContent = reason;
    speak(reason);
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    transcriptEl.textContent = `Heard: "${transcript}"`;
    if (!onboardingEl.hidden) {
      handleOnboardingTranscript(transcript);
    } else {
      handleTranscript(transcript);
    }
  };
} else {
  voiceStatusEl.textContent = "Voice input isn't supported in this browser.";
  listenBtn.disabled = true;
}

micSetupBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/mic-setup.html") });
});

helpBtn.addEventListener("click", () => {
  const message = HELP_TEXT.helpOverview;
  voiceStatusEl.textContent = "Here's what you can say";
  aiResponseEl.textContent = message;
  speak(message);
});

privacyBtn.addEventListener("click", () => {
  voiceStatusEl.textContent = "About your privacy";
  aiResponseEl.textContent = PRIVACY_TEXT;
  speak(PRIVACY_TEXT);
});

if (navigator.permissions?.query) {
  navigator.permissions
    .query({ name: "microphone" })
    .then((status) => {
      const updateVisibility = () => {
        micSetupBtn.hidden = status.state !== "denied";
      };
      updateVisibility();
      status.onchange = updateVisibility;
    })
    .catch(() => {
      // Permissions API doesn't support querying "microphone" in every context — safe to ignore, the reactive onerror path still covers it.
    });
}

listenBtn.addEventListener("click", () => {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
    return;
  }
  // Barge-in: starting to listen always interrupts any speech in progress,
  // so the user is never stuck waiting for it to finish before they can act.
  window.speechSynthesis.cancel();
  try {
    recognition.start();
  } catch (err) {
    voiceStatusEl.textContent = "Voice input isn't available right now.";
  }
});

async function handleTranscript(transcript) {
  const intent = window.BeaconCommands ? window.BeaconCommands.matchIntent(transcript) : null;

  if (!intent) {
    askAI(transcript);
    return;
  }

  if (LOCAL_SPEECH_COMMANDS.has(intent.command)) {
    handleSpeechRateCommand(intent.command);
    return;
  }

  if (intent.command === "listResults") {
    voiceStatusEl.textContent = "One moment...";
    setBusy(true);
    const extraction = await extractCurrentPage();
    setBusy(false);
    const links = extraction?.links || [];
    if (!links.length) {
      const message = "I couldn't find any links on this page.";
      voiceStatusEl.textContent = message;
      speak(message);
      return;
    }
    const numbered = links.map((l, i) => `${i + 1}. ${l.title}`);
    voiceStatusEl.textContent = "Here are the results";
    aiResponseEl.textContent = numbered.join("\n");
    speak(`Here are the top ${links.length} results. ${numbered.join(". ")}`);
    return;
  }

  if (intent.command === "openResult") {
    const position = intent.args?.position;
    voiceStatusEl.textContent = "One moment...";
    setBusy(true);
    const extraction = await extractCurrentPage();
    setBusy(false);
    const links = extraction?.links || [];
    if (!links.length) {
      const message = "I couldn't find any links on this page.";
      voiceStatusEl.textContent = message;
      speak(message);
      return;
    }
    if (!position || position > links.length) {
      const message = `I only found ${links.length} results on this page — which one would you like?`;
      voiceStatusEl.textContent = message;
      speak(message);
      return;
    }
    const target = links[position - 1];
    voiceStatusEl.textContent = `Opening "${target.title}"`;
    setBusy(true);
    chrome.runtime.sendMessage(
      { type: "EXECUTE_COMMAND", command: "navigateTo", args: { url: target.href } },
      (response) => {
        setBusy(false);
        if (chrome.runtime.lastError || !response || response.error) {
          const message = "I couldn't open that.";
          voiceStatusEl.textContent = message;
          speak(message);
          return;
        }
        const confirmation = `Opening ${target.title}`;
        voiceStatusEl.textContent = confirmation;
        speak(confirmation);
      }
    );
    return;
  }

  if (intent.command === "googleSearch") {
    const term = intent.args?.term;
    const url = `https://www.google.com/search?q=${encodeURIComponent(term)}`;
    voiceStatusEl.textContent = `Searching Google for "${term}"`;
    setBusy(true);
    chrome.runtime.sendMessage({ type: "EXECUTE_COMMAND", command: "navigateTo", args: { url } }, (response) => {
      setBusy(false);
      if (chrome.runtime.lastError || !response || response.error) {
        const message = "I couldn't open that search.";
        voiceStatusEl.textContent = message;
        speak(message);
        return;
      }
      const confirmation = `Searching Google for ${term}`;
      voiceStatusEl.textContent = confirmation;
      speak(confirmation);
    });
    return;
  }

  if (intent.command === "redoSetup") {
    onboardingZoomPercent = 100;
    onboardingThemeIndex = 0;
    showOnboarding();
    return;
  }

  if (intent.command === "switchTheme") {
    const theme = intent.args?.theme || "light";
    applyTheme(theme);
    chrome.storage.local.set({ contrastTheme: theme });
    chrome.runtime.sendMessage({ type: "APPLY_PAGE_THEME", theme }); // prototype: also try it on the actual page
    const themeLabel = THEMES.find((t) => t.value === theme)?.label || theme;
    const message = `Switched to ${themeLabel}`;
    voiceStatusEl.textContent = message;
    speak(message);
    return;
  }

  if (HELP_TEXT[intent.command]) {
    const message = HELP_TEXT[intent.command];
    voiceStatusEl.textContent = "Here's what you can say";
    aiResponseEl.textContent = message;
    speak(message);
    return;
  }

  if (intent.command === "privacyInfo") {
    voiceStatusEl.textContent = "About your privacy";
    aiResponseEl.textContent = PRIVACY_TEXT;
    speak(PRIVACY_TEXT);
    return;
  }

  if (intent.command === "resumeSpeech") {
    const remaining = lastSpokenText ? lastSpokenText.slice(lastSpokenCharIndex).trim() : "";
    if (remaining) {
      voiceStatusEl.textContent = "Continuing...";
      speak(remaining, lastSpokenLang, { trackable: true });
    } else {
      const message = "There's nothing to continue right now.";
      voiceStatusEl.textContent = message;
      speak(message);
    }
    return;
  }

  if (intent.command === "keyPoints") {
    const count = intent.args?.count || 3;
    askAI(
      `Give me the top ${count} key points from this page, spoken as a short numbered list — ` +
        `"First, ... Second, ... Third, ..." — one short sentence per point.`
    );
    return;
  }

  if (intent.command === "simplify") {
    askAI(
      "Rewrite the key content of this page in plain, simple language — short sentences, " +
        "common everyday words, no jargon. Stay accurate to the source."
    );
    return;
  }

  if (intent.command === "defineWord") {
    const term = intent.args?.term;
    askAI(
      `Define "${term}" in plain, simple language, using how it's used on this page for context ` +
        `if it appears there.`
    );
    return;
  }

  voiceStatusEl.textContent = "One moment...";
  setBusy(true);
  chrome.runtime.sendMessage({ type: "EXECUTE_COMMAND", ...intent }, (response) => {
    setBusy(false);

    if (chrome.runtime.lastError) {
      const message = "Something went wrong running that command.";
      voiceStatusEl.textContent = message;
      speak(message);
      return;
    }

    if (!response || response.error) {
      const message = "I couldn't do that.";
      voiceStatusEl.textContent = message;
      speak(message);
      return;
    }

    const confirmation = CONFIRMATIONS[intent.command] || "Done";
    voiceStatusEl.textContent = confirmation;
    speak(confirmation);
  });
}

function setBusy(busy) {
  listenBtn.disabled = busy;
  busySpinnerEl.hidden = !busy;
}

function handleSpeechRateCommand(command) {
  if (command === "speechFaster") {
    speechRate = Math.min(SPEECH_RATE_MAX, +(speechRate + SPEECH_RATE_STEP).toFixed(2));
  } else if (command === "speechSlower") {
    speechRate = Math.max(SPEECH_RATE_MIN, +(speechRate - SPEECH_RATE_STEP).toFixed(2));
  } else if (command === "speechRateReset") {
    speechRate = 1.0;
  }

  chrome.storage.local.set({ speechRate });

  const remaining =
    isSpeaking && isSpeechTrackable && lastSpokenText ? lastSpokenText.slice(lastSpokenCharIndex).trim() : "";

  if (remaining) {
    voiceStatusEl.textContent = `Speech speed set to ${Math.round(speechRate * 100)} percent — continuing`;
    speak(remaining, lastSpokenLang, { trackable: true });
    return;
  }

  const message = `Speech speed set to ${Math.round(speechRate * 100)} percent`;
  voiceStatusEl.textContent = message;
  speak(message);
}

function handleAskAIResponse(response) {
  setBusy(false);

  if (chrome.runtime.lastError) {
    const message = "Something went wrong asking that.";
    voiceStatusEl.textContent = message;
    speak(message);
    return;
  }

  if (!response || response.error) {
    const message =
      response?.error === "no_content"
        ? "I can't read this part of the page."
        : "I couldn't get an answer for that.";
    voiceStatusEl.textContent = message;
    speak(message);
    return;
  }

  voiceStatusEl.textContent = "Done";
  aiResponseEl.textContent = response.response;
  speak(response.response, response.language, { trackable: true });
}

async function askAI(query) {
  voiceStatusEl.textContent = "Thinking...";
  aiResponseEl.textContent = "";
  speak("One moment...");
  setBusy(true);

  const tab = await getActiveTab();
  if (!tab?.id) {
    handleAskAIResponse({ error: "no_active_tab" });
    return;
  }

  if (isPdfUrl(tab.url)) {
    let extraction;
    try {
      extraction = await extractPdfText(tab);
    } catch (err) {
      extraction = { error: "pdf_extraction_failed", message: String(err?.message || err) };
    }
    if (!extraction || extraction.error) {
      handleAskAIResponse({ error: "no_content" });
      return;
    }
    chrome.runtime.sendMessage(
      { type: "ASK_AI_WITH_CONTENT", pageTitle: extraction.title, pageText: extraction.text, query },
      handleAskAIResponse
    );
    return;
  }

  chrome.runtime.sendMessage({ type: "ASK_AI", query }, handleAskAIResponse);
}

function renderExtractResult(response) {
  if (!response || response.error) {
    statusEl.textContent =
      response?.error === "no_content"
        ? "I can't read this part of the page."
        : `Error: ${response?.error || "unknown"}${response?.message ? " — " + response.message : ""}`;
    return;
  }

  statusEl.textContent = `Extracted via ${response.source} (${response.text.length} chars)`;
  outputEl.textContent = `${response.title}\n\n${response.text}`;
}

extractBtn.addEventListener("click", async () => {
  statusEl.textContent = "Extracting...";
  outputEl.textContent = "";

  const tab = await getActiveTab();
  if (!tab?.id) {
    statusEl.textContent = "Error: no_active_tab";
    return;
  }

  if (isPdfUrl(tab.url)) {
    try {
      renderExtractResult(await extractPdfText(tab));
    } catch (err) {
      renderExtractResult({ error: "pdf_extraction_failed", message: String(err?.message || err) });
    }
    return;
  }

  chrome.runtime.sendMessage({ type: "EXTRACT_PAGE_TEXT" }, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
      return;
    }
    renderExtractResult(response);
  });
});

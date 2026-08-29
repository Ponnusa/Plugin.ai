# Chrome Web Store Submission — Copy-Paste Reference

Everything below is ready to paste into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Steps that need your own action (account, payment, actual submission) are marked **[YOU]**.

---

## 1. Account setup **[YOU]**

1. Go to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Sign in with a Google account
3. Pay the one-time $5 registration fee (no annual renewal, no per-extension fee)

## 2. Package the extension **[YOU]**

Zip the contents of the `extension/` folder (not the folder itself — the `manifest.json` should be at the root of the zip). Upload via "Add new item" in the dashboard.

---

## 3. Store Listing tab

**Extension name:**
```
Beacon AI
```

**Summary** (short description, 132 character limit):
```
A voice assistant for blind and low-vision users — read, summarize, translate, and navigate any webpage hands-free.
```

**Detailed description:**
```
Beacon AI is a voice-controlled accessibility assistant for the web, built for blind and low-vision users.

Instead of forcing you into linear, element-by-element navigation like a traditional screen reader, Beacon AI lets you speak naturally and get a fast, spoken answer:

READ AND UNDERSTAND ANY PAGE
- "Read this page" / "Summarize this page"
- "Give me the key points" — a short numbered summary instead of a wall of text
- "Simplify this" — plain-language rewrite
- "Define [a word]" — contextual definitions
- "Translate this to Spanish" (or any language)
- Or just ask any question about what's on the page

NAVIGATE HANDS-FREE
- "Zoom in," "zoom to 200 percent," "scroll to the top," "go back"

MAKE IT COMFORTABLE FOR YOU
- Adjustable speech rate, page magnification, and contrast themes (including yellow-on-black and black-on-yellow), calibrated during a short guided setup — and re-applied automatically every time you browse
- "Continue reading" resumes exactly where you left off if you're interrupted
- Say "help" any time for a categorized list of everything you can say

BUILT WITH ACCESSIBILITY AS THE STARTING POINT, NOT AN AFTERTHOUGHT
- Setup itself is voice-driven, not just button-driven
- Every response comes with an honest fallback if something can't be read — never a silent failure
- Full transparency about what data goes where — say "privacy" any time

Beacon AI is free to use. See the in-app "Privacy & Data" explanation, or our privacy policy, for exactly what data is processed and by whom.
```

**Category:**
```
Accessibility
```

**Language:**
```
English
```

**Screenshots** (already generated, 1280×800, in `docs/store-assets/`):
1. `screenshot-1-panel.png` — main panel view
2. `screenshot-2-zoom.png` — live zoom calibration
3. `screenshot-3-theme.png` — live theme calibration
4. `screenshot-4-contrast-comparison.png` — light vs. dark theme side by side
5. `screenshot-5-mic-setup.png` — the dedicated microphone setup flow

**Small promotional tile** (440×280, required): `docs/store-assets/small-promo-440x280.png`

**Icon** (128×128, required): `extension/icons/icon128.png`

---

## 4. Privacy tab

**Single purpose statement:**
```
Beacon AI helps blind and low-vision users understand and navigate webpages through voice commands and AI-generated spoken responses (reading, summarizing, translating, and answering questions about page content).
```

**Privacy policy URL:**
```
[Fill in once GitHub Pages is enabled — see below. Will be something like:
https://ponnusa.github.io/Plugin.ai/privacy-policy.html]
```

**Permission justifications** (paste per permission in the dashboard's justification fields):

| Permission | Justification |
|---|---|
| `host_permissions` (`http://*/*`, `https://*/*`) | Beacon AI is a general-purpose accessibility tool that must work on any webpage the user visits — reading, summarizing, zooming, and adjusting contrast are not limited to a specific set of sites. Narrower permissions (e.g. `activeTab` alone) can't support the extension's ambient features, which apply the user's calibrated zoom and contrast preferences automatically on every tab, not only after a fresh click. |
| `scripting` | Used to extract readable page text (via a vendored copy of Mozilla's Readability.js) for the AI-assisted commands, and to apply the user's zoom/scroll/contrast preferences to the active page. |
| `tabs` | Used to detect which tab is active so voice commands and ambient preferences (zoom, contrast theme) apply to the correct page, and to support back/forward navigation commands. |
| `activeTab` | Supplementary permission for user-invoked actions on the current tab. |
| `storage` | Stores the user's preferences (speech rate, zoom level, contrast theme, onboarding status) locally on their device. Never transmitted anywhere. |
| `sidePanel` | Displays Beacon AI's persistent voice-control interface alongside the page, rather than a popup that closes on focus loss — important for a voice interaction that shouldn't disappear mid-conversation. |

**Data usage disclosure checkboxes** — based on what Beacon AI actually does:
- ✅ Website content (page text sent to Anthropic's Claude API to generate responses)
- ✅ User activity (voice input, transcribed via Google's speech recognition)
- ❌ Personally identifiable information (not collected)
- ❌ Health info, financial info, location, etc. (not collected)
- ❌ Authentication information (no accounts/sign-in)

---

## 5. Distribution tab **[YOU]**

- Visibility: Public (or "Unlisted" if you want it installable only via direct link for MABVI specifically, without appearing in public search — worth deciding based on whether you want public discovery yet)
- Pricing: Free
- Regions: your choice (e.g., United States, or worldwide)

---

## 6. Before submitting — enable the privacy policy URL **[YOU]**

The privacy policy page already exists at `docs/privacy-policy.html` in the repo, but it needs to be *live at a public URL* for the dashboard to accept it:

1. Go to the repo on GitHub → **Settings** → **Pages**
2. Under "Source," select the `main` branch and `/docs` folder
3. Save — GitHub will publish the whole `docs/` folder at `https://ponnusa.github.io/Plugin.ai/`
4. The privacy policy will then be live at `https://ponnusa.github.io/Plugin.ai/privacy-policy.html`

I can't flip this toggle for you — it's a one-time step in GitHub's own settings UI.

---

## 7. Submit for review **[YOU]**

Click "Submit for Review." Review time varies — extensions requesting broad host permissions (like this one, for the reasons above) sometimes take longer since they get manual review. Worth expecting this could take anywhere from a few days to a couple of weeks.

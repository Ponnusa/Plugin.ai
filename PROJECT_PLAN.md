# Beacon AI — AI Voice Accessibility Browser Extension — Project Plan

## 1. Problem & Goal

Build a browser extension for blind/low-vision adults that lets them control and understand any webpage using natural voice commands — zoom, scroll, read, summarize, translate, ask questions about content — going beyond traditional screen readers by adding conversational, context-aware AI on top of the raw content.

**Primary users:** Adults who are blind or low-vision, served through organizations like MABVI (Massachusetts Association for the Blind and Visually Impaired) — with particular emphasis on **older adults and people with recent vision loss** who have not yet built deep screen-reader (JAWS/NVDA) muscle memory.
**Success looks like:** a user can open any typical webpage, speak a command or question, and get a fast, accurate, spoken response — without needing to already be a screen-reader power user.

---

## 2. Competitive Landscape (context, not a blocker)

- **Screen Agent** — Chrome extension, local AI, conversational page navigation, built with a visually impaired collaborator.
- **Screen Reader AI** — academic project, converts page structure/layout into dialogue-based Q&A.
- **Accessibility Assistant (Firefox)** — shipped add-on, voice commands + TTS + page analysis.
- **JAWS/NVDA + AI companions** (FS Companion, Picture Smart AI) — AI bolted onto incumbent screen readers.
- **TTS-only tools** (Speechify, Read Aloud, NaturalReader) — reading aloud only, no voice commands or page reasoning.

**Takeaway:** No one has cleanly won this space yet. Differentiation = latency, reliability, and not requiring pre-existing screen-reader fluency — not the underlying tech, which is well-trodden. This last point matters more than it would for a school-age, tech-trained audience: MABVI's population skews toward people who are newer to assistive tech, so "works without a learning curve" is a real, defensible edge, not just a slogan.

---

## 3. MVP Scope (v1 — build this first)

Keep v1 narrow and shippable. Cut anything not on this list.

**In scope:**
- Voice command input (start/stop listening, push-to-talk as default; wake word deferred — see §5)
- Deterministic commands (no AI call, instant):
  - Zoom in/out/to X%
  - Scroll up/down/to top/bottom
  - Go back/forward
- AI-assisted commands (page content required):
  - "Read this page" / "read the article"
  - "Summarize this page"
  - "Translate this to [language]"
  - "What does this page say about X?" (Q&A)
- Text-to-speech output for all responses
- Works on standard text-heavy pages (articles, Wikipedia, news, email, government/benefits sites, healthcare portals, banking)
- Honest fallback message when content can't be read (no silent failure)

**Explicitly out of scope for v1:**
- Screenshot/vision fallback for canvas/DRM/inaccessible content
- Native OS accessibility-tree integration
- NVDA/JAWS bridge integration
- Multi-tab conversation memory
- Non-Chrome browser support

---

## 4. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Extension shell | Manifest V3 (Chrome/Edge) | Content script + background service worker + popup UI |
| Content extraction | `document.body.innerText` + Readability.js | Strips nav/ads/sidebars before sending to AI |
| Speech-to-text | Web Speech API (`SpeechRecognition`) for v1 | Chrome-only, requires network connectivity (streams to Google's servers) — needs an honest fallback if unavailable. Upgrade path: GCP Speech-to-Text for noisy environments/accents |
| Text-to-speech | Web Speech API `SpeechSynthesis` for v1 | Upgrade path: GCP Text-to-Speech for natural voices |
| Command routing | Local regex/intent-matching layer first | Only fall through to AI layer for open-ended requests |
| AI layer | Claude API (page text + user query → response) | Handles summarize/translate/Q&A |
| Backend | Lightweight API — Python/FastAPI or .NET | Sits between extension and Claude API; handles auth, rate limiting, chunking long articles |
| Hosting | Railway | Matches existing infra (learnai backend also on Railway) |
| Zoom control | `chrome.tabs.setZoom()` | Native browser API, no AI needed |

**Command flow:**
```
Voice → STT → local intent match
  → matched (zoom/scroll/nav) → execute directly, confirm by speech
  → unmatched → extract page content (Readability.js)
    → send to backend → Claude API → response
    → TTS → speak result
```

---

## 5. Key Risks & Design Constraints

- **Latency:** full voice→AI→speech round trip can hit 2–4s. Design for it: streaming responses, an audio cue while "thinking," never a silent gap. Define what the thinking-cue actually sounds like (earcon vs. periodic pings vs. spoken "thinking...") — this is a UX decision to make deliberately, not a default to fall into.
- **Ambiguous page content:** extraction must strip navigation/ads or answers will reference the wrong section — Readability.js is non-negotiable, not optional.
- **Misfired commands:** require a lightweight confirmation pattern for big/destructive actions (not for every command — that becomes annoying fast). Decide the confirmation boundary before Milestone 2 — retrofitting it later is a UX regression users will notice.
- **Inaccessible content (canvas, DRM, closed Shadow DOM):** must fail *honestly* via speech ("I can't read this part of the page"), never silently. Concrete flow when extraction fails:
  1. Content script detects `innerText` + Readability.js extraction returned empty/near-empty text.
  2. Skip the Claude API call entirely — nothing useful to send, and it would burn the latency budget above for a request that can't succeed.
  3. TTS speaks a direct message immediately (e.g. "I can't read this part of the page") — no silent gap, no guessing at content that wasn't extracted.
  4. Fail fast, no retry loop — don't leave the user sitting in the "thinking" state for a request that was never going to work.
- **STT reliability:** Web Speech API requires network connectivity and is Chrome-only; if it's unavailable or fails, fail honestly (e.g. "voice input unavailable") rather than silently.
- **Voice input method:** push-to-talk is the v1 default over wake-word. A misfired wake word is a worse experience for someone still building confidence with the tool than an extra button press, and this population skews toward lower prior exposure to voice-assistant conventions.
- **Adoption risk:** some target users may already use NVDA/JAWS/VoiceOver; others (especially recent-vision-loss users) may have no assistive-tech habits yet. This tool needs to either complement existing workflows or be clearly faster/better for specific tasks for power users — and be genuinely low-friction for newcomers, which is the primary differentiation opportunity (see §2).

---

## 6. Milestones

1. **Skeleton extension** — manifest, popup, content script injects and extracts page text on demand
2. **Deterministic voice commands** — zoom, scroll, navigate working end-to-end via voice
3. **AI layer wired up** — read/summarize/Q&A working on a handful of test pages (news, email, government/benefits site, healthcare portal — confirm exact set with MABVI rather than guessing)
4. **Translation** — added as an AI-layer command; confirm priority languages with MABVI (they already serve multilingual populations)
5. **TTS response polish** — natural voice, no dead air during processing
6. **First user testing round** — partner with MABVI, ideally folded into their existing assistive-technology training sessions, with real content their clients actually use
7. **Iterate based on feedback** — before considering any v2 scope (vision fallback, screen-reader bridge, etc.)

---

## 7. Open Questions for Cowork to Flag, Not Solve Silently

- Which specific sites (news, government/benefits, healthcare, banking) come up most in MABVI's assistive-tech training? (Determines how much "hard case" handling is needed early, replacing the earlier school-LMS assumption.)
- Confirmation-pattern UX: which commands need a "did you mean X?" check vs. instant execution?
- Data/privacy: is page content or voice audio sent to any third-party API acceptable for this population? Consent here is individual adult consent (not parental/institutional), but some users may be justifiably cautious about new tech post-vision-loss — worth confirming directly with MABVI before audio/text ever leaves the device.
- Which languages should translation prioritize, given MABVI's multilingual client base?

---

## 8. Future Ideas (Not Committed — v2+ at earliest)

Exploratory ideas raised during planning, deliberately not in MVP scope (§3). Listed so they aren't lost, not because they're queued up.

- **Camera-based gesture control.** Raised as a general differentiation idea, not tied to a specific accessibility gap. Flagged concern: gesture input depends on the user framing themselves in the camera and getting visual confirmation the system saw the gesture correctly — a feedback loop that doesn't work for a primarily blind/low-vision user base (§1) the way voice does, since there's no equivalent of glancing at a preview to self-correct. It also raises a heavier privacy ask (live camera video) than the audio/text data-flow question already open in §7. If revisited, scope it to a specific sub-population with residual vision or a specific narrow use case (e.g. confirmation gestures) rather than a general input method, and re-run the privacy/consent conversation with MABVI before any camera access ships.

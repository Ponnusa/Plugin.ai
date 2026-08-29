(function (root) {
  const PERCENT_WORDS = { "hundred": 100 };

  function parsePercent(text) {
    const numMatch = text.match(/(\d{1,3})\s*(?:%|percent)?/);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      if (!Number.isNaN(n)) return n;
    }
    const lower = text.toLowerCase();
    for (const word in PERCENT_WORDS) {
      if (lower.includes(word)) return PERCENT_WORDS[word];
    }
    return null;
  }

  function parseCount(text, fallback) {
    const match = text.match(/\b(\d{1,2})\b/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!Number.isNaN(n) && n > 0) return n;
    }
    return fallback;
  }

  const ORDINAL_WORDS = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
  };

  function parseOrdinal(text) {
    const lower = text.toLowerCase();
    const numMatch = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      if (!Number.isNaN(n) && n > 0) return n;
    }
    for (const word in ORDINAL_WORDS) {
      if (lower.includes(word)) return ORDINAL_WORDS[word];
    }
    return null;
  }

  const DEFINE_PATTERNS = [
    /^define\s+(.+)$/i,
    /what does\s+(.+?)\s+mean\??$/i,
    /meaning of\s+(.+)$/i,
  ];

  function parseDefineTerm(text) {
    for (const pattern of DEFINE_PATTERNS) {
      const m = text.match(pattern);
      if (m && m[1]) return m[1].trim();
    }
    return null;
  }

  const SEARCH_PATTERNS = [
    /^search (?:google )?for\s+(.+)$/i,
    /^google\s+(.+)$/i,
    /^look up\s+(.+)$/i,
    /^search\s+(.+)$/i,
  ];

  function parseSearchTerm(text) {
    for (const pattern of SEARCH_PATTERNS) {
      const m = text.match(pattern);
      if (m && m[1]) return m[1].trim();
    }
    return null;
  }

  const RULES = [
    { command: "zoomReset", test: (t) => /reset zoom|zoom (?:in )?to (100\s*(%|percent)?|normal)\b|default zoom/.test(t) },
    { command: "zoomTo", test: (t) => /zoom (?:in )?to\b/.test(t), args: (t) => ({ percent: parsePercent(t) }) },
    { command: "zoomIn", test: (t) => /zoom in\b|increase zoom|make (it|this) bigger/.test(t) },
    { command: "zoomOut", test: (t) => /zoom out\b|decrease zoom|make (it|this) smaller/.test(t) },
    { command: "scrollToTop", test: (t) => /scroll to (the )?top|go to (the )?top/.test(t) },
    { command: "scrollToBottom", test: (t) => /scroll to (the )?bottom|go to (the )?bottom/.test(t) },
    { command: "scrollUp", test: (t) => /scroll up/.test(t) },
    { command: "scrollDown", test: (t) => /scroll down/.test(t) },
    { command: "goBack", test: (t) => /go back|navigate back|previous page/.test(t) },
    { command: "goForward", test: (t) => /go forward|navigate forward|next page/.test(t) },
    { command: "speechRateReset", test: (t) => /(reset|normal|default) (speech |talking |reading )?speed/.test(t) },
    { command: "speechFaster", test: (t) => /speak fast(er)?\b|talk fast(er)?\b|read fast(er)?\b|speed up|increase (speech |talking |reading )?speed/.test(t) },
    { command: "speechSlower", test: (t) => /speak slow(er)?\b|talk slow(er)?\b|read slow(er)?\b|slow down|decrease (speech |talking |reading )?speed/.test(t) },
    { command: "resumeSpeech", test: (t) => /continue reading|resume reading|keep reading|continue speaking|keep going|resume speaking/.test(t) },
    {
      command: "keyPoints",
      test: (t) => /key points|main points|top points|bullet points|quick points/.test(t),
      args: (t) => ({ count: parseCount(t, 3) }),
    },
    {
      command: "simplify",
      test: (t) =>
        /simplify this|explain (this )?simply|explain (this )?like i'?m five|make this simpler|simpler language|plain language/.test(
          t
        ),
    },
    {
      command: "defineWord",
      test: (t) => parseDefineTerm(t) !== null,
      args: (t) => ({ term: parseDefineTerm(t) }),
    },
    {
      command: "listResults",
      test: (t) =>
        /list (the )?(results|links)|what are the results|show me the (results|links)|read the results/.test(t),
    },
    {
      // "open/choose/select/pick the Nth [thing]" -- the trailing noun
      // ("result", "news", "article", "one") is deliberately not required;
      // position is all that matters, matching how the trigger phrase was
      // first used ("choose the first news").
      command: "openResult",
      test: (t) =>
        /\b(open|choose|select|pick|go to)\b/.test(t) &&
        /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(st|nd|rd|th)?)\b/.test(t),
      args: (t) => ({ position: parseOrdinal(t) }),
    },
    {
      // Broad "search X" catch-all — kept late in the rule order (same
      // lesson as zoomReset vs. zoomTo) so more specific commands above it
      // always get first chance to match.
      command: "googleSearch",
      test: (t) => parseSearchTerm(t) !== null,
      args: (t) => ({ term: parseSearchTerm(t) }),
    },
    { command: "redoSetup", test: (t) => /redo setup|run setup again|set up again|start setup over/.test(t) },
    {
      command: "switchTheme",
      test: (t) => /dark theme|dark mode|switch to dark/.test(t),
      args: () => ({ theme: "dark" }),
    },
    {
      command: "switchTheme",
      test: (t) => /yellow background|yellow theme|black on yellow/.test(t),
      args: () => ({ theme: "yellow-black" }),
    },
    {
      command: "switchTheme",
      test: (t) => /yellow on black|yellow text/.test(t),
      args: () => ({ theme: "black-yellow" }),
    },
    {
      command: "switchTheme",
      test: (t) => /light theme|light mode|white background|default theme|normal theme|reset theme/.test(t),
      args: () => ({ theme: "light" }),
    },
    // Specific "help with X" phrasings must be checked before the generic
    // helpOverview catch-all below, or they'd never be reached (same ordering
    // lesson as zoomReset vs. zoomTo earlier).
    { command: "helpNavigation", test: (t) => /help with navigation|navigation commands|navigation help/.test(t) },
    {
      command: "helpUnderstanding",
      test: (t) => /help with understanding|understanding commands|content help/.test(t),
    },
    { command: "helpSettings", test: (t) => /help with settings|settings commands|speech help/.test(t) },
    {
      command: "helpOverview",
      test: (t) => /^help\??$|what can i say|what can you do|what commands|list commands/.test(t),
    },
    {
      command: "privacyInfo",
      test: (t) => /privacy|what happens to my data|data privacy|is this private|is my data safe/.test(t),
    },
  ];

  function matchIntent(rawText) {
    if (!rawText || typeof rawText !== "string") return null;
    const original = rawText.trim();
    const text = original.toLowerCase();
    if (!text) return null;

    for (const rule of RULES) {
      if (rule.test(text)) {
        // Matching is case-insensitive, but args are extracted from the
        // original-case text so captured terms (e.g. "MABVI", proper nouns)
        // aren't flattened to lowercase before being spoken back.
        return { command: rule.command, args: rule.args ? rule.args(original) : {} };
      }
    }
    return null;
  }

  const api = { matchIntent };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BeaconCommands = api;
  }
})(typeof self !== "undefined" ? self : this);

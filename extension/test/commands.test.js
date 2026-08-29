const test = require("node:test");
const assert = require("node:assert/strict");
const { matchIntent } = require("../lib/commands.js");

test("zoom in", () => {
  assert.deepEqual(matchIntent("zoom in"), { command: "zoomIn", args: {} });
  assert.deepEqual(matchIntent("Zoom In please"), { command: "zoomIn", args: {} });
  assert.deepEqual(matchIntent("make it bigger"), { command: "zoomIn", args: {} });
});

test("zoom out", () => {
  assert.deepEqual(matchIntent("zoom out"), { command: "zoomOut", args: {} });
  assert.deepEqual(matchIntent("make this smaller"), { command: "zoomOut", args: {} });
});

test("zoom to a percentage", () => {
  assert.deepEqual(matchIntent("zoom to 150%"), { command: "zoomTo", args: { percent: 150 } });
  assert.deepEqual(matchIntent("zoom in to 75 percent"), { command: "zoomTo", args: { percent: 75 } });
});

test("zoom reset", () => {
  assert.deepEqual(matchIntent("reset zoom"), { command: "zoomReset", args: {} });
  assert.deepEqual(matchIntent("zoom to 100%"), { command: "zoomReset", args: {} });
});

test("scroll commands", () => {
  assert.deepEqual(matchIntent("scroll down"), { command: "scrollDown", args: {} });
  assert.deepEqual(matchIntent("scroll up"), { command: "scrollUp", args: {} });
  assert.deepEqual(matchIntent("scroll to the top"), { command: "scrollToTop", args: {} });
  assert.deepEqual(matchIntent("scroll to the bottom"), { command: "scrollToBottom", args: {} });
});

test("navigation commands", () => {
  assert.deepEqual(matchIntent("go back"), { command: "goBack", args: {} });
  assert.deepEqual(matchIntent("go forward"), { command: "goForward", args: {} });
  assert.deepEqual(matchIntent("previous page"), { command: "goBack", args: {} });
});

test("speech rate commands", () => {
  assert.deepEqual(matchIntent("speak faster"), { command: "speechFaster", args: {} });
  assert.deepEqual(matchIntent("speak fast"), { command: "speechFaster", args: {} });
  assert.deepEqual(matchIntent("speed up"), { command: "speechFaster", args: {} });
  assert.deepEqual(matchIntent("slow down"), { command: "speechSlower", args: {} });
  assert.deepEqual(matchIntent("talk slower"), { command: "speechSlower", args: {} });
  assert.deepEqual(matchIntent("speak slow"), { command: "speechSlower", args: {} });
  assert.deepEqual(matchIntent("reset speech speed"), { command: "speechRateReset", args: {} });
  assert.deepEqual(matchIntent("normal speed"), { command: "speechRateReset", args: {} });
});

test("resume speech command", () => {
  assert.deepEqual(matchIntent("continue reading"), { command: "resumeSpeech", args: {} });
  assert.deepEqual(matchIntent("keep reading"), { command: "resumeSpeech", args: {} });
  assert.deepEqual(matchIntent("keep going"), { command: "resumeSpeech", args: {} });
});

test("key points commands", () => {
  assert.deepEqual(matchIntent("give me the key points"), { command: "keyPoints", args: { count: 3 } });
  assert.deepEqual(matchIntent("what are the main points"), { command: "keyPoints", args: { count: 3 } });
  assert.deepEqual(matchIntent("give me 5 key points"), { command: "keyPoints", args: { count: 5 } });
  assert.deepEqual(matchIntent("top points please"), { command: "keyPoints", args: { count: 3 } });
});

test("simplify command", () => {
  assert.deepEqual(matchIntent("simplify this"), { command: "simplify", args: {} });
  assert.deepEqual(matchIntent("explain this like I'm five"), { command: "simplify", args: {} });
  assert.deepEqual(matchIntent("make this simpler"), { command: "simplify", args: {} });
});

test("define word command", () => {
  assert.deepEqual(matchIntent("define osmosis"), { command: "defineWord", args: { term: "osmosis" } });
  assert.deepEqual(matchIntent("what does osmosis mean"), {
    command: "defineWord",
    args: { term: "osmosis" },
  });
  assert.deepEqual(matchIntent("meaning of osmosis"), {
    command: "defineWord",
    args: { term: "osmosis" },
  });
});

test("google search command", () => {
  assert.deepEqual(matchIntent("search google for diabetes"), {
    command: "googleSearch",
    args: { term: "diabetes" },
  });
  assert.deepEqual(matchIntent("search for MABVI"), {
    command: "googleSearch",
    args: { term: "MABVI" },
  });
  assert.deepEqual(matchIntent("google retinitis pigmentosa"), {
    command: "googleSearch",
    args: { term: "retinitis pigmentosa" },
  });
  assert.deepEqual(matchIntent("look up screen readers"), {
    command: "googleSearch",
    args: { term: "screen readers" },
  });
});

test("google search does not swallow more specific commands", () => {
  // Regression guard: a broad "search X" pattern must not steal phrases
  // that belong to earlier, more specific rules.
  assert.deepEqual(matchIntent("give me the key points"), { command: "keyPoints", args: { count: 3 } });
  assert.deepEqual(matchIntent("define osmosis"), { command: "defineWord", args: { term: "osmosis" } });
  assert.deepEqual(matchIntent("redo setup"), { command: "redoSetup", args: {} });
});

test("redo setup command", () => {
  assert.deepEqual(matchIntent("redo setup"), { command: "redoSetup", args: {} });
  assert.deepEqual(matchIntent("run setup again"), { command: "redoSetup", args: {} });
});

test("theme switching commands", () => {
  assert.deepEqual(matchIntent("dark theme"), { command: "switchTheme", args: { theme: "dark" } });
  assert.deepEqual(matchIntent("yellow background"), {
    command: "switchTheme",
    args: { theme: "yellow-black" },
  });
  assert.deepEqual(matchIntent("yellow on black"), {
    command: "switchTheme",
    args: { theme: "black-yellow" },
  });
  assert.deepEqual(matchIntent("light theme"), { command: "switchTheme", args: { theme: "light" } });
});

test("help commands — specific categories win over the generic catch-all", () => {
  assert.deepEqual(matchIntent("help with navigation"), { command: "helpNavigation", args: {} });
  assert.deepEqual(matchIntent("navigation commands"), { command: "helpNavigation", args: {} });
  assert.deepEqual(matchIntent("help with understanding"), { command: "helpUnderstanding", args: {} });
  assert.deepEqual(matchIntent("help with settings"), { command: "helpSettings", args: {} });
  assert.deepEqual(matchIntent("help"), { command: "helpOverview", args: {} });
  assert.deepEqual(matchIntent("what can I say"), { command: "helpOverview", args: {} });
  assert.deepEqual(matchIntent("what can you do"), { command: "helpOverview", args: {} });
});

test("privacy info command", () => {
  assert.deepEqual(matchIntent("privacy"), { command: "privacyInfo", args: {} });
  assert.deepEqual(matchIntent("what happens to my data"), { command: "privacyInfo", args: {} });
  assert.deepEqual(matchIntent("is my data safe"), { command: "privacyInfo", args: {} });
});

test("no match returns null", () => {
  assert.equal(matchIntent("summarize this page"), null);
  assert.equal(matchIntent("what does this say about taxes"), null);
  assert.equal(matchIntent(""), null);
  assert.equal(matchIntent(null), null);
});

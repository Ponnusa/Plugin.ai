(function beaconExtractPageText() {
  function extractWithInnerText() {
    const text = document.body ? document.body.innerText.trim() : "";
    if (!text) return null;
    return { title: document.title || "", text, source: "innerText" };
  }

  try {
    const documentClone = document.cloneNode(true);
    const article =
      typeof Readability !== "undefined"
        ? new Readability(documentClone).parse()
        : null;

    const readabilityText = article?.textContent?.trim();
    if (readabilityText) {
      return {
        title: article.title || document.title || "",
        text: readabilityText,
        source: "readability",
      };
    }

    const fallback = extractWithInnerText();
    return fallback || { error: "no_content" };
  } catch (err) {
    const fallback = extractWithInnerText();
    return fallback || { error: "no_content" };
  }
})();

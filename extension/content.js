(function beaconExtractPageText() {
  const MAX_LINKS = 10;
  const MIN_LINK_TEXT_LENGTH = 15; // skip icon-only/nav-crumb links, keep real titles

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  }

  // Extracted from the live document, not the Readability clone -- visibility
  // checks only mean anything on the actually-rendered page. Used for the
  // "list results" / "open result N" commands, e.g. picking a search result.
  function extractLinks() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const seen = new Set();
    const links = [];

    for (const a of anchors) {
      if (links.length >= MAX_LINKS) break;
      const href = a.href;
      if (!href || !/^https?:\/\//i.test(href)) continue;
      if (seen.has(href)) continue;
      if (!isVisible(a)) continue;

      const title = (a.innerText || a.textContent || "").trim().replace(/\s+/g, " ");
      if (title.length < MIN_LINK_TEXT_LENGTH) continue;

      seen.add(href);
      links.push({ title, href });
    }

    return links;
  }

  function extractWithInnerText() {
    const text = document.body ? document.body.innerText.trim() : "";
    if (!text) return null;
    return { title: document.title || "", text, source: "innerText" };
  }

  const links = extractLinks();

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
        links,
      };
    }

    const fallback = extractWithInnerText();
    return fallback ? { ...fallback, links } : { error: "no_content" };
  } catch (err) {
    const fallback = extractWithInnerText();
    return fallback ? { ...fallback, links } : { error: "no_content" };
  }
})();

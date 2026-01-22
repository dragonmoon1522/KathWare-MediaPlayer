(() => {
  const KWMP = window.KWMP;
  if (!KWMP || KWMP.platforms) return;

  KWMP.platforms = {
    getPlatform() {
      const h = location.hostname.toLowerCase();
      if (h.includes("netflix")) return "netflix";
      if (h.includes("disneyplus") || h.includes("disney")) return "disney";
      if (h.includes("hbomax") || h.includes("max.com") || h.includes("play.hbomax.com")) return "max";
      if (h.includes("youtube")) return "youtube";
      if (h.includes("primevideo") || h.includes("amazon")) return "prime";
      if (h.includes("paramountplus")) return "paramount";
      if (h.includes("flow.com.ar")) return "flow";
      return "generic";
    },
    platformLabel(p) {
      return ({
        netflix: "Netflix",
        disney: "Disney+",
        max: "Max",
        youtube: "YouTube",
        prime: "Prime Video",
        paramount: "Paramount+",
        flow: "Flow",
        generic: "Sitio"
      })[p] || "Sitio";
    },
    platformSelectors(p) {
      if (p === "flow") return [".theoplayer-ttml-texttrack-", ".theoplayer-texttracks", ".theoplayer-texttracks *"];
      if (p === "max") return ["[data-testid='cueBoxRowTextCue']", "[data-testid*='cueBoxRowTextCue']", "[class*='TextCue']"];
      if (p === "netflix") return [".player-timedtext-text-container", ".player-timedtext", "span.player-timedtext-text", "div[data-uia*='subtitle']", "div[data-uia*='captions']"];
      if (p === "disney") return ["[class*='subtitle']", "[class*='subtitles']", "[class*='caption']", "[class*='captions']", "[class*='timedText']", "[class*='timed-text']", "[data-testid*='subtitle']", "[data-testid*='caption']", "[aria-label*='Subt']", "[aria-live='polite']", "[role='status']"];
      if (p === "youtube") return [".ytp-caption-segment", ".captions-text .caption-visual-line", ".ytp-caption-window-container"];
      return [".plyr__caption", ".flirc-caption", "[class*='subtitle']", "[class*='caption']", "[class*='cc']", "[aria-live='polite']", "[role='status']"];
    }
  };
})();

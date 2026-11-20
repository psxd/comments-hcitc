// Only the editorial markup used in the published Episodes sheet is displayed.
import { loadCurrentEpisodes, episodeUtcInterval } from "../../shared/episode-feed.js?v=6";
// Parse in an inert document, then create fresh, explicitly allowed DOM nodes.
const allowed = new Set(["P", "BR", "I", "EM", "B", "STRONG"]);
const discarded = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "FORM", "INPUT", "BUTTON"]);

export function sanitizeEpisodeDescription(markup) {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const clean = document.createDocumentFragment();
  function copy(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Change editorial text only; never rewrite tag attributes or URLs.
      parent.append(document.createTextNode(node.textContent.replace(/https?:\/\/[^\s<>]+|'/g, part => part === "'" ? "’" : part)));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || discarded.has(node.tagName)) return;
    const target = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : parent;
    for (const child of node.childNodes) copy(child, target);
    if (target !== parent) parent.append(target);
  }
  for (const child of parsed.body.childNodes) copy(child, clean);
  return clean;
}

const description = document.getElementById("episodeDescription");
const query = new URLSearchParams(location.search);
const publicId = query.get("episode") || "E-001";
loadCurrentEpisodes().then(feed => {
  const episode = feed.episodes.find(row => query.has("asset") ? row.ID === query.get("asset") : row["Episode ID"] === publicId);
  if (!episode) throw new Error(`${publicId} missing from current Episodes sheet`);
  const episodeId = episode.ID;
  if (episodeId === "E-001") episodeUtcInterval(episode);
  const text = episode["Episode Description"];
  if (!text && ["E-003", "E-005", "E-006"].includes(episodeId)) { description.hidden = true; return; }
  if (!text) throw new Error("Episode description unavailable");
  description.replaceChildren(sanitizeEpisodeDescription(text));
}).catch(error => {
  description.textContent = `Current episode information unavailable: ${error.message}.`;
});

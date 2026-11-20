import { episodeChapters } from "./episode-feed.js?v=6";

const root = new URL("../", import.meta.url);
const reviewPath = asset => asset === "E-001" ? "visualization/dev/e001-review/"
  : asset === "E-002" ? "visualization/dev/e002-control-panel-preview/"
    : `visualization/Viz/compare.html?dev=1&episode=`;

function periodLabel(chapters) {
  const season = center => {
    const date = new Date(center), month = date.getUTCMonth() + 1;
    return { part: month <= 4 ? "early" : month <= 8 ? "mid" : "late", year: date.getUTCFullYear() };
  };
  const first = season(chapters[0].center), last = season(chapters.at(-1).center);
  return first.year === last.year && first.part === last.part ? `in ${first.part} ${first.year}`
    : first.year === last.year ? `from ${first.part} to ${last.part} ${first.year}`
      : `from ${first.part} ${first.year} to ${last.part} ${last.year}`;
}

export function installEpisodeNavigation(focus, episodes, assetId, { review = false, period = true } = {}) {
  if (!focus || focus.nextElementSibling?.classList.contains("episode-neighbors")) return;
  const rows = episodes.filter(row => /^(true|yes|1)$/i.test(row.Frontend || ""));
  const index = rows.findIndex(row => row.ID === assetId);
  if (index < 0 || !rows.length) return;
  const current = rows[index], chapters = episodeChapters(current);
  if (period && chapters.length && !focus.querySelector(".episode-focus-period")) {
    const label = focus.ownerDocument.createElement("span");
    label.className = "episode-focus-period"; label.textContent = periodLabel(chapters);
    focus.querySelector(".episode-focus-link")?.append(label);
  }
  const nav = focus.ownerDocument.createElement("nav"); nav.className = "episode-neighbors";
  nav.setAttribute("aria-label", "Other episodes");
  for (const [offset, direction] of [[-1, "Previous"], [1, "Next"]]) {
    const next = rows[(index + offset + rows.length) % rows.length];
    const link = focus.ownerDocument.createElement("a");
    const path = review ? reviewPath(next.ID) : next.ID === "E-001" ? "visualization/e001/" : next.ID === "E-002" ? "visualization/e002/" : "visualization/Viz/compare.html?episode=";
    link.href = new URL(path + (path.endsWith("episode=") ? encodeURIComponent(next["Episode ID"]) : ""), root).href;
    link.target = "_top";
    link.textContent = direction;
    link.setAttribute("aria-label", next["Episode Name"] ? `${direction} episode: ${next["Episode Name"]}` : `${direction} episode`);
    link.title = link.getAttribute("aria-label");
    nav.append(link);
  }
  focus.after(nav);
}

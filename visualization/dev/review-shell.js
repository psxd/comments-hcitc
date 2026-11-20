/* Shared navigation and comment presentation for the local design review. */
import { loadCurrentEpisodes } from "../../shared/episode-feed.js?v=6";
const root = new URL("../../", import.meta.url);
const surfaces = ["E-001", "E-002", "E-003", "E-005", "E-006", "E-008", "E-016", "E-059", "Library"];
const publicLabels = new Map([["E-001", "E-001"], ["E-002", "E-002"], ["E-003", "E-003"], ["E-005", "E-004"], ["E-006", "E-005"], ["E-008", "E-006"], ["E-016", "E-007"], ["E-059", "E-008"]]);

export function reviewHref(surface) {
  if (surface === "Library") return new URL("dynamic-table/", root).href;
  if (surface === "E-001") return new URL("visualization/dev/e001-review/", root).href;
  if (surface === "E-002") return new URL("visualization/dev/e002-control-panel-preview/", root).href;
  return new URL(`visualization/Viz/compare.html?dev=1&episode=${publicLabels.get(surface) || surface}`, root).href;
}

export function currentReviewSurface() {
  const path = location.pathname;
  if (path.includes("/dynamic-table/")) return "Library";
  if (path.includes("/e001-review/")) return "E-001";
  if (path.includes("/e002-control-panel-preview/")) return "E-002";
  const publicId = new URLSearchParams(location.search).get("episode") || "";
  return [...publicLabels].find(([, label]) => label === publicId)?.[0] || publicId;
}

export function renderSharedCommentList(list, comments, currentSurface) {
  list.replaceChildren(...comments.map(item => {
    const card = document.createElement("div");
    card.className = `${currentSurface.toLowerCase().replace("-", "")}-review-item`;
    const heading = document.createElement("strong");
    const publicId = publicLabels.get(item.surface) || item.surface;
    const label = item.label.replace(/^E-\d{3}\b/, publicId);
    heading.textContent = `${publicId} · ${label}${item.appliesToAllEpisodes ? " · All episodes" : ""}`;
    const body = document.createElement("p"); body.textContent = item.text;
    card.append(heading, body);
    if (item.surface !== currentSurface) {
      const jump = document.createElement("a"); jump.href = reviewHref(item.surface);
      jump.textContent = `Open ${publicId}`; card.append(jump);
    }
    return card;
  }));
  if (!comments.length) list.textContent = "No new comments yet.";
}

function updateNavigation() {
  if (location.hostname !== "127.0.0.1" && location.hostname !== "localhost") return;
  const current = currentReviewSurface();
  const signature = `${current}:${surfaces.map(surface => publicLabels.get(surface) || surface).join(",")}`;
  for (const nav of document.querySelectorAll('nav[aria-label="Local design review"]')) {
    if (nav.dataset.unifiedReview === signature) continue;
    nav.dataset.unifiedReview = signature;
    nav.classList.add("review-switcher");
    nav.replaceChildren(...surfaces.map(surface => {
      const link = document.createElement("a"); link.href = reviewHref(surface);
      link.textContent = surface === "Library" ? "Library" : publicLabels.get(surface) || surface;
      if (surface === current) link.setAttribute("aria-current", "page");
      return link;
    }));
    nav.closest("header, section")?.classList.add("review-unified-bar");
  }
}

if (location.port === "8769") {
  updateNavigation();
  new MutationObserver(updateNavigation).observe(document.documentElement, { childList: true, subtree: true });
  loadCurrentEpisodes().then(({ episodes }) => {
    for (const row of episodes) publicLabels.set(row.ID, row["Episode ID"]);
    updateNavigation();
  }).catch(error => console.warn("Current review labels unavailable", error));
}

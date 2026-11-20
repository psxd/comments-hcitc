import { loadOrbitalPreview, preloadOrbitalElements, drawOrbitalChart, resetOrbitalChartScale } from "./orbital-preview.js?v=2";
import { createGlobePreview } from "./globe-preview.js?v=6";
import { reviewHref } from "../review-shell.js?v=2";
import { loadCurrentEpisodes, episodeUtcInterval, episodeChapters } from "../../../shared/episode-feed.js?v=6";
import { safeEpisodeName, episodeNameText } from "../../../shared/episode-name.js";
import { installGlossary } from "./glossary.js";
import { createCameraWorkshop } from "./camera-workshop.js";
import { formatDwellDuration } from "../../../shared/format-duration.js";
import { installEpisodeNavigation } from "../../../shared/episode-navigation.js?v=3";

const $ = id => document.getElementById(id);
void preloadOrbitalElements().catch(() => {});
const publishedMode = document.body.classList.contains("e002-published");
const panelMount = $("panelMount");
const panelColumn = $("panelColumn");
const panelToggle = $("panelToggleBtn");
panelToggle?.addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("ui-collapsed");
  panelToggle.setAttribute("aria-expanded", String(!collapsed));
  panelToggle.setAttribute("aria-label", collapsed ? "Show control panel" : "Hide control panel");
  panelToggle.title = collapsed ? "Show control panel" : "Hide control panel";
  panelToggle.querySelector("span").textContent = collapsed ? "›" : "‹";
});
const workspace = document.querySelector(".review-workspace");
const pinLayer = $("pinLayer");
const status = $("commentStatus");
let comments = [];
let moments = [];
let savedCameraViews = [];
let draft = null;
let spotMode = false;
let selectorFrame = null;
let currentWindow = null;
let episodeConfig = null;
let catalogNames = {};
let orbitalModel = null;
let globe = null;
let playbackControl = null;
let lastSelectorContext = "";
let playbackFrame = null;
let speedIndex = 1;
const speeds = [5, 10, 20, 40, 80];
const currentPlaybackSpeed = () => speeds[Math.min(speeds.length - 1, speedIndex + (globe?.getMode() === "eci" ? 0 : 1))];
const chartScales = new Map();
const lastThresholds = { distance: 200, speed: 500 };
let lastTimeBands = "";
let minimumMarker = null;
let updateStickyPair = () => {};
let cameraWorkshop = null;
const prettyDate = value => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value)) + " UTC";
function finishEpisodeLoading() {
  const loading = $("episodeLoading");
  setTimeout(() => {
    loading.classList.add("is-leaving");
    setTimeout(() => { loading.hidden = true; }, 420);
  }, 0);
}
function showEpisodeLoadError(error) {
  $("episodeLoadingText").textContent = `Could not load episode: ${error.message}`;
  $("episodeLoading").classList.add("is-error");
}
const datePart = value => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));

function message(text, error = false) {
  status.textContent = text;
  status.style.color = error ? "#9a463a" : "#777";
}

function markAnchors(root) {
  root.querySelectorAll("[id]").forEach(element => { element.dataset.spotKey = element.id; });
  let index = 0;
  root.querySelectorAll("button,summary,a,input,canvas,.panelSection,.metricBlock,.chartGroup,.thresholdControl,.episodeHeader").forEach(element => {
    if (!element.dataset.spotKey) element.dataset.spotKey = `control-${++index}`;
  });
}

function markSelectorAnchors(doc) {
  const preview = doc.querySelector("#preview"); if (preview) preview.dataset.spotKey = "selector-area";
  doc.querySelectorAll(".segment").forEach(element => { element.dataset.spotKey = `selector-${element.dataset.slot}`; });
  const named = [[".disclose", "selector-chevron"], [".single-header", "selector-usa245"], ["#upper-details", "selector-chaser-details"], ["#lower-details", "selector-usa245-details"]];
  for (const [query, key] of named) { const element = doc.querySelector(query); if (element) element.dataset.spotKey = key; }
  const chaser = doc.querySelector(".segment.is-active .name")?.textContent || "Chaser";
  for (const details of doc.querySelectorAll(".metadata")) {
    const prefix = details.id === "upper-details" ? `selector-${chaser.replace(/\s+/g, "-").toLowerCase()}` : "selector-usa245";
    details.querySelectorAll(".metadata-section").forEach((element, index) => { element.dataset.spotKey = `${prefix}-section-${index}`; });
    details.querySelectorAll(".espl-news-external").forEach((element, index) => { element.dataset.spotKey = `${prefix}-link-${index}`; });
  }
}

function anchorFor(comment) {
  const root = comment.root === "selector" ? selectorFrame?.contentDocument : document;
  if (!root) return null;
  return [...root.querySelectorAll("[data-spot-key]")].find(element => element.dataset.spotKey === comment.key) || null;
}

function pinPoint(comment) {
  const element = anchorFor(comment);
  if (!element || !element.getClientRects().length) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const parent = workspace.getBoundingClientRect();
  const frame = comment.root === "selector" ? selectorFrame.getBoundingClientRect() : { left: 0, top: 0 };
  const viewportX = rect.left + frame.left + rect.width * comment.x;
  const viewportY = rect.top + frame.top + rect.height * comment.y;
  if (comment.root === "selector" || $("ui")?.contains(element)) {
    const visible = $("ui").getBoundingClientRect();
    if (viewportY < visible.top || viewportY > visible.bottom) return null;
  }
  return { x: viewportX - parent.left, y: viewportY - parent.top };
}

function positionPins() {
  for (const pin of pinLayer.querySelectorAll(".spot-pin")) {
    const comment = comments.find(item => item.id === pin.dataset.id);
    const point = comment && pinPoint(comment);
    pin.hidden = !point;
    if (point) { pin.style.left = `${point.x}px`; pin.style.top = `${point.y}px`; }
  }
}

function jumpTo(comment) {
  const pin = [...pinLayer.querySelectorAll(".spot-pin")].find(item => item.dataset.id === comment.id);
  if (pin?.hidden) {
    const element = anchorFor(comment);
    const target = comment.root === "selector" ? selectorFrame : element;
    if (target && (comment.root === "selector" || $("ui")?.contains(target))) {
      $("ui").scrollTop += target.getBoundingClientRect().top - $("ui").getBoundingClientRect().top - 90;
      positionPins();
    }
  }
  if (pin && !pin.hidden) {
    pin.scrollIntoView({ behavior: "smooth", block: "center" });
    pin.focus({ preventScroll: true });
  } else message("Select the relevant spacecraft or expand its disclosure to see this pin.");
}

function renderComments() {
  $("commentCount").textContent = String(comments.length);
  $("headerCommentCount").textContent = String(comments.length);
  pinLayer.replaceChildren();
  const list = $("commentList"); list.replaceChildren();
  if (!comments.length) {
    const empty = document.createElement("p"); empty.className = "comment-empty"; empty.textContent = "No comments yet. Pin the first spot in the panel."; list.append(empty);
  }
  for (const [index, comment] of comments.entries()) {
    if (comment.surface === "E-002" || comment.appliesToAllEpisodes && comment.surface !== "Library") {
      const pin = document.createElement("button"); pin.type = "button"; pin.className = "spot-pin"; pin.dataset.id = comment.id; pin.textContent = String(index + 1); pin.title = `${comment.label}: ${comment.text}`; pin.setAttribute("aria-label", `Open comment ${index + 1} on ${comment.label}`);
      pin.addEventListener("click", () => { setFeedbackOpen(true); const item = [...list.children].find(node => node.dataset.id === comment.id); item?.scrollIntoView({ behavior: "smooth", block: "nearest" }); item?.querySelector(".comment-jump")?.focus({ preventScroll: true }); });
      pinLayer.append(pin);
    }
    const item = document.createElement("article"); item.className = "comment-item"; item.dataset.id = comment.id;
    const head = document.createElement("div"); head.className = "comment-item-head";
    const jump = document.createElement("button"); jump.type = "button"; jump.className = "comment-jump"; jump.textContent = `${index + 1}. ${comment.label}`;
    jump.addEventListener("click", () => { if (comment.surface === "E-002") jumpTo(comment); else location.href = reviewHref(comment.surface); });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-comment"; remove.textContent = "Delete"; remove.setAttribute("aria-label", `Delete comment ${index + 1}`);
    remove.addEventListener("click", async () => {
      try { comments = await saveAction({ action: "delete", id: comment.id }); renderComments(); message("Comment deleted."); }
      catch (error) { message(error.message, true); }
    });
    const text = document.createElement("p"); text.textContent = comment.text;
    const scope = document.createElement("span"); scope.className = "comment-scope-badge"; scope.textContent = comment.surface === "Library" ? `Library · ${comment.appliesToAllEpisodes ? "All table episodes" : "This table spot"}` : `${comment.surface} · ${comment.appliesToAllEpisodes === true ? "All episodes" : "This view"}`;
    const time = document.createElement("time"); time.dateTime = comment.createdAt; time.textContent = new Date(comment.createdAt).toLocaleString();
    head.append(jump, remove); item.append(head, scope, text, time); list.append(item);
  }
  positionPins();
}

function renderCameraViews() {
  $("cameraViewCount").textContent = String(savedCameraViews.length);
  const host = $("cameraViewList"); host.replaceChildren();
  if (!savedCameraViews.length) {
    const empty = document.createElement("p"); empty.className = "comment-empty";
    empty.textContent = "No camera views saved yet."; host.append(empty); return;
  }
  for (const view of savedCameraViews.slice().reverse()) {
    const item = document.createElement("div"); item.className = "camera-view-item"; item.dataset.id = view.id;
    const time = new Date(view.timeUtc).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    const label = document.createElement("span"); label.textContent = `${view.windowId} · ${time} UTC · ${view.mode === "eci" ? "ECI" : view.referenceMode} · ${view.selected === "C" ? catalogNames.C : catalogNames.A}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-camera-view"; remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete saved camera view from ${time} UTC`);
    remove.addEventListener("click", async () => {
      try {
        const response = await fetch("/api/camera-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: view.id }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not delete camera view");
        savedCameraViews = payload.views; globe?.setCameraViews(savedCameraViews); renderCameraViews(); cameraWorkshop?.refresh(); message("Camera view deleted.");
      } catch (error) { message(error.message, true); }
    });
    const note = document.createElement("textarea"); note.rows = 2; note.maxLength = 4000; note.value = view.note || "";
    note.placeholder = "Comment on this camera angle"; note.setAttribute("aria-label", `Comment on camera view at ${time} UTC`);
    const saveNote = document.createElement("button"); saveNote.type = "button"; saveNote.textContent = "Save note";
    saveNote.addEventListener("click", async () => {
      try {
        const response = await fetch("/api/camera-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "annotate", id: view.id, note: note.value }) });
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not save camera note");
        savedCameraViews = payload.views; message("Camera angle comment saved.");
      } catch (error) { message(error.message, true); }
    });
    item.append(label, note, saveNote, remove);
    host.append(item);
  }
}

async function saveAction(request) {
  const response = await fetch("/api/review-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, ...(request.action === "add" ? { surface: "E-002" } : {}) }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not save comment");
  return payload.comments;
}

function spotLabel(element, root) {
  const map = {
    identity: "Satellite selector", upperDetails: "Chaser details", lowerDetails: "USA 245 details",
    rangeMetric: "Separation metric", speedMetric: "Relative velocity metric", distanceChartGroup: "Separation chart",
    speedChartGroup: "Velocity chart", thresholdControls: "How Close Is Too Close?", playbackDock: "Playback dock",
    timelineSlider: "Playback time bar", playBtn: "Play / pause", distanceThresholdSlider: "Separation threshold",
    speedThresholdSlider: "Velocity threshold", dataStatusSection: "Episode context", episodeDescription: "Episode description",
    globeStage: "3D globe", autoCamera: "Reset view", zoomInBtn: "Zoom in", zoomOutBtn: "Zoom out", modeBtn: "ECI / relative motion", projectLink: "Project link", modelCaveat: "Reconstruction note", sceneStatus: "Scene status",
  };
  if (root === "selector") {
    if (element.id === "preview") return "Satellite selector";
    if (element.matches(".segment")) return element.querySelector(".name")?.textContent || "Chaser option";
    if (element.matches(".single-header")) return "USA 245 card";
    if (element.matches(".disclose")) return "Chaser disclosure chevron";
    if (element.matches(".metadata-section")) return `${element.closest("#upper-details") ? element.ownerDocument.querySelector(".segment.is-active .name")?.textContent || "Chaser" : "USA 245"} ${element.querySelector("h4")?.textContent || "details"}`;
  }
  return map[element.id] || element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent.trim().replace(/\s+/g, " ").slice(0, 65) || "Control panel";
}

function chooseSpot(event, root) {
  if (!spotMode) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const element = event.target.closest("[data-spot-key]") || (root === "selector" ? selectorFrame.contentDocument.body : $("ui"));
  if (!element) return;
  const rect = element.getBoundingClientRect();
  draft = { root, key: element.dataset.spotKey || "ui", label: spotLabel(element, root), x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  $("draftLocation").textContent = draft.label;
  $("commentAllEpisodes").checked = false;
  setFeedbackOpen(true);
  $("commentForm").hidden = false;
  $("commentText").focus();
  message("Spot selected. Write your comment and save it.");
}

function setSpotMode(active) {
  spotMode = active; document.body.classList.toggle("spot-mode", active);
  $("commentMode").setAttribute("aria-pressed", String(active));
  $("commentMode").textContent = active ? "✓ Stop placing comments" : "✚ Add spot comment";
  selectorFrame?.contentDocument?.body.classList.toggle("spot-mode", active);
  message(active ? "Click a specific spot in the control panel." : "Comments save to this local project for the next iteration.");
}

function setFeedbackOpen(open) {
  if (open && cameraWorkshop && !$("cameraWorkshop").hidden) cameraWorkshop.close();
  $("feedbackRail").hidden = !open;
  $("feedbackToggle").setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("review-open", open);
  if (open) sessionStorage.setItem("espl-review-comments-open", "1");
  else sessionStorage.removeItem("espl-review-comments-open");
  positionPins();
}

function fitWorkspace() {
  positionPins();
}

function fitSelectorFrame() {
  if (!selectorFrame?.contentDocument) return;
  const content = selectorFrame.contentDocument.querySelector("#preview");
  selectorFrame.style.height = `${Math.max(86, Math.ceil(content?.getBoundingClientRect().height || 0))}px`;
  fitWorkspace();
  requestAnimationFrame(positionPins);
}

function wireSelectorFrame(frame) {
  selectorFrame = frame;
  frame.addEventListener("load", () => {
    lastSelectorContext = "";
    const doc = frame.contentDocument;
    const refresh = () => { markSelectorAnchors(doc); fitSelectorFrame(); positionPins(); renderOrbitalPanel(); };
    refresh();
    doc.body.classList.toggle("spot-mode", spotMode);
    doc.addEventListener("click", event => chooseSpot(event, "selector"), true);
    doc.addEventListener("click", () => requestAnimationFrame(refresh));
    new MutationObserver(refresh).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    new ResizeObserver(fitSelectorFrame).observe(doc.querySelector("#preview"));
  });
}

function drawPlaceholderChart(canvas, kind, note = "Loading verified orbital data…") {
  const context = canvas.getContext("2d");
  const width = Math.max(260, Math.round(canvas.clientWidth || 306)), height = 155;
  canvas.width = width * 2; canvas.height = height * 2; context.scale(2, 2);
  context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
  context.strokeStyle = "#eceae5"; context.lineWidth = 1;
  for (const y of [20, 48, 76, 104]) { context.beginPath(); context.moveTo(46, y); context.lineTo(296, y); context.stroke(); }
  context.fillStyle = "#aaa"; context.font = "10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  context.save(); context.translate(17, 73); context.rotate(-Math.PI / 2); context.textAlign = "center";
  context.fillText(kind === "distance" ? "Separation distance (km)" : "Relative velocity (km/s)", 0, 0); context.restore();
  context.fillStyle = "#c5c0b7"; context.textAlign = "center"; context.fillText(note, 169, 72);
  context.fillStyle = "#999"; context.font = "9px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  context.fillText("Dec 8, 10:05", 79, 136); context.fillText("11:35 UTC", 260, 136);
}

function selectedChaser() {
  return selectorFrame?.contentDocument?.querySelector(".segment.is-active")?.dataset.slot || "A";
}

const roundedFive = value => Math.round(value / 5) * 5;
function thresholdValue(id, key) {
  const raw = $(id)?.value?.trim();
  const scale = key === "speed" ? 1000 : 1;
  const step = (Number($(id)?.step) || 1) * scale;
  const parsed = Number(raw) * scale;
  if (raw && Number.isFinite(parsed) && parsed >= 0) lastThresholds[key] = Math.round(parsed / step) * step;
  return lastThresholds[key];
}
function renderTimeBands(window, slot, distance, speed, qualifications) {
  const key = `${window.id}:${slot}:${distance}:${speed}`;
  if (key === lastTimeBands) return;
  lastTimeBands = key;
  const host = $("dwellSegments");
  if (!host) return;
  host.replaceChildren();
  const start = Date.parse(window.start), span = Date.parse(window.end) - start;
  for (const [kind, intervals] of [["single", qualifications.single], ["both", qualifications.both.intervals]]) {
    for (const interval of intervals) {
      const mark = document.createElement("span"); mark.className = kind;
      mark.style.left = `${Math.max(0, (interval.start - start) / span * 100)}%`;
      mark.style.width = `${Math.max(0, (interval.end - interval.start) / span * 100)}%`;
      host.append(mark);
    }
  }
}

function renderDwellDescription(node, chaser, distance, speed) {
  const first = document.createElement("em"), target = document.createElement("em");
  const distanceValue = document.createElement("strong"), speedValue = document.createElement("strong");
  const gray = document.createElement("strong"), gold = document.createElement("strong");
  gray.className = "single"; gray.textContent = "Gray"; gold.className = "both"; gold.textContent = "gold";
  first.textContent = chaser.toUpperCase(); target.textContent = (catalogNames.B || "USA 245").toUpperCase();
  distanceValue.textContent = `${distance.toLocaleString()} km`;
  speedValue.textContent = `${(speed / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} km/s`;
  const hours = currentWindow ? (Date.parse(currentWindow.end) - Date.parse(currentWindow.start)) / 3600000 : 36;
  node.replaceChildren("The cumulative time within this ", String(hours), "-hour chapter during which ", first,
    " is within ", distanceValue, " of ", target, " with a relative velocity at or below ", speedValue,
    ". ", gray, " marks one threshold; ", gold, " marks both.");
}

function compactSpeed(metersPerSecond) {
  return metersPerSecond < 1000
    ? `${Math.round(metersPerSecond).toLocaleString("en-US")} m/s`
    : `${Math.round(metersPerSecond / 1000).toLocaleString("en-US")} km/s`;
}

function showMinimum(node, minimum, unit) {
  node.replaceChildren();
  if (!minimum) { node.textContent = "Minimum this episode: unavailable"; return; }
  const strong = document.createElement("strong");
  strong.textContent = unit === "km" ? `${roundedFive(minimum.value).toLocaleString("en-US")} km` : compactSpeed(minimum.value);
  const link = document.createElement("a"); link.href = "#"; link.textContent = datePart(minimum.ms);
  link.insertAdjacentHTML("beforeend", '<svg class="minimumCalendar" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h10v10H3zM3 6h10"/><path class="calendarPage" d="M6.1 8.4h3.8l-2.4 3.6"/></svg>');
  link.title = `Jump to ${prettyDate(minimum.ms)}`;
  link.addEventListener("click", event => {
    event.preventDefault();
    minimumMarker = { windowId: minimum.window.id, ms: minimum.ms };
    playbackControl?.goTo(minimum.window, minimum.ms, { afterMinutes: minimum.window.id === "dec30" ? 15 : 30 });
  });
  node.append("Minimum this episode: ", strong, " on ", link);
}

// A slider fires many more input events than the screen refreshes, and each panel
// redraw re-lays out the charts and reads the current slider value anyway. Coalesce
// bursts into one redraw per animation frame; the last event still wins.
let orbitalPanelFrame = null;
function scheduleOrbitalPanel() {
  if (orbitalPanelFrame !== null) return;
  orbitalPanelFrame = requestAnimationFrame(() => { orbitalPanelFrame = null; renderOrbitalPanel(); });
}

function renderOrbitalPanel() {
  if (!orbitalModel || !currentWindow || !$("ui")) return;
  const slot = selectedChaser(), chaser = catalogNames[slot] || "Cosmos 2542";
  updateStickyPair();
  const samples = orbitalModel.series(currentWindow, slot);
  const minuteMark = Number($("timelineSlider").value);
  const currentMs = Date.parse(currentWindow.start) + minuteMark * 60000;
  const selectorContext = `${currentWindow.start}|${currentWindow.end}|${currentMs}|${currentWindow.visualAgeHours || ""}`;
  if (selectorFrame?.contentWindow && selectorContext !== lastSelectorContext) {
    selectorFrame.contentWindow.postMessage({ type: "espl-e002-preview-time", start: currentWindow.start, end: currentWindow.end, currentMs, maximumDisplayAgeHours: currentWindow.visualAgeHours || episodeConfig.maximumDisplayTleAgeHours, preferredTleEpochs: currentWindow.preferredTleEpochs || {} }, location.origin);
    lastSelectorContext = selectorContext;
  }
  const current = samples[minuteMark];
  const distance = thresholdValue("distanceThresholdSlider", "distance");
  const speed = thresholdValue("speedThresholdSlider", "speed");
  const qualifications = orbitalModel.qualifications(currentWindow, slot, distance, speed);
  renderTimeBands(currentWindow, slot, distance, speed, qualifications);
  $("rangeStat").textContent = Number.isFinite(current?.distanceKm) ? `${roundedFive(current.distanceKm).toLocaleString()} km` : "—";
  $("speedStat").textContent = Number.isFinite(current?.speedMs) ? compactSpeed(current.speedMs) : "—";
  showMinimum($("distanceMinimum"), orbitalModel.minimum(slot, "distanceKm"), "km");
  showMinimum($("speedMinimum"), orbitalModel.minimum(slot, "speedMs"), "km/s");
  const markedMs = minimumMarker?.windowId === currentWindow.id ? minimumMarker.ms : null;
  const speedWindowMs = Date.parse(currentWindow.end) - Date.parse(currentWindow.start);
  const visibleSpeedMax = samples.reduce((max, sample) => sample.ms <= currentMs && sample.ms >= currentMs - speedWindowMs && Number.isFinite(sample.speedMs) ? Math.max(max, sample.speedMs) : max, 0);
  const speedUnit = Math.max(speed, visibleSpeedMax) < 1000 ? "m/s" : "km/s";
  chartScales.set("distanceChartGroup", drawOrbitalChart($("separationChart"), samples, "distanceKm", { window: currentWindow, currentMs, threshold: distance, title: "Separation distance (km)", maximum: Number($("distanceThresholdSlider").max), qualifications, markedMs }));
  chartScales.set("speedChartGroup", drawOrbitalChart($("speedChart"), samples, "speedMs", { window: currentWindow, currentMs, threshold: speed, title: `Relative velocity (${speedUnit})`, maximum: Number($("speedThresholdSlider").max) * 1000, qualifications, markedMs, speedUnit }));
  $("separationChart").setAttribute("aria-label", `${chaser} to ${catalogNames.B || "USA 245"} separation over time`);
  $("speedChart").setAttribute("aria-label", `${chaser} to ${catalogNames.B || "USA 245"} relative velocity over time`);
  $("dwellStat").textContent = qualifications.both.validSamples ? formatDwellDuration(qualifications.both.totalMs) : "—";
  $("dwellUnit").textContent = "";
  renderDwellDescription($("dwellMetric").querySelector(".dwellKey"), chaser, distance, speed);
  if (playbackFrame === null) globe?.update(currentWindow, currentMs, slot);
  for (const id of ["rangeMetric", "speedMetric", "distanceChartGroup", "speedChartGroup"]) $(id).classList.remove("preview-placeholder");
  positionPins();
}

function updateThresholds(ui) {
  const distance = thresholdValue("distanceThresholdSlider", "distance");
  const speed = thresholdValue("speedThresholdSlider", "speed");
  ui.querySelector("#thresholdSummary").textContent = `${distance} km · ${(speed / 1000).toFixed(2)} km/s`;
  resetOrbitalChartScale($("separationChart")); resetOrbitalChartScale($("speedChart"));
  scheduleOrbitalPanel();
}

function wireChartThreshold(groupId, chartId, sliderId) {
  const group = $(groupId), chart = $(chartId), slider = $(sliderId), edge = group.querySelector(".thresholdEdge");
  const change = clientY => {
    const scale = chartScales.get(groupId); if (!scale) return;
    const y = clientY - chart.getBoundingClientRect().top;
    const value = (scale.bottom - y) / (scale.bottom - scale.top) * scale.max / (groupId === "speedChartGroup" && scale.unit === "m/s" ? 1000 : 1);
    const step = Number(slider.step) || 1;
    slider.value = (Math.round(Math.max(Number(slider.min), Math.min(Number(slider.max), value)) / step) * step).toFixed(2);
    updateThresholds($("ui"));
  };
  edge.addEventListener("pointerdown", event => { edge.setPointerCapture(event.pointerId); change(event.clientY); });
  edge.addEventListener("pointermove", event => { if (edge.hasPointerCapture(event.pointerId)) change(event.clientY); });
  edge.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); slider.value = (Number(slider.value) + (event.key === "ArrowUp" ? 1 : -1) * Number(slider.step || 1)).toFixed(2); updateThresholds($("ui"));
  });
}

function wirePlayback(dock, windows) {
  const slider = dock.querySelector("#timelineSlider"), counter = dock.querySelector("#sliderNow"), play = dock.querySelector("#playBtn");
  const switcher = document.createElement("div"); switcher.id = "chapterSwitch"; switcher.className = "chapter-switch";
  switcher.setAttribute("role", "group"); switcher.setAttribute("aria-label", "Episode chapters");
  const chapterButtons = windows.map((window, index) => {
    const button = document.createElement("button"); button.type = "button"; button.dataset.chapterId = window.id;
    button.dataset.spotKey = `chapter-${window.id}`;
    button.textContent = window.chapterLabel || window.chapterShort; button.title = window.chapterTitle;
    button.addEventListener("click", () => { minimumMarker = null; void switchWindow(index); });
    switcher.append(button); return button;
  });
  dock.prepend(switcher);
  let activeIndex = 0, playbackMinute = 0, lastTick = 0, lastPaint = 0, transitioning = false;
  const overlay = $("chapterTransition"), stage = $("globeStage");
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  function updateTime() {
    const ms = Date.parse(currentWindow.start) + Number(slider.value) * 60000;
    counter.textContent = prettyDate(ms);
    counter.removeAttribute("data-full-utc"); counter.removeAttribute("tabindex"); slider.removeAttribute("title");
    scheduleOrbitalPanel();
  }
  function pause() {
    if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
    playbackFrame = null; lastTick = 0;
    play.querySelector("span").className = "playIcon"; play.setAttribute("aria-label", "Play");
  }
  function setWindow(index, ms) {
    activeIndex = index; currentWindow = windows[index]; lastTimeBands = ""; lastSelectorContext = "";
    slider.min = "0"; slider.step = "1";
    slider.max = String(Math.round((Date.parse(currentWindow.end) - Date.parse(currentWindow.start)) / 60000));
    playbackMinute = Math.max(0, Math.min(Number(slider.max), Math.round((ms - Date.parse(currentWindow.start)) / 60000)));
    slider.value = String(playbackMinute);
    for (const [buttonIndex, button] of chapterButtons.entries()) {
      button.classList.toggle("active", buttonIndex === index);
      button.setAttribute("aria-pressed", String(buttonIndex === index));
    }
    dock.dataset.chapterId = currentWindow.id;
    updateTime();
  }
  async function switchWindow(index, { autoplay = false, ms = null, preserveMarker = false } = {}) {
    if (transitioning || index < 0 || index >= windows.length) return;
    if (index === activeIndex) {
      pause(); setWindow(index, ms ?? Date.parse(windows[index].start));
      if (autoplay) startPlayback(); return;
    }
    transitioning = true; pause();
    if (!preserveMarker) minimumMarker = null;
    const from = windows[activeIndex], to = windows[index], forward = Date.parse(to.start) > Date.parse(from.start);
    $("chapterTransitionMessage").textContent = forward ? "Moving forward in time" : "Moving back in time";
    overlay.classList.remove("show-dates");
    $("chapterFromDate").textContent = from.chapterLabel || from.chapterShort;
    $("chapterToDate").textContent = to.chapterLabel || to.chapterShort;
    overlay.hidden = false; stage.dataset.chapterTransition = "fading"; stage.setAttribute("aria-busy", "true");
    await wait(500);
    overlay.classList.add("show-dates");
    await wait(1100);
    setWindow(index, ms ?? Date.parse(to.start));
    stage.dataset.chapterTransition = "revealing";
    await wait(900);
    overlay.hidden = true; overlay.classList.remove("show-dates"); stage.dataset.chapterTransition = "idle"; stage.removeAttribute("aria-busy");
    transitioning = false;
    if (autoplay) startPlayback();
  }
  slider.addEventListener("input", () => {
    minimumMarker = null; playbackMinute = Number(slider.value); pause();
    resetOrbitalChartScale($("separationChart")); resetOrbitalChartScale($("speedChart")); updateTime();
  });
  function tick(now) {
    if (playbackFrame === null) return;
    if (lastTick) playbackMinute = Math.min(Number(slider.max), playbackMinute + (now - lastTick) * currentPlaybackSpeed() / 1000);
    lastTick = now;
    globe?.update(currentWindow, Date.parse(currentWindow.start) + playbackMinute * 60000, selectedChaser());
    if (now - lastPaint >= 90 || playbackMinute >= Number(slider.max)) {
      slider.value = String(Math.floor(playbackMinute)); updateTime(); lastPaint = now;
    }
    if (playbackMinute >= Number(slider.max)) {
      pause();
      if (activeIndex + 1 < windows.length) void switchWindow(activeIndex + 1, { autoplay: true });
    } else playbackFrame = requestAnimationFrame(tick);
  }
  function startPlayback() {
    if (transitioning) return;
    if (Number(slider.value) >= Number(slider.max)) {
      if (activeIndex + 1 < windows.length) { void switchWindow(activeIndex + 1, { autoplay: true }); return; }
      setWindow(activeIndex, Date.parse(currentWindow.start));
    }
    play.querySelector("span").className = "pauseIcon"; play.setAttribute("aria-label", "Pause");
    lastTick = 0; lastPaint = 0; playbackFrame = requestAnimationFrame(tick);
  }
  play.addEventListener("click", () => { if (playbackFrame !== null) pause(); else startPlayback(); });
  dock.querySelector("#speedDownBtn").addEventListener("click", () => { speedIndex = Math.max(0, speedIndex - 1); message(`Playback: ${currentPlaybackSpeed()} simulated minutes per second in this view.`); });
  dock.querySelector("#speedUpBtn").addEventListener("click", () => { speedIndex = Math.min(speeds.length - 1, speedIndex + 1); message(`Playback: ${currentPlaybackSpeed()} simulated minutes per second in this view.`); });
  setWindow(0, Date.parse(windows[0].start));
  return {
    start: startPlayback,
    reviewPause: pause,
    async reviewWindow(window, ms) {
      const index = windows.findIndex(item => item.id === window.id);
      if (index < 0) return;
      pause();
      await switchWindow(index, { ms, preserveMarker: true });
    },
    reviewMinute(minute, paint = true) {
      if (!currentWindow) return;
      playbackMinute = Math.max(0, Math.min(Number(slider.max), minute));
      slider.value = String(Math.floor(playbackMinute));
      if (paint) updateTime();
      globe?.update(currentWindow, Date.parse(currentWindow.start) + playbackMinute * 60000, selectedChaser());
    },
    goTo(window, ms, { afterMinutes = 0 } = {}) {
      const index = windows.findIndex(item => item.id === window.id);
      if (index < 0) return;
      const target = ms + afterMinutes * 60000;
      if (index !== activeIndex) void switchWindow(index, { ms: target, preserveMarker: true });
      else { pause(); setWindow(index, target); }
    },
  };
}

async function buildPanel() {
  const [source, episode, satcat, sheet] = await Promise.all([
    fetch("../../Viz/compare.html").then(response => { if (!response.ok) throw new Error("Panel source unavailable"); return response.text(); }),
    fetch("../e002/episode.json").then(response => response.json()),
    fetch("./space-track-e002.json").then(response => { if (!response.ok) throw new Error("Space-Track catalog extract unavailable"); return response.json(); }),
    loadCurrentEpisodes(),
  ]);
  const row = sheet.episodes.find(item => item.ID === "E-002");
  if (!row) throw new Error("E-002 is missing from the published Episodes sheet");
  let interval = null;
  try { interval = episodeUtcInterval(row); } catch { /* E-002 sheet chapters are still being authored. */ }
  if (interval && !(interval.startMs <= Date.parse("2019-12-09T11:40:00Z") && interval.endExclusiveMs > Date.parse("2019-12-09T11:40:00Z"))) {
    console.warn("The current Episodes sheet interval no longer contains the local Dec 9 chapter anchor.");
  }
  const firstWindow = {
    id: "dec9", chapterShort: "Dec 9", chapterLabel: "December 9, 2019", chapterTitle: "December 9 · both Cosmos objects near USA 245", start: "2019-12-08T17:40:00Z",
    end: "2019-12-10T05:40:00Z",
    anchor: "2019-12-09T11:40:00Z", visualAgeHours: 120,
  };
  const secondWindow = {
    id: "dec30", chapterShort: "Dec 30", chapterLabel: "December 30, 2019", chapterTitle: "December 30 · Cosmos 2542 near USA 245",
    start: "2019-12-29T23:29:00Z", end: "2019-12-31T11:29:00Z",
    anchor: "2019-12-30T17:29:00Z", visualAgeHours: 120,
  };
  const sheetChapters = episodeChapters(row);
  const configuredWindows = sheetChapters.map((chapter, index) => {
    const base = [firstWindow, secondWindow][index] || {};
    const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(chapter.centerMs));
    return { ...base, id: base.id || chapter.id, chapterShort: label.replace(/,? \d{4}$/, ""), chapterLabel: label,
      chapterTitle: label, start: chapter.start, end: chapter.end, anchor: chapter.center };
  });
  episodeConfig = { ...episode, windows: configuredWindows.length ? configuredWindows : [firstWindow, secondWindow], maximumDisplayTleAgeHours: 120, maximumStatisticTleAgeHours: 120 };
  for (const participant of episode.participants) {
    const record = satcat.records?.[participant.cospar];
    if (!record || record.NORAD_CAT_ID !== participant.norad) throw new Error(`Space-Track catalog record does not match ${participant.cospar}`);
    catalogNames[participant.slot] = record.SATNAME;
  }
  const sourceDoc = new DOMParser().parseFromString(source, "text/html");
  for (const original of sourceDoc.querySelectorAll("style")) document.head.insertBefore(document.importNode(original, true), $("previewCss"));
  const ui = document.importNode(sourceDoc.querySelector("#ui"), true);
  const dock = document.importNode(sourceDoc.querySelector("#playbackDock"), true);
  if (!ui || !dock) throw new Error("Panel markup is missing");
  panelMount.replaceChildren(ui, dock);
  ui.addEventListener("scroll", () => { positionPins(); updateStickyPair(); });
  const oldBack = ui.querySelector(".backEpisodes"); oldBack?.remove();
  ui.querySelector(".episodeHeader h1").textContent = "Visualizing Proximity in the Space Domain";
  const episodeTitle = ui.querySelector("#episodeTitle");
  episodeTitle.replaceChildren(safeEpisodeName(row["Episode Name"] || "E-002"));
  document.title = (publishedMode ? "E-002 · " : "E-002 local review · ") + episodeNameText(row["Episode Name"] || "E-002");
  const focus = document.createElement("section"); focus.id = "episodeFocus"; focus.className = "episode-focus";
  const focusLink = document.createElement("a"); focusLink.href = "../../../dynamic-table/"; focusLink.className = "episode-focus-link"; focusLink.setAttribute("aria-label", "Choose a different episode");
  const focusTop = document.createElement("div"); focusTop.className = "episode-focus-top";
  const eyebrow = document.createElement("span"); eyebrow.className = "episode-eyebrow"; eyebrow.textContent = "Current episode";
  const action = document.createElement("span"); action.className = "episode-hover-action"; action.setAttribute("aria-hidden", "true");
  if (oldBack?.querySelector(".libraryBackArrow")) action.append(oldBack.querySelector(".libraryBackArrow").cloneNode(true));
  else action.textContent = "←";
  const actionText = document.createElement("span"); actionText.className = "episode-hover-text"; actionText.textContent = "Choose a different episode"; action.append(actionText);
  focusTop.append(eyebrow, action); focusLink.append(focusTop, episodeTitle); focus.append(focusLink);
  ui.querySelector(".episodeHeader h1").after(focus);
  installEpisodeNavigation(focus, sheet.episodes, "E-002", { review: !publishedMode, period: false });
  ui.querySelector("#metricArea").closest(".panelSection").classList.add("results-section");
  const description = ui.querySelector("#episodeDescription");
  const paragraph = document.createElement("p");
  paragraph.append(safeEpisodeName(row["Episode Description"] || ""));
  description.replaceChildren(paragraph);
  const identity = ui.querySelector("#identity"); identity.replaceChildren();
  const frame = document.createElement("iframe"); frame.className = "selector-frame"; frame.title = "E-002 satellite selector"; frame.src = "../satellite-legend-prototype/index.html?embed=1"; identity.append(frame); wireSelectorFrame(frame);
  ui.querySelector("#nowSummary").textContent = `${catalogNames.A} or ${catalogNames.C} · ${catalogNames.B}`;
  const sticky = document.createElement("div"); sticky.id = "pairSticky"; sticky.className = "pair-sticky"; sticky.hidden = true;
  const stickyChoices = document.createElement("span"); stickyChoices.className = "pair-sticky-choices";
  const stickyToggle = document.createElement("button"); stickyToggle.type = "button"; stickyToggle.className = "pair-sticky-toggle";
  stickyToggle.dataset.spotKey = "sticky-A"; stickyToggle.setAttribute("aria-haspopup", "true"); stickyToggle.setAttribute("aria-expanded", "false");
  stickyToggle.innerHTML = '<i></i><b></b><span class="pair-sticky-chevron" aria-hidden="true">‹</span>';
  const stickyMenu = document.createElement("span"); stickyMenu.className = "pair-sticky-menu"; stickyMenu.hidden = true;
  stickyToggle.addEventListener("click", () => {
    stickyMenu.hidden = !stickyMenu.hidden; stickyToggle.setAttribute("aria-expanded", String(!stickyMenu.hidden));
  });
  for (const slot of ["A", "C"]) {
    const button = document.createElement("button"); button.type = "button"; button.dataset.slot = slot; button.dataset.spotKey = `sticky-option-${slot}`;
    button.innerHTML = "<i></i><b></b>"; button.querySelector("b").textContent = catalogNames[slot];
    button.setAttribute("aria-label", `Select ${catalogNames[slot]}`);
    button.addEventListener("click", () => {
      stickyMenu.hidden = true; stickyToggle.setAttribute("aria-expanded", "false");
      if (selectedChaser() !== slot) selectorFrame?.contentDocument?.querySelector(`.segment[data-slot="${slot}"]`)?.click();
      requestAnimationFrame(() => { updateStickyPair(); renderOrbitalPanel(); });
    });
    stickyMenu.append(button);
  }
  stickyChoices.append(stickyToggle, stickyMenu);
  const stickyIntro = document.createElement("span"); stickyIntro.className = "pair-sticky-intro"; stickyIntro.textContent = "Current Episode:";
  sticky.append(stickyIntro, stickyChoices);
  const stickyTarget = document.createElement("span"); stickyTarget.className = "pair-sticky-target"; stickyTarget.innerHTML = "<i></i><b></b>"; stickyTarget.querySelector("b").textContent = catalogNames.B;
  sticky.append("+", stickyTarget);
  ui.prepend(sticky);
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = getComputedStyle(stickyToggle.querySelector("b")).font;
  const longestName = Math.max(...[catalogNames.A, catalogNames.C].map(name => measure.measureText(name).width));
  stickyChoices.style.width = `${Math.ceil(longestName + 45)}px`;
  let stickyStart = null;
  document.addEventListener("click", event => {
    if (!stickyChoices.contains(event.target)) { stickyMenu.hidden = true; stickyToggle.setAttribute("aria-expanded", "false"); }
  });
  stickyChoices.addEventListener("keydown", event => {
    if (event.key === "Escape") { stickyMenu.hidden = true; stickyToggle.setAttribute("aria-expanded", "false"); stickyToggle.focus(); }
  });
  updateStickyPair = () => {
    if (!sticky.isConnected) return;
    const header = selectorFrame?.contentDocument?.querySelector(".upper .card-row");
    if (header && (stickyStart === null || sticky.hidden)) {
      stickyStart = frame.getBoundingClientRect().top + header.getBoundingClientRect().top - ui.getBoundingClientRect().top + ui.scrollTop;
    }
    sticky.hidden = stickyStart === null || ui.scrollTop < stickyStart + 1;
    if (sticky.hidden) { stickyMenu.hidden = true; stickyToggle.setAttribute("aria-expanded", "false"); }
    const selected = selectedChaser();
    stickyToggle.querySelector("b").textContent = catalogNames[selected];
    stickyToggle.setAttribute("aria-label", `Selected ${catalogNames[selected]}. Choose another chaser satellite`);
    for (const button of stickyMenu.querySelectorAll("button")) {
      const active = button.dataset.slot === selectedChaser();
      button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active));
    }
  };
  ui.addEventListener("scroll", updateStickyPair);
  ui.querySelector("#dataStatusSection").remove();
  for (const id of ["rangeMetric", "speedMetric", "distanceChartGroup", "speedChartGroup"]) ui.querySelector(`#${id}`).classList.add("preview-placeholder");
  ui.querySelector("#rangeStat").textContent = "—"; ui.querySelector("#speedStat").textContent = "—";
  ui.querySelector("#rangeMetric .statLabel").textContent = "Separation distance";
  ui.querySelector("#speedMetric .statLabel").textContent = "Relative velocity";
  ui.querySelector("#distanceMinimum").textContent = "Minimum this episode: [N] km on [Date]";
  ui.querySelector("#speedMinimum").textContent = "Minimum this episode: [N] km/s on [Date]";
  ui.querySelector("#thresholdRangeNote").remove();
  for (const [id, step, unit, maximum] of [["distanceThresholdSlider", 5, "km", 50000], ["speedThresholdSlider", .05, "km/s", 20]]) {
    const input = ui.querySelector(`#${id}`);
    input.type = "number"; input.step = String(step); input.max = String(maximum); input.inputMode = "numeric";
    input.value = id === "speedThresholdSlider" ? "0.50" : "200.00";
    const output = ui.querySelector(`#${id.replace("Slider", "Output")}`);
    output?.remove();
    const wrap = document.createElement("span"); wrap.className = "threshold-input-wrap";
    const suffix = document.createElement("span"); suffix.textContent = unit;
    input.replaceWith(wrap); wrap.append(input, suffix);
    input.addEventListener("input", () => updateThresholds(ui));
    input.addEventListener("change", () => {
      const key = id.startsWith("distance") ? "distance" : "speed";
      input.value = (thresholdValue(id, key) / (key === "speed" ? 1000 : 1)).toFixed(2); updateThresholds(ui);
    });
  }
  const thresholdHint = document.createElement("p"); thresholdHint.className = "threshold-chart-hint";
  thresholdHint.textContent = "Select threshold values by clicking and dragging the labels on the charts above or typing in values in the boxes below.";
  ui.querySelector("#thresholdControls>summary>span").textContent = "How close is too close?";
  ui.querySelector("#thresholdControls .thresholdBody").prepend(thresholdHint);
  ui.querySelector("#dwellStat").textContent = "—"; ui.querySelector("#dwellUnit").textContent = "";
  ui.querySelector("#dwellLabel").textContent = "Dwell time";
  renderDwellDescription(ui.querySelector("#dwellMetric .dwellKey"), catalogNames.A, 200, 500);
  for (const [id, kind] of [["separationChart", "distance"], ["speedChart", "speed"]]) drawPlaceholderChart(ui.querySelector(`#${id}`), kind);
  wireChartThreshold("distanceChartGroup", "separationChart", "distanceThresholdSlider");
  wireChartThreshold("speedChartGroup", "speedChart", "speedThresholdSlider");
  updateThresholds(ui); playbackControl = wirePlayback(dock, episodeConfig.windows);
  installGlossary(ui, frame);
  markAnchors(panelMount);
  panelMount.addEventListener("click", event => chooseSpot(event, "panel"), true);
  panelMount.addEventListener("click", () => setTimeout(positionPins, 50));
  new ResizeObserver(fitWorkspace).observe(panelMount);
}

$("commentMode").addEventListener("click", () => setSpotMode(!spotMode));
$("feedbackToggle").addEventListener("click", () => setFeedbackOpen($("feedbackRail").hidden));
$("globeStage").addEventListener("pointerdown", event => chooseSpot(event, "panel"), true);
$("cancelComment").addEventListener("click", () => { draft = null; $("commentForm").hidden = true; $("commentText").value = ""; $("commentAllEpisodes").checked = false; });
$("commentForm").addEventListener("submit", async event => {
  event.preventDefault(); if (!draft) return;
  const text = $("commentText").value.trim(); if (!text) return;
  try {
    comments = await saveAction({ action: "add", ...draft, text, appliesToAllEpisodes: $("commentAllEpisodes").checked });
    draft = null; $("commentForm").hidden = true; $("commentText").value = ""; $("commentAllEpisodes").checked = false;
    renderComments(); message("Comment saved locally. I can read it during the next iteration.");
  } catch (error) { message(error.message, true); }
});
$("copyComments").addEventListener("click", async () => {
  const markdown = comments.map((item, index) => `${index + 1}. **${item.surface} · ${item.label}** (${item.root}, ${item.key}; ${item.appliesToAllEpisodes === true ? "all episodes" : "this view"}): ${item.text}`).join("\n\n") || "No review comments yet.";
  try { await navigator.clipboard.writeText(markdown); message("Feedback copied. Paste it into this conversation whenever you want."); }
  catch { message("Clipboard unavailable. Use Download JSON instead.", true); }
});
$("downloadComments").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ schema: "espl-shared-review-v1", comments }, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "review-comments.json"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
async function saveCurrentCameraView(openFeedback = true) {
  const view = globe?.captureCameraView();
  if (!view) { message("The camera is still loading; try again in a moment.", true); return false; }
  view.note = $("workshopCameraNote").value.trim();
  try {
    const response = await fetch("/api/camera-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", view }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not save camera view");
    savedCameraViews = payload.views; globe?.setCameraViews(savedCameraViews); renderCameraViews(); cameraWorkshop?.refresh();
    $("workshopCameraNote").value = "";
    if (openFeedback && $("cameraWorkshop").hidden) setFeedbackOpen(true);
    message("Camera view saved locally. Its exact angle and time are in saved-camera-views.json.");
    return true;
  } catch (error) { message(error.message, true); return false; }
}
$("saveCameraBtn").addEventListener("click", () => void saveCurrentCameraView(true));
$("downloadCameraViews").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ schema: "espl-e002-camera-views-v1", views: savedCameraViews }, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "e002-saved-camera-views.json"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
$("exportCameraViews")?.addEventListener("click", () => $("downloadCameraViews")?.click());
window.addEventListener("resize", positionPins);
panelColumn.addEventListener("scroll", positionPins);
try {
  await buildPanel();
  if (publishedMode) {
    const response = await fetch("./saved-camera-views.json");
    if (!response.ok) throw new Error("Saved E-002 camera path unavailable");
    savedCameraViews = (await response.json()).views || [];
  } else {
    const [response, cameraResponse, momentResponse] = await Promise.all([fetch("/api/review-comments"), fetch("/api/camera-views"), fetch("/api/camera-moments")]);
    if (!response.ok) throw new Error("Saved comments unavailable");
    comments = (await response.json()).comments;
    if (cameraResponse.ok) savedCameraViews = (await cameraResponse.json()).views;
    if (momentResponse.ok) moments = (await momentResponse.json()).moments.filter(item => item.surface === "E-002");
  }
  renderComments(); renderCameraViews();
  if (!publishedMode && comments.length && sessionStorage.getItem("espl-review-comments-open") === "1") setFeedbackOpen(true);
  else if (!publishedMode && !comments.length) sessionStorage.removeItem("espl-review-comments-open");
  loadOrbitalPreview(episodeConfig).then(model => {
    orbitalModel = model;
    try {
      globe = createGlobePreview(model, episodeConfig, catalogNames, savedCameraViews);
      $("cameraControls").hidden = false;
    }
    catch (error) { console.error(error); $("sceneStatus").textContent = `3D globe unavailable in this browser: ${error.message}`; showEpisodeLoadError(error); }
    renderOrbitalPanel();
    if (globe) playbackControl?.start();
    if (globe) finishEpisodeLoading();
    if (globe && !publishedMode) cameraWorkshop = createCameraWorkshop({
      windows: episodeConfig.windows, names: catalogNames,
      reviewRoutes: episodeConfig.windows.flatMap(window => ["A", "C"].flatMap(slot => window.id === "dec30" && slot === "C" ? [] : ["target", "chaser"].map(reference => ({ window, slot, reference, viewMode: "relative" })))),
      storageKey: "espl-e002-camera-workshop-v3",
      getMoments: () => moments,
      addMoment: async moment => { const response = await fetch("/api/camera-moments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", moment: { ...moment, surface: "E-002" } }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not save moment"); moments = payload.moments.filter(item => item.surface === "E-002"); return moments; },
      deleteMoment: async id => { const response = await fetch("/api/camera-moments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not remove moment"); moments = payload.moments.filter(item => item.surface === "E-002"); return moments; },
      motionPreview: (route, minute, spanMinutes) => globe?.motionPreview(route.window, Date.parse(route.window.start) + minute * 60000, route.slot, spanMinutes),
      beforeOpen: () => setFeedbackOpen(false),
      getViews: () => savedCameraViews,
      getMode: () => globe.getMode(),
      getPlaybackSpeed: currentPlaybackSpeed,
      saveView: saveCurrentCameraView,
      async saveSpeedNote({ route, minute, mode, speed }) {
        const timestamp = new Date(Date.parse(route.window.start) + minute * 60000).toISOString();
        const reference = route.reference === "target" ? catalogNames.B : catalogNames[route.slot];
        try {
          comments = await saveAction({
            action: "add", root: "panel", key: "cameraWorkshop", x: .5, y: .5,
            label: `Playback speed · ${route.window.chapterShort} · ${catalogNames[route.slot]} · ${reference} centered`,
            text: `At ${timestamp}, in ${mode.toUpperCase()} view, prefer ${speed} simulated minutes per second.`,
          });
          renderComments(); message("Speed note saved with the local spot comments."); return true;
        } catch (error) { message(error.message, true); return false; }
      },
      pausePlayback: () => playbackControl?.reviewPause(),
      setMinute: (minute, paint) => playbackControl?.reviewMinute(minute, paint),
      useLearnedPath: () => globe?.useLearnedPath(),
      async seekRoute(route, minute) {
        const ms = Date.parse(route.window.start) + minute * 60000;
        await playbackControl.reviewWindow(route.window, ms);
        const stage = $("globeStage");
        if (selectedChaser() !== route.slot) {
          const option = selectorFrame?.contentDocument?.querySelector(`.segment[data-slot="${route.slot}"]`);
          if (!option) throw new Error("Satellite selector is still loading");
          option.click();
        }
        globe.update(currentWindow, ms, route.slot);
        if (globe.getMode() === "eci") $("modeBtn").click();
        if (stage.dataset.referenceMode !== route.reference) $("referenceBtn").click();
        playbackControl.reviewMinute(minute, true);
        globe.useLearnedPath();
      },
    });
    $("previewCaveat").textContent = "This local globe and panel use the Space-Track SATCAT export and checksum-verified historical elements. Episode dates and text come from the published Episodes sheet. Playback chooses the nearest available element at each time; the sparse USA 245 observations limit precision.";
  }).catch(error => {
    console.error(error);
    showEpisodeLoadError(error);
    for (const [id, kind] of [["separationChart", "distance"], ["speedChart", "speed"]]) drawPlaceholderChart($(id), kind, "Verified orbital data unavailable");
    $("previewCaveat").textContent = `Orbital data unavailable: ${error.message}`;
  });
} catch (error) {
  console.error(error); message(error.message, true);
  showEpisodeLoadError(error);
  if (!$("ui")) {
    const notice = document.createElement("p"); notice.className = "loading";
    notice.textContent = `Control-panel preview unavailable: ${error.message}`;
    panelMount.replaceChildren(notice);
  }
}

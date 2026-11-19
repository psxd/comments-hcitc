const $ = id => document.getElementById(id);
const e005Frame = $("e005Frame"), e002Frame = $("e002Frame"), drawer = $("commentDrawer");
let comments = [], spotMode = false, draft = null;

function addFrameStyles(doc, includePreview = false) {
  if (includePreview) {
    const reference = doc.createElement("link"); reference.rel = "stylesheet";
    reference.href = new URL("../e002-control-panel-preview/preview.css", location.href).href;
    doc.head.append(reference);
  }
  const link = doc.createElement("link"); link.rel = "stylesheet";
  link.href = new URL("./frame.css", location.href).href; doc.head.append(link);
}

function prepareE005(doc) {
  if (!doc.body.classList.contains("e005-shared") || !doc.querySelector(".e005-chaser")) return false;
  if (doc.body.dataset.panelPrepared) return true;
  doc.body.dataset.panelPrepared = "true";
  doc.body.classList.add("e002-shared");
  addFrameStyles(doc, true);
  const ui = doc.getElementById("ui"), header = ui.querySelector(".episodeHeader");
  const oldBack = header.querySelector(".backEpisodes"), title = header.querySelector("#episodeTitle");
  if (oldBack && !header.querySelector("#episodeFocus")) {
    const focus = doc.createElement("section"); focus.className = "episode-focus"; focus.id = "episodeFocus";
    const link = doc.createElement("a"); link.className = "episode-focus-link";
    link.href = new URL("../../../dynamic-table/", location.href).href;
    link.setAttribute("aria-label", "Choose a different episode");
    const top = doc.createElement("div"); top.className = "episode-focus-top";
    const eyebrow = doc.createElement("span"); eyebrow.className = "episode-eyebrow"; eyebrow.textContent = "Current episode";
    const action = doc.createElement("span"); action.className = "episode-hover-action"; action.setAttribute("aria-hidden", "true");
    action.append(oldBack.querySelector(".libraryBackArrow").cloneNode(true), doc.createTextNode("Choose a different episode"));
    top.append(eyebrow, action); link.append(top, title); focus.append(link);
    oldBack.remove(); header.querySelector("h1").after(focus);
  }
  const identity = doc.getElementById("identity"), usa = identity.querySelector('.satCard[data-slot="A"]'), selector = identity.querySelector(".e005-chaser");
  identity.prepend(usa); usa.after(selector);
  selector.setAttribute("aria-label", "Select a Chinese target satellite");
  selector.querySelector(".e005-chaser-options").setAttribute("aria-label", "Choose a target spacecraft");
  const names = [...selector.querySelectorAll("button[data-slot] span")].map(node => node.textContent);
  ui.querySelector("#nowSummary").textContent = `${usa.querySelector(".satName").textContent} · ${names.join(" or ")}`;
  ui.querySelector("#metricArea").closest(".panelSection").classList.add("results-section");
  ui.querySelector("#rangeMetric .statLabel").textContent = "Separation distance";
  ui.querySelector("#speedMetric .statLabel").textContent = "Relative velocity";
  ui.querySelector("#dwellMetric").hidden = false;
  const coverage = ui.querySelector(".e002-coverage"); if (coverage) coverage.hidden = true;
  if (doc.querySelectorAll(".e005-chapters button").length === 1) doc.querySelector(".e005-chapters").hidden = true;
  prepareThresholds(doc);
  doc.addEventListener("click", chooseSpot, true);
  doc.addEventListener("scroll", placePins, { passive: true });
  new ResizeObserver(placePins).observe(ui);
  placePins();
  return true;
}

function prepareThresholds(doc) {
  if (doc.querySelector("#distanceThresholdSlider")?.parentElement?.classList.contains("threshold-input-wrap")) return;
  const heading = doc.querySelector("#thresholdControls>summary>span");
  if (heading) heading.textContent = "How close is too close?";
  const body = doc.querySelector("#thresholdControls .thresholdBody");
  const hint = doc.createElement("p"); hint.className = "threshold-chart-hint";
  hint.textContent = "Select threshold values by dragging the labels on the charts or typing in the boxes below.";
  body.prepend(hint);
  for (const [id, unit, step, max, value] of [["distanceThresholdSlider", "km", 5, 50000, 200], ["speedThresholdSlider", "km/s", .05, 20, .5]]) {
    const input = doc.getElementById(id), output = doc.getElementById(id.replace("Slider", "Output"));
    input.type = "number"; input.min = "0"; input.max = String(max); input.step = String(step); input.value = String(value);
    const wrap = doc.createElement("span"); wrap.className = "threshold-input-wrap";
    const suffix = doc.createElement("span"); suffix.textContent = unit;
    input.replaceWith(wrap); wrap.append(input, suffix); output?.remove();
  }
}

function prepareE002(doc) {
  if (!doc.querySelector("#panelMount #ui")) return false;
  if (doc.body.dataset.panelPrepared) return true;
  doc.body.dataset.panelPrepared = "true";
  addFrameStyles(doc);
  return true;
}

function awaitPanel(frame, prepare) {
  const attempt = () => {
    let ready = false;
    try { ready = prepare(frame.contentDocument); } catch (error) { console.warn("Panel review setup", error); }
    if (!ready) setTimeout(attempt, 200);
  };
  frame.addEventListener("load", attempt); if (frame.contentDocument?.readyState === "complete") attempt();
}
awaitPanel(e005Frame, prepareE005); awaitPanel(e002Frame, prepareE002);

function spotAnchor(target) {
  return target.closest("[data-spot-key],#episodeFocus,#nowModeling,#identity,.e005-chaser,.satCard,#rangeMetric,#speedMetric,#distanceChartGroup,#speedChartGroup,#thresholdControls,#playbackDock,#playBtn,#timelineSlider") || target.closest("[id]") || target.ownerDocument.getElementById("ui");
}

function chooseSpot(event) {
  if (!spotMode) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const anchor = spotAnchor(event.target), rect = anchor.getBoundingClientRect();
  const key = anchor.id || anchor.dataset.spotKey || anchor.classList[0] || "panel";
  draft = { action: "add", surface: "E-005", root: "panel", key, label: key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("-", " "),
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  $("commentLocation").textContent = draft.label; $("commentText").value = ""; $("commentAllEpisodes").checked = false;
  $("commentForm").hidden = false; drawer.hidden = false; $("showComments").setAttribute("aria-expanded", "true");
  $("commentText").focus(); setSpotMode(false);
}

function setSpotMode(on) {
  spotMode = on; $("spotMode").setAttribute("aria-pressed", String(on));
  $("spotMode").textContent = on ? "Cancel spot comment" : "✚ Spot comment";
  $("commentStatus").textContent = on ? "Click a specific place in the E-005 panel." : "Click “Spot comment,” then click a place in the E-005 panel.";
  try { e005Frame.contentDocument.body.style.cursor = on ? "crosshair" : ""; } catch { /* panel still loading */ }
}

async function refreshComments() {
  const response = await fetch("/api/review-comments", { cache: "no-store" });
  if (!response.ok) throw new Error(`Comments returned ${response.status}`);
  const payload = await response.json(); comments = (payload.comments || []).filter(item => item.surface === "E-005");
  $("commentCount").textContent = String(comments.length);
  const list = $("commentList"); list.replaceChildren();
  if (!comments.length) list.textContent = "No E-005 comments yet.";
  for (const [index, item] of comments.entries()) {
    const card = document.createElement("div"); card.className = "comment-item";
    const title = document.createElement("strong"); title.textContent = `${index + 1}. ${item.label}${item.appliesToAllEpisodes ? " · All episodes" : ""}`;
    const text = document.createElement("p"); text.textContent = item.text;
    card.append(title, text); list.append(card);
  }
  placePins();
}

function placePins() {
  const layer = $("pinLayer"), doc = e005Frame.contentDocument;
  if (!doc?.body?.dataset.panelPrepared) return;
  layer.replaceChildren();
  for (const [index, item] of comments.entries()) {
    const anchor = doc.getElementById(item.key) || doc.querySelector(`.${CSS.escape(item.key)}`);
    if (!anchor) continue;
    const rect = anchor.getBoundingClientRect();
    const x = rect.left + rect.width * item.x, y = rect.top + rect.height * item.y;
    if (x < 0 || y < 0 || x > e005Frame.clientWidth || y > e005Frame.clientHeight) continue;
    const pin = document.createElement("button"); pin.type = "button"; pin.className = "spot-pin"; pin.textContent = String(index + 1);
    pin.title = `${item.label}: ${item.text}`; pin.style.left = `${x}px`; pin.style.top = `${y}px`;
    pin.addEventListener("click", () => { drawer.hidden = false; $("showComments").setAttribute("aria-expanded", "true"); });
    layer.append(pin);
  }
}

$("spotMode").addEventListener("click", () => setSpotMode(!spotMode));
$("showComments").addEventListener("click", () => { drawer.hidden = !drawer.hidden; $("showComments").setAttribute("aria-expanded", String(!drawer.hidden)); });
$("closeComments").addEventListener("click", () => { drawer.hidden = true; $("showComments").setAttribute("aria-expanded", "false"); });
$("cancelComment").addEventListener("click", () => { draft = null; $("commentForm").hidden = true; });
$("commentForm").addEventListener("submit", async event => {
  event.preventDefault(); if (!draft) return;
  try {
    const response = await fetch("/api/review-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, text: $("commentText").value.trim(), appliesToAllEpisodes: $("commentAllEpisodes").checked }) });
    if (!response.ok) throw new Error((await response.json()).error || `Comment save returned ${response.status}`);
    draft = null; $("commentForm").hidden = true; $("commentStatus").textContent = "Comment saved locally."; await refreshComments();
  } catch (error) { $("commentStatus").textContent = error.message; }
});
$("exportComments").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: "espl-shared-review-v1", comments }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "e005-control-panel-comments.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
refreshComments().catch(error => { $("commentStatus").textContent = `Comments unavailable: ${error.message}`; });
window.addEventListener("resize", placePins);

/* E-002 uses the established episode shell. Each chapter fixes one dated
   element per spacecraft; charts use the stricter statistical age gate. */
import { spaceTrackHistoryUrl } from "../../shared/tle-provenance.js?v=2";
import { loadCurrentEpisodes, plottedObjects } from "../../shared/episode-feed.js?v=4";
import { safeEpisodeName } from "../../shared/episode-name.js";
import { renderEstimatedMinimum } from "./estimate-ui.js";
import { updatePlaybackCounter, wireSpeedButtons, wireTimelineHover } from "./playback-shared.js";
import { CHART_PADDING, CHART_COLOR } from "./chart-style.js";
import { formatDwellDuration } from "../../shared/format-duration.js";

const $ = id => document.getElementById(id);
const episode = await fetch(new URL("../dev/e002/episode.json", import.meta.url)).then(response => response.json());
const sheet = await loadCurrentEpisodes().catch(error => {
  const notice = $("dataStatusSection"); notice.hidden = false;
  notice.textContent = `Current E-002 spacecraft selection unavailable: ${error.message}`;
  throw error;
});
const published = sheet.episodes.find(row => row.ID === episode.episodeId && /^(true|yes|1)$/i.test(row.Frontend || ""));
if (!published) throw new Error("E-002 is absent from the published Episodes sheet");
const plotted = plottedObjects(published);
const participants = plotted.map(({ slot, cospar }) => {
  const item = episode.participants.find(candidate => candidate.slot === slot && candidate.cospar === cospar);
  if (!item) throw new Error(`No reviewed data match published object ${slot}: ${cospar}`);
  return item;
});
if (!participants.some(item => item.slot === "B") || !participants.some(item => item.slot === "A")) throw new Error("E-002 requires Kosmos 2542 and USA 245 for this comparison");
const names = Object.fromEntries(participants.map(item => [item.slot, item.name]));
const cospar = Object.fromEntries(participants.map(item => [item.slot, item.cospar]));
const norad = Object.fromEntries(participants.map(item => [item.slot, item.norad]));
const comparisons = participants.filter(item => item.slot !== "B").map(item => ({ slots: [item.slot, "B"], color: item.slot === "A" ? "#eaaa00" : "#707070", short: `${item.name} / USA 245` }));
let series = [], lastWindow = "";
const chartScales = new Map();
const icon = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M7.25 4.25H4.5A1.75 1.75 0 0 0 2.75 6v7.5a1.75 1.75 0 0 0 1.75 1.75H12a1.75 1.75 0 0 0 1.75-1.75v-2.75"/><path d="M9.25 2.75h6v6M8 10l7.25-7.25"/></svg>';
const formatTime = ms => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(ms)) + " UTC";
const signedAge = ms => { const hours = Math.floor(Math.abs(ms) / 3600000); return `${hours === 0 ? "" : ms < 0 ? "−" : "+"}${hours} ${hours === 1 ? "hour" : "hours"}`; };
const sourceLabel = tle => tle?.source === "space-track" ? "Space-Track.org" : tle?.source === "seesat" ? "SeeSat-L" : tle ? "Source unverified" : "No nearby element";

document.body.classList.add("e002-shared");
document.body.classList.toggle("e002-multi-pair", comparisons.length > 1);
document.head.insertAdjacentHTML("beforeend", '<link rel="stylesheet" href="episode-e002.css?v=6">');
const scene = document.createElement("div"); scene.id = "scene"; document.body.prepend(scene);
const labels = document.createElement("div"); labels.id = "satelliteScreenLabels"; document.body.append(labels);
const scaffold = document.createElement("div"); scaffold.className = "e002-player-scaffold";
for (const id of ["play", "timeline", "frameMode", "autoFrame", "timestamp", "startLabel", "endLabel", "coverageRows"]) {
  const element = document.createElement(["play", "frameMode", "autoFrame"].includes(id) ? "button" : id === "timeline" ? "input" : "div");
  element.id = id; if (id === "timeline") element.type = "range"; scaffold.append(element);
}
document.body.append(scaffold);
const status = document.createElement("div"); status.id = "sceneStatus"; status.className = "e002-scene-status"; status.textContent = "Loading E-002 dated elements…"; document.body.append(status);
const note = $("dataStatusSection"); note.hidden = false; note.replaceChildren();
const context = document.createElement("p"); context.className = "e002-story-note";
const coverage = document.createElement("details"); coverage.className = "e002-coverage";
const coverageSummary = document.createElement("summary"); coverageSummary.textContent = "Reconstruction coverage";
const coverageBody = document.createElement("p"); coverageBody.className = "methodNote";
coverage.append(coverageSummary, coverageBody); note.append(context, coverage);
$("episodeTitle").replaceChildren(safeEpisodeName(published["Episode Name"]));
$("separationTitle").textContent = "Kosmos 2542 relative to USA 245";
$("separationTitle").hidden = true;
$("thresholdRangeNote").textContent = "Statistics use one-minute samples within 12 hours of both selected TLE epochs.";
$("dwellLabel").textContent = "Dwell Time";

const chapterNav = document.createElement("div"); chapterNav.className = "e002-chapters";
const chapterGroup = document.createElement("div"); chapterGroup.className = "e002-segmented"; chapterGroup.setAttribute("role", "group"); chapterGroup.setAttribute("aria-label", "Historical chapters");
const chapterButtons = new Map();
for (const window of [...episode.windows].filter(item => item.id !== "jan24").sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
  const button = document.createElement("button"); button.type = "button"; button.textContent = formatTime(Date.parse(window.start)).split(",")[0]; button.title = `${window.chapterTitle} · ${formatTime(Date.parse(window.start))}–${formatTime(Date.parse(window.end))}`;
  button.setAttribute("aria-label", `Chapter: ${window.chapterTitle}`); button.dataset.window = window.id;
  chapterGroup.append(button); chapterButtons.set(window.id, button);
}
chapterNav.append(chapterGroup); $("playbackDock").prepend(chapterNav);

for (const slot of participants.map(item => item.slot)) {
  const card = document.createElement("details"); card.className = "satCard"; card.dataset.slot = slot; card.dataset.cospar = cospar[slot];
  const summary = document.createElement("summary"); summary.className = "satCardName";
  const dot = document.createElement("span"); dot.className = `sourceDot slot${slot}`;
  const name = document.createElement("span"); name.className = "satName"; name.textContent = names[slot];
  const source = document.createElement("span"); source.className = "sourceSummary"; source.textContent = "Loading"; source.insertAdjacentHTML("beforeend", icon);
  const chevron = document.createElement("span"); chevron.className = "satChevron"; chevron.setAttribute("aria-hidden", "true"); chevron.innerHTML = '<span class="disclosureGlyph">‹</span>';
  summary.append(dot, name, source, chevron);
  const metadata = document.createElement("div"); metadata.className = "satMetaDetails";
  card.append(summary, metadata); $("identity").append(card);
}
$("nowSummary").textContent = `${participants.length} spacecraft`;

for (const groupId of ["distanceChartGroup", "speedChartGroup"]) {
  const group = $(groupId), legend = document.createElement("div"); legend.className = "e002-chart-legend";
  for (const comparison of comparisons) {
    const item = document.createElement("span"), swatch = document.createElement("i"); swatch.style.background = comparison.color;
    item.append(swatch, document.createTextNode(comparison.short)); legend.append(item);
  }
  if (comparisons.length > 1) group.prepend(legend);
  const overflow = document.createElement("div"); overflow.className = "e002-chart-overflow"; group.append(overflow);
}
$("separationChart").setAttribute("aria-label", "Kosmos 2542 to USA 245 separation; gaps indicate unsupported samples");
$("speedChart").setAttribute("aria-label", "Kosmos 2542 to USA 245 relative speed; gaps indicate unsupported samples");

const { episodeModel: model } = await import("../dev/e002/player.js?v=16");
function validSample(comparison, ms) {
  if (comparison.slots.some(slot => !model.selected[slot] || Math.abs(ms - Date.parse(model.selected[slot].epoch)) > episode.maximumStatisticTleAgeHours * 3600000)) return null;
  return model.samplePair(...comparison.slots, ms);
}
function updateCards() {
  for (const slot of participants.map(item => item.slot)) {
    const card = $("identity").querySelector(`[data-slot="${slot}"]`), tle = model.selected[slot];
    const previousEpoch = card.dataset.epoch, previousSource = card.dataset.sourceData;
    card.dataset.norad = norad[slot]; card.dataset.epoch = tle?.epoch || "";
    card.dataset.tleAge = tle ? signedAge(model.current - Date.parse(tle.epoch)) : "Unavailable";
    card.dataset.tleLine2 = tle?.line2 || "";
    card.dataset.sourceData = sourceLabel(tle);
    card.dataset.sourceQueryHref = tle?.source === "space-track" ? spaceTrackHistoryUrl(norad[slot], tle.epoch) : "";
    card.dataset.sourceHref = tle?.sourceUrl || "";
    card.dataset.sourceLinkTitle = tle?.source === "seesat" ? "Published project copy of this SeeSat-L element; the original observer message has not been matched." : "";
    const summary = card.querySelector(".sourceSummary");
    if (summary.firstChild?.textContent !== card.dataset.sourceData) summary.firstChild.textContent = card.dataset.sourceData;
    if (previousEpoch !== card.dataset.epoch || previousSource !== card.dataset.sourceData) card.dispatchEvent(new Event("tlechange", { bubbles: true }));
    const age = card.querySelector(".tleAgeValue"); if (age && age.textContent !== card.dataset.tleAge) age.textContent = card.dataset.tleAge;
  }
}
function minimumNote(id, key, unit, metric) {
  const node = $(id); node.replaceChildren();
  for (const comparison of comparisons) {
    const values = series.filter(item => Number.isFinite(item[comparison.slots[0]]?.[key]));
    const line = comparisons.length === 1 ? node : document.createElement("div"); line.className = comparisons.length === 1 ? "minimumNote" : "e002-minimum-line";
    const minimum = values.length ? values.reduce((best, item) => item[comparison.slots[0]][key] < best[comparison.slots[0]][key] ? item : best) : null;
    renderEstimatedMinimum(line, { episodeId: "E-002", metric, value: minimum?.[comparison.slots[0]][key], unit, ms: minimum?.ms, onJump: ms => model.setTime(ms) });
    if (line !== node) node.append(line);
  }
}
function buildSeries() {
  const start = Date.parse(model.window.start), end = Date.parse(model.window.end);
  series = [];
  for (let ms = start; ms <= end; ms += 60000) series.push({ ms, ...Object.fromEntries(comparisons.map(comparison => [comparison.slots[0], validSample(comparison, ms)])) });
  if (series.at(-1).ms !== end) series.push({ ms: end, ...Object.fromEntries(comparisons.map(comparison => [comparison.slots[0], validSample(comparison, end)])) });
  for (const [key, sliderId] of [["distanceKm", "distanceThresholdSlider"], ["speedMs", "speedThresholdSlider"]]) {
    const values = series.flatMap(sample => comparisons.map(comparison => sample[comparison.slots[0]]?.[key])).filter(Number.isFinite);
    if (values.length) $(sliderId).max = String(Math.max(Number($(sliderId).max), Math.ceil(Math.max(...values) * 1.25 / 1000) * 1000));
  }
  minimumNote("distanceMinimum", "distanceKm", "km", "separationKm"); minimumNote("speedMinimum", "speedMs", "m/s", "relativeSpeedMps");
  updateCharts();
}
function drawChart(id, key, threshold, current) {
  const canvas = $(id), context = canvas.getContext("2d"), width = Math.max(240, Math.round(canvas.clientWidth)), height = Math.max(150, Math.round(canvas.clientHeight));
  const ratio = Math.min(devicePixelRatio || 1, 3); canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const pad = CHART_PADDING, left = pad.left, right = width - pad.right, top = pad.top, bottom = height - pad.bottom;
  const values = comparisons.flatMap(comparison => series.map(item => item[comparison.slots[0]]?.[key])).filter(Number.isFinite);
  const overflowNote = canvas.parentElement.querySelector(".e002-chart-overflow"); overflowNote.replaceChildren();
  context.clearRect(0, 0, width, height); context.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const unit = key === "distanceKm" ? "km" : "m/s";
  context.save(); context.translate(22, (top + bottom) / 2); context.rotate(-Math.PI / 2);
  context.fillStyle = "#555"; context.textAlign = "center";
  context.fillText(key === "distanceKm" ? "Estimated separation (km)" : "Estimated relative velocity (m/s)", 0, 0); context.restore();
  if (!values.length) { context.fillStyle = CHART_COLOR.text; context.fillText("No supported samples", left + 5, (top + bottom) / 2); return; }
  const max = Math.max(Math.max(...values) * 1.08, threshold * 1.2, 1);
  const start = Date.parse(model.window.start), end = Date.parse(model.window.end);
  const x = ms => left + (ms - start) / (end - start) * (right - left);
  const y = value => bottom - Math.min(1, Math.max(0, value / max)) * (bottom - top);
  chartScales.set(id, { max, top, bottom });
  context.fillStyle = CHART_COLOR.thresholdBand; context.fillRect(left, y(threshold), right - left, bottom - y(threshold));
  for (let index = 0; index <= 4; index++) {
    const value = max * index / 4, py = y(value);
    if (index < 4) { context.strokeStyle = CHART_COLOR.grid; context.beginPath(); context.moveTo(left, py); context.lineTo(right, py); context.stroke(); }
    context.fillStyle = CHART_COLOR.text; context.textAlign = "right"; context.fillText(Math.round(value).toLocaleString(), left - 5, py + 3);
  }
  context.strokeStyle = CHART_COLOR.threshold; context.lineWidth = 1; context.beginPath(); context.moveTo(left, y(threshold)); context.lineTo(width - 56, y(threshold)); context.stroke();
  const edge = canvas.parentElement.querySelector(".thresholdEdge");
  edge.style.top = `${canvas.offsetTop + Math.max(top + 5, Math.min(bottom - 5, y(threshold)))}px`;
  edge.textContent = `${threshold} ${unit}`; edge.setAttribute("aria-valuenow", String(threshold));
  edge.setAttribute("aria-valuemax", key === "distanceKm" ? $("distanceThresholdSlider").max : $("speedThresholdSlider").max);
  const currentValue = canvas.parentElement.querySelector(".currentValue"), selected = validSample(comparisons[0], current)?.[key];
  currentValue.hidden = !Number.isFinite(selected);
  if (Number.isFinite(selected)) { currentValue.style.top = `${canvas.offsetTop + Math.max(top + 5, Math.min(bottom - 5, y(selected)))}px`; currentValue.textContent = `${Math.round(selected).toLocaleString()} ${unit}`; }
  context.strokeStyle = CHART_COLOR.line; context.lineWidth = 1.4; context.beginPath();
  for (const comparison of comparisons) {
    const slot = comparison.slots[0]; let drawing = false;
    for (const item of series) {
      if (item.ms > current) break;
      const value = item[slot]?.[key];
      if (!Number.isFinite(value)) { drawing = false; continue; }
      if (drawing) context.lineTo(x(item.ms), y(value)); else context.moveTo(x(item.ms), y(value));
      drawing = true;
    }
    context.stroke(); context.beginPath();
  }
  context.strokeStyle = "#8b806a"; context.lineWidth = 1; context.setLineDash([2, 3]);
  context.beginPath(); context.moveTo(x(current), top); context.lineTo(x(current), bottom); context.stroke(); context.setLineDash([]);
  context.fillStyle = CHART_COLOR.text; context.textAlign = "left"; context.fillText(formatTime(start).replace(/^.*?, /, "").replace(" UTC", ""), left, height - 7);
  context.textAlign = "right"; context.fillText(formatTime(end).replace(/^.*?, /, "").replace(" UTC", ""), right, height - 7);
}

function updateCharts() {
  const distance = Number($("distanceThresholdSlider").value), speed = Number($("speedThresholdSlider").value);
  drawChart("separationChart", "distanceKm", distance, model.current);
  drawChart("speedChart", "speedMs", speed, model.current);
  $("distanceThresholdOutput").textContent = `${distance} km`; $("speedThresholdOutput").textContent = `${speed} m/s`;
  $("thresholdSummary").textContent = `${distance} km · ${speed} m/s`;
  const dwell = comparisons.map(comparison => {
    const slot = comparison.slots[0];
    const valid = series.filter(item => Number.isFinite(item[slot]?.distanceKm) && Number.isFinite(item[slot]?.speedMs));
    let minutes = 0;
    for (let index = 1; index < series.length; index++) {
      const before = series[index - 1], after = series[index];
      if (before[slot]?.distanceKm <= distance && before[slot]?.speedMs <= speed && after[slot]?.distanceKm <= distance && after[slot]?.speedMs <= speed)
        minutes += (after.ms - before.ms) / 60000;
    }
    return { label: comparison.short, color: comparison.color, count: valid.length < 2 ? null : minutes };
  });
  const count = dwell[0]?.count;
  $("dwellStat").textContent = count === null || count === undefined ? "—" : formatDwellDuration(count * 60000);
  $("dwellUnit").textContent = "";
  const explanation = $("dwellMetric").querySelector(".dwellKey");
  explanation.textContent = "Approximate chapter duration between consecutive supported one-minute samples that meet both thresholds.";
  if (comparisons.length > 1) {
    let rows = $("dwellMetric").querySelector(".e002-dwell-pairs");
    if (!rows) { rows = document.createElement("div"); rows.className = "e002-dwell-pairs"; explanation.after(rows); }
    rows.replaceChildren(...dwell.map(item => { const row = document.createElement("div"), dot = document.createElement("i"), value = document.createElement("strong"); dot.style.background = item.color; value.textContent = item.count === null ? "unavailable" : formatDwellDuration(item.count * 60000); row.append(dot, document.createTextNode(item.label), value); return row; }));
  }
}
function tick() {
  if (!model.ready) { setTimeout(tick, 250); return; }
  if (model.window.id !== lastWindow) {
    lastWindow = model.window.id; buildSeries();
    for (const [id, button] of chapterButtons) { const active = id === lastWindow; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); }
    context.textContent = model.window.chapterTitle;
    coverageBody.textContent = `${model.window.note} Playback: ${formatTime(Date.parse(model.window.start))} to ${formatTime(Date.parse(model.window.end))}. Statistical comparisons require each selected element to be within 12 hours of its epoch.`;
  }
  const start = Date.parse(model.window.start), end = Date.parse(model.window.end), current = model.current;
  const slider = $("timelineSlider"); slider.min = String(start); slider.max = String(end); slider.value = String(current); slider.step = "1000";
  updatePlaybackCounter($("sliderNow"), current - start, current); $("timeDisplay").textContent = formatTime(current);
  const currentValues = comparisons.map(comparison => validSample(comparison, current));
  const display = (key, unit) => {
    const digits = key === "distanceKm" ? 0 : 1;
    return comparisons.length === 1 ? (currentValues[0] ? `${currentValues[0][key].toFixed(digits)} ${unit}` : "—") : comparisons.map((comparison, index) => `${comparison.short}: ${currentValues[index] ? currentValues[index][key].toFixed(digits) + " " + unit : "unavailable"}`).join(" · ");
  };
  $("rangeStat").textContent = display("distanceKm", "km"); $("speedStat").textContent = display("speedMs", "m/s");
  $("playBtn").setAttribute("aria-label", model.playing ? "Pause" : "Play");
  updateCards(); updateCharts(); setTimeout(tick, 500);
}
chapterGroup.addEventListener("click", event => { const button = event.target.closest("button[data-window]"); if (button) model.selectWindow(button.dataset.window); });
for (const id of ["distanceThresholdSlider", "speedThresholdSlider"]) $(id).addEventListener("input", updateCharts);
for (const [groupId, chartId, sliderId] of [["distanceChartGroup", "separationChart", "distanceThresholdSlider"], ["speedChartGroup", "speedChart", "speedThresholdSlider"]]) {
  const edge = $(groupId).querySelector(".thresholdEdge"), chart = $(chartId), slider = $(sliderId);
  const change = clientY => {
    const scale = chartScales.get(chartId); if (!scale) return;
    const y = clientY - chart.getBoundingClientRect().top;
    const value = (scale.bottom - y) / (scale.bottom - scale.top) * scale.max;
    const step = Number(slider.step) || 1;
    slider.value = String(Math.round(Math.max(Number(slider.min), Math.min(Number(slider.max), value)) / step) * step);
    updateCharts();
  };
  edge.addEventListener("pointerdown", event => { edge.setPointerCapture(event.pointerId); change(event.clientY); });
  edge.addEventListener("pointermove", event => { if (edge.hasPointerCapture(event.pointerId)) change(event.clientY); });
  edge.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); slider.value = String(Number(slider.value) + (event.key === "ArrowUp" ? 1 : -1) * Number(slider.step)); updateCharts();
  });
}
$("timelineSlider").addEventListener("input", event => model.setTime(Number(event.target.value)));
wireTimelineHover($("timelineSlider"), $("timelineHover"), $("timelineHoverTick"), () => [Date.parse(model.window.start), Date.parse(model.window.end)]);
$("playBtn").addEventListener("click", () => model.setPlaying(!model.playing));
$("modeBtn").addEventListener("click", () => model.toggleFrame());
$("resetBtn").hidden = false; $("resetBtn").addEventListener("click", () => model.resetCamera());
$("zoomInBtn").addEventListener("click", () => model.zoom(1.12));
$("zoomOutBtn").addEventListener("click", () => model.zoom(1 / 1.12));
$("speed").value = "60";
wireSpeedButtons($("speed"), $("speedDownBtn"), $("speedUpBtn"), rate => model.setRate(rate));
new ResizeObserver(() => document.body.style.setProperty("--e002-dock-height", `${Math.ceil($("playbackDock").getBoundingClientRect().height)}px`)).observe($("playbackDock"));
$("cameraControls").append(makeCameraEditor(model));
tick();

function makeCameraEditor(model) {
  const button = document.createElement("button"); button.className = "cameraBtn e002-dev-toggle"; button.type = "button"; button.textContent = "◧"; button.title = "Camera keyframes · development";
  if (new URLSearchParams(location.search).get("dev") !== "1") { button.hidden = true; return button; }
  const panel = $("cameraDevTools"); panel.replaceChildren(); panel.classList.add("e002-camera-editor");
  const heading = document.createElement("strong"); heading.textContent = "Camera keyframes · E-002 development";
  const name = document.createElement("input"); name.placeholder = "Keyframe name"; name.value = "New view";
  const time = document.createElement("input"); time.type = "datetime-local"; time.step = "60";
  const frame = document.createElement("select"); for (const mode of ["inertial", "relative"]) { const option = document.createElement("option"); option.value = mode; option.textContent = `${mode} reference`; frame.append(option); }
  const presets = document.createElement("select"); presets.setAttribute("aria-label", "Saved camera preset");
  const playback = document.createElement("button"); playback.textContent = "Pause / play";
  const save = document.createElement("button"); save.textContent = "Capture keyframe";
  const preview = document.createElement("button"); preview.textContent = "Preview saved view";
  const restore = document.createElement("button"); restore.textContent = "Restore auto camera";
  const exportButton = document.createElement("button"); exportButton.textContent = "Export JSON";
  const message = document.createElement("p"); message.className = "methodNote"; message.textContent = "Drag to orbit; scroll to zoom. Captures include the episode and UTC time.";
  const saved = JSON.parse(localStorage.getItem("espl-e002-camera-keyframes") || "[]");
  function refresh() { presets.replaceChildren(); for (const [index, view] of saved.entries()) { const option = document.createElement("option"); option.value = String(index); option.textContent = `${view.name} · ${view.momentId}`; presets.append(option); } }
  refresh();
  fetch(new URL("../dev/e002/camera-examples.json", import.meta.url)).then(response => response.json()).then(data => {
    saved.unshift(...data.views.filter(view => model.windows.some(window => window.id === view.momentId)).map(view => ({
      ...view, episodeId: "E-002", timestampUtc: view.timestamp, frameMode: "inertial", up: [0,1,0]
    })));
    refresh();
  }).catch(() => {});
  button.addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) { model.setPlaying(false); time.value = new Date(model.current).toISOString().slice(0,16); frame.value = model.frameMode; } });
  time.addEventListener("change", () => model.setTime(Date.parse(`${time.value}:00Z`)));
  frame.addEventListener("change", () => { if (frame.value !== model.frameMode) model.toggleFrame(); });
  playback.addEventListener("click", () => model.setPlaying(!model.playing));
  save.addEventListener("click", () => { const view = model.captureCamera(name.value.trim() || "Untitled view"); saved.push(view); localStorage.setItem("espl-e002-camera-keyframes", JSON.stringify(saved.filter(item => !item.coordinateFrame))); refresh(); presets.value = String(saved.length - 1); message.textContent = `Captured ${view.name} at ${view.timestampUtc}.`; });
  preview.addEventListener("click", () => { const view = saved[Number(presets.value)]; if (!view) return; model.selectWindow(view.momentId); model.setTime(Date.parse(view.timestampUtc)); model.previewCameraTransition(view); message.textContent = `Previewing transition to ${view.name}.`; });
  restore.addEventListener("click", () => model.resetCamera());
  exportButton.addEventListener("click", () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ episodeId: "E-002", views: saved }, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "e002-camera-keyframes.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  panel.append(heading, name, time, frame, playback, presets, save, preview, restore, exportButton, message);
  return button;
}

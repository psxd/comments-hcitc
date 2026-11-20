import { CHART_COLOR } from "../../Viz/chart-style.js";
import { analyzeEpisode, exclusiveQualificationIntervals } from "../../Viz/e001-analysis.js";

const sgp4 = window.satellite;
const minute = 60000;
const norm = vector => Math.hypot(vector.x, vector.y, vector.z);
const shortDate = ms => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(ms));
const axisTime = ms => new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(ms));
const chartScaleState = new WeakMap();
export const resetOrbitalChartScale = canvas => chartScaleState.delete(canvas);
const roundTickStep = (value, floor = 5) => {
  const minimum = Math.max(floor, value / 3);
  const decade = 10 ** Math.floor(Math.log10(minimum));
  for (const factor of [1, 2.5, 5, 10]) {
    const step = factor * decade;
    if (step >= minimum) return step;
  }
  return 10 * decade;
};
export const roundedSpeed = value => {
  const step = Math.abs(value) >= 1000 ? 5 : 1;
  return Math.round(value / step) * step;
};

let elementsPromise;
export function preloadOrbitalElements() {
  return elementsPromise ||= (async () => {
    const response = await fetch("../e002/data/provenance.json");
    if (!response.ok) throw new Error("E-002 element provenance is unavailable");
    const manifest = await response.json();
    const entries = await Promise.all(manifest.datasets.map(async record => {
      const source = await fetch(record.url, { cache: "no-store" });
      if (!source.ok) throw new Error(`Historical elements unavailable for ${record.object.name}`);
      const bytes = await source.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== record.sha256) throw new Error(`Historical elements for ${record.object.name} changed; provenance review required`);
      return [record.object.cospar, JSON.parse(new TextDecoder().decode(bytes)).tles.sort((a, b) => Date.parse(a.epoch) - Date.parse(b.epoch))];
    }));
    return new Map(entries);
  })();
}
export async function loadOrbitalPreview(episode) {
  if (!sgp4?.twoline2satrec || !sgp4?.propagate) throw new Error("Satellite propagation library is unavailable");
  const datasets = await preloadOrbitalElements();
  const libraries = {};
  for (const item of episode.participants) {
    const records = datasets.get(item.cospar);
    if (!records) throw new Error(`Historical element provenance missing for ${item.name}`);
    libraries[item.slot] = records;
  }

  const maxStatisticAge = episode.maximumStatisticTleAgeHours * 3600000;
  const seriesCache = new Map();
  const minimumCache = new Map();
  const qualificationCache = new Map();
  function selectTle(slot, ms) {
    const tles = libraries[slot];
    if (!tles?.length) return null;
    let low = 0, high = tles.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (Date.parse(tles[middle].epoch) < ms) low = middle + 1;
      else high = middle;
    }
    if (low > 0 && ms - Date.parse(tles[low - 1].epoch) < Date.parse(tles[low].epoch) - ms) low--;
    return tles[low];
  }
  function state(tle, ms, gate = maxStatisticAge) {
    if (!tle || Math.abs(ms - Date.parse(tle.epoch)) > gate) return null;
    const satrec = tle.satrec ||= sgp4.twoline2satrec(tle.line1, tle.line2);
    const value = sgp4.propagate(satrec, new Date(ms));
    return value.position && value.velocity ? value : null;
  }
  function series(window, chaser) {
    const key = `${window.id}:${chaser}`;
    if (seriesCache.has(key)) return seriesCache.get(key);
    const start = Date.parse(window.start), end = Date.parse(window.end), samples = [];
    const sampleAt = ms => {
      const first = selectTle(chaser, ms), second = selectTle("B", ms);
      const a = state(first, ms), b = state(second, ms);
      if (!a || !b) return { ms, distanceKm: null, speedMs: null, speedMps: null, tleA: first?.epoch, tleB: second?.epoch };
      const distanceKm = norm({ x: a.position.x - b.position.x, y: a.position.y - b.position.y, z: a.position.z - b.position.z });
      const speedMs = norm({ x: a.velocity.x - b.velocity.x, y: a.velocity.y - b.velocity.y, z: a.velocity.z - b.velocity.z }) * 1000;
      return { ms, distanceKm, speedMs, speedMps: speedMs, tleA: first.epoch, tleB: second.epoch };
    };
    for (let ms = start; ms <= end; ms += minute) {
      samples.push(sampleAt(ms));
    }
    if (samples.at(-1)?.ms !== end) samples.push(sampleAt(end));
    seriesCache.set(key, samples);
    return samples;
  }
  function minimum(chaser, metric) {
    const key = `${chaser}:${metric}`;
    if (minimumCache.has(key)) return minimumCache.get(key);
    let best = null;
    for (const window of episode.windows) {
      for (const sample of series(window, chaser)) {
        if (Number.isFinite(sample[metric]) && (!best || sample[metric] < best.value)) best = { value: sample[metric], ms: sample.ms, window };
      }
    }
    minimumCache.set(key, best);
    return best;
  }
  function qualifications(window, chaser, distance, speed) {
    const key = `${window.id}:${chaser}:${distance}:${speed}`;
    if (qualificationCache.has(key)) return qualificationCache.get(key);
    const samples = series(window, chaser);
    const both = analyzeEpisode(samples, distance, speed, minute);
    const distanceOnly = analyzeEpisode(samples, distance, Infinity, minute).intervals;
    const speedOnly = analyzeEpisode(samples, Infinity, speed, minute).intervals;
    const single = exclusiveQualificationIntervals(distanceOnly, speedOnly).single;
    const result = { both, single };
    qualificationCache.set(key, result);
    return result;
  }
  function frame(window, ms, selectionMs = ms) {
    const gate = (window.visualAgeHours || episode.maximumDisplayTleAgeHours) * 3600000;
    const result = {};
    for (const item of episode.participants) {
      const tle = selectTle(item.slot, selectionMs);
      const propagated = state(tle, ms, gate);
      result[item.slot] = propagated ? { ...propagated, epoch: tle.epoch, ageHours: (ms - Date.parse(tle.epoch)) / 3600000 } : null;
    }
    return result;
  }
  return { series, minimum, qualifications, frame };
}

const HOUR = 3600000;
export function chapterTickHours(widthHours) {
  const choices = [1, 2, 3, 4, 6, 12, 24, 48, 72, 96, 168, 336];
  const target = widthHours / 2.5;
  return choices.reduce((best, choice) => Math.abs(choice - target) < Math.abs(best - target) ? choice : best);
}

export function drawOrbitalChart(canvas, samples, metric, { window, currentMs, threshold, title, maximum, qualifications, markedMs = null, speedUnit = "km/s", connectSwitches = false, maxConnectionGapMs = Infinity, minimumTickHours = 0, contextSamples = null, fixedWindow = false }) {
  const width = Math.max(260, Math.round(canvas.clientWidth || 306)), height = 155;
  const ratio = Math.min(Math.max(globalThis.devicePixelRatio || 1, 2), 3), context = canvas.getContext("2d");
  // Assigning width/height throws away the canvas backing store and reallocates it,
  // which is expensive and flickers when a slider redraws many times a second.
  // Only resize when the size or pixel ratio actually changed.
  const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth; canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  let left = 52;
  const right = width - 122, top = 11, bottom = height - 38;
  const start = Date.parse(window.start), end = Date.parse(window.end);
  const viewSpan = end - start;
  const viewStart = fixedWindow ? start : currentMs - viewSpan, viewEnd = fixedWindow ? end : currentMs;
  const tickMs = Math.max(chapterTickHours(viewSpan / HOUR), minimumTickHours) * HOUR;
  canvas.dataset.timeTickHours = String(tickMs / HOUR);
  const speedScale = metric === "speedMs" && speedUnit !== "m/s" ? 1000 : 1;
  const visibleThreshold = threshold / speedScale;
  const values = samples.filter(sample => sample.ms >= viewStart && sample.ms <= currentMs && Number.isFinite(sample[metric])).map(sample => sample[metric] / speedScale);
  const minimumStep = metric === "speedMs" ? speedUnit === "m/s" ? 5 : .05 : 5;
  const rawMax = Math.max(visibleThreshold * 1.2, values.length ? Math.max(...values) * 1.08 : 0, metric === "speedMs" ? minimumStep : 1);
  const targetStep = roundTickStep(rawMax, minimumStep);
  const targetMax = Math.ceil(rawMax / targetStep) * targetStep;
  const now = performance.now(), previousScale = chartScaleState.get(canvas);
  const continuous = previousScale?.windowId === window.id && currentMs >= previousScale.currentMs && currentMs - previousScale.currentMs <= 30 * 60000;
  const max = continuous ? previousScale.max + (targetMax - previousScale.max) * (1 - Math.exp(-(now - previousScale.now) / 420)) : targetMax;
  chartScaleState.set(canvas, { windowId: window.id, currentMs, now, max });
  const tickStep = roundTickStep(max, minimumStep);
  const speedDecimals = tickStep >= 1 ? 0 : Number.isInteger(tickStep * 10) ? 1 : 2;
  const tickLabel = value => metric === "speedMs" && speedUnit !== "m/s" ? value.toFixed(speedDecimals).replace(/\.0+$/, "") : Math.round(value).toLocaleString();
  context.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const longestTick = Math.max(...Array.from({ length: Math.ceil(max / tickStep) + 1 }, (_, index) => context.measureText(tickLabel(index * tickStep)).width));
  left = Math.max(left, Math.ceil(longestTick + 30));
  canvas.dataset.axisMax = max.toFixed(1);
  canvas.dataset.axisTarget = String(targetMax);
  const x = ms => left + (ms - viewStart) / viewSpan * (right - left);
  const y = value => bottom - Math.max(0, Math.min(1, value / max)) * (bottom - top);
  context.fillStyle = CHART_COLOR.thresholdBand;
  context.fillRect(left, y(visibleThreshold), right - left, bottom - y(visibleThreshold));
  context.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  for (let value = 0; value <= max + tickStep / 2; value += tickStep) {
    const py = y(value);
    context.strokeStyle = CHART_COLOR.grid; context.beginPath(); context.moveTo(left, py); context.lineTo(right, py); context.stroke();
    context.fillStyle = CHART_COLOR.text; context.textAlign = "right";
    context.fillText(tickLabel(value), left - 5, py + 3);
  }
  context.save(); context.translate(16, (top + bottom) / 2); context.rotate(-Math.PI / 2);
  context.fillStyle = "#555"; context.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'; context.textAlign = "center";
  context.fillText(title, 0, 0); context.restore();
  context.strokeStyle = CHART_COLOR.threshold; context.lineWidth = 1;
  context.beginPath(); context.moveTo(left, y(visibleThreshold)); context.lineTo(right + 69, y(visibleThreshold)); context.stroke();
  if (Number.isFinite(markedMs) && markedMs >= viewStart && markedMs <= Math.min(viewEnd, currentMs)) {
    context.setLineDash([2, 3]); context.strokeStyle = "#8b806a"; context.lineWidth = 1;
    context.beginPath(); context.moveTo(x(markedMs), top); context.lineTo(x(markedMs), bottom); context.stroke(); context.setLineDash([]);
  }
  canvas.dataset.minimumMarkerUtc = Number.isFinite(markedMs) ? new Date(markedMs).toISOString() : "";
  canvas.dataset.visibleStartUtc = new Date(viewStart).toISOString();
  canvas.dataset.visibleEndUtc = new Date(viewEnd).toISOString();
  function trace(source, until, color, lineWidth) {
    context.strokeStyle = color; context.lineWidth = lineWidth; context.beginPath();
    let drawing = false, previous = null;
    for (const sample of source) {
      const value = Number.isFinite(sample[metric]) ? sample[metric] / speedScale : null;
      if (sample.ms > until) break;
      if (sample.ms < viewStart) continue;
      if (!Number.isFinite(value)) { drawing = false; previous = null; continue; }
      if (drawing && (previous?.tleA === sample.tleA && previous?.tleB === sample.tleB || connectSwitches && sample.ms - previous.ms <= maxConnectionGapMs)) context.lineTo(x(sample.ms), y(value));
      else context.moveTo(x(sample.ms), y(value));
      drawing = true; previous = sample;
    }
    context.stroke();
  }
  if (contextSamples) {
    context.save(); context.setLineDash([3, 3]);
    trace(contextSamples, currentMs, "#b5b5b5", 1.1);
    context.restore();
  }
  trace(samples, currentMs, "#6f6f6f", 1.4);
  canvas.dataset.drawnUntilUtc = new Date(currentMs).toISOString();
  for (let ms = Math.ceil(viewStart / tickMs) * tickMs; ms <= viewEnd; ms += tickMs) {
    const px = x(ms);
    context.strokeStyle = "#aaa"; context.beginPath(); context.moveTo(px, bottom); context.lineTo(px, bottom + 4); context.stroke();
    context.fillStyle = CHART_COLOR.text; context.textAlign = "center"; context.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.fillText(axisTime(ms), px, height - 20);
    context.fillText(shortDate(ms).replace(/,\s*\d{4}$/, ""), px, height - 9);
  }
  for (const [intervals, color] of [[qualifications?.single || [], "#a9a9a9"], [qualifications?.both.intervals || [], "#eaaa00"]]) {
    context.fillStyle = color;
    for (const interval of intervals) {
      const from = Math.max(viewStart, interval.start), to = Math.min(viewEnd, currentMs, interval.end);
      if (to > from) context.fillRect(x(from), bottom + 5, Math.max(3, x(to) - x(from)), 4);
    }
  }
  canvas.dataset.singleThresholdSegments = String(qualifications?.single.length || 0);
  canvas.dataset.bothThresholdSegments = String(qualifications?.both.intervals.length || 0);
  const group = canvas.parentElement, edge = group.querySelector(".thresholdEdge"), current = group.querySelector(".currentValue");
  const unit = metric === "distanceKm" ? "km" : speedUnit;
  edge.hidden = false;
  edge.style.top = `${canvas.offsetTop + y(visibleThreshold)}px`; edge.textContent = `${Number(visibleThreshold.toFixed(2)).toLocaleString()} ${unit}`;
  edge.setAttribute("aria-valuenow", String(visibleThreshold));
  edge.setAttribute("aria-valuemax", String(maximum / speedScale));
  const sample = samples.find(item => item.ms === currentMs && Number.isFinite(item[metric]));
  current.hidden = !sample;
  if (sample) {
    current.style.top = `${canvas.offsetTop + y(sample[metric] / speedScale)}px`;
    const value = metric === "distanceKm" ? Math.round(sample[metric]).toLocaleString("en-US") : speedUnit === "m/s" ? Math.round(sample[metric]).toLocaleString("en-US") : (roundedSpeed(sample[metric]) / 1000).toFixed(2);
    current.textContent = `${value} ${unit}`;
  }
  group.querySelector(".chart-time-context")?.remove();
  if (!values.length) {
    context.fillStyle = "#777"; context.textAlign = "center";
    context.fillText(contextSamples ? "No recent TLE samples" : "No supported one-minute samples", (left + right) / 2, (top + bottom) / 2);
  }
  return { top, bottom, left, right, max, unit, thresholdY: y(visibleThreshold), viewStart, viewEnd };
}

/* Recalculate table minima from the same public TLEs and 15-minute SGP4 window as Proximity-Viz. */
import { sampleEpisode, analyzeEpisode } from "../visualization/Viz/e001-analysis.js";

const DAY_MS = 86400000, STEP_MS = 15 * 60000;
const historyUrl = norad => new URL(`../visualization/Viz/data/tles_public/${norad}.json`, import.meta.url);
let satellitePromise;
function satelliteLibrary() {
  return satellitePromise ||= import("../visualization/Viz/vendor/satellite/satellite.min.js").then(() => {
    if (!window.satellite?.twoline2satrec) throw new Error("Satellite propagation library unavailable");
    return window.satellite;
  });
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function nearest(epochs, ms) {
  let low = 0, high = epochs.length - 1;
  while (low < high) { const mid = Math.floor((low + high) / 2); if (epochs[mid] < ms) low = mid + 1; else high = mid; }
  return low > 0 && ms - epochs[low - 1] < epochs[low] - ms ? low - 1 : low;
}
function stateAt(lib, ms, sgp4, maxAgeMs) {
  const index = nearest(lib.epochs, ms);
  if (ms < lib.epochs[0] || ms > lib.epochs.at(-1) || Math.abs(ms - lib.epochs[index]) > maxAgeMs) return null;
  const tle = lib.tles[index];
  const satrec = lib.records[index] ||= sgp4.twoline2satrec(tle.line1, tle.line2);
  const result = sgp4.propagate(satrec, new Date(ms));
  if (!result.position || !result.velocity) return null;
  return { index, r: [result.position.x, result.position.y, result.position.z], v: [result.velocity.x, result.velocity.y, result.velocity.z] };
}

export async function calculateE001(interval, { distanceKm = 200, speedMps = 15, maximumTleAgeDays = 3 } = {}) {
  const [sgp4, ...histories] = await Promise.all([
    satelliteLibrary(),
    fetch(historyUrl("40258")).then(r => { if (!r.ok) throw new Error("Luch TLE history unavailable"); return r.json(); }),
    fetch(historyUrl("39509")).then(r => { if (!r.ok) throw new Error("Athena-Fidus TLE history unavailable"); return r.json(); }),
  ]);
  const libs = histories.map(history => ({ tles: history.tles, epochs: history.tles.map(tle => Date.parse(tle.epoch)), records: [] }));
  const sampleAt = ms => {
    const a = stateAt(libs[0], ms, sgp4, maximumTleAgeDays * DAY_MS);
    const b = stateAt(libs[1], ms, sgp4, maximumTleAgeDays * DAY_MS);
    return { tleA: a?.index ?? null, tleB: b?.index ?? null,
      distanceKm: a && b ? distance(a.r, b.r) : null,
      speedMps: a && b ? distance(a.v, b.v) * 1000 : null };
  };
  const windows = interval.chapters?.length ? interval.chapters : [interval];
  const results = windows.map(window => analyzeEpisode(sampleEpisode(window.startMs, window.endMs, STEP_MS, sampleAt), distanceKm, speedMps, STEP_MS));
  const minimum = key => results.map(result => result[key]).filter(Boolean).reduce((best, item) => !best || item.value < best.value ? item : best, null);
  return { source: "E-001 sheet chapters, public historical TLEs and synchronized SGP4", startMs: interval.startMs,
    endMs: interval.endMs, stepMs: STEP_MS, validSamples: results.reduce((total, result) => total + result.validSamples, 0),
    minimumDistance: minimum("minimumDistance"), minimumSpeed: minimum("minimumSpeed"),
    dwellMs: results.reduce((total, result) => total + result.totalMs, 0) };
}

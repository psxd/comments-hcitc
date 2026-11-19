import { episodeChapters, plottedObjects } from "./episode-feed.js?v=2";

const HOUR = 3600000;
let satellitePromise;

function satelliteLibrary() {
  if (window.satellite) return Promise.resolve(window.satellite);
  return satellitePromise ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("../visualization/Viz/vendor/satellite/satellite.min.js", import.meta.url).href;
    script.onload = () => window.satellite ? resolve(window.satellite) : reject(new Error("SGP4 library did not initialize"));
    script.onerror = () => reject(new Error("SGP4 library could not load"));
    document.head.append(script);
  });
}

async function verifiedElements(id, norad) {
  const base = new URL(`../visualization/dev/${id.toLowerCase().replace("-", "")}/`, import.meta.url);
  const manifest = await fetch(new URL("data/provenance.json", base), { cache: "no-store" }).then(response => {
    if (!response.ok) throw new Error(`${id} element manifest returned ${response.status}`);
    return response.json();
  });
  const entry = manifest.datasets.find(item => String(item.object.norad) === String(norad));
  if (!entry) throw new Error(`${id} has no element history for ${norad}`);
  const response = await fetch(new URL(entry.url, base), { cache: "no-store" });
  if (!response.ok) throw new Error(`${id} elements returned ${response.status}`);
  const bytes = await response.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== entry.sha256) throw new Error(`${id} element checksum failed for ${norad}`);
  return JSON.parse(new TextDecoder().decode(bytes)).tles.map(tle => ({ ms: Date.parse(tle.epoch), satrec: window.satellite.twoline2satrec(tle.line1, tle.line2) }));
}

function nearest(tles, ms) {
  let lo = 0, hi = tles.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tles[mid].ms < ms) lo = mid + 1; else hi = mid; }
  if (!lo) return tles[0];
  if (lo === tles.length) return tles.at(-1);
  return ms - tles[lo - 1].ms <= tles[lo].ms - ms ? tles[lo - 1] : tles[lo];
}

function norm(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

// Use each full visualization's chapter sampling cadence and nearest dated TLE.
export async function historicalEpisodeMetrics(row, catalog) {
  const id = row.ID, objects = plottedObjects(row);
  if (!["E-003", "E-005", "E-006", "E-008", "E-016", "E-059"].includes(id) || objects.length < 2) throw new Error(`No historical metric configuration for ${id}`);
  await satelliteLibrary();
  const libraries = Object.fromEntries(await Promise.all(objects.map(async ({ slot, cospar }) => {
    const record = catalog.records[cospar];
    if (!record?.NORAD_CAT_ID) throw new Error(`Space-Track SATCAT has no ${cospar}`);
    return [slot, { launchMs: Date.parse(`${record.LAUNCH}T00:00:00Z`), tles: await verifiedElements(id, record.NORAD_CAT_ID) }];
  })));
  const result = { minimumDistance: null, minimumSpeed: null };
  function sample(ms) {
    const states = Object.fromEntries(objects.map(({ slot }) => {
      const object = libraries[slot];
      if (ms < object.launchMs) return [slot, null];
      const propagated = window.satellite.propagate(nearest(object.tles, ms).satrec, new Date(ms));
      return [slot, propagated.position && propagated.velocity ? propagated : null];
    }));
    if (!states.A) return;
    for (const { slot } of objects.slice(1)) {
      if (!states[slot]) continue;
      const distance = norm(states.A.position, states[slot].position);
      const speed = norm(states.A.velocity, states[slot].velocity) * 1000;
      if (!result.minimumDistance || distance < result.minimumDistance.value) result.minimumDistance = { value: distance, ms, pair: `A:${slot}` };
      if (!result.minimumSpeed || speed < result.minimumSpeed.value) result.minimumSpeed = { value: speed, ms, pair: `A:${slot}` };
    }
  }
  for (const chapter of episodeChapters(row)) {
    const step = Math.max(60000, Math.ceil((chapter.endMs - chapter.startMs) / 3200 / 60000) * 60000);
    for (let ms = chapter.startMs; ms <= chapter.endMs; ms += step) sample(ms);
    if ((chapter.endMs - chapter.startMs) % step) sample(chapter.endMs);
  }
  return result;
}

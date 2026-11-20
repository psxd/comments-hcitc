// WORK IN PROGRESS: this is a working copy that is changing often. Expect unfinished features and breaking changes.
// compare.js — shows TWO satellites around Earth, computed directly from their TLEs.
//
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// SECTIONS:
// 1. Load the libraries
// 2. Settings that never change ("const" = constant)
// 3. Things that DO change while the page runs ("let" = can be reassigned)
// 4. Loading TLEs and computing positions
// 5. Set up the 3D scene: camera, renderer, Earth
// 6. Create the two satellite dots and two orbit lines (one per slot)
// 7. Formatting helpers
// 8. Updating the picture
// 9. Camera  
// 10. Choosing satellites and time windows 
// 11. Responding to the user 
// 12. The animation loop - the browswer calls this about 60 times per second
// 13. Start: load the satellite catalog and TLE library list, then wait for the user to pick satellites
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
//
//
//
//
// ---------------------------------------------------------------------------
// 1. Load the libraries
// ---------------------------------------------------------------------------
// "import" pulls in code someone else wrote. THREE is the 3D graphics library,
// OrbitControls lets you drag to spin the camera, topojson reads the map borders.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as topojson from "topojson-client";
import { sampleEpisode, analyzeEpisode, exclusiveQualificationIntervals } from "./e001-analysis.js";
import { safeEpisodeName, episodeNameText } from "../../shared/episode-name.js";
import { relativeCameraFrame, relativeFitDistance } from "./relative-camera.js";
import { DOT_SCREEN_SIZE, SATELLITE_STYLES, dotTexture, fadingTrailGeometry, fadingTrailMaterial, miniMarkerScale } from "./relative-rendering.js?v=5";
import { applyMarkerCssVariables } from "../../shared/marker-spec.js?v=3";
applyMarkerCssVariables();
import { loadCurrentEpisodes, episodeUtcInterval, episodeChapters } from "../../shared/episode-feed.js?v=6";
import { tleProvenance, spaceTrackHistoryUrl } from "../../shared/tle-provenance.js?v=3";
import { renderEstimatedMinimum } from "./estimate-ui.js";
import { updatePlaybackCounter, wireSpeedButtons, wireTimelineHover } from "./playback-shared.js";
import { CHART_PADDING } from "./chart-style.js";
import { formatDwellDuration } from "../../shared/format-duration.js";
import { dwellSatelliteName } from "../../shared/dwell-name.js";

// satellite.js was loaded by a <script> tag in compare.html, which put it on
// "window" (the browser's global object). We give it a short name here.
const sgp4 = window.satellite;











// ---------------------------------------------------------------------------
// 2. Settings that never change ("const" = constant)
// ---------------------------------------------------------------------------
const EARTH_RADIUS_KM = 6378.137;  // In the 3D scene, Earth's radius is 1 unit, so we divide km by this.
const TRAIL_POINTS = 180;          // How many points make up each orbit line.
const CHART_MINUTES = 120;         // The separation chart shows the last two hours.
const AGING_DAYS = 2;              // TLE more than 2 days from now: show in amber.
const STALE_DAYS = 7;              // TLE more than 7 days from now: show in red.
const MINUTE_MS = 60 * 1000, DAY_MS = 24 * 60 * MINUTE_MS;   // Times in JavaScript are in milliseconds.
const TLE_FLASH_MS = 600;           // how long an orbit line flashes when its satellite switches TLE
const TLE_FLASH_DARKEN = 0.3;       // during a flash, lines are drawn at 30% of their usual brightness
const CASE_PAD_DAYS = 7;            // "Reported period ± 1 week" adds this many days either side
const LABEL_SCREEN_SIZE = 0.03      // name labels are 4.2% of the screen height at any given moment
const DASH_SCREEN_SIZE = 0.01;      // each dash (and gap) in a dashed orbit line is 1% of the screen height

// Each "slot" (A or B) gets its own colors, no matter which satellite is in it.
const SLOTS = SATELLITE_STYLES;

// A tiny helper so we can write $("playBtn") instead of document.getElementById("playBtn").
const $ = id => document.getElementById(id);
const chapterMode = new URLSearchParams(location.search);
const publicChapterView = chapterMode.get("published") === "1" || chapterMode.get("mini") === "1";
const localChapterReview = publicChapterView || (chapterMode.get("dev") === "1" && ["localhost", "127.0.0.1"].includes(location.hostname));
const localChartModule = localChapterReview ? await import("../dev/e002-control-panel-preview/orbital-preview.js") : null;











// ---------------------------------------------------------------------------
// 3. Things that DO change while the page runs ("let" = can be reassigned)
// ---------------------------------------------------------------------------
let catalog = [];            // List of satellites from the TLE library's index.json
let tleFolder = "data/tles_public"; // published E-001 histories, shared by this visualization
let satcat = [];             // Full satellite catalog from data/satcat.json, for the lookup box
let owners = {};             // Owner codes (like "PRC") -> { name, flags }, from data/owners.json
let satcatError = "";        // why the catalog failed to load ("" = no problem so far)
let closest = null;          // the closest approach in the time window, once found: { ms, km, stepMs }
let lookupFound = null;      // NORAD number (as used in the TLE library) of the satellite the lookup found, if it has TLEs
const library = {};          // Loaded TLE histories, keyed by NORAD number
const pair = { A: null, B: null };   // NORAD numbers of the satellites in slots A and B 
let startMs = 0, endMs = 0;  // The chosen time window
let reportedPeriod = null;   // the case's reported start and end, { start, end } in ms, once a case is loaded (null = none)
let caseNorads = [];         // NORAD numbers of the satellites in the case opened from the link ([] = none)
const lastTleIndex = { A: null, B: null };   // the TLE each satellite used last time, to notice a switch
const flashUntil = { A: 0, B: 0 };           // when each satellite's orbit-line flash ends (in performance.now() time)
let currentMs = 0;           // The moment currently shown
let miniWindows = [], miniActive = null, miniLoopStart = 0, miniLoopEnd = 0;
const miniPinnedTles = new Map();
let playing = false;
let lastFrameTime = performance.now();
let cameraTween = null;      // A smooth camera movement in progress, or null if none
let lastIdentityKey = "";    // Used to avoid rebuilding the "Now modeling" panel every frame
let episodeConfig = null;
let episodeStartMs = 0, episodeEndMs = 0, analysisStepMs = 15 * MINUTE_MS;
let analysisSamples = [], chartSamples = [], analysisResult = null;
let focusedMinimumMs = null;
let chartScales = { distanceKm: 1000, speedMps: 100 };
let chartDirty = true;
let lastChartDraw = 0;











// ---------------------------------------------------------------------------
// 4. Loading TLEs and computing positions
// ---------------------------------------------------------------------------

// Load one satellite's TLEs (only the first time it's needed): its full history from our own
// TLE library if we have it, otherwise its latest TLE live from CelesTrak.
async function loadSatellite(norad) {
  if (library[norad]) return library[norad];
  const libraryInfo = catalog.find(s => s.norad === norad);       // undefined if not in our library
  const tles = libraryInfo ? await loadLibraryTles(norad) : await loadCurrentTle(norad);
  const epochsMs = tles.map(t => Date.parse(t.epoch));            // epochs as numbers, for fast searching
  library[norad] = {
    info: libraryInfo ?? satcatInfo(norad),
    tles,
    epochsMs,
    // The dates this satellite can be modeled: from its first to last TLE,
    // or one day either side of its TLE if it only has one (a live TLE)
    coverage: tles.length > 1 ? [epochsMs[0], epochsMs[epochsMs.length - 1]]
                              : [epochsMs[0] - DAY_MS, epochsMs[0] + DAY_MS],
    satrecs: [],   // SGP4 set-up for each TLE, filled in the first time each TLE is used
  };
  return library[norad];
}

// TLE history from our own library: <tleFolder>/<NORAD>.json (made by build_tle_library.py,
// or the published subset made by build_public_tle_library.py)
async function loadLibraryTles(norad) {
  const response = await fetch(`${tleFolder}/${norad}.json`);
  if (!response.ok) throw new Error(`Could not load TLEs for NORAD ${norad} (HTTP ${response.status})`);
  return (await response.json()).tles;
}

// The LATEST TLE for any satellite with a public orbit, from CelesTrak's free service.
// Nothing comes back for objects that have re-entered or whose orbits aren't published.
// TESTING SETUP: CelesTrak is used while building and testing the tool. For actual use,
// this function can be swapped for another TLE source (see "Data sources" in README.md).
async function loadCurrentTle(norad) {
  let response;
  try {
    response = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${Number(norad)}&FORMAT=TLE`);
  } catch {                                              // no answer at all (offline, or CelesTrak unreachable)
    throw new Error("Couldn't reach CelesTrak for a current TLE. Check your internet connection and try again.");
  }
  const lines = (await response.text()).split("\n").map(line => line.trim());
  const line1 = lines.find(line => line.startsWith("1 "));
  const line2 = lines.find(line => line.startsWith("2 "));
  if (!response.ok || !line1 || !line2) {
    throw new Error(`CelesTrak has no current TLE for NORAD ${Number(norad)}: it may have re-entered, or its orbit isn't public.`);
  }
  return [{ epoch: new Date(tleEpochMs(line1)).toISOString(), source: "CelesTrak (latest)", line1, line2 }];
}

// A TLE's epoch, from columns 19-32 of line 1: a 2-digit year, then the day of the year with a fraction.
function tleEpochMs(line1) {
  let year = Number(line1.slice(18, 20));
  year += year < 57 ? 2000 : 1900;                               // TLEs started in 1957
  return Date.UTC(year, 0, 1) + (Number(line1.slice(20, 32)) - 1) * DAY_MS;
}

// Name and designator for a satellite that isn't in our library, from the full catalog.
function satcatInfo(norad) {
  const entry = satcat.find(s => Number(s.norad) === Number(norad));
  return { name: entry?.name ?? `NORAD ${Number(norad)}`, intlDes: entry?.intlDes ?? null, country: null };
}

// Find the TLE whose epoch is closest to time ms. The epochs are sorted, so we can
// use a "binary search": check the middle, throw away the half that can't contain
// the answer, repeat. Finds the answer among 5,000 TLEs in about 13 steps.
function nearestTleIndex(lib, ms) {
  if (miniPinnedTles.has(lib)) return miniPinnedTles.get(lib);
  const epochs = lib.epochsMs;
  let low = 0, high = epochs.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (epochs[middle] < ms) low = middle + 1;
    else high = middle;
  }
  // "low" is now the first TLE at or after ms. The one just before might be closer.
  if (low > 0 && ms - epochs[low - 1] < epochs[low] - ms) return low - 1;
  return low;
}

function pinMiniTles(ms) {
  if (chapterMode.get("mini") !== "1") return;
  miniPinnedTles.clear();
  for (const slot of ["A", "B"]) {
    const lib = library[pair[slot]];
    if (lib?.epochsMs?.length) miniPinnedTles.set(lib, nearestTleIndex(lib, ms));
  }
}

// satellite.js turns a TLE into a "satrec" (satellite record) before it can propagate.
// Making one takes a little work, so we keep each one after making it.
function satrecFor(lib, index) {
  if (!lib.satrecs[index]) {
    lib.satrecs[index] = sgp4.twoline2satrec(lib.tles[index].line1, lib.tles[index].line2);
  }
  return lib.satrecs[index];
}

// Position [x, y, z] in km (TEME / ECI) of a satellite at time ms.
// If tleIndex is given, use that TLE; otherwise use the nearest one.
// Returns null if SGP4 fails (for example, a TLE that can't be propagated that far).
function stateAt(norad, ms, tleIndex = null) {
  const lib = library[norad];
  const index = tleIndex ?? nearestTleIndex(lib, ms);
  // The full view respects coverage and age limits. The miniature deliberately
  // propagates its one pinned TLE through the saved illustrative loop.
  if (episodeConfig && !miniScene && (ms < lib.coverage[0] || ms > lib.coverage[1] ||
      Math.abs(ms - lib.epochsMs[index]) > episodeConfig.maximumTleAgeDays * DAY_MS)) return null;
  const result = sgp4.propagate(satrecFor(lib, index), new Date(ms));
  if (!result.position) return null;
  const p = result.position, v = result.velocity;
  return { r: [p.x, p.y, p.z], v: [v.x, v.y, v.z] };
}
const positionAt = (norad, ms, tleIndex = null) => stateAt(norad, ms, tleIndex)?.r ?? null;

// Straight-line distance between two [x, y, z] positions in km (Pythagorean theorem in 3D).
function distanceKm(r1, r2) {
  const dx = r1[0] - r2[0], dy = r1[1] - r2[1], dz = r1[2] - r2[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// A speed in km/s as text: metres per second when slow (like the sheet's m/s), km/s when fast.
function formatSpeed(kmPerS) {
  return kmPerS < 1 ? `${Math.round(kmPerS * 1000).toLocaleString()} m/s` : `${kmPerS.toFixed(2)} km/s`;
}

// Distance between A and B at time ms, or null if either position is unavailable.
function separationAt(ms) {
  const a = positionAt(pair.A, ms), b = positionAt(pair.B, ms);
  return a && b ? distanceKm(a, b) : null;
}
// How fast A and B move compared with each other at time ms, in km/s, or null if unavailable.
// The velocities are [x, y, z] like positions, so distanceKm gives the size of their difference.
function relativeSpeedAt(ms) {
  const a = stateAt(pair.A, ms), b = stateAt(pair.B, ms);
  return a && b ? distanceKm(a.v, b.v) : null;
}

// The same speed in m/s, for the chart (the sheet uses m/s too).
function speedInMetresAt(ms) {
  const kmPerS = relativeSpeedAt(ms);
  return kmPerS === null ? null : kmPerS * 1000;
}











// ---------------------------------------------------------------------------
// 5. Set up the 3D scene: camera, renderer, Earth
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(chapterMode.get("mini") === "1" ? 0xfffcf6 : 0xffffff);

// PerspectiveCamera(field of view in degrees, aspect ratio, near limit, far limit)
const camera = new THREE.PerspectiveCamera(15.5, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(0, 4, 10);

// The renderer turns the scene into pixels on a <canvas> element on the page.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 3));
renderer.domElement.className = "sceneCanvas";
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

// Reading the canvas box forces the browser to lay the page out again, and this page
// reads it several times per frame. Measure it once and re-measure after a resize.
let canvasBox = null;
const canvasRect = () => (canvasBox ||= renderer.domElement.getBoundingClientRect());

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;      // Makes spinning feel smooth instead of jerky
controls.dampingFactor = 0.08;
controls.minDistance = 0.006;
controls.maxDistance = 180;
controls.addEventListener("start", () => { cameraTween = null; });  // If the user drags, cancel any automatic camera move
controls.addEventListener("end", () => { if (localChapterReview && view === "relative") { lastLocalRelativeTrailKey = ""; drawRelative(); } });

scene.add(new THREE.HemisphereLight(0xffffff, 0xeeeeee, 2.4));

// Earth is a sphere of radius 1. The country borders go inside the same group
// so they rotate together with the sphere.
const earthGroup = new THREE.Group();
const miniScene = chapterMode.get("mini") === "1";
const miniEarthRest = 0xd8cbb9, miniEarthHover = 0xcfbea9;
const miniReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let miniSceneHover = false;
const miniEarthColor = new THREE.Color(miniEarthRest);
const earthSurfaceMaterial = miniScene ? new THREE.ShaderMaterial({
  uniforms: { uColor: { value: miniEarthColor } },
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  vertexShader: `varying vec3 vViewNormal;
    void main() {
      vViewNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `uniform vec3 uColor; varying vec3 vViewNormal;
    void main() {
      float facing = max(0.0, normalize(vViewNormal).z);
      float shade = mix(0.81, 1.0, smoothstep(0.0, 0.95, facing));
      gl_FragColor = vec4(uColor * shade, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}) : new THREE.MeshBasicMaterial({ color: 0xf7f7f7 });
const earthSurface = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), earthSurfaceMaterial);
earthGroup.add(earthSurface);
const borderGroup = new THREE.Group();
earthGroup.add(borderGroup);
scene.add(earthGroup);

// Convert latitude/longitude (degrees) into a 3D point on the sphere.
function latLonToPoint(lat, lon, radius = 1.001) {
  const phi = THREE.MathUtils.degToRad(lat);
  const theta = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(
    radius * Math.cos(phi) * Math.cos(theta),
    radius * Math.sin(phi),
    -radius * Math.cos(phi) * Math.sin(theta)
  );
}

// Draw country borders. "async" means this function can wait for a file to download
// without freezing the page.
const borderLayers = { standard: null, detailed: null };
let miniBorderMap = null;
function buildMiniBorderMap(topology) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.strokeStyle = "rgba(85, 85, 85, .82)";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  const width = canvas.width, height = canvas.height;
  for (const feature of topojson.feature(topology, topology.objects.countries).features) {
    const geometry = feature.geometry;
    const rings = geometry.type === "Polygon" ? geometry.coordinates
                : geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : [];
    for (const ring of rings) {
      if (ring.length < 2) continue;
      for (const wrap of [-1, 0, 1]) {
        context.beginPath();
        let previousX = null;
        for (const [lon, lat] of ring) {
          // SphereGeometry maps +X (Greenwich in latLonToPoint) to U=.5 and
          // positive longitude toward -Z to increasing U.
          const x = (.5 + lon / 360 + wrap) * width;
          const y = (.5 - lat / 180) * height;
          if (previousX === null || Math.abs(x - previousX) > width / 2) context.moveTo(x, y);
          else context.lineTo(x, y);
          previousX = x;
        }
        context.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return new THREE.Mesh(new THREE.SphereGeometry(1.003, 160, 160),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
}
async function buildBorders(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("SBI country boundaries unavailable");
    const topology = await response.json();
    if (miniScene && !miniBorderMap) {
      miniBorderMap = buildMiniBorderMap(topology);
      if (miniBorderMap) borderGroup.add(miniBorderMap);
    }
    // Adjacent country polygons repeat their shared edges. Drawing every ring
    // separately produced overlapping translucent pixels and many draw calls,
    // which made borders flicker while the camera moved.
    const seen = new Set(), positions = [], radius = miniScene ? 1.003 : 1.0017;
    const key = coordinate => `${coordinate[0].toFixed(5)},${coordinate[1].toFixed(5)}`;
    for (const feature of topojson.feature(topology, topology.objects.countries).features) {
      const geometry = feature.geometry;
      const rings = geometry.type === "Polygon" ? geometry.coordinates
                  : geometry.type === "MultiPolygon" ? geometry.coordinates.flat()
                  : [];
      for (const ring of rings) {
        if (ring.length < 3) continue;
        for (let i = 1; i < ring.length; i++) {
          const first = ring[i - 1], second = ring[i];
          const segmentKey = [key(first), key(second)].sort().join("|");
          if (seen.has(segmentKey)) continue;
          seen.add(segmentKey);
          const a = latLonToPoint(first[1], first[0], radius);
          const b = latLonToPoint(second[1], second[0], radius);
          const angle = a.angleTo(b);
          if (angle > THREE.MathUtils.degToRad(25)) continue;
          const steps = Math.max(1, Math.ceil(THREE.MathUtils.radToDeg(angle)));
          let last = a;
          for (let step = 1; step <= steps; step++) {
            const next = a.clone().lerp(b, step / steps).normalize().multiplyScalar(radius);
            positions.push(...last.toArray(), ...next.toArray()); last = next;
          }
        }
      }
    }
    const boundaryGeometry = new THREE.BufferGeometry();
    boundaryGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const borders = new THREE.LineSegments(boundaryGeometry,
      new THREE.LineBasicMaterial({ color: 0x626262, transparent: true, opacity: .85, depthTest: true, depthWrite: false }));
    borders.renderOrder = 3;
    return borders;
}
async function loadBorders() {
  try {
    borderLayers.standard = await buildBorders("vendor/countries-110m.json");
    borderGroup.add(borderLayers.standard);
  } catch (error) {
    console.warn("Political boundaries unavailable", error);
  }
}
// The 50 m outline file is three quarters of a megabyte and only shows when zoomed
// right in, so it is fetched the first time the camera gets that close, not at startup.
let detailedBordersLoading = false;
function loadDetailedBorders() {
  if (detailedBordersLoading || borderLayers.detailed) return;
  detailedBordersLoading = true;
  buildBorders("vendor/countries-50m.json").then(borders => {
    borders.visible = false;
    borderGroup.add(borders);
    borderLayers.detailed = borders;
  }).catch(error => console.warn("Detailed political boundaries unavailable", error));
}
loadBorders();
function updateBorderDetail() {
  if (!borderLayers.standard) return;
  if (miniScene) {
    borderLayers.standard.visible = !miniBorderMap;
    if (borderLayers.detailed) borderLayers.detailed.visible = false;
    borderLayers.standard.material.opacity = .62;
    return;
  }
  const distance = Math.max(.01, camera.position.length());
  const diameter = canvasRect().height /
    (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance);
  // SBI's 110 m outline is crisper at ordinary globe sizes. Its 50 m outline
  // appears only when zoomed far enough for the added vertices to be resolved.
  const wantsDetailed = borderLayers.detailed
    ? (borderLayers.detailed.visible ? diameter > 620 : diameter > 760)
    : diameter > 760;
  if (wantsDetailed && !borderLayers.detailed) loadDetailedBorders();
  const detailed = wantsDetailed && !!borderLayers.detailed;
  borderLayers.standard.visible = !detailed;
  if (borderLayers.detailed) borderLayers.detailed.visible = detailed;
  // Subpixel political lines cannot stay continuous on a tiny globe. Fade them
  // in smoothly as the projected Earth becomes large enough to resolve them.
  const opacity = view === "earth"
    ? .85 * THREE.MathUtils.smoothstep(diameter, 65, 115)
    : .85 * THREE.MathUtils.smoothstep(diameter, 95, 190);
  borderLayers.standard.material.opacity = opacity;
  if (borderLayers.detailed) borderLayers.detailed.material.opacity = opacity;
}

const GEO_RADIUS_KM = 42164;
let geoReferenceLongitudeDeg = 38;
const earthAxis = new THREE.Vector3(0, 1, 0);
function geoReferenceWorld(ms) {
  return latLonToPoint(0, geoReferenceLongitudeDeg, GEO_RADIUS_KM / EARTH_RADIUS_KM)
    .applyAxisAngle(earthAxis, sgp4.gstime(new Date(ms)));
}
const geoBelt = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints(Array.from({ length: 360 }, (_, i) => latLonToPoint(0, i - 180, GEO_RADIUS_KM / EARTH_RADIUS_KM))),
  new THREE.LineBasicMaterial({ color: 0xb8aa84, transparent: true, opacity: .62, depthWrite: false })
);
geoBelt.visible = false;
earthGroup.add(geoBelt);
const geoBeltLabel = document.getElementById("geoBeltLabel");
function updateGeoBeltLabel() {
  if (view !== "relative" || !geoBelt.visible || cameraTween) { geoBeltLabel.hidden = true; return; }
  earthGroup.updateMatrixWorld(true);
  const rect = canvasRect();
  const project = lon => {
    const p = earthGroup.localToWorld(latLonToPoint(0, lon, GEO_RADIUS_KM / EARTH_RADIUS_KM + .01)).project(camera);
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2, z: p.z };
  };
  // Put the label at a fixed screen position along the projected belt, away
  // from the encounter. Hide it if that position would cover a spacecraft name.
  const p = project(geoReferenceLongitudeDeg), before = project(geoReferenceLongitudeDeg - .3), after = project(geoReferenceLongitudeDeg + .3);
  const dx = after.x - before.x;
  if (p.z < -1 || p.z > 1 || Math.abs(dx) < 5) {
    geoBeltLabel.hidden = true; return;
  }
  const x = rect.left + Math.min(135, rect.width * .17);
  const y = p.y + (after.y - before.y) / dx * (x - p.x);
  if (y < rect.top + 35 || y > rect.bottom - 35) { geoBeltLabel.hidden = true; return; }
  let angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  geoBeltLabel.hidden = false;
  geoBeltLabel.style.left = `${Math.round(x)}px`; geoBeltLabel.style.top = `${Math.round(y)}px`;
  geoBeltLabel.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
  const labelBox = geoBeltLabel.getBoundingClientRect();
  for (const name of document.querySelectorAll(".satelliteScreenLabel")) {
    if (name.hidden) continue;
    const box = name.getBoundingClientRect();
    if (labelBox.left < box.right + 10 && labelBox.right > box.left - 10 && labelBox.top < box.bottom + 6 && labelBox.bottom > box.top - 6) {
      geoBeltLabel.hidden = true; break;
    }
  }
}

// Turn an ECI position [x, y, z] in km into a point in the 3D scene.
// three.js treats "y" as up, but in ECI "z" points to the North Pole, so we swap axes.
const eciToScene = r => new THREE.Vector3(r[0] / EARTH_RADIUS_KM, r[2] / EARTH_RADIUS_KM, -r[1] / EARTH_RADIUS_KM);











// ---------------------------------------------------------------------------
// 6. Create the two satellite dots and two orbit lines (one per slot)
// ---------------------------------------------------------------------------
// Draw a filled circle with a black outline onto a small image, to use as a dot.
const dots = {};    // dots.A and dots.B
const trails = {};  // trails.A and trails.B
for (const slot of ["A", "B"]) {
  const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(SLOTS[slot].dot), sizeAttenuation: false, transparent: true, depthTest: !miniScene, depthWrite: false }));
  dot.scale.set(0.055, 0.055, 1);
  dot.renderOrder = slot === "A" ? 9 : 8;
  scene.add(dot);
  dots[slot] = dot;

  const material = fadingTrailMaterial(slot);
  material.uniforms.uOpacity.value = slot === "B" ? .85 : 1;
  material.depthTest = !miniScene;
  const trail = new THREE.Mesh(new THREE.BufferGeometry(), material);
  scene.add(trail);
  trails[slot] = trail;
}

// A TLE more than STALE_DAYS from the current moment gives unreliable positions
// (the same rule the "Now modeling" panel uses to turn red).
const tleIsStale = (lib, index) => Math.abs(currentMs - lib.epochsMs[index]) / DAY_MS > STALE_DAYS;

// Show a line dashed (unreliable TLE) or solid. The dash size is set every frame in animate().
function setDashed(line, dashed) {
  line.material = dashed ? line.userData.dashed : line.userData.solid;
  if (!dashed) return;
  line.computeLineDistances();
}


// Name labels that sit next to each dot in the 3D view.
// Text is drawn onto a small image (a "canvas"), which becomes the label's texture.
const labels = {};  // labels.A and labels.B
for (const slot of ["A", "B"]) {
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true, sizeAttenuation: false }));
  // Where the label sits next to its dot: A's just above and to the right, B's just below and to the
  // right, so the two names don't overlap when the satellites are close together.
  label.center.set(-0.1, 0.5);
  label.scale.set(0.29, 0.055, 1);   // the label image is 5.33 times wider than it is tall
  label.renderOrder = 9;
  label.visible = false;
  scene.add(label);
  labels[slot] = label;
}
// DOM labels remain crisp at every pixel ratio. Their normal position follows
// the marker; a persistent screen-space offset resolves collisions smoothly.
const satelliteScreenLabels = document.createElement("div");
satelliteScreenLabels.id = "satelliteScreenLabels";
const screenLabelNodes = {};
const labelMotion = { A: { x: null, y: null, offset: 0 }, B: { x: null, y: null, offset: 0 } };
let labelsSeparated = false;
let upperLabel = "A";
for (const slot of ["A", "B"]) {
  const node = document.createElement("span"); node.className = `satelliteScreenLabel slot${slot}`;
  satelliteScreenLabels.append(node); screenLabelNodes[slot] = node;
}
document.body.append(satelliteScreenLabels);
// A label's box only changes when its text does, so measure it then and remember it.
// Reading offsetWidth on every frame would lay the page out again on every frame.
const labelSizes = { A: { text: null, width: 0, height: 0 }, B: { text: null, width: 0, height: 0 } };
function labelSize(slot, node) {
  const cached = labelSizes[slot];
  if (cached.text !== node.textContent) {
    cached.text = node.textContent;
    cached.width = node.offsetWidth;
    cached.height = node.offsetHeight;
  }
  return cached;
}
function updateScreenLabels() {
  const rect = canvasRect();
  const positions = {}, radius = DOT_SCREEN_SIZE * rect.height / 2;
  for (const slot of ["A", "B"]) {
    const node = screenLabelNodes[slot], dot = dots[slot];
    if (!dot.visible) { node.hidden = true; labelMotion[slot].x = null; continue; }
    const point = dot.position.clone().project(camera);
    const x = rect.left + (point.x + 1) * rect.width / 2;
    const y = rect.top + (1 - point.y) * rect.height / 2;
    node.hidden = point.z < -1 || point.z > 1 || x < rect.left || x > rect.right || y < 0 || y > innerHeight;
    if (node.hidden) { labelMotion[slot].x = null; continue; }
    const size = labelSize(slot, node);
    positions[slot] = { markerX: x, markerY: y, left: x + radius + 10, y, width: size.width, height: size.height };
  }
  const a = positions.A, b = positions.B;
  if (a && b) {
    const wasSeparated = labelsSeparated;
    const horizontalOverlap = a.left < b.left + b.width + 4 && b.left < a.left + a.width + 4;
    const verticalGap = Math.abs(a.y - b.y);
    const labelCollision = horizontalOverlap && verticalGap < Math.max(a.height, b.height) + (labelsSeparated ? 17 : 4);
    const crossesMarker = (label, marker) => label.left < marker.markerX + radius + 5 && label.left + label.width > marker.markerX - radius - 5 && Math.abs(label.y - marker.markerY) < label.height / 2 + radius + (labelsSeparated ? 14 : 4);
    labelsSeparated = labelCollision || crossesMarker(a, b) || crossesMarker(b, a);
    if (labelsSeparated && !wasSeparated && Math.abs(a.y - b.y) > 4) upperLabel = a.y < b.y ? "A" : "B";
  } else {
    labelsSeparated = false;
  }
  for (const slot of ["A", "B"]) {
    const position = positions[slot];
    if (!position) continue;
    const state = labelMotion[slot], node = screenLabelNodes[slot];
    const sign = slot === upperLabel ? -1 : 1;
    const targetOffset = labelsSeparated ? sign * Math.max(radius + 9, position.height / 2 + 10) : 0;
    // Marker and label use the same projected position on every render path.
    state.x = position.left;
    state.y = position.y;
    state.offset = labelsSeparated ? targetOffset : state.offset * .7;
    node.style.left = `${Math.round(state.x * 2) / 2}px`;
    node.style.top = `${Math.round((state.y + state.offset) * 2) / 2}px`;
  }
}
// Flag pictures, loaded once each: flagImages.us is a promise of the loaded image.
const flagImages = {};
function loadFlag(flag) {
  if (!flagImages[flag]) {
    const image = new Image();
    image.src = `assets/flags/${flag}.svg`;
    flagImages[flag] = image.decode().then(() => image);
  }
  return flagImages[flag];
}

const labelVersion = { A: 0, B: 0 };   // counts label changes, so a slow flag can't overwrite a newer label
async function setLabelText(slot, text, flags = []) {
const version = ++labelVersion[slot];
  const images = await Promise.all(flags.map(loadFlag));
  if (version !== labelVersion[slot]) return;    // the label changed while the flags were loading
  // Draw at the label's real size on screen (in screen pixels), so nothing gets stretched or squashed.
  // The drawing below is written for a 96-pixel-tall label; "sharpness" scales it to the real size.
  const sharpness = Math.max(1, LABEL_SCREEN_SIZE * renderer.domElement.height / 96);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(512 * sharpness); canvas.height = Math.round(96 * sharpness);
  const ctx = canvas.getContext("2d");
  ctx.scale(sharpness, sharpness);
  let x = 8;
  for (const image of images) {                  // each flag 40 px tall, as wide as its shape needs
    const width = 40 * image.naturalWidth / image.naturalHeight;
    ctx.drawImage(image, x, 28, width, 40);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
    ctx.strokeRect(x, 28, width, 40);
    x += width + 8;
  }
  ctx.font = "650 44px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillStyle = "#333";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, 48);
  labels[slot].material.map?.dispose();   // throw away the old texture to free memory
  labels[slot].material.map = new THREE.CanvasTexture(canvas);
  labels[slot].material.map.colorSpace = THREE.SRGBColorSpace;   // show #333 as a true dark grey
  labels[slot].material.map.minFilter = THREE.LinearFilter;   // shown at its own size, so no blurry shrinking
  labels[slot].material.map.generateMipmaps = false;
  labels[slot].material.needsUpdate = true;
}












// ---------------------------------------------------------------------------
// 7. Formatting helpers
// ---------------------------------------------------------------------------
// Building an Intl.DateTimeFormat is expensive and these format the current time on
// every frame, so each pattern is built once here and reused.
const utcFormat = options => new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
const TIME_FORMAT = utcFormat({ year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const DATE_FORMAT = utcFormat({ year: "numeric", month: "long", day: "numeric" });
const SLIDER_FORMAT = utcFormat({ month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const formatTime = ms => TIME_FORMAT.format(new Date(ms)) + " UTC";
const formatDate = ms => DATE_FORMAT.format(new Date(ms));

// <input type="datetime-local"> uses text like "2020-01-02T10:16". We always treat it as UTC.
const toInputValue = ms => new Date(ms).toISOString().slice(0, 16);
const fromInputValue = text => Date.parse(text + ":00Z");

function describeAge(ageMs) {
  const hours = Math.floor(Math.abs(ageMs) / 3600000);
  return `${hours === 0 ? "" : ageMs < 0 ? "−" : "+"}${hours} ${hours === 1 ? "hour" : "hours"}`;
}











// ---------------------------------------------------------------------------
// 8. Updating the picture
// ---------------------------------------------------------------------------
// Called every time the time changes: move the dots, update numbers, chart and panel.
function updateScene() {
  if (!pair.A || !pair.B) return;
  // A miniature is one scene. Keep its last complete frame when a sparse
  // propagation sample fails, instead of hiding individual spacecraft.
  if (miniScene && (["A", "B"].some(slot => positionAt(pair[slot], currentMs, nearestTleIndex(library[pair[slot]], currentMs)) === null)
    || view === "relative" && relativePointAt(currentMs) === null)) return;
  const positions = {};
  const earthAngle = sgp4.gstime(new Date(currentMs));

  for (const slot of ["A", "B"]) {
    const norad = pair[slot];
    const lib = library[norad];
    const tleIndex = nearestTleIndex(lib, currentMs);
    // While playing, a change of TLE starts a flash (jumps with the slider or buttons don't)
    if (playing && lastTleIndex[slot] !== null && tleIndex !== lastTleIndex[slot]) {
      flashUntil[slot] = performance.now() + TLE_FLASH_MS;
    }
    lastTleIndex[slot] = tleIndex;

    const r = positionAt(norad, currentMs, tleIndex);
    positions[slot] = r;

    dots[slot].visible = r !== null;
    if (r) {
      dots[slot].position.copy(eciToScene(r));
      if (view === "earth" && !localChapterReview) dots[slot].position.applyAxisAngle(earthAxis, -earthAngle);
    }

    if (!r) { trails[slot].geometry.dispose(); trails[slot].geometry = new THREE.BufferGeometry(); continue; }
    if (localChapterReview && view === "relative") continue;
    // The orbit line shows the last full orbit, all from the TLE in use right now
    // (so it doesn't jump when the nearest TLE changes partway along it).
    // satrec.no is the mean motion in radians per minute, so one orbit = 2π / no minutes.
    const points = [];
    if (localChapterReview && view === "earth") {
      // Keep the ECI tail at the same visible length as the other episodes.
      const orbitMs = (2 * Math.PI / satrecFor(lib, tleIndex).no) * MINUTE_MS;
      const stepMs = Math.max(30 * 1000, Math.min(5 * MINUTE_MS, orbitMs / 120));
      const lookbackMs = Math.min(12 * 60 * MINUTE_MS, Math.max(0, currentMs - startMs));
      camera.updateMatrixWorld(true);
      let previous = null, screenLength = 0;
      for (let elapsed = 0; elapsed <= lookbackMs + stepMs / 2; elapsed += stepMs) {
        const p = positionAt(norad, currentMs - Math.min(elapsed, lookbackMs), tleIndex);
        if (!p) { if (points.length) break; continue; }
        const point = eciToScene(p), projected = point.clone().project(camera);
        const screen = new THREE.Vector2(projected.x * renderer.domElement.clientWidth / 2, projected.y * renderer.domElement.clientHeight / 2);
        if (previous) screenLength += screen.distanceTo(previous);
        previous = screen; points.push(point);
        if (screenLength >= 260 || elapsed >= lookbackMs) break;
      }
      points.reverse();
    } else {
      const periodMs = view === "relative" || (view === "earth" && Math.hypot(...r) > HIGH_ORBIT_KM)
        ? 2 * DAY_MS : (2 * Math.PI / satrecFor(lib, tleIndex).no) * MINUTE_MS;
      for (let i = 0; i <= TRAIL_POINTS; i++) {
        const trailTime = currentMs - periodMs * (1 - i / TRAIL_POINTS);
        const p = positionAt(norad, trailTime, tleIndex);
        if (p) {
          const point = eciToScene(p);
          if (view === "relative") point.applyAxisAngle(earthAxis, earthAngle - sgp4.gstime(new Date(trailTime)));
          else point.applyAxisAngle(earthAxis, -sgp4.gstime(new Date(trailTime)));
          points.push(point);
        }
      }
    }
    trails[slot].geometry.dispose();
    trails[slot].geometry = fadingTrailGeometry(points);
  }

  const km = positions.A && positions.B ? distanceKm(positions.A, positions.B) : null;
  $("rangeStat").textContent = km === null ? "No data" : `${Math.round(km).toLocaleString()} km`;
  const unavailable = ["A", "B"].filter(slot => !positions[slot]).map(slotName);
  $("rangeNote").hidden = !unavailable.length;
  $("dataStatusSection").hidden = !unavailable.length;
  if (unavailable.length) $("rangeNote").textContent = `Historical position unavailable here for ${unavailable.join(" and ")} at this time.`;
  const speed = relativeSpeedAt(currentMs);
  $("speedStat").textContent = speed === null ? "No data" : formatSpeed(speed);
  $("geoReference").hidden = view !== "relative";
  $("geoReference").textContent = localChapterReview
    ? `Relative-motion origin: ${slotName(centre)}.`
    : `Camera reference: nominal GEO at ${geoReferenceLongitudeDeg.toFixed(1)}°E (Earth-fixed).`;
  $("timeDisplay").textContent = formatTime(currentMs).replace(" UTC", "");
  updatePlaybackCounter($("sliderNow"), currentMs - startMs, currentMs);
  if (localChapterReview) {
    $("sliderNow").textContent = SLIDER_FORMAT.format(new Date(currentMs)) + " UTC";
    $("sliderNow").setAttribute("aria-label", `Playback time: ${formatTime(currentMs)}`);
    $("sliderNow").removeAttribute("data-full-utc");
  }
  // Write the slider only when it really moved: assigning .value during a drag is
  // needless work, and the bare minimum of DOM writes keeps the thumb steady.
  if ($("timelineSlider").value !== String(currentMs)) $("timelineSlider").value = String(currentMs);
  $("timelineSlider").style.setProperty("--progress", `${(currentMs - startMs) / (endMs - startMs) * 100}%`);   // gold "played so far" part of the time bar

  // Spin Earth to the right angle for this moment (Greenwich sidereal time).
  // latLonToPoint and eciToScene map positive longitude toward negative scene Z;
  // a positive sidereal rotation therefore carries Earth-fixed longitude into ECI.
  earthGroup.rotation.y = view === "earth" && !localChapterReview ? 0 : earthAngle;

  // Relative motion keeps Willa's ECI scene. The globe mode instead rotates
  // each propagated ECI position into Earth-fixed coordinates above.
  earthGroup.visible = true;
  if (localChapterReview && view === "relative") {
    earthGroup.matrixAutoUpdate = false;
    trails.A.visible = trails.B.visible = false;
    drawRelative();
  } else if (localChapterReview) {
    earthGroup.matrixAutoUpdate = true;
    trails.A.visible = trails.B.visible = true;
    relativeTrail.visible = false;
    localMotionTrail.visible = false;
    const lib = library[pair[centre]];
    const index = nearestTleIndex(lib, currentMs);
    const periodMs = 2 * Math.PI / satrecFor(lib, index).no * MINUTE_MS;
    const orbitPoints = [];
    for (let i = 0; i <= 180; i++) {
      const sample = sgp4.propagate(satrecFor(lib, index), new Date(currentMs + periodMs * (i / 180 - .5))).position;
      if (sample) orbitPoints.push(eciToScene([sample.x, sample.y, sample.z]));
    }
    if (orbitPoints.length > 1) orbitPoints.push(orbitPoints[0].clone());
    if (orbitPoints.length > 1 || !miniScene) {
      localReferenceOrbit.geometry.dispose();
      localReferenceOrbit.geometry = new THREE.BufferGeometry().setFromPoints(orbitPoints);
      localReferenceOrbit.visible = orbitPoints.length > 1;
    }
  }

  for (const slot of ["A", "B"]) {             // name labels follow their dots
    labels[slot].position.copy(dots[slot].position);
    labels[slot].visible = false;
  }

  if (chartDirty || performance.now() - lastChartDraw > 120) { drawEpisodeCharts(); lastChartDraw = performance.now(); }
  updateIdentity();

}

// One synchronized, quality-gated series drives both fixed-domain charts and dwell.
function prepareAnalysis() {
  if (!episodeConfig || !pair.A || !pair.B) return;
  analysisSamples = sampleEpisode(localChapterReview ? startMs : episodeStartMs, localChapterReview ? endMs : episodeEndMs, analysisStepMs, ms => {
    const tleA = nearestTleIndex(library[pair.A], ms), tleB = nearestTleIndex(library[pair.B], ms);
    const a = stateAt(pair.A, ms, tleA), b = stateAt(pair.B, ms, tleB);
    return { tleA, tleB, distanceKm: a && b ? distanceKm(a.r, b.r) : null,
      speedMps: a && b ? distanceKm(a.v, b.v) * 1000 : null };
  });
  // The 15-minute analysis remains authoritative. Drawing uses propagated
  // midpoints and both limits at each nearest-TLE change; a switch gets a
  // visible vertical join at its actual boundary instead of a blank interval.
  chartSamples = [];
  const chartPoint = (ms, tleA, tleB, kind = "regular") => {
    const a = stateAt(pair.A, ms, tleA), b = stateAt(pair.B, ms, tleB);
    return { ms, tleA, tleB, kind, distanceKm: a && b ? distanceKm(a.r, b.r) : null,
      speedMps: a && b ? distanceKm(a.v, b.v) * 1000 : null };
  };
  for (let index = 0; index < analysisSamples.length; index++) {
    const first = analysisSamples[index], second = analysisSamples[index + 1];
    chartSamples.push(first);
    if (!second || !Number.isFinite(first.distanceKm) || !Number.isFinite(second.distanceKm) ||
        !Number.isFinite(first.speedMps) || !Number.isFinite(second.speedMps)) continue;
    if (first.tleA === second.tleA && first.tleB === second.tleB) {
      chartSamples.push(chartPoint((first.ms + second.ms) / 2, first.tleA, first.tleB));
      continue;
    }
    let cursor = first.ms, activeA = first.tleA, activeB = first.tleB;
    for (let switchCount = 0; switchCount < 4 &&
        (activeA !== second.tleA || activeB !== second.tleB); switchCount++) {
      let low = cursor, high = second.ms;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (nearestTleIndex(library[pair.A], middle) === activeA &&
            nearestTleIndex(library[pair.B], middle) === activeB) low = middle;
        else high = middle;
      }
      const nextA = nearestTleIndex(library[pair.A], high), nextB = nearestTleIndex(library[pair.B], high);
      const before = chartPoint(high, activeA, activeB, "switch-before");
      const after = chartPoint(high, nextA, nextB, "switch-after");
      chartSamples.push(before, after);
      cursor = high; activeA = nextA; activeB = nextB;
    }
  }
  const valid = analysisSamples.filter(s => Number.isFinite(s.distanceKm) && Number.isFinite(s.speedMps));
  const scaleFor = key => {
    const maximum = valid.reduce((highest, sample) => Math.max(highest, sample[key]), 0);
    if (!(maximum > 0)) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(maximum));
    const step = magnitude / 2;
    return Number(((Math.floor(maximum / step) + 1) * step).toPrecision(10));
  };
  chartScales = { distanceKm: scaleFor("distanceKm"), speedMps: scaleFor("speedMps") };
  const changes = [];
  for (const [inputId, bound, unit] of [["distanceThreshold", chartScales.distanceKm, "km"], ["speedThreshold", chartScales.speedMps, "m/s"]]) {
    const input = $(inputId), previous = Number(input.value);
    if (previous > bound) { input.value = String(bound); changes.push(`${unit} threshold adjusted to the episode range`); }
  }
  $("thresholdRangeNote").textContent = changes.join("; ");
  updateThresholds();
}
function displaySatelliteName(value) {
  return value === value.toUpperCase() ? value.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase()) : value;
}
let singleThresholdIntervals = [];
function updateThresholds() {
  if (!analysisSamples.length) return;
  const distance = Number($("distanceThreshold").value), speed = Number($("speedThreshold").value);
  if (!(distance >= 0) || !(speed >= 0)) return;
  for (const [sliderId, outputId, value, max, unit] of [
    ["distanceThresholdSlider", "distanceThresholdOutput", distance, chartScales.distanceKm, "km"],
    ["speedThresholdSlider", "speedThresholdOutput", speed, chartScales.speedMps, "m/s"]
  ]) {
    const slider = $(sliderId);
    slider.min = "0"; slider.max = String(max); slider.value = String(value);
    slider.style.setProperty("--threshold-progress", `${Math.min(100, Math.max(0, value / max * 100))}%`);
    slider.setAttribute("aria-valuetext", `${value.toLocaleString()} ${unit}`);
    $(outputId).textContent = `${value.toLocaleString()} ${unit}`;
  }
  $("thresholdSummary").textContent = `${distance.toLocaleString()} km · ${speed.toLocaleString()} m/s`;
  analysisResult = analyzeEpisode(analysisSamples, distance, speed, analysisStepMs);
  const distanceIntervals = analyzeEpisode(analysisSamples, distance, Infinity, analysisStepMs).intervals;
  const speedIntervals = analyzeEpisode(analysisSamples, Infinity, speed, analysisStepMs).intervals;
  singleThresholdIntervals = exclusiveQualificationIntervals(distanceIntervals, speedIntervals).single;
  $("dwellStat").textContent = formatDwellDuration(analysisResult.totalMs);
  $("dwellUnit").textContent = "";
  const dwellKey = $("dwellMetric")?.querySelector(".dwellKey");
  if (dwellKey) {
    const chaser = document.createElement("em"), target = document.createElement("em");
    const distanceValue = document.createElement("strong"), speedValue = document.createElement("strong");
    const gray = document.createElement("strong"), gold = document.createElement("strong");
    gray.className = "single"; gray.textContent = "Gray"; gold.className = "both"; gold.textContent = "gold";
    chaser.textContent = slotName("A").toUpperCase(); target.textContent = slotName("B").toUpperCase();
    distanceValue.textContent = `${distance.toLocaleString()} km`;
    speedValue.textContent = speed < 1000 ? `${speed.toLocaleString()} m/s` : `${Number((speed / 1000).toFixed(2))} km/s`;
    dwellKey.replaceChildren("The cumulative time within this ", String(Math.round((endMs - startMs) / 3600000)), "-hour chapter during which ", chaser,
      " is within ", distanceValue, " of ", target, " with a relative velocity at or below ", speedValue,
      ". ", gray, " marks one threshold; ", gold, " marks both.");
  }
  renderDwellSegments();
  const minimum = (id, item, unit, metric) => {
    renderEstimatedMinimum($(id), { episodeId: "E-001", metric, value: item?.value, unit, ms: item?.ms, onJump(ms) {
      const slider = $("timelineSlider");
      slider.value = Math.max(startMs, Math.min(endMs, ms));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      focusedMinimumMs = ms;
      chartDirty = true; drawEpisodeCharts();
      slider.focus({ preventScroll: true });
    } });
  };
  minimum("distanceMinimum", analysisResult.minimumDistance, "km", "separationKm");
  minimum("speedMinimum", analysisResult.minimumSpeed, "m/s", "relativeSpeedMps");
  if (localChapterReview) {
    for (const id of ["distanceMinimum", "speedMinimum"]) {
      const caption = $(id).querySelector(".estimateCaption");
      if (caption) caption.textContent = "Minimum this episode:";
      $(id).querySelector(".estimateInfo")?.remove();
    }
  }
  chartDirty = true; drawEpisodeCharts();
}
function drawEpisodeCharts() {
  if (!analysisSamples.length || !analysisResult) return;
  if (localChapterReview) {
    const now = {
      ms: currentMs,
      tleA: nearestTleIndex(library[pair.A], currentMs),
      tleB: nearestTleIndex(library[pair.B], currentMs),
      distanceKm: separationAt(currentMs),
      speedMs: speedInMetresAt(currentMs)
    };
    const samples = chartSamples.filter(sample => sample.ms <= currentMs).map(sample => ({ ...sample, speedMs: sample.speedMps }));
    if (!samples.some(sample => sample.ms === currentMs)) samples.push(now);
    const window = { id: `e001-${startMs}`, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
    const qualifications = { single: singleThresholdIntervals, both: { intervals: analysisResult.intervals } };
    for (const [canvasId, metric, thresholdId, title, maximum] of [
      ["separationChart", "distanceKm", "distanceThreshold", "Separation distance (km)", chartScales.distanceKm],
      ["speedChart", "speedMs", "speedThreshold", "Relative velocity (m/s)", chartScales.speedMps]
    ]) {
      const canvas = $(canvasId), scale = localChartModule.drawOrbitalChart(canvas, samples, metric, {
        window, currentMs, threshold: Number($(thresholdId).value), title, maximum, qualifications,
        markedMs: focusedMinimumMs, speedUnit: "m/s", connectSwitches: true
      });
      chartGeometry.set(canvas, { top: scale.top, bottom: scale.bottom, left: scale.left, right: scale.right,
        yMax: scale.max, thresholdY: scale.thresholdY });
    }
    chartDirty = false;
    return;
  }
  drawFixedChart("separationChart", "distanceKm", chartScales.distanceKm, Number($("distanceThreshold").value), "km");
  drawFixedChart("speedChart", "speedMps", chartScales.speedMps, Number($("speedThreshold").value), "m/s");
  chartDirty = false;
}
function renderDwellSegments() {
  const host = $("dwellSegments");
  if (!host || !analysisResult || !(endMs > startMs)) return;
  host.replaceChildren();
  for (const [intervals, kind] of [[singleThresholdIntervals, "single"], [analysisResult.intervals, "both"]]) for (const interval of intervals) {
    const left = Math.max(startMs, interval.start), right = Math.min(endMs, interval.end);
    if (right <= left) continue;
    const mark = document.createElement("span");
    mark.className = kind;
    mark.style.left = `${(left - startMs) / (endMs - startMs) * 100}%`;
    mark.style.width = `${(right - left) / (endMs - startMs) * 100}%`;
    host.append(mark);
  }
}
const chartGeometry = new Map();
const hoveredChartLines = new Set();
const visibleCharts = new Set();
const chartsSeenOutside = new Set();
const initiallyVisibleCharts = new Set();
const chartRatios = new Map();
let chartCuesReady = false;
const chartCueStarts = new Map();
const chartCueFinished = new Set();
const reducedChartMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const chartVisibilityObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    chartRatios.set(entry.target, entry.intersectionRatio);
    if (!chartCuesReady) continue;
    if (entry.intersectionRatio < .85) { chartsSeenOutside.add(entry.target); visibleCharts.delete(entry.target); }
    else if (chartsSeenOutside.has(entry.target)) visibleCharts.add(entry.target);
  }
  chartDirty = true;
}, { root: $("ui"), threshold: [.85] });
for (const id of ["separationChart", "speedChart"]) chartVisibilityObserver.observe($(id));
$("ui").addEventListener("scroll", () => {
  const panel = $("ui").getBoundingClientRect();
  for (const chart of initiallyVisibleCharts) {
    const rect = chart.getBoundingClientRect();
    const shown = Math.max(0, Math.min(rect.bottom, panel.bottom) - Math.max(rect.top, panel.top)) / rect.height;
    if (shown >= .85) visibleCharts.add(chart);
    else chartsSeenOutside.add(chart);
    initiallyVisibleCharts.delete(chart);
    chartDirty = true;
  }
}, { passive: true });
function thresholdCueOffset(canvas) {
  if (!chartCuesReady || reducedChartMotion.matches || chartCueFinished.has(canvas) || !visibleCharts.has(canvas) || !analysisSamples.length) return 0;
  if (!chartCueStarts.has(canvas)) chartCueStarts.set(canvas, performance.now());
  const elapsed = performance.now() - chartCueStarts.get(canvas);
  if (elapsed >= 1200) { chartCueFinished.add(canvas); return 0; }
  const frames = [[0, 0], [.3, -8], [.65, 5], [1, 0]], fraction = elapsed / 1200;
  const index = frames.findIndex((frame, i) => i && fraction <= frame[0]);
  const [start, end] = [frames[index - 1], frames[index]];
  const t = (fraction - start[0]) / (end[0] - start[0]), smooth = t * t * (3 - 2 * t);
  return start[1] + (end[1] - start[1]) * smooth;
}
function drawFixedChart(canvasId, key, yMax, threshold, unit) {
  const canvas = $(canvasId), ctx = canvas.getContext("2d");
  const w = Math.max(240, Math.round(canvas.getBoundingClientRect().width));
  const h = Math.max(150, Math.round(canvas.getBoundingClientRect().height));
  const pixelRatio = Math.min(devicePixelRatio || 1, 3);
  if (canvas.width !== Math.round(w * pixelRatio) || canvas.height !== Math.round(h * pixelRatio)) {
    canvas.width = Math.round(w * pixelRatio); canvas.height = Math.round(h * pixelRatio);
  }
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const pad = CHART_PADDING;
  const bottom = h - pad.bottom, right = w - pad.right;
  const windowMs = localChapterReview ? Math.max(MINUTE_MS, endMs - startMs) : 14 * 86400000;
  const windowStart = localChapterReview ? startMs : focusedMinimumMs === null ? currentMs - windowMs : focusedMinimumMs - windowMs / 2;
  const windowEnd = windowStart + windowMs;
  const x = ms => pad.left + (ms - windowStart) / windowMs * (right - pad.left);
  const y = value => bottom - Math.min(1, Math.max(0, value / yMax)) * (bottom - pad.top);
  const cue = thresholdCueOffset(canvas), thresholdY = y(threshold) + cue;
  canvas.dataset.thresholdCueOffset = cue.toFixed(2);
  chartGeometry.set(canvas, { top: pad.top, bottom, left: pad.left, right, yMax, thresholdY });
  const edge = canvas.parentElement.querySelector(".thresholdEdge");
  if (edge) {
    edge.style.top = `${canvas.offsetTop + Math.max(pad.top + 5, Math.min(bottom - 5, thresholdY))}px`;
    edge.textContent = `${threshold} ${unit}`;
    edge.setAttribute("aria-valuenow", String(threshold));
    edge.setAttribute("aria-valuemax", String(yMax));
    edge.setAttribute("aria-valuetext", `${threshold} ${unit}`);
  }
  ctx.clearRect(0, 0, w, h); ctx.font = "10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.save(); ctx.translate(22, (pad.top + bottom) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#555"; ctx.textAlign = "center";
  ctx.fillText(key === "distanceKm" ? "Estimated separation (km)" : "Estimated relative velocity (m/s)", 0, 0); ctx.restore();
  ctx.fillStyle = "#eeeeec"; ctx.fillRect(pad.left, y(threshold), right - pad.left, bottom - y(threshold));
  // UTC-anchored ticks share the data's time transform, so they slide with it.
  const tickMs = localChapterReview ? 3 * 60 * MINUTE_MS : 4 * DAY_MS;
  let lastTickRight = -Infinity;
  for (let ms = Math.ceil(windowStart / tickMs) * tickMs; ms <= windowEnd; ms += tickMs) {
    const px = x(ms);
    ctx.strokeStyle = "#cacaca"; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, bottom); ctx.stroke();
    if (px > pad.left + 34 && px < right - 34) {
      const fullDate = new Intl.DateTimeFormat("en-US", localChapterReview ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" } : { month: "long", day: "numeric", timeZone: "UTC" }).format(ms);
      ctx.fillStyle = "#777"; ctx.textAlign = "center";
      const labelWidth = ctx.measureText(fullDate).width;
      if (px - labelWidth / 2 > lastTickRight + 8 && px + labelWidth / 2 < right) {
        ctx.fillText(fullDate, px, h - 7); lastTickRight = px + labelWidth / 2;
      }
    }
  }
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const value = yMax * i / 4, py = y(value);
    if (i < 4) { ctx.strokeStyle = "#e2e2e2"; ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(right, py); ctx.stroke(); }
    ctx.fillStyle = "#777"; ctx.textAlign = "right"; ctx.fillText(Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1), pad.left - 5, py + 3);
  }
  ctx.strokeStyle = hoveredChartLines.has(canvas) ? "#898989" : "#b8b8b8"; ctx.lineWidth = hoveredChartLines.has(canvas) ? 1.35 : 1;
  ctx.beginPath(); ctx.moveTo(pad.left, thresholdY); ctx.lineTo(w - 56, thresholdY); ctx.stroke();
  ctx.strokeStyle = "#555"; ctx.lineWidth = 1.4; ctx.beginPath();
  let connected = false, clipped = false, previous = null, missingBreaks = 0;
  const switchJoins = [];
  for (const sample of chartSamples) {
    if (sample.ms > windowEnd || (focusedMinimumMs === null && sample.ms > currentMs)) break;
    if (sample.ms < windowStart) { previous = null; connected = false; continue; }
    const value = sample[key];
    if (!Number.isFinite(value)) { connected = false; previous = null; missingBreaks++; continue; }
    if (value > yMax) clipped = true;
    const px = x(sample.ms), py = y(value);
    if (sample.kind === "switch-after" && previous?.kind === "switch-before" && sample.ms === previous.ms)
      switchJoins.push([previous, sample]);
    if (!connected || !previous || sample.tleA !== previous.tleA || sample.tleB !== previous.tleB) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
    connected = true; previous = sample;
  }
  if (focusedMinimumMs === null && previous && currentMs > previous.ms && currentMs <= episodeEndMs) {
    const current = key === "distanceKm" ? separationAt(currentMs) : speedInMetresAt(currentMs);
    const a = nearestTleIndex(library[pair.A], currentMs), b = nearestTleIndex(library[pair.B], currentMs);
    if (Number.isFinite(current) && previous.tleA === a && previous.tleB === b) {
      if (current > yMax) clipped = true;
      ctx.lineTo(x(currentMs), y(current));
    }
  }
  ctx.stroke();
  // A thin vertical step joins the two valid model estimates at the exact
  // switch time. It does not invent intermediate distances or hide the jump.
  ctx.save(); ctx.strokeStyle = "#777"; ctx.lineWidth = 1.3;
  for (const [before, after] of switchJoins) {
    ctx.beginPath(); ctx.moveTo(x(before.ms), y(before[key])); ctx.lineTo(x(after.ms), y(after[key])); ctx.stroke();
  }
  ctx.restore();
  canvas.dataset.switchJoins = String(switchJoins.length);
  canvas.dataset.missingBreaks = String(missingBreaks);
  for (const [result, color] of [[{ intervals: singleThresholdIntervals }, "#a9a9a9"], [analysisResult, "#eaaa00"]]) {
    for (const interval of result?.intervals || []) {
      if (interval.start > windowEnd) break;
      const left = Math.max(windowStart, interval.start), end = Math.min(windowEnd, interval.end);
      if (end > left) { ctx.fillStyle = color; ctx.fillRect(x(left), bottom + 3, Math.max(1, x(end) - x(left)), 3); }
    }
  }
  if (clipped) { ctx.fillStyle = "#805e10"; ctx.textAlign = "right"; ctx.fillText("↑ clipped", right, 11); }
  if (focusedMinimumMs !== null) {
    ctx.save(); ctx.strokeStyle = "#8b806a"; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(x(focusedMinimumMs), pad.top); ctx.lineTo(x(focusedMinimumMs), bottom); ctx.stroke(); ctx.restore();
    canvas.dataset.focusedMinimumUtc = new Date(focusedMinimumMs).toISOString();
  } else delete canvas.dataset.focusedMinimumUtc;
  if (currentMs >= episodeStartMs && currentMs <= episodeEndMs) {
    const current = key === "distanceKm" ? separationAt(currentMs) : speedInMetresAt(currentMs);
    const label = canvas.parentElement.querySelector(".currentValue");
    if (label) {
      label.hidden = !Number.isFinite(current);
      if (Number.isFinite(current)) {
        label.textContent = `${current < 100 ? current.toFixed(1) : Math.round(current).toLocaleString()} ${unit}`;
        const position = Math.max(pad.top + 5, Math.min(bottom - 5, y(current)));
        label.style.top = `${canvas.offsetTop + position}px`;
      }
    }
  }
}

// Who owns a satellite, from the catalog's owner code: { name, flags } (flags = flag file names),
// or null if the catalog isn't loaded yet or has no owner for it.
// Space-Track calls Soviet and Russian objects both "CIS"; launched before 1992 means Soviet.
function ownerOf(norad) {
  const entry = satcat.find(s => Number(s.norad) === Number(norad));
  if (!entry?.owner) return null;
  const owner = owners[entry.owner] ?? { name: entry.owner, flags: [] };
  const launchYear = Number(entry.intlDes.slice(0, 4));
  if (entry.owner === "CIS" && launchYear < 1992) return { name: "Soviet Union", flags: ["su"] };
  return owner;
}

// The owner as HTML for the panel: small flag pictures, then the name.
function ownerHtml(norad) {
  const owner = ownerOf(norad);
  if (!owner) return "owner unknown";
  return owner.flags.map(flag => `<img class="flagIcon" src="assets/flags/${flag}.svg" alt="">`).join("") + owner.name;
}

// Stable satellite cards: name hover opens the Dynamic Table-style CelesTrak tooltip.
// TLE metadata stays in a disclosure and updates independently for each spacecraft.
function updateIdentity() {
  if (!pair.A || !pair.B) return;
  const key = ["A", "B"].map(slot => `${pair[slot]}:${nearestTleIndex(library[pair[slot]], currentMs)}`).join("|") + view + centre +
    ["A", "B"].map(slot => stateAt(pair[slot], currentMs) ? "1" : "0").join("");
  if (key === lastIdentityKey) return;
  lastIdentityKey = key;
  const host = $("identity");
  if (!host.children.length) {
    for (const slot of ["A", "B"]) {
      const card = document.createElement("details"); card.className = "satCard"; card.dataset.slot = slot;
      const heading = document.createElement("summary"); heading.className = "satCardName";
      const dot = document.createElement("span"); dot.className = `sourceDot slot${slot}`;
      const name = document.createElement("span"); name.className = "satName";
      const metadata = document.createElement("div"); metadata.className = "satMetaDetails"; metadata.id = `satMeta${slot}`;
      const sourceSummary = document.createElement("span"); sourceSummary.className = "sourceSummary";
      const chevron = document.createElement("span"); chevron.className = "satChevron"; chevron.setAttribute("aria-hidden", "true");
      const glyph = document.createElement("span"); glyph.className = "disclosureGlyph"; glyph.textContent = "‹"; chevron.append(glyph);
      heading.append(dot, name, sourceSummary, chevron);
      card.dataset.cospar = episodeConfig.participants[slot === "A" ? 0 : 1].cospar;
      card.append(heading, metadata); host.append(card);
    }
  }
  for (const slot of ["A", "B"]) {
    const norad = pair[slot], lib = library[norad], index = nearestTleIndex(lib, currentMs), tle = lib.tles[index];
    const epoch = lib.epochsMs[index];
    const card = host.querySelector(`[data-slot="${slot}"].satCard`);
    card.querySelector(".satName").textContent = slotName(slot);
    screenLabelNodes[slot].textContent = slotName(slot);
    card.dataset.norad = norad;
    card.dataset.epoch = tle.epoch;
    const provenance = tleProvenance(tle);
    card.dataset.tleLine2 = tle.line2;
    card.dataset.sourceLabel = provenance.label;
    card.dataset.sourceData = provenance.dataSource;
    card.dataset.sourceQueryHref = ["space-track", "TLEs"].includes(tle.source) ? spaceTrackHistoryUrl(norad, tle.epoch) : "";
    card.dataset.sourceOrigin = provenance.origin;
    card.dataset.sourceRetrieval = provenance.retrieval;
    card.dataset.sourceHref = provenance.href;
    const summary = card.querySelector(".sourceSummary");
    const conciseSource = provenance.dataSource.startsWith("CelesTrak") ? "CelesTrak" : provenance.dataSource.startsWith("Space-Track") ? "Space-Track.org" : provenance.dataSource === "Amateur observers" ? "SeeSat-L" : provenance.dataSource;
    summary.replaceChildren(document.createTextNode(conciseSource));
    summary.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M7.25 4.25H4.5A1.75 1.75 0 0 0 2.75 6v7.5a1.75 1.75 0 0 0 1.75 1.75H12a1.75 1.75 0 0 0 1.75-1.75v-2.75"/><path d="M9.25 2.75h6v6M8 10l7.25-7.25"/></svg>');
    card.dispatchEvent(new Event("tlechange", { bubbles: true }));
  }
  $("nowSummary").textContent = `${slotName("A")} + ${slotName("B")}`;
}
function updateIdentityAges() {
  for (const card of $("identity").querySelectorAll(".satCard[data-epoch]")) {
    const age = describeAge(currentMs - Date.parse(card.dataset.epoch));
    card.dataset.tleAge = age;
    const value = card.querySelector(".tleAgeValue");
    if (value && value.textContent !== age) value.textContent = age;
  }
}

// ---------------------------------------------------------------------------
// 9. Camera
// ---------------------------------------------------------------------------
// Frame the Earth and the nearby GEO arc from an oblique Earth-fixed angle.
// The viewing direction follows the selected satellites' longitude, while
// the Earth and both propagated positions determine the scale.
function fullEarthFraming() {
  if (localChapterReview) {
    const state = pair[centre] && stateAt(pair[centre], currentMs);
    if (state) {
      const normal = ricAxes(state).C;
      const direction = new THREE.Vector3(normal[0], normal[2], -normal[1]).normalize();
      const radius = Math.max(1, ...["A", "B"].map(slot => {
        const position = pair[slot] && positionAt(pair[slot], currentMs);
        return position ? Math.hypot(...position) / EARTH_RADIUS_KM : 1;
      }));
      const distance = Math.max(24, radius * 3.6) * Math.max(1, 1 / camera.aspect);
      return { position: direction.multiplyScalar(distance), target: new THREE.Vector3() };
    }
  }
  const earthAngle = sgp4.gstime(new Date(currentMs));
  const positions = [];
  for (const slot of ["A", "B"]) {
    const state = pair[slot] && stateAt(pair[slot], currentMs);
    if (!state) continue;
    positions.push(eciToScene(state.r).applyAxisAngle(earthAxis, -earthAngle));
  }
  const radial = positions.length
    ? positions.reduce((sum, point) => sum.add(point.clone().normalize()), new THREE.Vector3()).normalize()
    : latLonToPoint(0, geoReferenceLongitudeDeg).normalize();
  const radius = Math.max(1, ...positions.map(point => point.length()));
  const target = radial.clone().multiplyScalar(radius * .47);
  const direction = radial.clone().applyAxisAngle(earthAxis, THREE.MathUtils.degToRad(-55));
  direction.y += .3; direction.normalize();
  const distance = Math.max(10.2, radius * 2.8) * Math.max(1, 1 / camera.aspect);
  return { position: target.clone().addScaledVector(direction, distance), target };
}

// Glide the camera to the framing over 0.9 seconds instead of jumping.
function moveCameraSmoothly() {
    const framing = view === "relative" ? relativeFraming() : fullEarthFraming();
  cameraTween = {
    start: performance.now(), duration: 900,
    fromPosition: camera.position.clone(), toPosition: framing.position,
    fromTarget: controls.target.clone(), toTarget: framing.target,
    fromFov: camera.fov, toFov: camera.fov,
  };
}











// ---------------------------------------------------------------------------
// 10. Choosing satellites and time windows
// ---------------------------------------------------------------------------
// The time span the date pickers allow, and the default window.
// With "Dates both satellites have TLEs" chosen: only dates where we have TLEs for BOTH satellites.
// Any other choice (or if the satellites don't overlap at all): from the earliest TLE of either
// satellite to the most recent TLE of either.
function dataLimits() {
  const a = library[pair.A].coverage, b = library[pair.B].coverage;
  const overlapStart = Math.max(a[0], b[0]), overlapEnd = Math.min(a[a.length - 1], b[b.length - 1]);
  const overlap = overlapStart < overlapEnd;
  if (overlap && $("windowMode").value === "overlap") return { min: overlapStart, max: overlapEnd, overlap, overlapOnly: true };
  return { min: Math.min(a[0], b[0]), max: Math.max(a[a.length - 1], b[b.length - 1]), overlap, overlapOnly: false };
}

// Pick a pair of satellites. Either can be empty (null or "") while the user is still choosing.
// Each chosen satellite is loaded straight away (from our library, or live from CelesTrak);
// once both are loaded, the dates are set and the pair is modeled.
async function setPair(noradA, noradB, requestedStart = null, requestedEnd = null) {
  pair.A = noradA || null; pair.B = noradB || null;      // "" (the Choose… option) becomes null
  lastTleIndex.A = lastTleIndex.B = null;                 // new satellites: nothing to compare against yet
    if (caseNorads.length && ![pair.A, pair.B].every(norad => caseNorads.includes(norad))) closeCase();   // left the incident
  $("rangeNote").textContent = "Loading TLEs…";

  // Load whichever satellites are chosen. allSettled waits for all of them, even if one fails.
  const chosen = [pair.A, pair.B].filter(norad => norad);
  const results = await Promise.allSettled(chosen.map(norad => loadSatellite(norad)));
  const failed = results.find(result => result.status === "rejected");
  if (!library[pair.A]) pair.A = null;                   // a satellite that failed to load
  if (!library[pair.B]) pair.B = null;                   // is taken back out of its slot

  // Show the choices in the dropdowns (live satellites get added to them first)
  if (pair.A) addToDropdowns(pair.A);
  if (pair.B) addToDropdowns(pair.B);
  $("satA").value = pair.A ?? ""; $("satB").value = pair.B ?? "";  
    updateNames();
    drawCasePairs();

    if (failed || !pair.A || !pair.B) {                    // nothing to model yet
    setView("earth");                                    // fallback until a pair is available
    clearScene();
    $("rangeNote").textContent = failed ? failed.reason.message
      : (pair.A || pair.B) ? `Now choose satellite ${pair.A ? "B" : "A"}.`
      : "Search for a satellite or pick one from the dropdowns to begin.";
    return;
  }
  applyLimits(requestedStart, requestedEnd);
  lastIdentityKey = "";
    setView(preferredView, centre, !!episodeConfig);
    if (episodeConfig && preferredView === "relative") keepBothInFrame(true);
}
// The dates for the two "Reported period" menu choices, as text (null for any other choice).
function caseWindow() {
  const mode = $("windowMode").value;
  if (!reportedPeriod || (mode !== "case" && mode !== "caseWeek")) return null;
  const pad = mode === "caseWeek" ? CASE_PAD_DAYS * DAY_MS : 0;
  return { start: new Date(reportedPeriod.start - pad).toISOString(), end: new Date(reportedPeriod.end + pad).toISOString() };
}

// Set the date pickers' allowed range from the TLE data, then set the window
// (to the requested dates if given, otherwise the whole allowed range).
function applyLimits(requestedStart = null, requestedEnd = null) {
  const limits = dataLimits();
  if (episodeConfig) {
    $("rangeNote").textContent = "Historical reconstruction from dated orbital elements; unsupported times remain unavailable.";
    setWindow(Date.parse(episodeConfig.playbackWindow.start), Date.parse(episodeConfig.playbackWindow.end));
    return;
  }
    const caseDates = caseWindow();
  if (caseDates) { requestedStart = caseDates.start; requestedEnd = caseDates.end; }
  for (const input of [$("startTime"), $("endTime")]) {
    input.min = toInputValue(limits.min);
    input.max = toInputValue(limits.max);
  }
  if (!limits.overlap) {
    $("rangeNote").textContent = "⚠ These satellites have no overlapping TLE dates; positions far from a TLE epoch are unreliable.";
  } else {
    $("rangeNote").textContent = limits.overlapOnly
      ? `TLEs for both satellites cover ${formatDate(limits.min)} to ${formatDate(limits.max)}.`
      : `TLEs for either satellite cover ${formatDate(limits.min)} to ${formatDate(limits.max)}; outside the overlap, one satellite's position is extrapolated.`;
  }

  const clamp = ms => Math.min(limits.max, Math.max(limits.min, ms));
  setWindow(requestedStart ? clamp(Date.parse(requestedStart)) : limits.min,
            requestedEnd ? clamp(Date.parse(requestedEnd)) : limits.max);
}

// Take both satellites off the globe and blank the readouts (used while the pair isn't complete).
function clearScene() {
  for (const slot of ["A", "B"]) {
    dots[slot].visible = false;                          // hide the satellite's dot
    labels[slot].visible = false;                        // and its name
    trails[slot].geometry.dispose();                     // free the old orbit line's memory...
    trails[slot].geometry = new THREE.BufferGeometry();  // ...and replace it with an empty one
  }
  $("rangeStat").textContent = "—";                     // distance
    $("speedStat").textContent = "—";                     // relative speedS
  $("timeDisplay").textContent = "—";                   // time
  $("sliderNow").textContent = "—";
  $("identity").innerHTML = "";                          // "Now modeling" panel
  $("nowSummary").textContent = "";
  lastIdentityKey = "";                                  // make sure the panel rebuilds next time
    closest = null;
  $("closestApproach").hidden = true;
    for (const id of ["separationChart", "speedChart"]) {  // blank the charts
    const chart = $(id);
    chart.getContext("2d").clearRect(0, 0, chart.width, chart.height);
  }
}
// Turn the two "Reported period" menu choices on or off.
function enableCaseChoices(on) {
  for (const option of $("windowMode").options) {
    if (option.value === "case" || option.value === "caseWeek") option.disabled = !on;
  }
}

// Open the incident named in the link (compare.html?case=E-002): its satellites, on its dates.
async function openCase(id) {
  const response = await fetch("data/cases.json");
  const cases = response.ok ? await response.json() : {};
  const found = cases[id];
  if (!found) {
    await setPair(null, null);
    $("rangeNote").textContent = `Incident ${id} can't be modeled yet.`;
    return;
  }
  for (const satellite of found.satellites) {            // real names, from the full catalog
    const entry = catalog.find(s => s.norad === satellite.norad);
    if (entry) entry.name = satellite.name;
  }
  fillDropdowns();
  caseNorads = found.satellites.map(satellite => satellite.norad);
  await Promise.all(caseNorads.map(norad => loadSatellite(norad)));
  reportedPeriod = { start: Date.parse(found.start), end: Date.parse(found.end) };
  enableCaseChoices(true);
  $("windowMode").value = "caseWeek";
  $("caseTitle").textContent = `Incident ${id}`;
  $("caseBox").hidden = false;
  $("findSection").open = false;        // the link already chose the satellites, so tuck the finder away
  await setPair(caseNorads[0], caseNorads[1]);
  $("caViewBtn").click();               // start at the closest approach, with both satellites in view
  //start GEO satellite incidents at 1 hr/second to account that they move slower than satellites in LEO
  const startState = stateAt(caseNorads[0],currentMs);
  if (startState && Math.hypot(...startState.r) > HIGH_ORBIT_KM) $("speed").value = "3600"; updateSpeedLabel(); //only runs when an incident link opens, chooses 1 hour/ sec which is 3600 simulated secomds per real second 
}

// The user chose a satellite from outside the incident, so the reported dates no longer apply.
function closeCase() {
  caseNorads = [];
  reportedPeriod = null;
  enableCaseChoices(false);
  if ($("windowMode").value.startsWith("case")) $("windowMode").value = "overlap";
  $("caseBox").hidden = true;
}

// A three-satellite incident gets one button per pair, since the page shows two at a time.
function drawCasePairs() {
  $("casePairs").innerHTML = "";
  if (caseNorads.length < 3) return;
  const [x, y, z] = caseNorads;
  for (const [a, b] of [[x, y], [x, z], [y, z]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${library[a].info.name} + ${library[b].info.name}`;
    button.classList.toggle("activePair", [pair.A, pair.B].includes(a) && [pair.A, pair.B].includes(b));
    button.addEventListener("click", () => setPair(a, b));
    $("casePairs").append(button);
  }
}

// Shade the reported period on the time bar, as a share of the whole window.
// No band when no case is loaded, or when the window IS the reported period.
function updateReportedBand() {
  let from = 0, to = 0;
  if (reportedPeriod && $("windowMode").value !== "case") {
    const span = endMs - startMs;
    from = Math.min(1, Math.max(0, (reportedPeriod.start - startMs) / span));
    to = Math.min(1, Math.max(0, (reportedPeriod.end - startMs) / span));
  }
  $("timelineSlider").style.setProperty("--bandStart", `${from * 100}%`);
  $("timelineSlider").style.setProperty("--bandEnd", `${to * 100}%`);
}

// Set the start and end of the time window, and jump to the start.
function setWindow(newStart, newEnd) {
  if (newEnd <= newStart) newEnd = newStart + DAY_MS;   // Never allow an empty window
  startMs = newStart; endMs = newEnd; currentMs = startMs;
  focusedMinimumMs = null;
  $("startTime").value = toInputValue(startMs);
  $("endTime").value = toInputValue(endMs);
  $("timelineSlider").min = startMs;
  $("timelineSlider").max = endMs;
  $("sliderStart").textContent = formatDate(startMs);
  $("sliderEnd").textContent = formatDate(endMs);
  renderDwellSegments();
    updateReportedBand();
    if (episodeConfig) prepareAnalysis();
    updateClosestApproach();
    updateScene();
}

// Add a satellite loaded live from CelesTrak to both dropdowns (once), so it can be picked again.
function addToDropdowns(norad) {
  for (const select of [$("satA"), $("satB")]) {
    if (![...select.options].some(option => option.value === norad)) {
      select.add(new Option(`${library[norad].info.name} (${norad}) · live`, norad));
    }
  }
}
// The name of the satellite in a slot ("A" or "B"), or "Satellite A" / "Satellite B" if none is loaded yet.
function slotName(slot) {
  if (episodeConfig && pair[slot] === episodeConfig.participants[slot === "A" ? 0 : 1].norad) return episodeConfig.participants[slot === "A" ? 0 : 1].name;
  return library[pair[slot]]?.info.name ?? `Satellite ${slot}`;
}

let e001PairSticky;
function updateE001PairSticky() {
  const ui = $("ui"), modeling = $("nowModeling");
  if (!ui || !modeling || !pair.A || !pair.B || localChapterReview) return;
  if (!e001PairSticky) {
    e001PairSticky = document.createElement("div"); e001PairSticky.id = "e001PairSticky";
    e001PairSticky.innerHTML = '<span class="pair-intro">Current Episode:</span><span class="pair-chaser"><i></i><b></b></span><span>+</span><span class="pair-target"><i></i><b></b></span>';
    e001PairSticky.hidden = true; ui.prepend(e001PairSticky);
    ui.addEventListener("scroll", updateE001PairSticky, { passive: true });
  }
  e001PairSticky.querySelector(".pair-chaser b").textContent = slotName("A");
  e001PairSticky.querySelector(".pair-target b").textContent = slotName("B");
  e001PairSticky.hidden = modeling.getBoundingClientRect().bottom > ui.getBoundingClientRect().top + 38;
}

// Show the chosen satellites' names in the panel and the 3D view, instead of "A" and "B".
function updateNames() {
   $("centreNameA").textContent = slotName("A");
  $("centreNameB").textContent = slotName("B");
  $("nameA").textContent = slotName("A");
  $("nameB").textContent = slotName("B");
  $("separationTitle").textContent = `Separation between ${slotName("A")} and ${slotName("B")}`;
  setLabelText("A", slotName("A"));
  setLabelText("B", slotName("B"));
  updateE001PairSticky();
}


// Fill both dropdowns with every satellite in the library, e.g. "USA 245 (39232)",
// after a blank "Choose a satellite…" option for when nothing is chosen yet.
function fillDropdowns() {
  for (const select of [$("satA"), $("satB")]) {
    select.innerHTML = `<option value="">Choose a satellite…</option>` +
      catalog.map(s => `<option value="${s.norad}">${s.name} (${s.norad})</option>`).join("");
  }
}

// ---------------------------------------------------------------------------
// Satellite lookup: find catalog entries matching whatever someone typed
// ---------------------------------------------------------------------------
// "19079A" (short form, as written inside a TLE) -> "2019-079A" (the catalog's form)
function shortToLongIntlDes(short) { //turns  a short int. designator into the long form used in the catalog
  let year = Number(short.slice(0, 2));
  year += year < 57 ? 2000 : 1900;     // TLEs started in 1957, so 57-99 are 1900s
  return `${year}-${short.slice(2, 5)}${short.slice(5)}`;
}

// Returns a list of matching satellites (an empty list if nothing matches).
function identify(text) {
  text = text.trim().toUpperCase();
  if (text === "") return [];

  // 1. Only digits -> NORAD number. Number() drops leading zeros ("00123" -> 123),
  //    matching how the catalog stores them.
  if (/^\d+$/.test(text)) {
    const norad = String(Number(text));
    return satcat.filter(s => s.norad === norad);
  }

  // 2. Long international designator, like 2019-079A
  if (/^\d{4}-\d{3}[A-Z]{1,3}$/.test(text)) {
    return satcat.filter(s => s.intlDes === text);
  }
   // 2b. A whole launch: a long designator without the piece letters, like 2019-079
  if (/^\d{4}-\d{3}$/.test(text)) {
    return satcat.filter(s => s.intlDes.startsWith(text));
  }

  // 3. Short international designator, like 19079A
  if (/^\d{5}[A-Z]{1,3}$/.test(text)) {
    const longForm = shortToLongIntlDes(text);
    return satcat.filter(s => s.intlDes === longForm);
  }

  // 4. Anything else is a name. CelesTrak spells Russian "Kosmos" satellites "COSMOS".
  const name = text.replace("KOSMOS", "COSMOS");
  const exact = satcat.filter(s => s.name === name);
  if (exact.length > 0) return exact;              // exact name match wins
    // Otherwise, best matches first: names that START with the text, then names that contain it elsewhere
  const startsWith = satcat.filter(s => s.name.startsWith(name));
  const containsElsewhere = satcat.filter(s => s.name.includes(name) && !s.name.startsWith(name));
  return [...startsWith, ...containsElsewhere];
}
// ---------------------------------------------------------------------------
// Closest approach: when, during the time window, are A and B nearest each other?
// ---------------------------------------------------------------------------
// Step 1: check the distance at evenly spaced moments (every 30 seconds, or fewer
//         checks for long windows, so there are never more than about 20,000).
// Step 2: every "dip" (a moment closer than the moments either side of it) might be
//         the closest approach, so zoom in on the 10 deepest dips to find the exact moment.
function findClosestApproach() {
  const scanStart = episodeConfig && !localChapterReview ? episodeStartMs : startMs, scanEnd = episodeConfig && !localChapterReview ? episodeEndMs : endMs;
  const stepMs = Math.max(30 * 1000, (scanEnd - scanStart) / 20000);
  const samples = [];
  for (let ms = scanStart; ms <= scanEnd; ms += stepMs) samples.push({ ms, km: separationAt(ms) });
  const dips = samples.filter((s, i) => s.km !== null
    && (i === 0 || samples[i - 1].km === null || s.km <= samples[i - 1].km)
    && (i === samples.length - 1 || samples[i + 1].km === null || s.km <= samples[i + 1].km));
  if (dips.length === 0) return null;
  dips.sort((p, q) => p.km - q.km);                      // deepest dips first
  let best = null;
  for (const dip of dips.slice(0, 10)) {
    const found = zoomInOnDip(dip.ms - stepMs, dip.ms + stepMs);
    if (found && (!best || found.km < best.km)) best = found;
  }
  if (best) best.stepMs = stepMs;
  return best;
}

// Zoom in on the closest moment between lo and hi: check 100 evenly spaced moments,
// keep the closest, then repeat in a narrower range around it until we're within a second.
function zoomInOnDip(lo, hi) {
  lo = Math.max(episodeConfig && !localChapterReview ? episodeStartMs : startMs, lo); hi = Math.min(episodeConfig && !localChapterReview ? episodeEndMs : endMs, hi);
  let best = null;
  while (true) {
    const step = (hi - lo) / 100;
    for (let i = 0; i <= 100; i++) {
      const ms = lo + i * step, km = separationAt(ms);
      if (km !== null && (!best || km < best.km)) best = { ms, km };
    }
    if (!best || step < 1000) return best;
    lo = Math.max(episodeConfig && !localChapterReview ? episodeStartMs : startMs, best.ms - step); hi = Math.min(episodeConfig && !localChapterReview ? episodeEndMs : endMs, best.ms + step);
  }
}

// "21.4 km" for small distances, "6,176 km" for big ones
const formatKm = km => km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`;
const formatTimeSeconds = ms => new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(ms));

// ---------------------------------------------------------------------------
// Relative motion view (set up like the original storyline page):
// the selected reference satellite sits at the centre, and the other is drawn
// relative to it along the reference satellite's own directions:
//   radial      = straight up, away from Earth
//   along-track = the direction A is travelling
//   cross-track = sideways, out of A's orbit plane
// Earth is drawn to scale underneath, and B leaves a fading trail of the last 4 hours.
// ---------------------------------------------------------------------------
let view = "relative";               // "earth" (Earth-fixed globe) or "relative" (Relative motion)
let preferredView = "relative";      // E-001 opens directly in Relative Motion
let showAxes = false;                // direction axes on or off (the round button under the home button)
let centre = "B";                    // the target starts at the centre; the reader can switch to A
const otherSlot = () => centre === "A" ? "B" : "A";   // the satellite that moves around it
const RELATIVE_SCALE_KM = 1000;      // in the relative view, 1 scene unit = 1,000 km (as in the original)
const HIGH_ORBIT_TRAIL_HOURS = 7 * 24;   // GEO satellites move slowly, so show a whole week (seven orbits)
const RELATIVE_TRAIL_HOURS = 4;      // how much of B's recent path to show
const RELATIVE_TRAIL_POINTS = 240;   // one point per minute
const RELATIVE_VIEW_DISTANCE = 0.5;  // normal camera distance in the relative view: 0.5 units = 500 km
const HIGH_ORBIT_KM = 20000;          // above this orbit radius (GEO is 42,164 km), Earth looks too small to stay in an angled view

// A's own directions (each an arrow of length 1, in Earth-centred coordinates)
function ricAxes(stateA) {
  const unit = v => { const n = Math.hypot(v[0], v[1], v[2]); return v.map(x => x / n); };
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const R = unit(stateA.r);                    // up
  const C = unit(cross(stateA.r, stateA.v));   // out of the orbit plane
  const I = cross(C, R);                       // along the direction of travel
  return { R, I, C };
}

// Any position, measured from A along A's directions: [radial, along-track, cross-track] in km.
function ricOf(stateA, r) {
  const { R, I, C } = ricAxes(stateA);
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const d = [r[0] - stateA.r[0], r[1] - stateA.r[1], r[2] - stateA.r[2]];   // from A to the position
  return [dot(d, R), dot(d, I), dot(d, C)];
}

// Same layout as the original page: along-track left-right, cross-track up-down, radial towards you.
const relativeToScene = ([r, i, c]) => new THREE.Vector3(i, c, r).divideScalar(RELATIVE_SCALE_KM);

// B relative to A at time ms, as a point in the scene (or null if a position isn't available)
// tleCentre / tleOther: which TLE to use for each (leave out to use the nearest one).
function relativePointAt(ms, tleCentre = null, tleOther = null) {
  const c = stateAt(pair[centre], ms, tleCentre), o = positionAt(pair[otherSlot()], ms, tleOther);
  return c && o ? relativeToScene(ricOf(c, o)) : null;
}

// Long, labelled axis lines through A (the same size as the original page's), shown only in the relative view.
const relativeAxes = new THREE.Group();
relativeAxes.visible = false;
scene.add(relativeAxes);
{
  const material = new THREE.LineBasicMaterial({ color: 0xcccccc });
  const axis = (from, to) => relativeAxes.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material));
  axis(new THREE.Vector3(-14, 0, 0), new THREE.Vector3(14, 0, 0));
  axis(new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 5, 0));
  axis(new THREE.Vector3(0, 0, -14), new THREE.Vector3(0, 0, 14));
}

// B's fading trail: one line whose colour goes from white (4 hours ago, blending into the
// background) to grey (now), so older positions fade away.
const relativeTrail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
relativeTrail.renderOrder = 6;
relativeTrail.userData = { solid: relativeTrail.material, dashed: new THREE.LineDashedMaterial({ vertexColors: true }) };
relativeTrail.visible = false;
scene.add(relativeTrail);
const localMotionTrail = new THREE.Mesh(fadingTrailGeometry([]), fadingTrailMaterial("A"));
localMotionTrail.visible = false;
localMotionTrail.renderOrder = 6;
localMotionTrail.frustumCulled = false;
scene.add(localMotionTrail);
const localReferenceOrbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: miniScene ? .9 : .72, depthTest: true, depthWrite: false }));
localReferenceOrbit.visible = false;
localReferenceOrbit.frustumCulled = false;
localReferenceOrbit.renderOrder = 2;
scene.add(localReferenceOrbit);
let lastLocalRelativeTrailKey = "";

// Put Earth in the right place, size and orientation for the relative view:
// centred straight "down" from A, at 1 unit = 1,000 km, turned to match A's directions.
function placeEarthRelative(stateA) {
  const { R, I, C } = ricAxes(stateA);
  const toScene = v => new THREE.Vector3(v[0], v[2], -v[1]);   // same axis swap as eciToScene
  const turn = new THREE.Matrix4().makeBasis(toScene(I), toScene(C), toScene(R)).transpose();
  const centre = relativeToScene(ricOf(stateA, [0, 0, 0]));   // Earth's centre, seen from A
  const size = EARTH_RADIUS_KM / RELATIVE_SCALE_KM;
  earthGroup.matrix.makeTranslation(centre.x, centre.y, centre.z)
    .multiply(turn)
    .multiply(new THREE.Matrix4().makeRotationY(sgp4.gstime(new Date(currentMs))))
    .multiply(new THREE.Matrix4().makeScale(size, size, size));
}

// In the relative view: A at the centre, B at its relative position, B's fading trail, Earth below.
function drawRelative() {
  const stateCentre = stateAt(pair[centre], currentMs);
  if (!stateCentre) {
    // Keep the last valid Earth and reference orbit when a sparse miniature
    // sample cannot be propagated during the playback loop.
    if (miniScene) return;
    dots.A.visible = dots.B.visible = false; relativeTrail.visible = false; localMotionTrail.visible = false; localReferenceOrbit.visible = false; earthGroup.visible = false; return;
  }
  earthGroup.visible = true; relativeTrail.visible = !localChapterReview;
  placeEarthRelative(stateCentre);
  const other = otherSlot();
  dots[centre].visible = true;
  dots[centre].position.set(0, 0, 0);
  const now = relativePointAt(currentMs);
  dots[other].visible = now !== null;
  if (now) dots[other].position.copy(now);

  // Draw the whole trail from the TLEs in use right now, so it doesn't kink wherever the
  // nearest TLE would change partway along it (the same trick the orbit lines use)
  const tleCentre = nearestTleIndex(library[pair[centre]], currentMs);
  const tleOther = nearestTleIndex(library[pair[other]], currentMs);
  const trailKey = `${centre}:${tleCentre}:${tleOther}:${Math.floor(currentMs / (5 * MINUTE_MS))}`;
  if (localChapterReview) {
    const anchorMs = miniScene ? (miniLoopStart + miniLoopEnd) / 2 : currentMs;
    const orbitKey = `${centre}:${tleCentre}:${miniScene ? `${miniLoopStart}:${miniLoopEnd}` : Math.floor(currentMs / (5 * MINUTE_MS))}`;
    if (orbitKey !== localReferenceOrbit.userData.orbitKey) {
      const anchor = stateAt(pair[centre], anchorMs, tleCentre) || stateCentre;
      const radius = Math.hypot(...anchor.r), speed = Math.hypot(...anchor.v);
      const semimajor = 1 / (2 / radius - speed * speed / 398600.4418);
      // A complete circular reference path at the chosen orbit's semi-major
      // axis avoids joining across missing propagated TLE samples.
      const orbitPoints = Number.isFinite(semimajor) && semimajor > EARTH_RADIUS_KM
        ? Array.from({ length: 241 }, (_, index) => {
          const angle = index / 240 * Math.PI * 2;
          return relativeToScene([semimajor * Math.cos(angle) - radius, semimajor * Math.sin(angle), 0]);
        }) : [];
      localReferenceOrbit.geometry.dispose();
      localReferenceOrbit.geometry = new THREE.BufferGeometry().setFromPoints(orbitPoints);
      localReferenceOrbit.visible = orbitPoints.length > 1;
      localReferenceOrbit.userData.orbitKey = orbitKey;
    }
    // setView hides the old path during a frame switch. Restore the cached
    // geometry even when the chapter and TLE (and thus orbitKey) did not change.
    localReferenceOrbit.visible = (localReferenceOrbit.geometry.getAttribute("position")?.count || 0) > 1;
  }
  if (localChapterReview && trailKey === lastLocalRelativeTrailKey) return;
  lastLocalRelativeTrailKey = trailKey;
  const points = [], colors = [];
  if (localChapterReview) {
    // Work backwards until the tail has the E-002 screen length. GEO motion
    // can need many more hours than LEO to cover the same number of pixels.
    const maximumLookback = 14 * DAY_MS;
    const stepMs = Math.max(5 * MINUTE_MS, maximumLookback / 360);
    camera.updateMatrixWorld(true);
    const screenPoint = point => {
      const projected = point.clone().project(camera);
      return { x: (projected.x + 1) * renderer.domElement.clientWidth / 2, y: (1 - projected.y) * renderer.domElement.clientHeight / 2 };
    };
    let pixelLength = 0, newer = null;
    for (let elapsed = 0; elapsed <= maximumLookback + stepMs / 2; elapsed += stepMs) {
      const point = relativePointAt(currentMs - Math.min(elapsed, maximumLookback), tleCentre, tleOther);
      if (!point) { if (points.length) break; continue; }
      if (newer) {
        const a = screenPoint(newer), b = screenPoint(point);
        pixelLength += Math.hypot(a.x - b.x, a.y - b.y);
      }
      points.push(point); newer = point;
      if (pixelLength >= 260) break;
    }
    points.reverse();
    localMotionTrail.geometry.dispose();
    localMotionTrail.geometry = fadingTrailGeometry(points);
    localMotionTrail.material.uniforms.uColor.value.set(SLOTS[other].line);
    localMotionTrail.material.uniforms.uOpacity.value = miniScene ? 1 : other === "A" ? 1 : .85;
    localMotionTrail.visible = points.length > 1;
  } else {
    // During a TLE flash the newest end of the trail turns darker. Each point is a mix of "faded" and
    // "recent", so every point darkens in proportion to how dark it already is and the fade keeps its shape.
    const flashing = performance.now() < Math.max(flashUntil.A, flashUntil.B);
    const faded = new THREE.Color(0xffffff), recent = new THREE.Color(0x777777).multiplyScalar(flashing ? TLE_FLASH_DARKEN : 1);
    const trailHours = relativeTrailHours();
    const trailPoints = Math.max(RELATIVE_TRAIL_POINTS, trailHours * 10);
    for (let i = 0; i <= trailPoints; i++) {
      const fraction = i / trailPoints;
      const p = relativePointAt(currentMs - trailHours * 60 * MINUTE_MS * (1 - fraction), tleCentre, tleOther);
      if (!p) continue;
      points.push(p);
      const color = faded.clone().lerp(recent, fraction ** 1.7);
      colors.push(color.r, color.g, color.b);
    }
    relativeTrail.geometry.dispose();
    relativeTrail.geometry = new THREE.BufferGeometry().setFromPoints(points);
    relativeTrail.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    setDashed(relativeTrail, tleIsStale(library[pair[centre]], tleCentre) || tleIsStale(library[pair[other]], tleOther));
  }
} // closes drawRelative

function sizeSceneSprites() {
  const lens = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (const slot of ["A", "B"]) {
    const dotSize = miniScene ? miniMarkerScale(camera, renderer.domElement.clientHeight) : DOT_SCREEN_SIZE;
    dots[slot].scale.set(dotSize, dotSize, 1);
    labels[slot].scale.set(LABEL_SCREEN_SIZE * lens * 5.33, LABEL_SCREEN_SIZE * lens, 1);
  }
}
let lastGeoReference = null;
let preferredCameraReference = null;
function setView(next, nextCentre = centre, immediate = false) {
  if (!pair.A || !pair.B) next = "earth";
  if (cameraEditMode) {
    cameraEditMode = false;
    autoZoom = true;
    $("holdCameraBtn").setAttribute("aria-pressed", "false");
    $("holdCameraBtn").textContent = "Hold camera";
  }
  view = next; centre = nextCentre;
  const relative = next === "relative";
  earthGroup.matrixAutoUpdate = true;
  earthGroup.visible = true;
  geoBelt.visible = !localChapterReview;
  localReferenceOrbit.visible = false;
  localMotionTrail.visible = false;
  if (localChapterReview && relative) lastLocalRelativeTrailKey = "";
  relativeTrail.visible = false;
  relativeAxes.visible = false;
  trails.A.visible = trails.B.visible = true;
  $("centreSwitch").hidden = true;
  $("axesBtn").hidden = true;
  $("earthView").classList.toggle("activeViewSwitch", !relative);
  $("relativeView").classList.toggle("activeViewSwitch", relative);
  $("modeBtn").title = relative ? localChapterReview ? "Switch to ECI view" : "Switch to Earth-fixed view" : "Switch to relative motion";
  $("modeBtn").setAttribute("aria-label", $("modeBtn").title);
  $("modeBtn").classList.toggle("isRelative", relative);
  $("modeBtn").innerHTML = relative
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c-3 3-3 13 0 16M12 4c3 3 3 13 0 16"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="13" r="1" fill="currentColor"/><path d="M2 12h4m12 0h4M12 2v4m0 12v4"/></svg>';
  $("viewNote").textContent = localChapterReview ? relative ? `Relative motion centered on ${slotName(centre)}.` : "ECI view along the orbital-plane normal." : relative ? "Both spacecraft move around a fixed point on the nominal GEO belt." : "Earth-fixed view: the globe stays still while the spacecraft drift over their longitudes.";
  const framing = relative ? relativeFraming() : fullEarthFraming();
  lastGeoReference = relative ? framing.target.clone() : null;
  if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cameraTween = null;
    camera.position.copy(framing.position); controls.target.copy(framing.target);
    camera.fov = 35; camera.updateProjectionMatrix(); sizeSceneSprites();
  } else {
    cameraTween = { start: performance.now(), duration: relative ? 2300 : 1500,
      fromPosition: camera.position.clone(), toPosition: framing.position,
      fromTarget: controls.target.clone(), toTarget: framing.target,
      fromFov: camera.fov, toFov: 35 };
  }
  updateScene();
}

// How many hours of fading trail to draw: a whole day for high orbits like GEO, 4 hours lower down.
function relativeTrailHours() {
  const state = stateAt(pair[centre], currentMs);
  const highOrbit = state && Math.hypot(...state.r) > HIGH_ORBIT_KM;
  return highOrbit ? HIGH_ORBIT_TRAIL_HOURS : RELATIVE_TRAIL_HOURS;
}

// The trail length as words: "4 hours", or "7 days" once it's 2 days or longer.
function trailLengthText() {
  const hours = relativeTrailHours();
  return hours >= 48 ? `${hours / 24} days` : `${hours} hours`;
}

// Which way the camera looks from in the relative view. For high orbits like GEO: straight down
// from above the satellite, so Earth sits right behind it. Lower down, Earth is big enough to fill
// the background anyway, so keep the original angle, which also shows up-and-down motion.
function relativeViewDirection() {
  const state = stateAt(pair[centre], currentMs);
  const highOrbit = state && Math.hypot(...state.r) > HIGH_ORBIT_KM;
  return highOrbit ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0.62, 1.08).normalize();
}

// Always put the centre satellite in the middle of the picture.
// Normally: view from the original page's angle, 500 km away.
// fitBoth (for "View closest approach"): look from the side of the line between the two
// satellites (so one can't hide behind the other), and stand far enough back that the other
// satellite sits comfortably inside the frame, however close they are.
function relativeFraming() {
  if (localChapterReview) {
    const target = new THREE.Vector3(0, 0, 0);
    const other = relativePointAt(currentMs);
    const offset = new THREE.Vector3(0, 0, 1);
    const distance = relativeFitDistance(THREE, {
      positions: other ? [target, other] : [target], target, offset, up: camera.up,
      fov: 35, aspect: camera.aspect, reference: null,
      minDistance: controls.minDistance, maxDistance: 50
    });
    return { position: offset.multiplyScalar(distance), target };
  }
  return relativeCameraFrame(THREE, geoReferenceWorld(currentMs), preferredCameraReference, camera.aspect);
}
// Auto-zoom: in the relative view, the camera's distance follows the distance between the two
// satellites, so the zoom always matches how close they are: twice as far apart = camera twice as
// far back. The gap between them (seen side-on) reaches ZOOM_SHARE of the way to the screen edge.
let autoZoom = true;              // turned off when the user zooms by hand; Home and View closest approach turn it back on
let cameraEditMode = false;        // development capture mode: suspend automatic camera following
let publishedCameraViews = [], publishedCameraChapter = "", publishedCameraEnabled = true;
function followPublishedCamera() {
  if (!publicChapterView || chapterMode.get("mini") === "1" || view !== "relative" || !publishedCameraEnabled || cameraEditMode) return false;
  const route = publishedCameraViews.filter(item => item.chapterId === publishedCameraChapter && item.cameraMode === "relative" && item.referenceSatellite === centre && Number.isFinite(Date.parse(item.simulationTimeUtc)))
    .sort((a, b) => Date.parse(a.simulationTimeUtc) - Date.parse(b.simulationTimeUtc));
  if (!route.length) return false;
  const index = route.findIndex(item => Date.parse(item.simulationTimeUtc) >= currentMs);
  const rightIndex = index < 0 ? route.length - 1 : index;
  const right = route[rightIndex], left = route[Math.max(0, rightIndex - 1)];
  const start = Date.parse(left.simulationTimeUtc), end = Date.parse(right.simulationTimeUtc);
  const t = end === start ? 0 : THREE.MathUtils.clamp((currentMs - start) / (end - start), 0, 1);
  const smooth = t * t * (3 - 2 * t);
  const target = new THREE.Vector3(...left.target).lerp(new THREE.Vector3(...right.target), smooth);
  const eye = new THREE.Vector3(...left.position).sub(new THREE.Vector3(...left.target));
  const nextEye = new THREE.Vector3(...right.position).sub(new THREE.Vector3(...right.target));
  const direction = eye.clone().normalize().lerp(nextEye.clone().normalize(), smooth).normalize();
  const distance = Math.exp(THREE.MathUtils.lerp(Math.log(Math.max(.001, eye.length())), Math.log(Math.max(.001, nextEye.length())), smooth));
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.up.fromArray(left.up).lerp(new THREE.Vector3(...right.up), smooth).normalize();
  camera.fov = THREE.MathUtils.lerp(left.fieldOfViewDeg, right.fieldOfViewDeg, smooth);
  camera.zoom = THREE.MathUtils.lerp(left.zoom, right.zoom, smooth);
  camera.updateProjectionMatrix();
  return true;
}
const ZOOM_SHARE = 0.6;           // seen side-on, the other satellite sits 60% of the way from the middle to the edge

// How far back the camera stands for a given separation (in scene units: 1 = 1,000 km)
function zoomDistanceFor(separation) {
  const halfHeightPerUnit = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return THREE.MathUtils.clamp(separation / (ZOOM_SHARE * halfHeightPerUnit), controls.minDistance, controls.maxDistance);
}

function keepBothInFrame(snapOut = false) {
  if (!autoZoom || cameraTween || view !== "relative" || !pair.A || !pair.B) return;
  const visible = [dots.A, dots.B].filter(dot => dot.visible);
  if (!visible.length) return;
  const offset = camera.position.clone().sub(controls.target);
  const distance = offset.length();
  const goal = relativeFitDistance(THREE, { positions: visible.map(dot => dot.position), target: controls.target,
    offset, up: camera.up, fov: camera.fov, aspect: camera.aspect, reference: preferredCameraReference,
    minDistance: controls.minDistance, maxDistance: 50 });
  // Ignore small orbital variation and ease larger changes to avoid visible zoom pumping.
  const next = snapOut && goal > distance ? goal
    : Math.abs(goal - distance) / Math.max(distance, .001) < .06 ? distance : distance + (goal - distance) * (goal > distance ? .12 : .02);
  offset.setLength(next);
  camera.position.copy(controls.target).add(offset);
}
function followGeoReference() {
  if (view !== "relative" || cameraTween || cameraEditMode) return;
  if (localChapterReview) return;
  const next = geoReferenceWorld(currentMs);
  if (lastGeoReference) {
    const rotation = new THREE.Quaternion().setFromUnitVectors(lastGeoReference.clone().normalize(), next.clone().normalize());
    const offset = camera.position.clone().sub(controls.target).applyQuaternion(rotation);
    camera.position.copy(next).add(offset);
  }
  controls.target.copy(next);
  lastGeoReference = next;
}

// Work out the closest approach for the current window and show it in the panel.
function updateClosestApproach() {
  closest = pair.A && pair.B ? findClosestApproach() : null;
  $("closestApproach").hidden = !closest;
  if (!closest) return;
  const tleAges = ["A", "B"].map(slot => {
    const lib = library[pair[slot]], i = nearestTleIndex(lib, closest.ms);
    return `${slotName(slot)} ${describeAge(closest.ms - lib.epochsMs[i])}`;
  });
  $("caDistance").textContent = formatKm(closest.km);
  $("caSpeed").textContent = formatSpeed(relativeSpeedAt(closest.ms));
  $("caTime").textContent = formatTimeSeconds(closest.ms);
  $("caDetails").textContent =
    `Nearest TLEs: ${tleAges.join("; ")}. ` +
    `Checked every ${Math.round(closest.stepMs / 1000).toLocaleString()} s, then narrowed to 1 s. ` +
    `Accuracy is limited by the TLEs (typically a kilometre or more, worse far from a TLE epoch). ` +
    `The gold chart line marks the current playhead; sampled minima appear below each chart.`;
}











// ---------------------------------------------------------------------------
// 11. Responding to the user
// ---------------------------------------------------------------------------
// When a dropdown changes: if the user picked the same satellite as the other slot,
// swap them so A and B are always different.
$("satA").addEventListener("change", event => {
  const a = event.target.value, b = a === pair.B ? pair.A : pair.B; //norad number now comes from event.target.value
  setPair(a, b); //writes two selected satellites into sat pair  S
});
$("satB").addEventListener("change", event => {
  const b = event.target.value, a = b === pair.A ? pair.B : pair.A;
  setPair(a, b);
});

// Time window menu: show the Start/End pickers only for "Custom dates".
// The other options reset the window to that option's dates.
$("windowMode").addEventListener("change", () => {
  const mode = $("windowMode").value;
  $("customDates").hidden = mode !== "custom";
    updateReportedBand();
  if (pair.A && pair.B && mode !== "custom") applyLimits();
});
$("startTime").addEventListener("change", () => setWindow(fromInputValue($("startTime").value), endMs));
$("endTime").addEventListener("change", () => setWindow(startMs, fromInputValue($("endTime").value)));

// Satellite lookup: run when "Look up" is clicked or Enter is pressed in the box.
async function runLookup() {
  $("lookupActions").hidden = true;            // tells the html file to hide the Load buttons until we know there's something to load
   lookupFound = null;                          // forget the previous result

  if (!satcat.length && !satcatError) await satcatReady();   // first lookup fetches the catalog
  if (satcatError) {                           // the catalog FAILED to load: keep saying why
    $("lookupResult").textContent = satcatError;
    return;
  }
  if (satcat.length === 0) {
    $("lookupResult").textContent = "The satellite catalog is still loading. Try again in a moment.";
    return;
  }
  const matches = identify($("lookupInput").value);
  const describe = s => `${s.name}  (NORAD ${s.norad}, ${s.intlDes}) · ${ownerHtml(s.norad)}`;


  if (matches.length === 0) {
    $("lookupResult").textContent = "No satellite found with that identifier.";
  } else if (matches.length === 1) {
    const found = matches[0];
    // Is this satellite in the TLE library (data/tles/index.json)?
    // Compare as numbers: the library pads NORAD numbers to 5 digits ("05398"), the catalog doesn't ("5398")
    const inLibrary = catalog.find(c => Number(c.norad) === Number(found.norad));
    if (inLibrary) {
      $("lookupResult").innerHTML = `${describe(found)}\nTLE history available: load it as satellite A or B.`;
      lookupFound = inLibrary.norad;           // use the library's spelling, since that's the TLE file's name
      $("lookupActions").hidden = false;       // show the Load buttons
    } else {
      $("lookupResult").innerHTML = `${describe(found)}\nNo TLE history on this site, but its current orbit can be loaded live from CelesTrak.`;
      lookupFound = found.norad.padStart(5, "0");   // 5 digits, the same style as the TLE library
      $("lookupActions").hidden = false;
    }
  } else {
    const shown = matches.slice(0, 10);   // show at most 10
    const header = matches.length > 10
      ? `${matches.length} matches (showing the first 10):`
      : `${matches.length} matches:`;
    $("lookupResult").innerHTML = [header, ...shown.map(describe)].join("\n");
  }
}
$("lookupBtn").addEventListener("click", runLookup);
$("lookupInput").addEventListener("keydown", event => {
  if (event.key === "Enter") runLookup();
});

// "Load as A" / "Load as B": put the satellite the lookup found into that slot.
// Same rule as the dropdowns: if it's already in the OTHER slot, swap the two.
$("loadAsA").addEventListener("click", () => { //when the load A button is clicked, run the code inside
  if (!lookupFound) return;                              // nothing found: do nothing
  const a = lookupFound, b = a === pair.B ? pair.A : pair.B;
  setPair(a, b);                                         // load TLEs, set the dates, redraw
});
$("loadAsB").addEventListener("click", () => {
  if (!lookupFound) return;
  const b = lookupFound, a = b === pair.A ? pair.B : pair.A;
  setPair(a, b);
});

// Earth-fixed / Relative motion switch
$("earthView").addEventListener("click", () => { preferredView = "earth"; setView("earth"); });
$("relativeView").addEventListener("click", () => { preferredView = "relative"; setView("relative"); });
$("modeBtn").addEventListener("click", () => { preferredView = view === "earth" ? "relative" : "earth"; setView(preferredView); });
// Switching which satellite is in the middle keeps the same zoom and angle; only the centre changes
function switchCentre(slot) {
  const offset = camera.position.clone().sub(controls.target);   // where the camera stands, measured from what it looks at
  setView("relative", slot);
  camera.position.copy(controls.target).add(offset);
}
$("centreA").addEventListener("click", () => switchCentre("A"));
// Clicking a satellite tile in "Now modeling" (relative view only) also puts that satellite at the centre
$("identity").addEventListener("click", event => {
  const button = event.target.closest(".featureButton");
  if (button && (view !== "relative" || button.dataset.slot !== centre)) switchCentre(button.dataset.slot);
});
$("centreB").addEventListener("click", () => switchCentre("B"));
// Show or hide the direction axes in the relative view
$("axesBtn").addEventListener("click", () => {
  showAxes = !showAxes;                                   // flip on <-> off
  $("axesBtn").classList.toggle("isOn", showAxes);       // dark when on
  relativeAxes.visible = view === "relative" && showAxes;
});

// Jump to the closest approach, in the satellite-centred view
$("caViewBtn").addEventListener("click", () => {
  if (!closest) return;
  playing = false;                                       // pause, so it stays on that moment
  $("playBtn").innerHTML = '<span class="playIcon"></span>';
  currentMs = closest.ms;
  autoZoom = true; 
  setView(view, centre, true);                     // true = zoom so both satellites are in the frame
});

wireSpeedButtons($("speed"), $("speedDownBtn"), $("speedUpBtn"), () => {});

$("playBtn").addEventListener("click", () => {
  focusedMinimumMs = null; chartDirty = true;
  playing = !playing;   // "!" means "not", so this flips true <-> false
  $("playBtn").innerHTML = playing ? '<span class="pauseIcon"></span>' : '<span class="playIcon"></span>';
});
// Dragging or clicking the slider: jump to that moment. A drag fires several input
// events per animation frame, so the redraw is coalesced into one per frame (the last
// event still wins, because the frame reads currentMs when it runs).
let sliderFrame = null;
$("timelineSlider").addEventListener("input", event => {
  focusedMinimumMs = null;
  playing = false;
  $("playBtn").innerHTML = '<span class="playIcon"></span>';
  currentMs = Number(event.target.value);
  chartDirty = true;
  if (sliderFrame !== null) return;
  sliderFrame = requestAnimationFrame(() => {
    sliderFrame = null;
    updateScene();
    if (view === "relative" && !cameraEditMode && !cameraTween) {
      followGeoReference();
      keepBothInFrame(true);
      controls.update(); camera.updateMatrixWorld(true);
      updateGeoBeltLabel(); updateScreenLabels(); renderer.render(scene, camera);
    }
  });
});
wireTimelineHover($("timelineSlider"), $("timelineHover"), $("timelineHoverTick"), () => [startMs, endMs]);
for (const id of ["distanceThreshold", "speedThreshold"]) $(id).addEventListener("input", updateThresholds);
function snappedThreshold(raw, increment, maximum) {
  const preferred = Math.round(raw / increment) * increment;
  const tolerance = increment === 25 ? 3 : .65;
  const precise = increment === 25 ? Math.round(raw) : Math.round(raw * 10) / 10;
  return Math.max(0, Math.min(maximum, Math.abs(raw - preferred) <= tolerance ? preferred : precise));
}
for (const [sliderId, inputId, increment, scaleKey] of [
  ["distanceThresholdSlider", "distanceThreshold", 25, "distanceKm"],
  ["speedThresholdSlider", "speedThreshold", 5, "speedMps"]
]) $(sliderId).addEventListener("input", event => {
  const next = snappedThreshold(Number(event.target.value), increment, chartScales?.[scaleKey] || Number(event.target.max));
  $(inputId).value = String(next); updateThresholds();
});
for (const [canvasId, inputId, increment] of [["separationChart", "distanceThreshold", 25], ["speedChart", "speedThreshold", 5]]) {
  const canvas = $(canvasId), input = $(inputId), edge = canvas.parentElement.querySelector(".thresholdEdge");
  let dragging = false, dragStartY = 0, dragStartValue = 0;
  const local = event => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const nearLine = event => {
    const chart = chartGeometry.get(canvas); if (!chart) return false;
    const point = local(event);
    return point.x >= chart.left - 3 && point.x <= canvas.getBoundingClientRect().width - 56 && Math.abs(point.y - chart.thresholdY) <= 9;
  };
  const setHover = hovered => {
    if (hovered === hoveredChartLines.has(canvas)) return;
    if (hovered) hoveredChartLines.add(canvas); else hoveredChartLines.delete(canvas);
    canvas.style.cursor = hovered ? "ns-resize" : "default";
    chartDirty = true;
  };
  const choose = raw => {
    const chart = chartGeometry.get(canvas); if (!chart) return;
    const next = snappedThreshold(raw, increment, chart.yMax);
    if (Number(input.value) !== next) { input.value = String(next); updateThresholds(); }
  };
  const setFromPointer = event => {
    const chart = chartGeometry.get(canvas); if (!chart) return;
    choose(dragStartValue + (dragStartY - local(event).y) / (chart.bottom - chart.top) * chart.yMax);
  };
  for (const target of [canvas, edge]) {
    target.addEventListener("pointermove", event => { if (dragging) setFromPointer(event); else setHover(target === edge || nearLine(event)); });
    target.addEventListener("pointerdown", event => {
      if (target === canvas && !nearLine(event)) return;
      event.preventDefault();
      dragging = true; dragStartY = local(event).y; dragStartValue = Number(input.value);
      chartCueFinished.add(canvas); target.setPointerCapture(event.pointerId); setHover(true);
    });
    target.addEventListener("pointerup", () => { dragging = false; setHover(false); });
    target.addEventListener("pointercancel", () => { dragging = false; setHover(false); });
    target.addEventListener("pointerleave", () => { if (!dragging) setHover(false); });
  }
  edge.addEventListener("keydown", event => {
    const step = increment === 25 ? 5 : 1;
    const change = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: increment, PageDown: -increment }[event.key];
    if (change === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const chart = chartGeometry.get(canvas); if (!chart) return;
    choose(event.key === "Home" ? 0 : event.key === "End" ? chart.yMax : Number(input.value) + change);
  });
}
$("zoomInBtn").addEventListener("click", () => { publishedCameraEnabled = false; autoZoom = false; cameraTween =null; camera.position.lerp(controls.target, 0.2); });
$("zoomOutBtn").addEventListener("click", () => { publishedCameraEnabled = false; autoZoom = false; cameraTween = null; camera.position.sub(controls.target).multiplyScalar(1.25).add(controls.target); });
$("resetBtn").addEventListener("click", () => { publishedCameraEnabled = true; autoZoom = true; if (!followPublishedCamera()) moveCameraSmoothly(); });
// Zooming by hand (mouse wheel, or two fingers on a touch screen) pauses auto-zoom
renderer.domElement.addEventListener("wheel", () => { publishedCameraEnabled = false; autoZoom = false; });
renderer.domElement.addEventListener("touchstart", event => { if (event.touches.length > 1) autoZoom = false; });

// Temporary view-capture workflow, visible only on the local ?dev=1 preview.
const cameraDevTools = $("cameraDevTools");
cameraDevTools.hidden = new URLSearchParams(location.search).get("dev") !== "1";
if (!cameraDevTools.hidden) window.__proximityDebug = () => {
  const rect = renderer.domElement.getBoundingClientRect();
  const marker = slot => {
    const p = dots[slot].position.clone().project(camera);
    return { visible: dots[slot].visible, x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2,
      label: screenLabelNodes[slot].getBoundingClientRect().toJSON() };
  };
  return { time: new Date(currentMs).toISOString(), view, autoZoom, cameraTween: !!cameraTween, playing,
    earthRotation: earthGroup.rotation.y, satelliteScene: { A: dots.A.position.toArray(), B: dots.B.position.toArray() },
    trailCounts: { A: trails.A.geometry.getAttribute("position")?.count || 0, B: trails.B.geometry.getAttribute("position")?.count || 0 },
    analysisSamples, chartSamples, analysisStepMs, analysisResult, camera: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov,
    markers: { A: marker("A"), B: marker("B") }, geoLabel: geoBeltLabel.getBoundingClientRect().toJSON() };
};
// The local review shell controls E-001 chapters without changing published playback.
if (localChapterReview) {
  window.__proximityWorkshop = {
    setPublishedCameraViews(views, chapterId) {
      publishedCameraViews = Array.isArray(views) ? views : [];
      publishedCameraChapter = chapterId;
      publishedCameraEnabled = true;
      cameraTween = null;
      followPublishedCamera();
    },
    setWindow(start, end) {
      const a = Date.parse(start), b = Date.parse(end);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) throw new Error("Invalid chapter window");
      playing = false; $("playBtn").innerHTML = '<span class="playIcon"></span>';
      setWindow(a, b);
    },
    setTime(value) {
      const ms = Date.parse(value);
      if (!Number.isFinite(ms) || ms < startMs || ms > endMs) throw new Error("Time is outside this chapter");
      playing = false; $("playBtn").innerHTML = '<span class="playIcon"></span>';
      currentMs = ms; chartDirty = true; updateScene();
    },
    play() { if (!playing) $("playBtn").click(); },
    pause() { if (playing) $("playBtn").click(); },
    capture() { $("captureViewBtn").click(); return JSON.parse($("cameraCaptureOutput").value); },
    motionPreview(timeUtc, spanMinutes) {
      const middle = Date.parse(timeUtc), half = spanMinutes * MINUTE_MS / 2;
      const frameRect = window.frameElement?.getBoundingClientRect() || { left: 0, top: 0 };
      const canvasRect = renderer.domElement.getBoundingClientRect();
      const panelRect = $("ui")?.getBoundingClientRect();
      const panelRight = panelRect ? frameRect.left + panelRect.right + 8 : 0;
      const bounds = { left: Math.min(frameRect.left + canvasRect.right - 12, Math.max(frameRect.left + canvasRect.left, panelRight)), top: frameRect.top + canvasRect.top,
        right: frameRect.left + canvasRect.right, bottom: frameRect.top + canvasRect.bottom };
      camera.updateMatrixWorld(true);
      const sampleCount = 49, midpoint = (sampleCount - 1) / 2;
      const series = ["A", "B"].map(slot => ({ slot, label: slotName(slot), color: slot === "A" ? "#b48700" : "#686868", primary: true,
        points: Array.from({ length: sampleCount }, (_, index) => {
          const ms = Math.max(startMs, Math.min(endMs, middle + half * (index - midpoint) / midpoint));
          const state = view === "relative" ? null : stateAt(pair[slot], ms);
          const point = view === "relative" ? slot === centre ? new THREE.Vector3() : relativePointAt(ms) : state ? eciToScene(state.r) : null;
          if (!point) return null;
          const projected = point.project(camera);
          const x = frameRect.left + canvasRect.left + (projected.x + 1) * canvasRect.width / 2;
          const y = bounds.top + (1 - projected.y) * canvasRect.height / 2;
          return { x, y, inside: x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom && projected.z >= -1 && projected.z <= 1,
            visibleDepth: projected.z >= -1 && projected.z <= 1 };
        }) }));
      return { bounds, series };
    },
    applyCamera(viewConfig) {
      setView(viewConfig.cameraMode, ["A", "B"].includes(viewConfig.referenceSatellite) ? viewConfig.referenceSatellite : centre, true);
      this.applyFraming(viewConfig);
    },
    applyFraming(viewConfig, anchorToCurrent = false) {
      for (const key of ["position", "target", "up"]) if (!Array.isArray(viewConfig[key]) || viewConfig[key].length !== 3 || !viewConfig[key].every(Number.isFinite)) throw new Error(`Invalid camera ${key}`);
      if (!Number.isFinite(viewConfig.fieldOfViewDeg) || !Number.isFinite(viewConfig.zoom)) throw new Error("Invalid camera optics");
      playing = false; $("playBtn").innerHTML = '<span class="playIcon"></span>';
      cameraTween = null; cameraEditMode = true; autoZoom = false; controls.enablePan = true;
      const savedTarget = new THREE.Vector3().fromArray(viewConfig.target);
      const savedPosition = new THREE.Vector3().fromArray(viewConfig.position);
      if (anchorToCurrent) savedPosition.add(controls.target.clone().sub(savedTarget));
      camera.position.copy(savedPosition);
      if (!anchorToCurrent) controls.target.copy(savedTarget);
      camera.up.fromArray(viewConfig.up);
      camera.fov = viewConfig.fieldOfViewDeg; camera.zoom = viewConfig.zoom; camera.updateProjectionMatrix(); controls.update();
      chartDirty = true; updateScene();
    },
    hold(value) {
      cameraEditMode = !!value; autoZoom = !value; controls.enablePan = !!value;
      $("holdCameraBtn").setAttribute("aria-pressed", String(!!value));
      $("holdCameraBtn").textContent = value ? "Release camera" : "Hold camera";
      if (value) { playing = false; $("playBtn").innerHTML = '<span class="playIcon"></span>'; cameraTween = null; }
      else moveCameraSmoothly();
    },
    setReference(slot) {
      if (!["A", "B"].includes(slot)) throw new Error("Unknown reference satellite");
      if (view === "relative") setView("relative", slot, true);
      else centre = slot;
    },
    setMode(mode) { if (!["earth", "relative"].includes(mode)) throw new Error("Unknown camera mode"); setView(mode, centre, true); },
    setSpeed(secondsPerSecond) {
      const select = $("speed"), value = String(secondsPerSecond);
      if (![...select.options].some(option => option.value === value)) select.add(new Option(`${secondsPerSecond / 60} min/s`, value));
      select.value = value;
    },
    get state() { return { time: currentMs, start: startMs, end: endMs, playing, held: cameraEditMode, mode: view, referenceSatellite: centre }; },
  };

  // What a comment stores so it can bring the page back to this exact moment,
  // camera and filter set. The shared comment module calls this hook.
  window.__commentView = {
    capture() {
      const state = window.__proximityWorkshop.state;
      return {
        time: Number.isFinite(state.time) ? new Date(state.time).toISOString() : "",
        chapter: publishedCameraChapter || "",
        chapterLabel: publishedCameraChapter || "",
        camera: cameraViewConfig(),
        speed: $("speed").value,
        windowMode: $("windowMode").value,
        start: $("windowMode").value === "custom" ? $("startTime").value : "",
        end: $("windowMode").value === "custom" ? $("endTime").value : "",
        thresholds: { distance: $("distanceThreshold").value, speed: $("speedThreshold").value },
        axes: $("axesBtn").classList.contains("isOn"),
      };
    },
    apply(saved) {
      if (!saved || !saved.camera) return false;
      try {
        if (saved.windowMode && $("windowMode").value !== saved.windowMode) {
          $("windowMode").value = saved.windowMode;
          $("windowMode").dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (saved.windowMode === "custom") {
          if (saved.start) { $("startTime").value = saved.start; $("startTime").dispatchEvent(new Event("change", { bubbles: true })); }
          if (saved.end) { $("endTime").value = saved.end; $("endTime").dispatchEvent(new Event("change", { bubbles: true })); }
        }
        if (saved.speed && [...$("speed").options].some(option => option.value === saved.speed)) $("speed").value = saved.speed;
        if (saved.thresholds) {
          for (const [id, value] of [["distanceThreshold", saved.thresholds.distance], ["speedThreshold", saved.thresholds.speed]]) {
            if (value === undefined || value === null || value === "") continue;
            $(id).value = value;
            const slider = $(`${id}Slider`);
            if (slider && Number(value) >= Number(slider.min) && Number(value) <= Number(slider.max)) slider.value = value;
          }
          updateThresholds();
        }
        if (saved.axes !== undefined && $("axesBtn").classList.contains("isOn") !== Boolean(saved.axes)) $("axesBtn").click();
        if (saved.time) {
          try { window.__proximityWorkshop.setTime(saved.time); } catch { /* outside the restored window */ }
        }
        window.__proximityWorkshop.applyCamera(saved.camera);
        return true;
      } catch (err) {
        console.warn("Comment view restore failed:", err);
        return false;
      }
    },
  };

}
$("devTime").addEventListener("change", event => {
  const requested = Date.parse(`${event.target.value}Z`);
  if (!Number.isFinite(requested) || requested < startMs || requested > endMs) {
    $("cameraCaptureStatus").textContent = "Choose a UTC time inside the playback window.";
    return;
  }
  playing = false; $("playBtn").innerHTML = '<span class="playIcon"></span>';
  currentMs = requested; chartDirty = true; updateScene();
  $("cameraCaptureStatus").textContent = "Playback paused at the selected UTC time.";
});
$("holdCameraBtn").addEventListener("click", () => {
  cameraEditMode = !cameraEditMode;
  $("holdCameraBtn").setAttribute("aria-pressed", String(cameraEditMode));
  $("holdCameraBtn").textContent = cameraEditMode ? "Release camera" : "Hold camera";
  if (cameraEditMode) {
    playing = false; $("playBtn").innerHTML = '<span class="playIcon"></span>';
    cameraTween = null; autoZoom = false; controls.enablePan = true;
    $("devTime").value = new Date(currentMs).toISOString().slice(0, 16);
    $("cameraCaptureStatus").textContent = "Paused. Drag to rotate, right-drag to pan, scroll to zoom.";
  } else {
    autoZoom = true; moveCameraSmoothly();
    $("cameraCaptureStatus").textContent = "Automatic framing restored.";
  }
});
$("loadReferenceViewBtn").addEventListener("click", () => {
  if (!preferredCameraReference || !pair.A || !pair.B) return;
  playing = false; $("playBtn").innerHTML = '<span class="playIcon"></span>';
  currentMs = Date.parse(preferredCameraReference.simulationTimeUtc);
  setView("relative", centre, true);
  cameraTween = null; cameraEditMode = true; autoZoom = false;
  $("holdCameraBtn").setAttribute("aria-pressed", "true");
  $("holdCameraBtn").textContent = "Release camera";
  camera.position.fromArray(preferredCameraReference.position);
  controls.target.fromArray(preferredCameraReference.target);
  camera.up.fromArray(preferredCameraReference.up);
  camera.fov = preferredCameraReference.fieldOfViewDeg;
  camera.zoom = preferredCameraReference.zoom;
  camera.near = preferredCameraReference.near;
  camera.far = preferredCameraReference.far;
  camera.updateProjectionMatrix(); controls.update(); sizeSceneSprites();
  chartDirty = true; updateScene();
  $("devTime").value = new Date(currentMs).toISOString().slice(0, 16);
  $("cameraCaptureStatus").textContent = `Captured position and direction loaded at ${new Date(currentMs).toISOString()}; viewport aspect ${camera.aspect.toFixed(3)}.`;
});
// The serialisable description of the camera right now. Shared by the dev
// "Capture view" button and by comments, which store it without touching the
// clipboard or pausing playback.
function cameraViewConfig() {
  camera.updateMatrixWorld(true);
  const rounded = value => Number(value.toFixed(7));
  return {
    schema: "espl-proximity-camera-view-v1",
    simulationTimeUtc: new Date(currentMs).toISOString(),
    cameraMode: view,
    ...(localChapterReview ? { referenceSatellite: centre } : {}),
    referenceFrame: "Three.js scene coordinates in Earth-radius units; ECI [x,y,z] maps to [x,z,-y]",
    geoReferenceLongitudeDeg,
    position: camera.position.toArray().map(rounded),
    target: controls.target.toArray().map(rounded),
    quaternion: camera.quaternion.toArray().map(rounded),
    up: camera.up.toArray().map(rounded),
    fieldOfViewDeg: rounded(camera.fov), zoom: rounded(camera.zoom),
    near: rounded(camera.near), far: rounded(camera.far), aspect: rounded(camera.aspect),
    viewport: { width: renderer.domElement.clientWidth, height: renderer.domElement.clientHeight },
  };
}
$("captureViewBtn").addEventListener("click", async () => {
  playing = false; $("playBtn").innerHTML = '<span class="playIcon"></span>';
  const config = cameraViewConfig();
  const value = JSON.stringify(config, null, 2), output = $("cameraCaptureOutput");
  output.value = value; output.hidden = false;
  try { await navigator.clipboard.writeText(value); $("cameraCaptureStatus").textContent = "View copied. Paste it into our discussion."; }
  catch { output.select(); document.execCommand("copy"); $("cameraCaptureStatus").textContent = "View captured. Copy the text below into our discussion."; }
});

// Keep the 3D view beside the panel and the right size when the window is resized.
function updateRendererLayout() {
  const desktop = innerWidth > 760;
  const panelEdge = chapterMode.get("mini") === "1" ? 0 : desktop ? Math.ceil($("ui").getBoundingClientRect().right + 18) : 0;
  // Render underneath the panel instead of ending the orbit at the canvas edge.
  // Offset the optical center so the visible scene keeps its previous framing.
  renderer.domElement.style.left = "0px";
  camera.aspect = innerWidth / innerHeight;
  if (panelEdge) camera.setViewOffset(innerWidth, innerHeight, -panelEdge / 2, 0, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  canvasBox = null;                          // the canvas box just changed: measure it again
  labelSizes.A.text = labelSizes.B.text = null;   // and re-measure the screen labels
  if (pair.A || pair.B) updateNames();       // redraw the labels at the new screen size
  chartDirty = true; drawEpisodeCharts();
}
addEventListener("resize", updateRendererLayout);
updateRendererLayout();











// ---------------------------------------------------------------------------
// 12. The animation loop — the browser calls this about 60 times per second
// ---------------------------------------------------------------------------
function animate(now) {
  requestAnimationFrame(animate);   // Ask to be called again on the next frame

  if (miniScene) {
    const base = miniMarkerScale(camera, renderer.domElement.clientHeight);
    const pulse = miniSceneHover && !miniReducedMotion.matches ? 1 + .32 * (.5 + .5 * Math.sin(now / 180)) : 1;
    for (const slot of ["A", "B"]) dots[slot].scale.set(base * pulse, base * pulse, 1);
  }

  if (analysisSamples.length && [...visibleCharts].some(canvas => !chartCueFinished.has(canvas)) && now - lastChartDraw > 50) {
    drawEpisodeCharts(); lastChartDraw = now;
  }

  if (playing && pair.A && library[pair.A] && library[pair.B]) {
    const secondsSinceLastFrame = Math.min((now - lastFrameTime) / 1000, 0.1);
    currentMs += secondsSinceLastFrame * Number($("speed").value) * 1000;   // speed = simulated seconds per real second
    if (currentMs > (miniLoopEnd || endMs)) currentMs = miniLoopStart || startMs;   // Loop back to the start
    updateScene();
  }

  if (cameraTween) {
    const raw = Math.min(1, (now - cameraTween.start) / cameraTween.duration);
    const eased = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;   // Start slow, speed up, slow down
    camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
    camera.fov = cameraTween.fromFov + (cameraTween.toFov - cameraTween.fromFov) * eased;
    camera.updateProjectionMatrix(); sizeSceneSprites();
    if (raw >= 1) cameraTween = null;
  }

  // Orbit lines darken for a moment when their satellite switches to a new TLE
  for (const slot of ["A", "B"]) {
    const brightness = now < flashUntil[slot] ? TLE_FLASH_DARKEN : 1;
    trails[slot].material.uniforms.uColor.value.set(SLOTS[slot].line).multiplyScalar(brightness);
    trails[slot].material.uniforms.uResolution.value.set(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
  }
  if (localChapterReview) localMotionTrail.material.uniforms.uResolution.value.set(renderer.domElement.clientWidth, renderer.domElement.clientHeight);

lastFrameTime = now;
  updateIdentityAges();
  if (!followPublishedCamera()) {
    followGeoReference();
    keepBothInFrame();
  }
  controls.update();
  // Projection must use this frame's camera, before WebGLRenderer updates it.
  camera.updateMatrixWorld(true);
  // Match the SBI globe's useful depth precision while retaining close-up
  // spacecraft zooms. A fixed near plane of .0001 made 1.0017-radius borders
  // fight with the Earth depth buffer and appear dotted during movement.
  const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * .05, .001, 2);
  if (Math.abs(camera.near - near) > near * .01) { camera.near = near; camera.updateProjectionMatrix(); }
  updateBorderDetail();
  updateScreenLabels();
  updateGeoBeltLabel();
  // Keep dashes the same size on screen at any zoom: DASH_SCREEN_SIZE of the screen height,
  // turned into scene units at the camera's distance (the same idea as the dot sizes in setView)
  const lens = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dash = DASH_SCREEN_SIZE * camera.position.distanceTo(controls.target) * lens;
  for (const line of [relativeTrail]) {
    line.userData.dashed.dashSize = dash;
    line.userData.dashed.gapSize = dash;
  }

  renderer.render(scene, camera);
}

// Load the full satellite catalog for the lookup box. async function can wait for slow things, like downloading a long file
async function loadSatcat() {
  $("lookupResult").textContent = "Loading satellite catalog…";
  try {                                                  // if anything inside fails, jump to catch
    const response = await fetch("data/satcat.json");
    if (!response.ok) throw new Error("Satellite catalog not found. Run:  python Viz/build_satcat_json.py");
    satcat = await response.json();
    $("lookupResult").textContent = `Catalog ready: ${satcat.length.toLocaleString()} objects.`;
    if (pair.A && pair.B) {             // satellites chosen before the catalog arrived: add their flags now
      updateNames();
      lastIdentityKey = "";
      updateIdentity();
    }
  } catch (error) {                                      // missing file, broken file, or no connection
    satcatError = error.message;                         // remember why, for runLookup
    $("lookupResult").textContent = satcatError;
  }
}
// The catalog is several megabytes and only the lookup box needs it, so it is fetched
// the first time that box is used. Every caller shares the one download.
let satcatRequest = null;
function satcatReady() {
  return satcatRequest ||= loadSatcat();
}











// ---------------------------------------------------------------------------
// 13. Start: load the satellite catalog and TLE library list, then wait for the user to pick satellites
// ---------------------------------------------------------------------------
try {
  owners = await (await fetch("data/owners.json")).json();
} catch (error) {
  console.warn("No owner list (data/owners.json), so no flags", error);
}
// The catalog is loaded on the first real interaction with the finder (see satcatReady),
// never during page load. A "toggle" listener would also fire here while the panel was
// being set up, which started the download anyway.
for (const event of ["focusin", "pointerdown"]) $("findSection").addEventListener(event, () => satcatReady());
try {
  let indexResponse = await fetch(`${tleFolder}/index.json`);
  if (!indexResponse.ok) {                     // no full library (as on the live site): use the published subset
    tleFolder = "data/tles_public";
    indexResponse = await fetch(`${tleFolder}/index.json`);
  }
  if (!indexResponse.ok) throw new Error("TLE library not found. Run:  python Code/build_tle_library.py");
  catalog = (await indexResponse.json()).satellites;
  fillDropdowns();

  // This local iteration presents only E-001. Dates and participants live in
  // its own configuration; the original case library and engine stay intact.
  episodeConfig = await fetch("../local/episodes/E-001.json").then(response => {
    if (!response.ok) throw new Error("E-001 configuration unavailable");
    return response.json();
  });
  if (localChapterReview) {
    const satcat = await fetch("../../dynamic-table/data/space-track-satcat.json").then(response => {
      if (!response.ok) throw new Error("Space-Track SATCAT extract unavailable");
      return response.json();
    });
    for (const participant of episodeConfig.participants) {
      const record = satcat.records?.[participant.cospar];
      if (record?.NORAD_CAT_ID !== String(participant.norad) || !record.OBJECT_NAME) {
        throw new Error(`Space-Track SATCAT record unavailable for ${participant.cospar}`);
      }
      participant.name = record.OBJECT_NAME;
    }
  }
  const feed = await loadCurrentEpisodes();
  const liveEpisode = feed.episodes.find(row => row.ID === "E-001");
  if (!liveEpisode) throw new Error("E-001 is missing from the current published Episodes sheet");
  const episodeName = liveEpisode["Episode Name"]?.trim() || liveEpisode.ID;
  $("episodeTitle").replaceChildren(safeEpisodeName(episodeName));
  document.title = `Visualizing Proximity in Space — ${episodeNameText(episodeName)}`;
  const interval = episodeUtcInterval(liveEpisode);
  episodeConfig.researchWindow = { start: interval.start, end: interval.end };
  episodeConfig.playbackWindow = { start: new Date(interval.startMs).toISOString(), end: new Date(interval.endMs).toISOString() };
  preferredCameraReference = await fetch("../local/camera-references/E-001-2017-10-30.json").then(response => response.ok ? response.json() : null);
  episodeStartMs = interval.startMs;
  episodeEndMs = interval.endMs;
  analysisStepMs = episodeConfig.analysisStepMinutes * MINUTE_MS;
  geoReferenceLongitudeDeg = episodeConfig.geoReferenceLongitudeDeg;
  $("distanceThreshold").value = episodeConfig.defaultThresholds.separationKm;
  $("speedThreshold").value = episodeConfig.defaultThresholds.relativeSpeedMps;
  reportedPeriod = { start: episodeStartMs, end: episodeEndMs };
  caseNorads = episodeConfig.participants.map(participant => participant.norad);
  await setPair(caseNorads[0], caseNorads[1]);
  if (chapterMode.get("mini") === "1") {
    const chapter = episodeChapters(liveEpisode)[0];
    if (!chapter) throw new Error("E-001 mini scene has no published chapter");
    miniWindows = episodeChapters(liveEpisode).map(item => ({ id: item.id, label: new Date(item.center).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }), start: item.start, end: item.end, anchor: item.center }));
    miniActive = miniWindows[0];
    const anchor = chapter.centerMs;
    pinMiniTles(anchor);
    setWindow(Date.parse(chapter.start), Date.parse(chapter.end));
    setView("relative", "A", true);
    $("speed").add(new Option("5 min/s", "300"));
    $("speed").value = "300";
    {
      miniLoopStart = Date.parse(chapter.start); miniLoopEnd = Date.parse(chapter.end);
      currentMs = miniLoopStart; updateScene();
      window.miniWorkshop = {
        getMarkerPositions() { return ["A", "B"].map(slot => {
          const marker = dots[slot], point = marker.position.clone().project(camera);
          return { slot, x: (point.x + 1) / 2, y: (1 - point.y) / 2,
            visible: marker.visible && point.z >= -1 && point.z <= 1,
            color: SLOTS[slot].dot, opacity: marker.material.opacity };
        }); },
        get ready() { return !!pair.A && !!pair.B; },
        get windows() { return miniWindows; },
        get window() { return miniActive; },
        get current() { return currentMs; },
        get playing() { return playing; },
        get rate() { return Number($("speed").value); },
        get loopStart() { return miniLoopStart; },
        get loopEnd() { return miniLoopEnd; },
        get frameMode() { return view === "earth" ? "inertial" : "relative"; },
        get tleEpochs() { return Object.fromEntries(["A", "B"].map(slot => { const lib = library[pair[slot]], index = miniPinnedTles.get(lib); return [slot, lib?.tles[index]?.epoch ?? null]; })); },
        get origins() { return [{ value: "A", label: slotName("A") }, { value: "B", label: slotName("B") }]; },
        get origin() { return centre; },
        setRate(value) { const rate = String(Math.max(60, Math.min(14400, Number(value) || 300))); if (![...$("speed").options].some(option => option.value === rate)) $("speed").add(new Option(`${Number(rate) / 60} min/s`, rate)); $("speed").value = rate; },
        selectWindow(id) {
          miniActive = miniWindows.find(item => item.id === id) || miniWindows[0];
          pinMiniTles(Date.parse(miniActive.anchor));
          setWindow(Date.parse(miniActive.start), Date.parse(miniActive.end));
          miniLoopStart = Date.parse(miniActive.start);
          miniLoopEnd = Date.parse(miniActive.end);
          currentMs = miniLoopStart; playing = true; updateScene();
        },
        setTime(ms) { currentMs = Math.max(startMs, Math.min(endMs, Number(ms))); playing = false; updateScene(); },
        setLoop(start, end) {
          if (!Number.isFinite(start) || !Number.isFinite(end) || start < startMs || end > endMs || end - start < MINUTE_MS) throw new Error("Choose a loop of at least one minute inside this chapter.");
          miniLoopStart = start; miniLoopEnd = end; pinMiniTles((start + end) / 2); currentMs = Math.max(start, Math.min(end, currentMs)); updateScene();
        },
        setPlaying(value) { if (value && currentMs >= miniLoopEnd) currentMs = miniLoopStart; playing = !!value; },
        setEditing(value) { document.documentElement.classList.toggle("mini-editing", !!value); if (value) { cameraEditMode = true; autoZoom = false; controls.enablePan = true; cameraTween = null; } },
        toggleFrame() { setView(view === "relative" ? "earth" : "relative", centre, true); },
        setOrigin(slot) {
          if (!["A", "B"].includes(slot)) throw new Error("Unknown origin satellite");
          const editing = document.documentElement.classList.contains("mini-editing");
          setView("relative", slot, true);
          if (editing) { cameraEditMode = true; autoZoom = false; controls.enablePan = true; cameraTween = null; }
        },
        zoom(factor) { autoZoom = false; cameraTween = null; camera.position.sub(controls.target).multiplyScalar(1 / factor).add(controls.target); controls.update(); },
        moveComposition(x, y) {
          cameraEditMode = true; autoZoom = false; cameraTween = null; controls.enablePan = true;
          camera.updateMatrixWorld();
          const distance = camera.position.distanceTo(controls.target);
          const step = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * .16;
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          const shift = right.multiplyScalar(-x * step).addScaledVector(up, -y * step);
          camera.position.add(shift); controls.target.add(shift); controls.update();
        },
        setHover(value) { miniSceneHover = !!value; miniEarthColor.setHex(miniSceneHover ? miniEarthHover : miniEarthRest); },
        resetCamera() { cameraEditMode = false; autoZoom = true; setView(view, centre, true); },
        captureCamera(name = "Dynamic Table mini preview") { return { name, timestampUtc: new Date(currentMs).toISOString(), frameMode: view === "earth" ? "inertial" : "relative", referenceSatellite: centre, position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(), fieldOfViewDeg: camera.fov, zoom: camera.zoom }; },
        applyCamera(saved) {
          setView(saved.frameMode === "inertial" ? "earth" : "relative", ["A", "B"].includes(saved.referenceSatellite) ? saved.referenceSatellite : centre, true);
          cameraTween = null; cameraEditMode = true; autoZoom = false; controls.enablePan = true;
          camera.position.fromArray(saved.position); controls.target.fromArray(saved.target); camera.up.fromArray(saved.up);
          camera.fov = saved.fieldOfViewDeg; camera.zoom = saved.zoom; camera.updateProjectionMatrix(); controls.update(); updateScene();
        },
      };
      parent.postMessage({ type: "espl-e001-mini-ready" }, location.origin);
      requestAnimationFrame(() => document.documentElement.classList.remove("episode-initializing"));
    }
  }
  setTimeout(() => {
    for (const id of ["separationChart", "speedChart"]) {
      const chart = $(id);
      if ((chartRatios.get(chart) || 0) < .85) chartsSeenOutside.add(chart);
      else { chartsSeenOutside.delete(chart); initiallyVisibleCharts.add(chart); }
      visibleCharts.delete(chart);
    }
    chartCuesReady = true;
  }, 450);
  if (analysisSamples.length && pair.A && pair.B) { playing = true; $("playBtn").innerHTML = '<span class="pauseIcon"></span>'; }
  $("devTime").min = new Date(startMs).toISOString().slice(0, 16);
  $("devTime").max = new Date(endMs).toISOString().slice(0, 16);
  $("devTime").value = new Date(currentMs).toISOString().slice(0, 16);
} catch (error) {
  $("rangeNote").textContent = error.message;
  if (document.documentElement.classList.contains("mini-scene")) {
    const bootText = document.getElementById("episodeBootText");
    if (bootText) bootText.textContent = `Mini preview unavailable: ${error.message}`;
  }
  console.error(error);
}
animate(performance.now());

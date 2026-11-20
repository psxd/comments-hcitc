import { placeEpisodeScreenLabels } from "./screen-label-layout.js";
import { renderSharedCommentList } from "../dev/review-shell.js?v=2";
/* Local E-059 full visualization. Two spacecraft remain visible; nearest dated
   Space-Track elements drive playback. Statistical chart gaps mark old TLEs. */
import * as THREE from "./vendor/three/three.module.js";
import { OrbitControls } from "./vendor/three/addons/controls/OrbitControls.js";
import { feature } from "./vendor/topojson/topojson-client.js";
import { loadCurrentEpisodes, episodeChapters, plottedObjects } from "../../shared/episode-feed.js?v=6";
import { spaceTrackHistoryUrl } from "../../shared/tle-provenance.js";
import { DOT_SCREEN_SIZE, dotTexture, fadingTrailGeometry, fadingTrailMaterial, miniMarkerScale } from "./relative-rendering.js?v=5";
import { wireTimelineHover } from "./playback-shared.js";
import { analyzeEpisode, exclusiveQualificationIntervals } from "./e001-analysis.js";
import { drawOrbitalChart } from "../dev/e002-control-panel-preview/orbital-preview.js?v=2";
import { installGlossary } from "../dev/e002-control-panel-preview/glossary.js";
import { formatDwellDuration } from "../../shared/format-duration.js";
import { dwellSatelliteName } from "../../shared/dwell-name.js";
import { safeEpisodeName } from "../../shared/episode-name.js";

const $ = id => document.getElementById(id);
const panelPreview = new URLSearchParams(location.search).get("panelPreview") === "1";
const miniScene = new URLSearchParams(location.search).get("mini") === "1";
const EARTH_KM = 6378.137, HOUR = 3600000;
// Building an Intl.DateTimeFormat is expensive and these run on every slider frame.
const UTC_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const SHORT_UTC_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const utc = ms => UTC_FORMAT.format(new Date(ms)) + " UTC";
const shortUtc = ms => SHORT_UTC_FORMAT.format(new Date(ms));
const displayName = name => name;
const toScene = p => new THREE.Vector3(p.x / EARTH_KM, p.z / EARTH_KM, -p.y / EARTH_KM);
const svgLink = '<svg viewBox="0 0 18 18" width="12" height="12" aria-hidden="true"><path class="espl-news-external__box" d="M7.25 4.25H4.5A1.75 1.75 0 0 0 2.75 6v7.5a1.75 1.75 0 0 0 1.75 1.75H12a1.75 1.75 0 0 0 1.75-1.75v-2.75"></path><g class="espl-news-external__arrow"><path d="M9.25 2.75h6v6"></path><path d="m8 10 7.25-7.25"></path></g></svg>';

try { await start(); } catch (error) {
  console.error("E-059 visualization", error);
  const status = $("sceneStatus") || document.createElement("p");
  status.id = "sceneStatus"; status.textContent = `Episode ${new URLSearchParams(location.search).get("episode") || "E-008"} could not load: ${error.message}`; document.body.append(status);
  const bootText = document.getElementById("episodeBootText"); if (bootText) bootText.textContent = `Could not load episode: ${error.message}`;
}

async function start() {
  const [{ episodes }, catalog, manifest, cameraData] = await Promise.all([
    loadCurrentEpisodes(),
    fetch("../dev/e059/space-track-e059.json").then(r => r.json()),
    fetch("../dev/e059/data/provenance.json").then(r => r.json()),
    fetch("../dev/e059/saved-camera-views.json", { cache: "no-store" }).then(r => r.ok ? r.json() : { views: [] }).catch(() => ({ views: [] })),
  ]);
  const row = episodes.find(item => item.ID === "E-059" && (miniScene || new URLSearchParams(location.search).get("dev") === "1" || /^(true|yes|1)$/i.test(item.Frontend || "")));
  if (!row) throw new Error("The requested episode is unavailable in the published Episodes sheet");
  const chapters = episodeChapters(row);
  if (!chapters.length) throw new Error(`${row["Episode ID"]} has no valid chapter center and width`);
  let learnedByRoute = new Map();
  function setSavedCameraViews(views) {
    const grouped = new Map();
    for (const view of views || []) {
      const ms = Date.parse(view.timeUtc);
      if (!Number.isFinite(ms) || !chapters.some(chapter => chapter.id === view.chapterId) || view.selected !== "B" || !["A", view.selected].includes(view.referenceSlot)) continue;
      if (![view.position, view.target, view.up].every(vector => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite))) continue;
      const key = `${view.chapterId}:${view.selected}:${view.referenceSlot}`;
      if (!grouped.has(key)) grouped.set(key, new Map());
      grouped.get(key).set(ms, { ms, view });
    }
    learnedByRoute = new Map([...grouped].map(([key, timed]) => [key, [...timed.values()].sort((a, b) => a.ms - b.ms)]));
  }
  setSavedCameraViews(cameraData.views);
  function learnedCameraAt(chapterId, ms, selected, referenceSlot) {
    const views = learnedByRoute.get(`${chapterId}:${selected}:${referenceSlot}`);
    if (!views?.length) return null;
    let index = 0;
    while (index < views.length && views[index].ms < ms) index++;
    const right = views[Math.min(index, views.length - 1)], left = views[Math.max(0, index - 1)];
    const raw = right.ms === left.ms ? 0 : THREE.MathUtils.clamp((ms - left.ms) / (right.ms - left.ms), 0, 1);
    const fraction = raw * raw * (3 - 2 * raw);
    const eye = item => new THREE.Vector3(...item.view.position).sub(new THREE.Vector3(...item.view.target));
    const leftEye = eye(left), rightEye = eye(right);
    const direction = leftEye.clone().normalize().lerp(rightEye.clone().normalize(), fraction);
    if (direction.lengthSq() < 1e-8) direction.copy(leftEye);
    direction.normalize();
    const distance = Math.exp(THREE.MathUtils.lerp(Math.log(Math.max(.001, leftEye.length())), Math.log(Math.max(.001, rightEye.length())), fraction));
    const target = new THREE.Vector3(...left.view.target).lerp(new THREE.Vector3(...right.view.target), fraction);
    return { position: target.clone().addScaledVector(direction, distance), target,
      up: new THREE.Vector3(...left.view.up).lerp(new THREE.Vector3(...right.view.up), fraction).normalize(),
      zoom: THREE.MathUtils.lerp(left.view.zoom || 1, right.view.zoom || 1, fraction),
      fov: THREE.MathUtils.lerp(left.view.fov || 35, right.view.fov || 35, fraction) };
  }
  const participants = plottedObjects(row).map(({ slot, cospar }) => {
    const record = catalog.records[cospar];
    if (!record) throw new Error(`Space-Track SATCAT has no ${cospar}`);
    return { slot, cospar, norad: String(record.NORAD_CAT_ID), name: record.SATNAME || record.OBJECT_NAME,
      launchMs: Date.parse(`${record.LAUNCH}T00:00:00Z`),
      color: slot === "A" ? "#eaaa00" : "#a9a9a9" };
  });
  if (participants.length !== 2 || participants.some((item, index) => item.slot !== "AB"[index])) throw new Error(`${row["Episode ID"]} needs the two published spacecraft`);
  const manifestBaseUrl = new URL("../dev/e059/", import.meta.url);
  const libraries = {};
  await Promise.all(participants.map(async item => {
    const source = manifest.datasets.find(entry => entry.object.norad === item.norad);
    if (!source) throw new Error(`No dated elements for ${item.name}`);
    const sourceUrl = new URL(source.url, manifestBaseUrl);
    sourceUrl.searchParams.set("sha", source.sha256.slice(0, 16));
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`${item.name} elements returned ${response.status}`);
    const bytes = await response.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== source.sha256) throw new Error(`${item.name} element file changed since verification`);
    libraries[item.slot] = JSON.parse(new TextDecoder().decode(bytes)).tles.map(tle => ({ ...tle, ms: Date.parse(tle.epoch), satrec: null }));
  }));

  document.body.classList.add("e059-shared");
  document.head.insertAdjacentHTML("beforeend", '<link rel="stylesheet" href="episode-e002.css"><link rel="stylesheet" href="episode-e059.css">');
  $("ui").querySelector(".episodeHeader h1").textContent = "Visualizing Proximity in the Space Domain";
  $("episodeTitle").replaceChildren(safeEpisodeName(row["Episode Name"]));
  const oldBack = $("ui").querySelector(".backEpisodes");
  const focus = document.createElement("section"); focus.id = "episodeFocus"; focus.className = "episode-focus";
  const focusLink = document.createElement("a"); focusLink.className = "episode-focus-link"; focusLink.href = "../../dynamic-table/";
  focusLink.setAttribute("aria-label", "Choose a different episode");
  const focusTop = document.createElement("div"); focusTop.className = "episode-focus-top";
  const eyebrow = document.createElement("span"); eyebrow.className = "episode-eyebrow"; eyebrow.textContent = "Current episode";
  const action = document.createElement("span"); action.className = "episode-hover-action"; action.setAttribute("aria-hidden", "true");
  action.append(oldBack.querySelector(".libraryBackArrow").cloneNode(true), document.createTextNode("Choose a different episode"));
  focusTop.append(eyebrow, action); focusLink.append(focusTop, $("episodeTitle")); focus.append(focusLink);
  oldBack.remove(); $("ui").querySelector(".episodeHeader h1").after(focus);
  $("nowSummary").textContent = `${displayName(participants[0].name)} · ${participants.slice(1).map(item => displayName(item.name, true)).join(" or ")}`;
  $("separationTitle").textContent = "COSMOS 2612 and ICEYE-X36 relative motion";
  $("thresholdRangeNote").textContent = "Nearest dated TLEs are propagated throughout each chapter for illustration.";
  $("dwellMetric").hidden = false;
  $("dataStatusSection").hidden = true;
  $("rangeNote").textContent = "Space-Track historical elements. The selected TLE and its age are shown under each spacecraft.";
  $("metricArea").closest(".panelSection").classList.add("results-section");
  $("rangeMetric").querySelector(".statLabel").textContent = "Separation distance";
  $("speedMetric").querySelector(".statLabel").textContent = "Relative velocity";
  $("thresholdControls").querySelector("summary>span").textContent = "How close is too close?";
  const thresholdHint = document.createElement("p"); thresholdHint.className = "threshold-chart-hint";
  thresholdHint.textContent = "Select threshold values by dragging the labels on the charts or typing in the boxes below.";
  $("thresholdControls").querySelector(".thresholdBody").prepend(thresholdHint);
  for (const [id, unit, step, maximum, initial] of [["distanceThresholdSlider", "km", 5, 50000, 200], ["speedThresholdSlider", "m/s", 1, 20000, 10]]) {
    const input = $(id), output = $(id.replace("Slider", "Output"));
    input.type = "number"; input.min = "0"; input.max = String(maximum); input.step = String(step); input.value = String(initial);
    const wrap = document.createElement("span"); wrap.className = "threshold-input-wrap";
    const suffix = document.createElement("span"); suffix.textContent = unit;
    input.replaceWith(wrap); wrap.append(input, suffix); output?.remove();
  }
  const sceneHost = document.createElement("div"); sceneHost.id = "scene"; document.body.prepend(sceneHost);
  const labelHost = document.createElement("div"); labelHost.id = "e059ScreenLabels"; document.body.append(labelHost);
  const status = document.createElement("p"); status.id = "sceneStatus"; document.body.append(status);
  const chapterTransition = document.createElement("div"); chapterTransition.id = "e059ChapterTransition"; chapterTransition.className = "e059-chapter-transition";
  chapterTransition.setAttribute("role", "status"); chapterTransition.setAttribute("aria-live", "polite"); chapterTransition.hidden = true;
  chapterTransition.innerHTML = '<div class="e059-chapter-dots" aria-hidden="true"><i></i><i></i><i></i></div><strong class="e059-chapter-message">Moving forward in time</strong><span class="e059-chapter-dates"><span class="e059-chapter-from"></span><span class="e059-chapter-arrow" aria-hidden="true">→</span><span class="e059-chapter-to"></span></span>';
  document.body.append(chapterTransition);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(miniScene ? 0xfffcf6 : 0xffffff);
  const camera = new THREE.PerspectiveCamera(35, 1, .01, 1000);
  const renderer = panelPreview
    ? { domElement: document.createElement("canvas"), setPixelRatio() {}, setSize() {}, getPixelRatio() { return 1; }, render() {} }
    : new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  sceneHost.append(renderer.domElement);
  const controls = panelPreview ? { target: new THREE.Vector3(), update() {}, addEventListener() {} } : new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.addEventListener("start", () => { autoCamera = false; });
  scene.add(new THREE.HemisphereLight(0xffffff, 0xeeeeee, 2.4));
  const earthSurface = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), new THREE.MeshBasicMaterial({ color: miniScene ? 0xd8cbb9 : 0xf7f7f7 }));
  const earth = new THREE.Group(); earth.add(earthSurface); scene.add(earth);
  fetch("./vendor/countries-50m.json").then(r => r.json()).then(topology => {
    const positions = [];
    for (const country of feature(topology, topology.objects.countries).features) {
      const rings = country.geometry.type === "Polygon" ? country.geometry.coordinates : country.geometry.type === "MultiPolygon" ? country.geometry.coordinates.flat() : [];
      for (const ring of rings) for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i]; if (Math.abs(a[0] - b[0]) > 25 || Math.abs(a[1] - b[1]) > 25) continue;
        for (const [lon, lat] of [a, b]) { const p = THREE.MathUtils.degToRad(lat), q = THREE.MathUtils.degToRad(lon); positions.push(1.003 * Math.cos(p) * Math.cos(q), 1.003 * Math.sin(p), -1.003 * Math.cos(p) * Math.sin(q)); }
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    earth.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: .8, depthWrite: false })));
  }).catch(() => {});
  const markers = {}, trails = {}, cards = {}, labels = {};
  const miniDotSize = () => miniScene ? miniMarkerScale(camera, sceneHost.clientHeight) : DOT_SCREEN_SIZE;
  let miniProjectionScale = 1;
  const miniReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let miniHover = false;
  const referenceOrbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: .68, depthTest: true, depthWrite: false }));
  referenceOrbit.renderOrder = 2; referenceOrbit.frustumCulled = false; scene.add(referenceOrbit);
  for (const item of participants) {
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(item.color), sizeAttenuation: false, transparent: true, depthTest: true, depthWrite: false }));
    marker.material.depthTest = !miniScene; marker.scale.setScalar(miniDotSize()); marker.renderOrder = 10; scene.add(marker); markers[item.slot] = marker;
    const trail = new THREE.Mesh(fadingTrailGeometry([]), fadingTrailMaterial(item.slot === "A" ? "A" : "B"));
    trail.material.depthTest = !miniScene; trail.renderOrder = 9; scene.add(trail); trails[item.slot] = trail;
    const screenLabel = document.createElement("span"); screenLabel.className = `e059-screen-label slot${item.slot}`;
    screenLabel.textContent = displayName(item.name, true); labelHost.append(screenLabel); labels[item.slot] = screenLabel;
    const card = document.createElement("details"); card.className = "satCard"; card.dataset.slot = item.slot; card.dataset.norad = item.norad; card.dataset.cospar = item.cospar;
    const summary = document.createElement("summary"); summary.className = "satCardName";
    const dot = document.createElement("span"); dot.className = `sourceDot slot${item.slot}`; dot.style.background = item.color;
    const name = document.createElement("span"); name.className = "satName"; name.textContent = displayName(item.name);
    const age = document.createElement("span"); age.className = "sourceSummary"; age.textContent = "Loading";
    const chevron = document.createElement("span"); chevron.className = "satChevron"; chevron.setAttribute("aria-hidden", "true"); chevron.innerHTML = '<span class="disclosureGlyph">‹</span>';
    summary.append(dot, name, age, chevron);
    const details = document.createElement("div"); details.className = "e059-meta"; card.append(summary, details); $("identity").append(card); cards[item.slot] = { card, age, details };
  }
  // E-059 has one chaser and one target, so each gets its own disclosure card.
  const selector = cards.B.card;
  const chapterNav = document.createElement("div"); chapterNav.className = "e059-chapters";
  for (const item of chapters) { const button = document.createElement("button"); button.type = "button"; button.dataset.chapter = item.id; button.textContent = shortUtc(item.centerMs); button.title = `${utc(item.startMs)} to ${utc(item.endMs)}`; chapterNav.append(button); }
  chapterNav.hidden = chapters.length === 1;
  document.body.classList.toggle("e059-multi-chapter", chapters.length > 1);
  $("playbackDock").prepend(chapterNav);
  let chapter = chapters[0], current = chapter.centerMs, playing = false, transitioning = false, selected = "B", referenceSlot = "B", mode = miniScene ? "eci" : "relative", autoCamera = true, rate = miniScene ? 3600 : 21600, series = [], lastTrailKey = "", lastReferenceOrbitKey = "";
  let miniLoopStart = chapter.centerMs - 2 * HOUR, miniLoopEnd = chapter.centerMs + 2 * HOUR;
  const miniPinnedTles = {};
  const chartScales = new Map(), qualificationCache = new Map();
  let focusedMinimumMs = null;
  let lastChartPaint = 0;
  const sticky = document.createElement("div"); sticky.id = "pairSticky"; sticky.className = "e059-pair-sticky"; sticky.hidden = true;
  const stickyIntro = document.createElement("span"); stickyIntro.className = "e059-pair-intro"; stickyIntro.textContent = "Current Episode:";
  const stickyChaser = document.createElement("span"); stickyChaser.className = "e059-pair-chaser";
  stickyChaser.innerHTML = "<i></i><b></b>"; stickyChaser.querySelector("b").textContent = participants[0].name;
  const stickyTarget = document.createElement("span"); stickyTarget.className = "e059-pair-target";
  stickyTarget.innerHTML = "<i></i><b></b>"; stickyTarget.querySelector("b").textContent = participants[1].name;
  sticky.append(stickyIntro, stickyChaser, document.createTextNode("+"), stickyTarget); $("ui").prepend(sticky);
  function updateSticky() {
    sticky.hidden = selector.getBoundingClientRect().bottom > $("ui").getBoundingClientRect().top + 38;
  }
  $("ui").addEventListener("scroll", updateSticky, { passive: true });
  const referenceButton = document.createElement("button"); referenceButton.id = "referenceBtn"; referenceButton.type = "button"; referenceButton.className = "cameraBtn referenceBtn";
  referenceButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="reference-target-dot" cx="6" cy="12" r="3"/><circle class="reference-chaser-dot" cx="18" cy="12" r="3"/><path d="M9.5 6.5h7l-2-2M14.5 17.5h-7l2 2"/></svg>';
  $("cameraControls").append(referenceButton);
  function syncReferenceButton() {
    const centered = referenceSlot === selected;
    referenceButton.hidden = mode !== "relative";
    referenceButton.classList.toggle("is-chaser", centered);
    referenceButton.setAttribute("aria-pressed", String(centered));
    referenceButton.title = `Reference: ${displayName(participants.find(item => item.slot === referenceSlot).name)}. Switch reference`;
    referenceButton.setAttribute("aria-label", referenceButton.title);
  }

  function nearestIndex(slot, ms) {
    const tles = libraries[slot]; let lo = 0, hi = tles.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tles[mid].ms < ms) lo = mid + 1; else hi = mid; }
    if (!lo) return 0;
    if (lo === tles.length) return tles.length - 1;
    return ms - tles[lo - 1].ms <= tles[lo].ms - ms ? lo - 1 : lo;
  }
  function nearest(slot, ms) {
    const index = miniScene && Number.isInteger(miniPinnedTles[slot]) ? miniPinnedTles[slot] : nearestIndex(slot, ms);
    const tles = libraries[slot];
    return { tle: tles[index], index };
  }
  function pinMiniTles(ms) { if (miniScene) for (const item of participants) miniPinnedTles[item.slot] = nearestIndex(item.slot, ms); }
  function propagate(tle, ms) {
    if (!tle.satrec) tle.satrec = window.satellite.twoline2satrec(tle.line1, tle.line2);
    const result = window.satellite.propagate(tle.satrec, new Date(ms));
    return result.position && result.velocity ? { p: toScene(result.position), v: toScene(result.velocity) } : null;
  }
  function statesAt(ms) {
    return Object.fromEntries(participants.map(item => { const chosen = nearest(item.slot, ms); return [item.slot, { ...chosen, state: ms < item.launchMs ? null : propagate(chosen.tle, ms), ageHours: Math.abs(ms - chosen.tle.ms) / HOUR }]; }));
  }
  function pairAt(slot, ms) {
    const states = statesAt(ms), a = states.A, b = states[slot];
    if (!a.state || !b.state) return null;
    return { distanceKm: a.state.p.distanceTo(b.state.p) * EARTH_KM, speedMs: a.state.v.distanceTo(b.state.v) * EARTH_KM * 1000, indices: `${a.index}:${b.index}`, ageHours: Math.max(a.ageHours, b.ageHours) };
  }
  function frameAt(ref) {
    const radial = ref.p.clone().normalize(), normal = ref.p.clone().cross(ref.v).normalize(), along = normal.clone().cross(radial).normalize();
    return { radial, normal, along, origin: ref.p };
  }
  function local(p, frame) { const d = p.clone().sub(frame.origin); return new THREE.Vector3(d.dot(frame.along), d.dot(frame.normal), d.dot(frame.radial)); }
  function trailPoints(slot, ms, chosen, reference) {
    const points = [], span = mode === "eci" ? Math.min(12 * HOUR, Math.max(0, ms - chapter.startMs)) : (miniScene ? 7 * 24 : 72) * HOUR;
    if (mode === "eci" && span <= 0) return points;
    const count = mode === "eci" ? Math.max(2, Math.ceil(span / (2.5 * 60000))) : 288;
    let lastScreen = null, screenLength = 0;
    camera.updateMatrixWorld();
    for (let i = 0; i <= count; i++) {
      const t = ms - i / count * span;
      if (mode === "eci" && t < chapter.startMs) break;
      if (t < participants.find(item => item.slot === slot).launchMs || t < participants[0].launchMs) continue;
      const craft = propagate(chosen.tle, t), ref = propagate(reference.tle, t);
      if (!craft || !ref) continue;
      const point = mode === "eci" ? craft.p : local(craft.p, frameAt(ref));
      const projected = point.clone().project(camera);
      const screen = new THREE.Vector2(projected.x * sceneHost.clientWidth / 2, projected.y * sceneHost.clientHeight / 2);
      if (lastScreen && Number.isFinite(screen.x) && Number.isFinite(screen.y)) screenLength += screen.distanceTo(lastScreen);
      lastScreen = screen;
      points.push(point);
      if (screenLength >= 260) break;
    }
    return points.reverse();
  }
  function updateReferenceOrbit(states) {
    const chosen = states[referenceSlot], key = `${mode}:${referenceSlot}:${chosen.index}:${Math.floor(current / HOUR)}`;
    referenceOrbit.visible = !!chosen.state;
    if (!referenceOrbit.visible) return;
    if (key === lastReferenceOrbitKey || !chosen.state) return;
    lastReferenceOrbitKey = key;
    const mu = 398600.4418 / EARTH_KM ** 3, r = chosen.state.p.length(), v = chosen.state.v.length();
    const a = 1 / (2 / r - v * v / mu), omega = Math.sqrt(mu / (a ** 3));
    if (!Number.isFinite(a) || a <= 1 || !Number.isFinite(omega)) { referenceOrbit.visible = false; return; }
    const basis = frameAt(chosen.state), period = 2 * Math.PI / omega * 1000, points = [];
    for (let index = 0; index <= 240; index++) {
      const delta = (index / 240 - .5) * period;
      const future = propagate(chosen.tle, current + delta);
      if (!future) continue;
      points.push(mode === "eci" ? future.p : local(future.p, basis));
    }
    if (points.length > 1) points.push(points[0].clone());
    referenceOrbit.geometry.dispose(); referenceOrbit.geometry = new THREE.BufferGeometry().setFromPoints(points);
  }
  function buildSeries() {
    series = [];
    const step = Math.max(60000, Math.ceil((chapter.endMs - chapter.startMs) / 3200 / 60000) * 60000);
    const sampleAt = ms => {
      const rawB = pairAt("B", ms);
      return { ms, B: rawB };
    };
    for (let ms = chapter.startMs; ms <= chapter.endMs; ms += step) series.push(sampleAt(ms));
    if (series.at(-1)?.ms !== chapter.endMs) series.push(sampleAt(chapter.endMs));
    $("rangeNote").textContent = "Space-Track historical elements. Nearest TLEs are propagated throughout this illustrative chapter.";
    qualificationCache.clear();
    updateMinima(); drawCharts();
  }
  function updateMinima() {
    for (const [nodeId, key, unit] of [["distanceMinimum", "distanceKm", "km"], ["speedMinimum", "speedMs", "m/s"]]) {
      const entries = series.filter(row => row[selected]?.[key] != null);
      const min = entries.reduce((best, row) => !best || row[selected][key] < best[selected][key] ? row : best, null);
      const target = $(nodeId); target.replaceChildren();
      if (!min) { target.textContent = "Minimum this episode: unavailable"; continue; }
      const strong = document.createElement("strong");
      const value = min[selected][key];
      strong.textContent = unit === "km"
        ? value < 1 ? `${Math.round(value * 1000).toLocaleString()} m` : `${value < 10 ? value.toFixed(2) : Math.round(value / 5) * 5} km`
        : `${value < 10 ? value.toFixed(2) : Math.round(value).toLocaleString()} m/s`;
      const link = document.createElement("a"); link.href = "#playbackDock"; link.textContent = shortUtc(min.ms);
      link.title = `Jump playback to ${new Date(min.ms).toISOString()}`;
      link.setAttribute("aria-label", link.title);
      link.addEventListener("click", event => { event.preventDefault(); focusedMinimumMs = min.ms; setTime(min.ms, true); });
      target.append("Minimum this episode: ", strong, " on ", link);
    }
  }
  function drawCharts(force = true) {
    const now = performance.now();
    if (!force && now - lastChartPaint < 100) return;
    lastChartPaint = now;
    drawPanelCharts();
  }
  function panelSamples() {
    return series.map(row => ({ ms: row.ms, distanceKm: row[selected]?.distanceKm ?? null,
      speedMs: row[selected]?.speedMs ?? null, speedMps: row[selected]?.speedMs ?? null,
      tleA: row[selected]?.indices?.split(":")[0], tleB: row[selected]?.indices?.split(":")[1] }));
  }
  function panelQualifications(samples, distance, speed) {
    const key = `${chapter.id}:${selected}:${distance}:${speed}`;
    if (qualificationCache.has(key)) return qualificationCache.get(key);
    const step = series.length > 1 ? series[1].ms - series[0].ms : 60000;
    const both = analyzeEpisode(samples, distance, speed, step);
    const distanceOnly = analyzeEpisode(samples, distance, Infinity, step).intervals;
    const speedOnly = analyzeEpisode(samples, Infinity, speed, step).intervals;
    const single = exclusiveQualificationIntervals(distanceOnly, speedOnly).single;
    const result = { both, single }; qualificationCache.set(key, result); return result;
  }
  function drawPanelCharts() {
    const distance = Math.max(0, Number($("distanceThresholdSlider").value) || 0);
    const speed = Math.max(0, Number($("speedThresholdSlider").value) || 0);
    const samples = panelSamples(), qualifications = panelQualifications(samples, distance, speed);
    const currentPair = pairAt(selected, current);
    const currentSample = { ms: current, distanceKm: currentPair?.distanceKm ?? null, speedMs: currentPair?.speedMs ?? null,
      speedMps: currentPair?.speedMs ?? null, tleA: currentPair?.indices?.split(":")[0], tleB: currentPair?.indices?.split(":")[1] };
    const drawnSamples = samples.some(row => row.ms === current) ? samples : [...samples, currentSample].sort((a, b) => a.ms - b.ms);
    const window = { id: chapter.id, start: new Date(chapter.startMs).toISOString(), end: new Date(chapter.endMs).toISOString() };
    const distanceMin = samples.reduce((best, row) => Number.isFinite(row.distanceKm) && (!best || row.distanceKm < best.distanceKm) ? row : best, null);
    const speedMin = samples.reduce((best, row) => Number.isFinite(row.speedMs) && (!best || row.speedMs < best.speedMs) ? row : best, null);
    const minimumTickHours = Math.ceil((chapter.endMs - chapter.startMs) / HOUR / 2);
    const maxConnectionGapMs = (series[1]?.ms - series[0]?.ms || 60000) * 1.01;
    const visibleSpeedMax = drawnSamples.reduce((max, sample) => sample.ms <= current && sample.ms >= current - (chapter.endMs - chapter.startMs) && Number.isFinite(sample.speedMs) ? Math.max(max, sample.speedMs) : max, 0);
    const speedUnit = Math.max(speed, visibleSpeedMax) < 1000 ? "m/s" : "km/s";
    chartScales.set("distanceChartGroup", drawOrbitalChart($("separationChart"), drawnSamples, "distanceKm", { window, currentMs: current, threshold: distance, title: "Separation distance (km)", maximum: Number($("distanceThresholdSlider").max) || 50000, qualifications, markedMs: focusedMinimumMs === distanceMin?.ms ? focusedMinimumMs : null, minimumTickHours, connectSwitches: true, maxConnectionGapMs }));
    chartScales.set("speedChartGroup", drawOrbitalChart($("speedChart"), drawnSamples, "speedMs", { window, currentMs: current, threshold: speed, title: `Relative velocity (${speedUnit})`, maximum: Number($("speedThresholdSlider").max) || 20000, qualifications, markedMs: focusedMinimumMs === speedMin?.ms ? focusedMinimumMs : null, minimumTickHours, connectSwitches: true, maxConnectionGapMs, speedUnit }));
    $("thresholdSummary").textContent = `${distance.toLocaleString()} km · ${speed.toLocaleString()} m/s`;
    $("dwellStat").textContent = qualifications.both.validSamples ? formatDwellDuration(qualifications.both.totalMs) : "—";
    $("dwellUnit").textContent = "";
    $("dwellLabel").textContent = "Dwell time";
    const dwellKey = $("dwellMetric").querySelector(".dwellKey"), dwellStamp = `${selected}:${distance}:${speed}`;
    if (dwellKey.dataset.stamp !== dwellStamp) {
      dwellKey.dataset.stamp = dwellStamp;
      const italic = value => { const node = document.createElement("i"); node.textContent = value; return node; };
      const bold = (value, className = "") => { const node = document.createElement("strong"); node.textContent = value; node.className = className; return node; };
      dwellKey.replaceChildren("Cumulative time in this chapter when ", italic(displayName(participants[0].name).toUpperCase()), " and ",
        italic(displayName(participants.find(item => item.slot === selected).name, true).toUpperCase()),
        " are within ", bold(`${distance.toLocaleString()} km`), " and at or below ", bold(`${speed.toLocaleString()} m/s`),
        ". ", bold("Gray", "e059-gray-word"), " marks one threshold; ", bold("gold", "e059-gold-word"), " marks both.");
    }
    const bands = $("dwellSegments"); bands.replaceChildren();
    const span = chapter.endMs - chapter.startMs;
    for (const [kind, intervals] of [["single", qualifications.single], ["both", qualifications.both.intervals]]) {
      for (const interval of intervals) {
        const mark = document.createElement("span"); mark.className = kind;
        mark.style.left = `${Math.max(0, (interval.start - chapter.startMs) / span * 100)}%`;
        mark.style.width = `${Math.max(0, (interval.end - interval.start) / span * 100)}%`;
        bands.append(mark);
      }
    }
  }
  function syncMetadata(container, incoming) {
    const sections = [...(incoming instanceof Element ? incoming.children : incoming)];
    const existing = [...container.children];
    const sameShape = sections.length === existing.length && sections.every((section, index) => {
      const rows = [...section.querySelectorAll("dl>div")], oldRows = [...existing[index].querySelectorAll("dl>div")];
      return rows.length === oldRows.length && rows.every((row, rowIndex) => row.querySelector("dt")?.textContent === oldRows[rowIndex].querySelector("dt")?.textContent);
    });
    if (!sameShape) { container.replaceChildren(...sections.map(section => section.cloneNode(true))); return; }
    sections.forEach((section, index) => {
      const rows = [...section.querySelectorAll("dl>div")], oldRows = [...existing[index].querySelectorAll("dl>div")];
      rows.forEach((row, rowIndex) => {
        const fresh = row.querySelector("dd"), old = oldRows[rowIndex].querySelector("dd");
        const freshLink = fresh.querySelector("a"), oldLink = old.querySelector("a");
        if (freshLink && oldLink) {
          if (oldLink.href !== freshLink.href) oldLink.href = freshLink.href;
          if (oldLink.textContent !== freshLink.textContent) oldLink.firstChild.textContent = freshLink.firstChild.textContent;
        } else if (fresh.textContent !== old.textContent || Boolean(freshLink) !== Boolean(oldLink)) {
          if (freshLink) old.replaceChildren(freshLink.cloneNode(true));
          else old.textContent = fresh.textContent;
        }
      });
    });
  }
  function updateCards(states) {
    for (const item of participants) {
      const { tle, ageHours } = states[item.slot], entry = cards[item.slot], signed = Math.floor(Math.abs(current - tle.ms) / HOUR), sign = current < tle.ms ? "−" : "+";
      entry.age.textContent = "Space-Track";
      if (entry.card.dataset.epoch !== tle.epoch) {
        entry.card.dataset.epoch = tle.epoch; entry.card.dataset.sourceData = "Space-Track"; entry.card.dataset.sourceQueryHref = spaceTrackHistoryUrl(item.norad, tle.epoch);
        entry.card.dataset.tleAge = current < item.launchMs ? "Not yet launched" : `${sign}${signed} ${signed === 1 ? "hour" : "hours"}`; entry.card.dataset.tleLine2 = tle.line2;
        const record = catalog.records[item.cospar];
        const makeSection = title => { const section = document.createElement("section"), h = document.createElement("h4"), dl = document.createElement("dl"); section.className = "e059-metadata-section"; h.textContent = title; section.append(h, dl); return { section, dl }; };
        const addRow = (dl, label, value, href) => { if (value == null || value === "") return; const row = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; if (href) { const link = document.createElement("a"); link.className = "espl-news-external"; link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = value; link.insertAdjacentHTML("beforeend", svgLink); dd.append(link); } else dd.textContent = value; if (label === "TLE age") dd.className = "tleAgeValue"; row.append(dt, dd); dl.append(row); };
        const identity = makeSection("Satellite Details");
        const flags = { AFETR: " 🇺🇸", FRGUI: " 🇫🇷", JSC: " 🇨🇳", WSC: " 🇨🇳", TYMSC: " 🇰🇿 🇷🇺", TTMTR: " 🇰🇿 🇷🇺", XICLF: " 🇨🇳" };
        const country = { PRC: "China (PRC) 🇨🇳", US: "United States 🇺🇸", CIS: "Russia 🇷🇺", ITSO: "International operator 🌐" }[record.COUNTRY] || record.COUNTRY;
        addRow(identity.dl, "COSPAR ID", item.cospar); addRow(identity.dl, "NORAD ID", item.norad);
        addRow(identity.dl, "Country / org.", country); addRow(identity.dl, "Object type", record.OBJECT_TYPE === "PAYLOAD" ? "Payload" : record.OBJECT_TYPE);
        addRow(identity.dl, "Launch date", shortUtc(item.launchMs)); addRow(identity.dl, "Launch site", `${catalog.launchSiteNames?.[record.SITE] || record.SITE || "Unknown"}${flags[record.SITE] || ""}`);
        addRow(identity.dl, "Data source", "Space-Track", `https://www.space-track.org/basicspacedata/query/class/satcat/NORAD_CAT_ID/${encodeURIComponent(item.norad)}/format/json`);
        const orbital = makeSection("Orbital Details");
        addRow(orbital.dl, "Selected TLE epoch", utc(tle.ms)); addRow(orbital.dl, "TLE age", entry.card.dataset.tleAge);
        const line = tle.line2 || "", inclination = Number(line.slice(8, 16)), eccentricity = Number(`0.${line.slice(26, 33).trim()}`), meanMotion = Number(line.slice(52, 63));
        if (Number.isFinite(inclination)) addRow(orbital.dl, "Inclination", `${inclination.toFixed(4)}°`);
        if (Number.isFinite(eccentricity)) addRow(orbital.dl, "Eccentricity", eccentricity.toFixed(7));
        if (Number.isFinite(meanMotion)) addRow(orbital.dl, "Mean motion", `${meanMotion.toFixed(5)} rev/day`);
        addRow(orbital.dl, "Data source", "Space-Track", spaceTrackHistoryUrl(item.norad, tle.epoch));
        syncMetadata(entry.details, [identity.section, orbital.section]);
        entry.card.dispatchEvent(new Event("tlechange", { bubbles: true }));
      } else {
        entry.card.dataset.tleAge = current < item.launchMs ? "Not yet launched" : `${sign}${signed} ${signed === 1 ? "hour" : "hours"}`;
        const age = entry.details.querySelector(".tleAgeValue"); if (age) age.textContent = entry.card.dataset.tleAge;
      }
      entry.card.classList.toggle("e059-inactive", item.slot !== "A" && item.slot !== selected);
    }
  }
  function updateScreenLabels() {
    placeEpisodeScreenLabels({ camera, sceneHost, participants, markers, labels, earth, selected });
  }
  function render() {
    document.body.classList.toggle("e059-eci", mode === "eci");
    const states = statesAt(current); if (!states.A.state) return;
    const reference = states[referenceSlot].state;
    if (!reference) return;
    const frame = frameAt(reference);
    earth.position.copy(mode === "eci" ? new THREE.Vector3() : local(new THREE.Vector3(), frame));
    earth.rotation.y = window.satellite.gstime(new Date(current));
    updateReferenceOrbit(states);
    for (const item of participants) {
      const state = states[item.slot].state, marker = markers[item.slot]; marker.userData.available = !!state;
      trails[item.slot].visible = !!state && (mode !== "relative" || item.slot !== referenceSlot) && !(miniScene && item.slot === "C");
      if (!state) continue;
      marker.position.copy(mode === "eci" ? state.p : local(state.p, frame));
      marker.material.opacity = item.slot === "A" || item.slot === selected ? 1 : .28;
      marker.renderOrder = miniScene && item.slot === "A" ? 13 : item.slot === selected ? 12 : item.slot === "A" ? 11 : 10;
      trails[item.slot].material.uniforms.uOpacity.value = mode === "eci" ? item.slot === "A" ? 1 : item.slot === selected ? .85 : .4 : item.slot === "A" || item.slot === selected ? .85 : .23;
    }
    if (autoCamera) {
      if (mode === "eci") { const normal = states.A.state.p.clone().cross(states.A.state.v).normalize(); camera.position.copy(normal.multiplyScalar(miniScene ? 4.7 : 5.8)); camera.up.copy(states.A.state.p.clone().normalize()); controls.target.set(0, 0, 0); }
      else {
        const learned = learnedCameraAt(chapter.id, current, selected, referenceSlot)
          || learnedCameraAt(chapter.id, current, selected, "B");
        if (learned) {
          camera.position.copy(learned.position); controls.target.copy(learned.target); camera.up.copy(learned.up);
          camera.zoom = learned.zoom; camera.fov = learned.fov; camera.updateProjectionMatrix();
        } else {
          const selectedPoint = markers[selected].position, targetPoint = markers.A.position, target = markers[referenceSlot].position.clone();
          const distance = Math.max(.1, Math.min(9, selectedPoint.distanceTo(targetPoint) * 10));
          camera.position.copy(target).add(new THREE.Vector3(0, distance * .35, distance)); camera.up.set(0, 1, 0); controls.target.copy(target);
        }
      }
      camera.lookAt(controls.target);
    }
    const trailKey = `${mode}:${referenceSlot}:${states.A.index}:${states.B.index}:${Math.floor(current / (5 * 60000))}:${camera.position.toArray().map(value => value.toFixed(2))}:${camera.zoom.toFixed(2)}`;
    if (trailKey !== lastTrailKey) {
      lastTrailKey = trailKey;
      for (const item of participants) { trails[item.slot].geometry.dispose(); trails[item.slot].geometry = fadingTrailGeometry(trails[item.slot].visible ? trailPoints(item.slot, current, states[item.slot], states[referenceSlot]) : []); }
    }
    controls.update(); updateScreenLabels();
    renderer.render(scene, camera);
    const pair = pairAt(selected, current), age = Math.max(states.A.ageHours, states[selected].ageHours);
    $("rangeStat").textContent = pair ? `${Math.round(pair.distanceKm).toLocaleString()} km` : "—";
    $("speedStat").textContent = pair ? pair.speedMs < 1000 ? `${Math.round(pair.speedMs)} m/s` : `${(pair.speedMs / 1000).toFixed(2)} km/s` : "—";
    status.textContent = current < participants.find(item => item.slot === selected).launchMs ? `${displayName(participants.find(item => item.slot === selected).name)} had not launched at this playback time.` : "";
    if ($("timelineSlider").value !== String(current)) $("timelineSlider").value = String(current);
    $("sliderNow").textContent = utc(current);
    $("sliderNow").title = utc(current);
    updateCards(states); drawCharts(!playing); syncReferenceButton();
  }
  function setTime(ms, preserveMinimum = false) { if (transitioning) return; if (!preserveMinimum) focusedMinimumMs = null; current = Math.max(chapter.startMs, Math.min(chapter.endMs, ms)); playing = false; updatePlay(); render(); }
  function updatePlay() { $("playBtn").innerHTML = playing ? '<span class="pauseIcon"></span>' : '<span class="playIcon"></span>'; $("playBtn").setAttribute("aria-label", playing ? "Pause" : "Play"); }
  function chooseChapter(id, startAtBeginning = false) {
    chapter = chapters.find(item => item.id === id) || chapters[0]; current = startAtBeginning ? chapter.startMs : chapter.centerMs;
    playing = false; focusedMinimumMs = null; lastTrailKey = ""; lastReferenceOrbitKey = "";
    chapterNav.querySelectorAll("button").forEach(button => { const active = button.dataset.chapter === chapter.id; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    $("timelineSlider").min = String(chapter.startMs); $("timelineSlider").max = String(chapter.endMs);
    buildSeries(); updatePlay(); render();
  }
  async function switchChapter(id, autoplay = false) {
    if (transitioning) return;
    const next = chapters.find(item => item.id === id);
    if (!next) return;
    if (next === chapter) { chooseChapter(id); return; }
    transitioning = true; playing = false; updatePlay();
    chapterTransition.querySelector(".e059-chapter-message").textContent = next.startMs > chapter.startMs ? "Moving forward in time" : "Moving back in time";
    chapterTransition.querySelector(".e059-chapter-from").textContent = shortUtc(chapter.centerMs);
    chapterTransition.querySelector(".e059-chapter-to").textContent = shortUtc(next.centerMs);
    chapterTransition.classList.remove("show-dates", "is-visible"); chapterTransition.hidden = false;
    document.body.classList.add("e059-chapter-switching"); sceneHost.setAttribute("aria-busy", "true");
    const pause = ms => new Promise(resolve => setTimeout(resolve, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms));
    await pause(20); chapterTransition.classList.add("is-visible");
    await pause(500); chapterTransition.classList.add("show-dates");
    await pause(1100); chooseChapter(id, true);
    await pause(900); chapterTransition.hidden = true; chapterTransition.classList.remove("show-dates", "is-visible");
    document.body.classList.remove("e059-chapter-switching"); sceneHost.removeAttribute("aria-busy"); transitioning = false;
    if (autoplay) { playing = true; updatePlay(); }
  }
  function chooseChaser(slot) {
    selected = slot;
    selector.querySelectorAll("button[data-slot]").forEach(button => button.classList.toggle("active", button.dataset.slot === slot));
    for (const chaser of ["B"]) {
      const color = "#a9a9a9";
      markers[chaser].material.map = dotTexture(color); markers[chaser].material.needsUpdate = true;
      trails[chaser].material.uniforms.uColor.value.set(color);
      cards[chaser].card.querySelector(".sourceDot").style.background = color;
    }
    if (referenceSlot !== "A") referenceSlot = slot; autoCamera = true; lastTrailKey = ""; lastReferenceOrbitKey = ""; updateMinima(); updateSticky(); render();
  }
  function resize() { const width = Math.max(1, sceneHost.clientWidth), height = Math.max(1, sceneHost.clientHeight); camera.aspect = width / height; const nextScale = miniScene ? (Number(window.frameElement?.dataset.miniBaseHeight) || height) / height : 1; camera.zoom *= nextScale / miniProjectionScale; miniProjectionScale = nextScale; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); renderer.domElement.style.width = `${width}px`; renderer.domElement.style.height = `${height}px`; for (const trail of Object.values(trails)) trail.material.uniforms.uResolution.value.set(width, height); drawCharts(); }
  new ResizeObserver(resize).observe(sceneHost); new ResizeObserver(drawCharts).observe($("distanceChartGroup"));
  chapterNav.addEventListener("click", event => { const button = event.target.closest("button[data-chapter]"); if (button) void switchChapter(button.dataset.chapter); });
  // A drag fires several input events per frame, so repaint once per frame from the
  // latest value instead of doing the whole scene and chart redraw per event.
  let sliderFrame = null, sliderTarget = null;
  $("timelineSlider").addEventListener("input", event => {
    sliderTarget = Number(event.target.value);
    if (sliderFrame !== null) return;
    sliderFrame = requestAnimationFrame(() => { sliderFrame = null; setTime(sliderTarget); });
  });
  $("playBtn").addEventListener("click", () => {
    if (transitioning) return;
    if (!playing && current >= chapter.endMs) {
      const next = chapters[chapters.indexOf(chapter) + 1];
      if (next) { void switchChapter(next.id, true); return; }
      current = chapter.startMs;
    }
    playing = !playing; updatePlay();
  });
  $("modeBtn").addEventListener("click", () => { mode = mode === "eci" ? "relative" : "eci"; autoCamera = true; lastTrailKey = ""; lastReferenceOrbitKey = ""; $("modeBtn").title = mode === "eci" ? "Switch to relative motion" : "Switch to ECI view"; $("modeBtn").setAttribute("aria-label", $("modeBtn").title); render(); });
  $("modeBtn").title = mode === "eci" ? "Switch to relative motion" : "Switch to ECI view"; $("modeBtn").setAttribute("aria-label", $("modeBtn").title);
  referenceButton.addEventListener("click", () => { referenceSlot = referenceSlot === "A" ? selected : "A"; autoCamera = true; lastTrailKey = ""; lastReferenceOrbitKey = ""; render(); });
  $("resetBtn").hidden = true; $("resetBtn").addEventListener("click", () => { autoCamera = true; camera.zoom = 1; camera.updateProjectionMatrix(); render(); });
  $("zoomInBtn").addEventListener("click", () => { camera.zoom = Math.min(5, camera.zoom * 1.15); camera.updateProjectionMatrix(); render(); });
  $("zoomOutBtn").addEventListener("click", () => { camera.zoom = Math.max(.4, camera.zoom / 1.15); camera.updateProjectionMatrix(); render(); });
  const speeds = [3600, 21600, 86400, 259200]; let speedIndex = 1;
  for (const [id, step] of [["speedDownBtn", -1], ["speedUpBtn", 1]]) $(id).addEventListener("click", () => { speedIndex = Math.max(0, Math.min(speeds.length - 1, speedIndex + step)); rate = speeds[speedIndex]; $(id).title = `${rate / 3600} simulated hours per second`; });
  for (const [id, output, unit] of [["distanceThresholdSlider", "distanceThresholdOutput", "km"], ["speedThresholdSlider", "speedThresholdOutput", "m/s"]]) $(id).addEventListener("input", () => { if ($(output)) $(output).textContent = `${$(id).value} ${unit}`; drawCharts(); });
  for (const [id, groupId] of [["separationChart", "distanceChartGroup"], ["speedChart", "speedChartGroup"]]) {
    $(id).addEventListener("click", event => {
      const rect = event.currentTarget.getBoundingClientRect(), scale = chartScales.get(groupId);
      const left = scale?.left ?? 35, right = scale?.right ?? rect.width - 8;
      const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - left) / (right - left)));
      setTime((scale?.viewStart ?? chapter.startMs) + fraction * ((scale?.viewEnd ?? chapter.endMs) - (scale?.viewStart ?? chapter.startMs)));
    });
    {
      const edge = $(groupId).querySelector(".thresholdEdge"), input = $(groupId === "distanceChartGroup" ? "distanceThresholdSlider" : "speedThresholdSlider");
      const change = clientY => {
        const scale = chartScales.get(groupId); if (!scale) return;
        const y = clientY - $(id).getBoundingClientRect().top;
        const chartValue = (scale.bottom - y) / (scale.bottom - scale.top) * scale.max;
        const value = Math.max(0, Math.min(Number(input.max), chartValue * (groupId === "speedChartGroup" && scale.unit === "km/s" ? 1000 : 1)));
        const step = Number(input.step) || 1;
        input.value = String(Math.round(value / step) * step);
        drawCharts();
      };
      edge.addEventListener("pointerdown", event => { edge.setPointerCapture(event.pointerId); change(event.clientY); });
      edge.addEventListener("pointermove", event => { if (edge.hasPointerCapture(event.pointerId)) change(event.clientY); });
      edge.addEventListener("keydown", event => { if (!["ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); input.value = String(Math.max(0, Number(input.value) + (event.key === "ArrowUp" ? 1 : -1) * Number(input.step || 1))); drawCharts(); });
    }
  }
  wireTimelineHover($("timelineSlider"), $("timelineHover"), $("timelineHoverTick"), () => [chapter.startMs, chapter.endMs]);
  pinMiniTles((miniLoopStart + miniLoopEnd) / 2);
  chooseChaser("B"); chooseChapter(chapters[0].id, true); resize(); updateSticky();
  if (miniScene) current = miniLoopStart;
  playing = true; updatePlay(); render();
  if (miniScene) {
    const captureCamera = (name = `${row["Episode ID"]} mini preview`) => ({ name, timestampUtc: new Date(current).toISOString(), frameMode: mode === "eci" ? "inertial" : "relative", referenceSatellite: referenceSlot,
      position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(), fieldOfViewDeg: camera.fov, zoom: camera.zoom / miniProjectionScale });
    const seekMiniTime = ms => setTime(ms);
    window.miniWorkshop = {
      get ready() { return true; },
      get windows() { return chapters.map(item => ({ id: item.id, label: shortUtc(item.centerMs), start: new Date(item.startMs).toISOString(), end: new Date(item.endMs).toISOString() })); },
      get window() { return { id: chapter.id, start: new Date(chapter.startMs).toISOString(), end: new Date(chapter.endMs).toISOString() }; },
      get current() { return current; }, get playing() { return playing; }, get rate() { return rate; },
      get loopStart() { return miniLoopStart; }, get loopEnd() { return miniLoopEnd; },
      get frameMode() { return mode === "eci" ? "inertial" : "relative"; },
      get selected() { return selected; },
      get origins() { return [{ value: "A", label: displayName(participants[0].name) }, { value: selected, label: displayName(participants.find(item => item.slot === selected).name, true) }]; },
      get origin() { return referenceSlot; },
      setRate(value) { rate = Math.max(60, Math.min(14400, Number(value) || 3600)); },
      selectWindow(id) { const next = chapters.find(item => item.id === id) || chapters[0]; pinMiniTles(next.centerMs); chooseChapter(id, true); miniLoopStart = Math.max(chapter.startMs, chapter.centerMs - 2 * HOUR); miniLoopEnd = Math.min(chapter.endMs, chapter.centerMs + 2 * HOUR); current = miniLoopStart; playing = true; updatePlay(); render(); },
      setTime(ms) { seekMiniTime(ms); },
      setLoop(start, end) { if (!Number.isFinite(start) || !Number.isFinite(end) || start < chapter.startMs || end > chapter.endMs || end - start < 60000) throw new Error("Choose a loop inside the chapter."); miniLoopStart = start; miniLoopEnd = end; pinMiniTles((start + end) / 2); current = Math.max(start, Math.min(end, current)); lastTrailKey = ""; lastReferenceOrbitKey = ""; render(); },
      setPlaying(value) { if (value && current >= miniLoopEnd) current = miniLoopStart; playing = !!value; updatePlay(); },
      setEditing(value) { document.documentElement.classList.toggle("mini-editing", !!value); if (value) { autoCamera = false; controls.enablePan = true; } },
      toggleFrame() { mode = mode === "eci" ? "relative" : "eci"; autoCamera = true; lastReferenceOrbitKey = ""; render(); },
      setOrigin(slot) { referenceSlot = slot === "A" ? "A" : selected; autoCamera = true; lastReferenceOrbitKey = ""; render(); },
      zoom(factor) { autoCamera = false; camera.position.sub(controls.target).multiplyScalar(1 / factor).add(controls.target); controls.update(); render(); },
      moveComposition(x, y) { autoCamera = false; camera.updateMatrixWorld(); const step = camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * .16; const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1); const shift = right.multiplyScalar(-x * step).addScaledVector(up, -y * step); camera.position.add(shift); controls.target.add(shift); render(); },
      resetCamera() { autoCamera = true; camera.zoom = miniProjectionScale; camera.updateProjectionMatrix(); render(); },
      setHover(value) { miniHover = !!value; earthSurface.material.color.setHex(miniHover ? 0xcfbea9 : 0xd8cbb9); },
      get tleEpochs() { return Object.fromEntries(participants.map(item => [item.slot, libraries[item.slot][miniPinnedTles[item.slot]]?.epoch || null])); },
      captureCamera,
      applyCamera(saved) { mode = saved.frameMode === "inertial" ? "eci" : "relative"; referenceSlot = saved.referenceSatellite === "A" ? "A" : selected; camera.position.fromArray(saved.position); controls.target.fromArray(saved.target); camera.up.fromArray(saved.up); camera.fov = saved.fieldOfViewDeg || 35; camera.zoom = (saved.zoom || 1) * miniProjectionScale; camera.updateProjectionMatrix(); autoCamera = false; lastReferenceOrbitKey = ""; render(); },
    };
    parent.postMessage({ type: "espl-e059-mini-ready" }, location.origin);
  }
  void installGlossary($("ui")).catch(error => console.warn("E-059 glossary unavailable", error));
  let previous = performance.now(), lastPanelPaint = 0, lastCameraTrailPaint = 0, lastCameraTrailSignature = "";
  function animate(now) {
    requestAnimationFrame(animate);
    if (miniScene) {
      const pulse = miniHover && !miniReducedMotion.matches ? 1 + .32 * (.5 + .5 * Math.sin(now / 180)) : 1;
      for (const marker of Object.values(markers)) marker.scale.setScalar(miniDotSize() * pulse);
    }
    const elapsed = Math.min(.1, (now - previous) / 1000); previous = now;
    if (playing) {
      current += elapsed * rate * 1000;
      if (miniScene && current >= miniLoopEnd) current = miniLoopStart + (current - miniLoopStart) % (miniLoopEnd - miniLoopStart);
      if (current >= chapter.endMs) {
        current = chapter.endMs; playing = false; updatePlay(); render();
        const next = chapters[chapters.indexOf(chapter) + 1];
        if (next) void switchChapter(next.id, true);
      } else if (!panelPreview || now - lastPanelPaint >= 90) { render(); lastPanelPaint = now; }
    } else if (!panelPreview) {
      controls.update();
      const signature = `${camera.position.toArray().map(value => value.toFixed(2))}:${controls.target.toArray().map(value => value.toFixed(2))}:${camera.zoom.toFixed(2)}`;
      if (!autoCamera && signature !== lastCameraTrailSignature && now - lastCameraTrailPaint > 200) {
        lastCameraTrailSignature = signature; lastCameraTrailPaint = now; lastTrailKey = ""; render();
      } else { updateScreenLabels(); renderer.render(scene, camera); }
    }
  }
  requestAnimationFrame(animate);
  requestAnimationFrame(() => document.documentElement.classList.remove("episode-initializing"));
  if (new URLSearchParams(location.search).get("dev") === "1" && ["localhost", "127.0.0.1"].includes(location.hostname) && location.port === "8769") {
    makeReviewBar();
    const captureCamera = () => ({ position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(), zoom: camera.zoom, fov: camera.fov });
    const restoreCamera = snapshot => {
      if (!snapshot) return;
      camera.position.fromArray(snapshot.position); controls.target.fromArray(snapshot.target); camera.up.fromArray(snapshot.up);
      camera.zoom = snapshot.zoom; camera.fov = snapshot.fov; camera.updateProjectionMatrix(); camera.lookAt(controls.target);
      autoCamera = false; lastTrailKey = ""; render();
    };
    const workshopApi = {
      chapters, participants,
      getState: () => ({ chapterId: chapter.id, selected, referenceSlot, current }),
      pause: () => { playing = false; updatePlay(); },
      sceneRect: () => sceneHost.getBoundingClientRect(),
      captureCamera, restoreCamera,
      seek: ms => setTime(ms),
      useLearnedPath: () => { autoCamera = true; lastTrailKey = ""; render(); },
      setSavedCameraViews: views => { setSavedCameraViews(views); if (autoCamera) { lastTrailKey = ""; render(); } },
      setRoute: (route, ms, snapshot) => {
        playing = false;
        if (chapter.id !== route.chapter.id) chooseChapter(route.chapter.id);
        if (selected !== route.selected) chooseChaser(route.selected);
        referenceSlot = route.referenceSlot; mode = "relative"; autoCamera = false;
        lastTrailKey = ""; lastReferenceOrbitKey = "";
        $("modeBtn").title = "Switch to ECI view"; $("modeBtn").setAttribute("aria-label", $("modeBtn").title);
        setTime(ms);
        restoreCamera(snapshot);
      },
      pathGuide: (route, ms, spanMinutes) => {
        camera.updateMatrixWorld();
        const width = sceneHost.clientWidth, height = sceneHost.clientHeight, paths = [];
        const targetSlots = ["A", route.selected];
        for (const slot of targetSlots) {
          const points = [];
          for (let index = 0; index <= 48; index++) {
            const at = ms + (index / 48 - .5) * spanMinutes * 60000;
            const states = statesAt(at);
            if (!states[slot].state || !states[route.referenceSlot].state) continue;
            const point = local(states[slot].state.p, frameAt(states[route.referenceSlot].state)).project(camera);
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
            const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
            points.push({ x, y, inside: point.z < 1 && x >= 0 && x <= width && y >= 0 && y <= height });
          }
          if (points.length > 1) paths.push({ slot, color: slot === "A" ? "#d5a100" : "#888", primary: slot === "A" || slot === route.selected, points });
        }
        return paths;
      },
    };
    import("./e059-camera-workshop.js").then(({ mountE059CameraWorkshop }) => mountE059CameraWorkshop(workshopApi)).catch(error => console.error("E-059 workshop", error));
  }
}

function makeReviewBar() {
  document.body.classList.add("e059-review");
  const bar = document.createElement("header"); bar.className = "e059-review-bar";
  bar.innerHTML = '<nav aria-label="Local design review"><a href="../dev/e001-review/">E-001</a><a href="../dev/e002-control-panel-preview/">E-002</a><a href="compare.html?dev=1&amp;episode=E-003">E-003</a><a href="compare.html?dev=1&amp;episode=E-004">E-004</a><a href="compare.html?dev=1&amp;episode=E-005">E-005</a><a href="compare.html?dev=1&amp;episode=E-006">E-006</a><a href="compare.html?dev=1&amp;episode=E-007">E-007</a><a href="compare.html?dev=1&amp;episode=E-008" aria-current="page">E-008</a><a href="../../dynamic-table/">Dynamic Library</a></nav><nav aria-label="E-008 review tools"><button id="e059CommentMode" type="button">✚ Spot comment</button><button id="e059CommentsToggle" type="button">Comments <span id="e059CommentCount">0</span></button></nav>';
  document.body.append(bar);
  const drawer = document.createElement("aside"); drawer.className = "e059-review-drawer"; drawer.hidden = true;
  drawer.innerHTML = '<strong>E-008 spot comments</strong><form id="e059CommentForm" hidden><p id="e059CommentLocation"></p><textarea id="e059CommentText" required maxlength="4000"></textarea><label><input id="e059AllEpisodes" type="checkbox"> Applies to all full episode views</label><button type="submit">Save comment</button></form><div id="e059CommentList"></div><button id="e059ExportComments" type="button">Export comments JSON</button>';
  document.body.append(drawer);
  const pinLayer = document.createElement("div"); pinLayer.className = "e059-pin-layer"; document.body.append(pinLayer);
  let comments = [], commenting = false, draft = null;
  const placePins = () => { pinLayer.replaceChildren(); comments.forEach((item, index) => { if (item.surface !== "E-059" && !item.appliesToAllEpisodes) return; const anchor = document.getElementById(item.key) || $("scene"), rect = anchor.getBoundingClientRect(); const x = rect.left + rect.width * item.x, y = rect.top + rect.height * item.y; if (x < 0 || x > innerWidth || y < 60 || y > innerHeight) return; const pin = document.createElement("button"); pin.className = "e059-spot-pin"; pin.type = "button"; pin.textContent = String(index + 1); pin.title = `${item.label}: ${item.text}`; pin.style.left = `${x}px`; pin.style.top = `${y}px`; pin.addEventListener("click", () => { drawer.hidden = false; sessionStorage.setItem("espl-e059-comments-open", "1"); }); pinLayer.append(pin); }); };
  const refresh = async () => { const result = await fetch("/api/review-comments").then(r => r.json()); comments = result.comments || []; $("e059CommentCount").textContent = String(comments.length); renderSharedCommentList($("e059CommentList"), comments, "E-059"); placePins(); };
  refresh().catch(console.warn);
  window.addEventListener("resize", placePins);
  $("ui").addEventListener("scroll", placePins, { passive: true });
  if (sessionStorage.getItem("espl-e059-comments-open") === "1") drawer.hidden = false;
  $("e059CommentsToggle").addEventListener("click", () => { drawer.hidden = !drawer.hidden; if (drawer.hidden) sessionStorage.removeItem("espl-e059-comments-open"); else sessionStorage.setItem("espl-e059-comments-open", "1"); });
  $("e059CommentMode").addEventListener("click", () => { commenting = !commenting; $("e059CommentMode").textContent = commenting ? "Cancel spot comment" : "✚ Spot comment"; });
  document.addEventListener("click", event => {
    if (!commenting || event.target.closest(".e059-review-bar,.e059-review-drawer,.e059-workshop")) return;
    event.preventDefault(); event.stopImmediatePropagation(); commenting = false; $("e059CommentMode").textContent = "✚ Spot comment";
    const anchor = event.target.closest("[id]") || $("scene"); const rect = anchor.getBoundingClientRect();
    draft = { surface: "E-059", root: "panel", key: anchor.id || "scene", label: anchor.id === "scene" ? "3D globe" : anchor.id, x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
    $("e059CommentLocation").textContent = draft.label; $("e059CommentText").value = ""; $("e059CommentForm").hidden = false; drawer.hidden = false; $("e059CommentText").focus();
  }, true);
  $("e059CommentForm").addEventListener("submit", async event => { event.preventDefault(); if (!draft) return; const response = await fetch("/api/review-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", ...draft, text: $("e059CommentText").value, appliesToAllEpisodes: $("e059AllEpisodes").checked }) }); if (!response.ok) throw new Error(`Comment save failed: ${response.status}`); draft = null; $("e059CommentForm").hidden = true; await refresh(); });
  $("e059ExportComments").addEventListener("click", () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: "espl-shared-review-v1", comments }, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "review-comments.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
}

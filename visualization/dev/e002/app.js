import * as THREE from "../../Viz/vendor/three/three.module.js";
import { OrbitControls } from "../../Viz/vendor/three/addons/controls/OrbitControls.js";
import { feature } from "../../Viz/vendor/topojson/topojson-client.js";
import { dotTexture, fadingTrailGeometry, fadingTrailMaterial } from "../../Viz/relative-rendering.js?v=5";
import { MARKER } from "../../../shared/marker-spec.js?v=3";

const $ = id => document.getElementById(id);
const EARTH_KM = 6378.137;
const MAX_TLE_AGE_MS = 36 * 3600000;
const MAX_METRIC_AGE_MS = 12 * 3600000;
const spacecraft = [
  { slot: "A", name: "Kosmos 2542", norad: "44797", color: MARKER.A },
  { slot: "B", name: "USA 245", norad: "39232", color: MARKER.B },
  { slot: "C", name: "Kosmos 2543", norad: "44835", color: MARKER.C }
];
const moments = [
  { id: "dec7", label: "December 7 · shortly after separation", utc: "2019-12-07T09:45:00Z", note: "The first local USA 245 observer element after Kosmos 2543's reported December 6 release. Compare the three reconstructed positions; this timestamp is an element epoch, not a documented closest approach.", reference: "B" },
  { id: "dec8", label: "December 8 · second observer element", utc: "2019-12-08T10:05:00Z", note: "A second amateur-derived USA 245 element gives another short three-spacecraft window. It does not establish continuous observation between December 7 and 8.", reference: "B" },
  { id: "dec9", label: "December 9 · exploratory convergence", utc: "2019-12-09T04:25:00Z", note: "A TLE scan suggests closer projected geometry, but the nearest USA 245 element is about 18 hours old. Use this for camera comparison only; a close-approach distance is withheld.", reference: "B" },
  { id: "dec31", label: "December 31 · USA 245 recovered orbit", utc: "2019-12-31T18:00:00Z", note: "An amateur USA 245 element follows a reported December orbit change; the two Russian spacecraft have nearby elements. The timestamp is selected for data coverage, not for minimum distance.", reference: "B" },
  { id: "jan1", label: "January 1 · early-January geometry", utc: "2020-01-01T00:00:00Z", note: "All three TLEs remain within the conservative 36-hour display gate. USA 245 has no next local element until 2021, so later January geometry cannot be reconstructed here.", reference: "B" },
  { id: "jan24", label: "January 24 · 2542 maneuver phase", utc: "2020-01-24T12:00:00Z", note: "Only Kosmos 2542 and 2543 have nearby local TLEs. Observer accounts discuss 2542's January 21–24 maneuvers near USA 245; its January position is deliberately absent here.", reference: "A" }
];
const sgp4 = window.satellite;
if (!sgp4?.twoline2satrec) throw new Error("SGP4 library unavailable");
const toScene = position => new THREE.Vector3(position.x / EARTH_KM, position.z / EARTH_KM, -position.y / EARTH_KM);
const state = { moment: moments[3], reference: "B", pair: "AB", libraries: {}, positions: {}, velocities: {}, availability: {}, trails: [], trailPoints: {}, saved: [], examples: [], cameraTween: null, preferredRussian: "A", poleSign: 1, cameraMode: "auto", motionMode: "inertial", playing: false, currentMs: Date.parse(moments[3].utc), playSelected: null, playPrimary: "A", relativeSeed: null, lastMotionDraw: 0 };
const AUTO_RADIUS = 6.2;
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
const formatUtc = value => new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value)) + " UTC";
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xfaf8f2);
const camera = new THREE.PerspectiveCamera(35, 1, .002, 100);
camera.up.set(0, 1, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
$("scene").append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .08;
controls.enablePan = true; controls.minDistance = .025; controls.maxDistance = 18;
controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
controls.addEventListener("start", () => { state.cameraTween = null; state.cameraMode = "manual"; state.relativeSeed = null; state.motionMode = "inertial"; $("motionMode").value = "inertial"; $("scene").dataset.cameraMode = "manual"; });
renderer.domElement.addEventListener("contextmenu", event => event.preventDefault());
scene.add(new THREE.HemisphereLight(0xffffff, 0xddd9ce, 1.7));
const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 72), new THREE.MeshLambertMaterial({ color: 0xe9e6e0 }));
scene.add(earth);
const borders = new THREE.Group(); earth.add(borders);
const equatorPoints = Array.from({ length: 181 }, (_, index) => {
  const angle = index / 180 * 2 * Math.PI;
  return new THREE.Vector3(Math.cos(angle) * 1.003, 0, Math.sin(angle) * 1.003);
});
earth.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(equatorPoints), new THREE.LineBasicMaterial({ color: 0xb5a77c, transparent: true, opacity: .5 })));
fetch("../../Viz/vendor/countries-110m.json").then(response => response.json()).then(topology => {
  const coords = [], radius = 1.0015;
  for (const country of feature(topology, topology.objects.countries).features) {
    const geometry = country.geometry;
    const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : [];
    for (const ring of rings) for (let index = 1; index < ring.length; index++) {
      const a = ring[index - 1], b = ring[index];
      if (Math.abs(a[0] - b[0]) > 30 || Math.abs(a[1] - b[1]) > 30) continue;
      for (const point of [a, b]) {
        const lat = THREE.MathUtils.degToRad(point[1]), lon = THREE.MathUtils.degToRad(point[0]);
        coords.push(radius * Math.cos(lat) * Math.cos(lon), radius * Math.sin(lat), -radius * Math.cos(lat) * Math.sin(lon));
      }
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
  borders.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xaaa49b, transparent: true, opacity: .6 })));
}).catch(() => {});

const markers = {}, labels = {};
for (const craft of spacecraft) {
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(craft.color), sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false }));
  marker.scale.set(.035, .035, 1); marker.renderOrder = 10; scene.add(marker); markers[craft.slot] = marker;
  const label = document.createElement("div"); label.className = "sat-label"; label.textContent = `${craft.slot} · ${craft.name}`; label.style.borderLeft = `3px solid ${craft.color}`;
  $("labels").append(label); labels[craft.slot] = label;
}
for (const moment of moments) { const option = document.createElement("option"); option.value = moment.id; option.textContent = moment.label; $("moment").append(option); }
$("moment").value = state.moment.id;

function nearestElement(craft, ms) {
  const library = state.libraries[craft.slot];
  let best = null, age = Infinity;
  for (const tle of library.tles) {
    const difference = Math.abs(ms - Date.parse(tle.epoch));
    if (difference < age) { best = tle; age = difference; }
  }
  return best && age <= MAX_TLE_AGE_MS ? { tle: best, age } : { tle: null, age };
}
function propagate(tle, ms) {
  const satrec = tle.satrec ||= sgp4.twoline2satrec(tle.line1, tle.line2);
  const value = sgp4.propagate(satrec, new Date(ms));
  return value.position && value.velocity ? { position: toScene(value.position), velocity: toScene(value.velocity) } : null;
}
function motionFrame() {
  const b = state.positions.B, other = state.positions[state.playPrimary], vb = state.velocities.B, vo = state.velocities[state.playPrimary];
  if (!b || !other || !vb || !vo) return null;
  const origin = b.clone().add(other).multiplyScalar(.5), radial = origin.clone().normalize();
  const normal = origin.clone().cross(vb.clone().add(vo)).normalize();
  return { origin, radial, along: normal.clone().cross(radial).normalize(), normal };
}
function localPoint(point, frame) { const d = point.clone().sub(frame.origin); return new THREE.Vector3(d.dot(frame.radial), d.dot(frame.along), d.dot(frame.normal)); }
function worldPoint(point, frame) { return frame.origin.clone().addScaledVector(frame.radial, point.x).addScaledVector(frame.along, point.y).addScaledVector(frame.normal, point.z); }
function localDirection(point, frame) { return new THREE.Vector3(point.dot(frame.radial), point.dot(frame.along), point.dot(frame.normal)); }
function worldDirection(point, frame) { return frame.radial.clone().multiplyScalar(point.x).addScaledVector(frame.along, point.y).addScaledVector(frame.normal, point.z); }
function seedMotionCamera() {
  const b = state.positions.B, a = state.positions.A, c = state.positions.C;
  state.playPrimary = b && c && (!a || c.distanceTo(b) < a.distanceTo(b)) ? "C" : "A";
  const frame = motionFrame(); if (!frame) return false;
  state.relativeSeed = { eye: localPoint(camera.position, frame), target: localPoint(controls.target, frame), up: localDirection(camera.up, frame) };
  $("scene").dataset.motionReference = `B-${state.playPrimary}`;
  return true;
}
function applyMotionCamera() {
  const frame = motionFrame(), seed = state.relativeSeed;
  if (!frame || !seed) return;
  camera.position.copy(worldPoint(seed.eye, frame)); controls.target.copy(worldPoint(seed.target, frame));
  camera.up.copy(worldDirection(seed.up, frame).normalize()); camera.lookAt(controls.target);
}
function setPlayButton() { $("play").textContent = state.playing ? "Ⅱ Pause" : "▶ Play"; $("play").setAttribute("aria-label", state.playing ? "Pause reconstruction" : "Play reconstruction"); }
function clearTrails() {
  for (const trail of state.trails) { scene.remove(trail); trail.geometry.dispose(); trail.material.dispose(); }
  state.trails = []; state.trailPoints = {};
}
function showMoment(resetCamera = true, ms = Date.parse(state.moment.utc)) {
  clearTrails();
  state.currentMs = ms;
  $("momentNote").textContent = state.moment.note;
  $("momentTime").textContent = new Date(ms).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  $("stageDate").textContent = formatUtc(new Date(ms).toISOString());
  state.positions = {}; state.velocities = {}; state.availability = {};
  const coverage = $("coverage"); coverage.replaceChildren();
  for (const craft of spacecraft) {
    const hasFixed = !!state.playSelected && Object.hasOwn(state.playSelected, craft.slot);
    const fixed = state.playSelected?.[craft.slot];
    const selection = hasFixed ? { tle: fixed, age: fixed ? Math.abs(ms - Date.parse(fixed.epoch)) : Infinity } : nearestElement(craft, ms);
    if (selection.age > MAX_TLE_AGE_MS) selection.tle = null;
    const propagated = selection.tle && propagate(selection.tle, ms);
    const available = !!propagated;
    state.availability[craft.slot] = { ...selection, available };
    markers[craft.slot].visible = available;
    labels[craft.slot].classList.toggle("unavailable", !available);
    if (available) {
      state.positions[craft.slot] = propagated.position;
      state.velocities[craft.slot] = propagated.velocity;
      markers[craft.slot].position.copy(propagated.position);
      const points = [];
      for (let step = 18; step >= 0; step--) {
        const sample = propagate(selection.tle, ms - step * 5 * 60000);
        if (sample) points.push(sample.position);
      }
      state.trailPoints[craft.slot] = points;
      if (points.length > 1) {
        const geometry = fadingTrailGeometry(points), material = fadingTrailMaterial(craft.slot === "C" ? "B" : craft.slot);
        material.uniforms.uColor.value.set(craft.color);
        material.uniforms.uResolution.value.set($("scene").clientWidth, $("scene").clientHeight);
        const trail = new THREE.Mesh(geometry, material);
        trail.renderOrder = 2; scene.add(trail); state.trails.push(trail);
      }
    }
    const row = document.createElement("div"); row.className = `coverage-row${available ? "" : " unavailable"}`;
    const dot = document.createElement("i"); dot.className = `dot ${craft.slot.toLowerCase()}`;
    const text = document.createElement("div"); const title = document.createElement("strong"); title.textContent = `${craft.slot} · ${craft.name} · ${craft.norad}`;
    const detail = document.createElement("small"); detail.textContent = available
      ? `${selection.tle.source === "seesat" ? "SeeSat-L amateur" : "Space-Track subset"} · epoch ${formatUtc(selection.tle.epoch)} · ${Math.round(selection.age / 3600000)} h from view`
      : `No local element within 36 h (nearest ${Math.round(selection.age / 86400000)} days away)`;
    text.append(title, detail); row.append(dot, text); coverage.append(row);
  }
  const unavailable = spacecraft.filter(craft => !state.availability[craft.slot].available).map(craft => craft.name);
  const older = spacecraft.filter(craft => state.availability[craft.slot].available && state.availability[craft.slot].age > MAX_METRIC_AGE_MS).map(craft => craft.name);
  $("stageStatus").textContent = unavailable.length ? `${unavailable.join(" and ")} unavailable at this time. No position or trail is drawn.` :
    older.length ? `${older.join(" and ")} more than 12 h from an element epoch; use this view for geometry only.` :
      "All three positions use nearby dated TLEs; the paths are reconstructed.";
  const referenceOption = [...$("reference").options].find(option => option.value === "B");
  referenceOption.disabled = !state.availability.B.available;
  if (!state.availability[state.reference]?.available) {
    state.reference = "A"; $("reference").value = "A";
  }
  updatePair();
  if (resetCamera) resetView();
}
function updatePair() {
  const [first, second] = state.pair;
  const a = state.positions[first], b = state.positions[second];
  if (!a || !b) { $("pairResult").textContent = "This pair cannot be calculated from nearby local elements at this moment."; return; }
  if (state.pair === "AC" && (state.moment.id === "dec7" || state.moment.id === "dec8")) {
    $("pairResult").textContent = "Separation estimate withheld: TLEs near the deployment cannot resolve a kilometer-scale gap reliably.";
    return;
  }
  if (state.availability[first].age > MAX_METRIC_AGE_MS || state.availability[second].age > MAX_METRIC_AGE_MS) {
    $("pairResult").textContent = "Numeric estimate withheld: at least one element is more than 12 hours from this view.";
    return;
  }
  const distance = a.distanceTo(b) * EARTH_KM;
  const va = state.velocities[first], vb = state.velocities[second];
  const relativeSpeed = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z) * EARTH_KM * 1000;
  const roundDistance = distance >= 1000 ? Math.round(distance / 100) * 100 : Math.round(distance / 10) * 10;
  const roundSpeed = Math.round(relativeSpeed / 100) * 100;
  $("pairResult").innerHTML = `<strong>~${roundDistance.toLocaleString()} km</strong> separation<br><strong>~${roundSpeed.toLocaleString()} m/s</strong> relative speed`;
}
function resetView() {
  const b = state.positions.B, a = state.positions.A, c = state.positions.C;
  let target, chosen = null;
  if (b && (a || c)) {
    if (a && c) {
      const aDistance = a.distanceTo(b), cDistance = c.distanceTo(b);
      const previous = state.preferredRussian;
      chosen = previous === "A" && aDistance <= cDistance * 1.15 ? "A" : previous === "C" && cDistance <= aDistance * 1.15 ? "C" : aDistance <= cDistance ? "A" : "C";
    } else chosen = a ? "A" : "C";
    if (state.reference === "A" && a) chosen = "A";
    if (state.reference === "C" && c) chosen = "C";
    state.preferredRussian = chosen;
    target = b.clone().lerp(state.positions[chosen], .5);
  } else if (a && c) target = a.clone().lerp(c, .5);
  else target = (a || b || c)?.clone();
  if (!target) return;
  // Saved December views favor a north/south approach near the pole. A deadband
  // prevents an abrupt flip when the target crosses the equatorial plane.
  if (target.y > .18) state.poleSign = 1;
  else if (target.y < -.18) state.poleSign = -1;
  const direction = target.clone().normalize().multiplyScalar(.32).add(new THREE.Vector3(0, state.poleSign, 0)).normalize();
  const desiredPosition = direction.multiplyScalar(AUTO_RADIUS);
  const desiredTarget = target;
  const firstFrame = !camera.position.lengthSq();
  const spherical = state.cameraMode === "auto" && Math.abs(camera.position.length() - AUTO_RADIUS) < .02;
  state.cameraMode = "auto";
  $("scene").dataset.cameraMode = "auto";
  $("scene").dataset.nearRussian = chosen || "none";
  $("scene").dataset.autoTarget = desiredTarget.toArray().map(value => value.toFixed(4)).join(",");
  $("scene").dataset.cameraRadius = AUTO_RADIUS.toString();
  camera.fov = 35; camera.updateProjectionMatrix();
  if (firstFrame || REDUCED_MOTION.matches) {
    state.cameraTween = null; camera.position.copy(desiredPosition); controls.target.copy(desiredTarget); camera.zoom = 1; camera.updateProjectionMatrix(); controls.update();
  } else {
    state.cameraTween = { start: performance.now(), duration: 2400, fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), fromZoom: camera.zoom, toPosition: desiredPosition, toTarget: desiredTarget, spherical };
  }
}
function resize() {
  const width = Math.max(1, $("scene").clientWidth), height = Math.max(1, $("scene").clientHeight);
  camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
  for (const trail of state.trails) trail.material.uniforms.uResolution.value.set(width, height);
}
const resizeObserver = new ResizeObserver(resize); resizeObserver.observe($("scene"));
let lastFrameTime = performance.now();
function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const elapsed = Math.min(.1, (now - lastFrameTime) / 1000); lastFrameTime = now;
  if (state.playing) {
    const end = Date.parse(state.moment.utc) + 45 * 60000;
    const next = Math.min(end, state.currentMs + elapsed * 90000);
    if (now - state.lastMotionDraw > 120 || next >= end) {
      showMoment(false, next); state.lastMotionDraw = now;
      if (state.motionMode === "relative") applyMotionCamera();
    } else state.currentMs = next;
    if (next >= end) { state.playing = false; setPlayButton(); }
  }
  if (state.cameraTween) {
    const tween = state.cameraTween;
    const progress = Math.min(1, (performance.now() - tween.start) / tween.duration);
    const eased = progress * progress * (3 - 2 * progress);
    if (tween.spherical) {
      const from = tween.fromPosition.clone().normalize(), to = tween.toPosition.clone().normalize();
      const rotation = new THREE.Quaternion().setFromUnitVectors(from, to);
      const part = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), rotation, eased);
      camera.position.copy(from.applyQuaternion(part).multiplyScalar(AUTO_RADIUS));
    } else camera.position.copy(tween.fromPosition).lerp(tween.toPosition, eased);
    controls.target.copy(tween.fromTarget).lerp(tween.toTarget, eased);
    camera.zoom = THREE.MathUtils.lerp(tween.fromZoom, 1, eased); camera.updateProjectionMatrix();
    if (progress >= 1) state.cameraTween = null;
  }
  controls.update();
  $("scene").dataset.cameraActualRadius = camera.position.length().toFixed(3);
  const rect = $("scene").getBoundingClientRect(), screenPoints = {};
  for (const craft of spacecraft) {
    const position = state.positions[craft.slot]; if (!position) continue;
    const projected = position.clone().project(camera), label = labels[craft.slot];
    const x = (projected.x + 1) * rect.width / 2, y = (1 - projected.y) * rect.height / 2;
    screenPoints[craft.slot] = { x, y };
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
    label.style.visibility = Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 ? "hidden" : "visible";
  }
  const overlap = screenPoints.A && screenPoints.C && Math.hypot(screenPoints.A.x - screenPoints.C.x, screenPoints.A.y - screenPoints.C.y) < 24;
  labels.A.textContent = overlap ? "A + C · projected overlap" : "A · Kosmos 2542";
  labels.A.style.borderRight = overlap ? `3px solid ${MARKER.C}` : "";
  labels.C.style.display = overlap ? "none" : "";
  renderer.render(scene, camera);
}
function displaySavedViews() {
  const host = $("savedViews"); host.replaceChildren();
  for (const [index, view] of state.examples.entries()) {
    const button = document.createElement("button"); button.type = "button"; button.className = "saved-view";
    const title = document.createElement("span"); title.textContent = `Example · ${view.name}`;
    const date = document.createElement("small"); date.textContent = new Date(view.timestamp).toLocaleDateString("en-US", { month: "long", day: "numeric" });
    button.append(title, date); button.addEventListener("click", () => restoreView(index, true)); host.append(button);
  }
  for (const [index, view] of state.saved.entries()) {
    const button = document.createElement("button"); button.type = "button"; button.className = "saved-view";
    const title = document.createElement("span"); title.textContent = view.name;
    const date = document.createElement("small"); date.textContent = new Date(view.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    button.append(title, date); button.addEventListener("click", () => restoreView(index)); host.append(button);
  }
}
function restoreView(index, example = false) {
  const view = (example ? state.examples : state.saved)[index]; if (!view) return;
  state.playing = false; state.playSelected = null; state.motionMode = "inertial"; state.relativeSeed = null; $("motionMode").value = "inertial"; setPlayButton();
  state.moment = moments.find(moment => moment.id === view.momentId) || moments[0];
  state.reference = view.reference; $("moment").value = state.moment.id; $("reference").value = state.reference;
  showMoment(false, Date.parse(view.timestamp)); state.cameraTween = null; state.cameraMode = "manual"; $("scene").dataset.cameraMode = "manual"; camera.position.fromArray(view.position); controls.target.fromArray(view.target);
  camera.fov = view.fieldOfViewDeg || 35; camera.zoom = view.zoom; camera.updateProjectionMatrix(); controls.update();
}
$("moment").addEventListener("change", event => { state.playing = false; state.playSelected = null; state.motionMode = "inertial"; state.relativeSeed = null; $("motionMode").value = "inertial"; setPlayButton(); state.moment = moments.find(moment => moment.id === event.target.value); state.reference = state.moment.reference; $("reference").value = state.reference; showMoment(); });
$("reference").addEventListener("change", event => { state.reference = event.target.value; resetView(); });
$("pair").addEventListener("change", event => { state.pair = event.target.value; updatePair(); });
$("reset").addEventListener("click", () => { state.motionMode = "inertial"; state.relativeSeed = null; $("motionMode").value = "inertial"; resetView(); });
$("motionMode").addEventListener("change", event => {
  state.motionMode = event.target.value;
  if (state.motionMode === "relative" && !seedMotionCamera()) { state.motionMode = "inertial"; event.target.value = "inertial"; }
  if (state.motionMode === "relative") { state.cameraTween = null; state.cameraMode = "auto"; }
  $("scene").dataset.motionMode = state.motionMode;
});
$("play").addEventListener("click", () => {
  if (state.playing) { state.playing = false; setPlayButton(); return; }
  const start = Date.parse(state.moment.utc), end = start + 45 * 60000;
  if (state.currentMs >= end || state.currentMs < start) state.currentMs = start;
  if (!state.playSelected) state.playSelected = Object.fromEntries(spacecraft.map(craft => [craft.slot, nearestElement(craft, start).tle]));
  state.playing = true; setPlayButton();
});
$("capture").addEventListener("click", () => {
  const view = { name: $("viewName").value.trim() || "Untitled view", momentId: state.moment.id, timestamp: new Date(state.currentMs).toISOString(),
    reference: state.reference, position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom,
    fieldOfViewDeg: camera.fov, units: "Earth radii", coordinateFrame: "ECI [x,z,-y]" };
  state.saved.push(view); localStorage.setItem("espl-e002-camera-views-v1", JSON.stringify(state.saved)); displaySavedViews();
});
$("download").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ schema: "espl-e002-camera-views-v1", views: state.saved }, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = "e002-camera-views.json"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
});
try { state.saved = JSON.parse(localStorage.getItem("espl-e002-camera-views-v1") || "[]"); if (!Array.isArray(state.saved)) state.saved = []; } catch { state.saved = []; }
displaySavedViews();
Promise.all([fetch("data/provenance.json").then(response => response.json()), fetch("camera-examples.json").then(response => response.json())]).then(async ([manifest, examples]) => {
  state.examples = examples.views || []; displaySavedViews();
  await Promise.all(spacecraft.map(async craft => {
    const dataset = manifest.datasets.find(item => item.object.norad === craft.norad);
    if (!dataset) throw new Error(`Missing provenance for ${craft.name}`);
    const response = await fetch(dataset.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not retrieve dated elements for ${craft.name}`);
    const bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== dataset.sha256) throw new Error(`Dated elements for ${craft.name} changed; review their provenance before use`);
    state.libraries[craft.slot] = JSON.parse(new TextDecoder().decode(bytes));
  }));
  resize(); showMoment(); animate();
}).catch(error => { $("stageStatus").textContent = error.message; });

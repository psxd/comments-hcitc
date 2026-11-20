import * as THREE from "../../Viz/vendor/three/three.module.js";
import { OrbitControls } from "../../Viz/vendor/three/addons/controls/OrbitControls.js";
import { feature } from "../../Viz/vendor/topojson/topojson-client.js";
import { DOT_SCREEN_SIZE, dotTexture } from "../../Viz/relative-rendering.js?v=5";
import { MARKER } from "../../../shared/marker-spec.js?v=3";
import { spaceTrackHistoryUrl } from "../../../shared/tle-provenance.js?v=2";
import { loadCurrentEpisodes, episodeChapters, plottedObjects } from "../../../shared/episode-feed.js?v=6";

const $ = id => document.getElementById(id);
const mini = document.body.classList.contains("mini");
const workshop = mini && new URLSearchParams(location.search).has("workshop");
const sgp4 = window.satellite;
const episode = await fetch(new URL("episode.json", import.meta.url)).then(response => response.json());
const EARTH_KM = 6378.137, MAX_AGE = (workshop ? 120 : episode.maximumDisplayTleAgeHours) * 3600000, TRAIL_MS = (mini ? 65 : 45) * 60000;
let rate = (mini ? 150 : 90) * 1000; // Simulated milliseconds per wall second.
const RADIUS = 5.55;
const sheet = await loadCurrentEpisodes();
const row = sheet.episodes.find(item => item.ID === episode.episodeId && /^(true|yes|1)$/i.test(item.Frontend || ""));
if (!row) throw new Error("E-002 is absent from the published Episodes sheet");
const selectedObjects = plottedObjects(row);
if (selectedObjects.length < 2) throw new Error("E-002 needs two valid spacecraft identifiers in the published sheet");
const craft = selectedObjects.map(({ slot, cospar }) => {
  const item = episode.participants.find(candidate => candidate.slot === slot && candidate.cospar === cospar);
  if (!item) throw new Error(`No reviewed orbital data match published object ${slot}: ${cospar}`);
  return { ...item, color: MARKER[item.slot] };
});
const defaultWindows = workshop ? [
  { id: "dec9", label: "December 9, 2019", start: "2019-12-08T17:40:00Z", end: "2019-12-10T05:40:00Z", anchor: "2019-12-09T11:40:00Z" },
  { id: "dec30", label: "December 30, 2019", start: "2019-12-29T23:29:00Z", end: "2019-12-31T11:29:00Z", anchor: "2019-12-30T17:29:00Z" },
] : episode.windows.filter(item => item.id !== "jan24");
const sheetChapters = episodeChapters(row);
const windows = sheetChapters.length ? sheetChapters.map((chapter, index) => ({
  id: ["dec9", "dec30"][index] || chapter.id,
  label: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(chapter.centerMs)),
  start: chapter.start, end: chapter.end, anchor: chapter.center,
})) : defaultWindows;
const formatUtc = ms => new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(ms)) + " UTC";
const formatShort = ms => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(ms)) + " UTC";
const toScene = point => new THREE.Vector3(point.x / EARTH_KM, point.z / EARTH_KM, -point.y / EARTH_KM);
const data = { libraries: {}, window: windows[0], selected: {}, available: {}, positions: {}, velocities: {}, traces: [], playing: false, current: Date.parse(windows[0].start), loopStart: Date.parse(windows[0].start), loopEnd: Date.parse(windows[0].end), auto: true, nearer: "A", ready: false, lastCoverageMs: 0, frameMode: mini ? "relative" : "inertial", relativeSeed: null, relativePrimary: "A", preferredView: null, lastTrailWall: 0, markerScale: 0 };

const scene = new THREE.Scene(); scene.background = new THREE.Color(0xfffcf6);
const camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mini ? 1.5 : 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.setAttribute("aria-hidden", "true"); $("scene").append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .08; controls.enablePan = workshop || !mini && new URLSearchParams(location.search).get('dev') === '1'; controls.minDistance = 2; controls.maxDistance = 12;
controls.addEventListener("start", () => { data.auto = false; $("scene").dataset.cameraMode = "manual"; });
controls.addEventListener("end", () => {
  if (workshop && data.frameMode === "relative") {
    seedRelativeCamera(orbitFrameAt(data.current)); data.auto = !!data.relativeSeed;
    $("scene").dataset.cameraMode = data.auto ? "auto" : "manual";
  }
});
scene.add(new THREE.HemisphereLight(0xffffff, 0xdcd8cf, 1.6));
const earth = new THREE.Group(); scene.add(earth);
earth.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 72), new THREE.MeshBasicMaterial({ color: 0xe9e6e0 })));
const borders = new THREE.Group(); earth.add(borders);
fetch(new URL("../../Viz/vendor/countries-110m.json", import.meta.url)).then(response => response.json()).then(topology => {
  const coords = [], radius = 1.0015;
  for (const country of feature(topology, topology.objects.countries).features) {
    const geometry = country.geometry;
    const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : [];
    for (const ring of rings) for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      if (Math.abs(a[0] - b[0]) > 30 || Math.abs(a[1] - b[1]) > 30) continue;
      for (const point of [a, b]) {
        const lat = THREE.MathUtils.degToRad(point[1]), lon = THREE.MathUtils.degToRad(point[0]);
        coords.push(radius * Math.cos(lat) * Math.cos(lon), radius * Math.sin(lat), -radius * Math.cos(lat) * Math.sin(lon));
      }
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
  borders.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xa8a39a, transparent: true, opacity: .55 })));
}).catch(() => {});

const markers = {}, labels = {};
for (const item of craft) {
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(item.color), sizeAttenuation: false, transparent: true, opacity: 1, depthTest: false, depthWrite: false }));
  marker.renderOrder = 10; scene.add(marker); markers[item.slot] = marker;
  if (!mini) {
    const label = document.createElement("span"); label.className = `satelliteScreenLabel slot${item.slot}`; label.textContent = item.name;
    ($("satelliteScreenLabels") || $("labels")).append(label); labels[item.slot] = label;
  }
}

function nearest(library, ms) {
  let result = null, age = Infinity;
  for (const tle of library.tles) {
    const difference = Math.abs(ms - Date.parse(tle.epoch));
    if (difference < age) { result = tle; age = difference; }
  }
  return { tle: age <= MAX_AGE ? result : null, age };
}
function stateAt(tle, ms) {
  if (!tle || Math.abs(ms - Date.parse(tle.epoch)) > MAX_AGE) return null;
  const satrec = tle.satrec ||= sgp4.twoline2satrec(tle.line1, tle.line2);
  const result = sgp4.propagate(satrec, new Date(ms));
  return result.position && result.velocity ? { position: toScene(result.position), velocity: toScene(result.velocity) } : null;
}
// RTN frame around the midpoint of B and the selected Russian spacecraft.
// Its radial/along-track/normal axes follow actual SGP4 positions and velocities.
function orbitFrameAt(ms) {
  const first = stateAt(data.selected.B, ms) || stateAt(data.selected.A, ms);
  const second = stateAt(data.selected[data.relativePrimary], ms);
  if (!first || !second) return null;
  const origin = first.position.clone().add(second.position).multiplyScalar(.5);
  const velocity = first.velocity.clone().add(second.velocity).multiplyScalar(.5);
  const radial = origin.clone().normalize();
  const normal = origin.clone().cross(velocity).normalize();
  if (normal.lengthSq() < .5) return null;
  const along = normal.clone().cross(radial).normalize();
  return { origin, radial, along, normal };
}
function toLocal(point, frame) {
  const offset = point.clone().sub(frame.origin);
  return new THREE.Vector3(offset.dot(frame.radial), offset.dot(frame.along), offset.dot(frame.normal));
}
function fromLocal(point, frame) {
  return frame.origin.clone().addScaledVector(frame.radial, point.x).addScaledVector(frame.along, point.y).addScaledVector(frame.normal, point.z);
}
function directionToLocal(point, frame) {
  return new THREE.Vector3(point.dot(frame.radial), point.dot(frame.along), point.dot(frame.normal));
}
function directionFromLocal(point, frame) {
  return frame.radial.clone().multiplyScalar(point.x).addScaledVector(frame.along, point.y).addScaledVector(frame.normal, point.z);
}
function seedRelativeCamera(frame) {
  if (!frame) return;
  data.relativeSeed = { eye: toLocal(camera.position, frame), target: toLocal(controls.target, frame), up: directionToLocal(camera.up, frame) };
  $("scene").dataset.relativeReference = `${data.selected.B ? "B" : "A"}-${data.relativePrimary}`;
}
function frameRelativeCamera(frame) {
  if (!frame || !data.relativeSeed) return;
  camera.position.copy(fromLocal(data.relativeSeed.eye, frame));
  controls.target.copy(fromLocal(data.relativeSeed.target, frame));
  camera.up.copy(directionFromLocal(data.relativeSeed.up, frame).normalize());
  camera.lookAt(controls.target);
  $("scene").dataset.cameraRadius = camera.position.length().toFixed(3);
}
const relativeTrails = new THREE.Group(); scene.add(relativeTrails);
function placeRelativeTrails(frame) {
  if (!frame) return;
  relativeTrails.position.copy(frame.origin);
  relativeTrails.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(frame.radial, frame.along, frame.normal));
}
function clearTraces() {
  for (const trace of data.traces) { trace.mesh.parent?.remove(trace.mesh); trace.mesh.geometry.dispose(); trace.mesh.material.dispose(); }
  data.traces = [];
}
function buildTraces() {
  clearTraces();
  const firstMs = Date.parse(data.window.start) - TRAIL_MS, lastMs = Date.parse(data.window.end), stepMs = mini ? 30000 : 3 * 60000;
  for (const item of craft) {
    const tle = data.selected[item.slot]; if (!tle) continue;
    if (mini) {
      const times = [], positions = [], colorArray = [];
      for (let ms = firstMs; ms <= lastMs; ms += stepMs) {
        const state = stateAt(tle, ms), frame = orbitFrameAt(ms);
        if (!state || !frame) continue;
        times.push(ms); positions.push(...toLocal(state.position, frame).toArray()); colorArray.push(0, 0, 0);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorArray, 3));
      geometry.setDrawRange(0, 0);
      const mesh = new THREE.Line(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .96, depthTest: false, depthWrite: false }));
      mesh.renderOrder = 2; relativeTrails.add(mesh);
      data.traces.push({ mesh, tle, times, color: new THREE.Color(item.color) });
    } else {
      const mesh = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .8, depthWrite: false }));
      mesh.renderOrder = 2; scene.add(mesh);
      data.traces.push({ mesh, tle, color: new THREE.Color(item.color) });
    }
  }
  $("scene").dataset.trailBuilds = String(Number($("scene").dataset.trailBuilds || 0) + 1);
  $("scene").dataset.trailGeometry = data.traces.map(trace => trace.mesh.geometry.uuid).join(',');
}
function updateTraces(ms) {
  const background = new THREE.Color(0xfffcf6);
  const currentFrame = data.frameMode === "relative" ? orbitFrameAt(ms) : null;
  if (mini && currentFrame) {
    for (const trace of data.traces) {
      const first = trace.times.findIndex(time => time >= ms - TRAIL_MS);
      let last = trace.times.findLastIndex(time => time <= ms);
      if (first < 0 || last < first) { trace.mesh.visible = false; continue; }
      trace.mesh.visible = last > first;
      trace.mesh.geometry.setDrawRange(first, last - first + 1);
      const colors = trace.mesh.geometry.getAttribute('color');
      for (let i = first; i <= last; i++) {
        const age = Math.max(0, Math.min(1, (ms - trace.times[i]) / TRAIL_MS));
        const color = background.clone().lerp(trace.color, .22 + .78 * (1 - age));
        colors.setXYZ(i, color.r, color.g, color.b);
      }
      colors.needsUpdate = true;
    }
    $("scene").dataset.trailFrame = "fixed sampled RTN path";
    return;
  }
  for (const trace of data.traces) {
    const points = [], colors = [];
    for (let sample = 15; sample >= 0; sample--) {
      const sampleMs = ms - sample * TRAIL_MS / 15;
      const state = stateAt(trace.tle, sampleMs);
      if (!state) continue;
      const sampleFrame = currentFrame && orbitFrameAt(sampleMs);
      if (currentFrame && !sampleFrame) continue;
      points.push(sampleFrame ? fromLocal(toLocal(state.position, sampleFrame), currentFrame) : state.position);
      const fade = 1 - sample / 16;
      const color = background.clone().lerp(trace.color, mini ? .18 + .82 * fade : fade * fade);
      colors.push(color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    trace.mesh.geometry.dispose(); trace.mesh.geometry = geometry;
    trace.mesh.visible = points.length > 1;
  }
  $("scene").dataset.trailFrame = currentFrame ? "historical RTN transformed to current RTN" : "inertial";
}
function setPlaybackButton() {
  if (!$('play')) return;
  $('play').innerHTML = data.playing ? 'Ⅱ <span>Pause</span>' : '▶ <span>Play</span>';
  $('play').setAttribute('aria-label', data.playing ? 'Pause animation' : 'Play animation');
}
function selectWindow(windowId, initial = false) {
  const selectedWindow = windows.find(item => item.id === windowId) || windows[0];
  data.window = mini && selectedWindow.id === 'dec8' ? { ...selectedWindow, end: '2019-12-08T10:50:00Z' } : selectedWindow;
  const windowStart = Date.parse(data.window.start), windowEnd = Date.parse(data.window.end);
  data.loopStart = workshop ? Math.max(windowStart, Math.min(windowEnd - 45 * 60000, Date.parse(data.window.anchor) - 15 * 60000)) : windowStart;
  data.loopEnd = workshop ? data.loopStart + 45 * 60000 : windowEnd;
  data.current = data.loopStart; data.playing = true; data.auto = true; data.nearer = "A";
  if (!mini) { data.frameMode = "inertial"; data.relativeSeed = null; updateFrameButton(); }
  const mid = (Date.parse(data.window.start) + Date.parse(data.window.end)) / 2;
  data.selected = {};
  for (const item of craft) {
    const selection = nearest(data.libraries[item.slot], mid);
    // One fixed element per craft for the whole short window: playback cannot
    // jump when a nearest-TLE boundary is crossed.
    data.selected[item.slot] = selection.tle && Math.abs(Date.parse(data.window.start) - Date.parse(selection.tle.epoch)) <= MAX_AGE && Math.abs(Date.parse(data.window.end) - Date.parse(selection.tle.epoch)) <= MAX_AGE ? selection.tle : null;
  }
  const firstB = stateAt(data.selected.B, data.current)?.position;
  const firstA = stateAt(data.selected.A, data.current)?.position;
  const firstC = stateAt(data.selected.C, data.current)?.position;
  data.relativePrimary = !firstB ? "C" : firstC && (!firstA || firstC.distanceTo(firstB) < firstA.distanceTo(firstB)) ? "C" : "A";
  if (mini && data.preferredView && !workshop) {
    camera.position.fromArray(data.preferredView.position);
    controls.target.fromArray(data.preferredView.target);
    // A small orbit around the saved target gives the three fixed-size sprite
    // marks a less compressed projection while retaining the orbital plane.
    const eye = camera.position.clone().sub(controls.target);
    eye.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(8));
    camera.position.copy(controls.target).add(eye);
    camera.up.set(0, 1, 0);
    camera.fov = data.preferredView.fieldOfViewDeg; camera.zoom = data.preferredView.zoom * Math.min(1, Math.max(.38, $("scene").clientWidth / 800)); camera.updateProjectionMatrix();
    seedRelativeCamera(orbitFrameAt(data.current));
    $("scene").dataset.preferredView = data.preferredView.name;
  }
  if (workshop) {
    data.positions = {}; data.velocities = {};
    for (const item of craft) {
      const state = stateAt(data.selected[item.slot], data.current);
      if (state) { data.positions[item.slot] = state.position; data.velocities[item.slot] = state.velocity; }
    }
    camera.fov = 35; camera.zoom = .75; camera.updateProjectionMatrix();
    frameCamera(true);
    seedRelativeCamera(orbitFrameAt(data.current));
  }
  buildTraces(); renderFrame(initial); setPlaybackButton();
  if ($('moment')) { $('moment').value = data.window.id; $('momentNote').textContent = data.window.note; $('startLabel').textContent = formatShort(Date.parse(data.window.start)); $('endLabel').textContent = formatShort(Date.parse(data.window.end)); $('timeline').min = String(Date.parse(data.window.start)); $('timeline').max = String(Date.parse(data.window.end)); }
}
function earthOccludes(point, cameraPosition) {
  const ray = point.clone().sub(cameraPosition);
  const closest = THREE.MathUtils.clamp(-cameraPosition.dot(ray) / ray.lengthSq(), 0, 1);
  return cameraPosition.clone().addScaledVector(ray, closest).lengthSq() < 1.002 * 1.002;
}
function frameCamera(immediate = false, seconds = .016) {
  const b = data.positions.B, a = data.positions.A, c = data.positions.C;
  let target, primary;
  if (b && (a || c)) {
    if (a && c) {
      const da = a.distanceTo(b), dc = c.distanceTo(b), old = data.nearer;
      data.nearer = old === "A" && da <= dc * 1.15 ? "A" : old === "C" && dc <= da * 1.15 ? "C" : da <= dc ? "A" : "C";
    } else data.nearer = a ? "A" : "C";
    primary = data.nearer; target = b.clone().lerp(data.positions[primary], .5);
  } else { primary = "none"; target = a && c ? a.clone().lerp(c, .5) : (a || b || c)?.clone(); }
  if (!target) return;
  const relevant = [b, data.positions[primary]].filter(Boolean);
  const all = Object.values(data.positions);
  const baseDirection = target.clone().normalize();
  let direction = baseDirection;
  // Prefer the actual three-craft geometry when all three can be seen from it.
  const average = all.reduce((sum, point) => sum.add(point.clone().normalize()), new THREE.Vector3()).normalize();
  const candidates = [direction, average, ...relevant.map(point => point.clone().normalize())];
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const eye = candidate.clone().multiplyScalar(RADIUS);
    const visible = relevant.filter(point => !earthOccludes(point, eye)).length;
    const secondaryVisible = all.filter(point => !earthOccludes(point, eye)).length;
    const continuity = camera.position.lengthSq() ? candidate.dot(camera.position.clone().normalize()) : 0;
    const score = visible * 100 + secondaryVisible * 12 + continuity * 4 + candidate.dot(baseDirection) * 3;
    if (score > bestScore) { bestScore = score; direction = candidate; }
  }
  const eye = direction.clone().multiplyScalar(RADIUS);
  const referenceSlot = b ? "B" : a ? "A" : "C";
  let normal = data.positions[referenceSlot].clone().cross(data.velocities[referenceSlot]).normalize();
  if (normal.y < 0) normal.negate();
  if (!immediate && normal.dot(camera.up) < 0) normal.negate();
  if (immediate || !camera.position.lengthSq()) {
    camera.position.copy(eye); controls.target.copy(target); camera.up.copy(normal);
  } else if (data.auto) {
    const alpha = 1 - Math.exp(-seconds / 1.15);
    const from = camera.position.clone().normalize(), to = eye.clone().normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(from, to);
    const part = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), rotation, alpha);
    camera.position.copy(from.applyQuaternion(part).multiplyScalar(RADIUS));
    controls.target.lerp(target, alpha);
    camera.up.lerp(normal, alpha).normalize();
  }
  if (data.auto) camera.lookAt(controls.target);
  $("scene").dataset.cameraMode = data.auto ? "auto" : "manual";
  $("scene").dataset.cameraRadius = camera.position.length().toFixed(3);
  $("scene").dataset.nearRussian = primary;
}
function renderFrame(immediate = false, seconds = .016) {
  const ms = data.current;
  data.positions = {}; data.velocities = {}; data.available = {};
  earth.rotation.y = sgp4.gstime(new Date(ms));
  for (const item of craft) {
    const tle = data.selected[item.slot], state = stateAt(tle, ms);
    data.available[item.slot] = !!state;
    markers[item.slot].visible = !!state;
    if (labels[item.slot]) labels[item.slot].hidden = !state;
    if (state) { data.positions[item.slot] = state.position; data.velocities[item.slot] = state.velocity; markers[item.slot].position.copy(state.position); }
  }
  const currentFrame = data.frameMode === "relative" ? orbitFrameAt(ms) : null;
  if (data.auto) {
    if (data.frameMode === "relative") frameRelativeCamera(currentFrame);
    else frameCamera(immediate, seconds);
  }
  if (mini) placeRelativeTrails(currentFrame);
  $("scene").dataset.frameMode = data.frameMode;
  if (immediate || performance.now() - data.lastTrailWall > 130) { updateTraces(ms); data.lastTrailWall = performance.now(); }
  if ($('timestamp')) $('timestamp').textContent = formatUtc(ms);
  if ($('timeline')) { $('timeline').value = String(ms); $('timeline').style.setProperty('--progress', `${(ms - Date.parse(data.window.start)) / (Date.parse(data.window.end) - Date.parse(data.window.start)) * 100}%`); }
  const unavailable = craft.filter(item => !data.available[item.slot]).map(item => item.name);
  if ($('sceneStatus')) $('sceneStatus').textContent = unavailable.length ? `${unavailable.join(' and ')} unavailable in this window; no position or trail is shown.` : '';
  if ($('coverageRows') && (immediate || Math.abs(ms - data.lastCoverageMs) >= 30000)) {
    data.lastCoverageMs = ms;
    $('coverageRows').replaceChildren(...craft.map(item => {
      const row = document.createElement('div'); row.className = `coverage-row slot-${item.slot}`;
      const dot = document.createElement('i'); dot.className = `dot slot-${item.slot}`;
      const content = document.createElement('div'), title = document.createElement('strong'), source = document.createElement('small');
      title.textContent = `${item.slot} · ${item.name}`;
      const tle = data.selected[item.slot];
      if (tle) {
        const age = Math.abs(ms - Date.parse(tle.epoch)) / 3600000;
        const label = tle.source === 'space-track' ? 'Space-Track' : 'Amateur observers';
        if (tle.source === 'space-track') {
          const anchor = document.createElement('a'); anchor.href = spaceTrackHistoryUrl(item.norad, tle.epoch); anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
          anchor.textContent = label; anchor.title = 'Historical query for the selected UTC date; login required. May include more than one element set.'; source.append(anchor);
        } else source.append(label);
        source.append(` · epoch ${formatShort(Date.parse(tle.epoch))} · ${age.toFixed(1)} h from view`);
      } else source.textContent = 'No nearby dated element; omitted from the model';
      content.append(title, source); row.append(dot, content); return row;
    }));
  }
}
function resize() {
  const width = Math.max(1, $('scene').clientWidth), height = Math.max(1, $('scene').clientHeight);
  camera.aspect = width / height;
  if (mini && data.preferredView && !workshop) camera.zoom = data.preferredView.zoom * Math.min(1, Math.max(.38, width / 800));
  if (mini) camera.setViewOffset(width, height, width > 900 ? -Math.min(100, width * .09) : 0, Math.min(110, height * .18), width, height);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
  const markerScale = DOT_SCREEN_SIZE * 2.85 * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 275 / height * MARKER.diameterPx / 12;
  data.markerScale = markerScale;
  for (const marker of Object.values(markers)) marker.scale.set(markerScale, markerScale, 1);
}
new ResizeObserver(resize).observe($('scene'));
let last = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const seconds = Math.min(.1, (now - last) / 1000); last = now;
  if (data.playing) {
    data.current = Math.min(data.loopEnd, data.current + seconds * rate);
    if (data.current >= data.loopEnd) {
      data.playing = false;
      if (mini) {
        document.querySelector('.viewer').classList.add('loop-reset');
        setTimeout(() => {
          data.current = data.loopStart; renderFrame(true);
          requestAnimationFrame(() => { document.querySelector('.viewer').classList.remove('loop-reset'); data.playing = true; });
        }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360);
      } else {
        const next = windows[windows.findIndex(item => item.id === data.window.id) + 1];
        if (next) {
          $("scene").classList.remove("chapter-transition");
          selectWindow(next.id);
          void $("scene").offsetWidth;
          $("scene").classList.add("chapter-transition");
          $("scene").dispatchEvent(new CustomEvent("chapterchange", { detail: { id: next.id } }));
        } else setPlaybackButton();
      }
    }
  }
  renderFrame(false, seconds);
  if (!data.auto) controls.update();
  const rect = $('scene').getBoundingClientRect(), screen = {};
  for (const item of craft) {
    if (!data.available[item.slot]) continue;
    const projected = data.positions[item.slot].clone().project(camera);
    const x = (projected.x + 1) * rect.width / 2, y = (1 - projected.y) * rect.height / 2;
    const label = labels[item.slot]; screen[item.slot] = { x, y };
    if (label) { const shared = document.body.classList.contains('e002-shared'); label.style.left = `${x + (shared ? rect.left : 0) + 9}px`; label.style.top = `${y + (shared ? rect.top : 0)}px`; }
    const occluded = earthOccludes(data.positions[item.slot], camera.position);
    screen[item.slot].earthOccluded = occluded;
    screen[item.slot].inside = x > 12 && x < rect.width - 12 && y > 12 && y < rect.height - 12;
    if (mini && window.parent !== window) {
      const iframe = window.frameElement?.getBoundingClientRect();
      const px = iframe.left + x, py = iframe.top + y;
      screen[item.slot].sourceOccluded = [...parent.document.querySelectorAll('.expanded-row .source-card')].some(card => {
        const box = card.getBoundingClientRect(); return px >= box.left && px <= box.right && py >= box.top && py <= box.bottom;
      });
    }
    if (label) label.style.visibility = Math.abs(projected.x) > .92 || Math.abs(projected.y) > .84 || occluded ? 'hidden' : 'visible';
    markers[item.slot].visible = !occluded;
  }
  const overlap = screen.A && screen.C && Math.hypot(screen.A.x - screen.C.x, screen.A.y - screen.C.y) < 22;
  if (mini) {
    const points = Object.values(screen), distinguishable = points.every((point, index) => points.slice(index + 1).every(other => Math.hypot(point.x - other.x, point.y - other.y) >= DOT_SCREEN_SIZE));
    $("scene").dataset.previewVisibility = JSON.stringify({ utc: new Date(data.current).toISOString(), markers: screen, distinguishable });
  }
  // Concentric marks communicate projected overlap without moving either orbit.
  // A small outline reveals both coincident marks without implying a second
  // location. Their centers remain at their propagated coordinates.
  const cScale = data.markerScale * (mini && overlap ? 1.2 : 1);
  if (markers.C) { markers.C.scale.set(cScale, cScale, 1); markers.C.renderOrder = overlap ? 9 : 10; }
  if (!mini) {
    if (labels.A) labels.A.textContent = overlap ? 'Kosmos 2542 / 2543' : 'Kosmos 2542';
    if (labels.B) labels.B.textContent = 'USA 245';
    if (labels.C) { labels.C.textContent = 'Kosmos 2543'; labels.C.style.display = overlap ? 'none' : ''; }
    const abCollide = screen.A && screen.B && Math.abs(screen.A.y - screen.B.y) < 22 && Math.abs(screen.B.x - screen.A.x) < 110;
    if (labels.A) labels.A.style.transform = abCollide ? 'translateY(calc(-100% - 7px))' : 'translateY(-50%)';
    if (labels.B) labels.B.style.transform = abCollide ? 'translateY(6px)' : 'translateY(-50%)';
  }
  renderer.render(scene, camera);
}

function updateFrameButton() {
  const button = $('frameMode'); if (!button) return;
  button.textContent = data.frameMode === 'relative' ? 'Inertial camera' : 'Relative camera';
  button.setAttribute('aria-pressed', String(data.frameMode === 'relative'));
  button.title = data.frameMode === 'relative' ? 'Switch to an Earth-centered inertial view' : 'Follow the B–Russian pair in a co-moving orbital frame';
}

if ($('moment')) {
  for (const window of windows) { const option = document.createElement('option'); option.value = window.id; option.textContent = window.label; $('moment').append(option); }
  $('moment').addEventListener('change', event => selectWindow(event.target.value));
  $('play').addEventListener('click', () => {
    if (data.current >= Date.parse(data.window.end)) data.current = Date.parse(data.window.start);
    data.playing = !data.playing; setPlaybackButton();
  });
  $('timeline').addEventListener('input', event => { data.current = Number(event.target.value); data.playing = false; setPlaybackButton(); renderFrame(); });
  $('autoFrame').addEventListener('click', () => { data.frameMode = 'inertial'; data.relativeSeed = null; data.auto = true; updateFrameButton(); frameCamera(false, .3); });
  $('frameMode').addEventListener('click', () => {
    if (data.frameMode === 'relative') { data.frameMode = 'inertial'; data.relativeSeed = null; }
    else { data.relativePrimary = data.positions.B ? data.nearer : 'C'; seedRelativeCamera(orbitFrameAt(data.current)); data.frameMode = data.relativeSeed ? 'relative' : 'inertial'; }
    data.auto = true; updateFrameButton(); renderFrame(true);
  });
}

async function load() {
  if (!sgp4?.twoline2satrec) throw new Error('Orbital propagation library unavailable');
  const [manifest, examples] = await Promise.all([fetch(new URL('data/provenance.json', import.meta.url)).then(response => response.json()), fetch(new URL('camera-examples.json', import.meta.url)).then(response => response.json())]);
  data.preferredView = examples.views.find(view => view.name === 'This one please' && view.momentId === 'dec8');
  if (mini && !data.preferredView) throw new Error('Preferred December 8 camera view is unavailable');
  await Promise.all(craft.map(async item => {
    const record = manifest.datasets.find(dataset => dataset.object.norad === item.norad);
    if (!record) throw new Error(`Missing provenance for ${item.name}`);
    const response = await fetch(new URL(record.url, import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Dated elements for ${item.name} could not be retrieved`);
    const bytes = await response.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== record.sha256) throw new Error(`Dated elements for ${item.name} changed; provenance review required`);
    data.libraries[item.slot] = JSON.parse(new TextDecoder().decode(bytes));
    // The preserved USA 245 file identifies the SeeSat-L collection but does
    // not identify an original post for each element. Store the most specific
    // verified URL on each TLE; a matched post can replace it individually.
    for (const tle of data.libraries[item.slot].tles) {
      if (tle.source === 'seesat' && !tle.sourceUrl) tle.sourceUrl = record.url;
    }
  }));
  resize(); selectWindow(workshop ? 'dec9' : mini ? 'dec8' : 'dec7', true);
  if ($('timeline')) { $('timeline').min = String(Date.parse(data.window.start)); $('timeline').max = String(Date.parse(data.window.end)); }
  // Main view starts moving immediately; Play/Pause remains visible throughout.
  data.playing = true; setPlaybackButton(); data.ready = true; requestAnimationFrame(animate);
}
load().then(() => {
  if (workshop) { window.miniWorkshop = episodeModel; parent.postMessage({ type: "espl-e002-mini-ready" }, location.origin); }
}).catch(error => { if ($('sceneStatus')) $('sceneStatus').textContent = error.message; else console.error(error); });

// The shared episode shell uses this same scene and vetted element selection.
// Its charts sample only the currently selected, supported viewing window.
export const episodeModel = {
  get config() { return episode; },
  get ready() { return data.ready; },
  get window() { return data.window; },
  get current() { return data.current; },
  get playing() { return data.playing; },
  get rate() { return rate / 1000; },
  get loopStart() { return data.loopStart; },
  get loopEnd() { return data.loopEnd; },
  setRate(value) { rate = THREE.MathUtils.clamp(value, 60, 259200) * 1000; },
  get selected() { return data.selected; },
  get frameMode() { return data.frameMode; },
  get craft() { return craft; },
  get windows() { return windows; },
  samplePair(first, second, ms) {
    const a = stateAt(data.selected[first], ms), b = stateAt(data.selected[second], ms);
    if (!a || !b) return null;
    return { distanceKm: a.position.distanceTo(b.position) * EARTH_KM,
      speedMs: a.velocity.distanceTo(b.velocity) * EARTH_KM * 1000 };
  },
  setTime(ms) { data.current = THREE.MathUtils.clamp(ms, Date.parse(data.window.start), Date.parse(data.window.end)); data.playing = false; setPlaybackButton(); renderFrame(true); },
  setLoop(start, end) {
    const first = Date.parse(data.window.start), last = Date.parse(data.window.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < first || end > last || end - start < 60000) throw new Error("Choose a loop of at least one minute inside this chapter.");
    data.loopStart = start; data.loopEnd = end; data.current = THREE.MathUtils.clamp(data.current, start, end); renderFrame(true);
  },
  setPlaying(value) { if (value && data.current >= data.loopEnd) data.current = data.loopStart; data.playing = !!value; setPlaybackButton(); },
  selectWindow(id) { selectWindow(id); },
  toggleFrame() {
    if (!workshop) { $('frameMode')?.click(); return; }
    if (data.frameMode === 'relative') { data.frameMode = 'inertial'; data.relativeSeed = null; data.auto = true; frameCamera(true); }
    else { data.relativePrimary = data.positions.B ? data.nearer : 'C'; seedRelativeCamera(orbitFrameAt(data.current)); data.frameMode = data.relativeSeed ? 'relative' : 'inertial'; data.auto = true; }
    renderFrame(true);
  },
  resetCamera() {
    if (!workshop) { $('autoFrame')?.click(); return; }
    data.auto = false; frameCamera(true);
    if (data.frameMode === 'relative') seedRelativeCamera(orbitFrameAt(data.current));
    data.auto = true; $("scene").dataset.cameraMode = "auto"; renderFrame(true);
  },
  zoom(factor) { camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, .5, 3); camera.updateProjectionMatrix(); if (workshop && data.frameMode === 'relative') { seedRelativeCamera(orbitFrameAt(data.current)); data.auto = !!data.relativeSeed; } else { data.auto = false; $("scene").dataset.cameraMode = "manual"; } },
  captureCamera(name = 'Untitled view') { return { episodeId: 'E-002', name, momentId: data.window.id, timestampUtc: new Date(data.current).toISOString(), frameMode: data.frameMode,
    position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(), fieldOfViewDeg: camera.fov, zoom: camera.zoom }; },
  applyCamera(view) {
    camera.position.fromArray(view.position); controls.target.fromArray(view.target); camera.up.fromArray(view.up || [0,1,0]); camera.fov = view.fieldOfViewDeg; camera.zoom = view.zoom; camera.updateProjectionMatrix(); camera.lookAt(controls.target);
    if (workshop) { data.frameMode = view.frameMode === 'inertial' ? 'inertial' : 'relative'; if (data.frameMode === 'relative') seedRelativeCamera(orbitFrameAt(data.current)); data.auto = data.frameMode === 'relative'; renderFrame(true); }
    else { data.auto = false; $("scene").dataset.cameraMode = "manual"; }
  },
  previewCameraTransition(view, duration = 1100) {
    const from = this.captureCamera('Transition start'), start = performance.now(); data.auto = false; $("scene").dataset.cameraMode = "manual";
    const destination = new THREE.Vector3().fromArray(view.position), target = new THREE.Vector3().fromArray(view.target), up = new THREE.Vector3().fromArray(view.up || [0,1,0]);
    const eye0 = new THREE.Vector3().fromArray(from.position), target0 = new THREE.Vector3().fromArray(from.target), up0 = new THREE.Vector3().fromArray(from.up);
    const step = now => { const fraction = THREE.MathUtils.clamp((now - start) / duration, 0, 1), eased = fraction * fraction * (3 - 2 * fraction);
      camera.position.copy(eye0).lerp(destination, eased); controls.target.copy(target0).lerp(target, eased); camera.up.copy(up0).lerp(up, eased).normalize();
      camera.fov = THREE.MathUtils.lerp(from.fieldOfViewDeg, view.fieldOfViewDeg, eased); camera.zoom = THREE.MathUtils.lerp(from.zoom, view.zoom, eased); camera.updateProjectionMatrix(); camera.lookAt(controls.target);
      if (fraction < 1) requestAnimationFrame(step);
      else if (view.frameMode === 'relative') { data.frameMode = 'relative'; seedRelativeCamera(orbitFrameAt(data.current)); data.auto = !!data.relativeSeed; $("scene").dataset.cameraMode = data.auto ? "auto" : "manual"; updateFrameButton(); } };
    requestAnimationFrame(step);
  }
};

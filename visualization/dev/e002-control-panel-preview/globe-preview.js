import * as THREE from "../../Viz/vendor/three/three.module.js";
import { OrbitControls } from "../../Viz/vendor/three/addons/controls/OrbitControls.js";
import { feature } from "../../Viz/vendor/topojson/topojson-client.js";
import { DOT_SCREEN_SIZE, dotTexture, fadingTrailGeometry, fadingTrailMaterial, miniMarkerScale } from "../../Viz/relative-rendering.js?v=5";
import { MARKER } from "../../../shared/marker-spec.js";

const EARTH_KM = 6378.137;
const toScene = point => new THREE.Vector3(point.x / EARTH_KM, point.z / EARTH_KM, -point.y / EARTH_KM);

export function createGlobePreview(model, episode, names, initialCameraViews = [], options = {}) {
  const stage = document.getElementById("globeStage");
  const mount = document.getElementById("scene");
  const labelMount = document.getElementById("satelliteScreenLabels");
  const status = document.getElementById("sceneStatus");
  const caveat = document.getElementById("modelCaveat");
  const orbitTooltip = document.createElement("div");
  orbitTooltip.className = "orbit-tooltip"; orbitTooltip.role = "tooltip"; orbitTooltip.hidden = true;
  stage.append(orbitTooltip);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.tableMini ? 0xfffcf6 : 0xffffff);
  const camera = new THREE.PerspectiveCamera(35, 1, .001, 250);
  camera.up.set(0, 1, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio || 1, 2), 2.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute("aria-hidden", "true");
  mount.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.enablePan = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xeeeeee, 2.4));
  const miniEarthRest = 0xd8cbb9, miniEarthHover = 0xcfbea9;
  const miniReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let miniHover = false;
  const earth = new THREE.Group(); scene.add(earth);
  const earthSurface = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), new THREE.MeshBasicMaterial({ color: options.tableMini ? miniEarthRest : 0xf7f7f7 }));
  earth.add(earthSurface);
  const relativeEarth = new THREE.Group();
  const relativeEarthSurface = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), new THREE.MeshBasicMaterial({ color: options.tableMini ? miniEarthRest : 0xf3f3f3 }));
  relativeEarth.add(relativeEarthSurface);
  relativeEarth.scale.setScalar(EARTH_KM / 1000);
  relativeEarth.visible = false;
  scene.add(relativeEarth);
  fetch("../../Viz/vendor/countries-50m.json").then(response => response.json()).then(topology => {
    const coords = [], radius = 1.0017, seen = new Set();
    for (const country of feature(topology, topology.objects.countries).features) {
      const geometry = country.geometry;
      const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : [];
      for (const ring of rings) for (let index = 1; index < ring.length; index++) {
        const a = ring[index - 1], b = ring[index];
        const key = [a, b].map(point => `${point[0].toFixed(5)},${point[1].toFixed(5)}`).sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const makePoint = point => {
          const lat = THREE.MathUtils.degToRad(point[1]), lon = THREE.MathUtils.degToRad(point[0]);
          return new THREE.Vector3(radius * Math.cos(lat) * Math.cos(lon), radius * Math.sin(lat), -radius * Math.cos(lat) * Math.sin(lon));
        };
        const first = makePoint(a), last = makePoint(b), angle = first.angleTo(last);
        if (angle > THREE.MathUtils.degToRad(25)) continue;
        const steps = Math.max(1, Math.ceil(THREE.MathUtils.radToDeg(angle)));
        let previous = first;
        for (let step = 1; step <= steps; step++) {
          const next = first.clone().lerp(last, step / steps).normalize().multiplyScalar(radius);
          coords.push(...previous.toArray(), ...next.toArray()); previous = next;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
    earth.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: options.tableMini ? 0x6b655b : 0x444444, transparent: true, opacity: options.tableMini ? .55 : 1, depthTest: true, depthWrite: false })));
    relativeEarth.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: options.tableMini ? 0x6b655b : 0x3a3a3a, transparent: true, opacity: options.tableMini ? .55 : 1, depthTest: true, depthWrite: false })));
  }).catch(() => {});

  const markers = {}, labels = {}, trails = {}, labelPlacement = {};
  const referenceOrbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: options.tableMini ? 0x5c513a : 0x222222, transparent: true, opacity: options.tableMini ? .88 : .72, depthTest: true, depthWrite: false }));
  referenceOrbit.frustumCulled = false; referenceOrbit.renderOrder = 2; referenceOrbit.visible = false; scene.add(referenceOrbit);
  for (const item of episode.participants) {
    const color = item.slot === "B" ? MARKER.B : MARKER.A;
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(color), sizeAttenuation: false, transparent: true, depthTest: true, depthWrite: false }));
    marker.material.depthTest = !options.tableMini; marker.renderOrder = 10;
    scene.add(marker); markers[item.slot] = marker;
    const trail = new THREE.Mesh(fadingTrailGeometry([]), fadingTrailMaterial(item.slot === "B" ? "B" : "A"));
    trail.material.depthTest = !options.tableMini;
    trail.renderOrder = 9;
    trail.frustumCulled = false;
    scene.add(trail); trails[item.slot] = trail;
    const label = document.createElement("span");
    label.className = "satelliteScreenLabel slot" + item.slot;
    label.textContent = names[item.slot] || item.name;
    labelMount.append(label); labels[item.slot] = label;
  }

  let mode = "relative", referenceMode = "target", auto = true, followSavedMode = true, currentWindow = null, currentMs = NaN, focus = "A";
  const fullEarthEci = (windowId, selected) => windowId === "dec30" && selected === "C";
  let cameraViews = [...initialCameraViews], preferredDistance = 0;
  let learnedViewsByKey = new Map(), modeTimelineByKey = new Map();
  function indexCameraViews() {
    const keyed = new Map(), timelines = new Map();
    for (const view of cameraViews) {
      if (!["relative", "eci"].includes(view.mode) || !Array.isArray(view.position) || !Array.isArray(view.target)) continue;
      const routeKey = `${view.windowId}:${view.selected}:${view.referenceMode}`;
      const poseKey = `${routeKey}:${view.mode}`;
      if (!timelines.has(routeKey)) timelines.set(routeKey, []);
      timelines.get(routeKey).push(view);
      if (!keyed.has(poseKey)) keyed.set(poseKey, new Map());
      const previous = keyed.get(poseKey).get(view.timeUtc);
      if (!previous || view.auto === false || previous.auto !== false) keyed.get(poseKey).set(view.timeUtc, view);
    }
    learnedViewsByKey = new Map([...keyed].map(([key, timed]) => {
      const views = [...timed.values()].sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
      const authored = views.filter(view => view.auto === false);
      const anchors = authored.length ? [views[0], ...authored, views.at(-1)] : [views[0], views.at(-1)];
      return [key, [...new Map(anchors.map(view => [view.timeUtc, view])).values()].sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc))];
    }));
    modeTimelineByKey = new Map([...timelines].map(([key, views]) => [key, views.sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc))]));
  }
  indexCameraViews();
  // Saved views are examples: use the nearest relevant one when entering a chapter,
  // then retain the current framing when the user changes a chaser or origin.
  const chapterCameraView = (windowId, ms, slot, kind) => cameraViews
    .filter(view => view.windowId === windowId && view.mode === kind && Array.isArray(view.position) && Array.isArray(view.target))
    .map(view => ({ view, score: Math.abs(Date.parse(view.timeUtc) - ms) / 3600000 + (view.selected === slot ? 0 : 8) + (view.referenceMode === referenceMode ? 0 : 8) }))
    .sort((a, b) => a.score - b.score)[0]?.view;
  function learnedMode(windowId, ms, slot) {
    const views = modeTimelineByKey.get(`${windowId}:${slot}:${referenceMode}`) || [];
    if (!views.length) return "relative";
    let selectedMode = views[0].mode;
    for (const view of views) {
      if (Date.parse(view.timeUtc) > ms) break;
      selectedMode = view.mode;
    }
    return selectedMode;
  }
  function learnedCameraPath(windowId, ms, slot, kind = mode) {
    const exact = learnedViewsByKey.get(`${windowId}:${slot}:${referenceMode}:${kind}`) || [];
    const fallback = exact.length || kind === "eci" ? null : chapterCameraView(windowId, ms, slot, kind);
    if (!exact.length && !fallback) return null;
    const first = exact[0] || fallback, last = exact.at(-1) || fallback;
    let left = first, right = last;
    if (exact.length) {
      if (ms <= Date.parse(first.timeUtc)) left = right = first;
      else if (ms >= Date.parse(last.timeUtc)) left = right = last;
      else for (let index = 1; index < exact.length; index++) if (ms <= Date.parse(exact[index].timeUtc)) {
        left = exact[index - 1]; right = exact[index]; break;
      }
    }
    const eye = view => new THREE.Vector3(...view.position).sub(new THREE.Vector3(...view.target));
    const leftEye = eye(left), rightEye = eye(right);
    const span = Date.parse(right.timeUtc) - Date.parse(left.timeUtc);
    const fraction = span > 0 ? THREE.MathUtils.clamp((ms - Date.parse(left.timeUtc)) / span, 0, 1) : 0;
    const eased = fraction * fraction * (3 - 2 * fraction);
    const leftDistance = Math.max(.001, leftEye.length()), rightDistance = Math.max(.001, rightEye.length());
    const direction = leftEye.normalize().lerp(rightEye.normalize(), eased);
    if (direction.lengthSq() < .0001) direction.copy(leftEye);
    direction.normalize();
    const distance = Math.exp(THREE.MathUtils.lerp(Math.log(leftDistance), Math.log(rightDistance), eased));
    return { direction, distance, target: new THREE.Vector3(...left.target).lerp(new THREE.Vector3(...right.target), eased), source: left.id === right.id ? left.id : `${left.id}:${right.id}` };
  }
  let orbitSourceKey = "", orbitSourcePoints = [], referenceSwingUntil = 0;
  let miniTleAnchorMs = NaN;
  const frameAt = (window, ms, selectionMs = ms) => model.frame(window, ms,
    options.tableMini && Number.isFinite(miniTleAnchorMs) ? miniTleAnchorMs
      : mode === "eci" ? Date.parse(window.anchor) : selectionMs);
  let positions = {}, earthRadius = EARTH_KM / 1000, earthCenter = new THREE.Vector3();
  const earthTargetQuaternion = new THREE.Quaternion();
  let markerScale = .1, desiredDistance = .55, lastTrailPaint = 0;
  const relativeEye = new THREE.Vector3(.2, 1, .25).normalize();
  const preferredRelativeEye = relativeEye.clone(), preferredTarget = new THREE.Vector3();
  const eciEye = new THREE.Vector3(2.4, 2.1, 4.5).normalize().multiplyScalar(4.2);
  controls.minDistance = .12;
  controls.maxDistance = 110;
  controls.addEventListener("start", () => { auto = false; stage.dataset.cameraMode = "manual"; });

  function resize() {
    const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
    camera.aspect = width / height;
    if (width > 620 || options.tableMini) camera.setViewOffset(width, height, width > 620 ? -Math.min(165, width * .14) : 0,
      options.tableMini ? Math.max(0, height / 2 - Math.min(240, height * .36)) : 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    for (const trail of Object.values(trails)) trail.material.uniforms.uResolution.value.set(width, height);
    markerScale = options.tableMini
      ? miniMarkerScale(camera, height)
      : DOT_SCREEN_SIZE * 2.85 * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 275 / height * MARKER.diameterPx / 12;
    for (const marker of Object.values(markers)) marker.scale.set(markerScale, markerScale, 1);
  }
  new ResizeObserver(resize).observe(mount);
  resize();

  const eciVector = point => new THREE.Vector3(point.x, point.y, point.z);
  function activeReference(frame) {
    return frame[referenceMode === "target" ? "B" : focus];
  }
  function drawReferenceOrbit(window, ms, frame) {
    const reference = activeReference(frame);
    referenceOrbit.visible = !!reference;
    if (!referenceOrbit.visible) {
      stage.dataset.orbitMode = "hidden";
      stage.dataset.orbitPoints = "0";
      return;
    }
    const slot = referenceMode === "target" ? "B" : focus;
    const key = `${window.id}:${slot}:${Math.floor(ms / 600000)}`;
    if (orbitSourceKey !== key) {
      const r = eciVector(reference.position).length(), v = eciVector(reference.velocity).length();
      const semimajor = 1 / (2 / r - v * v / 398600.4418);
      const periodMs = 2 * Math.PI * Math.sqrt(semimajor ** 3 / 398600.4418) * 1000;
      orbitSourcePoints = [];
      for (let index = 0; index < 240; index++) {
        const time = ms + (index / 240 - .5) * periodMs;
        const state = frameAt(window, time, ms)[slot];
        if (state) orbitSourcePoints.push(eciVector(state.position));
      }
      orbitSourceKey = key;
    }
    const drawKey = `${mode}:${key}:${mode === "relative" ? Math.floor(ms / 60000) : 0}`;
    if (referenceOrbit.userData.drawKey === drawKey) return;
    const origin = eciVector(reference.position), axes = mode === "relative" ? referenceAxes(reference) : null;
    const points = orbitSourcePoints.map(point => {
      if (mode === "eci") return toScene({ x: point.x, y: point.y, z: point.z });
      const delta = point.clone().sub(origin);
      return new THREE.Vector3(delta.dot(axes.along), delta.dot(axes.cross), delta.dot(axes.radial)).divideScalar(1000);
    });
    if (points.length > 1) points.push(points[0].clone());
    referenceOrbit.geometry.dispose();
    referenceOrbit.geometry = new THREE.BufferGeometry().setFromPoints(points);
    referenceOrbit.userData.drawKey = drawKey;
    stage.dataset.orbitReference = slot;
    stage.dataset.orbitPoints = String(orbitSourcePoints.length);
    stage.dataset.orbitMode = mode;
  }
  function referenceAxes(body) {
    const radial = eciVector(body.position).normalize();
    const cross = eciVector(body.position).cross(eciVector(body.velocity)).normalize();
    const along = cross.clone().cross(radial).normalize();
    return { radial, along, cross };
  }
  function relativePoint(reference, body, axes) {
    const delta = eciVector(body.position).sub(eciVector(reference.position));
    return new THREE.Vector3(delta.dot(axes.along), delta.dot(axes.cross), delta.dot(axes.radial)).divideScalar(1000);
  }
  function placeEarth(reference, axes, ms) {
    if (mode === "eci" || !reference) {
      earth.visible = true; relativeEarth.visible = false;
      earth.matrixAutoUpdate = true;
      earth.position.set(0, 0, 0); earth.rotation.set(0, globalThis.satellite.gstime(new Date(ms)), 0); earth.scale.set(1, 1, 1);
      earthCenter.set(0, 0, 0); earthRadius = 1;
      return;
    }
    // Keep the mapped Earth's apparent size fixed, but recompute its orientation
    // from sidereal rotation and the moving local orbital frame at every time.
    earth.visible = false; relativeEarth.visible = true;
    const reanchoring = !relativeEarth.userData.anchored;
    relativeEarth.position.copy(relativePoint(reference, { position: { x: 0, y: 0, z: 0 } }, axes));
    relativeEarth.userData.anchored = true;
    const sceneX = new THREE.Vector3(1, 0, 0), sceneY = new THREE.Vector3(0, 0, 1), sceneZ = new THREE.Vector3(0, -1, 0);
    const toLocal = vector => new THREE.Vector3(vector.dot(axes.along), vector.dot(axes.cross), vector.dot(axes.radial));
    const angle = globalThis.satellite.gstime(new Date(ms));
    const basis = new THREE.Matrix4().makeBasis(
      toLocal(sceneX.applyAxisAngle(new THREE.Vector3(0, 0, 1), angle)),
      toLocal(sceneY),
      toLocal(sceneZ.applyAxisAngle(new THREE.Vector3(0, 0, 1), angle))
    );
    earthTargetQuaternion.setFromRotationMatrix(basis);
    if (reanchoring) relativeEarth.quaternion.copy(earthTargetQuaternion);
    earthCenter.copy(relativeEarth.position);
    earthRadius = EARTH_KM / 1000;
  }
  function earthClearance(point, eye) {
    const ray = point.clone().sub(eye), fromCenter = eye.clone().sub(earthCenter);
    const closest = THREE.MathUtils.clamp(-fromCenter.dot(ray) / ray.lengthSq(), 0, 1);
    return fromCenter.addScaledVector(ray, closest).length() - earthRadius;
  }
  const earthOccludes = (point, eye) => earthClearance(point, eye) < 0;
  renderer.domElement.addEventListener("pointermove", event => {
    const geometry = referenceOrbit.geometry.getAttribute("position");
    if (!referenceOrbit.visible || !geometry || geometry.count < 2) { orbitTooltip.hidden = true; return; }
    const rect = renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const first = new THREE.Vector3(), second = new THREE.Vector3();
    let near = false;
    for (let index = 1; index < geometry.count; index++) {
      first.fromBufferAttribute(geometry, index - 1); second.fromBufferAttribute(geometry, index);
      if (earthOccludes(first.clone().lerp(second, .5), camera.position)) continue;
      const a = first.project(camera), b = second.project(camera);
      if (a.z >= 1 || b.z >= 1) continue;
      const ax = (a.x + 1) * rect.width / 2, ay = (1 - a.y) * rect.height / 2;
      const bx = (b.x + 1) * rect.width / 2, by = (1 - b.y) * rect.height / 2;
      const dx = bx - ax, dy = by - ay;
      const fraction = THREE.MathUtils.clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      if (Math.hypot(x - ax - fraction * dx, y - ay - fraction * dy) <= 9) { near = true; break; }
    }
    orbitTooltip.hidden = !near;
    if (near) {
      const name = names[referenceMode === "target" ? "B" : focus];
      orbitTooltip.textContent = `Modeled reference orbit of ${name}: one SGP4-propagated revolution from its nearest TLE, shown in the current relative frame.`;
      const stageRect = stage.getBoundingClientRect();
      orbitTooltip.style.left = `${Math.max(8, Math.min(stage.clientWidth - 245, event.clientX - stageRect.left + 14))}px`;
      orbitTooltip.style.top = `${Math.max(8, Math.min(stage.clientHeight - 68, event.clientY - stageRect.top + 14))}px`;
    }
  });
  renderer.domElement.addEventListener("pointerleave", () => { orbitTooltip.hidden = true; });
  function planCamera(immediate = false, smoothReference = false) {
    if (!auto) return;
    if (mode === "relative") {
      const selected = positions[focus];
      const separation = selected ? selected.length() : .08;
      const target = positions.B;
      desiredDistance = THREE.MathUtils.clamp(Math.max(.45, preferredDistance, separation / .2, target ? target.length() / .2 : 0), .45, 100);
      if (selected && target) {
        const clearance = direction => {
          const eye = direction.clone().multiplyScalar(desiredDistance).add(preferredTarget);
          return Math.min(earthClearance(selected, eye), earthClearance(target, eye));
        };
        if (clearance(relativeEye) < .05) {
          const candidates = [relativeEye.clone(), preferredRelativeEye.clone(), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)];
          for (const inclination of [.2, .4, .6, .8, 1, 1.2, 1.4]) {
            for (let azimuth = 0; azimuth < 16; azimuth++) {
              const angle = azimuth * Math.PI / 8;
              candidates.push(new THREE.Vector3(Math.sin(inclination) * Math.cos(angle), Math.sin(inclination) * Math.sin(angle), Math.cos(inclination)));
            }
          }
          const scored = candidates.map(direction => {
            const margin = clearance(direction);
            return { direction, score: (margin < .05 ? 100 + (.05 - margin) * 100 : 0) + .35 * direction.angleTo(preferredRelativeEye) + 2 * direction.angleTo(relativeEye) };
          }).sort((a, b) => a.score - b.score);
          relativeEye.copy(scored[0].direction);
        }
        const actualClearance = Math.min(earthClearance(selected, camera.position), earthClearance(target, camera.position));
        if (immediate || actualClearance < 0) camera.position.copy(relativeEye).multiplyScalar(desiredDistance).add(preferredTarget);
        const plannedEye = relativeEye.clone().multiplyScalar(desiredDistance).add(preferredTarget);
        stage.dataset.pairClearanceKm = (Math.min(earthClearance(selected, plannedEye), earthClearance(target, plannedEye)) * 1000).toFixed(1);
      }
    } else {
      desiredDistance = eciEye.length();
      if (immediate) camera.position.copy(eciEye).add(preferredTarget);
    }
    if (immediate) {
      controls.target.copy(preferredTarget);
      camera.up.set(0, 1, 0); camera.lookAt(controls.target); controls.update();
    }
    stage.dataset.autoDistance = desiredDistance.toFixed(4);
    stage.dataset.cameraMode = "auto";
  }
  function refreshTrails(window, ms) {
    const durationMinutes = mode === "relative" ? 240 : 720;
    const duration = durationMinutes * 60000;
    const step = duration / (mode === "relative" ? 240 : 144);
    const first = Math.max(Date.parse(window.start), ms - duration);
    const times = [];
    for (let t = first; t < ms; t += step) times.push(t);
    times.push(ms);
    // Hold the selected elements across the trailing path so a nearest-element
    // boundary never creates a kink. Trim both view modes to screen length below.
    const samples = times.map(time => ({ time, frame: frameAt(window, time, ms) }));
    camera.updateMatrixWorld(true);
    const screenPoint = point => {
      const projected = point.clone().project(camera);
      return { x: (projected.x + 1) * mount.clientWidth / 2, y: (1 - projected.y) * mount.clientHeight / 2 };
    };
    for (const item of episode.participants) {
      const trail = trails[item.slot];
      if (options.tableMini && item.slot === "C") { trail.visible = false; stage.dataset["trailPoints" + item.slot] = "0"; continue; }
      if (mode === "relative" && item.slot === (referenceMode === "target" ? "B" : focus)) { trail.visible = false; stage.dataset["trailPoints" + item.slot] = "0"; continue; }
      const allPoints = [], points = [];
      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index].frame, body = sample[item.slot];
        const reference = activeReference(sample);
        // A missing propagation sample ends the older segment. Never draw a
        // straight bridge across a gap in historical elements.
        if (!body || (mode === "relative" && !reference)) { allPoints.length = 0; continue; }
        const point = mode === "relative" ? relativePoint(reference, body, referenceAxes(reference)) : toScene(body.position);
        allPoints.push(point);
      }
      // Keep roughly the published E-001 trail length on screen at this zoom.
      // The points still follow the actual modeled path rather than a straight cue.
      if (camera.position.length() > .1) {
        let pixelLength = 0;
        for (let index = allPoints.length - 1; index > 0; index--) {
          const newer = screenPoint(allPoints[index]), older = screenPoint(allPoints[index - 1]);
          pixelLength += Math.hypot(newer.x - older.x, newer.y - older.y);
          if (pixelLength > 260) { points.push(allPoints[index - 1]); break; }
          points.push(allPoints[index - 1]);
        }
        points.reverse();
        if (allPoints.length) points.push(allPoints.at(-1));
      } else points.push(...allPoints);
      trail.geometry.dispose();
      trail.geometry = fadingTrailGeometry(points);
      trail.visible = points.length > 1;
      trail.material.uniforms.uOpacity.value = options.tableMini ? 1 : item.slot === "B" ? .85 : item.slot === focus ? 1 : .4;
      stage.dataset["trailPoints" + item.slot] = String(points.length);
    }
  }
  function update(window, ms, selected, force = false) {
    if (!force && currentWindow?.id === window.id && currentMs === ms && focus === selected) return;
    const windowChanged = currentWindow?.id !== window.id, focusChanged = focus !== selected;
    if (windowChanged) followSavedMode = true;
    const forcedEci = fullEarthEci(window.id, selected);
    if (forcedEci && (windowChanged || focusChanged || mode !== "eci")) { auto = true; followSavedMode = true; }
    let pathModeChanged = false;
    if (auto && followSavedMode) {
      const expectedMode = forcedEci ? "eci" : learnedMode(window.id, ms, selected);
      if (expectedMode !== mode) {
        mode = expectedMode; pathModeChanged = true; syncModeButton();
        if (mode === "relative") relativeEarth.userData.anchored = false;
        stage.dataset.cameraTransition = "switching";
        setTimeout(() => { stage.dataset.cameraTransition = "idle"; }, 450);
      }
    }
    if (mode === "relative") delete stage.dataset.cameraFallback;
    const modeOrWindowChanged = force || windowChanged || focusChanged || pathModeChanged;
    if (mode === "relative" && (windowChanged || force === true || force === "path" || pathModeChanged)) {
      preferredDistance = 0;
      preferredTarget.set(0, 0, 0);
      preferredRelativeEye.set(.2, 1, .25).normalize(); relativeEye.copy(preferredRelativeEye);
      stage.dataset.cameraPresetId = "";
      const path = learnedCameraPath(window.id, ms, selected);
      if (path) {
        preferredDistance = path.distance; preferredTarget.copy(path.target);
        preferredRelativeEye.copy(path.direction); relativeEye.copy(path.direction);
        stage.dataset.cameraPresetId = path.source;
      }
    } else if (mode === "relative" && (focusChanged || force === "reference")) {
      // A selection or reference swap changes coordinates, not the reader's view.
      const eye = camera.position.clone().sub(controls.target);
      if (eye.lengthSq() > .0001) {
        relativeEye.copy(eye).normalize();
        preferredRelativeEye.copy(relativeEye);
        preferredDistance = eye.length(); preferredTarget.copy(controls.target);
      }
    } else if (mode === "relative" && auto) {
      const path = learnedCameraPath(window.id, ms, selected);
      if (path) {
        preferredDistance = path.distance; preferredTarget.copy(path.target);
        preferredRelativeEye.copy(path.direction); relativeEye.copy(path.direction);
        stage.dataset.cameraPresetId = path.source;
      }
    }
    if (focusChanged) { auto = true; if (referenceMode === "chaser") relativeEarth.userData.anchored = false; syncReferenceButton(); }
    if (currentWindow?.id !== window.id || focus !== selected) relativeEarth.userData.anchored = false;
    currentWindow = window; currentMs = ms; focus = selected === "C" ? "C" : "A";
    syncModeButton();
    syncReferenceButton();
    const frame = frameAt(window, ms), reference = activeReference(frame);
    if (mode === "eci" && reference) {
      const r = eciVector(reference.position), v = eciVector(reference.velocity);
      const normal = r.cross(v).normalize();
      const orbitRadius = Math.max(1, ...episode.participants.map(item => frame[item.slot]?.position ? eciVector(frame[item.slot].position).length() / EARTH_KM : 1));
      const fitDistance = Math.max(4.2, orbitRadius * 1.4 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, 1 / camera.aspect));
      eciEye.copy(toScene({ x: normal.x, y: normal.y, z: normal.z }).normalize().multiplyScalar(fitDistance));
      stage.dataset.eciNormal = [normal.x, normal.y, normal.z].map(value => value.toFixed(4)).join(",");
      preferredTarget.set(0, 0, 0);
    }
    drawReferenceOrbit(window, ms, frame);
    const axes = reference && referenceAxes(reference);
    positions = {};
    placeEarth(reference, axes, ms);
    for (const item of episode.participants) {
      const body = frame[item.slot], marker = markers[item.slot], label = labels[item.slot];
      marker.visible = !!body && !(options.tableMini && item.slot === "C"); label.hidden = !marker.visible;
      label.classList.toggle("is-muted", item.slot !== "B" && item.slot !== focus);
      if (!body) continue;
      positions[item.slot] = mode === "relative" && reference ? relativePoint(reference, body, axes) : toScene(body.position);
      marker.position.copy(positions[item.slot]);
      marker.material.opacity = options.tableMini ? 1 : item.slot !== "B" && item.slot !== focus ? .3 : 1;
    }
    if (auto) planCamera(force === true || windowChanged || pathModeChanged, force === "reference" || focusChanged || force === "path");
    if (modeOrWindowChanged || performance.now() - lastTrailPaint > 180) {
      refreshTrails(window, ms); lastTrailPaint = performance.now();
    } else for (const item of episode.participants) trails[item.slot].material.uniforms.uOpacity.value = options.tableMini ? 1 : item.slot === "B" ? .85 : item.slot === focus ? 1 : .4;
    status.textContent = Object.entries(frame).filter(([, value]) => !value).map(([slot]) => names[slot]).join(", ");
    if (status.textContent) status.textContent += " unavailable from the local element library.";
    caveat.textContent = mode === "relative"
      ? `Relative view holds ${referenceMode === "target" ? names.B : names[focus]} at the origin. The selected pair remains visible in automatic camera mode; the other chaser may pass behind Earth.`
      : `ECI view follows the normal to ${referenceMode === "target" ? names.B : names[focus]}'s orbital plane.`;
    stage.dataset.mode = mode; stage.dataset.focus = focus; stage.dataset.referenceMode = referenceMode;
    stage.dataset.visible = Object.entries(frame).filter(([, value]) => !!value).map(([slot]) => slot).join("");
    stage.dataset.referenceOffsetBKm = positions.B ? (positions.B.length() * 1000).toFixed(1) : "";
    stage.dataset.pairPositions = JSON.stringify({ B: positions.B?.toArray(), selected: positions[focus]?.toArray(), earth: earthCenter.toArray() });
  }
  function syncModeButton() {
    const button = document.getElementById("modeBtn"), relative = mode === "relative";
    const locked = fullEarthEci(currentWindow?.id, focus);
    button.disabled = locked;
    button.title = locked ? "Full Earth ECI view for this pair and chapter" : relative ? "Switch to ECI view" : "Switch to relative motion";
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("isRelative", relative);
    button.innerHTML = relative
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c-3 3-3 13 0 16M12 4c3 3 3 13 0 16"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="13" r="1" fill="currentColor"/><path d="M2 12h4m12 0h4M12 2v4m0 12v4"/></svg>';
  }
  syncModeButton();
  document.getElementById("modeBtn").addEventListener("click", () => {
    if (fullEarthEci(currentWindow?.id, focus)) return;
    mode = mode === "relative" ? "eci" : "relative"; auto = true; followSavedMode = false; syncModeButton();
    syncReferenceButton();
    if (mode === "relative") relativeEarth.userData.anchored = false;
    if (currentWindow) update(currentWindow, currentMs, focus, true);
  });
  const referenceButton = document.getElementById("referenceBtn");
  function syncReferenceButton() {
    referenceButton.disabled = mode === "eci";
    const target = referenceMode === "target";
    const description = target ? `Reference: ${names.B}. Switch to selected ${names[focus]}` : `Reference: ${names[focus]}. Switch to ${names.B}`;
    referenceButton.title = description;
    referenceButton.setAttribute("aria-label", description);
    referenceButton.setAttribute("aria-pressed", String(!target));
    referenceButton.classList.toggle("is-chaser", !target);
  }
  referenceButton.addEventListener("click", () => {
    const now = performance.now();
    referenceMode = referenceMode === "target" ? "chaser" : "target";
    auto = true; relativeEarth.userData.anchored = false;
    referenceOrbit.userData.drawKey = "";
    referenceSwingUntil = mode === "relative" ? now + 900 : 0;
    syncReferenceButton();
    if (currentWindow) update(currentWindow, currentMs, focus, mode === "relative" ? "reference" : true);
  });
  syncReferenceButton();
  document.getElementById("zoomInBtn").addEventListener("click", () => {
    auto = false; camera.position.sub(controls.target).multiplyScalar(.8).add(controls.target); controls.update(); stage.dataset.cameraMode = "manual";
  });
  document.getElementById("zoomOutBtn").addEventListener("click", () => {
    auto = false; camera.position.sub(controls.target).multiplyScalar(1.25).add(controls.target); controls.update(); stage.dataset.cameraMode = "manual";
  });

  function animate() {
    requestAnimationFrame(animate);
    if (auto && currentWindow) {
      const direction = mode === "relative" ? relativeEye : eciEye.clone().normalize();
      controls.target.lerp(preferredTarget, mode === "relative" ? .12 : 1);
      const swing = mode === "relative" && performance.now() < referenceSwingUntil;
      camera.position.lerp(direction.clone().multiplyScalar(desiredDistance).add(preferredTarget), mode === "relative" ? swing ? .055 : .12 : 1);
      if (mode === "relative" && positions.B && positions[focus]) {
        const clearance = Math.min(earthClearance(positions.B, camera.position), earthClearance(positions[focus], camera.position));
        if (clearance < .05) camera.position.copy(direction).multiplyScalar(desiredDistance).add(preferredTarget);
      }
      camera.lookAt(controls.target);
    }
    controls.update();
    if (auto && mode === "relative" && positions.B && positions[focus]) {
      camera.updateMatrixWorld(true);
      const pairInside = () => [positions.B, positions[focus]].every(point => {
        const projected = point.clone().project(camera);
        const x = (projected.x + 1) * mount.clientWidth / 2;
        const y = (1 - projected.y) * mount.clientHeight / 2;
        return x >= 8 && x <= mount.clientWidth - 8 && y >= 8 && y <= mount.clientHeight - 8 && projected.z < 1 && !earthOccludes(point, camera.position);
      });
      if (!pairInside()) {
        camera.position.copy(relativeEye).multiplyScalar(desiredDistance).add(preferredTarget);
        camera.lookAt(controls.target); camera.updateMatrixWorld(true);
        while (!pairInside() && desiredDistance < 100) {
          desiredDistance = Math.min(100, desiredDistance * 1.2);
          camera.position.copy(relativeEye).multiplyScalar(desiredDistance).add(preferredTarget);
          camera.lookAt(controls.target); camera.updateMatrixWorld(true);
        }
        if (!pairInside()) {
          // The chosen relative frame cannot hold the selected pair in view.
          // The full globe is the safer reading of this chapter.
          mode = "eci"; auto = true; followSavedMode = false; syncModeButton();
          update(currentWindow, currentMs, focus, true);
          stage.dataset.cameraFallback = "pair-out-of-frame";
        }
      }
    }
    if (mode === "relative" && relativeEarth.visible) stage.dataset.earthCameraDistance = relativeEarth.position.distanceTo(camera.position).toFixed(4);
    if (mode === "relative" && relativeEarth.visible) {
      relativeEarth.quaternion.slerp(earthTargetQuaternion, .15);
      stage.dataset.earthOrientation = [relativeEarth.quaternion.x, relativeEarth.quaternion.y, relativeEarth.quaternion.z, relativeEarth.quaternion.w].map(value => value.toFixed(3)).join(",");
    }
    const width = mount.clientWidth, height = mount.clientHeight;
    const screen = {}, rendered = [], occludedSlots = [];
    for (const item of episode.participants) {
      const point = positions[item.slot], label = labels[item.slot];
      if (!point || label.hidden) continue;
      const projected = point.clone().project(camera);
      const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
      screen[item.slot] = { x, y };
      const inside = x >= 8 && x <= width - 8 && y >= 8 && y <= height - 8 && projected.z < 1;
      const occluded = earthOccludes(point, camera.position);
      label.classList.toggle("is-occluded", occluded);
      label.style.visibility = inside && !occluded && !(options.tableMini && item.slot === "C") ? "visible" : "hidden";
      markers[item.slot].visible = inside && !occluded && !(options.tableMini && item.slot === "C");
      markers[item.slot].material.opacity = options.tableMini ? 1 : item.slot !== "B" && item.slot !== focus ? .3 : 1;
      if (inside && !occluded) rendered.push(item.slot);
      if (occluded) occludedSlots.push(item.slot);
    }
    const panelRect = document.getElementById("panelColumn").getBoundingClientRect();
    const stageRect = mount.getBoundingClientRect();
    const panelRight = panelRect.right - stageRect.left;
    const placed = [];
    for (const slot of ["B", focus, focus === "A" ? "C" : "A"]) {
      const dot = screen[slot], label = labels[slot];
      if (!dot || label.style.visibility === "hidden") continue;
      const labelWidth = label.offsetWidth || 90, labelHeight = label.offsetHeight || 14;
      const candidates = [];
      for (const side of ["right", "left"]) for (const dy of [0, -18, 18]) {
        const left = side === "right" ? dot.x + 10 : dot.x - labelWidth - 10;
        const top = dot.y + dy - labelHeight / 2;
        const box = { left, right: left + labelWidth, top, bottom: top + labelHeight };
        let score = Math.abs(dy) * .15;
        if (labelPlacement[slot]) {
          if (side !== labelPlacement[slot].side) score += 80;
          if (dy !== labelPlacement[slot].dy) score += 18;
        }
        if (box.left < 8 || box.right > width - 8 || box.top < 8 || box.bottom > height - 8) score += 1000;
        if (box.left < panelRight + 8 && box.bottom > panelRect.top - stageRect.top && box.top < panelRect.bottom - stageRect.top) score += 400;
        for (const other of placed) if (box.left < other.right + 5 && box.right > other.left - 5 && box.top < other.bottom + 5 && box.bottom > other.top - 5) score += 200;
        for (const [otherSlot, otherDot] of Object.entries(screen)) if (otherSlot !== slot && otherDot.x > box.left - 8 && otherDot.x < box.right + 8 && otherDot.y > box.top - 7 && otherDot.y < box.bottom + 7) score += 30;
        candidates.push({ side, dy, box, score });
      }
      candidates.sort((a, b) => a.score - b.score);
      const chosen = candidates[0];
      label.style.left = `${chosen.box.left}px`; label.style.top = `${(chosen.box.top + chosen.box.bottom) / 2}px`;
      label.style.transform = "translateY(-50%)"; label.dataset.side = chosen.side;
      labelPlacement[slot] = { side: chosen.side, dy: chosen.dy };
      placed.push(chosen.box);
    }
    const pairOverlap = screen.A && screen.C && Math.hypot(screen.A.x - screen.C.x, screen.A.y - screen.C.y) < 22;
    for (const slot of ["A", "C"]) {
      const inactive = slot !== focus;
      markers[slot].scale.setScalar(markerScale);
      markers[slot].renderOrder = pairOverlap && inactive ? 9 : 10;
    }
    if (options.tableMini) {
      const pulse = miniHover && !miniReducedMotion.matches ? 1 + .32 * (.5 + .5 * Math.sin(performance.now() / 180)) : 1;
      for (const marker of Object.values(markers)) marker.scale.set(markerScale * pulse, markerScale * pulse, 1);
    }
    for (const item of episode.participants) {
      const trail = trails[item.slot], point = positions[item.slot];
      if (!trail.visible || !point) continue;
      const position = trail.geometry.getAttribute("position"), next = trail.geometry.getAttribute("next");
      if (!position || position.count < 4 || !next) continue;
      for (const index of [position.count - 2, position.count - 1]) position.setXYZ(index, point.x, point.y, point.z);
      for (const index of [next.count - 4, next.count - 3, next.count - 2, next.count - 1]) next.setXYZ(index, point.x, point.y, point.z);
      position.needsUpdate = true; next.needsUpdate = true;
    }
    stage.dataset.rendered = rendered.join("");
    stage.dataset.occluded = occludedSlots.join("");
    stage.dataset.cameraPosition = camera.position.toArray().map(value => value.toFixed(3)).join(",");
    stage.dataset.chaserOpacity = String(markers.A.material.opacity.toFixed(2)) + "," + String(markers.C.material.opacity.toFixed(2));
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
  return {
    update,
    getMarkerPositions() { return Object.entries(markers).map(([slot, marker]) => {
      const point = marker.position.clone().project(camera);
      return { slot, x: (point.x + 1) / 2, y: (1 - point.y) / 2,
        visible: marker.visible && point.z >= -1 && point.z <= 1,
        color: slot === "B" ? "#a9a9a9" : "#eaaa00", opacity: marker.material.opacity };
    }); },
    setMiniTleAnchor(ms) {
      if (!options.tableMini) return;
      miniTleAnchorMs = ms;
      orbitSourceKey = "";
      referenceOrbit.userData.drawKey = "";
      lastTrailPaint = 0;
    },
    lockMiniCamera(view = null) {
      if (!options.tableMini || mode !== "relative") return;
      auto = false;
      followSavedMode = false;
      if (view?.position?.length === 3 && view?.target?.length === 3) {
        camera.position.fromArray(view.position);
        controls.target.fromArray(view.target);
        if (view.up?.length === 3) camera.up.fromArray(view.up);
        camera.fov = view.fieldOfViewDeg || camera.fov;
        camera.zoom = view.zoom || 1;
        camera.updateProjectionMatrix();
        camera.lookAt(controls.target);
      }
      controls.update();
      stage.dataset.cameraMode = "fixed-mini";
    },
    setMiniHover(value) {
      if (!options.tableMini) return;
      miniHover = !!value;
      const color = miniHover ? miniEarthHover : miniEarthRest;
      earthSurface.material.color.setHex(color);
      relativeEarthSurface.material.color.setHex(color);
    },
    motionPreview(window, middle, selected, spanMinutes) {
      const half = spanMinutes * 60000 / 2, rect = renderer.domElement.getBoundingClientRect();
      const panel = document.getElementById("panelColumn")?.getBoundingClientRect();
      const left = panel && panel.right > rect.left && panel.left < rect.right && panel.top < rect.bottom
        ? Math.min(rect.right - 12, Math.max(rect.left, panel.right + 8)) : rect.left;
      const bounds = { left, top: rect.top, right: rect.right, bottom: rect.bottom };
      camera.updateMatrixWorld(true);
      const sampleCount = 49, midpoint = (sampleCount - 1) / 2;
      const start = Date.parse(window.start), end = Date.parse(window.end);
      const frames = Array.from({ length: sampleCount }, (_, index) => {
        const ms = Math.max(start, Math.min(end, middle + half * (index - midpoint) / midpoint));
        return frameAt(window, ms);
      });
      const series = episode.participants.map(item => ({ slot: item.slot, label: names[item.slot],
        color: item.slot === "B" ? "#686868" : item.slot === selected ? "#b48700" : "#8b806d",
        primary: item.slot === "B" || item.slot === selected,
        points: frames.map(frame => {
          const body = frame[item.slot];
          const reference = referenceMode === "target" ? frame.B : frame[selected];
          if (!body || mode === "relative" && !reference) return null;
          const point = mode === "relative" ? relativePoint(reference, body, referenceAxes(reference)) : toScene(body.position);
          const projected = point.project(camera), x = rect.left + (projected.x + 1) * rect.width / 2, y = rect.top + (1 - projected.y) * rect.height / 2;
          return { x, y, inside: x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom && projected.z >= -1 && projected.z <= 1,
            visibleDepth: projected.z >= -1 && projected.z <= 1 };
        }) }));
      return { bounds, series };
    },
    getMode() { return mode; },
    setCameraViews(views) { cameraViews = [...views]; indexCameraViews(); },
    useLearnedPath() {
      if (!currentWindow) return;
      auto = true; followSavedMode = true;
      update(currentWindow, currentMs, focus, "path");
    },
    captureCameraView() {
      if (!currentWindow || !Number.isFinite(currentMs)) return null;
      return {
        windowId: currentWindow.id, timeUtc: new Date(currentMs).toISOString(),
        selected: focus, mode, referenceMode, auto,
        position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(),
        fov: camera.fov, zoom: camera.zoom,
      };
    },
  };
}

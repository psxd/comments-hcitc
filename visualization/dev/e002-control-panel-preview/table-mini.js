import { loadCurrentEpisodes, episodeChapters, cleanCospar } from "../../../shared/episode-feed.js?v=4";
import { loadOrbitalPreview, preloadOrbitalElements } from "./orbital-preview.js";
import { createGlobePreview } from "./globe-preview.js?tablemini=10";

const $ = id => document.getElementById(id);
void preloadOrbitalElements().catch(() => {});
const minute = 60000;
let windows = [
  { id: "dec9", label: "December 9, 2019", start: "2019-12-08T17:40:00Z", end: "2019-12-10T05:40:00Z", anchor: "2019-12-09T11:40:00Z", visualAgeHours: 120 },
  { id: "dec30", label: "December 30, 2019", start: "2019-12-29T23:29:00Z", end: "2019-12-31T11:29:00Z", anchor: "2019-12-30T17:29:00Z", visualAgeHours: 120 },
];

async function start() {
  const [episodeBase, catalog, saved, sheet] = await Promise.all([
    fetch("../e002/episode.json").then(response => response.json()),
    fetch("./space-track-e002.json").then(response => response.json()),
    fetch("./saved-camera-views.json").then(response => response.json()),
    loadCurrentEpisodes(),
  ]);
  const published = sheet.episodes.find(row => row.ID === "E-002");
  if (!published) throw new Error("E-002 is absent from the published sheet");
  const sheetChapters = episodeChapters(published);
  if (sheetChapters.length) windows = sheetChapters.map((chapter, index) => ({
    id: ["dec9", "dec30"][index] || chapter.id,
    label: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(chapter.centerMs)),
    start: chapter.start, end: chapter.end, anchor: chapter.center, visualAgeHours: 120,
  }));
  for (const item of episodeBase.participants) {
    if (cleanCospar(published[`Object ${item.slot}`]) !== item.cospar || catalog.records[item.cospar]?.NORAD_CAT_ID !== item.norad) throw new Error(`Published Object ${item.slot} does not match the reviewed orbital record`);
  }
  const episode = { ...episodeBase, windows, maximumDisplayTleAgeHours: 120, maximumStatisticTleAgeHours: 120 };
  const names = Object.fromEntries(episode.participants.map(item => [item.slot, catalog.records[item.cospar].SATNAME]));
  const orbital = await loadOrbitalPreview(episode);
  const originalViews = saved.views || [];
  const globe = createGlobePreview(orbital, episode, names, originalViews, { tableMini: true });
  let active = windows[0], loopStart = Date.parse(active.anchor) - 15 * minute, loopEnd = loopStart + 45 * minute;
  let current = loopStart, playing = true, rate = 150, last = performance.now();
  globe.setMiniTleAnchor((loopStart + loopEnd) / 2);
  const update = force => globe.update(active, current, "A", force);
  update(true);
  const api = {
    get ready() { return true; },
    getMarkerPositions() { return globe.getMarkerPositions(); },
    get windows() { return windows; },
    get window() { return active; },
    get current() { return current; },
    get playing() { return playing; },
    get rate() { return rate; },
    get loopStart() { return loopStart; },
    get loopEnd() { return loopEnd; },
    get frameMode() { return globe.getMode() === "eci" ? "inertial" : "relative"; },
    setHover(value) { globe.setMiniHover(value); },
    setRate(value) { rate = Math.max(60, Math.min(14400, Number(value) || 150)); },
    selectWindow(id) {
      active = windows.find(window => window.id === id) || windows[0];
      loopStart = Date.parse(active.anchor) - 15 * minute; loopEnd = loopStart + 45 * minute;
      current = loopStart; playing = true;
      globe.setMiniTleAnchor((loopStart + loopEnd) / 2);
      globe.setCameraViews(originalViews); update(true); globe.useLearnedPath();
    },
    setTime(ms) { current = Math.max(Date.parse(active.start), Math.min(Date.parse(active.end), Number(ms))); playing = false; update(); },
    setLoop(start, end) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < Date.parse(active.start) || end > Date.parse(active.end) || end - start < minute) throw new Error("Choose a loop of at least one minute inside this chapter.");
      loopStart = start; loopEnd = end; current = Math.max(start, Math.min(end, current)); globe.setMiniTleAnchor((start + end) / 2); update(true);
    },
    setPlaying(value) { if (value && current >= loopEnd) current = loopStart; playing = !!value; },
    toggleFrame() { $("modeBtn").click(); update(true); globe.lockMiniCamera(); },
    zoom(factor) { $(factor >= 1 ? "zoomInBtn" : "zoomOutBtn").click(); },
    resetCamera() { globe.setCameraViews(originalViews); globe.useLearnedPath(); globe.lockMiniCamera(); },
    captureCamera(name = "Dynamic Table mini preview") {
      const view = globe.captureCameraView();
      return { name, timestampUtc: new Date(current).toISOString(), frameMode: view.mode === "eci" ? "inertial" : "relative", position: view.position, target: view.target, up: view.up, fieldOfViewDeg: view.fov, zoom: view.zoom };
    },
    applyCamera(view) {
      const savedView = { id: "dynamic-table-mini", windowId: active.id, timeUtc: view.timestampUtc || new Date(current).toISOString(), selected: "A", mode: view.frameMode === "inertial" ? "eci" : "relative", referenceMode: "target", auto: false, position: view.position, target: view.target, up: view.up, fov: view.fieldOfViewDeg, zoom: view.zoom };
      globe.setCameraViews([savedView]); globe.useLearnedPath(); update(true); globe.lockMiniCamera(view);
    },
    moveComposition(x, y) {
      const view = this.captureCamera();
      const eye = view.position.map((value, index) => value - view.target[index]);
      const length = Math.hypot(...eye) || 1;
      const up = view.up || [0, 1, 0];
      const right = [up[1] * eye[2] - up[2] * eye[1], up[2] * eye[0] - up[0] * eye[2], up[0] * eye[1] - up[1] * eye[0]];
      const rightLength = Math.hypot(...right) || 1;
      const delta = right.map((value, index) => (value / rightLength * x + up[index] * y) * length * .04);
      view.position = view.position.map((value, index) => value + delta[index]);
      view.target = view.target.map((value, index) => value + delta[index]);
      this.applyCamera(view);
    },
  };
  window.miniWorkshop = api;
  parent.postMessage({ type: "espl-e002-mini-ready" }, location.origin);
  requestAnimationFrame(() => { $("miniBoot").hidden = true; });
  function tick(now) {
    requestAnimationFrame(tick);
    const elapsed = Math.min(.1, (now - last) / 1000); last = now;
    if (!playing) return;
    current += elapsed * rate * 1000;
    if (current >= loopEnd) {
      current = loopEnd; playing = false; document.body.classList.add("loop-reset");
      setTimeout(() => { current = loopStart; update(true); document.body.classList.remove("loop-reset"); playing = true; }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300);
    } else update();
  }
  requestAnimationFrame(tick);
}
start().catch(error => { $("miniBootText").textContent = `Mini preview unavailable: ${error.message}`; $("sceneStatus").textContent = `Mini preview unavailable: ${error.message}`; console.error(error); });

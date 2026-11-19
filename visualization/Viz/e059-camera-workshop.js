/* Local E-059 camera review. The published episode does not load this module. */
const $ = id => document.getElementById(id);
const stamp = ms => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms)) + " UTC";
const request = async (url, body) => {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `${response.status}`);
  return response.json();
};

export function mountE059CameraWorkshop(api) {
  const routes = api.chapters.flatMap(chapter => ["B"].flatMap(selected => [selected, "A"].map(referenceSlot => ({ chapter, selected, referenceSlot }))));
  const names = Object.fromEntries(api.participants.map(item => [item.slot, item.name]));
  const trigger = document.createElement("button"); trigger.id = "e059WorkshopToggle"; trigger.type = "button"; trigger.textContent = "Camera workshop";
  trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", "e059Workshop");
  $("e059CommentMode").before(trigger);
  const pane = document.createElement("aside"); pane.id = "e059Workshop"; pane.className = "e059-workshop"; pane.hidden = true;
  pane.innerHTML = `<div class="e059-workshop-main">
      <div class="e059-workshop-config"><div class="e059-workshop-head"><h2>Camera workshop</h2><button id="e059WorkshopClose" type="button" aria-label="Close camera workshop">×</button></div><label>Configuration<select id="e059WorkshopRoute"></select></label></div>
      <div class="e059-workshop-timeline"><strong id="e059WorkshopTime"></strong><input id="e059WorkshopSeek" type="range" min="0" step="1" aria-label="Scrub through this chapter"><div class="e059-workshop-row"><label>Review stops<select id="e059WorkshopStops"><option value="120">2 hours</option><option value="60">1 hour</option><option value="240">4 hours</option></select></label><label>Speed<select id="e059WorkshopSpeed"><option value="10">10 min/s</option><option value="20">20 min/s</option><option value="40" selected>40 min/s</option><option value="80">80 min/s</option><option value="120">120 min/s</option><option value="240">240 min/s</option></select></label></div></div>
      <div class="e059-workshop-review"><label>Path around this moment<select id="e059WorkshopSpan"><option value="30">±15 min</option><option value="60">±30 min</option><option value="120" selected>±1 hour</option><option value="240">±2 hours</option><option value="480">±4 hours</option></select></label><div class="e059-workshop-actions"><button id="e059WorkshopPrevious" type="button">Previous</button><button id="e059WorkshopPlay" type="button">Play to next</button><button id="e059WorkshopNext" type="button">Next</button></div><p id="e059WorkshopPathKey">Past dashed · future solid · Frame the pair.</p></div>
      <div class="e059-workshop-save"><label>Camera note<textarea id="e059WorkshopNote" rows="1" maxlength="4000" placeholder="What should this view show?"></textarea></label><div class="e059-workshop-actions e059-workshop-save-actions"><button id="e059WorkshopSave" type="button">Save angle</button><button id="e059WorkshopSaveNext" type="button">Save & next</button><button id="e059WorkshopExport" type="button">Export</button></div></div>
    </div>
    <details class="e059-workshop-more"><summary>Key moments and saved views</summary><div class="e059-workshop-row"><input id="e059WorkshopMomentName" maxlength="120" placeholder="Name a key moment"><button id="e059WorkshopAddMoment" type="button">Add here</button></div><div id="e059WorkshopMoments" class="e059-workshop-list"></div><strong id="e059WorkshopViewTitle">Saved camera views</strong><div id="e059WorkshopViews" class="e059-workshop-list"></div></details>
    <p id="e059WorkshopStatus" role="status"></p>`;
  document.body.append(pane);
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg"); overlay.id = "e059WorkshopPaths"; overlay.setAttribute("aria-hidden", "true"); document.body.append(overlay);
  const routeSelect = $("e059WorkshopRoute"), seek = $("e059WorkshopSeek");
  const routeName = route => `${stamp(route.chapter.centerMs)} · ${names[route.selected]} · ${route.referenceSlot === "A" ? names.A : names[route.selected]} centered`;
  routes.forEach((route, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = routeName(route); routeSelect.append(option); });
  const initial = api.getState();
  let routeIndex = Math.max(0, routes.findIndex(route => route.chapter.id === initial.chapterId && route.selected === initial.selected && route.referenceSlot === initial.referenceSlot));
  let minute = Math.max(0, Math.min(Math.round((routes[routeIndex].chapter.endMs - routes[routeIndex].chapter.startMs) / 60000), Math.round((initial.current - routes[routeIndex].chapter.startMs) / 60000)));
  let views = [], moments = [], playing = false, frame = 0, previousFrame = 0, lastPaint = 0, guideFrame = 0, lastGuideSignature = "", lastListRoute = -1;
  const route = () => routes[routeIndex];
  const length = () => Math.round((route().chapter.endMs - route().chapter.startMs) / 60000);
  const time = () => route().chapter.startMs + minute * 60000;
  const matches = item => item.chapterId === route().chapter.id && item.selected === route().selected && item.referenceSlot === route().referenceSlot;
  const status = message => { $("e059WorkshopStatus").textContent = message; };
  const stop = () => { playing = false; cancelAnimationFrame(frame); frame = 0; previousFrame = 0; $("e059WorkshopPlay").textContent = "Play to next"; };
  const writeUrl = (data, name) => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  function setMinute(next, preserveCamera = true) {
    minute = Math.max(0, Math.min(length(), next));
    api.seek(time(), preserveCamera);
    render();
  }
  function nextStop(direction = 1) {
    const every = Number($("e059WorkshopStops").value);
    const stops = [0, Math.round((route().chapter.centerMs - route().chapter.startMs) / 60000), length(), ...moments.filter(item => item.surface === "E-059" && item.windowId === route().chapter.id && item.selected === route().selected && item.referenceMode === route().referenceSlot).map(item => Math.round((Date.parse(item.timeUtc) - route().chapter.startMs) / 60000))];
    for (let value = every; value < length(); value += every) stops.push(value);
    stops.sort((a, b) => a - b);
    const found = direction > 0 ? stops.find(value => value > minute + .01) : stops.reverse().find(value => value < minute - .01);
    return found ?? null;
  }
  function switchRoute(index) {
    stop();
    const prior = api.captureCamera();
    routeIndex = Math.max(0, Math.min(routes.length - 1, index));
    minute = Math.max(0, Math.min(length(), Math.round((route().chapter.centerMs - route().chapter.startMs) / 60000)));
    api.setRoute(route(), time(), prior);
    render(); renderLists(); status("The previous camera frame was carried into this configuration. Adjust it if needed.");
  }
  function renderLists() {
    const viewList = $("e059WorkshopViews"); viewList.replaceChildren();
    const routeViews = views.filter(matches);
    $("e059WorkshopViewTitle").textContent = `Saved camera views here (${routeViews.length})`;
    for (const view of routeViews.slice().reverse()) {
      const row = document.createElement("div"), jump = document.createElement("button"), edit = document.createElement("button"), remove = document.createElement("button");
      row.className = "e059-workshop-entry"; jump.type = edit.type = remove.type = "button";
      jump.textContent = `${stamp(Date.parse(view.timeUtc))} · ${names[view.selected]} · ${view.referenceSlot === "A" ? names.A : names[view.selected]} centered`;
      jump.title = view.note || "Open saved camera angle";
      jump.addEventListener("click", () => { const index = routes.findIndex(item => item.chapter.id === view.chapterId && item.selected === view.selected && item.referenceSlot === view.referenceSlot); if (index < 0) return; stop(); routeIndex = index; minute = Math.round((Date.parse(view.timeUtc) - route().chapter.startMs) / 60000); api.setRoute(route(), time(), view); $("e059WorkshopNote").value = view.note || ""; render(); });
      edit.textContent = "Edit note"; edit.addEventListener("click", async () => { const note = prompt("Camera view note", view.note || ""); if (note === null) return; try { views = (await request("/api/e059-camera-views", { action: "annotate", id: view.id, note })).views; renderLists(); } catch (error) { status(error.message); } });
      remove.textContent = "Delete"; remove.addEventListener("click", async () => { try { views = (await request("/api/e059-camera-views", { action: "delete", id: view.id })).views; api.setSavedCameraViews(views); renderLists(); } catch (error) { status(error.message); } });
      row.append(jump, edit, remove); viewList.append(row);
    }
    if (!routeViews.length) viewList.textContent = "No saved angles for this configuration yet.";
    const momentList = $("e059WorkshopMoments"); momentList.replaceChildren();
    for (const item of moments.filter(item => item.surface === "E-059" && item.windowId === route().chapter.id && item.selected === route().selected && item.referenceMode === route().referenceSlot)) {
      const row = document.createElement("div"), jump = document.createElement("button"), remove = document.createElement("button");
      row.className = "e059-workshop-entry"; jump.type = remove.type = "button"; jump.textContent = `${item.label} · ${stamp(Date.parse(item.timeUtc))}`;
      jump.addEventListener("click", () => { stop(); setMinute(Math.round((Date.parse(item.timeUtc) - route().chapter.startMs) / 60000)); $("e059WorkshopSpan").value = String(item.spanMinutes); });
      remove.textContent = "Delete"; remove.addEventListener("click", async () => { try { moments = (await request("/api/camera-moments", { action: "delete", id: item.id })).moments; renderLists(); } catch (error) { status(error.message); } });
      row.append(jump, remove); momentList.append(row);
    }
  }
  function render() {
    routeSelect.value = String(routeIndex); seek.max = String(length()); seek.value = String(Math.round(minute));
    $("e059WorkshopTime").textContent = `${stamp(time())} · ${Math.round(minute)} / ${length()} min`;
    $("e059WorkshopPrevious").disabled = nextStop(-1) === null && routeIndex === 0;
    $("e059WorkshopNext").disabled = nextStop() === null && routeIndex === routes.length - 1;
    if (lastListRoute !== routeIndex) { lastListRoute = routeIndex; renderLists(); }
    scheduleGuide();
  }
  function scheduleGuide() { if (pane.hidden || guideFrame) return; guideFrame = requestAnimationFrame(() => { guideFrame = 0; drawGuide(); }); }
  function drawGuide() {
    if (pane.hidden) return;
    const snapshot = api.captureCamera();
    const signature = `${routeIndex}:${minute.toFixed(1)}:${$("e059WorkshopSpan").value}:${snapshot.position.map(value => value.toFixed(3))}:${snapshot.target.map(value => value.toFixed(3))}:${snapshot.zoom.toFixed(3)}`;
    if (signature === lastGuideSignature) return;
    lastGuideSignature = signature; overlay.replaceChildren();
    const data = api.pathGuide(route(), time(), Number($("e059WorkshopSpan").value));
    if (!data) return;
    const rect = api.sceneRect(), width = rect.width, height = rect.height;
    overlay.style.left = `${rect.left}px`; overlay.style.top = `${rect.top}px`; overlay.style.width = `${width}px`; overlay.style.height = `${height}px`; overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const svg = (tag, attributes) => { const node = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value))); overlay.append(node); return node; };
    let out = 0;
    for (const track of data) {
      const mid = Math.floor(track.points.length / 2);
      if (track.primary && track.points.some(point => !point.inside)) out++;
      for (const [points, dash, opacity] of [[track.points.slice(0, mid + 1), "5 5", .72], [track.points.slice(mid), "", .88]]) {
        const d = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
        if (!d.includes("L")) continue;
        svg("path", { d, fill: "none", stroke: "#fff", "stroke-width": track.primary ? 4.8 : 3, opacity, "stroke-dasharray": dash });
        svg("path", { d, fill: "none", stroke: track.color, "stroke-width": track.primary ? 2.8 : 1.4, opacity, "stroke-dasharray": dash });
      }
      for (const index of [0, track.points.length - 1]) {
        const point = track.points[index]; if (!point) continue;
        svg("circle", { cx: Math.max(5, Math.min(width - 5, point.x)), cy: Math.max(5, Math.min(height - 5, point.y)), r: track.primary ? 4 : 2.5, fill: "#fff", stroke: track.color, "stroke-width": 1.5, opacity: track.primary ? 1 : .5 });
      }
    }
    $("e059WorkshopPathKey").textContent = `Past dashed · future solid · ${out ? `${out} path${out > 1 ? "s" : ""} off screen` : "Pair fits"}.`;
  }
  function play() {
    if (playing) { stop(); status("Paused at this moment."); return; }
    const destination = nextStop(); if (destination === null) { status("End of this configuration. Choose the next one."); return; }
    api.useLearnedPath();
    playing = true; $("e059WorkshopPlay").textContent = "Pause here";
    const tick = now => {
      if (!playing) return;
      if (previousFrame) minute = Math.min(destination, minute + Math.min(100, now - previousFrame) * Number($("e059WorkshopSpeed").value) / 1000);
      previousFrame = now;
      if (now - lastPaint > 75 || minute >= destination) { api.seek(time(), true); render(); lastPaint = now; }
      if (minute >= destination) { stop(); status("Review stop reached. Save an angle if this framing needs correction."); }
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }
  async function save() {
    const camera = api.captureCamera();
    try {
      views = (await request("/api/e059-camera-views", { action: "add", view: { chapterId: route().chapter.id, timeUtc: new Date(time()).toISOString(), selected: route().selected, referenceSlot: route().referenceSlot, ...camera, note: $("e059WorkshopNote").value } })).views;
      api.setSavedCameraViews(views); renderLists(); status("Camera angle saved locally. Export views when you are ready to share them."); return true;
    } catch (error) { status(`Could not save angle: ${error.message}`); return false; }
  }
  trigger.addEventListener("click", () => {
    pane.hidden = !pane.hidden; trigger.setAttribute("aria-expanded", String(!pane.hidden));
    if (!pane.hidden) {
      const state = api.getState();
      const index = routes.findIndex(item => item.chapter.id === state.chapterId && item.selected === state.selected && item.referenceSlot === state.referenceSlot);
      if (index >= 0) routeIndex = index;
      minute = Math.max(0, Math.min(length(), Math.round((state.current - route().chapter.startMs) / 60000)));
      api.pause(); api.setRoute(route(), time(), api.captureCamera()); api.useLearnedPath();
      lastGuideSignature = ""; render(); status("Scrub or play each short interval, adjust the camera, then save the angle.");
    } else { stop(); overlay.replaceChildren(); lastGuideSignature = ""; }
  });
  $("e059WorkshopClose").addEventListener("click", () => trigger.click());
  routeSelect.addEventListener("change", () => switchRoute(Number(routeSelect.value)));
  seek.addEventListener("input", () => { stop(); setMinute(Number(seek.value)); });
  $("e059WorkshopPrevious").addEventListener("click", () => { stop(); const previous = nextStop(-1); if (previous !== null) setMinute(previous); else if (routeIndex) switchRoute(routeIndex - 1); });
  $("e059WorkshopNext").addEventListener("click", () => { stop(); const next = nextStop(); if (next !== null) setMinute(next); else if (routeIndex < routes.length - 1) switchRoute(routeIndex + 1); });
  $("e059WorkshopPlay").addEventListener("click", play);
  $("e059WorkshopStops").addEventListener("change", render);
  $("e059WorkshopSpan").addEventListener("change", scheduleGuide);
  $("e059WorkshopSave").addEventListener("click", () => { stop(); void save(); });
  $("e059WorkshopSaveNext").addEventListener("click", async () => { stop(); if (await save()) { const next = nextStop(); if (next !== null) setMinute(next); else if (routeIndex < routes.length - 1) switchRoute(routeIndex + 1); } });
  $("e059WorkshopExport").addEventListener("click", () => writeUrl({ schema: "espl-e059-camera-views-v1", views, moments: moments.filter(item => item.surface === "E-059") }, "e059-saved-camera-views.json"));
  $("e059WorkshopAddMoment").addEventListener("click", async () => {
    try { moments = (await request("/api/camera-moments", { action: "add", moment: { surface: "E-059", windowId: route().chapter.id, selected: route().selected, referenceMode: route().referenceSlot, mode: "relative", timeUtc: new Date(time()).toISOString(), label: $("e059WorkshopMomentName").value, note: "", spanMinutes: Number($("e059WorkshopSpan").value) } })).moments; $("e059WorkshopMomentName").value = ""; renderLists(); render(); status("Key moment added."); }
    catch (error) { status(`Could not add key moment: ${error.message}`); }
  });
  Promise.all([request("/api/e059-camera-views"), request("/api/camera-moments")]).then(([a, b]) => { views = a.views || []; moments = b.moments || []; api.setSavedCameraViews(views); renderLists(); render(); }).catch(error => status(`Camera records unavailable: ${error.message}`));
  let guidePaint = 0;
  const followCamera = now => { requestAnimationFrame(followCamera); if (!pane.hidden && now - guidePaint > 180 && !playing) { drawGuide(); guidePaint = now; } };
  requestAnimationFrame(followCamera);
  render();
}

// A guided, local-only tour of every chapter, chaser, and relative-frame origin.
// The playback bar supplies every intervening minute; stops invite camera examples.
const STORAGE_KEY = "espl-e002-camera-workshop-v2";
const $ = id => document.getElementById(id);
const utc = ms => new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(ms)) + " UTC";

export function createCameraWorkshop({ windows, names, seekRoute, setMinute, pausePlayback, useLearnedPath, saveView, getViews, getPlaybackSpeed, getMode, saveSpeedNote, beforeOpen, getMoments = () => [], addMoment = null, deleteMoment = null, motionPreview = null, reviewRoutes = null, routeLabel = null, storageKey = STORAGE_KEY, defaultMotionSpanMinutes = 30, maxKeyRunMinutes = 360 }) {
  const routes = reviewRoutes || windows.flatMap(window => ["A", "C"].flatMap(slot => ["target", "chaser"].map(reference => ({ window, slot, reference }))));
  const matchesRoute = (view, route) => view.windowId === route.window.id && view.selected === route.slot && view.referenceMode === route.reference && (!route.viewMode || view.mode === route.viewMode);
  const routeMoments = route => getMoments().filter(moment => matchesRoute(moment, route));
  const duration = route => Math.round((Date.parse(route.window.end) - Date.parse(route.window.start)) / 60000);
  const allowedIntervals = ["key", 30, 60, 120, 180, 360, 720];
  let interval = "key", cursor = { route: 0, minute: 0 }, active = false, busy = false, playing = false, frame = null;
  let momentSignature = "";
  const motionLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  motionLayer.classList.add("workshop-motion-layer"); motionLayer.setAttribute("aria-hidden", "true"); document.body.append(motionLayer);
  const saved = (() => {
    try {
      const current = localStorage.getItem(storageKey);
      const data = JSON.parse(current || (storageKey === STORAGE_KEY ? localStorage.getItem("espl-e002-camera-workshop-v1") : null) || "null");
      if (!data || !Number.isInteger(data.route) || data.route < 0 || data.route >= routes.length || !Number.isFinite(data.minute)) return null;
      return { route: data.route, minute: Math.max(0, Math.min(duration(routes[data.route]), data.minute)), interval: current && allowedIntervals.includes(data.interval) ? data.interval : "key" };
    } catch { return null; }
  })();
  if (saved) { cursor = { route: saved.route, minute: saved.minute }; interval = saved.interval; }
  $("workshopInterval").value = String(interval);
  $("workshopMomentSpan").value = String(defaultMotionSpanMinutes);
  $("workshopSpeed").value = String(getPlaybackSpeed(routes[0]));

  const routeName = routeLabel || (route => `${route.window.chapterShort || route.window.id} · ${names[route.slot]} · ${route.reference === "target" ? names.B : names[route.slot]} centered`);
  const routeSelect = $("workshopRouteSelect");
  routes.forEach((route, index) => {
    const option = document.createElement("option"); option.value = String(index); option.textContent = routeName(route); routeSelect.append(option);
  });

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({ ...cursor, interval })); } catch { /* The tour still works without storage. */ }
  }
  function status(text) { $("workshopStatus").textContent = text; }
  function stopPlaying() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; playing = false; busy = false;
  }
  function stops(route) {
    const end = duration(route), start = Date.parse(route.window.start);
    const added = routeMoments(route).map(moment => Math.round((Date.parse(moment.timeUtc) - start) / 60000));
    if (interval !== "key") {
      const minutes = [];
      for (let minute = 0; minute < end; minute += interval) minutes.push(minute);
      minutes.push(end, ...added); return [...new Set(minutes.map(minute => Math.max(0, Math.min(end, minute))))].sort((a, b) => a - b);
    }
    // Divide long GEO chapters into short optional review runs. The author can
    // still play a whole configuration without stopping at each point.
    const maximumRun = maxKeyRunMinutes;
    const minutes = [0, Math.round((Date.parse(route.window.anchor || route.window.start) - start) / 60000), end, ...added];
    for (let minute = maximumRun; minute < end; minute += maximumRun) minutes.push(minute);
    const views = getViews().filter(view => matchesRoute(view, route))
      .sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
    for (let index = 1; index < views.length; index++) if (views[index].mode !== views[index - 1].mode) {
      minutes.push(Math.round((Date.parse(views[index].timeUtc) - start) / 60000));
    }
    return [...new Set(minutes.map(minute => Math.max(0, Math.min(end, minute))))].sort((a, b) => a - b);
  }
  function coverage() {
    const views = getViews();
    let covered = 0, total = 0;
    for (const route of routes) {
      const reviewMinutes = stops(route), start = Date.parse(route.window.start);
      const matches = views.filter(view => matchesRoute(view, route));
      for (const minute of reviewMinutes) {
        total++;
        if (matches.some(view => Math.abs(Date.parse(view.timeUtc) - (start + minute * 60000)) <= (interval === "key" ? 60 : interval / 2) * 60000)) covered++;
      }
    }
    return { covered, total };
  }
  function renderMoments() {
    const route = routes[cursor.route], items = routeMoments(route);
    const signature = `${cursor.route}:${items.map(item => `${item.id}:${item.label}:${item.timeUtc}`).join("|")}`;
    if (signature === momentSignature) return;
    momentSignature = signature;
    const list = $("workshopMomentList"); list.replaceChildren();
    if (!items.length) { list.textContent = "No added moments in this configuration."; return; }
    for (const item of items.sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc))) {
      const row = document.createElement("div"), jump = document.createElement("button"), remove = document.createElement("button");
      const minute = Math.round((Date.parse(item.timeUtc) - Date.parse(route.window.start)) / 60000);
      jump.type = remove.type = "button"; jump.textContent = `${item.label} · ${utc(Date.parse(item.timeUtc))}`;
      jump.title = item.note || "Jump to this key moment";
      jump.addEventListener("click", () => { if ([...$("workshopMomentSpan").options].some(option => Number(option.value) === item.spanMinutes)) $("workshopMomentSpan").value = String(item.spanMinutes); void seek({ route: cursor.route, minute }); });
      remove.textContent = "×"; remove.setAttribute("aria-label", `Remove ${item.label}`);
      remove.addEventListener("click", async () => { try { await deleteMoment?.(item.id); momentSignature = ""; render(); status("Key moment removed."); } catch (error) { status(`Could not remove moment: ${error.message}`); } });
      row.append(jump, remove); list.append(row);
    }
  }
  function renderMotion() {
    motionLayer.replaceChildren();
    if (!active || $("cameraWorkshop").hidden || !motionPreview) return;
    const span = Number($("workshopMomentSpan").value);
    const half = span / 2, halfShort = half >= 60 ? `${half / 60}h` : `${half}m`, halfLong = half >= 60 ? `${half / 60} ${half === 60 ? "hour" : "hours"}` : `${half} minutes`;
    const preview = motionPreview(routes[cursor.route], cursor.minute, span);
    if (!preview?.series?.length) return;
    motionLayer.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);
    const svg = (tag, attributes, parent = motionLayer) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      parent.append(node); return node;
    };
    const bounds = preview.bounds || { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const clipId = "workshop-motion-clip";
    const defs = svg("defs", {}), clip = svg("clipPath", { id: clipId }, defs);
    svg("rect", { x: bounds.left, y: bounds.top, width: Math.max(1, bounds.right - bounds.left), height: Math.max(1, bounds.bottom - bounds.top) }, clip);
    const tracks = svg("g", { "clip-path": `url(#${clipId})` });
    const clamp = point => ({ x: Math.max(bounds.left + 9, Math.min(bounds.right - 9, point.x)), y: Math.max(bounds.top + 9, Math.min(bounds.bottom - 9, point.y)) });
    const path = points => {
      let restart = true;
      return points.map(point => {
        if (!point?.visibleDepth) { restart = true; return ""; }
        const command = restart ? "M" : "L"; restart = false;
        return `${command}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      }).join(" ");
    };
    let outside = 0;
    for (const series of preview.series) {
      const points = series.points.map(point => point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null);
      if (series.primary && points.some(point => point && !point.inside)) outside++;
      const middle = Math.floor((points.length - 1) / 2), now = points[middle];
      for (const [segment, dash, opacity] of [[points.slice(0, middle + 1), "5 4", series.primary ? .74 : .3], [points.slice(middle), "", series.primary ? .88 : .36]]) {
        const data = path(segment);
        if (!data.includes("L")) continue;
        const common = { d: data, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": dash };
        svg("path", { ...common, stroke: "#fff", "stroke-width": series.primary ? 4.4 : 3, opacity: opacity * .9 }, tracks);
        svg("path", { ...common, stroke: series.color, "stroke-width": series.primary ? 2.3 : 1.5, opacity }, tracks);
      }
      if (now?.visibleDepth) {
        const current = clamp(now);
        svg("circle", { cx: current.x, cy: current.y, r: series.primary ? 4.8 : 3.2, fill: "#fff", stroke: series.color, "stroke-width": 2, opacity: series.primary ? 1 : .5 }, tracks);
      }
      for (const [index, sign] of [[0, "−"], [points.length - 1, "+"]]) {
        const point = points[index]; if (!point?.visibleDepth) continue;
        const end = clamp(point), distant = !now || Math.hypot(end.x - now.x, end.y - now.y) > 12;
        if (!distant) continue;
        svg(point.inside ? "circle" : "rect", point.inside ? { cx: end.x, cy: end.y, r: series.primary ? 4.1 : 3, fill: "#fff", stroke: series.color, "stroke-width": 1.7, opacity: series.primary ? .9 : .5 } : { x: end.x - 4, y: end.y - 4, width: 8, height: 8, fill: "#fff", stroke: series.color, "stroke-width": 1.7 }, tracks);
        if (series.primary && series.slot === routes[cursor.route].slot && now && Math.hypot(end.x - now.x, end.y - now.y) > 45) {
          const label = svg("text", { x: end.x + (index ? -8 : 8), y: end.y - 8, fill: series.color, "font-size": 10, "font-weight": 700, "text-anchor": index ? "end" : "start" }, tracks);
          label.textContent = `${sign}${halfShort}${point.inside ? "" : " · edge"}`;
        }
      }
    }
    $("workshopMotionStatus").textContent = `Full path over ±${halfLong}: dashed = past, solid = future.${outside ? ` ${outside} main ${outside === 1 ? "path leaves" : "paths leave"} the frame; widen the zoom or move the camera.` : ""}`;
  }
  function render() {
    const route = routes[cursor.route], end = duration(route);
    $("cameraWorkshop").classList.toggle("has-started", active);
    $("workshopRoute").textContent = `Run ${cursor.route + 1} of ${routes.length} · ${routeName(route)}`;
    $("workshopTime").textContent = `${utc(Date.parse(route.window.start) + cursor.minute * 60000)} · ${Math.floor(cursor.minute)} of ${end} minutes`;
    const { covered, total } = coverage();
    const adjusted = getViews().filter(view => view.auto === false).length;
    $("workshopProgress").textContent = `${adjusted} saved camera angles · up to ${maxKeyRunMinutes / 60}-hour review sections`;
    $("workshopProgress").title = `${covered} of ${total} optional review points have a saved camera angle nearby`;
    $("workshopMinute").max = String(end);
    $("workshopMinute").value = String(Math.floor(cursor.minute));
    routeSelect.value = String(cursor.route);
    $("workshopPrevious").disabled = !active || busy || (cursor.route === 0 && cursor.minute === 0);
    for (const id of ["workshopNext", "workshopPlayRun", "workshopSavePlay", "workshopRouteSelect", "workshopInterval"]) $(id).disabled = !active || busy;
    // The review timeline stays available while a run plays; dragging it pauses at that minute.
    $("workshopMinute").disabled = !active || (busy && !playing);
    $("workshopPlay").disabled = !active || (busy && !playing);
    $("workshopStart").disabled = busy;
    $("workshopResume").disabled = busy || (!active && !saved && !localStorage.getItem(storageKey));
    $("workshopPlay").textContent = playing ? "Pause here" : "Play to next stop";
    $("workshopSaveSpeed").disabled = !active || busy;
    $("workshopAddMoment").disabled = !active || (busy && !playing);
    renderMoments();
  }
  function open() {
    beforeOpen?.();
    pausePlayback();
    $("cameraWorkshop").hidden = false;
    $("workshopToggle").setAttribute("aria-expanded", "true");
    document.body.classList.add("workshop-open");
    render();
  }
  function peek(value) {
    $("cameraWorkshop").classList.toggle("is-peeking", value);
    $("workshopPeek").textContent = value ? "Show controls" : "View full path";
    $("workshopPeek").setAttribute("aria-pressed", String(value));
    renderMotion();
  }
  function close() {
    stopPlaying(); pausePlayback();
    peek(false);
    $("cameraWorkshop").hidden = true;
    $("workshopToggle").setAttribute("aria-expanded", "false");
    document.body.classList.remove("workshop-open");
    motionLayer.replaceChildren();
  }
  async function seek(next, forceRoute = false) {
    if (busy) return;
    stopPlaying(); pausePlayback(); busy = true; render();
    const route = routes[next.route], minute = Math.max(0, Math.min(duration(route), next.minute));
    const routeChanged = forceRoute || !active || next.route !== cursor.route;
    status("Moving to the next camera review point…");
    try {
      if (routeChanged) await seekRoute(route, minute);
      else setMinute(minute, true);
      cursor = { route: next.route, minute }; active = true; persist();
      if (routeChanged) $("workshopSpeed").value = String(getPlaybackSpeed(route));
      status("Watch the learned path. Adjust and save only where the framing needs correction; Play whole run continues without stops.");
    } catch (error) { status(`Could not open this view: ${error.message}`); }
    finally { busy = false; render(); }
    renderMotion();
  }
  function nextCursor() {
    const route = routes[cursor.route], end = duration(route);
    const next = stops(route).find(minute => minute > cursor.minute + .001);
    if (next !== undefined) return { route: cursor.route, minute: next };
    return cursor.route < routes.length - 1 ? { route: cursor.route + 1, minute: 0 } : null;
  }
  function previousCursor() {
    if (cursor.minute > 0) return { route: cursor.route, minute: stops(routes[cursor.route]).filter(minute => minute < cursor.minute - .001).at(-1) ?? 0 };
    return cursor.route > 0 ? { route: cursor.route - 1, minute: duration(routes[cursor.route - 1]) } : null;
  }
  async function playToNext(fullRun = false) {
    if (!active || busy) return;
    const next = fullRun ? { route: cursor.route, minute: duration(routes[cursor.route]) } : nextCursor();
    if (!next) { status("All chapter and camera configurations are complete. You can revisit any run with the configuration menu."); return; }
    if (next.route === cursor.route && next.minute <= cursor.minute) { status("This run is complete. Choose another configuration or Skip to next."); return; }
    if (next.route !== cursor.route) { await seek(next, true); return; }
    pausePlayback(); useLearnedPath();
    playing = true; busy = true; status(fullRun ? "Playing this entire configuration. Choose Pause here at any moment to save an angle." : "Playing the full interval to the next review point…"); render();
    let previous = 0, lastPaint = 0;
    const tick = now => {
      if (!playing) return;
      if (previous) cursor.minute = Math.min(next.minute, cursor.minute + Math.min(100, now - previous) * Number($("workshopSpeed").value) / 1000);
      previous = now;
      const reached = cursor.minute >= next.minute;
      setMinute(cursor.minute, reached || now - lastPaint > 100);
      if (reached || now - lastPaint > 100) { render(); lastPaint = now; }
      if (reached || now - lastPaint > 250) renderMotion();
      if (reached) {
        stopPlaying(); cursor = next; persist(); render();
        status(fullRun ? "End of this run. Save only if this view needs a correction, or choose the next configuration." : "Review point reached. Save a correction if needed, or continue.");
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  $("workshopToggle").disabled = false;
  $("workshopToggle").addEventListener("click", () => $("cameraWorkshop").hidden ? open() : close());
  $("workshopPeek").addEventListener("click", () => peek(!$("cameraWorkshop").classList.contains("is-peeking")));
  $("workshopClose").addEventListener("click", close);
  $("workshopStart").addEventListener("click", () => void seek({ route: 0, minute: 0 }, true));
  $("workshopResume").addEventListener("click", () => void seek({ ...cursor }, true));
  $("workshopPrevious").addEventListener("click", () => { const previous = previousCursor(); if (previous) void seek(previous); });
  $("workshopNext").addEventListener("click", () => { const next = nextCursor(); if (next) void seek(next); else status("All configurations complete."); });
  $("workshopPlay").addEventListener("click", () => {
    if (playing) {
      stopPlaying(); setMinute(cursor.minute, true); persist(); render();
      status("Paused at this minute. Save a camera correction if needed, then continue.");
    } else void playToNext();
  });
  $("workshopPlayRun").addEventListener("click", () => void playToNext(true));
  $("workshopSavePlay").addEventListener("click", async () => {
    if (!active || busy) return;
    busy = true; render();
    const success = await saveView(false);
    busy = false; render();
    if (success) await playToNext();
  });
  $("workshopSaveSpeed").addEventListener("click", async () => {
    if (!active || busy) return;
    busy = true; render();
    const speed = Number($("workshopSpeed").value);
    const saved = await saveSpeedNote({ route: routes[cursor.route], minute: cursor.minute, mode: getMode(), speed });
    busy = false; render();
    status(saved ? `Speed note saved for this view: ${speed} simulated minutes per second.` : "Could not save this speed note.");
  });
  $("workshopMinute").addEventListener("input", event => {
    if (!active || (busy && !playing)) return;
    if (playing) stopPlaying();
    cursor.minute = Number(event.target.value); setMinute(cursor.minute, true); persist(); render();
    status("Paused at this minute. Scrub again or adjust the camera, then save the angle.");
    renderMotion();
  });
  $("workshopMomentSpan").addEventListener("change", renderMotion);
  $("workshopAddMoment").addEventListener("click", async () => {
    if (!active || (busy && !playing) || !addMoment) return;
    if (playing) { stopPlaying(); setMinute(cursor.minute, true); persist(); }
    busy = true; render();
    const route = routes[cursor.route], label = $("workshopMomentLabel").value.trim();
    try {
      await addMoment({ windowId: route.window.id, selected: route.slot, referenceMode: route.reference, mode: route.viewMode || getMode(),
        timeUtc: new Date(Date.parse(route.window.start) + Math.round(cursor.minute) * 60000).toISOString(), label,
        note: $("workshopCameraNote").value.trim(), spanMinutes: Number($("workshopMomentSpan").value) });
      $("workshopMomentLabel").value = ""; momentSignature = ""; status("Key moment added to this camera run.");
    } catch (error) { status(`Could not add moment: ${error.message}`); }
    finally { busy = false; render(); renderMotion(); }
  });
  routeSelect.addEventListener("change", () => { if (active && !busy) void seek({ route: Number(routeSelect.value), minute: 0 }, true); });
  $("workshopInterval").addEventListener("change", event => {
    interval = event.target.value === "key" ? "key" : Number(event.target.value); persist(); render();
  });
  render();
  setInterval(renderMotion, 750);
  return { refresh: () => { render(); renderMotion(); }, close };
}

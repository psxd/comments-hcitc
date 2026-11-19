import { loadCurrentEpisodes, episodeChapters } from "../../../shared/episode-feed.js";
import { createCameraWorkshop } from "../e002-control-panel-preview/camera-workshop.js";
import { installGlossary } from "../e002-control-panel-preview/glossary.js";
import { installChapterButtons } from "./panel-layout.js?v=4";
import { reviewHref } from "../review-shell.js?v=2";

const $ = id => document.getElementById(id);
const frame = $("episodeFrame");
new ResizeObserver(() => document.documentElement.style.setProperty("--review-top", `${document.querySelector(".review-bar").offsetHeight}px`)).observe(document.querySelector(".review-bar"));
let chapters = [], selected = 0, comments = [], views = [], moments = [], draft = null, spotMode = false;
let workshopPlaying = false, lastPlaybackTime = 0, switching = false;
let cameraWorkshop = null, speedPreferences = [], lastGuideView = null;
const api = () => frame.contentWindow?.__proximityWorkshop;
const doc = () => frame.contentDocument;
const dateLabel = value => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) + " UTC";
const chapterDateLabel = value => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
const message = value => { $("workshopStatus").textContent = value; };
function finishEpisodeLoading() {
  const loading = $("episodeLoading");
  setTimeout(() => {
    loading.classList.add("is-leaving");
    setTimeout(() => { loading.hidden = true; }, 420);
  }, 0);
}

async function request(path, payload) {
  const response = await fetch(path, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Review request returned ${response.status}`);
  return result;
}
function download(name, value) {
  const link = document.createElement("a"), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function openRail(kind) {
  if (kind === "comments") cameraWorkshop?.close();
  $("reviewRail").hidden = false;
  $("reviewRail").dataset.mode = kind;
  $("commentsSection").hidden = kind !== "comments";
  $("workshopSection").hidden = kind !== "workshop";
  $("railTitle").textContent = kind === "workshop" ? "E-001 camera workshop" : "E-001 spot comments";
  if (kind === "comments") sessionStorage.setItem("espl-review-comments-open", "1");
}
function anchor(key) { return key === "globe" ? doc()?.querySelector("canvas") : doc()?.getElementById(key); }
function placePins() {
  const layer = $("pinLayer"); layer.replaceChildren();
  for (const [index, item] of comments.entries()) {
    if (item.surface !== "E-001" && !(item.surface !== "Library" && item.appliesToAllEpisodes)) continue;
    const element = anchor(item.key); if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > frame.clientHeight) continue;
    const pin = document.createElement("button"); pin.type = "button"; pin.className = "spot-pin"; pin.textContent = String(index + 1);
    pin.style.left = `${rect.left + rect.width * item.x}px`; pin.style.top = `${rect.top + rect.height * item.y}px`;
    pin.title = `${item.label}: ${item.text}`;
    pin.addEventListener("click", () => { openRail("comments"); $("commentList").querySelector(`[data-id="${item.id}"]`)?.scrollIntoView({ block: "nearest" }); });
    layer.append(pin);
  }
}
function renderComments() {
  $("commentCount").textContent = String(comments.length); const list = $("commentList"); list.replaceChildren();
  for (const item of comments) {
    const card = document.createElement("div"); card.className = "review-item"; card.dataset.id = item.id;
    const title = document.createElement("strong"); title.textContent = item.label;
    const scope = document.createElement("span"); scope.className = "comment-scope-badge"; scope.textContent = item.surface === "Library" ? `Library · ${item.appliesToAllEpisodes ? "All table episodes" : "This table spot"}` : `${item.surface} · ${item.appliesToAllEpisodes === true ? "All episodes" : "This view"}`;
    const body = document.createElement("p"); body.textContent = item.text;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Delete";
    remove.addEventListener("click", async () => { try { comments = (await request("/api/review-comments", { action: "delete", id: item.id })).comments; renderComments(); } catch (error) { message(error.message); } });
    card.append(title, scope, body);
    if (item.surface !== "E-001") {
      const jump = document.createElement("a"); jump.href = reviewHref(item.surface);
      jump.textContent = `Open ${item.surface}`; card.append(jump);
    }
    card.append(remove); list.append(card);
  }
  if (!comments.length) list.textContent = "No comments yet.";
  placePins();
}
function renderViews() {
  $("cameraViewCount").textContent = String(views.length);
  const list = $("cameraViewList"); list.replaceChildren();
  for (const item of views.slice().reverse()) {
    const card = document.createElement("div"); card.className = "review-item";
    const title = document.createElement("strong"); title.textContent = `${chapters.find(c => c.id === item.chapterId)?.label || item.chapterId} · ${dateLabel(item.simulationTimeUtc)} · ${item.cameraMode}`;
    const row = document.createElement("div"); row.className = "row";
    const restore = document.createElement("button"); restore.type = "button"; restore.textContent = "Show view";
    restore.addEventListener("click", async () => { try { const index = chapters.findIndex(c => c.id === item.chapterId); if (index >= 0) await selectChapter(index, item.simulationTimeUtc); api().applyCamera(item); lastGuideView = item; message("Saved camera view restored."); } catch (error) { message(error.message); } });
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Delete";
    remove.addEventListener("click", async () => { try { views = (await request("/api/e001-camera-views", { action: "delete", id: item.id })).views; lastGuideView = views.at(-1) || null; renderViews(); cameraWorkshop?.refresh(); } catch (error) { message(error.message); } });
    const note = document.createElement("textarea"); note.rows = 2; note.maxLength = 4000; note.value = item.note || "";
    note.placeholder = "Comment on this camera angle"; note.setAttribute("aria-label", `Comment on camera view at ${dateLabel(item.simulationTimeUtc)}`);
    const saveNote = document.createElement("button"); saveNote.type = "button"; saveNote.textContent = "Save note";
    saveNote.addEventListener("click", async () => { try { views = (await request("/api/e001-camera-views", { action: "annotate", id: item.id, note: note.value })).views; message("Camera angle comment saved."); } catch (error) { message(error.message); } });
    row.append(restore, remove, saveNote); card.append(title, note, row); list.append(card);
  }
  if (!views.length) list.textContent = "No views saved yet.";
}
function syncClock() {
  const state = api()?.state, chapter = chapters[selected]; if (!state || !chapter) return;
  const minute = Math.max(0, Math.min(Math.round((state.time - chapter.startMs) / 60000), chapter.widthHours * 60));
  $("legacyWorkshopTime").value = String(minute);
  $("workshopClock").textContent = dateLabel(state.time);
  $("playChapter").textContent = workshopPlaying ? "Pause chapter" : "Play whole chapter";
  $("holdCamera").textContent = state.held ? "Release camera" : "Hold camera";
  doc()?.querySelectorAll(".e001-chapters button").forEach((button, index) => { button.classList.toggle("active", index === selected); button.setAttribute("aria-pressed", String(index === selected)); });
  $("chapterSelect").value = String(selected);
  const reference = doc()?.getElementById("referenceBtn");
  const sticky = doc()?.getElementById("pairSticky");
  if (sticky) {
    const names = [...doc().querySelectorAll("#identity .satName")].map(node => node.textContent);
    sticky.querySelector(".pair-sticky-choices b").textContent = names[0] || "Satellite A";
    sticky.querySelector(".pair-sticky-target b").textContent = names[1] || "Satellite B";
  }
  if (reference) {
    reference.disabled = state.mode === "earth";
    const centered = state.referenceSatellite === "B", names = [...doc().querySelectorAll("#identity .satName")].map(node => node.textContent);
    reference.classList.toggle("is-chaser", centered);
    reference.setAttribute("aria-pressed", String(centered));
    reference.title = reference.disabled ? "Reference switching applies in relative view" : `Reference: ${names[centered ? 1 : 0] || "satellite"}. Switch to ${names[centered ? 0 : 1] || "other satellite"}`;
    reference.setAttribute("aria-label", reference.title);
  }
  placePins();
}
async function selectChapter(index, time = null) {
  if (switching || !api() || !chapters[index]) return;
  switching = true; workshopPlaying = false; api().pause();
  const chapter = chapters[index], overlay = $("chapterTransition");
  $("transitionText").textContent = index > selected ? "Moving forward in time" : index < selected ? "Moving back in time" : "Loading episode";
  $("transitionFromDate").textContent = chapters[selected]?.label || "";
  $("transitionToDate").textContent = chapter.label;
  overlay.classList.remove("is-visible", "show-dates");
  overlay.hidden = false;
  await new Promise(resolve => setTimeout(resolve, 20));
  overlay.classList.add("is-visible");
  await new Promise(resolve => setTimeout(resolve, 500));
  overlay.classList.add("show-dates");
  await new Promise(resolve => setTimeout(resolve, 1100));
  try {
    api().setWindow(chapter.start, chapter.end);
    api().setTime(time || chapter.center);
    selected = index; lastPlaybackTime = api().state.time; syncClock();
    message(`${chapter.label}: ${dateLabel(chapter.start)} to ${dateLabel(chapter.end)}. Adjust the globe and save views where useful.`);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 500));
    overlay.classList.remove("is-visible");
    await new Promise(resolve => setTimeout(resolve, 450));
    overlay.hidden = true; overlay.classList.remove("show-dates"); switching = false;
  }
}

$("commentsToggle").addEventListener("click", () => openRail("comments"));
$("railClose").addEventListener("click", () => { $("reviewRail").hidden = true; sessionStorage.removeItem("espl-review-comments-open"); });
$("spotToggle").addEventListener("click", () => { spotMode = !spotMode; $("spotLayer").hidden = !spotMode; $("spotToggle").setAttribute("aria-pressed", String(spotMode)); });
$("spotLayer").addEventListener("click", event => {
  const bounds = frame.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
  const hit = doc().elementFromPoint(x, y);
  const target = hit?.closest("[id]"); const key = target?.id || "globe";
  const rect = (anchor(key) || doc().body).getBoundingClientRect();
  draft = { key, label: key === "globe" ? "3D globe" : key.replace(/([a-z])([A-Z])/g, "$1 $2"), x: Math.max(0, Math.min(1, (x - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (y - rect.top) / rect.height)) };
  $("spotLocation").textContent = draft.label; $("commentText").value = ""; $("commentAllEpisodes").checked = false; $("commentForm").hidden = false; openRail("comments"); $("commentText").focus();
  spotMode = false; $("spotLayer").hidden = true; $("spotToggle").setAttribute("aria-pressed", "false");
});
$("cancelComment").addEventListener("click", () => { $("commentForm").hidden = true; draft = null; });
$("commentForm").addEventListener("submit", async event => {
  event.preventDefault(); if (!draft) return;
  try { comments = (await request("/api/review-comments", { action: "add", surface: "E-001", root: "panel", ...draft, text: $("commentText").value.trim(), appliesToAllEpisodes: $("commentAllEpisodes").checked })).comments; renderComments(); $("commentForm").hidden = true; draft = null; }
  catch (error) { message(error.message); }
});
$("downloadComments").addEventListener("click", () => download("review-comments.json", { schema: "espl-shared-review-v1", comments }));
$("downloadViews").addEventListener("click", () => download("e001-saved-camera-views.json", { schema: "espl-e001-local-review-v1", views }));
$("exportViews").addEventListener("click", () => $("downloadViews").click());
async function saveGuidedView(openWorkshop = true) {
  try {
    if (!api()) throw new Error("E-001 is still loading");
    const view = api().capture();
    view.note = $("workshopCameraNote").value.trim();
    views = (await request("/api/e001-camera-views", { action: "add", chapterId: chapters[selected].id, item: view })).views;
    lastGuideView = view;
    api().applyFraming(view);
    renderViews(); cameraWorkshop?.refresh();
    $("workshopCameraNote").value = "";
    if (openWorkshop && $("cameraWorkshop").hidden) $("workshopToggle").click();
    message(`Saved the ${dateLabel(view.simulationTimeUtc)} camera view.`);
    return true;
  } catch (error) { message(error.message); return false; }
}
$("saveView").addEventListener("click", () => void saveGuidedView());
$("chapterSelect").addEventListener("change", event => selectChapter(Number(event.target.value)));
$("legacyWorkshopTime").addEventListener("input", event => { const chapter = chapters[selected]; if (!chapter || !api()) return; workshopPlaying = false; api().setTime(new Date(chapter.startMs + Number(event.target.value) * 60000).toISOString()); syncClock(); });
$("previousMoment").addEventListener("click", () => { const state = api()?.state, chapter = chapters[selected]; if (!state || !chapter) return; const options = [chapter.startMs, chapter.centerMs, chapter.endMs]; const previous = options.filter(ms => ms < state.time - 60000).at(-1); if (previous !== undefined) { api().setTime(new Date(previous).toISOString()); syncClock(); } else if (selected) selectChapter(selected - 1); });
$("nextMoment").addEventListener("click", () => { const state = api()?.state, chapter = chapters[selected]; if (!state || !chapter) return; const next = [chapter.startMs, chapter.centerMs, chapter.endMs].find(ms => ms > state.time + 60000); if (next !== undefined) { api().setTime(new Date(next).toISOString()); syncClock(); } else if (selected < chapters.length - 1) selectChapter(selected + 1); });
$("playChapter").addEventListener("click", () => { if (!api()) return; workshopPlaying = !workshopPlaying; if (workshopPlaying) { api().hold(false); api().play(); lastPlaybackTime = api().state.time; } else api().pause(); syncClock(); });
$("holdCamera").addEventListener("click", () => { if (!api()) return; api().hold(!api().state.held); workshopPlaying = false; syncClock(); });
setInterval(async () => {
  if (!api() || switching || !chapters.length) return;
  const time = api().state.time;
  if (workshopPlaying && time < lastPlaybackTime - 60000) {
    api().pause(); workshopPlaying = false;
    if (selected < chapters.length - 1) { await selectChapter(selected + 1, chapters[selected + 1].start); api().play(); workshopPlaying = true; }
    else message("All E-001 chapters have played. Save any camera views you want to keep.");
  }
  lastPlaybackTime = api().state.time; syncClock();
}, 250);

async function init() {
  const [feed, storedComments, storedViews, storedSpeeds, storedMoments] = await Promise.all([loadCurrentEpisodes(), request("/api/review-comments"), request("/api/e001-camera-views"), request("/api/e001-speed-preferences"), request("/api/camera-moments")]);
  const row = feed.episodes.find(item => item.ID === "E-001");
  chapters = episodeChapters(row).map(item => ({ ...item, label: chapterDateLabel(item.center) }));
  if (!chapters.length) throw new Error("E-001 has no valid chapters in the published sheet");
  comments = storedComments.comments; views = storedViews.views; moments = storedMoments.moments.filter(item => item.surface === "E-001"); lastGuideView = views.at(-1) || null; speedPreferences = storedSpeeds.preferences; renderComments(); renderViews();
  const choices = $("chapterSelect");
  chapters.forEach((chapter, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = `${chapter.label} · ${chapter.widthHours} hours`; choices.append(option); });
  for (let tries = 0; tries < 120; tries++) {
    if (api()?.state.start > 0) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!api()?.state.start) throw new Error("E-001 visualization did not finish loading");
  installChapterButtons({ doc, api, syncClock, selectChapter, chapters, dateLabel, placePins, frame, episodes: feed.episodes, review: true });
  void installGlossary(doc().getElementById("ui"), frame).catch(console.error);
  const first = chapters[0];
  api().setWindow(first.start, first.end);
  api().setTime(first.start);
  const openingView = views.filter(view => view.chapterId === first.id && view.cameraMode === "relative" && view.referenceSatellite === "B" && Date.parse(view.simulationTimeUtc) <= first.centerMs)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (openingView) {
    api().setMode("relative");
    api().setReference("B");
    api().applyFraming(openingView, true);
  }
  selected = 0; lastPlaybackTime = api().state.time; syncClock();
  const names = [...doc().querySelectorAll("#identity .satName")].map(node => node.textContent.trim());
  const reviewRoutes = chapters.flatMap(chapter => ["B", "A"].map(referenceSatellite => ({
    window: { id: chapter.id, start: chapter.start, end: chapter.end, anchor: chapter.center, chapterShort: chapter.label },
    slot: "A", reference: referenceSatellite === "B" ? "target" : "chaser", viewMode: "relative",
  })));
  const preferenceFor = route => speedPreferences.find(item => item.chapterId === route.window.id && item.referenceSatellite === (route.reference === "target" ? "B" : "A") && item.cameraMode === (route.viewMode === "eci" ? "earth" : "relative"));
  cameraWorkshop = createCameraWorkshop({
    windows: [], names: { A: names[0] || "Satellite A", B: names[1] || "Satellite B" }, reviewRoutes,
    routeLabel: route => `${route.window.chapterShort} · Relative motion · ${route.reference === "target" ? names[1] : names[0]} centered`,
    storageKey: "espl-e001-camera-workshop-v4",
    defaultMotionSpanMinutes: 360,
    maxKeyRunMinutes: 360,
    getMoments: () => moments,
    addMoment: async moment => { moments = (await request("/api/camera-moments", { action: "add", moment: { ...moment, surface: "E-001" } })).moments.filter(item => item.surface === "E-001"); return moments; },
    deleteMoment: async id => { moments = (await request("/api/camera-moments", { action: "delete", id })).moments.filter(item => item.surface === "E-001"); return moments; },
    motionPreview: (route, minute, spanMinutes) => api().motionPreview(new Date(Date.parse(route.window.start) + minute * 60000).toISOString(), spanMinutes),
    beforeOpen: () => { $("reviewRail").hidden = true; },
    seekRoute: async (route, minute) => {
      const index = chapters.findIndex(chapter => chapter.id === route.window.id);
      if (index < 0) throw new Error("Unknown chapter");
      const time = new Date(Date.parse(route.window.start) + minute * 60000).toISOString();
      if (index !== selected) await selectChapter(index, time);
      else api().setTime(time);
      api().setReference(route.reference === "target" ? "B" : "A");
      api().setMode(route.viewMode === "eci" ? "earth" : "relative");
      if (lastGuideView?.cameraMode === "relative") api().applyFraming(lastGuideView, true);
      const preference = preferenceFor(route);
      if (preference) api().setSpeed(preference.minutesPerSecond * 60);
      syncClock();
    },
    setMinute: minute => {
      const chapter = chapters[selected];
      if (chapter) { api().setTime(new Date(chapter.startMs + minute * 60000).toISOString()); syncClock(); }
    },
    pausePlayback: () => { workshopPlaying = false; api().pause(); },
    useLearnedPath: () => lastGuideView?.cameraMode === "relative" ? api().applyFraming(lastGuideView) : api().hold(false),
    saveView: () => saveGuidedView(false),
    getViews: () => views.map(view => ({
      windowId: view.chapterId, selected: "A", referenceMode: view.referenceSatellite === "B" ? "target" : "chaser",
      mode: view.cameraMode === "earth" ? "eci" : "relative", timeUtc: view.simulationTimeUtc, auto: false,
    })),
    getPlaybackSpeed: route => preferenceFor(route)?.minutesPerSecond ?? 240,
    getMode: () => api().state.mode === "earth" ? "eci" : "relative",
    saveSpeedNote: async ({ route, speed }) => {
      try {
        const item = { chapterId: route.window.id, referenceSatellite: route.reference === "target" ? "B" : "A", cameraMode: route.viewMode === "eci" ? "earth" : "relative", minutesPerSecond: speed };
        speedPreferences = (await request("/api/e001-speed-preferences", { action: "set", item })).preferences;
        api().setSpeed(speed * 60);
        return true;
      } catch (error) { console.error(error); return false; }
    },
  });
  message(`${first.label}: ${dateLabel(first.start)} to ${dateLabel(first.end)}. Adjust the globe and save views where useful.`);
  if (comments.length && sessionStorage.getItem("espl-review-comments-open") === "1") openRail("comments");
  else if (!comments.length) sessionStorage.removeItem("espl-review-comments-open");
  new ResizeObserver(placePins).observe(frame);
  finishEpisodeLoading();
  workshopPlaying = true;
  api().play();
  syncClock();
}
frame.addEventListener("load", () => init().catch(error => { $("episodeLoadingText").textContent = `Could not load episode: ${error.message}`; $("episodeLoading").classList.add("is-error"); message(error.message); console.error(error); }), { once: true });

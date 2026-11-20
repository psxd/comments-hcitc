import { loadCurrentEpisodes, episodeChapters } from "../../shared/episode-feed.js?v=6";
import { installChapterButtons } from "../dev/e001-review/panel-layout.js?v=5";
import { installGlossary } from "../dev/e002-control-panel-preview/glossary.js";

const $ = id => document.getElementById(id);
const frame = $("episodeFrame");
const doc = () => frame.contentDocument;
const api = () => frame.contentWindow?.__proximityWorkshop;
const chapterDateLabel = value => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
const dateLabel = value => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) + " UTC";
let chapters = [], selected = 0, switching = false, lastTime = 0, wasPlaying = false;
let savedCameraViews = [];

function syncClock() {
  if (!api() || !chapters.length) return;
  doc().querySelectorAll(".e001-chapters button").forEach((button, index) => {
    button.classList.toggle("active", index === selected);
    button.setAttribute("aria-pressed", String(index === selected));
  });
  const names = [...doc().querySelectorAll("#identity .satName")].map(node => node.textContent);
  const sticky = doc().getElementById("pairSticky");
  if (sticky) {
    sticky.querySelector(".pair-sticky-choices b").textContent = names[0] || "Satellite A";
    sticky.querySelector(".pair-sticky-target b").textContent = names[1] || "Satellite B";
  }
  const reference = doc().getElementById("referenceBtn");
  if (reference) {
    reference.disabled = api().state.mode === "earth";
    const centered = api().state.referenceSatellite === "B";
    reference.classList.toggle("is-chaser", centered);
    reference.setAttribute("aria-pressed", String(centered));
    reference.title = reference.disabled ? "Reference switching applies in relative view" : `Reference: ${names[centered ? 1 : 0] || "satellite"}. Switch to ${names[centered ? 0 : 1] || "other satellite"}`;
    reference.setAttribute("aria-label", reference.title);
  }
}

async function selectChapter(index, time = null, resume = false) {
  if (switching || !api() || !chapters[index]) return;
  switching = true;
  api().pause();
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
    api().setTime(time ?? chapter.start);
    api().setPublishedCameraViews(savedCameraViews, chapter.id);
    selected = index;
    lastTime = api().state.time;
    syncClock();
  } finally {
    await new Promise(resolve => setTimeout(resolve, 500));
    overlay.classList.remove("is-visible");
    await new Promise(resolve => setTimeout(resolve, 450));
    overlay.hidden = true;
    overlay.classList.remove("show-dates");
    switching = false;
    if (resume) api().play();
  }
}

async function init() {
  const [feed, saved] = await Promise.all([loadCurrentEpisodes(), fetch("../dev/e001-review/saved-camera-views.json", { cache: "no-store" }).then(response => response.ok ? response.json() : { views: [] })]);
  savedCameraViews = saved.views || [];
  const row = feed.episodes.find(item => item.ID === "E-001");
  chapters = episodeChapters(row).map(item => ({ ...item, label: chapterDateLabel(item.center) }));
  if (!chapters.length) throw new Error("E-001 has no valid chapters in the published sheet");
  for (let tries = 0; tries < 300 && !(api()?.state.start > 0); tries++) await new Promise(resolve => setTimeout(resolve, 100));
  if (!(api()?.state.start > 0)) throw new Error("E-001 visualization did not finish loading");
  installChapterButtons({ doc, api, syncClock, selectChapter, chapters, dateLabel, placePins: () => {}, frame, episodes: feed.episodes });
  void installGlossary(doc().getElementById("ui"), frame).catch(console.error);
  const first = chapters[0];
  api().setWindow(first.start, first.end);
  api().setTime(first.start);
  api().setPublishedCameraViews(savedCameraViews, first.id);
  selected = 0;
  lastTime = api().state.time;
  syncClock();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $("episodeLoading").classList.add("is-leaving");
    setTimeout(() => { $("episodeLoading").hidden = true; }, 420);
  }));
  api().play();
  setInterval(() => {
    if (switching || !api()) return;
    const state = api().state;
    if (wasPlaying && state.playing && state.time < lastTime - 60000 && selected < chapters.length - 1) {
      void selectChapter(selected + 1, chapters[selected + 1].start, true);
    }
    lastTime = state.time;
    wasPlaying = state.playing;
    syncClock();
  }, 250);
}

frame.addEventListener("load", () => init().catch(error => {
  $("episodeLoadingText").textContent = `Could not load episode: ${error.message}`;
  $("episodeLoading").classList.add("is-error");
  console.error(error);
}), { once: true });

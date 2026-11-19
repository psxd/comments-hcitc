// Local review controls for the actual E-002 miniature in the Dynamic Table.
const $ = id => document.getElementById(id);
const fmt = ms => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms)) + " UTC";
const spotLabel = key => {
  const column = key.match(/^(E-\d+)-cell-(\d)$/);
  if (column) return `${column[1]} · ${["Episode", "Orbit", "Space objects", "Period", "Minimum separation distance", "Minimum relative velocity", "Records"][Number(column[2])]}`;
  const heading = key.match(/^heading-(\d)$/);
  if (heading) return `Column heading · ${["Episode", "Orbit", "Space objects", "Period", "Minimum separation distance", "Minimum relative velocity", "Records"][Number(heading[1])]}`;
  const episode = key.match(/^(E-\d+)-(.+)$/);
  return episode ? `${episode[1]} · ${episode[2].replaceAll("-", " ")}` : key.replaceAll("-", " ");
};

async function jsonRequest(path, payload) {
  const response = await fetch(path, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `${path} returned ${response.status}`);
  return result;
}

export function createLocalReview({ getMini, getFrame, setEditing, getSelectedEpisode, getPublicEpisode }) {
  const bar = $("tableReviewBar"), status = $("tableReviewStatus"), pins = $("tableSpotPins");
  const controls = ["miniEditToggle", "miniChapter", "miniPlay", "miniTime", "miniSpeed", "miniFrame", "miniOrigin", "miniZoomOut", "miniZoomIn", "miniReset", "miniMoveLeft", "miniMoveRight", "miniMoveUp", "miniMoveDown", "miniPlaceLeft", "miniPlaceRight", "miniPlaceUp", "miniPlaceDown", "miniMarkStart", "miniMarkEnd", "miniSaveLoop"].map($);
  let activeFrame = null, editing = false, spotMode = false, comments = [], savedConfigs = {}, draft = null;
  let loopStart = null, loopEnd = null, scrub = false;
  let viewportOffset = { x: 0, y: 0 };
  const publicId = assetId => getPublicEpisode?.(assetId) || assetId;
  const publicLabel = label => String(label || "").replace(/^E-\d{3}\b/, assetId => publicId(assetId));
  const placeScene = () => {
    if (!activeFrame) return;
    activeFrame.style.transform = `translate(${viewportOffset.x}px, ${viewportOffset.y}px)`;
    if (activeFrame.classList.contains("e002-mini")) {
      activeFrame.dataset.miniOffsetY = String(viewportOffset.y);
      const detail = document.querySelector('.expanded-row[data-episode-id="E-002"]');
      if (detail) activeFrame.style.height = `${detail.getBoundingClientRect().height + Math.max(0, -viewportOffset.y)}px`;
      return;
    }
    activeFrame.style.width = viewportOffset.x < 0 ? `calc(100% + ${-viewportOffset.x}px)` : "100%";
    activeFrame.style.height = viewportOffset.y < 0 ? `calc(100% + ${-viewportOffset.y}px)` : "100%";
  };
  const say = message => { status.textContent = message; };
  const model = () => getMini()?.ready ? getMini() : null;
  const enabled = value => controls.forEach(control => { control.disabled = !value; });
  const summary = () => {
    $("miniLoopSummary").textContent = Number.isFinite(loopStart) && Number.isFinite(loopEnd) ? `Loop ${fmt(loopStart)} → ${fmt(loopEnd)}` : "Select an episode to edit its mini preview.";
  };
  const anchorFor = key => [...document.querySelectorAll("[data-table-spot-key]")].find(node => node.dataset.tableSpotKey === key);
  const markAnchors = () => {
    document.querySelectorAll(".table-wrap thead th").forEach((node, i) => node.dataset.tableSpotKey = `heading-${i}`);
    document.querySelectorAll(".episode-row").forEach(row => {
      const id = row.dataset.episodeId;
      row.querySelectorAll(":scope > td").forEach((node, i) => node.dataset.tableSpotKey = `${id}-cell-${i}`);
    });
    document.querySelectorAll(".expanded-row").forEach(row => {
      const id = row.dataset.episodeId;
      for (const selector of [".context-block", ".visual-block", ".expanded-objects", ".evidence-section"]) {
        const node = row.querySelector(selector); if (node) node.dataset.tableSpotKey = `${id}-${selector.slice(1)}`;
      }
      row.querySelectorAll(".source-card").forEach((node, i) => node.dataset.tableSpotKey = `${id}-source-${i}`);
    });
    const toolbar = document.querySelector(".component-wrap .toolbar"); if (toolbar) toolbar.dataset.tableSpotKey = "toolbar";
    placePins();
  };
  const placePins = () => {
    pins.replaceChildren(); pins.hidden = !comments.length;
    comments.forEach((comment, i) => {
      if (comment.surface !== "Library") return;
      const anchor = anchorFor(comment.key); if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const x = rect.left + rect.width * comment.x, y = rect.top + rect.height * comment.y;
      if (x < 0 || y < bar.getBoundingClientRect().bottom || x > innerWidth || y > innerHeight) return;
      const pin = document.createElement("button"); pin.type = "button"; pin.className = "table-spot-pin"; pin.textContent = String(i + 1);
      pin.title = `${publicLabel(comment.label)}: ${comment.text}`; pin.setAttribute("aria-label", `Show table comment ${i + 1}`);
      pin.style.left = `${x}px`; pin.style.top = `${y}px`;
      pin.addEventListener("click", () => { $("tableCommentDrawer").hidden = false; $("tableCommentsToggle").setAttribute("aria-expanded", "true"); sessionStorage.setItem("espl-review-comments-open", "1"); $("tableCommentForm").hidden = true; say(`${publicLabel(comment.label)}: ${comment.text}`); });
      pins.append(pin);
    });
  };
  const listComments = () => {
    $("tableCommentCount").textContent = String(comments.length); const list = $("tableCommentList"); list.replaceChildren();
    if (!comments.length) list.textContent = "No new comments yet.";
    for (const [i, comment] of comments.entries()) {
      const item = document.createElement("div"); item.className = "table-comment-item";
      const jump = document.createElement("button"); jump.type = "button"; jump.textContent = `${i + 1}. ${comment.surface === "Library" ? "Library" : publicId(comment.surface)} · ${publicLabel(comment.label)}${comment.appliesToAllEpisodes ? " · All table episodes" : ""}`; jump.title = "Show comment location";
      jump.addEventListener("click", () => {
        if (comment.surface !== "Library") { location.href = comment.surface === "E-001" ? "../visualization/dev/e001-review/" : comment.surface === "E-002" ? "../visualization/dev/e002-control-panel-preview/" : `../visualization/Viz/compare.html?dev=1&episode=${publicId(comment.surface)}`; return; }
        const anchor = anchorFor(comment.key); if (anchor) {
          const stack = anchor.closest(".source-stack");
          if (stack?.hidden) {
            const index = [...stack.parentElement.children].indexOf(stack);
            stack.closest(".evidence-section")?.querySelectorAll(".source-carousel-dot")[index]?.click();
          }
          anchor.scrollIntoView({ block: "center", behavior: "smooth" }); placePins();
        } else say("Expand the commented episode to show that location.");
      });
      const text = document.createElement("p"); text.textContent = comment.text; text.title = comment.text;
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Delete"; remove.setAttribute("aria-label", `Delete comment ${i + 1}`);
      remove.addEventListener("click", async () => { try { comments = (await jsonRequest("/api/review-comments", { action: "delete", id: comment.id })).comments; listComments(); placePins(); say("Comment deleted."); } catch (error) { say(error.message); } });
      item.append(jump, text, remove); list.append(item);
    }
    placePins();
  };
  const beginComment = (anchor, x, y, label) => {
    draft = { key: anchor.dataset.tableSpotKey, label, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    $("tableCommentLocation").textContent = label; $("tableCommentText").value = ""; $("tableCommentAllEpisodes").checked = false;
    $("tableCommentDrawer").hidden = false; $("tableCommentsToggle").setAttribute("aria-expanded", "true"); sessionStorage.setItem("espl-review-comments-open", "1"); $("tableCommentForm").hidden = false; $("tableCommentText").focus();
  };
  const handleSpotClick = event => {
    if (!spotMode || !event.target.closest(".component-wrap")) return;
    const anchor = event.target.closest("[data-table-spot-key]"); if (!anchor) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const rect = anchor.getBoundingClientRect(), key = anchor.dataset.tableSpotKey;
    beginComment(anchor, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, publicLabel(spotLabel(key)));
  };
  const sync = () => {
    const m = model(), ready = !!m && ["E-001", "E-002", "E-003", "E-005", "E-006", "E-008", "E-016", "E-059"].includes(getSelectedEpisode());
    if (ready && getSelectedEpisode() === "E-005") {
      const row = document.querySelector('.episode-row[data-episode-id="E-005"]');
      if (row) row.dataset.miniSelected = m.selected === "C" ? "C" : "B";
    }
    enabled(ready);
    const originAvailable = ready && Array.isArray(m.origins) && typeof m.setOrigin === "function";
    $("miniOriginControl").hidden = !originAvailable;
    $("miniOrigin").disabled = !originAvailable;
    if (originAvailable) $("miniOrigin").value = m.origin;
    for (const id of ["miniMoveLeft", "miniMoveRight", "miniMoveUp", "miniMoveDown"]) $(id).disabled = !ready || typeof m?.moveComposition !== "function";
    for (const id of ["miniPlaceLeft", "miniPlaceRight", "miniPlaceUp", "miniPlaceDown"]) $(id).disabled = !ready;
    if (!ready) { $("miniClock").textContent = "Select an episode"; return; }
    if (!scrub) { $("miniTime").min = String(Date.parse(m.window.start)); $("miniTime").max = String(Date.parse(m.window.end)); $("miniTime").value = String(m.current); }
    $("miniClock").textContent = fmt(m.current);
    $("miniPlay").textContent = m.playing ? "Pause" : "Play";
    $("miniChapter").value = m.window.id;
    $("miniSpeed").value = String(m.rate);
    $("miniFrame").textContent = m.frameMode === "relative" ? "Relative view" : "ECI view";
    $("miniEditToggle").textContent = editing ? "Done adjusting" : "Adjust mini scene";
    summary();
  };
  const applySaved = m => {
    const savedConfig = savedConfigs[getSelectedEpisode()];
    if (!savedConfig || frameApplied === getFrame()) return;
    try {
      const offset = savedConfig.camera?.viewportOffset;
      viewportOffset = { x: Number(offset?.x) || 0, y: Number(offset?.y) || 0 }; placeScene();
      m.selectWindow(savedConfig.windowId);
      m.setTime(Date.parse(savedConfig.camera.timestampUtc || savedConfig.loopStartUtc));
      m.applyCamera(savedConfig.camera);
      m.setLoop(Date.parse(savedConfig.loopStartUtc), Date.parse(savedConfig.loopEndUtc));
      m.setRate(savedConfig.rate); m.setPlaying(true);
      loopStart = m.loopStart; loopEnd = m.loopEnd; frameApplied = getFrame();
      getFrame().dataset.miniConfigured = "1";
    } catch (error) { say(`Saved mini view could not be applied: ${error.message}`); }
  };
  let frameApplied = null;
  const attachMini = frame => {
    if (!frame || activeFrame === frame) return;
    activeFrame = frame;
    let attempts = 0;
    const check = () => {
      if (frame !== getFrame()) return;
      const m = model(); if (!m) { if (++attempts < 240) setTimeout(check, 250); return; }
      const options = $("miniChapter"); options.replaceChildren(...m.windows.map(window => {
        const option = document.createElement("option"); option.value = window.id; option.textContent = window.label; return option;
      }));
      $("miniOrigin").replaceChildren(...(m.origins || []).map(origin => {
        const option = document.createElement("option"); option.value = origin.value; option.textContent = origin.label; return option;
      }));
      const offset = savedConfigs[getSelectedEpisode()]?.camera?.viewportOffset;
      viewportOffset = { x: Number(offset?.x) || 0, y: Number(offset?.y) || 0 }; placeScene();
      applySaved(m);
      frame.dataset.miniConfigured = "1";
      loopStart = m.loopStart; loopEnd = m.loopEnd;
      frame.contentDocument.addEventListener("click", event => {
        if (!spotMode) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const anchor = document.querySelector(`.expanded-row[data-episode-id="${getSelectedEpisode()}"] .visual-block`); if (!anchor) return;
        const rect = anchor.getBoundingClientRect(), frameRect = frame.getBoundingClientRect();
        beginComment(anchor, (frameRect.left + event.clientX - rect.left) / rect.width, (frameRect.top + event.clientY - rect.top) / rect.height, `${publicId(getSelectedEpisode())} mini visualization`);
      }, true);
      sync(); say("Mini preview ready. Adjust the scene directly in the table.");
    };
    check();
  };

  bar.hidden = false; markAnchors();
  new ResizeObserver(() => document.documentElement.style.setProperty("--table-review-bar-height", `${bar.getBoundingClientRect().height}px`)).observe(bar);
  jsonRequest("/api/review-comments").then(result => { comments = result.comments || []; listComments(); if (comments.length && sessionStorage.getItem("espl-review-comments-open") === "1") { $("tableCommentDrawer").hidden = false; $("tableCommentsToggle").setAttribute("aria-expanded", "true"); } else if (!comments.length) sessionStorage.removeItem("espl-review-comments-open"); }).catch(error => say(`Comments unavailable: ${error.message}`));
  const savedReady = jsonRequest("/api/table-preview").then(result => { savedConfigs = result.configs || {}; if (result.savedAt) $("miniSavedAt").textContent = `Last saved ${new Date(result.savedAt).toLocaleString()}`; if (model()) { applySaved(model()); sync(); } }).catch(error => say(`Saved mini preview unavailable: ${error.message}`));
  $("miniEditToggle").addEventListener("click", () => { editing = !editing; if (!setEditing(editing)) editing = false; sync(); });
  $("miniChapter").addEventListener("change", event => { const m = model(); if (!m) return; m.selectWindow(event.target.value); loopStart = m.loopStart; loopEnd = m.loopEnd; sync(); });
  $("miniPlay").addEventListener("click", () => { const m = model(); if (m) { m.setPlaying(!m.playing); sync(); } });
  $("miniTime").addEventListener("pointerdown", () => { scrub = true; });
  $("miniTime").addEventListener("pointerup", () => { scrub = false; });
  $("miniTime").addEventListener("input", event => { const m = model(); if (m) { m.setTime(Number(event.target.value)); sync(); } });
  $("miniSpeed").addEventListener("change", event => { model()?.setRate(Number(event.target.value)); sync(); });
  $("miniFrame").addEventListener("click", () => { model()?.toggleFrame(); sync(); });
  $("miniOrigin").addEventListener("change", event => { model()?.setOrigin?.(event.target.value); sync(); });
  $("miniZoomOut").addEventListener("click", () => { model()?.zoom(1 / 1.2); });
  $("miniZoomIn").addEventListener("click", () => { model()?.zoom(1.2); });
  $("miniReset").addEventListener("click", () => { model()?.resetCamera(); });
  for (const [id, x, y] of [["miniMoveLeft", -1, 0], ["miniMoveRight", 1, 0], ["miniMoveUp", 0, 1], ["miniMoveDown", 0, -1]]) {
    $(id).addEventListener("click", () => { model()?.moveComposition?.(x, y); say("Mini scene position adjusted. Save the preview to keep it."); });
  }
  for (const [id, x, y] of [["miniPlaceLeft", -1, 0], ["miniPlaceRight", 1, 0], ["miniPlaceUp", 0, -1], ["miniPlaceDown", 0, 1]]) {
    $(id).addEventListener("click", () => {
      viewportOffset.x = Math.max(-180, Math.min(180, viewportOffset.x + x * 12));
      viewportOffset.y = Math.max(-100, Math.min(100, viewportOffset.y + y * 12));
      placeScene(); say("Whole mini scene moved in its viewport. Save the preview to keep it.");
    });
  }
  $("miniMarkStart").addEventListener("click", () => { const m = model(); if (m) { loopStart = m.current; if (loopEnd <= loopStart) loopEnd = Math.min(Date.parse(m.window.end), loopStart + 45 * 60000); summary(); } });
  $("miniMarkEnd").addEventListener("click", () => { const m = model(); if (m) { loopEnd = m.current; if (loopStart >= loopEnd) loopStart = Math.max(Date.parse(m.window.start), loopEnd - 45 * 60000); summary(); } });
  $("miniSaveLoop").addEventListener("click", async () => {
    const m = model(); if (!m) return;
    try {
      // Capture the exact displayed view before changing the loop, which can
      // otherwise move an automatic camera to a different playback moment.
      m.setPlaying(false);
      const camera = m.captureCamera("Dynamic Table mini preview");
      camera.viewportOffset = { ...viewportOffset };
      m.setLoop(loopStart, loopEnd);
      m.applyCamera(camera);
      const config = { episodeId: getSelectedEpisode(), windowId: m.window.id, frameMode: m.frameMode, loopStartUtc: new Date(loopStart).toISOString(), loopEndUtc: new Date(loopEnd).toISOString(), rate: m.rate, camera };
      await jsonRequest("/api/table-preview", { config }); savedConfigs[getSelectedEpisode()] = config;
      $("miniSavedAt").textContent = `Last saved ${new Date().toLocaleString()}`;
      m.setPlaying(true); editing = false; setEditing(false); sync();
      say(`Saved ${publicId(getSelectedEpisode())} preview at ${new Date().toLocaleTimeString()}. Export preview settings to share it.`);
    } catch (error) { say(`Could not save preview: ${error.message}`); }
  });
  $("miniExportSettings").addEventListener("click", () => {
    const m = model(), episodeId = getSelectedEpisode();
    const draft = m && ["E-001", "E-002", "E-003", "E-005", "E-006", "E-008", "E-016", "E-059"].includes(episodeId) ? {
      episodeId: publicId(episodeId), windowId: m.window.id, frameMode: m.frameMode,
      loopStartUtc: new Date(loopStart ?? m.loopStart).toISOString(),
      loopEndUtc: new Date(loopEnd ?? m.loopEnd).toISOString(), rate: m.rate,
      camera: { ...m.captureCamera("Current unsaved mini preview"), viewportOffset: { ...viewportOffset } },
    } : null;
    const publicConfigs = Object.fromEntries(Object.entries(savedConfigs).map(([assetId, config]) => [publicId(assetId), {
      ...config, episodeId: publicId(assetId), camera: { ...config.camera, name: publicLabel(config.camera?.name) },
    }]));
    const payload = { schema: "espl-mini-preview-export-v1", savedConfigs: publicConfigs, currentDraft: draft };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "dynamic-table-preview-settings.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say("Exported saved preview settings and the current view. Attach the JSON to your next message if you want to share it.");
  });
  $("tableSpotMode").addEventListener("click", () => { spotMode = !spotMode; document.body.classList.toggle("table-spot-mode", spotMode); $("tableSpotMode").setAttribute("aria-pressed", String(spotMode)); $("tableSpotMode").textContent = spotMode ? "Cancel spot comment" : "✚ Spot comment"; say(spotMode ? "Click a place on the Dynamic Table to leave a spot comment." : "Spot commenting off."); });
  document.addEventListener("click", handleSpotClick, true);
  $("tableCommentsToggle").addEventListener("click", () => { const drawer = $("tableCommentDrawer"); drawer.hidden = !drawer.hidden; $("tableCommentsToggle").setAttribute("aria-expanded", String(!drawer.hidden)); if (drawer.hidden) sessionStorage.removeItem("espl-review-comments-open"); else sessionStorage.setItem("espl-review-comments-open", "1"); });
  $("tableCloseComments").addEventListener("click", () => { $("tableCommentDrawer").hidden = true; $("tableCommentsToggle").setAttribute("aria-expanded", "false"); sessionStorage.removeItem("espl-review-comments-open"); });
  $("tableCancelComment").addEventListener("click", () => { draft = null; $("tableCommentForm").hidden = true; });
  $("tableCommentForm").addEventListener("submit", async event => {
    event.preventDefault(); if (!draft) return;
    try { comments = (await jsonRequest("/api/review-comments", { action: "add", surface: "Library", root: "table", ...draft, text: $("tableCommentText").value, appliesToAllEpisodes: $("tableCommentAllEpisodes").checked })).comments; draft = null; $("tableCommentForm").hidden = true; listComments(); say("Table spot comment saved locally."); }
    catch (error) { say(`Could not save comment: ${error.message}`); }
  });
  $("tableDownloadComments").addEventListener("click", () => { const blob = new Blob([JSON.stringify({ schema: "espl-shared-review-v1", comments }, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "review-comments.json"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); });
  new MutationObserver(markAnchors).observe($("rows"), { childList: true, subtree: true });
  window.addEventListener("scroll", placePins, { passive: true }); window.addEventListener("resize", placePins);
  window.addEventListener("message", event => { if (event.origin === location.origin && ["espl-e001-mini-ready", "espl-e002-mini-ready", "espl-e005-mini-ready", "espl-e006-mini-ready", "espl-e008-mini-ready", "espl-e016-mini-ready", "espl-e059-mini-ready"].includes(event.data?.type) && getFrame()) attachMini(getFrame()); });
  setInterval(sync, 250);
  async function primeMini(frame, episodeId) {
    await savedReady;
    const config = savedConfigs[episodeId];
    if (!config) return;
    for (let attempts = 0; attempts < 240 && !frame.contentWindow?.miniWorkshop?.ready; attempts++) await new Promise(resolve => setTimeout(resolve, 100));
    const m = frame.contentWindow?.miniWorkshop;
    if (!m?.ready || !frame.parentElement?.matches(".e001-prewarm, .e002-prewarm, .e005-prewarm")) return;
    try {
      m.selectWindow(config.windowId);
      m.setTime(Date.parse(config.camera.timestampUtc || config.loopStartUtc));
      m.applyCamera(config.camera);
      m.setLoop(Date.parse(config.loopStartUtc), Date.parse(config.loopEndUtc));
      m.setRate(config.rate);
      m.setPlaying(true);
      const offset = config.camera?.viewportOffset;
      frame.style.transform = `translate(${Number(offset?.x) || 0}px, ${Number(offset?.y) || 0}px)`;
      frame.dataset.prewarmedEpisode = episodeId;
      frame.dataset.miniConfigured = "1";
    } catch (error) { say(`Saved mini view could not be preloaded: ${error.message}`); }
  }
  return { attachMini, primeMini, markAnchors, previewStopped() { activeFrame = null; frameApplied = null; editing = false; loopStart = loopEnd = null; viewportOffset = { x: 0, y: 0 }; enabled(false); sync(); } };
}

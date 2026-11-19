import { installEpisodeNavigation } from "../../../shared/episode-navigation.js?v=2";

// Shared E-001 episode panel treatment for the local workshop and public view.
export function installChapterButtons({ doc, api, syncClock, selectChapter, chapters, dateLabel, placePins, frame, episodes, review = false }) {
  const dock = doc().getElementById("playbackDock"), nav = doc().createElement("div");
  doc().body.classList.add("e002-shared");
  doc().body.dataset.books = "off";
  doc().body.dataset.calendarIcon = "off";
  const e002Styles = doc().createElement("link");
  e002Styles.rel = "stylesheet";
  e002Styles.href = "../dev/e002-control-panel-preview/preview.css";
  doc().head.append(e002Styles);
  const ui = doc().getElementById("ui");
  const sticky = doc().createElement("div"); sticky.id = "pairSticky"; sticky.className = "pair-sticky"; sticky.hidden = true;
  sticky.innerHTML = '<span class="pair-sticky-intro">Current episode:</span><span class="pair-sticky-choices"><span class="pair-sticky-name"><i></i><b>Satellite A</b></span></span><span class="pair-sticky-separator">+</span><span class="pair-sticky-target"><i></i><b>Satellite B</b></span>';
  ui.prepend(sticky);
  let stickyStart = null;
  const updateStickyPair = () => {
    const identity = ui.querySelector("#identity");
    if (!identity) return;
    if (stickyStart === null) stickyStart = identity.getBoundingClientRect().top - ui.getBoundingClientRect().top + ui.scrollTop;
    sticky.hidden = ui.scrollTop < stickyStart - 12;
  };
  ui.addEventListener("scroll", updateStickyPair);
  const back = ui.querySelector(".backEpisodes");
  const arrow = back?.querySelector(".libraryBackArrow")?.cloneNode(true);
  const libraryUrl = back?.href || "../../dynamic-table/";
  back?.remove();
  ui.querySelector(".episodeHeader h1").textContent = "Visualizing Proximity in the Space Domain";
  const title = ui.querySelector("#episodeTitle");
  const focus = doc().createElement("section"); focus.className = "episode-focus";
  const focusLink = doc().createElement("a"); focusLink.className = "episode-focus-link";
  focusLink.href = libraryUrl; focusLink.target = "_top";
  focusLink.setAttribute("aria-label", "Choose a different episode");
  const focusTop = doc().createElement("div"); focusTop.className = "episode-focus-top";
  const eyebrow = doc().createElement("span"); eyebrow.className = "episode-eyebrow"; eyebrow.textContent = "Current episode";
  const action = doc().createElement("span"); action.className = "episode-hover-action"; action.setAttribute("aria-hidden", "true");
  if (arrow) action.append(arrow);
  const actionText = doc().createElement("span"); actionText.className = "episode-hover-text"; actionText.textContent = "Choose a different episode";
  action.append(actionText); focusTop.append(eyebrow, action);
  const season = ms => {
    const date = new Date(ms), month = date.getUTCMonth() + 1;
    return { part: month <= 4 ? "early" : month <= 8 ? "mid" : "late", year: date.getUTCFullYear() };
  };
  const firstPeriod = season(chapters[0].centerMs), lastPeriod = season(chapters.at(-1).centerMs);
  const period = doc().createElement("span"); period.className = "episode-focus-period";
  period.textContent = firstPeriod.year === lastPeriod.year && firstPeriod.part === lastPeriod.part
    ? `in ${firstPeriod.part} ${firstPeriod.year}`
    : firstPeriod.year === lastPeriod.year
      ? `from ${firstPeriod.part} to ${lastPeriod.part} ${firstPeriod.year}`
      : `from ${firstPeriod.part} ${firstPeriod.year} to ${lastPeriod.part} ${lastPeriod.year}`;
  focusLink.append(focusTop, title, period); focus.append(focusLink);
  ui.querySelector(".episodeHeader h1").after(focus);
  installEpisodeNavigation(focus, episodes, "E-001", { review });
  ui.querySelector("#metricArea")?.closest(".panelSection")?.classList.add("results-section");
  ui.querySelector("#rangeMetric .statLabel").textContent = "Separation distance";
  ui.querySelector("#speedMetric .statLabel").textContent = "Relative velocity";
  ui.querySelector("#thresholdControls>summary>span").textContent = "How close is too close?";
  const thresholdHint = doc().createElement("p"); thresholdHint.className = "threshold-chart-hint";
  thresholdHint.textContent = "Select threshold values by clicking and dragging the labels on the charts above or typing in the boxes below.";
  ui.querySelector("#thresholdControls .thresholdBody").prepend(thresholdHint);
  for (const [id, unit, step] of [["distanceThresholdSlider", "km", "5"], ["speedThresholdSlider", "m/s", "1"]]) {
    const input = ui.querySelector(`#${id}`), wrap = doc().createElement("span"), suffix = doc().createElement("span");
    input.type = "number"; input.step = step; input.inputMode = "decimal";
    wrap.className = "threshold-input-wrap"; suffix.textContent = unit;
    input.replaceWith(wrap); wrap.append(input, suffix);
  }
  ui.querySelector("#dwellLabel").textContent = "Dwell time";
  const panelToggle = doc().createElement("button");
  panelToggle.id = "panelToggleBtn"; panelToggle.type = "button"; panelToggle.innerHTML = '<span aria-hidden="true">‹</span>';
  panelToggle.setAttribute("aria-label", "Hide control panel"); panelToggle.setAttribute("aria-expanded", "true"); panelToggle.title = "Hide control panel";
  panelToggle.addEventListener("click", () => {
    const collapsed = doc().body.classList.toggle("ui-collapsed");
    panelToggle.setAttribute("aria-expanded", String(!collapsed));
    panelToggle.setAttribute("aria-label", collapsed ? "Show control panel" : "Hide control panel");
    panelToggle.title = panelToggle.getAttribute("aria-label");
    panelToggle.querySelector("span").textContent = collapsed ? "›" : "‹";
    setTimeout(() => { frame.contentWindow.dispatchEvent(new Event("resize")); placePins(); }, 300);
  });
  doc().body.append(panelToggle);
  const reference = doc().createElement("button");
  reference.id = "referenceBtn"; reference.className = "cameraBtn referenceBtn"; reference.type = "button";
  reference.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="reference-target-dot" cx="6" cy="12" r="3"/><circle class="reference-chaser-dot" cx="18" cy="12" r="3"/><path d="M9.5 6.5h7l-2-2M14.5 17.5h-7l2 2"/></svg>';
  reference.addEventListener("click", () => { api()?.setReference(api().state.referenceSatellite === "A" ? "B" : "A"); syncClock(); });
  doc().getElementById("cameraControls").append(reference);
  nav.className = "e001-chapters"; nav.setAttribute("role", "group"); nav.setAttribute("aria-label", "Episode chapters");
  nav.style.setProperty("--chapter-count", String(chapters.length));
  chapters.forEach((chapter, index) => {
    const button = doc().createElement("button"); button.type = "button"; button.textContent = chapter.label; button.title = `${dateLabel(chapter.start)}–${dateLabel(chapter.end)}`;
    button.addEventListener("click", () => selectChapter(index)); nav.append(button);
  });
  dock.prepend(nav);
  const style = doc().createElement("style"); style.textContent = `
    #cameraDevTools{display:none!important}
    html,body{height:100%!important;min-height:100%!important;overflow:hidden!important}
    body{padding:0!important}
    body.e002-shared #ui{position:fixed!important;z-index:10!important;top:24px!important;left:18px!important;width:342px!important;height:calc(100vh - 138px)!important;max-height:calc(100vh - 138px)!important;overflow-y:auto!important;margin:0!important;padding:18px 18px 16px!important;border-radius:16px!important;background:#fffffff0!important;box-shadow:0 12px 35px rgba(0,0,0,.10)!important;transition:transform .28s ease,opacity .28s ease!important}
    body.e002-shared.ui-collapsed #ui{transform:translateX(calc(-100% - 18px));opacity:.2;pointer-events:none}
    #panelToggleBtn{position:fixed!important;z-index:15!important;top:56px!important;left:359px!important;display:grid!important;place-items:center!important;width:16px!important;height:40px!important;padding:0!important;border:1px solid #d8d8d8!important;border-left:0!important;border-radius:0 7px 7px 0!important;background:#ffffffd6!important;color:#999!important;font:400 17px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;cursor:pointer!important;transition:left .28s ease,background .15s ease,color .15s ease!important}
    #panelToggleBtn:hover,#panelToggleBtn:focus-visible{background:#f5f5f5!important;color:#555!important}
    body.ui-collapsed #panelToggleBtn{left:0!important}
    body.e002-shared #ui .episodeHeader h1{max-width:275px!important;font-size:24px!important;line-height:1.08!important;font-weight:800!important;letter-spacing:-.035em!important;white-space:normal!important}
    body.e002-shared #ui .episode-focus{position:relative!important;min-height:62px!important;margin:13px 0 0!important;padding:0!important;border:1px solid #ddd9d0!important;border-radius:9px!important;background:#fff!important}
    body.e002-shared #ui .episode-focus .titleEpisode{display:block!important;margin:6px 0 0!important;padding:0 0 0 17px!important;border:0!important;background:none!important;-webkit-text-fill-color:#38352d!important;color:#38352d!important;font-size:13px!important;font-weight:700!important;line-height:1.34!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important}
    body.e002-shared #ui .episodeHeader .episodeDescription{margin-top:11px!important;font-size:11px!important;line-height:1.42!important}
    body.e002-shared #ui .sourceSummary{display:none!important}
    body.e002-shared #ui .satCardGrid{display:grid!important;gap:9px!important}
    body.e002-shared #ui .satCard,body.e002-shared #ui .satCard.isCentre,body.e002-shared #ui .satCard[open]{border:1px solid #d2d2d2!important;border-radius:9px!important;background:#f1f1f1!important;box-shadow:none!important}
    body.e002-shared #ui .satCard>summary{box-sizing:border-box!important;height:43px!important;min-height:43px!important;padding:0 12px!important;gap:8px!important;background:transparent!important}
    body.e002-shared #ui .satCard .sourceDot{width:12px!important;height:12px!important;flex:0 0 12px!important;border:2px solid #191919!important}
    body.e002-shared #ui .satCard .satName{font-size:12px!important;font-weight:700!important;line-height:1.2!important}
    body.e002-shared #ui .satMetaDetails{margin:0 10px 8px!important;padding:0!important}
    body.e002-shared #ui .satMetaDetails .object-meta>div{grid-template-columns:103px minmax(0,1fr)!important;gap:5px!important}
    body.e002-shared #ui .pair-sticky .pair-sticky-name{display:inline-flex;align-items:center;gap:5px;padding:0;border:0;background:transparent;color:#454545;font-size:9px;white-space:nowrap}
    body.e002-shared #ui .pair-sticky .pair-sticky-name i{flex:0 0 8px;width:8px;height:8px;background:#eaaa00}
    body.e002-shared #ui #rangeStat,body.e002-shared #ui #speedStat{font-size:26px!important;line-height:1.2!important;font-weight:750!important}
    body.e002-shared #ui .metricBlock .minimumNote span{display:inline!important;margin-top:0!important}
    body.e002-shared #ui #separationChart,body.e002-shared #ui #speedChart{height:155px!important}
    body.e002-shared #ui .thresholdControl output{display:none!important}
    body.e002-shared #ui .thresholdControl .threshold-input-wrap{display:flex;align-items:center;gap:5px}
    body.e002-shared #ui .thresholdControl input[type=number]{width:62px!important;max-width:62px!important}
    body.e002-shared .playbackRow{grid-template-columns:26px 30px 26px minmax(0,1fr) max-content!important;grid-template-rows:24px!important;gap:0 5px!important}
    body.e002-shared .playbackRow .sliderNow{grid-column:5!important;grid-row:1!important;justify-self:end!important;width:auto!important;white-space:nowrap!important;font-size:9px!important}
    body.e002-shared .playbackDock{position:fixed!important;z-index:10!important;left:18px!important;bottom:18px!important;width:342px!important;max-width:calc(100vw - 36px)!important;margin:0!important;border-radius:12px!important;background:#fff!important;box-shadow:0 12px 35px rgba(0,0,0,.10)!important}
    .e001-chapters{display:grid;grid-template-columns:repeat(var(--chapter-count),minmax(0,1fr));gap:3px;margin:0 8px 5px;padding:2px;border:1px solid #d2d2d2;border-radius:7px;background:#f1f1f1}
    body.e002-shared #ui .episodeHeader h1{position:static!important;top:auto!important;margin:0 0 7px!important;padding:0!important;border:0!important;box-shadow:none!important;background:none!important}
    body.e002-shared #ui .episode-focus{border:1px solid #e3d4ab!important;border-left:3px solid #d6a527!important;background:#fff4cf!important}
    body.e002-shared #ui .episode-focus-link{padding:8px 10px 10px!important}
    body.e002-shared #ui .episode-focus .titleEpisode{margin:5px 0 0!important;padding:0!important;border:0!important;background:none!important;color:#3d382b!important;-webkit-text-fill-color:#3d382b!important;font-weight:700!important}
    body.e002-shared #ui .episode-focus-period{display:block;margin:4px 0 0;color:#857454;font-size:10px;line-height:1.25;font-weight:600}
    body.e002-shared #ui .pair-sticky{border-bottom:1px solid #e2d4ad!important;border-left:3px solid #d6a527!important;background:#fff4cf!important}
    body.e002-shared #ui .chartGroup .currentValue{width:max-content!important;min-width:0!important;max-width:calc(100% - 70px);padding-inline:2px!important}
    .e001-chapters button{min-height:25px;padding:2px;border:1px solid transparent;border-radius:5px;background:transparent;color:#777;font-size:10px;font-weight:700;cursor:pointer;transition:background .15s,color .15s,box-shadow .15s}
    .e001-chapters button:hover{background:#ffffffb3;color:#444}.e001-chapters button.active{border-color:#aaa;background:#fff;box-shadow:0 1px 3px #00000012;color:#333}
    #cameraControls .cameraBtn{font-size:18px!important;transition:background .15s,color .15s,box-shadow .15s!important}
    #cameraControls .cameraBtn:hover{background:#f5f5f5!important;box-shadow:0 4px 12px #00000016!important}
    #cameraControls .referenceBtn svg{width:24px;height:24px;fill:none;stroke:#666;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
    #cameraControls .referenceBtn .reference-target-dot{fill:#eaaa00;stroke:#333;stroke-width:1.3}
    #cameraControls .referenceBtn .reference-chaser-dot{fill:#aaa;stroke:#333;stroke-width:1.3;opacity:.45}
    #cameraControls .referenceBtn.is-chaser .reference-target-dot{opacity:.45}
    #cameraControls .referenceBtn.is-chaser .reference-chaser-dot{opacity:1}
    #cameraControls .referenceBtn:disabled{color:#aaa!important;background:#f4f4f4!important;opacity:.55;cursor:default!important}
    #cameraControls .referenceBtn:disabled:hover{background:#f4f4f4!important;box-shadow:0 3px 12px #0000001a!important}
    #gtLogo{position:fixed!important;z-index:9!important;right:24px!important;bottom:24px!important;width:min(300px,26vw)!important;opacity:.23!important;filter:grayscale(1)!important;overflow:hidden}
    #gtLogo::after{content:"";position:absolute;inset:-35% -45%;pointer-events:none;background:linear-gradient(115deg,transparent 36%,#ffffff2e 43%,#fffffff9 49%,#ffffff47 56%,transparent 64%);transform:translateX(-125%)}
    #gtLogo:hover::after,#gtLogo:focus-visible::after{animation:e001LogoGlint 1.25s ease-out forwards}
    @keyframes e001LogoGlint{to{transform:translateX(125%)}}
    @media(max-width:760px){body.e002-shared #ui{width:calc(100vw - 36px)!important;height:auto!important;max-height:calc(52vh - 54px)!important}body.e002-shared .playbackDock{width:calc(100vw - 36px)!important}#panelToggleBtn{left:calc(100vw - 19px)!important}body.ui-collapsed #panelToggleBtn{left:0!important}#gtLogo{width:160px!important}}
  `;
  doc().head.append(style);
  doc().getElementById("speed").value = "900";
}

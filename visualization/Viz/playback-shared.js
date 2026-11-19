const fullUtc = ms => new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(ms)) + " UTC";

// DD:HH:MM is elapsed time within the current continuous playback interval.
// It resets at an E-002 chapter boundary, where no intervening orbit is modeled.
export function elapsedDuration(ms) {
  const wholeMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(wholeMinutes / 1440), hours = Math.floor(wholeMinutes % 1440 / 60), minutes = wholeMinutes % 60;
  return { compact: `${String(days).padStart(2, "0")}:${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    spoken: `${days} ${days === 1 ? "day" : "days"}, ${hours} ${hours === 1 ? "hour" : "hours"}, ${minutes} ${minutes === 1 ? "minute" : "minutes"}` };
}

export function updatePlaybackCounter(node, elapsedMs, historicalMs) {
  const elapsed = elapsedDuration(elapsedMs);
  const label = `${fullUtc(historicalMs)} · ${elapsed.spoken} elapsed`;
  node.textContent = elapsed.compact;
  node.dataset.fullUtc = label;
  node.title = label;
  node.setAttribute("aria-label", label);
}

export function wireSpeedButtons(menu, down, up, onChange) {
  const update = () => {
    const selected = menu.selectedOptions[0];
    const rate = selected.textContent;
    down.setAttribute("aria-label", `Slow down; current speed ${rate}`);
    up.setAttribute("aria-label", `Speed up; current speed ${rate}`);
    down.title = down.getAttribute("aria-label"); up.title = up.getAttribute("aria-label");
    down.disabled = menu.selectedIndex === 0;
    up.disabled = menu.selectedIndex === menu.options.length - 1;
    onChange(Number(menu.value));
  };
  down.addEventListener("click", () => { menu.selectedIndex = Math.max(0, menu.selectedIndex - 1); update(); });
  up.addEventListener("click", () => { menu.selectedIndex = Math.min(menu.options.length - 1, menu.selectedIndex + 1); update(); });
  update();
}

export function wireTimelineHover(slider, hover, tick, range) {
  const wrap = slider.parentElement;
  wrap.addEventListener("pointermove", event => {
    const [start, end] = range(); if (!(end > start)) return;
    const rect = slider.getBoundingClientRect(), x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const minute = Math.max(start, Math.min(end, Math.round((start + x / rect.width * (end - start)) / 60000) * 60000));
    hover.textContent = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(minute)) + " UTC";
    tick.style.left = `${x}px`; hover.style.left = `${Math.max(40, Math.min(rect.width - 40, x))}px`;
    hover.style.transform = "translateX(-50%)"; hover.hidden = tick.hidden = false;
  });
  wrap.addEventListener("pointerleave", () => { hover.hidden = tick.hidden = true; });
}

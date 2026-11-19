/* The miniature uses the same rendered E-001 scene as the full public episode. */
export async function mountE001Preview(host) {
  if (!host.isConnected) return null;
  const frame = document.createElement("iframe");
  frame.className = "e001-mini";
  frame.title = "Animated E-001 satellite-centered orbital reconstruction";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.src = new URL("../visualization/Viz/compare.html?mini=1&episode=E-001", import.meta.url).href;
  host.dataset.previewFrame = "satellite-centered-relative";
  host.replaceChildren(frame);
  return {
    frame,
    setEarthColor() {},
    dispose() { frame.src = "about:blank"; frame.remove(); },
  };
}

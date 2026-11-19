// One screen-space marker design and object-color map for both applications.
export const MARKER = Object.freeze({ diameterPx: 12, outlinePx: 2, outline: "#191919",
  A: "#eaaa00", B: "#a9a9a9", C: "#707070" });

export function applyMarkerCssVariables(root = document.documentElement) {
  for (const [name, value] of Object.entries(MARKER))
    root.style.setProperty(`--marker-${name}`, name.endsWith("Px") ? `${value}px` : String(value));
}

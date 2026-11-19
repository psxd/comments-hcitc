// Split editable sheet text into ordinary prose and episode satellite references.
export function renderSatelliteShortcodes(value, renderText, resolveSatellite) {
  const fragment = document.createDocumentFragment();
  const expression = /\[sat:(\d{4}-\d{3}[A-Z]{1,3})\]/gi;
  let cursor = 0;
  for (const match of String(value || "").matchAll(expression)) {
    if (match.index > cursor) fragment.append(renderText(value.slice(cursor, match.index)));
    fragment.append(resolveSatellite(match[1].toUpperCase()) || document.createTextNode(match[0]));
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) fragment.append(renderText(value.slice(cursor)));
  return fragment;
}

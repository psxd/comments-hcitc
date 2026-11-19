// Episode Name is editorial text from the live sheet. Only intentional italics
// are retained; all attributes and active elements are discarded.
export function safeEpisodeName(value) {
  const fragment = document.createDocumentFragment();
  const parsed = new DOMParser().parseFromString(`<div>${String(value || "")}</div>`, "text/html").body.firstElementChild;
  const copy = (source, target) => {
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) target.append(document.createTextNode(child.textContent));
      else if (child.nodeType === Node.ELEMENT_NODE && !["SCRIPT", "STYLE", "IFRAME", "SVG", "MATH", "OBJECT", "EMBED", "TEMPLATE"].includes(child.tagName)) {
        const next = child.matches("i,em") ? document.createElement("em") : target;
        if (next !== target) target.append(next);
        copy(child, next);
      }
    }
  };
  copy(parsed, fragment);
  return fragment;
}

export function episodeNameText(value) {
  const holder = document.createElement("span");
  holder.append(safeEpisodeName(value));
  return holder.textContent;
}

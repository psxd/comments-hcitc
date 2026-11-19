/* Local E-002 review: use the lab's live, project-tagged glossary with an offline snapshot. */
const POPOVER_CLASS = "glossaryPopover";

function parseCsv(text) {
  const rows = []; let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function readEntries(csv, project) {
  const [header, ...records] = parseCsv(csv);
  if (!["Project", "Term", "Definition"].every(key => header?.includes(key))) throw new Error("Glossary columns are missing");
  return records.map(record => Object.fromEntries(header.map((key, index) => [key, String(record[index] || "").trim()])))
    .filter(row => row.Project === project && row.Term && row.Definition)
    .map(row => ({
      term: row.Term, acronym: row.Acronym || "", definition: row.Definition,
      sources: Array.from({ length: 5 }, (_, index) => {
        const label = row[`Source ${index + 1} display`] || "";
        const url = row[`Source ${index + 1} link`] || "";
        return label || url ? { label: label || url, url: url.startsWith("https://") ? url : "" } : null;
      }).filter(Boolean)
    }));
}

export async function installGlossary(panel, frame = null) {
  const data = await fetch(new URL("./glossary-data.json", import.meta.url), { cache: "no-store" }).then(response => response.json());
  let entries = data.entries;
  try {
    const response = await fetch(`${data.sourceUrl}&refresh=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const live = readEntries(await response.text(), data.project);
    if (!live.length) throw new Error("No matching project definitions");
    entries = live; document.body.dataset.glossarySource = "live";
  } catch (error) {
    console.warn("Using the local published glossary snapshot.", error);
    document.body.dataset.glossarySource = "snapshot";
  }
  document.body.dataset.glossaryEntries = String(entries.length);
  const variants = new Map();
  for (const entry of entries) for (const label of [entry.term, ...entry.acronym.split(";")].map(value => value.trim()).filter(Boolean)) variants.set(label.toLowerCase(), entry);
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[’']/g, "[’']");
  const expression = new RegExp(`(^|[^A-Za-z0-9])(${[...variants.keys()].sort((a, b) => b.length - a.length).map(escape).join("|")})(?=$|[^A-Za-z0-9])`, "gi");
  const popover = document.createElement("div"); popover.className = POPOVER_CLASS; popover.role = "dialog";
  popover.setAttribute("aria-label", "Glossary definition"); popover.hidden = true; document.body.append(popover);
  let active = null, hideTimer = null;
  const close = () => { clearTimeout(hideTimer); popover.hidden = true; active?.setAttribute("aria-expanded", "false"); active = null; };
  const scheduleClose = () => { clearTimeout(hideTimer); hideTimer = setTimeout(close, 180); };
  function show(trigger, entry) {
    clearTimeout(hideTimer); active?.setAttribute("aria-expanded", "false"); active = trigger; trigger.setAttribute("aria-expanded", "true");
    const heading = document.createElement("strong"); heading.textContent = entry.acronym ? `${entry.term} (${entry.acronym})` : entry.term;
    const definition = document.createElement("p"); definition.textContent = entry.definition;
    const sources = document.createElement("div"); sources.className = "glossarySources";
    entry.sources.forEach((source, index) => {
      if (index) sources.append(" · ");
      if (source.url) {
        const link = document.createElement("a"); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer";
        link.textContent = source.label; sources.append(link);
      } else sources.append(source.label);
    });
    popover.replaceChildren(heading, definition, sources); popover.hidden = false;
    const rect = trigger.getBoundingClientRect();
    const host = trigger.ownerDocument === document ? { left: 0, top: 0 } : frame?.getBoundingClientRect() || { left: 0, top: 0 };
    const left = Math.max(10, Math.min(rect.left + host.left, innerWidth - popover.offsetWidth - 10));
    const below = rect.bottom + host.top + 7;
    const top = below + popover.offsetHeight > innerHeight ? rect.top + host.top - popover.offsetHeight - 7 : below;
    popover.style.left = `${left}px`; popover.style.top = `${Math.max(8, top)}px`;
  }
  function triggerFor(label, entry, doc) {
    const trigger = doc.createElement("span"); trigger.className = "glossaryTrigger"; trigger.role = "button"; trigger.tabIndex = 0;
    trigger.setAttribute("aria-label", `Define ${label}`); trigger.setAttribute("aria-expanded", "false"); trigger.textContent = label;
    trigger.addEventListener("mouseenter", () => show(trigger, entry));
    trigger.addEventListener("mouseleave", scheduleClose);
    trigger.addEventListener("focus", () => show(trigger, entry));
    trigger.addEventListener("blur", event => { if (!popover.contains(event.relatedTarget)) scheduleClose(); });
    trigger.addEventListener("click", event => { event.stopPropagation(); show(trigger, entry); });
    trigger.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); trigger.click(); } });
    return trigger;
  }
  function annotate(root) {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim() || node.parentElement?.closest(".glossaryTrigger,button,a,select,option,script,style,textarea,.satCard[hidden]")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      expression.lastIndex = 0; let match, cursor = 0, found = false; const fragment = doc.createDocumentFragment();
      while ((match = expression.exec(node.nodeValue))) {
        const label = match[2], entry = variants.get(label.toLowerCase()); if (!entry) continue;
        const start = match.index + match[1].length;
        fragment.append(doc.createTextNode(node.nodeValue.slice(cursor, start)), triggerFor(label, entry, doc));
        cursor = start + label.length; found = true;
      }
      if (found) { fragment.append(doc.createTextNode(node.nodeValue.slice(cursor))); node.replaceWith(fragment); }
    }
  }
  function watch(root) {
    annotate(root); let pending = false;
    new MutationObserver(() => {
      if (pending) return; pending = true;
      setTimeout(() => { pending = false; annotate(root); }, 30);
    }).observe(root, { childList: true, characterData: true, subtree: true });
  }
  watch(panel);
  function watchFrame() {
    const doc = frame.contentDocument, root = doc?.getElementById("preview") || doc?.getElementById("ui");
    if (!root || root.dataset.glossaryAttached) return;
    root.dataset.glossaryAttached = "true";
    const style = doc.createElement("style");
    style.textContent = ".glossaryTrigger{text-decoration:underline dotted #8b8b8b;text-underline-offset:2px;cursor:help}.glossaryTrigger:focus-visible{outline:2px solid #8b773c;outline-offset:2px;border-radius:2px}";
    doc.head.append(style);
    if (root !== panel) watch(root);
  }
  if (frame) { frame.addEventListener("load", watchFrame); watchFrame(); }
  popover.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  popover.addEventListener("mouseleave", scheduleClose);
  document.addEventListener("click", event => { if (!popover.contains(event.target) && !event.target.closest?.(".glossaryTrigger")) close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
}

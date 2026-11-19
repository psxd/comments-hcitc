import { emojiForOwner, flagsForOwner } from "./flag-icons.js";
import { renderSatelliteShortcodes } from "./satellite-shortcodes.js";
import { loadCurrentEpisodes, loadCurrentDescriptions, episodeUtcInterval, episodeChapters, cleanCospar } from "../shared/episode-feed.js?v=5";
import { calculateE001 } from "../shared/e001-live-metrics.js";
import { historicalEpisodeMetrics } from "../shared/historical-episode-metrics.js";
import { safeEpisodeName, episodeNameText } from "../shared/episode-name.js";
import { estimatedValue } from "../shared/estimated-values.js?v=3";
import { applyMarkerCssVariables } from "../shared/marker-spec.js?v=3";

applyMarkerCssVariables();

const $ = selector => document.querySelector(selector);
const el = (tag, className = "", value) => { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; };
const field = (row, ...names) => {
  const cells = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), String(value ?? "").trim()]));
  return names.map(name => cells[name.toLowerCase().replace(/[^a-z0-9]/g, "")]).find(Boolean) || "";
};
const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; } };
const EARTH_COLOR = 0xedeae5;
const localE003Review = ["localhost", "127.0.0.1"].includes(location.hostname) && location.port === "8769";
const hasEpisodeVisual = id => ["E-001", "E-002", "E-003", "E-005", "E-006", "E-008", "E-016", "E-059"].includes(id);
const state = { live: null, preview: null, series: null, seriesPromise: null, e002Metrics: null, historicalMetrics: {}, usePreview: false, selected: null, query: "", sort: { key: "index", direction: "asc" }, glossary: [], details: new Map(), detailPending: new Map(), detailFailures: new Set() };
const prefetch = { queue: [], active: 0, scheduled: false, images: [], imageActive: 0, imageSeen: new Set() };
let sourceCarouselCleanup = () => {};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");


function dateText(value) {
  if (!value) return "Date not recorded";
  const iso = String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!iso) return value;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date) + value.slice(iso.length);
}
function fullDate(value) {
  const iso = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso ? "" :
    new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
function periodInfo(row) {
  const chapters = episodeChapters(row);
  const start = chapters[0]?.center.slice(0, 10) || field(row, "Start Date", "Date");
  const end = chapters.at(-1)?.center.slice(0, 10) || field(row, "End Date");
  const portion = value => {
    const found = String(value).match(/^(\d{4})(?:-(\d{2}))?/);
    if (!found) return null;
    const year = Number(found[1]), month = Number(found[2]);
    if (!month) return { year, label: String(year), part: "" };
    if (month < 1 || month > 12) return null;
    const part = month <= 4 ? "early" : month <= 8 ? "mid" : "late";
    return { year, label: `${part[0].toUpperCase()}${part.slice(1)} ${year}`, part };
  };
  const a = portion(start), b = portion(end);
  const days = chapters.length ? null : fullDate(start) && fullDate(end) && end >= start ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 : null;
  if (!a && !b) return { label: "Dates not recorded", days };
  if (!b || !a || end < start || a.label === b.label) return { label: a?.label || b.label, days };
  return { label: a.year === b.year && a.part && b.part ? `${a.label.split(" ")[0]} to ${b.part} ${a.year}` : `${a.label} to ${b.label[0].toLowerCase()}${b.label.slice(1)}`, days };
}
function period(row) { return periodInfo(row).label; }
function dateKey(row) { return episodeChapters(row)[0]?.start || field(row, "Start Date", "Date").match(/^\d{4}(?:-\d{2})?(?:-\d{2})?/)?.[0] || ""; }
function descriptionIds(row) { return field(row, "Descriptions").split(/[,;\n]/).map(x => x.trim()).filter(Boolean); }
function descriptionEpisodes(row) { return field(row, "Episode", "Episode ID").split(/[,;\n]/).map(id => id.trim().toUpperCase()).filter(Boolean); }
function linkedDescriptions(row, data) {
  const episode = field(row, "ID").toUpperCase();
  return (data.descriptions || []).filter(item => descriptionEpisodes(item).includes(episode))
    .map(item => ({ id: field(item, "ID", "Description ID"), row: item }));
}
function sourceGroups(row, data) {
  const groups = new Map();
  for (const item of linkedDescriptions(row, data)) {
    const ref = field(item.row, "Source URL", "URL", "Link", "Source link");
    // The published record retains an old NYT slug. Keep the sheet as the
    // record source while taking readers to the article's canonical URL.
    const url = safeUrl(ref === "https://www.nytimes.com/2026/10/19/science/russia-satellite-kosmos-2612.html"
      ? "https://www.nytimes.com/2026/10/19/science/russian-satellite-makes-a-menacing-approach-to-another-craft-in-orbit.html" : ref);
    const key = ref || `record:${item.id}`;
    if (!groups.has(key)) groups.set(key, { url, ref, items: [] });
    groups.get(key).items.push(item);
  }
  const publicationDay = group => {
    const value = field(group.items[0]?.row, "Override Date") || reviewedSourceMetadata[group.ref]?.publishedDate || data.sourceMetadata?.[group.ref]?.publishedDate || field(group.items[0]?.row, "Publication date", "Published date");
    const iso = String(value || "").match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
    return iso && fullDate(iso) ? Date.parse(`${iso}T00:00:00Z`) : Infinity;
  };
  // Map insertion order is the linked-record order; stable sort preserves ties and undated records.
  return [...groups.values()].sort((a, b) => publicationDay(a) - publicationDay(b));
}
function organizationKind(info) {
  if (/^INTELSAT\b/i.test(info.name)) return "Intelsat";
  if (info.owner === "ESA" || /^(?:ESA |ESA-)/i.test(info.name)) return "ESA";
  if (/^(?:EUTELSAT|INMARSAT|SES\b)/i.test(info.name)) return "International operator";
  return "";
}
function ownerDisplay(info) {
  if (info.owner === "CIS") return "Russia (CIS)";
  if (info.owner === "FRIT") return "France 🇫🇷 / Italy 🇮🇹";
  if (info.owner === "PRC") return "China (PRC)";
  if (info.owner === "US") return "United States (US)";
  if (info.owner === "UK") return "United Kingdom (UK)";
  if (info.owner === "ITSO") return "Intelsat (ITSO)";
  return info.ownerName || info.owner;
}
function ownerIndicators(info, compact = false) {
  const org = organizationKind(info);
  if (org && compact) { const badge = el("span", "organization-badge", org === "Intelsat" ? "Intelsat" : org === "ESA" ? "ESA" : "Intl."); badge.title = `${org} text indicator`; badge.setAttribute("aria-label", `${org} text indicator`); return [badge]; }
  const flags = flagsForOwner(info.owner);
  if (flags.length) return flags;
  if (org) { const badge = el("span", "organization-badge", org === "Intelsat" ? "Intelsat" : org === "ESA" ? "ESA" : "Intl."); badge.title = `${org} text indicator`; return [badge]; }
  return [];
}
function objectInfo(row, role, data) {
  const raw = field(row, `Object ${role}`);
  if (!cleanCospar(raw)) return null;
  const spaceRecord = data.spaceTrack?.records?.[raw.toUpperCase()];
  if (data.spaceTrack) return { role, raw, record: null, source: "space-track", satcat: spaceRecord || null, gp: null,
    cospar: spaceRecord?.OBJECT_ID || raw, norad: spaceRecord?.NORAD_CAT_ID || "",
    name: spaceRecord?.SATNAME || spaceRecord?.OBJECT_NAME || raw, owner: spaceRecord?.COUNTRY || "",
    ownerName: "", launchSite: data.spaceTrack.launchSiteNames?.[spaceRecord?.SITE] || spaceRecord?.SITE || "", launchSiteFromCsis: false, csisSourceUrl: "" };
  const record = data.celestrak?.objects?.[raw.toUpperCase()] || null;
  const satcat = record?.status === "resolved" ? record.satcat : null;
  const compact = data.compactObjects?.[raw.toUpperCase()] || currentData()?.compactObjects?.[raw.toUpperCase()] || {};
  return { role, raw, record, satcat, gp: record?.gp || null,
    cospar: satcat?.OBJECT_ID || compact.cospar || raw, norad: satcat?.NORAD_CAT_ID || compact.norad || "",
    name: satcat?.OBJECT_NAME || compact.name || raw, owner: satcat?.OWNER || "",
    ownerName: record?.ownerName || "", launchSite: data.celestrak?.csisLaunchSites?.[satcat?.LAUNCH_SITE] || data.celestrak?.launchSites?.[satcat?.LAUNCH_SITE] || satcat?.LAUNCH_SITE || "",
    launchSiteFromCsis: !!data.celestrak?.csisLaunchSites?.[satcat?.LAUNCH_SITE], csisSourceUrl: data.celestrak?.csisSourceUrl || "" };
}
function titleMarkup(row) { return field(row, "Episode Name", "Episode label", "Episode Title", "Title") || field(row, "ID") || "Unnamed episode"; }
function publicEpisodeId(row) { return field(row, "Episode ID", "ID"); }
function title(row) { return episodeNameText(titleMarkup(row)); }
function episodeDescription(row) { return field(row, "Episode Description"); }
function formattedDescription(value) {
  const fragment = document.createDocumentFragment();
  const parsed = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html").body.firstElementChild;
  const allowed = new Set(["P", "EM", "I", "STRONG", "B", "BR"]);
  function copy(source, target) {
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) target.append(document.createTextNode(child.textContent.replace(/(\p{L})'(\p{L})/gu, "$1’$2")));
      else if (child.nodeType === Node.ELEMENT_NODE && !["SCRIPT", "STYLE", "IFRAME", "SVG"].includes(child.tagName)) {
        const next = allowed.has(child.tagName) ? document.createElement(child.tagName.toLowerCase()) : target;
        if (next !== target) { if (next.tagName === "P") next.className = "episode-description"; target.append(next); }
        copy(child, next);
      }
    }
  }
  if (parsed.querySelector("p")) copy(parsed, fragment);
  else { const paragraph = el("p", "episode-description"); copy(parsed, paragraph); fragment.append(paragraph); }
  return fragment;
}
function account(row) { return field(row, "Reported behavior", "Short Description", "Summary", "Context", "Description"); }
function regime(row) { return field(row, "Orbital Regime", "Orbit Regime", "Orbit", "Regime") || "Not recorded"; }
function regimeShort(row) { const full = regime(row), match = full.match(/\b(LEO|MEO|GEO|HEO|GTO|SSO)\b/i); return match ? match[1].toUpperCase() : /sun[ -]?synchronous/i.test(full) ? "SSO" : full; }

function externalLink(label, url) {
  const a = el("a", "espl-external"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
  a.append(document.createTextNode(label));
  a.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path class="espl-news-external__box" d="M7.25 4.25H4.5A1.75 1.75 0 0 0 2.75 6v7.5a1.75 1.75 0 0 0 1.75 1.75H12a1.75 1.75 0 0 0 1.75-1.75v-2.75"></path><g class="espl-news-external__arrow"><path d="M9.25 2.75h6v6"></path><path d="m8 10 7.25-7.25"></path></g></svg>');
  return a;
}
function visualizationLink(url, label = "Open orbital visualization") {
  const link = el("a", "visual-link model-link"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.setAttribute("aria-label", label);
  const preview = el("div", "orbital-preview");
  link.append(preview);
  return link;
}
function visualizationActionLink(url, label = "Open orbital visualization") {
  const link = el("a", "context-model-link model-link"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.setAttribute("aria-label", label);
  const action = el("span", "model-action"), icon = el("span", "model-icon"), fallback = el("img", "model-static"), flourish = el("canvas", "model-canvas");
  fallback.src = "./assets/polyhedron-icon.png"; fallback.alt = "";
  flourish.width = flourish.height = 116; flourish.setAttribute("aria-hidden", "true");
  icon.append(fallback, flourish);
  action.append(icon, el("span", "model-label", "Explore the interactive model"), el("span", "model-arrow", "→"));
  link.append(action);
  import("./model-link.js?v=4").then(module => module.decorateModelLink(link)).catch(() => link.classList.add("model-static-fallback"));
  return link;
}

const popover = el("div", "object-popover"); popover.id = "object-popover"; popover.hidden = true; popover.setAttribute("role", "dialog"); popover.setAttribute("aria-label", "Space object metadata"); document.body.append(popover);
let activeObject = null, pinnedObject = false, hideTimer = null, showTimer = null;
function closeObject() { clearTimeout(hideTimer); clearTimeout(showTimer); if (activeObject) activeObject.setAttribute("aria-expanded", "false"); activeObject = null; pinnedObject = false; popover.hidden = true; }
function scheduleObjectClose() { clearTimeout(hideTimer); clearTimeout(showTimer); if (!pinnedObject) hideTimer = setTimeout(() => { if (!popover.matches(":hover") && !popover.contains(document.activeElement)) closeObject(); }, 320); }
function addMetadata(dl, label, value) { if (!value) return; const item = el("div"); item.append(el("dt", "", label), el("dd", "", value)); dl.append(item); }
const launchFlagEmoji = { AFETR:["🇺🇸"], AFWTR:["🇺🇸"], DLS:["🇷🇺"], FRGUI:["🇫🇷"], JSC:["🇨🇳"], PKMTR:["🇷🇺"], PLMSC:["🇷🇺"], RLLB:["🇳🇿"], SRILR:["🇮🇳"], TAISC:["🇨🇳"], TANSC:["🇯🇵"], TTMTR:["🇰🇿","🇷🇺"], TYMSC:["🇰🇿","🇷🇺"], WSC:["🇨🇳"], XICLF:["🇨🇳"] };
function buildObjectPopover(info) {
  popover.replaceChildren(); popover.append(el("strong", "object-popover-title", info.name));
  if (!info.satcat) {
    const spaceTrack = info.source === "space-track";
    popover.append(el("p", "metadata-note", `No exact ${spaceTrack ? "Space-Track" : "CelesTrak"} SATCAT match for ${info.raw}. Identity remains unresolved.`));
    popover.append(externalLink(spaceTrack ? "Space-Track" : "CelesTrak", spaceTrack ? `https://www.space-track.org/basicspacedata/query/class/satcat/OBJECT_ID/${encodeURIComponent(info.raw)}/format/html` : `https://celestrak.org/satcat/search.php?SEARCH=${encodeURIComponent(info.raw)}`));
    return;
  }
  const s = info.satcat, dl = el("dl", "object-meta");
  const objectTypes = { PAY:"Payload", PAYLOAD:"Payload", "R/B":"Rocket body", "ROCKET BODY":"Rocket body", DEB:"Debris", DEBRIS:"Debris", TBA:"To be assigned" };
  addMetadata(dl, "COSPAR ID", s.OBJECT_ID);
  addMetadata(dl, "NORAD ID", s.NORAD_CAT_ID);
  const ownerRow = el("div"), ownerValue = el("dd"); ownerRow.append(el("dt", "", "Country"));
  ownerValue.append(document.createTextNode(ownerDisplay(info)));
  if (!organizationKind(info) && info.owner !== "FRIT") for (const flag of emojiForOwner(info.owner)) ownerValue.append(document.createTextNode(` ${flag}`));
  ownerRow.append(ownerValue); dl.append(ownerRow);
  addMetadata(dl, "Object type", objectTypes[s.OBJECT_TYPE] || s.OBJECT_TYPE);
  addMetadata(dl, "Launch date", fullDate(s.LAUNCH || s.LAUNCH_DATE));
  const siteCode = s.SITE || s.LAUNCH_SITE;
  if (info.launchSite) addMetadata(dl, "Launch site", `${info.launchSite.replace(/\s*\(/g, " (")}${(launchFlagEmoji[siteCode] || []).map(flag => ` ${flag}`).join("")}`);
  popover.append(dl);
  const sourceRow = el("div", "object-source-row"), sourceValue = el("dd");
  sourceRow.append(el("dt", "", "Data source"));
  sourceValue.append(externalLink(info.source === "space-track" ? "Space-Track" : "CelesTrak", info.source === "space-track" ? `https://www.space-track.org/basicspacedata/query/class/satcat/NORAD_CAT_ID/${encodeURIComponent(s.NORAD_CAT_ID)}/format/html` : info.record?.recordUrl || `https://celestrak.org/satcat/search.php?SEARCH=${encodeURIComponent(s.NORAD_CAT_ID)}`));
  sourceRow.append(sourceValue); dl.append(sourceRow);
}
function positionObject() {
  if (!activeObject || popover.hidden) return;
  const trigger = activeObject.getBoundingClientRect(), width = popover.offsetWidth, height = popover.offsetHeight;
  const rightSide = trigger.right + width + 12 <= innerWidth - 10;
  const leftSide = trigger.left - width - 12 >= 10;
  const left = rightSide ? trigger.right + 12 : leftSide ? trigger.left - width - 12 : Math.max(10, Math.min(trigger.left, innerWidth - width - 10));
  const below = trigger.bottom + height + 12 <= innerHeight;
  const top = rightSide || leftSide ? trigger.top - 7 : below ? trigger.bottom + 8 : trigger.top - height - 8;
  popover.style.left = `${left}px`; popover.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
}
function showObject(button, info, pin = false, row = null) {
  clearTimeout(hideTimer);
  if (activeObject && activeObject !== button) activeObject.setAttribute("aria-expanded", "false");
  activeObject = button; pinnedObject = pin; button.setAttribute("aria-expanded", "true");
  const cached = row && state.details.get(field(row, "ID"));
  if (cached) buildObjectPopover(objectInfo(cached.row, info.role, cached));
  else if (row && currentData()?.source === "live") {
    popover.replaceChildren(el("span", "metadata-note", `Loading ${info.source === "space-track" ? "Space-Track" : "CelesTrak"} record…`));
    ensureDetail(row).then(detail => {
      if (activeObject !== button || !detail) return;
      buildObjectPopover(objectInfo(detail.row, info.role, detail)); positionObject();
    }).catch(() => { if (activeObject === button) popover.replaceChildren(el("span", "metadata-note", "Catalog details unavailable.")); });
  } else buildObjectPopover(info);
  popover.hidden = false; positionObject();
}
popover.addEventListener("pointerenter", () => clearTimeout(hideTimer));
popover.addEventListener("pointerleave", scheduleObjectClose);
document.addEventListener("pointerdown", event => { if (activeObject && !activeObject.contains(event.target) && !popover.contains(event.target)) closeObject(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeObject(); });
window.addEventListener("resize", positionObject); window.addEventListener("scroll", positionObject, true);
function objectNode(info, row) {
  const line = el("div", "object-line"), button = el("button", "object-trigger", info.name);
  button.type = "button"; button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-label", `${info.name}, show object metadata`);
  line.append(el("span", `dot ${info.role.toLowerCase()}${field(row, "ID") === "E-002" && info.role === "C" ? " e002-chaser" : ""}`), button);
  if (field(row, "ID") === "E-002" && info.role === "C") line.classList.add("e002-inactive-chaser");
  if (info.cospar) line.append(el("span", "object-id", info.cospar));
  button.addEventListener("pointerenter", () => { if (matchMedia("(hover:hover)").matches) { clearTimeout(hideTimer); clearTimeout(showTimer); showTimer = setTimeout(() => showObject(button, info, false, row), 90); } });
  button.addEventListener("pointerleave", scheduleObjectClose);
  button.addEventListener("focus", () => showObject(button, info, false, row));
  button.addEventListener("blur", () => { if (!popover.contains(document.activeElement)) scheduleObjectClose(); });
  button.addEventListener("click", event => { event.stopPropagation(); if (activeObject === button && pinnedObject) closeObject(); else showObject(button, info, true, row); });
  return line;
}
function objects(row, data) {
  const wrap = el("div", "objects");
  for (const role of field(row, "ID") === "E-002" ? ["A", "C", "B"] : ["A", "B", "C"]) { const info = objectInfo(row, role, data); if (info) wrap.append(objectNode(info, row)); }
  if (!wrap.children.length) wrap.append(el("span", "muted", "Objects not recorded"));
  return wrap;
}

function glossaryText(value) {
  const fragment = document.createDocumentFragment();
  const variants = state.glossary.flatMap(entry => [field(entry, "Term"), ...field(entry, "Acronym").split(";").map(x => x.trim())].filter(Boolean).map(label => ({ label, entry }))).sort((a, b) => b.label.length - a.label.length);
  if (!variants.length) { fragment.append(document.createTextNode(value)); return fragment; }
  const escaped = variants.map(item => item.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let expression; try { expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped.join("|")})(?=$|[^\\p{L}\\p{N}])`, "giu"); } catch { fragment.append(document.createTextNode(value)); return fragment; }
  let cursor = 0, match;
  while ((match = expression.exec(value))) {
    const start = match.index + match[1].length, label = match[2]; if (start < cursor) continue;
    const entry = variants.find(item => item.label.toLocaleLowerCase() === label.toLocaleLowerCase())?.entry; if (!entry) continue;
    fragment.append(document.createTextNode(value.slice(cursor, start)));
    const term = el("span", "gterm", label); term.tabIndex = 0; term.setAttribute("aria-label", `${label}: ${field(entry, "Definition")}`); term.append(el("span", "gterm-tip", field(entry, "Definition")));
    fragment.append(term); cursor = start + label.length;
  }
  fragment.append(document.createTextNode(value.slice(cursor))); return fragment;
}

function descriptionText(value) { return glossaryText(value); }
export function episodeDescriptionText(value, row, data) {
  return renderSatelliteShortcodes(value, descriptionText, id => {
    const role = ["A", "B", "C"].find(candidate => field(row, `Object ${candidate}`).toUpperCase() === id);
    if (!role) return null;
    const info = objectInfo(row, role, data);
    if (!info) return null;
    const node = objectNode(info, row);
    node.classList.add("sat-shortcode");
    return node;
  });
}

function currentData() { return state.usePreview && state.live?.source !== "live" ? state.preview : state.live; }
function rowMetric(row, key) {
  const id = field(row, "ID"), name = key === "distance" ? "minimumDistance" : "minimumSpeed";
  return id === "E-001" ? state.series?.[name] : id === "E-002" ? state.e002Metrics?.[name] : state.historicalMetrics[id]?.[name];
}
function visibleRows() {
  const data = currentData(); if (!data) return [];
  const query = state.query.toLocaleLowerCase();
  const rows = data.episodes.filter(row => {
    if (!query) return true;
    const terms = [publicEpisodeId(row), title(row), episodeDescription(row), account(row), regime(row), regimeShort(row), ...["A", "B", "C"].flatMap(role => { const info = objectInfo(row, role, data); return info ? [info.name, info.cospar, info.norad, info.owner, ownerDisplay(info)] : []; })];
    return terms.join(" ").toLocaleLowerCase().includes(query);
  });
  const { key, direction } = state.sort, sign = direction === "asc" ? 1 : -1;
  if (key === "index") return rows;
  rows.sort((a, b) => {
    let av, bv;
    if (key === "date") { av = dateKey(a); bv = dateKey(b); if (!av) return bv ? 1 : 0; if (!bv) return -1; }
    else if (key === "sources") { av = linkedDescriptions(a, data).length; bv = linkedDescriptions(b, data).length; }
    else if (key === "distance" || key === "speed") {
      av = rowMetric(a, key)?.value;
      bv = rowMetric(b, key)?.value;
      if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
      if (!Number.isFinite(bv)) return -1;
    }
    else { av = title(a); bv = title(b); }
    const compare = typeof av === "number" ? av - bv : av.localeCompare(bv, undefined, { numeric: true });
    return sign * compare || field(a, "ID").localeCompare(field(b, "ID"), undefined, { numeric: true });
  });
  return rows;
}
function updateSortHeaders() {
  for (const button of document.querySelectorAll(".sort-head")) {
    const active = button.dataset.sort === state.sort.key, th = button.closest("th");
    th.setAttribute("aria-sort", active ? (state.sort.direction === "desc" ? "descending" : "ascending") : "none");
    button.querySelector(".sort-indicator").textContent = active ? (state.sort.direction === "desc" ? "↓" : "↑") : "";
  }
}
function ensureDetail(row) {
  const id = field(row, "ID");
  if (state.details.has(id)) return Promise.resolve(state.details.get(id));
  if (state.detailPending.has(id)) return state.detailPending.get(id);
  const pending = Promise.resolve().then(() => {
    const data = state.live;
    const fullRow = data?.episodes?.find(item => field(item, "ID") === id);
    if (!fullRow) throw new Error(`Episode ${id} is unavailable`);
    const descriptions = linkedDescriptions(fullRow, data).map(item => item.row);
    const urls = new Set(descriptions.map(item => field(item, "Source URL", "URL", "Link")));
    const objectIds = new Set(["A", "B", "C"].map(role => field(fullRow, `Object ${role}`).toUpperCase()).filter(Boolean));
    const detail = { source: data.source, row: fullRow, descriptions, sourceMetadata: Object.fromEntries(Object.entries(data.sourceMetadata || {}).filter(([url]) => urls.has(url))), spaceTrack: data.spaceTrack,
      celestrak: { ...(data.celestrak || {}), objects: Object.fromEntries(Object.entries(data.celestrak?.objects || {}).filter(([key]) => objectIds.has(key.toUpperCase()))) }, glossary: data.glossary || [] };
    state.details.set(id, detail); state.detailFailures.delete(id); state.glossary = detail.glossary || state.glossary;
    prefetchDetailImages(detail);
    return detail;
  }).finally(() => state.detailPending.delete(id));
  state.detailPending.set(id, pending); return pending;
}
function prefetchDetailImages(detail) {
  for (const meta of Object.values(detail.sourceMetadata || {})) {
    const path = meta.imagePath || meta.previewPath;
    if (!path || prefetch.imageSeen.has(path)) continue;
    prefetch.imageSeen.add(path); prefetch.images.push(path);
  }
  pumpImages();
}
function pumpImages() {
  while (prefetch.imageActive < 2 && prefetch.images.length) {
    const image = new Image(), path = prefetch.images.shift();
    prefetch.imageActive++;
    image.onload = image.onerror = () => { prefetch.imageActive--; pumpImages(); };
    image.src = path;
  }
}
function pumpDetails() {
  while (prefetch.active < 3 && prefetch.queue.length) {
    const row = prefetch.queue.shift(), id = field(row, "ID");
    if (state.details.has(id) || state.detailPending.has(id) || state.detailFailures.has(id)) continue;
    prefetch.active++;
    ensureDetail(row).catch(error => { state.detailFailures.add(id); console.warn(`Background detail unavailable for ${id}:`, error); })
      .finally(() => { prefetch.active--; pumpDetails(); });
  }
}
function scheduleDetailPrefetch() {
  if (prefetch.scheduled) return;
  prefetch.scheduled = true;
  requestAnimationFrame(() => {
    prefetch.scheduled = false;
    const rows = visibleRows(), visible = [], later = [];
    const rowElements = new Map([...document.querySelectorAll("#rows tr.episode-row")].map(node => [node.dataset.episodeId, node]));
    for (const row of rows) {
      const tr = rowElements.get(field(row, "ID"));
      const rect = tr?.getBoundingClientRect();
      (rect && rect.bottom > 0 && rect.top < innerHeight ? visible : later).push(row);
    }
    const seen = new Set();
    prefetch.queue = [...visible, ...later, ...prefetch.queue].filter(row => {
      const id = field(row, "ID");
      if (seen.has(id)) return false;
      seen.add(id);
      return !state.details.has(id) && !state.detailPending.has(id) && !state.detailFailures.has(id);
    });
    pumpDetails();
  });
}
function recordCategory(row) {
  const category = field(row, "Category");
  if (category) return [category, /reaction/i.test(category) ? "announcement" : /commentary|reporting/i.test(category) ? "press" : "document"];
  const type = field(row, "Description type", "Voice type").toUpperCase();
  if (type.startsWith("T01")) return ["Official reaction", "announcement"];
  if (type.startsWith("T03")) return ["Technical account", "document"];
  if (type.startsWith("T04")) return ["Commentary", "press"];
  if (type.startsWith("T05")) return ["Research analysis", "document"];
  if (type.startsWith("T06")) return ["Technical observation", "press"];
  return ["Source record", "document"];
}
function categoryIcon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", kind === "announcement" ? "M3 10h4l10-5v14L7 14H3z M7 14l2 5h3 M20 9c1 2 1 4 0 6" : kind === "press" ? "M4 4h14v16H5a2 2 0 0 1-2-2V4z M18 7h3v11a2 2 0 0 1-2 2 M7 8h8 M7 12h8 M7 16h5" : "M6 3h9l4 4v14H6z M15 3v5h4 M9 12h7 M9 16h7");
  svg.append(path); return svg;
}
function sourceFallback(meta, row, url, documentSource) {
  const fallback = el("span", "source-fallback source-record-preview");
  const publisher = meta.publisher || field(row, "Source", "Publisher", "Organization", "Outlet", "State / affiliation / joint signatories") || (url ? new URL(url).hostname.replace(/^www\./, "") : "Source record");
  const title = meta.titleEnglish || meta.title || (documentSource ? "Source document" : "Source page");
  fallback.append(el("span", "source-record-publisher", publisher), el("span", "source-record-title", title));
  return fallback;
}
const reviewedSourceMetadata = {
  "https://www.nytimes.com/2026/10/19/science/russia-satellite-kosmos-2612.html": {
    title: "Russian Satellite Makes a Menacing Approach to Another Craft in Orbit",
    publisher: "The New York Times",
    publishedDate: "2026-10-19",
    previewPath: "./assets/source-previews/e008-iceye-satellite.jpg",
    imageAlt: "ICEYE artist's concept of a radar satellite, from ICEYE's press imagery",
  },
  "https://hansard.parliament.uk/commons/2021-07-14/debates/D9862D76-47F8-4DE4-AC12-9BAA4A3BD7AF/SpaceDebris": {
    kind: "document",
    title: "Space Debris",
    publisher: "UK Parliament Hansard",
    publishedDate: "2021-07-14",
    imagePath: "./assets/source-previews/e008-hansard-parliament.jpg",
    imageAlt: "UK Parliament graphic with portcullis and Palace of Westminster",
  },
  "https://vpk.name/news/376303_v_mid_otvetili_na_obvineniya_ssha_v_presledovanii_amerikanskogo_sputnika.html": {
    publisher: "VPK.name",
  },
  "https://aerospace.csis.org/data/unusual-behavior-in-geo-sj-17/": {
    title: "Unusual Behavior in GEO: SJ-17",
    publisher: "CSIS Aerospace Security",
    publishedDate: "2022-09-01",
    imagePath: "./assets/source-previews/e008-csis-sj17.jpg",
    imageAlt: "Social sharing image for the CSIS analysis of SJ-17",
  },
  "https://www.airuniversity.af.edu/Portals/10/AEtherJournal/Journals/Volume-1_Number-4/Weeden_Mitigating_Noncooperative_RPOs_.pdf": {
    publisher: "Johnson, Roberts, and Weeden",
  },
  "https://breakingdefense.com/2021/10/us-china-russia-test-new-space-war-tactics-sats-buzzing-spoofing-spying/": {
    title: "US, China, Russia Test New Space War Tactics: Sats Buzzing, Spoofing, Spying",
  },
  "https://www.swfound.org/publications-and-reports/u-s-military-and-intelligence-rendezvous-and-proximity-operations-fact-sheet": {
    kind: "document",
    title: "US Military and Intelligence Rendezvous and Proximity Operations Fact Sheet",
    publisher: "Secure World Foundation",
    publishedDate: "2026-06-12",
    previewPath: "./assets/source-previews/e003-swf-fact-sheet-first-page.jpg",
    imageAlt: "First page of the original Secure World Foundation fact sheet",
  },
  "https://www.globalsecurity.org/space/library/news/2022/space-220630-globaltimes01.htm": {
    publisher: "Global Times",
    publishedDate: "2022-06-30",
  },
  "https://amostech.com/TechnicalPapers/2024/Poster/Serrano.pdf": {
    kind: "document",
    title: "Monitoring of rendezvous and proximity operations with SST and SDA techniques combination",
    publisher: "AMOS Conference",
    publishedDate: "2024-09-01",
    publishedLabel: "September 2024",
    previewPath: "./assets/source-previews/d041-serrano-first-page.jpg",
    imageAlt: "First page of Serrano and colleagues’ 2024 AMOS paper",
  },
  "https://spacenews.com/an-in-orbit-game-of-cat-and-mouse-close-approaches-prompt-calls-for-communications-and-norms/": {
    title: "An In-Orbit Game of Cat and Mouse: Close approaches prompt calls for communications and norms",
    publisher: "SpaceNews",
    publishedDate: "2022-06-16",
    imagePath: "./assets/source-previews/e005-spacenews-cat-and-mouse.jpg",
    imageAlt: "Featured illustration from the SpaceNews report",
  },
  "https://www.researching.cn/ArticlePdf/m00018/2023/52/4/20220759.pdf": {
    kind: "document",
    title: "GSSAP 卫星在轨应用研究与成像仿真分析",
    titleEnglish: "Research on GSSAP Satellite In-Orbit Applications and Imaging Simulation Analysis",
    publisher: "Infrared and Laser Engineering",
    publishedDate: "2023-04",
    publishedLabel: "April 2023",
    previewPath: "./assets/source-previews/e003-gssap-irla-first-page.jpg",
    imageAlt: "First page of the published GSSAP research paper",
  },
  "https://estatements.un.org/estatements/11.0010/20261021100000000/VCYntJPvffMzJVH/ElYgHPjnLTLPRvy_nyc_en.pdf": {
    kind: "document",
    title: "Statement by the United States",
    publisher: "UNGA First Committee",
    publishedDate: "2026-10-21",
    previewPath: "./assets/source-previews/e059-us-statement-first-page.png",
    imageAlt: "First page of the United States statement to the United Nations First Committee on October 21, 2026",
  },
};
function sourceCard(group, data) {
  const { url, ref, items } = group, d = items[0].row, meta = { ...(data.sourceMetadata?.[ref] || {}), ...(reviewedSourceMetadata[ref] || {}) };
  if (field(d, "Override Title")) { meta.title = field(d, "Override Title"); meta.titleEnglish = ""; }
  if (field(d, "Override Date")) { meta.publishedDate = field(d, "Override Date"); meta.publishedLabel = ""; }
  if (field(d, "Override Source Name")) meta.publisher = field(d, "Override Source Name");
  const card = el("article", `source-card${url ? " source-clickable" : ""}`);
  if (url) {
    card.tabIndex = 0; card.setAttribute("role", "link"); card.setAttribute("aria-label", `Open original source: ${meta.titleEnglish || meta.title || ref}`);
    card.addEventListener("click", () => window.open(url, "_blank", "noopener,noreferrer"));
    card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); window.open(url, "_blank", "noopener,noreferrer"); } });
  }
  const [category, kind] = recordCategory(d), eyebrow = el("div", "source-eyebrow"); eyebrow.append(categoryIcon(kind), el("span", "", category)); card.append(eyebrow);
  const document = meta.kind === "document" || /\.pdf(?:$|[?#])/i.test(ref);
  const media = el("div", `source-media${document ? " document-media" : ""}`);
  const capturedPreview = ref === "https://www.globalsecurity.org/space/library/news/2022/space-220630-globaltimes01.htm" ? "./assets/source-previews/e005-global-times-source.png" : "";
  const imageUrl = meta.imagePath || meta.previewPath || safeUrl(meta.imageUrl) || capturedPreview;
  if (imageUrl) {
    const img = el("img"); img.src = imageUrl; img.alt = capturedPreview && imageUrl === capturedPreview ? "Cropped Global Times article masthead and headline" : meta.imageAlt || (meta.kind === "document" ? "First page of source document" : "Publisher's featured image for this source"); img.loading = "lazy";
    img.onerror = () => { img.remove(); media.append(sourceFallback(meta, d, url, document)); };
    media.append(img);
  } else media.append(sourceFallback(meta, d, url, document));
  card.append(media);
  const content = el("div", "source-content");
  const needsTranslation = !meta.titleEnglish && meta.title && (/[\u0400-\u052f\u0600-\u06ff\u4e00-\u9fff]/u.test(meta.title) || (meta.language && !/^en(?:-|_|$)/i.test(meta.language)));
  const headline = meta.titleEnglish || (needsTranslation ? `Untranslated title: ${meta.title}` : meta.title) || (document ? (/statement/i.test(field(d, "Voice type", "Description type")) ? "Official statement" : "Source document") : "Source page");
  const heading = el("h4", "source-headline", headline);
  if (meta.titleEnglish && meta.title) { heading.title = `Original title: ${meta.title}`; heading.append(el("span", "visually-hidden", ` Original title: ${meta.title}`)); }
  content.append(heading);
  if (meta.publishedDate) {
    const date = el("time", "source-date", meta.publishedLabel || fullDate(meta.publishedDate) || dateText(meta.publishedDate));
    date.dateTime = meta.publishedLabel ? meta.publishedDate.slice(0, 7) : meta.publishedDate;
    content.append(date);
  }
  else if (document && field(d, "Statement date")) content.append(el("span", "source-date", `Statement dated ${fullDate(field(d, "Statement date")) || dateText(field(d, "Statement date"))}`));
  const source = meta.publisher || field(d, "Source", "Publisher", "Organization", "Outlet", "State / affiliation / joint signatories") || (url ? new URL(url).hostname.replace(/^www\./, "") : "Source unavailable");
  const foot = el("div", "source-foot");
  const sourceGroup = el("span", "source-link-group"); sourceGroup.append(el("span", "source-publisher", source));
  if (url) { const arrow = el("span", "source-external-arrow"); arrow.setAttribute("aria-hidden", "true"); arrow.innerHTML = '<svg viewBox="0 0 18 18"><path d="M7.25 4.25H4.5A1.75 1.75 0 0 0 2.75 6v7.5a1.75 1.75 0 0 0 1.75 1.75H12a1.75 1.75 0 0 0 1.75-1.75v-2.75"/><g class="arrow-tip"><path d="M9.25 2.75h6v6"/><path d="m8 10 7.25-7.25"/></g></svg>'; sourceGroup.append(arrow); }
  foot.append(sourceGroup);
  content.append(foot);
  card.append(content); return card;
}
function expandedContent(row, data) {
  const episodeId = field(row, "ID");
  const wrap = el("div", `expanded-inner${hasEpisodeVisual(episodeId) ? " has-visual" : ""}`);
  if (state.usePreview) wrap.append(el("p", "caution", data.source === "local-verification-candidates" ? "Verification worklist entry. The possible counterpart is not a confirmed episode participant." : "Local preview includes unpublished records. This is not the public selection."));
  const overview = el("div", "detail-overview");
  const context = el("section", "context-block"); context.setAttribute("aria-label", "Episode description");
  const description = episodeDescription(row);
  if (description) context.append(formattedDescription(description));
  else context.append(el("p", "description-pending", "Episode description pending editorial entry."));
  overview.append(context);
  if (hasEpisodeVisual(episodeId)) {
    const publicId = publicEpisodeId(row);
    const viz = el("section", "visual-block"), target = new URL(episodeId === "E-001" ? "../visualization/e001/" : episodeId === "E-002" ? "../visualization/e002/" : `../visualization/Viz/compare.html?${localE003Review ? "dev=1&" : ""}episode=${publicId}`, location.href).href;
    viz.setAttribute("aria-label", `${publicId} orbital visualization`);
    const label = `Explore the interactive model for ${title(row)}`;
    const sceneLink = visualizationLink(target, label), actionLink = visualizationActionLink(target, label);
    const hoverScene = active => {
      actionLink.dispatchEvent(new Event(active ? "pointerenter" : "pointerleave"));
      // Ask the scene to tint Earth and pulse its satellites. Filtering the
      // iframe darkened every asset and overrode saved viewport offsets.
      miniFrame?.contentWindow?.miniWorkshop?.setHover?.(active);
    };
    sceneLink.addEventListener("pointerenter", () => hoverScene(true));
    sceneLink.addEventListener("pointerleave", () => hoverScene(false));
    sceneLink.addEventListener("focus", () => hoverScene(true));
    sceneLink.addEventListener("blur", () => hoverScene(false));
    context.append(actionLink);
    viz.append(sceneLink);
    overview.append(viz);
  } else overview.classList.add("no-visual");
  const evidence = el("section", "evidence-section"), found = linkedDescriptions(row, data), requested = descriptionIds(row), sources = sourceGroups(row, data);
  evidence.setAttribute("aria-label", `${found.length} source records`);
  const unresolved = requested.filter(id => !found.some(item => item.id.toUpperCase() === id.toUpperCase()));
  if (unresolved.length) evidence.append(el("p", "caution", `${unresolved.length} referenced description ID(s) could not be resolved.`));
  if (!found.length) evidence.append(el("p", "muted", "No linked sources are available."));
  else {
    const carousel = sources.length >= 4;
    const grid = el("div", `source-grid${carousel ? " source-carousel-grid" : ""}`); let index = 0;
    const appendCard = (group, targetGrid) => {
      const sheet = el("div", "source-stack"); sheet.style.setProperty("--card-angle", ["-1.2deg", "1.1deg", "-.7deg", ".8deg"][index++ % 4]);
      sheet.append(sourceCard(group, data));
      if (group.items.length > 1) {
        const details = el("details", "source-records"), summary = el("summary", "", `${group.items.length} linked descriptions`); details.append(summary);
        for (const item of group.items) { const excerpt = field(item.row, "Statement excerpt", "Excerpt", "Quotation", "Quote", "Summary", "Description", "Text"); details.append(el("p", "", `${item.id}${excerpt ? `: ${excerpt}` : ""}`)); }
        sheet.append(details);
      }
      targetGrid.append(sheet);
    };
    sources.forEach(group => appendCard(group, grid));
    evidence.append(grid);
    if (carousel) {
      const cards = [...grid.children], nav = el("nav", "source-carousel-controls"), dots = el("div", "source-carousel-dots");
      nav.setAttribute("aria-label", "Source cards"); dots.setAttribute("role", "group"); dots.setAttribute("aria-label", "Choose source card");
      const arrow = (direction, label, path) => {
        const button = el("button", `source-carousel-arrow ${direction}`); button.type = "button"; button.setAttribute("aria-label", label);
        button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${path}"/></svg>`;
        return button;
      };
      const previous = arrow("previous", "Previous source cards", "M13 4 7 10 13 16");
      const next = arrow("next", "Next source cards", "M7 4 13 10 7 16");
      let first = 0;
      const show = (index, swipe = false) => {
        const oldFirst = first;
        const oldVisible = cards.filter(card => !card.hidden);
        const oldRects = new Map(oldVisible.map(card => [card, card.getBoundingClientRect()]));
        first = (index + cards.length) % cards.length;
        const visibleCount = matchMedia("(max-width:650px)").matches ? 1 : matchMedia("(max-width:900px)").matches ? 2 : 3;
        const visible = Array.from({ length: visibleCount }, (_, offset) => (first + offset) % cards.length);
        const motion = swipe && oldFirst !== first && !reducedMotion.matches;
        const direction = (first - oldFirst + cards.length) % cards.length <= cards.length / 2 ? 1 : -1;
        const outgoing = motion ? oldVisible.find(card => !visible.includes(cards.indexOf(card))) : null;
        const outgoingRect = outgoing && oldRects.get(outgoing);
        cards.forEach((card, position) => { card.hidden = !visible.includes(position); card.style.order = String(visible.indexOf(position)); });
        if (motion) {
          const gridRect = grid.getBoundingClientRect();
          const travel = (cards.find(card => !card.hidden)?.getBoundingClientRect().width || 250) + 14;
          for (const card of cards.filter(item => !item.hidden)) {
            const old = oldRects.get(card), next = card.getBoundingClientRect();
            const fromX = old ? old.left - next.left : direction * travel;
            if (Math.abs(fromX) > 1) card.animate([{ translate: `${fromX}px 0`, opacity: old ? 1 : .35 }, { translate: "0 0", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" });
          }
          grid.querySelector(".source-carousel-ghost")?.remove();
          if (outgoingRect) {
            const ghost = outgoing.cloneNode(true);
            ghost.classList.add("source-carousel-ghost"); ghost.removeAttribute("hidden"); ghost.removeAttribute("tabindex"); ghost.removeAttribute("role");
            Object.assign(ghost.style, { position: "absolute", zIndex: "4", left: `${outgoingRect.left - gridRect.left}px`, top: `${outgoingRect.top - gridRect.top}px`, width: `${outgoingRect.width}px`, height: `${outgoingRect.height}px`, margin: "0", pointerEvents: "none" });
            grid.append(ghost);
            ghost.animate([{ translate: "0 0", opacity: 1 }, { translate: `${-direction * travel}px 0`, opacity: 0 }], { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" }).finished.finally(() => ghost.remove());
          }
        }
        [...dots.children].forEach((dot, position) => { dot.classList.toggle("is-active", position === first); dot.setAttribute("aria-pressed", String(position === first)); });
      };
      cards.forEach((card, position) => {
        const dot = el("button", "source-carousel-dot"); dot.type = "button";
        dot.setAttribute("aria-label", `Show source card ${position + 1} of ${cards.length}`);
        dot.addEventListener("click", () => show(position, true)); dots.append(dot);
      });
      previous.addEventListener("click", () => show(first - 1, true)); next.addEventListener("click", () => show(first + 1, true));
      nav.append(previous, dots, next); evidence.append(nav); show(0);
      const onResize = () => show(first);
      let advance = 0;
      const restart = () => { clearInterval(advance); advance = window.setInterval(() => { if (grid.isConnected && !document.hidden) show(first + 1, true); }, 10000); };
      for (const control of [previous, next, ...dots.children]) control.addEventListener("click", restart);
      restart();
      window.addEventListener("resize", onResize); sourceCarouselCleanup = () => { window.removeEventListener("resize", onResize); clearInterval(advance); };
    }
  }
  wrap.append(overview);
  wrap.append(evidence); return wrap;
}
function loadingDetail(row, data) {
  const wrap = el("div", "expanded-inner expanded-partial");
  wrap.setAttribute("aria-busy", "true");
  const context = el("section", "context-block");
  context.append(el("h3", "", "Description"), el("p", "description-pending", "Loading description and source records…"));
  context.append(el("p", "partial-period", period(row)), objects(row, data));
  wrap.append(context, el("p", "partial-records", `${linkedDescriptions(row, data).length} linked records; details loading…`));
  return wrap;
}
async function measureExpandedRowHeight() {
  const rows = state.live?.episodes?.filter(row => hasEpisodeVisual(field(row, "ID"))) || [];
  const longest = rows.reduce((best, row) => episodeDescription(row).length > episodeDescription(best).length ? row : best, rows[0]);
  if (!longest) return;
  const detail = await ensureDetail(longest);
  const sample = el("tr", "expanded-row"); sample.dataset.episodeId = field(longest, "ID");
  const cell = el("td"); cell.colSpan = 7; sample.append(cell);
  sample.style.visibility = "hidden"; sample.style.pointerEvents = "none";
  cell.append(expandedContent(detail.row, detail));
  document.querySelector("#rows").append(sample);
  const height = Math.ceil(cell.querySelector(".expanded-inner").scrollHeight) + 4;
  sample.remove(); sourceCarouselCleanup(); sourceCarouselCleanup = () => {};
  document.documentElement.style.setProperty("--review-expanded-height", `${height}px`);
}
function animateIn(node) { if (!reducedMotion.matches) node.animate([{ opacity: 0, transform: "translateY(-5px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 190, easing: "ease-out" }); }
let scrollFrame = 0, scrollResolve = null, selectionToken = 0, collapseAnimation = null;
async function toggleRow(row) {
  const token = ++selectionToken, sameRow = state.selected === row;
  cancelAnimationFrame(scrollFrame); scrollResolve?.(); scrollResolve = null; collapseAnimation?.cancel(); closeObject();
  const current = document.querySelector(".expanded-row .expanded-inner");
  if (current && !reducedMotion.matches) {
    collapseAnimation = current.animate([{ maxHeight: `${current.getBoundingClientRect().height}px`, opacity: 1 }, { maxHeight: "0px", opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" });
    try { await collapseAnimation.finished; } catch { return; }
    if (token !== selectionToken) return;
  }
  state.selected = null; render();
  if (sameRow || token !== selectionToken) return;
  state.selected = row; render();
  const content = document.querySelector(".expanded-inner"); if (content) animateIn(content);
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (token !== selectionToken) return;
  const selected = [...document.querySelectorAll(".episode-row")].find(item => item.dataset.episodeId === field(row, "ID"));
  if (!selected) return;
  const stickyHeader = document.querySelector(".table-wrap thead th");
  const headerOffset = stickyHeader?.getBoundingClientRect().height || 0;
  const reviewBar = document.getElementById("tableReviewBar");
  const reviewOffset = reviewBar?.hidden ? 0 : reviewBar?.getBoundingClientRect().height || 0;
  const destination = Math.max(0, scrollY + selected.getBoundingClientRect().top - headerOffset - reviewOffset - 1);
  if (reducedMotion.matches) window.scrollTo(0, destination);
  else await new Promise(resolve => {
    scrollResolve = resolve;
    const origin = scrollY, distance = destination - origin, started = performance.now();
    const duration = Math.min(1050, Math.max(380, Math.abs(distance) * .55));
    const step = now => {
      if (token !== selectionToken) { scrollResolve = null; resolve(); return; }
      const fraction = Math.min(1, (now - started) / duration);
      window.scrollTo(0, origin + distance * (1 - (1 - fraction) ** 3));
      if (fraction < 1) scrollFrame = requestAnimationFrame(step); else { scrollResolve = null; resolve(); }
    };
    scrollFrame = requestAnimationFrame(step);
  });
  if (token !== selectionToken) return;
  requestAnimationFrame(() => {
    if (token !== selectionToken) return;
    const heading = document.querySelector(`.episode-row.selected`);
    if (!heading) return;
    const sticky = document.querySelector(".table-wrap thead th")?.getBoundingClientRect().height || 0;
    const review = document.getElementById("tableReviewBar");
    const reviewHeight = review?.hidden ? 0 : review?.getBoundingClientRect().height || 0;
    const difference = heading.getBoundingClientRect().top - sticky - reviewHeight - 1;
    if (Math.abs(difference) > 2) scrollBy({ top: difference, behavior: reducedMotion.matches ? "instant" : "smooth" });
  });
}
function periodNode(row) { const node = el("span", "period-label", periodInfo(row).label); const chapters = episodeChapters(row); node.title = chapters.length ? chapters.map(item => `${item.center} · ${item.widthHours} hours`).join("\n") : [fullDate(field(row, "Start Date", "Date")), fullDate(field(row, "End Date"))].filter(Boolean).join(" to "); return node; }
function proximityNode(row, key) {
  const cell = el("div", "proximity-cell");
  const id = field(row, "ID"), metric = rowMetric(row, key);
  if (!Number.isFinite(metric?.value)) { cell.append(el("span", "plot-pending", id === "E-001" && !state.series || id === "E-002" && !state.e002Metrics || ["E-003", "E-005", "E-006", "E-008", "E-016", "E-059"].includes(id) && !state.historicalMetrics[id] ? "Loading…" : "Unavailable")); return cell; }
  const value = metric.value > 0 && metric.value < 1 ? "<1" : estimatedValue(metric.value, key === "distance" ? "separationKm" : "relativeSpeedMps", field(row, "ID"));
  cell.append(el("strong", "minimum-value", value), el("span", "minimum-unit", key === "distance" ? "km" : "m/s"));
  const pair = metric.pair?.split(":");
  const pairLabel = pair?.length === 2 ? `${objectInfo(row, pair[0], currentData())?.name || pair[0]} to ${objectInfo(row, pair[1], currentData())?.name || pair[1]}; ` : "";
  cell.title = `${id === "E-002" ? "COSMOS 2542 to USA 245; December 9 and December 30 chapters. " : pairLabel}Estimated minimum in this reconstruction: ${value} ${key === "distance" ? "km separation" : "m/s relative velocity"} on ${fullDate(new Date(metric.ms).toISOString().slice(0, 10))}. Display rounding does not quantify uncertainty.`;
  return cell;
}
let previewScene = null, previewToken = 0;
let miniDotFrame = 0;
let miniFrame = null, miniBackdropHost = null, miniEditing = false, miniOriginalBounds = null, miniResizeObserver = null, localReview = null;
let warmedE002Host = null, warmedE002Frame = null;
let warmedE001Host = null, warmedE001Frame = null;
let warmedE005Host = null, warmedE005Frame = null;
const publishedMiniSettings = fetch("./data/mini-preview-settings.json", { cache: "no-store" })
  .then(response => { if (!response.ok) throw new Error(`Mini settings returned ${response.status}`); return response.json(); })
  .then(data => data.configs || {}).catch(error => { console.warn("Published mini settings unavailable", error); return {}; });
async function applyPublishedMiniConfig(frame, episodeId) {
  if (localReview) return;
  const config = (await publishedMiniSettings)[episodeId];
  if (!config) { frame.dataset.miniConfigured = "1"; return; }
  if (!frame.isConnected) return;
  for (let attempt = 0; attempt < 600 && frame.isConnected; attempt++) {
    const mini = frame.contentWindow?.miniWorkshop;
    if (!mini?.ready) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
    try {
      mini.selectWindow(config.windowId);
      mini.setTime(Date.parse(config.camera.timestampUtc || config.loopStartUtc));
      mini.applyCamera(config.camera);
      mini.setLoop(Date.parse(config.loopStartUtc), Date.parse(config.loopEndUtc));
      mini.setRate(config.rate);
      const offset = config.camera?.viewportOffset || {};
      const x = Number(offset.x) || 0, y = Number(offset.y) || 0;
      frame.style.transform = `translate(${x}px, ${y}px)`;
      if (frame.classList.contains("e002-mini")) {
        frame.dataset.miniOffsetY = String(y);
        const detail = document.querySelector('.expanded-row[data-episode-id="E-002"]');
        if (detail) frame.style.height = `${detail.getBoundingClientRect().height + Math.max(0, -y)}px`;
      } else {
        frame.style.width = x < 0 ? `calc(100% + ${-x}px)` : "100%";
        frame.style.height = y < 0 ? `calc(100% + ${-y}px)` : "100%";
      }
      mini.setPlaying(true);
      frame.dataset.miniConfigured = "1";
      return;
    } catch (error) {
      console.warn(`${episodeId} mini settings could not be applied; using the current chapter`, error);
      mini.selectWindow(mini.windows[0]?.id);
      mini.setPlaying(true);
      frame.dataset.miniConfigured = "1";
      return;
    }
  }
}
function revealMiniAsOneScene(frame) {
  frame.style.opacity = "0";
  frame.style.transition = "opacity 220ms ease";
  let tries = 0;
  const check = () => {
    if (!frame.isConnected) { if (++tries < 125) setTimeout(check, 80); return; }
    const host = frame.parentElement;
    host?.classList.add("mini-loading");
    if (host && !host.querySelector(":scope > .espl-loading")) {
      const loading = el("div", "espl-loading"); loading.setAttribute("role", "status");
      loading.innerHTML = '<span class="espl-loading-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Loading episode</span>';
      host.append(loading);
    }
    if (frame.contentWindow?.miniWorkshop?.ready && frame.dataset.miniConfigured === "1") {
      setTimeout(() => {
        if (!frame.isConnected || frame.dataset.miniMounting === "1") return;
        frame.style.opacity = "1"; frame.parentElement?.classList.remove("mini-loading");
      }, 150);
    } else setTimeout(check, 80);
  };
  check();
}
function settleMountedMini(frame, episodeId) {
  if (!frame?.isConnected) return;
  frame.dataset.miniMounting = "1";
  frame.style.opacity = "0";
  frame.parentElement?.classList.add("mini-loading");
  const reveal = async () => {
    // The prewarmed iframe is first laid out at 900 × 450 offscreen. Let its
    // ResizeObserver and projection settle at the expanded row's real size.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!frame.isConnected) return;
    if (localReview) await localReview.attachMini(frame);
    else await applyPublishedMiniConfig(frame, episodeId);
    for (let attempt = 0; attempt < 600 && frame.isConnected; attempt++) {
      if (frame.contentWindow?.miniWorkshop?.ready && frame.dataset.miniConfigured === "1") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!frame.contentWindow?.miniWorkshop?.ready || frame.dataset.miniConfigured !== "1") return;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!frame.isConnected) return;
    frame.dataset.miniMounting = "0";
    frame.style.opacity = "1";
    frame.parentElement?.classList.remove("mini-loading");
  };
  void reveal();
}
function prewarmE001() {
  if (warmedE001Host) return;
  const table = document.querySelector(".table-wrap");
  if (!table) return;
  warmedE001Host = el("div", "orbital-preview e001-prewarm");
  warmedE001Frame = el("iframe", "e001-mini");
  warmedE001Frame.dataset.miniBaseHeight = "450";
  revealMiniAsOneScene(warmedE001Frame);
  warmedE001Frame.src = new URL("../visualization/Viz/compare.html?mini=1&episode=E-001&table=31", location.href).href;
  warmedE001Frame.title = "Animated E-001 satellite-centered orbital reconstruction";
  warmedE001Frame.tabIndex = -1; warmedE001Frame.setAttribute("aria-hidden", "true");
  warmedE001Host.append(warmedE001Frame); table.append(warmedE001Host);
  warmedE001Frame.addEventListener("load", () => {
    void localReview?.primeMini(warmedE001Frame, "E-001");
    void applyPublishedMiniConfig(warmedE001Frame, "E-001");
    if (miniFrame === warmedE001Frame) localReview?.attachMini(warmedE001Frame);
  });
}
function prewarmE002() {
  if (warmedE002Host) return;
  const table = document.querySelector(".table-wrap");
  if (!table) return;
  warmedE002Host = el("div", "orbital-preview e002-prewarm");
  warmedE002Frame = el("iframe", "e002-mini");
  revealMiniAsOneScene(warmedE002Frame);
  warmedE002Frame.src = new URL("../visualization/dev/e002-control-panel-preview/table-mini.html?table=31", location.href).href;
  warmedE002Frame.title = "Animated E-002 miniature orbital reconstruction";
  warmedE002Frame.tabIndex = -1; warmedE002Frame.setAttribute("aria-hidden", "true");
  warmedE002Host.append(warmedE002Frame); table.append(warmedE002Host);
  warmedE002Frame.addEventListener("load", () => {
    void localReview?.primeMini(warmedE002Frame, "E-002");
    void applyPublishedMiniConfig(warmedE002Frame, "E-002");
    if (miniFrame === warmedE002Frame) localReview?.attachMini(warmedE002Frame);
  });
}
function prewarmE005() {
  if (warmedE005Host) return;
  const table = document.querySelector(".table-wrap");
  if (!table) return;
  warmedE005Host = el("div", "orbital-preview e005-prewarm");
  warmedE005Frame = el("iframe", "e005-mini");
  revealMiniAsOneScene(warmedE005Frame);
  warmedE005Frame.src = new URL("../visualization/Viz/compare.html?mini=1&asset=E-005&table=31", location.href).href;
  warmedE005Frame.title = `Animated ${state.live?.episodes?.find(row => row.ID === "E-005")?.["Episode ID"] || "E-004"} miniature orbital reconstruction`;
  warmedE005Frame.tabIndex = -1; warmedE005Frame.setAttribute("aria-hidden", "true");
  warmedE005Host.append(warmedE005Frame); table.append(warmedE005Host);
  warmedE005Frame.addEventListener("load", () => {
    void localReview?.primeMini(warmedE005Frame, "E-005");
    void applyPublishedMiniConfig(warmedE005Frame, "E-005");
    if (miniFrame === warmedE005Frame) localReview?.attachMini(warmedE005Frame);
  });
}
function stageEpisodeAssets() {
  // Let the table paint first. Browser prefetches use low network priority and
  // do not create eight simultaneous WebGL contexts in hidden iframes.
  const idle = callback => "requestIdleCallback" in window
    ? requestIdleCallback(callback, { timeout: 1500 }) : setTimeout(callback, 250);
  const orbitalAssets = [["e003", 6], ["e005", 11], ["e006", 13], ["e008", 5], ["e016", 3], ["e059", 4]];
  const assets = [
    "../visualization/Viz/compare.html",
    "../visualization/e001/",
    "../visualization/e002/",
    "../visualization/e001/public.js?v=4",
    "../visualization/dev/e002-control-panel-preview/app.js?v=6",
    "../visualization/Viz/vendor/three/three.module.js",
    "../visualization/Viz/vendor/countries-50m.json",
    ...orbitalAssets.map(([name, version]) => `../visualization/Viz/episode-${name}.js?v=${version}`),
    "../visualization/dev/e002-control-panel-preview/table-mini.html",
    ...orbitalAssets.map(([name]) => `../visualization/dev/${name}/data/provenance.json`),
  ];
  let index = 0, queued = false;
  const scheduleNext = () => {
    if (queued) return;
    queued = true;
    idle(() => { queued = false; next(); });
  };
  const next = () => {
    if (index >= assets.length) return;
    if (document.visibilityState === "visible") {
      const path = assets[index++], url = new URL(path, location.href);
      if (path.endsWith("/provenance.json")) {
        fetch(url).then(response => response.ok ? response.json() : null).then(manifest => {
          for (const source of manifest?.datasets || []) {
            if (!source.sha256 || /^https?:/.test(source.url)) continue;
            const dataUrl = new URL(source.url, new URL("../", url));
            dataUrl.searchParams.set("sha", source.sha256.slice(0, 16));
            assets.push(dataUrl.href);
          }
          scheduleNext();
        }).catch(error => console.warn(`Background elements unavailable: ${url.pathname}`, error));
      } else {
        const link = document.createElement("link");
        link.rel = "prefetch"; link.as = url.pathname.endsWith(".js") ? "script" : "fetch";
        link.href = url.href;
        document.head.append(link);
      }
    }
    scheduleNext();
  };
  scheduleNext();
  // Stagger the three reusable mini scenes after the rows exist.
  const warmers = [prewarmE002, prewarmE001, prewarmE005];
  let warmIndex = 0;
  const warm = () => {
    if (warmIndex >= warmers.length) return;
    if (document.visibilityState !== "visible" || state.selected) { idle(warm); return; }
    warmers[warmIndex++]();
    setTimeout(() => idle(warm), 550);
  };
  idle(warm);
}
function stopPreview() {
  cancelAnimationFrame(miniDotFrame); miniDotFrame = 0;
  previewToken++; previewScene?.dispose(); previewScene = null;
  miniFrame?.contentWindow?.miniWorkshop?.setHover?.(false);
  miniResizeObserver?.disconnect(); miniResizeObserver = null;
  if (miniFrame && miniFrame !== warmedE002Frame && miniFrame !== warmedE001Frame && miniFrame !== warmedE005Frame) miniFrame.remove();
  miniFrame = null; miniBackdropHost = null; miniEditing = false; miniOriginalBounds = null;
  localReview?.previewStopped();
  if (warmedE002Host) {
    warmedE002Host.classList.remove("mini-editing-viewport");
    warmedE002Host.classList.add("e002-prewarm");
    warmedE002Host.removeAttribute("data-preview-interval-utc");
  }
  if (warmedE001Host) {
    warmedE001Host.classList.remove("mini-editing-viewport", "e001-live");
    warmedE001Host.classList.add("e001-prewarm");
  }
  if (warmedE005Host) {
    warmedE005Host.classList.remove("mini-editing-viewport", "e005-live");
    warmedE005Host.classList.add("e005-prewarm");
    document.querySelector(".table-wrap")?.append(warmedE005Host);
  }
  document.querySelectorAll(".table-wrap > .orbital-preview").forEach(host => { if (host !== warmedE002Host && host !== warmedE001Host && host !== warmedE005Host) host.remove(); });
}
function showMiniDotsOverDescription() {
  const expanded = document.querySelector(".expanded-row .expanded-inner.has-visual");
  const context = expanded?.querySelector(".context-block");
  if (!expanded || !context) return;
  cancelAnimationFrame(miniDotFrame); expanded.querySelector(".mini-dot-overlay")?.remove();
  const overlay = el("div", "mini-dot-overlay"); overlay.setAttribute("aria-hidden", "true"); expanded.append(overlay);
  const dots = new Map(); let last = 0;
  const paint = now => {
    if (!expanded.isConnected || !state.selected) return;
    miniDotFrame = requestAnimationFrame(paint);
    if (now - last < 40 || miniEditing) { overlay.hidden = miniEditing; return; }
    last = now; overlay.hidden = false;
    const positions = miniFrame?.contentWindow?.miniWorkshop?.getMarkerPositions?.();
    if (!positions) return;
    const frame = miniFrame.getBoundingClientRect(), area = expanded.getBoundingClientRect(), text = context.getBoundingClientRect();
    for (const marker of positions) {
      let dot = dots.get(marker.slot);
      if (!dot) { dot = el("span", "mini-dot-clone"); overlay.append(dot); dots.set(marker.slot, dot); }
      const x = frame.left + frame.width * marker.x, y = frame.top + frame.height * marker.y;
      dot.hidden = !marker.visible || x < text.left || x > text.right || y < text.top || y > text.bottom;
      if (!dot.hidden) { dot.style.left = `${x - area.left + expanded.scrollLeft}px`; dot.style.top = `${y - area.top + expanded.scrollTop}px`; dot.style.background = marker.color; dot.style.opacity = String(marker.opacity ?? 1); }
    }
  };
  miniDotFrame = requestAnimationFrame(paint);
}
function setMiniEditing(open) {
  if (!miniFrame || !miniBackdropHost) return false;
  const episodeId = field(state.selected || {}, "ID");
  const block = document.querySelector(`.expanded-row[data-episode-id="${episodeId}"] .visual-block`);
  if (!block) return false;
  miniEditing = open; block.classList.toggle("mini-workshop-active", open);
  miniBackdropHost.classList.toggle("mini-editing-viewport", open);
  miniFrame.contentWindow?.miniWorkshop?.setEditing?.(open);
  if (["E-001", "E-003", "E-005", "E-006", "E-008", "E-016", "E-059"].includes(episodeId)) {
    miniFrame.tabIndex = open ? 0 : -1;
    if (open) miniFrame.removeAttribute("aria-hidden"); else miniFrame.setAttribute("aria-hidden", "true");
    return true;
  }
  if (open) {
    if (!miniOriginalBounds) miniOriginalBounds = { top: miniBackdropHost.style.top, left: miniBackdropHost.style.left, width: miniBackdropHost.style.width, height: miniBackdropHost.style.height };
    const table = document.querySelector(".table-wrap").getBoundingClientRect(), rect = block.getBoundingClientRect();
    const detail = block.closest(".expanded-row").getBoundingClientRect();
    miniBackdropHost.style.top = `${detail.top - table.top}px`;
    miniBackdropHost.style.left = `${rect.left - table.left}px`;
    miniBackdropHost.style.width = `${rect.width}px`;
    miniBackdropHost.style.height = `${detail.height}px`;
    const heading = document.querySelector(".episode-row.selected").getBoundingClientRect();
    const featherWidth = Math.min(200, Math.max(0, rect.left - heading.left - 24));
    // Keep one canvas size while editing and while viewing the saved preview.
    // Changing its height after Save made the same camera look much closer.
    Object.assign(miniFrame.style, { position: "absolute", left: `${-featherWidth}px`, top: "0px", width: `${heading.right - rect.left + featherWidth}px`, height: `${detail.height}px` });
    miniFrame.tabIndex = 0; miniFrame.removeAttribute("aria-hidden");
  } else {
    if (miniOriginalBounds) Object.assign(miniBackdropHost.style, miniOriginalBounds);
    miniOriginalBounds = null;
    const tableWrap = document.querySelector(".table-wrap"), header = document.querySelector(".episode-row.selected"), expanded = document.querySelector(".expanded-row");
    if (tableWrap && header && expanded) updateMiniBackdropBounds(miniBackdropHost, tableWrap, header, expanded);
    miniFrame.tabIndex = -1; miniFrame.setAttribute("aria-hidden", "true");
  }
  return true;
}
function updateMiniBackdropBounds(host, tableWrap, header, expanded) {
  if (miniEditing || !host.isConnected || !expanded.isConnected) return;
  const origin = tableWrap.getBoundingClientRect(), heading = header.getBoundingClientRect(), detail = expanded.getBoundingClientRect();
  host.style.top = `${heading.top - origin.top}px`;
  host.style.left = `${heading.left - origin.left}px`;
  host.style.width = `${heading.width}px`;
  host.style.height = `${heading.height + detail.height}px`;
  positionMiniLoader(host, header, expanded);
  const frame = host.querySelector("iframe.e002-mini"), block = expanded.querySelector(".visual-block");
  if (frame && block) {
    const rect = (block.querySelector(".visual-link.model-link") || block).getBoundingClientRect();
    // Match the editable canvas dimensions so saving a camera cannot change
    // its apparent zoom when the scene returns behind the expanded row.
    const featherWidth = Math.min(200, Math.max(0, rect.left - heading.left - 24));
    const offsetY = Number(frame.dataset.miniOffsetY) || 0;
    Object.assign(frame.style, { position: "absolute", left: `${rect.left - heading.left - featherWidth}px`, top: `${detail.top - heading.top}px`, width: `${heading.right - rect.left + featherWidth}px`, height: `${detail.height + Math.max(0, -offsetY)}px` });
  }
}
function positionMiniLoader(host, header, expanded) {
  if (!host?.isConnected || !header?.isConnected || !expanded?.isConnected) return;
  const pane = host.getBoundingClientRect();
  const orbit = header.querySelector(".episode-cell")?.getBoundingClientRect();
  const row = expanded.getBoundingClientRect();
  const records = expanded.querySelector(".evidence-section")?.getBoundingClientRect();
  if (!orbit || !records) return;
  // Narrow layouts turn the first cell into a full-width block. In that case
  // the preview is already the available horizontal pane.
  const contentLeft = orbit.right < pane.right - 80 ? orbit.right : pane.left;
  const left = Math.max(0, contentLeft - pane.left);
  const top = Math.max(0, row.top - pane.top);
  host.style.setProperty("--mini-loader-left", `${left}px`);
  host.style.setProperty("--mini-loader-top", `${top}px`);
  host.style.setProperty("--mini-loader-width", `${Math.max(1, Math.min(pane.right, row.right) - Math.max(pane.left, contentLeft))}px`);
  host.style.setProperty("--mini-loader-height", `${Math.max(1, records.top - row.top)}px`);
}
function updateE001BackdropBounds(host, tableWrap, expanded) {
  if (miniEditing || !host.isConnected || !expanded.isConnected) return;
  const placeholder = expanded.querySelector(".visual-block .orbital-preview");
  if (!placeholder) return;
  const origin = tableWrap.getBoundingClientRect(), rect = placeholder.getBoundingClientRect();
  const detail = expanded.getBoundingClientRect();
  const header = host.classList.contains("e001-live") ? expanded.previousElementSibling?.getBoundingClientRect() : null;
  const top = header?.top ?? rect.top;
  const table = tableWrap.querySelector("table")?.getBoundingClientRect() || origin;
  Object.assign(host.style, { top: `${top - origin.top}px`, left: `${table.left - origin.left}px`, width: `${table.width}px`, height: `${detail.bottom - top}px` });
  positionMiniLoader(host, expanded.previousElementSibling, expanded);
}
function startPreview(row) {
  const episodeId = field(row, "ID");
  if (!hasEpisodeVisual(episodeId)) return;
  const host = document.querySelector(".expanded-row .orbital-preview"); if (!host) return;
  showMiniDotsOverDescription();
  // One live scene spans the header, overview, and records. The link remains
  // the interaction target while the canvas is a clipped background layer.
  const tableWrap = document.querySelector(".table-wrap"), header = document.querySelector(".episode-row.selected"), expanded = document.querySelector(".expanded-row");
  if (episodeId === "E-002" && !warmedE002Host && tableWrap && header && expanded) {
    tableWrap.append(host);
    updateMiniBackdropBounds(host, tableWrap, header, expanded);
    miniResizeObserver = new ResizeObserver(() => updateMiniBackdropBounds(host, tableWrap, header, expanded));
    miniResizeObserver.observe(header); miniResizeObserver.observe(expanded);
  }
  if (episodeId === "E-002") {
    const frame = warmedE002Frame || el("iframe", "e002-mini");
    const backdrop = warmedE002Host || host;
    if (backdrop !== host) host.remove();
    backdrop.classList.remove("e002-prewarm");
    if (backdrop !== host) {
      miniBackdropHost = backdrop;
      updateMiniBackdropBounds(backdrop, tableWrap, header, expanded);
      miniResizeObserver?.disconnect();
      miniResizeObserver = new ResizeObserver(() => updateMiniBackdropBounds(backdrop, tableWrap, header, expanded));
      miniResizeObserver.observe(header); miniResizeObserver.observe(expanded);
    }
    if (frame !== warmedE002Frame) {
      revealMiniAsOneScene(frame);
      frame.src = new URL("../visualization/dev/e002-control-panel-preview/table-mini.html?table=31", location.href).href;
      frame.title = "Animated E-002 miniature orbital reconstruction";
      frame.tabIndex = -1; frame.setAttribute("aria-hidden", "true");
      backdrop.append(frame);
    }
    backdrop.dataset.previewIntervalUtc = "2019-12-08T10:05:00Z / 2019-12-08T10:50:00Z";
    miniFrame = frame; miniBackdropHost = backdrop; localReview?.attachMini(frame);
    if (frame === warmedE002Frame) settleMountedMini(frame, "E-002");
    return;
  }
  if (episodeId === "E-005" && warmedE005Host && warmedE005Frame) {
    host.replaceWith(warmedE005Host);
    warmedE005Host.classList.remove("e005-prewarm"); warmedE005Host.classList.add("e005-live");
    positionMiniLoader(warmedE005Host, header, expanded);
    miniFrame = warmedE005Frame; miniBackdropHost = warmedE005Host;
    localReview?.attachMini(warmedE005Frame);
    settleMountedMini(warmedE005Frame, "E-005");
    return;
  }
  if (["E-003", "E-005", "E-006", "E-008", "E-016", "E-059"].includes(episodeId)) {
    const frame = el("iframe", `e${episodeId.slice(2)}-mini`);
    revealMiniAsOneScene(frame);
    frame.src = new URL(`../visualization/Viz/compare.html?mini=1&asset=${episodeId}&table=31`, location.href).href;
    frame.title = `Animated ${publicEpisodeId(row)} miniature orbital reconstruction`;
    frame.tabIndex = -1; frame.setAttribute("aria-hidden", "true");
    host.replaceChildren(frame);
    miniFrame = frame; miniBackdropHost = host;
    if (["E-003", "E-006", "E-008", "E-016", "E-059"].includes(episodeId)) {
      const expanded = document.querySelector(".expanded-row");
      const fillExpandedRow = () => {
        if (!expanded?.isConnected || !host.isConnected) return;
        const area = expanded.getBoundingClientRect(), link = host.parentElement.getBoundingClientRect();
        Object.assign(host.style, { left: `${area.left - link.left}px`, top: `${area.top - link.top - 1}px`, width: `${area.width}px`, height: `${area.height + 1}px` });
        positionMiniLoader(host, header, expanded);
        Object.assign(frame.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
      };
      fillExpandedRow();
      miniResizeObserver?.disconnect();
      miniResizeObserver = new ResizeObserver(fillExpandedRow);
      miniResizeObserver.observe(expanded);
    }
    frame.addEventListener("load", () => localReview?.attachMini(frame));
    if (["E-003", "E-005", "E-006", "E-008", "E-016", "E-059"].includes(episodeId)) frame.addEventListener("load", () => void applyPublishedMiniConfig(frame, episodeId));
    localReview?.attachMini(frame);
    return;
  }
  if (episodeId === "E-001" && warmedE001Host && warmedE001Frame) {
    host.style.visibility = "hidden";
    warmedE001Host.classList.remove("e001-prewarm"); warmedE001Host.classList.add("e001-live");
    miniFrame = warmedE001Frame; miniBackdropHost = warmedE001Host;
    updateE001BackdropBounds(warmedE001Host, tableWrap, expanded);
    miniResizeObserver?.disconnect();
    miniResizeObserver = new ResizeObserver(() => updateE001BackdropBounds(warmedE001Host, tableWrap, expanded));
    miniResizeObserver.observe(expanded);
    localReview?.attachMini(warmedE001Frame);
    settleMountedMini(warmedE001Frame, "E-001");
    return;
  }
  const token = ++previewToken;
  let interval;
  try { interval = episodeUtcInterval(row); }
  catch (error) { console.warn("E-001 dates invalid", error); return; }
  import("./e001-preview.js?v=6")
    .then(module => module.mountE001Preview(host, interval)).then(scene => {
    if (token !== previewToken || !host.isConnected) scene?.dispose();
    else {
      previewScene = scene;
      if (location.port === "8769" && scene?.frame) {
        miniFrame = scene.frame; miniBackdropHost = host;
        scene.frame.addEventListener("load", () => localReview?.attachMini(scene.frame));
        localReview?.attachMini(scene.frame);
      }
    }
  }).catch(error => { if (token === previewToken) { console.warn("E-001 preview unavailable", error); host.append(el("span", "orbital-error", "Orbital preview unavailable")); } });
}
function newsIndicator(row, count) {
  const wrap = el(count ? "button" : "span", "news-indicator");
  if (count) { wrap.type = "button"; wrap.setAttribute("aria-label", `Show ${count} linked ${count === 1 ? "record" : "records"} for ${title(row)}`); wrap.addEventListener("click", event => { event.stopPropagation(); toggleRow(row); }); }
  else wrap.setAttribute("aria-label", "0 linked records");
  const stack = el("span", "news-mini-stack"); stack.setAttribute("aria-hidden", "true");
  stack.style.setProperty("--record-stack-width", `${count ? 16 + 6 * (count - 1) : 0}px`);
  for (let index = 0; index < count; index++) {
    const card = el("span", "news-mini"); card.style.setProperty("--stack-offset", `${index * 6}px`);
    card.style.setProperty("--stack-angle", `${index % 2 ? 3 : -3}deg`); stack.append(card);
  }
  wrap.title = `${count} linked ${count === 1 ? "record" : "records"}`; wrap.append(stack);
  return wrap;
}
function render() {
  sourceCarouselCleanup(); sourceCarouselCleanup = () => {};
  stopPreview(); closeObject(); updateSortHeaders();
  const data = currentData(), rows = visibleRows();
  if (state.selected && !rows.includes(state.selected)) state.selected = null;
  $("#count").textContent = state.query ? `${rows.length} matching episodes` : `${rows.length} episodes`;
  $("#count").title = data?.source === "live" && !state.usePreview ? "Episodes with titles in the current Episodes tab." : "";
  const body = $("#rows"); body.replaceChildren();
  for (const [index, row] of rows.entries()) {
    const open = state.selected === row, tr = el("tr", `episode-row${open ? " selected" : ""}`);
    tr.tabIndex = 0; tr.dataset.episodeId = field(row, "ID"); tr.setAttribute("aria-label", `${title(row)}, ${open ? "collapse" : "expand"} details`);
    if (["E-005", "E-006"].includes(field(row, "ID"))) tr.dataset.miniSelected = "B";
    tr.setAttribute("aria-expanded", String(open));
    if (open) tr.setAttribute("aria-controls", `episode-detail-${field(row, "ID")}`);
    const episode = el("td", "episode-cell"), heading = el("div", "episode-heading");
    const badge = el("span", "orbit-tag", regimeShort(row)); badge.title = regime(row);
    const name = el("span", "episode-title"); name.append(safeEpisodeName(titleMarkup(row)));
    heading.append(name);
    episode.append(heading); tr.append(episode);
    const orbitCell = el("td", "orbit-cell"); orbitCell.append(badge); tr.append(orbitCell);
    const objectCell = el("td", "object-cell"); objectCell.append(objects(row, data)); tr.append(objectCell);
    const periodCell = el("td", "period-cell"); periodCell.append(periodNode(row)); tr.append(periodCell);
    const separation = el("td", "separation-column"); separation.append(proximityNode(row, "distance")); tr.append(separation);
    const speed = el("td", "speed-column"); speed.append(proximityNode(row, "speed")); tr.append(speed);
    const newsCell = el("td", "news-column"); newsCell.append(newsIndicator(row, linkedDescriptions(row, data).length)); tr.append(newsCell);
    tr.addEventListener("click", event => { if (!event.target.closest("button, a, input, select, .gterm")) toggleRow(row); });
    tr.addEventListener("keydown", event => { if (event.target === tr && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggleRow(row); } });
    body.append(tr);
    if (open) {
      const detailRow = el("tr", "expanded-row"), td = el("td"); detailRow.id = `episode-detail-${field(row, "ID")}`; detailRow.dataset.episodeId = field(row, "ID"); td.colSpan = 7; detailRow.append(td); body.append(detailRow);
      const id = field(row, "ID"), cached = state.details.get(id);
      if (data.source === "local-verification-candidates") td.append(expandedContent(row, { source: data.source, descriptions: [], sourceMetadata: {} }));
      else if (cached) { td.append(expandedContent(cached.row, cached)); startPreview(cached.row); }
      else {
        td.append(loadingDetail(row, data));
        ensureDetail(row).then(detail => {
          if (state.selected !== row || !td.isConnected) return;
          td.replaceChildren(expandedContent(detail.row, detail)); startPreview(detail.row);
        }).catch(error => {
          if (state.selected !== row || !td.isConnected) return;
          const notice = el("div", "expanded-loading", "Episode context is unavailable. "), retry = el("button", "text-action", "Retry");
          retry.addEventListener("click", () => { state.detailFailures.delete(id); td.replaceChildren(loadingDetail(row, data)); ensureDetail(row).then(detail => { if (state.selected === row && td.isConnected) { td.replaceChildren(expandedContent(detail.row, detail)); startPreview(detail.row); } }).catch(() => { if (state.selected === row && td.isConnected) td.replaceChildren(notice); }); });
          notice.append(retry); td.replaceChildren(notice); console.warn(error);
        });
      }
    }
  }
  const empty = $("#empty"); empty.hidden = rows.length > 0;
  if (!rows.length) {
    const noFeed = !data || data.source === "unavailable", nonePublished = !state.usePreview && data?.source === "live" && data.publishedEpisodes === 0;
    empty.replaceChildren(el("strong", "", noFeed ? "Current records could not be verified" : nonePublished ? "No episodes selected for public display" : "No matching episodes"), el("span", "", noFeed ? "Reload after the source is available." : nonePublished ? "The Frontend publication flag controls this table." : "Try another search."));
  }
  if (data?.source === "live") scheduleDetailPrefetch();
}
function setStatus() {
  const status = $("#status"), live = state.live;
  if (state.usePreview) { status.hidden = false; status.dataset.kind = "preview"; status.textContent = currentData()?.source === "local-verification-candidates" ? "LOCAL PREVIEW: verification candidates from a worklist, not published episodes." : "LOCAL PREVIEW: all workbook episodes, including unpublished rows."; }
  else if (live?.source === "live") { status.dataset.kind = live.descriptionError ? "error" : "live"; status.textContent = live.descriptionError ? `Source records unavailable: ${live.descriptionError}.` : ""; status.hidden = !live.descriptionError; }
  else { status.hidden = false; status.dataset.kind = "error"; status.textContent = `Current published sheet unavailable: ${live?.error || "unknown error"}. No stale episode dates are shown.`; }
}
async function init() {
  const localReviewMode = ["localhost", "127.0.0.1"].includes(location.hostname) && location.port === "8769";
  if (localReviewMode) {
    const shell = await fetch("./review-bar.html", { cache: "no-store" }).then(response => { if (!response.ok) throw new Error(`Local review shell returned ${response.status}`); return response.text(); });
    document.body.insertAdjacentHTML("afterbegin", shell);
    const reviewStyles = document.createElement("link"); reviewStyles.rel = "stylesheet"; reviewStyles.href = "../visualization/dev/review-nav.css"; document.head.append(reviewStyles);
    const { createLocalReview } = await import("./local-review.js?v=7");
    localReview = createLocalReview({ getMini: () => miniFrame?.contentWindow?.miniWorkshop, getFrame: () => miniFrame, setEditing: setMiniEditing, getSelectedEpisode: () => field(state.selected, "ID"), getPublicEpisode: assetId => state.live?.episodes?.find(row => row.ID === assetId)?.["Episode ID"] || assetId });
  }
  $("#preview-toggle").addEventListener("change", event => { state.usePreview = event.target.checked; state.selected = null; setStatus(); render(); });
  $("#search").addEventListener("input", event => { state.query = event.target.value.trim(); render(); });
  document.querySelectorAll(".sort-head").forEach(button => button.addEventListener("click", () => { const key = button.dataset.sort; state.sort = { key, direction: state.sort.key === key ? (state.sort.direction === "desc" ? "asc" : "desc") : key === "title" || key === "orbit" ? "asc" : "desc" }; render(); }));
  state.live = await Promise.all([
    fetch("./data/table.json", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(`Table support data returned ${r.status}`); return r.json(); }),
    loadCurrentEpisodes(),
    loadCurrentDescriptions().catch(error => ({ descriptions: [], error: error.message })),
    fetch("./data/space-track-satcat.json", { cache: "no-store" }).then(response => { if (!response.ok) throw new Error(`Space-Track catalog returned ${response.status}`); return response.json(); }),
  ]).then(([snapshot, feed, descriptionFeed, spaceTrack]) => {
    const episodes = feed.episodes;
    const e001 = episodes.find(row => field(row, "ID") === "E-001");
    if (e001) episodeUtcInterval(e001);
    return { ...snapshot, descriptions: descriptionFeed.descriptions, episodes, spaceTrack, publishedEpisodes: episodes.length, source: "live", snapshotUtc: feed.fetchedUtc, descriptionsCheckedUtc: descriptionFeed.fetchedUtc, descriptionError: descriptionFeed.error || "" };
  }).catch(error => ({ source: "unavailable", episodes: [], error: error.message }));
  const reviewEpisode = new URLSearchParams(location.search).get("review");
  if (reviewEpisode) state.selected = state.live.episodes?.find(row => publicEpisodeId(row) === reviewEpisode) || null;
  if (state.selected && !hasEpisodeVisual(field(state.selected, "ID"))) state.selected = null;
  const initialSelection = state.selected;
  state.selected = null;
  setStatus(); render();
  stageEpisodeAssets();
  // Supplementary values fill in after the indexed rows have already painted.
  void Promise.allSettled([
    fetch("./data/e002-metrics.json").then(response => { if (!response.ok) throw new Error(`E-002 metrics returned ${response.status}`); return response.json(); }),
    localE003Review ? fetch("../visualization/dev/e003/space-track-e003.json").then(response => response.json()) : Promise.resolve(null),
    fetch("../visualization/dev/e016/space-track-e016.json").then(response => response.json()),
    fetch("../visualization/dev/e059/space-track-e059.json").then(response => response.json()),
  ]).then(results => {
    const [metrics, e003, e016, e059] = results.map(result => result.status === "fulfilled" ? result.value : null);
    if (metrics) state.e002Metrics = metrics;
    for (const catalog of [e003, e016, e059]) if (catalog?.records && state.live?.spaceTrack?.records) Object.assign(state.live.spaceTrack.records, catalog.records);
    for (const key of ["distance", "speed"]) {
      const cell = document.querySelector(`.episode-row[data-episode-id="E-002"] .${key === "distance" ? "separation-column" : "speed-column"}`);
      const row = state.live.episodes?.find(item => item.ID === "E-002");
      if (cell && row) cell.replaceChildren(proximityNode(row, key));
    }
    if (state.sort.key === "distance" || state.sort.key === "speed") render();
  });
  await measureExpandedRowHeight().catch(error => console.warn("Expanded-row measurement unavailable", error));
  state.selected = initialSelection; render();
  for (const id of ["E-003", "E-005", "E-006", "E-008", "E-016", "E-059"]) {
    const row = state.live.episodes?.find(item => item.ID === id);
    if (!row) continue;
    historicalEpisodeMetrics(row, state.live.spaceTrack).then(metrics => {
      state.historicalMetrics[id] = metrics;
      for (const key of ["distance", "speed"]) {
        const metric = metrics[key === "distance" ? "minimumDistance" : "minimumSpeed"];
        const cell = document.querySelector(`.episode-row[data-episode-id="${id}"] .${key === "distance" ? "separation-column" : "speed-column"}`);
        if (metric && cell) cell.replaceChildren(proximityNode(row, key));
      }
      if (state.sort.key === "distance" || state.sort.key === "speed") render();
    }).catch(error => {
      console.warn(`${id} table metrics unavailable`, error);
      state.historicalMetrics[id] = {};
      render();
    });
  }
  if (state.selected) requestAnimationFrame(() => {
    const row = document.querySelector(`.episode-row[data-episode-id="${field(state.selected, "ID")}"]`);
    if (row) scrollTo({ top: scrollY + row.getBoundingClientRect().top - (document.getElementById("tableReviewBar")?.getBoundingClientRect().height || 0) - 16 });
  });
  const e001 = state.live.episodes?.find(row => field(row, "ID") === "E-001");
  if (e001) state.seriesPromise = calculateE001(episodeUtcInterval(e001)).then(series => { state.series = series; render(); return series; })
    .catch(error => { $("#status").dataset.kind = "error"; $("#status").textContent += ` E-001 reconstruction unavailable: ${error.message}.`; });
}
// Comments store the table's active search, sort, unfolded episode and the
// clicked spot, so opening one brings back the same slice of the table. Shape
// matches the shared comment hook.
let commentViewRestoreToken = 0;
window.__commentView = {
  capture(anchor) {
    const selectedId = state.selected ? field(state.selected, "ID") : "";
    let clickedId = selectedId;
    if (anchor && Number.isFinite(anchor.clientX) && Number.isFinite(anchor.clientY)) {
      const hit = document.elementFromPoint(anchor.clientX, anchor.clientY);
      const hitRow = hit?.closest?.(".episode-row, .expanded-row");
      if (hitRow?.dataset.episodeId) clickedId = hitRow.dataset.episodeId;
    }
    const clickedRow = clickedId ? document.querySelector(`.episode-row[data-episode-id="${clickedId}"]`) : null;
    const rect = clickedRow?.getBoundingClientRect();
    return {
      episode: selectedId,
      chapter: selectedId,
      chapterLabel: selectedId ? `Episode ${selectedId}` : "",
      search: $("#search")?.value || "",
      sort: { ...state.sort },
      scrollY: window.scrollY,
      anchor: anchor && rect ? {
        episodeId: clickedId,
        x: anchor.clientX - rect.left,
        y: anchor.clientY - rect.top,
        viewportX: anchor.x,
        viewportY: anchor.y,
      } : null,
    };
  },
  apply(view) {
    if (!view || !state.live) return false;
    const search = $("#search");
    if (search && typeof view.search === "string") {
      search.value = view.search;
      state.query = view.search.trim();
    }
    if (view.sort?.key) {
      state.sort = { key: view.sort.key, direction: view.sort.direction === "asc" ? "asc" : "desc" };
    }
    if ("episode" in view) {
      state.selected = view.episode
        ? (currentData()?.episodes || []).find(item => field(item, "ID") === view.episode) || null
        : null;
    }
    render();

    const token = ++commentViewRestoreToken;
    const rowId = view.anchor?.episodeId || view.episode;
    const align = (attempt = 0) => {
      if (token !== commentViewRestoreToken) return;
      const row = rowId ? document.querySelector(`.episode-row[data-episode-id="${rowId}"]`) : null;
      if (!row) {
        if (rowId && attempt < 20) setTimeout(() => align(attempt + 1), 150);
        else if (!rowId && Number.isFinite(view.scrollY)) scrollTo(0, view.scrollY);
        return;
      }
      if (view.anchor && Number.isFinite(view.anchor.viewportY)) {
        const targetY = (view.anchor.viewportY / 100) * innerHeight;
        const delta = row.getBoundingClientRect().top + view.anchor.y - targetY;
        if (Math.abs(delta) > 2) scrollBy(0, delta);
      } else if (Number.isFinite(view.scrollY)) {
        scrollTo(0, view.scrollY);
      }
      // The expanded detail grows as its description and images arrive; keep the
      // clicked spot under the restored card for a moment while that settles.
      if (attempt < 6) setTimeout(() => align(attempt + 1), 250);
    };
    align(0);
    return true;
  },
};

init().catch(error => { $("#status").textContent = `The table could not start: ${error.message}`; $("#status").dataset.kind = "error"; });


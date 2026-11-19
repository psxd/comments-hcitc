/* The two editorial tabs are fetched on every page load. Orbital asset keys are
   resolved from spacecraft identities, independently of spreadsheet row IDs. */
const SHEET_ID = "1IEQ3tmerXXxEty8BcZeaonWhQbHUfA2Z5b44IuCsQ8I";
export const EPISODES_CSV = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=860337817`;
export const RECORDS_CSV = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1572351989`;

async function fetchCsv(primary) {
  const request = url => fetch(`${url}&_=${Date.now()}`, { cache: "no-store", credentials: "omit" })
    .then(response => { if (!response.ok) throw new Error(`Sheet returned ${response.status}`); return response.text(); });
  return request(primary);
}

// Only entire spacecraft cells, never identifiers embedded in notes, select plotted objects.
export function cleanCospar(value) {
  const text = String(value ?? "").trim();
  return /^(?:19|20)\d{2}-\d{3}[A-Z]{1,3}$/.test(text) ? text : "";
}

export function plottedObjects(row) {
  return ["A", "B", "C"].map(slot => ({ slot, cospar: cleanCospar(row?.[`Object ${slot}`]) })).filter(item => item.cospar);
}

export function csvRows(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); if (row.some(value => value.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Published sheet contains an unfinished CSV field");
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export function parseCsv(text, requiredHeaders = ["ID"]) {
  const rows = csvRows(text);
  const headers = rows.shift()?.map(value => value.replace(/^\uFEFF/, "").trim());
  if (!headers || requiredHeaders.some(header => !headers.includes(header))) throw new Error(`Published sheet headers could not be verified: ${requiredHeaders.join(", ")}`);
  return rows.map(values => Object.fromEntries(headers.map((key, index) => [key, (values[index] || "").trim()]))).filter(record => record[requiredHeaders[0]]);
}

let request;
const ORBITAL_ASSET_BY_OBJECTS = new Map([
  ["2014-058A|2014-006B", "E-001"],
  ["2019-079A|2013-043A", "E-002"],
  ["2016-052B|2019-097A", "E-003"],
  ["2016-052A|2021-129A", "E-005"],
  ["2014-058A|1998-052A", "E-006"],
  ["2016-065A|2007-007B", "E-008"],
  ["2014-058A|2016-053A", "E-016"],
  ["2026-083H|2024-043F", "E-059"],
]);
export function loadCurrentEpisodes() {
  return request ||= fetchCsv(EPISODES_CSV)
    .then(text => {
      const rows = csvRows(text);
      const top = rows[0]?.map(value => value.replace(/^\uFEFF/, "").trim()) || [];
      const sub = rows[1]?.map(value => value.trim()) || [];
      const column = name => top.findIndex(value => value === name);
      const subcolumn = prefix => sub.findIndex(value => value.startsWith(prefix));
      const required = ["Episode ID", "Episode Title", "Orbit", "Episode description", "Tagged Records"];
      if (required.some(name => column(name) < 0) || subcolumn("Object A") < 0 || subcolumn("Object B") < 0)
        throw new Error("Episodes tab headers could not be verified");
      const cell = (values, index) => index < 0 ? "" : (values[index] || "").trim();
      const chapterColumn = (number, part) => {
        const explicit = top.findIndex(value => value.toLowerCase().startsWith(`chapter ${number} ${part}`));
        if (explicit >= 0) return explicit;
        const first = top.findIndex(value => value === `Chapter ${number}`);
        if (first < 0) return -1;
        return sub.findIndex((value, index) => index >= first && index <= first + 1 &&
          (part === "Center" ? /^Centerpoint/i : /^Width/i).test(value));
      };
      return rows.slice(2).filter(values => cell(values, column("Episode Title"))).map(values => {
        const publicId = cell(values, column("Episode ID"));
        const objects = ["A", "B", "C"].map(slot => cell(values, subcolumn(`Object ${slot}`)));
        const assetId = ORBITAL_ASSET_BY_OBJECTS.get(`${objects[0]}|${objects[1]}`);
        if (!/^E-\d{3,}$/.test(publicId) || !assetId)
          throw new Error(`Episode has an invalid ID or unmapped spacecraft: ${cell(values, column("Episode Title"))}`);
        const episode = { ID: assetId, "Episode ID": publicId,
          "Episode Name": cell(values, column("Episode Title")), "Episode Description": cell(values, column("Episode description")),
          Orbit: cell(values, column("Orbit")), Frontend: "TRUE", Descriptions: cell(values, column("Tagged Records")),
          "Tagged Records": cell(values, column("Tagged Records")), "Object C's Role": cell(values, subcolumn("Object C’s Role")) || cell(values, subcolumn("Object C's Role")) };
        for (const [index, slot] of ["A", "B", "C"].entries()) episode[`Object ${slot}`] = objects[index];
        for (let index = 1; index <= 4; index++) {
          episode[`Chapter ${index} Center`] = cell(values, chapterColumn(index, "Center"));
          episode[`Chapter ${index} Width (hours)`] = cell(values, chapterColumn(index, "Width"));
        }
        return episode;
      });
    }).then(episodes => {
      if (!episodes.length) throw new Error("Episodes sheet returned no episode records");
      for (const key of ["ID", "Episode ID"]) if (new Set(episodes.map(row => row[key])).size !== episodes.length)
        throw new Error(`Episodes sheet contains duplicate ${key} values`);
      return { episodes, fetchedUtc: new Date().toISOString() };
    });
}

let recordRequest;
export function loadCurrentRecords() {
  return recordRequest ||= Promise.all([fetchCsv(RECORDS_CSV), loadCurrentEpisodes()])
    .then(([text, feed]) => {
      const records = parseCsv(text, ["Record ID", "Related episodes", "URL", "Category"]);
      const publicToAsset = new Map(feed.episodes.map(row => [row["Episode ID"], row.ID]));
      const ids = records.map(row => row["Record ID"]);
      if (new Set(ids).size !== ids.length) throw new Error("Records sheet contains duplicate record IDs");
      const descriptions = records.map(row => {
        const linked = row["Related episodes"].split(/[,;\n]/).map(id => id.trim()).filter(Boolean);
        const unknown = linked.filter(id => !publicToAsset.has(id));
        if (unknown.length) throw new Error(`Record ${row["Record ID"]} refers to unknown episode ${unknown.join(", ")}`);
        return { ...row, ID: row["Record ID"], Episode: linked.map(id => publicToAsset.get(id)).join(", "),
          "Source URL": row.URL, "Description type": row.Category };
      });
      return { descriptions, records, fetchedUtc: new Date().toISOString() };
    });
}

export const loadCurrentDescriptions = loadCurrentRecords;

export function episodeChapters(row) {
  const chapters = [];
  for (let index = 1; index <= 4; index++) {
    const centerText = String(row?.[`Chapter ${index} Center`] || "").trim();
    const widthText = String(row?.[`Chapter ${index} Width (hours)`] || row?.[`Chapter ${index} Width`] || "").trim();
    if (!centerText && !widthText) continue;
    const match = centerText.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:Z)?$/);
    const widthHours = Number(widthText);
    if (!match || !Number.isFinite(widthHours) || widthHours <= 0 || widthHours > 24 * 366) continue;
    const iso = `${match[1]}T${(match[2] || "0").padStart(2, "0")}:${match[3] || "00"}:${match[4] || "00"}Z`;
    const centerMs = Date.parse(iso);
    if (!Number.isFinite(centerMs) || new Date(centerMs).toISOString().slice(0, 19) !== iso.slice(0, 19)) continue;
    const half = widthHours * 1800000;
    chapters.push({ id: `chapter-${index}`, index, center: iso, centerMs, widthHours,
      start: new Date(centerMs - half).toISOString(), end: new Date(centerMs + half).toISOString(),
      startMs: centerMs - half, endMs: centerMs + half });
  }
  return chapters.sort((a, b) => a.centerMs - b.centerMs);
}

export function episodeUtcInterval(row) {
  const chapters = episodeChapters(row);
  if (chapters.length) {
    const startMs = Math.min(...chapters.map(item => item.startMs));
    const endMs = Math.max(...chapters.map(item => item.endMs));
    return { start: new Date(startMs).toISOString().slice(0, 10), end: new Date(endMs).toISOString().slice(0, 10),
      startMs, endMs, endExclusiveMs: endMs + 1, chapters };
  }
  const start = row?.["Start Date"], end = row?.["End Date"];
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end)) throw new Error(`Episode ${row?.["Episode ID"] || "record"} has invalid start or end dates in the published sheet`);
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endExclusiveMs = Date.parse(`${end}T00:00:00Z`) + 86400000;
  if (endExclusiveMs <= startMs) throw new Error(`Episode ${row["Episode ID"]} ends before it starts in the published sheet (${start} to ${end})`);
  return { start, end, startMs, endExclusiveMs, endMs: endExclusiveMs - 1 };
}

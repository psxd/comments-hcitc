// Use editorial casing in explanatory prose while retaining catalog casing in cards.
export function dwellSatelliteName(value) {
  return String(value || "").replace(/\b(?:LUCH|OLYMP|INTELSAT|COSMOS|KOSMOS|SHIYAN)\b/gi,
    word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

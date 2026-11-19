// Compact two-unit duration for the full episode panels.
export function formatDwellDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const minutes = Math.round(milliseconds / 60000);
  if (minutes >= 24 * 60) {
    const hours = Math.round(minutes / 60);
    const days = Math.floor(hours / 24);
    const remainder = hours % 24;
    return `${days}\u202fd\u2002${remainder}\u202fh`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}\u202fh\u2002${remainder}\u202fm`;
}

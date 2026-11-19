// Pure helpers for the comment system: ID validation, HTML escaping, local
// timestamps, the view_hash payload, and shareable ?comment= URLs.

export const COMMENT_ID_RE = /^(?:cmt_[A-Za-z0-9_-]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Escape every user-controlled string before it goes near innerHTML. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truncate(text, max) {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** "Sep 25, 2026, 4:32 PM EDT" in the viewer's zone. */
export function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

// ---------- view_hash column ----------
// The sheet stores one free-form string per row. Version 2 of that payload
// keeps the page URL, playback time, card anchor, comment flags and, when the
// page can describe it, the exact camera/filter state:
//   { v: 2, page, time, x, y, global, view, kind: "edit" | "resolve", target }
// Ordinary comments leave kind/target out; replies are identified by parent_id.

export function makeViewHash(fields = {}) {
  return JSON.stringify({ v: 2, ...fields });
}

export function parseViewHash(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(String(raw));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// ---------- URLs ----------

/** Current path + query without the comment parameter. */
export function pageWithoutComment() {
  const url = new URL(window.location.href);
  url.searchParams.delete("comment");
  return `${url.pathname}${url.search}`;
}

export function commentIdFromUrl() {
  if (typeof window === "undefined") return "";
  const raw = (new URLSearchParams(window.location.search).get("comment") || "").trim();
  return COMMENT_ID_RE.test(raw) ? raw : "";
}

/** Absolute shareable URL for a stored page and comment id. */
export function withCommentParam(page, id) {
  try {
    const url = new URL(page || pageWithoutComment(), window.location.origin);
    if (id) url.searchParams.set("comment", id);
    else url.searchParams.delete("comment");
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return page || "";
  }
}

/** Stable identity for "is this the same page?" that ignores ?comment=. */
export function pageKey(href) {
  try {
    const url = new URL(href || pageWithoutComment(), window.location.origin);
    const params = [...url.searchParams.entries()]
      .filter(([key]) => key !== "comment")
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.map(([key, value]) => `${key}=${value}`).join("&");
    return `${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "";
  }
}

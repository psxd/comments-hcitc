// Comment backend configuration and session state, shared by every page.
//
// The two Google Apps Script Web App URLs are resolved at runtime, in order:
//   1. window.APPSCRIPT1_URL / window.APPSCRIPT2_URL (manual local override).
//   2. <meta name="appscript1-url"> / <meta name="appscript2-url">.
//   3. comment-secrets.js, rewritten by .github/workflows/pages.yml from the
//      APPSCRIPT1_URL / APPSCRIPT2_URL repository secrets.
//
// No real URLs are committed. Locally, set the window globals or meta tags
// before comments.js loads, or fill in comment-secrets.js without committing it.
//
// The signed-in session lives in memory for this page view only; refresh signs
// out. Nothing is written to storage.

import { APPSCRIPT1_URL as SECRET_AUTH_URL, APPSCRIPT2_URL as SECRET_COMMENT_URL } from "./comment-secrets.js";

export const ADMIN_USERNAME = "admin";

// Empty strings, deployment placeholders and "__NAME__" tokens all mean
// "not configured here"; try the next source instead.
const UNUSED = /^(?:__[^_].*__|APPSCRIPT\d_URL_PLACEHOLDER)?$/i;

function resolveEndpoint(globalName, metaName, secretUrl) {
  const candidates = [
    typeof window !== "undefined" ? window[globalName] : "",
    typeof document !== "undefined"
      ? document.querySelector(`meta[name="${metaName}"]`)?.content
      : "",
    secretUrl,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value && !UNUSED.test(value)) return value;
  }
  return "";
}

/** Google Apps Script Web App that verifies logins against the "Auth" sheet. */
export function authEndpoint() {
  return resolveEndpoint("APPSCRIPT1_URL", "appscript1-url", SECRET_AUTH_URL);
}

/** Google Apps Script Web App that reads and appends the "Comments" sheet. */
export function commentEndpoint() {
  return resolveEndpoint("APPSCRIPT2_URL", "appscript2-url", SECRET_COMMENT_URL);
}

// ---------- session ----------

let session = null; // { role: "user" | "admin", user, name, token }

export function getSession() {
  return session;
}

export function getAuthUser() {
  return session ? session.user : "";
}

export function getAuthName() {
  return session ? session.name || session.user : "";
}

export function isAdmin() {
  return Boolean(session && session.role === "admin");
}

export function clearSession() {
  session = null;
}

function setUserSession(user, name, token) {
  const role = user.trim().toLowerCase() === ADMIN_USERNAME.toLowerCase() ? "admin" : "user";
  session = { role, user, name: name || user, token: token || "" };
}

// ---------- Apps Script calls ----------
// Every call is a CORS "simple request": POST + text/plain + no custom headers,
// so browsers skip the OPTIONS preflight that Apps Script does not answer.

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    // Apps Script answers with an HTML sign-in / "unable to open" page when the
    // deployment is not shared with "Anyone". Surface that instead of
    // reporting it as a wrong password.
    throw new Error(
      response.status === 401 || response.status === 403
        ? "The Apps Script endpoint is not public. Redeploy it with access \"Anyone\"."
        : "The Apps Script endpoint returned a web page instead of JSON. Check that the deployment is live and shared with \"Anyone\"."
    );
  }
}

/**
 * Verifies a username/password pair against the "Auth" sheet. Only a response
 * that explicitly reports success signs the user in.
 */
export async function verifySheetLogin(username, password) {
  const endpoint = authEndpoint();
  if (!endpoint) throw new Error("The login endpoint is not configured.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ action: "login", username, password }),
  });
  const data = await readJson(response);
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) throw new Error(data.message || `Login failed (HTTP ${response.status})`);
  const succeeded = data.status === "success" || data.success === true;
  if (!succeeded) return false;
  // This deployment answers { status, message, user: { id, username } } and
  // issues no token; accept a flat username/name too for other deployments.
  const account = data.user && typeof data.user === "object" ? data.user : {};
  const user = String(account.username || data.username || username).trim() || username;
  setUserSession(user, String(account.name || data.name || user), data.token || "");
  return true;
}

/** Appends one row to the "Comments" sheet. */
export async function postCommentRecord(record) {
  const endpoint = commentEndpoint();
  if (!endpoint) throw new Error("The comment endpoint is not configured.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(record),
  });
  const data = await readJson(response);
  if (!response.ok || !(data.status === "success" || data.success === true)) {
    throw new Error(data.message || `Save failed (HTTP ${response.status})`);
  }
  return data;
}

/** Reads every row in the "Comments" sheet (arrays or objects). */
export async function fetchCommentRows() {
  const endpoint = commentEndpoint();
  if (!endpoint) throw new Error("The comment endpoint is not configured.");
  const response = await fetch(endpoint, { method: "GET", cache: "no-store" });
  const data = await readJson(response);
  if (!response.ok || !(data.status === "success" || data.success === true)) {
    throw new Error(data.message || `Could not load comments (HTTP ${response.status})`);
  }
  return Array.isArray(data.comments) ? data.comments : [];
}

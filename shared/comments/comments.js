// Shared comment system for every page of the tool.
//
// The module mounts its own controls, panels, dialog and stylesheet, so a page
// only needs:
//   <script type="module" src="<relative>/shared/comments/comments.js?v=1"></script>
//
// Flow: ⊕ -> sign in (users are verified against the Apps Script "Auth" sheet;
// the administrator account is verified by the same Auth sheet) -> click anywhere on the page ->
// composer with a "Global" checkbox -> Save appends a row to the "Comments"
// sheet -> the shareable ?comment= link is copied. Threads support replies, and
// an administrator gets an "All comments" panel with edit and resolve actions.
//
// The comments sheet is append-only. An edit therefore records a new row
// (author "admin", kind "edit", target <comment id>) holding the new version,
// and a resolve records a kind "resolve" row. Both rows are written to the
// sheet as admin comments; the client applies them to the original comment, so
// edited text is shown in place and resolved comments turn green without
// disappearing from any list.

import {
  ADMIN_USERNAME,
  postCommentRecord,
  fetchCommentRows,
  verifySheetLogin,
  getAuthUser,
  getAuthName,
  isAdmin,
  clearSession,
} from "./comment-config.js?v=3";
import {
  COMMENT_ID_RE,
  clamp,
  escapeHtml,
  truncate,
  formatTime,
  makeViewHash,
  parseViewHash,
  pageWithoutComment,
  commentIdFromUrl,
  withCommentParam,
  pageKey,
} from "./comment-url.js";

const $ = (id) => document.getElementById(id);

// ---------- mounting ----------
function commentButtons(classes) {
  return `
    <button id="addCommentBtn" class="${classes}" type="button" title="Add a comment at this view" aria-label="Add a comment at this view">⊕</button>
    <button id="myCommentsBtn" class="${classes}" type="button" title="My comments" aria-label="My comments" style="display:none;">☰</button>
    <button id="adminCommentsBtn" class="${classes}" type="button" title="All comments · administrator" aria-label="All comments, administrator" style="display:none;">⚙</button>
    <button id="logoutBtn" class="${classes}" type="button" title="Log out" aria-label="Log out" style="display:none;">⏻</button>`;
}

const COMMENT_DOM = `
  <div id="commentLayer" aria-live="polite"></div>
  <div id="commentHint">Click anywhere to place your comment — press Esc to cancel.</div>
  <div id="commentToast" role="status"></div>

  <div id="commentModalBackdrop" class="commentModalBackdrop">
    <div class="commentModal" role="dialog" aria-modal="true" aria-labelledby="commentLoginTitle">
      <div class="commentModalTitle" id="commentLoginTitle">Sign in to comment</div>
      <label class="commentModalLabel" for="commentUsername">Username</label>
      <input id="commentUsername" class="commentModalInput" type="text" autocomplete="username">
      <label class="commentModalLabel" for="commentPassword">Password</label>
      <input id="commentPassword" class="commentModalInput" type="password" autocomplete="current-password">
      <div id="commentLoginError" class="commentModalError" style="display:none;"></div>
      <div class="commentModalActions">
        <button id="commentCancelBtn" type="button" class="commentBtnSecondary">Cancel</button>
        <button id="commentLoginBtn" type="button" class="commentBtnYellow">Sign in</button>
      </div>
    </div>
  </div>

  <aside id="myCommentsPanel" class="myCommentsPanel" style="display:none;">
    <div class="myCommentsHeader">
      <span>My comments</span>
      <button id="myCommentsClose" type="button" class="commentBtnSecondary commentBtnTiny" title="Close">✕</button>
    </div>
    <div id="myCommentsStatus" class="commentStatus" style="display:none;"></div>
    <div id="myCommentsList" class="myCommentsList"></div>
  </aside>

  <aside id="adminCommentsPanel" class="adminCommentsPanel" style="display:none;">
    <div class="myCommentsHeader">
      <span>All comments · administrator</span>
      <button id="adminCommentsClose" type="button" class="commentBtnSecondary commentBtnTiny" title="Close">✕</button>
    </div>
    <div id="adminCommentsStatus" class="commentStatus" style="display:none;"></div>
    <div id="adminCommentsList" class="adminCommentsList"></div>
  </aside>`;

function injectStyles() {
  if (document.querySelector("link[data-comment-styles]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./comments.css?v=2", import.meta.url).href;
  link.dataset.commentStyles = "";
  document.head.append(link);
}

function mountCommentUi() {
  if (!document.body) return;
  injectStyles();
  if (!document.getElementById("commentLayer")) {
    document.body.insertAdjacentHTML("beforeend", COMMENT_DOM);
  }
  if (document.getElementById("addCommentBtn")) return;
  const controls = document.getElementById("cameraControls");
  if (controls && !controls.hidden) {
    // Pages with their own 3D camera controls get the buttons in that stack.
    controls.insertAdjacentHTML("beforeend", commentButtons("cameraBtn commentBtn"));
  } else {
    // Every other page (and pages whose controls are still loading) gets a dock.
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="commentDock" class="commentDock" role="group" aria-label="Comments">${commentButtons("commentBtn")}</div>`
    );
  }
}

// ---------- module state ----------
let addMode = false;
let composerEl = null;
let loginSuccessCb = null;
let prevUrl = "";
let activeThreadId = "";
let toastTimer = 0;
let wired = false;
let commentCache = null;
let commentCacheAt = 0;
const adminRows = new Map(); // comment id -> presented row (admin panel only)

// ---------- feedback ----------
function toast(message) {
  const el = $("commentToast");
  if (!el) return;
  el.textContent = String(message ?? ""); // textContent is XSS-safe
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = "none"; }, 6000);
}

function showErr(el, message) {
  if (el) { el.textContent = String(message ?? ""); el.style.display = "block"; }
}

function hideErr(el) {
  if (el) { el.textContent = ""; el.style.display = "none"; }
}

// ---------- playback time ----------
function timeSlider() {
  const primary = $("timelineSlider");
  if (primary) return primary;
  const generic = $("timeline");
  if (generic && Number(generic.max) - Number(generic.min) > 60 * 1000) return generic;
  return null;
}

function playbackTimeMs() {
  const workshopMs = window.__proximityWorkshop?.state?.time;
  if (Number.isFinite(workshopMs) && workshopMs > 0) return workshopMs;
  const slider = timeSlider();
  const value = Number(slider?.value);
  return Number.isFinite(value) && value > 1e11 ? value : null;
}

/** The view_hash payload for a new row: page, playback moment and card anchor. */
function currentViewHash(fields = {}) {
  const ms = playbackTimeMs();
  return makeViewHash({
    page: pageWithoutComment(),
    time: ms ? new Date(ms).toISOString() : "",
    ...fields,
  });
}

// ---------- camera, timeline and filters ----------
// A page that can describe its exact view exposes
//   window.__commentView = { capture(): object, apply(view): boolean|Promise<boolean> }
// Compare defines it from __proximityWorkshop, E-002 from its globe/playback
// model, and the Dynamic Table from its search and sort state. Pages without a
// hook still get the generic filter fallback below.
function captureViewState(anchor = null) {
  try {
    const hook = window.__commentView;
    const captured = hook && typeof hook.capture === "function" ? hook.capture(anchor) : null;
    if (captured && typeof captured === "object") return captured;
  } catch (err) {
    console.warn("Comment view capture failed:", err);
  }
  const fallback = {};
  for (const id of ["windowMode", "startTime", "endTime", "speed", "search"]) {
    const input = $(id);
    if (input && typeof input.value === "string" && input.value) fallback[id] = input.value;
  }
  if ($("axesBtn")?.classList.contains("isOn")) fallback.axes = true;
  return Object.keys(fallback).length ? fallback : null;
}

function applyGenericView(view) {
  if (!view || typeof view !== "object") return;
  for (const [id, value] of Object.entries(view)) {
    if (id === "axes" || typeof value !== "string") continue;
    const input = $(id);
    if (!input || !["INPUT", "SELECT", "TEXTAREA"].includes(input.tagName)) continue;
    input.value = value;
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }
  if (view.axes !== undefined) {
    const axes = $("axesBtn");
    if (axes && axes.classList.contains("isOn") !== Boolean(view.axes)) axes.click();
  }
}

/** Apply the stored time, filters and camera, retrying until the viewer is ready. */
async function restoreViewState(meta, attempt = 0) {
  const view = meta?.view;
  if (view) {
    const hook = window.__commentView;
    if (hook && typeof hook.apply === "function") {
      try {
        if (await hook.apply(view)) return;
      } catch (err) {
        console.warn("Comment view restore failed:", err);
      }
    } else {
      applyGenericView(view);
    }
  }
  if (attempt === 0) applyPlaybackTime(meta?.time);
  if (view && attempt < 40) setTimeout(() => { void restoreViewState(meta, attempt + 1); }, 400);
}

/** Restore the playback moment stored with a comment, once the scene is ready. */
function applyPlaybackTime(iso, attempt = 0) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return;
  const slider = timeSlider();
  if (slider) {
    slider.value = String(ms);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  try {
    if (Number.isFinite(window.__proximityWorkshop?.state?.time)) {
      window.__proximityWorkshop.setTime(iso);
      return;
    }
  } catch { /* not available on this page */ }
  if (attempt < 80) setTimeout(() => applyPlaybackTime(iso, attempt + 1), 250);
}

// ---------- URL ----------
function setUrlComment(id, replace = false) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("comment", id);
    else url.searchParams.delete("comment");
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
  } catch (err) {
    console.warn("Comment URL update failed:", err);
  }
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ---------- session / login modal ----------
function applySessionUi() {
  const signedIn = Boolean(getAuthUser());
  const myBtn = $("myCommentsBtn");
  if (myBtn) myBtn.style.display = signedIn ? "" : "none";
  const adminBtn = $("adminCommentsBtn");
  if (adminBtn) adminBtn.style.display = isAdmin() ? "" : "none";
  const logoutBtn = $("logoutBtn");
  if (logoutBtn) logoutBtn.style.display = signedIn ? "" : "none";
  if (!isAdmin()) {
    const panel = $("adminCommentsPanel");
    if (panel) panel.style.display = "none";
  }
}

function openLoginModal(onSuccess) {
  const backdrop = $("commentModalBackdrop");
  if (!backdrop) return;
  loginSuccessCb = typeof onSuccess === "function" ? onSuccess : null;
  hideErr($("commentLoginError"));
  const passEl = $("commentPassword");
  if (passEl) passEl.value = "";
  backdrop.style.display = "flex";
  const userEl = $("commentUsername");
  if (userEl) userEl.focus();
}

function closeLoginModal() {
  const backdrop = $("commentModalBackdrop");
  if (backdrop) backdrop.style.display = "none";
  loginSuccessCb = null;
  const passEl = $("commentPassword");
  if (passEl) passEl.value = "";
}

async function attemptLogin() {
  const nameEl = $("commentUsername");
  const passEl = $("commentPassword");
  const errEl = $("commentLoginError");
  const username = nameEl ? nameEl.value.trim() : "";
  const password = passEl ? passEl.value : "";
  const fail = (message) => { showErr(errEl, message); if (passEl) passEl.value = ""; };
  if (!username || !password) { fail("Enter both username and password."); return; }
  const button = $("commentLoginBtn");
  if (button) button.disabled = true;
  try {
    const ok = await verifySheetLogin(username, password);
    if (!ok) { fail("Invalid username or password."); return; }
  } catch (err) {
    console.error("Login failed:", err);
    fail(`Login failed: ${err.message || err}`);
    return;
  } finally {
    if (button) button.disabled = false;
  }
  const callback = loginSuccessCb;
  loginSuccessCb = null;
  closeLoginModal();
  applySessionUi();
  toast(`Signed in as ${getAuthName() || getAuthUser()}`);
  if (callback) callback();
}

function requireAuth(callback) {
  if (getAuthUser()) callback();
  else openLoginModal(callback);
}

// ---------- rows ----------
function normalizeRow(row) {
  const isArray = Array.isArray(row);
  const record = {
    id: String((isArray ? row[0] : row.id) ?? ""),
    view_hash: (isArray ? row[1] : row.view_hash) ?? "",
    author: String((isArray ? row[2] : row.author) ?? ""),
    comment_text: String((isArray ? row[3] : row.comment_text) ?? ""),
    parent_id: String((isArray ? row[4] : row.parent_id) ?? ""),
    created_at: (isArray ? row[5] : row.created_at ?? row.creared_at) ?? "",
    link: (isArray ? row[6] : row.link) ?? "",
  };
  record.meta = parseViewHash(record.view_hash);
  record.kind = record.meta.kind === "edit" || record.meta.kind === "resolve"
    ? record.meta.kind
    : record.parent_id ? "reply" : "comment";
  return record;
}

function timeOf(row) {
  const value = Date.parse(row?.created_at);
  return Number.isFinite(value) ? value : 0;
}

/** Newest admin edit / resolve row per target comment. */
function indexRows(rows) {
  const edits = new Map();
  const resolutions = new Map();
  for (const row of rows) {
    const target = typeof row.meta.target === "string" ? row.meta.target : "";
    if (!target) continue;
    const bucket = row.kind === "edit" ? edits : row.kind === "resolve" ? resolutions : null;
    if (!bucket) continue;
    const previous = bucket.get(target);
    if (!previous || timeOf(row) >= timeOf(previous)) bucket.set(target, row);
  }
  return { edits, resolutions };
}

/** A stored row with its admin edits and resolution applied. */
function presentRow(row, index) {
  const edit = index.edits.get(row.id);
  const resolution = index.resolutions.get(row.id);
  return {
    ...row,
    text: edit && edit.comment_text ? edit.comment_text : row.comment_text,
    global: edit && typeof edit.meta.global === "boolean" ? edit.meta.global : Boolean(row.meta.global),
    resolved: Boolean(resolution),
    editedAt: edit ? edit.created_at : "",
    editedBy: edit ? edit.author : "",
    resolvedAt: resolution ? resolution.created_at : "",
  };
}

function buildThread(rows, requestedId) {
  const index = indexRows(rows);
  const byId = new Map(rows.map((row) => [row.id, row]));
  let root = byId.get(requestedId) || null;
  let guard = 0;
  // Clicking a reply opens its whole thread.
  while (root && root.kind === "reply" && root.parent_id && guard < 8) {
    const parent = byId.get(root.parent_id);
    if (!parent) break;
    root = parent;
    guard += 1;
  }
  if (!root) return null;
  const replies = rows
    .filter((row) => row.kind === "reply" && row.parent_id === root.id)
    .sort((a, b) => timeOf(a) - timeOf(b));
  return { root: presentRow(root, index), replies: replies.map((row) => presentRow(row, index)) };
}

async function loadComments(force = false) {
  const now = Date.now();
  if (!force && commentCache && now - commentCacheAt < 5000) return commentCache;
  const rows = (await fetchCommentRows()).map(normalizeRow).filter((row) => row.id);
  commentCache = rows;
  commentCacheAt = now;
  return rows;
}

// ---------- rendering ----------
function positionCard(el, xPct, yPct) {
  const pad = 10;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = el.offsetWidth || 306;
  const h = el.offsetHeight || 160;
  el.style.left = `${clamp((xPct / 100) * vw, pad, Math.max(pad, vw - w - pad))}px`;
  el.style.top = `${clamp((yPct / 100) * vh, pad, Math.max(pad, vh - h - pad))}px`;
}

function badges(row) {
  const parts = [];
  if (row.global) parts.push('<span class="badge badgeGlobal">Global</span>');
  if (row.resolved) parts.push('<span class="badge badgeResolved">✓ Resolved</span>');
  if (row.editedAt) {
    parts.push(`<span class="commentEdited">Edited by ${escapeHtml(row.editedBy || "admin")} · ${escapeHtml(formatTime(row.editedAt))}</span>`);
  }
  return parts.length ? `<div class="commentBadges">${parts.join("")}</div>` : "";
}

function formatUtc(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return `${new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
    }).format(date)} UTC`;
  } catch {
    return date.toISOString();
  }
}

/** The saved view moment and chapter, shown on the opened comment. */
function viewMetaText(row) {
  const meta = parseViewHash(row.view_hash);
  const chapter = meta.chapterLabel || meta.chapter || "";
  return [formatUtc(meta.time || meta.view?.time), chapter].filter(Boolean).join(" · ");
}

function replyHtml(reply) {
  return `
    <div class="commentReply${reply.resolved ? " commentReplyResolved" : ""}">
      <div class="commentCardHeader">
        <span class="commentAuthor">${escapeHtml(reply.author || "Anonymous")}</span>
        <span class="commentTime">${escapeHtml(formatTime(reply.created_at))}</span>
      </div>
      <div class="commentText">${escapeHtml(reply.text)}</div>
      ${badges(reply)}
    </div>`;
}

function renderThread(thread, { focus = false } = {}) {
  const layer = $("commentLayer");
  if (!layer || !thread || !thread.root) return;
  const { root, replies } = thread;
  activeThreadId = root.id;
  layer.innerHTML = "";
  layer.style.display = "block";

  const meta = parseViewHash(root.view_hash);
  const anchor = {
    x: Number.isFinite(Number(meta.x)) && Number(meta.x) ? Number(meta.x) : 62,
    y: Number.isFinite(Number(meta.y)) && Number(meta.y) ? Number(meta.y) : 14,
  };

  const card = document.createElement("div");
  card.className = ["commentCard", focus ? "commentCardFocused" : "", root.resolved ? "commentCardResolved" : ""]
    .join(" ").trim();
  card.tabIndex = 0;
  card.innerHTML = `
    <div class="commentCardHeader">
      <span class="commentAuthor">${escapeHtml(root.author || "Anonymous")}</span>
      <button type="button" class="commentBtnClose" data-action="close" title="Close">✕</button>
    </div>
    <div class="commentTime">${escapeHtml(formatTime(root.created_at))}</div>
    ${viewMetaText(root) ? `<div class="commentViewMeta">${escapeHtml(viewMetaText(root))}</div>` : ""}
    <div class="commentText">${escapeHtml(root.text)}</div>
    ${badges(root)}
    <div class="commentCardActions">
      <button type="button" class="commentBtnYellow commentBtnTiny" data-action="reply">↩ Reply</button>
      <span class="commentThreadCount">${replies.length ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "No replies yet"}</span>
    </div>
    <div class="commentReplyList" style="${replies.length ? "" : "display:none;"}">${replies.map(replyHtml).join("")}</div>`;
  layer.appendChild(card);

  card.dataset.x = String(anchor.x);
  card.dataset.y = String(anchor.y);
  positionCard(card, anchor.x, anchor.y);

  card.querySelector('[data-action="reply"]').addEventListener("click", () => openReplyComposer(card, root));
  card.querySelector('[data-action="close"]').addEventListener("click", (event) => {
    event.stopPropagation();
    closeThread();
  });
}

function hideThread() {
  const layer = $("commentLayer");
  if (layer) { layer.innerHTML = ""; layer.style.display = "none"; }
  activeThreadId = "";
}

function closeThread() {
  hideThread();
  if (commentIdFromUrl()) setUrlComment(null, false);
}

// ---------- add mode ----------
function removeComposer() {
  if (composerEl) { composerEl.remove(); composerEl = null; }
}

function startAddMode() {
  requireAuth(() => {
    if (addMode) return;
    const myPanel = $("myCommentsPanel");
    if (myPanel) myPanel.style.display = "none";
    const adminPanel = $("adminCommentsPanel");
    if (adminPanel) adminPanel.style.display = "none";
    prevUrl = `${window.location.pathname}${window.location.search}`;
    hideThread();
    addMode = true;
    document.body.classList.add("comment-add-mode");
    const hint = $("commentHint");
    if (hint) hint.style.display = "block";
    setUrlComment(null, true);
  });
}

function endAddMode({ restore = false } = {}) {
  addMode = false;
  document.body.classList.remove("comment-add-mode");
  const hint = $("commentHint");
  if (hint) hint.style.display = "none";
  if (restore && prevUrl) {
    try { window.history.replaceState({}, "", prevUrl); } catch (err) { console.warn(err); }
    const id = commentIdFromUrl();
    if (id) openThreadById(id, { updateUrl: false }).catch((err) => console.warn(err));
  }
  prevUrl = "";
}

function openComposer(event) {
  removeComposer();
  const x = (event.clientX / Math.max(1, window.innerWidth)) * 100;
  const y = (event.clientY / Math.max(1, window.innerHeight)) * 100;
  openComposerWithAnchor({
    x: clamp(Number(x.toFixed(2)), 2, 98),
    y: clamp(Number(y.toFixed(2)), 2, 96),
  });
}

function openComposerWithAnchor(anchor) {
  removeComposer();
  const el = document.createElement("div");
  el.className = "commentCard commentComposer";
  el.dataset.x = String(anchor.x);
  el.dataset.y = String(anchor.y);
  el.innerHTML = `
    <div class="commentCardHeader">
      <span class="commentAuthor">${escapeHtml(getAuthName() || getAuthUser() || "Commenter")}</span>
      <span class="commentTime">New comment</span>
    </div>
    <textarea class="commentTextarea" maxlength="2000" placeholder="Write your comment..."></textarea>
    <label class="commentGlobalRow"><input type="checkbox" class="commentGlobalCheck"> <span>Global comment</span></label>
    <div class="commentComposerError" style="display:none;"></div>
    <div class="commentComposerActions">
      <button type="button" class="commentBtnSecondary" data-action="cancel">Cancel</button>
      <button type="button" class="commentBtnYellow" data-action="save">Save</button>
    </div>`;
  document.body.appendChild(el);
  composerEl = el;
  positionCard(el, anchor.x, anchor.y);
  el.querySelector('[data-action="cancel"]').addEventListener("click", () => {
    removeComposer();
    endAddMode({ restore: true });
  });
  el.querySelector('[data-action="save"]').addEventListener("click", saveNewComment);
  const textarea = el.querySelector(".commentTextarea");
  if (textarea) textarea.focus();
  positionCard(el, anchor.x, anchor.y);
}

async function saveNewComment() {
  const el = composerEl;
  if (!el) return;
  // Never post anonymously: a cleared session must sign in first. The draft is
  // kept, and the save is retried once the login succeeds.
  if (!getAuthUser()) {
    const saveButton = el.querySelector('[data-action="save"]');
    if (saveButton) saveButton.disabled = false;
    toast("Sign in to leave a comment.");
    openLoginModal(() => { void saveNewComment(); });
    return;
  }
  const textarea = el.querySelector(".commentTextarea");
  const globalInput = el.querySelector(".commentGlobalCheck");
  const errorEl = el.querySelector(".commentComposerError");
  const button = el.querySelector('[data-action="save"]');
  const text = (textarea ? textarea.value : "").trim();
  if (!text) { showErr(errorEl, "Write something before saving."); return; }
  hideErr(errorEl);
  if (button) button.disabled = true;
  try {
    const anchor = {
      x: clamp(Number(el.dataset.x), 2, 98),
      y: clamp(Number(el.dataset.y), 2, 96),
    };
    const view = captureViewState({
      x: anchor.x,
      y: anchor.y,
      clientX: (anchor.x / 100) * window.innerWidth,
      clientY: (anchor.y / 100) * window.innerHeight,
    });
    const chapter = view?.chapter || "";
    const chapterLabel = view?.chapterLabel || "";
    const hash = currentViewHash({
      x: anchor.x,
      y: anchor.y,
      global: Boolean(globalInput?.checked),
      ...(view?.time ? { time: view.time } : {}),
      ...(chapter ? { chapter } : {}),
      ...(chapterLabel ? { chapterLabel } : {}),
      ...(view ? { view } : {}),
    });
    const author = getAuthUser();
    const id = `cmt_${Date.now()}`;
    const createdAt = new Date().toISOString();
    await postCommentRecord({
      id,
      view_hash: hash,
      author,
      comment_text: text,
      parent_id: "",
      created_at: createdAt,
    });
    commentCache = null;
    const url = withCommentParam(pageWithoutComment(), id);
    removeComposer();
    endAddMode({ restore: false });
    setUrlComment(id, false);
    const copied = await copyToClipboard(url);
    toast(copied
      ? "Comment saved — shareable link copied to your clipboard."
      : `Comment saved — copy this link: ${url}`);
    const row = normalizeRow({ id, view_hash: hash, author, comment_text: text, parent_id: "", created_at: createdAt });
    renderThread({ root: presentRow(row, indexRows([])), replies: [] }, { focus: true });
  } catch (err) {
    console.error("Comment save failed:", err);
    showErr(errorEl, `Save failed: ${err.message || err}`);
    if (button) button.disabled = false;
  }
}

// ---------- replies ----------
function openReplyComposer(card, root) {
  requireAuth(() => {
    let box = card.querySelector(".commentReplyComposer");
    if (box) {
      const textarea = box.querySelector(".commentTextarea");
      if (textarea) textarea.focus();
      return;
    }
    box = document.createElement("div");
    box.className = "commentReplyComposer";
    box.innerHTML = `
      <div class="commentComposerActions" style="margin-top:0; justify-content:space-between;">
        <span class="commentThreadCount">Replying as ${escapeHtml(getAuthName() || getAuthUser() || "")}</span>
        <span style="display:flex; gap:8px;">
          <button type="button" class="commentBtnSecondary commentBtnTiny" data-action="rcancel">Cancel</button>
          <button type="button" class="commentBtnYellow commentBtnTiny" data-action="rsave">Reply</button>
        </span>
      </div>
      <textarea class="commentTextarea" maxlength="2000" placeholder="Write your reply..."></textarea>
      <label class="commentGlobalRow"><input type="checkbox" class="commentGlobalCheck"> <span>Global reply</span></label>
      <div class="commentComposerError" style="display:none;"></div>`;
    card.appendChild(box);
    positionCard(card, Number(card.dataset.x) || 62, Number(card.dataset.y) || 14);
    box.querySelector('[data-action="rcancel"]').addEventListener("click", () => {
      box.remove();
      positionCard(card, Number(card.dataset.x) || 62, Number(card.dataset.y) || 14);
    });
    box.querySelector('[data-action="rsave"]').addEventListener("click", () => saveReply(box, root));
    const textarea = box.querySelector(".commentTextarea");
    if (textarea) textarea.focus();
  });
}

async function saveReply(box, root) {
  if (!box || !box.isConnected) return;
  if (!getAuthUser()) {
    const replyButton = box.querySelector('[data-action="rsave"]');
    if (replyButton) replyButton.disabled = false;
    toast("Sign in to reply.");
    openLoginModal(() => { void saveReply(box, root); });
    return;
  }
  const textarea = box.querySelector(".commentTextarea");
  const globalInput = box.querySelector(".commentGlobalCheck");
  const errorEl = box.querySelector(".commentComposerError");
  const button = box.querySelector('[data-action="rsave"]');
  const text = (textarea ? textarea.value : "").trim();
  if (!text) { showErr(errorEl, "Write something before replying."); return; }
  hideErr(errorEl);
  if (button) button.disabled = true;
  try {
    await postCommentRecord({
      id: `cmt_${Date.now()}`,
      view_hash: currentViewHash({ kind: "reply", global: Boolean(globalInput?.checked) }),
      author: getAuthUser(),
      comment_text: text,
      parent_id: root.id,
      created_at: new Date().toISOString(),
    });
    const rows = await loadComments(true);
    const thread = buildThread(rows, root.id);
    if (thread) renderThread(thread, { focus: true });
    toast("Reply posted.");
  } catch (err) {
    console.error("Reply save failed:", err);
    showErr(errorEl, `Reply failed: ${err.message || err}`);
    if (button) button.disabled = false;
  }
}

// ---------- opening a thread ----------
async function openThreadById(id, { updateUrl = true } = {}) {
  const target = String(id || "");
  if (!COMMENT_ID_RE.test(target)) throw new Error("Unknown comment link.");
  if (addMode) { removeComposer(); endAddMode({ restore: false }); }
  const rows = await loadComments(true);
  const thread = buildThread(rows, target);
  if (!thread) throw new Error("Comment not found.");
  const meta = parseViewHash(thread.root.view_hash);
  if (meta.page && pageKey(meta.page) !== pageKey(window.location.href)) {
    window.location.href = withCommentParam(meta.page, thread.root.id);
    return;
  }
  void restoreViewState(meta);
  if (updateUrl) setUrlComment(thread.root.id, false);
  renderThread(thread, { focus: true });
}

// ---------- My comments ----------
async function openMyComments() {
  const panel = $("myCommentsPanel");
  if (!panel) return;
  if (!getAuthUser()) {
    openLoginModal(() => { openMyComments().catch((err) => console.error(err)); });
    return;
  }
  panel.style.display = "block";
  const statusEl = $("myCommentsStatus");
  const listEl = $("myCommentsList");
  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.classList.remove("commentError");
    statusEl.textContent = "Loading your comments…";
  }
  if (listEl) listEl.innerHTML = "";
  try {
    const rows = await loadComments(true);
    const index = indexRows(rows);
    const userRows = rows
      .filter((row) => row.author === getAuthUser() && (row.kind === "comment" || row.kind === "reply"))
      .map((row) => presentRow(row, index))
      .sort((a, b) => timeOf(b) - timeOf(a));
    if (!userRows.length) {
      if (statusEl) statusEl.textContent = "No comments yet.";
      return;
    }
    if (statusEl) statusEl.style.display = "none";
    if (!listEl) return;
    listEl.innerHTML = userRows.map((row) => {
      const isReply = row.kind === "reply";
      const target = (isReply && COMMENT_ID_RE.test(row.parent_id) && row.parent_id)
        || (COMMENT_ID_RE.test(row.id) && row.id)
        || "";
      const classes = ["myCommentItem", row.resolved ? "myCommentResolved" : ""].join(" ").trim();
      return `
        <button type="button" class="${classes}" data-id="${escapeHtml(target)}" ${target ? "" : "disabled"}>
          <span class="myCommentMeta">
            <span class="badge${isReply ? " badgeReply" : ""}">${isReply ? "Reply" : "Comment"}</span>
            <span class="myCommentTime">${escapeHtml(formatTime(row.created_at))}</span>
          </span>
          <span class="myCommentSnippet">${escapeHtml(truncate(row.text, 120))}</span>
          ${badges(row)}
        </button>`;
    }).join("");
  } catch (err) {
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.classList.add("commentError");
      statusEl.textContent = `Could not load comments: ${err.message || err}`;
    }
    console.error("My comments load failed:", err);
  }
}

// ---------- administrator: all comments, edit, resolve ----------
function rootIdFor(row) {
  return row.kind === "reply" && COMMENT_ID_RE.test(row.parent_id) ? row.parent_id : row.id;
}

function adminItemHtml(row) {
  const classes = ["adminComment", row.resolved ? "adminCommentResolved" : ""].join(" ").trim();
  return `
    <div class="${classes}" data-id="${escapeHtml(row.id)}">
      <div class="adminCommentTop">
        <span class="badge${row.kind === "reply" ? " badgeReply" : ""}">${row.kind === "reply" ? "Reply" : "Comment"}</span>
        <span class="adminCommentAuthor">${escapeHtml(row.author || "Anonymous")}</span>
        <span class="myCommentTime">${escapeHtml(formatTime(row.created_at))}</span>
      </div>
      <div class="adminCommentText">${escapeHtml(truncate(row.text, 500))}</div>
      ${badges(row)}
      <div class="adminCommentActions">
        <button type="button" class="commentBtnSecondary commentBtnTiny" data-action="open">Open</button>
        <button type="button" class="commentBtnSecondary commentBtnTiny" data-action="edit">Edit</button>
        <button type="button" class="commentBtnResolve commentBtnTiny" data-action="resolve" ${row.resolved ? "disabled" : ""}>${row.resolved ? "✓ Resolved" : "Resolve"}</button>
      </div>
    </div>`;
}

async function openAdminPanel() {
  if (!isAdmin()) {
    toast("Sign in as the administrator to review all comments.");
    return;
  }
  const panel = $("adminCommentsPanel");
  if (!panel) return;
  panel.style.display = "block";
  const statusEl = $("adminCommentsStatus");
  const listEl = $("adminCommentsList");
  adminRows.clear();
  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.classList.remove("commentError");
    statusEl.textContent = "Loading all comments…";
  }
  if (listEl) listEl.innerHTML = "";
  try {
    const rows = await loadComments(true);
    const index = indexRows(rows);
    const comments = rows
      .filter((row) => row.kind === "comment" || row.kind === "reply")
      .map((row) => presentRow(row, index))
      .sort((a, b) => timeOf(b) - timeOf(a));
    if (!comments.length) {
      if (statusEl) statusEl.textContent = "No comments yet.";
      return;
    }
    if (statusEl) statusEl.style.display = "none";
    if (!listEl) return;
    listEl.innerHTML = comments.map(adminItemHtml).join("");
    for (const row of comments) adminRows.set(row.id, row);
  } catch (err) {
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.classList.add("commentError");
      statusEl.textContent = `Could not load comments: ${err.message || err}`;
    }
    console.error("Admin comments load failed:", err);
  }
}

function openAdminEditor(item, row) {
  const existing = item.querySelector(".adminEditBox");
  if (existing) {
    const textarea = existing.querySelector("textarea");
    if (textarea) textarea.focus();
    return;
  }
  const box = document.createElement("div");
  box.className = "adminEditBox";
  box.innerHTML = `
    <div class="adminEditLabel">New version (saved as an admin comment)</div>
    <textarea class="commentTextarea" maxlength="2000"></textarea>
    <label class="commentGlobalRow"><input type="checkbox" class="commentGlobalCheck"> <span>Global comment</span></label>
    <div class="commentComposerError" style="display:none;"></div>
    <div class="commentComposerActions">
      <button type="button" class="commentBtnSecondary commentBtnTiny" data-action="cancel">Cancel</button>
      <button type="button" class="commentBtnYellow commentBtnTiny" data-action="save">Save</button>
    </div>`;
  item.appendChild(box);
  box.querySelector("textarea").value = row.text;
  box.querySelector('input[type="checkbox"]').checked = Boolean(row.global);
  box.querySelector("textarea").focus();
}

async function saveAdminEdit(item, row) {
  const box = item.querySelector(".adminEditBox");
  if (!box) return;
  const textarea = box.querySelector("textarea");
  const globalInput = box.querySelector('input[type="checkbox"]');
  const errorEl = box.querySelector(".commentComposerError");
  const button = box.querySelector('[data-action="save"]');
  const text = (textarea ? textarea.value : "").trim();
  if (!text) { showErr(errorEl, "Write the new version before saving."); return; }
  hideErr(errorEl);
  if (button) button.disabled = true;
  try {
    await postCommentRecord({
      id: `cmt_${Date.now()}`,
      view_hash: currentViewHash({
        kind: "edit",
        target: row.id,
        global: Boolean(globalInput?.checked),
      }),
      author: ADMIN_USERNAME,
      comment_text: text,
      parent_id: rootIdFor(row),
      created_at: new Date().toISOString(),
    });
    commentCache = null;
    toast("Edit saved — the new version is recorded as an admin comment.");
    await refreshPanels();
  } catch (err) {
    console.error("Admin edit failed:", err);
    showErr(errorEl, `Save failed: ${err.message || err}`);
    if (button) button.disabled = false;
  }
}

async function resolveComment(row) {
  try {
    await postCommentRecord({
      id: `cmt_${Date.now()}`,
      view_hash: currentViewHash({ kind: "resolve", target: row.id }),
      author: ADMIN_USERNAME,
      comment_text: "Marked resolved",
      parent_id: rootIdFor(row),
      created_at: new Date().toISOString(),
    });
    commentCache = null;
    toast("Comment marked resolved.");
    await refreshPanels();
  } catch (err) {
    console.error("Resolve failed:", err);
    toast(`Could not resolve: ${err.message || err}`);
  }
}

async function refreshPanels() {
  if (activeThreadId) {
    try {
      const rows = await loadComments(true);
      const thread = buildThread(rows, activeThreadId);
      if (thread) renderThread(thread, { focus: false });
    } catch (err) {
      console.warn("Could not refresh the open comment thread:", err);
    }
  }
  if (isAdmin() && $("adminCommentsPanel")?.style.display === "block") {
    await openAdminPanel();
  }
}

async function handleAdminAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const item = button.closest(".adminComment");
  if (!item) return;
  const row = adminRows.get(item.dataset.id);
  if (!row) return;
  const action = button.dataset.action;
  if (action === "open") {
    const panel = $("adminCommentsPanel");
    if (panel) panel.style.display = "none";
    openThreadById(rootIdFor(row)).catch((err) => {
      console.error(err);
      toast(`Could not open comment: ${err.message || err}`);
    });
  } else if (action === "edit") {
    openAdminEditor(item, row);
  } else if (action === "cancel") {
    item.querySelector(".adminEditBox")?.remove();
  } else if (action === "save") {
    await saveAdminEdit(item, row);
  } else if (action === "resolve") {
    await resolveComment(row);
  }
}

// ---------- wiring ----------
function repositionCards() {
  document.querySelectorAll("#commentLayer .commentCard").forEach((card) => {
    positionCard(card, Number(card.dataset.x) || 62, Number(card.dataset.y) || 14);
  });
  if (composerEl) positionCard(composerEl, Number(composerEl.dataset.x) || 60, Number(composerEl.dataset.y) || 14);
}

function wireControls() {
  if (wired) return;
  wired = true;

  $("addCommentBtn")?.addEventListener("click", () => {
    try { startAddMode(); } catch (err) { console.error(err); toast(err.message); }
  });

  $("myCommentsBtn")?.addEventListener("click", () => {
    openMyComments().catch((err) => { console.error(err); toast(`Could not load comments: ${err.message || err}`); });
  });
  $("myCommentsClose")?.addEventListener("click", () => {
    const panel = $("myCommentsPanel");
    if (panel) panel.style.display = "none";
  });

  $("adminCommentsBtn")?.addEventListener("click", () => {
    openAdminPanel().catch((err) => { console.error(err); toast(`Could not load comments: ${err.message || err}`); });
  });
  $("adminCommentsClose")?.addEventListener("click", () => {
    const panel = $("adminCommentsPanel");
    if (panel) panel.style.display = "none";
  });

  $("logoutBtn")?.addEventListener("click", () => {
    clearSession();
    const myPanel = $("myCommentsPanel");
    if (myPanel) myPanel.style.display = "none";
    const adminPanel = $("adminCommentsPanel");
    if (adminPanel) adminPanel.style.display = "none";
    // End add mode even before a composer exists, and discard open reply boxes,
    // so a signed-out visitor has to sign in again before leaving a comment.
    if (addMode || composerEl) { removeComposer(); endAddMode({ restore: false }); }
    document.querySelectorAll(".commentReplyComposer").forEach((box) => box.remove());
    applySessionUi();
    toast("Signed out.");
  });

  $("commentLoginBtn")?.addEventListener("click", attemptLogin);
  $("commentCancelBtn")?.addEventListener("click", closeLoginModal);
  for (const id of ["commentUsername", "commentPassword"]) {
    const el = $(id);
    if (el) {
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); attemptLogin(); }
      });
    }
  }
  const backdrop = $("commentModalBackdrop");
  if (backdrop) {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeLoginModal();
    });
  }

  $("myCommentsList")?.addEventListener("click", (event) => {
    const item = event.target.closest?.(".myCommentItem");
    if (!item) return;
    const id = item.getAttribute("data-id") || "";
    if (!COMMENT_ID_RE.test(id)) return;
    const panel = $("myCommentsPanel");
    if (panel) panel.style.display = "none";
    openThreadById(id).catch((err) => {
      console.error(err);
      toast(`Could not open comment: ${err.message || err}`);
    });
  });

  $("adminCommentsList")?.addEventListener("click", (event) => {
    handleAdminAction(event).catch((err) => {
      console.error(err);
      toast(`Action failed: ${err.message || err}`);
    });
  });

  // Click-to-place: any click that is not a drag, a control, or a comment
  // surface drops the composer at the pointer.
  const NON_PLACEABLE = "#commentDock, #cameraControls, #playbackDock, #commentToast, #commentHint, #gtLogo, .commentModalBackdrop, .myCommentsPanel, .adminCommentsPanel, .commentCard";
  const INTERACTIVE = 'input, select, textarea, button, a, label, summary, [contenteditable="true"], [role="button"]';
  let pointerDownAt = null;
  document.addEventListener("pointerdown", (event) => {
    pointerDownAt = { x: event.clientX, y: event.clientY };
  }, true);
  document.addEventListener("click", (event) => {
    if (!addMode || composerEl) return;
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    if (target.closest(NON_PLACEABLE)) return;
    if (target.closest(INTERACTIVE)) return;
    if (pointerDownAt && Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y) > 6) return;
    openComposer(event);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = $("commentModalBackdrop");
    if (modal && modal.style.display === "flex") { closeLoginModal(); return; }
    if (composerEl) { removeComposer(); endAddMode({ restore: true }); return; }
    if (addMode) { endAddMode({ restore: true }); return; }
    const myPanel = $("myCommentsPanel");
    if (myPanel && myPanel.style.display === "block") { myPanel.style.display = "none"; return; }
    const adminPanel = $("adminCommentsPanel");
    if (adminPanel && adminPanel.style.display === "block") adminPanel.style.display = "none";
  });

  window.addEventListener("resize", repositionCards);

  window.addEventListener("popstate", () => {
    if (addMode || composerEl) return;
    const id = commentIdFromUrl();
    if (id) {
      openThreadById(id, { updateUrl: false }).catch((err) => console.warn("Comment restore failed:", err));
    } else {
      hideThread();
    }
  });
}

// ---------- boot ----------
async function bootFromUrl() {
  const id = commentIdFromUrl();
  if (!id) return;
  try {
    const rows = await loadComments(true);
    const thread = buildThread(rows, id);
    if (!thread) throw new Error("Comment not found.");
    void restoreViewState(parseViewHash(thread.root.view_hash));
    renderThread(thread, { focus: false });
  } catch (err) {
    console.error("Comment URL restore failed:", err);
    toast(`Could not load comment: ${err.message || err}`);
  }
}

function initComments() {
  mountCommentUi();
  applySessionUi();
  try {
    wireControls();
  } catch (err) {
    console.error("Comment controls failed to start:", err);
  }
  bootFromUrl().catch((err) => console.error("Comment URL restore failed:", err));
}

initComments();

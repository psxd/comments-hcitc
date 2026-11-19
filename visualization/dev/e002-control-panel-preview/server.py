"""Local E-002 review server. Serves repo files and saves spot comments locally."""

from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import tempfile
import sys
from uuid import uuid4


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))
from review_store import (review_comments, change_comment, camera_moments, change_moment,
                          e001_views, e001_speeds, change_e001_view, change_e001_speed,
                          e005_views, change_e005_view, e003_views, change_e003_view,
                          e006_views, change_e006_view, e008_views, change_e008_view,
                          e016_views, change_e016_view, e059_views, change_e059_view)
COMMENTS = HERE / "spot-comments.json"
CAMERA_VIEWS = HERE / "saved-camera-views.json"
TABLE_COMMENTS = HERE / "table-comments.json"
TABLE_PREVIEW = HERE / "table-preview.json"
PORT = 8769


def write_review_file(path, payload):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=HERE, prefix=f".{path.stem}-", delete=False) as temporary:
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        name = temporary.name
    Path(name).replace(path)


def read_table_comments():
    return json.loads(TABLE_COMMENTS.read_text(encoding="utf-8")).get("comments", []) if TABLE_COMMENTS.exists() else []


def read_table_preview():
    return json.loads(TABLE_PREVIEW.read_text(encoding="utf-8")).get("config") if TABLE_PREVIEW.exists() else None


def read_table_previews():
    if not TABLE_PREVIEW.exists():
        return {}
    payload = json.loads(TABLE_PREVIEW.read_text(encoding="utf-8"))
    return payload.get("configs") or ({"E-002": payload["config"]} if payload.get("config") else {})


def read_comments():
    if not COMMENTS.exists():
        return []
    data = json.loads(COMMENTS.read_text(encoding="utf-8"))
    return data.get("comments", [])


def write_comments(comments):
    payload = {"schema": "espl-e002-spot-comments-v1", "comments": comments}
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=HERE, prefix=".spot-comments-", delete=False
    ) as temporary:
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        name = temporary.name
    Path(name).replace(COMMENTS)


def read_camera_views():
    if not CAMERA_VIEWS.exists():
        return []
    return json.loads(CAMERA_VIEWS.read_text(encoding="utf-8")).get("views", [])


def write_camera_views(views):
    payload = {"schema": "espl-e002-camera-views-v1", "views": views}
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=HERE, prefix=".camera-views-", delete=False
    ) as temporary:
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        name = temporary.name
    Path(name).replace(CAMERA_VIEWS)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO), **kwargs)

    def end_headers(self):
        # Local design reviews change frequently; stale module scripts break the
        # camera workshop even when its HTML and controls have refreshed.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def respond(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/api/review-comments":
            return self.respond(200, {"comments": review_comments()})
        if self.path == "/api/camera-moments":
            return self.respond(200, {"moments": camera_moments()})
        if self.path == "/api/e001-camera-views":
            return self.respond(200, {"views": e001_views()})
        if self.path == "/api/e005-camera-views":
            return self.respond(200, {"views": e005_views()})
        if self.path == "/api/e003-camera-views":
            return self.respond(200, {"views": e003_views()})
        if self.path == "/api/e006-camera-views":
            return self.respond(200, {"views": e006_views()})
        if self.path == "/api/e008-camera-views":
            return self.respond(200, {"views": e008_views()})
        if self.path == "/api/e016-camera-views":
            return self.respond(200, {"views": e016_views()})
        if self.path == "/api/e059-camera-views":
            return self.respond(200, {"views": e059_views()})
        if self.path == "/api/e001-speed-preferences":
            return self.respond(200, {"preferences": e001_speeds()})
        if self.path == "/api/spot-comments":
            self.respond(200, {"schema": "espl-e002-spot-comments-v1", "comments": read_comments()})
            return
        if self.path == "/api/camera-views":
            self.respond(200, {"schema": "espl-e002-camera-views-v1", "views": read_camera_views()})
            return
        if self.path == "/api/table-comments":
            self.respond(200, {"schema": "espl-dynamic-table-comments-v1", "comments": read_table_comments()})
            return
        if self.path == "/api/table-preview":
            saved_at = json.loads(TABLE_PREVIEW.read_text(encoding="utf-8")).get("savedAt") if TABLE_PREVIEW.exists() else None
            self.respond(200, {"schema": "espl-mini-preview-v2", "configs": read_table_previews(), "savedAt": saved_at})
            return
        super().do_GET()

    def do_POST(self):
        if self.path not in ("/api/spot-comments", "/api/camera-views", "/api/table-comments", "/api/table-preview", "/api/review-comments", "/api/camera-moments", "/api/e001-camera-views", "/api/e003-camera-views", "/api/e005-camera-views", "/api/e006-camera-views", "/api/e008-camera-views", "/api/e016-camera-views", "/api/e059-camera-views", "/api/e001-speed-preferences"):
            self.respond(404, {"error": "Unknown endpoint"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 16384:
                raise ValueError("Comment request must be 1–16384 bytes")
            request = json.loads(self.rfile.read(length))
            if self.path == "/api/review-comments":
                return self.respond(200, {"comments": change_comment(request)})
            if self.path == "/api/camera-moments":
                return self.respond(200, {"moments": change_moment(request)})
            if self.path == "/api/e001-camera-views":
                return self.respond(200, {"views": change_e001_view(request)})
            if self.path == "/api/e005-camera-views":
                return self.respond(200, {"views": change_e005_view(request)})
            if self.path == "/api/e003-camera-views":
                return self.respond(200, {"views": change_e003_view(request)})
            if self.path == "/api/e006-camera-views":
                return self.respond(200, {"views": change_e006_view(request)})
            if self.path == "/api/e008-camera-views":
                return self.respond(200, {"views": change_e008_view(request)})
            if self.path == "/api/e016-camera-views":
                return self.respond(200, {"views": change_e016_view(request)})
            if self.path == "/api/e059-camera-views":
                return self.respond(200, {"views": change_e059_view(request)})
            if self.path == "/api/e001-speed-preferences":
                return self.respond(200, {"preferences": change_e001_speed(request)})
            if self.path == "/api/table-preview":
                config = request.get("config")
                episode_id = config.get("episodeId", "E-002") if isinstance(config, dict) else None
                valid_window = config.get("windowId") in ("dec9", "dec30") if episode_id == "E-002" else str(config.get("windowId", "")).startswith("chapter-") if episode_id in ("E-001", "E-003", "E-005", "E-006", "E-008", "E-016", "E-059") else False
                if not isinstance(config, dict) or not valid_window or config.get("frameMode") not in ("relative", "inertial"):
                    raise ValueError("Invalid miniature preview chapter or camera frame")
                start = datetime.fromisoformat(str(config.get("loopStartUtc", "")).replace("Z", "+00:00"))
                end = datetime.fromisoformat(str(config.get("loopEndUtc", "")).replace("Z", "+00:00"))
                if not start < end or (end - start).total_seconds() > 31 * 24 * 3600:
                    raise ValueError("Invalid miniature preview loop")
                rate = config.get("rate")
                if not isinstance(rate, (int, float)) or not math.isfinite(rate) or not 60 <= rate <= 14400:
                    raise ValueError("Invalid miniature preview playback rate")
                camera = config.get("camera")
                if not isinstance(camera, dict):
                    raise ValueError("Missing miniature camera")
                for name in ("position", "target", "up"):
                    values = camera.get(name)
                    if not isinstance(values, list) or len(values) != 3 or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in values):
                        raise ValueError(f"Invalid miniature camera {name}")
                if not all(isinstance(camera.get(name), (int, float)) and math.isfinite(camera[name]) for name in ("fieldOfViewDeg", "zoom")):
                    raise ValueError("Invalid miniature camera optics")
                configs = read_table_previews(); configs[episode_id] = config
                write_review_file(TABLE_PREVIEW, {"schema": "espl-mini-preview-v2", "configs": configs, "savedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
                self.respond(200, {"schema": "espl-mini-preview-v2", "configs": configs, "config": config})
                return
            if self.path == "/api/table-comments":
                comments = read_table_comments()
                if request.get("action") == "add":
                    text = str(request.get("text", "")).strip()
                    key = str(request.get("key", ""))
                    label = str(request.get("label", ""))
                    x, y = float(request.get("x", 0)), float(request.get("y", 0))
                    if not text or len(text) > 4000 or not key or len(key) > 160 or len(label) > 160 or not (0 <= x <= 1 and 0 <= y <= 1):
                        raise ValueError("Invalid table comment or location")
                    comments.append({"id": uuid4().hex, "key": key, "label": label, "x": x, "y": y, "text": text, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
                elif request.get("action") == "delete":
                    comments = [item for item in comments if item.get("id") != str(request.get("id", ""))]
                else:
                    raise ValueError("Unknown table-comment action")
                write_review_file(TABLE_COMMENTS, {"schema": "espl-dynamic-table-comments-v1", "comments": comments})
                self.respond(200, {"schema": "espl-dynamic-table-comments-v1", "comments": comments})
                return
            if self.path == "/api/camera-views":
                if request.get("action") == "annotate":
                    note = str(request.get("note", "")).strip()
                    views = read_camera_views()
                    if len(note) > 4000 or not any(view.get("id") == request.get("id") for view in views):
                        raise ValueError("Invalid camera view note")
                    for view in views:
                        if view.get("id") == request["id"]:
                            view["note"] = note
                    write_camera_views(views)
                    return self.respond(200, {"schema": "espl-e002-camera-views-v1", "views": views})
                if request.get("action") == "delete":
                    identifier = str(request.get("id", ""))
                    views = read_camera_views()
                    if not identifier or not any(view.get("id") == identifier for view in views):
                        raise ValueError("Camera view not found")
                    views = [view for view in views if view.get("id") != identifier]
                    write_camera_views(views)
                    self.respond(200, {"schema": "espl-e002-camera-views-v1", "views": views})
                    return
                view = request.get("view", {})
                if request.get("action") != "add" or not isinstance(view, dict):
                    raise ValueError("Unknown camera-view action")
                for name in ("position", "target", "up"):
                    values = view.get(name)
                    if not isinstance(values, list) or len(values) != 3 or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in values):
                        raise ValueError(f"Invalid camera {name}")
                if view.get("mode") not in ("eci", "relative") or view.get("referenceMode") not in ("midpoint", "nearusa", "usa245", "target", "chaser"):
                    raise ValueError("Invalid camera mode")
                if view.get("selected") not in ("A", "C") or len(str(view.get("windowId", ""))) > 80:
                    raise ValueError("Invalid camera context")
                datetime.fromisoformat(str(view.get("timeUtc", "")).replace("Z", "+00:00"))
                views = read_camera_views()
                note = str(view.get("note", "")).strip()
                if len(note) > 4000:
                    raise ValueError("Invalid camera view note")
                views.append({"id": uuid4().hex, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                              **{key: view[key] for key in ("windowId", "timeUtc", "selected", "mode", "referenceMode", "auto", "position", "target", "up", "fov", "zoom")}, "note": note})
                write_camera_views(views)
                self.respond(200, {"schema": "espl-e002-camera-views-v1", "views": views})
                return
            comments = read_comments()
            if request.get("action") == "add":
                text = str(request.get("text", "")).strip()
                key = str(request.get("key", ""))
                root = str(request.get("root", ""))
                label = str(request.get("label", ""))
                x, y = float(request.get("x", 0)), float(request.get("y", 0))
                if not text or len(text) > 4000 or len(key) > 120 or len(label) > 160:
                    raise ValueError("Comment text or location is invalid")
                if root not in ("panel", "selector") or not (0 <= x <= 1 and 0 <= y <= 1):
                    raise ValueError("Comment location is invalid")
                if not isinstance(request.get("appliesToAllEpisodes", False), bool):
                    raise ValueError("Comment scope is invalid")
                comments.append({
                    "id": uuid4().hex, "root": root, "key": key, "label": label,
                    "x": x, "y": y, "text": text,
                    "appliesToAllEpisodes": request.get("appliesToAllEpisodes", False),
                    "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                })
            elif request.get("action") == "delete":
                identifier = str(request.get("id", ""))
                comments = [comment for comment in comments if comment.get("id") != identifier]
            else:
                raise ValueError("Unknown comment action")
            write_comments(comments)
            self.respond(200, {"schema": "espl-e002-spot-comments-v1", "comments": comments})
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.respond(400, {"error": str(error)})


if __name__ == "__main__":
    print(f"E-002 control-panel review: http://127.0.0.1:{PORT}/visualization/dev/e002-control-panel-preview/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

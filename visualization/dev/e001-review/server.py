"""Local E-001 review preview and author feedback, bound only to localhost."""
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
from review_store import review_comments, change_comment, camera_moments, change_moment
COMMENTS = HERE / "spot-comments.json"
VIEWS = HERE / "saved-camera-views.json"
SPEEDS = HERE / "speed-preferences.json"


def read(path, key):
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get(key, [])


def save(path, key, items):
    payload = {"schema": "espl-e001-local-review-v1", key: items}
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=HERE, prefix=".review-", delete=False) as output:
        json.dump(payload, output, ensure_ascii=False, indent=2)
        output.write("\n")
        temporary = Path(output.name)
    temporary.replace(path)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO), **kwargs)

    def respond(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/review-comments":
            return self.respond(200, {"comments": review_comments()})
        if self.path == "/api/camera-moments":
            return self.respond(200, {"moments": camera_moments()})
        if self.path == "/api/e001-comments":
            return self.respond(200, {"comments": read(COMMENTS, "comments")})
        if self.path == "/api/e001-camera-views":
            return self.respond(200, {"views": read(VIEWS, "views")})
        if self.path == "/api/e001-speed-preferences":
            return self.respond(200, {"preferences": read(SPEEDS, "preferences")})
        return super().do_GET()

    def do_POST(self):
        if self.path not in ("/api/e001-comments", "/api/e001-camera-views", "/api/e001-speed-preferences", "/api/review-comments", "/api/camera-moments"):
            return self.respond(404, {"error": "Unknown endpoint"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= length <= 16384:
                raise ValueError("Invalid request length")
            data = json.loads(self.rfile.read(length))
            if self.path == "/api/review-comments":
                return self.respond(200, {"comments": change_comment(data)})
            if self.path == "/api/camera-moments":
                return self.respond(200, {"moments": change_moment(data)})
            if self.path == "/api/e001-speed-preferences":
                if data.get("action") != "set" or not isinstance(data.get("item"), dict):
                    raise ValueError("Invalid speed preference action")
                item = data["item"]
                chapter = str(item.get("chapterId", ""))
                reference = item.get("referenceSatellite")
                mode = item.get("cameraMode")
                speed = item.get("minutesPerSecond")
                if not chapter.startswith("chapter-") or len(chapter) > 40 or reference not in ("A", "B") or mode not in ("relative", "earth"):
                    raise ValueError("Invalid speed preference view")
                if not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0 < speed <= 240:
                    raise ValueError("Invalid playback speed")
                preferences = [entry for entry in read(SPEEDS, "preferences") if (entry["chapterId"], entry["referenceSatellite"], entry["cameraMode"]) != (chapter, reference, mode)]
                preferences.append({"chapterId": chapter, "referenceSatellite": reference, "cameraMode": mode, "minutesPerSecond": speed,
                                    "savedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
                save(SPEEDS, "preferences", preferences)
                return self.respond(200, {"preferences": preferences})
            is_comment = self.path.endswith("comments")
            path, key = (COMMENTS, "comments") if is_comment else (VIEWS, "views")
            items = read(path, key)
            if data.get("action") == "delete":
                items = [item for item in items if item.get("id") != data.get("id")]
            elif data.get("action") == "annotate" and not is_comment:
                note = str(data.get("note", "")).strip()
                if len(note) > 4000 or not any(item.get("id") == data.get("id") for item in items):
                    raise ValueError("Invalid camera view note")
                for item in items:
                    if item.get("id") == data["id"]:
                        item["note"] = note
            elif data.get("action") == "add":
                item = data.get("item")
                if not isinstance(item, dict):
                    raise ValueError("Missing review item")
                if is_comment:
                    if not str(item.get("text", "")).strip() or len(str(item["text"])) > 4000:
                        raise ValueError("Invalid comment text")
                    if not isinstance(item.get("key"), str) or len(item["key"]) > 120:
                        raise ValueError("Invalid comment location")
                    if not all(isinstance(item.get(axis), (int, float)) and 0 <= item[axis] <= 1 for axis in ("x", "y")):
                        raise ValueError("Invalid comment position")
                    if not isinstance(item.get("appliesToAllEpisodes", False), bool):
                        raise ValueError("Invalid comment scope")
                    applies_to_all = item.get("appliesToAllEpisodes", False)
                    item = {k: item[k] for k in ("key", "label", "x", "y", "text")}
                    item["appliesToAllEpisodes"] = applies_to_all
                else:
                    if item.get("schema") != "espl-proximity-camera-view-v1" or item.get("cameraMode") not in ("earth", "relative"):
                        raise ValueError("Invalid E-001 camera view")
                    item = {**item, "chapterId": str(data.get("chapterId", ""))[:40]}
                items.append({"id": uuid4().hex, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), **item})
            else:
                raise ValueError("Unknown review action")
            save(path, key, items)
            return self.respond(200, {key: items})
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
            return self.respond(400, {"error": str(error)})


if __name__ == "__main__":
    print("E-001 local review: http://127.0.0.1:8770/visualization/dev/e001-review/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8770), Handler).serve_forever()

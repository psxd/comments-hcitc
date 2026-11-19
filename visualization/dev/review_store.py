"""Shared, local-only review comments and author-defined camera moments."""
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
COMMENTS = ROOT / "review-comments.json"
MOMENTS = ROOT / "camera-key-moments.json"
E001_VIEWS = ROOT / "e001-review" / "saved-camera-views.json"
E001_SPEEDS = ROOT / "e001-review" / "speed-preferences.json"
E005_VIEWS = ROOT / "e005" / "saved-camera-views.json"
E003_VIEWS = ROOT / "e003" / "saved-camera-views.json"
E006_VIEWS = ROOT / "e006" / "saved-camera-views.json"
E008_VIEWS = ROOT / "e008" / "saved-camera-views.json"
E016_VIEWS = ROOT / "e016" / "saved-camera-views.json"
E059_VIEWS = ROOT / "e059" / "saved-camera-views.json"
SURFACES = {"E-001", "E-002", "E-003", "E-005", "E-006", "E-008", "E-016", "E-059", "Library"}


def read(path, key):
    return json.loads(path.read_text(encoding="utf-8")).get(key, []) if path.exists() else []


def write(path, key, items):
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=ROOT, prefix=".review-", delete=False) as output:
        json.dump({"schema": "espl-shared-review-v1", key: items}, output, ensure_ascii=False, indent=2)
        output.write("\n")
        temporary = Path(output.name)
    temporary.replace(path)


def review_comments():
    return read(COMMENTS, "comments")


def camera_moments():
    return read(MOMENTS, "moments")


def e005_views():
    return read(E005_VIEWS, "views")


def change_e005_view(request):
    items = e005_views()
    action = request.get("action")
    if action == "delete":
        items = [item for item in items if item.get("id") != request.get("id")]
    elif action == "add":
        view = request.get("view")
        if not isinstance(view, dict) or view.get("selected") not in ("B", "C") or view.get("referenceSlot") not in ("A", "B", "C"):
            raise ValueError("Invalid E-005 camera configuration")
        if view["referenceSlot"] not in ("A", view["selected"]):
            raise ValueError("Invalid camera origin")
        if not str(view.get("chapterId", "")).startswith("chapter-") or len(str(view["chapterId"])) > 50:
            raise ValueError("Invalid camera chapter")
        datetime.fromisoformat(str(view.get("timeUtc", "")).replace("Z", "+00:00"))
        for key in ("position", "target", "up"):
            coordinates = view.get(key)
            if not isinstance(coordinates, list) or len(coordinates) != 3 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in coordinates):
                raise ValueError("Invalid camera coordinates")
        for key in ("zoom", "fov"):
            if not isinstance(view.get(key), (int, float)) or not math.isfinite(view[key]) or not 0 < view[key] <= 100:
                raise ValueError("Invalid camera optics")
        note = str(view.get("note", "")).strip()
        if len(note) > 4000:
            raise ValueError("Invalid camera note")
        items.append({"id": uuid4().hex, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      **{key: view[key] for key in ("chapterId", "timeUtc", "selected", "referenceSlot", "position", "target", "up", "zoom", "fov")}, "note": note})
    elif action == "annotate":
        note = str(request.get("note", "")).strip()
        if len(note) > 4000 or not any(item.get("id") == request.get("id") for item in items):
            raise ValueError("Invalid camera view note")
        for item in items:
            if item["id"] == request["id"]:
                item["note"] = note
    else:
        raise ValueError("Unknown E-005 camera action")
    write(E005_VIEWS, "views", items)
    return items


def e006_views():
    return read(E006_VIEWS, "views")


def change_e006_view(request):
    items = e006_views()
    action = request.get("action")
    if action == "delete":
        items = [item for item in items if item.get("id") != request.get("id")]
    elif action == "add":
        view = request.get("view")
        if not isinstance(view, dict) or view.get("selected") not in ("B", "C") or view.get("referenceSlot") not in ("A", "B", "C"):
            raise ValueError("Invalid E-006 camera configuration")
        if view["referenceSlot"] not in ("A", view["selected"]):
            raise ValueError("Invalid camera origin")
        if not str(view.get("chapterId", "")).startswith("chapter-") or len(str(view["chapterId"])) > 50:
            raise ValueError("Invalid camera chapter")
        datetime.fromisoformat(str(view.get("timeUtc", "")).replace("Z", "+00:00"))
        for key in ("position", "target", "up"):
            coordinates = view.get(key)
            if not isinstance(coordinates, list) or len(coordinates) != 3 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in coordinates):
                raise ValueError("Invalid camera coordinates")
        for key in ("zoom", "fov"):
            if not isinstance(view.get(key), (int, float)) or not math.isfinite(view[key]) or not 0 < view[key] <= 100:
                raise ValueError("Invalid camera optics")
        note = str(view.get("note", "")).strip()
        if len(note) > 4000:
            raise ValueError("Invalid camera note")
        items.append({"id": uuid4().hex, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      **{key: view[key] for key in ("chapterId", "timeUtc", "selected", "referenceSlot", "position", "target", "up", "zoom", "fov")}, "note": note})
    elif action == "annotate":
        note = str(request.get("note", "")).strip()
        if len(note) > 4000 or not any(item.get("id") == request.get("id") for item in items):
            raise ValueError("Invalid camera view note")
        for item in items:
            if item["id"] == request["id"]:
                item["note"] = note
    else:
        raise ValueError("Unknown E-006 camera action")
    write(E006_VIEWS, "views", items)
    return items


def e003_views():
    return read(E003_VIEWS, "views")


def change_e003_view(request):
    items = e003_views()
    action = request.get("action")
    if action == "delete":
        items = [item for item in items if item.get("id") != request.get("id")]
    elif action == "add":
        view = request.get("view")
        if not isinstance(view, dict) or view.get("selected") not in ("B",) or view.get("referenceSlot") not in ("A", "B"):
            raise ValueError("Invalid E-003 camera configuration")
        if view["referenceSlot"] not in ("A", view["selected"]):
            raise ValueError("Invalid camera origin")
        if not str(view.get("chapterId", "")).startswith("chapter-") or len(str(view["chapterId"])) > 50:
            raise ValueError("Invalid camera chapter")
        datetime.fromisoformat(str(view.get("timeUtc", "")).replace("Z", "+00:00"))
        for key in ("position", "target", "up"):
            coordinates = view.get(key)
            if not isinstance(coordinates, list) or len(coordinates) != 3 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in coordinates):
                raise ValueError("Invalid camera coordinates")
        for key in ("zoom", "fov"):
            if not isinstance(view.get(key), (int, float)) or not math.isfinite(view[key]) or not 0 < view[key] <= 100:
                raise ValueError("Invalid camera optics")
        note = str(view.get("note", "")).strip()
        if len(note) > 4000:
            raise ValueError("Invalid camera note")
        items.append({"id": uuid4().hex, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      **{key: view[key] for key in ("chapterId", "timeUtc", "selected", "referenceSlot", "position", "target", "up", "zoom", "fov")}, "note": note})
    elif action == "annotate":
        note = str(request.get("note", "")).strip()
        if len(note) > 4000 or not any(item.get("id") == request.get("id") for item in items):
            raise ValueError("Invalid camera view note")
        for item in items:
            if item["id"] == request["id"]:
                item["note"] = note
    else:
        raise ValueError("Unknown E-003 camera action")
    write(E003_VIEWS, "views", items)
    return items


def e016_views():
    return read(E016_VIEWS, "views")

def change_e016_view(request):
    return change_two_object_view(request, E016_VIEWS, "E-016")


def e059_views():
    return read(E059_VIEWS, "views")


def change_e059_view(request):
    return change_two_object_view(request, E059_VIEWS, "E-059")

def e008_views():
    return read(E008_VIEWS, "views")


def change_e008_view(request):
    return change_two_object_view(request, E008_VIEWS, "E-008")


def change_two_object_view(request, path, episode_id):
    items = read(path, "views")
    action = request.get("action")
    if action == "delete":
        items = [item for item in items if item.get("id") != request.get("id")]
    elif action == "add":
        view = request.get("view")
        if not isinstance(view, dict) or view.get("selected") not in ("B",) or view.get("referenceSlot") not in ("A", "B"):
            raise ValueError(f"Invalid {episode_id} camera configuration")
        if view["referenceSlot"] not in ("A", view["selected"]):
            raise ValueError("Invalid camera origin")
        if not str(view.get("chapterId", "")).startswith("chapter-") or len(str(view["chapterId"])) > 50:
            raise ValueError("Invalid camera chapter")
        datetime.fromisoformat(str(view.get("timeUtc", "")).replace("Z", "+00:00"))
        for key in ("position", "target", "up"):
            coordinates = view.get(key)
            if not isinstance(coordinates, list) or len(coordinates) != 3 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in coordinates):
                raise ValueError("Invalid camera coordinates")
        for key in ("zoom", "fov"):
            if not isinstance(view.get(key), (int, float)) or not math.isfinite(view[key]) or not 0 < view[key] <= 100:
                raise ValueError("Invalid camera optics")
        note = str(view.get("note", "")).strip()
        if len(note) > 4000:
            raise ValueError("Invalid camera note")
        items.append({"id": uuid4().hex, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      **{key: view[key] for key in ("chapterId", "timeUtc", "selected", "referenceSlot", "position", "target", "up", "zoom", "fov")}, "note": note})
    elif action == "annotate":
        note = str(request.get("note", "")).strip()
        if len(note) > 4000 or not any(item.get("id") == request.get("id") for item in items):
            raise ValueError("Invalid camera view note")
        for item in items:
            if item["id"] == request["id"]:
                item["note"] = note
    else:
        raise ValueError(f"Unknown {episode_id} camera action")
    write(path, "views", items)
    return items


def e001_views():
    return read(E001_VIEWS, "views")


def e001_speeds():
    return read(E001_SPEEDS, "preferences")


def change_e001_view(request):
    items = e001_views()
    action = request.get("action")
    if action == "delete":
        items = [item for item in items if item.get("id") != request.get("id")]
    elif action == "annotate":
        note = str(request.get("note", "")).strip()
        if len(note) > 4000 or not any(item.get("id") == request.get("id") for item in items):
            raise ValueError("Invalid camera view note")
        for item in items:
            if item.get("id") == request["id"]:
                item["note"] = note
    elif action == "add":
        item = request.get("item")
        if not isinstance(item, dict) or item.get("schema") != "espl-proximity-camera-view-v1" or item.get("cameraMode") not in ("earth", "relative"):
            raise ValueError("Invalid E-001 camera view")
        chapter = str(request.get("chapterId", ""))
        if not chapter.startswith("chapter-") or len(chapter) > 40:
            raise ValueError("Invalid camera chapter")
        note = str(item.get("note", "")).strip()
        if len(note) > 4000:
            raise ValueError("Invalid camera view note")
        items.append({"id": uuid4().hex, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      **item, "chapterId": chapter, "note": note})
    else:
        raise ValueError("Unknown E-001 camera action")
    write(E001_VIEWS, "views", items)
    return items


def change_e001_speed(request):
    if request.get("action") != "set" or not isinstance(request.get("item"), dict):
        raise ValueError("Invalid speed preference action")
    item = request["item"]
    chapter, reference, mode, speed = str(item.get("chapterId", "")), item.get("referenceSatellite"), item.get("cameraMode"), item.get("minutesPerSecond")
    if not chapter.startswith("chapter-") or len(chapter) > 40 or reference not in ("A", "B") or mode not in ("relative", "earth"):
        raise ValueError("Invalid speed preference view")
    if not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0 < speed <= 240:
        raise ValueError("Invalid playback speed")
    items = [entry for entry in e001_speeds() if (entry["chapterId"], entry["referenceSatellite"], entry["cameraMode"]) != (chapter, reference, mode)]
    items.append({"chapterId": chapter, "referenceSatellite": reference, "cameraMode": mode, "minutesPerSecond": speed,
                  "savedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    write(E001_SPEEDS, "preferences", items)
    return items


def change_comment(request):
    items = review_comments()
    if request.get("action") == "delete":
        items = [item for item in items if item.get("id") != request.get("id")]
    elif request.get("action") == "add":
        surface = request.get("surface")
        text = str(request.get("text", "")).strip()
        key = str(request.get("key", ""))
        label = str(request.get("label", ""))
        root = str(request.get("root", "panel"))
        x, y = request.get("x"), request.get("y")
        all_episodes = request.get("appliesToAllEpisodes", False)
        if surface not in SURFACES or not text or len(text) > 4000 or not key or len(key) > 160 or len(label) > 160 or len(root) > 30:
            raise ValueError("Invalid review comment")
        if not all(isinstance(v, (int, float)) and math.isfinite(v) and 0 <= v <= 1 for v in (x, y)):
            raise ValueError("Invalid comment position")
        if not isinstance(all_episodes, bool):
            raise ValueError("Invalid comment scope")
        items.append({"id": uuid4().hex, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      "surface": surface, "root": root, "key": key, "label": label, "x": x, "y": y,
                      "text": text, "appliesToAllEpisodes": all_episodes})
    else:
        raise ValueError("Unknown review-comment action")
    write(COMMENTS, "comments", items)
    return items


def change_moment(request):
    items = camera_moments()
    if request.get("action") == "delete":
        items = [item for item in items if item.get("id") != request.get("id")]
    elif request.get("action") == "add":
        item = request.get("moment")
        if not isinstance(item, dict) or item.get("surface") not in ("E-001", "E-002", "E-003", "E-005"):
            raise ValueError("Invalid camera moment")
        for key in ("windowId", "selected", "referenceMode", "mode", "timeUtc"):
            if not isinstance(item.get(key), str) or not item[key] or len(item[key]) > 100:
                raise ValueError(f"Invalid camera moment {key}")
        datetime.fromisoformat(item["timeUtc"].replace("Z", "+00:00"))
        label = str(item.get("label", "")).strip()
        note = str(item.get("note", "")).strip()
        span = item.get("spanMinutes", 60)
        if len(label) > 120 or len(note) > 4000 or not isinstance(span, (int, float)) or not math.isfinite(span) or not 1 <= span <= 1440:
            raise ValueError("Invalid camera moment label or span")
        items.append({"id": uuid4().hex, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      **{key: item[key] for key in ("surface", "windowId", "selected", "referenceMode", "mode", "timeUtc")},
                      "label": label or "Key moment", "note": note, "spanMinutes": int(span)})
    else:
        raise ValueError("Unknown camera-moment action")
    write(MOMENTS, "moments", items)
    return items

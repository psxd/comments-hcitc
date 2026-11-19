"""Fetch E-003 Space-Track GP history for the sheet's first chapter.

Reads SPACETRACK_USERNAME and SPACETRACK_PASSWORD from the environment.
Credentials are never written to the project.
"""

from datetime import date, datetime, timezone
import hashlib
import json
import os
from pathlib import Path

import spacetrack.operators as op
from spacetrack import SpaceTrackClient


HERE = Path(__file__).resolve().parent
IDS = (41745, 44910)
FIRST, LAST = date(2020, 4, 1), date(2020, 11, 20)


def main():
    identity = os.environ.get("SPACETRACK_USERNAME")
    password = os.environ.get("SPACETRACK_PASSWORD")
    if not identity or not password:
        raise SystemExit("Space-Track environment credentials are required")
    output = HERE / "data"
    output.mkdir(exist_ok=True)
    if any((output / f"{number}.json").exists() for number in IDS):
        raise SystemExit("Existing E-003 history is preserved; remove it explicitly before refetching")
    with SpaceTrackClient(identity=identity, password=password) as client:
        result = client.gp_history(
            norad_cat_id=list(IDS),
            epoch=op.inclusive_range(FIRST, LAST),
            orderby="NORAD_CAT_ID,EPOCH",
            format="json",
        )
    rows = json.loads(result) if isinstance(result, str) else result
    if not isinstance(rows, list):
        raise SystemExit("Space-Track returned no GP_HISTORY record list")
    records = {str(number): [] for number in IDS}
    for row in rows:
        number = str(row.get("NORAD_CAT_ID", ""))
        if number not in records:
            continue
        epoch = str(row.get("EPOCH", "")).replace(" ", "T")
        if epoch and not epoch.endswith("Z") and "+" not in epoch:
            epoch += "Z"
        datetime.fromisoformat(epoch.replace("Z", "+00:00"))
        line1, line2 = row.get("TLE_LINE1"), row.get("TLE_LINE2")
        if not line1 or not line2 or not line1.startswith("1 ") or not line2.startswith("2 "):
            raise SystemExit(f"Invalid TLE for {number} at {epoch}")
        records[number].append({"epoch": epoch, "line1": line1, "line2": line2, "source": "space-track"})
    datasets = []
    for number in IDS:
        key = str(number)
        records[key].sort(key=lambda item: item["epoch"])
        if not records[key]:
            raise SystemExit(f"No historical elements returned for {key}")
        payload = {"norad": key, "tles": records[key]}
        encoded = (json.dumps(payload, separators=(",", ":")) + "\n").encode()
        target = output / f"{key}.json"
        target.write_bytes(encoded)
        datasets.append({"object": {"norad": key}, "url": f"data/{key}.json", "sha256": hashlib.sha256(encoded).hexdigest(),
                         "count": len(records[key]), "firstEpoch": records[key][0]["epoch"], "lastEpoch": records[key][-1]["epoch"]})
    manifest = {"schema": "espl-e003-dated-elements-v1", "source": "Space-Track GP_HISTORY",
                "retrievedUtc": datetime.now(timezone.utc).isoformat(), "queryEpochRange": [str(FIRST), str(LAST)], "datasets": datasets}
    (output / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(", ".join(f"{item['object']['norad']}: {item['count']} elements" for item in datasets))


if __name__ == "__main__":
    main()

"""Fetch E-002 Cosmos GP history once, using the installed spacetrack client.

Run with SPACETRACK_USERNAME and SPACETRACK_PASSWORD in the environment, or
enter them at the local prompts. Credentials are never saved by this script.
"""

from datetime import date, datetime, timezone
from getpass import getpass
import hashlib
import json
import os
from pathlib import Path

import spacetrack.operators as op
from spacetrack import SpaceTrackClient


HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "space-track-e002-history.json"
IDS = (44797, 44835)


def main():
    if OUTPUT.exists():
        raise SystemExit(f"Existing download preserved: {OUTPUT}")
    username = os.environ.get("SPACETRACK_USERNAME") or input("Space-Track email: ").strip()
    password = os.environ.get("SPACETRACK_PASSWORD") or getpass("Space-Track password: ")
    if not username or not password:
        raise SystemExit("Space-Track credentials are required")

    with SpaceTrackClient(identity=username, password=password) as client:
        result = client.gp_history(
            norad_cat_id=list(IDS),
            epoch=op.inclusive_range(date(2019, 12, 5), date(2019, 12, 13)),
            orderby="NORAD_CAT_ID,EPOCH",
            format="json",
        )
    rows = json.loads(result) if isinstance(result, str) else result
    if not isinstance(rows, list):
        raise SystemExit("Space-Track did not return a GP_HISTORY record list")

    records = {str(number): [] for number in IDS}
    for row in rows:
        number = int(row.get("NORAD_CAT_ID", -1))
        if number not in IDS:
            raise SystemExit(f"Unexpected NORAD ID in response: {number}")
        epoch = str(row.get("EPOCH", "")).replace(" ", "T")
        if epoch and not epoch.endswith("Z") and "+" not in epoch:
            epoch += "Z"
        datetime.fromisoformat(epoch.replace("Z", "+00:00"))
        line1, line2 = row.get("TLE_LINE1"), row.get("TLE_LINE2")
        if not line1 or not line2 or not line1.startswith("1 ") or not line2.startswith("2 "):
            raise SystemExit(f"Missing TLE lines for {number} at {epoch}")
        records[str(number)].append({"epoch": epoch, "line1": line1, "line2": line2, "source": "spacetrack"})
    for number in IDS:
        records[str(number)].sort(key=lambda item: item["epoch"])
        if not records[str(number)]:
            raise SystemExit(f"No historical elements returned for {number}")

    payload = {
        "schema": "espl-e002-spacetrack-gp-history-v1",
        "source": "Space-Track GP_HISTORY",
        "retrievedUtc": datetime.now(timezone.utc).isoformat(),
        "queryEpochRange": ["2019-12-05", "2019-12-13"],
        "records": records,
    }
    encoded = (json.dumps(payload, indent=2) + "\n").encode()
    OUTPUT.write_bytes(encoded)
    print(f"Saved {OUTPUT.name}: " + ", ".join(f"{number}={len(records[str(number)])}" for number in IDS))
    print("SHA-256:", hashlib.sha256(encoded).hexdigest())


if __name__ == "__main__":
    main()

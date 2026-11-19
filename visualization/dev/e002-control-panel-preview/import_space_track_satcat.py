"""Extract reviewed E-002 SATCAT rows from a user-provided Space-Track CSV export."""

import csv
from hashlib import sha256
import json
from pathlib import Path
import sys


EXPECTED = {
    "39232": "2013-043A",
    "44797": "2019-079A",
    "44835": "2019-079D",
}
FIELDS = ("NORAD_CAT_ID", "OBJECT_ID", "SATNAME", "OBJECT_TYPE", "COUNTRY", "LAUNCH", "SITE", "DECAY")


def main(path: Path):
    rows = {}
    with path.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            number = row.get("NORAD_CAT_ID", "")
            if number not in EXPECTED:
                continue
            if number in rows:
                raise ValueError(f"Duplicate SATCAT row for {number}")
            if row.get("OBJECT_ID") != EXPECTED[number]:
                raise ValueError(f"COSPAR mismatch for {number}: {row.get('OBJECT_ID')}")
            rows[number] = {key: row.get(key, "") for key in FIELDS}
    if set(rows) != set(EXPECTED):
        raise ValueError(f"Missing SATCAT rows: {sorted(set(EXPECTED) - set(rows))}")
    result = {
        "schema": "espl-e002-space-track-satcat-extract-v1",
        "source": "User-provided Space-Track SATCAT CSV export",
        "sourceSha256": sha256(path.read_bytes()).hexdigest(),
        "records": {EXPECTED[number]: rows[number] for number in sorted(rows)},
        "launchSiteNames": {"PKMTR": "Plesetsk Cosmodrome", "AFWTR": "Vandenberg Air Force Base"},
    }
    output = Path(__file__).with_name("space-track-e002.json")
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {output.name}: {len(rows)} exact records; source SHA-256 {result['sourceSha256']}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python import_space_track_satcat.py /path/to/export.csv")
    main(Path(sys.argv[1]))

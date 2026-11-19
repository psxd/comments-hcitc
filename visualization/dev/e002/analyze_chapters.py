"""Reproduce E-002 A/B chapter comparisons from checksum-pinned public TLEs.

Run with: python -m pip install sgp4 && python analyze_chapters.py
Use --data-dir /path/to/verified/jsons to run without network access.
The script does not add orbital elements to this repo.
"""

from argparse import ArgumentParser
from datetime import datetime, timedelta
from hashlib import sha256
from itertools import product
from json import load, loads
from math import dist
from pathlib import Path
from urllib.request import urlopen

from sgp4.api import Satrec, jday


ROOT = Path(__file__).resolve().parent
MANIFEST = load((ROOT / "data" / "provenance.json").open())
CASES = [
    ("Dec 7 current", "2019-12-07T10:30:00Z", None),
    ("Dec 8 current", "2019-12-08T10:50:00Z", None),
    ("Dec 31 current", "2019-12-31T18:45:00Z", None),
    ("Dec 9 Willa", "2019-12-09T11:40:00Z", "2019-12-08"),
    ("Dec 16 Willa", "2019-12-16T17:02:45.948192Z", "2019-12-31"),
    ("Jan 2 Willa", "2020-01-02T10:16:00Z", "2019-12-31"),
    ("Jan 25 Willa", "2020-01-25T18:35:00Z", "2019-12-31"),
]


def utc(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def fetch(norad, data_dir=None):
    record = next(item for item in MANIFEST["datasets"] if item["object"]["norad"] == norad)
    if data_dir:
        data = (data_dir / f"{norad}.json").read_bytes()
    else:
        with urlopen(record["url"], timeout=20) as response:
            data = response.read()
    if sha256(data).hexdigest() != record["sha256"]:
        raise RuntimeError(f"Checksum mismatch for {norad}")
    elements = loads(data)["tles"]
    return [{**item, "time": utc(item["epoch"]), "sat": Satrec.twoline2rv(item["line1"], item["line2"])} for item in elements]


def state(element, when):
    second = when.second + when.microsecond / 1_000_000
    jd, fraction = jday(when.year, when.month, when.day, when.hour, when.minute, second)
    error, position, velocity = element["sat"].sgp4(jd, fraction)
    return None if error else (position, velocity)


def pair(a, b, when):
    first, second = state(a, when), state(b, when)
    if not first or not second:
        return None
    return dist(first[0], second[0]), dist(first[1], second[1]) * 1000


def minimum(a, b, center):
    samples = []
    for minutes in range(-180, 181):
        when = center + timedelta(minutes=minutes)
        value = pair(a, b, when)
        if value:
            samples.append((value[0], value[1], when))
    return min(samples) if samples else None


def nearest(elements, when, count=2):
    return sorted(elements, key=lambda item: abs((when - item["time"]).total_seconds()))[:count]


def compact(when):
    return when.strftime("%Y-%m-%d %H:%M")


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, help="Directory containing checksum-matched 44797.json and 39232.json")
    data_dir = parser.parse_args().data_dir
    a_library, b_library = fetch("44797", data_dir), fetch("39232", data_dir)
    print("case | A epoch UTC | B epoch UTC | A age h | B age h | center km | center m/s | ±3h min km @ UTC | speed at min m/s | alternate minima km | A/B switch km")
    for name, stamp, b_date in CASES:
        center = utc(stamp)
        a_choice = nearest(a_library, center)
        b_choice = nearest(b_library, center)
        a = a_choice[0]
        b = next((item for item in b_library if item["epoch"].startswith(b_date)), b_choice[0]) if b_date else b_choice[0]
        alternative_b = next((item for item in b_choice if item is not b), None)
        if alternative_b is None:
            alternative_b = next(item for item in nearest(b_library, center, 3) if item is not b)
        center_value = pair(a, b, center)
        best = minimum(a, b, center)
        alternatives = [minimum(x, y, center) for x, y in product(a_choice, [b, alternative_b])]
        minima = [item[0] for item in alternatives if item]
        a_switch = state(a_choice[0], center), state(a_choice[1], center)
        b_switch = state(b, center), state(alternative_b, center)
        switch = lambda states: dist(states[0][0], states[1][0]) if all(states) else float("nan")
        print(" | ".join([
            name, compact(a["time"]), compact(b["time"]),
            f"{(center-a['time']).total_seconds()/3600:+.1f}", f"{(center-b['time']).total_seconds()/3600:+.1f}",
            f"{center_value[0]:.1f}" if center_value else "—", f"{center_value[1]:.1f}" if center_value else "—",
            f"{best[0]:.1f} @ {compact(best[2])}" if best else "—",
            f"{best[1]:.1f}" if best else "—",
            f"{min(minima):.1f}–{max(minima):.1f}" if minima else "—",
            f"{switch(a_switch):.1f}/{switch(b_switch):.1f}",
        ]))


if __name__ == "__main__":
    main()

"""Scan E-002's three-object geometry with nearest TLEs at every UTC minute.

Run with: PYTHONPATH=/path/to/sgp4 python analyze_continuous.py --data-dir /path/to/verified/jsons
Without --data-dir, fetches the three checksum-pinned URLs in data/provenance.json.
No TLE-age gate is applied; each result reports signed element ages.
"""

from argparse import ArgumentParser
from bisect import bisect_left
from csv import writer
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from json import dump, load, loads
from math import dist
from pathlib import Path
from urllib.request import urlopen

from sgp4.api import Satrec, jday


HERE = Path(__file__).resolve().parent
MANIFEST = load((HERE / "data" / "provenance.json").open())
OBJECTS = {"A": "44797", "B": "39232", "C": "44835"}
PAIRS = (("A", "B"), ("C", "B"), ("A", "C"))
START = datetime(2019, 12, 6, 18, tzinfo=timezone.utc)
END = datetime(2020, 1, 30, 23, 59, tzinfo=timezone.utc)


def read_library(number, data_dir):
    record = next(row for row in MANIFEST["datasets"] if row["object"]["norad"] == number)
    if data_dir:
        data = (data_dir / f"{number}.json").read_bytes()
    else:
        with urlopen(record["url"], timeout=30) as response:
            data = response.read()
    digest = sha256(data).hexdigest()
    if digest != record["sha256"]:
        raise RuntimeError(f"Checksum mismatch for {number}: {digest}")
    elements = []
    for row in loads(data)["tles"]:
        elements.append({
            "epoch": datetime.fromisoformat(row["epoch"].replace("Z", "+00:00")),
            "sat": Satrec.twoline2rv(row["line1"], row["line2"]),
        })
    elements.sort(key=lambda row: row["epoch"])
    return elements, [row["epoch"] for row in elements], digest


def nearest(library, epochs, when):
    index = bisect_left(epochs, when)
    if index == len(epochs):
        index -= 1
    elif index and (when - epochs[index - 1]) < (epochs[index] - when):
        index -= 1
    return library[index], index


def propagate(element, jd, fraction):
    error, position, velocity = element["sat"].sgp4(jd, fraction)
    return None if error else (position, velocity)


def sample(when, libraries):
    jd, fraction = jday(when.year, when.month, when.day, when.hour, when.minute, when.second)
    states, epochs, indices = {}, {}, {}
    for slot, (library, dates, _) in libraries.items():
        element, index = nearest(library, dates, when)
        states[slot] = propagate(element, jd, fraction)
        epochs[slot] = element["epoch"]
        indices[slot] = index
    distances, speeds = {}, {}
    for first, second in PAIRS:
        key = first + second
        if states[first] and states[second]:
            distances[key] = dist(states[first][0], states[second][0])
            speeds[key] = dist(states[first][1], states[second][1]) * 1000
        else:
            distances[key] = speeds[key] = None
    return {"time": when, "distance": distances, "speed": speeds, "epochs": epochs, "indices": indices}


def compact(row):
    when = row["time"]
    return {
        "utc": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "distanceKm": row["distance"],
        "speedMs": row["speed"],
        "epochUtc": {slot: value.strftime("%Y-%m-%dT%H:%M:%SZ") for slot, value in row["epochs"].items()},
        "ageHours": {slot: (when - value).total_seconds() / 3600 for slot, value in row["epochs"].items()},
        "elementIndex": row["indices"],
    }


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--output", type=Path, help="Write compact scan summary as JSON")
    parser.add_argument("--daily-csv", type=Path, help="Write independently timed daily minima for the three pairs")
    parser.add_argument("--epoch-csv", type=Path, help="Write every verified TLE epoch for the three objects")
    parser.add_argument("--threshold-km", type=float, default=500)
    args = parser.parse_args()
    libraries = {slot: read_library(number, args.data_dir) for slot, number in OBJECTS.items()}
    daily = {}
    events = {"AB": [], "CB": [], "AC": []}
    active = {key: None for key in events}
    global_minima = {key: None for key in events}
    invalid = 0
    when = START
    while when <= END:
        row = sample(when, libraries)
        day = when.strftime("%Y-%m-%d")
        if day not in daily:
            daily[day] = {key: None for key in events}
        for key in events:
            value = row["distance"][key]
            if value is None:
                invalid += 1
                continue
            if daily[day][key] is None or value < daily[day][key]["distance"][key]:
                daily[day][key] = row
            if global_minima[key] is None or value < global_minima[key]["distance"][key]:
                global_minima[key] = row
            if value < args.threshold_km:
                if active[key] is None or value < active[key]["distance"][key]:
                    active[key] = row
            elif active[key] is not None:
                events[key].append(active[key])
                active[key] = None
        when += timedelta(minutes=1)
    for key in events:
        if active[key] is not None:
            events[key].append(active[key])
    result = {
        "method": "One-minute SGP4, nearest independently selected TLE for A/B/C at each minute; no age gate",
        "intervalUtc": [START.isoformat(), END.isoformat()],
        "sourceSha256": {slot: library[2] for slot, library in libraries.items()},
        "elements": {slot: len(library[0]) for slot, library in libraries.items()},
        "invalidPairSamples": invalid,
        "globalMinima": {key: compact(row) if row else None for key, row in global_minima.items()},
        "dailyMinima": {day: {key: compact(row) if row else None for key, row in pairs.items()} for day, pairs in daily.items()},
        "eventsBelowKm": args.threshold_km,
        "events": {key: [compact(row) for row in values] for key, values in events.items()},
    }
    if args.output:
        with args.output.open("w") as file:
            dump(result, file, indent=2)
            file.write("\n")
        print(f"Wrote {args.output}")
    if args.daily_csv:
        with args.daily_csv.open("w", newline="") as file:
            csv = writer(file)
            csv.writerow(["date_utc", "ab_min_km", "ab_utc", "ab_speed_at_min_ms", "ab_b_age_h", "cb_min_km", "cb_utc", "cb_speed_at_min_ms", "cb_b_age_h", "ac_min_km", "ac_utc", "ac_speed_at_min_ms"])
            for day, pairs in result["dailyMinima"].items():
                ab, cb, ac = (pairs[key] for key in ("AB", "CB", "AC"))
                csv.writerow([day,
                              round(ab["distanceKm"]["AB"], 3), ab["utc"], round(ab["speedMs"]["AB"], 3), round(ab["ageHours"]["B"], 3),
                              round(cb["distanceKm"]["CB"], 3), cb["utc"], round(cb["speedMs"]["CB"], 3), round(cb["ageHours"]["B"], 3),
                              round(ac["distanceKm"]["AC"], 3), ac["utc"], round(ac["speedMs"]["AC"], 3)])
        print(f"Wrote {args.daily_csv}")
    if args.epoch_csv:
        with args.epoch_csv.open("w", newline="") as file:
            csv = writer(file)
            csv.writerow(["slot", "object", "norad", "tle_index", "epoch_utc", "within_scan"])
            for slot, (library, _, _) in libraries.items():
                for index, element in enumerate(library):
                    epoch = element["epoch"]
                    csv.writerow([slot, {"A": "Cosmos 2542", "B": "USA 245", "C": "Cosmos 2543"}[slot],
                                  OBJECTS[slot], index, epoch.isoformat().replace("+00:00", "Z"), START <= epoch <= END])
        print(f"Wrote {args.epoch_csv}")
    print(f"Scanned {START} to {END}, 1 minute, invalid pair samples: {invalid}")
    for key, values in events.items():
        print(f"\n{key}: {len(values)} approaches below {args.threshold_km:g} km")
        for row in values:
            item = compact(row)
            print(f"{item['utc']}  {item['distanceKm'][key]:8.1f} km; "
                  f"A/B/C ages {item['ageHours']['A']:+.1f}/{item['ageHours']['B']:+.1f}/{item['ageHours']['C']:+.1f} h; "
                  f"A/B/C distances {item['distanceKm']['AB']:.1f}/{item['distanceKm']['CB']:.1f}/{item['distanceKm']['AC']:.1f} km")


if __name__ == "__main__":
    main()

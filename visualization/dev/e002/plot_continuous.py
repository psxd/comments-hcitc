"""Plot daily closest approach, its relative speed, and dated TLE coverage.

Run with: python plot_continuous.py
Requires matplotlib; regenerate the CSV inputs with analyze_continuous.py.
"""

from csv import DictReader
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt


HERE = Path(__file__).resolve().parent
with (HERE / "continuous-proximity-daily.csv").open(newline="") as file:
    rows = list(DictReader(file))
with (HERE / "continuous-tle-epochs.csv").open(newline="") as file:
    epochs = list(DictReader(file))

dates = [datetime.fromisoformat(row["date_utc"]) for row in rows]
ab = [float(row["ab_min_km"]) for row in rows]
cb = [float(row["cb_min_km"]) for row in rows]
ab_speed = [float(row["ab_speed_at_min_ms"]) for row in rows]
cb_speed = [float(row["cb_speed_at_min_ms"]) for row in rows]
ages = [abs(float(row["cb_b_age_h"])) for row in rows]
palette = {"A": "#b48310", "B": "#6a6a6a", "C": "#5c7183"}

fig, (distance_ax, speed_ax, age_ax, epoch_ax) = plt.subplots(
    4, 1, figsize=(11.5, 9.5), sharex=True,
    gridspec_kw={"height_ratios": [3, 1.65, 1.05, .8]}, layout="constrained")
fig.suptitle("E-002 · Continuous nearest-TLE analysis", x=.08, ha="left", fontsize=15, fontweight="bold")

distance_ax.plot(dates, ab, color=palette["A"], linewidth=1.8, marker="o", markersize=3,
                 label="Cosmos 2542–USA 245")
distance_ax.plot(dates, cb, color=palette["C"], linewidth=1.8, marker="o", markersize=3,
                 label="Cosmos 2543–USA 245")
distance_ax.axhline(200, color="#555", linestyle="--", linewidth=.9, label="200 km review threshold")
distance_ax.set_yscale("log")
distance_ax.set_ylim(2, 25000)
distance_ax.set_ylabel("Daily minimum separation\n(km; log scale)")
distance_ax.grid(axis="y", color="#e6e6e6", linewidth=.7)
distance_ax.legend(loc="upper left", ncol=3, fontsize=8.5, frameon=False)
for day, label, y, offset in [
    ("2019-12-09", "Dec 9 · both", 54.5, (8, 20)),
    ("2019-12-30", "Dec 30 · 2542", 78.6, (-65, 15)),
    ("2020-01-02", "Jan 2 · 2543", 21.4, (8, -28)),
    ("2020-01-25", "Jan 25 · old USA 245 TLE", 11.6, (-135, 17)),
]:
    distance_ax.annotate(label, (datetime.fromisoformat(day), y), xytext=offset,
                         textcoords="offset points", fontsize=8,
                         arrowprops={"arrowstyle": "-", "color": "#777", "lw": .7})

# These velocities are evaluated at each pair's daily distance minimum,
# rather than independently searching for a slower time on that date.
speed_ax.plot(dates, ab_speed, color=palette["A"], linewidth=1.7, marker="o", markersize=2.5)
speed_ax.plot(dates, cb_speed, color=palette["C"], linewidth=1.7, marker="o", markersize=2.5)
speed_ax.axhline(15, color="#666", linestyle="--", linewidth=.8)
speed_ax.text(dates[1], 17, "15 m/s review threshold", color="#666", fontsize=8)
speed_ax.set_yscale("log")
speed_ax.set_ylim(5, 30000)
speed_ax.set_ylabel("Relative velocity at\nseparation minimum\n(m/s; log scale)")
speed_ax.grid(axis="y", color="#e6e6e6", linewidth=.7)

age_ax.plot(dates, ages, color=palette["B"], linewidth=1.4, marker=".", markersize=3)
age_ax.axhline(72, color="#777", linestyle="--", linewidth=.8)
age_ax.text(dates[1], 80, "72 h reference", fontsize=8, color="#666")
age_ax.set_ylabel("USA 245 TLE age\n(hours, absolute)")
age_ax.set_ylim(0, max(ages) * 1.08)
age_ax.grid(axis="y", color="#e6e6e6", linewidth=.7)

labels = {"A": "Cosmos 2542", "B": "USA 245", "C": "Cosmos 2543"}
for y, slot in enumerate(("C", "B", "A")):
    in_scan = [datetime.fromisoformat(row["epoch_utc"].replace("Z", "+00:00")).replace(tzinfo=None)
               for row in epochs if row["slot"] == slot and row["within_scan"] == "True"]
    epoch_ax.scatter(in_scan, [y] * len(in_scan), marker="|", s=150, linewidths=1.4,
                     color=palette[slot], label=f"{labels[slot]} ({len(in_scan)} epochs in scan)")
epoch_ax.set_yticks([0, 1, 2], ["Cosmos 2543", "USA 245", "Cosmos 2542"])
epoch_ax.set_ylim(-.5, 2.5)
epoch_ax.set_ylabel("TLE epochs")
epoch_ax.grid(axis="x", color="#eeeeee", linewidth=.7)
epoch_ax.tick_params(axis="y", length=0, labelsize=8)
epoch_ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=1))
epoch_ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
epoch_ax.set_xlim(dates[0], dates[-1])
epoch_ax.set_xlabel("UTC date · each pair's daily minimum can occur at a different minute")

fig.savefig(HERE / "continuous-proximity.png", dpi=180, facecolor="white")
plt.close(fig)

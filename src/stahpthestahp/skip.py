"""Partial skipping: close by direction and hour band, or skip alternate trains.

Per station cell (direction, hour), close nets saved_h - walk weight x walk_h,
the same as `rank` before summing. Alternate-train skipping saves half of
saved_h, and every displaced rider either waits half a headway more for a
stopping train or walks, whichever costs less.
"""

import logging
from pathlib import Path

import polars as pl

from stahpthestahp.stopcost import BANDS, TIMEZONE

log = logging.getLogger(__name__)

# Waiting time counts this many times in-vehicle time
WAIT_WEIGHT = 2.0
# A partial policy must beat keep/close by this many weekday hours...
MIN_GAIN_H = 1.0
# ...and by this share of the best of keep/close
MIN_GAIN_FRAC = 0.1
# Stop cost multipliers for the verdict grid; the measured cost looks inflated
COST_SCALES = (0.5, 1.0)
# Partial policies, simplest first
POLICIES = ("by_direction", "by_band", "by_dir_band", "alternate", "mixed")
FLAGS = ("accessible",)


def headways(lamp_dir: Path, route_ids: tuple[str, ...]) -> pl.DataFrame:
    """Mean weekday trains per hour and headway per route, direction, station, hour."""
    files = sorted(lamp_dir.glob("*.parquet"))
    if not files:
        raise FileNotFoundError(f"no LAMP parquet in {lamp_dir}, run `stahp fetch`")
    trains = (
        pl.scan_parquet(files)
        .filter(pl.col("route_id").is_in(route_ids))
        .with_columns(
            pl.from_epoch(pl.coalesce("stop_timestamp", "move_timestamp"), "s")
            .dt.replace_time_zone("UTC")
            .dt.convert_time_zone(TIMEZONE)
            .dt.hour()
            .cast(pl.Int8)
            .alias("hour"),
            pl.col("direction_id").cast(pl.Int8).cast(pl.String),
        )
        .filter(pl.col("hour").is_not_null())
        .group_by("route_id", "direction_id", "parent_station", "hour")
        .agg(pl.col("trip_id").n_unique().alias("trains"))
        .collect()
    )
    log.info("headways: %d station-hours from %d days", trains.height, len(files))
    return trains.with_columns(pl.col("trains") / len(files)).with_columns(
        (3600 / pl.col("trains")).alias("headway_s")
    )


def direction_labels(stops: pl.DataFrame) -> pl.DataFrame:
    """Short direction label per station and direction_id: "West" -> "WB"."""
    return stops.group_by("parent_station", "direction_id").agg(
        (pl.col("direction_name").first().str.slice(0, 1) + "B").alias("dir")
    )


def cells(
    hours: pl.DataFrame,
    headway: pl.DataFrame,
    stops: pl.DataFrame,
    walk_weight: float,
    wait_weight: float,
    cost_scale: float = 1.0,
) -> pl.DataFrame:
    """Net hours of closing and of skipping alternate trains per station cell.

    hours is `score.platform_hours` output (walk_h unweighted). Routes are
    summed per station, direction and hour; each route uses its own headway.
    A route-hour without trains in LAMP has no wait option, so its displaced
    riders walk.
    """
    keys = ["route_id", "direction_id", "parent_station", "hour"]
    saved = pl.col("saved_h") * cost_scale
    walk_s = pl.col("extra_walk_s") * walk_weight
    alt_s = pl.min_horizontal(walk_s, pl.col("headway_s") / 2 * wait_weight)
    per_route = hours.join(headway.select(*keys, "headway_s"), on=keys, how="left")
    return (
        per_route.with_columns(
            saved.alias("saved_h"),
            (pl.col("walk_h") * walk_weight).alias("walk_h"),
            (saved - pl.col("walk_h") * walk_weight).alias("net_h"),
            (saved / 2 - pl.col("displaced") * alt_s / 3600).alias("alt_net_h"),
        )
        .group_by("parent_station", "direction_id", "hour", "band")
        .agg(
            pl.col("route_id").unique().sort().str.join(",").alias("routes"),
            pl.col(
                "through", "displaced", "saved_h", "walk_h", "net_h", "alt_net_h"
            ).sum(),
            pl.col("headway_s").min(),
        )
        .join(direction_labels(stops), on=["parent_station", "direction_id"])
        .sort("parent_station", "direction_id", "hour")
    )


def _describe(chosen: list[tuple[str, str, str]]) -> str:
    """ "close WB am_peak,midday; alt EB all day" from (action, dir, band) triples."""
    order = [name for name, _ in BANDS]
    parts = []
    for action in ("close", "alt"):
        for d in sorted({d for a, d, _ in chosen if a == action}):
            bands = sorted(
                {b for a, dd, b in chosen if a == action and dd == d}, key=order.index
            )
            when = "all day" if len(bands) == len(order) else ",".join(bands)
            parts.append(f"{action} {d} {when}")
    return "; ".join(parts) or "none"


def _station(rows: list[dict], cells_: list[dict]) -> dict[str, object]:
    """Every policy's net and skipped cells for one station's (dir, band) rows."""
    net: dict[str, float] = {}
    chosen: dict[str, list[tuple[str, str, str]]] = {}
    every = [("close", r["dir"], r["band"]) for r in rows]
    net["close"] = sum(r["net_h"] for r in rows)
    chosen["close"] = every

    dirs = sorted({r["dir"] for r in rows})
    by_dir = {d: sum(r["net_h"] for r in rows if r["dir"] == d) for d in dirs}
    best_dir = max(dirs, key=by_dir.__getitem__)
    net["by_direction"] = max(by_dir[best_dir], 0.0)
    chosen["by_direction"] = [c for c in every if c[1] == best_dir and by_dir[c[1]] > 0]

    bands = {r["band"] for r in rows}
    by_band = {b: sum(r["net_h"] for r in rows if r["band"] == b) for b in bands}
    net["by_band"] = sum(max(v, 0.0) for v in by_band.values())
    chosen["by_band"] = [c for c in every if by_band[c[2]] > 0]

    net["by_dir_band"] = sum(max(r["net_h"], 0.0) for r in rows)
    chosen["by_dir_band"] = [
        c for c, r in zip(every, rows, strict=True) if r["net_h"] > 0
    ]

    net["alternate"] = sum(max(r["alt_net_h"], 0.0) for r in rows)
    chosen["alternate"] = [
        ("alt", r["dir"], r["band"]) for r in rows if r["alt_net_h"] > 0
    ]

    net["mixed"] = sum(max(r["net_h"], r["alt_net_h"], 0.0) for r in rows)
    chosen["mixed"] = [
        ("close" if r["net_h"] >= r["alt_net_h"] else "alt", r["dir"], r["band"])
        for r in rows
        if max(r["net_h"], r["alt_net_h"]) > 0
    ]
    net["oracle"] = sum(max(c["net_h"], c["alt_net_h"], 0.0) for c in cells_)
    return {"net": net, "chosen": chosen}


def policies(
    cells_: pl.DataFrame,
    stops: pl.DataFrame,
    min_gain_h: float = MIN_GAIN_H,
    min_gain_frac: float = MIN_GAIN_FRAC,
) -> pl.DataFrame:
    """One row per station: each policy's net hours, the pick and a verdict.

    The pick is the simplest partial policy within min_gain_h of mixed, the
    best (direction, band) policy. The verdict is partial when the pick beats
    the better of keep (0) and close by min_gain_h and min_gain_frac of it,
    else binary_close or binary_keep. oracle picks close, alternate or keep
    per (direction, hour), an upper bound on any schedule.
    """
    bands = cells_.group_by("parent_station", "dir", "band").agg(
        pl.col("net_h", "alt_net_h").sum()
    )
    by_station = bands.sort("parent_station", "dir", "band").partition_by(
        "parent_station", as_dict=True
    )
    hourly = cells_.partition_by("parent_station", as_dict=True)
    out = []
    for (station,), frame in by_station.items():
        s = _station(frame.to_dicts(), hourly[(station,)].to_dicts())
        net, chosen = s["net"], s["chosen"]
        binary = max(net["close"], 0.0)
        pick = next(p for p in POLICIES if net[p] >= net["mixed"] - min_gain_h)
        gain = net[pick] - binary
        if gain >= min_gain_h and gain >= min_gain_frac * abs(binary):
            verdict, skipped = "partial", _describe(chosen[pick])
        elif net["close"] > 0:
            verdict, skipped, pick = "binary_close", "close all", "close"
        else:
            verdict, skipped, pick = "binary_keep", "none", "keep"
        out.append(
            {
                "parent_station": station,
                "verdict": verdict,
                "policy": pick,
                "skipped": skipped,
                "gain_h": max(gain, 0.0) if verdict == "partial" else 0.0,
                "oracle_gain_h": net["oracle"] - binary,
                **{f"{p}_h": net[p] for p in ("close", *POLICIES, "oracle")},
            }
        )
    flags = stops.group_by("parent_station").agg(
        pl.col("stop_name").first(), pl.col(*FLAGS).any()
    )
    routes = (
        cells_.select("parent_station", pl.col("routes").str.split(","))
        .explode("routes", empty_as_null=False)
        .group_by("parent_station")
        .agg(pl.col("routes").unique().sort().str.join(","))
    )
    return (
        pl.DataFrame(out)
        .join(flags, on="parent_station", how="left")
        .join(routes, on="parent_station", how="left")
        .sort("gain_h", "close_h", descending=True)
        .select(
            "parent_station",
            "stop_name",
            "routes",
            "verdict",
            "policy",
            "skipped",
            "gain_h",
            "oracle_gain_h",
            pl.selectors.ends_with("_h")
            - pl.selectors.by_name("gain_h", "oracle_gain_h"),
            *FLAGS,
        )
    )


def verdict_grid(
    hours: pl.DataFrame,
    headway: pl.DataFrame,
    stops: pl.DataFrame,
    walk_weights: tuple[float, ...],
    wait_weight: float,
    min_gain_h: float = MIN_GAIN_H,
    min_gain_frac: float = MIN_GAIN_FRAC,
) -> pl.DataFrame:
    """Station counts "close / partial / keep" per walk weight and stop cost scale."""
    rows = []
    for weight in walk_weights:
        row: dict[str, object] = {"walk_weight": weight}
        for scale in COST_SCALES:
            c = cells(hours, headway, stops, weight, wait_weight, scale)
            v = policies(c, stops, min_gain_h, min_gain_frac)["verdict"]
            counts = [
                (v == name).sum() for name in ("binary_close", "partial", "binary_keep")
            ]
            row[f"cost x{scale:g}"] = " / ".join(str(n) for n in counts)
        rows.append(row)
    return pl.DataFrame(rows)


def station_table(cells_: pl.DataFrame, station: str) -> pl.DataFrame:
    """One station's close and alternate net hours by hour, one column pair per dir."""
    one = cells_.filter(parent_station=station)
    if one.is_empty():
        raise ValueError(f"no cells for {station}; terminals are left out")
    return one.pivot(
        "dir",
        index=["hour", "band"],
        values=["through", "displaced", "net_h", "alt_net_h"],
        sort_columns=True,
    ).sort("hour")

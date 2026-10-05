"""Site data per mode: stations, riders by hour, stop costs and patterns as JSON."""

from __future__ import annotations

import datetime as dt
import json
import logging
from typing import TYPE_CHECKING

import polars as pl

from stahpthestahp.score import rank
from stahpthestahp.walk import WALK_SPEED_MPS, WALK_WEIGHT

if TYPE_CHECKING:
    from pathlib import Path

log = logging.getLogger(__name__)

# Dwell histogram bins, seconds
DWELL_BIN_S = 5
DWELL_MAX_S = 180
FLAGS = ("hub", "transfer", "junction", "trunk", "accessible", "cost_gap")


def _r(x: float | None, nd: int = 1) -> float | None:
    return None if x is None else round(x, nd)


def stations(
    hours: pl.DataFrame, stops: pl.DataFrame, riders: pl.DataFrame
) -> list[dict]:
    """One record per ranked station with the sums the site rescales.

    saved_h = dwell_h + accel_h at measured stop cost; walk_h = walk_mh / speed
    x weight. rank and net_h are the defaults, for checking the site's maths.
    """
    ranked = rank(hours, stops, WALK_WEIGHT)
    sums = hours.group_by("parent_station").agg(
        pl.col("dwell_h", "accel_h", "walk_mh").sum()
    )
    where = stops.group_by("parent_station").agg(pl.col("lat", "lon").mean())
    # Direction names per station, from the first route serving it
    dirs = (
        stops.sort("route_id")
        .group_by("parent_station", "direction_id")
        .agg(pl.col("direction_name").first())
    )
    by_hour = (
        riders.filter("on_pattern")
        .group_by("parent_station", "direction_id", "hour")
        .agg(pl.col("ons", "offs", "through").sum())
        .sort("hour")
        .group_by("parent_station", "direction_id")
        .agg(pl.col("ons", "offs", "through").round(1))
    )
    out = []
    for r in (
        ranked.join(sums, on="parent_station")
        .join(where, on="parent_station")
        .iter_rows(named=True)
    ):
        sid = r["parent_station"]
        hourly = {
            h["direction_id"]: {k: h[k] for k in ("ons", "offs", "through")}
            for h in by_hour.filter(parent_station=sid).iter_rows(named=True)
        }
        names = dict(
            dirs.filter(parent_station=sid)
            .select("direction_id", "direction_name")
            .rows()
        )
        out.append(
            {
                "id": sid,
                "name": r["stop_name"],
                "routes": r["routes"].split(","),
                "lat": round(r["lat"], 5),
                "lon": round(r["lon"], 5),
                "flags": [f for f in FLAGS if r[f]],
                "through": _r(r["through"]),
                "displaced": _r(r["displaced"]),
                "dwell_h": _r(r["dwell_h"], 3),
                "accel_h": _r(r["accel_h"], 3),
                "walk_mh": _r(r["walk_mh"], 3),
                "extra_walk_m": _r(r["extra_walk_m"]),
                "rank": r["rank"],
                "net_h": _r(r["net_h"], 3),
                "dirs": {d: {"name": names.get(d), **v} for d, v in hourly.items()},
            }
        )
    return out


def platform_costs(
    costs: pl.DataFrame, riders: pl.DataFrame, events: pl.DataFrame, n_days: int
) -> list[dict]:
    """Stop cost by band per route, direction and station, with trains per day.

    riders_per_train is the daily ons + offs over LAMP stop events per weekday.
    """
    keys = ["route_id", "direction_id", "parent_station"]
    trains = events.group_by(keys).agg((pl.len() / n_days).alias("trains"))
    used = riders.filter("on_pattern").group_by(keys).agg(pl.col("displaced").sum())
    bands = (
        costs.group_by(*keys, "band")
        .agg(pl.col("dwell_s", "accel_loss_s", "v_in_mps").mean())
        .sort("band")
        .group_by(keys)
        .agg(
            pl.col("band").cast(pl.String),
            pl.col("dwell_s", "accel_loss_s", "v_in_mps").round(1),
        )
        .join(trains, on=keys, how="left")
        .join(used, on=keys, how="left")
        .sort(keys)
    )
    return [
        {
            "route": r["route_id"],
            "dir": r["direction_id"],
            "station": r["parent_station"],
            "bands": r["band"],
            "dwell_s": r["dwell_s"],
            "accel_s": r["accel_loss_s"],
            "v_in": r["v_in_mps"],
            "trains": _r(r["trains"]),
            "riders_per_train": _r(
                r["displaced"] / r["trains"]
                if r["trains"] and r["displaced"]
                else None,
                2,
            ),
        }
        for r in bands.iter_rows(named=True)
    ]


def patterns(stops: pl.DataFrame) -> list[dict]:
    """Typical patterns with their stations in order and distance along the shape."""
    out = []
    for (pid,), g in stops.sort("pattern_id", "seq").group_by(
        "pattern_id", maintain_order=True
    ):
        out.append(
            {
                "id": pid,
                "route": g["route_id"][0],
                "dir": g["direction_id"][0],
                "dir_name": g["direction_name"][0],
                "stations": g["parent_station"].to_list(),
                "dist_m": g["dist_m"].round(0).to_list(),
                "terminal": [bool(t) for t in g["terminal"]],
            }
        )
    return out


def dwell_histogram(events: pl.DataFrame) -> dict[str, list[int]]:
    """LAMP dwell counts per route in DWELL_BIN_S bins up to DWELL_MAX_S."""
    n = DWELL_MAX_S // DWELL_BIN_S
    binned = (
        events.filter(pl.col("dwell_time_seconds").is_between(0, DWELL_MAX_S - 1))
        .with_columns((pl.col("dwell_time_seconds") // DWELL_BIN_S).alias("bin"))
        .group_by("route_id", "bin")
        .len()
    )
    out = {}
    for (route,), g in binned.sort("route_id").group_by(
        "route_id", maintain_order=True
    ):
        counts = [0] * n
        for b, c in g.select("bin", "len").rows():
            counts[int(b)] = c
        out[route] = counts
    return out


def write(
    path: Path,
    mode: str,
    route_ids: tuple[str, ...],
    hours: pl.DataFrame,
    stops: pl.DataFrame,
    costs: pl.DataFrame,
    riders: pl.DataFrame,
    events: pl.DataFrame,
    n_days: int,
    meta: dict,
) -> None:
    """Write one mode's site data to path."""
    data = {
        "mode": mode,
        "routes": list(route_ids),
        "generated": dt.date.today().isoformat(),
        "defaults": {"walk_speed_mps": WALK_SPEED_MPS, "walk_weight": WALK_WEIGHT},
        "lamp_days": n_days,
        "dwell_bin_s": DWELL_BIN_S,
        **meta,
        "stations": stations(hours, stops, riders),
        "platforms": platform_costs(costs, riders, events, n_days),
        "patterns": patterns(stops),
        "dwell_hist": dwell_histogram(events),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")))
    log.info(
        "wrote %s (%.0f kB, %d stations)",
        path,
        path.stat().st_size / 1e3,
        len(data["stations"]),
    )

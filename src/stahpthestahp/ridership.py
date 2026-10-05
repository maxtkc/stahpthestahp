"""Weekday riders per station, route, direction and hour: through and displaced."""

import logging
from pathlib import Path

import polars as pl

from stahpthestahp.stopcost import band_of_hour

log = logging.getLogger(__name__)

WEEKDAY = "Weekday"
# Hourly flow is rounded to whole riders, so small negatives are rounding
ROUNDING = 0.5
# Daily gap between a station's arriving flow and the previous departing flow
# that is logged, in riders
CONTINUITY_TOLERANCE = 50.0
# Relative gap between a pattern's daily ons and offs that is logged
BALANCE_TOLERANCE = 0.01

KEYS = ("route_id", "direction_id", "parent_station")
# Ridership dir_id from the GTFS direction name: "East" -> "EB"
DIR_ID = (pl.col("direction_name").str.slice(0, 1) + "B").alias("dir_id")


def load_ridership(path: Path, route_ids: tuple[str, ...]) -> pl.DataFrame:
    """Weekday ons, offs and departing flow per route, dir_id, station and hour.

    Values are per weekday: the totals divide by the most service days of the
    route and direction, so stations served only on some days aren't inflated.
    """
    df = pl.read_csv(
        path,
        columns=[
            "route_id",
            "dir_id",
            "day_type_name",
            "parent_station",
            "hour_of_service",
            "total_ons",
            "total_offs",
            "number_service_days",
            "average_flow",
        ],
    ).filter(pl.col("route_id").is_in(route_ids), day_type_name=WEEKDAY)
    if df.is_empty():
        raise ValueError(f"ridership has no weekday rows for {route_ids}")
    days = pl.col("number_service_days")
    max_days = days.max().over("route_id", "dir_id")
    return df.select(
        "route_id",
        "dir_id",
        "parent_station",
        pl.col("hour_of_service").str.slice(0, 2).cast(pl.Int8).alias("hour"),
        (pl.col("total_ons") / max_days).alias("ons"),
        (pl.col("total_offs") / max_days).alias("offs"),
        (pl.col("average_flow") * days / max_days).alias("flow"),
    )


def riders(stops: pl.DataFrame, ridership: pl.DataFrame) -> pl.DataFrame:
    """Riders per route, direction, station and hour, per weekday.

    flow is the load leaving the station, from the ridership data.
    arriving = flow - ons + offs. through = flow - ons, the riders who stay
    on. displaced = ons + offs, the riders who use it. Rows past the ends of
    the typical pattern (trips extended beyond the usual terminal) are kept
    with on_pattern false. Raises on stations or directions that don't match
    the stop table, and on pattern stations without ridership.
    """
    keys = list(KEYS)
    stops = stops.with_columns(DIR_ID)
    unknown = set(ridership["parent_station"]) - set(stops["parent_station"])
    if unknown:
        raise ValueError(f"ridership stations not in the stop table: {sorted(unknown)}")

    dirs = stops.select("route_id", "direction_id", "dir_id").unique()
    bad_dirs = ridership.join(dirs, on=["route_id", "dir_id"], how="anti")
    if not bad_dirs.is_empty():
        pairs = sorted(bad_dirs.select("route_id", "dir_id").unique().rows())
        raise ValueError(f"ridership directions not in the stop table: {pairs}")
    by_hour = ridership.join(dirs, on=["route_id", "dir_id"]).drop("dir_id")

    # A station on several patterns of a route (Red trunk) keeps its first seq
    pattern = stops.group_by(keys).agg(pl.col("seq").min())
    missing = pattern.join(by_hour, on=keys, how="anti")
    if not missing.is_empty():
        raise ValueError(
            f"stations without ridership: {sorted(missing.select(keys).rows())}"
        )

    hours = pl.DataFrame({"hour": range(24)}, schema={"hour": pl.Int8})
    out = (
        by_hour.select(keys)
        .unique()
        .join(pattern, on=keys, how="left")
        .with_columns(pl.col("seq").is_not_null().alias("on_pattern"))
        .join(hours, how="cross")
        .join(by_hour, on=[*keys, "hour"], how="left")
        .with_columns(pl.col("ons", "offs", "flow").fill_null(0.0))
        .with_columns(
            (pl.col("flow") - pl.col("ons") + pl.col("offs")).alias("arriving"),
            (pl.col("flow") - pl.col("ons")).alias("through"),
            (pl.col("ons") + pl.col("offs")).alias("displaced"),
            band_of_hour(pl.col("hour")).alias("band"),
        )
    )
    _check(out, stops)
    return out.select(
        *keys,
        "seq",
        "on_pattern",
        "hour",
        "band",
        "ons",
        "offs",
        pl.col("arriving", "through").clip(lower_bound=0),
        "flow",
        "displaced",
    ).sort("route_id", "direction_id", "seq", "parent_station", "hour")


def _check(out: pl.DataFrame, stops: pl.DataFrame) -> None:
    """Log ons/offs imbalance, negative flow and flow breaks along each pattern."""
    totals = out.group_by("route_id", "direction_id").agg(
        pl.col("ons").sum(), pl.col("offs").sum()
    )
    for route, direction, ons, offs in totals.sort("route_id", "direction_id").rows():
        gap = abs(ons - offs) / max(ons, offs, 1.0)
        log.log(
            logging.WARNING if gap > BALANCE_TOLERANCE else logging.DEBUG,
            "%s %s: %.0f ons, %.0f offs per weekday",
            route,
            direction,
            ons,
            offs,
        )

    negative = out.filter(pl.col("through") < -ROUNDING)
    if not negative.is_empty():
        worst = negative.sort("through").row(0, named=True)
        log.warning(
            "%d station-hours with negative through riders, worst %.1f at "
            "%s %s %s hour %d",
            negative.height,
            worst["through"],
            worst["route_id"],
            worst["direction_id"],
            worst["parent_station"],
            worst["hour"],
        )

    # Over the day, riders arriving at a station left the previous one. Where
    # one route has several patterns, flow merges branches at the junction,
    # so the junction and the station after it are skipped
    day = out.filter("on_pattern").group_by(KEYS).agg(pl.col("arriving", "flow").sum())
    day = (
        stops.select(*KEYS, "pattern_id", "seq", "junction")
        .join(day, on=list(KEYS))
        .sort("pattern_id", "seq")
        .with_columns(
            (pl.col("arriving") - pl.col("flow").shift(1))
            .over("pattern_id")
            .alias("gap"),
            (pl.col("junction") | pl.col("junction").shift(1).fill_null(False))
            .over("pattern_id")
            .alias("near_junction"),
            (
                pl.col("pattern_id").n_unique().over("route_id", "direction_id") > 1
            ).alias("branched"),
        )
        .filter(
            pl.col("gap").abs() > CONTINUITY_TOLERANCE,
            ~(pl.col("branched") & pl.col("near_junction")),
        )
        .unique(KEYS, keep="first", maintain_order=True)
    )
    for r in day.iter_rows(named=True):
        log.warning(
            "%s %s %s: %.0f riders arrive vs %.0f leaving the previous station",
            r["route_id"],
            r["direction_id"],
            r["parent_station"],
            r["arriving"],
            r["arriving"] - r["gap"],
        )

    log.info(
        "ridership: %.0f weekday ons on %s, %.0f off the typical patterns",
        out["ons"].sum(),
        ", ".join(out["route_id"].unique().sort()),
        out.filter(~pl.col("on_pattern"))["ons"].sum(),
    )


def by_station(riders: pl.DataFrame) -> pl.DataFrame:
    """Riders per station, direction and hour, summed across routes."""
    return (
        riders.group_by("direction_id", "parent_station", "hour", "band")
        .agg(
            pl.col("ons", "offs", "through", "displaced").sum(),
            pl.col("route_id").unique().sort().str.join(",").alias("routes"),
        )
        .sort("direction_id", "parent_station", "hour")
    )

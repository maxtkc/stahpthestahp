"""Extra walk per displaced rider when a stop is removed, on a 1-D corridor."""

import logging

import polars as pl

log = logging.getLogger(__name__)

WALK_SPEED_MPS = 1.3
# Walking time counts this many times in-vehicle time
WALK_WEIGHT = 2.0


def extra_walk_m(prev_m: pl.Expr, next_m: pl.Expr) -> pl.Expr:
    """Mean extra walk (m) for riders of a stop prev_m and next_m from its neighbours.

    Riders are spread evenly from the midpoint to the previous stop to the
    midpoint to the next one. A rider at offset x walks min(prev_m + 2x,
    next_m) more behind the stop and min(next_m - 2x, prev_m) more ahead of
    it. Integrated over the catchment that is prev_m * next_m / 2, and the
    catchment is (prev_m + next_m) / 2 long, so the mean is
    prev_m * next_m / (prev_m + next_m).
    """
    total = prev_m + next_m
    return pl.when(total > 0).then(prev_m * next_m / total).otherwise(0.0)


def walk_penalty(stops: pl.DataFrame, speed_mps: float, weight: float) -> pl.DataFrame:
    """Extra walk per displaced rider for each through platform and pattern.

    Neighbours come from the platform's own route pattern, so a junction gets
    one row per branch. Pattern endpoints have no stop on one side and are
    left out.
    """
    out = (
        stops.sort("pattern_id", "seq")
        .with_columns(
            pl.col("dist_m").diff().over("pattern_id").alias("prev_m"),
            (-pl.col("dist_m").diff(-1)).over("pattern_id").alias("next_m"),
        )
        .filter(pl.col("prev_m").is_not_null(), pl.col("next_m").is_not_null())
        .with_columns(
            ((pl.col("prev_m") + pl.col("next_m")) / 2).alias("catchment_m"),
            extra_walk_m(pl.col("prev_m"), pl.col("next_m")).alias("extra_walk_m"),
        )
        .with_columns((pl.col("extra_walk_m") / speed_mps).alias("extra_walk_s"))
        .with_columns((pl.col("extra_walk_s") * weight).alias("walk_cost_s"))
    )
    log.info(
        "walk: %d platforms, mean extra walk %.0f m at %.1f m/s, weight %.1f",
        out.height,
        out["extra_walk_m"].mean() or 0.0,
        speed_mps,
        weight,
    )
    return out.select(
        "route_id",
        "direction_id",
        "pattern_id",
        "seq",
        "parent_station",
        "stop_name",
        "prev_m",
        "next_m",
        "catchment_m",
        "extra_walk_m",
        "extra_walk_s",
        "walk_cost_s",
    )

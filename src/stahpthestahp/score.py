"""Net weekday rider-hours of removing each station: time saved minus extra walk."""

import logging

import polars as pl

log = logging.getLogger(__name__)

KEYS = ("route_id", "direction_id", "parent_station")
# Stop cost multipliers and walk weights for the sensitivity grid
COST_SCALES = (0.75, 1.0, 1.25)
WALK_WEIGHTS = (1.0, 2.0, 3.0)


def platform_hours(
    stops: pl.DataFrame,
    costs: pl.DataFrame,
    riders: pl.DataFrame,
    walk: pl.DataFrame,
) -> pl.DataFrame:
    """Saved and walked rider-hours per through platform, direction and hour.

    saved_h = through x stop cost, walk_h = displaced x extra walk time, both
    unweighted. dwell_h and accel_h split saved_h into its two parts, and
    walk_mh is displaced x extra walk metres / 3600, for rescaling by walk
    speed. Platforms at terminal stations are left out. A platform-hour
    without a stop cost saves nothing and is flagged cost_gap. A platform on
    several patterns of one route (Red trunk) takes the plain mean of their
    stop costs and walks, as ridership isn't split by branch.
    """
    keys = list(KEYS)
    terminal = stops.filter("terminal")["parent_station"].unique()
    costs = costs.group_by(*keys, "band").agg(
        pl.col("stop_cost_s", "dwell_s", "accel_loss_s").mean(),
        pl.col("fallback").any(),
    )
    walk = walk.group_by(keys).agg(pl.col("extra_walk_m", "extra_walk_s").mean())
    out = (
        riders.filter("on_pattern")
        .join(costs, on=[*keys, "band"])
        .join(walk, on=keys)
        .filter(~pl.col("parent_station").is_in(terminal.implode()))
        .with_columns(
            pl.col("stop_cost_s").is_null().alias("cost_gap"),
            (pl.col("through") * pl.col("stop_cost_s").fill_null(0.0) / 3600).alias(
                "saved_h"
            ),
            (pl.col("displaced") * pl.col("extra_walk_s") / 3600).alias("walk_h"),
            (pl.col("displaced") * pl.col("extra_walk_m") / 3600).alias("walk_mh"),
        )
        .with_columns(
            (
                pl.when(pl.col("cost_gap")).then(0.0).otherwise(pl.col(c))
                * pl.col("through")
                / 3600
            ).alias(name)
            for c, name in (("dwell_s", "dwell_h"), ("accel_loss_s", "accel_h"))
        )
    )
    dropped = riders.filter(
        ~pl.col("on_pattern") | pl.col("parent_station").is_in(terminal.implode())
    )
    log.info(
        "score: %d platform-hours, %.0f weekday displaced riders at terminals or "
        "off the typical patterns left out",
        out.height,
        dropped["displaced"].sum(),
    )
    return out


def rank(hours: pl.DataFrame, stops: pl.DataFrame, walk_weight: float) -> pl.DataFrame:
    """One row per station, both directions and all routes, best removal first.

    stop_cost_s is the through-weighted mean stop cost (the saving per through
    rider) and extra_walk_m the displaced-weighted mean extra walk.
    """
    flags = stops.group_by("parent_station").agg(
        pl.col("stop_name").first(),
        pl.col("hub", "transfer", "junction", "trunk", "accessible").any(),
    )
    out = (
        hours.group_by("parent_station")
        .agg(
            pl.col("route_id").unique().sort().str.join(",").alias("routes"),
            pl.col("through", "displaced", "saved_h", "walk_h").sum(),
            (pl.col("through") * pl.col("stop_cost_s").fill_null(0.0))
            .sum()
            .alias("_cost"),
            (pl.col("displaced") * pl.col("extra_walk_m")).sum().alias("_walk"),
            pl.col("cost_gap").any(),
            (pl.col("fallback").fill_null(False) & (pl.col("through") > 0))
            .any()
            .alias("cost_fallback"),
        )
        .join(flags, on="parent_station", how="left")
        .with_columns(
            (pl.col("_cost") / pl.col("through")).alias("stop_cost_s"),
            (pl.col("_walk") / pl.col("displaced")).alias("extra_walk_m"),
            (pl.col("walk_h") * walk_weight).alias("walk_h"),
        )
        .with_columns((pl.col("saved_h") - pl.col("walk_h")).alias("net_h"))
        .sort("net_h", descending=True)
        .with_row_index("rank", offset=1)
    )
    for r in out.filter("cost_gap").iter_rows(named=True):
        log.warning(
            "%s (%s): no stop cost for some platform-hours, counted as zero saving",
            r["stop_name"],
            r["parent_station"],
        )
    return out.select(
        "rank",
        "parent_station",
        "stop_name",
        "routes",
        "through",
        "stop_cost_s",
        "saved_h",
        "displaced",
        "extra_walk_m",
        "walk_h",
        "net_h",
        "hub",
        "transfer",
        "junction",
        "trunk",
        "accessible",
        "cost_gap",
        "cost_fallback",
    )


def sensitivity(hours: pl.DataFrame) -> pl.DataFrame:
    """Stations with positive net hours, and their total, per walk weight and cost.

    One row per walk weight, one column per stop cost multiplier, cells
    "<stations> / <net hours>".
    """
    station = hours.group_by("parent_station").agg(pl.col("saved_h", "walk_h").sum())
    rows = []
    for weight in WALK_WEIGHTS:
        row: dict[str, object] = {"walk_weight": weight}
        for scale in COST_SCALES:
            net = station.select(
                pl.col("saved_h") * scale - pl.col("walk_h") * weight
            ).to_series()
            positive = net.filter(net > 0)
            row[f"cost x{scale:g}"] = f"{positive.len()} / {positive.sum():,.0f} h"
        rows.append(row)
    return pl.DataFrame(rows)

"""Stop cost per platform, direction and hour band: median dwell + accel/decel loss."""

import logging
from pathlib import Path

import polars as pl

log = logging.getLogger(__name__)

TIMEZONE = "America/New_York"
# Hour bands by local start hour; the last one wraps past midnight
BANDS = (
    ("early", 4),
    ("am_peak", 7),
    ("midday", 10),
    ("pm_peak", 16),
    ("evening", 19),
    ("night", 22),
)
BAND = pl.Enum([name for name, _ in BANDS] + ["all"])
# Bands with fewer observations than this fall back to the all-day median
MIN_SAMPLES = 30

KEYS = ("route_id", "direction_id", "parent_station")


def band_of_hour(hour: pl.Expr) -> pl.Expr:
    """Band for a local hour 0-23."""
    expr = pl.lit(BANDS[-1][0])
    for name, start in BANDS[:-1]:
        end = next(s for _, s in BANDS if s > start)
        expr = (
            pl.when((hour >= start) & (hour < end)).then(pl.lit(name)).otherwise(expr)
        )
    return expr.cast(BAND)


def cruise_speed(
    dist_m: pl.Expr, time_s: pl.Expr, accel: float, decel: float
) -> pl.Expr:
    """Cruise speed (m/s) of a trapezoidal run covering dist_m in time_s.

    Solves time = dist/v + v/2 (1/accel + 1/decel) for the lower root. Runs too
    short for the rates give the triangular peak time / (1/accel + 1/decel).
    """
    k = 1 / accel + 1 / decel
    disc = (time_s**2 - 2 * k * dist_m).clip(lower_bound=0)
    return (time_s - disc.sqrt()) / k


def load_events(lamp_dir: Path, route_ids: tuple[str, ...]) -> pl.DataFrame:
    """LAMP stop events for route_ids with the previous station on the same trip."""
    files = sorted(lamp_dir.glob("*.parquet"))
    if not files:
        raise FileNotFoundError(f"no LAMP parquet in {lamp_dir}, run `stahp fetch`")
    trip = ("service_date", "route_id", "trip_id", "vehicle_id")
    events = (
        pl.scan_parquet(files)
        .filter(pl.col("route_id").is_in(route_ids))
        .select(
            *trip,
            "stop_sequence",
            "parent_station",
            "stop_timestamp",
            "travel_time_seconds",
            "dwell_time_seconds",
            pl.col("direction_id").cast(pl.Int8).cast(pl.String),
        )
        .sort(*trip, "stop_sequence")
        .with_columns(
            pl.col("parent_station").shift(1).over(trip).alias("prev_station"),
            band_of_hour(
                pl.from_epoch("stop_timestamp", "s")
                .dt.replace_time_zone("UTC")
                .dt.convert_time_zone(TIMEZONE)
                .dt.hour()
            ).alias("band"),
        )
        .drop(
            "service_date", "trip_id", "vehicle_id", "stop_sequence", "stop_timestamp"
        )
        .collect()
    )
    log.info("LAMP: %d stop events from %d days", events.height, len(files))
    return events


def _medians(
    events: pl.DataFrame, keys: list[str], value: str, name: str
) -> pl.DataFrame:
    """Median and count of value by keys and band, and by keys over all bands."""
    valid = events.filter(pl.col(value).is_not_null() & (pl.col(value) >= 0))
    aggs = (
        pl.col(value).median().alias(name),
        pl.len().alias(f"n_{name}"),
    )
    by_band = valid.group_by(*keys, "band").agg(*aggs)
    all_day = valid.group_by(*keys).agg(*aggs).with_columns(band=pl.lit("all", BAND))
    return pl.concat([by_band, all_day.select(by_band.columns)])


def _with_fallback(
    grid: pl.DataFrame, stats: pl.DataFrame, keys: list[str], name: str
) -> pl.DataFrame:
    """Join stats onto grid by keys and band, using the all-day value for thin bands."""
    n = f"n_{name}"
    all_day = (
        stats.filter(band="all")
        .drop("band")
        .rename({name: f"{name}_all", n: f"{n}_all"})
    )
    thin = pl.col(n).fill_null(0) < MIN_SAMPLES
    return (
        grid.join(stats, on=[*keys, "band"], how="left")
        .join(all_day, on=keys, how="left")
        .with_columns(
            pl.when(thin)
            .then(pl.col(f"{name}_all"))
            .otherwise(pl.col(name))
            .alias(name),
            thin.alias(f"{name}_fallback"),
            pl.col(n).fill_null(0),
        )
        .drop(f"{name}_all", f"{n}_all")
    )


def stop_costs(
    stops: pl.DataFrame, events: pl.DataFrame, accel: float, decel: float
) -> pl.DataFrame:
    """Stop cost per through platform, pattern and band (plus "all").

    Pattern endpoints have no stop to pass through and are left out. Travel
    times count only runs from the pattern's previous station, so short turns
    and skipped stops don't skew the segment speeds.
    """
    keys = list(KEYS)
    nbrs = (
        stops.sort("pattern_id", "seq")
        .with_columns(
            pl.col("parent_station").shift(1).over("pattern_id").alias("prev_station"),
            pl.col("parent_station").shift(-1).over("pattern_id").alias("next_station"),
            pl.col("dist_m").diff().over("pattern_id").alias("in_m"),
            (-pl.col("dist_m").diff(-1)).over("pattern_id").alias("out_m"),
        )
        .filter(
            pl.col("prev_station").is_not_null(), pl.col("next_station").is_not_null()
        )
    )
    bands = pl.DataFrame({"band": BAND.categories}, schema={"band": BAND})
    grid = nbrs.select(
        *keys,
        "pattern_id",
        "seq",
        "stop_name",
        "prev_station",
        "next_station",
        "in_m",
        "out_m",
    ).join(bands, how="cross")

    dwell = _medians(events, keys, "dwell_time_seconds", "dwell_s")
    seg_keys = [*keys, "prev_station"]
    travel = _medians(events, seg_keys, "travel_time_seconds", "travel_s")
    t_in = travel.rename({"travel_s": "in_s", "n_travel_s": "n_in_s"})
    t_out = travel.rename(
        {
            "parent_station": "next_station",
            "prev_station": "parent_station",
            "travel_s": "out_s",
            "n_travel_s": "n_out_s",
        }
    )

    out = _with_fallback(grid, dwell, keys, "dwell_s")
    out = _with_fallback(out, t_in, seg_keys, "in_s")
    out = _with_fallback(out, t_out, [*keys, "next_station"], "out_s")

    v_in = cruise_speed(pl.col("in_m"), pl.col("in_s"), accel, decel)
    v_out = cruise_speed(pl.col("out_m"), pl.col("out_s"), accel, decel)
    out = out.with_columns(
        (v_in / (2 * decel) + v_out / (2 * accel)).alias("accel_loss_s"),
        v_in.alias("v_in_mps"),
        v_out.alias("v_out_mps"),
    ).with_columns((pl.col("dwell_s") + pl.col("accel_loss_s")).alias("stop_cost_s"))

    gaps = out.filter(pl.col("band") == "all", pl.col("stop_cost_s").is_null())
    for r in gaps.iter_rows(named=True):
        log.warning(
            "no stop cost for %s %s %s (%s): %d dwell, %d in, %d out observations",
            r["route_id"],
            r["direction_id"],
            r["parent_station"],
            r["stop_name"],
            r["n_dwell_s"],
            r["n_in_s"],
            r["n_out_s"],
        )
    fallback = out.filter(
        pl.col("band") != "all",
        pl.col("dwell_s_fallback") | pl.col("in_s_fallback") | pl.col("out_s_fallback"),
    )
    log.info(
        "stop cost: %d platform-bands, %d with all-day fallback, %d platforms missing",
        out.filter(pl.col("band") != "all").height,
        fallback.height,
        gaps.height,
    )
    return out.select(
        *keys,
        "pattern_id",
        "seq",
        "stop_name",
        "band",
        "dwell_s",
        "n_dwell_s",
        "in_s",
        "out_s",
        "v_in_mps",
        "v_out_mps",
        "accel_loss_s",
        "stop_cost_s",
        (
            pl.col("dwell_s_fallback")
            | pl.col("in_s_fallback")
            | pl.col("out_s_fallback")
        ).alias("fallback"),
    ).sort(*keys[:2], "pattern_id", "seq", "band")

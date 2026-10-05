"""Stop table: platforms per branch and direction in route order, with flags."""

import logging
import math
import zipfile
from itertools import pairwise
from pathlib import Path

import polars as pl

from stahpthestahp.fetch import GTFS_DATE, gtfs_feed_url

log = logging.getLogger(__name__)

# Light rail, heavy rail and commuter rail
RAIL_ROUTE_TYPES = ("0", "1", "2")
# Projected stops farther than this from the shape are logged
MAX_OFFSET_M = 100.0
EARTH_RADIUS_M = 6_371_000.0


def gtfs_zip(raw_dir: Path) -> Path:
    """Path of the fetched GTFS zip for GTFS_DATE."""
    archive = (raw_dir / "gtfs/archived_feeds.txt").read_text()
    path = raw_dir / "gtfs" / Path(gtfs_feed_url(archive, GTFS_DATE)).name
    if not path.exists():
        raise FileNotFoundError(f"{path} missing, run `stahp fetch` first")
    return path


def distances_along(
    shape: list[tuple[float, float]], stops: list[tuple[float, float]]
) -> list[float]:
    """Metres along a (lat, lon) polyline to each stop, in order, never decreasing."""
    lat0 = math.radians(sum(lat for lat, _ in shape) / len(shape))

    def xy(lat: float, lon: float) -> tuple[float, float]:
        return (
            EARTH_RADIUS_M * math.radians(lon) * math.cos(lat0),
            EARTH_RADIUS_M * math.radians(lat),
        )

    pts = [xy(*p) for p in shape]
    cum = [0.0]
    for (ax, ay), (bx, by) in pairwise(pts):
        cum.append(cum[-1] + math.hypot(bx - ax, by - ay))

    out = []
    # Segment index and fraction along it of the previous stop
    start, start_t = 0, 0.0
    for stop in stops:
        px, py = xy(*stop)
        best = (math.inf, 0.0, start, start_t)
        # Search forward from the previous stop so order is kept
        for i in range(start, len(pts) - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            dx, dy = bx - ax, by - ay
            seg2 = dx * dx + dy * dy
            t = 0.0 if seg2 == 0 else ((px - ax) * dx + (py - ay) * dy) / seg2
            t = min(1.0, max(start_t if i == start else 0.0, t))
            off = math.hypot(ax + t * dx - px, ay + t * dy - py)
            # Ties go to the earliest match
            if off < best[0] - 1e-6:
                best = (off, cum[i] + t * (cum[i + 1] - cum[i]), i, t)
        off, dist, start, start_t = best
        if off > MAX_OFFSET_M:
            log.warning("stop %s is %.0f m from the shape", stop, off)
        out.append(dist)
    return out


def _read(z: zipfile.ZipFile, name: str, *columns: str) -> pl.DataFrame:
    return pl.read_csv(z.read(name), columns=list(columns), infer_schema_length=0)


def build_stops(gtfs: Path, route_ids: tuple[str, ...]) -> pl.DataFrame:
    """One row per platform on each typical pattern of route_ids, in route order.

    A route can have several typical patterns per direction (Red Line branches),
    so seq and neighbours are per pattern_id.
    """
    with zipfile.ZipFile(gtfs) as z:
        patterns = _read(
            z,
            "route_patterns.txt",
            "route_pattern_id",
            "route_id",
            "direction_id",
            "route_pattern_typicality",
            "representative_trip_id",
        ).filter(
            pl.col("route_id").is_in(route_ids),
            pl.col("route_pattern_typicality") == "1",
        )
        trips = _read(z, "trips.txt", "trip_id", "route_id", "shape_id")
        routes = _read(z, "routes.txt", "route_id", "route_type", "line_id")
        directions = _read(z, "directions.txt", "route_id", "direction_id", "direction")
        stops = _read(
            z,
            "stops.txt",
            "stop_id",
            "stop_name",
            "stop_lat",
            "stop_lon",
            "parent_station",
            "wheelchair_boarding",
        )
        stop_times = _read(z, "stop_times.txt", "trip_id", "stop_id", "stop_sequence")
        shapes = _read(
            z,
            "shapes.txt",
            "shape_id",
            "shape_pt_lat",
            "shape_pt_lon",
            "shape_pt_sequence",
        )

    missing = set(route_ids) - set(patterns["route_id"])
    if missing:
        raise ValueError(f"no typical route pattern for {sorted(missing)}")

    # Platforms without their own wheelchair_boarding inherit the parent's
    parent_wb = stops.select(
        pl.col("stop_id").alias("parent_station"),
        pl.col("wheelchair_boarding").alias("parent_wb"),
    )
    platforms = stops.join(parent_wb, on="parent_station", how="left").select(
        "stop_id",
        "stop_name",
        "parent_station",
        pl.col("stop_lat").cast(pl.Float64).alias("lat"),
        pl.col("stop_lon").cast(pl.Float64).alias("lon"),
        (
            pl.when(pl.col("wheelchair_boarding").is_in(["1", "2"]))
            .then(pl.col("wheelchair_boarding"))
            .otherwise(pl.col("parent_wb"))
            == "1"
        )
        .fill_null(False)
        .alias("accessible"),
    )

    rows = []
    for p in patterns.sort("route_id", "direction_id", "route_pattern_id").iter_rows(
        named=True
    ):
        trip_id = p["representative_trip_id"]
        shape_id = trips.filter(pl.col("trip_id") == trip_id)["shape_id"].item()
        seq = (
            stop_times.filter(pl.col("trip_id") == trip_id)
            .with_columns(pl.col("stop_sequence").cast(pl.Int32))
            .sort("stop_sequence")
            .join(platforms, on="stop_id", how="left", maintain_order="left")
        )
        unmatched = seq.filter(pl.col("lat").is_null())["stop_id"].to_list()
        if unmatched:
            raise ValueError(f"{trip_id} stops missing from stops.txt: {unmatched}")
        shape = (
            shapes.filter(pl.col("shape_id") == shape_id)
            .with_columns(pl.col("shape_pt_sequence").cast(pl.Int32))
            .sort("shape_pt_sequence")
            .select(pl.col("shape_pt_lat", "shape_pt_lon").cast(pl.Float64))
        )
        dist = distances_along(shape.rows(), seq.select("lat", "lon").rows())
        rows.append(
            seq.drop("trip_id", "stop_sequence").with_columns(
                pl.lit(p["route_id"]).alias("route_id"),
                pl.lit(p["direction_id"]).alias("direction_id"),
                pl.lit(p["route_pattern_id"]).alias("pattern_id"),
                pl.int_range(pl.len(), dtype=pl.Int32).alias("seq"),
                pl.Series("dist_m", dist).round(1),
            )
        )
    table = (
        pl.concat(rows)
        .join(directions, on=["route_id", "direction_id"], how="left")
        .join(routes.select("route_id", "line_id"), on="route_id", how="left")
    )

    # Endpoints of any typical pattern
    ends = table.filter(
        (pl.col("seq") == 0) | (pl.col("seq") == pl.col("seq").max().over("pattern_id"))
    )["parent_station"]

    # Stations served by more than one typical pattern of a line in a direction
    trunk = (
        table.group_by("line_id", "parent_station", "direction_id")
        .agg(pl.col("pattern_id").n_unique().alias("n"))
        .filter(pl.col("n") > 1)["parent_station"]
    )

    # Stations where typical patterns of a line in one direction diverge or merge
    nbrs = table.sort("pattern_id", "seq").with_columns(
        pl.col("parent_station").shift(-1).over("pattern_id").alias("next"),
        pl.col("parent_station").shift(1).over("pattern_id").alias("prev"),
    )
    junction = (
        nbrs.group_by("line_id", "parent_station", "direction_id")
        .agg(
            pl.col("next").drop_nulls().n_unique().alias("n_next"),
            pl.col("prev").drop_nulls().n_unique().alias("n_prev"),
        )
        .filter((pl.col("n_next") > 1) | (pl.col("n_prev") > 1))["parent_station"]
    )

    # Stations served by rail routes of more than one line
    rail = (
        trips.join(routes, on="route_id")
        .filter(pl.col("route_type").is_in(RAIL_ROUTE_TYPES))
        .select("trip_id", "line_id")
    )
    transfer = (
        stop_times.join(rail, on="trip_id")
        .join(platforms, on="stop_id")
        .group_by("parent_station")
        .agg(pl.col("line_id").n_unique().alias("n"))
        .filter(pl.col("n") > 1)["parent_station"]
    )

    table = table.with_columns(
        pl.col("parent_station").is_in(ends.implode()).alias("terminal"),
        pl.col("parent_station").is_in(trunk.implode()).alias("trunk"),
        pl.col("parent_station").is_in(transfer.implode()).alias("transfer"),
        pl.col("parent_station").is_in(junction.implode()).alias("junction"),
    ).with_columns((pl.col("transfer") | pl.col("junction")).alias("hub"))

    log.info(
        "stops: %d platforms, %d stations on %s",
        table.height,
        table["parent_station"].n_unique(),
        ", ".join(route_ids),
    )
    return table.select(
        "route_id",
        "direction_id",
        pl.col("direction").alias("direction_name"),
        "pattern_id",
        "seq",
        "stop_id",
        "parent_station",
        "stop_name",
        "lat",
        "lon",
        "dist_m",
        "terminal",
        "trunk",
        "junction",
        "transfer",
        "hub",
        "accessible",
    ).sort("route_id", "direction_id", "pattern_id", "seq")

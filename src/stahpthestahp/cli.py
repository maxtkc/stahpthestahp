"""stahp command line."""

import argparse
import logging
from pathlib import Path

import httpx
import polars as pl

from stahpthestahp import export
from stahpthestahp.fetch import (
    GTFS_DATE,
    RIDERSHIP_FILE,
    WINDOW_END,
    WINDOW_START,
    fetch,
)
from stahpthestahp.modes import MODE_NAMES, get_mode
from stahpthestahp.ridership import by_station, load_ridership, riders
from stahpthestahp.score import WALK_WEIGHTS, platform_hours, rank, sensitivity
from stahpthestahp.skip import (
    MIN_GAIN_H,
    WAIT_WEIGHT,
    cells,
    headways,
    policies,
    station_table,
    verdict_grid,
)
from stahpthestahp.stopcost import load_events, stop_costs
from stahpthestahp.stops import build_stops, gtfs_zip
from stahpthestahp.walk import WALK_SPEED_MPS, WALK_WEIGHT, walk_penalty

log = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="stahp",
        description="Rank MBTA stops by net weekday rider-hours of removing them.",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--mode", default="green", choices=MODE_NAMES)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("fetch", help="download GTFS, LAMP OTP and ridership")
    sub.add_parser("stops", help="print the stop table")
    cost = sub.add_parser("cost", help="print stop cost per stop and hour band")
    cost.add_argument("--accel", type=float, help="m/s^2, default from the mode")
    cost.add_argument("--decel", type=float, help="m/s^2, default from the mode")
    sub.add_parser("riders", help="print weekday riders per station and direction")
    walk = sub.add_parser("walk", help="print extra walk per displaced rider")
    walk.add_argument("--walk-speed", type=float, default=WALK_SPEED_MPS, help="m/s")
    walk.add_argument(
        "--walk-weight",
        type=float,
        default=WALK_WEIGHT,
        help="walk time multiplier vs in-vehicle time",
    )
    rank_p = sub.add_parser("rank", help="rank stations by net weekday rider-hours")
    rank_p.add_argument("--accel", type=float, help="m/s^2, default from the mode")
    rank_p.add_argument("--decel", type=float, help="m/s^2, default from the mode")
    rank_p.add_argument("--walk-speed", type=float, default=WALK_SPEED_MPS, help="m/s")
    rank_p.add_argument(
        "--walk-weight",
        type=float,
        default=WALK_WEIGHT,
        help="walk time multiplier vs in-vehicle time",
    )
    rank_p.add_argument(
        "--out", type=Path, help="CSV path, default results/<mode>_ranking.csv"
    )
    skip_p = sub.add_parser(
        "skip", help="score closing by direction and hour band, or alternate trains"
    )
    skip_p.add_argument("--accel", type=float, help="m/s^2, default from the mode")
    skip_p.add_argument("--decel", type=float, help="m/s^2, default from the mode")
    skip_p.add_argument("--walk-speed", type=float, default=WALK_SPEED_MPS, help="m/s")
    skip_p.add_argument(
        "--walk-weight",
        type=float,
        default=WALK_WEIGHT,
        help="walk time multiplier vs in-vehicle time",
    )
    skip_p.add_argument(
        "--wait-weight",
        type=float,
        default=WAIT_WEIGHT,
        help="wait time multiplier vs in-vehicle time",
    )
    skip_p.add_argument(
        "--min-gain",
        type=float,
        default=MIN_GAIN_H,
        help="weekday hours a partial policy must beat keep/close by",
    )
    skip_p.add_argument("--station", help="print one parent_station by hour")
    skip_p.add_argument(
        "--out", type=Path, help="CSV path, default results/<mode>_skip.csv"
    )
    export_p = sub.add_parser("export", help="write site data JSON for every mode")
    export_p.add_argument("--accel", type=float, help="m/s^2, default from the mode")
    export_p.add_argument("--decel", type=float, help="m/s^2, default from the mode")
    export_p.add_argument(
        "--out-dir", type=Path, default=Path("web/src/data"), help="JSON directory"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    mode = get_mode(args.mode)

    if args.command == "fetch":
        with httpx.Client(follow_redirects=True, timeout=60) as client:
            fetch(args.data_dir / "raw", mode.route_ids, client)

    elif args.command == "stops":
        raw = args.data_dir / "raw"
        table = build_stops(gtfs_zip(raw), mode.route_ids)
        with pl.Config(tbl_rows=-1, tbl_cols=-1, tbl_width_chars=200):
            print(table.drop("lat", "lon"))

    elif args.command == "cost":
        raw = args.data_dir / "raw"
        costs = stop_costs(
            build_stops(gtfs_zip(raw), mode.route_ids),
            load_events(raw / "lamp", mode.route_ids),
            args.accel or mode.accel_mps2,
            args.decel or mode.decel_mps2,
        )
        # One row per platform: stop cost by band, then all-day dwell and loss
        wide = costs.pivot(
            "band",
            index=["route_id", "direction_id", "pattern_id", "seq", "stop_name"],
            values="stop_cost_s",
            maintain_order=True,
        ).join(
            costs.filter(band="all").select(
                "pattern_id", "seq", "dwell_s", "accel_loss_s"
            ),
            on=["pattern_id", "seq"],
        )
        with pl.Config(tbl_rows=-1, tbl_cols=-1, tbl_width_chars=200):
            print(wide.with_columns(pl.selectors.float().round(1)))

    elif args.command == "riders":
        raw = args.data_dir / "raw"
        stops = build_stops(gtfs_zip(raw), mode.route_ids)
        stations = by_station(
            riders(stops, load_ridership(raw / RIDERSHIP_FILE, mode.route_ids))
        )
        # Stations in order along the first route that serves them
        order = stops.group_by("direction_id", "parent_station").agg(
            pl.col("stop_name").first(),
            pl.col("route_id", "seq").sort_by("route_id", "seq").first(),
        )
        daily = (
            stations.group_by("direction_id", "parent_station")
            .agg(
                pl.col("routes").first(),
                pl.col("ons", "offs", "through", "displaced").sum(),
            )
            .join(order, on=["direction_id", "parent_station"], how="left")
            .sort("direction_id", "route_id", "seq", nulls_last=True)
            .select(
                "direction_id",
                "parent_station",
                "stop_name",
                "routes",
                pl.col("ons", "offs", "through", "displaced").round(0),
            )
        )
        with pl.Config(tbl_rows=-1, tbl_cols=-1, tbl_width_chars=200):
            print(daily)

    elif args.command == "walk":
        raw = args.data_dir / "raw"
        table = walk_penalty(
            build_stops(gtfs_zip(raw), mode.route_ids),
            args.walk_speed,
            args.walk_weight,
        )
        with pl.Config(tbl_rows=-1, tbl_cols=-1, tbl_width_chars=200):
            print(table.with_columns(pl.selectors.float().round(1)))

    elif args.command == "export":
        raw = args.data_dir / "raw"
        n_days = len(list((raw / "lamp").glob("*.parquet")))
        meta = {
            "ridership_period": "Fall 2025",
            "lamp_window": [WINDOW_START.isoformat(), WINDOW_END.isoformat()],
            "gtfs_date": GTFS_DATE.isoformat(),
        }
        for name in MODE_NAMES:
            m = get_mode(name)
            stops = build_stops(gtfs_zip(raw), m.route_ids)
            events = load_events(raw / "lamp", m.route_ids)
            costs = stop_costs(
                stops, events, args.accel or m.accel_mps2, args.decel or m.decel_mps2
            )
            rides = riders(stops, load_ridership(raw / RIDERSHIP_FILE, m.route_ids))
            hours = platform_hours(
                stops, costs, rides, walk_penalty(stops, WALK_SPEED_MPS, 1.0)
            )
            export.write(
                args.out_dir / f"{name}.json",
                name,
                m.route_ids,
                hours,
                stops,
                costs,
                rides,
                events,
                n_days,
                meta,
            )

    elif args.command == "rank":
        raw = args.data_dir / "raw"
        stops = build_stops(gtfs_zip(raw), mode.route_ids)
        hours = platform_hours(
            stops,
            stop_costs(
                stops,
                load_events(raw / "lamp", mode.route_ids),
                args.accel or mode.accel_mps2,
                args.decel or mode.decel_mps2,
            ),
            riders(stops, load_ridership(raw / RIDERSHIP_FILE, mode.route_ids)),
            # Unweighted: rank and sensitivity apply the walk weight
            walk_penalty(stops, args.walk_speed, 1.0),
        )
        table = rank(hours, stops, args.walk_weight)
        out = args.out or Path("results") / f"{mode.name}_ranking.csv"
        out.parent.mkdir(parents=True, exist_ok=True)
        table.write_csv(out, float_precision=2)
        log.info("wrote %s", out)
        with pl.Config(tbl_rows=-1, tbl_cols=-1, tbl_width_chars=200):
            print(
                table.select(
                    "rank",
                    "stop_name",
                    "routes",
                    pl.col("through", "displaced").round(0),
                    pl.col("stop_cost_s", "extra_walk_m").round(0),
                    pl.col("saved_h", "walk_h", "net_h").round(1),
                )
            )
            print(
                f"\nStations with positive net hours / their total, "
                f"walk speed {args.walk_speed:g} m/s"
            )
            print(sensitivity(hours))

    elif args.command == "skip":
        raw = args.data_dir / "raw"
        stops = build_stops(gtfs_zip(raw), mode.route_ids)
        hours = platform_hours(
            stops,
            stop_costs(
                stops,
                load_events(raw / "lamp", mode.route_ids),
                args.accel or mode.accel_mps2,
                args.decel or mode.decel_mps2,
            ),
            riders(stops, load_ridership(raw / RIDERSHIP_FILE, mode.route_ids)),
            # Unweighted: cells applies the walk weight
            walk_penalty(stops, args.walk_speed, 1.0),
        )
        headway = headways(raw / "lamp", mode.route_ids)
        grid = cells(hours, headway, stops, args.walk_weight, args.wait_weight)
        table = policies(grid, stops, args.min_gain)
        out = args.out or Path("results") / f"{mode.name}_skip.csv"
        out.parent.mkdir(parents=True, exist_ok=True)
        table.write_csv(out, float_precision=2)
        cells_out = out.with_name(f"{out.stem}_cells.csv")
        grid.write_csv(cells_out, float_precision=2)
        log.info("wrote %s and %s", out, cells_out)
        with pl.Config(
            tbl_rows=-1, tbl_cols=-1, tbl_width_chars=220, fmt_str_lengths=80
        ):
            if args.station:
                print(
                    station_table(grid, args.station).with_columns(
                        pl.selectors.float().round(1)
                    )
                )
                print(
                    table.filter(parent_station=args.station)
                    .select("stop_name", "verdict", "policy", "skipped", "^.*_h$")
                    .with_columns(pl.selectors.float().round(1))
                )
                return
            print(table.group_by("verdict").len().sort("verdict"))
            print(
                table.filter(verdict="partial").select(
                    "stop_name",
                    "routes",
                    "policy",
                    "skipped",
                    pl.col(
                        "gain_h",
                        "close_h",
                        "by_direction_h",
                        "alternate_h",
                        "mixed_h",
                        "oracle_h",
                    ).round(1),
                )
            )
            near = table.filter(pl.col("verdict") != "partial").sort(
                "oracle_gain_h", descending=True
            )
            print("\nMost asymmetry left on the table by binary stations (oracle gain)")
            print(
                near.head(10).select(
                    "stop_name",
                    "verdict",
                    pl.col("close_h", "mixed_h", "oracle_h", "oracle_gain_h").round(1),
                )
            )
            print(
                f"\nStations close / partial / keep, wait weight {args.wait_weight:g}"
            )
            print(
                verdict_grid(
                    hours, headway, stops, WALK_WEIGHTS, args.wait_weight, args.min_gain
                )
            )

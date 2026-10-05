import logging

import polars as pl
import pytest

from stahpthestahp.ridership import by_station, load_ridership, riders

# Routes A (P1 -> P2 -> P3) and B (P4 -> P2 -> P3), eastbound only
STOPS = pl.DataFrame(
    {
        "route_id": ["A"] * 3 + ["B"] * 3,
        "direction_id": ["1"] * 6,
        "direction_name": ["East"] * 6,
        "pattern_id": ["A-1"] * 3 + ["B-1"] * 3,
        "seq": [0, 1, 2] * 2,
        "parent_station": ["P1", "P2", "P3", "P4", "P2", "P3"],
        "junction": [False, True, False] * 2,
    },
    schema_overrides={"seq": pl.Int32},
)

COLUMNS = (
    "route_id",
    "dir_id",
    "day_type_name",
    "parent_station",
    "hour_of_service",
    "total_ons",
    "total_offs",
    "number_service_days",
    "average_flow",
)


def _csv(tmp_path, rows):
    """Ridership CSV from (route, dir, day, station, hour, ons, offs, days, flow)."""
    path = tmp_path / "ridership.csv"
    df = pl.DataFrame(rows, schema=list(COLUMNS), orient="row")
    df.with_columns(pl.format("{}:00:00", pl.col("hour_of_service"))).write_csv(path)
    return path


# Hour 08 over 10 days: A carries 10/day from P1, 4 get off at P2, 2 get on
A_ROWS = [
    ("A", "EB", "Weekday", "P1", "08", 100, 0, 10, 10),
    ("A", "EB", "Weekday", "P2", "08", 20, 40, 10, 8),
    ("A", "EB", "Weekday", "P3", "08", 0, 80, 10, 0),
]
B_ROWS = [
    ("B", "EB", "Weekday", "P4", "08", 50, 0, 10, 5),
    ("B", "EB", "Weekday", "P2", "08", 10, 0, 10, 6),
    ("B", "EB", "Weekday", "P3", "08", 0, 60, 10, 0),
]


def _riders(tmp_path, rows, routes=("A", "B")):
    stops = STOPS.filter(pl.col("route_id").is_in(routes))
    return riders(stops, load_ridership(_csv(tmp_path, rows), routes))


def test_load_keeps_weekdays_and_averages(tmp_path):
    rows = [*A_ROWS, ("A", "EB", "Saturday", "P1", "08", 999, 0, 5, 200)]
    got = load_ridership(_csv(tmp_path, rows), ("A",))
    assert got.height == 3
    p1 = got.filter(parent_station="P1").row(0, named=True)
    assert (p1["hour"], p1["ons"], p1["flow"]) == (8, 10.0, 10.0)


def test_load_divides_by_route_service_days(tmp_path):
    # P3 saw service on 5 of 10 days: its average is per weekday, not per day served
    rows = [*A_ROWS[:2], ("A", "EB", "Weekday", "P3", "08", 0, 40, 5, 0)]
    got = load_ridership(_csv(tmp_path, rows), ("A",))
    assert got.filter(parent_station="P3")["offs"].item() == pytest.approx(4.0)


def test_through_and_displaced(tmp_path):
    got = _riders(tmp_path, A_ROWS, ("A",)).filter(parent_station="P2", hour=8)
    row = got.row(0, named=True)
    # Arrive 10, 4 off, 2 on, 8 leave
    assert row["arriving"] == pytest.approx(10.0)
    assert row["through"] == pytest.approx(6.0)
    assert row["displaced"] == pytest.approx(6.0)
    assert row["on_pattern"]


def test_fills_every_hour(tmp_path):
    got = _riders(tmp_path, A_ROWS, ("A",))
    assert got.height == 3 * 24
    assert got.filter(hour=3)["displaced"].sum() == 0


def test_by_station_sums_routes(tmp_path):
    got = by_station(_riders(tmp_path, A_ROWS + B_ROWS)).filter(
        parent_station="P2", hour=8
    )
    row = got.row(0, named=True)
    assert row["routes"] == "A,B"
    assert row["through"] == pytest.approx(6.0 + 5.0)
    assert row["displaced"] == pytest.approx(6.0 + 1.0)


def test_off_pattern_rows_kept(tmp_path):
    # A trips sometimes run on to P4, which only B's pattern has
    rows = [*A_ROWS, *B_ROWS, ("A", "EB", "Weekday", "P4", "08", 0, 0, 10, 0)]
    got = _riders(tmp_path, rows).filter(route_id="A").filter(parent_station="P4")
    assert not got["on_pattern"].any()
    assert got["seq"].is_null().all()


def test_unknown_station_raises(tmp_path):
    rows = [*A_ROWS, ("A", "EB", "Weekday", "P9", "08", 1, 0, 10, 1)]
    with pytest.raises(ValueError, match="P9"):
        _riders(tmp_path, rows)


def test_unknown_direction_raises(tmp_path):
    rows = [*A_ROWS, ("A", "WB", "Weekday", "P1", "08", 1, 0, 10, 1)]
    with pytest.raises(ValueError, match="WB"):
        _riders(tmp_path, rows)


def test_pattern_station_without_ridership_raises(tmp_path):
    # STOPS has route B too, but only A has rows
    with pytest.raises(ValueError, match=r"without ridership.*P4"):
        _riders(tmp_path, A_ROWS)


def test_logs_flow_break(tmp_path, caplog):
    # P2 says 100 arrive but P1 sent 10
    rows = [
        A_ROWS[0],
        ("A", "EB", "Weekday", "P2", "08", 0, 0, 10, 100),
        ("A", "EB", "Weekday", "P3", "08", 0, 1000, 10, 0),
    ]
    with caplog.at_level(logging.WARNING):
        _riders(tmp_path, rows, ("A",))
    assert "arrive vs" in caplog.text


def test_branches_of_one_route(tmp_path, caplog):
    # Route C runs P1 -> P2 -> P3 and P4 -> P2 -> P3; ridership merges both
    stops = STOPS.with_columns(
        route_id=pl.lit("C"),
        pattern_id=pl.when(pl.col("route_id") == "A")
        .then(pl.lit("C-1"))
        .otherwise(pl.lit("C-2")),
    )
    rows = [
        ("C", "EB", "Weekday", "P1", "08", 1000, 0, 10, 100),
        ("C", "EB", "Weekday", "P4", "08", 800, 0, 10, 80),
        ("C", "EB", "Weekday", "P2", "08", 300, 400, 10, 170),
        ("C", "EB", "Weekday", "P3", "08", 0, 1700, 10, 0),
    ]
    with caplog.at_level(logging.WARNING):
        got = riders(stops, load_ridership(_csv(tmp_path, rows), ("C",)))
    # One row per station, not per pattern
    p2 = got.filter(parent_station="P2", hour=8)
    assert p2.height == 1
    assert p2["through"].item() == pytest.approx(140)
    # P2 receives flow from both P1 and P4, which isn't a break
    assert "arrive vs" not in caplog.text

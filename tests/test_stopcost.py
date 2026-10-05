import datetime as dt

import polars as pl
import pytest

from stahpthestahp.stopcost import (
    BAND,
    MIN_SAMPLES,
    band_of_hour,
    cruise_speed,
    load_events,
    stop_costs,
)

STOPS = pl.DataFrame(
    {
        "route_id": ["A"] * 3,
        "direction_id": ["0"] * 3,
        "pattern_id": ["A-1"] * 3,
        "seq": [0, 1, 2],
        "parent_station": ["P1", "P2", "P3"],
        "stop_name": ["One", "Two", "Three"],
        "dist_m": [0.0, 500.0, 900.0],
    },
    schema_overrides={"seq": pl.Int32},
)


def test_band_of_hour():
    hours = pl.Series("h", [0, 3, 4, 7, 9, 10, 16, 19, 22, 23])
    bands = pl.select(band_of_hour(pl.lit(hours))).to_series().cast(pl.String)
    assert bands.to_list() == [
        "night",
        "night",
        "early",
        "am_peak",
        "am_peak",
        "midday",
        "pm_peak",
        "evening",
        "night",
        "night",
    ]


def test_cruise_speed_round_trips():
    accel, decel, v = 1.0, 1.5, 10.0
    dist = 500.0
    time = dist / v + v / 2 * (1 / accel + 1 / decel)
    got = pl.select(cruise_speed(pl.lit(dist), pl.lit(time), accel, decel)).item()
    assert got == pytest.approx(v)


def test_cruise_speed_too_fast_gives_triangle_peak():
    # 100 m in 5 s is faster than 1 m/s^2 allows; peak = time / (1/a + 1/d)
    got = pl.select(cruise_speed(pl.lit(100.0), pl.lit(5.0), 1.0, 1.0)).item()
    assert got == pytest.approx(2.5)


def _events(rows):
    """Night events on route A direction 0 from (station, prev, travel, dwell)."""
    return pl.DataFrame(
        rows,
        schema={
            "parent_station": pl.String,
            "prev_station": pl.String,
            "travel_time_seconds": pl.Int64,
            "dwell_time_seconds": pl.Int64,
        },
        orient="row",
    ).with_columns(
        route_id=pl.lit("A"), direction_id=pl.lit("0"), band=pl.lit("night", BAND)
    )


def test_stop_costs():
    n = MIN_SAMPLES
    rows = (
        [("P2", "P1", 60, 30)] * n
        + [("P3", "P2", 50, None)] * n
        # A short turn from elsewhere does not count toward P2's run time
        + [("P2", "PX", 999, None)] * n
    )
    out = stop_costs(STOPS, _events(rows), 1.0, 1.0)
    # Only P2 has stations on both sides
    assert out["parent_station"].unique().to_list() == ["P2"]

    night = out.filter(pl.col("band").cast(pl.String) == "night").row(0, named=True)
    assert night["dwell_s"] == 30
    assert night["in_s"] == 60
    assert night["out_s"] == 50
    assert not night["fallback"]
    v_in = pl.select(cruise_speed(pl.lit(500.0), pl.lit(60.0), 1.0, 1.0)).item()
    v_out = pl.select(cruise_speed(pl.lit(400.0), pl.lit(50.0), 1.0, 1.0)).item()
    assert night["accel_loss_s"] == pytest.approx(v_in / 2 + v_out / 2)
    assert night["stop_cost_s"] == pytest.approx(30 + v_in / 2 + v_out / 2)

    # Bands without data use the all-day medians and say so
    am = out.filter(pl.col("band").cast(pl.String) == "am_peak").row(0, named=True)
    assert am["stop_cost_s"] == pytest.approx(night["stop_cost_s"])
    assert am["fallback"]


def test_load_events(tmp_path):
    # 2025-10-15 12:00 UTC is 08:00 in Boston
    t0 = int(dt.datetime(2025, 10, 15, 12, tzinfo=dt.UTC).timestamp())
    pl.DataFrame(
        {
            "service_date": [20251015] * 3,
            "route_id": ["A", "A", "Z"],
            "trip_id": ["t"] * 3,
            "vehicle_id": ["v"] * 3,
            "stop_sequence": [20, 10, 10],
            "parent_station": ["P2", "P1", "P9"],
            "stop_timestamp": [t0 + 60, t0, t0],
            "travel_time_seconds": [60, None, None],
            "dwell_time_seconds": [None, 30, None],
            "direction_id": [True, True, True],
        },
        schema_overrides={"stop_sequence": pl.Int16},
    ).write_parquet(tmp_path / "2025-10-15.parquet")

    events = load_events(tmp_path, ("A",))
    assert events["parent_station"].to_list() == ["P1", "P2"]
    assert events["prev_station"].to_list() == [None, "P1"]
    assert events["direction_id"].to_list() == ["1", "1"]
    assert events["band"].cast(pl.String).to_list() == ["am_peak", "am_peak"]

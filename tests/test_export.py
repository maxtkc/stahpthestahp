import polars as pl
import pytest

from stahpthestahp.export import dwell_histogram, patterns, stations
from stahpthestahp.score import platform_hours
from stahpthestahp.stopcost import BAND

STOPS = pl.DataFrame(
    {
        "route_id": ["A"] * 3,
        "direction_id": ["0"] * 3,
        "direction_name": ["East"] * 3,
        "pattern_id": ["A-0"] * 3,
        "seq": [0, 1, 2],
        "parent_station": ["P1", "P2", "P3"],
        "stop_name": ["One", "Two", "Three"],
        "lat": [42.0, 42.1, 42.2],
        "lon": [-71.0, -71.1, -71.2],
        "dist_m": [0.0, 400.0, 1000.0],
        "terminal": [True, False, True],
        "accessible": [True, False, True],
    },
    schema_overrides={"seq": pl.Int32},
)

RIDERS = pl.DataFrame(
    {
        "route_id": ["A"] * 2,
        "direction_id": ["0"] * 2,
        "parent_station": ["P2"] * 2,
        "seq": [1, 1],
        "on_pattern": [True, True],
        "hour": [8, 12],
        "band": ["am_peak", "midday"],
        "ons": [10.0, 4.0],
        "offs": [20.0, 6.0],
        "through": [300.0, 100.0],
        "displaced": [30.0, 10.0],
    },
    schema_overrides={"seq": pl.Int32, "band": BAND, "hour": pl.Int8},
)

COSTS = pl.DataFrame(
    {
        "route_id": ["A"] * 2,
        "direction_id": ["0"] * 2,
        "parent_station": ["P2"] * 2,
        "band": ["am_peak", "midday"],
        "stop_cost_s": [48.0, 36.0],
        "dwell_s": [40.0, 30.0],
        "accel_loss_s": [8.0, 6.0],
        "fallback": [False, False],
    },
    schema_overrides={"band": BAND},
)

# 400 m and 600 m neighbours: 240 m mean extra walk, at 1.3 m/s
WALK = pl.DataFrame(
    {
        "route_id": ["A"],
        "direction_id": ["0"],
        "parent_station": ["P2"],
        "extra_walk_m": [240.0],
        "extra_walk_s": [240.0 / 1.3],
    }
)


def test_stations_rebuild_net():
    hours = platform_hours(STOPS, COSTS, RIDERS, WALK)
    (s,) = stations(hours, STOPS, RIDERS)
    assert s["id"] == "P2"
    assert s["flags"] == []
    # The site's formula at default walk speed and weight gives rank()'s net
    net = s["dwell_h"] + s["accel_h"] - s["walk_mh"] / 1.3 * 2.0
    assert net == pytest.approx(s["net_h"], abs=1e-3)
    assert s["dwell_h"] == pytest.approx((300 * 40 + 100 * 30) / 3600, abs=1e-3)
    assert s["dirs"]["0"]["name"] == "East"
    assert s["dirs"]["0"]["ons"] == [10.0, 4.0]


def test_patterns():
    (p,) = patterns(STOPS)
    assert p["stations"] == ["P1", "P2", "P3"]
    assert p["dist_m"] == [0.0, 400.0, 1000.0]


def test_dwell_histogram():
    events = pl.DataFrame(
        {"route_id": ["A", "A", "A", "A"], "dwell_time_seconds": [3, 7, 9, 500]}
    )
    out = dwell_histogram(events)
    assert out["A"][:3] == [1, 2, 0]
    assert sum(out["A"]) == 3

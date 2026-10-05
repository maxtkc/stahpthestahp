import polars as pl
import pytest

from stahpthestahp.score import platform_hours, rank, sensitivity
from stahpthestahp.stopcost import BAND

STOPS = pl.DataFrame(
    {
        "route_id": ["A"] * 4,
        "direction_id": ["0"] * 4,
        "seq": [0, 1, 2, 3],
        "parent_station": ["P1", "P2", "P3", "P4"],
        "stop_name": ["One", "Two", "Three", "Four"],
        "terminal": [True, False, False, True],
        "hub": [False, False, True, False],
        "transfer": [False, False, True, False],
        "junction": [False] * 4,
        "trunk": [False] * 4,
        "accessible": [True] * 4,
    },
    schema_overrides={"seq": pl.Int32},
)

RIDERS = pl.DataFrame(
    {
        "route_id": ["A"] * 5,
        "direction_id": ["0"] * 5,
        "parent_station": ["P1", "P2", "P2", "P3", "P9"],
        "seq": [0, 1, 1, 2, None],
        "on_pattern": [True, True, True, True, False],
        "band": ["am_peak", "am_peak", "midday", "am_peak", "am_peak"],
        "through": [0.0, 100.0, 50.0, 200.0, 10.0],
        "displaced": [80.0, 20.0, 10.0, 30.0, 5.0],
    },
    schema_overrides={"seq": pl.Int32, "band": BAND},
)

COSTS = pl.DataFrame(
    {
        "route_id": ["A"] * 3,
        "direction_id": ["0"] * 3,
        "parent_station": ["P2", "P2", "P3"],
        "band": ["am_peak", "midday", "am_peak"],
        "stop_cost_s": [36.0, 72.0, None],
        "dwell_s": [30.0, 60.0, 20.0],
        "accel_loss_s": [6.0, 12.0, None],
        "fallback": [False, True, False],
    },
    schema_overrides={"band": BAND},
)

WALK = pl.DataFrame(
    {
        "route_id": ["A"] * 2,
        "direction_id": ["0"] * 2,
        "parent_station": ["P2", "P3"],
        "extra_walk_m": [180.0, 360.0],
        "extra_walk_s": [180.0, 360.0],
    }
)


def _hours():
    return platform_hours(STOPS, COSTS, RIDERS, WALK)


def test_platform_hours():
    out = _hours().sort("parent_station", "band")
    # Terminal P1 and off-pattern P9 are left out
    assert out["parent_station"].to_list() == ["P2", "P2", "P3"]
    assert out["saved_h"].to_list() == pytest.approx([1.0, 1.0, 0.0])
    assert out["walk_h"].to_list() == pytest.approx([1.0, 0.5, 3.0])
    assert out["cost_gap"].to_list() == [False, False, True]
    assert out["dwell_h"].to_list() == pytest.approx([30 / 36, 30 / 36, 0.0])
    assert out["accel_h"].to_list() == pytest.approx([6 / 36, 6 / 36, 0.0])
    assert out["walk_mh"].to_list() == pytest.approx([1.0, 0.5, 3.0])


def test_rank():
    out = rank(_hours(), STOPS, walk_weight=2.0)
    p2, p3 = out.iter_rows(named=True)
    assert (p2["rank"], p2["parent_station"], p2["stop_name"]) == (1, "P2", "Two")
    assert p2["saved_h"] == pytest.approx(2.0)
    assert p2["walk_h"] == pytest.approx(3.0)
    assert p2["net_h"] == pytest.approx(-1.0)
    # Through-weighted: (100 x 36 + 50 x 72) / 150
    assert p2["stop_cost_s"] == pytest.approx(48.0)
    assert p2["extra_walk_m"] == pytest.approx(180.0)
    assert p2["cost_fallback"]
    assert not p2["cost_gap"]
    assert p3["cost_gap"]
    assert p3["hub"]
    assert p3["net_h"] == pytest.approx(-6.0)


def test_sensitivity():
    grid = sensitivity(_hours())
    assert grid["walk_weight"].to_list() == [1.0, 2.0, 3.0]
    assert grid.columns == ["walk_weight", "cost x0.75", "cost x1", "cost x1.25"]
    # P2 nets 2 x scale - 1.5 x weight
    assert grid.row(0) == (1.0, "0 / 0 h", "1 / 0 h", "1 / 1 h")
    assert grid.row(1) == (2.0, "0 / 0 h", "0 / 0 h", "0 / 0 h")


def test_platform_hours_on_two_patterns_counts_riders_once():
    # P2 on two patterns of route A with different stop costs and walks
    costs = pl.concat([COSTS, COSTS.filter(parent_station="P2", band="am_peak")])
    costs = costs.with_columns(
        pl.when(pl.int_range(pl.len()) == 3)
        .then(72.0)
        .otherwise(pl.col("stop_cost_s"))
        .alias("stop_cost_s")
    )
    walk = pl.concat(
        [
            WALK,
            WALK.filter(parent_station="P2").with_columns(
                extra_walk_m=pl.lit(540.0), extra_walk_s=pl.lit(540.0)
            ),
        ]
    )
    got = platform_hours(STOPS, costs, RIDERS, walk).filter(
        parent_station="P2", band="am_peak"
    )
    assert got.height == 1
    # Mean of 36 and 72 s over 100 through riders, mean of 180 and 540 s walk
    assert got["saved_h"].item() == pytest.approx(100 * 54 / 3600)
    assert got["walk_h"].item() == pytest.approx(20 * 360 / 3600)

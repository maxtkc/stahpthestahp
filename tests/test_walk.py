import polars as pl
import pytest

from stahpthestahp.walk import extra_walk_m, walk_penalty

STOPS = pl.DataFrame(
    {
        "route_id": ["A"] * 4 + ["B"] * 3,
        "direction_id": ["0"] * 7,
        "pattern_id": ["A-1"] * 4 + ["B-1"] * 3,
        "seq": [0, 1, 2, 3, 0, 1, 2],
        "parent_station": ["P1", "P2", "P3", "P4", "P1", "P2", "Q3"],
        "stop_name": ["One", "Two", "Three", "Four", "One", "Two", "Other"],
        "dist_m": [0.0, 400.0, 1000.0, 1500.0, 0.0, 400.0, 600.0],
    },
    schema_overrides={"seq": pl.Int32},
)


def _mean_extra(prev_m, next_m, n=200_000):
    """Mean extra walk by direct sampling across the catchment."""
    total = 0.0
    for i in range(n):
        x = -prev_m / 2 + (i + 0.5) / n * (prev_m + next_m) / 2
        total += min(x + prev_m, next_m - x) - abs(x)
    return total / n


@pytest.mark.parametrize(("a", "b"), [(400.0, 600.0), (500.0, 500.0), (100.0, 900.0)])
def test_extra_walk_matches_sampling(a, b):
    got = pl.select(extra_walk_m(pl.lit(a), pl.lit(b))).item()
    assert got == pytest.approx(_mean_extra(a, b), rel=1e-4)


def test_extra_walk_zero_spacing():
    assert pl.select(extra_walk_m(pl.lit(0.0), pl.lit(0.0))).item() == 0.0


def test_walk_penalty_per_pattern():
    out = walk_penalty(STOPS, speed_mps=1.0, weight=2.0).sort("route_id", "seq")
    assert out.select("route_id", "parent_station").rows() == [
        ("A", "P2"),
        ("A", "P3"),
        ("B", "P2"),
    ]
    a2, a3, b2 = out.iter_rows(named=True)
    assert (a2["prev_m"], a2["next_m"]) == (400.0, 600.0)
    assert a2["extra_walk_m"] == pytest.approx(240.0)
    assert a2["catchment_m"] == pytest.approx(500.0)
    assert a3["extra_walk_m"] == pytest.approx(600 * 500 / 1100)
    # Same station, other branch: its own neighbours
    assert (b2["prev_m"], b2["next_m"]) == (400.0, 200.0)
    assert b2["walk_cost_s"] == pytest.approx(2 * b2["extra_walk_s"])

import polars as pl
import pytest

from stahpthestahp.skip import cells, policies, station_table, verdict_grid
from stahpthestahp.stopcost import BAND, BANDS

STOPS = pl.DataFrame(
    {
        "parent_station": ["S"] * 2 + ["T"] * 2 + ["U"] * 2,
        "direction_id": ["0", "1"] * 3,
        "direction_name": ["West", "East"] * 3,
        "stop_name": ["Ess"] * 2 + ["Tee"] * 2 + ["You"] * 2,
        "hub": [False] * 6,
        "transfer": [False] * 6,
        "junction": [False] * 6,
        "trunk": [False] * 6,
        "accessible": [True] * 6,
    }
)
# One representative hour per band
HOURS = [start for _, start in BANDS]


def _hours(saved: dict[tuple[str, str], float], walk: dict[tuple[str, str], float]):
    """platform_hours-like rows for stations S, T, U, both directions, six hours.

    saved_h and walk_h per (station, direction) are spread evenly over the
    hours, with one displaced rider per hour walking walk_h x 3600 s in all.
    """
    rows = []
    for (station, direction), s in saved.items():
        w = walk[(station, direction)]
        for hour in HOURS:
            rows.append(
                {
                    "route_id": "A",
                    "direction_id": direction,
                    "parent_station": station,
                    "hour": hour,
                    "band": next(n for n, h in BANDS if h == hour),
                    "through": 10.0,
                    "displaced": 1.0,
                    "saved_h": s / len(HOURS),
                    "walk_h": w / len(HOURS),
                    "extra_walk_s": w / len(HOURS) * 3600,
                }
            )
    return pl.DataFrame(rows, schema_overrides={"hour": pl.Int8, "band": BAND})


HEADWAY = pl.DataFrame(
    {
        "route_id": ["A"],
        "direction_id": ["0"],
        "parent_station": ["S"],
        "hour": [7],
        "headway_s": [600.0],
    },
    schema_overrides={"hour": pl.Int8},
)

# S loses in both directions, T wins in both, U wins westbound only
SAVED = {
    ("S", "0"): 6.0,
    ("S", "1"): 6.0,
    ("T", "0"): 30.0,
    ("T", "1"): 30.0,
    ("U", "0"): 30.0,
    ("U", "1"): 6.0,
}
WALK = {
    ("S", "0"): 12.0,
    ("S", "1"): 12.0,
    ("T", "0"): 6.0,
    ("T", "1"): 6.0,
    ("U", "0"): 6.0,
    ("U", "1"): 12.0,
}


def _policies(walk_weight=1.0):
    c = cells(_hours(SAVED, WALK), HEADWAY, STOPS, walk_weight, 2.0)
    return {r["parent_station"]: r for r in policies(c, STOPS).iter_rows(named=True)}


def test_cells_nets_and_alternate():
    c = cells(_hours(SAVED, WALK), HEADWAY, STOPS, walk_weight=2.0, wait_weight=2.0)
    s7 = c.filter(parent_station="S", direction_id="0", hour=7).row(0, named=True)
    assert s7["dir"] == "WB"
    assert s7["net_h"] == pytest.approx(1.0 - 2 * 2.0)
    # Walk costs 2 x 7200 s, waiting 2 x 300 s: half the saving minus the wait
    assert s7["alt_net_h"] == pytest.approx(0.5 - 600 / 3600)
    # No trains in LAMP: displaced riders walk
    s10 = c.filter(parent_station="S", direction_id="0", hour=10).row(0, named=True)
    assert s10["alt_net_h"] == pytest.approx(0.5 - 2 * 2.0)


def test_verdicts():
    p = _policies()
    assert p["S"]["verdict"] == "binary_keep"
    assert p["T"]["verdict"] == "binary_close"
    assert p["T"]["close_h"] == pytest.approx(48.0)
    u = p["U"]
    assert (u["verdict"], u["policy"]) == ("partial", "by_direction")
    assert u["skipped"] == "close WB all day"
    assert u["by_direction_h"] == pytest.approx(24.0)
    assert u["gain_h"] == pytest.approx(24.0 - 18.0)


def test_band_asymmetry_picks_by_band():
    hours = _hours(SAVED, WALK).with_columns(
        pl.when(pl.col("band") == "am_peak")
        .then(pl.col("saved_h") * 20)
        .otherwise(pl.col("saved_h"))
        .alias("saved_h")
    )
    p = policies(cells(hours, HEADWAY, STOPS, 1.0, 2.0), STOPS).filter(
        parent_station="S"
    )
    r = p.row(0, named=True)
    assert (r["verdict"], r["policy"]) == ("partial", "by_band")
    assert r["skipped"] == "close EB am_peak; close WB am_peak"
    assert r["by_band_h"] == pytest.approx(2 * (20.0 - 2.0))


def test_policy_ordering():
    for r in _policies(2.0).values():
        assert r["oracle_h"] >= r["mixed_h"] - 1e-9
        assert r["mixed_h"] >= max(r["by_dir_band_h"], r["alternate_h"]) - 1e-9
        assert r["by_dir_band_h"] >= max(r["by_band_h"], r["by_direction_h"]) - 1e-9


def test_verdict_grid_and_station_table():
    grid = verdict_grid(_hours(SAVED, WALK), HEADWAY, STOPS, (1.0, 2.0), 2.0)
    assert grid.columns == ["walk_weight", "cost x0.5", "cost x1"]
    # U's eastbound loses at any cost, so it stays partial
    assert grid.row(0) == (1.0, "1 / 1 / 1", "1 / 1 / 1")
    c = cells(_hours(SAVED, WALK), HEADWAY, STOPS, 1.0, 2.0)
    table = station_table(c, "U")
    assert table.height == len(HOURS)
    assert "net_h_WB" in table.columns
    with pytest.raises(ValueError, match="no cells"):
        station_table(c, "X")

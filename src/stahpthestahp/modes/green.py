"""Green Line: the B, C, D and E branches."""

from stahpthestahp.modes import Mode

MODE = Mode(
    name="green",
    route_ids=("Green-B", "Green-C", "Green-D", "Green-E"),
    # About 3 mph/s, the Type 8/9 LRV service rates
    accel_mps2=1.3,
    decel_mps2=1.3,
)

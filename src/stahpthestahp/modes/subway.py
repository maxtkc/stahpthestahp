"""Subway: the Red, Orange and Blue heavy rail lines."""

from stahpthestahp.modes import Mode

MODE = Mode(
    name="subway",
    route_ids=("Red", "Orange", "Blue"),
    # About 3 mph/s, heavy rail service rates
    accel_mps2=1.3,
    decel_mps2=1.3,
)

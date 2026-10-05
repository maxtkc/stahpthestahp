"""Per-mode specifics, looked up by name."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Mode:
    name: str
    route_ids: tuple[str, ...]
    # Service acceleration and braking rates, m/s^2
    accel_mps2: float
    decel_mps2: float


MODE_NAMES = ("green", "subway")


def get_mode(name: str) -> Mode:
    from stahpthestahp.modes import green, subway

    modes = {m.name: m for m in (green.MODE, subway.MODE)}
    if name not in modes:
        raise ValueError(f"unknown mode {name!r}, expected one of {sorted(modes)}")
    return modes[name]

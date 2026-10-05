import pytest

from stahpthestahp.modes import get_mode


def test_green_routes():
    assert get_mode("green").route_ids == ("Green-B", "Green-C", "Green-D", "Green-E")


def test_subway_routes():
    assert get_mode("subway").route_ids == ("Red", "Orange", "Blue")


def test_unknown_mode():
    with pytest.raises(ValueError, match="unknown mode"):
        get_mode("monorail")

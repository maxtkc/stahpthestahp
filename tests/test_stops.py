import zipfile

import pytest

from stahpthestahp.stops import build_stops, distances_along

# Two branches A and B share P1 and P2, then split to P3 and P4.
# Route R (heavy rail, another line) also stops at P1 and P3. Route C has
# both branches as two typical patterns of one route.
GTFS = {
    "route_patterns.txt": """\
route_pattern_id,route_id,direction_id,route_pattern_typicality,representative_trip_id
A-1,A,0,1,a0
A-2,A,0,3,ax
B-1,B,0,1,b0
C-1,C,0,1,c1
C-2,C,0,1,c2
R-1,R,0,1,r0
""",
    "trips.txt": """\
route_id,trip_id,shape_id
A,a0,sa
A,ax,sa
B,b0,sb
C,c1,sa
C,c2,sb
R,r0,sr
""",
    "routes.txt": """\
route_id,route_type,line_id
A,0,L
B,0,L
C,1,L
R,1,X
""",
    "directions.txt": """\
route_id,direction_id,direction
A,0,West
B,0,West
C,0,West
R,0,South
""",
    "stops.txt": """\
stop_id,stop_name,stop_lat,stop_lon,parent_station,wheelchair_boarding
P1,One,42.0,-71.000,,1
P2,Two,42.0,-71.001,,1
P3,Three,42.0,-71.002,,1
P4,Four,42.001,-71.001,,1
p1,One,42.0,-71.000,P1,0
p2,Two,42.0,-71.001,P2,1
p3,Three,42.0,-71.002,P3,2
p4,Four,42.001,-71.001,P4,
r1,One,42.0,-71.000,P1,1
r3,Three,42.0,-71.002,P3,1
""",
    "stop_times.txt": """\
trip_id,stop_id,stop_sequence
a0,p1,10
a0,p2,20
a0,p3,30
b0,p1,10
b0,p2,20
b0,p4,30
c1,p1,1
c1,p2,2
c1,p3,3
c2,p1,1
c2,p2,2
c2,p4,3
r0,r1,1
r0,r3,2
""",
    "shapes.txt": """\
shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence
sa,42.0,-71.000,1
sa,42.0,-71.002,2
sb,42.0,-71.000,1
sb,42.0,-71.001,2
sb,42.001,-71.001,3
sr,42.0,-71.000,1
sr,42.0,-71.002,2
""",
}


@pytest.fixture
def gtfs(tmp_path):
    path = tmp_path / "gtfs.zip"
    with zipfile.ZipFile(path, "w") as z:
        for name, text in GTFS.items():
            z.writestr(name, text)
    return path


def test_distances_along_never_goes_back():
    shape = [(0.0, 0.0), (0.0, 0.01), (0.0, 0.0)]  # out and back
    dist = distances_along(shape, [(0.0, 0.008), (0.0, 0.003)])
    assert dist[0] == pytest.approx(890, abs=1)
    # Matched on the way back, not behind the first stop on the way out
    assert dist[1] == pytest.approx(1112 + 779, abs=1)


def test_build_stops(gtfs):
    table = build_stops(gtfs, ("A", "B"))
    a = table.filter(route_id="A")
    assert a["parent_station"].to_list() == ["P1", "P2", "P3"]
    assert a["seq"].to_list() == [0, 1, 2]
    assert a["dist_m"].to_list() == pytest.approx([0, 82.6, 165.3], abs=0.2)
    assert a["direction_name"].to_list() == ["West"] * 3
    assert a["pattern_id"].to_list() == ["A-1"] * 3

    flags = {
        r["parent_station"]: r
        for r in table.unique("parent_station").iter_rows(named=True)
    }
    assert {s for s in flags if flags[s]["terminal"]} == {"P1", "P3", "P4"}
    assert {s for s in flags if flags[s]["junction"]} == {"P2"}
    # p1 inherits from its parent, p4 is blank and inherits too
    assert {s for s in flags if flags[s]["accessible"]} == {"P1", "P2", "P4"}


def test_build_stops_unknown_route(gtfs):
    with pytest.raises(ValueError, match="no typical route pattern"):
        build_stops(gtfs, ("A", "Z"))


def test_build_stops_branches_of_one_route(gtfs):
    table = build_stops(gtfs, ("C", "R"))
    c = table.filter(route_id="C")
    assert c.select("pattern_id", "seq", "parent_station").rows() == [
        ("C-1", 0, "P1"),
        ("C-1", 1, "P2"),
        ("C-1", 2, "P3"),
        ("C-2", 0, "P1"),
        ("C-2", 1, "P2"),
        ("C-2", 2, "P4"),
    ]
    flags = {
        r["parent_station"]: r
        for r in table.unique("parent_station").iter_rows(named=True)
    }
    # R shares P1 with C but is another line, so P1 isn't a junction
    assert {s for s in flags if flags[s]["junction"]} == {"P2"}

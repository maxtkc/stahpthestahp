import datetime as dt
import hashlib
import json

import httpx
import pytest

from stahpthestahp.fetch import Cache, gtfs_feed_url, lamp_weekday_urls

ARCHIVE = """feed_start_date,feed_end_date,feed_version,archive_url,archive_note
20251021,20251027,"Fall 2025, v2",https://x/20251021.zip,
20251014,20251020,"Fall 2025, v1",https://x/20251014.zip,
"""

INDEX = """size_bytes,last_modified,service_date,file_url
1,2026-01-09,2025-10-10,https://x/2025-10-10.parquet
1,2026-01-09,2025-10-11,https://x/2025-10-11.parquet
1,2026-01-09,2025-10-13,https://x/2025-10-13.parquet
1,2026-01-09,2025-10-20,https://x/2025-10-20.parquet
"""


def test_gtfs_feed_url():
    assert gtfs_feed_url(ARCHIVE, dt.date(2025, 10, 15)) == "https://x/20251014.zip"
    with pytest.raises(LookupError):
        gtfs_feed_url(ARCHIVE, dt.date(2025, 9, 1))


def test_lamp_weekday_urls_skips_weekends_and_out_of_window():
    urls = lamp_weekday_urls(INDEX, dt.date(2025, 10, 11), dt.date(2025, 10, 19))
    assert urls == {dt.date(2025, 10, 13): "https://x/2025-10-13.parquet"}


def test_cache_records_manifest_and_skips_cached(tmp_path):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, content=b"hello")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        path = Cache(tmp_path, client).get("a/b.txt", "https://x/b.txt")
        Cache(tmp_path, client).get("a/b.txt", "https://x/b.txt")

    assert path.read_bytes() == b"hello"
    assert calls == ["https://x/b.txt"]
    entry = json.loads((tmp_path / "manifest.json").read_text())["a/b.txt"]
    assert entry["url"] == "https://x/b.txt"
    assert entry["sha256"] == hashlib.sha256(b"hello").hexdigest()


def test_cache_leaves_no_file_on_http_error(tmp_path):
    transport = httpx.MockTransport(lambda _: httpx.Response(404))
    with httpx.Client(transport=transport) as client, pytest.raises(httpx.HTTPError):
        Cache(tmp_path, client).get("b.txt", "https://x/b.txt")
    assert not (tmp_path / "b.txt").exists()
    assert not (tmp_path / "manifest.json").exists()

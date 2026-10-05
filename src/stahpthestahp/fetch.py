"""Download raw inputs into data/raw/ with a manifest of URL, fetch time and sha256."""

import csv
import datetime as dt
import hashlib
import io
import json
import logging
from pathlib import Path

import httpx
import polars as pl

log = logging.getLogger(__name__)

# Fall 2025 ridership rating window
WINDOW_START = dt.date(2025, 8, 24)
WINDOW_END = dt.date(2025, 12, 13)
# Mid-window weekday whose GTFS feed stands in for the whole window
GTFS_DATE = dt.date(2025, 10, 15)

GTFS_ARCHIVE_URL = "https://cdn.mbta.com/archive/archived_feeds.txt"
LAMP_INDEX_URL = (
    "https://performancedata.mbta.com/lamp/subway-on-time-performance-v1/index.csv"
)
RIDERSHIP_URL = (
    "https://www.arcgis.com/sharing/rest/content/items/"
    "6494749a29c648018820d0e49636205c/data"
)

MANIFEST = "manifest.json"
RIDERSHIP_FILE = "ridership/fall_2025_rail_by_hour.csv"


def gtfs_feed_url(archive_csv: str, date: dt.date) -> str:
    """Archive URL of the most recent feed whose service range covers date."""
    key = date.strftime("%Y%m%d")
    for row in csv.DictReader(io.StringIO(archive_csv)):
        if row["feed_start_date"] <= key <= row["feed_end_date"]:
            return row["archive_url"]
    raise LookupError(f"no archived GTFS feed covers {date}")


def weekdays(start: dt.date, end: dt.date) -> list[dt.date]:
    """Mondays to Fridays between start and end inclusive."""
    days = (start + dt.timedelta(n) for n in range((end - start).days + 1))
    return [d for d in days if d.weekday() < 5]


def lamp_weekday_urls(
    index_csv: str, start: dt.date, end: dt.date
) -> dict[dt.date, str]:
    """LAMP parquet URLs for weekdays between start and end inclusive."""
    urls = {}
    for row in csv.DictReader(io.StringIO(index_csv)):
        day = dt.date.fromisoformat(row["service_date"])
        if start <= day <= end and day.weekday() < 5:
            urls[day] = row["file_url"]
    return dict(sorted(urls.items()))


class Cache:
    """Files under root, recorded in root/manifest.json."""

    def __init__(self, root: Path, client: httpx.Client) -> None:
        self.root = root
        self.client = client
        self.manifest_path = root / MANIFEST
        self.manifest: dict[str, dict[str, str]] = (
            json.loads(self.manifest_path.read_text())
            if self.manifest_path.exists()
            else {}
        )

    def get(self, rel: str, url: str, refresh: bool = False) -> Path:
        """Download url to root/rel unless already cached from the same url."""
        path = self.root / rel
        entry = self.manifest.get(rel)
        if not refresh and path.exists() and entry and entry["url"] == url:
            log.debug("cached %s", rel)
            return path
        log.info("fetching %s", url)
        path.parent.mkdir(parents=True, exist_ok=True)
        part = path.with_name(path.name + ".part")
        digest = hashlib.sha256()
        with self.client.stream("GET", url) as resp, part.open("wb") as f:
            resp.raise_for_status()
            for chunk in resp.iter_bytes():
                digest.update(chunk)
                f.write(chunk)
        part.replace(path)
        self.manifest[rel] = {
            "url": url,
            "fetched": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "sha256": digest.hexdigest(),
        }
        self._save()
        return path

    def _save(self) -> None:
        self.manifest_path.write_text(
            json.dumps(self.manifest, indent=2, sort_keys=True) + "\n"
        )


def log_ridership_fields(path: Path, route_ids: tuple[str, ...]) -> None:
    """Log the ridership CSV columns and the values that matter for route_ids."""
    df = pl.read_csv(path)
    log.info("ridership columns: %s", ", ".join(df.columns))
    rows = df.filter(pl.col("route_id").is_in(route_ids))
    if rows.is_empty():
        raise ValueError(f"ridership has no rows for {route_ids}")
    for col in ("route_id", "dir_id", "day_type_name", "hour_of_service"):
        values = rows[col].unique().sort().to_list()
        log.info("ridership %s: %s", col, ", ".join(map(str, values)))
    log.info(
        "ridership: %d rows, %d stops for %s",
        rows.height,
        rows["parent_station"].n_unique(),
        ", ".join(route_ids),
    )


def fetch(raw_dir: Path, route_ids: tuple[str, ...], client: httpx.Client) -> None:
    """Fetch GTFS, LAMP OTP and ridership for the Fall 2025 window."""
    cache = Cache(raw_dir, client)

    # Index files are re-fetched so new or moved feeds are picked up
    archive = cache.get("gtfs/archived_feeds.txt", GTFS_ARCHIVE_URL, refresh=True)
    feed_url = gtfs_feed_url(archive.read_text(), GTFS_DATE)
    cache.get(f"gtfs/{Path(feed_url).name}", feed_url)

    index = cache.get("lamp/index.csv", LAMP_INDEX_URL, refresh=True)
    lamp_urls = lamp_weekday_urls(index.read_text(), WINDOW_START, WINDOW_END)
    log.info(
        "LAMP: %d weekdays between %s and %s", len(lamp_urls), WINDOW_START, WINDOW_END
    )
    missing = [d for d in weekdays(WINDOW_START, WINDOW_END) if d not in lamp_urls]
    if missing:
        log.warning("LAMP index lacks weekdays: %s", ", ".join(map(str, missing)))
    for day, url in lamp_urls.items():
        cache.get(f"lamp/{day.isoformat()}.parquet", url)

    log_ridership_fields(cache.get(RIDERSHIP_FILE, RIDERSHIP_URL), route_ids)

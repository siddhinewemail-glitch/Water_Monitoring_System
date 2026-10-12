from datetime import datetime, timedelta, timezone
from functools import lru_cache

import pandas as pd
from supabase import Client, create_client

from . import config


@lru_cache
def client() -> Client:
    if not config.SUPABASE_URL or not config.SUPABASE_SECRET_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set in backend/.env")
    return create_client(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY)


def _to_frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    if not df.empty:
        df["created_at"] = pd.to_datetime(df["created_at"], utc=True, format="ISO8601")
        df = df.sort_values(["device_id", "created_at"]).reset_index(drop=True)
    return df


def fetch_readings(since: datetime, device_id: str | None = None, page_size: int = 1000) -> pd.DataFrame:
    """All readings since `since`, paging through PostgREST's row cap."""
    rows: list[dict] = []
    start = 0
    while True:
        q = (
            client().table(config.READINGS_TABLE).select("*")
            .gte("created_at", since.isoformat())
            .order("id")
            .range(start, start + page_size - 1)
        )
        if device_id:
            q = q.eq("device_id", device_id)
        batch = q.execute().data
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return _to_frame(rows)


def fetch_recent(hours: float, device_id: str | None = None) -> pd.DataFrame:
    return fetch_readings(datetime.now(timezone.utc) - timedelta(hours=hours), device_id)


def last_scored_reading_id() -> int:
    res = (
        client().table(config.PREDICTIONS_TABLE).select("reading_id")
        .order("reading_id", desc=True).limit(1).execute()
    )
    return res.data[0]["reading_id"] if res.data else 0


def upsert_predictions(rows: list[dict]) -> None:
    if rows:
        client().table(config.PREDICTIONS_TABLE).upsert(rows, on_conflict="reading_id").execute()


def latest_prediction(device_id: str) -> dict | None:
    res = (
        client().table(config.PREDICTIONS_TABLE).select("*")
        .eq("device_id", device_id).order("created_at", desc=True).limit(1).execute()
    )
    return res.data[0] if res.data else None

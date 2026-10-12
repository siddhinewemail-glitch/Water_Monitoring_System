import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config, db
from .ml import models
from .ml.features import ANOMALY_FEATURES
from .ml.quality import quality, adc_to_ppm

log = logging.getLogger("water")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def supabase_configured() -> bool:
    return bool(config.SUPABASE_URL and config.SUPABASE_SECRET_KEY)


def score_once() -> int:
    last = db.last_scored_reading_id()
    ctx = db.fetch_recent(hours=3)
    if ctx.empty:
        return 0

    # Ensure water_quality_data has tds_ppm and tds_voltage populated
    missing = ctx[ctx["tds_ppm"].isna() & ctx["tds_adc"].notna()]
    if not missing.empty:
        for _, row in missing.iterrows():
            adc = row["tds_adc"]
            temp = row.get("temperature")
            v = round(float(adc) / 4095.0 * 3.3, 3)
            ppm = adc_to_ppm(adc, temp)
            if not np.isnan(ppm):
                try:
                    db.client().table(config.READINGS_TABLE).update({
                        "tds_voltage": v,
                        "tds_ppm": round(float(ppm), 1)
                    }).eq("id", int(row["id"])).execute()
                except Exception:
                    pass

    if not (ctx["id"] > last).any():
        return 0
    preds = models.score(ctx, after_id=last)
    db.upsert_predictions(preds)
    return len(preds)


def train_from_db(days: int = 7) -> dict:
    raw = db.fetch_recent(hours=days * 24) if supabase_configured() else pd.DataFrame()
    return models.train(raw)


async def scoring_worker():
    while True:
        try:
            n = await asyncio.to_thread(score_once)
            if n:
                log.info("Scored %d new readings", n)
        except Exception:
            log.exception("Scoring pass failed")
        await asyncio.sleep(config.SCORE_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not models.store.loaded():
        log.info("No model on disk; training initial model")
        try:
            meta = await asyncio.to_thread(train_from_db)
            log.info("Initial model trained: %s", meta)
        except Exception:
            log.exception("Initial training failed")
    task = None
    if supabase_configured():
        task = asyncio.create_task(scoring_worker())
    else:
        log.warning("Supabase not configured; background scoring disabled")
    yield
    if task:
        task.cancel()


app = FastAPI(title="Water Quality ML API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"],
)


def require_admin(x_admin_token: str = Header(default="")):
    if not config.ADMIN_TOKEN or x_admin_token != config.ADMIN_TOKEN:
        raise HTTPException(401, "Invalid admin token")


def require_db():
    if not supabase_configured():
        raise HTTPException(503, "Supabase is not configured on the server")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": models.store.loaded(),
        "supabase_configured": supabase_configured(),
    }


@app.get("/api/model")
def model_info():
    try:
        return models.store.get()["meta"]
    except RuntimeError as e:
        raise HTTPException(404, str(e))


class TrainRequest(BaseModel):
    days: int = Field(7, ge=1, le=90)


@app.post("/api/model/train", dependencies=[Depends(require_admin)])
async def retrain(req: TrainRequest):
    return await asyncio.to_thread(train_from_db, req.days)


@app.post("/api/score", dependencies=[Depends(require_admin), Depends(require_db)])
async def score_now():
    return {"scored": await asyncio.to_thread(score_once)}


class PointRequest(BaseModel):
    tds_ppm: float = Field(..., ge=0, le=5000)
    temperature: float = Field(..., ge=-10, le=60)


@app.post("/api/predict")
def predict(req: PointRequest):
    """What-if check for a single value. With no history, deltas are taken as 0,
    so this only catches values that are unusual on their own."""
    score, label = quality(req.tds_ppm, req.temperature)
    anomaly = None
    try:
        x = pd.DataFrame([[req.tds_ppm, req.temperature, 0.0, 0.0, 0.0]], columns=ANOMALY_FEATURES)
        d = float(models.store.get()["anomaly"].decision_function(x)[0])
        anomaly = {"is_anomaly": d < 0, "anomaly_score": round(-d, 4)}
    except RuntimeError:
        pass
    return {"quality_score": score, "quality_label": label, "anomaly": anomaly}


def _stats(s: pd.Series) -> dict | None:
    s = s.dropna()
    if s.empty:
        return None
    return {k: round(float(v), 2) for k, v in
            {"min": s.min(), "max": s.max(), "mean": s.mean(), "std": s.std() if len(s) > 1 else 0}.items()}


@app.get("/api/devices/{device_id}/summary", dependencies=[Depends(require_db)])
def device_summary(device_id: str, hours: float = 24):
    df = db.fetch_recent(hours, device_id)
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    preds = (
        db.client().table(config.PREDICTIONS_TABLE)
        .select("is_anomaly,sensor_fault")
        .eq("device_id", device_id).gte("created_at", since).execute().data
    )
    if not df.empty:
        df = models.ensure_ppm(df)
    latest = None
    if not df.empty:
        r = df.iloc[-1].replace({np.nan: None})
        latest = {k: r.get(k) for k in ("id", "tds_ppm", "temperature", "water_status")}
        latest["created_at"] = df.iloc[-1]["created_at"].isoformat()
    return {
        "device_id": device_id,
        "window_hours": hours,
        "readings": int(len(df)),
        "tds_ppm": _stats(df["tds_ppm"]) if not df.empty else None,
        "temperature": _stats(df["temperature"]) if not df.empty else None,
        "anomalies": sum(1 for p in preds if p["is_anomaly"]),
        "faulty_readings": sum(1 for p in preds if p["sensor_fault"]),
        "latest_reading": latest,
        "latest_prediction": db.latest_prediction(device_id),
    }

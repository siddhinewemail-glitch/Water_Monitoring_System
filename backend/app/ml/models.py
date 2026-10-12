"""Training and inference for the two learned models.

1. Anomaly detector  - IsolationForest over point + short-window features.
   Unsupervised, so it works without labelled contamination events.
2. TDS forecaster    - gradient-boosted regressor predicting TDS 60 min ahead
   from lagged values on a 1-minute grid. Falls back to a linear trend when
   there isn't enough recent history to build the lag features.
"""
import threading
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, IsolationForest
from sklearn.metrics import mean_absolute_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .. import config
from . import synthetic
from .features import (
    ANOMALY_FEATURES, FORECAST_FEATURES, FORECAST_HORIZON,
    anomaly_frame, forecast_frame, resample,
)
from .quality import ensure_ppm, quality, sensor_faults

MODEL_PATH = config.MODEL_DIR / "bundle.joblib"
MIN_FORECAST_ROWS = 300


def _prepare(df: pd.DataFrame) -> pd.DataFrame:
    """Add tds_ppm (for legacy rows) and per-device sensor_fault column."""
    df = ensure_ppm(df)
    df["sensor_fault"] = None
    for _, idx in df.groupby("device_id").groups.items():
        df.loc[idx, "sensor_fault"] = sensor_faults(df.loc[idx])
    return df


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["sensor_fault"].isna() & df["tds_ppm"].notna() & df["temperature"].notna()]


def train(raw: pd.DataFrame) -> dict:
    df = _prepare(raw) if not raw.empty else raw
    clean = _clean(df) if not raw.empty else raw
    source = "real"
    if len(clean) < config.MIN_TRAIN_ROWS:
        source = "synthetic"
        clean = _clean(_prepare(synthetic.generate()))

    # --- anomaly model ---
    feats = pd.concat([anomaly_frame(g) for _, g in clean.groupby("device_id")]).dropna()
    anomaly = make_pipeline(
        StandardScaler(),
        IsolationForest(n_estimators=200, contamination=0.02, random_state=0),
    ).fit(feats[ANOMALY_FEATURES])

    # --- forecast model ---
    frames = [forecast_frame(resample(g), with_target=True) for _, g in clean.groupby("device_id")]
    ff = pd.concat(frames).dropna()
    forecast, metrics = None, {}
    forecast_kind = "trend"
    if len(ff) >= MIN_FORECAST_ROWS:
        # Learn the *change* over the horizon; absolute levels drift between refills
        # and a tree model can't extrapolate to levels it hasn't seen.
        ff["delta"] = ff["target"] - ff["lag_1"]
        split = int(len(ff) * 0.8)
        tr, te = ff.iloc[:split], ff.iloc[split:]
        m = _forecaster().fit(tr[FORECAST_FEATURES], tr["delta"])
        model_mae = mean_absolute_error(te["target"], te["lag_1"] + m.predict(te[FORECAST_FEATURES]))
        # Persistence = "next hour equals now". The model must beat this to be useful.
        persistence_mae = mean_absolute_error(te["target"], te["lag_1"])
        metrics = {
            "forecast_mae_ppm": round(float(model_mae), 2),
            "persistence_mae_ppm": round(float(persistence_mae), 2),
        }
        if model_mae < persistence_mae:
            forecast = _forecaster().fit(ff[FORECAST_FEATURES], ff["delta"])
            forecast_kind = "hgbr"
        else:
            forecast_kind = "persistence"

    meta = {
        "version": datetime.now(timezone.utc).strftime("v%Y%m%d-%H%M%S"),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "trained_on": source,
        "anomaly_rows": int(len(feats)),
        "forecast_rows": int(len(ff)),
        "forecast_model": forecast_kind,
        "forecast_horizon_min": FORECAST_HORIZON,
        **metrics,
    }
    bundle = {"anomaly": anomaly, "forecast": forecast, "meta": meta}
    joblib.dump(bundle, MODEL_PATH)
    store.set(bundle)
    return meta


def _forecaster() -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, random_state=0)


def _trend_forecast(grid: pd.DataFrame) -> float | None:
    s = grid["tds_ppm"].dropna().tail(30)
    if len(s) < 5:
        return None
    slope = np.polyfit(np.arange(len(s)), s.values, 1)[0]
    return float(max(0.0, s.iloc[-1] + slope * FORECAST_HORIZON))


def _forecast_latest(bundle: dict, device_df: pd.DataFrame) -> float | None:
    clean = _clean(device_df)
    if clean.empty:
        return None
    grid = resample(clean)
    kind = bundle["meta"]["forecast_model"]
    if kind == "persistence":
        return float(grid["tds_ppm"].dropna().iloc[-1])
    model = bundle.get("forecast")
    if model is not None:
        row = forecast_frame(grid, with_target=False).iloc[[-1]]
        if row[FORECAST_FEATURES].notna().all(axis=None):
            delta = model.predict(row[FORECAST_FEATURES])[0]
            return float(max(0.0, row["lag_1"].iloc[0] + delta))
    return _trend_forecast(grid)


def score(context: pd.DataFrame, after_id: int = 0) -> list[dict]:
    """Score readings with id > after_id. `context` should include earlier rows
    so rolling features and fault windows have history."""
    bundle = store.get()
    if context.empty:
        return []
    df = _prepare(context)
    out: list[dict] = []
    for device_id, g in df.groupby("device_id"):
        feats = anomaly_frame(g)
        ok = g["sensor_fault"].isna() & feats[ANOMALY_FEATURES].notna().all(axis=1)
        dec = pd.Series(np.nan, index=g.index)
        if ok.any():
            dec[ok] = bundle["anomaly"].decision_function(feats.loc[ok, ANOMALY_FEATURES])

        new = g[g["id"] > after_id]
        if new.empty:
            continue
        latest_forecast = _forecast_latest(bundle, g)
        last_id = new["id"].iloc[-1]
        for idx, r in new.iterrows():
            q_score, q_label = quality(r["tds_ppm"], r["temperature"])
            d = dec[idx]
            out.append({
                "reading_id": int(r["id"]),
                "device_id": device_id,
                "quality_score": q_score,
                "quality_label": q_label if r["sensor_fault"] is None else None,
                "is_anomaly": None if np.isnan(d) else bool(d < 0),
                "anomaly_score": None if np.isnan(d) else round(float(-d), 4),
                "sensor_fault": r["sensor_fault"],
                "forecast_tds_ppm": round(latest_forecast, 1)
                    if r["id"] == last_id and latest_forecast is not None else None,
                "model_version": bundle["meta"]["version"],
            })
    return out


class _Store:
    def __init__(self):
        self._lock = threading.Lock()
        self._bundle: dict | None = None

    def set(self, bundle: dict) -> None:
        with self._lock:
            self._bundle = bundle

    def get(self) -> dict:
        with self._lock:
            if self._bundle is None:
                if MODEL_PATH.exists():
                    self._bundle = joblib.load(MODEL_PATH)
                else:
                    raise RuntimeError("No trained model yet. POST /api/model/train first.")
            return self._bundle

    def loaded(self) -> bool:
        try:
            self.get()
            return True
        except RuntimeError:
            return False


store = _Store()

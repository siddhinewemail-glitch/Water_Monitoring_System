import numpy as np
import pandas as pd

from app.ml import models, synthetic
from app.ml.quality import adc_to_ppm, quality, sensor_faults


def test_quality_bands():
    assert quality(100, 25) == (93.3, "EXCELLENT")
    assert quality(700, 25)[1] == "FAIR"
    assert quality(5000, 25) == (0.0, "UNSAFE")
    assert quality(None, 25) == (None, None)
    # warm water penalty
    assert quality(100, 35)[0] < quality(100, 25)[0]


def test_adc_zero_is_no_signal():
    # The user's current serial output: ADC 0 must not be reported as clean water.
    assert np.isnan(adc_to_ppm(0, 30.69))
    df = pd.DataFrame({"tds_adc": [0, 0, 1200], "temperature": [30.69, np.nan, 85.0]})
    assert list(sensor_faults(df)) == ["TDS_NO_SIGNAL", "TDS_NO_SIGNAL,TEMP_DISCONNECTED", "TEMP_RESET_VALUE"]


def test_train_and_score_on_synthetic(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "MODEL_PATH", tmp_path / "bundle.joblib")
    meta = models.train(pd.DataFrame())
    assert meta["trained_on"] == "synthetic"
    # Only the learned model is used if it beats the naive "no change" baseline.
    assert meta["forecast_model"] in ("hgbr", "persistence")
    if meta["forecast_model"] == "hgbr":
        assert meta["forecast_mae_ppm"] < meta["persistence_mae_ppm"]

    ctx = synthetic.generate(days=1, device_id="esp32-test", seed=7).tail(200).copy()
    ctx.loc[ctx.index[-1], "tds_ppm"] = 1800.0  # sudden spike
    preds = models.score(ctx, after_id=int(ctx["id"].iloc[-6]))
    assert len(preds) == 5
    assert preds[-1]["is_anomaly"] is True
    assert preds[-1]["forecast_tds_ppm"] is not None

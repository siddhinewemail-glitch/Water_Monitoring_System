import numpy as np
import pandas as pd

ANOMALY_FEATURES = ["tds_ppm", "temperature", "tds_delta", "temp_delta", "tds_roll_std"]

# Forecasting works on a regular 1-minute grid.
FORECAST_FREQ = "1min"
FORECAST_HORIZON = 60  # minutes ahead
FORECAST_LAGS = [1, 2, 3, 5, 10, 15, 30]
FORECAST_FEATURES = (
    [f"lag_{l}" for l in FORECAST_LAGS]
    + ["roll_mean_15", "roll_std_15", "slope_30", "temperature", "hour_sin", "hour_cos"]
)


def anomaly_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Point features for one device, time-ordered. Rows with NaNs are left in; caller filters."""
    out = pd.DataFrame(index=df.index)
    out["tds_ppm"] = df["tds_ppm"]
    out["temperature"] = df["temperature"]
    out["tds_delta"] = df["tds_ppm"].diff()
    out["temp_delta"] = df["temperature"].diff()
    out["tds_roll_std"] = df["tds_ppm"].rolling(6, min_periods=3).std()
    return out


def resample(df: pd.DataFrame) -> pd.DataFrame:
    """One device -> 1-minute grid of tds_ppm/temperature, short gaps interpolated."""
    s = (
        df.set_index("created_at")[["tds_ppm", "temperature"]]
        .resample(FORECAST_FREQ).mean()
        .interpolate(limit=5)
    )
    return s


def _slope(w: np.ndarray) -> float:
    if np.isnan(w).any():
        return np.nan
    return float(np.polyfit(np.arange(len(w)), w, 1)[0])


def forecast_frame(grid: pd.DataFrame, with_target: bool) -> pd.DataFrame:
    tds = grid["tds_ppm"]
    out = pd.DataFrame(index=grid.index)
    for l in FORECAST_LAGS:
        out[f"lag_{l}"] = tds.shift(l - 1)  # lag_1 = current value
    out["roll_mean_15"] = tds.rolling(15).mean()
    out["roll_std_15"] = tds.rolling(15).std()
    out["slope_30"] = tds.rolling(30).apply(_slope, raw=True)
    out["temperature"] = grid["temperature"]
    hour = grid.index.hour + grid.index.minute / 60
    out["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    out["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    if with_target:
        out["target"] = tds.shift(-FORECAST_HORIZON)
    return out

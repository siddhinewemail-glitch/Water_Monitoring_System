"""Domain rules: TDS conversion, quality index and sensor-fault detection.

These are deliberately rule-based. With only TDS + temperature there are no
ground-truth labels to learn "quality" from, so the label comes from WHO/BIS
TDS bands. ML is used where rules fall short: anomalies and forecasting.
"""
import numpy as np
import pandas as pd

ADC_FLOOR = 5          # matches firmware: <= this means no signal
ADC_CEIL = 4090        # ADC saturated
FLATLINE_WINDOW = 30   # identical consecutive ADC values => stuck sensor
DS18B20_RESET_C = 85.0 # value the DS18B20 reports before its first conversion

# (upper bound ppm, label, score at lower bound, score at upper bound)
TDS_BANDS = [
    (300, "EXCELLENT", 100, 80),
    (600, "GOOD", 80, 60),
    (900, "FAIR", 60, 40),
    (1200, "POOR", 40, 20),
    (2000, "UNSAFE", 20, 0),
]


def adc_to_ppm(adc: float, temperature: float | None, k: float = 1.0) -> float:
    """Same DFRobot formula as the firmware, for legacy rows that only have tds_adc."""
    if adc is None or np.isnan(adc) or adc <= ADC_FLOOR:
        return np.nan
    v = adc / 4095 * 3.3
    t = 25.0 if temperature is None or np.isnan(temperature) else temperature
    v = v / (1.0 + 0.02 * (t - 25.0))
    return float((133.42 * v**3 - 255.86 * v**2 + 857.39 * v) * 0.5 * k)


def ensure_ppm(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if "tds_ppm" not in df:
        df["tds_ppm"] = np.nan
    df["tds_ppm"] = pd.to_numeric(df["tds_ppm"], errors="coerce")
    df["temperature"] = pd.to_numeric(df["temperature"], errors="coerce")
    missing = df["tds_ppm"].isna()
    if missing.any():
        df.loc[missing, "tds_ppm"] = [
            adc_to_ppm(a, t) for a, t in zip(df.loc[missing, "tds_adc"], df.loc[missing, "temperature"])
        ]
    return df


def quality(tds_ppm: float | None, temperature: float | None) -> tuple[float | None, str | None]:
    """0-100 score (higher is better) and band label."""
    if tds_ppm is None or np.isnan(tds_ppm):
        return None, None
    lower = 0
    score, label = 0.0, "UNSAFE"
    for upper, band, s_lo, s_hi in TDS_BANDS:
        if tds_ppm < upper:
            frac = (tds_ppm - lower) / (upper - lower)
            score, label = s_lo + (s_hi - s_lo) * frac, band
            break
        lower = upper
    # Warm water favours microbial growth; small penalty above 30 C.
    if temperature is not None and not np.isnan(temperature) and temperature > 30:
        score -= min(10.0, (temperature - 30) * 2)
    return round(max(0.0, min(100.0, score)), 1), label


def sensor_faults(df: pd.DataFrame) -> pd.Series:
    """Per-row fault string (None if healthy). df must be one device, time-ordered."""
    adc = pd.to_numeric(df["tds_adc"], errors="coerce")
    temp = pd.to_numeric(df["temperature"], errors="coerce")
    flat = adc.rolling(FLATLINE_WINDOW).apply(lambda w: float(np.ptp(w) == 0), raw=True) == 1

    faults = []
    for a, t, f in zip(adc, temp, flat):
        issues = []
        if np.isnan(a) or a <= ADC_FLOOR:
            issues.append("TDS_NO_SIGNAL")
        elif a >= ADC_CEIL:
            issues.append("TDS_SATURATED")
        elif f:
            issues.append("TDS_FLATLINE")
        if np.isnan(t):
            issues.append("TEMP_DISCONNECTED")
        elif t == DS18B20_RESET_C:
            issues.append("TEMP_RESET_VALUE")
        faults.append(",".join(issues) or None)
    return pd.Series(faults, index=df.index, dtype=object)

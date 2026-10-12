"""Synthetic bootstrap data.

Used ONLY to train first-version models before the real sensor has produced
enough clean history. Model metadata records `trained_on: synthetic` so this is
never mistaken for a model fitted on your tank.
"""
import numpy as np
import pandas as pd


def generate(days: int = 7, device_id: str = "synthetic", seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n = days * 24 * 60  # one reading per minute
    t = pd.date_range(end=pd.Timestamp.now(tz="UTC").floor("min"), periods=n, freq="1min")
    hours = np.asarray(t.hour + t.minute / 60)

    temperature = 28 + 2.5 * np.sin(2 * np.pi * (hours - 9) / 24) + rng.normal(0, 0.15, n)

    # Evaporation slowly concentrates solids; periodic refills reset it.
    tds = np.empty(n)
    level = 250.0
    for i in range(n):
        level += 0.004 + rng.normal(0, 0.05)
        if i % (36 * 60) == 0 and i:  # refill every 36 h
            level = 240 + rng.normal(0, 10)
        tds[i] = level
    tds = tds * (1 + 0.02 * (temperature - 25)) * 0.98 + rng.normal(0, 3, n)

    # A few injected contamination events (sharp step + decay) for realism.
    for start in rng.choice(np.arange(600, n - 200), size=4, replace=False):
        bump = rng.uniform(250, 600)
        tds[start:start + 120] += bump * np.exp(-np.arange(120) / 40)

    return pd.DataFrame({
        "id": np.arange(n),
        "created_at": t,
        "device_id": device_id,
        "tds_adc": np.clip(tds * 2.2, 6, 4089).astype(int),
        "tds_ppm": np.clip(tds, 0, None),
        "temperature": temperature,
    })

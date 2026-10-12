# IoT Water Quality Monitoring System

ESP32 + TDS probe + DS18B20 → Supabase → Python ML service → React dashboard.

```
┌──────────────┐  HTTPS POST every 10 s   ┌───────────────────────────┐
│ ESP32        │ ───────────────────────▶ │ Supabase (Postgres)       │
│ TDS + DS18B20│   publishable key        │  water_quality_data       │
└──────────────┘   (insert-only RLS)      │  ml_predictions           │
                                          └───────┬──────────▲────────┘
                         Realtime (websocket)     │          │ secret key
                    ┌─────────────────────────────┘          │ read + write
                    ▼                                        │
┌──────────────────────────┐   REST (model info,  ┌──────────┴────────────┐
│ React (Vite) dashboard   │ ───────────────────▶ │ FastAPI + scikit-learn│
│ live cards, chart, alerts│   what-if predict)   │  scoring worker (30 s)│
└──────────────────────────┘                      │  anomaly + forecast   │
                                                  └───────────────────────┘
```

| Folder | What |
|---|---|
| `firmware/water_monitor/` | Arduino sketch for ESP32 (upgraded from the original) |
| `supabase/schema.sql` | Tables, RLS policies, realtime publication |
| `backend/` | FastAPI ML service (Python 3.10+) |
| `frontend/` | React dashboard (Vite) |

## Setup

### 1. Supabase
1. Dashboard → SQL Editor → paste and run `supabase/schema.sql`.
2. Dashboard → Project Settings → API Keys: copy the **publishable** key (ESP32 + frontend) and a **secret** key (backend only).

### 2. Firmware
1. Arduino IDE → install *esp32* board package (v3.x) and libraries *OneWire*, *DallasTemperature*.
2. Edit `firmware/water_monitor/secrets.h` (put the publishable key in `SUPABASE_KEY`).
3. Wiring:
   - TDS module: VCC → 3V3, GND → GND, A → GPIO34
   - DS18B20: VDD → 3V3, GND → GND, DQ → GPIO4, **4.7 kΩ resistor DQ ↔ 3V3**
4. Calibrate: put the probe in a known solution, set `TDS_K = known_ppm / measured_ppm`.

### 3. Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
copy .env.example .env          # then fill in SUPABASE_SECRET_KEY and ADMIN_TOKEN
uvicorn app.main:app --reload --port 8000
```
API docs: http://localhost:8000/docs. Tests: `pytest -q`.

On first start, with no real history, it trains on **synthetic** data so the
pipeline works end to end. After about a day of real readings, retrain:
```bash
curl -X POST http://localhost:8000/api/model/train -H "X-Admin-Token: <ADMIN_TOKEN>" -H "Content-Type: application/json" -d "{\"days\": 7}"
```

### 4. Frontend
```bash
cd frontend
npm install
copy .env.example .env.local    # set VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev                     # http://localhost:5173
```

## What the ML does (and why)

With only TDS + temperature and no lab-labelled samples, a supervised
"is this water safe?" classifier would just learn back the thresholds you
already have. So:

| Task | Method | Why |
|---|---|---|
| Quality label/score | Rules (WHO/BIS TDS bands + warm-water penalty) | No ground-truth labels; rules are transparent |
| Sensor fault detection | Rules (no signal, saturation, flatline, DS18B20 85 °C) | Catches hardware issues like the current `TDS ADC: 0` |
| **Anomaly detection** | IsolationForest on TDS, temp, deltas, rolling std | Unsupervised: learns *your tank's* normal behaviour and flags contamination spikes |
| **TDS forecast (+60 min)** | HistGradientBoosting on lagged 1-min features; linear-trend fallback | Early warning before TDS crosses a threshold; evaluated against a "no change" baseline |

To get to supervised water-potability classification, add pH and turbidity
sensors and record lab-test results as labels.

## Production notes
- The publishable key on the ESP32 lets anyone holding it insert rows. For production, give each device its own token and insert through a Supabase Edge Function that verifies it.
- Replace `client.setInsecure()` with the Supabase root CA certificate.

## Deploy on Render (free tier)

`render.yaml` defines both services: the API (free web service) and the dashboard (free static site).

1. Render dashboard → **New → Blueprint** → connect this GitHub repo → **Apply**.
2. Fill in the prompted variables:
   - `water-quality-api`: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CORS_ORIGINS` = dashboard URL
   - `water-quality-dashboard`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL` = API URL

   Service URLs are `https://<service-name>.onrender.com`. If a name is taken, Render adds a suffix; update the two cross-URLs and redeploy.
3. In Supabase SQL Editor, run `supabase/cron.sql` (with your API URL and `ADMIN_TOKEN` filled in) so scoring runs every minute.

Free-tier limits:
- The API sleeps after 15 min without requests; the Supabase cron call wakes it (first request after sleep takes ~1 min).
- The disk is wiped on every restart or deploy, so the model retrains automatically on startup (a few seconds).
- 750 free instance-hours/month. One always-awake service uses ~744 h, so keep only one free web service on the account.

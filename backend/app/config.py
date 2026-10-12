import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
SCORE_INTERVAL_SECONDS = int(os.getenv("SCORE_INTERVAL_SECONDS", "30"))
MIN_TRAIN_ROWS = int(os.getenv("MIN_TRAIN_ROWS", "500"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(exist_ok=True)

READINGS_TABLE = "water_quality_data"
PREDICTIONS_TABLE = "ml_predictions"

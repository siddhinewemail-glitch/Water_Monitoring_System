import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configured = Boolean(url && key && !key.includes("xxxx"));
export const supabase = configured ? createClient(url, key) : null;

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const DEVICE_ID = import.meta.env.VITE_DEVICE_ID || "esp32-tank-01";

export async function api(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export const STATUS_COLORS = {
  EXCELLENT: "var(--good)",
  GOOD: "var(--good)",
  FAIR: "var(--warn)",
  POOR: "var(--bad)",
  UNSAFE: "var(--bad)",
};

export const fmt = (v, digits = 1) =>
  v === null || v === undefined || isNaN(v) ? "—" : Number(v).toFixed(digits);

export const time = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Calculate voltage from ESP32 12-bit ADC (3.3V reference)
export function adcToVoltage(adc) {
  if (adc === null || adc === undefined) return null;
  return Number(((Number(adc) / 4095) * 3.3).toFixed(3));
}

// DFRobot Gravity TDS formula with temperature compensation to 25°C
export function adcToPpm(adc, temperature = 25.0, k = 1.0) {
  if (adc === null || adc === undefined) return null;
  const numAdc = Number(adc);
  if (numAdc <= 5) return 0.0; // Probe in air or disconnected
  const rawV = (numAdc / 4095) * 3.3;
  const t = temperature !== null && temperature !== undefined ? Number(temperature) : 25.0;
  const comp = 1.0 + 0.02 * (t - 25.0);
  const v = rawV / comp;
  const ppm = (133.42 * v * v * v - 255.86 * v * v + 857.39 * v) * 0.5 * k;
  return Number(Math.max(0, ppm).toFixed(1));
}

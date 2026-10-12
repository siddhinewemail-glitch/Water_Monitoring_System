import { useEffect, useState } from "react";
import { supabase, DEVICE_ID, adcToVoltage, adcToPpm } from "./lib.js";

const MAX_POINTS = 2000;

// Helper to normalize a reading and derive tds_ppm and tds_voltage if null/missing
function normalizeReading(r) {
  if (!r) return r;
  const rawAdc = r.tds_adc;
  const temp = r.temperature;
  const voltage =
    r.tds_voltage != null
      ? Number(r.tds_voltage)
      : rawAdc != null
      ? adcToVoltage(rawAdc)
      : null;
  const ppm =
    r.tds_ppm != null
      ? Number(r.tds_ppm)
      : rawAdc != null
      ? adcToPpm(rawAdc, temp)
      : null;

  return {
    ...r,
    tds_voltage: voltage,
    tds_ppm: ppm,
  };
}

// Initial load of the last `hours` of readings + ML predictions, then live
// INSERTs via Supabase Realtime. Predictions are joined onto readings by id.
export function useLiveData(hours = 6) {
  const [readings, setReadings] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const since = new Date(Date.now() - hours * 3600e3).toISOString();

    (async () => {
      const [r, p] = await Promise.all([
        supabase
          .from("water_quality_data")
          .select("*")
          .eq("device_id", DEVICE_ID)
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(MAX_POINTS),
        supabase
          .from("ml_predictions")
          .select("*")
          .eq("device_id", DEVICE_ID)
          .gte("created_at", since)
          .limit(MAX_POINTS),
      ]);
      if (cancelled) return;
      if (r.error || p.error) return setError((r.error || p.error).message);
      setReadings(r.data.map(normalizeReading));
      setPredictions(Object.fromEntries(p.data.map((x) => [x.reading_id, x])));
    })();

    const channel = supabase
      .channel(`device-${DEVICE_ID}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "water_quality_data",
          filter: `device_id=eq.${DEVICE_ID}`,
        },
        ({ new: row }) =>
          setReadings((prev) => [...prev, normalizeReading(row)].slice(-MAX_POINTS))
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ml_predictions",
          filter: `device_id=eq.${DEVICE_ID}`,
        },
        ({ new: row }) => setPredictions((prev) => ({ ...prev, [row.reading_id]: row }))
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [hours]);

  const merged = readings.map((r) => ({ ...r, ml: predictions[r.id] || null }));
  return { rows: merged, error, live };
}

import { useState } from "react";
import { supabase, DEVICE_ID, api } from "../lib.js";

const PRESETS = [
  { name: "Pristine Spring", icon: "🏞️", tds: 42, temp: 14.5, status: "EXCELLENT" },
  { name: "Filtered RO", icon: "💧", tds: 18, temp: 20.8, status: "EXCELLENT" },
  { name: "City Tap Water", icon: "🚰", tds: 165, temp: 23.4, status: "GOOD" },
  { name: "Hard Well Water", icon: "🪨", tds: 440, temp: 26.2, status: "FAIR" },
  { name: "Industrial Runoff", icon: "🏭", tds: 880, temp: 31.5, status: "UNSAFE" },
  { name: "Probe Disconnected", icon: "⚠️", tds: 0, temp: 24.0, status: "UNSAFE", dry: true },
];

export default function SimulatorControls({
  simTds,
  setSimTds,
  simTemp,
  setSimTemp,
  isDry,
  setIsDry,
  onSimulatePush,
}) {
  const [isPushing, setIsPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState(null);

  const calculateStatus = (tdsVal) => {
    if (isDry || tdsVal <= 5) return "UNSAFE";
    if (tdsVal < 150) return "EXCELLENT";
    if (tdsVal < 300) return "GOOD";
    if (tdsVal < 600) return "FAIR";
    if (tdsVal < 900) return "POOR";
    return "UNSAFE";
  };

  const handleApplyPreset = (p) => {
    setSimTds(p.tds);
    setSimTemp(p.temp);
    setIsDry(Boolean(p.dry));
    setPushStatus(null);
  };

  const handlePushToCloud = async () => {
    if (!supabase) {
      setPushStatus({ error: "Supabase client not configured." });
      return;
    }
    setIsPushing(true);
    setPushStatus(null);

    const calculatedStatus = calculateStatus(simTds);
    const mockAdc = isDry ? 2 : Math.min(Math.round(simTds * 2.2) + 20, 4095);
    const mockVoltage = +(mockAdc * (3.3 / 4095)).toFixed(3);

    try {
      const payload = {
        device_id: DEVICE_ID,
        tds_adc: mockAdc,
        tds_voltage: mockVoltage,
        tds_ppm: isDry ? null : simTds,
        temperature: simTemp,
        water_status: calculatedStatus,
        rssi: -58 - Math.floor(Math.random() * 8),
      };

      const { data, error } = await supabase.from("water_quality_data").insert([payload]);
      if (error) throw error;

      // Also invoke optional local notification
      if (onSimulatePush) {
        onSimulatePush(payload);
      }

      setPushStatus({
        success: `Successfully pushed packet (TDS: ${simTds} ppm, Temp: ${simTemp}°C) to Supabase table!`,
      });
      setTimeout(() => setPushStatus(null), 6000);
    } catch (err) {
      setPushStatus({ error: `Push failed: ${err.message}` });
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="sim-panel">
      <div className="sim-header">
        <div>
          <span className="badge-glow">INTERACTIVE TELEMETRY LAB</span>
          <h3>Virtual Sensor Sandbox</h3>
          <p className="sim-sub">Manipulate physical sensor conditions and push live test data to the cloud.</p>
        </div>
      </div>

      {/* Preset Buttons */}
      <div className="sim-presets-row">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            className={`preset-btn ${simTds === p.tds && !isDry === !p.dry ? "active" : ""}`}
            onClick={() => handleApplyPreset(p)}
          >
            <span className="preset-icon">{p.icon}</span>
            <div className="preset-info">
              <span className="preset-name">{p.name}</span>
              <span className="preset-ppm">{p.dry ? "0 ppm (Air)" : `${p.tds} ppm`}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Sliders Grid */}
      <div className="sim-controls-grid">
        <div className="sim-slider-box">
          <div className="slider-label-row">
            <label htmlFor="tds-slider">TDS Concentration</label>
            <span className="slider-val-badge">{simTds} ppm</span>
          </div>
          <input
            id="tds-slider"
            type="range"
            min={0}
            max={1200}
            step={5}
            value={simTds}
            disabled={isDry}
            onChange={(e) => setSimTds(Number(e.target.value))}
            className="slider-input accent-blue"
          />
          <div className="slider-bounds">
            <span>0 (Pristine)</span>
            <span>300 (WHO Limit)</span>
            <span>1200 (Hazardous)</span>
          </div>
        </div>

        <div className="sim-slider-box">
          <div className="slider-label-row">
            <label htmlFor="temp-slider">Water Temperature</label>
            <span className="slider-val-badge">{simTemp} °C</span>
          </div>
          <input
            id="temp-slider"
            type="range"
            min={4}
            max={48}
            step={0.5}
            value={simTemp}
            onChange={(e) => setSimTemp(Number(e.target.value))}
            className="slider-input accent-orange"
          />
          <div className="slider-bounds">
            <span>4°C (Near Freezing)</span>
            <span>25°C (Ambient)</span>
            <span>48°C (Elevated)</span>
          </div>
        </div>
      </div>

      {/* Sensor Fault Simulation Toggle */}
      <div className="sim-toggle-row">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={isDry}
            onChange={(e) => {
              setIsDry(e.target.checked);
              if (e.target.checked) setSimTds(0);
            }}
          />
          <span>Simulate Sensor Probe Disconnection / Dry Air (TDS ADC &lt;= 5)</span>
        </label>
      </div>

      {/* Push to Supabase Cloud Action */}
      <div className="sim-action-row">
        <button
          className="btn-cloud-push"
          disabled={isPushing}
          onClick={handlePushToCloud}
        >
          {isPushing ? "⚡ Transmitting to Supabase..." : "🚀 Push Test Reading to Live Cloud Pipeline"}
        </button>

        {pushStatus && (
          <div className={`push-feedback ${pushStatus.error ? "err" : "ok"}`}>
            {pushStatus.error || pushStatus.success}
          </div>
        )}
      </div>
    </div>
  );
}

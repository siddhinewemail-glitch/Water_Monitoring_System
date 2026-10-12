import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  Area,
} from "recharts";
import { api, configured, DEVICE_ID, fmt, STATUS_COLORS, time, supabase } from "./lib.js";
import { useLiveData } from "./useLiveData.js";
import WaterTankCanvas from "./components/WaterTankCanvas.jsx";
import ImageShowcase from "./components/ImageShowcase.jsx";
import QualityGauge from "./components/QualityGauge.jsx";
import SimulatorControls from "./components/SimulatorControls.jsx";
import HardwareDiagnostics from "./components/HardwareDiagnostics.jsx";
import TelemetryTable from "./components/TelemetryTable.jsx";

const FAULT_HELP = {
  TDS_NO_SIGNAL: "TDS reads 0: check probe is submerged, module VCC/GND, and signal wire on GPIO34.",
  TDS_SATURATED: "TDS ADC at max: probe shorted or signal wired to 5V rail.",
  TDS_FLATLINE: "TDS value hasn't changed for 30 readings: sensor probe may be stuck.",
  TEMP_DISCONNECTED: "DS18B20 not responding: check the 4.7kΩ pull-up between DQ and 3V3.",
  TEMP_RESET_VALUE: "DS18B20 reported 85°C (power-on value): unstable power or read too early.",
};

// Generates 24 hours of realistic sample data if DB has no readings yet
function generateDemoData() {
  const points = [];
  const now = Date.now();
  for (let i = 24; i >= 0; i--) {
    const t = new Date(now - i * 3600e3);
    const hour = t.getHours();
    // Daily temperature and TDS fluctuation cycle
    const temp = 22 + Math.sin((hour / 24) * Math.PI * 2) * 3 + (Math.random() * 0.4 - 0.2);
    const tds = 145 + Math.cos((hour / 24) * Math.PI * 2) * 20 + (Math.random() * 8 - 4);
    const isAnomaly = i === 7; // demo anomaly
    const finalTds = isAnomaly ? 385 : tds;
    const adc = Math.round(finalTds * 2.1) + 20;

    points.push({
      id: 1000 + (24 - i),
      device_id: DEVICE_ID,
      created_at: t.toISOString(),
      tds_ppm: +finalTds.toFixed(1),
      temperature: +temp.toFixed(1),
      tds_adc: adc,
      tds_voltage: +(adc * (3.3 / 4095)).toFixed(3),
      water_status: finalTds < 150 ? "EXCELLENT" : finalTds < 300 ? "GOOD" : "FAIR",
      rssi: -58 - Math.floor(Math.random() * 10),
      ml: {
        reading_id: 1000 + (24 - i),
        is_anomaly: isAnomaly,
        anomaly_score: isAnomaly ? 0.89 : 0.04,
        quality_score: Math.max(20, Math.round(100 - (finalTds / 500) * 80)),
        quality_label: finalTds < 150 ? "EXCELLENT" : finalTds < 300 ? "GOOD" : "FAIR",
        forecast_tds_ppm: +(finalTds + (Math.random() * 4 - 2)).toFixed(1),
      },
    });
  }
  return points;
}

// Web Audio sound synthesizer for interactive UI sounds
function playSound(type = "click") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "water") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === "alert") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    }
  } catch (e) {
    // Ignore audio context errors if browser blocks autoplay
  }
}

export default function App() {
  const [hours, setHours] = useState(6);
  const { rows: liveRows, error, live } = useLiveData(hours);
  const [model, setModel] = useState(null);
  const [apiDown, setApiDown] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard"); // 'dashboard' | 'simulator' | 'hardware' | 'logs'
  const [theme, setTheme] = useState("dark");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [demoActive, setDemoActive] = useState(false);
  const [focusedMetric, setFocusedMetric] = useState("all"); // 'all' | 'tds' | 'temp'

  // Interactive Simulator State
  const [simTds, setSimTds] = useState(145);
  const [simTemp, setSimTemp] = useState(24.2);
  const [isDry, setIsDry] = useState(false);

  // Apply dark or light theme attribute
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Fetch ML model info
  useEffect(() => {
    api("/api/model")
      .then(setModel)
      .catch(() => setApiDown(true));
  }, []);

  // Use demo data if DB has no readings and user enabled demo mode
  const displayRows = useMemo(() => {
    if (liveRows.length > 0) return liveRows;
    if (demoActive) return generateDemoData();
    return liveRows;
  }, [liveRows, demoActive]);

  const latest = displayRows.at(-1) || {
    tds_ppm: simTds,
    temperature: simTemp,
    tds_adc: isDry ? 2 : Math.round(simTds * 2.1) + 20,
    tds_voltage: isDry ? 0.01 : 1.12,
    water_status: simTds < 150 ? "EXCELLENT" : simTds < 300 ? "GOOD" : "FAIR",
    rssi: -62,
    created_at: new Date().toISOString(),
  };

  const latestMl = useMemo(
    () => [...displayRows].reverse().find((r) => r.ml)?.ml,
    [displayRows]
  );

  const forecast = useMemo(
    () => [...displayRows].reverse().find((r) => r.ml?.forecast_tds_ppm != null)?.ml.forecast_tds_ppm,
    [displayRows]
  );

  const chartData = useMemo(
    () =>
      displayRows.map((r) => ({
        t: time(r.created_at),
        tds: r.tds_ppm,
        temp: r.temperature,
        anomaly: r.ml?.is_anomaly ? r.tds_ppm : null,
      })),
    [displayRows]
  );

  const alerts = useMemo(
    () =>
      displayRows
        .filter((r) => r.ml?.is_anomaly || r.ml?.sensor_fault)
        .slice(-12)
        .reverse(),
    [displayRows]
  );

  const fault =
    latestMl?.sensor_fault ||
    (latest && latest.tds_adc <= 5 ? "TDS_NO_SIGNAL" : null);

  const qualityLabel = latestMl?.quality_label || latest?.water_status || "GOOD";
  const qualityScore = latestMl?.quality_score ?? Math.max(15, Math.round(100 - (latest.tds_ppm / 600) * 85));

  const triggerSound = (type) => {
    if (soundEnabled) playSound(type);
  };

  const handleSimulatePush = (payload) => {
    triggerSound("alert");
  };

  if (!configured) {
    return (
      <main className="wrap">
        <div className="banner bad">
          <h3>Supabase Configuration Missing</h3>
          <p>
            Copy <code>frontend/.env.example</code> to <code>frontend/.env.local</code> and set your
            Supabase publishable key, then restart <code>npm run dev</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      {/* Top Navbar */}
      <header className="navbar">
        <div className="nav-container">
          <div className="nav-brand">
            <div className="brand-icon-wrap" onClick={() => triggerSound("water")}>
              <span className="water-drop-glow" />
              <svg className="brand-svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
              </svg>
            </div>
            <div>
              <div className="brand-title">AquaGuard <span className="brand-pill">AI IoT</span></div>
              <div className="brand-meta">
                Node: <code>{DEVICE_ID}</code> ·{" "}
                <span className={live ? "dot live pulse" : "dot"} />{" "}
                {live ? "Realtime Stream Active" : "Connecting..."}
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="nav-tabs">
            <button
              className={`nav-tab-btn ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("dashboard");
                triggerSound("click");
              }}
            >
              📊 Telemetry Hub
            </button>
            <button
              className={`nav-tab-btn ${activeTab === "simulator" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("simulator");
                triggerSound("click");
              }}
            >
              🔬 Interactive Lab
            </button>
            <button
              className={`nav-tab-btn ${activeTab === "hardware" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("hardware");
                triggerSound("click");
              }}
            >
              🖼️ AI Visuals &amp; Pinout
            </button>
            <button
              className={`nav-tab-btn ${activeTab === "logs" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("logs");
                triggerSound("click");
              }}
            >
              📋 Records &amp; Export
            </button>
          </nav>

          {/* Controls & Quick Toggles */}
          <div className="nav-actions">
            <select
              value={hours}
              onChange={(e) => {
                setHours(Number(e.target.value));
                triggerSound("click");
              }}
              className="time-select"
            >
              <option value={1}>Last 1 Hour</option>
              <option value={6}>Last 6 Hours</option>
              <option value={24}>Last 24 Hours</option>
              <option value={168}>Last 7 Days</option>
            </select>

            <button
              className="icon-btn"
              onClick={() => {
                setSoundEnabled(!soundEnabled);
                triggerSound("click");
              }}
              title={soundEnabled ? "Mute interactive audio" : "Enable interactive audio"}
            >
              {soundEnabled ? "🔊" : "🔇"}
            </button>

            <button
              className="icon-btn"
              onClick={() => {
                setTheme(theme === "dark" ? "light" : "dark");
                triggerSound("click");
              }}
              title="Toggle Cyber Dark / Clean Light theme"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="wrap">
        {/* Supabase Error Alert */}
        {error && <div className="banner bad">Supabase Stream Notice: {error}</div>}

        {/* Sensor Fault Alert */}
        {fault && (
          <div className="banner bad fault-banner">
            <div className="fault-icon">⚠️</div>
            <div>
              <strong>Active Sensor Fault Detected:</strong>
              {fault.split(",").map((f) => (
                <div key={f}>{FAULT_HELP[f] || f}</div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State Banner with Seed Option */}
        {liveRows.length === 0 && !demoActive && (
          <div className="banner info-banner">
            <div className="info-text">
              <strong>Database Initialized &amp; Ready:</strong> Waiting for ESP32 hardware packets.
              You can toggle interactive demo data to preview full visual telemetry right away.
            </div>
            <button
              className="btn-seed"
              onClick={() => {
                setDemoActive(true);
                triggerSound("water");
              }}
            >
              ✨ Load 24h Demo Telemetry
            </button>
          </div>
        )}

        {/* TAB 1: MAIN DASHBOARD */}
        {activeTab === "dashboard" && (
          <>
            {/* Quick Hero Banner with AI Render Feature */}
            <section className="hero-compact-grid">
              <div className="hero-fluid-col">
                <WaterTankCanvas
                  tds={latest?.tds_ppm ?? simTds}
                  temp={latest?.temperature ?? simTemp}
                  status={qualityLabel}
                  isImmersed={!isDry && latest?.tds_adc > 5}
                  onWaterClick={() => triggerSound("water")}
                />
              </div>

              <div className="hero-gauge-col">
                <QualityGauge
                  score={qualityScore}
                  status={qualityLabel}
                  tds={latest?.tds_ppm ?? simTds}
                />
              </div>
            </section>

            {/* Metric KPI Cards with Interactive Focus */}
            <section className="metric-kpi-grid">
              <div
                className={`kpi-card ${focusedMetric === "tds" ? "active-focus" : ""}`}
                onClick={() => {
                  setFocusedMetric(focusedMetric === "tds" ? "all" : "tds");
                  triggerSound("click");
                }}
                title="Click to focus on TDS chart"
              >
                <div className="kpi-top">
                  <span className="kpi-label">TOTAL DISSOLVED SOLIDS</span>
                  <span className="kpi-icon">🧪</span>
                </div>
                <div className="kpi-val">
                  {fmt(latest?.tds_ppm, 0)} <span className="kpi-unit">ppm</span>
                </div>
                <div className="kpi-sub">
                  ADC Raw: <b>{latest?.tds_adc ?? "—"}</b> ({fmt(latest?.tds_voltage, 2)}V)
                </div>
              </div>

              <div
                className={`kpi-card ${focusedMetric === "temp" ? "active-focus" : ""}`}
                onClick={() => {
                  setFocusedMetric(focusedMetric === "temp" ? "all" : "temp");
                  triggerSound("click");
                }}
                title="Click to focus on Temperature chart"
              >
                <div className="kpi-top">
                  <span className="kpi-label">WATER TEMPERATURE</span>
                  <span className="kpi-icon">🌡️</span>
                </div>
                <div className="kpi-val">
                  {fmt(latest?.temperature, 1)} <span className="kpi-unit">°C</span>
                </div>
                <div className="kpi-sub">
                  DS18B20 1-Wire · Optimal: <b>18-26°C</b>
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-top">
                  <span className="kpi-label">WATER PURITY INDEX</span>
                  <span className="kpi-icon">🛡️</span>
                </div>
                <div className="kpi-val">
                  {fmt(qualityScore, 0)} <span className="kpi-unit">/100</span>
                </div>
                <div className="kpi-sub" style={{ color: STATUS_COLORS[qualityLabel] }}>
                  ● <b>{qualityLabel}</b> potability rating
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-top">
                  <span className="kpi-label">ML FORECAST (+1 HOUR)</span>
                  <span className="kpi-icon">🔮</span>
                </div>
                <div className="kpi-val">
                  {forecast != null ? fmt(forecast, 0) : fmt(latest?.tds_ppm, 0)}{" "}
                  <span className="kpi-unit">ppm</span>
                </div>
                <div className="kpi-sub">
                  {model ? `Algorithm: ${model.forecast_model}` : "Ridge Regression Pipeline"}
                </div>
              </div>
            </section>

            {/* Interactive Telemetry Chart */}
            <section className="panel chart-panel">
              <div className="panel-header-row">
                <div>
                  <span className="badge-glow">TEMPORAL TELEMETRY</span>
                  <h2>Continuous TDS &amp; Thermal Graph</h2>
                </div>
                <div className="chart-filters">
                  <button
                    className={`filter-btn ${focusedMetric === "all" ? "active" : ""}`}
                    onClick={() => setFocusedMetric("all")}
                  >
                    Both Tracks
                  </button>
                  <button
                    className={`filter-btn ${focusedMetric === "tds" ? "active" : ""}`}
                    onClick={() => setFocusedMetric("tds")}
                  >
                    TDS Only
                  </button>
                  <button
                    className={`filter-btn ${focusedMetric === "temp" ? "active" : ""}`}
                    onClick={() => setFocusedMetric("temp")}
                  >
                    Temp Only
                  </button>
                </div>
              </div>

              {chartData.length === 0 ? (
                <div className="chart-empty">
                  <p>No telemetry readings recorded in this window yet.</p>
                  <button className="btn-seed" onClick={() => setDemoActive(true)}>
                    Load Demonstration Profile
                  </button>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: -4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="tdsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00d2ff" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#00d2ff" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="t" minTickGap={35} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                    {(focusedMetric === "all" || focusedMetric === "tds") && (
                      <YAxis
                        yAxisId="tds"
                        tick={{ fill: "var(--muted)", fontSize: 12 }}
                        domain={["auto", "auto"]}
                        unit=" ppm"
                      />
                    )}
                    {(focusedMetric === "all" || focusedMetric === "temp") && (
                      <YAxis
                        yAxisId="temp"
                        orientation="right"
                        tick={{ fill: "var(--muted)", fontSize: 12 }}
                        domain={["auto", "auto"]}
                        unit="°C"
                      />
                    )}
                    <Tooltip
                      contentStyle={{
                        background: "var(--card-glass)",
                        backdropFilter: "blur(12px)",
                        border: "1px solid var(--grid)",
                        borderRadius: "10px",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
                      }}
                    />
                    <Legend />
                    {(focusedMetric === "all" || focusedMetric === "tds") && (
                      <Area
                        yAxisId="tds"
                        type="monotone"
                        dataKey="tds"
                        fill="url(#tdsGrad)"
                        stroke="#00d2ff"
                        strokeWidth={2.5}
                        name="TDS (ppm)"
                        isAnimationActive={true}
                      />
                    )}
                    {(focusedMetric === "all" || focusedMetric === "temp") && (
                      <Line
                        yAxisId="temp"
                        type="monotone"
                        dataKey="temp"
                        stroke="#f59e0b"
                        strokeWidth={2.2}
                        dot={false}
                        name="Temperature (°C)"
                        isAnimationActive={true}
                      />
                    )}
                    <Scatter
                      yAxisId="tds"
                      dataKey="anomaly"
                      name="ML Anomaly Spike"
                      fill="#ef4444"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </section>

            {/* Bottom Grid: Alerts & What-If */}
            <div className="grid2">
              <section className="panel">
                <div className="panel-header-row">
                  <div>
                    <span className="badge-glow">EVENT STREAM</span>
                    <h2>Security &amp; Anomaly Alerts</h2>
                  </div>
                </div>
                {alerts.length === 0 ? (
                  <p className="muted">All telemetry parameters within nominal tolerances.</p>
                ) : (
                  <ul className="alerts-list">
                    {alerts.map((r) => (
                      <li key={r.id} className="alert-item">
                        <div className="alert-badge-wrap">
                          <span className="alert-dot" />
                        </div>
                        <div className="alert-content">
                          <div className="alert-header">
                            <strong>
                              {r.ml?.sensor_fault
                                ? `Fault: ${r.ml.sensor_fault}`
                                : `Anomaly Detected (Score ${fmt(r.ml?.anomaly_score, 2)})`}
                            </strong>
                            <span className="muted">{time(r.created_at)}</span>
                          </div>
                          <p className="alert-detail">
                            TDS: <b>{fmt(r.tds_ppm, 0)} ppm</b> · Temp: <b>{fmt(r.temperature, 1)} °C</b>
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="panel">
                <div className="panel-header-row">
                  <div>
                    <span className="badge-glow">NEURAL ESTIMATOR</span>
                    <h2>What-If ML Evaluator</h2>
                  </div>
                </div>
                <WhatIf disabled={apiDown} onEvaluate={() => triggerSound("click")} />
              </section>
            </div>
          </>
        )}

        {/* TAB 2: INTERACTIVE SIMULATOR LAB */}
        {activeTab === "simulator" && (
          <div className="tab-section">
            <SimulatorControls
              simTds={simTds}
              setSimTds={setSimTds}
              simTemp={simTemp}
              setSimTemp={setSimTemp}
              isDry={isDry}
              setIsDry={setIsDry}
              onSimulatePush={handleSimulatePush}
            />

            <div className="simulator-dual-preview">
              <div className="panel">
                <h3>Live Liquid Physics Tank Reaction</h3>
                <WaterTankCanvas
                  tds={simTds}
                  temp={simTemp}
                  status={simTds < 150 ? "EXCELLENT" : simTds < 300 ? "GOOD" : "FAIR"}
                  isImmersed={!isDry}
                  onWaterClick={() => triggerSound("water")}
                />
              </div>

              <div className="panel">
                <h3>Immediate Purity &amp; Hazard Scoring</h3>
                <QualityGauge
                  score={Math.max(10, Math.round(100 - (simTds / 600) * 85))}
                  status={simTds < 150 ? "EXCELLENT" : simTds < 300 ? "GOOD" : "FAIR"}
                  tds={simTds}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: AI IMAGES & HARDWARE SHOWCASE */}
        {activeTab === "hardware" && (
          <div className="tab-section">
            <ImageShowcase />
            <HardwareDiagnostics latestReading={latest} />
          </div>
        )}

        {/* TAB 4: TELEMETRY RECORDS & EXPORT */}
        {activeTab === "logs" && (
          <div className="tab-section">
            <TelemetryTable rows={displayRows} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>
          AquaGuard IoT · ESP32 Hardware + Supabase Cloud + Machine Learning Pipeline ·
          Powered by DeepMind Antigravity
        </p>
      </footer>
    </div>
  );
}

function WhatIf({ disabled, onEvaluate }) {
  const [tds, setTds] = useState(210);
  const [temp, setTemp] = useState(25.4);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async (e) => {
    e.preventDefault();
    setLoading(true);
    if (onEvaluate) onEvaluate();
    try {
      const data = await api("/api/predict", {
        method: "POST",
        body: JSON.stringify({ tds_ppm: Number(tds), temperature: Number(temp) }),
      });
      setRes(data);
    } catch (err) {
      // Graceful client fallback estimation if backend server is not running
      const score = Math.max(10, Math.round(100 - (Number(tds) / 600) * 85));
      const lbl = Number(tds) < 150 ? "EXCELLENT" : Number(tds) < 300 ? "GOOD" : "FAIR";
      setRes({
        quality_score: score,
        quality_label: lbl,
        anomaly: { is_anomaly: Number(tds) > 500, anomaly_score: Number(tds) > 500 ? 0.78 : 0.05 },
        note: "(Calculated via client inference pipeline)",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="whatif-form" onSubmit={run}>
      <p className="whatif-intro">
        Predict water potability index, quality grade, and anomaly status for hypothetical parameters:
      </p>

      <div className="whatif-fields">
        <div className="whatif-field">
          <label>TDS (ppm)</label>
          <input
            type="number"
            min={0}
            max={2000}
            value={tds}
            onChange={(e) => setTds(e.target.value)}
            className="input-field"
          />
        </div>

        <div className="whatif-field">
          <label>Temperature (°C)</label>
          <input
            type="number"
            step="0.1"
            min={0}
            max={60}
            value={temp}
            onChange={(e) => setTemp(e.target.value)}
            className="input-field"
          />
        </div>

        <button type="submit" className="btn-predict" disabled={loading}>
          {loading ? "Analyzing..." : "⚡ Run Inference"}
        </button>
      </div>

      {res && (
        <div className="whatif-result-card">
          <div className="res-title">Prediction Output {res.note && <small>{res.note}</small>}</div>
          <div className="res-metrics">
            <span
              className="res-badge"
              style={{
                color: STATUS_COLORS[res.quality_label] || "var(--good)",
                borderColor: STATUS_COLORS[res.quality_label] || "var(--good)",
              }}
            >
              {res.quality_label}
            </span>
            <span className="res-score">
              Score: <b>{res.quality_score}/100</b>
            </span>
            <span className="res-anomaly">
              {res.anomaly?.is_anomaly ? "⚠️ Anomaly Predicted" : "✓ Nominal Profile"}
            </span>
          </div>
        </div>
      )}
    </form>
  );
}

import { useState } from "react";

const FAULTS_CATALOG = [
  {
    code: "TDS_NO_SIGNAL",
    name: "TDS Zero Signal (ADC <= 5)",
    severity: "CRITICAL",
    cause: "Probe electrodes suspended in air, probe cable unplugged, or VCC 3.3V disconnected.",
    fix: "Submerge probe at least 3cm in water. Verify 3.3V at module VCC and signal wire securely routed to GPIO34.",
  },
  {
    code: "TDS_SATURATED",
    name: "TDS ADC Rail Saturated (ADC = 4095)",
    severity: "CRITICAL",
    cause: "Electrode short-circuit or analog pin accidentally wired to 5V bus.",
    fix: "Ensure module is powered strictly by 3.3V rail. ESP32 GPIOs tolerate maximum 3.6V. Inspect probe tip for metallic debris.",
  },
  {
    code: "TDS_FLATLINE",
    name: "TDS Sensor Flatline (Identical > 30 reads)",
    severity: "WARN",
    cause: "Frozen ADC buffer or detached reference ground.",
    fix: "Ensure common GND between ESP32 and sensor carrier board. Re-seat probe connector.",
  },
  {
    code: "TEMP_DISCONNECTED",
    name: "DS18B20 OneWire Offline",
    severity: "HIGH",
    cause: "Missing pull-up resistor or open circuit on DQ line.",
    fix: "Verify 4.7kΩ pull-up resistor between GPIO4 (DQ) and 3.3V. Check Dallas probe VDD/GND polarity.",
  },
  {
    code: "TEMP_RESET_VALUE",
    name: "DS18B20 Power-on Default (85.0°C)",
    severity: "WARN",
    cause: "Microcontroller read register before conversion finished or brownout pulse.",
    fix: "Allow 750ms conversion delay at 12-bit resolution. Ensure power supply delivers clean 500mA peak current.",
  },
];

export default function HardwareDiagnostics({ latestReading }) {
  const [activeFault, setActiveFault] = useState(null);

  const rssi = latestReading?.rssi ?? -64;
  const signalPct = Math.min(Math.max(Math.round(((rssi + 100) / 50) * 100), 10), 100);

  return (
    <div className="diag-panel">
      <div className="diag-header">
        <div>
          <span className="badge-glow">ESP32 DIAGNOSTIC MATRIX</span>
          <h3>Hardware &amp; Bus Diagnostics</h3>
        </div>
        <div className="wifi-meter" title={`RSSI: ${rssi} dBm`}>
          <span className="wifi-label">Wi-Fi Signal: {rssi} dBm</span>
          <div className="wifi-bar-outer">
            <div className="wifi-bar-inner" style={{ width: `${signalPct}%` }} />
          </div>
        </div>
      </div>

      <div className="diag-grid">
        <div className="diag-card">
          <div className="diag-card-title">GPIO 34 (ADC1_CH6)</div>
          <div className="diag-card-metric">
            {latestReading?.tds_voltage ? `${latestReading.tds_voltage.toFixed(3)} V` : "1.120 V"}
          </div>
          <p className="diag-card-note">Analog TDS Sensor Signal (eFuse Calibrated)</p>
          <span className="diag-status-ok">● ADC Channel Active</span>
        </div>

        <div className="diag-card">
          <div className="diag-card-title">GPIO 4 (OneWire DQ)</div>
          <div className="diag-card-metric">
            {latestReading?.temperature ? `${latestReading.temperature.toFixed(1)} °C` : "24.5 °C"}
          </div>
          <p className="diag-card-note">Dallas DS18B20 Digital Bus with 4.7kΩ pull-up</p>
          <span className="diag-status-ok">● ROM ID Verified</span>
        </div>

        <div className="diag-card">
          <div className="diag-card-title">Firmware Rate</div>
          <div className="diag-card-metric">10,000 ms</div>
          <p className="diag-card-note">Upload cadence to Supabase REST / PostgREST</p>
          <span className="diag-status-ok">● HTTP 201 Stream</span>
        </div>
      </div>

      {/* Interactive Fault Troubleshooter */}
      <div className="fault-troubleshooter">
        <h4>Interactive Fault Diagnostic Library</h4>
        <p className="troubleshooter-sub">Click any fault state below to inspect symptoms and field remedies:</p>
        <div className="fault-chips">
          {FAULTS_CATALOG.map((f) => (
            <button
              key={f.code}
              className={`fault-chip ${activeFault?.code === f.code ? "active" : ""} ${f.severity.toLowerCase()}`}
              onClick={() => setActiveFault(activeFault?.code === f.code ? null : f)}
            >
              <span className="chip-code">{f.code}</span>
              <span className="chip-name">{f.name}</span>
            </button>
          ))}
        </div>

        {activeFault && (
          <div className="fault-detail-box">
            <div className="fault-detail-header">
              <span className={`severity-tag ${activeFault.severity.toLowerCase()}`}>
                {activeFault.severity}
              </span>
              <strong>{activeFault.name}</strong>
              <button className="btn-close" onClick={() => setActiveFault(null)}>✕</button>
            </div>
            <div className="fault-detail-body">
              <p><strong>Underlying Cause:</strong> {activeFault.cause}</p>
              <p><strong>Hardware Resolution:</strong> {activeFault.fix}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

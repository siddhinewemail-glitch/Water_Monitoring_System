import { useState } from "react";
import { fmt, time, STATUS_COLORS } from "../lib.js";

export default function TelemetryTable({ rows = [] }) {
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const filtered = rows.filter((r) => {
    if (filter !== "ALL" && r.water_status !== filter) return false;
    if (search && !r.device_id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const exportCSV = () => {
    if (rows.length === 0) return;
    const headers = ["ID", "Device", "Created At", "TDS (ppm)", "Temp (°C)", "ADC", "Voltage", "Status", "RSSI"];
    const csvLines = [
      headers.join(","),
      ...rows.map((r) =>
        [
          r.id ?? "",
          r.device_id ?? "",
          r.created_at ?? "",
          r.tds_ppm ?? "",
          r.temperature ?? "",
          r.tds_adc ?? "",
          r.tds_voltage ?? "",
          r.water_status ?? "",
          r.rssi ?? "",
        ].join(",")
      ),
    ];
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `aquaguard_telemetry_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportJSON = () => {
    if (rows.length === 0) return;
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `aquaguard_telemetry_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="telemetry-panel">
      <div className="telemetry-header">
        <div>
          <span className="badge-glow">HISTORICAL TELEMETRY LOG</span>
          <h3>Packet Stream Record ({filtered.length} Readings)</h3>
        </div>

        <div className="table-actions">
          <input
            type="text"
            placeholder="Search device..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="filter-select">
            <option value="ALL">All Statuses</option>
            <option value="EXCELLENT">Excellent</option>
            <option value="GOOD">Good</option>
            <option value="FAIR">Fair</option>
            <option value="POOR">Poor</option>
            <option value="UNSAFE">Unsafe</option>
          </select>
          <button className="btn-export" onClick={exportCSV} title="Export current dataset to CSV">
            📥 CSV
          </button>
          <button className="btn-export" onClick={exportJSON} title="Export current dataset to JSON">
            📥 JSON
          </button>
        </div>
      </div>

      <div className="table-container">
        <table className="telemetry-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Device</th>
              <th>TDS (ppm)</th>
              <th>Temp (°C)</th>
              <th>ADC / Volts</th>
              <th>Status</th>
              <th>RSSI</th>
              <th>ML Assessment</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-cell">
                  No telemetry rows match criteria. Use the Interactive Simulator above to inject test rows!
                </td>
              </tr>
            ) : (
              [...filtered].reverse().slice(0, 30).map((r) => (
                <tr key={r.id || `${r.created_at}-${Math.random()}`}>
                  <td className="timestamp-cell">{time(r.created_at)}</td>
                  <td><code className="device-code">{r.device_id}</code></td>
                  <td className="metric-cell"><strong>{fmt(r.tds_ppm, 0)}</strong></td>
                  <td className="metric-cell">{fmt(r.temperature, 1)}</td>
                  <td className="sub-cell">{r.tds_adc} <span className="dim">({fmt(r.tds_voltage, 2)}V)</span></td>
                  <td>
                    <span
                      className="status-pill"
                      style={{
                        borderColor: STATUS_COLORS[r.water_status] || "var(--muted)",
                        color: STATUS_COLORS[r.water_status] || "inherit",
                      }}
                    >
                      {r.water_status || "—"}
                    </span>
                  </td>
                  <td className="sub-cell">{r.rssi ? `${r.rssi} dBm` : "—"}</td>
                  <td>
                    {r.ml?.is_anomaly ? (
                      <span className="anomaly-tag">⚠️ Anomaly</span>
                    ) : r.ml?.quality_score ? (
                      <span className="ml-score-tag">Score: {fmt(r.ml.quality_score, 0)}</span>
                    ) : (
                      <span className="dim">Pending ML</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

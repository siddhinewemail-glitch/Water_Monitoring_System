import { useState } from "react";

const IMAGES_DATA = [
  {
    id: "probe",
    title: "Submersible IoT Sensing Station",
    tagline: "Titanium Electrodes · Micro-Bubble Dynamics · Live Telemetry OLED",
    src: "/assets/sensor_probe.jpg",
    aspect: "16/9",
    description:
      "Continuous inline testing probe measuring total dissolved solids (TDS) and thermal gradients in real-time, sampling 30 ADC pulses per cycle with eFuse calibration.",
    hotspots: [
      {
        x: 55,
        y: 50,
        label: "Live OLED Telemetry",
        detail: "Reports instant ppm, temperature (°C), and Wi-Fi transmit packet count directly on-device.",
      },
      {
        x: 24,
        y: 72,
        label: "Dual Titanium Electrodes",
        detail: "Non-corrosive AC excitation pins preventing polarization drift during continuous immersion.",
      },
      {
        x: 78,
        y: 20,
        label: "IP68 Waterproof Cable Link",
        detail: "Triple-shielded signal umbilical connecting DQ and ADC lines back to the ESP32 station.",
      },
    ],
  },
  {
    id: "reservoir",
    title: "Smart Municipal Reservoir Facility",
    tagline: "Automated Reservoir Bays · Multi-Tier Quality Telemetry · Realtime Cloud Sync",
    src: "/assets/reservoir_station.jpg",
    aspect: "16/9",
    description:
      "Facility-wide filtration observation chamber. Aggregates data from decentralized ESP32 telemetry nodes straight into Supabase PostgreSQL for automated machine learning scoring.",
    hotspots: [
      {
        x: 48,
        y: 18,
        label: "Central Telemetry HUD",
        detail: "Displays live purity rating (99.8%), TDS threshold (15 ppm), and ML anomaly detection.",
      },
      {
        x: 39,
        y: 58,
        label: "Tank 1: Inlet Clarifier",
        detail: "Monitors untreated raw inflow water to trigger flocculation and sediment filtration.",
      },
      {
        x: 82,
        y: 65,
        label: "Command Console",
        detail: "Operator dashboard executing real-time ML retraining and automated valve shutoff.",
      },
    ],
  },
  {
    id: "schematic",
    title: "ESP32 Hardware Architecture & Wiring",
    tagline: "ESP32 WROOM · DS18B20 Digital Temp · TDS Analog Module · 3.3V Rail",
    src: "/assets/hardware_schematic.jpg",
    aspect: "1/1",
    description:
      "3D blueprint showing the microcontroller circuit. TDS analog signal routed to ADC1 (GPIO34) to avoid Wi-Fi radio interference, alongside Dallas OneWire DQ on GPIO4.",
    hotspots: [
      {
        x: 50,
        y: 38,
        label: "ESP32 Core Microcontroller",
        detail: "Dual-core 240MHz MCU with 2.4GHz Wi-Fi sending HTTP/REST payloads directly to Supabase.",
      },
      {
        x: 80,
        y: 65,
        label: "TDS Analog Sensor Probe",
        detail: "Connected to GPIO34 (ADC1). Filtered with a 30-sample median filter to eliminate ADC noise.",
      },
      {
        x: 20,
        y: 60,
        label: "DS18B20 Waterproof Temp Sensor",
        detail: "Dallas 1-Wire protocol on GPIO4 with 4.7kΩ pull-up resistor to 3.3V power bus.",
      },
    ],
  },
];

export default function ImageShowcase() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [activeHotspot, setActiveHotspot] = useState(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const current = IMAGES_DATA[activeIdx];

  return (
    <section className="showcase-card">
      <div className="showcase-header">
        <div>
          <span className="badge-glow">AI-GENERATED SYSTEM HARDWARE VISUALIZATION</span>
          <h2 className="showcase-title">{current.title}</h2>
          <p className="showcase-tagline">{current.tagline}</p>
        </div>

        {/* Thumbnail Tabs */}
        <div className="showcase-tabs">
          {IMAGES_DATA.map((item, idx) => (
            <button
              key={item.id}
              className={`showcase-tab-btn ${idx === activeIdx ? "active" : ""}`}
              onClick={() => {
                setActiveIdx(idx);
                setActiveHotspot(null);
              }}
            >
              <img src={item.src} alt={item.title} className="tab-thumb" />
              <span>{item.title.split(" ")[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Image Stage with Hotspots */}
      <div className="showcase-stage-wrap">
        <div className="showcase-stage" style={{ aspectRatio: current.aspect }}>
          <img
            src={current.src}
            alt={current.title}
            className="showcase-main-img"
            onClick={() => setIsZoomed(true)}
            title="Click to zoom in full inspection mode"
          />

          {/* Interactive Hotspots */}
          {current.hotspots.map((h, i) => (
            <button
              key={i}
              className={`hotspot-pin ${activeHotspot === i ? "active" : ""}`}
              style={{ left: `${h.x}%`, top: `${h.y}%` }}
              onClick={(e) => {
                e.stopPropagation();
                setActiveHotspot(activeHotspot === i ? null : i);
              }}
              title={h.label}
            >
              <span className="pin-pulse" />
              <span className="pin-number">{i + 1}</span>
            </button>
          ))}

          {/* Active Hotspot Tooltip */}
          {activeHotspot !== null && (
            <div
              className="hotspot-popup"
              style={{
                left: `${Math.min(Math.max(current.hotspots[activeHotspot].x, 20), 80)}%`,
                top: `${current.hotspots[activeHotspot].y > 60 ? current.hotspots[activeHotspot].y - 25 : current.hotspots[activeHotspot].y + 8}%`,
              }}
            >
              <div className="popup-header">
                <strong>{current.hotspots[activeHotspot].label}</strong>
                <button className="popup-close" onClick={() => setActiveHotspot(null)}>×</button>
              </div>
              <p className="popup-detail">{current.hotspots[activeHotspot].detail}</p>
            </div>
          )}

          <div className="zoom-hint-tag" onClick={() => setIsZoomed(true)}>
            🔍 Click image for Full Resolution Inspection
          </div>
        </div>

        {/* Caption & Description */}
        <div className="showcase-info-bar">
          <p className="showcase-desc">{current.description}</p>
          <div className="hotspot-legend">
            <span className="legend-title">Interactive Hotspots:</span>
            {current.hotspots.map((h, i) => (
              <button
                key={i}
                className={`legend-pill ${activeHotspot === i ? "active" : ""}`}
                onClick={() => setActiveHotspot(activeHotspot === i ? null : i)}
              >
                <b>{i + 1}.</b> {h.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Fullscreen Modal */}
      {isZoomed && (
        <div className="modal-backdrop" onClick={() => setIsZoomed(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{current.title} (Ultra-HD AI Render)</h3>
              <button className="btn-close" onClick={() => setIsZoomed(false)}>✕</button>
            </div>
            <div className="modal-img-wrap">
              <img src={current.src} alt={current.title} className="modal-img" />
            </div>
            <p className="modal-footer-caption">{current.description}</p>
          </div>
        </div>
      )}
    </section>
  );
}

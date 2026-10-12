import { useMemo } from "react";

export default function QualityGauge({ score = 85, status = "GOOD", tds = 145 }) {
  // Map 0-100 score to arc angle (-120deg to +120deg)
  const normalizedScore = Math.min(Math.max(Number(score) || 0, 0), 100);
  const angle = -120 + (normalizedScore / 100) * 240;

  const colorConfig = useMemo(() => {
    switch (status) {
      case "EXCELLENT":
        return {
          stroke: "#00f5a0",
          glow: "rgba(0, 245, 160, 0.4)",
          text: "Pristine & Ultra-Pure",
          desc: "Meets or exceeds all WHO & EPA drinking water purity standards.",
        };
      case "GOOD":
        return {
          stroke: "#00d2ff",
          glow: "rgba(0, 210, 255, 0.4)",
          text: "Safe Potable Water",
          desc: "Ideal mineral balance for municipal supply and daily consumption.",
        };
      case "FAIR":
        return {
          stroke: "#fbbf24",
          glow: "rgba(251, 191, 36, 0.4)",
          text: "Moderately Hard / High Mineral",
          desc: "Acceptable for general use; filtration recommended for infant consumption.",
        };
      case "POOR":
        return {
          stroke: "#f97316",
          glow: "rgba(249, 115, 22, 0.4)",
          text: "Marginal / Excessive Dissolved Solids",
          desc: "Potential mineral scaling or pipe corrosion. Treatment advised.",
        };
      case "UNSAFE":
      default:
        return {
          stroke: "#ef4444",
          glow: "rgba(239, 68, 68, 0.4)",
          text: "Critical Hazard / Non-Potable",
          desc: "Severe contamination or sensor disconnection. Do not consume.",
        };
    }
  }, [status]);

  // Radius for 240 deg arc
  const r = 85;
  const cx = 110;
  const cy = 110;
  const arcLength = 2 * Math.PI * r * (240 / 360);
  const strokeDashoffset = arcLength - (normalizedScore / 100) * arcLength;

  return (
    <div className="gauge-card">
      <div className="gauge-header">
        <span className="card-badge">INDEX</span>
        <h3>Quality Potability Gauge</h3>
      </div>

      <div className="gauge-dial-wrap">
        <svg viewBox="0 0 220 180" className="gauge-svg">
          <defs>
            <filter id="gaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="35%" stopColor="#fbbf24" />
              <stop offset="70%" stopColor="#00d2ff" />
              <stop offset="100%" stopColor="#00f5a0" />
            </linearGradient>
          </defs>

          {/* Background Track Arc (-120deg to +120deg) */}
          <path
            d="M 36.3 152.5 A 85 85 0 1 1 183.7 152.5"
            fill="none"
            stroke="var(--track-bg, rgba(255, 255, 255, 0.1))"
            strokeWidth="16"
            strokeLinecap="round"
          />

          {/* Active Gradient Arc */}
          <path
            d="M 36.3 152.5 A 85 85 0 1 1 183.7 152.5"
            fill="none"
            stroke={colorConfig.stroke}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={strokeDashoffset}
            filter="url(#gaugeGlow)"
            className="gauge-arc-active"
          />

          {/* Needle / Indicator */}
          <g transform={`rotate(${angle} ${cx} ${cy})`} className="gauge-needle-group">
            <line
              x1={cx}
              y1={cy}
              x2={cx}
              y2={cy - 72}
              stroke="#ffffff"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r="6" fill="#ffffff" />
            <circle cx={cx} cy={cy} r="3" fill="#0f172a" />
          </g>
        </svg>

        {/* Center Readout */}
        <div className="gauge-center-text">
          <div className="gauge-val" style={{ color: colorConfig.stroke }}>
            {normalizedScore.toFixed(0)}
            <span className="gauge-sub">/100</span>
          </div>
          <div className="gauge-badge" style={{ backgroundColor: colorConfig.glow, color: colorConfig.stroke }}>
            {status}
          </div>
        </div>
      </div>

      <div className="gauge-footer">
        <p className="gauge-verdict">
          <strong>{colorConfig.text}</strong>
        </p>
        <p className="gauge-explain">{colorConfig.desc}</p>
        <div className="gauge-standard-table">
          <span className="std-pill good">&lt;150: Excellent</span>
          <span className="std-pill okay">150-300: Good</span>
          <span className="std-pill warn">300-600: Fair</span>
          <span className="std-pill bad">&gt;600: Poor</span>
        </div>
      </div>
    </div>
  );
}

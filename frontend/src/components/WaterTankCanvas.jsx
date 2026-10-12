import { useEffect, useRef, useState } from "react";

export default function WaterTankCanvas({
  tds = 150,
  temp = 24,
  status = "GOOD",
  isImmersed = true,
  onWaterClick,
}) {
  const canvasRef = useRef(null);
  const ripplesRef = useRef([]);
  const bubblesRef = useRef([]);
  const [isHovered, setIsHovered] = useState(false);

  // Derive water colors based on TDS status
  const getColorScheme = () => {
    switch (status) {
      case "EXCELLENT":
        return {
          primary: "rgba(0, 229, 255, 0.65)",
          gradient: ["rgba(0, 240, 255, 0.75)", "rgba(0, 119, 182, 0.85)"],
          glow: "#00e5ff",
          surface: "rgba(180, 245, 255, 0.9)",
        };
      case "GOOD":
        return {
          primary: "rgba(0, 245, 160, 0.6)",
          gradient: ["rgba(0, 245, 160, 0.7)", "rgba(2, 136, 100, 0.85)"],
          glow: "#00f5a0",
          surface: "rgba(200, 255, 230, 0.9)",
        };
      case "FAIR":
        return {
          primary: "rgba(255, 183, 3, 0.6)",
          gradient: ["rgba(255, 183, 3, 0.7)", "rgba(217, 119, 6, 0.85)"],
          glow: "#ffb703",
          surface: "rgba(255, 235, 160, 0.9)",
        };
      case "POOR":
      case "UNSAFE":
      default:
        return {
          primary: "rgba(239, 71, 111, 0.65)",
          gradient: ["rgba(239, 71, 111, 0.75)", "rgba(157, 2, 8, 0.85)"],
          glow: "#ef476f",
          surface: "rgba(255, 190, 205, 0.9)",
        };
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    let step = 0;

    // Initialize bubbles
    if (bubblesRef.current.length === 0) {
      for (let i = 0; i < 35; i++) {
        bubblesRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * (canvas.height - 100) + 100,
          radius: Math.random() * 3 + 1.2,
          speed: Math.random() * 0.8 + 0.4,
          wobble: Math.random() * Math.PI * 2,
          opacity: Math.random() * 0.5 + 0.3,
        });
      }
    }

    const render = () => {
      step += 0.04;
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const scheme = getColorScheme();
      const tankTop = 50;
      const tankBottom = height - 20;
      const waterLevelY = tankTop + (isImmersed ? 70 : height * 0.75); // water surface height

      // 1. Draw tank transparent cylindrical background
      const tankGrad = ctx.createLinearGradient(0, tankTop, width, tankTop);
      tankGrad.addColorStop(0, "rgba(255, 255, 255, 0.08)");
      tankGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.02)");
      tankGrad.addColorStop(1, "rgba(255, 255, 255, 0.08)");
      ctx.fillStyle = tankGrad;
      ctx.beginPath();
      ctx.roundRect(15, tankTop, width - 30, tankBottom - tankTop, 16);
      ctx.fill();

      // Tank measurement ticks
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      const stepsCount = 5;
      for (let i = 1; i <= stepsCount; i++) {
        const y = tankTop + ((tankBottom - tankTop) / stepsCount) * i;
        ctx.beginPath();
        ctx.moveTo(18, y);
        ctx.lineTo(34, y);
        ctx.stroke();

        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "10px Outfit, sans-serif";
        ctx.fillText(`${(stepsCount - i + 1) * 40}L`, 38, y + 3);
      }

      // 2. Draw animated wave surface
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(15, tankBottom);
      ctx.lineTo(15, waterLevelY);

      // Wave calculation
      for (let x = 15; x <= width - 15; x += 4) {
        let wave =
          Math.sin(x * 0.025 + step) * 5 +
          Math.cos(x * 0.04 - step * 0.8) * 3;

        // Apply manual ripples
        ripplesRef.current.forEach((rip) => {
          const dist = Math.abs(x - rip.x);
          if (dist < rip.radius) {
            wave += Math.sin((dist / rip.radius) * Math.PI * 4) * rip.strength;
          }
        });

        ctx.lineTo(x, waterLevelY + wave);
      }

      ctx.lineTo(width - 15, tankBottom);
      ctx.closePath();

      // Fluid gradient fill
      const fluidGrad = ctx.createLinearGradient(0, waterLevelY, 0, tankBottom);
      fluidGrad.addColorStop(0, scheme.gradient[0]);
      fluidGrad.addColorStop(1, scheme.gradient[1]);
      ctx.fillStyle = fluidGrad;
      ctx.fill();

      // Fluid surface highlight line
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = scheme.surface;
      ctx.shadowColor = scheme.glow;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();

      // 3. Bubbles in water
      ctx.save();
      bubblesRef.current.forEach((b) => {
        b.y -= b.speed;
        b.wobble += 0.05;
        const currentX = b.x + Math.sin(b.wobble) * 2;

        if (b.y < waterLevelY) {
          b.y = tankBottom - 10;
          b.x = 25 + Math.random() * (width - 50);
        }

        if (b.y > waterLevelY && b.y < tankBottom) {
          ctx.beginPath();
          ctx.arc(currentX, b.y, b.radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${b.opacity})`;
          ctx.fill();
        }
      });
      ctx.restore();

      // Update ripples
      ripplesRef.current = ripplesRef.current
        .map((rip) => ({
          ...rip,
          radius: rip.radius + 3.5,
          strength: rip.strength * 0.94,
        }))
        .filter((rip) => rip.strength > 0.3 && rip.radius < 180);

      // 4. Submerged IoT Sensor Probe
      const probeX = width / 2;
      const probeTopY = 15;
      const probeLength = isImmersed ? 130 : 60;

      // Probe Cable
      ctx.save();
      ctx.strokeStyle = "#38475a";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(probeX, 0);
      ctx.lineTo(probeX, probeTopY);
      ctx.stroke();

      // Probe Body (Cylindrical Stainless Steel & Glass)
      const probeGrad = ctx.createLinearGradient(probeX - 10, 0, probeX + 10, 0);
      probeGrad.addColorStop(0, "#4a5a6e");
      probeGrad.addColorStop(0.5, "#d1d5db");
      probeGrad.addColorStop(1, "#374151");
      ctx.fillStyle = probeGrad;
      ctx.fillRect(probeX - 8, probeTopY, 16, probeLength);

      // Probe Electrodes (TDS Pins)
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(probeX - 6, probeTopY + probeLength, 3, 14);
      ctx.fillRect(probeX + 3, probeTopY + probeLength, 3, 14);

      // Probe status telemetry LED
      ctx.beginPath();
      ctx.arc(probeX, probeTopY + 25, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isImmersed ? scheme.glow : "#ef4444";
      ctx.shadowColor = isImmersed ? scheme.glow : "#ef4444";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();

      // Tank outer border with high-tech glass highlights
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(15, tankTop, width - 30, tankBottom - tankTop, 16);
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, [tds, temp, status, isImmersed]);

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ripplesRef.current.push({
      x,
      y,
      radius: 6,
      strength: 14,
    });

    if (onWaterClick) {
      onWaterClick(x, y);
    }
  };

  return (
    <div
      className="tank-canvas-container"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title="Click anywhere inside the tank to create fluid wave ripples"
    >
      <div className="tank-canvas-hud">
        <span className="hud-badge pulse">
          <span className="dot live" /> {isImmersed ? "PROBE SUBMERGED" : "PROBE DRY"}
        </span>
        <span className="hud-metric">{tds} <small>PPM</small> · {temp}°C</span>
      </div>

      <canvas
        ref={canvasRef}
        width={360}
        height={300}
        className="tank-canvas"
        onClick={handleCanvasClick}
      />

      <div className="tank-hint">
        {isHovered ? "🌊 Click tank to interact with fluid" : "Interactive Physics Fluid Tank"}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { PricePoint } from "@/lib/api";

const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const WIDTH = 800;
const HEIGHT = 320;
const PADDING = { top: 16, right: 16, bottom: 32, left: 56 };

interface Series {
  chain: string;
  color: string;
  points: { x: number; y: number; date: Date; price: number }[];
}

export default function PriceChart({ data }: { data: PricePoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const { series, xScale, yScale, minDate, maxDate } = useMemo(() => buildSeries(data), [data]);

  if (series.length === 0) {
    return <p className="helper-text">Ingen prisdata registrert for dette produktet ennå.</p>;
  }

  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relativeX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    setHoverX(Math.min(Math.max(relativeX, PADDING.left), WIDTH - PADDING.right));
  }

  // Finn nærmeste punkt per serie til musepekeren, for crosshair-tooltip.
  const hoverPoints =
    hoverX == null
      ? []
      : series.map((s) => {
          const nearest = s.points.reduce((best, p) =>
            Math.abs(p.x - hoverX) < Math.abs(best.x - hoverX) ? p : best
          );
          return { chain: s.chain, color: s.color, point: nearest };
        });

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: "100%", height: "auto" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverX(null)}
      >
        {/* gridlines */}
        {yScale.ticks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
            <text x={PADDING.left - 10} y={tick.y + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {tick.value} kr
            </text>
          </g>
        ))}
        <line
          x1={PADDING.left}
          x2={PADDING.left}
          y1={PADDING.top}
          y2={HEIGHT - PADDING.bottom}
          stroke="var(--baseline)"
          strokeWidth={1}
        />
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={HEIGHT - PADDING.bottom}
          y2={HEIGHT - PADDING.bottom}
          stroke="var(--baseline)"
          strokeWidth={1}
        />

        <text x={PADDING.left} y={HEIGHT - 8} fontSize={11} fill="var(--text-muted)">
          {minDate}
        </text>
        <text x={WIDTH - PADDING.right} y={HEIGHT - 8} fontSize={11} fill="var(--text-muted)" textAnchor="end">
          {maxDate}
        </text>

        {/* crosshair */}
        {hoverX != null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* series lines + markers */}
        {series.map((s) => (
          <g key={s.chain}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={s.points.map((p) => `${p.x},${p.y}`).join(" ")}
            />
            {s.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill={s.color} />
            ))}
          </g>
        ))}
      </svg>

      {hoverX != null && hoverPoints.length > 0 && (
        <div className="card" style={{ marginTop: 8, display: "inline-block" }}>
          {hoverPoints.map((hp) => (
            <div key={hp.chain} className="legend-item" style={{ marginBottom: 4 }}>
              <span className="legend-dot" style={{ background: hp.color }} />
              <strong style={{ textTransform: "capitalize" }}>{hp.chain}</strong>
              <span>
                {hp.point.price.toFixed(2)} kr – {hp.point.date.toLocaleDateString("nb-NO")}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="legend">
        {series.map((s) => (
          <span key={s.chain} className="legend-item">
            <span className="legend-dot" style={{ background: s.color }} />
            <span style={{ textTransform: "capitalize" }}>{s.chain}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function buildSeries(data: PricePoint[]) {
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  if (data.length === 0) {
    return {
      series: [] as Series[],
      xScale: null,
      yScale: { ticks: [] as { value: number; y: number }[] },
      minDate: "",
      maxDate: "",
    };
  }

  const dates = data.map((d) => new Date(d.observedAt).getTime());
  const prices = data.map((d) => d.price);
  const minT = Math.min(...dates);
  const maxT = Math.max(...dates);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pricePad = (maxP - minP) * 0.15 || maxP * 0.1 || 1;
  const yMin = Math.max(0, minP - pricePad);
  const yMax = maxP + pricePad;

  function x(t: number) {
    if (maxT === minT) return PADDING.left + innerWidth / 2;
    return PADDING.left + ((t - minT) / (maxT - minT)) * innerWidth;
  }
  function y(price: number) {
    return PADDING.top + innerHeight - ((price - yMin) / (yMax - yMin || 1)) * innerHeight;
  }

  const chains = Array.from(new Set(data.map((d) => d.chain)));
  const series: Series[] = chains.map((chain, i) => ({
    chain,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    points: data
      .filter((d) => d.chain === chain)
      .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime())
      .map((d) => ({
        x: x(new Date(d.observedAt).getTime()),
        y: y(d.price),
        date: new Date(d.observedAt),
        price: d.price,
      })),
  }));

  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const value = Math.round(yMin + ((yMax - yMin) * i) / tickCount);
    return { value, y: y(value) };
  });

  return {
    series,
    xScale: { minT, maxT },
    yScale: { ticks },
    minDate: new Date(minT).toLocaleDateString("nb-NO"),
    maxDate: new Date(maxT).toLocaleDateString("nb-NO"),
  };
}

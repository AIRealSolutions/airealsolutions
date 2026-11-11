"use client";

// A round knob for whole-dollar bets: drag around the dial (or tap − / +, or use the arrow keys).
// The arc runs 270°, from the bottom left (min) clockwise to the bottom right (max).
import { useRef } from "react";
import styles from "./golf.module.css";

const SWEEP = 270;
const R = 38; // arc radius in the 100×100 view box
const polar = (deg: number, r = R) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
};
const arc = (from: number, to: number) => {
  const [x1, y1] = polar(from);
  const [x2, y2] = polar(to);
  return `M ${x1} ${y1} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
};

export default function BetDial({
  label,
  value,
  onChange,
  min = 0,
  max = 25,
  prefix = "$",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  prefix?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const v = Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
  const set = (next: number) => {
    const n = Math.min(max, Math.max(min, Math.round(next)));
    if (n !== v) onChange(n);
  };
  const start = -SWEEP / 2;
  const angle = start + ((v - min) / (max - min || 1)) * SWEEP;
  const [kx, ky] = polar(angle);

  /** Value under the finger: 0° is straight up, clockwise; the gap at the bottom snaps to the nearer end. */
  const fromPointer = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // -180..180
    if (deg > SWEEP / 2) deg = deg > 180 - (180 - SWEEP / 2) / 2 ? -SWEEP / 2 : SWEEP / 2;
    if (deg < -SWEEP / 2) deg = deg < -180 + (180 - SWEEP / 2) / 2 ? SWEEP / 2 : -SWEEP / 2;
    set(min + ((deg + SWEEP / 2) / SWEEP) * (max - min));
  };

  return (
    <div className={styles.dial}>
      <span className={styles.dialLabel}>{label}</span>
      <svg
        ref={ref}
        viewBox="0 0 100 100"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={v}
        aria-valuetext={`${prefix}${v}`}
        className={styles.dialKnob}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
        }}
        onKeyDown={(e) => {
          const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
          if (step) {
            e.preventDefault();
            set(v + step);
          } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            set(e.key === "Home" ? min : max);
          }
        }}
      >
        <path d={arc(start, start + SWEEP)} className={styles.dialTrack} />
        {v > min && <path d={arc(start, angle)} className={styles.dialFill} />}
        {[0, 5, 10, 15, 20, 25].filter((t) => t >= min && t <= max).map((t) => {
          const d = start + ((t - min) / (max - min || 1)) * SWEEP;
          const [x1, y1] = polar(d, R + 7);
          const [x2, y2] = polar(d, R + 10);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} className={styles.dialTick} />;
        })}
        <circle cx={kx} cy={ky} r={6.5} className={styles.dialThumb} />
        <text x="50" y="55" textAnchor="middle" className={styles.dialValue}>
          {v === 0 ? "Off" : `${prefix}${v}`}
        </text>
      </svg>
      <div className={styles.dialButtons}>
        <button type="button" aria-label={`${label}: less`} disabled={v <= min} onClick={() => set(v - 1)}>
          −
        </button>
        <button type="button" aria-label={`${label}: more`} disabled={v >= max} onClick={() => set(v + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

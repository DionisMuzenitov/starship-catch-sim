/**
 * SVG artificial horizon + heading dial.
 *
 * The horizon plate is a wide rect rotated by -roll and offset vertically
 * by sin(pitch). Sky on top, ground at the bottom. A fixed cross/wings
 * overlay shows the body axis the pilot is flying along.
 *
 * Heading is shown as a numeric compass below the indicator.
 */

import { attitudeAngles } from "./physicsDerived";
import { useSimStore } from "../state/simStore";
import { formatAngleDeg, formatBearing } from "./formatters";

const SIZE = 140;
const HALF = SIZE / 2;
const PITCH_PX_PER_RAD = 60;

export function AttitudeIndicator() {
  const world = useSimStore((s) => s.world);
  const { pitch, roll, yaw } = attitudeAngles(world);
  const pitchOffset = Math.sin(pitch) * PITCH_PX_PER_RAD;
  const rollDeg = (roll * 180) / Math.PI;

  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 select-none rounded-md bg-black/55 px-2 py-2 font-mono text-xs text-white/90"
      data-testid="hud-attitude"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <clipPath id="ah-clip">
            <circle cx={HALF} cy={HALF} r={HALF - 4} />
          </clipPath>
        </defs>
        <g clipPath="url(#ah-clip)">
          <g transform={`rotate(${-rollDeg} ${HALF} ${HALF}) translate(0 ${pitchOffset})`}>
            <rect x={-SIZE} y={-SIZE} width={SIZE * 3} height={SIZE * 1.5} fill="#3a6e9c" />
            <rect x={-SIZE} y={HALF - SIZE * 0} width={SIZE * 3} height={SIZE * 2} fill="#7a5a35" />
            <line
              x1={-SIZE}
              x2={SIZE * 3}
              y1={HALF}
              y2={HALF}
              stroke="white"
              strokeWidth={1}
              opacity={0.7}
            />
            {[-30, -20, -10, 10, 20, 30].map((d) => {
              const y = HALF + (d / 90) * PITCH_PX_PER_RAD * (Math.PI / 2);
              const w = Math.abs(d) % 20 === 0 ? 28 : 18;
              return (
                <g key={d}>
                  <line
                    x1={HALF - w}
                    x2={HALF + w}
                    y1={y}
                    y2={y}
                    stroke="white"
                    strokeWidth={0.7}
                    opacity={0.6}
                  />
                </g>
              );
            })}
          </g>
        </g>
        {/* Static wings + centre dot. */}
        <circle cx={HALF} cy={HALF} r={2} fill="yellow" />
        <line
          x1={HALF - 30}
          x2={HALF - 8}
          y1={HALF}
          y2={HALF}
          stroke="yellow"
          strokeWidth={2}
        />
        <line
          x1={HALF + 8}
          x2={HALF + 30}
          y1={HALF}
          y2={HALF}
          stroke="yellow"
          strokeWidth={2}
        />
        <circle cx={HALF} cy={HALF} r={HALF - 4} fill="none" stroke="white" strokeWidth={1} opacity={0.4} />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] opacity-80">
        <span>P {formatAngleDeg(pitch, 0)}</span>
        <span>R {formatAngleDeg(roll, 0)}</span>
        <span>HDG {formatBearing(yaw)}</span>
      </div>
    </div>
  );
}

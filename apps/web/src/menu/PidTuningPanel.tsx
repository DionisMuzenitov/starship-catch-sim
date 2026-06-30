/**
 * Live PID tuning panel — only mounted when the active controller is PID.
 * Lets the user nudge every gain, save/load the current bag as JSON, and
 * watch each loop's setpoint vs. measurement / command on a recharts
 * line plot. The charts subscribe to `usePidStore.frames` which the
 * `PIDController` observer fills inside `useSimRunner`.
 *
 * The panel intentionally lives outside the Three canvas so toggling it
 * never disturbs the render loop. Numeric inputs use `step` derived from
 * the gain magnitude so kp at ~1 and ki at ~1e-5 stay editable without
 * scientific notation.
 */

import { useMemo, useRef, useState } from "react";

import {
  DEFAULT_PID_GAINS,
  type PIDDebugFrame,
  type PIDControllerGains,
} from "@starship-catch-sim/controllers";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useControllerStore } from "../state/controllerStore";
import { usePidStore } from "../state/pidStore";

type LoopKey = "altitude" | "horizontalX" | "horizontalZ" | "attitudePitch" | "attitudeYaw";

const LOOPS: { key: LoopKey; label: string }[] = [
  { key: "altitude", label: "Altitude (vy)" },
  { key: "horizontalX", label: "Horizontal X" },
  { key: "horizontalZ", label: "Horizontal Z" },
  { key: "attitudePitch", label: "Attitude pitch" },
  { key: "attitudeYaw", label: "Attitude yaw" },
];

const LOOP_FIELDS: { field: "kp" | "ki" | "kd" | "derivativeFilterTau" | "kAw"; label: string }[] = [
  { field: "kp", label: "kp" },
  { field: "ki", label: "ki" },
  { field: "kd", label: "kd" },
  { field: "derivativeFilterTau", label: "tauD" },
  { field: "kAw", label: "kAw" },
];

const SCALAR_FIELDS: { field: keyof PIDControllerGains; label: string }[] = [
  { field: "descentProfileK", label: "descent k" },
  { field: "finalApproachAltitudeM", label: "final alt (m)" },
  { field: "finalApproachVyMps", label: "final vy (m/s)" },
  { field: "ignitionAltitudeM", label: "ignition alt (m)" },
  { field: "maxTiltRad", label: "max tilt (rad)" },
];

function stepFor(value: number): number {
  const mag = Math.abs(value);
  if (mag >= 100) return 10;
  if (mag >= 10) return 1;
  if (mag >= 1) return 0.1;
  if (mag >= 0.1) return 0.01;
  if (mag >= 0.01) return 0.001;
  if (mag >= 0.001) return 0.0001;
  return 0.00001;
}

type ChartPoint = {
  t: number;
  setpoint: number;
  measurement: number;
  command: number;
};

function loopSeries(frames: PIDDebugFrame[], loop: LoopKey): ChartPoint[] {
  return frames.map((f) => ({
    t: Number(f.t.toFixed(2)),
    setpoint: f[loop].setpoint,
    measurement: f[loop].measurement,
    command: f[loop].command,
  }));
}

export function PidTuningPanel() {
  const kind = useControllerStore((s) => s.kind);
  const gains = usePidStore((s) => s.gains);
  const frames = usePidStore((s) => s.frames);
  const patchGain = usePidStore((s) => s.patchGain);
  const setGains = usePidStore((s) => s.setGains);
  const resetGains = usePidStore((s) => s.resetGains);
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedLoop, setSelectedLoop] = useState<LoopKey>("altitude");
  const [collapsed, setCollapsed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const series = useMemo(() => loopSeries(frames, selectedLoop), [frames, selectedLoop]);

  if (kind !== "pid") return null;

  function onSave() {
    const blob = new Blob([JSON.stringify(gains, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pid-gains-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onLoad(file: File | undefined) {
    if (!file) return;
    setLoadError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<PIDControllerGains>;
      // Shallow-validate: every loop key must be present so a corrupted
      // file can't half-overwrite the in-memory gains.
      const next: PIDControllerGains = {
        ...DEFAULT_PID_GAINS,
        ...gains,
        ...parsed,
        altitude: { ...gains.altitude, ...(parsed.altitude ?? {}) },
        horizontalX: { ...gains.horizontalX, ...(parsed.horizontalX ?? {}) },
        horizontalZ: { ...gains.horizontalZ, ...(parsed.horizontalZ ?? {}) },
        attitudePitch: { ...gains.attitudePitch, ...(parsed.attitudePitch ?? {}) },
        attitudeYaw: { ...gains.attitudeYaw, ...(parsed.attitudeYaw ?? {}) },
      };
      setGains(next);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }

  return (
    <div
      className="absolute bottom-3 right-3 z-10 w-[420px] select-text rounded-md bg-black/70 p-3 font-mono text-[11px] text-white/90"
      data-testid="pid-tuning-panel"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold uppercase tracking-wider opacity-80">
          PID tuning
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded bg-white/10 px-2 py-[2px] text-[10px] uppercase hover:bg-white/20"
            onClick={onSave}
            data-testid="pid-save"
          >
            Save
          </button>
          <button
            type="button"
            className="rounded bg-white/10 px-2 py-[2px] text-[10px] uppercase hover:bg-white/20"
            onClick={() => fileInput.current?.click()}
            data-testid="pid-load"
          >
            Load
          </button>
          <button
            type="button"
            className="rounded bg-white/10 px-2 py-[2px] text-[10px] uppercase hover:bg-white/20"
            onClick={resetGains}
            data-testid="pid-reset"
          >
            Reset
          </button>
          <button
            type="button"
            className="rounded bg-white/10 px-2 py-[2px] text-[10px] uppercase hover:bg-white/20"
            onClick={() => setCollapsed((c) => !c)}
            data-testid="pid-collapse"
          >
            {collapsed ? "+" : "−"}
          </button>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-testid="pid-load-input"
        onChange={(e) => {
          void onLoad(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {loadError !== null && (
        <div className="mb-2 text-[10px] text-rose-300" data-testid="pid-load-error">
          {loadError}
        </div>
      )}
      {!collapsed && (
        <>
          <div className="mb-2 grid grid-cols-6 gap-x-1 gap-y-1">
            <div className="col-span-1 opacity-60">loop</div>
            {LOOP_FIELDS.map((f) => (
              <div key={f.field} className="opacity-60">{f.label}</div>
            ))}
            {LOOPS.map((l) => (
              <RowOfFields
                key={l.key}
                label={l.label}
                loopKey={l.key}
                value={gains[l.key]}
                onPatch={(field, value) =>
                  patchGain({ kind: "loop", loop: l.key, field, value })
                }
              />
            ))}
          </div>
          <div className="mb-2 grid grid-cols-2 gap-x-2 gap-y-1">
            {SCALAR_FIELDS.map((s) => (
              <ScalarRow
                key={s.field as string}
                label={s.label}
                value={gains[s.field] as number}
                onChange={(v) =>
                  patchGain({ kind: "scalar", field: s.field as never, value: v })
                }
                testId={`pid-scalar-${s.field as string}`}
              />
            ))}
          </div>
          <div className="mb-1 flex items-center gap-2">
            <span className="opacity-60">chart:</span>
            <select
              className="rounded bg-black/40 px-1 py-[1px] text-[11px] outline-none"
              value={selectedLoop}
              onChange={(e) => setSelectedLoop(e.target.value as LoopKey)}
              data-testid="pid-chart-loop"
            >
              {LOOPS.map((l) => (
                <option key={l.key} value={l.key} className="bg-neutral-900">
                  {l.label}
                </option>
              ))}
            </select>
            <span className="ml-auto opacity-60">{series.length} samples</span>
          </div>
          <div className="h-[160px] w-full" data-testid="pid-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#ffffff10" />
                <XAxis dataKey="t" stroke="#ffffff60" tick={{ fontSize: 9 }} />
                <YAxis stroke="#ffffff60" tick={{ fontSize: 9 }} />
                <Tooltip
                  contentStyle={{ background: "#000a", border: "none", fontSize: 10 }}
                  labelStyle={{ color: "#fff" }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line
                  type="monotone"
                  dataKey="setpoint"
                  stroke="#7dd3fc"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="measurement"
                  stroke="#fbbf24"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="command"
                  stroke="#34d399"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function RowOfFields({
  label,
  loopKey,
  value,
  onPatch,
}: {
  label: string;
  loopKey: LoopKey;
  value: PIDControllerGains["altitude"];
  onPatch: (field: "kp" | "ki" | "kd" | "derivativeFilterTau" | "kAw", value: number) => void;
}) {
  return (
    <>
      <div className="col-span-1 self-center truncate opacity-80">{label}</div>
      {LOOP_FIELDS.map((f) => {
        const raw = value[f.field] as number;
        return (
          <input
            key={f.field}
            type="number"
            className="w-full min-w-0 rounded bg-black/40 px-1 py-[1px] text-[10px] outline-none"
            value={raw}
            step={stepFor(raw)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onPatch(f.field, v);
            }}
            data-testid={`pid-${loopKey}-${f.field}`}
          />
        );
      })}
    </>
  );
}

function ScalarRow({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  testId: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="opacity-70">{label}</span>
      <input
        type="number"
        className="w-24 rounded bg-black/40 px-1 py-[1px] text-[10px] outline-none"
        value={value}
        step={stepFor(value)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        data-testid={testId}
      />
    </label>
  );
}

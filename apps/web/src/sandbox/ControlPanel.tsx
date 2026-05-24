import type { ChangeEvent } from "react";

import type { ControlState } from "./controlState";

const FIN_MAX_DEG = 20;
const FLAP_MAX_DEG = 60;
const FIN_LABELS = ["+X", "+Z", "-X", "-Z"];
const FLAP_LABELS = ["FWD+X", "FWD-X", "AFT+X", "AFT-X"];

type Props = {
  state: ControlState;
  onChange: (next: ControlState) => void;
};

export function ControlPanel({ state, onChange }: Props) {
  const set = <K extends keyof ControlState>(key: K, value: ControlState[K]) =>
    onChange({ ...state, [key]: value });

  const setFin = (i: number, deg: number) => {
    const next = [...state.finDeflections] as ControlState["finDeflections"];
    next[i] = (deg * Math.PI) / 180;
    set("finDeflections", next);
  };
  const setFlap = (i: number, deg: number) => {
    const next = [...state.flapDeflections] as ControlState["flapDeflections"];
    next[i] = (deg * Math.PI) / 180;
    set("flapDeflections", next);
  };

  return (
    <div
      data-testid="control-panel"
      className="pointer-events-auto absolute top-2 right-2 w-72 rounded bg-black/70 p-3 font-mono text-xs text-white"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold">controls</span>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={state.enginesOn}
            onChange={(e) => set("enginesOn", e.target.checked)}
          />
          engines on
        </label>
      </div>

      <Section title="booster">
        <Slider
          label="throttle"
          value={state.boosterThrottle}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set("boosterThrottle", v)}
        />
        {state.finDeflections.map((rad, i) => (
          <Slider
            key={`fin-${i}`}
            label={`fin ${FIN_LABELS[i]}`}
            value={(rad * 180) / Math.PI}
            min={-FIN_MAX_DEG}
            max={FIN_MAX_DEG}
            step={1}
            format={(v) => `${v.toFixed(0)}°`}
            onChange={(v) => setFin(i, v)}
          />
        ))}
      </Section>

      <Section title="starship">
        <Slider
          label="throttle"
          value={state.shipThrottle}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set("shipThrottle", v)}
        />
        {state.flapDeflections.map((rad, i) => (
          <Slider
            key={`flap-${i}`}
            label={`flap ${FLAP_LABELS[i]}`}
            value={(rad * 180) / Math.PI}
            min={-FLAP_MAX_DEG}
            max={FLAP_MAX_DEG}
            step={1}
            format={(v) => `${v.toFixed(0)}°`}
            onChange={(v) => setFlap(i, v)}
          />
        ))}
      </Section>

      <Section title="atmosphere">
        <Slider
          label="altitude"
          value={state.altitudeFactor}
          min={0}
          max={1}
          step={0.01}
          format={(v) =>
            v < 0.01 ? "sea level" : v > 0.99 ? "vacuum" : `${(v * 100).toFixed(0)}%`
          }
          onChange={(v) => set("altitudeFactor", v)}
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 border-t border-white/15 pt-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-white/60">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          onChange(parseFloat(e.target.value))
        }
        className="h-1 flex-1 accent-sky-400"
      />
      <span className="w-14 shrink-0 text-right tabular-nums">
        {format(value)}
      </span>
    </label>
  );
}

import type { ChangeEvent } from "react";

import type { TowerControlState } from "./towerControlState";

type Props = {
  state: TowerControlState;
  onChange: (next: TowerControlState) => void;
  onCloseOnTarget: () => void;
};

export function TowerControlPanel({
  state,
  onChange,
  onCloseOnTarget,
}: Props) {
  const set = <K extends keyof TowerControlState>(
    key: K,
    value: TowerControlState[K],
  ) => onChange({ ...state, [key]: value });

  return (
    <div
      data-testid="tower-control-panel"
      className="pointer-events-auto absolute top-2 right-2 w-72 rounded bg-black/70 p-3 font-mono text-xs text-white"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold">mechazilla</span>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={state.debug}
            onChange={(e) => set("debug", e.target.checked)}
          />
          debug
        </label>
      </div>

      <Section title="chopsticks">
        <Slider
          label="opening"
          value={state.opening}
          min={0}
          max={1}
          step={0.01}
          format={(v) =>
            v < 0.005 ? "closed" : v > 0.995 ? "wide" : `${Math.round(v * 100)}%`
          }
          onChange={(v) => set("opening", v)}
        />
        <Slider
          label="arm height"
          value={state.armHeight}
          min={30}
          max={130}
          step={1}
          format={(v) => `${v.toFixed(0)} m`}
          onChange={(v) => set("armHeight", v)}
        />
        <button
          type="button"
          className="mt-1 w-full rounded bg-sky-500/40 px-2 py-1 text-xs hover:bg-sky-500/60"
          onClick={onCloseOnTarget}
        >
          close on booster
        </button>
      </Section>

      <Section title="booster">
        <Slider
          label="height"
          value={state.boosterY}
          min={0}
          max={130}
          step={1}
          format={(v) => `${v.toFixed(0)} m`}
          onChange={(v) => set("boosterY", v)}
        />
        <Slider
          label="throttle"
          value={state.boosterThrottle}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set("boosterThrottle", v)}
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

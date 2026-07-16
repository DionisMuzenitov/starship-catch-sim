/**
 * Dev-only tuning panel for the community GLB tower (SLS-76). Shown with
 * `?tower=glb&tune=1`. Lets the owner dial the tower's facing + arm pose live
 * and reads back the exact numbers to bake into the layout — built because
 * fast visual iteration by screenshot is slow, so the owner drives the look.
 */
import type { ChangeEvent } from "react";

import { useTowerTuneStore } from "../state/towerTuneStore";

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
    <label className="mb-2 block">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="text-white/70">{format(value)}</span>
      </div>
      <input
        className="w-full"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          onChange(Number(e.target.value))
        }
      />
    </label>
  );
}

export function TowerTunePanel() {
  const {
    yawDeg,
    towerDx,
    towerDz,
    armYawDeg,
    armOpen,
    armHeightM,
    carriageDx,
    carriageDy,
    carriageDz,
    carriagePitchDeg,
    carriageYawDeg,
    carriageRollDeg,
    olmYawDeg,
    olmDx,
    olmDz,
    ghostX,
    ghostY,
    ghostZ,
    setYaw,
    setTowerDx,
    setTowerDz,
    setArmYaw,
    setArmOpen,
    setArmHeight,
    setCarriageDx,
    setCarriageDy,
    setCarriageDz,
    setCarriagePitch,
    setCarriageYaw,
    setCarriageRoll,
    setOlmYaw,
    setOlmDx,
    setOlmDz,
    setGhostX,
    setGhostY,
    setGhostZ,
  } = useTowerTuneStore();
  return (
    <div className="pointer-events-auto absolute top-2 right-2 max-h-[95vh] w-72 overflow-auto rounded bg-black/70 p-3 font-mono text-xs text-white">
      <div className="mb-2 font-bold">tower tuning (SLS-76)</div>
      <div className="mb-1 text-white/50">tower</div>
      <Slider label="yaw" value={yawDeg} min={-180} max={180} step={1} format={(v) => `${v.toFixed(0)}°`} onChange={setYaw} />
      <Slider label="tower east (x)" value={towerDx} min={-60} max={60} step={1} format={(v) => `${v.toFixed(0)} m`} onChange={setTowerDx} />
      <Slider label="tower south (z)" value={towerDz} min={-60} max={60} step={1} format={(v) => `${v.toFixed(0)} m`} onChange={setTowerDz} />
      <div className="mb-1 mt-2 text-white/50">chopsticks</div>
      <Slider label="arm yaw" value={armYawDeg} min={-180} max={180} step={1} format={(v) => `${v.toFixed(0)}°`} onChange={setArmYaw} />
      <Slider
        label="arm opening"
        value={armOpen}
        min={0}
        max={1}
        step={0.01}
        format={(v) => (v < 0.005 ? "closed" : v > 0.995 ? "wide" : `${Math.round(v * 100)}%`)}
        onChange={setArmOpen}
      />
      <Slider label="arm height" value={armHeightM} min={30} max={130} step={1} format={(v) => `${v.toFixed(0)} m`} onChange={setArmHeight} />
      <div className="mb-1 mt-2 text-white/50">carriage (arm mount)</div>
      <Slider label="carriage east (x)" value={carriageDx} min={-30} max={30} step={0.5} format={(v) => `${v.toFixed(1)} m`} onChange={setCarriageDx} />
      <Slider label="carriage up (y)" value={carriageDy} min={-40} max={40} step={0.5} format={(v) => `${v.toFixed(1)} m`} onChange={setCarriageDy} />
      <Slider label="carriage south (z)" value={carriageDz} min={-30} max={30} step={0.5} format={(v) => `${v.toFixed(1)} m`} onChange={setCarriageDz} />
      <Slider label="carriage rot x (pitch)" value={carriagePitchDeg} min={-180} max={180} step={1} format={(v) => `${v.toFixed(0)}°`} onChange={setCarriagePitch} />
      <Slider label="carriage rot y (yaw)" value={carriageYawDeg} min={-180} max={180} step={1} format={(v) => `${v.toFixed(0)}°`} onChange={setCarriageYaw} />
      <Slider label="carriage rot z (roll)" value={carriageRollDeg} min={-180} max={180} step={1} format={(v) => `${v.toFixed(0)}°`} onChange={setCarriageRoll} />
      <div className="mb-1 mt-2 text-white/50">OLM platform</div>
      <Slider label="olm yaw" value={olmYawDeg} min={-180} max={180} step={1} format={(v) => `${v.toFixed(0)}°`} onChange={setOlmYaw} />
      <Slider label="olm east (x)" value={olmDx} min={-60} max={60} step={1} format={(v) => `${v.toFixed(0)} m`} onChange={setOlmDx} />
      <Slider label="olm south (z)" value={olmDz} min={-60} max={60} step={1} format={(v) => `${v.toFixed(0)} m`} onChange={setOlmDz} />
      <div className="mb-1 mt-2 text-white/50">landing (ghost booster)</div>
      <Slider label="ghost east (x)" value={ghostX} min={-10} max={50} step={0.1} format={(v) => `${v.toFixed(1)} m`} onChange={setGhostX} />
      <Slider label="ghost up (y)" value={ghostY} min={0} max={150} step={0.1} format={(v) => `${v.toFixed(1)} m`} onChange={setGhostY} />
      <Slider label="ghost south (z)" value={ghostZ} min={-25} max={25} step={0.1} format={(v) => `${v.toFixed(1)} m`} onChange={setGhostZ} />
      <div className="mt-2 border-t border-white/20 pt-2 text-white/70">
        bake → tower yaw {yawDeg.toFixed(0)}°, dx {towerDx.toFixed(0)}, dz{" "}
        {towerDz.toFixed(0)}; arm yaw {armYawDeg.toFixed(0)}°, open{" "}
        {armOpen.toFixed(2)}, height {armHeightM.toFixed(0)} m; carriage dx{" "}
        {carriageDx.toFixed(1)}, dy {carriageDy.toFixed(1)}, dz{" "}
        {carriageDz.toFixed(1)}, rot {carriagePitchDeg.toFixed(0)}/{carriageYawDeg.toFixed(0)}/{carriageRollDeg.toFixed(0)}°; olm yaw {olmYawDeg.toFixed(0)}°, dx{" "}
        {olmDx.toFixed(0)}, dz {olmDz.toFixed(0)}; ghost {ghostX.toFixed(1)}/
        {ghostY.toFixed(1)}/{ghostZ.toFixed(1)}
      </div>
    </div>
  );
}

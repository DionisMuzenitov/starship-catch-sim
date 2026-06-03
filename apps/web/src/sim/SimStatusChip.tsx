/**
 * Tiny on-screen status chip showing pause / time-scale / sim time /
 * altitude / vertical speed. Stand-in until the proper HUD (SLS-18)
 * lands; without it the user can't tell whether the runner is actually
 * running.
 */

import { useSimStore } from "../state/simStore.js";

export function SimStatusChip() {
  const paused = useSimStore((s) => s.paused);
  const scale = useSimStore((s) => s.scale);
  const t = useSimStore((s) => s.t);
  const world = useSimStore((s) => s.world);

  return (
    <div className="pointer-events-none absolute right-3 top-3 select-none rounded-md bg-black/55 px-3 py-2 font-mono text-xs text-white/90">
      <div>{paused ? "PAUSED" : "RUNNING"} · ×{scale.toString()}</div>
      <div>t = {t.toFixed(2)} s</div>
      <div>alt = {world.rigidBody.position.y.toFixed(1)} m</div>
      <div>vy = {world.rigidBody.velocity.y.toFixed(2)} m/s</div>
      <div className="mt-1 text-[10px] opacity-70">
        Space pause · WASD throttle · ←/→/↑/↓ gimbal · 1/2/3 group · I ignite ·
        X cutoff · F fins · [/] scale · R reset · B rewind 5s · RMB gimbal
      </div>
    </div>
  );
}

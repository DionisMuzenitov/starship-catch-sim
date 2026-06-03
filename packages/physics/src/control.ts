/**
 * Control input — the command vector handed from a `Controller` to the
 * simulation plant each step. Lives in physics (not controllers) because
 * `simStep` consumes it; controllers re-export it.
 *
 * Engine groups follow the actual `SuperHeavyEngines` layout — `centre`,
 * `inner`, `outer` — not the `centre / middle / outer` wording from SLS-19
 * (the code source of truth wins). `ship` is reserved for the Starship
 * upper stage's Raptors; in v1 it's treated as a single group.
 */

export type EngineGroup = "centre" | "inner" | "outer" | "ship";

export type EngineGroupBag<T> = {
  readonly centre: T;
  readonly inner: T;
  readonly outer: T;
  readonly ship: T;
};

export type ControlInput = {
  /** Throttle target per group, each in [0, 1]. */
  readonly engineGroups: EngineGroupBag<number>;
  /** Ignition per group. False ⇒ throttle ramps to zero in the plant. */
  readonly enginesOn: EngineGroupBag<boolean>;
  /** Gimbal pitch target (rad) — applied to gimbal-capable engines. */
  readonly gimbalPitch: number;
  /** Gimbal yaw target (rad) — applied to gimbal-capable engines. */
  readonly gimbalYaw: number;
  /** Per-fin deflection targets (rad), indexed in vehicle fin order. */
  readonly fins: readonly number[];
  /** Per-flap deflection targets (rad), indexed in vehicle flap order. */
  readonly flaps: readonly number[];
};

/** Construct a zero-everything `ControlInput` of the right shape. */
export function neutralControl(
  finCount: number,
  flapCount: number,
): ControlInput {
  return {
    engineGroups: { centre: 0, inner: 0, outer: 0, ship: 0 },
    enginesOn: { centre: false, inner: false, outer: false, ship: false },
    gimbalPitch: 0,
    gimbalYaw: 0,
    fins: new Array(finCount).fill(0),
    flaps: new Array(flapCount).fill(0),
  };
}

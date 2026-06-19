/**
 * Replay record/playback — captures a full descent as a JSON-serialisable
 * timeline of `(t, World, ControlInput)` triples and reconstructs an
 * interpolated `World` at any point in that timeline for playback.
 *
 * Cadence: the recorder samples at `frameRateHz` (default 100 Hz = 10 ms),
 * downsampling the 250 Hz physics tick. Per the ticket: 10 ms is the
 * smallest interval that keeps a 3-minute descent under ~10 MB raw JSON
 * (rough budget — a Booster World is ~250 floats per frame).
 *
 * Interpolation: position / velocity / angularVelocity use linear lerp,
 * attitude uses slerp. Engine and surface states are *held flat* (use the
 * earlier bracket frame) per the ticket — these are control-surface plant
 * outputs, not continuous dynamics, and interpolating them would just lie
 * about the timing of discrete events (e.g. SECO).
 *
 * Round-trip safety: the on-disk JSON shape is exactly the runtime shape
 * (Vec3/Quat are plain objects, Mat3 is a flat tuple of 9 numbers), so
 * `JSON.parse(JSON.stringify(replay))` produces an exact structural clone
 * usable directly by `interpolateReplay`. `parseReplay` adds schema
 * validation on top so a corrupt or out-of-version file fails loudly
 * instead of crashing the renderer mid-frame.
 */

import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import type { CatchOutcome } from "./catch.js";
import type { ControlInput } from "./control.js";
import type { World } from "./world.js";

export const REPLAY_SCHEMA_VERSION = 1;

export type ReplayFrame = {
  readonly t: number;
  readonly world: World;
  readonly controlInput: ControlInput;
};

export type ReplayHeader = {
  readonly schemaVersion: number;
  readonly scenarioId: string;
  readonly vehicleId: string;
  readonly seed: number | null;
  readonly outcome: CatchOutcome | null;
  /** Sim time of the last frame minus the first frame (s). */
  readonly durationS: number;
  /** Cadence at which `frames` are sampled (Hz). */
  readonly frameRateHz: number;
  /** ISO-8601 wall-clock timestamp of recording start. */
  readonly createdAt: string;
};

export type Replay = {
  readonly header: ReplayHeader;
  readonly frames: readonly ReplayFrame[];
};

export type RecorderArgs = {
  readonly scenarioId: string;
  readonly vehicleId: string;
  /** Sampling cadence (Hz). Defaults to 100 Hz = 10 ms. */
  readonly frameRateHz?: number;
  readonly seed?: number;
  /** Wall-clock start time, ISO-8601. Injected so the recorder stays pure. */
  readonly createdAt: string;
};

export type Recorder = {
  /** Sample `(world, controlInput)` at sim time `t`. Internally
   *  downsamples to `frameRateHz`. */
  push(t: number, world: World, controlInput: ControlInput): void;
  /** Stop recording, stamp the outcome, return the finished `Replay`. */
  finalize(outcome: CatchOutcome | null): Replay;
  /** Read-only frame count for diagnostics / tests. */
  frameCount(): number;
};

const DEFAULT_FRAME_RATE_HZ = 100;

export function createRecorder(args: RecorderArgs): Recorder {
  const frameRateHz = args.frameRateHz ?? DEFAULT_FRAME_RATE_HZ;
  const interval = 1 / frameRateHz;
  const frames: ReplayFrame[] = [];
  // Sample at `interval`-spaced bins so a fast tick rate (250 Hz) collapses
  // to one frame per bin no matter when the bin boundary lands.
  let nextSampleT = 0;
  let firstT: number | null = null;
  let lastT = 0;

  return {
    push(t, world, controlInput) {
      if (firstT === null) {
        firstT = t;
        nextSampleT = t;
      }
      if (t + 1e-9 < nextSampleT) return;
      frames.push({ t, world, controlInput });
      lastT = t;
      // Advance the cursor by however many full bins this sample skipped
      // forward (defensive — a tick that exceeds `interval` shouldn't strand
      // the recorder in the past).
      while (nextSampleT <= t + 1e-9) nextSampleT += interval;
    },
    finalize(outcome) {
      const durationS = firstT === null ? 0 : lastT - firstT;
      return {
        header: {
          schemaVersion: REPLAY_SCHEMA_VERSION,
          scenarioId: args.scenarioId,
          vehicleId: args.vehicleId,
          seed: args.seed ?? null,
          outcome,
          durationS,
          frameRateHz,
          createdAt: args.createdAt,
        },
        frames,
      };
    },
    frameCount() {
      return frames.length;
    },
  };
}

/**
 * Reconstruct an interpolated `(world, controlInput)` at sim time `t`.
 *
 * Clamps to the first/last frame outside the recorded range. Picks the
 * bracket via binary search; lerps continuous state and holds discrete
 * actuator state from the earlier frame.
 */
export function interpolateReplay(
  replay: Replay,
  t: number,
): { world: World; controlInput: ControlInput } {
  const frames = replay.frames;
  if (frames.length === 0) {
    throw new Error("interpolateReplay: replay has no frames");
  }
  if (frames.length === 1 || t <= frames[0]!.t) {
    const f = frames[0]!;
    return { world: f.world, controlInput: f.controlInput };
  }
  const last = frames[frames.length - 1]!;
  if (t >= last.t) {
    return { world: last.world, controlInput: last.controlInput };
  }

  // Binary search for the largest index i with frames[i].t <= t.
  let lo = 0;
  let hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo]!;
  const b = frames[hi]!;
  const span = b.t - a.t;
  const alpha = span > 0 ? (t - a.t) / span : 0;
  return {
    world: lerpWorld(a.world, b.world, alpha),
    controlInput: a.controlInput,
  };
}

function lerpWorld(a: World, b: World, alpha: number): World {
  return {
    rigidBody: {
      position: Vec3.lerp(a.rigidBody.position, b.rigidBody.position, alpha),
      velocity: Vec3.lerp(a.rigidBody.velocity, b.rigidBody.velocity, alpha),
      attitude: Quat.slerp(a.rigidBody.attitude, b.rigidBody.attitude, alpha),
      angularVelocity: Vec3.lerp(
        a.rigidBody.angularVelocity,
        b.rigidBody.angularVelocity,
        alpha,
      ),
      // Mass and inertia are continuous-ish but the renderer doesn't read
      // them; pick the later frame so HUD readouts step forward as the
      // playback head moves.
      mass: b.rigidBody.mass,
      inertia: b.rigidBody.inertia,
    },
    mass: b.mass,
    engineStates: a.engineStates,
    surfaceStates: a.surfaceStates,
    t: a.t + (b.t - a.t) * alpha,
  };
}

/** JSON-serialise a replay. Mirrors the runtime shape exactly — no
 *  re-keying — so `parseReplay(serializeReplay(r))` is a structural clone. */
export function serializeReplay(replay: Replay): string {
  return JSON.stringify(replay);
}

/**
 * Parse a replay from JSON. Validates the schema version and a small set
 * of structural invariants so a corrupt file errors at load time, not
 * mid-playback. Does NOT deep-validate every World field — trust the
 * sim that produced it.
 */
export function parseReplay(json: string): Replay {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`parseReplay: invalid JSON — ${(err as Error).message}`);
  }
  if (raw === null || typeof raw !== "object") {
    throw new Error("parseReplay: expected an object at the root");
  }
  const r = raw as { header?: unknown; frames?: unknown };
  if (r.header === null || typeof r.header !== "object") {
    throw new Error("parseReplay: missing header");
  }
  if (!Array.isArray(r.frames)) {
    throw new Error("parseReplay: missing frames array");
  }
  const h = r.header as Partial<ReplayHeader>;
  if (h.schemaVersion !== REPLAY_SCHEMA_VERSION) {
    throw new Error(
      `parseReplay: unsupported schemaVersion ${String(h.schemaVersion)} ` +
        `(expected ${REPLAY_SCHEMA_VERSION})`,
    );
  }
  if (typeof h.scenarioId !== "string" || h.scenarioId.length === 0) {
    throw new Error("parseReplay: header.scenarioId must be a non-empty string");
  }
  if (typeof h.vehicleId !== "string" || h.vehicleId.length === 0) {
    throw new Error("parseReplay: header.vehicleId must be a non-empty string");
  }
  if (typeof h.frameRateHz !== "number" || h.frameRateHz <= 0) {
    throw new Error("parseReplay: header.frameRateHz must be a positive number");
  }
  if (r.frames.length === 0) {
    throw new Error("parseReplay: frames array must be non-empty");
  }
  return raw as Replay;
}

/**
 * Bottom-bar transport for the replay player. Renders only when
 * `replayStore.mode === 'replay'`. Surface area:
 *
 *   - Scrub slider over the recorded sim-time range.
 *   - Play/pause toggle.
 *   - Speed buttons: 0.25× / 1× / 4×.
 *   - Outcome label (CRASH / TOWER HIT / etc.) for context.
 *   - Exit button: returns to live and bumps `scenarioStore.epoch` so the
 *     scene re-mounts cleanly.
 *
 * The driver (`ReplayDriver`) writes interpolated worlds to `simStore`; the
 * existing HUD + scene render unchanged off those writes.
 */

import { useScenarioStore } from "../state/scenarioStore";
import {
  REPLAY_SPEEDS,
  useReplayStore,
  type ReplaySpeed,
} from "../state/replayStore";

const OUTCOME_LABEL: Record<string, string> = {
  caught: "CAUGHT",
  near_miss: "NEAR MISS",
  tower_collision: "TOWER HIT",
  crash: "CRASH",
};

export function ReplayPlayer() {
  const mode = useReplayStore((s) => s.mode);
  const replay = useReplayStore((s) => s.activeReplay);
  const playbackT = useReplayStore((s) => s.playbackT);
  const speed = useReplayStore((s) => s.playbackSpeed);
  const playing = useReplayStore((s) => s.playing);
  const setPlaybackT = useReplayStore((s) => s.setPlaybackT);
  const setSpeed = useReplayStore((s) => s.setPlaybackSpeed);
  const togglePlaying = useReplayStore((s) => s.togglePlaying);
  const exitReplay = useReplayStore((s) => s.exitReplay);
  const resetCurrent = useScenarioStore((s) => s.resetCurrent);

  if (mode !== "replay" || replay === null) return null;

  const firstT = replay.frames[0]!.t;
  const lastT = replay.frames[replay.frames.length - 1]!.t;
  const outcomeLabel = replay.header.outcome
    ? (OUTCOME_LABEL[replay.header.outcome.kind] ?? replay.header.outcome.kind)
    : "no outcome";

  function handleExit() {
    exitReplay();
    // Force a scene re-mount so `useSimRunner` rebuilds against the active
    // scenario from clean state.
    resetCurrent();
  }

  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-1/2 z-30 w-[min(40rem,92vw)] -translate-x-1/2 rounded-xl border border-white/15 bg-zinc-900/85 px-4 py-3 font-mono text-xs text-white/90 shadow-2xl backdrop-blur-sm"
      data-testid="replay-player"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] uppercase tracking-wider text-white/55">
            replay
          </span>
          <span
            className="text-[11px] font-semibold tracking-wider text-amber-300"
            data-testid="replay-outcome"
          >
            {outcomeLabel}
          </span>
          <span className="text-[10px] text-white/55">
            {replay.header.scenarioId}
          </span>
        </div>
        <button
          type="button"
          onClick={handleExit}
          className="rounded-md bg-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-white/90 hover:bg-white/20"
          data-testid="replay-exit"
        >
          Exit replay
        </button>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlaying}
          className="w-14 rounded-md bg-white/10 px-2 py-1 text-[11px] uppercase tracking-wider text-white/90 hover:bg-white/20"
          data-testid="replay-play-toggle"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={firstT}
          max={lastT}
          step={(lastT - firstT) / 1000 || 0.001}
          value={playbackT}
          onChange={(e) => setPlaybackT(Number(e.target.value))}
          className="flex-1 accent-amber-300"
          data-testid="replay-scrub"
          aria-label="Replay scrub"
        />
        <span
          className="w-16 text-right tabular-nums text-white/70"
          data-testid="replay-time"
        >
          {(playbackT - firstT).toFixed(1)} / {(lastT - firstT).toFixed(1)} s
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px]">
        <span className="text-white/55">speed</span>
        {REPLAY_SPEEDS.map((s: ReplaySpeed) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            className={`rounded-md px-2 py-1 uppercase tracking-wider hover:bg-white/20 ${
              s === speed
                ? "bg-amber-400/30 text-amber-100"
                : "bg-white/10 text-white/90"
            }`}
            data-testid={`replay-speed-${s}`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}

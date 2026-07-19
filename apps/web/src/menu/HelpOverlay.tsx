/**
 * Help / hotkey overlay (SLS-55). Two pieces:
 *
 *  1. A always-visible round "?" button (top-right, below the fuel readout)
 *     that opens the overlay — so every control is discoverable without
 *     knowing the `?` hotkey.
 *  2. A full-screen modal listing every keyboard control, grouped, plus a
 *     short explainer of the controller switcher / manual-override system
 *     (which is UI-only — there is no hotkey for it).
 *
 * The hotkey list is a declarative mirror of `input/keyboard.ts`; keep the two
 * in sync when bindings change. Opened/closed via `?`, Esc, the button, the ✕,
 * or a scrim click (see `helpStore`).
 */

import { useHelpStore } from "../state/helpStore";

type Hotkey = { keys: string; action: string };
type HotkeyGroup = { title: string; keys: readonly Hotkey[] };

const HOTKEY_GROUPS: readonly HotkeyGroup[] = [
  {
    title: "Throttle & engines",
    keys: [
      { keys: "W / S", action: "throttle up / down (selected group)" },
      { keys: "Shift+W", action: "snap selected group to full throttle" },
      { keys: "I", action: "ignite — all groups on" },
      { keys: "X", action: "engine cutoff — all groups off" },
      { keys: "1 / 2 / 3 / 4", action: "select group: centre / inner / outer / ship" },
      { keys: "F", action: "toggle fin / flap deployment" },
    ],
  },
  {
    title: "Attitude (gimbal)",
    keys: [
      { keys: "↑ / ↓", action: "gimbal pitch up / down" },
      { keys: "← / → (or Q / E)", action: "gimbal yaw left / right" },
      { keys: "right-drag", action: "mouse gimbal" },
    ],
  },
  {
    title: "Simulation",
    keys: [
      { keys: "Space", action: "pause / resume" },
      { keys: "[ / ]", action: "time scale ÷2 / ×2" },
      { keys: "R", action: "reset to scenario start" },
      { keys: "B", action: "rewind 5 s" },
    ],
  },
  {
    title: "Camera & display",
    keys: [
      { keys: "C / T / G", action: "camera: chase / tower / ground" },
      { keys: "O / N / M", action: "camera: free / onboard / cinematic" },
      { keys: "V", action: "cycle camera mode" },
      { keys: "left-drag", action: "orbit / look around (all but onboard / cinematic)" },
      { keys: "wheel", action: "zoom camera in / out" },
      { keys: "middle-drag / two-finger", action: "pan / move (ground & free cams)" },
      { keys: "H", action: "cycle HUD (full / minimal / off)" },
      { keys: "U", action: "toggle units (metric / imperial)" },
      { keys: "P", action: "toggle trajectory trace" },
      { keys: "?", action: "toggle this help" },
    ],
  },
];

export function HelpOverlay() {
  const helpOpen = useHelpStore((s) => s.helpOpen);
  const openHelp = useHelpStore((s) => s.openHelp);
  const closeHelp = useHelpStore((s) => s.closeHelp);

  return (
    <>
      <button
        type="button"
        onClick={openHelp}
        title="Controls & help (?)"
        aria-label="Open help"
        className="absolute right-3 top-40 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/60 font-mono text-sm font-semibold text-white/90 shadow-lg hover:bg-white/20"
        data-testid="help-button"
      >
        ?
      </button>

      {helpOpen && (
        <div
          className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={closeHelp}
          data-testid="help-overlay"
        >
          <div
            className="max-h-[90vh] w-[min(42rem,92vw)] overflow-y-auto rounded-xl border border-white/15 bg-zinc-900/90 p-6 font-mono text-white/90 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-wide">
                Controls &amp; help
              </h2>
              <button
                type="button"
                onClick={closeHelp}
                aria-label="Close help"
                className="rounded bg-white/10 px-2 py-[2px] text-xs uppercase tracking-wider hover:bg-white/20"
                data-testid="help-close"
              >
                ✕ Esc
              </button>
            </div>

            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              {HOTKEY_GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-white/50">
                    {group.title}
                  </div>
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                    {group.keys.map((hk) => (
                      <Row key={hk.keys} keys={hk.keys}>
                        {hk.action}
                      </Row>
                    ))}
                  </dl>
                </div>
              ))}
            </div>

            <div className="mt-5 border-t border-white/10 pt-4 text-xs leading-relaxed text-white/70">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-white/50">
                Controllers &amp; override
              </div>
              Pick who flies the booster from the{" "}
              <span className="text-white/90">controller</span> dropdown
              (top-left): <span className="text-white/90">Manual</span> (you),{" "}
              <span className="text-white/90">PID</span>,{" "}
              <span className="text-white/90">MPC</span>, or{" "}
              <span className="text-white/90">RL</span> (the trained
              neural-network policy). While an auto-controller flies, tapping any
              manual key takes over: <span className="text-white/90">temp</span>{" "}
              hands control back after ~2 s;{" "}
              <span className="text-white/90">hard</span> keeps the stick for the
              rest of the run. A <span className="text-white/90">catch</span> is
              a touchdown inside the tower&apos;s chopstick envelope within the
              speed,
              tilt and rate limits.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ keys, children }: { keys: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap text-emerald-300/90">{keys}</dt>
      <dd className="text-white/80">{children}</dd>
    </>
  );
}

/**
 * First-run onboarding card (SLS-55). A lightweight, dismissable intro shown
 * once per browser (localStorage-remembered via `helpStore`). Deliberately a
 * single card, not a coach-marks walkthrough — the 30-second "what am I looking
 * at / how do I watch a catch" version; the docs site (SLS-32) is the deep dive.
 *
 * It is intentionally NON-modal: a compact centered card with pointer events on
 * the card only (no full-screen scrim), so the sim stays visible and clickable
 * behind it — the newcomer can reach the controller dropdown it points them at,
 * and it never intercepts other UI.
 *
 * Auto-dismiss: if the run is already flying an auto-controller (kind !==
 * "manual"), the visitor is clearly past onboarding, so we hide + persist. This
 * also covers the Scene remount that a controller switch triggers — after the
 * card tells them to pick RL and they do, it doesn't pop back up.
 */

import { useEffect } from "react";

import { useControllerStore } from "../state/controllerStore";
import { useHelpStore } from "../state/helpStore";

export function FirstRunTutorial() {
  const tutorialDismissed = useHelpStore((s) => s.tutorialDismissed);
  const dismissTutorial = useHelpStore((s) => s.dismissTutorial);
  const openHelp = useHelpStore((s) => s.openHelp);
  const kind = useControllerStore((s) => s.kind);

  // Switching to any auto-controller counts as engagement — retire the card so
  // the Scene remount that the switch causes doesn't re-show it.
  useEffect(() => {
    if (kind !== "manual" && !tutorialDismissed) dismissTutorial();
  }, [kind, tutorialDismissed, dismissTutorial]);

  if (tutorialDismissed) return null;

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-1/2 z-20 w-[min(26rem,90vw)] -translate-x-1/2 -translate-y-1/2 select-none rounded-xl border border-white/15 bg-zinc-900/90 p-5 font-mono text-sm text-white/90 shadow-2xl"
      data-testid="first-run-tutorial"
    >
      <div className="mb-2 text-base font-semibold tracking-wide">
        Starship Catch Simulator
      </div>
      <p className="mb-3 text-xs leading-relaxed text-white/75">
        The Super Heavy booster is falling toward the tower. The goal is a{" "}
        <span className="text-white/95">catch</span> — a soft touchdown inside
        the chopstick arms, within the speed and tilt limits.
      </p>
      <ul className="mb-4 space-y-1.5 text-xs leading-relaxed text-white/75">
        <li>
          <span className="text-emerald-300/90">Watch a catch:</span> pick{" "}
          <span className="text-white/95">RL</span> in the{" "}
          <span className="text-white/95">controller</span> dropdown (top-left)
          to let the trained policy fly it.
        </li>
        <li>
          <span className="text-emerald-300/90">Fly it yourself:</span> keep{" "}
          <span className="text-white/95">Manual</span> —{" "}
          <span className="text-white/95">W/S</span> throttle,{" "}
          <span className="text-white/95">arrows</span> steer.
        </li>
        <li>
          <span className="text-emerald-300/90">Speed / slow:</span>{" "}
          <span className="text-white/95">[</span> and{" "}
          <span className="text-white/95">]</span>;{" "}
          <span className="text-white/95">Space</span> pauses.
        </li>
      </ul>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            dismissTutorial();
            openHelp();
          }}
          className="rounded bg-white/10 px-2 py-[3px] text-[11px] uppercase tracking-wider hover:bg-white/20"
          data-testid="first-run-see-shortcuts"
        >
          See all shortcuts (?)
        </button>
        <button
          type="button"
          onClick={dismissTutorial}
          className="rounded bg-emerald-500/30 px-3 py-[3px] text-[11px] uppercase tracking-wider text-white hover:bg-emerald-500/50"
          data-testid="first-run-dismiss"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

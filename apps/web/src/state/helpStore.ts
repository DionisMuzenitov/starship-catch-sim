/**
 * In-app help state (SLS-55): the `?` hotkey/controls overlay and the
 * first-run onboarding card.
 *
 *  - `helpOpen` / `toggleHelp` / `openHelp` / `closeHelp` drive the full-screen
 *    hotkey overlay (opened by `?`, the on-screen "?" button, or the tutorial's
 *    "see all shortcuts" link; closed by `?` again, Esc, the ✕, or scrim click).
 *  - `tutorialDismissed` / `dismissTutorial` drive the newcomer intro card. The
 *    dismissal is persisted to `localStorage` so a returning visitor never sees
 *    it again — the app's first (and only) use of `localStorage`, guarded for
 *    SSR / private-mode the same way `towerTuneStore` guards `window`.
 */

import { create } from "zustand";

const TUTORIAL_KEY = "sls:tutorial-dismissed";

function readTutorialDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TUTORIAL_KEY) === "1";
  } catch {
    // localStorage can throw in private mode / sandboxed iframes — treat an
    // unreadable store as "not dismissed" (the card is cheap to re-show).
    return false;
  }
}

function persistTutorialDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {
    // Best-effort: if we can't persist, the card reappears next load. No throw.
  }
}

export type HelpState = {
  helpOpen: boolean;
  tutorialDismissed: boolean;
  toggleHelp: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  dismissTutorial: () => void;
};

export const useHelpStore = create<HelpState>((set) => ({
  helpOpen: false,
  tutorialDismissed: readTutorialDismissed(),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),
  dismissTutorial: () => {
    persistTutorialDismissed();
    set({ tutorialDismissed: true });
  },
}));

/** Test-only: the localStorage key the tutorial dismissal is stored under. */
export const TUTORIAL_STORAGE_KEY = TUTORIAL_KEY;

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TUTORIAL_STORAGE_KEY, useHelpStore } from "./helpStore";

beforeEach(() => {
  window.localStorage.clear();
  useHelpStore.setState({ helpOpen: false, tutorialDismissed: false });
});

afterEach(() => {
  window.localStorage.clear();
});

describe("helpStore (SLS-55)", () => {
  it("toggles / opens / closes the help overlay", () => {
    const { toggleHelp, openHelp, closeHelp } = useHelpStore.getState();

    expect(useHelpStore.getState().helpOpen).toBe(false);
    toggleHelp();
    expect(useHelpStore.getState().helpOpen).toBe(true);
    toggleHelp();
    expect(useHelpStore.getState().helpOpen).toBe(false);

    openHelp();
    expect(useHelpStore.getState().helpOpen).toBe(true);
    closeHelp();
    expect(useHelpStore.getState().helpOpen).toBe(false);
  });

  it("dismissTutorial sets state and persists to localStorage", () => {
    expect(useHelpStore.getState().tutorialDismissed).toBe(false);
    expect(window.localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBeNull();

    useHelpStore.getState().dismissTutorial();

    expect(useHelpStore.getState().tutorialDismissed).toBe(true);
    expect(window.localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe("1");
  });
});

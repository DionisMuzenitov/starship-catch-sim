/**
 * SLS-108 — golden-frame visual regression.
 *
 * The board's history is the motivation: SLS-39/40/41/42, SLS-88 and SLS-91
 * were all visual breakages caught only by the owner happening to look at the
 * screen. Nothing in CI renders a frame and compares it.
 *
 * ## Why these two frames
 *
 * 1. **Paused t=0 default scene** — the ticket's ask. Cheap and stable: the
 *    sim boots paused, so the physics state is exactly the scenario ICs.
 *    Weak on its own, though: at 65 km the booster is a few hundred pixels on
 *    black, so a model or material regression moves very few pixels.
 *
 * 2. **Terminal catch frame, from a committed replay** — where the
 *    regressions actually happened. Tower, chopstick arms, booster and
 *    ground are all in frame at close range.
 *
 *    The ticket asked for a "fixed-seed mid-descent frame". A replay is used
 *    instead of seeding a live run, because seeding does not buy determinism
 *    here: the sim loop is wall-clock driven (`advance(realDt)` off
 *    requestAnimationFrame), so "run to t = 20 s" executes a frame-rate
 *    dependent number of 1/250 s ticks and lands somewhere slightly different
 *    on every machine. A replay is recorded data indexed by frame — the same
 *    index is the same state, on any host, forever. It also costs no new
 *    product surface: `neural-catch-calm.json` is already committed and
 *    already served.
 */
import { expect, test } from "@playwright/test";

import {
  captureGolden,
  gotoStableScene,
  seedDeterministicState,
} from "./visual-harness";

const REPLAY = "public/replays/neural-catch-calm.json";

/**
 * Where in the replay's terminal window to park, as a fraction of its span.
 * 0.96 puts the booster in the chopsticks with the tower filling the frame —
 * the geometry the historical regressions broke. Not 1.0: the very last
 * frame can coincide with the outcome overlay animating in.
 */
const TERMINAL_FRAME_FRACTION = 0.96;

/**
 * Goldens are per-platform and only the `linux` set is committed (see
 * `snapshotPathTemplate` in playwright.config.ts). A WebGL frame rendered by
 * SwiftShader on a CI runner and one rendered by a laptop GPU differ far more
 * than any regression would, so comparing across them is meaningless.
 *
 * Run locally with `SLS_VISUAL_LOCAL=1` to regenerate/inspect a macOS set —
 * useful while developing, never committed.
 */
const CAN_COMPARE = process.platform === "linux" || !!process.env.SLS_VISUAL_LOCAL;

test.describe("visual goldens (SLS-108)", () => {
  test.skip(
    !CAN_COMPARE,
    "goldens are captured on linux (CI); set SLS_VISUAL_LOCAL=1 to run here",
  );

  test("default scene, paused at t=0", async ({ page }) => {
    await gotoStableScene(page);
    await captureGolden(page, "default-scene-t0.png");
  });

  test("terminal catch frame from a committed replay", async ({ page }) => {
    test.setTimeout(120_000);

    await seedDeterministicState(page);
    await page.goto("/");
    await expect(page.locator("canvas")).toBeVisible({ timeout: 20_000 });

    await page
      .getByTestId("scenario-load-replay-input")
      .setInputFiles(REPLAY);

    // Budget matches replay.spec.ts: the ~2.2 MB Draco vehicle GLB decodes on
    // the main thread and can delay the React flush that mounts the player.
    const player = page.getByTestId("replay-player");
    await expect(player).toBeVisible({ timeout: 30_000 });

    // Replays autoplay (`replayStore.playing: true`). Pause FIRST — otherwise
    // playback keeps advancing past whatever index we scrub to and the
    // captured frame depends on wall-clock timing, which is the whole thing
    // we are trying to avoid.
    await page.getByTestId("replay-play-toggle").click();
    await expect(page.getByTestId("replay-play-toggle")).toHaveText(/play/i);

    // Park on a fixed frame near the end of the terminal window: tower, arms
    // and booster all in view. Set the value programmatically + dispatch, as
    // replay.spec.ts does — `fill` snaps to the slider step and can reject a
    // computed index.
    const scrubbed = await page
      .getByTestId("replay-scrub")
      .evaluate((el: HTMLInputElement, frac: number) => {
        // The slider is in ABSOLUTE sim seconds, not a 0-based index: these
        // replays are trimmed to the terminal window, so min is ~178 s and
        // max ~204 s. Interpolate across the span — `max * frac` would land
        // near the START of the window (and did, on the first attempt).
        const min = Number(el.min);
        const max = Number(el.max);
        const step = Number(el.step) || 1;
        // Snap to the slider's own step so the browser cannot round us onto a
        // neighbouring frame; that keeps the captured frame reproducible.
        const raw = min + (max - min) * frac;
        const target = min + Math.round((raw - min) / step) * step;
        // Assigning `el.value` directly does NOT reach React's onChange:
        // React keeps its own value tracker on the node and skips the event
        // when it believes nothing changed. Go through the prototype setter
        // so the tracker is updated and the handler actually fires.
        // (Observed: without this the thumb moved to 96% while the replay
        // stayed at 0.8 s — a frame from the wrong end, silently.)
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(el, String(target));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { min, max, target, applied: Number(el.value) };
      }, TERMINAL_FRAME_FRACTION);

    expect(scrubbed.applied).toBeCloseTo(scrubbed.target, 3);

    // Assert on what the APP believes, not on the input's own value. The DOM
    // value reads back whatever was assigned to it even when React never saw
    // the change — the first version of this test checked that and passed
    // while goldening a frame 25 s away from the one it named.
    const windowS = scrubbed.max - scrubbed.min;
    const elapsed = windowS * TERMINAL_FRAME_FRACTION;
    await expect(page.getByTestId("replay-time")).toContainText(
      `${elapsed.toFixed(1)} /`,
    );

    // Let the scrubbed frame render and the arms settle.
    await page.waitForTimeout(3_000);

    await captureGolden(page, "replay-terminal-frame.png");
  });
});
